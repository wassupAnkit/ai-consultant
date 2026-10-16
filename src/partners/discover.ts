import type { Destination } from "../schemas/intent.schema";
import { hostOf } from "./registry";

/**
 * Pure helpers behind `bun run partners:discover`: parse the partner page's
 * per-country tab counts, filter out aggregator sites when guessing a
 * university's official website, and score a candidate homepage against the
 * institution's name. Kept I/O-free so they are unit-testable.
 */
export const COUNTRY_LABELS: Record<Destination, string[]> = {
  australia: ["Australia"],
  united_kingdom: ["United Kingdom", "UK"],
  canada: ["Canada"],
  new_zealand: ["New Zealand"],
  united_states: ["United States", "USA", "US"],
  germany: ["Germany"],
  ireland: ["Ireland"],
  netherlands: ["Netherlands"],
  malaysia: ["Malaysia"],
  uae: ["UAE", "United Arab Emirates", "Dubai"],
  thailand: ["Thailand"],
  other: [],
};

/** "…>Canada</span><span>23</span>…" → { canada: 23 }. Tolerant of markup; label and count must be within ~300 chars. */
export function parseTabCounts(html: string): Partial<Record<Destination, number>> {
  const text = html.replace(/\s+/g, " ");
  const out: Partial<Record<Destination, number>> = {};
  for (const [country, labels] of Object.entries(COUNTRY_LABELS) as [Destination, string[]][]) {
    for (const label of labels) {
      const re = new RegExp(`>\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*<[^>]*>(?:[^<]{0,40}<[^>]*>){0,6}\\s*\\(?\\s*(\\d{1,3})\\s*\\)?\\s*<`, "i");
      const m = text.match(re);
      if (m) {
        out[country] = Number(m[1]);
        break;
      }
    }
  }
  return out;
}

const AGGREGATOR_HOSTS = [
  "wikipedia.org",
  "wikidata.org",
  "topuniversities.com",
  "timeshighereducation.com",
  "usnews.com",
  "hotcoursesabroad.com",
  "idp.com",
  "studyportals.com",
  "mastersportal.com",
  "bachelorsportal.com",
  "shiksha.com",
  "collegedunia.com",
  "leverageedu.com",
  "yocket.com",
  "educations.com",
  "studyaustralia.gov.au",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "glassdoor.com",
  "indeed.com",
  "reddit.com",
  "quora.com",
  "experteducation.com",
];

export function isAggregatorHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return AGGREGATOR_HOSTS.some((a) => h === a || h.endsWith("." + a));
}

const STOP = new Set(["university", "college", "institute", "school", "of", "the", "and", "for", "in", "at", "de", "du", "des", "la", "le", "technology", "international", "campus", "australia", "canada", "uk", "usa"]);

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** 0–1 confidence that `host` (with page `title`) is the official site of `name`. */
export function scoreCandidate(name: string, host: string, title: string | null): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const h = host.toLowerCase().replace(/^www\./, "");
  if (isAggregatorHost(h)) return { score: 0, reasons: ["aggregator"] };
  const tokens = nameTokens(name);
  // Strip the public suffix only: "study.csu.edu.au" → "study.csu", "utoronto.ca" → "utoronto".
  const suffix = h.match(/\.(edu|ac|co|com|org|gov|net)(\.[a-z]{2})?$/);
  const hostBody = suffix ? h.slice(0, -suffix[0].length) : h.replace(/\.[a-z]{2,3}$/, "");
  const hostHits = tokens.filter((t) => hostBody.includes(t) || hostBody.includes(t.slice(0, 5)));
  if (hostHits.length) {
    // Every distinctive word of the name in the host is strong evidence on its own (utoronto.ca, monash.edu).
    score += hostHits.length === tokens.length ? 0.5 : Math.min(0.45, 0.25 * hostHits.length);
    reasons.push(`host matches ${hostHits.join(",")}`);
  }
  // Acronym from all significant words incl. "University" (Charles Sturt University → csu).
  const acronym = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !/^(of|the|and|for|in|at|de|du|des|la|le)$/.test(w))
    .map((w) => w[0])
    .join("");
  if (acronym.length >= 3 && hostBody.split(".").some((p) => p === acronym)) {
    score += 0.35;
    reasons.push(`acronym ${acronym}`);
  }
  if (/\.(edu|ac)\b|\.edu\.[a-z]{2}$|\.ac\.[a-z]{2}$/.test(h)) {
    score += 0.25;
    reasons.push("academic TLD");
  }
  if (title) {
    const titleTokens = new Set(nameTokens(title));
    const overlap = tokens.filter((t) => titleTokens.has(t));
    const ratio = tokens.length ? overlap.length / tokens.length : 0;
    if (ratio >= 0.5) {
      score += ratio >= 0.8 ? 0.35 : 0.25;
      reasons.push(`title matches ${overlap.join(",")}`);
    }
  }
  return { score: Math.min(1, Math.round(score * 100) / 100), reasons };
}

export interface DiscoveryRow {
  country: Destination;
  name: string;
  website: string | null;
  domains: string[];
  confidence: number;
  evidence: string[];
  status: "verified" | "review" | "missing";
}

/** Pick the best-scoring candidate URL for a name, or null. */
export function pickWebsite(name: string, candidates: { url: string; title: string | null }[]): { url: string; confidence: number; reasons: string[] } | null {
  let best: { url: string; confidence: number; reasons: string[] } | null = null;
  for (const c of candidates) {
    const host = hostOf(c.url);
    if (!host) continue;
    const { score, reasons } = scoreCandidate(name, host, c.title);
    if (!best || score > best.confidence) best = { url: `https://${host}`, confidence: score, reasons };
  }
  return best && best.confidence > 0 ? best : null;
}
