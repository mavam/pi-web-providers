import { InvalidArgumentError } from "commander";
const RESERVED_FLAGS = new Set([
  "provider",
  "config",
  "cwd",
  "timeout",
  "format",
  "options-json",
  "quiet",
  "help",
  "help-advanced",
  "max-results",
  "version",
  "color",
  "no-color",
]);
export interface OptionFlag {
  flag: string;
  negativeFlag?: string;
  path: string[];
  kind: "string" | "number" | "integer" | "boolean" | "array";
  itemKind?: "string" | "number" | "integer" | "boolean";
  enumValues?: unknown[];
  description?: string;
}

export function buildOptionFlags(
  schema: Record<string, unknown>,
): OptionFlag[] {
  const candidates: OptionFlag[] = [];
  walkSchema(schema, [], candidates);
  const counts = new Map<string, number>();
  for (const flag of candidates) {
    for (const name of [flag.flag, flag.negativeFlag].filter(
      (name): name is string => !!name,
    ))
      counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return candidates.filter(
    (entry) =>
      counts.get(entry.flag) === 1 &&
      (!entry.negativeFlag || counts.get(entry.negativeFlag) === 1) &&
      !entry.flag.startsWith("--no-") &&
      !RESERVED_FLAGS.has(entry.flag.slice(2)),
  );
}

function walkSchema(
  schema: Record<string, any>,
  path: string[],
  output: OptionFlag[],
): void {
  const properties = schema.properties;
  if (
    properties &&
    typeof properties === "object" &&
    !Array.isArray(properties)
  ) {
    for (const [name, child] of Object.entries(properties)) {
      const childSchema = child as Record<string, any>;
      const next = [...path, name];
      if (childSchema.type === "object" && childSchema.properties) {
        walkSchema(childSchema, next, output);
        continue;
      }
      const descriptor = flagForSchema(childSchema, next);
      if (descriptor) output.push(descriptor);
    }
  }
}

function flagForSchema(
  schema: Record<string, any>,
  path: string[],
): OptionFlag | undefined {
  const flag = `--${path.map(kebab).join("-")}`;
  const enumValues = readEnum(schema);
  const kind = schema.type ?? inferEnumKind(enumValues);
  if (["string", "number", "integer", "boolean"].includes(kind)) {
    return {
      flag,
      ...(kind === "boolean" ? { negativeFlag: `--no-${flag.slice(2)}` } : {}),
      path,
      kind,
      ...(enumValues ? { enumValues } : {}),
      ...(schema.description ? { description: schema.description } : {}),
    };
  }
  if (
    kind === "array" &&
    schema.items &&
    ["string", "number", "integer", "boolean"].includes(
      schema.items.type ?? inferEnumKind(readEnum(schema.items)),
    )
  ) {
    const itemKind = schema.items.type ?? inferEnumKind(readEnum(schema.items));
    return {
      flag,
      path,
      kind: "array",
      itemKind,
      ...(readEnum(schema.items) ? { enumValues: readEnum(schema.items) } : {}),
      ...(schema.description ? { description: schema.description } : {}),
    };
  }
  return undefined;
}

function readEnum(schema: Record<string, any>): unknown[] | undefined {
  if (Array.isArray(schema.enum)) return schema.enum;
  if (
    Array.isArray(schema.anyOf) &&
    schema.anyOf.every((entry: any) => "const" in entry)
  ) {
    return schema.anyOf.map((entry: any) => entry.const);
  }
  return undefined;
}

function inferEnumKind(
  values: unknown[] | undefined,
): "string" | "number" | "boolean" | undefined {
  const kind = typeof values?.[0];
  return kind === "string" || kind === "number" || kind === "boolean"
    ? kind
    : undefined;
}

export function parseTypedValue(raw: string, descriptor: OptionFlag): unknown {
  const itemKind =
    descriptor.kind === "array" ? inferArrayKind(descriptor) : descriptor.kind;
  let value: unknown = raw;
  if (itemKind === "number" || itemKind === "integer") {
    value = Number(raw);
    if (
      !Number.isFinite(value) ||
      (itemKind === "integer" && !Number.isInteger(value))
    )
      throw new InvalidArgumentError(
        `${descriptor.flag} requires a ${itemKind}`,
      );
  } else if (itemKind === "boolean") {
    if (raw !== "true" && raw !== "false")
      throw new InvalidArgumentError(
        `${descriptor.flag} requires true or false`,
      );
    value = raw === "true";
  }
  if (descriptor.enumValues && !descriptor.enumValues.includes(value)) {
    throw new InvalidArgumentError(
      `${descriptor.flag} must be one of: ${descriptor.enumValues.join(", ")}`,
    );
  }
  return value;
}

function inferArrayKind(
  descriptor: OptionFlag,
): "string" | "number" | "integer" | "boolean" {
  if (descriptor.itemKind) return descriptor.itemKind;
  if (descriptor.enumValues?.length) {
    const type = typeof descriptor.enumValues[0];
    if (type === "number") return "number";
    if (type === "boolean") return "boolean";
  }
  return "string";
}

export function setPath(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let cursor = target;
  for (const part of path.slice(0, -1)) {
    const existing = cursor[part];
    cursor[part] =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? existing
        : {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[path.at(-1)!] = value;
}

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}
