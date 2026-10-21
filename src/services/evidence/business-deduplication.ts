import type { BusinessIntelligence } from "./business-intelligence";
import { socialKey } from "../scout/social-profiles";

export interface DuplicateAssessment { status: "NO_MATCH" | "POSSIBLE_DUPLICATE" | "LIKELY_DUPLICATE"; score: number; reasons: string[]; humanReviewRequired: boolean; }
const normalize = (v?: string) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const SHARED_HOSTS = /(^|\.)(facebook|instagram|tiktok|linkedin|twitter|x|youtube|linktr|linktree|wa|goo|google|maps|bit)\.(com|ee|me|gl|ly|app)$/;

/** Canonical website identity: host without scheme/www/port, plus path without trailing slash; null for shared/social hosts. */
export function websiteKey(raw?: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".") || SHARED_HOSTS.test(host)) return null;
    return host + u.pathname.replace(/\/+$/, "").toLowerCase();
  } catch { return null; }
}

const sameSocial = (a: BusinessIntelligence, b: BusinessIntelligence): boolean => {
  const keys = new Set((a.socialLinks ?? []).map(socialKey).filter(Boolean));
  return (b.socialLinks ?? []).some((l) => { const k = socialKey(l); return !!k && keys.has(k); });
};

export function assessDuplicate(a: BusinessIntelligence, b: BusinessIntelligence): DuplicateAssessment {
  const reasons: string[] = []; let score = 0;
  if (a.phone && b.phone && normalize(a.phone) === normalize(b.phone)) { score += 45; reasons.push("phone_match"); }
  const wa = websiteKey(a.website), wb = websiteKey(b.website);
  if (wa && wb && wa === wb) { score += 50; reasons.push("website_match"); }
  if (sameSocial(a, b)) { score += 70; reasons.push("social_profile_match"); }
  if (normalize(a.canonicalName) === normalize(b.canonicalName)) { score += 20; reasons.push("name_match"); }
  if (a.latitude !== undefined && b.latitude !== undefined && a.longitude !== undefined && b.longitude !== undefined) {
    const distance = Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude);
    if (distance < 0.001) { score += 15; reasons.push("nearby_coordinates"); }
  }
  const status = score >= 70 ? "LIKELY_DUPLICATE" : score >= 35 ? "POSSIBLE_DUPLICATE" : "NO_MATCH";
  return { status, score, reasons, humanReviewRequired: status !== "NO_MATCH" };
}
