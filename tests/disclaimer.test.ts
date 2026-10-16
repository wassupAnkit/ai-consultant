import { describe, expect, test } from "bun:test";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { adviserFor, ADVISER_HEADING, adviserInstruction, disclaimerFor, INTENT_PLAYBOOKS } from "../src/prompts/intents";
import { PRIMARY_INTENTS } from "../src/schemas/intent.schema";
import { fakeGraph, intentOf } from "./helpers";

// South Asia audit (Oct 2026): ~15 UK/US/Canada answers said "MARN-registered agent", which is
// Australia's register only. The adviser named depends on the destination.
describe("destination-specific migration adviser", () => {
  const visa = { primary_intent: "visa_process" as const, secondary_intents: [] };

  test("each destination names its own regulated adviser", () => {
    expect(disclaimerFor(visa, ["australia"])).toBe("Case-specific visa advice must be confirmed by a MARN-registered migration agent.");
    expect(disclaimerFor(visa, ["united_kingdom"])).toContain("OISC");
    expect(disclaimerFor(visa, ["canada"])).toContain("RCIC");
    expect(disclaimerFor(visa, ["canada"])).toContain("CICC");
    expect(disclaimerFor(visa, ["new_zealand"])).toContain("IAA");
    expect(disclaimerFor(visa, ["new_zealand"])).toContain("offshore");
    expect(disclaimerFor(visa, ["united_states"])).toContain("DSO");
    expect(disclaimerFor(visa, ["united_states"])).toContain("immigration attorney");
    for (const d of ["united_kingdom", "canada", "new_zealand", "united_states"] as const) expect(disclaimerFor(visa, [d])).not.toContain("MARN");
  });

  test("several destinations name each one's adviser", () => {
    const text = disclaimerFor({ primary_intent: "migration_pathway", secondary_intents: [] }, ["australia", "canada", "united_kingdom"])!;
    expect(text).toContain("Australia: a MARN-registered migration agent");
    expect(text).toContain("Canada: ");
    expect(text).toContain("United Kingdom: ");
  });

  test("a destination without a licensing scheme on file, and no destination", () => {
    expect(adviserFor(["germany"])).toContain("Germany");
    expect(adviserFor(["germany"])).not.toContain("MARN");
    expect(adviserFor([])).toContain("for the destination");
    expect(adviserFor(["other"])).toContain("for the destination");
  });

  test("topics without a migration disclaimer keep theirs or none", () => {
    expect(disclaimerFor({ primary_intent: "compliance_ethics", secondary_intents: [] }, ["united_kingdom"])).toBe("Confirm with the branch compliance lead before acting on this.");
    expect(disclaimerFor({ primary_intent: "financial_viability", secondary_intents: [] }, ["canada"])).toBeUndefined();
  });

  test("playbooks no longer hard-code the Australian register as the only adviser", () => {
    for (const i of PRIMARY_INTENTS) expect([i, /must (?:be )?confirm(?:ed)? by a MARN-registered/.test(INTENT_PLAYBOOKS[i])]).toEqual([i, false]);
  });

  test("the answer node uses the turn's destinations, in the disclaimer and in a per-turn adviser line", async () => {
    const seen: BaseMessage[][] = [];
    const model = RunnableLambda.from(async (m: BaseMessage[]) => (seen.push(m), new AIMessage("Lodge on UKVI [1].")));
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "visa_process", destinations: ["united_kingdom"], needs_research: false }), answerModel: model });
    const state = await graph.invoke({ input: "UK student visa steps?", history: [], sessionId: "s1", profile: null });
    expect(state.disclaimer).toContain("OISC");
    expect(state.disclaimer).not.toContain("MARN");
    const system = String(seen[0]![0]!.content);
    expect(system).toContain(adviserInstruction(["united_kingdom"]));
    expect(system.indexOf(ADVISER_HEADING)).toBeGreaterThan(system.indexOf("<knowledge_base>"));
  });
});
