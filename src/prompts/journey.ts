import { stepFieldGaps, type StudentSnapshot } from "../crm/student";
import { JOURNEY_STEPS, journeyStep, nextJourneyStep, STUDENT_FIELDS, type JourneyStepKey } from "../journey/steps";
import { compileTemplate } from "./compile";

/**
 * The guided-session block of the system prompt (`{{guided_session}}`), filled only when the
 * turn belongs to a guided session. It adds the journey on top of the intent playbook, which
 * still decides how the question itself is answered. Registered as its own prompt so Langfuse
 * can tune it without touching the system prompt.
 */
export const GUIDED_SESSION_PROMPT = `This conversation is a guided session: the consultant is working one student through the journey, one step at a time. The student's facts come from the CRM record in the excerpts (source="crm"); cite it like any other excerpt.

Student: {{student}} | CRM record: {{crm_status}}
Journey: {{journey}}
Current step: {{step_number}} of {{step_count}} — {{step_label}}. Goal: {{step_goal}}
What to cover at this step:
{{checklist}}
Missing in the CRM for this step: {{missing}}
Not visible to Edge in the CRM (neither missing nor known): {{unknown}}
Also ask the student (the CRM has no field for these): {{ask_student}}
Next step: {{next_step}}

How to work in a guided session:
- Answer the consultant's actual question first, fully, following the task playbook. The journey never replaces the answer.
- Use the CRM facts (destinations, qualification, tests, intake, applications) as the case facts, so the consultant does not have to repeat them. When a fact the answer depends on is missing, say which one, rather than assuming it.
- Then close with one short paragraph that starts "Next for {{student_first}}:" — one or two sentences, no list, no heading — naming the most useful thing to ask the student or check next at this step, taken from the missing fields and the list above. Leave out anything the conversation has already covered. It should read like a colleague's aside, not a form.
- Stay on the current step. If the question belongs to a later step, answer it anyway and name, in one line, what from an earlier step is still open that the answer depends on.
- When the consultant states a new fact about the student that belongs in the CRM (a score, an intake, a destination, a funding source), add one line "Update in CRM: <field> → <value>" so they can record it, or ask you to prepare the change. If CRM changes were proposed this turn, follow the CRM changes rule instead of adding that line. Never say the CRM was changed; only the consultant's approval on a card changes it.
- Never mark a step done or say the student is ready to move on unless the CRM facts show it; the consultant moves the step.`;

export interface GuidedPromptInput {
  step: JourneyStepKey;
  stepsDone: JourneyStepKey[];
  snapshot: StudentSnapshot | null;
  /** Why the snapshot is missing, when it is. */
  crmMessage?: string;
}

/** Fill the guided block for one turn. */
export function renderGuidedSession(template: string, g: GuidedPromptInput): string {
  const step = journeyStep(g.step);
  const next = nextJourneyStep(g.step);
  const { missing, unknown } = stepFieldGaps(g.snapshot, g.step);
  const label = (fs: typeof missing) => fs.map((f) => STUDENT_FIELDS[f].label).join(", ") || "none";
  const done = new Set(g.stepsDone);
  return compileTemplate(template, {
    student: g.snapshot ? g.snapshot.name : "unknown (CRM record not available)",
    student_first: g.snapshot?.name.split(/\s+/)[0] || "the student",
    crm_status: g.snapshot ? `read live ${g.snapshot.fetchedAt}` : (g.crmMessage ?? "unavailable"),
    journey: JOURNEY_STEPS.map((s) => `${s.order}. ${s.label}${s.key === g.step ? " (current)" : done.has(s.key) ? " (done)" : ""}`).join(" → "),
    step_number: String(step.order),
    step_count: String(JOURNEY_STEPS.length),
    step_label: step.label,
    step_goal: step.goal,
    checklist: step.checklist.map((c) => `- ${c}`).join("\n"),
    missing: g.snapshot ? label(missing) : "unknown (CRM record not available)",
    unknown: g.snapshot ? label(unknown) : "unknown",
    ask_student: step.askStudent.join("; ") || "none",
    next_step: next ? `${next.order}. ${next.label}` : "none (last step)",
  });
}

/** One line for the research planner, so lookups use the student's case facts. */
export function guidedStudentLine(snapshot: StudentSnapshot | null): string {
  if (!snapshot) return "none";
  const destinations = [...new Set(snapshot.deals.flatMap((d) => d.countries))];
  return [
    `${snapshot.name} (CRM contact ${snapshot.contactId}), already loaded as a CRM excerpt — do not search the CRM for them again`,
    destinations.length ? `destinations ${destinations.join(", ")}` : null,
    snapshot.nationality ? `nationality ${snapshot.nationality}` : null,
    snapshot.education[0]?.degreeLevel ? `qualification ${snapshot.education[0].degreeLevel}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}
