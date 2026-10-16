/**
 * Short-lived Google access tokens for the Gmail and Drive MCP calls, minted from each
 * consultant's stored refresh token.
 *
 * - The stored connection is re-read at most every 30 s (`CONNECTION_TTL_MS`), independently of the
 *   access token. Which services are usable, and whether there is a grant at all, always comes from
 *   that read, so a disconnect or `reauth_required` written by another replica takes effect here
 *   within 30 s even though the access token itself is cached for up to an hour.
 * - Access tokens are cached in memory per consultant until 60 s before Google's `expires_in`, and
 *   only reused while the stored grant is the one they were minted from.
 * - Concurrent callers for the same consultant share one refresh (single flight).
 * - `invalid_grant` (revoked, password reset, admin action) marks the stored grant
 *   `reauth_required`, but only if the row still holds the refresh token that failed: a refresh
 *   that started before a reconnect cannot kill the new grant. The turn carries on without Google
 *   tools and the menu says "Reconnect".
 * - A service counts only when its scopes are in both the stored grant and the minted token, so a
 *   service disconnected here (Google cannot narrow a grant) stays off even though the token still
 *   carries it.
 * - Never throws.
 */
import type { Logger } from "../observability/logger";
import type { GoogleConnectionStore } from "./connections";
import { actorKey } from "./connections";
import type { TokenCipher } from "./crypto";
import { OAuthError, type GoogleOAuth } from "./oauth";
import { servicesGranted, type AccessTokenResult, type AccessTokenSource, type GoogleConnection, type WorkspaceService } from "./types";

const EXPIRY_MARGIN_MS = 60_000;
const TOUCH_EVERY_MS = 10 * 60_000;
/** How stale the stored connection (granted scopes, status, existence) may be on this replica. */
export const CONNECTION_TTL_MS = 30_000;

export interface GoogleTokenSourceDeps {
  connections: GoogleConnectionStore;
  oauth: Pick<GoogleOAuth, "refresh">;
  cipher: Pick<TokenCipher, "decrypt">;
  now?: () => number;
  log?: Pick<Logger, "warn" | "info">;
}

/** `grant` is the `refreshTokenEnc.ct` the token was minted from; `scopes` are the token's own (empty: Google did not say). */
type CachedToken = { token: string; scopes: string[]; grant: string; expiresAt: number };
type CachedConnection = { conn: GoogleConnection | null; until: number };

const REAUTH: AccessTokenResult = { ok: false, status: "reauth_required", reason: "Google access was revoked or expired; reconnect" };

/** Services in both the stored grant and the minted token. */
const usable = (conn: GoogleConnection, tokenScopes: string[]): WorkspaceService[] =>
  servicesGranted(tokenScopes.length ? conn.grantedScopes.filter((s) => tokenScopes.includes(s)) : conn.grantedScopes);

export function createGoogleTokenSource(deps: GoogleTokenSourceDeps): AccessTokenSource {
  const now = deps.now ?? Date.now;
  const tokens = new Map<string, CachedToken>();
  const conns = new Map<string, CachedConnection>();
  const inflight = new Map<string, Promise<AccessTokenResult>>();
  /** Bumped by `invalidate`, so a read or refresh that finishes after a disconnect is not cached. */
  const generation = new Map<string, number>();
  const lastTouch = new Map<string, number>();
  const genOf = (key: string) => generation.get(key) ?? 0;

  function touch(key: string) {
    const t = now();
    if (t - (lastTouch.get(key) ?? 0) < TOUCH_EVERY_MS) return;
    lastTouch.set(key, t);
    deps.connections.touch(key, new Date(t)).catch((err) => deps.log?.warn("google connection touch failed", { err }));
  }

  async function connection(key: string, gen: number): Promise<GoogleConnection | null> {
    const hit = conns.get(key);
    if (hit && hit.until > now()) return hit.conn;
    const conn = await deps.connections.get(key);
    if (genOf(key) === gen) conns.set(key, { conn, until: now() + CONNECTION_TTL_MS });
    return conn;
  }

  async function mint(key: string, conn: GoogleConnection, gen: number): Promise<AccessTokenResult> {
    let refreshToken: string;
    try {
      refreshToken = await deps.cipher.decrypt(conn.refreshTokenEnc, key);
    } catch (err) {
      const code = (err as { code?: string }).code ?? null;
      deps.log?.warn("google refresh token could not be decrypted", { code });
      // A key id this deployment does not know is a rotation misconfiguration: fix the config
      // (GOOGLE_TOKEN_ENC_PREVIOUS_KEYS), do not make every consultant reconnect.
      if (code === "unknown_kid") return { ok: false, status: "error", reason: "stored credential unreadable" };
      // Anything else (sealed under another environment's key, tampered) can never be read again:
      // ask for a reconnect, persisted so the account menu shows Reconnect rather than Connected.
      await deps.connections.markReauth(key, conn.refreshTokenEnc.ct).catch((e) => deps.log?.warn("google markReauth failed", { err: e }));
      return REAUTH;
    }

    let minted;
    try {
      minted = await deps.oauth.refresh(refreshToken);
    } catch (err) {
      if (err instanceof OAuthError && err.code === "invalid_grant") {
        const marked = await deps.connections.markReauth(key, conn.refreshTokenEnc.ct).catch((e) => {
          deps.log?.warn("google markReauth failed", { err: e });
          return null;
        });
        tokens.delete(key);
        conns.delete(key);
        if (marked === false) {
          // The row no longer holds the token that failed: the consultant reconnected meanwhile.
          deps.log?.info("google grant refused, but it was replaced meanwhile; not marking reauth", {});
          return { ok: false, status: "error", reason: "grant changed during refresh; retry" };
        }
        deps.log?.info("google grant refused; reauth required", {});
        return REAUTH;
      }
      const code = err instanceof OAuthError ? err.code : "unknown";
      deps.log?.warn("google token refresh failed", { code, status: err instanceof OAuthError ? (err.status ?? null) : null });
      return { ok: false, status: "error", reason: `token refresh failed (${code})` };
    }

    if (genOf(key) === gen) {
      tokens.set(key, {
        token: minted.accessToken,
        scopes: minted.scope,
        grant: conn.refreshTokenEnc.ct,
        expiresAt: now() + Math.max(0, minted.expiresIn * 1000 - EXPIRY_MARGIN_MS),
      });
    }
    touch(key);
    return { ok: true, token: minted.accessToken, services: usable(conn, minted.scope) };
  }

  return {
    async accessToken(actor, signal) {
      try {
        const key = actorKey(actor ?? "");
        if (!key.includes("@")) return { ok: false, status: "not_connected" };
        const gen = genOf(key);
        const conn = await connection(key, gen);
        if (!conn || conn.status === "reauth_required") {
          tokens.delete(key);
          return conn ? REAUTH : { ok: false, status: "not_connected" };
        }
        const hit = tokens.get(key);
        if (hit && hit.grant === conn.refreshTokenEnc.ct && hit.expiresAt > now()) {
          touch(key);
          return { ok: true, token: hit.token, services: usable(conn, hit.scopes) };
        }
        let p = inflight.get(key);
        if (!p) {
          p = mint(key, conn, gen)
            .catch((err): AccessTokenResult => {
              deps.log?.warn("google access token lookup failed", { err });
              return { ok: false, status: "error", reason: "lookup failed" };
            })
            .finally(() => {
              if (inflight.get(key) === p) inflight.delete(key);
            });
          inflight.set(key, p);
        }
        if (!signal) return await p;
        // The shared refresh is not cancelled by one caller leaving; that caller just stops waiting.
        if (signal.aborted) return { ok: false, status: "error", reason: "aborted" };
        return await Promise.race([
          p,
          new Promise<AccessTokenResult>((resolve) => signal.addEventListener("abort", () => resolve({ ok: false, status: "error", reason: "aborted" }), { once: true })),
        ]);
      } catch (err) {
        deps.log?.warn("google access token lookup failed", { err });
        return { ok: false, status: "error", reason: "lookup failed" };
      }
    },

    invalidate(actor) {
      const key = actorKey(actor ?? "");
      tokens.delete(key);
      conns.delete(key);
      inflight.delete(key);
      generation.set(key, genOf(key) + 1);
    },
  };
}
