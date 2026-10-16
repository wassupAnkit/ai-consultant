import { SERVICE_LABELS, WORKSPACE_SERVICES } from "../google/types";
import type { RunnableConfig } from "@langchain/core/runnables";
import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import { CLASSIFY_TIMEOUT_MS, type Env } from "../config/env";
import { compileTemplate, promptDate } from "../prompts/compile";
import { adviserInstruction, disclaimerFor, needsAdviserLine } from "../prompts/intents";
import { PROMPT_NAMES, type PromptRegistry } from "../prompts/registry";
import { sha256 } from "../activity/identity";
import { NO_CONTEXT_NOTE, NO_RESEARCH_NOTE, SAFE_FALLBACK_ANSWER } from "../prompts/consultant";
import { renderGuidedSession } from "../prompts/journey";
import { citedSources, CONTEXT_MAX_CHARS, formatContext, stripDanglingCitations } from "../retrieval/format";
import { runawayCut, type RunawayReason } from "./runaway";
import { crmAmbiguityNote, dropBasedOnLines } from "./answer-checks";
import { checkAnswerFigures } from "./answer-check";
import { figureCheck, isNonEnglishDraft } from "./draft-check";
import { SHORT_FIRST_INSTRUCTION, wantsShortFirst } from "./short-first";
import { refersBack, withEarlierSources, withFullAnswers } from "../memory/recall";
import { isRewriteOfPrevious, REWRITE_INSTRUCTION } from "./rewrite";
import { distressInstruction, helplinePlaces } from "./helpline";
import { detectDistress } from "../safety/distress";
import type { KnowledgeStore } from "../retrieval/store";
import { looksLikeInjection } from "../safety/sanitize";
import { ClassifierExtrasSchema, DESTINATION_LABELS, FALLBACK_INTENT, type Destination, IntentSchema, STRICT_CITATION_TASKS, type ClassifierExtras, type Intent } from "../schemas/intent.schema";
import { logger } from "../observability/logger";
import type { ResearchTools } from "../tools";
import { withTimeout } from "../util/signals";
import type { CrmProvider } from "../crm/client";
import type { CrmWriteService } from "../crm/approvals/service";
import { mentionsWorkspace } from "../google/mentions";
import { namedEvidenceRow, namedRowInstruction } from "../skills/facts-register";
import type { WorkspaceProvider } from "../google/types";
import type { ResearchConfig, ToolCapableModel } from "./research";
import { ANSWER_TAG, type EdgeStateType, type EdgeStateUpdate, type GuideContext } from "./state";
import type { EvidenceItem } from "../tools/types";
import { destinationsFromNames } from "../routing/countries";
import { MARKET_LABELS, marketFromName, ONSHORE_LABELS, type Market } from "../routing/markets";
import { decideRoute, withCrmStudent, type RouteDecision } from "../routing/route";
import { crmResearchReason } from "./crm-followup";
import { loadMarketProse, loadPackProse, renderSkillsGuidance, resolveMarket, resolvePacks, type ResolvedPacks } from "../skills";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { forcedResearchReason } from "./freshness";
import { rerouteEvidence } from "./reroute-evidence";
import { currencyInstruction, fxPlan, runFxSearch, type FxPlan } from "./fx";
import { EvidenceCollector } from "../tools/evidence";
import { documentInstruction, type DocumentIntakeDeps } from "./documents";
import type { RetrievedChunk } from "../retrieval/store";

/** Tasks whose answer is text the counsellor sends on: a check note there is marked as not part of it. */
const DRAFT_FOR_OTHERS = new Set<Intent["task"]>(["draft", "translate", "summarize"]);

// A hung classifier call must not eat the whole request budget (CLASSIFY_TIMEOUT_MS, src/config/env.ts);
// the fallback intent still researches.
/** Default answer budget (ANSWER_TIMEOUT_MS overrides): a safety net against a stalled stream. */
const GENERATE_TIMEOUT_MS = 45_000;
/** DeepThink answers reason before answering, which is slow; DEEP_THINK_TIMEOUT_MS overrides. */
const DEEP_GENERATE_TIMEOUT_MS = 75_000;
/** The fallback model's own budget once the primary failed before any token; FALLBACK_TIMEOUT_MS overrides. */
const FALLBACK_GENERATE_TIMEOUT_MS = 25_000;

/**
 * A model the answer node can stream from, chunk by chunk. Typed as a Runnable rather than a
 * chat model so tests can substitute anything streamable.
 */
export type AnswerModel = Runnable<BaseMessage[], { content: unknown }>;

/** Everything the graph needs from the outside world, injected for testability. */
export interface GraphDeps {
  env: Pick<Env, "RETRIEVAL_TOP_K"> &
    Partial<Pick<Env, "CONTEXT_MAX_CHARS" | "RESEARCH_MAX_ROUNDS" | "RESEARCH_BUDGET_MS" | "RESEARCH_MAX_EVIDENCE" | "RESEARCH_INTENT_SCOPING" | "CRM_WEB_URL" | "ANSWER_TIMEOUT_MS" | "DEEP_THINK_TIMEOUT_MS" | "FALLBACK_TIMEOUT_MS" | "SKILL_PACKS_ENABLED" | "MARKET_PACKS_ENABLED" | "COMPARE_FANOUT_ENABLED" | "COMPARE_MAX_COUNTRIES" | "COMPARE_BRANCH_ROUNDS" | "RESEARCH_ROUND_TIMEOUT_MS" | "RESEARCH_MIN_ROUND_MS" | "RESEARCH_URGENT_MAX_ROUNDS" | "RESEARCH_SHORT_MAX_ROUNDS">>;
  /** Structured-output classifier: messages → Intent-shaped object (validated with IntentSchema). */
  classifier: Runnable<BaseMessage[], unknown>;
  /** Primary answer model. Streamed (never `withFallbacks`-wrapped) so thought parts survive — see `createAnswerModel`. */
  answerModel: AnswerModel;
  /** Cheaper model the answer node degrades to when the primary fails before streaming anything. */
  answerFallbackModel?: AnswerModel;
  /** The primary at a higher reasoning effort, for DeepThink turns. Absent → DeepThink uses the primary. */
  answerDeepModel?: AnswerModel;
  knowledge: KnowledgeStore;
  prompts: PromptRegistry;
  /** Tool-calling model for the research loop. Absent (or without `bindTools`) → knowledge-base search only. */
  researchModel?: ToolCapableModel;
  /** Research tools beyond the knowledge base (programs, web search, live fetch). */
  tools?: Omit<ResearchTools, "knowledge" | "crm" | "gmail" | "drive" | "calendar" | "docs">;
  /** Resolves a CRM toolset for the acting consultant; per-user, so CRM permissions hold. */
  crmProvider?: CrmProvider;
  /** CRM write approval: write tools become proposals. Absent → write tools are never offered. */
  crmWrites?: CrmWriteService;
  /** Gmail draft approval: gmail_create_draft becomes a proposal. Absent → drafts are never offered. */
  gmailDrafts?: CrmWriteService;
  /** Resolves the acting consultant's own Gmail and Drive toolsets. Absent → no Google tools. */
  workspaceProvider?: WorkspaceProvider;
  research?: Partial<ResearchConfig>;
  /** Country skill packs for this graph; overrides SKILL_PACKS_ENABLED (tests turn them on here). */
  skillPacks?: boolean;
  /** Market packs for this graph; overrides MARKET_PACKS_ENABLED. Absent → whatever skill packs are. */
  marketPacks?: boolean;
  /** Student document intake (STUDENT_DOCS_ENABLED). Absent → attachments are never read. */
  documents?: DocumentIntakeDeps;
}

const HISTORY_FOR_CLASSIFIER = 4;
/** Tasks that produce text for someone else: they get the per-turn currency rule (`currencyInstruction`). */
const TEXT_TASKS = new Set<Intent["task"]>(["translate", "draft"]);

export function makeNodes(deps: GraphDeps) {
  const skillPacks = deps.skillPacks ?? deps.env.SKILL_PACKS_ENABLED ?? false;
  const marketPacks = deps.marketPacks ?? deps.env.MARKET_PACKS_ENABLED ?? skillPacks;
  const fxRates = deps.research?.fxRates ?? (deps.env as Partial<Pick<Env, "FX_RATES_ENABLED">>).FX_RATES_ENABLED ?? true;
  const answerFigureCheck = (deps.env as Partial<Pick<Env, "ANSWER_FIGURE_CHECK_ENABLED">>).ANSWER_FIGURE_CHECK_ENABLED ?? true;
  const maxEvidence = deps.research?.maxEvidence ?? deps.env.RESEARCH_MAX_EVIDENCE ?? 24;
  // The round-0 guide switches (as wired in buildGraph), for the excerpts a CRM-student re-route adds.
  const factsRegister = deps.research?.factsRegister ?? (deps.env as Partial<Pick<Env, "FACTS_REGISTER_ENABLED">>).FACTS_REGISTER_ENABLED ?? true;
  const complianceGuides = deps.research?.complianceGuides ?? (skillPacks || marketPacks);

  const isRewrite = (state: EdgeStateType) =>
    isRewriteOfPrevious({ intent: state.intent!, extras: state.intentExtras ?? null, input: state.input, hasPriorAnswer: Boolean(state.priorAnswer) });

  /**
   * A rewrite of the previous answer that asks for the parents' currency ("in lakh", "in rupees",
   * "in NPR"): the central bank's rate search round 0 would run, or null. Such a turn otherwise
   * skips research, and its home-currency figures had no rate to rest on (counsellor audit N23).
   */
  function rewriteFxPlan(state: EdgeStateType): FxPlan | null {
    if (!fxRates || !deps.tools?.web || !isRewrite(state)) return null;
    const intent = state.intent!;
    const countries = state.route ? state.route.countries : intent.destinations.filter((d) => d !== "other");
    return fxPlan([intent.user_question, state.input].filter(Boolean).join("\n"), state.route?.origin, countries);
  }

  async function classify(state: EdgeStateType, config: RunnableConfig): Promise<EdgeStateUpdate> {
    const started = performance.now();
    const prompt = await deps.prompts.get(PROMPT_NAMES.classifier);
    const profileNote = state.profile ? `\n\n# Staff context (from the consultant's saved profile)\n${formatProfile(state.profile)}` : "";
    const messages: BaseMessage[] = [
      new SystemMessage(prompt.text + profileNote),
      ...state.history.slice(-HISTORY_FOR_CLASSIFIER),
      new HumanMessage(state.input),
    ];
    let intent: Intent;
    let extras: ClassifierExtras | null = null;
    let classifierError: string | null = null;
    try {
      const raw = await deps.classifier.invoke(messages, {
        ...config,
        runName: "classify_intent",
        signal: withTimeout(config.signal, CLASSIFY_TIMEOUT_MS),
        metadata: { ...config.metadata, langfusePrompt: prompt.client },
      });
      intent = IntentSchema.parse(raw);
      // The Jev classifier returns decisions beyond the Intent contract alongside it.
      const parsedExtras = ClassifierExtrasSchema.safeParse((raw as { extras?: unknown })?.extras);
      extras = parsedExtras.success ? parsedExtras.data : null;
    } catch (err) {
      classifierError = (err as Error).message;
      logger.warn("intent classification failed; using fallback intent", { err: classifierError });
      intent = FALLBACK_INTENT(state.input);
    }
    if (looksLikeInjection(state.input) && !intent.contextual_flags.includes("prompt_injection_attempt")) {
      intent = { ...intent, contextual_flags: [...intent.contextual_flags, "prompt_injection_attempt"] };
    }
    // Distress or self-harm in any of the counsellors' languages, whatever the classifier said:
    // flagged, researched (crisis helplines, src/graph/helpline.ts) and answered safety-first.
    const distress = detectDistress(state.input);
    if (distress) {
      intent = { ...intent, needs_research: true, contextual_flags: intent.contextual_flags.includes("emotional_distress") ? intent.contextual_flags : [...intent.contextual_flags, "emotional_distress"] };
      if (distress.selfHarm && extras && !extras.signals.includes("crisis_safeguarding")) extras = { ...extras, signals: [...extras.signals, "crisis_safeguarding"] };
    }
    // A disputed fact or a recency question is always looked up again: answering it from memory
    // is how a superseded rule gets repeated (and an earlier statement denied).
    const researchForced = intent.needs_research ? null : forcedResearchReason(intent, state.input);
    if (researchForced) intent = { ...intent, needs_research: true };
    // Decided once here so research and the prompts agree on the countries; also set on the refuse path (unused there).
    const route = decideRoute({
      intent,
      extras,
      input: state.input,
      history: state.history.map((m) => contentToText(m.content)),
      priorDestinations: state.priorDestinations,
      guideCountries: guideDestinations(state.guide),
      priorOrigin: state.priorOrigin,
      guideOrigin: guideMarket(state.guide),
      profile: state.profile,
      counsellorRegion: state.counsellorRegion,
    });
    // Resolved once per turn, so research and the answer prompt load the same packs.
    const skills = resolveTurnSkills(route, intent, { skillPacks, marketPacks });
    return {
      intent,
      intentExtras: extras,
      route,
      skills,
      distress,
      meta: {
        ...(distress ? { distress } : {}),
        // The pack versions ride on the route, so a stored turn says which packs answered it.
        route: skills ? routeWithPacks(route, skills) : route,
        classifyMs: Math.round(performance.now() - started),
        classifier: extras?.classifier ?? "gemini",
        ...(extras ? { jevConfidence: extras.intent_confidence, jevMs: extras.latencyMs, jevCost: extras.cost, jevFallbackReason: extras.fallbackReason, audience: extras.audience, channel: extras.channel, stage: extras.stage, signals: extras.signals } : {}),
        classifierPromptName: prompt.name,
        classifierPromptSource: prompt.source,
        classifierPromptVersion: prompt.version ?? null,
        classifierTemplateHash: prompt.hash,
        classifierError,
        ...(researchForced ? { researchForced } : {}),
      },
    };
  }

  function route(state: EdgeStateType): "refuse" | "research" | "rates" | "generate" {
    const intent = state.intent!;
    if (intent.contextual_flags.includes("prompt_injection_attempt")) return "refuse";
    // Gmail and Drive live in the research loop: a message about the consultant's mail or files must reach it.
    // So do CRM questions (a follow-up on the last student, a named student, caseload): never answered
    // from history. A dispute or a recency flag researches too, even on a state classify did not upgrade.
    if (
      !intent.needs_research &&
      !(deps.workspaceProvider && mentionsWorkspace(state.input)) &&
      !crmResearchReason(state, Boolean(deps.crmProvider && state.actorEmail)) &&
      !forcedResearchReason(intent, state.input)
    )
      return rewriteFxPlan(state) ? "rates" : "generate";
    return "research";
  }

  /**
   * The central bank's rate for a rewrite that asks for the home currency (`rewriteFxPlan`), and
   * nothing else: the rewrite still uses only the previous answer's facts. Nothing official found
   * → no evidence and no trace, so the answer is prompted as a plain rewrite and says the rate
   * isn't available (`currencyInstruction`).
   */
  async function rates(state: EdgeStateType, config: RunnableConfig): Promise<EdgeStateUpdate> {
    const started = performance.now();
    const plan = rewriteFxPlan(state);
    if (!plan) return {};
    const out = await runFxSearch(deps.tools!.web!, plan, { signal: config.signal, timeoutMs: deps.research?.toolTimeoutMs ?? 12_000 });
    const collector = new EvidenceCollector(maxEvidence);
    const added = collector.add(out.chunks, "web", true);
    out.record.added = added.length;
    if (added.length) out.record.urls = [...new Set(added.map((i) => i.url))];
    const meta = { round0Fx: { site: plan.site, currency: plan.currency, base: plan.base, added: added.length }, researchMs: Math.round(performance.now() - started) };
    if (!added.length) return { meta };
    const notes = `Only ${plan.bank}'s exchange rate was looked up, for the home-currency figures in this rewrite.`;
    return {
      evidence: collector.items,
      chunks: [],
      researchTrace: { rounds: 0, budgetExceeded: false, toolCalls: [out.record], liveUrls: collector.liveUrls(), notes, error: null },
      meta: { ...meta, toolCalls: 1, liveUrls: collector.liveUrls(), evidenceCount: added.length },
    };
  }

  async function refuse(state: EdgeStateType): Promise<EdgeStateUpdate> {
    const intent = state.intent!;
    const template = await deps.prompts.get(PROMPT_NAMES.refusal);
    const topic = intent.user_question?.trim() ? `"${intent.user_question.trim().replace(/[.?!]+$/, "")}"` : "that request";
    return { answer: compileTemplate(template.text, { topic }), refused: true, sources: [], chunks: [], evidence: [] };
  }

  async function generate(state: EdgeStateType, config: RunnableConfig): Promise<EdgeStateUpdate> {
    const started = performance.now();
    const intent = state.intent!;
    // Research read a named CRM student: their record, not the counsellor's default, decides the
    // market and adds their destinations, and the packs are resolved again for that route.
    const student = state.crmStudent && (state.crmStudent.origin || state.crmStudent.destinations.length) ? state.crmStudent : null;
    const reroute = state.route && student ? withCrmStudent(state.route, student, intent) : null;
    const routeNow = reroute ?? state.route;
    const skills = reroute ? resolveTurnSkills(reroute, intent, { skillPacks, marketPacks }) : state.skills;
    // Round 0's guide and facts excerpts were chosen for the old route: the new route's are added
    // and a market that no longer applies loses its excerpts (src/graph/reroute-evidence.ts).
    const rerouted =
      reroute && state.route
        ? rerouteEvidence({
            evidence: state.evidence,
            before: state.route,
            after: reroute,
            market: skills?.market?.market,
            intent,
            input: state.input,
            maxEvidence,
            factsRegister: factsRegister && state.meta.round0Knowledge !== "skipped",
            complianceGuides,
          })
        : null;
    const evidence = rerouted?.evidence ?? state.evidence;
    // A message that refers back (a pronoun, "you said", "earlier", a follow-up cue) sees the last
    // answers uncut and the sources the previous one cited, so it can repeat what was already said.
    const recall = state.history.length > 0 && refersBack(state.input, state.intentExtras ?? null);
    const guided = withDocuments(withGuideRecord(evidence.length ? evidence : state.chunks, state.guide), state.documentIntake?.evidence ?? []);
    const items = recall ? withEarlierSources(guided, state.priorSources) : guided;
    const { context, sources } = formatContext(items, deps.env.CONTEXT_MAX_CHARS ?? CONTEXT_MAX_CHARS);
    const [system, playbook, guidedPrompt, packProse, marketProse] = await Promise.all([
      deps.prompts.get(PROMPT_NAMES.system),
      deps.prompts.get(PROMPT_NAMES.playbook(intent.primary_intent)),
      state.guide ? deps.prompts.get(PROMPT_NAMES.guided) : Promise.resolve(null),
      skills ? loadPackProse(deps.prompts, skills.packs.map((p) => p.country)) : Promise.resolve({}),
      loadMarketProse(deps.prompts, skills?.market?.market),
    ]);
    const guidedText = state.guide && guidedPrompt ? renderGuidedSession(guidedPrompt.text, state.guide) : "none (normal chat)";
    // A turn researched for the CRM (crmResearchReason) ran a lookup even though the classifier said none was needed.
    const contextNote = context || (intent.needs_research || state.researchTrace ? NO_CONTEXT_NOTE : NO_RESEARCH_NOTE);
    const researchNotes = state.researchTrace?.notes?.trim() || (state.researchTrace ? "none" : intent.needs_research ? "lookup skipped" : "no lookup needed for this request");
    // Proposals are not evidence, so without this the answer could not mention the approval cards.
    const allProposals = [...(state.documentIntake?.proposals ?? []), ...(state.researchTrace?.proposals ?? [])];
    const crmWriteProposals = allProposals.length ? allProposals.map((p) => `\n- ${p}`).join("") : "none";
    const workspace = state.researchTrace?.workspace;
    const workspaceStatus = workspace ? WORKSPACE_SERVICES.map((s) => `${SERVICE_LABELS[s]} ${(workspace[s] ?? "not_connected").replace("_", " ")}`).join(", ") : "not checked this turn";
    const systemText: string = compileTemplate(system.text, {
      // "" (never undefined) without packs, so the placeholder compiles to a blank line.
      // Destination guidance first, then the student's market guidance (one placeholder, fixed order).
      country_pack: skills ? renderSkillsGuidance(skills, packProse, marketProse) : "",
      today: promptDate(),
      task: intent.task,
      research_notes: researchNotes,
      crm_write_proposals: crmWriteProposals,
      workspace_status: workspaceStatus,
      primary_intent: intent.primary_intent,
      secondary_intents: intent.secondary_intents.join(", ") || "none",
      confidence_level: intent.confidence_level,
      destinations: destinationLabels({ route: routeNow, intent }),
      study_level: intent.study_level,
      study_area: intent.study_area ?? "not specified",
      origin: originLine(intent, routeNow),
      contextual_flags: intent.contextual_flags.join(", ") || "none",
      language: intent.language,
      user_question: intent.user_question,
      audience: state.intentExtras?.audience ?? "consultant",
      channel: state.intentExtras?.channel ?? "chat_answer",
      stage: state.intentExtras?.stage ?? "unspecified",
      signals: state.intentExtras?.signals.join(", ") || "none",
      playbook: playbook.text,
      guided_session: guidedText,
      profile: state.profile ? formatProfile(state.profile) : "not provided",
      context: contextNote,
    });
    // A rewrite of the previous answer may use only its facts, so it sees all of that answer and a
    // per-turn rule appended after the request and evidence (outside the cached prefix).
    const rewrite = isRewrite(state);
    // A distress turn leads with a safety check and cited helplines (also per turn, after the evidence).
    // The regulated adviser for this turn's destinations (MARN is Australia's only), on visa and migration topics.
    const countriesNow: readonly Destination[] = routeNow ? routeNow.countries : intent.destinations;
    // A short, chat-style question gets a short-first answer (per turn, after the evidence).
    const shortFirst = wantsShortFirst({ intent, input: state.input, rewrite });
    // A question that names one register row gets that row quoted with every figure asked for:
    // only a row in an excerpt the prompt carries (formatContext drops what is over budget), so the
    // block never quotes a figure the answer could not cite.
    const inPrompt = new Set(sources.map((s) => s.n));
    const numbered = items.map((c, i) => ({ ...c, n: (c as { n?: number }).n ?? i + 1 }));
    const namedRow = rewrite ? null : namedEvidenceRow(state.input, numbered.filter((c) => inPrompt.has(c.n)));
    const turnBlocks = [
      rerouted?.note ?? null,
      state.documentIntake ? documentInstruction(state.documentIntake) : null,
      rewrite ? REWRITE_INSTRUCTION : null,
      // Amounts stay in their source currency unless a central-bank rate is in this turn's evidence (N23).
      rewrite || TEXT_TASKS.has(intent.task) ? currencyInstruction(items) : null,
      state.distress ? distressInstruction(state.distress, helplinePlaces(routeNow, intent.contextual_flags)) : null,
      needsAdviserLine(intent) ? adviserInstruction(countriesNow) : null,
      shortFirst ? SHORT_FIRST_INSTRUCTION : null,
      namedRow ? namedRowInstruction(namedRow) : null,
    ].filter(Boolean);
    const promptText = turnBlocks.length ? `${systemText}\n\n${turnBlocks.join("\n\n")}` : systemText;
    // Uncut previous answers (the window cut each at 3,000 characters): the last one on a rewrite,
    // the last two on any turn that refers back.
    const priorAnswers = state.priorAnswers.length ? state.priorAnswers : state.priorAnswer ? [state.priorAnswer] : [];
    const history = (rewrite || recall) && priorAnswers.length ? withFullAnswers(state.history, priorAnswers) : state.history;
    const messages: BaseMessage[] = [new SystemMessage(promptText), ...history, new HumanMessage(state.input)];

    const deep = state.deepThink && Boolean(deps.answerDeepModel);
    // The same call config for both attempts, so the fallback keeps the same ANSWER_TAG (which is
    // how ChatService picks the answer's tokens out of the event stream) and the same Langfuse
    // prompt link — but each attempt has its own deadline. A primary that timed out before its
    // first token has spent its budget, and a fallback started on that expired signal "timed
    // out" 2-3 ms later (DeepThink failed 6/6 in the Oct 2026 audit). The request's own signal
    // (config.signal) still caps both.
    const callWithin = (ms: number): RunnableConfig => ({
      ...config,
      runName: "generate_answer",
      signal: withTimeout(config.signal, ms),
      tags: [...(config.tags ?? []), ANSWER_TAG],
      metadata: { ...config.metadata, langfusePrompt: system.client, intent: intent.primary_intent, task: intent.task },
    });
    const call = callWithin(deep ? (deps.env.DEEP_THINK_TIMEOUT_MS ?? DEEP_GENERATE_TIMEOUT_MS) : (deps.env.ANSWER_TIMEOUT_MS ?? GENERATE_TIMEOUT_MS));

    // Streamed rather than invoked: the provider's thought summaries only exist as
    // `{ type: "thinking" }` parts on the streamed chunks, and each chunk has to reach the
    // client as the model produces it. The text is accumulated here; nothing re-emits it, so
    // the tokens ChatService sees (and the partial answer it records) stay a single copy.
    let answer = "";
    let thinking = "";
    // Set when the stream degenerated (a citation-number loop, a repeated phrase, past the hard
    // cap): the stream is stopped there and the answer keeps only what came before the loop.
    let runaway: RunawayReason | null = null;
    const streamFrom = async (model: AnswerModel, call: RunnableConfig) => {
      for await (const chunk of await model.stream(messages, call)) {
        // Thoughts are dispatched from here rather than read off `on_chat_model_stream`
        // in ChatService, because LangGraph re-emits those chunks with their content
        // flattened to a plain string: measured 4 chunks carrying `{type:"thinking"}` at
        // this loop against 0 at the handler, on the same request. A custom event keeps
        // the payload intact.
        const thought = chunkThinking(chunk);
        if (thought) {
          thinking += thought;
          await dispatchCustomEvent(THINKING_EVENT, { chunk: thought }, call);
        }
        answer += contentToText(chunk.content);
        const cut = runawayCut(answer);
        if (cut) {
          answer = cut.keep;
          runaway = cut.reason;
          logger.warn("answer stream degenerated; stopped", { reason: cut.reason, keptChars: cut.keep.length });
          break; // ends the provider stream too
        }
      }
    };

    let generateError: string | null = null;
    // The deadline of the attempt that failed: aborted means the time limit cut it, not an error.
    let failedCall: RunnableConfig = call;
    try {
      await streamFrom(deep ? deps.answerDeepModel! : deps.answerModel, call);
    } catch (err) {
      const primaryError = (err as Error).message;
      // Fall back only while nothing has reached the client. Once tokens have streamed they are
      // already on the consultant's screen, and continuing them with a second model splices two
      // half-answers into one reply — worse than a truncated answer, and impossible to review.
      if (answer.trim() || !deps.answerFallbackModel) {
        generateError = primaryError;
        logger.error("answer generation failed", { err: generateError });
      } else {
        answer = ""; // whitespace-only output from the primary: nothing the client can have seen
        thinking = ""; // the fallback's reasoning replaces the failed attempt's in the stored record
        logger.warn("answer model failed before any token; retrying on the fallback model", { err: primaryError });
        failedCall = callWithin(deps.env.FALLBACK_TIMEOUT_MS ?? FALLBACK_GENERATE_TIMEOUT_MS);
        try {
          await streamFrom(deps.answerFallbackModel, failedCall);
        } catch (fallbackErr) {
          generateError = `${primaryError}; fallback: ${(fallbackErr as Error).message}`;
          logger.error("answer generation failed", { err: generateError });
        }
      }
    }
    // A mid-stream failure keeps the partial text: it is what the consultant actually saw, so it
    // is what the `done` payload, the stored message and the activity log should agree on.
    answer = answer.trim();
    // Cut after tokens streamed (by the answer deadline or a provider error): say so on screen
    // instead of passing a mid-sentence stop off as a finished answer (7% of answers in the Oct
    // 2026 audit), and flag the turn so it is measurable. The note is streamed as well, because
    // the client builds the answer from the tokens. A request the consultant stopped (or the
    // request deadline) aborts config.signal: ChatService keeps that partial as `stopped`.
    // A runaway stream is cut the same way, after its degenerate tail was dropped.
    const truncated = Boolean(answer && (runaway || (generateError && !config.signal?.aborted)));
    if (truncated) {
      const note = runaway ? ANSWER_CUT_OFF_RUNAWAY_NOTE : failedCall.signal?.aborted ? ANSWER_CUT_OFF_TIME_NOTE : ANSWER_CUT_OFF_ERROR_NOTE;
      answer += note;
      await dispatchCustomEvent(ANSWER_NOTE_EVENT, { chunk: note }, call).catch(() => undefined);
    }
    if (!answer) answer = SAFE_FALLBACK_ANSWER;
    answer = stripDanglingCitations(dropBasedOnLines(answer), sources);
    // A name that matched several CRM contacts, answered as if it matched one: the candidates, visibly.
    const crmNote = answer !== SAFE_FALLBACK_ANSWER ? crmAmbiguityNote(answer, evidence) : null;
    if (crmNote) {
      answer += crmNote;
      await dispatchCustomEvent(ANSWER_NOTE_EVENT, { chunk: crmNote }, call).catch(() => undefined);
    }
    // A draft in another language whose figures or units are not in its sources (the previous
    // answer, this turn's evidence, the message) gets a visible "Check:" line, streamed like the cut-off note.
    const draftNote =
      answer !== SAFE_FALLBACK_ANSWER && isNonEnglishDraft({ intent, rewrite, input: state.input, answer })
        ? figureCheck(answer, [...priorAnswers, ...items.map((i) => i.content), state.input])
        : null;
    if (draftNote) {
      answer += draftNote;
      await dispatchCustomEvent(ANSWER_NOTE_EVENT, { chunk: draftNote }, call).catch(() => undefined);
    }
    // Every other answer: its figures against this turn's evidence and the message, its totals
    // against their items, its home-currency figures against the stated rate (audit R7). Earlier
    // answers are not support: they can hold the very error being repeated.
    const figures =
      answerFigureCheck && answer !== SAFE_FALLBACK_ANSWER && !draftNote && !truncated ? checkAnswerFigures(answer, { evidence: items.map((i) => i.content), input: state.input }) : null;
    if (figures?.note) {
      // On a draft, say plainly that the line is for the counsellor, not part of the message.
      const note = DRAFT_FOR_OTHERS.has(intent.task) ? figures.note.replace("_(Figure check:", "_(For you, not part of the message. Figure check:") : figures.note;
      answer += note;
      await dispatchCustomEvent(ANSWER_NOTE_EVENT, { chunk: note }, call).catch(() => undefined);
    }

    return {
      ...(reroute ? { route: reroute, skills } : {}),
      ...(rerouted ? { evidence: rerouted.evidence } : {}),
      answer,
      thinking: thinking.trim(),
      // Drafts/reviews/summaries/translations cite nothing when the model cited nothing; lookups fall back to the top sources.
      sources: citedSources(answer, sources, { strict: STRICT_CITATION_TASKS.has(intent.task) }),
      // A secondary topic with a compliance requirement (e.g. policy_change about a migration rule) still carries it.
      disclaimer: disclaimerFor(intent, countriesNow),
      meta: {
        generateMs: Math.round(performance.now() - started),
        systemPromptName: system.name,
        systemPromptSource: system.source,
        systemPromptVersion: system.version ?? null,
        systemTemplateHash: system.hash,
        playbookPromptName: playbook.name,
        playbookSource: playbook.source,
        playbookPromptVersion: playbook.version ?? null,
        playbookTemplateHash: playbook.hash,
        // Exact compiled prompt the model saw; ChatService lifts it into the activity log. Not on a
        // turn that read student documents: their text is in the prompt and stays out of chat_turns.
        systemPromptText: state.documentIntake ? null : promptText,
        systemPromptHash: sha256(promptText),
        systemPromptChars: promptText.length,
        rewriteOfPrevious: rewrite,
        recall,
        shortFirst,
        contextChunkCount: sources.length,
        generateError,
        truncated,
        runaway,
        draftCheck: Boolean(draftNote),
        ...(figures ? { figureCheck: { checked: figures.checked, unsupported: figures.unsupported.length, badTotals: figures.badTotals.length, badConversions: figures.badConversions.length, flagged: Boolean(figures.note) } } : {}),
        crmAmbiguous: Boolean(crmNote),
        deepThink: deep,
        thinkingChars: thinking.length,
        ...(rerouted ? { rerouteEvidence: { added: rerouted.added, removed: rerouted.removed } } : {}),
        // The re-decided route replaces classify's on the turn (a fan-out skip note is kept).
        ...(reroute ? { route: { ...((state.meta.route as Record<string, unknown> | undefined) ?? {}), ...(skills ? routeWithPacks(reroute, skills) : withoutPacks(reroute)) } } : {}),
        ...(state.guide && guidedPrompt
          ? { guide: { step: state.guide.step, crm: state.guide.snapshot ? "ok" : "unavailable", promptName: guidedPrompt.name, promptSource: guidedPrompt.source, promptVersion: guidedPrompt.version ?? null } }
          : {}),
      },
    };
  }

  return { classify, route, refuse, rates, generate };
}

/**
 * The packs for a routed turn: destination packs for its countries (when skill packs are on) and
 * the pack of its origin market (when market packs are on). Null when there is nothing to load: no
 * country with a pack (none, or e.g. Germany) and no origin, or a topic that never loads a pack.
 */
function resolveTurnSkills(route: RouteDecision, intent: Intent, on: { skillPacks: boolean; marketPacks: boolean }): ResolvedPacks | null {
  const topic = { topic: intent.primary_intent, secondaryTopics: intent.secondary_intents, stage: route.stage === "unspecified" ? null : route.stage };
  // A comparison loads no destination pack (it lowered comparison coverage); the market pack still applies.
  const resolved = on.skillPacks && route.countries.length ? resolvePacks({ countries: route.countries, ...topic, comparison: route.mode === "comparison" }) : { packs: [], versions: [] };
  const market = on.marketPacks ? resolveMarket({ market: route.origin, ...topic }) : null;
  if (!resolved.packs.length && !market) return null;
  return market ? { ...resolved, market } : resolved;
}

/** `meta.route` with the loaded pack versions: `packs` (destinations) and `marketPack`, each only when loaded. */
function routeWithPacks(route: RouteDecision, skills: ResolvedPacks) {
  return {
    ...route,
    ...(skills.versions.length ? { packs: skills.versions } : {}),
    ...(skills.market ? { marketPack: `${skills.market.market}@${skills.market.version}` } : {}),
  };
}

/** The re-decided route on `meta.route`, minus the pack versions classify recorded (no pack loads now). */
function withoutPacks(route: RouteDecision) {
  return { ...route, packs: undefined, marketPack: undefined };
}

/**
 * The answer prompt's "Student's country/location" value. A CRM record's market wins; otherwise
 * the classifier's free text when it gave one (Jev never does), else the routed market — marked
 * as an assumption when it is only the counsellor's region. With no market and an onshore
 * counsellor, a note to consider onshore rules (per turn, never in the cached prompt prefix).
 */
export function originLine(intent: Pick<Intent, "origin">, route: RouteDecision | null): string {
  const routed = route?.origin ? MARKET_LABELS[route.origin] : null;
  if (routed && route?.originSource === "crm") return routed;
  if (intent.origin) return intent.origin;
  if (routed) return route?.originSource === "counsellor" || route?.originSource === "profile" ? `${routed} (assumed from the counsellor's office region; not stated)` : routed;
  if (route?.onshore) {
    const where = ONSHORE_LABELS[route.onshore];
    return `unknown. Counsellor is at an onshore ${where} office: the student is likely already in ${where === "UK" ? "the UK" : where}; consider onshore rules (visa conditions, switching provider, onshore applications) and ask the nationality only if the answer depends on it`;
  }
  return "unknown";
}

/** Country names for the prompts' "Destinations" line: the routed countries, or the classifier's when there is no route. */
export function destinationLabels(state: Pick<EdgeStateType, "route" | "intent">): string {
  const ds = state.route ? state.route.countries : (state.intent?.destinations ?? []);
  return ds.map((d) => DESTINATION_LABELS[d]).join(", ") || "not specified";
}

/** A guided session's CRM student's market: nationality, else passport country; null outside a guided session or when unmapped. */
export function guideMarket(guide: GuideContext | null): Market | null {
  const s = guide?.snapshot;
  return s ? (marketFromName(s.nationality) ?? marketFromName(s.countryOfPassport)) : null;
}

/** A guided session's CRM deal countries ("Australia", "UK") as destination slugs; empty outside a guided session. */
export function guideDestinations(guide: GuideContext | null) {
  return destinationsFromNames(guide?.snapshot?.deals.flatMap((d) => d.countries) ?? []);
}

/**
 * The guided session's CRM record is always part of the evidence, research or not, so a guided
 * answer can cite the student's facts. Research seeds it first; when no lookup ran it is the
 * only item, and otherwise it is appended after whatever was gathered.
 */
function withGuideRecord(items: EvidenceItem[] | EdgeStateType["chunks"], guide: GuideContext | null) {
  const record = guide?.record;
  if (!record || items.some((i) => i.url === record.url)) return items;
  const last = items.reduce((m, i, idx) => Math.max(m, (i as Partial<EvidenceItem>).n ?? idx + 1), 0);
  return [...items, { ...record, n: last + 1, kind: "crm" as const, live: false }];
}

/**
 * The turn's attached documents (and the CRM checklist read with them) as evidence, ahead of
 * everything else so the context budget never drops them, numbered after the existing items.
 */
function withDocuments(items: EvidenceItem[] | EdgeStateType["chunks"], docs: readonly RetrievedChunk[]) {
  if (!docs.length) return items;
  let last = items.reduce((m, i, idx) => Math.max(m, (i as Partial<EvidenceItem>).n ?? idx + 1), 0);
  const numbered = items.map((i, idx) => ({ ...i, n: (i as Partial<EvidenceItem>).n ?? idx + 1 })) as EvidenceItem[];
  const added: EvidenceItem[] = docs.map((d) => ({ ...d, n: ++last, kind: d.source === "document" ? ("document" as const) : ("crm" as const), live: false }));
  return [...added, ...numbered];
}

/** Render the frontend's preference object as compact key/value lines (max ~1.5k chars). */
export function formatProfile(profile: Record<string, unknown>, maxChars = 1_500): string {
  const lines: string[] = [];
  const walk = (obj: Record<string, unknown>, prefix = "") => {
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
      const key = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) lines.push(`${key}: ${v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ")}`);
      else if (typeof v === "object") walk(v as Record<string, unknown>, key);
      else lines.push(`${key}: ${String(v)}`);
    }
  };
  walk(profile);
  const text = lines.join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) + " …" : text;
}

/** Custom stream event carrying one fragment of the model's own reasoning. */
export const THINKING_EVENT = "edge:thinking";
/** Custom stream event carrying text the answer node appends to the streamed answer (the cut-off note). */
export const ANSWER_NOTE_EVENT = "edge:answer_note";
/** Appended to an answer the answer deadline cut after it had started streaming. */
export const ANSWER_CUT_OFF_TIME_NOTE = "\n\n_(Answer cut off at the time limit — ask me to continue.)_";
/** Appended to an answer whose stream degenerated into a loop (`runawayCut`) and was stopped. */
export const ANSWER_CUT_OFF_RUNAWAY_NOTE = "\n\n_(Answer cut off: the model started repeating itself — ask me to continue.)_";
/** Appended to an answer a provider error cut after it had started streaming. */
export const ANSWER_CUT_OFF_ERROR_NOTE = "\n\n_(Answer cut off by a model error — ask me to continue.)_";

export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text ?? "") : ""))
      .join("");
  }
  return content == null ? "" : String(content);
}

/**
 * The model's own reasoning out of a message or streamed chunk, whichever provider wrote it.
 *
 * Gemini returns thought summaries as `{ type: "thinking" }` content parts and Bedrock reasoning
 * as `{ type: "reasoning" }` parts; OpenRouter models (DeepSeek) return raw reasoning beside the
 * content, which `OpenRouterChatModel` keeps as `additional_kwargs.reasoning_content`. None of
 * them is ever part of `contentToText`'s output.
 */
export function chunkThinking(message: { content?: unknown; additional_kwargs?: Record<string, unknown> } | null | undefined): string {
  const kw = message?.additional_kwargs?.reasoning_content;
  return contentToThinking(message?.content) + (typeof kw === "string" ? kw : "");
}

/**
 * The model's own thought summary out of a streamed chunk's content.
 *
 * Gemini returns thinking as `{ type: "thinking", thinking }` parts and Bedrock as
 * `{ type: "reasoning", reasoning }` parts, alongside the ordinary `{ type: "text" }` ones.
 * Neither kind carries a `text` field, so this is the exact complement of `contentToText`:
 * neither helper can ever pick up the other's parts, and thoughts cannot reach the answer.
 */
export function contentToThinking(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as { type?: unknown; thinking?: unknown; reasoning?: unknown };
      if (p.type === "thinking") return String(p.thinking ?? "");
      if (p.type === "reasoning") return String(p.reasoning ?? "");
      return "";
    })
    .join("");
}
