import type { CrmContactMatch, EvidenceItem } from "../tools/types";

/**
 * Deterministic clean-up of, and checks on, the answer text after generation (counsellor audit, Oct 2026).
 */

/**
 * A "Based on" line: "Based on:" with anything after it, or "Based on" followed only by citation
 * markers ("Based on [1][3]"), in any Markdown dress (bold, italics, a quote or a bullet). A
 * sentence that merely starts "Based on the 2026 schedule, …" is not one.
 */
const BASED_ON_LINE = /^[ \t>*_-]*Based on(?:[*_]*[ \t]*:.*|(?:[ \t]*[,;&]?[ \t]*(?:and[ \t]+)?\[\d{1,3}\])+[ \t.*_]*)$\n?/gim;

/**
 * The answer without "Based on" lines (N7: they cited a block of excerpts for a whole answer
 * instead of one supporting [n] per item). A draft's source line for the counsellor is "Sources:".
 */
export function dropBasedOnLines(answer: string): string {
  const out = answer.replace(BASED_ON_LINE, "");
  return out === answer ? answer : out.replace(/\n{3,}/g, "\n\n").trim();
}

/** The answer says the name matched several people, or asks which one is meant. */
const MENTIONS_SEVERAL =
  /\b(?:several|multiple|more than one|two|three|four|five|\d+)\s+(?:\w+\s+)?(?:contacts|matches|records|students|people|leads|results)\b|\bwhich (?:one|of (?:these|them|the))\b/i;

/** Contacts listed in the note before "and N more". */
const NOTE_MAX_CONTACTS = 5;

const describeContact = (c: CrmContactMatch) => `${c.name ?? "unnamed"} (${[c.id, c.branch, c.status].filter(Boolean).join(", ")})`;

/**
 * A visible note when a CRM search this turn matched several contacts and the answer neither names
 * at least two of them (by id) nor says there are several (N5: a name matching several contacts was
 * silently resolved to one). Null when every search matched at most one contact or the answer
 * already deals with it.
 */
export function crmAmbiguityNote(answer: string, evidence: readonly Pick<EvidenceItem, "crmSearch">[]): string | null {
  if (MENTIONS_SEVERAL.test(answer)) return null;
  const notes: string[] = [];
  for (const { crmSearch } of evidence) {
    const contacts = crmSearch?.contacts ?? [];
    if (contacts.length < 2) continue;
    if (contacts.filter((c) => answer.includes(c.id)).length >= 2) continue;
    const shown = contacts.slice(0, NOTE_MAX_CONTACTS).map(describeContact).join("; ");
    const more = contacts.length > NOTE_MAX_CONTACTS ? `; and ${contacts.length - NOTE_MAX_CONTACTS} more` : "";
    const what = crmSearch!.query ? `the CRM search for "${crmSearch!.query}"` : "a CRM search";
    notes.push(`${what} matched ${contacts.length} contacts — ${shown}${more}`);
  }
  if (!notes.length) return null;
  return `\n\n_(Note: ${notes.join(". Also ")}. Confirm which one this is about before acting on it.)_`;
}
