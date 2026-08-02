import { Check, Errors } from "typebox/value";
import type { TSchema } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import { renderContentsAnswers } from "../contents.js";
import { isRetryableError } from "../execution-policy.js";
import { buildToolOptionsSchema } from "../options.js";
import { executeProviderRequest } from "../provider-runtime.js";
import type { ProviderConfig, ProviderResult, Tool } from "../types.js";
import { PROVIDER_CATALOG, PROVIDERS_BY_ID } from "./catalog.js";
import {
  buildRuntimeProviderConfig,
  compatibleProviderIds,
  configuredOptions,
  loadConfigSync,
  validateConfig,
} from "./configuration.js";
import { asWebMuxError, WebMuxError } from "./errors.js";
import { loadProvider } from "./provider-loader.js";
import { rawPayload } from "./raw.js";
import type {
  AnswerDocument,
  AnswerOptions,
  Capability,
  CapabilityDocument,
  ContentsDocument,
  ContentsOptions,
  CreateWebMuxOptions,
  InputResult,
  ProviderId,
  ProviderMetadata,
  ResearchDocument,
  ResearchOptions,
  SearchDocument,
  SearchOptions,
  WebMuxClient,
  WebMuxConfig,
} from "./public-types.js";

const DEFAULT_MAX_RESULTS = 5;
const MAX_BATCH_INPUTS = 10;

export function createWebMux(options: CreateWebMuxOptions = {}): WebMuxClient {
  const cwd = options.cwd ?? process.cwd();
  const config = options.config
    ? validateConfig(structuredClone(options.config), "createWebMux config")
    : loadConfigSync({ configPath: options.configPath, env: options.env });

  return {
    search: (request) => search(config, cwd, request),
    contents: (request) => contents(config, cwd, request),
    answer: (request) => answer(config, cwd, request),
    research: (request) => research(config, cwd, request),
    listProviders: () => PROVIDER_CATALOG,
    getProvider: (id) => PROVIDERS_BY_ID[id],
    getProviderOptionSchema: async (id, capability) => {
      const definition = await loadProvider(id);
      const schema = definition.capabilities[capability]?.options;
      return schema
        ? (buildToolOptionsSchema(capability, schema) as unknown as Record<
            string,
            unknown
          >)
        : undefined;
    },
  };
}

export async function validateConfiguredOptions(
  config: WebMuxConfig,
): Promise<void> {
  try {
    for (const [capability, entry] of Object.entries(config.defaults ?? {})) {
      if (!entry?.provider || !entry.options) continue;
      const definition = await loadProvider(entry.provider);
      validateProviderOptions(
        definition.capabilities[capability as Capability]?.options,
        entry.options,
        entry.provider,
        capability as Capability,
      );
    }
    for (const [provider, configured] of Object.entries(
      config.providers ?? {},
    )) {
      if (!configured?.options) continue;
      const definition = await loadProvider(provider as ProviderId);
      for (const [capability, options] of Object.entries(configured.options)) {
        if (!options) continue;
        validateProviderOptions(
          definition.capabilities[capability as Capability]?.options,
          options,
          provider as ProviderId,
          capability as Capability,
        );
      }
    }
  } catch (error) {
    if (error instanceof WebMuxError && error.code === "INVALID_INPUT") {
      throw new WebMuxError("INVALID_CONFIG", error.message, { cause: error });
    }
    throw error;
  }
}

async function search(
  config: WebMuxConfig,
  cwd: string,
  request: SearchOptions,
): Promise<SearchDocument> {
  const queries = validateBatch(request.queries, "queries");
  const provider = selectProvider(config, "search", request.provider);
  const maxResults =
    request.maxResults ??
    config.defaults?.search?.maxResults ??
    DEFAULT_MAX_RESULTS;
  if (!Number.isInteger(maxResults) || maxResults <= 0) {
    throw new WebMuxError(
      "INVALID_INPUT",
      "maxResults must be a positive integer",
    );
  }
  const execution = await prepare(
    config,
    cwd,
    provider,
    "search",
    request.options,
  );
  const results = await Promise.all(
    queries.map(async (query) => {
      try {
        const value = await run(
          execution,
          {
            capability: "search",
            query,
            maxResults,
            options: execution.options,
          },
          request.signal,
          request.onProgress,
        );
        const normalized = value as ProviderResult<"search">;
        return success(
          query,
          { results: normalized.results },
          request.raw ? rawPayload(normalized) : undefined,
          execution.secretValues,
        );
      } catch (error) {
        return failure(query, error, execution.secretValues);
      }
    }),
  );
  return document("search", provider, results);
}

async function contents(
  config: WebMuxConfig,
  cwd: string,
  request: ContentsOptions,
): Promise<ContentsDocument> {
  const urls = validateUrls(request.urls);
  const provider = selectProvider(config, "contents", request.provider);
  const execution = await prepare(
    config,
    cwd,
    provider,
    "contents",
    request.options,
  );
  try {
    const value = (await run(
      execution,
      {
        capability: "contents",
        urls,
        options: execution.options,
      },
      request.signal,
      request.onProgress,
    )) as ProviderResult<"contents">;
    const remaining = [...value.answers];
    const results = urls.map((url) => {
      const matchingIndex = remaining.findIndex((answer) => answer.url === url);
      const answer = remaining.splice(
        matchingIndex >= 0 ? matchingIndex : 0,
        1,
      )[0];
      if (!answer)
        return failure(
          url,
          new WebMuxError(
            "PROVIDER_FAILURE",
            `Provider returned no content for ${url}`,
          ),
          execution.secretValues,
        );
      if (answer.error)
        return failure(
          url,
          new WebMuxError("PROVIDER_FAILURE", answer.error),
          execution.secretValues,
        );
      return success(
        url,
        answer,
        request.raw ? rawPayload(value) : undefined,
        execution.secretValues,
      );
    });
    return document("contents", provider, results);
  } catch (error) {
    return document(
      "contents",
      provider,
      urls.map((url) => failure(url, error, execution.secretValues)),
    );
  }
}

async function answer(
  config: WebMuxConfig,
  cwd: string,
  request: AnswerOptions,
): Promise<AnswerDocument> {
  const queries = validateBatch(request.queries, "queries");
  const provider = selectProvider(config, "answer", request.provider);
  const execution = await prepare(
    config,
    cwd,
    provider,
    "answer",
    request.options,
  );
  const results = await Promise.all(
    queries.map(async (query) => {
      try {
        const value = (await run(
          execution,
          {
            capability: "answer",
            query,
            options: execution.options,
          },
          request.signal,
          request.onProgress,
        )) as ProviderResult<"answer">;
        return success(
          query,
          toolOutput(value),
          request.raw ? rawPayload(value) : undefined,
          execution.secretValues,
        );
      } catch (error) {
        return failure(query, error, execution.secretValues);
      }
    }),
  );
  return document("answer", provider, results);
}

async function research(
  config: WebMuxConfig,
  cwd: string,
  request: ResearchOptions,
): Promise<ResearchDocument> {
  const input = nonEmpty(request.input, "input");
  const provider = selectProvider(config, "research", request.provider);
  const execution = await prepare(
    config,
    cwd,
    provider,
    "research",
    request.options,
  );
  try {
    const value = (await run(
      execution,
      {
        capability: "research",
        input,
        options: execution.options,
      },
      request.signal,
      request.onProgress,
    )) as ProviderResult<"research">;
    return document("research", provider, [
      success(
        input,
        toolOutput(value),
        request.raw ? rawPayload(value) : undefined,
        execution.secretValues,
      ),
    ]);
  } catch (error) {
    return document("research", provider, [
      failure(input, error, execution.secretValues),
    ]);
  }
}

interface PreparedExecution {
  provider: Awaited<ReturnType<typeof loadProvider>>;
  config: ProviderConfig;
  options: Record<string, unknown>;
  capability: Capability;
  providerId: ProviderId;
  cwd: string;
  secretValues: string[];
}

async function prepare(
  config: WebMuxConfig,
  cwd: string,
  providerId: ProviderId,
  capability: Capability,
  callOptions: Record<string, unknown> | undefined,
): Promise<PreparedExecution> {
  const provider = await loadProvider(providerId);
  if (!provider.capabilities[capability]) {
    throw new WebMuxError(
      "PROVIDER_UNAVAILABLE",
      `${PROVIDERS_BY_ID[providerId].label} does not support ${capability}`,
    );
  }
  const runtimeConfig = await buildRuntimeProviderConfig(config, providerId);
  const status = provider.getCapabilityStatus(runtimeConfig, cwd, capability, {
    resolveSecrets: true,
  });
  if (status.state !== "ready") {
    const detail =
      status.state === "invalid_config" ? `: ${status.detail}` : "";
    throw new WebMuxError(
      "PROVIDER_UNAVAILABLE",
      `${PROVIDERS_BY_ID[providerId].label} is unavailable for ${capability} (${status.state})${detail}`,
    );
  }

  const options = deepMerge(
    configuredOptions(config, providerId, capability),
    callOptions ?? {},
  );
  validateProviderOptions(
    provider.capabilities[capability]?.options,
    options,
    providerId,
    capability,
  );
  return {
    provider,
    config: runtimeConfig,
    options,
    capability,
    providerId,
    cwd,
    secretValues: collectSecretValues(
      runtimeConfig as Record<string, unknown>,
      providerId,
      capability,
    ),
  };
}

async function run(
  execution: PreparedExecution,
  request: any,
  signal: AbortSignal | undefined,
  onProgress: ((event: any) => void) | undefined,
): Promise<ProviderResult<Tool>> {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Operation aborted", "AbortError");
  return await executeProviderRequest(
    execution.provider,
    execution.config,
    request,
    {
      cwd: execution.cwd,
      signal,
      onProgress: (message) =>
        onProgress?.({
          capability: execution.capability,
          provider: execution.providerId,
          message,
        }),
    },
  );
}

function selectProvider(
  config: WebMuxConfig,
  capability: Capability,
  requested: ProviderId | undefined,
): ProviderId {
  const selected = requested ?? config.defaults?.[capability]?.provider;
  if (!selected) {
    throw new WebMuxError(
      "PROVIDER_UNAVAILABLE",
      `No provider selected for ${capability}. Compatible providers: ${compatibleProviderIds(capability).join(", ")}`,
    );
  }
  const metadata = PROVIDERS_BY_ID[selected];
  if (!metadata?.capabilities.includes(capability)) {
    throw new WebMuxError(
      "PROVIDER_UNAVAILABLE",
      `Provider '${selected}' does not support ${capability}. Compatible providers: ${compatibleProviderIds(capability).join(", ")}`,
    );
  }
  return selected;
}

function validateProviderOptions(
  schema: TSchema | undefined,
  options: Record<string, unknown>,
  provider: ProviderId,
  capability: Capability,
): void {
  if (Object.keys(options).length === 0) return;
  if (!schema) {
    if (provider === "custom") return;
    throw new WebMuxError(
      "INVALID_INPUT",
      `${provider} ${capability} does not accept provider options`,
    );
  }
  const closed = buildToolOptionsSchema(capability, schema as any) as TSchema;
  if (!Check(closed, options)) {
    const errors = Errors(closed, options)
      .slice(0, 3)
      .map((error) => `${error.instancePath || "options"}: ${error.message}`)
      .join("; ");
    throw new WebMuxError(
      "INVALID_INPUT",
      `Invalid ${provider} ${capability} options: ${errors}`,
    );
  }
}

function validateBatch(values: unknown, name: string): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new WebMuxError(
      "INVALID_INPUT",
      `${name} must contain at least one input`,
    );
  }
  if (values.length > MAX_BATCH_INPUTS) {
    throw new WebMuxError(
      "INVALID_INPUT",
      `${name} accepts at most ${MAX_BATCH_INPUTS} inputs`,
    );
  }
  return values.map((value, index) => nonEmpty(value, `${name}[${index}]`));
}

function validateUrls(values: unknown): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new WebMuxError(
      "INVALID_INPUT",
      "urls must contain at least one URL",
    );
  }
  return values.map((value, index) => {
    const url = nonEmpty(value, `urls[${index}]`);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        throw new Error();
    } catch {
      throw new WebMuxError(
        "INVALID_INPUT",
        `urls[${index}] must be an HTTP or HTTPS URL`,
      );
    }
    return url;
  });
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WebMuxError(
      "INVALID_INPUT",
      `${name} must be a non-empty string`,
    );
  }
  return value.trim();
}

function success<T>(
  input: string,
  value: T,
  raw?: unknown,
  secrets: readonly string[] = [],
): InputResult<T> {
  return {
    input,
    ok: true,
    value: sanitizeRaw(value, secrets) as T,
    ...(raw === undefined
      ? {}
      : { raw: { providerPayload: sanitizeRaw(raw, secrets) } }),
  };
}

function failure(
  input: string,
  error: unknown,
  secrets: readonly string[] = [],
): InputResult<never> {
  const normalized = asWebMuxError(error);
  return {
    input,
    ok: false,
    error: {
      ...normalized.toJSON(),
      message: redactText(normalized.message, secrets),
      ...(normalized.code === "PROVIDER_FAILURE"
        ? { retryable: isRetryableError(error) }
        : {}),
    },
  };
}

function document<T, C extends Capability>(
  capability: C,
  provider: ProviderId,
  results: Array<InputResult<T>>,
): CapabilityDocument<T, C> {
  return {
    schemaVersion: 1,
    capability,
    provider,
    status: results.every((result) => result.ok) ? "ok" : "partial",
    results,
  };
}

function toolOutput(
  value: ProviderResult<"answer"> | ProviderResult<"research">,
) {
  return {
    text: value.text,
    ...(value.itemCount === undefined ? {} : { itemCount: value.itemCount }),
    ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
  };
}

function sanitizeRaw(value: unknown, secrets: readonly string[] = []): unknown {
  const seen = new WeakSet<object>();
  const visit = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(visit);
    if (typeof entry === "string") return redactText(entry, secrets);
    if (!entry || typeof entry !== "object") return entry;
    if (seen.has(entry)) return "[Circular]";
    seen.add(entry);
    return Object.fromEntries(
      Object.entries(entry).map(([key, child]) => [
        key,
        /authorization|api[-_]?key|token|credential|password|secret|headers?/i.test(
          key,
        )
          ? "[redacted]"
          : visit(child),
      ]),
    );
  };
  return visit(value);
}

function collectSecretValues(
  config: Record<string, unknown>,
  provider: ProviderId,
  capability: Capability,
): string[] {
  const sources: unknown[] = [];
  const credentials = config.credentials as
    | Record<string, Parameters<typeof resolveConfigValue>[0]>
    | undefined;
  const requiredNames = PROVIDERS_BY_ID[provider].credentials
    .filter(
      (credential) =>
        !credential.capabilities ||
        credential.capabilities.includes(capability),
    )
    .map((credential) => credential.name);
  for (const name of requiredNames) sources.push(credentials?.[name]);
  if (provider === "codex") sources.push(credentials?.api);
  if (provider === "cloudflare") sources.push(config.accountId);

  if (provider === "custom") {
    const command = (
      config.options as Partial<
        Record<Capability, { env?: Record<string, unknown> }>
      >
    )?.[capability];
    sources.push(...Object.values(command?.env ?? {}));
  }

  return [
    ...new Set(
      sources.flatMap((source) => {
        try {
          const value = resolveConfigValue(
            source as Parameters<typeof resolveConfigValue>[0],
          );
          return value ? [value] : [];
        } catch {
          return [];
        }
      }),
    ),
  ];
}

function redactText(value: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (text, secret) =>
      secret.length > 0 ? text.split(secret).join("[redacted]") : text,
    value,
  );
}

export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    result[key] =
      isObject(existing) && isObject(value)
        ? deepMerge(existing, value)
        : structuredClone(value);
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function renderTextDocument(
  document:
    | SearchDocument
    | ContentsDocument
    | AnswerDocument
    | ResearchDocument,
): string {
  const blocks = document.results.map((result, index) => {
    const heading =
      document.results.length > 1
        ? `## ${index + 1}. ${result.input}`
        : undefined;
    if (!result.ok)
      return [heading, `Error: ${result.error?.message ?? "Unknown error"}`]
        .filter(Boolean)
        .join("\n\n");
    if (document.capability === "search") {
      const value = result.value as {
        results: Array<{ title: string; url: string; snippet: string }>;
      };
      const body =
        value.results.length === 0
          ? "No results found."
          : value.results
              .map(
                (item, itemIndex) =>
                  `${itemIndex + 1}. ${item.title}\n   ${item.url}\n   ${item.snippet}`,
              )
              .join("\n\n");
      return [heading, body].filter(Boolean).join("\n\n");
    }
    if (document.capability === "contents") {
      return [heading, renderContentsAnswers([result.value as any])]
        .filter(Boolean)
        .join("\n\n");
    }
    return [heading, (result.value as { text: string }).text]
      .filter(Boolean)
      .join("\n\n");
  });
  return blocks.join("\n\n").trim();
}
