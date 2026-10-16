/**
 * Fill in the partner registry for countries whose lists the website renders
 * client-side (everything except Australia). Sources, in order:
 *   1. per-country target counts parsed from the partners page tabs
 *   2. Australian names server-rendered as <img alt> on the partners page
 *   3. data/partners-names/<country>.txt — one institution name per line, pasted
 *      by a consultant from the website tab (the reliable path)
 *   4. Gemini web search to propose a name list when no file exists
 * Then, for every name without a website, a grounded web search proposes the
 * official site, which is scored against the name and (optionally) verified by
 * fetching the homepage title. Results go to a review file; --apply upserts
 * confident rows (unverified) into kb_partners.
 *
 *   bun run partners:discover                       # dry run → data/partners.review.json
 *   bun run partners:discover -- --country canada --apply --min 0.8
 *   bun run partners:discover -- --no-verify          # skip homepage fetches
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadEnv } from "../src/config/env";
import { closeMongo, getCollections, getDb } from "../src/db/mongo";
import { fetchPartnerNamesFromSite, PARTNERS_URL } from "../src/ingest/partners";
import { InMemoryLiveCache } from "../src/live/cache";
import { webSearch } from "../src/live/search";
import { GeminiGenerate } from "../src/llm/generate";
import { logger, setLogLevel } from "../src/observability/logger";
import { COUNTRY_LABELS, parseTabCounts, pickWebsite, type DiscoveryRow } from "../src/partners/discover";
import { domainsForWebsite, ensurePartnerRegistry, MongoPartnerRegistry, slugify } from "../src/partners/registry";
import { DESTINATIONS, type Destination } from "../src/schemas/intent.schema";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    country: { type: "string" },
    apply: { type: "boolean", default: false },
    min: { type: "string", default: "0.8" },
    "no-verify": { type: "boolean", default: false },
    "no-search": { type: "boolean", default: false },
    out: { type: "string", default: "data/partners.review.json" },
    concurrency: { type: "string", default: "3" },
  },
});

const env = loadEnv();
setLogLevel(env.LOG_LEVEL);
const registry = new MongoPartnerRegistry(getCollections(getDb(env)).kbPartners);
const existing = await ensurePartnerRegistry(registry, { log: (m, meta) => logger.info(m, meta) });
const gemini = new GeminiGenerate({ apiKey: env.GOOGLE_API_KEY });
const cache = new InMemoryLiveCache();
const search = (q: string) => webSearch(q, { k: 6 }, { gen: gemini, model: env.GEMINI_WEB_SEARCH_MODEL, cache, resolveRedirects: true });
const minConfidence = Number(values.min);
const countries = (values.country ? [values.country as Destination] : DESTINATIONS.filter((d) => d !== "other")) as Destination[];

// 1. Targets from the partners page + 2. Australian names.
let targets: Partial<Record<Destination, number>> = {};
let siteNames: string[] = [];
try {
  const res = await fetch(PARTNERS_URL, { headers: { "user-agent": env.CRAWL_USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  const html = await res.text();
  targets = parseTabCounts(html);
  siteNames = await fetchPartnerNamesFromSite();
} catch (err) {
  logger.warn("could not read the partners page", { err: (err as Error).message });
}

const known = new Map(existing.map((r) => [r.name.toLowerCase(), r]));
const rows: DiscoveryRow[] = [];

for (const country of countries) {
  // 3. Names pasted by a consultant, else 4. Gemini proposals.
  const file = `data/partners-names/${country}.txt`;
  let names: string[] = [];
  if (existsSync(file)) {
    names = (await Bun.file(file).text()).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    logger.info("using pasted name list", { country, file, names: names.length });
  } else if (country === "australia") {
    names = siteNames;
  } else if (!values["no-search"]) {
    const label = COUNTRY_LABELS[country][0];
    const r = await search(`Expert Education partner universities ${label} site:experteducation.com`).catch(() => null);
    const proposed = (r?.summary ?? "").match(/[A-Z][A-Za-z&'.-]+(?: [A-Za-z&'.-]+){1,6}(?: University| College| Institute)|(?:University|Institute|College) of [A-Z][A-Za-z ]+/g) ?? [];
    names = [...new Set(proposed.map((n) => n.trim()))];
    logger.info("proposed names from web search", { country, names: names.length, target: targets[country] ?? null });
  }

  const queue = [...names];
  const concurrency = Math.max(1, Number(values.concurrency));
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const name = queue.shift()!;
        const have = known.get(name.toLowerCase());
        if (have?.website) {
          rows.push({ country, name, website: have.website, domains: have.domains, confidence: 1, evidence: ["already in registry"], status: "verified" });
          continue;
        }
        let website: string | null = null;
        let confidence = 0;
        const evidence: string[] = [];
        if (!values["no-search"]) {
          const r = await search(`${name} official website`).catch(() => null);
          const picked = r ? pickWebsite(name, r.results.map((x) => ({ url: x.url, title: x.title }))) : null;
          if (picked) {
            website = picked.url;
            confidence = picked.confidence;
            evidence.push(...picked.reasons);
          }
        }
        if (website && !values["no-verify"]) {
          try {
            const res = await fetch(website, { headers: { "user-agent": env.CRAWL_USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
            const title = (await res.text()).match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? null;
            if (res.ok && title) {
              const again = pickWebsite(name, [{ url: res.url || website, title }]);
              if (again && again.confidence > confidence) {
                confidence = again.confidence;
                evidence.push(`homepage title "${title}"`);
              }
            } else evidence.push(`homepage HTTP ${res.status}`);
          } catch (err) {
            evidence.push(`homepage fetch failed: ${(err as Error).message}`);
          }
        }
        rows.push({
          country,
          name,
          website,
          domains: domainsForWebsite(website),
          confidence,
          evidence,
          status: !website ? "missing" : confidence >= minConfidence ? "verified" : "review",
        });
      }
    }),
  );
}

rows.sort((a, b) => a.country.localeCompare(b.country) || b.confidence - a.confidence || a.name.localeCompare(b.name));
await Bun.write(values.out!, JSON.stringify({ generatedAt: new Date().toISOString(), targets, rows }, null, 2) + "\n");

const summary = countries.map((c) => {
  const mine = rows.filter((r) => r.country === c);
  return { country: c, target: targets[c] ?? null, found: mine.length, confident: mine.filter((r) => r.status === "verified").length, review: mine.filter((r) => r.status === "review").length, missing: mine.filter((r) => r.status === "missing").length };
});
console.table(summary);
console.log(`Review file: ${values.out}`);

if (values.apply) {
  let applied = 0;
  for (const r of rows) {
    if (r.status !== "verified" || !r.website || known.get(r.name.toLowerCase())?.website) continue;
    await registry.upsert(
      { slug: slugify(r.name), name: r.name, country: r.country, website: r.website, domains: r.domains, enabled: true, verified: false, source: "discover", notes: r.evidence.join("; ").slice(0, 900) },
      "partners-discover",
    );
    applied++;
  }
  logger.info("applied discovered partners (unverified; confirm via PUT /v1/knowledge/partners/:slug)", { applied });
}

await closeMongo();
