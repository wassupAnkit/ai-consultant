import type { Intent } from "../schemas/intent.schema";

/**
 * Short-first answers (counsellor audit N21, Oct 2026): WhatsApp-length questions got answers of
 * several thousand characters that a counsellor had to cut down before replying. A short question
 * that does not ask for detail gets a per-turn rule, appended after the evidence (outside the cached
 * prompt prefix): the answer in 3–6 lines, then "More detail:" only if needed.
 */

/** At most this many words is a short, WhatsApp-style question. */
export const SHORT_QUESTION_MAX_WORDS = 25;
/** And at most this many characters, for scripts written without spaces (Thai). */
const SHORT_QUESTION_MAX_CHARS = 220;

/** Wording that asks for the long version. */
const DETAIL_CUE =
  /\b(?:detail(?:ed|s)?|in full|(?:full|complete) (?:answer|details?|list|explanation|breakdown|picture|guide|process|overview)|in[- ]depth|everything|comprehensive|thorough(?:ly)?|step[- ]by[- ]step|elaborate|exhaustive|all (?:the )?(?:details|requirements|steps|documents|options))\b/i;

/** Tasks whose length is set by the text they produce or the line items they must show (rule 6b). */
const OWN_LENGTH_TASKS = new Set<Intent["task"]>(["draft", "translate", "summarize", "review", "calculate"]);

/** A short question that does not ask for detail. */
export function isShortQuestion(input: string): boolean {
  const text = input.trim();
  if (!text || text.length > SHORT_QUESTION_MAX_CHARS) return false;
  return text.split(/\s+/).length <= SHORT_QUESTION_MAX_WORDS && !DETAIL_CUE.test(text);
}

/** Whether this turn's answer should be short-first: a short question that asks Edge to answer, not to produce or rework text. */
export function wantsShortFirst(args: { intent: Pick<Intent, "task">; input: string; rewrite: boolean }): boolean {
  return !args.rewrite && !OWN_LENGTH_TASKS.has(args.intent.task) && isShortQuestion(args.input);
}

/** Appended to the end of the answer's system prompt on a short-question turn. */
export const SHORT_FIRST_INSTRUCTION = `# This is a short question: answer short-first
The consultant asked a short, chat-style question. Give the answer first in 3–6 lines: the direct answer and the key figures, each cited. Add more only if they need it to act, after a line "More detail:", in short sections. Keep the whole answer under about 1,800 characters unless they asked for detail.`;
