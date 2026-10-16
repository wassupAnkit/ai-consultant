import { describe, expect, test } from "bun:test";
import { counsellorRegionOf, OriginTally, parseGolden, pool, routeFor, rowRecord, RouteTally, Tally, type Golden, type Prediction } from "../scripts/eval-intents";
import { isMarket } from "../src/routing/markets";
import { DESTINATIONS, PRIMARY_INTENTS, TASKS } from "../src/schemas/intent.schema";

const pred = (over: Partial<Prediction> = {}): Prediction => ({ intent: "visa_process", task: "lookup", needs_research: true, flags: [], destinations: [], secondary: [], ...over });

describe("eval-intents helpers", () => {
  test("parseGolden skips blank lines and comments", () => {
    const rows = parseGolden('# header\n\n{"text":"a","intent":"greeting"}\n  # indented comment\n{"text":"b"}\n');
    expect(rows.map((r) => r.text)).toEqual(["a", "b"]);
  });

  test("counsellorRegionOf maps a market to a CRM-branch region, ignores junk", () => {
    expect(counsellorRegionOf({ counsellorRegion: "nepal" })).toEqual({ market: "nepal", onshore: null, branch: null, source: "crm_branch" });
    expect(counsellorRegionOf({})).toBeNull();
    expect(counsellorRegionOf({ counsellorRegion: "atlantis" as never })).toBeNull();
  });

  test("routeFor: the counsellor region is the default origin, an explicit mention overrides it", () => {
    const plain: Golden = { text: "What documents does she need for a subclass 500?", counsellorRegion: "nepal" };
    const plainRoute = routeFor(plain, pred(), [], false);
    expect(plainRoute.origin).toBe("nepal");
    expect(plainRoute.originSource).toBe("counsellor");
    expect(plainRoute.countries).toEqual(["australia"]);

    const thai = routeFor({ text: "Thai student wants a 500 visa — what documents?", counsellorRegion: "nepal" }, pred(), [], false);
    expect(thai.origin).toBe("thailand");
    expect(thai.originSource).toBe("keywords");

    const none = routeFor({ text: "What documents does she need for a subclass 500?" }, pred(), [], false);
    expect(none.origin).toBeNull();
  });

  test("routeFor passes the classifier's free-text origin (Gemini) through", () => {
    const r = routeFor({ text: "What documents does she need for a subclass 500?" }, pred({ origin: "Sri Lanka" }), [], false);
    expect(r.origin).toBe("sri_lanka");
    expect(r.originSource).toBe("classifier");
  });

  test("OriginTally scores labelled rows only, split by route source and region", () => {
    const t = new OriginTally();
    expect(t.score({}, { origin: "nepal", originSource: "keywords" })).toBeNull();
    expect(t.score({ origin: "nepal" }, { origin: "nepal", originSource: "keywords" })).toBe(true);
    expect(t.score({ origin: "india", counsellorRegion: "india" }, { origin: "india", originSource: "counsellor" })).toBe(true);
    expect(t.score({ origin: "thailand", counsellorRegion: "nepal" }, { origin: "nepal", originSource: "counsellor" })).toBe(false);
    expect(t.score({ origin: "vietnam" }, { origin: null, originSource: null })).toBe(false);
    expect([t.hit, t.total]).toEqual([2, 4]);
    expect(t.bySource.get("counsellor")).toEqual({ hit: 1, total: 2 });
    expect(t.bySource.get("none")).toEqual({ hit: 0, total: 1 });
    expect(t.byRegion).toEqual({ withRegion: { hit: 1, total: 2 }, noRegion: { hit: 1, total: 2 } });
    expect(t.text).toContain("50.0% (2/4)");
  });

  test("Tally honours the accept list; RouteTally counts precision/recall/exact", () => {
    const t = new Tally();
    expect(t.score(undefined, undefined, "x")).toBeNull();
    expect(t.score("a", ["b"], "b")).toBe(true);
    expect(t.score("a", undefined, "c")).toBe(false);
    expect(t.text).toBe("50.0%  (1/2)");

    const r = new RouteTally();
    expect(r.score({ destinations: ["australia", "canada"], mode: "comparison" }, { countries: ["australia"], countrySource: ["keywords"], mode: "single" })).toHaveLength(2);
    expect([r.tp, r.fp, r.fn, r.exact, r.modeHit]).toEqual([1, 0, 1, 0, 0]);
  });

  test("rowRecord carries the label, prediction, route and per-field verdicts", () => {
    const g: Golden = { id: "x-1", text: "Nepali student, 500 visa docs?", intent: "document_preparation", accept: ["visa_process"], task: "lookup", destinations: ["australia"], mode: "single", origin: "nepal" };
    const p = pred();
    const rec = rowRecord(g, p, routeFor(g, p, [], false));
    expect(rec.id).toBe("x-1");
    expect(rec.ok).toEqual({ intent: true, task: true, countries: true, mode: true, origin: true });
    expect(rec.route.originSource).toBe("keywords");
    expect(rowRecord({ text: "hi" }, p, routeFor({ text: "hi" }, p, [], false)).ok).toEqual({ intent: null, task: null, countries: null, mode: null, origin: null });
  });

  test("pool keeps input order and respects the limit", async () => {
    let inFlight = 0,
      peak = 0;
    const out = await pool([5, 1, 3, 2], 2, async (n) => {
      peak = Math.max(peak, ++inFlight);
      await Bun.sleep(n);
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20]);
    expect(peak).toBe(2);
  });
});

/** Every golden file the script scores must use known labels, so a typo is not a silent miss. */
describe.each(["intents.jsonl", "intents-deep.jsonl"])("golden file %s", (name) => {
  test("labels are valid enums", async () => {
    const file = Bun.file(new URL(`../data/eval/${name}`, import.meta.url));
    if (!(await file.exists())) return;
    const rows = parseGolden(await file.text());
    const bad: string[] = [];
    const ids = new Set<string>();
    for (const g of rows) {
      const where = g.id ?? g.text.slice(0, 40);
      if (g.id) {
        if (ids.has(g.id)) bad.push(`${where}: duplicate id`);
        ids.add(g.id);
      }
      for (const i of [g.intent, ...(g.accept ?? [])]) if (i !== undefined && !(PRIMARY_INTENTS as readonly string[]).includes(i)) bad.push(`${where}: intent ${i}`);
      for (const t of [g.task, ...(g.acceptTask ?? [])]) if (t !== undefined && !(TASKS as readonly string[]).includes(t)) bad.push(`${where}: task ${t}`);
      for (const d of g.destinations ?? []) if (!(DESTINATIONS as readonly string[]).includes(d)) bad.push(`${where}: destination ${d}`);
      if (g.mode !== undefined && !["single", "comparison", "none"].includes(g.mode)) bad.push(`${where}: mode ${g.mode}`);
      if (g.origin !== undefined && !isMarket(g.origin)) bad.push(`${where}: origin ${g.origin}`);
      if (g.counsellorRegion !== undefined && !isMarket(g.counsellorRegion)) bad.push(`${where}: counsellorRegion ${g.counsellorRegion}`);
    }
    expect(bad).toEqual([]);
  });
});
