import { z } from "zod";

/**
 * Intent taxonomy for Edge (Expert Education's internal consultant assistant).
 *
 * `primary_intent` is the topic a request touches and selects which domain
 * framework/playbook to use: the 18 study-abroad topics inherited from the
 * student-facing bot, the counsellor-work topics added in the consultant pivot
 * (caseload, offer→enrolment, visa lodgement, documents, onshore, policy change,
 * compliance, lead engagement), and three operational ones (`greeting`,
 * `human_handoff`, `general_inquiry`). `task` is orthogonal: what kind of work
 * the consultant wants done with that topic. There is no topical scope gate —
 * only prompt-injection attempts are refused (see `contextual_flags`).
 *
 * Values are only ever added, never renamed or removed: `primary_intent` is
 * stored as a plain string on every chat turn and filtered on by the activity
 * export, so old values must stay readable.
 */
export const PRIMARY_INTENTS = [
  // Emotional & guidance
  "anxiety_reassurance",
  "strategic_planning",
  "comparative_decision",
  // Eligibility & applications
  "eligibility_check",
  "application_process",
  // Financial
  "financial_viability",
  "scholarship_funding",
  "work_survival",
  // Visa & immigration
  "visa_risk_analysis",
  "migration_pathway",
  // Outcomes & life
  "career_roi",
  "lifestyle_adaptation",
  "family_planning",
  // Selection
  "program_selection",
  "university_selection",
  "alternative_pathways",
  // Test preparation & services offered by Expert Education
  "test_preparation",
  "company_services",
  // Counsellor work: the consultant's own caseload and the case lifecycle after the application
  "caseload_management",
  "offer_enrolment",
  "visa_process",
  "document_preparation",
  "onshore_support",
  "policy_change",
  "compliance_ethics",
  "lead_engagement",
  // Operational
  "greeting",
  "human_handoff",
  "general_inquiry",
] as const;

export const DESTINATIONS = [
  "australia",
  "canada",
  "united_kingdom",
  "united_states",
  "new_zealand",
  "germany",
  "ireland",
  "netherlands",
  "malaysia",
  "uae",
  "thailand",
  "other",
] as const;

export const STUDY_LEVELS = [
  "school",
  "diploma_vocational",
  "bachelor",
  "master",
  "phd",
  "english_test_only",
  "unspecified",
] as const;

export const CONTEXT_FLAGS = [
  "emotional_distress",
  "urgent_timeline",
  "missing_destination",
  "requires_clarification",
  "multi_topic",
  "prior_visa_refusal",
  "study_gap",
  "financial_constraint",
  "family_dependents",
  "prompt_injection_attempt",
  "wants_human_counsellor",
  // Added from the counsellors' original classifier
  "needs_structured_guidance",
  "profile_weakness",
  "age_concern",
  "third_party_inquiry",
  "analysis_paralysis",
  "fact_verification",
  "already_abroad",
  "complaint",
  "low_confidence_motivation",
  // Added with the counsellor-work intents
  "integrity_risk",
  "policy_recency",
  "crm_write_requested",
] as const;

export const CONFIDENCE = ["low", "medium", "high"] as const;

/** What kind of work the consultant wants done, independent of the topic. */
export const TASKS = ["lookup", "compare", "draft", "review", "eligibility", "process", "summarize", "translate", "calculate", "general"] as const;

/** Tasks whose output is text the consultant will reuse verbatim: cite nothing unless the model cited. */
export const STRICT_CITATION_TASKS: ReadonlySet<Task> = new Set<Task>(["draft", "review", "summarize", "translate"]);

export const IntentSchema = z.object({
  primary_intent: z.enum(PRIMARY_INTENTS),
  secondary_intents: z.array(z.enum(PRIMARY_INTENTS)).max(3).default([]),
  task: z
    .enum(TASKS)
    .describe(
      "The kind of work requested: lookup (find a fact), compare, draft (write text), review (check/improve supplied text), eligibility (assess a specific student), process (how-to/internal steps), summarize (condense a thread, record or pasted text, e.g. into a CRM note), translate (render supplied text in another language), calculate (work out a total, funds-to-show, points or timeline from figures), or general.",
    ),
  needs_research: z
    .boolean()
    .describe(
      "true when answering well requires looking things up (knowledge base, program data, the web, or this agency's own CRM records -- a named student, their contacts, enquiries, deals or notes); false when the request can be answered purely from what the consultant already supplied (drafting or rewriting from given facts, reasoning over pasted text, a greeting, or small talk).",
    ),
  confidence_level: z.enum(CONFIDENCE),
  destinations: z
    .array(z.enum(DESTINATIONS))
    .max(4)
    .default([])
    .describe("Countries the student mentioned or clearly implied. Empty if none."),
  study_level: z.enum(STUDY_LEVELS).default("unspecified"),
  study_area: z.string().max(80).nullable().default(null).describe("Field of study if mentioned, else null."),
  origin: z
    .string()
    .max(80)
    .nullable()
    .default(null)
    .describe(
      "Where the student under discussion is from or currently located, if stated or clearly implied (e.g. 'Nepal', 'India', 'already in Melbourne on a student visa'); else null. Never assume.",
    ),
  contextual_flags: z.array(z.enum(CONTEXT_FLAGS)).default([]),
  language: z
    .enum(["en", "ne", "mixed", "other"])
    .default("en")
    .describe("Language of the consultant's message: English, Nepali (Devanagari or romanised), mixed, or other."),
  user_question: z.string().max(600).describe("The consultant's request restated clearly in one or two sentences, in English."),
  // Generous cap: a rejected classification costs a whole turn (it falls back to general_inquiry),
  // and the model writes longer rationales when several topics overlap.
  reasoning: z.string().max(600).describe("Brief classification rationale: one or two sentences."),
});

export type Intent = z.infer<typeof IntentSchema>;

/**
 * Decisions the Jev classifier makes beyond the `Intent` contract: who the produced text is
 * for, where it goes, where the case stands, and yes/no signals for routing and prompt rules.
 * Carried on graph state next to `intent` (never part of the structured-output schema, so the
 * Gemini classifier is not asked to guess them). Absent when the Gemini classifier ran.
 */
export const ClassifierExtrasSchema = z.object({
  classifier: z.enum(["jev", "gemini-fallback"]),
  audience: z.enum(["consultant", "student", "parent_or_family", "partner_institution", "internal_team"]).default("consultant"),
  channel: z.enum(["chat_answer", "whatsapp_viber", "email", "call_script", "crm_note", "formal_document"]).default("chat_answer"),
  stage: z
    .enum([
      "enquiry",
      "counselling",
      "shortlist",
      "application",
      "offer",
      "acceptance_and_deposit",
      "coe_cas_i20",
      "visa_lodged",
      "visa_granted",
      "pre_departure",
      "arrived",
      "onshore_support",
      "unspecified",
    ])
    .default("unspecified"),
  signals: z
    .array(z.enum(["student_named", "off_topic", "crisis_safeguarding", "pii_sensitive", "migration_advice_boundary", "compound_request"]))
    .default([]),
  /** Jev's confidence in the primary topic (0–1); null when the Gemini fallback decided. */
  intent_confidence: z.number().min(0).max(1).nullable().default(null),
  /** Raw yes/no probabilities from Jev, for audit and calibration. */
  probabilities: z.record(z.string(), z.number()).default({}),
  model: z.string().nullable().default(null),
  latencyMs: z.number().nullable().default(null),
  cost: z.number().nullable().default(null),
  /** Why the Gemini fallback ran, if it did. */
  fallbackReason: z.string().nullable().default(null),
  /** Jev judged the message to depend on earlier turns; the retrieval query then carries them. */
  references_prior_turn: z.boolean().default(false),
});
export type ClassifierExtras = z.infer<typeof ClassifierExtrasSchema>;
export type PrimaryIntent = (typeof PRIMARY_INTENTS)[number];
export type Destination = (typeof DESTINATIONS)[number];
export type ContextFlag = (typeof CONTEXT_FLAGS)[number];
export type Task = (typeof TASKS)[number];

/** Human-readable country names for prompts and metadata filters. */
export const DESTINATION_LABELS: Record<Destination, string> = {
  australia: "Australia",
  canada: "Canada",
  united_kingdom: "United Kingdom",
  united_states: "United States",
  new_zealand: "New Zealand",
  germany: "Germany",
  ireland: "Ireland",
  netherlands: "Netherlands",
  malaysia: "Malaysia",
  uae: "United Arab Emirates",
  thailand: "Thailand",
  other: "Other",
};

/** Safe default used when the classifier fails: treat it as a general request and research it. */
export const FALLBACK_INTENT = (userInput: string): Intent => ({
  primary_intent: "general_inquiry",
  secondary_intents: [],
  task: "general",
  needs_research: true,
  confidence_level: "low",
  destinations: [],
  study_level: "unspecified",
  study_area: null,
  contextual_flags: ["requires_clarification"],
  origin: null,
  language: "en",
  user_question: userInput.slice(0, 600),
  reasoning: "fallback",
});
