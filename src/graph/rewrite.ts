import type { ClassifierExtras, Intent } from "../schemas/intent.schema";

/**
 * Rewrites of the previous answer ("make it shorter for the parent", "same in Bangla"). In the
 * South Asia counsellor audit (Oct 2026) such turns invented figures (NPR 35 lakh against the
 * previous answer's 61–75 lakh) and a false IELTS rule, and a Bangla rewrite contradicted the
 * previous turn. A rewrite turn gets a per-turn rule (`REWRITE_INSTRUCTION`) and the previous
 * answer in full (`PRIOR_ANSWER_MAX_CHARS`) rather than the history window's 3,000-character cut.
 */

/** How much of the previous assistant answer a rewrite turn sees (the history window keeps 3,000). */
export const PRIOR_ANSWER_MAX_CHARS = 12_000;

/** Tasks that rework existing text when the turn refers back to it. */
const REWORK_TASKS = new Set<Intent["task"]>(["translate", "summarize", "draft"]);

const LANGUAGES = "nepali|hindi|bangla|bengali|urdu|punjabi|gujarati|vietnamese|thai|tagalog|filipino|sinhala|sinhalese|tamil|english";
/**
 * Phrasings that rework what was just said: shorten, simplify, rephrase, translate, re-address it
 * to a parent, turn it into another format. Deliberately about the previous text ("it", "this",
 * "that"), so a new drafting request about a fresh topic is not caught by the format words alone.
 */
const REWRITE_CUE = new RegExp(
  [
    String.raw`\b(?:shorter|shorten|condense|simplif(?:y|ied)|simpler|plainer|rephrase|re-?word|paraphrase|rewrite|re-?write|tl;?dr)\b`,
    String.raw`\btranslat(?:e|ion)\b`,
    String.raw`\b(?:same|it|this|that|now)\s+(?:thing\s+|message\s+|answer\s+)?in\s+(?:${LANGUAGES})\b`,
    String.raw`\b(?:make|write|turn|put|send|explain)\s+(?:it|this|that|the\s+above)\b`,
    String.raw`\b(?:it|this|that)\s+for\s+(?:the|his|her|their)\s+(?:parents?|father|mother|dad|mum|mom|family|guardian)\b`,
    String.raw`\bfor\s+(?:the|his|her|their)\s+(?:parents?|father|mother|dad|mum|mom|family|guardian)\b.*\b(?:shorter|simpler|version|summary)\b`,
  ].join("|"),
  "i",
);

/**
 * Whether this turn reworks the previous answer: a rewrite phrasing, or a translate / summarize /
 * draft task the classifier says refers back. Never without a previous answer to rework.
 */
export function isRewriteOfPrevious(args: {
  intent: Pick<Intent, "task">;
  extras: Pick<ClassifierExtras, "references_prior_turn"> | null;
  input: string;
  hasPriorAnswer: boolean;
}): boolean {
  if (!args.hasPriorAnswer) return false;
  if (REWRITE_CUE.test(args.input)) return true;
  return REWORK_TASKS.has(args.intent.task) && Boolean(args.extras?.references_prior_turn);
}

/**
 * Appended to the end of the answer's system prompt on a rewrite turn: after the per-turn request
 * and evidence, so the cached prefix is untouched.
 */
export const REWRITE_INSTRUCTION = `# This turn reworks your previous answer
The consultant is asking you to shorten, simplify, translate, re-address or reformat your previous answer (the last assistant message above). Use ONLY the facts and figures in that previous answer and in this turn's excerpts. Keep every figure, currency, unit, period, date, name and requirement exactly as it appears there (NPR 61–75 lakh stays NPR 61–75 lakh; a per-fortnight limit stays per fortnight). Never add a new figure, requirement, rule or claim. If something is not in the previous answer or the excerpts, leave it out rather than fill it in.`;
