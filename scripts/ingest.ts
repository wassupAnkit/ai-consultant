/**
 * Knowledge-base ingestion CLI (also what the Kubernetes CronJobs run).
 *
 *   bun run ingest                                   # experteducation.com, all markets (+ partner list docs)
 *   bun run ingest -- --market nepal                 # one market section
 *   bun run ingest -- --source partners              # every enabled partner-university site in kb_partners
 *   bun run ingest -- --source partners --country canada
 *   bun run ingest -- --source partners --partner monash-university,university-of-adelaide
 *   bun run ingest -- --source guides                # Expert's curated guides only (data/markets|compliance|facts|counsellor)
 *   bun run ingest -- --source official --sweep      # curated official pages (data/official-pages.json + facts-register sources)
 *   bun run ingest -- --source all --sweep --deadline-minutes 300   # nightly: guides, site, partners; delete vanished pages
 *   bun run ingest -- --from-requests --deadline-minutes 25          # drain POST /v1/knowledge/reindex requests
 *   bun run ingest -- --source all --max 50 --dry-run
 *   bun run ingest -- --force                        # re-embed unchanged pages
 *
 * Partners come from the kb_partners registry (seeded from data/partners.json on
 * first run; maintained via PUT /v1/knowledge/partners/:slug or partners:sync).
 * Sitemaps seed partner crawls and lastmod skips unchanged pages; course-like
 * URLs are fetched first. Every run is recorded in kb_ingest_runs.
 *
 * `all` also re-fetches the official pages (src/ingest/official.ts) after the guides: exact government,
 * regulator and test-body URLs, one host request at a time, reporting pages whose text changed.
 *
 * `all` starts with Expert's curated guides (src/ingest/guides.ts, also `bun run ingest:guides`):
 * a few hundred chunks, re-embedded only when a section changed, synced before the crawl so a
 * deadline never defers them.
 */
import { parseArgs } from "node:util";
import { loadEnv } from "../src/config/env";
import { closeMongo, ensureIndexes, getCollections, getDb, type Collections } from "../src/db/mongo";
import { GeminiEmbeddings } from "../src/llm/embeddings";
import { GeminiGenerate } from "../src/llm/generate";
import { guideIngestStats, ingestGuides, loadGuideFiles } from "../src/ingest/guides";
import { ingestOfficialPages, loadOfficialPages } from "../src/ingest/official";
import { indexPartnerList } from "../src/ingest/partners";
import { extractPrograms, storePrograms } from "../src/ingest/programs";
import { ingestSource, shouldSweep, sweepOrphans, type IngestDeps, type IngestStats } from "../src/ingest/pipeline";
import { IngestRunLog, previousCompleteRun, type IngestRunSource, type KbIngestRunDoc } from "../src/ingest/runs";
import { partnerSources, siteSources, type CrawlSource } from "../src/ingest/sources";
import { logger, setLogLevel } from "../src/observability/logger";
import { ensurePartnerRegistry, MongoPartnerRegistry, type PartnerRecord } from "../src/partners/registry";
import type { Destination } from "../src/schemas/intent.schema";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    source: { type: "string", default: "site" }, // site | partners | guides | official | all
    market: { type: "string" },
    partner: { type: "string" }, // comma-separated registry slugs
    country: { type: "string" }, // destination slug, partners only
    max: { type: "string" },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    concurrency: { type: "string" },
    "no-sitemap": { type: "boolean", default: false },
    "host-parallelism": { type: "string" },
    "deadline-minutes": { type: "string" },
    sweep: { type: "boolean", default: false },
    "from-requests": { type: "boolean", default: false },
    "run-kind": { type: "string", default: "manual" }, // manual | cron | api
    "no-extract-programs": { type: "boolean", default: false },
  },
});

const env = loadEnv();
setLogLevel(env.LOG_LEVEL);
const db = getDb(env);
const collections = getCollections(db);
await ensureIndexes(db, env).catch((err) => logger.warn("ensureIndexes failed (continuing)", { err }));

const registry = new MongoPartnerRegistry(collections.kbPartners);
const partners = await ensurePartnerRegistry(registry, { log: (m, meta) => logger.info(m, meta) });
const embeddings = new GeminiEmbeddings({ apiKey: env.GOOGLE_API_KEY, model: env.GEMINI_EMBEDDING_MODEL, dimensions: env.EMBEDDING_DIMENSIONS });

const deadline = values["deadline-minutes"] ? Date.now() + Number(values["deadline-minutes"]) * 60_000 : undefined;
const hostParallelism = Number(values["host-parallelism"] ?? env.INGEST_HOST_PARALLELISM);
const trigger = (values["run-kind"] === "cron" || values["run-kind"] === "api" ? values["run-kind"] : "manual") as KbIngestRunDoc["trigger"];
const extractEnabled = env.PROGRAM_EXTRACTION_ENABLED && !values["no-extract-programs"] && !values["dry-run"];
const gemini = new GeminiGenerate({ apiKey: env.GOOGLE_API_KEY });
const partnerName = new Map(partners.map((p) => [p.slug, p.name]));
let programsExtracted = 0;

function depsFor(runId: string, partner: boolean): IngestDeps {
  const deps: IngestDeps = {
    collections,
    embeddings,
    force: values.force,
    dryRun: values["dry-run"],
    runId,
    crawlOptions: {
      userAgent: env.CRAWL_USER_AGENT,
      concurrency: Number(values.concurrency ?? (partner ? 2 : env.CRAWL_CONCURRENCY)),
      delayMs: partner ? env.CRAWL_PARTNER_DELAY_MS : env.CRAWL_DELAY_MS,
      hardLimit: values.max ? Number(values.max) : undefined,
      useSitemaps: partner && !values["no-sitemap"],
      deadline,
    },
  };
  if (extractEnabled && partner) {
    // Course pages → structured program records (kb_programs) + a text copy in kb_chunks.
    deps.onPageIndexed = async (page, ctx) => {
      const university = (ctx.source.partnerSlug && partnerName.get(ctx.source.partnerSlug)) || page.title.split(/[|–-]/).pop()?.trim() || ctx.source.name;
      const records = await extractPrograms(page, { source: ctx.source, contentHash: ctx.contentHash, university }, { gen: gemini, model: env.GEMINI_EXTRACT_MODEL, fallbackModel: env.GEMINI_MODEL });
      const r = await storePrograms(records, { sourceUrl: page.url, contentHash: ctx.contentHash, source: ctx.source }, { collections, ingest: { ...deps, onPageIndexed: undefined } });
      programsExtracted += r.stored;
      if (r.stored || r.removed) logger.info("program records updated", { url: page.url, stored: r.stored, removed: r.removed });
    };
  }
  return deps;
}

/** Crawl one source, optionally sweep its orphans, and record the outcome on the run. */
async function runSource(source: CrawlSource, run: IngestRunLog, partner: boolean, sweep: boolean): Promise<IngestStats | null> {
  const started = performance.now();
  const entry: IngestRunSource = { name: source.name, partnerSlug: source.partnerSlug ?? null, stats: null, sweepDeleted: null, truncated: false, error: null, ms: 0 };
  try {
    const stats = await ingestSource(source, depsFor(run.id, partner));
    entry.stats = stats;
    entry.truncated = stats.crawl.truncated;
    if (sweep && !values["dry-run"]) {
      const previous = await previousCompleteRun(collections.kbIngestRuns, source.name);
      const decision = shouldSweep(stats.pagesSeen, previous?.stats?.pagesSeen ?? null, stats.crawl.truncated);
      if (decision.ok) entry.sweepDeleted = await sweepOrphans(source.name, run.id, collections);
      else logger.warn("orphan sweep skipped", { source: source.name, reason: decision.reason });
    }
    return stats;
  } catch (err) {
    entry.error = (err as Error).message.slice(0, 500);
    logger.error("source ingest failed", { source: source.name, err: entry.error });
    return null;
  } finally {
    entry.ms = Math.round(performance.now() - started);
    await run.finishSource(entry);
  }
}

/** Run partner sources through a pool of N hosts at a time. */
async function runPartnerSources(sources: CrawlSource[], run: IngestRunLog, sweep: boolean) {
  const queue = [...sources];
  await Promise.all(
    Array.from({ length: Math.max(1, hostParallelism) }, async () => {
      while (queue.length) {
        if (deadline && Date.now() > deadline) {
          logger.warn("deadline reached; remaining partner sources deferred to the next run", { remaining: queue.length });
          queue.length = 0;
          break;
        }
        await runSource(queue.shift()!, run, true, sweep);
      }
    }),
  );
}

function selectPartners(all: PartnerRecord[], opts: { slugs?: string[]; country?: string }): CrawlSource[] {
  const slugs = opts.slugs?.length ? new Set(opts.slugs) : null;
  const selected = all.filter((p) => (!slugs || slugs.has(p.slug)) && (!opts.country || p.country === (opts.country as Destination)));
  return partnerSources(selected, { maxPages: env.PARTNER_DEFAULT_MAX_PAGES });
}

/** Sync the curated guides (idempotent; deletes only `guide:` chunks of removed sections or files). */
async function runGuides(run: IngestRunLog) {
  const started = performance.now();
  const entry: IngestRunSource = { name: "guides", partnerSlug: null, stats: null, sweepDeleted: null, truncated: false, error: null, ms: 0 };
  try {
    const result = await ingestGuides(await loadGuideFiles(), { collections, embeddings, dryRun: values["dry-run"], force: values.force, runId: run.id });
    entry.stats = guideIngestStats(result);
    entry.sweepDeleted = result.orphansDeleted;
    logger.info("guides synced", { guides: result.guides, embedded: result.chunksWritten, retagged: result.chunksRetagged, unchanged: result.chunksUnchanged, deleted: result.chunksDeleted, orphans: result.orphansDeleted });
  } catch (err) {
    entry.error = (err as Error).message.slice(0, 500);
    logger.error("guide ingest failed", { err: entry.error });
  } finally {
    entry.ms = Math.round(performance.now() - started);
    await run.finishSource(entry);
  }
}

/** Re-fetch the official pages; changed and failed pages are recorded on the run. */
async function runOfficial(run: IngestRunLog, sweep: boolean) {
  const started = performance.now();
  const entry: IngestRunSource = { name: "official", partnerSlug: null, stats: null, sweepDeleted: null, truncated: false, error: null, ms: 0 };
  try {
    const { pages, errors } = await loadOfficialPages();
    if (errors.length) logger.warn("data/official-pages.json has invalid entries (skipped)", { errors: errors.slice(0, 20), count: errors.length });
    const result = await ingestOfficialPages(pages, depsFor(run.id, false), {
      userAgent: env.OFFICIAL_USER_AGENT,
      delayMs: env.OFFICIAL_CRAWL_DELAY_MS,
      hostParallelism,
      deadline,
      sweep: sweep && !errors.length,
    });
    entry.stats = result.stats;
    entry.truncated = result.deferred > 0;
    entry.sweepDeleted = result.swept;
    entry.changed = result.changed;
    entry.failed = result.failed;
  } catch (err) {
    entry.error = (err as Error).message.slice(0, 500);
    logger.error("official ingest failed", { err: entry.error });
  } finally {
    entry.ms = Math.round(performance.now() - started);
    await run.finishSource(entry);
  }
}

async function runScope(which: string, run: IngestRunLog, opts: { market?: string; slugs?: string[]; country?: string; sweep: boolean }) {
  const whole = which === "all" && !opts.market && !opts.slugs?.length && !opts.country;
  if (which === "guides" || whole) await runGuides(run);
  if (which === "official" || (whole && env.OFFICIAL_INGEST_ENABLED)) await runOfficial(run, opts.sweep || which === "official");
  if (which === "site" || which === "all") {
    const sources = siteSources().filter((s) => !opts.market || s.market === opts.market);
    for (const source of sources) await runSource(source, run, false, opts.sweep && !opts.market);
    if (!opts.market || opts.market === "nepal") {
      const partnerStats = await indexPartnerList(depsFor(run.id, false), partners).catch((err) => {
        logger.warn("partner list indexing failed", { err: (err as Error).message });
        return null;
      });
      if (partnerStats) logger.info("partner list indexed", partnerStats as unknown as Record<string, unknown>);
    }
  }
  if (which === "partners" || which === "all") {
    const sources = selectPartners(partners, opts);
    logger.info("partner sources", { count: sources.length, ofRegistry: partners.length, hostParallelism });
    await runPartnerSources(sources, run, opts.sweep);
  }
}

const started = Date.now();

if (values["from-requests"]) {
  // Drain queued reindex requests (POST /v1/knowledge/reindex), oldest first, until the deadline.
  const c: Collections = collections;
  let handled = 0;
  for (;;) {
    if (deadline && Date.now() > deadline) break;
    const req = await c.kbIngestRequests.findOneAndUpdate({ status: "queued" }, { $set: { status: "running", startedAt: new Date() } }, { sort: { createdAt: 1 }, returnDocument: "after" });
    if (!req) break;
    const run = await IngestRunLog.start(c.kbIngestRuns, { kind: "requests", trigger, args: { scope: req.scope, force: req.force, requestedBy: req.requestedBy }, release: env.APP_RELEASE });
    await c.kbIngestRequests.updateOne({ _id: req._id }, { $set: { runId: run.id } });
    try {
      values.force = req.force;
      if (req.scope === "all" || req.scope === "site" || req.scope === "partners" || req.scope === "guides" || req.scope === "official") await runScope(req.scope, run, { sweep: false });
      else if (req.scope.startsWith("partner:")) await runScope("partners", run, { slugs: [req.scope.slice("partner:".length)], sweep: true });
      else if (req.scope.startsWith("upload:")) logger.info("upload reindex requests are handled by the API process; nothing to do", { scope: req.scope });
      else throw new Error(`unknown scope ${req.scope}`);
      await run.finish();
      await c.kbIngestRequests.updateOne({ _id: req._id }, { $set: { status: "done", finishedAt: new Date() } });
    } catch (err) {
      await run.finish(err);
      await c.kbIngestRequests.updateOne({ _id: req._id }, { $set: { status: "failed", finishedAt: new Date(), error: (err as Error).message.slice(0, 500) } });
    }
    handled++;
  }
  logger.info("reindex requests drained", { handled, seconds: Math.round((Date.now() - started) / 1000) });
} else {
  const which = values.source ?? "site";
  const run = await IngestRunLog.start(collections.kbIngestRuns, {
    kind: which === "all" ? "all" : which === "partners" ? "partners" : which === "guides" ? "guides" : which === "official" ? "official" : "site",
    trigger,
    args: { market: values.market ?? null, partner: values.partner ?? null, country: values.country ?? null, max: values.max ?? null, force: values.force, dryRun: values["dry-run"], sweep: values.sweep, sitemaps: !values["no-sitemap"], deadlineMinutes: values["deadline-minutes"] ?? null },
    release: env.APP_RELEASE,
  });
  try {
    await runScope(which, run, { market: values.market, slugs: values.partner?.split(",").map((s) => s.trim()).filter(Boolean), country: values.country, sweep: values.sweep });
    const doc = await run.finish();
    logger.info("ingest complete", { runId: doc._id, status: doc.status, ...doc.totals, programsExtracted, sources: doc.sources.length, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (err) {
    await run.finish(err);
    logger.error("ingest failed", { err: (err as Error).message });
    process.exitCode = 1;
  }
}

await closeMongo();
