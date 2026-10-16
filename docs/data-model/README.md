# Edge counsellor data model — catalog of everything Edge should know

This directory is the **planning specification** for the knowledge Edge (the internal AI
assistant for Expert Education counsellors) needs in order to answer any question a
prospective international student asks a counsellor. It defines *what data to collect*,
*where it comes from*, *how fresh it must be*, and *what Edge should show*. It contains
no code; a follow-up implementation plan turns Tier 1 into schemas, collections,
extraction prompts and tools.

## Files

| File | Purpose |
|---|---|
| `01-entities.md` | Entity model: keys, relationships, variant axes, ER diagram |
| `02-question-coverage.md` | 20 student-journey stages × real student questions → attributes → intent playbook. The exhaustiveness check |
| `03-catalog/*.md` | One file per domain (A–X). Every attribute, one row, fixed column set (below) |
| `04-sourcing.md` | Source categories, collection methods, refresh cadence, owners |
| `05-priorities.md` | Tier 1/2/3 rollout and which playbooks each tier unlocks |
| `06-gaps-vs-codebase.md` | Attribute → today's field path in `src/`, or `missing` |
| `07-counsellor-views.md` | The answer shapes Edge shows (eligibility card, cost breakdown, timeline…) and the attributes each consumes |
| `08-vernacular.md` | Student/counsellor phrasing → canonical attribute synonym map |
| `catalog.csv` | Flat export of every `03-catalog` row, same columns, for loading into a spreadsheet. Generated; do not edit |
| `seed/user-sheet.tsv` | The original 82-row attribute sheet supplied by the product owner, verbatim |
| `../../scripts/catalog.ts` | Checker, CSV exporter, reference renamer and 02/06 table generator (`bun run catalog:check`, `bun run catalog:export`) |

## How to read a catalog row

Every table in `03-catalog/` has exactly these columns, in this order. The export script
parses them, so do not add, remove or reorder columns.

| Column | Meaning |
|---|---|
| `id` | `<domain letter>.<3 digits>`, e.g. `E.014`. Stable; never renumber |
| `attribute` | `snake_case` canonical name. Unique across the whole catalog |
| `full_name` | Human label |
| `entity` | One of the entities in `01-entities.md` (e.g. `Course`, `Destination×Nationality`) |
| `variant_axes` | Which axes the value varies on: `-`, or a `;`-list of `nationality`, `level`, `offering`, `intake`, `region`, `applicant_type`, `provider` |
| `data_type` | `string`, `integer`, `decimal`, `boolean`, `tristate`, `enum`, `date`, `money`, `duration`, `percent`, `array[...]`, `object`, `url`, `text` |
| `possible_values` | Enum values, ranges or an example |
| `definition` | What the value means, precisely enough to collect it |
| `data_source` | Source category: `University Website`, `Government / Immigration`, `Third-party Dataset`, `Professional / Accreditation Body`, `Derived / Computed`, `Admin Entry`, `Live Web`, `Agency (Expert)` |
| `collection_method` | `llm_extraction`, `govt_dataset_import`, `third_party_import`, `body_dataset_import`, `derived`, `admin_entry`, `live_fetch`, `geocode` |
| `refresh_cadence` | `nightly`, `weekly`, `monthly`, `quarterly`, `semi_annual`, `annual`, `per_intake`, `on_policy_change`, `on_source_change`, `answer_time`, `static` |
| `owner_role` | Who is accountable for correctness: `ingest_pipeline`, `data_team`, `partnerships`, `compliance`, `branch_ops`, `engineering` |
| `tier` | `1`, `2` or `3` rollout priority (see `05-priorities.md`) |
| `quotable` | `yes` = may be quoted to a student; `internal` = Edge may reason with it but must not quote figures to students; `disclaimer` = quotable only with the MARN/general-information disclaimer |
| `today_field_path` | Existing field in `src/` that holds this today (e.g. `ProgramRecord.tuition[].amount`), else `missing` |
| `countries` | `all`, or `;`-list of ISO-2 destination codes (`AU;CA;GB;NZ;US;DE;IE;MY;AE;TH;NL`); origin-market rows use `origin:NP` style |
| `stages` | `;`-list of journey-stage numbers `S1`…`S20` from `02-question-coverage.md` that this attribute answers |
| `seed` | `yes` if the row comes from `seed/user-sheet.tsv` (definition kept verbatim), else `-` |
| `notes` | Collection caveats, unit conventions, known conflicts |

## Conventions

**Tri-state requirements.** Any requirement attribute (a minimum, a mandatory document,
a test) uses `tristate`: `required:<value>` / `not_required` / `unknown`. Today's schema
uses `null` for both "not on the page" and "not applicable"; the catalog never does.

**Money** is always `{amount, currency, period, year}`; `period` ∈ `per_year | total |
per_semester | per_trimester | per_week | per_month | one_off`. Converted figures shown to
students (NPR/INR/BDT) carry `fx_rate_used` and `fx_as_of`.

**Duration** is `{value, unit}` plus a normalised `months` field. **Scores** keep the raw
per-test value plus an IELTS-equivalent canonical. **Grades** keep the raw source-scale
value plus canonical percent and GPA-4, and always name the scale (`min_gpa_scale`).

**Variant axes.** Many facts differ by the student's nationality, the study level, the
campus/delivery offering, the intake, or the applicant type. A row's `variant_axes`
says which. Storage keys a value by those axes; the answer layer picks the matching one.

**Provenance on every value** (domain V): `source_url`, `source_type`, `source_quote`,
`extracted_at`, `confidence`, `reliability_tier`, `verified_by/at/method`, `valid_from`,
`valid_to`, `applies_to`, `conflicts[]`, `change_history[]`, `review_due_at`.

**Quotable flag.** Internal observations (risk appetite, observed processing times,
negotiated waivers) are `internal`. Visa and migration facts are `disclaimer`.

**Identifiers.** Institutions: CRICOS provider code, DLI number, UKPRN / UKVI sponsor,
SEVIS school code, NZQA provider code, MQA code, anabin ID. Courses: CRICOS course code,
UCAS code, CIP code, institution course code. Occupations: ANZSCO (6-digit), NOC 2021
(5-digit TEER), UK SOC 2020, US SOC, ISCO-08 crosswalk. Tests: codes listed in
`03-catalog/english-and-tests.md`.

**Countries.** Destinations: AU, CA, GB (UK), NZ, US, DE, IE, MY, AE, TH, NL (the Netherlands is a
destination in `src/schemas/intent.schema.ts` and `PERSONA.company.destinations`; a handful of rows use it).
Origin markets: NP, IN, BD, VN, PH, TH, LK.

## Scope

In scope: knowledge about courses, institutions, campuses, cities, destinations and
their visa regimes, occupations and migration, scholarships, tests, pathways, application
process, money, arrival and life, academic rules, family, research, school-age students,
regulated professions, intake calendars, source-country grading, provenance, destination
policy, and Expert Education's own public facts.

Out of scope (entity names reserved, nothing else): `Student` (case profile),
`Application` (tracking), `PartnerAgreement` (commercial terms), `CaseOutcome`,
`CounsellorNote`.

## Retired ids

Ids are never renumbered or reused. Rows retired to restore attribute uniqueness are listed
here; `scripts/catalog.ts check` rejects any reuse of, or reference to, a retired id.

| id | former attribute | superseded_by | reason |
|---|---|---|---|
| T.019 | `application_deadline_type` | `K.009` | Same fact; deadlines belong to CourseOffering (01-entities) |
| D.054 | `emergency_number` | `N.092` | Safety facts live in life-and-work-rights |
| M.054 | `foreign_licence_validity_months` | `N.033` | Driving rules live in life-and-work-rights; M keeps the conversion how-to |
| B.112 | `hardship_fund_available` | `H.098` | Funds and awards live in scholarship |
| B.090 | `release_letter_policy` | `O.031` | Release letters are an academic-rules fact (05-priorities) |
| L.088 | `scholarship_offsets_deposit` | `H.061` | Scholarship terms live in scholarship; L references them |
| N.018 | `typical_student_jobs` | `D.041` | City grain is the right key for the local job market |
| B.083 | `visa_refusal_refund_pct` | `L.029` | Money facts live in fees-and-money |

## Ownership decisions for names that could live in two domains

Recorded so that the same fact is never modelled twice. `07-counsellor-views.md` and
`08-vernacular.md` cite the owning row.

| fact | owner | not modelled in |
|---|---|---|
| Can dependants come at this level | `E.dependents_allowed` (seed row, `Destination×Level`) | P (P holds *who* counts and what they may do: `P.dependant_eligibility_by_relationship`, `P.partner_work_rights`) |
| English requirement for a dependant | `I.dependant_english_required` (score detail); `P.dependant_visa_english_requirement` is the visa-side flag only | E |
| FX rate applied to a converted value | `V.fx_rate_used`, `V.fx_as_of` (per value) | W (W holds only the indicative display rate `W.fx_rate_indicative`, `W.fx_source`, `W.fx_12m_trend`) |
| Women's safety | `D.women_safety_index` (city grain) | W |
| Minimum age | `A.min_age` (seed, course); `R.under18_min_age_for_visa` (immigration floor); `E.age_limits` (visa age rules) | — |
| Visa-side English validity | `I.visa_english_validity_months`; `E.visa_english_validity_rule` is the rule text | — |
| Insurance | `E.insurance_scheme` / `E.insurance_mandatory` / `E.insurance_cover_length_rule` (requirement); `L.insurance_premium_*` (prices) | — |
| GIC / blocked-account providers | `L.finance_provider_name` and the `L.funds_product_*` rows; amounts are `E.gic_amount`, `E.blocked_account_amount` | — |
| Skills assessment for migration vs professional registration | G (`G.skills_assessment_*`); S holds registration to practise (`S.regulator`, `S.registration_steps`) | — |
| Policy change events | `W.policy_change_log` (destination event); `V.policy_change_ref` / `V.change_history` (per value); F.9 keeps the migration-specific log | — |

## Checking and regenerating

```sh
bun run catalog:check            # = scripts/catalog.ts check --refs : structure, vocab, ids, seed coverage, 07/08 references
bun run catalog:export           # = scripts/catalog.ts export       : rewrite catalog.csv from 03-catalog/*.md
bun run scripts/catalog.ts coverage --write   # refresh the generated tables in 02-question-coverage.md
bun run scripts/catalog.ts gaps --write       # refresh the generated tables in 06-gaps-vs-codebase.md
bun run scripts/catalog.ts check --refs --strict --csv --verify-paths   # everything, warnings fatal, CSV in sync, src paths exist
```

`tests/catalog.test.ts` runs the strict check and the CSV comparison as part of `bun test`, so a
catalog edit that breaks the contract (a 20-cell row, a duplicate name, a reused retired id, a
dangling `Letter.name` in 07/08, a stale `catalog.csv`) fails CI. `catalog.csv` is RFC 4180,
CRLF, UTF-8 without BOM, rows sorted by id. No code in `src/` depends on this directory.
