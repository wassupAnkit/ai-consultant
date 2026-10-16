import { describe, expect, test } from "bun:test";
import { COUNTRIES, COUNTRY_LABELS, destinationsFromNames, extractDestinations, originOnlyDestinations } from "../src/routing/countries";
import { decideRoute, isFollowUp, priorDestinationsOf } from "../src/routing/route";
import { DESTINATIONS, type ClassifierExtras } from "../src/schemas/intent.schema";
import { intentOf } from "./helpers";

describe("country registry", () => {
  test("covers every destination except other, with labels", () => {
    expect(Object.keys(COUNTRIES).sort()).toEqual(DESTINATIONS.filter((d) => d !== "other").sort());
    expect(COUNTRY_LABELS.united_kingdom).toBe("United Kingdom");
    expect(COUNTRY_LABELS.uae).toBe("United Arab Emirates");
  });

  test("names match case-insensitively, ordered by first occurrence", () => {
    expect(extractDestinations("compare canada and AUSTRALIA for nursing")).toEqual(["canada", "australia"]);
    expect(extractDestinations("an aussie uni or one in Holland?")).toEqual(["australia", "netherlands"]);
    expect(extractDestinations("Study in England, Scotland or Wales")).toEqual(["united_kingdom"]);
    expect(extractDestinations("jobs in Dubai and Abu Dhabi")).toEqual(["uae"]);
    // Romanized Nepali "dubai" = "both".
    expect(extractDestinations("Australia ko lagi tuition ra living dubai dekhaunu parcha?")).toEqual(["australia"]);
    expect(extractDestinations("Thailand, Malaysia, Germany, Ireland, New Zealand")).toEqual(["thailand", "malaysia", "germany", "ireland"]);
  });

  test("returns at most four countries, each once", () => {
    expect(extractDestinations("UK US Canada Australia Germany UK")).toEqual(["united_kingdom", "united_states", "canada", "australia"]);
  });

  test("short codes are case-sensitive: lowercase us is a pronoun", () => {
    expect(extractDestinations("can you help us with the visa")).toEqual([]);
    expect(extractDestinations("tell us about it")).toEqual([]);
    expect(extractDestinations("is the US cheaper than the UK?")).toEqual(["united_states", "united_kingdom"]);
    expect(extractDestinations("USA or NZ or UAE or AU")).toEqual(["united_states", "new_zealand", "uae", "australia"]);
    expect(extractDestinations("au pair jobs")).toEqual([]);
  });

  test("word boundaries: no matches inside other words", () => {
    expect(extractDestinations("Thaisa wants a usability course; casual work in Germanyville")).toEqual([]);
    expect(extractDestinations("US-based employer")).toEqual(["united_states"]);
  });

  test("regions that contain a country name do not count as that country", () => {
    expect(extractDestinations("students from Latin America")).toEqual([]);
    expect(extractDestinations("study in America")).toEqual(["united_states"]);
    expect(extractDestinations("a campus in New South Wales")).toEqual(["australia"]);
    expect(extractDestinations("Belfast, Northern Ireland")).toEqual(["united_kingdom"]);
  });

  test("country vocabulary implies the country", () => {
    expect(extractDestinations("CAS letter delayed")).toEqual(["united_kingdom"]);
    expect(extractDestinations("I-20 not received yet")).toEqual(["united_states"]);
    expect(extractDestinations("PAL for Ontario")).toEqual(["canada"]);
    expect(extractDestinations("subclass 500 GS docs checklist")).toEqual(["australia"]);
    expect(extractDestinations("her CoE and OSHC")).toEqual(["australia"]);
    expect(extractDestinations("STEM OPT extension")).toEqual(["united_states"]);
    expect(extractDestinations("PGWP after a 1-year program")).toEqual(["canada"]);
    expect(extractDestinations("NZQA assessment")).toEqual(["new_zealand"]);
    expect(extractDestinations("UKVI BRP collection")).toEqual(["united_kingdom"]);
    expect(extractDestinations("SEVIS fee then DS-160")).toEqual(["united_states"]);
    expect(extractDestinations("already onshore on a 500 visa")).toEqual(["australia"]);
    expect(extractDestinations("subclass-500 or subclass500")).toEqual(["australia"]);
  });

  test("ambiguous words and lowercase acronyms never count", () => {
    expect(extractDestinations("PR points for GS and the visa")).toEqual([]);
    expect(extractDestinations("opt in to the newsletter, pal; cas")).toEqual([]);
  });

  test("a country named as the student's origin is not a destination", () => {
    expect(extractDestinations("Student from Thailand accepted her offer at a Sydney uni, CoE timing?")).toEqual(["australia"]);
    expect(extractDestinations("A Thai student wants to study in Australia")).toEqual(["australia"]);
    expect(extractDestinations("citizen of Malaysia applying for the UK Student visa")).toEqual(["united_kingdom"]);
    expect(extractDestinations("Can a Nepali student study in Thailand?")).toEqual(["thailand"]);
    expect(originOnlyDestinations("Student from Thailand going to Australia")).toEqual(["thailand"]);
    // Named both ways: still a destination.
    expect(originOnlyDestinations("Student from Thailand wants to stay in Thailand for a master's")).toEqual([]);
  });

  test("CRM free-text country names map to destination slugs", () => {
    expect(destinationsFromNames(["Australia", "UK", "usa", "us", "Dubai", "Great Britain", "Mars"])).toEqual(["australia", "united_kingdom", "united_states", "uae"]);
    expect(destinationsFromNames(["United States of America", "nz", "England"])).toEqual(["united_states", "new_zealand", "united_kingdom"]);
  });
});

const extras = (p: Partial<ClassifierExtras>): ClassifierExtras => ({
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
  ...p,
});

describe("decideRoute", () => {
  test("classifier countries first, then keyword countries; other is dropped", () => {
    const r = decideRoute({ intent: intentOf({ destinations: ["canada", "other"] }), extras: null, input: "Canada or the UK?", history: [] });
    expect(r.countries).toEqual(["canada", "united_kingdom"]);
    expect(r.countrySource).toEqual(["classifier", "keywords"]);
    expect(r.mode).toBe("single");
    expect(r.stage).toBe("unspecified");
  });

  test("the classifier's destinations lose a country the message names only as the origin", () => {
    const r = decideRoute({ intent: intentOf({ destinations: ["australia", "thailand"] }), extras: null, input: "Student from Thailand accepted a Sydney offer; CoE timing?", history: [] });
    expect(r.countries).toEqual(["australia"]);
  });

  test("the classifier's destinations lose the resolved origin market's own country", () => {
    const thai = decideRoute({ intent: intentOf({ destinations: ["united_kingdom", "thailand"] }), extras: null, input: "Thai student wants a master's in the UK. What does she need?", history: [] });
    expect(thai).toMatchObject({ countries: ["united_kingdom"], countrySource: ["classifier"], mode: "single", origin: "thailand", originSource: "keywords" });
    // The origin from the counsellor's region (a Bangkok branch) counts too.
    const bangkok = { market: "thailand" as const, onshore: null, branch: "Bangkok", source: "crm_branch" as const };
    const byRegion = decideRoute({ intent: intentOf({ destinations: ["united_kingdom", "thailand"] }), extras: null, input: "Student wants a master's in the UK", history: [], counsellorRegion: bangkok });
    expect(byRegion).toMatchObject({ countries: ["united_kingdom"], origin: "thailand", originSource: "counsellor" });
    // Only the home country was listed: no country left, and the classifier contributed none.
    const only = decideRoute({ intent: intentOf({ destinations: ["thailand"] }), extras: null, input: "Thai student asking about scholarships", history: [] });
    expect(only).toMatchObject({ countries: [], countrySource: [], mode: "none", origin: "thailand" });
    // With it dropped, the next layers still apply (a follow-up's carry-over).
    const carried = decideRoute({ intent: intentOf({ destinations: ["thailand"] }), extras: null, input: "and for a Thai student?", history: ["UK master's entry", "a"], priorDestinations: ["united_kingdom"] });
    expect(carried).toMatchObject({ countries: ["united_kingdom"], countrySource: ["history"], origin: "thailand" });
  });

  test("the origin market's country stays when the message names it as a place to study", () => {
    const route = (input: string) => decideRoute({ intent: intentOf({ destinations: ["thailand"] }), extras: null, input, history: [] });
    expect(route("Thai student wants to study in Thailand instead of abroad").countries).toEqual(["thailand"]);
    expect(route("Can a Thai student get into Thai universities with a GED?").countries).toEqual(["thailand"]);
    expect(route("Thai student considering a master's in Bangkok").countries).toEqual(["thailand"]);
    expect(route("Thai student from Bangkok, what are her options?").countries).toEqual([]);
    // A market that is not also a destination is untouched.
    const nepali = decideRoute({ intent: intentOf({ destinations: ["australia"] }), extras: null, input: "Nepali student, subclass 500 docs", history: [] });
    expect(nepali).toMatchObject({ countries: ["australia"], origin: "nepal" });
  });

  test("an onshore counsellor's question with no destination defaults to the onshore country", () => {
    const sydney = { market: null, onshore: "australia" as const, branch: "Sydney", source: "crm_branch" as const };
    const r = decideRoute({ intent: intentOf({ primary_intent: "onshore_support" }), extras: null, input: "Student wants to change provider after six months. What are the visa rules?", history: [], counsellorRegion: sydney });
    expect(r).toMatchObject({ countries: ["australia"], countrySource: ["onshore"], mode: "single", origin: null, onshore: "australia" });
    const london = decideRoute({ intent: intentOf({}), extras: null, input: "Can she switch course mid-year?", history: [], counsellorRegion: { market: null, onshore: "united_kingdom", branch: null, source: "timezone" } });
    expect(london).toMatchObject({ countries: ["united_kingdom"], countrySource: ["onshore"] });
    // A named destination wins; a stated origin clears the onshore flag, so no default either.
    expect(decideRoute({ intent: intentOf({ destinations: ["canada"] }), extras: null, input: "Canada PGWP rules?", history: [], counsellorRegion: sydney })).toMatchObject({ countries: ["canada"], countrySource: ["classifier"] });
    expect(decideRoute({ intent: intentOf({}), extras: null, input: "Nepali student wants to change provider", history: [], counsellorRegion: sydney })).toMatchObject({ countries: [], onshore: null });
  });

  test("comparison mode needs two countries and a comparison signal", () => {
    const compare = decideRoute({ intent: intentOf({ task: "compare", destinations: ["canada", "australia"] }), extras: null, input: "x", history: [] });
    expect(compare.mode).toBe("comparison");
    const byIntent = decideRoute({ intent: intentOf({ primary_intent: "comparative_decision", destinations: ["canada"] }), extras: null, input: "Canada vs Australia", history: [] });
    expect(byIntent.mode).toBe("comparison");
    const bySecondary = decideRoute({ intent: intentOf({ primary_intent: "career_roi", secondary_intents: ["comparative_decision"] }), extras: null, input: "UK vs Ireland ROI", history: [] });
    expect(bySecondary.mode).toBe("comparison");
    const oneCountry = decideRoute({ intent: intentOf({ task: "compare", destinations: ["canada"] }), extras: null, input: "compare two colleges", history: [] });
    expect(oneCountry.mode).toBe("single");
    const none = decideRoute({ intent: intentOf({ task: "compare" }), extras: null, input: "compare these two offers", history: [] });
    expect(none.mode).toBe("none");
    expect(none.countries).toEqual([]);
  });

  test("two countries without a comparison signal stay single, keeping both", () => {
    const r = decideRoute({ intent: intentOf({ task: "lookup" }), extras: null, input: "Student holds a UK degree, applying to Canada", history: [] });
    expect(r.countries).toEqual(["united_kingdom", "canada"]);
    expect(r.mode).toBe("single");
  });

  test("topic and stage come from the classifier", () => {
    const r = decideRoute({ intent: intentOf({ primary_intent: "visa_process" }), extras: extras({ stage: "visa_lodged" }), input: "CAS issue", history: [] });
    expect(r.topic).toBe("visa_process");
    expect(r.stage).toBe("visa_lodged");
  });

  test("a follow-up carries the previous turn's countries over", () => {
    const r = decideRoute({ intent: intentOf({}), extras: null, input: "what about fees?", history: ["Australia student visa rules", "Here they are."], priorDestinations: ["australia"] });
    expect(r.countries).toEqual(["australia"]);
    expect(r.countrySource).toEqual(["history"]);
  });

  test("without stored destinations the carry-over reads the last two history messages", () => {
    const r = decideRoute({ intent: intentOf({}), extras: null, input: "and the processing time?", history: ["old: Germany", "Tell me about the CAS process", "The CAS is issued by the university [1]."] });
    expect(r.countries).toEqual(["united_kingdom"]);
    expect(r.countrySource).toEqual(["history"]);
  });

  test("Jev's references_prior_turn triggers the carry-over for a long message", () => {
    const input = "Can you now write the full email to the student explaining the remaining documents and deadlines";
    const without = decideRoute({ intent: intentOf({}), extras: null, input, history: ["Canada SDS docs"], priorDestinations: ["canada"] });
    expect(without.countries).toEqual([]);
    const withFlag = decideRoute({ intent: intentOf({}), extras: extras({ references_prior_turn: true }), input, history: ["Canada SDS docs"], priorDestinations: ["canada"] });
    expect(withFlag.countries).toEqual(["canada"]);
  });

  test("no carry-over when the turn names its own country or there is no history", () => {
    const own = decideRoute({ intent: intentOf({}), extras: null, input: "and the UK?", history: ["Australia fees"], priorDestinations: ["australia"] });
    expect(own.countries).toEqual(["united_kingdom"]);
    const fresh = decideRoute({ intent: intentOf({}), extras: null, input: "what about fees?", history: [] });
    expect(fresh.countries).toEqual([]);
  });

  test("guided CRM countries are the last resort", () => {
    const r = decideRoute({ intent: intentOf({}), extras: null, input: "what documents are missing for this student's application", history: [], guideCountries: ["new_zealand"] });
    expect(r.countries).toEqual(["new_zealand"]);
    expect(r.countrySource).toEqual(["guide"]);
    const named = decideRoute({ intent: intentOf({ destinations: ["canada"] }), extras: null, input: "x", history: [], guideCountries: ["new_zealand"] });
    expect(named.countries).toEqual(["canada"]);
  });

  test("never more than four countries", () => {
    const r = decideRoute({ intent: intentOf({ destinations: ["canada", "australia", "germany"] }), extras: null, input: "UK and Ireland too", history: [] });
    expect(r.countries).toEqual(["canada", "australia", "germany", "united_kingdom"]);
  });

  test("follow-up heuristic", () => {
    expect(isFollowUp("what about fees?")).toBe(true);
    expect(isFollowUp("And for her brother")).toBe(true);
    expect(isFollowUp("same for masters")).toBe(true);
    expect(isFollowUp("Draft an email to the university admissions office about the deferred intake for this student")).toBe(false);
  });

  test("prior destinations come from the newest assistant message's route, then its intent", () => {
    const at = new Date();
    expect(priorDestinationsOf([])).toEqual([]);
    expect(
      priorDestinationsOf([
        { role: "ai", content: "a", createdAt: at, metadata: { intent: { destinations: ["canada"] } } },
        { role: "human", content: "b", createdAt: at },
        { role: "ai", content: "c", createdAt: at, metadata: { route: { countries: ["australia"] }, intent: { destinations: [] } } },
      ]),
    ).toEqual(["australia"]);
    expect(priorDestinationsOf([{ role: "ai", content: "a", createdAt: at, metadata: { intent: { destinations: ["canada", "other", "bogus"] } } }])).toEqual(["canada"]);
  });
});
