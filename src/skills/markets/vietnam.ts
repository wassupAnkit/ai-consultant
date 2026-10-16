import type { MarketPackDefinition } from "../types";

/** Vietnam: State Bank of Vietnam foreign-currency rules for study, police-issued judicial record certificates (paper for use abroad), the new apostille alongside consular legalisation, and provincial registration of consultancies. Research: docs/markets/vietnam.md. */
export const VIETNAM: MarketPackDefinition = {
  market: "vietnam",
  label: "Vietnam",
  version: "2026-10-08b",
  languages: { draft: "Vietnamese" },
  officialSources: [
    { domain: "moet.gov.vn", authority: "education_ministry", topics: "all" },
    { domain: "sbv.gov.vn", authority: "central_bank", topics: ["financial_viability", "offer_enrolment", "scholarship_funding", "visa_process"] },
    { domain: "mofa.gov.vn", authority: "foreign_ministry", topics: ["document_preparation", "visa_process", "application_process"] },
    { domain: "lanhsuvietnam.gov.vn", authority: "foreign_ministry", topics: ["document_preparation", "visa_process", "application_process"] },
    { domain: "mps.gov.vn", authority: "police", topics: ["document_preparation", "visa_process", "visa_risk_analysis"] },
    { domain: "dichvucong.gov.vn", authority: "government", topics: ["document_preparation", "visa_process"] },
    { domain: "xuatnhapcanh.gov.vn", authority: "police", topics: ["document_preparation", "visa_process"] },
    { domain: "moj.gov.vn", authority: "government", topics: ["document_preparation", "visa_process", "visa_risk_analysis"] },
  ],
  vocabulary: {
    financial_viability: ["State Bank of Vietnam foreign currency transfer study abroad", "savings book sổ tiết kiệm balance confirmation", "loan to deposit money prohibition", "household business registration tax records", "education loan Vietnam", "loan commitment letter proof of funds", "sponsor income evidence Vietnam"],
    offer_enrolment: ["foreign currency transfer for study abroad Vietnam", "fee notice tuition and living costs", "tuition transfer from Vietnam"],
    document_preparation: ["judicial record certificate phiếu lý lịch tư pháp", "judicial record paper certificate for use abroad", "VNeID judicial record", "Vietnam apostille competent authority", "consular legalisation Vietnam", "certified translation notary Vietnam", "học bạ transcript book", "provisional graduation certificate Vietnam"],
    visa_process: ["judicial record certificate phiếu lý lịch tư pháp", "Vietnam apostille objection destination", "visa application centre Hanoi Ho Chi Minh City Da Nang", "UK TB test clinic Vietnam"],
    visa_risk_analysis: ["genuine student Vietnam", "source of funds Vietnam", "savings book opened recently", "family ties Vietnam", "Australia evidence level Vietnam"],
    eligibility_check: ["Vietnamese ten-point grading scale", "four-point GPA credit system Vietnam", "national high school graduation exam", "upper secondary graduation diploma", "university transcript bảng điểm", "APS certificate Vietnam"],
    scholarship_funding: ["scholarships for Vietnamese students", "state budget scholarship obligations", "education loan Vietnam"],
    application_process: ["học bạ transcript book", "university transcript bảng điểm", "certified translation notary Vietnam"],
    compliance_ethics: ["study abroad consultancy registration certificate", "Department of Education and Training consultancy registration", "study abroad consultant training certificate"],
  },
};
