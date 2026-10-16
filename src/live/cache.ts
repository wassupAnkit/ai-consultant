import type { Collection } from "mongodb";
import { sha256 } from "../activity/identity";

/**
 * Short-TTL cache for live lookups (web searches, fetched pages) so repeated
 * questions in a session, or across consultants, don't re-hit the web. Always
 * best-effort: a cache failure never fails the lookup.
 */
export interface LiveCache {
  get<T>(kind: string, key: string): Promise<T | null>;
  set<T>(kind: string, key: string, value: T, ttlSeconds: number): Promise<void>;
}

export interface LiveCacheDoc {
  _id: string; // sha256(kind|key)
  kind: string;
  key: string;
  value: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export const cacheId = (kind: string, key: string) => sha256(`${kind}|${key}`);

export class InMemoryLiveCache implements LiveCache {
  private readonly map = new Map<string, { value: unknown; expiresAt: number }>();
  constructor(private readonly max = 500) {}

  async get<T>(kind: string, key: string): Promise<T | null> {
    const id = cacheId(kind, key);
    const hit = this.map.get(id);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.map.delete(id);
      return null;
    }
    // Refresh recency (Map preserves insertion order → simple LRU).
    this.map.delete(id);
    this.map.set(id, hit);
    return hit.value as T;
  }

  async set<T>(kind: string, key: string, value: T, ttlSeconds: number): Promise<void> {
    const id = cacheId(kind, key);
    this.map.delete(id);
    this.map.set(id, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size() {
    return this.map.size;
  }
}

/** MongoDB-backed cache (collection `live_cache`, TTL index on `expiresAt`) with a small in-memory front. */
export class MongoLiveCache implements LiveCache {
  constructor(
    private readonly col: Collection<LiveCacheDoc>,
    private readonly front: InMemoryLiveCache = new InMemoryLiveCache(200),
  ) {}

  async get<T>(kind: string, key: string): Promise<T | null> {
    const local = await this.front.get<T>(kind, key);
    if (local !== null) return local;
    try {
      const doc = await this.col.findOne({ _id: cacheId(kind, key), expiresAt: { $gt: new Date() } });
      if (!doc) return null;
      const ttl = Math.max(1, Math.round((doc.expiresAt.getTime() - Date.now()) / 1000));
      await this.front.set(kind, key, doc.value, ttl);
      return doc.value as T;
    } catch {
      return null;
    }
  }

  async set<T>(kind: string, key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.front.set(kind, key, value, ttlSeconds);
    const now = new Date();
    try {
      await this.col.replaceOne(
        { _id: cacheId(kind, key) },
        { kind, key, value, createdAt: now, expiresAt: new Date(now.getTime() + ttlSeconds * 1000) },
        { upsert: true },
      );
    } catch {
      /* best effort */
    }
  }
}
