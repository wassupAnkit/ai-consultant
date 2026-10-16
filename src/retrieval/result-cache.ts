import { sha256 } from "../activity/identity";
import type { Collections } from "../db/mongo";
import { logger } from "../observability/logger";
import type { KnowledgeStore, RetrievedChunk, SearchQuery } from "./store";

/** Returns a string that changes whenever the indexed knowledge base may have changed. */
export type KbVersionSource = () => Promise<string>;

export interface CachedKnowledgeStoreOptions {
  /** 0 disables the cache (pure pass-through). */
  ttlSeconds: number;
  maxEntries?: number;
  version?: KbVersionSource;
  /** How often `version` is consulted at most. */
  versionRefreshSeconds?: number;
  now?: () => number;
}

const sortedSet = (xs: readonly string[] | undefined) => (xs?.length ? [...new Set(xs)].sort() : null);

/**
 * Canonical form of a search: text trimmed, whitespace collapsed and lowercased; filter
 * arrays deduped and sorted; empty arrays and absent ones equal; `includeGlobal` read the
 * way the stores read it (only an explicit false is strict). The student's `market` is part of
 * the key: it re-ranks the results, so a Nepal entry must never answer a Vietnamese search.
 */
export function canonicalSearchKey(q: SearchQuery): string {
  return JSON.stringify({
    text: q.text.trim().replace(/\s+/g, " ").toLowerCase(),
    k: q.k,
    countries: sortedSet(q.countries),
    includeGlobal: q.includeGlobal !== false,
    docTypes: sortedSet(q.docTypes),
    sources: sortedSet(q.sources),
    sourceKinds: sortedSet(q.sourceKinds),
    market: q.market ?? null,
  });
}

/**
 * Per-pod, exact-match cache of knowledge-base search results. Evidence only: final
 * answers are never cached (regulations change, and CRM data is per consultant). Keys
 * carry the KB version, so a finished ingest run or a new/removed upload makes every
 * older entry unreachable within `versionRefreshSeconds`; the TTL bounds staleness for
 * anything the version cannot see (e.g. chunks written mid-run). Results are stored and
 * returned as deep copies. Empty results and errors are not cached, so a transient
 * outage is not remembered for the whole TTL.
 */
export class CachedKnowledgeStore implements KnowledgeStore {
  private readonly entries = new Map<string, { value: RetrievedChunk[]; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly refreshMs: number;
  private readonly now: () => number;
  private version = "";
  private versionCheckedAt = -Infinity;
  private versionPending: Promise<string> | null = null;

  constructor(
    private readonly inner: KnowledgeStore,
    private readonly opts: CachedKnowledgeStoreOptions,
  ) {
    this.ttlMs = Math.max(0, opts.ttlSeconds) * 1000;
    this.maxEntries = opts.maxEntries ?? 500;
    this.refreshMs = (opts.versionRefreshSeconds ?? 60) * 1000;
    this.now = opts.now ?? Date.now;
  }

  async search(query: SearchQuery, opts?: { signal?: AbortSignal }): Promise<RetrievedChunk[]> {
    if (!this.ttlMs) return this.inner.search(query, opts);
    const version = await this.currentVersion();
    const id = sha256(`${version}|${canonicalSearchKey(query)}`);
    const hit = this.entries.get(id);
    if (hit && hit.expiresAt > this.now()) {
      this.entries.delete(id);
      this.entries.set(id, hit);
      return structuredClone(hit.value);
    }
    if (hit) this.entries.delete(id);
    const value = await this.inner.search(query, opts);
    if (value.length) {
      this.entries.set(id, { value: structuredClone(value), expiresAt: this.now() + this.ttlMs });
      while (this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
    }
    return value;
  }

  /** The KB version, re-read at most once per refresh interval; a failed read keeps the last one. */
  private async currentVersion(): Promise<string> {
    const source = this.opts.version;
    if (!source || this.now() - this.versionCheckedAt < this.refreshMs) return this.version;
    this.versionPending ??= source()
      .then((v) => {
        if (v !== this.version) {
          // Older entries are unreachable now (the version is in the key); free them.
          if (this.version) this.entries.clear();
          this.version = v;
        }
        return v;
      })
      .catch((err) => {
        logger.debug("kb version check failed; keeping the last one", { err: (err as Error).message });
        return this.version;
      })
      .finally(() => {
        this.versionCheckedAt = this.now();
        this.versionPending = null;
      });
    return this.versionPending;
  }

  ping() {
    return this.inner.ping();
  }
  count() {
    return this.inner.count();
  }
}

/**
 * KB version from MongoDB: the latest finished ingest run (CronJob pods write
 * `kb_ingest_runs`), plus the uploads, which are indexed in-process without a run
 * (latest `ready` update, and the count so a removal is seen).
 */
export function kbVersionFromMongo(c: Pick<Collections, "kbIngestRuns" | "kbDocuments">): KbVersionSource {
  return async () => {
    const [run, doc, docs] = await Promise.all([
      c.kbIngestRuns.find({ finishedAt: { $ne: null } }).sort({ finishedAt: -1 }).limit(1).project<{ _id: string; finishedAt: Date }>({ _id: 1, finishedAt: 1 }).next(),
      c.kbDocuments.find({ status: "ready" }).sort({ updatedAt: -1 }).limit(1).project<{ updatedAt: Date }>({ _id: 0, updatedAt: 1 }).next(),
      c.kbDocuments.estimatedDocumentCount(),
    ]);
    return `run:${run?._id ?? "-"}@${run?.finishedAt?.getTime() ?? 0}|docs:${docs}@${doc?.updatedAt?.getTime() ?? 0}`;
  };
}
