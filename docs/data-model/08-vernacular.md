# 08 — Vernacular: student and counsellor phrasing → canonical attributes

Students and counsellors in Expert Education's markets (Nepal, India, Bangladesh, Vietnam,
Philippines, Sri Lanka, Thailand) do not use catalog names. This map lets the classifier,
the retrieval query rewriter and the answer layer resolve their phrasing to the canonical
entity, attribute or domain in `03-catalog/`. It is also the source for the
`vernacular_names[]` field of the document checklist (view 12 in `07-counsellor-views.md`).

Columns: **phrase** (as typed or said, including common misspellings) · **language /
market** (`en` English, `ne` Nepali or Nepali-English, `hi` Hinglish, `bn` Bangla-English,
`vi` Vietnamese-English, `fil` Filipino-English, `si` Sinhala-English, `th` Thai-English;
market codes NP IN BD VN PH LK TH; `all` = heard in every market) · **meaning** ·
**canonical entity.attribute or domain** (domain letters A–X per the plan; `→` marks a
derived or view-level target) · **disambiguation notes**.

Attribute names follow the domain map in the plan and `07-counsellor-views.md`; they
are checked against `03-catalog/` by `scripts/catalog.ts check --refs`; every backticked `Letter.name` token resolves to a catalog row.

## 1. Money, proof of funds and fees

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| show money, "show-money", fund show, fund dekhaune | ne, hi, bn · NP IN BD | The bank balance a student must evidence for the visa | `E.financial_proof_formula` → view 3 total; `E.financial_proof_required` (seed) | Not tuition; not a deposit. "Show" implies evidence, so include `E.accepted_fund_types`, `E.funds_seasoning_days` |
| bank balance, balance kati dekhaune | ne, en · all | Same as show money, often asked as a single number | `E.financial_proof_formula` → view 3 | If asked "for university" (CAS/I-20 financial pre-check) → `K.enrolment_document_prerequisites` financial pre-check |
| seasoning, "28 days", 28-day rule, kati din rakhnu parchha (how many days to hold) | en, ne · all | How long funds must sit in the account | `E.funds_seasoning_days`, `E.funds_recency_days` | UK = 28 consecutive days ending ≤ 31 days before application; AU = no fixed rule; CA GIC replaces seasoning |
| sponsor, sponsor garne manchhe | en, ne · all | Person whose funds/income back the application | `E.accepted_sponsor_relationships[]`, `E.sponsor_max_count` | Not a UK "sponsor licence" (`B.student_visa_sponsor_licensed`) — see §5 and the disambiguation rules |
| guarantor | en · IN BD LK | Same as sponsor; in India also a loan co-applicant | `E.accepted_sponsor_relationships[]`; loan context → `L.loan_co_applicant_required` | Ask which: visa sponsor or loan co-applicant |
| income source, income kaha bata | en, ne · NP | Documented annual income of student/sponsor | `E.annual_income_alternative`, `E.annual_income_threshold_*`, `E.accepted_fund_types` | Nepal files often use CA-certified income statements — see next row |
| CA report, CA valuation, chartered accountant report | en · NP IN BD | Accountant-prepared income/asset valuation | `E.asset_types_accepted`, `E.annual_income_alternative`; acceptance per destination is `E.income_evidence_types` | Whether accepted varies by destination; AU treats it as supporting, not primary |
| tax clearance, kar chukta | en, ne · NP | Nepal tax clearance certificate as income proof | `E.income_evidence_types`; document type in `DocumentRequirement` | Nepal-specific document; ask whose (student vs sponsor) |
| education loan, edu loan, shikshya rin | en, ne, hi · NP IN BD | Bank loan for study | `L.loan_lender_type` (bank, max, rate, collateral, co-applicant, margin, moratorium, disbursement, sanction turnaround, accepted_as_evidence_by) | Also check `E.loan_acceptance_rules` (visa side) |
| loan sanction letter, sanction letter | en · NP IN BD | Bank's approval letter used as funds evidence | `E.loan_acceptance_rules`, `L.loan_sanction_turnaround_days`; document type in `DocumentRequirement` | Sanction ≠ disbursement; some destinations need disbursement into the account |
| lakh, lac, lakhs | ne, hi, bn · NP IN BD | 100,000 units of NPR/INR/BDT | → currency formatting rule; `W.fx_rate_indicative`, `V.fx_as_of` | "50 lakh" is 5,000,000; currency is the student's origin currency unless stated |
| crore, karod | ne, hi, bn · NP IN BD | 10,000,000 units | → currency formatting rule | 1 crore = 100 lakh |
| GIC | en · CA-bound, all | Guaranteed Investment Certificate (Canada funds instrument) | `E.gic_amount` (seed `gic_amount`), `L.finance_provider_name` | Only Canada. Not a scholarship or a bank guarantee |
| blocked account, Sperrkonto | en · DE-bound | Germany's escrow-style funds account | `E.blocked_account_amount`, `L.finance_provider_name` | Only Germany (and Austria); often confused with GIC |
| deposit, first instalment, first installment, tuition advance, advance | en, ne, hi · all | First tuition payment to accept an offer | `B.deposit_policy`, `B.deposit_policy`, `B.deposit_policy`, `B.deposit_policy` | Deposit ≠ full first-semester fee ≠ application fee ≠ visa "fee". See disambiguation §D |
| application fee, form fee | en, ne · all | Fee paid to apply to the institution | `B.application_fee_policy`, `B.application_fee_policy`, `K.application_channel_fee` | Often waived for agent applications — say so from `B.application_fee_policy` |
| tuition, fee, college fee, kharcha (expense) | en, ne · all | Course fee; "kharcha" may mean total cost | `L.tuition_by_offering` (today `ProgramRecord.tuition`); "kharcha"/"total kati" → view 2 | Clarify per year vs total; `money.period` |
| refund, paisa firta | en, ne · all | Money back on visa refusal or withdrawal | `B.refund_schedule`, `L.visa_refusal_refund_pct`, `B.refund_schedule`, `L.refund_admin_fee` | Ask trigger: visa refusal vs withdrawal vs deferral |
| payment plan, instalment plan, kista | en, ne, hi · all | Paying tuition in parts | `B.payment_plan_available` (seed), `L.first_payment_rule` | Distinct from the deposit |
| NRB approval, Rastra Bank permission, foreign exchange approval | en, ne · NP | Nepal Rastra Bank permission to remit tuition abroad | `L.origin_fx_remittance_limit` (NP), `L.origin_fx_remittance_limit` | Requires the MoE NOC (see §3) |
| LRS, TCS, 20 % TCS | en · IN | India's Liberalised Remittance Scheme and tax collected at source | `L.origin_fx_remittance_limit` (IN) | Tax-at-source is refundable on ITR, not a fee |
| student file, file open garna | bn, en · BD | Bangladesh Bank "student file" at an AD bank to remit fees | `L.origin_fx_remittance_limit` (BD) | BD-specific |
| living cost, cost of living, basne khane kharcha | en, ne · all | Living expenses per year | `D.official_living_cost_for_visa` (visa figure) vs `D.*` breakdown (city estimate) | View 2 shows both; ask which the counsellor needs |
| OSHC, health insurance, insurance | en · AU-bound | Overseas Student Health Cover (Australia) | `E.insurance_scheme`, `E.insurance_mandatory`, `L.insurance_premium_single` | OSHC = AU; IHS = UK; SEVIS-linked plans = US; provincial/private = CA. See §5 |
| IHS, immigration health surcharge | en · UK-bound | UK per-year health surcharge paid with the visa | `E.student_visa_fee` (IHS), `E.insurance_scheme` (GB) | A fee, not an insurance policy |
| SEVIS fee, I-901 | en · US-bound | US student-tracking fee before the F-1 interview | `E.student_visa_fee` (SEVIS) | Separate from the visa (MRV) fee |
| VFS fee, VAC, biometric fee | en · all | Visa application centre / biometrics charge | `E.biometrics_fee`, `E.biometrics_required`, `E.vac_locations_by_origin` | Nationality-variant; may be `not_required` |
| medical fee, IOM fee | en · NP BD | Panel-clinic health exam fee | `E.health_exam_fee`, `E.panel_clinics_by_origin` | See §5 "IOM/medical" |
| scholarship, waiver, bursary, discount, chhatrabritti | en, ne, hi · all | Any reduction in fees or grant | `H.*` (Scholarship entity); type via `H.scholarship_coverage_type`, `H.scholarship_provider_type` | Scholarship vs bursary vs waiver — see disambiguation §E |
| early bird, early payment discount | en · all | Discount for paying by a date | `H.scholarship_early_bird_deadline`, `H.sibling_discount_pct` | |
| stipend | en · all | Living allowance, usually PhD | `H.phd_scholarship_stipend_annual`, `Q.funding_stipend` | Not a scholarship covering tuition |
| ROI, worth it, paisa uthcha? (will the money come back) | en, ne · all | Return on investment | `L.cost_of_attendance_formula_inputs`, `G.salary_*`, `F.psw_length_by_level`, seed `estimated_roi_years` → view 2 + career figures | Judgement view; figures only from G/L |

## 2. Academic history, grades and gaps

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| gap, study gap, gap year(s), "I have 2 years gap" | en, ne, hi · all | Time between last study and intended start | `A.study_gap_max_years`, `E.genuine_intent_gap_scrutiny`, `U.gap_year_common_reasons` | Admission gap rule vs visa-side explanation are different rows (view 1) |
| back paper, back, backlog, backlogs, "I have 3 backs" | ne, hi, en · NP IN | Failed subject(s) later cleared | `A.backlog_acceptance_max`, `A.backlog_counting_method`, `U.backlog_terminology` | Count attempts vs subjects — method matters |
| supplementary, supply, supple exam | en, hi · IN NP | Re-sit exam for a failed subject | `A.backlog_acceptance_max`, `U.backlog_terminology` | A cleared supplementary still counts as a backlog at many institutions |
| re-appear, reappear, chance exam | en, hi · IN NP | Re-sitting a failed paper | `U.backlog_terminology` → `A.backlog_acceptance_max` | Same as supplementary |
| compartment, compartmental | en, hi · IN (CBSE) | CBSE term for a re-sit in one/two subjects | `U.backlog_terminology` (IN CBSE) | Class 12 level, not university |
| ATKT | en, hi · IN (state universities) | "Allowed to keep terms" — promoted with pending papers | `U.backlog_terminology` (IN) | Equivalent to backlog |
| improvement exam | en, bn, hi · BD IN | Re-sit to raise a passed grade | `U.backlog_terminology`; usually not a backlog | Ask whether the original was a pass |
| percentage, "%", 65 percent | en · all | Grade as percent | `U.grading_scale_type`, `U.conversion_table_url` → `A.min_gpa_normalized` with `A.min_gpa_scale=Percentage` | Name the board/university; TU % ≠ CBSE % |
| division, first division, second division, third division, distinction | en, ne, hi, bn · NP IN BD | Band of an aggregate percentage (NP old SLC/TU: 1st ≥ 60 %, 2nd ≥ 45 %, 3rd ≥ 32 %) | `U.division_labels`, `U.conversion_table_url` | Division cut-offs differ by board and era; "first class" in UK sense is different |
| first class, second class upper/lower, 2:1, 2:2 | en · all | UK-style degree classification | `U.conversion_table_url` (→ UK class), `A.min_gpa_scale=First-Second Class` | In IN/LK "first class" often means ≥ 60 %; confirm the scale |
| GPA, CGPA, "3.2 GPA", "CGPA 7.5" | en · all | Grade point average on a scale | `U.grading_scale_type`, `A.min_gpa_normalized`, `A.min_gpa_scale` | NEB GPA is /4.0; Indian CGPA /10; BD HSC /5.0, BD university /4.0; PH GWA is inverted (1.0 best) |
| GWA | fil, en · PH | General Weighted Average (1.0 = best) | `U.grading_scale_type` (PH), `U.conversion_table_url` | Inverted scale — never treat as GPA-4 |
| WAM | en · AU | Weighted Average Mark | `O.grading_system`, `A.min_gpa_scale` | Destination-side scale used in AU entry rules |
| +2, plus two, "+2 science", intermediate, I.Sc., I.Com, PCL | ne, en · NP | Nepal grade 11–12 (NEB), formerly HSEB; PCL = proficiency certificate level (older, also CTEVT) | `U.year12_equivalent_name` (NP), `U.qualification_equivalence` | PCL Nursing is a CTEVT diploma, not +2 — see §14 |
| SEE, SLC, "SLC pass" | ne · NP | Nepal grade-10 exam (SEE since 2017, SLC before) | `U.grade10_required_norm`, `U.qualification_equivalence` | Needed for some UK/AU school-leaving checks |
| HSC, "HSC 2022", Alim, Dakhil, SSC | bn, en · BD IN(Maharashtra) | Bangladesh grade 12 (HSC) / grade 10 (SSC); madrasa equivalents Alim/Dakhil | `U.year12_equivalent_name` (BD), `U.qualification_equivalence` | Indian Maharashtra also calls grade 12 "HSC"; disambiguate by origin |
| 12th, class 12, CBSE, ISC, state board, intermediate (IN) | en, hi · IN | Indian grade 12 | `U.year12_equivalent_name` (IN), `U.grading_scale_type` (board) | "Intermediate" in IN = grade 12; in NP = +2 |
| A/L, O/L, "AL results" | si, en · LK | Sri Lanka Advanced/Ordinary Level | `U.year12_equivalent_name` (LK) | Grades A/B/C/S/W, not percent |
| tốt nghiệp THPT, grade 12 exam, "10-point" | vi, en · VN | Vietnam high-school graduation exam, 10-point scale | `U.year12_equivalent_name` (VN), `U.grading_scale_type` (VN) | |
| SHS, K-12, senior high | fil, en · PH | Philippine senior high school (grades 11–12) | `U.year12_equivalent_name` (PH) | Pre-2018 PH students have 10-year schooling — check `U.qualification_equivalence` |
| bachelor 3 years, 3-year bachelor, "TU three year", B.A. pass course | en, ne, bn · NP IN BD | Three-year first degree | `A.three_year_bachelor_accepted`, `U.bachelor_years_standard`, `U.three_year_degree_accepted_by` | BD "pass course" is a 3-year non-honours degree with lower standing |
| honours, "BSc Hons" (BD/IN) | en, bn · BD IN | 4-year (BD) or 3-year (IN) first degree with honours | `U.qualification_equivalence`, `A.course_level_coarse` | In AU/NZ "honours" is a separate 4th year — different entity value |
| BBS, BBA, BSc CSIT, BIT, BCA, BE, B.Tech | en · NP IN | Common local bachelor titles | `U.qualification_equivalence` → `A.accepted_qualifications_by_country`, `A.cognate_or_conversion` | BBS (TU) is 4 years since 2015, 3 before |
| distance degree, correspondence, open university, IGNOU, private candidate | en, hi · IN NP BD | Degree by distance study | `U.distance_degree_acceptance`, `A.accepted_qualifications_by_country` | Often not accepted for masters entry or skills assessment |
| masters by coursework, taught masters, MSc, MA, M.Tech | en · all | Taught postgraduate degree | `A.level=masters_coursework` | vs `masters_research` (thesis) and `masters_extended` |
| masters by research, MPhil, MRes, thesis masters | en · all | Research postgraduate degree | `A.level=masters_research`, `Q.*` | Different PSW/points treatment (`F.specified_stem_qualification_points`) |
| PGD, PG Diploma, postgraduate diploma, grad dip, grad cert | en · all | Sub-masters postgraduate awards | `A.level=pg_dip / grad_dip / grad_cert` | CA "PG diploma" at colleges is a PGWP-relevant level; UK PGDip is FHEQ 7 |
| PhD, doctorate, doctoral, DPhil | en · all | Research doctorate | `A.level=phd`, `Q.*` | |
| diploma (AU VET), advanced diploma, cert III/IV, TAFE course | en · AU-bound | Vocational awards AQF 4–6 | `A.level=cert_iii_iv / diploma / adv_diploma` | "Diploma" in CA colleges is a post-secondary program, not VET-equivalent; see disambiguation §B |
| top-up, top up degree, final-year entry | en · UK-bound, MY | Final year of a bachelor for diploma holders | `A.level=top_up`, `J.pathway_type=top_up` | |
| foundation, foundation year, pre-university | en · all | Pre-bachelor year | `A.level=foundation`, `J.pathway_type=foundation` | |
| pre-masters, pre-master's, graduate diploma bridge | en · UK/AU-bound | Pre-masters pathway | `J.pathway_type=pre_masters` | |
| medium of instruction, MOI, "MOI letter" | en · all | Letter that prior study was in English | `A.moi_waiver_accepted`, `I.moi_waiver_levels_accepted`, `U.moi_letter_issuer` | Admission-side waiver only; almost never a visa-English exemption (`E.visa_english_exemptions`) |
| age bar, age limit, "I am 30, too old?" | en, ne · all | Maximum age concerns | `A.min_age`/`A.max_age`, `E.age_limits`, `F.psw_age_max` (485 ≤ 35), `F.age_points_decline_curve` | Admission has no upper age; visa genuineness and points do |
| work experience, "experience letter" | en · all | Employment history and its evidence | `A.work_experience_years_required`, `A.work_experience_type_required`; document type `experience_letter` | MBA/masters requirement vs skills assessment experience (`G.skills_assessment_requirements`) |

## 3. Nepali (and South Asian) document names

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| character certificate, charitra pramanpatra | en, ne · NP IN BD | School/college conduct certificate | `DocumentRequirement.doc_type=character_certificate`; `K.doc_required` | Rarely required abroad; often `not_required` — say so |
| migration certificate | en · NP IN BD | Board/university certificate releasing the student to another institution | `DocumentRequirement.doc_type=migration_certificate` | Needed for NP MoE NOC in some cases; rarely by destinations |
| provisional certificate, provisional | en · NP IN BD | Interim degree certificate before the final one | `B.provisional_certificate_accepted`, `DocumentRequirement.doc_type=provisional_certificate` | Ask whether final degree certificate is issued yet |
| mark sheet, marksheet, markesheet, grade sheet | en, hi · NP IN BD | Per-exam result sheet | `DocumentRequirement.doc_type=transcript` (semester-wise) | NEB issues "grade sheet"; TU issues per-year "mark sheet"; the destination word is transcript |
| transcript, "official transcript", consolidated marksheet | en · all | Full academic record issued by the awarding body | `DocumentRequirement.doc_type=transcript`, `U.transcript_issuer`, `U.verification_service` | TU "transcript" is a separate document from the yearly mark sheets — both may be needed |
| ward recommendation, ward sifaris, sifaris letter | ne, en · NP | Ward office letter (address, relationship, income, occupation) | `DocumentRequirement.doc_type=ward_recommendation`; `E.document_variants_by_nationality` (NP) | Ask what it certifies: relationship, income, or residence |
| relationship certificate, nata pramanit, nata praman patra | ne, en · NP | Ward-issued proof of family relationship (for sponsors) | `DocumentRequirement.doc_type=relationship_certificate`; `E.accepted_sponsor_relationships[]` | Distinct from marriage certificate (spouse evidence, `P.relationship_evidence`) |
| citizenship certificate, nagarikta | ne, en · NP | Nepal citizenship card (identity + parentage) | `DocumentRequirement.doc_type=citizenship_certificate` | Used as identity/relationship evidence; English translation norms in `U.translation_norm` |
| birth certificate, janma darta | ne, en · all | Birth registration | `DocumentRequirement.doc_type=birth_certificate` | Needed for children dependants (`P.*`) and some US/CA files |
| police report, police clearance, PCC, character clearance (police) | en · all | Police clearance certificate | `E.police_clearance_required`, `DocumentRequirement.doc_type=police_clearance` | May be `not_required` unless requested |
| notary, notarised, attestation, MoE attestation, MoFA attestation, apostille | en, ne · all | Certification of copies/translations | `E.translation_attestation_rules`, `U.apostille_available`, `U.translation_norm` | Nepal joined the Apostille Convention in 2024 — check `U.apostille_available` `valid_from` |
| affidavit, name mismatch affidavit, "name spelling different" | en · NP IN BD | Sworn statement reconciling name/date discrepancies | `B.name_mismatch_affidavit_accepted`, `DocumentRequirement.doc_type=affidavit` | |
| experience letter, work certificate | en · all | Employer letter of employment | `DocumentRequirement.doc_type=experience_letter` | Format rules (letterhead, duties, hours) from `G.skills_assessment_requirements` when for skills assessment |
| recommendation letter, LOR, reference | en · all | Letter of recommendation | `K.lor_count`, `K.lor_type`, `K.lor_submission_method` | Academic vs professional |
| passport (first & last page), "MRP" | en, bn · all | Passport bio page; BD "MRP" = machine-readable passport | `E.passport_validity_rule`, `DocumentRequirement.doc_type=passport` | |
| CV, resume, bio-data, biodata | en, hi · all | Résumé | `DocumentRequirement.doc_type=cv` | "Biodata" in IN/NP may also mean a marriage profile — context |

## 4. Offer, enrolment and application documents

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| offer letter, offer, "offer aayo" | en, ne · all | Institution's admission offer | `B.offer_types_available` (conditional/unconditional/packaged), `B.offer_turnaround_days_*`, `B.offer_validity_days` | Ask conditional vs unconditional |
| conditional offer, "condition ma offer" | en, ne · all | Offer subject to conditions (English, final results, deposit) | `B.offer_types=conditional`, seed `conditional_offer_available` | Conditions map to view 1 rows |
| unconditional offer, full offer, firm offer | en · all | Offer with all conditions met | `B.offer_types=unconditional` | Needed before CoE/CAS/I-20 |
| packaged offer, package offer | en · AU-bound | Offer covering ELICOS/diploma + degree in one | `J.single_visa_packaging`, `J.pathway_type`, seed `packaged_english_pathway_available` | See §8 "pathway/packaged" |
| COE, CoE, "CoE aayo" | en, ne · AU-bound | Confirmation of Enrolment (Australia) | `K.enrolment_document_type=CoE`, `K.enrolment_document_issuance_lead_days`, `K.enrolment_document_prerequisites[]` | AU only. Do not confuse with "certificate of eligibility" (US H-1B) |
| CAS, CAS letter, CAS statement | en · UK-bound | Confirmation of Acceptance for Studies (UK) | `K.enrolment_document_type=CAS`, `K.enrolment_document_prerequisites[]` (financial pre-check, credibility interview) | UK only; needs `E.maintenance_funds_by_location` and 28-day rule |
| I-20, "I twenty" | en · US-bound | US Form I-20 from a SEVP school | `K.enrolment_document_type=I-20`; cost-of-attendance figure on it → view 3 (US) | Precedes SEVIS fee and F-1 interview |
| LOA, letter of acceptance, PAL letter | en · CA-bound | Canada Letter of Acceptance (must carry PAL/TAL where applicable) | `K.enrolment_document_type=LOA`, `E.sds_pal_variant`, `B.cap_allocation` | "LOA" in AU can mean leave of absence (`O.leave_of_absence_policy`) — context |
| Zulassung, admission letter (DE), uni-assist VPD | en, de · DE-bound | German admission letter; VPD = uni-assist preliminary review document | `K.enrolment_document_type=Zulassung`, `K.credential_evaluation_*` (uni-assist VPD) | |
| EMGS approval, VAL, eVAL | en · MY-bound | Malaysia Education Malaysia Global Services visa approval letter | `K.enrolment_document_type=EMGS`, `E.visa_lodgement_channel` (MY) | |
| GTE, GTE statement | en · AU-bound (legacy) | Genuine Temporary Entrant statement (pre-2024 AU) | `E.genuine_intent_test=GS` (current) — map GTE → GS and say the name changed | See disambiguation §F (SOP vs GS/GTE) |
| GS, GS statement, genuine student, "GS questions" | en · AU-bound | Genuine Student requirement (AU, since 2024-03) | `E.genuine_intent_test=GS`, `E.genuine_intent_word_limits`, `E.genuine_intent_factors[]` | Visa document, not an admission document; some providers run a GS pre-check (`K.enrolment_document_prerequisites`) |
| SOP, statement of purpose, personal statement, motivation letter, LOE (letter of explanation) | en · all | Applicant's written statement | Admission: `K.sop_prompts`; Visa: CA "study plan/LOE", US interview narrative, AU GS answers → `E.genuine_intent_test` | Ask: for university or for visa? See §F |
| study plan, SOP for Canada | en · CA-bound | Study permit statement | `E.genuine_intent_test` (CA), `E.genuine_intent_word_limits` | |
| credibility interview, pre-CAS interview | en · UK-bound | University/UKVI interview before CAS | `K.interview_format`, `E.genuine_intent_test` (GB credibility) | |
| F-1 interview, visa interview, embassy interview | en · US-bound | Consular interview | `E.genuine_intent_test` (US), `E.interview_location_format` | Nepal applicants interview in Kathmandu |
| acceptance, accept offer, "acceptance form" | en · all | Signing the offer and paying the deposit | `K.acceptance_steps`, `B.deposit_policy` | |
| ATAS | en · UK-bound | Academic Technology Approval Scheme certificate | `K.atas_required` | Subject/nationality-specific |
| WES, ECA, credential evaluation, ECCTIS/NARIC, anabin | en · CA/US/UK/DE-bound | Third-party credential evaluation | `K.credential_evaluation_*` (fee, weeks), `U.qualification_framework_ref` | Admission ECA vs immigration ECA (Express Entry) differ |
| UCAS, OUAC, uni-assist, Hochschulstart, Studielink | en · GB/CA/DE/NL-bound | Centralised application channels | `K.application_channel`, `K.application_channel_fee`, `K.application_channel_max_choices` | |
| agent portal, "apply through Expert", partner application | en · all | Applying via the agency | `K.channel=agent`, `B.agent_portal_url`, `B.partner_status`, `X.services_and_fees` | Commercial terms out of scope |
| defer, deferral, "next intake ma sarne" | en, ne · all | Moving the offer/CoE to a later intake | `B.deferral_policy` (max, fee), `B.deferral_policy`, `T.term_start_date` | Visa-side implications in `E.change_provider_rules` if already granted |
| withdraw, withdrawal | en · all | Cancelling enrolment | `B.refund_schedule`, `B.refund_schedule` | |
| intake, session, batch, "Feb intake", "September session" | en, hi, bn · all | Term of entry | `IntakeCalendar` (`T.*`), `T.term_start_date`, `T.intake_status` | BD/IN "session" = academic year or intake; NP "batch" = cohort |
| deadline, last date, closing date | en, ne · all | Application closing date | `T.application_close_date_international`, `T.deposit_deadline`, `T.scholarship_application_deadline`, `T.enrolment_confirmation_latest_issue_date` | Ask which deadline — view 5 lists all |
| rolling, "no deadline" | en · all | Applications accepted continuously | `K.deadline_type=rolling` | |

## 5. Visa, immigration and health

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| visa file, file lodge, lodge garne, "file submit" | ne, en · NP | Lodging the visa application | `E.visa_lodgement_channel`, `E.processing_time_*`, view 5 lodgement step | |
| 500 visa, subclass 500, student visa (AU) | en · AU-bound | Australian student visa | `VisaType` (AU 500), seed `student_visa_type` | "590" = guardian; "485" = graduate; "482/SID" = sponsored work |
| study permit (CA), "Canada visa" | en · CA-bound | Canadian study permit (plus TRV) | `VisaType` (CA study permit) | Permit ≠ entry visa (TRV) |
| Tier 4, "Tier 4 visa" | en · UK-bound (legacy) | Old name for the UK Student visa | `VisaType` (GB Student) — map Tier 4 → Student | |
| F-1, F1, "F-1 status" | en · US-bound | US academic student visa/status | `VisaType` (US F-1); F-2 dependants; J-1/M-1 distinct | |
| IOM, "IOM medical", medical, health check, x-ray | en, ne · NP BD | Panel-clinic health examination (IOM is a panel clinic in KTM/DAC) | `E.health_exam_required`, `E.panel_clinics_by_origin`, `E.health_exam_fee`, `E.tb_test_countries` | IOM = a clinic, not the test itself; UK TB test is a separate requirement for NP/IN/BD |
| TB test, TB certificate | en · UK-bound | UK pre-entry tuberculosis test for listed countries | `E.tb_test_countries`, `E.panel_clinics_by_origin` | Nationality/residence-variant |
| police clearance — see §3 | | | | |
| biometrics, "finger", fingerprint | en, ne · all | Biometric enrolment at VAC | `E.biometrics_required`, `E.biometrics_fee`, `E.vac_locations_by_origin` | Nationality-variant; may be `not_required` |
| NOC (Nepal), "NOC from Ministry", "Ministry ko letter", No Objection letter | ne, en · NP | Nepal Ministry of Education No Objection Certificate to study abroad (needed for NRB remittance) | `U.moe_noc_rules`, `B.nepal_moe_noc_eligible` | **Not** the Canada NOC occupation code — see disambiguation §A |
| NOC (Canada), NOC code, "NOC 21231", TEER | en · CA-bound | Canada National Occupational Classification code / TEER level | `G.occupation_code` (NOC 2021), seed `noc_codes`, `G.occupation_list_membership` | See §A |
| visa refusal, rejection, "visa reject bhayo", refused | en, ne · all | Negative visa decision | `E.common_refusal_grounds[]`, `E.grant_rate_by_nationality`, `E.reapply_rules`, `E.appeal_body`, flag `prior_visa_refusal` → view 8 | Refusal ≠ ban; see PIC 4020 |
| PIC 4020, 4020, "fraud ban", 3-year ban, 10-year ban (UK), 5-year (CA misrep) | en · all | Misrepresentation/fraud exclusion rules | `E.fraud_bars` | Only false documents/information trigger these, not an ordinary refusal |
| appeal, AAT/ART, review | en · AU-bound | Merits review of a refusal | `E.appeal_body`, `E.appeal_fee` | Onshore refusals only in AU |
| genuine student — see §4 GS | | | | |
| evidence level, risk level, "Level 1/2/3 college", "low risk uni" | en · AU-bound | AU provider evidence level (streamlined vs full evidence) | `E.evidence_level_by_provider`, `B.visa_risk_rating` | AU only; CA analogue = DLI approval rate, UK = BCA/sponsor status — see `B.visa_risk_rating` |
| cap, PAL, TAL, "Canada closed", "cap lagyo" | en, ne · CA/AU-bound | Enrolment caps: CA provincial/territorial attestation letters and quota; AU National Planning Level | `W.caps_policy`, `B.cap_allocation`, `E.sds_pal_variant`, `W.policy_change_log` | "Canada closed" is a question about caps and processing, not a fact — answer from W/E rows |
| SDS, non-SDS, "SDS band", regular stream | en · CA-bound | Canada Student Direct Stream (ended 2024-11) vs regular | `E.sds_pal_variant` — map SDS → legacy, state end date | Legacy term; still used by students |
| processing time, "kati din lagcha", "visa kahile aaucha" | ne, en · all | Time to decision | `E.processing_time_official_range`, `E.processing_time_observed_origin` (internal) | Quote official; observed is `quotable=internal` |
| visa fee, "visa ko paisa" | en, ne · all | Government visa application charge | `E.student_visa_fee`, `E.dependant_visa_fee` | Not the VFS/biometrics fee, not OSHC |
| conditions, 8105, 8202, 8501, 8533, "visa condition" | en · AU-bound | Visa condition codes | `VisaCondition` (`E.visa_conditions[]` with plain-English meaning) | 8105 work hours; 8202 enrolment/attendance; 8501 health cover; 8533 address notification |
| onshore, offshore, "onshore student", "already there" | en · all | Inside vs outside the destination when applying | `applicant_type` axis (`onshore/offshore`), `E.apply_onshore_allowed`, `E.onshore_switching_rules`, flag `already_abroad` | Changes lodgement, travel component, document list |
| visitor to student, tourist visa switch, "600 to 500" | en · AU-bound | Switching onshore from visitor to student | `E.onshore_switching_rules` | Many destinations bar this (UK, CA) |
| change college, transfer, release letter, "release chahincha" | en, ne · AU-bound | Moving provider within the first 6 months (AU) | `E.change_provider_rules`, `O.release_letter_policy`, `O.release_letter_fee` | Also see §10 |
| downgrade, "diploma ma jane", change level | en, ne · AU-bound | Moving to a lower AQF level | `E.change_provider_rules` (downgrade requires new visa) | |
| guardian visa, 590, parent visa (UK child) | en · AU/UK-bound | Visa for a guardian of an under-18 student | `VisaType` (AU 590; UK Parent of a Child Student), `R.guardian_visa`, `E.under18_guardian_requirements` | |
| under 18, minor, CAAW, welfare letter | en · AU-bound | Under-age student welfare arrangements | `R.welfare_arrangements` (CAAW), `E.under18_guardian_requirements`, `R.under18_min_age_for_visa` | |
| dependent, dependant, "dependent visa", "with family" | en · all | Family member on the student's visa | `E.dependents_allowed`, `E.dependents_allowed`, seed `dependents_allowed`, `E.dependant_visa_fee` | Spelling irrelevant; see disambiguation §C |
| spouse visa, partner visa, "wife lai lane" | en, ne · all | Partner as dependant of a student | `P.partner_work_rights`, `P.partner_study_rights`, `P.relationship_evidence`, `P.subsequent_entrant_process` | Not a partner (family) migration visa |
| subsequent entrant, "later call garne", join later | en, ne · AU-bound | Dependant applying after the main grant | `P.subsequent_entrant_process`, `P.subsequent_entrant_fee` | |
| de facto, live-in, "not married" | en · all | Unmarried partner | `P.relationship_evidence` (de facto duration, registration) | |
| marriage certificate, bibaha darta | en, ne · all | Marriage registration | `P.relationship_evidence`, `DocumentRequirement.doc_type=marriage_certificate` | Recent marriage scrutiny noted in `P.relationship_evidence` |
| school fees for child, "bachcha ko school" | en, ne · all | Public school cost for dependants | `P.public_school_fee_by_region`, `P.school_fee_exemptions` | Region-variant (state/province) |
| travel history, "no travel history" | en · all | Prior international travel | `E.genuine_intent_factors[]` | Judgement factor; no stored score |
| visa grant, "visa aayo", grant letter | ne, en · all | Approval | `E.visa_grant_length_rule`, `E.apply_arrive_window_rule` | |
| entry date, "kahile jane", initial entry, arrive by | en, ne · all | Latest/earliest arrival | `E.apply_arrive_window_rule`, `T.latest_arrival_date` | |

## 6. English and admission tests

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| IELTS, "ILETS", "IELTS Academic", "GT" | en · all | IELTS Academic / General Training | `Test` (IELTS_A / IELTS_GT), `I.test_code` | GT is not accepted for most admissions; UKVI variant is distinct |
| IELTS UKVI, "UKVI IELTS", SELT | en · UK-bound | Secure English Language Test versions | `Test` (IELTS_UKVI, PTE_UKVI, LanguageCert SELT), `I.visa_accepted_english_tests` (GB) | Required for below-degree UK courses; degree-level accepts university's own assessment |
| PTE, "PTE Academic", "PTE 58", PTE Core | en · all | Pearson Test of English | `Test` (PTE_A, PTE_CORE, PTE_UKVI) | PTE Core is for Canada immigration, not admission |
| TOEFL, "TOFEL", "TOEFL iBT", Home Edition | en · all | TOEFL iBT and variants | `Test` (TOEFL_IBT, TOEFL_HOME, TOEFL_ESSENTIALS), `I.english_test_accepted.home_edition` | Home Edition often not accepted for visa |
| Duolingo, DET, "Duolingo 110" | en · all | Duolingo English Test | `Test` (DET), `I.english_test_accepted`, `I.visa_accepted_english_tests` | Rarely accepted for visas (AU no; UK no) |
| OET | en · all (health) | Occupational English Test | `Test` (OET), `I.english_discipline_uplift`, `S.english_standard` | Health professions only |
| Cambridge, CAE, C1 Advanced, FCE | en · all | Cambridge English qualifications | `Test` (CAM_B2, CAM_C1, CAM_C2) | |
| LanguageCert, ELLT, OIETC, Password, KITE | en · UK-bound | Alternative UK-accepted English tests | `Test` codes per `I.test_code`, `I.english_test_accepted` | Often accepted by universities but not by UKVI for below-degree |
| NAATI, CCL, "NAATI Nepali" | en · AU-bound | NAATI Credentialed Community Language test (5 PR points) | `Test` (NAATI_CCL), `I.naati_ccl_languages_available`, `I.naati_ccl_points_reference` | Not an English test |
| GRE, GMAT, "GMAT Focus" | en · all | Graduate admission tests | `Test` (GRE, GMAT), `A.standardized_test_mandatory`, `I.aptitude_test_min_score`, `A.sat_act_middle_50` | |
| SAT, ACT | en · US-bound | Undergraduate admission tests | `Test` (SAT, ACT), `A.standardized_test_mandatory` | Test-optional policies in `I.aptitude_test_min_score`-style row for UG |
| UCAT, GAMSAT, BMAT, MCAT | en · AU/UK/US-bound | Medicine admission tests | `Test` codes, `S.quotas_admission_tests` | |
| TestDaF, DSH, Goethe, telc, "German B2" | en, de · DE-bound | German language certificates | `Test` codes, `I.local_language_test_required` (DE), `W.local_language_requirement` | |
| TEF, TCF, "French for Quebec" | en · CA-bound | French tests | `Test` codes, `I.local_language_test_required` (CA-QC), seed `french_proficiency_bonus_relevant` | |
| band, "6.5 band", "band score" | en, ne, hi · all | IELTS score unit | `I.english_overall_min` (overall, sections) | "Band" is also used loosely for PTE/TOEFL — normalise via `I.english_equivalence_table` |
| overall, "overall 6.5 but writing 5.5" | en · all | Aggregate score vs section scores | `I.english_overall_min.overall` vs `.sections{}` | View 13 shows both |
| each band, "no band less than", "each 6" | en · all | Minimum per section | `I.per_course_test_minimums.sections{}` | |
| one skill retake, OSR, "retake writing only" | en · all | IELTS One Skill Retake | `I.test_one_skill_retake_available`, `I.test_one_skill_retake_available`, `I.visa_accepted_english_tests` (OSR) | Accepted for admission by many; AU visa does not accept |
| TRF, "TRF number", score report | en · all | IELTS Test Report Form | `I.test_score_report_method` | Universities verify via TRF number |
| validity, "IELTS expired", "2 years" | en · all | Score validity | `I.test_validity_months`, `I.english_validity_measured_to`, `I.visa_english_validity_months` | Measured differently for admission vs visa |
| waiver, English waiver, "IELTS chhaina" (no IELTS) | en, ne · all | Studying without a test | `I.english_test_waiver_available`, `I.moi_waiver_levels_accepted`, `I.school_english_marks_waiver`, `I.english_medium_prior_study_waiver`, `E.visa_english_exemptions` | Admission waiver ≠ visa exemption |
| ELICOS, English course, "English class before uni", EAP | en · AU-bound | English Language Intensive Courses for Overseas Students | `I.pathway_weeks_per_half_band`, `I.pathway_fee_per_week`, `I.pathway_exit_assessment`, `J.pathway_type=elicos_package` | See §8 |
| pre-sessional | en · UK-bound | UK university English course before the degree | `I.pathway_*` (GB), `J.pathway_type=elicos_package` | |
| mock test, "PTE class", coaching, "Expert ko class" | en, ne · all | Test preparation classes | `X.test_prep_classes[]` | Agency fact; branches and schedules |
| test date, "next PTE date", slot, booking | en · all | Upcoming sittings | `I.test_upcoming_dates` (live), `I.test_frequency`, `I.test_centre_cities` | Live data — carries `fetched_at` |
| result, "result kati din ma", score release | en, ne · all | Days to results | `I.test_result_days` | |

## 7. Levels and course words (destination-side)

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| college | en, ne, hi · all | Any institution (NP/IN usage) — or a CA public college, AU VET/private college, UK FE/pathway college, US community college | `Institution` (`B.institution_type`) | See disambiguation §B |
| university, uni, "real university" | en · all | Degree-awarding institution | `B.institution_type=university`, `A.awarding_body` | Pathway colleges award degrees via a university (`A.awarding_body`) |
| TAFE | en · AU-bound | Public vocational provider (AU) | `B.institution_type=tafe` | |
| polytechnic, poly | en · NZ/SG | NZ institutes of technology (Te Pūkenga) | `B.institution_type=polytechnic` | |
| community college | en · US-bound | US 2-year public college | `B.institution_type=community_college`, `J.pathway_type=community_college_transfer` | |
| Navitas college, INTO, Kaplan, Study Group, "pathway college", "Deakin College", "UTS College", "SIBT" | en · all | Private pathway providers attached to universities | `B.institution_type=pathway_college`, `A.awarding_body`, `J.pathway_provider`, seed `english_pathway_provider` | Degree is awarded by the partner university; PSW depends on the exit qualification |
| course, program, programme, subject (IN), "course" (= single unit in AU) | en · all | The qualification being studied — or, in AU, a single unit | `Course` (`A.*`) vs `A.credit_unit_name` | In AU "subject/unit" = one module; in IN "subject" may mean discipline |
| major, specialisation, stream | en · all | Focus area within a degree | `A.specialisations_available` | IN "stream" at +2 level = science/commerce/arts |
| duration, "kati barsa", "1 year masters", "2 year masters" | en, ne · all | Course length | `A.duration_options`, `duration.months`; 2-year masters affects `F.psw_length_by_level` and AU study requirement | |
| full time, part time (as a student) | en · all | Study load | `A.part_time_for_international`, `O.full_time_load` | Visa normally requires full-time |
| online, distance, blended, "online class" | en · all | Delivery mode | `CourseOffering.delivery`, `A.online_component_max_pct_for_visa`, `A.offshore_online_start_allowed` | Visa/PSW limits on online share |
| regional, regional area, regional campus, "regional ma padhne" | en, ne · AU/NZ/CA-bound | Campus in a designated regional area (AU Cat 2/3, NZ outside Auckland, CA rural) | `C.regional_category_au`, seed `regional_campus`, `location_classification`, `regional_study_nz`, `F.psw_regional_extension`, seed `regional_study_points` | See disambiguation §G — "regional" is a postcode category, not "rural feel" |
| campus, "main campus", "city campus", satellite | en · all | Physical site | `Campus`, `C.campus_type` | Offering (campus × delivery) is the fee/intake key |
| intake — see §4 | | | | |
| accredited, "recognised", "is this uni valid in Nepal", MoE listed | en, ne · all | Recognition of the institution/course | `A.accreditation_bodies[]`, `B.nepal_moe_noc_eligible`, `W.degree_recognition_source_country` (AIU, UGC-BD), `B.cricos_provider_registration` | Ask: recognised by whom (Nepal MoE, professional body, destination regulator) |
| CRICOS, "CRICOS code" | en · AU-bound | AU register of providers/courses for overseas students | `B.cricos_provider_registration`, `A.cricos_course_code` | |
| DLI, "DLI number" | en · CA-bound | Designated Learning Institution | `B.dli_registration`, `B.pgwp_eligible_dli` | DLI status ≠ PGWP eligibility (public vs private) |
| ranking, "QS rank", "top 100", "world rank" | en · all | Institutional/subject rankings | `B.ranking_band_summary` (with year), `B.qs_subject_ranks` | Always name the ranking and year |
| Go8, Group of Eight, "sandstone" | en · AU-bound | Australia's research-intensive group | `B.institution_group_memberships` | |
| Russell Group | en · UK-bound | UK research-intensive group | `B.institution_group_memberships` | |
| Ivy, Ivy League | en · US-bound | US elite group | `B.institution_group_memberships` | |
| U15 | en · CA-bound | Canada's research universities | `B.institution_group_memberships` | |
| TU9 | en · DE-bound | German technical universities group | `B.institution_group_memberships` | |

## 8. Pathways and packaging

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| pathway, pathway program, "pathway bata" | en, ne · all | Any bridging route into a degree | `PathwayArticulation` (`J.*`), `J.pathway_type` | Ask which: foundation, diploma→degree, ELICOS package, pre-masters |
| diploma to degree, "diploma gare pachhi degree", 2nd year entry | en, ne · all | Articulation with credit | `J.pathway_type=diploma_to_degree`, `J.credit_granted_units`, `J.entry_year_into_destination`, `J.guaranteed_progression`, `J.progression_gpa_min` | |
| packaged, package, "package visa", "package CoE" | en · AU-bound | Multiple courses under one visa/CoE bundle | `J.single_visa_packaging`, `E.genuine_intent_package_assessment_rule` | Visa is assessed on the highest course in the package |
| 2+2, twinning, "2 years Malaysia 2 years Australia", transfer program | en · MY-bound, all | Split-site degree | `J.pathway_type=twinning`, `J.twinning_partner_institution`, `J.transfer_to_partner_country_rules` | PSW/visa in the final country depends on time studied there |
| credit transfer, RPL, advanced standing, exemption | en · all | Credit for prior study | `A.rpl_max_credit_pct`, `J.credit_granted_units` | |
| conversion course, "non-IT background to IT" | en · all | Masters for non-cognate graduates | `A.cognate_or_conversion`, `A.cognate_or_conversion` | |
| guaranteed entry, guaranteed progression | en · all | Automatic progression on meeting GPA | `J.guaranteed_progression`, `J.progression_gpa_min` | |

## 9. Post-study work, PR and migration

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| PR, permanent residency, "PR milcha?", settle, "settle hune" | en, ne, hi · all | Permanent residence | `F.*` (points, routes, typical years), `F.pr_typical_years_by_route`, `F.migration_advice_disclaimer_required` | Always `quotable=disclaimer`; never "guaranteed" |
| 485, "485 visa", post-study visa, PSW, graduate visa | en · AU-bound | Temporary Graduate visa (AU) | `F.psw_length_by_level`, seed `post_study_work_visa_485_years`, `F.psw_age_max`, `F.psw_eligibility_for_course` | AU only |
| PGWP, "post-grad work permit", "PGWP eligible college" | en · CA-bound | Post-Graduation Work Permit (CA) | seed `pgwp_length_months`, `pgwp_field_of_study_eligible`, `F.psw_eligibility_for_course` | Field-of-study and institution-type rules since 2024 |
| Graduate Route, "PSW UK", "2-year stay back" | en · UK-bound | UK Graduate visa | seed `graduate_route_eligible`, `graduate_route_length_years` | "Stay back" is the South Asian phrase for any PSW |
| OPT, STEM OPT, CPT, "day-1 CPT" | en · US-bound | Optional/Curricular Practical Training | seed `opt_length_months`, `stem_opt_eligible`, `day1_cpt_available` | Day-1 CPT flagged as a risk in `B.notable_risks[]` |
| stay back, "stay back period", "kati barsa basna milcha" | en, ne, hi · all | Length of post-study work rights | `F.psw_length_by_level` per destination | Generic term — resolve to the destination's PSW visa |
| job seeker visa, 18-month visa (DE), Stamp 1G (IE) | en · DE/IE-bound | Post-study job-search permits | `F.job_seeker_visa_name` | |
| points, "65 points", "kati points cha", point test | en, ne, hi · AU/NZ/CA-bound | Skilled migration points | `F.points_age_table`, `F.points_english_table`, `F.points_qualification_table`, `F.points_skilled_employment_table`, `F.points_partner_table`, `F.points_table_effective_date` → view 6 | AU 189/190/491 points vs CA CRS vs NZ SMC — different tables |
| CRS, "CRS score", Express Entry, EE draw, ITA | en · CA-bound | Comprehensive Ranking System and Express Entry | `F.crs_factor_table`, `F.ee_category_draw_list`, `F.ee_draw_recent_cutoffs`, seed `express_entry_crs_category` | |
| EOI, SkillSelect, invitation, "invite aayo" | en, ne · AU-bound | Expression of Interest and invitation rounds | `F.ee_draw_recent_cutoffs`, `F.state_nomination_occupation_list` | |
| state sponsorship, state nomination, 190, 491, "state bata sponsor" | en, ne · AU-bound | State/territory nominated visas | `F.state_nomination_occupation_list`, seed `state_nomination_demand`, `F.regional_491_conditions` | Not an employer sponsor |
| PNP, provincial nomination, "Ontario PNP" | en · CA-bound | Provincial Nominee Program | seed `pnp_in_demand_provinces`, `F.state_nomination_occupation_list` (CA) | |
| SOL, MLTSSL, STSOL, ROL, CSOL, "skill list", "occupation list", "is my course on the list" | en · AU-bound | Skilled occupation lists (AU) | seed `skilled_occupation_list_status`, `on_sol`, `G.occupation_list_membership` (valid_from/to), `CourseOccupation` | Lists are temporal; CSOL replaced several lists for 482/SID — check `valid_from` |
| NOC list, "in-demand list" (CA), Green List (NZ), Immigration Salary List / Shortage list (UK) | en · CA/NZ/UK-bound | Destination occupation demand lists | `G.occupation_list_membership`, seed `green_list_status`, `green_list_role`, `on_immigration_salary_list` | CA has no single "list" for study permits — clarify |
| ANZSCO, "ANZSCO code" | en · AU/NZ-bound | Occupation classification | `G.occupation_code`, seed `anzsco_occupation_codes` | |
| SOC code | en · UK/US-bound | UK SOC 2020 / US SOC | `G.occupation_code`, seed `skilled_worker_soc_code` | |
| skill assessment, skills assessment, "ACS bata assess", "VETASSESS" | en, ne · AU-bound | Skills assessment by the assessing authority | seed `skills_assessment_authority`, `G.skills_assessment_requirements`, `G.skills_assessment_fee`, `G.skills_assessment_processing_weeks` | Required for points visas, not for 485 (except the 485 skills-assessment stream where applicable) |
| ACS | en · AU-bound | Australian Computer Society (ICT assessing authority) | `G.skills_assessment_authority` (ICT), seed `skills_assessment_authority=ACS` | |
| EA, Engineers Australia, CDR | en · AU-bound | Engineering assessment (Competency Demonstration Report) | `G.skills_assessment_authority` (engineering), `S.regulator` | |
| CPA, CA ANZ, IPA | en · AU-bound | Accounting assessing bodies | `G.skills_assessment_authority` (accounting) | |
| PY, professional year, "PY garera 5 points" | en, ne · AU-bound | Professional Year Program | seed `professional_year_eligible`, `G.professional_year_program_name`, `G.professional_year_cost`, `F.points_table[professional_year]` | ICT, accounting, engineering only |
| sponsorship (employer), 482, SID, TSS, LMIA, H-1B, Skilled Worker, Blue Card | en · all | Employer-sponsored work visas | `F.employer_sponsored_visa_name[]` (salary thresholds, PR years), seed `skilled_worker_salary_threshold`, `h1b_cap_exempt_employer` | Employer sponsor ≠ visa financial sponsor ≠ UK student sponsor licence |
| citizenship, "passport milcha kahile" | en, ne · all | Years to citizenship | `F.citizenship_residency_years` | |
| MARN, migration agent, RMA, RCIC, "agent le confirm" | en, ne · all | Registered migration practitioner | `F.migration_advice_disclaimer_required`, `X.services_and_fees` (Expert migration agents), intent `human_handoff` | Rule 10 sentence |
| licence, registration, "AHPRA", "NMBA", "nursing board" | en · all | Professional registration | `S.regulator`, `S.registration_steps[]`, `S.course_leads_to_registration` | View 14 |
| bridging, bridging program, OBA, OSCE, NCLEX | en · all (health) | Bridging/exams for overseas-qualified professionals | `S.bridging_program`, `S.bridging_cost`, `S.exam` | |
| PCL nursing, staff nurse, GNM, B.Sc nursing, "ANM" | en, ne, hi · NP IN | Source-country nursing qualifications | `S.source_qualification_recognition`, `U.qualification_equivalence` | PCL/GNM are diplomas; recognition differs from BSc Nursing |

## 10. Work, tax and money-while-studying

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| part time, part-time job, "kaam garna milcha?", side job | en, ne · all | Student work rights | `E.work_hours_term`, `E.work_hours_break`, seed `work_hours_allowed_per_week`, `E.work_start_rule` | |
| 20 hours, "20 hrs a week", 24 hours (CA) | en · all | Weekly work cap | `E.work_hours_term` | CA moved 20 → 24 h/week in 2024; UK 20 h (degree) / 10 h (below degree) |
| 48 hours, "48 per fortnight" | en · AU-bound | AU fortnightly cap (condition 8105) | `E.work_hours_term` (AU, per fortnight), `VisaCondition 8105` | Per fortnight, not per week |
| unlimited in holidays, "break ma full time" | en, ne · all | Work in scheduled breaks | `E.work_hours_break` | Scheduled course breaks only |
| placement hours count? | en · all | Whether placements count toward the cap | `E.placement_counts_toward_hours` | Course-required placements are excluded in AU |
| minimum wage, "per hour kati", hourly rate | en, ne · all | Legal minimum and typical student wage | `N.min_wage_hourly_by_region`, `N.casual_loading_pct`, `N.typical_student_job_rates`, `N.min_wage_hourly_by_region` | Casual loading (AU) raises the rate; age bands for under-21 |
| cash in hand, "cash job" | en · all | Unlawful unrecorded work | `N.workplace_rights_authority`, `N.exploitation_protections_for_students` | Do not advise; state the rule |
| TFN | en · AU-bound | Tax File Number | `M.tax_id_name` (TFN), `M.tax_id_apply_method` | |
| SIN | en · CA-bound | Social Insurance Number | `M.tax_id_name` (SIN) | |
| NI number, NINo | en · UK-bound | National Insurance number | `M.tax_id_name` (NI) | |
| SSN | en · US-bound | Social Security Number (needs job offer for F-1) | `M.tax_id_name` (SSN) | |
| PPS number | en · IE-bound | Irish Personal Public Service number | `M.tax_id_name` (PPS) | |
| Steuer-ID, Anmeldung | en, de · DE-bound | German tax ID and address registration | `M.tax_id_name` (Steuer-ID), `M.address_notification_rule` (Anmeldung) | |
| super, superannuation, "super refund", DASP | en · AU-bound | Retirement contributions and departure refund | `N.pension_refund_on_departure`, `N.pension_refund_on_departure` (DASP) | |
| tax return, tax refund, "tax firta" | en, ne · all | Annual filing and refunds | `N.income_tax_free_threshold` (threshold, residency, refund) | |
| gig, Uber, food delivery, ABN | en · AU-bound | Self-employment/platform work | `E.self_employment_gig_rules` | Hours still count toward 8105 |
| remittance, "ghar paisa pathaune", Western Union, IME | ne, en · NP | Sending money home | `D.remittance_options`, `D.remittance_options` | |

## 11. Accommodation and arrival

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| homestay | en · all | Living with a host family | `Accommodation.type=homestay`, `D.homestay_weekly_cost_typical`, `R.homestay_vetting` | Under-18s often required to use approved homestay |
| PBSA, student accommodation, "Scape", "Iglu", "UniLodge", halls, dorm, hostel | en · all | Purpose-built student accommodation / halls of residence | `Accommodation.type=pbsa / on_campus`, `M.accommodation_type`, `C.on_campus_beds_count`, `C.on_campus_housing_weekly_cost_range` | "Hostel" in NP/IN = student housing, not backpacker |
| shared room, sharing, "room share", flatting | en · all | Shared private rental | `Accommodation.type=shared`, `D.rent_shared_room_weekly` | |
| bond, security deposit, "bond paisa" | en, ne · all | Rental deposit | `M.accommodation_bond_amount`, `D.rental_bond_weeks`, `N.tenancy_bond_authority` | Bond is refundable; not the tuition deposit — §D |
| rent in advance, "2 weeks advance" | en · all | Upfront rent | `D.rent_in_advance_weeks` | |
| lease, tenancy, "6-month lease", break lease | en · all | Rental contract | `M.accommodation_lease_min_weeks`, `N.tenancy_bond_authority` | |
| guarantor (rent) | en · UK-bound | UK rental guarantor requirement | `M.accommodation_guarantee_scope`, `Accommodation.guarantee` | Different from visa sponsor/loan guarantor |
| airport pickup, "airport bata liney" | en, ne · all | Institution or agency pickup | `B.airport_pickup_offered`, `M.airport_pickup_cost`, `M.airport_pickup_booking_lead_days`, `C.nearest_airport_iata` | |
| temporary accommodation, first week stay | en · all | Short-term arrival housing | `M.temporary_accommodation_options` | |
| orientation, O-week, induction, "orientation compulsory?" | en · all | Start-of-term program | `T.orientation_period`, `M.orientation_mandatory`, `B.international_orientation_length_days` | |
| census date, "last date to withdraw", add/drop | en · AU/US-bound | Date after which fees are locked | `T.census_date`, `O.term_structure` | Financial consequence date; not attendance |
| pre-departure, "pre-departure briefing", PDO | en · all | Agency session before travel | `X.pre_departure_sessions`, `X.readiness_checklist` | |
| SIM, "phone SIM", bank account opening, "account kholne" | en, ne · all | Arrival essentials | `M.sim_providers`, `M.pre_arrival_bank_account_options` | |
| customs, "cash limit", "AUD 10,000", declare | en · all | Arrival declarations | `M.customs_prohibited_items_for_students`, `M.customs_cash_declaration_threshold` | |
| transit visa, "Dubai transit", "layover visa" | en · all | Transit requirements for the nationality | `M.transit_visa_requirements_by_hub`, `M.transit_visa_requirements_by_hub` | |
| vaccination, "vaccine chahincha?" | en, ne · all | Entry or placement vaccination rules | `M.arrival_vaccination_requirements`, `S.criminal_vaccination_checks` | Entry vs placement |
| winter clothes, jacket, "kati chiso" (how cold) | en, ne · all | Climate | `D.climate_type`, seed `climate_type`, `M.winter_clothing_requirement` | |
| driving licence, "license convert", IDP | en · all | Driving with an origin licence | `N.foreign_licence_validity_months`, `M.licence_conversion_requirements` | |
| guardian (arranged), local guardian, "custodian" | en · all | Adult responsible for an under-18 | `R.welfare_arrangements`, `R.custodian_requirements` | Different from the guardian visa (§5) |

## 12. Academic rules while enrolled

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| attendance, "80 % attendance", "attendance short" | en · all | Attendance requirement and monitoring | `O.attendance_min_pct`, `O.attendance_monitoring_method` (VET 80 %), `VisaCondition 8202` | Higher-ed AU monitors progress rather than attendance |
| progress, course progress, "fail bhayo", "unsatisfactory progress", "50 % fail" | en, ne · all | Academic progression rules | `O.course_progress_rule` (fail thresholds), `O.intervention_strategy_triggers` | Failing 50 % of units in two consecutive periods triggers reporting in AU |
| show cause, "show cause letter", warning letter | en · AU-bound | Notice requiring the student to explain poor progress/attendance | `O.course_progress_rule` (show cause, exclusion), `O.reporting_obligation_triggers` (PRISMS) | Precedes reporting to the department |
| exclusion, terminated, "cancel bhayo", SEVIS terminated | en, ne · all | Removal from the course | `O.course_progress_rule` (exclusion), `O.reporting_obligation_triggers` (PRISMS/SEVIS/UKVI), `E.visa_conditions[]` | Visa consequences via `E.change_provider_rules` |
| release letter, "release chahincha", transfer letter | en, ne · AU-bound | Provider's release to transfer within the restriction period | `O.release_letter_policy`, `O.release_letter_fee`, `E.change_provider_rules` | AU concept; other destinations have no equivalent |
| leave, leave of absence, "ghar jane 3 mahina", suspension of studies | en, ne · all | Approved break from study | `O.leave_of_absence_visa_impact` | Visa may be cancelled if the CoE is suspended |
| reduced load, underload, "2 subjects only" | en · all | Below full-time enrolment | `O.reduced_load_conditions`, `O.full_time_load` | Allowed only in listed circumstances |
| extension, "course extend", "new CoE" | en · all | Extending the course/visa | `O.study_extension_process`, `E.visa_grant_length_rule` | |
| plagiarism, academic integrity, "AI use", Turnitin | en · all | Integrity rules | `O.ai_tools_policy` | |
| semester, trimester, term, block | en · all | Term structure | `O.term_structure`, `T.*` | AU trimester institutions have 3 intakes |
| unit, subject, module, credit point, "4 units" | en · all | Study units | `A.credit_unit_name`, `O.credit_system` | |
| exchange, study abroad semester | en · all | Exchange programs | `O.exchange_program_available` | Not the student's own "study abroad" |
| dashain break, "dashain ma ghar", tihar, "chhath", Eid, Diwali, Tết, Pohela Boishakh | ne, hi, bn, vi · NP IN BD VN | Home festival vs academic calendar | `N.home_festival_break_overlap`, `T.public_holidays_origin`, `T.mid_term_break` | Dashain (Sept–Oct) usually falls mid-semester in AU/UK; no scheduled break |

## 13. Family and dependants

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| dependent / dependant, "family lane" — see §5 | | | | |
| spouse can work?, "srimati le kaam garna milcha?", partner work rights | en, ne · all | Partner's work entitlement | `P.partner_work_rights` (level-variant) | Full-time for masters/PhD partners in AU; barred for most UK taught masters since 2024 |
| kids school free?, "bachcha ko school free cha?" | en, ne · all | Dependant schooling cost | `P.public_school_fee_by_region`, `P.school_fee_exemptions` | Free in some AU states for PhD dependants; fees in NSW/VIC otherwise |
| child born there, "citizen hunchha?" | en, ne · all | Citizenship of a child born in the destination | `P.child_citizenship_rule`, `P.maternity_coverage` | Not automatic in AU/UK/DE; yes in CA/US |
| main applicant swap, "wife main applicant" | en · all | Choosing which partner studies | `P.main_applicant_swap_feasibility` | Judgement; data: `P.partner_work_rights`, cost |
| childcare, daycare, "CCS" | en · all | Childcare cost and subsidy | `P.childcare_cost_subsidy` | |
| family accommodation, "family room" | en · all | Housing for families | `P.family_housing_rent`, `M.family_accommodation_available` | |
| dependant English, "spouse ko IELTS" | en, ne · all | English requirement for dependants | `I.dependant_english_required`, `I.dependant_english_required` | UK requires for some; AU functional English only for later visas |
| parents visit, visitor visa for parents, "buwa aama lai bolaune" | en, ne · all | Visitor visa for family | `E.visitor_visa_for_parents`, `E.visitor_visa_for_parents` | |

## 14. Life, community and food

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| Nepali community, "Nepali haru kati chhan", Nepalese society, NRNA | ne, en · NP | Diaspora presence | `D.diaspora_community_presence`, seed `diaspora_community_presence`, `B.origin_student_society_present`, `B.nationality_mix`, `B.source_market_student_estimate` | City-level vs institution-level |
| Indian community, Bangladeshi community, Viet community, Filipino community | en · IN BD VN PH | Diaspora for other origins | `D.diaspora_community_presence` (by origin), `B.nationality_mix` | |
| temple, mandir, gurdwara, mosque, masjid, church, gumba/monastery | en, ne, hi · all | Religious facilities | `D.religious_facilities_count`, `C.religious_facilities_nearby`, `B.prayer_room_available` | |
| halal, halal food, "halal milcha?" | en, bn · BD IN MY | Halal availability | `D.halal_food_availability`, `B.halal_food_available` | |
| vegetarian, veg, "pure veg", Jain food | en, hi · IN NP | Vegetarian availability | `D.vegetarian_food_availability` | |
| Nepali/Indian grocery, "masala pasal", Asian grocery | ne, en · all | Ethnic groceries | `D.ethnic_grocery_availability` | |
| safe?, "safe cha?", racism, "for girls safe?" | en, ne · all | Safety and discrimination | `D.safety_index` (seed), `D.crime_index`, `D.suburb_safety_notes`, `N.discrimination_experience_index`, `D.women_safety_index` | Cite indices with source and year |
| weather, "kati garmi/chiso" | en, ne · all | Climate | `D.climate_type`, seed `climate_type` | |
| lonely, homesick, depression, "mann lagdaina" | en, ne · all | Wellbeing | `B.counselling_service_available`, `N.international_student_support_hubs`, intent `anxiety_reassurance` | No data beyond services; view 8/15 |
| public transport, "student concession", Opal/Myki/Go Card | en · all | Transport and concessions | `C.public_transport_rating`, `C.student_transport_concession`, `D.transport_pass_monthly` | International students lack concessions in NSW/VIC — cite |
| onshore support, "Expert ko office there", post-arrival | en, ne · all | Agency's onshore services | `X.services_and_fees`, `X.branches` (AU/UK) | |
| embassy, "Nepali embassy", consulate | en, ne · all | Home-country mission | `N.origin_embassy_in_destination` | |
| emergency number, 000, 911, 999, 112 | en · all | Emergency contacts | `N.emergency_number` | |

## 15. Institution nicknames and abbreviations

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| UTS | en · all | University of Technology Sydney | `Institution` slug `uts`; `B.institution_aliases` | Not "UT Sydney"; UTS College is the pathway college |
| UNSW, "New South Wales uni" | en · all | University of New South Wales | `Institution` slug `unsw` | Not the University of Newcastle or Western Sydney |
| USYD, Sydney Uni | en · all | University of Sydney | `Institution` slug `usyd` | Not UTS, WSU or Sydney's TAFE |
| WSU, Western Sydney | en · all | Western Sydney University | `Institution` slug `western-sydney` | |
| Macquarie, "Mac Uni", MQ | en · all | Macquarie University | `Institution` slug `macquarie` | |
| Deakin, "Deakin Burwood", "Deakin College" | en · all | Deakin University / its pathway college | `Institution` slug `deakin`; `deakin-college` is a separate `pathway_college` | Fee and CRICOS codes differ |
| Monash, "Monash Clayton", "Monash Malaysia", "Monash Caulfield" | en · all | Monash University campuses; Monash Malaysia is a separate branch campus/institution | `Institution` slug `monash`; `Campus` clayton/caulfield; `monash-malaysia` separate `Institution` (MY) with own fees, visa (MY) | Malaysia branch degree → different visa regime and PSW; `W.degree_recognition` for onward migration |
| RMIT, "RMIT Vietnam" | en · all | RMIT University; RMIT Vietnam is a separate campus in VN | `Institution` slug `rmit`; `rmit-vietnam` (VN) | |
| Swinburne, "Swinburne Sarawak" | en · all | Swinburne; Sarawak branch in MY | `Institution` slugs | |
| UQ, "Queensland uni" | en · all | University of Queensland | `Institution` slug `uq` | Not QUT or Griffith |
| QUT | en · all | Queensland University of Technology | `Institution` slug `qut` | |
| Griffith, "Griffith Gold Coast" | en · all | Griffith University | `Institution` slug `griffith` | Gold Coast campus is metro (Cat 1), Nathan/Logan differ — check `C.regional_category_au` |
| UniSA, "Adelaide uni" (merger 2026) | en · all | University of South Australia / Adelaide University | `Institution` slugs; `V.change_history` for the 2026 merger | Confirm which entity issued the offer |
| Curtin, "Curtin Malaysia", "Curtin Dubai" | en · all | Curtin University and branch campuses | `Institution` slugs per country | |
| Navitas colleges — see §7 | | | | |
| CQU, "Central Queensland" | en · all | CQUniversity | `Institution` slug `cqu` | Many regional campuses — regional flag per campus |
| CDU, "Darwin uni" | en · all | Charles Darwin University | `Institution` slug `cdu` | Regional Cat 3 |
| UC (Canberra) vs UC (California) | en · all | University of Canberra vs University of California | `Institution` by destination | Disambiguate by destination mentioned |
| UBC, UofT, "Toronto uni", McGill | en · CA-bound | Canadian universities | `Institution` slugs | |
| "Humber", "Seneca", "Conestoga", "Lambton" | en · CA-bound | Ontario public colleges | `Institution` type `college` (CA public) | PGWP rules for public-private partnerships differ |
| UCL vs UCLan vs UCLA | en · all | University College London vs Univ. of Central Lancashire vs Univ. of California LA | `Institution` slugs | Common confusion |
| "Coventry", "Coventry London", "Hertfordshire", "Herts" | en · UK-bound | UK universities with London branch campuses | `Institution` slugs; `Campus` | London campus changes `E.maintenance_funds_by_location` |
| MIT (Manukau vs Massachusetts vs Melbourne Institute of Technology) | en · all | Three different institutions | `Institution` slugs by destination | Ask which |
| "Uni of Auckland", UoA, AUT | en · NZ-bound | University of Auckland vs Auckland University of Technology | `Institution` slugs | |
| TUM, LMU, RWTH, "Berlin uni" | en · DE-bound | German universities | `Institution` slugs | |
| Trinity, TCD, UCD, "Dublin uni" | en · IE-bound | Irish universities | `Institution` slugs | |

## 16. Timing and process words

| phrase | language / market | meaning | canonical entity.attribute (or domain) | disambiguation notes |
|---|---|---|---|---|
| "is it possible for Feb?", "Feb ma milcha?", "Jan session" | en, ne · all | Intake feasibility | → view 5 (`T.*`, `E.processing_time_*`, `B.offer_turnaround_days_*`) | |
| turnaround, "offer kati din ma", TAT | en, ne · all | Offer processing time | `B.offer_turnaround_days`, `B.partner_priority_offer_turnaround_days` (seed `offer_turnaround_days`) | |
| priority processing, fast track | en · all | Expedited visa/admission | `E.student_visa_fee` (priority), `E.priority_processing_available` | |
| policy change, "new rule aayo", "rule change hune re" | en, ne · all | Announced/effective changes | `PolicyChange` (`W.policy_change_log`, `E.policy_effective_date`), flag `fact_verification` | Announcement vs effective date |
| "I heard that…", "sathi le bhanyo" (a friend said) | en, ne · all | Rumour verification | flag `fact_verification` → view 9 expanded | Answer only from cited sources |
| spot admission, spot assessment, "uni aaucha office ma" | en, ne · all | On-the-spot admission events | `X.events[]` (spot-admission days) | |
| education fair, expo | en · all | Agency/uni fairs | `X.events[]` | |
| internal deadline, "Expert ko last date" | en, ne · all | Agency submission cut-off | `X.internal_submission_deadlines` | Earlier than the institution deadline |
| checklist, "document list", "kun kun document" | en, ne · all | Required documents | → view 12 (`K.doc_required`, `X.readiness_checklist`) | |

---

## Entity disambiguation rules Edge should apply

These rules run before retrieval (query rewrite) and again in the answer layer (which
attribute to cite). Each names the signals to use, the default when signals are absent,
and what to say when the ambiguity cannot be resolved.

### A. "NOC" — Nepal MoE No Objection Certificate vs Canada National Occupational Classification

| Signal | Resolve to |
|---|---|
| Origin = Nepal **and** context is remittance, bank, "Ministry", "Sanothimi/Keshar Mahal", "NRB", document list, exit, or the word "letter"/"certificate" | `U.moe_noc_rules`, `B.nepal_moe_noc_eligible` |
| Destination = Canada **or** followed by a 4–5-digit number, "TEER", "code", "Express Entry", "occupation", "in-demand" | `G.occupation_code` (NOC 2021), `G.occupation_list_membership` |
| Destination = Canada **and** origin = Nepal, context is documents | Both may apply: answer the MoE NOC (document) and add one line that Canada's NOC is an occupation code, not a document |
| Neither destination nor origin known | Ask, with the two meanings named; do not guess |

### B. "college" — any institution vs a specific institution type

| Signal | Resolve to |
|---|---|
| NP/IN/BD phrasing with a proper name ("kun college ma?", "college fee") and no destination-type hint | Generic `Institution`; answer for the named institution regardless of its `B.institution_type` |
| Destination = Canada, "college" without a university name, or "diploma"/"PG diploma"/"co-op" | `B.institution_type=college` (public CA college); check `B.pgwp_eligible_dli` and public–private partnership status in `B.notable_risks[]` |
| Destination = Australia with "TAFE", "diploma", "cert IV", "cheap college" | `B.institution_type ∈ {tafe, private_vet}`; carry `E.evidence_level_by_provider` and `A.course_level_coarse` (VET) into visa reasoning |
| Destination = UK with "college" | `B.institution_type ∈ {fe_college, pathway_college}`; UKVI below-degree English rules and Graduate Route ineligibility apply |
| Destination = US with "college" | US "college" may be a full university; use `B.institution_type` and do not imply lower standing |
| "Deakin College", "UTS College", "Navitas", "Taylors", "INTO" | `B.institution_type=pathway_college`; always state `A.awarding_body` and that PSW depends on the exit qualification |

### C. "dependant / dependent" — who is included, and on which visa

| Signal | Resolve to |
|---|---|
| Spouse/partner/children named, student visa context | `E.dependents_allowed` for the destination × level; then `P.partner_work_rights`, `P.public_school_fee_by_region`, `P.additional_funds_per_dependant`, `E.dependant_visa_fee`, insurance couple/family rows |
| Parents or siblings named | Not dependants on any student visa; resolve to `E.visitor_visa_for_parents` and say so |
| Unmarried partner | `P.relationship_evidence` (de facto rules); AU accepts with 12-month evidence, UK requires 2 years, CA common-law 12 months — cite from P |
| Post-study visa context (485/PGWP/Graduate Route) | `F.psw_dependants_allowed` rather than `P.*` student rows |
| Level not stated | Ask the level; UK and AU rules diverge sharply between taught masters and research/PhD. Never default |

### D. "deposit" vs "fee" vs "bond"

| Phrase | Resolve to |
|---|---|
| deposit, first instalment, tuition advance (context: offer/CoE) | `B.deposit_policy`, `B.deposit_policy`, `B.deposit_policy`; part of tuition, precedes CoE/CAS |
| application fee | `B.application_fee_policy`, `B.application_fee_policy`; non-refundable, precedes the offer |
| tuition/fee/course fee | `L.tuition_by_offering`; per year unless stated |
| visa fee | `E.student_visa_fee`; government charge, not refundable |
| bond (accommodation) | `M.accommodation_bond_amount`, `D.rental_bond_weeks`; refundable rental deposit, held by the bond authority |
| bond (scholarship return-home) | `H.scholarship_return_home_bond`; obligation, not money |
| GIC / blocked account | funds instruments (`E.gic_amount`, `E.blocked_account_amount`), returned to the student monthly — neither a fee nor a deposit |

When the counsellor writes only "paisa" or "kharcha", Edge lists the applicable items from
view 2 rather than picking one.

### E. scholarship vs bursary vs waiver vs discount

| Term | Canonical | Rule |
|---|---|---|
| scholarship | `Scholarship` with `H.provider_type ∈ {university, faculty, government, external}`, `H.coverage_type ∈ {pct, fixed, full}` | Merit or need based; may need an application (`H.scholarship_application_required`) |
| bursary | `Scholarship` with `H.coverage_type=fixed`, usually `H.competitiveness=automatic`, often nationality/region gated | Treat as a scholarship record; say "bursary" if the source does |
| fee waiver / tuition waiver | `Scholarship` with `H.coverage_type=pct` and `H.provider_type ∈ {university, agency_negotiated}` | Agency-negotiated waivers: only the public yes/no is in scope; amounts are commercial terms — render as out of scope, not as unknown |
| discount (early payment, sibling, alumni, regional) | `H.sibling_discount_pct`, `A.regional_campus_discount_pct` | Not competitive; conditions on payment timing |
| stipend | `H.phd_scholarship_stipend_annual`, `Q.funding_stipend` | Living allowance; does not reduce tuition unless a waiver is attached |
| "free seat", "full free", "100 % scholarship" | `H.coverage_type=full` | Verify whether living costs are covered (`H.scholarship_living_allowance`) — students assume yes |
| loan | never a scholarship; `L.loan_lender_type` | Classifier: "loan" → `scholarship_funding` intent but the entity is `FinanceProvider` |

### F. SOP vs GS statement / GTE vs study plan vs personal statement

| Signal | Resolve to |
|---|---|
| "SOP for university", "personal statement", UCAS, US application, word limit for admission | `K.sop_prompts` (admission) |
| Destination = Australia, "GS", "GTE", "genuine", visa, "5 questions", "150 words" | `E.genuine_intent_test=GS`, `E.genuine_intent_word_limits`; if the counsellor says "GTE", answer for GS and note the 2024 change |
| Destination = Canada, "SOP", "study plan", "LOE" | `E.genuine_intent_test` (CA study plan) |
| Destination = UK, "SOP" | Usually a university personal statement; UKVI has no SOP — the credibility interview is the intent test (`E.genuine_intent_test` GB) |
| Destination = US, "SOP" | University statement; visa intent is tested at the F-1 interview |
| "SOP" with no destination and both admission and visa in the same message | Answer both, headed "For the university" and "For the visa", each with its own attributes |

### G. "regional"

| Signal | Resolve to |
|---|---|
| Destination = Australia | `C.regional_category_au` from the campus postcode (Cat 1 = Sydney/Melbourne/Brisbane; Cat 2 = cities and major regional centres; Cat 3 = regional centres and other areas). Consequences: `F.psw_regional_extension`, seed `regional_study_points`, `A.regional_campus_discount_pct`, DAMA/491 in `F.regional_491_conditions`. Perth, Adelaide, Gold Coast, Canberra, Hobart are Cat 2 — "regional" in the migration sense, not "rural" |
| Destination = New Zealand | `regional_study_nz` (outside Auckland) |
| Destination = Canada | "rural/small community" streams (RCIP) in `F.regional_491_conditions`; PNP province in `pnp_in_demand_provinces` — no postcode category |
| Destination = UK/US/DE/IE | No regional migration concept; "regional" means the D-domain cost index only. Say so if the counsellor expects points |
| Student says "regional feels far/unsafe" | Lifestyle question → `D.*`, `C.distance_to_cbd_km`, `C.transit_time_to_cbd_min`, not a migration fact |

### H. Other standing rules

- **Test names**: normalise misspellings ("ILETS", "TOFEL", "PTE academic", "Duolingo test") to the `Test` code; never infer Academic vs General Training — ask if it changes the verdict.
- **"IOM"**: a panel clinic, so resolve to `E.panel_clinics_by_origin` and `E.health_exam_*`; do not treat as an organisation the student must contact for anything else.
- **"Session/intake/batch"**: always map to `IntakeCalendar`; if the student's phrasing names only a month, use `T.term_start_date` of the matching term and state the term id.
- **"Backlog/back paper/supplementary/compartment/ATKT"**: all resolve to `A.backlog_acceptance_max`; the counting method must be stated (`A.backlog_counting_method`); a cleared re-sit still counts unless the institution says otherwise.
- **"+2 / intermediate / HSC"**: resolve through `U.year12_equivalent_name` for the student's origin before matching `A.accepted_qualifications_by_country`; the same word means different qualifications in NP, IN and BD.
- **"Stay back"**: resolve to the destination's PSW visa name; if no destination, list PSW names per destination rather than picking one.
- **Currency words**: "lakh/crore" imply the origin currency; if a destination currency is meant ("50 lakh AUD" never occurs) treat as origin and convert with `W.fx_rate_indicative`, dated.
- **"Sponsor"**: three meanings (visa financial sponsor, employer visa sponsor, UK institution sponsor licence); resolve by context — money → E, job/482/Skilled Worker → F, CAS/"licensed" → B.
- **"Guardian"**: visa (AU 590/UK parent) vs arranged welfare (CAAW/custodian) vs rental guarantor; under-18 context → R and E; housing context → M.
- **Unresolvable**: when a phrase maps to two entities and no signal separates them, Edge answers the more common meaning for the stated origin/destination and adds one line naming the other meaning — never silently picks.
