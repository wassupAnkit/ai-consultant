/**
 * Entry point: validate env → telemetry → MongoDB → knowledge store → graph → HTTP.
 * SIGTERM/SIGINT refuse new work, let in-flight answers finish (SHUTDOWN_DRAIN_MS, default
 * REQUEST_TIMEOUT_MS + 5 s), then flush activity and traces. The pod's
 * terminationGracePeriodSeconds must cover preStop sleep + drain + ~15 s flush.
 */
import { loadEnv, shutdownDrainMs, shutdownDrainWarning, timeoutBudgetWarning } from "./config/env";
import { PERSONA } from "./config/persona";
import { logger, setLogLevel } from "./observability/logger";
import { startTelemetry, shutdownTelemetry } from "./observability/otel";
import { getLangfuse, shutdownLangfuse } from "./observability/langfuse";
import { closeMongo, ensureIndexes, getCollections, getDb, pingMongo } from "./db/mongo";
import { GeminiEmbeddings } from "./llm/embeddings";
import { CachedEmbeddings } from "./llm/embedding-cache";
import { createChatModel } from "./llm/gemini";
import { createAnswerModels, createResearchModel, OpenRouterChatModel } from "./llm/providers";
import { createKnowledgeStore } from "./retrieval";
import { parseQuotas, QuotaKnowledgeStore } from "./retrieval/multipass";
import { CachedKnowledgeStore, kbVersionFromMongo } from "./retrieval/result-cache";
import { MongoChatStore } from "./memory/mongo";
import { createPromptRegistry } from "./prompts/registry";
import { createClassifier } from "./classify";
import { buildGraph } from "./graph";
import { ChatService } from "./app/service";
import { GeminiTurnExtras } from "./app/turn-extras";
import { createApp } from "./app";
import { createShutdown } from "./app/shutdown";
import { ActivityLog } from "./activity/log";
import { MongoActivityStore } from "./activity/mongo";
import { GeminiGenerate } from "./llm/generate";
import { MongoLiveCache } from "./live/cache";
import { fetchPageForAnswer } from "./live/fetch";
import { partnerDomainProvider } from "./live/partner-domains";
import { DomainPolicy, fetchAllowlist } from "./live/policy";
import { ensurePartnerRegistry, MongoPartnerRegistry } from "./partners/registry";
import { MongoProgramSearch } from "./ingest/programs";
import { MongoDocumentService } from "./documents/service";
import { GridFsFileStore } from "./documents/store";
import { createFileCipher } from "./documents/student/crypto";
import { DirectUploads } from "./documents/student/direct-upload";
import { s3UploadStore } from "./documents/student/s3-store";
import { StudentDocumentService } from "./documents/student/service";
import { fileIdFromUrl } from "./documents/student/signing";
import { MongoStudentDocumentStore, STUDENT_FILES_BUCKET } from "./documents/student/store";
import { webSearch } from "./live/search";
import { createCrmProvider } from "./crm/client";
import { ensureCrmWriteProposalIndexes, MongoCrmWriteProposalStore, CRM_WRITE_PROPOSALS_COLLECTION, type CrmWriteProposalDoc } from "./crm/approvals/mongo-store";
import { CrmWriteService } from "./crm/approvals/service";
import { CrmStudentReader } from "./crm/student";
import { CounsellorRegionReader } from "./crm/staff";
import { createDemoCrmProvider } from "./crm/demo";
import { createIntegrationRoutes, disabledIntegrationRoutes, type IntegrationRoutes } from "./app/integrations";
import { GOOGLE_CONNECTIONS_COLLECTION, MongoGoogleConnectionStore, type GoogleConnectionDoc } from "./google/connections";
import { createTokenCipher } from "./google/crypto";
import { createIntegrationsService } from "./google/integrations";
import { createGoogleOAuth } from "./google/oauth";
import { createWorkspaceProvider } from "./google/provider";
import { ensureGoogleOAuthStateIndexes, GOOGLE_OAUTH_STATES_COLLECTION, MongoOAuthStateStore, type OAuthStateDoc } from "./google/state-store";
import { createGoogleTokenSource } from "./google/token-cache";
import type { WorkspaceProvider } from "./google/types";
import type { PageFetcher, WebSearcher } from "./tools";

const env = loadEnv();
setLogLevel(env.LOG_LEVEL);
startTelemetry(env);

const startedAt = Date.now();
logger.info(`starting ${PERSONA.fullTitle}`, { env: env.NODE_ENV, release: env.APP_RELEASE, answerModel: env.ANSWER_MODEL ?? `gemini:${env.GEMINI_MODEL}`, researchModel: env.RESEARCH_MODEL ?? `gemini:${env.GEMINI_RESEARCH_MODEL ?? env.GEMINI_MODEL}`, answerTimeoutMs: env.ANSWER_TIMEOUT_MS, requestTimeoutMs: env.REQUEST_TIMEOUT_MS });
// A request deadline shorter than classify + research + answer (normal or DeepThink) cuts slow answers before their own timeout.
const timeoutWarning = timeoutBudgetWarning(env);
if (timeoutWarning) logger.warn(timeoutWarning, { requestTimeoutMs: env.REQUEST_TIMEOUT_MS, researchBudgetMs: env.RESEARCH_BUDGET_MS, answerTimeoutMs: env.ANSWER_TIMEOUT_MS, deepThinkTimeoutMs: env.DEEP_THINK_TIMEOUT_MS });
// A drain shorter than the request deadline cuts answers mid-stream on every rollout.
const drainWarning = shutdownDrainWarning(env);
if (drainWarning) logger.warn(drainWarning, { shutdownDrainMs: shutdownDrainMs(env), requestTimeoutMs: env.REQUEST_TIMEOUT_MS });

// --- Data layer -------------------------------------------------------------
const db = getDb(env);
const collections = getCollections(db);
if (!(await pingMongo(db))) {
  logger.error("MongoDB is unreachable at startup; continuing so /readyz can report it", { db: env.MONGODB_DB });
} else {
  await ensureIndexes(db, env).catch((err) => logger.warn("ensureIndexes failed (continuing)", { err }));
}

// --- Models & retrieval -----------------------------------------------------
const embeddings = new GeminiEmbeddings({
  apiKey: env.GOOGLE_API_KEY,
  model: env.GEMINI_EMBEDDING_MODEL,
  dimensions: env.EMBEDDING_DIMENSIONS,
});
// Searches embed through the cache; ingest (uploads below) keeps the raw model, so documents are never cached.
const queryEmbeddings = env.EMBEDDING_CACHE_ENABLED
  ? new CachedEmbeddings(embeddings, { collection: collections.embeddingCache, ttlDays: env.EMBEDDING_CACHE_TTL_DAYS })
  : embeddings;
const { store: baseKnowledge, mode: searchMode } = await createKnowledgeStore(env, db, queryEmbeddings);
// Per-provenance quotas (site / partner / upload / program) keep the mix balanced as the partner corpus grows.
const quotas = parseQuotas(env.RETRIEVAL_QUOTAS);
const quotaKnowledge = quotas ? new QuotaKnowledgeStore(baseKnowledge, quotas) : baseKnowledge;
if (quotas) logger.info("retrieval quotas enabled", { quotas });
// The result cache wraps the quota store, not the base: every caller (research tool, /v1/knowledge/search)
// goes through `knowledge`, so both quota fan-outs and restricted searches (which bypass the quotas) hit it,
// and a hit skips the whole fan-out with one entry per logical query instead of one per pass.
const knowledge =
  env.KB_RESULT_CACHE_TTL_SECONDS > 0
    ? new CachedKnowledgeStore(quotaKnowledge, { ttlSeconds: env.KB_RESULT_CACHE_TTL_SECONDS, version: kbVersionFromMongo(collections) })
    : quotaKnowledge;
const chatStore = new MongoChatStore(collections, env.SESSION_TTL_HOURS * 3600 * 1000);
// Durable activity log (chat_turns + activity_events): buffered, fire-and-forget, flushed on shutdown.
const activity = env.ACTIVITY_LOG_ENABLED
  ? new ActivityLog(new MongoActivityStore(collections), logger, { hashSecret: env.ACTIVITY_HASH_SECRET, release: env.APP_RELEASE })
  : undefined;

const langfuse = getLangfuse(env);
const prompts = createPromptRegistry(env, langfuse);
await prompts.warm();

const { classifier, provider: classifierProvider } = createClassifier(env);
logger.info("intent classifier", { provider: classifierProvider, ...(classifierProvider === "jev" ? { model: env.JEV_MODEL, timeoutMs: env.JEV_TIMEOUT_MS } : { model: env.GEMINI_CLASSIFIER_MODEL }) });
// Primary + cheaper stand-in, kept separate: the answer node streams the primary and
// falls back itself, because a `withFallbacks` wrapper loses the streamed thought parts.
// ANSWER_MODEL / RESEARCH_MODEL pick the models (Gemini when unset); the answer fallback is always Gemini.
// `deep` is the primary at higher reasoning effort, used on DeepThink turns.
const { primary: answerModel, deep: answerDeepModel, fallback: answerFallbackModel } = createAnswerModels(env);
const researchModel = createResearchModel(env);

// --- Partner registry (kb_partners; seeded from data/partners.json when empty) -
const partners = new MongoPartnerRegistry(collections.kbPartners);
await ensurePartnerRegistry(partners, { log: (m, meta) => logger.info(m, meta) }).catch((err) =>
  logger.warn("partner registry unavailable at startup; live-fetch policy falls back to data/partners.json", { err: (err as Error).message }),
);

// --- Live lookups (web search + page fetch) ----------------------------------
const policy = new DomainPolicy({
  allow: fetchAllowlist(env.WEB_FETCH_ALLOWED_DOMAINS),
  partnerDomains: partnerDomainProvider(partners),
  allowExplicitUrls: env.WEB_FETCH_ALLOW_EXPLICIT_URLS,
});
const liveCache = new MongoLiveCache(collections.liveCache);
const gemini = new GeminiGenerate({ apiKey: env.GOOGLE_API_KEY });
const web: WebSearcher | undefined = env.WEB_SEARCH_ENABLED
  ? { search: (q, o) => webSearch(q, o, { gen: gemini, model: env.GEMINI_WEB_SEARCH_MODEL, cache: liveCache, policy, cacheTtlSeconds: env.LIVE_CACHE_TTL_SECONDS }) }
  : undefined;
const fetcher: PageFetcher | undefined = env.WEB_FETCH_ENABLED
  ? {
      fetch: (url, o) =>
        fetchPageForAnswer(url, o, {
          policy,
          cache: liveCache,
          userAgent: env.OFFICIAL_USER_AGENT,
          timeoutMs: env.WEB_FETCH_TIMEOUT_MS,
          maxBytes: env.WEB_FETCH_MAX_BYTES,
          cacheTtlSeconds: env.LIVE_CACHE_TTL_SECONDS,
        }),
    }
  : undefined;

const programs = new MongoProgramSearch(collections.kbPrograms);

// --- CRM (read-only, over MCP) ----------------------------------------------
// A provider, not a client: each turn resolves the *asking consultant's* own CRM token via
// crm-api's exchange endpoint, so CRM reads carry their branch and assignee permissions.
// A shared service token would show every consultant the same rows.
const crmProvider = env.CRM_DEMO
  ? createDemoCrmProvider()
  : env.CRM_ENABLED
  ? createCrmProvider({
      url: env.CRM_MCP_URL!,
      exchangeSecret: env.CRM_EXCHANGE_SECRET!,
      tenantOrigin: env.CRM_TENANT_ORIGIN!,
      ...(env.CRM_TENANT_ID ? { tenantId: env.CRM_TENANT_ID } : {}),
      timeoutMs: env.CRM_TIMEOUT_MS,
      cacheTtlMs: env.CRM_TOKEN_CACHE_MINUTES * 60_000,
      allowWriteTools: env.CRM_WRITE_TOOLS_ENABLED,
      log: (m: string, meta?: Record<string, unknown>) => logger.info(m, meta),
    })
  : undefined;

// --- Google Workspace (Gmail + Drive over Google's MCP servers) --------------
// Per consultant, like the CRM: each connects their own Google account, and every call carries
// an access token minted from their own (encrypted) refresh token, so Google's permissions hold.
let workspaceProvider: WorkspaceProvider | undefined;
let integrations: IntegrationRoutes = disabledIntegrationRoutes;
if (env.GOOGLE_WORKSPACE_ENABLED) {
  const googleLog = (m: string, meta?: Record<string, unknown>) => logger.warn(m, meta);
  const oauth = createGoogleOAuth({ clientId: env.GOOGLE_WORKSPACE_CLIENT_ID!, clientSecret: env.GOOGLE_WORKSPACE_CLIENT_SECRET!, redirectUri: env.GOOGLE_WORKSPACE_REDIRECT_URI! });
  const cipher = createTokenCipher({ key: env.GOOGLE_TOKEN_ENC_KEY!, kid: env.GOOGLE_TOKEN_ENC_KID, previous: env.GOOGLE_TOKEN_ENC_PREVIOUS_KEYS });
  const connections = new MongoGoogleConnectionStore(db.collection<GoogleConnectionDoc>(GOOGLE_CONNECTIONS_COLLECTION));
  const states = new MongoOAuthStateStore(db.collection<OAuthStateDoc>(GOOGLE_OAUTH_STATES_COLLECTION));
  await ensureGoogleOAuthStateIndexes(db).catch((err) => logger.warn("Google OAuth state indexes failed (continuing)", { err }));
  const tokens = createGoogleTokenSource({ connections, oauth, cipher, log: logger });
  const provider = createWorkspaceProvider({
    tokens,
    gmailUrl: env.GMAIL_MCP_URL,
    driveUrl: env.DRIVE_MCP_URL,
    calendarUrl: env.CALENDAR_MCP_URL,
    timeoutMs: env.GOOGLE_WORKSPACE_TIMEOUT_MS,
    allowWrites: { gmail: env.GMAIL_DRAFTS_ENABLED, calendar: env.GOOGLE_CALENDAR_EVENTS_ENABLED, docs: env.GOOGLE_DOCS_CREATE_ENABLED },
    transport: env.GOOGLE_WORKSPACE_TRANSPORT,
    log: googleLog,
  });
  workspaceProvider = provider;
  const service = createIntegrationsService({
    oauth,
    states,
    connections,
    cipher,
    tokens,
    allowedDomains: env.GOOGLE_WORKSPACE_ALLOWED_DOMAINS,
    clientId: env.GOOGLE_WORKSPACE_CLIENT_ID!,
    onChange: (actor) => provider.forget(actor),
    ...(activity ? { recordEvent: (e: Parameters<typeof activity.event>[0]) => activity.event(e) } : {}),
    logger,
  });
  integrations = createIntegrationRoutes({ integrations: service, logger });
}

// Student documents attached in chat (STUDENT_DOCS_ENABLED): encrypted at rest, never indexed,
// never deleted; read by the graph's `documents` node, fetched by crm-api through signed links.
const studentDocs = env.STUDENT_DOCS_ACTIVE
  ? new StudentDocumentService({
      store: new MongoStudentDocumentStore(collections.studentDocuments),
      files: new GridFsFileStore(db, STUDENT_FILES_BUCKET),
      cipher: createFileCipher({ key: env.STUDENT_DOC_ENC_KEY!, kid: env.STUDENT_DOC_ENC_KID }),
      urlSecret: env.DOCUMENT_URL_SECRET!,
      publicBaseUrl: env.PUBLIC_BASE_URL!,
      maxBytes: env.STUDENT_DOC_MAX_BYTES,
    })
  : undefined;
// Browser → S3 → Edge, so scans never cross the ALB (its WAF blocks binary bodies).
const directUploads =
  studentDocs && env.STUDENT_DOC_S3_BUCKET
    ? new DirectUploads({
        store: s3UploadStore({ bucket: env.STUDENT_DOC_S3_BUCKET, region: env.STUDENT_DOC_S3_REGION }),
        secret: env.DOCUMENT_URL_SECRET!,
        maxBytes: env.STUDENT_DOC_MAX_BYTES,
        prefix: env.STUDENT_DOC_S3_PREFIX,
      })
    : undefined;

// Writes never run inside the research loop: each becomes a proposal the counsellor approves or
// rejects (POST /v1/crm/writes/:id/decision). One service decides both kinds, but the research loop
// is handed it separately per kind, so each is offered only when its own switch is on.
const crmWritesOn = Boolean(crmProvider && env.CRM_WRITE_TOOLS_ENABLED);
// Any Google write (Gmail draft, Calendar event, new Doc/Sheet) goes through the same approval service.
const gmailDraftsOn = Boolean(workspaceProvider && (env.GMAIL_DRAFTS_ENABLED || env.GOOGLE_CALENDAR_EVENTS_ENABLED || env.GOOGLE_DOCS_CREATE_ENABLED));
const writeApprovals =
  crmWritesOn || gmailDraftsOn
    ? new CrmWriteService({
        store: new MongoCrmWriteProposalStore(db.collection<CrmWriteProposalDoc>(CRM_WRITE_PROPOSALS_COLLECTION)),
        ...(crmWritesOn ? { crm: crmProvider! } : {}),
        ...(gmailDraftsOn ? { workspace: workspaceProvider! } : {}),
        logger,
        ...(studentDocs
          ? {
              // A signed file link lives 10 minutes, a proposal 30: the attach is sent with a fresh one.
              prepareArgs: (p: { tool: string; args: Record<string, unknown>; origin?: { attachmentId: string } }) => {
                const id = p.tool === "crm_attach_contact_document" ? (p.origin?.attachmentId ?? fileIdFromUrl(String(p.args.fileUrl ?? ""))) : null;
                return id ? { ...p.args, fileUrl: studentDocs.signedUrl(id) } : p.args;
              },
              // Every decision on a proposal made from a document is kept on that document, forever.
              onStatus: (p: { id: string; tool: string; status: string; decidedAt?: Date; edited?: { field: string; from: unknown; to: unknown }[]; origin?: { attachmentId: string } }) => {
                if (!p.origin) return;
                void studentDocs
                  .recordCrmActions(p.origin.attachmentId, [{ proposalId: p.id, tool: p.tool, status: p.status, at: p.decidedAt ?? new Date(), ...(p.edited ? { edited: p.edited } : {}) }])
                  .catch((err) => logger.warn("could not record a document proposal decision", { proposalId: p.id, err: (err as Error).message }));
              },
            }
          : {}),
      })
    : undefined;
const crmWrites = crmWritesOn ? writeApprovals : undefined;
if (writeApprovals) await ensureCrmWriteProposalIndexes(db).catch((err) => logger.warn("CRM write proposal indexes failed (continuing)", { err }));
// Guided sessions read their student through the same per-consultant CRM toolset.
const students = crmProvider ? new CrmStudentReader({ provider: crmProvider, crmWebUrl: env.CRM_WEB_URL, log: (m: string, meta?: Record<string, unknown>) => logger.warn(m, meta) }) : undefined;
// The consultant's CRM branch is the default origin market of their turns ("Nepali" goes unsaid in Kathmandu).
const regions = crmProvider ? new CounsellorRegionReader({ provider: crmProvider, log: (m: string, meta?: Record<string, unknown>) => logger.warn(m, meta) }) : undefined;

const graph = buildGraph({
  env,
  classifier,
  answerModel,
  answerFallbackModel,
  answerDeepModel,
  researchModel,
  // OpenRouter research rounds stream, so their reasoning shows while the model thinks.
  research: { streamReasoning: researchModel instanceof OpenRouterChatModel },
  knowledge,
  prompts,
  tools: { web, fetcher, programs },
  crmProvider,
  crmWrites,
  workspaceProvider,
  gmailDrafts: gmailDraftsOn ? writeApprovals : undefined,
  // Its own Gemini call per file: the answer and research models may not be Gemini (DeepSeek in prod).
  documents: studentDocs ? { documents: studentDocs, gen: gemini, model: env.GEMINI_DOC_MODEL, fallbackModel: env.GEMINI_MODEL } : undefined,
});

// --- Staff document uploads (GridFS + async parse/index) -----------------------
const documents = new MongoDocumentService({
  collections,
  files: new GridFsFileStore(db),
  ingest: { collections, embeddings, crawlOptions: { userAgent: env.CRAWL_USER_AGENT, concurrency: 1, delayMs: 0 } },
  parse: { gen: gemini, model: env.GEMINI_PDF_MODEL },
  programs: env.PROGRAM_EXTRACTION_ENABLED ? { gen: gemini, model: env.GEMINI_EXTRACT_MODEL, fallbackModel: env.GEMINI_MODEL } : undefined,
  logger,
  maxBytes: env.UPLOAD_MAX_BYTES,
  concurrency: env.UPLOAD_CONCURRENCY,
});
documents
  .resumeInterrupted()
  .then((n) => n && logger.info("re-queued interrupted document uploads", { count: n }))
  .catch((err) => logger.warn("could not resume interrupted uploads", { err: (err as Error).message }));
const service = new ChatService({
  env,
  graph,
  store: chatStore,
  logger,
  activity,
  loadProfile: async (ownerId) => (await collections.profiles.findOne({ _id: ownerId }))?.profile ?? null,
  // Conversation titles and follow-up chips, on the cheap model, after each answer.
  extras: env.TURN_EXTRAS_ENABLED ? new GeminiTurnExtras({ gen: gemini, model: env.GEMINI_TURN_EXTRAS_MODEL, logger }) : undefined,
  crmWrites: writeApprovals,
  students,
  regions,
});

// --- Readiness (cached so probes stay cheap) --------------------------------
let readyCache: { at: number; value: { ok: boolean; checks: Record<string, unknown> } } | null = null;
async function readiness() {
  if (readyCache && Date.now() - readyCache.at < 15_000) return readyCache.value;
  const [mongo, kbCount] = await Promise.all([pingMongo(db), knowledge.count().catch(() => -1)]);
  const value = {
    ok: mongo,
    checks: {
      mongodb: mongo ? "ok" : "unreachable",
      knowledgeBase: { mode: searchMode, chunks: kbCount, status: kbCount > 0 ? "ok" : "empty" },
      langfuse: env.LANGFUSE_ENABLED ? "enabled" : "disabled",
      userAuth: env.GOOGLE_LOGIN_ENABLED ? "google" : env.SUPABASE_URL ? "supabase" : "disabled",
      crm: env.CRM_DEMO ? "demo (made-up students)" : env.CRM_ENABLED ? "per-user token exchange" : "disabled",
      googleWorkspace: env.GOOGLE_WORKSPACE_ENABLED ? `per-user OAuth, ${env.GOOGLE_WORKSPACE_TRANSPORT} transport${[env.GMAIL_DRAFTS_ENABLED && "Gmail drafts", env.GOOGLE_CALENDAR_EVENTS_ENABLED && "Calendar events", env.GOOGLE_DOCS_CREATE_ENABLED && "Docs & Sheets"].filter(Boolean).map((w) => `, ${w} on`).join("")}` : "disabled",
      model: env.ANSWER_MODEL ?? env.GEMINI_MODEL,
      researchModel: env.RESEARCH_MODEL ?? env.GEMINI_RESEARCH_MODEL ?? env.GEMINI_MODEL,
      activityLog: activity ? activity.stats() : "disabled",
      studentDocuments: studentDocs ? `on (${env.GEMINI_DOC_MODEL})` : "disabled",
    },
  };
  readyCache = { at: Date.now(), value };
  return value;
}

// --- HTTP -------------------------------------------------------------------
const app = createApp({ env, service, store: chatStore, knowledge, collections, logger, readiness, startedAt, activity, partners, programs, documents, crmWrites: writeApprovals, students, integrations, studentDocs, directUploads });
logger.info(`${PERSONA.name} is listening`, {
  port: app.server.port,
  searchMode,
  langfuse: env.LANGFUSE_ENABLED,
  staticKeyAuth: Boolean(env.API_KEY),
  userAuth: env.USER_AUTH_ENABLED,
  workspaceAllowedDomains: env.GOOGLE_WORKSPACE_ALLOWED_DOMAINS,
});

// --- Shutdown ---------------------------------------------------------------
// The preStop sleep has already run (ALB deregistration) by the time SIGTERM arrives.
const shutdown = createShutdown({
  drainMs: shutdownDrainMs(env),
  drain: (ms) => app.shutdown(ms),
  flush: async () => {
    // Drain buffered activity before the MongoDB client goes away.
    await activity?.close().catch((err) => logger.error("activity log flush failed during shutdown", { err }));
    await Promise.allSettled([shutdownLangfuse(), shutdownTelemetry(), closeMongo()]);
  },
  logger,
  exit: (code) => process.exit(code),
});
// Bun's process typings narrow `on`; cast to the generic emitter signature.
const proc = process as unknown as { on(event: string, listener: (...args: unknown[]) => void): void };
proc.on("SIGTERM", () => void shutdown("SIGTERM"));
proc.on("SIGINT", () => void shutdown("SIGINT"));
proc.on("unhandledRejection", (reason) => logger.error("unhandledRejection", { err: reason }));
