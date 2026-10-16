# 07 — Counsellor views: what Edge shows

This file defines the **answer shapes** Edge renders for a counsellor. Each view names
the student-question types it serves, the journey stages (`S1`–`S20`, see
`02-question-coverage.md`) and `PRIMARY_INTENTS` (`src/schemas/intent.schema.ts`) that
trigger it, a Markdown mock of the rendered output, the catalog attributes it consumes
(`<domain letter>.<attribute>`; names taken from the plan's domain map and the seed sheet;
every backticked name resolves to a `03-catalog/` row, checked by `scripts/catalog.ts check --refs`), the derivation
logic, tri-state handling, variant selection and degradation behaviour.

Views are not new prompts. They are the structured targets a future answer layer fills
from catalog data, and that today's prose answer already approximates under rules 1–10 of
`CONSULTANT_SYSTEM_PROMPT` (`src/prompts/consultant.ts`). Every rule that already exists
today is kept: inline `[n]` citations on every factual sentence (rule 2), the literal
phrase `Not in the knowledge base:` for gaps (rule 3), both values shown on conflict (rule 4),
third-party flagged "not yet verified" (rule 4b), tables for comparisons (rule 5),
`Sources: [n][m]` after drafts (rule 6), MARN sentence for case-specific migration
decisions (rule 10) and the appended disclaimers in `DISCLAIMER_INTENTS`.

## Stage key (from `02-question-coverage.md`)

| Stage | Name | Stage | Name |
|---|---|---|---|
| S1 | Enquiry & goal | S11 | Pre-departure |
| S2 | Destination choice | S12 | Life abroad |
| S3 | Course, level & pathways | S13 | Academic rules while enrolled |
| S4 | Institution choice | S14 | Family & dependants |
| S5 | Eligibility, academics & grade conversion | S15 | Post-study work, PR & licensing |
| S6 | English & admission tests | S16 | Careers & ROI |
| S7 | Application | S17 | Alternatives & risk |
| S8 | Finances | S18 | Special populations |
| S9 | Scholarships | S19 | Time-sensitive & policy change |
| S10 | Visa | S20 | Meta (how sure are we, sources) |

## Global rendering rules (apply to every view)

1. **Every figure carries `[n]` and an as-of date.** `[n]` is the excerpt id of the
   `Source` (`src/retrieval/format.ts`) that supplied the value; the as-of date is
   `V.extracted_at` (indexed) or `fetched_at` (live). Rendered as `AUD 38,400/yr [3]
   (as of 2026-08-12)`. When the value was human-verified, `V.verified_at` replaces the
   extraction date and the footer says so.
2. **Tri-state is never collapsed.** `required:<value>` renders the value; `not_required`
   renders "Not required" with its citation (this is a positive fact and has a source);
   `unknown` renders exactly `Not in the knowledge base` in the cell **and** the
   attribute's human label is appended to the Coverage notice (view 10). No blank cells,
   no `0`, no `—`, no "N/A" for unknown.
3. **Variant statement.** When a value came from a variant axis, the view says which:
   `(variant: nationality=NP, level=masters_coursework, offering=Burwood on-campus,
   intake=2027-T1)`. If the student's axis value is not stored, the view falls back to the
   nearest variant, labels it `(nearest variant: level=bachelor — masters value not stored)`
   and lists the exact variant in the Coverage notice.
4. **Quotable flag.** Values with `quotable=internal` appear only in a collapsible
   `Internal — do not quote to student` block. `quotable=disclaimer` values force the MARN
   sentence into the footer.
5. **Conflicts.** When `V.conflicts[]` is non-empty the cell shows both values:
   `AUD 29,710 [3] / AUD 31,200 [7] — conflict, official source preferred`. Resolution
   order: `V.reliability_tier` (official > institution page > rep-confirmed > third-party
   > derived > unverified), then most recent `valid_from`, then live over indexed.
6. **Stale values.** If `V.review_due_at` < today the value renders with `⚠ review overdue
   (as of <date>)`; if `V.valid_to` < today the value is not used at all and is listed
   under Coverage notice as `expired: <attribute> (was <value>, valid to <date>)`.
7. **Currency.** Native currency first, then the origin-market conversion in brackets with
   `V.fx_rate_used` and `V.fx_as_of`: `AUD 38,400 (≈ NPR 34.2 lakh at 89.1, fx as of
   2026-09-01)`. Lakh/crore formatting only for NPR/INR/BDT.
8. **Numbers Edge computed** (totals, deltas, dates, points) are labelled `derived` and
   cite every input; they never take a citation of their own.

All values in the mocks below are **illustrative placeholders**, not facts about the
named institutions or governments.

---

## View 1 — Eligibility verdict card

### Purpose

Answers "Does this student qualify?", "Sir, my GPA is 2.8, can I get in?", "I have two
years gap", "I have 3 back papers", "3-year bachelor accepted?", "Is my IELTS enough?",
"Do I need work experience for the MBA?", "Do they take NEB grades directly?".

- Stages: S5 (primary), S6, S3, S17, S18.
- Intents: `eligibility_check` (primary), `alternative_pathways`, `program_selection`,
  `university_selection`, `test_preparation` (English rows only).
- Task: `eligibility`; also emitted inside `compare` when the comparison has a student
  profile attached.

### Mock

> **Eligibility read — Master of Information Technology, Deakin University (Burwood, on-campus), 2027 Trimester 1**
> Profile as given by the counsellor: Nepal · TU BSc CSIT 2023, 64.2 % (second division) · 2 back papers cleared in 2 attempts · IELTS Academic 6.5 overall (L 7.0 R 6.5 W 6.0 S 6.5), test date 2026-05-18 · no work experience · age 24 · gap 2 years 2 months since graduation · no prior refusal.
>
> | Requirement | Course minimum | Student | Verdict |
> |---|---|---|---|
> | Academic — GPA | WAM 60 % Australian-equivalent; TU % accepted per country table: 60 % for TU Bachelors [2] (as of 2026-07-30) (variant: nationality=NP) | 64.2 % TU → 62 % AU-equivalent via U.grade_conversion_table NP→AU (authority: institution country page) [2][9] | **Meets** (+2.0 pp margin, derived) |
> | Bachelor length | 3-year bachelor accepted for this course [2] | 4-year BSc CSIT | **Meets** |
> | Cognate background | Cognate IT degree or conversion stream; non-cognate applicants enter the 2-year stream [2] | BSc CSIT — cognate | **Meets** — 1.5-year stream with credit; confirm credit at offer [2] |
> | Backlogs | Not in the knowledge base | 2 subjects, 2 attempts | **Unknown** — cannot assess; see Coverage notice |
> | Study gap | Not stated as a requirement by the university [2]; visa side: gap must be explained in the GS statement [5] (as of 2026-06-01) | 2 y 2 m | **Meets (admission)** · **Attention (visa)** — explanation needed |
> | English — overall | IELTS 6.5 overall [3] (as of 2026-07-30) | 6.5 | **Meets** |
> | English — per band | No band below 6.0 [3] | W 6.0 | **Meets** (0.0 margin — no headroom) |
> | English — validity | Test within 2 years of course start [3]; visa side: within 2 years of lodgement [6] | 2026-05-18 → valid to 2028-05-18 | **Meets** for 2027-T1 |
> | Work experience | Not required [2] | 0 | **Not required** |
> | Age | Not in the knowledge base | 24 | **Unknown** (general note, unsourced: age is rarely an admission criterion at masters level) |
> | GRE/GMAT | Not required [2] | — | **Not required** |
> | Prerequisite subjects | Not in the knowledge base | — | **Unknown** |
>
> **Overall: likely eligible on the known rows; 3 rows unknown.** No probability is given. Realistic options if the W 6.0 falls on retest: one-skill retake accepted by the university for admission [3] but not for the visa [6]; or packaged ELICOS 10 weeks per 0.5 band [4] (see Pathway map).
>
> Not in the knowledge base: Deakin backlog policy for TU graduates; minimum age for this course; prerequisite subjects for the 1.5-year stream.

### Attributes consumed

| Row | Attributes |
|---|---|
| Academic — GPA | `A.min_gpa_normalized`, `A.min_gpa_scale`, `A.accepted_qualifications_by_country`, `A.accepted_qualifications_by_country`, `U.grading_scale_type`, `U.grading_pass_mark`, `U.division_labels`, `U.conversion_table_url`, `U.conversion_authority` |
| Bachelor length | `A.three_year_bachelor_accepted`, `U.bachelor_years_standard`, `U.three_year_degree_accepted_by` |
| Cognate | `A.cognate_or_conversion`, `A.cognate_or_conversion`, `A.assumed_knowledge`, `A.rpl_max_credit_pct` |
| Backlogs | `A.backlog_acceptance_max`, `A.backlog_counting_method` (attempts vs subjects), `U.backlog_terminology` |
| Study gap | `A.study_gap_max_years`, `E.genuine_intent_gap_scrutiny` |
| English | `I.english_overall_min` (overall + per-section, per test), `I.english_overall_min_normalized`, `I.test_validity_months`, `I.english_validity_measured_to`, `I.test_one_skill_retake_available`, `E.visa_english_accepted_tests`, `E.visa_english_min`, `I.visa_english_validity_months`, `I.english_equivalence_table` |
| Waiver | `I.english_test_waiver_available`, `A.moi_waiver_accepted`, `I.moi_waiver_levels_accepted` (countries, boards, recency) |
| Work experience | `A.work_experience_years_required`, `A.work_experience_type_required` |
| Age | `A.min_age`, `A.max_age` |
| Admission tests | `A.standardized_test_mandatory`, `I.aptitude_test_min_score`, `A.sat_act_middle_50` |
| Prerequisites | `A.prerequisite_subjects`, `A.prerequisite_subjects_with_grade` |
| Interview / portfolio | `A.interview_required`, `A.portfolio_required` |
| Provenance | `V.*` on every value |

### Derivation

- `student_value` comes only from the counsellor's message or saved profile (`{{profile}}`); Edge never infers a grade.
- Grade conversion: raw source-scale value → `U.grade_conversion_table[origin_board → destination_scale]`; the row shows the raw value, the converted value, the table's authority and its citation. If no table exists for that board→scale pair, the row is `unknown` (never convert by "general knowledge").
- Margin = `student_converted − course_minimum` in the destination scale, labelled `derived`. Zero margin is flagged "no headroom".
- Verdict enum: `meets`, `short_by <delta>`, `not_required`, `unknown`, `attention` (meets admission but triggers a visa-side flag). `short_by` always names the delta in the source unit ("short by 0.5 band in Writing", "short by 4 pp").
- English validity: `test_date + I.test_validity_months` compared against both `T.term_start_date` (admission) and the projected visa lodgement date from view 5 (visa). Two verdicts when they differ.
- Backlogs: compare using `A.backlog_counting_method`; if the method is unknown but the max is known, show the count both ways and mark the verdict `unknown (counting method not stored)`.
- Overall line: count of `meets` / `short_by` / `unknown`. Never a probability, never "will be admitted" (playbook rule).

### Tri-state handling

Each requirement is `required:<value>` / `not_required` / `unknown`. `not_required` is a green verdict with a citation. `unknown` renders `Not in the knowledge base` in the minimum column and `Unknown` in the verdict column, and is appended to the Coverage notice. A requirement the counsellor did not supply a student value for renders `Student value not given` in the student column and the verdict `cannot assess`; that is different from unknown and is not added to the Coverage notice.

### Variant selection

Order of precedence: `nationality` (student origin, e.g. NP), then `level` (from `study_level` or the course's own level), then `offering` (campus × delivery named by the counsellor, else the course's main campus), then `intake` (target intake, else next open intake per `T.intake_status`). The card's header names every axis used. If the nationality-specific minimum is missing but a generic international minimum exists, use the generic one and write `(generic international minimum — Nepal-specific value not stored)`.

### Degradation

- No course record at all → no table; a one-paragraph answer under today's rules plus the Coverage notice listing the whole card as missing and the research notes (`{{research_notes}}`).
- Course record exists but entry rules are free text only (`ProgramRecord.entryRequirements` today) → render the free text as a quoted excerpt with `[n]`, mark every row `unknown (unstructured)` and let the model's prose comparison stand; the card still lists which rows could not be structured.
- Conflict between two pages (e.g. handbook 6.5 vs international page 6.0) → both values in the minimum column with citations, verdict computed against the stricter value and labelled `conflict — stricter value used`.

---

## View 2 — Cost breakdown

### Purpose

Answers "Total kati lagcha?" (how much in total), "tuition plus living per year", "how much do I need for first year", "OSHC kati?", "visa fee?", "in lakhs please", "is Adelaide cheaper than Melbourne for this course".

- Stages: S8 (primary), S2, S4, S17.
- Intents: `financial_viability` (primary), `comparative_decision`, `alternative_pathways`, `family_planning` (dependant add-ons), `strategic_planning`.

### Mock

> **Cost breakdown — Master of IT (2 yr), Deakin Burwood, start 2027-T1, single student from Nepal**
>
> | Item | Amount | Period | Source · as of |
> |---|---|---|---|
> | Tuition, year 1 | AUD 40,600 | per year (2027 rate; variant: offering=Burwood on-campus, applicant_type=international) | [1] · 2026-08-12 |
> | Tuition, year 2 | AUD 42,200 | per year (2027 rate + 4.0 % published indexation, derived) | [1][2] · 2026-08-12 |
> | Living cost (official visa figure, AU) | AUD 29,710 | per year | [5] · 2026-05-10 |
> | Living cost (Melbourne, typical shared room) | AUD 24,400 | per year (rent AUD 290/wk shared + utilities, groceries, transport, phone; derived from D rows) | [6] · 2026-06-30, per Numbeo-style dataset, not yet verified against the university |
> | OSHC, single, 24 months | AUD 1,650 | one-off for cover length (provider: Medibank) | [7] · 2026-07-01 |
> | Student visa (subclass 500) | AUD 2,000 | one-off | [5] · 2026-07-01 |
> | Biometrics / VAC Kathmandu | AUD 0 — Not in the knowledge base | | |
> | Medical exam, KTM panel clinic | NPR 8,500 | one-off | [8] · 2026-03-15 (Agency entry) |
> | Travel KTM→MEL, one way | AUD 950 | one-off (estimate) | [6] · 2026-06-30 |
> | Student services & amenities fee (SSAF) | AUD 365 | per year | [1] · 2026-08-12 |
> | Textbooks & materials | Not in the knowledge base | | |
>
> **First-year cash needed (derived): AUD 75,300** = tuition y1 40,600 + living 29,710 (official figure used, higher of the two) + OSHC 1,650 + visa 2,000 + medical (NPR 8,500 ≈ AUD 95) + travel 950 + SSAF 365 [1][5][6][7][8].
> ≈ **NPR 67.1 lakh** at 89.1 NPR/AUD, fx as of 2026-09-01 [W].
>
> **Total for the 2-year course (derived): AUD 148,700** — assumes living cost flat at the official figure and no scholarship. With the 20 % Vice-Chancellor's International Scholarship (auto-assessed, GPA-based) [3] the tuition component falls by AUD 16,560 (derived).
>
> Figures change each intake; the Cost of Living Estimator (experteducation.com/cost-of-living) is a supplementary tool.
>
> Not in the knowledge base: biometrics fee at VFS Kathmandu; textbook allowance; Deakin payment-plan availability.

### Attributes consumed

`L.tuition_by_offering` (today `ProgramRecord.tuition[]`), `L.tuition_annual_indexation_pct`, `L.tuition_historic_increase_pct`, `L.fee_per_credit_point`, `L.fee_item_type` (SSAF, enrolment, materials, lab, placement, graduation, uniform), `L.first_payment_rule`, `B.payment_plan_available`, `D.official_living_cost_for_visa`, `D.official_living_cost_effective_date`, `D.rent_shared_room_weekly`, `D.rent_single_room_shared_house_weekly`, `D.rent_studio_weekly`, `D.rent_on_campus_weekly_typical`, `D.homestay_weekly_cost_typical`, `D.utilities_monthly`, `D.groceries_weekly`, `D.transport_pass_monthly`, `D.phone_plan_monthly`, `D.textbooks_annual`, `D.one_off_setup_cost`, `D.rental_bond_weeks`, `D.rent_in_advance_weeks`, `D.flight_cost_estimate_from_origin`, `D.cost_source`, `D.cost_year`, `E.student_visa_fee`, `E.dependant_visa_fee`, `E.biometrics_fee`, `E.health_exam_fee`, `E.panel_clinics_by_origin`, `E.insurance_mandatory`, `E.insurance_scheme`, `L.insurance_premium_single` (provider × single/couple/family × months), `E.student_visa_fee` (SEVIS, IHS, VAC, priority), `L.cost_of_attendance_formula_inputs`, `H.scholarship_coverage_pct`, `H.scholarship_amount_first_year`, `H.scholarship_offsets_deposit`, `W.fx_rate_indicative`, `V.fx_as_of`, `W.fx_12m_trend`, `W.min_total_budget_first_year`, seed `living_cost_estimate_annual`, `total_cost_of_attendance`, `cost_of_living_index`.

### Derivation

- **Year n tuition** = published rate for that year if stored; otherwise year-1 rate × (1 + `L.tuition_annual_indexation_pct`)^(n−1), labelled `derived, indexed at x %`. If no indexation figure is stored, years 2+ repeat year-1 and say `(assumes no increase — indexation not stored)`.
- **Living line** shows both the official visa figure (`D.official_living_cost_for_visa`) and the city estimate (sum of D breakdown rows × 52 or × 12). The first-year total uses the higher of the two unless the counsellor asks for "realistic", and says which.
- **Insurance** = `L.insurance_price_table[provider, composition, months]` where months = course months + the destination's required cover extension (`E.insurance_cover_length_rule`). Provider defaults to the institution's preferred provider if stored, else the cheapest stored provider, and the line says which.
- **First-year cash** = tuition y1 + living (chosen) + insurance (full cover if paid upfront, else year-1 portion) + visa fee + biometrics + medical + travel + recurring non-tuition fees for year 1. Deposits are **not** added (they are part of tuition; view 12 handles timing).
- **Total course cost** = Σ tuition years + living × course years + insurance + one-off items. Scholarship reductions are shown as a separate derived line, never silently netted.
- **Conversion** = amount × `W.fx_rate_indicative`, rounded to 0.1 lakh, with the fx as-of date; if `W.fx_12m_trend` is stored, add one clause ("NPR weakened 6 % against AUD in 12 months [n]").
- Family composition (from `family_dependents` flag or the counsellor's message) adds dependant lines from view 3 and `P.*` rows.

### Tri-state handling

A fee item with `not_required` (e.g. `E.biometrics_required = not_required` for a nationality) renders `Not required [n]` and is excluded from totals. `unknown` items render `Not in the knowledge base` in the amount column, are excluded from totals, and the total line is suffixed `(excludes n unknown items)`. A total is never shown without that suffix when anything is unknown.

### Variant selection

Tuition by `offering` (campus × delivery) and `applicant_type=international`; `intake` picks the fee year (fee year = calendar year of `T.term_start_date`). Living cost by `region` (city of the chosen campus), falling back to the destination-level official figure. Insurance by `provider`. Visa fees by `nationality` only where the destination differentiates. Header states every axis.

### Degradation

- Tuition known, nothing else → render tuition rows only and a Coverage notice listing living, insurance, visa; no totals.
- Living cost from a third-party dataset only → keep it, with the rule 4b suffix `per <site>, not yet verified against the university`.
- Tuition only as "from AUD 38,000" (range) → show the range, compute totals with the lower and upper bound as two columns, label `range`.
- FX missing → native currency only, plus `Not in the knowledge base: FX rate` — never a remembered rate.

---

## View 3 — Financial-proof calculator

### Purpose

Answers "show money kati dekhaune?", "bank balance for Canada", "how many months seasoning", "can uncle sponsor", "is education loan accepted", "does income also count", "GIC amount", "blocked account", "28-day rule", "with wife and one child how much".

- Stages: S8, S10, S14.
- Intents: `financial_viability`, `visa_risk_analysis`, `family_planning`, `application_process` (evidence stage).

### Mock

> **Financial capacity — Australia subclass 500, applicant from Nepal, spouse + 1 child (age 6), Master of IT, Melbourne (VIC), lodging offshore ~2027-01**
> Formula per Home Affairs (variant: nationality=NP, level=masters_coursework, evidence level for Deakin = Level 1 [5] (as of 2026-07-01)):
>
> | Component | Rule | Amount | Source · as of |
> |---|---|---|---|
> | 12 months living — primary | AUD 29,710 | AUD 29,710 | [5] · 2026-07-01 |
> | 12 months living — spouse | AUD 10,394 | AUD 10,394 | [5] · 2026-07-01 |
> | 12 months living — each child | AUD 4,449 × 1 | AUD 4,449 | [5] · 2026-07-01 |
> | Tuition — first 12 months | year-1 tuition less deposit paid: 40,600 − 10,000 | AUD 30,600 | [1] · 2026-08-12 (deposit from [2]) |
> | School fees — child, VIC public school | AUD 9,800 per year (variant: region=VIC, dependant of 500 visa holder) | AUD 9,800 | [9] · 2026-02-01 |
> | Travel | AUD 2,000 primary + AUD 2,000 family (offshore applicant from outside East/Southern Africa) | AUD 4,000 | [5] · 2026-07-01 |
> | OSHC family cover — 24 months | AUD 6,200 (provider: Medibank) | AUD 6,200 | [7] · 2026-07-01 |
>
> **Funds to evidence (derived): AUD 95,153** ≈ **NPR 8.48 crore** at 89.1, fx as of 2026-09-01 [W].
> **Alternative route:** annual income of AUD 87,000 (with dependants) shown via tax/salary evidence for the 12 months before lodgement [5] — Nepal income is rarely documented this way (general note, unsourced).
>
> **Evidence rules that apply**
> - Evidence level 1 provider: streamlined — funds evidence is not routinely required at lodgement but may be requested and should be held [5]. Internal — do not quote to student: KTM case officers have requested funds on most Nepal Level-1 files since 2026-03 [12] (branch observation).
> - Seasoning: no fixed holding period in the rule [5]; Not in the knowledge base: Expert's recommended seasoning for Nepal files.
> - Accepted funds: bank deposits, education loans from approved lenders, government or institutional loans [5]. Property is not a liquid fund but supports income capacity [5].
> - Sponsors: parents, spouse, siblings, grandparents accepted; a sponsor must show relationship evidence [5] — `relationship certificate` from the ward office is the Nepal document (variant: nationality=NP) [8].
> - Education loan: sanction letter must show amount, borrower and disbursement terms [5]; Nepal banks with matching products stored: NIC Asia, Global IME, Nabil [10] (as of 2026-01-20) — terms in view 2's loan rows.
>
> Case-specific financial-evidence decisions must be confirmed by a MARN-registered migration agent.
>
> Not in the knowledge base: Expert-recommended seasoning period for Nepal; whether a CA (chartered accountant) valuation report is accepted for income capacity.

### Attributes consumed

`E.financial_proof_formula`, `E.official_living_figure_primary`, `E.official_living_figure_spouse`, `E.official_living_figure_child`, `E.travel_component` (by origin), `E.tuition_component_rule` (12 months less paid), `E.school_fees_component_rule`, `P.public_school_fee_by_region`, `P.school_fee_exemptions`, `P.additional_funds_per_dependant`, `E.funds_seasoning_days`, `E.accepted_fund_types[]`, `E.accepted_sponsor_relationships[]`, `E.sponsor_max_count`, `E.annual_income_alternative`, `E.annual_income_threshold_single`, `E.annual_income_threshold_with_dependants`, `E.loan_acceptance_rules`, `E.asset_types_accepted`, `E.evidence_level_by_provider` (AU), `B.visa_risk_rating`, `E.sds_pal_variant` (CA), `E.gic_amount` (seed `gic_amount`), `E.blocked_account_amount` (DE), `E.maintenance_funds_by_location` (UK London/outside, 28-day rule), `E.dependant_funds_rule`, `L.insurance_premium_single`, `B.deposit_policy` (from `B.deposit_policy`), `L.loan_lender_type` (bank, max, rate, collateral, co-applicant, margin, moratorium, sanction turnaround, accepted_as_evidence_by), `L.finance_provider_name`, `E.document_variants_by_nationality` (relationship certificate, ward recommendation, CA report), `W.fx_rate_indicative`, `V.fx_as_of`, seed `financial_proof_required`.

### Derivation

- Per destination the formula is a stored expression (`E.financial_proof_formula`) evaluated over the components above; the view prints every component as a row and the sum as `derived`. Destination templates:
  - **AU 500**: living(primary) + living(spouse) + living(child)×n + tuition first 12 months − prepaid + school fees × school-age children + travel(primary) + travel(family) [+ OSHC if not prepaid].
  - **CA study permit**: tuition year 1 + living (`E.official_living_figure_primary`, Quebec variant) + dependants add-on + travel; GIC amount shown as the SDS/legacy proof instrument where applicable, with its `valid_from`.
  - **UK Student**: maintenance (`E.maintenance_funds_by_location` × 9 months, London/outside) + first-year tuition − paid (CAS) + dependants × 9 months; funds held 28 consecutive days ending within 31 days of application (`E.funds_seasoning_days`, `E.funds_recency_days`).
  - **US F-1**: I-20 cost of attendance for 12 months (tuition + living + insurance + dependants) — no seasoning rule but liquidity evidence.
  - **DE**: blocked account annual amount (`E.blocked_account_amount`) or scholarship/sponsor declaration (Verpflichtungserklärung).
  - **NZ / IE / MY / AE / TH**: living-cost figure × months + tuition, per stored rule.
- Family composition drives which rows exist. School-age children (per `P.school_age_range_by_region`) add school-fee rows by region.
- Income alternative is shown only if `E.annual_income_alternative = true`; threshold picks single vs with-dependants.
- Conversion and fx as in view 2.

### Tri-state handling

`E.funds_seasoning_days = not_required` renders "No fixed holding period [n]". `unknown` renders `Not in the knowledge base` and the evidence-rules block says the rule could not be confirmed; the total is still computed from known components and suffixed `(excludes unknown components)`. Internal observations (`quotable=internal`) appear only in the collapsible internal block.

### Variant selection

`nationality` (origin) is mandatory: the evidence level / SDS / differentiation variant, travel component and document variants all key on it. `level` selects dependant eligibility and school-fee rows. `region` (state/province of campus) selects school fees and CA living figure (Quebec). `applicant_type` (onshore/offshore) changes the travel component and lodgement rule. Missing nationality → the view refuses to total and asks for it (`missing_destination`-style clarification), because the wrong nationality variant is a compliance error.

### Degradation

- Official figures known but institution tuition unknown → compute living + travel + insurance rows, mark tuition `Not in the knowledge base`, total suffixed.
- Only a live government page fetched this turn → all rows `live=true`, footer says `per immi.homeaffairs.gov.au today`, and the answer says the figure is not yet in the verified store.
- Policy change pending in the window (`W.policy_change_log` / `E.policy_effective_date` after today but before lodgement) → a banner row `Policy change: living-cost figure rises to AUD 31,000 from 2027-01-01 [n]; calculation shown for both`.

---

## View 4 — Comparison table

### Purpose

Answers "Deakin vs RMIT for IT", "Australia vs Canada for nursing", "Melbourne vs Adelaide cost", "which is cheaper with same PSW", "Monash Malaysia vs Monash Clayton", "UTS or UNSW for data science". Three variants: **course**, **institution**, **destination**.

- Stages: S2, S3, S4, S8, S15, S17.
- Intents: `comparative_decision` (primary), `university_selection`, `program_selection`, `alternative_pathways`, `migration_pathway` (destination variant).
- Task: `compare`.

### Mock (course variant)

> **Comparison — Master of IT, Nepal applicant, 2027 start** (criteria per playbook: cost, entry, work rights, PSW, PR pathway, course strength)
>
> | Criterion | Deakin — MIT (Burwood) | RMIT — Master of IT (City) | UniSA — Master of IT (Mawson Lakes, regional Cat 2) |
> |---|---|---|---|
> | Tuition, year 1 (2027, international) | AUD 40,600 [1] · 2026-08-12 | AUD 42,240 [4] · 2026-08-05 | AUD 37,900 [8] · 2026-07-22 |
> | Living cost (city, official visa figure applies nationwide) | Melbourne est. AUD 24,400/yr [6] (third-party, not yet verified) | Melbourne est. AUD 24,400/yr [6] | Adelaide est. AUD 21,100/yr [6] |
> | Entry — academic (NP) | 60 % TU bachelor [2] | 65 % or GPA 2.5/4 [5] | Not in the knowledge base |
> | Entry — English | IELTS 6.5, no band < 6.0 [3] | IELTS 6.5, no band < 6.0 [5] | IELTS 6.5, R/W 6.5 [8] |
> | Work rights while studying | 48 h/fortnight in term, unlimited in breaks (AU-wide) [7] · 2026-07-01 | same [7] | same [7] |
> | Post-study work (485) | 2 years (masters coursework, metro) [9] · 2026-07-01 | 2 years [9] | 2 years + 1 year regional extension (Cat 2 campus) [9][10] |
> | PR relevance | ANZSCO 261313 Software Engineer on MLTSSL [11]; state nomination VIC: medium demand [12] · 2026-06 | same occupation [11]; VIC [12] | same occupation [11]; SA nomination: high demand for ICT [13] · 2026-06; +5 regional-study points [14] |
> | Course strength | QS subject CS 2026: 201–250 [15] | QS subject CS 2026: 151–200 [15] | QS subject CS 2026: 301–350 [15] |
> | Scholarship | 20 % VC International, auto-assessed [3] | 25 % Future Leaders, application required [4] | Not in the knowledge base |
> | Derived — 2-year total (tuition + official living + OSHC) | AUD 143,900 | AUD 147,200 | AUD 138,300 |
>
> **Recommendation aligned to the stated priority (PR within budget):** UniSA — lowest total, regional 485 extension and +5 points, strong SA state-nomination signal; entry cut-off must be confirmed (unknown). If ranking matters more, RMIT.
>
> Not in the knowledge base: UniSA academic cut-off for TU graduates; UniSA international scholarships for 2027.

### Attributes consumed

Per criterion, the same attributes as the single-entity views: cost (view 2 set), entry (view 1 set), work rights (`E.work_hours_term`, `E.work_hours_break`, seed `work_hours_allowed_per_week`), PSW (`F.psw_length_by_level`, `F.psw_regional_extension`, seed `post_study_work_visa_485_years`, `pgwp_length_months`, `graduate_route_length_years`, `opt_length_months`), PR (`G.occupation_code` via `CourseOccupation`, seed `anzsco_occupation_codes`, `noc_codes`, `skilled_occupation_list_status`, `on_sol`, `state_nomination_demand`, `pnp_in_demand_provinces`, `green_list_status`, `regional_study_points`), course strength (`B.ranking_band_summary` with year, `B.qs_subject_ranks`, `B.qilt_overall_experience_pct`, `G.graduate_employment_rate`, seed `average_graduate_salary`), scholarship (view 11 set), `C.regional_category_au`, `C.campus_city_ref`, `W.destination_comparison_matrix` (pre-computed common pairs, destination variant), `W.min_english_realistic_floor`, `W.min_total_budget_first_year`.

Destination variant adds: `E.student_visa_fee`, `E.processing_time_official_range`, `E.grant_rate_by_nationality`, `E.dependents_allowed`, `W.caps_policy`, `F.pr_typical_years_by_route`, `W.local_language_requirement`, `W.tuition_free_public` (DE).

### Derivation

- Columns = the 2–4 entities named (or shortlisted by `university_selection`). Rows = the playbook's criteria (4–6) plus any criterion the counsellor named. Criteria order fixed: cost → entry → work rights → PSW → PR → strength → scholarship → derived total.
- Each cell is a single value with its own `[n]` and as-of; identical destination-wide values repeat with the same citation (never "same as left" without a citation).
- Derived rows (totals, deltas) cite the inputs and say `derived`.
- Recommendation: one sentence, aligned to the counsellor's stated priority; it may not rely on an `unknown` cell as a positive (it may name the unknown as the caveat).
- Destination variant: prefer `W.destination_comparison_matrix` if the pair is pre-computed and not stale; otherwise assemble live from E/F/W rows.

### Tri-state handling

`not_required` cells render `Not required [n]`. `unknown` cells render `Not in the knowledge base` (today's playbook says "not in the knowledge base" — same phrase, now literal) and the attribute × entity pair is added to the Coverage notice. A column with more than half its cells unknown is kept but the recommendation says the entity cannot be ranked.

### Variant selection

Same axes as the underlying views, resolved per column; the header line states the shared axes (nationality, level, intake) once and per-column offerings in the column headers. Mixed levels (e.g. bachelor vs masters) are allowed only when the counsellor asked; the header then says `levels differ`.

### Degradation

- One entity has no record → its column is kept with every cell `Not in the knowledge base` and the recommendation excludes it; the research notes say what search was tried.
- Rankings absent → row dropped only if absent for all columns; otherwise shown with unknowns.
- More than 4 entities requested → first 4 in the table, the rest named under "not compared (limit 4)".

---

## View 5 — Backward timeline to an intake

### Purpose

Answers "Can I still make Feb 2027?", "when should I apply", "is July intake possible", "visa kati din lagcha", "when to book IELTS", "what is the last date", "what if the policy changes in January".

- Stages: S7, S10, S19, S1.
- Intents: `strategic_planning` (primary), `application_process`, `visa_risk_analysis`, `alternative_pathways` (next intake), `test_preparation` (test-date step).
- Flags: `urgent_timeline`, `needs_structured_guidance`.

### Mock

> **Backward timeline — Deakin Master of IT, Trimester 1 2027 (classes start 2027-03-08 [1] · 2026-08-12), Nepal applicant, today 2026-09-07**
>
> | Step | Rule used | Date | Source · as of |
> |---|---|---|---|
> | Classes start | `T.term_start_date` | 2027-03-08 | [1] · 2026-08-12 |
> | Orientation (recommended arrival by) | orientation week begins 2027-03-01; latest arrival = census date 2027-03-26 [1] | arrive by 2027-03-01 | [1] |
> | Visa grant needed by | arrival − 7 days travel/booking buffer (derived) | 2027-02-22 | derived |
> | Visa lodgement by | grant − observed KTM processing for 500 higher-ed, Level-1 provider: 90 % in 6 weeks [5] · 2026-08-01 (official: 75 % in 4 weeks [5]); planning uses the observed 6 weeks | 2027-01-11 | [5] |
> | CoE issued by | lodgement − 5 working days admin buffer (derived); CoE issued 2–5 working days after deposit and GS clearance [2] | 2027-01-04 | [2] · 2026-07-30 |
> | Deposit + OSHC paid by | Deakin offer acceptance deadline: 4 weeks from offer or 2027-01-15, whichever earlier [2]; NRB foreign-exchange approval for tuition remittance typically 3–5 working days [10] (Agency entry) | 2026-12-24 | [2][10] |
> | Unconditional offer received by | deposit − 14 days to arrange loan/remittance (derived) | 2026-12-10 | derived |
> | Application lodged by | offer turnaround, partner channel: 10 working days [2]; international application closing date 2027-T1: 2027-01-31 [1] — the turnaround, not the closing date, binds here | 2026-11-26 | [1][2] |
> | Documents ready (transcripts, MOI/IELTS, SOP/GS draft, passport) | application − 2 weeks preparation (derived) | 2026-11-12 | derived |
> | English test sat by | result 3–5 days (IELTS computer) [6]; test dates in Kathmandu 3× weekly [6] · live 2026-09-07 | 2026-11-07 | [6] |
>
> **Slack: 9 weeks** between today and the first hard step (test by 2026-11-07). **Binding constraint:** visa processing (6 weeks observed).
> **Policy dates in the window:** subclass 500 visa fee changes 2027-01-01 [7] · 2026-06-15 — lodging before that date saves AUD 400 (derived) but the CoE step then moves to 2026-12-22.
> **Fallback intake:** Trimester 2 2027 starts 2027-07-12 [1]; application close 2027-06-04 [1].
>
> This week: book the IELTS date. (Single action, per playbook.)
>
> Not in the knowledge base: Deakin GS interview lead time for Nepal applicants; whether OSHC must be paid before CoE at Deakin.

### Attributes consumed

`T.term_start_date`, `T.orientation_period`, `M.orientation_mandatory`, `T.census_date`, `T.latest_arrival_date`, `T.application_open_date_international`, `T.application_close_date_international`, `T.scholarship_application_deadline`, `T.deposit_deadline`, `T.enrolment_confirmation_latest_issue_date`, `T.recommended_visa_lodge_by`, `T.intake_status`, `T.intake_status_as_of`, `T.backward_timeline_template`, `T.institution_shutdown_periods`, `T.public_holidays_destination`, `T.public_holidays_origin` (Dashain/Tihar closures of banks and offices), `B.offer_turnaround_days`, `B.partner_priority_offer_turnaround_days` (seed `offer_turnaround_days`), `B.offer_validity_days`, `B.deposit_policy`, `K.enrolment_document_type` (CoE/CAS/I-20/LOA/Zulassung/EMGS), `K.enrolment_document_issuance_lead_days`, `K.enrolment_document_prerequisites[]` (deposit, OSHC, GS interview, financial pre-check), `K.credential_evaluation_weeks` (WES/ECCTIS/VPD where required), `K.atas_required`, `E.processing_time_official_range` (seed `visa_processing_time_weeks`), `E.processing_time_observed_origin` (`quotable=internal`), `E.processing_time_observed_as_of`, `E.apply_arrive_window_rule` (e.g. US ≤30 days before I-20 start; CA/UK earliest-entry rules), `E.visa_lodgement_channel`, `E.biometrics_appointment_lead_days`, `E.health_exam_lead_days`, `I.test_result_days`, `I.test_frequency`, `I.test_upcoming_dates` (live), `K.accepted_payment_methods`, `L.origin_fx_remittance_limit` (NRB approval, LRS/TCS, BD student file) and their lead times, `W.policy_change_log`, `E.policy_effective_date`, `X.internal_submission_deadlines`, `X.pre_departure_sessions`.

### Derivation

- Work backward from `T.term_start_date` (or orientation if mandatory): each step = next step's date − lead time. Lead times come from stored attributes; where none exists a fixed buffer is used and labelled `derived` with the buffer stated.
- Processing time: use observed origin-specific time when stored and fresher than 90 days, else the official range's upper percentile; the row says which.
- Holidays: shift any date that lands on `T.public_holidays_*` or inside `T.institution_shutdown_periods` earlier to the last working day, noting the shift.
- Slack = first hard step date − today. Negative slack → header `Intake not reachable on the stored lead times`, and the view renders the same table for `T.term_start_date` instead, plus the current intake table for reference.
- Binding constraint = the step with the longest lead time.
- Policy window: list every `W.policy_change_log` / `E.policy_effective_date` entry between today and course start that touches an attribute used in views 2, 3, 5 or 6; state the effect and whether re-sequencing avoids it.
- Last date where `T.intake_status ∈ {closing, full, waitlist, cap}`: banner `Intake status: <status> as of <date> [n]` above the table.

### Tri-state handling

A prerequisite with `not_required` (e.g. GS interview not required at this provider) drops the row and says so under the table. `unknown` lead times use the generic buffer and the row's rule column says `lead time not in the knowledge base — 5 working-day buffer assumed`; the attribute is added to the Coverage notice. Dates are never left blank.

### Variant selection

`intake` is mandatory (target term); if not stated, the next intake with `T.intake_status=open` is used and named. `offering` picks the campus calendar; `nationality` picks processing time and document lead times; `level` picks the enrolment document lead time; `applicant_type` (onshore/offshore) changes the lodgement channel and the arrival rows (onshore students have no arrival step).

### Degradation

- No intake calendar → the view uses `ProgramRecord.intakes` months as month-level anchors ("March 2027") and marks every date `month-level only`; the Coverage notice lists the calendar.
- No processing time → official range from a live government fetch this turn (`live=true`), else `Not in the knowledge base` and the timeline stops at "visa lodgement — lead time unknown".
- Student already onshore (`already_abroad`) → arrival, travel and medical rows dropped; onshore lodgement rule used.

---

## View 6 — PR / points estimate

### Purpose

Answers "PR kati points cha?", "will I get 65 points", "does regional study help", "CRS score with this profile", "which occupation is on the list", "how many years to PR", "does NAATI add points", "is my course PGWP eligible".

- Stages: S15, S2, S3, S16.
- Intents: `migration_pathway` (primary), `career_roi`, `comparative_decision`, `program_selection`.
- Disclaimer: `DISCLAIMER_INTENTS.migration_pathway` is always appended; every row is `quotable=disclaimer`.

### Mock

> **Points estimate — Australia, Skilled Independent (subclass 189) — illustrative, general information only**
> Profile as given: age 24 at course completion (26 at projected invitation) · Master of IT (AQF 9) · IELTS 6.5 now; target PTE 79 (Superior) · occupation ANZSCO 261313 Software Engineer, MLTSSL [11] · 2026-07-01 · no skilled experience · study in Melbourne (metro) · no partner · no NAATI · no PY yet.
> Points table version: effective 2026-07-01 [14].
>
> | Factor | Rule | Now | With plan (PTE 79 + PY + NAATI) | Source |
> |---|---|---|---|---|
> | Age 25–32 | 30 | 30 | 30 | [14] |
> | English | Competent 0 / Proficient 10 / Superior 20 | 0 (6.5 = Competent) | 20 | [14] |
> | Qualification | Australian masters (AQF 9): 15 | 15 | 15 | [14] |
> | Australian study requirement | 2 academic years in AU: 5 | 5 | 5 | [14] |
> | Regional study | 5 if the campus is regional | 0 (Burwood is metro, Cat 1 city) [10] | 0 | [10][14] |
> | Specialist education (STEM research masters/PhD) | 10 | 0 (coursework masters) | 0 | [14] |
> | Professional Year | 5 | 0 | 5 (ACS PY available for 261313 [16]) | [14][16] |
> | NAATI CCL | 5 | 0 | 5 (Nepali CCL offered [17]) | [14][17] |
> | Skilled employment | 0–20 | 0 | 0 | [14] |
> | Partner | 10 / 5 / 10 (single) | 10 (single) | 10 | [14] |
> | **Total (derived)** | | **60** | **90** | |
>
> Recent invitation rounds, 261313 (per Home Affairs round results [18] · 2026-08-15): 189 minimum invited 85–90; 190 VIC nominated ICT: state requires 65 + VIC EOI [12] · 2026-06.
> Skills assessment: ACS, AU masters + PY route; fee AUD 550; 8–10 weeks [16] · 2026-05-01.
> Typical years to PR via this route (derived from `F.pr_typical_years_by_route`, assumptions listed there): 3–5 years after graduation [19] — not a guarantee; lists and points change [19].
> Course choice matters: a regional campus adds 5 points and one extra 485 year [10][14].
>
> Case-specific migration advice must be confirmed by a MARN-registered migration agent.
>
> Not in the knowledge base: VIC state nomination minimum points for 2026-27; PTE-to-IELTS mapping the department uses for "Superior".

### Attributes consumed

`F.points_age_table`, `F.points_english_table`, `F.points_qualification_table`, `F.points_skilled_employment_table`, `F.points_partner_table` (factor × band × points, with `effective_date`), `F.points_table_effective_date`, `F.crs_factor_table` (CA), `F.ee_category_draw_list` (CA), `F.ee_draw_recent_cutoffs` (by occupation/stream, dated), `F.state_nomination_occupation_list` (open/closed, conditions), `F.regional_491_conditions` (491/DAMA), `F.employer_sponsored_visa_name` (482/SID, Skilled Worker, LMIA, H-1B, Blue Card) with salary thresholds, `F.pr_typical_years_by_route`, `F.pr_route_assumptions`, `F.age_points_decline_curve`, `F.citizenship_residency_years`, `F.migration_advice_disclaimer_required`, `F.psw_eligibility_for_course` (derived), seed `pr_points_study_level`, `regional_study_points`, `specified_stem_qualification_points`, `professional_year_eligible`, `skills_assessment_authority`, `express_entry_crs_category`, `pnp_in_demand_provinces`, `smc_points_relevance`, `green_card_pathway_relevance`; `G.occupation_code`, `G.occupation_list_membership` (`valid_from/to`), `G.skills_assessment_requirements`, `G.skills_assessment_fee`, `G.skills_assessment_processing_weeks`, `G.professional_year_program_name`, `G.professional_year_cost`, `G.state_nomination_demand` (seed), `CourseOccupation` mapping, `C.regional_category_au`, `I.english_equivalence_table` (English band mapping), `I.naati_ccl_languages_available`, `I.naati_ccl_points_reference`, `F.psw_age_max` (485 ≤ 35).

### Derivation

- Points = Σ over factors of `F.points_table[factor][band matching profile]`, using the table whose `effective_date ≤ projected assessment date`. If the counsellor gave a target date after a known future table, compute against that table and say so.
- Two columns: **Now** (profile as stated) and **With plan** (only steps the counsellor named or the playbook's standard levers: English uplift, PY, NAATI, regional study). Each lever cites the attribute proving availability (`G.professional_year_program_name`, `I.naati_ccl_languages_available`).
- Age band uses age at the projected invitation date if a timeline exists (from view 5 plus course months), else current age, stated.
- English band uses `I.english_equivalence_table` only when the destination's own mapping is stored; otherwise the row is `unknown`.
- Compare total to `F.ee_draw_recent_cutoffs` for the occupation and stream; the sentence says "recent rounds", never "you will be invited".
- CA variant: CRS core factors + skill transferability + additional (Canadian study, sibling, French) → total vs recent draw cut-offs per `F.ee_category_draw_list`; PGWP eligibility from `F.psw_eligibility_for_course` (field-of-study list × CIP × level) shown as a gate row before any points.
- UK/US/DE/IE/NZ variants: no points table; the view becomes a route card (Graduate Route → Skilled Worker with `skilled_worker_salary_threshold`; OPT → H-1B lottery; 18-month job-seeker → Blue Card; Stamp 1G → CSEP; NZ Green List tier) with the same "typical years" and disclaimer rows.

### Tri-state handling

Any factor whose rule is `unknown` renders `Not in the knowledge base` in the rule column and is excluded from the total; the total is suffixed `(n factors unknown)`. A factor that does not apply (e.g. partner points for a single applicant) is a positive band with points, not unknown. `G.occupation_list_membership` with `valid_to` past → occupation row shows `was on MLTSSL until <date> [n]; current status not in the knowledge base`.

### Variant selection

Destination + subclass/stream are mandatory; if the counsellor named only "PR in Australia", use 189 and 190 for the campus state and say so. `level` selects qualification and study-requirement points and PSW length; `region` (campus state) selects state nomination and regional points; `nationality` matters only for NAATI language availability and US/UK nuances.

### Degradation

- No points table stored → no table; a route paragraph from E/F prose rows, and the Coverage notice lists the table. Never reconstruct a points table from memory.
- Occupation mapping missing (`CourseOccupation` empty) → the occupation row asks the counsellor for the intended ANZSCO/NOC and the view computes everything else.
- Table stored but `review_due_at` overdue → compute, prefix the total with `⚠ points table review overdue (as of <date>)`.

---

## View 7 — Pathway map (direct vs packaged)

### Purpose

Answers "diploma to degree possible?", "packaged offer with English", "foundation or direct bachelor", "how many weeks of ELICOS for 5.5", "does the diploma count as year 1", "single CoE or two", "does the pathway keep 485 eligibility", "Navitas college then university?".

- Stages: S3, S6, S17, S18.
- Intents: `alternative_pathways` (primary), `program_selection`, `eligibility_check`, `test_preparation`, `strategic_planning`.

### Mock

> **Pathway map — Bachelor of Nursing, Nepal applicant with NEB +2 GPA 2.9, IELTS 6.0 (no band < 5.5)**
>
> ```
> Direct entry (not eligible now: needs GPA 3.0 [1] and IELTS 7.0 no band < 7.0 [2])
>   ├─ Route A — Packaged ELICOS + Bachelor: 20 weeks English (1 band = 20 wk at 10 wk per 0.5 band [3]) → Bachelor of Nursing y1
>   │    still requires GPA 3.0 → NOT available (academic gap not covered by ELICOS)
>   ├─ Route B — Diploma of Nursing (CTEVT-equivalent VET, 18 months, TAFE partner) → Bachelor of Nursing year 2 with 1 year credit [4]
>   │    entry: NEB GPA 2.4 [5], IELTS 6.5 / OET B for the diploma [5]; +10 weeks ELICOS packaged [3]
>   └─ Route C — Foundation (Health stream, 12 months) → Bachelor of Nursing year 1 with guaranteed progression at GPA ≥ 60 % [6]
>        entry: NEB GPA 2.5 [6], IELTS 5.5 no band < 5.0 [6] — meets now
> ```
>
> | | Direct | Route B (Diploma → y2) | Route C (Foundation → y1) |
> |---|---|---|---|
> | Time to degree | 3 y | 1.5 y + 2 y = 3.5 y (+0.5 y) | 1 y + 3 y = 4 y (+1 y) |
> | Tuition (derived) | AUD 118,500 [1] | AUD 28,000 [5] + 79,000 (2 y at 39,500 [1]) = AUD 107,000 (−11,500) | AUD 31,000 [6] + 118,500 = AUD 149,500 (+31,000) |
> | ELICOS needed | 1 band → 20 wk, AUD 9,400 (AUD 470/wk [3]) | 0.5 band → 10 wk, AUD 4,700 [3] | none |
> | Packaging | — | single CoE package with packaged provider Navitas [4] | two CoEs, same campus [6] |
> | Guaranteed progression | — | credit agreement; progression subject to diploma completion [4] | guaranteed at ≥ 60 % [6] |
> | 485 eligibility preserved | yes (bachelor) | yes — bachelor completed in AU meets the 2-year study requirement [7] | yes [7] |
> | Registration outcome | NMBA entry-to-practice [8] | same, via the bachelor [8] | same [8] |
> | Visa note | — | packaged VET + higher-ed: GS assessed on the full package [9] | — |
>
> **Realistic option today: Route C** (eligible now, guaranteed progression) unless the +1 year cost matters more, in which case Route B after a 10-week ELICOS.
>
> Not in the knowledge base: whether the Diploma of Nursing credit is 1 full year for the 2027 intake; foundation exit-GPA definition (semester vs cumulative).

### Attributes consumed

`J.pathway_type`, `J.from_qualification`, `J.to_course_ref`, `J.credit_granted_units`, `J.entry_year_into_destination`, `J.guaranteed_progression`, `J.progression_gpa_min`, `J.pathway_provider` (seed `english_pathway_provider`), `J.same_campus`, `J.pathway_duration`, `J.pathway_stage_tuition`, `J.time_delta_vs_direct_months`, `J.cost_delta_vs_direct`, `J.single_visa_packaging`, `J.psw_eligibility_preserved`, `J.twinning_partner_institution`, `J.transfer_to_partner_country_rules`, `J.agreement_url`, `J.total_cost_via_pathway` (derived), seed `packaged_english_pathway_available`, `english_pathway_length_weeks`, `conditional_offer_available`; `I.pathway_weeks_per_half_band`, `I.pathway_max_weeks`, `I.pathway_fee_per_week`, `I.pathway_exit_assessment`, `I.pathway_direct_entry_on_completion` (no exit test); `A.min_gpa_normalized` etc. for each node (view 1 set), `A.awarding_body`, `F.psw_length_by_level`, `F.psw_eligibility_for_course`, `S.course_leads_to_registration`, `E.genuine_intent_package_assessment_rule`, `U.qualification_equivalence` (CTEVT ↔ VET).

### Derivation

- Nodes = the direct course plus every `PathwayArticulation` whose `to_course` is the target and whose `from_qualification` the student holds or can obtain. Each node runs view 1 silently; only nodes where the student meets or can reach the entry (with ELICOS for English only) are drawn as available.
- ELICOS weeks = (required band − student band) ÷ 0.5 × `I.pathway_weeks_per_half_band`, capped by `I.pathway_max_weeks`; uses the *lowest* band deficit across overall and sections (the worst section governs). ELICOS never fixes an academic gap — the tree says so explicitly.
- Time to degree = pathway months + degree months − credit months; delta vs direct labelled.
- Cost = pathway tuition + degree tuition for the remaining years (year-specific rates if stored, else indexed as in view 2) + ELICOS fee; delta vs direct.
- PSW preserved from `J.psw_eligibility_preserved`, cross-checked with `F.psw_eligibility_for_course` on the exit qualification.
- Recommendation: the eligible route with the lowest (time delta, cost delta) unless the counsellor stated a different priority.

### Tri-state handling

`J.guaranteed_progression = not_required` is not a valid value (it is boolean); `unknown` renders `Not in the knowledge base` in the row. An articulation with unknown credit is drawn but its time and cost cells say `credit not in the knowledge base` and no delta is computed for that route.

### Variant selection

`nationality` for entry rules; `level` fixed by the target degree; `offering` = the target campus, and only articulations with `J.same_campus=true` or explicit cross-campus agreements are drawn; `intake` picks whether the pathway start aligns (pathway intake + duration must land on a degree intake — if not, add waiting months to the time delta, labelled).

### Degradation

- No `PathwayArticulation` rows → draw the direct node with its verdict and list pathway courses at the same institution by level (`A.level ∈ {foundation, diploma}`) as "candidate pathways — articulation not in the knowledge base".
- No ELICOS rule → ELICOS row `Not in the knowledge base`, and the English gap is stated without weeks.

---

## View 8 — Risk & alternatives panel

### Purpose

Answers "my student got refused for Canada, now what", "Is Canada closed now?", "if Australia visa is risky which country", "cheaper same course", "next intake if we miss", "low GS risk providers", "student has a PIC 4020 concern", "backup plan".

- Stages: S17 (primary), S10, S19, S2.
- Intents: `alternative_pathways`, `visa_risk_analysis`, `anxiety_reassurance` (facts only), `comparative_decision`, `strategic_planning`.
- Flags: `prior_visa_refusal`, `financial_constraint`, `study_gap`, `profile_weakness`, `urgent_timeline`, `age_concern`.

### Mock

> **Risk & alternatives — Nepal applicant, prior Canada study-permit refusal (2026-04, financial grounds), targeting IT masters, budget ≈ NPR 50 lakh/yr**
>
> **Risk factors present and what the rules say**
> | Factor | Rule / evidence | Mitigation | Source · as of |
> |---|---|---|---|
> | Prior refusal (CA, financial) | AU: must be declared; GS assesses immigration history [5]; not a bar in itself [5] | Address in GS statement with the changed circumstance (loan sanction now in place) [5] | [5] · 2026-07-01 |
> | Financial evidence | Budget covers year-1 cash for Adelaide (AUD 66,400 derived, view 2) but not Melbourne (75,300) | Regional city or lower-tuition provider | derived |
> | Provider risk level | Deakin Level 1 [5]; RMIT Level 1 [5]; Provider X Level 3 — funds and English evidence mandatory [5] | Prefer Level 1–2 providers for this profile | [5] · 2026-07-01 |
> | Grant-rate signal | AU 500 higher-ed grant rate, Nepal, FY2025-26: 74 % [13] · 2026-08 (official) | — | [13] |
> | Fraud bar | PIC 4020: not triggered by a refusal on genuineness or funds; only by false documents [5] | Confirm the CA refusal letter cites no misrepresentation | [5] |
>
> **Alternatives**
> | Option | Why it fits | Cost delta vs Deakin (derived) | Timing | Source |
> |---|---|---|---|---|
> | UniSA Master of IT, Adelaide (regional Cat 2) | Lower tuition, +1 y 485, budget fits [8] | −AUD 8,900 first year | 2027-T1 open [8] · 2026-07-22 | [8][10] |
> | UK — MSc Computer Science, Coventry (1 y) | 1-year masters; Graduate Route 2 y [20]; no evidence-level system; refusal history disclosed but weighed differently [21] | −AUD 31,000 total (derived, GBP 17,900 [20] at 1.93 AUD/GBP fx 2026-09-01) | Jan 2027 and Sep 2027 [20] · 2026-08-20 | [20][21] |
> | Same course, next intake | Trimester 2 2027 (2027-07-12) [1] gives 4 more months to season funds | 0 | close 2027-06-04 [1] | [1] |
> | Re-apply Canada | New PAL year quota; refusal reasons must be resolved; Not in the knowledge base: current Nepal approval rate | — | — | |
>
> Internal — do not quote to student: Provider X refusals for Nepal files since 2026-01 noted by KTM branch [12].
>
> Case-specific visa advice must be confirmed by a MARN-registered migration agent.
>
> Not in the knowledge base: Canada study-permit approval rate for Nepal 2026; IRCC treatment of a prior refusal on re-application.

### Attributes consumed

`E.common_refusal_grounds[]`, `E.grant_rate_by_nationality` + period, `E.appeal_body`, `E.appeal_fee`, `E.reapply_rules`, `E.fraud_bars` (PIC 4020, CA 5-yr, UK 10-yr), `E.genuine_intent_test` (GS/GTE/SOP/credibility/F-1), `E.genuine_intent_factors[]`, `E.evidence_level_by_provider`, `B.visa_risk_rating`, `B.notable_risks[]`, `B.gs_top_ranked_flag`, `B.hpi_eligible`, `B.cap_allocation`, `W.caps_policy` with dates, `W.policy_change_log`, `E.onshore_switching_rules`, `E.change_provider_rules`, `T.term_start_date`, `T.intake_status`, `T.application_close_date_international`, view 2 attributes for cost deltas, view 4 destination attributes, `F.psw_length_by_level`, `F.psw_regional_extension`, `C.regional_category_au`, `W.destination_comparison_matrix`, `E.processing_time_observed_origin` (internal), `X.readiness_checklist` (per destination/level).

### Derivation

- Risk rows = each `CONTEXT_FLAG` present ∪ each `E.genuine_intent_factors[]` the profile trips, with the rule that names it and the mitigation the rule or agency checklist states. No probability, no "high/low chance" — only the factor, the rule, the mitigation (playbook: "Do not quote a probability").
- Alternatives are generated along four axes and the panel shows the best of each: (a) same destination, cheaper/regional/lower-risk provider (view 4 on filtered candidates), (b) different destination with `E.dependents_allowed`, `E.visa_processing_time_weeks`, `E.grant_rate_by_nationality` and cost within budget, (c) same course, next intake (view 5 for the next intake), (d) pathway route (view 7). Each carries a derived cost delta and timing.
- Budget check: counsellor-stated budget converted at `W.fx_rate_indicative` against view 2 first-year cash for each option; "fits / short by" stated.

### Tri-state handling

`E.fraud_bars` explicitly `not_required`/not triggered → stated as a positive with citation. Unknown grant rates render `Not in the knowledge base` in the cell and the Coverage notice; the alternative row is still listed but ranked below options with known rates.

### Variant selection

`nationality` for grant rates, evidence rules and document variants; `level` for dependant/PSW rows; `region` for regional options; `applicant_type` onshore/offshore for switching rules.

### Degradation

- No risk-factor rules stored → show only the alternatives table; the risk table is replaced by `Not in the knowledge base: refusal factors for <destination>`; research notes appended.
- No candidates within budget → say so and show the cheapest known option with its shortfall.

---

## View 9 — Provenance footer (present on every answer)

### Purpose

Answers the S20 questions "how sure are we", "where is this from", "when was it checked", "is this the university's own page", and supports rule 4b and the app's source panel. Rendered on every answer, in every view, including drafts (as `Sources:`).

- Stages: S20 (always).
- Intents: all 29.

### Mock

> ---
> **Sources used**
> | [n] | Source | Type · reliability | As of | Verified | Notes |
> |---|---|---|---|---|---|
> | [1] | deakin.edu.au — Master of Information Technology, fees & intakes | partner:deakin · institution page | extracted 2026-08-12 | not human-verified | fee year 2027 |
> | [2] | deakin.edu.au — International entry requirements by country (Nepal) | partner:deakin · institution page | extracted 2026-07-30 | verified by partnerships 2026-08-02 (rep email) | variant: nationality=NP |
> | [3] | deakin.edu.au — English language requirements | partner:deakin · institution page | extracted 2026-07-30 | not human-verified | |
> | [5] | immi.homeaffairs.gov.au — Student visa (subclass 500) financial capacity | live:immi.homeaffairs.gov.au · official | fetched 2026-09-07 10:42 | live this turn | supersedes indexed value 2026-05-10 (AUD 29,710 unchanged) |
> | [6] | numbeo-style cost dataset — Melbourne | third-party dataset | dataset 2026-06-30 | not verified against the university | rule 4b flag |
> | [8] | Expert Education — KTM panel clinic fees (admin entry) | agency:admin_entry · rep-confirmed | entered 2026-03-15 by branch_ops | review due 2026-09-15 ⚠ | |
> | [12] | Expert Education — KTM branch observations | agency:internal · unverified | 2026-08-01 | internal — do not quote | |
> | derived | first-year cash, totals, timeline dates, points | computed from [1][2][5][6][7][8] | this turn | — | formulas in the view |
>
> Conflicts: none. · Review overdue: [8]. · Live sources preferred over indexed where they disagreed: none.
> Visa and migration content is general information; a MARN-registered agent must confirm case-specific decisions.

### Attributes consumed

`V.source_url`, `V.source_type`, `V.source_quote`, `V.extracted_at`, `V.extraction_model`, `V.confidence`, `V.reliability_tier`, `V.verified_by`, `V.verified_at`, `V.verification_method`, `V.valid_from`, `V.valid_to`, `V.applies_to` (variant axes), `V.superseded_by`, `V.conflicts[]` with resolution rule, `V.change_history[]`, `V.review_due_at`, `V.refresh_cadence`, `V.staleness_max_age_days`, `V.quotable_to_students`, `V.fx_as_of`, `V.source_page_language`; today's `Source` fields (`n`, `url`, `title`, `section`, `excerpt`, `docType`, `country`, `source`, `sourceKind`, `live`, `kind`, `score`, `fetchedAt`).

### Derivation

- Rows = `citedSources(answer, sources)` in first-citation order (today's function), plus one `derived` row when any derived figure appears.
- Reliability tier from `V.reliability_tier`; when absent, map today's `source` prefix: `live:<gov host>` / indexed gov host → official; `partner:` → institution page; `experteducation.com` → agency public; `upload:` → agency document (tier depends on `docType`); `web:` → third-party.
- As-of = `V.verified_at` if human-verified, else `V.extracted_at`, else `fetchedAt` (live). Live rows say `fetched <timestamp>` and `live this turn`.
- Conflicts line lists every `V.conflicts[]` touched, with the resolution rule applied (reliability → recency → live).
- Review overdue lists rows with `V.review_due_at < today`; expired (`valid_to < today`) rows never reach the answer and are listed in the Coverage notice instead.
- The MARN sentence appears when any cited value is `quotable=disclaimer` or the intent is in `DISCLAIMER_INTENTS`.
- Drafts (task `draft`): the footer collapses to today's `Sources: [n][m]` line after the drafted text (rule 6), and `citedSources(..., {strict:true})` so nothing unrelated is listed.

### Tri-state / degradation

Footer never says "no sources" silently: with zero excerpts (`NO_CONTEXT_NOTE` path) the footer is a single line `No knowledge-base excerpts were used for this answer` and the Coverage notice carries the whole question. With `NO_RESEARCH_NOTE` (drafting from supplied facts) the footer says `Based on facts supplied by the consultant in this conversation`.

---

## View 10 — Coverage notice

### Purpose

Makes today's rule 3 (`Not in the knowledge base:`) structured and exhaustive: every attribute the selected view(s) needed and could not fill, generated from the per-institution/course coverage report (`V.source_coverage_report`) rather than from the model's recollection of what it did not find. Also answers S20 "what don't we know about X", and shows the data team what to collect next.

- Stages: S20, and appended to any view with an unknown.
- Intents: all 29.

### Mock

> **Not in the knowledge base:**
> - Deakin University — backlog policy for Tribhuvan University graduates (`A.backlog_acceptance_max`, variant: nationality=NP) — last checked 2026-07-30, not on the international entry page [2]
> - Deakin University — Master of IT — prerequisite subjects for the 1.5-year stream (`A.prerequisite_subjects`) — never collected
> - Australia — VFS Kathmandu biometrics fee (`E.biometrics_fee`, variant: nationality=NP) — never collected
> - Melbourne — textbook allowance (`D.textbooks_annual`) — never collected
> - **Expired:** Australia — subclass 500 visa fee AUD 1,600 (`E.student_visa_fee`) valid to 2026-06-30 [old 4]; current value fetched live [5]
> - **Nearest variant used:** Deakin — English minimum shown is the generic international value; Nepal-specific value not stored (`I.english_overall_min`, nationality=NP)
>
> Research this turn: search_knowledge_base ×2 (deakin, "backlog"), search_programs ×1, web_search ×1 ("Deakin backlog policy international") — no result. (`{{research_notes}}`)
> Coverage for Deakin University: 71 % of Tier-1 attributes filled (as of 2026-09-06 coverage report).

### Attributes consumed

`V.source_coverage_report` (per institution/course: attribute → filled / unknown / expired / nearest-variant, with `last_checked_at`), `V.valid_to`, `V.applies_to`, `V.review_due_at`, the view's own attribute list (this file), `{{research_notes}}` from the research loop (`src/graph/research.ts`), `V.coverage_pct`.

### Derivation

- Set difference: (attributes the rendered views consumed) − (attributes with a usable value for the selected variant). Each item states entity, human label, catalog id in code font, variant, and the reason: `not on the page (last checked <date>) [n]`, `never collected`, `expired (was <value>, valid to <date>)`, `nearest variant used`.
- Ordering: items that changed a verdict or total first, then expired, then nearest-variant, then the rest.
- Appends the research trail so a counsellor knows a live lookup was tried (avoids "did you even search?").
- Coverage percentage is informational; only when `V.source_coverage_report` exists for the entity.

### Rendering rule

The heading is always the literal string `Not in the knowledge base:` (rule 3 depends on that phrase). Even when nothing is missing, the model does not emit the heading; the UI hides the notice. A `General note, unsourced:` sentence (rule 3) may follow the list, at most one sentence.

---

## View 11 — Scholarship match list

### Purpose

Answers "any scholarship for Nepali students", "how much waiver can I get", "is it automatic", "separate application?", "deadline for scholarship", "can I stack them", "does it cover living", "PhD funding".

- Stages: S9 (primary), S8, S4, S18.
- Intents: `scholarship_funding` (primary), `financial_viability`, `university_selection`, `comparative_decision`.

### Mock

> **Scholarship matches — Deakin Master of IT, Nepal applicant, TU 64 % (≈ WAM 62), 2027-T1**
>
> | Scholarship | Coverage | Eligibility vs profile | Application | Deadline | Competitiveness | Source · as of |
> |---|---|---|---|---|---|---|
> | Deakin Vice-Chancellor's International Scholarship | 50 % or 100 % tuition, all years, renewal WAM 65 [3] | WAM ≥ 85 required [3] → **does not meet** (62) | separate application [3] | 2026-11-30 for T1 2027 [3] | competitive [3] | [3] · 2026-08-01 |
> | Deakin International Scholarship | 25 % tuition, all years, renewal WAM 65 [3] | WAM ≥ 65 [3] → **short by 3 pp** (62) | auto-assessed with admission [3] | none — with offer [3] | likely if eligible [3] | [3] · 2026-08-01 |
> | Deakin South Asia Regional Bursary | AUD 5,000 first year [3] | Nationality ∈ {NP, IN, BD, LK, PK} [3]; level = postgraduate coursework [3] → **meets** | auto [3] | none [3] | automatic [3] | [3] · 2026-08-01 |
> | Destination Australia (govt, regional campuses only) | AUD 15,000/yr [22] | campus must be regional [22] → **does not apply** (Burwood metro) | via institution [22] | institution-set [22] | competitive [22] | [22] · 2026-05-01 |
> | Expert Education-negotiated fee waiver | Not in the knowledge base (commercial terms out of scope; public fact only: waiver exists y/n = unknown) | | | | | |
>
> **Stackable:** the regional bursary can be combined with one merit scholarship [3]. **Best case with current profile (derived):** AUD 5,000 off year 1; **with WAM 65+:** 25 % (AUD 10,150/yr) + AUD 5,000.
> Strengthens an application (per the playbook): grades, early application, English score — the 50 % award weighs the personal statement [3].
> Scholarship Matcher (experteducation.com/scholarship-matcher) is a supplementary tool.
>
> Not in the knowledge base: whether the 25 % award requires a minimum English score; Expert-negotiated waivers for Deakin 2027.

### Attributes consumed

`H.scholarship_provider_type`, `H.scholarship_coverage_type`, `H.scholarship_coverage_pct`, `H.scholarship_amount_first_year`, `H.scholarship_amount_total`, `H.scholarship_duration_years`, `H.scholarship_renewable`, `H.scholarship_renewal_gpa_min`, `H.scholarship_eligible_levels`, `H.scholarship_eligible_disciplines`, `H.scholarship_eligible_nationalities`, `H.scholarship_eligible_campuses`, `H.scholarship_timing`, `H.scholarship_min_gpa`, `H.scholarship_min_percentage`, `H.scholarship_min_english_ielts_equivalent`, `H.scholarship_application_required`, `H.scholarship_separate_deadline`, `H.scholarship_early_bird_deadline`, `H.scholarship_number_available`, `H.scholarship_competitiveness` (auto/likely/competitive), `H.scholarship_stackable`, `H.scholarship_timing`, `H.scholarship_payment_method`, `H.scholarship_conditions_text`, `H.scholarship_official_url`, `H.sibling_discount_pct`, `H.govt_scholarship_scheme` (Chevening, Australia Awards, Fulbright, DAAD, GKS, GOI) with `living_coverage`, `return_home_bond`, `H.phd_scholarship_scheme` (RTP, UKRI, Vanier, DAAD) with `stipend`, `waiver`, `rounds`, `success_rate`, `H.scholarship_last_verified_at`, seed `scholarship_available`, `scholarship_amount`, `scholarship_type`, `scholarship_auto_awarded`, `scholarship_criteria`; `U.conversion_table_url` (to compare `H.scholarship_min_gpa` with the student's grade), `C.regional_category_au` (regional-only schemes), `T.scholarship_application_deadline`.

### Derivation

- Candidates = scholarships linked to the course, its institution, its level, its campus, its destination (government schemes) and the student's nationality. Filter out those whose `eligible_*` arrays exclude the profile; show excluded ones only when the counsellor named them or when they are the institution's headline award (to explain why not).
- Eligibility verdict per scholarship reuses view 1's grade conversion and margin logic against `H.min_gpa/min_percentage/min_english`; `does not apply` (axis exclusion) is distinct from `does not meet` (threshold) and `short by`.
- Best case = Σ of stackable awards the profile meets; second figure = with the smallest uplift that unlocks the next award, named.
- Deadline row cross-checks `T.scholarship_application_deadline`; if it precedes the application close date the view says "scholarship deadline binds" and view 5 picks it up.

### Tri-state handling

`H.application_required = not_required` renders `auto-assessed [n]` — a positive. Unknown thresholds → `Not in the knowledge base` in the eligibility cell and verdict `cannot assess`. Agency-negotiated waivers: only the public yes/no fact is in scope; the value is always rendered as out-of-scope, not as unknown.

### Variant selection

`nationality`, `level`, `campus` (offering) and `intake` are all eligibility axes; `intake` also selects the deadline. The header states them.

### Degradation

- Only free-text scholarship prose today (`ProgramRecord.scholarships` name + text) → render one row per name with the text quoted and every structured cell `unknown (unstructured)`.
- No scholarship rows → `Not in the knowledge base: scholarships at <institution> for <level>` plus the Scholarship Matcher line.

---

## View 12 — Document checklist by stage

### Purpose

Answers "what documents for application", "what do I need for the visa", "attestation from MoE or notary?", "do I need NOC from Ministry", "relationship certificate needed?", "provisional certificate accepted?", "how many LORs", "SOP word limit", "what to carry on arrival".

- Stages: S7 (primary), S10, S11, S14.
- Intents: `application_process` (primary), `visa_risk_analysis`, `strategic_planning`, `family_planning`, `lifestyle_adaptation` (arrival stage).
- Task: `process`, `lookup`.

### Mock

> **Document checklist — Deakin Master of IT → subclass 500 → arrival, Nepal applicant, single**
>
> **Stage 1 — University application** (channel: direct via agent portal, no application fee for Expert applicants [2] · 2026-07-30)
> | Document | Required | Format / attestation | Source · as of |
> |---|---|---|---|
> | Passport (bio page) | required, validity ≥ 6 months beyond course end [2] | colour scan | [2] |
> | +2 / NEB transcript and certificate | required [2] | scan; notarised English translation not needed (issued in English) [2][23] | [2][23] · U variant NP |
> | Bachelor transcripts (all semesters) + provisional or degree certificate | required; provisional certificate accepted until degree certificate issued [2] | scan; TU-issued in English [23] | [2][23] |
> | Character certificate | Not required by Deakin [2] | | [2] |
> | English test result (TRF) | required unless MOI waiver: Nepal MOI not accepted for TU graduates at Deakin [3] | TRF number for online verification [3] | [3] |
> | CV | required for the 1.5-year stream credit assessment [2] | | [2] |
> | SOP / personal statement | Not required for admission [2]; GS statement is a visa document (stage 3) | | [2] |
> | Letters of recommendation | Not required [2] | | [2] |
> | Study-gap explanation | Not in the knowledge base (admission); required in the GS statement (stage 3) [5] | | |
>
> **Stage 2 — Offer acceptance & CoE** — signed acceptance [2]; deposit receipt AUD 10,000 [2]; OSHC purchase or Deakin-arranged [2]; GS pre-check questionnaire (Deakin, Nepal applicants) — Internal — do not quote: introduced 2026-05 per rep [12]; Nepal MoE No Objection Certificate (NOC) — required by Nepal to remit tuition and for exit, issued per admission letter [24] · 2026-01-10.
>
> **Stage 3 — Visa (subclass 500, offshore)** — CoE [5]; GS statement answering the 5 department questions, 150 words each [5]; financial evidence as per view 3 (bank statements, loan sanction letter, sponsor relationship certificate from ward office, income documents / CA report — Not in the knowledge base: CA report acceptance) [5][8]; OSHC certificate [5]; health examination via panel clinic (IOM/Nepal Medical or Norvic) [8]; police clearance — Not required for 500 unless requested [5]; passport; Form 956A for the agent [5]; English evidence (test within 2 years of lodgement) [6]; biometrics — Not required for Nepal passport holders for 500 as of 2026-07 [5].
>
> **Stage 4 — Pre-departure & arrival** — CoE and visa grant letter printout, OSHC card, accommodation confirmation, Deakin orientation booking, vaccination record (no mandatory vaccination for entry [25]), customs declaration for cash ≥ AUD 10,000 [25]; Expert pre-departure session (Kathmandu, weekly) [26].
>
> Not in the knowledge base: study-gap document for admission; CA report acceptance as income evidence; Deakin GS pre-check (internal only).

### Attributes consumed

`K.doc_required` (`DocumentRequirement`: type, stage, level, nationality, format, attestation), `K.application_channel`, `K.application_channel_fee`, `K.application_channel_max_choices`, `K.sop_prompts`, `K.lor_count`, `K.lor_type`, `K.lor_submission_method`, `K.interview_format`, `K.portfolio_spec`, `B.deposit_policy`, `K.accepted_payment_methods`, `K.tuition_payment_process_by_origin` (NRB approval, LRS/TCS, BD student file), `K.credential_evaluation_*`, `K.enrolment_document_type`, `K.enrolment_document_prerequisites[]`, `K.atas_required`, `K.acceptance_steps`, `K.application_channel_url`, `E.document_checklist_by_level_nationality`, `E.genuine_intent_test`, `E.genuine_intent_word_limits`, `E.police_clearance_required`, `E.health_exam_required`, `E.panel_clinics_by_origin`, `E.tb_test_countries`, `E.biometrics_required`, `E.passport_validity_rule`, `E.translation_attestation_rules` (notary / MoE / MoFA / apostille), `E.under18_guardian_requirements`, `B.provisional_certificate_accepted`, `B.name_mismatch_affidavit_accepted`, `U.moe_noc_rules`, `U.transcript_issuer`, `U.verification_service`, `U.apostille_available`, `U.translation_norm`, `U.moi_letter_issuer`, `U.grade10_required_norm`, `I.moi_waiver_levels_accepted`, `I.test_score_report_method` (TRF), `M.documents_to_carry_originals`, `M.arrival_vaccination_requirements`, `M.customs_cash_declaration_threshold`, `M.transit_visa_requirements_by_hub`, `X.pre_departure_sessions`, `X.readiness_checklist`.

### Derivation

- Stages fixed: application → acceptance/CoE (or CAS/I-20/LOA/Zulassung/EMGS per `K.enrolment_document_type`) → visa → pre-departure/arrival. Rows = union of institution `DocumentRequirement` (stage, level, nationality) and visa `DocumentRequirement` (nationality, level), de-duplicated by type; a document needed at two stages appears in both with `(also stage n)`.
- Attestation cell combines `E.translation_attestation_rules` with `U.*` for the origin (e.g. TU issues in English → no translation).
- Nepal MoE NOC is inserted for origin=NP at the acceptance stage from `U.moe_noc_rules` and `B.nepal_moe_noc_eligible` (institution recognised — if `false`, a red row "institution not on MoE list — NOC not issuable").
- Source-country document names use the vernacular map (`08-vernacular.md`) in brackets: "relationship certificate (nata pramanit)".

### Tri-state handling

`not_required` documents are **kept in the table** with `Not required [n]` — counsellors need the negative to answer "do I need X?". `unknown` renders `Not in the knowledge base` and goes to the Coverage notice. A document the counsellor asks about that is not a stored type at all is answered as unknown, not omitted.

### Variant selection

`nationality` (mandatory: document variants differ per origin), `level`, `applicant_type` (onshore/offshore changes stage 3 and drops stage 4), `intake` only for deadline-bearing rows, `family_dependents` adds P rows (marriage certificate, relationship evidence, children's birth certificates, dependant OSHC).

### Degradation

- Institution documents unknown → render stage 1 from the destination's generic `E.document_checklist_by_level_nationality` with the header `generic — institution list not in the knowledge base`.
- Only free text → quote the excerpt with `[n]`, mark the table `unstructured`.

---

## View 13 — Test-score gap & pathway-weeks card

### Purpose

Answers "IELTS 6.0 cha, 6.5 chahincha — kati week?", "PTE 58 is equal to what IELTS", "one skill retake accepted?", "which test for UKVI", "TOEFL Home Edition accepted?", "does my 2-year-old IELTS still work", "Duolingo for visa?", "OET for nursing", "when is the next PTE date in Kathmandu", "MOI accepted?".

- Stages: S6 (primary), S5, S3, S10.
- Intents: `test_preparation` (primary), `eligibility_check`, `alternative_pathways`, `visa_risk_analysis` (visa-English rows).

### Mock

> **English gap — target Deakin Master of IT (IELTS 6.5, no band < 6.0 [3] · 2026-07-30); visa: subclass 500 needs IELTS 5.5 overall, or 5.0 with 10 wk ELICOS, or 4.5 with 20 wk [6] · 2026-07-01**
> Student: IELTS Academic 2026-05-18 — L 6.5 R 6.0 **W 5.5** S 6.5, overall 6.0.
>
> | Section | Required | Student | Gap |
> |---|---|---|---|
> | Overall | 6.5 | 6.0 | −0.5 |
> | Writing | 6.0 | 5.5 | −0.5 |
> | Others | 6.0 | 6.0–6.5 | meets |
>
> **Options (all cited):**
> 1. **One Skill Retake (Writing only)** — Deakin accepts IELTS OSR for admission [3]; Home Affairs does **not** accept OSR for the visa [6] — but the visa threshold (5.5) is already met by the original test, so OSR is usable here. Fee NPR 27,500 in Kathmandu, results in 3–5 days [27] · 2026-06-01. Original test valid until 2028-05-18 (2 years from test date, measured to course start for Deakin [3] and to lodgement for the visa [6]).
> 2. **Packaged ELICOS** — 10 weeks per 0.5 band, both overall and section gaps are 0.5 → **10 weeks** [4]; AUD 470/wk → AUD 4,700 [4]; direct entry on completion, no exit test [4]; single CoE package [4]. Adds 10 weeks before 2027-T1 → ELICOS start 2026-12-14 (Deakin English Language Institute intakes every 5 weeks [4]).
> 3. **Switch to PTE Academic** — Deakin equivalence: overall 58, no communicative skill < 50 [3]; the department's visa mapping: PTE 42 = IELTS 5.5 [6]. Next PTE dates Kathmandu: 2026-09-12, 09-14, 09-16 [28] · live 2026-09-07; result in 2 days [28]; fee USD 220 in Nepal [28].
> 4. **MOI waiver** — Not accepted by Deakin for TU graduates [3]. Visa side: not an exemption for Nepal passport holders [6].
>
> Expert Education runs IELTS and PTE classes at Putalisadak and Chabahil, 6-week batches [29] (Agency).
> Realistic timeline: retake Writing by 2026-10-15 to hold the 2026-11-26 application date (view 5).
>
> Not in the knowledge base: whether Deakin accepts IELTS Online for admission; TOEFL Home Edition acceptance at Deakin.

### Attributes consumed

`I.test_code` (code, scale, sections, validity_months, fee_by_origin, centres_by_city, result_days, frequency, one_skill_retake_offered), `I.english_overall_min` (per test, overall + per section), `I.english_equivalence_table` + `I.english_equivalence_authority`, `I.english_test_accepted` (home edition, online, OSR), `I.visa_accepted_english_tests`, `E.visa_english_min`, `E.visa_english_exemptions`, `I.english_validity_measured_to` (test date → course start / lodgement / CAS), `I.moi_waiver_levels_accepted`, `I.school_english_marks_waiver`, `I.english_medium_prior_study_waiver`, `I.pathway_weeks_per_half_band`, `I.pathway_max_weeks`, `I.pathway_fee_per_week`, `I.pathway_exit_assessment`, `I.pathway_direct_entry_on_completion`, `I.pathway_start_frequency`, `I.internal_english_test_accepted`, `I.english_discipline_uplift` (nursing 7.0, teaching 7.5), `I.local_language_test_required` (German B2/C1, French Quebec), `I.dependant_english_required`, `I.test_score_report_method`, `I.test_upcoming_dates` (live), seed `english_overall_min_normalized`, `english_test_waiver_available`, `packaged_english_pathway_available`, `english_pathway_length_weeks`, `english_pathway_provider`, `A.moi_waiver_accepted`, `E.visa_english_requirement`, `E.visa_english_accepted_tests`, `X.test_prep_classes[]` (test, schedule, fee, branch).

### Derivation

- Gap per section = required − student, in the test's own scale; overall separately. Governing gap = max deficit across overall and sections.
- ELICOS weeks = ceil(governing gap ÷ 0.5) × `I.pathway_weeks_per_half_band`, capped at `I.pathway_max_weeks` (if the cap is exceeded, say the package is not available and the test must be retaken). Cost = weeks × `I.pathway_fee_per_week`. Start date = degree start − weeks, aligned to `I.pathway_start_frequency`.
- Cross-test conversion only via `I.english_equivalence_table` whose `authority` is the institution (admission) or the department (visa) — two different tables, both shown when they differ. Never a generic conversion.
- Validity = test date + `I.test_validity_months`, checked against the target named by `I.english_validity_measured_to` for each of admission and visa.
- OSR: valid for admission only if `I.accepted_for_admission_flags.osr=true`; for visa only if `I.visa_accepted_english_tests` lists OSR. Both statements shown.
- Test-date rows are live (`I.test_upcoming_dates`) and carry `fetched_at`.

### Tri-state handling

`A.english_test_waiver_available = not_required`-style negatives (MOI not accepted) render as positive statements with citation. Unknown acceptance flags (`Home Edition: unknown`) → `Not in the knowledge base` and Coverage notice; the option list still shows the item so the counsellor knows to check.

### Variant selection

`nationality` (fees, centres, visa exemptions, MOI rules), `level` (minimums, discipline uplifts), `offering` (ELICOS provider on that campus), `intake` (ELICOS alignment). The header names the test whose minimum is quoted; other accepted tests appear in the options.

### Degradation

- Only a flat `ielts` minimum today (`ProgramRecord.ielts`) → overall gap only, sections `Not in the knowledge base`.
- No pathway rule → option 2 becomes `Packaged ELICOS: availability not in the knowledge base`.
- No live test dates → omit dates, say `test dates: not fetched this turn`.

---

## View 14 — Occupation / licensing pathway card

### Purpose

Answers "after nursing, can I register in Australia", "PCL nursing accepted?", "engineering — Engineers Australia assessment?", "does this accounting degree lead to CPA", "teaching — need IELTS 7.5?", "is this course accredited", "NCLEX or OSCE", "bridging program cost", "can I practise back in Nepal".

- Stages: S15, S16, S3, S18.
- Intents: `migration_pathway`, `career_roi`, `program_selection`, `eligibility_check`.
- Disclaimer applies to migration rows (`quotable=disclaimer`); registration rows are professional-body facts and quotable.

### Mock

> **Registration pathway — Bachelor of Nursing (Deakin) → Registered Nurse, Australia; applicant holds Nepal PCL Nursing (CTEVT, 3 y)**
>
> | Step | Rule | Applies to this profile | Source · as of |
> |---|---|---|---|
> | Course accreditation | ANMAC-accredited, entry-to-practice, accreditation valid to 2029-12-31 [30] | yes — leads to NMBA registration on completion [30] | [30] · 2026-04-01 |
> | Recognition of PCL Nursing | PCL is not a bachelor-equivalent for NMBA; overseas-qualified route requires a bachelor-level qualification [31]; for admission, Deakin grants up to 1 year credit for PCL + 2 y RN experience [32] | credit possible; direct NMBA registration on PCL: not available [31] | [31] · 2026-02-15 [32] · 2026-07-30 |
> | English standard (registration) | IELTS 7.0 in each band or OET B in each, two sittings within 6 months allowed [31] | higher than admission 6.5 → plan for 7.0 by graduation | [31] |
> | Exam | No NCLEX for AU graduates of accredited courses [31]; OBA/OSCE applies to overseas-qualified route only [31] | none | [31] |
> | Supervised hours | 800 clinical placement hours within the course [30] | included; placement counts toward visa work-hour cap? — no, placements are course requirements [7] | [30][7] |
> | Registration fee & timing | AHPRA application AUD 175 + registration AUD 180; graduate applications 4–6 weeks [31] | apply in final semester [31] | [31] |
> | Criminal / vaccination checks | national police check, WWCC by state, immunisation per placement provider [30] | required before placement year 1 [30] | [30] |
> | Occupation & migration | ANZSCO 254411 Registered Nurse (Aged Care) / 254499 RN nec — MLTSSL [11]; NSW nomination: high demand [12] · 2026-06 | on list | [11][12] |
> | Return-home recognition | Nepal Nursing Council registers foreign bachelor's with equivalence — Not in the knowledge base: NNC process for AU degrees | | |
>
> Case-specific migration advice must be confirmed by a MARN-registered migration agent.
>
> Not in the knowledge base: NNC recognition of an Australian BN; whether Deakin credit for PCL applies to 2027 entry.

### Attributes consumed

`S.regulator`, `S.registration_steps[]`, `S.exam` (NCLEX/OSCE/OBA/PLAB/AMC), `S.english_standard`, `S.english_recency`, `S.accredited_course_list_url`, `S.course_leads_to_registration` (entry-to-practice vs advanced), `S.bridging_program`, `S.bridging_cost`, `S.supervised_hours`, `S.registration_fee`, `S.registration_weeks`, `S.state_variation`, `S.source_qualification_recognition` (PCL vs BSc nursing, GNM), `S.internship_residency_rules`, `S.international_graduate_priority`, `S.quotas_admission_tests` (medicine/dental/vet), `S.continuing_education`, `S.criminal_vaccination_checks`, seed `professional_licensing_body`; `A.accreditation_bodies[]` with status and valid_until, `A.placement_hours_total`, `A.placement_paid`, `A.placement_guaranteed`; `G.occupation_code`, `G.occupation_list_membership`, `G.skills_assessment_authority`, `G.skills_assessment_fee`, `G.skills_assessment_processing_weeks`, `G.demand_rating_value`, `G.salary_entry/median`, `G.return_home_recognition`, `G.state_nomination_demand`; `E.placement_counts_toward_hours`; `U.qualification_equivalence`; `CourseOccupation`.

### Derivation

- Steps ordered as the regulator lists them; each step evaluated against the profile (holds / plans / not available).
- Accreditation gate first: if `A.accreditation_bodies[]` lacks the regulator's body or `valid_until < course end`, the card's header says `course does not (currently) lead to registration` and the rest is informational.
- English uplift = `S.english_standard` − admission minimum, stated as a planning item.
- Migration rows reuse view 6's occupation attributes; a points estimate is linked, not repeated.

### Tri-state handling

`S.exam = not_required` renders `No exam for graduates of accredited courses [n]`. Unknown steps render `Not in the knowledge base`; the header never says "leads to registration" if the accreditation row is unknown — it says `accreditation status not in the knowledge base`.

### Variant selection

`region` (state variation in registration and checks), `nationality` (source-qualification recognition), `level` (entry-to-practice vs advanced-practice courses).

### Degradation

- No S rows → migration rows only from G/F, plus `Not in the knowledge base: registration steps for <profession> in <destination>`.

---

## View 15 — Draft-to-student text block

### Purpose

Serves task `draft` (and `review` when the counsellor pastes a draft): emails, WhatsApp/Viber messages, offer summaries, deadline reminders, refusal explanations, in the register the counsellor asks for (English, Nepali, or mixed). It is the only view whose body is student-facing and therefore carries **no inline citations**.

- Stages: any (drafting sits across S1–S19).
- Intents: any topic intent; most often `application_process`, `financial_viability`, `strategic_planning`, `anxiety_reassurance`, `scholarship_funding`, `eligibility_check`.

### Mock

> **Draft — email to student (English, formal-friendly), facts from this conversation and the excerpts**
>
> Subject: Your Deakin Master of IT — offer, costs and next steps for Trimester 1 2027
>
> Dear Sita,
>
> Your conditional offer for the Master of Information Technology at Deakin University (Burwood campus) is for Trimester 1 2027, starting 8 March 2027. The offer condition is an IELTS overall 6.5 with no band below 6.0; your current Writing score is 5.5, so a Writing-only retake or a 10-week English package before the course would satisfy it.
>
> Estimated first-year cost is about AUD 75,300 (tuition AUD 40,600, living AUD 29,710 at the official visa figure, OSHC, visa fee, medical and travel), roughly NPR 67 lakh at today's rate. You are eligible for the Deakin South Asia Regional Bursary of AUD 5,000 in year one, applied automatically.
>
> To keep the March intake we need your documents by 12 November 2026 and the application lodged by 26 November 2026, with the deposit of AUD 10,000 paid by 24 December 2026. Please book your IELTS Writing retake this week.
>
> [Counsellor: insert your preferred meeting slot]
>
> Kind regards,
> [Counsellor name], Expert Education, [branch]
>
> Sources: [1][2][3][5][6][7][8]
>
> Not in the knowledge base (not included in the draft): Deakin GS pre-check requirement — internal only, do not mention.

### Attributes consumed

Whatever the source view(s) consumed for the facts stated; the draft never introduces an attribute the conversation or excerpts did not supply. Plus `X.branches` (signature), `X.services_and_fees` (if the draft mentions Expert's services), `V.quotable_to_students` (to exclude `internal` values), `W.fx_rate_indicative` / `fx_as_of` (for the lakh figure).

### Derivation

- Fact selection: every figure in the draft must appear, with the same value and unit, in a prior view or the counsellor's own words in this conversation (rule 6: "reuse those facts as stated there"). Figures are rounded only if the counsellor asks ("about"), and the `Sources:` line still cites the exact-figure excerpts.
- `quotable=internal` values are excluded and listed after the draft under `not included in the draft`; `quotable=disclaimer` facts are phrased as general information and the draft may include one plain sentence that a registered migration agent will confirm visa matters (no sales language).
- No citation markers inside the body (rule 6); one `Sources: [n][m]` line after it, produced by `citedSources(answer, sources, {strict:true})`.
- Unknowns in the draft become `[bracketed]` notes for the counsellor, never guesses.
- Register: student-facing drafts may carry a greeting and a single next step (the exception in the Style section applies); the counsellor-facing wrapper around the draft does not.
- Language: draft in the language requested; the `Sources:` line and the wrapper stay in the counsellor's language.

### Tri-state handling

`unknown` facts never enter the draft; they become `[bracketed]` placeholders and a `Not in the knowledge base (not included in the draft):` list after the `Sources:` line. `not_required` facts may be stated ("no application fee applies").

### Variant selection

Inherited from the source view; the draft states the variant in plain words where a student would otherwise misread it ("for the Burwood campus", "for students from Nepal").

### Degradation

- `needs_research=false` and no prior view → draft only from the counsellor's message (`NO_RESEARCH_NOTE`), footer `Based on facts supplied by the consultant in this conversation`.
- Counsellor asks to include a figure Edge has not seen → `[figure to confirm: <label>]`.

---

## View → playbook matrix

`●` = the playbook's primary output shape · `○` = used when the request or a flag calls for it · blank = not used. Views 9 (Provenance footer) and 10 (Coverage notice) apply to every row and are omitted from the columns.

| PRIMARY_INTENT | 1 Eligibility | 2 Cost | 3 Fin-proof | 4 Compare | 5 Timeline | 6 PR/points | 7 Pathway | 8 Risk & alt | 11 Scholarship | 12 Documents | 13 Test gap | 14 Licensing | 15 Draft |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| anxiety_reassurance | ○ | ○ | | | ○ | | ○ | ● | | | ○ | | ● |
| strategic_planning | ○ | ○ | ○ | | ● | | ○ | ○ | ○ | ● | ○ | | ○ |
| comparative_decision | ○ | ● | | ● | | ○ | | ○ | ○ | | | | ○ |
| eligibility_check | ● | | | | | | ● | ○ | | | ● | ○ | ○ |
| application_process | | ○ | | | ● | | | | | ● | | | ○ |
| financial_viability | | ● | ● | ○ | | | | ○ | ● | | | | ○ |
| scholarship_funding | ○ | ○ | | ○ | ○ | | | | ● | | | | ○ |
| work_survival | | ○ | | ○ | | | | | | | | | ○ |
| visa_risk_analysis | | | ● | | ○ | | | ● | | ● | ○ | | ○ |
| migration_pathway | | | | ○ | | ● | | ○ | | | | ● | ○ |
| career_roi | | ○ | | ○ | | ● | | | | | | ● | ○ |
| lifestyle_adaptation | | ○ | | ○ | | | | | | ○ | | | ○ |
| family_planning | | ● | ● | | ○ | | | ○ | | ● | ○ | | ○ |
| program_selection | ● | ○ | | ● | | ○ | ● | | | | | ○ | ○ |
| university_selection | ○ | ○ | | ● | | | | ○ | ● | | | | ○ |
| alternative_pathways | ● | ○ | | ○ | ○ | | ● | ● | | | ● | | ○ |
| test_preparation | ○ | | | | ○ | | ○ | | | | ● | | ○ |
| company_services | | | | | | | | | | ○ | ○ | | ○ |
| caseload_management | | | | | ○ | | | | | ○ | | | ○ |
| offer_enrolment | | ○ | | | ● | | | ○ | | ● | | | ○ |
| visa_process | | ○ | ○ | | ● | | | ○ | | ● | | | ○ |
| document_preparation | ○ | | ○ | | | | | | | ● | | | ● |
| onshore_support | | ○ | | | ○ | ○ | ○ | ○ | | ● | | | ○ |
| policy_change | | ○ | ○ | | ○ | ○ | | ○ | | | | | ○ |
| compliance_ethics | | | | | | | | ○ | | | | | ○ |
| lead_engagement | | ○ | | ○ | | | | | | | | | ● |
| greeting | | | | | | | | | | | | | |
| human_handoff | | | | | | | | ○ | | | | | ○ |
| general_inquiry | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

Notes on the matrix:
- `work_survival` and `lifestyle_adaptation` are mostly prose answers with cited facts (E work-hours rows, N/D/M rows); they use view 2 only for the living-cost sub-table and view 4 when two cities are compared.
- `company_services` answers from `X.*` and persona facts; it uses view 12 only for Expert's readiness checklist and view 13 only for test-prep class rows.
- `general_inquiry` may route to any view once the follow-up question narrows the topic.
- Counsellor-work intents added Sept 2026: `caseload_management` answers from CRM records (prose case brief; view 5 for a backward timeline from the case's next deadline, view 12 for the documents still outstanding on the case); `offer_enrolment` and `visa_process` are stage-driven — view 12 with the stage set to acceptance/visa, view 5 from the deposit or lodgement deadline; `document_preparation` is view 12's primary owner (checklists) and view 15 for SOP/LOR/GS text; `onshore_support` uses the onshore variants of views 3, 5, 12 plus prose for attendance/progress rules; `policy_change` reuses the underlying topic's view with the provenance footer (view 9) expanded to show effective date and as-of date; `compliance_ethics` and `lead_engagement` are prose (plus view 15 for the student-facing draft) and have no structured view.
- Flags that force a view regardless of intent: `family_dependents` → view 3 dependant rows and `P.*` lines; `urgent_timeline` → view 5; `prior_visa_refusal` → view 8; `study_gap` / `profile_weakness` → view 1 rows + view 7; `financial_constraint` → view 2 + view 11; `fact_verification` → view 9 expanded (source quote shown); `already_abroad` → onshore variants in views 3, 5, 12.
- Task `compare` forces view 4; task `eligibility` forces view 1; task `draft`/`review`/`summarize`/`translate` forces view 15; task `process` forces view 12 or 5; task `calculate` forces view 2, 3 or 6 depending on the topic, with every derived figure labelled.
- Flags added with the counsellor-work intents: `policy_recency` → view 9 expanded (effective date, as-of date, live vs indexed); `integrity_risk` → no draft view; the answer states the compliant route; `crm_write_requested` → prose with the exact CRM field and text to enter.

---

## UI notes for the frontend repo

The frontend is a separate repository. Today the API returns Markdown prose plus a `sources: Source[]` list (`src/retrieval/format.ts`) and the client renders `[n]` markers against that list. For the views above the backend should emit, alongside the Markdown, a `views[]` array of typed blocks so the UI can render cards and tables instead of parsing prose. Field names below are the contract to design against; the Markdown remains the fallback for clients that ignore `views[]`.

### Common envelope (every view block)

| Field | Meaning |
|---|---|
| `view` | one of `eligibility_card`, `cost_breakdown`, `financial_proof`, `comparison_table`, `backward_timeline`, `points_estimate`, `pathway_map`, `risk_alternatives`, `provenance_footer`, `coverage_notice`, `scholarship_matches`, `document_checklist`, `test_gap`, `licensing_pathway`, `draft_text` |
| `title` | rendered heading |
| `subject` | `{entity_type, entity_id, label}` (course id, institution slug, destination ISO) |
| `variant` | `{nationality, level, offering, intake, region, applicant_type, provider}` — the axes actually used; each value has `exact: boolean` (false when a nearest variant was substituted) |
| `as_of` | latest as-of among the values shown |
| `disclaimer` | `null` or the MARN sentence text |
| `internal_only` | array of items to render inside a collapsed "Internal — do not quote" block |
| `unknowns[]` | attribute ids that were unknown in this block (also aggregated into `coverage_notice`) |
| `citations[]` | the `[n]` ids used in this block |

### Value cell (used in every table)

| Field | Meaning |
|---|---|
| `state` | `known` / `not_required` / `unknown` / `derived` / `expired` / `not_given` (student value missing) |
| `value` | typed value: `{amount, currency, period, year}` for money, `{value, unit, months}` for duration, `{raw, scale, canonical_percent, gpa4}` for grades, `{test, overall, sections{}}` for scores, ISO date for dates, number, boolean, string |
| `display` | pre-formatted string the UI may show verbatim |
| `converted` | optional `{amount, currency, fx_rate_used, fx_as_of}` |
| `citations[]` | `[n]` ids |
| `as_of` | ISO date and `kind`: `extracted` / `verified` / `fetched_live` |
| `reliability_tier` | official / institution / rep_confirmed / third_party / derived / unverified |
| `conflict` | `null` or `[{value, citations, as_of}]` plus `resolution` text |
| `stale` | `null` / `review_overdue` / `expired` |
| `variant_note` | text such as "generic international minimum — Nepal-specific value not stored" |

`state=unknown` must be rendered by the UI as the text "Not in the knowledge base" — the UI must not render an empty cell, a dash or a zero.

### Per-view structured fields

| View | Fields the backend emits |
|---|---|
| `eligibility_card` | `profile{}` (as supplied), `rows[]: {requirement_key, label, minimum: cell, student: cell, verdict: meets/short_by/not_required/unknown/attention/cannot_assess, delta{value, unit}, conversion{from_scale, to_scale, authority, citations}}`, `summary{meets, short, unknown, attention}`, `options[]` (links to `pathway_map`, `test_gap`) |
| `cost_breakdown` | `lines[]: {item_key, label, amount: cell, period, one_off: boolean, included_in_total: boolean}`, `totals{first_year: cell, course_total: cell, excludes_unknown_count}`, `scholarship_offsets[]`, `living_basis: official/city_estimate`, `fx{rate, as_of, source}` |
| `financial_proof` | `destination, visa_type, family{spouse, children[] ages}`, `components[]: {key, rule_text, amount: cell}`, `total: cell`, `income_alternative{available, threshold: cell}`, `evidence_rules[]: {key, text, citations, internal: boolean}`, `accepted_funds[]`, `sponsors[]`, `loan_products[]`, `policy_changes_in_window[]` |
| `comparison_table` | `mode: course/institution/destination`, `columns[]: {subject, variant}`, `rows[]: {criterion_key, label, cells[]: cell}`, `recommendation{text, priority, caveats[]}`, `not_compared[]` |
| `backward_timeline` | `intake{term, start_date, status, status_as_of}`, `steps[]: {key, label, date, lead_time{value, unit, source: stored/derived}, rule_text, citations, shifted_for_holiday: boolean}`, `slack_days`, `binding_step_key`, `policy_events[]: {date, attribute, effect, citations}`, `fallback_intake{}`, `this_week_action` |
| `points_estimate` | `destination, stream, table_effective_date`, `factors[]: {key, label, rule_text, now: cell, planned: cell, lever{}}`, `totals{now, planned, unknown_factor_count}`, `cutoffs[]: {stream, occupation, min_points, round_date, citations}`, `skills_assessment{authority, fee, weeks}`, `typical_years{range, assumptions}`, `gate_rows[]` (PGWP eligibility etc.) |
| `pathway_map` | `target{}`, `nodes[]: {key, label, level, entry_rows (eligibility_card rows), eligible_now: boolean}`, `edges[]: {from, to, credit_months, entry_year, guaranteed, gpa, provider, single_coe}`, `routes[]: {key, nodes[], time_months, time_delta, cost: cell, cost_delta, elicos_weeks, elicos_cost, psw_preserved, registration_outcome}`, `recommended_route_key` |
| `risk_alternatives` | `risk_factors[]: {flag, rule_text, mitigation, citations, internal}`, `signals[]` (grant rate, evidence level, cap), `alternatives[]: {axis: provider/destination/intake/pathway, subject, why, cost_delta: cell, timing, citations}`, `budget_check{budget, fits: boolean, shortfall}` |
| `provenance_footer` | `sources[]: Source + {reliability_tier, as_of{date, kind}, verified{by, at, method}, review_due_at, quotable, variant_note}`, `derived_inputs[]`, `conflicts[]`, `stale[]`, `preferred_live_over_indexed[]`, `mode: full/based_on/none` |
| `coverage_notice` | `items[]: {entity, label, attribute_id, variant, reason: not_on_page/never_collected/expired/nearest_variant, last_checked_at, old_value, citations}`, `research_trail[]: {tool, args_summary, result_summary}`, `coverage_pct_tier1` |
| `scholarship_matches` | `matches[]: {scholarship_id, name, provider_type, coverage: cell, eligibility_rows[] (eligibility_card rows), verdict: meets/short_by/does_not_meet/does_not_apply/cannot_assess, application_required: cell, deadline: cell, competitiveness, stackable, url}`, `best_case{now: cell, with_uplift: cell, uplift_text}` |
| `document_checklist` | `stages[]: {key: application/acceptance/visa/arrival, label, channel, items[]: {doc_type, vernacular_names[], required: cell, format_text, attestation_text, also_stage, citations}}`, `enrolment_document_type` |
| `test_gap` | `target{admission_min{test, overall, sections}, visa_min{}}`, `student_score{}`, `gaps[]: {section, required, actual, delta}`, `options[]: {key: osr/elicos/switch_test/moi_waiver/retake, available_admission: cell, available_visa: cell, weeks, cost: cell, fee: cell, dates[] (live), text}`, `validity{admission_until, visa_until}`, `prep_classes[]` |
| `licensing_pathway` | `profession, regulator, accreditation{body, status, valid_until, leads_to_registration}`, `steps[]: {key, rule_text, applies: holds/plans/not_available/unknown, citations}`, `english_uplift{}`, `occupation_rows[]` (points_estimate gate rows), `return_home_recognition: cell` |
| `draft_text` | `language, register, channel (email/whatsapp/sms/letter)`, `subject`, `body` (no citation markers), `placeholders[]: {token, label}`, `based_on[]` (strict cited ids), `excluded_internal[]`, `excluded_unknown[]` |

### Rendering requirements for the UI

1. Every cell with `citations[]` renders a clickable `[n]` that opens the matching `Source` (existing behaviour) and, when present, the `source_quote`.
2. Every cell shows its `as_of` on hover or inline in compact mode; `stale=review_overdue` gets a warning glyph, `stale=expired` never reaches a cell (it is in `coverage_notice`).
3. `internal_only` content is collapsed by default and labelled "Internal — do not quote to student"; it must not be included in any copy-to-clipboard or "send to student" action.
4. `disclaimer` text renders under the card in a fixed style; it cannot be dismissed on `points_estimate`, `risk_alternatives`, `financial_proof`.
5. `coverage_notice` is rendered once per answer, after all other blocks, under the heading "Not in the knowledge base:"; it is hidden when `items[]` is empty.
6. `draft_text.body` gets a "copy" action; `based_on` renders below it as a small line in the counsellor's UI only — the copied text excludes it.
7. `variant.*.exact=false` renders the `variant_note` next to the card title.
8. Converted amounts (`converted{}`) render in brackets after the native amount with the fx as-of date; NPR/INR/BDT use lakh/crore formatting.
9. Tables wider than the viewport scroll horizontally inside the card; the page never scrolls sideways.
10. When `views[]` is absent (older backend or degraded answer), the client falls back to rendering the Markdown as today.
