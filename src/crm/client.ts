/**
 * Minimal MCP client for the CRM's read-only MCP server (crm-api, `POST /v1/mcp`).
 *
 * Hand-rolled rather than `@langchain/mcp-adapters` deliberately. The adapter turns MCP
 * tools straight into LangChain tools, whose output lands in a ToolMessage and nowhere
 * else — but `generate` only reads `state.evidence`, so CRM facts would never reach the
 * answer model. Results have to pass through the EvidenceCollector, which means owning
 * the call path. It also avoids a dependency for what is two JSON-RPC methods over fetch.
 *
 * The tool list is fetched from the server, not hardcoded here, so adding a tool to
 * crm-api needs no change in this repo — only a restart (or a `refresh()`).
 *
 * CRM_MCP_URL unset disables this entirely (see env.example) — every caller treats CRM
 * as optional already (`CrmProvider?`, `ResearchTools.crm?`), so there is nothing else to
 * flip. To plug in a different MCP-based CRM later (e.g. Zoho): replace assertion.ts's
 * HMAC token exchange with that provider's own auth flow, replace deep-link.ts's route
 * table with that provider's URLs, and change the `createCrmProvider(...)` call in
 * server.ts. Everything else here — this file's tool-descriptor plumbing, tools/crm.ts,
 * the `ResearchTools.crm` slot and the CRM write-approvals flow — is reused unchanged,
 * the same way src/google/provider.ts reuses the shared MCP transport for Gmail/Drive.
 */
import { McpError, McpHttpClient } from "../mcp/client";
import { isReadOnlyTool, type McpCallOptions, type McpToolDescriptor, type McpToolResult, type McpToolset } from "../mcp/types";
import { signCrmAssertion } from "./assertion";

/**
 * The CRM's names for the shared MCP shapes (src/mcp/types.ts). A CRM tool's `readOnlyHint: false`
 * marks a tool that changes CRM records.
 */
export type CrmToolDescriptor = McpToolDescriptor;
export type CrmToolResult = McpToolResult;
export type CrmCallOptions = McpCallOptions;
export { isReadOnlyTool };

export interface CrmConfig {
  /** Full URL of the MCP endpoint, e.g. https://crm.api.applyims.com/v1/mcp */
  url: string;
  /** CRM access token (JWT) for this client instance — always one consultant's own token. */
  token: string;
  /**
   * Origin header value. Required, not optional: crm-api's VerifyAccount guard does
   * `new URL(request.headers.origin).hostname` unguarded and throws a 500 without it.
   * Its hostname also resolves the tenant when no x-tenant-id is sent.
   */
  tenantOrigin: string;
  /** Optional explicit tenant id; takes precedence over the Origin lookup in crm-api. */
  tenantId?: string;
  timeoutMs: number;
}

export class CrmError extends Error {}

/** Rethrow the shared client's McpError as the CrmError this module has always thrown, message unchanged. */
const asCrmError = (err: unknown): never => {
  throw err instanceof McpError ? new CrmError(err.message) : err;
};

/** The transport lives in McpHttpClient; this adds crm-api's headers and keeps the CRM's error type. */
export class CrmMcpClient {
  private readonly mcp: McpHttpClient;

  constructor(config: CrmConfig) {
    this.mcp = new McpHttpClient({
      url: config.url,
      label: "CRM",
      authHint: "The CRM token is invalid, expired, or lacks access.",
      timeoutMs: config.timeoutMs,
      // crm-api is stateless and has never been sent the notification; keep it that way.
      sendInitialized: false,
      headers: () => ({
        // crm-api answers JSON only; it has never been offered SSE.
        accept: "application/json",
        authorization: `Bearer ${config.token}`,
        origin: config.tenantOrigin,
        ...(config.tenantId ? { "x-tenant-id": config.tenantId } : {}),
      }),
    });
  }

  /** Handshake. The server is stateless and issues no session id, so this only negotiates. */
  async initialize(signal?: AbortSignal): Promise<void> {
    await this.mcp.initialize(signal).catch(asCrmError);
  }

  async listTools(signal?: AbortSignal): Promise<CrmToolDescriptor[]> {
    return this.mcp.listTools(signal).catch(asCrmError);
  }

  /**
   * `opts.meta` becomes MCP's `params._meta`. The write-approval protocol rides there: a dry run
   * (`heubert/dryRun`) or the previewed version an execute must still match (`heubert/expectedVersion`).
   */
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal, opts?: CrmCallOptions): Promise<CrmToolResult> {
    return this.mcp.callTool(name, args, signal, opts).catch(asCrmError);
  }
}

/**
 * What the research loop is handed. Optional members of ResearchTools are simply not offered.
 * Its `actor` is who writes are proposed and decided under; `refresh()` re-reads tools/list, so a
 * tool added to crm-api appears without a redeploy of this repo.
 */
export type CrmToolset = McpToolset;

export interface CrmProviderOptions {
  /** MCP endpoint. The token exchange is derived from it as `${url}/token`. */
  url: string;
  /** Shared HMAC secret for the token exchange. Not the Edge session secret. */
  exchangeSecret: string;
  tenantOrigin: string;
  tenantId?: string;
  timeoutMs: number;
  /** How long an exchanged token is reused for one consultant. Well under the CRM token's own life. */
  cacheTtlMs?: number;
  /**
   * Offer the CRM's mutating tools (readOnlyHint false) to the research model. Off until a
   * confirmation step exists in front of writes; the CRM server has its own switch too.
   */
  allowWriteTools?: boolean;
  /** Bound on distinct consultants cached at once. */
  maxCached?: number;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Resolves a CRM toolset for the consultant who is asking.
 *
 * Per-consultant rather than one shared service token, because crm-api scopes every read by
 * the acting user's branch and assignee permissions. A shared token would collapse that to a
 * single identity and quietly show every consultant the same rows — defeating the point of
 * the permission-scoped read tools. The tool *list* is filtered per user too, so a consultant
 * is never even offered a tool they would be refused.
 */
export interface CrmProvider {
  forActor(email: string | null | undefined, signal?: AbortSignal): Promise<CrmToolset | undefined>;
}

interface CacheEntry {
  toolset: CrmToolset;
  expiresAt: number;
}

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_CACHED = 200;

/** Exchange an Edge assertion for that consultant's own CRM token. */
async function exchangeToken(options: CrmProviderOptions, email: string, signal?: AbortSignal): Promise<string> {
  const assertion = await signCrmAssertion({ sub: email, email }, { secret: options.exchangeSecret });
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(`${options.url}/token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        origin: options.tenantOrigin,
        ...(options.tenantId ? { "x-tenant-id": options.tenantId } : {}),
      },
      body: JSON.stringify({ assertion }),
      signal: composed,
    });
  } catch (err) {
    throw new CrmError(`CRM token exchange unreachable: ${(err as Error).message}`);
  }

  if (res.status === 403) {
    // Deliberately indistinguishable on the CRM side between "no such user" and "bad
    // assertion", so this cannot be used to enumerate staff emails.
    throw new CrmError("CRM declined the token exchange: this consultant has no usable CRM account, or the exchange secret is wrong");
  }
  if (res.status === 404) {
    throw new CrmError("CRM token exchange is not enabled (MCP_EDGE_EXCHANGE_SECRET unset on crm-api)");
  }
  if (!res.ok) {
    throw new CrmError(`CRM token exchange returned HTTP ${res.status}`);
  }

  // crm-api wraps every ordinary controller response in { data: ... } via its global
  // ResponseTransformInterceptor. The MCP endpoint itself escapes that (it writes the raw
  // JSON-RPC envelope), but this one does not — so unwrap, tolerating either shape.
  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; data?: { access_token?: string } }
    | null;
  const token = body?.data?.access_token ?? body?.access_token;
  if (!token) {
    throw new CrmError("CRM token exchange returned no access token");
  }
  return token;
}

export function createCrmProvider(options: CrmProviderOptions): CrmProvider {
  const cache = new Map<string, CacheEntry>();
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxCached = options.maxCached ?? DEFAULT_MAX_CACHED;

  return {
    async forActor(email, signal) {
      // No identity means no CRM access. Failing closed matters here: falling back to some
      // default identity would silently show one consultant another's pipeline.
      if (!email || !email.includes("@")) return undefined;
      const key = email.toLowerCase();

      const cached = cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.toolset;
      cache.delete(key);

      try {
        const token = await exchangeToken(options, key, signal);
        const client = new CrmMcpClient({
          url: options.url,
          token,
          tenantOrigin: options.tenantOrigin,
          ...(options.tenantId ? { tenantId: options.tenantId } : {}),
          timeoutMs: options.timeoutMs,
        });
        await client.initialize(signal);
        // The research loop calls whatever it is offered, on its own judgement, with no
        // confirmation step. Until one exists, writes the CRM publishes are not offered at all.
        const offered = (list: CrmToolDescriptor[]) => (options.allowWriteTools ? list : list.filter(isReadOnlyTool));
        let descriptors = offered(await client.listTools(signal));
        if (!descriptors.length) {
          options.log?.("CRM offered this consultant no tools; continuing without CRM access", { actor: key });
          return undefined;
        }

        const toolset: CrmToolset = {
          actor: key,
          get descriptors() {
            return descriptors;
          },
          call: (name, args, s, opts) => client.callTool(name, args, s, opts),
          refresh: async (s) => {
            descriptors = offered(await client.listTools(s));
          },
        };

        // Crude bound rather than a real LRU: entries are cheap and short-lived, and the
        // working set is the number of consultants active at once.
        if (cache.size >= maxCached) {
          const oldest = cache.keys().next();
          if (!oldest.done) cache.delete(oldest.value);
        }
        cache.set(key, { toolset, expiresAt: Date.now() + ttl });
        return toolset;
      } catch (err) {
        // Degrade, never fail the turn: Edge answers everything else without CRM tools.
        options.log?.("CRM unavailable for this consultant; continuing without CRM tools", { actor: key, err: (err as Error).message });
        return undefined;
      }
    },
  };
}
