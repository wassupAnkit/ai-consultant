import { describe, expect, test } from "bun:test";
import type { CrmCallOptions, CrmProvider, CrmToolDescriptor, CrmToolResult, CrmToolset } from "../src/crm/client";
import { decisionNote } from "../src/crm/approvals/history";
import { CrmWriteService } from "../src/crm/approvals/service";
import { InMemoryCrmWriteProposalStore } from "../src/crm/approvals/store";
import { createLogger } from "../src/observability/logger";
import { CRM_READ_TOOL, fakeToolset } from "./fakes";
import { MongoCrmWriteProposalStore, type CrmWriteProposalDoc } from "../src/crm/approvals/mongo-store";
import type { CrmWritePreview, CrmWriteProposal, CrmWriteProposalView } from "../src/crm/approvals/types";

const T0 = new Date("2026-09-29T10:00:00.000Z");

const samplePreview = (over: Partial<CrmWritePreview> = {}): CrmWritePreview => ({
  tool: "crm_update_contact",
  target: { entity: "contact", id: "c1", label: "Jane Doe" },
  changes: [{ field: "phone", label: "Phone", before: "0400 000 000", after: "0411 111 111" }],
  version: "2026-09-01T00:00:00.000Z",
  ...over,
});

const proposal = (over: Partial<CrmWriteProposal> = {}): CrmWriteProposal => ({
  id: "p1",
  provider: "crm",
  sessionId: "s1",
  requestId: "r1",
  actorEmail: "jane@heubert.com",
  tool: "crm_update_contact",
  args: { id: "c1", phone: "0411 111 111" },
  preview: samplePreview(),
  status: "pending",
  createdAt: T0,
  expiresAt: new Date(T0.getTime() + 30 * 60_000),
  ...over,
});

describe("InMemoryCrmWriteProposalStore", () => {
  test("create then get round-trips the proposal", async () => {
    const store = new InMemoryCrmWriteProposalStore();
    await store.create(proposal());
    expect(await store.get("p1")).toEqual(proposal());
    expect(await store.get("nope")).toBeNull();
  });

  test("a stored proposal cannot be mutated through the object the caller holds", async () => {
    const store = new InMemoryCrmWriteProposalStore();
    const p = proposal();
    await store.create(p);
    p.status = "applied";
    (await store.get("p1"))!.status = "applied";
    expect((await store.get("p1"))!.status).toBe("pending");
  });

  test("two concurrent transitions out of pending let exactly one win", async () => {
    const store = new InMemoryCrmWriteProposalStore();
    await store.create(proposal());
    const results = await Promise.all([
      store.transition("p1", "pending", { status: "applying" }),
      store.transition("p1", "pending", { status: "applying" }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect((await store.get("p1"))!.status).toBe("applying");
  });

  test("a transition from the wrong status, or of a missing proposal, returns null", async () => {
    const store = new InMemoryCrmWriteProposalStore();
    await store.create(proposal({ status: "applied" }));
    expect(await store.transition("p1", "pending", { status: "rejected" })).toBeNull();
    expect(await store.transition("missing", "pending", { status: "rejected" })).toBeNull();
    expect((await store.get("p1"))!.status).toBe("applied");
  });

  test("expireSession expires only that session's pending proposals", async () => {
    const store = new InMemoryCrmWriteProposalStore();
    await store.create(proposal({ id: "a" }));
    await store.create(proposal({ id: "b", status: "applied" }));
    await store.create(proposal({ id: "c", sessionId: "s2" }));
    const now = new Date(T0.getTime() + 60_000);

    expect(await store.expireSession("s1", now)).toBe(1);
    expect(await store.get("a")).toMatchObject({ status: "expired", decidedAt: now });
    expect((await store.get("b"))!.status).toBe("applied");
    expect((await store.get("c"))!.status).toBe("pending");
  });

  test("listForSession returns that session's proposals in creation order", async () => {
    const store = new InMemoryCrmWriteProposalStore();
    await store.create(proposal({ id: "z", createdAt: T0 }));
    await store.create(proposal({ id: "other", sessionId: "s2" }));
    await store.create(proposal({ id: "a", createdAt: new Date(T0.getTime() + 1) }));
    expect((await store.listForSession("s1")).map((p) => p.id)).toEqual(["z", "a"]);
  });
});

/** Records what the Mongo store asks of its collection; returns scripted answers. */
function fakeCollection(answers: { findOneAndUpdate?: unknown; updateMany?: { modifiedCount: number }; find?: CrmWriteProposalDoc[] } = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    if (method === "find") return { sort: (s: unknown) => (calls.push({ method: "sort", args: [s] }), { toArray: async () => answers.find ?? [] }) };
    if (method === "updateMany") return Promise.resolve(answers.updateMany ?? { modifiedCount: 0 });
    if (method === "findOneAndUpdate") return Promise.resolve(answers.findOneAndUpdate ?? null);
    return Promise.resolve(null);
  };
  const collection = { insertOne: record("insertOne"), findOne: record("findOne"), findOneAndUpdate: record("findOneAndUpdate"), updateMany: record("updateMany"), find: record("find") };
  return { calls, collection: collection as never };
}

describe("MongoCrmWriteProposalStore", () => {
  test("transition is a compare-and-set on the from status, and maps the doc back", async () => {
    const doc: CrmWriteProposalDoc = { ...proposal({ status: "applying" }), _id: "p1" } as CrmWriteProposalDoc;
    const { calls, collection } = fakeCollection({ findOneAndUpdate: doc });
    const store = new MongoCrmWriteProposalStore(collection);

    const out = await store.transition("p1", "pending", { status: "applying" });

    expect(calls[0]).toEqual({ method: "findOneAndUpdate", args: [{ _id: "p1", status: "pending" }, { $set: { status: "applying" } }, { returnDocument: "after" }] });
    expect(out).toEqual(proposal({ status: "applying" }));
    expect(out && "_id" in out).toBe(false);
  });

  test("a lost compare-and-set returns null", async () => {
    const { collection } = fakeCollection({ findOneAndUpdate: null });
    expect(await new MongoCrmWriteProposalStore(collection).transition("p1", "pending", { status: "rejected" })).toBeNull();
  });

  test("expireSession updates only pending proposals of the session", async () => {
    const { calls, collection } = fakeCollection({ updateMany: { modifiedCount: 2 } });
    const now = new Date();
    expect(await new MongoCrmWriteProposalStore(collection).expireSession("s1", now)).toBe(2);
    expect(calls[0]).toEqual({ method: "updateMany", args: [{ sessionId: "s1", status: "pending" }, { $set: { status: "expired", decidedAt: now } }] });
  });

  test("create stores the id as _id", async () => {
    const { calls, collection } = fakeCollection();
    await new MongoCrmWriteProposalStore(collection).create(proposal());
    expect(calls[0]!.method).toBe("insertOne");
    expect(calls[0]!.args[0]).toMatchObject({ _id: "p1", id: "p1", status: "pending" });
  });
});

const WRITE_TOOL: CrmToolDescriptor = {
  name: "crm_update_contact",
  description: "Change a contact's details.",
  inputSchema: { type: "object", properties: {} } as never,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
const VERSION = "2026-09-01T00:00:00.000Z";
const ARGS = { id: "c1", phone: "0411 111 111" };

type Call = { name: string; args: Record<string, unknown>; opts?: CrmCallOptions };

/**
 * A scripted CRM: dry runs answer with a preview, executes with `execute` (applied by default).
 * `calls` records every call, dry run or not.
 */
function scriptedCrm(opts: { dryRun?: () => CrmToolResult; execute?: () => CrmToolResult | Error; descriptors?: CrmToolDescriptor[]; offline?: boolean } = {}) {
  const calls: Call[] = [];
  const answer = (_name: string, _args: Record<string, unknown>, o?: CrmCallOptions): CrmToolResult => {
    if (o?.meta?.["heubert/dryRun"]) return opts.dryRun?.() ?? { text: "preview", isError: false, structured: { preview: samplePreview() } };
    const r = opts.execute?.() ?? { text: "Contact updated.", isError: false };
    if (r instanceof Error) throw r;
    return r;
  };
  const toolset = fakeToolset(answer, (name, args, o) => calls.push({ name, args, ...(o ? { opts: o } : {}) }), opts.descriptors ?? [CRM_READ_TOOL, WRITE_TOOL]);
  const provider: CrmProvider = { forActor: async (email) => (opts.offline || !email ? undefined : toolset) };
  const executes = () => calls.filter((c) => !c.opts?.meta?.["heubert/dryRun"]);
  return { calls, executes, toolset, provider };
}

function service(crm: ReturnType<typeof scriptedCrm>, clock = { t: T0 }) {
  let n = 0;
  const store = new InMemoryCrmWriteProposalStore();
  const svc = new CrmWriteService({ store, crm: crm.provider, logger: createLogger({ test: true }), now: () => clock.t, newId: () => `p${++n}` });
  return { svc, store, clock };
}

const propose = (svc: CrmWriteService, toolset: CrmToolset, over: { sessionId?: string; requestId?: string } = {}) =>
  svc.propose({ sessionId: over.sessionId ?? "s1", requestId: over.requestId ?? "r1", toolset, tool: "crm_update_contact", args: ARGS });

const proposed = async (svc: CrmWriteService, toolset: CrmToolset) => {
  const r = await propose(svc, toolset);
  if (!r.ok) throw new Error(r.error);
  return r.view;
};

describe("CrmWriteService.propose", () => {
  test("dry-runs the call and stores a pending proposal that expires 30 minutes later", async () => {
    const crm = scriptedCrm();
    const { svc, store } = service(crm);

    const r = await propose(svc, crm.toolset);

    expect(crm.calls).toEqual([{ name: "crm_update_contact", args: ARGS, opts: { meta: { "heubert/dryRun": true } } }]);
    expect(r).toEqual({
      ok: true,
      view: {
        proposalId: "p1",
        requestId: "r1",
        provider: "crm",
        tool: "crm_update_contact",
        target: { entity: "contact", id: "c1", label: "Jane Doe" },
        changes: samplePreview().changes,
        status: "pending",
        expiresAt: new Date(T0.getTime() + 30 * 60_000).toISOString(),
      },
    });
    expect(await store.get("p1")).toMatchObject({ provider: "crm", sessionId: "s1", requestId: "r1", actorEmail: "jane@heubert.com", args: ARGS, status: "pending", createdAt: T0 });
  });

  test("a dry run the CRM refuses stores nothing", async () => {
    const crm = scriptedCrm({ dryRun: () => ({ text: "crm_update_contact failed: not visible", isError: true }) });
    const { svc, store } = service(crm);
    expect(await propose(svc, crm.toolset)).toEqual({ ok: false, error: "crm_update_contact failed: not visible" });
    expect(await store.listForSession("s1")).toEqual([]);
  });

  test("a dry run without a preview stores nothing", async () => {
    const crm = scriptedCrm({ dryRun: () => ({ text: "Contact updated.", isError: false }) });
    const { svc, store } = service(crm);
    expect(await propose(svc, crm.toolset)).toEqual({ ok: false, error: "the CRM returned no preview" });
    expect(await store.listForSession("s1")).toEqual([]);
  });
});

describe("CrmWriteService.decide", () => {
  const decide = (svc: CrmWriteService, proposalId: string, decision: "approve" | "reject", actorEmail = "jane@heubert.com") => svc.decide({ proposalId, actorEmail, decision });

  test("approve replays the exact args with the previewed version, and ends applied", async () => {
    const crm = scriptedCrm();
    const { svc, clock } = service(crm);
    const view = await proposed(svc, crm.toolset);
    clock.t = new Date(T0.getTime() + 60_000);

    const r = await decide(svc, view.proposalId, "approve");

    expect(crm.executes()).toEqual([{ name: "crm_update_contact", args: ARGS, opts: { meta: { "heubert/expectedVersion": VERSION } } }]);
    expect(r).toEqual({ kind: "ok", view: { ...view, status: "applied", decidedAt: clock.t.toISOString() } });
  });

  test("a create (no version) executes with no meta", async () => {
    const crm = scriptedCrm({ dryRun: () => ({ text: "p", isError: false, structured: { preview: samplePreview({ target: { entity: "note", id: null, label: "New note" }, version: null }) } }) });
    const { svc } = service(crm);
    const view = await proposed(svc, crm.toolset);
    await decide(svc, view.proposalId, "approve");
    expect(crm.executes()).toHaveLength(1);
    expect(crm.executes()[0]!.opts?.meta).toBeUndefined();
  });

  test("a stale record ends stale, with the CRM's current changes", async () => {
    const current = [{ field: "phone", label: "Phone", before: "0422 222 222", after: "0411 111 111" }];
    const crm = scriptedCrm({
      execute: () => ({ text: "record changed", isError: true, structured: { error: { code: "STALE_RECORD", status: 409, detail: "changed" }, preview: samplePreview({ changes: current, version: "2026-09-02T00:00:00.000Z" }) } }),
    });
    const { svc } = service(crm);
    const view = await proposed(svc, crm.toolset);

    const r = await decide(svc, view.proposalId, "approve");

    expect(r).toMatchObject({ kind: "ok", view: { status: "stale", current } });
  });

  test("any other CRM error ends failed with its text; a thrown one with its message", async () => {
    const refused = scriptedCrm({ execute: () => ({ text: "crm_update_contact failed: permission denied", isError: true }) });
    const a = service(refused);
    const v1 = await proposed(a.svc, refused.toolset);
    expect(await decide(a.svc, v1.proposalId, "approve")).toMatchObject({ kind: "ok", view: { status: "failed", error: "crm_update_contact failed: permission denied" } });

    const down = scriptedCrm({ execute: () => new Error("CRM unreachable: timeout") });
    const b = service(down);
    const v2 = await proposed(b.svc, down.toolset);
    expect(await decide(b.svc, v2.proposalId, "approve")).toMatchObject({ kind: "ok", view: { status: "failed", error: "CRM unreachable: timeout" } });
  });

  test("reject never calls the CRM", async () => {
    const crm = scriptedCrm();
    const { svc } = service(crm);
    const view = await proposed(svc, crm.toolset);
    expect(await decide(svc, view.proposalId, "reject")).toMatchObject({ kind: "ok", view: { status: "rejected", decidedAt: T0.toISOString() } });
    expect(crm.executes()).toHaveLength(0);
  });

  test("a second approve of an applied proposal is a conflict and makes no second CRM call", async () => {
    const crm = scriptedCrm();
    const { svc } = service(crm);
    const view = await proposed(svc, crm.toolset);
    await decide(svc, view.proposalId, "approve");
    expect(await decide(svc, view.proposalId, "approve")).toMatchObject({ kind: "conflict", view: { status: "applied" } });
    expect(await decide(svc, view.proposalId, "reject")).toMatchObject({ kind: "conflict", view: { status: "applied" } });
    expect(crm.executes()).toHaveLength(1);
  });

  test("an approve at or after expiresAt expires the proposal and makes no CRM call", async () => {
    const crm = scriptedCrm();
    const { svc, clock } = service(crm);
    const view = await proposed(svc, crm.toolset);
    clock.t = new Date(view.expiresAt);
    expect(await decide(svc, view.proposalId, "approve")).toMatchObject({ kind: "conflict", view: { status: "expired" } });
    expect(crm.executes()).toHaveLength(0);
  });

  test("another counsellor's approve is not_found, like a missing proposal", async () => {
    const crm = scriptedCrm();
    const { svc } = service(crm);
    const view = await proposed(svc, crm.toolset);
    expect(await decide(svc, view.proposalId, "approve", "sam@heubert.com")).toEqual({ kind: "not_found" });
    expect(await decide(svc, "nope", "approve")).toEqual({ kind: "not_found" });
    expect(crm.executes()).toHaveLength(0);
    // The owner's email is compared case-insensitively.
    expect(await decide(svc, view.proposalId, "reject", "Jane@Heubert.com")).toMatchObject({ kind: "ok", view: { status: "rejected" } });
  });

  test("two concurrent approves produce exactly one CRM call", async () => {
    const crm = scriptedCrm();
    const { svc } = service(crm);
    const view = await proposed(svc, crm.toolset);
    const results = await Promise.all([decide(svc, view.proposalId, "approve"), decide(svc, view.proposalId, "approve")]);
    expect(crm.executes()).toHaveLength(1);
    expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
  });

  test("a write tool gone from the descriptors at decision time fails as switched off", async () => {
    const crm = scriptedCrm();
    const { svc } = service(crm);
    const view = await proposed(svc, crm.toolset);
    (crm.toolset.descriptors as CrmToolDescriptor[]).splice(1, 1);
    expect(await decide(svc, view.proposalId, "approve")).toMatchObject({ kind: "ok", view: { status: "failed", error: "CRM writes are switched off" } });
    expect(crm.executes()).toHaveLength(0);
  });

  test("no CRM toolset for the actor at decision time fails as switched off", async () => {
    const online = scriptedCrm();
    const offline = scriptedCrm({ offline: true });
    const store = new InMemoryCrmWriteProposalStore();
    const logger = createLogger({ test: true });
    const now = () => T0;
    const view = await proposed(new CrmWriteService({ store, crm: online.provider, logger, now }), online.toolset);
    const r = await new CrmWriteService({ store, crm: offline.provider, logger, now }).decide({ proposalId: view.proposalId, actorEmail: "jane@heubert.com", decision: "approve" });
    expect(r).toMatchObject({ kind: "ok", view: { status: "failed", error: "CRM writes are switched off" } });
  });

  test("a service built without a CRM provider (Gmail drafts only) fails a CRM approve as switched off", async () => {
    const online = scriptedCrm();
    const store = new InMemoryCrmWriteProposalStore();
    const logger = createLogger({ test: true });
    const now = () => T0;
    const view = await proposed(new CrmWriteService({ store, crm: online.provider, logger, now }), online.toolset);
    const r = await new CrmWriteService({ store, logger, now }).decide({ proposalId: view.proposalId, actorEmail: "jane@heubert.com", decision: "approve" });
    expect(r).toMatchObject({ kind: "ok", view: { status: "failed", error: "CRM writes are switched off" } });
    expect(online.executes()).toHaveLength(0);
  });
});

describe("CrmWriteService session views", () => {
  test("expireSession expires the session's pending proposals; viewsForSession groups them by requestId", async () => {
    const crm = scriptedCrm();
    const { svc } = service(crm);
    await propose(svc, crm.toolset, { requestId: "r1" });
    await propose(svc, crm.toolset, { requestId: "r1" });
    await propose(svc, crm.toolset, { requestId: "r2" });
    await propose(svc, crm.toolset, { sessionId: "s2", requestId: "r3" });

    expect(await svc.expireSession("s1")).toBe(3);
    const views = await svc.viewsForSession("s1");
    expect([...views.keys()]).toEqual(["r1", "r2"]);
    expect(views.get("r1")!.map((v) => [v.proposalId, v.status])).toEqual([["p1", "expired"], ["p2", "expired"]]);
    expect((await svc.viewsForSession("s2")).get("r3")![0]!.status).toBe("pending");
  });
});

describe("decisionNote", () => {
  const view = (status: CrmWriteProposalView["status"], error?: string): CrmWriteProposalView => ({
    proposalId: "p1",
    requestId: "r1",
    provider: "crm",
    tool: "crm_update_contact",
    target: { entity: "contact", id: "c1", label: "Jane Doe" },
    changes: [],
    status,
    expiresAt: T0.toISOString(),
    ...(error ? { error } : {}),
  });

  test("says what the counsellor decided, one line per proposal", () => {
    expect(decisionNote([view("rejected"), view("applied")])).toBe(
      "[CRM write decisions]\nThe counsellor rejected: crm_update_contact on Jane Doe. It was not applied.\nThe counsellor approved and the CRM applied: crm_update_contact on Jane Doe.",
    );
  });

  test("covers expired, stale and failed", () => {
    expect(decisionNote([view("expired")])).toContain("crm_update_contact on Jane Doe expired without a decision and was not applied.");
    expect(decisionNote([view("stale")])).toContain("crm_update_contact on Jane Doe was not applied because the record had changed.");
    expect(decisionNote([view("failed", "permission denied")])).toContain("crm_update_contact on Jane Doe failed in the CRM: permission denied.");
  });

  test("is null while nothing is decided", () => {
    expect(decisionNote([view("pending")])).toBeNull();
    expect(decisionNote([view("applying")])).toBeNull();
    expect(decisionNote([])).toBeNull();
  });
});
