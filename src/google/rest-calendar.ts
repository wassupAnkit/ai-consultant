/**
 * Google Calendar tools over the Calendar REST API (v3), with the consultant's own token.
 *
 * Reads mirror Google's Calendar MCP server (list_events, search_events, get_event, list_calendars,
 * suggest_time) and accept its likely argument spellings (startTime/timeMin, endTime/timeMax,
 * q/query, maxResults/pageSize, id/eventId), so a fallback from MCP keeps working with the
 * descriptors the MCP server published.
 *
 * The one write, `create_event`, always runs here (never over MCP): its arguments are the ones the
 * approval card was built from. Attendees are emailed an invite by Google (`sendUpdates=all`), which
 * is why the card names them before Approve.
 */
import type { McpToolDescriptor, McpToolResult } from "../mcp/types";
import { http, list, obj, pageSize, qs, RestRefused, s, str, strings, type Obj, type RestCallOptions } from "./rest-shared";

const CAL = "https://www.googleapis.com/calendar/v3";
const DAY_MS = 86_400_000;
/** At most this many invitees on one proposed event. */
export const MAX_ATTENDEES = 20;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

const read = { readOnlyHint: true } as const;

export const CALENDAR_DESCRIPTORS: McpToolDescriptor[] = [
  {
    name: "list_events",
    description: "List events on the consultant's calendar in a time window, soonest first. Defaults to the next 7 days on their primary calendar.",
    inputSchema: obj({ timeMin: s("string", "Window start, RFC 3339 (e.g. 2026-10-02T00:00:00+10:00); default now"), timeMax: s("string", "Window end, RFC 3339; default 7 days after timeMin"), calendarId: s("string", "Calendar id; default primary"), pageSize: s("integer", "Events to return, at most 25") }),
    annotations: read,
  },
  {
    name: "search_events",
    description: "Find events whose title, description, location or attendees match words, e.g. a student's name. Searches the next 90 days unless a window is given.",
    inputSchema: obj({ query: s("string", "Words to match"), timeMin: s("string", "Window start, RFC 3339"), timeMax: s("string", "Window end, RFC 3339"), calendarId: s("string", "Calendar id; default primary") }, ["query"]),
    annotations: read,
  },
  {
    name: "get_event",
    description: "Details of one event: time, attendees and their responses, location, Meet link and description.",
    inputSchema: obj({ eventId: s("string", "Event id from list_events or search_events"), calendarId: s("string", "Calendar id; default primary") }, ["eventId"]),
    annotations: read,
  },
  {
    name: "list_calendars",
    description: "The calendars the consultant can see, with their ids and time zones.",
    inputSchema: obj({}),
    annotations: read,
  },
  {
    name: "suggest_time",
    description:
      "Find free times on the consultant's calendar (and any attendees' calendars Google lets them see) for a meeting of `durationMinutes`, within working hours (09:00–17:00 Monday to Friday in the consultant's time zone). Use this before proposing an event time.",
    inputSchema: obj({ durationMinutes: s("integer", "Meeting length in minutes; default 30"), timeMin: s("string", "Window start, RFC 3339; default now"), timeMax: s("string", "Window end, RFC 3339; default 5 days after timeMin"), attendees: list("Email addresses whose free/busy should also be checked") }),
    annotations: read,
  },
  {
    name: "create_event",
    description:
      "Propose an event on the consultant's primary calendar. It is created only when the consultant approves the card; on Approve, Google emails an invite to every attendee. Add attendees only when the consultant named them.",
    inputSchema: obj(
      {
        summary: s("string", "Event title"),
        start: s("string", "Start: RFC 3339 date-time (2026-10-02T15:00:00) or a date (2026-10-02) for an all-day event"),
        end: s("string", "End, same form as start"),
        timeZone: s("string", "IANA time zone for a start/end without an offset, e.g. Australia/Melbourne; default the calendar's"),
        description: s("string", "Event description"),
        location: s("string", "Location"),
        attendees: list("Attendee email addresses; each gets an emailed invite on Approve"),
        addGoogleMeet: s("boolean", "Add a Google Meet link"),
      },
      ["summary", "start", "end"],
    ),
    annotations: { readOnlyHint: false },
  },
];

interface CalEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email?: string; responseStatus?: string; self?: boolean }[];
  organizer?: { email?: string };
}

const pick = (args: Obj, ...keys: string[]) => {
  for (const k of keys) {
    const v = str(args[k]);
    if (v) return v;
  }
  return undefined;
};
const when = (t?: { dateTime?: string; date?: string }) => t?.dateTime ?? t?.date ?? "";

const eventView = (e: CalEvent, withDescription = false) => ({
  id: e.id,
  title: e.summary ?? "(no title)",
  start: when(e.start),
  end: when(e.end),
  ...(e.location ? { location: e.location } : {}),
  attendees: (e.attendees ?? []).map((a) => ({ email: a.email ?? "", responseStatus: a.responseStatus ?? "needsAction" })),
  ...(e.htmlLink ? { htmlLink: e.htmlLink } : {}),
  ...(e.hangoutLink ? { meetLink: e.hangoutLink } : {}),
  ...(withDescription && e.description ? { description: e.description.slice(0, 2_000) } : {}),
});

const eventLine = (v: ReturnType<typeof eventView>, i: number) =>
  `${i + 1}. [event ${v.id}] ${v.start} → ${v.end} — ${v.title}${v.location ? ` — at ${v.location}` : ""}${v.attendees.length ? ` — with ${v.attendees.map((a) => a.email).join(", ")}` : ""}`;

const calendarId = (args: Obj) => encodeURIComponent(pick(args, "calendarId", "calendar_id") ?? "primary");

async function calendarTimeZone(o: RestCallOptions): Promise<string> {
  const c = (await http("calendar", `${CAL}/calendars/primary?fields=timeZone`, o)) as { timeZone?: string };
  return c.timeZone ?? "UTC";
}

async function listEvents(args: Obj, o: RestCallOptions, defaultDays: number): Promise<McpToolResult> {
  const timeMin = pick(args, "timeMin", "startTime", "start_time") ?? new Date().toISOString();
  const timeMax = pick(args, "timeMax", "endTime", "end_time") ?? new Date(Date.parse(timeMin) + defaultDays * DAY_MS).toISOString();
  const found = (await http(
    "calendar",
    `${CAL}/calendars/${calendarId(args)}/events?${qs({ singleEvents: true, orderBy: "startTime", timeMin, timeMax, q: pick(args, "query", "q"), maxResults: pageSize(args.pageSize ?? args.maxResults) })}`,
    o,
  )) as { items?: CalEvent[]; timeZone?: string };
  const events = (found.items ?? []).filter((e) => e.status !== "cancelled").map((e) => eventView(e));
  const head = `Calendar time zone: ${found.timeZone ?? "unknown"}. Window ${timeMin} → ${timeMax}.`;
  return { text: events.length ? `${head}\n${events.map(eventLine).join("\n")}` : `${head}\nNo events in that window.`, structured: { timeZone: found.timeZone, events }, isError: false };
}

async function getEvent(args: Obj, o: RestCallOptions): Promise<McpToolResult> {
  const id = pick(args, "eventId", "event_id", "id");
  if (!id) throw new RestRefused("eventId is required");
  const v = eventView((await http("calendar", `${CAL}/calendars/${calendarId(args)}/events/${encodeURIComponent(id)}`, o)) as CalEvent, true);
  const text = [eventLine(v, 0).replace(/^1\. /, ""), ...v.attendees.map((a) => `  - ${a.email}: ${a.responseStatus}`), ...(v.meetLink ? [`Meet: ${v.meetLink}`] : []), ...(v.description ? ["", v.description] : [])].join("\n");
  return { text, structured: v, isError: false };
}

async function listCalendars(_args: Obj, o: RestCallOptions): Promise<McpToolResult> {
  const found = (await http("calendar", `${CAL}/users/me/calendarList?fields=items(id,summary,primary,timeZone,accessRole)`, o)) as { items?: { id: string; summary?: string; primary?: boolean; timeZone?: string; accessRole?: string }[] };
  const calendars = found.items ?? [];
  return { text: calendars.map((c, i) => `${i + 1}. [calendar ${c.id}] ${c.summary ?? c.id}${c.primary ? " (primary)" : ""} — ${c.timeZone ?? "?"} — ${c.accessRole ?? "?"}`).join("\n") || "No calendars.", structured: { calendars }, isError: false };
}

// ---------------------------------------------------------------- time zones and free time

/** Milliseconds `tz` is ahead of UTC at `at`. */
function tzOffset(at: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!) - Math.floor(at / 1000) * 1000;
}

/** The UTC instant of a wall-clock time in `tz` (two passes, so a DST change on that day still lands right). */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - tzOffset(guess, tz);
  return guess - tzOffset(first, tz);
}

/** Local calendar date and weekday of an instant in `tz`. */
function localDay(at: number, tz: string): { y: number; m: number; d: number; weekday: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return { y: +parts.year!, m: +parts.month!, d: +parts.day!, weekday: parts.weekday! };
}

const localLabel = (at: number, tz: string) => new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));

/**
 * Free windows of at least `durationMs` between `from` and `to`, inside 09:00–17:00 on weekdays in
 * `tz`, given busy intervals. Exported for tests.
 */
export function freeWindows(busy: { start: number; end: number }[], from: number, to: number, durationMs: number, tz: string, max = 10): { start: number; end: number }[] {
  const merged = [...busy].sort((a, b) => a.start - b.start).reduce<{ start: number; end: number }[]>((acc, b) => {
    const last = acc[acc.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else acc.push({ ...b });
    return acc;
  }, []);
  const out: { start: number; end: number }[] = [];
  for (let t = from; t < to && out.length < max; t += DAY_MS) {
    const day = localDay(t, tz);
    if (day.weekday === "Sat" || day.weekday === "Sun") continue;
    const open = Math.max(zonedToUtc(day.y, day.m, day.d, 9, 0, tz), from);
    const close = Math.min(zonedToUtc(day.y, day.m, day.d, 17, 0, tz), to);
    let cursor = Math.ceil(open / 900_000) * 900_000; // start on a quarter hour
    for (const b of merged) {
      if (b.end <= cursor || b.start >= close) continue;
      if (b.start - cursor >= durationMs) out.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, Math.ceil(b.end / 900_000) * 900_000);
      if (out.length >= max) break;
    }
    if (out.length < max && close - cursor >= durationMs) out.push({ start: cursor, end: close });
  }
  // A window can be reported twice when two consecutive days' loops overlap at the window edge.
  return out.filter((w, i, all) => all.findIndex((x) => x.start === w.start) === i).slice(0, max);
}

async function suggestTime(args: Obj, o: RestCallOptions): Promise<McpToolResult> {
  const minutes = Number.isInteger(args.durationMinutes) && (args.durationMinutes as number) > 0 ? Math.min(args.durationMinutes as number, 480) : 30;
  const timeMin = pick(args, "timeMin", "startTime") ?? new Date().toISOString();
  const timeMax = pick(args, "timeMax", "endTime") ?? new Date(Date.parse(timeMin) + 5 * DAY_MS).toISOString();
  if (Number.isNaN(Date.parse(timeMin)) || Number.isNaN(Date.parse(timeMax))) throw new RestRefused("timeMin and timeMax must be RFC 3339 date-times");
  const others = strings(args.attendees).filter((e) => EMAIL.test(e)).slice(0, MAX_ATTENDEES);
  const tz = await calendarTimeZone(o);
  const fb = (await http("calendar", `${CAL}/freeBusy`, o, { method: "POST", body: { timeMin, timeMax, timeZone: tz, items: [{ id: "primary" }, ...others.map((id) => ({ id }))] } })) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }>;
  };
  const busy = Object.values(fb.calendars ?? {}).flatMap((c) => (c.busy ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })));
  const unknown = Object.entries(fb.calendars ?? {}).filter(([, c]) => c.errors?.length).map(([id]) => id);
  const windows = freeWindows(busy, Date.parse(timeMin), Date.parse(timeMax), minutes * 60_000, tz);
  const lines = windows.map((w, i) => `${i + 1}. ${localLabel(w.start, tz)} – ${localLabel(w.end, tz).split(", ").pop()} (${new Date(w.start).toISOString()} → ${new Date(w.end).toISOString()})`);
  const text = [
    `Free times of at least ${minutes} minutes, 09:00–17:00 weekdays, ${tz}:`,
    ...(lines.length ? lines : ["None in that window."]),
    ...(unknown.length ? [`Free/busy not visible for: ${unknown.join(", ")} (only the consultant's own calendar was checked for them).`] : []),
  ].join("\n");
  return { text, structured: { timeZone: tz, durationMinutes: minutes, windows: windows.map((w) => ({ start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() })) }, isError: false };
}

// ---------------------------------------------------------------- create

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** A date-time with an explicit offset or Z. */
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

/** Validated attendee list; throws on a bad address. Exported for the approval preview. */
export function eventAttendees(raw: unknown): string[] {
  const list = [...new Set(strings(raw).map((e) => e.replace(/^.*<([^>]+)>.*$/, "$1").trim().toLowerCase()))];
  const bad = list.filter((e) => !EMAIL.test(e));
  if (bad.length) throw new RestRefused(`not an email address: ${bad.join(", ")}`);
  if (list.length > MAX_ATTENDEES) throw new RestRefused(`at most ${MAX_ATTENDEES} attendees`);
  return list;
}

export function eventTime(value: string | undefined, timeZone: string | undefined, label: string): { date: string } | { dateTime: string; timeZone?: string } {
  if (!value) throw new RestRefused(`${label} is required`);
  if (DATE_ONLY.test(value)) return { date: value };
  if (Number.isNaN(Date.parse(HAS_OFFSET.test(value) ? value : `${value}Z`))) throw new RestRefused(`${label} is not a date or RFC 3339 date-time: ${value}`);
  return HAS_OFFSET.test(value) ? { dateTime: value } : { dateTime: value, ...(timeZone ? { timeZone } : {}) };
}

async function createEvent(args: Obj, o: RestCallOptions): Promise<McpToolResult> {
  const summary = pick(args, "summary", "title");
  if (!summary) throw new RestRefused("summary (the event title) is required");
  const attendees = eventAttendees(args.attendees);
  const startRaw = pick(args, "start", "startTime");
  const endRaw = pick(args, "end", "endTime");
  // A wall-clock time without an offset needs a zone: the one given, else the calendar's own.
  const needsZone = [startRaw, endRaw].some((v) => v && !DATE_ONLY.test(v) && !HAS_OFFSET.test(v));
  const timeZone = pick(args, "timeZone", "time_zone") ?? (needsZone ? await calendarTimeZone(o) : undefined);
  const start = eventTime(startRaw, timeZone, "start");
  const end = eventTime(endRaw, timeZone, "end");
  const meet = args.addGoogleMeet === true;
  const body = {
    summary,
    ...(str(args.description) ? { description: args.description } : {}),
    ...(str(args.location) ? { location: args.location } : {}),
    start,
    end,
    ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
    ...(meet ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
  };
  const e = (await http("calendar", `${CAL}/calendars/primary/events?${qs({ sendUpdates: attendees.length ? "all" : "none", conferenceDataVersion: meet ? 1 : undefined })}`, o, { method: "POST", body })) as CalEvent;
  const v = eventView(e);
  return { text: `Event ${e.id} created${attendees.length ? `; Google emailed invites to ${attendees.join(", ")}` : ""}.`, structured: v, isError: false };
}

export const CALENDAR_HANDLERS: Record<string, (args: Obj, o: RestCallOptions) => Promise<McpToolResult>> = {
  list_events: (a, o) => listEvents(a, o, 7),
  search_events: async (a, o) => {
    if (!pick(a, "query", "q")) throw new RestRefused("query is required");
    return listEvents(a, o, 90);
  },
  get_event: getEvent,
  list_calendars: listCalendars,
  suggest_time: suggestTime,
  create_event: createEvent,
};
