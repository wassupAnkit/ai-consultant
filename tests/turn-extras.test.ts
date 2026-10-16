import { describe, expect, test } from "bun:test";
import type { GenerateRequest, GenerateResult } from "../src/llm/generate";
import { cleanFollowUps, cleanTitle, fallbackTitle, FOLLOW_UPS_MAX, GeminiTurnExtras, TITLE_MAX_CHARS } from "../src/app/turn-extras";

describe("cleanTitle", () => {
  test("strips the decoration small models add", () => {
    expect(cleanTitle('"Monash MIT fees 2026."')).toBe("Monash MIT fees 2026");
    expect(cleanTitle("Title: **ECU nursing IELTS**\n")).toBe("ECU nursing IELTS");
    expect(cleanTitle("  ‘Priya’s CAS timeline’  ")).toBe("Priya’s CAS timeline");
  });

  test("rejects empty and placeholder titles", () => {
    expect(cleanTitle("")).toBeNull();
    expect(cleanTitle("   ")).toBeNull();
    expect(cleanTitle("Untitled")).toBeNull();
    expect(cleanTitle("New chat")).toBeNull();
    expect(cleanTitle(42)).toBeNull();
  });

  test("caps the length at a word boundary", () => {
    const long = "word ".repeat(40).trim();
    const t = cleanTitle(long)!;
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX_CHARS);
    expect(t.endsWith("word")).toBe(true);
  });
});

describe("cleanFollowUps", () => {
  const ctx = { message: "What IELTS does ECU require for nursing?" };

  test("accepts a bare array or an {items} object and punctuates as questions", () => {
    expect(cleanFollowUps(["Which pathway if the score is short", "Deadline for July intake."], ctx)).toEqual(["Which pathway if the score is short?", "Deadline for July intake?"]);
    expect(cleanFollowUps({ items: ["Fees for the same course?"] }, ctx)).toEqual(["Fees for the same course?"]);
  });

  test("drops blanks, duplicates, restatements of the question, and over-long items", () => {
    const out = cleanFollowUps(
      ["", "  ", "Fees?", "fees", "What IELTS does ECU require for nursing", "x".repeat(200), "1. Does ECU accept PTE?", "**Scholarships available?**"],
      ctx,
    );
    expect(out).toEqual(["Fees?", "Does ECU accept PTE?", "Scholarships available?"]);
  });

  test("never returns more than the chip limit", () => {
    expect(cleanFollowUps(["A?", "B?", "C?", "D?", "E?"], ctx)).toHaveLength(FOLLOW_UPS_MAX);
  });

  test("tolerates garbage", () => {
    expect(cleanFollowUps(null, ctx)).toEqual([]);
    expect(cleanFollowUps("not a list", ctx)).toEqual([]);
    expect(cleanFollowUps({ items: [1, null, {}] }, ctx)).toEqual([]);
  });
});

describe("fallbackTitle", () => {
  test("is the collapsed first 80 characters of the message", () => {
    expect(fallbackTitle("  what   is\nthe fee  ")).toBe("what is the fee");
    expect(fallbackTitle("a".repeat(100))).toHaveLength(80);
  });
});

describe("GeminiTurnExtras", () => {
  const gen = (reply: (req: GenerateRequest) => Partial<GenerateResult> | Promise<Partial<GenerateResult>>) => ({
    generate: async (req: GenerateRequest): Promise<GenerateResult> => ({ text: "", finishReason: "STOP", usage: { input: 0, output: 0, total: 0 }, ...(await reply(req)) }),
  });

  test("returns the structured title and follow-ups, on the configured model", async () => {
    const seen: GenerateRequest[] = [];
    const extras = new GeminiTurnExtras({
      gen: gen((req) => {
        seen.push(req);
        return req.system?.includes("name conversations") ? { json: { title: '"ECU nursing IELTS"' } } : { json: { items: ["Does ECU accept PTE", "Fees for the July intake?"] } };
      }),
      model: "gemini-test-lite",
    });
    expect(await extras.title({ message: "What IELTS does ECU require?", answer: "IELTS 7.0 [1]." })).toBe("ECU nursing IELTS");
    expect(await extras.followUps({ message: "What IELTS does ECU require?", answer: "IELTS 7.0 [1].", intent: { primary: "admission_requirements", task: "lookup" } })).toEqual([
      "Does ECU accept PTE?",
      "Fees for the July intake?",
    ]);
    expect(seen.every((r) => r.model === "gemini-test-lite" && r.responseSchema)).toBe(true);
    expect(seen[1]!.parts[0]).toMatchObject({ text: expect.stringContaining("Task: lookup | Topic: admission_requirements") });
  });

  test("falls back to the raw text when the JSON is missing, and to nothing when the call fails", async () => {
    const text = new GeminiTurnExtras({ gen: gen(() => ({ text: "Monash MIT fees" })), model: "m" });
    expect(await text.title({ message: "m", answer: "a" })).toBe("Monash MIT fees");
    const failing = new GeminiTurnExtras({
      gen: gen(() => {
        throw new Error("503");
      }),
      model: "m",
    });
    expect(await failing.title({ message: "m", answer: "a" })).toBeNull();
    expect(await failing.followUps({ message: "m", answer: "a", intent: null })).toEqual([]);
  });

  test("guided: step-scoped chips, and a reason only when the step is judged settled", async () => {
    const seen: GenerateRequest[] = [];
    const step = { label: "Destination", goal: "Which country fits.", checklist: ["Which countries?"] };
    const settled = new GeminiTurnExtras({
      gen: gen((req) => {
        seen.push(req);
        return { json: { items: ["Compare AU and CA cost", "Draft a WhatsApp on PR goals?"], stepComplete: true, reason: "  **Australia** is chosen and on her deal.  " } };
      }),
      model: "m",
    });
    expect(await settled.guided({ message: "Which fits?", answer: "Australia [1].", step, studentFacts: "Sita — deal destinations Australia", missing: [] })).toEqual({
      followUps: ["Compare AU and CA cost?", "Draft a WhatsApp on PR goals?"],
      stepComplete: true,
      reason: "Australia is chosen and on her deal.",
    });
    const sent = (seen[0]!.parts[0] as { text: string }).text;
    expect(sent).toContain("Step: Destination");
    expect(sent).toContain("Still empty in the CRM for this step: nothing");

    // Anything but a literal true is "not settled", and then no reason is kept.
    const vague = new GeminiTurnExtras({ gen: gen(() => ({ json: { items: ["A?"], stepComplete: "yes", reason: "maybe" } })), model: "m" });
    expect(await vague.guided({ message: "m", answer: "a", step, studentFacts: null, missing: ["Destination countries"] })).toEqual({ followUps: ["A?"], stepComplete: false, reason: null });

    const failing = new GeminiTurnExtras({
      gen: gen(() => {
        throw new Error("503");
      }),
      model: "m",
    });
    expect(await failing.guided({ message: "m", answer: "a", step, studentFacts: null, missing: [] })).toEqual({ followUps: [], stepComplete: false, reason: null });
  });
});
