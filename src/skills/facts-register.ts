import { forcedResearchReason, wantsOfficialEvidence } from "../graph/freshness";
import type { RetrievedChunk } from "../retrieval/store";
import { DESTINATION_LABELS, type ContextFlag, type Destination, type PrimaryIntent } from "../schemas/intent.schema";
import { extractFigures } from "../verify/figures";
import { anchorOf, compactLinks, researchedOn } from "./market-guides";
// The destination facts registers (docs/facts/<slug>.md), shipped as runtime copies under data/
// like the market and compliance guides (the image copies data/ but not docs/).
// tests/facts-register.test.ts fails when a copy drifts from its docs/ original, or when a
// docs/facts file has no import here.
import australia from "../../data/facts/australia.md" with { type: "text" };
import canada from "../../data/facts/canada.md" with { type: "text" };
import new_zealand from "../../data/facts/new_zealand.md" with { type: "text" };
import scholarships from "../../data/facts/scholarships.md" with { type: "text" };
import united_kingdom from "../../data/facts/united_kingdom.md" with { type: "text" };
import united_states from "../../data/facts/united_states.md" with { type: "text" };

/**
 * Expert's facts registers as top-priority evidence. Each register is a dated table per topic
 * (fees, funds, work rights, post-study work…) whose rows carry the value, its effective date,
 * who it applies to, the official page and the date it was checked, plus a "Closed or replaced
 * programmes and rules" table of what no longer applies. A counsellor audit found Edge repeating
 * superseded rules and stale fees from indexed pages; for a rule- or figure-shaped question
 * (the freshness trigger in src/graph/freshness.ts) on a destination with a register, round 0
 * adds up to two excerpts: the Closed or replaced table first for visa, policy and onshore
 * questions (or any question that asks whether a rule still applies), and the topic table that
 * best matches the question. Each excerpt keeps the table header and the rows (and notes) that
 * match the question best, in register order, within 1,800 characters.
 */

/** Destination registers by destination slug, plus the cross-destination scholarships register. */
const MARKDOWN: Readonly<Record<string, string>> = { australia, canada, new_zealand, united_kingdom, united_states, scholarships };
/** The register that is not a destination's: used for scholarship_funding questions. */
export const SCHOLARSHIPS_SLUG = "scholarships";
export const FACTS_SLUGS: readonly string[] = Object.keys(MARKDOWN);

/** Every register's markdown by slug (the official-page ingest reads the cited source URLs from it). */
export function factsRegisterMarkdown(): Readonly<Record<string, string>> {
  return MARKDOWN;
}

/** Longest excerpt added as evidence (characters), as the guide excerpts. */
export const FACTS_REGISTER_EXCERPT_MAX = 1_800;
/** Most excerpts one research loop adds. */
export const MAX_FACTS_REGISTER_EXCERPTS = 2;

export interface FactRow {
  fact: string;
  value: string;
  effectiveFrom: string;
  appliesTo: string;
  source: string;
  checked: string;
  /**
   * The row carries a "… — verify" label ("(secondary — verify)", "(prior knowledge — verify)",
   * "(not verified — verify)", "(blocked — verify)"): not confirmed on an official page. Excerpts
   * keep the label text as written.
   */
  unverified: boolean;
  /** The row's markdown line as written. */
  line: string;
}

export interface FactsSection {
  title: string;
  /** GitHub-style anchor of the `## ` heading. */
  anchor: string;
  /** Column names of the section's table. */
  header: string[];
  /** The table's header and separator lines as written. */
  headerLines: [string, string];
  rows: FactRow[];
  /** "- " bullets under the section's "Notes" label (continuation lines joined). */
  notes: string[];
}

export interface FactsRegister {
  slug: string;
  /** "Australia" */
  label: string;
  /** YYYY-MM-DD from the header's "Checked …" line ("" when none). */
  checked: string;
  sections: FactsSection[];
}

const UNVERIFIED = /[—–-]+\s*verify\b/i;
const SEPARATOR = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** A register's `## ` sections that hold a table (the ones round 0 can quote). */
export function parseFactsRegister(slug: string, markdown: string): FactsRegister {
  const sections: FactsSection[] = [];
  for (const part of markdown.split(/^(?=## )/m)) {
    const heading = part.match(/^## (.+)$/m);
    if (!heading || part.indexOf(heading[0]) !== 0) continue;
    const lines = part.split("\n").slice(1);
    const start = lines.findIndex((l, i) => l.trim().startsWith("|") && SEPARATOR.test(lines[i + 1] ?? ""));
    if (start < 0) continue;
    const header = cells(lines[start]!);
    const rows: FactRow[] = [];
    let i = start + 2;
    for (; i < lines.length && lines[i]!.trim().startsWith("|"); i++) {
      const c = cells(lines[i]!);
      const line = lines[i]!.trim();
      rows.push({ fact: c[0] ?? "", value: c[1] ?? "", effectiveFrom: c[2] ?? "", appliesTo: c[3] ?? "", source: c[4] ?? "", checked: c[5] ?? "", unverified: UNVERIFIED.test(line), line });
    }
    const notes: string[] = [];
    let inNotes = false;
    for (const l of lines.slice(i)) {
      if (/^notes:?\s*$/i.test(l.trim())) inNotes = true;
      else if (inNotes && l.startsWith("- ")) notes.push(l.trimEnd());
      else if (inNotes && l.trim() && notes.length && /^\s+\S/.test(l)) notes[notes.length - 1] += ` ${l.trim()}`;
    }
    const title = heading[1]!.trim();
    sections.push({ title, anchor: anchorOf(title), header, headerLines: [lines[start]!.trim(), lines[start + 1]!.trim()], rows, notes });
  }
  const h1 = markdown.match(/^# (.+)$/m)?.[1] ?? slug;
  const label = DESTINATION_LABELS[slug as Destination] ?? h1.split(":")[0]!.trim();
  return { slug, label, checked: researchedOn(markdown, ""), sections };
}

const REGISTERS = new Map<string, FactsRegister>();

/** One register, parsed once and cached. */
export function factsRegister(slug: string): FactsRegister {
  let r = REGISTERS.get(slug);
  if (!r) {
    const md = MARKDOWN[slug];
    if (md === undefined) throw new Error(`no facts register for ${slug}`);
    r = parseFactsRegister(slug, md);
    REGISTERS.set(slug, r);
  }
  return r;
}

/** Whether a routed destination has its own register (the scholarships register is not one). */
export function hasFactsRegister(country: string): boolean {
  return country !== SCHOLARSHIPS_SLUG && Object.hasOwn(MARKDOWN, country);
}

// --- Matching a question to a section ---------------------------------------------------------

const CLOSED_SECTION = /^closed or replaced/i;
const REVIEW_SECTION = /^next review/i;

/** Topics whose answer must never rest on a closed or replaced rule: the Closed table goes first. */
const CLOSED_FIRST_TOPICS: ReadonlySet<PrimaryIntent> = new Set<PrimaryIntent>(["visa_process", "visa_risk_analysis", "onshore_support", "policy_change", "migration_pathway", "family_planning"]);
/** Wording that asks whether a rule still applies, whatever the topic. */
const CLOSED_CUE = /\b(?:still|replaced|closed|banned|abolished|scrapped|discontinued|no longer|any ?more|old rule|new rule|changed|ended)\b/i;

interface Concept {
  /** Message wording that asks about this. */
  cue: RegExp;
  /** Section titles (in any register) that answer it. */
  section: RegExp;
  /** Attributes (a fee, funds, hours…) pick the table; subjects (485, onshore, family…) only when no attribute is asked. */
  attribute: boolean;
}

const CONCEPTS: readonly Concept[] = [
  { attribute: true, cue: /\b(?:fees?|charges?|pric(?:e|es|ing)|vac|levy|levies|stac|surcharge)\b|(?<!living )\bcosts?\b/i, section: /\b(?:fees?|charges?|levy|pricing|price)\b/i },
  { attribute: true, cue: /\b(?:funds?|living costs?|financial|bank (?:balance|statement)s?|balance|sponsor(?:s|ship)?|show money|income|maintenance|gic|28[- ]day)\b/i, section: /\b(?:funds?|financial|living costs?|maintenance|gic|28-day)\b/i },
  { attribute: true, cue: /\bhours?\b|\bpart[- ]time\b|\bjobs?\b|\bwork (?:rights?|limits?|permission)\b|\bfortnight\b|\bcan (?:he|she|they|i|we|students?|a student) work\b/i, section: /\bwork rights?\b|\bworking\b|\bwork hours\b|\bwork while\b|^work\b|\bemployment\b/i },
  { attribute: true, cue: /\b(?:english|ielts|pte|toefl|duolingo|oet|cae|languagecert|language tests?)\b/i, section: /\benglish\b|\blanguage\b/i },
  { attribute: true, cue: /\b(?:insurance|oshc|ihs|health cover|health surcharge)\b/i, section: /\binsurance\b|\boshc\b|\bihs\b|\bhealth (?:cover|surcharge)\b/i },
  { attribute: true, cue: /\bprocessing\b|\bhow long\b|\bpriority\b|\bwaiting time\b/i, section: /\bprocessing\b|\bpriorit/i },
  { attribute: true, cue: /\brefunds?\b|\bwithdraw/i, section: /\brefunds?\b|\bwithdrawal\b/i },
  { attribute: true, cue: /\brefus(?:als?|ed|e)\b|\bappeals?\b|\breview rights?\b|\b(?:art|aat)\b|\breconsider/i, section: /\brefusals?\b|\breview rights?\b|\bappeals?\b/i },
  { attribute: true, cue: /\bmedicals?\b|\bhealth (?:exam|check)s?\b|\bbiometrics?\b|\bpolice (?:check|certificate|clearance)s?\b|\bcharacter\b/i, section: /\bhealth (?:exam|and character)|\bbiometrics?\b|\bcharacter\b/i },
  { attribute: false, cue: /\bpost[- ]study\b|\b485\b|\bpsw\b|\bpgwp\b|\bgraduate (?:route|visa|work)\b|\bopt\b|\bstay ?back\b|\bafter (?:graduat|finishing|completing)/i, section: /\bpost[- ]study\b|\bgraduat|\b485\b|\bpgwp\b|\bopt\b/i },
  { attribute: false, cue: /\bpal\b|\btal\b|\battestation\b|\bcap\b/i, section: /\battestation\b|\bpal\b/i },
  { attribute: false, cue: /\bsds\b|\bstudent direct stream\b/i, section: /\bsds\b|\bdirect stream\b/i },
  { attribute: false, cue: /\batas\b/i, section: /\batas\b/i },
  { attribute: false, cue: /\btb\b|\btuberculosis\b/i, section: /\btb\b/i },
  { attribute: false, cue: /\bcas\b|\bbca\b|\bsponsor (?:licen[cs]e|compliance)\b/i, section: /\bcas\b|\bbca\b|\bsponsor compliance\b/i },
  { attribute: false, cue: /\b214\s*\(?b\)?|\binterview\b|\bsocial media\b/i, section: /\b214\b|\binterview\b/i },
  { attribute: false, cue: /\bsevis\b|\bduration of status\b|\bd\/s\b|\bgrace period\b|\bstatus\b/i, section: /\bstatus\b|\bsevis\b/i },
  { attribute: false, cue: /\btravel ban\b|\bproclamation\b|\brestrict/i, section: /\btravel restrictions?\b|\bproclamation|\bvisa brake\b|\bnationality restrictions?\b/i },
  { attribute: false, cue: /\bonshore\b|\bswitch(?:ing)?\b|\binside (?:australia|the country)\b|\bin australia\b|\bchange (?:visa|course|provider)s?\b/i, section: /\bonshore\b|\bswitching\b/i },
  { attribute: false, cue: /\bpartners?\b|\bspouses?\b|\bdependa?nts?\b|\bdependents?\b|\bchild(?:ren)?\b|\bfamily\b|\bwife\b|\bhusband\b/i, section: /\bpartners?\b|\bfamily\b|\bdependa?nts?\b|\bchildren\b/i },
  { attribute: false, cue: /\bgenuine\b|\bgs\b|\bgte\b|\bstatement of purpose\b|\bsop\b/i, section: /\bgenuine\b/i },
  { attribute: false, cue: /\bconditions?\b|\b8202\b|\b8105\b|\b8533\b|\battendance\b/i, section: /\bconditions?\b/i },
  { attribute: false, cue: /\belicos\b|\benglish course\b/i, section: /\belicos\b/i },
  { attribute: false, cue: /\bgreen list\b|\bresidence\b|\bpermanent\b|\bpathways?\b/i, section: /\bgreen list\b|\bpathways?\b|\bresidence\b/i },
];

/** When the message names no attribute, the topic stands in for one. */
const TOPIC_HINTS: Partial<Record<PrimaryIntent, string>> = {
  financial_viability: "funds",
  work_survival: "work rights",
  migration_pathway: "post-study",
  family_planning: "partner family",
  onshore_support: "onshore",
};

/** Words too common in a register to rank a row or a title by. */
const STOPWORDS = new Set([
  "about", "after", "also", "and", "any", "are", "can", "could", "does", "for", "from", "have", "her", "his", "how", "into", "many", "much", "need", "needed", "needs", "now", "our", "she", "show", "student", "students", "that", "the", "their", "them", "they", "this", "visa", "visas", "what", "when", "where", "which", "who", "will", "with", "would", "you", "your",
  "scholarship", "scholarships",
  "australia", "australian", "zealand", "new", "canada", "canadian", "kingdom", "united", "states", "british",
]);

const stem = (w: string) => (/^\d+$/.test(w) || w.length < 5 ? w : w.replace(/ies$/, "y").replace(/(?:ing|ed|s)$/, ""));

/** Distinct, stemmed content words of a text (links reduced to their labels). */
function terms(text: string): Set<string> {
  const plain = text.replace(/\]\([^)]*\)/g, "]").replace(/https?:\/\/\S+/g, " ").toLowerCase();
  return new Set(
    plain
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !STOPWORDS.has(w))
      .map(stem),
  );
}

const overlap = (query: Set<string>, text: string) => {
  const t = terms(text);
  let n = 0;
  for (const q of query) if (t.has(q)) n++;
  return n;
};

/** The row's label (first cell) words the question uses, and their share of the label. */
function labelMatch(query: Set<string>, row: FactRow): { hits: number; coverage: number } {
  const label = terms(row.fact);
  let hits = 0;
  for (const w of label) if (query.has(w)) hits++;
  return { hits, coverage: label.size ? hits / label.size : 0 };
}

/**
 * The section of the row the question names outright (at least two of its label's words and
 * most of the label, e.g. "Access to Information Act request", "In-country transition"), best
 * match first. Keyword cues pick tables by topic; this catches the specific row a cue misses or
 * a fee table outranks.
 */
function namedRowSection(sections: readonly FactsSection[], query: Set<string>): FactsSection | undefined {
  let best: FactsSection | undefined;
  let bestScore = 0;
  for (const s of sections) {
    for (const r of s.rows) {
      const { hits, coverage } = labelMatch(query, r);
      if (hits < 2 || coverage < 0.6) continue;
      const score = hits + coverage + 0.5 * overlap(query, s.title);
      if (score > bestScore) {
        best = s;
        bestScore = score;
      }
    }
  }
  return best;
}

function sectionScore(s: FactsSection, conceptText: string, query: Set<string>): number {
  const attributes = CONCEPTS.filter((c) => c.attribute && c.cue.test(conceptText));
  const subjects = CONCEPTS.filter((c) => !c.attribute && c.cue.test(conceptText));
  const concept = 10 * attributes.filter((c) => c.section.test(s.title)).length + 4 * subjects.filter((c) => c.section.test(s.title)).length;
  if (!concept) return 0;
  const bestRow = Math.max(0, ...s.rows.map((r) => overlap(query, r.line)));
  return concept + overlap(query, s.title) + 0.5 * Math.min(bestRow, 3);
}

export interface FactsRegisterRequest {
  topic: PrimaryIntent;
  /** The consultant's message (with the classifier's restatement). */
  text: string;
  /** The routed destinations (a comparison branch passes its own only). */
  countries: readonly string[];
  flags?: readonly ContextFlag[];
}

/**
 * Up to two excerpts of the first routed destination's register for a rule- or figure-shaped
 * question (the freshness trigger): the Closed or replaced table first for visa, policy and
 * onshore topics or a still-true/replaced question, then the best-matching topic table (or the
 * two best when the Closed table is not due). None without a register or for other topics.
 */
export function factsRegisterExcerpts(req: FactsRegisterRequest): RetrievedChunk[] {
  if (req.topic === "scholarship_funding") return scholarshipExcerpts(req);
  const slug = req.countries.find(hasFactsRegister);
  if (!slug) return [];
  const intent = { primary_intent: req.topic, contextual_flags: [...(req.flags ?? [])], user_question: req.text };
  if (!wantsOfficialEvidence(intent, req.text)) return [];
  const register = factsRegister(slug);
  const query = terms(req.text);
  const hint = CONCEPTS.some((c) => c.attribute && c.cue.test(req.text)) ? "" : (TOPIC_HINTS[req.topic] ?? "");
  const conceptText = `${req.text}\n${hint}`;

  const closed = register.sections.find((s) => CLOSED_SECTION.test(s.title));
  const closedFirst = Boolean(closed) && (CLOSED_FIRST_TOPICS.has(req.topic) || CLOSED_CUE.test(req.text) || forcedResearchReason(intent, req.text) !== null);
  const topical = register.sections.filter((s) => !CLOSED_SECTION.test(s.title) && !REVIEW_SECTION.test(s.title));
  const ranked = topical
    .map((s, i) => ({ s, i, score: sectionScore(s, conceptText, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.s);
  // The named row's section leads the topic tables, as one extra excerpt, unless it already does.
  const named = namedRowSection(topical, query);
  const lead = named && ranked[0] !== named ? [named] : [];
  const chosen = [...(closedFirst ? [closed!] : []), ...lead, ...ranked.filter((s) => !lead.includes(s))];
  return chosen.slice(0, MAX_FACTS_REGISTER_EXCERPTS + lead.length).map((s) => factsChunk(register, s, query));
}

/** How the scholarships register's section titles name each destination ("Chevening (UK, FCDO)", "Fulbright (US)"). */
const SCHOLARSHIP_DESTINATIONS: Partial<Record<Destination, RegExp>> = {
  united_kingdom: /\bUK\b|\bChevening\b|\bCommonwealth\b|\bGREAT\b/,
  australia: /\bAustralia/,
  united_states: /\bUS\b|\bFulbright\b/,
  new_zealand: /\bNZ\b|\bNew Zealand\b|\bManaaki\b/,
  canada: /\bCanada\b/,
};

/**
 * Up to two excerpts of the scholarships register for a scholarship_funding question: the Closed
 * or replaced table first when the question asks whether a programme still runs, then the
 * programme sections that best match the question (title words, the routed destinations, best
 * row), else the eligibility matrix.
 */
function scholarshipExcerpts(req: FactsRegisterRequest): RetrievedChunk[] {
  if (!Object.hasOwn(MARKDOWN, SCHOLARSHIPS_SLUG)) return [];
  const register = factsRegister(SCHOLARSHIPS_SLUG);
  const query = terms(req.text);
  const closed = register.sections.find((s) => CLOSED_SECTION.test(s.title));
  const matrix = register.sections.find((s) => /\bmatrix\b|quick reference/i.test(s.title));
  const ranked = register.sections
    .filter((s) => s !== closed && s !== matrix && !REVIEW_SECTION.test(s.title))
    .map((s, i) => {
      const destination = req.countries.some((c) => SCHOLARSHIP_DESTINATIONS[c as Destination]?.test(s.title)) ? 4 : 0;
      const bestRow = Math.max(0, ...s.rows.map((r) => overlap(query, r.line)));
      return { s, i, named: overlap(query, s.title), score: 3 * overlap(query, s.title) + destination + 0.5 * Math.min(bestRow, 3) };
    })
    .filter((r) => r.named > 0 || r.score >= 4)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.s);
  const chosen = [...(closed && CLOSED_CUE.test(req.text) ? [closed] : []), ...(ranked.length ? ranked : matrix ? [matrix] : [])];
  return chosen.slice(0, MAX_FACTS_REGISTER_EXCERPTS).map((s) => factsChunk(register, s, query));
}

/** Bare URLs (the later registers' source column) → host, as `compactLinks` does for markdown links. */
const compactBareUrls = (text: string) =>
  text.replace(/(?<!\()https?:\/\/[^\s|)]+/g, (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  });
const compact = (text: string) => compactBareUrls(compactLinks(text));

/**
 * A section as evidence: its table header, then the rows and notes that share the most words
 * with the question (ties in register order) while they fit, rendered in register order, links
 * compacted to "label, host". Rows left out are counted on the last line.
 */
export function factsSectionExcerpt(section: FactsSection, query: Set<string>, max = FACTS_REGISTER_EXCERPT_MAX): string {
  const head = section.headerLines.join("\n");
  const items = [
    // A row the question names by its label outranks rows that only share more words.
    ...section.rows.map((r, i) => ({ note: false, i, text: compact(r.line), score: overlap(query, r.line) + 2 * labelMatch(query, r).hits })),
    ...section.notes.map((n, i) => ({ note: true, i, text: compact(n), score: overlap(query, n) })),
  ];
  const order = [...items].sort((a, b) => b.score - a.score || Number(a.note) - Number(b.note) || a.i - b.i);
  const budget = max - 48; // room for the "(N more rows …)" line
  let used = head.length;
  const picked = new Set<(typeof items)[number]>();
  for (const it of order) {
    const cost = it.text.length + 1 + (it.note && ![...picked].some((p) => p.note) ? "\n\nNotes".length : 0);
    if (used + cost > budget) continue;
    picked.add(it);
    used += cost;
  }
  const rows = items.filter((it) => !it.note && picked.has(it)).map((it) => it.text);
  const notes = items.filter((it) => it.note && picked.has(it)).map((it) => it.text);
  const omitted = section.rows.length - rows.length;
  return [
    [head, ...rows].join("\n"),
    notes.length ? `Notes\n${notes.join("\n")}` : "",
    omitted > 0 ? `(${omitted} more ${omitted === 1 ? "row" : "rows"} in this section not shown)` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Heading of the per-turn block for a question that names a register row (see namedRowInstruction). */
export const NAMED_ROW_HEADING = "# The question names a facts-register row";

/**
 * The register row this turn's evidence quotes and the question names (two or more of the row
 * label's words and most of the label), with the excerpt's citation number; the best match when
 * several do, and on a tie the row whose label the question contains word for word ("Child
 * visitor visa" over "Partner visitor visa"). Null for a question that names no row.
 */
export function namedEvidenceRow(question: string, evidence: readonly (Pick<RetrievedChunk, "source" | "section" | "content"> & { n: number })[]): { n: number; section: string; row: FactRow } | null {
  const query = terms(question);
  const said = question.toLowerCase();
  let best: { n: number; section: string; row: FactRow } | null = null;
  let bestScore = 0;
  for (const e of evidence) {
    if (!e.source.startsWith("facts-register:")) continue;
    const slug = e.source.slice("facts-register:".length);
    if (!FACTS_SLUGS.includes(slug)) continue;
    const section = factsRegister(slug).sections.find((s) => s.title === e.section);
    for (const row of section?.rows ?? []) {
      if (!e.content.includes(`| ${row.fact} |`)) continue;
      const { hits, coverage } = labelMatch(query, row);
      if (hits < 2 || coverage < 0.6) continue;
      const score = hits + coverage + (said.includes(row.fact.replace(/\*\*/g, "").toLowerCase()) ? 1 : 0);
      if (score <= bestScore) continue;
      best = { n: e.n, section: section!.title, row };
      bestScore = score;
    }
  }
  return best;
}

/**
 * Per-turn block for a named row: the row itself, its excerpt number, the figures in its value as a
 * checklist, and an instruction to state each. The general rule (4e) was not enough for GLM 4.7
 * Flash, which still gave the row's first figure only (golden facts 2026-10-12); a block naming
 * the row is followed, and a listed figure more reliably than "every figure".
 */
export function namedRowInstruction(named: { n: number; section: string; row: FactRow }): string {
  const figures = [...new Set(extractFigures(named.row.value).map((f) => f.text))];
  return [
    NAMED_ROW_HEADING,
    `The consultant is asking about this row of excerpt [${named.n}] (${named.section}):`,
    compact(named.row.line),
    figures.length ? `Its figures: ${figures.join("; ")}.` : "",
    `State every figure in that row${figures.length ? ", each one listed above" : ""}: each amount or rate and the variants it lists, each duration, time limit or window, each threshold or percentage, and any dated or announced change, each cited [${named.n}], even in a short answer. Lead with the figure the question asks for, and keep the row's effective date.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function factsChunk(register: FactsRegister, s: FactsSection, query: Set<string>): RetrievedChunk {
  return {
    id: `facts-register:${register.slug}#${s.anchor}`,
    // Not a web page: like `market-guide://` evidence, a stable key the UI shows by title.
    url: `facts-register://${register.slug}#${s.anchor}`,
    title: `Expert facts register — ${register.label}: ${s.title}`,
    section: s.title,
    docType: "facts_register",
    country: register.slug === SCHOLARSHIPS_SLUG ? null : register.slug,
    source: `facts-register:${register.slug}`,
    sourceKind: "upload",
    content: factsSectionExcerpt(s, query),
    score: 1,
    matchedBy: ["facts_register"],
    ...(register.checked ? { updatedAt: `${register.checked}T00:00:00.000Z` } : {}),
  };
}
