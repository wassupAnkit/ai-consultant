# Source-market research analyses

One cited analysis per source market Expert recruits from: [Nepal](nepal.md), [India](india.md), [Bangladesh](bangladesh.md), [Vietnam](vietnam.md), [Philippines](philippines.md), [Thailand](thailand.md), [Sri Lanka](sri_lanka.md). They were researched in October 2026.

## What they are

- **Research for people.** Each file covers one market: student goals and segments, family and decision norms, grading, money and foreign exchange, origin-side documents, how each destination treats the nationality, integrity risks, agent regulation and a seasonal calendar. Every claim links to its source. Figures are marked "as of". A claim that could not be confirmed says "not verified" (or similar).
- **Indexed in the knowledge base.** These are facts with sources, so every section is indexed for search (`bun run ingest:guides`, `source: guide:market/<slug>`, run nightly by the ingest CronJob; see `src/ingest/guides.ts`). Re-check anything marked "as of" before you edit one; the next ingest re-embeds only the sections that changed.
- **The source for the market packs, not part of them.** Edge's market packs carry no facts:
  - `src/prompts/markets.ts` holds the prose (`MARKET_PROMPTS`, Langfuse `edge-consultant-market-<slug>`).
  - `src/skills/markets/<slug>.ts` holds the official domains, the query vocabulary and the draft language.

  Both are derived from these files but keep only shape and traps: which steps, which authorities, what to check, and how scrutiny shifts, stated qualitatively. They contain no digits, amounts, dates or percentages. `tests/market-packs.test.ts` enforces this, along with the 300–450 word range and the research-backed domains. Every figure in an answer has to come from cited evidence at answer time.

- **Citable evidence at answer time.** When market packs are on and a market is resolved, research round 0 adds up to three excerpts of the market's file as numbered evidence (`src/skills/market-guides.ts`, source `market-guide:<market>`): section 5 (origin-side steps) or 4 (money) by topic, and each routed destination's part of section 6. The runtime reads copies in `data/markets/` (the image ships `data/`, not `docs/`): after editing a file here, copy it to `data/markets/`; `tests/market-guides.test.ts` fails until the two match. Keep the numbered `## N.` headings and one destination per `###` heading, bold lead line or table row in section 6.

## Keeping packs in line with the research

- **Domains.** A pack's `officialSources` lists only domains that the analysis names or cites, or that are unambiguously official. Those domains go on the live-fetch allowlist, which matches them suffix-wise. Fix a wrong domain in the pack and in the analysis together.
- **Unverified claims.** A claim marked "not verified" in an analysis either stays out of the prose, or appears there as "check the current rule with <authority>".
- **Versioning.** After a pack changes, bump its `version` (for example `2026-10-08b`) so that turn metadata (`marketPack: slug@version`) shows which text answered. Then run `bun run prompts:push` to update the Langfuse copies.

## When to refresh

Refresh an analysis, and then its pack, in any of these cases:

- a market changes a rule the pack names, such as a ministry, an approval, foreign-exchange rules, police clearance, apostille or legalisation, or agent licensing;
- a destination changes its scrutiny of the nationality;
- six months have passed.

Check the open items below first.

### Open "not verified" items per market

**Nepal**
- Whether the NOC portal domain changed after the ministry split (Ministry of Education and Sports).
- NOC fee and processing time (these figures come from consultancy guides only).
- Current NRB tuition and living ceilings, and the reported rule that all later payments must go through the same bank.
- Whether the consultancy regulations were amended after July 2026.
- Australia's treatment of three-year bachelor's degrees, and US and Canadian treatment per institution.
- The UK visa centre's current address.
- Whether UK universities restrict Nepal recruitment as they do Bangladesh.
- The US F-1 refusal rate and the duration-of-status rule (press only).
- A Canada approval rate for Nepal.
- Ireland data.

**India**
- Final enacted TCS rate on self-funded education remittances under the new Income Tax Act (Budget 2026–27 proposal).
- India's Australian evidence level after the reported March 2026 revision.
- Whether the Overseas Mobility (Facilitation and Welfare) Bill has been enacted.
- Any single backlog cap that applies across destinations (none found).

**Bangladesh**
- Whether the QR-code statement rule is fully rolled out.
- Whether UK university recruitment pauses are still in force.
- WES treatment of the National University Pass degree.
- The official board grading circular.
- O and A level administration.
- National norms for medium-of-instruction letters.
- Bangladesh-specific approval rates for Canada, New Zealand and Ireland.
- Status of the Indian visa centres used for Schengen processing in New Delhi.
- The remit of BOESL and BMET.
- Post-election stability.
- The HSC 2026 result date.

**Vietnam**
- Which destinations, if any, objected to Vietnam's apostille accession.
- Vietnam's Australian evidence level after the March 2026 revision.
- WES's Vietnam-specific requirements.
- Visa centre locations for Canada and New Zealand.
- Whether the Social Policy Bank loan excludes study abroad.
- A Canada approval rate for Vietnam.

**Philippines**
- The CHED eCAV memorandum itself (it is known only from a school notice).
- BSP documentary thresholds for outward education remittances.
- Whether the Philippines' raised Australian risk level is official.
- NMBA stream for Philippine nursing qualifications (secondary source only).
- Australia's visa centre location.
- A Philippines-specific Canada approval rate.
- An official age profile of applicants.

**Thailand**
- Current BOT documentary thresholds for an individual's outward education remittance.
- Whether the Student Loan Fund can fund a foreign degree.
- Overseas-education loan terms at Thai banks.
- Australia and Canada visa centre locations.
- Whether the Chiang Mai consulate takes F-1 interviews.
- Thailand's Australian evidence level (no change reported).
- A Canada approval rate for Thailand.
- The foreign-cash declaration threshold (sources conflict).
- The date the apostille takes effect, and which destinations object to it.

**Sri Lanka**
- Whether the foreign ministry's e-DAS attestation service has resumed.
- Whether any outward-remittance order is in force.
- Whether PFCA Direction No. 04 of 2021 has been amended.
- The pre-verification route for degree authentication.
- The current list of private degree-awarding institutes.
- How sworn translators are appointed.
- Destination acceptance of medium-of-instruction letters.
- Panel clinics for Canada and New Zealand.
- Approval rates for the UK, Canada, the US and New Zealand.
- Whether any UK university has paused Sri Lanka recruitment.
- The size of the diaspora and English use among Colombo families.
- The 2026 A/L result date.
