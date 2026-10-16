import { mentionsWorkspace } from "../google/mentions";
import { crmFollowUpStudent } from "./crm-followup";
import { isRewriteOfPrevious } from "./rewrite";
import { wantsShortFirst } from "./short-first";
import type { EdgeStateType } from "./state";

/**
 * Per-turn caps on the model-driven research rounds (backlog N9, Oct 2026). The research model
 * almost never stops on its own (18 of 195 researched turns), so RESEARCH_MAX_ROUNDS decides how
 * long most turns research, at ~4.5 s for the model call plus ~1 s of lookups per round. Two
 * kinds of turn get fewer rounds:
 *
 * - urgent: distress or self-harm (`detectDistress`) or the classifier's crisis_safeguarding
 *   signal. The safety reply leads with a check and helplines, which come from round 0 and the
 *   helpline searches, so the model rounds only delay it (RESEARCH_URGENT_MAX_ROUNDS, default 0).
 * - a short question that gets a short-first answer (src/graph/short-first.ts): 3–6 lines with
 *   the key figures, built from fewer sources (RESEARCH_SHORT_MAX_ROUNDS, default 2). Not when the
 *   turn is about a person (a named student, a follow-up on one, a guided session, caseload work)
 *   or the consultant's mail: CRM and Gmail lookups chain over rounds (search, then open).
 *
 * Each cap only ever lowers RESEARCH_MAX_ROUNDS; set it at or above that to restore the earlier
 * behaviour.
 */

export interface RoundCapConfig {
  maxRounds: number;
  /** Rounds for an urgent (distress, self-harm, safeguarding) turn. Unset = no cap. */
  urgentMaxRounds?: number;
  /** Rounds for a short-first question that is not about a person or the consultant's mail. Unset = no cap. */
  shortMaxRounds?: number;
}

export type RoundCapReason = "urgent" | "short_question";

export interface RoundCap {
  maxRounds: number;
  /** Why the rounds were capped below `maxRounds`; null when they were not. */
  reason: RoundCapReason | null;
}

type CapState = Pick<EdgeStateType, "input" | "intent" | "intentExtras" | "distress" | "guide" | "history" | "priorCrmStudent" | "priorAnswer">;

/** An urgent turn: distress or self-harm in the message, or the classifier's safeguarding signal. */
export function isUrgentTurn(state: Pick<CapState, "distress" | "intentExtras">): boolean {
  return Boolean(state.distress) || Boolean(state.intentExtras?.signals.includes("crisis_safeguarding"));
}

/** A turn about a person or the consultant's own mail, whose CRM or Gmail lookups need their rounds. */
function isPersonalTurn(state: CapState): boolean {
  return (
    Boolean(state.guide) ||
    state.intent?.primary_intent === "caseload_management" ||
    Boolean(state.intentExtras?.signals.includes("student_named")) ||
    Boolean(crmFollowUpStudent(state)) ||
    mentionsWorkspace(state.input)
  );
}

export function researchRoundCap(config: RoundCapConfig, state: CapState): RoundCap {
  const max = config.maxRounds;
  const lower = (cap: number | undefined, reason: RoundCapReason): RoundCap | null => (cap !== undefined && cap < max ? { maxRounds: Math.max(0, cap), reason } : null);
  if (isUrgentTurn(state)) {
    const capped = lower(config.urgentMaxRounds, "urgent");
    if (capped) return capped;
  }
  if (config.shortMaxRounds !== undefined && state.intent && !isPersonalTurn(state)) {
    const rewrite = isRewriteOfPrevious({ intent: state.intent, extras: state.intentExtras ?? null, input: state.input, hasPriorAnswer: Boolean(state.priorAnswer) });
    if (wantsShortFirst({ intent: state.intent, input: state.input, rewrite })) {
      const capped = lower(config.shortMaxRounds, "short_question");
      if (capped) return capped;
    }
  }
  return { maxRounds: max, reason: null };
}
