import { extractFigures, numbersIn, sameCurrency, type Figure } from "../verify/figures";

/**
 * A deterministic check on the figures in an answer (counsellor re-audit R7, Oct 2026: a BDT total
 * 10x too high, Sydney summed as 1,304 instead of 1,309, a total that was not the sum of its own
 * table, fees with no source). Three checks, each on what the answer itself states:
 *
 * - **Unsupported:** a money or percentage figure that appears in none of this turn's evidence
 *   excerpts nor the consultant's message, and that the answer does not label "derived" (or that is
 *   not an arithmetic result checked below). Figures from earlier answers do not count as support:
 *   an earlier answer can be the error being repeated.
 * - **Totals:** a "total" line whose figure is not the sum of any two or more figures of the same
 *   currency in the lines above it, within the same table or list.
 * - **Conversions:** a home-currency figure that is not a destination figure times the exchange
 *   rate the answer states ("1 AUD = 89.5 BDT"), within 1.5%.
 *
 * Nothing is rewritten: problems become one visible line after the answer and a `figureCheck`
 * record in the turn's meta, so a counsellor checks before relying on the figure and the rate of
 * flagged answers is measurable.
 */

export interface AnswerFigureIssues {
  unsupported: string[];
  badTotals: { total: string; components: string[] }[];
  badConversions: { figure: string; rate: string }[];
}

export interface AnswerFigureCheck extends AnswerFigureIssues {
  /** Money and percentage figures the answer states. */
  checked: number;
  /** The visible line, or null when nothing is wrong. */
  note: string | null;
}

/** Most items listed per kind in the visible note. */
const MAX_LISTED = 4;
/** Sums within 0.1% (or 1 unit) count as equal: rounding in the answer, never a wrong item. */
const SUM_TOLERANCE = 0.001;
const RATE_TOLERANCE = 0.015;
const HOME = new Set(["NPR", "INR", "BDT", "LKR", "PKR", "PHP", "THB", "VND", "RS"]);

/** Citation markers, the Sources line and list numbering are not figures. */
function withoutMarkup(text: string): string {
  return text
    .replace(/^\s*(?:[*_]{0,2})(?:Sources|Based on)\b.*$/gim, "")
    .replace(/\[\d{1,3}\]/g, "")
    .replace(/^\s*\d{1,2}[.)]\s/gm, "");
}

/**
 * A figure on a line that shows its arithmetic ("× 9 =", "29,710 + 2,500") or says it is
 * "derived" / "calculated" is computed, not quoted: it needs no source of its own. Hedges
 * ("about", "estimated") do not count: an estimated insurance price is exactly what must be sourced.
 */
const DERIVED = /\b(?:derived|calculated|computed)\b|[×=]|\d\s?[x*+]\s?\d/i;
const TOTAL_WORD = /\b(?:grand |sub-?)?total(?:l?ing|l?ed|s)?\b/i;
/** The text just before a figure ends with a "total" word and a few connecting words or table markup. */
const TOTAL_BEFORE = /\b(?:grand |sub-?)?total(?:l?ing|l?ed|s)?\b(?:[^.;\n]{0,30})$/i;

interface Line {
  text: string;
  start: number;
  end: number;
}

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let at = 0;
  for (const t of text.split("\n")) {
    out.push({ text: t, start: at, end: at + t.length });
    at += t.length + 1;
  }
  return out;
}

const lineIndexOf = (lines: Line[], pos: number) => lines.findIndex((l) => pos >= l.start && pos <= l.end);

/** A block boundary: a blank line, or a heading. Table rows and list items stay in one block. */
const isBoundary = (l: Line) => !l.text.trim() || /^\s*#{1,6}\s/.test(l.text);

const close = (a: number, b: number, tolerance = SUM_TOLERANCE) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * tolerance);

/**
 * Whether `target` is arithmetic on the given figures: a sum of two or more of them, a whole
 * multiple of one (9 × a monthly figure), or a difference of two (a deposit minus fees paid).
 */
function isArithmetic(target: number, values: number[]): boolean {
  const vs = values.slice(-16);
  if (subsetSums(vs, target)) return true;
  for (const v of vs) {
    if (v <= 0) continue;
    const k = target / v;
    if (k >= 2 && k <= 60 && Math.abs(k - Math.round(k)) < 1e-6) return true;
  }
  for (const a of vs) for (const b of vs) if (a > b && close(a - b, target)) return true;
  return false;
}

/** Whether some subset of two or more values sums to `target` (values are few: at most 16 are tried). */
function subsetSums(values: number[], target: number): boolean {
  const vs = values.slice(-16);
  const n = vs.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    if ((mask & (mask - 1)) === 0) continue; // a single figure is not a sum
    let sum = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += vs[i]!;
    if (close(sum, target)) return true;
  }
  return false;
}

/** Exchange rates the answer states: "1 AUD = 89.5 BDT", "AUD 1 = BDT 89.50", "at 89.5 BDT/AUD". */
function ratesIn(text: string): { from: string; to: string; rate: number; text: string }[] {
  const out: { from: string; to: string; rate: number; text: string }[] = [];
  const code = String.raw`(AUD|NZD|CAD|USD|GBP|EUR|NPR|INR|BDT|LKR|PKR|PHP|THB|VND|A\$|£|\$)`;
  const num = String.raw`(\d[\d,]*(?:\.\d+)?)`;
  const patterns = [
    new RegExp(String.raw`1\s?${code}\s?(?:=|≈|is|equals|to)\s?${code}?\s?${num}\s?${code}?`, "gi"),
    new RegExp(String.raw`${code}\s?1\s?(?:=|≈)\s?${code}\s?${num}`, "gi"),
    new RegExp(String.raw`${num}\s?${code}\s?(?:per|/)\s?${code}`, "gi"),
  ];
  const norm = (c: string | undefined) => (c ? (c === "A$" ? "AUD" : c === "£" ? "GBP" : c === "$" ? "$" : c.toUpperCase()) : "");
  for (const [i, re] of patterns.entries()) {
    for (const m of text.matchAll(re)) {
      if (i === 0) out.push({ from: norm(m[1]), to: norm(m[2] ?? m[4]), rate: Number(m[3]!.replace(/,/g, "")), text: m[0] });
      else if (i === 1) out.push({ from: norm(m[1]), to: norm(m[2]), rate: Number(m[3]!.replace(/,/g, "")), text: m[0] });
      else out.push({ from: norm(m[3]), to: norm(m[2]), rate: Number(m[1]!.replace(/,/g, "")), text: m[0] });
    }
  }
  return out.filter((r) => r.to && r.from && r.rate > 0 && HOME.has(r.to) !== HOME.has(r.from));
}

export function checkAnswerFigures(answer: string, support: { evidence: readonly string[]; input: string }): AnswerFigureCheck {
  const text = withoutMarkup(answer);
  const lines = linesOf(text);
  const figures = extractFigures(text).filter((f) => f.kind === "money" || f.kind === "percent");
  const supportText = [...support.evidence, support.input].join("\n");
  const known = new Set(numbersIn(supportText).map((n) => Math.round(n * 100) / 100));
  const rates = ratesIn(text);

  // --- Totals ---------------------------------------------------------------------------------
  // A total is a money figure right after the word "total" on its line ("Total: £25,777",
  // "| **Total** | **AUD 34,210** |", "totalling NZD 850"); "sum", "overall" or "the total cost
  // includes…" further away do not make one. It is right when some two or more figures above it
  // (its table or list, the figures before it on its line, or any earlier figure in the answer)
  // add up to it. Only a total with listed items and no matching sum is flagged.
  const badTotals: AnswerFigureIssues["badTotals"] = [];
  const arithmeticOk = new Set<Figure>();
  const money = figures.filter((g) => g.kind === "money" && !g.range);
  // The consultant's own figures (tuition, a scholarship) can be part of any sum in the answer.
  const fromInput = extractFigures(support.input).filter((g) => g.kind === "money" && !g.range);
  const earlier = (f: Figure) => [
    ...fromInput.filter((g) => sameCurrency(g.unit, f.unit)).map((g) => g.value),
    ...money.filter((g) => g.start < f.start && sameCurrency(g.unit, f.unit)).map((g) => g.value),
  ];
  for (const f of money) {
    const li = lineIndexOf(lines, f.start);
    if (li < 0) continue;
    const line = lines[li]!;
    const before = line.text.slice(Math.max(0, f.start - line.start - 40), f.start - line.start);
    // Between the word and the figure: labels and table markup only, no figure, no "(derived: … × 9)".
    const gap = TOTAL_BEFORE.test(before) ? before.slice(before.search(TOTAL_WORD)) : null;
    if (gap === null || /[\d(×[]|\bderived\b/i.test(gap)) continue;
    // The figures above it in the same block, same currency; one per line (a line's last figure is
    // its amount, e.g. "| Living costs (12 months) | AUD 29,710 |").
    const components: Figure[] = [];
    for (let j = li - 1; j >= 0 && !isBoundary(lines[j]!); j--) {
      const onLine = money.filter((g) => lineIndexOf(lines, g.start) === j && sameCurrency(g.unit, f.unit));
      if (onLine.length) components.unshift(onLine[onLine.length - 1]!);
    }
    // Figures before it on its own line ("NZD 750 plus the NZD 100 levy, totalling NZD 850").
    const sameLine = money.filter((g) => g !== f && g.start < f.start && lineIndexOf(lines, g.start) === li && sameCurrency(g.unit, f.unit));
    const listed = sameLine.length >= 2 ? sameLine : components;
    // The listed items are among the earlier figures: try each figure once.
    if (isArithmetic(f.value, earlier(f))) arithmeticOk.add(f);
    else if (listed.length >= 2) badTotals.push({ total: f.text, components: listed.map((p) => p.text) });
  }

  // --- Conversions ----------------------------------------------------------------------------
  const badConversions: AnswerFigureIssues["badConversions"] = [];
  if (rates.length) {
    const foreign = figures.filter((f) => f.kind === "money" && !HOME.has(f.unit));
    for (const f of figures) {
      if (f.kind !== "money" || !HOME.has(f.unit)) continue;
      const applicable = rates.filter((r) => sameCurrency(r.to, f.unit) || sameCurrency(r.from, f.unit));
      if (!applicable.length) continue;
      const matches = applicable.some((r) => {
        const perUnit = HOME.has(r.to) ? r.rate : 1 / r.rate; // home units per foreign unit
        return foreign.some((g) => close(g.value * perUnit, f.value, RATE_TOLERANCE));
      });
      if (matches) arithmeticOk.add(f);
      else badConversions.push({ figure: f.text, rate: applicable[0]!.text });
    }
  }

  // --- Unsupported ----------------------------------------------------------------------------
  const unsupported: string[] = [];
  for (const f of figures) {
    if (arithmeticOk.has(f) || badTotals.some((b) => b.total === f.text) || badConversions.some((b) => b.figure === f.text)) continue;
    if (known.has(f.value)) continue;
    if (f.kind === "money" && HOME.has(f.unit) && rates.length) continue; // converted, judged above
    const li = lineIndexOf(lines, f.start);
    if (li >= 0 && DERIVED.test(lines[li]!.text)) continue;
    // Arithmetic on the answer's own earlier figures (an unlabelled total or a 9-month figure).
    if (f.kind === "money" && !f.range && isArithmetic(f.value, earlier(f))) continue;
    if (f.kind === "percent" && f.value === 100) continue;
    if (!unsupported.includes(f.text)) unsupported.push(f.text);
  }

  const parts: string[] = [];
  if (badTotals.length) parts.push(`${badTotals.slice(0, MAX_LISTED).map((b) => `the total ${b.total} is not the sum of the items listed (${b.components.join(" + ")})`).join("; ")}`);
  if (badConversions.length) parts.push(`${badConversions.slice(0, MAX_LISTED).map((b) => `${b.figure} does not match any figure at the stated rate (${b.rate.trim()})`).join("; ")}`);
  if (unsupported.length) parts.push(`not found in this turn's sources: ${unsupported.slice(0, MAX_LISTED).join(", ")}${unsupported.length > MAX_LISTED ? ` and ${unsupported.length - MAX_LISTED} more` : ""}`);
  const note = parts.length ? `\n\n_(Figure check: ${parts.join("; ")}. Verify before sending.)_` : null;
  return { unsupported, badTotals, badConversions, checked: figures.length, note };
}
