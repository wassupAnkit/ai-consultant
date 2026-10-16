/**
 * Transport-neutral MCP shapes shared by every MCP server Edge talks to (crm-api, Google's
 * Gmail and Drive servers). `src/crm/client.ts` re-exports these under its Crm* names.
 */
import type { JsonSchema7Type } from "@langchain/core/utils/json_schema";

export interface McpToolDescriptor {
  name: string;
  title?: string;
  description: string;
  /** Passed to LangChain's `tool()` unchanged — it accepts JSON Schema as well as zod. */
  inputSchema: JsonSchema7Type;
  /**
   * MCP tool annotations as the server published them. Absent annotations are treated as a write,
   * so an unknown tool can never slip into the autonomous research loop as if it were harmless.
   */
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

/** A tool the research model may call without a human confirming it first. */
export const isReadOnlyTool = (descriptor: Pick<McpToolDescriptor, "annotations">): boolean => descriptor.annotations?.readOnlyHint === true;

export interface McpToolResult {
  /** The tool's human-readable text blocks, joined; this is what becomes evidence. */
  text: string;
  /** The tool's machine-readable payload (`structuredContent`), when it published one. */
  structured?: Record<string, unknown> | undefined;
  /** True when the server reported a tool-level failure (permission denied, bad input, ...). */
  isError: boolean;
}

export interface McpCallOptions {
  /** Sent as MCP `params._meta`, untouched. */
  meta?: Record<string, unknown>;
}

/** What the research loop is handed: one consultant's tools on one MCP server. */
export interface McpToolset {
  /** The consultant this toolset acts as, lower-cased. */
  readonly actor: string;
  readonly descriptors: readonly McpToolDescriptor[];
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal, opts?: McpCallOptions): Promise<McpToolResult>;
  /** Re-read tools/list. */
  refresh(signal?: AbortSignal): Promise<void>;
}
