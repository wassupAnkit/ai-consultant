import type { Document } from "mongodb";
import type { Embeddings } from "@langchain/core/embeddings";
import type { Collections } from "../db/mongo";
import { logger } from "../observability/logger";
import { marketOverFetch, rankByMarket } from "./market";
import { fuseRRF } from "./rrf";
import { sourceKindOf, withUpdatedAt, type KnowledgeStore, type MatchedBy, type RetrievedChunk, type SearchQuery } from "./store";

export interface MongoKnowledgeStoreOptions {
  vectorIndex: string;
  textIndex: string;
  /** Candidates fetched from each retriever before fusion. */
  candidates?: number;
  /** Max chunks per URL in the final result so one page cannot dominate. */
  maxPerUrl?: number;
}

type Projected = Omit<RetrievedChunk, "score" | "matchedBy" | "updatedAt"> & { _id: string; score: number; updatedAt?: Date };

/**
 * Hybrid retrieval on MongoDB Atlas: `$vectorSearch` (HNSW, cosine) and Atlas
 * Search full-text run in parallel, then Reciprocal Rank Fusion merges them.
 * Fusion is done in the application so it works on any Atlas version
 * (`$rankFusion` needs 8.1+) and degrades to vector-only if the text index is
 * not ready yet.
 */
export class MongoKnowledgeStore implements KnowledgeStore {
  private readonly candidates: number;
  private readonly maxPerUrl: number;

  constructor(
    private readonly c: Collections,
    private readonly embeddings: Embeddings,
    private readonly opts: MongoKnowledgeStoreOptions,
  ) {
    this.candidates = opts.candidates ?? 20;
    this.maxPerUrl = opts.maxPerUrl ?? 2;
  }

  async search(query: SearchQuery, opts?: { signal?: AbortSignal }): Promise<RetrievedChunk[]> {
    const filter = buildFilter(query);
    const queryVector = await this.embeddings.embedQuery(query.text);

    const [vectorHits, textHits] = await Promise.all([
      this.vectorSearch(queryVector, filter, opts?.signal),
      this.textSearch(query.text, query, opts?.signal),
    ]);

    const fused = fuseRRF<Projected>([
      { name: "vector", items: vectorHits.map((h) => ({ id: h._id, item: h })) },
      { name: "text", items: textHits.map((h) => ({ id: h._id, item: h })), weight: 0.8 },
    ]);

    // With a market, over-fetch so the student's own and market-neutral pages can replace other markets'.
    const limit = marketOverFetch(query);
    const perUrl = new Map<string, number>();
    const out: RetrievedChunk[] = [];
    for (const f of fused) {
      const n = perUrl.get(f.item.url) ?? 0;
      if (n >= this.maxPerUrl) continue;
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

  private async vectorSearch(queryVector: number[], filter: Document | undefined, signal?: AbortSignal): Promise<Projected[]> {
    const pipeline: Document[] = [
      {
        $vectorSearch: {
          index: this.opts.vectorIndex,
          path: "embedding",
          queryVector,
          numCandidates: Math.max(this.candidates * 10, 150),
          limit: this.candidates,
          ...(filter ? { filter } : {}),
        },
      },
      { $project: PROJECTION_WITH_SCORE("vectorSearchScore") },
    ];
    return this.c.kbChunks.aggregate<Projected>(pipeline, { signal }).toArray();
  }

  private async textSearch(text: string, query: SearchQuery, signal?: AbortSignal): Promise<Projected[]> {
    const filters = textSearchFilters(query);
    const pipeline: Document[] = [
      {
        $search: {
          index: this.opts.textIndex,
          compound: {
            must: [{ text: { query: text, path: ["title", "section", "content"], fuzzy: { maxEdits: 1, prefixLength: 3 } } }],
            ...(filters.length ? { filter: filters } : {}),
          },
        },
      },
      { $limit: this.candidates },
      { $project: PROJECTION_WITH_SCORE("searchScore") },
    ];
    try {
      return await this.c.kbChunks.aggregate<Projected>(pipeline, { signal }).toArray();
    } catch (err) {
      logger.warn("text search failed; using vector results only", { err: (err as Error).message });
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
    return this.c.kbChunks.estimatedDocumentCount();
  }
}

const PROJECTION_WITH_SCORE = (meta: "vectorSearchScore" | "searchScore"): Document => ({
  _id: 1,
  url: 1,
  title: 1,
  section: 1,
  docType: 1,
  country: 1,
  source: 1,
  sourceKind: 1,
  content: 1,
  updatedAt: 1,
  score: { $meta: meta },
});

/**
 * Vector-search pre-filter. Country-specific chunks are only eligible when the
 * consultant's request mentions that country; global chunks (country = "global")
 * always are. The "global" sentinel is used instead of null because Atlas filter
 * fields cannot match null reliably. `source` / `sourceKind` narrow to one
 * provenance (e.g. one partner university, or staff uploads only).
 */
export function buildFilter(query: SearchQuery): Document | undefined {
  const clauses: Document[] = [];
  if (query.countries?.length) clauses.push({ country: { $in: countryValues(query) } });
  if (query.docTypes?.length) clauses.push({ docType: { $in: query.docTypes } });
  if (query.sources?.length) clauses.push({ source: { $in: query.sources } });
  if (query.sourceKinds?.length) clauses.push({ sourceKind: { $in: query.sourceKinds } });
  if (!clauses.length) return undefined;
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

/** Country values a filter admits: the requested destinations, plus "global" unless the filter is strict. */
function countryValues(query: Pick<SearchQuery, "countries" | "includeGlobal">): string[] {
  return query.includeGlobal === false ? [...query.countries!] : [...query.countries!, "global"];
}

/** Atlas Search `compound.filter` clauses; the same restrictions as `buildFilter`, in `$search` syntax. */
export function textSearchFilters(query: SearchQuery): Document[] {
  const filters: Document[] = [];
  if (query.countries?.length) filters.push({ in: { path: "country", value: countryValues(query) } });
  if (query.docTypes?.length) filters.push({ in: { path: "docType", value: query.docTypes } });
  if (query.sources?.length) filters.push({ in: { path: "source", value: query.sources } });
  if (query.sourceKinds?.length) filters.push({ in: { path: "sourceKind", value: query.sourceKinds } });
  return filters;
}
