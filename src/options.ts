import type { TObject, TSchema } from "typebox";
import type { Tool } from "./types.js";

export type ProviderOptions = Record<string, unknown>;

export type ToolOptionsFor<
  _TTool extends Tool,
  TProviderOptions extends ProviderOptions = ProviderOptions,
> = TProviderOptions;

export function buildToolOptionsSchema(
  _capability: Tool,
  providerSchema?: TObject,
) {
  if (!providerSchema || Object.keys(providerSchema.properties).length === 0) {
    return undefined;
  }

  return closeObjectSchemas(providerSchema) as TObject;
}

function closeObjectSchemas(schema: TSchema): TSchema {
  if (!isSchemaRecord(schema)) {
    return schema;
  }

  const properties = isSchemaRecord(schema.properties)
    ? Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [
          key,
          closeObjectSchemas(value as TSchema),
        ]),
      )
    : schema.properties;
  const items = isSchemaRecord(schema.items)
    ? closeObjectSchemas(schema.items as TSchema)
    : Array.isArray(schema.items)
      ? schema.items.map((item) => closeObjectSchemas(item as TSchema))
      : schema.items;

  return {
    ...schema,
    ...(properties ? { properties } : {}),
    ...(items ? { items } : {}),
    ...mapSchemaArray(schema, "anyOf"),
    ...mapSchemaArray(schema, "oneOf"),
    ...mapSchemaArray(schema, "allOf"),
    ...(schema.type === "object" && isSchemaRecord(schema.properties)
      ? { additionalProperties: false }
      : {}),
  } as TSchema;
}

function mapSchemaArray(
  schema: Record<string, unknown>,
  key: "anyOf" | "oneOf" | "allOf",
): Partial<Record<"anyOf" | "oneOf" | "allOf", TSchema[]>> {
  const value = schema[key];
  return Array.isArray(value)
    ? { [key]: value.map((entry) => closeObjectSchemas(entry as TSchema)) }
    : {};
}

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
