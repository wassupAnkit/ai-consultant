import type { RetrievedChunk } from "../retrieval/store";
import { extractDestinations } from "../routing/countries";
import { MARKET_LABELS, type Market } from "../routing/markets";
import type { PrimaryIntent } from "../schemas/intent.schema";
import { compactLinks, parseNumberedSections, researchedOn, trimExcerpt, type GuideSection } from "./market-guides";
// The cited compliance guides (docs/compliance/<slug>.md), shipped as runtime copies under data/
// like the market guides (the image copies data/ but not docs/). tests/compliance-guides.test.ts
// fails when a copy drifts from its docs/ original.
import australia from "../../data/compliance/australia.md" with { type: "text" };
import canada from "../../data/compliance/canada.md" with { type: "text" };
import new_zealand from "../../data/compliance/new_zealand.md" with { type: "text" };
import sourceMarkets from "../../data/compliance/source-markets.md" with { type: "text" };
import united_kingdom from "../../data/compliance/united_kingdom.md" with { type: "text" };
import united_states from "../../data/compliance/united_states.md" with { type: "text" };

/**
 * Expert's compliance guides as citable evidence. Nothing else in the knowledge base states an
 * agent's legal limits (Australia's ban on commission for onshore transfers, who may give
 * immigration advice, a source market's agency licensing), so an answer could coach a counsellor
 * into a breach. When a question touches them, round 0 adds up to two dated excerpts
 * (`complianceGuideExcerpts`): the routed destination's most relevant section and the origin
 * market's section of the source-markets guide.
 */

export const COMPLIANCE_DESTINATIONS = ["australia", "united_kingdom", "canada", "new_zealand", "united_states"] as const;
export type ComplianceDestination = (typeof COMPLIANCE_DESTINATIONS)[number];
export type ComplianceSlug = ComplianceDestination | "source-markets";
export const COMPLIANCE_SLUGS: readonly ComplianceSlug[] = [...COMPLIANCE_DESTINATIONS, "source-markets"];

const MARKDOWN: Readonly<Record<ComplianceSlug, string>> = { australia, united_kingdom, canada, new_zealand, united_states, "source-markets": sourceMarkets };
const LABELS: Readonly<Record<ComplianceSlug, string>> = {
  australia: "Australia",
  united_kingdom: "United Kingdom",
  canada: "Canada",
  new_zealand: "New Zealand",
  united_states: "United States",
  "source-markets": "Source markets",
};

/** The research date, when a guide's header gives none with a day. */
export const COMPLIANCE_GUIDES_UPDATED = "2026-10-09";
/** Most excerpts one research loop adds: one destination section, one source-market section. */
export const MAX_COMPLIANCE_EXCERPTS = 2;

export interface ComplianceSection extends GuideSection {
  /** From the `<!-- keywords: … -->` line under the heading (lowercase); the body excludes that line. */
  keywords: string[];
}

export interface ComplianceGuide {
  slug: ComplianceSlug;
  label: string;
  /** YYYY-MM-DD the guide was researched. */
  updated: string;
  sections: ComplianceSection[];
}

const KEYWORDS_LINE = /^<!--\s*keywords:\s*(.*?)\s*-->\s*$/im;

/** A compliance guide's numbered sections, each with its keywords line lifted out of the body. */
export function parseComplianceGuide(slug: ComplianceSlug, markdown: string): ComplianceGuide {
  const sections = parseNumberedSections(markdown).map((s): ComplianceSection => {
    const m = s.body.match(KEYWORDS_LINE);
    const keywords = m ? m[1]!.split(",").map((k) => normalize(k)).filter(Boolean) : [];
    return { ...s, keywords, body: m ? s.body.replace(m[0], "").trim() : s.body };
  });
  return { slug, label: LABELS[slug], updated: researchedOn(markdown, COMPLIANCE_GUIDES_UPDATED), sections };
}

const GUIDES = new Map<ComplianceSlug, ComplianceGuide>();

/** One guide, parsed once and cached. */
export function complianceGuide(slug: ComplianceSlug): ComplianceGuide {
  let guide = GUIDES.get(slug);
  if (!guide) {
    guide = parseComplianceGuide(slug, MARKDOWN[slug]);
    GUIDES.set(slug, guide);
  }
  return guide;
}

/** Lowercase, punctuation to spaces, single-spaced: "OMARA's MARN-check" → "omara s marn check". */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// --- When a question is about compliance ------------------------------------------------------

/**
 * Message terms that make a question a compliance one whatever its topic: commission (not a body
 * like the "Commission on Higher Education" or "University Grants Commission"), a provider
 * transfer (not a money, credit or bank transfer), a release letter, agent obligations, migration
 * or immigration advice, the regulators and registers, ethics, complaints.
 */
const COMPLIANCE_TERMS =
  /(?<!\bgrants\s)\bcommissions?\b(?!\s+on\b)|(?<!\b(?:money|funds?|credit|wire|bank|telegraphic|online|remittance)\s)\btransfer(?:s|red|ring)?\b|\brelease letters?\b|\bagent(?:'s|s'?)? (?:obligations?|duties|code|conduct|rules|responsibilit(?:y|ies))\b|\b(?:migration|immigration) (?:advice|assistance|adviser|advisor|agent)s?\b|\b(?:o?mara|marn|oisc|cicc|rcic|iaa)\b|\bethic(?:s|al)\b|\bcomplain(?:t|ts|ed|ing)?\b/i;

/** An onshore question with a provider-change angle (moving college, a new provider). */
const PROVIDER_CHANGE = /\b(?:chang|switch|mov)(?:e|es|ed|ing)?\b[^.?!\n]{0,40}\b(?:provider|college|universit(?:y|ies)|institution|school|course)s?\b|\b(?:new|another|different) (?:provider|college|university|institution)\b/i;

export interface ComplianceTrigger {
  topic: PrimaryIntent;
  /** The consultant's message (with the classifier's restatement). */
  text: string;
}

/** Whether a turn's question touches an agent's legal or ethical limits. */
export function isComplianceQuestion({ topic, text }: ComplianceTrigger): boolean {
  if (topic === "compliance_ethics") return true;
  if (COMPLIANCE_TERMS.test(text)) return true;
  return topic === "onshore_support" && PROVIDER_CHANGE.test(text);
}

/** Regulator and process names that point at one destination when the route names none. */
const DESTINATION_HINTS: readonly [ComplianceDestination, RegExp][] = [
  ["australia", /\b(?:o?mara|marn|esos|national code|prisms|teqsa|asqa|coe|subclass 500|485|overseas students ombudsman)\b/i],
  ["united_kingdom", /\b(?:oisc|immigration advice authority|ukvi|cas|bca|basic compliance assessment|graduate route)\b/i],
  ["canada", /\b(?:cicc|rcic|irpa|ircc|dli|pal|pgwp|study permit)\b/i],
  ["new_zealand", /\b(?:iaa|immigration advisers authority|nzqa|inz|immigration new zealand)\b/i],
  ["united_states", /\b(?:f-?1|sevis|i-?20|ds-?160|airc|nacac)\b/i],
];

/** The first routed destination with a compliance guide, else the one the message's regulator terms name. */
export function complianceDestination(countries: readonly string[], text: string): ComplianceDestination | null {
  const routed = countries.find((c): c is ComplianceDestination => (COMPLIANCE_DESTINATIONS as readonly string[]).includes(c));
  if (routed) return routed;
  return DESTINATION_HINTS.find(([, re]) => re.test(text))?.[0] ?? null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The section whose keywords best match the text: each keyword found (as whole words, plural
 * allowed) scores its word count, so "onshore transfer" outweighs "transfer". Ties go to the
 * earlier section; no match at all → section 1 (each guide's bottom line).
 */
export function bestComplianceSection(guide: ComplianceGuide, text: string): ComplianceSection | null {
  const haystack = ` ${normalize(text)} `;
  let best: ComplianceSection | null = null;
  let bestScore = 0;
  for (const s of guide.sections) {
    const score = keywordScore(s, haystack);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best ?? guide.sections[0] ?? null;
}

/** Word count of every keyword found in the normalised, space-padded text (plural allowed). */
function keywordScore(s: ComplianceSection, haystack: string): number {
  return s.keywords.reduce((sum, k) => (new RegExp(` ${escape(k)}(?:s|es)? `).test(haystack) ? sum + k.split(" ").length : sum), 0);
}

/** Query words too common to rank a section by. */
const STOPWORDS = new Set(["about", "after", "agent", "agents", "also", "before", "case", "could", "does", "from", "have", "student", "students", "that", "their", "them", "there", "they", "this", "what", "when", "where", "which", "will", "with", "would", "your"]);

export interface RankedComplianceSection {
  guide: ComplianceGuide;
  section: ComplianceSection;
  score: number;
}

/**
 * Sections of the given guides ranked for a free-text query (the research model's
 * `search_compliance_guides`): each keyword phrase found scores 3 per word, as in round 0, and
 * each distinct query word of four or more letters scores 2 in the section title and 1 in its
 * body. Sections that score nothing are left out; ties keep guide, then file, order. Without
 * `slugs`, a query naming destinations (or their regulators) searches only those guides and the
 * source-markets one, so "immigration advice in the UK" cannot land on Canada's s.91.
 */
export function searchComplianceGuides(query: string, slugs: readonly ComplianceSlug[] = guidesNamedIn(query)): RankedComplianceSection[] {
  const haystack = ` ${normalize(query)} `;
  const words = [...new Set(normalize(query).split(" "))].filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  const ranked: RankedComplianceSection[] = [];
  for (const slug of slugs) {
    const guide = complianceGuide(slug);
    for (const section of guide.sections) {
      const title = ` ${normalize(section.title)} `;
      const body = ` ${normalize(section.body)} `;
      const score = 3 * keywordScore(section, haystack) + words.reduce((sum, w) => sum + (title.includes(` ${w}`) ? 2 : 0) + (body.includes(` ${w}`) ? 1 : 0), 0);
      if (score > 0) ranked.push({ guide, section, score });
    }
  }
  return ranked.sort((a, b) => b.score - a.score);
}

/** The destination guides a text names (by country or regulator) plus source-markets; every guide when it names none. */
export function guidesNamedIn(text: string): ComplianceSlug[] {
  const named = new Set<ComplianceDestination>(extractDestinations(text).filter((d): d is ComplianceDestination => (COMPLIANCE_DESTINATIONS as readonly string[]).includes(d)));
  for (const [d, re] of DESTINATION_HINTS) if (re.test(text)) named.add(d);
  return named.size ? [...COMPLIANCE_DESTINATIONS.filter((d) => named.has(d)), "source-markets"] : [...COMPLIANCE_SLUGS];
}

/** One section as evidence, by guide and section number (null when the guide has no such section). */
export function complianceSectionExcerpt(slug: ComplianceSlug, number: number): RetrievedChunk | null {
  const guide = complianceGuide(slug);
  const section = guide.sections.find((s) => s.number === number);
  return section ? complianceChunk(guide, section) : null;
}

/** Every guide's numbered section titles, one line per guide, for the research tool's description. */
export function complianceGuidesContents(): string {
  return COMPLIANCE_SLUGS.map((slug) => `${slug}: ${complianceGuide(slug).sections.map((s) => `${s.number} ${s.title}`).join("; ")}`).join("\n");
}

/** The source-markets section titled with the market's name ("## 1. Nepal"). */
export function sourceMarketSection(market: Market): ComplianceSection | null {
  const label = MARKET_LABELS[market].toLowerCase();
  return complianceGuide("source-markets").sections.find((s) => s.title.toLowerCase() === label) ?? null;
}

export interface ComplianceGuideRequest extends ComplianceTrigger {
  /** The routed destinations (a comparison branch passes its own only). */
  countries: readonly string[];
  /** The routed source market, if any. */
  origin: Market | null | undefined;
}

/**
 * Up to two excerpts for a compliance question: the destination guide's best-matching section,
 * then the origin market's section of the source-markets guide. None when the question is not a
 * compliance one. Each is ≤ 1,800 characters, dated with the guide's research date, and sourced
 * "compliance-guide:<slug>".
 */
export function complianceGuideExcerpts(req: ComplianceGuideRequest): RetrievedChunk[] {
  if (!isComplianceQuestion(req)) return [];
  const out: RetrievedChunk[] = [];
  const destination = complianceDestination(req.countries, req.text);
  if (destination) {
    const guide = complianceGuide(destination);
    const section = bestComplianceSection(guide, req.text);
    if (section) out.push(complianceChunk(guide, section));
  }
  if (req.origin) {
    const section = sourceMarketSection(req.origin);
    if (section) out.push(complianceChunk(complianceGuide("source-markets"), section));
  }
  return out.slice(0, MAX_COMPLIANCE_EXCERPTS);
}

/** A section as round-0 or tool evidence; a destination guide's carries that country. */
export function complianceChunk(guide: ComplianceGuide, s: ComplianceSection): RetrievedChunk {
  const country = guide.slug === "source-markets" ? null : guide.slug;
  return {
    id: `compliance-guide:${guide.slug}#${s.anchor}`,
    // Not a web page: like `market-guide://` evidence, a stable key the UI shows by title.
    url: `compliance-guide://${guide.slug}#${s.anchor}`,
    title: `Expert compliance guide — ${guide.label}: ${s.title}`,
    section: `${s.number}. ${s.title}`,
    docType: "compliance_guide",
    country,
    source: `compliance-guide:${guide.slug}`,
    sourceKind: "upload",
    content: trimExcerpt(compactLinks(s.body)),
    score: 1,
    matchedBy: ["compliance_guide"],
    updatedAt: `${guide.updated}T00:00:00.000Z`,
  };
}
