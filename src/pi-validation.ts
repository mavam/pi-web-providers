import { stripVTControlCharacters } from "node:util";
import type { TSchema } from "typebox";
import { Check, Errors } from "typebox/value";

type Schema = Record<string, any>;
function isSchema(value: unknown): value is Schema {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function alternatives(schema: Schema): Schema[] {
  return ["anyOf", "oneOf", "allOf"].flatMap((key) =>
    Array.isArray(schema[key]) ? schema[key].filter(isSchema) : [],
  );
}

// Errors from a failing union branch must not label another branch's valid
// properties as unknown. Open records and pattern properties remain open.
function acceptsPath(schema: unknown, path: string[]): boolean {
  if (schema === true) return true;
  if (!isSchema(schema)) return false;
  if (!path.length) return true;
  if (alternatives(schema).some((branch) => acceptsPath(branch, path)))
    return true;
  const [key, ...rest] = path;
  if (schema.type === "array") return acceptsPath(schema.items, rest);
  if (schema.properties && Object.hasOwn(schema.properties, key))
    return acceptsPath(schema.properties[key], rest);
  if (isSchema(schema.patternProperties)) {
    for (const [pattern, child] of Object.entries(schema.patternProperties))
      if (new RegExp(pattern).test(key) && acceptsPath(child, rest))
        return true;
  }
  if (schema.additionalProperties === false) return false;
  if (schema.type && schema.type !== "object") return false;
  // A union wrapper alone doesn't make its closed object branches open.
  if (
    alternatives(schema).length &&
    !schema.properties &&
    schema.additionalProperties === undefined
  )
    return false;
  return (
    schema.additionalProperties === undefined ||
    acceptsPath(schema.additionalProperties, rest)
  );
}

function displayPath(path: string[]): string {
  return path
    .map((part, index) => {
      const safe = stripVTControlCharacters(part);
      if (/^[a-zA-Z_][\w-]*$/.test(safe)) return `${index ? "." : ""}${safe}`;
      if (/^\d+$/.test(safe)) return `[${safe}]`;
      return `[${JSON.stringify(safe)}]`;
    })
    .join("");
}

function locations(
  schema: unknown,
  name: string,
  path: string[] = [],
): string[][] {
  if (!isSchema(schema)) return [];
  const found = alternatives(schema).flatMap((branch) =>
    locations(branch, name, path),
  );
  if (isSchema(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      const next = [...path, key];
      if (key === name) found.push(next);
      found.push(...locations(child, name, next));
    }
  }
  return found;
}

/** Reject unknown fields before Pi's generic validator echoes the raw payload.
 * Leave coercion, required fields, and all other validation to Pi unchanged. */
export function prepareToolArguments(schema: TSchema, args: unknown): unknown {
  if (Check(schema, args)) return args;
  const messages = new Set<string>();
  for (const error of Errors(schema, args)) {
    if (error.keyword !== "additionalProperties") continue;
    const names = error.params.additionalProperties;
    if (!Array.isArray(names)) continue;
    const parent = error.instancePath
      .split("/")
      .slice(1)
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
    for (const name of names) {
      if (typeof name !== "string") continue;
      const path = [...parent, name];
      if (acceptsPath(schema, path)) continue;
      const targets = [...new Set(locations(schema, name).map(displayPath))];
      const suggestion =
        targets.length === 1
          ? ` Use ${targets[0]} instead.`
          : " Check the tool's parameter schema.";
      messages.add(`Invalid parameter: ${displayPath(path)}.${suggestion}`);
      if (messages.size === 3) break;
    }
    if (messages.size === 3) break;
  }
  if (messages.size) throw new Error([...messages].join("\n"));
  return args;
}
