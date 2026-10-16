/**
 * Export the activity log (`chat_turns`) as fine-tuning data.
 *
 *   bun run export:dataset -- --out data/export/sft.jsonl                       # OpenAI-style messages
 *   bun run export:dataset -- --format gemini --out data/export/gemini.jsonl    # Vertex AI tuning rows
 *   bun run export:dataset -- --format dpo --out data/export/dpo.jsonl          # preference pairs
 *   bun run export:dataset -- --format raw --since 2026-08-01 --dry-run
 *
 * Defaults keep only clean, completed turns. Identity is the pseudonymous
 * userHash only; add --redact-pii to scrub emails/phones/ids from text.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  buildDpoPairs,
  DEFAULT_FILTERS,
  mongoFilter,
  toGeminiRecord,
  toSftRecord,
  turnPasses,
  type ExportFilters,
  type RenderOptions,
} from "../src/activity/export";
import { loadEnv } from "../src/config/env";
import { closeMongo, getCollections, getDb, type ChatTurnDoc } from "../src/db/mongo";

const USAGE = `bun run export:dataset -- [options]
  --out <file>             output JSONL (default data/export/dataset.jsonl)
  --format sft|gemini|dpo|raw   (default sft)
  --since / --until <iso date>
  --intents a,b            primary intents to keep
  --feedback any|positive|nonnegative   (default any)
  --include-refused --include-aborted --include-errors --include-fallback --include-injection
  --system compiled|none   include the exact system prompt (default compiled)
  --redact-pii             scrub emails / phones / id numbers from text
  --history N              prior messages to include (default 12)
  --limit N  --dry-run`;

const { values: a } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    out: { type: "string", default: "data/export/dataset.jsonl" },
    format: { type: "string", default: "sft" },
    since: { type: "string" },
    until: { type: "string" },
    intents: { type: "string" },
    feedback: { type: "string", default: "any" },
    "include-refused": { type: "boolean", default: false },
    "include-aborted": { type: "boolean", default: false },
    "include-errors": { type: "boolean", default: false },
    "include-fallback": { type: "boolean", default: false },
    "include-injection": { type: "boolean", default: false },
    system: { type: "string", default: "compiled" },
    "redact-pii": { type: "boolean", default: false },
    history: { type: "string", default: "12" },
    limit: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (a.help) {
  console.log(USAGE);
  process.exit(0);
}

const format = a.format as "sft" | "gemini" | "dpo" | "raw";
if (!["sft", "gemini", "dpo", "raw"].includes(format)) throw new Error(`unknown --format ${a.format}\n${USAGE}`);
if (!["any", "positive", "nonnegative"].includes(a.feedback!)) throw new Error(`unknown --feedback ${a.feedback}`);
if (!["compiled", "none"].includes(a.system!)) throw new Error(`unknown --system ${a.system}`);
const date = (s?: string) => {
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${s}`);
  return d;
};
const csv = (s?: string) =>
  s
    ?.split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const filters: ExportFilters = {
  ...DEFAULT_FILTERS,
  since: date(a.since),
  until: date(a.until),
  intents: csv(a.intents),
  feedback: a.feedback as ExportFilters["feedback"],
  includeRefused: a["include-refused"]!,
  includeAborted: a["include-aborted"]!,
  includeErrors: a["include-errors"]!,
  includeFallback: a["include-fallback"]!,
  includeInjection: a["include-injection"]!,
};
const render: RenderOptions = { system: a.system === "compiled", redact: a["redact-pii"]!, history: Math.max(0, Number(a.history) || 0) };
const limit = a.limit ? Number(a.limit) : undefined;

const env = loadEnv();
const db = getDb(env);
const c = getCollections(db);

const skipped: Record<string, number> = {};
let scanned = 0;
let emitted = 0;
const kept: ChatTurnDoc[] = [];

if (!a["dry-run"]) mkdirSync(dirname(a.out!), { recursive: true });
const sink = a["dry-run"] ? null : Bun.file(a.out!).writer();
const write = (row: unknown) => {
  emitted++;
  sink?.write(JSON.stringify(row) + "\n");
};

const cursor = c.chatTurns.find(mongoFilter(filters)).sort({ createdAt: 1 });
if (limit && format !== "dpo") cursor.limit(limit);
for await (const t of cursor) {
  scanned++;
  const v = turnPasses(t, filters);
  if (!v.ok) {
    skipped[v.reason] = (skipped[v.reason] ?? 0) + 1;
    continue;
  }
  if (format === "dpo") {
    kept.push(t); // pairs need whole groups; grouping happens after the scan
    continue;
  }
  if (format === "sft") write(toSftRecord(t, render));
  else if (format === "gemini") write(toGeminiRecord(t, render));
  else write({ ...t, ownerId: undefined }); // raw: full document minus the direct identifier
}

let pairs = 0;
if (format === "dpo") {
  const rows = buildDpoPairs(kept, render);
  for (const p of limit ? rows.slice(0, limit) : rows) write(p);
  pairs = rows.length;
}

await sink?.end();
await closeMongo();

console.log(
  JSON.stringify(
    {
      format,
      out: a["dry-run"] ? null : a.out,
      dryRun: a["dry-run"],
      scanned,
      emitted,
      ...(format === "dpo" ? { candidateTurns: kept.length, pairsFound: pairs } : {}),
      skipped,
      filters: { ...filters, since: filters.since?.toISOString(), until: filters.until?.toISOString() },
      render,
    },
    null,
    2,
  ),
);
