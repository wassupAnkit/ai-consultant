/**
 * Move partner records between data/partners.json and the kb_partners registry.
 *
 *   bun run partners:sync -- --import            # seed file → registry (skips slugs that already exist)
 *   bun run partners:sync -- --import --force    # overwrite existing non-admin records too
 *   bun run partners:sync -- --export            # registry → data/partners.export.json (review / commit)
 *   bun run partners:sync -- --list [--country canada]
 */
import { parseArgs } from "node:util";
import { loadEnv } from "../src/config/env";
import { closeMongo, getCollections, getDb } from "../src/db/mongo";
import type { PartnerSeed } from "../src/ingest/sources";
import { logger, setLogLevel } from "../src/observability/logger";
import { MongoPartnerRegistry, seedsToRecords } from "../src/partners/registry";
import type { Destination } from "../src/schemas/intent.schema";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    import: { type: "boolean", default: false },
    export: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    country: { type: "string" },
    file: { type: "string", default: "data/partners.json" },
    out: { type: "string", default: "data/partners.export.json" },
  },
});

const env = loadEnv();
setLogLevel(env.LOG_LEVEL);
const registry = new MongoPartnerRegistry(getCollections(getDb(env)).kbPartners);

if (values.import) {
  const seeds = (await Bun.file(values.file!).json()) as PartnerSeed[];
  const records = seedsToRecords(seeds);
  let created = 0,
    updated = 0,
    skipped = 0;
  for (const r of records) {
    const existing = await registry.get(r.slug);
    if (existing && !values.force) {
      skipped++;
      continue;
    }
    if (existing?.source === "admin" && !values.force) {
      skipped++;
      continue;
    }
    await registry.upsert(r, "partners-sync");
    existing ? updated++ : created++;
  }
  logger.info("import complete", { file: values.file, created, updated, skipped, total: records.length });
}

if (values.export) {
  const records = await registry.list();
  const out = records.map((r) => ({
    name: r.name,
    country: r.country,
    website: r.website,
    ...(r.programPaths ? { paths: r.programPaths } : {}),
    ...(r.maxPages ? { maxPages: r.maxPages } : {}),
    ...(r.enabled ? {} : { enabled: false }),
    slug: r.slug,
    domains: r.domains,
    verified: r.verified,
    source: r.source,
  }));
  await Bun.write(values.out!, JSON.stringify(out, null, 2) + "\n");
  logger.info("export complete", { out: values.out, partners: out.length });
}

if (values.list || (!values.import && !values.export)) {
  const records = await registry.list({ country: values.country as Destination | undefined });
  const byCountry = new Map<string, number>();
  for (const r of records) byCountry.set(r.country, (byCountry.get(r.country) ?? 0) + 1);
  console.table(records.map((r) => ({ slug: r.slug, country: r.country, website: r.website ?? "—", enabled: r.enabled, verified: r.verified, source: r.source })));
  console.log(Object.fromEntries(byCountry));
}

await closeMongo();
