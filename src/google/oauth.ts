/**
 * Google OAuth 2.0 authorization-code flow with PKCE (RFC 7636), over plain `fetch`
 * (no googleapis dependency). This backend owns the flow: the frontend only relays the
 * consent URL and the `code`/`state` Google redirects back with.
 *
 * Token values (access, refresh, id tokens, the code, the verifier) are never logged or put
 * into error messages.
 */
import { b64urlEncode } from "../auth/supabase";
import { IDENTITY_SCOPES, SERVICE_SCOPES, WORKSPACE_SERVICES, type WorkspaceService } from "./types";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const TIMEOUT_MS = 10_000;

export class OAuthError extends Error {
  constructor(
    /** `invalid_grant`: the code or refresh token is dead (revoked, expired, reused); the rest are transient or config faults. */
    public readonly code: "invalid_grant" | "http_error" | "network" | "bad_response",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

export interface CodeExchange {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope: string[];
  idToken: string;
}

export interface RefreshResult {
  accessToken: string;
  expiresIn: number;
  /** Scopes of the minted token; empty when Google did not say. */
  scope: string[];
}

export interface AuthUrlInput {
  state: string;
  codeChallenge: string;
  services: readonly WorkspaceService[];
  /** The consultant's email: pre-selects the account and pins the Workspace domain. */
  loginHint: string;
}

export interface GoogleOAuth {
  authUrl(input: AuthUrlInput): string;
  exchangeCode(code: string, codeVerifier: string, signal?: AbortSignal): Promise<CodeExchange>;
  refresh(refreshToken: string, signal?: AbortSignal): Promise<RefreshResult>;
  /** Best effort: true when Google confirmed, false on any failure. Never throws. */
  revoke(token: string): Promise<boolean>;
}

export interface GoogleOAuthOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** A 256-bit random PKCE verifier (43 base64url chars, within RFC 7636's 43-128). */
export function newCodeVerifier(): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

/** S256 challenge: base64url(sha256(ascii(verifier))). */
export async function codeChallenge(verifier: string): Promise<string> {
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** Identity scopes plus every scope of the requested services, deduplicated, in a stable order. */
export function scopesFor(services: readonly WorkspaceService[]): string[] {
  const wanted = WORKSPACE_SERVICES.filter((s) => services.includes(s));
  return [...new Set([...IDENTITY_SCOPES, ...wanted.flatMap((s) => SERVICE_SCOPES[s])])];
}

const splitScope = (scope: unknown): string[] => (typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : []);

export function createGoogleOAuth(opts: GoogleOAuthOptions): GoogleOAuth {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const signalOf = (signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS));

  async function tokenRequest(form: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams(form).toString(),
        signal: signalOf(signal),
      });
    } catch (err) {
      const name = (err as Error)?.name;
      throw new OAuthError("network", name === "TimeoutError" || name === "AbortError" ? "Google token endpoint timed out" : "Google token endpoint unreachable");
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) {
      // Only Google's error code goes into the message: the description can echo request details.
      const code = typeof body.error === "string" ? body.error.slice(0, 64) : "";
      if (code === "invalid_grant") throw new OAuthError("invalid_grant", "Google refused the grant (invalid_grant)", res.status);
      throw new OAuthError("http_error", `Google token endpoint HTTP ${res.status}${code ? ` (${code})` : ""}`, res.status);
    }
    if (typeof body.access_token !== "string" || !body.access_token) throw new OAuthError("bad_response", "Google token response has no access_token");
    return body;
  }

  const expiresInOf = (body: Record<string, unknown>) => {
    const n = Number(body.expires_in);
    return Number.isFinite(n) && n > 0 ? n : 3600;
  };

  return {
    authUrl({ state, codeChallenge, services, loginHint }) {
      const hint = loginHint.trim().toLowerCase();
      const params = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        response_type: "code",
        scope: scopesFor(services).join(" "),
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        login_hint: hint,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      const domain = hint.split("@")[1];
      if (domain) params.set("hd", domain);
      return `${GOOGLE_AUTH_URL}?${params.toString()}`;
    },

    async exchangeCode(code, codeVerifier, signal) {
      const body = await tokenRequest(
        {
          grant_type: "authorization_code",
          code,
          code_verifier: codeVerifier,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: opts.redirectUri,
        },
        signal,
      );
      if (typeof body.id_token !== "string" || !body.id_token) throw new OAuthError("bad_response", "Google token response has no id_token");
      return {
        accessToken: body.access_token as string,
        ...(typeof body.refresh_token === "string" && body.refresh_token ? { refreshToken: body.refresh_token } : {}),
        expiresIn: expiresInOf(body),
        scope: splitScope(body.scope),
        idToken: body.id_token,
      };
    },

    async refresh(refreshToken, signal) {
      const body = await tokenRequest(
        { grant_type: "refresh_token", refresh_token: refreshToken, client_id: opts.clientId, client_secret: opts.clientSecret },
        signal,
      );
      return { accessToken: body.access_token as string, expiresIn: expiresInOf(body), scope: splitScope(body.scope) };
    },

    async revoke(token) {
      try {
        const res = await fetchImpl(GOOGLE_REVOKE_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }).toString(),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
