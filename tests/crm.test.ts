import { describe, expect, test } from "bun:test";
import { CrmMcpClient, createCrmProvider } from "../src/crm/client";
import { crmDeepLink } from "../src/crm/deep-link";
import { EvidenceCollector } from "../src/tools/evidence";
import { makeCrmTools } from "../src/tools/crm";
import { buildResearchTools } from "../src/tools";
import { NullKnowledgeStore } from "../src/retrieval/store";
import { fakeToolset } from "./fakes";

const config = {
  url: "https://crm.example.test/v1/mcp",
  token: "test-token",
  tenantOrigin: "https://tenant.example.test",
  timeoutMs: 5_000,
};

/** Scripts the JSON-RPC replies the client should see, and records what it sent. */
function scriptFetch(handlers: Record<string, unknown>) {
  const calls: { method: string; body: any; headers: Record<string, string> }[] = [];
  const fetchImpl = async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ method: body.method, body, headers: init.headers });
    const result = handlers[body.method];
    if (result === undefined) return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } }), { status: 200 });
    if (result instanceof Response) return result;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

function withFetch<T>(fetchImpl: any, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const TOOLS_RESULT = {
  tools: [
    {
      name: "crm_search_contacts",
      title: "Search contacts",
      description: "Find contacts by name, email or phone.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      annotations: READ_ONLY,
    },
  ],
};
/** A tool list as the CRM publishes it once its write tools are switched on. */
const TOOLS_WITH_WRITES = {
  tools: [
    ...TOOLS_RESULT.tools,
    { name: "crm_update_contact", description: "Change a contact's details.", inputSchema: { type: "object", properties: {} }, annotations: WRITE },
    // No annotations at all: treated as a write, never offered by default.
    { name: "crm_mystery", description: "Unannotated.", inputSchema: { type: "object", properties: {} } },
  ],
};

describe("CrmMcpClient", () => {
  test("sends the headers crm-api's guards require", async () => {
    const { calls, fetchImpl } = scriptFetch({ initialize: { protocolVersion: "2025-06-18" } });
    await withFetch(fetchImpl, async () => new CrmMcpClient({ ...config, tenantId: "tenant_abc" }).initialize());

    const headers = calls[0]!.headers;
    expect(headers.authorization).toBe("Bearer test-token");
    // Origin is not optional: VerifyAccount parses it unguarded and 500s without it.
    expect(headers.origin).toBe("https://tenant.example.test");
    expect(headers["x-tenant-id"]).toBe("tenant_abc");
    expect(headers["mcp-protocol-version"]).toBe("2025-06-18");
  });

  test("omits x-tenant-id when unset so crm-api resolves the tenant from Origin", async () => {
    const { calls, fetchImpl } = scriptFetch({ initialize: {} });
    await withFetch(fetchImpl, async () => new CrmMcpClient(config).initialize());
    expect(calls[0]!.headers["x-tenant-id"]).toBeUndefined();
  });

  test("reads the text block and structuredContent out of a tool result", async () => {
    const { fetchImpl } = scriptFetch({
      "tools/call": { content: [{ type: "text", text: "1 contact matching \"jane\"" }], structuredContent: { contacts: [{ id: "c1" }] } },
    });
    const result = await withFetch(fetchImpl, () => new CrmMcpClient(config).callTool("crm_search_contacts", { query: "jane" }));

    expect(result).toMatchObject({ text: '1 contact matching "jane"', isError: false });
    expect(result.structured).toEqual({ contacts: [{ id: "c1" }] });
  });

  // The write-approval protocol rides in MCP's params._meta: a dry run, or the previewed version.
  test("sends params._meta when the caller passes meta", async () => {
    const { calls, fetchImpl } = scriptFetch({ "tools/call": { content: [{ type: "text", text: "preview" }] } });
    await withFetch(fetchImpl, () => new CrmMcpClient(config).callTool("crm_update_contact", { id: "c1" }, undefined, { meta: { "heubert/dryRun": true } }));
    expect(calls[0]!.body.params).toEqual({ name: "crm_update_contact", arguments: { id: "c1" }, _meta: { "heubert/dryRun": true } });
  });

  test("sends no _meta key without opts", async () => {
    const { calls, fetchImpl } = scriptFetch({ "tools/call": { content: [{ type: "text", text: "ok" }] } });
    await withFetch(fetchImpl, () => new CrmMcpClient(config).callTool("crm_search_contacts", { query: "jane" }));
    expect("_meta" in calls[0]!.body.params).toBe(false);
  });

  test("returns a preview's structuredContent as structured", async () => {
    const preview = { tool: "crm_update_contact", target: { entity: "contact", id: "c1", label: "Jane" }, changes: [], version: "2026-09-01T00:00:00.000Z" };
    const { fetchImpl } = scriptFetch({ "tools/call": { content: [{ type: "text", text: "preview" }], structuredContent: { preview } } });
    const result = await withFetch(fetchImpl, () => new CrmMcpClient(config).callTool("crm_update_contact", { id: "c1" }, undefined, { meta: { "heubert/dryRun": true } }));
    expect(result.structured).toEqual({ preview });
  });

  test("flags a tool-level error without throwing", async () => {
    const { fetchImpl } = scriptFetch({ "tools/call": { content: [{ type: "text", text: "crm_get_deal failed: not visible" }], isError: true } });
    const result = await withFetch(fetchImpl, () => new CrmMcpClient(config).callTool("crm_get_deal", { id: "d1" }));
    expect(result.isError).toBe(true);
  });

  // A bad token cannot be fixed by retrying, so it must be distinguishable from a 500.
  test("reports an auth failure distinctly", async () => {
    const fetchImpl = async () => new Response("{}", { status: 401 });
    await withFetch(fetchImpl, async () => {
      expect(new CrmMcpClient(config).callTool("crm_get_me", {})).rejects.toThrow(/credentials/i);
    });
  });

  test("surfaces a JSON-RPC error as a thrown CrmError", async () => {
    const { fetchImpl } = scriptFetch({});
    await withFetch(fetchImpl, async () => {
      expect(new CrmMcpClient(config).callTool("crm_nope", {})).rejects.toThrow(/-32601/);
    });
  });
});

const providerOptions = {
  url: "https://crm.example.test/v1/mcp",
  exchangeSecret: "an-exchange-secret-at-least-32-chars-long",
  tenantOrigin: "https://tenant.example.test",
  timeoutMs: 5_000,
};

/** Handles the token exchange plus the MCP methods, recording what was sent. */
function scriptProvider(handlers: Record<string, unknown>, tokenResponse?: Response) {
  const exchanges: { assertion: string; headers: Record<string, string> }[] = [];
  const rpc = scriptFetch(handlers);
  const fetchImpl = async (url: string, init: any) => {
    if (String(url).endsWith("/token")) {
      exchanges.push({ assertion: JSON.parse(init.body).assertion, headers: init.headers });
      return tokenResponse ?? new Response(JSON.stringify({ access_token: "user-token" }), { status: 200 });
    }
    return rpc.fetchImpl(url, init);
  };
  return { exchanges, calls: rpc.calls, fetchImpl };
}

describe("createCrmProvider", () => {
  test("offers only read-only tools to the research loop unless writes are explicitly allowed", async () => {
    const closed = scriptProvider({ initialize: {}, "tools/list": TOOLS_WITH_WRITES });
    const readOnly = await withFetch(closed.fetchImpl, () => createCrmProvider(providerOptions).forActor("jane@heubert.com"));
    expect(readOnly?.descriptors.map((d) => d.name)).toEqual(["crm_search_contacts"]);

    const open = scriptProvider({ initialize: {}, "tools/list": TOOLS_WITH_WRITES });
    const all = await withFetch(open.fetchImpl, () => createCrmProvider({ ...providerOptions, allowWriteTools: true }).forActor("jane@heubert.com"));
    expect(all?.descriptors.map((d) => d.name)).toEqual(["crm_search_contacts", "crm_update_contact", "crm_mystery"]);
    expect(all?.descriptors[1]?.annotations).toEqual(WRITE);
  });

  test("names the acting consultant on the toolset, lower-cased", async () => {
    const { fetchImpl } = scriptProvider({ initialize: {}, "tools/list": TOOLS_RESULT });
    const toolset = await withFetch(fetchImpl, () => createCrmProvider(providerOptions).forActor("Jane@Heubert.com"));
    expect(toolset?.actor).toBe("jane@heubert.com");
  });

  test("passes meta through the toolset's call", async () => {
    const { calls, fetchImpl } = scriptProvider({ initialize: {}, "tools/list": TOOLS_RESULT, "tools/call": { content: [{ type: "text", text: "ok" }] } });
    await withFetch(fetchImpl, async () => {
      const toolset = await createCrmProvider(providerOptions).forActor("jane@heubert.com");
      await toolset!.call("crm_search_contacts", { query: "jane" }, undefined, { meta: { "heubert/expectedVersion": "v1" } });
    });
    expect(calls.find((c) => c.method === "tools/call")!.body.params._meta).toEqual({ "heubert/expectedVersion": "v1" });
  });

  test("exchanges an assertion for the acting consultant's own token", async () => {
    const { exchanges, calls, fetchImpl } = scriptProvider({ initialize: {}, "tools/list": TOOLS_RESULT });

    const toolset = await withFetch(fetchImpl, () => createCrmProvider(providerOptions).forActor("jane@heubert.com"));

    expect(toolset?.descriptors.map((d) => d.name)).toEqual(["crm_search_contacts"]);
    // The assertion names the consultant, and the CRM's reply is what authenticates MCP calls.
    const claims = JSON.parse(Buffer.from(exchanges[0]!.assertion.split(".")[1]!, "base64url").toString());
    expect(claims).toMatchObject({ iss: "edge", aud: "crm-api", email: "jane@heubert.com" });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(120);
    expect(calls[0]!.headers.authorization).toBe("Bearer user-token");
  });

  // Failing closed matters most here: a fallback identity would show one consultant another's pipeline.
  test("gives no CRM access to an anonymous or non-email actor", async () => {
    const { fetchImpl, exchanges } = scriptProvider({});
    const provider = createCrmProvider(providerOptions);

    await withFetch(fetchImpl, async () => {
      expect(await provider.forActor(null)).toBeUndefined();
      expect(await provider.forActor("anonymous")).toBeUndefined();
    });
    expect(exchanges).toHaveLength(0);
  });

  test("reuses one consultant's token but exchanges separately per consultant", async () => {
    const { exchanges, fetchImpl } = scriptProvider({ initialize: {}, "tools/list": TOOLS_RESULT });
    const provider = createCrmProvider(providerOptions);

    await withFetch(fetchImpl, async () => {
      await provider.forActor("jane@heubert.com");
      await provider.forActor("jane@heubert.com");
      await provider.forActor("sam@heubert.com");
    });

    expect(exchanges.map((e) => JSON.parse(Buffer.from(e.assertion.split(".")[1]!, "base64url").toString()).email))
      .toEqual(["jane@heubert.com", "sam@heubert.com"]);
  });

  // Regression: crm-api wraps ordinary controller responses in { data: ... } via its global
  // ResponseTransformInterceptor. Reading the unwrapped shape made every exchange fail, and
  // only a live cross-repo run caught it — the shape is invisible from this repo.
  test("unwraps the CRM's { data } response envelope", async () => {
    const { fetchImpl } = scriptProvider(
      { initialize: {}, "tools/list": TOOLS_RESULT },
      new Response(JSON.stringify({ data: { access_token: "wrapped-token" } }), { status: 200 }),
    );
    const toolset = await withFetch(fetchImpl, () => createCrmProvider(providerOptions).forActor("jane@heubert.com"));
    expect(toolset).toBeDefined();
  });

  test("still accepts an unwrapped token response", async () => {
    const { fetchImpl } = scriptProvider(
      { initialize: {}, "tools/list": TOOLS_RESULT },
      new Response(JSON.stringify({ access_token: "bare-token" }), { status: 200 }),
    );
    expect(await withFetch(fetchImpl, () => createCrmProvider(providerOptions).forActor("jane@heubert.com"))).toBeDefined();
  });

  test("degrades to no CRM tools when the CRM declines the exchange", async () => {
    const logged: string[] = [];
    const { fetchImpl } = scriptProvider({}, new Response("{}", { status: 403 }));

    const toolset = await withFetch(fetchImpl, () =>
      createCrmProvider({ ...providerOptions, log: (m) => logged.push(m) }).forActor("nobody@heubert.com"),
    );

    expect(toolset).toBeUndefined();
    expect(logged.join(" ")).toContain("without CRM tools");
  });

  test("degrades when the exchange endpoint is not enabled on crm-api", async () => {
    const { fetchImpl } = scriptProvider({}, new Response("{}", { status: 404 }));
    expect(await withFetch(fetchImpl, () => createCrmProvider(providerOptions).forActor("jane@heubert.com"))).toBeUndefined();
  });

  test("degrades when the CRM offers this consultant no tools", async () => {
    const { fetchImpl } = scriptProvider({ initialize: {}, "tools/list": { tools: [] } });
    expect(await withFetch(fetchImpl, () => createCrmProvider(providerOptions).forActor("jane@heubert.com"))).toBeUndefined();
  });
});

describe("makeCrmTools", () => {
  test("names and describes tools from the server, not from this repo", () => {
    const tools = makeCrmTools(fakeToolset({ text: "x", isError: false }), { collector: new EvidenceCollector() });
    expect(tools.map((t) => t.name)).toEqual(["crm_search_contacts"]);
    expect(tools[0]!.description).toBe("Find contacts by name, email or phone.");
  });

  // The whole point of the wrapper: `generate` reads state.evidence, so a CRM result that
  // never reaches the collector never reaches the answer.
  test("registers the result as citable evidence", async () => {
    const collector = new EvidenceCollector();
    const tools = makeCrmTools(fakeToolset({ text: "1 contact matching \"jane\"", isError: false }), { collector });

    const out = await tools[0]!.invoke({ query: "jane" });

    expect(collector.items).toHaveLength(1);
    expect(collector.items[0]).toMatchObject({ kind: "crm", source: "crm", live: true, n: 1, content: '1 contact matching "jane"' });
    expect(String(out)).toContain("[1]");
  });

  // `url` stays the crm:// dedupe key; `webUrl` is the part a consultant can click.
  test("carries a navigable CRM link when CRM_WEB_URL is set, and none when it is not", async () => {
    const linked = new EvidenceCollector();
    await makeCrmTools(fakeToolset({ text: "1 contact", isError: false }), { collector: linked, crmWebUrl: "https://crm.example.test" })[0]!.invoke({ query: "jane" });
    expect(linked.items[0]).toMatchObject({ webUrl: "https://crm.example.test/contacts/all-contacts" });
    expect(linked.items[0]!.url).toStartWith("crm://");

    const plain = new EvidenceCollector();
    await makeCrmTools(fakeToolset({ text: "1 contact", isError: false }), { collector: plain })[0]!.invoke({ query: "jane" });
    expect(plain.items[0]!.webUrl).toBeNull();
  });

  test("dedupes an identical repeat call", async () => {
    const collector = new EvidenceCollector();
    const tools = makeCrmTools(fakeToolset({ text: "same", isError: false }), { collector });

    await tools[0]!.invoke({ query: "jane" });
    const second = await tools[0]!.invoke({ query: "jane" });

    expect(collector.items).toHaveLength(1);
    expect(String(second)).toContain("No new evidence");
  });

  // The research loop matches /^error\b/i to mark a call failed; throwing would be caught
  // too, but the message is far less useful to the model.
  test("reports a transport failure as soft error text", async () => {
    const collector = new EvidenceCollector();
    const tools = makeCrmTools(fakeToolset(new Error("CRM unreachable: timeout")), { collector });

    const out = String(await tools[0]!.invoke({ query: "jane" }));

    expect(out).toStartWith("error:");
    expect(out).toContain("unreachable");
    expect(collector.items).toHaveLength(0);
  });

  test("reports a tool-level refusal as soft error text and adds no evidence", async () => {
    const collector = new EvidenceCollector();
    const tools = makeCrmTools(fakeToolset({ text: "you do not have permission", isError: true }), { collector });

    expect(String(await tools[0]!.invoke({ query: "jane" }))).toStartWith("error:");
    expect(collector.items).toHaveLength(0);
  });
});

describe("buildResearchTools", () => {
  const ctx = () => ({ collector: new EvidenceCollector(), explicitUrls: new Set<string>(), topK: 5 });

  test("offers no CRM tools when the toolset is absent", () => {
    const names = buildResearchTools({ knowledge: new NullKnowledgeStore() }, ctx()).map((t) => t.name);
    expect(names).toEqual(["search_knowledge_base"]);
  });

  test("appends the CRM tools when it is present", () => {
    const names = buildResearchTools({ knowledge: new NullKnowledgeStore(), crm: fakeToolset({ text: "x", isError: false }) }, ctx()).map((t) => t.name);
    expect(names).toEqual(["search_knowledge_base", "crm_search_contacts"]);
  });
});

describe("crmDeepLink", () => {
  const web = "https://crm.example.test";
  const link = (tool: string, args: Record<string, unknown> = {}) => crmDeepLink(web, tool, args);

  test("deep-links a record the arguments identify", () => {
    expect(link("crm_get_contact", { id: "c1" })).toBe("https://crm.example.test/contact/detail/c1/detail");
    expect(link("crm_get_student_overview", { id: "c1" })).toBe("https://crm.example.test/contact/detail/c1/detail");
    expect(link("crm_list_notes", { source: "contact", recordId: "c1" })).toBe("https://crm.example.test/contact/detail/c1/detail");
  });

  test("links list tools to the list page their filters name", () => {
    expect(link("crm_list_my_tasks")).toBe("https://crm.example.test/tasks/all");
    expect(link("crm_list_deals", { status: "proposal" })).toBe("https://crm.example.test/deals/proposal");
    expect(link("crm_list_my_contacts")).toBe("https://crm.example.test/contacts/my-contacts");
    expect(link("crm_search_contacts", { query: "jane" })).toBe("https://crm.example.test/contacts/all-contacts");
    expect(link("crm_list_enquiries")).toBe("https://crm.example.test/enquiries/all");
    expect(link("crm_search_enquiries", { query: "jane" })).toBe("https://crm.example.test/enquiries/all");
  });

  // The deal page is nested under its contact, so a deal id alone cannot build it. A list
  // page the consultant can search is better than a URL that 404s.
  test("falls back to the deals list when only the deal id is known", () => {
    expect(link("crm_get_deal", { id: "d1" })).toBe("https://crm.example.test/deals/discovery");
    expect(link("crm_get_deal", { id: "d1", contactId: "c1" })).toBe("https://crm.example.test/contact/c1/deals/d1");
  });

  // The CRM has no per-enquiry route; enquiries open from the list.
  test("sends a single enquiry to the enquiries list", () => {
    expect(link("crm_get_enquiry", { id: "e1" })).toBe("https://crm.example.test/enquiries/all");
  });

  test("has no link for tools that are not about a record", () => {
    expect(link("crm_get_me")).toBeNull();
    expect(link("crm_list_interested_services")).toBeNull();
    expect(link("crm_something_added_later", { id: "x" })).toBeNull();
  });

  test("is off unless CRM_WEB_URL is configured, and never throws on a bad one", () => {
    expect(crmDeepLink(undefined, "crm_list_my_tasks", {})).toBeNull();
    expect(crmDeepLink("not a url", "crm_list_my_tasks", {})).toBeNull();
  });

  test("keeps an id out of the path structure", () => {
    expect(link("crm_get_contact", { id: "../../admin" })).toBe("https://crm.example.test/contact/detail/..%2F..%2Fadmin/detail");
  });
});
