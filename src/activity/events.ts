/** Server-side event types recorded by the HTTP pipeline. Client events are `ui.<type>`. */
export const EVENT = {
  chatRequest: "chat.request",
  chatStreamRequest: "chat.stream_request",
  authLogin: "auth.login",
  authLoginRejected: "auth.login_rejected",
  authMe: "auth.me",
  authRejected: "auth.rejected",
  profileRead: "profile.read",
  profileUpdate: "profile.update",
  sessionRead: "session.read",
  sessionUpdate: "session.update",
  sessionDelete: "session.delete",
  sessionList: "session.list",
  feedbackSubmitted: "feedback.submitted",
  clientEventsIngested: "client.events_ingested",
  httpRateLimited: "http.rate_limited",
  httpError: "http.error",
  httpRequest: "http.request",
} as const;

export type ServerEventType = (typeof EVENT)[keyof typeof EVENT];

/** `type` accepted from clients (stored as `ui.<type>`). */
export const CLIENT_EVENT_TYPE = /^[a-z][a-z0-9_]{1,48}$/;

/** Replace the dynamic path segment with ":id" so events group by route. */
export function normaliseRoute(path: string, param?: string): string {
  if (!param) return path;
  const idx = path.lastIndexOf("/" + param);
  if (idx < 0) return path;
  return path.slice(0, idx) + "/:id" + path.slice(idx + param.length + 1);
}

/** Map a finished request to its event type. Status decides first, then route + method. */
export function eventTypeFor(method: string, route: string, status: number): ServerEventType {
  if (status === 429) return EVENT.httpRateLimited;
  if (status >= 500) return EVENT.httpError;
  if (route === "/auth/google" && method === "POST") return status < 400 ? EVENT.authLogin : EVENT.authLoginRejected;
  if (status === 401 || status === 403) return EVENT.authRejected;
  if (status >= 400) return EVENT.httpRequest;
  switch (route) {
    case "/v1/chat":
    case "/chat":
      return EVENT.chatRequest;
    case "/v1/chat/stream":
    case "/chat/stream":
      return EVENT.chatStreamRequest;
    case "/auth/me":
      return EVENT.authMe;
    case "/v1/profile":
      return method === "GET" ? EVENT.profileRead : EVENT.profileUpdate;
    case "/v1/sessions":
      return EVENT.sessionList;
    case "/v1/sessions/:id":
      return method === "DELETE" ? EVENT.sessionDelete : method === "PATCH" ? EVENT.sessionUpdate : EVENT.sessionRead;
    case "/v1/feedback":
      return EVENT.feedbackSubmitted;
    case "/v1/events":
      return EVENT.clientEventsIngested;
    default:
      return EVENT.httpRequest;
  }
}

/** JSON-serialise with a byte cap so a client cannot bloat an event document. */
export function capJson(value: Record<string, unknown> | undefined | null, maxBytes: number): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return { _unserializable: true };
  }
  if (json.length <= maxBytes) return JSON.parse(json);
  return { _truncated: true, _bytes: json.length, preview: json.slice(0, maxBytes) };
}
