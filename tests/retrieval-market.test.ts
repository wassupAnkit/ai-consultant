import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { inferMarket, siteSources } from "../src/ingest/sources";
import { MARKETS } from "../src/routing/markets";
import { InAppKnowledgeStore } from "../src/retrieval/inapp";
import { chunkSiteMarket, marketOverFetch, rankByMarket, siteMarketOf } from "../src/retrieval/market";
import { MongoKnowledgeStore } from "../src/retrieval/mongo";
import { QuotaKnowledgeStore } from "../src/retrieval/multipass";
import { CachedKnowledgeStore, canonicalSearchKey } from "../src/retrieval/result-cache";
import { sourceKindOf, type RetrievedChunk, type SearchQuery } from "../src/retrieval/store";
import { RecordingKnowledgeStore, ScriptedToolModel, toolCalls } from "./fakes";
import { fakeGraph, intentOf } from "./helpers";

const SITE = "https://experteducation.com";

/** A chunk at `path` on experteducation.com (or another source), relevance by position. */
const page = (id: string, path: string, source = "experteducation.com"): RetrievedChunk => ({
  id,
  url: source === "experteducation.com" ? `${SITE}${path}` : `https://${source.replace(/^\w+:/, "")}${path}`,
  title: id,
  section: "",
  docType: "destination",
  country: "canada",
  source,
  sourceKind: sourceKindOf(source),
  content: `content of ${id}`,
  score: 1,
  matchedBy: ["vector"],
});

const ids = (cs: RetrievedChunk[]) => cs.map((c) => c.id);

describe("site market of a chunk", () => {
  test("experteducation.com market sections; global pages and other sources are market-neutral", () => {
    expect(chunkSiteMarket(page("a", "/nepal/study-in-canada/"))).toBe("nepal");
    expect(chunkSiteMarket(page("b", "/vietnam/du-hoc-canada/"))).toBe("vietnam");
    expect(chunkSiteMarket(page("c", "/australia/student-visa/"))).toBe("australia");
    expect(chunkSiteMarket(page("d", "/study-areas/nursing/"))).toBeNull();
    expect(chunkSiteMarket(page("e", "/nepal/x/", "partner:utoronto.ca"))).toBeNull();
    expect(chunkSiteMarket(page("f", "/nepal/x/", "upload:fee-sheet"))).toBeNull();
    expect(chunkSiteMarket({ ...page("g", "/nepal/x/"), url: "https://elsewhere.example/nepal/x/" })).toBeNull();
  });

  // The re-rank reads the market off the URL; that is exactly the `metadata.market` ingest stores
  // (`source.market ?? inferMarket(url)`) because each market source only crawls its own section.
  test("the URL market equals the crawl source's metadata.market for every site source", () => {
    for (const s of siteSources()) {
      for (const seed of s.seeds) expect(inferMarket(seed) ?? "global").toBe(s.market!);
    }
  });

  test("every source market maps to its site section, Sri Lanka to none", () => {
    for (const m of MARKETS) expect(siteMarketOf(m)).toBe(m === "sri_lanka" ? null : m);
  });
});

describe("rankByMarket", () => {
  // Relevance order as retrieved: other markets first, as in the counsellor audit (N11).
  const mixed = [
    page("np-funds", "/nepal/canada-funds/"),
    page("partner", "/fees/", "partner:utoronto.ca"),
    page("in-funds", "/india/canada-funds/"),
    page("global", "/tool/cost-of-living-estimator/"),
    page("upload", "/x", "upload:fee-sheet"),
    page("vn-funds", "/vietnam/canada-funds/"),
    page("au-visa", "/australia/student-visa/"),
    page("global-2", "/study-areas/business/"),
  ];

  test("own market first, then global, other markets dropped once k is filled; other sources keep their slots", () => {
    const out = rankByMarket(mixed, "vietnam", 5);
    expect(ids(out)).toEqual(["vn-funds", "partner", "global", "global-2", "upload"]);
  });

  test("other-market pages fill the tail only when too few results remain", () => {
    const out = rankByMarket(mixed, "vietnam", 8);
    expect(ids(out)).toEqual(["vn-funds", "partner", "global", "global-2", "upload", "np-funds", "in-funds", "au-visa"]);
  });

  test("no own section (Sri Lanka): global pages ahead of every market's", () => {
    expect(ids(rankByMarket(mixed, "sri_lanka", 4))).toEqual(["global", "partner", "global-2", "upload"]);
  });

  test("no market → relevance order unchanged", () => {
    expect(ids(rankByMarket(mixed, undefined, 5))).toEqual(ids(mixed.slice(0, 5)));
  });

  test("over-fetch is modest and only with a market", () => {
    expect(marketOverFetch({ k: 6 })).toBe(6);
    expect(marketOverFetch({ k: 6, market: "vietnam" })).toBe(12);
  });
});

/** Fake kb_chunks for the Atlas store: both retrievers return `hits` in order, recording each `$limit`. */
function atlasStore(hits: RetrievedChunk[]) {
  const limits: number[] = [];
  const kbChunks = {
    aggregate: (pipeline: Record<string, unknown>[]) => {
      const vs = pipeline[0]!.$vectorSearch as { limit?: number } | undefined;
      if (vs?.limit) limits.push(vs.limit);
      return { toArray: async () => hits.map((h, i) => ({ _id: h.id, url: h.url, title: h.title, section: h.section, docType: h.docType, country: h.country, source: h.source, content: h.content, score: 1 - i / 100 })) };
    },
  };
  const store = new MongoKnowledgeStore({ kbChunks } as never, { embedQuery: async () => [1, 0] } as never, { vectorIndex: "v", textIndex: "t" });
  return { store, limits };
}

const funds = [
  page("np-1", "/nepal/canada-funds/"),
  page("in-1", "/india/canada-funds/"),
  page("np-2", "/nepal/canada-gic/"),
  page("global", "/tool/cost-of-living-estimator/"),
  page("vn-1", "/vietnam/canada-funds/"),
  page("bd-1", "/bangladesh/canada-funds/"),
];

describe("stores rank site chunks by the student's market", () => {
  test("Atlas: a Vietnamese student's search puts /vietnam/ and global pages ahead of /nepal/ ones", async () => {
    const { store } = atlasStore(funds);
    const out = await store.search({ text: "canada funds", k: 3, market: "vietnam" });
    expect(ids(out)).toEqual(["vn-1", "global", "np-1"]);
    expect(ids(out).indexOf("np-1")).toBeGreaterThan(ids(out).indexOf("vn-1"));
  });

  test("Atlas: no market → relevance order, as before", async () => {
    const { store } = atlasStore(funds);
    expect(ids(await store.search({ text: "canada funds", k: 3 }))).toEqual(["np-1", "in-1", "np-2"]);
  });

  test("in-app: a Vietnamese student's search never surfaces /nepal/ ahead of /vietnam/ or global pages", async () => {
    // The Nepal page is the closest vector match; the Vietnam and global pages are weaker.
    const docs = [
      { ...funds[0]!, embedding: [1, 0] },
      { ...funds[1]!, embedding: [0.95, 0.31] },
      { ...funds[3]!, embedding: [0.8, 0.6] },
      { ...funds[4]!, embedding: [0.6, 0.8] },
    ].map(({ id, score, matchedBy, ...d }) => ({ _id: id, ...d, chunkIndex: 0, contentHash: id, metadata: {}, updatedAt: new Date("2026-10-01") }));
    const kbChunks = {
      find: (filter: Record<string, unknown>) =>
        "$text" in filter
          ? { sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }
          : {
              async *[Symbol.asyncIterator]() {
                yield* docs;
              },
            },
      estimatedDocumentCount: async () => docs.length,
    };
    const store = new InAppKnowledgeStore({ kbChunks } as never, { embedQuery: async () => [1, 0] } as never, { refreshSeconds: 3600 });
    const vn = ids(await store.search({ text: "canada funds", k: 3, market: "vietnam" }));
    expect(vn).toEqual(["vn-1", "global", "np-1"]);
    expect(ids(await store.search({ text: "canada funds", k: 3 }))).toEqual(["np-1", "in-1", "global"]);
  });

  test("quotas: every pass carries the market and the fused list is re-ranked", async () => {
    const inner = new RecordingKnowledgeStore((q) => (q.sourceKinds?.[0] === "site" ? funds.slice(0, q.k) : [page(`p-${q.sourceKinds?.[0]}`, "/fees/", "partner:utoronto.ca")]));
    const store = new QuotaKnowledgeStore(inner, { site: 4, partner: 1 });
    const out = await store.search({ text: "canada funds", k: 5, market: "vietnam" });
    expect(inner.queries.every((q) => q.market === "vietnam")).toBe(true);
    // The fake ignores the market, so the quota store's own re-rank is what moves Nepal down.
    expect(ids(out)[0]).not.toBe("np-1");
    expect(ids(out).indexOf("global")).toBeLessThan(ids(out).indexOf("np-1"));
  });
});

describe("result cache and market", () => {
  test("the cache key includes the market; absent is its own key", () => {
    const q: SearchQuery = { text: "canada funds", k: 6 };
    expect(canonicalSearchKey({ ...q, market: "vietnam" })).not.toBe(canonicalSearchKey({ ...q, market: "nepal" }));
    expect(canonicalSearchKey({ ...q, market: "vietnam" })).not.toBe(canonicalSearchKey(q));
    expect(canonicalSearchKey({ ...q, market: "vietnam" })).toBe(canonicalSearchKey({ ...q, text: " Canada  funds ", market: "vietnam" }));
  });

  test("a Nepal entry is never served to a Vietnamese student's search", async () => {
    const inner = new RecordingKnowledgeStore(() => [page("x", "/global/")]);
    const cache = new CachedKnowledgeStore(inner, { ttlSeconds: 60 });
    await cache.search({ text: "canada funds", k: 6, market: "nepal" });
    await cache.search({ text: "canada funds", k: 6, market: "vietnam" });
    await cache.search({ text: "canada funds", k: 6, market: "vietnam" });
    expect(inner.queries.map((q) => q.market)).toEqual(["nepal", "vietnam"]);
  });
});

describe("the turn passes the student's market to the knowledge base", () => {
  const funding = intentOf({ primary_intent: "financial_viability", destinations: ["canada"], user_question: "What funds does she need to show for a Canada study permit?", task: "lookup", needs_research: true });

  async function turn(input: string) {
    const model = new ScriptedToolModel([toolCalls([{ name: "search_knowledge_base", args: { query: "Canada study permit proof of funds" } }]), new AIMessage({ content: "sufficient" })]);
    const knowledge = new RecordingKnowledgeStore(() => [page("vn-1", "/vietnam/canada-funds/")]);
    const { graph } = fakeGraph({ intent: funding, researchModel: model, knowledge });
    const state = await graph.invoke({ input, history: [], sessionId: "s1", profile: null });
    return { state, queries: knowledge.queries };
  }

  test("Vietnamese origin: round 0 and the model's search_knowledge_base call both carry market vietnam", async () => {
    const { state, queries } = await turn("Vietnamese student wants to study in Canada: how much in funds must she show?");
    expect(state.route?.origin).toBe("vietnam");
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.every((q) => q.market === "vietnam")).toBe(true);
    expect(queries.some((q) => q.text === "Canada study permit proof of funds")).toBe(true);
  });

  test("no origin: no market on any search", async () => {
    const { state, queries } = await turn("How much in funds must a student show for a Canada study permit?");
    expect(state.route?.origin ?? null).toBeNull();
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.every((q) => !("market" in q))).toBe(true);
  });
});
