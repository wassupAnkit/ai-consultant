import { MARKET_LABELS, type Market } from "../routing/markets";
import type { RouteDecision } from "../routing/route";
import { DESTINATION_LABELS, type Destination, type Intent } from "../schemas/intent.schema";
import { complianceGuideExcerpts, sourceMarketSection } from "../skills/compliance-guides";
import { factsRegisterExcerpts } from "../skills/facts-register";
import { marketGuideExcerpts } from "../skills/market-guides";
import { EvidenceCollector } from "../tools/evidence";
import type { EvidenceItem } from "../tools/types";

/**
 * Guide excerpts after a CRM-student re-route (counsellor audit M9). Round 0 picks the market-guide,
 * compliance-guide and facts-register excerpts for the route classify decided — for a Nepal
 * counsellor, the Nepal guide. When research then reads a named student from Bangladesh with a
 * Canada deal, `withCrmStudent` re-routes the answer, and those excerpts are for the wrong student.
 *
 * The new route's excerpts are added with the same selection functions and caps, numbered after
 * the existing evidence; excerpts for a market that no longer applies are removed (their numbers
 * are left unused rather than reassigned, since the research notes may already cite them), and a
 * per-turn note tells the answer which market's guidance does not apply.
 */

export interface RerouteEvidenceArgs {
  evidence: readonly EvidenceItem[];
  /** The route research ran with (classify's). */
  before: RouteDecision;
  /** The route re-decided from the student's record. */
  after: RouteDecision;
  /** The re-resolved market pack's market (null with market packs off: no market-guide excerpts, as in round 0). */
  market: Market | null | undefined;
  intent: Pick<Intent, "primary_intent" | "user_question" | "contextual_flags">;
  input: string;
  maxEvidence: number;
  /** Facts-register excerpts are on and round 0 searched the knowledge base (the same gate as round 0). */
  factsRegister: boolean;
  complianceGuides: boolean;
}

export interface RerouteEvidence {
  evidence: EvidenceItem[];
  /** Ids of the excerpts added for the new route. */
  added: string[];
  /** Numbers of the excerpts removed because their market no longer applies. */
  removed: number[];
  /** Per-turn instruction for the answer, or null when nothing needs saying. */
  note: string | null;
}

/** Null when the re-route changed neither the origin market nor the destinations. */
export function rerouteEvidence(args: RerouteEvidenceArgs): RerouteEvidence | null {
  const { before, after, intent } = args;
  const originChanged = Boolean(after.origin) && after.origin !== before.origin;
  const newCountries = after.countries.filter((c) => !before.countries.includes(c));
  if (!originChanged && !newCountries.length) return null;

  const oldMarket = originChanged ? before.origin : null;
  const stale = oldMarket ? staleFor(oldMarket) : () => false;
  const removed = args.evidence.filter(stale);
  const collector = EvidenceCollector.resume(args.evidence.filter((i) => !stale(i)), args.maxEvidence);

  // Round 0's order: facts register, market guide, compliance guides. Only what the new route adds
  // is asked for, so a cap is not spent on an excerpt already in the evidence.
  const text = [intent.user_question, args.input].filter(Boolean).join("\n");
  const chunks = [
    ...(args.factsRegister && newCountries.length ? factsRegisterExcerpts({ topic: intent.primary_intent, text, countries: newCountries, flags: intent.contextual_flags }) : []),
    ...marketGuideExcerpts({ market: args.market, topic: intent.primary_intent, countries: originChanged ? after.countries : newCountries }),
    ...(args.complianceGuides ? complianceGuideExcerpts({ topic: intent.primary_intent, text, countries: newCountries, origin: originChanged ? after.origin : null }) : []),
  ];
  const added = collector.add(chunks, "kb", false);

  const cite = (items: readonly EvidenceItem[]) => items.map((i) => `[${i.n}]`).join("");
  const lines: string[] = [];
  if (oldMarket && after.origin) {
    const was = MARKET_LABELS[oldMarket];
    const now = MARKET_LABELS[after.origin];
    lines.push(
      `The student's CRM record puts them in ${now}, not ${was} (the market assumed before the record was read). Excerpts and guidance tagged for ${was} do not apply to this student${removed.length ? `; the ${was} excerpts chosen earlier (${cite(removed)}) were removed, so do not cite those numbers` : ""}. Use the ${now} market guidance instead.`,
    );
  }
  if (added.length) lines.push(`Excerpts ${cite(added)} were added for this student's route (${[after.origin ? MARKET_LABELS[after.origin] : null, ...newCountries.map((c) => DESTINATION_LABELS[c as Destination] ?? c)].filter(Boolean).join(", ")}).`);
  return {
    evidence: collector.items,
    added: added.map((i) => i.id),
    removed: removed.map((i) => i.n),
    note: lines.length ? `# Evidence after reading the student's record\n${lines.join("\n")}` : null,
  };
}

/** Evidence chosen for `market` only: its market-guide excerpts and its section of the source-markets compliance guide. */
function staleFor(market: Market) {
  const section = sourceMarketSection(market);
  const complianceUrl = section ? `compliance-guide://source-markets#${section.anchor}` : null;
  return (i: EvidenceItem) => i.source === `market-guide:${market}` || (complianceUrl !== null && i.url === complianceUrl);
}
