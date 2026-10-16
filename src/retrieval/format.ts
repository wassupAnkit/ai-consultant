import { sanitizeRetrieved } from "../safety/sanitize";
import type { EvidenceItem, EvidenceKind } from "../tools/types";
import { isoDate, sourceKindOf, type RetrievedChunk, type SourceKind } from "./store";

export interface Source {
  n: number;
  url: string;
  /**
   * Clickable page for this source when `url` is not one. Only CRM evidence sets it (its
   * `url` is a `crm://` lookup key); null when the tool has no page or CRM_WEB_URL is unset.
   */
  webUrl?: string | null;
  title: string;
  section?: string;
  /** Sanitised excerpt of the retrieved chunk (capped) so clients can show what was cited. */
  excerpt: string;
  docType?: string;
  country?: string | null;
  /** Where the evidence came from: experteducation.com, partner:<slug>, upload:<slug>, market-guide:<market>, web:google, live:<host>… */
  source: string;
  /** Provenance class of indexed chunks (site / partner / upload / program); absent for live evidence. */
  sourceKind?: SourceKind;
  /** True when fetched from the live web during this turn rather than the indexed knowledge base. */
  live: boolean;
  kind?: EvidenceKind;
  /** Fused retrieval score (higher is better). */
  score?: number;
}

/** Longest excerpt returned to clients / persisted with a message. */
export const EXCERPT_MAX_CHARS = 1_200;

/** Default prompt budget for evidence text. */
export const CONTEXT_MAX_CHARS = 24_000;

export function toExcerpt(text: string, maxChars = EXCERPT_MAX_CHARS): string {
  const clean = sanitizeRetrieved(text);
  return clean.length > maxChars ? clean.slice(0, maxChars).replace(/\s+\S*$/, "") + " …" : clean;
}

type ContextItem = RetrievedChunk & Partial<Pick<EvidenceItem, "n" | "kind" | "live" | "fetchedAt">>;

/**
 * Render evidence as numbered excerpts for the prompt, and the matching source
 * list. Items that already carry an `n` (from the research collector) keep it;
 * plain retrieval chunks are numbered by position.
 */
export function formatContext(items: ContextItem[], maxCharsTotal = CONTEXT_MAX_CHARS): { context: string; sources: Source[] } {
  const sources: Source[] = [];
  const parts: string[] = [];
  let used = 0;
  items.forEach((c, i) => {
    const n = c.n ?? i + 1;
    const body = sanitizeRetrieved(c.content);
    if (used + body.length > maxCharsTotal && parts.length) return;
    used += body.length;
    const live = c.live ?? false;
    sources.push({
      n,
      url: c.url,
      // Only carried when the chunk has one, so ordinary web sources stay unchanged.
      ...(c.webUrl ? { webUrl: c.webUrl } : {}),
      title: c.title,
      section: c.section || undefined,
      excerpt: toExcerpt(c.content),
      docType: c.docType || undefined,
      country: c.country ?? null,
      source: c.source,
      ...(live ? {} : { sourceKind: c.sourceKind ?? sourceKindOf(c.source, c.docType) }),
      live,
      kind: c.kind ?? "kb",
      score: Number.isFinite(c.score) ? Math.round(c.score * 10_000) / 10_000 : undefined,
    });
    const attrs = [
      `id="${n}"`,
      `title="${escapeAttr(c.title)}"`,
      c.section ? `section="${escapeAttr(c.section)}"` : "",
      `url="${c.url}"`,
      `source="${escapeAttr(c.source)}"`,
      c.country && c.country !== "global" ? `country="${c.country}"` : "",
      live ? `live="true"${c.fetchedAt ? ` fetched_at="${c.fetchedAt}"` : ""}` : "",
      // Indexed evidence (KB chunks, program records): the date it was last written, day precision.
      !live && isoDay(c.updatedAt) ? `updated="${isoDay(c.updatedAt)}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    parts.push(`<excerpt ${attrs}>\n${body}\n</excerpt>`);
  });
  return { context: parts.join("\n\n"), sources };
}

/**
 * Sources actually cited as [n] in the answer, in first-citation order. Falls
 * back to the top 3 unless `strict` (drafts/reviews should not show unrelated
 * sources when the model cited nothing).
 */
export function citedSources(answer: string, sources: Source[], opts: { strict?: boolean } = {}): Source[] {
  const seen = new Set<number>();
  const cited: Source[] = [];
  for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (seen.has(n)) continue;
    const s = sources.find((x) => x.n === n);
    if (s) {
      seen.add(n);
      cited.push(s);
    }
  }
  if (cited.length) return cited;
  return opts.strict ? [] : sources.slice(0, 3);
}

/**
 * The answer without citation markers that point at no evidence this turn ("[7]" when only
 * [1]–[3] were given): a model copying markers from an earlier turn, or inventing them, leaves a
 * reference the consultant cannot open. Removed with the space before them.
 */
export function stripDanglingCitations(answer: string, sources: Pick<Source, "n">[]): string {
  const known = new Set(sources.map((s) => s.n));
  return answer.replace(/ ?\[(\d{1,5})\]/g, (marker, n: string) => (known.has(Number(n)) ? marker : ""));
}

/** "2026-08-14T03:12:00.000Z" → "2026-08-14"; undefined for a missing or unparseable date. */
function isoDay(iso: string | undefined): string | undefined {
  return isoDate(iso)?.slice(0, 10);
}

function escapeAttr(s: string) {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
