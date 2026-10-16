# 06 — Gaps versus the codebase: what Edge stores today, what it fetches live, what is missing

This file maps every catalog row to the field in `src/` that holds it today. It is the
honest baseline for the implementation plan: the catalog describes what a counsellor needs;
this file says how much of it the backend can currently answer from structured data rather
than prose search. Tables between `<!-- generated:…:start/end -->` markers are produced by
`bun run scripts/catalog.ts gaps --write` from the `today_field_path` column; the **Method**
and **Implications** sections are hand-written.

## Method

`today_field_path` takes one of three shapes:

| value | meaning | example |
|---|---|---|
| a real path under a known record root | the backend stores this value in a typed field today | `ProgramRecord.tuition[].amount` |
| `missing (live fetch only)` | not stored; Edge can read it at answer time from an allow-listed government or institution page through `web_search` / `fetch_page` and the 6-hour `live_cache` | every visa fee and rule in E |
| `missing` | neither stored nor reliably fetchable live; it must be collected | most of A–D, G–O, U, V |

Record roots and their source files (`FIELD_ROOTS` in `scripts/catalog.ts`):

| root | file | what it is |
|---|---|---|
| `ProgramRecord` | `src/ingest/programs.ts` | one extracted course, collection `kb_programs` |
| `PartnerRecord` / `PartnerDoc` | `src/partners/registry.ts` | one partner institution, collection `kb_partners` |
| `EvidenceItem` | `src/ingest/programs.ts` | source quote attached to an extracted field |
| `KbChunkDoc` / `KbPageDoc` / `KbDocumentDoc` | `src/ingest/*.ts` | retrieval chunks, crawled pages, uploaded documents |
| `persona.ts` | `src/config/persona.ts` | `PERSONA.company` public facts |

`check --verify-paths` greps the leaf of every real path in the mapped file, so a renamed field
fails the check. **Fidelity** in the stored table is inferred from the row's notes: `exact`
(same meaning and type), `partial` (needs parsing, mapping or a derived step), `text-only`
(stored as free text where the catalog wants a typed value), `null-ambiguous` (today's `null`
means both "absent" and "not applicable").

Structured knowledge the backend holds today, for reference:

- **Programs** (`kb_programs`, `ProgramRecord`): `programName, level, discipline, disciplineTags[], campuses[], deliveryModes[], duration{value,unit,text}, tuition[]{amount,currency,period,audience,year,text}, intakes[], applicationDeadlines[]{intake,date,text}, entryRequirements{academic[],text}, englishRequirements{ielts,pte,toefl{overall,minBand},duolingo,other[]}, scholarships[]{name,amount,text}, codes{cricos,courseCode,ucas,other[]}, evidence[], confidence` plus provenance `university, universitySlug, country, sourceUrl, source, contentHash, model, extractedAt`. Search filters: query, countries, university slugs, levels, disciplines, intake, max tuition with currency, max IELTS overall, has scholarships.
- **Partners** (`kb_partners`, `PartnerDoc`): `slug, name, aliases[], country, website, domains[], programPaths[], sitemaps[], maxPages, enabled, verified, source, notes`. Seeds in `data/partners.json`: 43 rows, 34 Australian.
- **Pages and chunks** (`kb_pages`, `kb_chunks`): URL, source kind (site, partner, upload, program), partner slug, country, title, section, `docType` (destination, study_area, service, blog, partners, about, contact, location, tool, team, events, page), content, embedding, metadata.
- **Uploads** (`kb_documents`): slug, filename, MIME type, kind, title, partner slug, country, docType, status, page/chunk/program counts.
- **Company facts** (`PERSONA.company`): legal name, short name, website, founded, headquarters, footprint, stats, accreditations, markets, destinations, partner countries, study areas, services, canonical URLs.
- **Enums** (`src/schemas/intent.schema.ts`): `DESTINATIONS` (12 slugs incl. netherlands and other), `STUDY_LEVELS` (7), `PRIMARY_INTENTS` (29: 18 study-abroad topics, 8 counsellor-work topics, 3 operational), `TASKS` (10), `CONTEXT_FLAGS` (23).
- **Student profile** (`user_profiles.profile`, `chat_turns.profile`): an untyped bag of the frontend's flat snake_case preferences (primary goal, selected countries, budget, academic level and score, English test status and score, work experience, visa refusal history, location preference).

Everything else the catalog names (visa rules, points tests, occupations, scholarships as
entities, rankings, campus geography, living costs, insurance, work rights, intake calendars,
grading schemes, registration bodies, policy changes) exists today only as prose in
`kb_chunks` or as a live fetch at answer time.

## Stored today

<!-- generated:stored-today:start -->
| id | attribute | entity | today_field_path | src file | fidelity |
|---|---|---|---|---|---|
| A.001 | `course_title_official` | Course | `ProgramRecord.programName` | `src/ingest/programs.ts` | partial |
| A.003 | `course_level_fine` | Course | `ProgramRecord.level` | `src/ingest/programs.ts` | partial |
| A.004 | `course_level_coarse` | Course | `ProgramRecord.level` | `src/ingest/programs.ts` | partial |
| A.016 | `discipline_primary` | Course | `ProgramRecord.discipline` | `src/ingest/programs.ts` | exact |
| A.017 | `discipline_tags` | Course | `ProgramRecord.disciplineTags` | `src/ingest/programs.ts` | exact |
| A.018 | `cricos_course_code` | Course | `ProgramRecord.codes.cricos` | `src/ingest/programs.ts` | exact |
| A.019 | `ucas_course_code` | Course | `ProgramRecord.codes.ucas` | `src/ingest/programs.ts` | exact |
| A.020 | `institution_course_code` | Course | `ProgramRecord.codes.courseCode` | `src/ingest/programs.ts` | exact |
| A.021 | `nzqa_qualification_code` | Course | `ProgramRecord.codes.other` | `src/ingest/programs.ts` | exact |
| A.022 | `ontario_program_code` | Course | `ProgramRecord.codes.other` | `src/ingest/programs.ts` | exact |
| A.026 | `duration_standard` | Course | `ProgramRecord.duration` | `src/ingest/programs.ts` | exact |
| A.036 | `delivery_modes` | CourseOffering | `ProgramRecord.deliveryModes` | `src/ingest/programs.ts` | exact |
| A.074 | `entry_requirement_text` | Course | `ProgramRecord.entryRequirements.text` | `src/ingest/programs.ts` | exact |
| A.075 | `entry_requirement_items` | Course | `ProgramRecord.entryRequirements.academic` | `src/ingest/programs.ts` | exact |
| A.114 | `english_requirement_source_text` | Course | `ProgramRecord.englishRequirements` | `src/ingest/programs.ts` | exact |
| A.115 | `course_page_url` | Course | `ProgramRecord.sourceUrl` | `src/ingest/programs.ts` | exact |
| A.120 | `extraction_evidence` | Course | `ProgramRecord.evidence` | `src/ingest/programs.ts` | exact |
| B.001 | `institution_legal_name` | Institution | `PartnerRecord.name` | `src/partners/registry.ts` | exact |
| B.002 | `institution_aliases` | Institution | `PartnerRecord.aliases` | `src/partners/registry.ts` | exact |
| B.003 | `institution_country` | Institution | `PartnerRecord.country` | `src/partners/registry.ts` | exact |
| B.004 | `institution_website_url` | Institution | `PartnerRecord.website` | `src/partners/registry.ts` | partial |
| C.001 | `campus_name` | Campus | `ProgramRecord.campuses[]` | `src/ingest/programs.ts` | exact |
| C.008 | `campus_country` | Campus | `PartnerRecord.country` | `src/partners/registry.ts` | exact |
| C.053 | `course_campus_availability` | CourseOffering | `ProgramRecord.campuses[]` | `src/ingest/programs.ts` | exact |
| H.001 | `scholarship_available` | Institution | `ProgramRecord.scholarships[]` | `src/ingest/programs.ts` | partial |
| H.002 | `scholarship_amount` | Institution | `ProgramRecord.scholarships[].amount` | `src/ingest/programs.ts` | exact |
| H.003 | `scholarship_type` | Institution | `ProgramRecord.scholarships[].text` | `src/ingest/programs.ts` | exact |
| H.005 | `scholarship_criteria` | Institution | `ProgramRecord.scholarships[].text` | `src/ingest/programs.ts` | exact |
| H.007 | `scholarship_name` | Scholarship | `ProgramRecord.scholarships[].name` | `src/ingest/programs.ts` | exact |
| H.011 | `scholarship_description_text` | Scholarship | `ProgramRecord.scholarships[].text` | `src/ingest/programs.ts` | exact |
| H.016 | `scholarship_coverage_pct` | Scholarship | `ProgramRecord.scholarships[].amount` | `src/ingest/programs.ts` | exact |
| H.017 | `scholarship_amount_first_year` | Scholarship | `ProgramRecord.scholarships[].amount` | `src/ingest/programs.ts` | text-only |
| H.101 | `scholarship_count_for_course` | Course | `ProgramRecord.scholarships[].length` | `src/ingest/programs.ts` | exact |
| I.001 | `english_overall_min_normalized` | Course | `ProgramRecord.englishRequirements.ielts.overall` | `src/ingest/programs.ts` | partial |
| I.006 | `test_code` | Test | `ProgramRecord.englishRequirements` | `src/ingest/programs.ts` | null-ambiguous |
| I.048 | `accepted_english_tests` | Course | `ProgramRecord.englishRequirements` | `src/ingest/programs.ts` | null-ambiguous |
| I.049 | `english_test_accepted` | TestAcceptance | `ProgramRecord.englishRequirements` | `src/ingest/programs.ts` | null-ambiguous |
| I.050 | `english_overall_min` | TestAcceptance | `ProgramRecord.englishRequirements.<test>.overall` | `src/ingest/programs.ts` | exact |
| I.051 | `english_no_band_below` | TestAcceptance | `ProgramRecord.englishRequirements.<test>.minBand` | `src/ingest/programs.ts` | exact |
| I.053 | `english_requirement_source_quote` | TestAcceptance | `ProgramRecord.englishRequirements.other[]` | `src/ingest/programs.ts` | exact |
| I.059 | `english_online_test_accepted` | TestAcceptance | `ProgramRecord.englishRequirements.duolingo` | `src/ingest/programs.ts` | exact |
| I.095 | `english_discipline_uplift` | Course | `ProgramRecord.englishRequirements.ielts` | `src/ingest/programs.ts` | exact |
| I.111 | `agency_test_prep_class_ref` | Test | `persona.ts:company.services` | `src/config/persona.ts` | exact |
| K.010 | `application_deadline_international` | CourseOffering | `ProgramRecord.applicationDeadlines[].date` | `src/ingest/programs.ts` | text-only |
| L.001 | `tuition_by_offering` | CourseOffering | `ProgramRecord.tuition[].amount` | `src/ingest/programs.ts` | exact |
| L.002 | `tuition_fee_year` | CourseOffering | `ProgramRecord.tuition[].year` | `src/ingest/programs.ts` | exact |
| L.003 | `tuition_period_basis` | CourseOffering | `ProgramRecord.tuition[].period` | `src/ingest/programs.ts` | exact |
| L.004 | `tuition_audience` | CourseOffering | `ProgramRecord.tuition[].audience` | `src/ingest/programs.ts` | partial |
| Q.008 | `research_english_requirement` | Course | `ProgramRecord.englishRequirements` | `src/ingest/programs.ts` | exact |
| Q.009 | `research_application_rounds` | Course | `ProgramRecord.applicationDeadlines[]` | `src/ingest/programs.ts` | exact |
| Q.011 | `funding_stipend` | Course | `ProgramRecord.scholarships[].amount` | `src/ingest/programs.ts` | exact |
| Q.016 | `self_funded_research_tuition` | Course | `ProgramRecord.tuition[].amount` | `src/ingest/programs.ts` | exact |
| Q.019 | `research_mode_of_study` | Course | `ProgramRecord.deliveryModes[]` | `src/ingest/programs.ts` | exact |
| Q.020 | `candidature_length_years` | Course | `ProgramRecord.duration` | `src/ingest/programs.ts` | exact |
| R.009 | `school_type` | Institution | `PartnerDoc.notes` | `src/partners/registry.ts` | exact |
| R.012 | `school_tuition_fee` | Institution | `ProgramRecord.tuition[].amount` | `src/ingest/programs.ts` | exact |
| T.001 | `term_code` | IntakeCalendar | `ProgramRecord.intakes` | `src/ingest/programs.ts` | exact |
| T.002 | `intake_display_name` | IntakeCalendar | `ProgramRecord.intakes` | `src/ingest/programs.ts` | exact |
| T.017 | `application_close_date_international` | IntakeCalendar | `ProgramRecord.applicationDeadlines[].date` | `src/ingest/programs.ts` | text-only |
| T.039 | `intake_offered_flag` | IntakeCalendar | `ProgramRecord.intakes` | `src/ingest/programs.ts` | exact |
| T.041 | `fee_year_published` | Institution | `ProgramRecord.tuition[].year` | `src/ingest/programs.ts` | exact |
| U.029 | `grade_converter_tool_ref` | GradingScheme | `persona.ts:company.urls.gradeConverter` | `src/config/persona.ts` | exact |
| U.030 | `typical_min_for_bachelor_entry` | GradingScheme | `ProgramRecord.entryRequirements.academic[]` | `src/ingest/programs.ts` | exact |
| U.031 | `typical_min_for_masters_entry` | GradingScheme | `ProgramRecord.entryRequirements.academic[]` | `src/ingest/programs.ts` | exact |
| V.002 | `source_url` | Provenance | `ProgramRecord.sourceUrl` | `src/ingest/programs.ts` | exact |
| V.004 | `source_kind` | Provenance | `ProgramRecord.source` | `src/ingest/programs.ts` | exact |
| V.006 | `source_quote` | Provenance | `ProgramRecord.evidence[]` | `src/ingest/programs.ts` | exact |
| V.014 | `extracted_at` | Provenance | `ProgramRecord.extractedAt` | `src/ingest/programs.ts` | exact |
| V.015 | `extraction_model` | Provenance | `ProgramRecord.model` | `src/ingest/programs.ts` | exact |
| V.017 | `confidence` | Provenance | `ProgramRecord.confidence` | `src/ingest/programs.ts` | exact |
| V.018 | `record_updated_at` | Provenance | `ProgramRecord.updatedAt` | `src/ingest/programs.ts` | exact |
| V.019 | `content_hash` | Provenance | `ProgramRecord.contentHash; KbPageDoc.contentHash` | `src/ingest/programs.ts` | exact |
| V.020 | `crawl_run_id` | Provenance | `missing (KbIngestRunDoc._id exists but is not linked to records)` | `?` | exact |
| V.021 | `source_last_crawled` | Provenance | `KbPageDoc.lastCrawled` | `src/db/mongo.ts` | exact |
| V.022 | `source_last_changed` | Provenance | `KbPageDoc.lastChanged` | `src/db/mongo.ts` | exact |
| V.025 | `verification_state` | Provenance | `PartnerRecord.verified` | `src/partners/registry.ts` | exact |
| V.026 | `verified_by` | Provenance | `PartnerRecord.updatedBy` | `src/partners/registry.ts` | exact |
| V.055 | `answer_time_live` | Provenance | `EvidenceItem.live` | `src/tools/types.ts` | exact |
| V.056 | `answer_time_fetched_at` | Provenance | `EvidenceItem.fetchedAt` | `src/tools/types.ts` | exact |
| V.057 | `currency_code` | Provenance | `ProgramRecord.tuition[].currency` | `src/ingest/programs.ts` | exact |
| X.001 | `agency_legal_name` | Agency | `persona.ts:company.legalName` | `src/config/persona.ts` | exact |
| X.002 | `agency_founded_year` | Agency | `persona.ts:company.founded` | `src/config/persona.ts` | exact |
| X.003 | `agency_headquarters` | Agency | `persona.ts:company.headquarters` | `src/config/persona.ts` | exact |
| X.004 | `agency_footprint_stats` | Agency | `persona.ts:company.stats` | `src/config/persona.ts` | exact |
| X.005 | `agency_accreditations` | Agency | `persona.ts:company.accreditations` | `src/config/persona.ts` | exact |
| X.006 | `agency_markets` | Agency | `persona.ts:company.markets` | `src/config/persona.ts` | exact |
| X.007 | `agency_destinations_served` | Agency | `persona.ts:company.destinations` | `src/config/persona.ts` | exact |
| X.008 | `agency_partner_institutions_count` | Agency | `PartnerDoc.slug` | `src/partners/registry.ts` | exact |
| X.009 | `agency_public_urls` | Agency | `persona.ts:company.urls` | `src/config/persona.ts` | exact |
| X.010 | `agency_tools` | Agency | `persona.ts:company.urls.gradeConverter` | `src/config/persona.ts` | exact |
| X.011 | `services_and_fees` | Agency | `persona.ts:company.services` | `src/config/persona.ts` | exact |
| X.013 | `migration_agent_service_scope` | Agency | `persona.ts:company.urls.migrationAgents` | `src/config/persona.ts` | exact |
| X.016 | `branches` | Agency | `persona.ts:company.markets[].offices` | `src/config/persona.ts` | exact |
| X.019 | `onshore_office_services` | Agency | `persona.ts:company.urls.locationsAustralia` | `src/config/persona.ts` | exact |
| X.024 | `events` | Agency | `persona.ts:company.urls.events` | `src/config/persona.ts` | exact |
| X.027 | `social_and_contact_channels` | Agency | `persona.ts:company.urls.contact` | `src/config/persona.ts` | exact |
<!-- generated:stored-today:end -->

## Live fetch only

Rows Edge can answer at answer time from an allow-listed page but does not store. They work
today with a citation and a fetch timestamp; they cannot be filtered, compared or trended.

<!-- generated:live-only:start -->
| domain | rows | attributes |
|---|---|---|
| B (institution) | 1 | `pgwp_eligible_dli` |
| E (destination-visa) | 104 | `student_visa_type` `student_visa_subclass_code` `visa_lodgement_channel` `apply_onshore_allowed` `apply_window_before_course_start` `arrival_window_rule` `visa_grant_length_rule` `visa_extension_onshore_rule` `student_visa_fee` `dependant_visa_fee` `biometrics_required` `biometrics_fee` `health_exam_required` `panel_clinics_by_origin` `tb_test_countries` `visa_fee_refund_rule` `priority_processing_available` `priority_processing_fee` `financial_proof_required` `financial_proof_formula` `official_living_figure_primary` `official_living_figure_spouse` `official_living_figure_child` `tuition_component_rule` `school_fees_component_rule` `travel_component` `maintenance_funds_by_location` `funds_seasoning_days` `funds_recency_days` `sds_pal_variant` `gic_amount` `blocked_account_amount` `dependant_funds_rule` `annual_income_alternative` `annual_income_threshold_single` `annual_income_threshold_with_dependants` `accepted_fund_types` `funds_source_explanation_rule` `asset_types_accepted` `income_evidence_types` `accepted_sponsor_relationships` `sponsor_max_count` `loan_acceptance_rules` `funds_currency_and_translation_rule` `visa_english_requirement` `visa_english_accepted_tests` `visa_english_min` `visa_english_exemptions` `visa_english_validity_rule` `genuine_intent_test` `genuine_intent_factors` `genuine_intent_word_limits` `genuine_intent_package_assessment_rule` `visa_interview_likelihood` `interview_location_format` `visa_processing_time_weeks` `processing_time_official_range` `grant_rate_by_nationality` `grant_rate_period` `apply_arrive_window_rule` `visa_conditions` `work_hours_allowed_per_week` `work_hours_term` `work_hours_break` `work_start_rule` `placement_counts_toward_hours` `self_employment_gig_rules` `dependents_allowed` `study_load_condition` `address_and_change_notification_rule` `age_limits` `visa_condition_breach_consequences` `common_refusal_grounds` `refusal_notification_format` `appeal_body` `appeal_fee` `appeal_window_days` `reapply_rules` `fraud_bars` `refusal_history_disclosure_rule` `onshore_switching_rules` `change_provider_rules` `change_course_level_visa_rule` `policy_effective_date` `transitional_arrangements_rule` `visa_cancellation_grounds` `document_checklist_by_level_nationality` `passport_validity_rule` `translation_attestation_rules` `police_clearance_required` `photo_and_biometric_specification` `enrolment_evidence_document` `statement_of_purpose_visa_requirement` `identity_and_civil_documents_required` `form_and_declaration_specifics` `insurance_scheme` `insurance_mandatory` `insurance_cover_length_rule` `insurance_dependants_required` `insurance_exemptions` `visitor_visa_for_parents` `visitor_invitation_evidence` `under18_guardian_requirements` `student_guardian_visa_type` |
| F (post-study-migration) | 58 | `psw_visa_name` `psw_length_by_level` `psw_regional_extension` `psw_apply_within_days` `psw_age_max` `psw_english_min` `psw_study_duration_min` `psw_excluded_levels_or_courses` `psw_visa_fee` `psw_dependants_allowed` `psw_work_restrictions` `psw_onshore_lodgement_required` `psw_once_per_lifetime` `psw_bridging_work_rights` `psw_completion_evidence_required` `green_card_backlog_by_chargeability` `points_test_name` `points_test_pass_mark` `points_age_table` `points_english_table` `points_qualification_table` `points_skilled_employment_table` `points_partner_table` `points_naati_ccl` `points_professional_year` `points_state_nomination` `points_table_effective_date` `points_test_official_url` `crs_factor_table` `ee_category_draw_list` `ee_program_eligibility_rules` `ee_draw_recent_cutoffs` `state_nomination_annual_allocation` `regional_491_conditions` `employer_sponsored_visa_name` `employer_sponsored_salary_threshold` `employer_sponsored_experience_min` `employer_sponsored_occupation_list_required` `employer_sponsorship_pr_pathway_years` `work_in_field_required_for_pr` `pr_age_cutoff` `pr_application_fee` `onshore_pr_application_allowed_while_student` `pr_skills_assessment_required` `pr_health_character_requirements` `pr_processing_time_official` `migration_talent_visa_routes` `job_seeker_visa_name` `job_seeker_visa_length_months` `job_seeker_visa_work_allowed` `job_seeker_visa_conversion_target` `job_seeker_visa_fee` `citizenship_residency_years` `citizenship_student_time_counts` `pr_partner_inclusion_rules` `occupation_list_change_log` `migration_policy_change_pending` `migration_source_official_url` |
| G (occupation-career) | 13 | `occupation_list_membership` `skilled_occupation_list_status` `on_csol` `express_entry_crs_category` `skilled_worker_salary_threshold` `on_immigration_salary_list` `green_list_status` `green_list_role` `de_shortage_occupation_flag` `skillselect_occupation_ceiling` `skills_assessment_authority` `vacancy_count_current` `visa_sponsoring_employer_register` |
| P (family-dependants) | 19 | `dependant_eligibility_by_relationship` `partner_work_rights` `partner_study_rights` `child_school_access_rights` `dependant_visa_length_rule` `subsequent_entrant_process` `subsequent_entrant_fee` `dependant_visa_processing_time` `public_school_fee_by_region` `school_fee_exemptions` `school_age_range_by_region` `dependant_income_tax_and_benefits_note` `maternity_coverage` `child_born_in_destination_status` `child_citizenship_rule` `relationship_evidence` `dependant_visa_english_requirement` `family_health_cover_arrangement` `dependant_document_checklist` |
| Q (research-phd) | 4 | `research_work_hours_rule` `research_dependant_rights_note` `research_post_study_visa_length` `research_points_advantage` |
| R (school-and-under18) | 10 | `under18_min_age_for_visa` `guardian_visa` `welfare_arrangements` `custodian_requirements` `welfare_start_end_rule` `under18_turning_18_transition` `under18_visa_documents` `under18_genuine_intent_note` `minor_travel_and_holiday_rule` `school_completion_visa_transition` |
| S (regulated-professions) | 3 | `registration_fee` `exam_fee` `post_registration_visa_link` |
| W (destination-policy) | 13 | `caps_policy` `cap_allocation_by_region` `agent_regulation_status` `fx_rate_indicative` `fx_source` `policy_change_log` `policy_change_title` `policy_announced_at` `policy_effective_at` `policy_applies_to` `policy_transitional_rule` `policy_source_url` `policy_change_status` |
<!-- generated:live-only:end -->

## Missing

Rows with neither storage nor a live-fetch substitute, by domain and tier. "Entities with no
storage" lists the `01-entities.md` entities the domain's missing rows key on; an entity that
appears here and nowhere in the stored table has no collection or record type in `src/` at all.

<!-- generated:missing:start -->
| domain | tier 1 | tier 2 | tier 3 | total | entities with no storage |
|---|---|---|---|---|---|
| A (course) | 47 | 37 | 20 | 104 | Course, CourseOffering |
| B (institution) | 51 | 45 | 16 | 112 | Institution |
| C (campus-location) | 25 | 17 | 10 | 52 | Campus, CourseOffering, Region |
| D (city-cost-of-living) | 36 | 28 | 6 | 70 | City, Destination, Region |
| E (destination-visa) | 8 | 15 | 4 | 27 | Destination, Destination×Nationality, DocumentRequirement, FeeItem, VisaRule, VisaType |
| F (post-study-migration) | 29 | 12 | 4 | 45 | Campus, Course, Destination, Destination×Level, Institution, PolicyChange, Region, VisaType |
| G (occupation-career) | 39 | 24 | 15 | 78 | Course, CourseOccupation, Occupation |
| H (scholarship) | 37 | 37 | 23 | 97 | Course, Institution, Scholarship |
| I (english-and-tests) | 51 | 30 | 21 | 102 | Course, Institution, PathwayArticulation, Test, TestAcceptance, VisaType |
| J (pathways-articulation) | 28 | 14 | 3 | 45 | PathwayArticulation |
| K (application-process) | 36 | 41 | 18 | 95 | Course, CourseOffering, Destination, DocumentRequirement, FeeItem, Institution, SourceCountry |
| L (fees-and-money) | 50 | 32 | 10 | 92 | Course, CourseOffering, Destination, Destination×Nationality, FeeItem, FinanceProvider, Institution, SourceCountry |
| M (accommodation-arrival) | 38 | 21 | 2 | 61 | Accommodation, Agency, City, Destination, Destination×Nationality, Institution, Region |
| N (life-and-work-rights) | 27 | 45 | 30 | 102 | City, CourseOffering, Destination, Destination×Nationality, Institution, Region, VisaType |
| O (academic-rules) | 24 | 20 | 13 | 57 | Destination, Destination×Level, Institution |
| P (family-dependants) | 0 | 7 | 2 | 9 | City, Destination, Destination×Level, Destination×Nationality, Region |
| Q (research-phd) | 0 | 7 | 15 | 22 | Course, Institution |
| R (school-and-under18) | 0 | 0 | 15 | 15 | Accommodation, Destination×Level, FeeItem, Institution, PathwayArticulation |
| S (regulated-professions) | 0 | 23 | 7 | 30 | Course, FeeItem, ProfessionalBody |
| T (intake-calendar) | 26 | 16 | 1 | 43 | Agency, Destination, Institution, IntakeCalendar, Region, SourceCountry |
| U (source-country-grading) | 46 | 27 | 7 | 80 | GradingScheme, SourceCountry |
| V (meta-provenance) | 40 | 12 | 5 | 57 | Institution, Provenance |
| W (destination-policy) | 0 | 14 | 6 | 20 | Destination, Destination×Nationality, PolicyChange |
| X (agency) | 0 | 0 | 18 | 18 | Agency |
| **all** | 638 | 524 | 271 | 1433 | |
<!-- generated:missing:end -->

## Implications

**Coverage in one line.** Of 1,754 catalog rows, 96 map to a stored field (83 exact), 225
are live-fetch only and 1,433 are missing. Everything Edge answers about visas, money beyond
tuition, migration, occupations, scholarships as awards, cities, intakes and provenance is
prose retrieval plus a six-hour live cache.

**Collections to create, in Tier-1 order** (`05-priorities.md`). One MongoDB collection per
entity from `01-entities.md`, keyed as that file specifies, each value carrying the domain V
provenance object from the first extraction:

1. `Course` already exists as `kb_programs`; extend `ProgramRecord` with the A tier-1 fields (normalised minimums with scale, per-nationality accepted qualifications, three-year-bachelor flag, gap and backlog rules, framework level, `psw_eligible`, placement flag, status) rather than starting a new collection.
2. `CourseOffering` and `Campus` (C) must replace `campuses: string[]` before tuition-by-campus, regional flags and intake-specific deadlines are collected, or those values have no key to attach to.
3. `GradingScheme` and `SourceCountry` (U): small, hand-curated, unlocks every "my GPA is X" question.
4. `City` (D) with the official living figure per region; `Destination`, `Destination×Nationality`, `Destination×Level`, `VisaType`, `VisaRule`, `VisaCondition`, `FeeItem` (E): the government rows are small, high-value datasets that can be curated by hand for the five main destinations in days.
5. `Occupation` and `CourseOccupation` (F, G) with temporal list membership; `Scholarship` (H) promoted from `ProgramRecord.scholarships[]` free text; `Test` and `TestAcceptance` (I); `IntakeCalendar` (T).
6. Tier 2: `Institution` (B, today only the thin `PartnerDoc`), `DocumentRequirement` (K), `FinanceProvider` (L), `PathwayArticulation` (J), academic rules on `Institution` (O), family rows (P), `ProfessionalBody` (S), `PolicyChange` (W).
7. Tier 3: `Accommodation` (M), life rows (N), research variant of `Course` (Q), school rows (R), `Agency` (X, seeded from `PERSONA.company`).

**Tri-state at extraction.** Every `null` in today's `englishRequirements`, `entryRequirements`
and `scholarships` conflates "not on the page" with "not required"; the catalog uses
`required:<value>` / `not_required` / `unknown`. Retrofitting this onto thousands of stored
values is more expensive than capturing it in the extraction prompt, so the prompt and the
Zod schema change together with the first Tier-1 collection.

**Provenance at extraction.** The same argument applies to `valid_from`, `valid_to`,
`source_quote`, `confidence` and `reliability_tier` (domain V): `ProgramRecord.evidence[]` and
`extractedAt` are the seed of this object, not a substitute for it.

**Enum mismatch to resolve.** `PROGRAM_LEVELS` in `src/ingest/programs.ts` adds `other` and
drops `unspecified` relative to `STUDY_LEVELS` in `src/schemas/intent.schema.ts`, which the
`search_programs` tool filters on. The catalog's `course_level_coarse` and `course_level_fine`
rows assume one shared enum; pick `STUDY_LEVELS` plus `other` and migrate.

**Which live fetches should become imports.** Of the 225 live-fetch rows, the ones that are
compared, filtered or trended (`E.grant_rate_by_nationality`, `E.visa_processing_time_weeks`,
`E.financial_proof_required` and its components, `F.psw_length_by_level`, `F.points_*`,
`G.occupation_list_membership`, `W.caps_policy`, `W.policy_change_log`) need to be stored with
`valid_from` / `valid_to`, because a live fetch can only answer "what is it now", never "what
was it when the student lodged" or "which destination is better". The ones that are read
once per answer and change rarely (form codes, lodgement channels, document specifications)
can stay live-fetch indefinitely.

**Student profile.** The profile bag used by the playbooks is untyped and flat. The catalog's
variant axes (nationality, level, applicant type, region) are exactly the profile fields the
answer layer needs to pick a value; a typed `StudentProfile` with those axes is the smallest
change that lets any Tier-1 collection be queried correctly, even though the `Student` entity
itself stays out of scope.
