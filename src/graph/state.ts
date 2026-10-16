import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { ClassifierExtras, Destination, Intent } from "../schemas/intent.schema";
import type { CounsellorRegion, Market } from "../routing/markets";
import type { CrmStudentRef, RouteDecision } from "../routing/route";
import type { ResolvedPacks } from "../skills";
import type { RetrievedChunk } from "../retrieval/store";
import type { Source } from "../retrieval/format";
import type { EvidenceItem, ResearchTrace } from "../tools/types";
import type { StudentSnapshot } from "../crm/student";
import type { DistressSignal } from "../safety/distress";
import type { JourneyStepKey } from "../journey/steps";
import type { DocumentIntake } from "./documents";

/** What a guided turn knows: the journey position and the CRM student, read live before the graph runs. */
export interface GuideContext {
  step: JourneyStepKey;
  stepsDone: JourneyStepKey[];
  contactId: string;
  /** Null when the CRM could not be read this turn (`crmMessage` says why). */
  snapshot: StudentSnapshot | null;
  /** The snapshot as a CRM evidence chunk, seeded first so answers can cite it. */
  record: RetrievedChunk | null;
  crmMessage?: string;
}

export const EdgeState = Annotation.Root({
  /** Normalised user message. */
  input: Annotation<string>,
  /** Windowed conversation history (oldest → newest), excluding the current input. */
  history: Annotation<BaseMessage[]>({ reducer: (_a, b) => b, default: () => [] }),
  sessionId: Annotation<string>,
  /** Staff context/preferences supplied by the frontend (already size-limited). */
  profile: Annotation<Record<string, unknown> | null>({ reducer: (_a, b) => b, default: () => null }),
  /**
   * Email of the consultant this turn is running for. Used to obtain that person's own CRM
   * token, so CRM reads carry their permissions and not a shared identity's. Null when the
   * caller is anonymous or identified by something other than an email, which means no CRM.
   */
  actorEmail: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  /** DeepThink: the consultant asked for a harder-reasoned answer (higher effort, longer budget). */
  deepThink: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  /** Student documents attached to this turn (ids, owned by `ownerId`); empty on almost every turn. */
  attachments: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  /** Who the turn runs for (the chat's owner): attachments are loaded only when they belong to them. */
  ownerId: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  /** What the `documents` node read from the attachments, for the answer; null without attachments. */
  documentIntake: Annotation<DocumentIntake | null>({ reducer: (_a, b) => b, default: () => null }),
  /** Guided sessions only; null in a normal chat, which then behaves exactly as before. */
  guide: Annotation<GuideContext | null>({ reducer: (_a, b) => b, default: () => null }),
  intent: Annotation<Intent | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
  /** Extra decisions from the Jev classifier (audience, channel, stage, signals); null when Gemini classified. */
  intentExtras: Annotation<ClassifierExtras | null>({ reducer: (_a, b) => b, default: () => null }),
  /**
   * Countries the most recent prior turn was routed to, read from stored message metadata by the
   * chat service (see `priorDestinationsOf`); lets a follow-up inherit them. Empty on a new chat.
   */
  priorDestinations: Annotation<Destination[]>({ reducer: (_a, b) => b, default: () => [] }),
  /**
   * The previous assistant answer in full (up to PRIOR_ANSWER_MAX_CHARS, src/graph/rewrite.ts),
   * which `history` cuts at 3,000 characters: a turn that rewrites it sees all of it. Null when none.
   */
  priorAnswer: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  /**
   * The last two assistant answers, oldest first, each uncut up to PRIOR_ANSWER_MAX_CHARS
   * (`priorAnswersOf`, src/memory/recall.ts): a turn that refers back sees them in full. Empty when none.
   */
  priorAnswers: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  /** The sources the previous answer cited (`priorSourcesOf`): carried into a referring-back turn's evidence. */
  priorSources: Annotation<Source[]>({ reducer: (_a, b) => b, default: () => [] }),
  /** A distress or self-harm cue in the message (`detectDistress`, src/safety/distress.ts), set at classify; null when none. */
  distress: Annotation<DistressSignal | null>({ reducer: (_a, b) => b, default: () => null }),
  /** Source market the most recent prior turn was routed with (see `priorOriginOf`); null when none. */
  priorOrigin: Annotation<Market | null>({ reducer: (_a, b) => b, default: () => null }),
  /**
   * The CRM student an earlier turn of this chat read (see `priorCrmStudentOf`): a follow-up about
   * them re-reads their record this turn instead of answering from history. Null when none.
   */
  priorCrmStudent: Annotation<CrmStudentRef | null>({ reducer: (_a, b) => b, default: () => null }),
  /**
   * Where the consultant counsels (CRM branch, Edge profile market, else browser timezone),
   * resolved by the chat service before the graph runs: the turn's default origin market.
   */
  counsellorRegion: Annotation<CounsellorRegion | null>({ reducer: (_a, b) => b, default: () => null }),
  /**
   * The one CRM student this turn's research read (outside guided sessions), with their market
   * and destinations; generate re-decides the route and packs with it when it names either, and
   * the chat service stores it for the next turn. Null when none was read.
   */
  crmStudent: Annotation<CrmStudentRef | null>({ reducer: (_a, b) => b, default: () => null }),
  /** Country/topic/stage routing decided right after classification (see `decideRoute`); null before classify. */
  route: Annotation<RouteDecision | null>({ reducer: (_a, b) => b, default: () => null }),
  /**
   * Skill packs resolved once at classify: destination packs for the routed countries
   * (SKILL_PACKS_ENABLED) and, in `market`, the pack of the routed origin (MARKET_PACKS_ENABLED).
   * Null when neither applies (packs off, no country with a pack and no origin).
   */
  skills: Annotation<ResolvedPacks | null>({ reducer: (_a, b) => b, default: () => null }),
  /** Knowledge-base chunks used this turn (subset of `evidence`; kept for the activity log). */
  chunks: Annotation<RetrievedChunk[]>({ reducer: (_a, b) => b, default: () => [] }),
  /** Everything the research loop gathered, numbered for citation. */
  evidence: Annotation<EvidenceItem[]>({ reducer: (_a, b) => b, default: () => [] }),
  /** What the research node did (rounds, tool calls, live URLs). Named to avoid clashing with the `research` node. */
  researchTrace: Annotation<ResearchTrace | null>({ reducer: (_a, b) => b, default: () => null }),
  sources: Annotation<Source[]>({ reducer: (_a, b) => b, default: () => [] }),
  answer: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  /** The answer model's own reasoning for this turn, as streamed ("" when it gave none). */
  thinking: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  refused: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  disclaimer: Annotation<string | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
  /** Free-form diagnostics (timings, prompt sources) merged across nodes. */
  meta: Annotation<Record<string, unknown>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
});

export type EdgeStateType = typeof EdgeState.State;
export type EdgeStateUpdate = typeof EdgeState.Update;

/** Tag placed on the answer-generating model call so streaming can pick out its tokens. */
export const ANSWER_TAG = "edge:answer";
/** Tag placed on research-round model calls (tool selection); their tokens are never streamed. */
export const RESEARCH_TAG = "edge:research";
