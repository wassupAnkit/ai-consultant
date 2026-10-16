import { describe, expect, test } from "bun:test";
import { extractDestinations } from "../src/routing/countries";
import { extractOrigin, MARKET_LABELS, MARKETS, marketFromName, marketFromProfile } from "../src/routing/markets";
import { decideRoute, priorOriginOf } from "../src/routing/route";
import type { ClassifierExtras } from "../src/schemas/intent.schema";
import { intentOf } from "./helpers";

describe("market registry", () => {
  test("seven source markets with labels", () => {
    expect([...MARKETS]).toEqual(["nepal", "india", "bangladesh", "vietnam", "philippines", "thailand", "sri_lanka"]);
    expect(MARKET_LABELS.sri_lanka).toBe("Sri Lanka");
    expect(MARKET_LABELS.philippines).toBe("Philippines");
  });
});

describe("extractOrigin", () => {
  test("country names and demonyms", () => {
    expect(extractOrigin("Nepali student wants a master's in Sydney")).toBe("nepal");
    expect(extractOrigin("a Nepalese applicant")).toBe("nepal");
    expect(extractOrigin("Indian student with a 3-year BCom")).toBe("india");
    expect(extractOrigin("Bangladeshi family, son wants Brisbane")).toBe("bangladesh");
    expect(extractOrigin("Vietnamese student, CAS question")).toBe("vietnam");
    expect(extractOrigin("Filipina nurse wants to study in Canada")).toBe("philippines");
    expect(extractOrigin("a Filipino applicant")).toBe("philippines");
    expect(extractOrigin("pinoy student")).toBe("philippines");
    expect(extractOrigin("Sri Lankan student, A/L results")).toBe("sri_lanka");
    expect(extractOrigin("student in Sri Lanka")).toBe("sri_lanka");
    expect(extractOrigin("a student from Viet Nam")).toBe("vietnam");
  });

  test("cities", () => {
    expect(extractOrigin("student from Kathmandu")).toBe("nepal");
    expect(extractOrigin("our Pokhara branch has a lead")).toBe("nepal");
    expect(extractOrigin("from Punjab, wants Canada")).toBe("india");
    expect(extractOrigin("a lead in Delhi")).toBe("india");
    expect(extractOrigin("Hyderabad student, US MS")).toBe("india");
    expect(extractOrigin("parents in Dhaka")).toBe("bangladesh");
    expect(extractOrigin("Hanoi student")).toBe("vietnam");
    expect(extractOrigin("based in HCMC")).toBe("vietnam");
    expect(extractOrigin("from Saigon")).toBe("vietnam");
    expect(extractOrigin("Ho Chi Minh City applicant")).toBe("vietnam");
    expect(extractOrigin("Manila office lead")).toBe("philippines");
    expect(extractOrigin("student from Cebu")).toBe("philippines");
    expect(extractOrigin("Colombo student")).toBe("sri_lanka");
  });

  test("first mention wins", () => {
    expect(extractOrigin("Indian national living in Nepal")).toBe("india");
    expect(extractOrigin("Kathmandu-born, now in Delhi")).toBe("nepal");
  });

  // Counsellor audit (Oct 2026): a walk-in at the Makati branch who is an Indian national routed
  // origin=philippines because the first match (Makati) won. Nationality beats a city mention;
  // a city after a location cue ("our … branch", "currently in") is where someone is, not origin.
  test("an explicit nationality beats city mentions", () => {
    expect(
      extractOrigin(
        "Different case — walk-in at our Makati branch is an Indian national, 23, from Kerala, BSc Nursing from a college in Bangalore, currently in Manila doing a review course. Options for NZ?",
      ),
    ).toBe("india");
    expect(extractOrigin("Nepali student in Sydney")).toBe("nepal");
    expect(extractOrigin("student from Pokhara")).toBe("nepal");
    expect(extractOrigin("our Kathmandu branch has a Thai student")).toBe("thailand");
    expect(extractOrigin("Dhaka office: a Nepali applicant wants Canada")).toBe("nepal");
    expect(extractOrigin("Manila office: our Nepali student wants Canada")).toBe("nepal");
    expect(extractOrigin("currently in Manila, citizen of Sri Lanka")).toBe("sri_lanka");
    expect(extractOrigin("a Bangladeshi student currently in Nepal")).toBe("bangladesh");
    expect(extractOrigin("studying in Delhi, from Chittagong")).toBe("bangladesh");
    expect(extractOrigin("living in Hanoi, holds a Filipino passport")).toBe("philippines");
  });

  test("a city counts when nothing stronger is said, and the earliest of equals wins", () => {
    expect(extractOrigin("our Cebu branch has a lead")).toBe("philippines");
    expect(extractOrigin("Hyderabad student, Dhaka cousin")).toBe("india");
    expect(extractOrigin("a Pokhara student with an Indian passport")).toBe("india");
    expect(extractOrigin("Nepali student, Indian partner")).toBe("nepal");
  });

  test("Thailand: a destination unless the message marks it as the origin", () => {
    expect(extractOrigin("Can a Nepali student study in Thailand?")).toBe("nepal");
    expect(extractOrigin("study in Thailand for a year")).toBeNull();
    expect(extractOrigin("Thailand or Malaysia for a cheap bachelor?")).toBeNull();
    expect(extractOrigin("campus in Bangkok")).toBeNull();
    expect(extractOrigin("A Thai student wants to study in Australia")).toBe("thailand");
    expect(extractOrigin("student from Thailand going to the UK")).toBe("thailand");
    expect(extractOrigin("from Bangkok, applying to Melbourne")).toBe("thailand");
    expect(extractOrigin("citizen of Thailand")).toBe("thailand");
    // "Thai" naming Thailand's own institutions or visa is about the destination.
    expect(extractOrigin("Thai universities for an Indian student")).toBe("india");
    expect(extractOrigin("Thai student visa rules")).toBeNull();
    // Agrees with destination routing on the same messages.
    expect(extractDestinations("A Thai student wants to study in Australia")).toEqual(["australia"]);
    expect(extractDestinations("from Bangkok, applying to Melbourne")).toEqual([]);
  });

  test("whole words only", () => {
    expect(extractOrigin("Indiana University for a US student")).toBeNull();
    expect(extractOrigin("Thaisa wants nursing")).toBeNull();
    expect(extractOrigin("thailandish")).toBeNull();
    expect(extractOrigin("")).toBeNull();
    expect(extractOrigin("What is the AU student visa fee?")).toBeNull();
  });

  test("scripts", () => {
    expect(extractOrigin("मलाई अष्ट्रेलियाको भिसाको बारेमा जान्न मन छ")).toBe("nepal");
    expect(extractOrigin("विद्यार्थीहरूलाई कति पैसा चाहिन्छ?")).toBe("nepal");
    expect(extractOrigin("मुझे ऑस्ट्रेलिया के वीज़ा के बारे में जानना है, क्या करना चाहिए?")).toBe("india");
    expect(extractOrigin("আমার ছেলে অস্ট্রেলিয়ায় পড়তে চায়")).toBe("bangladesh");
    expect(extractOrigin("ลูกชายอยากเรียนต่อที่ออสเตรเลีย")).toBe("thailand");
    expect(extractOrigin("Con tôi muốn du học Úc, cần chuẩn bị những gì?")).toBe("vietnam");
    expect(extractOrigin("මගේ පුතාට ඕස්ට්‍රේලියාවේ ඉගෙන ගන්න ඕනේ")).toBe("sri_lanka");
    expect(extractOrigin("என் மகன் ஆஸ்திரேலியாவில் படிக்க விரும்புகிறான்")).toBe("sri_lanka");
    // One stray accented letter is not Vietnamese.
    expect(extractOrigin("café near campus")).toBeNull();
  });

  test("Romanized Nepali vs Hinglish (two distinct cues needed)", () => {
    expect(extractOrigin("visa ko lagi kati paisa chahincha?")).toBe("nepal");
    expect(extractOrigin("AU ma padhna milcha ki nai, k garne?")).toBe("nepal");
    expect(extractOrigin("bank loan bhayeko cha")).toBe("nepal");
    expect(extractOrigin("visa ke liye kitna paisa chahiye? kya karna hai")).toBe("india");
    expect(extractOrigin("mujhe Canada jana hai, kaise apply karna?")).toBe("india");
    // A single cue is not enough.
    expect(extractOrigin("the ko of the deal")).toBeNull();
    expect(extractOrigin("hai there")).toBeNull();
  });
});

describe("marketFromName / marketFromProfile", () => {
  test("CRM-style free text, codes and places", () => {
    expect(marketFromName("Nepal")).toBe("nepal");
    expect(marketFromName("  nepali ")).toBe("nepal");
    expect(marketFromName("NP")).toBe("nepal");
    expect(marketFromName("IND")).toBe("india");
    expect(marketFromName("Thailand")).toBe("thailand");
    expect(marketFromName("Bangkok")).toBe("thailand");
    expect(marketFromName("Philippines (Manila)")).toBe("philippines");
    expect(marketFromName("Sri Lanka")).toBe("sri_lanka");
    expect(marketFromName("Australia")).toBeNull();
    expect(marketFromName("already in Melbourne on a student visa")).toBeNull();
    expect(marketFromName(null)).toBeNull();
    expect(marketFromName("")).toBeNull();
  });

  test("profile market or office", () => {
    expect(marketFromProfile({ market: "Vietnam" })).toBe("vietnam");
    expect(marketFromProfile({ office: "Expert Education Kathmandu" })).toBe("nepal");
    expect(marketFromProfile({ office: { name: "Colombo" } })).toBe("sri_lanka");
    expect(marketFromProfile({ market: "", office: "Bangkok" })).toBe("thailand");
    expect(marketFromProfile({ role: "Nepal counsellor" })).toBeNull();
    expect(marketFromProfile(null)).toBeNull();
  });
});

describe("decideRoute: origin", () => {
  const extras = (over: Partial<ClassifierExtras>): ClassifierExtras => ({
    classifier: "jev",
    audience: "consultant",
    channel: "chat_answer",
    stage: "unspecified",
    signals: [],
    intent_confidence: 0.9,
    probabilities: {},
    model: null,
    latencyMs: null,
    cost: null,
    fallbackReason: null,
    references_prior_turn: false,
    ...over,
  });

  test("none anywhere: null origin and source", () => {
    const r = decideRoute({ intent: intentOf({}), extras: null, input: "AU student visa fee?", history: [] });
    expect(r.origin).toBeNull();
    expect(r.originSource).toBeNull();
  });

  test("CRM nationality beats the message, the classifier, history and the profile", () => {
    const r = decideRoute({ intent: intentOf({ origin: "India" }), extras: null, input: "Bangladeshi student?", history: ["x"], priorOrigin: "vietnam", guideOrigin: "nepal", profile: { market: "Thailand" } });
    expect([r.origin, r.originSource]).toEqual(["nepal", "crm"]);
  });

  test("the Makati walk-in who is an Indian national routes to India, not the branch's market", () => {
    const input = "Different case — walk-in at our Makati branch is an Indian national, 23, from Kerala, BSc Nursing from a college in Bangalore, currently in Manila doing a review course…";
    const r = decideRoute({ intent: intentOf({}), extras: null, input, history: [] });
    expect([r.origin, r.originSource]).toEqual(["india", "keywords"]);
  });

  test("message beats the classifier", () => {
    const r = decideRoute({ intent: intentOf({ origin: "India" }), extras: null, input: "Bangladeshi student wants Sydney", history: [], profile: { market: "Nepal" } });
    expect([r.origin, r.originSource]).toEqual(["bangladesh", "keywords"]);
  });

  test("classifier free text is mapped; text it cannot map falls through", () => {
    expect(decideRoute({ intent: intentOf({ origin: "Nepal" }), extras: null, input: "visa fee?", history: [] })).toMatchObject({ origin: "nepal", originSource: "classifier" });
    expect(decideRoute({ intent: intentOf({ origin: "already in Melbourne" }), extras: null, input: "visa fee?", history: [], profile: { office: "Hanoi" } })).toMatchObject({ origin: "vietnam", originSource: "profile" });
  });

  test("a classifier origin that is this turn's destination is ignored", () => {
    const r = decideRoute({ intent: intentOf({ origin: "Thailand", destinations: ["thailand"] }), extras: null, input: "study in Thailand?", history: [] });
    expect(r.countries).toEqual(["thailand"]);
    expect(r.origin).toBeNull();
  });

  test("history only on a follow-up, before the profile", () => {
    const follow = decideRoute({ intent: intentOf({}), extras: null, input: "what about fees?", history: ["q", "a"], priorOrigin: "india", profile: { market: "Nepal" } });
    expect([follow.origin, follow.originSource]).toEqual(["india", "history"]);
    const fresh = decideRoute({ intent: intentOf({}), extras: null, input: "What documents does a student need for the bank loan application?", history: ["q", "a"], priorOrigin: "india", profile: { market: "Nepal" } });
    expect([fresh.origin, fresh.originSource]).toEqual(["nepal", "profile"]);
    const flagged = decideRoute({ intent: intentOf({}), extras: extras({ references_prior_turn: true }), input: "What documents does a student need for the bank loan application?", history: ["q"], priorOrigin: "india" });
    expect(flagged.originSource).toBe("history");
  });

  test("a follow-up without a stored origin reads the last two history messages", () => {
    const r = decideRoute({ intent: intentOf({}), extras: null, input: "and the fees?", history: ["older", "Nepali student, AU visa?", "Here it is."] });
    expect([r.origin, r.originSource]).toEqual(["nepal", "history"]);
  });

  test("priorOriginOf reads the newest AI turn's route", () => {
    const at = new Date();
    expect(priorOriginOf([])).toBeNull();
    expect(priorOriginOf([{ role: "ai", content: "a", createdAt: at, metadata: { route: { countries: [], origin: "nepal" } } }])).toBe("nepal");
    expect(priorOriginOf([{ role: "ai", content: "a", createdAt: at, metadata: { route: { countries: [], origin: "atlantis" } } }])).toBeNull();
    expect(
      priorOriginOf([
        { role: "ai", content: "a", createdAt: at, metadata: { route: { origin: "india" } } },
        { role: "human", content: "b", createdAt: at },
        { role: "ai", content: "c", createdAt: at, metadata: { route: { countries: ["australia"] } } },
      ]),
    ).toBeNull();
  });
});
