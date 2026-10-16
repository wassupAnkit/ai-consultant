import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { ApiError } from "../src/app/http";
import { requireAdmin } from "../src/app/routes";
import { ChatService } from "../src/app/service";
import { buildPartnerDocuments } from "../src/ingest/partners";
import { partnerSources } from "../src/ingest/sources";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { isAggregatorHost, parseTabCounts, pickWebsite, scoreCandidate } from "../src/partners/discover";
import { domainsForWebsite, ensurePartnerRegistry, InMemoryPartnerRegistry, partnerDomains, seedsToRecords, slugify } from "../src/partners/registry";
import { NullKnowledgeStore } from "../src/retrieval/store";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

const seeds = [
  { name: "Monash University", country: "australia" as const, website: "https://www.monash.edu" },
  { name: "Charles Sturt University", country: "australia" as const, website: "https://study.csu.edu.au", paths: ["/courses"], maxPages: 50 },
  { name: "The University of Adelaide College", country: "australia" as const, website: "https://www.adelaide.edu.au", paths: ["/college"], maxPages: 40 },
  { name: "PLACEHOLDER — add Canada partners (23)", country: "canada" as const, website: null, enabled: false },
  { name: "Université de Montréal", country: "canada" as const, website: null },
];

describe("partner registry", () => {
  test("slugify and domainsForWebsite", () => {
    expect(slugify("Monash University")).toBe("monash-university");
    expect(slugify("Université de Montréal")).toBe("universite-de-montreal");
    expect(slugify("A&M")).toBe("a-and-m");
    expect(domainsForWebsite("https://study.csu.edu.au")).toEqual(["study.csu.edu.au", "csu.edu.au"]);
    expect(domainsForWebsite("https://www.monash.edu")).toEqual(["monash.edu"]);
    expect(domainsForWebsite("https://bond.edu.au")).toEqual(["bond.edu.au"]);
    expect(domainsForWebsite(null)).toEqual([]);
  });

  test("seedsToRecords skips placeholders and derives domains/enabled/verified", () => {
    const records = seedsToRecords(seeds);
    expect(records.map((r) => r.slug)).toEqual(["monash-university", "charles-sturt-university", "the-university-of-adelaide-college", "universite-de-montreal"]);
    const csu = records[1]!;
    expect(csu.domains).toEqual(["study.csu.edu.au", "csu.edu.au"]);
    expect(csu.programPaths).toEqual(["/courses"]);
    expect(csu.maxPages).toBe(50);
    expect(csu.enabled).toBe(true);
    expect(csu.verified).toBe(true);
    const udem = records[3]!;
    expect(udem.website).toBeNull();
    expect(udem.enabled).toBe(false); // no website → nothing to crawl
    expect(udem.verified).toBe(false);
  });

  test("in-memory registry CRUD, domains and seeding", async () => {
    const reg = new InMemoryPartnerRegistry();
    expect(await reg.count()).toBe(0);
    const records = await ensurePartnerRegistry(reg, { seedsPath: new URL("../data/partners.json", import.meta.url) });
    expect(records.length).toBeGreaterThan(30);
    expect((await reg.get("monash-university"))?.website).toBe("https://www.monash.edu");
    const domains = await reg.domains();
    expect(domains.has("monash.edu")).toBe(true);
    expect(domains.has("csu.edu.au")).toBe(true);

    const up = await reg.upsert({ slug: "university-of-toronto", name: "University of Toronto", country: "canada", website: "https://www.utoronto.ca", domains: ["WWW.UTORONTO.CA"] }, "admin@heubert.com");
    expect(up.domains).toEqual(["utoronto.ca"]);
    expect(up.updatedBy).toBe("admin@heubert.com");
    expect((await reg.list({ country: "canada" })).map((r) => r.slug)).toEqual(["university-of-toronto"]);
    expect(await reg.remove("university-of-toronto")).toBe(true);
    expect(await reg.remove("university-of-toronto")).toBe(false);
    expect(() => reg.upsert({ slug: "Bad Slug", name: "x", country: "canada", website: null })).toThrow();
    expect(partnerDomains([{ ...records[0]!, enabled: false }]).size).toBe(0);
  });

  test("partnerSources scopes every registry domain and subdomain to program paths", () => {
    const [monash, csu] = partnerSources(seedsToRecords(seeds).slice(0, 2), { maxPages: 300 });
    expect(monash!.name).toBe("partner:monash-university");
    expect(monash!.partnerSlug).toBe("monash-university");
    expect(monash!.maxPages).toBe(300);
    expect(monash!.allow.some((re) => re.test("https://www.monash.edu/study/courses/x"))).toBe(true);
    expect(monash!.allow.some((re) => re.test("https://handbook.monash.edu/courses/x"))).toBe(true);
    expect(monash!.allow.some((re) => re.test("https://www.monash.edu/news/x"))).toBe(false);
    expect(monash!.allow.some((re) => re.test("https://www.notmonash.edu/courses/x"))).toBe(false);
    expect(csu!.maxPages).toBe(50);
    expect(csu!.allow.some((re) => re.test("https://www.csu.edu.au/courses/x"))).toBe(true);
    expect(csu!.allow.some((re) => re.test("https://study.csu.edu.au/"))).toBe(true);
    expect(csu!.deny!.some((re) => re.test("https://study.csu.edu.au/courses/news/x"))).toBe(true);
    expect(partnerSources(seedsToRecords(seeds).slice(3))).toHaveLength(0); // no website → not crawled
  });

  test("buildPartnerDocuments lists partners per country and keeps unknown site names", () => {
    const pages = buildPartnerDocuments(seedsToRecords(seeds), ["Monash University", "Deakin University"]);
    const au = pages.find((p) => p.url.endsWith("#australia"))!;
    expect(au.text).toContain("Monash University (https://www.monash.edu)");
    expect(au.text).toContain("3 partner universities");
    const unlisted = pages.find((p) => p.url.endsWith("#unlisted"))!;
    expect(unlisted.text).toContain("Deakin University");
    expect(unlisted.text).not.toContain("Monash");
  });
});

describe("partner discovery helpers", () => {
  test("parseTabCounts reads per-country counts from the partners page", () => {
    const html = `<div role="tablist"><button aria-pressed="true"><span>Australia</span><span class="count">34</span></button>
      <button><span>Canada</span> <span>(23)</span></button><button><span>United Kingdom</span><em>34</em></button>
      <button><span>New Zealand</span><span>22</span></button></div><p>Thailand office 2003</p>`;
    expect(parseTabCounts(html)).toEqual({ australia: 34, canada: 23, united_kingdom: 34, new_zealand: 22 });
  });

  test("scoreCandidate prefers academic domains matching the name and rejects aggregators", () => {
    expect(isAggregatorHost("en.wikipedia.org")).toBe(true);
    expect(isAggregatorHost("www.topuniversities.com")).toBe(true);
    expect(isAggregatorHost("utoronto.ca")).toBe(false);
    expect(scoreCandidate("University of Toronto", "www.topuniversities.com", "Top universities").score).toBe(0);
    const good = scoreCandidate("University of Toronto", "www.utoronto.ca", "University of Toronto");
    expect(good.score).toBeGreaterThanOrEqual(0.8);
    const acr = scoreCandidate("Charles Sturt University", "study.csu.edu.au", "Study at CSU");
    expect(acr.reasons.join()).toContain("acronym csu");
    expect(acr.score).toBeGreaterThan(0.5);
    const weak = scoreCandidate("University of Toronto", "www.randomblog.com", "Cheap flights");
    expect(weak.score).toBeLessThan(0.3);
    const best = pickWebsite("University of Toronto", [
      { url: "https://www.topuniversities.com/universities/university-toronto", title: "University of Toronto : Rankings" },
      { url: "https://www.utoronto.ca/", title: "University of Toronto" },
    ]);
    expect(best?.url).toBe("https://utoronto.ca");
    expect(pickWebsite("X", [{ url: "https://en.wikipedia.org/wiki/X", title: "X" }])).toBeNull();
  });
});

describe("partner admin API", () => {
  const API_KEY = "test-api-key-0123456789abcdef0123456789";
  let base = "";
  let app: ReturnType<typeof createApp>;
  const registry = new InMemoryPartnerRegistry(seedsToRecords(seeds));

  beforeAll(() => {
    const env = testEnv({ API_KEY });
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "company_services" }) });
    const store = new InMemoryChatStore();
    const service = new ChatService({ env, graph, store, logger: createLogger({ test: true }) });
    app = createApp(
      { env, service, store, knowledge: new NullKnowledgeStore([sampleChunk()]), collections: null, logger: createLogger({ test: true }), readiness: async () => ({ ok: true, checks: {} }), startedAt: Date.now(), partners: registry },
      { port: 0, hostname: "127.0.0.1" },
    );
    base = `http://127.0.0.1:${app.server.port}`;
  });
  afterAll(async () => {
    await app.shutdown(1_000);
  });
  const headers = { "content-type": "application/json", "x-api-key": API_KEY };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (r: Response): Promise<any> => r.json();

  test("lists, filters, creates, updates and deletes partners", async () => {
    const list = await j(await fetch(`${base}/v1/knowledge/partners`, { headers }));
    expect(list.count).toBe(4);
    expect(list.byCountry).toEqual({ australia: 3, canada: 1 });
    const au = await j(await fetch(`${base}/v1/knowledge/partners?country=australia&enabled=true`, { headers }));
    expect(au.count).toBe(3);

    const put = await fetch(`${base}/v1/knowledge/partners/university-of-toronto`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ name: "University of Toronto", country: "canada", website: "https://www.utoronto.ca", verified: true }),
    });
    expect(put.status).toBe(201);
    const created = await j(put);
    expect(created.created).toBe(true);
    expect(created.partner.domains).toEqual(["utoronto.ca"]);
    expect(created.partner.source).toBe("admin");

    const again = await fetch(`${base}/v1/knowledge/partners/university-of-toronto`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ name: "University of Toronto", country: "canada", website: "https://www.utoronto.ca", enabled: false }),
    });
    expect(again.status).toBe(200);
    expect((await j(again)).partner.enabled).toBe(false);

    const one = await j(await fetch(`${base}/v1/knowledge/partners/university-of-toronto`, { headers }));
    expect(one.partner.name).toBe("University of Toronto");
    expect((await fetch(`${base}/v1/knowledge/partners/nope`, { headers })).status).toBe(404);

    const bad = await fetch(`${base}/v1/knowledge/partners/x`, { method: "PUT", headers, body: JSON.stringify({ name: "x" }) });
    expect(bad.status).toBe(400);

    const del = await fetch(`${base}/v1/knowledge/partners/university-of-toronto`, { method: "DELETE", headers });
    expect(del.status).toBe(200);
    expect((await fetch(`${base}/v1/knowledge/partners/university-of-toronto`, { method: "DELETE", headers })).status).toBe(404);
    expect((await fetch(`${base}/v1/knowledge/partners`)).status).toBe(401);
  });

  test("requireAdmin: api key always, staff unless ADMIN_EMAILS restricts", () => {
    const ctx = (over: Partial<Parameters<typeof requireAdmin>[0]>) =>
      ({ requestId: "r", ownerId: "a@heubert.com", auth: "session", user: { id: "1", email: "a@heubert.com", name: null, picture: null }, signal: new AbortController().signal, details: {}, ...over }) as Parameters<typeof requireAdmin>[0];
    expect(() => requireAdmin(ctx({}), { ADMIN_EMAILS: [] })).not.toThrow();
    expect(() => requireAdmin(ctx({ auth: "api_key", user: null, ownerId: "anonymous" }), { ADMIN_EMAILS: ["b@heubert.com"] })).not.toThrow();
    // x-api-key acting for a user (x-user-id) inherits that user's rights, not the server's.
    expect(() => requireAdmin(ctx({ auth: "api_key", user: null, ownerId: "c@heubert.com" }), { ADMIN_EMAILS: ["b@heubert.com"] })).toThrow(ApiError);
    expect(() => requireAdmin(ctx({ auth: "api_key", user: null, ownerId: "c@heubert.com" }), { ADMIN_EMAILS: [] })).not.toThrow();
    expect(() => requireAdmin(ctx({}), { ADMIN_EMAILS: ["b@heubert.com"] })).toThrow(ApiError);
    expect(() => requireAdmin(ctx({}), { ADMIN_EMAILS: ["A@heubert.com".toLowerCase()] })).not.toThrow();
    expect(() => requireAdmin(ctx({ ownerId: "anonymous", user: null, auth: "none" }), { ADMIN_EMAILS: [] })).toThrow(/Sign in/);
  });
});
