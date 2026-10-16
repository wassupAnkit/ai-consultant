import { describe, expect, test } from "bun:test";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { ChatService } from "../src/app/service";
import type { CrmProvider, CrmToolDescriptor, CrmToolResult } from "../src/crm/client";
import { crmStudentFromReads, pendingStudentOverview, type CrmRead } from "../src/crm/student";
import { crmFollowUpStudent } from "../src/graph/crm-followup";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { CONSULTANT_SYSTEM_PROMPT } from "../src/prompts/consultant";
import { priorCrmStudentOf, type CrmStudentRef } from "../src/routing/route";
import type { ClassifierExtras, Intent } from "../src/schemas/intent.schema";
import { CRM_READ_TOOL, fakeToolset, RecordingKnowledgeStore, ScriptedToolModel, toolCall } from "./fakes";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

const tool = (name: string): CrmToolDescriptor => ({ ...CRM_READ_TOOL, name, title: name, description: `${name} (test CRM)`, inputSchema: { type: "object", properties: { id: { type: "string" }, query: { type: "string" } } } as never });
const DESCRIPTORS = [tool("crm_search_contacts"), tool("crm_get_contact"), tool("crm_get_student_overview"), tool("crm_get_deal")];

const riya = { id: "C21", name: "Riya Basnet", status: "Lead", nationality: "Nepal", country: "Nepal" };
const sita = { id: "C30", name: "Sita Sharma", status: "Lead", nationality: "India", country: "India" };
const RIYA_OVERVIEW = "Riya Basnet (C21). Enquiry E5 open. Deal D9 Australia [in-progress]. Application: UWA — Master of IT [submitted]. Note: awaiting bank statement.";

/** The test CRM: Riya has an enquiry, a deal, a UWA application and a note; Sita is another student. */
function crmAnswer(name: string, args: Record<string, unknown>): CrmToolResult {
  const ok = (text: string, structured: Record<string, unknown>): CrmToolResult => ({ text, structured, isError: false });
  if (name === "crm_search_contacts") return String(args.query ?? "").includes("Sita") ? ok("Sita Sharma (C30)", { contacts: [{ id: "C30", name: "Sita Sharma" }] }) : ok("Riya Basnet (C21)", { contacts: [{ id: "C21", name: "Riya Basnet" }] });
  if (name === "crm_get_student_overview" && args.id === "C21")
    return ok(RIYA_OVERVIEW, { contact: riya, deals: [{ id: "D9", name: "Riya — Australia", status: "in-progress", countries: ["Australia"] }], applications: [{ id: "A1", institution: { name: "UWA", country: "Australia" } }] });
  if (name === "crm_get_student_overview" && args.id === "C30") return ok("Sita Sharma (C30). No deals.", { contact: sita, deals: [] });
  if (name === "crm_get_contact") return ok(`contact ${String(args.id)}`, { contact: args.id === "C30" ? sita : riya });
  return { text: "not visible", isError: true };
}
const calls: { name: string; args: Record<string, unknown> }[] = [];
const provider: CrmProvider = {
  forActor: async (email) => (email ? fakeToolset((name, args) => crmAnswer(name, args), (name, args) => calls.push({ name, args }), DESCRIPTORS, email) : undefined),
};

const prior: CrmStudentRef = { contactId: "C21", name: "Riya Basnet", origin: "nepal", destinations: ["australia"] };
const history: BaseMessage[] = [new HumanMessage("What is the status of Riya Basnet's application?"), new AIMessage("Riya's UWA application is submitted [1].")];

/** A classifier that returns `intent` plus Jev extras (signals, references_prior_turn). */
const withExtras = (intent: Intent, extras: Partial<ClassifierExtras> = {}) => RunnableLambda.from(async () => ({ ...intent, extras: { classifier: "jev", ...extras } }));

const noLookup = intentOf({ primary_intent: "application_process", task: "general", needs_research: false, user_question: "Does she have a deal?" });

async function turn(opts: { input: string; intent?: Intent; extras?: Partial<ClassifierExtras>; priorCrmStudent?: CrmStudentRef | null; crm?: boolean; script?: AIMessage[]; history?: BaseMessage[] }) {
  calls.length = 0;
  const intent = opts.intent ?? noLookup;
  const model = new ScriptedToolModel(opts.script ?? [new AIMessage({ content: "sufficient" })]);
  const { graph } = fakeGraph({
    intent,
    classifier: withExtras(intent, opts.extras),
    researchModel: model,
    knowledge: new RecordingKnowledgeStore(() => [sampleChunk(1)]),
    ...(opts.crm === false ? {} : { crmProvider: provider }),
  });
  const state = await graph.invoke({ input: opts.input, history: opts.history ?? history, sessionId: "s1", profile: null, actorEmail: "jane@heubert.com", priorCrmStudent: opts.priorCrmStudent ?? null });
  return { state, model, answer: String(state.meta.systemPromptText ?? "") };
}

describe("a follow-up about the CRM student already discussed", () => {
  test("researches even when the classifier says no lookup, and reads the student's overview in round 0", async () => {
    const { state, model, answer } = await turn({ input: "Does she have a deal or an enquiry?", priorCrmStudent: prior });
    expect(state.researchTrace).not.toBeNull();
    expect(state.researchTrace!.toolCalls[0]).toMatchObject({ tool: "crm_get_student_overview", args: { id: "C21" }, ok: true });
    expect(calls).toContainEqual({ name: "crm_get_student_overview", args: { id: "C21" } });
    expect(state.meta.crmFollowUp).toBe("C21");
    // Numbered CRM evidence, seen by the research model's round-0 summary and by the answer.
    const crm = state.evidence.find((e) => e.kind === "crm");
    expect(crm?.content).toBe(RIYA_OVERVIEW);
    expect(String(model.seen[0]?.[0]?.content)).toContain("UWA — Master of IT");
    expect(answer).toContain("UWA — Master of IT");
    expect(answer).toContain('source="crm"');
    // Still the same student for the next turn.
    expect(state.crmStudent).toMatchObject({ contactId: "C21", name: "Riya Basnet", origin: "nepal" });
  });

  test("the overview is read once: a model that also opens it does not add a duplicate", async () => {
    const { state } = await turn({ input: "and her application?", priorCrmStudent: prior, script: [toolCall("crm_get_student_overview", { id: "C21" }), new AIMessage({ content: "sufficient" })] });
    expect(state.evidence.filter((e) => e.kind === "crm")).toHaveLength(1);
  });

  test("naming the same student again is a follow-up too", async () => {
    const { state } = await turn({ input: "Remind me what is pending on Riya's file before the census date", priorCrmStudent: prior });
    expect(state.researchTrace?.toolCalls[0]).toMatchObject({ tool: "crm_get_student_overview", args: { id: "C21" } });
  });

  test("Jev's references_prior_turn alone is enough", async () => {
    const { state } = await turn({ input: "Summarise where the file stands for the branch manager today please", extras: { references_prior_turn: true }, priorCrmStudent: prior });
    expect(state.researchTrace?.toolCalls[0]).toMatchObject({ tool: "crm_get_student_overview", args: { id: "C21" } });
  });

  test("no prior CRM student: a no-lookup follow-up still answers without research, as before", async () => {
    const { state } = await turn({ input: "Does she have a deal or an enquiry?", priorCrmStudent: null });
    expect(state.researchTrace).toBeNull();
    expect(calls).toEqual([]);
  });

  test("no CRM for this consultant: unchanged, no forced research", async () => {
    const { state } = await turn({ input: "Does she have a deal or an enquiry?", priorCrmStudent: prior, crm: false });
    expect(state.researchTrace).toBeNull();
  });

  test("a researched turn on an unrelated topic does not read the prior student", async () => {
    const policy = intentOf({ primary_intent: "eligibility_check", task: "lookup", needs_research: true, user_question: "IELTS for a UK master's?" });
    const { state } = await turn({ input: "What IELTS score is required for a master's degree in the UK generally?", intent: policy, priorCrmStudent: prior });
    expect(state.researchTrace?.toolCalls.map((c) => c.tool)).toEqual([]);
    expect(state.meta.crmFollowUp).toBeUndefined();
  });

  test("a policy-topic follow-up keeps the CRM tools in scope for the prior student", async () => {
    const policy = intentOf({ primary_intent: "policy_change", task: "lookup", needs_research: true, user_question: "Does the new rule affect her?" });
    const { state } = await turn({ input: "Does the new rule affect her?", intent: policy, priorCrmStudent: prior });
    expect(state.researchTrace?.toolCalls[0]).toMatchObject({ tool: "crm_get_student_overview", args: { id: "C21" } });
    expect(state.meta.toolsOffered).toContain("crm_search_contacts");
  });
});

describe("CRM questions never skip research when the CRM is available", () => {
  test("a newly named student (student_named) researches even when the classifier says no lookup", async () => {
    const { state } = await turn({
      input: "Does Sita Sharma have any open deal?",
      history: [],
      extras: { signals: ["student_named"] },
      script: [toolCall("crm_search_contacts", { query: "Sita Sharma" }), new AIMessage({ content: "sufficient" })],
    });
    expect(state.researchTrace).not.toBeNull();
    // Found but never opened: the overview is still read for her (not blocked by anything else).
    expect(state.researchTrace?.toolCalls.map((c) => c.tool)).toEqual(["crm_search_contacts", "crm_get_student_overview"]);
    expect(state.crmStudent).toMatchObject({ contactId: "C30", name: "Sita Sharma" });
  });

  test("a different named student in a follow-up is not mistaken for the prior one", async () => {
    const { state } = await turn({
      input: "What about Sita Sharma?",
      extras: { signals: ["student_named"] },
      priorCrmStudent: prior,
      script: [toolCall("crm_search_contacts", { query: "Sita Sharma" }), new AIMessage({ content: "sufficient" })],
    });
    expect(state.researchTrace?.toolCalls.map((c) => c.tool)).toEqual(["crm_search_contacts", "crm_get_student_overview"]);
    expect(state.researchTrace?.toolCalls.at(-1)?.args).toEqual({ id: "C30" });
    expect(state.crmStudent?.contactId).toBe("C30");
  });

  test("caseload work researches even when the classifier says no lookup", async () => {
    const caseload = intentOf({ primary_intent: "caseload_management", task: "general", needs_research: false, user_question: "My tasks today?" });
    const { state } = await turn({ input: "What do I have on today?", intent: caseload, history: [] });
    expect(state.researchTrace).not.toBeNull();
  });

  test("without a CRM, a named student with no lookup needed still answers directly", async () => {
    const { state } = await turn({ input: "Draft a WhatsApp to Sita saying hi", history: [], extras: { signals: ["student_named"] }, crm: false });
    expect(state.researchTrace).toBeNull();
  });
});

describe("crmFollowUpStudent", () => {
  const base = { history, priorCrmStudent: prior, guide: null, intent: noLookup, intentExtras: null };
  test("pronouns, follow-up cues, the student's name or references_prior_turn", () => {
    expect(crmFollowUpStudent({ ...base, input: "Has he paid the deposit and is the CoE issued yet?" })).toEqual(prior);
    expect(crmFollowUpStudent({ ...base, input: "and the deal?" })).toEqual(prior);
    expect(crmFollowUpStudent({ ...base, input: "Is Riya Basnet's offer conditional on anything?" })).toEqual(prior);
  });
  test("none without a prior student, history, or in a guided session; none for a greeting or another named student", () => {
    expect(crmFollowUpStudent({ ...base, input: "and her deal?", priorCrmStudent: null })).toBeNull();
    expect(crmFollowUpStudent({ ...base, input: "and her deal?", history: [] })).toBeNull();
    expect(crmFollowUpStudent({ ...base, input: "and her deal?", guide: { contactId: "C21" } as never })).toBeNull();
    expect(crmFollowUpStudent({ ...base, input: "thanks!", intent: intentOf({ primary_intent: "greeting" }) })).toBeNull();
    expect(crmFollowUpStudent({ ...base, input: "What about Sita Sharma?", intentExtras: { signals: ["student_named"] } as never })).toBeNull();
    expect(crmFollowUpStudent({ ...base, input: "What IELTS score is required for a master's degree in the UK generally?" })).toBeNull();
  });
});

describe("carrying the CRM student across turns", () => {
  const at = new Date();
  test("priorCrmStudentOf: the newest AI turn that read a student, within the stored window", () => {
    expect(priorCrmStudentOf([])).toBeNull();
    expect(
      priorCrmStudentOf([
        { role: "ai", content: "a", createdAt: at, metadata: { route: { countries: [], crmStudent: { contactId: "C1", name: "Old", origin: "india", destinations: [] } } } },
        { role: "human", content: "q", createdAt: at },
        { role: "ai", content: "b", createdAt: at, metadata: { route: { countries: [], crmStudent: prior } } },
        { role: "ai", content: "c", createdAt: at, metadata: { route: { countries: ["australia"] } } },
      ]),
    ).toEqual(prior);
    expect(priorCrmStudentOf([{ role: "ai", content: "a", createdAt: at, metadata: { route: { crmStudent: { contactId: 5 } } } }])).toBeNull();
    expect(priorCrmStudentOf([{ role: "ai", content: "a", createdAt: at, metadata: { route: { crmStudent: { contactId: "C2", origin: "atlantis", destinations: ["mars", "canada"] } } } }])).toEqual({ contactId: "C2", origin: null, destinations: ["canada"] });
  });

  test("crmStudentFromReads keeps the contact (and name) even when the record names no market or destination", () => {
    const read: CrmRead = { tool: "crm_get_student_overview", args: { id: "C8" }, structured: { contact: { id: "C8", name: "Hari KC" } } };
    expect(crmStudentFromReads([read])).toEqual({ contactId: "C8", name: "Hari KC", origin: null, destinations: [] });
  });

  test("pendingStudentOverview: another student's overview does not block the one just found", () => {
    const overview: CrmRead = { tool: "crm_get_student_overview", args: { id: "C21" }, structured: { contact: riya } };
    const search: CrmRead = { tool: "crm_search_contacts", args: { query: "Sita" }, structured: { contacts: [{ id: "C30" }] } };
    expect(pendingStudentOverview([overview, search])).toBe("C30");
    expect(pendingStudentOverview([overview, { ...search, structured: { contacts: [{ id: "C21" }] } }])).toBeNull();
  });

  test("ChatService stores the turn's CRM student and hands it to the next turn's follow-up", async () => {
    const intent = intentOf({ primary_intent: "application_process", task: "general", needs_research: false, user_question: "Riya's application?" });
    const model = new ScriptedToolModel([toolCall("crm_search_contacts", { query: "Riya Basnet" }), toolCall("crm_get_student_overview", { id: "C21" }), new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent, classifier: withExtras(intent, { signals: ["student_named"] }), researchModel: model, knowledge: new RecordingKnowledgeStore(() => []), crmProvider: provider });
    const store = new InMemoryChatStore();
    const svc = new ChatService({ env: testEnv(), graph, store, logger: createLogger({ test: true }) });
    const first = await svc.chat({ message: "What is the status of Riya Basnet's application?", ownerId: "jane@heubert.com", requestId: "r1", route: "/v1/chat" });
    await Bun.sleep(10); // persistence is fire-and-forget
    const stored = await store.getMessages(first.sessionId, 10);
    expect((stored.find((m) => m.role === "ai")?.metadata?.route as { crmStudent?: unknown })?.crmStudent).toEqual({ contactId: "C21", name: "Riya Basnet", origin: "nepal", destinations: ["australia"] });

    calls.length = 0;
    const second = await svc.chat({ message: "Does she have a deal?", sessionId: first.sessionId, ownerId: "jane@heubert.com", requestId: "r2", route: "/v1/chat" });
    expect(second.meta.crmFollowUp).toBe("C21");
    expect(calls[0]).toEqual({ name: "crm_get_student_overview", args: { id: "C21" } });
  });
});

describe("answer-prompt guard on CRM absence", () => {
  test("only claim a missing CRM record from this turn's CRM evidence; never 'Not in the knowledge base' for CRM data", () => {
    expect(CONSULTANT_SYSTEM_PROMPT).toContain("I didn't look this up in the CRM this turn");
    expect(CONSULTANT_SYSTEM_PROMPT).toContain("not in the CRM record I can see");
  });
});
