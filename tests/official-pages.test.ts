import { describe, expect, test } from "bun:test";
import type { Embeddings } from "@langchain/core/embeddings";
import { AIMessage } from "@langchain/core/messages";
import type { KbChunkDoc, KbPageDoc } from "../src/db/mongo";
import { indexedOfficialHits } from "../src/graph/freshness";
import {
  apiAlternative,
  embeddedPageContent,
  factsRegisterPages,
  fetchOfficialPage,
  ingestOfficialPages,
  isOfficialHost,
  loadOfficialPages,
  mergeOfficialPages,
  officialKey,
  officialSource,
  sliceHtml,
  sweepOfficialPages,
  validateOfficialPages,
  type OfficialPage,
} from "../src/ingest/official";
import { officialChunkMarket, rankByMarket } from "../src/retrieval/market";
import { sourceKindOf, type RetrievedChunk } from "../src/retrieval/store";
import { factsRegisterMarkdown } from "../src/skills/facts-register";
import type { WebSearcher } from "../src/tools";
import { RecordingKnowledgeStore, ScriptedToolModel } from "./fakes";
import { fakeGraph, intentOf, sampleChunk } from "./helpers";

const UA = "ExpertEducationEdge/1.0 (experteducation.com)";

const page = (over: Partial<OfficialPage> = {}): OfficialPage => ({
  url: "https://immi.homeaffairs.gov.au/visas/student-500",
  label: "Student visa (500)",
  country: "australia",
  authority: "immigration",
  topics: ["visa_process"],
  origin: "curated",
  ...over,
});

const html = (title: string, body: string) => `<html><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
const LONG = "<p>" + "Applicants must show genuine access to funds for living costs, tuition and travel. ".repeat(24) + "</p>";

/** fetch fake: robots.txt per origin, then pages by exact URL. */
function fakeFetch(pages: Record<string, { status?: number; body?: string; type?: string }>, robots: Record<string, string> = {}) {
  const calls: { url: string; ua: string | null }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ua: new Headers(init?.headers).get("user-agent") });
    const u = new URL(url);
    if (u.pathname === "/robots.txt") return new Response(robots[u.origin] ?? "", { status: robots[u.origin] === undefined ? 404 : 200 });
    const p = pages[url];
    if (!p) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(p.body ?? "", { status: p.status ?? 200, headers: { "content-type": p.type ?? "text/html; charset=utf-8" } });
  }) as typeof fetch;
  return { impl, calls };
}

/** Just enough of a Mongo collection for indexPage and the official sweep. */
function fakeCollection<T extends { _id: string }>() {
  const rows = new Map<string, T>();
  const matches = (doc: T, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([k, cond]) => {
      const v = (doc as Record<string, unknown>)[k];
      if (cond && typeof cond === "object" && "$in" in cond) return (cond.$in as unknown[]).includes(v);
      if (cond && typeof cond === "object" && "$nin" in cond) return !(cond.$nin as unknown[]).includes(v);
      if (cond && typeof cond === "object" && "$regex" in cond) return new RegExp(cond.$regex as string).test(String(v));
      return v === cond;
    });
  return {
    rows,
    async findOne(filter: Record<string, unknown>) {
      return [...rows.values()].find((d) => matches(d, filter)) ?? null;
    },
    find(filter: Record<string, unknown>) {
      return { toArray: async () => [...rows.values()].filter((d) => matches(d, filter)).map((d) => structuredClone(d)) };
    },
    async bulkWrite(ops: { replaceOne: { filter: { _id: string }; replacement: T } }[]) {
      for (const op of ops) rows.set(op.replaceOne.filter._id, op.replaceOne.replacement);
      return {};
    },
    async deleteMany(filter: Record<string, unknown>) {
      let deletedCount = 0;
      for (const [id, d] of rows) if (matches(d, filter)) (rows.delete(id), deletedCount++);
      return { deletedCount };
    },
    async replaceOne(filter: { _id: string }, doc: Omit<T, "_id">) {
      rows.set(filter._id, { ...(doc as T), _id: filter._id });
      return {};
    },
    async updateOne(filter: { _id: string }, update: { $set: Partial<T> }) {
      const d = rows.get(filter._id);
      if (d) rows.set(filter._id, { ...d, ...update.$set });
      return {};
    },
    async updateMany() {
      return {};
    },
  };
}

const embeddings = { embedDocuments: async (t: string[]) => t.map(() => [0.1, 0.2]), embedQuery: async () => [0.1, 0.2] } as unknown as Embeddings;
const store = () => {
  const kbChunks = fakeCollection<KbChunkDoc>();
  const kbPages = fakeCollection<KbPageDoc>();
  return { kbChunks, kbPages, deps: { collections: { kbChunks, kbPages } as never, embeddings, crawlOptions: { userAgent: UA, concurrency: 1, delayMs: 0 }, runId: "r1" } };
};

describe("official page list", () => {
  test("validates entries: exactly one of country or market, known authority, unknown topics dropped, duplicates refused", () => {
    const { pages, errors } = validateOfficialPages({
      version: "t",
      pages: [
        { url: "https://www.gov.uk/student-visa", label: "UK Student visa", country: "united_kingdom", authority: "immigration", topics: ["visa_process", "made_up"] },
        { url: "https://moest.gov.np/noc", label: "Nepal NOC", market: "nepal", authority: "education_ministry", topics: [] },
        { url: "https://www.gov.uk/student-visa/", label: "Dup", country: "united_kingdom", authority: "immigration" },
        { url: "https://x.gov.au/a", label: "Both", country: "australia", market: "nepal", authority: "government" },
        { url: "http://x.gov.au/a", label: "Plain http", country: "australia", authority: "government" },
        { url: "https://x.gov.au/b", label: "Bad authority", country: "australia", authority: "blogger" },
        { url: "https://x.gov.au/c", label: "Bad country", country: "narnia", authority: "government" },
      ],
    });
    expect(pages.map((p) => p.label)).toEqual(["UK Student visa", "Nepal NOC"]);
    expect(pages[0]!.topics).toEqual(["visa_process"]);
    expect(pages[1]).toMatchObject({ market: "nepal" });
    expect(pages[1]!.country).toBeUndefined();
    expect(errors.join("\n")).toContain("made_up");
    expect(errors.join("\n")).toContain("duplicate");
    expect(errors.join("\n")).toContain("exactly one of country or market");
    expect(errors.join("\n")).toContain("https");
    expect(errors.join("\n")).toContain("unknown authority");
    expect(errors.join("\n")).toContain("unknown country");
  });

  test("facts-register sources: markdown and bare links on official hosts, no API links, first label wins, scholarships are global", () => {
    const pages = factsRegisterPages({
      australia:
        "| a | b | c | d | [Home Affairs: Student visa 500](https://immi.homeaffairs.gov.au/visas/student-500) | x |\n" +
        "| a | b | c | d | [Again](https://immi.homeaffairs.gov.au/visas/student-500#fees) | x |\n" +
        "| a | b | c | d | [Law firm](https://www.lauradevine.com/news/x) | x |\n" +
        "| a | b | c | d | [Rules PDF](https://assets.publishing.service.gov.uk/media/1/HC_997.pdf) | x |\n" +
        "| a | b | c | d | [Register API](https://www.federalregister.gov/api/v1/documents.json?q=1) | x |",
      united_kingdom: "| Student visa fee | £558 | 2026-04-08 | All | https://www.gov.uk/government/publications/fees-8-april-2026 | 2026-10-09 |",
      scholarships: "[Chevening](https://cscuk.fcdo.gov.uk/scholarships/)",
    });
    expect(pages.map((p) => [p.url, p.label, p.country, p.origin])).toEqual([
      ["https://immi.homeaffairs.gov.au/visas/student-500", "Home Affairs: Student visa 500", "australia", "facts"],
      ["https://www.gov.uk/government/publications/fees-8-april-2026", "Student visa fee", "united_kingdom", "facts"],
      ["https://cscuk.fcdo.gov.uk/scholarships/", "Chevening", "global", "facts"],
    ]);
  });

  test("official hosts: government TLDs and pack or market domains, not blogs", () => {
    expect(isOfficialHost("immi.homeaffairs.gov.au")).toBe(true);
    expect(isOfficialHost("www.gov.uk".replace(/^www\./, ""))).toBe(true);
    expect(isOfficialHost("ircc.canada.ca")).toBe(true);
    expect(isOfficialHost("immigration.govt.nz")).toBe(true);
    expect(isOfficialHost("ielts.org")).toBe(true);
    expect(isOfficialHost("noc.moest.gov.np")).toBe(true);
    expect(isOfficialHost("lauradevine.com")).toBe(false);
    expect(isOfficialHost("cicnews.com")).toBe(false);
    expect(isOfficialHost("ecfr.gov", ["ecfr.gov"])).toBe(true);
  });

  test("a curated entry replaces the facts-register entry for the same page; keys ignore a trailing slash", () => {
    const facts = page({ url: "https://www.gov.uk/student-visa/", label: "From register", country: "united_kingdom", origin: "facts", authority: "government", topics: [] });
    const curated = page({ url: "https://www.gov.uk/student-visa", label: "Curated", country: "united_kingdom", authority: "immigration" });
    expect(officialKey(facts)).toBe(officialKey(curated));
    expect(mergeOfficialPages([curated], [facts])).toEqual([curated]);
  });

  test("the shipped list is valid and covers every official page the facts registers cite", async () => {
    const { pages, errors } = await loadOfficialPages();
    expect(errors).toEqual([]);
    const keys = new Set(pages.map(officialKey));
    for (const p of factsRegisterPages(factsRegisterMarkdown())) expect(keys.has(officialKey(p))).toBe(true);
    expect(pages.some((p) => p.country === "united_kingdom")).toBe(true);
    expect(pages.some((p) => p.country === "australia")).toBe(true);
  });
});

describe("sliceHtml", () => {
  const doc = `<div id="p-214.2(e)">E text</div><div id="p-214.2(f)"><p>F-1 students may work on campus.</p></div><div id="p-214.2(g)">G text</div>`;
  test("keeps the element with id=from up to the element with id=to", () => {
    const out = sliceHtml(doc, { from: "p-214.2(f)", to: "p-214.2(g)" })!;
    expect(out).toContain("F-1 students may work on campus.");
    expect(out).not.toContain("E text");
    expect(out).not.toContain("G text");
  });
  test("runs to the end without `to`, and is null when the anchor is gone", () => {
    expect(sliceHtml(doc, { from: "p-214.2(f)" })).toContain("G text");
    expect(sliceHtml(doc, { from: "p-214.2(zz)" })).toBeNull();
  });
});

describe("fetchOfficialPage", () => {
  test("sends the honest user agent, obeys robots.txt and reports a 403 without retrying", async () => {
    const { impl, calls } = fakeFetch(
      { "https://a.gov.au/ok": { body: html("Fees", LONG) }, "https://a.gov.au/blocked": { status: 403, body: "denied" } },
      { "https://a.gov.au": "User-agent: *\nDisallow: /private" },
    );
    const robots = new Map();
    const ok = await fetchOfficialPage(page({ url: "https://a.gov.au/ok" }), { userAgent: UA, fetchImpl: impl, robots });
    const denied = await fetchOfficialPage(page({ url: "https://a.gov.au/blocked" }), { userAgent: UA, fetchImpl: impl, robots });
    const disallowed = await fetchOfficialPage(page({ url: "https://a.gov.au/private/x" }), { userAgent: UA, fetchImpl: impl, robots });
    expect(ok.ok).toBe(true);
    expect(denied).toMatchObject({ ok: false, status: 403, error: "refused automated access (403)" });
    expect(disallowed).toMatchObject({ ok: false, status: null, error: "disallowed by robots.txt" });
    expect(calls.every((c) => c.ua === UA)).toBe(true);
    expect(calls.filter((c) => c.url.endsWith("/robots.txt"))).toHaveLength(1);
    expect(calls.some((c) => c.url.includes("/private/"))).toBe(false);
  });

  test("slices an API page and stores it under its human URL and label", async () => {
    const api = "https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-8?part=214&section=214.2";
    const body = `<div id="p-214.2(e)">Other classes.</div><div id="p-214.2(f)">${LONG}</div><div id="p-214.2(g)">G</div>`;
    const { impl } = fakeFetch({ [api]: { body } });
    const r = await fetchOfficialPage(page({ url: api, citeUrl: "https://www.ecfr.gov/current/title-8/section-214.2#p-214.2(f)", label: "8 CFR 214.2(f): F-1 students", country: "united_states", slice: { from: "p-214.2(f)", to: "p-214.2(g)" } }), { userAgent: UA, fetchImpl: impl, robots: new Map() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fetched.page.url).toBe("https://www.ecfr.gov/current/title-8/section-214.2#p-214.2(f)");
    expect(r.fetched.page.title).toBe("8 CFR 214.2(f): F-1 students");
    expect(r.fetched.page.text).toContain("genuine access to funds");
    expect(r.fetched.page.text).not.toContain("Other classes");
  });
});

describe("sites that ship content another way", () => {
  test("Federal Register pages are fetched through the full text the API links to", () => {
    expect(apiAlternative("https://www.federalregister.gov/documents/2026/10/08/2026-20660/optional-practical-training-fees")).toEqual({
      url: "https://www.federalregister.gov/documents/full_text/html/2026/10/08/2026-20660.html",
    });
    // eCFR's robots.txt disallows its renderer API: no rewrite, the page is reported as refused.
    expect(apiAlternative("https://www.ecfr.gov/current/title-8/chapter-I/subchapter-B/part-214/section-214.2")).toBeNull();
    expect(apiAlternative("https://www.gov.uk/student-visa")).toBeNull();
  });

  test("the API copy is fetched but the page stays the cited URL", async () => {
    const full = "https://www.federalregister.gov/documents/full_text/html/2026/10/08/2026-20660.html";
    const { impl, calls } = fakeFetch({ [full]: { body: html("Optional Practical Training Fees", LONG) } });
    const cited = "https://www.federalregister.gov/documents/2026/10/08/2026-20660/optional-practical-training-fees";
    const r = await fetchOfficialPage(page({ url: cited, country: "united_states" }), { userAgent: UA, fetchImpl: impl, robots: new Map() });
    expect(r.ok && r.fetched.page.url).toBe(cited);
    expect(r.ok && r.fetched.page.title).toBe("Student visa (500)");
    expect(calls.map((c) => c.url)).toContain(full);
    expect(calls.map((c) => c.url)).not.toContain(cited);
  });

  test("Home Affairs' SharePoint page JSON becomes headings and text", async () => {
    const schema = {
      title: "Student visa",
      description: "<p>This visa lets you stay in Australia to study full-time.</p>",
      eligibility: { tabs: [{ title: "Genuine Student requirement", description: "<p>You must be a genuine student.</p>", collapsed: true }] },
    };
    const value = JSON.stringify(schema).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "\\u003c");
    const pageHtml = `<html><head><title>Student visa</title></head><body><nav>Menu</nav><input type="hidden" id="ctl00_PlaceHolderMain_PageSchemaHiddenField_Input" value="${value}"></body></html>`;
    const content = embeddedPageContent(pageHtml)!;
    expect(content).toContain("<h2>Student visa</h2>");
    expect(content).toContain("<h3>Genuine Student requirement</h3>");
    expect(content).toContain("You must be a genuine student.");
    expect(embeddedPageContent(html("x", LONG))).toBeNull();

    const big = { ...schema, more: [{ title: "Financial capacity", description: LONG }] };
    const bigValue = JSON.stringify(big).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const { impl } = fakeFetch({ "https://immi.homeaffairs.gov.au/visas/student-500": { body: `<html><head><title>Student visa (subclass 500)</title></head><body><input type="hidden" id="ctl00_PlaceHolderMain_PageSchemaHiddenField_Input" value="${bigValue}"></body></html>` } });
    const r = await fetchOfficialPage(page(), { userAgent: UA, fetchImpl: impl, robots: new Map() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fetched.page.title).toBe("Student visa (subclass 500)");
    expect(r.fetched.page.text).toContain("Financial capacity");
    expect(r.fetched.page.text).toContain("genuine access to funds");
  });

  test("a challenge page or a near-empty JavaScript shell is reported, not indexed", async () => {
    const { impl } = fakeFetch({
      "https://a.gov.au/challenge": { body: html("Request Access", "<p>Your request has been flagged as potentially automated.</p>" + LONG) },
      "https://a.gov.au/shell": { body: html("Legislation", "<ul><li>Home</li><li>Text</li></ul>") },
    });
    const challenge = await fetchOfficialPage(page({ url: "https://a.gov.au/challenge" }), { userAgent: UA, fetchImpl: impl, robots: new Map() });
    const shell = await fetchOfficialPage(page({ url: "https://a.gov.au/shell" }), { userAgent: UA, fetchImpl: impl, robots: new Map() });
    expect(challenge).toMatchObject({ ok: false, error: "refused automated access (challenge page)" });
    expect(shell.ok).toBe(false);
    if (!shell.ok) expect(shell.error).toContain("too little text");
  });
});

describe("ingestOfficialPages", () => {
  test("indexes official chunks, reports a changed page on the next run, keeps failed pages and sweeps unlisted ones", async () => {
    const { kbChunks, kbPages, deps } = store();
    const a = page({ url: "https://a.gov.au/fees", label: "Fees" });
    const np = page({ url: "https://moest.gov.np/noc", label: "Nepal NOC", country: undefined, market: "nepal", authority: "education_ministry" });
    let body = html("Fees", LONG);
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url === a.url) return new Response(body, { headers: { "content-type": "text/html" } });
      if (url === np.url) return new Response(html("NOC", LONG), { headers: { "content-type": "text/html" } });
      return new Response("x", { status: 500 });
    }) as typeof fetch;
    const opts = { userAgent: UA, delayMs: 0, fetchImpl, sweep: true };

    const first = await ingestOfficialPages([a, np], deps, opts);
    expect(first.stats).toMatchObject({ pagesSeen: 2, pagesIndexed: 2 });
    expect(first.changed).toEqual([]);
    const chunk = [...kbChunks.rows.values()].find((c) => c.url === "https://a.gov.au/fees")!;
    expect(chunk).toMatchObject({ source: "official:a.gov.au", sourceKind: "official", docType: "official", country: "australia" });
    const nepal = [...kbChunks.rows.values()].find((c) => c.url === "https://moest.gov.np/noc")!;
    expect(nepal).toMatchObject({ docType: "official_market:nepal", country: "global", sourceKind: "official" });
    expect(kbPages.rows.get("https://a.gov.au/fees")!.contentChangedAt).toBeNull();

    const same = await ingestOfficialPages([a, np], deps, opts);
    expect(same.stats).toMatchObject({ pagesUnchanged: 2, chunksWritten: 0 });

    body = html("Fees", LONG.replace("living costs", "living costs of AUD 29,710"));
    const changed = await ingestOfficialPages([a, np], deps, opts);
    expect(changed.changed).toEqual([{ url: "https://a.gov.au/fees", label: "Fees" }]);
    expect(kbPages.rows.get("https://a.gov.au/fees")!.contentChangedAt).toBeInstanceOf(Date);

    // The Nepal page now fails: its last copy stays. Then it leaves the list: it is swept.
    const failing = page({ url: "https://moest.gov.np/noc", label: "Nepal NOC", country: undefined, market: "nepal", authority: "education_ministry" });
    const broken = (async (input: string | URL | Request) => (String(input) === a.url ? new Response(body, { headers: { "content-type": "text/html" } }) : new Response("no", { status: 403 }))) as typeof fetch;
    const kept = await ingestOfficialPages([a, failing], deps, { ...opts, fetchImpl: broken });
    expect(kept.failed).toEqual([{ url: "https://moest.gov.np/noc", status: 403, error: "refused automated access (403)" }]);
    expect(kbPages.rows.has("https://moest.gov.np/noc")).toBe(true);
    expect(kept.swept).toEqual({ pages: 0, chunks: 0 });

    const swept = await sweepOfficialPages([a], { kbChunks, kbPages } as never);
    expect(swept?.pages).toBe(1);
    expect(kbPages.rows.has("https://moest.gov.np/noc")).toBe(false);
    expect([...kbChunks.rows.values()].some((c) => c.url === "https://moest.gov.np/noc")).toBe(false);
  });

  test("never sweeps when the list shrank below half of what is indexed", async () => {
    const { kbPages, kbChunks } = store();
    for (const n of [1, 2, 3, 4]) kbPages.rows.set(`https://a.gov.au/${n}`, { _id: `https://a.gov.au/${n}`, source: "official:a.gov.au" } as KbPageDoc);
    expect(await sweepOfficialPages([page({ url: "https://a.gov.au/1" })], { kbChunks, kbPages } as never)).toBeNull();
    expect(kbPages.rows.size).toBe(4);
  });

  test("a deadline defers the remaining pages", async () => {
    const { deps } = store();
    const { impl } = fakeFetch({});
    const r = await ingestOfficialPages([page()], deps, { userAgent: UA, delayMs: 0, fetchImpl: impl, deadline: Date.now() - 1 });
    expect(r.deferred).toBe(1);
    expect(r.stats.crawl.truncated).toBe(true);
  });

  test("an official source carries its host, country or market and document type", () => {
    expect(officialSource(page())).toMatchObject({ name: "official:immi.homeaffairs.gov.au", country: "australia", docType: "official" });
    expect(officialSource(page({ url: "https://www.nrb.org.np/x", country: undefined, market: "nepal" }))).toMatchObject({ name: "official:nrb.org.np", country: "global", market: "nepal", docType: "official_market:nepal" });
  });
});

const officialChunk = (n: number, over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  id: `official-${n}`,
  url: `https://immi.homeaffairs.gov.au/visas/student-500/${n}`,
  title: "Student visa (500)",
  section: "Eligibility",
  docType: "official",
  country: "australia",
  source: "official:immi.homeaffairs.gov.au",
  sourceKind: "official",
  content: `From 1 July 2024 visitor visa holders cannot apply for a Student visa in Australia. (${n})`,
  score: 1,
  matchedBy: ["vector"],
  ...over,
});

describe("retrieval of official chunks", () => {
  test("source kind and market of an official chunk", () => {
    expect(sourceKindOf("official:gov.uk")).toBe("official");
    expect(officialChunkMarket(officialChunk(1, { docType: "official_market:nepal" }))).toBe("nepal");
    expect(officialChunkMarket(officialChunk(1))).toBeNull();
    expect(officialChunkMarket(sampleChunk(1))).toBeNull();
  });

  test("another market's home-country page goes last; the student's own stays in place", () => {
    const india = officialChunk(1, { docType: "official_market:india", country: "global" });
    const nepal = officialChunk(2, { docType: "official_market:nepal", country: "global" });
    const dest = officialChunk(3);
    const ranked = rankByMarket([india, nepal, dest], "nepal", 3).map((c) => c.id);
    expect(ranked).toEqual(["official-2", "official-3", "official-1"]);
    expect(rankByMarket([india, nepal, dest], "nepal", 2).map((c) => c.id)).toEqual(["official-2", "official-3"]);
  });

  test("indexed official hits count only official chunks for the country", () => {
    expect(indexedOfficialHits([officialChunk(1), officialChunk(2, { country: "canada" }), sampleChunk(1)], "australia")).toBe(1);
  });
});

describe("round 0 with indexed official pages", () => {
  const visitorQ = intentOf({ primary_intent: "onshore_support", destinations: ["australia"], user_question: "Can a visitor visa holder apply for a student visa onshore?", task: "lookup", needs_research: true });
  const slowWeb = (delayMs: number) => {
    const calls: string[] = [];
    const searcher: WebSearcher = {
      async search(query, o) {
        calls.push(query);
        await new Promise((r, reject) => {
          const t = setTimeout(r, delayMs);
          o.signal?.addEventListener("abort", () => (clearTimeout(t), reject(new Error("aborted"))), { once: true });
        });
        return { query, summary: "", queries: [query], fromCache: false, results: [{ url: `https://${o.site}/live`, title: "live", snippet: "live page", allowed: true }] };
      },
    };
    return { searcher, calls };
  };
  const run = (graph: ReturnType<typeof fakeGraph>["graph"], input: string) => graph.invoke({ input, history: [], sessionId: "s1", profile: null });

  test("enough indexed official chunks cancel the live official search", async () => {
    const { searcher } = slowWeb(3_000);
    const knowledge = new RecordingKnowledgeStore(() => [officialChunk(1), officialChunk(2), sampleChunk(1)]);
    const { graph } = fakeGraph({ intent: visitorQ, knowledge, research: { maxRounds: 0, officialKbMinHits: 2 }, tools: { web: searcher } });
    const started = performance.now();
    const state = await run(graph, "Can a visitor visa holder apply for a student visa onshore?");
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(state.meta.round0Official).toEqual({ site: "immi.homeaffairs.gov.au", added: 0, indexed: 2, live: "cancelled" });
    expect(state.evidence.filter((i) => i.url.endsWith("/live"))).toHaveLength(0);
    expect(state.evidence.filter((i) => i.source.startsWith("official:"))).toHaveLength(2);
    expect(state.researchTrace!.toolCalls.filter((c) => c.tool === "web_search")).toHaveLength(0);
  });

  test("too few indexed official chunks (or the threshold off) still waits for the live search", async () => {
    for (const research of [{ maxRounds: 0, officialKbMinHits: 2 }, { maxRounds: 0, officialKbMinHits: 0 }]) {
      const { searcher } = slowWeb(10);
      const knowledge = new RecordingKnowledgeStore(() => [officialChunk(1), officialChunk(2, { country: "canada" }), sampleChunk(1)]);
      const { graph } = fakeGraph({ intent: visitorQ, knowledge, research, tools: { web: searcher }, researchModel: new ScriptedToolModel([new AIMessage({ content: "sufficient" })]) });
      const state = await run(graph, "Can a visitor visa holder apply for a student visa onshore?");
      expect(state.meta.round0Official).toMatchObject({ site: "immi.homeaffairs.gov.au", added: 1 });
      expect(state.evidence.some((i) => i.url === "https://immi.homeaffairs.gov.au/live")).toBe(true);
    }
  });
});
