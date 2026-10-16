import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import type { Env } from "../config/env";
import { logger } from "../observability/logger";
import type { KbDocumentDoc } from "../documents/service";
import { STUDENT_DOCUMENT_INDEXES, STUDENT_DOCUMENTS_COLLECTION } from "../documents/student/store";
import type { StudentDocumentRecord } from "../documents/student/types";
import type { GuideState } from "../journey/guide";
import type { ProgramRecord } from "../ingest/programs";
import type { KbIngestRequestDoc, KbIngestRunDoc } from "../ingest/runs";
import type { EmbeddingCacheDoc } from "../llm/embedding-cache";
import type { PartnerDoc } from "../partners/registry";
import type { Source } from "../retrieval/format";
import { sourceKindOf, type SourceKind } from "../retrieval/store";
import type { EvidenceKind } from "../tools/types";
import type { Intent } from "../schemas/intent.schema";

// ---------------------------------------------------------------------------
// Document shapes
// ---------------------------------------------------------------------------
export interface KbChunkDoc {
  _id: string; // sha256(url#chunkIndex)
  source: string; // experteducation.com | partner:<slug> | upload:<slug> | kb_programs
  /** Provenance class used for per-kind retrieval quotas and filters. */
  sourceKind?: SourceKind;
  url: string;
  title: string;
  section: string;
  docType: string;
  country: string | null;
  chunkIndex: number;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  updatedAt: Date;
}

export interface KbPageDoc {
  _id: string; // url
  source: string;
  sourceKind?: SourceKind;
  partnerSlug?: string | null;
  country?: string | null;
  title: string;
  contentHash: string;
  chunkCount: number;
  httpStatus: number | null;
  lastCrawled: Date;
  lastChanged: Date;
  /**
   * When an already-indexed page's text last changed (null until it first does). Unlike
   * `lastChanged`, a first index or a forced re-embed never sets it, so it marks a real edit
   * of the source page (official pages: a rule or figure that may have moved).
   */
  contentChangedAt?: Date | null;
  /** Sitemap lastmod, when the page came from a sitemap. */
  lastmod?: Date | null;
  /** Ingest run that last saw this page (orphan sweep compares against the current run). */
  runId?: string | null;
  /** Course-page detection result (drives structured program extraction). */
  pageKind?: "course" | "page";
  /** contentHash at the time program records were last extracted for this page. */
  programsHash?: string | null;
  /** For synthetic pages derived from another page (program records): the page they came from. */
  parentUrl?: string | null;
}

export interface ChatSessionDoc {
  _id: string; // uuid
  ownerId: string;
  title: string | null;
  /** Set when the owner renamed the session; the automatic first-message title then skips it. */
  titleSetByUser?: boolean;
  pinned?: boolean;
  metadata: Record<string, unknown>;
  /** Guided sessions only: CRM contact id and journey progress. Student facts stay in the CRM. */
  guide?: GuideState;
  messageCount: number;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
}

export interface ChatMessageDoc {
  sessionId: string;
  role: "human" | "ai" | "system";
  content: string;
  intent: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}

export interface FeedbackDoc {
  sessionId: string | null;
  traceId: string | null;
  requestId: string | null;
  score: number;
  comment: string | null;
  createdAt: Date;
}

export interface UserProfileDoc {
  _id: string; // ownerId (email for signed-in users)
  profile: Record<string, unknown>;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Activity log (durable, no TTL by default) — the fine-tuning corpus.
// ---------------------------------------------------------------------------
export type AuthMode = "api_key" | "session" | "none";

/** One model call observed during a turn (classifier, research round or answer, incl. fallbacks). */
export interface LlmCall {
  runId: string;
  role: "answer" | "classifier" | "research";
  model: string | null;
  provider: string | null;
  ok: boolean | null;
  error?: string;
  ms: number | null;
  /** Prompt tokens, cached ones included (OpenAI-compatible `prompt_tokens`). */
  inputTokens?: number;
  /** Completion tokens, reasoning included. */
  outputTokens?: number;
  totalTokens?: number;
  /** Part of `inputTokens` served from the provider's prompt cache (absent on rows written before it was recorded). */
  cachedInputTokens?: number;
  /** Part of `outputTokens` spent reasoning. */
  reasoningTokens?: number;
  /** USD for this call: the provider's figure (OpenRouter `usage.cost`) or an estimate from src/observability/pricing.ts. */
  costUsd?: number;
  costSource?: "provider" | "estimate";
  finishReason?: string;
}

export interface LlmSummary {
  answerModel: string | null;
  classifierModel: string | null;
  researchModel: string | null;
  researchCalls: number;
  usedFallback: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Sums over `calls`; optional because turns recorded before they existed lack them. */
  cachedInputTokens?: number;
  reasoningTokens?: number;
  /** Turn cost in USD: every call's `costUsd` plus the Jev classifier's; null when nothing reported a cost. */
  costUsd?: number | null;
  /** The Jev classifier's cost (it calls its own API, so it is not among `calls`); null when Jev did not run or reported none. */
  jevCostUsd?: number | null;
  /** Successful calls with no cost (a model without a price), so `costUsd` is a lower bound when this is above 0. */
  uncostedCalls?: number;
  calls: LlmCall[];
}

export interface PromptRef {
  name: string | null;
  source: "langfuse" | "local" | null;
  version: number | null;
  templateHash: string | null;
}

export interface TurnFeedback {
  score: number;
  comment: string | null;
  traceId: string | null;
  at: Date;
}

export interface TurnChunk {
  id: string;
  url: string;
  /** Navigable page, when `url` is a synthetic lookup key (CRM records). */
  webUrl?: string | null;
  title: string;
  section: string;
  docType: string;
  country: string | null;
  source: string;
  score: number;
  matchedBy: string[];
  /** Chunk text as retrieved (capped). */
  content: string;
  /** Evidence provenance (absent on rows written before research was added). */
  kind?: EvidenceKind;
  live?: boolean;
}

/** What the research loop did during a turn (tool calls, live URLs, budget). */
export interface TurnResearch {
  rounds: number;
  budgetExceeded: boolean;
  toolCalls: { tool: string; args: Record<string, unknown>; ms: number; ok: boolean; added: number; error?: string; urls?: string[] }[];
  liveUrls: string[];
  notes: string | null;
  error?: string | null;
}

/** Cached live lookup (web search / fetched page). TTL index on `expiresAt`. */
export interface LiveCacheDoc {
  _id: string;
  kind: string;
  key: string;
  value: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export interface ChatTurnDoc {
  requestId: string;
  traceId: string | null;
  sessionId: string;
  /** 0-based position of this turn in the session. */
  turnIndex: number;
  ownerId: string;
  /** Stable pseudonymous id (HMAC/sha256 of ownerId); the only identity exported. */
  userHash: string;
  auth: AuthMode;
  route: string;
  streamed: boolean;
  mode: string | null;
  release: string | null;
  clientMetadata: Record<string, unknown> | null;
  /** Profile actually rendered into the prompt. */
  profile: Record<string, unknown> | null;
  /** Windowed history the model saw (inline: chat_messages expire). */
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  inputTruncated: boolean;
  intent: Intent | null;
  intentFallback: boolean;
  chunks: TurnChunk[];
  contextChunkCount: number;
  research: TurnResearch | null;
  sources: Source[];
  answer: string;
  refused: boolean;
  disclaimer: string | null;
  answerIsFallback: boolean;
  outcome: "ok" | "refused" | "aborted" | "error";
  error: { name: string; message: string } | null;
  stream: { tokens: number; firstTokenMs: number | null; partialAnswer: string | null; clientAborted: boolean } | null;
  llm: LlmSummary;
  prompt: {
    /** Exact compiled system prompt the answer model received. */
    systemPromptText: string | null;
    systemPromptHash: string | null;
    systemPromptChars: number | null;
    system: PromptRef;
    playbook: PromptRef;
    classifier: PromptRef;
  };
  timings: { classifyMs: number | null; retrieveMs: number | null; researchMs?: number | null; generateMs: number | null; totalMs: number };
  /** Remaining graph diagnostics not lifted into typed fields. */
  meta: Record<string, unknown>;
  feedback: TurnFeedback[];
  feedbackScore: number | null;
  createdAt: Date;
}

export interface ActivityEventDoc {
  /** e.g. chat.request, auth.login, profile.update, http.rate_limited, ui.page_view */
  type: string;
  source: "server" | "client";
  /** When the event happened (client-supplied for ui.* events, clamped). */
  at: Date;
  /** When the server recorded it. */
  createdAt: Date;
  requestId: string | null;
  sessionId: string | null;
  ownerId: string | null;
  userHash: string | null;
  auth: AuthMode | null;
  method: string | null;
  /** Path with the id parameter normalised to ":id". */
  route: string | null;
  path: string | null;
  status: number | null;
  ms: number | null;
  errorCode: string | null;
  ip: string | null;
  userAgent: string | null;
  release: string | null;
  details: Record<string, unknown>;
}

export interface Collections {
  kbChunks: Collection<KbChunkDoc>;
  kbPages: Collection<KbPageDoc>;
  chatSessions: Collection<ChatSessionDoc>;
  chatMessages: Collection<ChatMessageDoc>;
  feedback: Collection<FeedbackDoc>;
  profiles: Collection<UserProfileDoc>;
  chatTurns: Collection<ChatTurnDoc>;
  activityEvents: Collection<ActivityEventDoc>;
  liveCache: Collection<LiveCacheDoc>;
  kbPartners: Collection<PartnerDoc>;
  kbIngestRuns: Collection<KbIngestRunDoc>;
  kbIngestRequests: Collection<KbIngestRequestDoc>;
  kbPrograms: Collection<ProgramRecord>;
  kbDocuments: Collection<KbDocumentDoc>;
  embeddingCache: Collection<EmbeddingCacheDoc>;
  /** Student identity documents attached in chat; encrypted bytes in GridFS `student_files`. Never deleted. */
  studentDocuments: Collection<StudentDocumentRecord>;
}

export const COLLECTION_NAMES = {
  kbChunks: "kb_chunks",
  kbPages: "kb_pages",
  chatSessions: "chat_sessions",
  chatMessages: "chat_messages",
  feedback: "chat_feedback",
  profiles: "user_profiles",
  chatTurns: "chat_turns",
  activityEvents: "activity_events",
  liveCache: "live_cache",
  kbPartners: "kb_partners",
  kbIngestRuns: "kb_ingest_runs",
  kbIngestRequests: "kb_ingest_requests",
  kbPrograms: "kb_programs",
  kbDocuments: "kb_documents",
  embeddingCache: "embedding_cache",
  studentDocuments: STUDENT_DOCUMENTS_COLLECTION,
} as const;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
let client: MongoClient | null = null;

export function getMongoClient(env: Env): MongoClient {
  client ??= new MongoClient(env.MONGODB_URI, {
    appName: "expert-ai-consultant",
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    retryReads: true,
    retryWrites: true,
  });
  return client;
}

export function getDb(env: Env): Db {
  return getMongoClient(env).db(env.MONGODB_DB);
}

export function getCollections(db: Db): Collections {
  return {
    kbChunks: db.collection<KbChunkDoc>(COLLECTION_NAMES.kbChunks),
    kbPages: db.collection<KbPageDoc>(COLLECTION_NAMES.kbPages),
    chatSessions: db.collection<ChatSessionDoc>(COLLECTION_NAMES.chatSessions),
    chatMessages: db.collection<ChatMessageDoc>(COLLECTION_NAMES.chatMessages),
    feedback: db.collection<FeedbackDoc>(COLLECTION_NAMES.feedback),
    profiles: db.collection<UserProfileDoc>(COLLECTION_NAMES.profiles),
    chatTurns: db.collection<ChatTurnDoc>(COLLECTION_NAMES.chatTurns),
    activityEvents: db.collection<ActivityEventDoc>(COLLECTION_NAMES.activityEvents),
    liveCache: db.collection<LiveCacheDoc>(COLLECTION_NAMES.liveCache),
    kbPartners: db.collection<PartnerDoc>(COLLECTION_NAMES.kbPartners),
    kbIngestRuns: db.collection<KbIngestRunDoc>(COLLECTION_NAMES.kbIngestRuns),
    kbIngestRequests: db.collection<KbIngestRequestDoc>(COLLECTION_NAMES.kbIngestRequests),
    kbPrograms: db.collection<ProgramRecord>(COLLECTION_NAMES.kbPrograms),
    kbDocuments: db.collection<KbDocumentDoc>(COLLECTION_NAMES.kbDocuments),
    embeddingCache: db.collection<EmbeddingCacheDoc>(COLLECTION_NAMES.embeddingCache),
    studentDocuments: db.collection<StudentDocumentRecord>(COLLECTION_NAMES.studentDocuments),
  };
}

export async function closeMongo() {
  await client?.close();
  client = null;
}

export async function pingMongo(db: Db): Promise<boolean> {
  try {
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Index management (regular + Atlas Search / Vector Search)
// ---------------------------------------------------------------------------
export function vectorIndexDefinition(dimensions: number) {
  return {
    fields: [
      { type: "vector", path: "embedding", numDimensions: dimensions, similarity: "cosine" },
      { type: "filter", path: "country" },
      { type: "filter", path: "docType" },
      { type: "filter", path: "source" },
      { type: "filter", path: "sourceKind" },
    ],
  };
}

export const textIndexDefinition = {
  mappings: {
    dynamic: false,
    fields: {
      title: { type: "string", analyzer: "lucene.standard" },
      section: { type: "string", analyzer: "lucene.standard" },
      content: { type: "string", analyzer: "lucene.standard" },
      country: { type: "token" },
      docType: { type: "token" },
      source: { type: "token" },
      sourceKind: { type: "token" },
    },
  },
};

/** True when an existing Atlas index definition already covers the `sourceKind` filter field. */
export function searchIndexHasSourceKind(latestDefinition: Document | undefined): boolean {
  if (!latestDefinition) return false;
  const fields = latestDefinition.fields as { path?: string }[] | undefined;
  if (Array.isArray(fields)) return fields.some((f) => f.path === "sourceKind");
  const mapped = (latestDefinition.mappings as { fields?: Record<string, unknown> } | undefined)?.fields;
  return Boolean(mapped && "sourceKind" in mapped);
}

/** Backfill `sourceKind` on chunks indexed before the field existed. Idempotent; cheap when nothing is missing. */
export async function backfillSourceKinds(c: Pick<Collections, "kbChunks">): Promise<number> {
  let updated = 0;
  const missing = await c.kbChunks.distinct("source", { sourceKind: { $exists: false } });
  for (const source of missing) {
    const r = await c.kbChunks.updateMany({ source, sourceKind: { $exists: false }, docType: { $ne: "program" } }, { $set: { sourceKind: sourceKindOf(source) } });
    updated += r.modifiedCount;
  }
  const programs = await c.kbChunks.updateMany({ sourceKind: { $exists: false }, docType: "program" }, { $set: { sourceKind: "program" } });
  return updated + programs.modifiedCount;
}

/**
 * Create regular indexes (idempotent) and the two Atlas search indexes if they
 * do not exist yet. Search indexes build asynchronously; `searchIndexStatus`
 * reports when they are queryable.
 */
export async function ensureIndexes(db: Db, env: Env) {
  const c = getCollections(db);
  await Promise.all([
    c.kbChunks.createIndexes([
      { key: { url: 1 } },
      { key: { source: 1 } },
      { key: { sourceKind: 1 } },
      { key: { country: 1 } },
      { key: { contentHash: 1 } },
      // Standard $text index: lexical search for plain (non-Atlas) MongoDB deployments.
      {
        key: { title: "text", section: "text", content: "text" },
        name: "kb_text_standard",
        weights: { title: 10, section: 5, content: 1 },
        default_language: "english",
      },
    ]),
    c.kbPages.createIndexes([{ key: { source: 1 } }, { key: { lastCrawled: 1 } }, { key: { source: 1, runId: 1 } }, { key: { pageKind: 1, programsHash: 1 } }]),
    c.chatSessions.createIndexes([
      { key: { ownerId: 1, lastActiveAt: -1 } },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ]),
    c.chatMessages.createIndexes([{ key: { sessionId: 1, _id: -1 } }, { key: { expiresAt: 1 }, expireAfterSeconds: 0 }]),
    c.feedback.createIndexes([{ key: { traceId: 1 } }, { key: { requestId: 1 } }, { key: { createdAt: -1 } }]),
    c.chatTurns.createIndexes([
      { key: { requestId: 1 } },
      { key: { createdAt: -1 } },
      { key: { sessionId: 1, createdAt: 1 } },
      { key: { userHash: 1, createdAt: -1 } },
      { key: { "intent.primary_intent": 1, createdAt: -1 } },
      { key: { feedbackScore: 1, createdAt: -1 } },
    ]),
    c.activityEvents.createIndexes([
      { key: { at: -1 } },
      { key: { type: 1, at: -1 } },
      { key: { userHash: 1, at: -1 } },
      { key: { requestId: 1 } },
      { key: { sessionId: 1, at: 1 } },
    ]),
    c.liveCache.createIndexes([{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }, { key: { kind: 1, createdAt: -1 } }]),
    c.kbPartners.createIndexes([{ key: { country: 1, enabled: 1 } }, { key: { domains: 1 } }, { key: { name: 1 } }]),
    c.kbIngestRuns.createIndexes([{ key: { startedAt: -1 } }, { key: { status: 1, startedAt: -1 } }, { key: { "sources.name": 1, startedAt: -1 } }, { key: { finishedAt: -1 } }]),
    c.kbIngestRequests.createIndexes([{ key: { status: 1, createdAt: 1 } }, { key: { createdAt: -1 } }]),
    c.kbPrograms.createIndexes([
      { key: { universitySlug: 1, level: 1 } },
      { key: { country: 1, level: 1 } },
      { key: { sourceUrl: 1 } },
      { key: { disciplineTags: 1 } },
      { key: { "tuition.amount": 1 } },
      { key: { "codes.cricos": 1 } },
      { key: { programName: "text", discipline: "text", university: "text", "entryRequirements.text": "text" }, name: "kb_programs_text", weights: { programName: 10, university: 5, discipline: 5, "entryRequirements.text": 1 } },
    ]),
    c.kbDocuments.createIndexes([{ key: { ownerId: 1, createdAt: -1 } }, { key: { sha256: 1 } }, { key: { status: 1, updatedAt: 1 } }, { key: { partnerSlug: 1 } }, { key: { slug: 1 } }]),
    c.embeddingCache.createIndexes([{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }]),
    // No TTL on purpose: student documents are history and are never deleted automatically.
    c.studentDocuments.createIndexes(STUDENT_DOCUMENT_INDEXES),
  ]);
  await ensureActivityRetention(c, env.ACTIVITY_RETENTION_DAYS);
  // Chunks indexed before `sourceKind` existed would be invisible to quota-filtered searches; stamp them (cheap when none are missing).
  const backfilled = await backfillSourceKinds(c).catch((err) => {
    logger.warn("sourceKind backfill failed (continuing)", { err: (err as Error).message });
    return 0;
  });
  if (backfilled) logger.info("backfilled sourceKind on existing chunks", { chunks: backfilled });

  const existing = new Map<string, Document | undefined>();
  try {
    for await (const idx of c.kbChunks.listSearchIndexes()) {
      const i = idx as { name: string; latestDefinition?: Document };
      existing.set(i.name, i.latestDefinition);
    }
  } catch (err) {
    logger.warn("listSearchIndexes unsupported on this deployment; skipping search index creation", { err });
    return { searchIndexes: "unsupported" as const };
  }
  const toCreate: Document[] = [];
  const updated: string[] = [];
  const vectorDef = vectorIndexDefinition(env.EMBEDDING_DIMENSIONS);
  if (!existing.has(env.MONGODB_VECTOR_INDEX)) {
    toCreate.push({ name: env.MONGODB_VECTOR_INDEX, type: "vectorSearch", definition: vectorDef });
  } else if (!searchIndexHasSourceKind(existing.get(env.MONGODB_VECTOR_INDEX))) {
    // Adding a filter field triggers an Atlas rebuild; the old index keeps serving until the new build is READY.
    await c.kbChunks.updateSearchIndex(env.MONGODB_VECTOR_INDEX, vectorDef);
    updated.push(env.MONGODB_VECTOR_INDEX);
  }
  if (!existing.has(env.MONGODB_TEXT_INDEX)) {
    toCreate.push({ name: env.MONGODB_TEXT_INDEX, type: "search", definition: textIndexDefinition });
  } else if (!searchIndexHasSourceKind(existing.get(env.MONGODB_TEXT_INDEX))) {
    await c.kbChunks.updateSearchIndex(env.MONGODB_TEXT_INDEX, textIndexDefinition);
    updated.push(env.MONGODB_TEXT_INDEX);
  }
  if (toCreate.length) {
    await c.kbChunks.createSearchIndexes(toCreate as never);
    logger.info("created Atlas search indexes", { names: toCreate.map((d) => d.name) });
  }
  if (updated.length) logger.info("updated Atlas search indexes to include sourceKind (rebuilding)", { names: updated });
  return { searchIndexes: "ok" as const, created: toCreate.map((d) => d.name as string), updated };
}

const ACTIVITY_TTL_INDEX = "activity_ttl";

/**
 * Optional retention for the activity log. `days` = 0 keeps everything forever
 * (drops a previously created TTL index); `days` > 0 creates/updates a TTL index
 * on `createdAt` for both collections. Idempotent.
 */
export async function ensureActivityRetention(c: Pick<Collections, "chatTurns" | "activityEvents">, days: number) {
  for (const col of [c.chatTurns, c.activityEvents] as unknown as Collection<Document>[]) {
    if (days <= 0) {
      await col.dropIndex(ACTIVITY_TTL_INDEX).catch((err: { codeName?: string; code?: number }) => {
        // 27 IndexNotFound, 26 NamespaceNotFound: nothing to drop.
        if (err.code !== 27 && err.code !== 26) throw err;
      });
      continue;
    }
    const spec = { key: { createdAt: 1 } as Document, name: ACTIVITY_TTL_INDEX, expireAfterSeconds: days * 86_400 };
    try {
      await col.createIndexes([spec]);
    } catch (err) {
      // 85 IndexOptionsConflict: retention changed → recreate with the new TTL.
      if ((err as { code?: number }).code !== 85) throw err;
      await col.dropIndex(ACTIVITY_TTL_INDEX);
      await col.createIndexes([spec]);
    }
  }
}

export async function searchIndexStatus(db: Db): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    for await (const idx of getCollections(db).kbChunks.listSearchIndexes()) {
      const i = idx as { name: string; status?: string; queryable?: boolean };
      out[i.name] = i.queryable ? "READY" : (i.status ?? "UNKNOWN");
    }
  } catch {
    out["error"] = "listSearchIndexes unsupported";
  }
  return out;
}
