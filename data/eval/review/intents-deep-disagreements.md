# intents-deep: rows needing human review

Generated 2026-10-08 from `data/eval/intents-deep.jsonl` (1,300 rows, one per `data/eval/coverage.jsonl` row) after running both classifiers over it: Jev (`typesafe/jev-1.13`) and Gemini (`gemini-3.5-flash-lite`), single-turn, routed through `decideRoute`. Every row listed here carries `review: true` in the JSONL.

## Labeling rule

- **Intent confirmed**: Jev or Gemini predicts the label or a member of `accept[]`.
- **Both classifiers agree on another intent**: when that was a reasonable reading on inspection (all 250 such rows were read), it was added to `accept[]` and the label kept. Where the label itself looked wrong, the row is also flagged below as *intent (swap?)*.
- **Classifiers disagree with the label and with each other**: `review: true`, listed under *intent*. Labels were not changed.
- Same rule for `task` (`acceptTask[]`) on the 203 rows that carry a task; rows without a coverage task have no task label.
- Destinations were read against both routes; obvious label errors were fixed in the JSONL (listed at the end), doubtful ones are listed under *destinations*.

Counts: 63 intent splits, 8 label-swap candidates, 7 task splits, 2 destination doubts — 80 rows.

## intent

| id | text | label | jev | gemini | note |
|---|---|---|---|---|---|
| adm-my-alt-1 | Bangladeshi student wants a 2+1 twinning: two years in Malaysia then final year in the UK. Which Malaysian institutions have UK partners,… | alternative_pathways | university_selection | program_selection | 2+1 twinning is a pathway; asks which institutions → university_selection fair. Destinations fixed to MY+UK. |
| adm-nz-alt-1 | Vietnamese student finished a Level 7 Graduate Diploma at a NZ polytechnic last year. Can she get credit toward a Master's at a NZ univer… | alternative_pathways | eligibility_check | program_selection | Credit from a GradDip toward a master's: eligibility_check reads well. Consider accept eligibility_check. |
| adm-us-alt-2 | Thai student with TOEFL 68 — which US universities give conditional admission with an intensive English program, what's the minimum to en… | alternative_pathways | university_selection | eligibility_check | Conditional admission + IEP is a pathway; university_selection also fair (asks which unis). Consider accept university_selection. |
| s1x-s6-09 | Bangladeshi student got 5.5, UK MSc wants 6.0 — pre-sessional length, exit test, and can it go on one CAS? | alternative_pathways | offer_enrolment | eligibility_check | Pre-sessional on one CAS: alternative_pathways ok; offer_enrolment also fair (CAS package). |
| sw-uk-lk-53 | Sri Lankan student weighing a UK foundation year vs direct entry: pathway duration, time delta, pathway tuition, progression conditions, … | alternative_pathways | comparative_decision | program_selection | Foundation vs direct entry comparison; comparative_decision also fair. |
| tk-stg-06 | Enquiry from a Thai parent: son is 17, finishing Mathayom 6 in a Thai-program school. Can he go straight into a UK bachelor's or does he … | alternative_pathways | comparative_decision | program_selection | Foundation vs direct entry (and vs A-levels): alternative_pathways ok; comparative_decision also fair. |
| adm-nz-app-2 | NZ uni has asked for an NZQA International Qualifications Assessment for a Nepali applicant. When is it actually needed, what's the fee a… | application_process | document_preparation | eligibility_check | NZQA IQA is a document/assessment step; document_preparation probably better than application_process. |
| s1x-s5-p04-lk | Sri Lankan student applying to UK unis — do they want O/L results as well as A/L? | application_process | document_preparation | eligibility_check | Do UK unis want O/L as well as A/L — document_preparation (Jev) is a fair reading. |
| s2x-s19-results-uk-np | Nepali student's message: "My bachelor final results won't be out until August, but the UK uni wants conditions met by July. Can I use a … | application_process | document_preparation | offer_enrolment | Provisional results to meet offer conditions → offer_enrolment likely better (cf. s2x-s19-results-uk-lk, accepted). |
| sw-uk-th-61 | Thai student finishing M.6 — when are final exams and results, when does the Thai school year start, will her school give predicted grade… | application_process | strategic_planning | document_preparation | Thai school calendar + predicted grades for a UK offer: application_process ok; strategic_planning fair. |
| money-us-car-2 | Indian student torn between MS Business Analytics and MS CS in the US — which is STEM OPT eligible, how long can they work on OPT, and wh… | career_roi | migration_pathway | program_selection | STEM OPT + salaries: career_roi ok; migration_pathway/program_selection both partial. |
| s1x-s3-14 | Pinay RN messaged: "if I take Master of Nursing in Australia, can I register with AHPRA after? which courses po?" | career_roi | program_selection | migration_pathway | Master of Nursing → AHPRA registration: program_selection reasonable (which courses po?). |
| s1x-s3-15 | Indian GNM nurse — will a UK nursing course let her register with the NMC, or is the OSCE route for overseas nurses better? | career_roi | comparative_decision | program_selection | UK nursing course vs OSCE route: comparative_decision fair. |
| s1x-s3-17 | Sri Lankan nurse asks whether a NZ Bachelor of Nursing or a Competence Assessment Programme leads to Nursing Council registration. | career_roi | comparative_decision | program_selection | NZ BN vs CAP for registration: comparative_decision/program_selection fair. |
| s2x-s16-leads-au | Sri Lankan student wants to become a psychologist in New Zealand. Does a 3-year psychology degree get her registered, or what further stu… | career_roi | eligibility_check | migration_pathway | Psychologist registration path in NZ (id says au, text says NZ): career_roi ok. |
| s2x-s16-research-au | Sri Lankan student torn between a coursework master's and a research master's/PhD in Australia. Which is better for jobs and PR — complet… | career_roi | comparative_decision | migration_pathway | Coursework vs research master's for jobs and PR: comparative_decision fair. |
| sw-au-np-84 | Nursing student ho Sydney ma — placement aghi police check/vaccination, nursing ma capped places/admission test, local graduate lai AHPRA… | career_roi | migration_pathway | onshore_support | Romanized Nepali, nursing placement checks + AHPRA: mixed; onshore_support also fair. |
| sw-au-ph-83 | Filipino RN with 4 yrs experience: how does AHPRA/NMBA treat her PH BSN, does she need a bridging program and its cost, registration fee,… | career_roi | application_process | eligibility_check | AHPRA recognition of a PH BSN: eligibility_check (Gemini) is a fair reading. |
| sw-ca-bd-33 | Bangladeshi pharmacist wants to practise in Canada: how is her BD BPharm recognised, bridging program and cost, exam fees, supervised pra… | career_roi | application_process | migration_pathway | Foreign pharmacist licensing in Canada: career_roi ok; migration_pathway fair. |
| sw-ca-in-11 | Indian student, BEng in Canada — is it CEAB accredited and for which majors, is engineering regulated there, which body licenses engineer… | career_roi | general_inquiry | program_selection | CEAB accreditation / licensing: career_roi ok; program_selection fair. Jev general_inquiry is wrong. |
| sw-uk-bd-16 | Bangladeshi BBA wants a UK MSc Accounting. Which bodies accredit it (ACCA/ICAEW/CIMA exemptions), any caveats on scope, what careers the … | career_roi | university_selection | program_selection | Professional accreditation & careers of a course: career_roi or program_selection. |
| cmpx-20 | Kathmandu branch asks: weak profile (IELTS 6.0, +2 passed in 2019, no work since) — Australia, UK or Canada, where are grant rates for Ne… | comparative_decision | scholarship_funding | visa_risk_analysis | 3-country compare of grant rates for a weak profile: visa_risk_analysis (Gemini) fair; Jev scholarship_funding wrong. |
| adm-uk-elig-3 | Bangladeshi student, HSC GPA 4.5, her UK uni waived IELTS based on her bachelor's MOI letter. Will UKVI accept that for the CAS and visa … | eligibility_check | document_preparation | visa_process | Will UKVI accept an MOI waiver for the visa: visa_process (Gemini) fair. |
| sw-au-lk-82 | Sri Lankan MPhil holder wants an Australian PhD: research proposal needed before applying, research rounds and scholarship deadlines, how… | eligibility_check | application_process | program_selection | PhD admission prerequisites + funding rounds: application_process fair. |
| s2x-s18-minor-nz | Vietnamese parents ask: "We want our 14-year-old son in a New Zealand high school. Who has to look after him, how are homestays checked, … | family_planning | visa_process | onshore_support | Minor's guardianship/homestay (pastoral care): onshore_support or compliance_ethics; family_planning a stretch. |
| s2x-s18-minor-uk | Thai family wants their 15-year-old in a UK boarding school for GCSEs. Minimum age for the Child Student visa, do they need a UK guardian… | family_planning | visa_process | eligibility_check | Child Student visa + guardianship: family_planning is a stretch (minor, not dependants); visa_process fair. |
| s2x-s18-phdfam-au | Sri Lankan PhD student heading to Australia: "Can I work unlimited hours once the PhD starts? Can my wife and child come, can she work fu… | family_planning | migration_pathway | work_survival | Compound: work hours + dependants + 485 → family_planning ok, secondary topics fair. |
| s2x-s11-ins-de | Indian master's student going to Germany: public vs private health insurance for the visa and enrolment — which is mandatory for him, mon… | financial_viability | visa_process | onshore_support | German health insurance for visa/enrolment: visa_process or onshore_support fair. |
| s2x-s11-ins-us | Thai MS student in Arizona — uni auto-enrolled him in the student health plan at about $3k a year. Can he waive it with a cheaper Thai or… | financial_viability | visa_process | onshore_support | Waiving a US school health plan: onshore_support fair. |
| sw-uk-vn-44 | Vietnamese parents nervous after news of a UK college closing. What protects prepaid tuition, what the scheme actually does and how to cl… | financial_viability | offer_enrolment | anxiety_reassurance | Tuition protection after a college closure: financial_viability ok; offer_enrolment (refunds) fair. |
| life-ca-life-2 | Bangladeshi student on a tight budget choosing between Halifax and Toronto for a college diploma — which city is cheaper to live in and e… | lifestyle_adaptation | comparative_decision | financial_viability | Halifax vs Toronto cost/jobs: comparative_decision or financial_viability both fair. |
| s2x-s12-remit-au | Australia bata ghar ma paisa pathauna sabai bhanda sasto ra legal tarika k ho? Hundi bata pathaune ki remit company? Sydney ma baseko stu… | lifestyle_adaptation | general_inquiry | financial_viability | Sending money home: financial_viability (Gemini) fair; Jev general_inquiry wrong. |
| s2x-s12-remit-uk | Bangladeshi student in New York wants to send money to his mother every month. Cheapest official channel, is there any incentive on the B… | lifestyle_adaptation | general_inquiry | financial_viability | Remittance to Bangladesh from the US: financial_viability fair. |
| s2x-s18-support-au | Thai student with ADHD on medication going to Melbourne. Does it affect the visa health requirement, can she bring her meds, and what dis… | lifestyle_adaptation | visa_process | onshore_support | Visa health requirement + meds + disability support: onshore_support fair. |
| sw-au-np-35 | Uni of Newcastle Callaghan campus ko exact location pin (lat/long) chahiyo, CBD bata kati tadha, kun kun transport le pugcha, nearest sta… | lifestyle_adaptation | onshore_support | university_selection | Campus location/transport: lifestyle_adaptation ok; onshore_support fair. |
| sw-uk-np-24 | UK uni ma on-campus job paincha? Campus mai immigration advice (free?) cha, international student support office cha, ra careers service … | lifestyle_adaptation | onshore_support | work_survival | On-campus jobs + student support offices: onshore_support fair. |
| sw-us-th-15 | Thai student wants uni housing in Boston: what does the guarantee cover, when do applications open, guarantee deadline, current availabil… | lifestyle_adaptation | application_process | onshore_support | University housing guarantee: onshore_support fair. |
| tk-stg-26 | Filipino student flying Manila to Toronto via Tokyo or via Los Angeles. Does she need a transit visa for either route, and what baggage a… | lifestyle_adaptation | onshore_support | visa_process | Transit visa + baggage: onshore_support (pre-departure) is a fair reading; visa_process partial. |
| s2x-s15-reg-uk | Indian BSc Nursing grad with 2 years' experience — how does she register with the NMC in the UK: CBT, OSCE, English score, cost and how l… | migration_pathway | application_process | document_preparation | NMC registration route: migration_pathway is weak — career_roi or eligibility_check likely better. |
| sw-ca-ph-16 | Filipino student offered a college in a small Manitoba town. What community type is it, is it in a Rural Community Immigration Pilot comm… | migration_pathway | lifestyle_adaptation | onshore_support | Rural Community Immigration Pilot town: migration_pathway ok; lifestyle/onshore partial. |
| sw-nz-lk-12 | Sri Lankan student's offer at an Auckland city campus — give me the campus slug for the CRM offering, what delivery modes run there, camp… | offer_enrolment | caseload_management | company_services | Asks for CRM campus slug / delivery modes: company_services (Gemini) fair; label offer_enrolment doubtful. |
| s2x-s13-breach-ca | Indian student in Brampton worked 35 hrs/week during term after the 24-hour cap came in, and IRCC sent a procedural fairness letter. What… | onshore_support | work_survival | visa_risk_analysis | Procedural fairness letter after over-working: visa_risk_analysis (Gemini) fair. |
| sw-au-np-77 | Aus uni ko grading HD/D/C/P ko % range, WAM ki GPA use garcha, pass mark kati, good standing ko lagi minimum GPA, ra credit system kasto? | onshore_support | general_inquiry | company_services | Australian grading scale/WAM: onshore_support doubtful; eligibility_check or general_inquiry. Label needs a human. |
| visa-cmp-pol-1 | Quick compare after all the recent dependant changes: where can a master's student currently bring a spouse — Australia, the UK or Canada… | policy_change | family_planning | comparative_decision | Recent dependant changes across 3 countries: policy_change ok; family_planning and comparative_decision both fair. |
| adm-au-prog-2 | Bangladeshi MSc holder in Environmental Science with one journal publication wants a PhD in Australia. What's the minimum for research ad… | program_selection | application_process | eligibility_check | PhD research admission minimum: eligibility_check (Gemini) fair. |
| adm-us-prog-1 | Bangladeshi student wants a STEM-designated MS. How do I check if an MS in Business Analytics at a given school is STEM by CIP code so sh… | program_selection | migration_pathway | visa_process | STEM CIP code check for OPT: program_selection ok; migration_pathway partial. |
| s2x-s20-cov-uk | How complete is your data on the MSc Data Science at Coventry for a Bangladeshi student — fees, intakes, entry requirements — and is any … | program_selection | application_process | company_services | Asks how complete Edge's data is: company_services/general_inquiry; label program_selection doubtful. |
| sw-au-bd-17 | Bangladeshi girl, Bachelor of Nursing in Sydney — how many clinical placement hours, mandatory?, does the uni guarantee placement or she … | program_selection | general_inquiry | onshore_support | Clinical placement hours/arrangements: program_selection ok; onshore_support partial. |
| sw-nz-th-09 | Thai student's parent wants proof: quote the exact sentences from the NZ course page for the duration options and entry requirements, wit… | program_selection | lead_engagement | document_preparation | Quote exact course-page sentences: program_selection weak; general_inquiry/eligibility_check. Jev lead_engagement wrong. |
| s2x-s18-phd-us | Vietnamese applicant for a US chemistry PhD asks: "Do I need to email professors before applying? Are PhDs usually fully funded with a st… | scholarship_funding | application_process | program_selection | Contacting professors + PhD funding: scholarship_funding ok; application_process fair. |
| money-nz-strat-2 | NZ student visa still processing and the Feb intake starts in 3 weeks. What's the latest she can arrive, and should we defer to July now? | strategic_planning | visa_process | offer_enrolment | Visa pending, intake in 3 weeks, defer?: offer_enrolment (Gemini) fair. |
| s1x-s1-01 | Student messaged on WhatsApp: "dai +2 sakera yahi BBS padhne ki bahira jane? ghar ma sabai Australia jau bhanchan, tara k fayda cha?" — h… | strategic_planning | comparative_decision | career_roi | Study here vs abroad: comparative_decision or career_roi both fair; strategic_planning weak. |
| s1x-s1-02 | Parent from Colombo asking why her son should leave his BSc at a state university here for a UK degree. What's the honest case for and ag… | strategic_planning | comparative_decision | career_roi | Leave a local BSc for a UK degree: comparative_decision/career_roi fair. |
| sw-nl-in-01 | Indian student considering the Netherlands for a master's — is Dutch needed for study or work, how are Dutch degrees recognised abroad an… | strategic_planning | general_inquiry | program_selection | Netherlands pros/cons, recognition: strategic_planning weak; comparative_decision/program_selection. Needs a human. |
| sw-th-np-01 | Nepali student thinking of an international BBA in Bangkok — Thai language chahincha?, cheapest realistic first-year budget, Nepal ma deg… | strategic_planning | university_selection | program_selection | Bangkok BBA overview: strategic_planning weak; program_selection/university_selection fair. |
| sw-au-lk-64 | Sri Lankan student IELTS 5.5 — ELICOS package: provider, course name, max weeks they'll package, fee per week, does finishing it satisfy … | test_preparation | alternative_pathways | program_selection | ELICOS package: test_preparation ok; alternative_pathways fair. |
| sw-nz-in-05 | Indian BCom grad from Gujarat University wants a NZ master's without IELTS on an MOI letter. Is Gujarat Univ English medium by default, w… | test_preparation | document_preparation | eligibility_check | MOI-based waiver: eligibility_check/document_preparation fair. |
| sw-uk-np-11 | Nepali student did +2 at an English-medium private school and BBA from a TU affiliate. Who issues the MOI letter at each level, is TU act… | test_preparation | eligibility_check | document_preparation | MOI letters for an IELTS waiver: test_preparation ok; eligibility_check/document_preparation fair. |
| adm-au-univ-2 | Which Australian unis are currently doing GS pre-assessment for Nepali applicants before offer, and which ones on our list are Evidence L… | university_selection | application_process | visa_risk_analysis | Which unis do GS pre-assessment / evidence levels: university_selection ok; visa_risk_analysis fair. |
| adm-nl-univ-1 | Vietnamese school leaver choosing between a Dutch research university and a university of applied sciences for a bachelor's in Internatio… | university_selection | comparative_decision | program_selection | Research uni vs UAS: comparative_decision fair. |
| sw-au-np-22 | Hamro students ma sabse dherai enquiry aune MBA kun ho Melbourne ma? Tyo uni ko offer conversion kasto cha (strict ki easy), Expert ko pi… | university_selection | application_process | program_selection | Most-enquired Melbourne MBA + offer conversion + Expert pitch: company_services-ish; label doubtful. |
| sw-uk-ph-26 | Filipino student wants a uni with an INTO/Study Group centre. Which pathway colleges operate on campus with guaranteed progression, does … | university_selection | alternative_pathways | program_selection | Unis with INTO/Study Group centres: alternative_pathways fair. Destination not named in text (set to none). |
| visa-au-proc-2 | Student onshore on a 500 did 4 months at a Melbourne uni and wants to move to a private college diploma in Sydney. Does he need a release… | visa_process | offer_enrolment | onshore_support | Onshore provider change on a 500: onshore_support (Gemini) is the better reading. |

## intent (swap?)

| id | text | label | jev | gemini | note |
|---|---|---|---|---|---|
| s1x-s7-13 | bd student follow-up: "LOA kobe ashbe? 5 week hoye gelo, conditional na unconditional dibe?" — Ontario college. | application_process | offer_enrolment | offer_enrolment | Waiting on an LOA (conditional/unconditional): both say offer_enrolment — consider swapping. |
| tk-rev-11 | Review this UK master's personal statement excerpt from a Hanoi student applying for MSc Marketing (graduated 2021, worked at a cosmetics… | application_process | document_preparation | document_preparation | Reviewing a personal statement: both say document_preparation, which the prompt assigns SOP review to — consider swapping. |
| tk-rev-18 | Review this statement of purpose opening for a Ho Chi Minh City applicant to MS in Computer Science programs in the US: "Ever since I was… | application_process | document_preparation | document_preparation | Reviewing an SOP opening: both say document_preparation — consider swapping. |
| s2x-s20-fix-ca | A colleague overrode the GIC amount for Bangladeshi applicants in the system last week. Which amount do you have now, and is that overrid… | financial_viability | company_services | company_services | Asks about an in-system GIC override by a colleague: both say company_services; label financial_viability is debatable. |
| s2x-s20-cur-au | Is the 485 length for a master's graduate you quoted still current? Vietnamese student is deciding this week — when was it last verified? | migration_pathway | policy_change | policy_change | 'Is the 485 length still current?' — both say policy_change; consider swapping. |
| s2x-s20-cur-uk | Graduate route aba pani 2 barsa ho ki ghatyo? Kahile dekhi lagu huncha? Source chahiyo, student lai pathaunu cha. | migration_pathway | policy_change | policy_change | 'Is the Graduate route still 2 years?' — both say policy_change; consider swapping. |
| s1x-s4-10 | How many Nepali students are at Charles Darwin Uni, and is there a Nepali student society? Parents want community nearby. | university_selection | lifestyle_adaptation | lifestyle_adaptation | Nepali community at CDU: both say lifestyle_adaptation; label university_selection looks wrong — consider swapping. |
| sw-uk-lk-23 | Sri Lankan student keen on a UK uni — are we an official partner, what's our pitch and who it suits, key selling points, and recurring co… | university_selection | company_services | company_services | Both say company_services ('are we an official partner, our pitch'); label university_selection looks wrong — consider swapping. |

## task

| id | text | label | jev | gemini | note |
|---|---|---|---|---|---|
| tk-calc-18 | A Vietnamese MS Computer Science student graduates in May 2027. Lay out the OPT and STEM OPT timeline: filing window, total months of wor… | calculate | lookup | process | OPT/STEM OPT timeline: calculate is a stretch; process (Gemini) fits better. |
| tk-rev-24 | Check this funds table for a Bangladeshi student's UK Student visa (MSc in London, tuition £19,500, £6,000 deposit paid): "Father's savin… | review | eligibility | calculate | Check a funds table: review fits; calculate (Gemini) also fair. |
| tk-tr-01 | Explain subclass 500 condition 8105 (work limits) to a student's father in simple Nepali (Devanagari), including what counts as a fortnig… | translate | lookup | general | 'Explain … in Nepali' is generation in another language, not translating a source text: draft may be the better label. |
| tk-tr-06 | Explain F-1 status rules in Thai for a Bangkok student's parents: full course load, on-campus work limit, travelling home and re-entering… | translate | lookup | general | 'Explain in Thai' — same as tk-tr-01; translate vs draft needs a rule. |
| tk-tr-10 | Explain in Hindi to parents in Amritsar what the Provincial Attestation Letter is, why Canada introduced caps, from when it applies, and … | translate | draft | general | 'Explain in Hindi' — same; Jev says draft. |
| tk-tr-11 | Explain the Australian Genuine Student requirement to a father in Comilla in simple Bangla: what the questions are, what the officer look… | translate | lookup | draft | 'Explain in simple Bangla' — same; Gemini says draft. |
| tk-tr-14 | Explain in Tagalog for parents in Pampanga: when their son can enter the US on his F-1, what documents to keep in his hand luggage, check… | translate | draft | process | 'Explain in Tagalog' — same; Jev says draft. |

## destinations

| id | text | label | jev | gemini | note |
|---|---|---|---|---|---|
| visa-ca-doc-2 | Writing the study plan / SOP for a Bangladeshi applicant going for a PG certificate in supply chain after a BBA and 2 years' work. What s… | canada | none | none | No country named; 'study plan' + 'PG certificate' imply Canada. Kept canada; both classifiers route none. |
| sw-uk-in-52 | Indian Class 12 student, International Year One with INTO: what type of provider is it vs the uni, same campus, exit award if he doesn't … | united_kingdom | none | united_kingdom,united_states | No country named; 'International Year One with INTO' implies the UK. Kept united_kingdom. |

## Alternates added to accept[] (both classifiers agreed, reading judged reasonable)

| label → accepted | rows |
|---|---|
| lifestyle_adaptation → onshore_support | 69 |
| application_process → document_preparation | 14 |
| career_roi → migration_pathway | 12 |
| test_preparation → eligibility_check | 11 |
| document_preparation → visa_risk_analysis | 6 |
| family_planning → visa_process | 6 |
| alternative_pathways → eligibility_check | 6 |
| financial_viability → document_preparation | 5 |
| financial_viability → offer_enrolment | 5 |
| visa_process → onshore_support | 5 |
| strategic_planning → application_process | 4 |
| document_preparation → visa_process | 4 |
| financial_viability → onshore_support | 4 |
| work_survival → onshore_support | 3 |
| visa_process → family_planning | 3 |
| family_planning → financial_viability | 3 |
| program_selection → eligibility_check | 3 |
| university_selection → comparative_decision | 3 |
| program_selection → work_survival | 3 |
| migration_pathway → eligibility_check | 3 |
| (57 other pairs, 1–2 rows each) | 78 |

The 69 `lifestyle_adaptation → onshore_support` rows are pre-departure / first-week / already-arrived questions (accommodation on arrival, bank, SIM, TFN, biosecurity, GP); the classifier prompt assigns exactly those to onshore_support, so a future relabel of the coverage set may want onshore_support as the primary.

Task alternates accepted: visa-cmp-comp-1: compare → lookup; tk-calc-07: calculate → eligibility; tk-calc-17: calculate → lookup; tk-calc-19: calculate → lookup; tk-calc-20: calculate → lookup; tk-tr-04: translate → draft; tk-stg-06: lookup → compare; tk-stg-12: lookup → process; tk-stg-25: process → lookup.

## Label fixes applied (not for review)

- Destinations widened: `adm-my-alt-1` → malaysia + united_kingdom (2+1 twinning); `s2x-s11-transit-au` → new_zealand + malaysia (Malaysian transit visa); `s2x-s11-transit-uk` → united_kingdom + uae (Dubai transit).
- Destinations set to none (`mode: none`), the text names no destination country: sw-uk-vn-12, sw-au-in-29, sw-au-th-45, sw-au-np-53, sw-ca-bd-23, sw-au-vn-54, sw-au-np-56, sw-ca-ph-24, sw-au-np-60, sw-au-vn-63, sw-au-in-101, s1x-s9-13, sw-ca-bd-07, sw-uk-ph-26, sw-au-th-97.
- Origin removed: `sw-au-np-16` (nothing in the text implies Nepal). Origin added: `visa-ca-risk-1` → india (Hinglish).

## Kept labels the routes miss (routing findings, not label errors)

- **Thailand as destination**: Jev returns `thailand` as a destination for Thai-origin rows (~140 rows); `originOnlyDestinations` does not strip it when the text says "Thai student" without an origin cue, so the route adds Thailand. Both classifiers also add Thailand when the text mentions a Thai place as the student's home (Phuket, Chiang Mai, Bangkok, baht).
- **Prior-refusal / sponsor countries** (visa-au-risk-1, visa-ca-risk-3, visa-nz-risk-2, sw-uk-in-47, tk-rev-19, visa-nz-doc-1, tk-draft-12, s1x-s8-p08-ph, money-ca-fin-2): the label keeps only the destination being applied to; both routes add the other country.
- **Analogies** (s1x-s1-08 "Australia jasto PR", s1x-s8-19 "like Canada's GIC", s1x-s10-11 NZ "genuine student" → australia keyword): both routes add the compared country.
- **Missed destinations**: tk-draft-37 (GS → australia), s1x-s4-15 (lowercase "uk uni"), s1x-s6-08 (ELICOS → australia), s2x-s15-psw-nz ("from NZ"), s2x-s19-chg-ca (IRCC → canada).
- **Origin misses (12 rows)**: Romanized Nepali with fewer than two cue words (sw-uk-np-29, sw-au-np-60, s1x-s4-19, s1x-s6-25, s1x-s8-30, s1x-s9-13, s2x-s12-wage-uk, s2x-s12-remit-au), Hinglish (visa-ca-risk-1), Romanized Bangla (s2x-s18-age-uk), "Translate into Hindi … Jaipur" (tk-tr-02), and `tk-rev-13` where "my Bangkok student" is ignored (place needs an origin cue) and "expand our company to Vietnam" is read as the origin.
