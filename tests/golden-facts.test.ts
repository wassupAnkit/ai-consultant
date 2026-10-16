import { describe, expect, test } from "bun:test";
import { answerHasFigure, buildGoldenCases, extractFigures, parseGolden, scoreAnswer, scoreScenario, summarizeGolden, toJsonl, validateScenarios, withoutCheckNotes } from "../src/eval/golden";

describe("extractFigures", () => {
  test("money with codes and symbols, percentages and quantities; dates and citations are not figures", () => {
    const f = extractFigures("AUD2,050.00 primary charge (18+ AUD1,255.00); £1,570 per month, up to 9 months; 48 hours a fortnight; less than 5%; from 2025-11-14 under SI 2026/311");
    expect(f.map((x) => [x.kind, x.value, x.unit])).toEqual([
      ["money", 2050, "AUD"],
      ["money", 1255, "AUD"],
      ["money", 1570, "GBP"],
      ["quantity", 9, "month"],
      ["quantity", 48, "hour"],
      ["percent", 5, "%"],
    ]);
  });
  test("NZD with a space, US dollars and k suffixes", () => {
    expect(extractFigures("NZD 20,000 a year; $23,448 per year; A$29.7k").map((x) => x.value)).toEqual([20000, 23448, 29700]);
  });
});

describe("scoring an answer", () => {
  const fee = { expect: extractFigures("AUD2,500.00"), stale: extractFigures("AUD2,000") };
  test("the figure in another format still counts", () => {
    expect(scoreAnswer(fee, "The base charge is A$2,500 [3].").outcome).toBe("pass");
    expect(scoreAnswer(fee, "It costs AUD 2500 from 1 July 2026.").outcome).toBe("pass");
    expect(scoreAnswer(fee, "The charge is 2,500 Australian dollars.").outcome).toBe("pass");
  });
  test("only the old figure is stale; old and new together pass; neither is a miss", () => {
    expect(scoreAnswer(fee, "The base charge is AUD 2,000.")).toMatchObject({ outcome: "stale", staleFound: ["AUD2,000"] });
    expect(scoreAnswer(fee, "It rose from AUD 2,000 to AUD 2,500 on 1 July 2026.").outcome).toBe("pass");
    expect(scoreAnswer(fee, "Check the Home Affairs pricing table.").outcome).toBe("miss");
  });
  test("several figures: some is partial", () => {
    const c = { expect: extractFigures("£1,570 per month, up to 9 months"), stale: [] };
    expect(scoreAnswer(c, "£1,570 a month for up to 9 months").outcome).toBe("pass");
    expect(scoreAnswer(c, "£1,570 a month").outcome).toBe("partial");
  });
  test("small quantities need their unit; money needs no currency only when large", () => {
    const [weeks] = extractFigures("7 weeks");
    expect(answerHasFigure("80% are decided within 7 weeks", weeks!)).toBe(true);
    expect(answerHasFigure("see section 7 of the guide", weeks!)).toBe(false);
    const [small] = extractFigures("$70");
    expect(answerHasFigure("the fee is 70", small!)).toBe(false);
    expect(answerHasFigure("the fee is US$70", small!)).toBe(true);
  });
  test("a quantity spelled out in words states the figure", () => {
    // Golden facts 2026-10-12: four correct GLM answers scored as misses for writing the number out.
    const c = { expect: extractFigures("£1,529 per month, up to 9 months"), stale: [] };
    expect(scoreAnswer(c, "£1,529 per month, up to a maximum of £13,761 for a nine-month course").outcome).toBe("pass");
    const [three] = extractFigures("3 months");
    expect(answerHasFigure("at least three months' lawful work for the sponsor", three!)).toBe(true);
    expect(answerHasFigure("Three Months before the course", three!)).toBe(true);
    const [four] = extractFigures("4 years");
    expect(answerHasFigure("not to exceed four years, plus a 60-day departure period", four!)).toBe(true);
    // Only a word number next to a unit: "one of three options" states no quantity.
    expect(answerHasFigure("one of three months-long options", three!)).toBe(true);
    expect(answerHasFigure("pick one of three routes within the month", three!)).toBe(false);
  });
});

describe("golden cases from the facts registers", () => {
  const cases = buildGoldenCases();
  test("stable ids, a question per case, figures to check, unverified rows left out", () => {
    expect(cases.length).toBeGreaterThan(150);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.expect.length).toBeGreaterThan(0);
      expect(c.question).toContain(c.fact.replace(/\*\*/g, "").trim());
      expect(c.source.split("|")[2]).not.toMatch(/[—–-]+\s*verify\b/i); // the value cell
    }
  });
  test("the AU visa charge case expects the current charge and flags the old one", () => {
    const c = cases.find((x) => x.id.startsWith("australia:visa-application-charges:subclass-500-base-application-charge"))!;
    expect(c.expect.map((f) => f.value)).toEqual([2500]);
    expect(c.stale.map((f) => f.value)).toEqual([2000]);
  });
  test("a 'Replaced by' row flags the replaced figure as stale", () => {
    const c = cases.find((x) => x.register === "canada" && /22,895/.test(x.fact))!;
    expect(c.expect.map((f) => f.value)).toEqual([23448]);
    expect(c.stale.map((f) => f.value)).toEqual([22895]);
  });
  test("data/eval/golden-facts.jsonl is in sync with the registers (run `bun run golden:build`)", async () => {
    const file = await Bun.file(new URL("../data/eval/golden-facts.jsonl", import.meta.url)).text();
    expect(file).toBe(toJsonl(cases));
    expect(parseGolden(file)).toHaveLength(cases.length);
  });
});

describe("summarizeGolden", () => {
  test("pass, stale and consistency across repeats", () => {
    const s = summarizeGolden([
      { id: "a", register: "australia", runs: [{ outcome: "pass", ms: 10, missing: [], staleFound: [] }, { outcome: "pass", ms: 20, missing: [], staleFound: [] }] },
      { id: "b", register: "australia", runs: [{ outcome: "stale", ms: 30, missing: ["x"], staleFound: ["y"] }, { outcome: "pass", ms: 40, missing: [], staleFound: [] }] },
    ]);
    expect(s).toMatchObject({ cases: 2, runsPerCase: 2, passRate: 0.75, staleRate: 0.25, consistency: 0.5 });
    expect(s.byRegister.australia).toEqual({ cases: 2, passRate: 0.75, staleRate: 0.25 });
  });
});

describe("scenario cases", () => {
  const familyCase = {
    id: "r1-family",
    failure: "R1",
    register: "australia",
    question: "Master's student wants to bring his wife and son; what funds?",
    expect: ["AUD29,710"],
    forbid: ["AUD10,394"],
    require: [{ label: "family ban stated", pattern: "(?i)(can no longer|cannot|can't) (include|bring|add)" }],
    reject: [{ label: "dependant visa offered", pattern: "(?i)apply for (a|the) dependant visa" }],
  };

  test("pass needs every expected figure and claim; a forbidden figure or rejected claim is wrong", () => {
    expect(scoreScenario(familyCase, "Since 2 Oct 2026 most students cannot include family members. Show AUD 29,710 for living costs.").outcome).toBe("pass");
    expect(scoreScenario(familyCase, "Show AUD 29,710 plus AUD 10,394 for the partner; you cannot include the child.")).toMatchObject({ outcome: "wrong", reasons: ["forbidden AUD10,394"] });
    expect(scoreScenario(familyCase, "Show AUD 29,710 for living costs.")).toMatchObject({ outcome: "miss", reasons: ["missing claim: family ban stated"] });
    expect(scoreScenario(familyCase, "They cannot include family. Your wife can apply for a dependant visa later. AUD 29,710.").outcome).toBe("wrong");
  });

  test("Edge's own figure-check line is not scored (it quotes the figures it doubts)", () => {
    const answer = "Most students cannot include family now. Show AUD 29,710 [1].\n\n_(Figure check: not found in this turn's sources: AUD 10,394. Verify before sending.)_";
    expect(withoutCheckNotes(answer)).toBe("Most students cannot include family now. Show AUD 29,710 [1].");
    expect(scoreScenario(familyCase, answer).outcome).toBe("pass");
  });

  test("validation catches bad regexes, non-figures and duplicate ids", () => {
    const bad = { ...familyCase, expect: ["about thirty thousand"], require: [{ label: "x", pattern: "(?i)(unclosed" }] };
    const errors = validateScenarios([familyCase, bad]);
    expect(errors.some((e) => e.includes("duplicate id"))).toBe(true);
    expect(errors.some((e) => e.includes("not exactly one figure"))).toBe(true);
    expect(errors.some((e) => e.includes("bad pattern"))).toBe(true);
  });
});
