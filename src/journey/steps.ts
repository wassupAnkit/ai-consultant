import type { PrimaryIntent } from "../schemas/intent.schema";

/**
 * The guided-session journey: ten steps a consultant walks one student through, condensed
 * from the S1–S11 journey stages in `docs/data-model/02-question-coverage.md`. The later
 * stages there are topics rather than steps (S12 life abroad, S13 academic rules) or apply at
 * every step (S17 risk, S19 deadlines, S20 provenance), so they live in the guided prompt as
 * rules instead of here.
 *
 * Named "journey step", never "stage": `stage` already means the X.030 case stage the
 * classifier reports and the classifying/researching/answering status of a turn.
 *
 * Student facts are the CRM's, not Edge's. A step names the CRM fields that settle it
 * (`crmFields`); Edge reads them live and never stores them. What the CRM has no field for
 * yet is `askStudent`: prompts for the consultant, not tracked as missing.
 */

export const JOURNEY_STEP_KEYS = [
  "enquiry",
  "destination",
  "course",
  "institution",
  "eligibility",
  "english",
  "application",
  "finances",
  "visa",
  "pre_departure",
] as const;
export type JourneyStepKey = (typeof JOURNEY_STEP_KEYS)[number];

/** Which part of the CRM record a field comes from, so a field the CRM does not expose yet reads as "unknown", not "missing". */
export const STUDENT_FIELD_SOURCES = ["contact", "deals", "education", "tests", "financial", "intake", "applications"] as const;
export type StudentFieldSource = (typeof STUDENT_FIELD_SOURCES)[number];

export const STUDENT_FIELD_KEYS = [
  "origin",
  "passportCountry",
  "visaType",
  "service",
  "destinations",
  "educationLevel",
  "grades",
  "englishTest",
  "intake",
  "funds",
  "institutions",
  "applicationStage",
] as const;
export type StudentFieldKey = (typeof STUDENT_FIELD_KEYS)[number];

export const STUDENT_FIELDS: Record<StudentFieldKey, { label: string; source: StudentFieldSource }> = {
  origin: { label: "Nationality / home country", source: "contact" },
  passportCountry: { label: "Passport country", source: "contact" },
  visaType: { label: "Current visa type", source: "contact" },
  service: { label: "Service they are interested in", source: "deals" },
  destinations: { label: "Destination countries", source: "deals" },
  educationLevel: { label: "Highest qualification", source: "education" },
  grades: { label: "Grades (GPA or percentage)", source: "education" },
  englishTest: { label: "English test and score", source: "tests" },
  intake: { label: "Intake (preferred or applied for)", source: "applications" },
  funds: { label: "Financial details", source: "financial" },
  institutions: { label: "Institutions applied to", source: "applications" },
  applicationStage: { label: "Application workflow stage", source: "applications" },
};

export interface JourneyStep {
  key: JourneyStepKey;
  /** 1-based position on the rail. */
  order: number;
  label: string;
  /** Journey stages from `02-question-coverage.md` this step covers. */
  docStages: string[];
  /** What the student is deciding at this step. */
  goal: string;
  /** What the consultant should ask or check, in the student's register where it helps. */
  checklist: string[];
  /** CRM fields that must be filled before Edge suggests moving on. */
  crmFields: StudentFieldKey[];
  /** Things to ask the student that the CRM has no field for yet (not tracked as missing). */
  askStudent: string[];
  /** Playbooks this step usually runs through (the "Playbooks and views" line of each stage). */
  relatedIntents: PrimaryIntent[];
  /** X.030 case stages that correspond to this step (hint only). */
  caseStages: string[];
}

export const JOURNEY_STEPS: readonly JourneyStep[] = [
  {
    key: "enquiry",
    order: 1,
    label: "Enquiry & goal",
    docStages: ["S1"],
    goal: "Why they want to study abroad and what outcome they are after: a degree, PR, a career or family.",
    checklist: [
      "What outcome do they want: a degree, work experience, PR, or joining family?",
      "What have they studied so far, and when did they finish?",
      "Which service do they need from us (admission, visa, test preparation)?",
      "Have they applied anywhere or through another agent before?",
    ],
    crmFields: ["origin", "service", "educationLevel"],
    askStudent: ["Their main goal: degree, PR, career or family"],
    relatedIntents: ["general_inquiry", "company_services", "lead_engagement"],
    caseStages: ["enquiry", "counselling"],
  },
  {
    key: "destination",
    order: 2,
    label: "Destination",
    docStages: ["S2", "S14", "S15"],
    goal: "Which country fits their budget, work rights, PR odds, family situation and English level.",
    checklist: [
      "Which countries are they considering, and why?",
      "Is PR or post-study work the priority, or the degree itself?",
      "Will a partner or children come with them?",
      "Is there a country they cannot consider (previous refusal, cost, family)?",
    ],
    crmFields: ["destinations"],
    askStudent: ["Why this country: cost, PR, work rights or family"],
    relatedIntents: ["comparative_decision", "migration_pathway", "family_planning"],
    caseStages: ["counselling"],
  },
  {
    key: "course",
    order: 3,
    label: "Course, level & pathway",
    docStages: ["S3", "S16"],
    goal: "Which level and program, and whether they go direct or through a pathway or packaged offer.",
    checklist: [
      "Which study area and level do they want?",
      "Does the course lead to the career or registration they expect?",
      "Do they meet direct entry, or do they need a pathway or foundation?",
      "Is there credit for prior study?",
    ],
    crmFields: [],
    askStudent: ["Preferred course or study area", "Target study level"],
    relatedIntents: ["program_selection", "alternative_pathways", "eligibility_check"],
    caseStages: ["counselling", "shortlist"],
  },
  {
    key: "institution",
    order: 4,
    label: "Institution shortlist",
    docStages: ["S4"],
    goal: "Which universities or colleges to apply to: ranking, cost, city and partner status.",
    checklist: [
      "Which institutions are on the shortlist, and are they our partners?",
      "Does the city and campus suit their budget and work plans?",
      "Does the institution accept students from their country and profile?",
    ],
    crmFields: ["institutions"],
    askStudent: [],
    relatedIntents: ["university_selection", "comparative_decision"],
    caseStages: ["shortlist"],
  },
  {
    key: "eligibility",
    order: 5,
    label: "Eligibility & grades",
    docStages: ["S5"],
    goal: "Whether their grades, study gap, backlogs and degree length meet the entry requirements.",
    checklist: [
      "What are their final grades (GPA or percentage) and grading scale?",
      "Is there a study gap, and can they evidence it?",
      "Any backlogs or repeated subjects?",
      "Is a three-year degree accepted for the master's they want?",
    ],
    crmFields: ["grades"],
    askStudent: ["Study gap and what they did in it"],
    relatedIntents: ["eligibility_check", "program_selection"],
    caseStages: ["shortlist"],
  },
  {
    key: "english",
    order: 6,
    label: "English & tests",
    docStages: ["S6"],
    goal: "Which English test, what score is needed, and whether a waiver or pathway applies.",
    checklist: [
      "Have they taken IELTS, PTE, TOEFL or Duolingo, and when?",
      "Does their score meet the course and the visa requirements, band by band?",
      "Are they eligible for a waiver (medium of instruction)?",
      "If short, how many weeks of pathway English would they need?",
    ],
    crmFields: ["englishTest"],
    askStudent: [],
    relatedIntents: ["test_preparation", "eligibility_check"],
    caseStages: ["shortlist", "application"],
  },
  {
    key: "application",
    order: 7,
    label: "Application & offer",
    docStages: ["S7"],
    goal: "Applying, meeting offer conditions, accepting and paying the deposit, and getting the CoE/CAS/I-20.",
    checklist: [
      "Which intake are they aiming for, and is it still open?",
      "Are the application documents complete (transcripts, passport, SOP, LORs)?",
      "What are the offer conditions and their deadlines?",
      "When is the deposit due, and what does the enrolment document need?",
    ],
    crmFields: ["intake", "applicationStage"],
    askStudent: [],
    relatedIntents: ["application_process", "document_preparation", "offer_enrolment"],
    caseStages: ["application", "offer", "acceptance_and_deposit", "coe_cas_i20"],
  },
  {
    key: "finances",
    order: 8,
    label: "Finances & scholarships",
    docStages: ["S8", "S9"],
    goal: "Total cost, the funds they must show, loans or sponsors, and scholarships they can get.",
    checklist: [
      "What is the first-year total (tuition, living, insurance, travel)?",
      "How much must they show for the visa, and in what form?",
      "Who is funding them: self, family sponsor, or an education loan?",
      "Which scholarships are they eligible for, and by when?",
    ],
    crmFields: ["funds"],
    askStudent: ["Total budget and who is funding it"],
    relatedIntents: ["financial_viability", "scholarship_funding"],
    caseStages: ["acceptance_and_deposit"],
  },
  {
    key: "visa",
    order: 9,
    label: "Visa",
    docStages: ["S10", "S14"],
    goal: "The visa type, funds, genuine-student evidence, documents, processing time and refusal risk.",
    checklist: [
      "Have they had a visa refusal for any country?",
      "Is the genuine-student statement ready and consistent with their history?",
      "Are the financial documents in the form the visa asks for?",
      "Health check, police clearance and biometrics: which apply to them?",
    ],
    crmFields: ["passportCountry", "applicationStage"],
    askStudent: ["Any previous visa refusal"],
    relatedIntents: ["visa_risk_analysis", "visa_process", "document_preparation"],
    caseStages: ["visa_lodged", "visa_granted"],
  },
  {
    key: "pre_departure",
    order: 10,
    label: "Pre-departure",
    docStages: ["S11"],
    goal: "Documents to carry, travel, accommodation, insurance, bank and SIM, and arrival.",
    checklist: [
      "Is accommodation booked for arrival?",
      "Which documents and originals must they carry?",
      "Have they booked a pre-departure session?",
      "Do they know the arrival and orientation dates?",
    ],
    crmFields: ["applicationStage"],
    askStudent: [],
    relatedIntents: ["onshore_support", "lifestyle_adaptation"],
    caseStages: ["pre_departure", "arrived"],
  },
];

const BY_KEY = new Map(JOURNEY_STEPS.map((s) => [s.key, s]));

export function journeyStep(key: JourneyStepKey): JourneyStep {
  return BY_KEY.get(key)!;
}

/** The step after `key`, or null on the last one. */
export function nextJourneyStep(key: JourneyStepKey): JourneyStep | null {
  return JOURNEY_STEPS[journeyStep(key).order] ?? null;
}
