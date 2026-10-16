import type { ExtractedPage } from "./extract";

/**
 * Heuristics that tell a course/program page apart from the rest of a
 * university site, so structured extraction (Gemini) only runs where it pays
 * off and the crawler spends its page budget on the catalog first.
 */
const URL_SIGNALS: [RegExp, number][] = [
  [/\/(courses?|programs?|programmes?|degrees?|study)\/[^/]+/i, 3],
  [/\/(handbook|course-finder|find-a-course|coursefinder|study-options)\//i, 3],
  [/\/(undergraduate|postgraduate|graduate|masters?|bachelors?|phd|doctorate|diploma|certificate)\b/i, 2],
  [/\b(bachelor|master|mba|phd|diploma|graduate-certificate|graduate-diploma)-of-/i, 3],
  [/\b[a-z]{1,5}\d{3,5}\b/i, 1], // course codes like C6001, MBUS
  [/cricos/i, 2],
  [/\/(international|fees|tuition|scholarships|admissions|entry-requirements)\b/i, 1],
];

const NEGATIVE_URL = /\/(news|events?|blog|staff|people|research|about|contact|alumni|media|careers?|jobs|library|privacy|terms|search|login|login\.aspx)\b/i;

export function courseUrlScore(url: string): number {
  let score = 0;
  for (const [re, w] of URL_SIGNALS) if (re.test(url)) score += w;
  if (NEGATIVE_URL.test(url)) score -= 4;
  return score;
}

const PAGE_SIGNALS: [string, RegExp][] = [
  ["duration", /\bduration\b|\byears?\s+full[- ]time\b|\bfull[- ]time\s+equivalent\b/i],
  ["intake", /\bintakes?\b|\bcommenc(?:e|ing|ement)\b|\bstart(?:ing)?\s+dates?\b|\btrimester\b|\bsemester\s+[12]\b/i],
  ["entry", /\bentry\s+requirements?\b|\badmission\s+(?:requirements?|criteria)\b|\bprerequisites?\b|\bATAR\b|\bGPA\b/i],
  ["english", /\bIELTS\b|\bPTE\b|\bTOEFL\b|\bDuolingo\b|\benglish\s+(?:language\s+)?(?:requirements?|proficiency)\b/i],
  ["fees", /\btuition\b|\bfees?\b|\bindicative\s+(?:annual\s+)?fee\b|\bAUD\b|\bCAD\b|\bGBP\b|\bUSD\b|\bNZD\b|\bEUR\b|\b£|\$\s?\d/i],
  ["code", /\bCRICOS\b|\bcourse\s+code\b|\bUCAS\s+code\b|\bprogram\s+code\b/i],
  ["campus", /\bcampus(?:es)?\b|\bdelivery\s+mode\b|\bon[- ]campus\b|\bonline\b|\bblended\b/i],
  ["credit", /\bcredit\s+points?\b|\bunits?\s+of\s+study\b|\bECTS\b|\bmodules?\b/i],
  ["apply", /\bapply\s+now\b|\bhow\s+to\s+apply\b|\bapplication\s+deadline\b/i],
  ["level", /\b(bachelor|master|doctor|diploma|graduate\s+certificate|graduate\s+diploma|associate\s+degree|foundation)\s+(of|in|degree|program)\b/i],
];

export interface CourseDetection {
  isCourse: boolean;
  /** 0..~15: URL score + one point per page signal (+3 for schema.org Course JSON-LD). */
  score: number;
  signals: string[];
  hasCourseJsonLd: boolean;
}

/** Decide whether a fetched page describes a course/program (needs ≥3 signals or JSON-LD `Course`). */
export function detectCoursePage(page: Pick<ExtractedPage, "url" | "title" | "text" | "jsonLd">): CourseDetection {
  const haystack = `${page.title}\n${page.text}`.slice(0, 40_000);
  const signals = PAGE_SIGNALS.filter(([, re]) => re.test(haystack)).map(([name]) => name);
  const hasCourseJsonLd = (page.jsonLd ?? []).some(hasCourseType);
  if (hasCourseJsonLd) signals.push("json-ld");
  const urlScore = courseUrlScore(page.url);
  const score = Math.max(0, urlScore) + signals.length + (hasCourseJsonLd ? 2 : 0);
  const isCourse = hasCourseJsonLd || (signals.length >= 3 && urlScore >= 0 && signals.some((s) => s === "fees" || s === "entry" || s === "duration"));
  return { isCourse, score, signals, hasCourseJsonLd };
}

function hasCourseType(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const types = Array.isArray(type) ? type : type ? [type] : [];
  if (types.some((t) => typeof t === "string" && /^(Course|EducationalOccupationalProgram)$/i.test(t))) return true;
  const graph = obj["@graph"];
  if (Array.isArray(graph)) return graph.some(hasCourseType);
  return false;
}

/** Crawl-queue priority: course-looking URLs first, then the rest, boilerplate last. */
export function crawlPriority(url: string): number {
  return courseUrlScore(url);
}
