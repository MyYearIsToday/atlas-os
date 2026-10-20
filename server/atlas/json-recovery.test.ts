import test from "node:test";
import assert from "node:assert/strict";
import { recoverJsonObject, validateShape, MAX_CHARS } from "./json-recovery";
import { extractJson, parseStageOutput, parseStageOutputDetailed } from "./dossier";

const ok = (raw: string) => recoverJsonObject(raw);

test("clean JSON needs no repair; fences and surrounding prose are removed and reported", () => {
  assert.deepEqual(ok('{"a":1}'), { value: { a: 1 }, repairs: [] });
  const r = ok('Sure! Here is the result:\n```json\n{"a":[1,2]}\n```\nHope that helps.');
  assert.deepEqual(r.value, { a: [1, 2] });
  assert.ok(r.repairs.includes("removed_code_fence") && r.repairs.includes("removed_text_before_json") && r.repairs.includes("ignored_text_after_json"));
});

test("only the first balanced object is taken, and braces inside strings do not confuse it", () => {
  assert.deepEqual(ok('{"a":"x } y { z","b":{"c":2}} {"second":true}').value, { a: "x } y { z", b: { c: 2 } });
});

test("mechanical defects are repaired and named: trailing commas, comments, curly quotes, raw newlines, bare keys, python literals", () => {
  const r = ok(`{name: "Kente", /* note */ "tags": ["a", "b",], "flag": True, "none": None, "text": "line one\nline two", "q": “quoted”,}`);
  assert.deepEqual(r.value, { name: "Kente", tags: ["a", "b"], flag: true, none: null, text: "line one\nline two", q: "quoted" });
  for (const x of ["quoted_bare_key", "removed_comment", "removed_trailing_comma", "normalised_literal", "escaped_newline_in_string", "normalised_curly_quotes"]) assert.ok(r.repairs.includes(x), `missing repair ${x}: ${r.repairs}`);
});

test("truncated output is closed, not completed: a dangling key is dropped and nothing is invented", () => {
  const r = ok('{"summary":"ok","strengths":[{"text":"a"},{"text":"b","bas');
  assert.ok(r.repairs.includes("closed_truncated_output"));
  const v = r.value as { summary: string; strengths: Array<Record<string, unknown>> };
  assert.equal(v.summary, "ok"); assert.equal(v.strengths.length, 2);
  assert.ok(!("basis" in v.strengths[1]) || v.strengths[1].basis === undefined);
  assert.deepEqual(ok('{"a":1,"b":').value, { a: 1 });
  assert.deepEqual(ok('{"a":[1,2,').value, { a: [1, 2] });
});

test("unrepairable or empty output throws with a precise message; input size is bounded", () => {
  assert.throws(() => ok("I think the business is fine."), /no JSON object/);
  assert.throws(() => ok("   "), /empty/);
  assert.throws(() => ok('{"a": nope nope}'), /could not be repaired/);
  const big = ok(`{"a":"${"x".repeat(MAX_CHARS)}"}`);
  assert.ok(big.repairs.includes("input_truncated_to_limit"));
});

test("shape validation reports every contract violation per stage", () => {
  assert.deepEqual(validateShape("swot", { strengths: [], weaknesses: [] }), []);
  assert.match(validateShape("swot", { notes: "x" }).join(), /at least one of/);
  assert.match(validateShape("audit", { strengths: "lots" }).join(), /missing required key "summary".*"strengths" must be an array/);
  assert.match(validateShape("growth", { recommendations: "none" }).join(), /must be an array/);
  assert.match(validateShape("profile", { name: "" }).join(), /non-empty string/);
  assert.deepEqual(validateShape("competitors", { shortlist: [] }), []);
  assert.deepEqual(validateShape("nonexistent", {}), []);
  assert.match(validateShape("swot", [1] as never).join(), /not a JSON object/);
});

test("stage parsing reports repairs, and a wrong shape is rejected before normalisation can mask it", () => {
  const d = parseStageOutputDetailed("swot", '```\n{"strengths":[{"text":"a","basis":"hypothesis"},],"weaknesses":[],}\n```', new Set());
  assert.equal((d.output.strengths as unknown[]).length, 1); assert.ok(d.repairs.includes("removed_trailing_comma"));
  assert.throws(() => parseStageOutput("audit", '{"summary":"s","strengths":"many"}', new Set()), /schema:.*"strengths" must be an array/);
  assert.throws(() => parseStageOutput("swot", "{}", new Set()), /schema:/);
  assert.deepEqual(extractJson('{"x":1}'), { x: 1 });
});
