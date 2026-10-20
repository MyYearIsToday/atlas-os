/**
 * Bounded recovery of model output that should be one JSON object.
 *
 * Models routinely wrap JSON in prose or fences, leave trailing commas, use curly quotes, put raw newlines in strings, or get cut off
 * by a token limit. This scanner repairs only those mechanical defects, in one linear pass over at most MAX_CHARS characters, and
 * reports every repair it applied so nothing is silently "fixed". It never invents content: a truncated tail is closed, not
 * completed, and a dangling key with no value is dropped. Whether the result is USABLE is decided separately by validateShape and
 * the stage parser, and a repaired output is always labelled as repaired.
 */

export const MAX_CHARS = 200_000;

export interface Recovered { value: unknown; repairs: string[] }

const OPEN_QUOTES = new Set(['"', "“", "„", "‟"]);
const CLOSE_FOR: Record<string, string> = { '"': '"', "“": "”", "„": "”", "‟": "”" };

export function recoverJsonObject(raw: string): Recovered {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("the model output is empty");
  let text = raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS) : raw;
  const repairs: string[] = [];
  if (raw.length > MAX_CHARS) repairs.push("input_truncated_to_limit");
  text = text.replace(/^﻿/, "");
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object in the model output");
  if (/```/.test(text)) repairs.push("removed_code_fence");
  if (start > 0 && text.slice(0, start).replace(/```(?:json)?/gi, "").trim()) repairs.push("removed_text_before_json");

  // 1. Strict attempt on the balanced first object (string-aware), so trailing prose or a second object is ignored.
  const balanced = firstBalancedObject(text, start);
  if (balanced.end >= 0) {
    try {
      const value = JSON.parse(text.slice(start, balanced.end + 1));
      if (text.slice(balanced.end + 1).replace(/```/g, "").trim()) repairs.push("ignored_text_after_json");
      return { value, repairs: dedupe(repairs) };
    } catch { /* fall through to the lenient rewrite */ }
  }

  // 2. Lenient rewrite of the same region (to the end of the text when the object never closed).
  const region = balanced.end >= 0 ? text.slice(start, balanced.end + 1) : text.slice(start);
  const { out, applied, truncated } = rewrite(region);
  if (balanced.end < 0 || truncated) repairs.push("closed_truncated_output");
  repairs.push(...applied);
  try {
    return { value: JSON.parse(out), repairs: dedupe(repairs) };
  } catch (e) {
    throw new Error(`JSON could not be repaired (${(e as Error).message.slice(0, 120)})`);
  }
}

function dedupe(a: string[]) { return [...new Set(a)]; }

/** End index of the first brace-balanced object starting at `from`, ignoring braces inside strings; -1 when it never closes. */
function firstBalancedObject(s: string, from: number): { end: number } {
  let depth = 0; let inStr = false; let esc = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) return { end: i }; if (depth < 0) return { end: -1 }; }
  }
  return { end: -1 };
}

function rewrite(s: string): { out: string; applied: string[]; truncated: boolean } {
  const applied = new Set<string>();
  const stack: string[] = [];
  let out = ""; let inStr = false; let closer = '"'; let esc = false; let strStart = 0; let strIsKey = false;
  const lastSig = () => { for (let i = out.length - 1; i >= 0; i--) if (!/\s/.test(out[i])) return out[i]; return ""; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { out += c; esc = false; continue; }
      if (c === "\\") { out += c; esc = true; continue; }
      if (c === closer) {
        // A straight quote inside a string that started with a curly quote is content, not a terminator.
        inStr = false; out += '"'; continue;
      }
      if (c === '"' && closer !== '"') { out += '\\"'; continue; }
      if (c === "\n") { out += "\\n"; applied.add("escaped_newline_in_string"); continue; }
      if (c === "\r") { continue; }
      if (c === "\t") { out += "\\t"; applied.add("escaped_tab_in_string"); continue; }
      out += c; continue;
    }
    if (OPEN_QUOTES.has(c)) { strStart = out.length; strIsKey = stack[stack.length - 1] === "}" && (lastSig() === "{" || lastSig() === ","); inStr = true; closer = CLOSE_FOR[c]; out += '"'; if (c !== '"') applied.add("normalised_curly_quotes"); continue; }
    if (c === "/" && s[i + 1] === "/") { while (i < s.length && s[i] !== "\n") i++; applied.add("removed_comment"); continue; }
    if (c === "/" && s[i + 1] === "*") { const e = s.indexOf("*/", i + 2); i = e < 0 ? s.length : e + 1; applied.add("removed_comment"); continue; }
    if (c === "{" || c === "[") { stack.push(c === "{" ? "}" : "]"); out += c; continue; }
    if (c === "}" || c === "]") {
      // trailing comma before a closer
      if (lastSig() === ",") { out = out.replace(/,\s*$/, ""); applied.add("removed_trailing_comma"); }
      if (stack.length && stack[stack.length - 1] === c) stack.pop();
      out += c; if (!stack.length) break; continue;
    }
    // bare keys:  {name: "x"}  ->  {"name": "x"}
    if (/[A-Za-z_$]/.test(c) && (lastSig() === "{" || lastSig() === ",") && stack[stack.length - 1] === "}") {
      const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
      if (m && /^\s*:/.test(s.slice(i + m[0].length))) { out += `"${m[0]}"`; i += m[0].length - 1; applied.add("quoted_bare_key"); continue; }
    }
    // python-style literals
    const lit = /^(True|False|None)\b/.exec(s.slice(i));
    if (lit) { out += lit[1] === "True" ? "true" : lit[1] === "False" ? "false" : "null"; i += lit[1].length - 1; applied.add("normalised_literal"); continue; }
    out += c;
  }
  let truncated = false;
  if (inStr) { truncated = true; if (strIsKey) out = out.slice(0, strStart); else out += '"'; } // a cut-off key is dropped, a cut-off value is kept as written
  if (stack.length) {
    truncated = true;
    // drop a dangling key/colon or comma so the closers produce valid JSON, never a made-up value
    out = out.replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:\s*$/, "").replace(/[,:]\s*$/, "");
    out = out.replace(/,\s*$/, "");
    out += [...stack].reverse().join("");
  }
  return { out, applied: [...applied], truncated };
}

// ------------------------------------------------------------------ shape validation (the raw contract of each stage)

type Kind = "string" | "array";
const SHAPE: Record<string, { required?: Array<[string, Kind]>; oneOf?: string[]; arrays?: string[] }> = {
  profile: { required: [["name", "string"]], arrays: ["facts", "productsServices", "socialAccounts", "unknowns"] },
  audit: { required: [["summary", "string"]], oneOf: ["strengths", "weaknesses", "gaps", "improvementOpportunities"], arrays: ["strengths", "weaknesses", "gaps", "improvementOpportunities"] },
  competitors: { required: [["shortlist", "array"]], arrays: ["whitespace", "threats", "gaps", "conflicts"] },
  market: { oneOf: ["audience", "trends", "opportunities", "unknowns"], arrays: ["audience", "localContext", "trends", "opportunities", "threats", "barriers", "estimates", "unknowns"] },
  swot: { oneOf: ["strengths", "weaknesses", "opportunities", "threats"], arrays: ["strengths", "weaknesses", "opportunities", "threats"] },
  growth: { required: [["recommendations", "array"]] },
  campaign: { required: [["campaigns", "array"]], arrays: ["pillars", "channels", "sequence", "content", "assumptions"] },
  plan: { required: [["actionPlan", "array"]], arrays: ["followUps", "limitations"] },
};

/** Structural contract check on the raw object, before normalisation. Returns every violation (empty = acceptable shape). */
export function validateShape(stage: string, o: unknown): string[] {
  const errors: string[] = [];
  if (!o || typeof o !== "object" || Array.isArray(o)) return ["the output is not a JSON object"];
  const rec = o as Record<string, unknown>;
  const spec = SHAPE[stage];
  if (!spec) return errors;
  for (const [key, kind] of spec.required ?? []) {
    const v = rec[key];
    if (v === undefined || v === null) errors.push(`missing required key "${key}"`);
    else if (kind === "string" && (typeof v !== "string" || !v.trim())) errors.push(`"${key}" must be a non-empty string`);
    else if (kind === "array" && !Array.isArray(v)) errors.push(`"${key}" must be an array`);
  }
  for (const key of spec.arrays ?? []) if (rec[key] !== undefined && rec[key] !== null && !Array.isArray(rec[key])) errors.push(`"${key}" must be an array`);
  if (spec.oneOf && !spec.oneOf.some((k) => Array.isArray(rec[k]))) errors.push(`expected at least one of: ${spec.oneOf.join(", ")}`);
  return errors;
}
