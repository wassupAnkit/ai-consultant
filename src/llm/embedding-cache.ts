import { Embeddings } from "@langchain/core/embeddings";
import type { Collection } from "mongodb";
import { sha256 } from "../activity/identity";
import { logger } from "../observability/logger";

/** A persisted query vector (collection `embedding_cache`, TTL index on `expiresAt`). */
export interface EmbeddingCacheDoc {
  _id: string; // sha256(model|dims|text)
  model: string;
  dims: number;
  vector: number[];
  createdAt: Date;
  expiresAt: Date;
}

export interface CachedEmbeddingsOptions {
  /** Model id in the key; defaults to the inner model's `model`. */
  model?: string;
  /** Output size in the key; defaults to the inner model's `dimensions`. */
  dimensions?: number;
  /** In-memory LRU size. */
  maxEntries?: number;
  /** Optional shared layer across replicas. */
  collection?: Collection<EmbeddingCacheDoc>;
  ttlDays?: number;
  /** A Mongo read slower than this falls through to the model. */
  readTimeoutMs?: number;
  now?: () => number;
}

/** Model and dimensions are in the key, so changing either never serves a stale vector. */
export const embeddingCacheKey = (model: string, dims: number, text: string) => sha256(`${model}|${dims}|${text}`);

/**
 * Exact-match cache for query embeddings (never `embedDocuments`: ingest always embeds fresh).
 * Three layers: identical in-flight requests share one promise (the quota fan-out searches
 * the same text once per source kind, all at once), an in-memory LRU, then an optional
 * Mongo collection shared by the replicas. The Mongo layer is best-effort: read-through
 * with a timeout, write-behind, and every failure is swallowed so it never fails a search.
 */
export class CachedEmbeddings extends Embeddings {
  readonly model: string;
  readonly dimensions: number;
  private readonly lru = new Map<string, number[]>();
  private readonly inflight = new Map<string, Promise<number[]>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly readTimeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly inner: Embeddings,
    private readonly opts: CachedEmbeddingsOptions = {},
  ) {
    super({});
    const self = inner as Embeddings & { model?: string; dimensions?: number };
    this.model = opts.model ?? self.model ?? "unknown";
    this.dimensions = opts.dimensions ?? self.dimensions ?? 0;
    this.maxEntries = opts.maxEntries ?? 1_000;
    this.ttlMs = (opts.ttlDays ?? 30) * 86_400_000;
    this.readTimeoutMs = opts.readTimeoutMs ?? 300;
    this.now = opts.now ?? Date.now;
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.inner.embedDocuments(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    const id = embeddingCacheKey(this.model, this.dimensions, text);
    const hit = this.lru.get(id);
    if (hit) {
      // Refresh recency (Map preserves insertion order → simple LRU).
      this.lru.delete(id);
      this.lru.set(id, hit);
      return hit.slice();
    }
    let pending = this.inflight.get(id);
    if (!pending) {
      pending = this.load(id, text).finally(() => this.inflight.delete(id));
      this.inflight.set(id, pending);
    }
    // Copies, so a caller mutating its vector cannot touch the cache or another caller's.
    return (await pending).slice();
  }

  private async load(id: string, text: string): Promise<number[]> {
    const stored = await this.readStored(id);
    if (stored) {
      this.remember(id, stored);
      return stored;
    }
    const vector = await this.inner.embedQuery(text);
    this.remember(id, vector);
    void this.persist(id, vector);
    return vector;
  }

  private remember(id: string, vector: number[]) {
    this.lru.set(id, vector);
    while (this.lru.size > this.maxEntries) {
      const oldest = this.lru.keys().next().value;
      if (oldest === undefined) break;
      this.lru.delete(oldest);
    }
  }

  private async readStored(id: string): Promise<number[] | null> {
    const col = this.opts.collection;
    if (!col) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), this.readTimeoutMs);
      });
      const doc = await Promise.race([col.findOne({ _id: id, expiresAt: { $gt: new Date(this.now()) } }, { projection: { vector: 1 } }), timeout]);
      const v = doc?.vector;
      // A malformed row (wrong size) is treated as a miss rather than poisoning a search.
      return v?.length && (!this.dimensions || v.length === this.dimensions) ? v : null;
    } catch (err) {
      logger.debug("embedding cache read failed", { err: (err as Error).message });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async persist(id: string, vector: number[]) {
    const col = this.opts.collection;
    if (!col) return;
    const now = new Date(this.now());
    try {
      await col.replaceOne(
        { _id: id },
        { model: this.model, dims: this.dimensions, vector, createdAt: now, expiresAt: new Date(now.getTime() + this.ttlMs) },
        { upsert: true },
      );
    } catch (err) {
      logger.debug("embedding cache write failed", { err: (err as Error).message });
    }
  }
}
