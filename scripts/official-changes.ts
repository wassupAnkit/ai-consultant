/**
 * Official pages whose text changed, and the facts-register rows that quote them.
 *
 *   bun run official:changes                    # changes since each register's "Checked" date
 *   bun run official:changes -- --since 2026-10-01
 *   bun run official:changes -- --failed        # also list pages the last runs could not fetch
 *
 * Read-only. The nightly ingest (`--source all`, src/ingest/official.ts) stamps
 * `kb_pages.contentChangedAt` when an already-indexed official page's text changes; every row
 * listed here should be re-checked against the page and its register updated (docs/facts, then
 * data/facts). A change can be cosmetic (a "last updated" line), so read the page before editing.
 */
import { parseArgs } from "node:util";
import { loadEnv } from "../src/config/env";
import { closeMongo, getCollections, getDb } from "../src/db/mongo";
import { loadOfficialPages, officialKey } from "../src/ingest/official";
import { factsRegister, FACTS_SLUGS } from "../src/skills/facts-register";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { since: { type: "string" }, failed: { type: "boolean", default: false } },
});

const env = loadEnv();
const collections = getCollections(getDb(env));
const { pages } = await loadOfficialPages();
const labels = new Map(pages.map((p) => [officialKey(p), p.label]));

/** Register rows citing a page, with the date each register was checked. */
const citing = new Map<string, { register: string; checked: string; fact: string }[]>();
for (const slug of FACTS_SLUGS) {
  const reg = factsRegister(slug);
  for (const section of reg.sections) {
    for (const row of section.rows) {
      for (const page of pages) {
        const key = officialKey(page);
        if (!row.source.includes(page.url) && !row.source.includes(key)) continue;
        citing.set(key, [...(citing.get(key) ?? []), { register: slug, checked: row.checked || reg.checked, fact: row.fact }]);
      }
    }
  }
}

const since = values.since ? new Date(values.since) : null;
const changed = await collections.kbPages
  .find({ source: { $regex: "^official:" }, contentChangedAt: { $ne: null } }, { projection: { _id: 1, title: 1, contentChangedAt: 1, lastCrawled: 1 } })
  .sort({ contentChangedAt: -1 })
  .toArray();

let listed = 0;
for (const p of changed) {
  const at = p.contentChangedAt!;
  const rows = citing.get(p._id) ?? [];
  // Without --since: report a page when it changed after the register that cites it was checked.
  const relevant = since ? at >= since : rows.length === 0 || rows.some((r) => !r.checked || at > new Date(`${r.checked}T00:00:00Z`));
  if (!relevant) continue;
  listed++;
  console.log(`\n${at.toISOString().slice(0, 10)}  ${labels.get(p._id) ?? p.title}\n  ${p._id}`);
  for (const r of rows) console.log(`  - ${r.register}: "${r.fact}" (checked ${r.checked || "?"})`);
  if (!rows.length) console.log("  (no facts-register row cites this page)");
}
console.log(`\n${listed} changed official page(s)${since ? ` since ${values.since}` : " after their register was checked"}; ${pages.length} pages on the list.`);

if (values.failed) {
  const run = await collections.kbIngestRuns.find({ "sources.name": "official" }).sort({ startedAt: -1 }).limit(1).next();
  const failed = run?.sources.find((s) => s.name === "official")?.failed ?? [];
  console.log(`\nLast official run ${run?.startedAt.toISOString() ?? "never"}: ${failed.length} page(s) not fetched`);
  for (const f of failed) console.log(`  ${f.status ?? "-"}  ${f.url}  (${f.error})`);
}

await closeMongo();
