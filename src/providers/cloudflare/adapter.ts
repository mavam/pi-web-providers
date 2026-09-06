import { asWebfoxError } from "../../errors.js";
import { orderedContents } from "../../contents.js";
import CloudflareClient from "cloudflare";

import type { ContentsResponse } from "../../contents.js";
import type { ProviderContext } from "../contract.js";
import type { Cloudflare } from "./types.js";

const cloudflareImplementation = {
  async contents(
    urls: string[],
    config: Cloudflare,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = createClient(config);
    const accountId = config.accountId;
    if (!accountId) {
      throw new Error("is missing an account ID");
    }

    const answers = await Promise.all(
      urls.map(async (url) => {
        try {
          const markdown = await client.browserRendering.markdown.create(
            {
              ...(options ?? {}),
              account_id: accountId,
              url,
            } as never,
            buildRequestOptions(context),
          );

          return {
            url,
            content: markdown,
          };
        } catch (error) {
          return {
            url,
            error: asWebfoxError(error).toJSON(),
          };
        }
      }),
    );

    return {
      provider: "cloudflare",
      answers,
    };
  },
};

function createClient(config: Cloudflare): CloudflareClient {
  const apiToken = config.credentials?.api;
  if (!apiToken) {
    throw new Error("is missing an API token");
  }

  return new CloudflareClient({
    maxRetries: 0,
    apiToken,
  });
}

function buildRequestOptions(
  context: ProviderContext,
): { signal: AbortSignal } | undefined {
  return context.signal ? { signal: context.signal } : undefined;
}

export const adapter = {
  async contents(
    input: import("../contract.js").ProviderRequest<"contents">,
    config: Cloudflare,
    context: ProviderContext,
  ) {
    return orderedContents(
      await cloudflareImplementation.contents(
        input.urls,
        config,
        context,
        input.options,
      ),
    );
  },
};
