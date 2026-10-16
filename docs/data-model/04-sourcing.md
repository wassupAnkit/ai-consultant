# 04 — Sourcing: where each attribute comes from and how fresh it stays

Every row in `03-catalog/` names a `data_source` category, a `collection_method`, a
`refresh_cadence` and an `owner_role`. This file defines those values and the operating
model behind them. Nothing here is code; it describes the pipelines a follow-up
implementation plan would build or extend.

## Source categories

| `data_source` | What it is | Trust | Typical domains |
|---|---|---|---|
| University Website | Partner institution pages: course pages, fees, scholarships, international/country-specific entry pages, accommodation, academic calendar, policies | High for the institution's own facts; may lag reality by a fee year | A B C H I J K L M O Q R T |
| Government / Immigration | Home Affairs, IRCC, UKVI/gov.uk, INZ, USCIS/SEVP/State, BAMF/DAAD, INIS, EMGS, ICA, Thai Immigration; state/provincial migration sites; regulators' registers (CRICOS, DLI list, UKVI sponsor register, SEVP list, NZQA, MQA, anabin) | Authoritative; changes on announced dates | E F G(lists) P R S T(policy) W |
| Third-party Dataset | Rankings (QS, THE, ARWU, US News), cost of living (Numbeo-style, university estimates), labour market (Jobs and Skills Australia, Job Bank Canada, ONS, BLS, O*NET), graduate outcomes (QILT, LEO, Discover Uni, NSC), safety indices, climate, geocoding, test providers | Medium; must carry year and source | B C D G I N |
| Professional / Accreditation Body | AHPRA/NMBA, ANMAC, Engineers Australia, ACS, CPA/CA ANZ, NMC, GMC, NCLEX boards, Ontario colleges, NZ councils, accreditation registers | Authoritative for registration rules | S, part of G and A |
| Derived / Computed | Deterministic functions over other attributes | As good as inputs; re-derived when inputs change | flagged in every domain |
| Admin Entry | Expert Education staff observations and confirmations: observed processing times, offer turnaround, GS strictness, panel clinics, Kathmandu test fees, loan banks, agency services and events; human verification of extracted values | Trusted internally; most rows `quotable=internal` | X, parts of B E I L M T |
| Live Web | `web_search` and `fetch_page` at answer time, 6 h cache | Freshest; unverified; tagged `live=true` in answers | freshness checks in any domain |
| Agency (Expert) | Company facts from `src/config/persona.ts` and admin entry | Authoritative for Expert's own facts | X |

## Collection methods

| `collection_method` | How it works | Exists today? |
|---|---|---|
| `llm_extraction` | Gemini structured extraction over a detected page kind. Today: `ProgramLLMSchema` on course pages (`src/ingest/programs.ts`). Planned: an expanded course schema plus new institution, scholarship, intake-calendar, accommodation and policy schemas, each triggered by a page-kind detector extending `src/ingest/course-detect.ts` (fees, scholarships, international/country entry, accommodation, academic calendar, policies) | Partly |
| `govt_dataset_import` | Curated JSON/CSV under `data/reference/<country>/` (points tables, occupation lists, visa fees, financial-proof figures, visa conditions, PSW rules), versioned in git with `valid_from`/`valid_to`; a small admin form later | No |
| `third_party_import` | Licensed or open datasets imported on a schedule with `source`, `year` and licence recorded | No |
| `body_dataset_import` | Curated JSON per profession/regulator | No |
| `derived` | Pure functions in code; inputs listed in the row's definition | Partly (normalised English only conceptually) |
| `admin_entry` | Admin routes / form; every entry records `verified_by`, `verified_at`, `verification_method` | Partner CRUD only |
| `live_fetch` | Existing research tools; results are never written into the catalog store without verification | Yes |
| `geocode` | Address → lat/lng → postcode → regional category, distance to CBD, nearest airport | No |

## Refresh cadences

| `refresh_cadence` | Meaning | Applies to |
|---|---|---|
| `nightly` | Every partner crawl run | All `llm_extraction` rows |
| `weekly` | Weekly job | State/provincial nomination status, invitation rounds, intake status |
| `monthly` | Monthly review | Processing times, FX, government rows with no announced change |
| `quarterly` | Quarterly import | Cost of living, labour-market demand, safety |
| `semi_annual` | Twice a year | Regulated-profession rules |
| `annual` | Once a year (before the fee year / ranking release) | Rankings, tuition indexation, graduate outcomes |
| `per_intake` | Before each intake opens | Scholarship rounds, deadlines, calendars |
| `on_policy_change` | Event-driven from a `PolicyChange` record | Visa fees, financial-proof figures, work hours, occupation lists, PSW rules |
| `on_source_change` | Re-derived whenever an input changes | All `derived` rows |
| `answer_time` | Computed per question | Timelines, points estimate, comparisons, coverage notice |
| `static` | Rarely changes | Identifiers, geo, founded year |

Staleness policy: each attribute class has a `max_age_days` (domain V,
`staleness_policy`). A value older than that renders with a "last verified" warning and is
queued for re-check; a value past `valid_to` is not quoted at all.

## Owners

| `owner_role` | Accountable for |
|---|---|
| `ingest_pipeline` | Extraction correctness and coverage on partner sites |
| `data_team` | Government, third-party and body imports; conversion tables; derived logic inputs |
| `partnerships` | Institution policies, observed turnaround, partner status, scholarship confirmations |
| `compliance` | Visa and migration rows, disclaimer flags, quotable flags, MARN review |
| `branch_ops` | Agency facts: branches, classes, events, checklists, local panel clinics and test fees |
| `engineering` | Provenance fields, staleness computation, coverage reports |

## Verification loop

1. Extraction writes a value with `confidence` and `reliability_tier=unverified_llm` or
   `institution_official_page`.
2. Values below a confidence threshold, values that conflict with an existing one, and all
   Tier 1 money/threshold values go to a review queue.
3. A human confirms (page re-check, email from institution rep, phone, partner portal,
   official circular) and the row gains `verified_by/at/method`; the tier rises.
4. Disagreements are stored as a `ConflictRecord` with every candidate value and its
   source; Edge surfaces "figures differ" rather than silently choosing until resolved.
5. Government rows are only ever changed through a `PolicyChange` record carrying the
   announcement date, effective date, applies-to rule and source URL.

## Anti-swamping and retrieval

Structured attributes are stored as typed records (per entity) **and** rendered as
synthetic Markdown chunks (today's `renderProgramText` pattern) so hybrid search finds
them. The typed store is what the answer views consume; the chunks are what the research
loop cites. Per-`sourceKind` quotas (`RETRIEVAL_QUOTAS`) continue to keep partner pages
from drowning the main site.
