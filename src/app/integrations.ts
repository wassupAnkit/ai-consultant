/**
 * `/v1/integrations/*`: the consultant's own Gmail and Drive connections.
 *
 * Every route acts for a person — a signed-in session, or the trusted frontend server
 * (`x-api-key`) passing that person's email in `x-user-id`. A server key calling for itself has no
 * mailbox to connect and is refused.
 */
import { z } from "zod";
import type { Logger } from "../observability/logger";
import { IntegrationError, notConnectedViews, type IntegrationsService } from "../google/integrations";
import { WORKSPACE_SERVICES, type WorkspaceService } from "../google/types";
import { ApiError, json, readJson } from "./http";
import type { RequestContext } from "./routes";

const ServiceSchema = z.enum(WORKSPACE_SERVICES as [WorkspaceService, ...WorkspaceService[]]);

/** Body of POST /v1/integrations/google/connect. */
export const IntegrationConnectSchema = z
  .object({
    services: z
      .array(ServiceSchema)
      .min(1)
      .max(WORKSPACE_SERVICES.length)
      .refine((s) => new Set(s).size === s.length, { message: "services must be unique" }),
    /** Where the frontend lands after consent; must be a relative path (sanitised again server-side). */
    returnTo: z.string().max(512).optional(),
  })
  .strict();

/** Body of POST /v1/integrations/google/callback: what Google redirected back with. */
export const IntegrationCallbackSchema = z
  .object({
    code: z.string().min(1).max(2_048),
    state: z.string().min(16).max(256),
  })
  .strict();

type Handler = (req: Request, ctx: RequestContext) => Promise<Response>;

export interface IntegrationRoutes {
  listIntegrations: Handler;
  connectGoogle: Handler;
  googleCallback: Handler;
  disconnectGoogle: (req: Request, ctx: RequestContext, service: string) => Promise<Response>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The person the request acts for, or 401/403. */
export function requirePerson(ctx: RequestContext): string {
  if (!ctx.ownerId || ctx.ownerId === "anonymous") {
    throw new ApiError(401, "unauthorized", "Sign in (or send x-user-id with the server key) to manage Google integrations");
  }
  if (!EMAIL.test(ctx.ownerId)) throw new ApiError(403, "forbidden", "Google integrations need a consultant email identity");
  return ctx.ownerId.toLowerCase();
}

function serviceOf(raw: string): WorkspaceService {
  const r = ServiceSchema.safeParse(raw);
  if (!r.success) throw new ApiError(404, "unknown_service", `Unknown integration "${raw.slice(0, 32)}"`);
  return r.data;
}

const asApiError = (err: unknown): never => {
  if (err instanceof IntegrationError) throw new ApiError(400, err.code, err.message);
  throw err;
};

export function createIntegrationRoutes(d: { integrations: IntegrationsService; logger: Pick<Logger, "info" | "warn"> }): IntegrationRoutes {
  return {
    async listIntegrations(_req, ctx) {
      const actor = requirePerson(ctx);
      const integrations = await d.integrations.list(actor);
      return json({ enabled: true, integrations }, { requestId: ctx.requestId });
    },

    async connectGoogle(req, ctx) {
      const actor = requirePerson(ctx);
      const body = await readJson(req, IntegrationConnectSchema, 4 * 1024);
      ctx.details.services = body.services;
      const { url } = await d.integrations.connect(actor, body.services, body.returnTo).catch(asApiError);
      return json({ url }, { requestId: ctx.requestId });
    },

    async googleCallback(req, ctx) {
      const actor = requirePerson(ctx);
      // Never put the code or state into details or logs: they are credentials until consumed.
      const body = await readJson(req, IntegrationCallbackSchema, 8 * 1024);
      try {
        const r = await d.integrations.callback(actor, body.code, body.state, ctx.signal);
        ctx.details.services = r.services;
        return json(r, { requestId: ctx.requestId });
      } catch (err) {
        if (err instanceof IntegrationError) {
          ctx.details.reason = err.code;
          d.logger.info("google connect refused", { requestId: ctx.requestId, reason: err.code });
        }
        return asApiError(err);
      }
    },

    async disconnectGoogle(_req, ctx, service) {
      const actor = requirePerson(ctx);
      const s = serviceOf(service);
      ctx.details.service = s;
      // `revoked: false` (full disconnect only) means Google kept the grant: the consultant should remove Edge in their Google Account.
      return json(await d.integrations.disconnectDetailed(actor, s), { requestId: ctx.requestId });
    },
  };
}

/** Mounted when GOOGLE_WORKSPACE_ENABLED is false: the menu shows nothing to connect. */
export const disabledIntegrationRoutes: IntegrationRoutes = {
  async listIntegrations(_req, ctx) {
    return json({ enabled: false, integrations: notConnectedViews() }, { requestId: ctx.requestId });
  },
  async connectGoogle() {
    throw new ApiError(503, "integrations_disabled", "Google integrations are not enabled");
  },
  async googleCallback() {
    throw new ApiError(503, "integrations_disabled", "Google integrations are not enabled");
  },
  async disconnectGoogle() {
    throw new ApiError(503, "integrations_disabled", "Google integrations are not enabled");
  },
};
