import { describe, expect, test } from "bun:test";
import { checkAnswerFigures } from "../src/graph/answer-check";
import { extractFigures } from "../src/verify/figures";
import { fakeGraph, intentOf } from "./helpers";

const EVIDENCE = [
  "12-month living costs, student: AUD29,710. Travel cost guide, most countries: AUD2,000. Subclass 500 base application charge: AUD2,500.00.",
  "Sydney 1,250 enquiries; Parramatta 59 enquiries.",
];

describe("checkAnswerFigures", () => {
  test("figures from the evidence pass in any format; an unsourced one is listed", () => {
    const ok = checkAnswerFigures("Show living costs of A$29,710 [1] and the visa charge of AUD 2,500 [1].", { evidence: EVIDENCE, input: "" });
    expect(ok.note).toBeNull();
    expect(ok.checked).toBe(2);
    const bad = checkAnswerFigures("OSHC will cost about AUD 3,000 a year, and living costs are AUD 29,710 [1].", { evidence: EVIDENCE, input: "" });
    expect(bad.unsupported).toEqual(["AUD 3,000"]);
    expect(bad.note).toContain("not found in this turn's sources: AUD 3,000");
  });

  test("a figure the consultant gave is support; earlier answers are not passed in", () => {
    expect(checkAnswerFigures("With the AUD 18,000 scholarship, the tuition gap is covered.", { evidence: EVIDENCE, input: "She has an AUD 18,000 scholarship" }).note).toBeNull();
  });

  test("a line that shows its arithmetic or says derived needs no source", () => {
    const r = checkAnswerFigures("Two years of living costs: AUD 29,710 × 2 = AUD 59,420 [1].\nMonthly budget (derived): AUD 2,476.", { evidence: EVIDENCE, input: "" });
    expect(r.unsupported).toEqual([]);
  });

  test("a total that is the sum of its table passes; a wrong one is flagged with its items", () => {
    const table = (total: string) =>
      ["| Item | Amount |", "|---|---|", "| Living costs | AUD 29,710 |", "| Visa charge | AUD 2,500 |", "| Travel | AUD 2,000 |", `| **Total** | **${total}** |`].join("\n");
    expect(checkAnswerFigures(table("AUD 34,210"), { evidence: EVIDENCE, input: "" }).note).toBeNull();
    const wrong = checkAnswerFigures(table("AUD 36,210"), { evidence: EVIDENCE, input: "" });
    expect(wrong.badTotals).toEqual([{ total: "AUD 36,210", components: ["AUD 29,710", "AUD 2,500", "AUD 2,000"] }]);
    expect(wrong.note).toContain("the total AUD 36,210 is not the sum");
  });

  test("counts: 1,250 + 59 is 1,309, not 1,304", () => {
    const list = (n: string) => `- Sydney: 1,250 enquiries\n- Parramatta: 59 enquiries\n- Total: ${n} enquiries`;
    // Counts without a currency are not money figures: totals are checked on money only.
    expect(checkAnswerFigures(list("1,304"), { evidence: EVIDENCE, input: "" }).badTotals).toEqual([]);
    const money = (n: string) => `- Sydney fees: AUD 1,250\n- Parramatta fees: AUD 59\n- Total: AUD ${n}`;
    expect(checkAnswerFigures(money("1,309"), { evidence: ["AUD 1,250 and AUD 59"], input: "" }).badTotals).toEqual([]);
    expect(checkAnswerFigures(money("1,304"), { evidence: ["AUD 1,250 and AUD 59"], input: "" }).badTotals).toHaveLength(1);
  });

  test("a total may be the sum of some of the items above it (a subtotal row in between)", () => {
    const text = ["- Tuition: AUD 30,000", "- Living costs: AUD 29,710", "- Subtotal: AUD 59,710", "- Travel: AUD 2,000", "- Total: AUD 61,710"].join("\n");
    expect(checkAnswerFigures(text, { evidence: ["AUD 30,000", ...EVIDENCE], input: "" }).badTotals).toEqual([]);
  });

  test("a home-currency figure must be a stated figure times the stated rate (the 10x BDT error)", () => {
    const right = "Total first year: AUD 46,474.\nAt 1 AUD = 89.5 BDT that is about BDT 4,159,423.";
    const wrong = "Total first year: AUD 46,474.\nAt 1 AUD = 89.5 BDT that is about BDT 41,596,000.";
    const support = { evidence: ["AUD 46,474", "1 AUD = 89.5 BDT (Bangladesh Bank)"], input: "" };
    expect(checkAnswerFigures(right, support).badConversions).toEqual([]);
    const bad = checkAnswerFigures(wrong, support);
    expect(bad.badConversions).toEqual([{ figure: "BDT 41,596,000", rate: "1 AUD = 89.5 BDT" }]);
    expect(bad.note).toContain("BDT 41,596,000 does not match any figure at the stated rate");
  });

  test("lakh and crore: NPR 25 lakh equals NPR 25,00,000", () => {
    const [a] = extractFigures("NPR 25 lakh");
    const [b] = extractFigures("NPR 25,00,000");
    expect(a!.value).toBe(2_500_000);
    expect(b!.value).toBe(2_500_000);
  });

  test("percentages are checked; a rhetorical 100% is not", () => {
    expect(checkAnswerFigures("Fully funded: 100% of tuition.", { evidence: [], input: "" }).note).toBeNull();
    expect(checkAnswerFigures("The refusal rate threshold is 5%.", { evidence: ["less than 5%"], input: "" }).note).toBeNull();
    expect(checkAnswerFigures("The refusal rate threshold is 7%.", { evidence: ["less than 5%"], input: "" }).unsupported).toEqual(["7%"]);
  });

  test("no figures, no note", () => {
    expect(checkAnswerFigures("Check the Home Affairs page for the current charge.", { evidence: EVIDENCE, input: "" })).toMatchObject({ checked: 0, note: null });
  });
});

describe("the answer node", () => {
  test("adds the figure check line and records it in meta", async () => {
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "financial_viability", destinations: ["australia"] }), answer: "Tuition is AUD 31,000 a year [1]." });
    const out = await graph.invoke({ input: "Cost?", history: [], sessionId: "s1", profile: null });
    expect(out.answer).toContain("_(Figure check: not found in this turn's sources: AUD 31,000. Verify before sending.)_");
    expect(out.meta.figureCheck).toEqual({ checked: 1, unsupported: 1, badTotals: 0, badConversions: 0, flagged: true });
  });

  test("on a draft the line says it is for the counsellor, not part of the message", async () => {
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "financial_viability", destinations: ["australia"], task: "draft" }), answer: "Dear parent, tuition is AUD 31,000 a year." });
    const out = await graph.invoke({ input: "Draft a note to the parent", history: [], sessionId: "s1", profile: null });
    expect(out.answer).toContain("_(For you, not part of the message. Figure check:");
  });

  test("a supported answer is untouched", async () => {
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "financial_viability", destinations: ["australia"] }), answer: "Bachelor tuition ranges from AUD 20,000 to 45,000 per year [1]." });
    const out = await graph.invoke({ input: "Cost?", history: [], sessionId: "s1", profile: null });
    expect(out.answer).toBe("Bachelor tuition ranges from AUD 20,000 to 45,000 per year [1].");
    expect(out.meta.figureCheck).toMatchObject({ flagged: false });
  });
});

describe("totals on one line", () => {
  test("only the figure after 'total' is the total; the others on its line are its parts", () => {
    const text = "Expert's page says the fee is NZD 750 with the NZD 100 levy on top, totalling NZD 850 [9].";
    expect(checkAnswerFigures(text, { evidence: ["NZD 750", "NZD 100", "NZD 850"], input: "" }).note).toBeNull();
    const wrong = checkAnswerFigures("The fee is NZD 750 with the NZD 100 levy on top, totalling NZD 950.", { evidence: ["NZD 750", "NZD 100"], input: "" });
    expect(wrong.badTotals).toEqual([{ total: "NZD 950", components: ["NZD 750", "NZD 100"] }]);
  });
});

describe("false positives seen in the 12 Oct scenario run", () => {
  test("a figure inside '(derived: … × 9)' after the word total is not the total", () => {
    const text = "Inner London: the statutory figure is £13,761 total (derived: £1,529 × 9) [16].";
    expect(checkAnswerFigures(text, { evidence: ["£1,529"], input: "" }).note).toBeNull();
  });
  test("a total may include a figure from the consultant's message", () => {
    const text = "- Living costs: AUD 29,710\n- Travel: AUD 2,000\n- **Total first-year visa funds:** AUD 62,710";
    expect(checkAnswerFigures(text, { evidence: ["AUD29,710 AUD2,000"], input: "First-year tuition is AUD 31,000." }).note).toBeNull();
  });
  test("an unlabelled sum or monthly multiple of the answer's own figures is not unsourced", () => {
    const text = "Living costs £1,203 a month for 9 months: £10,827. With tuition of £15,500 that is £26,327.";
    expect(checkAnswerFigures(text, { evidence: ["£1,203 per month"], input: "Tuition £15,500" }).note).toBeNull();
  });
});
