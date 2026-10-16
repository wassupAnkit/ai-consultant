import type { CrmProvider, CrmToolDescriptor, CrmToolResult, CrmToolset } from "./client";

/**
 * A stand-in CRM for local development (`CRM_DEMO=true`): three made-up students behind the
 * same read tools crm-api publishes, so guided sessions can be clicked through without a CRM
 * token exchange. The env schema refuses it in production. Every name, id and figure below is
 * fictitious.
 */

interface DemoStudent {
  contact: Record<string, unknown>;
  deals: { id: string; name: string; status: string; interestedService: string; countries: string[]; services: string[] }[];
  applications: Record<string, unknown>[];
  notes: { description: string; type: string; updatedAt: string }[];
}

const branch = { id: "b-ktm", name: "Kathmandu (Putalisadak)" };
/** The demo counsellor's primary branch, as crm-api's `crm_get_me` returns it (the newer shape, with the address). */
const myBranch = { ...branch, country: "Nepal", city: "Kathmandu", state: "Bagmati", timezone: "Asia/Kathmandu" };
const assignee = { id: "u-demo", name: "Demo Counsellor" };

const STUDENTS: DemoStudent[] = [
  {
    // Destination recorded, nothing applied: Edge proposes starting at Course.
    contact: { id: "0e7c1a52-3f41-4c1e-9a55-1b2f3c4d5e61", name: "Sita Sharma", email: "sita.sharma@example.com", status: "Prospect", nationality: "Nepal", country: "Nepal", city: "Kathmandu", countryOfPassport: "Nepal", visaType: null, branch, assignee },
    deals: [{ id: "5a0f2b33-7c44-4d2e-8f10-2a3b4c5d6e71", name: "Sita — Study abroad", status: "in-progress", interestedService: "Admission", countries: ["Australia", "Canada"], services: ["Visa"] }],
    applications: [],
    notes: [{ description: "Finished BBS at TU in 2024. Interested in a master's in business analytics.", type: "general", updatedAt: "2026-09-20T09:00:00.000Z" }],
  },
  {
    // Offer in hand: Edge proposes starting at Application & offer.
    contact: { id: "1f8d2b63-4a52-4d2f-8b66-2c3d4e5f6a72", name: "Ramesh Karki", email: "ramesh.karki@example.com", status: "Client", nationality: "Nepal", country: "Nepal", city: "Pokhara", countryOfPassport: "Nepal", visaType: null, branch: { id: "b-pkr", name: "Pokhara" }, assignee },
    deals: [{ id: "6b1a3c44-8d55-4e3f-9a21-3b4c5d6e7f82", name: "Ramesh — Masters AU", status: "in-progress", interestedService: "Admission", countries: ["Australia"], services: ["Visa", "Accommodation"] }],
    applications: [
      {
        id: "7c2b4d55-9e66-4f4a-8b32-4c5d6e7f8a93",
        status: "In Progress",
        intake: "Feb 2027",
        institution: { id: "i-monash", name: "Monash University" },
        course: { id: "c-mit", name: "Master of Information Technology" },
        currentStage: { id: "st-offer", name: "Offer received" },
        nextStage: { id: "st-coe", name: "CoE issued" },
        previousStage: { id: "st-lodged", name: "Application lodged" },
        assignees: [assignee],
      },
    ],
    notes: [{ description: "Conditional offer received; IELTS 6.5 overall needed by 15 Nov.", type: "general", updatedAt: "2026-09-25T09:00:00.000Z" }],
  },
  {
    // Fresh enquiry: starts at Enquiry, no suggestion.
    contact: { id: "2a9e3c74-5b63-4e3a-9c77-3d4e5f6a7b83", name: "Anjali Thapa", email: "anjali.thapa@example.com", status: "Lead", nationality: "Nepal", country: "Nepal", city: "Lalitpur", countryOfPassport: null, visaType: null, branch, assignee: null },
    deals: [],
    applications: [],
    notes: [],
  },
];

const read = { readOnlyHint: true };
const idArg = { type: "object", properties: { id: { type: "string" } }, required: ["id"] } as const;
const DESCRIPTORS: CrmToolDescriptor[] = [
  { name: "crm_get_me", title: "Who am I", description: "The signed-in counsellor: name, role and primary branch (demo CRM).", inputSchema: { type: "object", properties: {} } as never },
  { name: "crm_search_contacts", title: "Search contacts", description: "Find contacts by name, email or phone (demo CRM).", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } as never },
  { name: "crm_get_contact", title: "Get contact", description: "Read one contact (demo CRM).", inputSchema: idArg as never },
  { name: "crm_get_student_overview", title: "Student overview", description: "Record, deals, applications and recent notes for one student (demo CRM).", inputSchema: idArg as never },
  { name: "crm_get_deal", title: "Get deal", description: "Read one deal (demo CRM).", inputSchema: idArg as never },
].map((d) => ({ ...d, annotations: read }));

const ok = (text: string, structured: Record<string, unknown>): CrmToolResult => ({ text, structured, isError: false });
const notVisible = (what: string): CrmToolResult => ({ text: `${what} is not visible to you.`, isError: true });
const byContact = (id: unknown) => STUDENTS.find((s) => s.contact.id === id);

function call(name: string, args: Record<string, unknown>, actor: string): CrmToolResult {
  switch (name) {
    case "crm_get_me": {
      const me = { id: "u-demo", name: "Demo Counsellor", email: actor, country: "Nepal", timeZone: "Asia/Kathmandu", branch: myBranch };
      return ok(`You are ${me.name} (${actor}), primary branch ${myBranch.name}, ${myBranch.city}, ${myBranch.country}.`, { me });
    }
    case "crm_search_contacts": {
      const q = String(args.query ?? "").toLowerCase().trim();
      const hits = STUDENTS.filter((s) => [s.contact.name, s.contact.email].some((v) => String(v ?? "").toLowerCase().includes(q))).slice(0, Number(args.limit) || 10);
      const contacts = hits.map((s) => ({ id: s.contact.id, name: s.contact.name, email: s.contact.email, status: s.contact.status, branch: s.contact.branch }));
      return ok(hits.length ? hits.map((s) => `- ${s.contact.name} — id ${s.contact.id}`).join("\n") : `No contacts match "${q}".`, { contacts, hiddenCount: 0 });
    }
    case "crm_get_contact": {
      const s = byContact(args.id);
      return s ? ok(`${s.contact.name} — contact id ${s.contact.id}. Status ${s.contact.status}. Nationality ${s.contact.nationality}.`, { contact: s.contact }) : notVisible("That contact");
    }
    case "crm_get_student_overview": {
      const s = byContact(args.id);
      if (!s) return notVisible("That contact");
      const apps = s.applications.map((a) => `${(a.institution as { name: string }).name} — ${(a.course as { name: string }).name}, stage ${(a.currentStage as { name: string }).name}`);
      return ok(
        [
          `${s.contact.name} — contact id ${s.contact.id}. Status ${s.contact.status}. Branch ${(s.contact.branch as { name: string }).name}.`,
          s.deals.length ? `Deals (${s.deals.length}): ${s.deals.map((d) => `${d.name} [${d.status}] (${d.id})${d.countries.length ? ` → ${d.countries.join(", ")}` : ""}`).join("; ")}` : "Deals: none visible.",
          apps.length ? `Applications: ${apps.join("; ")}` : "Applications: none.",
          s.notes.length ? `Recent notes:\n${s.notes.map((n) => `  - ${n.description}`).join("\n")}` : "Recent notes: none.",
        ].join("\n"),
        { contact: s.contact, deals: s.deals.map((d) => ({ id: d.id, name: d.name, status: d.status, countries: d.countries })), enquiries: [], notes: s.notes, applications: s.applications },
      );
    }
    case "crm_get_deal": {
      const d = STUDENTS.flatMap((s) => s.deals.map((x) => ({ ...x, contact: { id: s.contact.id, name: s.contact.name } }))).find((x) => x.id === args.id);
      return d ? ok(`${d.name} [${d.status}]. Destinations: ${d.countries.join(", ")}.`, { deal: d }) : notVisible("That deal");
    }
    default:
      return { text: `Unknown tool ${name}`, isError: true };
  }
}

export function createDemoCrmProvider(): CrmProvider {
  return {
    forActor: async (email) => {
      if (!email || !email.includes("@")) return undefined;
      const toolset: CrmToolset = { actor: email.toLowerCase(), descriptors: DESCRIPTORS, call: async (name, args) => call(name, args, email.toLowerCase()), refresh: async () => {} };
      return toolset;
    },
  };
}
