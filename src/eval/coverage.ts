/**
 * Pure helpers for the answer-coverage eval (scripts/eval-coverage.ts): dataset parsing and
 * validation, the LLM-judge prompt and its JSON schema, per-row scoring, aggregation by
 * country / intent / cell (and by the student's origin market, for rows that name one),
 * percentiles and the A/B compare table. No I/O, no models: the
 * runner does those, and tests/eval-coverage.test.ts covers everything here.
 */
import { CASE_STAGES } from "../classify/jev";
import { isMarket, type CounsellorRegion } from "../routing/markets";
import { DESTINATIONS, PRIMARY_INTENTS, TASKS, type PrimaryIntent } from "../schemas/intent.schema";

/** The five pack destinations and the short names `--countries` accepts for them. */
export const COUNTRY_ALIASES: Record<string, string> = {
  au: "australia",
  uk: "united_kingdom",
  gb: "united_kingdom",
  ca: "canada",
  us: "united_states",
  nz: "new_zealand",
};
export const EVAL_COUNTRIES = ["australia", "united_kingdom", "canada", "united_states", "new_zealand"] as const;
export const EVAL_INTENTS = ["visa_process", "financial_viability", "document_preparation", "offer_enrolment", "migration_pathway", "policy_change"] as const satisfies readonly PrimaryIntent[];

export interface CoverageRow {
  id: string;
  /** The question as a consultant would type it. */
  text: string;
  /** Destination slugs the question is about (two or more for a comparison). */
  countries: string[];
  intent: PrimaryIntent;
  /** Set on comparison rows ("compare"). */
  task?: string;
  stage?: string;
  /** Catalog ids (docs/data-model/catalog.csv) a complete answer must address. */
  mustCover: string[];
  /** Domains a good answer cites for visa / policy items (from the packs' officialSources). */
  officialDomains?: string[];
  /** Why some mustCover ids sit outside the generated checklist. */
  note?: string;
  /** The student's source market (src/routing/markets MARKETS) the route should find; absent on rows written before origins. */
  origin?: string;
}

export const isComparison = (row: Pick<CoverageRow, "countries" | "task">) => row.countries.length > 1 || row.task === "compare";

/** `country × intent` for single-country rows, `comparison` otherwise. */
export function cellKey(row: Pick<CoverageRow, "countries" | "task" | "intent">): string {
  return isComparison(row) ? "comparison" : `${row.countries[0]}×${row.intent}`;
}

export function plannedCells(): string[] {
  return EVAL_COUNTRIES.flatMap((c) => EVAL_INTENTS.map((i) => `${c}×${i}`));
}

export function resolveCountry(name: string): string {
  const k = name.trim().toLowerCase();
  return COUNTRY_ALIASES[k] ?? k;
}

/** JSONL → rows; blank lines and `#` comments skipped. Throws with the line number on bad JSON. */
export function parseDataset(text: string): CoverageRow[] {
  const rows: CoverageRow[] = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim() || line.trimStart().startsWith("#")) return;
    try {
      rows.push(JSON.parse(line) as CoverageRow);
    } catch (err) {
      throw new Error(`coverage.jsonl line ${i + 1}: ${(err as Error).message}`);
    }
  });
  return rows;
}

export interface DatasetContext {
  /** Every id in docs/data-model/catalog.csv. */
  catalogIds: Set<string>;
  /** CHECKLISTS from src/skills/checklists.generated.ts (country → intent → items). */
  checklists: Record<string, Partial<Record<string, { id: string }[]>>>;
  /** MARKET_CHECKLISTS (market → intent → items); a row's origin checklist counts as in-checklist. */
  marketChecklists?: Record<string, Partial<Record<string, { id: string }[]>>>;
  /** Pack official domains per country (src/skills/packs). */
  packDomains: Record<string, string[]>;
}

/**
 * Ids of `row.mustCover` that are in neither the generated checklist of any of its countries for its
 * intent nor, when the row names an origin, that market's checklist for the intent.
 */
export function outsideChecklist(
  row: Pick<CoverageRow, "countries" | "intent" | "mustCover" | "origin">,
  checklists: DatasetContext["checklists"],
  marketChecklists?: DatasetContext["marketChecklists"],
): string[] {
  const inMarket = (id: string) => Boolean(row.origin && marketChecklists?.[row.origin]?.[row.intent]?.some((item) => item.id === id));
  return row.mustCover.filter((id) => !row.countries.some((c) => checklists[c]?.[row.intent]?.some((item) => item.id === id)) && !inMarket(id));
}

/** Every problem with the dataset, one line each; empty when it is valid. */
export function validateDataset(rows: CoverageRow[], ctx: DatasetContext): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const destinations = new Set<string>(DESTINATIONS);
  const intents = new Set<string>(PRIMARY_INTENTS);
  const stages = new Set<string>(CASE_STAGES);
  const tasks = new Set<string>(TASKS);
  for (const r of rows) {
    const at = r.id ?? "(no id)";
    if (!r.id) errors.push(`${at}: missing id`);
    else if (seen.has(r.id)) errors.push(`${at}: duplicate id`);
    seen.add(r.id);
    if (!r.text?.trim()) errors.push(`${at}: empty text`);
    if (!Array.isArray(r.countries) || !r.countries.length) errors.push(`${at}: no countries`);
    for (const c of r.countries ?? []) if (!destinations.has(c)) errors.push(`${at}: unknown country ${c}`);
    if (!intents.has(r.intent)) errors.push(`${at}: unknown intent ${r.intent}`);
    if (r.stage !== undefined && !stages.has(r.stage)) errors.push(`${at}: unknown stage ${r.stage}`);
    if (r.task !== undefined && !tasks.has(r.task)) errors.push(`${at}: unknown task ${r.task}`);
    if (r.origin !== undefined && !isMarket(r.origin)) errors.push(`${at}: unknown origin ${r.origin}`);
    if (!Array.isArray(r.mustCover) || r.mustCover.length < 4 || r.mustCover.length > 6) errors.push(`${at}: mustCover needs 4-6 ids`);
    if (new Set(r.mustCover).size !== r.mustCover?.length) errors.push(`${at}: duplicate mustCover id`);
    for (const id of r.mustCover ?? []) if (!ctx.catalogIds.has(id)) errors.push(`${at}: ${id} is not in the catalog`);
    const outside = outsideChecklist(r, ctx.checklists, ctx.marketChecklists);
    if (outside.length && !r.note) errors.push(`${at}: ${outside.join(", ")} outside the generated checklist but no note`);
    if (!outside.length && r.note) errors.push(`${at}: note set but every id is in the checklist`);
    const allowed = new Set(r.countries.flatMap((c) => ctx.packDomains[c] ?? []));
    for (const d of r.officialDomains ?? []) if (!allowed.has(d)) errors.push(`${at}: official domain ${d} is not a pack source for ${r.countries.join("/")}`);
    if (isComparison(r) && r.countries.length < 2) errors.push(`${at}: comparison with fewer than two countries`);
  }
  return errors;
}

// --- Judge -----------------------------------------------------------------

export interface EvidenceRef {
  n: number;
  title: string;
  url: string;
  live: boolean;
  /** Full text; the judge sees the first EVIDENCE_PREVIEW_CHARS. */
  content: string;
}

export const EVIDENCE_PREVIEW_CHARS = 300;
/** More evidence than this is cut from the judge prompt (citations past it are judged unsupported). */
export const JUDGE_MAX_EVIDENCE = 40;

export interface ChecklistRef {
  id: string;
  label: string;
}

export const JUDGE_SYSTEM = `You grade one answer written by an internal assistant for study-abroad and visa consultants.
For EACH required item decide, strictly from the answer text:
- covered: the answer states something specific and relevant about the item for this question (a figure, a rule, a named requirement or a clear "yes/no + why"). A passing mention or a generic "check the website" is NOT covered.
- cited: covered AND the sentence(s) covering it carry a [n] citation whose evidence entry (title/url/excerpt below) plausibly supports that statement. A citation to an unrelated or missing number is NOT cited.
- honestGap: NOT covered, but the answer explicitly says it could not find or confirm this item (e.g. "Not in the knowledge base", "I couldn't confirm the current fee").
Never reward length. Never use your own knowledge to fill gaps. Return one verdict per item id, in the given order.`;

/** Gemini `responseJsonSchema` for the judge's verdicts. */
export const JUDGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          covered: { type: "boolean" },
          cited: { type: "boolean" },
          honestGap: { type: "boolean" },
        },
        required: ["id", "covered", "cited", "honestGap"],
      },
    },
  },
  required: ["items"],
};

export function buildJudgePrompt(question: string, answer: string, evidence: EvidenceRef[], items: ChecklistRef[]): string {
  const ev = evidence.slice(0, JUDGE_MAX_EVIDENCE).map((e) => `[${e.n}] ${e.title} — ${e.url}${e.live ? " (live)" : ""}\n    ${e.content.replace(/\s+/g, " ").trim().slice(0, EVIDENCE_PREVIEW_CHARS)}`);
  return [
    `# Question\n${question}`,
    `# Answer\n${answer.trim() || "(empty answer)"}`,
    `# Evidence (numbered as the answer cites it)\n${ev.length ? ev.join("\n") : "(none)"}`,
    `# Required items\n${items.map((i) => `- ${i.id}: ${i.label}`).join("\n")}`,
  ].join("\n\n");
}

export interface ItemVerdict {
  id: string;
  label: string;
  /** In the generated checklist for the row's country/intent (what packs inject). */
  inChecklist: boolean;
  covered: boolean;
  cited: boolean;
  honestGap: boolean;
}

/**
 * The judge's JSON → one verdict per required item, in the row's order. Missing or malformed
 * entries count as not covered; `cited` implies `covered`; `honestGap` excludes `covered`.
 */
export function normalizeVerdicts(json: unknown, items: (ChecklistRef & { inChecklist: boolean })[]): ItemVerdict[] {
  const raw = (json as { items?: unknown })?.items;
  const byId = new Map<string, Record<string, unknown>>();
  if (Array.isArray(raw)) for (const v of raw) if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") byId.set((v as { id: string }).id.trim(), v as Record<string, unknown>);
  return items.map((it) => {
    const v = byId.get(it.id);
    const covered = v?.covered === true;
    return { id: it.id, label: it.label, inChecklist: it.inChecklist, covered, cited: covered && v?.cited === true, honestGap: !covered && v?.honestGap === true };
  });
}

// --- Citations & official sources ------------------------------------------

/** Distinct [n] numbers in the answer, in first-use order. */
export function citationsIn(answer: string): number[] {
  const seen: number[] = [];
  for (const m of answer.matchAll(/\[(\d{1,3})\]/g)) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** True when the url's host is one of `domains` or a subdomain of one. */
export function onDomains(url: string, domains: readonly string[]): boolean {
  const host = hostOf(url);
  return Boolean(host && domains.some((d) => host === d || host.endsWith(`.${d}`)));
}

/** Any cited evidence item on an official domain (deterministic; no judge needed). */
export function officialCited(answer: string, evidence: Pick<EvidenceRef, "n" | "url">[], domains: readonly string[]): boolean {
  const cited = new Set(citationsIn(answer));
  return evidence.some((e) => cited.has(e.n) && onDomains(e.url, domains));
}

// --- Scoring ---------------------------------------------------------------

export interface RowScores {
  coverage: number;
  citedCoverage: number;
  honesty: number;
  /** Coverage of the items the generated checklist holds / does not hold (null when the row has none). */
  inChecklistCoverage: number | null;
  offChecklistCoverage: number | null;
  /** 1/0 when the row has officialDomains, else null. */
  official: number | null;
}

export function scoreRow(verdicts: ItemVerdict[], official: boolean | null): RowScores {
  const total = verdicts.length || 1;
  const frac = (xs: ItemVerdict[], ok: (v: ItemVerdict) => boolean) => (xs.length ? xs.filter(ok).length / xs.length : null);
  return {
    coverage: verdicts.filter((v) => v.covered).length / total,
    citedCoverage: verdicts.filter((v) => v.covered && v.cited).length / total,
    honesty: verdicts.filter((v) => v.covered || v.honestGap).length / total,
    inChecklistCoverage: frac(verdicts.filter((v) => v.inChecklist), (v) => v.covered),
    offChecklistCoverage: frac(verdicts.filter((v) => !v.inChecklist), (v) => v.covered),
    official: official === null ? null : official ? 1 : 0,
  };
}

export interface LlmTotals {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  calls: number;
  researchCalls: number;
  answerModel: string | null;
  researchModel: string | null;
  classifierModel: string | null;
  usedFallback: boolean;
}

/** One row's outcome, as written to the run file. */
export interface RowResult {
  id: string;
  countries: string[];
  intent: string;
  stage?: string;
  cell: string;
  comparison: boolean;
  ok: boolean;
  error?: string;
  latencyMs: number;
  answer?: string;
  /** The row's expected origin market, when it names one. */
  origin?: string;
  /** `originSource`: the routing layer that supplied the origin (absent in run files written before it was recorded). */
  route?: { countries: string[]; mode: string; topic?: string; stage?: string; origin?: string | null; originSource?: string | null } | null;
  /** Route countries equal the row's countries (as sets) and, when the row names an origin, the route's origin is it. */
  routeMatch?: boolean;
  /** The route's origin equals the row's (only on rows that name one). */
  originMatch?: boolean;
  classified?: { intent: string; task: string; needsResearch: boolean } | null;
  evidence?: { n: number; title: string; url: string; live: boolean; kind?: string }[];
  citations?: number[];
  /** [n] in the answer with no matching evidence item. */
  danglingCitations?: number[];
  research?: { rounds: number; toolCalls: number; liveUrls: number; budgetExceeded: boolean } | null;
  llm?: LlmTotals;
  /** Meta keys about packs / fan-out the graph reported (anything matching /pack|skill|fanout|compare/i). */
  flags?: Record<string, unknown>;
  verdicts?: ItemVerdict[];
  scores?: RowScores;
  judge?: { model: string; ms: number; inputTokens: number; outputTokens: number; error?: string };
}

export interface Aggregate {
  key: string;
  rows: number;
  /** Rows that errored (graph or judge) and are left out of the quality means. */
  errors: number;
  coverage: number | null;
  citedCoverage: number | null;
  honesty: number | null;
  inChecklistCoverage: number | null;
  offChecklistCoverage: number | null;
  official: number | null;
  officialRows: number;
  routeMatch: number | null;
  /** Share of rows naming an origin whose route found it; null when no row names one. */
  originMatch: number | null;
  avgCostUsd: number | null;
  avgTokens: number | null;
  avgEvidence: number | null;
  cachedShare: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
}

/** Nearest-rank percentile (p in 0..100); null for an empty list. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function aggregate(key: string, rows: RowResult[]): Aggregate {
  const scored = rows.filter((r) => r.ok && r.scores);
  const s = (k: keyof RowScores) => mean(scored.map((r) => r.scores![k]).filter((v): v is number => v !== null));
  const ran = rows.filter((r) => r.llm);
  const costs = ran.map((r) => r.llm!.costUsd).filter((c): c is number => c !== null);
  const input = ran.reduce((n, r) => n + r.llm!.inputTokens, 0);
  const cached = ran.reduce((n, r) => n + r.llm!.cachedInputTokens, 0);
  const latencies = rows.filter((r) => r.ok).map((r) => r.latencyMs);
  const routed = rows.filter((r) => r.routeMatch !== undefined);
  return {
    key,
    rows: rows.length,
    errors: rows.length - scored.length,
    coverage: s("coverage"),
    citedCoverage: s("citedCoverage"),
    honesty: s("honesty"),
    inChecklistCoverage: s("inChecklistCoverage"),
    offChecklistCoverage: s("offChecklistCoverage"),
    official: s("official"),
    officialRows: scored.filter((r) => r.scores!.official !== null).length,
    routeMatch: mean(routed.map((r) => (r.routeMatch ? 1 : 0))),
    originMatch: mean(rows.filter((r) => r.originMatch !== undefined).map((r) => (r.originMatch ? 1 : 0))),
    avgCostUsd: costs.length === ran.length && costs.length ? mean(costs) : null,
    avgTokens: mean(ran.map((r) => r.llm!.inputTokens + r.llm!.outputTokens)),
    avgEvidence: mean(rows.filter((r) => r.evidence).map((r) => r.evidence!.length)),
    cachedShare: input ? cached / input : null,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
  };
}

function groupBy(rows: RowResult[], key: (r: RowResult) => string): Aggregate[] {
  const groups = new Map<string, RowResult[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, rs]) => aggregate(k, rs));
}

export interface RunSummary {
  overall: Aggregate;
  single: Aggregate;
  comparisons: Aggregate;
  byCountry: Aggregate[];
  byIntent: Aggregate[];
  byCell: Aggregate[];
  /** Rows naming an origin, per market as `origin:<slug>` (comparisons included). Absent in run files written before origins. */
  byOrigin: Aggregate[];
  /** Rows naming an origin, per `origin×destination` (`origin×comparison` for comparisons). */
  byOriginDestination: Aggregate[];
}

/** Per-country / per-intent / per-cell over single-country rows; comparisons kept apart; origin tables over rows that name one. */
export function summarize(rows: RowResult[]): RunSummary {
  const single = rows.filter((r) => !r.comparison);
  const withOrigin = rows.filter((r) => r.origin);
  return {
    overall: aggregate("overall", rows),
    single: aggregate("single-country", single),
    comparisons: aggregate("comparisons", rows.filter((r) => r.comparison)),
    byCountry: groupBy(single, (r) => r.countries[0]!),
    byIntent: groupBy(single, (r) => r.intent),
    byCell: groupBy(single, (r) => r.cell),
    // Prefixed: Thailand is both a market and a destination, and the compare table indexes every key together.
    byOrigin: groupBy(withOrigin, (r) => `origin:${r.origin}`),
    byOriginDestination: groupBy(withOrigin, (r) => `${r.origin}×${r.comparison ? "comparison" : r.countries[0]}`),
  };
}

/**
 * Whether a route matches the row: same countries (as sets) and, when the row names an origin,
 * the same origin. `originMatch` is reported on its own (rows with an origin only), so a run can
 * tell a destination miss from an origin miss.
 */
export function routeMatches(row: Pick<CoverageRow, "countries" | "origin">, route: { countries: readonly string[]; origin?: string | null } | null): { routeMatch: boolean; originMatch?: boolean } {
  const countries = route ? new Set(route.countries).size === new Set(row.countries).size && row.countries.every((c) => route.countries.includes(c)) : false;
  if (!row.origin) return { routeMatch: countries };
  const originMatch = route?.origin === row.origin;
  return { routeMatch: countries && originMatch, originMatch };
}

/**
 * The counsellor region a row runs with under `--counsellor-region`: "origin" simulates a
 * counsellor in the row's own origin market (the CRM branch default, as in production for an
 * offshore office), so a question that never names the student's nationality is still routed;
 * "none" runs without one, as before. Rows that name no origin never get a region.
 */
export function evalCounsellorRegion(row: Pick<CoverageRow, "origin">, mode: "origin" | "none"): CounsellorRegion | null {
  return mode === "origin" && row.origin && isMarket(row.origin) ? { market: row.origin, onshore: null, branch: null, source: "crm_branch" } : null;
}

/** How many rows resolved their origin through each routing layer ("none" when no origin was routed); errored rows without a route are left out. */
export function originSourceCounts(rows: readonly Pick<RowResult, "route">[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.route) continue;
    const key = r.route.originSource ?? "none";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** "origin from: keywords 30 · counsellor 12 · none 3", most first (ties by name); "" when there is nothing to count. */
export function formatOriginSources(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? `origin from: ${entries.map(([k, n]) => `${k} ${n}`).join(" · ")}` : "";
}

// --- Tables ----------------------------------------------------------------

const pct = (v: number | null) => (v === null ? "  n/a" : `${(v * 100).toFixed(0).padStart(4)}%`);
const ms = (v: number | null) => (v === null ? "n/a" : `${(v / 1000).toFixed(1)}s`);
const usd = (v: number | null) => (v === null ? "n/a" : `$${v.toFixed(4)}`);

export function formatTable(title: string, aggs: Aggregate[]): string {
  const width = Math.max(14, ...aggs.map((a) => a.key.length));
  const head = `${"".padEnd(width)}  rows err   cov  cited honest  inCL offCL  offic route origin  ev   tokens  $/turn  cache  p50   p95`;
  const lines = aggs.map(
    (a) =>
      `${a.key.padEnd(width)}  ${String(a.rows).padStart(4)} ${String(a.errors).padStart(3)} ${pct(a.coverage)} ${pct(a.citedCoverage)} ${pct(a.honesty)} ${pct(a.inChecklistCoverage)} ${pct(a.offChecklistCoverage)} ${pct(a.official)} ${pct(a.routeMatch)} ${pct(a.originMatch ?? null).padStart(6)} ${(a.avgEvidence === null ? "n/a" : a.avgEvidence.toFixed(0)).padStart(3)} ${(a.avgTokens === null ? "n/a" : Math.round(a.avgTokens).toString()).padStart(8)} ${usd(a.avgCostUsd).padStart(7)} ${pct(a.cachedShare)} ${ms(a.p50Ms).padStart(5)} ${ms(a.p95Ms).padStart(5)}`,
  );
  return [`\n${title}`, head, ...lines].join("\n");
}

export function formatSummary(s: RunSummary): string {
  return [
    formatTable("Overall", [s.overall, s.single, s.comparisons]),
    formatTable("By country (single-country rows)", s.byCountry),
    formatTable("By intent (single-country rows)", s.byIntent),
    formatTable("By cell", s.byCell),
    ...(s.byOrigin?.length ? [formatTable("By origin (rows naming one)", s.byOrigin), formatTable("Origin × destination", s.byOriginDestination ?? [])] : []),
  ].join("\n");
}

export interface DeltaRow {
  key: string;
  rowsA: number;
  rowsB: number;
  coverage: [number | null, number | null];
  citedCoverage: [number | null, number | null];
  honesty: [number | null, number | null];
  inChecklistCoverage: [number | null, number | null];
  official: [number | null, number | null];
  tokens: [number | null, number | null];
  costUsd: [number | null, number | null];
  p50Ms: [number | null, number | null];
}

/** Per-cell (plus overall, single, comparisons, per-country, per-intent) A → B pairs. */
export function compareSummaries(a: RunSummary, b: RunSummary): DeltaRow[] {
  // Run files written before origins have no origin tables.
  const index = (s: RunSummary) => new Map([s.overall, s.single, s.comparisons, ...s.byCountry, ...s.byIntent, ...s.byCell, ...(s.byOrigin ?? []), ...(s.byOriginDestination ?? [])].map((x) => [x.key, x]));
  const ia = index(a);
  const ib = index(b);
  const keys = [...new Set([...ia.keys(), ...ib.keys()])];
  const fixed = ["overall", "single-country", "comparisons"];
  const ordered = [...fixed.filter((k) => keys.includes(k)), ...keys.filter((k) => !fixed.includes(k) && !k.includes("×")).sort(), ...keys.filter((k) => k.includes("×")).sort()];
  return ordered.map((key) => {
    const x = ia.get(key);
    const y = ib.get(key);
    const pair = (k: keyof Aggregate) => [(x?.[k] as number | null | undefined) ?? null, (y?.[k] as number | null | undefined) ?? null] as [number | null, number | null];
    return {
      key,
      rowsA: x?.rows ?? 0,
      rowsB: y?.rows ?? 0,
      coverage: pair("coverage"),
      citedCoverage: pair("citedCoverage"),
      honesty: pair("honesty"),
      inChecklistCoverage: pair("inChecklistCoverage"),
      official: pair("official"),
      tokens: pair("avgTokens"),
      costUsd: pair("avgCostUsd"),
      p50Ms: pair("p50Ms"),
    };
  });
}

function deltaPct([a, b]: [number | null, number | null]): string {
  if (a === null || b === null) return `${pct(a).trim()}→${pct(b).trim()}`.padStart(13);
  const d = (b - a) * 100;
  return `${(a * 100).toFixed(0)}→${(b * 100).toFixed(0)} ${d >= 0 ? "+" : ""}${d.toFixed(0)}`.padStart(13);
}

function deltaRatio([a, b]: [number | null, number | null], fmt: (v: number) => string): string {
  if (a === null || b === null) return `${a === null ? "n/a" : fmt(a)}→${b === null ? "n/a" : fmt(b)}`.padStart(16);
  const r = a ? ((b - a) / a) * 100 : 0;
  return `${fmt(a)}→${fmt(b)} ${r >= 0 ? "+" : ""}${r.toFixed(0)}%`.padStart(16);
}

export function formatCompare(labelA: string, labelB: string, deltas: DeltaRow[]): string {
  const width = Math.max(14, ...deltas.map((d) => d.key.length));
  const head = `${"".padEnd(width)}  rows       coverage         cited        honest     inChecklist      official           tokens              p50`;
  const lines = deltas.map(
    (d) =>
      `${d.key.padEnd(width)}  ${`${d.rowsA}/${d.rowsB}`.padStart(5)} ${deltaPct(d.coverage)} ${deltaPct(d.citedCoverage)} ${deltaPct(d.honesty)} ${deltaPct(d.inChecklistCoverage)} ${deltaPct(d.official)} ${deltaRatio(d.tokens, (v) => `${(v / 1000).toFixed(1)}k`)} ${deltaRatio(d.p50Ms, (v) => `${(v / 1000).toFixed(1)}s`)}`,
  );
  return [`\nA = ${labelA}   B = ${labelB}   (percentage points for scores; % change for tokens and latency)`, head, ...lines].join("\n");
}
