import { stepFieldGaps, type StudentSnapshot } from "../crm/student";
import type { GuideSuggestion } from "./guide";
import { journeyStep, nextJourneyStep, type JourneyStepKey } from "./steps";

/**
 * Edge's side of the journey: it suggests, the consultant decides. Nothing here moves a step.
 *
 * Two kinds of suggestion, both about the CRM facts rather than the chat alone, so a fact that
 * was only mentioned in conversation never counts until it is recorded where it belongs:
 * - a starting step for a new guided session, read off the CRM record (no model call);
 * - "this step looks settled" after an answer, which needs both the model's judgement and
 *   `stepSettledInCrm` — every CRM field the step needs, where the CRM shows it, is filled.
 */

const firstName = (s: StudentSnapshot) => s.name.split(/\s+/)[0] || s.name;

/**
 * The journey step a CRM application workflow stage points to. The stage names are the
 * tenant's own ("Enquiry", "Lodge Application", "Finalise Applicaiton", "Collect Service
 * Fees", "COE", "Visa Lodged"…), so this reads intent from words rather than a fixed list,
 * and "visa" must be named for a stage to count as the visa step ("Lodge Application" is the
 * university application, not a visa lodgement).
 */
export function stepForWorkflowStage(stage: string): JourneyStepKey {
  const s = stage.toLowerCase();
  if (/visa\s*(granted|approved)|arriv|depart|enrol+ed|commenc|onshore|orientation/.test(s)) return "pre_departure";
  if (/visa/.test(s)) return "visa";
  if (/^(enquiry|inquiry|new|lead|counsel+ing|prospect)\b/.test(s)) return "institution";
  return "application";
}

const DEAD_STATUS = /discontinu|cancel|withdraw|lost|reject|refus|archiv/i;
const COMPLETE_STATUS = /complet|done|closed won|success/i;
/** An application lodged with an immigration authority is the visa itself, whatever its stage is called. */
const VISA_AUTHORITY = /home affairs|immigration|ircc|ukvi|uscis|\bvisa\b|inz\b|immigration new zealand/i;

const isVisaAuthority = (a: StudentSnapshot["applications"][number]) => VISA_AUTHORITY.test(a.institution ?? "") || VISA_AUTHORITY.test(a.course ?? "");

/** The step one CRM application points to; null when it carries nothing to go on. */
function stepForApplication(a: StudentSnapshot["applications"][number]): JourneyStepKey | null {
  const stage = a.workflowStage ?? "";
  if (isVisaAuthority(a)) {
    return /granted|approved/i.test(stage) || COMPLETE_STATUS.test(a.status ?? "") ? "pre_departure" : "visa";
  }
  if (!stage) return null;
  const step = stepForWorkflowStage(stage);
  // A finished university application (offer accepted, CoE issued) means the student is past it.
  return step === "application" && COMPLETE_STATUS.test(a.status ?? "") ? "visa" : step;
}

/**
 * Where a student already is, from the CRM: the furthest application workflow stage says the
 * most, then the existence of an application, then recorded destinations. Null when the
 * record says nothing beyond an enquiry, which is where every guided session starts anyway.
 */
export function startingSuggestion(s: StudentSnapshot | null, now = new Date()): GuideSuggestion | null {
  if (!s) return null;
  const who = firstName(s);
  const at = now;
  const where = (a: StudentSnapshot["applications"][number]) => [a.institution, a.course].filter(Boolean).join(", ") || "an institution";

  // Dropped applications say nothing about where the student is now.
  const live = s.applications.filter((a) => !DEAD_STATUS.test(a.status ?? ""));
  const staged = live
    .map((a) => ({ a, step: stepForApplication(a) }))
    .filter((x): x is { a: (typeof live)[number]; step: JourneyStepKey } => x.step !== null)
    // Furthest step first; on a tie the application lodged with an immigration authority wins,
    // because it is the visa itself rather than the university step that led to it.
    .sort((x, y) => journeyStep(y.step).order - journeyStep(x.step).order || Number(isVisaAuthority(y.a)) - Number(isVisaAuthority(x.a)));
  const furthest = staged[0];
  if (furthest) {
    const others = live.length > 1 ? ` (the furthest of ${live.length} active applications)` : "";
    const done = COMPLETE_STATUS.test(furthest.a.status ?? "") ? `, completed` : "";
    const at_ = furthest.a.workflowStage ? `is at "${furthest.a.workflowStage}"${done}` : `is ${furthest.a.status ?? "open"}`;
    return { toStep: furthest.step, reason: `${who}'s application to ${where(furthest.a)} ${at_} in the CRM${others}.`, at };
  }
  const app = live[0];
  if (app) return { toStep: "application", reason: `${who} already has an application to ${where(app)} in the CRM.`, at };
  const countries = [...new Set(s.deals.flatMap((d) => d.countries))];
  if (countries.length) return { toStep: "course", reason: `${who}'s CRM deal already names ${countries.join(" and ")} as the destination.`, at };
  return null;
}

/** Every CRM field the step needs, where the CRM shows it to Edge, is filled. Unknown fields do not block. */
export function stepSettledInCrm(s: StudentSnapshot | null, step: JourneyStepKey): boolean {
  if (!s) return false;
  return stepFieldGaps(s, step).missing.length === 0;
}

/**
 * The after-answer suggestion: move on from `step` when the model judged it settled and the
 * CRM agrees. Null otherwise (including on the last step, which has nowhere to go).
 */
export function settledSuggestion(input: { step: JourneyStepKey; snapshot: StudentSnapshot | null; stepComplete: boolean; reason: string | null }, now = new Date()): GuideSuggestion | null {
  const next = nextJourneyStep(input.step);
  if (!next || !input.stepComplete || !stepSettledInCrm(input.snapshot, input.step)) return null;
  const reason = input.reason?.trim() || `${journeyStep(input.step).label} looks settled.`;
  return { toStep: next.key, reason: reason.slice(0, 240), at: now };
}
