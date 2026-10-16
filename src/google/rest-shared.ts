/**
 * Plumbing shared by the Google REST tool modules (rest.ts for Gmail and Drive, rest-calendar.ts,
 * rest-docs.ts): one authorised request helper and the small schema/argument helpers.
 */
import type { JsonSchema7Type } from "@langchain/core/utils/json_schema";
import { McpError } from "../mcp/client";
import { SERVICE_LABELS, type WorkspaceService } from "./types";

export type Obj = Record<string, unknown>;

export interface RestCallOptions {
  token: string;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** A refused request that a retry cannot fix inside this call (bad id, permission, bad input). Becomes an `isError` result. */
export class RestRefused extends Error {}

export const MAX_PAGE = 25;

export const s = (type: string, description: string): JsonSchema7Type => ({ type, description }) as JsonSchema7Type;
export const list = (description: string): JsonSchema7Type => ({ type: "array", items: { type: "string" }, description }) as JsonSchema7Type;
export const obj = (properties: Record<string, JsonSchema7Type>, required: string[] = []): JsonSchema7Type =>
  ({ type: "object", properties, ...(required.length ? { required } : {}) }) as JsonSchema7Type;

export const pageSize = (v: unknown) => Math.min(Math.max(Number.isInteger(v) ? (v as number) : 10, 1), MAX_PAGE);
export const qs = (params: Record<string, string | number | boolean | undefined | (string | undefined)[]>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => x !== undefined && u.append(k, x));
    else if (v !== undefined && v !== "") u.append(k, String(v));
  }
  return u.toString();
};
export const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
export const strings = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean);

/**
 * One authorised call. 401 throws an auth `McpError` (the provider drops the cached token and
 * retries once); an unreachable API throws `McpError("unreachable")`; any other non-2xx throws
 * `RestRefused` with Google's message.
 */
export async function http(service: WorkspaceService, url: string, o: RestCallOptions, init: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<unknown> {
  const label = SERVICE_LABELS[service];
  const signals = [AbortSignal.timeout(o.timeoutMs), ...(o.signal ? [o.signal] : [])];
  let res: Response;
  try {
    res = await (o.fetchImpl ?? fetch)(url, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${o.token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.any(signals),
    });
  } catch (err) {
    throw new McpError(`${label} API unreachable: ${(err as Error).message}`, "unreachable");
  }
  if (res.status === 401) throw new McpError(`${label} API rejected the access token`, "auth", 401);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new RestRefused(`${label} API HTTP ${res.status}: ${body.error?.message ?? res.statusText}`);
  }
  return init.raw ? res.text() : res.json();
}
