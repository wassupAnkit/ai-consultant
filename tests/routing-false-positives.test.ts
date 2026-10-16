import { describe, expect, test } from "bun:test";
import { extractDestinations } from "../src/routing/countries";
import { decideRoute } from "../src/routing/route";
import type { Destination } from "../src/schemas/intent.schema";
import { intentOf } from "./helpers";

// South Asia counsellor audit (Oct 2026): routing picked up countries the message did not name as
// a place to study — a bank's name, a relative's location, a past refusal — and missed "500 file".
const route = (input: string, classifier: Destination[] = [], extra: Parameters<typeof intentOf>[0] = {}) =>
  decideRoute({ intent: intentOf({ destinations: classifier, ...extra }), extras: null, input, history: [] }).countries;

describe("bank names are not countries", () => {
  test("Dutch-Bangla Bank is not the Netherlands, even when the classifier says so", () => {
    expect(extractDestinations("Funds are in a Dutch-Bangla Bank FDR, enough for Australia?")).toEqual(["australia"]);
    expect(extractDestinations("dutch bangla bank statement")).toEqual([]);
    expect(route("Funds are in a Dutch-Bangla Bank FDR, enough for Australia?", ["netherlands", "australia"])).toEqual(["australia"]);
  });

  test("other banks named after a country", () => {
    expect(extractDestinations("Bank of America statement for the UK CAS")).toEqual(["united_kingdom"]);
    expect(extractDestinations("loan from Commonwealth Bank of Australia, wants Canada")).toEqual(["canada"]);
    expect(extractDestinations("Standard Chartered education loan for Germany")).toEqual(["germany"]);
  });

  test("a Dutch university is still the Netherlands", () => {
    expect(extractDestinations("a Dutch university for a Bangladeshi student")).toEqual(["netherlands"]);
  });
});

describe("a relative's or sponsor's location is not a destination", () => {
  test("uncle / brother / sponsor in a country", () => {
    expect(extractDestinations("Her uncle in Dubai will sponsor; she wants Australia")).toEqual(["australia"]);
    expect(extractDestinations("brother works in Dubai, student wants Canada")).toEqual(["canada"]);
    expect(extractDestinations("his sister lives in the UK; options in New Zealand?")).toEqual(["new_zealand"]);
    expect(extractDestinations("sponsor is in Canada, student is applying to Australia")).toEqual(["australia"]);
    expect(route("Her uncle in Dubai will sponsor; she wants Australia", ["uae", "australia"])).toEqual(["australia"]);
    expect(route("brother works in UK, father is a farmer. Options for nursing?", ["united_kingdom"])).toEqual([]);
  });

  test("unless the student is going there too", () => {
    expect(extractDestinations("brother works in Canada; she wants to study there too")).toEqual(["canada"]);
    expect(extractDestinations("uncle in Dubai, and she wants to study in Dubai")).toEqual(["uae"]);
  });
});

describe("a past refusal country", () => {
  test("is not added to a comparison of other options", () => {
    expect(route("Refused for Canada last year. Compare Australia and UK for her.", ["canada", "australia", "united_kingdom"], { task: "compare" })).toEqual(["australia", "united_kingdom"]);
    expect(route("UK visa was refused in 2025; what about Australia or New Zealand?", [])).toEqual(["australia", "new_zealand"]);
  });

  test("stays when it is the only country, or named as an option again", () => {
    expect(route("Refused for Canada last year, can she reapply?", ["canada"])).toEqual(["canada"]);
    expect(route("Refused for Canada last year. Compare Canada again with Australia.", ["canada", "australia"], { task: "compare" })).toEqual(["canada", "australia"]);
  });
});

describe("Australian visa shorthand", () => {
  test('"500 file" and "500 visa file" are Australia', () => {
    expect(extractDestinations("how is her 500 file going?")).toEqual(["australia"]);
    expect(extractDestinations("checklist for a 500 visa file")).toEqual(["australia"]);
    expect(extractDestinations("uploaded 500 files to the drive")).toEqual([]);
  });
});
