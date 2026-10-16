import { capJson } from "../activity/events";
import type { ActivityLog } from "../activity/log";
import type { Env } from "../config/env";
import type { ChatStore } from "../memory/store";
import { recordFeedback } from "../observability/langfuse";
import type { Logger } from "../observability/logger";
import { sourceKindOf, type KnowledgeStore, type SourceKind } from "../retrieval/store";
import type { Collections } from "../db/mongo";
import { PERSONA } from "../config/persona";
import { z } from "zod";
import { AuthError } from "../auth/supabase";
import { verifyGoogleIdToken } from "../auth/google";
import { signSession } from "../auth/session";
import {
  ApiError,
  ChatAttachmentFieldsSchema,
  DirectUploadCompleteSchema,
  DirectUploadStartSchema,
  ChatRequestSchema,
  ClientEventsSchema,
  CrmWriteDecisionSchema,
  CreateSessionSchema,
  CrmContactsQuerySchema,
  DocumentUploadFieldsSchema,
  FeedbackRequestSchema,
  KnowledgeSearchRequestSchema,
  ListDocumentsQuerySchema,
  ListPartnersQuerySchema,
  ListSessionsQuerySchema,
  PartnerUpsertSchema,
  PatchGuideSchema,
  ProgramSearchRequestSchema,
  ReindexRequestSchema,
  UpdateSessionSchema,
  json,
  readJson,
  type ChatRequest,
} from "./http";
import type { PartnerRegistry } from "../partners/registry";
import type { MongoProgramSearch } from "../ingest/programs";
import { DocumentError, type DocumentService } from "../documents/service";
import { DirectUploadError, type DirectUploads } from "../documents/student/direct-upload";
import { StudentDocError, type StudentDocumentService } from "../documents/student/service";
import { CRM_DOCUMENT_TYPES, toAttachmentView, type AttachmentView, type DocumentExtractionView, type StudentDocumentRecord } from "../documents/student/types";
import type { CrmWriteService } from "../crm/approvals/service";
import type { CrmWriteProposalView } from "../crm/approvals/types";
import { createEventStream, pickStreamFormat } from "./sse";
import { ASSISTANT_MODE, actorEmailOf, type ChatService, type IntentSummary, type ReasoningStep } from "./service";
import type { Session } from "../memory/store";
import { stepFieldGaps, studentFields, type CrmStudentReader, type SnapshotResult, type StudentSnapshot } from "../crm/student";
import { applyGuidePatch, guideView, newGuide } from "../journey/guide";
import { startingSuggestion } from "../journey/suggest";
import { JOURNEY_STEPS, STUDENT_FIELDS, type JourneyStepKey } from "../journey/steps";
import type { ThoughtSegment } from "../tools/types";
import { toExcerpt, type Source } from "../retrieval/format";
import { normalizeUserInput } from "../safety/sanitize";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export interface RequestContext {
  requestId: string;
  /** Scope for chat sessions: signed-in user's email, X-User-Id, or "anonymous". */
  ownerId: string;
  /** How the caller authenticated. */
  auth: "api_key" | "session" | "none";
  user: AuthenticatedUser | null;
  signal: AbortSignal;
  /** Route-specific facts for the request's activity event (handlers add; the guard records). */
  details: Record<string, unknown>;
}

export interface RouteDeps {
  env: Env;
  service: ChatService;
  store: ChatStore;
  knowledge: KnowledgeStore;
  collections: Collections | null;
  logger: Logger;
  readiness: () => Promise<{ ok: boolean; checks: Record<string, unknown> }>;
  startedAt: number;
  /** Durable activity log; optional so tests can run without it. */
  activity?: ActivityLog;
  /** Partner-university registry (admin CRUD). Optional: routes answer 503 without it. */
  partners?: PartnerRegistry;
  /** Structured program records (`kb_programs`). Optional: route answers 503 without it. */
  programs?: Pick<MongoProgramSearch, "query">;
  /** Staff document uploads. Optional: routes answer 503 without it. */
  documents?: DocumentService;
  /** CRM write approval. Optional: the decision route answers 503 without it. */
  crmWrites?: CrmWriteService;
  /** CRM student reads for guided sessions. Optional: guided routes answer 503 without it. */
  students?: CrmStudentReader;
  /** Student documents attached in chat (STUDENT_DOCS_ENABLED). Optional: attachment routes answer 503 without it. */
  studentDocs?: StudentDocumentService;
  /** Browser → S3 → Edge uploads (STUDENT_DOC_S3_BUCKET). Optional: those routes answer 503 without it. */
  directUploads?: DirectUploads;
}

/** A session as the API returns it: the guide normalised (every step listed), never raw. */
function sessionView(s: Session) {
  const { guide, ...rest } = s;
  return { ...rest, pinned: s.pinned ?? false, guided: Boolean(guide), guide: guide ? guideView(guide) : null };
}

/** True when the caller may administer the knowledge base (see `requireAdmin`). */
export function isAdmin(ctx: RequestContext, env: Pick<Env, "ADMIN_EMAILS">): boolean {
  try {
    requireAdmin(ctx, env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Knowledge-base administration (partners, reindex, deleting others' uploads).
 * A trusted server calling for itself (x-api-key, no x-user-id) is always an
 * admin. Anyone acting as a person — a signed-in session, or x-api-key plus
 * x-user-id — is an admin when ADMIN_EMAILS is empty (internal single-tenant
 * tool) or lists that identity.
 */
export function requireAdmin(ctx: RequestContext, env: Pick<Env, "ADMIN_EMAILS">): void {
  if (ctx.auth === "api_key" && ctx.ownerId === "anonymous") return;
  if (ctx.ownerId === "anonymous") throw new ApiError(401, "unauthorized", "Sign in to manage the knowledge base");
  if (env.ADMIN_EMAILS.length && !env.ADMIN_EMAILS.includes(ctx.ownerId.toLowerCase())) {
    throw new ApiError(403, "forbidden", "Your account is not allowed to manage the knowledge base");
  }
}

/**
 * Who owns the conversation. A trusted server (`x-api-key`) may act on behalf of
 * any user via `userId`; a signed-in browser session is always itself.
 */
function resolveOwner(ctx: RequestContext, body: ChatRequest): string {
  return ctx.auth === "api_key" && body.userId ? body.userId : ctx.ownerId;
}

/** FormData value → trimmed string or undefined (files and empty strings are ignored). */
function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

/** Attachment ids stored on a human message. */
function messageAttachmentIds(metadata: Record<string, unknown> | undefined): string[] {
  const raw = metadata?.attachments;
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
}

/** What was read from a turn's attachments, as streamed; empty on turns without any. */
function messageDocuments(metadata: Record<string, unknown> | undefined): DocumentExtractionView[] {
  const raw = metadata?.documents;
  return Array.isArray(raw) ? raw.filter((d): d is DocumentExtractionView => typeof d === "object" && d !== null && typeof (d as DocumentExtractionView).attachmentId === "string") : [];
}

/** `inline; filename=…` with a plain-ASCII fallback and the UTF-8 name. */
function inlineDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Message metadata as persisted by ChatService; older rows stored only source URLs. */
function messageSources(metadata: Record<string, unknown> | undefined): Source[] {
  const raw = metadata?.sources;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is Source => typeof s === "object" && s !== null && typeof (s as Source).url === "string");
}

/** Reasoning trace as persisted by ChatService; undefined on turns recorded before it was stored. */
function messageReasoning(metadata: Record<string, unknown> | undefined): ReasoningStep[] | undefined {
  const raw = metadata?.reasoning;
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((s): s is ReasoningStep => typeof s === "object" && s !== null && typeof (s as ReasoningStep).key === "string");
}

/** Reasoning timeline as persisted by ChatService; undefined on turns recorded before it was stored. */
function messageThoughts(metadata: Record<string, unknown> | undefined): ThoughtSegment[] | undefined {
  const raw = metadata?.thoughts;
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((s): s is ThoughtSegment => typeof s === "object" && s !== null && typeof (s as ThoughtSegment).text === "string" && typeof (s as ThoughtSegment).at === "number");
}

/** Turn latency as persisted with the answer. Not reconstructable client-side: tool calls overlap. */
function messageLatencyMs(metadata: Record<string, unknown> | undefined): number | undefined {
  const raw = metadata?.latencyMs;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/** Follow-up suggestions stored by `finishTurn`; empty on turns recorded before them. */
function messageFollowUps(metadata: Record<string, unknown> | undefined): string[] {
  const raw = metadata?.followUps;
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
}

/** The full classified intent (task, confidence, flags…) as stored with the answer; null for turns that predate it. */
function messageIntentDetail(metadata: Record<string, unknown> | undefined): IntentSummary | null {
  const raw = metadata?.intent;
  return raw && typeof raw === "object" && typeof (raw as IntentSummary).primary === "string" ? (raw as IntentSummary) : null;
}

/** Decrypted bytes, never cached or sniffed by the browser. */
function fileResponse(record: StudentDocumentRecord, bytes: Uint8Array, requestId: string): Response {
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "content-type": record.mimeType,
      "content-length": String(bytes.length),
      "content-disposition": inlineDisposition(record.fileName),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}

export function createRoutes(d: RouteDeps) {
  const version = d.env.APP_RELEASE ?? "dev";

  /** Guided sessions need the CRM and a consultant it can act as. */
  const guidedDeps = (ctx: RequestContext) => {
    if (!d.students) throw new ApiError(503, "crm_unavailable", "Guided sessions need the CRM, which is not configured");
    const actor = actorEmailOf(ctx.ownerId);
    if (!actor) throw new ApiError(400, "no_identity", "Guided sessions need a signed-in consultant");
    return { students: d.students, actor };
  };
  /**
   * A new journey. Without an explicit starting step it begins at Enquiry, carrying Edge's
   * suggestion of where the CRM says the student already is; the consultant takes it or not.
   */
  const guideFor = (contactId: string, step: JourneyStepKey | undefined, snapshot: StudentSnapshot) => {
    const guide = newGuide(contactId, step);
    if (!step) guide.suggestion = startingSuggestion(snapshot);
    return guide;
  };
  const requireStudent = (res: SnapshotResult) => {
    if (res.ok) return res;
    if (res.reason === "not_visible") throw new ApiError(404, "contact_not_found", "That student is not visible to you in the CRM");
    throw new ApiError(503, "crm_unavailable", res.message);
  };
  let statusCache: { at: number; value: Record<string, unknown> } | null = null;

  const ownAttachment = async (ctx: RequestContext, id: string) => {
    const docs = requireStudentDocs();
    if (ctx.ownerId === "anonymous") throw new ApiError(401, "unauthorized", "Sign in to read attachments");
    const record = await docs.getOwned(id, ctx.ownerId, { admin: isDocumentAdmin(ctx) });
    if (!record) throw new ApiError(404, "attachment_not_found", "Attachment not found");
    return record;
  };
  const requireStudentDocs = () => {
    if (!d.studentDocs) throw new ApiError(503, "documents_disabled", "Student document intake is not enabled");
    return d.studentDocs;
  };
  /**
   * Only an explicitly listed admin may read another counsellor's student documents: unlike the
   * knowledge base, an empty ADMIN_EMAILS makes nobody an admin here.
   */
  const isDocumentAdmin = (ctx: RequestContext) => d.env.ADMIN_EMAILS.length > 0 && d.env.ADMIN_EMAILS.includes(ctx.ownerId.toLowerCase());
  /** Every attachment id of a chat request must be the caller's own upload, or the request is a 400. */
  const checkAttachments = async (body: ChatRequest, owner: string): Promise<string[] | undefined> => {
    const ids = [...new Set(body.attachments ?? [])];
    if (!ids.length) return undefined;
    const docs = requireStudentDocs();
    if (owner === "anonymous") throw new ApiError(400, "invalid_attachments", "Attachments need a signed-in counsellor");
    const owned = await docs.ownedMany(ids, owner);
    if (owned.length !== ids.length) throw new ApiError(400, "invalid_attachments", "One or more attachments do not exist or are not yours");
    return ids;
  };

  return {
    async chat(req: Request, ctx: RequestContext): Promise<Response> {
      const body = await readJson(req, ChatRequestSchema);
      const attachments = await checkAttachments(body, resolveOwner(ctx, body));
      if (attachments) ctx.details.attachments = attachments.length;
      const result = await d.service.chat({
        ...(attachments ? { attachments } : {}),
        message: (body.message ?? body.input)!,
        sessionId: body.sessionId,
        ownerId: resolveOwner(ctx, body),
        requestId: ctx.requestId,
        route: "/v1/chat",
        signal: ctx.signal,
        metadata: body.metadata,
        profile: body.userData ?? body.profile,
        newSession: body.newSession,
        deepThink: body.deepThink,
        regenerate: body.regenerate,
        auth: ctx.auth,
      });
      Object.assign(ctx.details, { sessionId: result.sessionId, intent: result.intent?.primary ?? null, refused: result.refused });
      // No stream to push them down, so the title and follow-ups ride in the response instead.
      const extras = await d.service.finishTurn(result, { ownerId: resolveOwner(ctx, body), message: (body.message ?? body.input)!, signal: ctx.signal });
      return json(
        {
          // `result` mirrors the legacy field name so existing clients keep working.
          result: result.answer,
          answer: result.answer,
          title: extras.title,
          followUps: extras.followUps,
          guide: extras.guide ?? null,
          sessionId: result.sessionId,
          requestId: result.requestId,
          traceId: result.traceId,
          mode: result.mode,
          refused: result.refused,
          intent: result.intent,
          sources: result.sources,
          research: result.research,
          disclaimer: result.disclaimer,
          latencyMs: result.latencyMs,
          truncated: result.truncated,
          // What was read from the attachments (also streamed as `document_extraction` events).
          documents: result.documents,
          assistant: PERSONA.name,
        },
        { requestId: ctx.requestId },
      );
    },

    async chatStream(req: Request, ctx: RequestContext): Promise<Response> {
      const body = await readJson(req, ChatRequestSchema);
      // Checked before the stream opens, so a foreign or unknown attachment is a plain 400.
      const attachments = await checkAttachments(body, resolveOwner(ctx, body));
      Object.assign(ctx.details, { sessionId: body.sessionId ?? null, newSession: Boolean(body.newSession), ...(attachments ? { attachments: attachments.length } : {}) });
      const sse = createEventStream({ requestId: ctx.requestId, signal: ctx.signal, format: pickStreamFormat(req) });
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      ctx.signal.addEventListener("abort", onAbort, { once: true });

      // Run the turn in the background and stream events as they happen.
      void (async () => {
        try {
          sse.send("meta", { requestId: ctx.requestId, assistant: PERSONA.name, mode: ASSISTANT_MODE });
          const result = await d.service.chat({
            ...(attachments ? { attachments } : {}),
            message: (body.message ?? body.input)!,
            sessionId: body.sessionId,
            ownerId: resolveOwner(ctx, body),
            requestId: ctx.requestId,
            route: "/v1/chat/stream",
            signal: controller.signal,
            metadata: body.metadata,
            profile: body.userData ?? body.profile,
            newSession: body.newSession,
            deepThink: body.deepThink,
            regenerate: body.regenerate,
            auth: ctx.auth,
            onIntent: (intent) => sse.send("intent", intent),
            onStatus: (status) => sse.send("status", status),
            onTool: (event) => sse.send("tool", event),
            // One card per CRM write the model proposed. Nothing was written; POST a decision.
            onCrmWriteProposal: (view) => sse.send("crm_write_proposal", view),
            // One per attached document, after it was read and before any proposal card.
            onDocumentExtraction: (view) => sse.send("document_extraction", view),
            onToken: (token) => sse.send("token", { chunk: token }),
            // Incremental fragments of the model's reasoning, concatenated by the client
            // exactly like `token`, in order with the `tool` events. Stored with the answer
            // (history returns them as `thoughts`); the `done` payload carries no copy.
            onThinking: (chunk) => sse.send("thinking", { chunk }),
          });
          if (result.refused) sse.send("token", { chunk: result.answer });
          sse.send("done", {
            sessionId: result.sessionId,
            requestId: result.requestId,
            traceId: result.traceId,
            mode: result.mode,
            answer: result.answer,
            refused: result.refused,
            intent: result.intent,
            sources: result.sources,
            research: result.research,
            disclaimer: result.disclaimer,
            latencyMs: result.latencyMs,
            truncated: result.truncated,
            // Always present for shape stability; the real items follow as a `suggestions` event.
            followUps: [],
          });
          // After `done`, so the consultant is reading while the cheap calls run: the client
          // treats `done` as the end of the answer and keeps draining for these two.
          await d.service.finishTurn(result, {
            ownerId: resolveOwner(ctx, body),
            message: (body.message ?? body.input)!,
            signal: controller.signal,
            onSession: (s) => sse.send("session", s),
            onSuggestions: (s) => sse.send("suggestions", s),
            onGuide: (g) => sse.send("guide", g),
          });
        } catch (err) {
          d.logger.error("stream failed", { requestId: ctx.requestId, err });
          const aborted = controller.signal.aborted;
          sse.send("error", {
            code: aborted ? "cancelled" : "internal_error",
            message: aborted ? "Request cancelled" : "Something went wrong while answering. Please try again.",
            requestId: ctx.requestId,
          });
        } finally {
          ctx.signal.removeEventListener("abort", onAbort);
          sse.close();
        }
      })();

      return sse.response;
    },

    // --- Student documents (docs/document-intake/contract.md §1) -------------------
    // Encrypted at rest, never indexed into the knowledge base, never deleted; another owner's id is a 404.

    /** Multipart `file` (+ optional `sessionId`): store a student document for a later chat turn. */
    async uploadAttachment(req: Request, ctx: RequestContext): Promise<Response> {
      const docs = requireStudentDocs();
      if (ctx.ownerId === "anonymous") throw new ApiError(401, "unauthorized", "Sign in to attach documents");
      const max = docs.maxBytes;
      const declared = Number(req.headers.get("content-length") ?? "0");
      if (declared > max + 64 * 1024) throw new ApiError(413, "payload_too_large", `File exceeds ${Math.round(max / 1024 / 1024)} MB`);
      let form: Awaited<ReturnType<Request["formData"]>>;
      try {
        form = await req.formData();
      } catch {
        throw new ApiError(400, "invalid_multipart", "Body must be multipart/form-data with a `file` part");
      }
      const file = form.get("file");
      if (!(file instanceof Blob)) throw new ApiError(400, "validation_error", "Missing `file` part");
      const { sessionId } = ChatAttachmentFieldsSchema.parse({ sessionId: str(form.get("sessionId")) });
      if (file.size > max) throw new ApiError(413, "payload_too_large", `File exceeds ${Math.round(max / 1024 / 1024)} MB`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const fileName = (file instanceof File && file.name) || "document";
      try {
        const { record, created } = await docs.upload({ ownerId: ctx.ownerId, sessionId: sessionId ?? null, fileName, bytes });
        Object.assign(ctx.details, { attachmentId: record._id, mimeType: record.mimeType, bytes: record.sizeBytes, deduped: !created, ...(sessionId ? { sessionId } : {}) });
        return json({ attachment: toAttachmentView(record) }, { status: 201, requestId: ctx.requestId });
      } catch (err) {
        if (err instanceof StudentDocError) throw new ApiError(err.code === "too_large" ? 413 : err.code === "unsupported_type" ? 415 : 400, err.code, err.message);
        throw err;
      }
    },

    /**
     * Direct upload, step 1: a presigned S3 POST for one file (JSON body, so nothing binary crosses
     * the ALB). The browser posts the file to `url` with `fields`, then calls completeDirectUpload.
     */
    async startDirectUpload(req: Request, ctx: RequestContext): Promise<Response> {
      requireStudentDocs();
      if (!d.directUploads) throw new ApiError(503, "direct_upload_disabled", "Direct upload is not configured; use multipart POST /v1/chat/attachments");
      if (ctx.ownerId === "anonymous") throw new ApiError(401, "unauthorized", "Sign in to attach documents");
      const body = await readJson(req, DirectUploadStartSchema, 4 * 1024);
      try {
        const slot = await d.directUploads.start(ctx.ownerId, body);
        Object.assign(ctx.details, { uploadId: slot.uploadId, mimeType: body.mimeType, bytes: body.sizeBytes });
        return json(slot, { status: 201, requestId: ctx.requestId });
      } catch (err) {
        if (err instanceof DirectUploadError) throw new ApiError(err.code === "too_large" ? 413 : 415, err.code, err.message);
        throw err;
      }
    },

    /** Direct upload, step 2: read the object from S3, store it like a multipart upload, delete the S3 copy. */
    async completeDirectUpload(req: Request, ctx: RequestContext): Promise<Response> {
      const docs = requireStudentDocs();
      if (!d.directUploads) throw new ApiError(503, "direct_upload_disabled", "Direct upload is not configured");
      if (ctx.ownerId === "anonymous") throw new ApiError(401, "unauthorized", "Sign in to attach documents");
      const { ticket } = await readJson(req, DirectUploadCompleteSchema, 8 * 1024);
      let up: Awaited<ReturnType<DirectUploads["complete"]>>;
      try {
        up = await d.directUploads.complete(ctx.ownerId, ticket);
      } catch (err) {
        if (err instanceof DirectUploadError) {
          const status = err.code === "not_uploaded" ? 409 : err.code === "ticket_expired" ? 410 : 400;
          throw new ApiError(status, err.code, err.message);
        }
        throw err;
      }
      try {
        const { record, created } = await docs.upload({ ownerId: ctx.ownerId, sessionId: up.sessionId, fileName: up.fileName, bytes: up.bytes });
        Object.assign(ctx.details, { uploadId: up.uploadId, attachmentId: record._id, mimeType: record.mimeType, bytes: record.sizeBytes, deduped: !created, via: "s3" });
        return json({ attachment: toAttachmentView(record) }, { status: 201, requestId: ctx.requestId });
      } catch (err) {
        if (err instanceof StudentDocError) throw new ApiError(err.code === "too_large" ? 413 : err.code === "unsupported_type" ? 415 : 400, err.code, err.message);
        throw err;
      } finally {
        await d.directUploads.discard(up.key);
      }
    },

    async getAttachment(_req: Request, ctx: RequestContext, id: string): Promise<Response> {
      const record = await ownAttachment(ctx, id);
      ctx.details.attachmentId = id;
      return json({ ...toAttachmentView(record), extractions: record.extractions.map((e) => ({ attachmentId: record._id, fileName: record.fileName, documentType: e.documentType, crmDocumentType: e.documentType === "other" ? null : CRM_DOCUMENT_TYPES[e.documentType].name, country: e.country, holderName: e.holderName, fields: e.fields, warnings: e.warnings, extractedAt: e.at.toISOString(), model: e.model })) }, { requestId: ctx.requestId });
    },

    async getAttachmentContent(_req: Request, ctx: RequestContext, id: string): Promise<Response> {
      const record = await ownAttachment(ctx, id);
      ctx.details.attachmentId = id;
      const bytes = await requireStudentDocs().read(record);
      return fileResponse(record, bytes, ctx.requestId);
    },

    /** The bytes behind a signed link (crm-api fetching a file it was asked to attach). No other auth. */
    async getSignedFile(req: Request, ctx: RequestContext, id: string): Promise<Response> {
      const docs = requireStudentDocs();
      const url = new URL(req.url);
      const r = await docs.readSigned(id, url.searchParams.get("exp"), url.searchParams.get("sig"));
      ctx.details.attachmentId = id;
      if (r.kind !== "ok") {
        if (r.kind === "expired") throw new ApiError(403, "link_expired", "This file link has expired");
        if (r.kind === "invalid") throw new ApiError(403, "invalid_signature", "This file link is not valid");
        throw new ApiError(404, "attachment_not_found", "Attachment not found");
      }
      return fileResponse(r.record, r.bytes, ctx.requestId);
    },

    /** The caller's conversations, most recently active first. */
    async listSessions(req: Request, ctx: RequestContext): Promise<Response> {
      if (ctx.ownerId === "anonymous") throw new ApiError(400, "no_identity", "A user identity (sign-in or x-user-id) is required to list sessions");
      const { limit } = ListSessionsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
      const sessions = await d.store.listSessions(ctx.ownerId, limit);
      ctx.details.count = sessions.length;
      return json(
        {
          sessions: sessions.map((s) => ({
            id: s.id,
            title: s.title,
            pinned: s.pinned ?? false,
            messageCount: s.messageCount,
            createdAt: s.createdAt,
            lastActiveAt: s.lastActiveAt,
            expiresAt: s.expiresAt,
            mode: (s.metadata?.mode as string | undefined) ?? ASSISTANT_MODE,
            guided: Boolean(s.guide),
            currentStep: s.guide?.currentStep ?? null,
          })),
          count: sessions.length,
        },
        { requestId: ctx.requestId },
      );
    },

    async getSession(_req: Request, ctx: RequestContext, sessionId: string): Promise<Response> {
      const session = await d.store.getSession(sessionId, ctx.ownerId);
      if (!session) throw new ApiError(404, "session_not_found", "Session not found");
      const messages = await d.store.getMessages(sessionId, 100);
      Object.assign(ctx.details, { sessionId, count: messages.length });
      const writes: Map<string, CrmWriteProposalView[]> = d.crmWrites ? await d.crmWrites.viewsForSession(sessionId) : new Map();
      const attachmentIds = messages.flatMap((m) => (m.role === "human" ? messageAttachmentIds(m.metadata) : []));
      const attachments: Map<string, AttachmentView> = attachmentIds.length && d.studentDocs ? await d.studentDocs.views(attachmentIds, session.ownerId) : new Map();
      return json(
        {
          session: sessionView(session),
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            intent: m.intent ?? null,
            createdAt: m.createdAt,
            // Assistant turns carry their citations, reasoning trace and turn time so a
            // reopened conversation renders exactly what the live one did.
            sources: m.role === "ai" ? messageSources(m.metadata) : [],
            ...(m.role === "ai"
              ? {
                  reasoning: messageReasoning(m.metadata),
                  thoughts: messageThoughts(m.metadata),
                  deepThink: m.metadata?.deepThink === true || undefined,
                  latencyMs: messageLatencyMs(m.metadata),
                  followUps: messageFollowUps(m.metadata),
                  // A turn the consultant stopped: the text is what they saw, not a finished answer.
                  stopped: Boolean(m.metadata?.stopped),
                  // Cut off mid-stream by the time limit or a model error (the content ends with the note).
                  truncated: m.metadata?.truncated === true || undefined,
                  // The classified request as it was, so a reopened thread shows real confidence and task.
                  intentDetail: messageIntentDetail(m.metadata),
                  // The CRM write cards this turn proposed, with their current status.
                  ...(writes.get(String(m.metadata?.requestId)) ? { crmWrites: writes.get(String(m.metadata?.requestId)) } : {}),
                  guideStep: (m.metadata?.guideStep as string | undefined) ?? null,
                }
              : {}),
            // Human turns list their attachments; assistant turns what was read from them.
            ...(m.role === "human"
              ? { attachments: messageAttachmentIds(m.metadata).map((id) => attachments.get(id)).filter((a): a is AttachmentView => Boolean(a)) }
              : { documents: messageDocuments(m.metadata) }),
            refused: m.role === "ai" ? Boolean(m.metadata?.refused) : false,
            disclaimer: m.role === "ai" ? ((m.metadata?.disclaimer as string | null | undefined) ?? null) : null,
            requestId: (m.metadata?.requestId as string | undefined) ?? null,
            traceId: (m.metadata?.traceId as string | null | undefined) ?? null,
          })),
          count: messages.length,
        },
        { requestId: ctx.requestId },
      );
    },

    /** Direct knowledge-base retrieval (vector + text fusion) with no model call. */
    async knowledgeSearch(req: Request, ctx: RequestContext): Promise<Response> {
      const body = await readJson(req, KnowledgeSearchRequestSchema);
      const text = normalizeUserInput(body.query, 1_000);
      if (text.length < 2) throw new ApiError(400, "validation_error", "query is too short");
      const chunks = await d.knowledge.search(
        {
          text,
          k: body.k ?? 8,
          countries: body.countries?.length ? body.countries : undefined,
          // A destination the consultant picked narrows to that country's own pages; letting the
          // global ones in (as the chat does) filled every slot with generic pages instead.
          includeGlobal: false,
          docTypes: body.docTypes?.length ? body.docTypes : undefined,
          sources: body.sources?.length ? body.sources : undefined,
          sourceKinds: body.sourceKinds?.length ? (body.sourceKinds as SourceKind[]) : undefined,
        },
        { signal: ctx.signal },
      );
      Object.assign(ctx.details, { query: text, results: chunks.length, countries: body.countries ?? null, sources: body.sources ?? null, sourceKinds: body.sourceKinds ?? null });
      return json(
        {
          query: text,
          results: chunks.map((c) => ({
            id: c.id,
            url: c.url,
            title: c.title,
            section: c.section || null,
            docType: c.docType || null,
            country: c.country,
            source: c.source,
            sourceKind: c.sourceKind ?? sourceKindOf(c.source, c.docType),
            score: Math.round(c.score * 10_000) / 10_000,
            matchedBy: c.matchedBy,
            excerpt: toExcerpt(c.content),
          })),
          count: chunks.length,
        },
        { requestId: ctx.requestId },
      );
    },

    /** Partner universities we represent (drives crawling, live-fetch allowlist and "partners in X" answers). */
    async listPartners(req: Request, ctx: RequestContext): Promise<Response> {
      if (!d.partners) throw new ApiError(503, "unavailable", "Partner registry is unavailable");
      const q = ListPartnersQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
      const partners = await d.partners.list({ country: q.country, enabled: q.enabled });
      Object.assign(ctx.details, { count: partners.length, country: q.country ?? null });
      const byCountry: Record<string, number> = {};
      for (const p of partners) byCountry[p.country] = (byCountry[p.country] ?? 0) + 1;
      return json({ partners, count: partners.length, byCountry }, { requestId: ctx.requestId });
    },

    async getPartner(_req: Request, ctx: RequestContext, slug: string): Promise<Response> {
      if (!d.partners) throw new ApiError(503, "unavailable", "Partner registry is unavailable");
      const partner = await d.partners.get(slug);
      if (!partner) throw new ApiError(404, "partner_not_found", "Partner not found");
      ctx.details.slug = slug;
      return json({ partner }, { requestId: ctx.requestId });
    },

    async upsertPartner(req: Request, ctx: RequestContext, slug: string): Promise<Response> {
      if (!d.partners) throw new ApiError(503, "unavailable", "Partner registry is unavailable");
      requireAdmin(ctx, d.env);
      const body = await readJson(req, PartnerUpsertSchema, 32 * 1024);
      const existing = await d.partners.get(slug);
      const partner = await d.partners.upsert({ ...body, slug, source: "admin" }, ctx.ownerId);
      Object.assign(ctx.details, { slug, created: !existing, country: partner.country, enabled: partner.enabled });
      return json({ partner, created: !existing }, { status: existing ? 200 : 201, requestId: ctx.requestId });
    },

    async deletePartner(_req: Request, ctx: RequestContext, slug: string): Promise<Response> {
      if (!d.partners) throw new ApiError(503, "unavailable", "Partner registry is unavailable");
      requireAdmin(ctx, d.env);
      const deleted = await d.partners.remove(slug);
      if (!deleted) throw new ApiError(404, "partner_not_found", "Partner not found");
      ctx.details.slug = slug;
      return json({ deleted: true, slug }, { requestId: ctx.requestId });
    },

    /** Staff document upload (multipart: `file` + optional title/partnerSlug/country/docType/extractPrograms). Indexed asynchronously. */
    async uploadDocument(req: Request, ctx: RequestContext): Promise<Response> {
      if (!d.documents) throw new ApiError(503, "unavailable", "Document uploads are unavailable");
      if (ctx.ownerId === "anonymous") throw new ApiError(400, "no_identity", "A user identity (sign-in or x-user-id) is required to upload documents");
      const max = d.env.UPLOAD_MAX_BYTES;
      const declared = Number(req.headers.get("content-length") ?? "0");
      if (declared > max + 1024 * 1024) throw new ApiError(413, "payload_too_large", `File exceeds ${Math.round(max / 1024 / 1024)} MB`);
      let form: Awaited<ReturnType<Request["formData"]>>;
      try {
        form = await req.formData();
      } catch {
        throw new ApiError(400, "invalid_multipart", "Body must be multipart/form-data with a `file` part");
      }
      const file = form.get("file");
      if (!(file instanceof Blob)) throw new ApiError(400, "validation_error", "Missing `file` part");
      const fields = DocumentUploadFieldsSchema.parse({
        title: str(form.get("title")),
        partnerSlug: str(form.get("partnerSlug")),
        country: str(form.get("country")),
        docType: str(form.get("docType")),
        extractPrograms: str(form.get("extractPrograms")),
      });
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > max) throw new ApiError(413, "payload_too_large", `File exceeds ${Math.round(max / 1024 / 1024)} MB`);
      const filename = (file instanceof File && file.name) || str(form.get("filename")) || "upload";
      try {
        const doc = await d.documents.create({ bytes, filename, mimeType: file.type || null, ownerId: ctx.ownerId, ...fields });
        Object.assign(ctx.details, { documentId: doc._id, kind: doc.kind, bytes: doc.bytes, partnerSlug: doc.partnerSlug, extractPrograms: doc.extractPrograms });
        return json({ document: doc, message: "Accepted; indexing runs in the background — poll GET /v1/knowledge/documents/:id for status" }, { status: 202, requestId: ctx.requestId });
      } catch (err) {
        if (err instanceof DocumentError) {
          const status = err.code === "duplicate" ? 409 : err.code === "unsupported_type" ? 415 : err.code === "too_large" ? 413 : 400;
          throw new ApiError(status, err.code, err.message, err.existingId ? { existingId: err.existingId } : undefined);
        }
        throw err;
      }
    },

    async listDocuments(req: Request, ctx: RequestContext): Promise<Response> {
      if (!d.documents) throw new ApiError(503, "unavailable", "Document uploads are unavailable");
      const q = ListDocumentsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
      const documents = await d.documents.list({ ownerId: q.mine ? ctx.ownerId : undefined, status: q.status, partnerSlug: q.partnerSlug, limit: q.limit });
      ctx.details.count = documents.length;
      return json({ documents, count: documents.length }, { requestId: ctx.requestId });
    },

    async getDocument(_req: Request, ctx: RequestContext, id: string): Promise<Response> {
      if (!d.documents) throw new ApiError(503, "unavailable", "Document uploads are unavailable");
      const document = await d.documents.get(id);
      if (!document) throw new ApiError(404, "document_not_found", "Document not found");
      ctx.details.documentId = id;
      return json({ document }, { requestId: ctx.requestId });
    },

    /** Owners delete their own uploads; admins any. Removes chunks, pages, program records and the file. */
    async deleteDocument(_req: Request, ctx: RequestContext, id: string): Promise<Response> {
      if (!d.documents) throw new ApiError(503, "unavailable", "Document uploads are unavailable");
      const result = await d.documents.remove(id, { ownerId: ctx.ownerId, admin: isAdmin(ctx, d.env) });
      if (result === "not_found") throw new ApiError(404, "document_not_found", "Document not found");
      if (result === "forbidden") throw new ApiError(403, "forbidden", "Only the uploader or an admin can delete this document");
      ctx.details.documentId = id;
      return json({ deleted: true, id }, { requestId: ctx.requestId });
    },

    /** Field-level search over extracted program records (fees, intakes, English cut-offs, scholarships). */
    async programSearch(req: Request, ctx: RequestContext): Promise<Response> {
      if (!d.programs) throw new ApiError(503, "unavailable", "Program records are unavailable");
      const body = await readJson(req, ProgramSearchRequestSchema);
      const { items, total } = await d.programs.query({ ...body, q: body.q ? normalizeUserInput(body.q, 300) : undefined }, { signal: ctx.signal });
      Object.assign(ctx.details, { q: body.q ?? null, results: items.length, total, countries: body.countries ?? null, university: body.university ?? null });
      return json({ filters: body, results: items, count: items.length, total }, { requestId: ctx.requestId });
    },

    /** Queue a re-crawl; the `requests` CronJob drains the queue (crawling never runs inside API pods). */
    async reindex(req: Request, ctx: RequestContext): Promise<Response> {
      if (!d.collections) throw new ApiError(503, "unavailable", "Knowledge-base storage is unavailable");
      requireAdmin(ctx, d.env);
      const body = await readJson(req, ReindexRequestSchema);
      if (body.scope.startsWith("partner:") && d.partners && !(await d.partners.get(body.scope.slice("partner:".length)))) {
        throw new ApiError(404, "partner_not_found", "Partner not found");
      }
      const pending = await d.collections.kbIngestRequests.findOne({ scope: body.scope, status: { $in: ["queued", "running"] } });
      if (pending) {
        Object.assign(ctx.details, { scope: body.scope, requestId: pending._id, duplicate: true });
        return json({ request: pending, queued: false, message: "An identical reindex is already queued or running" }, { status: 200, requestId: ctx.requestId });
      }
      const doc = {
        _id: crypto.randomUUID(),
        scope: body.scope,
        force: Boolean(body.force),
        requestedBy: ctx.ownerId,
        status: "queued" as const,
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
        runId: null,
        error: null,
      };
      await d.collections.kbIngestRequests.insertOne(doc);
      Object.assign(ctx.details, { scope: body.scope, requestId: doc._id, force: doc.force });
      return json({ request: doc, queued: true, message: "Queued; the ingest job picks requests up within ~30 minutes" }, { status: 202, requestId: ctx.requestId });
    },

    /** Knowledge-base freshness and size for ops and the UI (cached 60 s). */
    async knowledgeStatus(_req: Request, ctx: RequestContext): Promise<Response> {
      if (!d.collections) throw new ApiError(503, "unavailable", "Knowledge-base storage is unavailable");
      if (statusCache && Date.now() - statusCache.at < 60_000) return json(statusCache.value, { requestId: ctx.requestId });
      const c = d.collections;
      const [chunksByKind, pagesBySource, runs, queued, partners, chunkCount, pageCount] = await Promise.all([
        c.kbChunks.aggregate<{ _id: string | null; chunks: number }>([{ $group: { _id: "$sourceKind", chunks: { $sum: 1 } } }]).toArray(),
        c.kbPages
          .aggregate<{ _id: string; pages: number; lastCrawled: Date; coursePages: number }>([
            { $group: { _id: "$source", pages: { $sum: 1 }, lastCrawled: { $max: "$lastCrawled" }, coursePages: { $sum: { $cond: [{ $eq: ["$pageKind", "course"] }, 1, 0] } } } },
            { $sort: { pages: -1 } },
            { $limit: 300 },
          ])
          .toArray(),
        c.kbIngestRuns.find({}, { projection: { sources: 0 } }).sort({ startedAt: -1 }).limit(5).toArray(),
        c.kbIngestRequests.countDocuments({ status: { $in: ["queued", "running"] } }),
        d.partners ? d.partners.list() : Promise.resolve([]),
        c.kbChunks.estimatedDocumentCount(),
        c.kbPages.estimatedDocumentCount(),
      ]);
      const byKind: Record<string, number> = {};
      for (const k of chunksByKind) byKind[k._id ?? "unknown"] = k.chunks;
      const lastCrawledByKind: Record<string, string | null> = {};
      for (const p of pagesBySource) {
        const kind = sourceKindOf(p._id);
        const prev = lastCrawledByKind[kind];
        if (!prev || new Date(prev) < p.lastCrawled) lastCrawledByKind[kind] = p.lastCrawled.toISOString();
      }
      const value = {
        chunks: chunkCount,
        pages: pageCount,
        chunksBySourceKind: byKind,
        lastCrawledBySourceKind: lastCrawledByKind,
        sources: pagesBySource.map((p) => ({ source: p._id, pages: p.pages, coursePages: p.coursePages, lastCrawled: p.lastCrawled })),
        partners: { total: partners.length, enabled: partners.filter((p) => p.enabled).length, verified: partners.filter((p) => p.verified).length, withWebsite: partners.filter((p) => p.website).length },
        queuedReindexRequests: queued,
        recentRuns: runs,
        generatedAt: new Date().toISOString(),
      };
      statusCache = { at: Date.now(), value };
      return json(value, { requestId: ctx.requestId });
    },

    /**
     * Rename and/or pin a conversation. Owner-scoped through the store, so another owner's
     * session is a 404 rather than a 403 — the same rule as getSession/deleteSession, which
     * keeps session ids from being enumerable.
     */
    async patchSession(req: Request, ctx: RequestContext, sessionId: string): Promise<Response> {
      const body = await readJson(req, UpdateSessionSchema);
      const session = await d.store.updateSession(sessionId, ctx.ownerId, body);
      if (!session) throw new ApiError(404, "session_not_found", "Session not found");
      Object.assign(ctx.details, { sessionId, renamed: body.title !== undefined, pinned: body.pinned ?? null });
      return json({ session: sessionView(session) }, { requestId: ctx.requestId });
    },

    // --- Guided sessions ----------------------------------------------------------
    // A guided session is about one CRM student. Edge keeps only the contact id and the journey
    // progress; the student's facts are read live from the CRM as the consultant, every time.

    /** The journey steps, so the client renders the rail and checklists from one definition. */
    async journey(_req: Request, ctx: RequestContext): Promise<Response> {
      const steps = JOURNEY_STEPS.map((s) => ({ ...s, crmFields: s.crmFields.map((key) => ({ key, label: STUDENT_FIELDS[key].label })) }));
      return json({ steps }, { requestId: ctx.requestId });
    },

    /** Contacts the consultant may see, for picking the student of a guided session. */
    async crmContacts(req: Request, ctx: RequestContext): Promise<Response> {
      const { students, actor } = guidedDeps(ctx);
      const { q, limit } = CrmContactsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
      let contacts;
      try {
        contacts = await students.searchContacts(actor, q, limit, ctx.signal);
      } catch (err) {
        throw new ApiError(502, "crm_error", `The CRM search failed: ${(err as Error).message}`.slice(0, 300));
      }
      if (!contacts) throw new ApiError(503, "crm_unavailable", "The CRM is not reachable for this consultant");
      ctx.details.count = contacts.length;
      return json({ contacts, count: contacts.length }, { requestId: ctx.requestId });
    },

    /** Start an empty guided session about one CRM student, titled with their name. */
    async createSession(req: Request, ctx: RequestContext): Promise<Response> {
      const { students, actor } = guidedDeps(ctx);
      const { guided } = await readJson(req, CreateSessionSchema);
      const snap = requireStudent(await students.snapshot(actor, guided.contactId, ctx.signal));
      const created = await d.store.getOrCreateSession(undefined, ctx.ownerId);
      const session = await d.store.startGuide(created.id, ctx.ownerId, guideFor(guided.contactId, guided.step, snap.snapshot), { title: snap.snapshot.name.slice(0, 120) });
      if (!session) throw new ApiError(500, "session_create_failed", "The session could not be created");
      Object.assign(ctx.details, { sessionId: session.id, guided: true, step: session.guide?.currentStep });
      return json({ session: sessionView(session) }, { status: 201, requestId: ctx.requestId });
    },

    /** Convert a chat to guided, move the current step, set step statuses or dismiss Edge's suggestion. */
    async patchGuide(req: Request, ctx: RequestContext, sessionId: string): Promise<Response> {
      const body = await readJson(req, PatchGuideSchema);
      let session = await d.store.getSession(sessionId, ctx.ownerId);
      if (!session) throw new ApiError(404, "session_not_found", "Session not found");
      if (body.convert) {
        if (session.guide) throw new ApiError(409, "already_guided", "This session is already a guided session");
        const { students, actor } = guidedDeps(ctx);
        const snap = requireStudent(await students.snapshot(actor, body.convert.contactId, ctx.signal));
        session = await d.store.startGuide(sessionId, ctx.ownerId, guideFor(body.convert.contactId, body.convert.step, snap.snapshot));
        if (!session?.guide) throw new ApiError(404, "session_not_found", "Session not found");
      }
      if (body.currentStep || body.stepStatus || body.dismissSuggestion) {
        if (!session.guide) throw new ApiError(400, "not_guided", "This session is not a guided session; convert it first");
        session = await d.store.setGuide(sessionId, ctx.ownerId, applyGuidePatch(session.guide, body));
        if (!session) throw new ApiError(404, "session_not_found", "Session not found");
      }
      Object.assign(ctx.details, { sessionId, converted: Boolean(body.convert), step: session.guide?.currentStep ?? null });
      return json({ session: sessionView(session) }, { requestId: ctx.requestId });
    },

    /**
     * The guided session's student as the CRM has them right now, with what each step still
     * needs. Read live and never stored; a CRM that cannot be read is reported, not an error.
     */
    async getStudent(_req: Request, ctx: RequestContext, sessionId: string): Promise<Response> {
      const session = await d.store.getSession(sessionId, ctx.ownerId);
      if (!session) throw new ApiError(404, "session_not_found", "Session not found");
      if (!session.guide) throw new ApiError(400, "not_guided", "This session is not a guided session");
      const { students, actor } = guidedDeps(ctx);
      const res = await students.snapshot(actor, session.guide.contactId, ctx.signal);
      ctx.details.sessionId = sessionId;
      if (!res.ok) return json({ contactId: session.guide.contactId, crm: { ok: false, reason: res.reason, message: res.message }, student: null, fields: [], steps: [] }, { requestId: ctx.requestId });
      const s = res.snapshot;
      return json(
        {
          contactId: s.contactId,
          crm: { ok: true, via: s.via, fetchedAt: s.fetchedAt, webUrl: s.webUrl },
          student: { name: s.name, status: s.status, branch: s.branch, assignee: s.assignee, deals: s.deals, applications: s.applications },
          fields: studentFields(s),
          steps: JOURNEY_STEPS.map((step) => ({ key: step.key, ...stepFieldGaps(s, step.key), askStudent: step.askStudent })),
        },
        { requestId: ctx.requestId },
      );
    },

    async deleteSession(_req: Request, ctx: RequestContext, sessionId: string): Promise<Response> {
      const deleted = await d.store.deleteSession(sessionId, ctx.ownerId);
      if (!deleted) throw new ApiError(404, "session_not_found", "Session not found");
      ctx.details.sessionId = sessionId;
      return json({ deleted: true, sessionId }, { requestId: ctx.requestId });
    },

    async feedback(req: Request, ctx: RequestContext): Promise<Response> {
      const body = await readJson(req, FeedbackRequestSchema);
      if (!body.traceId && !body.requestId) throw new ApiError(400, "validation_error", "traceId or requestId is required");
      Object.assign(ctx.details, { targetRequestId: body.requestId ?? null, traceId: body.traceId ?? null, sessionId: body.sessionId ?? null, score: body.score, hasComment: Boolean(body.comment) });
      // Label the recorded turn so exports can filter by user rating.
      if (body.requestId) d.activity?.feedback(body.requestId, { score: body.score, comment: body.comment ?? null, traceId: body.traceId ?? null, at: new Date() });
      let recorded = false;
      if (body.traceId) {
        recorded = await recordFeedback(d.env, { traceId: body.traceId, value: body.score, comment: body.comment });
      }
      if (d.collections) {
        await d.collections.feedback
          .insertOne({
            sessionId: body.sessionId ?? null,
            traceId: body.traceId ?? null,
            requestId: body.requestId ?? null,
            score: body.score,
            comment: body.comment ?? null,
            createdAt: new Date(),
          })
          .catch((err) => d.logger.warn("failed to store feedback", { err }));
      }
      return json({ ok: true, recordedInLangfuse: recorded }, { status: 202, requestId: ctx.requestId });
    },

    /** The counsellor approves or rejects one CRM write proposal. Only an approve writes to the CRM. */
    async crmWriteDecision(req: Request, ctx: RequestContext, proposalId: string): Promise<Response> {
      if (!d.crmWrites) throw new ApiError(503, "crm_writes_disabled", "CRM writes are not enabled");
      const { decision, edits } = await readJson(req, CrmWriteDecisionSchema);
      Object.assign(ctx.details, { proposalId, decision, ...(edits ? { editedFields: Object.keys(edits) } : {}) });
      // Same rule as the chat turn's CRM actor: no email identity, no CRM proposal of theirs.
      if (!ctx.ownerId.includes("@")) throw new ApiError(404, "proposal_not_found", "Proposal not found");
      // No request signal: once claimed, an approved write runs to its end even if the tab closes,
      // so the recorded outcome matches what the CRM did.
      const r = await d.crmWrites.decide({ proposalId, actorEmail: ctx.ownerId, decision, ...(edits ? { edits } : {}) });
      if (r.kind === "not_found") throw new ApiError(404, "proposal_not_found", "Proposal not found");
      if (r.kind === "invalid") throw new ApiError(400, "invalid_edits", r.message);
      ctx.details.status = r.view.status;
      return json(r.view, { status: r.kind === "conflict" ? 409 : 200, requestId: ctx.requestId });
    },

    /** UI events from the frontend (page views, clicks, stream cancels…), stored as `ui.<type>`. */
    async clientEvents(req: Request, ctx: RequestContext): Promise<Response> {
      const body = await readJson(req, ClientEventsSchema, 128 * 1024);
      const now = Date.now();
      let accepted = 0;
      if (d.activity) {
        for (const e of body.events) {
          const at = e.at ? new Date(e.at).getTime() : now;
          // Trust the client clock only within a sane window.
          const clamped = Number.isFinite(at) ? Math.min(Math.max(at, now - 7 * 86_400_000), now + 60_000) : now;
          d.activity.event({
            type: `ui.${e.type}`,
            source: "client",
            at: new Date(clamped),
            requestId: e.requestId ?? null,
            sessionId: e.sessionId ?? null,
            ownerId: ctx.ownerId,
            auth: ctx.auth,
            ip: null,
            userAgent: req.headers.get("user-agent")?.slice(0, 256) ?? null,
            details: capJson(e.props, 4_096),
          });
          accepted++;
        }
      }
      ctx.details.accepted = accepted;
      return json({ accepted }, { status: 202, requestId: ctx.requestId });
    },

    /** "Continue with Google": verify a Google ID token and issue an Edge session token. */
    async googleLogin(req: Request, ctx: RequestContext): Promise<Response> {
      if (!d.env.GOOGLE_LOGIN_ENABLED || !d.env.GOOGLE_OAUTH_CLIENT_ID || !d.env.SESSION_SECRET) {
        throw new ApiError(404, "not_enabled", "Google sign-in is not enabled");
      }
      const { credential } = await readJson(req, z.object({ credential: z.string().min(20).max(4_096) }));
      try {
        const identity = await verifyGoogleIdToken(credential, { clientId: d.env.GOOGLE_OAUTH_CLIENT_ID });
        const ttl = d.env.AUTH_SESSION_TTL_HOURS * 3600;
        const { token, claims } = await signSession(identity, d.env.SESSION_SECRET, ttl);
        d.logger.info("google login", { requestId: ctx.requestId, email: identity.email, domain: identity.domain });
        Object.assign(ctx.details, { email: identity.email, domain: identity.domain, sub: identity.sub });
        return json(
          { token, expiresIn: ttl, expiresAt: new Date(claims.exp * 1000).toISOString(), user: { id: identity.sub, email: identity.email, name: identity.name, picture: identity.picture } },
          { requestId: ctx.requestId },
        );
      } catch (err) {
        if (err instanceof AuthError) {
          ctx.details.code = err.code;
          d.logger.warn("google login rejected", { requestId: ctx.requestId, code: err.code });
          throw new ApiError(401, err.code, err.message);
        }
        throw err;
      }
    },

    /** Student profile/preferences stored per caller (replaces the frontend's Supabase table). */
    async getProfile(_req: Request, ctx: RequestContext): Promise<Response> {
      if (!d.collections) throw new ApiError(503, "unavailable", "Profile storage is unavailable");
      const doc = await d.collections.profiles.findOne({ _id: ctx.ownerId });
      if (!doc) throw new ApiError(404, "profile_not_found", "No profile saved yet");
      return json({ ownerId: ctx.ownerId, profile: doc.profile, updatedAt: doc.updatedAt }, { requestId: ctx.requestId });
    },

    async patchProfile(req: Request, ctx: RequestContext): Promise<Response> {
      if (!d.collections) throw new ApiError(503, "unavailable", "Profile storage is unavailable");
      if (ctx.ownerId === "anonymous") throw new ApiError(400, "no_identity", "A user identity (sign-in or x-user-id) is required to save a profile");
      const body = await readJson(req, z.object({ profile: z.record(z.string(), z.unknown()), replace: z.boolean().optional() }), 32 * 1024);
      Object.assign(ctx.details, { keys: Object.keys(body.profile).slice(0, 50), replace: Boolean(body.replace) });
      const existing = await d.collections.profiles.findOne({ _id: ctx.ownerId });
      const merged = body.replace || !existing ? body.profile : { ...existing.profile, ...body.profile };
      // Drop null/undefined so a partial save never wipes fields the client did not send.
      for (const k of Object.keys(merged)) if (merged[k] === null || merged[k] === undefined) delete merged[k];
      const updatedAt = new Date();
      await d.collections.profiles.updateOne({ _id: ctx.ownerId }, { $set: { profile: merged, updatedAt } }, { upsert: true });
      return json({ ownerId: ctx.ownerId, profile: merged, updatedAt }, { requestId: ctx.requestId });
    },

    /** Who am I (lets the frontend confirm a valid session before showing the chat). */
    me(ctx: RequestContext): Response {
      if (!ctx.user) throw new ApiError(401, "unauthorized", "Not signed in");
      return json({ user: ctx.user, auth: ctx.auth }, { requestId: ctx.requestId });
    },

    /** Liveness: process is up. Unauthenticated. */
    health(): Response {
      return json({ status: "ok", service: "expert-ai-consultant", assistant: PERSONA.name, version, uptimeSeconds: Math.round((Date.now() - d.startedAt) / 1000), timestamp: new Date().toISOString() });
    },

    /** Readiness: dependencies reachable. Unauthenticated. */
    async ready(): Promise<Response> {
      const r = await d.readiness();
      return json({ status: r.ok ? "ready" : "not_ready", version, checks: r.checks }, { status: r.ok ? 200 : 503 });
    },
  };
}
