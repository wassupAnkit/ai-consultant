import { redactWorkspaceEvidence, redactWorkspaceTrace } from "../google/redact";
import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { capJson } from "../activity/events";
import type { ActivityLog, ChatTurnInput } from "../activity/log";
import type { Env } from "../config/env";
import { withDecisionNotes } from "../crm/approvals/history";
import type { CrmWriteService } from "../crm/approvals/service";
import { CRM_WRITE_PROPOSAL_EVENT, type CrmWriteProposalView } from "../crm/approvals/types";
import { DOCUMENT_EXTRACTION_EVENT, type DocumentExtractionView } from "../documents/student/types";
import type { ChatTurnDoc, PromptRef } from "../db/mongo";
import { ANSWER_TAG, type EdgeGraph, type EdgeStateType } from "../graph";
import { ANSWER_NOTE_EVENT, contentToText, THINKING_EVENT } from "../graph/nodes";
import { toWindowedMessages } from "../memory/window";
import { priorAnswersOf, priorSourcesOf } from "../memory/recall";
import { PRIOR_ANSWER_MAX_CHARS } from "../graph/rewrite";
import { priorCrmStudentOf, priorDestinationsOf, priorOriginOf } from "../routing/route";
import type { ChatStore, Session } from "../memory/store";
import { createTraceHandler, runTraced } from "../observability/langfuse";
import type { Logger } from "../observability/logger";
import { LlmUsageRecorder, summarizeLlm } from "../observability/usage";
import { SAFE_FALLBACK_ANSWER } from "../prompts/consultant";
import type { Source } from "../retrieval/format";
import type { RetrievedChunk } from "../retrieval/store";
import { normalizeUserInput } from "../safety/sanitize";
import type { Intent } from "../schemas/intent.schema";
import type { EvidenceItem, ResearchTrace, ThoughtSegment } from "../tools/types";
import { fallbackTitle, type TurnExtras } from "./turn-extras";
import type { CrmStudentReader } from "../crm/student";
import type { GuideContext } from "../graph/state";
import { guideView, stepStatus, type GuideState } from "../journey/guide";
import { JOURNEY_STEP_KEYS, journeyStep, STUDENT_FIELDS } from "../journey/steps";
import { settledSuggestion } from "../journey/suggest";
import { stepFieldGaps } from "../crm/student";
import { regionFromTimezone, type CounsellorRegion, type CounsellorRegionReader } from "../crm/staff";
import { marketFromProfile } from "../routing/markets";

/** Edge has a single persona: the internal consultant assistant. Kept as a named constant for API/telemetry compatibility with older clients that read a `mode` field. */
export const ASSISTANT_MODE = "consultant" as const;

export type ChatStage = "reading_documents" | "classifying" | "researching" | "answering";

/** Progress of one research tool call, for the streaming UI ("Searching monash.edu…"). */
export interface ToolEvent {
  tool: string;
  status: "start" | "end";
  /** Human-readable label, e.g. "Searching knowledge base", "Fetching monash.edu/study/…". */
  label: string;
  query?: string;
  url?: string;
  ms?: number;
  ok?: boolean;
  /** Comparison fan-out: the country whose branch ran this lookup (absent otherwise). */
  country?: string;
}

/**
 * One row of the reasoning trace the client shows above an answer. Exactly the shape the
 * frontend folds out of the streamed `tool` events, because it is also what we persist:
 * a reopened conversation has to render the same trace as the live one did.
 */
export interface ReasoningStep {
  /** `<tool>:<position>`, matching the client's fold — a tool can run more than once a turn. */
  key: string;
  label: string;
  state: "running" | "done" | "failed";
  ms?: number;
}

/** Client-facing summary of the research phase. */
export interface ResearchSummary {
  rounds: number;
  toolCalls: number;
  liveUrls: string[];
  budgetExceeded: boolean;
  notes: string | null;
  /** Provider/model error that cut the loop short, if any. */
  error: string | null;
}

export interface ChatInput {
  message: string;
  sessionId?: string;
  ownerId: string;
  requestId: string;
  route: string;
  /** How the caller authenticated (recorded in the activity log). */
  auth?: "api_key" | "session" | "none";
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
  /** Staff context/preferences from the frontend. */
  profile?: Record<string, unknown>;
  /** Force a brand-new session even when the owner has an active one. */
  newSession?: boolean;
  /** DeepThink: answer at a higher reasoning effort, with a longer answer budget. */
  deepThink?: boolean;
  /** Remove the stored newest turn before answering, so a regenerated answer replaces rather than follows the old one. Needs `sessionId`. */
  regenerate?: boolean;
  /** Accepted for backward compatibility with older clients; ignored. */
  mode?: string;
  /** Student documents attached to this turn: ids the route has already checked belong to `ownerId`. */
  attachments?: string[];
  /** Called with each answer token when streaming. */
  onToken?: (token: string) => void;
  /**
   * Called with each fragment of the model's own reasoning: the research rounds' (between their
   * tool events) and the answer's (mostly ahead of its tokens). Also stored with the answer as
   * `metadata.thoughts`, so a reopened conversation shows them in the same order.
   */
  onThinking?: (chunk: string) => void;
  /** Called once the intent is known (before the answer starts). */
  onIntent?: (intent: IntentSummary) => void;
  /** Called when the turn enters a new stage (classifying → researching → answering). */
  onStatus?: (status: { stage: ChatStage }) => void;
  /** Called when a research tool starts/finishes (knowledge base, programs, web search, page fetch). */
  onTool?: (event: ToolEvent) => void;
  /** Called once per CRM write the model proposed this turn. Nothing was written; the counsellor decides. */
  onCrmWriteProposal?: (view: CrmWriteProposalView) => void;
  /** Called once per attached document after it was read, before any CRM write proposal. */
  onDocumentExtraction?: (view: DocumentExtractionView) => void;
}

export interface IntentSummary {
  primary: Intent["primary_intent"];
  secondary: Intent["secondary_intents"];
  task: Intent["task"];
  needsResearch: boolean;
  confidence: Intent["confidence_level"];
  /** Kept for older clients: true unless the request was refused as a prompt-injection attempt. */
  inScope: boolean;
  destinations: Intent["destinations"];
  flags: Intent["contextual_flags"];
  language: Intent["language"];
}

export interface ChatResult {
  sessionId: string;
  requestId: string;
  traceId: string | null;
  mode: typeof ASSISTANT_MODE;
  answer: string;
  refused: boolean;
  intent: IntentSummary | null;
  sources: Source[];
  research: ResearchSummary | null;
  disclaimer: string | null;
  latencyMs: number;
  /** True when the answer was cut off mid-stream (time limit or model error) and carries the cut-off note. */
  truncated: boolean;
  /** True when this turn opened the conversation (so `finishTurn` names it). */
  firstTurn: boolean;
  /** Filled by `finishTurn`; always empty on the result `chat` returns. */
  followUps: string[];
  meta: Record<string, unknown>;
  /** Guided sessions: the journey position and CRM student this turn ran with (not serialised). */
  guide?: GuideContext | null;
  /** What was read from this turn's attachments (empty without any). */
  documents: DocumentExtractionView[];
}

/** What `finishTurn` produced after the answer went out. */
export interface TurnExtrasResult {
  /** Model-written title, when this was the first turn and one could be made. */
  title: string | null;
  followUps: string[];
  /** Guided sessions: the journey after Edge's suggestion (if any) was stored. */
  guide?: ReturnType<typeof guideView> | null;
}

export interface ChatServiceDeps {
  env: Env;
  graph: EdgeGraph;
  store: ChatStore;
  logger: Logger;
  /** Optional lookup of the caller's saved profile, used when the request carries none. */
  loadProfile?: (ownerId: string) => Promise<Record<string, unknown> | null>;
  /** Durable per-turn activity log (fine-tuning corpus). Optional; never affects the response. */
  activity?: ActivityLog;
  /** Post-answer title and follow-up generation. Optional; without it sessions keep their first-message title and no chips are offered. */
  extras?: TurnExtras;
  /** CRM write approval (proposals the counsellor decides). Absent → CRM writes are never offered. */
  crmWrites?: CrmWriteService;
  /** Reads a guided session's student from the CRM. Without it guided turns run with the record marked unavailable. */
  students?: CrmStudentReader;
  /** Reads where the consultant counsels (CRM branch), the default origin market. Without it only the profile and browser timezone count. */
  regions?: CounsellorRegionReader;
}

/**
 * ownerId is the signed-in user's email (or an x-user-id an api_key caller supplied on their
 * behalf); anything without an "@" is anonymous or a non-email id and gets no CRM access. Note
 * this inherits the existing trust model: a holder of API_KEY can already act for any user via
 * x-user-id, and that extends to which CRM identity is used.
 */
export const actorEmailOf = (ownerId: string): string | null => (ownerId.includes("@") ? ownerId.toLowerCase() : null);

/** What the streaming loop observed, so aborted turns can be recorded with their partial answer. */
interface StreamTrace {
  tokens: number;
  firstTokenAt: number | null;
  partial: string;
  intent: Intent | null;
}

/** Orchestrates one turn: load history → run graph (optionally streaming) → persist. */
export class ChatService {
  /**
   * The persistence of each turn, by request id. `chat` stores after it has returned, so
   * `finishTurn` waits for the write it is about to amend rather than racing it.
   */
  private readonly persisting = new Map<string, Promise<void>>();

  constructor(private readonly d: ChatServiceDeps) {}

  async chat(input: ChatInput): Promise<ChatResult> {
    const started = performance.now();
    const rawLength = input.message.length;
    const message = normalizeUserInput(input.message, this.d.env.MAX_INPUT_CHARS);
    // Identified users without an explicit sessionId continue their latest conversation.
    let sessionId = input.sessionId;
    if (!sessionId && !input.newSession && input.ownerId !== "anonymous") {
      sessionId = (await this.d.store.getLatestSession(input.ownerId))?.id;
    }
    const session = await this.d.store.getOrCreateSession(sessionId, input.ownerId);
    // A new message ends the previous turn's undecided CRM write proposals (they can no longer be approved).
    await this.d.crmWrites?.expireSession(session.id).catch((err) => this.d.logger.warn("expiring CRM write proposals failed", { err }));
    if (input.regenerate && input.sessionId && session.messageCount > 0) {
      // Regenerate = answer the newest question again. The old pair goes first so the history
      // window the model sees, and the thread the consultant reopens, hold one answer to it.
      session.messageCount = Math.max(0, session.messageCount - (await this.d.store.removeLastTurn(session.id, input.ownerId)));
    }
    let profile: Record<string, unknown> | null = sanitizeProfile(input.profile);
    if (!profile && this.d.loadProfile && input.ownerId !== "anonymous") {
      profile = sanitizeProfile((await this.d.loadProfile(input.ownerId).catch(() => null)) ?? undefined);
    }
    // A guided turn reads its student from the CRM before the graph runs, alongside the history
    // and the consultant's region (the default market of every turn).
    const [stored, guide, counsellorRegion] = await Promise.all([
      this.d.store.getMessages(session.id, this.d.env.HISTORY_WINDOW_MESSAGES),
      session.guide ? this.guideContext(session.guide, actorEmailOf(input.ownerId), input.signal) : Promise.resolve(null),
      this.counsellorRegion(profile, actorEmailOf(input.ownerId), input.metadata, input.signal),
    ]);
    // The model's copy of history says how each CRM write it proposed was decided; the stored answer is untouched.
    const crmViews = this.d.crmWrites ? await this.d.crmWrites.viewsForSession(session.id).catch(() => null) : null;
    const windowed = crmViews ? withDecisionNotes(stored, crmViews) : stored;
    const history = toWindowedMessages(windowed, this.d.env.HISTORY_WINDOW_MESSAGES);
    // The window cuts each message at 3,000 characters; a turn that rewrites the previous answer gets all of it.
    const priorAnswer = windowed.findLast((m) => m.role === "ai")?.content.slice(0, PRIOR_ANSWER_MAX_CHARS) ?? null;
    // A turn that refers back sees the last two answers uncut and the previous one's sources (src/memory/recall.ts).
    const priorAnswers = priorAnswersOf(windowed);
    const priorSources = priorSourcesOf(stored);
    const log = this.d.logger.child({ requestId: input.requestId, sessionId: session.id });

    const recorder = new LlmUsageRecorder();
    const trace: StreamTrace = { tokens: 0, firstTokenAt: null, partial: "", intent: null };
    const turnCtx = { input, message, rawLength, session, profile, history, recorder, trace, started };
    let state: EdgeStateType;
    let traceId: string | null;
    try {
      ({ result: state, traceId } = await runTraced(
        this.d.env,
        { sessionId: session.id, userId: input.ownerId, requestId: input.requestId, route: input.route, metadata: input.metadata },
        async () => this.runGraph({ message, history, priorAnswer, priorAnswers, priorSources, priorDestinations: priorDestinationsOf(stored), priorOrigin: priorOriginOf(stored), priorCrmStudent: priorCrmStudentOf(stored), sessionId: session.id, profile, guide, counsellorRegion, input, recorder, trace }),
      ));
    } catch (err) {
      this.recordTurn({ ...turnCtx, state: null, traceId: null, error: err });
      // A turn the consultant stopped mid-answer is still a turn they saw: keep the question
      // and the partial text (flagged) so the reopened thread matches the screen, instead of
      // silently dropping both. Nothing to keep when the answer had not started.
      if (input.signal?.aborted && trace.partial.trim()) {
        const now = new Date();
        const partialIntent = trace.intent ? summarize(trace.intent) : null;
        this.persist(
          input.requestId,
          session.id,
          [
            { role: "human", content: message, intent: partialIntent?.primary ?? null, ...(input.attachments?.length ? { metadata: { attachments: input.attachments } } : {}), createdAt: now },
            {
              role: "ai",
              content: trace.partial.trim(),
              intent: partialIntent?.primary ?? null,
              metadata: { stopped: true, refused: false, sources: [], reasoning: [], requestId: input.requestId, mode: ASSISTANT_MODE, intent: partialIntent, disclaimer: null, latencyMs: Math.round(performance.now() - started) },
              createdAt: new Date(now.getTime() + 1),
            },
          ],
          { title: session.messageCount === 0 ? fallbackTitle(message) : undefined, mode: ASSISTANT_MODE },
          log,
        );
      }
      throw err;
    }

    const intent = state.intent ? summarize(state.intent) : null;
    const result: ChatResult = {
      sessionId: session.id,
      requestId: input.requestId,
      traceId,
      mode: ASSISTANT_MODE,
      answer: state.answer,
      refused: state.refused,
      intent,
      sources: state.sources,
      research: summarizeResearch(state.researchTrace),
      disclaimer: state.disclaimer ?? null,
      latencyMs: Math.round(performance.now() - started),
      truncated: state.meta.truncated === true,
      firstTurn: session.messageCount === 0,
      followUps: [],
      meta: state.meta,
      guide,
      documents: state.documentIntake?.views ?? [],
    };

    this.recordTurn({ ...turnCtx, state, traceId, error: null });

    // Persist after responding to the caller's needs; failures must not fail the request.
    const now = new Date();
    this.persist(
        input.requestId,
        session.id,
        [
          { role: "human", content: message, intent: intent?.primary ?? null, ...(input.attachments?.length ? { metadata: { attachments: input.attachments } } : {}), createdAt: now },
          {
            role: "ai",
            content: state.answer,
            intent: intent?.primary ?? null,
            // Full Source objects (incl. excerpts) so a reopened conversation can rebuild its
            // citations; the reasoning trace and turn latency for the same reason — the client
            // cannot recompute either (tool calls run in parallel, so their ms do not sum).
            metadata: {
              refused: state.refused,
              sources: state.sources,
              reasoning: reasoningSteps(state.researchTrace),
              thoughts: thoughtTimeline(state),
              deepThink: Boolean(input.deepThink),
              // Cut off mid-stream; the stored answer ends with the cut-off note.
              ...(result.truncated ? { truncated: true } : {}),
              latencyMs: result.latencyMs,
              traceId,
              requestId: input.requestId,
              mode: ASSISTANT_MODE,
              intent,
              // The countries (and the student's market) this turn was routed to, and the CRM student it read, read back by the next turn's follow-up carry-over.
              ...(state.route ? { route: { countries: state.route.countries, mode: state.route.mode, ...(state.route.origin ? { origin: state.route.origin } : {}), ...(state.crmStudent ? { crmStudent: state.crmStudent } : {}) } } : {}),
              disclaimer: state.disclaimer ?? null,
              // The journey step this turn was answered at (guided sessions only).
              ...(guide ? { guideStep: guide.step } : {}),
              // What was read from the attachments, exactly as streamed (history returns them as `documents`).
              ...(result.documents.length ? { documents: result.documents } : {}),
            },
            createdAt: new Date(now.getTime() + 1),
          },
        ],
        // Provisional: the first 80 characters, until `finishTurn` names the conversation.
        { title: session.messageCount === 0 ? fallbackTitle(message) : undefined, mode: ASSISTANT_MODE },
        log,
    );

    log.info("chat turn complete", {
      intent: intent?.primary,
      inScope: intent?.inScope,
      refused: state.refused,
      retrieved: state.meta.retrieved,
      latencyMs: result.latencyMs,
      inputChars: message.length,
      answerChars: state.answer.length,
      // How the turn was routed (countries, student market and where it came from, onshore, packs):
      // the one line that explains, from pod logs alone, why an answer carried a country's guidance.
      route: routeLogSummary(state.meta.route),
    });
    return result;
  }

  private async runGraph(args: {
    message: string;
    history: EdgeStateType["history"];
    /** The previous assistant answer, uncut (up to PRIOR_ANSWER_MAX_CHARS). */
    priorAnswer: EdgeStateType["priorAnswer"];
    /** The last two assistant answers, uncut, and the sources the previous one cited. */
    priorAnswers: EdgeStateType["priorAnswers"];
    priorSources: EdgeStateType["priorSources"];
    sessionId: string;
    profile: Record<string, unknown> | null;
    guide: GuideContext | null;
    /** Where the consultant counsels: the turn's default origin market. */
    counsellorRegion: CounsellorRegion | null;
    /** Countries the previous turn was routed to, so a follow-up can inherit them. */
    priorDestinations: EdgeStateType["priorDestinations"];
    /** The previous turn's source market, so a follow-up can inherit it. */
    priorOrigin: EdgeStateType["priorOrigin"];
    /** The CRM student an earlier turn read, so a follow-up re-reads their record. */
    priorCrmStudent: EdgeStateType["priorCrmStudent"];
    input: ChatInput;
    recorder: LlmUsageRecorder;
    trace: StreamTrace;
  }): Promise<EdgeStateType> {
    const handler = createTraceHandler(this.d.env, {
      sessionId: args.sessionId,
      userId: args.input.ownerId,
      requestId: args.input.requestId,
      route: args.input.route,
    });
    const callbacks: BaseCallbackHandler[] = [...(handler ? [handler as unknown as BaseCallbackHandler] : []), args.recorder];
    const actorEmail = actorEmailOf(args.input.ownerId);
    const graphInput = { attachments: args.input.attachments ?? [], ownerId: args.input.ownerId, input: args.message, history: args.history, priorAnswer: args.priorAnswer, priorAnswers: args.priorAnswers, priorSources: args.priorSources, sessionId: args.sessionId, profile: args.profile, actorEmail, deepThink: Boolean(args.input.deepThink), guide: args.guide, priorDestinations: args.priorDestinations, priorOrigin: args.priorOrigin, priorCrmStudent: args.priorCrmStudent, counsellorRegion: args.counsellorRegion };
    const config = {
      callbacks,
      signal: args.input.signal,
      runName: "chat",
      metadata: { requestId: args.input.requestId, sessionId: args.sessionId },
      recursionLimit: 10,
    };

    if (!args.input.onToken && !args.input.onThinking && !args.input.onIntent && !args.input.onStatus && !args.input.onTool && !args.input.onCrmWriteProposal && !args.input.onDocumentExtraction) {
      return (await this.d.graph.invoke(graphInput, config)) as EdgeStateType;
    }

    let finalState: EdgeStateType | null = null;
    let intentSent = false;
    const toolStarted = new Map<string, number>();
    const stages: Record<string, ChatStage> = { documents: "reading_documents", classify: "classifying", research: "researching", rates: "researching", generate: "answering" };
    for await (const ev of this.d.graph.streamEvents(graphInput, { ...config, version: "v2" })) {
      if (ev.event === "on_chat_model_stream" && ev.tags?.includes(ANSWER_TAG)) {
        const content = ev.data?.chunk?.content;
        // A chunk can carry a thought part and an answer part at once, so both are read:
        // thoughts are forwarded but deliberately not accumulated into `trace.partial`,
        // which is the answer as the client saw it.
        const token = contentToText(content);
        if (token) {
          args.trace.tokens++;
          args.trace.partial += token;
          args.trace.firstTokenAt ??= performance.now();
          args.input.onToken?.(token);
        }
      } else if (ev.event === "on_custom_event" && ev.name === THINKING_EVENT) {
        // Dispatched by the answer node: LangGraph flattens `on_chat_model_stream` chunk
        // content to a string, so the thinking parts are gone by the time they reach here.
        const chunk = (ev.data as { chunk?: unknown } | undefined)?.chunk;
        if (typeof chunk === "string" && chunk) args.input.onThinking?.(chunk);
      } else if (ev.event === "on_custom_event" && ev.name === ANSWER_NOTE_EVENT) {
        // Text the answer node appended (the cut-off note): part of the answer the client renders.
        const chunk = (ev.data as { chunk?: unknown } | undefined)?.chunk;
        if (typeof chunk === "string" && chunk) {
          args.trace.partial += chunk;
          args.input.onToken?.(chunk);
        }
      } else if (ev.event === "on_custom_event" && ev.name === CRM_WRITE_PROPOSAL_EVENT) {
        args.input.onCrmWriteProposal?.(ev.data as CrmWriteProposalView);
      } else if (ev.event === "on_custom_event" && ev.name === DOCUMENT_EXTRACTION_EVENT) {
        args.input.onDocumentExtraction?.(ev.data as DocumentExtractionView);
      } else if (ev.event === "on_chain_start" && stages[ev.name]) {
        args.input.onStatus?.({ stage: stages[ev.name]! });
      } else if (ev.event === "on_tool_start") {
        toolStarted.set(ev.run_id, performance.now());
        args.input.onTool?.(withCountry(toolEvent(ev.name, "start", ev.data?.input), ev.metadata));
      } else if (ev.event === "on_tool_end") {
        const t = toolStarted.get(ev.run_id);
        toolStarted.delete(ev.run_id);
        const out = ev.data?.output;
        const text = typeof out === "string" ? out : contentToText((out as { content?: unknown })?.content ?? "");
        args.input.onTool?.(withCountry({ ...toolEvent(ev.name, "end", ev.data?.input), ms: t === undefined ? undefined : Math.round(performance.now() - t), ok: !/^error\b/i.test(text) }, ev.metadata));
      } else if (ev.event === "on_chain_end" && ev.name === "classify" && !intentSent) {
        const intent = (ev.data?.output as { intent?: Intent } | undefined)?.intent;
        if (intent) {
          intentSent = true;
          args.trace.intent = intent;
          args.input.onIntent?.(summarize(intent));
        }
      } else if (ev.event === "on_chain_end" && ev.name === "chat") {
        finalState = ev.data?.output as EdgeStateType;
      }
    }
    if (!finalState) throw new Error("graph produced no final state");
    return finalState;
  }

  /**
   * Where the consultant counsels, first hit wins: an explicit market (or office) on their Edge
   * profile, which they chose and so overrides the CRM; their CRM branch (`crm_get_me`); the
   * browser timezone the chat request carries (`metadata.tz`), for when the CRM says nothing.
   * Never throws; null when none of them places the consultant.
   */
  private async counsellorRegion(profile: Record<string, unknown> | null, actorEmail: string | null, metadata: Record<string, unknown> | undefined, signal?: AbortSignal): Promise<CounsellorRegion | null> {
    const chosen = marketFromProfile(profile);
    if (chosen) return { market: chosen, onshore: null, branch: null, source: "profile" };
    const crm = this.d.regions && actorEmail ? await this.d.regions.regionOf(actorEmail, signal).catch(() => null) : null;
    return crm ?? regionFromTimezone(metadata?.tz);
  }

  /** The journey position plus a live CRM read of the student. Never throws: an unreadable CRM is reported to the prompt instead. */
  private async guideContext(g: GuideState, actorEmail: string | null, signal?: AbortSignal): Promise<GuideContext> {
    const res = this.d.students ? await this.d.students.snapshot(actorEmail, g.contactId, signal) : ({ ok: false, message: "The CRM is not configured for Edge." } as const);
    return {
      step: g.currentStep,
      stepsDone: JOURNEY_STEP_KEYS.filter((k) => stepStatus(g, k) === "done"),
      contactId: g.contactId,
      snapshot: res.ok ? res.snapshot : null,
      record: res.ok ? res.record : null,
      ...(res.ok ? {} : { crmMessage: res.message }),
    };
  }

  /** Store a turn in the background, remembering the write so `finishTurn` can wait for it. */
  private persist(requestId: string, sessionId: string, messages: Parameters<ChatStore["append"]>[1], opts: Parameters<ChatStore["append"]>[2], log: Logger) {
    const p = this.d.store
      .append(sessionId, messages, opts)
      .catch((err) => log.error("failed to persist conversation", { err }))
      .finally(() => {
        if (this.persisting.get(requestId) === p) this.persisting.delete(requestId);
      });
    this.persisting.set(requestId, p);
  }

  /**
   * What happens after the answer has gone out: name a new conversation and suggest what to
   * ask next. Runs both in parallel, stores what it gets, and reports through the callbacks
   * as each lands, so a stream can forward them as `session` / `suggestions` events while
   * the consultant is already reading. Never throws — nothing here may fail the turn.
   */
  async finishTurn(
    result: ChatResult,
    args: {
      ownerId: string;
      message: string;
      signal?: AbortSignal;
      onSession?: (s: { sessionId: string; title: string }) => void;
      onSuggestions?: (s: { requestId: string; items: string[] }) => void;
      /** Guided sessions: Edge stored a suggestion to move on (the journey as it now stands). */
      onGuide?: (g: { sessionId: string; guide: ReturnType<typeof guideView> }) => void;
    },
  ): Promise<TurnExtrasResult> {
    const out: TurnExtrasResult = { title: null, followUps: [] };
    const extras = this.d.extras;
    if (!extras || result.refused || result.answer === SAFE_FALLBACK_ANSWER || args.signal?.aborted) return out;
    const log = this.d.logger.child({ requestId: result.requestId, sessionId: result.sessionId });
    const stored = this.persisting.get(result.requestId) ?? Promise.resolve();
    const title = result.firstTurn
      ? extras
          .title({ message: args.message, answer: result.answer, signal: args.signal })
          .then(async (t) => {
            if (!t) return;
            await stored;
            if (await this.d.store.setAutoTitle(result.sessionId, args.ownerId, t)) {
              out.title = t;
              args.onSession?.({ sessionId: result.sessionId, title: t });
            }
          })
          .catch((err) => log.warn("could not set the automatic title", { err: (err as Error).message }))
      : Promise.resolve();
    const storeFollowUps = async (items: string[]) => {
      if (!items.length) return;
      out.followUps = items;
      args.onSuggestions?.({ requestId: result.requestId, items });
      await stored;
      await this.d.store.setTurnMetadata(result.sessionId, result.requestId, { followUps: items });
    };
    const g = result.guide;
    // A guided turn gets step-scoped chips and Edge's view on the step from one call; the
    // suggestion itself is only stored when the CRM agrees the step is settled.
    const followUps = (
      g && extras.guided
        ? extras
            .guided({
              message: args.message,
              answer: result.answer,
              step: journeyStep(g.step),
              studentFacts: g.record?.content ?? null,
              missing: stepFieldGaps(g.snapshot, g.step).missing.map((f) => STUDENT_FIELDS[f].label),
              signal: args.signal,
            })
            .then(async (v) => {
              await storeFollowUps(v.followUps);
              const suggestion = settledSuggestion({ step: g.step, snapshot: g.snapshot, stepComplete: v.stepComplete, reason: v.reason });
              if (!suggestion) return;
              await stored;
              const session = await this.d.store.setGuideSuggestion(result.sessionId, args.ownerId, g.step, suggestion);
              if (!session?.guide) return;
              out.guide = guideView(session.guide);
              args.onGuide?.({ sessionId: result.sessionId, guide: out.guide });
            })
        : extras
            .followUps({ message: args.message, answer: result.answer, intent: result.intent ? { primary: result.intent.primary, task: result.intent.task } : null, signal: args.signal })
            .then(storeFollowUps)
    ).catch((err) => log.warn("could not store follow-up suggestions", { err: (err as Error).message }));
    await Promise.all([title, followUps]);
    return out;
  }

  /** Queue the durable training record for this turn. Never throws; never delays the response. */
  private recordTurn(a: {
    input: ChatInput;
    message: string;
    rawLength: number;
    session: Session;
    profile: Record<string, unknown> | null;
    history: EdgeStateType["history"];
    recorder: LlmUsageRecorder;
    trace: StreamTrace;
    started: number;
    state: EdgeStateType | null;
    traceId: string | null;
    error: unknown;
  }) {
    const activity = this.d.activity;
    if (!activity) return;
    try {
      const state = a.state;
      const meta: Record<string, unknown> = { ...(state?.meta ?? {}) };
      const lift = <T>(key: string): T | undefined => {
        const v = meta[key];
        delete meta[key];
        return v === undefined || v === null ? undefined : (v as T);
      };
      const ref = (prefix: "system" | "playbook" | "classifier"): PromptRef => ({
        name: lift<string>(`${prefix}PromptName`) ?? null,
        source: lift<PromptRef["source"]>(`${prefix}PromptSource`) ?? lift<PromptRef["source"]>(`${prefix}Source`) ?? null,
        version: lift<number>(`${prefix}PromptVersion`) ?? null,
        templateHash: lift<string>(`${prefix}TemplateHash`) ?? null,
      });
      const aborted = Boolean(a.input.signal?.aborted);
      const outcome: ChatTurnDoc["outcome"] = a.error ? (aborted ? "aborted" : "error") : aborted ? "aborted" : state?.refused ? "refused" : "ok";
      const streamed = Boolean(a.input.onToken);
      const err = a.error as { name?: unknown; message?: unknown } | null;
      const systemPromptText = lift<string>("systemPromptText") ?? null;
      const classifierError = lift<string>("classifierError") ?? null;
      const turn: ChatTurnInput = {
        requestId: a.input.requestId,
        traceId: a.traceId,
        sessionId: a.session.id,
        turnIndex: Math.floor(a.session.messageCount / 2),
        ownerId: a.input.ownerId,
        auth: a.input.auth ?? "none",
        route: a.input.route,
        streamed,
        mode: ASSISTANT_MODE,
        clientMetadata: a.input.metadata ? capJson(a.input.metadata, 8_000) : null,
        profile: a.profile,
        history: a.history.map((m) => ({ role: m.getType() === "human" ? "user" : "assistant", content: contentToText(m.content) })),
        userMessage: a.message,
        inputTruncated: a.rawLength > this.d.env.MAX_INPUT_CHARS,
        intent: state?.intent ?? a.trace.intent,
        intentFallback: classifierError !== null,
        // A consultant's own email and Drive text stays out of this corpus: only ids, titles, links and a content hash.
        chunks: redactWorkspaceEvidence(((state?.evidence?.length ? state.evidence : (state?.chunks ?? [])) as (RetrievedChunk & Partial<Pick<EvidenceItem, "kind" | "live">>)[]).map((c) => ({
          id: c.id,
          url: c.url,
          ...(c.webUrl ? { webUrl: c.webUrl } : {}),
          title: c.title,
          section: c.section,
          docType: c.docType,
          country: c.country,
          source: c.source,
          score: c.score,
          matchedBy: c.matchedBy,
          content: c.content.slice(0, 8_000),
          ...(c.kind ? { kind: c.kind, live: c.live ?? false } : {}),
        }))),
        contextChunkCount: lift<number>("contextChunkCount") ?? 0,
        research: redactWorkspaceTrace(state?.researchTrace ?? null),
        sources: redactWorkspaceEvidence(state?.sources ?? []),
        answer: state?.answer ?? "",
        refused: state?.refused ?? false,
        disclaimer: state?.disclaimer ?? null,
        answerIsFallback: state?.answer === SAFE_FALLBACK_ANSWER,
        outcome,
        error: err ? { name: String(err.name ?? "Error"), message: String(err.message ?? err).slice(0, 1_000) } : null,
        stream: streamed
          // Deliberately no record of the streamed thoughts here or on the persisted AI
          // message: they are long, they are a by-product rather than a record of the turn,
          // and this log is a fine-tuning corpus — keeping raw chain-of-thought in it is a
          // call for the business to make, not a default we slip in.
          ? {
              tokens: a.trace.tokens,
              firstTokenMs: a.trace.firstTokenAt === null ? null : Math.round(a.trace.firstTokenAt - a.started),
              partialAnswer: outcome === "ok" || outcome === "refused" ? null : a.trace.partial || null,
              clientAborted: aborted,
            }
          : null,
        llm: summarizeLlm(a.recorder.calls, { jevCostUsd: typeof meta.jevCost === "number" ? meta.jevCost : null }),
        prompt: {
          systemPromptText,
          systemPromptHash: lift<string>("systemPromptHash") ?? null,
          systemPromptChars: lift<number>("systemPromptChars") ?? systemPromptText?.length ?? null,
          system: ref("system"),
          playbook: ref("playbook"),
          classifier: ref("classifier"),
        },
        timings: {
          classifyMs: lift<number>("classifyMs") ?? null,
          retrieveMs: lift<number>("retrieveMs") ?? null,
          researchMs: lift<number>("researchMs") ?? null,
          generateMs: lift<number>("generateMs") ?? null,
          totalMs: Math.round(performance.now() - a.started),
        },
        meta: compact({ ...meta, classifierError }),
      };
      activity.turn(turn);
    } catch (err) {
      this.d.logger.warn("failed to record chat turn", { requestId: a.input.requestId, err });
    }
  }
}

/** The routing facts worth a log line: no message text, no student names (CRM contact id only). */
export function routeLogSummary(route: unknown): Record<string, unknown> | undefined {
  if (!route || typeof route !== "object") return undefined;
  const r = route as Record<string, unknown>;
  const student = r.crmStudent as { contactId?: unknown; origin?: unknown; destinations?: unknown } | undefined;
  const region = r.counsellorRegion as { market?: unknown; onshore?: unknown; source?: unknown } | null | undefined;
  return compact({
    countries: r.countries,
    mode: r.mode,
    origin: r.origin,
    originSource: r.originSource,
    onshore: r.onshore,
    region: region ? compact({ market: region.market, onshore: region.onshore, source: region.source }) : undefined,
    packs: r.packs,
    marketPack: r.marketPack,
    crmStudent: student ? compact({ contactId: student.contactId, origin: student.origin, destinations: student.destinations }) : undefined,
  });
}

/** Drop null/undefined entries so the free-form `meta` bag only carries real diagnostics. */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

/** Keep only plain JSON, capped in size, so a client cannot smuggle huge or odd payloads into the prompt. */
export function sanitizeProfile(profile: Record<string, unknown> | undefined, maxBytes = 8_000): Record<string, unknown> | null {
  if (!profile || typeof profile !== "object") return null;
  try {
    const json = JSON.stringify(profile);
    if (!json || json === "{}") return null;
    return JSON.parse(json.length > maxBytes ? json.slice(0, maxBytes).replace(/[^}\]]*$/, "") + "}" : json);
  } catch {
    return null;
  }
}

/**
 * The finished reasoning trace for a turn.
 *
 * Rebuilt from the research trace rather than accumulated from the stream callbacks: the
 * research node records the same calls in the same order for streamed and non-streamed turns,
 * so both end up with a trace, and there is no second copy of the fold to drift out of step.
 * Every step is terminal by the time this runs — nothing is left "running".
 */
export function reasoningSteps(r: ResearchTrace | null | undefined): ReasoningStep[] {
  if (!r) return [];
  return r.toolCalls.map((call, i) => ({
    key: `${call.tool}:${i}`,
    label: toolEvent(call.tool, "end", call.args).label,
    state: call.ok ? "done" : "failed",
    ms: call.ms,
  }));
}

/** Stored reasoning is capped: raw DeepSeek reasoning runs to several thousand words at high effort. */
export const THOUGHTS_MAX_CHARS = 32_000;

/**
 * The turn's reasoning in timeline order: each research round's thought at the point in the
 * lookups where it happened, then the answer's after all of them. Capped at THOUGHTS_MAX_CHARS
 * in total; a segment that crosses the cap is cut and marked, later ones are dropped.
 */
export function thoughtTimeline(state: Pick<EdgeStateType, "researchTrace" | "thinking">): ThoughtSegment[] {
  const segments: ThoughtSegment[] = [...(state.researchTrace?.thoughts ?? [])];
  if (state.thinking?.trim()) segments.push({ at: state.researchTrace?.toolCalls.length ?? 0, text: state.thinking.trim() });
  const out: ThoughtSegment[] = [];
  let left = THOUGHTS_MAX_CHARS;
  for (const s of segments) {
    if (left <= 0) break;
    out.push(s.text.length > left ? { at: s.at, text: s.text.slice(0, left) + " …" } : s);
    left -= s.text.length;
  }
  return out;
}

export function summarizeResearch(r: ResearchTrace | null | undefined): ResearchSummary | null {
  if (!r) return null;
  return { rounds: r.rounds, toolCalls: r.toolCalls.length, liveUrls: r.liveUrls, budgetExceeded: r.budgetExceeded, notes: r.notes, error: r.error ?? null };
}

const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: "Searching knowledge base",
  search_programs: "Searching program records",
  web_search: "Searching the web",
  fetch_page: "Reading page",
  // Gmail and Drive (Google's MCP servers), read as the consultant: "your" mail and files.
  gmail_search_threads: "Searching your Gmail",
  gmail_get_thread: "Reading an email thread",
  gmail_get_message: "Reading an email",
  gmail_list_drafts: "Checking your Gmail drafts",
  gmail_create_draft: "Preparing a Gmail draft",
  drive_search_files: "Searching your Drive",
  drive_read_file_content: "Reading a Drive file",
  drive_get_file_metadata: "Checking a Drive file",
  drive_list_recent_files: "Listing your recent Drive files",
  calendar_list_events: "Checking your calendar",
  calendar_search_events: "Searching your calendar",
  calendar_get_event: "Opening a calendar event",
  calendar_list_calendars: "Listing your calendars",
  calendar_suggest_time: "Finding a free time",
  calendar_create_event: "Preparing a calendar event",
  docs_create_doc: "Preparing a Google Doc",
  docs_create_sheet: "Preparing a Google Sheet",
  // CRM (crm-api over MCP). Phrased from the consultant's point of view, because these read
  // *their* records: the reasoning trace should say "Checking your tasks", not "crm_list_my_tasks".
  crm_get_me: "Checking who you are in the CRM",
  crm_list_my_tasks: "Checking your tasks and follow-ups",
  crm_list_my_contacts: "Looking up your students",
  crm_get_student_overview: "Pulling up the student's full record",
  crm_search_contacts: "Searching contacts",
  crm_get_contact: "Opening the contact record",
  crm_search_enquiries: "Searching enquiries",
  crm_list_enquiries: "Listing enquiries",
  crm_get_enquiry: "Opening the enquiry",
  crm_list_deals: "Listing deals",
  crm_get_deal: "Opening the deal",
  crm_list_notes: "Reading the notes on file",
  crm_list_interested_services: "Checking the service list",
};

/** Human-readable progress line for a research tool call. */
/** Adds the comparison branch's country (set by the research node as `researchCountry` run metadata), when there is one. */
function withCountry(event: ToolEvent, metadata: Record<string, unknown> | undefined): ToolEvent {
  const country = metadata?.researchCountry;
  return typeof country === "string" ? { ...event, country } : event;
}

export function toolEvent(tool: string, status: "start" | "end", input: unknown): ToolEvent {
  const args = (input && typeof input === "object" ? (("input" in (input as Record<string, unknown>) ? (input as { input: unknown }).input : input) as Record<string, unknown>) : {}) ?? {};
  const query = typeof args.query === "string" ? args.query : undefined;
  const url = typeof args.url === "string" ? args.url : undefined;
  let label = TOOL_LABELS[tool] ?? tool;
  if (url) {
    try {
      const u = new URL(url);
      label = `${label} ${u.hostname.replace(/^www\./, "")}${u.pathname.length > 1 ? u.pathname.slice(0, 40) : ""}`;
    } catch {
      label = `${label} ${url.slice(0, 60)}`;
    }
  } else if (query) label = `${label}: ${query.slice(0, 80)}`;
  else if (typeof args.site === "string") label = `${label} on ${args.site}`;
  return { tool, status, label, query, url };
}

export function summarize(intent: Intent): IntentSummary {
  return {
    primary: intent.primary_intent,
    secondary: intent.secondary_intents,
    task: intent.task,
    needsResearch: intent.needs_research,
    confidence: intent.confidence_level,
    inScope: !intent.contextual_flags.includes("prompt_injection_attempt"),
    destinations: intent.destinations,
    flags: intent.contextual_flags,
    language: intent.language,
  };
}
