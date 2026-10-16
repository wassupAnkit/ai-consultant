import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import type { Runnable, RunnableConfig } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { extractUrls } from "../live/policy";
import { logger } from "../observability/logger";
import { compileTemplate, promptDate } from "../prompts/compile";
import { guidedStudentLine } from "../prompts/journey";
import { PROMPT_NAMES, type PromptRegistry } from "../prompts/registry";
import type { RetrievedChunk } from "../retrieval/store";
import type { Destination } from "../schemas/intent.schema";
import type { CrmProvider } from "../crm/client";
import type { CrmWriteService } from "../crm/approvals/service";
import { mentionsWorkspace } from "../google/mentions";
import type { WorkspaceProvider } from "../google/types";
import { buildResearchTools, EvidenceCollector, type ResearchTools } from "../tools";
import { normalizeForMatch } from "../tools/fetch-page";
import { programToChunk } from "../tools/programs";
import { EMPTY_RESEARCH, type ResearchTrace, type ToolCallRecord } from "../tools/types";
import { crmStudentFromReads, pendingStudentOverview, type CrmRead } from "../crm/student";
import { withTimeout } from "../util/signals";
import { chunkThinking, contentToText, destinationLabels, guideDestinations, THINKING_EVENT } from "./nodes";
import { queryVocabulary, renderSkillsBrief, type ResolvedPacks } from "../skills";
import { marketGuideExcerpts } from "../skills/market-guides";
import { complianceGuideExcerpts } from "../skills/compliance-guides";
import { factsRegisterExcerpts } from "../skills/facts-register";
import { DESTINATION_LABELS } from "../schemas/intent.schema";
import { indexedOfficialHits, officialSearchPlan, runOfficialSearch } from "./freshness";
import { fxPlan, runFxSearch } from "./fx";
import { helplinePlaces, runHelplineSearches } from "./helpline";
import { mergeBranches } from "./merge-evidence";
import { scopeResearch, UNSCOPED, type ResearchScope } from "./scoping";
import { crmFollowUpStudent } from "./crm-followup";
import { researchRoundCap } from "./round-cap";
import { RESEARCH_TAG, type EdgeStateType, type EdgeStateUpdate } from "./state";

/** A chat model that may support tool binding (LangChain `BaseChatModel`-like). Fakes without `bindTools` disable the loop. */
export interface ToolCapableModel extends Runnable<BaseMessage[], unknown> {
  bindTools?: (tools: StructuredToolInterface[], kwargs?: Record<string, unknown>) => Runnable<BaseMessage[], unknown>;
}

export interface ResearchConfig {
  /** Tool-calling rounds after the deterministic knowledge-base search. 0 = knowledge base only. */
  maxRounds: number;
  /** Wall-clock budget for the whole research phase. */
  budgetMs: number;
  maxEvidence: number;
  topK: number;
  /** Per tool call cap (default 12 s). */
  toolTimeoutMs?: number;
  /** Max tool calls executed per round (default 4). */
  maxCallsPerRound?: number;
  /** Cap on one research model call; unset or 0 = only the budget caps it (RESEARCH_ROUND_TIMEOUT_MS). */
  roundTimeoutMs?: number;
  /** Budget a round needs left to start (default 1,500 ms; RESEARCH_MIN_ROUND_MS). */
  minRoundMs?: number;
  /** Model rounds for an urgent turn (distress, self-harm, safeguarding); unset = maxRounds (see round-cap.ts). */
  urgentMaxRounds?: number;
  /** Model rounds for a short-first question not about a person; unset = maxRounds (see round-cap.ts). */
  shortMaxRounds?: number;
  /**
   * Cancel the round-0 live official search once the knowledge base returned at least this many
   * indexed official chunks for the planned country (OFFICIAL_KB_MIN_HITS); unset or 0 = always wait.
   */
  officialKbMinHits?: number;
  /** Scope the tool set and round 0 by the classified intent (default true; see `scoping.ts`). */
  intentScoping?: boolean;
  /**
   * Stream each round so the model's reasoning reaches the client while it thinks, not after.
   * Set for OpenRouter research models only: Gemini's tool-calling turns carry thought signatures
   * that must be echoed back verbatim, and an invoked message is the form known to keep them.
   */
  streamReasoning?: boolean;
  /** Research a comparison one country per concurrent branch, then merge (default false; see `planFanout`). */
  compareFanout?: boolean;
  /** Countries a fan-out researches (default 3); the rest of the route is noted as not researched. */
  compareMaxCountries?: number;
  /** Tool-calling rounds per branch (default 2), capped at `maxRounds`. */
  compareBranchRounds?: number;
  /** Round-0 compliance-guide excerpts for compliance questions (on with SKILL_PACKS_ENABLED or MARKET_PACKS_ENABLED). */
  complianceGuides?: boolean;
  /** Round-0 facts-register excerpts for rule- and figure-shaped questions (FACTS_REGISTER_ENABLED; default on). */
  factsRegister?: boolean;
  /** Round-0 central-bank rate search when a home-currency total is asked (FX_RATES_ENABLED; default on, needs web search). */
  fxRates?: boolean;
}

export interface ResearchDeps {
  tools: Omit<ResearchTools, "crm" | "gmail" | "drive" | "calendar" | "docs">;
  /** Resolves this consultant's own CRM toolset. Skipped when absent or the actor is unknown. */
  crmProvider?: CrmProvider;
  /** CRM front end origin, so CRM evidence can link to the record it came from. */
  crmWebUrl?: string;
  /** CRM write approval; without it write tools are never offered. */
  crmWrites?: CrmWriteService;
  /** Gmail draft approval; without it gmail_create_draft is never offered. */
  gmailDrafts?: CrmWriteService;
  /** Resolves this consultant's own Gmail and Drive toolsets. Absent when the Google integration is off. */
  workspaceProvider?: WorkspaceProvider;
  researchModel?: ToolCapableModel;
  prompts: PromptRegistry;
  config: ResearchConfig;
}

const MIN_REMAINING_MS = 1_500;

/** Why the model-driven rounds ended (meta.researchStop). */
export type ResearchStop = "model_done" | "max_rounds" | "budget" | "round_timeout" | "evidence_full" | "error";
/** Round-0 knowledge-base query cap (characters), pack vocabulary included. */
const ROUND0_QUERY_MAX = 1_000;
/** Pack vocabulary terms appended to the round-0 knowledge-base query. */
const ROUND0_VOCABULARY = 6;

/**
 * Research node: round 0 is the deterministic knowledge-base search (what the
 * old `retrieve` node did); then, within a wall-clock budget, a bounded
 * tool-calling loop lets the research model fill gaps with narrower KB queries,
 * structured program lookups, web searches and live page fetches. All evidence
 * lands in one collector with stable citation numbers. Never throws: whatever
 * was gathered before a failure or the budget ran out is handed to `generate`.
 *
 * A comparison (COMPARE_FANOUT_ENABLED) runs that loop once per country,
 * concurrently and still inside this one node, then merges the evidence
 * (`runFanout`), so the answer model stays the only streamed one.
 */
export function makeResearchNode(deps: ResearchDeps) {
  return async function research(state: EdgeStateType, config: RunnableConfig): Promise<EdgeStateUpdate> {
    const started = performance.now();
    const deadline = started + deps.config.budgetMs;
    const intent = state.intent!;
    const meta: Record<string, unknown> = {};

    // Resolved per turn, not at boot: the toolset carries this consultant's own CRM token, so
    // the CRM's branch and assignee scoping applies to them and not to a shared identity.
    // forActor never throws — an unknown actor or an unreachable CRM simply yields undefined.
    // Resolved before round 0 because the scope depends on whether the CRM is reachable.
    // Gmail and Drive resolve alongside the CRM (both never throw), so connecting them costs no extra wait.
    // A distress turn (src/safety/distress.ts): crisis helplines for where the student is and their
    // home market, searched while the CRM resolves and added ahead of all other evidence, so the
    // answer can cite them and the context budget never drops them.
    const places = state.distress ? helplinePlaces(state.route, intent.contextual_flags) : [];
    const helplines = places.length && deps.tools.web ? runHelplineSearches(deps.tools.web, places, { signal: config.signal, timeoutMs: Math.max(500, Math.min(deps.config.toolTimeoutMs ?? 12_000, deadline - performance.now())) }) : null;
    const [crm, workspace] = await Promise.all([
      deps.crmProvider ? deps.crmProvider.forActor(state.actorEmail, config.signal) : undefined,
      deps.workspaceProvider ? deps.workspaceProvider.forActor(state.actorEmail, config.signal) : undefined,
    ]);
    const signals = state.intentExtras?.signals ?? [];
    // A guided session is always about one named student, and so is a follow-up on the earlier turn's
    // student, so the CRM stays in scope whatever the topic.
    const followUp = crmFollowUpStudent(state);
    const scope = deps.config.intentScoping === false ? UNSCOPED : scopeResearch(intent, { hasCrm: !!crm, studentNamed: signals.includes("student_named") || Boolean(state.guide) || Boolean(followUp), mentionsMail: mentionsWorkspace(state.input) });
    meta.scopeReason = scope.reason;
    // Fewer model rounds for an urgent turn (the safety reply comes first) or a short question.
    const cap = researchRoundCap(deps.config, state);
    if (cap.reason) meta.researchRoundCap = { reason: cap.reason, maxRounds: cap.maxRounds };

    // The route (decided at classify) layers the classifier's countries, the message's own, a
    // follow-up's carried-over ones and a guided student's CRM destinations. A state without one
    // (built outside the graph) keeps the older rule: classifier destinations, else guided ones.
    const countries = state.route ? state.route.countries : fallbackCountries(intent.destinations, state.guide);
    const fromGuide = state.route ? state.route.countrySource.includes("guide") : !intent.destinations.some((d) => d !== "other");
    if (fromGuide && countries.length) meta.round0GuideCountries = countries;

    const plan = planFanout(deps.config, state, { hasCrm: !!crm, signals });
    if (plan && "skipped" in plan) meta.route = { ...((state.meta.route as Record<string, unknown> | undefined) ?? state.route), fanoutSkipped: plan.skipped };
    if (plan && "countries" in plan) {
      const { collector, trace } = await runFanout(deps, state, config, { plan, scope, signals, deadline, meta, maxRounds: cap.maxRounds });
      if (helplines) addHelplines(collector, trace, meta, places, await helplines);
      if (workspace) trace.workspace = workspace.status;
      return researchUpdate(collector, trace, meta, started);
    }

    const collector = new EvidenceCollector(deps.config.maxEvidence);
    const helplineTrace: Pick<ResearchTrace, "toolCalls"> = { toolCalls: [] };
    if (helplines) addHelplines(collector, helplineTrace, meta, places, await helplines);
    const out = await runResearchLoop(deps, state, config, {
      scope,
      signals,
      countries,
      sources: { ...deps.tools, ...(crm ? { crm } : {}), ...(workspace?.gmail ? { gmail: workspace.gmail } : {}), ...(workspace?.drive ? { drive: workspace.drive } : {}), ...(workspace?.calendar ? { calendar: workspace.calendar } : {}), ...(workspace?.docs ? { docs: workspace.docs } : {}) },
      collector,
      maxRounds: cap.maxRounds,
      deadline,
      brief: state.skills ? renderSkillsBrief(state.skills) : "",
      vocabulary: state.skills ? queryVocabulary(state.skills, ROUND0_VOCABULARY) : [],
      destinations: destinationLabels(state),
      seedGuideRecord: true,
    });
    const trace = out.trace;
    trace.toolCalls.unshift(...helplineTrace.toolCalls);
    if (workspace) trace.workspace = workspace.status;
    // A guided session's student is already known; otherwise the student research read (if one) re-routes the answer.
    const crmStudent = state.guide ? null : crmStudentFromReads(out.crmReads);
    return { ...researchUpdate(collector, trace, { ...meta, ...out.meta }, started), crmStudent };
  };
}

/** What differs between one research loop and another (the single loop, or one comparison branch). */
export interface LoopRun {
  scope: ResearchScope;
  signals: readonly string[];
  /** Round-0 country filter for the knowledge base and program search. */
  countries: readonly Destination[];
  /** Tool sources this loop may build its tools from (a branch gets no CRM or Google ones). */
  sources: ResearchTools;
  collector: EvidenceCollector;
  maxRounds: number;
  /** Absolute `performance.now()` deadline; parallel branches share one. */
  deadline: number;
  /** Rendered country and market briefs for the research prompt ("" when no pack applies). */
  brief: string;
  /** Pack vocabulary (destination terms, then market terms) appended to the round-0 knowledge-base query. */
  vocabulary: readonly string[];
  /** The research prompt's "Destinations" line. */
  destinations: string;
  /** Seed a guided session's CRM record as [1] before round 0. */
  seedGuideRecord: boolean;
  /**
   * Comparison branch country: knowledge-base and program lookups are pinned to it, model runs are
   * named `research_round_<n>:<country>` and tool runs carry it as `researchCountry` metadata.
   */
  branch?: Destination;
}

export interface LoopResult {
  trace: ResearchTrace;
  meta: Record<string, unknown>;
  /** Successful CRM reads with their structured results, in call order. */
  crmReads: CrmRead[];
}

/**
 * One research loop: round 0 (deterministic knowledge-base and program search), then up to
 * `maxRounds` tool-calling rounds within the deadline. Evidence lands in `run.collector`.
 * Never throws for a model or tool failure; the trace records it.
 */
export async function runResearchLoop(deps: ResearchDeps, state: EdgeStateType, config: RunnableConfig, run: LoopRun): Promise<LoopResult> {
  const intent = state.intent!;
  const { scope, collector, countries } = run;
  const trace: ResearchTrace = { rounds: 0, budgetExceeded: false, toolCalls: [], liveUrls: [], notes: null, error: null };
  const meta: Record<string, unknown> = {};

  // A guided session's student is already resolved: their CRM record goes in first ([1]), so
  // the planner and the answer see the case facts without a model-chosen CRM lookup.
  if (run.seedGuideRecord && state.guide?.record) collector.add([state.guide.record], "crm", false);

  // A rule or figure question (the freshness trigger) on a destination with a facts register: its
  // Closed or replaced table and the best-matching topic table, dated and numbered ahead of the
  // other evidence, so a superseded rule or stale fee is never the only thing the answer sees
  // (see src/skills/facts-register.ts).
  if (deps.config.factsRegister !== false && scope.round0.knowledge !== null) {
    const text = [intent.user_question, state.input].filter(Boolean).join("\n");
    const facts = factsRegisterExcerpts({ topic: intent.primary_intent, text, countries, flags: intent.contextual_flags });
    if (facts.length) meta.round0FactsRegister = collector.add(facts, "kb", false).map((i) => i.id);
  }

  // The student's market guide (market packs on and an origin resolved): the origin-side steps or
  // money section and this loop's destination blocks, as citable evidence ahead of the knowledge
  // base, so a Nepal-side step can be stated with a citation even when no indexed page covers it.
  const guides = marketGuideExcerpts({ market: state.skills?.market?.market, topic: intent.primary_intent, countries });
  if (guides.length) meta.round0MarketGuides = collector.add(guides, "kb", false).map((i) => i.id);

  // A compliance question (commission, transfers, migration advice, ethics…): the destination's
  // agent-code section and the origin market's agency rules, so the answer cites the rule
  // instead of coaching a breach (see src/skills/compliance-guides.ts).
  if (deps.config.complianceGuides) {
    const text = [intent.user_question, state.input].filter(Boolean).join("\n");
    const rules = complianceGuideExcerpts({ topic: intent.primary_intent, text, countries, origin: state.route?.origin });
    if (rules.length) meta.round0ComplianceGuides = collector.add(rules, "kb", false).map((i) => i.id);
  }

  // --- Round 0: deterministic search (knowledge base, plus program records for program-shaped topics) ---
  const queryText = round0QueryText([intent.user_question, state.input].filter(Boolean).join("\n"), run.vocabulary);
  let kbChunks: RetrievedChunk[] = [];
  const t0 = performance.now();
  // Rules, fees and policy: one search on the destination's official immigration site beside the
  // knowledge base, so a stale indexed page is never the only evidence (see freshness.ts). The
  // nightly copy of the official pages (src/ingest/official.ts) usually answers first: once the
  // knowledge base returns enough of them for that country, the slower live search is cancelled.
  const official = run.sources.web && scope.round0.knowledge !== null ? officialSearchPlan(intent, state.input, countries) : null;
  const liveOfficial = new AbortController();
  const officialKbMinHits = deps.config.officialKbMinHits ?? 0;
  let officialIndexed = 0;
  const kbSearch = async () => {
    const filters = scope.round0.knowledge;
    if (filters === null) {
      meta.round0Knowledge = "skipped";
      return;
    }
    // The student's market re-ranks experteducation.com pages (own section, then global, then other markets').
    const base = { text: queryText, k: deps.config.topK, countries: countries.length ? [...countries] : undefined, ...(state.route?.origin ? { market: state.route.origin } : {}) };
    const filtered = !!(filters.sourceKinds?.length || filters.docTypes?.length);
    try {
      kbChunks = await run.sources.knowledge.search({ ...base, ...filters }, { signal: config.signal });
      // A filter is a preference, not a gate: an empty filtered search is retried plain so the
      // consultant never gets a blank knowledge base because the classifier picked a narrow topic.
      if (filtered && !kbChunks.length) {
        meta.round0FilterFallback = true;
        kbChunks = await run.sources.knowledge.search(base, { signal: config.signal });
      }
      if (filtered) meta.round0Filters = filters;
      collector.add(kbChunks, "kb", false);
      if (official) {
        officialIndexed = indexedOfficialHits(kbChunks, official.country);
        if (officialKbMinHits > 0 && officialIndexed >= officialKbMinHits) liveOfficial.abort();
      }
    } catch (err) {
      logger.warn("knowledge retrieval failed; continuing research without it", { err: (err as Error).message });
      meta.retrievalError = true;
    }
  };
  const programSearch = async () => {
    if (!scope.round0.programs || !run.sources.programs) return;
    try {
      const records = await run.sources.programs.search(
        {
          query: (intent.study_area ? `${intent.study_area} ${intent.user_question}` : intent.user_question).slice(0, 200),
          // `country` stays for program searches that only know one; a comparison searches every routed country.
          country: countries[0],
          countries: countries.length ? [...countries] : undefined,
          level: intent.study_level !== "unspecified" ? intent.study_level : undefined,
          limit: 6,
        },
        { signal: config.signal },
      );
      meta.round0Programs = collector.add(records.map(programToChunk), "programs", false).length;
    } catch (err) {
      logger.warn("round-0 program search failed; continuing without it", { err: (err as Error).message });
      meta.round0ProgramsError = true;
    }
  };
  const officialSearch = async () =>
    official && run.sources.web
      ? runOfficialSearch(run.sources.web, official, {
          signal: config.signal,
          cancel: liveOfficial.signal,
          timeoutMs: Math.max(500, Math.min(deps.config.toolTimeoutMs ?? 12_000, run.deadline - performance.now())),
        })
      : null;
  // A home-currency total ("in NPR", "in lakh", "in our currency"): today's rate from the source
  // market's central bank, or no FX evidence at all, so the answer never converts at a guessed
  // rate (see fx.ts).
  const fx = run.sources.web && deps.config.fxRates !== false ? fxPlan([intent.user_question, state.input].filter(Boolean).join("\n"), state.route?.origin, countries) : null;
  const fxSearch = async () =>
    fx && run.sources.web ? runFxSearch(run.sources.web, fx, { signal: config.signal, timeoutMs: Math.max(500, Math.min(deps.config.toolTimeoutMs ?? 12_000, run.deadline - performance.now())) }) : null;
  const [, , officialOut, fxOut] = await Promise.all([kbSearch(), programSearch(), officialSearch(), fxSearch()]);
  meta.retrieveMs = Math.round(performance.now() - t0);
  meta.retrieved = kbChunks.length;
  if (official && officialOut?.cancelled) {
    meta.round0Official = { site: official.site, added: 0, indexed: officialIndexed, live: "cancelled" };
  } else if (official && officialOut) {
    const added = collector.add(officialOut.chunks, "web", true);
    officialOut.record.added = added.length;
    if (added.length) officialOut.record.urls = [...new Set(added.map((i) => i.url))];
    trace.toolCalls.push(officialOut.record);
    meta.round0Official = { site: official.site, added: added.length };
  }
  if (fx && fxOut) {
    const added = collector.add(fxOut.chunks, "web", true);
    fxOut.record.added = added.length;
    if (added.length) fxOut.record.urls = [...new Set(added.map((i) => i.url))];
    trace.toolCalls.push(fxOut.record);
    meta.round0Fx = { site: fx.site, currency: fx.currency, base: fx.base, added: added.length };
  }

  // --- Rounds 1..N: model-driven tool calls ----------------------------------
  const explicitUrls = new Set(extractUrls(state.input).map(normalizeForMatch));
  const proposals: string[] = [];
  const crmReads: CrmRead[] = [];
  const tools = buildResearchTools(run.sources, { collector, explicitUrls, topK: deps.config.topK, signal: config.signal, proposals, crmReads, ...(state.route?.origin ? { market: state.route.origin } : {}), ...(state.actorEmail ? { actor: state.actorEmail } : {}), ...(deps.crmWebUrl ? { crmWebUrl: deps.crmWebUrl } : {}), ...(deps.crmWrites ? { crmWrites: deps.crmWrites } : {}), ...(deps.gmailDrafts ? { gmailDrafts: deps.gmailDrafts } : {}) }).filter((t) =>
    scope.tools(t.name),
  );
  meta.toolsOffered = tools.map((t) => t.name);
  const overviewTool = tools.find((t) => t.name === "crm_get_student_overview");
  /** Reads one student's overview through the CRM tool (numbered CRM evidence, a recorded call); false when it failed. */
  const readOverview = async (id: string) => {
    const args = { id };
    const before = collector.items.length;
    const tStart = performance.now();
    const record: ToolCallRecord = { tool: overviewTool!.name, args, ms: 0, ok: true, added: 0 };
    try {
      const out = await Promise.race([
        overviewTool!.invoke(args, { ...config, signal: config.signal }),
        rejectAfter(Math.max(500, Math.min(deps.config.toolTimeoutMs ?? 12_000, run.deadline - performance.now())), overviewTool!.name),
      ]);
      const content = typeof out === "string" ? out : contentToText((out as { content?: unknown })?.content ?? out);
      if (/^error\b/i.test(content)) {
        record.ok = false;
        record.error = content.slice(0, 300);
      }
    } catch (err) {
      record.ok = false;
      record.error = (err as Error).message.slice(0, 300);
    }
    record.ms = Math.round(performance.now() - tStart);
    record.added = collector.items.length - before;
    trace.toolCalls.push(record);
    return record.ok;
  };

  // A follow-up on the student an earlier turn read: their overview is read here, before the model
  // plans, so the answer states their enquiries, deals and applications from this turn's record
  // rather than from what the conversation history happens to say.
  const followUp = run.branch || state.guide ? null : crmFollowUpStudent(state);
  if (followUp && overviewTool && !collector.full) {
    meta.crmFollowUp = followUp.contactId;
    meta.crmFollowUpRead = await readOverview(followUp.contactId);
  }

  const bound = deps.researchModel?.bindTools && run.maxRounds > 0 && tools.length ? deps.researchModel.bindTools(tools) : null;

  if (bound) {
    const byName = new Map(tools.map((t) => [t.name, t]));
    const prompt = await deps.prompts.get(PROMPT_NAMES.research);
    const systemText = compileTemplate(prompt.text, {
      // "" (never undefined) without packs, so the placeholder compiles to a blank line.
      country_brief: run.brief,
      today: promptDate(),
      task: intent.task,
      primary_intent: intent.primary_intent,
      destinations: run.destinations,
      user_question: intent.user_question,
      contextual_flags: intent.contextual_flags.join(", ") || "none",
      signals: run.signals.join(", ") || "none",
      guided_student: guidedStudentLine(state.guide?.snapshot ?? null),
      tools: tools.map((t) => `- ${t.name}: ${t.description}`).join("\n"),
      round0: collector.items.length ? EvidenceCollector.summaryForModel(collector.items, 300) : "Nothing matched in the knowledge base.",
    });
    const messages: BaseMessage[] = [new SystemMessage(systemText), ...state.history.slice(-4), new HumanMessage(state.input)];
    meta.researchPromptName = prompt.name;
    meta.researchPromptSource = prompt.source;

    // Why the loop ended (meta.researchStop): the model said it was done, the round cap, the budget,
    // a round that hit its own timeout, a full collector, or a failed round.
    let stop: ResearchStop = "max_rounds";
    for (let round = 1; round <= run.maxRounds; round++) {
      const remaining = run.deadline - performance.now();
      // A round started this late would be cut at the deadline before its lookups could add anything.
      if (remaining < (deps.config.minRoundMs ?? MIN_REMAINING_MS)) {
        trace.budgetExceeded = true;
        stop = "budget";
        break;
      }
      // A hung provider call ends at the round timeout instead of holding the turn until the budget runs out.
      const roundLimit = deps.config.roundTimeoutMs ? Math.min(remaining, deps.config.roundTimeoutMs) : remaining;
      let ai: AIMessage;
      let thought = "";
      const roundConfig: RunnableConfig = {
        ...config,
        runName: `research_round_${round}${run.branch ? `:${run.branch}` : ""}`,
        tags: [...(config.tags ?? []), RESEARCH_TAG],
        signal: withTimeout(config.signal, roundLimit),
        metadata: { ...config.metadata, langfusePrompt: prompt.client, researchRound: round, ...(run.branch ? { researchCountry: run.branch } : {}) },
      };
      try {
        if (deps.config.streamReasoning) {
          let acc: AIMessageChunk | undefined;
          // A model without its own streaming yields its whole reply as one AIMessage.
          let whole: AIMessage | undefined;
          for await (const chunk of await bound.stream(messages, roundConfig)) {
            // Chunk first: in @langchain/core 1.x an AIMessageChunk is also `instanceof AIMessage`,
            // and treating it as a whole reply kept only the last, empty chunk and every tool call
            // streamed before it was lost (prod on DeepSeek made no CRM lookups at all).
            if (chunk instanceof AIMessageChunk) {
              /* accumulated below */
            } else if (chunk instanceof AIMessage) whole = chunk;
            else continue;
            const t = chunkThinking(chunk as AIMessage | AIMessageChunk);
            if (t) {
              thought += t;
              // Concurrent branches would interleave their fragments; a branch sends its round whole, below.
              if (!run.branch) await dispatchCustomEvent(THINKING_EVENT, { chunk: t }, config);
            }
            if (chunk instanceof AIMessageChunk) acc = acc ? acc.concat(chunk) : chunk;
          }
          if (run.branch && thought) await dispatchCustomEvent(THINKING_EVENT, { chunk: thought }, config);
          ai = whole ?? new AIMessage({
            content: acc?.content ?? "",
            tool_calls: acc?.tool_calls ?? [],
            invalid_tool_calls: acc?.invalid_tool_calls ?? [],
            additional_kwargs: acc?.additional_kwargs ?? {},
            response_metadata: acc?.response_metadata ?? {},
            ...(acc?.usage_metadata ? { usage_metadata: acc.usage_metadata } : {}),
            ...(acc?.id ? { id: acc.id } : {}),
          });
        } else {
          const out = await bound.invoke(messages, roundConfig);
          ai = out instanceof AIMessage ? out : new AIMessage({ content: contentToText((out as { content?: unknown })?.content ?? "") });
          // Invoked, so the round's reasoning arrives whole; it still lands before this round's lookups.
          thought = chunkThinking(ai);
          if (thought) await dispatchCustomEvent(THINKING_EVENT, { chunk: thought }, config);
        }
      } catch (err) {
        const e = err as Error;
        logger.warn("research round failed; answering with evidence gathered so far", { round, err: e.message });
        meta.researchError = `${e.name}: ${e.message}`.slice(0, 300);
        trace.error = e.message.slice(0, 300);
        const timedOut = e.name === "TimeoutError" || e.name === "AbortError";
        // The round's own timeout, not the budget, when it was the tighter limit and the request is still live.
        if (timedOut && roundLimit < remaining && !config.signal?.aborted) stop = "round_timeout";
        else {
          if (timedOut) trace.budgetExceeded = true;
          stop = timedOut ? "budget" : "error";
        }
        break;
      }
      trace.rounds = round;
      if (thought.trim()) (trace.thoughts ??= []).push({ at: trace.toolCalls.length, text: thought.trim() });
      // Append the model's message as returned: Gemini 3 needs its thought signatures echoed back verbatim.
      messages.push(ai);
      const calls = (ai.tool_calls ?? []).filter((tc) => tc.name && byName.has(tc.name)).slice(0, deps.config.maxCallsPerRound ?? 4);
      if (!calls.length) {
        trace.notes = contentToText(ai.content).trim().slice(0, 1_000) || null;
        // Unknown tool names → tell the model once and let it retry, otherwise we're done.
        const unknown = (ai.tool_calls ?? []).filter((tc) => tc.name && !byName.has(tc.name));
        if (!unknown.length) {
          stop = "model_done";
          break;
        }
        for (const tc of unknown) messages.push(new ToolMessage({ content: `error: unknown tool ${tc.name}`, tool_call_id: tc.id ?? tc.name, name: tc.name }));
        continue;
      }
      const results = await Promise.all(
        calls.map(async (tc) => {
          const t = byName.get(tc.name)!;
          const args = pinToCountry(tc.name, (tc.args ?? {}) as Record<string, unknown>, run.branch);
          const before = collector.items.length;
          const tStart = performance.now();
          const record: ToolCallRecord = { tool: tc.name, args, ms: 0, ok: true, added: 0 };
          let content: string;
          try {
            const remainingNow = run.deadline - performance.now();
            const out = await Promise.race([
              t.invoke(args, { ...config, signal: config.signal, ...(run.branch ? { metadata: { ...config.metadata, researchCountry: run.branch } } : {}) }),
              rejectAfter(Math.max(500, Math.min(deps.config.toolTimeoutMs ?? 12_000, remainingNow)), tc.name),
            ]);
            content = typeof out === "string" ? out : contentToText((out as { content?: unknown })?.content ?? out);
            // Tools report soft failures (policy denied, HTTP error, unsupported content) as "error …" text.
            if (/^error\b/i.test(content)) {
              record.ok = false;
              record.error = content.slice(0, 300);
            }
          } catch (err) {
            record.ok = false;
            record.error = (err as Error).message.slice(0, 300);
            content = `error: ${record.error}`;
          }
          record.ms = Math.round(performance.now() - tStart);
          record.added = collector.items.length - before;
          const urls = collector.items.slice(before).filter((i) => i.live).map((i) => i.url);
          if (urls.length) record.urls = [...new Set(urls)];
          return { record, message: new ToolMessage({ content, tool_call_id: tc.id ?? `${tc.name}-${round}`, name: tc.name }) };
        }),
      );
      for (const r of results) {
        trace.toolCalls.push(r.record);
        messages.push(r.message);
      }
      if (collector.full) {
        stop = "evidence_full";
        break;
      }
    }
    meta.researchStop = stop;
  }

  // A named student the model found (one search hit) but never opened: read the overview once
  // here, through the same tool, so the answer has their deals and applications and the route can
  // follow their nationality and destinations. The prompt asks for this; models often stop early.
  const pendingId = pendingStudentOverview(crmReads);
  if (pendingId && overviewTool && !collector.full && run.deadline - performance.now() > MIN_REMAINING_MS) {
    meta.studentOverviewFollowUp = await readOverview(pendingId);
  }

  trace.liveUrls = collector.liveUrls();
  if (proposals.length) trace.proposals = proposals;
  return { trace, meta, crmReads };
}

/** Tools a comparison branch may use: country research only, never a person's CRM record, mail or files. */
const BRANCH_TOOLS: ReadonlySet<string> = new Set(["search_knowledge_base", "search_programs", "web_search", "fetch_page", "search_compliance_guides"]);

export type FanoutPlan = { countries: Destination[]; dropped: Destination[] } | { skipped: string };

/**
 * Whether this turn's research fans out one branch per compared country. Null when fan-out is
 * off or the route is not a comparison. Skipped (with the reason recorded on `meta.route`) for
 * caseload work, which lives in the CRM, and for a named student outside a guided session when
 * the CRM is reachable: that turn needs a CRM lookup, which branches never make. A guided
 * session's student is already resolved, so it fans out with the record seeded first.
 */
export function planFanout(config: ResearchConfig, state: EdgeStateType, ctx: { hasCrm: boolean; signals: readonly string[] }): FanoutPlan | null {
  if (!config.compareFanout || state.route?.mode !== "comparison") return null;
  if (state.intent?.primary_intent === "caseload_management") return { skipped: "caseload" };
  if ((ctx.signals.includes("student_named") || crmFollowUpStudent(state)) && ctx.hasCrm && !state.guide) return { skipped: "named student needs a CRM lookup" };
  const max = config.compareMaxCountries ?? 3;
  return { countries: state.route.countries.slice(0, max), dropped: state.route.countries.slice(max) };
}

/**
 * Comparison fan-out: one research loop per country, run concurrently against the same deadline,
 * each with its own collector, its own country's brief and vocabulary, lookups pinned to that
 * country and only the country-research tools. The branches are merged (`mergeBranches`) into
 * the one collector and trace the answer reads. A branch that throws is reported in the notes;
 * the others still answer.
 */
async function runFanout(
  deps: ResearchDeps,
  state: EdgeStateType,
  config: RunnableConfig,
  ctx: { plan: { countries: Destination[]; dropped: Destination[] }; scope: ResearchScope; signals: readonly string[]; deadline: number; meta: Record<string, unknown>; maxRounds: number },
) {
  const { countries, dropped } = ctx.plan;
  const scope: ResearchScope = { ...ctx.scope, tools: (name) => BRANCH_TOOLS.has(name) && ctx.scope.tools(name) };
  const maxRounds = Math.min(deps.config.compareBranchRounds ?? 2, ctx.maxRounds);
  const outcomes = await Promise.all(
    countries.map(async (country) => {
      const collector = new EvidenceCollector(deps.config.maxEvidence);
      const packs = state.skills ? onlyCountry(state.skills, country) : null;
      const others = countries.filter((c) => c !== country).map((c) => DESTINATION_LABELS[c]);
      try {
        const out = await runResearchLoop(deps, state, config, {
          scope,
          signals: ctx.signals,
          countries: [country],
          sources: { ...deps.tools },
          collector,
          maxRounds,
          deadline: ctx.deadline,
          brief: packs ? renderSkillsBrief(packs) : "",
          vocabulary: packs ? queryVocabulary(packs, ROUND0_VOCABULARY) : [],
          destinations: `${DESTINATION_LABELS[country]} (one branch of a comparison with ${others.join(", ")}; research ${DESTINATION_LABELS[country]} only, the others are researched separately)`,
          seedGuideRecord: false,
          branch: country,
        });
        return { country, collector, trace: out.trace, meta: out.meta };
      } catch (err) {
        const message = (err as Error).message.slice(0, 300);
        logger.warn("comparison branch failed; answering from the other branches", { country, err: message });
        return { country, collector, trace: { ...EMPTY_RESEARCH, toolCalls: [], liveUrls: [], error: message }, meta: { branchError: message } as Record<string, unknown> };
      }
    }),
  );
  const { collector, trace } = mergeBranches(outcomes, { maxEvidence: deps.config.maxEvidence, guideRecord: state.guide?.record ?? null });
  if (dropped.length) trace.notes = `Compared the first ${countries.length} countries only; not researched: ${dropped.join(", ")}. ${trace.notes ?? ""}`.trim();

  const first = outcomes.find((o) => o.meta.researchPromptName)?.meta;
  Object.assign(ctx.meta, {
    fanout: { countries, ...(dropped.length ? { dropped } : {}), branches: Object.fromEntries(outcomes.map((o) => [o.country, o.meta])) },
    toolsOffered: [...new Set(outcomes.flatMap((o) => (o.meta.toolsOffered as string[] | undefined) ?? []))],
    retrieved: outcomes.reduce((n, o) => n + ((o.meta.retrieved as number | undefined) ?? 0), 0),
    retrieveMs: Math.max(0, ...outcomes.map((o) => (o.meta.retrieveMs as number | undefined) ?? 0)),
    ...(first ? { researchPromptName: first.researchPromptName, researchPromptSource: first.researchPromptSource } : {}),
  });
  return { collector, trace };
}

/** The resolved packs narrowed to one country (empty when it has no pack); the student's market pack is kept for every branch. */
function onlyCountry(resolved: ResolvedPacks, country: Destination): ResolvedPacks {
  const packs = resolved.packs.filter((p) => p.country === country);
  return { packs, versions: packs.map((p) => `${p.country}@${p.version}`), ...(resolved.market ? { market: resolved.market } : {}) };
}

/** A branch's knowledge-base and program lookups always search its own country, whatever the model asked for. */
function pinToCountry(tool: string, args: Record<string, unknown>, country: Destination | undefined): Record<string, unknown> {
  if (!country) return args;
  if (tool === "search_knowledge_base") return { ...args, countries: [country] };
  if (tool === "search_programs") return { ...args, country };
  return args;
}

/** The node's state update: the collected evidence, the trace, and the turn's research diagnostics. */
/** Helpline search results as live web evidence, their calls on the trace, and `meta.helplineSearch`. */
function addHelplines(collector: EvidenceCollector, trace: Pick<ResearchTrace, "toolCalls">, meta: Record<string, unknown>, places: string[], outs: Awaited<ReturnType<typeof runHelplineSearches>>) {
  let total = 0;
  for (const out of outs) {
    const added = collector.add(out.chunks, "web", true);
    out.record.added = added.length;
    if (added.length) out.record.urls = [...new Set(added.map((i) => i.url))];
    trace.toolCalls.push(out.record);
    total += added.length;
  }
  meta.helplineSearch = { places, added: total };
}

function researchUpdate(collector: EvidenceCollector, trace: ResearchTrace, meta: Record<string, unknown>, started: number): EdgeStateUpdate {
  return {
    chunks: collector.items.filter((i) => i.kind === "kb"),
    evidence: collector.items,
    researchTrace: trace,
    meta: {
      ...meta,
      researchMs: Math.round(performance.now() - started),
      researchRounds: trace.rounds,
      toolCalls: trace.toolCalls.length,
      liveUrls: trace.liveUrls,
      budgetExceeded: trace.budgetExceeded,
      evidenceCount: collector.items.length,
    },
  };
}

/** Classifier destinations without "other", else a guided student's CRM destinations: round 0 for a state with no route. */
function fallbackCountries(destinations: readonly Destination[], guide: EdgeStateType["guide"]): Destination[] {
  const named = destinations.filter((d): d is Destination => d !== "other");
  return named.length ? named : guideDestinations(guide);
}

/**
 * The round-0 knowledge-base query: the request, then the pack vocabulary on its own line. The
 * request is shortened rather than the vocabulary, so a long message still gets its expansion.
 */
export function round0QueryText(base: string, vocabulary: readonly string[]): string {
  const expansion = vocabulary.join("; ");
  if (!expansion) return base.slice(0, ROUND0_QUERY_MAX);
  return `${base.slice(0, Math.max(0, ROUND0_QUERY_MAX - expansion.length - 1))}\n${expansion}`.slice(0, ROUND0_QUERY_MAX);
}

function rejectAfter(ms: number, tool: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`${tool} timed out after ${ms} ms`)), ms));
}
