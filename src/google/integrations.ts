/**
 * The Google Workspace connect flow behind `/v1/integrations/*`: list what a consultant has
 * connected, start a consent, finish it, and disconnect one service or both.
 *
 * Callback checks, in order: the state is known, unexpired, unused and was issued to this same
 * consultant; the code exchanges (with the PKCE verifier); the id_token from that exchange is
 * Google-signed for our client, its email is this consultant and it carries an allowed `hd`
 * (hosted domain) claim, so a consumer Google account registered on a company address cannot
 * connect; at least one requested service had every scope ticked (granular consent). Only then is
 * the refresh token encrypted (bound to this consultant) and stored.
 *
 * Stored scopes are `(already enabled ∪ requested now ∪ identity) ∩ granted by Google`. Google's
 * grant never narrows (a partial disconnect is local) and `include_granted_scopes` echoes every
 * scope ever granted, so taking Google's list as-is would silently re-enable a service the
 * consultant disconnected.
 */
import type { ActivityEventInput } from "../activity/log";
import { AuthError, b64urlDecode } from "../auth/supabase";
import { verifyGoogleIdToken, type GoogleIdentity, type GoogleVerifyOptions } from "../auth/google";
import type { Logger } from "../observability/logger";
import { actorKey, type GoogleConnectionStore } from "./connections";
import type { TokenCipher } from "./crypto";
import { codeChallenge, newCodeVerifier, scopesFor, type CodeExchange, type GoogleOAuth } from "./oauth";
import type { OAuthStateStore } from "./state-store";
import {
  SERVICE_SCOPES,
  WORKSPACE_SERVICES,
  servicesGranted,
  type AccessTokenSource,
  type GoogleConnection,
  type IntegrationView,
  type WorkspaceService,
} from "./types";

export const INTEGRATION_EVENT = { connected: "integration.connected", disconnected: "integration.disconnected" } as const;
export const DEFAULT_RETURN_TO = "/chat";

export type IntegrationFailure = "state_invalid" | "exchange_failed" | "account_mismatch" | "scope_denied" | "no_refresh_token" | "domain_not_allowed";

export class IntegrationError extends Error {
  constructor(
    public readonly code: IntegrationFailure,
    message: string,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

export interface IntegrationsService {
  list(actor: string): Promise<IntegrationView[]>;
  connect(actor: string, services: WorkspaceService[], returnTo?: string | null): Promise<{ url: string }>;
  callback(actor: string, code: string, state: string, signal?: AbortSignal): Promise<{ services: WorkspaceService[]; returnTo: string }>;
  /** The views after the disconnect; see `disconnectDetailed` for whether Google revoked the grant. */
  disconnect(actor: string, service: WorkspaceService): Promise<IntegrationView[]>;
  /** `revoked` is set on a full disconnect only: false means Google's grant may still be live. */
  disconnectDetailed(actor: string, service: WorkspaceService): Promise<DisconnectResult>;
}

export interface DisconnectResult {
  integrations: IntegrationView[];
  revoked?: boolean;
}

export interface IntegrationsDeps {
  oauth: GoogleOAuth;
  states: OAuthStateStore;
  connections: GoogleConnectionStore;
  cipher: TokenCipher;
  tokens: Pick<AccessTokenSource, "invalidate">;
  /** Gates who may CONNECT a Workspace account (GOOGLE_WORKSPACE_ALLOWED_DOMAINS) — independent of Edge sign-in, which has no domain restriction. */
  allowedDomains: string[];
  /** The Workspace OAuth client id (GOOGLE_WORKSPACE_CLIENT_ID): the id_token's audience. */
  clientId: string;
  /** Called after any change to a consultant's grant (pass `workspaceProvider.forget`). */
  onChange?: (actor: string) => void;
  verifyIdToken?: (token: string, opts: GoogleVerifyOptions) => Promise<GoogleIdentity>;
  /** Activity log sink (pass `(e) => activity.event(e)`). */
  recordEvent?: (e: ActivityEventInput) => void;
  logger?: Pick<Logger, "warn" | "info" | "error">;
}

/** Google returns the email scope as either of these; neither enables a service. */
const IDENTITY_SCOPE_NAMES = ["https://www.googleapis.com/auth/userinfo.email"];

const UNSAFE_PATH = /[\u0000-\u001f\u007f\\]/;
const isSafePath = (p: string) => p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") && !UNSAFE_PATH.test(p);

/**
 * The `hd` (hosted domain) claim of an id_token that `verifyIdToken` has already verified, lower
 * cased, or null. Only a Google Workspace account has one; a consumer account does not, even when
 * its email is on a company domain.
 */
function hostedDomainOf(idToken: string): string | null {
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(idToken.split(".")[1] ?? ""))) as { hd?: unknown };
    return typeof payload.hd === "string" && payload.hd ? payload.hd.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * A same-site relative path ("/chat?x=1"), else "/chat". Blocks "//host", "/\\host", backslashes and
 * control characters, both as given and after normalising: "/.//evil.com" and "/%2e//evil.com"
 * normalise to "//evil.com", which a browser treats as another host.
 */
export function sanitizeReturnTo(returnTo: string | null | undefined): string {
  if (typeof returnTo !== "string" || !returnTo || returnTo.length > 512 || !isSafePath(returnTo)) return DEFAULT_RETURN_TO;
  try {
    // Resolving against a dummy origin must keep that origin, or it was not relative.
    const u = new URL(returnTo, "https://edge.invalid");
    if (u.origin !== "https://edge.invalid") return DEFAULT_RETURN_TO;
    const out = u.pathname + u.search + u.hash;
    return isSafePath(out) ? out : DEFAULT_RETURN_TO;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}

export function integrationViews(conn: GoogleConnection | null): IntegrationView[] {
  const granted = conn ? servicesGranted(conn.grantedScopes) : [];
  return WORKSPACE_SERVICES.map((service) => {
    if (!conn || !granted.includes(service)) return { service, status: "not_connected", googleEmail: null, connectedAt: null };
    return {
      service,
      status: conn.status === "reauth_required" ? "reauth_required" : "connected",
      googleEmail: conn.googleEmail,
      connectedAt: conn.connectedAt.toISOString(),
    };
  });
}

export const notConnectedViews = (): IntegrationView[] => integrationViews(null);

export function createIntegrationsService(deps: IntegrationsDeps): IntegrationsService {
  const allowed = deps.allowedDomains.map((d) => d.toLowerCase());
  const verify = deps.verifyIdToken ?? verifyGoogleIdToken;

  const changed = (actor: string) => {
    deps.tokens.invalidate(actor);
    try {
      deps.onChange?.(actor);
    } catch (err) {
      deps.logger?.warn("integration onChange failed", { err });
    }
  };
  const record = (type: string, actor: string, details: Record<string, unknown>) => {
    try {
      deps.recordEvent?.({ type, source: "server", ownerId: actor, details });
    } catch {
      /* the activity log never breaks the flow */
    }
  };
  /** Best effort, for a grant we will not keep. */
  const revokeExchange = (x: CodeExchange) => void deps.oauth.revoke(x.refreshToken ?? x.accessToken);

  async function disconnectDetailed(actor: string, service: WorkspaceService): Promise<DisconnectResult> {
    const key = actorKey(actor);
    const conn = await deps.connections.get(key);
    if (!conn) return { integrations: integrationViews(null) };
    const remaining = servicesGranted(conn.grantedScopes).filter((s) => s !== service);
    if (remaining.length) {
      // Google cannot narrow a grant: the scopes stay granted at Google until a full disconnect,
      // but Edge stops using this service (token-cache intersects with grantedScopes).
      const drop = new Set(SERVICE_SCOPES[service]);
      const result = await deps.connections.setScopes(key, conn.grantedScopes.filter((s) => !drop.has(s)));
      changed(key);
      record(INTEGRATION_EVENT.disconnected, key, { service, remaining, revoked: false });
      return { integrations: integrationViews(result) };
    }
    let revoked = false;
    try {
      revoked = await deps.oauth.revoke(await deps.cipher.decrypt(conn.refreshTokenEnc, key));
    } catch {
      revoked = false;
    }
    // The consultant asked to disconnect: forget the grant here even when Google did not confirm.
    await deps.connections.delete(key);
    if (!revoked) deps.logger?.error("google revoke failed on disconnect; the grant may still be live at Google", { actor: key, service, revoked: false });
    changed(key);
    record(INTEGRATION_EVENT.disconnected, key, { service, remaining, revoked });
    return { integrations: integrationViews(null), revoked };
  }

  return {
    async list(actor) {
      try {
        return integrationViews(await deps.connections.get(actorKey(actor)));
      } catch (err) {
        deps.logger?.warn("google connection lookup failed", { err });
        return WORKSPACE_SERVICES.map((service) => ({ service, status: "error" as const, googleEmail: null, connectedAt: null }));
      }
    },

    async connect(actor, services, returnTo) {
      const key = actorKey(actor);
      const domain = key.split("@")[1] ?? "";
      if (!domain || !allowed.includes(domain)) throw new IntegrationError("domain_not_allowed", "Only Workspace accounts on an allowed domain can connect Google");
      const wanted = WORKSPACE_SERVICES.filter((s) => services.includes(s));
      const codeVerifier = newCodeVerifier();
      const state = await deps.states.create({ actor: key, services: wanted, codeVerifier, returnTo: sanitizeReturnTo(returnTo) });
      return { url: deps.oauth.authUrl({ state, codeChallenge: await codeChallenge(codeVerifier), services: wanted, loginHint: key }) };
    },

    async callback(actor, code, state, signal) {
      const key = actorKey(actor);
      const rec = await deps.states.consume(state);
      if (!rec || rec.actor !== key) throw new IntegrationError("state_invalid", "This Google sign-in link is invalid or expired; start again");

      let x: CodeExchange;
      try {
        x = await deps.oauth.exchangeCode(code, rec.codeVerifier, signal);
      } catch {
        throw new IntegrationError("exchange_failed", "Google did not accept the sign-in; start again");
      }

      let who: GoogleIdentity;
      try {
        who = await verify(x.idToken, { clientId: deps.clientId, allowedDomains: allowed });
      } catch (err) {
        revokeExchange(x);
        if (err instanceof AuthError && err.code === "domain_not_allowed") {
          throw new IntegrationError("account_mismatch", "Connect the Google account of your own Workspace login");
        }
        throw new IntegrationError("exchange_failed", "Google's identity token could not be verified; start again");
      }
      if (who.email !== key) {
        revokeExchange(x);
        throw new IntegrationError("account_mismatch", "Connect the Google account you signed in to Edge with");
      }
      // verifyIdToken checks `hd` only when present and returns the email's domain, not `hd`.
      const hd = hostedDomainOf(x.idToken);
      if (!hd || !allowed.includes(hd) || hd !== key.split("@")[1]) {
        revokeExchange(x);
        throw new IntegrationError("account_mismatch", "Connect your Workspace Google account; a personal Google account on this address cannot be used");
      }

      const existing = await deps.connections.get(key);
      const grantedNow = servicesGranted(x.scope).filter((s) => rec.services.includes(s));
      if (!grantedNow.length) {
        // With a live grant on file, revoking would also kill it (Google revokes the whole grant).
        if (!existing) revokeExchange(x);
        throw new IntegrationError("scope_denied", "Google did not grant the access needed; tick every box on the consent screen");
      }

      // Only what was enabled before (same Google account) or asked for now, and Google granted.
      const enabled = new Set([...(existing && existing.googleSub === who.sub ? existing.grantedScopes : []), ...scopesFor(rec.services), ...IDENTITY_SCOPE_NAMES]);
      const stored = await deps.connections.upsert({
        actor: key,
        googleSub: who.sub,
        googleEmail: who.email,
        grantedScopes: x.scope.filter((s) => enabled.has(s)),
        ...(x.refreshToken ? { refreshTokenEnc: await deps.cipher.encrypt(x.refreshToken, key) } : {}),
      });
      if (!stored) throw new IntegrationError("no_refresh_token", "Google did not return offline access; disconnect Edge in your Google account settings and connect again");

      const services = servicesGranted(stored.grantedScopes);
      changed(key);
      record(INTEGRATION_EVENT.connected, key, { requested: rec.services, services, reconnect: Boolean(existing) });
      return { services, returnTo: rec.returnTo };
    },

    async disconnect(actor, service) {
      return (await disconnectDetailed(actor, service)).integrations;
    },

    disconnectDetailed,
  };
}
