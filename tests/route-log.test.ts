import { describe, expect, test } from "bun:test";
import { routeLogSummary } from "../src/app/service";

describe("routeLogSummary", () => {
  test("keeps the routing facts and drops empty fields; a CRM student is logged by contact id only", () => {
    expect(
      routeLogSummary({
        countries: ["australia"],
        mode: "single",
        topic: "visa_process",
        origin: "nepal",
        originSource: "counsellor",
        onshore: null,
        counsellorRegion: { market: "nepal", onshore: null, branch: "Kathmandu (Putalisadak)", source: "crm_branch" },
        packs: ["australia@2026-10-08"],
        marketPack: "nepal@2026-10-08b",
        crmStudent: { contactId: "c-1", origin: "nepal", destinations: ["australia", "canada"], name: "Sita Sharma" },
      }),
    ).toEqual({
      countries: ["australia"],
      mode: "single",
      origin: "nepal",
      originSource: "counsellor",
      region: { market: "nepal", source: "crm_branch" },
      packs: ["australia@2026-10-08"],
      marketPack: "nepal@2026-10-08b",
      crmStudent: { contactId: "c-1", origin: "nepal", destinations: ["australia", "canada"] },
    });
  });

  test("no route → nothing to log", () => {
    expect(routeLogSummary(undefined)).toBeUndefined();
    expect(routeLogSummary(null)).toBeUndefined();
  });
});
