import type { TObject } from "typebox";
import type {
  ProviderAdapter,
  ProviderConfig,
  ProviderContext,
  ProviderId,
  ProviderResult,
  Tool,
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

export interface ProviderConfigDefinition<TConfig> {
  createTemplate: () => TConfig;
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
    },
    capabilities: buildAdapterCapabilities(adapter),
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
