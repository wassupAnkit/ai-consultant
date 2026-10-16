import { describe, expect, test } from "bun:test";
import type { LlmCall } from "../src/db/mongo";
import { buildCostReport, formatCostReport, isKnowledgeOnly, normalizeMessage, parseWindow, percentile, repeatRate, roleStats, type ReportTurn } from "../src/observability/cost-report";

const day = (d: string, h = 10) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00Z`);
const call = (role: LlmCall["role"], over: Partial<LlmCall> = {}): LlmCall => ({ runId: crypto.randomUUID(), role, model: "deepseek/deepseek-v4.1-flash", provider: "openai", ok: true, ms: 100, ...over });
const turn = (over: Partial<ReportTurn> = {}): ReportTurn => ({
  createdAt: day("2026-10-01"),
  ownerId: "a@heubert.com",
  userMessage: "What is the GTE requirement?",
  intent: { primary_intent: "visa_process" },
  chunks: [{ kind: "kb" }],
  sources: [],
  research: null,
  meta: {},
  timings: { totalMs: 1_000 },
  llm: null,
  ...over,
});

describe("normalizeMessage", () => {
  test("lowercases, drops punctuation and collapses whitespace", () => {
    expect(normalizeMessage("  What's the  IELTS score\n for UK?? ")).toBe("whats the ielts score for uk");
    expect(normalizeMessage("what’s the ielts score for UK")).toBe("whats the ielts score for uk");
    expect(normalizeMessage("Visa — 500 / subclass")).toBe("visa 500 subclass");
    expect(normalizeMessage("?!")).toBe("");
  });
});

describe("percentile", () => {
  test("nearest rank; empty is null", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    const xs = Array.from({ length: 100 }, (_, i) => 100 - i); // 100..1, unsorted on purpose
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
  });
});

describe("isKnowledgeOnly", () => {
  test("knowledge-base, programme and web evidence only", () => {
    expect(isKnowledgeOnly(turn())).toBe(true);
    expect(isKnowledgeOnly(turn({ chunks: [{ kind: "kb" }, { kind: "web" }, { kind: "programs" }, {}] }))).toBe(true);
  });
  test("CRM or Google Workspace evidence, tool calls, guided sessions and caseload questions are not", () => {
    for (const kind of ["crm", "gmail", "drive", "calendar", "docs"]) {
      expect(isKnowledgeOnly(turn({ chunks: [{ kind }] }))).toBe(false);
      expect(isKnowledgeOnly(turn({ chunks: [], sources: [{ kind }] }))).toBe(false);
    }
    expect(isKnowledgeOnly(turn({ research: { toolCalls: [{ tool: "crm_search_contacts" }] } }))).toBe(false);
    expect(isKnowledgeOnly(turn({ research: { toolCalls: [{ tool: "gmail_search_threads" }] } }))).toBe(false);
    expect(isKnowledgeOnly(turn({ research: { toolCalls: [{ tool: "search_knowledge_base" }, { tool: "web_search" }] } }))).toBe(true);
    expect(isKnowledgeOnly(turn({ meta: { guide: { step: "profile" } } }))).toBe(false);
    expect(isKnowledgeOnly(turn({ intent: { primary_intent: "caseload_management" } }))).toBe(false);
    expect(isKnowledgeOnly(turn({ userMessage: "??" }))).toBe(false);
  });
});

describe("repeatRate", () => {
  test("counts knowledge-only turns already asked earlier in the window, and those first asked by someone else", () => {
    const turns = [
      turn({ createdAt: day("2026-10-01", 1), ownerId: "a", userMessage: "IELTS for UK?" }),
      turn({ createdAt: day("2026-10-01", 2), ownerId: "a", userMessage: "ielts for uk" }), // repeat, same owner
      turn({ createdAt: day("2026-10-01", 3), ownerId: "b", userMessage: "IELTS  for UK" }), // repeat, other owner
      turn({ createdAt: day("2026-10-01", 4), ownerId: "b", userMessage: "my tasks", intent: { primary_intent: "caseload_management" } }), // not knowledge-only
      turn({ createdAt: day("2026-10-01", 5), ownerId: "c", userMessage: "my tasks", chunks: [{ kind: "kb" }] }), // first knowledge-only ask of this text
      turn({ createdAt: day("2026-10-01", 6), ownerId: "a", userMessage: "fees at RMIT" }),
    ];
    // Order of input does not matter: the window is read in time order.
    const r = repeatRate([...turns].reverse());
    expect(r).toEqual({ knowledgeTurns: 5, repeats: 2, crossOwnerRepeats: 1, rate: 2 / 5, crossOwnerRate: 1 / 5 });
    expect(repeatRate([]).rate).toBeNull();
  });
});

describe("roleStats", () => {
  test("cache-hit % is cached / input (input already includes cached); calls from before the fields existed report n/a", () => {
    const rows = roleStats([
      turn({ llm: { calls: [call("research", { inputTokens: 1_000, cachedInputTokens: 800, outputTokens: 100, reasoningTokens: 60, costUsd: 0.000_1 }), call("answer", { inputTokens: 3_000, cachedInputTokens: 0, outputTokens: 500, reasoningTokens: 0, costUsd: 0.000_6 })] } }),
      turn({ llm: { calls: [call("research", { inputTokens: 3_000, cachedInputTokens: 1_200, outputTokens: 300, reasoningTokens: 140, costUsd: 0.000_3 })] } }),
      turn({ createdAt: day("2026-09-30"), llm: { calls: [call("answer", { inputTokens: 2_000, outputTokens: 100 })] } }), // old document
      turn({ meta: { jevCost: 0.000_02 } }),
    ]);
    const research = rows.find((r) => r.day === "2026-10-01" && r.role === "research")!;
    expect(research).toMatchObject({ calls: 2, avgInput: 2_000, avgCached: 1_000, cacheHitRate: 0.5, avgReasoning: 100, avgOutput: 200 });
    expect(research.costPerCall).toBeCloseTo(0.000_2, 12);
    const old = rows.find((r) => r.day === "2026-09-30" && r.role === "answer")!;
    expect(old).toMatchObject({ calls: 1, avgInput: 2_000, avgCached: null, cacheHitRate: null, avgReasoning: null, costPerCall: null });
    const jev = rows.find((r) => r.role === "jev")!;
    expect(jev).toMatchObject({ day: "2026-10-01", calls: 1, avgInput: null, cacheHitRate: null });
    expect(jev.costPerCall).toBeCloseTo(0.000_02, 12);
    // Days ascending, then roles by name.
    expect(rows.map((r) => `${r.day}/${r.role}`)).toEqual(["2026-09-30/answer", "2026-10-01/answer", "2026-10-01/jev", "2026-10-01/research"]);
  });
});

describe("buildCostReport / formatCostReport", () => {
  const window = { from: day("2026-09-30", 0), to: day("2026-10-02", 0) };
  const turns = [
    turn({ createdAt: day("2026-09-30"), timings: { totalMs: 4_000 }, llm: { costUsd: null, calls: [call("answer", { inputTokens: 2_000, outputTokens: 100 })] } }),
    turn({ timings: { totalMs: 1_000 }, llm: { costUsd: 0.001, calls: [call("answer", { inputTokens: 1_000, cachedInputTokens: 500, outputTokens: 100, costUsd: 0.001 })] } }),
    turn({ timings: { totalMs: 3_000 }, llm: { costUsd: 0.003, calls: [] } }),
  ];

  test("per-day turn cost and latency; old turns have no cost", () => {
    const r = buildCostReport(turns, window);
    const d1 = r.days.find((d) => d.day === "2026-10-01")!;
    expect(d1).toMatchObject({ turns: 2, costedTurns: 2, p50Ms: 1_000, p95Ms: 3_000 });
    expect(d1.costPerTurn).toBeCloseTo(0.002, 12);
    expect(r.days.find((d) => d.day === "2026-09-30")).toMatchObject({ turns: 1, costedTurns: 0, costPerTurn: null, p50Ms: 4_000 });
    expect(r.total).toMatchObject({ day: "all", turns: 3, costedTurns: 2, p50Ms: 3_000, p95Ms: 4_000 });
    expect(r.repeat.knowledgeTurns).toBe(3);
  });

  test("the printed report never contains message text", () => {
    const secret = "Student Priya Sharma passport N1234567 visa refusal";
    const out = formatCostReport(buildCostReport([...turns, turn({ userMessage: secret }), turn({ userMessage: secret, ownerId: "z" })], window));
    expect(out).toContain("answer");
    expect(out).not.toContain("Priya");
    expect(out).not.toContain(normalizeMessage(secret));
    expect(out).not.toContain("GTE");
    expect(out).toContain("n/a");
  });
});

describe("parseWindow", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  test("--days back from now by default; --from/--to override", () => {
    expect(parseWindow({}, now)).toEqual({ from: new Date("2026-10-01T12:00:00Z"), to: now });
    expect(parseWindow({ days: "2" }, now)).toEqual({ from: new Date("2026-10-06T12:00:00Z"), to: now });
    expect(parseWindow({ from: "2026-09-01", to: "2026-09-08" }, now)).toEqual({ from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-08T00:00:00Z") });
    expect(parseWindow({ from: "2026-10-05" }, now)).toEqual({ from: new Date("2026-10-05T00:00:00Z"), to: now });
    expect(parseWindow({ to: "2026-09-08", days: "1" }, now)).toEqual({ from: new Date("2026-09-07T00:00:00Z"), to: new Date("2026-09-08T00:00:00Z") });
    expect(() => parseWindow({ days: "0" }, now)).toThrow(/--days/);
    expect(() => parseWindow({ from: "nope" }, now)).toThrow(/invalid date/);
    expect(() => parseWindow({ from: "2026-10-05", to: "2026-10-01" }, now)).toThrow(/before/);
  });
});
