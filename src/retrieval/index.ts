import type { Embeddings } from "@langchain/core/embeddings";
import type { Db } from "mongodb";
import type { Env } from "../config/env";
import { getCollections, searchIndexStatus } from "../db/mongo";
import { logger } from "../observability/logger";
import { InAppKnowledgeStore } from "./inapp";
import { MongoKnowledgeStore } from "./mongo";
import type { KnowledgeStore } from "./store";

export type ResolvedSearchMode = "atlas" | "inapp";

/**
 * Pick the retrieval implementation. "auto" uses Atlas Vector Search when the
 * search indexes exist and are queryable, otherwise the in-app store, which
 * works on any MongoDB (including a Bitnami standalone).
 */
export async function createKnowledgeStore(
  env: Env,
  db: Db,
  embeddings: Embeddings,
): Promise<{ store: KnowledgeStore; mode: ResolvedSearchMode }> {
  const c = getCollections(db);
  let mode: ResolvedSearchMode = env.KB_SEARCH_MODE === "atlas" ? "atlas" : "inapp";

  if (env.KB_SEARCH_MODE === "auto") {
    const status = await searchIndexStatus(db);
    const vectorReady = status[env.MONGODB_VECTOR_INDEX] === "READY";
    mode = vectorReady ? "atlas" : "inapp";
    logger.info("knowledge search mode resolved", { mode, searchIndexes: status });
  }

  if (mode === "atlas") {
    return {
      store: new MongoKnowledgeStore(c, embeddings, {
        vectorIndex: env.MONGODB_VECTOR_INDEX,
        textIndex: env.MONGODB_TEXT_INDEX,
      }),
      mode,
    };
  }
  const store = new InAppKnowledgeStore(c, embeddings, { refreshSeconds: env.KB_CACHE_REFRESH_SECONDS });
  await store.warm().catch((err) => logger.warn("knowledge cache warm-up failed; will retry lazily", { err }));
  return { store, mode };
}

export type { KnowledgeStore, RetrievedChunk, SearchQuery } from "./store";
