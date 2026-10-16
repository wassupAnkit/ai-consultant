import type { GenerateResult, GenerateRequest } from "../llm/generate";
import type { Logger } from "../observability/logger";

/**
 * The two small model calls that run *after* an answer has been delivered: a conversation
 * title for the sidebar and up to three follow-up questions for the chips under the answer.
 *
 * Both are cosmetic: neither may delay the answer, and neither may fail the turn. That is why
 * they live behind an interface (tests inject a fake), why every failure collapses to a
 * `null`/empty result, and why the route streams them as their own events after `done`.
 */
export interface TurnExtras {
  /** A short title for the conversation, or null when none could be produced. */
  title(input: TitleInput): Promise<string | null>;
  /** Up to `FOLLOW_UPS_MAX` follow-up questions the consultant might ask next. Empty on failure. */
  followUps(input: FollowUpInput): Promise<string[]>;
  /**
   * Guided sessions, in place of `followUps`: step-scoped follow-ups plus the model's view on
   * whether the step is settled. The caller still checks the CRM before suggesting anything.
   * Optional: without it guided turns get ordinary follow-ups and no suggestions.
   */
  guided?(input: GuidedTurnInput): Promise<GuidedTurnResult>;
}

export interface GuidedTurnInput {
  message: string;
  answer: string;
  step: { label: string; goal: string; checklist: string[] };
  /** The student's CRM record as the answer saw it (the evidence text), or null when unreadable. */
  studentFacts: string | null;
  /** Labels of the step's CRM fields that are still empty. */
  missing: string[];
  signal?: AbortSignal;
}

export interface GuidedTurnResult {
  followUps: string[];
  stepComplete: boolean;
  /** Why the step looks settled, for the consultant; null when it does not. */
  reason: string | null;
}

export const GUIDED_REASON_MAX_CHARS = 200;

/** Normalise the model's guided verdict: a sentence or nothing, never a paragraph. */
export function cleanReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let r = raw.replace(/[*_`#]+/g, "").replace(/\s+/g, " ").trim();
  if (!r) return null;
  if (r.length > GUIDED_REASON_MAX_CHARS) r = r.slice(0, GUIDED_REASON_MAX_CHARS).replace(/\s+\S*$/, "") + "…";
  return r;
}

export interface TitleInput {
  message: string;
  answer: string;
  signal?: AbortSignal;
}

export interface FollowUpInput {
  message: string;
  answer: string;
  /** The classified request; helps the model stay on the consultant's task. */
  intent: { primary: string; task: string } | null;
  signal?: AbortSignal;
}

export const TITLE_MAX_CHARS = 80;
export const FOLLOW_UPS_MAX = 3;
export const FOLLOW_UP_MAX_CHARS = 120;

/** The title a session gets the moment its first turn is stored, before the model has named it. */
export function fallbackTitle(message: string): string {
  return message.trim().replace(/\s+/g, " ").slice(0, TITLE_MAX_CHARS);
}

/**
 * Normalise whatever the model returned into a sidebar title, or null when it is unusable.
 * Strips wrapping quotes, markdown emphasis, a leading "Title:" and a trailing full stop —
 * all things a small model adds even when told not to.
 */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let t = raw
    .replace(/\r?\n/g, " ")
    .replace(/^\s*(title\s*:)\s*/i, "")
    .replace(/[*_`#]+/g, "")
    .replace(/^["'“”‘’«»\s]+|["'“”‘’«»\s]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/, "")
    .trim();
  if (!t) return null;
  if (t.length > TITLE_MAX_CHARS) t = t.slice(0, TITLE_MAX_CHARS).replace(/\s+\S*$/, "").trim() || t.slice(0, TITLE_MAX_CHARS);
  if (/^(untitled|new (chat|conversation)|conversation|chat)$/i.test(t)) return null;
  return t;
}

/**
 * Normalise the model's follow-up list: accept `["…"]` or `{items:["…"]}`, drop blanks,
 * duplicates, anything that just restates the question, and anything too long to be a chip.
 * Each survivor is punctuated as a question so the chips read as one set.
 */
export function cleanFollowUps(raw: unknown, ctx: { message: string }): string[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const seen = new Set<string>();
  const question = normalise(ctx.message);
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    let q = item.replace(/[*_`#]+/g, "").replace(/^\s*[-•\d.)]+\s*/, "").replace(/\s+/g, " ").trim();
    if (!q || q.length > FOLLOW_UP_MAX_CHARS) continue;
    if (!/[?？]$/.test(q)) q = q.replace(/[.!]+$/, "") + "?";
    const key = normalise(q);
    if (!key || seen.has(key) || key === question) continue;
    seen.add(key);
    out.push(q);
    if (out.length === FOLLOW_UPS_MAX) break;
  }
  return out;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

const TITLE_SYSTEM = `You name conversations for an internal assistant used by education consultants. Given the consultant's first message and the assistant's answer, return a title of at most six words: sentence case, specific (name the university, country, programme, visa or student topic when one is present), no quotes, no trailing punctuation, in the language of the message. Return JSON: {"title": "..."}.`;

const FOLLOW_UPS_SYSTEM = `You suggest what an education consultant at Expert Education might ask next, after reading the assistant's answer. Return JSON {"items": [...]} with exactly three short questions (under 100 characters each) written in the consultant's voice, in the language of the conversation. Rules: each must build on the answer (a next step, a detail the answer left open, a comparison, a draft to produce); none may be answerable yes/no; none may repeat a question the answer already covered; never invent facts, fees, dates or names that are not in the answer. Prefer questions about the same programme, university, country or task. Universities, cities and programmes are not people: never turn a name like "Edith Cowan University" or "Charles Sturt" into a student, and never mention a student unless the consultant named one.`;

const GUIDED_SYSTEM = `You support an education consultant at Expert Education who is walking one student through their study-abroad journey, one step at a time. You get the current step, the student's CRM facts, the consultant's message and the assistant's answer. Return JSON {"items": [...], "stepComplete": true|false, "reason": "..."}.
items: exactly three short questions (under 100 characters each) in the consultant's voice, in the language of the conversation, that move THIS step forward: what to ask the student, check, compare or draft next. Build on the answer; never invent facts, fees, dates or names; none may be answerable yes/no; none may repeat what the answer already covered.
stepComplete: true only when the decision this step is about has clearly been made for this student in the conversation or the CRM facts (for a destination step: a country is chosen, not merely discussed). When unsure, false. Never true because the consultant merely asked about the step.
reason: when stepComplete is true, one sentence under 140 characters telling the consultant why, naming the facts (e.g. "Australia is chosen and recorded on her deal."); otherwise an empty string.`;

/** Gemini-backed extras over the hand-rolled REST client (JSON-schema output, short timeouts). */
export class GeminiTurnExtras implements TurnExtras {
  constructor(
    private readonly d: {
      gen: { generate(req: GenerateRequest): Promise<GenerateResult> };
      model: string;
      timeoutMs?: number;
      logger?: Logger;
    },
  ) {}

  async title(input: TitleInput): Promise<string | null> {
    try {
      const res = await this.d.gen.generate({
        model: this.d.model,
        system: TITLE_SYSTEM,
        parts: [{ text: `Message:\n${input.message.slice(0, 1_500)}\n\nAnswer:\n${input.answer.slice(0, 1_500)}` }],
        responseSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
        temperature: 0.2,
        maxOutputTokens: 64,
        signal: input.signal,
        timeoutMs: this.d.timeoutMs ?? 6_000,
      });
      return cleanTitle((res.json as { title?: unknown } | undefined)?.title ?? res.text);
    } catch (err) {
      this.d.logger?.warn("session title generation failed", { err: (err as Error).message });
      return null;
    }
  }

  async followUps(input: FollowUpInput): Promise<string[]> {
    try {
      const res = await this.d.gen.generate({
        model: this.d.model,
        system: FOLLOW_UPS_SYSTEM,
        parts: [
          {
            text: `Task: ${input.intent?.task ?? "unknown"} | Topic: ${input.intent?.primary ?? "unknown"}\n\nConsultant asked:\n${input.message.slice(0, 1_500)}\n\nAssistant answered:\n${input.answer.slice(0, 2_500)}`,
          },
        ],
        responseSchema: { type: "object", properties: { items: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 } }, required: ["items"] },
        temperature: 0.4,
        maxOutputTokens: 256,
        signal: input.signal,
        timeoutMs: this.d.timeoutMs ?? 6_000,
      });
      return cleanFollowUps(res.json, { message: input.message });
    } catch (err) {
      this.d.logger?.warn("follow-up suggestions failed", { err: (err as Error).message });
      return [];
    }
  }

  async guided(input: GuidedTurnInput): Promise<GuidedTurnResult> {
    try {
      const res = await this.d.gen.generate({
        model: this.d.model,
        system: GUIDED_SYSTEM,
        parts: [
          {
            text: [
              `Step: ${input.step.label}. Goal: ${input.step.goal}`,
              `What this step covers: ${input.step.checklist.join(" | ")}`,
              `Still empty in the CRM for this step: ${input.missing.join(", ") || "nothing"}`,
              `Student (CRM):\n${(input.studentFacts ?? "not available").slice(0, 1_500)}`,
              `Consultant asked:\n${input.message.slice(0, 1_500)}`,
              `Assistant answered:\n${input.answer.slice(0, 2_500)}`,
            ].join("\n\n"),
          },
        ],
        responseSchema: {
          type: "object",
          properties: { items: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 }, stepComplete: { type: "boolean" }, reason: { type: "string" } },
          required: ["items", "stepComplete", "reason"],
        },
        temperature: 0.3,
        maxOutputTokens: 320,
        signal: input.signal,
        timeoutMs: this.d.timeoutMs ?? 6_000,
      });
      const json = (res.json ?? {}) as { items?: unknown; stepComplete?: unknown; reason?: unknown };
      const stepComplete = json.stepComplete === true;
      return { followUps: cleanFollowUps(json.items, { message: input.message }), stepComplete, reason: stepComplete ? cleanReason(json.reason) : null };
    } catch (err) {
      this.d.logger?.warn("guided follow-ups failed", { err: (err as Error).message });
      return { followUps: [], stepComplete: false, reason: null };
    }
  }
}
