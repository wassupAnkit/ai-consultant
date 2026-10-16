import type { Collection } from "mongodb";
import { z } from "zod";
import type { PartnerSeed } from "../ingest/sources";
import { normalizeHost } from "../live/policy";
import { DESTINATIONS, type Destination } from "../schemas/intent.schema";

/**
 * Partner-university registry: the single source of truth for which
 * institutions Expert Education represents, their websites/domains and how to
 * crawl them. Backs ingestion (`partner:<slug>` sources), the live-fetch domain
 * policy, and "which partners do we have in Canada" answers. Seeded from
 * data/partners.json; maintained through the admin API or `bun run partners:sync`.
 */
export const PartnerRecordSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/, "slug must be lowercase letters, digits and dashes"),
  name: z.string().min(2).max(160),
  aliases: z.array(z.string().min(1).max(160)).max(20).default([]),
  country: z.enum(DESTINATIONS),
  website: z.url().nullable(),
  /** Hostnames (lowercased, no www) the crawler and live fetch may treat as this partner's. */
  domains: z.array(z.string().min(3).max(120)).max(20).default([]),
  /** Path prefixes worth crawling; defaults to the generic course/fees/admissions paths. */
  programPaths: z.array(z.string().regex(/^\//, "paths start with /").max(120)).max(40).optional(),
  sitemaps: z.array(z.url()).max(10).optional(),
  maxPages: z.number().int().min(1).max(5_000).optional(),
  enabled: z.boolean().default(true),
  /** A human confirmed name + website (discovery output starts unverified). */
  verified: z.boolean().default(false),
  source: z.enum(["seed", "admin", "discover"]).default("seed"),
  notes: z.string().max(1_000).optional(),
  updatedAt: z.coerce.date().default(() => new Date()),
  updatedBy: z.string().max(200).optional(),
});

export type PartnerRecord = z.infer<typeof PartnerRecordSchema>;
export type PartnerRecordInput = z.input<typeof PartnerRecordSchema>;
export type PartnerDoc = PartnerRecord & { _id: string };

export interface PartnerRegistry {
  list(filter?: { country?: Destination; enabled?: boolean }): Promise<PartnerRecord[]>;
  get(slug: string): Promise<PartnerRecord | null>;
  upsert(record: PartnerRecordInput, by?: string): Promise<PartnerRecord>;
  remove(slug: string): Promise<boolean>;
  /** Hostnames of enabled partners (for the live-fetch domain policy). */
  domains(): Promise<Set<string>>;
  count(): Promise<number>;
}

export function slugify(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s.length >= 3 ? s : `partner-${s || "x"}`;
}

export function hostOf(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname) || null;
  } catch {
    return null;
  }
}

/** Host plus its registrable parent when the site lives on a subdomain (study.csu.edu.au → csu.edu.au). */
export function domainsForWebsite(website: string | null | undefined): string[] {
  const host = website ? hostOf(website) : null;
  if (!host) return [];
  const out = new Set([host]);
  const parts = host.split(".");
  const secondLevel = parts[parts.length - 2] ?? "";
  if (parts.length > 2 && !/^(edu|ac|co|com|org|gov|net)$/.test(secondLevel)) out.add(parts.slice(1).join("."));
  else if (parts.length > 3) out.add(parts.slice(1).join("."));
  return [...out];
}

/** Convert data/partners.json entries into registry records (placeholders are skipped). */
export function seedsToRecords(seeds: PartnerSeed[]): PartnerRecord[] {
  const out: PartnerRecord[] = [];
  const used = new Set<string>();
  for (const s of seeds) {
    if (/^PLACEHOLDER/i.test(s.name)) continue;
    let slug = slugify(s.name);
    while (used.has(slug)) slug = `${slug}-2`;
    used.add(slug);
    out.push(
      PartnerRecordSchema.parse({
        slug,
        name: s.name,
        country: s.country,
        website: s.website ?? null,
        domains: domainsForWebsite(s.website),
        programPaths: s.paths,
        maxPages: s.maxPages,
        enabled: s.enabled !== false && Boolean(s.website),
        verified: Boolean(s.website),
        source: "seed",
      }),
    );
  }
  return out;
}

export function partnerDomains(records: PartnerRecord[]): Set<string> {
  const out = new Set<string>();
  for (const r of records) {
    if (!r.enabled) continue;
    for (const d of r.domains) out.add(normalizeHost(d));
    for (const d of domainsForWebsite(r.website)) out.add(d);
  }
  out.delete("");
  return out;
}

function normalizeRecord(input: PartnerRecordInput, by?: string): PartnerRecord {
  const parsed = PartnerRecordSchema.parse({ ...input, updatedAt: new Date(), ...(by ? { updatedBy: by } : {}) });
  const domains = new Set([...parsed.domains.map(normalizeHost), ...domainsForWebsite(parsed.website)]);
  domains.delete("");
  return { ...parsed, domains: [...domains] };
}

export class InMemoryPartnerRegistry implements PartnerRegistry {
  private readonly map = new Map<string, PartnerRecord>();
  constructor(records: PartnerRecord[] = []) {
    for (const r of records) this.map.set(r.slug, r);
  }
  async list(filter: { country?: Destination; enabled?: boolean } = {}) {
    return [...this.map.values()]
      .filter((r) => (filter.country ? r.country === filter.country : true) && (filter.enabled === undefined ? true : r.enabled === filter.enabled))
      .sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
  }
  async get(slug: string) {
    return this.map.get(slug) ?? null;
  }
  async upsert(record: PartnerRecordInput, by?: string) {
    const r = normalizeRecord(record, by);
    this.map.set(r.slug, r);
    return r;
  }
  async remove(slug: string) {
    return this.map.delete(slug);
  }
  async domains() {
    return partnerDomains([...this.map.values()]);
  }
  async count() {
    return this.map.size;
  }
}

/** MongoDB-backed registry (`kb_partners`) with a short read cache. */
export class MongoPartnerRegistry implements PartnerRegistry {
  private cache: { at: number; records: PartnerRecord[] } | null = null;
  private static readonly TTL_MS = 60_000;

  constructor(private readonly col: Collection<PartnerDoc>) {}

  private async all(): Promise<PartnerRecord[]> {
    if (this.cache && Date.now() - this.cache.at < MongoPartnerRegistry.TTL_MS) return this.cache.records;
    const docs = await this.col.find({}).sort({ country: 1, name: 1 }).toArray();
    const records = docs.map(({ _id, ...r }) => r as PartnerRecord);
    this.cache = { at: Date.now(), records };
    return records;
  }

  invalidate() {
    this.cache = null;
  }

  async list(filter: { country?: Destination; enabled?: boolean } = {}) {
    return (await this.all()).filter((r) => (filter.country ? r.country === filter.country : true) && (filter.enabled === undefined ? true : r.enabled === filter.enabled));
  }

  async get(slug: string) {
    const doc = await this.col.findOne({ _id: slug });
    if (!doc) return null;
    const { _id, ...r } = doc;
    return r as PartnerRecord;
  }

  async upsert(record: PartnerRecordInput, by?: string) {
    const r = normalizeRecord(record, by);
    await this.col.replaceOne({ _id: r.slug }, { ...r }, { upsert: true });
    this.invalidate();
    return r;
  }

  async remove(slug: string) {
    const res = await this.col.deleteOne({ _id: slug });
    this.invalidate();
    return res.deletedCount > 0;
  }

  async domains() {
    return partnerDomains(await this.all());
  }

  async count() {
    return this.col.estimatedDocumentCount();
  }
}

/**
 * Make sure the registry has data: an empty registry is seeded from
 * data/partners.json so a fresh environment behaves like the file-based setup.
 * Returns every record.
 */
export async function ensurePartnerRegistry(
  registry: PartnerRegistry,
  opts: { seedsPath?: URL | string; log?: (msg: string, meta?: Record<string, unknown>) => void } = {},
): Promise<PartnerRecord[]> {
  if ((await registry.count()) > 0) return registry.list();
  const path = opts.seedsPath ?? new URL("../../data/partners.json", import.meta.url);
  const seeds = (await Bun.file(path).json()) as PartnerSeed[];
  const records = seedsToRecords(seeds);
  for (const r of records) await registry.upsert(r);
  opts.log?.("partner registry seeded from data/partners.json", { partners: records.length });
  return registry.list();
}
