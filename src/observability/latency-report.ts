import type { ChatTurnDoc, LlmCall } from "../db/mongo";
import { percentile, type ReportWindow } from "./cost-report";

/**
 * The pure half of `bun run latency:report`: where a turn's wall-clock time goes, over
 * `chat_turns` rows. The CLI (scripts/latency-report.ts) only reads the rows and prints
 * `formatLatencyReport`.
 *
 * Per turn it splits `timings.totalMs` into the classifier, research round 0 (`timings.retrieveMs`:
 * knowledge base, programmes, official and FX searches in parallel), the model-driven research
 * rounds (the research calls' own `ms`), the rest of research (the rounds' tool calls plus CRM and
 * Workspace resolution and helpline searches), the wait for the answer's first token (prefill
 * plus anything between research and the stream) and the answer's streaming. Nothing here reads
 * or prints message text.
 */

/** The `chat_turns` fields the report reads (the script projects only these). */
export interface LatencyTurn {
  createdAt: Date;
  release?: string | null;
  auth?: string | null;
  route?: string | null;
  outcome?: string | null;
  intent?: { primary_intent?: string; task?: string } | null;
  research?: { rounds?: number; budgetExceeded?: boolean; toolCalls?: { tool: string; ms?: number }[] } | null;
  stream?: { firstTokenMs?: number | null } | null;
  timings?: { classifyMs?: number | null; retrieveMs?: number | null; researchMs?: number | null; generateMs?: number | null; totalMs?: number | null } | null;
  meta?: Record<string, unknown>;
  llm?: { calls?: Partial<LlmCall>[] } | null;
  prompt?: { systemPromptChars?: number | null } | null;
}

/** Projection for reading LatencyTurn rows from Mongo. */
export const LATENCY_PROJECTION = {
  _id: 0,
  createdAt: 1,
  release: 1,
  auth: 1,
  route: 1,
  outcome: 1,
  "intent.primary_intent": 1,
  "intent.task": 1,
  "research.rounds": 1,
  "research.budgetExceeded": 1,
  "research.toolCalls.tool": 1,
  "research.toolCalls.ms": 1,
  "stream.firstTokenMs": 1,
  timings: 1,
  "meta.route.mode": 1,
  "meta.deepThink": 1,
  "meta.shortFirst": 1,
  "meta.distress": 1,
  "meta.researchRounds": 1,
  "meta.evidenceCount": 1,
  "meta.contextChunkCount": 1,
  "meta.budgetExceeded": 1,
  "meta.researchSkipped": 1,
  "llm.calls.role": 1,
  "llm.calls.ok": 1,
  "llm.calls.ms": 1,
  "llm.calls.inputTokens": 1,
  "llm.calls.outputTokens": 1,
  "llm.calls.cachedInputTokens": 1,
  "llm.calls.reasoningTokens": 1,
  "prompt.systemPromptChars": 1,
} as const satisfies Partial<Record<keyof ChatTurnDoc | `${string}.${string}` | "_id", 0 | 1>>;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One turn's time split into stages (ms); null where the turn did not record what the stage needs. */
export interface TurnBreakdown {
  totalMs: number | null;
  classifyMs: number | null;
  /** Research round 0 (deterministic searches in parallel). */
  round0Ms: number | null;
  /** Model-driven research rounds this turn ran. */
  rounds: number;
  /** Sum of the research model calls' ms (the rounds' planning time), failed ones included. */
  researchModelMs: number;
  /** Of that, the ms of research calls that failed (timed out, aborted at the budget, provider error): time spent for nothing. */
  researchFailedMs: number;
  /** The research budget ran out (a round was cut or not started). */
  budgetExceeded: boolean;
  /** Research time outside round 0 and the model calls: the rounds' tool calls, CRM/Workspace resolution, helplines. */
  researchOtherMs: number | null;
  researchMs: number | null;
  /** Request start to the first streamed answer token. */
  firstTokenMs: number | null;
  /** First token minus classify and research: the answer's prefill plus request overhead before the graph. */
  answerWaitMs: number | null;
  /** Outside the graph: total minus classify, research and generate (session load before, persistence after). */
  overheadMs: number | null;
  generateMs: number | null;
  /** The successful answer call's input and output tokens. */
  answerInputTokens: number | null;
  answerOutputTokens: number | null;
  /** Output tokens per second while streaming (first token to end of the answer call). */
  answerTokPerSec: number | null;
  /** Each research model call's ms, in call order. */
  researchCallMs: number[];
  researchCallInput: number[];
  researchCallOutput: number[];
  systemPromptChars: number | null;
}

export function turnBreakdown(t: LatencyTurn): TurnBreakdown {
  const tm = t.timings ?? {};
  const calls = t.llm?.calls ?? [];
  const research = calls.filter((c) => c.role === "research");
  const answer = [...calls].reverse().find((c) => c.role === "answer" && c.ok) ?? calls.filter((c) => c.role === "answer").at(-1);
  const classifyMs = isNum(tm.classifyMs) ? tm.classifyMs : null;
  const round0Ms = isNum(tm.retrieveMs) ? tm.retrieveMs : null;
  const researchMs = isNum(tm.researchMs) ? tm.researchMs : null;
  const researchModelMs = research.reduce((n, c) => n + (isNum(c.ms) ? c.ms : 0), 0);
  const firstTokenMs = isNum(t.stream?.firstTokenMs) ? t.stream.firstTokenMs : null;
  const generateMs = isNum(tm.generateMs) ? tm.generateMs : null;
  const answerWaitMs = firstTokenMs !== null ? Math.max(0, firstTokenMs - (classifyMs ?? 0) - (researchMs ?? 0)) : null;
  const out = isNum(answer?.outputTokens) ? answer.outputTokens : null;
  // Streaming time ≈ the answer call's ms minus its own wait for the first token (part of answerWaitMs).
  const streamMs = isNum(answer?.ms) && answerWaitMs !== null ? answer.ms - Math.min(answer.ms, answerWaitMs) : null;
  return {
    totalMs: isNum(tm.totalMs) ? tm.totalMs : null,
    classifyMs,
    round0Ms,
    rounds: isNum(t.research?.rounds) ? t.research.rounds : isNum(t.meta?.researchRounds) ? (t.meta.researchRounds as number) : 0,
    researchModelMs,
    researchFailedMs: research.filter((c) => c.ok === false).reduce((n, c) => n + (isNum(c.ms) ? c.ms : 0), 0),
    budgetExceeded: Boolean(t.research?.budgetExceeded ?? t.meta?.budgetExceeded),
    // A comparison fan-out runs its branches concurrently, so the sum can exceed the wall clock: clamped at 0.
    researchOtherMs: researchMs !== null ? Math.max(0, researchMs - (round0Ms ?? 0) - researchModelMs) : null,
    researchMs,
    firstTokenMs,
    answerWaitMs,
    overheadMs: isNum(tm.totalMs) && classifyMs !== null && generateMs !== null ? Math.max(0, tm.totalMs - classifyMs - (researchMs ?? 0) - generateMs) : null,
    generateMs,
    answerInputTokens: isNum(answer?.inputTokens) ? answer.inputTokens : null,
    answerOutputTokens: out,
    answerTokPerSec: out !== null && streamMs !== null && streamMs > 500 ? out / (streamMs / 1000) : null,
    researchCallMs: research.map((c) => c.ms).filter(isNum),
    researchCallInput: research.map((c) => c.inputTokens).filter(isNum),
    researchCallOutput: research.map((c) => c.outputTokens).filter(isNum),
    systemPromptChars: isNum(t.prompt?.systemPromptChars) ? t.prompt.systemPromptChars : null,
  };
}

/** Where a turn ran: a deployed release (SHA prefix) or a local server, which records none. */
export function sourceOf(t: LatencyTurn): string {
  return t.release ? `release ${t.release.slice(0, 7)}` : "local (no release)";
}

export type Split = "source" | "intent" | "task" | "mode" | "deepThink" | "rounds" | "shortFirst" | "distress";

export const SPLITS: Record<Split, (t: LatencyTurn, b: TurnBreakdown) => string> = {
  source: (t) => sourceOf(t),
  intent: (t) => t.intent?.primary_intent ?? "(none)",
  task: (t) => t.intent?.task ?? "(none)",
  mode: (t) => String((t.meta?.route as { mode?: unknown } | undefined)?.mode ?? (t.timings?.researchMs == null ? "no research" : "(none)")),
  deepThink: (t) => (t.meta?.deepThink ? "deepThink" : "normal"),
  rounds: (_t, b) => (b.researchMs === null ? "no research" : `${b.rounds} model round${b.rounds === 1 ? "" : "s"}`),
  shortFirst: (t) => (t.meta?.shortFirst ? "short-first" : "normal"),
  distress: (t) => (t.meta?.distress ? "distress" : "normal"),
};

export interface Stat {
  n: number;
  p50: number | null;
  p95: number | null;
  mean: number | null;
}

function stat(values: (number | null)[]): Stat {
  const xs = values.filter(isNum);
  return { n: xs.length, p50: percentile(xs, 50), p95: percentile(xs, 95), mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null };
}

export interface GroupRow {
  group: string;
  turns: number;
  total: Stat;
  classify: Stat;
  round0: Stat;
  roundsMean: number | null;
  researchModel: Stat;
  /** Share of researched turns with a failed research call, and those calls' ms. */
  failedShare: number | null;
  researchFailed: Stat;
  budgetShare: number | null;
  researchOther: Stat;
  research: Stat;
  firstToken: Stat;
  answerWait: Stat;
  overhead: Stat;
  generate: Stat;
  answerIn: Stat;
  answerOut: Stat;
  tokPerSec: Stat;
  promptChars: Stat;
}

export function groupRow(group: string, rows: TurnBreakdown[]): GroupRow {
  const researched = rows.filter((b) => b.researchMs !== null);
  return {
    group,
    turns: rows.length,
    total: stat(rows.map((b) => b.totalMs)),
    classify: stat(rows.map((b) => b.classifyMs)),
    round0: stat(rows.map((b) => b.round0Ms)),
    roundsMean: researched.length ? researched.reduce((n, b) => n + b.rounds, 0) / researched.length : null,
    researchModel: stat(researched.map((b) => b.researchModelMs)),
    failedShare: researched.length ? researched.filter((b) => b.researchFailedMs > 0).length / researched.length : null,
    researchFailed: stat(researched.filter((b) => b.researchFailedMs > 0).map((b) => b.researchFailedMs)),
    budgetShare: researched.length ? researched.filter((b) => b.budgetExceeded).length / researched.length : null,
    researchOther: stat(rows.map((b) => b.researchOtherMs)),
    research: stat(rows.map((b) => b.researchMs)),
    firstToken: stat(rows.map((b) => b.firstTokenMs)),
    answerWait: stat(rows.map((b) => b.answerWaitMs)),
    overhead: stat(rows.map((b) => b.overheadMs)),
    generate: stat(rows.map((b) => b.generateMs)),
    answerIn: stat(rows.map((b) => b.answerInputTokens)),
    answerOut: stat(rows.map((b) => b.answerOutputTokens)),
    tokPerSec: stat(rows.map((b) => b.answerTokPerSec)),
    promptChars: stat(rows.map((b) => b.systemPromptChars)),
  };
}

export interface RoundRow {
  /** 1-based index of the research model call within its turn. */
  round: number;
  ms: Stat;
  input: Stat;
  output: Stat;
}

export interface LatencyReport {
  window: ReportWindow;
  overall: GroupRow;
  splits: { split: Split; rows: GroupRow[] }[];
  rounds: RoundRow[];
  /** Mean ms per stage over turns that recorded all of them, and their mean total. */
  stages: { turns: number; overhead: number; classify: number; round0: number; researchModel: number; researchOther: number; answerFirstToken: number; streaming: number; total: number } | null;
  /** Tool calls by tool: count and ms. */
  tools: { tool: string; ms: Stat }[];
}

export function buildLatencyReport(turns: LatencyTurn[], window: ReportWindow, splits: Split[] = Object.keys(SPLITS) as Split[]): LatencyReport {
  const pairs = turns.map((t) => ({ t, b: turnBreakdown(t) }));
  const bySplit = splits.map((split) => {
    const groups = new Map<string, TurnBreakdown[]>();
    for (const { t, b } of pairs) {
      const key = SPLITS[split](t, b);
      const list = groups.get(key);
      if (list) list.push(b);
      else groups.set(key, [b]);
    }
    const rows = [...groups.entries()].map(([g, bs]) => groupRow(g, bs)).sort((a, b) => b.turns - a.turns || a.group.localeCompare(b.group));
    return { split, rows };
  });

  const maxRound = Math.max(0, ...pairs.map(({ b }) => b.researchCallMs.length));
  const rounds: RoundRow[] = Array.from({ length: maxRound }, (_, i) => ({
    round: i + 1,
    ms: stat(pairs.map(({ b }) => b.researchCallMs[i] ?? null)),
    input: stat(pairs.map(({ b }) => b.researchCallInput[i] ?? null)),
    output: stat(pairs.map(({ b }) => b.researchCallOutput[i] ?? null)),
  }));

  // Streamed turns with every timing. The answer's own wait for its first token is the time from
  // research end to the first token minus the overhead outside the graph (taken as all before it).
  const complete = pairs
    .map(({ b }) => b)
    .filter((b) => b.totalMs !== null && b.classifyMs !== null && b.firstTokenMs !== null && b.generateMs !== null && b.overheadMs !== null);
  const m = (f: (b: TurnBreakdown) => number) => (complete.length ? complete.reduce((n, b) => n + f(b), 0) / complete.length : 0);
  const firstTokenOf = (b: TurnBreakdown) => Math.min(b.generateMs!, Math.max(0, b.answerWaitMs! - b.overheadMs!));
  const stages = complete.length
    ? {
        turns: complete.length,
        overhead: m((b) => b.overheadMs!),
        classify: m((b) => b.classifyMs!),
        round0: m((b) => b.round0Ms ?? 0),
        researchModel: m((b) => (b.researchMs !== null ? Math.min(b.researchModelMs, b.researchMs) : 0)),
        researchOther: m((b) => b.researchOtherMs ?? 0),
        answerFirstToken: m(firstTokenOf),
        streaming: m((b) => b.generateMs! - firstTokenOf(b)),
        total: m((b) => b.totalMs!),
      }
    : null;

  const toolMs = new Map<string, number[]>();
  for (const { t } of pairs)
    for (const c of t.research?.toolCalls ?? []) {
      const list = toolMs.get(c.tool) ?? [];
      if (isNum(c.ms)) list.push(c.ms);
      toolMs.set(c.tool, list);
    }
  const tools = [...toolMs.entries()].map(([tool, ms]) => ({ tool, ms: stat(ms) })).sort((a, b) => b.ms.n - a.ms.n);

  return { window, overall: groupRow("all", pairs.map(({ b }) => b)), splits: bySplit, rounds, stages, tools };
}

const NA = "-";
const sec = (n: number | null) => (n === null ? NA : (n / 1000).toFixed(1));
const pair = (s: Stat) => (s.n ? `${sec(s.p50)}/${sec(s.p95)}` : NA);
const int = (n: number | null) => (n === null ? NA : Math.round(n).toLocaleString("en-US"));
const pct = (n: number | null) => (n === null ? NA : `${Math.round(n * 100)}%`);

function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i < 1 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ");
  return [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

function groupTable(rows: GroupRow[]): string {
  return table(
    ["group", "turns", "total", "classify", "round0", "rounds", "res.model", "failed", "failed s", "budget", "res.other", "research", "1st token", "ans wait", "overhead", "generate", "ans in tok", "ans out tok", "tok/s", "prompt chars"],
    rows.map((r) => [
      r.group,
      String(r.turns),
      pair(r.total),
      pair(r.classify),
      pair(r.round0),
      r.roundsMean === null ? NA : r.roundsMean.toFixed(2),
      pair(r.researchModel),
      pct(r.failedShare),
      pair(r.researchFailed),
      pct(r.budgetShare),
      pair(r.researchOther),
      pair(r.research),
      pair(r.firstToken),
      pair(r.answerWait),
      pair(r.overhead),
      pair(r.generate),
      int(r.answerIn.p50),
      int(r.answerOut.p50),
      r.tokPerSec.p50 === null ? NA : r.tokPerSec.p50.toFixed(0),
      int(r.promptChars.p50),
    ]),
  );
}

/** The printed report: seconds as p50/p95, token counts as p50. Never message text or owners. */
export function formatLatencyReport(r: LatencyReport): string {
  const s = r.stages;
  const share = (v: number) => (s && s.total ? `${(v / 1000).toFixed(1)} s (${((v / s.total) * 100).toFixed(0)}%)` : NA);
  return [
    `Edge latency report  ${r.window.from.toISOString()} -> ${r.window.to.toISOString()}  (${r.overall.turns} turns)`,
    "Times are seconds p50/p95. round0 = parallel KB/programmes/official/FX search; res.model = research model calls (sum); res.other = the rest of research",
    "(round tool calls, CRM/Workspace resolution, helplines); 1st token = request start to first answer token; ans wait = 1st token - classify - research",
    "(answer prefill + request overhead); overhead = total - classify - research - generate (outside the graph); token columns are p50 of the answer call.",
    "failed = researched turns with a failed research call (timed out, cut at the budget, provider error), failed s = those calls' time; budget = turns that ran out of research budget.",
    "",
    "Overall",
    groupTable([r.overall]),
    "",
    ...(s
      ? [
          `Mean time per stage (${s.turns} streamed turns with every timing): total ${(s.total / 1000).toFixed(1)} s`,
          `  outside graph       ${share(s.overhead)}`,
          `  classify            ${share(s.classify)}`,
          `  research round 0    ${share(s.round0)}`,
          `  research model      ${share(s.researchModel)}`,
          `  research other      ${share(s.researchOther)}`,
          `  answer first token  ${share(s.answerFirstToken)}`,
          `  answer streaming    ${share(s.streaming)}`,
          "",
        ]
      : []),
    ...r.splits.flatMap(({ split, rows }) => [`By ${split}`, groupTable(rows), ""]),
    "Research model calls by position in the turn",
    table(
      ["call", "n", "ms p50/p95", "in tok p50", "out tok p50"],
      r.rounds.map((x) => [String(x.round), String(x.ms.n), pair(x.ms), int(x.input.p50), int(x.output.p50)]),
    ),
    "",
    "Research tool calls (round 0 searches, helplines and model-chosen tools)",
    table(
      ["tool", "n", "ms p50/p95"],
      r.tools.map((x) => [x.tool, String(x.ms.n), pair(x.ms)]),
    ),
  ].join("\n");
}
