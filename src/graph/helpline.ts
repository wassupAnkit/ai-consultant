import { DESTINATION_LABELS, type ContextFlag } from "../schemas/intent.schema";
import { MARKET_LABELS, ONSHORE_LABELS } from "../routing/markets";
import type { RouteDecision } from "../routing/route";
import type { DistressSignal } from "../safety/distress";
import type { ToolCallRecord } from "../tools/types";
import { webResultsToChunks, type WebSearcher } from "../tools/web-search";
import type { RetrievedChunk } from "../retrieval/store";
import { withTimeout } from "../util/signals";

/**
 * Crisis helplines for a distress turn (`detectDistress`, src/safety/distress.ts): one web search
 * per place that matters — where the student is now and their home market — kept only from
 * official or NGO hosts, so the answer can cite a real helpline instead of recalling a number.
 */

/** Where the student is now (onshore office, or abroad in the routed country) first, then their home market. */
export function helplinePlaces(route: Pick<RouteDecision, "origin" | "onshore" | "countries"> | null, flags: readonly ContextFlag[]): string[] {
  if (!route) return [];
  const home = route.origin ? MARKET_LABELS[route.origin] : null;
  const abroad = flags.includes("already_abroad") ? route.countries[0] : undefined;
  const current = route.onshore ? ONSHORE_LABELS[route.onshore] : abroad ? DESTINATION_LABELS[abroad] : null;
  return [...new Set([current, home].filter((p): p is string => Boolean(p)))];
}

export const helplineQuery = (place: string) => `${place} mental health crisis helpline official`;

/** Host labels of government, health-service, international, academic and non-profit sites. */
const OFFICIAL_LABELS = new Set(["gov", "govt", "go", "gob", "gouv", "nic", "int", "org", "edu", "ac", "nhs", "mil"]);

/** Whether `url` is on an official (government, health service, international) or NGO (.org) host. */
export function isOfficialOrNgoHost(url: string): boolean {
  try {
    const labels = new URL(url).hostname.toLowerCase().split(".");
    return labels.slice(1).some((l) => OFFICIAL_LABELS.has(l));
  } catch {
    return false;
  }
}

/** Run the helpline searches in parallel within `timeoutMs`. Never throws: a failed search is a failed record. */
export async function runHelplineSearches(
  web: WebSearcher,
  places: readonly string[],
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<{ place: string; chunks: (RetrievedChunk & { fetchedAt: string })[]; record: ToolCallRecord }[]> {
  return Promise.all(
    places.map(async (place) => {
      const query = helplineQuery(place);
      const started = performance.now();
      const record: ToolCallRecord = { tool: "web_search", args: { query }, ms: 0, ok: true, added: 0 };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          web.search(query, { k: 5, signal: withTimeout(opts.signal, opts.timeoutMs) }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`web_search timed out after ${opts.timeoutMs} ms`)), opts.timeoutMs);
          }),
        ]);
        return { place, chunks: webResultsToChunks(result).filter((c) => isOfficialOrNgoHost(c.url)), record };
      } catch (err) {
        record.ok = false;
        record.error = (err as Error).message.slice(0, 300);
        return { place, chunks: [], record };
      } finally {
        clearTimeout(timer);
        record.ms = Math.round(performance.now() - started);
      }
    }),
  );
}

export const DISTRESS_HEADING = "# Safety first this turn";

/**
 * Appended to the end of the answer's system prompt on a distress turn (outside the cached
 * prefix): a safety check and helplines first, every number cited, never invented.
 */
export function distressInstruction(distress: DistressSignal, places: readonly string[]): string {
  const risk = distress.selfHarm ? "talk of dying, ending their life or self-harm" : "serious distress (cannot go on, everything is over, worthless)";
  const where = places.length ? places.join(" and ") : "where the student is now and their home country (not stated)";
  return `${DISTRESS_HEADING}
The message reports ${risk}. Before anything else, lead the answer with:
1. A short safety check the counsellor can do right now: ask the student directly whether they are safe and whether they are thinking of harming themselves, stay with them, and do not leave them alone if they may be at immediate risk.
2. An immediate crisis helpline for ${where}, each cited from the excerpts [n]. Never write a phone number, text line or website that is not in this turn's excerpts. Where the excerpts have no helpline for a place, say so and tell the counsellor to call local emergency services right away.
Then answer the study question, briefly, or leave it for later if the student is at risk.`;
}
