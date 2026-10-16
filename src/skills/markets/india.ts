import type { MarketPackDefinition } from "../types";

/** India: RBI's Liberalised Remittance Scheme and income-tax TCS shape funding; Passport Seva issues police clearance; MEA apostille via e-Sanad. Research: docs/markets/india.md. */
export const INDIA: MarketPackDefinition = {
  market: "india",
  label: "India",
  version: "2026-10-08b",
  languages: { draft: "Hindi or the family's regional language (Punjabi, Gujarati, Telugu, Tamil, Malayalam, Marathi, Bengali, Kannada and others), in its own script or romanised" },
  officialSources: [
    { domain: "rbi.org.in", authority: "central_bank", topics: ["financial_viability", "offer_enrolment", "scholarship_funding", "visa_process"] },
    { domain: "incometax.gov.in", authority: "government", topics: ["financial_viability", "offer_enrolment", "document_preparation", "visa_risk_analysis"] },
    { domain: "education.gov.in", authority: "education_ministry", topics: "all" },
    { domain: "mea.gov.in", authority: "foreign_ministry", topics: ["document_preparation", "visa_process", "application_process", "migration_pathway"] },
    { domain: "esanad.nic.in", authority: "foreign_ministry", topics: ["document_preparation", "application_process"] },
    { domain: "passportindia.gov.in", authority: "foreign_ministry", topics: ["document_preparation", "visa_process", "visa_risk_analysis", "migration_pathway"] },
    { domain: "ugc.gov.in", authority: "regulator", topics: ["eligibility_check", "university_selection", "program_selection", "career_roi"] },
    { domain: "naac.gov.in", authority: "regulator", topics: ["eligibility_check", "program_selection"] },
    { domain: "cbse.gov.in", authority: "credential_body", topics: ["eligibility_check", "test_preparation", "document_preparation"] },
    { domain: "digilocker.gov.in", authority: "government", topics: ["document_preparation", "application_process"] },
    { domain: "vidyalakshmi.co.in", authority: "government", topics: ["financial_viability", "scholarship_funding"] },
    { domain: "indiacode.nic.in", authority: "government", topics: ["compliance_ethics"] },
  ],
  vocabulary: {
    financial_viability: ["RBI Liberalised Remittance Scheme education", "TCS on education remittance", "loan-funded remittance TCS", "education loan sanction letter", "Vidya Lakshmi education loan portal", "chartered accountant net worth certificate", "income tax return sponsor India", "agricultural income land records"],
    offer_enrolment: ["tuition remittance under LRS", "authorised dealer bank remittance", "TCS on tuition remittance", "education loan disbursement to university"],
    document_preparation: ["police clearance certificate Passport Seva", "MEA apostille e-Sanad", "sealed transcripts WES India", "DigiLocker marksheet", "APS certificate India Germany", "medium of instruction letter India", "name and date of birth mismatch passport"],
    visa_process: ["police clearance certificate Passport Seva", "education loan sanction letter", "UK TB test clinic India", "panel physician India", "visa application centre India biometrics"],
    visa_risk_analysis: ["study gap evidence India", "backlogs disclosure", "source of funds India", "fake admission letter Canada", "state-based recruitment restrictions Australia", "Australia evidence level India"],
    eligibility_check: ["three-year bachelor India acceptance", "WES three-year degree NAAC", "CGPA to percentage formula on transcript", "backlogs ATKT", "CBSE marks", "state board marks", "NAAC accreditation grade"],
    scholarship_funding: ["education loan India", "Vidya Lakshmi education loan portal", "scholarships for Indian students"],
    application_process: ["sealed transcripts university India", "consolidated marksheet", "provisional degree certificate India", "medium of instruction letter India"],
    compliance_ethics: ["Punjab Travel Professionals Regulation Act licence", "education agent regulation India", "Overseas Mobility Facilitation and Welfare Bill", "Australia onshore transfer commission ban"],
  },
};
