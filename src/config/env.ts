import { z } from "zod";
import { parseModelSpec } from "../llm/spec";

/**
 * Typed, fail-fast environment configuration.
 *
 * Bun loads `.env` from the working directory natively; in containers the
 * environment arrives from the ConfigMap + Secret. Anything invalid stops the
 * process at boot instead of surfacing as an opaque runtime error.
 */
const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    APP_RELEASE: z.string().optional(),

    // --- Security -----------------------------------------------------------
    /** Static key every caller must send as `x-api-key`. Optional outside production. */
    API_KEY: z.string().min(32, "API_KEY must be at least 32 characters").optional(),
    CORS_ORIGINS: csv,
    /** Google OAuth client id for "Continue with Google" (Google Identity Services). */
    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    /** Secret used to sign Edge session tokens issued after Google sign-in (>= 32 chars). Shared with the frontend. */
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters").optional(),
    AUTH_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    /**
     * Supabase project URL (e.g. https://xyz.supabase.co). Legacy: when set, callers
     * may authenticate with `Authorization: Bearer <supabase access token>` instead
     * of an Edge session. Not domain-restricted — same sign-in policy as Google.
     */
    SUPABASE_URL: z.url().optional(),
    /** Legacy HS256 JWT secret (Settings → API → JWT Secret). Not needed for projects on asymmetric signing keys. */
    SUPABASE_JWT_SECRET: z.string().min(16).optional(),
    /** Require the Supabase identity to come from the Google provider ("Continue with Google"). */
    REQUIRE_GOOGLE_PROVIDER: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    /**
     * Staff allowed to manage the knowledge base (partner registry, reindex, deleting others' uploads).
     * Empty = any authenticated staff member (single-tenant internal tool); `x-api-key` callers are always admins.
     */
    ADMIN_EMAILS: csv,
    RATE_LIMIT_RPM: z.coerce.number().int().min(1).default(60),
    /**
     * Whole-request deadline (HTTP chat routes). Must exceed the classifier's budget (15 s) +
     * RESEARCH_BUDGET_MS + ANSWER_TIMEOUT_MS, or a slow answer is cut by the request before its
     * own timeout: raise this whenever either of those is raised. The server logs a warning at
     * boot when it does not (`timeoutBudgetWarning`). DeepThink turns use DEEP_THINK_TIMEOUT_MS
     * instead, so this must exceed classify + RESEARCH_BUDGET_MS + DEEP_THINK_TIMEOUT_MS as well
     * (15 + 25 + 75 = 115 s with the defaults). It also caps the answer fallback's own budget.
     */
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(120_000),
    /**
     * How long SIGTERM waits for in-flight requests (streamed answers included) before cutting
     * them. Unset = REQUEST_TIMEOUT_MS + 5 s (`shutdownDrainMs`), so a turn that started just
     * before the signal still finishes. The pod's terminationGracePeriodSeconds must cover
     * preStop sleep + this + ~15 s flush, or the kubelet SIGKILLs the drain.
     */
    SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).optional(),
    MAX_INPUT_CHARS: z.coerce.number().int().min(100).default(4_000),

    // --- Google Gemini ------------------------------------------------------
    GOOGLE_API_KEY: z.string().min(1),
    GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
    GEMINI_FALLBACK_MODEL: z.string().default("gemini-3.5-flash-lite"),
    GEMINI_CLASSIFIER_MODEL: z.string().default("gemini-3.5-flash-lite"),
    GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
    EMBEDDING_DIMENSIONS: z.coerce.number().int().min(128).max(3072).default(768),
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).default(2_048),
    /**
     * Ask the answer model for thought summaries and stream them as `thinking` events.
     * A flag because thinking tokens are billed and delay the first visible answer token;
     * turning it off trades the "what Edge is working through" panel for a cheaper turn.
     */
    GEMINI_THINKING_ENABLED: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    /** How hard the answer model thinks. Unset = whatever the model defaults to. */
    GEMINI_THINKING_LEVEL: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
    /** OpenRouter key: the Jev decision classifier, ANSWER_MODEL / RESEARCH_MODEL when they name an openrouter: model, and `bun run eval:models`. */
    OPENROUTER_API_KEY: z.string().optional(),
    /**
     * Answer model as a spec: `gemini:<id>`, `openrouter:<vendor/model>` or `bedrock:<model id>`,
     * e.g. `openrouter:deepseek/deepseek-v4.1-flash` or `bedrock:zai.glm-4.7-flash`. Unset = Gemini
     * GEMINI_MODEL. The fallback stays Gemini GEMINI_FALLBACK_MODEL either way.
     */
    ANSWER_MODEL: z.string().optional(),
    /** Research (tool-calling) model spec, same format. Unset = Gemini GEMINI_RESEARCH_MODEL, else GEMINI_MODEL. */
    RESEARCH_MODEL: z.string().optional(),
    /**
     * Region for bedrock: models. Credentials come from the AWS SDK's default chain: in the
     * cluster the pod's IRSA role (production/expert-ai-consultant), locally AWS_PROFILE or keys.
     */
    BEDROCK_REGION: z.string().default("ap-southeast-2"),
    /**
     * Reasoning effort for DeepThink turns (the consultant's toggle) when ANSWER_MODEL is an
     * openrouter: model, sent as OpenRouter `reasoning.effort`. Gemini answers use thinking level HIGH.
     * "medium" by default: in the Oct 2026 counsellor audit DeepSeek V4.1 Flash (DeepInfra, ~35-45
     * tok/s) at "high" reasoned ~3,000 tokens (~75 s) before its first answer token, past the
     * DeepThink deadline, and DeepThink failed 6/6.
     */
    DEEP_THINK_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
    /**
     * OpenRouter reasoning for the normal (non-DeepThink) answer and for the research rounds:
     * "default" leaves it to the model, "off" sends `reasoning.enabled: false`. DeepSeek V4.1
     * Flash on DeepInfra reasoned ~1,800 tokens before answering at ~35-45 tok/s, so the first
     * answer token came after 37-57 s (past the 45 s answer timeout) against ~2 s with reasoning
     * off (measured 8 Oct 2026). `effort: "low"` barely changed it (~1,600 tokens).
     */
    ANSWER_REASONING: z.enum(["default", "off"]).default("default"),
    RESEARCH_REASONING: z.enum(["default", "off"]).default("default"),
    /**
     * Answer budget for a normal (non-DeepThink) turn: the stream is cut after this long. A
     * reasoning model (ANSWER_REASONING=default) thinks before its first token, so give it more
     * time here rather than turning reasoning off; raise REQUEST_TIMEOUT_MS with it.
     */
    ANSWER_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(45_000),
    /**
     * Answer budget for a DeepThink turn (normal turns: ANSWER_TIMEOUT_MS). Reasoning is slow:
     * DEEP_THINK_EFFORT=medium on DeepSeek is ~2,000 reasoning tokens plus the answer at ~40 tok/s.
     * REQUEST_TIMEOUT_MS still caps the whole request, so keep it above classify (15 s) +
     * RESEARCH_BUDGET_MS + this (`timeoutBudgetWarning` checks).
     */
    DEEP_THINK_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(75_000),
    /**
     * The answer fallback's own budget, started fresh when the primary fails before its first
     * token (the primary's deadline is spent by then: sharing it made the fallback "time out"
     * 2-3 ms after starting). Still capped by the request deadline.
     */
    FALLBACK_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(25_000),
    /**
     * OpenRouter provider routing for ANSWER_MODEL / RESEARCH_MODEL, as JSON, e.g.
     * `{"only":["DeepInfra"],"require_parameters":true}`: which hosts may serve the model.
     */
    OPENROUTER_PROVIDER: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v) return undefined;
        try {
          const o = JSON.parse(v) as unknown;
          if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
        } catch {
          // reported below
        }
        ctx.addIssue({ code: "custom", message: "OPENROUTER_PROVIDER must be a JSON object" });
        return z.NEVER;
      }),
    /**
     * After each answer, name the conversation and suggest three follow-up questions with a
     * cheap model (streamed as `session` and `suggestions` events after `done`). A flag
     * because it is one or two extra calls per turn; off = provisional first-message titles
     * and no chips, nothing else changes.
     */
    TURN_EXTRAS_ENABLED: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    GEMINI_TURN_EXTRAS_MODEL: z.string().default("gemini-3.5-flash-lite"),

    // --- MongoDB Atlas (knowledge base vectors + chat memory) ---------------
    MONGODB_URI: z.string().min(1),
    MONGODB_DB: z.string().default("expert_ai_consultant"),
    MONGODB_VECTOR_INDEX: z.string().default("kb_vector"),
    MONGODB_TEXT_INDEX: z.string().default("kb_text"),
    /** atlas = $vectorSearch + Atlas Search; inapp = in-process cosine + $text index; auto = detect at boot. */
    KB_SEARCH_MODE: z.enum(["auto", "atlas", "inapp"]).default("auto"),
    /** In-app mode: how often the embedding cache is refreshed from MongoDB. */
    KB_CACHE_REFRESH_SECONDS: z.coerce.number().int().min(30).default(600),
    /** Cache query embeddings (in-flight dedupe + in-memory LRU + `embedding_cache` collection). Ingest is never cached. */
    EMBEDDING_CACHE_ENABLED: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    /** How long persisted query embeddings live in `embedding_cache`. */
    EMBEDDING_CACHE_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    /** Per-pod cache of knowledge-base search results, invalidated by new ingest runs/uploads. 0 disables. */
    KB_RESULT_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(600),

    // --- Conversation -------------------------------------------------------
    HISTORY_WINDOW_MESSAGES: z.coerce.number().int().min(2).default(12),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(72),
    RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(20).default(6),
    /** Characters of evidence text placed in the answer prompt. */
    CONTEXT_MAX_CHARS: z.coerce.number().int().min(4_000).default(24_000),
    /**
     * Per-provenance retrieval quotas so partner sites cannot swamp our own pages:
     * "site:4,partner:5,program:3,upload:4". Empty = single-pass search with RETRIEVAL_TOP_K.
     */
    RETRIEVAL_QUOTAS: z.string().optional(),

    // --- Jev decision classifier (TypeSafe, via OpenRouter) -----------------
    /**
     * Which classifier the chat graph runs. `gemini` = the structured-output Gemini classifier.
     * `jev` = TypeSafe Jev decides everything (topic, task, routing, destinations, flags, audience,
     * channel, stage, signals) in one ~400 ms call; the retrieval query is built in code; the
     * Gemini classifier runs only when Jev errors or times out. Needs OPENROUTER_API_KEY, else
     * the server logs an error at boot and stays on gemini.
     */
    CLASSIFIER_PROVIDER: z.enum(["gemini", "jev"]).default("gemini"),
    /** Jev call budget; past it the turn falls back to the Gemini classifier. */
    JEV_TIMEOUT_MS: z.coerce.number().int().min(500).default(4_000),
    JEV_MODEL: z.string().default("typesafe/jev-1.13"),
    /** System One endpoint; point at https://api.typesafe.ai/v1/systemone (with a TypeSafe key) to bypass OpenRouter. */
    JEV_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1/systemone"),

    // --- Research loop (agentic lookups at answer time) ---------------------
    /** Model that decides which lookups to run. Defaults to GEMINI_MODEL. */
    GEMINI_RESEARCH_MODEL: z.string().optional(),
    /** Model used for Google-Search-grounded web searches (cheap, fast). */
    GEMINI_WEB_SEARCH_MODEL: z.string().default("gemini-3.5-flash-lite"),
    /** Tool-calling rounds after the deterministic knowledge-base search. 0 = knowledge base only. */
    RESEARCH_MAX_ROUNDS: z.coerce.number().int().min(0).max(8).default(3),
    /** Wall-clock budget for the whole research phase. */
    RESEARCH_BUDGET_MS: z.coerce.number().int().min(1_000).default(25_000),
    /** Cap on evidence items carried into the answer prompt. */
    RESEARCH_MAX_EVIDENCE: z.coerce.number().int().min(4).max(60).default(24),
    /**
     * Cap on one research model call (ms; 0 = only the research budget caps it). A successful round
     * took 4.5 s at p50 and 16 s at p99 (Oct 2026), while a hung one held the turn until the budget
     * ran out (23 s for nothing); past this the loop answers with what it has.
     */
    RESEARCH_ROUND_TIMEOUT_MS: z.coerce.number().int().min(0).default(16_000),
    /**
     * A research round starts only with at least this much budget left (ms). A round (model call
     * ~4.5 s, then its lookups ~1 s) started later was cut at the deadline and gathered nothing.
     * 1500 = the earlier behaviour.
     */
    RESEARCH_MIN_ROUND_MS: z.coerce.number().int().min(0).default(5_000),
    /**
     * Model-driven research rounds on an urgent turn (distress or self-harm in the message, or the
     * crisis_safeguarding signal): round 0 and the helpline searches still run, so the safety reply
     * starts sooner. At or above RESEARCH_MAX_ROUNDS = no cap (the earlier behaviour). See src/graph/round-cap.ts.
     */
    RESEARCH_URGENT_MAX_ROUNDS: z.coerce.number().int().min(0).max(8).default(0),
    /**
     * Model-driven research rounds for a short question that gets a short-first answer and is not
     * about a person or the consultant's mail (the model almost never stops on its own, so most
     * turns run every round). At or above RESEARCH_MAX_ROUNDS = no cap. See src/graph/round-cap.ts.
     */
    RESEARCH_SHORT_MAX_ROUNDS: z.coerce.number().int().min(0).max(8).default(2),
    /** Scope research tools and the round-0 search by the classified intent (see src/graph/scoping.ts). Off = every tool, every turn. */
    RESEARCH_INTENT_SCOPING: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    /**
     * Country skill packs (src/skills): a per-destination brief in the research prompt, guidance and a
     * coverage checklist in the answer prompt, and pack vocabulary in the round-0 query. Off until the
     * coverage eval clears them.
     */
    /**
     * Comparison fan-out: a comparison of two or more countries researches each country in its own
     * concurrent branch (own evidence, tools pinned to that country, no CRM or Google tools), then
     * merges the evidence. Off by default.
     */
    COMPARE_FANOUT_ENABLED: z
      .string()
      .default("false")
      .transform((v) => /^(1|true|yes|on)$/i.test(v.trim())),
    /** Countries researched in a fan-out; the rest of the route is noted as not researched. */
    COMPARE_MAX_COUNTRIES: z.coerce.number().int().min(2).max(4).default(3),
    /** Tool-calling rounds per fan-out branch (never more than RESEARCH_MAX_ROUNDS). */
    COMPARE_BRANCH_ROUNDS: z.coerce.number().int().min(0).max(8).default(2),
    /**
     * Expert's destination facts registers (data/facts, src/skills/facts-register.ts): for a rule-
     * or figure-shaped question on a destination with a register, research round 0 adds its Closed
     * or replaced table and the best-matching topic table as dated evidence. On by default.
     */
    FACTS_REGISTER_ENABLED: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    /**
     * Home-currency totals: when a message asks for a figure "in NPR", "in lakh" or "in our
     * currency", research round 0 searches the source market's central bank for today's rate
     * (src/graph/fx.ts; needs WEB_SEARCH_ENABLED). On by default.
     */
    FX_RATES_ENABLED: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    /**
     * After every answer, check its money and percentage figures against this turn's evidence,
     * its totals against their items and its home-currency figures against the stated rate
     * (src/graph/answer-check.ts); problems get one visible "Figure check" line. On by default.
     */
    ANSWER_FIGURE_CHECK_ENABLED: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    SKILL_PACKS_ENABLED: z
      .string()
      .default("false")
      .transform((v) => /^(1|true|yes|on)$/i.test(v.trim())),
    /**
     * Market (source-country) packs (src/skills/markets): when the route has an origin (Nepal,
     * India…), a market brief in the research prompt and market guidance in the answer prompt.
     * Unset (or empty) follows SKILL_PACKS_ENABLED, so one flag turns both layers on; set it to
     * turn the market layer on or off on its own.
     */
    MARKET_PACKS_ENABLED: z
      .string()
      .optional()
      .transform((v) => (v === undefined || !v.trim() ? undefined : /^(1|true|yes|on)$/i.test(v.trim()))),
    WEB_SEARCH_ENABLED: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    WEB_FETCH_ENABLED: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    /** Extra domains Edge may fetch live besides experteducation.com and partner universities (suffix match). */
    WEB_FETCH_ALLOWED_DOMAINS: z
      .string()
      .default("homeaffairs.gov.au,immi.homeaffairs.gov.au,studyaustralia.gov.au,gov.uk,ukcisa.org.uk,canada.ca,immigration.govt.nz,studywithnewzealand.govt.nz,educationusa.state.gov,travel.state.gov,daad.de,make-it-in-germany.com,irishimmigration.ie,educationinireland.com,studyinholland.nl,ind.nl,educationmalaysia.gov.my,ielts.org,pearsonpte.com,ets.org")
      .transform((v) => v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)),
    /** Let consultants have Edge fetch a URL they paste even if it is not on the allowlist (SSRF-checked). */
    WEB_FETCH_ALLOW_EXPLICIT_URLS: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    // --- CRM (read-only, over MCP) ------------------------------------------
    /** MCP endpoint of crm-api, e.g. https://crm.api.applyims.com/v1/mcp. CRM tools are off when unset. */
    CRM_MCP_URL: z.string().url().optional(),
    /**
     * Shared HMAC secret for crm-api's token exchange (POST /v1/mcp/token). Edge signs a
     * short-lived assertion naming the consultant; the CRM returns that consultant's own
     * token. Must match MCP_EDGE_EXCHANGE_SECRET on crm-api, and must NOT be SESSION_SECRET.
     */
    CRM_EXCHANGE_SECRET: z.string().min(32, "CRM_EXCHANGE_SECRET must be at least 32 characters").optional(),
    /**
     * Origin header sent to crm-api. Required whenever CRM_MCP_URL is set: its VerifyAccount
     * guard parses this header unguarded, and its hostname resolves the tenant. Note this is
     * the CRM *front end* host (the tenant's company_domain), not the API host.
     */
    CRM_TENANT_ORIGIN: z.string().url().optional(),
    /** Explicit tenant id (x-tenant-id). Optional: crm-api falls back to the Origin hostname. */
    CRM_TENANT_ID: z.string().optional(),
    /**
     * CRM *front end* origin (e.g. https://crm.heubertapp.com), used to turn a CRM lookup into a
     * link the consultant can click. Kept separate from CRM_TENANT_ORIGIN — that one is a
     * protocol requirement of crm-api's guards, this one is only for display — so a deployment
     * can point at a different host, or at none, without breaking CRM access.
     */
    CRM_WEB_URL: z.string().url().optional(),
    CRM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
    /** Local development only: serve three made-up students instead of a real CRM (src/crm/demo.ts). Refused in production. */
    CRM_DEMO: z
      .string()
      .default("false")
      .transform((v) => /^(1|true|yes|on)$/i.test(v.trim())),
    /** How long one consultant's exchanged CRM token is reused before a fresh exchange. */
    CRM_TOKEN_CACHE_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
    /**
     * Offer the CRM's mutating MCP tools (crm_create_*, crm_update_*) to the research model. Off by
     * default: the research loop calls tools on its own judgement with no confirmation step, so a
     * write it is offered is a write it may make. Keep false until that step exists.
     */
    CRM_WRITE_TOOLS_ENABLED: z
      .string()
      .default("false")
      .transform((v) => /^(1|true|yes|on)$/i.test(v.trim())),
    // --- Google Workspace (Gmail + Drive, over Google's remote MCP servers) --
    /**
     * OAuth client (Web, Internal consent screen) that consultants grant Gmail/Drive access to.
     * Separate from GOOGLE_OAUTH_CLIENT_ID, which only verifies the sign-in ID token and carries no scopes.
     * All four of client id, secret, redirect URI and GOOGLE_TOKEN_ENC_KEY must be set to enable the integration.
     */
    GOOGLE_WORKSPACE_CLIENT_ID: z.string().optional(),
    GOOGLE_WORKSPACE_CLIENT_SECRET: z.string().optional(),
    /** The frontend's `/api/integrations/google/callback` URL, registered on the OAuth client. */
    GOOGLE_WORKSPACE_REDIRECT_URI: z.string().url().optional(),
    /**
     * Only accounts on these email domains may link Gmail/Drive/Calendar. Independent of Edge
     * sign-in (which is open to any Google account) — this gates whose corporate Workspace a
     * consultant may connect, not who may sign in.
     */
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: z
      .string()
      .default("heubert.com,experteducation.com.au")
      .transform((v) => v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)),
    /** 32 random bytes, base64: encrypts consultants' refresh tokens at rest (AES-256-GCM). Must not be SESSION_SECRET. */
    GOOGLE_TOKEN_ENC_KEY: z.string().optional(),
    /** Names the encryption key in stored blobs, so the key can be rotated. */
    GOOGLE_TOKEN_ENC_KID: z.string().default("k1"),
    /**
     * Keys retired by a rotation, still accepted for decryption: `k0=<base64>,k00=<base64>`. A stored
     * token moves to the current key when its consultant reconnects.
     */
    GOOGLE_TOKEN_ENC_PREVIOUS_KEYS: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? "")
          .split(",")
          .map((pair) => pair.trim())
          .filter(Boolean)
          .map((pair) => {
            const at = pair.indexOf("=");
            return { kid: pair.slice(0, at).trim(), key: pair.slice(at + 1).trim() };
          }),
      ),
    GMAIL_MCP_URL: z.string().url().default("https://gmailmcp.googleapis.com/mcp/v1"),
    DRIVE_MCP_URL: z.string().url().default("https://drivemcp.googleapis.com/mcp/v1"),
    CALENDAR_MCP_URL: z.string().url().default("https://calendarmcp.googleapis.com/mcp/v1"),
    /** Offer Calendar events as approval cards. On Approve, Google emails the attendees an invite. */
    GOOGLE_CALENDAR_EVENTS_ENABLED: z
      .string()
      .default("false")
      .transform((v) => /^(1|true|yes|on)$/i.test(v.trim())),
    /** Offer new Google Docs and Sheets as approval cards. Files are created private to the consultant. */
    GOOGLE_DOCS_CREATE_ENABLED: z
      .string()
      .default("false")
      .transform((v) => /^(1|true|yes|on)$/i.test(v.trim())),
    GOOGLE_WORKSPACE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
    /**
     * Which Google API answers the Gmail/Drive tools. `auto`: the MCP servers, falling back to the
     * Gmail/Drive REST APIs while the MCP preview refuses this Cloud project. `rest`: never the
     * preview servers (their terms let Google use data passing through pre-GA APIs). `mcp`: no fallback.
     */
    GOOGLE_WORKSPACE_TRANSPORT: z.enum(["auto", "mcp", "rest"]).default("auto"),
    /** Offer `gmail_create_draft` as an approval-card proposal. Drafts are only saved on Approve and are never sent. */
    GMAIL_DRAFTS_ENABLED: z
      .string()
      .default("false")
      .transform((v) => /^(1|true|yes|on)$/i.test(v.trim())),
    WEB_FETCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),
    WEB_FETCH_MAX_BYTES: z.coerce.number().int().min(50_000).default(2_000_000),
    /** How long live lookups (searches, fetched pages) are cached. */
    LIVE_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(21_600),

    // --- Activity log / training data ---------------------------------------
    /** Durable per-turn + per-action log in MongoDB (chat_turns, activity_events). */
    ACTIVITY_LOG_ENABLED: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    /** 0 = keep forever (default). > 0 adds a TTL index on chat_turns + activity_events. */
    ACTIVITY_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
    /** HMAC key for the stable pseudonymous userHash. Falls back to plain sha256 when unset. */
    ACTIVITY_HASH_SECRET: z.string().min(16, "ACTIVITY_HASH_SECRET must be at least 16 characters").optional(),

    // --- Langfuse (optional) ------------------------------------------------
    LANGFUSE_PUBLIC_KEY: z.string().optional(),
    LANGFUSE_SECRET_KEY: z.string().optional(),
    LANGFUSE_BASE_URL: z.url().optional(),
    /** Legacy alias for LANGFUSE_BASE_URL. */
    LANGFUSE_HOST: z.url().optional(),
    LANGFUSE_PROMPT_LABEL: z.string().default("production"),
    LANGFUSE_PROMPT_CACHE_TTL: z.coerce.number().int().min(0).default(300),
    LANGFUSE_TRACING_ENVIRONMENT: z.string().optional(),

    // --- Ingestion ----------------------------------------------------------
    CRAWL_USER_AGENT: z
      .string()
      .default("ExpertEducationEdgeBot/1.0 (+https://experteducation.com; knowledge-base indexer)"),
    /**
     * User agent for official pages (src/ingest/official.ts) and live page fetches. Names us
     * honestly but without "Bot" or a "+http" URL: some government WAFs (immi.homeaffairs.gov.au)
     * reject those patterns outright although robots.txt allows the pages. Never a browser string.
     */
    OFFICIAL_USER_AGENT: z.string().default("ExpertEducationEdge/1.0 (experteducation.com)"),
    /** Crawl the curated official pages (data/official-pages.json + facts-register sources) in `--source all`. */
    OFFICIAL_INGEST_ENABLED: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    /** Minimum gap between two requests to the same official host (canada.ca's WAF starts refusing at ~1.5 s). */
    OFFICIAL_CRAWL_DELAY_MS: z.coerce.number().int().min(0).default(4_000),
    /**
     * Round 0: when the indexed official pages already answer a rule-shaped question (at least
     * this many official chunks for the destination), the live official web search is cancelled.
     * 0 always waits for the live search.
     */
    OFFICIAL_KB_MIN_HITS: z.coerce.number().int().min(0).max(10).default(2),
    CRAWL_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
    CRAWL_DELAY_MS: z.coerce.number().int().min(0).default(250),
    /** Page budget per partner-university site unless the registry record overrides it. */
    PARTNER_DEFAULT_MAX_PAGES: z.coerce.number().int().min(10).max(5_000).default(400),
    /** Partner sites crawled concurrently by the ingest job (each with a small per-host concurrency). */
    INGEST_HOST_PARALLELISM: z.coerce.number().int().min(1).max(32).default(6),
    /** Extract structured program records (fees, intakes, entry requirements) from course pages during ingest. */
    PROGRAM_EXTRACTION_ENABLED: z
      .string()
      .default("true")
      .transform((v) => !/^(0|false|no|off)$/i.test(v.trim())),
    /** Model for structured program extraction (cheap; escalates to GEMINI_MODEL when the output fails validation). */
    GEMINI_EXTRACT_MODEL: z.string().default("gemini-3.5-flash-lite"),

    // --- Staff document uploads ---------------------------------------------
    UPLOAD_MAX_BYTES: z.coerce.number().int().min(100_000).max(100 * 1024 * 1024).default(20 * 1024 * 1024),
    /** Uploads parsed/indexed concurrently inside the API process. */
    UPLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    /** Model used to convert PDFs to Markdown (document understanding). */
    GEMINI_PDF_MODEL: z.string().default("gemini-3.6-flash"),
    /** Politeness delay between requests to the same partner host. */
    CRAWL_PARTNER_DELAY_MS: z.coerce.number().int().min(0).default(500),

    // --- Student document intake (docs/document-intake/contract.md) ---------
    /**
     * Counsellors attach a student's passport or national ID in chat; Edge reads it and proposes
     * CRM updates. Off unless true AND STUDENT_DOC_ENC_KEY, DOCUMENT_URL_SECRET and PUBLIC_BASE_URL are set.
     */
    STUDENT_DOCS_ENABLED: z
      .string()
      .default("false")
      .transform((v) => /^(1|true|yes|on)$/i.test(v.trim())),
    /** 32 random bytes, base64 (openssl rand -base64 32): encrypts student files at rest (AES-256-GCM). */
    STUDENT_DOC_ENC_KEY: z.string().optional(),
    /** Names the key in stored records, so it can be rotated later. */
    STUDENT_DOC_ENC_KID: z.string().regex(/^[\w.-]{1,32}$/).default("k1"),
    /** HMAC secret for the 10-minute signed links crm-api fetches attached files through. */
    DOCUMENT_URL_SECRET: z.string().min(32).optional(),
    /** Edge API origin as crm-api reaches it (its host must be in crm-api's MCP_DOCUMENT_FETCH_HOSTS). */
    PUBLIC_BASE_URL: z.string().url().optional(),
    /** Largest student document accepted (the CRM's own limit is 10 MB). */
    STUDENT_DOC_MAX_BYTES: z.coerce.number().int().min(100_000).max(10_485_760).default(10_485_760),
    /**
     * Direct-to-S3 upload (src/documents/student/direct-upload.ts): the browser posts the file to
     * this bucket instead of through the ALB, whose WAF body rules block binary scans. Unset = only
     * the multipart route (local development). The pod's IRSA role needs put/get/delete under the prefix.
     */
    STUDENT_DOC_S3_BUCKET: z.string().optional(),
    STUDENT_DOC_S3_REGION: z.string().default("ap-southeast-2"),
    STUDENT_DOC_S3_PREFIX: z.string().regex(/^[\w.\-/]{1,64}$/).default("incoming/"),
    /** One extraction call per attached file (inline bytes, JSON schema, temperature 0). */
    GEMINI_DOC_MODEL: z.string().default("gemini-3.6-flash"),
  })
  .transform((e) => ({
    ...e,
    LANGFUSE_BASE_URL: e.LANGFUSE_BASE_URL ?? e.LANGFUSE_HOST ?? "https://cloud.langfuse.com",
    LANGFUSE_ENABLED: Boolean(e.LANGFUSE_PUBLIC_KEY && e.LANGFUSE_SECRET_KEY),
    GOOGLE_LOGIN_ENABLED: Boolean(e.GOOGLE_OAUTH_CLIENT_ID && e.SESSION_SECRET),
    USER_AUTH_ENABLED: Boolean(e.SUPABASE_URL) || Boolean(e.GOOGLE_OAUTH_CLIENT_ID && e.SESSION_SECRET),
    CRM_ENABLED: Boolean(e.CRM_MCP_URL && e.CRM_EXCHANGE_SECRET && e.CRM_TENANT_ORIGIN),
    GOOGLE_WORKSPACE_ENABLED: Boolean(e.GOOGLE_WORKSPACE_CLIENT_ID && e.GOOGLE_WORKSPACE_CLIENT_SECRET && e.GOOGLE_WORKSPACE_REDIRECT_URI && e.GOOGLE_TOKEN_ENC_KEY),
    STUDENT_DOCS_ACTIVE: Boolean(e.STUDENT_DOCS_ENABLED && e.STUDENT_DOC_ENC_KEY && e.DOCUMENT_URL_SECRET && e.PUBLIC_BASE_URL),
    IS_PROD: e.NODE_ENV === "production",
  }))
  .superRefine((e, ctx) => {
    if (e.IS_PROD && !e.API_KEY && !e.USER_AUTH_ENABLED) {
      ctx.addIssue({ code: "custom", path: ["API_KEY"], message: "API_KEY, GOOGLE_OAUTH_CLIENT_ID+SESSION_SECRET, or SUPABASE_URL is required in production" });
    }
    if (e.IS_PROD && e.CRM_DEMO) {
      ctx.addIssue({ code: "custom", path: ["CRM_DEMO"], message: "CRM_DEMO serves made-up students and must never be on in production" });
    }
    if (e.GOOGLE_OAUTH_CLIENT_ID && !e.SESSION_SECRET) {
      ctx.addIssue({ code: "custom", path: ["SESSION_SECRET"], message: "SESSION_SECRET is required when GOOGLE_OAUTH_CLIENT_ID is set" });
    }
    // Fail loudly at boot rather than leaving CRM tools mysteriously absent: a half-set
    // CRM config is always a mistake, and the failure would otherwise be a silent no-op.
    if (e.CRM_MCP_URL && !e.CRM_EXCHANGE_SECRET) {
      ctx.addIssue({ code: "custom", path: ["CRM_EXCHANGE_SECRET"], message: "CRM_EXCHANGE_SECRET is required when CRM_MCP_URL is set" });
    }
    // Reusing the session secret would let either side mint the other's tokens.
    if (e.CRM_EXCHANGE_SECRET && e.SESSION_SECRET && e.CRM_EXCHANGE_SECRET === e.SESSION_SECRET) {
      ctx.addIssue({ code: "custom", path: ["CRM_EXCHANGE_SECRET"], message: "CRM_EXCHANGE_SECRET must differ from SESSION_SECRET" });
    }
    if (e.CRM_MCP_URL && !e.CRM_TENANT_ORIGIN) {
      ctx.addIssue({ code: "custom", path: ["CRM_TENANT_ORIGIN"], message: "CRM_TENANT_ORIGIN is required when CRM_MCP_URL is set (crm-api rejects requests without an Origin header)" });
    }
    // A half-set Google Workspace config is always a mistake; say which piece is missing.
    const workspace = { GOOGLE_WORKSPACE_CLIENT_ID: e.GOOGLE_WORKSPACE_CLIENT_ID, GOOGLE_WORKSPACE_CLIENT_SECRET: e.GOOGLE_WORKSPACE_CLIENT_SECRET, GOOGLE_WORKSPACE_REDIRECT_URI: e.GOOGLE_WORKSPACE_REDIRECT_URI, GOOGLE_TOKEN_ENC_KEY: e.GOOGLE_TOKEN_ENC_KEY };
    if (Object.values(workspace).some(Boolean)) {
      for (const [key, value] of Object.entries(workspace)) {
        if (!value) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when any GOOGLE_WORKSPACE_* setting is set` });
      }
    }
    if (e.GOOGLE_TOKEN_ENC_KEY) {
      if (Buffer.from(e.GOOGLE_TOKEN_ENC_KEY.replace(/-/g, "+").replace(/_/g, "/"), "base64").length !== 32) {
        ctx.addIssue({ code: "custom", path: ["GOOGLE_TOKEN_ENC_KEY"], message: "GOOGLE_TOKEN_ENC_KEY must be 32 bytes, base64 (openssl rand -base64 32)" });
      }
      if (e.GOOGLE_TOKEN_ENC_KEY === e.SESSION_SECRET) {
        ctx.addIssue({ code: "custom", path: ["GOOGLE_TOKEN_ENC_KEY"], message: "GOOGLE_TOKEN_ENC_KEY must differ from SESSION_SECRET" });
      }
    }
    for (const [i, prev] of e.GOOGLE_TOKEN_ENC_PREVIOUS_KEYS.entries()) {
      if (!prev.kid || prev.kid === e.GOOGLE_TOKEN_ENC_KID || Buffer.from(prev.key.replace(/-/g, "+").replace(/_/g, "/"), "base64").length !== 32) {
        ctx.addIssue({ code: "custom", path: ["GOOGLE_TOKEN_ENC_PREVIOUS_KEYS", i], message: "each previous key is kid=<32 bytes base64>, with a kid other than GOOGLE_TOKEN_ENC_KID" });
      }
    }
    if (e.IS_PROD && e.GOOGLE_WORKSPACE_REDIRECT_URI && !e.GOOGLE_WORKSPACE_REDIRECT_URI.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["GOOGLE_WORKSPACE_REDIRECT_URI"], message: "GOOGLE_WORKSPACE_REDIRECT_URI must be https in production" });
    }
    // A model setting that cannot be served must stop the boot, not surface as a failed first answer.
    for (const key of ["ANSWER_MODEL", "RESEARCH_MODEL"] as const) {
      const spec = e[key];
      if (!spec) continue;
      try {
        if (parseModelSpec(spec).provider === "openrouter" && !e.OPENROUTER_API_KEY) {
          ctx.addIssue({ code: "custom", path: ["OPENROUTER_API_KEY"], message: `OPENROUTER_API_KEY is required when ${key} is an openrouter: model` });
        }
      } catch (err) {
        ctx.addIssue({ code: "custom", path: [key], message: (err as Error).message });
      }
    }
    // Student documents: switched on with a missing piece is a mistake, so say which one.
    if (e.STUDENT_DOCS_ENABLED) {
      for (const key of ["STUDENT_DOC_ENC_KEY", "DOCUMENT_URL_SECRET", "PUBLIC_BASE_URL"] as const) {
        if (!e[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when STUDENT_DOCS_ENABLED is true` });
      }
    }
    if (e.STUDENT_DOC_ENC_KEY) {
      if (Buffer.from(e.STUDENT_DOC_ENC_KEY.replace(/-/g, "+").replace(/_/g, "/"), "base64").length !== 32) {
        ctx.addIssue({ code: "custom", path: ["STUDENT_DOC_ENC_KEY"], message: "STUDENT_DOC_ENC_KEY must be 32 bytes, base64 (openssl rand -base64 32)" });
      }
      if (e.STUDENT_DOC_ENC_KEY === e.SESSION_SECRET || e.STUDENT_DOC_ENC_KEY === e.GOOGLE_TOKEN_ENC_KEY) {
        ctx.addIssue({ code: "custom", path: ["STUDENT_DOC_ENC_KEY"], message: "STUDENT_DOC_ENC_KEY must be its own key (not SESSION_SECRET or GOOGLE_TOKEN_ENC_KEY)" });
      }
    }
    if (e.DOCUMENT_URL_SECRET && (e.DOCUMENT_URL_SECRET === e.SESSION_SECRET || e.DOCUMENT_URL_SECRET === e.CRM_EXCHANGE_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["DOCUMENT_URL_SECRET"], message: "DOCUMENT_URL_SECRET must differ from SESSION_SECRET and CRM_EXCHANGE_SECRET" });
    }
    if (e.PUBLIC_BASE_URL) {
      if (e.IS_PROD && !e.PUBLIC_BASE_URL.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["PUBLIC_BASE_URL"], message: "PUBLIC_BASE_URL must be https in production (crm-api only fetches https links)" });
      // crm-api's audit log cuts string arguments at 200 characters; "/v1/files/<uuid>?exp=<10>&sig=<64>" is 117.
      if (e.PUBLIC_BASE_URL.replace(/\/+$/, "").length > 80) ctx.addIssue({ code: "custom", path: ["PUBLIC_BASE_URL"], message: "PUBLIC_BASE_URL must be at most 80 characters so signed file links stay under 200" });
    }
  });

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // Kubernetes secrets often carry "" for unset optional keys; treat empty as absent.
  const cleaned: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && v.trim() !== "") cleaned[k] = v;
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error("Invalid environment configuration:\n" + z.prettifyError(parsed.error));
  }
  return parsed.data;
}

/** The classifier's per-turn budget (src/graph/nodes.ts); past it the turn researches with the fallback intent. */
export const CLASSIFY_TIMEOUT_MS = 15_000;

/**
 * Why REQUEST_TIMEOUT_MS is too short for a turn's worst case (classify + research + answer, on
 * the normal path and on the DeepThink path), else null. A request cut first loses the answer the
 * answer timeout was raised to allow, so the server warns at boot rather than leaving it to a
 * consultant's empty reply.
 */
export function timeoutBudgetWarning(e: Pick<Env, "REQUEST_TIMEOUT_MS" | "RESEARCH_BUDGET_MS" | "ANSWER_TIMEOUT_MS" | "DEEP_THINK_TIMEOUT_MS">): string | null {
  const warnings = (
    [
      ["ANSWER_TIMEOUT_MS", e.ANSWER_TIMEOUT_MS, "answer timeout"],
      ["DEEP_THINK_TIMEOUT_MS", e.DEEP_THINK_TIMEOUT_MS, "DeepThink answer timeout"],
    ] as const
  ).flatMap(([name, ms, what]) => {
    const total = CLASSIFY_TIMEOUT_MS + e.RESEARCH_BUDGET_MS + ms;
    if (e.REQUEST_TIMEOUT_MS > total) return [];
    return [`REQUEST_TIMEOUT_MS (${e.REQUEST_TIMEOUT_MS} ms) does not exceed classify + RESEARCH_BUDGET_MS + ${name} (${CLASSIFY_TIMEOUT_MS} + ${e.RESEARCH_BUDGET_MS} + ${ms} = ${total} ms): a slow turn is cut by the request deadline before its ${what}; raise REQUEST_TIMEOUT_MS above ${total}`];
  });
  return warnings.length ? warnings.join("; ") : null;
}

/** SIGTERM's drain budget: SHUTDOWN_DRAIN_MS, else the request deadline plus 5 s. */
export function shutdownDrainMs(e: Pick<Env, "SHUTDOWN_DRAIN_MS" | "REQUEST_TIMEOUT_MS">): number {
  return e.SHUTDOWN_DRAIN_MS ?? e.REQUEST_TIMEOUT_MS + 5_000;
}

/** Why the drain would cut answers the request deadline still allows, else null. */
export function shutdownDrainWarning(e: Pick<Env, "SHUTDOWN_DRAIN_MS" | "REQUEST_TIMEOUT_MS">): string | null {
  const drain = shutdownDrainMs(e);
  if (drain >= e.REQUEST_TIMEOUT_MS) return null;
  return `SHUTDOWN_DRAIN_MS (${drain} ms) is shorter than REQUEST_TIMEOUT_MS (${e.REQUEST_TIMEOUT_MS} ms): a rollout cuts answers still within their deadline; raise it (and the pod's terminationGracePeriodSeconds) or unset it`;
}

let cached: Env | undefined;
/** Lazily parsed process environment (so tests can construct their own). */
export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test helper: override the cached env. */
export function __setEnvForTests(env: Env | undefined) {
  cached = env;
}
