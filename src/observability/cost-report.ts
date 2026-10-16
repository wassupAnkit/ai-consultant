import type { ChatTurnDoc, LlmCall, LlmSummary } from "../db/mongo";

/**
 * The pure half of `bun run cost:report`: per-day, per-role LLM cost and prompt-cache figures and
 * the knowledge-only exact-repeat rate, over `chat_turns` rows. The CLI (scripts/cost-report.ts)
 * only reads the rows and prints `formatCostReport`.
 *
 * Token semantics follow OpenAI-compatible usage as LangChain records it: `inputTokens` INCLUDES
 * `cachedInputTokens` and `outputTokens` INCLUDES `reasoningTokens`, so the cache-hit rate is
 * cached / input. Rows written before cache, reasoning and cost were recorded lack those fields;
 * they report n/a rather than 0.
 *
 * Nothing here returns or prints message text: messages are only normalised into in-memory keys.
 */

/** The `chat_turns` fields the report reads (the script projects only these). */
export interface ReportTurn {
  createdAt: Date;
  ownerId: string;
  userMessage: string;
  intent?: { primary_intent?: string } | null;
  chunks?: { kind?: string }[];
  sources?: { kind?: string }[];
  research?: { toolCalls?: { tool: string }[] } | null;
  meta?: Record<string, unknown>;
  timings?: { totalMs?: number | null } | null;
  llm?: (Partial<Omit<LlmSummary, "calls">> & { calls?: LlmCall[] }) | null;
}

/** Projection for reading ReportTurn rows from Mongo. */
export const REPORT_PROJECTION = {
  _id: 0,
  createdAt: 1,
  ownerId: 1,
  userMessage: 1,
  "intent.primary_intent": 1,
  "chunks.kind": 1,
  "sources.kind": 1,
  "research.toolCalls.tool": 1,
  "meta.guide": 1,
  "meta.jevCost": 1,
  "meta.classifier": 1,
  "timings.totalMs": 1,
  llm: 1,
} as const satisfies Partial<Record<keyof ChatTurnDoc | `${string}.${string}` | "_id", 0 | 1>>;

export interface ReportWindow {
  from: Date;
  to: Date;
}

const DAY_MS = 86_400_000;

/** `--days N` back from now (default 7), or `--from` / `--to` (ISO dates); `--to` alone counts `--days` back from it. */
export function parseWindow(args: { days?: string; from?: string; to?: string }, now = new Date()): ReportWindow {
  const days = args.days === undefined ? 7 : Number(args.days);
  if (!Number.isFinite(days) || days <= 0) throw new Error(`--days must be a positive number, got ${args.days}`);
  const date = (s: string) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${s}`);
    return d;
  };
  const to = args.to ? date(args.to) : now;
  const from = args.from ? date(args.from) : new Date(to.getTime() - days * DAY_MS);
  if (from.getTime() >= to.getTime()) throw new Error("--from must be before --to");
  return { from, to };
}

/** Lowercase, punctuation and symbols dropped, whitespace collapsed: "What's the IELTS?" and "whats the ielts" are one question. */
export function normalizeMessage(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nearest-rank percentile (p in 0–100); null for no values. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1]!;
}

/** Evidence kinds that are a consultant's own data: an answer built on them cannot be reused for anyone else. */
const PERSONAL_KINDS = new Set(["crm", "gmail", "drive", "calendar", "docs"]);
const PERSONAL_TOOL = /^(crm|gmail|drive|calendar|docs)_/;

/**
 * A turn answered from shared knowledge only (knowledge base, programmes, web): no CRM or Google
 * Workspace evidence or tool call, not a guided session (those read the student from the CRM), and
 * not a caseload question. These are the turns an answer cache could serve.
 */
export function isKnowledgeOnly(t: ReportTurn): boolean {
  if (!normalizeMessage(t.userMessage ?? "")) return false;
  if (t.intent?.primary_intent === "caseload_management") return false;
  if (t.meta?.guide) return false;
  if ([...(t.chunks ?? []), ...(t.sources ?? [])].some((c) => c.kind && PERSONAL_KINDS.has(c.kind))) return false;
  if ((t.research?.toolCalls ?? []).some((c) => PERSONAL_TOOL.test(c.tool))) return false;
  return true;
}

export interface RepeatRate {
  knowledgeTurns: number;
  /** Knowledge-only turns whose normalised message an earlier knowledge-only turn in the window already asked. */
  repeats: number;
  /** Of those, the ones an earlier turn from a different owner asked (the share a cross-user cache could serve). */
  crossOwnerRepeats: number;
  rate: number | null;
  crossOwnerRate: number | null;
}

export function repeatRate(turns: ReportTurn[]): RepeatRate {
  const seen = new Map<string, Set<string>>(); // normalised message -> owners who asked it
  let knowledgeTurns = 0;
  let repeats = 0;
  let crossOwnerRepeats = 0;
  for (const t of byTime(turns)) {
    if (!isKnowledgeOnly(t)) continue;
    knowledgeTurns++;
    const key = normalizeMessage(t.userMessage);
    const owners = seen.get(key);
    if (owners) {
      repeats++;
      if ([...owners].some((o) => o !== t.ownerId)) crossOwnerRepeats++;
      owners.add(t.ownerId);
    } else seen.set(key, new Set([t.ownerId]));
  }
  return {
    knowledgeTurns,
    repeats,
    crossOwnerRepeats,
    rate: knowledgeTurns ? repeats / knowledgeTurns : null,
    crossOwnerRate: knowledgeTurns ? crossOwnerRepeats / knowledgeTurns : null,
  };
}

export interface RoleRow {
  day: string;
  /** classifier | research | answer from llm.calls[].role, plus "jev" for the Jev classifier (which is not among the calls). */
  role: string;
  calls: number;
  avgInput: number | null;
  avgCached: number | null;
  /** cached / input over calls that recorded both; null when none did. */
  cacheHitRate: number | null;
  avgReasoning: number | null;
  avgOutput: number | null;
  costPerCall: number | null;
  /** Calls that carried a cost (the denominator of costPerCall). */
  costedCalls: number;
}

/** Day key (UTC). */
const dayOf = (d: Date) => new Date(d).toISOString().slice(0, 10);
const byTime = (turns: ReportTurn[]) => [...turns].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function jevCost(t: ReportTurn): number | null {
  if (isNum(t.llm?.jevCostUsd)) return t.llm.jevCostUsd;
  return isNum(t.meta?.jevCost) ? t.meta.jevCost : null;
}

function roleRow(day: string, role: string, calls: Partial<LlmCall>[]): RoleRow {
  const field = (k: "inputTokens" | "cachedInputTokens" | "reasoningTokens" | "outputTokens" | "costUsd") => calls.map((c) => c[k]).filter(isNum);
  const withCache = calls.filter((c) => isNum(c.inputTokens) && isNum(c.cachedInputTokens));
  const cacheInput = total(withCache.map((c) => c.inputTokens!));
  const costs = field("costUsd");
  return {
    day,
    role,
    calls: calls.length,
    avgInput: mean(field("inputTokens")),
    avgCached: mean(field("cachedInputTokens")),
    cacheHitRate: cacheInput > 0 ? total(withCache.map((c) => c.cachedInputTokens!)) / cacheInput : null,
    avgReasoning: mean(field("reasoningTokens")),
    avgOutput: mean(field("outputTokens")),
    costPerCall: mean(costs),
    costedCalls: costs.length,
  };
}

/** Per day (or "all" with `allDays`) and role; days ascending, roles by name. */
export function roleStats(turns: ReportTurn[], opts: { allDays?: boolean } = {}): RoleRow[] {
  const groups = new Map<string, Partial<LlmCall>[]>();
  const add = (day: string, role: string, call: Partial<LlmCall>) => {
    const key = `${day}\u0000${role}`;
    const list = groups.get(key);
    if (list) list.push(call);
    else groups.set(key, [call]);
  };
  for (const t of turns) {
    const day = opts.allDays ? "all" : dayOf(t.createdAt);
    for (const c of t.llm?.calls ?? []) add(day, c.role, c);
    const jev = jevCost(t);
    if (jev !== null || t.meta?.classifier === "jev") add(day, "jev", jev === null ? {} : { costUsd: jev });
  }
  return [...groups.entries()]
    .map(([key, calls]) => {
      const [day, role] = key.split("\u0000") as [string, string];
      return roleRow(day, role, calls);
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.role.localeCompare(b.role));
}

export interface DayRow {
  day: string;
  turns: number;
  /** Turns that recorded a cost (llm.costUsd); older turns did not. */
  costedTurns: number;
  costPerTurn: number | null;
  totalCostUsd: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
}

function dayRow(day: string, turns: ReportTurn[]): DayRow {
  const costs = turns.map((t) => t.llm?.costUsd).filter(isNum);
  const ms = turns.map((t) => t.timings?.totalMs).filter(isNum);
  return {
    day,
    turns: turns.length,
    costedTurns: costs.length,
    costPerTurn: mean(costs),
    totalCostUsd: costs.length ? total(costs) : null,
    p50Ms: percentile(ms, 50),
    p95Ms: percentile(ms, 95),
  };
}

export interface CostReport {
  window: ReportWindow;
  roles: RoleRow[];
  roleTotals: RoleRow[];
  days: DayRow[];
  total: DayRow;
  repeat: RepeatRate;
}

export function buildCostReport(turns: ReportTurn[], window: ReportWindow): CostReport {
  const byDay = new Map<string, ReportTurn[]>();
  for (const t of byTime(turns)) {
    const d = dayOf(t.createdAt);
    const list = byDay.get(d);
    if (list) list.push(t);
    else byDay.set(d, [t]);
  }
  return {
    window,
    roles: roleStats(turns),
    roleTotals: roleStats(turns, { allDays: true }),
    days: [...byDay.entries()].map(([d, ts]) => dayRow(d, ts)),
    total: dayRow("all", turns),
    repeat: repeatRate(turns),
  };
}

const NA = "n/a";
const int = (n: number | null) => (n === null ? NA : Math.round(n).toLocaleString("en-US"));
const pct = (n: number | null) => (n === null ? NA : `${(n * 100).toFixed(1)}%`);
const usd = (n: number | null) => (n === null ? NA : `$${n.toFixed(6)}`);

function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i < 2 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ");
  return [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

/** The printed report: counts, averages, rates and money only — never message text or owners. */
export function formatCostReport(r: CostReport): string {
  const roleTable = (rows: RoleRow[]) =>
    table(
      ["day", "role", "calls", "avg in", "avg cached", "cache hit", "avg reasoning", "avg out", "$/call", "costed"],
      rows.map((x) => [x.day, x.role, String(x.calls), int(x.avgInput), int(x.avgCached), pct(x.cacheHitRate), int(x.avgReasoning), int(x.avgOutput), usd(x.costPerCall), String(x.costedCalls)]),
    );
  const dayTable = table(
    ["day", "turns", "costed", "$/turn", "$ total", "p50 ms", "p95 ms"],
    [...r.days, r.total].map((d) => [d.day, String(d.turns), String(d.costedTurns), usd(d.costPerTurn), usd(d.totalCostUsd), int(d.p50Ms), int(d.p95Ms)]),
  );
  const rp = r.repeat;
  return [
    `Edge LLM cost report  ${r.window.from.toISOString()} -> ${r.window.to.toISOString()}  (days in UTC; ${r.total.turns} turns)`,
    "Input includes cached tokens and output includes reasoning tokens; cache hit = cached / input. n/a = not recorded (turns from before these fields existed).",
    "",
    "Per call, by day and role",
    roleTable(r.roles),
    "",
    "Per call, whole window",
    roleTable(r.roleTotals),
    "",
    "Per turn",
    dayTable,
    "",
    "Knowledge-only exact repeats (no CRM/Workspace evidence, not guided, not caseload_management)",
    `  knowledge-only turns: ${rp.knowledgeTurns}`,
    `  asked before in window: ${rp.repeats} (${pct(rp.rate)})`,
    `  asked before by a different owner: ${rp.crossOwnerRepeats} (${pct(rp.crossOwnerRate)})`,
  ].join("\n");
}
