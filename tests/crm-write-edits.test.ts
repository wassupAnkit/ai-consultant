import { describe, expect, test } from "bun:test";
import type { CrmCallOptions, CrmProvider, CrmToolDescriptor, CrmToolResult } from "../src/crm/client";
import { CrmWriteService } from "../src/crm/approvals/service";
import { InMemoryCrmWriteProposalStore } from "../src/crm/approvals/store";
import type { CrmWritePreview, CrmWriteProposal } from "../src/crm/approvals/types";
import { createLogger } from "../src/observability/logger";
import { fakeToolset } from "./fakes";

const T0 = new Date("2026-10-12T08:00:00.000Z");
const JANE = "jane@heubert.com";
const tool = (name: string): CrmToolDescriptor => ({ name, description: name, inputSchema: { type: "object", properties: {} } as never, annotations: { readOnlyHint: false } });
const ARGS = { id: "c1", passportNo: "PX0012345", passportExpiryDate: "2032-04-15" };

/** A CRM whose dry run echoes the requested fields as changes (before = what `current` holds). */
function crm(opts: { current?: Record<string, unknown>; refuse?: (args: Record<string, unknown>) => string | null } = {}) {
  const calls: { name: string; args: Record<string, unknown>; opts?: CrmCallOptions }[] = [];
  const current = opts.current ?? {};
  const answer = (name: string, args: Record<string, unknown>, o?: CrmCallOptions): CrmToolResult => {
    if (o?.meta?.["heubert/dryRun"]) {
      const refused = opts.refuse?.(args);
      if (refused) return { text: refused, isError: true };
      if (name === "crm_attach_contact_document") {
        return { text: "p", isError: false, structured: { preview: { tool: name, target: { entity: "document", id: args.contactId, label: "Sita", parentLabel: args.documentType }, changes: [{ field: "document", label: String(args.documentType), before: null, after: String(args.fileName) }], version: null } } };
      }
      const { id, ...fields } = args;
      const changes = Object.entries(fields)
        .map(([field, after]) => ({ field, label: field, before: (current[field] ?? null) as string | null, after: after as string }))
        .filter((c) => c.before !== c.after);
      const preview: CrmWritePreview = { tool: name, target: { entity: "contact", id: String(id), label: "Sita Shrestha" }, changes, version: "v1" };
      return { text: "p", isError: false, structured: { preview } };
    }
    return { text: "ok", isError: false };
  };
  const toolset = fakeToolset(answer, (name, args, o) => calls.push({ name, args, ...(o ? { opts: o } : {}) }), [tool("crm_update_contact"), tool("crm_create_note"), tool("crm_attach_contact_document")], JANE);
  const provider: CrmProvider = { forActor: async () => toolset };
  return { toolset, provider, calls, executes: () => calls.filter((c) => !c.opts?.meta?.["heubert/dryRun"]) };
}

function setup(c = crm(), extra: Partial<ConstructorParameters<typeof CrmWriteService>[0]> = {}) {
  let n = 0;
  const store = new InMemoryCrmWriteProposalStore();
  const statuses: { id: string; status: string; edited?: unknown }[] = [];
  const svc = new CrmWriteService({
    store,
    crm: c.provider,
    logger: createLogger({ test: true }),
    now: () => T0,
    newId: () => `p${++n}`,
    onStatus: (p: CrmWriteProposal) => statuses.push({ id: p.id, status: p.status, ...(p.edited ? { edited: p.edited } : {}) }),
    ...extra,
  });
  return { svc, store, statuses, c };
}

const proposeUpdate = (s: ReturnType<typeof setup>, args = ARGS) => s.svc.propose({ sessionId: "s1", requestId: "r1", toolset: s.c.toolset, tool: "crm_update_contact", args });

describe("propose: options used by document intake", () => {
  test("skipEmpty stores nothing when the CRM already has every value", async () => {
    const s = setup(crm({ current: { passportNo: "PX0012345", passportExpiryDate: "2032-04-15" } }));
    const r = await s.svc.propose({ sessionId: "s1", requestId: "r1", toolset: s.c.toolset, tool: "crm_update_contact", args: ARGS, skipEmpty: true });
    expect(r).toEqual({ ok: false, error: "no changes", empty: true });
    expect(await s.store.listForSession("s1")).toEqual([]);
  });

  test("an origin is stored with the proposal", async () => {
    const s = setup();
    const r = await s.svc.propose({ sessionId: "s1", requestId: "r1", toolset: s.c.toolset, tool: "crm_update_contact", args: ARGS, origin: { kind: "document", attachmentId: "a1" } });
    expect(r.ok).toBe(true);
    expect((await s.store.get("p1"))!.origin).toEqual({ kind: "document", attachmentId: "a1" });
  });
});

describe("decide with edits", () => {
  test("an edit re-runs the dry run with the edited args, applies those, and records both values", async () => {
    const s = setup();
    await proposeUpdate(s);
    const r = await s.svc.decide({ proposalId: "p1", actorEmail: JANE, decision: "approve", edits: { passportNo: "PX0012346" } });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.view.status).toBe("applied");
    expect(r.view.edited).toEqual([{ field: "passportNo", from: "PX0012345", to: "PX0012346" }]);
    expect(r.view.changes.find((c) => c.field === "passportNo")!.after).toBe("PX0012346");
    const dryRuns = s.c.calls.filter((c) => c.opts?.meta?.["heubert/dryRun"]);
    expect(dryRuns).toHaveLength(2);
    expect(dryRuns[1]!.args).toEqual({ ...ARGS, passportNo: "PX0012346" });
    expect(s.c.executes()).toEqual([{ name: "crm_update_contact", args: { ...ARGS, passportNo: "PX0012346" }, opts: { meta: { "heubert/expectedVersion": "v1" } } }]);
    const stored = (await s.store.get("p1"))!;
    expect(stored.originalArgs).toEqual(ARGS);
    expect(stored.args).toEqual({ ...ARGS, passportNo: "PX0012346" });
    expect(s.statuses.at(-1)).toMatchObject({ status: "applied", edited: [{ field: "passportNo", from: "PX0012345", to: "PX0012346" }] });
  });

  test("an edit to null or blank drops that field from the write", async () => {
    const s = setup();
    await proposeUpdate(s);
    const r = await s.svc.decide({ proposalId: "p1", actorEmail: JANE, decision: "approve", edits: { passportExpiryDate: "" } });
    expect(r.kind).toBe("ok");
    expect(s.c.executes()[0]!.args).toEqual({ id: "c1", passportNo: "PX0012345" });
  });

  test("an edit equal to the proposed value is no edit", async () => {
    const s = setup();
    await proposeUpdate(s);
    const r = await s.svc.decide({ proposalId: "p1", actorEmail: JANE, decision: "approve", edits: { passportNo: "PX0012345" } });
    expect(r.kind === "ok" && r.view.edited).toBeFalsy();
    expect(s.c.calls.filter((c) => c.opts?.meta?.["heubert/dryRun"])).toHaveLength(1);
  });

  test("invalid edits are refused and the proposal stays pending", async () => {
    const s = setup();
    await proposeUpdate(s);
    const bad = async (decision: "approve" | "reject", edits: Record<string, string | null>) => s.svc.decide({ proposalId: "p1", actorEmail: JANE, decision, edits });
    expect(await bad("reject", { passportNo: "x" })).toMatchObject({ kind: "invalid" });
    expect(await bad("approve", { firstName: "Sita" })).toMatchObject({ kind: "invalid" });
    expect(await bad("approve", { id: "c2" })).toMatchObject({ kind: "invalid" });
    expect(await bad("approve", { passportNo: null, passportExpiryDate: null })).toMatchObject({ kind: "invalid" });
    expect((await s.store.get("p1"))!.status).toBe("pending");
    expect(s.c.executes()).toEqual([]);
  });

  test("the CRM refusing the edited dry run is a 400-style refusal; the proposal stays pending", async () => {
    const s = setup(crm({ refuse: (a) => (a.passportExpiryDate === "15/04/2032" ? "passportExpiryDate must be YYYY-MM-DD" : null) }));
    await proposeUpdate(s);
    const r = await s.svc.decide({ proposalId: "p1", actorEmail: JANE, decision: "approve", edits: { passportExpiryDate: "15/04/2032" } });
    expect(r).toEqual({ kind: "invalid", message: "passportExpiryDate must be YYYY-MM-DD" });
    expect((await s.store.get("p1"))!.status).toBe("pending");
  });

  test("edits are only for crm_update_contact", async () => {
    const s = setup();
    await s.svc.propose({ sessionId: "s1", requestId: "r1", toolset: s.c.toolset, tool: "crm_attach_contact_document", args: { contactId: "c1", documentType: "Passport", fileName: "p.png", fileUrl: "u" } });
    expect(await s.svc.decide({ proposalId: "p1", actorEmail: JANE, decision: "approve", edits: { document: "x.png" } })).toMatchObject({ kind: "invalid" });
  });
});

describe("fresh arguments at apply time", () => {
  test("prepareArgs replaces the args sent to the CRM on approve (a fresh signed fileUrl); the stored args keep the original", async () => {
    let n = 0;
    const s = setup(crm(), { prepareArgs: (p) => (p.tool === "crm_attach_contact_document" && p.origin ? { ...p.args, fileUrl: `fresh-${++n}` } : p.args) });
    await s.svc.propose({ sessionId: "s1", requestId: "r1", toolset: s.c.toolset, tool: "crm_attach_contact_document", args: { contactId: "c1", documentType: "Passport", fileName: "p.png", fileUrl: "old" }, origin: { kind: "document", attachmentId: "a1" } });
    await s.svc.decide({ proposalId: "p1", actorEmail: JANE, decision: "approve" });
    expect(s.c.executes()[0]!.args.fileUrl).toBe("fresh-1");
    expect((await s.store.get("p1"))!.args.fileUrl).toBe("old");
  });
});

describe("status hook", () => {
  test("reports reject, apply and session expiry", async () => {
    const s = setup();
    await proposeUpdate(s);
    await s.svc.propose({ sessionId: "s1", requestId: "r1", toolset: s.c.toolset, tool: "crm_update_contact", args: { id: "c1", gender: "Female" } });
    await s.svc.propose({ sessionId: "s1", requestId: "r1", toolset: s.c.toolset, tool: "crm_update_contact", args: { id: "c1", nationality: "Nepal" } });
    await s.svc.decide({ proposalId: "p1", actorEmail: JANE, decision: "reject" });
    await s.svc.decide({ proposalId: "p2", actorEmail: JANE, decision: "approve" });
    await s.svc.expireSession("s1");
    expect(s.statuses.map((x) => `${x.id}:${x.status}`)).toEqual(["p1:rejected", "p2:applied", "p3:expired"]);
  });
});
