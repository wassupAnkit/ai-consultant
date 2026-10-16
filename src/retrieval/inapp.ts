import type { Embeddings } from "@langchain/core/embeddings";
import type { Collections, KbChunkDoc } from "../db/mongo";
import { logger } from "../observability/logger";
import { marketOverFetch, rankByMarket } from "./market";
import { fuseRRF } from "./rrf";
import { sourceKindOf, withUpdatedAt, type KnowledgeStore, type MatchedBy, type RetrievedChunk, type SearchQuery, type SourceKind } from "./store";

type CachedChunk = Omit<KbChunkDoc, "embedding" | "metadata"> & { embedding: Float32Array };

/**
 * Hybrid retrieval for plain (non-Atlas) MongoDB deployments.
 *
 * Vector side: chunk embeddings are cached in process memory and scored with
 * cosine similarity (768 floats × ~20k chunks ≈ 60 MB, sub-10 ms scans).
 * Lexical side: MongoDB's standard `$text` index. Both are fused with RRF, so
 * behaviour matches the Atlas implementation.
 */
export class InAppKnowledgeStore implements KnowledgeStore {
  private cache: CachedChunk[] = [];
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly c: Collections,
    private readonly embeddings: Embeddings,
    private readonly opts: { refreshSeconds: number; candidates?: number; maxPerUrl?: number },
  ) {}

  /** Load (or refresh) the embedding cache. Safe to call concurrently. */
  async warm(force = false): Promise<void> {
    const stale = Date.now() - this.loadedAt > this.opts.refreshSeconds * 1000;
    if (!force && !stale && this.cache.length) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const started = performance.now();
      const next: CachedChunk[] = [];
      const cursor = this.c.kbChunks.find({}, { projection: { metadata: 0 } });
      for await (const d of cursor) {
        next.push({ ...d, embedding: Float32Array.from(d.embedding) });
      }
      this.cache = next;
      this.loadedAt = Date.now();
      logger.info("knowledge cache loaded", { chunks: next.length, ms: Math.round(performance.now() - started) });
    })().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  async search(query: SearchQuery, opts?: { signal?: AbortSignal }): Promise<RetrievedChunk[]> {
    await this.warm();
    const candidates = this.opts.candidates ?? 20;
    const maxPerUrl = this.opts.maxPerUrl ?? 2;
    const allow = chunkPredicate(query);

    const [queryVector, textHits] = await Promise.all([
      this.embeddings.embedQuery(query.text),
      this.textSearch(query, candidates, opts?.signal),
    ]);

    const q = Float32Array.from(queryVector);
    const scored: { id: string; item: CachedChunk; sim: number }[] = [];
    for (const ch of this.cache) {
      if (!allow(ch)) continue;
      scored.push({ id: ch._id, item: ch, sim: dot(q, ch.embedding) });
    }
    scored.sort((a, b) => b.sim - a.sim);
    const vectorHits = scored.slice(0, candidates);

    const fused = fuseRRF<CachedChunk>([
      { name: "vector", items: vectorHits.map((h) => ({ id: h.id, item: h.item })) },
      { name: "text", items: textHits.map((h) => ({ id: h._id, item: h })), weight: 0.8 },
    ]);

    const limit = marketOverFetch(query);
    const perUrl = new Map<string, number>();
    const out: RetrievedChunk[] = [];
    for (const f of fused) {
      const n = perUrl.get(f.item.url) ?? 0;
      if (n >= maxPerUrl) continue;
      perUrl.set(f.item.url, n + 1);
      out.push({
        id: f.id,
        url: f.item.url,
        title: f.item.title,
        section: f.item.section,
        docType: f.item.docType,
        country: f.item.country,
        source: f.item.source,
        sourceKind: f.item.sourceKind ?? sourceKindOf(f.item.source, f.item.docType),
        content: f.item.content,
        score: f.score,
        matchedBy: f.matchedBy as MatchedBy[],
        ...withUpdatedAt(f.item.updatedAt),
      });
      if (out.length >= limit) break;
    }
    return rankByMarket(out, query.market, query.k);
  }

  private async textSearch(query: SearchQuery, limit: number, signal?: AbortSignal): Promise<CachedChunk[]> {
    const filter: Record<string, unknown> = { $text: { $search: query.text }, ...inAppMongoFilter(query) };
    try {
      const docs = await this.c.kbChunks
        .find(filter as never, { projection: { score: { $meta: "textScore" }, embedding: 0, metadata: 0 }, signal })
        .sort({ score: { $meta: "textScore" } })
        .limit(limit)
        .toArray();
      return docs.map((d) => ({ ...d, embedding: new Float32Array(0) }) as CachedChunk);
    } catch (err) {
      logger.warn("$text search failed; using vector results only", { err: (err as Error).message });
      return [];
    }
  }

  async ping() {
    try {
      await this.c.kbChunks.findOne({}, { projection: { _id: 1 } });
      return true;
    } catch {
      return false;
    }
  }

  async count() {
    return this.cache.length || this.c.kbChunks.estimatedDocumentCount();
  }
}

/** The `$text` query's filter: the Atlas pre-filter in plain MongoDB syntax (null country counts as global). */
export function inAppMongoFilter(query: Pick<SearchQuery, "countries" | "includeGlobal" | "docTypes" | "sources" | "sourceKinds">): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.countries?.length) filter.country = { $in: query.includeGlobal === false ? [...query.countries] : [...query.countries, "global", null] };
  if (query.docTypes?.length) filter.docType = { $in: query.docTypes };
  if (query.sources?.length) filter.source = { $in: query.sources };
  if (query.sourceKinds?.length) filter.sourceKind = { $in: query.sourceKinds };
  return filter;
}

/** In-memory equivalent of the Atlas pre-filter (country / docType / source / sourceKind). */
export function chunkPredicate(query: Pick<SearchQuery, "countries" | "includeGlobal" | "docTypes" | "sources" | "sourceKinds">) {
  const strict = query.includeGlobal === false;
  const countries = query.countries?.length ? new Set<string>(strict ? query.countries : [...query.countries, "global"]) : null;
  const types = query.docTypes?.length ? new Set(query.docTypes) : null;
  const sources = query.sources?.length ? new Set(query.sources) : null;
  const kinds = query.sourceKinds?.length ? new Set<SourceKind>(query.sourceKinds) : null;
  return (ch: { country: string | null; docType: string; source: string; sourceKind?: SourceKind }) =>
    (!countries || (!strict && ch.country === null) || (ch.country !== null && countries.has(ch.country))) &&
    (!types || types.has(ch.docType)) &&
    (!sources || sources.has(ch.source)) &&
    (!kinds || kinds.has(ch.sourceKind ?? sourceKindOf(ch.source, ch.docType)));
}

/** Dot product; vectors are unit-normalised at embedding time so this equals cosine similarity. */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}
