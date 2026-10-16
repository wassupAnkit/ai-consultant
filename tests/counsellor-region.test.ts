import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { ChatService } from "../src/app/service";
import type { CrmProvider, CrmToolDescriptor, CrmToolResult } from "../src/crm/client";
import { createDemoCrmProvider } from "../src/crm/demo";
import { CounsellorRegionReader, regionFromMe, regionFromTimezone, type CounsellorRegion } from "../src/crm/staff";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { extractExplicitOrigin, extractLanguageOrigin, marketFromTimezone, onshoreFromName } from "../src/routing/markets";
import { decideRoute } from "../src/routing/route";
import { CRM_READ_TOOL, fakeToolset, RecordingKnowledgeStore, ScriptedToolModel } from "./fakes";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

const ME_TOOL: CrmToolDescriptor = { ...CRM_READ_TOOL, name: "crm_get_me", title: "Who am I", description: "The signed-in user.", inputSchema: { type: "object", properties: {} } as never };

/** A provider whose toolset answers `crm_get_me` with `me` (or an error / a slow reply), counting calls. */
function meProvider(reply: CrmToolResult | Error | (() => Promise<CrmToolResult>), descriptors: CrmToolDescriptor[] = [CRM_READ_TOOL, ME_TOOL]) {
  const calls: string[] = [];
  const provider: CrmProvider = {
    forActor: async (email) =>
      email
        ? fakeToolset(async (name) => {
            calls.push(name);
            if (reply instanceof Error) throw reply;
            return typeof reply === "function" ? reply() : reply;
          }, undefined, descriptors, email)
        : undefined,
  };
  return { provider, calls };
}
const me = (structured: Record<string, unknown>): CrmToolResult => ({ text: "you", structured, isError: false });

const nepal: CounsellorRegion = { market: "nepal", onshore: null, branch: "Kathmandu (Putalisadak)", source: "crm_branch" };

describe("marketFromTimezone", () => {
  test("each market's zone, legacy names included", () => {
    const cases: [string, string][] = [
      ["Asia/Kathmandu", "nepal"],
      ["Asia/Katmandu", "nepal"],
      ["Asia/Kolkata", "india"],
      ["Asia/Calcutta", "india"],
      ["Asia/Dhaka", "bangladesh"],
      ["Asia/Ho_Chi_Minh", "vietnam"],
      ["Asia/Saigon", "vietnam"],
      ["Asia/Manila", "philippines"],
      ["Asia/Bangkok", "thailand"],
      ["Asia/Colombo", "sri_lanka"],
    ];
    for (const [tz, market] of cases) expect(marketFromTimezone(tz)).toEqual({ market: market as never, onshore: null });
  });

  test("Australian and UK zones are onshore offices; anything else is unknown", () => {
    expect(marketFromTimezone("Australia/Sydney")).toEqual({ market: null, onshore: "australia" });
    expect(marketFromTimezone("Australia/Perth")).toEqual({ market: null, onshore: "australia" });
    expect(marketFromTimezone("Europe/London")).toEqual({ market: null, onshore: "united_kingdom" });
    expect(marketFromTimezone("America/Toronto")).toBeNull();
    expect(marketFromTimezone("")).toBeNull();
    expect(marketFromTimezone(undefined)).toBeNull();
  });

  test("onshoreFromName reads countries, codes and cities", () => {
    expect(onshoreFromName("Australia")).toBe("australia");
    expect(onshoreFromName("AU")).toBe("australia");
    expect(onshoreFromName("Sydney (CBD)")).toBe("australia");
    expect(onshoreFromName("United Kingdom")).toBe("united_kingdom");
    expect(onshoreFromName("London Bridge")).toBe("united_kingdom");
    expect(onshoreFromName("Kathmandu")).toBeNull();
  });
});

describe("extractExplicitOrigin / extractLanguageOrigin", () => {
  test("names, demonyms and cities are explicit; script and Romanized cues are language", () => {
    expect(extractExplicitOrigin("Nepali student, AU visa?")).toBe("nepal");
    expect(extractExplicitOrigin("from Kathmandu")).toBe("nepal");
    expect(extractExplicitOrigin("मलाई अष्ट्रेलियाको भिसाको बारेमा जान्न मन छ")).toBeNull();
    expect(extractLanguageOrigin("मलाई अष्ट्रेलियाको भिसाको बारेमा जान्न मन छ")).toBe("nepal");
    expect(extractExplicitOrigin("visa ko lagi kati paisa chahincha?")).toBeNull();
    expect(extractLanguageOrigin("visa ko lagi kati paisa chahincha?")).toBe("nepal");
    expect(extractLanguageOrigin("Nepali student")).toBeNull();
  });
});

describe("regionFromMe", () => {
  test("new shape: the branch country decides, with the branch name kept", () => {
    expect(regionFromMe({ me: { country: "Nepal", timeZone: "Asia/Kathmandu", branch: { id: "b1", name: "Kathmandu (Putalisadak)", country: "Nepal", city: "Kathmandu", state: "Bagmati", timezone: "Asia/Kathmandu" } } })).toEqual(nepal);
  });

  test("old shape: only the branch name, whose city places it", () => {
    expect(regionFromMe({ me: { id: "u1", branch: { id: "b2", name: "Pokhara" } } })).toEqual({ market: "nepal", onshore: null, branch: "Pokhara", source: "crm_branch" });
  });

  test("an Australian or UK branch is onshore, with no market", () => {
    expect(regionFromMe({ me: { branch: { id: "b3", name: "Sydney CBD", country: "Australia", city: "Sydney", timezone: "Australia/Sydney" } } })).toEqual({ market: null, onshore: "australia", branch: "Sydney CBD", source: "crm_branch" });
    expect(regionFromMe({ me: { branch: { id: "b4", name: "Head office", country: { name: "United Kingdom" } } } })?.onshore).toBe("united_kingdom");
  });

  test("an unplaceable branch falls back to its timezone, then to the user's own country and zone", () => {
    expect(regionFromMe({ me: { branch: { id: "b5", name: "Head office", timezone: "Asia/Dhaka" } } })).toEqual({ market: "bangladesh", onshore: null, branch: "Head office", source: "crm_branch" });
    expect(regionFromMe({ me: { country: "Sri Lanka", branch: { id: "b6", name: "Head office" } } })).toEqual({ market: "sri_lanka", onshore: null, branch: "Head office", source: "crm_user" });
    expect(regionFromMe({ me: { timeZone: "Asia/Manila" } })).toEqual({ market: "philippines", onshore: null, branch: null, source: "crm_user" });
  });

  test("nothing placeable, or junk, is null", () => {
    expect(regionFromMe({ me: { branch: { id: "b7", name: "Head office" } } })).toBeNull();
    expect(regionFromMe(undefined)).toBeNull();
    expect(regionFromMe({ me: "nope" })).toBeNull();
  });

  test("regionFromTimezone is the browser fallback", () => {
    expect(regionFromTimezone("Asia/Kathmandu")).toEqual({ market: "nepal", onshore: null, branch: null, source: "timezone" });
    expect(regionFromTimezone(42)).toBeNull();
  });
});

describe("CounsellorRegionReader", () => {
  test("reads crm_get_me through the consultant's toolset, then serves the cache", async () => {
    const { provider, calls } = meProvider(me({ me: { branch: { id: "b1", name: "Kathmandu (Putalisadak)", country: "Nepal" } } }));
    const reader = new CounsellorRegionReader({ provider });
    expect(await reader.regionOf("jane@heubert.com")).toEqual(nepal);
    expect(await reader.regionOf("JANE@heubert.com")).toEqual(nepal);
    expect(calls).toEqual(["crm_get_me"]);
  });

  test("an expired entry is read again", async () => {
    const { provider, calls } = meProvider(me({ me: { branch: { id: "b2", name: "Pokhara" } } }));
    const reader = new CounsellorRegionReader({ provider, cacheTtlMs: 0 });
    await reader.regionOf("jane@heubert.com");
    await reader.regionOf("jane@heubert.com");
    expect(calls).toHaveLength(2);
  });

  test("a failing CRM gives null, is logged, and is not asked again right away", async () => {
    const logs: string[] = [];
    const { provider, calls } = meProvider(new Error("boom"));
    const reader = new CounsellorRegionReader({ provider, log: (m) => logs.push(m) });
    expect(await reader.regionOf("jane@heubert.com")).toBeNull();
    expect(await reader.regionOf("jane@heubert.com")).toBeNull();
    expect(calls).toHaveLength(1);
    expect(logs[0]).toContain("could not read");
  });

  test("a refused call, no crm_get_me tool, no CRM or no actor: null", async () => {
    expect(await new CounsellorRegionReader({ provider: meProvider({ text: "denied", isError: true }).provider }).regionOf("jane@heubert.com")).toBeNull();
    const without = meProvider(me({ me: { country: "Nepal" } }), [CRM_READ_TOOL]);
    expect(await new CounsellorRegionReader({ provider: without.provider }).regionOf("jane@heubert.com")).toBeNull();
    expect(without.calls).toEqual([]);
    expect(await new CounsellorRegionReader({ provider: { forActor: async () => undefined } }).regionOf("jane@heubert.com")).toBeNull();
    expect(await new CounsellorRegionReader({ provider: meProvider(me({})).provider }).regionOf(null)).toBeNull();
  });

  test("a slow CRM is cut at the timeout and gives null", async () => {
    const { provider } = meProvider(() => new Promise((r) => setTimeout(() => r(me({ me: { country: "Nepal" } })), 500)));
    const started = performance.now();
    expect(await new CounsellorRegionReader({ provider, timeoutMs: 30 }).regionOf("jane@heubert.com")).toBeNull();
    expect(performance.now() - started).toBeLessThan(400);
  });

  test("the demo CRM's counsellor is in the Kathmandu branch", async () => {
    expect(await new CounsellorRegionReader({ provider: createDemoCrmProvider() }).regionOf("demo@heubert.com")).toEqual({ market: "nepal", onshore: null, branch: "Kathmandu (Putalisadak)", source: "crm_branch" });
  });
});

describe("decideRoute: the counsellor's region is the default origin", () => {
  const route = (input: string, over: Partial<Parameters<typeof decideRoute>[0]> = {}) => decideRoute({ intent: intentOf({ destinations: ["australia"] }), extras: null, input, history: [], counsellorRegion: nepal, ...over });

  test("a plain question from a Nepal counsellor is about a Nepali student", () => {
    expect(route("What docs for subclass 500?")).toMatchObject({ origin: "nepal", originSource: "counsellor", onshore: null, counsellorRegion: nepal });
  });

  test("an explicit nationality beats the counsellor's region", () => {
    expect(route("Thai student: what docs for subclass 500?")).toMatchObject({ origin: "thailand", originSource: "keywords" });
  });

  test("a CRM student's nationality beats it", () => {
    expect(route("What docs for subclass 500?", { guideOrigin: "bangladesh" })).toMatchObject({ origin: "bangladesh", originSource: "crm" });
  });

  test("a follow-up's prior origin beats it", () => {
    expect(route("and the fees?", { history: ["q", "a"], priorOrigin: "india" })).toMatchObject({ origin: "india", originSource: "history" });
  });

  test("it beats the message's script and Romanized cues; those count without a region", () => {
    expect(route("मुझे ऑस्ट्रेलिया के वीज़ा के बारे में जानना है, क्या करना चाहिए?")).toMatchObject({ origin: "nepal", originSource: "counsellor" });
    expect(route("visa ke liye kitna paisa chahiye? kya karna hai")).toMatchObject({ origin: "nepal", originSource: "counsellor" });
    expect(route("visa ke liye kitna paisa chahiye? kya karna hai", { counsellorRegion: null })).toMatchObject({ origin: "india", originSource: "language" });
  });

  test("the consultant's Edge profile market beats the CRM branch", () => {
    expect(route("What docs for subclass 500?", { profile: { market: "Vietnam" } })).toMatchObject({ origin: "vietnam", originSource: "profile" });
    expect(route("What docs for subclass 500?", { counsellorRegion: { market: "india", onshore: null, branch: null, source: "profile" } })).toMatchObject({ origin: "india", originSource: "profile" });
  });

  test("an onshore counsellor gives no origin, only the onshore flag", () => {
    const sydney: CounsellorRegion = { market: null, onshore: "australia", branch: "Sydney", source: "crm_branch" };
    expect(route("What docs for subclass 500?", { counsellorRegion: sydney })).toMatchObject({ origin: null, originSource: null, onshore: "australia", counsellorRegion: sydney });
    expect(route("Nepali student: what docs for subclass 500?", { counsellorRegion: sydney })).toMatchObject({ origin: "nepal", onshore: null });
  });

  test("no region: unchanged behaviour", () => {
    expect(route("What docs for subclass 500?", { counsellorRegion: null })).toMatchObject({ origin: null, originSource: null, onshore: null, counsellorRegion: null });
  });
});

describe("the region in the turn", () => {
  const visa = intentOf({ primary_intent: "visa_process", destinations: ["australia"], user_question: "What docs for subclass 500?", task: "lookup", needs_research: true });

  async function graphTurn(counsellorRegion: CounsellorRegion | null, input = "What docs for subclass 500?") {
    const { graph } = fakeGraph({ intent: visa, researchModel: new ScriptedToolModel([new AIMessage({ content: "sufficient" })]), knowledge: new RecordingKnowledgeStore(() => [sampleChunk(1)]), skillPacks: true });
    const state = await graph.invoke({ input, history: [], sessionId: "s1", profile: null, counsellorRegion });
    return { state, answer: String(state.meta.systemPromptText) };
  }

  test("a Nepal counsellor's plain question loads the Nepal market pack, marked as assumed", async () => {
    const { state, answer } = await graphTurn(nepal);
    expect(state.route).toMatchObject({ origin: "nepal", originSource: "counsellor" });
    expect(answer).toContain("# Market guidance (student from Nepal)");
    expect(answer).toContain("Student's country/location: Nepal (assumed from the counsellor's office region; not stated) |");
    expect((state.meta.route as { counsellorRegion?: unknown }).counsellorRegion).toEqual(nepal);
  });

  test("an onshore counsellor gets the onshore line in the per-turn request block, not the cached prefix", async () => {
    const { answer } = await graphTurn({ market: null, onshore: "australia", branch: "Sydney", source: "crm_branch" });
    const line = "Counsellor is at an onshore Australia office: the student is likely already in Australia; consider onshore rules (visa conditions, switching provider, onshore applications) and ask the nationality only if the answer depends on it";
    expect(answer).toContain(`Student's country/location: unknown. ${line} |`);
    expect(answer.indexOf(line)).toBeGreaterThan(answer.indexOf("# Request"));
    expect(answer).not.toContain("# Market guidance");
    const uk = await graphTurn({ market: null, onshore: "united_kingdom", branch: null, source: "timezone" });
    expect(uk.answer).toContain("onshore UK office: the student is likely already in the UK;");
  });

  test("ChatService reads the region from crm_get_me and routes a plain question to Nepal", async () => {
    const { graph } = fakeGraph({ intent: visa, research: { maxRounds: 0 }, answer: "ok [1]", skillPacks: true });
    const { provider, calls } = meProvider(me({ me: { country: "Nepal", timeZone: "Asia/Kathmandu", branch: { id: "b1", name: "Kathmandu (Putalisadak)", country: "Nepal", city: "Kathmandu", timezone: "Asia/Kathmandu" } } }));
    const chat = new ChatService({ env: testEnv(), graph, store: new InMemoryChatStore(), logger: createLogger({ test: true }), regions: new CounsellorRegionReader({ provider }) });
    const r = await chat.chat({ message: "what docs for subclass 500?", ownerId: "jane@heubert.com", requestId: "r1", route: "/v1/chat", metadata: { tz: "Australia/Sydney" } });
    expect(r.meta.route).toMatchObject({ origin: "nepal", originSource: "counsellor", counsellorRegion: { market: "nepal", source: "crm_branch" } });
    expect(calls).toEqual(["crm_get_me"]);
  });

  test("ChatService: a saved profile market wins without asking the CRM; the browser timezone is the last resort", async () => {
    const { graph } = fakeGraph({ intent: visa, research: { maxRounds: 0 }, answer: "ok [1]" });
    const { provider, calls } = meProvider(me({ me: { branch: { id: "b1", name: "Kathmandu" } } }));
    const withProfile = new ChatService({ env: testEnv(), graph, store: new InMemoryChatStore(), logger: createLogger({ test: true }), regions: new CounsellorRegionReader({ provider }), loadProfile: async () => ({ market: "India" }) });
    const a = await withProfile.chat({ message: "what docs for subclass 500?", ownerId: "jane@heubert.com", requestId: "r1", route: "/v1/chat" });
    expect(a.meta.route).toMatchObject({ origin: "india", originSource: "profile", counsellorRegion: { market: "india", source: "profile" } });
    expect(calls).toEqual([]);
    const noCrm = new ChatService({ env: testEnv(), graph, store: new InMemoryChatStore(), logger: createLogger({ test: true }) });
    const b = await noCrm.chat({ message: "what docs for subclass 500?", ownerId: "anonymous", requestId: "r2", route: "/v1/chat", metadata: { tz: "Asia/Colombo" } });
    expect(b.meta.route).toMatchObject({ origin: "sri_lanka", originSource: "counsellor", counsellorRegion: { source: "timezone" } });
  });
});
