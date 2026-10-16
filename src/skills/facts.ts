/**
 * The no-facts guard for country skill packs. Packs say WHAT a complete answer
 * covers and WHERE to look; every fee, threshold, date or duration must come
 * from cited evidence at answer time, never from pack text that goes stale.
 *
 * Identifiers that merely contain digits (visa subclasses, form names, US
 * status codes, AU visa conditions) are allowed: they name a thing, they do
 * not state a figure about it.
 */
const IDENTIFIERS: RegExp[] = [
  /\bsubclass(?:es)? \d{3}\b/gi,
  /\bIMM \d{4}\b/g,
  /\bDS-\d{3,4}\b/g,
  /\bI-\d{2,3}[A-Z]?\b/g, // I-20, I-94, I-765, I-901
  /\b[FJMH]-\d[A-Z]?\b/g, // F-1, J-2, M-1, H-1B
  /\bForm \d+[A-Z]?\b/gi,
  /\bcondition \d{4}\b/gi, // AU visa conditions, e.g. the work limitation condition
  /\bPIC \d{4}\b/g, // AU public interest criteria
  /\bsection \d+[A-Z]?\b/gi,
];

const FACT_PATTERNS: { rule: string; re: RegExp }[] = [
  { rule: "currency", re: /(?:\b(?:AUD|CAD|GBP|USD|NZD|EUR|INR|NPR)|[A-Z]{0,2}\$|£|€|₹)\s?\d/gi },
  { rule: "currency", re: /\d[\d,.]*\s?(?:AUD|CAD|GBP|USD|NZD|EUR|dollars?|pounds?|euros?)\b/gi },
  { rule: "percentage", re: /\d+(?:\.\d+)?\s?(?:%|per ?cent)/gi },
  { rule: "duration", re: /\b\d+(?:\.\d+)?[\s-]?(?:hours?|days?|weeks?|fortnights?|months?|years?)\b/gi },
  { rule: "year", re: /\b(?:19|20)\d{2}\b/g },
  { rule: "decimal", re: /\b\d+\.\d+\b/g },
];

function stripIdentifiers(text: string): string {
  return IDENTIFIERS.reduce((t, re) => t.replace(re, " "), text);
}

/** Amounts, percentages, durations, years and score-like decimals in `text`. */
export function findFacts(text: string): string[] {
  const t = stripIdentifiers(text);
  return FACT_PATTERNS.flatMap(({ rule, re }) => [...t.matchAll(re)].map((m) => `${rule}: ${m[0].trim()}`));
}

/** Stricter: any digit outside an allowed identifier (for prose and vocabulary). */
export function findNumbers(text: string): string[] {
  return [...stripIdentifiers(text).matchAll(/\S*\d\S*/g)].map((m) => m[0]);
}
