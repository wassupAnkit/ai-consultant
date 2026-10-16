# Edge — Expert Education Consultant Assistant

Production backend for **Edge**, the internal AI assistant for consultants and
staff at [Expert Education & Visa Services](https://experteducation.com). Edge
helps with any work task a consultant has — knowledge-base lookups, comparisons,
drafting messages, eligibility checks, document review, process questions —
grounded in a knowledge base crawled from experteducation.com's market sites and
partner universities. There is no topical scope gate; only prompt-injection
attempts are refused.

Stack: **Bun** · **LangGraph / LangChain JS** · **Google Gemini** · **MongoDB
Atlas** (vector + text search, chat memory) · **Langfuse v5** (tracing, prompt
management, feedback) · deployed with Helm on EKS.

```
POST /v1/chat            ─┐
POST /v1/chat/stream     ─┤   Bun.serve → auth (x-api-key | Edge session JWT) → rate limit
                          │
                          ▼
                 ┌──────────────┐   prompt injection   ┌────────┐
   input ───────►│   classify   │──────────────────────►│ refuse │──► answer (no model call)
   history       │ (Gemini,     │                       └────────┘
   profile       │  structured) │  needs_research=false  ┌──────────┐
                 └──────┬───────┘────────────────────────►│ generate │──► answer + sources
                        │ needs_research=true             └────▲─────┘
                        ▼                                      │
                 ┌──────────────┐  top-k chunks                │
                 │   retrieve   │──────────────────────────────┘
                 │ hybrid: vector + text, RRF fused, country filter
                 └──────────────┘
```

## Quick start

```bash
bun install
cp env.example .env            # fill GOOGLE_API_KEY (and API_KEY, GOOGLE_OAUTH_CLIENT_ID + SESSION_SECRET for sign-in)
docker compose up -d mongodb   # MongoDB Atlas Local (vector + text search) on :57017
bun run db:setup               # indexes + Atlas search indexes (idempotent)
bun run ingest                 # crawl experteducation.com (all markets) into the knowledge base
bun run dev                    # http://localhost:3000
bun run smoke                  # health → chat → stream → refusal
```

Checks: `bun run typecheck` · `bun test` · `bun run eval:intents` (golden set, needs a Gemini key).

**Golden facts** (`data/eval/golden-facts.jsonl`, `src/eval/golden.ts`): exact-value regression
cases generated from the facts registers, one per verified register row with a checkable figure
(money, percentages, quantities with a unit), plus stale figures to catch ("previously AUD2,000",
"Replaced by …" rows). An answer passes only when it states every current figure; one that gives a
stale figure without the current one is `stale`. No judge model. `bun run golden:build` rewrites
the file after a register edit (`bun test` fails until it is in sync). Run it against any Edge:

```bash
bun run eval:golden -- --url http://localhost:3000 --api-key "$API_KEY" --sample 40           # quick
bun run eval:golden -- --url … --api-key … --repeat 3 --label nightly                         # + consistency
bun run eval:golden -- --url … --api-key … --min-pass 0.85 --max-stale 0.02                   # release gate (exit 1)
kubectl exec <pod> -- sh -c 'bun scripts/eval-golden.ts --url http://localhost:3000 --api-key "$API_KEY" --sample 40 --out /tmp/golden.json'
```

It checks that answers agree with the registers; whether the registers agree with the
government pages is `bun run official:changes` (official pages are re-crawled nightly).

## API

All routes except `/health`, `/healthz`, `/readyz` require authentication:

| Header | Who | Notes |
|---|---|---|
| `x-api-key: <API_KEY>` | trusted servers (the Next.js frontend) | may add `x-user-id` (or body `userId`) to scope sessions |
| `Authorization: Bearer <Edge session token>` | anyone signed in with Google (`POST /auth/google`) | HS256 signed with `SESSION_SECRET`; any verified Google account, no domain restriction |
| `Authorization: Bearer <Supabase access token>` | legacy frontend | only when `SUPABASE_URL` is set |

Both may be sent together; the user identity wins for session scoping. A signed-in
user is always scoped to their own email — `userId` is honoured only for `x-api-key` callers.
KB-admin rights (partner registry, reindex, deleting others' uploads) are controlled
separately by `ADMIN_EMAILS`, not by sign-in — set it explicitly in every deployed
environment, since leaving it empty makes every signed-in user an admin. Gmail/Drive/
Calendar connect (`/v1/integrations/google/connect`) keeps its own, separate domain
gate, `GOOGLE_WORKSPACE_ALLOWED_DOMAINS`.

### `POST /auth/google`
`{ "credential": "<Google ID token from Google Identity Services>" }` →
`{ token, expiresIn, expiresAt, user: { id, email, name, picture } }`. Requires
`GOOGLE_OAUTH_CLIENT_ID` + `SESSION_SECRET`. The frontend keeps `token` in an HttpOnly
cookie and forwards it as `Authorization: Bearer`.

### `POST /v1/chat`
```json
{ "message": "How much does it cost to study a masters in Australia?",
  "sessionId": "optional-uuid", "newSession": false,
  "userData": { "office": "Kathmandu", "markets": ["nepal"] } }
```
Response: `answer` (also `result` for legacy clients), `sessionId`, `requestId`, `traceId`, `mode`
(always `"consultant"`), `refused`, `intent {primary, secondary, task, needsResearch, confidence,
inScope, destinations, flags, language}`, `sources [{n, url, title, section, excerpt, docType,
country, score}]`, `disclaimer`, `latencyMs`.

Identified users who omit `sessionId` continue their most recent conversation; send
`newSession: true` to start over. `userData`/`profile` is any JSON object with the
consultant's own context (office, markets, specialisations); it is size-capped and used to
personalise the answer. A `mode` field is still accepted on the request for backward
compatibility with older clients, but is ignored — Edge has a single persona.

Edge cites every fact from the knowledge base with `[n]` and says "Not in the knowledge
base:" instead of guessing. It has no topical scope gate — it will draft messages, review
documents, compare programs, or reason over pasted text as asked — and refuses only
prompt-injection attempts (`intent.flags` includes `prompt_injection_attempt`).

### `POST /v1/chat/stream`
Same body. Default is Server-Sent Events; add `?format=ndjson` (or
`Accept: application/x-ndjson`) for newline-delimited JSON, which is what the
frontend's existing stream reader parses:

```
{"event":"meta","data":{"requestId":"…","assistant":"Edge","mode":"consultant"}}
{"event":"status","data":{"stage":"classifying"}}
{"event":"intent","data":{"primary":"financial_viability","task":"lookup","needsResearch":true,…}}
{"event":"status","data":{"stage":"researching"}}
{"event":"tool","data":{"tool":"search_knowledge_base","status":"start","label":"Searching knowledge base: Monash MIT fees"}}
{"event":"tool","data":{"tool":"fetch_page","status":"end","label":"Reading page monash.edu/study/…","url":"…","ms":812,"ok":true}}
{"event":"status","data":{"stage":"answering"}}
{"event":"thinking","data":{"chunk":"The student asked about fees, so "}}
{"event":"token","data":{"chunk":"Tuition "}}
…
{"event":"done","data":{"sessionId":"…","answer":"…","sources":[…],"research":{"rounds":2,"toolCalls":3,"liveUrls":[…]},"disclaimer":null,"followUps":[]}}
{"event":"session","data":{"sessionId":"…","title":"Monash MIT fees and intakes"}}
{"event":"suggestions","data":{"requestId":"…","items":["Which scholarships apply to this course?","…"]}}
```
`status`, `tool` and `thinking` events are additive (older clients ignore them). Errors
after the stream starts arrive as `{"event":"error","data":{code,message}}`.

`done` ends the answer. Two cosmetic events may follow it while the consultant is already
reading, both produced by the cheap `GEMINI_TURN_EXTRAS_MODEL` after the fact: `session`
(the first turn of a conversation only — a model-written title, which also replaces the
provisional first-80-characters title in `GET /v1/sessions`, but never a title the owner
typed) and `suggestions` (up to three follow-up questions, also stored with the turn as
`followUps` for history). Either is skipped when the call fails or the turn was refused;
`TURN_EXTRAS_ENABLED=false` turns both off. Send `regenerate: true` with a `sessionId` to
answer the newest question again: the stored last human+assistant pair is removed first, so
history keeps one answer per question. A turn the client aborts after the first token is
stored with the partial text and `stopped: true` in history.

**CRM writes are proposals, never direct.** With `CRM_WRITE_TOOLS_ENABLED=true` (and
crm-api's `MCP_WRITE_TOOLS_ENABLED`), a CRM write tool the model calls is not executed: Edge
asks crm-api for a dry-run preview (`_meta["heubert/dryRun"]`), stores a proposal in
`crm_write_proposals`, and streams it before `done`, one event per write:

```
{"event":"crm_write_proposal","data":{"proposalId":"…","requestId":"…","tool":"crm_update_contact","target":{"entity":"contact","id":"…","label":"Asha Rai"},"changes":[{"field":"phone","label":"Phone","before":"0400…","after":"0411…"}],"status":"pending","expiresAt":"…"}}
```

The counsellor decides with `POST /v1/crm/writes/:proposalId/decision` `{"decision":"approve"|"reject"}`:
200 with the updated proposal (`applied`, `rejected`, `stale` with `current` values when the
record changed since the preview, or `failed` with `error`); 404 when the proposal does not
exist or is someone else's; 409 with the current proposal when it is no longer `pending`
(decided already, or `expired`: 30 minutes, or the counsellor sent another message). Approve
replays the stored arguments with `_meta["heubert/expectedVersion"]`, so crm-api refuses a
stale write. `GET /v1/sessions/:id` returns each answer's proposals as `crmWrites`, and the
next turn's model input carries a note of how each was decided. Without the flag, CRM tools
that are not annotated read-only are never offered to the model, and the decision route
answers 503.

**Guided sessions** (see below) add one more event after `done`, sent only when Edge stores a
suggestion to move the journey on:

```
{"event":"guide","data":{"sessionId":"…","guide":{"contactId":"…","currentStep":"destination","steps":[{"key":"enquiry","status":"done","updatedAt":"…"},…],"suggestion":{"toStep":"course","reason":"Australia is chosen and on her deal.","at":"…"},"startedAt":"…"}}}
```

In a guided session the `suggestions` event carries step-scoped follow-ups instead of the
general ones.

`thinking` carries the answer model's own thought summary, in incremental fragments to
be concatenated in order exactly like `token` — never anything Edge synthesised. It is
live only: thoughts are not persisted, so a reopened conversation replays the answer and
the reasoning trace but not the thoughts. Set `GEMINI_THINKING_ENABLED=false` to turn the
events off (no thinking tokens billed); `/v1/chat` never returns them.

Thoughts and tokens both come from whichever model answers. The answer node streams the
primary model directly — a `withFallbacks` wrapper would flatten the chunks and drop the
thought parts — and switches to the cheaper fallback model only if the primary fails
*before* its first token, so one reply is never half one model and half another. A failure
after tokens have streamed keeps the partial answer the consultant already saw.

### `POST /v1/knowledge/search`
Direct hybrid retrieval (vector + text, RRF-fused) with no model call — powers the
frontend's "Search knowledge" box.
```json
{ "query": "post-study work rights Australia", "k": 8, "countries": ["australia"],
  "docTypes": ["destination"], "sources": ["partner:monash-university"], "sourceKinds": ["partner", "upload"] }
```
→ `{ query, results: [{ id, url, title, section, docType, country, source, sourceKind, score, matchedBy, excerpt }], count }`.
`sourceKind` is `site` (experteducation.com), `partner` (university websites), `upload`
(staff documents) or `program` (extracted course records).

### Knowledge-base administration
| Route | Purpose |
|---|---|
| `POST /v1/knowledge/programs/search` | Field-level search over extracted program records: `{ q?, countries?, university?, universitySlugs?, levels?, disciplines?, intake?, maxTuition?, currency?, maxIeltsOverall?, hasScholarships?, limit?, offset? }` → `{ results, count, total }` |
| `GET /v1/knowledge/partners[?country=&enabled=]` · `GET /v1/knowledge/partners/:slug` | Partner-university registry (name, country, website, domains, crawl paths, enabled/verified) |
| `PUT /v1/knowledge/partners/:slug` · `DELETE …/:slug` | Admin: create/update/remove a partner (drives crawling and the live-fetch allowlist) |
| `POST /v1/knowledge/documents` (multipart `file` + `title?`, `partnerSlug?`, `country?`, `docType?`, `extractPrograms?`) | Staff upload (PDF/TXT/MD/CSV/HTML, ≤ `UPLOAD_MAX_BYTES`) → 202; indexed in the background as `upload:<slug>` |
| `GET /v1/knowledge/documents[?mine=true&status=]` · `GET …/:id` · `DELETE …/:id` | List / poll status (`processing → ready | failed`) / delete (owner or admin; removes chunks, pages, program records and the file) |
| `POST /v1/knowledge/reindex {scope: "all" \| "site" \| "partners" \| "partner:<slug>", force?}` | Admin: queue a re-crawl; the `requests` CronJob drains the queue within ~30 min |
| `GET /v1/knowledge/status` | Chunks/pages by provenance, last crawl per source, partner counts, queued requests, recent ingest runs |

Admin = a trusted server (`x-api-key` without `x-user-id`), or any signed-in staff member
when `ADMIN_EMAILS` is empty, otherwise only the listed emails.

### Guided journey sessions
A guided session walks a consultant through ten journey steps (Enquiry → Destination →
Course → Institution → Eligibility → English → Application → Finances → Visa →
Pre-departure, built from S1–S11 in `docs/data-model/02-question-coverage.md`) for **one CRM
student**. The CRM owns every student fact: Edge stores only the contact id and the journey
progress, and reads the student live, as the consultant, on every guided turn (the record is
cited as a CRM excerpt). The consultant moves the step; Edge only suggests: a starting step
read off the CRM (furthest active application stage, then applications, then deal
destinations) and "this step looks settled" after an answer, which also needs the step's
CRM fields to be filled. Guided sessions and their messages never expire.

`GET /v1/journey` (the steps: labels, goals, checklists, the CRM fields each needs) ·
`GET /v1/crm/contacts?q=&limit=` (CRM contacts the caller may see, for attaching a student) ·
`POST /v1/sessions {guided:{contactId, step?}}` (new guided session, titled with the student's
name; without `step` it starts at Enquiry carrying Edge's starting-step suggestion) ·
`PATCH /v1/sessions/:id/guide {convert?:{contactId,step?}, currentStep?, stepStatus?, dismissSuggestion?}`
(convert a chat one way, move the step, set statuses; any move clears the suggestion) ·
`GET /v1/sessions/:id/student` (the student as the CRM has them now, with what each step still
needs; never stored). Session list/get carry `guided`, `currentStep` and `guide`; answers carry
`guideStep`. All guided routes answer 503 without the CRM.

### Gmail and Google Drive
Each consultant can connect their own Google account (account menu › Connected accounts). Edge
then offers the research loop `gmail_*` and `drive_*` tools that call Google's remote MCP servers
(`gmailmcp.googleapis.com`, `drivemcp.googleapis.com`) **as that consultant**, so Google applies
their own permissions. Results are cited like any excerpt (`source: "gmail" | "drive"`, with an
"Open in Gmail/Drive" `webUrl`). Only allowlisted read tools are offered (search/read threads and
messages, list drafts; search/read files, metadata, recent files); labels, trash, spam, sharing and
Drive writes never are. With `GMAIL_DRAFTS_ENABLED`, `gmail_create_draft` becomes an approval card
(the same `crm_write_proposal` event and `/v1/crm/writes/:id/decision` route, with
`provider: "gmail"`): the draft is saved to Gmail Drafts only on Approve and is never sent.
Gmail follows the CRM's scoping (caseload yes, policy topics only when a student is named); Drive
is offered on every topic. Email and file text is treated as untrusted data (sanitised,
instruction-like text flagged), and its body is not copied into `chat_turns`.

Connecting is an OAuth code flow with PKCE owned by Edge: `POST /v1/integrations/google/connect
{services:["gmail"|"drive"], returnTo?}` → `{url}`; Google redirects to the frontend's
`/api/integrations/google/callback`, which forwards `POST /v1/integrations/google/callback
{code,state}`. The state is single-use, 10 minutes, and bound to the signed-in consultant; the
Google account must be that same work email. The refresh token is stored AES-256-GCM encrypted
(`google_connections`, key `GOOGLE_TOKEN_ENC_KEY`). `GET /v1/integrations` lists per-service
status (`connected | not_connected | reauth_required | error`); `DELETE
/v1/integrations/google/:service` disconnects (revoking at Google when nothing remains). Setup:
an Internal Web OAuth client in the Workspace org's GCP project with `gmail.googleapis.com`,
`drive.googleapis.com`, `gmailmcp.googleapis.com` and `drivemcp.googleapis.com` enabled; see the
Google Workspace block in `env.example`. `bun run google:probe` checks a real account
against both servers.

### Other routes
`GET /v1/sessions?limit=50` (the caller's conversations, newest first; `{sessions:[{id,title,
pinned,messageCount,createdAt,lastActiveAt,expiresAt,mode}],count}`) ·
`GET /v1/sessions/:id` (history; assistant messages include `sources`, `reasoning`, `latencyMs`,
`refused`, `disclaimer`, `followUps`, `stopped` and `intentDetail` — the full classified
intent, so a reopened thread shows the real task and confidence) ·
`PATCH /v1/sessions/:id {title?, pinned?}` (rename — trimmed, 1–120 chars — and/or pin; a session
the owner named is never retitled by the automatic first-message title) ·
`DELETE /v1/sessions/:id` (owner-scoped, 404 for others) ·
`GET|PATCH|PUT /v1/profile` (saved staff context: office, markets, specialisations) ·
`POST /v1/feedback {traceId|requestId, score, comment}` (stored + Langfuse score, labels the recorded turn) ·
`POST /v1/events {events:[{type, at?, sessionId?, requestId?, props?}]}` (frontend UI events → activity log) ·
`GET /auth/me` · `GET /healthz` (liveness) · `GET /readyz` (MongoDB ping, KB mode/size) ·
legacy `POST /chat`, `POST /chat/stream`.

## How answers are produced

1. **Classify** (`CLASSIFIER_PROVIDER`: `gemini` = `gemini-3.5-flash-lite` structured output;
   `jev` = TypeSafe Jev via OpenRouter, one ~400 ms decision call with per-field probabilities,
   PII-redacted before it leaves, Gemini only as an error fallback; `src/classify/`): one of 29 topics — 18
   study-abroad topics, 8 counsellor-work topics (own caseload in the CRM, offer →
   deposit → CoE/CAS, visa lodgement, document checklists and SOP/GS text, pre-departure
   and onshore rules, policy change, compliance and integrity, lead engagement) and 3
   operational ones (greeting, human handoff, general) — a `task` (lookup, compare,
   draft, review, eligibility, process, summarize, translate, calculate, general),
   `needs_research`, destinations, study level/area, origin country, flags (distress,
   urgency, prior refusal, integrity risk, policy recency, CRM write requested,
   prompt-injection attempt…), language. With Jev also: audience and channel for any
   text produced, the case stage (X.030), and signals (named student, off-topic, crisis
   safeguarding, sensitive PII, migration-advice boundary, compound request) that steer
   tool scoping and prompt rules. Failure → safe `general_inquiry` fallback that still
   researches, never a refusal.
2. **Refuse** deterministically only for prompt-injection attempts (no model call).
3. **Research** when `needs_research` is true (skipped for drafting/rewriting requests
   that don't need a lookup). Round 0 is the knowledge-base search: `$vectorSearch`
   (768-dim Gemini embeddings, cosine) and Atlas Search full-text in parallel, fused
   with Reciprocal Rank Fusion, filtered by destination country, with per-provenance
   quotas (`RETRIEVAL_QUOTAS`) so partner sites cannot swamp our own pages. Then, within
   `RESEARCH_BUDGET_MS`, a tool-calling model (`GEMINI_RESEARCH_MODEL`) runs up to
   `RESEARCH_MAX_ROUNDS` rounds of `search_knowledge_base`, `search_programs`
   (structured course records), `web_search` (Gemini Google-Search grounding) and
   `fetch_page` (live read of a partner/official/consultant-pasted page, domain-policy
   and SSRF checked). Everything lands in one evidence list with stable `[n]` numbers;
   live items are marked `live="true"` so the answer can say "per monash.edu today".
   For a rule-, fee-, funds-, work- or policy-shaped question on a destination with a facts
   register (`data/facts/<destination>.md`, `src/skills/facts-register.ts`,
   `FACTS_REGISTER_ENABLED`), round 0 first adds up to two dated register excerpts
   (`source: facts-register:<destination>`): the "Closed or replaced programmes and rules" table
   for visa, policy and onshore questions (or "is it still…?"), and the topic table that best
   matches the question, with its best-matching rows. A scholarship_funding question draws on
   `data/facts/scholarships.md` instead (programme sections by name and routed destination,
   else the eligibility matrix). Rows keep their "(secondary — verify)" / "(prior knowledge —
   verify)" labels. The answer prompt (rule 4c) ranks the
   register above Expert and partner pages, below a current official page, and asks for the
   row's effective date.
   When a message asks for a home-currency figure ("in NPR", "in lakh", "in our currency"
   with a routed origin), round 0 also searches the source market's central bank (NRB, RBI,
   Bangladesh Bank, SBV, BSP, BOT, CBSL; `src/graph/fx.ts`, `FX_RATES_ENABLED`) for today's
   rate and keeps only that bank's own pages as live evidence; with none, the answer says the
   rate isn't available (rule 6b) instead of converting at a remembered rate.
4. **Generate** (`gemini-3.6-flash`, fallback `flash-lite`): persona + task playbook
   (topic-specific domain framework) + numbered `<excerpt>` evidence + staff context +
   research notes + windowed history. Citations `[n]` are mapped back to source URLs
   (drafts, reviews, summaries and translations cite nothing unless the model cited); a
   one-line disclaimer is appended for visa, migration, onshore and compliance topics —
   also when one of those is only a secondary topic (MARN-agent or compliance-lead
   confirmation). Intents are only ever added, never renamed: stored turns keep the
   string they were classified with. The classifier golden set is `data/eval/intents.jsonl`
   (`bun run eval:intents`, per-intent recall table; `--only a,b` to run a subset).

Prompts live in `src/prompts/` and can be overridden per environment in Langfuse
(`bun run prompts:push` seeds them; names `edge-consultant-system`,
`edge-consultant-research`, `edge-consultant-classifier`, `edge-consultant-playbook-*`,
`edge-consultant-refusal`; run `bun run scripts/prompts-retire-legacy.ts --apply` once to
relabel the old `edge-system` / `edge-playbook-*` prompts). Persona facts live in
`src/config/persona.ts`.

## Knowledge base

Six channels feed the knowledge base; every chunk carries `source` (e.g.
`experteducation.com`, `partner:monash-university`, `upload:fee-sheet-2026-1a2b3c4d`,
`guide:facts/australia`, `official:gov.uk`), `sourceKind` (`site | partner | upload | program | official`),
`country` and `docType`.

```bash
bun run ingest                                      # experteducation.com, all markets (+ partner list docs)
bun run ingest -- --source partners --country canada
bun run ingest -- --source partners --partner monash-university
bun run ingest -- --source guides                   # Expert's curated guides only (also part of --source all)
bun run ingest:guides -- --dry-run                  # guides: print the plan (embed / retag / unchanged / delete per guide)
bun run ingest -- --source official                 # official government / regulator / test-body pages (also part of --source all)
bun run official:changes                            # official pages that changed after the facts register citing them was checked
bun run ingest -- --source all --sweep --deadline-minutes 300   # what the weekly CronJob runs
bun run ingest -- --from-requests --deadline-minutes 25         # drain POST /v1/knowledge/reindex
bun run partners:sync -- --import | --export | --list           # data/partners.json ⇄ kb_partners
bun run partners:discover -- --country canada [--apply]         # propose websites for partners without one
```

* **experteducation.com** (`--source site`): every market section (`/nepal/`, `/australia/`,
  `/uk/`, `/thailand/`, `/india/`, `/bangladesh/`, `/vietnam/`, `/philippines/`) plus shared
  tools, honouring robots.txt, with per-page content hashing so re-runs only re-embed
  changed pages. Also builds one "partner universities in <country>" document per country
  from the registry.
* **Partner universities** (`--source partners`): the `kb_partners` registry is the source of
  truth (seeded from `data/partners.json` on first run; maintained via
  `PUT /v1/knowledge/partners/:slug` or `partners:sync`). Each enabled partner's domains are
  crawled on their course/fees/admissions paths: sitemaps seed the queue, sitemap `lastmod`
  skips unchanged pages, course-looking URLs are fetched first, `PARTNER_DEFAULT_MAX_PAGES`
  caps each site and `INGEST_HOST_PARALLELISM` sites run at once. The non-Australian partner
  lists are rendered client-side on experteducation.com, so `partners:discover` combines the
  page's per-country counts, names a consultant pastes into `data/partners-names/<country>.txt`,
  and Gemini web search to propose official websites into `data/partners.review.json`
  (`--apply` promotes confident rows as unverified records).
* **Program records** (`PROGRAM_EXTRACTION_ENABLED`): pages detected as course pages
  (URL + on-page signals, or schema.org `Course` JSON-LD) go through Gemini structured
  output into `kb_programs` (program, level, campus, duration, tuition, intakes, deadlines,
  academic + English requirements, scholarships, codes, evidence quotes) and are also
  rendered as a text chunk (`docType: program`). Searchable via `search_programs` in the
  research loop and `POST /v1/knowledge/programs/search`.
* **Staff uploads**: `POST /v1/knowledge/documents` stores the file in GridFS (`kb_files`),
  parses it (PDF via Gemini document understanding; TXT/MD/CSV/HTML natively), indexes it as
  `upload:<slug>` and optionally extracts program records (fee sheets). Status is polled via
  `GET /v1/knowledge/documents/:id`.

* **Expert's curated guides** (`--source guides`, `bun run ingest:guides`; `src/ingest/guides.ts`):
  the source-market guides (`data/markets`), agent-compliance guides (`data/compliance`),
  destination facts registers (`data/facts`) and the counsellor job map (`data/counsellor`),
  the runtime copies of `docs/markets|compliance|facts|counsellor` (tests fail until a copy matches
  its docs/ original). Chunked by `##`/`###`/`####` section with the doc title and heading path in
  each chunk; tables are kept whole when they fit and otherwise split by row groups with the
  header repeated (≤ 1,800 characters). `source: guide:<kind>/<slug>`, `sourceKind: upload` (the
  staff-document quota), `docType` `market_guide | compliance_guide | facts_register |
  counsellor_guide`, `country` the destination for a facts register or destination compliance
  guide and `global` otherwise, `metadata.market` the origin market of a market guide,
  `metadata.updated` and `updatedAt` the guide's researched/checked date, and
  `url: guide://<kind>/<slug>#<anchor>`. Idempotent: unchanged chunks are not re-embedded
  (contentHash), a new date only updates metadata, removed sections and guides are deleted; only
  `guide:` sources are touched, and an empty data directory refuses to sync. Runs first in every
  `--source all` run (nightly and weekly CronJobs), so a merged guide edit is indexed the night
  after deploy; `POST /v1/knowledge/reindex {"scope":"guides"}` queues it sooner.

* **Official pages** (`--source official`; `src/ingest/official.ts`): the exact government,
  regulator and test-body pages counsellors rely on, re-fetched every night. The list is every
  official URL a facts register cites (`data/facts`, read automatically; law firms, news and
  insurers are left out) plus the curated `data/official-pages.json` (destinations without a
  register, source-market paperwork such as Nepal's NOC or India's apostille, test bodies; `slice`
  + `citeUrl` cut one part of a long page). Federal Register rules are fetched as the full-text
  HTML its API links to (the site challenges page requests); Home Affairs' SharePoint pages are
  rebuilt from their page JSON when that says more than the body. A challenge page or a
  JavaScript shell under 1,500 characters is reported as failed, not indexed. Each entry
  has exactly one of `country` (a destination or `global`) or `market`; market pages get
  `docType: official_market:<market>` and rank last for other markets' students. Fetching obeys
  robots.txt, one request at a time per host (`OFFICIAL_CRAWL_DELAY_MS`), with
  `OFFICIAL_USER_AGENT`, which names us without "Bot" (immi.homeaffairs.gov.au's WAF rejects that
  word although robots.txt allows the pages); live `fetch_page` uses it too. Hosts that refuse
  automated clients (most US federal sites and US embassies) are reported as failed and never
  worked around: their last copy stays, and the live official search still covers them. A page
  whose text changed since the last run is logged, recorded on the run (`sources[].changed`) and
  stamped `kb_pages.contentChangedAt`; `bun run official:changes` lists those pages with the
  facts-register rows that quote them. Pages dropped from the list are swept (never when the list
  shrank by half). In round 0, when the knowledge base already returns `OFFICIAL_KB_MIN_HITS`
  official chunks for the destination, the live official web search is cancelled; the
  `official` retrieval quota (`RETRIEVAL_QUOTAS`) gives these pages their own seats.

**Live lookups** are not stored: `web_search` and `fetch_page` results are cited as
`web:<host>` / `live:<host>` evidence for that turn only (cached `LIVE_CACHE_TTL_SECONDS` in
`live_cache`). Fetchable domains = experteducation.com + partner domains + `WEB_FETCH_ALLOWED_DOMAINS`
+ URLs the consultant pasted (public DNS, no private addresses).

**Scheduling**: `helm/…/templates/cronjob-ingest.yaml` runs the same image as three CronJobs
(`ingest.jobs` in values): nightly incremental (`--source all`), weekly sweep (`--sweep`
deletes pages no longer on the sites, guarded so a truncated or suspiciously small crawl never
deletes), and a 30-minute drain of reindex requests. Every run is recorded in
`kb_ingest_runs`; `GET /v1/knowledge/status` reports freshness. Manual one-off:
`kubectl create job --from=cronjob/expert-ai-consultant-ingest-nightly ingest-manual-$(date +%s) -n production`.

**Search mode**: pin `KB_SEARCH_MODE=atlas` in production — the in-app fallback keeps every
chunk embedding in RAM (~6 KB each), which does not fit once partner sites are indexed.
`bun run db:setup` also adds the `sourceKind` filter to the Atlas indexes (one rebuild) and
backfills it on existing chunks.

## Configuration

See `env.example`. Required: `GOOGLE_API_KEY`, `MONGODB_URI`, and in production
`API_KEY` and/or `SUPABASE_URL`. Everything else has defaults.

`CRM_DEMO=true` (local development only; refused when `NODE_ENV=production`) replaces the CRM
with three fictitious students (`src/crm/demo.ts`) so guided sessions can be tried without a
CRM token exchange.

## Observability

Set `LANGFUSE_PUBLIC_KEY/SECRET_KEY` to get one trace per turn (session, user,
intent tags, per-node spans, token usage) via OpenTelemetry, prompt versions
linked to generations, and `/v1/feedback` scores. Logs are JSON lines with
`requestId`/`sessionId`; secrets and PII are redacted.

## Activity log & training data

Every request is recorded durably in MongoDB (no TTL unless `ACTIVITY_RETENTION_DAYS` > 0),
independently of the 72 h conversation memory, so the data can later be used to fine-tune the model:

* **`chat_turns`** — one document per chat turn: user message, windowed history the model saw,
  the exact compiled system prompt (+ template hashes / Langfuse versions), retrieved chunks with
  text and scores, full intent, answer, disclaimer, which Gemini model actually answered (primary
  or fallback), token usage, per-node timings, stream outcome (`ok | refused | aborted | error`,
  partial answer on abort), the profile used, client metadata, and any feedback attached later via
  `POST /v1/feedback {requestId, score}`.
* **`activity_events`** — everything else: `chat.request`, `auth.login`, `auth.rejected`,
  `profile.update`, `session.read|delete|list`, `feedback.submitted`, `http.rate_limited`,
  `http.error`, plus frontend `ui.*` events posted to `POST /v1/events`.

Writes are buffered and fire-and-forget (bounded queue, flushed every 2 s and on shutdown), so
they never add latency or fail a request; `/readyz` reports queue/drop counters under
`checks.activityLog`. Identity is stored as the raw `ownerId` (so a user's data can be found or
deleted) plus a pseudonymous `userHash` (HMAC with `ACTIVITY_HASH_SECRET`, else sha256); exports
carry only the hash.

```bash
bun run export:dataset -- --out data/export/sft.jsonl                       # OpenAI-style {"messages":[…]}
bun run export:dataset -- --format gemini --out data/export/gemini.jsonl    # Vertex AI tuning rows
bun run export:dataset -- --format dpo --out data/export/dpo.jsonl          # preference pairs from ratings
bun run export:dataset -- --since 2026-09-01 --intents financial_viability --feedback positive --redact-pii
bun run export:dataset -- --help
```

Defaults exclude refused, aborted, errored, fallback and injection-flagged turns;
`--include-*` flags opt back in. `--system none` drops the system prompt, `--history N` bounds the
context window, `--redact-pii` scrubs emails/phones/ids.

## Deployment

`Dockerfile` (multi-stage, Bun 1.3.6, non-root) + `helm/expert-ai-consultant`
(EKS, ALB, secrets-store CSI) + `buildspec-prod.yaml` (CodeBuild → ECR → gitops).
Probes: startup/liveness `/healthz`, readiness `/readyz`, ALB `/health`.
SIGTERM drains in-flight requests and flushes traces within 25 s.

## Project layout

```
src/
  server.ts            bootstrap + graceful shutdown
  app.ts               Bun.serve routes, auth, CORS, rate limit, error envelope
  app/                 routes, service (turn orchestration), sse, http helpers
  auth/supabase.ts     Supabase JWT verification + domain allowlist
  config/              env (zod), persona (Expert Education facts)
  graph/               LangGraph state, nodes (classify/refuse/generate), research loop, builder
  tools/               research tools: knowledge base, programs, web search, page fetch; evidence collector
  live/                live lookups: domain policy (SSRF), Gemini web search, page fetch, cache
  prompts/             consultant system + research prompts, task playbooks, classifier, Langfuse registry
  retrieval/           Atlas hybrid store, in-app store, RRF, per-kind quotas, context formatting
  partners/            partner-university registry (kb_partners) + discovery helpers
  documents/           staff uploads: GridFS store, parsers (PDF via Gemini), async indexing service
  memory/              chat store (MongoDB / in-memory), history window
  activity/            durable activity log (buffered writer, event taxonomy, dataset export helpers)
  ingest/              crawler (sitemaps, priority, deadline), extraction, chunking, pipeline, sweep,
                       course detection, program extraction, run log
  llm/                 Gemini chat/embeddings factories + REST client (grounding, PDF, JSON schema)
  db/mongo.ts          client, collections, index management
  observability/       logger, OpenTelemetry + Langfuse, per-call usage recorder
  safety/              input/retrieval sanitisation, PII redaction
scripts/               setup-db, ingest, partners-sync, partners-discover, prompts-push, eval-intents, smoke, export-dataset
tests/                 bun test (no network needed)
data/                  partners.json (seed), partners-names/<country>.txt (pasted lists), eval/intents.jsonl
docs/legacy/           original Langflow export
```
