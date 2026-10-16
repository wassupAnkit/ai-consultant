import { describe, expect, test } from "bun:test";
import { decisionNote } from "../src/crm/approvals/history";
import { MongoCrmWriteProposalStore, type CrmWriteProposalDoc } from "../src/crm/approvals/mongo-store";
import { CrmWriteService, GMAIL_DISCONNECTED, gmailDraftPreview } from "../src/crm/approvals/service";
import { InMemoryCrmWriteProposalStore } from "../src/crm/approvals/store";
import { CRM_WRITE_PROPOSAL_EVENT, toView, type CrmWriteProposal, type CrmWriteProposalView } from "../src/crm/approvals/types";
import type { WorkspaceProvider, WorkspaceToolsets } from "../src/google/types";
import type { McpCallOptions, McpToolDescriptor, McpToolResult, McpToolset } from "../src/mcp/types";
import { createLogger } from "../src/observability/logger";
import { makeGmailDraftTools } from "../src/tools/gmail-draft";

const T0 = new Date("2026-09-30T10:00:00.000Z");
const JANE = "jane@heubert.com";
const TOOL = "gmail_create_draft";

const DRAFT_TOOL: McpToolDescriptor = {
  name: TOOL,
  description: "Create a draft email.",
  inputSchema: { type: "object", properties: { to: { type: "array", items: { type: "string" } }, subject: { type: "string" }, body: { type: "string" } } } as never,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
};
const SEARCH_TOOL: McpToolDescriptor = {
  name: "gmail_search_threads",
  description: "Search threads.",
  inputSchema: { type: "object", properties: {} } as never,
  annotations: { readOnlyHint: true },
};

const ARGS = { to: ["sam@student.test"], subject: "Your offer letter", body: "Hi Sam,\n\nYour offer is attached.\n\nJane" };

type Call = { name: string; args: Record<string, unknown>; opts?: McpCallOptions };

/** A scripted Gmail MCP toolset. `calls` records every call; `execute` answers create_draft. */
function scriptedGmail(opts: { execute?: () => McpToolResult | Error | Promise<McpToolResult>; descriptors?: McpToolDescriptor[]; actor?: string } = {}) {
  const calls: Call[] = [];
  const toolset: McpToolset = {
    actor: opts.actor ?? JANE,
    descriptors: opts.descriptors ?? [SEARCH_TOOL, DRAFT_TOOL],
    call: async (name, args, _signal, o) => {
      calls.push({ name, args, ...(o ? { opts: o } : {}) });
      const r = (await opts.execute?.()) ?? { text: "Draft created.", isError: false, structured: { id: "r-123" } };
      if (r instanceof Error) throw r;
      return r;
    },
    refresh: async () => {},
  };
  const state = { connected: true };
  const workspace: WorkspaceProvider = {
    forActor: async (email): Promise<WorkspaceToolsets> =>
      state.connected && email?.toLowerCase() === toolset.actor
        ? { gmail: toolset, status: { gmail: "connected", drive: "not_connected", calendar: "not_connected", docs: "not_connected" } }
        : { status: { gmail: "not_connected", drive: "not_connected", calendar: "not_connected", docs: "not_connected" } },
    forget: () => {},
  };
  return { calls, toolset, workspace, state };
}

function service(gmail: ReturnType<typeof scriptedGmail>, clock = { t: T0 }, withWorkspace = true) {
  let n = 0;
  const store = new InMemoryCrmWriteProposalStore();
  const svc = new CrmWriteService({ store, logger: createLogger({ test: true }), now: () => clock.t, newId: () => `g${++n}`, ...(withWorkspace ? { workspace: gmail.workspace } : {}) });
  return { svc, store, clock };
}

const propose = (svc: CrmWriteService, toolset: McpToolset, args: Record<string, unknown> = ARGS) =>
  svc.proposeGmailDraft({ sessionId: "s1", requestId: "r1", toolset, tool: TOOL, args });

const proposed = async (svc: CrmWriteService, toolset: McpToolset, args?: Record<string, unknown>) => {
  const r = await propose(svc, toolset, args);
  if (!r.ok) throw new Error(r.error);
  return r.view;
};

describe("gmailDraftPreview", () => {
  test("maps to, subject and body into a create preview with before null", () => {
    const r = gmailDraftPreview(TOOL, ARGS);
    expect(r).toEqual({
      ok: true,
      preview: {
        tool: TOOL,
        target: { entity: "gmailDraft", id: null, label: "Your offer letter", parent: { entity: "recipient", id: "sam@student.test", label: "sam@student.test" } },
        changes: [
          { field: "to", label: "To", before: null, after: "sam@student.test" },
          { field: "subject", label: "Subject", before: null, after: "Your offer letter" },
          { field: "body", label: "Body", before: null, after: ARGS.body },
        ],
        version: null,
      },
    });
  });

  test("reads other key spellings case-insensitively, and shows unknown args under their own key", () => {
    const r = gmailDraftPreview(TOOL, {
      Recipients: "a@x.test, b@x.test",
      CC: ["c@x.test", "d@x.test"],
      bcc: "e@x.test",
      Subject: "Hello",
      plainTextBody: "Plain body",
      htmlBody: "<p>Html body</p>",
      thread_id: "t-1",
      priority: "high",
      empty: "",
      nothing: null,
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.preview.changes).toEqual([
      { field: "Recipients", label: "To", before: null, after: "a@x.test, b@x.test" },
      { field: "CC", label: "Cc", before: null, after: "c@x.test, d@x.test" },
      { field: "bcc", label: "Bcc", before: null, after: "e@x.test" },
      { field: "Subject", label: "Subject", before: null, after: "Hello" },
      { field: "thread_id", label: "In reply to thread", before: null, after: "t-1" },
      { field: "plainTextBody", label: "Body", before: null, after: "Plain body" },
      { field: "htmlBody", label: "Body (HTML)", before: null, after: "<p>Html body</p>" },
      { field: "priority", label: "priority", before: null, after: "high" },
    ]);
    expect(r.preview.target).toEqual({ entity: "gmailDraft", id: null, label: "Hello", parent: { entity: "recipient", id: "a@x.test", label: "a@x.test" } });
  });

  test("text and content are bodies too; threadId alone is enough; no subject reads as (no subject)", () => {
    const a = gmailDraftPreview(TOOL, { threadId: "t-9", text: "Thanks!" });
    if (!a.ok) throw new Error(a.error);
    expect(a.preview.target).toEqual({ entity: "gmailDraft", id: null, label: "(no subject)" });
    expect(a.preview.changes.map((c) => c.label)).toEqual(["In reply to thread", "Body"]);

    const b = gmailDraftPreview(TOOL, { to: "x@y.test", content: "Hi" });
    expect(b.ok && b.preview.changes.map((c) => [c.label, c.after])).toEqual([["To", "x@y.test"], ["Body", "Hi"]]);
  });

  test("no recipient and no thread, or no body, is an error the model can fix", () => {
    expect(gmailDraftPreview(TOOL, { subject: "Hi", body: "Hello" })).toEqual({ ok: false, error: expect.stringContaining("recipient") });
    expect(gmailDraftPreview(TOOL, { to: [], subject: "Hi", body: "Hello" })).toEqual({ ok: false, error: expect.stringContaining("recipient") });
    expect(gmailDraftPreview(TOOL, { to: "sam@student.test", subject: "Hi" })).toEqual({ ok: false, error: expect.stringContaining("body") });
    expect(gmailDraftPreview(TOOL, { to: "sam@student.test", body: "   " })).toEqual({ ok: false, error: expect.stringContaining("body") });
  });

  test("a very long body is capped in the preview but the stored args stay whole", async () => {
    const body = "x".repeat(25_000);
    const r = gmailDraftPreview(TOOL, { to: "a@x.test", body });
    if (!r.ok) throw new Error(r.error);
    const shown = String(r.preview.changes.find((c) => c.label === "Body")!.after);
    expect(shown.length).toBeLessThan(20_100);
    expect(shown.startsWith("x".repeat(20_000))).toBe(true);
    expect(shown).toContain("5000 more characters");

    const gmail = scriptedGmail();
    const { svc, store } = service(gmail);
    const view = await proposed(svc, gmail.toolset, { to: "a@x.test", body });
    expect((await store.get(view.proposalId))!.args.body).toBe(body);
  });
});

describe("CrmWriteService.proposeGmailDraft", () => {
  test("stores a pending gmail proposal without calling Gmail", async () => {
    const gmail = scriptedGmail();
    const { svc, store } = service(gmail);

    const r = await propose(svc, gmail.toolset);

    expect(gmail.calls).toEqual([]);
    expect(r).toEqual({
      ok: true,
      view: {
        proposalId: "g1",
        requestId: "r1",
        provider: "gmail",
        tool: TOOL,
        target: { entity: "gmailDraft", id: null, label: "Your offer letter", parentLabel: "sam@student.test" },
        changes: [
          { field: "to", label: "To", before: null, after: "sam@student.test" },
          { field: "subject", label: "Subject", before: null, after: "Your offer letter" },
          { field: "body", label: "Body", before: null, after: ARGS.body },
        ],
        status: "pending",
        expiresAt: new Date(T0.getTime() + 30 * 60_000).toISOString(),
      },
    });
    expect(await store.get("g1")).toMatchObject({ provider: "gmail", sessionId: "s1", actorEmail: JANE, tool: TOOL, args: ARGS, status: "pending" });
  });

  test("an invalid draft stores nothing", async () => {
    const gmail = scriptedGmail();
    const { svc, store } = service(gmail);
    const r = await propose(svc, gmail.toolset, { subject: "Hi" });
    expect(r.ok).toBe(false);
    expect(await store.listForSession("s1")).toEqual([]);
  });
});

describe("CrmWriteService.decide for a Gmail draft", () => {
  const decide = (svc: CrmWriteService, proposalId: string, decision: "approve" | "reject", actorEmail = JANE) => svc.decide({ proposalId, actorEmail, decision });

  test("approve calls create_draft once with the stored args and ends applied with a drafts link", async () => {
    const gmail = scriptedGmail();
    const { svc, clock } = service(gmail);
    const view = await proposed(svc, gmail.toolset);
    clock.t = new Date(T0.getTime() + 60_000);

    const r = await decide(svc, view.proposalId, "approve");

    expect(gmail.calls).toEqual([{ name: TOOL, args: ARGS }]);
    expect(r).toEqual({
      kind: "ok",
      view: { ...view, status: "applied", decidedAt: clock.t.toISOString(), result: { link: "https://mail.google.com/mail/u/?authuser=jane%40heubert.com#drafts", id: "r-123" } },
    });
  });

  test("a draft id is also read from a nested draft object or the text", async () => {
    const nested = scriptedGmail({ execute: () => ({ text: "ok", isError: false, structured: { draft: { id: "r-nested" } } }) });
    const a = service(nested);
    const v1 = await proposed(a.svc, nested.toolset);
    expect(await decide(a.svc, v1.proposalId, "approve")).toMatchObject({ view: { result: { id: "r-nested" } } });

    const text = scriptedGmail({ execute: () => ({ text: "Draft created. Draft ID: r-777", isError: false }) });
    const b = service(text);
    const v2 = await proposed(b.svc, text.toolset);
    expect(await decide(b.svc, v2.proposalId, "approve")).toMatchObject({ view: { result: { id: "r-777" } } });

    const none = scriptedGmail({ execute: () => ({ text: "Done.", isError: false }) });
    const c = service(none);
    const v3 = await proposed(c.svc, none.toolset);
    const r = await decide(c.svc, v3.proposalId, "approve");
    expect(r.kind === "ok" && r.view.result).toEqual({ link: "https://mail.google.com/mail/u/?authuser=jane%40heubert.com#drafts" });
  });

  test("two concurrent approves create exactly one draft", async () => {
    const gmail = scriptedGmail({ execute: () => new Promise((resolve) => setTimeout(() => resolve({ text: "Draft created.", isError: false }), 5)) });
    const { svc } = service(gmail);
    const view = await proposed(svc, gmail.toolset);
    const results = await Promise.all([decide(svc, view.proposalId, "approve"), decide(svc, view.proposalId, "approve")]);
    expect(gmail.calls).toHaveLength(1);
    expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
    expect(await decide(svc, view.proposalId, "approve")).toMatchObject({ kind: "conflict", view: { status: "applied" } });
    expect(gmail.calls).toHaveLength(1);
  });

  test("reject never calls Gmail", async () => {
    const gmail = scriptedGmail();
    const { svc } = service(gmail);
    const view = await proposed(svc, gmail.toolset);
    expect(await decide(svc, view.proposalId, "reject")).toMatchObject({ kind: "ok", view: { status: "rejected", provider: "gmail" } });
    expect(gmail.calls).toHaveLength(0);
  });

  test("an approve after expiry expires it and never calls Gmail", async () => {
    const gmail = scriptedGmail();
    const { svc, clock } = service(gmail);
    const view = await proposed(svc, gmail.toolset);
    clock.t = new Date(view.expiresAt);
    expect(await decide(svc, view.proposalId, "approve")).toMatchObject({ kind: "conflict", view: { status: "expired" } });
    expect(gmail.calls).toHaveLength(0);
  });

  test("another consultant's approve is not_found", async () => {
    const gmail = scriptedGmail();
    const { svc } = service(gmail);
    const view = await proposed(svc, gmail.toolset);
    expect(await decide(svc, view.proposalId, "approve", "sam@heubert.com")).toEqual({ kind: "not_found" });
    expect(gmail.calls).toHaveLength(0);
  });

  test("Gmail disconnected, the draft tool gone, or no workspace at approve time ends failed", async () => {
    const off = scriptedGmail();
    const a = service(off);
    const v1 = await proposed(a.svc, off.toolset);
    off.state.connected = false;
    expect(await decide(a.svc, v1.proposalId, "approve")).toMatchObject({ kind: "ok", view: { status: "failed", error: GMAIL_DISCONNECTED } });
    expect(off.calls).toHaveLength(0);

    const gone = scriptedGmail();
    const b = service(gone);
    const v2 = await proposed(b.svc, gone.toolset);
    (gone.toolset.descriptors as McpToolDescriptor[]).splice(1, 1);
    expect(await decide(b.svc, v2.proposalId, "approve")).toMatchObject({ kind: "ok", view: { status: "failed", error: GMAIL_DISCONNECTED } });
    expect(gone.calls).toHaveLength(0);

    const bare = scriptedGmail();
    const c = service(bare, { t: T0 }, false);
    const v3 = await proposed(c.svc, bare.toolset);
    expect(await decide(c.svc, v3.proposalId, "approve")).toMatchObject({ kind: "ok", view: { status: "failed", error: GMAIL_DISCONNECTED } });
  });

  test("a Gmail tool error or a thrown one ends failed with its text", async () => {
    const refused = scriptedGmail({ execute: () => ({ text: "Invalid recipient", isError: true }) });
    const a = service(refused);
    const v1 = await proposed(a.svc, refused.toolset);
    expect(await decide(a.svc, v1.proposalId, "approve")).toMatchObject({ kind: "ok", view: { status: "failed", error: "Invalid recipient" } });

    const down = scriptedGmail({ execute: () => new Error("Gmail MCP timeout") });
    const b = service(down);
    const v2 = await proposed(b.svc, down.toolset);
    const r = await decide(b.svc, v2.proposalId, "approve");
    expect(r).toMatchObject({ kind: "ok", view: { status: "failed", error: "Gmail MCP timeout" } });
    expect(r.kind === "ok" && r.view.result).toBeUndefined();
  });
});

describe("stored rows from before providers existed", () => {
  const legacy = (): Omit<CrmWriteProposal, "provider"> => ({
    id: "old",
    sessionId: "s1",
    requestId: "r1",
    actorEmail: JANE,
    tool: "crm_update_contact",
    args: { id: "c1" },
    preview: { tool: "crm_update_contact", target: { entity: "contact", id: "c1", label: "Jane Doe" }, changes: [], version: null },
    status: "pending",
    createdAt: T0,
    expiresAt: new Date(T0.getTime() + 60_000),
  });

  test("toView reads a row without provider as crm", () => {
    expect(toView(legacy() as CrmWriteProposal).provider).toBe("crm");
  });

  test("the Mongo store reads a doc without provider as crm", async () => {
    const doc = { ...legacy(), _id: "old" } as unknown as CrmWriteProposalDoc;
    const collection = { findOne: async () => doc, findOneAndUpdate: async () => doc, find: () => ({ sort: () => ({ toArray: async () => [doc] }) }) };
    const store = new MongoCrmWriteProposalStore(collection as never);
    expect((await store.get("old"))!.provider).toBe("crm");
    expect((await store.transition("old", "pending", { status: "rejected" }))!.provider).toBe("crm");
    expect((await store.listForSession("s1"))[0]!.provider).toBe("crm");
  });

  test("the Mongo store persists provider and result", async () => {
    const inserted: unknown[] = [];
    const patches: unknown[] = [];
    const collection = { insertOne: async (d: unknown) => void inserted.push(d), findOneAndUpdate: async (_f: unknown, u: unknown) => (patches.push(u), null) };
    const store = new MongoCrmWriteProposalStore(collection as never);
    await store.create({ ...legacy(), provider: "gmail" });
    await store.transition("old", "applying", { status: "applied", result: { link: "https://mail.google.com/x" } });
    expect(inserted[0]).toMatchObject({ _id: "old", provider: "gmail" });
    expect(patches[0]).toEqual({ $set: { status: "applied", result: { link: "https://mail.google.com/x" } } });
  });
});

describe("decisionNote for Gmail drafts", () => {
  const view = (status: CrmWriteProposalView["status"], error?: string): CrmWriteProposalView => ({
    proposalId: "g1",
    requestId: "r1",
    provider: "gmail",
    tool: TOOL,
    target: { entity: "gmailDraft", id: null, label: "Your offer letter", parentLabel: "sam@student.test" },
    changes: [],
    status,
    expiresAt: T0.toISOString(),
    ...(error ? { error } : {}),
  });

  test("says the draft was saved (not sent), rejected, expired or failed in Gmail", () => {
    const note = decisionNote([view("applied"), view("rejected"), view("expired"), view("failed", "Invalid recipient")])!;
    expect(note).toContain('The consultant approved and the Gmail draft "Your offer letter" to sam@student.test was saved to their Drafts. It was not sent.');
    expect(note).toContain('The consultant rejected the Gmail draft "Your offer letter" to sam@student.test. It was not saved.');
    expect(note).toContain('The Gmail draft "Your offer letter" to sam@student.test expired without a decision and was not saved.');
    expect(note).toContain('The Gmail draft "Your offer letter" to sam@student.test could not be saved: Invalid recipient.');
    expect(note).not.toContain("CRM applied");
  });
});

describe("makeGmailDraftTools", () => {
  const writesFor = (gmail: ReturnType<typeof scriptedGmail>) => service(gmail);

  test("offers nothing without a writes service, without a write create_draft descriptor, or when the service cannot apply drafts", () => {
    const gmail = scriptedGmail();
    expect(makeGmailDraftTools(gmail.toolset, {})).toEqual([]);
    const readOnly = scriptedGmail({ descriptors: [SEARCH_TOOL, { ...DRAFT_TOOL, annotations: { readOnlyHint: true } }] });
    expect(makeGmailDraftTools(readOnly.toolset, { writes: writesFor(readOnly).svc })).toEqual([]);
    const missing = scriptedGmail({ descriptors: [SEARCH_TOOL] });
    expect(makeGmailDraftTools(missing.toolset, { writes: writesFor(missing).svc })).toEqual([]);
    expect(makeGmailDraftTools(gmail.toolset, { writes: service(gmail, { t: T0 }, false).svc })).toEqual([]);
  });

  test("the tool stores a proposal, dispatches the card event, records a summary and says nothing was saved or sent", async () => {
    const gmail = scriptedGmail();
    const { svc, store } = writesFor(gmail);
    const proposals: string[] = [];
    const [draft] = makeGmailDraftTools(gmail.toolset, { writes: svc, proposals });
    expect(draft!.name).toBe(TOOL);

    const events: { name: string; data: unknown }[] = [];
    const out = String(
      await draft!.invoke(ARGS, { metadata: { requestId: "r1", sessionId: "s1" }, callbacks: [{ handleCustomEvent: (name: string, data: unknown) => void events.push({ name, data }) }] }),
    );

    expect(gmail.calls).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe(CRM_WRITE_PROPOSAL_EVENT);
    expect(events[0]!.data).toMatchObject({ proposalId: "g1", provider: "gmail", status: "pending", target: { entity: "gmailDraft", label: "Your offer letter" } });
    expect(out).toStartWith("PROPOSED, NOT SAVED (proposal g1)");
    expect(out).toContain("approve");
    expect(out).toContain("Nothing is sent");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toContain("Your offer letter");
    expect(proposals[0]).toContain("sam@student.test");
    expect(proposals[0]!.length).toBeLessThan(400);
    expect((await store.get("g1"))!.status).toBe("pending");
  });

  test("an invalid draft or a call outside a chat turn returns an error for the model", async () => {
    const gmail = scriptedGmail();
    const { svc } = writesFor(gmail);
    const [draft] = makeGmailDraftTools(gmail.toolset, { writes: svc });
    expect(String(await draft!.invoke({ subject: "Hi" }, { metadata: { requestId: "r1", sessionId: "s1" } }))).toMatch(/^error: .*recipient/);
    expect(String(await draft!.invoke(ARGS))).toMatch(/^error\b/);
  });
});

describe("gmailDraftPreview against Google's create_draft arguments", () => {
  const { gmailDraftPreview } = require("../src/crm/approvals/service") as typeof import("../src/crm/approvals/service");
  test("a reply by replyToMessageId needs no recipient and is labelled for the card", () => {
    const r = gmailDraftPreview("gmail_create_draft", { replyToMessageId: "18c2f00aa1b2c3d4", htmlBody: "<p>Thanks</p>" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.preview.changes.map((c) => c.label)).toEqual(["In reply to message", "Body (HTML)"]);
  });
  test("attachments are refused, so a card never approves file content nobody saw", () => {
    const r = gmailDraftPreview("gmail_create_draft", { to: ["a@x.com"], body: "hi", attachments: [{ filename: "a.pdf", data: "JVBERi0=" }] });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("cannot attach files") });
  });
});
