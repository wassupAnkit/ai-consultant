import { describe, expect, test } from "bun:test";
import { KnowledgeSearchRequestSchema } from "../src/app/http";
import { searchIndexHasSourceKind, textIndexDefinition, vectorIndexDefinition } from "../src/db/mongo";
import { formatContext } from "../src/retrieval/format";
import { chunkPredicate, inAppMongoFilter } from "../src/retrieval/inapp";
import { buildFilter, MongoKnowledgeStore, textSearchFilters } from "../src/retrieval/mongo";
import { parseQuotas, QuotaKnowledgeStore, searchWithQuotas } from "../src/retrieval/multipass";
import { NullKnowledgeStore, sourceKindOf, type KnowledgeStore, type RetrievedChunk, type SearchQuery } from "../src/retrieval/store";
import { sampleChunk } from "./helpers";

const chunk = (n: number, source: string, docType = "page", url?: string): RetrievedChunk => ({
  ...sampleChunk(n),
  id: `${source}-${n}`,
  source,
  docType,
  url: url ?? `https://${source.replace(/^partner:|^upload:/, "")}/${docType}/${n}`,
  sourceKind: sourceKindOf(source, docType),
});

describe("provenance (sourceKind)", () => {
  test("sourceKindOf classifies sources", () => {
    expect(sourceKindOf("experteducation.com")).toBe("site");
    expect(sourceKindOf("partner:monash.edu")).toBe("partner");
    expect(sourceKindOf("upload:fee-sheet-2026")).toBe("upload");
    expect(sourceKindOf("kb_programs")).toBe("program");
    expect(sourceKindOf("partner:monash.edu", "program")).toBe("program");
  });

  test("Atlas filters include source and sourceKind", () => {
    expect(buildFilter({ text: "x", k: 5 })).toBeUndefined();
    expect(buildFilter({ text: "x", k: 5, sources: ["partner:monash.edu"] })).toEqual({ source: { $in: ["partner:monash.edu"] } });
    expect(buildFilter({ text: "x", k: 5, countries: ["australia"], sourceKinds: ["upload", "program"] })).toEqual({
      $and: [{ country: { $in: ["australia", "global"] } }, { sourceKind: { $in: ["upload", "program"] } }],
    });
    expect(vectorIndexDefinition(768).fields.some((f) => f.path === "sourceKind")).toBe(true);
    expect(textIndexDefinition.mappings.fields.sourceKind).toEqual({ type: "token" });
    expect(searchIndexHasSourceKind(vectorIndexDefinition(768))).toBe(true);
    expect(searchIndexHasSourceKind({ fields: [{ path: "country" }] })).toBe(false);
    expect(searchIndexHasSourceKind(textIndexDefinition)).toBe(true);
    expect(searchIndexHasSourceKind({ mappings: { fields: { title: {} } } })).toBe(false);
    expect(searchIndexHasSourceKind(undefined)).toBe(false);
  });

  test("in-app predicate mirrors the Atlas filter, deriving sourceKind for old chunks", () => {
    const allow = chunkPredicate({ countries: ["canada"], sourceKinds: ["partner"] });
    expect(allow({ country: "canada", docType: "page", source: "partner:utoronto.ca" })).toBe(true);
    expect(allow({ country: null, docType: "page", source: "partner:utoronto.ca" })).toBe(true);
    expect(allow({ country: "australia", docType: "page", source: "partner:monash.edu" })).toBe(false);
    expect(allow({ country: "canada", docType: "page", source: "experteducation.com" })).toBe(false);
    const bySource = chunkPredicate({ sources: ["upload:fees"] });
    expect(bySource({ country: null, docType: "page", source: "upload:fees", sourceKind: "upload" })).toBe(true);
    expect(bySource({ country: null, docType: "page", source: "upload:other", sourceKind: "upload" })).toBe(false);
  });

  // The bug: a destination filter always let the ~4k "global" chunks in, and they outrank the
  // country's own pages (live KB, 2026-09-28: 293 Canada chunks, yet the CA filter returned 8/8
  // global). The chat still wants global pages; an explicit filter must be strict.
  test("a strict country filter excludes global chunks (Atlas vector and text filters)", () => {
    expect(buildFilter({ text: "x", k: 5, countries: ["canada"], includeGlobal: false })).toEqual({ country: { $in: ["canada"] } });
    expect(buildFilter({ text: "x", k: 5, countries: ["canada"] })).toEqual({ country: { $in: ["canada", "global"] } });
    expect(textSearchFilters({ text: "x", k: 5, countries: ["canada"], includeGlobal: false })).toEqual([{ in: { path: "country", value: ["canada"] } }]);
    expect(textSearchFilters({ text: "x", k: 5, countries: ["canada"] })).toEqual([{ in: { path: "country", value: ["canada", "global"] } }]);
  });

  test("a strict country filter excludes global and unlabelled chunks (in-app)", () => {
    const strict = chunkPredicate({ countries: ["canada"], includeGlobal: false });
    expect(strict({ country: "canada", docType: "page", source: "experteducation.com" })).toBe(true);
    expect(strict({ country: "global", docType: "page", source: "experteducation.com" })).toBe(false);
    expect(strict({ country: null, docType: "page", source: "experteducation.com" })).toBe(false);
    const lenient = chunkPredicate({ countries: ["canada"] });
    expect(lenient({ country: "global", docType: "page", source: "experteducation.com" })).toBe(true);
    expect(lenient({ country: null, docType: "page", source: "experteducation.com" })).toBe(true);
    expect(inAppMongoFilter({ countries: ["canada"], includeGlobal: false })).toEqual({ country: { $in: ["canada"] } });
    expect(inAppMongoFilter({ countries: ["canada"] })).toEqual({ country: { $in: ["canada", "global", null] } });
  });

  test("Source objects carry sourceKind for indexed evidence only", () => {
    const { sources } = formatContext([chunk(1, "partner:monash.edu"), { ...chunk(2, "live:monash.edu"), live: true, kind: "page", n: 2 } as never]);
    expect(sources[0]!.sourceKind).toBe("partner");
    expect(sources[1]!.sourceKind).toBeUndefined();
    expect(sources[1]!.live).toBe(true);
  });

  test("HTTP schema accepts sources and sourceKinds", () => {
    const ok = KnowledgeSearchRequestSchema.parse({ query: "fees", sources: ["partner:monash.edu", "upload:fee-sheet"], sourceKinds: ["partner", "upload"] });
    expect(ok.sourceKinds).toEqual(["partner", "upload"]);
    expect(() => KnowledgeSearchRequestSchema.parse({ query: "fees", sourceKinds: ["live"] })).toThrow();
    expect(() => KnowledgeSearchRequestSchema.parse({ query: "fees", sources: ["bad source with spaces"] })).toThrow();
  });
});

describe("retrieval quotas", () => {
  test("parseQuotas reads the env format and ignores junk", () => {
    expect(parseQuotas(undefined)).toBeNull();
    expect(parseQuotas("")).toBeNull();
    expect(parseQuotas("site:4, partner:5,program:3,upload:4,live:9,bogus")).toEqual({ site: 4, partner: 5, program: 3, upload: 4 });
    expect(parseQuotas("site:0,partner:x")).toBeNull();
  });

  /** Store whose corpus is dominated by partner chunks; records every query it receives. */
  class RecordingStore implements KnowledgeStore {
    readonly queries: SearchQuery[] = [];
    constructor(private readonly corpus: RetrievedChunk[]) {}
    async search(q: SearchQuery) {
      this.queries.push(q);
      return this.corpus.filter(chunkPredicate(q)).slice(0, q.k);
    }
    async ping() {
      return true;
    }
    async count() {
      return this.corpus.length;
    }
  }

  const corpus = [
    ...Array.from({ length: 20 }, (_, i) => chunk(i + 1, "partner:monash.edu")),
    chunk(101, "experteducation.com", "destination"),
    chunk(102, "experteducation.com", "service"),
    chunk(201, "upload:fee-sheet-2026", "upload"),
    chunk(301, "kb_programs", "program"),
  ];

  test("searchWithQuotas guarantees each provenance a seat and dedupes by URL", async () => {
    const store = new RecordingStore(corpus);
    const out = await searchWithQuotas(store, { text: "fees", k: 6 }, { site: 2, partner: 3, upload: 2, program: 1 });
    expect(store.queries.map((q) => q.sourceKinds?.[0]).sort()).toEqual(["partner", "program", "site", "upload"]);
    expect(store.queries.every((q) => q.text === "fees")).toBe(true);
    const kinds = out.map((c) => c.sourceKind);
    expect(kinds.filter((k) => k === "partner")).toHaveLength(3);
    expect(kinds.filter((k) => k === "site")).toHaveLength(2);
    expect(kinds).toContain("upload");
    expect(kinds).toContain("program");
    expect(out.length).toBe(7); // sum of quotas that had results (2+3+1+1)
    // Uploads outrank equally-ranked partner chunks thanks to the weight.
    expect(out[0]!.sourceKind).toBe("upload");
  });

  test("QuotaKnowledgeStore bypasses quotas for restricted queries and tolerates failing passes", async () => {
    const store = new RecordingStore(corpus);
    const quota = new QuotaKnowledgeStore(store, { site: 2, partner: 2 });
    const restricted = await quota.search({ text: "fees", k: 3, sources: ["upload:fee-sheet-2026"] });
    expect(restricted.map((c) => c.source)).toEqual(["upload:fee-sheet-2026"]);
    expect(store.queries).toHaveLength(1);

    const flaky: KnowledgeStore = {
      async search(q) {
        if (q.sourceKinds?.[0] === "partner") throw new Error("atlas hiccup");
        return corpus.filter(chunkPredicate(q)).slice(0, q.k);
      },
      async ping() {
        return true;
      },
      async count() {
        return 0;
      },
    };
    const out = await searchWithQuotas(flaky, { text: "fees", k: 4 }, { site: 2, partner: 2 });
    expect(out.map((c) => c.sourceKind)).toEqual(["site", "site"]);
    expect(await quota.ping()).toBe(true);
    expect(await quota.count()).toBe(corpus.length);
    expect(await new NullKnowledgeStore([]).search()).toEqual([]);
  });
});

describe("evidence dates", () => {
  test("Atlas search projects updatedAt from kb_chunks and returns it as ISO", async () => {
    const pipelines: Record<string, unknown>[][] = [];
    const doc = { _id: "c1", url: "https://experteducation.com/a", title: "A", section: "", docType: "page", country: "australia", source: "experteducation.com", content: "x", score: 1 };
    const kbChunks = {
      aggregate: (pipeline: Record<string, unknown>[]) => {
        pipelines.push(pipeline);
        // The vector side has a dated chunk; the text side's chunk predates the field. Both must work.
        const vector = "$vectorSearch" in pipeline[0]!;
        return { toArray: async () => [vector ? { ...doc, updatedAt: new Date("2026-08-14T03:12:00Z") } : { ...doc, _id: "c2", url: "https://experteducation.com/b" }] };
      },
    };
    const store = new MongoKnowledgeStore({ kbChunks } as never, { embedQuery: async () => [1, 0] } as never, { vectorIndex: "v", textIndex: "t" });
    const out = await store.search({ text: "q", k: 5 });
    for (const p of pipelines) expect((p.at(-1)!.$project as Record<string, unknown>).updatedAt).toBe(1);
    expect(out.find((c) => c.id === "c1")!.updatedAt).toBe("2026-08-14T03:12:00.000Z");
    expect("updatedAt" in out.find((c) => c.id === "c2")!).toBe(false);
  });
});
