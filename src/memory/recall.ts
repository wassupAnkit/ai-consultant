import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { PRIOR_ANSWER_MAX_CHARS } from "../graph/rewrite";
import type { Source } from "../retrieval/format";
import type { RetrievedChunk } from "../retrieval/store";
import { isFollowUp } from "../routing/route";
import type { ClassifierExtras } from "../schemas/intent.schema";
import type { EvidenceItem } from "../tools/types";
import type { StoredMessage } from "./store";

/**
 * Recall of earlier answers on a turn that refers back to them (counsellor audit N16/M10, Oct
 * 2026). The history window cuts each message at 3,000 characters, so a fee or figure quoted near
 * the end of a long answer was gone two turns later, and Edge said "Not in the knowledge base" for
 * something it had itself cited. A turn that refers back sees the last `RECALL_ANSWERS` answers
 * uncut, and the previous turn's cited sources join its evidence, marked as earlier.
 */

/** How many of the most recent assistant answers a referring-back turn sees uncut. */
export const RECALL_ANSWERS = 2;
/** At most this many earlier sources are carried into a turn's evidence. */
export const RECALL_SOURCES_MAX = 8;
/** Appended to the title of a source carried over from the previous turn. */
export const EARLIER_MARK = "(from earlier in this conversation)";

/** Words that point at something already said: "you said", "earlier", "that", a person pronoun. */
const REFER_BACK =
  /\b(?:you\s+(?:said|mentioned|quoted|told|gave|wrote|listed|cited)|earlier|above|previous(?:ly)?|last\s+(?:answer|message|reply|time)|that|those|these|she|he|her|hers|him|his|they|them|their)\b/i;

/** Whether this message refers back to an earlier turn: a cue word, a follow-up opening (`isFollowUp`), or Jev's flag. */
export function refersBack(input: string, extras: Pick<ClassifierExtras, "references_prior_turn"> | null): boolean {
  return Boolean(extras?.references_prior_turn) || REFER_BACK.test(input) || isFollowUp(input);
}

/** The last `n` assistant answers, oldest first, each capped at `maxChars`. */
export function priorAnswersOf(messages: readonly StoredMessage[], n = RECALL_ANSWERS, maxChars = PRIOR_ANSWER_MAX_CHARS): string[] {
  return messages
    .filter((m) => m.role === "ai")
    .slice(-n)
    .map((m) => m.content.slice(0, maxChars));
}

const isSource = (s: unknown): s is Source => {
  const o = s as Partial<Source> | null;
  return Boolean(o && typeof o === "object" && typeof o.n === "number" && typeof o.url === "string" && typeof o.title === "string" && typeof o.excerpt === "string" && o.excerpt.trim());
};

/** The sources the most recent stored answer cited (`metadata.sources`), or none. */
export function priorSourcesOf(messages: readonly StoredMessage[]): Source[] {
  const last = messages.findLast((m) => m.role === "ai");
  const sources = last?.metadata?.sources;
  return Array.isArray(sources) ? sources.filter(isSource) : [];
}

/**
 * `history` with its last assistant messages replaced by the uncut answers (oldest first, as
 * `priorAnswersOf` returns them), matched from the end.
 */
export function withFullAnswers(history: BaseMessage[], answers: readonly string[]): BaseMessage[] {
  const out = [...history];
  let a = answers.length - 1;
  for (let i = out.length - 1; i >= 0 && a >= 0; i--) {
    if (out[i]!.getType() === "ai") out[i] = new AIMessage(answers[a--]!);
  }
  return out;
}

/**
 * The turn's evidence with the previous turn's sources appended, each marked `EARLIER_MARK` and
 * numbered after the last item: those this turn already has (same URL) are skipped, and CRM
 * records never carry over (a student's record is re-read, never taken from an earlier turn).
 */
export function withEarlierSources<T extends RetrievedChunk>(items: T[], earlier: readonly Source[]): (T | EvidenceItem)[] {
  const have = new Set(items.map((i) => i.url));
  const carried = earlier.filter((s) => s.kind !== "crm" && s.source !== "crm" && !have.has(s.url)).slice(0, RECALL_SOURCES_MAX);
  if (!carried.length) return items;
  const last = items.reduce((m, i, idx) => Math.max(m, (i as Partial<EvidenceItem>).n ?? idx + 1), 0);
  return [
    ...items,
    ...carried.map(
      (s, k): EvidenceItem => ({
        id: `earlier:${s.url}`,
        url: s.url,
        ...(s.webUrl ? { webUrl: s.webUrl } : {}),
        title: `${s.title} ${EARLIER_MARK}`,
        section: s.section ?? "",
        docType: s.docType ?? "",
        country: s.country ?? null,
        source: s.source,
        content: s.excerpt,
        score: 0,
        matchedBy: [],
        n: last + k + 1,
        kind: s.kind ?? "kb",
        live: false,
      }),
    ),
  ];
}
