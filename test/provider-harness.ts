import type { ProviderDefinition } from "../src/providers/definition.js";
import { executeProviderCapability } from "../src/providers/definition.js";
import type {
  ProviderConfig,
  ProviderContext,
  ProviderId,
  Tool,
} from "../src/types.js";

type AnyProvider = ProviderDefinition<
  ProviderId,
  ProviderConfig,
  Partial<Record<Tool, any>>
>;

export function providerHarness(provider: AnyProvider): any {
  return {
    id: provider.id,
    label: provider.label,
    docsUrl: provider.docsUrl,
    createTemplate: provider.config.createTemplate,
    getCapabilityStatus: provider.getCapabilityStatus,
    getToolOptionsSchema: (capability: Tool) =>
      provider.capabilities[capability]?.options,
    ...(provider.capabilities.search
      ? {
          search: async (
            query: string,
            maxResults: number,
            config: ProviderConfig,
            context: ProviderContext,
            options?: Record<string, unknown>,
          ) =>
            await executeProviderCapability(
              provider,
              "search",
              { query, maxResults, options },
              { ...context, config },
            ),
        }
      : {}),
    ...(provider.capabilities.contents
      ? {
          contents: async (
            urls: string[],
            config: ProviderConfig,
            context: ProviderContext,
            options?: Record<string, unknown>,
          ) =>
            await executeProviderCapability(
              provider,
              "contents",
              { urls, options },
              { ...context, config },
            ),
        }
      : {}),
    ...(provider.capabilities.answer
      ? {
          answer: async (
            query: string,
            config: ProviderConfig,
            context: ProviderContext,
            options?: Record<string, unknown>,
          ) =>
            await executeProviderCapability(
              provider,
              "answer",
              { query, options },
              { ...context, config },
            ),
        }
      : {}),
    ...(provider.capabilities.research
      ? {
          research: async (
            input: string,
            config: ProviderConfig,
            context: ProviderContext,
            options?: Record<string, unknown>,
          ) =>
            await executeProviderCapability(
              provider,
              "research",
              { input, options },
              { ...context, config },
            ),
        }
      : {}),
  };
}
