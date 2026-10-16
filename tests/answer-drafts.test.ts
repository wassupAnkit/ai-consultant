import { describe, expect, test } from "bun:test";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import type { CrmProvider, CrmToolResult } from "../src/crm/client";
import { crmAmbiguityNote, dropBasedOnLines } from "../src/graph/answer-checks";
import { figureCheck, isNonEnglishDraft } from "../src/graph/draft-check";
import { isShortQuestion, SHORT_FIRST_INSTRUCTION } from "../src/graph/short-first";
import { CONSULTANT_SYSTEM_PROMPT, RESEARCH_SYSTEM_PROMPT } from "../src/prompts/consultant";
import { makeCrmTools } from "../src/tools/crm";
import { EvidenceCollector } from "../src/tools/evidence";
import { ChatService } from "../src/app/service";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { priorAnswersOf, priorSourcesOf, refersBack } from "../src/memory/recall";
import type { StoredMessage } from "../src/memory/store";
import { createLogger } from "../src/observability/logger";
import type { Source } from "../src/retrieval/format";
import { fakeToolset, RecordingKnowledgeStore, ScriptedToolModel, toolCall } from "./fakes";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

// Counsellor audit (Oct 2026), N15/N22: drafts for students and parents carried [n] markers and
// a "Based on" line inside the text to send, named a channel the market does not use, opened with
// religious blessings, and invented a bank's loan-repayment terms.
describe("client-facing drafts (answer prompt)", () => {
  test("no markers inside the draft; a short Sources: line after it, for the counsellor", () => {
    expect(CONSULTANT_SYSTEM_PROMPT).toContain("Never put citation markers like [3] inside the produced text itself");
    expect(CONSULTANT_SYSTEM_PROMPT).toContain('"Sources: [2][4]"');
    expect(CONSULTANT_SYSTEM_PROMPT).not.toContain('"Based on: [n][m]"');
  });

  test("the market's usual channel, as a default the counsellor can change", () => {
    for (const s of ["Vietnam: Zalo", "Nepal, India, Bangladesh and Sri Lanka: WhatsApp or Viber", "Philippines: Messenger or Viber", "Thailand: LINE", "default the consultant can change"]) {
      expect(CONSULTANT_SYSTEM_PROMPT).toContain(s);
    }
  });

  test("culturally neutral, and no invented loan or bank claims", () => {
    expect(CONSULTANT_SYSTEM_PROMPT).toContain("no religious idioms, blessings or invocations unless the consultant or the family used them first");
    expect(CONSULTANT_SYSTEM_PROMPT).toContain("Never state a loan-repayment term, interest rate or bank policy in a draft unless an excerpt gives it");
  });
});

// N6: a Nepali translation turned "48 hours per fortnight" into "24 hours per week". A non-English
// draft is checked against the source answer and this turn's evidence, and a mismatch is flagged.
describe("figure check on non-English drafts", () => {
  const source = "Work limit: 48 hours per fortnight during term [1]. Funds: AUD 29,710 per year [2]. Tuition NPR 61–75 lakh [3].";

  test("the answer prompt keeps figures, currencies and periods in any language", () => {
    expect(CONSULTANT_SYSTEM_PROMPT).toContain("in any language, keeps every figure, unit, currency, period");
    expect(CONSULTANT_SYSTEM_PROMPT).toContain("never per week; AUD stays AUD");
  });

  test("a changed number or period is reported", () => {
    const note = figureCheck("काम: हरेक हप्ता २४ घण्टा। रकम AUD 29,710 प्रति वर्ष।", [source]);
    expect(note).toContain("Check:");
    expect(note).toContain("24");
    expect(note).toContain('"week"');
    expect(note).toContain("fortnight");
    expect(note).toContain("differs from the source answer");
  });

  test("the same figures in another script, with separators and citations, pass", () => {
    expect(figureCheck("काम: हरेक दुई हप्तामा ४८ घण्टा। रकम AUD २९,७१० प्रति वर्ष। शुल्क NPR ६१–७५ लाख।\n\nSources: [1][2][3]", [source])).toBeNull();
    expect(figureCheck("Làm thêm: 48 giờ mỗi hai tuần. Tài chính: AUD 29.710 mỗi năm.", [source])).toBeNull();
    expect(figureCheck("1. काम: हरेक दुई हप्तामा ४८ घण्टा\n2. शुल्क रु ६१–७५ लाख", [source])).toBeNull();
  });

  test("a changed currency is reported", () => {
    expect(figureCheck("Funds: USD 29,710 per year.", [source])).toContain('"USD"');
  });

  test("nothing to check when the source has no figure with a unit", () => {
    expect(figureCheck("२४ घण्टा", ["Apply early and keep your documents ready."])).toBeNull();
  });

  test("only for drafts, translations and rewrites written in another language", () => {
    const base = { rewrite: false, input: "Translate this for the parents", answer: "काम: हरेक हप्ता २४ घण्टा" };
    expect(isNonEnglishDraft({ ...base, intent: { task: "translate", language: "en" } })).toBe(true);
    expect(isNonEnglishDraft({ ...base, intent: { task: "lookup", language: "en" } })).toBe(false);
    expect(isNonEnglishDraft({ ...base, intent: { task: "draft", language: "en" }, answer: "Work: 24 hours a week." })).toBe(false);
    expect(isNonEnglishDraft({ ...base, intent: { task: "draft", language: "en" }, input: "same in Vietnamese please", answer: "Làm thêm 24 giờ mỗi tuần." })).toBe(true);
    expect(isNonEnglishDraft({ ...base, intent: { task: "lookup", language: "en" }, rewrite: true })).toBe(true);
  });

  test("the answer node appends the check to a Nepali translation of the previous answer", async () => {
    const intent = intentOf({ task: "translate", primary_intent: "visa_process", needs_research: false });
    const { graph } = fakeGraph({ intent, answer: "काम: हरेक हप्ता २४ घण्टा।" });
    const out = await graph.invoke({ input: "translate to Nepali", history: [new HumanMessage("Work limit?"), new AIMessage(source)], priorAnswer: source, sessionId: "s1", profile: null });
    expect(out.answer.startsWith("काम: हरेक हप्ता २४ घण्टा।\n\n")).toBe(true);
    expect(out.answer).toContain("Check:");
    expect(out.meta.draftCheck).toBe(true);
  });

  test("the check reaches the client as streamed text", async () => {
    const store = new InMemoryChatStore();
    const intent = intentOf({ task: "translate", primary_intent: "visa_process", needs_research: false });
    const { graph } = fakeGraph({ intent, answer: "काम: हरेक हप्ता २४ घण्टा।" });
    const svc = new ChatService({ env: testEnv(), graph, store, logger: createLogger({ test: true }) });
    const session = await store.getOrCreateSession(undefined, "o1");
    await store.append(session.id, [
      { role: "human", content: "Work limit?", createdAt: new Date(1) },
      { role: "ai", content: source, createdAt: new Date(2) },
    ]);
    const tokens: string[] = [];
    const result = await svc.chat({ message: "translate to Nepali", sessionId: session.id, ownerId: "o1", requestId: "r1", route: "/v1/chat/stream", onToken: (t) => tokens.push(t) });
    expect(result.answer).toContain("Check:");
    expect(tokens.join("")).toBe(result.answer);
  });

  test("a faithful translation is left alone", async () => {
    const intent = intentOf({ task: "translate", primary_intent: "visa_process", needs_research: false });
    const { graph } = fakeGraph({ intent, answer: "काम: हरेक दुई हप्तामा ४८ घण्टा।" });
    const out = await graph.invoke({ input: "translate to Nepali", history: [new HumanMessage("Work limit?"), new AIMessage(source)], priorAnswer: source, sessionId: "s1", profile: null });
    expect(out.answer).toBe("काम: हरेक दुई हप्तामा ४८ घण्टा।");
    expect(out.meta.draftCheck).toBe(false);
  });
});

// N16/M10: three turns after quoting a fee, Edge answered "Not in the knowledge base" for it: the
// history window had cut that answer at 3,000 characters and this turn's research found nothing.
describe("memory of earlier answers on a turn that refers back", () => {
  const first = `Monash Master of IT tuition: AUD 53,000 per year [1]. ${"Intakes and entry detail. ".repeat(200)}Scholarship: 10% Monash International Merit [2].`;
  const second = `Deakin Master of IT tuition: AUD 39,800 per year [1]. ${"Campus and course detail. ".repeat(200)}OSHC: AUD 650 per year [2].`;
  const cut = (s: string) => s.slice(0, 3_000) + " …";
  const history = [new HumanMessage("Monash MIT fees?"), new AIMessage(cut(first)), new HumanMessage("Deakin MIT fees?"), new AIMessage(cut(second))];
  const earlier: Source[] = [
    { n: 1, url: "https://www.deakin.edu.au/course/master-information-technology", title: "Master of IT — Deakin", excerpt: "Deakin Master of Information Technology: AUD 39,800 per year (2026).", source: "partner:deakin", live: false, kind: "kb" },
    { n: 2, url: "crm://crm_get_student_overview/abc", title: "Student overview", excerpt: "Riya Basnet (C21). Deal D9.", source: "crm", live: false, kind: "crm" },
  ];
  const record = () => {
    const seen: BaseMessage[][] = [];
    const model = RunnableLambda.from(async (messages: BaseMessage[]) => {
      seen.push(messages);
      return new AIMessage("Deakin was AUD 39,800 per year [1].");
    });
    return { seen, model };
  };
  const noLookup = intentOf({ task: "lookup", primary_intent: "financial_viability", needs_research: false });

  test("refers back: pronouns, 'you said', 'earlier', 'that', follow-up cues, or the classifier's flag", () => {
    for (const input of ["What was the Deakin fee you said?", "Repeat the fee from earlier", "Is that per year?", "and Monash?", "Send those figures to her", "What about the scholarship"]) {
      expect([input, refersBack(input, null)]).toEqual([input, true]);
    }
    expect(refersBack("Compare tuition at RMIT and Swinburne for a master's in data science", { references_prior_turn: true })).toBe(true);
    expect(refersBack("Compare tuition at RMIT and Swinburne for a master's in data science", null)).toBe(false);
  });

  test("the answer prompt explains carried-over sources and checks earlier answers before 'Not in the knowledge base'", () => {
    expect(CONSULTANT_SYSTEM_PROMPT).toContain('Excerpts whose title ends "(from earlier in this conversation)"');
    expect(CONSULTANT_SYSTEM_PROMPT).toContain('Before writing "Not in the knowledge base:" about a figure or fact, check your earlier answers');
  });

  test("the last two answers, uncut, from the stored history", () => {
    const stored = [first, second, "third"].flatMap((a, i): StoredMessage[] => [
      { role: "human", content: `q${i}`, createdAt: new Date(i * 2) },
      { role: "ai", content: a, createdAt: new Date(i * 2 + 1) },
    ]);
    expect(priorAnswersOf(stored)).toEqual([second, "third"]);
    expect(priorAnswersOf([{ role: "ai", content: "x".repeat(20_000), createdAt: new Date() }])[0]).toHaveLength(12_000);
  });

  test("the previous turn's sources, read from its stored metadata", () => {
    const stored: StoredMessage[] = [
      { role: "ai", content: "old", metadata: { sources: [{ n: 9, url: "https://old", title: "Old", excerpt: "old", source: "x", live: false }] }, createdAt: new Date(1) },
      { role: "human", content: "q", createdAt: new Date(2) },
      { role: "ai", content: "new", metadata: { sources: [...earlier, { junk: true }] }, createdAt: new Date(3) },
    ];
    expect(priorSourcesOf(stored).map((s) => s.url)).toEqual(earlier.map((s) => s.url));
    expect(priorSourcesOf([{ role: "ai", content: "a", createdAt: new Date() }])).toEqual([]);
  });

  test("a turn that refers back sees both earlier answers in full, and the earlier sources as marked evidence", async () => {
    const { seen, model } = record();
    // "you said" re-checks the fact (src/graph/freshness.ts); this turn's lookup finds nothing.
    const { graph } = fakeGraph({ intent: noLookup, answerModel: model, knowledge: new RecordingKnowledgeStore(() => []) });
    const out = await graph.invoke({ input: "What was the Deakin fee you said earlier?", history, priorAnswer: second, priorAnswers: [first, second], priorSources: earlier, sessionId: "s1", profile: null });
    const ais = seen[0]!.filter((m) => m.getType() === "ai").map((m) => String(m.content));
    expect(ais).toEqual([first, second]);
    const system = String(seen[0]![0]!.content);
    expect(system).toContain("Master of IT — Deakin (from earlier in this conversation)");
    expect(system).toContain("AUD 39,800 per year (2026).");
    // A CRM record is re-read, never carried over (rule 12e).
    expect(system).not.toContain("Riya Basnet (C21)");
    expect(out.sources.map((s: Source) => s.url)).toEqual([earlier[0]!.url]);
  });

  test("an earlier source this turn's research found again is not added twice", async () => {
    const { seen, model } = record();
    const chunk = { ...sampleChunk(1), url: earlier[0]!.url, content: "Deakin MIT: AUD 39,800 per year." };
    const { graph } = fakeGraph({ intent: { ...noLookup, needs_research: true }, answerModel: model, knowledge: new RecordingKnowledgeStore(() => [chunk]) });
    await graph.invoke({ input: "Is that fee per year?", history, priorAnswer: second, priorAnswers: [first, second], priorSources: earlier, sessionId: "s1", profile: null });
    expect(String(seen[0]![0]!.content)).not.toContain("Master of IT — Deakin (from earlier in this conversation)");
    expect(String(seen[0]![0]!.content).match(/deakin\.edu\.au\/course/g)).toHaveLength(1);
  });

  test("a new, self-contained question keeps the windowed history and no earlier sources", async () => {
    const { seen, model } = record();
    const { graph } = fakeGraph({ intent: noLookup, answerModel: model });
    await graph.invoke({ input: "Compare tuition at RMIT and Swinburne for a master's in data science", history, priorAnswer: second, priorAnswers: [first, second], priorSources: earlier, sessionId: "s1", profile: null });
    expect(seen[0]!.filter((m) => m.getType() === "ai").map((m) => String(m.content))).toEqual([cut(first), cut(second)]);
    expect(String(seen[0]![0]!.content)).not.toContain("Master of IT — Deakin (from earlier in this conversation)");
  });

  test("the chat service hands the graph the stored answers and sources", async () => {
    const { seen, model } = record();
    const store = new InMemoryChatStore();
    const { graph } = fakeGraph({ intent: noLookup, answerModel: model });
    const svc = new ChatService({ env: testEnv(), graph, store, logger: createLogger({ test: true }) });
    const session = await store.getOrCreateSession(undefined, "o1");
    await store.append(session.id, [
      { role: "human", content: "Monash MIT fees?", createdAt: new Date(1) },
      { role: "ai", content: first, createdAt: new Date(2) },
      { role: "human", content: "Deakin MIT fees?", createdAt: new Date(3) },
      { role: "ai", content: second, metadata: { sources: earlier }, createdAt: new Date(4) },
    ]);
    await svc.chat({ message: "What was the Deakin fee you said earlier?", sessionId: session.id, ownerId: "o1", requestId: "r1", route: "/v1/chat" });
    expect(seen[0]!.filter((m) => m.getType() === "ai").map((m) => String(m.content))).toEqual([first, second]);
    expect(String(seen[0]![0]!.content)).toContain("Master of IT — Deakin (from earlier in this conversation)");
  });
});

// N7: answers cited loosely — "Based on [1][2]" lines and one id for a paragraph of figures it did
// not state. One supporting [n] per item; "Based on" lines are dropped from the answer.
describe("citations: one supporting excerpt per item, no 'Based on' lines", () => {
  test("the answer prompt asks for one supporting [n] per item and an inline gap note", () => {
    expect(CONSULTANT_SYSTEM_PROMPT).toContain("Cite each factual item");
    expect(CONSULTANT_SYSTEM_PROMPT).toContain('Never write a "Based on" line');
    expect(CONSULTANT_SYSTEM_PROMPT).toContain("(no supporting excerpt)");
  });

  test("'Based on' lines are removed, whatever their markup", () => {
    expect(dropBasedOnLines("Tuition is AUD 30k [1].\n\nBased on: [1][2]")).toBe("Tuition is AUD 30k [1].");
    expect(dropBasedOnLines("Hi Riya,\nYour CoE is ready.\n\n**Based on:** [2], [3]\n\nSources: [2]")).toBe("Hi Riya,\nYour CoE is ready.\n\nSources: [2]");
    expect(dropBasedOnLines("- Fee AUD 710 [1]\n_Based on [1][3]_\n- Health check [2]")).toBe("- Fee AUD 710 [1]\n- Health check [2]");
    expect(dropBasedOnLines("> Based on: the university page and the visa page")).toBe("");
  });

  test("a sentence that starts 'Based on' is kept", () => {
    const text = "Based on the 2026 fee schedule, tuition rises 4% [2].";
    expect(dropBasedOnLines(text)).toBe(text);
  });

  test("the answer node drops them before choosing sources", async () => {
    const intent = intentOf({ task: "draft", primary_intent: "financial_viability", needs_research: true });
    const { graph } = fakeGraph({ intent, answer: "Dear parent, the fee is due on 1 March.\n\nBased on: [1][2]" });
    const out = await graph.invoke({ input: "Draft a fee reminder for the parent", history: [], sessionId: "s1", profile: null });
    expect(out.answer).toBe("Dear parent, the fee is due on 1 March.");
    expect(out.sources).toEqual([]);
  });
});

// N5: a name matching several CRM contacts was silently resolved to one, and "no students in
// branch X" was inferred from one page of results.
describe("CRM: a name that matches several contacts", () => {
  const sitas = [
    { id: "C30", name: "Sita Sharma", status: "Lead", branch: { name: "Kathmandu" } },
    { id: "C31", name: "Sita Sharma", status: "Active", branch: "Pokhara" },
  ];
  const search = (contacts: object[]): CrmToolResult => ({ text: contacts.map((c) => `- ${(c as { name: string }).name}`).join("\n"), structured: { contacts }, isError: false });
  const ambiguous = [{ crmSearch: { query: "Sita Sharma", contacts: [{ id: "C30", name: "Sita Sharma", branch: "Kathmandu", status: "Lead" }, { id: "C31", name: "Sita Sharma", branch: "Pokhara", status: "Active" }] } }];

  test("the answer prompt lists candidates, never picks one, and never infers totals from one page", () => {
    expect(CONSULTANT_SYSTEM_PROMPT).toContain("list the candidates (name, contact id, branch, status) and ask which one");
    expect(CONSULTANT_SYSTEM_PROMPT).toContain("never pick one silently");
    expect(CONSULTANT_SYSTEM_PROMPT).toContain("one page of results");
    expect(RESEARCH_SYSTEM_PROMPT).toContain("several contacts match the name, do not open one");
  });

  test("a note naming the candidates when the answer does not mention them", () => {
    const note = crmAmbiguityNote("Sita Sharma has an open deal [1].", ambiguous);
    expect(note).toContain('"Sita Sharma" matched 2 contacts');
    expect(note).toContain("Sita Sharma (C30, Kathmandu, Lead)");
    expect(note).toContain("Sita Sharma (C31, Pokhara, Active)");
    expect(note).toContain("Confirm which one");
  });

  test("no note when the answer lists the matches or says there are several, or there is one match", () => {
    expect(crmAmbiguityNote("Two contacts match: Sita Sharma (C30, Kathmandu) and Sita Sharma (C31, Pokhara). Which one?", ambiguous)).toBeNull();
    expect(crmAmbiguityNote("Several contacts match that name; which one do you mean?", ambiguous)).toBeNull();
    expect(crmAmbiguityNote("Sita has a deal [1].", [{ crmSearch: { query: "Sita", contacts: [ambiguous[0]!.crmSearch.contacts[0]!] } }])).toBeNull();
    expect(crmAmbiguityNote("Sita has a deal [1].", [{}])).toBeNull();
  });

  test("a CRM search's evidence carries its matches", async () => {
    const collector = new EvidenceCollector();
    const [searchTool] = makeCrmTools(fakeToolset(search(sitas)), { collector });
    await searchTool!.invoke({ query: "Sita Sharma" });
    expect(collector.items[0]!.crmSearch).toEqual({
      query: "Sita Sharma",
      contacts: [
        { id: "C30", name: "Sita Sharma", branch: "Kathmandu", status: "Lead" },
        { id: "C31", name: "Sita Sharma", branch: "Pokhara", status: "Active" },
      ],
    });
  });

  test("the answer node appends the note when the answer picked one silently", async () => {
    const provider: CrmProvider = { forActor: async () => fakeToolset(search(sitas)) };
    const intent = intentOf({ primary_intent: "caseload_management", task: "lookup", needs_research: true });
    const { graph } = fakeGraph({
      intent,
      answer: "Sita Sharma has an open deal [1].",
      crmProvider: provider,
      researchModel: new ScriptedToolModel([toolCall("crm_search_contacts", { query: "Sita Sharma" }), new AIMessage({ content: "sufficient" })]),
      knowledge: new RecordingKnowledgeStore(() => []),
    });
    const out = await graph.invoke({ input: "Does Sita Sharma have an open deal?", history: [], sessionId: "s1", profile: null, actorEmail: "jane@heubert.com" });
    expect(out.answer.startsWith("Sita Sharma has an open deal [1].\n\n")).toBe(true);
    expect(out.answer).toContain("C31");
    expect(out.meta.crmAmbiguous).toBe(true);
  });
});

// N21: WhatsApp-length questions got 4,000-character answers. A short question is answered
// short-first: a 3–6 line answer, then "More detail:" only if needed, about 1,800 characters.
describe("short-first answers to short questions", () => {
  const lookup = intentOf({ task: "lookup", primary_intent: "visa_process", needs_research: false });
  const systemFor = async (input: string, intent = lookup) => {
    let system = "";
    const model = RunnableLambda.from(async (messages: BaseMessage[]) => {
      system = String(messages[0]!.content);
      return new AIMessage("ok");
    });
    const { graph } = fakeGraph({ intent, answerModel: model });
    const out = await graph.invoke({ input, history: [], sessionId: "s1", profile: null });
    return { system, meta: out.meta };
  };

  test("the answer prompt carries the rule", () => {
    expect(CONSULTANT_SYSTEM_PROMPT).toContain('short-first answer: the answer in 3–6 lines, then a "More detail:" section only if needed');
  });

  test("short question, short-first; a request for detail or a long message, not", () => {
    expect(isShortQuestion("Can a 500 visa holder work 48 hours a fortnight during the term break?")).toBe(true);
    expect(isShortQuestion("Explain everything about the 500 visa work rules")).toBe(false);
    expect(isShortQuestion("Give me a detailed breakdown of GS requirements")).toBe(false);
    expect(isShortQuestion("Full list of documents for a UK CAS please")).toBe(false);
    expect(isShortQuestion(`${"word ".repeat(26)}?`)).toBe(false);
    expect(isShortQuestion("x".repeat(300))).toBe(false);
  });

  test("the instruction is in the answer prompt for a short question", async () => {
    const { system, meta } = await systemFor("Can a 500 visa holder work full time in the summer break?");
    expect(system.trimEnd().endsWith(SHORT_FIRST_INSTRUCTION)).toBe(true);
    expect(meta.shortFirst).toBe(true);
  });

  test("not for a long or detailed request, nor for drafts and calculations", async () => {
    expect((await systemFor("Explain the 500 visa work rules in detail")).system).not.toContain(SHORT_FIRST_INSTRUCTION);
    expect((await systemFor(`Can a student work ${"and also ".repeat(15)} more?`)).system).not.toContain(SHORT_FIRST_INSTRUCTION);
    expect((await systemFor("WhatsApp to the parent about the deposit", intentOf({ task: "draft", primary_intent: "visa_process", needs_research: false }))).system).not.toContain(SHORT_FIRST_INSTRUCTION);
    expect((await systemFor("Funds to show for 2 years in Sydney?", intentOf({ task: "calculate", primary_intent: "financial_viability", needs_research: false }))).system).not.toContain(SHORT_FIRST_INSTRUCTION);
  });
});
