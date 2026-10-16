/**
 * Turns a CRM tool call into a link a consultant can click.
 *
 * The routes below are the CRM front end's own (apps/crm `shared/constants/url.ts` +
 * `routes/app-router.tsx`), copied rather than guessed — a URL this file invents lands the
 * consultant on the CRM's not-found page, which is worse than no link at all. When a route
 * needs an id the arguments do not carry, we deliberately fall back to the list page the
 * record lives on instead of building something broken.
 *
 * Only the tool name and its arguments are available here (the evidence chunk is built before
 * the result is parsed), so e.g. a deal id alone cannot reach the deal page: that route is
 * nested under the contact and needs both ids.
 */

/** `/deals/:status` — the status the CRM's own sidebar link opens. */
const DEALS_DEFAULT_STATUS = "discovery";
/** `/enquiries/:type` — the CRM's "new contacts" default tab. */
const ENQUIRIES_DEFAULT_TYPE = "all";
/** `/contact/detail/:id/:slug` — the slug is a display segment; the CRM ignores an unknown one. */
const CONTACT_DEFAULT_SLUG = "detail";

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
};

/** Path segment from a name; falls back to `detail` so the route always has its slug. */
function slugify(name: string | undefined): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || CONTACT_DEFAULT_SLUG;
}

const contactPath = (id: string, name?: string) => `/contact/detail/${encodeURIComponent(id)}/${slugify(name)}`;
const dealsListPath = (status?: string) => `/deals/${encodeURIComponent(status ?? DEALS_DEFAULT_STATUS)}`;
const enquiriesListPath = (type?: string) => `/enquiries/${encodeURIComponent(type ?? ENQUIRIES_DEFAULT_TYPE)}`;

/** The CRM page a tool call is about, as a path. Null when the tool has no page (`crm_get_me`). */
export function crmDeepLinkPath(tool: string, args: Record<string, unknown>): string | null {
  const id = str(args.id);
  const contactId = str(args.contactId);
  const status = str(args.status);

  switch (tool) {
    case "crm_get_contact":
    case "crm_get_student_overview":
      return id ? contactPath(id, str(args.name)) : null;

    case "crm_search_contacts":
    case "crm_list_my_contacts":
      // `/contacts/:name` is a named list, not a search term: "my-contacts" for the caller's
      // own caseload, "all-contacts" for the wider search.
      return tool === "crm_list_my_contacts" ? "/contacts/my-contacts" : "/contacts/all-contacts";

    case "crm_list_my_tasks":
      return "/tasks/all";

    case "crm_get_deal":
      // The deal page is nested under its contact, so a deal id on its own cannot reach it.
      // A caller that passes both gets the record; everyone else gets the list it is on.
      return contactId && id ? `/contact/${encodeURIComponent(contactId)}/deals/${encodeURIComponent(id)}` : dealsListPath();

    case "crm_list_deals":
      return dealsListPath(status);

    case "crm_get_enquiry":
    case "crm_search_enquiries":
    case "crm_list_enquiries":
      // The CRM has no per-enquiry route — enquiries are opened from the list — so even
      // `crm_get_enquiry` can only point at the list.
      return enquiriesListPath(str(args.type));

    case "crm_list_notes": {
      // Notes belong to whatever record they were logged against.
      const recordId = str(args.recordId);
      const source = str(args.source);
      if (source === "contact" && recordId) return contactPath(recordId);
      if (source === "deal") return dealsListPath();
      if (source === "enquiry") return enquiriesListPath();
      return null;
    }

    // crm_get_me is the acting user, crm_list_interested_services is tenant reference data:
    // neither is a record a consultant would navigate to.
    default:
      return null;
  }
}

/**
 * Absolute CRM URL for a tool call, or null when there is no sensible page (or CRM_WEB_URL
 * is unset). Never throws: a bad base URL just means no link.
 */
export function crmDeepLink(webBaseUrl: string | undefined, tool: string, args: Record<string, unknown>): string | null {
  if (!webBaseUrl) return null;
  const path = crmDeepLinkPath(tool, args);
  if (!path) return null;
  try {
    return new URL(path, webBaseUrl).toString();
  } catch {
    return null;
  }
}
