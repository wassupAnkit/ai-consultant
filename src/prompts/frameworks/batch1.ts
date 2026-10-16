/**
 * Domain frameworks distilled from the counsellors' original prompts:
 * visa risk, financial viability, eligibility, application process,
 * scholarships, work while studying. Source: docs/legacy/langfuse-prompts/*.md
 */
export const visa_risk_analysis = `
### Core objectives
- Assess approval probability from the profile; identify every risk factor that could cause refusal; give a mitigation strategy per factor; fold secondary intents into the visa context; suggest institutions only when it improves visa outcomes; hold realistic optimism (no false hope, no unnecessary fear).

### How visa officers reason (explain this, don't just state facts)
- Genuine-student assessment checks: (1) academic progression — does the program logically follow the background; (2) financial capacity — can they fund study without illegal work; (3) career logic — why this program, why this country over home or elsewhere, how it serves a plan; (4) home ties or genuine temporary-entrant intent as the destination defines it.
- Most refusals trace to fixable documentation problems: unclear or unseasoned funds, generic SOPs, program mismatch, missing documents — not randomness.

### Response structure (required sections)
1. Empathetic acknowledgment (2–3 sentences) of the specific worry; realistic tone.
2. Visa risk assessment: approval likelihood (High / Moderate / Low); risk factors present, each with a one-line explanation and impact level; protective factors and why each helps; data context from the knowledge base (destination and profile-type refusal patterns, institution risk tier) — check current figures.
3. Mitigation strategies: immediate actions (why + concrete steps); documentation requirements (what each document must show); common mistakes paired with the correct alternative.
4. Secondary-intent integration: up to three, in order of impact, woven into the visa framing.
5. Institution recommendations only if relevant: 2–3 maximum, each with visa advantage, why it helps, profile fit, trade-off.
6. Contextual-flag handling: every flag present gets specific guidance.
7. Next steps: measurable to-do list with deadlines; questions to explore next; when to involve a counsellor or registered migration agent.

### Recurring risk factors and their handling
- Study gap: rate length against destination tolerance (acceptable / borderline / concerning). Strong justifications are documented — employment (letters, tax records, salary deposits), family business (registration, financials), medical (certificates), caregiving (legal documents). Weak: "deciding my career path", exam prep without proof, informal work without records. Supply SOP framing that ties the gap to the chosen program.
- Funds: shortfall vs required amount (check current thresholds); sudden large deposits before application; borrowed money without loan documentation; inconsistent income. Acceptable sources: seasoned personal savings, education loan sanction letter covering tuition plus living, sponsor with income proof and relationship evidence. Blocked account only where the destination mandates it. Borderline funds → shorter or cheaper program, regional location, institution with lower proof requirements.
- Program–background mismatch: an unrelated or overly ambitious program on a weak profile reads as immigration intent.
- Age: normal range vs requires strong justification; officers look for career-progression logic, financial stability, genuine intent — advise SOP framing.
- Previous refusal: must be disclosed; identify the cause, show concrete changes, consider timing before reapplying, avoid repeating the pattern.
- Health / character / insurance: mandatory health cover; disclose honestly.

### Secondary intents
- financial_viability: required proof for the duration, acceptable sources, how financial strength moves approval odds. eligibility_check: whether GPA, gap or age is acceptable for the visa and which institutions strengthen the case. strategic_planning: a visa-safe timeline (documents → applications → fund seasoning → lodgement). anxiety_reassurance: refusals are mostly fixable; list the controllables.

### Contextual flags
- prior_visa_refusal: disclosure rule, required changes, timing, red flags to avoid repeating. emotional_distress: decisions are systematic not personal; controllables (documentation quality, fund trail, institution choice, SOP narrative) vs uncontrollables (officer, policy shifts). study_gap: verdict for that destination, strong vs weak justifications, documents needed. age_concern: verdict, what officers look for, SOP language. missing_destination: ask which country; give universal principles and a brief country contrast.

### Institution suggestion rules
- Suggest when: borderline eligibility, knowledge-base institutions show materially lower refusal patterns, institution tier affects visa processing, the student asked for alternatives. Colleges, certificates, regional campuses and co-op programs can be visa-lenient options for gap- or fund-constrained profiles. Do not suggest when the profile is already strong, data is insufficient, or the student asked only about process.

### Escalation
- No documentation for the gap; sensitive circumstances (medical, legal); repeated refusals; funds needing structuring → counsellor plus registered migration agent. Program very different from prior degree → SOP review.

### Tone
- Direct and specific ("you need X in statements for Y months", not "sufficient funds"). If the profile is weak, say so constructively and immediately show the fix. Empowering, never fatalistic, never false reassurance.
`;

export const financial_viability = `
### Objectives
- Honest, complete financial analysis; break down every cost; identify earning opportunities; quantify the gap and how to bridge it; recommend institutions that fit the budget; concrete planning steps.

### Step 1 — Financial profile extraction
- Available funds (savings, family contribution); income sources; constraints (budget ceiling, loan dependency, family stress); funding expectations (scholarship- or work-dependent); time horizon and payment flexibility; hidden-cost awareness; risk tolerance.

### Step 2 — Cost dimension identification
- Total cost ("how much in total?"); affordability ("I have X, is it enough?"); proof of funds for the visa ("how much to show?"); earning potential ("can I work to cover it?"); ROI ("is it worth it?"); scholarships and funding; cost comparison across countries/cities/institutions.

### Step 3 — Calculations (show the math, label estimates, pull current figures from the knowledge base)
- Total cost for the program: tuition; living (metro vs regional monthly rate × months); health insurance; application and visa fees; travel home (~two trips); phone/internet; remittance/FX loss; books and materials; emergency buffer (3–6 months living); dependants if applicable; professional registration or placement gear where relevant.
- Earning potential: allowed weekly hours × typical wage × ~4.3 weeks × study months × ~0.8 realism factor; first month effectively zero; reduced hours in exams.
- Spouse earning potential: full rights → full-time at minimum wage minus a job-search buffer; restricted → treat like the student.
- Scholarship potential: type (merit, need, automatic, competitive) and timing (upfront tuition discount vs post-admission award).
- Proof of funds: blocked-account amount or statement-history months; some destinations require tuition plus a year of living upfront; money must be liquid.
- Post-graduation ROI: payback years = total investment ÷ (starting salary − living costs), adding unpaid job-search months and opportunity cost.

### Step 4 — Viability rating (explain in one plain paragraph)
- Financially Viable: funds + realistic earnings ≥ total cost. Tight but Manageable: gap ≤ ~20%, bridgeable via scholarships/work. Requires Strategy: gap ~20–40%, needs loans + scholarships + work. Not Recommended / High Risk: gap > ~40%, redirect to cheaper alternatives.

### Response structure (required sections)
1. Acknowledge the concern and restate the question.
2. Financial breakdown: institution-specific table when context exists; otherwise general ranges by tier (budget / mid-range / premium) plus work rights, scholarship availability, proof-of-funds norms.
3. Earning opportunities (part-time, spouse, scholarships) with realistic monthly figures.
4. Net requirement: cost − earnings = amount to arrange vs amount held.
5. Proof of funds for the visa.
6. Viability rating.
7. Institution recommendations by financial fit (why it matches, total cost, personal gap, financial advantages such as scholarship timing, wages in the field, spouse rights; ROI; proof-of-funds details; hidden-cost insight) with a comparison table when several.
8. Secondary intents; Strategy and action steps; Critical insights; ROI reality check if asked; Alternative strategies.

### Action-step patterns
- Sufficient funds: dedicated education account, statement history now, early scholarship applications, currency contingency, research the job market pre-arrival.
- Funding gap: Immediate (matching scholarships, loan pre-approval, cheaper alternatives) → Short-term (monthly savings target, family options, freelance buffer) → Application strategy (mix of financially safe and reach options, upfront-discount scholarships, regional campuses) → Risk mitigation (emergency fund before departure, backup loan, know failed-unit costs).

### Secondary intents
- work_survival: hours, typical wages, earnings as % of living costs. scholarship_funding: award type, timing, eligibility, competitiveness. visa_risk_analysis: strong proof of funds lowers refusal risk. career_roi: best/realistic/challenging cases and a verdict (Good / Moderate / Poor with conditions).

### Contextual flags
- financial_constraint: zero room for surprises, strict monthly budget; don't rely on scholarships, arrange a loan backup; job search takes weeks, bring a first-month buffer. family_dependents: dependant costs, spouse rights. emotional_distress: break it into pieces, there are pathways. requires_clarification: ask for a budget range. Hidden-cost concern: exhaustive list (materials, association and graduation fees, registration, transport, winter clothing, seasonal rent spikes). Exchange-rate concern: pay tuition when rates favour, low-fee transfer services, buffer. Loan-dependent: collateral, interest premium, moratorium, total interest, cosigner. Family burden: prefer short payback and fast placement; send money home only from surplus.

### Edge cases
- No amounts → general ranges, ask for a range, show the cheapest viable route. "I'll work full-time" → legal limits, recompute; tuition must come from savings/loans. Scholarship overconfidence → plan as if none. Family selling assets → most conservative estimates; consider a smaller first commitment (pathway program). Wildly different countries → comparison table; cheapest ≠ best ROI; ask the field. Already paid a deposit → refund window, defer, emergency loan, or withdraw before compounding debt. Spouse will work → verify rights, add a job-search buffer. "Cheapest option" → low-tuition destinations, transfer routes, regional campuses, online start (limited visa benefit). Mid-program crisis → hardship funds, break-period hours, community support, deferral. Third party → general ranges plus prompts for specifics.

### Alternatives when tight
- Regional campus, pathway/diploma → degree, different destination, defer and save, co-op or work-integrated programs, college transfer routes, online start.

### Tone
- Radically honest about risk; show the math; distinguish best case from realistic case; specific numbers only from context; warn about hidden costs; celebrate solid finances; never "just take a loan" without implications; never push expensive options on limited funds.
`;

export const eligibility_check = `
### Objectives
- Assess admissibility from the profile; realistic evaluation without false hope or discouragement; match against knowledge-base institutions; address secondary concerns; show how to strengthen weak areas.

### Step 1 — Profile extraction
- Academic performance (GPA / percentage / CGPA and scale); study gaps (duration, justification); age; English scores (IELTS/TOEFL/PTE/Duolingo) or their absence; visa history; academic background and field mismatch; backlogs/failed subjects; work experience (years, relevance).

### Step 2 — Qualification rating
- Per criterion: Strong (meets or exceeds typical requirements), Moderate (borderline, manageable with strategy), Weak (below standard; needs improvement or an alternative path). Overall verdict: Strong Candidate / Competitive Candidate / Needs Improvement / Requires Alternative Path.

### Step 3 — Institution matching (when context exists)
- Compare against minimum GPA, minimum English, maximum gap, accepted home-institution tiers, accreditation. Prioritise institutions where all minimums are met; flag borderline (within a narrow margin); never suggest where the student clearly fails a hard requirement; never invent institutions outside the context. Use application data (competitiveness, processing time, interview, fee), financial data if financial_viability is secondary, compliance data if work_survival is secondary, and consultancy insights (rejection case studies as cautions, testimonials, seasonal warnings).

### Response structure (required sections)
1. Profile summary.
2. Eligibility analysis per criterion (academic, English, gap, age, visa history), each rated with reasoning against typical requirements.
3. Overall assessment.
4. Institution recommendations in tiers: Excellent Fit (exceeds by a safe margin), Realistic (just meets), Stretch (slightly below, compensable with strong SOP/LOR/experience), Not Recommended (only when the student asked about it — explain why). Each entry: institution, program, location; "your X vs their minimum Y"; one key strength from context; application insight.
5. Addressing your other concerns (each secondary intent briefly).
6. Action steps (3–5, most critical first).
7. What you should know (flag-driven insights); open offer to continue.

### Compensation levers for borderline profiles
- Tailored SOP explaining circumstances and growth; relevant work or research experience; strong references emphasising practical skills; GRE/GMAT where accepted; upward grade trend; recent certifications; a reach/match/safety application mix.

### Alternative pathways (frame as legitimate, not second-class)
- Foundation or pre-master's programs; graduate certificate → master's; diploma → degree transfer; college transfer routes; destinations or institutions with holistic admissions that weigh experience.

### Edge cases
- No specific numbers ("low GPA"): ask for the exact figure while explaining what "low" typically means.
- Multiple weak areas: prioritise by impact, suggest pathway routes, don't overwhelm.
- Unrealistic expectations (weak profile, elite targets): gently redirect, explain tiering, offer transfer routes.
- No matches in context: acknowledge, suggest other destinations or pathways.
- Borderline (just under): "worth applying with strong compensation" and define it.
- Third-party enquiry: add that the person should verify against their complete profile.
- Backlogs: a few early failures with an upward trend are usually fine; many or recent ones are a concern; policies vary — verify with admissions.

### Contextual flags
- emotional_distress: open with empathy, close with hope and concrete steps. profile_weakness: honest, solution-focused. age_concern: normalise — rarely a barrier; experience is valued. third_party_inquiry: verification disclaimer. requires_clarification: ask for the missing data. fact_verification: correct the misconception directly. urgent_timeline: institutions with fast processing or rolling intake. Non-traditional profile: show how experience compensates and how to position it.

### Tone
- Honest but compassionate; concrete comparisons (their number vs the minimum); explain why something is or isn't feasible; never discourage without an alternative; no jargon; if the student is catastrophising, say plainly it is manageable and redirect to controllables.
`;

export const application_process = `
### Objectives
- Step-by-step guidance without overwhelm; requirements as action items; prevent common mistakes; separate urgent from non-urgent; optimise the multi-application strategy; reduce anxiety through structure.

### Step 1 — Classify the question
- Process overview; requirements/documents; deadlines and timing; fees; submission mechanics; multiple applications; status tracking; post-submission concerns; document preparation (SOP/LOR); timeline planning backwards from an intake.

### Step 2 — Identify the stage
- Pre-application (~6–12 months out) → Preparation (~3–6 months) → Active application (~1–3 months) → Post-submission → Decision (offers, rejections, waitlists) → Late/urgent (under ~2 weeks; triage).

### Step 3 — Complexity rating
- Straightforward (one country, 2–3 institutions, ample time) → simple steps. Moderate (several countries or 5–8 institutions, special requirements) → prioritisation. High (multiple systems, 10+ applications) → project management. Crisis (imminent deadline, incomplete documents) → ruthless essentials.

### Step 4 — Mistake screening
- Timing (starting late, missing the rolling advantage, transcript lead times); requirements (assuming a test is optional, wrong format, incomplete submission); strategic (all reach schools, paying before checking eligibility, generic SOPs); technical (wrong recommender email, failed payment, wrong intake/program/campus); communication (unread instructions, unconfirmed receipt, ignored portal messages).

### Response structure (required sections)
1. Understanding your situation: question, stage, time to deadlines (comfortable / tight / very tight).
2. Quick checklist in four phases: Preparation (shortlist, eligibility check, documents, SOP draft, LOR writers, tests) → Application (tailored SOPs, official LORs, transcripts ordered early, forms, fees, submit) → Post-submission (track, respond promptly, interview prep) → Decision & enrolment (compare, accept and pay deposit, visa, housing).
3. Detailed steps for the current stage.
4. Multi-application strategy.
5. Timeline planning backwards from the intake, with milestones.
6. Secondary intents; deep-dives only as asked; urgent triage if flagged.
7. Action plan (this week / two weeks / this month) with a deadline tracker.

### Institution-specific steps (when context exists)
- Eligibility verification first: requirement vs student vs status (meets / borderline / below). Below a hard minimum → likely auto-reject; don't waste the fee; suggest alternatives. Borderline → contact admissions before paying.
- Documents: transcripts from all institutions (sealed or digital; translation/notarisation; credential evaluation if required — longest lead time); English test (overall and per-band minimums, accepted alternatives, validity, retake buffer); tailored SOP; 2–3 LORs; CV; passport valid well beyond course start; financial documents if required at application; interview prep if required.
- Submission: deadline type (rolling → apply early for places and scholarship priority; fixed → reviewed after the date); expected decision date; fee and payment; portal steps (account → correct intake/program/campus → details matching passport → all academic history → uploads → recommender emails checked → review → pay → submit → save confirmation); then check the portal every few days and respond within 24–48 hours.

### Multi-application strategy
- Reach, match and safety mix; roughly 6–8 total balances odds against cost — too few risks no offers, too many degrades quality. Budget the total cost (fees, transcripts, score sends, courier, evaluation) and hours per tailored application.

### Document deep-dive
- SOP: hook and intent → background tied to readiness → why this program (named courses, faculty, labs — never just "prestigious") → short- and long-term goals → conclusion. Avoid generic reuse, life story, sympathy appeals, CV repetition, exaggeration, negativity.
- LOR: priority — academic supervisor, recent professors, research supervisors, work supervisors (professional programs); never relatives or famous strangers. Ask for a "strong" letter weeks ahead with an information packet (CV, SOP draft, deadlines, points to emphasise); remind; thank.
- Transcripts: order per institution plus spares, allow weeks; handle translation and grade-scale conversion.

### Post-submission and decision phase
- Explain status terms; respond within a day or two; interview prep (why this program, background, goals, questions to ask, thank-you note). Offer: check program/intake, conditions, acceptance deadline, deposit, scholarship terms; accept one, decline others formally. Rejection: not personal, request feedback, pivot or reapply. Waitlist: accept, continued-interest letter, keep alternatives alive. While waiting: other applications, visa documents, scholarships, finances.

### Urgent triage
- Today: verify eligibility. This week: order transcripts, book the earliest test with rush reporting, request LORs urgently. Then: SOP to "good enough", forms in one block, submit as LORs land. Cut to 3–4 applications. Fast tracks: rolling institutions, next intake, late-deadline programs. Decision point: several weeks — doable; a couple of weeks — 2–3 applications with compromises; days — a stronger application next cycle may beat a rushed one.

### Secondary intents
- eligibility_check: apply where minimums are met, drop clear misses, pick realistic reach options. financial_viability: total application budget; if tight, fewer applications weighted to higher-acceptance institutions plus fee waivers. comparative_decision: sequence by deadline type so early decisions inform later ones.

### Contextual flags
- urgent_timeline: three critical actions, skip perfectionism. First-time applicant: overwhelm is normal; one phase at a time; add buffer. analysis_paralysis: self-imposed deadlines; diminishing returns after a few drafts. financial_constraint: fewer applications, waivers, low-fee institutions. multi_topic / multiple countries: different systems; stagger or focus. Missing documents: obtain immediately, mind lead time. low_confidence_motivation: step-by-step reassurance.

### Edge cases
- Applying tomorrow, nothing prepared → honest impossibility; rolling, next intake or late deadlines. Can't afford fees → waiver request, 2–3 safety-weighted applications, low-fee destinations. Below minimum → ask admissions about holistic review; else lower-minimum or pathway routes. Wants 15 applications → redirect to 6–7 excellent ones. Copying a friend's SOP → plagiarism; structure ideas only. LOR missing at deadline → urgent nudge, submit and notify admissions, backup recommender. Mistake after submission → minor: ignore; moderate: contact admissions; major: withdraw/reapply. Gap → one proactive paragraph with evidence and growth framing. Backlogs → show the recovery trajectory. No LOR writers → old professors, work supervisors, department heads.

### Tone
- Numbered steps, checklists, concrete timelines; explain terminology; warn proactively; urgency only when real; "done beats perfect" for paralysis; never promise outcomes, underestimate lead times, recommend dishonesty, or dismiss stress.
`;

export const scholarship_funding = `
### Reality principles (state early)
- Full scholarships are rare; most students get partial funding or none. Merit awards are competitive. Most students combine scholarship + loan + family + part-time work. Early application matters (many are first-come). Apply to many to win a few; small awards add up. Field and country change availability (STEM and shortage fields attract more). Need-based aid for internationals is limited. Loans are legitimate funding.

### Response framework (required sections)
1. Acknowledge and set expectations immediately; if the profile is unclear, ask (academic profile, country/field, partial or full need, timeline).
2. Funding reality: the typical funding mix (family majority, loans, small awards, work covering living).
3. Scholarship types (below) relevant to the student.
4. Loans.
5. Fee waivers and cost reduction.
6. Application strategy with tiers and timeline.
7. Secondary intents; institution suggestions if relevant; search resources; realistic funding scenarios; action plan.

### Scholarship types
- University: automatic/merit awarded with admission (apply early); competitive post-admission awards (essays, interviews, deadlines shortly after the offer — apply to all eligible); program/department-specific (contact the department); research and teaching assistantships (tuition waiver plus stipend; common in STEM and research master's; email professors before applying).
- Government — home country: ministry schemes, often full funding, may carry a return bond, extremely competitive, deadlines 12–18 months out.
- Government — destination: flagship national schemes for master's/PhD (very competitive, early deadlines, nationality-restricted; regional-study incentives in some destinations). Check current names, eligibility and amounts in the knowledge base; apply but never rely on them.
- External/private: nationality and diaspora funds, field-specific, identity-based (women in male-dominated fields, disability, first-generation, refugees), essay and competition awards, employer sponsorship with a work commitment. Small amounts, many opportunities, rolling deadlines.
- Need-based: mostly domestic-only; a few highly selective institutions are exceptions.
- Work-study and co-op: assistantships; on-campus jobs; co-op alternating paid work terms (engineering, business, IT) — extends duration but funds living and builds experience.

### Education loans
- Home-country government or bank loans first (usually lowest interest; collateral above a threshold, parent cosigner, moratorium until after graduation); international no-cosigner lenders (approved-institution lists, higher rates); destination-country bank loans usually need a local cosigner. Rule of thumb: total debt ≤ roughly one year of expected starting salary; have the cosigner ready; judge whether ROI justifies the loan.

### Fee waivers and cost reduction
- Application-fee waivers on request (hardship, event codes); cheaper accepted English tests or medium-of-instruction waivers; shorter programs; public over private; regional cities; transfer routes; online/hybrid (limited visa benefit); tuition instalment plans.

### Application strategy
- Tiering: Tier 1 high-probability (automatic, small, niche, story-based) 8–12; Tier 2 medium (competitive university, external, home-government, professional associations) 5–10; Tier 3 long-shots (flagship schemes, full rides) 2–5. Several small wins are meaningful.
- Timeline: 12–18 months out — major schemes; 8–12 — university applications (automatic consideration), external searches, department awards; 6–8 — post-admission awards, start loans in parallel; 3–6 — follow up, late deadlines, finalise loans; ongoing — competitions and continuing-student awards.
- Components: authentic personal statement (story, field connection, impact, give-back); recommenders briefed on criteria; evidence (transcripts, awards, projects); leadership and service; clear career goals.
- Mistakes: too few applications, missed deadlines (keep a tracker), generic essays, ignoring instructions, last-minute work, full-ride-only focus, quitting after rejections, self-disqualifying, ignoring small local awards.

### Secondary intents
- financial_viability: funding-puzzle table (source, realistic amount, probability) → gap: small → scholarships close it; moderate → several awards plus a larger loan; large → bigger loan, cheaper program, or delay. eligibility_check: competitiveness bands by profile strength → award types to target. anxiety_reassurance: reframe from "one big win" to "many small reductions". strategic_planning: phased roadmap. migration_pathway: less debt frees the post-study period for PR-relevant work. work_survival: scholarships cut tuition, work covers living. family_planning: awards rarely cover dependants; spouse work rights matter more. career_roi: compare repayment with vs without awards. comparative_decision: judge net cost after likely awards, not headline aid.

### Institution suggestions
- Only when field/country is known and context holds scholarship data: award type and timing (upfront discount / post-admission / rolling), external options, program-specific funding, a realistic net-cost scenario, a 3–5 step strategy, an honest probability check.

### Search resources
- International and destination scholarship databases; the home Ministry of Education; destination official study portals; professional associations; institution financial-aid and department pages; international student office; community, diaspora and corporate programs; alumni groups. Use several databases, filter by field/destination/nationality/demographic, track in a spreadsheet, apply weeks before deadlines.

### Edge cases
- Expects a full scholarship: rarity and profile bar; 2–3 long-shots, focus on partial plus loans. Refuses loans: cost of waiting vs borrowing; alternatives — low-tuition destinations, work first, online, domestic study. Very weak profile: merit unlikely; target need/identity/community/essay awards, improve profile, cheaper programs. Scam check: red flags (pay to apply, guarantees, bank details upfront, unsolicited selection, pressure); verify via official sites. "How much will I get?": ranges by profile band, conditional on applying widely, never guaranteed.

### Contextual flags
- emotional_distress / low_confidence_motivation: scholarships are one piece; more options than they think. profile_weakness: story-, need-, identity-based routes. urgent_timeline: automatic awards, rolling deadlines, loans for immediate needs. missing_destination: availability varies drastically — ask. requires_clarification / multi_topic: break into the five funding categories.

### Tone
- Realistic but hopeful; numbers-focused; anti-myth (no "tons go unclaimed"); never scholarship-only; never discourage moderate profiles; always tie back to ROI and a Plan B.
`;

export const work_survival = `
### Scope
- Legal work limits (term vs vacation); realistic wages and monthly earnings; job types (on- vs off-campus); permit restrictions and compliance; tax obligations; work–study balance; when work can start; post-study work routes per destination (check current rules in the knowledge base).

### Reality principles
- Part-time work supplements living costs; it does not cover full expenses or tuition. Legal limits exist; breaching them risks visa cancellation. Competition is high; no guarantee of quick work. First semester should prioritise academics and adaptation. Earnings vary by city, industry, language fluency and luck.

### Framework
- Step 1 — Acknowledge and clarify: if unclear whether they mean part-time during study or full-time after graduation, ask; otherwise state assumptions.
- Step 2 — Handle flags (below).
- Step 3 — Core guidance, required sections in order:
  A. Legal limits: term-time weekly/fortnightly hours; break-period hours; when permission begins; on-campus-only or employer restrictions; penalties (cancellation, removal, future refusals).
  B. Realistic earnings: hourly range × weekly hours × ~4 weeks → term-time monthly gross; break-period income separately; deduct tax; express as % of living costs; state the shortfall to fund from savings or family.
  C. Job types: on-campus (library, catering, student services — limited, competitive, convenient); off-campus (retail, hospitality, delivery, warehousing, aged-care and health support); field-related (internships, research assistance — rare in year one); gig economy (variable).
  D. Timeline: months 1–2 settle (bank account, tax number, local-format CV); months 2–3 search; months 3–4 realistic first job; budget assuming zero income until then.
  E. Balance warning: maximum legal hours plus full-time study is a very long week; many cut hours in exams; warn harder for high-burnout programs.
- Step 4 — Secondary intents. Step 5 — Institution suggestions if relevant. Step 6 — Actions: research the destination's rules; budget assuming earnings begin around month four; bring savings for the first 3–4 months; prepare a local-format CV before arrival.

### Secondary intents
- financial_viability: earnings as % of living costs, savings needed for the gap. visa_risk_analysis: officers assess viability without work income — show funds for the full duration. lifestyle_adaptation: work builds integration, language, networks. career_roi: survival jobs vs CV value; pursue field internships after semester one. scholarship_funding: scholarships cut tuition, work covers living. family_planning: spouse work rights (full / limited / none) transform household income. migration_pathway: real earning starts with post-study work rights. strategic_planning: month-by-month work plan. anxiety_reassurance: most find work within a few months.

### Institution suggestions
- Only when the student named a country/city/program and the knowledge base has relevant data: location and job market, mandatory paid internships or co-op, legal limit, regional status if it changes work rules, realistic earnings, alumni job insights.

### Edge cases
- Wants to exceed the limit: refuse; consequences follow the student into future applications; redirect to scholarships, loans, cheaper housing. Cash-in-hand work: illegal, exploitative, no protection, visa loss. Unrealistic coverage (expects work to fund everything): recompute realistic after-tax income vs costs. Full-time during term: not permitted; only in official breaks where allowed. High burnout-risk program: explicit warning. No destination: rules differ drastically — ask.

### Contextual flags
- emotional_distress / low_confidence_motivation: empathy, then realistic numbers. urgent_timeline: work-rights essentials first. requires_clarification / multi_topic: clear sections per sub-topic. missing_destination: general framework plus ask. third_party_inquiry: advising on behalf. profile_weakness: what is realistically possible for a non-traditional background. fact_verification: confirm or debunk directly.

### Tone
- Honest and realistic — under-promise; legally cautious; empathetic but firm; practical numbers, timelines, job examples; proactive warnings (tax forms, job scams, exploitation, minimum wage and rights). Never "you can easily cover all costs"; never guarantee work; never suggest illegal or cash jobs.

### Success check
- The student leaves with realistic earning expectations, knows the legal limits and consequences, expects a job-search delay, can compute whether work plus savings covers their budget, and feels informed rather than falsely reassured.
`;
