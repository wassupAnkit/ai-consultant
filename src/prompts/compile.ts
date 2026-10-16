/**
 * Minimal, safe `{{variable}}` substitution (same syntax Langfuse uses for
 * text prompts). Unknown placeholders are left untouched, values are inserted
 * verbatim (never re-parsed), so JSON braces inside prompts or retrieved
 * content can never break templating.
 */
export function compileTemplate(
  template: string,
  vars: Record<string, string | number | boolean | null | undefined>,
): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? match : String(v);
  });
}

const SYDNEY_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * The `{{today}}` value for prompts: the calendar date in Australia/Sydney as YYYY-MM-DD.
 * Sydney because it is the most easterly of Expert Education's office time zones: no office's
 * date is ever ahead of it, so a countdown to a deadline is never a day too generous. Date only,
 * so the prompt text changes once a day and never breaks prefix caching within a day.
 */
export function promptDate(now: Date = new Date()): string {
  return SYDNEY_DATE.format(now);
}

/** Names of all `{{placeholders}}` found in a template. */
export function templateVariables(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) out.add(m[1]!);
  return [...out];
}
