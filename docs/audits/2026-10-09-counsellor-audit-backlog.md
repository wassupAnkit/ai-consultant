# Edge backlog from the 9 Oct 2026 counsellor audit

## Status at 12 Oct 2026: re-audit after the 9 Oct batch

**Live in prod since 9 Oct ~11:40 UTC:** Edge `9739408ae900` (I1 drain, N9 latency caps, N23 rewrite currency, M9 re-routed excerpts) and crm-api `2c4379ff` on PR-680 (N4 reporting).

**Re-measured on 12 Oct** (same turns, order, users and rubric as 9 Oct; DeepSeek V4.1 Flash via DeepInfra):

| Measure | 9 Oct | 12 Oct |
|---|---|---|
| P1 South Asia, mean fulfil (43 turns) | 3.30 | 4.05 |
| P2 SE Asia, mean fulfil (47 turns) | 3.06 | 3.60 |
| P3 onshore + branch manager, mean fulfil (28 turns) | 2.71 | 3.71 |
| Accurate among fact-checked answers (P1 / P2) | 55% / 56% | 73% / 74% |
| Median latency (P1 / P2 / P3) | 44 / 53 / 30 s | 22 / 25 / 16 s |
| DeepThink answered (P1 / P2) | 1/5, 0/6 | 5/5, 6/6 |
| Silent truncation, "couldn't generate" | 3, 5 | 0, 0 |
| Answers citing another market's pages (P2) | 31/41 | 8/44 |
| Coverage eval, 217 questions: coverage / cited / official / honesty | 58% / 36% / 26% / 89.6% | 74% / 61% / 59% / 88.9% |
| Coverage eval p50 / p95 | 33 / 78 s | 21 / 31 s |

No P3 turn scored lower. Regressions: P1 bd06b, bd12, in09, bd04; P2 ph-02/03, lk-02, lk-07, th-02 (all covered by R1–R8 below). Artifacts: `data/eval/runs/audit/p*-oct12.md|jsonl` and `data/eval/runs/*-oct12-release.json` (gitignored).

**In progress:** official-page ingest (`feat/official-sources`): government pages indexed nightly with change detection, which addresses R3 and N24.

## New from the 12 Oct re-audit

| ID | Sev | Area | Issue | Evidence | Proposed fix |
|---|---|---|---|---|---|
| R1 | P0 | Rules | The 2 Oct 2026 family ban (most Student visa applicants can no longer include a partner or children) is in the AU facts register, yet funds totals and family messages still include the spouse and child, and a dependant visa is offered. | P3 a15–a17, P1 in11 | Round-0 check: a family member on an AU 500 case pulls the "Closed or replaced" row; answer states the exemption test first. Regression test. |
| R2 | P0 | Rules | Sponsor eligibility flips between runs: an uncle accepted as AU income-route sponsor (only parent or spouse qualifies); UK funds asked from an uncle. | P1 bd02, bd06 vs bd06b, bd12 | Facts-register rows for sponsor eligibility per destination; a sponsor-relationship cue forces them into round 0. |
| R3 | P0 | Rules | Rules with a known start date aren't applied to the student's lodge or entry date: old UK funds after 30 Nov 2026, 2-year Graduate visa for a 2027 entrant (18 months). | P1 in09, in03 | Pass the case dates (lodge, intake) to generate; register rows with future effective dates are flagged "from <date>". |
| R4 | P0 | Rules | The UK care-worker closure is applied to a registered nurse (says family cannot join). Correct on 9 Oct. | P2 ph-02, ph-03 | Scope the register row to care workers; nurse regression test. |
| R5 | P1 | Facts | US "duration of status" row is stale: a court blocked the rule on 14 Sep 2026; Edge says it was replaced on 15 Sep. | P1 np11, in05 | Update `docs/facts/united_states.md` (+ data copy); the official ingest flags such pages from now on. |
| R6 | P1 | Retrieval | "Not in the knowledge base" for figures the facts register holds (AU living costs, UK maintenance, PSW, spouse rights), worst in follow-ups, comparisons and DeepThink; Edge says it sees "four rows". | P2 lk-02, lk-07; P3 a09; P1 DeepThink | A core-facts card per destination (funds, fees, work, PSW, dependants) always added for visa/finance topics; widen the register excerpt for comparisons. |
| R7 | P1 | Calculations | Arithmetic is unchecked: BDT total 10x too high, Sydney 1,304 instead of 1,309, equal totals for pathways of different length, INR at unstated rates. | P1 bd04, in03, np13; P3 b01; P2 th-02 | A post-generation check that re-adds every table and verifies stated totals and currency conversions against evidence rates. |
| R8 | P1 | Fees | The ASEAN AUD 2,050 concession is not applied by nationality (2,000 or 2,500 quoted for Filipino and Thai students). | P2, six turns | Nationality-conditioned register row surfaced with the origin market. |
| R9 | P1 | Drafts | Internal text leaks into client drafts: "_(Check: … differs from the source answer)_", "Sources:" lines, `[n]` markers, empty "Not in KB" template fields. The draft check flags `रू` inside ज़रूरत. | P2 four drafts; P1 hygiene; P3 a17 | Strip check notes and source lines from drafts; whole-word currency match in `src/graph/draft-check.ts`. |
| R10 | P1 | Knowledge | The counsellor job map is indexed and cited to counsellors as "ground truth for auditing Edge", which also makes later audits circular. | P1 6 turns; P2; P3 a07, a12, a18, b08, b09 | Retitle it as a counsellor guide without audit wording, or remove it from `data/counsellor`; keep audit references out of the KB. |
| R11 | P1 | CRM | Still unanswerable: leads/prospects/clients per branch (no contact count tool), non-Sydney students (branch name never mapped to `branchId`), deals by assignee (no filter; opened a namesake). | P3 b01, b05, b06 | crm-api: contact counts, branch lookup by name, deal assignee filter. |
| R12 | P2 | crm-api | N4 follow-ups: index `enquiry_activities (enquiry_id, created_at DESC)` + ANALYZE; the legacy `completed` status (5,142 rows) is counted but can't be listed. | N4 verification | Migration for the index; map or allow-list `completed`. |
| R13 | P2 | Answer | DeepThink gives opposite recommendations on identical prompts. | P1 np12 vs np12n, in11 vs in11b | Lower temperature for DeepThink ranking; state the deciding criteria first. |
| R14 | P2 | Answer | A CRM stage guessed by the classifier is stated as a CRM fact for a user with no record. | P1 bd11 | Only say "CRM shows" for CRM evidence. |
| R15 | P2 | Safety | The Bangladesh helpline section is retrieved as a heading only, so no number is given. | P1 bd09 | Keep crisis-line tables whole in the market guide chunking. |
| R16 | P2 | Content | Gaps: PGWP field-of-study, UK child-visa consent, 590 no-work, nursing-board English; stale Expert pages (485 "2–6 years", AUD 24,505, £1,136/£1,483). | P2 | Content team; registers win meanwhile. |
| R17 | P3 | Ops | Jev classifier timed out on 8 of 47 turns at 4 s and fell back to Gemini. | P2 | Check Jev latency at OpenRouter; consider 6 s. |
| R18 | P3 | Knowledge | Official pages that refuse automated clients can only be reached by live search: USCIS, ICE/SEVP, travel.state.gov, Study in the States, US embassies; art.gov.au and dfat.gov.au time out. | official ingest probe | Keep them in the registers with "checked" dates; the eCFR API covers the F-1/M-1 regulations. |

## Status at 07:10 UTC, 9 Oct 2026

**Live in prod:**
- **Hotfix `57b642c35697`:** H1, H3–H15 and H7 (crm-api `1ae61c8f`).
- **Knowledge release `6e124179ea67`:**
  - **H2:** facts registers end stale AU rules and fees.
  - **N2:** facts registers for AU, NZ, UK, CA, US and scholarships.
  - **N11:** retrieval prefers the student's market.
  - **N5, N6, N7, N15, N16:** drafts, figure check on translations, citations, recall, CRM ambiguity.
  - **N21:** short-first answers and central-bank FX.
  - **N22:** neutral phrasing.
  - **N12–N14, N17–N19:** most stale figures, now in the registers or market guides.
  - **I2:** Bun 1.4.2 fixes the ingest OOM; verify after tonight's run.
  - **All guides are in the knowledge base:** 550 chunks.

**Remaining:**
- **Needs people:** N1 (content team), N3 (partner discovery), N8 (Ops playbooks), N10 (write-card QA).
- **Built, awaiting Postgres verification:** N4 (crm-api `5afbabd2`).
- **Open:** N9 latency, N20 grade conversion, and P2/P3.
- **New:**
  - **N23 (shipped 9 Oct, `9739408ae900`):** rewrites in a home language added unsourced NPR conversions. The figure check flags it, but the rewrite should keep the source currency unless a central-bank rate is in evidence.
  - **N24:** facts registers need a refresh owner and schedule. Every file lists its next review dates; assign compliance.


**Sources:**
- Counsellor-persona audits: P3 onshore Sydney counsellor and branch manager with the real CRM (`p3-onshore-crm.md`); P1 South Asia and P2 Southeast Asia (still running, appended when they land).
- DeepSeek coverage eval: release vs no packs, 217 questions (`final-*.json`).
- Counsellor job map (`counsellor-job-map.md`).
- Classifier gold set review (`data/eval/review/intents-deep-disagreements.md`).
- E2E and release work on 8–9 Oct.

**Severity:**
- **P0:** wrong or unsafe answers, fixed in today's hotfix.
- **P1:** high-impact, next sprint.
- **P2:** important.
- **P3:** polish, infra or process.

**Turn ids:** a/b-numbered ids (a03, b02, …) are P3 audit turns.

## P0: being fixed in today's hotfix

| ID | Area | Issue | Evidence | Fix in hotfix |
|---|---|---|---|---|
| H1 | CRM routing | Follow-up turns about a named student skip CRM tools, then claim the record is empty ("no enquiry/deal/application") or that "the lookup returned nothing". | a03, b03 | Carry the prior CRM student forward, force research and an overview read on follow-ups, and add an answer guard: never claim CRM data is empty without a lookup this turn. |
| H2 | Freshness | Stale Expert pages beat current rules: visitor→student onshore said to be "generally yes" (banned since 1 Jul 2024), 485 fee A$4,600 (now A$5,750), dependant fees A$1,225/A$400 (now A$1,530/A$500), A$2,000 visa charge "unresolved" (A$2,500), "40 h/fortnight" and "GTE" presented as current. | a09, a10, a15–17, b07 | Official-domain web evidence in round 0 for rule, fee and policy topics; source-precedence rule (official > Expert or partner pages); superseded rules never stated as current. |
| H3 | Reasoning | Disputed facts don't trigger research, and Edge denied what it had said earlier in the same session. | a11 | A dispute or recency phrase forces research; the answer may explicitly correct an earlier statement. |
| H4 | Compliance | Coached a manager to push back on an onshore-transfer commission refusal, which the National Code has banned since 31 Mar 2026. No agent-compliance corpus exists. | b07, b08 | Cited compliance guides (AU National Code Std 4, OMARA, UK AQF/OISC, CICC, IAA, US, Nepal/Vietnam rules) as citable evidence, plus a never-coach-a-breach rule. |
| H5 | Calculations | Family OSHC for 2 years estimated at A$2.4–3.6k (real: A$11–14k); headline total ≠ its own table; a coursework-Master's spouse wrongly capped at 48 h/fortnight. | a15, a17 | Show the formula and itemised sources; never estimate insurance or fees from memory; totals must equal the sum; keep units consistent. |
| H6 | Packs | Destination checklists hurt comparisons (cov 75 vs 88), university selection (31 vs 43), program selection (48 vs 56) and test prep (70 vs 83). | final eval | No destination pack for those topics; market guidance stays. |
| H7 | crm-api | The `crm_list_enquiries` status filter is ignored; tasks lack a contact id, so "Call Suman" matched the wrong Suman. | b02, a01 | Fix the filter; add contact and enquiry ids to task rows. |

## P0 additions from the SE Asia audit (also in this hotfix)

| ID | Area | Issue | Evidence | Fix in hotfix |
|---|---|---|---|---|
| H8 | Answer | DeepThink failed 6/6: the fallback model started on the primary's already-expired deadline; effort high overran at DeepInfra's throughput. | p2 DeepThink turns | Fallback gets its own budget; DeepThink effort medium; timeouts fit the request budget. |
| H9 | Answer | 7% of answers were silently truncated mid-sentence at the time limit and returned as normal answers. | p2 (3/41) | Visible "cut off — ask me to continue" note, plus a `truncated` flag in meta. |
| H10 | Routing | An explicit nationality lost to a city mention: "our Makati branch… Indian national from Kerala… currently in Manila" was routed as Philippines. | se-ph-07 | Nationality and demonym signals outrank bare city names; location cues ("our … branch", "currently in") aren't origin. |

## P0 additions from the South Asia audit (also in this hotfix)

| ID | Area | Issue | Evidence | Fix in hotfix |
|---|---|---|---|---|
| H11 | Answer | Runaway output: a Bangla draft ended with ~12 KB of citation numbers; dangling citations from earlier turns. | p1 | Degenerate-repetition guard plus a hard cap, with a visible "cut off" note; strip dangling [n]. |
| H12 | Safety | "Make it shorter for the parent" invented facts: NPR 35 lakh vs 61–75 lakh, a false IELTS 7.0 rule, a contradicted sponsor rule. | p1 | Rewrite turns may only use facts from the previous answer and this turn's evidence; the previous answer is kept in full. |
| H13 | Safety | Self-harm cues in Bengali and Hinglish weren't recognised (Romanized Nepali was). | p1 | Multilingual distress detector, helpline evidence search, safety-first answer instruction. |
| H14 | Compliance | "MARN-registered agent" in UK, US and Canada answers (Australia-only credential). | p1, p2 (~15 answers) | Destination-specific adviser disclaimer (OISC, RCIC/CICC, IAA, DSO/attorney). |
| H15 | Routing | "Dutch-Bangla Bank" → Netherlands; "uncle in Dubai" → UAE destination; a past refusal country pulled into comparisons; "500 file" not recognised as Australia. | p1 | Bank-name and relative-location cues; refusal-country handling; "500 file" trigger. |

## P1: next sprint

| ID | Area | Issue | Evidence | Proposed fix | Owner |
|---|---|---|---|---|---|
| N1 | **Website content** | Stale public pages are ingested as knowledge: the experteducation.com/india AU visa page (onshore switching), agent pages with "40 h/fortnight" and "GTE", and pages with the A$2,000 visa charge. | a09, a10, b07 | Content team corrects the pages; re-ingest; add a staleness report (pages whose rules contradict official evidence). | Content + Edge ingest |
| N2 | Knowledge | No dated "current rules" register: fees, work hours, funds thresholds and post-study work by destination, each with an effective date. Packs are fact-free by design, so the figures have to come from somewhere maintained. | a09–a17, job map (~20 "live figures") | A versioned, cited facts register per destination (official source, effective date, next review), ingested as evidence; refresh on policy change; owned by compliance. | Edge + Compliance |
| N3 | Knowledge | Program catalogue gaps: UTS and WSU Master of IT fees, durations and CRICOS missing (empty comparison). University selection covers 31%, program selection 48%. Only Australian partners are crawled; other markets need partner discovery. | a16, final eval | Partner discovery for UK/CA/US/NZ; crawl the main Sydney providers; program-extraction QA; add 485 duration by qualification. | Edge ingest |
| N4 | CRM capability | **Shipped 9 Oct:** crm-api `2c4379ff` on PR-680, verified read-only 123/123. Follow-ups in R12. No reporting: pipeline by branch × status, aged or cold leads and per-counsellor views are unanswerable. Lists have no created, updated or last-activity dates; there are no branch, assignee, age or count filters. | b01, b02, b05, b10, a02 | crm-api: add date fields to list rows, filters (branch, assignee, status, age), and a counts/aggregation MCP tool. | crm-api |
| N5 | CRM behaviour | Wrong record opened when an assignee's name was searched as a contact; silent disambiguation ("Call Suman" bound to one of several Sumans); totals inferred from one page ("no contacts outside Sydney"). | b06, a01, b05 | Prompt and tool rules: list candidates when a name is ambiguous; never infer totals from a page; use counts once N4 exists. | Edge |
| N6 | Translation | Units and numbers change in translation: "48 h per fortnight" became "48 hours per week" in a Nepali draft. | a17 | Back-check number and unit tokens in non-English drafts; glossary per language (fortnight → पन्ध्र दिन). | Edge |
| N7 | Citations | "Based on [3][5]" printed with no sources; citations that aren't in that turn's sources. Eval: only ~36% of covered items are backed by a supporting citation. | a03, a05, a17, b05; eval | Strip or repair dangling markers; carry forward prior-turn sources when relied on; prompt work on per-item citations. | Edge |
| N8 | Internal knowledge | Expert's internal playbooks are missing: offer acceptance / pre-CoE checklist, student-welfare escalation, complaint procedure and timeframes, commission and clawback policy, ART refusal-review deadlines. | a05, a12, b09 | Ops supplies the documents → staff upload → knowledge base. | Expert Ops + Edge |
| N9 | Latency | **Shipped 9 Oct** (`9739408ae900`): 16 s round timeout, urgent turns 0 model rounds, short-first 2, `latency:report`. Re-audit medians fell by about half (see 12 Oct status). Knowledge turns take 35–62 s (p95 78 s in eval); an urgent distress turn took 52 s. DeepInfra runs DeepSeek at ~35–45 tok/s. | a12, b09, eval | Stream the action-first part early for urgent topics; tune the research budget and rounds; consider a faster US provider for DeepSeek (data-protection review) or a faster model for simple lookups. | Edge |
| N10 | Write proposals | CRM write proposals (approval cards) weren't tested at prod parity, because the audit backend had `CRM_WRITE_TOOLS_ENABLED` off. | a06 | Re-run the write and welfare-note scenarios with writes on. | QA |

| N11 | Retrieval | Cross-market contamination: 76% of SE Asia answers with sources cited Expert pages written for a different market (e.g. Nepal/India pages for a Vietnamese student). | p2 | Prefer KB chunks whose `metadata.market` matches the student's origin market, else global pages; down-rank other markets. |
| N12 | Knowledge | More stale or closed items stated as current: Canada SDS offered in a parent script (closed), MD111, old AU fees (AUD 2,000/1,600/710), CAD 22,895 (now ~23,448), old UK funds figures, an old minimum wage, Chevening said to be open (closed 6 Oct), UK care-worker visa (closed to new overseas applicants Jul 2025). | p2 | N2 facts register plus a "closed programmes" list; H2's official-first evidence should catch most of these. Re-audit after the hotfix. |
| N13 | Knowledge | Wrong AU rules: an offshore refusal is "appealable within 21 days" (offshore applicants generally have no appeal); a sibling sponsor can use the income route (only parents or a spouse can). | p2 | N2 register plus eval cases. |
| N14 | Market depth | Thailand: sent the family to the Australian embassy for the military deferment certificate (it's a Thai process); no OCSC scholarships. Philippines: no DMW/OEC rules for nurses, no NMC registration steps or fees. Sri Lanka: A/L grades scored on the UK A-level points scale; external degrees and 3-year general degrees unknown; Foreign Ministry attestation suspension (May 2026) not used, though it's in the market guide. | p2 | Deepen the market guides and their excerpt selection (topic → section mapping); eval cases per market. |
| N15 | Drafts | "Based on: [n]" lines inside client-facing drafts; channel not localised (WhatsApp/Viber offered for Vietnam instead of Zalo); UK and Canada cases referred to a "MARN-registered agent" (an Australian credential). | p2 | Draft rule: no citation markers inside client text (put sources after the draft); market channel norms; destination-specific adviser referral (H4 compliance guide covers OISC/CICC/IAA). |
| N17 | Knowledge | The same fact differs by student market: Canada funds CAD 23,448 in India answers vs 22,895 in Nepal/Bangladesh answers; the US $250 integrity fee known in one market, missing in another. | p1 | One dated destination facts register shared by all markets (N2); avoid market-specific stale pages (N11). |
| N18 | Knowledge | Scholarship facts stale or incomplete: Chevening recommended after it closed 6 Oct 2026; Commonwealth Master's filed "now" without the nominating agency. | p1, p2 | Scholarship calendar with open/close dates in the facts register; official scholarship domains in packs. |
| N19 | Knowledge | Missing common facts: AU refund rule on visa refusal (lesser of 5% or AUD 500), part-time work hours (UK/AU), UKVI acceptance of Indian bank loan letters, GCMS notes, GIC refund, Nepal NOC fee and turnaround, opening a Bangladesh Bank student file. | p1 | Facts register plus market-guide depth. |
| N20 | Accuracy | Told an Indian family 58% is below a UK 2:2 (Leeds lists 55%, Birmingham 50–55%), pushing the student down-market. | p1 in02 | Grade-conversion tables per university, with citations; avoid generic thresholds. |
| N21 | UX | No currency conversion (NPR/INR/BDT/VND/PHP/THB/LKR); answers run 4–10k chars for WhatsApp-style questions. | p1 | Live FX evidence (dated) for home-currency totals; a length rule: short answer first, details on request. |
| N22 | Cultural | Hinglish reply to a likely Punjabi (Sikh) student said "Allah na kare", and made up a loan-repayment claim. | p1 | Culturally neutral phrasing rule for drafts; no religious idioms unless the user uses them. |
| N16 | Memory | "Not in the knowledge base" for figures quoted a few turns earlier (AU work hours, living costs, family funds, UK funds). | p2 | M10 (keep recent answers in full) plus carrying forward sources relied on in earlier turns. |

## P2: important

| ID | Area | Issue | Evidence | Proposed fix |
|---|---|---|---|---|
| M1 | Knowledge | Onshore basics are thin: Bridging Visa A on a valid onshore lodgement, evidence for a further onshore 500, 8104 dependant work rules, 485 durations. | a09, a16 | Covered by the N2 register plus onshore content. |
| M2 | Knowledge | Lifestyle, accommodation and arrival topics cover ~30% in the eval. | final eval | Ingest accommodation, banking and health-access pages from partners and official student portals. |
| M3 | Knowledge | Outdated legal concept stated (ESOS "section 20 notice", abolished 2012–13). | a08 | Compliance guide (H4) plus an eval case. |
| M4 | Wrong data | Bikash Poudel was given Dikchya Dahal's MARN. | b09 | Check the experteducation.com team pages and chunking; add an eval case for MARN lookups. |
| M5 | Routing | The classifier adds countries named only as analogies or context ("Australia jasto PR", a sponsor's UAE job, a prior-refusal country). | gold set | Classifier prompt and Jev rubric: a destination is where the student plans to study. |
| M6 | Routing | Missed destination cues: "GS", lowercase "uk uni", ELICOS, "from NZ", IRCC. | gold set | Extend the country registry triggers (careful with ambiguity). |
| M7 | Routing | Origin misses in Romanized Nepali with fewer than 2 cue words, Hinglish, Romanized Bangla. Mostly covered by the counsellor-region default, but onshore offices have no default. | gold set | Language-cue lists; per-onshore-office default market setting. |
| M8 | Classifier | Main confusions: alternative_pathways→program_selection, career_roi→migration_pathway, work_survival→onshore_support; 80 gold rows need human review. | `intents-deep-disagreements.md` | Human review, then Jev rubric updates. |
| M9 | Routing | **Shipped 9 Oct** (`9739408ae900`). Market-guide excerpts aren't refreshed when a CRM-student record changes the origin or destination after research. | release notes | Re-select guide excerpts in generate after `withCrmStudent`. |
| M10 | Self-reference | The model can't reliably quote what it said earlier: history is truncated to 3,000 characters per message. | a11 | Keep the last 2 assistant answers in full when the user refers back. |
| M11 | Frontend | The frontend sends no counsellor market or profile, and there's no UI to override the market. | release work | User-menu market picker → `PATCH /v1/profile {market}`. |

## P3: infra, process, eval hygiene

| ID | Area | Issue | Proposed fix |
|---|---|---|---|
| I1 | Infra | **Shipped 9 Oct** (`9739408ae900`, grace 160 s). The server drains for 15 s and force-exits at 25 s on SIGTERM; turns run up to 120 s, so rollouts cut answers mid-stream (grace period 45 s, preStop 15 s). | Make the drain follow `REQUEST_TIMEOUT_MS`; set grace ≥ preStop + drain + flush. |
| I2 | Infra | Nightly ingest pods are OOMKilled (13–14 h before the 9 Oct deploy). | Infra to review the ingest job memory (peer's per-job resources). |
| I3 | Process | Pushing to master doesn't trigger CodeBuild; the gitops push-back token is read-only; ArgoCD has no auto-sync. | Webhook or CodePipeline trigger; writable gitops token; document the release runbook. |
| I4 | Infra | ArgoCD shows the Deployment permanently OutOfSync after sync (field-defaulting diff). | Add `ignoreDifferences` for the defaulted fields. |
| I5 | Dev | The local `.env` has a partial GOOGLE_WORKSPACE config that `loadEnv` rejects, so every script needs overrides. | Fix the local env, or make the Workspace config validation a warning in dev. |
| I6 | Dev | The dev Langfuse holds old prompt versions (missing the pack placeholders). | `prompts:push` to dev, or retire Langfuse prompts. |
| I7 | Eval | Coverage-set `mustCover` labels were written by agents and judged by Gemini only. | Consultant review of a sample; add a second judge. |
| I8 | Eval | Fan-out stays off (fewer citations, +29% tokens). | Revisit after N7. |
| I9 | Cost | Answer-cache decision pending real prod repeat rates. | Run `cost:report` on prod after 2 weeks of traffic. |

## Capability gaps, by design (not bugs, but counsellors notice)

Edge can't:
- send WhatsApp, SMS or email (Gmail drafts only);
- take attachments or document uploads in chat;
- check provider portals, UCAS, ImmiAccount or IRCC status;
- create CRM tasks or reminders (proposals for notes and enquiries only);
- produce staff-performance analytics (needs N4).

These map to job-map items #22–25 (pipeline, status tracking, logging, stalled cases).
