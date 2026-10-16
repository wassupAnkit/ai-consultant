import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { compileTemplate, promptDate } from "../src/prompts/compile";
import { RESEARCH_SYSTEM_PROMPT } from "../src/prompts/consultant";
import { RecordingKnowledgeStore, ScriptedToolModel } from "./fakes";
import { fakeGraph, intentOf, sampleChunk } from "./helpers";

const run = (graph: ReturnType<typeof fakeGraph>["graph"], input: string) => graph.invoke({ input, history: [], sessionId: "s1", profile: null });

const visaAu = intentOf({ primary_intent: "visa_process", destinations: ["australia"], user_question: "What does a subclass 500 application need?", task: "lookup", needs_research: true });

/** One turn through the graph; returns the research prompt, the answer prompt, the round-0 queries and the final state. */
async function turn(opts: { skillPacks?: boolean; intent?: ReturnType<typeof intentOf>; input?: string }) {
  const model = new ScriptedToolModel([new AIMessage({ content: "sufficient" })]);
  const knowledge = new RecordingKnowledgeStore(() => [sampleChunk(1), sampleChunk(2)]);
  const { graph } = fakeGraph({ intent: opts.intent ?? visaAu, researchModel: model, knowledge, skillPacks: opts.skillPacks });
  const state = await run(graph, opts.input ?? "Student visa checklist for Australia?");
  return { state, research: String(model.seen[0]![0]!.content), answer: String(state.meta.systemPromptText), queries: knowledge.queries };
}

describe("country skill packs in the turn", () => {
  test("off by default: no packs resolved, and both prompts keep a blank line where the pack would go", async () => {
    const { state, research, answer, queries } = await turn({});
    expect(state.skills).toBeNull();
    expect(state.meta.route).toEqual(state.route);
    expect(research).not.toContain("# Country brief");
    expect(research).toContain("Do not address the consultant.\n\n\n\n# Tools");
    expect(answer).not.toContain("# Country guidance");
    expect(answer).toContain("\n\n\n\n# Task playbook");
    expect(queries[0]!.text).toBe("What does a subclass 500 application need?\nStudent visa checklist for Australia?");
  });

  test("off: the research prompt is byte-equal to the template compiled with an empty brief", async () => {
    const off = await turn({ skillPacks: false });
    const unset = await turn({});
    expect(off.research).toBe(unset.research);
    expect(off.answer).toBe(unset.answer);
    const head = compileTemplate(RESEARCH_SYSTEM_PROMPT.split("# Tools")[0]!, { country_brief: "" });
    expect(off.research.startsWith(head)).toBe(true);
  });

  test("on, Australia visa_process: brief in research, guidance and checklist in the answer, versions on the route", async () => {
    const { state, research, answer } = await turn({ skillPacks: true });
    expect(state.skills?.versions).toEqual([expect.stringMatching(/^australia@/)]);
    expect(research).toContain("# Country brief");
    expect(research).toContain("immi.homeaffairs.gov.au");
    // The brief sits before the per-turn tool list, inside the cacheable prefix.
    expect(research.indexOf("# Country brief")).toBeLessThan(research.indexOf("\n# Tools\n"));
    expect(answer).toContain("# Country guidance");
    expect(answer).toContain("## Coverage checklist");
    expect(answer).toContain("### Australia");
    expect(answer.indexOf("# Country guidance")).toBeLessThan(answer.indexOf("\n# Task playbook\n"));
    const route = state.meta.route as { packs?: string[] };
    expect(route.packs).toEqual([expect.stringMatching(/^australia@\d{4}-\d{2}-\d{2}$/)]);
  });

  test("on: the round-0 knowledge-base query carries up to six pack vocabulary terms", async () => {
    const { queries, state } = await turn({ skillPacks: true });
    const text = queries[0]!.text;
    expect(text.startsWith("What does a subclass 500 application need?\nStudent visa checklist for Australia?\n")).toBe(true);
    const terms = state.skills!.packs[0]!.vocabulary.slice(0, 6);
    expect(text.endsWith(terms.join("; "))).toBe(true);
    expect(text).not.toContain(state.skills!.packs[0]!.vocabulary[6]!);
  });

  test("on: the vocabulary still fits a 1,000-character query when the message is long", async () => {
    const { queries } = await turn({ skillPacks: true, input: "x ".repeat(800) });
    const text = queries[0]!.text;
    expect(text.length).toBeLessThanOrEqual(1_000);
    expect(text).toContain("Student visa subclass 500");
  });

  test("on, two countries: vocabulary is taken from each country in turn", async () => {
    const intent = intentOf({ primary_intent: "visa_process", task: "lookup", destinations: ["australia", "canada"], user_question: "AU and CA student visa documents", needs_research: true });
    const { queries, state } = await turn({ skillPacks: true, intent });
    expect(state.route?.mode).toBe("single");
    const [au, ca] = state.skills!.packs;
    expect(queries[0]!.text.endsWith([au!.vocabulary[0], ca!.vocabulary[0], au!.vocabulary[1], ca!.vocabulary[1], au!.vocabulary[2], ca!.vocabulary[2]].join("; "))).toBe(true);
  });

  test("on, comparison mode: no destination brief or checklist (packs lowered comparison coverage)", async () => {
    const intent = intentOf({ primary_intent: "visa_process", task: "compare", destinations: ["australia", "canada"], user_question: "AU vs CA student visa", needs_research: true });
    const { state, research, answer } = await turn({ skillPacks: true, intent, input: "AU vs CA student visa?" });
    expect(state.route?.mode).toBe("comparison");
    expect(state.skills).toBeNull();
    expect(research).not.toContain("# Country brief");
    expect(answer).not.toContain("# Country guidance");
  });

  for (const topic of ["comparative_decision", "university_selection", "program_selection", "test_preparation"] as const) {
    test(`on, ${topic}: no destination pack, the student's market guidance still loads`, async () => {
      const intent = intentOf({ primary_intent: topic, destinations: ["australia"], user_question: "Which nursing programs suit her in Australia?", needs_research: true });
      const { state, research, answer } = await turn({ skillPacks: true, intent, input: "Nepali student: which nursing programs in Australia?" });
      expect(state.skills?.packs).toEqual([]);
      expect(state.skills?.market?.market).toBe("nepal");
      expect(research).not.toContain("# Country brief");
      expect(research).toContain("# Student market");
      expect(answer).not.toContain("# Country guidance");
      expect(answer).toContain("# Market guidance");
    });
  }

  test("on: a country without a pack resolves to nothing", async () => {
    const intent = intentOf({ primary_intent: "visa_process", destinations: ["germany"], user_question: "German student visa?", needs_research: true });
    const { state, research, answer } = await turn({ skillPacks: true, intent, input: "German student visa?" });
    expect(state.route?.countries).toEqual(["germany"]);
    expect(state.skills).toBeNull();
    expect((state.meta.route as { packs?: unknown }).packs).toBeUndefined();
    expect(research).not.toContain("# Country brief");
    expect(answer).not.toContain("# Country guidance");
  });

  test("on: the same input compiles byte-identical prompts on every run", async () => {
    const a = await turn({ skillPacks: true });
    const b = await turn({ skillPacks: true });
    expect(a.research).toBe(b.research);
    expect(a.answer).toBe(b.answer);
    expect(a.answer).toContain(`Today: ${promptDate()}`);
  });
});
