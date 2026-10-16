# Counsellor job map: ground truth for auditing Edge

Researched 9 October 2026. This is the reference used to audit Edge, the internal AI assistant used by Expert Education & Visa Services counsellors. It maps what a study-abroad counsellor does, what they get asked, and what they may and may not do. The agency runs offices in NP, IN, BD, VN, PH, TH and LK, plus onshore offices in AU and the UK. Students go to AU, the UK, CA, the US and NZ, plus Europe and Asia.

How to read it:

- Every factual claim links to its source. Reference links (`[KEY]`) resolve in the [Sources](#sources) list at the end.
- Primary sources are government, regulator, or official training-body pages. Secondary sources (law firms, trade press, provider policies, job ads) are marked *(secondary)* in the Sources list.
- Money amounts and thresholds change often. Each one carries its "as of" date from the source. **The checklist in section 5 treats every amount as something to look up live, never to recall from memory.**
- Expert itself is a large multi-country agency. A NEAS announcement lists offices across Australia, Nepal, India, Sri Lanka, Bangladesh, Mongolia, Hong Kong, China, the Philippines, Myanmar, Vietnam, Nigeria and South Africa, and calls Expert a NEAS Endorsed Education Agent [NEAS-EEVS]. A March 2026 Nepali report says it expanded to New Zealand as its 25th country [EKANTIPUR]. Its staff mix includes registered migration agents, education counsellors, career counsellors and health-insurance officers [JIANGREN] *(secondary)*. That mix matters for the migration-advice boundary in §1.0.

---

## 1. The counsellor's job end-to-end

### 1.0 Compliance rules that apply at every stage

These rules frame every stage below. An assistant must enforce them, not just know them.

| Rule | What it means for the counsellor | Source |
|---|---|---|
| Act in the student's best interest; be honest; give current, accurate, realistic information "tailored to the individual student's circumstances, particularly in relation to language skills, capacity to pay and level of study" | Recommendations must be justified by the student's profile, not by commission | Agent Code of Ethics (ACE) Principles 1–2 [ACE]; National Code Standard 4 [STD4] |
| No guarantees of admission, scholarships, visas, jobs or PR | Never promise outcomes. National Code Standard 1 bars suggesting a migration or education-assessment outcome can be secured. Standard 4 requires providers to ensure their agents don't engage in false or misleading conduct. UK partner universities say this explicitly | [STD1], [STD4], [KAPLAN] *(provider policy)*, [STAFFS], [ACE] |
| Don't claim a government endorsement or privileged relationship you don't have, and don't misuse national brand logos | Marketing and social posts must be checked | [ACE] Principle 2 |
| Disclose conflicts of interest and incentives. Be open about the fees students pay and the commissions providers pay. Charging both the student and the provider for the same service is a conflict | Fee disclosure up front; commission transparency | [ACE] Principle 1 & Standards; [STD4]; UK guidance [BC-GUIDE] |
| Written agreements with both the student and the provider, including itemised fees and refund and transfer policies, archived so they can be produced on request | Every client needs a signed service agreement | [ACE] Principle 3 |
| Protect minors: a guardian is present, informed consent is recorded before money changes hands, and legal capacity is checked | Under-18 school and foundation students need a guardian workflow | [ACE] Principle 4 |
| Confidentiality: don't share personal information with third parties without consent | Sharing data with institutions, banks or lenders needs consent | [ACE] Ethics and Standards |
| Never be party to fraudulent visa applications or documents | Spot and refuse forged documents and fake funds | [ACE] Principle 1; IATC Module 12 covers "common document fraud methods" [IATC] |
| Counsel on suitability: assess "the student's willingness and ability to complete the courses, their understanding of course and provider requirements and awareness of realistic employment and pathway outcomes" | Suitability and genuineness screening is a duty, not an option | [ACE] Agency Recruitment Practices standard |
| Clear complaints and appeals process; documented refund policy | Complaint handling is part of the job (§2) | [ACE] |
| **Migration advice limits: Australia.** Only registered migration agents (RMAs), lawyers or exempt people may give "immigration assistance" in Australia. An education agent based in Australia "cannot give you information on visa and immigration matters unless they are also a Registered Migration Agent" | Onshore AU counsellors must refer visa and PR strategy to an RMA. Offshore counsellors are a grey zone: an industry body has proposed a "student-visa-only" certification [ISEAA], which implies offshore student-visa advice by unregistered agents is a live regulatory concern | [OMB-MIG], [OMB-FACT], [ISEAA] |
| **Migration advice limits: UK.** Giving immigration advice or services without OISC authorisation (or an exemption) is a criminal offence. This covers UK-based advisers advising clients overseas. Signposting to official information is not regulated; advice tailored to an individual is | UK onshore staff must not give tailored immigration advice unless OISC-registered. Offshore agents are not clearly covered by the sources found | [OISC-UKCISA], [NORTHUMBRIA] |
| **Migration advice limits: Canada.** IRPA s.91 bars anyone except lawyers, Quebec notaries, paralegals or CICC-licensed consultants (RCICs) from advising or representing "for consideration" on an IRPA application. A 2012 CIC briefing said this applies to agents outside Canada too. Representatives must be declared on the application even if unpaid | Paid study-permit advice by non-RCIC staff is a legal risk. Many DLIs require RCIC or Canada-course credentials from agents | [IRPA91], [ICEF-C35], [IRCC-REP], [KPU] |
| **Migration advice limits: NZ.** Offshore advisers are exempt from licensing only for **student visa** advice (s.11(h) as narrowed in 2011). They may not advise on work, visitor or guardian visas, or on pathways to work or residence. The exemption ends once the adviser is in NZ | NZ partner and guardian visas, and post-study work questions, must be referred to a licensed adviser | [NZ-INZ-ADV], [NZ-2011], [NZ-IAA] |
| **US.** Title IV's ban on incentive compensation does not cover recruiting international students who are ineligible for federal aid. NACAC permits commissioned agents but does not endorse them, and requires agents to disclose which institutions pay them | Disclose institutional payment to US-bound students | [TITLEIV], [PIE-NACAC], [NACAC] |
| **Australia, 2026: onshore-transfer commission ban.** From 1 April 2026, providers may not pay commission for a student who has already started onshore with another provider (including cancelled, withdrawn and in-between packaged courses). Moving to further study is not a "transfer." The definitions of "education agent" and "commission" are broadened, including non-monetary benefits | Onshore counsellors must not steer transfers for incentives. Any transfer advice must be best-interest and documented | [TEQSA-COMM], [BAN-FACT], [ASQA-ACT], [JOINT-ALERT] |
| **Australia, 2026: agent transparency.** Providers can see, across all providers, each agent's student counts, visa grants and refusals, completions, and (reportedly) onshore transfers and commissions | An agent's visa-refusal record follows it to every provider, so application quality is commercially critical | [ICEF-DATA], [COMM-DATA] |
| **UK sponsor compliance.** Sponsors now need a visa refusal rate below 5% (previously 10%) and an enrolment rate of at least 95%. Failing these cuts CAS allocations. Sources differ on the start date: Sept 2025 per PIE, 1 June 2026 per Doyle Clayton, with a public RAG rating from June 2026 | UK universities push agents hard on pre-screening. A weak file costs the partnership, and some universities have paused whole markets (§4.3) | [BCA] *(secondary)*, [PIE](https://thepienews.com/uk-stricter-bca-rules-to-take-effect-in-september/) |

### 1.1 Stage map

Each stage lists the tasks, the questions counsellors must answer, the documents they handle, the decisions they make, the systems they use, and the compliance points. "Asked by" uses S = student, P = parent, Sp = sponsor, I = institution.

#### Stage 1: Lead capture and first contact

- **Tasks:** respond to inbound enquiries (walk-in, phone, web, social, fair, referral); qualify the lead (destination, level, intake, budget, test scores, gaps); book the first counselling session; log the source and consent in the CRM. ICEF's IATC treats marketing and recruitment strategy, and market research, as core counsellor competencies (Module 2) [IATC]. Agency CRMs exist to "track student journeys, manage university partnerships, and ensure every commission lands" [CRM-MONDAY] *(vendor)*.
- **Questions:** "Can I go to X with my marks/gap/budget?" (S, P); "Which country is cheapest/safest/best for PR?" (P). The PR question touches migration advice; see §1.0.
- **Documents:** none yet, or an informal marksheet or IELTS screenshot.
- **Decisions:** whether the lead is qualified; which counsellor or branch it goes to; the urgency given the intake.
- **Systems:** CRM, WhatsApp/Viber/Zalo/LINE (varies by market; see §4), event lead-capture apps.
- **Compliance:** privacy consent; no misleading advertising, and include a registration number or identifier on advertising [ACE] Principle 2.

#### Stage 2: Counselling and profile assessment

- **Tasks:** profile the student (academics, English, finances, work history, gaps, prior refusals, travel history, family ties); explain destinations, education systems and qualification levels; assess suitability and genuineness; agree a written service agreement and fee disclosure. IATC Module 5 covers "student profiles … enrolment applications, and support before, during, and after study" [IATC]. The ACE requires assessing "willingness and ability to complete the courses" and "realistic employment and pathway outcomes" [ACE].
- **Questions:**
  - Total cost of study and living (S, P, Sp).
  - Scholarships.
  - Part-time work rights: AU 48 hours per fortnight in session, condition 8105 [WORK8105]; NZ 25 hours per week for visas issued from 3 November 2025 [NZ-VISA].
  - Post-study work: AU 485 for 2 years (bachelor's and coursework master's), under-35 age cap, IELTS 6.5 [485] *(secondary)*; UK Graduate route cut to 18 months for applications from 1 January 2027 [GRAD]; CA PGWP field-of-study list frozen for 2026 [PGWP].
  - Dependants: UK taught master's students cannot bring dependants since 1 January 2024 [PIE-DEP], [UK-DEP].
  - "Will my gap/refusal hurt me?" (S); "Is this a safe city?" (P).
- **Documents:** transcripts, marksheets, English test report, passport, CV and work experience letters, prior visa refusal letters.
- **Decisions:** which destination and level fit; whether the student needs a pathway (ELICOS, foundation, diploma); whether to decline a high-risk case.
- **Systems:** CRM profile, course-search tools and partner lists, cost calculators, ICEF/QEAC knowledge.
- **Compliance:**
  - Protect minors.
  - Tailor information to the student's finances and English [ACE].
  - Disclose fees and commissions.
  - Don't advise on PR or migration strategy unless licensed (§1.0).

#### Stage 3: Course and institution shortlisting

- **Tasks:**
  - Shortlist 3 to 6 options from **partner** institutions that fit the student's academics, English, budget, intake and goals.
  - Check entry requirements, CRICOS or course codes, intake dates and fees.
  - Check PGWP eligibility (CA field-of-study CIP list [PGWP]) and ATAS (UK sensitive postgraduate subjects; applies to non-exempt nationals including all 7 Expert source markets [ATAS]).
  - Check provider risk: AU MD115 processing priority depends on how far the provider has used its allocation [MD115]; UK sponsor BCA status [BCA].
  - Check whether a PAL or TAL is required (CA; master's and doctoral students at public DLIs are exempt from 2026 [CA-2026] *(secondary)*).
- **Questions:**
  - "Which uni gives the best chance of a visa?" (S, P)
  - "Is the course PGWP-eligible?" (S)
  - "Is the intake still open, and what is the deadline?" (S)
  - "Is there a scholarship or fee waiver?" (S, P)
  - "What is the ranking / is it accredited?" (P)
  - From institutions: "Does this student meet our GS/credibility bar?" (I)
- **Documents:** course brochures, partner fee schedules, CRICOS records.
- **Decisions:** the final shortlist; the order of applications; a pathway versus direct entry.
- **Systems:** partner lists in the CRM; CRICOS register (AEATC module B5 trains this [AEATC]); institution sites; aggregator portals; MD115 priority lists.
- **Compliance:** recommend on fit, not commission [ACE]; don't offer "favourable entry requirements" or routes that differ from direct applicants [BC-GUIDE].

#### Stage 4: Application

- **Tasks:** collect, verify, certify and translate documents; write or review the statement of purpose or personal statement; fill in and submit applications on institution and agent portals; track status; respond to conditions or document requests; prepare students for pre-CAS or credibility interviews.
  - UK universities increasingly run mandatory **pre-CAS credibility interviews**, and list "relying on an agent and being unable to explain your own decisions" and "scripted responses" as common failures [PRECAS-UWE], [CHESTER].
  - IATC Module 12 covers "managing student information, accepted qualifications, common document fraud methods" [IATC]. AEATC C7 "Student Documents" covers the same ground [AEATC].
- **Questions:**
  - "What documents do I need, and in what format (notarised, translated)?" (S)
  - "Why is my application still pending?" (S, P)
  - "Can you write my SOP?" (S). Ethical line: help, don't fabricate.
  - From institutions: missing documents, gap explanations, verification of results (I)
- **Documents:** academic transcripts and certificates, passport, English test report, SOP, LORs, CV, work references, gap evidence, previous refusal letters, application forms.
- **Decisions:** whether a document looks genuine; whether to submit or hold a weak file; how to explain a gap.
- **Systems:** institution and agent portals; aggregators (StudyLink-style single portals exist because "agents have to work with many different systems" [STUDYLINK]); CRM; document storage.
- **Compliance:** refuse fraudulent documents [ACE]; keep records [ACE] Principle 3; candidate consent for data sharing.

#### Stage 5: Offer

- **Tasks:** read the offer (conditional or unconditional, conditions, deadlines, fees, scholarship); explain it to the student and family; chase conditions (English, final results); compare multiple offers; handle deferrals.
- **Questions:**
  - "What does this condition mean?" (S)
  - "Which offer should I accept?" (S, P)
  - "Can I defer to the next intake?" (S)
  - "Is the scholarship automatic?" (S)
  - Refund policy if the visa is refused (P, Sp)
- **Documents:** offer letter and letter of offer, written agreement (AU providers' offer and acceptance agreement), refund policy.
- **Decisions:** which offer to recommend, from the evidence.
- **Systems:** portals, CRM stage update.
- **Compliance:** explain the refund and transfer policies as part of the written agreement [ACE] Principle 3.

#### Stage 6: Acceptance and deposit

- **Tasks:** guide offer acceptance; compute and explain the deposit and first-semester fees; arrange tuition payment through legitimate channels; arrange OSHC (AU; compulsory for the whole stay with no gaps [AU-COST] *(secondary)*).
- **Questions:**
  - "How much do I pay now, and how?" (S, P, Sp)
  - "Is the deposit refundable if my visa is refused?" (P)
  - "Can I pay in instalments / by education loan?" (Sp)
- **Documents:** acceptance form, payment receipt, OSHC policy, loan sanction letter.
- **Decisions:** the payment route; the OSHC provider and family cover.
- **Systems:** institution payment portals, forex and remittance partners, CRM.
- **Compliance:**
  - UK guidance says agents "should not hold money or make payments on your behalf" [BC-GUIDE].
  - Refund delays after visa refusal are the most common complaint to Australia's Overseas Students Ombudsman: 61% of 1,341 complaints in 2024–25 concerned written agreements, fees or refunds [OMB-2025].
  - Agents have also been found withholding provider refunds [OSO-2017] *(see Sources)*.

#### Stage 7: CoE / CAS / I-20 / LOA+PAL

- **Tasks:**
  - **AU:** obtain the eCoE (needed to lodge; the provider enters it in PRISMS, covered in AEATC module B6 [AEATC]).
  - **UK:** obtain the CAS after the pre-CAS interview and finance checks.
  - **US:** obtain the I-20 (SEVIS ID needed for the SEVIS fee) [US-F1] *(secondary)*.
  - **CA:** obtain the LOA, which since December 2023 every DLI verifies with IRCC [LOA], plus the PAL or TAL where required [PAL-BC].
- **Questions:**
  - "When will my CAS come?" (S)
  - "My CAS has an error, so what now?" (S)
  - "Do I need a PAL?" (S)
- **Documents:** CoE, CAS statement, I-20, LOA, PAL, ATAS certificate.
- **Decisions:** checking the document for errors (name, dates, fees paid, course code).
- **Compliance:** accuracy; no forged LOAs. IRCC found over 17,000 LOAs that didn't match a DLI issue [CA-2026] *(secondary, citing IRCC)*.

#### Stage 8: Visa

- **Tasks:**
  - Prepare the visa file: financial evidence, GS/SOP, health, police and biometrics.
  - Lodge or support lodging, within the legal advice limits (§1.0).
  - Prepare students for interviews.
  - Track processing and respond to requests.
  - Handle refusals: explain them; refer to an RMA, RCIC or adviser for review or reapplication strategy.
- **Key facts the counsellor must know** (look up, don't recall; dated):

| Destination | What to check | Source |
|---|---|---|
| AU | Subclass 500 living costs AUD 29,710 for 12 months (plus first-year tuition and travel); visa charge reported at AUD 2,500 from 1 July 2026 | [AU-FIN], [AU-COST] *(secondary)* |
| AU | The Genuine Student (GS) requirement replaced GTE in March 2024, and GS answers go into ImmiAccount | [AU-COST] *(secondary)* |
| AU | Under MD115 (from 14 November 2025), offshore processing priority depends on the provider's allocation use | [MD115] |
| UK | Maintenance £1,529/month London and £1,171 elsewhere (up to 9 months), held 28 days; rising to £1,570 and £1,203 for applications from 30 November 2026 | [UK-FUNDS] *(secondary)* |
| UK | TB test required for all 7 Expert source markets | [UK-TB] |
| UK | ATAS for sensitive subjects | [ATAS] |
| UK | UKVI credibility interview; not attending means automatic refusal | [CHESTER] |
| CA | 2026 cap and PAL/TAL; proof of funds about CAD 22,895 plus tuition and travel, reportedly CAD 23,448 from 1 Sep 2026 (§4.8). The figure changed mid-year, so this is a live-lookup item | [CA-2026] *(secondary)* |
| CA | SDS closed 8 November 2024, so all applicants use regular processing | [SDS] |
| CA | Indian refusal rate 74% in August 2025 | [CA-REFUSE] *(secondary, Reuters/IRCC data)* |
| US | SEVIS I-901 USD 350; MRV fee USD 185; in-person interviews and social-media disclosure; a USD 250 visa integrity fee being charged by some posts from May 2026 | [US-F1] *(secondary)*, [VIF] |
| NZ | About NZD 20,000 per year living funds; Nepal added to the Funds Transfer Scheme in April 2026 | [NZ-VISA] *(secondary)*, [NZ-FTS] |

- **Questions:**
  - "How much money must be shown, for how long, and in whose name?" (S, Sp)
  - "Is an education loan / property valuation / FD acceptable?" (Sp)
  - "What will the officer ask?" (S)
  - "How long does processing take?" (S, P)
  - "Why was I refused, and can I reapply?" (S, P). Refusal strategy should go to a licensed adviser where required.
  - "Can my spouse come?" (S). This is migration advice territory; see §1.0.
- **Documents:** bank statements, loan sanction letters, sponsor income and tax documents, property valuation, affidavit of support, relationship proof, GS statement, OSHC, police clearance, medicals (HAP ID for AU, TB certificate for UK), biometrics appointment, visa grant or refusal letter.
- **Decisions:** whether the funds are genuine and sufficient; when to lodge; whether to refer to an RMA, RCIC or lawyer.
- **Systems:** ImmiAccount (AU), UKVI online and VFS/TLS, IRCC portal, CEAC DS-160 and USTravelDocs, INZ online; CRM.
- **Compliance:** no fraudulent visa applications [ACE]; advice limits by destination (§1.0); the agent's visa-refusal rate is now visible to AU providers [ICEF-DATA] and drives UK BCA [BCA].

#### Stage 9: Pre-departure

- **Tasks:**
  - Run pre-departure briefings: passport valid for at least 6 months, carry the visa and eCoE on the flight, book flights only after the visa grant, biosecurity declaration [SA-PREDEP].
  - Help with accommodation (hostel, homestay, share house, student accommodation) and the airport pickup request.
  - Explain arrival and orientation dates (arrive at least a week early, per one provider guide [GORDON] *(secondary)*).
  - Explain forex, banking, SIM, packing, and cultural adjustment. IATC Module 6 covers "preparation, lifestyle decisions, and cultural differences" [IATC].
  - **UK:** make sure the student has set up a UKVI account, linked their passport to the eVisa and can generate a share code. BRPs expired on 31 December 2024. From 15 July 2025, students on courses over 6 months get no vignette. Students without eVisa access "may be denied boarding" [UK-EVISA].
- **Questions:**
  - "When should I fly?" (S)
  - "What can't I bring?" (S)
  - "Where will I live and how much is rent?" (S, P)
  - "Who picks me up?" (P)
  - "How much cash can I carry?" (S)
- **Documents:** ticket, accommodation confirmation, OSHC card, CoE/CAS/I-20, offer, transcripts (originals for enrolment).
- **Systems:** CRM tasks, accommodation partners, event tools for briefing sessions.

#### Stage 10: Arrival

- **Tasks:** confirm safe arrival; make sure the student attends orientation and enrolment; for under-18s, confirm welfare and guardian arrangements. Providers must offer age- and culturally-appropriate orientation, a named contact, welfare support and a critical-incident policy (National Code Standard 6) [STD6]. The agent's job is to connect the student to these, not replace them.
- **Questions:** "I've missed my flight / orientation." (S); "My accommodation fell through." (S); "My child hasn't called." (P)
- **Compliance:** escalate critical incidents to the provider.

#### Stage 11: Onshore support (AU/UK onshore offices especially)

- **Tasks:**
  - Course or provider changes. AU Standard 7: generally no transfer before 6 months of the principal course without a release letter or another exception [STD7] *(provider policy quoting the Code)*. The 2026 commission ban applies [TEQSA-COMM].
  - Extensions and new CoEs.
  - Visa-condition reminders: AU 8105 for work hours [WORK8105] and 8202 for enrolment and attendance [MONASH-8202].
  - AU onshore eligibility:
    - Since 1 July 2024, visitor and Temporary Graduate (485) holders, among others, cannot apply for a student visa onshore [AU-HOP].
    - Since 1 January 2025, onshore student visa applications need a CoE (a letter of offer is not enough), or they are invalid [AU-COE-ONSHORE] *(secondary)*.
    - These are the common "can I switch to a student visa here?" questions. The answers are general information; individual advice needs an RMA.
  - Fee deadlines; academic progress and attendance warnings.
  - Complaints against providers: first through the provider's internal process, then the Overseas Students Ombudsman (AU) or the NZ Code [NZ-CODE].
  - Wellbeing referrals.
- **Questions:**
  - "Can I change my course/college?" (S)
  - "How many hours can I work?" (S)
  - "My visa expires soon; what do I do?" (S). Onshore AU visa advice requires an RMA [OMB-FACT].
  - "I got an intention-to-cancel letter." (S)
- **Documents:** release letter, new offer and CoE, attendance and progress letters, OSHC renewal.
- **Decisions:** whether a transfer is in the student's interest (and no commission motive); whether to refer to an RMA, lawyer or counselling service.
- **Compliance:** no migration advice onshore without RMA or OISC status; transfer ethics; complaint routing.

#### Stage 12: Post-study

- **Tasks:**
  - Explain the post-study work rules at a general-information level and refer to licensed advisers: AU 485 (age under 35; 2 years for bachelor's and coursework master's; IELTS 6.5; lodge within 6 months of completion [485] *(secondary)*); UK Graduate route [GRAD]; CA PGWP [PGWP].
  - Further-study upsell (master's after bachelor's; that isn't a "transfer" under the AU ban [BAN-FACT]).
  - Alumni referrals and testimonials.
  - IATC Module 5 explicitly covers "involvement after completion" [IATC].
- **Questions:**
  - "Am I eligible for 485 / PGWP / Graduate route?" (S). Licensed-adviser referral where required.
  - "What jobs can I get?" (S)
  - "Can I do a master's next?" (S)

---

## 2. Non-student work

The sources for job-description evidence are in §2.9 (agency postings). The regulatory and practice sources are below.

### 2.1 Lead management and follow-up

- Qualify, assign and follow up leads; nurture leads across long cycles (often 6 to 18 months from first contact to intake); re-engage dormant and lost leads before deadlines.
- CRM-centred practice: vendor material cites the main operational risks as commission errors, missed application deadlines and lost documents [CRM-MONDAY] *(vendor)*.

### 2.2 CRM hygiene

- Keep the stage, the next action, consent and the document checklist current; log every interaction. ACE Principle 3 requires agreements to be archived so they "can be made available to the student or an appropriate authority within a reasonable timeframe" [ACE].

### 2.3 Partner institution relations

- Know each partner's agreement terms, territories, entry rules and incentives.
- Attend institution trainings and webinars (Study Australia Agent Hub, Global Agent Week [AGENT-HUB]).
- Respond to institution compliance requests.
- Providers must hold a written agreement with every agent, record the agent in PRISMS, monitor it, and take corrective action or terminate it for non-compliance [STD4]. UK universities require at least one certified counsellor per branch (Coventry) [COVENTRY].
- Australian providers now see agent-level visa, completion and transfer data across all providers [ICEF-DATA].

### 2.4 Commission and claims

- Reconcile enrolments against commission invoices; chase unpaid claims; handle clawbacks on withdrawals and refunds.
- Australia: providers report direct, indirect and non-monetary commissions per agent to the Department through PRISMS. The first period is 1 January to 30 June 2026 [COMM-DATA], [ASQA-ACT]. The onshore-transfer commission ban applies from 1 April 2026, with grandfathering for students accepted by 31 March 2026 [BAN-FACT], [TEQSA-COMM].
- The Ombudsman has seen providers try to deduct agent commission from student refunds [OMB-2025].
- AEATC module B11 is dedicated to "Agency Agreements and Commission" [AEATC].

### 2.5 Events and fairs

- Run education expos, institution visits, spot-assessment days, and school and college seminars. IATC Module 2 covers recruitment strategy and building marketing materials from data [IATC]; AEATC C5 and C6 cover promoting Australian education and marketing information [AEATC].
- Compliance: use only institutions' officially approved material, and show the registration number on adverts [ACE].

### 2.6 Team targets and reporting

- Targets are typically leads → counselled → applied → offers → deposits/CoE → visas granted, along with the visa grant rate and revenue. Job-description evidence is in §2.9.
- External pressure: UK BCA thresholds (refusal below 5%) [BCA] and AU agent-level data [ICEF-DATA] turn visa success rate into a partner-facing KPI.

### 2.7 Complaint handling

- Agencies must have a "clear and fair complaints and appeals process" [ACE].
- NZ: students take agent complaints to the provider's process first [NZ-CODE].
- AU: concerns about agents are about 3% of Overseas Students Ombudsman complaints, but providers are held responsible for their agents [OSO-2013], [OMB-2025].
- AEATC B10 covers "Privacy, Student Complaints and Appeals" [AEATC].

### 2.8 Staff training and certification

- **AU:** QEAC through the AEATC [AEATC]. Agent training completion is an ACE "Staff Capability" standard [ACE]. The AAERI/Study Australia refresher course is on OpenLearning [AAERI] *(secondary)*.
- **UK:** British Council UK Agent and Counsellor certification, valid 2 years, with a public register [ICEF-AQF], [UKCISA-AQF]. A new AQF course for agency leaders [BUILA-NEW].
- **Canada:** the Canada Course for Education Agents (Languages Canada, CAPS-I, ICEF) [CA-COURSE].
- **US:** AIRC agency certification: 40 standards in 5 areas, 5-year then 10-year terms [AIRC], [AIRC-CERT]; ICEF USA course [IATC-SEARCH].
- **NZ:** ENZ's Recognised Agency Programme was **discontinued in August 2023** [ENZRA]. There is no current NZ agent-recognition scheme in the sources found.
- **General:** ICEF IATC leading to ITAC [IATC].

### 2.9 Evidence from real job postings

Seventeen postings and service pages across all 9 markets were reviewed in October 2026. Some were read in full; others only through search-index excerpts because the posting had closed or the page blocked fetching, so the duties for those may be incomplete. Many IDP and AECC pages are now closed.

| # | Posting | Market | Key duties / KPIs / systems | URL |
|---|---|---|---|---|
| 1 | IDP, Education Counsellor | VN | Advise on study options; application documents; facilitate enrolment; counsel on and help with entry visas; follow up offers and rejections; liaise with institutions and the visa office; update the "IDP Global database"; team reporting | [link](https://careers.jobscore.com/careers/idpeducationpty/jobs/education-counsellor-dist-5-office-cT5KjpIZHe74BDHNbeVW99) |
| 2 | IDP, Visa & Welfare Counselor | VN | Prepare visa applications; **check bank disbursement documents**; help pay institution fees; follow up CoE, visa and health-check results; accommodation and airport pickup | [link](https://careers.jobscore.com/careers/idpeducationpty/jobs/visa-welfare-counselor-dist-3-office-cK5MxCYjDoiBnbxtLFN3Mr) |
| 3 | IDP, Counsellor (Dhaka) | BD | Lead management, referrals, events; KPIs: "pipeline goals, customer satisfaction, and advocacy targets through each stage of the student journey" | [link](https://jobs.idp.com/job/Dhaka-Gulshan-Counsellor/1329513166) |
| 4 | IDP, Education & Admission Counsellor | PH / AU-NZ | Build an application shortlist; admissions, visa and pre-departure; "support and referral for students with issues other than placement"; roadshows and school talks; "key liaison" for assigned university partners; office sales targets | [link](https://careers.jobscore.com/careers/idpeducationpty/jobs/education-and-admission-counsellor-ph-aOet8VgJDjOO8QkSq2mtsx) |
| 5 | IDP, Academic Counsellor | TH | Thai and English; knowledge of AU, NZ, UK, IE, US and CA systems | [link](https://careers.jobscore.com/careers/idpeducationpty/jobs/academic-counsellor-cTxHN7_95lXljiEkEsdRdZ) |
| 6 | AECC, Consultant AU & NZ | IN | Goal and academic assessment; test guidance; tuition, scholarship and living-cost budgeting; visa documentation; workshops and fairs; **train fellow counsellors**; CRM follow-ups; institution relationships; ethical and legal compliance | [link](https://joinsaarthi.com/jobs/aecc-global/consultantsr-consultant-australia-multiple-locations-india-jagraon/a19c1c39-b52a-48a4-ace5-ad7b3a48a351) |
| 7 | AECC Australia, Education Consultant (Indian subcontinent) | AU onshore | "Achieve individual student placement target"; "Increase referrals"; CRM lead and lifecycle pipeline; MIS reports | [link](https://www.ziprecruiter.com.au/jobs/543007853-education-consultant-indian-subcontinent-aecc-australia-at-aecc-group) |
| 8 | AECC AU, onshore services page | AU onshore | Course or provider change; student visa and extension; 485; PR, partner and parent visas through **in-house migration agents**; OSHC; accommodation; QEAC-certified counsellors | [link](https://www.aeccglobal.com/au/student-services) |
| 9 | **Expert Education & Visa Services**, Counsellor (Mt Gravatt QLD) | AU onshore | Advise on courses, institutions and destinations; profile reviews; admission and visa steps; document and form help; stay current on compliance and partnerships; events and lead follow-up | [link](https://au.jooble.org/jdp/-503527286509008903) |
| 10 | Leverage Edu, Counsellor | IN | Caseload of onboarding, counselling and follow-ups; intake cycles; GRE, GMAT, IELTS and TOEFL rules; clear application bottlenecks; post-offer work with the visa team; financing; "counseling and conversion targets" | [link](https://www.foundit.in/job/counsellor-overseas-education-leverage-edu-gurugram-48091657) |
| 11 | Leap Scholar, counsellor and team lead | IN | "Up to 100 calls a day" and 2–3 video sessions a day; team targets on leads, applications and visas; pipeline forecasting; IELTS cross-sell | [link](https://www.instahyre.com/job-335313-overseas-counsellor-at-leap-scholar-chandigarh/) |
| 12 | upGrad Abroad, Senior Admission Counsellor | IN | Counsel students and parents; applications, interview and visa support; 300 talk-minutes a day; 5 video sessions a day; weekly revenue targets | [link](https://www.foundit.in/job/senior-admission-counsellor-study-abroad-upgrad-study-abroad-noida-44255536) |
| 13 | KC Overseas, Career Consultant | IN | Profile assessment; fees and scholarships; shortlist; complete applications; resolve issues "till joining"; service levels and timelines | [link](https://kcoverseaseducation.recruitee.com/o/career-consultant-raipur) |
| 14 | Bond International, UK Senior Counselor | NP | Seminars; SOP and document review; IELTS/PTE, visa and pre-departure coordination; **track UK immigration changes**; mentor juniors; incentives tied to "successful student visa approvals"; **British Council certification mandatory** | [link](https://www.kumarijob.com/more-jobs/73039-uk-senior-counselor) |
| 15 | Branch Manager postings | IN, NP | Branch operations; counsellor conversion and revenue targets; keep "visa approval rates high"; hire and train staff; standardise counselling, admission and visa workflows; CRM conversion tracking | [link](https://jobs.weekday.works/wkdydv3o7y), [link](https://www.kumarijob.com/more-jobs/76420-branch-manager-immigration) |
| 16 | Onshore AU consultants (Studynash, Aussizz, PH-remote) | AU onshore | 500 extensions; 485; "education change processes"; CoE liaison; explain PR pathways **and refer to the RMA**; course-change counselling with GTE/GS in mind; after-sale retention; **QEAC desirable**; ESOS and National Code; support the Principal Migration Agent | [Studynash](https://careers.antler.co/companies/studynash/jobs/51774631-education-migration-consultant), [Aussizz](https://employmenthero.com/jobs/position/aussizz-migration-education-consultants-sydney-education-consultant), [PH-remote](https://www.onlinejobs.ph/jobseekers/job/1522598) |
| 17 | ApplyBoard, Enterprise Recruitment Rep | IN | B2B: train partner agents on programs and admission rules; 5–8 partner visits a day | [link](https://www.indexventures.com/startup-jobs/applyboard-inc/enterprise-recruitment-representative-18/) |

**Institution-side counterparts.** These show what agents get asked:

- UK university international advisers need **OISC Level 1** and advise on entry clearance, extensions, switching and work restrictions ([QUB](https://hr.apps.qub.ac.uk/jobs/job_desc/19_107177.pdf), [Greenwich](https://jobs.gre.ac.uk/Upload/vacancies/files/7669/SG6%20International%20Advice%20Officer%20Nov%202021.pdf)).
- Navitas admissions staff check applications for visa compliance and assess GS/GTE, with a 48-hour turnaround KPI ([Navitas/WSU](https://jobwebkenya.com/jobs/admission-compliance-officer-western-sydney-university-navitas/)).

**Named CRMs:** Zoho, Salesforce, LeadSquared and HubSpot ([CollegePass](https://www.foundit.in/job/senior-admissions-counsellor-inside-sales-study-abroad-amp-test-prep-collegepass-noida-60670553), [NZ role](https://in.jobsora.com/job-51452016392?source=1)).

**QEAC.** Study Melbourne defines a QEAC as someone who has passed PIER's EATC ([Study Melbourne](https://studymelbourne.vic.gov.au/study-with-us/enrolments-and-student-visas/get-help-from-an-education-agent)).

**What the postings add to the regulatory picture:**

1. Counsellors are measured on sales-funnel KPIs: calls, video sessions, conversions, placements, revenue (#7, #10–12, #15). They are increasingly also measured on visa approval rate (#14, #15).
2. Onshore AU teams pair education counsellors with in-house RMAs; the counsellor's job is to refer (#8, #16).
3. Training juniors and keeping up with immigration changes are explicit duties (#6, #14, #15).
4. SOP and document review is routine (#14; SI-UK pages describe reviewing personal statements, CVs and references, [gostudyin](https://gostudyin.com/nepal/study-in-uk/study-info/uk-university-application/)).
5. Practitioner guides describe the same stage sequence as §1. ICEF Academy runs from needs → destination → programme match or pathway → application → documents and attestation → pre-arrival and arrival ([ICEF Academy](https://icef.com/academy/knowledge-hub/preparing-students-for-studying-abroad)). An Indian consultancy guide adds dream/match/safety shortlisting and forex ([Shiksha](https://www.shiksha.com/studyabroad/study-abroad-consultants-in-bangalore-articlepage-143267)).

**Gaps:** no posting was found on Expert's own careers site. Nothing was found for Global Reach, Edwise or Crizac. No posting named ImmiAccount, PRISMS or IRCC as a required skill.

---

## 3. Skills and knowledge areas (training curricula)

### 3.1 Australia: AEATC, leading to QEAC (ICEF Academy, formerly PIER) [AEATC]

| Section | Modules |
|---|---|
| A. Australian Qualifications Framework | A1 Overview · A2 Australia · A3 Australian Education · A4 Australian Schools · A5 ELICOS · A6 Vocational Education & Training · A7 University Education in Australia · A8 Post Secondary School Courses and Careers |
| B. Regulations & Legislation | B1 Overview · B2 Intro to Regulations and Legislation · B3 The ESOS Act · B4 The National Code of Practice · B5 CRICOS · B6 PRISMS · B7 Student Visas: Basic Requirements and Processes · B8 Student Visas: Application Processes, Specific Requirements and Integrity Concerns · B9 Student Visas: Visa Conditions and Student Responsibilities · B10 Privacy, Student Complaints and Appeals · B11 Agency Agreements and Commission |
| C. Working Effectively | C1 Overview · C2 A Who's Who of Australian Education · C3 Student Client Management · C4 Pastoral Care Issues · C5 Promoting Australian Education · C6 Marketing Information · C7 Student Documents |
| D. Ethics | D1 Overview · D2 Introduction · D3 Case Studies · D4 Emerging Bad Practice |

The stated outcomes include the ESOS Act, National Code 2018, the Migration Act 1958, the CRICOS course code, "what a CoE is and what it looks like", and the visa evidence framework [AEATC].

### 3.2 ICEF Agent Training Course, leading to ITAC [IATC]

| Unit | Modules |
|---|---|
| A | 1 Working Effectively (counsellor role, workplace skills, software and tools) · 2 Marketing and Recruitment Strategies · 3 Ethics |
| B | 4 International Education Stakeholders · 5 Student Client Management (profiles, applications, support before, during and after study) · 6 Student Care Issues |
| C | 7 Destination Countries · 8 Education Systems · 9 Regulatory Systems · 10 Legal Requirements (incl. consumer protection in contracts) · 11 Student Visas · 12 Student Documents (incl. common document fraud methods) |

### 3.3 UK: British Council UK Agent and Counsellor training (core of the UK AQF)

- Topics published by British Council country sites: why choose the UK; UK education systems; preparing students for a UK education; student experience; accommodation and cost of living; values and ethics; visas and immigration; employability and post-study options; tuition fees, finances and the payment landscape [BC-SA], [BC-GH], [ICEF-AQF]. ICEF lists 8 modules, free, in any order [UK-ICEF-COURSE].
- The AQF's four principles: empowering student choice and informed decisions; governance and professionalism; ethical practice and competency; transparency and accountability [UKCISA-AQF].
- Certification requires confirming understanding of the National Code of Ethical Practice for UK Education Agents [UKCISA-AQF], [UUKI-CODE].

### 3.4 Canada: Canada Course for Education Agents [CA-COURSE]

- Covers why Canada, study options, application steps, costs and scholarships, and student preparation. Agents must research institution-specific rules directly.

### 3.5 US: AIRC standards [AIRC]

- Five areas: organisational effectiveness; integrity of the recruitment process; student and family engagement; institutional engagement; complaints process (as listed by a certified agency, [AIRC-UPGRAD] *(secondary)*).

### 3.6 Ethics canon (all destinations)

- The London Statement's seven principles and the Australian ACE standards (organisational effectiveness, business ethics, staff capability, recruitment practices) [ACE].

### 3.7 Consolidated knowledge domains an assistant must cover

These are derived from §3.1 to §3.6:

1. Destination education systems and qualification frameworks (AQF, RQF/SCQF, Canadian credentials, US degrees, NZQF): levels, entry and exit points, pathways.
2. Institution and course knowledge: partner catalogue, entry requirements, fees, intakes, scholarships, CRICOS/CIP/CAH codes.
3. Regulation: ESOS/National Code, the UK sponsor regime, IRCC DLI/PAL, SEVP, NZ Code.
4. Student visas: requirements, evidence, conditions, integrity concerns, and refusal handling per destination.
5. Student documents: verification, translation, certification, fraud patterns.
6. Finance: tuition, living costs, funds evidence, loans, remittance, refunds.
7. Student care: pre-departure, cultural adjustment, accommodation, welfare, critical incidents.
8. Ethics, privacy, complaints, agreements, commission.
9. Marketing and recruitment: market research, events, approved materials.
10. Workplace skills: CRM, tools, communication with stakeholders.

---

## 4. Market differences by source country

Inline URLs in this section come from targeted market research done in October 2026. Australia's Evidence Levels are not officially published; the figures come from industry notices. Refusal rates use different time windows and are not directly comparable.

### 4.1 Nepal

- **Exit and forex:**
  - A MoEST **No Objection Certificate (NOC)** is required before going abroad for higher education. It is applied for online, and banks won't release tuition forex without it ([nebgpacalculator](https://nebgpacalculator.com/noc-nepal/) *(secondary)*).
  - Repeated attempts to restrict NOCs for diploma and language courses have been reversed, and a 2025/26 proposal to split subjects into priority and non-priority is pending ([Onlinekhabar](https://english.onlinekhabar.com/no-abroad-study-approval-for-non-uni.html), [BUILA](https://www.buila.ac.uk/articles/nepal-proposes-scrapping-current-noc-process-in-sweeping-reform-push)). **Current status unverified.**
  - Nepal Rastra Bank's student forex limit is USD 12,000 under a 2023 circular ([ShareSansar](https://www.sharesansar.com/newsdetail/nepal-rastra-bank-increases-dollar-limits-for-students-and-workers-going-abroad-2023-12-31)).
- **Agency regulation (new, July 2026):** the Educational Consultancy, Language and Preparation Classes Regulations 2026 ([Kathmandu Post](https://kathmandupost.com/national/2026/07/09/nepal-introduces-tough-rules-to-rein-in-educational-consultancies-foreign-linked-colleges)):
  - federal registration and a Rs 2.5M deposit;
  - counsellors need at least a bachelor's degree;
  - written client agreements and bank-only payments;
  - A/B/C grading of agencies;
  - foreign-owned firms must become 100% Nepali-owned within a year;
  - full liability, including compensation, for a student stranded abroad because of the agency's advice;
  - no approval for study-abroad fairs.

  ECAN is seeking amendments ([PIE](https://thepienews.com/nepalese-education-consultancies-protest-sweeping-new-regulations/)). This directly affects Expert Nepal's events (§2.5) and agreements (§1.0).
- **Documents:**
  - Typical Australian financials are an education loan from a Nepali bank or a bank-balance certificate (funds held 3 months or more), plus income-source documents, a property valuation, a tax clearance certificate and a relationship certificate ([KIEC](https://kiec.edu.np/?p=561) *(agency)*).
  - Police clearance from the Nepal Police CID, applied for online ([lawalpine](https://lawalpine.com/blog/police-clearance-certificate-nepal) *(secondary)*).
  - Home Affairs has cited widespread faked financial documents involving Nepal ([MacroBusiness](https://www.macrobusiness.com.au/2022/09/australias-student-visa-system-ruthlessly-rorted/), press report).
- **Visa risk:**
  - **AU:** Evidence Level 3 since 8 Jan 2026, reaffirmed 30 Sep 2026 ([Leading Edge](https://www.leadingedgemigration.com.au/post/major-update-south-asian-country-evidence-levels-adjusted-for-student-visa-january-2026), [OneU](https://www.oneuedu.com/en-US/visa/policy-updates/student-visa-evidence-level-september-2026)). About 64% of offshore Nepali applicants were refused Jan–May 2026, and only 56 of 549 VET applicants were granted ([Kathmandu Post](https://kathmandupost.com/nepali-diaspora/2026/07/26/australia-tightens-student-visa-rules-rejects-64-percent-of-nepali-applications)).
  - **US:** 81% F-1 refusal in 2025 ([ICEF Monitor](https://monitor.icef.com/2026/06/what-is-happening-to-student-mobility-flows-between-the-global-south-and-global-north/)).
  - **UK:** growing; Nepal was the 5th-largest UK market in 2024/25 ([HEPI](https://www.hepi.ac.uk/2025/05/06/after-a-dip-in-2024-are-uk-international-student-visas-poised-to-return-to-their-previous-peak/)).
  - **CA:** about 37% approval in 2024 ([PIE](https://thepienews.com/has-canada-reached-a-turning-point-in-study-permit-approvals/)).
  - **NZ:** Nepal was added to the Funds Transfer Scheme in April 2026 [NZ-FTS].
- **Profile and timing:**
  - NOCs FY2020/21–2025/26: Japan 156k, Australia 128k, UK 76k, Canada 43k, Korea 34k ([Republica](https://myrepublica.nagariknetwork.com/news/rs-556-billion-flows-out-as-nearly-550000-nepalis-head-abroad-for-studies-20-43.html)). Japan and Korea language-school pathways are a large line of business.
  - NEB Grade 12 results came out on 19 Jun 2026 ([Himal Press](https://en.himalpress.com/neb-publishes-grade-12-results-69-75-pass-exams/)).
  - Australian health checks are done at eMedical panel clinics, of which Nepal has six ([AU Embassy Nepal](https://nepal.embassy.gov.au/kmdu/visa.html)).

### 4.2 India

- **Forex and tax:**
  - No exit NOC. Remittances go through the LRS (USD 250k per person per year, Form A2, PAN) ([Extravelmoney](https://www.extravelmoney.com/blog/rbi-remittance-rules-indians-study-abroad/) *(secondary)*).
  - Tax collected at source (TCS) on education payments: from 1 Apr 2026, self-funded payments above ₹10 lakh are taxed at 2%, and loan-funded payments pay nil ([Business Today](https://www.businesstoday.in/amp/personal-finance/tax/story/budget-2026-fm-sitharaman-proposes-major-tcs-changes-on-overseas-tour-packages-education-medical-purposes-513917-2026-02-01), [Flywire](https://pay.flywire.com/resources/tcs-on-foreign-education-payments-reduced-to-2-from-april-1-2026-what-indian-students-need-to-know)).
  - Section 80E deduction for education-loan interest ([TaxGuru](https://taxguru.in/income-tax/deduction-w-r-t-interest-education-loan-higher-education.html)). This is a tax question; refer to a chartered accountant.
- **Agency regulation:** Punjab licenses consultancies and IELTS centres through the district Deputy Commissioner; Ludhiana flagged 137 non-compliant agents ([Tribune](https://www.tribuneindia.com/news/ludhiana/137-immigration-agents-likely-to-face-action-for-violating-norms)). No Andhra Pradesh or Telangana consultant law was found.
- **Documents and finance:**
  - Education loans under the IBA model scheme: no collateral up to ₹4 lakh, a third-party guarantee from ₹4–7.5 lakh, and tangible collateral above that ([Dealplexus](https://www.dealplexus.com/blog/education-loan-india-guide) *(secondary)*).
  - Known fraud pattern: genuine loan sanction letters paired with fake disbursal letters, found by INZ in an organised Hyderabad agent case ([BUILA, 2016](https://www.buila.ac.uk/news/2016/immigration-nz-uncovers-significant-organised-agent-fraud-in-india)).
  - Police clearance through Passport Seva ([NRI Information](https://nriinformation.com/how-to-guides/police-clearance-certificate)).
- **Visa risk:**
  - Refusal rates: US 61% (2025), CA 80% (Q2 2025), AU 60% (Feb 2026), UK about 7.5% ([ICEF Monitor](https://monitor.icef.com/2026/06/what-is-happening-to-student-mobility-flows-between-the-global-south-and-global-north/)).
  - **AU:** Evidence Level 3 from Jan 2026 ([Gulf News](https://gulfnews.com/world/oceania/visa-delays-ahead-australia-flags-india-three-other-countries-as-high-risk-for-student-visas-1.500405215)).
  - **US:** social-media profiles must be public, and from 6 Sep 2025 applicants must interview in their country of nationality or residence ([Mintz](https://www.mintz.com/insights-center/viewpoints/2806/2025-09-08-state-department-adjudicating-nonimmigrant-visa)).
  - Some Australian universities paused recruitment from certain Indian states in 2023; the Australian High Commission denied any current ban in 2025 ([PIE](https://thepienews.com/are-australian-unis-curbing-applications-from-some-indian-states/)).
- **Profile and timing:**
  - Graduate STEM is dominant in the US: 363k Indian students in 2024/25, about 49% graduate, 43% in maths/computer science, and a large OPT cohort ([National Herald](https://www.nationalheraldindia.com/amp/story/international/india-becomes-top-sender-to-us-universities-despite-visa-challenges)).
  - PTE is gaining on IELTS ([analysis](https://world.hey.com/oaw/the-great-indian-english-rush-why-demand-for-proficiency-tests-is-soaring-d4326724) *(secondary)*).
  - CBSE Class 12 results came out on 13 May 2026 ([Careers360](https://school.careers360.com/articles/cbse-result-2026-class-12)).

### 4.3 Bangladesh

- **Forex:**
  - Tuition goes through a bank **"student file"** under Bangladesh Bank rules. Sources conflict on per-semester versus per-year release ([Prothom Alo](https://en.prothomalo.com/youth/education/yjd8x5vr1c), [Premier Bank](https://premierbankltd.com/pbl/student-file)).
  - A record USD 881.7M was remitted for education in FY2025-26 ([Observer BD](https://observerbd.com/news/584772)).
- **Documents:**
  - Board or university attestation, then MOFA attestation online through MyGov ([UNB](https://unb.com.bd/category/Bangladesh/how-bangladeshi-students-can-attest-certificates-online-before-going-overseas/149269)).
  - Bangladesh joined the Apostille Convention on 30 Mar 2025, but some recipients still ask for legalisation ([HCCH](https://www.hcch.net/en/news-archive/?tag=conv12)).
  - Police clearance online at pcc.police.gov.bd ([guide](https://immigrationstartguide.com/blog/police-clearance-certificate-bangladesh-uk-visa) *(secondary)*).
- **Visa risk (highest of the 7 for the UK):**
  - **UK:** about 22% refusal, and several universities have suspended or restricted Bangladeshi recruitment because of BCA thresholds ([TBS News](https://www.tbsnews.net/explainer/why-are-uk-universities-restricting-recruitment-bangladeshi-pakistani-students-1302001), [PIE on BCA](https://thepienews.com/uk-stricter-bca-rules-to-take-effect-in-september/)). Sources differ on whether the <5% BCA threshold started in September 2025 or June 2026 ([PIE](https://thepienews.com/uk-stricter-bca-rules-to-take-effect-in-september/) vs [BCA]).
  - **AU:** Evidence Level 1 → 3 in Jan 2026; refusals went from about 5% to 51% ([Leading Edge](https://www.leadingedgemigration.com.au/post/major-update-south-asian-country-evidence-levels-adjusted-for-student-visa-january-2026), [ICEF Monitor](https://monitor.icef.com/2026/06/what-is-happening-to-student-mobility-flows-between-the-global-south-and-global-north/)).
  - **US:** 73% F-1 refusal. **CA:** 18% approval in 2024 ([PIE](https://thepienews.com/has-canada-reached-a-turning-point-in-study-permit-approvals/)).
- **Profile and timing:**
  - Destinations: US, UK, Canada, Malaysia, Germany, Australia. Malaysia, China and Japan are rising on cost ([ICEF Monitor](https://monitor.icef.com/2025/11/the-economic-indicators-driving-outbound-student-mobility-from-bangladesh-indonesia-nepal-and-vietnam)).
  - HSC results come out in mid-October ([Financial Express](https://today.thefinancialexpress.com.bd/print/hsc-results-today-1760555100)).

### 4.4 Vietnam

- **Agency regulation:** study-abroad consulting is licensed under Decree 86/2021, amended by Decree 322/2026 (17 Aug 2026). Counsellors need a degree, foreign-language level 4 and a professional training certificate ([LuatVietnam](https://english.luatvietnam.vn/decree-no-322-2026-nd-cp-dated-august-17-2026-of-the-government-amending-and-supplementing-a-number-of-articles-of-the-governments-decree-no-86-20-444451-doc1.html), [Viet An Law](https://vietanlaw.com/granting-study-abroad-consulting-certificate-in-ho-chi-minh/)). Counsellor credentials are a compliance item here.
- **Documents:** notarised copies, then certified translation, then legalisation. Apostille has applied since 11 Sep 2026, except for Germany, Austria and Czechia ([Baker McKenzie](https://www.bakermckenzie.com/en/insight/publications/2026/09/vietnam-apostille-convention-simplifies-cross-border-public-documents)). Police clearance is Judicial Record Certificate No. 2, available through VNeID ([Zora](https://zora.vn/en/new-procedure-for-applying-for-a-judicial-record-certificate-in-vietnam-from-2025)).
- **Forex:** Circular 20/2022 allows study-abroad transfers, with limits set by each bank ([LuatVietnam](https://english.luatvietnam.vn/legal-updates/guidance-on-one-way-money-transfer-abroad-from-vietnam-892-92779-article.html)).
- **Visa risk:** AU Evidence Level 2 ([OneU](https://www.oneuedu.com/en-US/visa/policy-updates/student-visa-evidence-level-september-2026)). US F-1 issuance grew in H1 2025 ([NU](https://www.nu.edu/blog/which-countries-send-more-students-to-us/)).
- **Profile:**
  - The top sender to Korea and Taiwan, 3rd to Japan, 5th to the US; Australian enrolments are down about 10% ([ICEF Monitor](https://monitor.icef.com/2026/09/vietnam-a-strong-economy-at-home-is-powering-surging-demand-for-study-abroad/)).
  - Strong K-12 and boarding-school demand ([ICEF Monitor 2023](https://monitor.icef.com/2023/06/vietnam-remains-a-key-growth-market-in-southeast-asia)). Expect more parent-led, under-18 cases (guardian and minor protections, §1.0).

### 4.5 Philippines

- **Documents:**
  - CHED CAV has been online only through ECAV since 1 Jul 2025, followed by a DFA apostille ([Southville](https://www.southville.edu.ph/ched-ro-memorandum-no-40-series-of-2025/), [AU Embassy](https://philippines.embassy.gov.au/files/mnla/The%20CAV%20Process.pdf)).
  - PSA civil documents. NBI clearance as the police clearance; a name "hit" adds delay ([guide](https://immigrationstartguide.com/blog/philippine-documents-australia-visa-nbi-psa-prc-apostille) *(secondary)*).
- **CFO:** the pre-departure seminar applies to exchange-visitor students (for example US J-1), not ordinary degree students ([EVP Committee](https://evpcommittee.ph/news2/93-commission-on-filipinos-overseas-cfo-conducted-an-awareness-program-on-the-exchange-visitor-program-evp)).
- **Visa risk:** AU Evidence Level 3, with the lowest-ever August grant rate in 2026 ([OneU](https://www.oneuedu.com/en-US/visa/policy-updates/student-visa-evidence-level-september-2026), [THE](https://www.timeshighereducation.com/node/745175)). CA approval about 56% in 2024. Canada's spouse open work permits are now limited to master's, PhD and professional programs ([PIE](https://thepienews.com/has-canada-reached-a-turning-point-in-study-permit-approvals/), [ICEF Monitor](https://monitor.icef.com/2024/04/market-snapshot-a-guide-to-international-student-recruitment-in-the-philippines/)).
- **Profile:** nursing, aged care and Certificate III/IV Individual Support programs, with families often moving together ([ICEF Monitor](https://monitor.icef.com/2024/04/market-snapshot-a-guide-to-international-student-recruitment-in-the-philippines/)). Dependant and family-visa questions are frequent, and they hit the migration-advice boundary (§1.0).

### 4.6 Thailand

- **Documents:** legalisation only through the Department of Consular Affairs; apostille from 28 Feb 2027 ([MFA Thailand](https://mfa.go.th/en/content/apostille-convention-eng)). Royal Thai Police clearances need fingerprint-based checks from July 2026 ([Nation Thailand](https://www.nationthailand.com/news/general/40068808)).
- **Visa risk:** AU Evidence Level 3 ([OneU](https://www.oneuedu.com/en-US/visa/policy-updates/student-visa-evidence-level-september-2026)). Tougher UK rules have had little effect on Thai applicants ([Pattaya Mail](https://www.pattayamail.com/latestnews/news/uks-tougher-visa-rules-will-barely-affect-thai-applicants-500608)).
- **Profile:** the UK first and the US second; graduates on government (OCSC) scholarships; boarding school and sixth form ([US Trade.gov](https://www.trade.gov/country-commercial-guides/thailand-education-services)). Short English courses are timed to the March–April holidays ([British Council](https://opportunities-insight.britishcouncil.org/news/opportunities/opportunity-promote-short-term-english-course-march-and-april-2019-thai-students)). This mix means many minors, short-course and scholarship-sponsor cases.

### 4.7 Sri Lanka

- **Documents:** O/L and A/L certificates are authenticated online through the Department of Examinations and the Foreign Ministry's Consular Affairs Division ([MFA LK](https://mfa.gov.lk/?p=71704)). Online police clearance takes about 14 working days ([LK Embassy](https://abudhabi.embassy.gov.lk/consular-services/applying-for-an-online-police-clearance-certificate-7/)).
- **Forex:** education remittances go through authorised banks, and a "student file" is advised ([CBSL](https://www.cbsl.gov.lk/en/news/remittance-of-funds-to-sri-lankans-abroad-to-pursue-studies-and-on-short-term-visits-to-meet-their-expenses)).
- **Visa risk:** AU Evidence Level 1 → 2 in Jan 2026, with about 38–41% refusals in Jan–Mar 2026 ([Ada Derana](https://www.adaderana.lk/news.php?nid=122152)). UK grant rate about 91% ([PIE](https://thepienews.com/visa-refusals-study-in-uk/)).
- **Profile:** the UK leads. There is strong demand for UK university programs taught in Sri Lanka (TNE) and "1 year here, finish abroad" articulation ([ICEF Monitor](https://monitor.icef.com/2025/01/recruiting-in-sri-lanka-demand-for-study-abroad-remains-high-tne-poised-for-further-growth/)), so credit transfer and advanced standing are routine questions. A/L results usually come out around April ([NewsFirst](https://www.newsfirst.lk/2025/04/20/a-l-exam-results-to-be-released-before-end-of-april)).

### 4.8 Rules common to all seven markets

- **UK TB test:** required for all 7 markets [UK-TB].
- **UK ATAS:** applies to all 7 (none are exempt nationalities) [ATAS].
- **Canada proof of funds:** reported as CAD 23,448 for a single applicant outside Quebec from 1 Sep 2026 ([immigration.ca](https://immigration.ca/canada-increases-study-permit-financial-requirements-what-applicants-must-now-prove/) *(secondary)*). This supersedes the ~CAD 22,895 in §1.1 Stage 8. **Always look the figure up live.**

### 4.9 Comparison

| | Nepal | India | Bangladesh | Vietnam | Philippines | Thailand | Sri Lanka |
|---|---|---|---|---|---|---|---|
| Exit permission / forex | MoEST NOC; USD 12k NRB limit | LRS USD 250k/yr; TCS 2% >₹10L (loan nil) | Bank "student file" | Bank-set limits | None found | None found | Authorised banks; "student file" |
| Agency regulation | 2026 Regs (deposit, degree, grading, fair ban, liability) | Punjab district licensing | None found | Decree 86/2021 + 322/2026 | None found | None found | None found |
| Document route | NOC + police clearance attestation | Board/university verification; Passport Seva police clearance | Board → MOFA (MyGov); apostille 2025 | Notarise + translate; apostille Sep 2026 | CHED ECAV → DFA apostille | Foreign Ministry legalisation; apostille Feb 2027 | Exams Dept + Foreign Ministry online |
| AU Evidence Level (Sep 2026) | 3 | 3 | 3 | 2 | 3 | 3 | 2 |
| Hot spots | AU refusals ~64%; US 81% | CA 80%, US 61%, AU 60% | UK ~22% + university pauses; AU 51% | Low risk; K-12 | Nursing and care pathways, families | Minors, short courses, scholarships | TNE articulation |
| Main destinations | Japan, AU, UK, CA, KR | US, CA, UK, AU | US, UK, CA, MY | KR, JP, TW, US, AU | CA, AU | UK, US | UK, AU |

**Gaps (not researched or not found):** the language of counselling per market, VFS centre logistics, and parental decision-making dynamics had no authoritative sources. Edge should not assume them.

---

## 5. Jobs-to-be-done checklist

**Legend**

- **Stage:** LEAD, COUN (counselling), SHORT (shortlisting), APP (application), OFFER, DEP (acceptance/deposit), CONF (CoE/CAS/I-20/LOA), VISA, PRE (pre-departure), ARR (arrival), ON (onshore), POST (post-study), OPS (non-student).
- **Type:** KNOW (knowledge lookup), CALC (calculation), DRAFT (drafting), DOC (document review), CRM (CRM action), SCHED (scheduling), POLICY (policy monitoring), EMO (emotional support), COMP (compliance).
- **Frequency** (per counsellor): D = daily, W = weekly, O = occasional.
- **Criticality:** H = a wrong or missed answer risks a visa refusal, legal or ethical breach, money loss or a lost student; M = rework or a delay; L = convenience.
- **Score** = frequency (D3, W2, O1) × criticality (H3, M2, L1). The top 25 are in §5.1.
- **Evidence** names the source keys or sections that ground each job.
- **Edge guardrail** marks jobs where the right behaviour includes refusing, referring or caveating (migration advice, fraud, guarantees, live figures).

| # | Job to be done | Stage | Type | Freq | Crit | Score | Evidence | Edge guardrail |
|---|---|---|---|---|---|---|---|---|
| 1 | Pull up a student or lead record and its full history before a call or meeting | OPS | CRM | D | H | 9 | [CRM-MONDAY], §2.2 | |
| 2 | Create or update a lead; log the interaction; set the next follow-up | LEAD | CRM | D | H | 9 | [IATC] M1, [ACE] P3 | |
| 3 | Qualify an inbound enquiry (destination, level, intake, budget, English, gaps) and propose a next step | LEAD | KNOW | D | M | 6 | [IATC] M5 | |
| 4 | Draft a first-response message (WhatsApp, Viber, Zalo, LINE or email), in the local language when needed | LEAD | DRAFT | D | M | 6 | §4 | |
| 5 | Book a counselling appointment and send the invite and reminders | LEAD | SCHED | D | M | 6 | §2.1 | |
| 6 | Prioritise today's follow-ups by intake deadline and lead heat | OPS | CRM | D | M | 6 | [CRM-MONDAY] | |
| 7 | Re-engage dormant or lost leads before the next intake deadline | LEAD | DRAFT | W | L | 2 | §2.1 | |
| 8 | Capture and record consent for data use, marketing and third-party sharing | LEAD | COMP | D | H | 9 | [ACE] Confidentiality | |
| 9 | Summarise a student profile (academics, English, finances, gaps, refusals, travel, ties) into case notes | COUN | DRAFT | D | H | 9 | [IATC] M5, [ACE] | |
| 10 | Convert home-country grades or GPA (NEB, CBSE/state boards, HSC, A/L, Vietnamese GPA, Philippine GWA) to the destination scale and check eligibility | COUN | CALC | D | H | 9 | [AEATC] A-section, [IATC] M8, §4 | |
| 11 | Explain destination education systems, levels and pathways (ELICOS, foundation, diploma → degree) | COUN | KNOW | D | M | 6 | [AEATC] A1–A8, [IATC] M8 | |
| 12 | Compare destinations for this student on cost, work rights, post-study rights and visa difficulty from their source market | COUN | KNOW | D | H | 9 | [ACE] P2, §4 | Live figures |
| 13 | Estimate total cost (tuition + living + OSHC/IHS + visa fees + travel) in home currency | COUN | CALC | D | H | 9 | [AU-FIN], [UK-FUNDS], [CA-2026] | Live figures |
| 14 | Answer part-time work-rights questions per destination (AU 48 h/fortnight; NZ 25 h/week, etc.) | COUN | KNOW | D | M | 6 | [WORK8105], [NZ-VISA] | Live figures |
| 15 | Give general information on post-study work (485, Graduate route, PGWP, OPT) and flag a licensed-adviser referral for individual strategy | COUN | KNOW | D | H | 9 | [485], [GRAD], [PGWP], §1.0 | Migration advice |
| 16 | Answer spouse or dependant questions (UK taught master's ban; CA spouse open work permit limits) and refer | COUN | KNOW | W | H | 6 | [UK-DEP], [PIE-DEP], §4.5 | Migration advice |
| 17 | Assess a study gap: is it explainable, and what evidence is needed | COUN | DOC | D | H | 9 | [ACE] Recruitment Practices | |
| 18 | Assess a prior visa refusal: its impact and the duty to disclose it | COUN | KNOW | W | H | 6 | [IRCC-REP], §1.1 S8 | Migration advice |
| 19 | Screen Genuine Student / credibility risk (course–career logic, ties, funds, age, gap) | COUN | COMP | D | H | 9 | [ACE], [AU-COST], [PRECAS-UWE] | |
| 20 | Recognise when a question is migration advice and route it to an RMA, OISC adviser, RCIC or IAA-licensed adviser | COUN | COMP | D | H | 9 | [OMB-FACT], [OISC-UKCISA], [IRPA91], [NZ-INZ-ADV] | Migration advice |
| 21 | Explain agency service fees and commission; prepare the student service agreement (fees, refund, transfer) | COUN | COMP | W | H | 6 | [ACE] P1, P3; [BC-GUIDE]; Nepal 2026 Regs §4.1 | |
| 22 | Handle an under-18 student: guardian present, informed consent, legal capacity, welfare and guardianship | COUN | COMP | O | H | 3 | [ACE] P4 | |
| 23 | Reassure an anxious parent or sponsor without guaranteeing outcomes | COUN | EMO | D | M | 6 | [STAFFS], [STD1] | No guarantees |
| 24 | Recommend an English test and the target scores (institution vs visa acceptance; e.g. Duolingo not accepted for an AU visa) | COUN | KNOW | D | H | 9 | §4.1 (KIEC), [AU-CHECK] | Live figures |
| 25 | Book an English test or refer to test prep | COUN | SCHED | W | L | 2 | §2 | |
| 26 | Look up scholarships, eligibility and deadlines | COUN | KNOW | D | M | 6 | [CA-COURSE] | |
| 27 | Search partner courses by level, field, budget, intake, location and entry requirements | SHORT | KNOW | D | H | 9 | [IATC] M7–8, §1.1 S3 | |
| 28 | Check a course's academic, English and prerequisite entry requirements | SHORT | KNOW | D | H | 9 | [ACE] P2 | |
| 29 | Check intake dates and application deadlines | SHORT | KNOW | D | H | 9 | §1.1 S3 | |
| 30 | Confirm the institution is a current partner (agreement, territory, sub-agent route, onshore rules) | SHORT | KNOW | D | H | 9 | [STD4], [ACE] Standards | |
| 31 | Check course codes and flags: CRICOS, PGWP-eligible CIP, ATAS, PAL needed | SHORT | KNOW | W | H | 6 | [AEATC] B5, [PGWP], [ATAS], [PAL-BC] | |
| 32 | Check provider-level visa-risk signals (AU MD115 tier, UK sponsor BCA/RAG status, university pauses by market) | SHORT | POLICY | W | H | 6 | [MD115], [BCA], §4.3 | |
| 33 | Build a side-by-side comparison of 2–5 shortlisted courses | SHORT | DRAFT | D | M | 6 | §1.1 S3 | |
| 34 | Record the reason for each recommendation (best-interest file note) | SHORT | COMP | D | M | 6 | [ACE] Objectivity | |
| 35 | Check credit transfer, RPL or advanced standing (e.g. Sri Lankan TNE articulation) | SHORT | KNOW | W | M | 4 | §4.7 | |
| 36 | Generate a personalised document checklist per institution and student | APP | KNOW | D | H | 9 | [IATC] M12, [AEATC] C7 | |
| 37 | Review transcripts and certificates for completeness and name/DOB consistency | APP | DOC | D | H | 9 | [IATC] M12 | |
| 38 | Spot document-fraud red flags (format, issuer, verification failure, loan or disbursal mismatch) | APP | DOC | D | H | 9 | [IATC] M12, §4.2 (INZ case) | Fraud |
| 39 | Route academic verification by market (NEB/TU, Indian boards, BD board→MOFA, CHED ECAV, LK Exams Dept, VN notarisation) | APP | KNOW | W | H | 6 | §4 | |
| 40 | Advise on certification, translation and apostille or legalisation needs | APP | KNOW | W | M | 4 | §4.3–4.6 | |
| 41 | Review an SOP or personal statement and give feedback, without fabricating content | APP | DOC | D | H | 9 | [ACE] P1, [CHESTER] | No ghost-writing claims |
| 42 | Draft guidance for a gap-explanation letter, LOR request or CV | APP | DRAFT | W | M | 4 | §1.1 S4 | |
| 43 | Enter application data on an institution or aggregator portal | APP | CRM | D | M | 6 | [STUDYLINK] | |
| 44 | Track application status across portals and update the CRM stage | APP | CRM | D | H | 9 | [STUDYLINK], [CRM-MONDAY] | |
| 45 | Reply to an institution's document request or condition query | APP | DRAFT | D | H | 9 | §1.1 S4 | |
| 46 | Prepare a student for a pre-CAS or credibility interview (understand, don't script) | APP | DRAFT | W | H | 6 | [PRECAS-UWE], [CHESTER] | No scripts |
| 47 | Email the partner admissions team or BDM about a case | APP | DRAFT | D | M | 6 | [IATC] M4 | |
| 48 | Read and explain an offer letter (type, conditions, deadlines, fees, scholarship) | OFFER | DOC | D | H | 9 | §1.1 S5 | |
| 49 | Compare multiple offers and recommend one with reasons | OFFER | CALC | W | M | 4 | [ACE] | |
| 50 | Track offer conditions and chase final results or English scores | OFFER | CRM | D | M | 6 | §1.1 S5 | |
| 51 | Handle a deferral request | OFFER | DRAFT | O | M | 2 | §1.1 S5 | |
| 52 | Explain the refund policy (visa refusal, withdrawal, transfer) | OFFER | KNOW | W | H | 6 | [ACE] P3, [OMB-2025] | |
| 53 | Calculate the deposit or first-term fees and due date in local currency | DEP | CALC | D | H | 9 | §1.1 S6 | Live FX |
| 54 | Explain legitimate payment channels and home-country remittance rules (NOC/forex, LRS/TCS, student file) | DEP | KNOW | W | H | 6 | §4.1–4.7, [BC-GUIDE] | Agent doesn't hold funds |
| 55 | Arrange or compare OSHC (AU), or note the IHS (UK) | DEP | KNOW | W | M | 4 | [AU-COST] | |
| 56 | Guide an education loan: lenders, collateral tiers, sanction vs disbursal letters | DEP | KNOW | W | H | 6 | §4.2, §4.1 | |
| 57 | Verify a payment receipt and record it in the CRM | DEP | CRM | D | M | 6 | §2.2 | |
| 58 | Check a CoE, CAS, I-20 or LOA for errors (name, dates, fees paid, course code) | CONF | DOC | D | H | 9 | [AEATC] outcome "what a CoE looks like", [LOA] | |
| 59 | Answer "when will my CoE/CAS/I-20 arrive?" from the status | CONF | CRM | D | M | 6 | §1.1 S7 | |
| 60 | Determine whether a PAL/TAL is needed and how it's obtained | CONF | KNOW | O | H | 3 | [PAL-BC], [CA-2026] | |
| 61 | Guide an ATAS application (sensitive postgraduate subjects) | CONF | KNOW | O | M | 2 | [ATAS] | |
| 62 | Generate a visa document checklist for this destination × source market × evidence level | VISA | KNOW | D | H | 9 | [AU-CHECK], §4 | Live rules |
| 63 | Calculate required funds (living + tuition + travel + dependants; UK 28-day rule; CA new threshold) | VISA | CALC | D | H | 9 | [AU-FIN], [UK-FUNDS], §4.8 | Live figures |
| 64 | Review financial documents for sufficiency, holding period and genuineness | VISA | DOC | D | H | 9 | §4.1, §4.2, [ACE] | Fraud |
| 65 | Explain source-of-funds expectations to a sponsor (income, tax, property, loans) | VISA | KNOW | D | H | 9 | §4.1, §4.2 | |
| 66 | Review a GS statement or visa SOP for consistency with the file | VISA | DOC | D | H | 9 | [AU-COST], [ACE] | No fabrication |
| 67 | Book the medical (panel or eMedical; UK TB test) and biometrics | VISA | SCHED | W | M | 4 | [UK-TB], §4.1 | |
| 68 | Explain the home-country police clearance process | VISA | KNOW | W | M | 4 | §4 | |
| 69 | Prepare for a visa interview (US F-1; UKVI credibility) | VISA | DRAFT | W | H | 6 | [US-F1], [CHESTER] | No scripts |
| 70 | Look up current visa fees and charges | VISA | KNOW | D | M | 6 | [AU-COST], [US-F1], [VIF] | Live figures |
| 71 | Set expectations on processing times (MD115 tiers, consular waits) | VISA | KNOW | D | M | 6 | [MD115] | Live |
| 72 | Lodge or track a visa application and update the CRM (within the advice limits) | VISA | CRM | D | H | 9 | §1.0 | Migration advice |
| 73 | Respond to a visa officer's request for information before the deadline | VISA | DRAFT | W | H | 6 | §1.1 S8 | Migration advice (onshore) |
| 74 | Explain a refusal letter in plain language, support the student, and route review or reapplication strategy to a licensed adviser | VISA | DOC | W | H | 6 | §1.0 | Migration advice |
| 75 | Monitor policy changes (fees, funds, caps, MD, evidence levels, BCA) and brief the team | OPS | POLICY | W | H | 6 | [MD115], [BCA], [ASQA-ACT] | |
| 76 | Record visa outcomes and keep counsellor and branch visa-success metrics | VISA | CRM | D | H | 9 | [ICEF-DATA], [BCA] | |
| 77 | Prepare a destination-specific pre-departure briefing pack | PRE | DRAFT | W | M | 4 | [SA-PREDEP], [IATC] M6 | |
| 78 | Help with accommodation options and booking | PRE | KNOW | W | M | 4 | [GORDON] | |
| 79 | Time flights against orientation and the course start (book only after the visa grant) | PRE | SCHED | W | L | 2 | [SA-PREDEP] | |
| 80 | Request airport pickup from the institution | PRE | SCHED | W | L | 2 | [GORDON] | |
| 81 | Explain customs, biosecurity and cash-carry limits | PRE | KNOW | W | L | 2 | [SA-PREDEP] | |
| 82 | Check the UK eVisa: UKVI account, linked passport, share code | PRE | KNOW | W | H | 6 | [UK-EVISA] | |
| 83 | Track the pre-departure checklist per student | PRE | CRM | W | M | 4 | §1.1 S9 | |
| 84 | Confirm safe arrival and attendance at orientation and enrolment | ARR | CRM | W | M | 4 | [STD6] | |
| 85 | Escalate a critical incident or welfare concern to the provider and family | ARR | COMP | O | H | 3 | [STD6] | |
| 86 | Support homesickness or adjustment; signpost the provider's support services | ARR | EMO | O | M | 2 | [IATC] M6, [STD6] | |
| 87 | Course or provider change: 6-month rule, release letter, best interest, commission ban | ON | COMP | W | H | 6 | [STD7], [TEQSA-COMM], [BAN-FACT] | Transfer ethics |
| 88 | Answer visa-condition questions (8105 work, 8202 enrolment and attendance) | ON | KNOW | W | H | 6 | [WORK8105], [MONASH-8202] | |
| 89 | Student visa expiring: give general options and refer to an RMA | ON | COMP | W | H | 6 | [OMB-FACT], [AU-HOP], [AU-COE-ONSHORE] | Migration advice |
| 90 | Intention-to-cancel, attendance or progress warning: support and refer | ON | EMO | O | H | 3 | [MONASH-8202] | Migration advice |
| 91 | Remind about OSHC renewal or extension | ON | SCHED | O | M | 2 | [AU-COST] | |
| 92 | Guide a complaint against a provider (internal process, then OSO / NZ Code) | ON | COMP | O | M | 2 | [NZ-CODE], [OSO-2013] | |
| 93 | Check onshore application eligibility (visitor and 485 holders barred; CoE needed) | ON | KNOW | W | H | 6 | [AU-HOP], [AU-COE-ONSHORE] | Migration advice |
| 94 | Identify further-study opportunities (master's after bachelor's, which isn't a "transfer") | ON | KNOW | W | M | 4 | [BAN-FACT] | |
| 95 | General post-study visa information plus referral | POST | KNOW | W | H | 6 | [485], [GRAD], [PGWP] | Migration advice |
| 96 | Request an alumni referral or testimonial | POST | DRAFT | O | L | 1 | [IATC] M5 | |
| 97 | Signpost careers services | POST | KNOW | O | L | 1 | [IATC] M5 | |
| 98 | "My pipeline today": students by stage with the next action due | OPS | CRM | D | H | 9 | [CRM-MONDAY] | |
| 99 | Find stalled cases (no activity in N days, deadline or expiry approaching) | OPS | CRM | D | H | 9 | [CRM-MONDAY] | |
| 100 | Build the commission claim list (enrolled and census-passed students per institution per intake) | OPS | CRM | W | H | 6 | [AEATC] B11, [COMM-DATA] | |
| 101 | Reconcile commission received against expected; chase gaps | OPS | CALC | W | M | 4 | [CRM-MONDAY] | |
| 102 | Handle commission clawback on a withdrawal or refund | OPS | CRM | O | M | 2 | [OMB-2025] | |
| 103 | Look up partner agreement terms (rates, bonuses, territories, exclusions, onshore ban) | OPS | KNOW | W | H | 6 | [STD4], [BAN-FACT] | |
| 104 | Digest partner updates (new courses, fee changes, scholarships, deadlines, recruitment pauses) | OPS | POLICY | W | H | 6 | [AGENT-HUB], §4.3 | |
| 105 | Draft an email to a partner BDM or regional manager | OPS | DRAFT | W | M | 4 | [IATC] M4 | |
| 106 | Prepare for an institution visit or training | OPS | KNOW | O | L | 1 | [AGENT-HUB] | |
| 107 | Plan an event or fair: invitations, registration, lead follow-up | OPS | SCHED | O | M | 2 | [IATC] M2; Nepal fair ban §4.1 | Market rules |
| 108 | Draft marketing copy with a compliance check (approved material, no guarantees, registration number) | OPS | DRAFT | W | M | 4 | [ACE] P2 | No guarantees |
| 109 | Weekly target report (leads → apps → offers → CoE/CAS → visas; conversion) | OPS | CALC | W | H | 6 | §2.6 | |
| 110 | Branch or team leaderboard and funnel analysis | OPS | CALC | W | M | 4 | §2.6 | |
| 111 | Visa refusal rate by counsellor, institution and market | OPS | CALC | W | H | 6 | [ICEF-DATA], [BCA] | |
| 112 | Log a complaint, respond, and track to resolution | OPS | COMP | O | H | 3 | [ACE], [AEATC] B10 | |
| 113 | Handle a privacy request (access, correction, deletion) | OPS | COMP | O | M | 2 | [ACE], [AEATC] B10 | |
| 114 | Track certification status and renewals (QEAC, British Council 2-year, ITAC, VN certificate, Nepal degree requirement) | OPS | COMP | O | M | 2 | [AEATC], [ICEF-AQF], §4.1, §4.4 | |
| 115 | Answer new-staff onboarding questions (SOPs, policies, ethics) | OPS | KNOW | W | M | 4 | [ACE] Staff Capability | |
| 116 | Write a handover summary when a student moves counsellor or branch | OPS | DRAFT | W | M | 4 | §2.2 | |
| 117 | Disclose and manage sub-agents | OPS | COMP | O | M | 2 | [ACE] Org. Effectiveness | |
| 118 | Turn meeting or call notes into CRM tasks | OPS | DRAFT | D | M | 6 | §2.2 | |
| 119 | Translate a message to or from Nepali, Hindi, Bengali, Vietnamese, Filipino, Thai, Sinhala or Tamil | OPS | DRAFT | D | M | 6 | §4 | |
| 120 | Draft an email or message to a student or parent (status update, document chase, reminder) | OPS | DRAFT | D | M | 6 | [IATC] M5 | |
| 121 | Refuse requests to fabricate or alter documents, funds or answers | ALL | COMP | O | H | 3 | [ACE] P1 | Fraud |
| 122 | Check any quoted figure against a dated official source before sending | ALL | COMP | D | H | 9 | [ACE] P2 | Live figures |
| 123 | Home-country exit paperwork per market (Nepal NOC; BD/LK student file; LRS/A2) | DEP | KNOW | W | H | 6 | §4.1–4.3, §4.7 | |
| 124 | Explain market-specific visa risk (AU Evidence Level; UK university pauses; CA/US refusal trends) and adjust the file strategy | VISA | POLICY | W | H | 6 | §4 | |
| 125 | Comply with source-country agency law (Nepal 2026 Regs; VN Decree 322/2026; Punjab licensing) | OPS | COMP | O | H | 3 | §4.1, §4.2, §4.4 | |
| 126 | Calculate the AU 485 or UK Graduate route timeline (lodge within 6 months; age cap; Graduate route 18 months from 2027) | POST | CALC | O | M | 2 | [485], [GRAD] | Migration advice |
| 127 | Answer "is this agent/institution legit?" (approved-agent lists, CRICOS, DLI) | COUN | KNOW | W | M | 4 | [PIE-TUFUTURO], [AEATC] B5 | |
| 128 | Book or track a follow-up meeting with a parent or sponsor | COUN | SCHED | W | M | 4 | §1.1 S2 | |
| 129 | Log calls, talk-time and video sessions against daily quotas | OPS | CRM | D | M | 6 | §2.9 (#11, #12) | |
| 130 | Train or brief junior counsellors on product knowledge and policy changes | OPS | KNOW | W | M | 4 | §2.9 (#6, #14, #15), [ACE] Staff Capability | |

### 5.1 Top 25 by frequency × criticality

These are all the score-9 (daily × high) jobs. Ties are ordered by how central they are to visa outcomes and compliance, the two things now visible to partners ([ICEF-DATA], [BCA]).

1. #20 Recognise migration advice and route it to a licensed adviser (COMP)
2. #19 Genuine Student / credibility risk screen (COMP)
3. #64 Review financial documents for sufficiency and genuineness (DOC)
4. #63 Calculate required visa funds with current thresholds (CALC)
5. #62 Visa document checklist by destination × market × evidence level (KNOW)
6. #38 Spot document-fraud red flags (DOC)
7. #122 Check every quoted figure against a dated official source (COMP)
8. #66 Review a GS statement or visa SOP for consistency (DOC)
9. #41 Review an SOP or personal statement without fabricating (DOC)
10. #27 Search partner courses matching the profile (KNOW)
11. #28 Check entry requirements (KNOW)
12. #10 Convert home-country grades to destination eligibility (CALC)
13. #30 Confirm the institution is a current partner and the route (KNOW)
14. #13 Estimate total cost in home currency (CALC)
15. #12 Compare destinations from the student's source market (KNOW)
16. #36 Personalised application document checklist (KNOW)
17. #37 Review transcripts and certificates for consistency (DOC)
18. #48 Read and explain an offer letter (DOC)
19. #58 Check a CoE/CAS/I-20/LOA for errors (DOC)
20. #15 Post-study work general information plus referral (KNOW)
21. #24 English test choice and target scores (KNOW)
22. #1 / #98 Student record lookup and "my pipeline today" (CRM)
23. #44 / #72 Track application and visa status; update the CRM stage (CRM)
24. #99 Find stalled cases and approaching deadlines (CRM)
25. #9 / #2 Case-note summary and interaction logging (DRAFT/CRM)

Other score-9 jobs that just miss the cut: #8 consent capture, #17 gap assessment, #29 intake deadlines, #45 replying to institution requests, #53 deposit calculation, #65 sponsor source-of-funds, #76 visa-outcome recording.

### 5.2 Audit implications for Edge

These follow from the evidence above.

- **Live-figure discipline:** about 20 jobs depend on numbers that changed during 2025–26:
  - AU living costs and visa charge;
  - UK funds (change on 30 Nov 2026);
  - the CA funds figure (changed 1 Sep 2026);
  - AU Evidence Levels (Jan and Sep 2026);
  - BCA thresholds;
  - TCS rates;
  - the Graduate route length (2027).

  Edge should cite a dated official source, or say it can't confirm the figure.
- **Migration-advice boundary:** it varies by destination and by where the counsellor sits (onshore AU or UK vs offshore; NZ offshore student-only exemption; CA "for consideration"). Edge should tell counsellors when to refer and draft the referral, not give individual visa strategy.
- **Fraud and fabrication refusals:** Edge drafting an SOP or GS statement is legitimate help. Inventing facts, scripting interview answers or "fixing" financial documents is not ([ACE], [CHESTER], [PRECAS-UWE]).
- **Market-conditioned answers:** the same question (checklist, funds, risk, documents) has different correct answers for NP, IN, BD, VN, PH, TH and LK (§4).
- **CRM-grounded jobs dominate frequency:** pipeline, status, follow-ups, logging and stalled cases are daily. They need CRM tool access, not knowledge alone.

---

## Sources

Reference keys used above. *(secondary)* marks a law-firm, trade-press, provider-policy or agency source; all others are government, regulator or official training/standards bodies. Section 4 uses inline URLs.

**Australia: regulation and ethics**
- [ACE] Australian International Education & Training Agent Code of Ethics (PDF, full text read): https://internationaleducation.gov.au/news/latest-news/Documents/Australian%20International%20Education%20and%20Training%20-%20Agent%20Code%20of%20Ethics.pdf
- [STD1] National Code Standard 1, Marketing information and practices: https://education.gov.au/node/11453
- [STD4] National Code Standard 4, Education agents (Dept of Education, updated 20 Jan 2026): https://www.education.gov.au/download/11456/standard-4-education-agents/43665/document/pdf
- [KAPLAN] *(provider policy)* Kaplan agent management policy: https://kaplan.edu.au/app/uploads/2022/07/agent-management-policy-and-guidelines-policy.pdf
- [STD6] National Code Standard 6 explanatory guide: https://internationaleducation.gov.au/Regulatory-Information/Education-Services-for-Overseas-Students-ESOS-Legislative-Framework/National-Code/nationalcodepartd/Pages/ExplanatoryguideD6.aspx
- [STD7] *(provider policy quoting Standard 7)* ACCS Transfer of Provider Policy: https://www.ccs.edu.au/wp-content/uploads/Current%20Policies/Transfer%20of%20Provider%20Policy.pdf
- [TEQSA-COMM] TEQSA, Education agents and commissions: https://www.teqsa.gov.au/about-us/news-and-events/latest-news/education-agents-and-commissions
- [JOINT-ALERT] ASQA/TEQSA joint sector alert on overseas student transfers (13 Jul 2026): https://www.teqsa.gov.au/guides-resources/resources/sector-updates-and-alerts/joint-asqa-and-teqsa-sector-alert-compliance-concerns-about-overseas-student-transfers
- [ASQA-ACT] ASQA on the Education Legislation Amendment (Integrity and Other Measures) Act 2025: https://www.asqa.gov.au/node/550 · Act text: https://www.legislation.gov.au/C2025A00074/asmade/text
- [BAN-FACT] Dept of Education fact sheet, ban on agent commissions for onshore transfers: https://www.education.gov.au/download/20049/ban-payment-agent-commissions-onshore-transfers/43677/document/pdf
- [COMM-DATA] Dept of Education, agent commissions data collection fact sheet: https://www.education.gov.au/download/20661/agent-commissions-data-collection/45800/principal-executive-officer-fact-sheet/pdf
- [ICEF-DATA] *(secondary)* ICEF Monitor, Australia moving to wider sharing of education agent data (Feb 2026): https://monitor.icef.com/2026/02/australia-moving-to-wider-sharing-of-education-agent-data
- [OMB-MIG] Commonwealth Ombudsman submission on regulation of migration agents: https://ombudsman.gov.au/__data/assets/pdf_file/0029/287084/Commonwealth-Ombudsmans-submission-to-the-inquiry-into-the-regulation-of-Australian-migration-agents.pdf
- [OMB-FACT] Ombudsman fact sheet, students and education agents: https://www.ombudsman.gov.au/__data/assets/pdf_file/0033/79683/Factsheet_student_education-agents-links-fixed-A1576258.pdf
- [OMB-2025] Ombudsman submission on the Integrity Bill 2025: https://www.ombudsman.gov.au/__data/assets/pdf_file/0012/323022/Submission-Inquiry-into-the-Education-Legislation-Amendment-Integrity-and-Other-Measures-Bill-2025.pdf
- [OSO-2013] Overseas Students Ombudsman, Complaints and education agents (2013): https://www.ombudsman.gov.au/__data/assets/pdf_file/0008/30032/17-April-2013-Complaints-and-education-agents.pdf
- [OSO-2017] Overseas Students Ombudsman ICEF presentation (2017, agent withholding refunds): https://www.ombudsman.gov.au/__data/assets/pdf_file/0016/44620/5-April-2017-OSO-ICEF-Presentation,-Cairns.pdf
- [PIE-TUFUTURO] *(secondary)* PIE News, students lose $1m to fraudulent agency: https://thepienews.com/australia-students-lose-1m-fraudulent-agency-tu-futuro/
- [ISEAA] ISEAA submission to Home Affairs (student-visa-only certification proposal): https://www.homeaffairs.gov.au/reports-and-pubs/files/world-class-submissions/submission-international-student-education-agents-association.pdf

**Australia: visas and student life**
- [MD115] Study Australia, Ministerial Direction 115: https://www.studyaustralia.gov.au/en/Agent-Hub/agent-news-index/ministerial-direction-115
- [AU-FIN] *(secondary)* One Planet Migration Law, 500 financial capacity 2026: https://oneplanetmigrationlaw.com.au/immigration-blog/student-visa-500-financial-capacity-requirement-2026/
- [AU-COST] *(secondary)* Widen, Student visa Australia cost 2026: https://www.widen.com.au/student-visa-australia-cost-2026/
- [AU-CHECK] *(secondary)* AHC Lawyers, Subclass 500 document checklist: https://www.ahclawyers.com/news-articles/25/11/03/student-visa-subclass-500-document-checklist
- [AU-HOP] Study Australia, changes to onshore student visa applications (visa hopping): https://studyaustralia.gov.au/ar/tools-and-resources/news/changes-to-student-visa-applications-to-prevent-visa-hopping
- [AU-COE-ONSHORE] *(secondary)* EIG Law, CoE required for onshore applications: https://eiglaw.com/australia-changes-onshore-student-visa-applications
- [WORK8105] University of Adelaide, working while studying (48 h/fortnight): https://adelaide.edu.au/students/student-services/international-student/working-while-studying/
- [MONASH-8202] Monash Student Association, student visa restrictions (8202): https://msa.monash.edu/services/support-services/finance-advice/international-student-matters/student-visa-restrictions/
- [485] *(secondary)* MyVisa, 485 requirements 2026: https://myvisa.com.au/immigration-guides/485-visa-requirements-2026-eligibility-streams-english-age-limits
- [SA-PREDEP] Study Australia, pre-departure checklist: https://www.studyaustralia.gov.au/en/plan-your-move/preparing-to-travel
- [GORDON] *(provider)* The Gordon, international pre-departure guide: https://www.thegordon.edu.au/sitedocs/international/international-student-pre-departure-guide.aspx
- [AGENT-HUB] Study Australia Agent Hub, agent support: https://www.studyaustralia.gov.au/en/Agent-Hub/agent-support
- [AAERI] *(secondary)* The Koala, AAERI launches agent training course: https://thekoalanews.com/aaeri-launches-agent-training-course-with-openlearning

**Training curricula**
- [AEATC] ICEF Academy, Australia Education Agent Training Course (QEAC): https://www.icef.com/academy/courses/education-agent-training-course-eatc/
- [IATC] ICEF Agent Training Course (ITAC): https://www.icef.com/agent-training/icef-agent-training-course-iatc/
- [IATC-SEARCH] ICEF Academy (destination courses incl. Canada and USA): https://www.icef.com/academy/about/
- [UK-ICEF-COURSE] ICEF listing, UK Agent and Counsellor Training Course: https://www.icef.com/academy/courses/uk-agent-and-counsellor-training-course
- [BC-SA] British Council Saudi Arabia, UK agent and counsellor training: https://saudiarabia.britishcouncil.org/en/study-uk/become-uk-agent-or-counsellor
- [BC-GH] British Council Ghana, UK agent and counsellor training: https://www.britishcouncil.org.gh/Become-a-UK-agent-or-counsellor
- [CA-COURSE] CAPS-I, Canada Course for Education Agents: https://caps-i.ca/agents/canada-course-for-education-agents/

**UK**
- [ICEF-AQF] ICEF, How the UK AQF will shape agent training (Jun 2025): https://monitor.icef.com/2025/07/how-the-uks-agent-quality-framework-will-shape-the-future-of-agent-training
- [UKCISA-AQF] UKCISA, Working with agents / AQF: https://www.ukcisa.org.uk/our-work/working-with-agents/
- [BUILA-NEW] BUILA, AQF strengthened by new course for agencies: https://www.buila.ac.uk/articles/agent-quality-framework-strengthened-by-new-course-for-agencies
- [UUKI-CODE] National Code of Ethical Practice for UK Education Agents (UUKi): https://universitiesuk.ac.uk/sites/default/files/uploads/UUKi/Documents%20-%20misc/National%20Code%20of%20Ethical%20Practice%20for%20UK%20Education%20Agents.pdf
- [BC-GUIDE] British Council, Student and parent guide to choosing an education agent: https://www.britishcouncil.org/sites/default/files/student_and_parent_guide_to_choosing_an_education_agent.pdf
- [COVENTRY] Coventry University, agent requirements (one certified counsellor per branch): https://www.coventry.ac.uk/partner-hub/agent-requirements/
- [STAFFS] Staffordshire University, UK AQF (no guarantees): https://www.staffs.ac.uk/international/your-application-journey/uk-agent-quality-framework-aqf
- [OISC-UKCISA] UKCISA training, OISC: https://moodle.ukcisa.org.uk/course_files/ui_2015/introduction-to-immigration/6a.html
- [NORTHUMBRIA] Northumbria University, immigration advice and OISC: https://corp.northumbria.ac.uk/study-at-northumbria/support-for-students/international-student-support/immigration-advice-and-oisc
- [UK-FUNDS] *(secondary)* OTS Solicitors, maintenance funds increase from 30 Nov 2026: https://www.otssolicitors.co.uk/news/student-visa-maintenance-funds-increase-from-30-november-2026/
- [BCA] *(secondary)* Doyle Clayton, stricter sponsor compliance standards: https://doyleclayton.co.uk/stricter-sponsor-compliance-standards-for-student-sponsors/
- [GRAD] *(secondary)* IDP, New visa rules 2026: UK: https://www.idp.com/blog/visa-rules-for-internaional-students-uk
- [PRECAS-UWE] UWE Bristol, pre-CAS interviews: https://www.uwe.ac.uk/courses/international-study/visas/applying/pre-cas-interviews
- [CHESTER] University of Chester, Guide to Credibility Interviews (Jan 2026): https://www.chester.ac.uk/media/media/documents/guides/A-Guide-to-Credibility-Interviews---January-2026-(1).pdf
- [UK-DEP] UKCISA, Student route: bringing your family: https://www.ukcisa.org.uk/student-advice/visas-and-immigration/student-route-bringing-your-family/
- [PIE-DEP] *(secondary)* PIE News, master's students banned from bringing dependants: https://thepienews.com/news/international-masters-students-banned-dependants-uk/
- [UK-TB] GOV.UK, countries where you need a TB test (all 7 Expert markets listed; checked 9 Oct 2026): https://www.gov.uk/tb-test-visa/countries-where-you-need-a-tb-test-to-enter-the-uk
- [ATAS] University of Kent, ATAS: https://www.kent.ac.uk/student-immigration/atas
- [UK-EVISA] University of Cambridge International Student Office, eVisas: https://www.internationalstudents.cam.ac.uk/node/302

**Canada**
- [IRPA91] IRCC Q&A on IRPA s.91 (May 2025, via CCR): https://ccrweb.ca/sites/ccrweb.ca/files/2025-05/Section_91_IRPA_IRCC_Questions_and_Answers_May2025.pdf
- [ICEF-C35] *(secondary, 2012)* ICEF, How Bill C-35 affects education agents: https://monitor.icef.com/2012/06/how-canadas-bill-c-35-affects-education-agents/cic-c35-summary
- [IRCC-REP] IRCC, Know the rules before you apply to study in Canada: https://www.canada.ca/en/immigration-refugees-citizenship/services/protect-fraud/study-permit-fraud.html
- [KPU] *(provider)* KPU, agent and in-country representation information: https://kpu.ca/international/agents/for-students
- [CA-2026] *(secondary)* Bridgepoint Law, Study permits and PGWP 2026: https://bridgepointlaw.ca/canada-study-permit-pgwp-complete-guide-2026/
- [PGWP] *(secondary)* CIC News, IRCC freezes PGWP field-of-study list for 2026: https://www.cicnews.com/2026/01/ircc-freezes-list-of-pgwp-eligible-fields-of-study-for-2026-0167305.html
- [LOA] IRCC, CIMM briefing on LOA verification (Dec 2023): https://www.canada.ca/en/immigration-refugees-citizenship/corporate/transparency/committees/cimm-dec-05-2023/letter-acceptance-verification.html
- [SDS] IRCC, Student Direct Stream (closed 8 Nov 2024): https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/temporary-residents/study-permits/direct-stream.html
- [CA-REFUSE] *(secondary)* Tribune India, India's rejection rate soars to 74%: https://www.tribuneindia.com/news/diaspora/canadas-student-visa-crackdown-indias-rejection-rate-soars-to-74-in-2025/amp
- [PAL-BC] Government of BC, Provincial Attestation Letters: https://www2.gov.bc.ca/gov/content/education-training/post-secondary-education/international-education

**United States**
- [US-F1] *(secondary)* Shorelight, F-1 visa 2026: https://www.shorelight.com/student-stories/student-visa-usa-f1
- [VIF] Boston University ISSO, Visa Integrity Fee (May 2026): https://www.bu.edu/isso/2026/05/19/visa-integrity-fee/
- [AIRC] AIRC Agency Standards: https://airc-education.org/agency-standards
- [AIRC-CERT] AIRC Certification: https://www.airc-education.org/certification
- [AIRC-UPGRAD] *(secondary, certified agency)* What is AIRC certification: https://upgradgsp.com/?p=24246
- [NACAC] NACAC commissioned agent series: https://www.nacacnet.org/knowledge-center/international/Commisioned_agent_series/
- [PIE-NACAC] *(secondary)* PIE News, NACAC amends code to improve transparency in agent use: https://thepienews.com/nacac-amends-code-of-ethics-to-improve-transparency-in-agent-use/
- [TITLEIV] *(institution guide)* UVM, federal ban on incentive compensation: https://www.uvm.edu/sites/default/files/Human-Resource-Services-and-Operations/HRSDocs/Class_and_Comp/incentivecompguide.pdf

**New Zealand**
- [NZ-INZ-ADV] Immigration NZ, providing immigration advice to students: https://immigration.govt.nz/assist-migrants-and-students/assist-students/understand-your-obligations/providing-immigration-advice-to-students
- [NZ-2011] Immigration Advisers Licensing (Partial Removal of Exemption) Regulations 2011: https://www.legislation.govt.nz/secondary-legislation/pco-drafted/2011/19/en/latest/
- [NZ-IAA] Immigration Advisers Authority, who needs a licence: https://www.iaa.govt.nz/for-advisers/adviser-tools/licensing-toolkit/who-needs-a-licence
- [NZ-CODE] University of Auckland, Tertiary and International Learners Code of Practice: https://www.auckland.ac.nz/en/about-us/about-the-university/statements-codes/tertiary-international-learners-code-of-practice.html
- [ENZRA] ENZ, discontinues recognised agency programme: https://www.enz.govt.nz/news-and-research/ed-news/enz-discontinues-recognised-agency-programme
- [NZ-VISA] *(secondary)* IDP, New visa rules 2026: New Zealand: https://www.idp.com/blog/visa-rules-for-international-students-newzealand
- [NZ-FTS] ENZ, Update from Immigration NZ (Apr 2026, Funds Transfer Scheme): https://www.enz.govt.nz/news-and-research/ed-news/update-from-immigration-new-zealand-8

**Practice, tools and the agency**
- [CRM-MONDAY] *(vendor)* monday.com, Education agent CRM: https://monday.com/blog/crm-and-sales/education-agent-crm/
- [STUDYLINK] *(secondary, 2012)* ICEF Monitor, Streamlining the student admissions process: https://monitor.icef.com/2012/11/streamlining-the-student-admissions-process
- [NEAS-EEVS] NEAS, Congratulations to Expert Education and Visa Services: https://neas.org.au/?p=26195
- [EKANTIPUR] *(secondary)* Kantipur, Expert services now available from New Zealand (Mar 2026): https://ekantipur.com/market/2026/03/25/en/expert-services-now-available-from-new-zealand-43-17.html
- [JIANGREN] *(secondary)* Company profile, Expert Education and Visa Services: https://jiangren.com.au/en/company/expert-education-and-visa-services

<!-- link definitions (make [KEY] citations clickable) -->
[ACE]: https://internationaleducation.gov.au/news/latest-news/Documents/Australian%20International%20Education%20and%20Training%20-%20Agent%20Code%20of%20Ethics.pdf
[STD1]: https://education.gov.au/node/11453
[STD4]: https://www.education.gov.au/download/11456/standard-4-education-agents/43665/document/pdf
[KAPLAN]: https://kaplan.edu.au/app/uploads/2022/07/agent-management-policy-and-guidelines-policy.pdf
[STD6]: https://internationaleducation.gov.au/Regulatory-Information/Education-Services-for-Overseas-Students-ESOS-Legislative-Framework/National-Code/nationalcodepartd/Pages/ExplanatoryguideD6.aspx
[STD7]: https://www.ccs.edu.au/wp-content/uploads/Current%20Policies/Transfer%20of%20Provider%20Policy.pdf
[TEQSA-COMM]: https://www.teqsa.gov.au/about-us/news-and-events/latest-news/education-agents-and-commissions
[JOINT-ALERT]: https://www.teqsa.gov.au/guides-resources/resources/sector-updates-and-alerts/joint-asqa-and-teqsa-sector-alert-compliance-concerns-about-overseas-student-transfers
[ASQA-ACT]: https://www.asqa.gov.au/node/550
[BAN-FACT]: https://www.education.gov.au/download/20049/ban-payment-agent-commissions-onshore-transfers/43677/document/pdf
[COMM-DATA]: https://www.education.gov.au/download/20661/agent-commissions-data-collection/45800/principal-executive-officer-fact-sheet/pdf
[ICEF-DATA]: https://monitor.icef.com/2026/02/australia-moving-to-wider-sharing-of-education-agent-data
[OMB-MIG]: https://ombudsman.gov.au/__data/assets/pdf_file/0029/287084/Commonwealth-Ombudsmans-submission-to-the-inquiry-into-the-regulation-of-Australian-migration-agents.pdf
[OMB-FACT]: https://www.ombudsman.gov.au/__data/assets/pdf_file/0033/79683/Factsheet_student_education-agents-links-fixed-A1576258.pdf
[OMB-2025]: https://www.ombudsman.gov.au/__data/assets/pdf_file/0012/323022/Submission-Inquiry-into-the-Education-Legislation-Amendment-Integrity-and-Other-Measures-Bill-2025.pdf
[OSO-2013]: https://www.ombudsman.gov.au/__data/assets/pdf_file/0008/30032/17-April-2013-Complaints-and-education-agents.pdf
[OSO-2017]: https://www.ombudsman.gov.au/__data/assets/pdf_file/0016/44620/5-April-2017-OSO-ICEF-Presentation,-Cairns.pdf
[PIE-TUFUTURO]: https://thepienews.com/australia-students-lose-1m-fraudulent-agency-tu-futuro/
[ISEAA]: https://www.homeaffairs.gov.au/reports-and-pubs/files/world-class-submissions/submission-international-student-education-agents-association.pdf
[MD115]: https://www.studyaustralia.gov.au/en/Agent-Hub/agent-news-index/ministerial-direction-115
[AU-FIN]: https://oneplanetmigrationlaw.com.au/immigration-blog/student-visa-500-financial-capacity-requirement-2026/
[AU-COST]: https://www.widen.com.au/student-visa-australia-cost-2026/
[AU-CHECK]: https://www.ahclawyers.com/news-articles/25/11/03/student-visa-subclass-500-document-checklist
[AU-HOP]: https://studyaustralia.gov.au/ar/tools-and-resources/news/changes-to-student-visa-applications-to-prevent-visa-hopping
[AU-COE-ONSHORE]: https://eiglaw.com/australia-changes-onshore-student-visa-applications
[WORK8105]: https://adelaide.edu.au/students/student-services/international-student/working-while-studying/
[MONASH-8202]: https://msa.monash.edu/services/support-services/finance-advice/international-student-matters/student-visa-restrictions/
[485]: https://myvisa.com.au/immigration-guides/485-visa-requirements-2026-eligibility-streams-english-age-limits
[SA-PREDEP]: https://www.studyaustralia.gov.au/en/plan-your-move/preparing-to-travel
[GORDON]: https://www.thegordon.edu.au/sitedocs/international/international-student-pre-departure-guide.aspx
[AGENT-HUB]: https://www.studyaustralia.gov.au/en/Agent-Hub/agent-support
[AAERI]: https://thekoalanews.com/aaeri-launches-agent-training-course-with-openlearning
[AEATC]: https://www.icef.com/academy/courses/education-agent-training-course-eatc/
[IATC]: https://www.icef.com/agent-training/icef-agent-training-course-iatc/
[IATC-SEARCH]: https://www.icef.com/academy/about/
[UK-ICEF-COURSE]: https://www.icef.com/academy/courses/uk-agent-and-counsellor-training-course
[BC-SA]: https://saudiarabia.britishcouncil.org/en/study-uk/become-uk-agent-or-counsellor
[BC-GH]: https://www.britishcouncil.org.gh/Become-a-UK-agent-or-counsellor
[CA-COURSE]: https://caps-i.ca/agents/canada-course-for-education-agents/
[ICEF-AQF]: https://monitor.icef.com/2025/07/how-the-uks-agent-quality-framework-will-shape-the-future-of-agent-training
[UKCISA-AQF]: https://www.ukcisa.org.uk/our-work/working-with-agents/
[BUILA-NEW]: https://www.buila.ac.uk/articles/agent-quality-framework-strengthened-by-new-course-for-agencies
[UUKI-CODE]: https://universitiesuk.ac.uk/sites/default/files/uploads/UUKi/Documents%20-%20misc/National%20Code%20of%20Ethical%20Practice%20for%20UK%20Education%20Agents.pdf
[BC-GUIDE]: https://www.britishcouncil.org/sites/default/files/student_and_parent_guide_to_choosing_an_education_agent.pdf
[COVENTRY]: https://www.coventry.ac.uk/partner-hub/agent-requirements/
[STAFFS]: https://www.staffs.ac.uk/international/your-application-journey/uk-agent-quality-framework-aqf
[OISC-UKCISA]: https://moodle.ukcisa.org.uk/course_files/ui_2015/introduction-to-immigration/6a.html
[NORTHUMBRIA]: https://corp.northumbria.ac.uk/study-at-northumbria/support-for-students/international-student-support/immigration-advice-and-oisc
[UK-FUNDS]: https://www.otssolicitors.co.uk/news/student-visa-maintenance-funds-increase-from-30-november-2026/
[BCA]: https://doyleclayton.co.uk/stricter-sponsor-compliance-standards-for-student-sponsors/
[GRAD]: https://www.idp.com/blog/visa-rules-for-internaional-students-uk
[PRECAS-UWE]: https://www.uwe.ac.uk/courses/international-study/visas/applying/pre-cas-interviews
[CHESTER]: https://www.chester.ac.uk/media/media/documents/guides/A-Guide-to-Credibility-Interviews---January-2026-(1).pdf
[UK-DEP]: https://www.ukcisa.org.uk/student-advice/visas-and-immigration/student-route-bringing-your-family/
[PIE-DEP]: https://thepienews.com/news/international-masters-students-banned-dependants-uk/
[UK-TB]: https://www.gov.uk/tb-test-visa/countries-where-you-need-a-tb-test-to-enter-the-uk
[ATAS]: https://www.kent.ac.uk/student-immigration/atas
[UK-EVISA]: https://www.internationalstudents.cam.ac.uk/node/302
[IRPA91]: https://ccrweb.ca/sites/ccrweb.ca/files/2025-05/Section_91_IRPA_IRCC_Questions_and_Answers_May2025.pdf
[ICEF-C35]: https://monitor.icef.com/2012/06/how-canadas-bill-c-35-affects-education-agents/cic-c35-summary
[IRCC-REP]: https://www.canada.ca/en/immigration-refugees-citizenship/services/protect-fraud/study-permit-fraud.html
[KPU]: https://kpu.ca/international/agents/for-students
[CA-2026]: https://bridgepointlaw.ca/canada-study-permit-pgwp-complete-guide-2026/
[PGWP]: https://www.cicnews.com/2026/01/ircc-freezes-list-of-pgwp-eligible-fields-of-study-for-2026-0167305.html
[LOA]: https://www.canada.ca/en/immigration-refugees-citizenship/corporate/transparency/committees/cimm-dec-05-2023/letter-acceptance-verification.html
[SDS]: https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/temporary-residents/study-permits/direct-stream.html
[CA-REFUSE]: https://www.tribuneindia.com/news/diaspora/canadas-student-visa-crackdown-indias-rejection-rate-soars-to-74-in-2025/amp
[PAL-BC]: https://www2.gov.bc.ca/gov/content/education-training/post-secondary-education/international-education
[US-F1]: https://www.shorelight.com/student-stories/student-visa-usa-f1
[VIF]: https://www.bu.edu/isso/2026/05/19/visa-integrity-fee/
[AIRC]: https://airc-education.org/agency-standards
[AIRC-CERT]: https://www.airc-education.org/certification
[AIRC-UPGRAD]: https://upgradgsp.com/?p=24246
[NACAC]: https://www.nacacnet.org/knowledge-center/international/Commisioned_agent_series/
[PIE-NACAC]: https://thepienews.com/nacac-amends-code-of-ethics-to-improve-transparency-in-agent-use/
[TITLEIV]: https://www.uvm.edu/sites/default/files/Human-Resource-Services-and-Operations/HRSDocs/Class_and_Comp/incentivecompguide.pdf
[NZ-INZ-ADV]: https://immigration.govt.nz/assist-migrants-and-students/assist-students/understand-your-obligations/providing-immigration-advice-to-students
[NZ-2011]: https://www.legislation.govt.nz/secondary-legislation/pco-drafted/2011/19/en/latest/
[NZ-IAA]: https://www.iaa.govt.nz/for-advisers/adviser-tools/licensing-toolkit/who-needs-a-licence
[NZ-CODE]: https://www.auckland.ac.nz/en/about-us/about-the-university/statements-codes/tertiary-international-learners-code-of-practice.html
[ENZRA]: https://www.enz.govt.nz/news-and-research/ed-news/enz-discontinues-recognised-agency-programme
[NZ-VISA]: https://www.idp.com/blog/visa-rules-for-international-students-newzealand
[NZ-FTS]: https://www.enz.govt.nz/news-and-research/ed-news/update-from-immigration-new-zealand-8
[CRM-MONDAY]: https://monday.com/blog/crm-and-sales/education-agent-crm/
[STUDYLINK]: https://monitor.icef.com/2012/11/streamlining-the-student-admissions-process
[NEAS-EEVS]: https://neas.org.au/?p=26195
[EKANTIPUR]: https://ekantipur.com/market/2026/03/25/en/expert-services-now-available-from-new-zealand-43-17.html
[JIANGREN]: https://jiangren.com.au/en/company/expert-education-and-visa-services
