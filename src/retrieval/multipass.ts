import { rankByMarket } from "./market";
import { fuseRRF } from "./rrf";
import { SOURCE_KINDS, type KnowledgeStore, type RetrievedChunk, type SearchQuery, type SourceKind } from "./store";

/** Per-provenance-class result quotas, e.g. `{ site: 4, partner: 5, program: 3, upload: 4 }`. */
export type RetrievalQuotas = Partial<Record<SourceKind, number>>;

/** Parse the `RETRIEVAL_QUOTAS` env format: "site:4,partner:5,program:3,upload:4". Unknown kinds are ignored. */
export function parseQuotas(spec: string | undefined): RetrievalQuotas | null {
  if (!spec?.trim()) return null;
  const out: RetrievalQuotas = {};
  for (const part of spec.split(",")) {
    const [k, v] = part.split(":").map((s) => s.trim());
    const n = Number(v);
    if ((SOURCE_KINDS as readonly string[]).includes(k ?? "") && Number.isFinite(n) && n > 0) out[k as SourceKind] = Math.floor(n);
  }
  return Object.keys(out).length ? out : null;
}

const DEFAULT_WEIGHTS: Record<SourceKind, number> = { official: 1.3, upload: 1.2, program: 1.1, site: 1.0, partner: 1.0 };

/**
 * Run one search per provenance class (each capped by its quota) and fuse the
 * lists with RRF, so ~150 partner-university sites cannot drown out the ~2,500
 * pages of experteducation.com, and staff uploads always get a seat at the
 * table. Queries that already restrict `sources`/`sourceKinds` bypass the quotas. Each pass
 * carries the query's `market`; the fused list is re-ranked by it again, so the site seats go to
 * the student's own and market-neutral pages whatever the inner store does.
 */
export async function searchWithQuotas(
  store: KnowledgeStore,
  query: SearchQuery,
  quotas: RetrievalQuotas,
  opts: { signal?: AbortSignal; weights?: Partial<Record<SourceKind, number>>; maxPerUrl?: number } = {},
): Promise<RetrievedChunk[]> {
  const kinds = (Object.keys(quotas) as SourceKind[]).filter((k) => (quotas[k] ?? 0) > 0);
  if (!kinds.length) return store.search(query, { signal: opts.signal });
  const passes = await Promise.all(
    kinds.map(async (kind) => {
      try {
        const items = await store.search({ ...query, k: quotas[kind]!, sourceKinds: [kind] }, { signal: opts.signal });
        return { kind, items };
      } catch {
        return { kind, items: [] as RetrievedChunk[] };
      }
    }),
  );
  // Nothing in any pass (e.g. chunks indexed before `sourceKind` existed, or a filter outage) → plain search so the
  // consultant still gets the knowledge base rather than an empty context.
  if (passes.every((p) => !p.items.length)) return store.search(query, { signal: opts.signal });
  const fused = fuseRRF<RetrievedChunk>(
    passes.map((p) => ({ name: p.kind, items: p.items.map((c) => ({ id: c.id, item: c })), weight: opts.weights?.[p.kind] ?? DEFAULT_WEIGHTS[p.kind] })),
  );
  const budget = kinds.reduce((n, k) => n + quotas[k]!, 0);
  const maxPerUrl = opts.maxPerUrl ?? 2;
  const perUrl = new Map<string, number>();
  const out: RetrievedChunk[] = [];
  for (const f of fused) {
    const n = perUrl.get(f.item.url) ?? 0;
    if (n >= maxPerUrl) continue;
    perUrl.set(f.item.url, n + 1);
    // Keep the underlying retriever's provenance (vector/text) and its fused score for display.
    out.push({ ...f.item, sourceKind: f.item.sourceKind ?? (f.matchedBy[0] as SourceKind) });
    if (out.length >= Math.max(query.k, budget)) break;
  }
  return rankByMarket(out, query.market, out.length);
}

/** KnowledgeStore wrapper applying quotas to every unrestricted search. */
export class QuotaKnowledgeStore implements KnowledgeStore {
  constructor(
    private readonly inner: KnowledgeStore,
    private readonly quotas: RetrievalQuotas,
  ) {}

  search(query: SearchQuery, opts?: { signal?: AbortSignal }): Promise<RetrievedChunk[]> {
    if (query.sources?.length || query.sourceKinds?.length) return this.inner.search(query, opts);
    return searchWithQuotas(this.inner, query, this.quotas, { signal: opts?.signal });
  }
  ping() {
    return this.inner.ping();
  }
  count() {
    return this.inner.count();
  }
}
