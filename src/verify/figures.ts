/**
 * Figures in text: money (with its currency), percentages and quantities with a unit. Shared by
 * the golden-facts eval (src/eval/golden.ts) and the answer figure check
 * (src/graph/answer-check.ts). Dates, legal citations and list numbering are not figures.
 *
 * Money is recognised with a currency before or after the number: "AUD2,500.00", "A$2,500",
 * "£1,570", "29,710 AUD", "NPR 25,00,000" (Indian grouping), "Rs 25 lakh", "BDT 4.2 crore",
 * "$23.4k". A bare "$" stays "$", which matches any dollar currency.
 */

export type FigureKind = "money" | "percent" | "quantity";

export interface Figure {
  kind: FigureKind;
  /** Numeric value, e.g. 2500 for "AUD2,500.00", 2500000 for "25 lakh". */
  value: number;
  /** Currency code for money ("AUD", "GBP", "$" for a bare dollar sign), "%" for percentages, the unit for quantities. */
  unit: string;
  /** As written. */
  text: string;
  /** Position in the text. */
  start: number;
  end: number;
  /** One bound of a range ("AUD 35,000–60,000"). */
  range?: boolean;
}

const SYMBOLS: [RegExp, string][] = [
  [/^(?:A\$|AU\$)$/i, "AUD"],
  [/^NZ\$$/i, "NZD"],
  [/^(?:C\$|CA\$)$/i, "CAD"],
  [/^US\$$/i, "USD"],
  [/^£$/, "GBP"],
  [/^€$/, "EUR"],
  [/^₹$/, "INR"],
  [/^(?:৳|tk\.?|taka)$/i, "BDT"],
  [/^(?:฿|baht)$/i, "THB"],
  [/^₱$/, "PHP"],
  [/^(?:₫|đồng|dong)$/i, "VND"],
  [/^(?:₨|rs\.?|rupees?|रु\.?|रू\.?)$/i, "RS"],
];

/** Canonical currency for a symbol or code ("A$" → AUD, "£" → GBP, "Rs" → RS, a rupee of any country). */
export function currencyCode(raw: string): string {
  const s = raw.trim();
  for (const [re, code] of SYMBOLS) if (re.test(s)) return code;
  return s === "$" ? "$" : s.toUpperCase();
}

const DOLLARS = new Set(["AUD", "NZD", "CAD", "USD", "SGD", "$"]);
const RUPEES = new Set(["NPR", "INR", "LKR", "PKR", "RS"]);

/** Whether two currency codes can be the same money ("$" and AUD; "Rs" and NPR). */
export function sameCurrency(a: string, b: string): boolean {
  if (a === b) return true;
  if ((a === "$" && DOLLARS.has(b)) || (b === "$" && DOLLARS.has(a))) return true;
  return (a === "RS" && RUPEES.has(b)) || (b === "RS" && RUPEES.has(a));
}

const CODES = "AUD|NZD|CAD|USD|GBP|EUR|SGD|MYR|AED|BDT|INR|NPR|LKR|PKR|PHP|THB|VND";
const PREFIX = String.raw`(?:A\$|AU\$|NZ\$|C\$|CA\$|US\$|${CODES}|£|€|₹|৳|฿|₱|₨|Rs\.?|रु\.?|रू\.?|Tk\.?|\$)`;
const SUFFIX = String.raw`(?:${CODES}|taka|baht|rupees?|đồng|₫)`;
/** Indian grouping (25,00,000), Western grouping (2,500,000), or plain, with decimals. */
const NUM = String.raw`\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const SCALE = String.raw`(?:\s?(k|m|bn|million|billion|lakhs?|lacs?|crores?|cr)\b)?`;
const RANGE_TAIL = String.raw`(?:\s?(?:–|—|-|to)\s?(${NUM})${SCALE})?`;

const MONEY_PREFIX = new RegExp(String.raw`(?<![\p{L}\d])(${PREFIX})\s?(${NUM})${SCALE}${RANGE_TAIL}`, "giu");
const MONEY_SUFFIX = new RegExp(String.raw`(?<![\p{L}\d.,])(${NUM})${SCALE}\s?(${SUFFIX})(?![\p{L}])`, "giu");
const PERCENT = new RegExp(String.raw`(?<![\d.,])(${NUM})\s?%`, "g");
const UNITS: Record<string, string> = {
  hour: "hour", hours: "hour", hrs: "hour", week: "week", weeks: "week", month: "month", months: "month",
  year: "year", years: "year", day: "day", days: "day", point: "point", points: "point",
};
const QUANTITY = new RegExp(String.raw`(?<![\d.,/])(${NUM})[\s-]?(hours?|hrs|weeks?|months?|years?|days?|points?)\b`, "gi");

const toNumber = (s: string) => Number(s.replace(/,/g, ""));

function scaled(n: number, scale: string | undefined): number {
  if (!scale) return n;
  const s = scale.toLowerCase();
  if (s === "k") return n * 1_000;
  if (s === "m" || s === "million") return n * 1_000_000;
  if (s === "bn" || s === "billion") return n * 1_000_000_000;
  if (s.startsWith("lak") || s.startsWith("lac")) return n * 100_000;
  if (s.startsWith("cr")) return n * 10_000_000;
  return n;
}

/** Round away float noise (25.5 lakh → 2550000, not 2549999.9999). */
const clean = (n: number) => Math.round(n * 100) / 100;

/** Money, percentages and quantities with a unit, in order of appearance; each figure once. */
export function extractFigures(text: string): Figure[] {
  const found: Figure[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  const take = (f: Figure) => {
    found.push(f);
    taken.push([f.start, f.end]);
  };
  for (const m of text.matchAll(MONEY_PREFIX)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (!free(start, end)) continue;
    const unit = currencyCode(m[1]!);
    if (!m[4]) {
      take({ kind: "money", value: clean(scaled(toNumber(m[2]!), m[3])), unit, text: m[0].trim(), start, end });
      continue;
    }
    // A range: both bounds, each spanning the whole match. The lower bound inherits the upper
    // bound's scale when it has none ("25–30 lakh").
    take({ kind: "money", value: clean(scaled(toNumber(m[2]!), m[3] ?? m[5])), unit, text: m[0].trim(), start, end, range: true });
    found.push({ kind: "money", value: clean(scaled(toNumber(m[4]), m[5])), unit, text: m[0].trim(), start, end, range: true });
  }
  for (const m of text.matchAll(MONEY_SUFFIX)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (!free(start, end)) continue;
    take({ kind: "money", value: clean(scaled(toNumber(m[1]!), m[2])), unit: currencyCode(m[3]!), text: m[0].trim(), start, end });
  }
  for (const m of text.matchAll(PERCENT)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (!free(start, end)) continue;
    take({ kind: "percent", value: toNumber(m[1]!), unit: "%", text: m[0], start, end });
  }
  for (const m of text.matchAll(QUANTITY)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (!free(start, end)) continue;
    take({ kind: "quantity", value: toNumber(m[1]!), unit: UNITS[m[2]!.toLowerCase()] ?? m[2]!.toLowerCase(), text: m[0], start, end });
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.start - b.start || a.value - b.value)
    .filter((f) => {
      const key = `${f.kind}:${f.value}:${f.unit}:${f.start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Every number written in the text (any format), as values: what a figure is looked up against. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(new RegExp(String.raw`(${NUM})${SCALE}`, "giu"))) {
    const n = toNumber(m[1]!);
    out.push(n);
    if (m[2]) out.push(clean(scaled(n, m[2])));
  }
  return out;
}
