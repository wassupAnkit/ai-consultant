import { z } from "zod";
import type { RetrievedChunk } from "../retrieval/store";
import { journeyStep, STUDENT_FIELDS, STUDENT_FIELD_KEYS, type JourneyStepKey, type StudentFieldKey, type StudentFieldSource } from "../journey/steps";
import type { CrmProvider, CrmToolset } from "./client";
import { crmDeepLink } from "./deep-link";
import { destinationsFromNames } from "../routing/countries";
import { marketFromName } from "../routing/markets";
import type { CrmStudentRef } from "../routing/route";

/**
 * Deterministic, typed reads of one CRM student for guided sessions — the CRM stays the only
 * home of student facts, and Edge reads them live, as the consultant, on every guided turn.
 *
 * Unlike the research loop, nothing here is chosen by a model: the session already knows the
 * contact id, so the snapshot is fetched by code before the graph runs. It goes through the
 * same per-consultant toolset, so the CRM's branch and assignee permissions still apply; a
 * consultant who cannot see the student gets `not_visible`, never the record.
 *
 * The snapshot is composed from `crm_get_student_overview` (record, deals and, once crm-api
 * ships it, applications with their workflow stage), `crm_get_contact` and `crm_get_deal`.
 * Parts no tool exposes yet — education, tests, finances, intake, and applications on an older
 * crm-api — are marked unavailable rather than empty, so they read as unknown, not missing.
 *
 * PRIVACY: contact email, phone and date of birth are never copied into the snapshot, and
 * nothing here is persisted — the cache is in-process and short-lived.
 */

export interface StudentDeal {
  id: string;
  name: string | null;
  status: string | null;
  service: string | null;
  countries: string[];
  services: string[];
}

export interface StudentEducation {
  degreeTitle: string | null;
  degreeLevel: string | null;
  institution: string | null;
  percentage: string | null;
  securedGpa: string | null;
  totalGpa: string | null;
}

export interface StudentApplication {
  id: string;
  status: string | null;
  institution: string | null;
  course: string | null;
  intake: string | null;
  workflowStage: string | null;
}

export interface StudentSnapshot {
  contactId: string;
  name: string;
  status: string | null;
  nationality: string | null;
  country: string | null;
  city: string | null;
  countryOfPassport: string | null;
  visaType: string | null;
  branch: string | null;
  assignee: string | null;
  deals: StudentDeal[];
  education: StudentEducation[];
  /** One line per test as the CRM describes it ("IELTS overall 6.5, L7 R6.5 W6 S6.5"). */
  testScores: string[];
  preferredIntake: string | null;
  /** The CRM's financial details as one line ("bank balance NPR 4,500,000"). */
  financial: string | null;
  applications: StudentApplication[];
  /** Which parts of the record this CRM exposes to Edge. A field from an unavailable part is unknown, not missing. */
  available: Record<StudentFieldSource, boolean>;
  /** How the snapshot was read (one composed read today; kept so a single-call CRM tool can be told apart later). */
  via: "composed";
  fetchedAt: string;
  /** The contact's page in the CRM front end, when CRM_WEB_URL is set. */
  webUrl: string | null;
}

export type SnapshotResult =
  | { ok: true; snapshot: StudentSnapshot; record: RetrievedChunk }
  | { ok: false; reason: "no_crm" | "not_visible" | "error"; message: string };

export interface ContactMatch {
  id: string;
  name: string;
  email: string | null;
  status: string | null;
  branch: string | null;
}

// --- Parsing ------------------------------------------------------------------
// crm-api projects everything to plain JSON; these schemas are lenient on purpose (every field
// optional, unknown keys ignored) so a CRM that adds a field never breaks a guided turn.

const text = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim()));
const named = z.object({ name: text }).partial().nullish().transform((v) => v?.name ?? null);
const strings = z
  .array(z.unknown())
  .nullish()
  .transform((v) => (v ?? []).map((x) => (typeof x === "string" ? x : typeof x === "object" && x && "name" in x ? String((x as { name: unknown }).name) : "")).map((s) => s.trim()).filter(Boolean));

const ContactSchema = z.object({
  id: z.string(),
  name: text,
  status: text,
  nationality: text,
  country: text,
  city: text,
  countryOfPassport: text,
  visaType: text,
  branch: named,
  assignee: named,
});

const DealSchema = z.object({
  id: z.string(),
  name: text,
  status: text,
  interestedService: z.union([z.string(), z.object({ name: text }).partial()]).nullish().transform((v) => (typeof v === "string" ? v : (v?.name ?? null))),
  countries: strings,
  services: strings,
});


/** One item of `crm_get_student_overview.applications` (crm-api, counsellor CRM reads). */
const ApplicationSchema = z
  .object({
    id: z.string(),
    status: text,
    intake: text,
    institution: named,
    course: named,
    currentStage: named,
  })
  .transform((a): StudentApplication => ({ id: a.id, status: a.status, institution: a.institution, course: a.course, intake: a.intake, workflowStage: a.currentStage }));

// --- Fields -------------------------------------------------------------------

const firstNonEmpty = (xs: (string | null)[]) => xs.find((x) => x) ?? null;
const unique = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/** The value of one journey field on a snapshot, as text; null when the CRM has none. */
export function studentFieldValue(s: StudentSnapshot, key: StudentFieldKey): string | null {
  switch (key) {
    case "origin":
      return firstNonEmpty([s.nationality, s.country]);
    case "passportCountry":
      return s.countryOfPassport;
    case "visaType":
      return s.visaType;
    case "service":
      return unique(s.deals.flatMap((d) => [d.service ?? "", ...d.services])).join(", ") || null;
    case "destinations":
      return unique(s.deals.flatMap((d) => d.countries)).join(", ") || null;
    case "educationLevel":
      return firstNonEmpty(s.education.map((e) => e.degreeLevel ?? e.degreeTitle));
    case "grades":
      return (
        s.education
          .map((e) => [e.percentage ? `${e.percentage}%` : null, e.securedGpa ? `GPA ${e.securedGpa}${e.totalGpa ? ` of ${e.totalGpa}` : ""}` : null].filter(Boolean).join(", "))
          .filter(Boolean)
          .join("; ") || null
      );
    case "englishTest":
      return s.testScores.join("; ") || null;
    case "intake":
      return firstNonEmpty([s.preferredIntake, ...s.applications.map((a) => a.intake)]);
    case "funds":
      return s.financial;
    case "institutions":
      return unique(s.applications.map((a) => a.institution ?? "")).join(", ") || null;
    case "applicationStage":
      return unique(s.applications.map((a) => a.workflowStage ?? "")).join(", ") || null;
  }
}

/**
 * What a step still needs from the CRM. `missing`: the CRM exposes the field and it is empty,
 * so the consultant should fill it in. `unknown`: this CRM does not expose that part of the
 * record to Edge, so nobody can tell — shown as such, never as missing.
 */
export function stepFieldGaps(s: StudentSnapshot | null, step: JourneyStepKey): { missing: StudentFieldKey[]; unknown: StudentFieldKey[] } {
  const fields = journeyStep(step).crmFields;
  if (!s) return { missing: [], unknown: [...fields] };
  const missing: StudentFieldKey[] = [];
  const unknown: StudentFieldKey[] = [];
  for (const f of fields) {
    if (!s.available[STUDENT_FIELDS[f].source]) unknown.push(f);
    else if (!studentFieldValue(s, f)) missing.push(f);
  }
  return { missing, unknown };
}

/** The snapshot as evidence text: what the answer cites for facts about this student. */
export function renderSnapshot(s: StudentSnapshot): string {
  const v = (x: string | null) => x ?? "not recorded";
  const lines = [
    `${s.name} — CRM contact ${s.contactId}. CRM status: ${v(s.status)}. Branch: ${v(s.branch)}. Assignee: ${v(s.assignee)}.`,
    `Nationality: ${v(s.nationality)}. Lives in: ${[s.city, s.country].filter(Boolean).join(", ") || "not recorded"}. Passport country: ${v(s.countryOfPassport)}. Current visa type: ${v(s.visaType)}.`,
    s.deals.length
      ? `Deals: ${s.deals.map((d) => `${d.name ?? d.id} [${d.status ?? "unknown"}]${d.service ? `, service ${d.service}` : ""}${d.countries.length ? `, destinations ${d.countries.join(", ")}` : ""}${d.services.length ? `, services ${d.services.join(", ")}` : ""}`).join("; ")}.`
      : "Deals: none visible.",
  ];
  if (s.available.education)
    lines.push(
      s.education.length
        ? `Education: ${s.education.map((e) => [e.degreeTitle ?? e.degreeLevel, e.degreeLevel && e.degreeTitle ? `(${e.degreeLevel})` : null, e.institution ? `at ${e.institution}` : null, e.percentage ? `${e.percentage}%` : null, e.securedGpa ? `GPA ${e.securedGpa}${e.totalGpa ? ` of ${e.totalGpa}` : ""}` : null].filter(Boolean).join(" ")).join("; ")}.`
        : "Education: not recorded.",
    );
  if (s.available.tests) lines.push(`English and other tests: ${s.testScores.join("; ") || "not recorded"}.`);
  if (s.available.intake) lines.push(`Preferred intake: ${v(s.preferredIntake)}.`);
  if (s.available.financial) lines.push(`Financial details: ${v(s.financial)}.`);
  if (s.available.applications)
    lines.push(
      s.applications.length
        ? `Applications: ${s.applications.map((a) => `${[a.institution, a.course].filter(Boolean).join(" — ") || a.id}${a.intake ? `, intake ${a.intake}` : ""}${a.workflowStage ? `, stage ${a.workflowStage}` : ""} [${a.status ?? "unknown"}]`).join("; ")}.`
        : "Applications: none.",
    );
  const hidden = (["education", "tests", "intake", "financial", "applications"] as const).filter((k) => !s.available[k]);
  if (hidden.length) lines.push(`Not exposed by the CRM to Edge yet: ${hidden.join(", ")}.`);
  return lines.join("\n");
}

function toRecord(s: StudentSnapshot): RetrievedChunk {
  return {
    id: `crm:student:${s.contactId}`,
    url: `crm://student/${s.contactId}`,
    webUrl: s.webUrl,
    title: `CRM record: ${s.name}`,
    section: `guided session student, read ${s.fetchedAt}`,
    docType: "crm_record",
    country: null,
    source: "crm",
    content: renderSnapshot(s),
    score: 1,
    matchedBy: ["crm"],
  };
}

// --- Named student (research reads) ------------------------------------------

/** One successful CRM read the research loop made: the tool, its arguments and its structured result. */
export interface CrmRead {
  tool: string;
  args: Record<string, unknown>;
  structured: Record<string, unknown> | undefined;
}

/** Place names out of a value that is a string, a `{ name }` object or a list of either. */
const placeNames = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(placeNames) : v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string" ? [(v as { name: string }).name] : [];

/** Destination names an application row carries, wherever this crm-api puts them. */
const applicationCountries = (a: unknown): string[] => {
  if (!a || typeof a !== "object") return [];
  const row = a as Record<string, unknown>;
  const nested = (k: string) => (row[k] && typeof row[k] === "object" ? placeNames((row[k] as Record<string, unknown>).country) : []);
  return [...placeNames(row.country), ...placeNames(row.destination), ...nested("institution"), ...nested("course")];
};

/**
 * The one student the research model found but never opened: exactly one distinct contact across
 * crm_search_contacts results and crm_get_contact reads, and no crm_get_student_overview of them
 * yet (an overview of someone else, e.g. the previous turn's student, does not count). Null when
 * there is nothing to open or the name matched several people.
 */
export function pendingStudentOverview(reads: readonly CrmRead[]): string | null {
  const opened = new Set(reads.filter((r) => r.tool === "crm_get_student_overview").map((r) => ContactSchema.safeParse(r.structured?.contact).data?.id ?? r.args.id));
  const ids = new Set<string>();
  for (const r of reads) {
    if (r.tool === "crm_search_contacts") {
      const contacts = Array.isArray(r.structured?.contacts) ? (r.structured.contacts as unknown[]) : [];
      for (const c of contacts) if (c && typeof (c as { id?: unknown }).id === "string") ids.add((c as { id: string }).id);
    } else if (r.tool === "crm_get_contact") {
      const id = ContactSchema.safeParse(r.structured?.contact).data?.id ?? (typeof r.args.id === "string" ? r.args.id : null);
      if (id) ids.add(id);
    }
  }
  const [only] = ids;
  return ids.size === 1 && !opened.has(only) ? only! : null;
}

/**
 * The one student a non-guided turn's research read, from the CRM tools' structured results
 * (`crm_get_student_overview`, `crm_get_contact`, `crm_get_deal`, `crm_list_applications`): the
 * contact the last overview was fetched for, else the only contact read; null when several were
 * read without an overview (no way to tell which the question is about). The contact is returned
 * even when the record names neither a market nor a destination, so the next turn can follow up on
 * them; `name` is the record's name when it has one. Deals count only when they belong to that
 * contact (listed on its overview, or carrying its id) and are not lost or archived.
 */
export function crmStudentFromReads(reads: readonly CrmRead[]): CrmStudentRef | null {
  const contactOf = (r: CrmRead) => {
    const parsed = ContactSchema.safeParse(r.structured?.contact);
    return parsed.success ? parsed.data : null;
  };
  const overview = [...reads].reverse().find((r) => r.tool === "crm_get_student_overview" && r.structured);
  const contactReads = reads.filter((r) => r.tool === "crm_get_contact" || r.tool === "crm_get_student_overview");
  const ids = new Set(contactReads.map((r) => contactOf(r)?.id ?? (typeof r.args.id === "string" ? r.args.id : null)).filter((x): x is string => Boolean(x)));
  const contactId = overview ? (contactOf(overview)?.id ?? (typeof overview.args.id === "string" ? overview.args.id : null)) : ids.size === 1 ? [...ids][0]! : null;
  if (!contactId) return null;

  const records = contactReads.map(contactOf).filter((c): c is z.infer<typeof ContactSchema> => c?.id === contactId);
  const first = (pick: (c: z.infer<typeof ContactSchema>) => string | null) => records.map(pick).find((x) => x) ?? null;
  const origin = marketFromName(first((c) => c.nationality)) ?? marketFromName(first((c) => c.countryOfPassport)) ?? marketFromName(first((c) => c.country));

  const ownOverview = overview && (contactOf(overview)?.id ?? overview.args.id) === contactId ? overview.structured : undefined;
  const listed = new Set((z.array(z.object({ id: z.string() }).passthrough()).safeParse(ownOverview?.deals).data ?? []).map((d) => d.id));
  const names: string[] = [];
  const dealRows = [...(Array.isArray(ownOverview?.deals) ? ownOverview.deals : []), ...reads.filter((r) => r.tool === "crm_get_deal").map((r) => r.structured?.deal)];
  for (const raw of dealRows) {
    const deal = DealSchema.safeParse(raw);
    if (!deal.success || !ACTIVE_DEAL(deal.data.status)) continue;
    const owner = (raw as { contact?: { id?: unknown } }).contact?.id;
    if (listed.has(deal.data.id) || owner === contactId) names.push(...deal.data.countries);
  }
  const applicationRows = [
    ...(Array.isArray(ownOverview?.applications) ? ownOverview.applications : []),
    ...reads.filter((r) => r.tool === "crm_list_applications" && (r.args.contactId === contactId || r.args.id === contactId)).flatMap((r) => (Array.isArray(r.structured?.applications) ? r.structured.applications : [])),
  ];
  for (const a of applicationRows) names.push(...applicationCountries(a));
  const name = first((c) => c.name);
  return { contactId, ...(name ? { name } : {}), origin, destinations: destinationsFromNames(names) };
}

// --- Reader -------------------------------------------------------------------

export interface CrmStudentReaderOptions {
  provider: CrmProvider;
  crmWebUrl?: string;
  /** How long one consultant's snapshot of one student is reused (default 60 s). */
  cacheTtlMs?: number;
  maxCached?: number;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

const ACTIVE_DEAL = (status: string | null) => !status || !["lost", "archived"].includes(status.toLowerCase());
const MAX_DEALS = 3;

export class CrmStudentReader {
  private readonly cache = new Map<string, { at: number; result: SnapshotResult & { ok: true } }>();

  constructor(private readonly o: CrmStudentReaderOptions) {}

  /** Read one student as `actorEmail` sees them. Never throws. */
  async snapshot(actorEmail: string | null, contactId: string, signal?: AbortSignal): Promise<SnapshotResult> {
    if (!actorEmail) return { ok: false, reason: "no_crm", message: "No consultant identity, so no CRM access." };
    const key = `${actorEmail.toLowerCase()}|${contactId}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < (this.o.cacheTtlMs ?? 60_000)) return hit.result;
    this.cache.delete(key);

    const crm = await this.o.provider.forActor(actorEmail, signal);
    if (!crm) return { ok: false, reason: "no_crm", message: "The CRM is not reachable for this consultant." };
    try {
      const snapshot = await this.composed(crm, contactId, signal);
      if (!snapshot) return { ok: false, reason: "not_visible", message: "This student is not visible to you in the CRM." };
      const result = { ok: true as const, snapshot, record: toRecord(snapshot) };
      if (this.cache.size >= (this.o.maxCached ?? 500)) {
        const oldest = this.cache.keys().next();
        if (!oldest.done) this.cache.delete(oldest.value);
      }
      this.cache.set(key, { at: Date.now(), result });
      return result;
    } catch (err) {
      this.o.log?.("could not read the guided session's CRM student", { err: (err as Error).message });
      return { ok: false, reason: "error", message: "The CRM could not be read just now." };
    }
  }

  /** Drop cached snapshots of a student (e.g. after the consultant says they updated the CRM). */
  forget(contactId: string) {
    for (const k of this.cache.keys()) if (k.endsWith(`|${contactId}`)) this.cache.delete(k);
  }

  /** Contacts matching `query` that `actorEmail` may see, for the guided-session picker. Null when the CRM is unavailable. */
  async searchContacts(actorEmail: string | null, query: string, limit = 10, signal?: AbortSignal): Promise<ContactMatch[] | null> {
    const crm = actorEmail ? await this.o.provider.forActor(actorEmail, signal) : undefined;
    if (!crm) return null;
    const res = await crm.call("crm_search_contacts", { query, limit }, signal);
    if (res.isError) throw new Error(res.text || "the CRM refused the search");
    const parsed = z.object({ contacts: z.array(ContactSchema.extend({ email: text })).nullish() }).safeParse(res.structured ?? {});
    return (parsed.success ? (parsed.data.contacts ?? []) : []).map((c) => ({ id: c.id, name: c.name ?? c.id, email: c.email, status: c.status, branch: c.branch }));
  }

  private async composed(crm: CrmToolset, contactId: string, signal?: AbortSignal): Promise<StudentSnapshot | null> {
    const has = (name: string) => crm.descriptors.some((d) => d.name === name);
    const [overview, contact] = await Promise.all([
      has("crm_get_student_overview") ? crm.call("crm_get_student_overview", { id: contactId }, signal) : null,
      has("crm_get_contact") ? crm.call("crm_get_contact", { id: contactId }, signal) : null,
    ]);
    // The contact read is the permission gate: a refused read means no snapshot, whatever else answered.
    if (contact?.isError || (!contact && overview?.isError)) return null;
    const contactOut = contact && !contact.isError ? ContactSchema.safeParse(contact.structured?.contact) : null;
    const overviewOut = overview && !overview.isError ? overview.structured : undefined;
    const base = contactOut?.success ? contactOut.data : ContactSchema.safeParse(overviewOut?.contact).data;
    if (!base) return null;

    const dealRows = z.array(z.object({ id: z.string(), status: text })).safeParse(overviewOut?.deals ?? []).data ?? [];
    // Present once crm-api's overview carries applications; absent on older CRMs, which is "unknown".
    const applications = Array.isArray(overviewOut?.applications) ? z.array(ApplicationSchema).safeParse(overviewOut.applications).data : undefined;
    const deals = has("crm_get_deal")
      ? (
          await Promise.all(
            dealRows
              .filter((d) => ACTIVE_DEAL(d.status))
              .slice(0, MAX_DEALS)
              .map(async (d) => {
                const r = await crm.call("crm_get_deal", { id: d.id }, signal).catch(() => null);
                const parsed = r && !r.isError ? DealSchema.safeParse(r.structured?.deal) : null;
                return parsed?.success ? dealFields(parsed.data) : null;
              }),
          )
        ).filter((d): d is StudentDeal => d !== null)
      : [];

    return this.finish(
      {
        ...contactFields(base),
        deals,
        education: [],
        testScores: [],
        preferredIntake: null,
        financial: null,
        applications: applications ?? [],
        available: { contact: true, deals: has("crm_get_deal"), education: false, tests: false, financial: false, intake: false, applications: applications !== undefined },
        via: "composed",
      },
      contactId,
    );
  }

  private finish(s: Omit<StudentSnapshot, "fetchedAt" | "webUrl">, contactId: string): StudentSnapshot {
    return { ...s, contactId, fetchedAt: new Date().toISOString(), webUrl: crmDeepLink(this.o.crmWebUrl, "crm_get_contact", { id: contactId, name: s.name }) };
  }
}

function contactFields(c: z.infer<typeof ContactSchema>) {
  return {
    contactId: c.id,
    name: c.name ?? "Unnamed student",
    status: c.status,
    nationality: c.nationality,
    country: c.country,
    city: c.city,
    countryOfPassport: c.countryOfPassport,
    visaType: c.visaType,
    branch: c.branch,
    assignee: c.assignee,
  };
}

function dealFields(d: z.infer<typeof DealSchema>): StudentDeal {
  return { id: d.id, name: d.name, status: d.status, service: d.interestedService, countries: d.countries, services: d.services };
}

/** Every journey field with its value, for the student panel. */
export function studentFields(s: StudentSnapshot) {
  return STUDENT_FIELD_KEYS.map((key) => ({
    key,
    label: STUDENT_FIELDS[key].label,
    available: s.available[STUDENT_FIELDS[key].source],
    value: s.available[STUDENT_FIELDS[key].source] ? studentFieldValue(s, key) : null,
  }));
}
