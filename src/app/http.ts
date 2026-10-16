import { z } from "zod";
import { CLIENT_EVENT_TYPE } from "../activity/events";
import { PartnerRecordSchema } from "../partners/registry";
import { SOURCE_KINDS } from "../retrieval/store";
import { DESTINATIONS } from "../schemas/intent.schema";
import { STEP_STATUSES } from "../journey/guide";
import { JOURNEY_STEP_KEYS } from "../journey/steps";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

export function json(body: unknown, init: ResponseInit & { requestId?: string } = {}): Response {
  const headers = new Headers(init.headers as Record<string, string> | undefined);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  if (init.requestId) headers.set("x-request-id", init.requestId);
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(err: unknown, requestId: string, exposeInternal = false): Response {
  if (err instanceof ApiError) {
    return json({ error: { code: err.code, message: err.message, details: err.details, requestId } }, { status: err.status, requestId });
  }
  if (err instanceof z.ZodError) {
    return json(
      { error: { code: "validation_error", message: "Invalid request", details: z.treeifyError(err), requestId } },
      { status: 400, requestId },
    );
  }
  const isAbort = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
  if (isAbort) {
    return json({ error: { code: "timeout", message: "The request took too long and was cancelled", requestId } }, { status: 504, requestId });
  }
  const message = exposeInternal && err instanceof Error ? err.message : "Internal server error";
  return json({ error: { code: "internal_error", message, requestId } }, { status: 500, requestId });
}

/** Parse and validate a JSON body with a size cap. */
export async function readJson<T>(req: Request, schema: z.ZodType<T>, maxBytes = 64 * 1024): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new ApiError(413, "payload_too_large", `Body exceeds ${maxBytes} bytes`);
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError(413, "payload_too_large", `Body exceeds ${maxBytes} bytes`);
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "invalid_json", "Body must be valid JSON");
  }
  return schema.parse(raw);
}

export function getRequestId(req: Request): string {
  const provided = req.headers.get("x-request-id");
  return provided && /^[\w.-]{8,128}$/.test(provided) ? provided : crypto.randomUUID();
}

export function clientIp(req: Request, server?: { requestIP(req: Request): { address: string } | null }): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return server?.requestIP(req)?.address ?? "unknown";
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------
export const ChatRequestSchema = z.object({
  /** User message. Accepts `input` (legacy) or `message`. */
  message: z.string().min(1).max(8_000).optional(),
  input: z.string().min(1).max(8_000).optional(),
  sessionId: z.uuid().optional(),
  /** Start a fresh conversation even if the user has an active session. */
  newSession: z.boolean().optional(),
  /**
   * Answer the newest turn again: with a `sessionId`, the stored last human+assistant pair is
   * removed before this message is answered, so history never keeps both versions.
   */
  regenerate: z.boolean().optional(),
  /** Owner override; honoured only for trusted `x-api-key` callers (see routes). */
  userId: z.string().min(1).max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Staff context/preferences from the frontend. */
  userData: z.record(z.string(), z.unknown()).optional(),
  profile: z.record(z.string(), z.unknown()).optional(),
  /** Accepted for backward compatibility with older clients; ignored. Edge has one persona (consultant assistant). */
  mode: z.string().max(32).optional(),
  /** DeepThink: reason harder on this turn (higher effort, longer answer budget). */
  deepThink: z.boolean().optional(),
  /** Student documents uploaded through POST /v1/chat/attachments; all must be the caller's. */
  attachments: z.array(z.uuid()).max(5).optional(),
}).refine((b) => b.message ?? b.input, { message: "message is required", path: ["message"] });

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** Direct knowledge-base search (no LLM turn). */
export const KnowledgeSearchRequestSchema = z.object({
  query: z.string().min(2).max(1_000),
  k: z.number().int().min(1).max(20).optional(),
  countries: z.array(z.enum(DESTINATIONS)).max(6).optional(),
  docTypes: z.array(z.string().min(1).max(40)).max(10).optional(),
  /** Source ids, e.g. "experteducation.com", "partner:monash.edu", "upload:<slug>". */
  sources: z.array(z.string().regex(/^[\w.:@-]{2,80}$/)).max(20).optional(),
  /** Provenance classes: site | partner | upload | program | official. */
  sourceKinds: z.array(z.enum(SOURCE_KINDS as [string, ...string[]])).max(5).optional(),
});
export type KnowledgeSearchRequest = z.infer<typeof KnowledgeSearchRequestSchema>;

/** Body of PUT /v1/knowledge/partners/:slug (slug comes from the path). */
export const PartnerUpsertSchema = PartnerRecordSchema.omit({ slug: true, updatedAt: true, updatedBy: true, source: true });
export type PartnerUpsertRequest = z.infer<typeof PartnerUpsertSchema>;

export const ListPartnersQuerySchema = z.object({
  country: z.enum(DESTINATIONS).optional(),
  enabled: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

/** Body of POST /v1/knowledge/programs/search (structured program records). */
export const ProgramSearchRequestSchema = z.object({
  q: z.string().max(300).optional(),
  countries: z.array(z.enum(DESTINATIONS)).max(6).optional(),
  universitySlugs: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/)).max(20).optional(),
  university: z.string().max(120).optional(),
  levels: z.array(z.string().max(40)).max(6).optional(),
  disciplines: z.array(z.string().max(80)).max(6).optional(),
  intake: z.string().max(40).optional(),
  maxTuition: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  maxIeltsOverall: z.number().min(0).max(9).optional(),
  hasScholarships: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).max(5_000).optional(),
});
export type ProgramSearchRequest = z.infer<typeof ProgramSearchRequestSchema>;

/** Non-file field of the multipart POST /v1/chat/attachments. */
export const ChatAttachmentFieldsSchema = z.object({ sessionId: z.uuid().optional() });

/** Direct upload, step 1 (docs/document-intake/contract.md §1a). */
export const DirectUploadStartSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(100),
  sizeBytes: z.number().int().positive(),
  sessionId: z.uuid().optional(),
});
export const DirectUploadCompleteSchema = z.object({ ticket: z.string().min(20).max(4096) });

/** Non-file fields of the multipart POST /v1/knowledge/documents. */
export const DocumentUploadFieldsSchema = z.object({
  title: z.string().max(200).optional(),
  partnerSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/).optional(),
  country: z.enum(DESTINATIONS).optional(),
  docType: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  extractPrograms: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

export const ListDocumentsQuerySchema = z.object({
  status: z.enum(["processing", "ready", "failed"]).optional(),
  partnerSlug: z.string().max(80).optional(),
  /** "true" → only the caller's uploads. */
  mine: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Body of POST /v1/knowledge/reindex. */
export const ReindexRequestSchema = z.object({
  /** "all" | "site" | "partners" | "guides" | "official" | "partner:<slug>" */
  scope: z.string().regex(/^(all|site|partners|guides|official|partner:[a-z0-9][a-z0-9-]{1,78}[a-z0-9])$/, "scope must be all, site, partners, guides, official or partner:<slug>"),
  /** Re-embed pages even when their content is unchanged. */
  force: z.boolean().optional(),
});

export const ListSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Body of PATCH /v1/sessions/:id. Both fields optional; an empty body is a no-op, not an error. */
export const UpdateSessionSchema = z.object({
  /** Trimmed first, so a title of only whitespace is rejected rather than stored. */
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
});
export type UpdateSessionRequest = z.infer<typeof UpdateSessionSchema>;

const JourneyStepSchema = z.enum(JOURNEY_STEP_KEYS);
/** A CRM contact id, as crm_search_contacts returns it. */
const GuidedStudentSchema = z.object({ contactId: z.uuid(), step: JourneyStepSchema.optional() });

/** Body of POST /v1/sessions: an empty guided session about one CRM student. */
export const CreateSessionSchema = z.object({ guided: GuidedStudentSchema });

/**
 * Body of PATCH /v1/sessions/:id/guide. `convert` turns a normal chat into a guided one (one
 * way); the rest move the journey. Every field optional; an empty body is a no-op.
 */
export const PatchGuideSchema = z.object({
  convert: GuidedStudentSchema.optional(),
  currentStep: JourneyStepSchema.optional(),
  stepStatus: z.partialRecord(JourneyStepSchema, z.enum(STEP_STATUSES)).optional(),
  dismissSuggestion: z.boolean().optional(),
});

/** Query of GET /v1/crm/contacts (the guided-session student picker). */
export const CrmContactsQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

/** UI events posted by the frontend; stored as `ui.<type>` in the activity log. */
export const ClientEventsSchema = z.object({
  events: z
    .array(
      z.object({
        type: z.string().regex(CLIENT_EVENT_TYPE, "type must be snake_case, 2-49 chars"),
        /** Client clock (ISO 8601); clamped server-side. */
        at: z.iso.datetime({ offset: true }).optional(),
        sessionId: z.uuid().optional(),
        requestId: z.string().min(8).max(128).optional(),
        props: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type ClientEventsRequest = z.infer<typeof ClientEventsSchema>;

/**
 * The counsellor's decision on one CRM write proposal. `edits` (approve only, crm_update_contact
 * only) replaces the "after" value of named change rows; the service validates the keys.
 */
export const CrmWriteDecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    edits: z.record(z.string().regex(/^[A-Za-z][\w]{0,63}$/), z.union([z.string().max(5_000), z.number(), z.boolean(), z.null()])).optional(),
  })
  .strict()
  .refine((b) => !b.edits || Object.keys(b.edits).length <= 50, { message: "too many edits", path: ["edits"] });

export const FeedbackRequestSchema = z.object({
  traceId: z.string().min(8).max(128).optional(),
  requestId: z.string().min(8).max(128).optional(),
  sessionId: z.uuid().optional(),
  /** -1 (bad), 0 (neutral), 1 (good), or any value in [0, 1]. */
  score: z.number().min(-1).max(1),
  comment: z.string().max(2_000).optional(),
});
