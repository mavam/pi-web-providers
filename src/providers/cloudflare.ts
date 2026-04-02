import { type TObject, Type } from "@sinclair/typebox";
import CloudflareClient from "cloudflare";
import { resolveConfigValue } from "../config.js";
import type { ContentsResponse } from "../contents.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import type {
  Cloudflare,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  ProviderRequest,
  Tool,
} from "../types.js";
import { buildProviderPlan } from "./framework.js";
import { literalUnion } from "./schema.js";
import { asJsonObject } from "./shared.js";

type CloudflareAdapter = ProviderAdapter<Cloudflare> & {
  contents(
    urls: string[],
    config: Cloudflare,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse>;
};

const cloudflareContentsOptionsSchema = Type.Object(
  {
    gotoOptions: Type.Optional(
      Type.Object(
        {
          waitUntil: Type.Optional(
            literalUnion(
              ["load", "domcontentloaded", "networkidle0", "networkidle2"],
              { description: "When to consider navigation complete." },
            ),
          ),
        },
        { description: "Navigation options." },
      ),
    ),
  },
  { description: "Cloudflare Browser Rendering options." },
);

export const cloudflareAdapter: CloudflareAdapter = {
  id: "cloudflare",
  label: "Cloudflare",
  docsUrl:
    "https://developers.cloudflare.com/browser-rendering/rest-api/markdown-endpoint/",
  tools: ["contents"] as const,

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "contents":
        return cloudflareContentsOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Cloudflare {
    return {
      apiToken: "CLOUDFLARE_API_TOKEN",
      accountId: "CLOUDFLARE_ACCOUNT_ID",
      options: {
        gotoOptions: {
          waitUntil: "networkidle0",
        },
      },
    };
  },

  getCapabilityStatus(
    config: Cloudflare | undefined,
  ): ProviderCapabilityStatus {
    if (!resolveConfigValue(config?.apiToken)) {
      return { state: "missing_api_key" };
    }
    if (!resolveConfigValue(config?.accountId)) {
      return { state: "invalid_config", detail: "Missing account ID" };
    }
    return { state: "ready" };
  },

  buildPlan(request: ProviderRequest, config: Cloudflare) {
    return buildProviderPlan({
      request,
      config,
      providerId: cloudflareAdapter.id,
      providerLabel: cloudflareAdapter.label,
      handlers: {
        contents: {
          execute: (
            contentsRequest,
            providerConfig: Cloudflare,
            context: ProviderContext,
          ) =>
            cloudflareAdapter.contents(
              contentsRequest.urls,
              providerConfig,
              context,
              contentsRequest.options,
            ),
        },
      },
    });
  },

  async contents(
    urls: string[],
    config: Cloudflare,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = createClient(config);
    const accountId = resolveConfigValue(config.accountId);
    if (!accountId) {
      throw new Error("is missing an account ID");
    }

    const defaults = stripLocalExecutionOptions(asJsonObject(config.options));

    const answers = await Promise.all(
      urls.map(async (url) => {
        try {
          const markdown = await client.browserRendering.markdown.create(
            {
              ...(defaults ?? {}),
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
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    return {
      provider: cloudflareAdapter.id,
      answers,
    };
  },
};

function createClient(config: Cloudflare): CloudflareClient {
  const apiToken = resolveConfigValue(config.apiToken);
  if (!apiToken) {
    throw new Error("is missing an API token");
  }

  return new CloudflareClient({
    apiToken,
  });
}

function buildRequestOptions(
  context: ProviderContext,
): { signal: AbortSignal } | undefined {
  return context.signal ? { signal: context.signal } : undefined;
}
