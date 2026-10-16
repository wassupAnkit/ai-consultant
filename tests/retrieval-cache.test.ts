import { describe, expect, test } from "bun:test";
import { Embeddings } from "@langchain/core/embeddings";
import type { Collection } from "mongodb";
import { CachedEmbeddings, embeddingCacheKey, type EmbeddingCacheDoc } from "../src/llm/embedding-cache";
import { canonicalSearchKey, CachedKnowledgeStore, kbVersionFromMongo } from "../src/retrieval/result-cache";
import { QuotaKnowledgeStore, searchWithQuotas } from "../src/retrieval/multipass";
import { MongoKnowledgeStore } from "../src/retrieval/mongo";
import { type KnowledgeStore, type RetrievedChunk, type SearchQuery } from "../src/retrieval/store";
import type { Collections } from "../src/db/mongo";
import { testEnv, sampleChunk } from "./helpers";

/** Counts calls; resolves after a tick so concurrent callers really overlap. */
class CountingEmbeddings extends Embeddings {
  readonly queries: string[] = [];
  readonly documents: string[][] = [];
  fail = false;
  constructor(
    readonly model = "models/gemini-embedding-001",
    readonly dimensions = 4,
  ) {
    super({});
  }
  async embedDocuments(texts: string[]) {
    this.documents.push(texts);
    return texts.map((t) => [t.length, 0, 0, 1]);
  }
  async embedQuery(text: string) {
    this.queries.push(text);
    await Bun.sleep(1);
    if (this.fail) throw new Error("gemini down");
    return [text.length, 1, 2, 3];
  }
}

/** Minimal stand-in for the `embedding_cache` collection. */
class FakeEmbeddingCollection {
  readonly docs = new Map<string, EmbeddingCacheDoc>();
  reads = 0;
  writes = 0;
  failReads = false;
  failWrites = false;
  async findOne(filter: { _id: string; expiresAt?: { $gt: Date } }) {
    this.reads++;
    if (this.failReads) throw new Error("mongo read down");
    const d = this.docs.get(filter._id);
    if (!d || (filter.expiresAt && d.expiresAt <= filter.expiresAt.$gt)) return null;
    return d;
  }
  async replaceOne(filter: { _id: string }, doc: Omit<EmbeddingCacheDoc, "_id">) {
    this.writes++;
    if (this.failWrites) throw new Error("mongo write down");
    this.docs.set(filter._id, { _id: filter._id, ...doc });
    return { acknowledged: true };
  }
  asCollection() {
    return this as unknown as Collection<EmbeddingCacheDoc>;
  }
}

const flush = () => Bun.sleep(5);

describe("CachedEmbeddings", () => {
  test("concurrent identical queries share one upstream call", async () => {
    const inner = new CountingEmbeddings();
    const cached = new CachedEmbeddings(inner);
    const out = await Promise.all([1, 2, 3, 4].map(() => cached.embedQuery("student visa fees")));
    expect(inner.queries).toHaveLength(1);
    expect(out.every((v) => v.length === 4 && v[0] === "student visa fees".length)).toBe(true);
    // Each caller gets its own array, so one mutating its vector cannot touch another's.
    out[0]![0] = -1;
    expect(out[1]![0]).toBe("student visa fees".length);
  });

  test("LRU serves repeats and evicts the least recently used", async () => {
    const inner = new CountingEmbeddings();
    const cached = new CachedEmbeddings(inner, { maxEntries: 2 });
    await cached.embedQuery("a");
    await cached.embedQuery("b");
    await cached.embedQuery("a"); // hit; "a" becomes most recent
    expect(inner.queries).toEqual(["a", "b"]);
    await cached.embedQuery("c"); // evicts "b"
    await cached.embedQuery("a");
    expect(inner.queries).toEqual(["a", "b", "c"]);
    await cached.embedQuery("b");
    expect(inner.queries).toEqual(["a", "b", "c", "b"]);
    const v = await cached.embedQuery("a");
    v[0] = 99;
    expect((await cached.embedQuery("a"))[0]).toBe(1);
  });

  test("the key carries model and dimensions", async () => {
    expect(embeddingCacheKey("m1", 768, "x")).not.toBe(embeddingCacheKey("m2", 768, "x"));
    expect(embeddingCacheKey("m1", 768, "x")).not.toBe(embeddingCacheKey("m1", 1536, "x"));
    expect(embeddingCacheKey("m1", 768, "x")).toBe(embeddingCacheKey("m1", 768, "x"));

    // A persisted vector from another model or size is never served.
    const col = new FakeEmbeddingCollection();
    await new CachedEmbeddings(new CountingEmbeddings("models/a", 4), { collection: col.asCollection() }).embedQuery("q");
    await flush();
    expect(col.docs.size).toBe(1);
    const other = new CountingEmbeddings("models/b", 4);
    await new CachedEmbeddings(other, { collection: col.asCollection() }).embedQuery("q");
    const resized = new CountingEmbeddings("models/a", 8);
    await new CachedEmbeddings(resized, { collection: col.asCollection() }).embedQuery("q");
    expect(other.queries).toEqual(["q"]);
    expect(resized.queries).toEqual(["q"]);
    // Model and dims default to the inner model's own, and can be given explicitly.
    const explicit = new CountingEmbeddings("models/a", 4);
    await new CachedEmbeddings(explicit, { collection: col.asCollection(), model: "models/a", dimensions: 4 }).embedQuery("q");
    expect(explicit.queries).toEqual([]);
  });

  test("Mongo layer: read-through across pods, write-behind with TTL", async () => {
    const col = new FakeEmbeddingCollection();
    let now = Date.UTC(2026, 9, 8);
    const first = new CachedEmbeddings(new CountingEmbeddings(), { collection: col.asCollection(), ttlDays: 30, now: () => now });
    await first.embedQuery("ielts band for canada");
    await flush();
    const doc = [...col.docs.values()][0]!;
    expect(doc._id).toBe(embeddingCacheKey("models/gemini-embedding-001", 4, "ielts band for canada"));
    expect(doc.vector).toEqual(["ielts band for canada".length, 1, 2, 3]);
    expect(doc.expiresAt.getTime() - doc.createdAt.getTime()).toBe(30 * 86_400_000);

    // Another replica (fresh memory) reads it instead of calling Gemini.
    const inner2 = new CountingEmbeddings();
    const second = new CachedEmbeddings(inner2, { collection: col.asCollection(), now: () => now });
    expect(await second.embedQuery("ielts band for canada")).toEqual(doc.vector);
    expect(inner2.queries).toEqual([]);

    // Expired rows are ignored even before Mongo's TTL monitor removes them.
    now += 31 * 86_400_000;
    const inner3 = new CountingEmbeddings();
    await new CachedEmbeddings(inner3, { collection: col.asCollection(), now: () => now }).embedQuery("ielts band for canada");
    expect(inner3.queries).toHaveLength(1);
  });

  test("Mongo failures never fail a query", async () => {
    const col = new FakeEmbeddingCollection();
    col.failReads = true;
    col.failWrites = true;
    const inner = new CountingEmbeddings();
    const cached = new CachedEmbeddings(inner, { collection: col.asCollection() });
    expect(await cached.embedQuery("x")).toEqual([1, 1, 2, 3]);
    await flush();
    expect(col.reads).toBe(1);
    expect(col.writes).toBe(1);
    // The in-memory layer still works.
    await cached.embedQuery("x");
    expect(inner.queries).toEqual(["x"]);
  });

  test("a hanging Mongo read falls through to the model", async () => {
    const col = new FakeEmbeddingCollection();
    col.findOne = () => new Promise(() => {}) as never;
    const inner = new CountingEmbeddings();
    const cached = new CachedEmbeddings(inner, { collection: col.asCollection(), readTimeoutMs: 10 });
    expect(await cached.embedQuery("x")).toEqual([1, 1, 2, 3]);
    expect(inner.queries).toEqual(["x"]);
  });

  test("upstream errors propagate, are not cached, and clear the in-flight slot", async () => {
    const inner = new CountingEmbeddings();
    inner.fail = true;
    const cached = new CachedEmbeddings(inner);
    const results = await Promise.allSettled([cached.embedQuery("x"), cached.embedQuery("x")]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(inner.queries).toHaveLength(1);
    inner.fail = false;
    expect(await cached.embedQuery("x")).toEqual([1, 1, 2, 3]);
    expect(inner.queries).toHaveLength(2);
  });

  test("embedDocuments is never cached", async () => {
    const inner = new CountingEmbeddings();
    const col = new FakeEmbeddingCollection();
    const cached = new CachedEmbeddings(inner, { collection: col.asCollection() });
    await cached.embedDocuments(["a", "b"]);
    await cached.embedDocuments(["a", "b"]);
    await flush();
    expect(inner.documents).toHaveLength(2);
    expect(col.writes).toBe(0);
  });
});

// ---------------------------------------------------------------------------

class RecordingStore implements KnowledgeStore {
  readonly queries: SearchQuery[] = [];
  constructor(private readonly results: RetrievedChunk[] = [sampleChunk(1), sampleChunk(2)]) {}
  async search(q: SearchQuery) {
    this.queries.push(q);
    return this.results.map((r) => ({ ...r, matchedBy: [...r.matchedBy] }));
  }
  async ping() {
    return true;
  }
  async count() {
    return this.results.length;
  }
}

describe("CachedKnowledgeStore", () => {
  test("canonical key: whitespace, case, array order and defaults do not matter; filters do", () => {
    const a = canonicalSearchKey({ text: "  Student   VISA fees ", k: 6, countries: ["canada", "australia"], sourceKinds: ["site", "partner"] });
    const b = canonicalSearchKey({ text: "student visa fees", k: 6, countries: ["australia", "canada"], sourceKinds: ["partner", "site"], includeGlobal: true, docTypes: [] });
    expect(a).toBe(b);
    expect(canonicalSearchKey({ text: "x", k: 6 })).not.toBe(canonicalSearchKey({ text: "x", k: 5 }));
    expect(canonicalSearchKey({ text: "x", k: 6, countries: ["canada"] })).not.toBe(
      canonicalSearchKey({ text: "x", k: 6, countries: ["canada"], includeGlobal: false }),
    );
    expect(canonicalSearchKey({ text: "x", k: 6, sources: ["upload:a"] })).not.toBe(canonicalSearchKey({ text: "x", k: 6, sources: ["upload:b"] }));
    expect(canonicalSearchKey({ text: "x", k: 6, docTypes: ["program"] })).not.toBe(canonicalSearchKey({ text: "x", k: 6 }));
  });

  test("hit on a canonical-equal query, miss on a different one", async () => {
    const inner = new RecordingStore();
    const store = new CachedKnowledgeStore(inner, { ttlSeconds: 600 });
    const first = await store.search({ text: "Student visa fees", k: 6, countries: ["canada", "australia"] });
    const second = await store.search({ text: "student  visa fees", k: 6, countries: ["australia", "canada"] });
    expect(inner.queries).toHaveLength(1);
    expect(second).toEqual(first);
    await store.search({ text: "student visa fees", k: 6, countries: ["australia"] });
    expect(inner.queries).toHaveLength(2);
  });

  test("returns copies, so callers mutating results cannot corrupt the cache", async () => {
    const store = new CachedKnowledgeStore(new RecordingStore(), { ttlSeconds: 600 });
    const first = await store.search({ text: "fees", k: 6 });
    first[0]!.content = "tampered";
    first[0]!.matchedBy.push("web");
    first.pop();
    const second = await store.search({ text: "fees", k: 6 });
    expect(second).toHaveLength(2);
    expect(second[0]!.content).toBe(sampleChunk(1).content);
    expect(second[0]!.matchedBy).toEqual(["vector"]);
  });

  test("entries expire after the TTL (injected clock)", async () => {
    let now = 0;
    const inner = new RecordingStore();
    const store = new CachedKnowledgeStore(inner, { ttlSeconds: 600, now: () => now });
    await store.search({ text: "fees", k: 6 });
    now = 599_000;
    await store.search({ text: "fees", k: 6 });
    expect(inner.queries).toHaveLength(1);
    now = 600_001;
    await store.search({ text: "fees", k: 6 });
    expect(inner.queries).toHaveLength(2);
  });

  test("a new kbVersion invalidates, checked at most once per refresh interval", async () => {
    let now = 0;
    let version = "run-1";
    let versionReads = 0;
    const inner = new RecordingStore();
    const store = new CachedKnowledgeStore(inner, {
      ttlSeconds: 600,
      versionRefreshSeconds: 60,
      now: () => now,
      version: async () => {
        versionReads++;
        return version;
      },
    });
    await store.search({ text: "fees", k: 6 });
    version = "run-2";
    now = 30_000; // inside the refresh window: still the old version
    await store.search({ text: "fees", k: 6 });
    expect(inner.queries).toHaveLength(1);
    expect(versionReads).toBe(1);
    now = 61_000;
    await store.search({ text: "fees", k: 6 });
    expect(inner.queries).toHaveLength(2);
    expect(versionReads).toBe(2);
    await store.search({ text: "fees", k: 6 });
    expect(inner.queries).toHaveLength(2);
  });

  test("a failing version lookup keeps serving (and keeps the last version)", async () => {
    let now = 0;
    let fail = false;
    const inner = new RecordingStore();
    const store = new CachedKnowledgeStore(inner, {
      ttlSeconds: 600,
      now: () => now,
      version: async () => {
        if (fail) throw new Error("mongo down");
        return "run-1";
      },
    });
    await store.search({ text: "fees", k: 6 });
    fail = true;
    now = 120_000;
    expect(await store.search({ text: "fees", k: 6 })).toHaveLength(2);
    expect(inner.queries).toHaveLength(1);
  });

  test("TTL 0 disables caching; empty results and errors are not cached", async () => {
    const inner = new RecordingStore();
    const off = new CachedKnowledgeStore(inner, { ttlSeconds: 0 });
    await off.search({ text: "fees", k: 6 });
    await off.search({ text: "fees", k: 6 });
    expect(inner.queries).toHaveLength(2);

    const empty = new RecordingStore([]);
    const store = new CachedKnowledgeStore(empty, { ttlSeconds: 600 });
    await store.search({ text: "fees", k: 6 });
    await store.search({ text: "fees", k: 6 });
    expect(empty.queries).toHaveLength(2);

    let calls = 0;
    const flaky: KnowledgeStore = {
      search: async () => {
        if (++calls === 1) throw new Error("boom");
        return [sampleChunk(1)];
      },
      ping: async () => true,
      count: async () => 1,
    };
    const s2 = new CachedKnowledgeStore(flaky, { ttlSeconds: 600 });
    await expect(s2.search({ text: "fees", k: 6 })).rejects.toThrow("boom");
    expect(await s2.search({ text: "fees", k: 6 })).toHaveLength(1);
    expect(calls).toBe(2);
  });

  test("ping and count pass through", async () => {
    const store = new CachedKnowledgeStore(new RecordingStore(), { ttlSeconds: 600 });
    expect(await store.ping()).toBe(true);
    expect(await store.count()).toBe(2);
  });

  test("wrapping a QuotaKnowledgeStore caches both quota and restricted searches", async () => {
    const inner = new RecordingStore([{ ...sampleChunk(1), sourceKind: "site" }]);
    const store = new CachedKnowledgeStore(new QuotaKnowledgeStore(inner, { site: 2, partner: 2 }), { ttlSeconds: 600 });
    await store.search({ text: "fees", k: 6 });
    await store.search({ text: "fees", k: 6 });
    expect(inner.queries).toHaveLength(2); // one fan-out (2 passes), then a hit
    await store.search({ text: "fees", k: 6, sources: ["upload:x"] });
    await store.search({ text: "fees", k: 6, sources: ["upload:x"] });
    expect(inner.queries).toHaveLength(3);
  });
});

describe("kbVersionFromMongo", () => {
  const fakeCollections = (state: { run: { _id: string; finishedAt: Date } | null; doc: { updatedAt: Date } | null; docs: number }) =>
    ({
      kbIngestRuns: {
        find: () => ({ sort: () => ({ limit: () => ({ project: () => ({ next: async () => state.run }) }) }) }),
      },
      kbDocuments: {
        find: () => ({ sort: () => ({ limit: () => ({ project: () => ({ next: async () => state.doc }) }) }) }),
        estimatedDocumentCount: async () => state.docs,
      },
    }) as unknown as Pick<Collections, "kbIngestRuns" | "kbDocuments">;

  test("changes when an ingest run finishes or an upload is indexed or removed", async () => {
    const state = { run: { _id: "r1", finishedAt: new Date(1_000) }, doc: { updatedAt: new Date(2_000) }, docs: 3 } as Parameters<typeof fakeCollections>[0];
    const version = kbVersionFromMongo(fakeCollections(state));
    const v1 = await version();
    expect(await version()).toBe(v1);
    state.run = { _id: "r2", finishedAt: new Date(5_000) };
    const v2 = await version();
    expect(v2).not.toBe(v1);
    state.doc = { updatedAt: new Date(6_000) };
    const v3 = await version();
    expect(v3).not.toBe(v2);
    state.docs = 2;
    expect(await version()).not.toBe(v3);
    state.run = null;
    state.doc = null;
    expect(typeof (await version())).toBe("string");
  });
});

describe("cached embeddings under the quota fan-out", () => {
  test("a 4-pass searchWithQuotas makes one embedding call", async () => {
    const inner = new CountingEmbeddings("models/gemini-embedding-001", 4);
    const embeddings = new CachedEmbeddings(inner);
    const hit = (kind: string) => ({ _id: `${kind}-1`, url: `https://x/${kind}`, title: "t", section: "s", docType: "page", country: null, source: kind === "partner" ? "partner:x" : "experteducation.com", sourceKind: kind, content: "c", score: 1 });
    const kbChunks = {
      aggregate: (pipeline: Record<string, { filter?: { sourceKind?: { $in: string[] } }; compound?: unknown }>[]) => ({
        toArray: async () => {
          const stage = pipeline[0]!;
          const kind = stage.$vectorSearch?.filter?.sourceKind?.$in[0];
          return kind ? [hit(kind)] : [];
        },
      }),
    };
    const store = new MongoKnowledgeStore({ kbChunks } as unknown as Collections, embeddings, { vectorIndex: "v", textIndex: "t" });
    const out = await searchWithQuotas(store, { text: "masters in data science fees", k: 6 }, { site: 4, partner: 5, program: 3, upload: 4 });
    expect(inner.queries).toEqual(["masters in data science fees"]);
    expect(out.map((c) => c.sourceKind).sort()).toEqual(["partner", "program", "site", "upload"]);
  });
});

describe("env", () => {
  test("cache settings have production defaults and can be turned off", () => {
    const env = testEnv();
    expect(env.EMBEDDING_CACHE_ENABLED).toBe(true);
    expect(env.EMBEDDING_CACHE_TTL_DAYS).toBe(30);
    expect(env.KB_RESULT_CACHE_TTL_SECONDS).toBe(600);
    const off = testEnv({ EMBEDDING_CACHE_ENABLED: "false", KB_RESULT_CACHE_TTL_SECONDS: "0" });
    expect(off.EMBEDDING_CACHE_ENABLED).toBe(false);
    expect(off.KB_RESULT_CACHE_TTL_SECONDS).toBe(0);
  });
});
