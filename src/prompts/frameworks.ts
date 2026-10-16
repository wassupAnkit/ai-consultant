import type { PrimaryIntent } from "../schemas/intent.schema";
import * as b1 from "./frameworks/batch1";
import * as b2 from "./frameworks/batch2";
import * as b3 from "./frameworks/batch3";

/**
 * Domain frameworks distilled from Expert Education's original counsellor
 * prompts (archived under docs/legacy/langfuse-prompts/). Appended to the
 * matching intent playbook so every intent keeps the full depth of the
 * counsellors' methodology: assessment steps, rubrics, required response
 * sections, edge cases and flag handling. Framework-level only: fees, dates
 * and score thresholds come from the knowledge base.
 */
export const INTENT_FRAMEWORKS: Partial<Record<PrimaryIntent, string>> = {
  visa_risk_analysis: b1.visa_risk_analysis,
  financial_viability: b1.financial_viability,
  eligibility_check: b1.eligibility_check,
  application_process: b1.application_process,
  scholarship_funding: b1.scholarship_funding,
  work_survival: b1.work_survival,
  anxiety_reassurance: b3.anxiety_reassurance,
  strategic_planning: b3.strategic_planning,
  comparative_decision: b3.comparative_decision,
  alternative_pathways: b3.alternative_pathways,
  general_inquiry: b3.general_inquiry,
  migration_pathway: b2.migration_pathway,
  career_roi: b2.career_roi,
  lifestyle_adaptation: b2.lifestyle_adaptation,
  family_planning: b2.family_planning,
  program_selection: b2.program_selection,
  university_selection: b2.university_selection,
};

/** Extra disambiguation rules appended to the classifier prompt. */
export const CLASSIFIER_NOTES = b3.classifier_notes;
