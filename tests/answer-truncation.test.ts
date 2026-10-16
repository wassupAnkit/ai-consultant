import { describe, expect, test } from "bun:test";
import { AIMessageChunk } from "@langchain/core/messages";
import { FakeStreamingChatModel } from "@langchain/core/utils/testing";
import { ChatService } from "../src/app/service";
import { ANSWER_CUT_OFF_ERROR_NOTE, ANSWER_CUT_OFF_RUNAWAY_NOTE, ANSWER_CUT_OFF_TIME_NOTE } from "../src/graph/nodes";
import { ANSWER_MAX_CHARS, runawayCut } from "../src/graph/runaway";
import { stripDanglingCitations } from "../src/retrieval/format";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { StreamThenFailChatModel, StreamThenHangChatModel } from "./fakes";
import { fakeGraph, intentOf, testEnv } from "./helpers";

// Counsellor audit (Oct 2026): 7% of answers stopped mid-sentence when the answer deadline hit
// after tokens had streamed, and were returned as ordinary successful answers.
describe("an answer cut off after tokens streamed", () => {
  const intent = intentOf({ primary_intent: "financial_viability", destinations: ["australia"], user_question: "Cost?" });
  const text = (t: string) => new AIMessageChunk({ content: [{ type: "text", text: t }] });

  const turn = async (graphOpts: Partial<Parameters<typeof fakeGraph>[0]>, envOverride: Record<string, number> = {}) => {
    const store = new InMemoryChatStore();
    const { graph } = fakeGraph({ intent, env: { ...testEnv(), ...envOverride }, ...graphOpts });
    const svc = new ChatService({ env: testEnv(), graph, store, logger: createLogger({ test: true }) });
    const tokens: string[] = [];
    const result = await svc.chat({ message: "Cost?", ownerId: "anonymous", requestId: "r1", route: "/v1/chat/stream", onToken: (t) => tokens.push(t) });
    await Bun.sleep(10); // persistence is fire-and-forget
    const ai = (await store.getMessages(result.sessionId, 10)).find((m) => m.role === "ai");
    return { tokens, result, ai };
  };

  test("by the time limit: a visible note is appended and streamed, and the turn is flagged", async () => {
    const { tokens, result, ai } = await turn({ answerModel: new StreamThenHangChatModel([text("Tuition is AUD 20k")]) }, { ANSWER_TIMEOUT_MS: 50 });
    expect(result.answer).toBe(`Tuition is AUD 20k${ANSWER_CUT_OFF_TIME_NOTE}`);
    expect(ANSWER_CUT_OFF_TIME_NOTE).toContain("time limit");
    // The client builds the answer from the tokens: the note must reach it the same way.
    expect(tokens.join("")).toBe(result.answer);
    expect(result.truncated).toBe(true);
    expect(result.meta.truncated).toBe(true);
    expect(ai?.content).toBe(result.answer);
    expect(ai?.metadata?.truncated).toBe(true);
  });

  test("by a provider error: the note says so", async () => {
    const primary = new StreamThenFailChatModel([text("Tuition is ")], new Error("stream closed unexpectedly"));
    const { tokens, result } = await turn({ answerModel: primary });
    expect(result.answer).toBe(`Tuition is${ANSWER_CUT_OFF_ERROR_NOTE}`);
    expect(tokens.join("")).toBe(`Tuition is ${ANSWER_CUT_OFF_ERROR_NOTE}`);
    expect(result.truncated).toBe(true);
    expect(result.meta.generateError).toContain("stream closed");
  });

  test("a complete answer carries no note and is not flagged", async () => {
    const { result, ai } = await turn({ answerModel: new FakeStreamingChatModel({ chunks: [text("Tuition is AUD 20k–45k [1].")] }) });
    expect(result.answer).toBe("Tuition is AUD 20k–45k [1].");
    expect(result.truncated).toBe(false);
    expect(result.meta.truncated).toBe(false);
    expect(ai?.metadata?.truncated).toBeUndefined();
  });

  test("nothing streamed and nothing from the fallback: the safe answer, not a cut-off note", async () => {
    const { result } = await turn({ answerModel: new StreamThenFailChatModel([], new Error("503")) });
    expect(result.answer).not.toContain(ANSWER_CUT_OFF_ERROR_NOTE);
    expect(result.truncated).toBe(false);
  });
});

// South Asia audit (Oct 2026): a Bangla draft to a parent ended in ~12 KB of runaway citation
// numbers ("[1]…[2223"). The answer node stops a degenerate stream, trims the tail and says so.
describe("runaway output guard", () => {
  const intent = intentOf({ primary_intent: "financial_viability", destinations: ["australia"], user_question: "Cost?" });
  const chunk = (t: string) => new AIMessageChunk({ content: t });

  const turn = async (chunks: string[]) => {
    const { graph } = fakeGraph({ intent, answerModel: new FakeStreamingChatModel({ chunks: chunks.map(chunk) }) });
    const svc = new ChatService({ env: testEnv(), graph, store: new InMemoryChatStore(), logger: createLogger({ test: true }) });
    const tokens: string[] = [];
    const result = await svc.chat({ message: "Cost?", ownerId: "anonymous", requestId: "r1", route: "/v1/chat/stream", onToken: (t) => tokens.push(t) });
    return { tokens, result };
  };

  test("a run of citation markers is cut, trimmed and flagged", async () => {
    const markers = Array.from({ length: 300 }, (_, i) => `[${i + 1}]`);
    const { tokens, result } = await turn(["Dear parent, tuition is AUD 30k a year [1].", ...markers]);
    expect(result.answer).toBe(`Dear parent, tuition is AUD 30k a year [1].${ANSWER_CUT_OFF_RUNAWAY_NOTE}`);
    expect(result.truncated).toBe(true);
    expect(result.meta.runaway).toBe("citation_run");
    // The stream stopped: the client did not receive the other ~250 markers.
    expect(tokens.length).toBeLessThan(60);
    expect(tokens.at(-1)).toBe(ANSWER_CUT_OFF_RUNAWAY_NOTE);
  });

  test("the same short sequence repeated over and over is cut after one copy", async () => {
    const { result } = await turn(["Fees are paid each semester [1]. ", ...Array.from({ length: 200 }, () => "lakh ")]);
    expect(result.answer.startsWith("Fees are paid each semester [1]. lakh")).toBe(true);
    expect(result.answer).not.toContain("lakh lakh lakh lakh");
    expect(result.meta.runaway).toBe("repetition");
    expect(result.truncated).toBe(true);
  });

  test("an answer past the hard cap is cut at a paragraph boundary", async () => {
    const para = (i: number) => `Paragraph ${i}: ${"the student should compare tuition, living costs and scholarships ".repeat(4)}\n\n`;
    const { result } = await turn(Array.from({ length: 80 }, (_, i) => para(i)));
    expect(result.answer.length).toBeLessThanOrEqual(ANSWER_MAX_CHARS + ANSWER_CUT_OFF_RUNAWAY_NOTE.length);
    expect(result.answer.endsWith(`scholarships${ANSWER_CUT_OFF_RUNAWAY_NOTE}`)).toBe(true);
    expect(result.meta.runaway).toBe("max_chars");
  });

  test("an ordinary answer with citations and a table is untouched", async () => {
    const table = "| Item | AUD |\n|---|---|\n" + Array.from({ length: 12 }, (_, i) => `| Cost ${i} | ${1000 + i} |\n`).join("");
    const { result } = await turn(["Costs [1] [2]:\n\n", table, "\nAsk for the CoE [1]."]);
    expect(result.truncated).toBe(false);
    expect(result.meta.runaway).toBeNull();
    expect(result.answer).toContain("| Cost 11 | 1011 |");
  });
});

describe("runawayCut", () => {
  test("detects each degenerate shape and keeps what came before it", () => {
    expect(runawayCut("Hello [1]." + "[3]".repeat(50))).toEqual({ keep: "Hello [1].", reason: "citation_run" });
    expect(runawayCut("Hello [1]." + Array.from({ length: 45 }, (_, i) => ` [${i}]`).join("") + " [22")?.reason).toBe("citation_run");
    expect(runawayCut("Hi. " + "ab".repeat(150))?.keep).toBe("Hi. ab");
    const long = Array.from({ length: 2_000 }, (_, i) => `word${i}.`).join(" ");
    expect(long.length).toBeGreaterThan(ANSWER_MAX_CHARS);
    expect(runawayCut(long)?.reason).toBe("max_chars");
    expect(runawayCut(long)!.keep.length).toBeLessThanOrEqual(ANSWER_MAX_CHARS);
  });

  test("leaves normal text alone", () => {
    expect(runawayCut("Fees [1][2][3] and visas [4].")).toBeNull();
    expect(runawayCut("---\n" + "Row | a |\n".repeat(10))).toBeNull();
    expect(runawayCut("")).toBeNull();
  });
});

describe("dangling citations", () => {
  const sources = [{ n: 1 }, { n: 2 }] as Parameters<typeof stripDanglingCitations>[1];

  test("markers that point at no evidence this turn are removed", () => {
    expect(stripDanglingCitations("Fee is AUD 710 [1]. An older rule [7]. Both [2][9].", sources)).toBe("Fee is AUD 710 [1]. An older rule. Both [2].");
    expect(stripDanglingCitations("Nothing to cite [3].", [])).toBe("Nothing to cite.");
    expect(stripDanglingCitations("No markers.", sources)).toBe("No markers.");
  });

  test("the answer node strips them before choosing sources", async () => {
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "financial_viability", destinations: ["australia"] }), answer: "Tuition starts at AUD 20,000 [1], as before [14]." });
    const out = await graph.invoke({ input: "Cost?", history: [], sessionId: "s1", profile: null });
    expect(out.answer).toBe("Tuition starts at AUD 20,000 [1], as before.");
    expect(out.sources.map((s: { n: number }) => s.n)).toEqual([1]);
  });
});
