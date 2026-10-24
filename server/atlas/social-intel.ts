import { normalizeSocial, type SocialPlatform } from "../../src/services/scout/social-profiles";
import type { SocialAccess, SocialObservation } from "../../src/orchestrator/dossier-types";

/**
 * What Atlas can actually observe about a PUBLIC social profile page, kept strictly apart from inference and from what could
 * not be accessed. Social platforms mostly sit behind a login wall: then only the public description tags are readable, and
 * post history, visuals, per-post engagement and activity are unknown. Inaccessible never means absent or inactive.
 */


const COUNT = (label: string) => new RegExp(`([\\d][\\d.,]*\\s?[KkMmBb]?)\\s+${label}\\b`, "i");
const THEMES: Array<[string, RegExp]> = [
  ["events", /\b(events?|tickets?|conference|summit|meetup|party|festival)\b/i], ["food and drink", /\b(menu|restaurant|cafe|café|chop bar|catering|bakery|cocktail|brunch)\b/i],
  ["fashion and beauty", /\b(fashion|clothing|wear|style|beauty|salon|makeup|hair|skincare)\b/i], ["education and community", /\b(students?|school|university|association|alumni|campus|training|course|mentorship)\b/i],
  ["offers and promotions", /\b(discount|promo|offer|sale|giveaway|deal|% off)\b/i], ["photography and creative work", /\b(photograph|studio|video|film|design|creative|portrait|wedding|shoot)\b/i],
  ["technology", /\b(tech|software|app|digital|startup|ai)\b/i], ["health and fitness", /\b(health|fitness|gym|clinic|wellness|nutrition)\b/i],
  ["bookings and contact", /\b(book|booking|dm|whatsapp|call|order|reserve)\b/i],
];

export function parseSocialProfile(input: { url: string; fetched: boolean; loginWall?: boolean; failReason?: string; title?: string; metaText?: string; bodyText?: string; at: string }): SocialObservation {
  const norm = normalizeSocial(input.url);
  const platform = norm.ok ? norm.profile.platform : "other";
  const base: SocialObservation = { platform, url: input.url, handle: norm.ok ? norm.profile.handle : undefined, access: "not_checked", checkedAt: input.at, observed: [], inferred: [], inaccessible: [], themes: [] };
  const gaps = ["post history and what was published recently", "images and visual consistency", "per-post engagement (likes, comments, shares)", "posting frequency and the date of the last post"];
  if (!input.fetched) {
    return { ...base, access: input.failReason ? "unreachable" : "not_checked", reason: input.failReason, inaccessible: ["the profile itself", ...gaps], inferred: [] };
  }
  const text = `${input.metaText ?? ""} ${input.loginWall ? "" : input.bodyText ?? ""}`.replace(/\s+/g, " ").trim();
  const access: SocialAccess = input.loginWall ? (input.metaText ? "meta_only" : "login_wall") : "full_page";
  const out: SocialObservation = { ...base, access, title: input.title?.slice(0, 160) || undefined };
  if (access === "login_wall") return { ...out, inaccessible: ["the profile (the platform asks for a login)", ...gaps], reason: "login wall" };
  const grab = (label: string) => COUNT(label).exec(text)?.[1]?.trim();
  out.followers = grab("Followers"); out.following = grab("Following"); out.posts = grab("Posts"); out.likes = grab("Likes");
  const bio = /on (?:Instagram|TikTok|Facebook)\s*[:|]\s*["“]?([^"”]{8,300})/i.exec(input.metaText ?? "")?.[1]?.trim();
  if (bio) out.bio = bio;
  const when = input.at.slice(0, 10);
  const counts = [out.followers && `${out.followers} followers`, out.following && `following ${out.following}`, out.posts && `${out.posts} posts`, out.likes && `${out.likes} likes`].filter(Boolean);
  if (counts.length) out.observed.push(`The public description tags of the ${platform} profile reported ${counts.join(", ")} on ${when}.`);
  if (out.bio) out.observed.push(`The public bio reads: "${out.bio}"`);
  if (input.title) out.observed.push(`The page title is "${input.title.slice(0, 120)}".`);
  const themed = THEMES.filter(([, re]) => re.test(`${out.bio ?? ""} ${text.slice(0, 1500)}`)).map(([t]) => t).slice(0, 4);
  out.themes = themed;
  if (themed.length) out.inferred.push(`The readable text suggests the profile positions itself around: ${themed.join(", ")} (inferred from keywords in the description only, not from posts).`);
  out.inaccessible = access === "full_page" ? ["engagement per post and the date of the last post are not reliably readable from page text"] : ["the profile feed (login required)", ...gaps];
  if (!out.observed.length) out.inaccessible.unshift("the page returned no readable profile description");
  return out;
}

/** Platforms for which an account is already known (supplied by the operator, found in sources, or linked from the website). */
export function knownPlatforms(urls: Array<string | undefined | null>): Map<SocialPlatform, string> {
  const out = new Map<SocialPlatform, string>();
  for (const u of urls) { if (!u) continue; const r = normalizeSocial(u); if (r.ok && !out.has(r.profile.platform)) out.set(r.profile.platform, r.profile.url); }
  return out;
}

const PLATFORM_WORDS: Record<SocialPlatform, RegExp> = { instagram: /\binstagram\b|\big\b/i, tiktok: /\btiktok\b/i, facebook: /\bfacebook\b|\bfb\b/i, linkedin: /\blinkedin\b/i, x: /\b(twitter|x\.com)\b|\bon x\b/i };
const CREATE = /\b(create|set ?up|open|start|launch|register|establish|build)\b[^.]{0,40}\b(account|page|profile|presence|channel)\b/i;

/** A recommendation to create an account on a platform where one is already known contradicts the evidence. */
export function contradictsKnownAccount(text: string, known: Map<SocialPlatform, string>): SocialPlatform | null {
  if (!CREATE.test(text)) return null;
  for (const [p, re] of Object.entries(PLATFORM_WORDS) as Array<[SocialPlatform, RegExp]>) if (known.has(p) && re.test(text)) return p;
  return null;
}

export function socialContextBlock(obs: SocialObservation[], known: Map<SocialPlatform, string>): string {
  const lines = obs.map((o) => `- ${o.platform} ${o.url} — access: ${o.access}${o.reason ? ` (${o.reason})` : ""}\n    OBSERVED: ${o.observed.join(" ") || "nothing readable"}\n    INFERRED: ${o.inferred.join(" ") || "none"}\n    NOT ACCESSIBLE: ${o.inaccessible.join("; ") || "none noted"}`);
  const accounts = known.size ? `Accounts already known: ${[...known].map(([p, u]) => `${p} (${u})`).join(", ")}. Never recommend creating an account on these platforms.` : "No social account is known yet. Not finding one is NOT proof that none exists: check before recommending creating any account.";
  return `${accounts}\n${lines.join("\n") || "- no social profile was inspected"}\nRule: a profile that could not be read is UNKNOWN, never \"inactive\" or \"absent\".`;
}
