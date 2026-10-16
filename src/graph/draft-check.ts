import type { Intent } from "../schemas/intent.schema";

/**
 * A deterministic check on drafts written in another language (counsellor audit N6, Oct 2026: a
 * Nepali translation turned "48 hours per fortnight" into "24 hours per week"). Every number in the
 * draft must appear in the source (the previous answers, this turn's evidence, the consultant's
 * message), and no period or currency may appear that the source does not use. A mismatch is not
 * corrected, only flagged for the counsellor in one visible line after the draft.
 */

/** Tasks whose output is text to send or reuse. A rewrite of the previous answer counts whatever its task. */
const DRAFT_TASKS = new Set<Intent["task"]>(["draft", "translate", "summarize"]);

/** A target language named in the consultant's message ("same in Vietnamese", "translate to Nepali"). */
const OTHER_LANGUAGE = /\b(?:nepali|hindi|bangla|bengali|urdu|punjabi|gujarati|marathi|vietnamese|thai|tagalog|filipino|sinhala|sinhalese|tamil)\b/i;

const LETTER = /\p{L}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

/** Whether the turn produced a draft, translation or rewrite in a language other than English. */
export function isNonEnglishDraft(args: { intent: Pick<Intent, "task" | "language">; rewrite: boolean; input: string; answer: string }): boolean {
  if (!args.rewrite && !DRAFT_TASKS.has(args.intent.task)) return false;
  return args.intent.language !== "en" || OTHER_LANGUAGE.test(args.input) || nonLatinShare(args.answer) > 0.2;
}

function nonLatinShare(text: string): number {
  let letters = 0;
  let other = 0;
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    letters++;
    if (!LATIN_LETTER.test(ch)) other++;
  }
  return letters ? other / letters : 0;
}

// --- Numbers ---------------------------------------------------------------------------------

/** Zero code points of the decimal digit blocks the counsellors' languages use. */
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x1040, 0xff10];

/** Devanagari, Bengali, Thai… digits as ASCII digits. */
export function asciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (d) => {
    const cp = d.codePointAt(0)!;
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
    return zero === undefined ? d : String(cp - zero);
  });
}

const NUMBER = /\d+(?:[.,]\d+)*/g;

/**
 * A number's comparison key: its digits without separators, so 29,710 / 29.710 / 29710 (and the
 * Indian 61,00,000) compare equal, minus a zero decimal tail (6.0 is 6) and leading zeros.
 */
function numberKey(token: string): string {
  const digits = token.replace(/[.,]0{1,2}$/, "").replace(/[.,]/g, "");
  return digits.replace(/^0+(?=\d)/, "");
}

/** Parts of a draft that are not figures to check: citation markers, the Sources line, list numbering. */
function withoutMarkup(text: string): string {
  return text
    .replace(/^\s*(?:[*_]{0,2})(?:Sources|Based on)\b.*$/gim, "")
    .replace(/\[\d{1,3}\]/g, "")
    .replace(/^\s*\d{1,2}[.)]\s/gm, "");
}

// --- Units -----------------------------------------------------------------------------------

type Period = "fortnight" | "week" | "month" | "year" | "hour";

/**
 * Period words by canonical period. Latin-script words match as whole words; the others as
 * substrings, because postpositions attach to them (हप्तामा, "in the week"). Words that are also
 * common in other senses are left out (Vietnamese năm is "year" and "five"; giờ is also "now").
 */
const PERIOD_WORDS: Record<Period, { latin: string[]; other: string[] }> = {
  fortnight: { latin: ["fortnights?", "fortnightly", "bi-?weekly"], other: ["पाक्षिक", "পাক্ষিক"] },
  week: { latin: ["weeks?", "weekly", "tuần", "linggo"], other: ["हप्ता", "सप्ताह", "সপ্তাহ", "สัปดาห์", "සති", "வாரம்", "வார"] },
  month: { latin: ["months?", "monthly", "tháng", "buwan", "buwanang"], other: ["महिना", "महीना", "মাস", "เดือน", "මාස", "மாத"] },
  year: { latin: ["years?", "yearly", "annual(?:ly)?", "per annum", "taon", "taun-taon"], other: ["वर्ष", "बर्ष", "বছর", "ปี", "අවුරුදු", "ஆண்டு", "வருட"] },
  hour: { latin: ["hours?", "hrs?"], other: ["घण्टा", "घंटा", "ঘণ্টা", "ชั่วโมง", "පැය", "மணி"] },
};

/** "Two weeks" in any of the languages: a fortnight, not a week. */
const TWO = ["2", "two", "दुई", "दो", "দুই", "สอง", "hai", "dalawang", "இரண்டு", "දෙ"];
const TWO_WEEKS = new RegExp(`(?<![\\p{L}\\d])(?:${TWO.join("|")})[\\s-]*(?:${[...PERIOD_WORDS.week.latin, ...PERIOD_WORDS.week.other].join("|")})`, "giu");

const PERIOD_RE = Object.fromEntries(
  (Object.keys(PERIOD_WORDS) as Period[]).map((p) => {
    const { latin, other } = PERIOD_WORDS[p];
    const parts = [`(?<!\\p{L})(?:${latin.join("|")})(?!\\p{L})`, ...(other.length ? [`(?:${other.join("|")})`] : [])];
    return [p, new RegExp(parts.join("|"), "iu")];
  }),
) as Record<Period, RegExp>;

function periodsIn(text: string): Set<Period> {
  const rest = text.replace(TWO_WEEKS, " fortnight ");
  return new Set((Object.keys(PERIOD_RE) as Period[]).filter((p) => PERIOD_RE[p].test(rest)));
}

/** Rupee written without its country (रु, Rs, ₨): compatible with NPR, INR, LKR and PKR. */
const RUPEE = "rupee";
const RUPEE_CODES = new Set(["NPR", "INR", "LKR", "PKR", RUPEE]);

const CURRENCY_PATTERNS: [RegExp, string][] = [
  [/\b(AUD|NPR|INR|BDT|VND|PHP|THB|LKR|PKR|USD|GBP|CAD|NZD|EUR|SGD|MYR|JPY|AED)\b/g, ""],
  [/(?<![A-Z])A\$/g, "AUD"],
  [/NZ\$/g, "NZD"],
  [/CA?\$/g, "CAD"],
  [/US\$/g, "USD"],
  [/£/g, "GBP"],
  [/€/g, "EUR"],
  [/₹/g, "INR"],
  [/৳|টাকা|टका/g, "BDT"],
  [/฿|บาท/g, "THB"],
  [/₱/g, "PHP"],
  [/₫|đồng/g, "VND"],
  [/₨|रु|रू|\bRs\.?|rupees?|रुपैयाँ|रुपये/gi, RUPEE],
];

function currenciesIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const [re, code] of CURRENCY_PATTERNS) for (const m of text.matchAll(re)) found.add(code || m[1]!.toUpperCase());
  return found;
}

function currencyCovered(code: string, source: Set<string>): boolean {
  if (source.has(code)) return true;
  return RUPEE_CODES.has(code) && (code === RUPEE ? [...source].some((c) => RUPEE_CODES.has(c)) : source.has(RUPEE));
}

/** The source states at least one figure with a unit: a number next to a currency, a period or a %. */
function hasFigureWithUnit(text: string): boolean {
  for (const m of text.matchAll(NUMBER)) {
    const i = m.index ?? 0;
    const around = text.slice(Math.max(0, i - 20), i + m[0].length + 25);
    if (/%/.test(around) || currenciesIn(around).size || periodsIn(around).size) return true;
  }
  return false;
}

/**
 * The visible "Check: …" line for a draft whose figures or units are not in its sources, or null
 * when every number is there, no period or currency changed, or the sources state no figure with a
 * unit to keep (nothing to check against).
 */
export function figureCheck(draft: string, sources: readonly string[]): string | null {
  const source = asciiDigits(withoutMarkup(sources.join("\n")));
  if (!hasFigureWithUnit(source)) return null;
  const text = asciiDigits(withoutMarkup(draft));

  const known = new Set([...source.matchAll(NUMBER)].map((m) => numberKey(m[0])));
  const numbers = [...new Set([...text.matchAll(NUMBER)].map((m) => m[0]).filter((n) => !known.has(numberKey(n))))];

  const sourcePeriods = periodsIn(source);
  const periods = [...periodsIn(text)].filter((p) => !sourcePeriods.has(p));
  const sourceCurrencies = currenciesIn(source);
  const currencies = [...currenciesIn(text)].filter((c) => !currencyCovered(c, sourceCurrencies));

  const items = [
    ...(numbers.length ? [numbers.join(", ")] : []),
    ...periods.map((p) => `"${p}"${sourcePeriods.size ? ` (source: ${[...sourcePeriods].join(", ")})` : ""}`),
    ...currencies.map((c) => `"${c === RUPEE ? "Rs" : c}"${sourceCurrencies.size ? ` (source: ${[...sourceCurrencies].map((s) => (s === RUPEE ? "Rs" : s)).join(", ")})` : ""}`),
  ];
  if (!items.length) return null;
  return `\n\n_(Check: ${items.join("; ")} — differs from the source answer; confirm before sending.)_`;
}
