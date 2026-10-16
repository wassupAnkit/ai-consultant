import { isFollowUp, type CrmStudentRef } from "../routing/route";
import type { EdgeStateType } from "./state";

/**
 * CRM questions are never answered from conversation history alone. A follow-up about the student
 * an earlier turn read ("does she have a deal?") re-reads their record this turn, and a turn about
 * a named student or the consultant's caseload always researches while the CRM is reachable — an
 * answer model without CRM evidence otherwise reports "no enquiry, deal or application" for a
 * student whose record has all three.
 */

/** A pronoun that can only point back at a person already in the conversation. */
const PERSON_PRONOUN = /\b(?:she|he|her|hers|him|his|they|them|their)\b/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The message names the student: their full name, or their first name, as a whole word. */
function namesStudent(input: string, name: string | undefined): boolean {
  const parts = name?.trim().split(/\s+/).filter((p) => p.length >= 2) ?? [];
  if (!parts.length) return false;
  return [parts.join(" "), parts[0]!].some((n) => new RegExp(`\\b${escape(n)}\\b`, "i").test(input));
}

type FollowUpState = Pick<EdgeStateType, "input" | "history" | "priorCrmStudent" | "guide" | "intent" | "intentExtras">;

/**
 * The earlier turn's CRM student when this turn follows up on them: the message names them, points
 * back with a pronoun, opens with a follow-up cue or is very short (`isFollowUp`), or Jev judged it
 * to reference the prior turn. Null outside a running chat, in a guided session (its student is
 * read live already), for a greeting, and when the classifier saw a named student and the message
 * names someone else without pointing back ("what about Sita Sharma?").
 */
export function crmFollowUpStudent(state: FollowUpState): CrmStudentRef | null {
  const prior = state.priorCrmStudent;
  if (!prior || !state.history.length || state.guide || state.intent?.primary_intent === "greeting") return null;
  if (namesStudent(state.input, prior.name)) return prior;
  const pointsBack = PERSON_PRONOUN.test(state.input);
  if (state.intentExtras?.signals.includes("student_named") && !pointsBack) return null;
  return pointsBack || isFollowUp(state.input) || state.intentExtras?.references_prior_turn ? prior : null;
}

/**
 * Why this turn must research even though the classifier said no lookup is needed, or null. Only
 * when the CRM can be reached for this consultant (`hasCrm`): a follow-up on the earlier turn's
 * student, a named student outside a guided session, or the consultant's caseload.
 */
export function crmResearchReason(state: FollowUpState, hasCrm: boolean): string | null {
  if (!hasCrm) return null;
  if (crmFollowUpStudent(state)) return "crm follow-up";
  if (state.intentExtras?.signals.includes("student_named") && !state.guide) return "named student";
  if (state.intent?.primary_intent === "caseload_management") return "caseload";
  return null;
}
