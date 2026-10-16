import type { MarketPackDefinition } from "../types";

/** Nepal: the Ministry of Education's No Objection Certificate gates every forex release under Nepal Rastra Bank's unified circular; MOFA consular attestation (no apostille). Research: docs/markets/nepal.md. */
export const NEPAL: MarketPackDefinition = {
  market: "nepal",
  label: "Nepal",
  version: "2026-10-08b",
  languages: { draft: "Nepali (Devanagari) or Romanized Nepali" },
  officialSources: [
    { domain: "noc.moest.gov.np", authority: "education_ministry", topics: ["financial_viability", "offer_enrolment", "document_preparation", "visa_process", "university_selection", "program_selection"] },
    { domain: "moest.gov.np", authority: "education_ministry", topics: "all" },
    { domain: "nrb.org.np", authority: "central_bank", topics: ["financial_viability", "offer_enrolment", "scholarship_funding", "visa_process", "visa_risk_analysis", "document_preparation"] },
    { domain: "nepalpolice.gov.np", authority: "police", topics: ["document_preparation", "visa_process", "visa_risk_analysis", "migration_pathway"] },
    { domain: "mofa.gov.np", authority: "foreign_ministry", topics: ["document_preparation", "visa_process", "application_process"] },
    { domain: "neb.gov.np", authority: "credential_body", topics: ["eligibility_check", "document_preparation", "application_process", "program_selection", "alternative_pathways"] },
    { domain: "tu.edu.np", authority: "credential_body", topics: ["eligibility_check", "document_preparation", "application_process"] },
    { domain: "ku.edu.np", authority: "credential_body", topics: ["eligibility_check", "document_preparation", "application_process"] },
    { domain: "ird.gov.np", authority: "government", topics: ["financial_viability", "document_preparation", "visa_risk_analysis"] },
  ],
  vocabulary: {
    financial_viability: ["No Objection Certificate Foreign Study Permit", "Nepal Rastra Bank unified circular student foreign exchange", "education loan Nepal property collateral", "ward office income source certificate", "relationship certificate ward office", "personal tax clearance certificate Nepal", "property valuation report Nepal", "cooperative deposit visa evidence"],
    offer_enrolment: ["No Objection Certificate Foreign Study Permit", "NOC eligible institution list", "Nepal Rastra Bank student remittance", "tuition remittance from Nepal"],
    document_preparation: ["No Objection Certificate Foreign Study Permit", "Nepal Police online police clearance", "Nepal e-Attestation System consular services", "NEB verification letter", "Tribhuvan University transcript", "relationship certificate ward office", "certified translation Nepali documents", "Bikram Sambat date conversion"],
    visa_process: ["Nepal Police online police clearance", "No Objection Certificate Foreign Study Permit", "education loan sanction letter Nepal", "biometrics collection centre Kathmandu", "UK TB test clinic Nepal"],
    visa_risk_analysis: ["genuine student Nepal", "study gap explanation Nepal", "source of funds Nepal", "cooperative statement forgery", "course downgrade visa refusal Nepal", "Australia evidence level Nepal"],
    eligibility_check: ["NEB letter grading", "NG non-graded subject NEB", "SLC division", "Tribhuvan University grading", "three-year bachelor Nepal entry requirements", "medium of instruction letter Nepal", "NEB English grade waiver"],
    scholarship_funding: ["education loan Nepal", "scholarships for Nepali students"],
    application_process: ["NEB transcript", "Tribhuvan University transcript Controller of Examinations", "provisional certificate Nepal", "WES Nepal sealed transcript"],
    compliance_ethics: ["Educational Consultancy Language Teaching and Preparatory Class Regulations", "consultancy licence renewal Ministry of Education Nepal", "written agreement with student consultancy Nepal", "NOC facilitation money bribery"],
    strategic_planning: ["Dashain Tihar office closures", "NEB result publication", "NOC peak season", "Bikram Sambat fiscal year"],
  },
};
