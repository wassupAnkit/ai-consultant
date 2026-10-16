import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { ChatService } from "../src/app/service";
import type { CrmProvider, CrmToolResult, CrmToolset } from "../src/crm/client";
import { CrmStudentReader, stepFieldGaps, type StudentSnapshot } from "../src/crm/student";
import { applyGuidePatch, NEVER_EXPIRES, newGuide } from "../src/journey/guide";
import { JOURNEY_STEPS, JOURNEY_STEP_KEYS, STUDENT_FIELDS } from "../src/journey/steps";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { PROMPT_NAMES, localPrompts } from "../src/prompts/registry";
import { PRIMARY_INTENTS } from "../src/schemas/intent.schema";
import { settledSuggestion, startingSuggestion, stepForWorkflowStage } from "../src/journey/suggest";
import { createDemoCrmProvider } from "../src/crm/demo";
import { fakeGraph, intentOf, testEnv } from "./helpers";

const CONTACT = "11111111-1111-4111-8111-111111111111";
const HIDDEN = "22222222-2222-4222-8222-222222222222";
const CONSULTANT = "counsellor@heubert.com";

/** A CRM toolset that answers the read tools for one visible contact and refuses every other id. */
function fakeCrm(opts: { applications?: unknown[] | null; calls?: string[] } = {}): CrmToolset {
  const ok = (text: string, structured: Record<string, unknown>): CrmToolResult => ({ text, structured, isError: false });
  const refused: CrmToolResult = { text: "not visible", isError: true };
  const names = ["crm_search_contacts", "crm_get_contact", "crm_get_student_overview", "crm_get_deal"];
  return {
    actor: CONSULTANT,
    descriptors: names.map((name) => ({ name, description: name, inputSchema: { type: "object" } })),
    refresh: async () => {},
    async call(name, args) {
      opts.calls?.push(name);
      if (name === "crm_search_contacts") return ok("1 contact", { contacts: [{ id: CONTACT, name: "Sita Sharma", email: "sita@example.com", status: "Prospect", branch: { id: "b1", name: "Kathmandu" } }] });
      if (args.id !== CONTACT && args.id !== "deal-1" && args.id !== "deal-2") return refused;
      if (name === "crm_get_contact")
        return ok("Sita", { contact: { id: CONTACT, name: "Sita Sharma", email: "sita@example.com", phone: "+977", dateOfBirth: "2003-01-01", status: "Prospect", nationality: "Nepal", country: "Nepal", city: "Kathmandu", countryOfPassport: "Nepal", visaType: null, branch: { id: "b1", name: "Kathmandu" }, assignee: { id: "u1", name: "Asha" } } });
      if (name === "crm_get_student_overview")
        return ok("overview", {
          contact: { id: CONTACT, name: "Sita Sharma" },
          deals: [
            { id: "deal-1", name: "Sita — Study abroad", status: "in-progress" },
            { id: "deal-2", name: "Old", status: "lost" },
          ],
          enquiries: [],
          notes: [],
          ...(opts.applications !== undefined ? { applications: opts.applications } : {}),
        });
      if (name === "crm_get_deal") return ok("deal", { deal: { id: args.id, name: "Sita — Study abroad", status: "in-progress", interestedService: "Admission", countries: ["Australia"], services: ["Visa"] } });
      return refused;
    },
  };
}

const providerFor = (crm: CrmToolset): CrmProvider => ({ forActor: async (email) => (email?.includes("@") ? crm : undefined) });

describe("journey steps", () => {
  test("ten steps in order, each tied to real playbooks and known CRM fields", () => {
    expect(JOURNEY_STEPS.map((s) => s.key)).toEqual([...JOURNEY_STEP_KEYS]);
    expect(JOURNEY_STEPS.map((s) => s.order)).toEqual(JOURNEY_STEPS.map((_, i) => i + 1));
    for (const s of JOURNEY_STEPS) {
      expect(s.relatedIntents.length).toBeGreaterThan(0);
      for (const i of s.relatedIntents) expect(PRIMARY_INTENTS).toContain(i);
      for (const f of s.crmFields) expect(STUDENT_FIELDS[f]).toBeDefined();
      expect(s.checklist.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("the steps cover journey stages S1–S11 from the data-model docs", () => {
    const covered = new Set(JOURNEY_STEPS.flatMap((s) => s.docStages));
    for (let i = 1; i <= 11; i++) expect(covered.has(`S${i}`)).toBe(true);
  });

  test("the guided prompt is registered, so prompts:push seeds it", () => {
    expect(localPrompts()[PROMPT_NAMES.guided]).toContain("Next for {{student_first}}:");
    expect(localPrompts()[PROMPT_NAMES.system]).toContain("{{guided_session}}");
    expect(localPrompts()[PROMPT_NAMES.research]).toContain("{{guided_student}}");
  });
});

describe("guide state", () => {
  test("moving to a step starts it, clears a suggestion for it, and explicit statuses win", () => {
    const g = { ...newGuide(CONTACT, "enquiry", new Date(0)), suggestion: { toStep: "destination" as const, reason: "settled", at: new Date(0) } };
    const moved = applyGuidePatch(g, { currentStep: "destination", stepStatus: { enquiry: "done" } });
    expect(moved.currentStep).toBe("destination");
    expect(moved.steps.destination?.status).toBe("in_progress");
    expect(moved.steps.enquiry?.status).toBe("done");
    expect(moved.suggestion).toBeNull();
    expect(applyGuidePatch(moved, { stepStatus: { enquiry: "not_started" } }).steps.enquiry).toBeUndefined();
  });
});

describe("CrmStudentReader", () => {
  test("composes a snapshot without contact email, phone or date of birth", async () => {
    const reader = new CrmStudentReader({ provider: providerFor(fakeCrm()), crmWebUrl: "https://crm.example.test" });
    const res = await reader.snapshot(CONSULTANT, CONTACT);
    if (!res.ok) throw new Error(res.message);
    expect(res.snapshot).toMatchObject({ name: "Sita Sharma", nationality: "Nepal", assignee: "Asha", branch: "Kathmandu" });
    // Only the active deal is read in full.
    expect(res.snapshot.deals).toHaveLength(1);
    expect(res.snapshot.deals[0]!.countries).toEqual(["Australia"]);
    expect(res.snapshot.available.applications).toBe(false);
    expect(res.record.content).toContain("destinations Australia");
    expect(res.record.content).not.toContain("sita@example.com");
    expect(res.record.content).not.toContain("2003-01-01");
    expect(res.record.webUrl).toContain(`/contact/detail/${CONTACT}/`);
  });

  test("reads applications and their current stage from the overview when the CRM sends them", async () => {
    const applications = [{ id: "a1", status: "In Progress", intake: "Feb 2027", institution: { id: "i", name: "Monash University" }, course: { id: "c", name: "Master of IT" }, currentStage: { id: "s", name: "Offer received" }, nextStage: { id: "s2", name: "CoE issued" }, previousStage: null, assignees: [{ id: "u1", name: "Asha" }] }];
    const res = await new CrmStudentReader({ provider: providerFor(fakeCrm({ applications })) }).snapshot(CONSULTANT, CONTACT);
    if (!res.ok) throw new Error(res.message);
    expect(res.snapshot.available.applications).toBe(true);
    expect(res.snapshot.applications[0]).toMatchObject({ institution: "Monash University", course: "Master of IT", workflowStage: "Offer received", intake: "Feb 2027" });
    expect(stepFieldGaps(res.snapshot, "application")).toEqual({ missing: [], unknown: [] });
  });

  test("applications: null (the CRM's lookup failed) reads as unknown, not as none", async () => {
    const res = await new CrmStudentReader({ provider: providerFor(fakeCrm({ applications: null })) }).snapshot(CONSULTANT, CONTACT);
    if (!res.ok) throw new Error(res.message);
    expect(res.snapshot.available.applications).toBe(false);
    expect(stepFieldGaps(res.snapshot, "application").unknown).toContain("applicationStage");
  });

  test("a student the consultant cannot see yields not_visible, and no identity yields no_crm", async () => {
    const reader = new CrmStudentReader({ provider: providerFor(fakeCrm()) });
    expect(await reader.snapshot(CONSULTANT, HIDDEN)).toMatchObject({ ok: false, reason: "not_visible" });
    expect(await reader.snapshot(null, CONTACT)).toMatchObject({ ok: false, reason: "no_crm" });
  });

  test("caches per consultant and student, briefly", async () => {
    const calls: string[] = [];
    const reader = new CrmStudentReader({ provider: providerFor(fakeCrm({ calls })), cacheTtlMs: 60_000 });
    await reader.snapshot(CONSULTANT, CONTACT);
    const first = calls.length;
    await reader.snapshot(CONSULTANT, CONTACT);
    expect(calls.length).toBe(first);
    reader.forget(CONTACT);
    await reader.snapshot(CONSULTANT, CONTACT);
    expect(calls.length).toBe(first * 2);
  });

  test("a field the CRM does not expose is unknown, not missing", async () => {
    const res = await new CrmStudentReader({ provider: providerFor(fakeCrm()) }).snapshot(CONSULTANT, CONTACT);
    const s = (res as { snapshot: StudentSnapshot }).snapshot;
    expect(stepFieldGaps(s, "english")).toEqual({ missing: [], unknown: ["englishTest"] });
    expect(stepFieldGaps(s, "destination")).toEqual({ missing: [], unknown: [] });
    expect(stepFieldGaps(s, "visa").missing).toEqual([]);
    expect(stepFieldGaps({ ...s, deals: [] }, "destination").missing).toEqual(["destinations"]);
  });
});

describe("Edge's suggestions", () => {
  const base = async () => {
    const res = await new CrmStudentReader({ provider: providerFor(fakeCrm()) }).snapshot(CONSULTANT, CONTACT);
    return (res as { snapshot: StudentSnapshot }).snapshot;
  };
  const withApp = (s: StudentSnapshot, workflowStage: string | null): StudentSnapshot => ({
    ...s,
    available: { ...s.available, applications: true },
    applications: [{ id: "a1", status: "In Progress", institution: "Monash University", course: "Master of IT", intake: "Feb 2027", workflowStage }],
  });

  test("a starting step is read off the CRM: application stage first, then applications, then destinations", async () => {
    const s = await base();
    expect(startingSuggestion(withApp(s, "Offer received"))).toMatchObject({ toStep: "application" });
    expect(startingSuggestion(withApp(s, "Visa lodged"))).toMatchObject({ toStep: "visa" });
    expect(startingSuggestion(withApp(s, "Visa granted"))).toMatchObject({ toStep: "pre_departure" });
    expect(startingSuggestion(withApp(s, null))?.reason).toContain("Monash University");
    expect(startingSuggestion(s)).toMatchObject({ toStep: "course" });
    expect(startingSuggestion({ ...s, deals: [] })).toBeNull();
    expect(startingSuggestion(null)).toBeNull();
  });

  test("real PR-680 workflow stage names map to steps, and the furthest application wins", async () => {
    expect(stepForWorkflowStage("Lodge Application")).toBe("application");
    expect(stepForWorkflowStage("Finalise Applicaiton")).toBe("application");
    expect(stepForWorkflowStage("Collect Service Fees")).toBe("application");
    expect(stepForWorkflowStage("COE")).toBe("application");
    expect(stepForWorkflowStage("Enquiry")).toBe("institution");
    expect(stepForWorkflowStage("Visa Lodged")).toBe("visa");
    expect(stepForWorkflowStage("Visa Granted")).toBe("pre_departure");
    const s = await base();
    const many: StudentSnapshot = {
      ...s,
      available: { ...s.available, applications: true },
      applications: ["Enquiry", "COE", "Lodge Application", "Visa Lodged", "Enquiry"].map((stage, i) => ({ id: `a${i}`, status: "In Progress", institution: `Uni ${i}`, course: null, intake: null, workflowStage: stage })),
    };
    const sug = startingSuggestion(many)!;
    expect(sug.toStep).toBe("visa");
    expect(sug.reason).toContain("Uni 3");
    expect(sug.reason).toContain("furthest of 5 active applications");
  });

  test("a case like Sadeka's on PR-680: completed CoE, a Home Affairs application, dropped ones ignored", async () => {
    const s = await base();
    const app = (id: string, institution: string, status: string, workflowStage: string | null) => ({ id, status, institution, course: "Master of IT", intake: null, workflowStage });
    const snap: StudentSnapshot = {
      ...s,
      available: { ...s.available, applications: true },
      applications: [
        app("1", "Charles Sturt University - CSU", "Discontinued", "Enquiry"),
        app("2", "Victoria University - VU", "Completed", "COE"),
        app("3", "Swinburne University of Technology", "Discontinued", "COE"),
        app("4", "Australian Department of Home Affairs", "In Progress", "Lodge Application"),
      ],
    };
    const sug = startingSuggestion(snap)!;
    expect(sug.toStep).toBe("visa");
    expect(sug.reason).toContain("Home Affairs");
    // Only dropped applications left: nothing to go on beyond the deal.
    expect(startingSuggestion({ ...snap, applications: [snap.applications[0]!] })?.toStep).toBe("course");
  });

  test("moving on needs the model's verdict AND the step's CRM fields filled", async () => {
    const s = await base();
    const ok = settledSuggestion({ step: "destination", snapshot: s, stepComplete: true, reason: "Australia chosen." });
    expect(ok).toMatchObject({ toStep: "course", reason: "Australia chosen." });
    expect(settledSuggestion({ step: "destination", snapshot: s, stepComplete: false, reason: null })).toBeNull();
    // Said in chat, not in the CRM: no suggestion.
    expect(settledSuggestion({ step: "destination", snapshot: { ...s, deals: [] }, stepComplete: true, reason: "x" })).toBeNull();
    expect(settledSuggestion({ step: "destination", snapshot: null, stepComplete: true, reason: "x" })).toBeNull();
    // Nowhere to go from the last step.
    expect(settledSuggestion({ step: "pre_departure", snapshot: s, stepComplete: true, reason: "x" })).toBeNull();
  });

  test("a suggestion only lands while the session is still on the step it was made at", async () => {
    const store = new InMemoryChatStore();
    const sess = await store.getOrCreateSession(undefined, CONSULTANT);
    await store.startGuide(sess.id, CONSULTANT, newGuide(CONTACT, "destination"));
    const sug = { toStep: "course" as const, reason: "settled", at: new Date() };
    expect(await store.setGuideSuggestion(sess.id, CONSULTANT, "enquiry", sug)).toBeNull();
    expect((await store.setGuideSuggestion(sess.id, CONSULTANT, "destination", sug))?.guide?.suggestion).toMatchObject({ toStep: "course" });
  });

  test("any move by the consultant clears Edge's suggestion", () => {
    const g = { ...newGuide(CONTACT, "enquiry"), suggestion: { toStep: "application" as const, reason: "offer", at: new Date() } };
    expect(applyGuidePatch(g, { currentStep: "destination" }).suggestion).toBeNull();
    expect(applyGuidePatch(g, { stepStatus: { enquiry: "done" } }).suggestion).not.toBeNull();
  });
});

describe("guided sessions in the store", () => {
  test("a guided session and its messages never expire; the conversion is one-way", async () => {
    const store = new InMemoryChatStore(1_000);
    const s = await store.getOrCreateSession(undefined, CONSULTANT);
    await store.append(s.id, [{ role: "human", content: "hi", createdAt: new Date() }]);
    const guided = await store.startGuide(s.id, CONSULTANT, newGuide(CONTACT), { title: "Sita Sharma" });
    expect(guided?.expiresAt).toEqual(NEVER_EXPIRES);
    expect(guided?.title).toBe("Sita Sharma");
    await store.append(s.id, [{ role: "ai", content: "hello", createdAt: new Date() }]);
    expect((await store.getSession(s.id, CONSULTANT))?.expiresAt).toEqual(NEVER_EXPIRES);
    // Already guided: a second start changes nothing.
    const again = await store.startGuide(s.id, CONSULTANT, newGuide(HIDDEN, "visa"));
    expect(again?.guide?.contactId).toBe(CONTACT);
    // Someone else's session reads as absent.
    expect(await store.setGuide(s.id, "other@heubert.com", newGuide(CONTACT))).toBeNull();
  });

  test("setGuide refuses a normal chat", async () => {
    const store = new InMemoryChatStore();
    const s = await store.getOrCreateSession(undefined, CONSULTANT);
    expect(await store.setGuide(s.id, CONSULTANT, newGuide(CONTACT))).toBeNull();
  });
});

describe("guided turns through the graph", () => {
  const snapshotFor = async () => {
    const res = await new CrmStudentReader({ provider: providerFor(fakeCrm()) }).snapshot(CONSULTANT, CONTACT);
    if (!res.ok) throw new Error(res.message);
    return res;
  };

  test("a guided turn gets the journey block and the CRM record as citable evidence", async () => {
    const { snapshot, record } = await snapshotFor();
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "comparative_decision", needs_research: false }), answer: "Australia fits [1]." });
    const state = await graph.invoke({
      input: "which country fits her budget?",
      history: [],
      sessionId: "s",
      profile: null,
      guide: { step: "destination", stepsDone: ["enquiry"], contactId: CONTACT, snapshot, record },
    });
    const prompt = state.meta.systemPromptText as string;
    expect(prompt).toContain("Current step: 2 of 10 — Destination");
    expect(prompt).toContain('starts "Next for Sita:"');
    expect(prompt).toContain("Student: Sita Sharma");
    expect(prompt).toContain("1. Enquiry & goal (done) → 2. Destination (current)");
    expect(prompt).toContain('source="crm"');
    expect(prompt).toContain("destinations Australia");
    expect(state.sources[0]).toMatchObject({ n: 1, kind: "crm", url: `crm://student/${CONTACT}` });
    expect(state.meta.guide).toMatchObject({ step: "destination", crm: "ok" });
  });

  test("a guided turn with the CRM unreadable says so instead of inventing the student", async () => {
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "comparative_decision", needs_research: false }), answer: "ok" });
    const state = await graph.invoke({ input: "q", history: [], sessionId: "s", profile: null, guide: { step: "visa", stepsDone: [], contactId: CONTACT, snapshot: null, record: null, crmMessage: "The CRM could not be read just now." } });
    const prompt = state.meta.systemPromptText as string;
    expect(prompt).toContain("CRM record: The CRM could not be read just now.");
    expect(prompt).toContain("Missing in the CRM for this step: unknown (CRM record not available)");
    expect(state.meta.guide).toMatchObject({ step: "visa", crm: "unavailable" });
  });

  test("research seeds the CRM record first and filters on the student's CRM destinations", async () => {
    const { snapshot, record } = await snapshotFor();
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "financial_viability", needs_research: true, destinations: [] }), answer: "ok [1]" });
    const state = await graph.invoke({ input: "living cost?", history: [], sessionId: "s", profile: null, guide: { step: "finances", stepsDone: [], contactId: CONTACT, snapshot, record } });
    expect(state.evidence[0]).toMatchObject({ n: 1, kind: "crm" });
    expect(state.meta.round0GuideCountries).toEqual(["australia"]);
  });

  test("a normal chat is untouched", async () => {
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "financial_viability", needs_research: false }), answer: "ok" });
    const state = await graph.invoke({ input: "cost?", history: [], sessionId: "s", profile: null });
    expect(state.meta.systemPromptText as string).toContain("# Guided session\nnone (normal chat)");
    expect(state.meta.guide).toBeUndefined();
  });
});

describe("guided session HTTP API", () => {
  const API_KEY = "test-api-key-0123456789abcdef0123456789";
  let base = "";
  let app: ReturnType<typeof createApp>;
  let bare: ReturnType<typeof createApp>;
  let store: InMemoryChatStore;
  const as = (user: string) => ({ "content-type": "application/json", "x-api-key": API_KEY, "x-user-id": user });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (r: Response): Promise<any> => r.json();

  beforeAll(() => {
    const env = testEnv({ API_KEY });
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "comparative_decision", needs_research: false }), answer: "Australia fits [1]." });
    store = new InMemoryChatStore();
    const students = new CrmStudentReader({ provider: providerFor(fakeCrm()) });
    const logger = createLogger({ test: true });
    const deps = { env, store, knowledge: undefined as never, collections: null, logger, readiness: async () => ({ ok: true, checks: {} }), startedAt: Date.now() };
    const extras = {
      title: async () => null,
      followUps: async () => ["normal chip?"],
      // Says every step is settled, so the CRM check alone decides whether a suggestion is stored.
      guided: async () => ({ followUps: ["Compare AU and CA cost?"], stepComplete: true, reason: "Australia is chosen and on her deal." }),
    };
    app = createApp({ ...deps, service: new ChatService({ env, graph, store, logger, students, extras }), students }, { port: 0, hostname: "127.0.0.1" });
    bare = createApp({ ...deps, service: new ChatService({ env, graph, store, logger }) }, { port: 0, hostname: "127.0.0.1" });
    base = `http://127.0.0.1:${app.server.port}`;
  });
  afterAll(async () => {
    await app.shutdown(1_000);
    await bare.shutdown(1_000);
  });

  test("journey steps and the CRM contact picker", async () => {
    const steps = await j(await fetch(`${base}/v1/journey`, { headers: as(CONSULTANT) }));
    expect(steps.steps).toHaveLength(10);
    expect(steps.steps[1].crmFields[0]).toEqual({ key: "destinations", label: "Destination countries" });
    const found = await j(await fetch(`${base}/v1/crm/contacts?q=sita`, { headers: as(CONSULTANT) }));
    expect(found.contacts).toEqual([{ id: CONTACT, name: "Sita Sharma", email: "sita@example.com", status: "Prospect", branch: "Kathmandu" }]);
  });

  test("create a guided session, chat in it, move the step, read the student live", async () => {
    const created = await fetch(`${base}/v1/sessions`, { method: "POST", headers: as(CONSULTANT), body: JSON.stringify({ guided: { contactId: CONTACT } }) });
    expect(created.status).toBe(201);
    const { session } = await j(created);
    expect(session).toMatchObject({ title: "Sita Sharma", guided: true, guide: { contactId: CONTACT, currentStep: "enquiry" } });
    // Her CRM deal already names a destination, so Edge proposes starting further on.
    expect(session.guide.suggestion).toMatchObject({ toStep: "course" });
    expect(session.guide.suggestion.reason).toContain("Australia");
    expect(session.guide.steps).toHaveLength(10);
    // Only the link and the journey are stored, never the student's facts.
    const stored = await store.getSession(session.id, CONSULTANT);
    expect(Object.keys(stored!.guide!).sort()).toEqual(["contactId", "currentStep", "startedAt", "steps", "suggestion", "version"]);

    const chat = await j(await fetch(`${base}/v1/chat`, { method: "POST", headers: as(CONSULTANT), body: JSON.stringify({ message: "Which country fits?", sessionId: session.id }) }));
    expect(chat.sources[0]).toMatchObject({ kind: "crm" });
    // Guided turns get the step-scoped chips, and the enquiry step's CRM fields are not all
    // visible (education is not exposed), so nothing blocks the suggestion to move on.
    expect(chat.followUps).toEqual(["Compare AU and CA cost?"]);
    expect(chat.guide.suggestion).toMatchObject({ toStep: "destination", reason: "Australia is chosen and on her deal." });

    const moved = await j(await fetch(`${base}/v1/sessions/${session.id}/guide`, { method: "PATCH", headers: as(CONSULTANT), body: JSON.stringify({ currentStep: "destination", stepStatus: { enquiry: "done" } }) }));
    expect(moved.session.guide.currentStep).toBe("destination");
    expect(moved.session.guide.suggestion).toBeNull();

    const history = await j(await fetch(`${base}/v1/sessions/${session.id}`, { headers: as(CONSULTANT) }));
    expect(history.session.guide.steps[0]).toMatchObject({ key: "enquiry", status: "done" });
    expect(history.messages.at(-1).guideStep).toBe("enquiry");

    const list = await j(await fetch(`${base}/v1/sessions`, { headers: as(CONSULTANT) }));
    expect(list.sessions.find((s: { id: string }) => s.id === session.id)).toMatchObject({ guided: true, currentStep: "destination" });

    const student = await j(await fetch(`${base}/v1/sessions/${session.id}/student`, { headers: as(CONSULTANT) }));
    expect(student.crm.ok).toBe(true);
    expect(student.student.name).toBe("Sita Sharma");
    expect(student.steps.find((s: { key: string }) => s.key === "english")).toMatchObject({ missing: [], unknown: ["englishTest"] });

    // Another consultant cannot see or move it.
    expect((await fetch(`${base}/v1/sessions/${session.id}/guide`, { method: "PATCH", headers: as("other@heubert.com"), body: JSON.stringify({ currentStep: "visa" }) })).status).toBe(404);
  });

  test("convert a normal chat, once", async () => {
    const chat = await j(await fetch(`${base}/v1/chat`, { method: "POST", headers: as(CONSULTANT), body: JSON.stringify({ message: "hello", newSession: true }) }));
    const normal = await store.getSession(chat.sessionId, CONSULTANT);
    expect(normal!.expiresAt.getTime()).toBeLessThan(NEVER_EXPIRES.getTime());
    expect((await fetch(`${base}/v1/sessions/${chat.sessionId}/guide`, { method: "PATCH", headers: as(CONSULTANT), body: JSON.stringify({ currentStep: "visa" }) })).status).toBe(400);
    const converted = await fetch(`${base}/v1/sessions/${chat.sessionId}/guide`, { method: "PATCH", headers: as(CONSULTANT), body: JSON.stringify({ convert: { contactId: CONTACT, step: "visa" } }) });
    expect((await j(converted)).session.guide.currentStep).toBe("visa");
    expect((await store.getSession(chat.sessionId, CONSULTANT))!.expiresAt).toEqual(NEVER_EXPIRES);
    expect((await fetch(`${base}/v1/sessions/${chat.sessionId}/guide`, { method: "PATCH", headers: as(CONSULTANT), body: JSON.stringify({ convert: { contactId: CONTACT } }) })).status).toBe(409);
  });

  test("a student the consultant cannot see is a 404; no CRM is a 503; no identity is a 400", async () => {
    expect((await fetch(`${base}/v1/sessions`, { method: "POST", headers: as(CONSULTANT), body: JSON.stringify({ guided: { contactId: HIDDEN } }) })).status).toBe(404);
    const bareBase = `http://127.0.0.1:${bare.server.port}`;
    expect((await fetch(`${bareBase}/v1/sessions`, { method: "POST", headers: as(CONSULTANT), body: JSON.stringify({ guided: { contactId: CONTACT } }) })).status).toBe(503);
    expect((await fetch(`${base}/v1/sessions`, { method: "POST", headers: as("service-account"), body: JSON.stringify({ guided: { contactId: CONTACT } }) })).status).toBe(400);
  });
});

describe("demo CRM (local development)", () => {
  test("serves the three made-up students through the real reader, with suggestions to match", async () => {
    const reader = new CrmStudentReader({ provider: createDemoCrmProvider() });
    const found = await reader.searchContacts(CONSULTANT, "ramesh");
    expect(found?.map((c) => c.name)).toEqual(["Ramesh Karki"]);
    const ramesh = await reader.snapshot(CONSULTANT, found![0]!.id);
    if (!ramesh.ok) throw new Error(ramesh.message);
    expect(ramesh.snapshot.applications[0]).toMatchObject({ institution: "Monash University", workflowStage: "Offer received" });
    expect(startingSuggestion(ramesh.snapshot)).toMatchObject({ toStep: "application" });
    const [sita] = (await reader.searchContacts(CONSULTANT, "sita"))!;
    const s = await reader.snapshot(CONSULTANT, sita!.id);
    expect(s.ok && startingSuggestion(s.snapshot)).toMatchObject({ toStep: "course" });
    expect(await reader.snapshot(null, sita!.id)).toMatchObject({ ok: false, reason: "no_crm" });
  });

  test("is refused in production", () => {
    expect(() => testEnv({ NODE_ENV: "production", API_KEY: "k".repeat(32), CRM_DEMO: "true" })).toThrow(/CRM_DEMO/);
  });
});
