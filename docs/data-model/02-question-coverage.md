# 02 — Question coverage: 20 journey stages × student questions → attributes → playbook

This file is the exhaustiveness check for the catalog. It walks the student journey in the
twenty stages every other file keys on (`stages` column in `03-catalog/`, view triggers in
`07-counsellor-views.md`, phrasing in `08-vernacular.md`), lists the questions counsellors
actually hear at each stage in the student's own register, and names the catalog rows that
answer each one and the view (`07`) that renders the answer. Tables between
`<!-- generated:…:start/end -->` markers are produced by `bun run scripts/catalog.ts coverage --write`
from the `stages` column and must not be edited by hand; the **Student asks** lists are
hand-written and are the part that makes this a check rather than a pivot table. Every
backticked `Letter.name` token resolves to a `03-catalog/` row (`scripts/catalog.ts check --refs`).

## Stage key

The canonical S1–S20 list. `07-counsellor-views.md` repeats it; the checker warns if the two drift.

| stage | name | what the student is trying to decide |
|---|---|---|
| S1 | Enquiry & goal | Why go abroad, what outcome (degree, PR, career, family), who Expert is |
| S2 | Destination choice | Which country given budget, work rights, PR odds, family, English, safety |
| S3 | Course, level & pathways | Which level and program; direct entry vs packaged or pathway |
| S4 | Institution choice | Which university or college; ranking, cost, city, partner status |
| S5 | Eligibility, academics & grade conversion | Will my grades, gap, backlogs and degree length be accepted |
| S6 | English & admission tests | Which test, what score, waivers, validity, pathway weeks |
| S7 | Application | How to apply, documents, SOP/LOR, offer types, deposit |
| S8 | Finances | Total cost, living cost, funds to show, loans, GIC, FX |
| S9 | Scholarships | What is available, how much, deadline, odds |
| S10 | Visa | Type, fee, funds, genuine intent, processing, refusal risk |
| S11 | Pre-departure | Documents to carry, arrival, accommodation, bank, SIM, insurance |
| S12 | Life abroad | Work hours, wages, tax, safety, food, community, healthcare |
| S13 | Academic rules while enrolled | Attendance, progress, changing course or provider, leave |
| S14 | Family & dependants | Partner and children: rights, funds, school fees, timing |
| S15 | Post-study work, PR & licensing | PSW visa, points, nomination, occupation lists, registration |
| S16 | Careers & ROI | Salary, demand, recognition back home, payback |
| S17 | Alternatives & risk | Refusal odds, plan B destinations or courses, credibility |
| S18 | Special populations | Under-18s, research candidates, mature students, disabilities |
| S19 | Time-sensitive & policy change | Deadlines, processing peaks, what changed and when |
| S20 | Meta (how sure are we, sources) | Where did this come from, how fresh, can I quote it |

## Coverage summary

Rows per stage from the `stages` column. A row counts for every stage it lists.

<!-- generated:coverage-summary:start -->
| stage | name | rows | tier 1 | tier 2 | tier 3 | domains |
|---|---|---|---|---|---|---|
| S1 | Enquiry & goal | 32 | 8 | 2 | 22 | A G H T W X |
| S2 | Destination choice | 78 | 46 | 24 | 8 | B C D E F G H J L P S W X |
| S3 | Course, level & pathways | 195 | 111 | 57 | 27 | A B C E F G H I J L O Q R S T U W X |
| S4 | Institution choice | 121 | 59 | 43 | 19 | A B C D F G H J O T U X |
| S5 | Eligibility, academics & grade conversion | 148 | 91 | 44 | 13 | A B E F H I J K Q S U X |
| S6 | English & admission tests | 149 | 78 | 44 | 27 | A B E F H I J O P Q R S T U W X |
| S7 | Application | 221 | 110 | 74 | 37 | A B C E H I J K L Q T U X |
| S8 | Finances | 317 | 162 | 110 | 45 | A B C D E F G H I J K L M N O P Q R S T U V W X |
| S9 | Scholarships | 116 | 48 | 44 | 24 | A E H L Q T X |
| S10 | Visa | 232 | 150 | 62 | 20 | A B C D E H I J K L M O P R S T U W X |
| S11 | Pre-departure | 176 | 82 | 59 | 35 | A B C D E H I K L M N O P R S T U X |
| S12 | Life abroad | 216 | 61 | 107 | 48 | B C D E G H J K L M N P Q R T X |
| S13 | Academic rules while enrolled | 115 | 39 | 46 | 30 | A B C E H I J K L N O Q R T X |
| S14 | Family & dependants | 71 | 10 | 44 | 17 | B C D E F H I L M N O P Q R T |
| S15 | Post-study work, PR & licensing | 244 | 134 | 91 | 19 | A B C D E F G H I J N O Q S T W X |
| S16 | Careers & ROI | 125 | 56 | 45 | 24 | A B D F G L N Q S W |
| S17 | Alternatives & risk | 161 | 69 | 71 | 21 | A B C D E F G H I J K L M N O P T U W |
| S18 | Special populations | 77 | 9 | 25 | 43 | A B C D E F H I K M N R |
| S19 | Time-sensitive & policy change | 182 | 92 | 78 | 12 | A B C D E F G H I J K L M N O P Q S T U V W X |
| S20 | Meta (how sure are we, sources) | 127 | 83 | 26 | 18 | A B C D E F G H I J K O T U V W X |
<!-- generated:coverage-summary:end -->

Reading the table: S8 Finances, S15 Post-study and S10 Visa carry the most rows because
money, migration and visa facts vary by nationality and level. The thin stages are the
ones this file exists to expose: S1 Enquiry (32 rows, mostly X), S14 Family (71, mostly P
and E), S18 Special populations (77, mostly R and Q) and S2 Destination choice (78, mostly
derived W rows). Thin is acceptable where the answer is a small set of destination-level
facts; it is a gap where the student question is common and the rows are missing (see
**Gaps found**).

## S1 — Enquiry & goal

**Student asks**
- "Why should I study abroad instead of finishing here?" → `W.destination_pros_cons_summary`, `G.average_graduate_salary`, `F.psw_visa_name` (view 15).
- "Who are Expert Education, are you registered?" → `X.agency_legal_name`, `X.agency_accreditations`, `X.agency_footprint_stats`, `E.agent_lodgement_rule` (view 15).
- "What do you charge?" → `X.services_and_fees`, `X.service_eligibility_conditions`, `X.commission_disclosure_statement` (view 15).
- "Which branch should I go to, and can I do this online?" → `X.branches`, `X.branch_catchment`, `X.social_and_contact_channels`.
- "I want PR, not just a degree. Where do I start?" → `W.pr_pathway_strength`, `F.points_estimate_for_typical_graduate`, `G.occupation_list_membership` (views 4, 6).
- "When is your next education fair?" → `X.events`, `X.institution_visit_schedule`.
- "What do you need from me to start?" → `X.readiness_checklist`, `X.case_process_stages` (view 12).

**Attributes by domain**

<!-- generated:stage-S1:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.discipline_primary` `A.discipline_tags` `A.career_outcomes_listed` |  |  |
| G (occupation-career) | `G.job_demand_outlook` `G.average_graduate_salary` `G.graduate_employment_rate` | `G.occupation_alternative_titles` `G.occupation_description` |  |
| H (scholarship) | `H.scholarship_available` |  |  |
| T (intake-calendar) | `T.agency_events` |  |  |
| W (destination-policy) |  |  | `W.agent_regulation_status` |
| X (agency) |  |  | `X.agency_legal_name` `X.agency_founded_year` `X.agency_headquarters` `X.agency_footprint_stats` `X.agency_accreditations` `X.agency_markets` `X.agency_destinations_served` `X.agency_partner_institutions_count` `X.agency_public_urls` `X.agency_tools` `X.services_and_fees` `X.service_eligibility_conditions` `X.migration_agent_service_scope` `X.commission_disclosure_statement` `X.branches` `X.branch_catchment` `X.branch_specialisations` `X.test_prep_classes` `X.events` `X.webinar_recordings` `X.social_and_contact_channels` |
<!-- generated:stage-S1:end -->

**Playbooks and views:** `company_services`, `lead_engagement`, `greeting`, `general_inquiry` → views 15, 9. (The counsellor's own side of S1 — who enquired, who has not been followed up — is `caseload_management`.)

## S2 — Destination choice

**Student asks**
- "Australia or Canada for a married student?" → `E.dependents_allowed`, `P.partner_work_rights`, `P.family_destination_ranking_note` (view 4).
- "Which country is cheapest for a master's?" → `W.min_total_budget_first_year`, `W.cost_of_study_index`, `W.tuition_free_public` (views 2, 4).
- "Where is it easiest to get PR after study?" → `W.pr_pathway_strength`, `F.psw_length_by_level`, `F.points_test_pass_mark`, `F.ee_draw_recent_cutoffs` (views 4, 6).
- "Is Canada still taking Nepali students?" → `W.caps_policy`, `W.nationality_posture`, `E.grant_rate_by_nationality`, `E.sds_pal_variant` (views 4, 8).
- "How many hours can I work in each country?" → `E.work_hours_allowed_per_week`, `E.work_hours_break`, `Q.research_work_hours_rule` (view 4).
- "Is it safe for a girl alone?" → `D.safety_index`, `D.women_safety_index`, `D.suburb_safety_notes`, `N.emergency_number`.
- "Do I need German for Germany?" → `W.local_language_requirement`, `W.english_taught_program_share`, `I.local_language_test_required`.
- "Will my degree be recognised back in Nepal?" → `W.degree_recognition_source_country`, `W.one_year_masters_recognition`, `B.aiu_equivalence_recognised` (view 15).

**Attributes by domain**

<!-- generated:stage-S2:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| B (institution) | `B.institution_country` | `B.hpi_eligible` |  |
| C (campus-location) | `C.campus_city_ref` `C.campus_state_region` `C.campus_country` `C.location_classification` `C.regional_campus` `C.regional_category_au` `C.regional_study_nz` `C.distance_to_major_city_km` `C.nearest_major_city` `C.public_transport_rating` | `C.ca_location_category` `C.ca_rural_pilot_community` |  |
| D (city-cost-of-living) | `D.city_name` `D.city_country` `D.city_region_ref` `D.city_type` `D.city_population` `D.living_cost_estimate_annual` `D.cost_of_living_index` `D.cost_vs_national_avg_pct` `D.regional_vs_metro_saving_pct` `D.monthly_budget_bands` `D.student_part_time_job_market` `D.safety_index` `D.climate_type` `D.diaspora_community_presence` `D.public_transport_quality` |  | `D.qs_best_student_city_rank` |
| E (destination-visa) | `E.student_visa_type` `E.grant_rate_by_nationality` `E.dependents_allowed` | `E.entry_visa_required_by_nationality` |  |
| F (post-study-migration) | `F.psw_visa_name` `F.psw_length_by_level` `F.psw_regional_extension` `F.psw_months_normalized` `F.psw_pathway_to_pr_typical` `F.points_test_name` `F.pnp_stream_catalog` `F.state_nomination_graduate_stream` `F.employer_sponsorship_pr_pathway_years` `F.pr_typical_years_by_route` `F.job_seeker_visa_name` | `F.quebec_immigration_route` |  |
| G (occupation-career) | `G.occupation_code_crosswalk` `G.occupation_isco08_code` `G.pnp_in_demand_provinces` `G.state_nomination_demand` | `G.top_hiring_cities` | `G.occupation_international_transferability` |
| H (scholarship) | `H.govt_scholarship_scheme` |  |  |
| J (pathways-articulation) |  | `J.twinning_partner_institution` `J.twinning_split` |  |
| L (fees-and-money) | `L.fx_indicative_rate_to_origin` | `L.fx_12m_trend_pct` |  |
| P (family-dependants) |  | `P.dependant_eligibility_by_relationship` `P.main_applicant_swap_feasibility` `P.family_destination_ranking_note` |  |
| S (regulated-professions) |  |  | `S.registration_portability_home` |
| W (destination-policy) |  | `W.caps_policy` `W.cap_allocation_by_region` `W.nationality_posture` `W.degree_recognition` `W.degree_recognition_source_country` `W.local_language_requirement` `W.min_english_realistic_floor` `W.min_total_budget_first_year` `W.tuition_free_public` `W.destination_comparison_matrix` `W.pr_pathway_strength` `W.destination_pros_cons_summary` | `W.destination_market_share_observation` `W.english_taught_program_share` `W.cost_of_study_index` |
| X (agency) |  |  | `X.agency_destinations_served` `X.webinar_recordings` |
<!-- generated:stage-S2:end -->

**Playbooks and views:** `comparative_decision`, `migration_pathway`, `family_planning` → views 4, 6, 8.

## S3 — Course, level & pathways

**Student asks**
- "Is this a real master's or a graduate diploma?" → `A.course_level_coarse`, `A.aqf_level`, `A.national_framework_level_other` (view 1).
- "Can I go straight into the bachelor or do I need a foundation year?" → `J.pathway_type`, `J.from_qualification`, `J.entry_year_into_destination`, `J.guaranteed_progression` (view 7).
- "What is a packaged offer and is it risky?" → `J.packaged_offer_available`, `J.single_visa_packaging`, `E.genuine_intent_package_assessment_rule` (views 7, 8).
- "Does this course have an internship?" → `A.placement_mandatory`, `A.placement_hours_total`, `A.placement_paid`, `E.placement_counts_toward_hours`.
- "Will nursing here let me register as a nurse?" → `S.course_leads_to_registration`, `S.accredited_course_list_url`, `A.professionally_accredited` (view 14).
- "Which courses give me post-study work rights?" → `A.psw_eligible`, `F.psw_study_duration_min`, `B.pgwp_eligible_dli` (view 1).
- "Can I do a PhD without a master's?" → `Q.research_admission_min_qualification`, `Q.supervisor_required_before_application`, `Q.research_proposal_required_for_candidature`.
- "Can I change my major after I arrive?" → `A.specialisations_available`, `O.change_course_onshore_rule`, `E.change_course_level_visa_rule`.

**Attributes by domain**

<!-- generated:stage-S3:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.course_title_official` `A.course_level_fine` `A.course_level_coarse` `A.aqf_level` `A.nzqf_level` `A.fheq_rqf_level` `A.oqf_level` `A.cip_code` `A.discipline_primary` `A.discipline_tags` `A.cricos_course_code` `A.ucas_course_code` `A.institution_course_code` `A.awarding_body` `A.teaching_provider` `A.duration_standard` `A.duration_options` `A.thesis_or_coursework` `A.specialisations_available` `A.delivery_modes` `A.online_component_max_pct_for_visa` `A.offshore_online_start_allowed` `A.course_status` `A.international_seats_capped` `A.competitive_entry_flag` `A.accreditation_bodies` `A.professionally_accredited` `A.psw_eligible` `A.co_op_or_internship_included` `A.placement_type` `A.placement_hours_total` `A.placement_mandatory` `A.placement_paid` `A.placement_guaranteed` `A.cognate_or_conversion` `A.course_page_url` | `A.course_title_aliases` `A.eqf_level` `A.nfq_level` `A.mqf_level` `A.isced_level` `A.national_field_of_study_code` `A.nzqa_qualification_code` `A.ontario_program_code` `A.total_credit_points` `A.credit_unit_name` `A.units_total_count` `A.contact_hours_per_week` `A.study_load_options` `A.part_time_for_international` `A.sandwich_industry_year_available` `A.honours_pathway_available` `A.regional_campus_discount_pct` `A.accreditation_scope_note` `A.internal_popularity_score` `A.placement_arranged_by` `A.co_op_terms_count` `A.day1_cpt_available` `A.placement_or_internship_rate` `A.rpl_available` `A.rpl_max_credit_pct` `A.handbook_url` `A.course_summary` | `A.national_framework_level_other` `A.mqa_qualification_ref` `A.thesis_credit_share_pct` `A.major_declaration_timing` `A.double_degree_options` `A.exchange_availability` `A.class_size_typical` `A.assessment_mix` `A.course_laptop_spec_required` `A.brochure_url` |
| B (institution) | `B.institution_type` `B.on_campus_pathway_providers` `B.degree_awarding_status` | `B.has_medical_school` `B.validating_university` `B.qs_subject_ranks` | `B.has_law_school` |
| C (campus-location) | `C.campus_name` `C.campus_type` `C.course_campus_availability` | `C.campus_delivery_modes` |  |
| E (destination-visa) |  | `E.genuine_intent_package_assessment_rule` | `E.short_course_visa_type` |
| F (post-study-migration) | `F.psw_length_by_level` `F.post_study_work_visa_485_years` `F.psw_study_duration_min` `F.psw_excluded_levels_or_courses` `F.pgwp_length_months` `F.pgwp_field_of_study_eligible` `F.graduate_route_eligible` `F.psw_eligibility_for_course` `F.psw_months_normalized` `F.graduate_route_length_years` `F.psw_once_per_lifetime` `F.post_study_work_visa_eligible` `F.post_study_work_visa_length_years` `F.stem_opt_eligible` `F.opt_length_months` `F.points_qualification_table` `F.pr_points_study_level` `F.australian_study_requirement_met_by_course` `F.specified_stem_qualification_points` `F.professional_year_eligible` `F.ee_category_draw_list` `F.state_nomination_occupation_list` | `F.points_estimate_for_typical_graduate` |  |
| G (occupation-career) | `G.occupation_code` `G.occupation_title` `G.occupation_regulated_flag` `G.anzsco_occupation_codes` `G.on_sol` `G.noc_codes` `G.skilled_worker_soc_code` `G.course_occupation_course_id` `G.course_occupation_code` `G.course_occupation_is_primary` `G.course_occupation_requires_further_qualification` | `G.occupation_description` |  |
| H (scholarship) | `H.scholarship_eligible_levels` `H.scholarship_eligible_disciplines` `H.scholarship_eligible_courses` `H.scholarship_count_for_course` |  |  |
| I (english-and-tests) | `I.english_overall_min_normalized` `I.english_discipline_uplift` `I.local_language_test_required` |  |  |
| J (pathways-articulation) | `J.pathway_type` `J.pathway_name` `J.from_qualification` `J.from_qualification_level` `J.to_course_ref` `J.to_course_level` `J.pathway_provider` `J.credit_granted_points` `J.credit_granted_pct` `J.entry_year_into_destination` `J.guaranteed_progression` `J.pathway_duration` `J.total_duration_via_pathway` `J.time_delta_vs_direct_months` `J.pathway_status` | `J.pathway_provider_type` `J.same_campus` `J.twinning_partner_institution` `J.twinning_split` `J.transfer_to_partner_country_rules` `J.transfer_guaranteed_seat` `J.dual_award` `J.pathway_intakes_per_year` |  |
| L (fees-and-money) | `L.tuition_by_offering` |  |  |
| O (academic-rules) | `O.term_structure` `O.terms_per_year` |  |  |
| Q (research-phd) |  | `Q.supervisor_required_before_application` `Q.research_proposal_required_for_candidature` `Q.research_admission_min_qualification` `Q.candidature_length_years` | `Q.research_degree_types` `Q.supervisor_finder_url` `Q.research_experience_evidence` `Q.supervisor_contact_etiquette` `Q.research_mode_of_study` `Q.coursework_component_required` `Q.thesis_format_options` `Q.industry_phd_options` `Q.research_completion_rate` |
| R (school-and-under18) |  |  | `R.school_type` `R.school_curriculum` `R.school_leaver_university_entry_pathway` `R.foundation_year_vs_year12_comparison` |
| S (regulated-professions) |  | `S.profession` `S.course_leads_to_registration` `S.accredited_course_list_url` `S.quotas_admission_tests` `S.bridging_program` |  |
| T (intake-calendar) | `T.intake_season` `T.intake_status` `T.intake_offered_flag` | `T.intake_quality_note` |  |
| U (source-country-grading) | `U.typical_min_for_bachelor_entry` `U.typical_min_for_masters_entry` `U.direct_entry_year12_accepted` `U.year12_equivalent_name` `U.year12_stream_names` `U.bachelor_years_standard` `U.three_year_degree_accepted_by` `U.qualification_equivalence` | `U.typical_min_for_diploma_vet_entry` `U.honours_degree_meaning` `U.vocational_qualification_names` `U.vocational_articulation_accepted` |  |
| W (destination-policy) |  | `W.one_year_masters_recognition` | `W.english_taught_program_share` |
| X (agency) |  |  | `X.events` |
<!-- generated:stage-S3:end -->

**Playbooks and views:** `program_selection`, `alternative_pathways`, `eligibility_check` → views 1, 7, 14.

## S4 — Institution choice

**Student asks**
- "Is this university good? What is its ranking?" → `B.ranking_band_summary`, `B.qs_subject_ranks`, `B.qilt_overall_experience_pct` (view 4).
- "Is it a partner, and does that help me?" → `B.partner_priority_offer_turnaround_days`, `B.offer_turnaround_days`, `B.application_fee_policy`, `X.agency_partner_institutions_count`.
- "Is it a public university or a private college?" → `B.institution_type`, `B.cricos_provider_registration`, `B.dli_registration`, `B.us_regional_accreditor`.
- "How many Nepali students are there?" → `B.source_market_student_estimate`, `B.origin_student_society_present`, `D.diaspora_community_presence`.
- "Is this college risky for the visa?" → `E.evidence_level_by_provider`, `B.ca_dli_approval_rate_pct`, `B.known_student_concerns` (view 8).
- "Which campus is in a regional area?" → `C.campus_city_ref`, `C.nearest_major_city`, `F.regional_study_points` (view 6).
- "Is there on-campus housing and a pickup service?" → `C.on_campus_beds_count`, `C.on_campus_housing_weekly_cost_range`, `B.airport_pickup_offered` (view 2).

**Attributes by domain**

<!-- generated:stage-S4:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.course_title_official` `A.discipline_primary` `A.awarding_body` `A.teaching_provider` `A.specialisations_available` `A.course_status` `A.international_seats_capped` | `A.course_title_aliases` `A.internal_popularity_score` `A.internal_offer_conversion_note` | `A.seat_count_international` `A.student_staff_ratio` |
| B (institution) | `B.institution_legal_name` `B.institution_aliases` `B.institution_country` `B.institution_website_url` `B.institution_type` `B.ownership_type` `B.institution_group_memberships` `B.degree_awarding_status` `B.cricos_provider_registration` `B.asqa_rto_registration` `B.dli_registration` `B.ukprn_registration` `B.student_visa_sponsor_licensed` `B.sevis_school_code` `B.us_regional_accreditor` `B.nzqa_provider_registration` `B.pgwp_eligible_dli` `B.qs_world_rank` `B.the_world_rank` `B.ranking_band_summary` `B.visa_risk_rating` `B.notable_risks` `B.cap_allocation` `B.partner_status` `B.institution_summary_public` `B.counsellor_pitch_summary` | `B.founded_year` `B.campus_count` `B.has_medical_school` `B.validating_university` `B.teqsa_provider_category` `B.mqa_registration` `B.anabin_recognition` `B.ie_provider_registration` `B.khda_caa_licence` `B.tuition_protection_scheme` `B.us_news_global_rank` `B.national_rank` `B.qs_subject_ranks` `B.tef_rating` `B.qilt_overall_experience_pct` `B.nss_overall_satisfaction_pct` `B.institution_graduate_employment_pct` `B.total_enrolment` `B.international_student_count` `B.international_student_pct` `B.nationality_mix` `B.source_market_student_estimate` `B.source_market_presence_band` `B.hpi_eligible` `B.gs_top_ranked_flag` `B.international_prospectus_url` `B.key_selling_points` `B.known_student_concerns` | `B.religious_affiliation` `B.has_law_school` `B.mhesi_registration` `B.arwu_rank` `B.nsse_engagement_score` `B.institution_student_staff_ratio` `B.student_review_score` `B.acceptance_rate_pct` `B.alumni_chapters` `B.origin_student_society_present` |
| C (campus-location) | `C.campus_name` `C.campus_type` `C.campus_city_ref` `C.campus_postcode` `C.campus_status` `C.location_classification` `C.regional_campus` `C.regional_category_au` `C.regional_study_nz` `C.campus_latitude` `C.campus_longitude` `C.distance_to_major_city_km` `C.nearest_major_city` `C.distance_to_cbd_km` `C.course_campus_availability` | `C.transit_time_to_cbd_min` `C.campus_student_headcount` `C.campus_facilities` | `C.campus_opened_year` `C.campus_map_url` `C.campus_size_hectares` `C.campus_size_category` `C.campus_international_share_pct` |
| D (city-cost-of-living) | `D.city_name` `D.city_type` `D.city_population` |  | `D.qs_best_student_city_rank` |
| F (post-study-migration) | `F.psw_regional_extension` `F.regional_study_points` `F.pnp_stream_catalog` `F.state_nomination_graduate_stream` |  |  |
| G (occupation-career) |  | `G.top_hiring_cities` `G.salary_regional_metro_delta` |  |
| H (scholarship) |  | `H.scholarship_eligible_campuses` `H.scholarship_budget_signal` `H.govt_scheme_partner_institutions` |  |
| J (pathways-articulation) | `J.pathway_provider` | `J.pathway_provider_type` |  |
| O (academic-rules) |  | `O.attrition_rate` `O.completion_rate` |  |
| T (intake-calendar) | `T.intake_status` `T.agency_events` | `T.seats_signal` |  |
| U (source-country-grading) | `U.anabin_institution_status` |  |  |
| X (agency) |  |  | `X.agency_partner_institutions_count` |
<!-- generated:stage-S4:end -->

**Playbooks and views:** `university_selection`, `comparative_decision`, `visa_risk_analysis` → views 4, 8.

## S5 — Eligibility, academics & grade conversion

**Student asks**
- "My +2 GPA is 2.8, can I get in?" → `A.min_gpa_normalized`, `A.min_gpa_scale`, `U.grading_scale_type`, `U.conversion_table_url`, `U.conversion_authority` (view 1).
- "I have first division from TU, what is that in their scale?" → `U.division_labels`, `U.grading_pass_mark`, `U.grading_scale_max` (view 1).
- "Will my three-year bachelor be accepted for a master's?" → `A.three_year_bachelor_accepted`, `U.bachelor_years_standard`, `U.three_year_degree_accepted_by`, `U.qualification_equivalence` (view 1).
- "I have a two-year gap. Is that a problem?" → `A.study_gap_max_years`, `A.study_gap_documentation_required`, `E.genuine_intent_gap_scrutiny`, `U.gap_year_common_reasons` (views 1, 8).
- "I had three backlogs, all cleared." → `A.backlog_acceptance_max`, `U.backlog_terminology` (view 1).
- "Do they need my Grade 10 marks?" → `U.grade10_required_norm`, `U.year12_equivalent_name`.
- "Is there an age limit?" → `A.min_age`, `A.max_age`, `E.age_limits`, `F.psw_age_max`.
- "Do I need work experience for an MBA?" → `A.work_experience_years_required`, `A.work_experience_type_required`, `I.aptitude_test_min_score`.
- "Is there an interview or portfolio?" → `A.interview_required`, `A.portfolio_required`, `K.admission_interview_practice`, `K.portfolio_submission_process`.

**Attributes by domain**

<!-- generated:stage-S5:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.course_level_fine` `A.aqf_level` `A.nzqf_level` `A.fheq_rqf_level` `A.oqf_level` `A.duration_options` `A.competitive_entry_flag` `A.entry_requirement_text` `A.entry_requirement_items` `A.cognate_or_conversion` `A.cognate_disciplines_accepted` `A.prerequisite_subjects` `A.prerequisite_subjects_with_grade` `A.min_gpa_normalized` `A.min_gpa_scale` `A.min_entry_grade_raw` `A.min_gpa_percent_canonical` `A.accepted_qualifications_by_country` `A.three_year_bachelor_accepted` `A.min_age` `A.study_gap_max_years` `A.work_experience_years_required` `A.backlog_acceptance_max` `A.backlog_counting_method` `A.standardized_test_mandatory` `A.standardized_test_policy` `A.standardized_tests_accepted` `A.interview_required` `A.portfolio_required` `A.moi_waiver_accepted` | `A.eqf_level` `A.nfq_level` `A.mqf_level` `A.isced_level` `A.internal_offer_conversion_note` `A.assumed_knowledge` `A.grade_10_required` `A.international_curricula_accepted` `A.distance_learning_qualification_accepted` `A.course_provisional_certificate_accepted` `A.study_gap_documentation_required` `A.work_experience_type_required` `A.backlog_policy_text` `A.rpl_available` `A.rpl_max_credit_pct` `A.gre_gmat_middle_50` `A.sat_act_middle_50` | `A.national_framework_level_other` `A.mature_entry_policy` `A.backlog_policy_scope` `A.credit_transfer_recency_years` `A.max_age` `A.audition_required` `A.additional_selection_tasks` |
| B (institution) | `B.accepts_prior_visa_refusal_applicants` `B.conditional_offer_available` `B.provisional_certificate_accepted` `B.institution_study_gap_max_years` |  | `B.acceptance_rate_pct` |
| E (destination-visa) | `E.genuine_intent_gap_scrutiny` |  |  |
| F (post-study-migration) | `F.psw_age_max` `F.psw_study_duration_min` `F.psw_eligibility_for_course` `F.points_age_table` `F.pr_age_cutoff` | `F.age_points_decline_curve` |  |
| H (scholarship) | `H.scholarship_criteria` `H.scholarship_min_gpa` `H.scholarship_min_percentage` |  |  |
| I (english-and-tests) | `I.english_overall_min_normalized` `I.ielts_equivalent_overall` `I.school_english_marks_waiver` `I.aptitude_test_min_score` | `I.school_english_waiver_boards` `I.aptitude_test_waiver_rule` |  |
| J (pathways-articulation) | `J.pathway_type` `J.from_qualification` `J.from_qualification_level` `J.credit_granted_points` `J.guaranteed_progression` `J.progression_gpa_min` `J.progression_conditions_text` `J.pathway_entry_min_grade_raw` | `J.progression_english_condition_flag` `J.source_qualification_recency_years` |  |
| K (application-process) | `K.gap_explanation_threshold_months` `K.credential_evaluation_required` | `K.work_evidence_documents` `K.credential_evaluation_body` |  |
| Q (research-phd) |  | `Q.research_admission_min_qualification` |  |
| S (regulated-professions) |  | `S.source_qualification_recognition` `S.quotas_admission_tests` `S.registration_route_overseas_qualified` |  |
| U (source-country-grading) | `U.grading_scheme_id` `U.grading_scheme_name` `U.grading_scheme_issuer` `U.grading_scheme_level` `U.grading_scale_type` `U.grading_scale_max` `U.grading_scale_inverted` `U.grading_pass_mark` `U.grading_distinction_mark` `U.grade_band_labels` `U.division_labels` `U.school_english_subject_name` `U.to_gpa4_formula` `U.to_percentage_formula` `U.to_uk_class_mapping` `U.to_au_wam_mapping` `U.to_ca_gpa_mapping` `U.to_de_bavarian_formula` `U.conversion_authority` `U.typical_min_for_bachelor_entry` `U.typical_min_for_masters_entry` `U.direct_entry_year12_accepted` `U.year12_equivalent_name` `U.year10_equivalent_name` `U.year12_stream_names` `U.bachelor_years_standard` `U.three_year_degree_accepted_by` `U.qualification_framework_ref` `U.board_recognised_by` `U.anabin_institution_status` `U.credential_evaluation_commonly_required` `U.qualification_equivalence` `U.backlog_terminology` `U.backlog_counting_convention` | `U.grading_scheme_issuer_type` `U.grading_scheme_valid_from_year` `U.grading_scheme_valid_to_year` `U.grading_scale_min` `U.aggregate_computation_method` `U.minimum_grade_per_subject_rule` `U.conversion_table_url` `U.typical_min_for_diploma_vet_entry` `U.honours_degree_meaning` `U.distance_degree_acceptance` `U.vocational_qualification_names` `U.vocational_articulation_accepted` `U.qualification_authority_body` `U.transcript_shows_attempt_history` `U.gap_year_common_reasons` `U.grading_scheme_change_history` | `U.to_nz_us_gpa_note` `U.grade_inflation_signal` `U.grade_converter_tool_ref` `U.open_university_names` |
| X (agency) |  |  | `X.agency_tools` |
<!-- generated:stage-S5:end -->

**Playbooks and views:** `eligibility_check`, `program_selection` → view 1.

## S6 — English & admission tests

**Student asks**
- "What IELTS do I need for this course and the visa?" → `I.english_overall_min`, `I.english_section_min`, `E.visa_english_min`, `E.visa_english_requirement` (views 1, 13).
- "Is PTE accepted? Is it easier?" → `I.accepted_english_tests`, `I.english_test_accepted`, `I.english_equivalence_table`, `I.english_realistic_floor_by_test` (view 13).
- "My IELTS is 5.5 but they want 6.0. What now?" → `I.pathway_start_frequency`, `I.pathway_exit_assessment`, `I.pathway_direct_entry_on_completion`, `J.english_package_weeks_rule` (view 13).
- "Can I get an English waiver because I studied in English?" → `I.english_medium_prior_study_waiver`, `I.moi_waiver_levels_accepted`, `I.moi_waiver_accepted_countries`, `U.moi_letter_issuer`, `E.visa_english_exemptions`.
- "My IELTS is two years old. Still valid?" → `I.test_validity_months`, `I.visa_english_validity_months`, `E.visa_english_validity_rule`.
- "Is IELTS Online or TOEFL Home accepted?" → `I.english_home_edition_accepted`, `I.english_online_test_accepted`, `I.visa_accepted_english_tests`.
- "When is the next test date in Pokhara?" → `I.test_centre_cities`, `I.test_upcoming_dates`, `I.test_result_days`, `X.test_prep_classes`.
- "Does my wife need IELTS too?" → `I.dependant_english_required`, `P.dependant_visa_english_requirement`.
- "Nursing board wants 7 in each band, is that true?" → `S.english_standard`, `S.english_recency`, `I.english_discipline_uplift` (view 14).

**Attributes by domain**

<!-- generated:stage-S6:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.standardized_test_mandatory` `A.standardized_test_policy` `A.standardized_tests_accepted` `A.moi_waiver_accepted` `A.english_requirement_source_text` | `A.gre_gmat_middle_50` `A.sat_act_middle_50` |  |
| B (institution) | `B.on_campus_pathway_providers` `B.conditional_offer_available` |  |  |
| E (destination-visa) | `E.visa_english_requirement` `E.visa_english_accepted_tests` `E.visa_english_min` `E.visa_english_exemptions` | `E.standalone_english_course_visa_rule` `E.visa_english_validity_rule` |  |
| F (post-study-migration) | `F.psw_english_min` `F.points_english_table` `F.french_proficiency_bonus_relevant` |  |  |
| H (scholarship) |  | `H.scholarship_min_english_ielts_equivalent` |  |
| I (english-and-tests) | `I.english_overall_min_normalized` `I.english_test_waiver_available` `I.packaged_english_pathway_available` `I.english_pathway_length_weeks` `I.english_pathway_provider` `I.test_code` `I.test_name` `I.test_type` `I.test_score_scale` `I.test_sections` `I.test_delivery_modes` `I.test_validity_months` `I.test_fee` `I.test_result_days` `I.test_is_selt` `I.test_home_edition_available` `I.test_official_url` `I.test_score_report_method` `I.test_cefr_mapping` `I.english_equivalence_table` `I.english_equivalence_authority` `I.ielts_equivalent_overall` `I.accepted_english_tests` `I.english_test_accepted` `I.english_overall_min` `I.english_no_band_below` `I.english_section_min` `I.english_requirement_source_quote` `I.english_requirement_scope` `I.english_validity_months_for_admission` `I.english_validity_measured_to` `I.english_home_edition_accepted` `I.english_online_test_accepted` `I.english_condition_deadline_rule` `I.visa_accepted_english_tests` `I.visa_home_edition_accepted` `I.visa_english_validity_months` `I.visa_selt_required` `I.moi_waiver_max_years_since_study` `I.moi_waiver_accepted_countries` `I.moi_waiver_min_study_years` `I.moi_waiver_levels_accepted` `I.school_english_marks_waiver` `I.english_medium_prior_study_waiver` `I.internal_english_test_accepted` `I.english_waiver_visa_caveat` `I.pathway_english_course_name` `I.pathway_weeks_per_half_band` `I.pathway_max_weeks` `I.pathway_min_entry_score` `I.pathway_fee_per_week` `I.pathway_exit_assessment` `I.pathway_direct_entry_on_completion` `I.pathway_single_coe_packaged` `I.pathway_english_offers_conditional_package` `I.english_discipline_uplift` `I.english_uplift_test_restrictions` `I.aptitude_test_min_score` `I.local_language_test_required` `I.local_language_min_cefr` | `I.test_owner_body` `I.test_section_scale` `I.test_centre_cities` `I.test_frequency` `I.test_retake_wait_days` `I.test_one_skill_retake_available` `I.test_id_document_rule` `I.test_languages_offered` `I.test_registration_deadline_rule` `I.test_cycle_window` `I.test_status` `I.english_equivalence_conflict_note` `I.english_cefr_level_required` `I.english_osr_accepted` `I.english_score_verification_method` `I.visa_osr_accepted` `I.visa_english_test_date_measured_to` `I.dependant_english_required` `I.moi_waiver_accepted_boards` `I.school_english_waiver_boards` `I.english_native_speaker_exempt_countries` `I.pathway_start_frequency` `I.pathway_placement_test_on_arrival` `I.english_uplift_reason` `I.aptitude_test_waiver_rule` `I.local_language_prep_year_available` `I.naati_ccl_languages_available` `I.naati_ccl_pass_score` `I.test_upcoming_dates` `I.agency_test_prep_class_ref` | `I.test_duration_minutes` `I.test_centre_count_origin` `I.test_rescore_available` `I.test_rescore_fee` `I.test_free_score_sends_count` `I.test_additional_score_send_fee` `I.test_min_age` `I.test_superscoring_allowed_by_owner` `I.test_percentile_table_url` `I.test_accommodations_available` `I.test_speaking_format` `I.test_prep_official_materials_url` `I.english_combined_sittings_accepted` `I.internal_english_test_fee` `I.pathway_provider_same_campus` `I.pathway_attendance_rule` `I.aptitude_test_superscore_accepted` `I.naati_ccl_fee` `I.naati_ccl_result_weeks` `I.test_seat_availability_signal` `I.english_realistic_floor_by_test` |
| J (pathways-articulation) | `J.english_package_weeks_rule` | `J.progression_english_condition_flag` |  |
| O (academic-rules) |  | `O.english_support_during_course` |  |
| P (family-dependants) |  |  | `P.dependant_visa_english_requirement` |
| Q (research-phd) |  | `Q.research_english_requirement` |  |
| R (school-and-under18) |  |  | `R.school_english_entry_requirement` |
| S (regulated-professions) |  | `S.english_standard` `S.english_recency` `S.english_exemption_pathways` |  |
| T (intake-calendar) |  | `T.test_date_availability_window` |  |
| U (source-country-grading) | `U.school_english_subject_name` `U.medium_of_instruction_default` `U.moi_letter_issuer` |  |  |
| W (destination-policy) |  | `W.local_language_requirement` `W.min_english_realistic_floor` |  |
| X (agency) |  |  | `X.test_prep_classes` `X.mock_test_availability` `X.test_prep_outcomes_observation` `X.test_booking_assistance` |
<!-- generated:stage-S6:end -->

**Playbooks and views:** `test_preparation`, `eligibility_check`, `alternative_pathways` → views 13, 1.

## S7 — Application

**Student asks**
- "How do I apply, directly or through you?" → `K.application_channel`, `K.application_channel_fee`, `K.application_channel_url`, `K.agent_portal_platform` (view 12).
- "What documents do I need for the application?" → `K.doc_required`, `K.doc_type`, `K.doc_attestation_chain`, `U.translation_norm`, `U.verification_service` (view 12).
- "How long is the SOP and what do they ask?" → `K.sop_word_limit`, `K.sop_prompts`, `E.statement_of_purpose_visa_requirement`.
- "How are recommendation letters sent?" → `K.lor_submission_method`.
- "How long until I get an offer?" → `B.offer_turnaround_days`, `B.partner_priority_offer_turnaround_days`, `B.offer_types_available` (view 5).
- "What is a conditional offer and how do I accept it?" → `B.offer_types_available`, `K.acceptance_form_method`, `B.deposit_policy`, `L.first_payment_amount_estimated`.
- "When will I get my CoE / CAS / I-20?" → `K.enrolment_document_prerequisites`, `K.enrolment_document_issuance_lead_days`, `T.enrolment_confirmation_latest_issue_date`, `E.enrolment_evidence_document` (view 5).
- "Can I defer to the next intake?" → `B.deferral_policy`, `T.intake_status`, `T.intake_offered_flag`.
- "My name is spelt differently on my passport and transcript." → `B.name_mismatch_affidavit_accepted`, `U.name_mismatch_remedy_norm`.

**Attributes by domain**

<!-- generated:stage-S7:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.course_title_official` `A.cricos_course_code` `A.ucas_course_code` `A.institution_course_code` `A.interview_required` `A.portfolio_required` | `A.nzqa_qualification_code` `A.ontario_program_code` `A.internal_offer_conversion_note` `A.course_provisional_certificate_accepted` `A.study_gap_documentation_required` | `A.mqa_qualification_ref` `A.audition_required` `A.additional_selection_tasks` |
| B (institution) | `B.institution_legal_name` `B.institution_website_url` `B.cricos_provider_registration` `B.dli_registration` `B.ukprn_registration` `B.student_visa_sponsor_licensed` `B.ukvi_sponsor_status` `B.sevis_school_code` `B.nzqa_provider_registration` `B.nepal_moe_noc_eligible` `B.cap_allocation` `B.accepts_prior_visa_refusal_applicants` `B.pre_offer_financial_assessment_required` `B.institution_credibility_interview` `B.agent_only_application_nationalities` `B.application_fee_policy` `B.offer_turnaround_days` `B.conditional_offer_available` `B.offer_types_available` `B.offer_validity_days` `B.enrolment_confirmation_turnaround_days` `B.deposit_policy` `B.deferral_policy` `B.provisional_certificate_accepted` `B.application_portal_url` `B.international_office_contact` `B.partner_status` | `B.mqa_registration` `B.anabin_recognition` `B.ie_provider_registration` `B.khda_caa_licence` `B.partner_priority_offer_turnaround_days` `B.name_mismatch_affidavit_accepted` `B.agent_portal_url` `B.international_prospectus_url` | `B.mhesi_registration` `B.south_asia_representative_office` |
| C (campus-location) | `C.campus_address` `C.campus_timezone` |  |  |
| E (destination-visa) | `E.genuine_intent_word_limits` `E.statement_of_purpose_visa_requirement` |  |  |
| H (scholarship) | `H.scholarship_auto_awarded` `H.scholarship_requires_offer_first` `H.scholarship_application_required` `H.scholarship_separate_deadline` `H.scholarship_deadline_date` `H.scholarship_timing` `H.scholarship_offsets_deposit` | `H.scholarship_application_url` `H.scholarship_application_documents` `H.scholarship_essay_required` `H.scholarship_interview_required` `H.agent_scholarship_code` `H.phd_scholarship_requires_supervisor_confirmation` | `H.scholarship_reference_count` |
| I (english-and-tests) | `I.test_score_report_method` `I.english_condition_deadline_rule` `I.pathway_english_offers_conditional_package` | `I.test_id_document_rule` `I.english_score_verification_method` | `I.test_free_score_sends_count` |
| J (pathways-articulation) | `J.packaged_offer_available` | `J.progression_offer_timing` |  |
| K (application-process) | `K.application_channel` `K.agent_only_applications` `K.application_deadline_type` `K.application_deadline_international` `K.latest_realistic_lodge_date` `K.doc_type` `K.doc_required` `K.doc_required_at_stage` `K.doc_required_by` `K.doc_max_age_days` `K.doc_translation_required` `K.transcript_levels_required` `K.gap_explanation_threshold_months` `K.sop_required` `K.sop_word_limit` `K.lor_count` `K.lor_type` `K.portfolio_submission_process` `K.admission_interview_practice` `K.interview_stage` `K.interview_typical_topics` `K.gs_statement_question_set` `K.visa_history_declaration_required` `K.credential_evaluation_required` `K.atas_required` `K.enrolment_document_type` `K.enrolment_document_issuance_lead_days` `K.enrolment_document_prerequisites` `K.financial_pre_check_required` `K.acceptance_steps` `K.conditional_offer_condition_types` `K.accepted_payment_methods` `K.pre_lodgement_checklist` | `K.application_channel_fee` `K.application_channel_max_choices` `K.application_open_date` `K.application_rounds` `K.late_application_accepted` `K.offer_acceptance_window_days` `K.doc_format_rules` `K.doc_attestation_chain` `K.doc_alternative_accepted` `K.doc_template_url` `K.semester_wise_marksheets_required` `K.work_evidence_documents` `K.sop_prompts` `K.lor_submission_method` `K.cv_required` `K.portfolio_spec` `K.audition_process` `K.research_proposal_required` `K.interview_format` `K.gs_statement_word_limit` `K.credential_evaluation_body` `K.credential_evaluation_fee` `K.credential_evaluation_weeks` `K.atas_processing_weeks` `K.enrolment_document_observed_lead_days` `K.enrolment_document_amendment_process` `K.condition_satisfaction_deadline_rule` `K.offer_letter_contents_checklist` `K.multiple_applications_allowed` `K.course_change_after_offer_allowed` `K.campus_change_after_offer_allowed` `K.application_withdrawal_process` `K.application_status_vocabulary` `K.typical_rejection_reasons` `K.agent_lodgement_sla_days` `K.partner_agent_offer_sla_days` | `K.application_channel_url` `K.channel_agent_code_required` `K.agent_portal_platform` `K.application_form_quirks` `K.doc_issuer_accepted` `K.sop_submission_format` `K.lor_template_required` `K.audition_spec` `K.interview_conducted_by` `K.interview_outcome_turnaround_days` `K.credential_evaluation_report_type` `K.acceptance_form_method` `K.reapplication_after_rejection_allowed` `K.payment_confirmation_document` `K.payment_reconciliation_days` `K.common_application_errors` `K.escalation_contact_role` |
| L (fees-and-money) | `L.fee_item_due_at` `L.first_payment_rule` `L.first_payment_due_rule` | `L.fee_item_waivable_for_agents` |  |
| Q (research-phd) |  | `Q.supervisor_required_before_application` `Q.research_proposal_required_for_candidature` | `Q.research_proposal_guidelines` `Q.research_experience_evidence` `Q.supervisor_contact_etiquette` |
| T (intake-calendar) | `T.institution_shutdown_periods` `T.application_open_date_international` `T.application_close_date_international` `T.late_application_accepted_until` `T.conditional_offer_evidence_deadline` `T.offer_acceptance_deadline` `T.deposit_deadline` `T.enrolment_confirmation_latest_issue_date` `T.recommended_application_lodge_by` `T.backward_timeline_template` `T.public_holidays_origin` `T.agency_document_lead_times` | `T.application_close_date_domestic` `T.deferral_request_deadline` |  |
| U (source-country-grading) | `U.year10_equivalent_name` `U.grade10_required_norm` `U.credential_evaluation_commonly_required` `U.moi_letter_issuer` `U.transcript_issuer` `U.provisional_certificate_norm` `U.verification_service` `U.apostille_available` `U.document_language` `U.transcript_english_available_from_issuer` `U.translation_norm` `U.date_calendar_system` `U.name_format_issues` `U.result_publication_months` | `U.qualification_authority_body` `U.transcript_shows_attempt_history` `U.gap_evidence_norm` `U.transcript_turnaround_days` `U.transcript_sealed_envelope_norm` `U.degree_certificate_delay_months` `U.verification_service_url` `U.attestation_chain` `U.name_mismatch_remedy_norm` `U.predicted_grades_available` `U.origin_public_holidays_affecting_documents` | `U.moi_letter_turnaround_days` `U.character_migration_certificate_norm` `U.verification_fee` `U.verification_turnaround_days` |
| X (agency) |  |  | `X.services_and_fees` `X.service_eligibility_conditions` `X.service_turnaround_times` `X.institution_visit_schedule` `X.readiness_checklist` `X.case_process_stages` |
<!-- generated:stage-S7:end -->

**Playbooks and views:** `application_process`, `document_preparation`, `offer_enrolment`, `strategic_planning` → views 12, 5.

## S8 — Finances

**Student asks**
- "What is the total cost for the first year?" → `L.tuition_by_offering`, `L.non_tuition_fees_total_first_year`, `D.living_cost_estimate_annual`, `L.total_cost_of_attendance`, `W.min_total_budget_first_year` (view 2).
- "How much do I need to show the embassy?" → `E.financial_proof_required`, `E.financial_proof_formula`, `E.official_living_figure_primary`, `E.tuition_component_rule`, `E.travel_component` (view 3).
- "What counts as funds? Can my uncle sponsor me?" → `E.accepted_fund_types`, `E.accepted_sponsor_relationships`, `E.sponsor_max_count`, `E.income_evidence_types` (view 3).
- "How long must the money sit in the account?" → `E.funds_seasoning_days`, `E.funds_recency_days`, `E.funds_source_explanation_rule` (view 3).
- "Do they accept an education loan from a Nepali bank?" → `E.loan_acceptance_rules`, `L.loan_lender_type`, `L.loan_accepted_as_evidence_by`, `L.loan_sanction_turnaround_days`, `L.loan_collateral_required`.
- "What is a GIC / blocked account and where do I open it?" → `E.gic_amount`, `E.blocked_account_amount`, `L.finance_provider_name`, `L.funds_product_type`, `L.funds_product_processing_days`.
- "How do I actually pay the university from Nepal?" → `K.tuition_payment_process_by_origin`, `K.accepted_payment_methods`, `L.origin_fx_remittance_limit`, `U.moe_noc_rules`, `L.payment_channel_fee_pct`.
- "How much is that in rupees?" → `W.fx_rate_indicative`, `W.fx_source`, `V.fx_rate_used`, `V.fx_as_of`, `W.fx_12m_trend` (view 2).
- "Will the fees go up next year?" → `L.tuition_annual_indexation_pct`, `L.tuition_historic_increase_pct`, `B.fee_increase_policy`.
- "Can I pay in instalments?" → `B.payment_plan_available`, `L.first_payment_due_days`, `L.payment_schedule_projection`.
- "How much can I earn part-time?" → `D.typical_student_hourly_wage`, `D.weekly_earnings_potential`, `N.min_wage_hourly_by_region`, `E.work_hours_allowed_per_week` (view 2).

**Attributes by domain**

<!-- generated:stage-S8:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.duration_standard` `A.duration_options` `A.placement_paid` | `A.regional_campus_discount_pct` `A.rpl_available` `A.rpl_max_credit_pct` | `A.course_textbook_cost_estimate` |
| B (institution) | `B.nepal_moe_noc_eligible` `B.pre_offer_financial_assessment_required` `B.application_fee_policy` `B.deposit_policy` `B.refund_schedule` `B.fee_increase_policy` `B.payment_plan_available` `B.payment_channels` | `B.tuition_protection_scheme` `B.annual_fee_increase_typical_pct` `B.payment_plan_terms` |  |
| C (campus-location) | `C.campus_city_ref` `C.student_transport_concession` `C.on_campus_housing_weekly_cost_range` |  |  |
| D (city-cost-of-living) | `D.living_cost_estimate_annual` `D.cost_of_living_index` `D.cost_source` `D.cost_year` `D.cost_vs_national_avg_pct` `D.regional_vs_metro_saving_pct` `D.rent_shared_room_weekly` `D.rent_single_room_shared_house_weekly` `D.utilities_monthly` `D.groceries_weekly` `D.transport_pass_monthly` `D.monthly_budget_bands` `D.rental_bond_weeks` `D.rent_in_advance_weeks` `D.one_off_setup_cost` `D.official_living_cost_for_visa` `D.official_living_cost_effective_date` `D.local_minimum_wage_hourly` `D.typical_student_hourly_wage` `D.part_time_hours_realistically_available` `D.student_part_time_job_market` `D.weekly_earnings_potential` `D.flight_cost_estimate_from_origin` | `D.rent_studio_weekly` `D.rent_one_bed_apartment_weekly` `D.rent_on_campus_weekly_typical` `D.homestay_weekly_cost_typical` `D.phone_plan_monthly` `D.home_internet_monthly` `D.entertainment_monthly` `D.textbooks_annual` `D.official_vs_actual_cost_gap_pct` `D.casual_loading_pct_reference` `D.tax_free_threshold_reference` `D.remittance_options` | `D.eating_out_meal_cost` `D.remittance_cost_typical_pct` |
| E (destination-visa) | `E.student_visa_fee` `E.financial_proof_required` `E.financial_proof_formula` `E.official_living_figure_primary` `E.tuition_component_rule` `E.maintenance_funds_by_location` `E.evidence_level_by_provider` `E.funds_seasoning_days` `E.funds_recency_days` `E.gic_amount` `E.blocked_account_amount` `E.accepted_fund_types` `E.funds_source_explanation_rule` `E.accepted_sponsor_relationships` `E.loan_acceptance_rules` `E.funds_evidence_checklist` `E.work_hours_allowed_per_week` `E.work_hours_term` `E.work_hours_break` `E.insurance_scheme` `E.insurance_mandatory` `E.insurance_cover_length_rule` | `E.dependant_visa_fee` `E.biometrics_fee` `E.health_exam_fee` `E.visa_fee_refund_rule` `E.official_living_figure_spouse` `E.official_living_figure_child` `E.school_fees_component_rule` `E.travel_component` `E.dependant_funds_rule` `E.annual_income_alternative` `E.annual_income_threshold_single` `E.annual_income_threshold_with_dependants` `E.asset_types_accepted` `E.income_evidence_types` `E.funds_currency_and_translation_rule` `E.appeal_fee` `E.insurance_dependants_required` | `E.priority_processing_fee` `E.sponsor_max_count` `E.insurance_exemptions` |
| F (post-study-migration) |  | `F.psw_visa_fee` `F.pr_application_fee` | `F.state_nomination_fee` `F.job_seeker_visa_fee` |
| G (occupation-career) | `G.average_graduate_salary` | `G.skills_assessment_fee` `G.professional_year_cost` |  |
| H (scholarship) | `H.scholarship_available` `H.scholarship_amount` `H.scholarship_coverage_type` `H.scholarship_coverage_pct` `H.scholarship_amount_first_year` `H.scholarship_amount_total` `H.scholarship_stackable` `H.scholarship_timing` `H.scholarship_payment_method` `H.scholarship_offsets_deposit` `H.bursary_regional_origin_pct` `H.scholarship_best_case_value` `H.scholarship_likely_value` `H.net_tuition_after_scholarship` | `H.scholarship_living_allowance` `H.scholarship_reduces_visa_funds_evidence` `H.sibling_discount_pct` `H.alumni_discount_pct` `H.early_payment_discount_pct` `H.phd_scholarship_stipend_annual` `H.phd_scholarship_tuition_waiver` `H.need_based_bursary_available` `H.hardship_fund_available` | `H.scholarship_stackable_with` `H.early_payment_deadline_rule` `H.phd_scholarship_top_up_available` `H.need_based_bursary_amount` |
| I (english-and-tests) | `I.english_pathway_length_weeks` `I.test_fee` `I.pathway_weeks_per_half_band` `I.pathway_fee_per_week` |  | `I.test_rescore_fee` `I.test_free_score_sends_count` `I.test_additional_score_send_fee` `I.internal_english_test_fee` `I.naati_ccl_fee` |
| J (pathways-articulation) | `J.credit_granted_points` `J.credit_granted_pct` `J.entry_year_into_destination` `J.pathway_duration` `J.total_duration_via_pathway` `J.time_delta_vs_direct_months` `J.pathway_stage_tuition` `J.total_cost_via_pathway` `J.cost_delta_vs_direct` | `J.twinning_split` |  |
| K (application-process) | `K.financial_pre_check_required` `K.financial_pre_check_amount_rule` `K.financial_pre_check_evidence_list` `K.accepted_payment_methods` `K.tuition_payment_process_by_origin` | `K.application_channel_fee` `K.credential_evaluation_fee` `K.third_party_payer_allowed` `K.origin_remittance_processing_days` `K.living_expense_remittance_process` | `K.payment_confirmation_document` |
| L (fees-and-money) | `L.tuition_by_offering` `L.tuition_fee_year` `L.tuition_period_basis` `L.tuition_audience` `L.tuition_annual_indexation_pct` `L.tuition_total_course` `L.tuition_converted_to_origin_currency` `L.fee_item_type` `L.fee_item_amount` `L.fee_item_frequency` `L.fee_item_due_at` `L.fee_item_mandatory` `L.fee_item_refundable` `L.non_tuition_fees_total_first_year` `L.first_payment_rule` `L.first_payment_amount_estimated` `L.first_payment_due_rule` `L.visa_refusal_refund_pct` `L.refund_admin_fee` `L.refund_processing_days` `L.insurance_provider_name` `L.insurance_premium_single` `L.insurance_premium_couple` `L.insurance_premium_family` `L.insurance_policy_period_rule` `L.insurance_institution_preferred_provider` `L.insurance_bundled_in_first_payment` `L.finance_provider_type` `L.finance_provider_name` `L.funds_product_type` `L.funds_product_setup_fee` `L.funds_product_processing_days` `L.funds_product_release_schedule` `L.funds_product_accepted_by_authority` `L.funds_product_refund_on_refusal` `L.loan_lender_type` `L.loan_max_amount` `L.loan_interest_rate_pct` `L.loan_collateral_required` `L.loan_co_applicant_required` `L.loan_moratorium_months` `L.loan_disbursement_mode` `L.loan_sanction_turnaround_days` `L.loan_accepted_as_evidence_by` `L.loan_sanction_letter_requirements` `L.fx_indicative_rate_to_origin` `L.fx_indicative_as_of` `L.origin_fx_remittance_limit` `L.origin_remittance_tax_pct` `L.net_fee_after_scholarship` `L.cost_of_attendance_formula_inputs` `L.living_cost_basis_used` `L.total_cost_of_attendance` `L.first_year_cash_required` | `L.tuition_historic_increase_pct` `L.tuition_locked_at_enrolment` `L.fee_per_credit_point` `L.course_incidental_costs` `L.fee_item_included_in_first_payment` `L.fee_item_waivable_for_agents` `L.first_payment_due_days` `L.subsequent_payment_due_rule` `L.late_payment_penalty` `L.late_payment_consequence` `L.refund_evidence_required` `L.refund_payee_rule` `L.payment_channel_fee_pct` `L.payment_channel_fx_margin_pct` `L.payment_channel_origin_support` `L.invoice_currency_policy` `L.tuition_protection_scheme_name` `L.tuition_protection_coverage_rule` `L.insurance_waiver_rule` `L.funds_product_monthly_fee` `L.funds_product_documents_required` `L.loan_collateral_types_accepted` `L.loan_margin_pct` `L.loan_repayment_tenure_years` `L.loan_covered_expenses` `L.asset_liquidation_documentation` `L.fx_12m_trend_pct` `L.origin_remittance_channel_options` `L.payment_schedule_projection` `L.pre_departure_travel_budget` `L.estimated_roi_years` `L.roi_formula_inputs` | `L.failed_unit_repeat_fee` `L.refund_currency_rule` `L.payment_channel_settlement_days` `L.tuition_protection_student_levy` `L.insurance_premium_dependant_child` `L.funds_product_interest_pct` `L.loan_processing_fee` `L.education_cost_tax_deductibility_note` `L.fx_rate_source` `L.origin_remittance_indicative_fee` |
| M (accommodation-arrival) | `M.accommodation_weekly_cost` `M.accommodation_bond_amount` `M.accommodation_bills_included` `M.pre_arrival_bank_account_options` `M.customs_cash_declaration_threshold` | `M.accommodation_meals_included` `M.accommodation_payment_schedule` |  |
| N (life-and-work-rights) | `N.min_wage_hourly_by_region` `N.part_time_income_monthly_estimate` `N.student_transport_concession_eligibility` | `N.living_cost_coverage_by_work_pct` `N.student_transport_concession_pass_cost` |  |
| O (academic-rules) |  | `O.unit_repeat_policy` `O.release_letter_fee` | `O.textbook_cost_typical_annual` |
| P (family-dependants) |  | `P.subsequent_entrant_fee` `P.additional_funds_per_dependant` `P.public_school_fee_by_region` `P.school_fee_exemptions` `P.family_housing_rent` `P.family_total_first_year_budget` `P.maternity_coverage` | `P.childcare_cost_subsidy` `P.family_health_cover_arrangement` |
| Q (research-phd) |  | `Q.funding_stipend` `Q.funding_tuition_waiver` `Q.funding_duration_years` `Q.candidature_length_years` `Q.research_work_hours_rule` | `Q.self_funded_research_tuition` `Q.stipend_adequacy_vs_city_cost` `Q.research_allowances` |
| R (school-and-under18) |  |  | `R.school_tuition_fee` `R.school_boarding_fee` `R.homestay_fee` `R.school_welfare_fee` |
| S (regulated-professions) |  | `S.registration_fee` `S.exam_fee` `S.bridging_cost` |  |
| T (intake-calendar) | `T.census_date` `T.deposit_deadline` `T.fee_year_published` `T.agency_document_lead_times` |  | `T.next_fee_release_expected` |
| U (source-country-grading) | `U.moe_noc_rules` |  | `U.verification_fee` |
| V (meta-provenance) | `V.currency_code` `V.fx_rate_used` `V.fx_as_of` |  |  |
| W (destination-policy) |  | `W.min_total_budget_first_year` `W.tuition_free_public` `W.fx_rate_indicative` | `W.cost_of_study_index` `W.fx_source` `W.fx_12m_trend` `W.fx_display_rounding_rule` |
| X (agency) |  |  | `X.agency_tools` |
<!-- generated:stage-S8:end -->

**Playbooks and views:** `financial_viability` → views 2, 3.

## S9 — Scholarships

**Student asks**
- "Is there any scholarship for me?" → `H.scholarship_available`, `H.scholarship_eligible_levels`, `H.scholarship_eligible_nationalities`, `H.scholarship_min_gpa` (view 11).
- "How much does it cover?" → `H.scholarship_coverage_type`, `H.scholarship_coverage_pct`, `H.scholarship_amount_first_year`, `H.scholarship_living_allowance` (view 11).
- "Do I need a separate application and by when?" → `H.scholarship_application_required`, `H.scholarship_separate_deadline`, `H.scholarship_deadline_date`, `T.scholarship_application_deadline` (views 11, 5).
- "What are my chances?" → `H.scholarship_competitiveness`, `H.scholarship_number_available`.
- "Does it reduce my deposit or funds to show?" → `H.scholarship_offsets_deposit`, `H.scholarship_payment_method`, `E.accepted_fund_types`.
- "Can I keep it in second year?" → `H.scholarship_renewable`, `H.scholarship_renewal_gpa_min`, `H.scholarship_stackable`.
- "What about Chevening / Australia Awards / DAAD?" → `H.govt_scholarship_scheme`, `H.scholarship_return_home_bond`, `H.govt_scheme_success_rate_pct`.
- "Is a PhD fully funded?" → `H.phd_scholarship_scheme`, `H.phd_scholarship_stipend_annual`, `H.phd_scholarship_tuition_waiver`, `Q.funding_stipend`, `Q.funding_duration_years`.
- "My brother studied there, is there a discount?" → `H.sibling_discount_pct`, `H.alumni_discount_pct`, `H.early_payment_discount_pct`.

**Attributes by domain**

<!-- generated:stage-S9:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) |  | `A.regional_campus_discount_pct` |  |
| E (destination-visa) | `E.enrolment_evidence_document` |  |  |
| H (scholarship) | `H.scholarship_available` `H.scholarship_amount` `H.scholarship_type` `H.scholarship_auto_awarded` `H.scholarship_criteria` `H.scholarship_id` `H.scholarship_name` `H.scholarship_provider_type` `H.scholarship_provider_name` `H.scholarship_official_url` `H.scholarship_status` `H.scholarship_valid_intakes` `H.scholarship_last_verified_at` `H.scholarship_coverage_type` `H.scholarship_coverage_pct` `H.scholarship_amount_first_year` `H.scholarship_amount_total` `H.scholarship_duration_years` `H.scholarship_renewable` `H.scholarship_eligible_levels` `H.scholarship_eligible_disciplines` `H.scholarship_eligible_courses` `H.scholarship_eligible_nationalities` `H.scholarship_min_gpa` `H.scholarship_min_percentage` `H.scholarship_requires_offer_first` `H.scholarship_application_required` `H.scholarship_separate_deadline` `H.scholarship_deadline_date` `H.scholarship_deadline_type` `H.scholarship_number_available` `H.scholarship_competitiveness` `H.scholarship_stackable` `H.scholarship_timing` `H.scholarship_payment_method` `H.scholarship_offsets_deposit` `H.scholarship_conditions_text` `H.bursary_regional_origin_pct` `H.govt_scholarship_scheme` `H.govt_scheme_eligible_origin_countries` `H.govt_scheme_application_window` `H.scholarship_count_for_course` `H.scholarship_best_case_value` `H.scholarship_likely_value` `H.net_tuition_after_scholarship` | `H.scholarship_description_text` `H.scholarship_renewal_gpa_min` `H.scholarship_renewal_conditions_text` `H.scholarship_living_allowance` `H.scholarship_excluded_nationalities` `H.scholarship_eligible_campuses` `H.scholarship_applicant_type` `H.scholarship_min_english_ielts_equivalent` `H.scholarship_work_experience_years_min` `H.scholarship_excludes_other_funding` `H.scholarship_early_bird_deadline` `H.scholarship_application_url` `H.scholarship_application_documents` `H.scholarship_essay_required` `H.scholarship_interview_required` `H.scholarship_decision_weeks` `H.scholarship_reduces_visa_funds_evidence` `H.scholarship_deferral_allowed` `H.scholarship_return_home_bond` `H.scholarship_return_home_years` `H.sibling_discount_pct` `H.alumni_discount_pct` `H.early_payment_discount_pct` `H.agent_exclusive_scholarship` `H.agent_scholarship_code` `H.scholarship_budget_signal` `H.govt_scheme_selection_rounds` `H.govt_scheme_success_rate_pct` `H.govt_scheme_partner_institutions` `H.phd_scholarship_scheme` `H.phd_scholarship_stipend_annual` `H.phd_scholarship_tuition_waiver` `H.phd_scholarship_duration_years` `H.phd_scholarship_rounds_per_year` `H.phd_scholarship_requires_supervisor_confirmation` `H.need_based_bursary_available` `H.scholarship_deadline_days_before_course_start` | `H.scholarship_covers_travel` `H.scholarship_covers_insurance` `H.scholarship_covers_dependants` `H.scholarship_taxable` `H.scholarship_age_limit` `H.scholarship_target_groups` `H.scholarship_reference_count` `H.scholarship_success_rate_pct` `H.scholarship_stackable_with` `H.scholarship_bond_penalty_text` `H.early_payment_deadline_rule` `H.govt_scheme_covers_flights` `H.govt_scheme_visa_pathway_note` `H.phd_scholarship_success_rate_pct` `H.phd_stipend_tax_free` `H.phd_scholarship_top_up_available` `H.sports_scholarship_available` `H.sports_scholarship_sports` `H.sports_scholarship_level_required` `H.need_based_bursary_amount` `H.scholarship_matcher_eligible` |
| L (fees-and-money) | `L.net_fee_after_scholarship` |  |  |
| Q (research-phd) |  | `Q.research_application_rounds` `Q.funding_stipend` `Q.funding_tuition_waiver` `Q.funding_duration_years` `Q.funding_type` `Q.funding_competitiveness` |  |
| T (intake-calendar) | `T.scholarship_application_deadline` |  |  |
| X (agency) |  |  | `X.events` `X.institution_visit_schedule` `X.internal_submission_deadlines` |
<!-- generated:stage-S9:end -->

**Playbooks and views:** `scholarship_funding`, `financial_viability` → view 11.

## S10 — Visa

**Student asks**
- "Which visa and how much does it cost?" → `E.student_visa_type`, `E.student_visa_subclass_code`, `E.student_visa_fee`, `E.biometrics_fee`, `E.health_exam_fee` (view 2).
- "How long does the visa take right now?" → `E.visa_processing_time_weeks`, `E.processing_time_official_range`, `E.peak_season_note` (view 5).
- "What is the GS statement and what do they want to hear?" → `E.genuine_intent_test`, `E.genuine_intent_factors`, `E.genuine_intent_word_limits` (view 8).
- "Will they interview me?" → `E.visa_interview_likelihood`, `E.interview_location_format`.
- "Do I need a medical and where?" → `E.health_exam_required`, `E.panel_clinics_by_origin`, `E.health_exam_lead_days`, `E.tb_test_countries`.
- "What documents go in the visa file?" → `E.document_checklist_by_level_nationality`, `E.document_variants_by_nationality`, `E.funds_evidence_checklist`, `E.translation_attestation_rules`, `E.passport_validity_rule` (view 12).
- "What is my chance of refusal?" → `E.grant_rate_by_nationality`, `E.common_refusal_grounds`, `E.evidence_level_by_provider`, `E.credibility_interview_triggers` (view 8).
- "I was refused before. Can I apply again?" → `E.reapply_rules`, `E.refusal_history_disclosure_rule`, `E.appeal_body`, `E.appeal_fee`, `E.fraud_bars` (view 8).
- "I am already in Australia on a visitor visa. Can I switch?" → `E.apply_onshore_allowed`, `E.onshore_switching_rules`, `E.onshore_lodgement_bridging_rule`.
- "How early can I lodge and when can I fly?" → `E.apply_window_before_course_start`, `E.arrival_window_rule`, `E.apply_arrive_window_rule` (view 5).
- "Who is allowed to lodge my visa?" → `E.agent_lodgement_rule`, `X.migration_agent_service_scope`, `F.migration_advice_disclaimer_required`.

**Attributes by domain**

<!-- generated:stage-S10:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.cricos_course_code` `A.duration_standard` `A.delivery_modes` `A.online_component_max_pct_for_visa` `A.offshore_online_start_allowed` | `A.part_time_for_international` `A.day1_cpt_available` |  |
| B (institution) | `B.institution_legal_name` `B.cricos_provider_registration` `B.asqa_rto_registration` `B.dli_registration` `B.student_visa_sponsor_licensed` `B.ukvi_sponsor_status` `B.sevis_school_code` `B.nzqa_provider_registration` `B.nepal_moe_noc_eligible` `B.visa_risk_rating` `B.au_evidence_level` `B.au_visa_processing_priority_tier` `B.ca_dli_approval_rate_pct` `B.uk_bca_status` `B.pre_offer_financial_assessment_required` `B.institution_credibility_interview` `B.enrolment_confirmation_turnaround_days` | `B.mqa_registration` `B.ie_provider_registration` `B.gs_top_ranked_flag` |  |
| C (campus-location) | `C.campus_state_region` `C.campus_country` | `C.campus_delivery_modes` |  |
| D (city-cost-of-living) | `D.official_living_cost_for_visa` `D.official_living_cost_effective_date` |  |  |
| E (destination-visa) | `E.student_visa_type` `E.student_visa_subclass_code` `E.visa_lodgement_channel` `E.agent_lodgement_rule` `E.apply_onshore_allowed` `E.apply_window_before_course_start` `E.arrival_window_rule` `E.visa_grant_length_rule` `E.visa_extension_onshore_rule` `E.student_visa_fee` `E.biometrics_required` `E.health_exam_required` `E.tb_test_countries` `E.financial_proof_required` `E.financial_proof_formula` `E.official_living_figure_primary` `E.tuition_component_rule` `E.maintenance_funds_by_location` `E.evidence_level_by_provider` `E.funds_seasoning_days` `E.funds_recency_days` `E.sds_pal_variant` `E.gic_amount` `E.blocked_account_amount` `E.accepted_fund_types` `E.funds_source_explanation_rule` `E.accepted_sponsor_relationships` `E.loan_acceptance_rules` `E.funds_evidence_checklist` `E.visa_english_requirement` `E.visa_english_accepted_tests` `E.visa_english_min` `E.visa_english_exemptions` `E.genuine_intent_test` `E.genuine_intent_factors` `E.genuine_intent_word_limits` `E.genuine_intent_gap_scrutiny` `E.visa_interview_likelihood` `E.visa_processing_time_weeks` `E.processing_time_official_range` `E.processing_time_observed_origin` `E.processing_time_observed_as_of` `E.grant_rate_by_nationality` `E.apply_arrive_window_rule` `E.visa_conditions` `E.common_refusal_grounds` `E.reapply_rules` `E.fraud_bars` `E.refusal_history_disclosure_rule` `E.onshore_switching_rules` `E.change_provider_rules` `E.document_checklist_by_level_nationality` `E.document_variants_by_nationality` `E.translation_attestation_rules` `E.enrolment_evidence_document` `E.statement_of_purpose_visa_requirement` | `E.visa_sponsor_type` `E.entry_visa_required_by_nationality` `E.vac_locations_by_origin` `E.onshore_lodgement_bridging_rule` `E.visa_grant_evidence_format` `E.standalone_english_course_visa_rule` `E.biometrics_fee` `E.biometrics_appointment_lead_days` `E.health_exam_fee` `E.health_exam_lead_days` `E.panel_clinics_by_origin` `E.visa_fee_refund_rule` `E.priority_processing_available` `E.travel_component` `E.annual_income_alternative` `E.annual_income_threshold_single` `E.asset_types_accepted` `E.income_evidence_types` `E.funds_currency_and_translation_rule` `E.visa_english_validity_rule` `E.genuine_intent_package_assessment_rule` `E.interview_location_format` `E.credibility_interview_triggers` `E.grant_rate_period` `E.peak_season_note` `E.age_limits` `E.change_course_level_visa_rule` `E.transitional_arrangements_rule` `E.passport_validity_rule` `E.police_clearance_required` `E.identity_and_civil_documents_required` | `E.visa_application_form_code` `E.visa_stamp_validity_by_nationality` `E.short_course_visa_type` `E.visa_fee_payment_method` `E.priority_processing_fee` `E.sponsor_max_count` `E.photo_and_biometric_specification` `E.form_and_declaration_specifics` |
| H (scholarship) | `H.scholarship_offsets_deposit` | `H.scholarship_reduces_visa_funds_evidence` | `H.scholarship_covers_insurance` `H.govt_scheme_visa_pathway_note` |
| I (english-and-tests) | `I.test_is_selt` `I.visa_accepted_english_tests` `I.visa_home_edition_accepted` `I.visa_english_validity_months` `I.visa_selt_required` `I.english_waiver_visa_caveat` `I.pathway_single_coe_packaged` | `I.visa_osr_accepted` `I.visa_english_test_date_measured_to` |  |
| J (pathways-articulation) | `J.pathway_duration` `J.total_duration_via_pathway` `J.packaged_offer_available` `J.single_visa_packaging` `J.english_package_weeks_rule` | `J.packaged_visa_assessment_level_note` `J.transfer_to_partner_country_rules` |  |
| K (application-process) | `K.latest_realistic_lodge_date` `K.doc_type` `K.doc_required` `K.doc_required_at_stage` `K.doc_required_by` `K.doc_max_age_days` `K.doc_translation_required` `K.admission_interview_practice` `K.interview_stage` `K.interview_typical_topics` `K.gs_statement_question_set` `K.visa_history_declaration_required` `K.atas_required` `K.enrolment_document_type` `K.enrolment_document_prerequisites` `K.enrolment_document_validity_rule` `K.financial_pre_check_required` `K.financial_pre_check_amount_rule` `K.financial_pre_check_evidence_list` | `K.doc_format_rules` `K.doc_attestation_chain` `K.work_evidence_documents` `K.interview_format` `K.gs_statement_word_limit` `K.enrolment_document_latest_issue_days_before_start` `K.enrolment_document_amendment_process` `K.offer_letter_contents_checklist` | `K.passport_photo_spec` |
| L (fees-and-money) | `L.visa_refusal_refund_pct` `L.insurance_provider_name` `L.insurance_premium_single` `L.insurance_policy_period_rule` `L.funds_product_type` `L.funds_product_processing_days` `L.funds_product_accepted_by_authority` `L.loan_accepted_as_evidence_by` `L.loan_sanction_letter_requirements` | `L.asset_liquidation_documentation` |  |
| M (accommodation-arrival) | `M.accommodation_visa_refusal_release_clause` `M.immigration_document_collection_rule` |  |  |
| O (academic-rules) | `O.full_time_load` `O.reduced_load_conditions` `O.reduced_load_visa_impact` `O.attendance_min_pct` `O.research_student_work_rights_unlimited` `O.online_study_cap_institution_pct` `O.leave_of_absence_visa_impact` `O.change_course_onshore_rule` `O.change_level_onshore_rule` `O.change_provider_onshore_rule` `O.release_letter_policy` `O.study_extension_process` `O.course_extension_visa_rule` `O.reporting_obligation_triggers` `O.non_commencement_report_rule` |  | `O.exchange_international_student_conditions` |
| P (family-dependants) |  | `P.subsequent_entrant_process` `P.relationship_evidence` `P.dependant_document_checklist` |  |
| R (school-and-under18) |  |  | `R.under18_min_age_for_visa` `R.custodian_requirements` `R.under18_visa_documents` `R.under18_genuine_intent_note` `R.school_completion_visa_transition` |
| S (regulated-professions) |  | `S.criminal_vaccination_checks` |  |
| T (intake-calendar) | `T.term_start_date` `T.enrolment_confirmation_latest_issue_date` `T.recommended_visa_lodge_by` `T.latest_arrival_date` `T.backward_timeline_template` | `T.visa_office_peak_periods` |  |
| U (source-country-grading) | `U.apostille_available` `U.translation_norm` `U.date_calendar_system` `U.name_format_issues` `U.moe_noc_rules` | `U.gap_year_common_reasons` `U.gap_evidence_norm` `U.attestation_chain` `U.name_mismatch_remedy_norm` |  |
| W (destination-policy) |  | `W.policy_applies_to` `W.policy_transitional_rule` |  |
| X (agency) |  |  | `X.services_and_fees` `X.service_turnaround_times` `X.readiness_checklist` |
<!-- generated:stage-S10:end -->

**Playbooks and views:** `visa_risk_analysis`, `visa_process`, `financial_viability`, `document_preparation` → views 3, 8, 12, 5.

## S11 — Pre-departure

**Student asks**
- "What should I carry in original?" → `M.documents_to_carry_originals`, `M.customs_cash_declaration_threshold`, `M.customs_prohibited_items_for_students` (view 12).
- "Do I need a transit visa via Doha or Kuala Lumpur?" → `M.transit_visa_requirements_by_hub`.
- "Where do I stay the first week?" → `M.temporary_accommodation_options`, `M.accommodation_type`, `M.accommodation_bond_amount`, `M.accommodation_lease_min_weeks`, `M.accommodation_guarantee_scope`.
- "Is airport pickup free?" → `M.airport_pickup_cost`, `M.airport_pickup_eligibility`, `X.airport_pickup_and_arrival_support`.
- "Can I open a bank account before I fly?" → `M.pre_arrival_bank_account_options`, `M.sim_providers`, `M.esim_pre_arrival_available`.
- "When must I arrive and is orientation compulsory?" → `T.latest_arrival_date`, `T.orientation_period`, `M.orientation_mandatory`, `M.recommended_arrival_days_before_orientation` (view 5).
- "What insurance do I need and from whom?" → `E.insurance_scheme`, `E.insurance_mandatory`, `E.insurance_cover_length_rule`, `L.insurance_provider_name`, `L.insurance_premium_single`.
- "What do I do in the first week?" → `M.first_week_checklist_items`, `M.post_arrival_registration_steps`, `M.tax_id_name`, `M.tax_id_apply_method`, `E.address_and_change_notification_rule`, `X.pre_departure_sessions`.
- "What vaccinations and winter clothes?" → `M.arrival_vaccination_requirements`, `M.winter_clothing_requirement`, `D.climate_type`.

**Attributes by domain**

<!-- generated:stage-S11:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) |  | `A.placement_clearances_required` | `A.course_laptop_spec_required` `A.course_textbook_cost_estimate` |
| B (institution) | `B.housing_guarantee_offered` `B.airport_pickup_offered` | `B.international_orientation_length_days` | `B.south_asia_representative_office` `B.international_buddy_program` |
| C (campus-location) | `C.campus_address` `C.nearest_airport_iata` `C.nearest_airport_distance_km` `C.campus_timezone` `C.on_campus_beds_count` `C.on_campus_housing_weekly_cost_range` `C.campus_security_services` | `C.airport_transit_options` `C.nearest_train_station` `C.time_difference_vs_origin_hours` `C.campus_open_year_round` `C.nearby_student_suburbs` | `C.campus_map_url` |
| D (city-cost-of-living) | `D.rental_competition_rating` `D.rent_shared_room_weekly` `D.rent_single_room_shared_house_weekly` `D.rental_bond_weeks` `D.rent_in_advance_weeks` `D.one_off_setup_cost` `D.flight_cost_estimate_from_origin` `D.climate_type` | `D.city_timezone` `D.rental_vacancy_rate_pct` `D.rent_studio_weekly` `D.rent_on_campus_weekly_typical` `D.homestay_weekly_cost_typical` `D.phone_plan_monthly` `D.flight_duration_from_origin_hours` `D.direct_flight_from_origin` `D.suburb_safety_notes` `D.affordable_student_areas` `D.monthly_avg_temp_c` `D.snow_months` `D.winter_daylight_hours_min` | `D.monthly_rainfall_mm` `D.extreme_weather_risks` |
| E (destination-visa) | `E.arrival_window_rule` `E.post_arrival_immigration_registration` `E.biometrics_required` `E.health_exam_required` `E.funds_evidence_checklist` `E.apply_arrive_window_rule` `E.document_checklist_by_level_nationality` `E.document_variants_by_nationality` `E.translation_attestation_rules` | `E.vac_locations_by_origin` `E.visa_grant_evidence_format` `E.biometrics_appointment_lead_days` `E.health_exam_lead_days` `E.panel_clinics_by_origin` `E.interview_location_format` `E.peak_season_note` `E.work_start_rule` `E.address_and_change_notification_rule` `E.passport_validity_rule` `E.police_clearance_required` | `E.photo_and_biometric_specification` |
| H (scholarship) |  |  | `H.scholarship_covers_travel` `H.govt_scheme_covers_flights` |
| I (english-and-tests) |  | `I.pathway_placement_test_on_arrival` | `I.pathway_provider_same_campus` |
| K (application-process) | `K.doc_required_at_stage` `K.tuition_payment_process_by_origin` | `K.doc_original_required_at_arrival` |  |
| L (fees-and-money) | `L.funds_product_release_schedule` | `L.pre_departure_travel_budget` |  |
| M (accommodation-arrival) | `M.accommodation_type` `M.accommodation_provider_name` `M.accommodation_weekly_cost` `M.accommodation_bond_amount` `M.accommodation_lease_min_weeks` `M.accommodation_furnished` `M.accommodation_bills_included` `M.accommodation_distance_to_campus_km` `M.accommodation_guarantee_scope` `M.accommodation_application_open_date` `M.accommodation_application_deadline` `M.accommodation_visa_refusal_release_clause` `M.accommodation_application_url` `M.temporary_accommodation_options` `M.temporary_accommodation_recommended_nights` `M.airport_pickup_cost` `M.airport_pickup_booking_lead_days` `M.orientation_mandatory` `M.recommended_arrival_days_before_orientation` `M.latest_arrival_rule` `M.sim_providers` `M.pre_arrival_bank_account_options` `M.bank_account_documents_required` `M.tax_id_name` `M.tax_id_apply_method` `M.tax_id_processing_days` `M.address_notification_rule` `M.post_arrival_registration_steps` `M.immigration_document_collection_rule` `M.customs_prohibited_items_for_students` `M.customs_cash_declaration_threshold` `M.transit_visa_requirements_by_hub` `M.documents_to_carry_originals` `M.pre_departure_briefing_offered` `M.pre_departure_briefing_format` `M.pre_departure_checklist_url` `M.agency_arrival_support_contact` `M.first_week_checklist_items` | `M.accommodation_contract_lengths` `M.accommodation_meals_included` `M.accommodation_room_types` `M.accommodation_availability_status` `M.accommodation_payment_schedule` `M.accommodation_cancellation_policy` `M.family_accommodation_available` `M.under_18_accommodation_rule` `M.private_rental_documents_needed` `M.guarantor_requirement` `M.tenancy_deposit_protection_scheme` `M.airport_pickup_eligibility` `M.transport_card_setup` `M.sim_purchase_requirements` `M.esim_pre_arrival_available` `M.medicine_import_rules` `M.arrival_vaccination_requirements` `M.winter_clothing_requirement` `M.community_groups_for_arrivals` `M.luggage_allowance_typical` | `M.power_plug_type` |
| N (life-and-work-rights) | `N.work_authorisation_document_required` `N.tax_id_required_before_first_pay` `N.common_scams_targeting_students` `N.tenancy_bond_authority` `N.rental_scam_warning_signs` `N.key_laws_students_should_know` `N.emergency_number` `N.origin_embassy_in_destination` | `N.community_organisations` `N.climate_monthly_table` `N.international_student_support_hubs` | `N.suburbs_caution_notes` `N.seasonal_clothing_guidance` `N.concession_application_method` `N.home_flight_transit_hubs` `N.embassy_registration_recommended` `N.sim_setup_ref` `N.bank_account_setup_ref` |
| O (academic-rules) | `O.non_commencement_report_rule` |  | `O.textbook_cost_typical_annual` `O.laptop_required_policy` |
| P (family-dependants) |  |  | `P.family_arrival_sequencing_advice` |
| R (school-and-under18) |  |  | `R.welfare_arrangements` `R.welfare_start_end_rule` `R.school_boarding_available` `R.school_international_student_support` `R.homestay_vetting` `R.homestay_provider_type` `R.medical_consent_for_minors` |
| S (regulated-professions) |  |  | `S.exam_locations_and_frequency` |
| T (intake-calendar) | `T.term_start_date` `T.term_end_date` `T.orientation_period` `T.latest_arrival_date` `T.agency_events` | `T.enrolment_completion_deadline` `T.public_holidays_destination` |  |
| U (source-country-grading) | `U.moe_noc_rules` |  |  |
| X (agency) |  |  | `X.branches` `X.onshore_office_services` `X.readiness_checklist` `X.pre_departure_sessions` `X.airport_pickup_and_arrival_support` |
<!-- generated:stage-S11:end -->

**Playbooks and views:** `onshore_support`, `strategic_planning`, `lifestyle_adaptation` → views 12, 5.

## S12 — Life abroad

**Student asks**
- "How many hours can I work and from when?" → `E.work_hours_allowed_per_week`, `E.work_hours_term`, `E.work_hours_break`, `E.work_start_rule`, `E.self_employment_gig_rules` (view 2).
- "What will I earn and what jobs are realistic?" → `D.typical_student_jobs`, `D.typical_student_hourly_wage`, `N.typical_student_job_rates`, `N.casual_loading_pct`, `D.part_time_hours_realistically_available`.
- "Do I pay tax? Do I get it back?" → `N.income_tax_free_threshold`, `N.tax_residency_rule_for_students`, `N.tax_return_required`, `N.pension_refund_on_departure`, `N.student_tax_help_services`.
- "What if my boss underpays me?" → `N.exploitation_protections_for_students`, `N.report_exploitation_channel`, `N.workplace_rights_authority`.
- "Can I drive with my Nepali licence?" → `N.foreign_licence_validity_months`, `M.licence_conversion_requirements`.
- "Is there Nepali food, a temple, a mosque?" → `D.ethnic_grocery_availability`, `D.vegetarian_food_availability`, `D.halal_food_availability`, `D.religious_facilities_count`, `B.prayer_room_available`.
- "What if I get sick?" → `N.gp_visit_typical_cost`, `E.insurance_scheme`, `P.maternity_coverage`, `N.emergency_number`.
- "Can my parents visit me for graduation?" → `E.visitor_visa_for_parents`, `E.visitor_invitation_evidence`.
- "How do I send money home?" → `D.remittance_options`, `N.remittance_to_origin_channels`.
- "Will I miss Dashain?" → `N.home_festival_break_overlap`, `T.mid_term_break`, `T.inter_term_break`.

**Attributes by domain**

<!-- generated:stage-S12:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| B (institution) | `B.housing_guarantee_offered` | `B.international_student_pct` `B.nationality_mix` `B.source_market_student_estimate` `B.source_market_presence_band` `B.student_societies_south_asian` `B.counselling_service_available` `B.prayer_room_available` `B.halal_food_available` `B.dedicated_international_support_office` `B.on_campus_visa_advice_service` `B.on_campus_employment_available` | `B.religious_affiliation` `B.origin_student_society_present` `B.international_buddy_program` |
| C (campus-location) | `C.distance_to_cbd_km` `C.public_transport_rating` `C.student_transport_concession` `C.on_campus_beds_count` `C.campus_security_services` | `C.transit_time_to_cbd_min` `C.nearest_train_station` `C.transport_modes_serving_campus` `C.campus_facilities` `C.medical_centre_on_campus` `C.campus_open_year_round` `C.campus_security_shuttle_hours` `C.campus_area_safety_rating` `C.religious_facilities_nearby` `C.nearest_public_hospital` `C.nearby_student_suburbs` | `C.walkability_score` `C.parking_availability` `C.nearest_ethnic_grocery` |
| D (city-cost-of-living) | `D.transport_pass_monthly` `D.local_minimum_wage_hourly` `D.typical_student_hourly_wage` `D.typical_student_jobs` `D.part_time_hours_realistically_available` `D.student_part_time_job_market` `D.safety_index` `D.women_safety_index` `D.diaspora_community_presence` `D.public_transport_quality` | `D.casual_loading_pct_reference` `D.tax_free_threshold_reference` `D.crime_index` `D.suburb_safety_notes` `D.affordable_student_areas` `D.monthly_avg_temp_c` `D.winter_daylight_hours_min` `D.diaspora_population_by_origin` `D.community_organisations_by_origin` `D.ethnic_grocery_availability` `D.halal_food_availability` `D.religious_facilities_count` `D.remittance_options` `D.nearest_origin_consulate` | `D.extreme_weather_risks` `D.vegetarian_food_availability` |
| E (destination-visa) | `E.post_arrival_immigration_registration` `E.visa_conditions` `E.work_hours_allowed_per_week` `E.work_hours_term` `E.work_hours_break` `E.study_load_condition` `E.insurance_scheme` `E.insurance_mandatory` `E.insurance_cover_length_rule` | `E.onshore_lodgement_bridging_rule` `E.re_entry_travel_rule` `E.visa_expiry_grace_period_days` `E.periodic_reporting_rule` `E.work_start_rule` `E.placement_counts_toward_hours` `E.self_employment_gig_rules` `E.address_and_change_notification_rule` `E.visa_condition_breach_consequences` `E.visa_cancellation_grounds` `E.visitor_visa_for_parents` | `E.visa_stamp_validity_by_nationality` |
| G (occupation-career) |  | `G.in_field_part_time_feasibility` |  |
| H (scholarship) |  | `H.hardship_fund_available` | `H.scholarship_taxable` `H.phd_stipend_tax_free` `H.hardship_fund_eligibility_text` `H.hardship_fund_max_amount` |
| J (pathways-articulation) |  | `J.same_campus` |  |
| K (application-process) |  | `K.living_expense_remittance_process` |  |
| L (fees-and-money) | `L.insurance_provider_name` `L.funds_product_release_schedule` | `L.insurance_waiver_rule` |  |
| M (accommodation-arrival) | `M.accommodation_type` `M.tax_id_name` `M.tax_id_apply_method` `M.tax_id_processing_days` `M.address_notification_rule` `M.agency_arrival_support_contact` | `M.tenancy_deposit_protection_scheme` `M.transport_card_setup` `M.tax_id_required_before_work` `M.community_groups_for_arrivals` | `M.licence_conversion_requirements` |
| N (life-and-work-rights) | `N.work_rights_plain_summary` `N.work_hours_counting_rule` `N.scheduled_break_definition` `N.off_campus_work_authorisation` `N.work_authorisation_document_required` `N.post_completion_work_before_psw_rule` `N.work_rights_breach_consequences` `N.min_wage_hourly_by_region` `N.casual_loading_pct` `N.part_time_income_monthly_estimate` `N.income_tax_free_threshold` `N.tax_residency_rule_for_students` `N.tax_id_required_before_first_pay` `N.tax_return_required` `N.insurance_coverage_matrix` `N.gp_visit_typical_cost` `N.mental_health_helplines` `N.common_scams_targeting_students` `N.student_transport_concession_eligibility` `N.tenancy_bond_authority` `N.rental_scam_warning_signs` `N.workplace_rights_authority` `N.exploitation_protections_for_students` `N.key_laws_students_should_know` `N.emergency_number` `N.origin_embassy_in_destination` `N.student_complaints_ombudsman` | `N.volunteer_work_counts_toward_cap` `N.unpaid_internship_rules` `N.employer_right_to_work_check` `N.job_search_channels_for_students` `N.min_wage_effective_date` `N.min_wage_age_bands` `N.penalty_rates_summary` `N.sector_award_minimums` `N.typical_student_job_rates` `N.employer_pension_contribution_pct` `N.living_cost_coverage_by_work_pct` `N.income_tax_brackets_student_relevant` `N.tax_withholding_without_id_pct` `N.tax_refund_typical_note` `N.tax_treaty_student_article` `N.pension_refund_on_departure` `N.foreign_licence_validity_months` `N.international_driving_permit_required` `N.licence_conversion_test_required` `N.direct_billing_available` `N.insurance_claim_method` `N.insurance_excess_amount` `N.pre_existing_condition_wait_months` `N.mental_health_cover_note` `N.student_safety_advisory` `N.anti_discrimination_authority` `N.religious_facilities_city` `N.origin_cuisine_availability` `N.community_organisations` `N.climate_monthly_table` `N.student_transport_concession_pass_cost` `N.time_difference_from_origin_hours` `N.home_flight_frequency_weekly` `N.home_flight_return_fare_indicative` `N.parents_visit_visa_summary` `N.remittance_to_origin_channels` `N.home_festival_break_overlap` `N.tenant_rights_summary` `N.tenancy_dispute_body` `N.payslip_and_pay_check_tools` `N.unpaid_trial_legality` `N.report_exploitation_channel` `N.health_advice_line` `N.free_legal_advice_services` `N.international_student_support_hubs` | `N.student_tax_help_services` `N.licence_conversion_fee` `N.driving_side_vs_origin` `N.licence_translation_required` `N.insurance_claim_turnaround_days` `N.prescription_cost_note` `N.dental_optical_cover_note` `N.suburbs_caution_notes` `N.night_transport_safety_options` `N.discrimination_experience_index` `N.concession_application_method` `N.student_discount_programs` `N.free_software_for_students` `N.gym_membership_typical_monthly_cost` `N.community_sports_for_students` `N.internet_speed_median_mbps` `N.daylight_saving_observed` `N.home_flight_transit_hubs` `N.remittance_to_origin_cost_pct` `N.festival_celebration_availability` `N.alcohol_legal_age` `N.cannabis_legal_status` `N.fare_evasion_fine` `N.non_emergency_police_number` `N.civic_participation_note` `N.cost_of_living_index_ref` `N.sim_setup_ref` `N.bank_account_setup_ref` |
| P (family-dependants) |  | `P.partner_work_rights` `P.partner_study_rights` `P.dependant_visa_length_rule` | `P.dependant_income_tax_and_benefits_note` |
| Q (research-phd) |  | `Q.research_work_hours_rule` | `Q.research_mode_of_study` `Q.fieldwork_abroad_rule` |
| R (school-and-under18) |  |  | `R.homestay_rules_for_minors` `R.minor_travel_and_holiday_rule` |
| T (intake-calendar) | `T.inter_term_break` | `T.mid_term_break` `T.public_holidays_destination` |  |
| X (agency) |  |  | `X.onshore_office_services` |
<!-- generated:stage-S12:end -->

**Playbooks and views:** `work_survival`, `lifestyle_adaptation`, `anxiety_reassurance` → views 2, 15.

## S13 — Academic rules while enrolled

**Student asks**
- "What attendance do I need?" → `O.attendance_min_pct`, `O.attendance_monitoring_method`, `E.visa_conditions` (view 15).
- "What happens if I fail two subjects?" → `O.course_progress_rule`, `O.intervention_strategy_triggers`, `O.reporting_obligation_triggers`, `O.reporting_timeframe_days`.
- "Can I switch to a cheaper college after six months?" → `O.release_letter_policy`, `O.release_letter_fee`, `E.change_provider_rules`, `E.change_course_level_visa_rule` (view 8).
- "Can I study part-time or online for a semester?" → `O.reduced_load_conditions`, `O.reduced_load_visa_impact`, `E.study_load_condition`, `Q.research_mode_of_study`.
- "Can I take a semester off to go home?" → `O.leave_of_absence_policy`, `O.leave_of_absence_visa_impact`, `Q.leave_and_suspension_rules`.
- "My course is ending late, can I extend my visa?" → `O.study_extension_process`, `O.course_extension_visa_rule`, `E.visa_extension_onshore_rule`.
- "Can I use ChatGPT for assignments?" → `O.ai_tools_policy`, `O.academic_integrity_policy_url`.
- "What happens if I breach a visa condition?" → `E.visa_condition_breach_consequences`, `E.visa_cancellation_grounds`.

**Attributes by domain**

<!-- generated:stage-S13:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.online_component_max_pct_for_visa` `A.placement_hours_total` `A.placement_mandatory` | `A.total_credit_points` `A.credit_unit_name` `A.units_total_count` `A.contact_hours_per_week` `A.study_load_options` `A.part_time_for_international` `A.placement_clearances_required` `A.assumed_knowledge` `A.handbook_url` | `A.major_declaration_timing` `A.exchange_availability` `A.class_size_typical` `A.student_staff_ratio` `A.assessment_mix` |
| B (institution) |  | `B.accepts_onshore_transfers` | `B.institution_student_staff_ratio` `B.disability_support_available` `B.free_academic_english_support` |
| C (campus-location) |  | `C.campus_facilities` `C.campus_open_year_round` | `C.library_hours` |
| E (destination-visa) | `E.visa_extension_onshore_rule` `E.visa_conditions` `E.study_load_condition` `E.change_provider_rules` | `E.placement_counts_toward_hours` `E.change_course_level_visa_rule` |  |
| H (scholarship) | `H.scholarship_renewable` `H.scholarship_conditions_text` | `H.scholarship_renewal_gpa_min` `H.scholarship_renewal_conditions_text` `H.phd_scholarship_scheme` `H.phd_scholarship_duration_years` |  |
| I (english-and-tests) |  |  | `I.pathway_attendance_rule` |
| J (pathways-articulation) | `J.progression_gpa_min` `J.progression_conditions_text` | `J.pathway_max_fails_allowed` | `J.credit_granted_units` |
| K (application-process) |  | `K.doc_original_required_at_arrival` |  |
| L (fees-and-money) |  | `L.fee_per_credit_point` `L.subsequent_payment_due_rule` `L.late_payment_penalty` `L.late_payment_consequence` | `L.failed_unit_repeat_fee` |
| N (life-and-work-rights) | `N.student_complaints_ombudsman` |  | `N.free_software_for_students` |
| O (academic-rules) | `O.grading_system` `O.grade_average_method` `O.pass_mark_pct` `O.good_standing_gpa_min` `O.term_structure` `O.terms_per_year` `O.academic_calendar_url` `O.full_time_load` `O.reduced_load_conditions` `O.reduced_load_visa_impact` `O.attendance_min_pct` `O.course_progress_rule` `O.research_student_work_rights_unlimited` `O.online_study_cap_institution_pct` `O.leave_of_absence_policy` `O.leave_of_absence_visa_impact` `O.change_course_onshore_rule` `O.change_level_onshore_rule` `O.change_provider_onshore_rule` `O.release_letter_policy` `O.study_extension_process` `O.course_extension_visa_rule` `O.reporting_obligation_triggers` | `O.credit_system` `O.attendance_monitoring_method` `O.attendance_warning_thresholds` `O.intervention_strategy_triggers` `O.show_cause_process` `O.exclusion_rule` `O.supplementary_assessment_policy` `O.unit_repeat_policy` `O.release_letter_fee` `O.release_processing_days` `O.internal_transfer_rule` `O.reporting_timeframe_days` `O.academic_integrity_policy_url` `O.ai_tools_policy` `O.academic_support_services` `O.english_support_during_course` `O.study_hours_expected_per_week` | `O.special_consideration_policy` `O.results_release_timing` `O.misconduct_penalty_ladder` `O.contract_cheating_law_note` `O.exchange_program_available` `O.exchange_partner_count` `O.exchange_international_student_conditions` `O.first_year_pass_rate` `O.laptop_required_policy` `O.unit_selection_flexibility` `O.grade_appeal_process` |
| Q (research-phd) |  |  | `Q.confirmation_milestone_rule` `Q.leave_and_suspension_rules` `Q.fieldwork_abroad_rule` |
| R (school-and-under18) |  |  | `R.under18_turning_18_transition` `R.school_academic_reporting_to_parents` |
| T (intake-calendar) | `T.term_end_date` `T.census_date` `T.exam_period` `T.inter_term_break` | `T.teaching_weeks` `T.last_withdrawal_without_penalty_date` `T.mid_term_break` `T.results_release_date` `T.enrolment_completion_deadline` |  |
| X (agency) |  |  | `X.onshore_office_services` |
<!-- generated:stage-S13:end -->

**Playbooks and views:** `onshore_support`, `work_survival` → views 8, 15.

## S14 — Family & dependants

**Student asks**
- "Can my wife come and can she work full-time?" → `E.dependents_allowed`, `P.dependant_eligibility_by_relationship`, `P.partner_work_rights`, `P.partner_study_rights` (view 4).
- "How much extra money do I show for my wife and child?" → `E.dependant_funds_rule`, `E.official_living_figure_spouse`, `E.official_living_figure_child`, `P.additional_funds_per_dependant`, `E.annual_income_threshold_with_dependants` (view 3).
- "Do my children pay school fees?" → `P.public_school_fee_by_region`, `P.school_fee_exemptions`, `P.school_age_range_by_region`, `E.school_fees_component_rule` (view 3).
- "Should my husband be the main applicant instead?" → `P.main_applicant_swap_feasibility`, `P.dependant_refusal_risk_observation` (view 8).
- "Can my family join later?" → `P.subsequent_entrant_process`, `P.subsequent_entrant_fee`, `P.dependant_visa_processing_time`, `P.family_arrival_sequencing_advice`.
- "We just got married. Is that a problem?" → `P.relationship_evidence`, `P.marriage_recency_scrutiny`, `E.identity_and_civil_documents_required`.
- "Is pregnancy covered? What if my baby is born there?" → `P.maternity_coverage`, `P.child_born_in_destination_status`, `P.child_citizenship_rule`, `E.insurance_dependants_required`.
- "What does a family flat cost?" → `P.family_housing_rent`, `M.family_accommodation_available`, `P.childcare_cost_subsidy`, `P.family_total_first_year_budget` (view 2).

**Attributes by domain**

<!-- generated:stage-S14:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| B (institution) |  |  | `B.childcare_support_for_students` |
| C (campus-location) | `C.campus_state_region` `C.campus_timezone` | `C.time_difference_vs_origin_hours` `C.nearest_public_hospital` | `C.childcare_on_campus` |
| D (city-cost-of-living) |  | `D.rent_one_bed_apartment_weekly` `D.flight_duration_from_origin_hours` |  |
| E (destination-visa) | `E.dependents_allowed` | `E.dependant_visa_fee` `E.official_living_figure_spouse` `E.official_living_figure_child` `E.school_fees_component_rule` `E.dependant_funds_rule` `E.annual_income_threshold_with_dependants` `E.identity_and_civil_documents_required` `E.insurance_dependants_required` `E.visitor_visa_for_parents` `E.under18_guardian_requirements` | `E.visitor_invitation_evidence` `E.student_guardian_visa_type` |
| F (post-study-migration) | `F.psw_dependants_allowed` `F.points_partner_table` | `F.pr_partner_inclusion_rules` |  |
| H (scholarship) |  | `H.sibling_discount_pct` | `H.scholarship_covers_dependants` |
| I (english-and-tests) |  | `I.dependant_english_required` |  |
| L (fees-and-money) | `L.insurance_premium_couple` `L.insurance_premium_family` |  | `L.insurance_premium_dependant_child` |
| M (accommodation-arrival) |  | `M.family_accommodation_available` |  |
| N (life-and-work-rights) |  | `N.time_difference_from_origin_hours` `N.home_flight_frequency_weekly` `N.home_flight_return_fare_indicative` `N.parents_visit_visa_summary` `N.home_festival_break_overlap` |  |
| O (academic-rules) | `O.leave_of_absence_policy` `O.leave_of_absence_visa_impact` |  |  |
| P (family-dependants) |  | `P.dependant_eligibility_by_relationship` `P.partner_work_rights` `P.partner_study_rights` `P.child_school_access_rights` `P.dependant_visa_length_rule` `P.subsequent_entrant_process` `P.subsequent_entrant_fee` `P.additional_funds_per_dependant` `P.public_school_fee_by_region` `P.school_fee_exemptions` `P.family_housing_rent` `P.family_total_first_year_budget` `P.maternity_coverage` `P.relationship_evidence` `P.marriage_recency_scrutiny` `P.dependant_document_checklist` `P.main_applicant_swap_feasibility` `P.family_destination_ranking_note` `P.dependant_refusal_risk_observation` | `P.dependant_visa_processing_time` `P.school_age_range_by_region` `P.childcare_cost_subsidy` `P.dependant_income_tax_and_benefits_note` `P.child_born_in_destination_status` `P.child_citizenship_rule` `P.dependant_visa_english_requirement` `P.family_health_cover_arrangement` `P.family_arrival_sequencing_advice` |
| Q (research-phd) |  | `Q.research_dependant_rights_note` | `Q.leave_and_suspension_rules` |
| R (school-and-under18) |  |  | `R.guardian_visa` |
| T (intake-calendar) | `T.exam_period` | `T.graduation_ceremony_dates` |  |
<!-- generated:stage-S14:end -->

**Playbooks and views:** `family_planning`, `financial_viability` → views 3, 4, 8.

## S15 — Post-study work, PR & licensing

**Student asks**
- "How long can I stay and work after graduating?" → `F.psw_visa_name`, `F.psw_length_by_level`, `F.psw_english_min`, `F.psw_age_max`, `F.psw_study_duration_min` (view 6).
- "Is my occupation on the list?" → `G.occupation_code`, `G.occupation_list_membership`, `G.skilled_occupation_list_status`, `G.state_nomination_demand` (view 14).
- "How many points would I have?" → `F.points_test_name`, `F.points_age_table`, `F.points_english_table`, `F.points_qualification_table`, `F.regional_study_points`, `F.points_estimate_for_typical_graduate` (view 6).
- "Which state will nominate me?" → `F.state_nomination_program_status`, `F.state_nomination_occupation_list`, `F.state_nomination_graduate_stream`, `F.pnp_allocation_annual`, `F.regional_491_conditions`.
- "What is a skills assessment and how long does it take?" → `G.skills_assessment_authority`, `G.skills_assessment_requirements`, `G.skills_assessment_fee`, `G.skills_assessment_processing_weeks`, `G.professional_year_program_name` (view 14).
- "Can I register as a nurse / teacher / engineer?" → `S.regulator`, `S.registration_steps`, `S.registration_weeks`, `S.exam`, `S.exam_fee`, `S.supervised_hours`, `S.state_variation` (view 14).
- "Is my Nepali nursing degree recognised or do I start again?" → `S.source_qualification_recognition`, `S.bridging_program`, `S.bridging_cost`, `S.registration_route_overseas_qualified` (view 14).
- "What about OPT and H-1B in the US?" → `F.opt_length_months`, `F.stem_opt_eligible`, `F.h1b_lottery_selection_rate`, `F.h1b_cap_exempt_employer`.
- "Can my employer sponsor me?" → `F.employer_sponsored_visa_name`, `G.skilled_worker_salary_threshold`, `S.post_registration_visa_link`.
- "How long until citizenship?" → `F.citizenship_residency_years`, `F.citizenship_student_time_counts`.

**Attributes by domain**

<!-- generated:stage-S15:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.course_level_fine` `A.aqf_level` `A.nzqf_level` `A.fheq_rqf_level` `A.oqf_level` `A.cip_code` `A.awarding_body` `A.thesis_or_coursework` `A.accreditation_bodies` `A.professionally_accredited` `A.psw_eligible` `A.psw_eligibility_reason` `A.placement_hours_total` | `A.nfq_level` `A.national_field_of_study_code` `A.honours_pathway_available` `A.accreditation_scope_note` | `A.thesis_credit_share_pct` |
| B (institution) | `B.institution_type` `B.ownership_type` `B.degree_awarding_status` `B.dli_registration` `B.us_regional_accreditor` `B.pgwp_eligible_dli` | `B.has_medical_school` `B.anabin_recognition` `B.khda_caa_licence` `B.aiu_equivalence_recognised` `B.ugc_bd_recognised` `B.hpi_eligible` `B.on_campus_visa_advice_service` | `B.home_recognition_status` |
| C (campus-location) | `C.campus_state_region` `C.campus_postcode` `C.location_classification` `C.regional_campus` `C.regional_category_au` `C.regional_study_nz` `C.regional_classification_verified_at` | `C.ca_location_category` `C.ca_rural_pilot_community` |  |
| D (city-cost-of-living) | `D.city_region_ref` |  |  |
| E (destination-visa) | `E.visa_grant_length_rule` | `E.visa_expiry_grace_period_days` |  |
| F (post-study-migration) | `F.psw_visa_name` `F.psw_length_by_level` `F.psw_regional_extension` `F.psw_apply_within_days` `F.psw_age_max` `F.post_study_work_visa_485_years` `F.psw_english_min` `F.psw_study_duration_min` `F.psw_excluded_levels_or_courses` `F.pgwp_length_months` `F.pgwp_field_of_study_eligible` `F.psw_dependants_allowed` `F.graduate_route_eligible` `F.psw_eligibility_for_course` `F.psw_months_normalized` `F.graduate_route_length_years` `F.psw_work_restrictions` `F.psw_once_per_lifetime` `F.post_study_work_visa_eligible` `F.post_study_work_visa_length_years` `F.psw_pathway_to_pr_typical` `F.stem_opt_eligible` `F.opt_length_months` `F.opt_unemployment_days_max` `F.points_test_name` `F.points_test_pass_mark` `F.points_age_table` `F.points_english_table` `F.points_qualification_table` `F.pr_points_study_level` `F.australian_study_requirement_met_by_course` `F.regional_study_points` `F.specified_stem_qualification_points` `F.points_skilled_employment_table` `F.points_partner_table` `F.points_naati_ccl` `F.points_professional_year` `F.points_state_nomination` `F.points_table_effective_date` `F.professional_year_eligible` `F.points_test_official_url` `F.crs_factor_table` `F.french_proficiency_bonus_relevant` `F.ee_category_draw_list` `F.ee_program_eligibility_rules` `F.ee_draw_recent_cutoffs` `F.pnp_stream_catalog` `F.pnp_stream_status` `F.state_nomination_program_status` `F.state_nomination_occupation_list` `F.state_nomination_graduate_stream` `F.regional_491_conditions` `F.employer_sponsored_visa_name` `F.employer_sponsored_salary_threshold` `F.employer_sponsored_experience_min` `F.employer_sponsored_occupation_list_required` `F.employer_sponsorship_pr_pathway_years` `F.pr_typical_years_by_route` `F.pr_route_assumptions` `F.work_in_field_required_for_pr` `F.pr_age_cutoff` `F.pr_skills_assessment_required` `F.job_seeker_visa_name` `F.job_seeker_visa_length_months` `F.job_seeker_visa_work_allowed` `F.occupation_list_change_log` `F.migration_policy_change_pending` `F.migration_policy_announcement_vs_effective` `F.migration_advice_disclaimer_required` `F.migration_source_official_url` | `F.psw_visa_fee` `F.psw_onshore_lodgement_required` `F.psw_bridging_work_rights` `F.psw_processing_time_observed` `F.psw_completion_evidence_required` `F.stem_opt_employer_conditions` `F.cap_gap_extension_available` `F.h1b_lottery_selection_rate` `F.h1b_policy_flags` `F.green_card_backlog_by_chargeability` `F.h1b_cap_exempt_employer` `F.points_estimate_for_typical_graduate` `F.pnp_allocation_annual` `F.quebec_immigration_route` `F.state_nomination_min_points_or_score` `F.state_nomination_annual_allocation` `F.age_points_decline_curve` `F.pr_application_fee` `F.onshore_pr_application_allowed_while_student` `F.pr_health_character_requirements` `F.pr_processing_time_official` `F.job_seeker_visa_conversion_target` `F.citizenship_residency_years` `F.pr_partner_inclusion_rules` `F.migration_regulated_adviser_scheme` | `F.green_card_employment_routes` `F.state_nomination_fee` `F.dama_agreements` `F.migration_talent_visa_routes` `F.job_seeker_visa_fee` `F.citizenship_student_time_counts` `F.dual_citizenship_allowed_destination` |
| G (occupation-career) | `G.occupation_code` `G.occupation_framework` `G.occupation_skill_level` `G.occupation_code_crosswalk` `G.occupation_isco08_code` `G.occupation_regulated_flag` `G.anzsco_occupation_codes` `G.occupation_list_membership` `G.skilled_occupation_list_status` `G.on_sol` `G.on_csol` `G.occupation_visa_eligibility_matrix` `G.noc_codes` `G.express_entry_crs_category` `G.pnp_in_demand_provinces` `G.skilled_worker_soc_code` `G.skilled_worker_salary_threshold` `G.on_immigration_salary_list` `G.green_list_status` `G.green_list_role` `G.smc_points_relevance` `G.green_card_pathway_relevance` `G.skills_assessment_authority` `G.skills_assessment_pathway` `G.skills_assessment_requirements` `G.professional_year_program_name` `G.state_nomination_demand` `G.professional_licensing_body` `G.course_occupation_course_id` `G.course_occupation_code` `G.course_occupation_mapping_confidence` `G.course_occupation_requires_further_qualification` | `G.occupation_list_removal_risk` `G.ie_critical_skills_status` `G.de_shortage_occupation_flag` `G.skills_assessment_fee` `G.skills_assessment_processing_weeks` `G.skills_assessment_validity_years` `G.skills_assessment_experience_deduction` `G.professional_year_cost` `G.professional_year_duration_weeks` `G.professional_year_providers` `G.professional_year_eligibility_conditions` `G.visa_sponsoring_employer_register` | `G.my_critical_occupation_list_status` `G.skillselect_occupation_ceiling` |
| H (scholarship) |  | `H.scholarship_return_home_bond` `H.scholarship_return_home_years` `H.alumni_discount_pct` | `H.scholarship_bond_penalty_text` |
| I (english-and-tests) |  | `I.test_languages_offered` `I.naati_ccl_languages_available` `I.naati_ccl_pass_score` `I.naati_ccl_points_reference` |  |
| J (pathways-articulation) | `J.psw_eligibility_preserved` | `J.dual_award` |  |
| N (life-and-work-rights) | `N.post_completion_work_before_psw_rule` | `N.pension_refund_on_departure` |  |
| O (academic-rules) | `O.grading_system` `O.research_student_work_rights_unlimited` | `O.completion_letter_issue_days` |  |
| Q (research-phd) |  | `Q.research_post_study_visa_length` `Q.research_points_advantage` | `Q.industry_phd_options` `Q.research_career_outcomes` |
| S (regulated-professions) |  | `S.regulator` `S.profession` `S.regulator_url` `S.registration_mandatory_to_practise` `S.state_variation` `S.registration_steps` `S.registration_weeks` `S.registration_fee` `S.provisional_or_limited_registration` `S.criminal_vaccination_checks` `S.course_leads_to_registration` `S.accredited_course_list_url` `S.source_qualification_recognition` `S.international_graduate_priority` `S.english_standard` `S.english_recency` `S.english_exemption_pathways` `S.exam` `S.exam_fee` `S.supervised_hours` `S.registration_route_overseas_qualified` `S.bridging_program` `S.bridging_cost` `S.internship_residency_rules` `S.post_registration_visa_link` | `S.recognition_agreements` `S.exam_locations_and_frequency` `S.registration_success_observation` `S.profession_demand_note` |
| T (intake-calendar) |  | `T.graduation_ceremony_dates` `T.state_nomination_program_open_dates` |  |
| W (destination-policy) |  | `W.pr_pathway_strength` |  |
| X (agency) |  |  | `X.migration_agent_service_scope` |
<!-- generated:stage-S15:end -->

**Playbooks and views:** `migration_pathway`, `career_roi` → views 6, 14.

## S16 — Careers & ROI

**Student asks**
- "What will I earn after this degree?" → `G.salary_median`, `G.salary_entry_level`, `G.average_graduate_salary`, `G.salary_year` (view 14).
- "Is there demand for this job?" → `G.demand_rating_value`, `G.demand_rating_date`, `G.future_demand_rating`.
- "Is the degree worth the money?" → `W.min_total_budget_first_year`, `G.average_graduate_salary`, `W.cost_of_study_index`, `O.international_student_pass_rate` (view 4).
- "Does the course actually lead to this job?" → `G.course_occupation_requires_further_qualification`, `S.course_leads_to_registration`, `S.international_graduate_priority`.
- "If I go back home, is the degree and licence recognised?" → `W.degree_recognition_source_country`, `S.registration_portability_home`, `B.aiu_equivalence_recognised`.
- "Is a research degree better for jobs?" → `Q.research_career_outcomes`, `Q.research_completion_rate`, `Q.research_points_advantage`.
- "Will I be paid less than locals?" → `N.min_wage_hourly_by_region`, `G.salary_regional_metro_delta`, `G.salary_award_or_collective_rate`.

**Attributes by domain**

<!-- generated:stage-S16:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.specialisations_available` `A.co_op_or_internship_included` `A.placement_type` `A.placement_paid` `A.placement_guaranteed` `A.career_outcomes_listed` | `A.sandwich_industry_year_available` `A.placement_arranged_by` `A.co_op_terms_count` `A.placement_or_internship_rate` | `A.placement_employer_partners` |
| B (institution) |  | `B.institution_graduate_employment_pct` `B.careers_service_features` `B.on_campus_employment_available` | `B.alumni_chapters` |
| D (city-cost-of-living) | `D.typical_student_jobs` |  |  |
| F (post-study-migration) | `F.psw_visa_name` `F.psw_work_restrictions` `F.opt_unemployment_days_max` `F.points_skilled_employment_table` `F.points_professional_year` `F.professional_year_eligible` `F.ee_category_draw_list` `F.ee_program_eligibility_rules` `F.state_nomination_occupation_list` `F.employer_sponsored_visa_name` `F.employer_sponsored_salary_threshold` `F.employer_sponsored_experience_min` `F.employer_sponsored_occupation_list_required` `F.work_in_field_required_for_pr` `F.job_seeker_visa_work_allowed` `F.occupation_list_change_log` | `F.stem_opt_employer_conditions` `F.h1b_cap_exempt_employer` `F.job_seeker_visa_conversion_target` | `F.dama_agreements` |
| G (occupation-career) | `G.occupation_code` `G.occupation_title` `G.occupation_code_crosswalk` `G.anzsco_occupation_codes` `G.occupation_list_membership` `G.on_csol` `G.noc_codes` `G.express_entry_crs_category` `G.pnp_in_demand_provinces` `G.skilled_worker_soc_code` `G.skilled_worker_salary_threshold` `G.on_immigration_salary_list` `G.green_list_status` `G.skills_assessment_requirements` `G.professional_year_program_name` `G.job_demand_outlook` `G.demand_rating_source` `G.demand_rating_value` `G.demand_rating_date` `G.occupation_growth_projection` `G.average_graduate_salary` `G.salary_entry_level` `G.salary_median` `G.salary_source` `G.salary_year` `G.graduate_employment_rate` `G.graduate_employment_rate_international` `G.graduate_employment_rate_source` `G.professional_licensing_body` `G.course_occupation_course_id` `G.course_occupation_code` `G.course_occupation_is_primary` | `G.occupation_alternative_titles` `G.occupation_description` `G.ie_critical_skills_status` `G.de_shortage_occupation_flag` `G.skills_assessment_experience_deduction` `G.professional_year_providers` `G.future_demand_rating` `G.vacancy_count_current` `G.vacancy_trend_12m` `G.top_hiring_cities` `G.visa_sponsoring_employer_register` `G.market_saturation_signal` `G.salary_p25_p75` `G.salary_regional_metro_delta` `G.graduate_full_time_employment_rate` `G.in_field_employment_rate` `G.in_field_part_time_feasibility` `G.entry_role_experience_required_years` `G.return_home_recognition` | `G.occupation_unit_and_major_group` `G.occupation_specialisations` `G.my_critical_occupation_list_status` `G.top_employers` `G.sponsoring_employer_count` `G.automation_risk_score` `G.remote_friendly` `G.salary_award_or_collective_rate` `G.postdoc_salary_range` `G.graduate_underemployment_rate` `G.graduate_further_study_rate` `G.career_progression_roles` `G.career_progression_years_to_senior` `G.occupation_international_transferability` `G.professional_association_optional` |
| L (fees-and-money) |  | `L.estimated_roi_years` `L.roi_formula_inputs` |  |
| N (life-and-work-rights) | `N.work_rights_plain_summary` | `N.unpaid_internship_rules` `N.job_search_channels_for_students` |  |
| Q (research-phd) |  |  | `Q.research_career_outcomes` |
| S (regulated-professions) |  | `S.regulator` `S.registration_mandatory_to_practise` `S.state_variation` `S.registration_steps` `S.provisional_or_limited_registration` `S.international_graduate_priority` `S.exam` `S.supervised_hours` `S.internship_residency_rules` | `S.continuing_education` `S.annual_renewal_rule` `S.registration_portability_home` `S.registration_success_observation` `S.profession_demand_note` |
| W (destination-policy) |  | `W.degree_recognition` `W.degree_recognition_source_country` `W.one_year_masters_recognition` |  |
<!-- generated:stage-S16:end -->

**Playbooks and views:** `career_roi`, `program_selection` → views 14, 4.

## S17 — Alternatives & risk

**Student asks**
- "What are my chances of a visa?" → `E.grant_rate_by_nationality`, `E.grant_rate_period`, `E.common_refusal_grounds`, `E.evidence_level_by_provider`, `W.nationality_posture` (view 8).
- "What will make my file weak?" → `E.genuine_intent_factors`, `E.genuine_intent_gap_scrutiny`, `E.funds_source_explanation_rule`, `E.credibility_interview_triggers`, `P.dependant_refusal_risk_observation` (view 8).
- "If Australia refuses me, what is plan B?" → `W.destination_comparison_matrix`, `W.pr_pathway_strength`, `E.reapply_rules`, `E.refusal_history_disclosure_rule` (views 4, 8).
- "Should I do a diploma first to be safe?" → `J.pathway_type`, `J.cost_delta_vs_direct`, `J.time_delta_vs_direct_months`, `J.packaged_visa_assessment_level_note`, `E.change_course_level_visa_rule` (view 7).
- "Is a fake document ever worth it?" → `E.fraud_bars`, `E.visa_fee_refund_rule`, `L.visa_refusal_refund_pct`.
- "What if my course is cancelled or the college closes?" → `L.tuition_protection_coverage_rule`, `L.fee_item_refundable`, `L.refund_processing_days`.
- "Can I appeal?" → `E.appeal_body`, `E.appeal_window_days`, `E.appeal_fee`, `E.refusal_notification_format`.

**Attributes by domain**

<!-- generated:stage-S17:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.competitive_entry_flag` `A.placement_guaranteed` `A.study_gap_max_years` `A.backlog_acceptance_max` `A.backlog_counting_method` | `A.internal_popularity_score` `A.day1_cpt_available` `A.distance_learning_qualification_accepted` `A.gre_gmat_middle_50` `A.sat_act_middle_50` |  |
| B (institution) | `B.visa_risk_rating` `B.au_evidence_level` `B.ca_dli_approval_rate_pct` `B.uk_bca_status` `B.notable_risks` `B.accepts_prior_visa_refusal_applicants` `B.refund_schedule` `B.deferral_policy` `B.institution_study_gap_max_years` `B.counsellor_pitch_summary` | `B.tuition_protection_scheme` `B.aiu_equivalence_recognised` `B.ugc_bd_recognised` `B.accepts_onshore_transfers` `B.known_student_concerns` | `B.home_recognition_status` |
| C (campus-location) | `C.campus_status` |  | `C.campus_international_share_pct` |
| D (city-cost-of-living) | `D.rental_competition_rating` `D.part_time_hours_realistically_available` `D.weekly_earnings_potential` | `D.rental_vacancy_rate_pct` `D.official_vs_actual_cost_gap_pct` `D.nearest_origin_consulate` | `D.extreme_weather_risks` |
| E (destination-visa) | `E.apply_onshore_allowed` `E.evidence_level_by_provider` `E.funds_source_explanation_rule` `E.genuine_intent_test` `E.genuine_intent_factors` `E.genuine_intent_gap_scrutiny` `E.visa_interview_likelihood` `E.grant_rate_by_nationality` `E.common_refusal_grounds` `E.appeal_body` `E.reapply_rules` `E.fraud_bars` `E.refusal_history_disclosure_rule` | `E.visa_expiry_grace_period_days` `E.visa_status_restoration_rule` `E.visa_fee_refund_rule` `E.credibility_interview_triggers` `E.visa_condition_breach_consequences` `E.refusal_notification_format` `E.appeal_fee` `E.appeal_window_days` `E.visa_cancellation_grounds` |  |
| F (post-study-migration) | `F.psw_excluded_levels_or_courses` `F.psw_eligibility_for_course` `F.psw_once_per_lifetime` `F.opt_unemployment_days_max` `F.pr_typical_years_by_route` `F.pr_route_assumptions` `F.work_in_field_required_for_pr` `F.job_seeker_visa_name` | `F.h1b_lottery_selection_rate` `F.h1b_policy_flags` `F.green_card_backlog_by_chargeability` `F.points_estimate_for_typical_graduate` `F.pnp_allocation_annual` `F.quebec_immigration_route` `F.state_nomination_annual_allocation` `F.migration_regulated_adviser_scheme` | `F.dama_agreements` `F.migration_talent_visa_routes` |
| G (occupation-career) | `G.graduate_employment_rate_international` `G.course_occupation_requires_further_qualification` | `G.occupation_list_removal_risk` `G.future_demand_rating` `G.vacancy_trend_12m` `G.market_saturation_signal` `G.in_field_employment_rate` `G.entry_role_experience_required_years` `G.return_home_recognition` | `G.skillselect_occupation_ceiling` `G.automation_risk_score` `G.graduate_underemployment_rate` `G.occupation_international_transferability` |
| H (scholarship) |  | `H.scholarship_applicant_type` `H.scholarship_deferral_allowed` `H.scholarship_return_home_bond` `H.govt_scheme_success_rate_pct` `H.hardship_fund_available` | `H.phd_scholarship_success_rate_pct` `H.hardship_fund_eligibility_text` `H.hardship_fund_max_amount` |
| I (english-and-tests) | `I.packaged_english_pathway_available` `I.english_medium_prior_study_waiver` `I.pathway_direct_entry_on_completion` | `I.local_language_prep_year_available` | `I.english_realistic_floor_by_test` |
| J (pathways-articulation) | `J.pathway_type` `J.guaranteed_progression` `J.time_delta_vs_direct_months` `J.cost_delta_vs_direct` | `J.pathway_max_fails_allowed` `J.transfer_guaranteed_seat` `J.exit_award_if_not_progressing` | `J.credit_recognised_by_other_institutions` `J.internal_pathway_progression_note` |
| K (application-process) | `K.visa_history_declaration_required` | `K.application_withdrawal_process` `K.typical_rejection_reasons` | `K.reapplication_after_rejection_allowed` |
| L (fees-and-money) | `L.fee_item_refundable` `L.visa_refusal_refund_pct` `L.refund_admin_fee` `L.refund_processing_days` `L.funds_product_refund_on_refusal` | `L.refund_evidence_required` `L.refund_payee_rule` `L.tuition_protection_scheme_name` `L.tuition_protection_coverage_rule` | `L.refund_currency_rule` |
| M (accommodation-arrival) | `M.accommodation_visa_refusal_release_clause` `M.agency_arrival_support_contact` | `M.accommodation_cancellation_policy` `M.guarantor_requirement` |  |
| N (life-and-work-rights) | `N.work_rights_breach_consequences` `N.exploitation_protections_for_students` `N.student_complaints_ombudsman` |  |  |
| O (academic-rules) | `O.good_standing_gpa_min` `O.course_progress_rule` `O.change_course_onshore_rule` `O.change_level_onshore_rule` `O.change_provider_onshore_rule` `O.release_letter_policy` `O.reporting_obligation_triggers` | `O.attendance_warning_thresholds` `O.intervention_strategy_triggers` `O.show_cause_process` `O.exclusion_rule` `O.release_processing_days` `O.attrition_rate` `O.completion_rate` | `O.misconduct_penalty_ladder` `O.first_year_pass_rate` `O.international_student_pass_rate` |
| P (family-dependants) |  | `P.marriage_recency_scrutiny` `P.dependant_refusal_risk_observation` |  |
| T (intake-calendar) |  | `T.intake_closed_early_flag` |  |
| U (source-country-grading) | `U.direct_entry_year12_accepted` `U.three_year_degree_accepted_by` | `U.typical_min_for_diploma_vet_entry` `U.distance_degree_acceptance` `U.vocational_qualification_names` `U.vocational_articulation_accepted` `U.gap_year_common_reasons` | `U.grade_inflation_signal` |
| W (destination-policy) |  | `W.nationality_posture` `W.policy_expert_reading` |  |
<!-- generated:stage-S17:end -->

**Playbooks and views:** `visa_risk_analysis`, `alternative_pathways`, `comparative_decision` → views 8, 7, 4.

## S18 — Special populations

**Student asks**
- "My daughter is 16. Can she study Year 11 there and who looks after her?" → `R.under18_min_age_for_visa`, `R.welfare_arrangements`, `R.custodian_requirements`, `R.homestay_vetting`, `E.under18_guardian_requirements` (view 12).
- "Can I go and live with my child?" → `R.guardian_visa`, `E.student_guardian_visa_type`, `E.visitor_visa_for_parents`.
- "What do schools cost and is boarding available?" → `R.school_tuition_fee`, `R.school_boarding_available`, `R.school_boarding_fee`, `R.homestay_fee`, `R.school_welfare_fee` (view 2).
- "Foundation year or Year 12?" → `R.foundation_year_vs_year12_comparison`, `R.school_leaver_university_entry_pathway`, `J.pathway_type` (view 7).
- "I am 34 and want a bachelor's. Is it too late?" → `A.max_age`, `E.genuine_intent_gap_scrutiny`, `F.psw_age_max`, `F.age_points_decline_curve` (view 8).
- "I want a PhD. Do I need a supervisor first, and is it funded?" → `Q.supervisor_required_before_application`, `Q.supervisor_finder_url`, `Q.funding_stipend`, `Q.funding_type`, `Q.research_application_rounds` (view 11).
- "Can a PhD student work unlimited hours and bring family?" → `Q.research_work_hours_rule`, `Q.research_dependant_rights_note`, `Q.research_post_study_visa_length`.
- "I have a disability. What support is there?" → `B.counselling_service_available`, `N.international_student_support_hubs`, `B.known_student_concerns`.

**Attributes by domain**

<!-- generated:stage-S18:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.min_age` |  | `A.mature_entry_policy` `A.max_age` |
| B (institution) |  | `B.source_market_presence_band` `B.student_societies_south_asian` `B.counselling_service_available` `B.prayer_room_available` `B.halal_food_available` | `B.religious_affiliation` `B.disability_support_available` |
| C (campus-location) | `C.campus_security_services` | `C.campus_security_shuttle_hours` `C.campus_area_safety_rating` `C.religious_facilities_nearby` | `C.nearest_ethnic_grocery` |
| D (city-cost-of-living) | `D.women_safety_index` `D.diaspora_community_presence` | `D.homestay_weekly_cost_typical` `D.diaspora_population_by_origin` `D.community_organisations_by_origin` `D.ethnic_grocery_availability` `D.halal_food_availability` `D.religious_facilities_count` | `D.vegetarian_food_availability` |
| E (destination-visa) | `E.onshore_switching_rules` | `E.age_limits` `E.under18_guardian_requirements` | `E.student_guardian_visa_type` |
| F (post-study-migration) | `F.psw_age_max` `F.points_age_table` `F.pr_age_cutoff` | `F.green_card_backlog_by_chargeability` `F.age_points_decline_curve` | `F.migration_talent_visa_routes` |
| H (scholarship) |  | `H.need_based_bursary_available` | `H.scholarship_age_limit` `H.scholarship_target_groups` `H.sports_scholarship_available` `H.sports_scholarship_sports` `H.sports_scholarship_level_required` |
| I (english-and-tests) |  |  | `I.test_min_age` `I.test_accommodations_available` |
| K (application-process) | `K.portfolio_submission_process` | `K.portfolio_spec` `K.audition_process` `K.research_proposal_required` | `K.audition_spec` |
| M (accommodation-arrival) |  | `M.under_18_accommodation_rule` `M.community_groups_for_arrivals` |  |
| N (life-and-work-rights) |  | `N.min_wage_age_bands` |  |
| R (school-and-under18) |  |  | `R.under18_min_age_for_visa` `R.guardian_visa` `R.welfare_arrangements` `R.custodian_requirements` `R.welfare_start_end_rule` `R.under18_turning_18_transition` `R.under18_visa_documents` `R.under18_genuine_intent_note` `R.school_type` `R.school_curriculum` `R.school_year_levels_offered` `R.school_tuition_fee` `R.school_boarding_available` `R.school_boarding_fee` `R.school_english_entry_requirement` `R.homestay_fee` `R.school_welfare_fee` `R.school_international_student_support` `R.homestay_vetting` `R.homestay_provider_type` `R.homestay_rules_for_minors` `R.minor_travel_and_holiday_rule` `R.medical_consent_for_minors` `R.school_leaver_university_entry_pathway` `R.foundation_year_vs_year12_comparison` `R.school_completion_visa_transition` `R.school_academic_reporting_to_parents` |
<!-- generated:stage-S18:end -->

**Playbooks and views:** `family_planning`, `program_selection`, `scholarship_funding` → views 12, 7, 11.

## S19 — Time-sensitive & policy change

**Student asks**
- "Is it too late for the July intake?" → `T.term_start_date`, `T.application_close_date_international`, `K.application_deadline_type`, `T.intake_closed_early_flag`, `X.internal_submission_deadlines` (view 5).
- "When must I pay the deposit and get the CoE?" → `T.deposit_deadline`, `T.enrolment_confirmation_latest_issue_date`, `K.enrolment_document_issuance_lead_days` (view 5).
- "How long is the visa taking this month?" → `E.visa_processing_time_weeks`, `E.processing_time_official_range`, `E.biometrics_appointment_lead_days`, `E.health_exam_lead_days`, `E.peak_season_note` (view 5).
- "What changed in the rules last month?" → `W.policy_change_log`, `W.policy_change_title`, `W.policy_effective_at`, `W.policy_applies_to`, `E.policy_effective_date` (view 9).
- "Does the new rule apply to me if I already lodged?" → `W.policy_transitional_rule`, `E.transitional_arrangements_rule`, `W.policy_change_status`.
- "Is something else about to change?" → `W.upcoming_policy_watchlist`, `W.policy_expert_reading`, `F.migration_fact_last_verified_at`.
- "When do my results come out at home relative to their deadline?" → `U.result_publication_months`, `T.results_release_date`, `U.origin_public_holidays_affecting_documents`.

**Attributes by domain**

<!-- generated:stage-S19:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.offshore_online_start_allowed` `A.course_status` `A.international_seats_capped` |  | `A.seat_count_international` |
| B (institution) | `B.au_visa_processing_priority_tier` `B.notable_risks` `B.cap_allocation` `B.offer_turnaround_days` `B.offer_validity_days` `B.enrolment_confirmation_turnaround_days` `B.deferral_policy` | `B.partner_priority_offer_turnaround_days` |  |
| C (campus-location) | `C.campus_status` |  |  |
| D (city-cost-of-living) | `D.official_living_cost_effective_date` |  |  |
| E (destination-visa) | `E.apply_window_before_course_start` `E.sds_pal_variant` `E.visa_processing_time_weeks` `E.processing_time_official_range` `E.processing_time_observed_origin` `E.policy_effective_date` | `E.re_entry_travel_rule` `E.priority_processing_available` `E.peak_season_note` `E.appeal_window_days` `E.transitional_arrangements_rule` |  |
| F (post-study-migration) | `F.psw_apply_within_days` `F.points_table_effective_date` `F.ee_draw_recent_cutoffs` `F.pnp_stream_status` `F.state_nomination_program_status` `F.occupation_list_change_log` `F.migration_policy_change_pending` `F.migration_policy_announcement_vs_effective` | `F.psw_onshore_lodgement_required` `F.psw_bridging_work_rights` `F.psw_processing_time_observed` `F.psw_completion_evidence_required` `F.cap_gap_extension_available` `F.h1b_policy_flags` `F.state_nomination_min_points_or_score` `F.age_points_decline_curve` `F.onshore_pr_application_allowed_while_student` `F.pr_processing_time_official` |  |
| G (occupation-career) | `G.occupation_list_membership` | `G.skills_assessment_processing_weeks` `G.professional_year_duration_weeks` |  |
| H (scholarship) | `H.scholarship_status` `H.scholarship_valid_intakes` `H.scholarship_separate_deadline` `H.scholarship_deadline_date` `H.scholarship_deadline_type` `H.govt_scheme_application_window` | `H.scholarship_early_bird_deadline` `H.scholarship_decision_weeks` `H.scholarship_deferral_allowed` `H.govt_scheme_selection_rounds` `H.phd_scholarship_rounds_per_year` `H.scholarship_deadline_days_before_course_start` | `H.early_payment_deadline_rule` |
| I (english-and-tests) | `I.english_pathway_length_weeks` `I.test_validity_months` `I.test_result_days` `I.english_validity_months_for_admission` `I.english_validity_measured_to` `I.english_condition_deadline_rule` `I.visa_english_validity_months` `I.pathway_weeks_per_half_band` `I.pathway_max_weeks` | `I.test_frequency` `I.test_retake_wait_days` `I.test_registration_deadline_rule` `I.test_cycle_window` `I.visa_english_test_date_measured_to` `I.pathway_start_frequency` `I.test_upcoming_dates` | `I.naati_ccl_result_weeks` `I.test_seat_availability_signal` |
| J (pathways-articulation) | `J.pathway_status` `J.articulation_valid_to` | `J.pathway_intakes_per_year` |  |
| K (application-process) | `K.application_deadline_type` `K.application_deadline_international` `K.latest_realistic_lodge_date` `K.enrolment_document_issuance_lead_days` | `K.application_open_date` `K.application_rounds` `K.late_application_accepted` `K.credential_evaluation_weeks` `K.atas_processing_weeks` `K.enrolment_document_observed_lead_days` `K.enrolment_document_latest_issue_days_before_start` `K.condition_satisfaction_deadline_rule` `K.origin_remittance_processing_days` `K.partner_agent_offer_sla_days` | `K.payment_reconciliation_days` |
| L (fees-and-money) | `L.first_payment_due_rule` `L.funds_product_processing_days` `L.loan_sanction_turnaround_days` | `L.first_payment_due_days` `L.payment_schedule_projection` | `L.payment_channel_settlement_days` |
| M (accommodation-arrival) | `M.accommodation_application_open_date` `M.accommodation_application_deadline` `M.airport_pickup_booking_lead_days` `M.latest_arrival_rule` `M.pre_departure_briefing_format` | `M.accommodation_availability_status` |  |
| N (life-and-work-rights) |  | `N.home_festival_break_overlap` |  |
| O (academic-rules) | `O.terms_per_year` `O.non_commencement_report_rule` | `O.completion_letter_issue_days` | `O.results_release_timing` |
| P (family-dependants) |  |  | `P.dependant_visa_processing_time` |
| Q (research-phd) |  | `Q.research_application_rounds` |  |
| S (regulated-professions) |  | `S.registration_weeks` |  |
| T (intake-calendar) | `T.term_code` `T.intake_display_name` `T.intake_season` `T.intake_scope` `T.term_start_date` `T.term_end_date` `T.census_date` `T.inter_term_break` `T.institution_shutdown_periods` `T.application_open_date_international` `T.application_close_date_international` `T.late_application_accepted_until` `T.conditional_offer_evidence_deadline` `T.offer_acceptance_deadline` `T.deposit_deadline` `T.scholarship_application_deadline` `T.enrolment_confirmation_latest_issue_date` `T.recommended_visa_lodge_by` `T.recommended_application_lodge_by` `T.orientation_period` `T.latest_arrival_date` `T.backward_timeline_template` `T.intake_status` `T.intake_status_as_of` `T.intake_offered_flag` `T.fee_year_published` `T.public_holidays_origin` `T.agency_events` `T.agency_document_lead_times` | `T.results_release_date` `T.intake_quality_note` `T.deferral_request_deadline` `T.seats_signal` `T.intake_closed_early_flag` `T.public_holidays_destination` `T.visa_office_peak_periods` `T.state_nomination_program_open_dates` `T.test_date_availability_window` | `T.next_fee_release_expected` |
| U (source-country-grading) | `U.result_publication_months` | `U.transcript_turnaround_days` `U.degree_certificate_delay_months` `U.academic_year_start_month` `U.final_exam_months` `U.predicted_grades_available` `U.origin_public_holidays_affecting_documents` | `U.moi_letter_turnaround_days` `U.verification_turnaround_days` |
| V (meta-provenance) | `V.valid_from` `V.valid_to` `V.change_history` `V.policy_change_ref` |  |  |
| W (destination-policy) |  | `W.caps_policy` `W.cap_allocation_by_region` `W.destination_comparison_matrix` `W.policy_change_log` `W.policy_change_title` `W.policy_announced_at` `W.policy_effective_at` `W.policy_applies_to` `W.policy_transitional_rule` `W.policy_affected_attributes` `W.policy_source_url` `W.policy_change_status` `W.policy_expert_reading` `W.upcoming_policy_watchlist` |  |
| X (agency) |  |  | `X.internal_submission_deadlines` |
<!-- generated:stage-S19:end -->

**Playbooks and views:** `policy_change`, `strategic_planning`, `application_process` → views 5, 9.

## S20 — Meta (how sure are we, sources)

**Student asks (usually the counsellor asking Edge)**
- "Where did this number come from and when?" → `V.source_url`, `V.source_type`, `V.extracted_at`, `V.verified_by`, `V.verified_at`, `V.verification_method` (view 9).
- "Is this still current?" → `V.valid_from`, `V.valid_to`, `V.is_stale`, `V.staleness_max_age_days`, `V.review_due_at` (view 9).
- "Can I quote this to the student?" → `V.quotable_to_students`, `F.migration_advice_disclaimer_required`, `X.commission_disclosure_statement` (view 15).
- "The university page and the government page disagree." → `V.conflicts`, `V.conflict_resolution`, `V.conflict_resolution_rule` (view 9).
- "How much of this course's data do we actually have?" → `V.coverage_pct`, `V.source_coverage_report`, `V.answer_time_live` (view 10).
- "Someone corrected this last week." → `V.human_override`, `V.override_reason`, `V.override_expires_at`, `V.counsellor_correction_count`.
- "Which rule changed this value?" → `V.change_history`, `V.policy_change_ref`, `W.policy_affected_attributes`.

**Attributes by domain**

<!-- generated:stage-S20:start -->
| domain | tier 1 | tier 2 | tier 3 |
|---|---|---|---|
| A (course) | `A.course_page_url` `A.extraction_evidence` | `A.handbook_url` | `A.brochure_url` |
| B (institution) | `B.regulatory_registrations_last_verified_at` |  |  |
| C (campus-location) | `C.campus_slug` `C.regional_classification_verified_at` |  |  |
| D (city-cost-of-living) | `D.cost_index_source_base` `D.cost_source` `D.cost_year` |  |  |
| E (destination-visa) | `E.agent_lodgement_rule` `E.processing_time_observed_as_of` `E.policy_effective_date` | `E.grant_rate_period` |  |
| F (post-study-migration) | `F.migration_advice_disclaimer_required` `F.migration_source_official_url` `F.migration_fact_last_verified_at` | `F.migration_regulated_adviser_scheme` |  |
| G (occupation-career) | `G.demand_rating_source` `G.demand_rating_date` `G.salary_source` `G.salary_year` `G.graduate_employment_rate_source` `G.course_occupation_mapping_confidence` `G.course_occupation_mapping_source` | `G.occupation_framework_version` |  |
| H (scholarship) | `H.scholarship_id` `H.scholarship_last_verified_at` |  |  |
| I (english-and-tests) | `I.test_code` |  |  |
| J (pathways-articulation) | `J.articulation_valid_from` `J.articulation_valid_to` `J.agreement_url` |  |  |
| K (application-process) |  | `K.agent_lodgement_sla_days` | `K.escalation_contact_role` |
| O (academic-rules) | `O.academic_calendar_url` | `O.academic_integrity_policy_url` |  |
| T (intake-calendar) | `T.intake_status_as_of` `T.term_dates_source_url` | `T.intake_status_source` |  |
| U (source-country-grading) | `U.grading_scheme_id` |  |  |
| V (meta-provenance) | `V.fact_id` `V.source_url` `V.source_type` `V.source_kind` `V.source_quote` `V.source_access_restriction` `V.reliability_tier` `V.extracted_at` `V.extraction_model` `V.extraction_prompt_version` `V.confidence` `V.content_hash` `V.derived_from_fact_ids` `V.verification_state` `V.verified_by` `V.verified_at` `V.verification_method` `V.needs_verification` `V.valid_from` `V.valid_to` `V.applies_to` `V.superseded_by` `V.fact_nature` `V.quotable_to_students` `V.tristate_state` `V.conflicts` `V.conflict_fact_id` `V.conflict_values` `V.conflict_resolution` `V.conflict_resolution_rule` `V.conflict_reason` `V.change_history` `V.change_detected_at` `V.change_old_value` `V.change_new_value` `V.change_trigger` `V.policy_change_ref` `V.attribute_class` `V.refresh_cadence` `V.staleness_max_age_days` `V.review_due_at` `V.is_stale` `V.answer_time_live` `V.answer_time_fetched_at` `V.currency_code` `V.fx_rate_used` `V.fx_as_of` `V.human_override` `V.override_reason` `V.coverage_pct` `V.missing_attribute_list` `V.stale_attribute_list` | `V.source_page_ref` `V.source_page_language` `V.extraction_page_kind` `V.record_updated_at` `V.crawl_run_id` `V.source_last_crawled` `V.source_last_changed` `V.derivation_rule_version` `V.conflict_resolved_by` `V.override_by` `V.override_at` `V.last_answer_used_at` `V.citation_count` `V.counsellor_correction_count` `V.coverage_last_computed_at` `V.source_coverage_report` | `V.source_quote_translated` `V.source_page_title` `V.source_archive_url` `V.override_expires_at` `V.answer_feedback_score` |
| W (destination-policy) |  | `W.policy_change_log` `W.policy_affected_attributes` `W.policy_source_url` | `W.agent_regulation_status` `W.fx_source` `W.fx_display_rounding_rule` `W.policy_change_alert_sent_at` |
| X (agency) |  |  | `X.agency_legal_name` `X.agency_accreditations` `X.agency_public_urls` `X.commission_disclosure_statement` `X.case_process_stages` `X.student_feedback_and_complaints_channel` `X.privacy_and_data_handling_statement` |
<!-- generated:stage-S20:end -->

**Playbooks and views:** every playbook → views 9, 10.

## Gaps found

Questions counsellors hear that the catalog still answers only partially. Each is a candidate
row or a collection task, not a missing file.

| stage | question | what is missing | proposed home |
|---|---|---|---|
| S1 | "Which counsellor speaks Newari / Bhojpuri?" | branch staff languages are inside `X.branches` only as an array; no per-counsellor record | out of scope (`CounsellorNote` reserved) |
| S2 | "Which country is best for *my* profile?" | needs a scored recommendation over `W.destination_comparison_matrix`; no weighting rule is catalogued | 07 view 4 derivation, not a row |
| S4 | "Is this college about to lose its licence?" | no row for regulator sanctions or enforcement actions against a provider | B (`institution_regulatory_actions`, tier 2) |
| S5 | "My marks are from an Indian state board not listed." | U covers NEB, CBSE, HSC, TU and the main VN/PH/TH schemes; state boards need GradingScheme rows, a data task | U rows, collection backlog |
| S7 | "Can you write my SOP?" | process rule about what Expert will and will not draft | X (`sop_drafting_policy`, tier 3, internal) |
| S8 | "What does a Nepali bank charge to remit fees?" | `L.origin_remittance_indicative_fee` exists but has no collection owner or cadence agreed | 04-sourcing |
| S10 | "How long does VFS take to return my passport?" | passport return time after decision is not a row | E (`passport_return_days`, tier 3) |
| S12 | "Where can I find a room share with Nepali students?" | community housing channels (Facebook groups, temple boards) are not a catalogued fact | out of scope; live search |
| S14 | "Can my dependant child study at university on the dependant visa?" | P covers school access; tertiary study by a dependant child is not stated | P (`dependant_child_tertiary_study_rule`, tier 3) |
| S16 | "What do Expert alumni earn?" | outcome data on Expert's own placed students is `CaseOutcome`, out of scope | reserved entity |
| S18 | "Is there support for a student with a disability or a chronic condition?" | B has counselling and support rows; accessibility services and disability adjustments are not a row | B (`disability_support_services`, tier 3) |
| S19 | "Will the AUD go up before I pay?" | `W.fx_12m_trend` is descriptive; no forecast is (or should be) catalogued | answer with disclaimer only |
