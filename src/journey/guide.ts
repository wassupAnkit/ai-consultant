import { JOURNEY_STEPS, JOURNEY_STEP_KEYS, type JourneyStepKey } from "./steps";

/**
 * A guided session's own state: which CRM student it is about and how far the journey has got.
 * Deliberately nothing about the student themselves: those facts are the CRM's and are read
 * live (`src/crm/student.ts`). Keeping them out of Edge is what stops the two from drifting.
 */

export const STEP_STATUSES = ["not_started", "in_progress", "done"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export interface GuideStepState {
  status: StepStatus;
  updatedAt: Date;
}

export interface GuideSuggestion {
  toStep: JourneyStepKey;
  reason: string;
  at: Date;
}

export interface GuideState {
  version: 1;
  /** CRM contact id (UUID). The only link to the student; the record itself stays in the CRM. */
  contactId: string;
  currentStep: JourneyStepKey;
  /** Steps never touched are absent and read as `not_started`. */
  steps: Partial<Record<JourneyStepKey, GuideStepState>>;
  /** Edge's pending "move on" suggestion; the consultant accepts or dismisses it. */
  suggestion?: GuideSuggestion | null;
  startedAt: Date;
}

/**
 * `expiresAt` of a guided session and its messages. Every store query filters
 * `expiresAt > now`, and the TTL index only deletes past dates, so a far-future date keeps a
 * guided session until its owner deletes it without touching any query.
 */
export const NEVER_EXPIRES = new Date("9999-12-31T00:00:00.000Z");

export function newGuide(contactId: string, step: JourneyStepKey = "enquiry", now = new Date()): GuideState {
  return { version: 1, contactId, currentStep: step, steps: { [step]: { status: "in_progress", updatedAt: now } }, suggestion: null, startedAt: now };
}

export interface GuidePatch {
  currentStep?: JourneyStepKey;
  stepStatus?: Partial<Record<JourneyStepKey, StepStatus>>;
  dismissSuggestion?: boolean;
}

/**
 * Apply the consultant's change. Moving to a step starts it if it had not started; explicit
 * statuses win over that. Moving at all clears Edge's suggestion (taken or overtaken).
 */
export function applyGuidePatch(guide: GuideState, patch: GuidePatch, now = new Date()): GuideState {
  const steps = { ...guide.steps };
  let suggestion = guide.suggestion ?? null;
  let currentStep = guide.currentStep;
  if (patch.currentStep && patch.currentStep !== guide.currentStep) {
    currentStep = patch.currentStep;
    if ((steps[currentStep]?.status ?? "not_started") === "not_started") steps[currentStep] = { status: "in_progress", updatedAt: now };
    // Any move answers the suggestion: taken, or overtaken by the consultant's own choice.
    suggestion = null;
  }
  for (const [key, status] of Object.entries(patch.stepStatus ?? {}) as [JourneyStepKey, StepStatus][]) {
    if (status === "not_started") delete steps[key];
    else steps[key] = { status, updatedAt: now };
  }
  if (patch.dismissSuggestion) suggestion = null;
  return { ...guide, currentStep, steps, suggestion };
}

export function stepStatus(guide: GuideState, key: JourneyStepKey): StepStatus {
  return guide.steps[key]?.status ?? "not_started";
}

/** The guide as the API returns it: every step listed in order, dates as they are. */
export function guideView(guide: GuideState) {
  return {
    contactId: guide.contactId,
    currentStep: guide.currentStep,
    steps: JOURNEY_STEPS.map((s) => ({ key: s.key, status: stepStatus(guide, s.key), updatedAt: guide.steps[s.key]?.updatedAt ?? null })),
    suggestion: guide.suggestion ?? null,
    startedAt: guide.startedAt,
  };
}

export function isJourneyStepKey(v: unknown): v is JourneyStepKey {
  return typeof v === "string" && (JOURNEY_STEP_KEYS as readonly string[]).includes(v);
}
