/**
 * Shared contracts for the Google Workspace (Gmail + Drive) integration.
 *
 * Each consultant connects their own Google account once (OAuth code flow + PKCE, owned by this
 * backend). Their refresh token is stored encrypted; every Gmail/Drive MCP call carries a
 * short-lived access token minted from it, so Google applies that consultant's own permissions.
 */

/** "docs" is Docs & Sheets: creating new files only (reading existing ones is Drive's job). */
export type WorkspaceService = "gmail" | "drive" | "calendar" | "docs";
export const WORKSPACE_SERVICES: readonly WorkspaceService[] = ["gmail", "drive", "calendar", "docs"];

/** OAuth scopes each service needs. `openid email` is always added so the callback can verify who connected. */
export const SERVICE_SCOPES: Record<WorkspaceService, readonly string[]> = {
  gmail: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"],
  drive: ["https://www.googleapis.com/auth/drive.readonly"],
  // The three read scopes are what Google's Calendar MCP server checks; `calendar.events` adds creating events.
  calendar: [
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events.freebusy",
    "https://www.googleapis.com/auth/calendar.events.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  // Only files Edge itself creates: no access to the consultant's existing Docs and Sheets.
  docs: ["https://www.googleapis.com/auth/drive.file"],
};

export const SERVICE_LABELS: Record<WorkspaceService, string> = { gmail: "Gmail", drive: "Drive", calendar: "Google Calendar", docs: "Docs & Sheets" };
export const IDENTITY_SCOPES = ["openid", "email"] as const;

/**
 * Per-service state as the chat and the account menu see it.
 * - connected: a usable grant exists
 * - not_connected: never connected, or disconnected
 * - reauth_required: Google refused the refresh token (revoked, password reset, admin action)
 * - error: Google or our store failed this time; try again later
 */
export type ServiceStatus = "connected" | "not_connected" | "reauth_required" | "error";

/** One stored grant per consultant (`_id` = lower-cased actor email). The refresh token is never stored in the clear. */
export interface GoogleConnection {
  actor: string;
  googleSub: string;
  googleEmail: string;
  /** Scopes Google actually granted; granular consent can leave some unticked. */
  grantedScopes: string[];
  refreshTokenEnc: EncryptedBlob;
  status: "connected" | "reauth_required";
  connectedAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
}

/** AES-256-GCM ciphertext. `kid` names the key so it can be rotated. All fields base64url. */
export interface EncryptedBlob {
  v: 1;
  kid: string;
  iv: string;
  ct: string;
}

/** A service is usable when every one of its scopes was granted. */
export const servicesGranted = (scopes: readonly string[]): WorkspaceService[] =>
  WORKSPACE_SERVICES.filter((s) => SERVICE_SCOPES[s].every((scope) => scopes.includes(scope)));

/** What the MCP layer needs from the OAuth layer: a fresh access token for one consultant, or why there is none. */
export type AccessTokenResult =
  | { ok: true; token: string; services: WorkspaceService[] }
  | { ok: false; status: Exclude<ServiceStatus, "connected">; reason?: string };

export interface AccessTokenSource {
  /** Never throws. Cached until shortly before expiry; concurrent callers share one refresh. */
  accessToken(actor: string, signal?: AbortSignal): Promise<AccessTokenResult>;
  /** Drop the cached access token (after a 401 from Google, or a disconnect). */
  invalidate(actor: string): void;
}

/** One entry per service, for `GET /v1/integrations`. */
export interface IntegrationView {
  service: WorkspaceService;
  status: ServiceStatus;
  googleEmail: string | null;
  connectedAt: string | null;
}

/**
 * A consultant's Gmail and Drive MCP toolsets for one turn. A missing toolset means the service is not
 * usable for them right now; `status` says why, so the answer can point them to "Connect Gmail".
 * Toolset descriptor names are already prefixed (`gmail_search_threads`, `drive_search_files`) and
 * already filtered to the code allowlist; `call` takes the prefixed name.
 */
export type WorkspaceToolsets = { [S in WorkspaceService]?: import("../mcp/types").McpToolset } & { status: Record<WorkspaceService, ServiceStatus> };

/** Every service in one status, for the paths that know nothing about the consultant yet. */
export const allStatus = (status: ServiceStatus): Record<WorkspaceService, ServiceStatus> =>
  Object.fromEntries(WORKSPACE_SERVICES.map((s) => [s, status])) as Record<WorkspaceService, ServiceStatus>;

export interface WorkspaceProvider {
  /** Never throws: an unknown actor, no connection, or Google being down yields toolsets with only `status`. */
  forActor(email: string | null | undefined, signal?: AbortSignal): Promise<WorkspaceToolsets>;
  /** Forget cached tool lists and tokens for this consultant (after connect/disconnect). */
  forget(email: string): void;
}
