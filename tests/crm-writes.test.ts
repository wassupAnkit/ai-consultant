import { afterEach, describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { createApp } from "../src/app";
import { ChatService } from "../src/app/service";
import { CrmWriteService } from "../src/crm/approvals/service";
import { InMemoryCrmWriteProposalStore } from "../src/crm/approvals/store";
import type { CrmCallOptions, CrmProvider, CrmToolDescriptor, CrmToolResult } from "../src/crm/client";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { NullKnowledgeStore } from "../src/retrieval/store";
import { CRM_READ_TOOL, fakeToolset, ScriptedToolModel, toolCall } from "./fakes";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

const API_KEY = "test-api-key-0123456789abcdef0123456789";
const JANE = "jane@heubert.com";
const VERSION = "2026-09-01T00:00:00.000Z";
const ARGS = { id: "c1", phone: "0411 111 111" };
const CHANGES = [{ field: "phone", label: "Phone", before: "0400 000 000", after: "0411 111 111" }];

const WRITE_TOOL: CrmToolDescriptor = {
  name: "crm_update_contact",
  description: "Change a contact's details.",
  inputSchema: { type: "object", properties: { id: { type: "string" }, phone: { type: "string" } } } as never,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
const preview = (changes = CHANGES, version = VERSION) => ({ tool: "crm_update_contact", target: { entity: "contact", id: "c1", label: "Jane Doe" }, changes, version });

const apps: { shutdown: (ms?: number) => Promise<void> }[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.shutdown(0);
});

/** The real Hono-less Bun app, a fake graph whose research model proposes one CRM write per turn, and a scripted CRM. */
function setup(opts: { writes?: boolean } = {}) {
  const env = testEnv({ API_KEY });
  const calls: { name: string; args: Record<string, unknown>; opts?: CrmCallOptions }[] = [];
  const crm = { execute: (): CrmToolResult => ({ text: "Contact updated.", isError: false }) };
  const answer = (_n: string, _a: Record<string, unknown>, o?: CrmCallOptions): CrmToolResult =>
    o?.meta?.["heubert/dryRun"] ? { text: "preview", isError: false, structured: { preview: preview() } } : crm.execute();
  const toolset = fakeToolset(answer, (name, args, o) => calls.push({ name, args, ...(o ? { opts: o } : {}) }), [CRM_READ_TOOL, WRITE_TOOL]);
  const provider: CrmProvider = { forActor: async (email) => (email?.toLowerCase() === JANE ? toolset : undefined) };
  const clock = { t: new Date("2026-09-29T10:00:00.000Z") };
  const proposals = new InMemoryCrmWriteProposalStore();
  const crmWrites = opts.writes === false ? undefined : new CrmWriteService({ store: proposals, crm: provider, logger: createLogger({ test: true }), now: () => clock.t });

  // Round 1 of the first turn proposes the write; every later round says "sufficient".
  const model = new ScriptedToolModel([toolCall("crm_update_contact", ARGS)]);
  const { graph } = fakeGraph({
    intent: intentOf({ primary_intent: "caseload_management", user_question: "Update Jane's phone", task: "lookup", needs_research: true }),
    answer: "I proposed the phone change; approve it below.",
    researchModel: model,
    crmProvider: provider,
    crmWrites,
  });
  const store = new InMemoryChatStore();
  const service = new ChatService({ env, graph, store, logger: createLogger({ test: true }), crmWrites });
  const app = createApp(
    {
      env,
      service,
      store,
      knowledge: new NullKnowledgeStore([sampleChunk()]),
      collections: null,
      logger: createLogger({ test: true }),
      readiness: async () => ({ ok: true, checks: {} }),
      startedAt: Date.now(),
      crmWrites,
    },
    { port: 0, hostname: "127.0.0.1" },
  );
  apps.push(app);
  const base = `http://127.0.0.1:${app.server.port}`;
  const headers = (user = JANE) => ({ "content-type": "application/json", "x-api-key": API_KEY, "x-user-id": user });

  const turn = async (body: Record<string, unknown>) => {
    const r = await fetch(`${base}/v1/chat/stream?format=ndjson`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    return (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as { event: string; data: any });
  };
  const firstTurn = async () => {
    const lines = await turn({ message: "Update Jane's phone to 0411 111 111", newSession: true });
    const done = lines.find((l) => l.event === "done")!.data;
    const proposal = lines.find((l) => l.event === "crm_write_proposal")?.data;
    return { lines, sessionId: done.sessionId as string, proposalId: proposal?.proposalId as string };
  };
  const decide = async (proposalId: string, decision: string, user = JANE) => {
    const r = await fetch(`${base}/v1/crm/writes/${proposalId}/decision`, { method: "POST", headers: headers(user), body: JSON.stringify({ decision }) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const decideWith = async (proposalId: string, body: Record<string, unknown>) => {
    const r = await fetch(`${base}/v1/crm/writes/${proposalId}/decision`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const executes = () => calls.filter((c) => !c.opts?.meta?.["heubert/dryRun"]);
  return { base, headers, crm, clock, model, turn, firstTurn, decide, decideWith, executes, calls };
}

describe("CRM write proposals over HTTP", () => {
  test("a streamed turn emits one crm_write_proposal before done, and writes nothing", async () => {
    const s = setup();
    const { lines } = await s.firstTurn();
    const events = lines.map((l) => l.event);
    const proposals = lines.filter((l) => l.event === "crm_write_proposal");
    expect(proposals).toHaveLength(1);
    expect(events.indexOf("crm_write_proposal")).toBeLessThan(events.indexOf("done"));
    expect(proposals[0]!.data).toMatchObject({ tool: "crm_update_contact", status: "pending", changes: CHANGES, target: { entity: "contact", id: "c1", label: "Jane Doe" } });
    expect(s.executes()).toHaveLength(0);
  });

  test("approve applies it with the previewed version; a second approve is 409", async () => {
    const s = setup();
    const { proposalId } = await s.firstTurn();

    const first = await s.decide(proposalId, "approve");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ proposalId, status: "applied" });
    expect(s.executes()).toEqual([{ name: "crm_update_contact", args: ARGS, opts: { meta: { "heubert/expectedVersion": VERSION } } }]);

    const again = await s.decide(proposalId, "approve");
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ proposalId, status: "applied" });
    expect(s.executes()).toHaveLength(1);
  });

  test("reject is 200 rejected and never reaches the CRM", async () => {
    const s = setup();
    const { proposalId } = await s.firstTurn();
    const r = await s.decide(proposalId, "reject");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("rejected");
    expect(s.executes()).toHaveLength(0);
  });

  test("another counsellor gets 404, and an unknown id is 404 too", async () => {
    const s = setup();
    const { proposalId } = await s.firstTurn();
    expect((await s.decide(proposalId, "approve", "sam@heubert.com")).status).toBe(404);
    expect((await s.decide("no-such-proposal", "approve")).status).toBe(404);
    expect((await s.decide(proposalId, "approve", "not-an-email")).status).toBe(404);
    expect(s.executes()).toHaveLength(0);
  });

  test("a body that is not approve/reject is a 400", async () => {
    const s = setup();
    const { proposalId } = await s.firstTurn();
    expect((await s.decide(proposalId, "maybe")).status).toBe(400);
  });

  test("the next chat message in the session expires a pending proposal", async () => {
    const s = setup();
    const { proposalId, sessionId } = await s.firstTurn();
    await s.turn({ message: "Actually, leave it", sessionId });
    const r = await s.decide(proposalId, "approve");
    expect(r.status).toBe(409);
    expect(r.body.status).toBe("expired");
    expect(s.executes()).toHaveLength(0);
  });

  test("past expiresAt an approve is 409 expired", async () => {
    const s = setup();
    const { proposalId } = await s.firstTurn();
    s.clock.t = new Date(s.clock.t.getTime() + 30 * 60_000);
    const r = await s.decide(proposalId, "approve");
    expect(r.status).toBe(409);
    expect(r.body.status).toBe("expired");
    expect(s.executes()).toHaveLength(0);
  });

  test("a record changed since the preview is 200 stale, with the current change", async () => {
    const s = setup();
    const current = [{ field: "phone", label: "Phone", before: "0422 222 222", after: "0411 111 111" }];
    s.crm.execute = () => ({ text: "record changed", isError: true, structured: { error: { code: "STALE_RECORD", status: 409, detail: "changed" }, preview: preview(current, "2026-09-02T00:00:00.000Z") } });
    const { proposalId } = await s.firstTurn();
    const r = await s.decide(proposalId, "approve");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "stale", current });
  });

  test("the session history carries crmWrites on the assistant message, with the final status", async () => {
    const s = setup();
    const { proposalId, sessionId } = await s.firstTurn();
    await s.decide(proposalId, "approve");
    const r = await fetch(`${s.base}/v1/sessions/${sessionId}`, { headers: s.headers() });
    const body = (await r.json()) as { messages: { role: string; crmWrites?: { proposalId: string; status: string }[] }[] };
    const [human, ai] = body.messages;
    expect(human!.crmWrites).toBeUndefined();
    expect(ai!.crmWrites).toEqual([expect.objectContaining({ proposalId, status: "applied" })]);
  });

  test("after a reject, the next turn tells the model it was declined", async () => {
    const s = setup();
    const { proposalId, sessionId } = await s.firstTurn();
    await s.decide(proposalId, "reject");
    s.model.seen.length = 0;
    await s.turn({ message: "What did I decide?", sessionId });
    const seen = s.model.seen.flat().map((m) => String(m.content)).join("\n");
    expect(seen).toContain("The counsellor rejected: crm_update_contact on Jane Doe. It was not applied.");
    expect(s.model.seen.flat().some((m) => m instanceof AIMessage && String(m.content).includes("[CRM write decisions]"))).toBe(true);
  });

  test("the note never changes the stored answer", async () => {
    const s = setup();
    const { proposalId, sessionId } = await s.firstTurn();
    await s.decide(proposalId, "reject");
    await s.turn({ message: "ok", sessionId });
    const body = (await (await fetch(`${s.base}/v1/sessions/${sessionId}`, { headers: s.headers() })).json()) as { messages: { role: string; content: string }[] };
    expect(body.messages.some((m) => m.content.includes("[CRM write decisions]"))).toBe(false);
  });

  test("without crmWrites the decision route is 503 and no write is offered", async () => {
    const s = setup({ writes: false });
    const { lines } = await s.firstTurn();
    expect(lines.some((l) => l.event === "crm_write_proposal")).toBe(false);
    expect(s.calls).toHaveLength(0);
    expect((await s.decide("any", "approve")).status).toBe(503);
  });

  test("approve with edits re-runs the dry run with the edited value, applies it and returns `edited`", async () => {
    const s = setup();
    const { proposalId } = await s.firstTurn();
    const r = await s.decideWith(proposalId, { decision: "approve", edits: { phone: "0499 999 999" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ proposalId, status: "applied", edited: [{ field: "phone", from: "0411 111 111", to: "0499 999 999" }] });
    const dryRuns = s.calls.filter((c) => c.opts?.meta?.["heubert/dryRun"]);
    expect(dryRuns.at(-1)!.args).toEqual({ ...ARGS, phone: "0499 999 999" });
    expect(s.executes()).toEqual([{ name: "crm_update_contact", args: { ...ARGS, phone: "0499 999 999" }, opts: { meta: { "heubert/expectedVersion": VERSION } } }]);
  });

  test("edits with reject, on an unknown field, or of the wrong shape are 400 and leave it pending", async () => {
    const s = setup();
    const { proposalId } = await s.firstTurn();
    expect((await s.decideWith(proposalId, { decision: "reject", edits: { phone: "1" } })).status).toBe(400);
    expect((await s.decideWith(proposalId, { decision: "approve", edits: { email: "x@y.z" } })).status).toBe(400);
    expect((await s.decideWith(proposalId, { decision: "approve", edits: { phone: { nested: true } } })).status).toBe(400);
    expect(s.executes()).toHaveLength(0);
    expect((await s.decide(proposalId, "approve")).body.status).toBe("applied");
  });
});
