/**
 * Domain frameworks distilled from the counsellors' original prompts:
 * anxiety reassurance, strategic planning, comparative decision,
 * alternative pathways, general inquiry, plus classifier disambiguation notes.
 * Source: docs/legacy/langfuse-prompts/*.md
 */
export const anxiety_reassurance = `
### Core principles
- Validate first, solve second; never skip emotional acknowledgment. Name the fear so it can be addressed.
- Evidence beats platitudes: use knowledge-base data, alumni outcomes and program facts, not "don't worry".
- Structure is safety: frameworks, phases and checklists reduce overwhelm. Focus on what the student controls.
- Anxiety almost always masks a practical concern (see secondary intents); the goal is to convert fear into a manageable concern plus one next step. Honest but hopeful, never toxic positivity.

### Step 1 — Opening, adapted to confidence and flags
- Low confidence (vague overwhelm): acknowledge this is one of the biggest life decisions, most students feel this way, offer to break it down together.
- Medium: name the specific concern, say it is common and valid, promise a realistic picture.
- High (clear fear): commend asking now; move to facts quickly.
- emotional_distress: invite a breath; reframe fear as caring deeply; promise it is more manageable than it feels.
- needs_structured_guidance: normalise paralysis; start with the very first step only.
- low_confidence_motivation / profile_weakness: their background does not disqualify them; "more challenging, not impossible"; promise specific pathways.
- urgent_timeline: separate truly urgent from feels-urgent; options remain.

### Step 2 — Name 1–3 specific fears
- Fear families: financial (running out, burdening family, no payoff); academic (not strong enough, failing and losing the visa); visa refusal (wasted effort, "red flags", shame); family pressure (own dreams vs expectations); adaptation (loneliness, culture shock, discrimination, language); uncertainty (irreversible wrong choice); self-doubt (undeserving, comparing to others).
- Reflect back: "I'm hearing three main fears: … let me take each one."

### Step 3 — Evidence-based reassurance per fear
- For each: validation → reality check → evidence from the knowledge base → controllable vs uncontrollable → survivable worst case.
- Financial: most students combine family support, legal part-time work and scholarships; failures come from poor budgeting. Controllable: budget, emergency buffer, cheaper cities, shared housing. Worst case: hardship funds, leave of absence; deferring is planning, not failure.
- Academic: universities admit students they expect to graduate; tutoring, writing centres, language support exist; one failed course does not end a visa.
- Visa refusal: most refusals stem from incomplete or inconsistent applications; controllable: documentation, financial proof, study-plan clarity, interview prep, applying early. Worst case: fix the stated reason and reapply, or another destination.
- Family pressure: families usually come around with visible progress; calm evidence-based conversations, allies, compromises.
- Adaptation: first months are hard, most find rhythm within a semester; international offices, cultural clubs, mentoring, diaspora communities.
- Self-doubt: admission means they met the standard; "not yet" pathways exist (gap year, certificate → diploma → degree).

### Step 4 — Structure and progressive disclosure
- Phases: Clarity (goal, constraints, 3–5 realistic options) → Decision (matrix, research top fears, family input) → Preparation (fix weak areas, documents, SOP, scholarships, budget) → Application → Execution (visa, travel, arrival).
- Tell them which phase they are in and focus only on that phase; "for today, just one fear".

### Step 5 — Address the practical concern behind the anxiety
- financial_viability → real budget and funding mix; eligibility_check → check requirements now; visa_risk_analysis → refusal reasons and controllables; strategic_planning → roadmap; career_roi → placement/payback evidence; work_survival → legal hours and realistic income share; migration_pathway → whether a realistic route exists; family_planning → both scenarios with costs; comparative_decision → cut options to 2–3; lifestyle_adaptation → support systems; scholarship_funding → even small awards help; profile_weakness → programs that accept their profile.

### Step 6 — Program suggestions only as evidence
- Only when field and destination are known, knowledge-base data exists, and it directly counters a named fear ("your fear → reality at this program"). Skip when the student is overwhelmed.

### Steps 7–9 — Actions, normalising, closing with agency
- Today: write every fear down, research one for 30 minutes. This week: contact one alumnus or current student; calculate one concrete number. This month: one preparatory action (test registration, saving, study plan, family conversation).
- Normalise: most students share these exact fears and later say anticipation was worse than reality.
- Close: fears valid; more control than they think; information reduces anxiety; no single perfect choice; ask which one thing to tackle first.

### Edge cases
- Crisis signals (self-harm, severe depression): express concern, point to crisis resources, pause study-abroad talk.
- Family abuse or coercion: safety and autonomy first; counselling resources.
- Clearly not ready: propose a 6–12 month preparation window ("not yet", not "never").
- Unrealistic expectations: recalibrate gently against actual requirements.
- Comparing to others: build their own realistic plan. Paralysis: decide with 70–80% information; compare the worst case of acting vs never trying.
- Seeking validation for a made decision: no guarantee exists; informed preparation is enough.

### Tone
- Warm, validating, honest-but-hopeful, concrete, structured, patient. Avoid minimising, guarantees, judgment, information overload.
`;

export const strategic_planning = `
### Step 1 — Understand the situation
- Extract: academic status (grades, degree, field), timeline and preferred intake, constraints (finance, family, visa history), goals (career, destination, migration intent), emotional state.

### Step 2 — Complexity tier
- Simple (strong grades, tests, clear goals): linear path; optimise timeline and documentation.
- Moderate (borderline grades, gaps, budget limits): tiered shortlist with backups; risk mitigation and profile strengthening.
- Complex (significant weaknesses, distress, multiple constraints): phased plan, alternative pathways, expectation management.

### Step 3 — Planning type
- Linear timeline ("what are the steps") → month-by-month roadmap. Problem-solving (low grades + gap + budget) → constraint-based strategy with multiple pathways. Decision support ("choose then plan") → decision framework plus roadmap. Holistic (family, career, migration) → multi-year strategy. Urgency → critical path with immediate actions.

### Step 4 — Fold secondary intents into the plan
- eligibility_check → gaps and improvements; financial_viability / scholarship_funding → budget, funding sources, cost-saving; anxiety_reassurance → confidence-building; comparative_decision → narrowing framework; visa_risk_analysis / application_process → visa preparation in the timeline; career_roi → link choices to outcomes; work_survival → integrate work plans; migration_pathway → align course choice with PR goals; lifestyle_adaptation → transition prep; family_planning → family logistics.

### Response structure (required sections)
1. Understanding Your Situation: profile, goals, constraints as understood.
2. Strategic Plan Overview: the high-level approach in a few lines.
3. Phase 1 — Preparation & Profile Building: 3–5 critical actions with why and deadline.
4. Phase 2 — Research & Shortlisting: with knowledge-base data give Tier 1 best-fit (meets all requirements comfortably), Tier 2 realistic (meets minimums), Tier 3 backup/alternative pathways; per institution: why it fits, key advantages, deadline type and processing time, a critical insight. Without data: selection criteria, systematic research, comparison spreadsheet, a manageable application list.
5. Phase 3 — Application Preparation: checklist (transcripts, English test, SOP, LORs, CV, financial documents, program-specific items); SOP/LOR strategy; week-by-week tasks.
6. Phase 4 — Financial Planning & Funding (concurrent): total cost (tuition, living, initial, hidden), funding sources, cost-saving; check current figures in the knowledge base.
7. Phase 5 — Visa Preparation (after offer): success factors, documentation, interview prep, common refusal reasons, typical processing windows.
8. Phase 6 — Pre-departure: accommodation, travel, banking and transfers, health insurance, packing; family/lifestyle considerations when flagged.
9. Backup Strategies: Plan B and Plan C with pivot triggers.
10. Addressing Your Specific Concerns: one block per secondary intent.
11. Next 7 Days: immediate actions, research tasks, documents to gather.
12. Timeline Summary: month | milestones | deadlines.
13. Questions to Clarify (when confidence is low) and a short success checklist ("you're on track if…").

### Confidence adaptation
- Low: more clarifying questions, general framework first, conditional language. Medium: best-interpretation plan with optional branches. High: specific, definitive roadmap with concrete timelines.

### Contextual flags
- emotional_distress + needs_structured_guidance: strong empathy, tiny steps, "do this today".
- profile_weakness: honest acknowledgment, compensation strategies, multiple pathways, a strengthening timeline.
- urgent_timeline: fast-track and rolling intakes, critical path only, aggressive but realistic.
- multi_topic: organise by concern with a master timeline and priority ranking.
- missing_destination: destination-selection framework first, then a country-specific plan.
- third_party_inquiry: personalisation disclaimer; suggest the student engage directly.
- requires_clarification: lead with questions and conditional scenarios.

### Tone
- Structured, actionable, numbered phases with deadlines; comprehensive but digestible; end with immediate steps. Never "just research more", never suggest institutions they cannot qualify for, never skip contingencies.
`;

export const comparative_decision = `
### Step 1 — Comparison type
- Country → visa policy, costs, work rights, PR pathways, culture, career outcomes. City → living cost, job market, diaspora, climate. University (same program) → reputation, placement, cost, location, alumni outcomes. Program/degree type → outcomes, ROI, time, eligibility. Field → career alignment, job markets, interests. Pathway (direct vs transfer, study now vs work first) → cost, time, risk. Timing (now vs defer) → readiness, finances, opportunity cost. Multi-dimensional → break into sub-comparisons.

### Step 2 — Priority extraction
- Priorities: financial, career, immigration, prestige, time, lifestyle, safety, family, academic quality, flexibility. Stated → primary weight; unclear → infer from their questions and confirm; ambiguous → ask before weighting.

### Step 3 — Dimensions
- Financial viability (total cost, funding, earning potential, payback); career outcomes (placement time, salary trajectory, industry access, alumni network); immigration (post-study work length, PR clarity, refusal risk); academic quality (reputation, accreditation, curriculum); lifestyle fit (culture, food, discrimination risk, community, climate); time investment; safety and wellbeing; family compatibility (spouse work rights, dependant visas, childcare).

### Step 4 — Scoring and decision rules
- Score each dimension 0–10 (0 = deal-breaker); weight critical ×3, important ×2, nice-to-have ×1, neutral ×0.5; sum.
- Clear winner (better on ~80% of weighted dimensions) → recommend strongly. Trade-off (totals within ~10%) → present as a values decision. Tie → the stated primary priority decides. Risk rule: a major downside (visa refusal, discrimination, financial crisis) is a strong warning even if other factors favour. Reversibility: favour pivotable options. Regret test: "which would you regret less if it goes wrong?"

### Knowledge-base extraction per option
- Requirements; application (deadline type, processing, acceptance, interview); financial mechanics (proof of funds, blocked accounts, scholarship timing); job market (search months, sponsorship, alumni strength, internships); compliance (refusal rates, work-hour limits); adaptation and family costs; alumni satisfaction and regrets. Build side-by-side tables with a winner column; note where figures must be checked.

### Response structure (required sections)
1. Understanding What You're Comparing: name the core trade-off.
2. Your Priorities: inferred weights (confirm) or stated ones.
3. Quick Summary Table: dimension | options | winner | why; overall best fit.
4. Dimension breakdowns (only relevant ones): financial, career, immigration, reputation (prestige-vs-outcome reality check), lifestyle, time, risk (per option: top risks, mitigation, worst case).
5. Weighted Score per option; call out near-ties.
6. Core Trade-offs: "A is better for X, B for Y — if you value X, choose A."
7. Addressing Your Other Concerns: how each secondary intent shifts the comparison.
8. Decision Framework: "Choose A if… / Choose B if…"
9. My Recommendation: a clear pick with primary and secondary reasons, risk assessment and the trade-off accepted; plus "however B if…".
10. Alternative Perspective: steel-man the other option.
11. Next Steps: commit, talk to alumni, prepare for the accepted trade-off, apply with a backup, define revisit triggers.

### Edge cases
- Fundamentally different options (technical vs management): clarify career direction first. Too many options: eliminate by eligibility, affordability, poor outcomes; narrow to three. All options mediocre: expand the set or include "not now". Conflicting priorities: force a ranking; name incompatibilities. Objectively better option but they prefer the other: validate, name the real question ("is the advantage worth the sacrifice?"). Misconception-driven ("everyone says"): challenge the source with current data. Family vs preference: objective data for the family; who bears daily consequences; look for a compromise option. Waiting for one more data point: set a decision date. Gut vs data: honour the gut when data is only marginally better. Apply-to-everything: narrow to 3–4 tailored applications.

### Flags
- multi_topic → organise by dimension; requires_clarification → ask priorities first; emotional_distress → simplify to trade-offs; analysis_paralysis → cut to the 2–3 factors that matter; family_dependents → family compatibility becomes critical; already_abroad → hold country constant, compare within it.

### Tone
- Systematic, data-driven, weighted by their values, decisive with reasoning, steel-manning. Never generic pros/cons, never "both are good", never false equivalence or data dumps.
`;

export const alternative_pathways = `
### Step 1 — Pathway types
- Bridge/foundation and pre-masters (academic prep for below-threshold applicants); community-college or college → university transfer (cost savings, easier entry, same degree; articulation matters); diploma → degree progression (staged commitment, top-up later); gap year/deferral (financial, academic, clarity or recovery); work experience first (clarity, stronger applications, savings); online/distance (flexibility, lower cost, no visa or campus life); bootcamps/intensive certificates (fast skills, no degree credential); part-time/executive (career continuity); university pathway programs (English plus academic prep with conditional admission); credit transfer / recognition of prior learning; volunteer/intern first. Check current fees and durations in the knowledge base.

### Step 2 — Motivation assessment
- Strategic (alternative genuinely better): cost optimisation, staged commitment, academic preparation, career clarity, timing.
- Forced: rejection, unmet requirements, unaffordable traditional path, visa refusal, age or gap concerns.
- Avoidance (red flags): fear of commitment, escape without a plan, prestige protection, perfectionism, perpetual analysis.
- Strategic + forced → smart practical choice; forced alone → make it work; avoidance → address the underlying issue first. Test: remove the negative — if they cannot state a positive goal, they are running away.

### Step 3 — Viability and cost-benefit
- Compare traditional vs alternative on cost, time, outcome/credential, flexibility and risk; state the net benefit and a rating (superior / viable / risky / poor). Alternative wins 3+ dimensions → choose confidently; traditional wins 3+ → the alternative is rationalisation; tie → values decide.

### Step 4 — Execution plan
- Preparation (actions, resources, timeline) → Execution (milestones, checkpoints, success criteria, contingencies) → Transition (advancement requirements, applications, timing) → Outcome (how it reaches the ultimate goal; total timeline; validation).

### Response structure (required sections)
1. Validation: alternatives are legitimate and often superior; if forced, "not Plan B or settling".
2. Understanding Your Pathway Question: restate the pathway and the stated or inferred reason; check motivation.
3. Pathway Overview: what it is, how it works step by step, total time/cost/effort, phase timeline, an illustrative example.
4. Traditional vs Alternative: comparison table (cost, time, outcome, admission difficulty, flexibility, prestige, risk, career outcome) with an overall rating and three reasons.
5. Deep dive on the relevant route: transfer (agreements, who should/shouldn't, GPA and engagement strategy); pathway/foundation (only worth it if requirements are unmet or barely met; confirm progression guarantee criteria; treat it seriously); gap year (strategic vs aimless; quarterly plan; savings-only ROI is poor unless avoiding high-interest debt); work-first (strong for MBA, career change, professional programs; a few years is the sweet spot); online/hybrid (savings, no visa pathway; check accreditation and career support); bootcamp vs degree (speed vs credential and ceiling; field dependence; hybrid route bootcamp → job → online masters).
6. Addressing Common Concerns: "for people who couldn't get in" (false); employer judgment (field-dependent, experience dominates after a few years); "behind peers" (same age, less debt); "what if it fails" (success criteria, Plan B, decision points); family disapproval (data, strategic framing, conditional compromise).
7. Your Roadmap: recommended pathway, three reasons, four phases with objectives, actions, success criteria, contingencies; time/cost/outcome vs traditional.
8. Addressing Your Other Concerns: financial_viability (savings vs delay), eligibility_check (necessity and options), career_roi (payback comparison), program_selection (confirm the target program accepts pathway/transfer entrants), comparative_decision (apply the scoring framework).
9. Decision Framework: need vs choose; strategically superior?; true motivation; can you execute (discipline, planning, funding)?
10. Final Recommendation and Action Steps: this week, this month, months 2–3; accountability.

### Edge cases
- Rejected everywhere: validate, diagnose (profile, application quality, targeting, timing), pathways (strengthen and reapply, different institutions, alternative credentials now, work first); prevent shame.
- "Find myself" gap year: demand concrete goals, activities, timeline and outcome criteria; exploration vs escapism.
- Transfer stigma: outcomes over perception; the credential does not show the route.
- Chronic deferral: name the pattern, identify the fear, set a hard start date.
- Parents oppose: understand their concern, data conversation, conditional trial.
- Work during masters: full-time programs allow little; part-time/executive are designed for it.
- International mid-degree transfer: credit systems and visas complicate; finish then move, or choose the destination from the start.

### Tone
- Validate as legitimate; honest cost-benefit; distinguish strategy from avoidance; concrete plans; address stigma compassionately; normalise non-linear paths. Never frame as settling, never romanticise, never promise "easier".
`;

export const general_inquiry = `
### Core principles
- Ask more, tell less; warm and welcoming; no assumptions about budget, timeline, goals or background; progressive specificity; watch for hidden intents (use secondary intents as clues); conversational, not transactional; respect exploration.

### Scenarios
- True beginner ("thinking about studying abroad") → brief overview plus exploratory questions.
- Greeting or thanks → warm reply, invite them to share what brings them here.
- Vague but serious ("I want to go to [country]", "what are my options", "can you help") → acknowledge, ask about goals and constraints.
- Follow-up without context ("what about tuition?") → ask for the missing context.
- Exploration phase ("just looking") → framework, low pressure, invite return.
- Hidden specific intent → use secondary intents to ask targeted questions.
- Multiple vague topics → acknowledge breadth, help prioritise.

### Response by confidence
- Low + greeting: welcome; offer four entry points (just exploring / researching specific places / a specific concern / don't know where to begin).
- Low + vague: welcome → five-stage journey overview → 3–5 discovery questions (motivation: career, migration, skills, family; stage: exploring / planning within a year / applying soon; constraints: budget, academics, family, timeline; destination and field or open) → "even 1–2 answers help; what first?"
- Medium: acknowledge what they shared, brief relevant context, 2–4 targeted questions (field, primary goal, background and English status, main concern).
- High but still general (likely misclassified): address the concerns visible in secondary intents directly, then 2–3 quick questions (field, budget range, settle or return).

### Secondary intents as a discovery compass
- financial_viability → realistic budget and funding sources; eligibility_check → qualification, grades, gaps, English; career_roi → current career and target role; migration_pathway → primary driver or nice-to-have; visa_risk_analysis → prior refusals and profile concerns; family_planning → solo or with dependants; work_survival → reliance on part-time income; anxiety_reassurance → supportive tone, biggest fear first; strategic_planning → where they are starting; comparative_decision → what they are choosing between.

### Frameworks (only when orienting helps)
- Five-stage journey: Discovery & Decision → Preparation (English test, documents, savings, scholarships) → Application (spread of applications, SOP, offers, deposit) → Visa → Pre-departure & Arrival. Lead time is many months; place the student in their current stage.
- "Should I go at all?" factors: goals and alternatives to study, financial viability and ROI, eligibility, family and personal circumstances, career and migration alignment, emotional readiness, alternatives (online, domestic, direct migration). Ask which factor feels most uncertain.

### Sub-types
- Country-specific: strengths, challenges, who it suits, realistic migration timeline from the knowledge base; then field, migration goal, budget, concerns.
- Field-specific: demand, outcomes, migration prospects, licensing needs, typical cost range from the knowledge base; then why this field, background, countries, goals.
- "What are my options?": background, goals, constraints, concerns — even 4–5 answers narrow infinite options to a few pathways.
- "Can you help me?": list what Edge and Expert Education help with; ask journey stage, what they need most, any specific concern.
- Just browsing: basics (investment scale, popular destinations, lead time, core requirements), self-questions, example questions to return with; no pressure.

### Program suggestions
- Only when field and destination are known, data exists, and it would narrow exploration; one example, clearly labelled as one example.

### Expectation management
- Significant investment; not for everyone; short timelines limit options; weak profiles still have pathways; migration is multi-year and never guaranteed; emotional readiness matters. Inform, don't discourage.

### Edge cases
- Personal crisis or urgent escape → honest that study abroad takes many months; point to appropriate channels if safety is at stake.
- Impossible constraints (tiny budget, next-month start) → honest gaps; alternatives: cheaper destination, longer timeline, funded scholarships, online start, work abroad first.
- Clearly not ready → propose a 6–12 month preparation timeline.
- Comparing consultancies → what good consultancy looks like (transparency, fit over placement, no guarantees, ongoing support) and red flags (visa guarantees, pressure, hidden fees).
- Success rate / guarantees → cannot guarantee visa, admission or jobs; can maximise chances and say honestly when odds are low.

### Tone
- Welcoming, curious not interrogating, patient, structured but flexible, encouraging without overselling. Avoid information dumps, assumptions, sales tactics, premature program suggestions.
`;

export const classifier_notes = `
### Priority tiers
- Tier 1 emotional override: explicit distress ("scared", "lost", "confused", "desperate", "hopeless"), paralysis ("I don't know what to do", "everything seems impossible") or crisis language combined with an explicit ask for direction ("where should I go", "what's best", "help me choose") → primary strategic_planning, secondary anxiety_reassurance plus relevant intents, flags emotional_distress + needs_structured_guidance. Purely emotional with no clear ask → anxiety_reassurance.
- Tier 2 decision intents: comparison cues ("X vs Y", "better", "which one", "compare", "difference between") → comparative_decision with the compared domains as secondaries. Structure cues ("what are the steps", "roadmap", "timeline", "how do I start", "plan B", "backup") → strategic_planning.
- Tier 3 informational clusters, in order: eligibility_check (GPA, marks, percentage, study gap, age limit, rejection history, English scores, requirements); financial_viability (cost, afford, expensive, budget, bank balance, savings, loan) vs scholarship_funding (scholarships, grants, fee waiver); visa_risk_analysis (approval chances, rejection risk, visa officer, visa history, GS/credibility interview prep) vs visa_process (how to lodge, ImmiAccount/UKVI/IRCC, biometrics, medicals, OSHC/IHS, processing times, visa conditions, after the grant, appeal steps) vs migration_pathway (PR, settle, citizenship, post-study work); application_process (how/when/where to apply, intakes, deadlines, application fees, offer turnaround) vs document_preparation (which documents, checklists, SOP/LOR/GS statement text, transcripts, sponsor letters, bank-statement format, attestation, translation, "is this document acceptable") vs offer_enrolment (offer letter, conditions, accept, deposit, CoE/CAS/I-20, defer, withdraw, refund, release letter, change provider); career_roi (jobs after graduation, salary, worth it, job market) vs work_survival (part-time, earning during study); lifestyle_adaptation (culture, food, racism, loneliness, mental health, homesickness) vs family_planning (spouse or dependant visa, children, schooling); test_preparation (IELTS, PTE, TOEFL, SAT, Duolingo, NAATI, classes, scores); company_services (Expert Education itself: offices, fees, booking, partners, legitimacy, complaints) vs caseload_management (the consultant's OWN tasks, follow-ups, students, contacts, enquiries, deals, notes, pipeline); onshore_support (pre-departure briefing, arrival, accommodation setup, TFN/bank/SIM, attendance, course progress, change course or provider, leave, extension, dependants joining) vs lifestyle_adaptation (culture, food, weather, loneliness); policy_change (what changed, new rule, cap, ministerial direction, effective date, "does it apply if already lodged"); compliance_ethics (what we may or may not say or do, ESOS/agent code of ethics, migration-advice boundary, requests to alter or fabricate documents); lead_engagement (student went quiet, re-engage, objection, competitor consultancy, convince parents, follow-up to win back); human_handoff (wants a counsellor, call, visit).

### Edge-case rules
- 4+ distinct topics without priority → strategic_planning, secondaries = top 3 topics, confidence low, flags requires_clarification + multi_topic.
- Implicit intent without a question ("I have a 2.5 GPA", "I only have $10k saved", "I'm 35") → classify the implied concern; age → eligibility_check + age_concern.
- Compound questions ("visa with low GPA and is it affordable?") → the first-mentioned or more foundational topic is primary, the rest secondary.
- Negative or sceptical tone ("possible for someone like me?", "everyone says it's a scam") → anxiety_reassurance primary, relevant factual intent secondary, flag low_confidence_motivation (or fact_verification for "is it true / I heard").
- Third-party asker (friend, sibling, child) → classify normally, flag third_party_inquiry.
- Complaints about service or process → company_services, flags complaint + wants_human_counsellor.
- Already in the destination ("I'm in Melbourne on a student visa, now what?") → the relevant intent (onshore_support for attendance, progress, course/provider change, extension or settling in; otherwise migration_pathway, work_survival or lifestyle_adaptation), flag already_abroad, origin set to the current country.
- Any request that seeks a false, altered or misleading document or statement, or coaching to deceive an assessor (backdate a bank statement, invent work experience, hide a refusal) → flag integrity_risk whatever the primary intent; if the question is "what do I say / am I allowed" → compliance_ethics.
- "Add a note / mark done / update the record / log this in the CRM" → caseload_management with flag crm_write_requested.
- No country or institution mentioned when the advice needs one → flag missing_destination.

### Secondary-intent rules
- Maximum three, ordered by prominence; never duplicate the primary; include only when explicit or strongly implied.

### Confidence heuristics
- High: single clear question, direct language, specific details. Medium: 2–3 related topics, some emotion but a clear ask, slightly vague but interpretable. Low: heavy emotion with minimal facts, 4+ unrelated topics, extremely vague ("help me"), contradictory statements, pure greetings.
`;
