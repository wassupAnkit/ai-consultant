import type { MarketPackDefinition } from "../types";

/** Bangladesh: the Bangladesh Bank student file at an authorised dealer bank carries every transfer; MOFA e-Apostille on MyGov; QR-verifiable bank statements. Research: docs/markets/bangladesh.md. */
export const BANGLADESH: MarketPackDefinition = {
  market: "bangladesh",
  label: "Bangladesh",
  version: "2026-10-08b",
  languages: { draft: "Bengali (Bangla script)" },
  officialSources: [
    { domain: "bb.org.bd", authority: "central_bank", topics: ["financial_viability", "offer_enrolment", "scholarship_funding", "visa_process", "visa_risk_analysis"] },
    { domain: "moedu.gov.bd", authority: "education_ministry", topics: "all" },
    { domain: "mofa.gov.bd", authority: "foreign_ministry", topics: ["document_preparation", "visa_process", "application_process"] },
    { domain: "mygov.bd", authority: "government", topics: ["document_preparation", "visa_process", "application_process"] },
    { domain: "pcc.police.gov.bd", authority: "police", topics: ["document_preparation", "visa_process", "visa_risk_analysis", "migration_pathway"] },
    { domain: "bdris.gov.bd", authority: "government", topics: ["document_preparation", "visa_process", "family_planning"] },
    { domain: "ugc.gov.bd", authority: "regulator", topics: ["eligibility_check", "university_selection", "program_selection", "document_preparation"] },
    { domain: "educationboardresults.gov.bd", authority: "credential_body", topics: ["eligibility_check", "document_preparation", "application_process"] },
    { domain: "dhakaeducationboard.gov.bd", authority: "credential_body", topics: ["eligibility_check", "document_preparation", "application_process"] },
  ],
  vocabulary: {
    financial_viability: ["Bangladesh Bank student file", "Guidelines for Foreign Exchange Transactions education", "international card payment tuition Bangladesh Bank", "QR code bank statement solvency certificate", "bank solvency certificate verification", "TIN and income tax return sponsor", "fixed deposit receipt history", "fund support fraud Bangladesh"],
    offer_enrolment: ["Bangladesh Bank student file", "authorised dealer bank student file", "tuition remittance from Bangladesh", "international card payment tuition Bangladesh Bank"],
    document_preparation: ["police clearance certificate online Bangladesh", "MOFA e-Apostille MyGov", "board certificate verification", "UGC attestation degree certificate", "birth registration number English certificate", "NID verification", "name spelling match passport"],
    visa_process: ["police clearance certificate online Bangladesh", "MOFA e-Apostille MyGov", "QR code bank statement solvency certificate", "UK TB test clinic Bangladesh", "visa application centre Dhaka"],
    visa_risk_analysis: ["source of funds Bangladesh", "session jam study gap", "genuine student Bangladesh", "UK university recruitment pause Bangladesh", "Australia evidence level Bangladesh", "falsified documents joint warning missions"],
    eligibility_check: ["SSC and HSC GPA", "HSC subject mapping grades", "National University three-year Pass degree", "UK ENIC Bangladesh bachelor comparability", "Dakhil and Alim equivalence", "university CGPA scale Bangladesh", "O level and A level Bangladesh"],
    scholarship_funding: ["education loan Bangladesh", "scholarships for Bangladeshi students", "funded graduate assistantship"],
    compliance_ethics: ["education consultancy regulation Bangladesh", "unlicensed agent warning missions Dhaka", "fund support fraud Bangladesh"],
    application_process: ["education board transcript", "sealed university transcript WES Bangladesh", "Controller of Examinations transcript", "medium of instruction letter Bangladesh"],
  },
};
