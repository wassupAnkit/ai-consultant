/**
 * Index Expert's curated guides into the knowledge base (src/ingest/guides.ts): the source-market
 * guides (data/markets), compliance guides (data/compliance), destination facts registers
 * (data/facts) and the counsellor job map (data/counsellor), as `source: guide:<kind>/<slug>`.
 * Idempotent: unchanged chunks are not re-embedded, removed sections and guides are deleted
 * (only `guide:` sources are touched). The nightly CronJob runs the same sync as part of
 * `scripts/ingest.ts --source all`; this is the standalone entry point.
 *
 *   bun run ingest:guides                      # sync every guide
 *   bun run ingest:guides -- --dry-run         # print the plan against the live store; no writes, no embedding calls
 *   bun run ingest:guides -- --dry-run --no-db # plan as if the store were empty (needs no MongoDB)
 *   bun run ingest:guides -- --force           # re-embed every chunk
 *   bun run ingest:guides -- --data ./data     # read guides from another directory
 */
import { parseArgs } from "node:util";
import type { Embeddings } from "@langchain/core/embeddings";
import { loadEnv } from "../src/config/env";
import { closeMongo, ensureIndexes, getCollections, getDb } from "../src/db/mongo";
import { formatGuidePlan, guideChunkDocs, guideIngestStats, ingestGuides, loadGuideFiles, planGuideIngest, type GuideIngestResult } from "../src/ingest/guides";
import { IngestRunLog } from "../src/ingest/runs";
import { GeminiEmbeddings } from "../src/llm/embeddings";
import { logger, setLogLevel } from "../src/observability/logger";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
    "no-db": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    data: { type: "string" },
    "run-kind": { type: "string", default: "manual" },
  },
});

const files = await loadGuideFiles(values.data);
if (!files.length) {
  console.error(`No guide files found under ${values.data ?? "data/"}`);
  process.exit(1);
}

if (values["no-db"]) {
  if (!values["dry-run"]) {
    console.error("--no-db only plans; add --dry-run");
    process.exit(1);
  }
  const plan = planGuideIngest(await Promise.all(files.map(async (file) => ({ file, docs: await guideChunkDocs(file) }))), [], { force: values.force });
  const sum = (f: (g: (typeof plan.guides)[number]) => number) => plan.guides.reduce((n, g) => n + f(g), 0);
  const result: GuideIngestResult = { guides: plan.guides.length, chunksWritten: sum((g) => g.embed.length), chunksRetagged: 0, chunksUnchanged: 0, chunksDeleted: 0, embeddingCalls: 0, orphansDeleted: { pages: 0, chunks: 0 }, plan };
  console.log(formatGuidePlan(result));
  process.exit(0);
}

const env = loadEnv();
setLogLevel(env.LOG_LEVEL);
const db = getDb(env);
const collections = getCollections(db);
const dryRun = values["dry-run"];
if (!dryRun) await ensureIndexes(db, env).catch((err) => logger.warn("ensureIndexes failed (continuing)", { err }));
const embeddings: Embeddings = new GeminiEmbeddings({ apiKey: env.GOOGLE_API_KEY, model: env.GEMINI_EMBEDDING_MODEL, dimensions: env.EMBEDDING_DIMENSIONS });

const started = performance.now();
const run = dryRun ? null : await IngestRunLog.start(collections.kbIngestRuns, { kind: "guides", trigger: values["run-kind"] === "cron" ? "cron" : "manual", args: { force: values.force, data: values.data ?? null }, release: env.APP_RELEASE });
try {
  const result = await ingestGuides(files, { collections, embeddings, dryRun, force: values.force, runId: run?.id });
  console.log(formatGuidePlan(result));
  if (run) {
    await run.finishSource({ name: "guides", partnerSlug: null, stats: guideIngestStats(result), sweepDeleted: result.orphansDeleted, truncated: false, error: null, ms: Math.round(performance.now() - started) });
    await run.finish();
  }
} catch (err) {
  logger.error("guide ingest failed", { err: (err as Error).message });
  if (run) await run.finish(err);
  process.exitCode = 1;
}
await closeMongo();
