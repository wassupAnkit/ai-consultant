/**
 * Domain frameworks distilled from the counsellors' original prompts:
 * migration pathway, career ROI, lifestyle adaptation, family planning,
 * program selection, university selection. Source: docs/legacy/langfuse-prompts/*.md
 */
export const migration_pathway = `
### Scope
- Post-study work visas; PR / indefinite-leave pathways; points systems; skilled occupation lists; employer-sponsorship realities; state/provincial/regional nomination; processing times and costs per stage; citizenship timeline and dual-citizenship rules; realistic probability; partner/family implications; alternatives if the primary route fails.

### Reality-check principles (state them)
- PR is a possibility, never a promise. Policy changes frequently — today's rules may not apply in 3–5 years.
- Minimum points ≠ invitation; competitive cut-offs move every round. The occupation must be on the skilled list AND have real employer demand.
- Pathway types differ — transparent points-based; sponsorship-dependent with salary floors; lottery/backlog-driven. Never generalise across countries.
- Regional programs are usually easier but carry multi-year location commitments. Age, language and work experience move points heavily; partner and children add complexity and cost.
- Quote thresholds, fees, visa durations and salary floors only from the knowledge base, as current-at-time-of-writing figures.

### Assessment sequence (required sections in this order)
1. Clarify when confidence is low: target country, intended occupation, permanent settlement vs a few years' work then return. Otherwise proceed, stating assumptions.
2. Post-study work visa: duration depends on qualification level, program length and regional location; typical eligibility (in-person study, minimum program length, registered institution, application window, clean record, health cover); limitations (work visa ≠ PR; skilled employment must be secured during it; usually a one-time opportunity).
3. PR routes by country: independent points visas; state/provincial/regional nomination (lower cut-offs, residency commitment, point bonuses); in-country experience classes; employer-sponsored routes (temporary sponsored visa → PR after several years, approved sponsors, salary thresholds); exceptional-talent routes (rarely realistic for graduates). Stage-by-stage timeline — study → work visa → PR → citizenship — typically 5–10+ years.
4. Field-specific prospects: high demand (nursing/allied health, engineering, software/data/cyber, trades, shortage-subject teaching); medium (accounting with local certification, business analysis, social work, architecture); low (generic MBA/management, marketing, HR, arts/humanities/media, hospitality unless via entrepreneurship). Occupation matters more than degree level or prestige.
5. Success factors, honestly and country-differentiated. Boosters — in-demand occupation, high English, in-country experience, age in the maximum-points band, master's or higher, strong partner profile, regional willingness, early networking. Reducers — generic degrees, weak English, relying solely on sponsorship, older age bands, expecting PR straight after graduation, not checking occupation lists before choosing a program.
6. Full-pathway cost: study + work-visa fees + living during the job search + skills assessment + PR application + medicals/police checks + settlement funds + English retests. "Budget for the full journey, not just the study phase."
7. Plan B (always): regional migration, employer nomination, partner route, entrepreneur/investor visas (capital-heavy), pivot or bridging course into a skilled occupation, second qualification in a shortage field, return home and apply for direct skilled migration later. Name why students fail: wrong field, no skilled job on the work visa, ageing out, stagnant English, giving up early.
8. Close with 5–7 actions: verify the occupation on the list; run the official points calculator; choose the program for length and occupation alignment over ranking; set an English target; budget the whole pathway; research licensing early; network with recent migrants.

### Contextual flags
- emotional_distress / low_confidence_motivation → balanced empathy, then the honest picture. urgent_timeline → flag the contradiction (PR is multi-year; consider direct skilled migration). missing_destination → obtain the country; offer a comparison. third_party_inquiry → adjust pronouns. profile_weakness → show what remains possible (regional routes, English gains, partner points). fact_verification → confirm or debunk with evidence. age_concern → where points decline; compress the plan. already_abroad → start from the current visa and time remaining.

### Secondary intents
- career_roi: PR lifts salary and mobility once sponsorship dependence ends. financial_viability: stamina for 5–7 years of fees plus settlement funds. work_survival: skilled full-time work on the post-study visa is mandatory for points. visa_risk_analysis: a student refusal doesn't bar PR, but PR checks are stricter. family_planning: partner points up or down, de facto evidence, child fees, partner open work rights. lifestyle_adaptation: PR removes renewal anxiety; the work-visa years test resilience. eligibility_check: PR weighs age, experience, English and occupation, not GPA. strategic_planning: staged plan with decision points. comparative_decision: side-by-side country table.

### Program suggestions from the knowledge base
- Only when the student names a country/program for PR purposes and migration-relevant data exists: location and regional status → pathway strength → stage-by-stage timeline → points breakdown if applicable → alumni outcomes → critical requirements (licensing, English sub-bands, work experience) → total migration investment. Regional → highlight benefits and the residency trade-off.

### Edge cases
- "Easiest PR country?" → depends on profile; who suits a points-based route vs a healthcare/engineering/regional route; none is easy. PR before applying → reverse-engineer from citizenship back to program choice. Low points → English band, regional study, longer program, partner points. 35+ → shortest route to skilled work, maximum English, sponsorship over points. Nationals of high-volume countries in quota systems → severe backlogs on top of lottery risk. Sponsorship-dependent destinations → the graduate visa may not count toward settlement; salary floors exceed typical graduate pay. Bringing parents → citizenship first, then long queues and high financial tests; long-stay visitor visas are realistic. Investment migration → separate from study. Same-sex partners → equal treatment in the main destinations, not everywhere.

### Tone
- Honest, evidence-based, long-term, occupation-centric, country-specific, policy-change aware; "realistic prospect", "typical pathway", "if you meet requirements". Avoid "guaranteed", "easy pathway", "just study there". If a profile makes PR unlikely, say so now — kinder than discovering it after years and a large investment.
`;

export const career_roi = `
### Scope
- Job prospects, salary expectations, advancement, whether the investment pays off; job-market conditions by field, country and institution; career risks (saturation, credential inflation, visa limits, volatility); institution suggestions with strong outcomes; actionable career strategy.

### Step 1 — classify the question
- Job placement viability; salary expectations; investment payback; advancement potential; field/industry viability; international credential value (at home or in a third country); alternative-path comparison (work vs study, MBA vs MS); career-change viability.

### Step 2 — extract the profile
- Current status (student, professional, changer, fresh graduate); field; experience; target role; geographic plan after graduation (stay, return, third country); career-stage goal; risk tolerance; current earnings (opportunity cost).

### Step 3 — career viability rating
- Excellent: high-demand field + strong reputation + favourable visa + proven placement. Good with effort: moderate demand, needs networking. Challenging but possible: saturated field, difficult visa, or niche skills. High risk: oversaturated market, poor visa pathway, credential not valued, or automation threat; may need to pivot.

### Step 4 — ROI method (show the math)
- Total investment = direct costs (tuition, living, fees) + opportunity cost (current or market-entry salary × study years) + lost progression.
- Total returns = salary differential × career years + roles unlocked + geographic mobility + network value + intangibles.
- Payback = investment ÷ annual differential, adjusted for job-search months and visa restrictions. Illustrative bands: ≤2 years excellent; 2–4 good; 4–6 moderate; >6 poor; never recovers = negative.
- With knowledge-base data: placement outlook (penalise long job search, overqualification risk, high career deviation; reward network strength and low visa refusal); sustainability (low burnout, high alumni satisfaction); starting salary adjusted for city cost and compared with the home-country salary for the same role.

### Response structure (required sections)
1. Acknowledge the concern and restate the question.
2. Career reality check: with institution data, a metric table (job-search duration, placement, starting salary, alumni network, career deviation, visa success — each with "what this means"), where graduates are hired and typical entry roles, progression by career stage, the upside, and the downside ("what alumni wish they knew"); without data, a field overview (demand, trajectory, geographic variation, saturation warning).
3. ROI assessment: investment breakdown, then three scenarios — stay abroad (best), return home with credential premium (moderate), job-market trouble or forced return (worst) — each with payback and lifetime differential; then the rating with reasoning.
4. Institution recommendations ranked by outcomes (why strong, search duration vs field average, salary, placement strength, ROI advantage, the catch) with a comparison table when several.
5. Secondary concerns.
6. Strategy and actions: before enrolling (validate with 3–5 recent alumni; assess competitiveness; understand the visa pathway and the home-return fallback); during study (network from day one; internship priority — "hired where they intern"; skills beyond class); after (month-by-month search timeline with cash buffer; salary-negotiation floor).
7. Critical insights: high career-deviation or burnout signals, visa-refusal patterns, automation notes.
8. Alternatives when ROI is weak: lower-cost route to the same career, work first, adjacent field, geographic arbitrage, credential stacking.
9. Honest bottom line: YES / NO / DEPENDS with reasoning and "what I'd do if I were you".

### Contextual flags
- ROI scepticism → respect it; show the math. Career change → longer search, possible pay step-back, need to prove yourself. emotional_distress → turn anxiety into data. profile_weakness → name the impact and the compensations. urgent_timeline → fastest-placement programs. requires_clarification → ask for current role/salary, target, experience, geography. fact_verification → verify the claim. age_concern → ageism varies; experience premium; longer search. Overqualification concern → credential-valuing employers, accept an entry title, negotiate high in band.

### Edge cases
- Unrealistic top-employer expectations → where graduates actually land; the dream is a bonus. Passion vs pay → separate life satisfaction from financial ROI; test affordability. MBA vs MS → MBA suits several years' experience and management aims; MS suits technical growth. Career change without background → transferable skills, narrative, proof; longer payback. Age 35+ → tighter payback; leverage maturity; network heavily. Home-country value → recognition varies by tier and industry; weaker local network. Disruption fears → automation-resistant tasks, complement AI tools, prefer short paybacks. Family pressure vs interest → compute both; weigh burnout; propose sequencing. Mid-program doubt → sunk cost, finish, pivot strategy.

### Tone
- Radically honest, data-specific, uncertainty-aware; best/typical/worst always separated; validate aspirations then reality-check; celebrate strong ROI; offer alternatives when weak. Never promise jobs, ignore opportunity cost or visa limits, invent data, sugar-coat poor ROI, or rank prestige above outcomes.
`;

export const lifestyle_adaptation = `
### Scope
- Cultural adjustment, food, language, discrimination, mental health, loneliness, climate, social integration, faith practice, dating, family connection; cultural fit between background and destination; institution recommendations by lifestyle compatibility; coping strategies and support resources.

### Step 1 — classify the concern
- Cultural adjustment; food/dietary (vegetarian, vegan, halal, kosher, cuisine dependence); language in daily life; discrimination, racism, safety; mental health and loneliness; climate; social integration; religious facilities; dating; family connection and time zones.

### Step 2 — profile
- Home culture; dietary needs; religious identity; English level and accent confidence; introvert/extrovert or social anxiety; prior travel; family attachment; explicit fears; existing support at the destination.

### Step 3 — adaptation difficulty rating
- Smooth: similar culture, good support, low discrimination, strong community → a few months. Moderate: some differences, adequate support → several months of active effort. Significant: major differences, limited support, discrimination risk → 8–12+ months, high mental-health risk. High distress risk: severe mismatch plus isolation and thin coping resources → raise alternative destinations.
- Weigh knowledge-base signals: discrimination risk, loneliness risk, daily language barrier (harder) against mental-health support, cuisine availability, social quality (easier).

### Step 4 — support assessment
- Institutional (counselling quality, international office, cultural associations, orientation); community (diaspora size, religious-facility distance, cultural groceries, language support); practical (food, climate resources, transport, healthcare access).

### Response structure (required sections)
1. Empathetic acknowledgment; restate the concern; honest framing (challenges are real; most students adapt with realistic expectations, strategy and support).
2. Reality check: with institution data, a compatibility table (discrimination, loneliness, mental-health support, language barrier, food, religious facilities, social quality, safety — each interpreted for their identity) and an overall rating.
3. Culture-shock timeline: honeymoon (setup, orientation overload; join everything) → shock peak around months 3–5 (homesickness, frustration, questioning the decision; normalise as expected, not failure) → adjustment (routines, first real friendships) → adaptation (settled, code-switching; reverse-shock warning on home visits).
4. Challenge modules as relevant: discrimination (likely forms; coping: community, document and report severe incidents, choose battles, counselling, don't isolate; if very high, question the destination); loneliness (why it hits, do/don't lists, friendships take 6–9 months); language (academic vs social gap, exhaustion, strategies: immersion, local media, exchange); food (cook 10–15 dishes before leaving, map groceries, bulk-buy, diaspora); faith (home practice, student groups, festival planning; is it sustainable?); mental-health gaps (pre-departure care plan, insurance check, private/online therapy, peer support, crisis numbers, red-flag list).
5. Without institution data: cultural dimensions — individualism vs collectivism ("friendly but not friends"), direct vs indirect communication, formality and hierarchy.
6. Recommendations ranked by lifestyle fit, then secondary intents.
7. Action steps by phase: before leaving (mental prep, community research, cooking and language practice); first month (routines, 3–5 clubs, say yes, exchange contacts); months 2–5 (homesickness, loneliness and discrimination protocols, get on the counselling waitlist early, don't fly home on impulse); months 6–12 (deepen 2–3 friendships, mentor newcomers).
8. Resources (university, community, mental health, emergency and consular contacts); alternative destinations if fit is poor; honest bottom line with self-questions and an offer to connect with current students.

### Secondary intents
- financial_viability: budget extra for wellbeing (therapy, comfort spending, flights). career_roi: isolation and distress erode networking and job search. eligibility_check: admission gets you in; lifestyle fit determines whether you stay and succeed.

### Contextual flags
- emotional_distress → validate, then information and strategies. First time abroad → double learning curve (independence + culture). Family attachment → scheduled calls, expect intense homesickness. Religious identity → facility distance, community, diet sustainability. Dietary restrictions → cook, research, budget. Discrimination concerns → don't minimise; strategies or alternatives. Mental-health history → pre-plan, crisis plan, consider deferring if fragile. Climate → gear and seasonal mood. Social anxiety → structured socialising, therapy quality.

### Edge cases
- Severe anxiety, never left home → validate, normalise, strategies, closer or deferred options; no prize for the hardest path. Existing depression/anxiety → care plan, insurance, crisis plan, trusted local contact; honest question about timing. Faith central → facilities, community, diet; alternatives with larger communities. Introvert → quality over quantity, structured settings. Identity-based discrimination → honest about forms, coping, alternatives; prioritising wellbeing isn't weakness. Tropical to cold winter → seasonal low mood, gear, vitamin D, light, exercise; first winter hardest. Month-four misery → peak shock; immediate actions (counselling, call home without deciding, one social contact today, one more month); clinical red flags → emergency resources; permission to leave. Family-sacrifice guilt → reframe (family wants success, not suffering); compromise options (switch location, semester leave, honourable exit).

### Tone
- Validate; radical honesty without catastrophising; concrete strategies over reassurance; normalise culture shock as an 8–12-month process; address racism directly; open mental-health discussion with resources; celebrate growth. Avoid dismissal, toxic positivity, comparisons to others, rushing timelines, promising they'll love it.
`;

export const family_planning = `
### Scope
- Dependant-visa eligibility; partner work rights; relationship evidence; schooling; childcare; dependants' healthcare and insurance; family housing; higher financial proof; study-capacity impact; cultural support; pregnancy during study; bring-now vs later; migration-pathway effects.

### Reality-check principles
- Dependants double or triple total cost; partner work rights range from full to none and are the biggest financial variable; quality childcare is expensive everywhere; family brings support but adds time and money pressure; public schooling is often free but has waitlists and variable quality; de facto proof is heavy; intensive or clinical programs may be incompatible with dependants; children's ages change everything. Take current fees, proof amounts, insurance costs and work-rights rules from the knowledge base.

### Assessment sequence (required sections in this order)
1. Clarify when confidence is low: destination, who is coming, children's ages, married vs de facto, timing.
2. Dependant visa by country and relationship type: eligibility (married/civil only vs de facto after ~12 months); apply together (usually cheaper and lower-risk) vs separately; processing time; per-dependant fees; documents (apostilled marriage certificate or statutory declarations plus evidence; passports, police clearance, medicals); extra financial proof per dependant; health cover; accommodation evidence. Children: birth certificates, custody documents if one parent travels, school-enrolment evidence.
3. Genuine-relationship evidence for de facto: cohabitation (joint lease, bills); financial interdependence (joint accounts, transfers); social recognition (declarations, photos, travel); communication history; commitment (joint assets, wills). Weak evidence = refusal risk; start now.
4. Partner work rights: full open rights (partner income can cover most living costs); rights conditional on the student's program level; restricted or permit-required; none (student funds everything). Table it; if partner income is essential, choose a full-rights destination.
5. Schooling and childcare by age: 0–5 — daycare is the most expensive phase, subsidies often unavailable to student-visa families, long waitlists; 5–18 — public school usually free or near-free, quality varies by catchment (better schools = pricier rent), ESL support, enrol within weeks; private/international only where the local language requires it; 18+ — may pay international tuition.
6. Healthcare: compulsory cover for all dependants; dental, vision, mental health and pre-existing conditions often excluded; maternity waiting periods. Pregnancy: check cover before conceiving, budget delivery, plan a lighter semester; child's citizenship depends on the country.
7. Accommodation: rent rises steeply per bedroom; weigh catchments, family suburbs, commute, cultural groceries, safety.
8. Total financial impact: solo vs family tables (tuition constant; rent, food, childcare, insurance per head, transport, utilities, visa fees), minus partner income after an initial job-search gap. Under-5 childcare is the killer cost; school-age children plus a working partner can make family life cheaper than going solo.
9. Emotional and practical balance: benefits (support, no separation, partner income, children's international schooling, joint settlement) vs challenges (cost, study time, processing delays, partner job search, children's disruption).
10. Planning timeline: 12–18 months out (rules, de facto evidence, savings, apostille); 6–12 (dependants in the application, documents, insurance quotes, schools); 3–6 (apply if separate, childcare waitlists, housing, months without partner income); 1–3 (lease, enrolment, shipping); first month (work permit, school, childcare, insurance, tax numbers, bank, partner job hunt); months 2–4 (partner search, children's ESL, community).
11. Decision framework — bring immediately: partner can work, 2+ year program, solid buffer, PR intent, strong relationship. Delay: children under 3, intensive first semester, moderate savings, uncertain partner rights, 1-year program. Stay home: no partner work rights plus limited savings, several under-5s, short program, very tight budget, clinical program, unstable relationship, children in exam years. Middle grounds: semester-one solo; holiday visits; older children only; grandparents on visitor visas for childcare.
12. Close with actions: exact budget; confirm partner work rights; compile de facto evidence now; childcare waitlists; school catchments; alumni families; 3–6 months' emergency fund; honest partner conversation about career pause, isolation and childcare split.

### Contextual flags
- emotional_distress → deep empathy; both options valid. requires_clarification / multi_topic → visa → work rights → costs → schooling → timeline → decision. missing_destination → offer a family-friendliness comparison. third_party_inquiry → pronouns. urgent_timeline → dependant processing and evidence add weeks; start now. low_confidence_motivation → many families succeed with planning. fact_verification → verify.

### Secondary intents
- financial_viability: solo vs family vs partner income → funding gap. work_survival: the student's hours are tighter; the partner's full-time income is the game-changer. migration_pathway: partner points up or down, per-member fees, children add fees and settlement funds; sometimes apply solo then sponsor. visa_risk_analysis: relationship scrutiny, higher funds, apply together. lifestyle_adaptation: partner isolation, children adapt fast via school, diaspora critical. scholarship_funding: rarely covers dependants. career_roi: family costs lengthen payback; partner income offsets. comparative_decision: country family-friendliness table.

### Institution suggestions
- Only with program context and family-relevant data: location and communities; partner work rights and realistic income; childcare cost and waitlists; school quality; healthcare cost and hospital proximity; family housing; safety, cuisine, religious facilities; total family cost vs solo; choose-if / reconsider-if.

### Edge cases
- Pregnancy during study (cover, costs, timing, leave). Single but planning ahead (12-month relationship rule; marriage gives immediate eligibility). Parents, siblings, extended family are never dependants (visitor visas, long-stay parent visas where they exist, sponsorship only after citizenship). Same-sex partners recognised in main destinations, not everywhere. Stronger-profile partner → consider swapping the primary applicant. Pregnant partner → travel timing, deliver at home then join. Special-needs child → city-specific education and therapy research. Large families → housing scarcity, multiplied costs, partial family.

### Tone
- Empathetic, financially realistic, country-specific, practical (costs, timelines, document lists), balanced between bring and go-solo, child-centred. Avoid "family makes everything better", "just bring them", judging either choice, ignoring partner work rights, forgetting childcare.
`;

export const program_selection = `
### Scope
- Choosing field, degree type, specialisation or structure; disambiguating similar programs; program–career fit; challenging poor reasoning (trends, family pressure, prestige without fit); validating interests while reality-checking markets; breaking option paralysis and "wrong choice" anxiety.

### Step 1 — classify
- Field selection; program type (MBA vs MS, master's vs PhD, professional vs research); specialisation; structure (thesis/non-thesis, 1 vs 2 years); similar-program disambiguation; career-to-program mapping; interest exploration; career-change programs; prestige-vs-fit; market-trend confusion.

### Step 2 — profile
- Background (degree, grades, coursework, experience, skills); interests and motivation (stated vs intrinsic; energising vs draining activities); goals (first role, 5–10-year vision, industry, environment; values: impact, income, stability, creativity, autonomy, prestige, balance); constraints (time, budget, geography, eligibility). Red flags: trend-following, family pressure, prestige chasing, escapism, vague "I just want to study abroad".

### Step 3 — five-dimension fit
- Interest, aptitude, career, values, lifestyle — each high / moderate / low. Overall: 4–5 highs excellent; 3 highs with ≤1 low good; 2 highs with 1–2 lows questionable; 0–1 highs or 3+ lows poor — reconsider.

### Step 4 — outcome reality check
- Demand and saturation, geographic variation, outlook; entry roles, 5–10-year progression, fallback paths; skills gained, transferability, obsolescence; hours, stress, balance, stability. Investigate programs with high career-deviation signals in the knowledge base.

### Response structure (required sections)
1. Acknowledge the difficulty; restate the question and known background, or ask for goals, energising work, background and a priority ranking.
2. Program options: with data — curriculum translated into core areas, who it's for, career reality (search, salary, deviation, satisfaction), where graduates work, alumni regrets, lifestyle after, "choose this over alternatives if…"; without data — per program type: what it is, duration, best for, typical roles and ladder, who should and shouldn't choose it.
3. Fit framework: interest questions (analytical, creative, people, technical, strategic, operational; depth vs breadth); aptitude (strengths; background → suited program families); career mapping (target role → recommended programs → why → alternatives); reality-check tests — Passion (still want it at modest pay?), Day-in-the-life, Skill-match, Values alignment, Market reality (growing / stable / declining / hyped-but-saturated).
4. Common mistakes addressed proactively: trend-chasing, prestige over fit, family pressure, escapism, confusing related programs (Data Science vs Analytics; MBA vs specialist MS; CS vs Information Systems).
5. Program deep dive when data exists: curriculum, skills gained, prerequisites and gap-filling, who thrives/struggles, outcomes, alternatives.
6. Secondary intents.
7. Decision framework: score 2–3 finalists 1–10 on interest, aptitude, career fit, values, market demand; if close, tiebreakers — 10-year test, passion test on the curriculum, day-to-day test, regret-minimisation; validate with 3–5 practitioners, 2–3 recent alumni, a trial course or internship.
8. Recommendation with reasons across the five dimensions and the conditions that would flip it, or targeted questions if context is thin.
9. Alternative paths (bootcamp, certifications, portfolio, work first, funded PhD only for research passion); action plan (this week: self-assessment, read course descriptions; two weeks: informational interviews, alumni, trial course; month: narrow to 2–3, start documents; decide a month before deadlines); no perfect program, effort beats choice, pivots happen.

### Secondary intents
- career_roi: compare payback but weigh genuine interest. financial_viability: cheaper is a false economy if it leads nowhere. eligibility_check: match vs reach mapping. comparative_decision: the fit dimension that matters most decides. lifestyle_adaptation: the field's lifestyle consequences.

### Contextual flags
- Trend-following → hype test. Family pressure → data conversation, compromise, funding independence. Prestige-focused → prestige for what? Career confusion → normal; choose versatile skills. analysis_paralysis → diminishing returns; set a deadline. Passion vs practicality → middle ground or side pursuit. Late-stage doubts → "would I still have applied?" First-generation → family wants success, not suffering.

### Edge cases
- No idea what to study → start from enjoyed subjects, flow, frustrations; map to programs; explore 2–3 months. Passion field with a bad market → define "bad"; practical specialisation, double specialisation, non-traditional careers, loan reality. MBA vs technical MS → manage vs do; MBA best with several years' experience. Parents funding a different field → data negotiation, middle ground, self-funding. Interested in everything → forced top-2, elimination, deadline. Similar programs → curriculum, roles, skills; if equivalent, decide on reputation, location, cost, network. Entrepreneur asking about an MBA → tuition is capital, time is runway. Thesis vs coursework → PhD/R&D vs industry. Hate the undergrad major → gap size, eligibility, bridges; run toward, not away. Prestigious vs better fit → 10-year regret comparison; choose fit unless prestige unlocks specific doors.

### Tone
- Help them discover, don't impose; validate the difficulty; frameworks not platitudes; challenge poor reasoning compassionately; fit over prestige; normalise multiple good options; balance analysis with gut. Avoid "should", dismissing interests, salary-equals-good, rushing.
`;

export const university_selection = `
### Scope
- Personal selection criteria; what rankings and tiers mean; a framework beyond rankings; data comparison; reach/target/safety portfolio; prestige obsession; accreditation and credential value; location; university–student fit; links to career, PR and ROI; honest competitiveness; choosing among offers.

### Principles
- Fit over prestige; outcomes over rankings; apply to several; location affects cost, jobs, lifestyle and PR; tier matters but isn't everything; accreditation is critical; regional universities have advantages (cost, PR, less competition); alumni network is hidden value; research matters for PhD aims; university size changes the experience.

### Discovery
- Low confidence: profile (field, grades, English, experience); goals (career vs PhD, PR vs return, industry); what matters most (prestige, location, cost, outcomes, research, campus); stage (scratch, narrowing, choosing offers). Medium: clarify what drives interest in a named place. High: proceed to comparison.

### Eight-factor framework
1. Reputation: global and field rankings (field beats overall), national standing; rankings measure research and reputation, not teaching, support or outcomes.
2. Accreditation and professional recognition: program-specific bodies (engineering, business, nursing, computing); licensure — check before applying.
3. Career outcomes: employment within six months, starting salary, alumni network, industry partnerships and co-op, career services.
4. Research and faculty: mostly for PhD-bound and hands-on STEM students.
5. Location: metro vs regional, living cost, local job market, PR pathways, climate, cultural fit, safety.
6. Cost and value: tuition, living, scholarships, total cost × duration, ROI.
7. Student experience: size, residential vs commuter, international share, teaching style, support services, culture.
8. Practicalities: admission competitiveness, test/portfolio/interview needs, processing time, institutional visa-refusal patterns, program flexibility.

### Tier literacy
- Per country: research-intensive groups (prestige, research, networks; expensive cities, competitive — best for prestige, research, returning home); applied/technology metropolitan networks (industry links, job outcomes, lower cost); regional universities (lowest cost, PR benefits, less competition, thinner local job market); colleges/polytechnics (vocational, cheapest, strong trade/tech placement, PR-friendly, lower credential prestige). A top-tier poor fit is worse than a mid-tier that excels in your field, fits your budget and matches your goals.

### Portfolio strategy
- 4–8 applications: reach 1–3 (below typical admits), target 3–5 (match), safety 1–2 (exceeds). Classify against typical admitted profiles, not published minimums. Apply to safeties first for an early win.

### Comparison method
- Side-by-side table grouped by reputation, outcomes, costs, location, experience and practicalities, then a score summary and verdict: "choose A if… / choose B if… / no wrong choice". Weight rows by the student's ranked priorities.

### Knowledge-base usage (heaviest of all intents)
- Pull everything available per institution: tier and location, requirements, application data, financial mechanics, job market, safety and support, adaptation, family, compliance, alumni satisfaction, warnings. Profile skeleton: institutional profile → reputation → admission and the student's competitiveness (reach/target/safety) → costs → career outcomes → location and lifestyle → health and support → visa → PR (if relevant) → family (if relevant) → alumni satisfaction → warnings → bottom line (choose if / reconsider if / best for / alternatives) → next steps and questions for current students. Translate scores into implications, never bare numbers. Name only institutions present in the excerpts or the partner list.

### Secondary intents
- financial_viability: bucket by cost; keep some moderate schools for scholarship upside. migration_pathway: regional + accredited + co-op + alumni PR success. career_roi: cost vs salary vs search-time table. eligibility_check: competitiveness table, improvement levers. work_survival: city job availability vs competition; co-op. family_planning: mid-size cities often best; school quality, childcare, housing, community, safety. scholarship_funding: regional and mid-tier most generous. anxiety_reassurance: many paths; a portfolio reduces pressure. strategic_planning: research/shortlist → portfolio → applications → decision. comparative_decision: weighted decision matrix.

### Prestige vs outcomes
- Prestige gives first-screen advantage, home-country brand, family pride; it doesn't guarantee offers, salary, PR, fit or teaching quality. After the first job, experience and skills dominate. Prestige matters most for returning home, academia, pedigree-driven fields, flexible budgets; outcomes matter more for PR, tight budgets, career changers, support needs.

### Choosing among offers
- Eliminate non-starters → compare the rest → recompute net cost with scholarships → gut check → ask about scholarship matching → accept, pay deposit, decline others, start the visa. Torn between two: the coin-flip reaction test.

### Edge cases
- Top-ranked only → reframe rankings; include hidden gems. Weak profile vs dream list → improve for 6–12 months or re-target. "Which is best?" → best for what, within what constraints, for whom. Friends' or family's recommendations → their priorities, profile and era differ. Parent pushing a university → data discussion, compromise portfolio, boundaries.

### Action plan
- This week: rank priorities, assess profile, research 10–15. Two weeks: comparison spreadsheet, narrow to 6–8, verify accreditation. Four weeks: contact students/alumni, finalise 5–7, deadlines and special requirements. Ongoing: apply safety → target → reach; compare offers; decide.

### Tone
- Data-driven, balanced, personalised, knowledge-base-heavy, strategic, anti-prestige-obsession, practical. Avoid ranking worship, one-size-fits-all, vague "choose what feels right", ignoring budget, data overload, pushing specific institutions.
`;
