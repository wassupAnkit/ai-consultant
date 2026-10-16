/**
 * Approval cards for Google Calendar events and new Google Docs/Sheets, built from the model's
 * tool arguments before anything reaches Google (neither API has a dry run).
 *
 * Validation reuses the executors' own parsers (src/google/rest-calendar.ts, rest-docs.ts), so a
 * proposal the card shows is exactly one the approve can run. Errors are phrased for the model to
 * fix and propose again. Labels are a contract with the frontend cards (calendar-event-card.tsx,
 * google-file-card.tsx); change both together.
 */
import { eventAttendees, eventTime } from "../../google/rest-calendar";
import { docLines, MAX_DOC_CHARS, sheetRows } from "../../google/rest-docs";
import { RestRefused } from "../../google/rest-shared";
import type { CrmWriteChange, CrmWritePreview } from "./types";

type Built = { ok: true; preview: CrmWritePreview } | { ok: false; error: string };
type Args = Record<string, unknown>;

export const CALENDAR_LABELS = {
  title: "Title",
  starts: "Starts",
  ends: "Ends",
  timeZone: "Time zone",
  invites: "Invites emailed to",
  location: "Location",
  meet: "Google Meet",
  description: "Description",
} as const;

export const FILE_LABELS = { type: "Type", title: "Title", content: "Content", rows: "Rows", preview: "Preview", tab: "Sheet tab" } as const;

/** How much of a Doc's text, and how many Sheet rows, the card shows. The stored args keep everything. */
export const DOC_PREVIEW_CHARS = 20_000;
export const SHEET_PREVIEW_ROWS = 20;
const DESCRIPTION_PREVIEW_CHARS = 5_000;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const firstOf = (args: Args, ...keys: string[]) => keys.map((k) => str(args[k])).find(Boolean);
const cap = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}\n… (${text.length - n} more characters)` : text);
const change = (label: string, field: string, after: string): CrmWriteChange => ({ field, label, before: null, after });

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A start or end as the counsellor reads it, from the wall-clock digits the model wrote (no time
 * zone conversion, so the card shows exactly the time that will be booked): "Thu 2 Oct 2026, 15:00".
 */
export function prettyTime(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?(.*)$/.exec(value);
  if (!m) return value;
  const [, y, mo, d, h, mi, rest] = m;
  const day = new Date(Date.UTC(+y!, +mo! - 1, +d!));
  const date = `${WEEKDAY[day.getUTCDay()]} ${+d!} ${MONTH[+mo! - 1]} ${y}`;
  if (h === undefined) return `${date} (all day)`;
  const offset = /(Z|[+-]\d{2}:?\d{2})$/i.exec(rest ?? "")?.[1];
  return `${date}, ${h}:${mi}${offset ? ` (UTC${offset === "Z" || offset === "z" ? "" : offset})` : ""}`;
}

/** Comparable instant of a start/end in the same form; both without an offset share one zone, so UTC parsing compares them correctly. */
const instant = (t: { date: string } | { dateTime: string }) => ("date" in t ? Date.parse(`${t.date}T00:00:00Z`) : Date.parse(/(Z|[+-]\d{2}:?\d{2})$/i.test(t.dateTime) ? t.dateTime : `${t.dateTime}Z`));

export function calendarEventPreview(tool: string, args: Args): Built {
  try {
    const title = firstOf(args, "summary", "title");
    if (!title) return { ok: false, error: "a calendar event needs a summary (its title)" };
    const startRaw = firstOf(args, "start", "startTime");
    const endRaw = firstOf(args, "end", "endTime");
    const timeZone = firstOf(args, "timeZone", "time_zone");
    const start = eventTime(startRaw, timeZone, "start");
    const end = eventTime(endRaw, timeZone, "end");
    if ("date" in start !== "date" in end) return { ok: false, error: "start and end must both be dates (all-day event) or both date-times" };
    if (instant(end) <= instant(start)) return { ok: false, error: "the event must end after it starts" };
    const attendees = eventAttendees(args.attendees);

    const withOffset = [startRaw, endRaw].every((v) => v && /(Z|[+-]\d{2}:?\d{2})$/i.test(v));
    const changes: CrmWriteChange[] = [
      change(CALENDAR_LABELS.title, "summary", title),
      change(CALENDAR_LABELS.starts, "start", prettyTime(startRaw!)),
      change(CALENDAR_LABELS.ends, "end", prettyTime(endRaw!)),
    ];
    if ("dateTime" in start && !withOffset) changes.push(change(CALENDAR_LABELS.timeZone, "timeZone", timeZone ?? "Your calendar's time zone"));
    if (attendees.length) changes.push(change(CALENDAR_LABELS.invites, "attendees", attendees.join(", ")));
    const location = str(args.location);
    if (location) changes.push(change(CALENDAR_LABELS.location, "location", location));
    if (args.addGoogleMeet === true) changes.push(change(CALENDAR_LABELS.meet, "addGoogleMeet", "Yes"));
    const description = str(args.description);
    if (description) changes.push(change(CALENDAR_LABELS.description, "description", cap(description, DESCRIPTION_PREVIEW_CHARS)));

    return { ok: true, preview: { tool, target: { entity: "calendarEvent", id: null, label: title }, changes, version: null } };
  } catch (err) {
    if (err instanceof RestRefused) return { ok: false, error: err.message };
    throw err;
  }
}

/** A cell as one TSV field: tabs and line breaks inside it would break the card's table. */
const tsvCell = (c: string) => c.replace(/[\t\r\n]+/g, " ");

export function docsPreview(tool: string, args: Args): Built {
  try {
    const title = str(args.title);
    if (!title) return { ok: false, error: "a new Doc or Sheet needs a title" };
    const bare = tool.replace(/^docs_/, "");
    if (bare === "create_doc") {
      const content = typeof args.content === "string" ? args.content : "";
      if (!content.trim()) return { ok: false, error: "a new Google Doc needs content" };
      if (content.length > MAX_DOC_CHARS) return { ok: false, error: `a new Google Doc can hold at most ${MAX_DOC_CHARS} characters; shorten the content` };
      // Normalised the way the executor writes it, so the card shows the lines that will exist.
      const shownText = docLines(content)
        .map((l) => (l.kind === "h1" ? `# ${l.text}` : l.kind === "h2" ? `## ${l.text}` : l.kind === "bullet" ? `- ${l.text}` : l.text))
        .join("\n");
      return {
        ok: true,
        preview: {
          tool,
          target: { entity: "googleDoc", id: null, label: title },
          changes: [change(FILE_LABELS.type, "type", "Google Doc"), change(FILE_LABELS.title, "title", title), change(FILE_LABELS.content, "content", cap(shownText, DOC_PREVIEW_CHARS))],
          version: null,
        },
      };
    }
    if (bare === "create_sheet") {
      const rows = sheetRows(args.rows);
      const width = Math.max(...rows.map((r) => r.length));
      const tab = str(args.sheetTitle);
      const changes = [
        change(FILE_LABELS.type, "type", "Google Sheet"),
        change(FILE_LABELS.title, "title", title),
        ...(tab ? [change(FILE_LABELS.tab, "sheetTitle", tab)] : []),
        change(FILE_LABELS.rows, "rows", `${rows.length} row${rows.length === 1 ? "" : "s"} × ${width} column${width === 1 ? "" : "s"}`),
        change(FILE_LABELS.preview, "preview", rows.slice(0, SHEET_PREVIEW_ROWS).map((r) => r.map(tsvCell).join("\t")).join("\n")),
      ];
      return { ok: true, preview: { tool, target: { entity: "googleSheet", id: null, label: title }, changes, version: null } };
    }
    return { ok: false, error: `unknown Docs tool: ${tool}` };
  } catch (err) {
    if (err instanceof RestRefused) return { ok: false, error: err.message };
    throw err;
  }
}
