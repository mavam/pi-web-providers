import type { TObject } from "typebox";
import type { ContentsResponse } from "../contents.js";
import type {
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderConfig,
  ProviderContext,
  ProviderId,
  ProviderResult,
  SearchResponse,
  Tool,
  ToolOutput,
} from "../types.js";

export type SearchInput = {
  query: string;
  maxResults: number;
};

export type ContentsInput = {
  urls: string[];
};

export type AnswerInput = {
  query: string;
};

export type ResearchInput = {
  input: string;
};

export type CapabilityInput<TInput extends object, TOptions> = TInput &
  (TOptions extends undefined ? object : { options?: TOptions });

export interface CapabilityLimits {
  maxResults?: number;
}

export interface CapabilityDefinition<
  TInput extends object,
  TOptions extends object | undefined = undefined,
  TResult = unknown,
> {
  options?: TObject;
  limits?: CapabilityLimits;
  execute(
    input: CapabilityInput<TInput, TOptions>,
    context: ProviderExecutionContext,
  ): Promise<TResult>;
}

export interface ProviderExecutionContext extends ProviderContext {
  config: ProviderConfig;
}

export type ProviderConfigField =
  | "accountId"
  | "apiKey"
  | "apiToken"
  | "baseUrl"
  | "codexPath"
  | "config"
  | "customOptions"
  | "env"
  | "options"
  | "pathToClaudeCodeExecutable"
  | "settings";

export interface ProviderConfigDefinition<TConfig> {
  createTemplate: () => TConfig;
  fields: readonly ProviderConfigField[];
  optionCapabilities?: readonly Tool[];
}

export interface ProviderDefinition<
  TId extends string,
  TConfig,
  TCapabilities extends Partial<Record<Tool, CapabilityDefinition<object>>>,
> {
  id: TId;
  label: string;
  docsUrl: string;
  config: ProviderConfigDefinition<TConfig>;
  capabilities: TCapabilities;
  getCapabilityStatus(
    config: TConfig | undefined,
    cwd: string,
    tool?: Tool,
  ): ProviderCapabilityStatus;
  adapter?: ProviderAdapter;
}

export type ProviderRegistry = Record<
  ProviderId,
  ProviderDefinition<
    ProviderId,
    ProviderConfig,
    Partial<Record<Tool, CapabilityDefinition<object>>>
  >
>;

export function defineCapability<
  TInput extends object,
  TOptions extends object | undefined = undefined,
  TResult = unknown,
>(
  definition: CapabilityDefinition<TInput, TOptions, TResult>,
): CapabilityDefinition<TInput, TOptions, TResult> {
  return definition;
}

export function defineProvider<
  const TId extends string,
  TConfig,
  const TCapabilities extends Partial<
    Record<Tool, CapabilityDefinition<object>>
  >,
>(
  definition: ProviderDefinition<TId, TConfig, TCapabilities>,
): ProviderDefinition<TId, TConfig, TCapabilities> {
  return definition;
}

export function defineProviders<const TProviders extends ProviderRegistry>(
  providers: TProviders,
): TProviders {
  return providers;
}

export function wrapAdapter<TProviderId extends ProviderId>(
  adapter: ProviderAdapter<TProviderId>,
  config: Pick<
    ProviderConfigDefinition<ProviderConfig<TProviderId>>,
    "fields" | "optionCapabilities"
  >,
): ProviderDefinition<
  TProviderId,
  ProviderConfig<TProviderId>,
  Partial<Record<Tool, CapabilityDefinition<object>>>
> {
  return defineProvider({
    id: adapter.id,
    label: adapter.label,
    docsUrl: adapter.docsUrl,
    config: {
      createTemplate: () => adapter.createTemplate(),
      fields: config.fields,
      optionCapabilities: config.optionCapabilities,
    },
    capabilities: buildAdapterCapabilities(adapter),
    getCapabilityStatus: (config, cwd, tool) =>
      adapter.getCapabilityStatus(config as never, cwd, tool),
    adapter,
  });
}

function buildAdapterCapabilities(
  adapter: ProviderAdapter,
): Partial<Record<Tool, CapabilityDefinition<object>>> {
  const capabilities: Partial<Record<Tool, CapabilityDefinition<object>>> = {};

  if (adapter.search) {
    capabilities.search = defineCapability({
      options: adapter.getToolOptionsSchema?.("search"),
      async execute(input, context) {
        const { query, maxResults, options } = input as SearchInput & {
          options?: Record<string, unknown>;
        };
        return await adapter.search!(
          query,
          maxResults,
          context.config as never,
          context,
          options,
        );
      },
    }) as CapabilityDefinition<object>;
  }

  if (adapter.contents) {
    capabilities.contents = defineCapability({
      options: adapter.getToolOptionsSchema?.("contents"),
      async execute(input, context) {
        const { urls, options } = input as ContentsInput & {
          options?: Record<string, unknown>;
        };
        return await adapter.contents!(
          urls,
          context.config as never,
          context,
          options,
        );
      },
    }) as CapabilityDefinition<object>;
  }

  if (adapter.answer) {
    capabilities.answer = defineCapability({
      options: adapter.getToolOptionsSchema?.("answer"),
      async execute(input, context) {
        const { query, options } = input as AnswerInput & {
          options?: Record<string, unknown>;
        };
        return await adapter.answer!(
          query,
          context.config as never,
          context,
          options,
        );
      },
    }) as CapabilityDefinition<object>;
  }

  if (adapter.research) {
    capabilities.research = defineCapability({
      options: adapter.getToolOptionsSchema?.("research"),
      async execute(input, context) {
        const { input: researchInput, options } = input as ResearchInput & {
          options?: Record<string, unknown>;
        };
        return await adapter.research!(
          researchInput,
          context.config as never,
          context,
          options,
        );
      },
    }) as CapabilityDefinition<object>;
  }

  return capabilities;
}

export function adapterFromProvider<TProviderId extends ProviderId>(
  definition: ProviderDefinition<
    TProviderId,
    ProviderConfig<TProviderId>,
    Partial<Record<Tool, CapabilityDefinition<object>>>
  >,
): ProviderAdapter<TProviderId> {
  return {
    id: definition.id,
    label: definition.label,
    docsUrl: definition.docsUrl,
    createTemplate: definition.config.createTemplate,
    getCapabilityStatus: definition.getCapabilityStatus,
    getToolOptionsSchema: (capability) =>
      definition.capabilities[capability]?.options,
    ...(definition.capabilities.search
      ? {
          search: async (query, maxResults, config, context, options) =>
            (await executeProviderCapability(
              definition,
              "search",
              { query, maxResults, options },
              { ...context, config },
            )) as SearchResponse,
        }
      : {}),
    ...(definition.capabilities.contents
      ? {
          contents: async (urls, config, context, options) =>
            (await executeProviderCapability(
              definition,
              "contents",
              { urls, options },
              { ...context, config },
            )) as ContentsResponse,
        }
      : {}),
    ...(definition.capabilities.answer
      ? {
          answer: async (query, config, context, options) =>
            (await executeProviderCapability(
              definition,
              "answer",
              { query, options },
              { ...context, config },
            )) as ToolOutput,
        }
      : {}),
    ...(definition.capabilities.research
      ? {
          research: async (input, config, context, options) =>
            (await executeProviderCapability(
              definition,
              "research",
              { input, options },
              { ...context, config },
            )) as ToolOutput,
        }
      : {}),
  };
}

export async function executeProviderCapability<TTool extends Tool>(
  definition: ProviderDefinition<
    ProviderId,
    ProviderConfig,
    Partial<Record<Tool, CapabilityDefinition<object>>>
  >,
  capability: TTool,
  input: object,
  context: ProviderExecutionContext,
): Promise<ProviderResult<TTool>> {
  const handler = definition.capabilities[capability];
  if (!handler) {
    throw new Error(
      `Provider '${definition.id}' does not support '${capability}'.`,
    );
  }
  return (await handler.execute(input, context)) as ProviderResult<TTool>;
}
