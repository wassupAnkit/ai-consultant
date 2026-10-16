# 05 — Priorities: what to collect first and what it unlocks

Tiers are assigned per attribute in the `tier` column of `03-catalog/`. This file explains
the rationale and the playbooks each tier unblocks. "Unblocks" means the intent playbook
(`src/prompts/intents.ts`) and its domain framework (`src/prompts/frameworks/`) already
tell the model to reason over these facts; today they are simply absent.

## Tier 1 — the counsellor's daily questions

Target: the five most-used playbooks work from structured data instead of prose search.

| Domain | Tier 1 content | Unblocks |
|---|---|---|
| A Course | Normalised entry minimums (GPA/percentage with scale, per-nationality accepted qualifications, 3-year bachelor acceptance, gap max, backlog policy), framework level, `psw_eligible`, placement flag, status | eligibility_check, program_selection, comparative_decision |
| U Source-country grading | NEB/CBSE/HSC/TU/VN/PH/TH scales and conversion tables with authority | eligibility_check (every "my GPA is X" question) |
| C Campus + CourseOffering | City, state, postcode, regional category, which courses run at which campus | comparative_decision, migration_pathway (regional points), lifestyle_adaptation |
| D City cost of living | Rent/groceries/transport/utilities breakdown, official visa living figure per region, cost year and source | financial_viability, comparative_decision |
| E Destination visa (core) | Visa type, fee, financial-proof formula and figures by nationality and family, accepted funds/sponsors, seasoning days, work hours term/break, dependants by level, processing time (official + observed), conditions, insurance scheme and cost, genuine-intent test type | visa_risk_analysis, financial_viability, family_planning, work_survival |
| F Post-study migration | PSW visa name/length/eligibility per destination and level, points tables with effective dates, state nomination status | migration_pathway, comparative_decision, career_roi |
| G Occupation | Codes, temporal list membership, assessing authority, demand rating, median salary with year | migration_pathway, career_roi, program_selection |
| H Scholarship | Standalone entity: coverage, eligibility axes, deadline, competitiveness, application required | scholarship_funding, financial_viability |
| I English & tests | Per-test per-section minimums, accepted tests for admission and visa, validity, waiver rules, pathway weeks per band gap | test_preparation, eligibility_check, alternative_pathways |
| T Intake calendar | Term start, application close (international), deposit and CoE/CAS latest dates, orientation, census | strategic_planning, application_process, all "when" questions |
| V Provenance | source, as-of, valid_from/to, verified_by, tri-state, conflicts | every answer's citation and "Not in the knowledge base" behaviour |

Tier 1 also fixes the tri-state ambiguity in today's `ProgramRecord` (null means both
"absent" and "not required").

## Tier 2 — the full advisory conversation

| Domain | Content | Unblocks |
|---|---|---|
| B Institution | Type, registrations, rankings, groups, teaching scores, enrolment mix, risk rating, policies (application fee, offer turnaround, deposit, refund, deferral, fee increase), services | university_selection, visa_risk_analysis, application_process |
| K Application process | Channels, document requirements by stage × level × nationality, SOP/LOR rules, interviews, credential evaluation, enrolment document prerequisites | application_process, strategic_planning |
| L Fees & money | Non-tuition fee items, insurance price tables, GIC/blocked-account providers, education-loan products per origin, FX, tuition protection | financial_viability |
| J Pathways | Articulation records, packaged offers, cost/time deltas | alternative_pathways, program_selection |
| O Academic rules | Attendance, progress, course-change and provider-change rules, release letters, reporting triggers | work_survival, general_inquiry (onshore students) |
| P Family | Dependant rights by level, school fees by region, additional funds, relationship evidence | family_planning |
| S Regulated professions | Regulator, steps, exam, English standard, course-to-registration eligibility, bridging | migration_pathway, career_roi, program_selection (nursing, teaching, engineering, accounting) |
| W Destination policy | Caps and allocations, recognition in source country, language requirements, policy change log | comparative_decision, visa_risk_analysis |
| 08 Vernacular | Synonym map | classifier and retrieval quality across all intents |

## Tier 3 — completeness and comfort

| Domain | Content | Unblocks |
|---|---|---|
| M Accommodation & arrival | Housing types and costs, pickup, orientation, SIM/bank/tax-ID, registration rules, transit visas | lifestyle_adaptation, strategic_planning (pre-departure) |
| N Life & work rights | Wages, tax basics, driving, healthcare access, safety notes, religious facilities, food, festivals vs term dates | work_survival, lifestyle_adaptation, anxiety_reassurance |
| Q Research / PhD | Supervisors, funding, duration, privileges | program_selection (research), scholarship_funding |
| R School & under-18 | Schools, guardian visas, welfare | family_planning, program_selection (school) |
| X Agency | Services, branches, classes, events, checklists | company_services |
| Soft signals | Diaspora, food, climate comfort, discrimination index | lifestyle_adaptation |

## Sequencing notes

- Do provenance (V) and tri-state alongside Tier 1, not after: retrofitting validity
  windows onto thousands of values is more expensive than capturing them at extraction.
- CourseOffering (C) should replace `campuses: string[]` before Tier 1 tuition-by-campus
  and regional-flag rows are collected, or the values will have no key to attach to.
- Government rows (E, F, G lists) are small, high-value datasets; they can be curated by
  hand for the five main destinations in days and should not wait for pipeline work.
- Institution coverage: the partner registry today holds 34 Australian records and ~149
  placeholders. Filling the registry (`scripts/partners-discover.ts` + human review) gates
  every University-Website row for UK, Canada, NZ, USA, Germany, Ireland, Malaysia, UAE
  and Thailand.

## Playbook → tier matrix

| Playbook | Tier 1 domains | Tier 2 domains | Tier 3 domains |
|---|---|---|---|
| eligibility_check | A U I V | K B | — |
| financial_viability | D E H V | L B | M N |
| comparative_decision | A C D E F G V | B W | N |
| migration_pathway | F G C V | S W | — |
| visa_risk_analysis | E V | B K W | — |
| scholarship_funding | H V | L | Q |
| application_process | T V | K B | — |
| strategic_planning | T V | K | M |
| program_selection | A G V | J S | Q R |
| university_selection | C V | B | — |
| test_preparation | I V | — | X |
| work_survival | E V | O | N |
| family_planning | E V | P | R |
| career_roi | G F V | S | — |
| alternative_pathways | I V | J W | — |
| lifestyle_adaptation | C D V | — | M N |
| anxiety_reassurance | V | — | N |
| company_services | — | — | X |
| general_inquiry | V | O W | any |
| greeting / human_handoff | — | — | — |
