import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { InMemoryLiveCache } from "../src/live/cache";
import { __resetRobotsCache, fetchPageForAnswer, LiveFetchError } from "../src/live/fetch";
import { partnerDomainsOf } from "../src/live/partner-domains";
import { DomainPolicy, extractUrls, isPrivateHost, isPrivateIp } from "../src/live/policy";
import { resolveRedirect, webSearch } from "../src/live/search";
import { parseGenerateResponse, zodToGeminiSchema } from "../src/llm/generate";
import { EvidenceCollector } from "../src/tools/evidence";
import { pageToChunks } from "../src/tools/fetch-page";
import { programToChunk } from "../src/tools/programs";
import { webResultsToChunks } from "../src/tools/web-search";
import { fakeFetch, FakeGemini, groundedResult, htmlResponse, SAMPLE_HTML, sampleProgram } from "./fakes";
import { sampleChunk } from "./helpers";

const publicDns = async () => ["93.184.216.34"];
const policy = () =>
  new DomainPolicy({
    allow: ["experteducation.com", "homeaffairs.gov.au"],
    partnerDomains: async () => ["monash.edu", "study.csu.edu.au"],
    resolve: publicDns,
  });

describe("DomainPolicy", () => {
  test("allowlist, subdomains and partner domains are allowed", async () => {
    const p = policy();
    expect((await p.check("https://www.experteducation.com/nepal/")).ok).toBe(true);
    expect(await p.check("https://immi.homeaffairs.gov.au/visas")).toMatchObject({ ok: true, reason: "allowlist" });
    expect(await p.check("https://www.monash.edu/study")).toMatchObject({ ok: true, reason: "partner", host: "monash.edu" });
    expect(await p.check("https://handbook.monash.edu/2026/units")).toMatchObject({ ok: true, reason: "partner" });
    expect(await p.check("https://study.csu.edu.au/courses")).toMatchObject({ ok: true });
  });

  test("unknown hosts are refused unless the consultant supplied the URL", async () => {
    const p = policy();
    expect(await p.check("https://random-blog.example.com/x")).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(await p.check("https://random-blog.example.com/x", { explicit: true })).toMatchObject({ ok: true, reason: "explicit" });
    const strict = new DomainPolicy({ allow: [], allowExplicitUrls: false, resolve: publicDns });
    expect((await strict.check("https://random-blog.example.com/x", { explicit: true })).ok).toBe(false);
  });

  test("SSRF guards: private addresses, localhost, bad schemes, credentials, private DNS", async () => {
    const p = policy();
    expect(await p.check("http://10.0.0.5/admin", { explicit: true })).toMatchObject({ ok: false, reason: "private_address" });
    expect(await p.check("http://169.254.169.254/latest/meta-data", { explicit: true })).toMatchObject({ ok: false, reason: "private_address" });
    expect(await p.check("http://localhost:3000/", { explicit: true })).toMatchObject({ ok: false, reason: "private_address" });
    expect(await p.check("http://[::1]/", { explicit: true })).toMatchObject({ ok: false, reason: "private_address" });
    expect(await p.check("ftp://monash.edu/file")).toMatchObject({ ok: false, reason: "unsupported_scheme" });
    expect(await p.check("https://user:pw@example.com/")).toMatchObject({ ok: false, reason: "credentials_in_url" });
    expect(await p.check("http://8.8.8.8/", { explicit: true })).toMatchObject({ ok: false, reason: "ip_literal" });
    const rebinding = new DomainPolicy({ allow: [], resolve: async () => ["192.168.1.10"] });
    expect(await rebinding.check("https://evil.example.com/", { explicit: true })).toMatchObject({ ok: false, reason: "resolves_to_private_address" });
    const dead = new DomainPolicy({ allow: [], resolve: async () => [] });
    expect(await dead.check("https://nx.example.com/", { explicit: true })).toMatchObject({ ok: false, reason: "dns_failed" });
  });

  test("isPrivateIp / isPrivateHost cover v4, v6 and mapped addresses", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "127.0.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["172.32.0.1", "8.8.8.8", "93.184.216.34", "1.1.1.1"]) expect(isPrivateIp(ip)).toBe(false);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fd12:3456::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("db.internal")).toBe(true);
    expect(isPrivateHost("monash.edu")).toBe(false);
  });

  test("extractUrls finds pasted URLs and strips trailing punctuation", () => {
    const urls = extractUrls("See https://www.monash.edu/study/courses, and (https://immi.homeaffairs.gov.au/visas/x). Not ftp://x.");
    expect(urls).toEqual(["https://www.monash.edu/study/courses", "https://immi.homeaffairs.gov.au/visas/x"]);
  });

  test("partnerDomainsOf derives registrable parents for subdomain sites", () => {
    const set = partnerDomainsOf([
      { website: "https://study.csu.edu.au", enabled: true },
      { website: "https://www.monash.edu" },
      { website: null, enabled: false },
      { website: "https://bond.edu.au", enabled: false },
    ]);
    expect(set.has("study.csu.edu.au")).toBe(true);
    expect(set.has("csu.edu.au")).toBe(true);
    expect(set.has("monash.edu")).toBe(true);
    expect(set.has("bond.edu.au")).toBe(false);
  });
});

describe("fetchPageForAnswer", () => {
  const base = { userAgent: "EdgeTest/1.0", timeoutMs: 500, ignoreRobots: true };
  const page = "https://www.monash.edu/study/courses/find-a-course/information-technology-c6001";

  test("fetches an allowed HTML page and returns clean sections", async () => {
    const fetchImpl = fakeFetch({ [page]: htmlResponse(SAMPLE_HTML, page) });
    const res = await fetchPageForAnswer(page, {}, { ...base, policy: policy(), fetchImpl });
    expect(res.title).toContain("Master of IT");
    expect(res.text).toContain("AUD 47,900");
    expect(res.text).not.toContain("© Monash");
    expect(res.sections.map((s) => s.heading)).toContain("Fees");
    expect(res.fromCache).toBe(false);
  });

  test("refuses disallowed hosts, PDFs and robots-disallowed paths", async () => {
    const pdf = "https://www.monash.edu/brochure.pdf";
    const fetchImpl = fakeFetch({
      [pdf]: new Response("%PDF", { headers: { "content-type": "application/pdf" } }),
      "https://www.monash.edu/robots.txt": new Response("User-agent: *\nDisallow: /private/\n"),
      "https://www.monash.edu/private/x": htmlResponse(SAMPLE_HTML),
    });
    await expect(fetchPageForAnswer("https://evil.example.com/", {}, { ...base, policy: policy(), fetchImpl })).rejects.toMatchObject({ code: "policy_denied" });
    await expect(fetchPageForAnswer(pdf, {}, { ...base, policy: policy(), fetchImpl })).rejects.toMatchObject({ code: "unsupported_content" });
    __resetRobotsCache();
    await expect(fetchPageForAnswer("https://www.monash.edu/private/x", {}, { ...base, ignoreRobots: false, policy: policy(), fetchImpl })).rejects.toMatchObject({
      code: "robots_disallowed",
    });
  });

  test("JavaScript-rendered pages fall back to meta description + JSON-LD instead of failing", async () => {
    const spa = `<!doctype html><html><head><title>Master of IT - Monash</title><meta name="description" content="Monash Master of Information Technology: 2 years full time, February and July intakes.">
      <script type="application/ld+json">{"@type":"Course","name":"Master of Information Technology","provider":{"name":"Monash University"}}</script></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
    const fetchImpl = fakeFetch({ [page]: htmlResponse(spa, page) });
    const res = await fetchPageForAnswer(page, {}, { ...base, policy: policy(), fetchImpl });
    expect(res.text).toContain("JavaScript-rendered");
    expect(res.text).toContain("February and July intakes");
    expect(res.text).toContain('"@type":"Course"');
    const empty = `<html><head><title>x</title></head><body><div id="root"></div></body></html>`;
    await expect(fetchPageForAnswer(page, {}, { ...base, policy: policy(), fetchImpl: fakeFetch({ [page]: htmlResponse(empty, page) }) })).rejects.toMatchObject({ code: "unsupported_content" });
  });

  test("re-checks the domain policy after a redirect", async () => {
    const fetchImpl = fakeFetch({ [page]: htmlResponse(SAMPLE_HTML, "https://tracker.example.net/landing") });
    await expect(fetchPageForAnswer(page, {}, { ...base, policy: policy(), fetchImpl })).rejects.toMatchObject({ code: "policy_denied" });
  });

  test("caps the body, caches the result and surfaces timeouts", async () => {
    const big = SAMPLE_HTML.replace("</main>", "<p>" + "x".repeat(50_000) + "</p></main>");
    const cache = new InMemoryLiveCache();
    const fetchImpl = fakeFetch({ [page]: htmlResponse(big, page) });
    const first = await fetchPageForAnswer(page, {}, { ...base, policy: policy(), fetchImpl, cache, maxBytes: 10_000 });
    expect(first.truncated).toBe(true);
    const second = await fetchPageForAnswer(page, {}, { ...base, policy: policy(), fetchImpl, cache, maxBytes: 10_000 });
    expect(second.fromCache).toBe(true);
    expect((fetchImpl as unknown as { calls: string[] }).calls.filter((u) => u === page)).toHaveLength(1);

    const hang = (async (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }))))) as unknown as typeof fetch;
    await expect(fetchPageForAnswer(page, {}, { ...base, policy: policy(), fetchImpl: hang, timeoutMs: 30 })).rejects.toMatchObject({ code: "timeout" });
  });

  test("LiveFetchError carries a machine-readable code", () => {
    const e = new LiveFetchError("http_error", "HTTP 500");
    expect(e.code).toBe("http_error");
    expect(e.name).toBe("LiveFetchError");
  });
});

describe("webSearch (Gemini grounding)", () => {
  test("maps grounding chunks to results with snippets and policy flags, and caches", async () => {
    const gen = new FakeGemini([groundedResult()]);
    const cache = new InMemoryLiveCache();
    const deps = { gen: gen.asGemini(), model: "gemini-test", cache, policy: policy(), resolveRedirects: false };
    const r = await webSearch("monash master of IT fees", {}, deps);
    expect(gen.requests[0]!.tools).toEqual([{ google_search: {} }]);
    expect(r.results).toHaveLength(2);
    expect(r.results[0]).toMatchObject({ url: expect.stringContaining("monash.edu"), allowed: true });
    expect(r.results[0]!.snippet).toContain("AUD 47,900");
    expect(r.results[1]).toMatchObject({ allowed: false });
    expect(r.summary).toContain("47,900");
    expect(r.queries).toEqual(["monash master of IT international fees 2026"]);
    const again = await webSearch("monash master of IT fees", {}, deps);
    expect(again.fromCache).toBe(true);
    expect(gen.requests).toHaveLength(1);
    const sited = await webSearch("fees", { site: "monash.edu" }, deps);
    expect(gen.requests[1]!.parts).toEqual([{ text: "site:monash.edu fees" }]);
    expect(sited.query).toBe("site:monash.edu fees");
  });

  test("resolveRedirect follows Google's grounding redirect once", async () => {
    const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc";
    const fetchImpl = fakeFetch({ [redirect]: new Response(null, { status: 302, headers: { location: "https://www.monash.edu/study" } }) });
    expect(await resolveRedirect(redirect, fetchImpl)).toBe("https://www.monash.edu/study");
    expect(await resolveRedirect("https://www.monash.edu/x", fetchImpl)).toBe("https://www.monash.edu/x");
  });
});

describe("GeminiGenerate helpers", () => {
  test("parseGenerateResponse extracts text, JSON, grounding and usage", () => {
    const r = parseGenerateResponse({
      candidates: [
        {
          content: { parts: [{ text: '{"programs":[{"name":"MIT"}]}' }] },
          finishReason: "STOP",
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://a.example/x", title: "a.example" } }, { web: {} }],
            webSearchQueries: ["q1"],
            groundingSupports: [{ segment: { text: "MIT" }, groundingChunkIndices: [0] }],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    });
    expect(r.json).toEqual({ programs: [{ name: "MIT" }] });
    expect(r.grounding?.chunks).toEqual([{ uri: "https://a.example/x", title: "a.example" }]);
    expect(r.grounding?.supports[0]).toEqual({ text: "MIT", chunkIndexes: [0] });
    expect(r.usage.total).toBe(15);
    expect(parseGenerateResponse({ promptFeedback: { blockReason: "SAFETY" } }).finishReason).toBe("SAFETY");
  });

  test("zodToGeminiSchema strips $schema/$defs and inlines refs", () => {
    const Inner = z.object({ amount: z.number().nullable(), currency: z.string() });
    const schema = zodToGeminiSchema(z.object({ name: z.string().describe("Program name"), fees: z.array(Inner), level: z.enum(["bachelor", "master"]).optional() }));
    expect(schema.$schema).toBeUndefined();
    expect(JSON.stringify(schema)).not.toContain("$ref");
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.name).toMatchObject({ type: "string", description: "Program name" });
    expect((props.fees!.items as Record<string, unknown>).properties).toBeDefined();
  });

  test("zodToGeminiSchema drops array size bounds Gemini rejects", () => {
    // Gemini answered HTTP 400 INVALID_ARGUMENT to every program extraction
    // while the schema carried maxItems (verified live 2026-10-09); zod still
    // enforces the bounds on the parsed response.
    const schema = zodToGeminiSchema(z.object({ tags: z.array(z.string().max(40)).min(1).max(8), year: z.number().int() }));
    const json = JSON.stringify(schema);
    expect(json).not.toContain("maxItems");
    expect(json).not.toContain("minItems");
    expect(json).toContain('"maxLength":40');
    expect(json).not.toContain(String(Number.MAX_SAFE_INTEGER));
  });
});

describe("evidence", () => {
  test("EvidenceCollector numbers, de-duplicates and caps", () => {
    const c = new EvidenceCollector(3);
    const a = c.add([sampleChunk(1), sampleChunk(2)], "kb", false);
    expect(a.map((i) => i.n)).toEqual([1, 2]);
    expect(c.add([sampleChunk(1)], "kb", false)).toHaveLength(0); // same url + content
    const b = c.add([sampleChunk(3), sampleChunk(4)], "kb", false);
    expect(b.map((i) => i.n)).toEqual([3]);
    expect(c.full).toBe(true);
    expect(EvidenceCollector.summaryForModel(a)).toContain("[1] Study in Australia — Tuition & Costs");
    expect(EvidenceCollector.summaryForModel([])).toContain("No new evidence");
  });

  test("pageToChunks ranks sections by focus terms and marks them live", async () => {
    const fetchImpl = fakeFetch({ "https://www.monash.edu/x": htmlResponse(SAMPLE_HTML, "https://www.monash.edu/x") });
    const page = await fetchPageForAnswer("https://www.monash.edu/x", {}, { policy: policy(), fetchImpl, userAgent: "t", ignoreRobots: true });
    const focused = pageToChunks(page, "international tuition fees", 1);
    expect(focused).toHaveLength(1);
    expect(focused[0]!.content).toContain("AUD 47,900");
    expect(focused[0]).toMatchObject({ source: "live:monash.edu", docType: "live_page", matchedBy: ["page"] });
    const plain = pageToChunks(page);
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.length).toBeLessThanOrEqual(3);
  });

  test("web results and program records become citable chunks", () => {
    const web = webResultsToChunks({ query: "q", summary: "s", queries: [], fromCache: false, results: [{ url: "https://www.monash.edu/a", title: null, snippet: "AUD 47,900", allowed: true }, { url: "https://x.example/b", title: "x", snippet: null, allowed: false }] });
    expect(web).toHaveLength(1);
    expect(web[0]).toMatchObject({ title: "monash.edu", source: "web:monash.edu", matchedBy: ["web"] });
    const prog = programToChunk(sampleProgram());
    expect(prog).toMatchObject({ title: "Monash University — Master of Information Technology", docType: "program", source: "kb_programs" });
    expect(prog.content).toContain("AUD 47,900");
  });
});
