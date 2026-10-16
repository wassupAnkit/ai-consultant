/**
 * CRM write approval. The research loop never executes a CRM write: it asks the CRM for a dry
 * run (`propose`), stores the exact before→after, and the counsellor decides it later over HTTP
 * (`decide`). Only an approve replays the model's stored arguments against the CRM, carrying the
 * previewed version so the CRM refuses when the record changed in between (STALE_RECORD).
 *
 * Gmail drafts ride the same machinery (`provider: "gmail"`). Gmail has no dry run, so
 * `proposeGmailDraft` builds the preview from the model's arguments and calls nothing; only an
 * approve calls the Gmail MCP `create_draft` tool, once. Nothing here ever sends an email.
 *
 * Every status change is a store compare-and-set, so a double click, two tabs, or a decision
 * racing the next chat message cannot execute a write twice or execute an expired one.
 */
import type { CrmProvider, CrmToolResult, CrmToolset } from "../client";
import { SERVICE_LABELS, type WorkspaceProvider } from "../../google/types";
import type { McpToolResult, McpToolset } from "../../mcp/types";
import type { Logger } from "../../observability/logger";
import type { CrmWriteProposalPatch, CrmWriteProposalStore } from "./store";
import {
  CRM_WRITE_META,
  STALE_RECORD,
  toView,
  type CrmWriteChange,
  type CrmWriteEdit,
  type CrmWriteOrigin,
  type CrmWritePreview,
  type CrmWriteProposal,
  type CrmWriteProposalView,
  type CrmWriteProvider,
  type CrmWriteResult,
  type CrmWriteStatus,
  type CrmWriteValue,
} from "./types";
import { calendarEventPreview, docsPreview } from "./workspace-previews";

export interface CrmWriteServiceDeps {
  store: CrmWriteProposalStore;
  /** forActor(email, signal) → CrmToolset | undefined; resolved again at decision time. Absent → CRM proposals fail as switched off. */
  crm?: CrmProvider;
  /** The consultant's Gmail toolset, resolved again at decision time. Absent → Gmail drafts cannot be approved. */
  workspace?: WorkspaceProvider;
  logger: Logger;
  /** How long a proposal can be approved for. Default 30 minutes. */
  ttlMs?: number;
  now?: () => Date;
  newId?: () => string;
  /**
   * The args actually sent to the CRM for a stored proposal (on approve, and on an edit's new dry
   * run). Document intake uses it to mint a fresh signed `fileUrl`: the link lives 10 minutes, a
   * proposal 30. Absent → the stored args, unchanged.
   */
  prepareArgs?: (p: Pick<CrmWriteProposal, "tool" | "args" | "origin">) => Record<string, unknown>;
  /** Told of every status a proposal reaches after `pending` (decided, applied, expired…). Must not throw. */
  onStatus?: (p: CrmWriteProposal) => void;
}

export type ProposeResult = { ok: true; view: CrmWriteProposalView } | { ok: false; error: string; empty?: true };
export type DecideResult =
  | { kind: "not_found" }
  | { kind: "conflict"; view: CrmWriteProposalView }
  | { kind: "ok"; view: CrmWriteProposalView }
  /** The decision or its edits cannot be accepted; the proposal is unchanged (still pending). */
  | { kind: "invalid"; message: string };

export type CrmWriteEdits = Record<string, CrmWriteValue>;

/** Tools whose card rows map 1:1 to tool arguments, so an edited row is an edited argument (contract §5). */
export const EDITABLE_TOOLS: ReadonlySet<string> = new Set(["crm_update_contact"]);

const DEFAULT_TTL_MS = 30 * 60 * 1000;
export const WRITES_SWITCHED_OFF = "CRM writes are switched off";
export const GMAIL_DISCONNECTED = "Gmail is no longer connected";

/** The preview shows at most this much of a draft body; the stored args keep all of it. */
export const GMAIL_BODY_PREVIEW_CHARS = 20_000;

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The preview crm-api returns in `structuredContent.preview`, or null when it is not one. */
function readPreview(result: CrmToolResult): CrmWritePreview | null {
  const p = result.structured?.preview;
  if (!isObject(p) || !isObject(p.target) || !Array.isArray(p.changes)) return null;
  if (typeof p.target.label !== "string" || typeof p.target.entity !== "string") return null;
  return p as unknown as CrmWritePreview;
}

const errorCode = (result: CrmToolResult): unknown => {
  const e = result.structured?.error;
  return isObject(e) ? e.code : undefined;
};

type DraftField = "to" | "cc" | "bcc" | "subject" | "replyTo" | "thread" | "body" | "html";

/** Google's Gmail MCP does not promise argument names, so known ones are matched loosely. */
const DRAFT_KEYS: Record<string, DraftField> = {
  to: "to",
  recipient: "to",
  recipients: "to",
  cc: "cc",
  bcc: "bcc",
  subject: "subject",
  replytomessageid: "replyTo",
  inreplyto: "replyTo",
  threadid: "thread",
  body: "body",
  text: "body",
  plaintextbody: "body",
  content: "body",
  htmlbody: "html",
};
const DRAFT_LABELS: Record<DraftField, string> = { to: "To", cc: "Cc", bcc: "Bcc", subject: "Subject", replyTo: "In reply to message", thread: "In reply to thread", body: "Body", html: "Body (HTML)" };
/** Card order: who, what, where it replies, then the body; unknown args follow. */
const DRAFT_ORDER: DraftField[] = ["to", "cc", "bcc", "subject", "replyTo", "thread", "body", "html"];

/**
 * Args the card cannot show faithfully. Attachments arrive as base64 the consultant cannot read, and
 * a draft must never carry file content they did not see; Edge drafts text only.
 */
const REFUSED_DRAFT_KEYS = new Set(["attachments", "attachment", "files"]);

const draftField = (key: string): DraftField | undefined => DRAFT_KEYS[key.toLowerCase().replace(/[_\-\s]/g, "")];

/** Recipients as a list, from a string ("a@x, b@x") or an array. */
const addresses = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[,;]/) : []).map((a) => a.trim()).filter(Boolean);

const shown = (v: unknown): CrmWriteValue => {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v) && v.every((x) => typeof x !== "object" || x === null)) return v.map(String).join(", ");
  return JSON.stringify(v);
};

const isEmpty = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);

const capBody = (text: string): string =>
  text.length > GMAIL_BODY_PREVIEW_CHARS ? `${text.slice(0, GMAIL_BODY_PREVIEW_CHARS)}\n… (${text.length - GMAIL_BODY_PREVIEW_CHARS} more characters)` : text;

/**
 * The approval card for a Gmail draft, built from the model's `create_draft` arguments: every
 * field is new (`before: null`) and there is no version. Errors are phrased for the model to fix.
 */
export function gmailDraftPreview(tool: string, args: Record<string, unknown>): { ok: true; preview: CrmWritePreview } | { ok: false; error: string } {
  const known: { field: string; kind: DraftField; value: unknown }[] = [];
  const other: CrmWriteChange[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (isEmpty(value)) continue;
    if (REFUSED_DRAFT_KEYS.has(key.toLowerCase())) return { ok: false, error: "Edge cannot attach files to a Gmail draft; propose the draft without attachments and tell the consultant to attach the file in Gmail" };
    const kind = draftField(key);
    if (kind) known.push({ field: key, kind, value });
    else other.push({ field: key, label: key, before: null, after: shown(value) });
  }
  const of = (...kinds: DraftField[]) => known.filter((k) => kinds.includes(k.kind));

  const recipients = of("to", "cc", "bcc").flatMap((k) => addresses(k.value));
  const hasThread = of("thread", "replyTo").length > 0;
  if (!recipients.length && !hasThread) return { ok: false, error: "a Gmail draft needs at least one recipient (to) or the replyToMessageId of the message it replies to" };
  if (!of("body", "html").some((k) => typeof k.value === "string" && k.value.trim())) return { ok: false, error: "a Gmail draft needs a non-empty body" };

  const changes: CrmWriteChange[] = [];
  for (const kind of DRAFT_ORDER) {
    for (const k of of(kind)) {
      const after = kind === "to" || kind === "cc" || kind === "bcc" ? addresses(k.value).join(", ") : kind === "body" || kind === "html" ? capBody(String(k.value)) : shown(k.value);
      changes.push({ field: k.field, label: DRAFT_LABELS[kind], before: null, after });
    }
  }
  changes.push(...other);

  const subject = of("subject").map((k) => String(k.value).trim()).find(Boolean);
  const first = recipients[0];
  return {
    ok: true,
    preview: {
      tool,
      target: { entity: "gmailDraft", id: null, label: subject ?? "(no subject)", ...(first ? { parent: { entity: "recipient", id: first, label: first } } : {}) },
      changes,
      version: null,
    },
  };
}

/** Gmail's drafts folder for this consultant; `authuser` picks their account when several are signed in. */
export const gmailDraftsLink = (actor: string): string => `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(actor)}#drafts`;

/** The new draft's id, when the Gmail MCP result carries one. */
function draftId(result: McpToolResult): string | undefined {
  const s = result.structured;
  const candidates = [s?.id, s?.draftId, isObject(s?.draft) ? s.draft.id : undefined];
  const found = candidates.find((c): c is string => typeof c === "string" && Boolean(c));
  if (found) return found;
  return /draft[ _-]?id["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)/i.exec(result.text)?.[1];
}

type Outcome = { status: CrmWriteStatus; error?: string; current?: CrmWriteChange[]; result?: CrmWriteResult };

export class CrmWriteService {
  private readonly ttlMs: number;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly d: CrmWriteServiceDeps) {
    this.ttlMs = d.ttlMs ?? DEFAULT_TTL_MS;
    this.now = d.now ?? (() => new Date());
    this.newId = d.newId ?? (() => crypto.randomUUID());
  }

  /**
   * Dry-run the write and store it as a pending proposal. Nothing is written to the CRM.
   * `skipEmpty`: a preview with no changes (the CRM already holds every value) stores nothing.
   * `origin`: who built it, when not the research model (document intake).
   */
  async propose(input: { sessionId: string; requestId: string; toolset: CrmToolset; tool: string; args: Record<string, unknown>; signal?: AbortSignal; skipEmpty?: boolean; origin?: CrmWriteOrigin }): Promise<ProposeResult> {
    let result: CrmToolResult;
    try {
      result = await input.toolset.call(input.tool, input.args, input.signal, { meta: { [CRM_WRITE_META.dryRun]: true } });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    if (result.isError) return { ok: false, error: result.text || `${input.tool} failed` };
    const preview = readPreview(result);
    if (!preview) return { ok: false, error: "the CRM returned no preview" };
    if (input.skipEmpty && !preview.changes.length) return { ok: false, error: "no changes", empty: true };

    return { ok: true, view: await this.store("crm", input, preview) };
  }

  /** True when an approved Gmail draft can reach Gmail, i.e. drafts may be offered at all. */
  get gmailDraftsEnabled(): boolean {
    return Boolean(this.d.workspace);
  }

  /** True when an approved Calendar event or new Doc/Sheet can reach Google. */
  get workspaceWritesEnabled(): boolean {
    return Boolean(this.d.workspace);
  }

  /**
   * Store a Calendar event or a new Doc/Sheet as a pending proposal. Google is not called: the
   * preview is built from the arguments, which are replayed verbatim only on approve.
   */
  async proposeWorkspace(input: { service: "calendar" | "docs"; sessionId: string; requestId: string; toolset: McpToolset; tool: string; args: Record<string, unknown>; signal?: AbortSignal }): Promise<ProposeResult> {
    const built = input.service === "calendar" ? calendarEventPreview(input.tool, input.args) : docsPreview(input.tool, input.args);
    if (!built.ok) return built;
    return { ok: true, view: await this.store(input.service, input, built.preview) };
  }

  /**
   * Store a Gmail draft as a pending proposal. Gmail is not called: the preview is built from
   * the arguments, which are replayed verbatim against `create_draft` only on approve.
   */
  async proposeGmailDraft(input: { sessionId: string; requestId: string; toolset: McpToolset; tool: string; args: Record<string, unknown>; signal?: AbortSignal }): Promise<ProposeResult> {
    const built = gmailDraftPreview(input.tool, input.args);
    if (!built.ok) return built;
    return { ok: true, view: await this.store("gmail", input, built.preview) };
  }

  private async store(provider: CrmWriteProvider, input: { sessionId: string; requestId: string; toolset: { actor: string }; tool: string; args: Record<string, unknown>; origin?: CrmWriteOrigin }, preview: CrmWritePreview): Promise<CrmWriteProposalView> {
    const createdAt = this.now();
    const proposal: CrmWriteProposal = {
      id: this.newId(),
      provider,
      sessionId: input.sessionId,
      requestId: input.requestId,
      actorEmail: input.toolset.actor.toLowerCase(),
      tool: input.tool,
      args: input.args,
      preview,
      status: "pending",
      createdAt,
      expiresAt: new Date(createdAt.getTime() + this.ttlMs),
      ...(input.origin ? { origin: input.origin } : {}),
    };
    await this.d.store.create(proposal);
    return toView(proposal);
  }

  async decide(input: { proposalId: string; actorEmail: string; decision: "approve" | "reject"; edits?: CrmWriteEdits; signal?: AbortSignal }): Promise<DecideResult> {
    const actor = input.actorEmail.toLowerCase();
    const found = await this.d.store.get(input.proposalId);
    // Another counsellor's proposal is indistinguishable from a missing one.
    if (!found || found.actorEmail.toLowerCase() !== actor) return { kind: "not_found" };

    const now = this.now();
    if (found.status === "pending" && now.getTime() >= found.expiresAt.getTime()) {
      const expired = await this.d.store.transition(found.id, "pending", { status: "expired", decidedAt: now });
      if (expired) this.notify(expired);
      return this.conflict(found.id, expired);
    }
    const hasEdits = Boolean(input.edits && Object.keys(input.edits).length);
    if (hasEdits && input.decision !== "approve") return { kind: "invalid", message: "edits are only accepted with approve" };
    if (found.status !== "pending") return this.conflict(found.id, found);

    if (input.decision === "reject") {
      const rejected = await this.d.store.transition(found.id, "pending", { status: "rejected", decidedAt: now });
      if (rejected) this.notify(rejected);
      return rejected ? { kind: "ok", view: toView(rejected) } : this.conflict(found.id, null);
    }

    let claimPatch: CrmWriteProposalPatch = { status: "applying" };
    if (hasEdits) {
      const edited = await this.applyEdits(found, input.edits!, input.signal);
      if (!edited.ok) return { kind: "invalid", message: edited.message };
      if (edited.patch) claimPatch = { ...claimPatch, ...edited.patch };
    }

    // Claim it first: only the caller that moves it out of pending may reach the CRM.
    const claimed = await this.d.store.transition(found.id, "pending", claimPatch);
    if (!claimed) return this.conflict(found.id, null);
    return { kind: "ok", view: toView(await this.apply(claimed, input.signal)) };
  }

  /**
   * The counsellor's edits as new args and a new dry run (the CRM validates them again before
   * anything is written). Null `patch` when every edit equals what was proposed.
   */
  private async applyEdits(p: CrmWriteProposal, edits: CrmWriteEdits, signal?: AbortSignal): Promise<{ ok: true; patch: CrmWriteProposalPatch | null } | { ok: false; message: string }> {
    if ((p.provider ?? "crm") !== "crm" || !EDITABLE_TOOLS.has(p.tool)) return { ok: false, message: `${p.tool} cards cannot be edited` };
    const byField = new Map(p.preview.changes.map((c) => [c.field, c]));
    const unknown = Object.keys(edits).filter((k) => !byField.has(k));
    if (unknown.length) return { ok: false, message: `not a field of this proposal: ${unknown.join(", ")}` };
    const args: Record<string, unknown> = { ...p.args };
    const edited: CrmWriteEdit[] = [];
    for (const [field, to] of Object.entries(edits)) {
      const from = byField.get(field)!.after;
      const blank = to === null || (typeof to === "string" && !to.trim());
      if (!blank && to === from) continue;
      if (blank && from === null) continue;
      // A cleared input means "do not write this field", never "clear it in the CRM".
      if (blank) delete args[field];
      else args[field] = typeof to === "string" ? to.trim() : to;
      edited.push({ field, from, to: blank ? null : (args[field] as CrmWriteValue) });
    }
    if (!edited.length) return { ok: true, patch: null };
    if (!Object.keys(args).some((k) => byField.has(k))) return { ok: false, message: "nothing left to update: approve without clearing every field, or reject" };

    const toolset = this.d.crm ? await this.d.crm.forActor(p.actorEmail, signal) : undefined;
    if (!toolset || !toolset.descriptors.some((t) => t.name === p.tool)) return { ok: false, message: WRITES_SWITCHED_OFF };
    let result: CrmToolResult;
    try {
      result = await toolset.call(p.tool, this.argsFor({ ...p, args }), signal, { meta: { [CRM_WRITE_META.dryRun]: true } });
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
    if (result.isError) return { ok: false, message: result.text || `${p.tool} refused the edited values` };
    const preview = readPreview(result);
    if (!preview) return { ok: false, message: "the CRM returned no preview" };
    return { ok: true, patch: { args, originalArgs: p.originalArgs ?? p.args, preview, edited } };
  }

  private argsFor(p: Pick<CrmWriteProposal, "tool" | "args" | "origin">): Record<string, unknown> {
    return this.d.prepareArgs ? this.d.prepareArgs(p) : p.args;
  }

  private notify(p: CrmWriteProposal) {
    try {
      this.d.onStatus?.(p);
    } catch (err) {
      this.d.logger.warn("proposal status hook failed", { proposalId: p.id, err: (err as Error).message });
    }
  }

  async expireSession(sessionId: string): Promise<number> {
    // Only the hook needs to know which ones; without it this stays one update.
    const pending = this.d.onStatus ? (await this.d.store.listForSession(sessionId)).filter((p) => p.status === "pending") : [];
    const now = this.now();
    const n = await this.d.store.expireSession(sessionId, now);
    if (n) for (const p of pending) this.notify({ ...p, status: "expired", decidedAt: now });
    return n;
  }

  /** Every proposal of the session, grouped by the turn (requestId) that made it, in creation order. */
  async viewsForSession(sessionId: string): Promise<Map<string, CrmWriteProposalView[]>> {
    const byRequest = new Map<string, CrmWriteProposalView[]>();
    for (const p of await this.d.store.listForSession(sessionId)) {
      const list = byRequest.get(p.requestId) ?? [];
      list.push(toView(p));
      byRequest.set(p.requestId, list);
    }
    return byRequest;
  }

  private async conflict(id: string, updated: CrmWriteProposal | null): Promise<DecideResult> {
    const current = updated ?? (await this.d.store.get(id));
    return current ? { kind: "conflict", view: toView(current) } : { kind: "not_found" };
  }

  /** Execute a claimed (`applying`) proposal and record how it ended. Never leaves it applying on an error. */
  private async apply(p: CrmWriteProposal, signal?: AbortSignal): Promise<CrmWriteProposal> {
    const provider = p.provider ?? "crm";
    const outcome = provider === "crm" ? await this.applyCrm(p, signal) : await this.applyWorkspace(p, provider, signal);

    const patch: CrmWriteProposalPatch = { ...outcome, decidedAt: this.now() };
    const done = await this.d.store.transition(p.id, "applying", patch);
    this.notify(done ?? { ...p, ...patch });
    this.d.logger.info(provider === "crm" ? "CRM write decided" : `${SERVICE_LABELS[provider]} proposal decided`, { proposalId: p.id, tool: p.tool, status: outcome.status, ...(outcome.error ? { error: outcome.error } : {}) });
    if (!done) {
      this.d.logger.error("CRM write outcome could not be recorded", { proposalId: p.id, status: outcome.status });
      return { ...p, ...patch };
    }
    return done;
  }

  /**
   * A Gmail draft, Calendar event or new Doc/Sheet: the stored args against that service's tool,
   * once, under the consultant's current Google grant. A draft is saved, never sent; an event's
   * attendees are emailed an invite by Google; a file is created private to the consultant.
   */
  private async applyWorkspace(p: CrmWriteProposal, service: "gmail" | "calendar" | "docs", signal?: AbortSignal): Promise<Outcome> {
    try {
      const toolsets = this.d.workspace ? await this.d.workspace.forActor(p.actorEmail, signal) : undefined;
      const toolset = toolsets?.[service];
      if (!toolset || !toolset.descriptors.some((t) => t.name === p.tool)) return { status: "failed", error: service === "gmail" ? GMAIL_DISCONNECTED : `${SERVICE_LABELS[service]} is no longer connected` };
      const result = await toolset.call(p.tool, p.args, signal);
      if (result.isError) return { status: "failed", error: result.text || `${p.tool} failed` };
      if (service === "gmail") {
        const id = draftId(result);
        return { status: "applied", result: { link: gmailDraftsLink(p.actorEmail), ...(id ? { id } : {}) } };
      }
      const s = result.structured ?? {};
      const link = typeof s.htmlLink === "string" ? s.htmlLink : typeof s.webViewLink === "string" ? s.webViewLink : undefined;
      const id = typeof s.id === "string" ? s.id : undefined;
      return { status: "applied", result: { ...(link ? { link } : {}), ...(id ? { id } : {}) } };
    } catch (err) {
      return { status: "failed", error: (err as Error).message };
    }
  }

  private async applyCrm(p: CrmWriteProposal, signal?: AbortSignal): Promise<Outcome> {
    let outcome: Outcome;
    try {
      const toolset = this.d.crm ? await this.d.crm.forActor(p.actorEmail, signal) : undefined;
      if (!toolset || !toolset.descriptors.some((t) => t.name === p.tool)) {
        outcome = { status: "failed", error: WRITES_SWITCHED_OFF };
      } else {
        const meta = p.preview.version ? { [CRM_WRITE_META.expectedVersion]: p.preview.version } : undefined;
        const result = await toolset.call(p.tool, this.argsFor(p), signal, { meta });
        if (errorCode(result) === STALE_RECORD) {
          const current = readPreview(result)?.changes;
          outcome = { status: "stale", ...(current ? { current } : {}) };
        } else if (result.isError) {
          outcome = { status: "failed", error: result.text || `${p.tool} failed` };
        } else {
          outcome = { status: "applied" };
        }
      }
    } catch (err) {
      outcome = { status: "failed", error: (err as Error).message };
    }
    return outcome;
  }
}
