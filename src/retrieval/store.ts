import type { Market } from "../routing/markets";
import type { Destination } from "../schemas/intent.schema";

/**
 * Provenance class of an indexed chunk: our own site, a partner university's site, a staff upload,
 * an extracted program record, or a curated official page (government, regulator, test body)
 * crawled nightly by src/ingest/official.ts.
 */
export type SourceKind = "site" | "partner" | "upload" | "program" | "official";
export const SOURCE_KINDS: readonly SourceKind[] = ["site", "partner", "upload", "program", "official"];

/** Derive the provenance class from the chunk's `source` id and document type. */
export function sourceKindOf(source: string, docType?: string | null): SourceKind {
  if (docType === "program" || source === "kb_programs") return "program";
  if (source.startsWith("partner:")) return "partner";
  if (source.startsWith("official:")) return "official";
  // Expert's own guides (src/skills/*-guides.ts, src/skills/facts-register.ts, and their indexed copies
  // `guide:<kind>/<slug>` from src/ingest/guides.ts) are internal documents, like uploads.
  if (/^(?:upload|market-guide|compliance-guide|facts-register|guide):/.test(source)) return "upload";
  return "site";
}

export interface RetrievedChunk {
  id: string;
  url: string;
  /**
   * Where a human should be sent, when that differs from `url`. CRM evidence is the case
   * that needs it: its `url` is a synthetic `crm://` lookup key, not a page.
   */
  webUrl?: string | null;
  title: string;
  section: string;
  docType: string;
  country: string | null;
  source: string;
  /** Provenance class (absent on chunks indexed before it was recorded; derive with `sourceKindOf`). */
  sourceKind?: SourceKind;
  content: string;
  /** Fused relevance score (higher is better). */
  score: number;
  /** Which retrievers returned this chunk (or, for live evidence, how it was obtained). */
  matchedBy: MatchedBy[];
  /**
   * When the indexed chunk or program record was last written (ISO 8601). Rendered as the
   * excerpt's `updated` date so the answer can give policy and fee figures an as-of date.
   * Absent on live evidence (which carries `fetchedAt`) and on CRM, mail and file evidence.
   */
  updatedAt?: string;
}

/** A stored date as ISO 8601, or undefined when missing or invalid. */
export function isoDate(d: Date | string | null | undefined): string | undefined {
  if (!d) return undefined;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString();
}

/** `{ updatedAt }` as ISO when the stored date is valid, else nothing (the field stays absent). */
export function withUpdatedAt(d: Date | string | null | undefined): { updatedAt?: string } {
  const iso = isoDate(d);
  return iso ? { updatedAt: iso } : {};
}

/** How a chunk was found; "market_guide" / "compliance_guide" / "facts_register" = a guide excerpt added in round 0. */
export type MatchedBy = "vector" | "text" | "web" | "page" | "programs" | "crm" | "gmail" | "drive" | "calendar" | "docs" | "market_guide" | "compliance_guide" | "facts_register" | "document";

export interface SearchQuery {
  text: string;
  k: number;
  /** Destination slugs; documents with country=null (global) are always eligible unless `includeGlobal` is false. */
  countries?: Destination[];
  /**
   * With `countries`, also admit global (country-less) chunks. Default true, which suits the
   * chat: general pages stay eligible whatever country is mentioned. False for a filter the
   * consultant picked: the ~4k global pages outrank a country's own few hundred and would fill
   * every result slot.
   */
  includeGlobal?: boolean;
  docTypes?: string[];
  /** Restrict to these `source` values (e.g. "experteducation.com", "partner:monash.edu", "upload:fee-sheet"). */
  sources?: string[];
  /** Restrict to provenance classes (site / partner / upload / program / official). */
  sourceKinds?: SourceKind[];
  /**
   * The student's source market (the route's origin). Not a filter: experteducation.com chunks
   * from that market's section rank first, then market-neutral pages, and other markets' pages
   * last or not at all (see `rankByMarket`). Partner, upload and program chunks are unaffected.
   */
  market?: Market;
}

export interface KnowledgeStore {
  search(query: SearchQuery, opts?: { signal?: AbortSignal }): Promise<RetrievedChunk[]>;
  ping(): Promise<boolean>;
  /** Approximate number of indexed chunks (for readiness). */
  count(): Promise<number>;
}

/** Store used in tests and when retrieval is disabled. */
export class NullKnowledgeStore implements KnowledgeStore {
  constructor(private readonly results: RetrievedChunk[] = []) {}
  async search() {
    return this.results;
  }
  async ping() {
    return true;
  }
  async count() {
    return this.results.length;
  }
}
