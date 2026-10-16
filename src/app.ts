import { z } from "zod";
import { eventTypeFor, normaliseRoute } from "./activity/events";
import type { Env } from "./config/env";
import { createApiKeyVerifier } from "./middleware/api-key";
import { AuthError, verifySupabaseToken } from "./auth/supabase";
import { looksLikeEdgeSession, verifySession } from "./auth/session";
import { ApiError, clientIp, errorResponse, getRequestId, json } from "./app/http";
import { disabledIntegrationRoutes, type IntegrationRoutes } from "./app/integrations";
import { createTokenBucketLimiter, type RateLimiter } from "./app/rate-limit";
import { createRoutes, type AuthenticatedUser, type RequestContext, type RouteDeps } from "./app/routes";

export interface AppDeps extends RouteDeps {
  limiter?: RateLimiter;
  /** Gmail/Drive connection routes; absent → they answer "disabled". */
  integrations?: IntegrationRoutes;
}

type Handler = (req: Request, ctx: RequestContext, param?: string) => Promise<Response> | Response;
type ServerLike = { requestIP(req: Request): { address: string } | null };

/**
 * Bun.serve application. Every protected route goes through the same pipeline:
 * request id → CORS → authentication (x-api-key OR Google session cookie) →
 * rate limit → timeout → handler → error envelope. Health endpoints skip auth
 * so probes and the ALB can reach them.
 */
export function createApp(deps: AppDeps, listen: { port: number; hostname?: string } = { port: deps.env.PORT }) {
  const { env, logger } = deps;
  const routes = createRoutes(deps);
  const integrations = deps.integrations ?? disabledIntegrationRoutes;
  const verifier = createApiKeyVerifier(env.API_KEY);
  const limiter =
    deps.limiter ??
    createTokenBucketLimiter({ perMinute: env.RATE_LIMIT_RPM, burst: Math.max(5, Math.ceil(env.RATE_LIMIT_RPM / 4)) });
  const allowedOrigins = new Set(env.CORS_ORIGINS);
  // One token per request still running, streamed responses until their body ends (`shutdown` waits on it).
  const inflight = new Set<object>();
  // Set by `shutdown`: new work is refused with 503 while in-flight requests finish.
  let draining = false;

  if (!verifier.enabled && !env.USER_AUTH_ENABLED) {
    logger.warn("API_KEY and SUPABASE_URL both unset: authentication disabled (non-production only)");
  }

  function corsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get("origin");
    if (!origin) return {};
    const allowed = allowedOrigins.has("*") || allowedOrigins.has(origin);
    if (!allowed) return {};
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type, authorization, x-api-key, x-request-id, x-user-id",
      "access-control-expose-headers": "x-request-id",
      "access-control-max-age": "600",
      vary: "origin",
    };
  }

  function withHeaders(res: Response, headers: Record<string, string>): Response {
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  }

  /**
   * Resolve the caller. `Authorization: Bearer <Edge session or Supabase access
   * token>` identifies an end user (any verified Google account); `x-api-key`
   * identifies a trusted server (the Next.js backend), which may pass
   * `x-user-id` to scope sessions. Both may be sent together: the user
   * identity wins for scoping.
   */
  async function authenticate(req: Request): Promise<{ auth: RequestContext["auth"]; user: AuthenticatedUser | null }> {
    const apiKey = req.headers.get("x-api-key");
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
    let apiKeyOk = false;
    if (apiKey !== null) {
      if (!verifier.enabled || !verifier.verify(apiKey)) throw new ApiError(401, "unauthorized", "Invalid x-api-key");
      apiKeyOk = true;
    }
    if (bearer && env.SESSION_SECRET && looksLikeEdgeSession(bearer)) {
      const claims = await verifySession(bearer, env.SESSION_SECRET);
      if (!claims) throw new ApiError(401, "token_expired", "Session expired, please sign in again");
      return { auth: "session", user: { id: claims.sub, email: claims.email, name: claims.name, picture: claims.picture } };
    }
    if (bearer && env.SUPABASE_URL) {
      try {
        const u = await verifySupabaseToken(bearer, {
          supabaseUrl: env.SUPABASE_URL,
          jwtSecret: env.SUPABASE_JWT_SECRET,
          requireGoogleProvider: env.REQUIRE_GOOGLE_PROVIDER,
        });
        return { auth: "session", user: { id: u.id, email: u.email, name: u.name, picture: u.picture } };
      } catch (err) {
        if (err instanceof AuthError) {
          const status = err.code === "provider_not_allowed" ? 403 : 401;
          throw new ApiError(status, err.code, err.message);
        }
        throw err;
      }
    }
    if (apiKeyOk) return { auth: "api_key", user: null };
    if (!verifier.enabled && !env.USER_AUTH_ENABLED) return { auth: "none", user: null };
    throw new ApiError(401, "unauthorized", env.USER_AUTH_ENABLED ? "Sign in with Google (Authorization: Bearer) or provide x-api-key" : "Missing or invalid x-api-key");
  }

  /** Streamed answers (SSE / NDJSON) are still in flight after the handler returns. */
  function isStream(res: Response): boolean {
    const type = res.headers.get("content-type") ?? "";
    return res.body !== null && (type.startsWith("text/event-stream") || type.startsWith("application/x-ndjson"));
  }

  /** The same response, calling `onEnd` once when its body finishes, fails, or the client hangs up. */
  function untilBodyEnds(res: Response, onEnd: () => void): Response {
    const reader = res.body!.getReader();
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      onEnd();
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            end();
            c.close();
          } else c.enqueue(value);
        } catch (err) {
          end();
          c.error(err);
        }
      },
      cancel(reason) {
        end();
        return reader.cancel(reason);
      },
    });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  }

  function errorCodeOf(err: unknown, status: number): string {
    if (err instanceof ApiError) return err.code;
    if (err instanceof z.ZodError) return "validation_error";
    return status === 504 ? "timeout" : "internal_error";
  }

  function guard(handler: Handler, opts: { auth: boolean; rateLimit: boolean } = { auth: true, rateLimit: true }) {
    // Probes (no auth, no rate limit) are not user activity.
    const tracked = opts.auth || opts.rateLimit;
    return async (req: Request & { params?: Record<string, string> }, server: ServerLike) => {
      const requestId = getRequestId(req);
      const cors = corsHeaders(req);
      const started = performance.now();
      const path = new URL(req.url).pathname;
      const param = req.params ? Object.values(req.params)[0] : undefined;
      const log = logger.child({ requestId, method: req.method, path });
      const details: Record<string, unknown> = {};
      let identity: { auth: RequestContext["auth"]; user: AuthenticatedUser | null } | null = null;
      let ownerId = "anonymous";
      const ip = clientIp(req, server);

      /** Record the request in the activity log (fire-and-forget; never throws). */
      const emit = (status: number, errorCode: string | null = null) => {
        if (!tracked || !deps.activity) return;
        const route = normaliseRoute(path, param);
        deps.activity.event({
          type: eventTypeFor(req.method, route, status),
          source: "server",
          requestId,
          sessionId: typeof details.sessionId === "string" ? details.sessionId : null,
          ownerId,
          auth: identity?.auth ?? null,
          method: req.method,
          route,
          path,
          status,
          ms: Math.round(performance.now() - started),
          errorCode,
          ip,
          userAgent: req.headers.get("user-agent")?.slice(0, 256) ?? null,
          details,
        });
      };

      try {
        // Draining after SIGTERM: refuse new work so it lands on another pod. Probes are exempt:
        // /healthz stays up (a failing liveness probe would kill the drain), /readyz answers 503 itself.
        if (draining && tracked) {
          const res = errorResponse(new ApiError(503, "shutting_down", "Server is restarting, retry shortly"), requestId);
          res.headers.set("retry-after", "1");
          res.headers.set("connection", "close");
          emit(503, "shutting_down");
          return withHeaders(res, cors);
        }
        identity = opts.auth ? await authenticate(req) : { auth: "none" as const, user: null };
        const headerUser = (req.headers.get("x-user-id") ?? "").trim().slice(0, 128);
        ownerId = identity.user?.email ?? ((identity.auth === "api_key" && headerUser) || "anonymous");
        if (opts.rateLimit) {
          const key = ownerId !== "anonymous" ? `u:${ownerId}` : `ip:${ip}`;
          const r = limiter.take(key);
          if (!r.ok) {
            const res = errorResponse(new ApiError(429, "rate_limited", "Too many requests, slow down"), requestId);
            res.headers.set("retry-after", String(r.retryAfterSeconds));
            emit(429, "rate_limited");
            return withHeaders(res, cors);
          }
        }
        const signal = AbortSignal.any([req.signal, AbortSignal.timeout(env.REQUEST_TIMEOUT_MS)]);
        const ctx: RequestContext = { requestId, ownerId, auth: identity.auth, user: identity.user, signal, details };
        const token = {};
        const done = () => void inflight.delete(token);
        inflight.add(token);
        let streaming = false;
        try {
          const res = await handler(req, ctx, param);
          res.headers.set("x-request-id", requestId);
          log.info("request", { status: res.status, auth: identity.auth, ms: Math.round(performance.now() - started) });
          emit(res.status);
          streaming = isStream(res);
          return withHeaders(streaming ? untilBodyEnds(res, done) : res, cors);
        } finally {
          if (!streaming) done();
        }
      } catch (err) {
        const res = errorResponse(err, requestId, !env.IS_PROD);
        const code = errorCodeOf(err, res.status);
        if (res.status >= 500) log.error("request failed", { status: res.status, err });
        else log.info("request rejected", { status: res.status, code });
        emit(res.status, code);
        return withHeaders(res, cors);
      }
    };
  }

  const open = { auth: false, rateLimit: false } as const;
  const server = Bun.serve({
    port: listen.port,
    hostname: listen.hostname,
    idleTimeout: 120,
    development: !env.IS_PROD && env.NODE_ENV !== "test",
    routes: {
      "/auth/google": { POST: guard(routes.googleLogin, { auth: false, rateLimit: true }) },
      "/auth/me": { GET: guard((_req, ctx) => routes.me(ctx)) },
      "/v1/profile": { GET: guard(routes.getProfile), PATCH: guard(routes.patchProfile), PUT: guard(routes.patchProfile) },
      // Probes.
      "/health": { GET: guard(() => routes.health(), open) },
      "/healthz": { GET: guard(() => routes.health(), open) },
      "/readyz": { GET: guard(() => (draining ? json({ status: "shutting_down" }, { status: 503 }) : routes.ready()), open) },
      // API.
      "/v1/chat": { POST: guard(routes.chat) },
      "/v1/chat/stream": { POST: guard(routes.chatStream) },
      // Student documents attached in chat (encrypted, never in the knowledge base).
      "/v1/chat/attachments": { POST: guard(routes.uploadAttachment) },
      "/v1/chat/attachments/uploads": { POST: guard(routes.startDirectUpload) },
      "/v1/chat/attachments/uploads/complete": { POST: guard(routes.completeDirectUpload) },
      "/v1/chat/attachments/:id": { GET: guard((req, ctx, id) => routes.getAttachment(req, ctx, id!)) },
      "/v1/chat/attachments/:id/content": { GET: guard((req, ctx, id) => routes.getAttachmentContent(req, ctx, id!)) },
      // Signed, 10-minute links for crm-api to fetch a file it was asked to attach: no auth, rate limited.
      "/v1/files/:id": { GET: guard((req, ctx, id) => routes.getSignedFile(req, ctx, id!), { auth: false, rateLimit: true }) },
      "/v1/knowledge/search": { POST: guard(routes.knowledgeSearch) },
      "/v1/knowledge/status": { GET: guard(routes.knowledgeStatus) },
      "/v1/knowledge/programs/search": { POST: guard(routes.programSearch) },
      "/v1/knowledge/documents": { POST: guard(routes.uploadDocument), GET: guard(routes.listDocuments) },
      "/v1/knowledge/documents/:id": {
        GET: guard((req, ctx, id) => routes.getDocument(req, ctx, id!)),
        DELETE: guard((req, ctx, id) => routes.deleteDocument(req, ctx, id!)),
      },
      "/v1/knowledge/reindex": { POST: guard(routes.reindex) },
      "/v1/knowledge/partners": { GET: guard(routes.listPartners) },
      "/v1/knowledge/partners/:slug": {
        GET: guard((req, ctx, slug) => routes.getPartner(req, ctx, slug!)),
        PUT: guard((req, ctx, slug) => routes.upsertPartner(req, ctx, slug!)),
        DELETE: guard((req, ctx, slug) => routes.deletePartner(req, ctx, slug!)),
      },
      "/v1/sessions": { GET: guard(routes.listSessions), POST: guard(routes.createSession) },
      "/v1/sessions/:id/guide": { PATCH: guard((req, ctx, id) => routes.patchGuide(req, ctx, id!)) },
      "/v1/sessions/:id/student": { GET: guard((req, ctx, id) => routes.getStudent(req, ctx, id!)) },
      "/v1/journey": { GET: guard(routes.journey) },
      "/v1/crm/contacts": { GET: guard(routes.crmContacts) },
      "/v1/sessions/:id": {
        GET: guard((req, ctx, id) => routes.getSession(req, ctx, id!)),
        PATCH: guard((req, ctx, id) => routes.patchSession(req, ctx, id!)),
        DELETE: guard((req, ctx, id) => routes.deleteSession(req, ctx, id!)),
      },
      "/v1/feedback": { POST: guard(routes.feedback) },
      "/v1/crm/writes/:id/decision": { POST: guard((req, ctx, id) => routes.crmWriteDecision(req, ctx, id!)) },
      "/v1/events": { POST: guard(routes.clientEvents) },
      // Gmail + Drive: each consultant connects their own Google account (src/google/).
      "/v1/integrations": { GET: guard(integrations.listIntegrations) },
      "/v1/integrations/google/connect": { POST: guard(integrations.connectGoogle) },
      "/v1/integrations/google/callback": { POST: guard(integrations.googleCallback) },
      "/v1/integrations/google/:service": { DELETE: guard((req, ctx, service) => integrations.disconnectGoogle(req, ctx, service!)) },
      // Legacy paths from the prototype API.
      "/chat": { POST: guard(routes.chat) },
      "/chat/stream": { POST: guard(routes.chatStream) },
    },
    fetch(req) {
      const requestId = getRequestId(req);
      if (req.method === "OPTIONS") return withHeaders(new Response(null, { status: 204 }), corsHeaders(req));
      return withHeaders(
        json(
          { error: { code: "not_found", message: `No route for ${req.method} ${new URL(req.url).pathname}`, requestId } },
          { status: 404, requestId },
        ),
        corsHeaders(req),
      );
    },
    error(err) {
      logger.error("unhandled server error", { err });
      return errorResponse(err, crypto.randomUUID(), !env.IS_PROD);
    },
  });

  return {
    server,
    /**
     * Refuse new work (503, readiness fails) and wait up to `graceMs` for in-flight requests,
     * streamed answers until their last byte; then close every connection. The listener stays
     * open meanwhile so the liveness probe keeps passing through a drain longer than its window.
     */
    async shutdown(graceMs = 20_000) {
      draining = true;
      const deadline = Date.now() + graceMs;
      while (inflight.size && Date.now() < deadline) await Bun.sleep(Math.min(100, Math.max(1, deadline - Date.now())));
      server.stop(true);
    },
    get draining() {
      return draining;
    },
    /** Requests still running, open streams included. */
    get inFlight() {
      return inflight.size;
    },
  };
}
