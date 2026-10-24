/** Parses "Research Mesa UGBS" / {query, place} into a business name and optional place. Strict: control characters and over-long input are refused. */
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001F\u007F]/;
export function parseResearchRequest(query: unknown, place?: unknown): { ok: true; name: string; place?: string } | { ok: false; message: string } {
  if (typeof query !== "string") return { ok: false, message: "Type a business name, for example: Research Mesa UGBS." };
  if (CTRL.test(query) || (typeof place === "string" && CTRL.test(place))) return { ok: false, message: "The request contains control characters." };
  const name = query.replace(/^\s*(please\s+)?(research|investigate|look\s+up|find\s+out\s+about)\s*:?\s+/i, "").replace(/\s+/g, " ").trim();
  if (name.length < 2) return { ok: false, message: "Type a business name, for example: Research Mesa UGBS." };
  if (name.length > 120) return { ok: false, message: "The business name is too long (120 characters at most)." };
  const where = typeof place === "string" ? place.replace(/\s+/g, " ").trim().slice(0, 100) : "";
  return { ok: true, name, ...(where ? { place: where } : {}) };
}
