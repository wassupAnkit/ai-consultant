import type { MarketPackDefinition } from "../types";

/** Sri Lanka: CBSL foreign-exchange framework (authorised dealers, PFCA), MFA Consular Affairs authentication (no apostille; check e-DAS is operating), Department of Examinations and RGD records, police clearance e-services. Research: docs/markets/sri_lanka.md. */
export const SRI_LANKA: MarketPackDefinition = {
  market: "sri_lanka",
  label: "Sri Lanka",
  version: "2026-10-08b",
  languages: { draft: "Sinhala, Tamil or English, as the family prefers" },
  officialSources: [
    { domain: "cbsl.gov.lk", authority: "central_bank", topics: ["financial_viability", "offer_enrolment", "scholarship_funding", "visa_process"] },
    { domain: "mfa.gov.lk", authority: "foreign_ministry", topics: ["document_preparation", "visa_process", "application_process"] },
    { domain: "ugc.ac.lk", authority: "regulator", topics: ["eligibility_check", "university_selection", "program_selection", "document_preparation", "alternative_pathways"] },
    { domain: "moe.gov.lk", authority: "education_ministry", topics: "all" },
    { domain: "doenets.lk", authority: "credential_body", topics: ["eligibility_check", "document_preparation", "application_process"] },
    { domain: "police.lk", authority: "police", topics: ["document_preparation", "visa_process", "visa_risk_analysis"] },
    { domain: "rgd.gov.lk", authority: "government", topics: ["document_preparation", "visa_process", "family_planning"] },
    { domain: "documents.gov.lk", authority: "government", topics: ["financial_viability", "eligibility_check", "university_selection"] },
  ],
  vocabulary: {
    financial_viability: ["CBSL outward remittance education authorised dealer", "personal foreign currency account PFCA education", "foreign exchange order outward remittance limits", "education loan co-borrower Sri Lanka", "gold pawning loan evidence", "finance company funds letter verification"],
    offer_enrolment: ["tuition remittance Sri Lanka authorised dealer", "PFCA payment of student fees"],
    document_preparation: ["police clearance certificate online Sri Lanka", "MFA Consular Affairs authentication e-DAS", "e-DAS attestation suspension", "Department of Examinations certificate foreign ministry", "Registrar General birth certificate translation", "NIC passport name mismatch affidavit"],
    visa_process: ["police clearance certificate online Sri Lanka", "MFA Consular Affairs authentication e-DAS", "UK TB test clinic Sri Lanka", "visa application centre Colombo"],
    visa_risk_analysis: ["genuine student Sri Lanka", "TNE alternative at home genuine student", "source of funds Sri Lanka", "study gap after A/L", "Australia evidence level Sri Lanka"],
    eligibility_check: ["GCE Ordinary Level results", "GCE Advanced Level results", "Z-score", "three-year general degree Sri Lanka", "special degree honours Sri Lanka", "external degree Sri Lanka", "degree awarding institute UGC"],
    scholarship_funding: ["education loan Sri Lanka", "Ministry of Education overseas scholarship", "scholarships for Sri Lankan students"],
    application_process: ["Department of Examinations certificate", "university transcript Sri Lanka", "top-up degree awarding body"],
    compliance_ethics: ["education agent regulation Sri Lanka", "fake education agents warning", "unauthorised agents scholarship warning"],
  },
};
