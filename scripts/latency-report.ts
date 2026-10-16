/**
 * Turn latency breakdown over the activity log (`chat_turns`). Read-only.
 *
 *   bun run latency:report                                # last 7 days
 *   bun run latency:report -- --days 3
 *   bun run latency:report -- --from 2026-10-01 --to 2026-10-08
 *   bun run latency:report -- --days 3 --source release   # deployed releases only (local servers record no release)
 *   bun run latency:report -- --days 3 --source local
 *   bun run latency:report -- --days 3 --split intent,mode
 *
 * Prints timings and token counts only; message text is never read. See src/observability/latency-report.ts.
 */
import { parseArgs } from "node:util";
import { loadEnv } from "../src/config/env";
import { closeMongo, getCollections, getDb } from "../src/db/mongo";
import { parseWindow } from "../src/observability/cost-report";
import { buildLatencyReport, formatLatencyReport, LATENCY_PROJECTION, SPLITS, type LatencyTurn, type Split } from "../src/observability/latency-report";

const USAGE = `bun run latency:report -- [options]
  --days N              window back from now (default 7)
  --from / --to <iso>   explicit window (--to alone counts --days back from it)
  --source release|local  only turns from a deployed release, or only from local servers (no release)
  --split a,b           splits to print (default all: ${Object.keys(SPLITS).join(",")})
  --ok                  only turns whose outcome is ok`;

const { values: a } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    days: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    source: { type: "string" },
    split: { type: "string" },
    ok: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (a.help) {
  console.log(USAGE);
  process.exit(0);
}

const window = parseWindow({ days: a.days, from: a.from, to: a.to });
const splits = a.split ? (a.split.split(",").map((s) => s.trim()) as Split[]) : undefined;
for (const s of splits ?? []) if (!(s in SPLITS)) throw new Error(`unknown --split ${s}; use ${Object.keys(SPLITS).join(",")}`);
if (a.source && a.source !== "release" && a.source !== "local") throw new Error("--source must be release or local");

const config = loadEnv();
const c = getCollections(getDb(config));

try {
  const filter: Record<string, unknown> = { createdAt: { $gte: window.from, $lt: window.to } };
  if (a.source === "release") filter.release = { $type: "string" };
  if (a.source === "local") filter.release = null;
  if (a.ok) filter.outcome = "ok";
  const turns: LatencyTurn[] = [];
  for await (const t of c.chatTurns.find(filter, { projection: LATENCY_PROJECTION }).sort({ createdAt: 1 })) turns.push(t as unknown as LatencyTurn);
  console.log(formatLatencyReport(buildLatencyReport(turns, window, splits)));
} finally {
  await closeMongo();
}
