import type { PartnerRecord } from "../partners/registry";
import type { Destination } from "../schemas/intent.schema";

export interface CrawlSource {
  /** Stable identifier stored on every chunk (e.g. "experteducation.com", "partner:<slug>"). */
  name: string;
  seeds: string[];
  /** Only URLs matching one of these prefixes/regexes are crawled. */
  allow: RegExp[];
  deny?: RegExp[];
  maxPages: number;
  maxDepth: number;
  /** Country tag applied to every page from this source (partner sites). */
  country?: Destination | "global";
  /** Market (Expert Education office country) for experteducation.com sections. */
  market?: string;
  docType?: string;
  /** Registry slug for partner sources. */
  partnerSlug?: string;
  /** Sitemap URLs to seed the crawl from (in addition to link discovery). */
  sitemaps?: string[];
}

const SITE = "https://experteducation.com";

/** Expert Education market sites (Next.js app + WordPress sub-sites) and shared tools. */
export const MARKETS = ["nepal", "australia", "uk", "thailand", "india", "bangladesh", "vietnam", "philippines"] as const;

const COMMON_DENY = [
  /\/wp-admin\//,
  /\/wp-json\//,
  /\/feed\/?$/,
  /\/comments\//,
  /\/author\//,
  /\/tag\//,
  /\/page\/\d+/,
  /\?/,
  /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|css|js|xml)$/i,
  /\/(privacy-policy|cookie-policy|terms|code-of-conduct)/,
];

export function siteSources(): CrawlSource[] {
  const markets: CrawlSource[] = MARKETS.map((m) => ({
    name: "experteducation.com",
    market: m,
    seeds: [`${SITE}/${m}/`],
    allow: [new RegExp(`^${SITE.replace(/\./g, "\\.")}/${m}/`)],
    deny: COMMON_DENY,
    maxPages: 400,
    maxDepth: 4,
  }));
  const shared: CrawlSource = {
    name: "experteducation.com",
    market: "global",
    seeds: [`${SITE}/study-areas/`, `${SITE}/scholarship-matcher/`, `${SITE}/tool/cost-of-living-estimator/`, `${SITE}/tool/grade-converter/`, `${SITE}/contact-us/`],
    allow: [new RegExp(`^${SITE.replace(/\./g, "\\.")}/(study-areas|scholarship-matcher|tool|contact-us)/`)],
    deny: COMMON_DENY,
    maxPages: 60,
    maxDepth: 2,
  };
  return [...markets, shared];
}

export interface PartnerSeed {
  name: string;
  country: Destination;
  website: string | null;
  /** Path prefixes worth indexing (international students, courses, fees, scholarships). */
  paths?: string[];
  maxPages?: number;
  enabled?: boolean;
}

const PARTNER_DEFAULT_PATHS = [
  "/international",
  "/study",
  "/courses",
  "/course",
  "/programs",
  "/programmes",
  "/degrees",
  "/admissions",
  "/apply",
  "/scholarships",
  "/fees",
  "/tuition",
  "/future-students",
  "/prospective-students",
  "/student-life",
  "/accommodation",
];

/** Default page budget per partner site (course catalogs are large; env PARTNER_DEFAULT_MAX_PAGES overrides). */
export const PARTNER_DEFAULT_MAX_PAGES = 400;

const PARTNER_DENY = [...COMMON_DENY, /\/(news|events?|staff|people|research|alumni|media|search)\//i, /\/20\d\d\//];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Build crawl sources from partner-registry records. Every listed domain (and
 * any subdomain of it) is in scope, restricted to the program/admissions paths;
 * chunks are tagged `partner:<slug>` so a partner can be re-crawled or purged
 * on its own.
 */
export function partnerSources(records: PartnerRecord[], defaults: { maxPages?: number } = {}): CrawlSource[] {
  return records
    .filter((p) => p.enabled && p.website && p.domains.length)
    .map((p) => {
      const origin = new URL(p.website!).origin;
      const paths = p.programPaths ?? PARTNER_DEFAULT_PATHS;
      const hosts = `https?:\\/\\/(?:[a-z0-9-]+\\.)*(?:${p.domains.map(escapeRe).join("|")})`;
      return {
        name: `partner:${p.slug}`,
        partnerSlug: p.slug,
        seeds: [p.website!, ...paths.map((path) => origin + path)],
        allow: [new RegExp(`^${hosts}(?:${paths.map(escapeRe).join("|")})`, "i"), new RegExp(`^${hosts}\\/?$`, "i")],
        deny: PARTNER_DENY,
        maxPages: p.maxPages ?? defaults.maxPages ?? PARTNER_DEFAULT_MAX_PAGES,
        maxDepth: 3,
        country: p.country,
        docType: "partner_university",
        sitemaps: p.sitemaps,
      } satisfies CrawlSource;
    });
}

// ---------------------------------------------------------------------------
// URL → metadata
// ---------------------------------------------------------------------------
const COUNTRY_PATTERNS: [RegExp, Destination][] = [
  [/australia|du-hoc-uc|\/uc\b/i, "australia"],
  [/canada/i, "canada"],
  [/united-kingdom|study-in-(the-)?uk|du-hoc-anh|\/uk\/(?!$)/i, "united_kingdom"],
  [/united-states|study-in-(the-)?usa|du-hoc-my/i, "united_states"],
  [/new-?zealand|newzealand/i, "new_zealand"],
  [/germany/i, "germany"],
  [/ireland/i, "ireland"],
  [/netherlands|du-hoc-ha-lan/i, "netherlands"],
  [/malaysia/i, "malaysia"],
  [/uae|dubai/i, "uae"],
  [/thailand-study|study-in-thailand/i, "thailand"],
];

export function inferCountry(url: string, fallback?: Destination | "global"): Destination | "global" {
  const path = new URL(url).pathname;
  // Only destination/course pages carry a country; market sections do not ("/uk/" is the UK office site).
  const destinationish = /(destinations?|country|study-in|du-hoc|student-visa|visa-requirements)/i.test(path);
  if (destinationish) {
    for (const [re, c] of COUNTRY_PATTERNS) if (re.test(path)) return c;
  }
  return fallback ?? "global";
}

export function inferDocType(url: string, fallback = "page"): string {
  const p = new URL(url).pathname;
  if (/\/(destinations?|country)\//.test(p) || /study-in-|du-hoc-/.test(p)) return "destination";
  if (/\/study-areas\//.test(p)) return "study_area";
  if (/\/(services|dich-vu)\//.test(p)) return "service";
  if (/\/blogs?\//.test(p)) return "blog";
  if (/our-education-partners/.test(p)) return "partners";
  if (/\/about/.test(p) || /awards/.test(p) || /message-from-director/.test(p)) return "about";
  if (/\/contact/.test(p)) return "contact";
  if (/\/locations?\//.test(p)) return "location";
  if (/\/(tool|scholarship-matcher)\//.test(p)) return "tool";
  if (/\/teams\//.test(p)) return "team";
  if (/\/events?\//.test(p)) return "events";
  return fallback;
}

export function inferMarket(url: string): string | null {
  const seg = new URL(url).pathname.split("/").filter(Boolean)[0];
  return seg && (MARKETS as readonly string[]).includes(seg) ? seg : null;
}
