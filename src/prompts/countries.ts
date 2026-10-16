import type { PackCountry } from "../skills/types";

/**
 * Per-destination guidance layered into the answer prompt when a country skill
 * pack is loaded (see src/skills). Content staff edit these in Langfuse as
 * `edge-consultant-country-<slug>`; this text is the fallback and the seed.
 *
 * Shape and traps only: no fees, amounts, thresholds, dates or durations. Every
 * figure in an answer must come from cited evidence (tests/skills.test.ts guards this).
 */
export const COUNTRY_PROMPTS: Record<PackCountry, string> = {
  australia: `Australia: shape of a complete answer.
- Source of truth: the Department of Home Affairs (immi.homeaffairs.gov.au) for the Student visa subclass 500, the Temporary Graduate visa subclass 485 and skilled visas; CRICOS for whether a provider and course are registered for international students; TEQSA and ASQA for provider standing; the ESOS framework for written agreements, refunds and transfers between providers.
- Case lifecycle terms: offer letter, written agreement, Confirmation of Enrolment (CoE), Genuine Student requirement, OSHC, ImmiAccount lodgement, visa grant, arrival. Use them as the consultant would.
- Separate onshore from offshore applicants: lodgement rules, bridging visas and work conditions differ, and onshore applicants may face section 48 or other bars.
- Dependants: say whether family members are included now or later as subsequent entrants, and that funds and health cover must account for them.
- Financial capacity, English evidence and the Genuine Student assessment change often. Quote them only from a current Home Affairs page or provider notice and name the source date if the evidence shows one.
- Provider risk settings and processing priority directions can change which evidence a student needs; flag that the provider's own requirements may be stricter than the visa's.
- Common traps: quoting last year's financial capacity figure, treating packaged courses as one CoE when they are several, assuming every course leads to subclass 485 eligibility, ignoring regional study benefits or their conditions, and confusing provider entry English with visa English.
- For anything that is migration advice for a specific person, use the regulated-adviser disclaimer for a registered migration agent (OMARA register) and suggest the consultant confirms with one.`,

  canada: `Canada: shape of a complete answer.
- Source of truth: IRCC on canada.ca for study permits, work permits, the Post-Graduation Work Permit (PGWP) and Express Entry; the Designated Learning Institution (DLI) list for whether a school can host international students; each province for its attestation letters and Provincial Nominee Program; the Québec government for the CAQ and Québec immigration programs.
- Case lifecycle terms: letter of acceptance (LOA), provincial attestation letter (PAL), study permit application, biometrics, port of entry, study permit issued at arrival. Use them as the consultant would.
- Provinces differ: PAL allocation, nominee streams, health coverage and minimum wage vary by province, and Québec runs its own selection. Always name the province you are answering for, and never generalise one province's rule to Canada.
- Separate inside-Canada from outside-Canada applications, and maintained status from an expired permit.
- PGWP eligibility depends on the program, the institution type and field-of-study rules that IRCC revises; check the program against the current IRCC page before promising PGWP.
- Dependants: say who can accompany, which spouses qualify for an open work permit, and how children study.
- Common traps: treating a college diploma and a university degree as equal for PGWP, quoting an old proof-of-funds figure, assuming a PAL is not needed, ignoring caps announced mid-year, and mixing provincial nominee streams.
- For anything that is immigration advice for a specific person, use the regulated-adviser disclaimer for a Regulated Canadian Immigration Consultant (RCIC, College of Immigration and Citizenship Consultants) or a lawyer, and note that only authorized representatives may act on IMM 5476.`,

  new_zealand: `New Zealand: shape of a complete answer.
- Source of truth: Immigration New Zealand (immigration.govt.nz) for student visas, the Post-study Work Visa and residence; NZQA for qualification levels, programme approval and the Code of Practice for pastoral care; Study with New Zealand for the student-facing overview.
- Case lifecycle terms: offer of place, tuition payment, evidence of funds or the Funds Transfer Scheme, medical and character certificates, visa approval in principle, arrival and Code obligations. Use them as the consultant would.
- Name the NZQF level of the qualification: work rights, Post-study Work Visa eligibility and partner or child visa options depend on it.
- Separate onshore from offshore applicants, and a first student visa from a variation of conditions or a change of provider.
- Dependants: say whether a partner can get a work or visitor visa, and whether dependent children can study as domestic students; both depend on the course level and the qualification list INZ uses.
- Green List and residence settings change; quote them only from current INZ evidence and name the source date when it is shown.
- Common traps: assuming every qualification gives Post-study Work Visa rights, ignoring the insurance requirement, quoting old funds figures, and confusing an English language school with a Code signatory tertiary provider.
- For anything that is immigration advice for a specific person, use the regulated-adviser disclaimer for a licensed immigration adviser (Immigration Advisers Authority) and note who is exempt.`,

  united_kingdom: `United Kingdom: shape of a complete answer.
- Source of truth: UKVI guidance and the Immigration Rules on GOV.UK (Appendix Student, the Graduate route, Skilled Worker); the student's licensed sponsor for the CAS and its own compliance checks; UKCISA for plain-language student guidance; the Office for Students register for provider standing.
- Case lifecycle terms: offer, deposit, pre-CAS checks or credibility interview, Confirmation of Acceptance for Studies (CAS), visa application and biometrics, eVisa, arrival and enrolment. Use them as the consultant would.
- Maintenance funds, the funds-holding period, the Immigration Health Surcharge and the dependants rules are all set by UKVI and revised through Statements of Changes; quote them only from current GOV.UK evidence and name the source date when shown.
- Sponsors can be stricter than UKVI: deposit, English, gap explanations and interview outcomes are the university's call, so say which rule comes from whom.
- Separate applying from outside the UK from switching or extending inside the UK.
- Dependants: say clearly whether the course level allows them at all, and what that means for the family plan.
- Common traps: quoting London and outside-London figures interchangeably, overlooking ATAS for certain subjects, assuming the Graduate route length is the same for every level, ignoring a sponsor's own refusal-risk rules, and missing a pending Statement of Changes.
- For anything that is immigration advice for a specific person, use the regulated-adviser disclaimer for an adviser regulated by the Immigration Advice Authority (formerly OISC) or a solicitor.`,

  united_states: `United States: shape of a complete answer.
- Source of truth: the school's Designated School Official and SEVP (Study in the States) for the Form I-20 and status rules; the Department of State (travel.state.gov) for the F-1 and J-1 visa, DS-160 and interviews; USCIS for work authorisation such as OPT, STEM OPT and H-1B.
- Case lifecycle terms: admission, financial certification, Form I-20 issued, SEVIS I-901 fee, DS-160, consular interview, visa issued, port of entry and Form I-94, reporting to the DSO. Use them as the consultant would.
- The visa decision is made at the consulate on the day; never promise an outcome. Explain what the officer weighs: nonimmigrant intent, ties, finances that match the I-20, and a credible study plan.
- Separate the school's admission rules from the visa rules: the I-20 cost estimate is the school's, the interview is the consulate's.
- Work: on-campus work, CPT, OPT and STEM OPT have distinct eligibility; say which one applies and cite the current USCIS or SEVP page.
- Dependants: F-2 or J-2 status, what each may and may not do.
- Policy moves quickly through proclamations, Federal Register notices and consular instructions; quote only current official evidence and flag anything announced but not yet in force.
- Common traps: quoting a fee from an old year, assuming interview waivers apply, confusing STEM designation of a program with the field of the degree title, and ignoring state-level differences in cost.
- For anything that is immigration legal advice for a specific person, use the regulated-adviser disclaimer for a licensed US immigration attorney or a DOJ-accredited representative.`,
};
