/**
 * Resolves a consultant's Gmail and Drive MCP toolsets for one turn.
 *
 * Modelled on `createCrmProvider` (src/crm/client.ts), with two differences:
 * - Only the tool *list* (and the client holding its session) is cached, not a token. The
 *   client's headers callback asks the AccessTokenSource on every request, so an access token
 *   that refreshed mid-cache is picked up without rebuilding anything.
 * - What is offered is decided here, in code. Google's servers are a developer preview and
 *   publish label, spam, trash, share and send tools next to the read ones; their annotations
 *   are not trusted on their own. A tool is offered only if the server listed it AND it is on
 *   the allowlist below, and its `readOnlyHint` is forced to what this file says it is.
 *
 * Never throws: every failure becomes a per-service status, so a turn without Google access
 * still answers from everything else and can tell the consultant to connect.
 *
 * Transport: Google's MCP servers refuse every call from a Cloud project that is not enrolled in
 * the Workspace Developer Preview. With `transport: "auto"` (the default) such a refusal, or a
 * server that cannot list its tools, sends that service to the plain REST APIs (src/google/rest.ts)
 * with the same token, tool names and arguments; MCP is tried again after `REST_STICKY_MS`, so an
 * approved enrolment takes over on its own. `"rest"` never calls the MCP servers; `"mcp"` never
 * falls back.
 */
import { McpError, McpHttpClient } from "../mcp/client";
import { sanitizeToolSchema } from "../mcp/schema";
import type { McpToolDescriptor, McpToolset } from "../mcp/types";
import type { JsonSchema7Type } from "@langchain/core/utils/json_schema";
import { callRest, REST_DESCRIPTORS } from "./rest";
import { allStatus, SERVICE_LABELS, WORKSPACE_SERVICES, type AccessTokenSource, type ServiceStatus, type WorkspaceProvider, type WorkspaceService, type WorkspaceToolsets } from "./types";

/**
 * Server tool names offered, per service. Reads run autonomously in the research loop; the one
 * write (a Gmail draft, never a send) is offered only with `allowDrafts` and only ever runs
 * behind an approval card. Drive offers no writes and not `download_file_content` (binary) or
 * `get_file_permissions`.
 */
export const WORKSPACE_ALLOWLIST: Record<WorkspaceService, { read: readonly string[]; write: readonly string[] }> = {
  gmail: { read: ["search_threads", "get_thread", "get_message", "list_drafts"], write: ["create_draft"] },
  drive: { read: ["search_files", "read_file_content", "get_file_metadata", "list_recent_files"], write: [] },
  // Never update/delete/respond_to_event: an event is only ever created, behind a card.
  calendar: { read: ["list_events", "search_events", "get_event", "list_calendars", "suggest_time"], write: ["create_event"] },
  // Create-only (drive.file): reading existing Docs and Sheets is Drive's job.
  docs: { read: [], write: ["create_doc", "create_sheet"] },
};

/** Titles for the evidence list and the model, keyed by server tool name. */
const FRIENDLY_TITLES: Record<string, string> = {
  search_threads: "Gmail search",
  get_thread: "Email thread",
  get_message: "Email",
  list_drafts: "Gmail drafts",
  create_draft: "Gmail draft",
  search_files: "Drive search",
  read_file_content: "Drive file",
  get_file_metadata: "Drive file details",
  list_recent_files: "Recent Drive files",
  list_events: "Calendar events",
  search_events: "Calendar search",
  get_event: "Calendar event",
  list_calendars: "Calendars",
  suggest_time: "Free times",
  create_event: "New calendar event",
  create_doc: "New Google Doc",
  create_sheet: "New Google Sheet",
};

const LABELS = SERVICE_LABELS;

export interface WorkspaceProviderOptions {
  tokens: AccessTokenSource;
  gmailUrl: string;
  driveUrl: string;
  /** Google's Calendar MCP server. Docs & Sheets have no MCP URL: creating files is REST-only. */
  calendarUrl?: string;
  timeoutMs: number;
  /** Offer Gmail `create_draft` (as a proposal). Off unless GMAIL_DRAFTS_ENABLED. Same as `allowWrites.gmail`. */
  allowDrafts?: boolean;
  /** Which services' write tools are offered (always as approval-card proposals). */
  allowWrites?: Partial<Record<WorkspaceService, boolean>>;
  /** How long one consultant's tool list is reused. */
  cacheTtlMs?: number;
  /** Bound on distinct consultants cached at once. */
  maxCached?: number;
  /** Which Google API answers the tools. Default "auto": the MCP servers, falling back to REST when they refuse. */
  transport?: WorkspaceTransport;
  log?: (message: string, meta?: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
}

export type WorkspaceTransport = "auto" | "mcp" | "rest";

/** An MCP refusal that means "this project may not use the preview", not "this request was wrong". */
export const MCP_PREVIEW_REFUSED = /developer preview program|caller does not have permission|insufficient authentication scopes/i;

export const DEFAULT_CALENDAR_MCP_URL = "https://calendarmcp.googleapis.com/mcp/v1";
/** After a preview refusal, how long a service stays on REST before MCP is tried again. */
export const REST_STICKY_MS = 10 * 60 * 1000;

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_CACHED = 200;

/** The token source said no while a request was being made: carries the status to report. */
class TokenUnavailable extends McpError {
  constructor(
    label: string,
    readonly serviceStatus: Exclude<ServiceStatus, "connected">,
  ) {
    super(`${label}: no Google access token (${serviceStatus})`, "auth");
  }
}

/** The MCP server itself is off-limits to this project (API not enabled, preview not enrolled), as opposed to down or a bad token. */
const mcpAccessRefused = (err: unknown): boolean =>
  err instanceof McpError && !(err instanceof TokenUnavailable) && (err.status === 403 || err.status === 404 || MCP_PREVIEW_REFUSED.test(err.message));

interface CacheEntry {
  toolset: McpToolset;
  expiresAt: number;
}

const prefixed = (service: WorkspaceService, name: string) => `${service}_${name}`;

/** Point Google's descriptions at the names the model actually sees (`get_thread` → `gmail_get_thread`). */
function renameMentions(service: WorkspaceService, text: string): string {
  const { read, write } = WORKSPACE_ALLOWLIST[service];
  return [...read, ...write].reduce((t, name) => t.replace(new RegExp(`\\b${name}\\b`, "g"), prefixed(service, name)), text);
}

export function createWorkspaceProvider(options: WorkspaceProviderOptions): WorkspaceProvider {
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxCached = options.maxCached ?? DEFAULT_MAX_CACHED;
  const cache = new Map<string, Partial<Record<WorkspaceService, CacheEntry>>>();
  // Once per server for the life of the process (one provider per process): enough to notice
  // the preview renamed a tool without logging it on every turn.
  const warnedMissing = new Set<WorkspaceService>();
  // An empty URL means the service has no MCP server: it is served from REST only.
  const urls: Record<WorkspaceService, string> = { gmail: options.gmailUrl, drive: options.driveUrl, calendar: options.calendarUrl ?? DEFAULT_CALENDAR_MCP_URL, docs: "" };
  const transport = options.transport ?? "auto";
  // Process-wide: preview enrolment belongs to the Cloud project, not to one consultant.
  const restUntil: Record<WorkspaceService, number> = { gmail: 0, drive: 0, calendar: 0, docs: 0 };
  const onRest = (service: WorkspaceService) => transport === "rest" || (transport === "auto" && restUntil[service] > Date.now());
  const switchToRest = (service: WorkspaceService, reason: string) => {
    const already = restUntil[service] > Date.now();
    restUntil[service] = Date.now() + REST_STICKY_MS;
    if (!already) options.log?.(`${LABELS[service]} MCP server refused; serving ${LABELS[service]} from the REST API for now`, { service, reason: reason.slice(0, 200) });
  };

  const offeredNames = (service: WorkspaceService) => {
    const { read, write } = WORKSPACE_ALLOWLIST[service];
    const writesOn = service === "gmail" ? (options.allowWrites?.gmail ?? options.allowDrafts ?? false) : options.allowWrites?.[service] === true;
    return { read: new Set(read), write: new Set(writesOn ? write : []) };
  };

  /** Filter and rewrite the server's list to what this consultant is offered. */
  const filter = (service: WorkspaceService, listed: McpToolDescriptor[], fromServer: McpToolDescriptor[] = listed): McpToolDescriptor[] => {
    const { read, write } = offeredNames(service);
    const out = listed
      .filter((t) => read.has(t.name) || write.has(t.name))
      .map((t) => ({
        name: prefixed(service, t.name),
        title: FRIENDLY_TITLES[t.name] ?? t.title ?? t.name,
        description: renameMentions(service, t.description),
        inputSchema: sanitizeToolSchema(t.inputSchema) as JsonSchema7Type,
        annotations: { ...t.annotations, readOnlyHint: read.has(t.name) },
      }));
    // Allowlisted tools the MCP server did not list (answered from REST when it can): worth one log line.
    const missing = urls[service] && fromServer.length ? [...read].filter((name) => !fromServer.some((t) => t.name === name)) : [];
    if (missing.length && !warnedMissing.has(service)) {
      warnedMissing.add(service);
      options.log?.(`${LABELS[service]} MCP server did not list allowlisted tools; they are not offered`, { service, missing });
    }
    return out;
  };

  /** One retry after dropping the cached access token, for a 401/403 on a token Google has stopped honouring. */
  const withAuthRetry = async <T>(actor: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof McpError) || err instanceof TokenUnavailable || err.kind !== "auth") throw err;
      options.tokens.invalidate(actor);
      return fn();
    }
  };

  const buildToolset = async (actor: string, service: WorkspaceService, signal?: AbortSignal): Promise<McpToolset> => {
    const label = LABELS[service];
    const token = async (s?: AbortSignal) => {
      const t = await options.tokens.accessToken(actor, s);
      if (!t.ok) throw new TokenUnavailable(label, t.status);
      if (!t.services.includes(service)) throw new TokenUnavailable(label, "not_connected");
      return t.token;
    };
    const client = new McpHttpClient({
      url: urls[service],
      label,
      timeoutMs: options.timeoutMs,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      headers: async (s) => ({ authorization: `Bearer ${await token(s)}` }),
    });

    const restCall = (name: string, args: Record<string, unknown>, s?: AbortSignal) =>
      withAuthRetry(actor, async () =>
        callRest(service, name, args, { token: await token(s), timeoutMs: options.timeoutMs, ...(s ? { signal: s } : {}), ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }),
      );

    /** Prefixed names answered by REST whatever the transport: writes, and reads the MCP server did not list. */
    let restTools = new Set<string>();

    /**
     * What this consultant is offered: allowlisted reads the MCP server listed (unless the service is on
     * REST), REST versions of the allowlisted reads it did not list (not with transport "mcp"), and every
     * allowlisted write from REST, because the approval card is built from those exact arguments.
     */
    const list = async (s?: AbortSignal) => {
      const { read, write } = offeredNames(service);
      let listed: McpToolDescriptor[] = [];
      if (urls[service] && !onRest(service)) {
        try {
          await client.initialize(s);
          listed = await client.listTools(s);
        } catch (err) {
          // Only "this project may not use the MCP server" moves to REST. A bad token is retried by
          // withAuthRetry and an outage degrades as before: REST would fail the same way.
          if (transport !== "auto" || !mcpAccessRefused(err)) throw err;
          switchToRest(service, (err as Error).message);
        }
      }
      const fromMcp = listed.filter((t) => read.has(t.name));
      const restReads = transport === "mcp" && urls[service] ? [] : REST_DESCRIPTORS[service].filter((t) => read.has(t.name) && !fromMcp.some((m) => m.name === t.name));
      const restWrites = REST_DESCRIPTORS[service].filter((t) => write.has(t.name));
      restTools = new Set([...restReads, ...restWrites].map((t) => prefixed(service, t.name)));
      const byName = new Map([...fromMcp, ...restReads, ...restWrites].map((t) => [t.name, t]));
      // Allowlist order, so the model sees the same tools in the same order whichever API serves them.
      return filter(service, [...read, ...write].map((n) => byName.get(n)).filter((t): t is McpToolDescriptor => Boolean(t)), listed);
    };
    let descriptors = await withAuthRetry(actor, () => list(signal));

    return {
      actor,
      get descriptors() {
        return descriptors;
      },
      call: async (name, args, s, opts) => {
        const offered = descriptors.find((d) => d.name === name);
        // The model can only call what it was offered, but a direct caller (the approval
        // executor) goes through here too: nothing off the allowlist ever reaches Google.
        if (!offered) throw new McpError(`${label} tool not offered: ${name}`, "protocol");
        const serverName = name.slice(service.length + 1);
        if (restTools.has(name) || onRest(service) || !urls[service]) return restCall(serverName, args, s);
        const result = await withAuthRetry(actor, () => client.callTool(serverName, args, s, opts));
        if (transport === "auto" && result.isError && MCP_PREVIEW_REFUSED.test(result.text)) {
          switchToRest(service, result.text);
          return restCall(serverName, args, s);
        }
        return result;
      },
      refresh: async (s) => {
        descriptors = await withAuthRetry(actor, () => list(s));
      },
    };
  };

  const remember = (actor: string, service: WorkspaceService, toolset: McpToolset) => {
    let entry = cache.get(actor);
    if (!entry) {
      // Crude bound rather than a real LRU, as for the CRM: the working set is the number of
      // consultants active at once.
      if (cache.size >= maxCached) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      entry = {};
      cache.set(actor, entry);
    }
    entry[service] = { toolset, expiresAt: Date.now() + ttl };
  };

  const resolve = async (actor: string, service: WorkspaceService, signal?: AbortSignal): Promise<{ toolset?: McpToolset; status: ServiceStatus }> => {
    // Connected, but nothing of this service is switched on (Docs & Sheets with creation off): nothing to offer, nothing wrong.
    const offered = offeredNames(service);
    if (!offered.read.size && !offered.write.size) return { status: "connected" };
    const cached = cache.get(actor)?.[service];
    if (cached && cached.expiresAt > Date.now()) return { toolset: cached.toolset, status: "connected" };
    try {
      const toolset = await buildToolset(actor, service, signal);
      if (!toolset.descriptors.length) {
        options.log?.(`${LABELS[service]} offered this consultant no allowlisted tools; continuing without it`, { actor, service });
        return { status: "error" };
      }
      remember(actor, service, toolset);
      return { toolset, status: "connected" };
    } catch (err) {
      if (err instanceof TokenUnavailable) return { status: err.serviceStatus };
      // Degrade, never fail the turn.
      options.log?.(`${LABELS[service]} unavailable for this consultant; continuing without it`, {
        actor,
        service,
        err: (err as Error).message,
        ...(err instanceof McpError ? { kind: err.kind, status: err.status } : {}),
      });
      return { status: "error" };
    }
  };

  return {
    async forActor(email, signal) {
      // No identity, no Google access: never fall back to some other mailbox.
      if (!email || !email.includes("@")) return { status: allStatus("not_connected") };
      const actor = email.toLowerCase();

      let token;
      try {
        token = await options.tokens.accessToken(actor, signal);
      } catch (err) {
        options.log?.("Google token source failed; continuing without Gmail and Drive", { actor, err: (err as Error).message });
        return { status: allStatus("error") };
      }
      if (!token.ok) return { status: allStatus(token.status) };
      const granted = token.services;

      const results = await Promise.all(
        WORKSPACE_SERVICES.map((service) => (granted.includes(service) ? resolve(actor, service, signal) : Promise.resolve({ status: "not_connected" as const }))),
      );
      const out: WorkspaceToolsets = { status: allStatus("not_connected") };
      WORKSPACE_SERVICES.forEach((service, i) => {
        const r = results[i]!;
        out.status[service] = r.status;
        if ("toolset" in r && r.toolset) out[service] = r.toolset;
      });
      return out;
    },
    forget(email) {
      const actor = email.toLowerCase();
      cache.delete(actor);
      options.tokens.invalidate(actor);
    },
  };
}
