import type { MarketPackDefinition } from "../types";

/** Thailand: Bank of Thailand exchange control through banks, MFA Department of Consular Affairs legalisation (apostille not yet in force), Special Branch police clearance, military-service deferment, OCSC recognition. Research: docs/markets/thailand.md. */
export const THAILAND: MarketPackDefinition = {
  market: "thailand",
  label: "Thailand",
  version: "2026-10-08b",
  languages: { draft: "Thai" },
  officialSources: [
    { domain: "bot.or.th", authority: "central_bank", topics: ["financial_viability", "offer_enrolment", "scholarship_funding", "visa_process"] },
    { domain: "mfa.go.th", authority: "foreign_ministry", topics: "all" },
    { domain: "consular.go.th", authority: "foreign_ministry", topics: ["document_preparation", "visa_process", "application_process"] },
    { domain: "sbpolice.go.th", authority: "police", topics: ["document_preparation", "visa_process", "visa_risk_analysis"] },
    { domain: "crd.go.th", authority: "police", topics: ["document_preparation", "visa_process"] },
    { domain: "moe.go.th", authority: "education_ministry", topics: ["eligibility_check", "document_preparation", "application_process", "program_selection"] },
    { domain: "opec.go.th", authority: "regulator", topics: ["eligibility_check", "program_selection"] },
    { domain: "ocsc.go.th", authority: "government", topics: ["career_roi", "university_selection", "scholarship_funding", "program_selection"] },
    { domain: "mhesi.go.th", authority: "education_ministry", topics: ["university_selection", "career_roi"] },
    { domain: "studentloan.or.th", authority: "government", topics: ["financial_viability", "scholarship_funding"] },
    { domain: "ocpb.go.th", authority: "government", topics: ["compliance_ethics"] },
  ],
  vocabulary: {
    financial_viability: ["Bank of Thailand exchange control education", "tuition transfer with invoice Thailand", "family business income sponsor evidence", "company registration documents sponsor", "bank certificate Thailand", "Student Loan Fund overseas study"],
    offer_enrolment: ["tuition transfer from Thailand", "foreign exchange for education Thailand"],
    document_preparation: ["Department of Consular Affairs legalisation", "Thailand apostille accession", "police clearance Special Branch", "Criminal Records Division online check", "house registration ทะเบียนบ้าน", "military service deferment certificate of student status", "certified translation Thai documents"],
    visa_process: ["police clearance Special Branch", "Department of Consular Affairs legalisation", "UK TB test clinic Thailand", "visa application centre Bangkok"],
    visa_risk_analysis: ["genuine student Thailand", "return intention family business", "repeated English course progression", "OCSC scholarship bond"],
    eligibility_check: ["Thai GPA four-point scale", "Mathayom six completion", "international school diploma Thailand", "Thai international programme English-taught", "UK majority English-speaking country list"],
    program_selection: ["short English course visitor visa", "short-term study visa English", "foundation programme", "child student visa"],
    career_roi: ["OCSC degree certification", "OCSC recognised institutions", "civil service recognition foreign degree Thailand"],
    family_planning: ["military service registration Sor Dor", "under eighteen guardian student visa"],
    compliance_ethics: ["education agent regulation Thailand", "Office of the Consumer Protection Board complaint", "unaccredited foreign institution Thailand"],
  },
};
