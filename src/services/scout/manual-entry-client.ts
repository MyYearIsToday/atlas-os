import type { ManualBusinessInput, ManualEntryFieldError } from "./manual-entry";

export interface ManualEntrySuccess {
  ok: true;
  businessId: string;
  action: "CREATED" | "UPDATED_EXISTING";
  duplicateStatus: "NONE" | "POSSIBLE_DUPLICATE" | "HUMAN_REVIEW";
  dispatch: string;
}

export type ManualEntryResponse =
  | ManualEntrySuccess
  | { ok: false; errors: ManualEntryFieldError[]; message?: string };

/** Browser -> trusted proxy. The proxy owns validation, persistence and BusinessDiscovered dispatch. */
export async function postManualBusiness(
  input: ManualBusinessInput,
  options: { proxyBaseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<ManualEntryResponse> {
  const base = options.proxyBaseUrl ?? (import.meta as any).env?.VITE_ATLAS_PROXY_URL ?? "http://localhost:8787";
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${base}/api/scout/manual-entry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body?.ok) return body as ManualEntrySuccess;
    return { ok: false, errors: Array.isArray(body?.errors) ? body.errors : [], message: body?.reason ?? `Request failed (HTTP ${response.status})` };
  } catch {
    return { ok: false, errors: [], message: "Could not reach the Atlas server" };
  }
}
