/**
 * Reduce a server-published JSON Schema to the subset Gemini function declarations accept.
 *
 * Google's Workspace MCP servers publish schemas generated from protobufs: `format: "int32"`,
 * `x-google-enum-descriptions`, `readOnly`, `$defs`/`$ref` for nested messages. OpenRouter
 * models take all of that, but the Gemini fallback rejects the whole request on the first key
 * it does not know, and the turn loses its research. So this is an allowlist, not a denylist:
 * anything not named in KEEP is dropped, and the constructs that carry meaning are rewritten
 * rather than lost (`$ref` inlined, `const` as a one-value enum, `anyOf` with null as nullable).
 *
 * Always returns a fresh object; the input is never mutated.
 */

type Schema = Record<string, unknown>;

/** Keys copied through as they are (after the rewrites below). */
const KEEP = new Set(["type", "description", "nullable", "minimum", "maximum", "minItems", "maxItems", "minLength", "maxLength"]);
/** Gemini accepts only these `format` values on strings. */
const KEEP_FORMATS = new Set(["enum", "date-time"]);
const MAX_REF_DEPTH = 8;

const isObject = (v: unknown): v is Schema => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const isPrimitive = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

/** `#/$defs/Name` or `#/definitions/Name`; anything else (remote, JSON pointer into properties) is not inlined. */
function resolveRef(ref: string, defs: Schema): Schema | undefined {
  const m = /^#\/(?:\$defs|definitions)\/([^/]+)$/.exec(ref);
  const hit = m ? defs[decodeURIComponent(m[1]!)] : undefined;
  return isObject(hit) ? hit : undefined;
}

/** Merge object-shaped allOf members: properties unioned, required unioned, first description wins. */
function mergeAll(parts: Schema[]): Schema {
  const out: Schema = {};
  const properties: Schema = {};
  const required = new Set<string>();
  for (const p of parts) {
    for (const [k, v] of Object.entries(p)) {
      if (k === "properties" && isObject(v)) Object.assign(properties, v);
      else if (k === "required" && Array.isArray(v)) v.forEach((r) => typeof r === "string" && required.add(r));
      else if (!(k in out)) out[k] = v;
    }
  }
  if (Object.keys(properties).length) out.properties = properties;
  if (required.size) out.required = [...required];
  return out;
}

function clean(input: unknown, defs: Schema, depth: number): Schema {
  if (!isObject(input)) return {};
  let node: Schema = { ...input };

  // Inline a local reference; the referring node's own keys (description) win over the target's.
  if (typeof node.$ref === "string") {
    const { $ref, ...rest } = node;
    const target = depth < MAX_REF_DEPTH ? resolveRef($ref as string, defs) : undefined;
    // An unresolvable (or too deeply recursive) reference degrades to an untyped object.
    node = target ? { ...target, ...rest } : { type: "object", ...rest };
    depth++;
  }

  if (Array.isArray(node.allOf)) {
    const { allOf, ...rest } = node;
    node = mergeAll([rest, ...(allOf as unknown[]).filter(isObject).map((p) => (typeof p.$ref === "string" ? (resolveRef(p.$ref, defs) ?? {}) : p))]);
  }

  // anyOf/oneOf: a null variant becomes `nullable`; the first remaining variant is the shape.
  for (const key of ["anyOf", "oneOf"] as const) {
    if (!Array.isArray(node[key])) continue;
    const { [key]: variants, ...rest } = node;
    const list = (variants as unknown[]).filter(isObject);
    const nonNull = list.filter((v) => v.type !== "null");
    const first = nonNull[0];
    node = { ...(first ? clean(first, defs, depth) : {}), ...rest, ...(nonNull.length < list.length ? { nullable: true } : {}) };
  }

  // `type: ["string", "null"]` is the same idea spelled differently.
  if (Array.isArray(node.type)) {
    const types = (node.type as unknown[]).filter((t): t is string => typeof t === "string");
    const nonNull = types.filter((t) => t !== "null");
    node.type = nonNull[0] ?? "string";
    if (nonNull.length < types.length) node.nullable = true;
  }

  if ("const" in node) {
    node.enum = [node.const];
    delete node.const;
  }

  const out: Schema = {};
  for (const key of KEEP) if (key in node && node[key] !== undefined) out[key] = node[key];

  // Gemini enums are string-only; a numeric or mixed enum is dropped rather than coerced.
  if (Array.isArray(node.enum) && node.enum.length && node.enum.every((v) => typeof v === "string")) {
    out.enum = [...node.enum];
    if (!out.type) out.type = "string";
  }
  if (typeof node.format === "string" && KEEP_FORMATS.has(node.format)) out.format = node.format;
  if ("default" in node && isPrimitive(node.default)) out.default = node.default;

  if (isObject(node.properties)) {
    const properties: Schema = {};
    for (const [name, sub] of Object.entries(node.properties)) properties[name] = clean(sub, defs, depth);
    out.properties = properties;
    if (!out.type) out.type = "object";
    if (Array.isArray(node.required)) {
      const required = node.required.filter((r): r is string => typeof r === "string" && r in properties);
      if (required.length) out.required = required;
    }
  }
  if (node.items !== undefined) {
    // A tuple schema has no Gemini equivalent; its first member stands for all of them.
    out.items = clean(Array.isArray(node.items) ? node.items[0] : node.items, defs, depth);
    if (!out.type) out.type = "array";
  }
  return out;
}

export function sanitizeToolSchema(schema: unknown): Record<string, unknown> {
  const root = isObject(schema) ? schema : {};
  const defs = { ...(isObject(root.definitions) ? root.definitions : {}), ...(isObject(root.$defs) ? root.$defs : {}) };
  const out = clean(root, defs, 0);
  // A function's parameters must be an object, even one with no properties.
  if (out.type !== "object") return { type: "object", properties: {} };
  if (!out.properties) out.properties = {};
  return out;
}
