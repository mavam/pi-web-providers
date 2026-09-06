import { resolve } from "node:path";
import {
  CAPABILITIES,
  type Capability,
  type RequestOptions,
} from "./domain.js";
import type {
  CreateWebfoxOptions,
  ProviderInspection,
  WebfoxClient,
} from "./application-types.js";
import { loadConfigSync, validateConfig } from "./configuration/file.js";
import {
  effectiveOptions,
  optionSchema,
  selectProvider,
  validateConfiguredOptions,
} from "./configuration/planning.js";
import { providers } from "./providers/registry.js";
import type { ProviderDefinition } from "./providers/definition.js";
import { ExecutionRuntime } from "./runtime/execute.js";
import { OutwardBoundary } from "./runtime/outward.js";
import { WebfoxError } from "./errors.js";

export function createWebfox(options: CreateWebfoxOptions = {}): WebfoxClient {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = { ...(options.env ?? process.env) };
  const config = options.config
    ? validateConfig(structuredClone(options.config), "createWebfox config")
    : loadConfigSync({ configPath: options.configPath, env, cwd });
  validateConfiguredOptions(config);
  const runtime = new ExecutionRuntime(cwd, env);
  const outward = new OutwardBoundary();
  // Inspection can redact known values without evaluating credential commands.
  const collect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if ("value" in value && typeof value.value === "string")
      outward.addSecret(value.value);
    if ("env" in value && typeof value.env === "string" && env[value.env])
      outward.addSecret(env[value.env]!);
    for (const child of Object.values(value)) collect(child);
  };
  collect(config.providers);
  for (const definition of Object.values(providers))
    for (const credential of definition.credentials)
      if (env[credential.environmentVariable])
        outward.addSecret(env[credential.environmentVariable]!);
  const configured = (
    definition: ProviderDefinition,
    capability: Capability,
  ): boolean => {
    const stored = config.providers?.[definition.id];
    if (!definition.capabilities[capability]) return false;
    if (definition.fields.includes("commands"))
      return !!stored?.commands?.[capability];
    if (definition.credentials.every((c) => c.optional))
      return (
        !!stored ||
        definition.credentials.some((c) => !!env[c.environmentVariable])
      );
    const present = (source: unknown): boolean =>
      !!source &&
      typeof source === "object" &&
      ("env" in source ? !!env[String(source.env)] : true);
    return (
      definition.credentials
        .filter(
          (c) =>
            !c.optional &&
            (!c.capabilities || c.capabilities.includes(capability)),
        )
        .every((c) =>
          present(
            stored?.credentials?.[c.name] ?? { env: c.environmentVariable },
          ),
        ) &&
      Object.entries(definition.credentialDefaults).every(([key, source]) =>
        present(key === "accountId" ? (stored?.accountId ?? source) : source),
      )
    );
  };
  const inspectProvider = (
    definition: ProviderDefinition,
  ): ProviderInspection => ({
    id: definition.id,
    label: definition.label,
    docsUrl: definition.docsUrl,
    local: definition.local,
    configurationRequirements: Object.fromEntries(
      Object.entries(definition.credentialDefaults).flatMap(([key, source]) =>
        "env" in source ? [[key, source.env]] : [],
      ),
    ),
    capabilities: CAPABILITIES.filter((c) => !!definition.capabilities[c]),
    credentials: structuredClone(definition.credentials),
    configured: CAPABILITIES.filter((c) => configured(definition, c)),
    selectedDefaults: CAPABILITIES.filter(
      (c) => config.defaults?.[c]?.provider === definition.id,
    ),
  });
  const execute = <C extends Capability>(
    capability: C,
    inputs: string[],
    request: RequestOptions,
    maxResults?: number,
  ) => {
    const definition = selectProvider(config, capability, request.provider);
    const options = effectiveOptions(
      config,
      definition,
      capability,
      request.options,
    );
    return runtime.execute(
      {
        capability,
        definition,
        inputs,
        options,
        maxResults,
        stored: config.providers?.[definition.id],
        policy: config.execution ?? {},
      },
      request,
    );
  };
  return {
    async search(request) {
      const inputs = batch(request.queries, "queries", 10);
      const maxResults =
        request.maxResults ?? config.defaults?.search?.maxResults ?? 5;
      if (!Number.isSafeInteger(maxResults) || maxResults < 1)
        throw new WebfoxError(
          "INVALID_INPUT",
          "maxResults must be a positive integer.",
        );
      return execute("search", inputs, request, maxResults);
    },
    async contents(request) {
      const urls = batch(request.urls, "urls");
      for (const url of urls) {
        try {
          if (!["http:", "https:"].includes(new URL(url).protocol))
            throw new Error();
        } catch {
          throw new WebfoxError(
            "INVALID_INPUT",
            "contents requires HTTP or HTTPS URLs.",
          );
        }
      }
      return execute("contents", urls, request);
    },
    async answer(request) {
      return execute("answer", batch(request.queries, "queries", 10), request);
    },
    async research(request) {
      return execute("research", batch([request.input], "input", 1), request);
    },
    listProviders: () => Object.values(providers).map(inspectProvider),
    getProvider: (id) =>
      Object.hasOwn(providers, id) ? inspectProvider(providers[id]) : undefined,
    inspectCapability(capability, requested) {
      const selected = requested ?? config.defaults?.[capability]?.provider;
      if (!selected)
        return {
          capability,
          configured: false,
          defaults: {
            options: {},
            ...(capability === "search"
              ? { maxResults: config.defaults?.search?.maxResults ?? 5 }
              : {}),
          },
        };
      const definition = selectProvider(config, capability, selected);
      return outward.value({
        capability,
        provider: selected,
        configured: configured(definition, capability),
        optionSchema: optionSchema(
          definition,
          capability,
          "defaults",
        ) as unknown as Record<string, unknown> | undefined,
        defaults: {
          options: effectiveOptions(
            config,
            definition,
            capability,
            {},
            "defaults",
          ),
          ...(capability === "search"
            ? { maxResults: config.defaults?.search?.maxResults ?? 5 }
            : {}),
        },
      });
    },
  };
}
function batch(values: unknown, name: string, max = Infinity): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > max)
    throw new WebfoxError(
      "INVALID_INPUT",
      `${name} requires ${max === Infinity ? "one or more inputs" : `between 1 and ${max} inputs`}.`,
    );
  return values.map((value) => {
    if (typeof value !== "string" || !value.trim())
      throw new WebfoxError(
        "INVALID_INPUT",
        `${name} must contain non-empty strings.`,
      );
    return value.trim();
  });
}
