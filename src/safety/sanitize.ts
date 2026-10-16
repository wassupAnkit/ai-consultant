/** Patterns that indicate an attempt to override instructions, in user input or crawled content. */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?)/i,
  /disregard\s+(the\s+)?(system|previous)\s+(prompt|instructions)/i,
  /you\s+are\s+now\s+(an?\s+)?(unrestricted|jailbroken|dan\b)/i,
  /\bsystem\s*prompt\b.*\b(reveal|print|show|leak)/i,
  /(reveal|print|show|leak)\b.*\bsystem\s*prompt\b/i,
  /<\/?\s*(system|assistant|developer|instruction)s?\s*>/i,
  /\bBEGIN\s+SYSTEM\b/i,
];

// Zero-width and bidi control characters (built from escapes so they stay visible in review).
const INVISIBLE = new RegExp("[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]", "g");
// C0/C1 control characters except tab and newline.
const CONTROL = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]", "g");

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

/** Clean text that came from the web before it is placed inside the prompt. */
export function sanitizeRetrieved(text: string, maxChars = 6_000): string {
  let t = text
    .replace(INVISIBLE, "")
    .replace(CONTROL, "")
    .replace(/<\/?\s*(system|assistant|developer|instruction|tool)s?[^>]*>/gi, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  for (const re of INJECTION_PATTERNS) t = t.replace(re, "[removed]");
  if (t.length > maxChars) t = t.slice(0, maxChars) + "…";
  return t;
}

/** Normalise user input: trim, drop control characters, cap length. */
export function normalizeUserInput(text: string, maxChars: number): string {
  return text.replace(CONTROL, "").replace(INVISIBLE, "").trim().slice(0, maxChars);
}

/** Redact obvious PII for logs and traces (emails, phones, passport-like ids). */
export function redactPII(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/(\+?\d[\d\s().-]{7,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 8 ? "[phone]" : m))
    .replace(/\b[A-Z]{1,2}\d{7,8}\b/g, "[id]");
}
