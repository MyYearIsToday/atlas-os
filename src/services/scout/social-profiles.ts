/**
 * Safe social-profile normalisation for intake.
 * A full URL on a known platform is canonicalised. A bare handle is accepted only when the operator names the
 * platform AND that platform has a single unambiguous profile URL pattern. Nothing is guessed: a bare handle with
 * no platform, or a LinkedIn handle (company vs person is ambiguous), is rejected with an actionable message.
 * The result is an operator-supplied research starting point, never evidence that the profile exists or belongs
 * to the business.
 */
export type SocialPlatform = "instagram" | "tiktok" | "facebook" | "linkedin" | "x";
export const SOCIAL_PLATFORMS: SocialPlatform[] = ["instagram", "tiktok", "facebook", "linkedin", "x"];

export interface SocialProfile { platform: SocialPlatform; handle: string; url: string }
export type SocialResult = { ok: true; profile: SocialProfile } | { ok: false; message: string };

const HOSTS: Record<string, SocialPlatform> = {
  "instagram.com": "instagram", "tiktok.com": "tiktok", "facebook.com": "facebook", "fb.com": "facebook",
  "linkedin.com": "linkedin", "x.com": "x", "twitter.com": "x",
};
const HANDLE = /^[A-Za-z0-9._]{1,60}$/;
const RESERVED = new Set(["share", "sharer", "sharer.php", "intent", "home", "explore", "login", "signup", "p", "reel", "reels", "stories", "watch", "groups", "events", "hashtag", "search", "pages", "policies", "help", "about"]);

export function platformFromValue(value: string): SocialPlatform | null {
  const p = String(value ?? "").toLowerCase();
  return (SOCIAL_PLATFORMS as string[]).includes(p) ? (p as SocialPlatform) : p === "twitter" ? "x" : null;
}

function build(platform: SocialPlatform, handle: string): SocialProfile {
  const url = platform === "instagram" ? `https://www.instagram.com/${handle}/`
    : platform === "tiktok" ? `https://www.tiktok.com/@${handle}`
    : platform === "facebook" ? `https://www.facebook.com/${handle}`
    : platform === "x" ? `https://x.com/${handle}`
    : `https://www.linkedin.com/company/${handle}/`;
  return { platform, handle, url };
}

export function normalizeSocial(raw: string, platformHint?: string | null): SocialResult {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, message: "Enter a handle or a profile URL" };
  if (value.length > 300 || /[\s<>"']/.test(value)) return { ok: false, message: "That does not look like a handle or profile URL" };
  const hint = platformHint ? platformFromValue(platformHint) : null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^(www\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(value)) {
    let url: URL;
    try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`); } catch { return { ok: false, message: "That profile URL is not valid" }; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, message: "Profile URLs must start with http(s)" };
    const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, "");
    const platform = HOSTS[host];
    if (!platform) return { ok: false, message: "Only Instagram, TikTok, Facebook, LinkedIn and X profile URLs are supported here. Put other sites in Website." };
    const parts = url.pathname.split("/").filter(Boolean);
    if (platform === "linkedin") {
      if (parts.length >= 2 && ["company", "in", "school", "showcase"].includes(parts[0].toLowerCase()) && /^[A-Za-z0-9._%-]{1,100}$/.test(parts[1]))
        return { ok: true, profile: { platform, handle: parts[1], url: `https://www.linkedin.com/${parts[0].toLowerCase()}/${parts[1]}/` } };
      return { ok: false, message: "Use the LinkedIn company or profile page URL (linkedin.com/company/… or /in/…)" };
    }
    if (platform === "facebook" && parts[0] === "profile.php") {
      const id = url.searchParams.get("id") ?? "";
      return /^\d{5,25}$/.test(id) ? { ok: true, profile: { platform, handle: id, url: `https://www.facebook.com/profile.php?id=${id}` } } : { ok: false, message: "That Facebook profile URL has no valid id" };
    }
    const first = (parts[0] ?? "").replace(/^@/, "");
    if (!first || RESERVED.has(first.toLowerCase()) || !HANDLE.test(first)) return { ok: false, message: `Could not find a profile name in that ${platform} URL — paste the profile page link` };
    return { ok: true, profile: build(platform, first) };
  }

  const handle = value.replace(/^@/, "");
  if (!HANDLE.test(handle)) return { ok: false, message: "Handles may only contain letters, numbers, dots and underscores" };
  if (!hint) return { ok: false, message: "Choose which platform this handle is on, or paste the full profile URL" };
  if (hint === "linkedin") return { ok: false, message: "Paste the full LinkedIn page URL — a bare LinkedIn handle can be a company or a person" };
  return { ok: true, profile: build(hint, handle) };
}

/** Stable identity used for deduplication: platform + lower-cased handle. */
export function socialKey(url: string): string | null {
  const r = normalizeSocial(url);
  return r.ok ? `${r.profile.platform}:${r.profile.handle.toLowerCase()}` : null;
}
