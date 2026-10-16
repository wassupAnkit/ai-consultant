import { describe, expect, test } from "bun:test";
import type { LlmCall } from "../src/db/mongo";
import { buildLatencyReport, formatLatencyReport, groupRow, sourceOf, SPLITS, turnBreakdown, type LatencyTurn } from "../src/observability/latency-report";

const call = (role: LlmCall["role"], over: Partial<LlmCall> = {}): Partial<LlmCall> => ({ role, ok: true, ms: 1_000, ...over });
const turn = (over: Partial<LatencyTurn> = {}): LatencyTurn => ({
  createdAt: new Date("2026-10-08T10:00:00Z"),
  release: "6e124179ea67",
  intent: { primary_intent: "visa_process", task: "lookup" },
  research: { rounds: 2, toolCalls: [{ tool: "search_knowledge_base", ms: 900 }, { tool: "web_search", ms: 500 }] },
  stream: { firstTokenMs: 20_000 },
  // classify 600 + research 16,000 + generate 10,000 = 26,600; total 27,000 → 400 ms outside the graph.
  timings: { classifyMs: 600, retrieveMs: 1_500, researchMs: 16_000, generateMs: 10_000, totalMs: 27_000 },
  meta: { route: { mode: "single" }, deepThink: false, shortFirst: false },
  llm: {
    calls: [
      call("research", { ms: 5_000, inputTokens: 6_000, outputTokens: 200 }),
      call("research", { ms: 4_000, inputTokens: 7_500, outputTokens: 180 }),
      call("answer", { ms: 10_000, inputTokens: 10_000, outputTokens: 700 }),
    ],
  },
  prompt: { systemPromptChars: 44_000 },
  ...over,
});
const window = { from: new Date("2026-10-06T00:00:00Z"), to: new Date("2026-10-09T00:00:00Z") };

describe("turnBreakdown", () => {
  test("splits a researched, streamed turn into stages", () => {
    const b = turnBreakdown(turn());
    expect(b.classifyMs).toBe(600);
    expect(b.round0Ms).toBe(1_500);
    expect(b.rounds).toBe(2);
    expect(b.researchModelMs).toBe(9_000);
    expect(b.researchFailedMs).toBe(0);
    // research 16,000 - round 0 1,500 - model 9,000
    expect(b.researchOtherMs).toBe(5_500);
    // first token 20,000 - classify 600 - research 16,000
    expect(b.answerWaitMs).toBe(3_400);
    expect(b.overheadMs).toBe(400);
    expect(b.answerInputTokens).toBe(10_000);
    expect(b.answerOutputTokens).toBe(700);
    // 700 tokens over the 6,600 ms after the wait
    expect(Math.round(b.answerTokPerSec!)).toBe(106);
    expect(b.researchCallMs).toEqual([5_000, 4_000]);
  });

  test("a failed research call counts as wasted research time", () => {
    const b = turnBreakdown(turn({ research: { rounds: 0, budgetExceeded: true }, llm: { calls: [call("research", { ok: false, ms: 23_000 }), call("answer", { ms: 8_000 })] } }));
    expect(b.researchFailedMs).toBe(23_000);
    expect(b.budgetExceeded).toBe(true);
    expect(b.rounds).toBe(0);
  });

  test("an unresearched, unstreamed turn leaves research and first-token stages null", () => {
    const b = turnBreakdown(turn({ research: null, stream: null, timings: { classifyMs: 500, retrieveMs: null, researchMs: null, generateMs: 4_000, totalMs: 4_700 }, llm: { calls: [call("answer", { ms: 4_000 })] } }));
    expect(b.researchMs).toBeNull();
    expect(b.researchOtherMs).toBeNull();
    expect(b.firstTokenMs).toBeNull();
    expect(b.answerWaitMs).toBeNull();
    expect(b.overheadMs).toBe(200);
    expect(SPLITS.rounds(turn({ research: null, timings: { researchMs: null } }), b)).toBe("no research");
  });

  test("the answer stats come from the last successful answer call (a fallback after a failed primary)", () => {
    const b = turnBreakdown(turn({ llm: { calls: [call("answer", { ok: false, ms: 300 }), call("answer", { ms: 9_000, outputTokens: 400 })] } }));
    expect(b.answerOutputTokens).toBe(400);
  });
});

describe("sourceOf and splits", () => {
  test("a deployed release by SHA prefix, else local", () => {
    expect(sourceOf(turn())).toBe("release 6e12417");
    expect(sourceOf(turn({ release: null }))).toBe("local (no release)");
  });
  test("deepThink, short-first, mode and distress splits read the turn meta", () => {
    const t = turn({ meta: { route: { mode: "comparison" }, deepThink: true, shortFirst: true, distress: { selfHarm: true } } });
    const b = turnBreakdown(t);
    expect(SPLITS.mode(t, b)).toBe("comparison");
    expect(SPLITS.deepThink(t, b)).toBe("deepThink");
    expect(SPLITS.shortFirst(t, b)).toBe("short-first");
    expect(SPLITS.distress(t, b)).toBe("distress");
    expect(SPLITS.rounds(t, b)).toBe("2 model rounds");
  });
});

describe("buildLatencyReport", () => {
  test("percentiles per group, research calls by position, stage means and tools", () => {
    const turns = [turn(), turn({ timings: { classifyMs: 600, retrieveMs: 1_500, researchMs: 16_000, generateMs: 10_000, totalMs: 47_000 }, stream: { firstTokenMs: 40_000 } }), turn({ release: null })];
    const r = buildLatencyReport(turns, window, ["source"]);
    expect(r.overall.turns).toBe(3);
    expect(r.overall.total.p50).toBe(27_000);
    expect(r.overall.total.p95).toBe(47_000);
    expect(r.splits[0]!.rows.map((x) => [x.group, x.turns])).toEqual([
      ["release 6e12417", 2],
      ["local (no release)", 1],
    ]);
    expect(r.rounds.map((x) => [x.round, x.ms.n, x.ms.p50])).toEqual([
      [1, 3, 5_000],
      [2, 3, 4_000],
    ]);
    expect(r.stages!.turns).toBe(3);
    expect(r.stages!.classify).toBe(600);
    expect(r.tools.map((x) => x.tool)).toEqual(["search_knowledge_base", "web_search"]);
  });

  test("failed share and budget share are over researched turns", () => {
    const row = groupRow("x", [
      turnBreakdown(turn()),
      turnBreakdown(turn({ research: { rounds: 1, budgetExceeded: true }, llm: { calls: [call("research"), call("research", { ok: false, ms: 7_000 }), call("answer")] } })),
      turnBreakdown(turn({ research: null, timings: { classifyMs: 500, researchMs: null, generateMs: 3_000, totalMs: 3_600 } })),
    ]);
    expect(row.failedShare).toBe(0.5);
    expect(row.budgetShare).toBe(0.5);
    expect(row.researchFailed.p50).toBe(7_000);
  });

  test("the printed report has timings only, never message text", () => {
    const out = formatLatencyReport(buildLatencyReport([{ ...turn(), userMessage: "SECRET question" } as LatencyTurn], window));
    expect(out).toContain("Edge latency report");
    expect(out).toContain("By intent");
    expect(out).toContain("27.0/27.0");
    expect(out).not.toContain("SECRET");
  });
});
