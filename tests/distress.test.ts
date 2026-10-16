import { describe, expect, test } from "bun:test";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { DISTRESS_HEADING, helplinePlaces, isOfficialOrNgoHost } from "../src/graph/helpline";
import { detectDistress } from "../src/safety/distress";
import type { WebSearcher } from "../src/tools/web-search";
import { fakeGraph, intentOf } from "./helpers";

// South Asia audit (Oct 2026): the Bengali "ami r parchi na… kono kaj er na" and the Hinglish
// "sab khatam" got no self-harm check or helpline; Romanized Nepali "ma marchu hola" did.
describe("detectDistress", () => {
  const cases: [string, string, boolean][] = [
    // [message, language, selfHarm]
    ["my student said she wants to die after the refusal", "english", true],
    ["he keeps saying he can't go on", "english", false],
    ["ma marchu hola aba", "nepali", true],
    ["visa refuse bhayo, aba sakdina bhanchha", "nepali", false],
    ["मलाई बाँच्न मन छैन", "nepali", true],
    ["visa reject ho gaya, bol raha hai mar jaunga", "hindi", true],
    ["student bol raha hai sab khatam ho gaya", "hindi", false],
    ["वह कहता है जीना नहीं चाहता", "hindi", true],
    ["छात्र कह रहा है सब खत्म हो गया", "hindi", false],
    ["ami r parchi na… kono kaj er na", "bengali", false],
    ["she says bachte chai na", "bengali", true],
    ["আমি আর পারছি না", "bengali", false],
    ["ও বলছে আত্মহত্যা করবে", "bengali", true],
    ["em ấy nói muốn chết", "vietnamese", true],
    ["em ấy thấy tuyệt vọng lắm", "vietnamese", false],
    ["sabi niya gusto ko nang mamatay", "tagalog", true],
    ["hindi ko na kaya, sobrang stressed", "tagalog", false],
    ["น้องบอกว่าอยากตาย", "thai", true],
    ["น้องบอกว่าไม่ไหวแล้ว", "thai", false],
    ["ඔහු කියනවා මැරෙන්න ඕනේ කියලා", "sinhala", true],
    ["அவன் தற்கொலை பற்றி பேசுகிறான்", "tamil", true],
    ["அவளுக்கு இனி முடியாது என்கிறாள்", "tamil", false],
  ];

  test.each(cases)("%s → %s (self-harm: %p)", (message, language, selfHarm) => {
    expect(detectDistress(message)).toMatchObject({ language, selfHarm });
  });

  test("ordinary worry and look-alike words are not distress", () => {
    for (const message of [
      "Student is nervous about the visa interview",
      "Are there more jobs in Sydney or Melbourne?",
      "The deadline is killing me, can you draft the SOP?",
      "sab documents ready hai, kya karna hai?",
      "Visa process khatam hone mein kitna time lagega?",
      "Can she work part-time?",
      "",
    ]) {
      expect([message, detectDistress(message)]).toEqual([message, null]);
    }
  });

  test("a self-harm cue wins over a distress cue in the same message", () => {
    expect(detectDistress("hopeless, says he will kill himself")).toMatchObject({ selfHarm: true, cue: "kill himself" });
  });
});

describe("helpline places and hosts", () => {
  test("home market and current location", () => {
    expect(helplinePlaces({ origin: "bangladesh", onshore: null, countries: [] }, [])).toEqual(["Bangladesh"]);
    expect(helplinePlaces({ origin: "nepal", onshore: "australia", countries: [] }, [])).toEqual(["Australia", "Nepal"]);
    expect(helplinePlaces({ origin: "india", onshore: null, countries: ["canada"] }, ["already_abroad"])).toEqual(["Canada", "India"]);
    expect(helplinePlaces({ origin: "india", onshore: null, countries: ["canada"] }, [])).toEqual(["India"]);
    expect(helplinePlaces(null, [])).toEqual([]);
  });

  test("only official or NGO hosts count as helpline evidence", () => {
    expect(isOfficialOrNgoHost("https://www.lifeline.org.au/131114")).toBe(true);
    expect(isOfficialOrNgoHost("https://dghs.gov.bd/helpline")).toBe(true);
    expect(isOfficialOrNgoHost("https://www.nhs.uk/mental-health/")).toBe(true);
    expect(isOfficialOrNgoHost("https://www.who.int/")).toBe(true);
    expect(isOfficialOrNgoHost("https://random-blog.com/helplines")).toBe(false);
    expect(isOfficialOrNgoHost("not a url")).toBe(false);
  });
});

describe("a distress turn", () => {
  const searcher = () => {
    const calls: { query: string; site?: string }[] = [];
    const web: WebSearcher = {
      async search(query, o) {
        calls.push({ query, site: o.site });
        return {
          query,
          summary: "",
          queries: [query],
          fromCache: false,
          results: [
            { url: "https://dghs.gov.bd/mental-health-helpline", title: "National mental health helpline", snippet: "Call the national helpline, open 24 hours.", allowed: true },
            { url: "https://some-listicle.com/helplines", title: "Top helplines", snippet: "A list of numbers.", allowed: true },
          ],
        };
      },
    };
    return { web, calls };
  };
  const recordingAnswer = () => {
    const seen: BaseMessage[][] = [];
    return { seen, model: RunnableLambda.from(async (m: BaseMessage[]) => (seen.push(m), new AIMessage("Safety first."))) };
  };

  test("is flagged, researched for helplines (official/NGO only) and answered safety-first", async () => {
    const { web, calls } = searcher();
    const { seen, model } = recordingAnswer();
    // The classifier missed it: no flag, no lookup.
    const intent = intentOf({ primary_intent: "general_inquiry", needs_research: false, contextual_flags: [], destinations: [] });
    const { graph } = fakeGraph({ intent, answerModel: model, tools: { web }, research: { maxRounds: 0 } });
    const state = await graph.invoke({ input: "Bangladeshi student messaged: ami r parchi na… kono kaj er na", history: [], sessionId: "s1", profile: null });
    expect(state.intent!.contextual_flags).toContain("emotional_distress");
    expect(state.intent!.needs_research).toBe(true);
    expect(state.meta.distress).toEqual({ selfHarm: false, language: "bengali", cue: "r parchi na" });
    expect(calls.map((c) => c.query)).toEqual(["Bangladesh mental health crisis helpline official"]);
    const urls = state.evidence.map((e: { url: string }) => e.url);
    expect(urls).toContain("https://dghs.gov.bd/mental-health-helpline");
    expect(urls).not.toContain("https://some-listicle.com/helplines");
    expect(state.meta.helplineSearch).toEqual({ places: ["Bangladesh"], added: 1 });
    const system = String(seen[0]![0]!.content);
    expect(system).toContain(DISTRESS_HEADING);
    expect(system).toContain("Bangladesh");
  });

  test("a self-harm cue also raises the crisis_safeguarding signal", async () => {
    const extrasClassifier = RunnableLambda.from(async () => ({
      ...intentOf({ primary_intent: "general_inquiry", needs_research: false }),
      extras: { classifier: "jev", signals: [] },
    }));
    const { graph } = fakeGraph({ intent: intentOf({}), classifier: extrasClassifier, research: { maxRounds: 0 } });
    const state = await graph.invoke({ input: "student bol raha hai mar jaunga", history: [], sessionId: "s1", profile: null });
    expect(state.meta.distress).toMatchObject({ selfHarm: true, language: "hindi" });
    expect(state.intentExtras!.signals).toContain("crisis_safeguarding");
  });

  test("an ordinary turn carries no safety block", async () => {
    const { seen, model } = recordingAnswer();
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "general_inquiry", needs_research: false }), answerModel: model });
    const state = await graph.invoke({ input: "Can she work part-time?", history: [], sessionId: "s1", profile: null });
    expect(state.meta.distress).toBeUndefined();
    expect(String(seen[0]![0]!.content)).not.toContain(DISTRESS_HEADING);
  });
});
