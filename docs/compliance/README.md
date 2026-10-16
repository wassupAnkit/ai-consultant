# Compliance guides

Cited guides to the rules Expert counsellors work under: what an education agent may and may not do for each study destination, where education-agent work ends and regulated immigration advice begins, and how each source market regulates agencies. Researched 9 October 2026.

| File | Covers |
|---|---|
| [australia.md](australia.md) | ESOS Act and National Code 2018 Standard 4, Standard 7 transfers, the 2026 ban on commission for onshore transfers, commission reporting and agent-outcome data, agent quality schemes, immigration assistance and OMARA/MARN checks, complaints |
| [united_kingdom.md](united_kingdom.md) | Regulated immigration advice (OISC, now the Immigration Advice Authority), what an unregulated adviser may say, the UK Agent Quality Framework, BCA thresholds, commission, complaints |
| [canada.md](canada.md) | IRPA s.91, CICC and RCICs, using a representative, what an unlicensed agent may do, DLI and LOA integrity, complaints |
| [new_zealand.md](new_zealand.md) | Immigration Advisers Licensing Act 2007, the offshore student-visa exemption, the Pastoral Care Code, agents and commission, complaints |
| [united_states.md](united_states.md) | No agent licensing, Title IV scope, who may give immigration legal advice, F-1 interview preparation limits, AIRC and NACAC, complaints |
| [source-markets.md](source-markets.md) | Agency regulation in Nepal, India, Bangladesh, Vietnam, the Philippines, Thailand and Sri Lanka, and rules that apply in every market |

## Why they exist

A counsellor audit (October 2026) found Edge coaching a branch manager to push back on a university that refused commission for an onshore student transfer. Australia's National Code forbids it: Standard 4.7 (in force 21 January 2026) bars a provider from paying an agent commission for a student who started with another provider, for students accepted from 1 April 2026 (see [australia.md](australia.md) §4). Nothing else in the knowledge base stated an agent's legal limits, so Edge could not cite them. These guides are that evidence.

## How Edge uses them

- **Citable evidence at answer time.** With SKILL_PACKS_ENABLED or MARKET_PACKS_ENABLED on, research round 0 adds up to two excerpts as numbered evidence (`src/skills/compliance-guides.ts`, source `compliance-guide:<slug>`, url `compliance-guide://<slug>#<anchor>`) when the question is a compliance one: the topic is `compliance_ethics`; or the message mentions commission, a provider transfer, a release letter, agent obligations, migration or immigration advice, MARA/OMARA/MARN/OISC/CICC/RCIC/IAA, ethics or a complaint; or the topic is `onshore_support` and the student is changing provider or course.
  - **Destination excerpt:** the first routed destination with a guide (else the destination a regulator term names, such as OMARA → Australia), and within it the `## N.` section whose keywords best match the message (section 1, the bottom line, when none match).
  - **Source-market excerpt:** the routed origin market's section of `source-markets.md`.
- **A research tool the planner calls itself.** With the same flags on, the research model is offered `search_compliance_guides` (`src/tools/compliance.ts`), for anything round 0 did not add: another angle (the complaint route after the commission rule), another destination, or a home market. It ranks sections by the same keywords plus the query's words in each section's title and body, searches only the guides a query names (by country or regulator, plus source markets) when it names any, and returns the top two as numbered evidence. Passing one guide and a section number reads that section directly; the tool description lists every guide's section titles, so the planner can do that without searching. Sections already collected come back as their citation number.
- **The answer prompt** (`src/prompts/consultant.ts`, rule 10a) tells the model never to coach a breach, to cite the guide, and to refer migration advice to the destination's registered or licensed adviser.

## Editing rules

- The runtime reads copies in `data/compliance/` (the image ships `data/`, not `docs/`). After editing a file here, copy it to `data/compliance/`; `tests/compliance-guides.test.ts` fails until the two match.
- Keep the `## N. Title` headings (sections are excerpted one at a time, at most 1,800 characters each, so keep a section self-contained), the `<!-- keywords: … -->` line directly under each heading (it decides which section a question gets), and no `###` or tables inside numbered sections. In `source-markets.md`, a market's section title must be exactly its name (`## 1. Nepal`).
- Every claim links to its source; official sources first, others marked *(secondary)*; time-sensitive facts carry "as of"; anything unconfirmed says "not verified".
- Update the "Researched …" date in the header when you re-research a file; it becomes the excerpt's `updated` date.

## When to refresh

- A destination changes agent or migration-advice rules (e.g. a National Code amendment, OMARA or IAA reforms, IRCC agent rules, UK AQF becoming mandatory).
- A source market changes agency licensing (Nepal's 2026 regulations are being contested by ECAN; Vietnam's decrees change often).
- Six months have passed.
- After an edit, copy the file to `data/compliance/` (the drift test fails until they match). The nightly ingest re-indexes the changed sections into the knowledge base (`source: guide:compliance/<slug>`, `bun run ingest:guides`).
