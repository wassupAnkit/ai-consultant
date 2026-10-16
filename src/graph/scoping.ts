import type { SourceKind } from "../retrieval/store";
import type { Intent, PrimaryIntent } from "../schemas/intent.schema";

/**
 * Intent-driven research scoping: which tools the research model is offered
 * and how round 0 (the deterministic search) is shaped, decided from the
 * classified request rather than offering every configured tool every turn.
 *
 * Two principles keep a classifier mistake cheap:
 * - Tools are removed only where the topic makes them useless (web search for
 *   the consultant's own task list, CRM lookups for a policy question), never
 *   where a person might still be named. A wrong intent then costs a little
 *   focus, not the ability to answer.
 * - Round-0 filters are preferences with a fallback: an empty filtered search
 *   is retried unfiltered, so a filter can never blank the knowledge base.
 */

export interface Round0Plan {
  /** Knowledge-base filters for round 0; `null` skips the knowledge base (the CRM is the only source that matters). */
  knowledge: { sourceKinds?: SourceKind[]; docTypes?: string[] } | null;
  /** Also run the structured program search in round 0 (when a program search is configured). */
  programs: boolean;
}

export interface ResearchScope {
  /** Research-tool names the model may call; `crm_*` matches every CRM tool, `gmail_*`/`drive_*` the consultant's own Google tools. */
  tools: (name: string) => boolean;
  round0: Round0Plan;
  /** Short label recorded in the turn metadata so a trace explains why a tool was absent. */
  reason: string;
}

/** Topics where exact fees, intakes and entry requirements decide the answer: program records join round 0. */
const PROGRAM_SHAPED: ReadonlySet<PrimaryIntent> = new Set<PrimaryIntent>([
  "program_selection",
  "university_selection",
  "eligibility_check",
  "application_process",
  "offer_enrolment",
  "scholarship_funding",
  "financial_viability",
  "comparative_decision",
  "alternative_pathways",
  "document_preparation",
]);

/**
 * Topics answered from rules and our own pages, where a person lookup cannot help.
 * Everything not listed keeps the CRM tools: "does Priya qualify for Monash?" is an
 * eligibility question that still needs her record.
 */
const NO_CRM: ReadonlySet<PrimaryIntent> = new Set<PrimaryIntent>(["policy_change", "compliance_ethics", "test_preparation", "company_services"]);

/** Topics about Expert Education itself or its own services: our site and staff uploads, not partner course pages. */
const OWN_SITE_ONLY: ReadonlySet<PrimaryIntent> = new Set<PrimaryIntent>(["company_services", "test_preparation", "compliance_ethics"]);

const isCrm = (name: string) => name.startsWith("crm_");
/**
 * The consultant's mailbox follows the CRM's rules: it is about people, so it goes where the CRM
 * goes. Drive is offered everywhere — it holds internal SOPs and letters as well as student files.
 */
const isGmail = (name: string) => name.startsWith("gmail_");
const isDrive = (name: string) => name.startsWith("drive_");
const isCalendar = (name: string) => name.startsWith("calendar_");
const isDocs = (name: string) => name.startsWith("docs_");
/** Tools that read a person's own records or mail: kept where a person may matter, dropped for rules-only topics. */
const isPersonal = (name: string) => isCrm(name) || isGmail(name) || isCalendar(name);
const ALL = () => true;

/** Expert's own course catalogue as set up in the CRM: "which courses do we offer at Monash" is company_services, yet only the CRM knows. */
const CRM_CATALOGUE_TOOLS: ReadonlySet<string> = new Set(["crm_search_courses", "crm_compare_courses"]);

export function scopeResearch(
  intent: Pick<Intent, "primary_intent" | "contextual_flags">,
  ctx: {
    hasCrm: boolean;
    /** The classifier saw a named student: keep the CRM tools whatever the topic. */
    studentNamed?: boolean;
    /** The message points at the consultant's own mail ("reply to the university's email"): keep Gmail whatever the topic. */
    mentionsMail?: boolean;
  },
): ResearchScope {
  const topic = intent.primary_intent;

  if (topic === "caseload_management") {
    // The consultant's own tasks, students and pipeline live in the CRM. Web search, page fetches and
    // program records never help, and searching the knowledge base for a student's name only adds noise.
    // Without a CRM toolset the knowledge base is all there is, so it stays (internal process uploads).
    return {
      tools: (name) => isCrm(name) || isGmail(name) || isDrive(name) || isCalendar(name) || isDocs(name) || name === "search_knowledge_base",
      round0: { knowledge: ctx.hasCrm ? null : {}, programs: false },
      reason: ctx.hasCrm ? "caseload: CRM only" : "caseload: no CRM token, knowledge base only",
    };
  }

  if (NO_CRM.has(topic)) {
    const ownSite = OWN_SITE_ONLY.has(topic);
    const keepCrm = ctx.studentNamed === true;
    const catalogue = topic === "company_services";
    return {
      tools: (name) => (keepCrm || !isPersonal(name) || (catalogue && CRM_CATALOGUE_TOOLS.has(name)) || (ctx.mentionsMail === true && (isGmail(name) || isCalendar(name)))) && name !== "search_programs",
      round0: { knowledge: ownSite ? { sourceKinds: ["site", "upload"] } : {}, programs: false },
      reason: `${topic}: ${ownSite ? "own site and uploads, " : ""}no program records${keepCrm ? ", CRM kept for the named student" : ", no CRM"}`,
    };
  }

  if (PROGRAM_SHAPED.has(topic)) {
    return { tools: ALL, round0: { knowledge: {}, programs: true }, reason: `${topic}: program records in round 0` };
  }

  return { tools: ALL, round0: { knowledge: {}, programs: false }, reason: "default: all tools" };
}

/** Scope that reproduces the pre-scoping behaviour: every configured tool, plain round 0. */
export const UNSCOPED: ResearchScope = { tools: ALL, round0: { knowledge: {}, programs: false }, reason: "scoping disabled" };
