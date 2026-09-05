import type { Capability } from "../src/domain.js";
import type { ProviderDefinition } from "../src/providers/definition.js";
import type {
  ProviderConfig,
  ProviderContext,
} from "../src/providers/contract.js";

/** Convenience for retained SDK normalization tests; production has no legacy facade. */
export function providerHarness(provider: ProviderDefinition): any {
  const execute = async (
    capability: Capability,
    input: object,
    config: ProviderConfig,
    context: ProviderContext,
  ) => {
    const adapter = await provider.load();
    const method = adapter[capability];
    if (!method) throw new Error(`Unsupported ${capability}`);
    return await method(
      { capability, ...input } as never,
      config as never,
      context,
    );
  };
  return {
    id: provider.id,
    getToolOptionsSchema: (capability: Capability) =>
      provider.capabilities[capability]?.options,
    search: (
      query: string,
      maxResults: number,
      config: ProviderConfig,
      context: ProviderContext,
      options?: Record<string, unknown>,
    ) => execute("search", { query, maxResults, options }, config, context),
    contents: (
      urls: string[],
      config: ProviderConfig,
      context: ProviderContext,
      options?: Record<string, unknown>,
    ) => execute("contents", { urls, options }, config, context),
    answer: (
      query: string,
      config: ProviderConfig,
      context: ProviderContext,
      options?: Record<string, unknown>,
    ) => execute("answer", { query, options }, config, context),
    research: (
      input: string,
      config: ProviderConfig,
      context: ProviderContext,
      options?: Record<string, unknown>,
    ) => execute("research", { input, options }, config, context),
  };
}
