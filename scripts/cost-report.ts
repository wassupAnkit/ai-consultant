/**
 * LLM cost, prompt-cache and repeat-question report over the activity log (`chat_turns`). Read-only.
 *
 *   bun run cost:report                                   # last 7 days
 *   bun run cost:report -- --days 30
 *   bun run cost:report -- --from 2026-10-01 --to 2026-10-08
 *
 * Prints counts, averages, rates and money only; message text is never printed (it is read to
 * detect exact repeats and kept in memory as a normalised key). See src/observability/cost-report.ts.
 */
import { parseArgs } from "node:util";
import { loadEnv } from "../src/config/env";
import { closeMongo, getCollections, getDb } from "../src/db/mongo";
import { buildCostReport, formatCostReport, parseWindow, REPORT_PROJECTION, type ReportTurn } from "../src/observability/cost-report";

const USAGE = `bun run cost:report -- [options]
  --days N              window back from now (default 7)
  --from / --to <iso>   explicit window (--to alone counts --days back from it)`;

const { values: a } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    days: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (a.help) {
  console.log(USAGE);
  process.exit(0);
}

const window = parseWindow({ days: a.days, from: a.from, to: a.to });
const env = loadEnv();
const c = getCollections(getDb(env));

try {
  const turns: ReportTurn[] = [];
  const cursor = c.chatTurns.find({ createdAt: { $gte: window.from, $lt: window.to } }, { projection: REPORT_PROJECTION }).sort({ createdAt: 1 });
  for await (const t of cursor) turns.push(t as unknown as ReportTurn);
  console.log(formatCostReport(buildCostReport(turns, window)));
} finally {
  await closeMongo();
}
