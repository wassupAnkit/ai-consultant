/**
 * Degenerate-output detection for the streamed answer. A model can fall into a loop and keep
 * emitting until its token limit: a Bangla draft to a parent ended in ~12 KB of runaway citation
 * numbers ("[1]…[2223", South Asia counsellor audit, Oct 2026). The answer node checks the text
 * after every chunk, stops the stream on the first hit and keeps only what came before the loop.
 */

/** Hard cap on an answer's length; no real answer (drafts included) comes near it. */
export const ANSWER_MAX_CHARS = 12_000;
/** More consecutive citation markers than any honest sentence carries. */
const MAX_CITATION_RUN = 40;
/** A unit this long or shorter repeated MIN_REPEATS times over MIN_REPEAT_SPAN characters is a loop. */
const MAX_UNIT = 60;
const MIN_REPEATS = 20;
const MIN_REPEAT_SPAN = 200;
/** Only the tail is examined: a loop is always at the end of what has streamed so far. */
const TAIL = 4_000;

/** More than MAX_CITATION_RUN markers in a row at the end, with an unfinished one allowed ("[22"). */
const CITATION_RUN = new RegExp(`(?:[\\s,;]*\\[\\d{1,5}\\]){${MAX_CITATION_RUN + 1},}[\\s,;]*(?:\\[\\d{0,5})?$`);

export type RunawayReason = "citation_run" | "repetition" | "max_chars";

/** Where a degenerate tail starts (`keep` is everything before it, trimmed), or null for normal text. */
export function runawayCut(text: string): { keep: string; reason: RunawayReason } | null {
  if (!text) return null;
  const offset = Math.max(0, text.length - TAIL);
  const tail = text.slice(offset);

  const run = CITATION_RUN.exec(tail);
  if (run) return { keep: text.slice(0, offset + run.index).trimEnd(), reason: "citation_run" };

  const loop = repeatedTail(tail);
  if (loop !== null) return { keep: text.slice(0, offset + loop).trimEnd(), reason: "repetition" };

  if (text.length > ANSWER_MAX_CHARS) return { keep: cutAtBoundary(text.slice(0, ANSWER_MAX_CHARS)), reason: "max_chars" };
  return null;
}

/**
 * The end of the first copy when the tail is one short unit repeated (period detection, so a
 * chunk boundary mid-unit still counts), else null. The shortest period wins.
 */
function repeatedTail(tail: string): number | null {
  for (let unit = 1; unit <= MAX_UNIT; unit++) {
    let same = 0;
    for (let j = tail.length - 1; j - unit >= 0 && tail[j] === tail[j - unit]; j--) same++;
    const span = same + unit;
    if (span >= MIN_REPEAT_SPAN && span >= unit * MIN_REPEATS) return tail.length - same;
  }
  return null;
}

/** `text` cut back to its last paragraph, else sentence, boundary in the second half; else as is. */
function cutAtBoundary(text: string): string {
  const half = text.length / 2;
  const para = text.lastIndexOf("\n\n");
  if (para > half) return text.slice(0, para).trimEnd();
  const sentence = Math.max(text.lastIndexOf(". "), text.lastIndexOf(".\n"), text.lastIndexOf("। "));
  if (sentence > half) return text.slice(0, sentence + 1).trimEnd();
  return text.trimEnd();
}
