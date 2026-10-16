import type { MarketPackDefinition } from "../types";

/** Philippines: PSA civil documents, NBI clearance, DepEd/CHED CAV then DFA apostille (Germany objects), PRC for nurses; DMW polices study-plus-job offers. CFO applies to emigrants and exchange visitors, not ordinary degree students. Research: docs/markets/philippines.md. */
export const PHILIPPINES: MarketPackDefinition = {
  market: "philippines",
  label: "Philippines",
  version: "2026-10-08b",
  languages: { draft: "English, or Filipino (Tagalog) or Taglish when the family prefers it" },
  officialSources: [
    { domain: "ched.gov.ph", authority: "regulator", topics: ["eligibility_check", "document_preparation", "program_selection", "university_selection", "application_process"] },
    { domain: "deped.gov.ph", authority: "education_ministry", topics: ["eligibility_check", "document_preparation", "application_process"] },
    { domain: "prc.gov.ph", authority: "regulator", topics: ["career_roi", "migration_pathway", "eligibility_check", "document_preparation"] },
    { domain: "dfa.gov.ph", authority: "foreign_ministry", topics: ["document_preparation", "visa_process", "application_process"] },
    { domain: "apostille.gov.ph", authority: "foreign_ministry", topics: ["document_preparation", "visa_process", "application_process"] },
    { domain: "passport.gov.ph", authority: "foreign_ministry", topics: ["document_preparation", "visa_process"] },
    { domain: "psa.gov.ph", authority: "government", topics: ["document_preparation", "visa_process", "family_planning", "financial_viability"] },
    { domain: "nbi.gov.ph", authority: "police", topics: ["document_preparation", "visa_process", "visa_risk_analysis"] },
    { domain: "bsp.gov.ph", authority: "central_bank", topics: ["financial_viability", "offer_enrolment", "scholarship_funding"] },
    { domain: "immigration.gov.ph", authority: "government", topics: ["visa_process", "visa_risk_analysis", "document_preparation"] },
    { domain: "tieza.gov.ph", authority: "government", topics: ["financial_viability", "visa_process", "scholarship_funding"] },
    { domain: "cfo.gov.ph", authority: "government", topics: ["migration_pathway", "family_planning"] },
    { domain: "dmw.gov.ph", authority: "government", topics: ["work_survival", "migration_pathway", "career_roi", "compliance_ethics"] },
    { domain: "tesda.gov.ph", authority: "credential_body", topics: ["eligibility_check", "alternative_pathways"] },
  ],
  vocabulary: {
    financial_viability: ["proof of funds Philippines", "sponsor abroad payslip employment letter", "PSA birth certificate sponsor relationship", "bank certificate Philippines", "income tax return BIR", "show money red flag", "BSP cross-border currency declaration"],
    offer_enrolment: ["tuition bank transfer from the Philippines", "outward remittance tuition Philippines bank"],
    document_preparation: ["PSA birth certificate", "PSA marriage certificate CENOMAR", "NBI clearance", "CHED eCAV certification authentication verification", "DepEd CAV", "DFA apostille appointment", "Germany objection Philippine apostille", "PRC certification good standing"],
    visa_process: ["NBI clearance", "DFA apostille appointment", "Bureau of Immigration departure formalities student", "UK TB test clinic Philippines", "visa application centre Manila"],
    visa_risk_analysis: ["genuine student caregiver", "source of funds Philippines", "previous visa refusal disclosure", "study gap mature applicant", "immigrant intent US relatives"],
    eligibility_check: ["Philippine university grading scale inverted", "transcript grading legend", "general weighted average", "K to twelve senior high school diploma", "pre K to twelve secondary education", "UK majority English-speaking country list"],
    career_roi: ["PRC nursing licence", "NMBA outcomes-based assessment", "NCLEX", "NMC test of competence", "employer-sponsored nursing route"],
    migration_pathway: ["CFO registration emigrant", "PRC nursing licence overseas registration", "DMW overseas employment certificate"],
    family_planning: ["PSA marriage certificate", "PSA birth certificate children", "student visa dependants rules"],
    compliance_ethics: ["DMW illegal recruitment student visa", "DMW licence recruitment agency", "study and job placement illegal recruitment"],
  },
};
