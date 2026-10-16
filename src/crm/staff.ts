import { z } from "zod";
import { marketFromName, marketFromTimezone, onshoreFromName, type CounsellorRegion } from "../routing/markets";
import type { CrmProvider } from "./client";

export type { CounsellorRegion } from "../routing/markets";

/**
 * Where the consultant counsels, read from the CRM: a counsellor in the Kathmandu branch is
 * counselling Nepali students, and never says "Nepali student" in a question. The region is the
 * default origin market of every turn they run (`decideRoute`); anything the turn itself says
 * about the student overrides it.
 *
 * The CRM has no country picker: each user has a primary branch with an address and timezone.
 * `crm_get_me` returns it as `me.branch { id, name, country, city, state, timezone }` with the
 * user's own `me.country` / `me.timeZone`; an older crm-api returns only `me.branch { id, name }`,
 * whose name usually carries the city ("Kathmandu (Putalisadak)", "Pokhara") and is read too.
 *
 * Read per consultant through their own toolset, cached for an hour (a branch rarely changes),
 * bounded by a short timeout, and never throws: an unknown region only means no default.
 */

/** Text, or a `{ name }` object (crm-api projects some places as relations), trimmed; null when empty. */
const place = z
  .unknown()
  .transform((v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string" ? (v as { name: string }).name : ""))
  .transform((v) => v.trim() || null);

const BranchSchema = z
  .object({ name: place, country: place, city: place, state: place, timezone: place, timeZone: place })
  .partial()
  .passthrough();

const MeSchema = z
  .object({ country: place, timeZone: place, timezone: place, branch: BranchSchema.nullish() })
  .partial()
  .passthrough();

/**
 * The region `crm_get_me`'s structured result places this consultant in, else null. First hit
 * wins: the branch's country, city, name, then timezone ("crm_branch"); then the user's own
 * country and timezone ("crm_user"). An Australian or UK office sets `onshore` with no market.
 */
export function regionFromMe(structured: unknown): CounsellorRegion | null {
  const root = (structured && typeof structured === "object" ? structured : {}) as Record<string, unknown>;
  const parsed = MeSchema.safeParse(root.me ?? root);
  if (!parsed.success) return null;
  const me = parsed.data;
  const branch = me.branch ?? null;
  const branchName = branch?.name ?? null;
  const fromName = (name: string | null | undefined) => {
    const market = marketFromName(name);
    if (market) return { market, onshore: null };
    const onshore = onshoreFromName(name);
    return onshore ? { market: null, onshore } : null;
  };
  const atBranch = branch ? (fromName(branch.country) ?? fromName(branch.city) ?? fromName(branch.name) ?? marketFromTimezone(branch.timezone ?? branch.timeZone)) : null;
  if (atBranch) return { ...atBranch, branch: branchName, source: "crm_branch" };
  const atUser = fromName(me.country) ?? marketFromTimezone(me.timeZone ?? me.timezone);
  return atUser ? { ...atUser, branch: branchName, source: "crm_user" } : null;
}

/** The region a browser timezone implies (the chat request's `metadata.tz`), for when the CRM says nothing. */
export function regionFromTimezone(tz: unknown): CounsellorRegion | null {
  const found = typeof tz === "string" ? marketFromTimezone(tz) : null;
  return found ? { ...found, branch: null, source: "timezone" } : null;
}

export interface CounsellorRegionReaderOptions {
  provider: CrmProvider;
  /** How long one consultant's region is reused (default 1 h). */
  cacheTtlMs?: number;
  /** How long "no region" is reused (default 5 min), so a CRM without `crm_get_me` is not asked every turn. */
  negativeTtlMs?: number;
  /** Bound on the whole read, token exchange included (default 2 s). */
  timeoutMs?: number;
  maxCached?: number;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export class CounsellorRegionReader {
  private readonly cache = new Map<string, { at: number; region: CounsellorRegion | null }>();

  constructor(private readonly o: CounsellorRegionReaderOptions) {}

  /** The region `actorEmail` counsels in, per their CRM branch; null when unknown. Never throws. */
  async regionOf(actorEmail: string | null, signal?: AbortSignal): Promise<CounsellorRegion | null> {
    if (!actorEmail) return null;
    const key = actorEmail.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < (hit.region ? (this.o.cacheTtlMs ?? 60 * 60_000) : (this.o.negativeTtlMs ?? 5 * 60_000))) return hit.region;
    this.cache.delete(key);

    const timeoutMs = this.o.timeoutMs ?? 2_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Raced rather than aborted: a slow token exchange still completes and is cached by the
    // provider for the research loop, which needs the same toolset moments later.
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    try {
      const out = await Promise.race([this.read(key, signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)), timedOut]);
      if (out === "timeout") {
        this.o.log?.("counsellor region read timed out; no default market this turn", { actor: key, timeoutMs });
        return null;
      }
      this.remember(key, out.region);
      return out.region;
    } catch (err) {
      this.o.log?.("could not read the counsellor's CRM branch; no default market this turn", { actor: key, err: (err as Error).message });
      // A refusal is not retried every turn; a timeout is (the token exchange may just be cold).
      this.remember(key, null);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Reads `crm_get_me`; `region` null (cached as such) when the CRM answered but placed nobody. */
  private async read(actor: string, signal: AbortSignal): Promise<{ region: CounsellorRegion | null }> {
    const crm = await this.o.provider.forActor(actor);
    if (!crm || !crm.descriptors.some((d) => d.name === "crm_get_me")) return { region: null };
    const res = await crm.call("crm_get_me", {}, signal);
    if (res.isError) throw new Error(res.text || "the CRM refused crm_get_me");
    return { region: regionFromMe(res.structured) };
  }

  private remember(key: string, region: CounsellorRegion | null) {
    if (this.cache.size >= (this.o.maxCached ?? 500)) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, { at: Date.now(), region });
  }
}
