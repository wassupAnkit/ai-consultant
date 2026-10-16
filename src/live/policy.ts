import { lookup } from "node:dns/promises";
import { marketDomainsAll } from "../skills/markets";
import { officialDomainsAll } from "../skills/packs";

/**
 * Decides which URLs Edge may fetch or cite at answer time.
 *
 * Allowed by default: experteducation.com, every partner-university domain,
 * and an operator allowlist (official immigration / education sites). URLs the
 * consultant pasted explicitly are allowed too, but only after SSRF checks
 * (public DNS resolution, no private/link-local addresses). Everything is
 * matched on the registrable host with `www.` stripped, suffix-wise, so
 * `study.monash.edu` matches an allowlisted `monash.edu`.
 */
export type PolicyReason = "allowlist" | "partner" | "explicit";
export type PolicyDecision = { ok: true; host: string; reason: PolicyReason } | { ok: false; host: string | null; reason: string };

export interface DomainPolicyOptions {
  /** Hostnames always allowed (suffix match). */
  allow?: Iterable<string>;
  /** Partner-university domains, possibly loaded lazily (registry / seed file). */
  partnerDomains?: () => Promise<Iterable<string>> | Iterable<string>;
  /** Allow URLs the consultant pasted, subject to SSRF checks. Default true. */
  allowExplicitUrls?: boolean;
  /** DNS resolver used for explicit URLs; injectable for tests. */
  resolve?: (host: string) => Promise<string[]>;
}

/**
 * Hosts allowed outright: experteducation.com, every country skill pack's official
 * sources (src/skills/packs), every market pack's origin-side sources (src/skills/markets)
 * and the operator's extras (WEB_FETCH_ALLOWED_DOMAINS).
 */
export function fetchAllowlist(extra: Iterable<string> = []): string[] {
  return [...new Set(["experteducation.com", ...officialDomainsAll(), ...marketDomainsAll(), ...extra].map(normalizeHost).filter(Boolean))].sort();
}

export class DomainPolicy {
  private readonly allow: Set<string>;
  private readonly partnerDomains?: DomainPolicyOptions["partnerDomains"];
  private partnerCache: { at: number; set: Set<string> } | null = null;
  private readonly allowExplicit: boolean;
  private readonly resolve: (host: string) => Promise<string[]>;
  private static readonly PARTNER_TTL_MS = 10 * 60_000;

  constructor(opts: DomainPolicyOptions = {}) {
    this.allow = new Set([...(opts.allow ?? [])].map(normalizeHost).filter(Boolean));
    this.partnerDomains = opts.partnerDomains;
    this.allowExplicit = opts.allowExplicitUrls ?? true;
    this.resolve = opts.resolve ?? defaultResolve;
  }

  static hostOf(url: string): string | null {
    try {
      return normalizeHost(new URL(url).hostname);
    } catch {
      return null;
    }
  }

  /** Domains this policy trusts outright (for logging / the assistant's tool description). */
  async trustedDomains(): Promise<string[]> {
    return [...new Set([...this.allow, ...(await this.partners())])].sort();
  }

  async check(url: string, o: { explicit?: boolean } = {}): Promise<PolicyDecision> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { ok: false, host: null, reason: "invalid_url" };
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, host: null, reason: "unsupported_scheme" };
    if (u.username || u.password) return { ok: false, host: null, reason: "credentials_in_url" };
    const host = normalizeHost(u.hostname);
    if (!host) return { ok: false, host: null, reason: "invalid_host" };
    if (isPrivateHost(host)) return { ok: false, host, reason: "private_address" };

    if (matches(host, this.allow)) return { ok: true, host, reason: "allowlist" };
    if (matches(host, await this.partners())) return { ok: true, host, reason: "partner" };

    if (o.explicit && this.allowExplicit) {
      if (isIpLiteral(host)) return { ok: false, host, reason: "ip_literal" };
      let addresses: string[];
      try {
        addresses = await this.resolve(host);
      } catch {
        return { ok: false, host, reason: "dns_failed" };
      }
      if (!addresses.length) return { ok: false, host, reason: "dns_failed" };
      if (addresses.some(isPrivateIp)) return { ok: false, host, reason: "resolves_to_private_address" };
      return { ok: true, host, reason: "explicit" };
    }
    return { ok: false, host, reason: "not_allowed" };
  }

  private async partners(): Promise<Set<string>> {
    if (!this.partnerDomains) return new Set();
    if (this.partnerCache && Date.now() - this.partnerCache.at < DomainPolicy.PARTNER_TTL_MS) return this.partnerCache.set;
    try {
      const set = new Set([...(await this.partnerDomains())].map(normalizeHost).filter(Boolean));
      this.partnerCache = { at: Date.now(), set };
      return set;
    } catch {
      return this.partnerCache?.set ?? new Set();
    }
  }
}

function matches(host: string, domains: Set<string>): boolean {
  if (domains.has(host)) return true;
  for (const d of domains) if (host.endsWith("." + d)) return true;
  return false;
}

async function defaultResolve(host: string): Promise<string[]> {
  const res = await lookup(host, { all: true, verbatim: true });
  return res.map((r) => r.address);
}

export function normalizeHost(h: string): string {
  return h.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "").replace(/^\[|\]$/g, "");
}

export function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/** Local names and private/link-local literals that must never be fetched. */
export function isPrivateHost(host: string): boolean {
  const h = normalizeHost(host);
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return true;
  return isIpLiteral(h) && isPrivateIp(h);
}

export function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || // 0.0.0.0/8
      a === 10 || // 10/8
      a === 127 || // loopback
      (a === 169 && b === 254) || // link-local
      (a === 172 && b >= 16 && b <= 31) || // 172.16/12
      (a === 192 && b === 168) || // 192.168/16
      (a === 100 && b >= 64 && b <= 127) || // 100.64/10 (CGNAT)
      a >= 224 // multicast / reserved / broadcast
    );
  }
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (v6 === "::" || v6 === "::1") return true;
    const mapped = v6.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    if (/^f[cd][0-9a-f]{2}:/.test(v6)) return true; // fc00::/7 unique local
    if (/^fe[89ab][0-9a-f]:/.test(v6)) return true; // fe80::/10 link-local
    return false;
  }
  return false;
}

/** http(s) URLs literally present in a piece of text (the consultant's message). */
export function extractUrls(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`)\]}]+/gi)) {
    const cleaned = m[0].replace(/[.,;:!?]+$/, "");
    try {
      out.add(new URL(cleaned).toString());
    } catch {
      /* skip malformed */
    }
  }
  return [...out];
}
