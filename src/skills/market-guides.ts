import type { RetrievedChunk } from "../retrieval/store";
import { COUNTRY_LABELS, extractDestinations, type RoutedDestination } from "../routing/countries";
import { MARKET_LABELS, MARKETS, type Market } from "../routing/markets";
import type { PrimaryIntent } from "../schemas/intent.schema";
// The cited source-market analyses (docs/markets/<slug>.md), shipped as runtime copies under data/
// because the image copies data/ but not docs/ (see the Dockerfile). tests/market-guides.test.ts
// fails when a copy drifts from its docs/ original.
import bangladesh from "../../data/markets/bangladesh.md" with { type: "text" };
import india from "../../data/markets/india.md" with { type: "text" };
import nepal from "../../data/markets/nepal.md" with { type: "text" };
import philippines from "../../data/markets/philippines.md" with { type: "text" };
import sri_lanka from "../../data/markets/sri_lanka.md" with { type: "text" };
import thailand from "../../data/markets/thailand.md" with { type: "text" };
import vietnam from "../../data/markets/vietnam.md" with { type: "text" };

/**
 * Expert's source-market guides as citable evidence. The market packs carry no facts (their prose
 * only says what to check), so an answer could not state a Nepal-side step — the NOC, Nepal
 * Rastra Bank's foreign-exchange rules, the police report, attestation — unless research happened
 * to retrieve it. With a market resolved, round 0 adds up to three dated excerpts of that market's
 * guide (`marketGuideExcerpts`), numbered by the collector like any other evidence.
 */

const MARKDOWN: Readonly<Record<Market, string>> = { nepal, india, bangladesh, vietnam, philippines, thailand, sri_lanka };

/** The research date, when a guide's header gives none with a day ("Researched October 2026"). */
export const MARKET_GUIDES_UPDATED = "2026-10-08";
/** Longest excerpt of a guide added as evidence (characters). */
export const MARKET_GUIDE_EXCERPT_MAX = 1_800;
/** Most excerpts one research loop adds. */
export const MAX_MARKET_GUIDE_EXCERPTS = 3;
/** Most routed destinations whose guidance block is added. */
const MAX_GUIDE_DESTINATIONS = 2;

/** The guide sections round 0 draws on, by their number in every file. */
const MONEY = 4;
const ORIGIN_STEPS = 5;
const DESTINATIONS = 6;

/** Topics a market guide excerpt helps; any other topic (greeting, caseload…) adds none. */
export const MARKET_GUIDE_TOPICS: ReadonlySet<PrimaryIntent> = new Set<PrimaryIntent>([
  "visa_process",
  "visa_risk_analysis",
  "document_preparation",
  "financial_viability",
  "application_process",
  "offer_enrolment",
  "policy_change",
  "onshore_support",
  "family_planning",
  "eligibility_check",
  "scholarship_funding",
  "migration_pathway",
  "comparative_decision",
]);
/** Finance topics lead with the Money section. */
const MONEY_TOPICS: ReadonlySet<PrimaryIntent> = new Set<PrimaryIntent>(["financial_viability", "scholarship_funding"]);
/** Visa, document and application topics lead with the origin-side steps, and end with Money when a slot is left. */
const ORIGIN_STEP_TOPICS: ReadonlySet<PrimaryIntent> = new Set<PrimaryIntent>(["visa_process", "visa_risk_analysis", "document_preparation", "application_process", "offer_enrolment", "policy_change"]);

export interface GuideSection {
  /** The heading's number ("## 5. Origin-side steps & documents" → 5). */
  number: number;
  title: string;
  /** GitHub-style heading anchor ("5-origin-side-steps--documents"). */
  anchor: string;
  /** The section's markdown without its heading. */
  body: string;
}

export interface MarketGuide {
  market: Market;
  /** YYYY-MM-DD the guide was researched. */
  updated: string;
  sections: GuideSection[];
  /** Section 6 split per destination: its table row(s) and its own block(s), in file order. */
  destinations: Partial<Record<RoutedDestination, string>>;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "Researched 8 October 2026" (or "Checked: 2026-10-08") in the header → "2026-10-08"; else `fallback`. Shared with the compliance guides and facts registers. */
export function researchedOn(markdown: string, fallback = MARKET_GUIDES_UPDATED): string {
  const m = markdown.slice(0, 600).match(/\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (20\d\d)\b/i);
  // The later facts registers write it ISO: "Checked: 2026-10-09."
  if (!m) return markdown.slice(0, 1_200).match(/\b(?:checked|researched|updated)\b:?\s*(20\d\d-\d\d-\d\d)\b/i)?.[1] ?? fallback;
  return `${m[3]}-${String(MONTHS.indexOf(m[2]!.toLowerCase()) + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

/** GitHub-style heading anchor ("5. Origin-side steps & documents" → "5-origin-side-steps--documents"). */
export const anchorOf = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

/** Split a guide into its numbered `## ` sections and section 6's per-destination blocks. */
export function parseMarketGuide(market: Market, markdown: string): MarketGuide {
  const sections = parseNumberedSections(markdown);
  const six = sections.find((s) => s.number === DESTINATIONS);
  return { market, updated: researchedOn(markdown), sections, destinations: six ? destinationBlocks(six.body) : {} };
}

/** A guide's numbered `## N. Title` sections, in file order; unnumbered ones ("## Sources") are skipped. */
export function parseNumberedSections(markdown: string): GuideSection[] {
  const sections: GuideSection[] = [];
  for (const part of markdown.split(/^(?=## )/m)) {
    const heading = part.match(/^## (\d+)\.\s*(.+)$/m);
    if (!heading || part.indexOf(heading[0]) !== 0) continue;
    sections.push({
      number: Number(heading[1]),
      title: heading[2]!.trim(),
      anchor: anchorOf(`${heading[1]}. ${heading[2]!.trim()}`),
      body: part.slice(heading[0].length).replace(/\n-{3,}\s*$/, "").trim(),
    });
  }
  return sections;
}

const plain = (s: string) => s.replace(/\*\*|__|\*/g, "").trim();

/**
 * Section 6 per destination. The guides write it three ways: `### Australia` sub-headings, a
 * bold lead line ("**Australia:**", "**UK notes**", "**USA.** Sri Lankans are…"), or a summary
 * table whose first cell names the destination. A block runs to the next heading; a heading that
 * names no destination ("**Alternatives.**", "Japan / Korea") ends the previous block and is
 * dropped; one naming two ("Germany / Ireland") goes to both. Table rows are rendered
 * "<Destination> — <column>: <cell>" so they read without the table.
 */
function destinationBlocks(body: string): Partial<Record<RoutedDestination, string>> {
  const lines = body.split("\n");
  const subHeadings = lines.some((l) => l.startsWith("### "));
  const out = new Map<RoutedDestination, string[]>();
  const push = (ds: readonly RoutedDestination[], line: string) => {
    for (const d of ds) out.set(d, [...(out.get(d) ?? []), line]);
  };
  let header: string[] | null = null;
  let current: RoutedDestination[] = [];
  for (const line of lines) {
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      if (!header) {
        header = cells.map(plain);
        continue;
      }
      const name = plain(cells[0] ?? "");
      push(extractDestinations(name), `${name} — ${cells.slice(1).map((c, i) => `${header![i + 1] ?? ""}: ${c}`.replace(/^: /, "")).join("; ")}`);
      current = [];
      continue;
    }
    header = null;
    const heading = subHeadings ? line.match(/^###\s+(.+)$/)?.[1] : line.match(/^\*\*([^*]+)\*\*/)?.[1];
    if (heading !== undefined) {
      current = extractDestinations(plain(heading));
      if (subHeadings) continue;
    }
    if (current.length) push(current, line);
  }
  return Object.fromEntries([...out].map(([d, ls]) => [d, ls.join("\n").replace(/\n{3,}/g, "\n\n").trim()]));
}

const GUIDES = new Map<Market, MarketGuide>();

/** One market's parsed guide (parsed once, then cached). */
export function marketGuide(market: Market): MarketGuide {
  let guide = GUIDES.get(market);
  if (!guide) {
    guide = parseMarketGuide(market, MARKDOWN[market]);
    GUIDES.set(market, guide);
  }
  return guide;
}

/** Every market's guide, in `MARKETS` order. */
export function allMarketGuides(): MarketGuide[] {
  return MARKETS.map(marketGuide);
}

/**
 * Markdown links → "text, host" (just the text when it already names the host): the guide's own
 * sourcing stays visible, at a fraction of the characters, so more of the substance fits.
 */
export function compactLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/g, (_, label: string, url: string) => {
    let host: string;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return label;
    }
    return label.toLowerCase().includes(host.toLowerCase()) ? label : `${label}, ${host}`;
  });
}

/** Detail lines dropped first when an excerpt is too long: nested list items and table rows. */
const DETAIL_LINE = /^(?:\s+[-*]\s|\|)/;
/** A list item that is only a bold label ("- **Medicals.**"): empty once its sub-points are dropped. */
const LABEL_ONLY = /^[-*]\s+\*\*[^*]+\*\*\s*$/;

/**
 * `text` cut to `max` characters: detail lines (nested bullets, table rows) are dropped from the
 * end first, so every top-level point survives with its first sub-points, and a label left
 * without sub-points goes too; then, if still too long, it is cut at a line (else word) boundary
 * and marked " …".
 */
export function trimExcerpt(text: string, max = MARKET_GUIDE_EXCERPT_MAX): string {
  if (text.length <= max) return text;
  let lines = text.split("\n");
  let length = text.length;
  for (let i = lines.length - 1; i >= 0 && length > max; i--) {
    if (!DETAIL_LINE.test(lines[i]!)) continue;
    length -= lines[i]!.length + 1;
    lines.splice(i, 1);
  }
  lines = lines.filter((l, i) => !LABEL_ONLY.test(l) || /^\s+[-*]\s/.test(lines[i + 1] ?? ""));
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  if (out.length <= max) return out;
  const head = out.slice(0, max - 2);
  const cut = head.lastIndexOf("\n") > max / 2 ? head.lastIndexOf("\n") : head.lastIndexOf(" ");
  return `${head.slice(0, cut > 0 ? cut : head.length).trimEnd()} …`;
}

export interface MarketGuideRequest {
  market: Market | null | undefined;
  topic: PrimaryIntent;
  /** The routed destinations (a comparison branch passes its own only). */
  countries: readonly string[];
}

/**
 * Up to three excerpts of the market's guide as round-0 evidence, in this order:
 *  - visa, document and application topics: section 5 (origin-side steps & documents), each
 *    routed destination's block from section 6 (at most two), then section 4 (money) if a slot is left;
 *  - finance topics: section 4, then the destination blocks;
 *  - the other topics in `MARKET_GUIDE_TOPICS`: the destination blocks only.
 * None without a market or for any other topic. Each is ≤ 1,800 characters, dated with the
 * guide's research date, and sourced "market-guide:<market>".
 */
export function marketGuideExcerpts(req: MarketGuideRequest): RetrievedChunk[] {
  if (!req.market || !MARKET_GUIDE_TOPICS.has(req.topic)) return [];
  const guide = marketGuide(req.market);
  const section = (n: number) => guide.sections.find((s) => s.number === n);
  const label = MARKET_LABELS[req.market];
  const sectionChunk = (n: number): RetrievedChunk | null => {
    const s = section(n);
    return s ? chunk(guide, { key: s.anchor, title: `Expert market guide — ${label}: ${s.title}`, section: `${s.number}. ${s.title}`, country: null, text: s.body }) : null;
  };
  const six = section(DESTINATIONS);
  const destinations = [...new Set(req.countries)]
    .filter((d): d is RoutedDestination => Boolean(guide.destinations[d as RoutedDestination]))
    .slice(0, MAX_GUIDE_DESTINATIONS)
    .map((d) => {
      const name = COUNTRY_LABELS[d];
      return chunk(guide, { key: `destinations-${d.replace(/_/g, "-")}`, title: `Expert market guide — ${label}: ${name} guidance`, section: `${six ? `${six.number}. ${six.title}` : "Destination guidance"} › ${name}`, country: d, text: guide.destinations[d]! });
    });
  const ordered = ORIGIN_STEP_TOPICS.has(req.topic)
    ? [sectionChunk(ORIGIN_STEPS), ...destinations, sectionChunk(MONEY)]
    : MONEY_TOPICS.has(req.topic)
      ? [sectionChunk(MONEY), ...destinations]
      : destinations;
  return ordered.filter((c): c is RetrievedChunk => c !== null).slice(0, MAX_MARKET_GUIDE_EXCERPTS);
}

function chunk(guide: MarketGuide, p: { key: string; title: string; section: string; country: string | null; text: string }): RetrievedChunk {
  return {
    id: `market-guide:${guide.market}#${p.key}`,
    // Not a web page: like `upload://` and `crm://` evidence, a stable key the UI shows by title.
    url: `market-guide://${guide.market}#${p.key}`,
    title: p.title,
    section: p.section,
    docType: "market_guide",
    country: p.country,
    source: `market-guide:${guide.market}`,
    sourceKind: "upload",
    content: trimExcerpt(compactLinks(p.text)),
    score: 1,
    matchedBy: ["market_guide"],
    updatedAt: `${guide.updated}T00:00:00.000Z`,
  };
}
