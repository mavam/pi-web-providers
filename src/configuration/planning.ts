import type { TObject } from "typebox";
import { Check, Errors } from "typebox/value";
import { CAPABILITIES, type Capability, type ProviderId } from "../domain.js";
import { providers } from "../providers/registry.js";
import type { ProviderDefinition } from "../providers/definition.js";
import type { WebfoxConfig } from "./types.js";
import { WebfoxError } from "../errors.js";
import { buildOptionSchema } from "./options-schema.js";

export function selectProvider(
  config: WebfoxConfig,
  capability: Capability,
  requested?: ProviderId,
): ProviderDefinition {
  const id = requested ?? config.defaults?.[capability]?.provider;
  const example =
    capability === "contents"
      ? "tavily"
      : capability === "research"
        ? "gemini"
        : "brave";
  if (!id)
    throw new WebfoxError(
      "PROVIDER_UNAVAILABLE",
      `No ${capability} provider selected.\n\nRun with --provider ${example}, or save a default:\n  webfox config default ${capability} ${example}\n\nSee available providers: webfox providers`,
    );
  const definition = Object.hasOwn(providers, id) ? providers[id] : undefined;
  if (!definition?.capabilities[capability])
    throw new WebfoxError(
      "PROVIDER_UNAVAILABLE",
      `Provider '${id}' does not support ${capability}. See available providers: webfox providers`,
    );
  return definition;
}
export function optionSchema(
  definition: ProviderDefinition,
  capability: Capability,
  mode: "request" | "defaults" = "request",
): TObject | undefined {
  const schema = definition.capabilities[capability]?.options;
  if (!schema) return undefined;
  const result = buildOptionSchema(schema as unknown as TObject);
  if (mode === "defaults") {
    // Both stored defaults and request overrides may omit fields supplied by
    // the other layer. Validate required fields only after the final merge.
    const partial = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if ("required" in value && Array.isArray(value.required))
        delete value.required;
      for (const child of Object.values(value)) partial(child);
    };
    partial(result);
  }
  return result;
}
export function effectiveOptions(
  config: WebfoxConfig,
  definition: ProviderDefinition,
  capability: Capability,
  options: Record<string, unknown> = {},
  mode: "request" | "defaults" = "request",
): Record<string, unknown> {
  const result = deepMerge(
    deepMerge(
      definition.defaults[capability] ?? {},
      config.providers?.[definition.id]?.options?.[capability] ?? {},
    ),
    options,
  );
  validateOptions(definition, capability, result, mode);
  return result;
}
export function validateOptions(
  definition: ProviderDefinition,
  capability: Capability,
  options: Record<string, unknown>,
  mode: "request" | "defaults" = "request",
): void {
  if (!definition.capabilities[capability])
    throw new WebfoxError(
      "INVALID_INPUT",
      `${definition.id} does not support ${capability}`,
    );
  const schema = optionSchema(definition, capability, mode);
  if (!schema) {
    if (definition.id !== "custom" && Object.keys(options).length)
      throw new WebfoxError(
        "INVALID_INPUT",
        `${definition.id} ${capability} does not accept provider options`,
      );
    return;
  }
  if (!Check(schema, options)) {
    const detail = Errors(schema, options)
      .slice(0, 3)
      .map((error) => `${error.instancePath || "options"}: ${error.message}`)
      .join("; ");
    throw new WebfoxError(
      "INVALID_INPUT",
      `Invalid ${definition.id} ${capability} options: ${detail}`,
    );
  }
}
export function validateConfiguredOptions(config: WebfoxConfig): void {
  try {
    for (const [id, stored] of Object.entries(config.providers ?? {})) {
      const definition = providers[id as ProviderId];
      for (const capability of CAPABILITIES) {
        const options = stored.options?.[capability];
        if (options)
          validateOptions(definition, capability, options, "defaults");
      }
    }
  } catch (error) {
    if (error instanceof WebfoxError)
      throw new WebfoxError("INVALID_CONFIG", error.message);
    throw error;
  }
}
export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new WebfoxError("INVALID_INPUT", `Unsafe option key: ${key}`);
    result[key] =
      isObject(result[key]) && isObject(value)
        ? deepMerge(result[key], value)
        : structuredClone(value);
  }
  return result;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
