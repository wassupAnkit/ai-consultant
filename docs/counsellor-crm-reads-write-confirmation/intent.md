---
title: Answer counsellors' CRM questions and gate every CRM write
author: Aashish (author@heubert.com)
requested by: Aashish
---

# Answer counsellors' CRM questions and gate every CRM write
_Intent written 2026-09-29 with Aashish. No discovery ticket; agreed in a Claude Code brainstorm after a survey of crm-api's counsellor features._

Slice 1 of 4. Slices 2 (task writes) and 3 (pipeline progression writes) get their own intents and build on the confirmation step defined here.

## Problem
To answer "where is this student and what's next", a counsellor has to go through the CRM's contact, enquiry, deal, application, stage-checklist and office-visit screens one by one. Edge can read contacts, enquiries, deals, notes and tasks from the CRM (crm-api `src/mcp/tools/index.ts`). It can't read applications, stage checklists, documents, activity timelines, the office-visit queue, notifications, counts or the course catalogue. So it can't give the whole answer.

crm-api also has six write tools behind `MCP_WRITE_TOOLS_ENABLED`: create/update enquiry, update contact, update office visit, create/update note. Nothing in Edge asks the counsellor before one of them runs. Edge `master` doesn't even filter write tools out: that filter exists only on the unmerged branch `feat/intent-tool-scoping` (commit `5f3a50f`). Today the only guard is crm-api's flag being off.

## Proposed outcome
A counsellor asks Edge "what's next for <student>" or "what's on my plate today" and gets one answer built from CRM records, each fact cited. The answer covers application stage, which required documents are missing, open tasks, today's office visits, recent activity and unread notifications. The counsellor doesn't have to open the CRM to find those facts.

Edge proposes CRM writes, and the counsellor approves or rejects each one after seeing exactly what will change. No CRM record changes through Edge without that approval.

## Affected users and systems
- **Users:** counsellors (CRM role `counseling`, Associated and All permission levels) using Edge. In PR-680 that means the three seeded accounts: counsellor-1@heubert.com, counsellor-2@heubert.com, counsellor-3@experteducation.com.au.
- **Systems:**
  - crm-api MCP server (`src/mcp`, branch `CRM-1220-mcp-server`)
  - Edge research loop and CRM provider (`src/crm`)
  - Edge chat UI (expert-chatbot-frontend)
  - `mcp_audit_logs` table on the PR-680 tenant
  - Edge activity log
- **Data read:** applications and their stages, stage checklists, document metadata, contact/enquiry/office-visit activity, office visits, notifications, task and enquiry counts, users who can be assigned, CRM products/courses.
- **Decision owner:** Aashish.

## Scope
- **Environment:** the PR-680 environment only (`pr-680-crm-api.heubertapp.com`, seeded tenant). Production Edge keeps pointing at it.
- **Surfaces:**
  - Edge chat, for answers and approval cards
  - crm-api MCP endpoint `/v1/mcp`, for `tools/list` and `tools/call`
- **Role:** counsellor, at both Associated and All permission levels.
- **Writes gated by the confirmation step:** the six existing write tools. After the step ships, both `MCP_WRITE_TOOLS_ENABLED` (crm-api) and `CRM_WRITE_TOOLS_ENABLED` (Edge) are switched on for PR-680, and the `mcp_audit_logs` migration is run on its tenant.

## User stories
1. As a counsellor, I want one cited answer about a student's status and next step, so that I don't have to piece it together from six CRM screens.
2. As a counsellor, I want to see my day (open tasks, today's office visits, unread notifications and counts), so that I know what to do next.
3. As a counsellor, I want to look up and compare the courses Expert sells as they are set up in the CRM, so that I can advise a student on real offers.
4. As a counsellor, I want to see and decide on every CRM change Edge proposes before it happens, so that nothing in the CRM changes without my say.

## Acceptance criteria

### Story 1: student status
1. Given a counsellor who can see contact X in the CRM, and X has an application, when they ask Edge in chat "what's next for X", then the answer names each application's institution/course, current stage, the next stage and its assignees. Each fact is cited to its CRM record.
2. Given contact X has an application whose current stage has required documents, when the counsellor asks what X is missing, then Edge lists each required document for that stage as uploaded or missing, with its name, type and upload date where uploaded, cited.
3. Given contact X has activity recorded in the CRM, when the counsellor asks what happened recently with X, then Edge lists the most recent contact, enquiry and office-visit activity entries with their dates, newest first, cited.
4. Given a counsellor who cannot see contact Y in the CRM (not assigned, not following, not creator, and without All level), when they ask Edge about Y's applications, checklist, documents or activity, then Edge answers that it cannot find or access that student. No application, document, checklist or activity data for Y appears in the answer or in the tool output Edge logs.
5. Given Edge's student overview for a visible contact X that has applications, when the counsellor asks for X's overview, then the overview includes those applications alongside the existing enquiries, deals and notes.

### Story 2: my day
6. Given a counsellor with office visits today in their branch, or assigned to or created by them, when they ask Edge "who is waiting / who's coming in today", then Edge lists those visits with status, visitor and assignee. Visits outside that branch/assignee/creator rule are not listed.
7. Given a counsellor with unread CRM notifications, when they ask Edge what's new, then Edge lists their own unread notifications, newest first, and never another user's.
8. Given a counsellor, when they ask Edge how many tasks and enquiries they have, then Edge reports their task counts (all / assigned to me / created by me) and their new and existing enquiry counts. The numbers match what the CRM's own counts return for the same user.
9. Given a counsellor asking Edge who a record can be assigned to, when Edge looks it up, then it returns the CRM's assignable users for that record, each with name and role.

### Story 3: courses
10. Given CRM products exist for an institution, when the counsellor asks Edge for courses matching a subject, level or institution, then Edge lists matching CRM products with fees and intakes as set up in the CRM, each cited to the CRM product.
11. Given two or more CRM products, when the counsellor asks Edge to compare them, then Edge shows them side by side on the fields the CRM comparison returns, cited.
12. Given Edge's knowledge base and the CRM disagree on a course fact (fee, intake, duration), when Edge answers, then it shows both values, each cited to its own source, and does not silently pick one.

### Story 4: confirmation step
13. Given both write flags are on in PR-680, when Edge decides to call one of the six write tools, then no CRM write happens yet. Instead the chat shows an approval card naming the tool, the target record (name, plus a link when a CRM link host is configured) and each field that changes, with its before value and after value.
14. Given an approval card, when the counsellor clicks Approve, then the write runs exactly as shown and the card shows the outcome (applied, or the CRM's error message). The write is recorded in `mcp_audit_logs` with personal data redacted.
15. Given an approval card, when the counsellor clicks Reject, then no CRM write happens, the card shows "Rejected", and Edge tells the model the write was declined and continues its answer without it.
16. Given Edge proposes more than one write in a single answer, when the cards appear, then there is one card per write, and approving or rejecting one does not decide any other.
17. Given an undecided card, when the counsellor sends another chat message or 30 minutes pass, then the card shows "Expired, not applied" and can no longer be approved.
18. Given a card was built from a record's values, and the record changed in the CRM before the counsellor approves, when they click Approve, then the write is not applied and the card shows the record's current values in place of the stale before values.
19. Given `CRM_WRITE_TOOLS_ENABLED` is off in Edge, or `MCP_WRITE_TOOLS_ENABLED` is off in crm-api, when a counsellor chats, then Edge never offers or proposes a CRM write, and CRM tools with no read-only annotation are never shown to the model.
20. Given the confirmation step is live in PR-680, when the counsellor approves a proposal from each of the six write tools once, then all six apply correctly on the PR-680 tenant and each produces an audit row.

## Edge cases
- **Records with no visibility rule** (applications, checklists, documents, activities): crm-api's REST screens return them to any logged-in user. For Edge they are visible only through a contact or deal the counsellor can see. Tied to 1–5. Source: code (survey of `src/application/queries`, `src/media`, activity handlers); rule decided by the PM.
- **Office visits** keep the existing branch/assignee/creator rule (`src/mcp/tools/office-visit/office-visit-access.ts`). Tied to 6. Source: code.
- **Documents: metadata only.** No signed file URLs and no file contents reach the model, because Edge's activity log keeps tool output forever (`ACTIVITY_RETENTION_DAYS: "0"`, `helm/expert-ai-consultant/values-prod.yaml`). Tied to 2. Source: PM, prompted by config.
- **Missing CRM link:** `CRM_WEB_URL` is unset for prod Edge, so records and cards render without a link in PR-680. Tied to 13. Source: config.
- **Contact with no applications or no activity:** Edge says there are none and does not invent any. Tied to 1, 3. Source: code (empty result paths).
- **Stale record at approval time:** tied to 18. Source: PM.
- **Card left unanswered, page reloaded, or the counsellor returns hours later** (sessions live 72h): tied to 17. Source: PM, prompted by `SESSION_TTL_HOURS`.
- **Several writes in one answer:** tied to 16. Source: PM.
- **Write rejected by the CRM after approval** (validation error, record deleted): tied to 14. Source: code (`toToolError`).
- **Stage-change permissions** (`stage:*`) are only enforced in the CRM frontend: this matters for slice 3 pipeline writes and is decided out of scope here by Aashish.
- **Manager views across counsellors:** decided out of scope by Aashish.

## Constraints
- **Environment:** PR-680 only. It is disposable: its database is dropped when PR 680 closes, and its tenant is seeded test data.
- **No server-side permission guards in the CRM.** Every new read enforces the visibility rules above itself, rather than relying on crm-api.
- **Personal data:** tool output reaching Edge is kept forever in the activity log, so no document files or signed URLs are sent.
- **Local verification limits:** crm-api doesn't boot locally (no usable local DB credentials, and the Sentry profiler binary is missing on Node 22). End-to-end verification happens on PR-680.

## Out of scope
- Task writes: create, complete and update task. Slice 2.
- Pipeline writes: office-visit check-in, enquiry-to-deal conversion, deal status and assignees, application stage advance, create contact, application comments, mark notifications read. Slice 3.
- Any delete.
- Admin setup (workflows, institutions, products).
- Billing/Xero and calendar.
- Sending email or SMS. The CRM has no endpoint for it.
- Manager and branch-wide oversight views.
- Editing a proposed write's values on the card before approving.
- Moving Edge from PR-680 to production crm-api.

## Dependencies
- crm-api `CRM-1220-mcp-server` booting on PR-680. Fixed in `1092c6eb` on 2026-09-29; rollout being confirmed.
- Edge branch `feat/intent-tool-scoping` (commit `5f3a50f`, the read-only-by-default tool filter), which needs to land for criterion 19.
- The `mcp_audit_logs` migration (`1790580000000-CreateMcpAuditLogs`) run on the PR-680 tenant before writes are switched on.
- The Edge chat frontend (expert-chatbot-frontend), for approval cards.

## Open questions
- When is CRM-1220 merged and released, and when does prod Edge move off PR-680? Owner: Aashish. Doesn't block this slice.
- Which CRM front-end host should approval cards and citations link to once the environment moves? Owner: Aashish. Doesn't block this slice.
