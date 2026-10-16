import { factsRegister, FACTS_SLUGS, type FactRow, type FactsRegister } from "../skills/facts-register";
import { extractFigures as parseFigures, numbersIn, type FigureKind } from "../verify/figures";

/**
 * Golden facts: exact-value regression cases generated from the facts registers (docs/facts →
 * data/facts). Each case asks for one register row and passes only when the answer states every
 * figure in that row's value (money, percentages, quantities with a unit). No judge model: the
 * check is deterministic, so a drop is a real regression, not judge noise.
 *
 * A row also yields stale figures: the "previously AUD2,000" in its effective-from cell, or, in
 * a "Closed or replaced" table, the old figure in the fact cell when the value is "Replaced by
 * …". An answer that gives a stale figure without the current one is scored `stale`.
 *
 * Rows marked "— verify" (not confirmed on an official page), rows without a checkable figure,
 * rows with more than four figures and the "Next review dates" tables are left out.
 */

export type { FigureKind };

export interface Figure {
  kind: FigureKind;
  /** Numeric value, e.g. 2500 for "AUD2,500.00". */
  value: number;
  /** Unit for quantities ("hour", "week", "month", "year", "day", "point"), currency code for money ("GBP", "$"). */
  unit: string;
  /** As written in the register. */
  text: string;
}

export interface GoldenCase {
  id: string;
  register: string;
  section: string;
  fact: string;
  question: string;
  expect: Figure[];
  stale: Figure[];
  /** The register row as written (the answer key a reviewer reads). */
  source: string;
  checked: string;
}

/** wrong: a scenario's forbidden figure or rejected claim is in the answer. */
export type CaseOutcome = "pass" | "partial" | "stale" | "miss" | "wrong";

/** The shared figure parser (src/verify/figures.ts), each figure once, kept to what a case stores. */
export function extractFigures(text: string): Figure[] {
  const seen = new Set<string>();
  return parseFigures(text)
    .filter((f) => {
      const key = `${f.kind}:${f.value}:${f.unit}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ kind, value, unit, text: t }) => ({ kind, value, unit, text: t }));
}

/** Figures the row says no longer apply: "previously …" / "before: …" in the effective cell; "was …" in the value. */
function staleFigures(row: FactRow, sectionTitle: string, current: Figure[]): Figure[] {
  const old: Figure[] = [];
  for (const m of `${row.effectiveFrom} ${row.value}`.matchAll(/\b(?:previously|before:?|was)\s*([^;)]*)/gi)) old.push(...extractFigures(m[1]!));
  if (/closed or replaced/i.test(sectionTitle) && /^replaced by\b/i.test(row.value.trim())) old.push(...extractFigures(row.fact));
  const same = (a: Figure, b: Figure) => a.kind === b.kind && a.value === b.value;
  return old.filter((f, i) => !current.some((c) => same(c, f)) && old.findIndex((g) => same(g, f)) === i);
}

/** Figures of the value that the question asks for: "was …" and "previously …" figures are not expected. */
function currentFigures(row: FactRow): Figure[] {
  const value = row.value.replace(/\((?:was|previously)[^)]*\)/gi, "").replace(/\b(?:was|previously)\s[^;.]*/gi, "");
  return extractFigures(value);
}

const SKIP_SECTIONS = /next review|sources|change log/i;
const MAX_FIGURES = 4;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** The question a counsellor would ask for this row; the register's own words, so the case stays traceable. */
export function questionFor(register: Pick<FactsRegister, "label" | "slug">, section: string, row: FactRow): string {
  const where = register.slug === "scholarships" ? "Scholarships" : register.label;
  const appliesTo = row.appliesTo.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  const applies = appliesTo && !/^(?:all|n\/a|-)$/i.test(appliesTo) ? ` (applies to: ${appliesTo})` : "";
  return `${where}, ${section.toLowerCase()}: what is the current figure for "${row.fact.replace(/\*\*/g, "").trim()}"${applies}? Give the exact figure and its source.`;
}

/** Every golden case the registers yield, in register order, with ids stable across rebuilds. */
export function buildGoldenCases(slugs: readonly string[] = FACTS_SLUGS): GoldenCase[] {
  const cases: GoldenCase[] = [];
  const ids = new Set<string>();
  for (const slug of slugs) {
    const reg = factsRegister(slug);
    for (const section of reg.sections) {
      if (SKIP_SECTIONS.test(section.title)) continue;
      for (const row of section.rows) {
        if (/[—–-]+\s*verify\b/i.test(row.value)) continue;
        const expect = currentFigures(row);
        if (!expect.length || expect.length > MAX_FIGURES) continue;
        let id = `${slug}:${slugify(section.title).slice(0, 24)}:${slugify(row.fact)}`;
        for (let n = 2; ids.has(id); n++) id = `${id.replace(/~\d+$/, "")}~${n}`;
        ids.add(id);
        cases.push({
          id,
          register: slug,
          section: section.title,
          fact: row.fact,
          question: questionFor(reg, section.title, row),
          expect,
          stale: staleFigures(row, section.title, expect),
          source: row.line,
          checked: row.checked || reg.checked,
        });
      }
    }
  }
  return cases;
}

export function toJsonl(cases: GoldenCase[]): string {
  return cases.map((c) => JSON.stringify(c)).join("\n") + "\n";
}

export function parseGolden(text: string): GoldenCase[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as GoldenCase);
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, eighteen: 18, twenty: 20, thirty: 30, sixty: 60, ninety: 90,
};
const SPELLED_QUANTITY = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})(?=[\\s-]+(?:calendar\\s+|working\\s+|business\\s+)?(?:hour|day|week|month|year)s?\\b)`, "gi");

/**
 * "nine-month", "three months", "four years" → digits, so a quantity written out in words counts.
 * Only a number word directly before a time unit; scoring only, so the answer's figure check
 * (src/verify/figures.ts) is unchanged.
 */
function withSpelledQuantities(text: string): string {
  return text.replace(SPELLED_QUANTITY, (w) => String(NUMBER_WORDS[w.toLowerCase()]));
}

/** Does the answer state this figure? Money and percentages by value; small quantities need their unit. */
export function answerHasFigure(answer: string, f: Figure): boolean {
  const said = extractFigures(answer);
  if (f.kind === "money") {
    if (said.some((s) => s.kind === "money" && s.value === f.value)) return true;
    // "2,500" written without a currency next to it still states the figure when it is not a small number.
    return f.value >= 100 && numbersIn(answer).includes(f.value);
  }
  if (f.kind === "percent") return said.some((s) => s.kind === "percent" && s.value === f.value);
  return extractFigures(withSpelledQuantities(answer)).some((s) => s.kind === "quantity" && s.value === f.value && s.unit === f.unit);
}


/** pass: every figure; partial: some; stale: a stale figure and none of the current ones; miss: none. */
export function scoreAnswer(c: Pick<GoldenCase, "expect" | "stale">, rawAnswer: string): { outcome: CaseOutcome; found: string[]; missing: string[]; staleFound: string[] } {
  const answer = withoutCheckNotes(rawAnswer);
  const found = c.expect.filter((f) => answerHasFigure(answer, f)).map((f) => f.text);
  const missing = c.expect.filter((f) => !answerHasFigure(answer, f)).map((f) => f.text);
  const staleFound = c.stale.filter((f) => answerHasFigure(answer, f)).map((f) => f.text);
  const outcome: CaseOutcome = !missing.length ? "pass" : found.length ? "partial" : staleFound.length ? "stale" : "miss";
  return { outcome, found, missing, staleFound };
}

/**
 * A scenario case (data/eval/golden-scenarios.jsonl): a realistic counsellor question that
 * reproduces an audit failure. Figures are written as in the register ("AUD29,710"); `require` /
 * `reject` are regular expressions (a leading "(?i)" means case-insensitive).
 */
export interface ScenarioCase {
  id: string;
  failure: string;
  register: string;
  question: string;
  expect: string[];
  forbid: string[];
  require: { label: string; pattern: string }[];
  reject: { label: string; pattern: string }[];
  note?: string;
  checked?: string;
}

export function parseScenarios(text: string): ScenarioCase[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ScenarioCase);
}

function scenarioRegex(pattern: string): RegExp {
  return pattern.startsWith("(?i)") ? new RegExp(pattern.slice(4), "iu") : new RegExp(pattern, "u");
}

/** Problems in a scenario file: unparseable regexes, figures that are not figures, duplicate ids. */
export function validateScenarios(cases: ScenarioCase[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) errors.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    if (!c.question?.trim()) errors.push(`${c.id}: no question`);
    for (const f of [...c.expect, ...c.forbid]) if (extractFigures(f).length !== 1) errors.push(`${c.id}: "${f}" is not exactly one figure`);
    for (const r of [...c.require, ...c.reject]) {
      try {
        scenarioRegex(r.pattern);
      } catch (err) {
        errors.push(`${c.id}: bad pattern for "${r.label}": ${(err as Error).message}`);
      }
    }
    if (!c.expect.length && !c.require.length) errors.push(`${c.id}: nothing to check (no expect, no require)`);
  }
  return errors;
}

/** The answer without the check lines Edge appends (they quote the very figures being judged). */
export function withoutCheckNotes(answer: string): string {
  return answer.replace(/\n*_\((?:For you, not part of the message\. )?(?:Figure check|Check):[\s\S]*?\)_\s*$/g, "").trim();
}

/** pass: every expected figure and required claim, no forbidden figure, no rejected claim. */
export function scoreScenario(c: ScenarioCase, rawAnswer: string): { outcome: CaseOutcome; reasons: string[] } {
  const answer = withoutCheckNotes(rawAnswer);
  const reasons: string[] = [];
  const forbidden = c.forbid.flatMap((t) => extractFigures(t)).filter((f) => answerHasFigure(answer, f));
  for (const f of forbidden) reasons.push(`forbidden ${f.text}`);
  for (const r of c.reject) if (scenarioRegex(r.pattern).test(answer)) reasons.push(`rejected: ${r.label}`);
  const wrong = reasons.length > 0;
  const missing = c.expect.flatMap((t) => extractFigures(t)).filter((f) => !answerHasFigure(answer, f));
  for (const f of missing) reasons.push(`missing ${f.text}`);
  for (const r of c.require) if (!scenarioRegex(r.pattern).test(answer)) reasons.push(`missing claim: ${r.label}`);
  return { outcome: wrong ? "wrong" : reasons.length ? "miss" : "pass", reasons };
}

export interface GoldenRunRow {
  id: string;
  register: string;
  /** "facts" (generated) or "scenarios" (audit failures). */
  set?: "facts" | "scenarios";
  runs: { outcome: CaseOutcome; ms: number; missing: string[]; staleFound: string[]; error?: string; reasons?: string[]; flagged?: boolean }[];
}

export interface GoldenSummary {
  cases: number;
  runsPerCase: number;
  /** Share of runs that passed. */
  passRate: number;
  staleRate: number;
  /** Share of runs with a forbidden figure or rejected claim (scenarios). */
  wrongRate: number;
  /** Share of runs whose answer carried Edge's own "Figure check" line. */
  flagRate: number;
  errorRate: number;
  /** Share of cases whose runs all had the same outcome (only meaningful with repeats). */
  consistency: number | null;
  byRegister: Record<string, { cases: number; passRate: number; staleRate: number }>;
  p50Ms: number;
  p95Ms: number;
}

export function summarizeGolden(rows: GoldenRunRow[]): GoldenSummary {
  const runs = rows.flatMap((r) => r.runs);
  const share = (xs: { outcome: CaseOutcome; error?: string }[], pred: (x: { outcome: CaseOutcome; error?: string }) => boolean) => (xs.length ? xs.filter(pred).length / xs.length : 0);
  const byRegister: GoldenSummary["byRegister"] = {};
  for (const reg of [...new Set(rows.map((r) => r.register))]) {
    const rr = rows.filter((r) => r.register === reg).flatMap((r) => r.runs);
    byRegister[reg] = { cases: rows.filter((r) => r.register === reg).length, passRate: share(rr, (x) => x.outcome === "pass"), staleRate: share(rr, (x) => x.outcome === "stale") };
  }
  const ms = runs.filter((r) => !r.error).map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]! : 0);
  const repeats = Math.max(0, ...rows.map((r) => r.runs.length));
  return {
    cases: rows.length,
    runsPerCase: repeats,
    passRate: share(runs, (x) => x.outcome === "pass"),
    staleRate: share(runs, (x) => x.outcome === "stale"),
    wrongRate: share(runs, (x) => x.outcome === "wrong"),
    flagRate: runs.length ? runs.filter((r) => (r as { flagged?: boolean }).flagged).length / runs.length : 0,
    errorRate: share(runs, (x) => !!x.error),
    consistency: repeats > 1 ? rows.filter((r) => new Set(r.runs.map((x) => x.outcome)).size === 1).length / (rows.length || 1) : null,
    byRegister,
    p50Ms: pct(0.5),
    p95Ms: pct(0.95),
  };
}
