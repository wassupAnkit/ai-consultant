type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let currentLevel: Level = (process.env.LOG_LEVEL as Level) || "info";
const pretty = process.env.NODE_ENV !== "production" && process.stdout.isTTY;

export function setLogLevel(level: Level) {
  currentLevel = level;
}

const SENSITIVE_KEYS = /(api[_-]?key|authorization|secret|token|password|cookie|verifier)/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: pretty ? value.stack : undefined };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 2_000) return value.slice(0, 2_000) + `…(+${value.length - 2_000})`;
  return value;
}

function emit(level: Level, bindings: Record<string, unknown>, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const record = {
    level,
    time: new Date().toISOString(),
    msg,
    ...bindings,
    ...(fields ? (sanitize(fields) as Record<string, unknown>) : {}),
  };
  const line = pretty
    ? `${record.time} ${level.toUpperCase().padEnd(5)} ${msg}${
        Object.keys(record).length > 3 ? " " + JSON.stringify({ ...record, level: undefined, time: undefined, msg: undefined }) : ""
      }`
    : JSON.stringify(record);
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  return {
    debug: (m, f) => emit("debug", bindings, m, f),
    info: (m, f) => emit("info", bindings, m, f),
    warn: (m, f) => emit("warn", bindings, m, f),
    error: (m, f) => emit("error", bindings, m, f),
    child: (more) => createLogger({ ...bindings, ...more }),
  };
}

export const logger = createLogger({ service: "expert-ai-consultant" });
