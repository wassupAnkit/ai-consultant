/**
 * One-time / idempotent database setup: regular indexes, TTL indexes and the
 * Atlas Vector Search + Atlas Search indexes on the knowledge-base collection.
 *
 *   bun run db:setup
 */
import { loadEnv } from "../src/config/env";
import { backfillSourceKinds, closeMongo, ensureIndexes, getCollections, getDb, pingMongo, searchIndexStatus } from "../src/db/mongo";
import { logger } from "../src/observability/logger";

const env = loadEnv();
const db = getDb(env);
if (!(await pingMongo(db))) {
  logger.error("cannot reach MongoDB", { uri: env.MONGODB_URI.replace(/\/\/.*@/, "//***@") });
  process.exit(1);
}
const result = await ensureIndexes(db, env);
const backfilled = await backfillSourceKinds(getCollections(db));
if (backfilled) logger.info("backfilled sourceKind on existing chunks", { chunks: backfilled });
const status = await searchIndexStatus(db);
logger.info("database ready", { db: env.MONGODB_DB, ...result, searchIndexStatus: status });
if (result.searchIndexes === "unsupported") {
  logger.warn("This MongoDB has no Atlas Search; the server will run with KB_SEARCH_MODE=inapp (in-process vector search + $text).");
} else if (Object.values(status).some((s) => s !== "READY")) {
  logger.info("Atlas search indexes are still building; /readyz will report knowledgeBase.mode once they are queryable.");
}
await closeMongo();
