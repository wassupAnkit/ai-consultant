import type { Filter } from "mongodb";
import type { ChatTurnDoc } from "../db/mongo";
import { redactPII } from "../safety/sanitize";
import { sha256 } from "./identity";

/**
 * Pure helpers behind `bun run export:dataset`: which turns qualify as
 * training examples and how they are rendered. Kept free of I/O so the
 * selection rules are unit-testable.
 */
export interface ExportFilters {
  since?: Date;
  until?: Date;
  /** Primary intents to keep (empty = all). */
  intents?: string[];
  feedback: "any" | "positive" | "nonnegative";
  includeRefused: boolean;
  includeAborted: boolean;
  includeErrors: boolean;
  includeFallback: boolean;
  includeInjection: boolean;
}

export const DEFAULT_FILTERS: ExportFilters = {
  feedback: "any",
  includeRefused: false,
  includeAborted: false,
  includeErrors: false,
  includeFallback: false,
  includeInjection: false,
};

/** Server-side part of the selection (cheap, indexed). `turnPasses` re-checks everything. */
export function mongoFilter(f: ExportFilters): Filter<ChatTurnDoc> {
  const q: Filter<ChatTurnDoc> = {};
  if (f.since || f.until) q.createdAt = { ...(f.since ? { $gte: f.since } : {}), ...(f.until ? { $lt: f.until } : {}) };
  if (f.intents?.length) q["intent.primary_intent"] = { $in: f.intents };
  const outcomes: ChatTurnDoc["outcome"][] = ["ok"];
  if (f.includeRefused) outcomes.push("refused");
  if (f.includeAborted) outcomes.push("aborted");
  if (f.includeErrors) outcomes.push("error");
  q.outcome = { $in: outcomes };
  if (f.feedback === "positive") q.feedbackScore = { $gt: 0 };
  else if (f.feedback === "nonnegative") q.$or = [{ feedbackScore: null }, { feedbackScore: { $gte: 0 } }];
  return q;
}

export function turnPasses(t: ChatTurnDoc, f: ExportFilters): { ok: true } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  if (f.since && t.createdAt < f.since) return no("before_since");
  if (f.until && t.createdAt >= f.until) return no("after_until");
  if (f.intents?.length && !f.intents.includes(t.intent?.primary_intent ?? "")) return no("intent");
  if (t.outcome === "error" && !f.includeErrors) return no("error");
  if (t.outcome === "aborted" && !f.includeAborted) return no("aborted");
  if ((t.outcome === "refused" || t.refused) && !f.includeRefused) return no("refused");
  if (t.answerIsFallback && !f.includeFallback) return no("fallback_answer");
  if (t.intent?.contextual_flags?.includes("prompt_injection_attempt") && !f.includeInjection) return no("injection");
  if (!t.answer.trim()) return no("empty_answer");
  if (!t.userMessage.trim()) return no("empty_user_message");
  if (f.feedback === "positive" && !(typeof t.feedbackScore === "number" && t.feedbackScore > 0)) return no("feedback_not_positive");
  if (f.feedback === "nonnegative" && typeof t.feedbackScore === "number" && t.feedbackScore < 0) return no("feedback_negative");
  return { ok: true };
}

export interface RenderOptions {
  /** Include the exact compiled system prompt the model saw. */
  system: boolean;
  /** Apply redactPII to every text field. */
  redact: boolean;
  /** Max prior messages to include (0 = none). */
  history: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Non-identifying metadata attached to every exported row. */
export function rowMetadata(t: ChatTurnDoc) {
  return {
    requestId: t.requestId,
    sessionId: t.sessionId,
    turnIndex: t.turnIndex,
    userHash: t.userHash,
    mode: t.mode,
    intent: t.intent?.primary_intent ?? null,
    task: t.intent?.task ?? null,
    destinations: t.intent?.destinations ?? [],
    language: t.intent?.language ?? null,
    feedbackScore: t.feedbackScore,
    answerModel: t.llm?.answerModel ?? null,
    systemPromptHash: t.prompt?.systemPromptHash ?? null,
    sources: (t.sources ?? []).map((s) => s.url),
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
  };
}

/** Prompt side of a turn (system + windowed history + user), without the answer. */
export function promptMessages(t: ChatTurnDoc, o: RenderOptions): ChatMessage[] {
  const r = (s: string) => (o.redact ? redactPII(s) : s);
  const out: ChatMessage[] = [];
  if (o.system && t.prompt?.systemPromptText) out.push({ role: "system", content: r(t.prompt.systemPromptText) });
  const hist = o.history > 0 ? (t.history ?? []).slice(-o.history) : [];
  for (const h of hist) out.push({ role: h.role, content: r(h.content) });
  out.push({ role: "user", content: r(t.userMessage) });
  return out;
}

/** OpenAI-style SFT row: {"messages":[...], "metadata":{...}}. */
export function toSftRecord(t: ChatTurnDoc, o: RenderOptions) {
  const r = (s: string) => (o.redact ? redactPII(s) : s);
  return { messages: [...promptMessages(t, o), { role: "assistant" as const, content: r(t.answer) }], metadata: rowMetadata(t) };
}

/** Gemini / Vertex AI supervised-tuning row. */
export function toGeminiRecord(t: ChatTurnDoc, o: RenderOptions) {
  const msgs = promptMessages(t, o);
  const system = msgs.find((m) => m.role === "system");
  const r = (s: string) => (o.redact ? redactPII(s) : s);
  const contents = msgs
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] }));
  contents.push({ role: "model", parts: [{ text: r(t.answer) }] });
  return { ...(system ? { systemInstruction: { parts: [{ text: system.content }] } } : {}), contents };
}

export interface DpoPair {
  prompt: ChatMessage[];
  chosen: ChatMessage[];
  rejected: ChatMessage[];
  metadata: ReturnType<typeof rowMetadata> & { rejectedRequestId: string; chosenScore: number | null; rejectedScore: number };
}

/** Key identifying "the same question in the same conversation state" (regenerations share it). */
export function promptKey(t: ChatTurnDoc): string {
  return `${t.sessionId}:${sha256(JSON.stringify(t.history ?? []) + " " + t.userMessage)}`;
}

/**
 * Preference pairs: within one prompt key, every negatively-rated answer is
 * paired with the best non-negative answer. Opportunistic: it only yields
 * rows where users regenerated and rated.
 */
export function buildDpoPairs(turns: ChatTurnDoc[], o: RenderOptions): DpoPair[] {
  const groups = new Map<string, ChatTurnDoc[]>();
  for (const t of turns) {
    const k = promptKey(t);
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }
  const r = (s: string) => (o.redact ? redactPII(s) : s);
  const pairs: DpoPair[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const rejected = g.filter((t) => typeof t.feedbackScore === "number" && t.feedbackScore < 0);
    const candidates = g.filter((t) => t.feedbackScore === null || t.feedbackScore === undefined || t.feedbackScore >= 0);
    if (!rejected.length || !candidates.length) continue;
    const chosen = [...candidates].sort((a, b) => (b.feedbackScore ?? 0) - (a.feedbackScore ?? 0))[0]!;
    for (const bad of rejected) {
      if (bad.answer === chosen.answer) continue;
      pairs.push({
        prompt: promptMessages(chosen, o),
        chosen: [{ role: "assistant", content: r(chosen.answer) }],
        rejected: [{ role: "assistant", content: r(bad.answer) }],
        metadata: { ...rowMetadata(chosen), rejectedRequestId: bad.requestId, chosenScore: chosen.feedbackScore, rejectedScore: bad.feedbackScore as number },
      });
    }
  }
  return pairs;
}
