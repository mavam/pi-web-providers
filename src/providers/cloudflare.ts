import { resolveConfigValue } from "../config.js";
import { createSilentForegroundPlan } from "../provider-plans.js";
import type {
  CloudflareProviderConfig,
  JsonValue,
  ProviderContentsMetadataEntry,
  ProviderContext,
  ProviderOperationRequest,
  ProviderStatus,
  ProviderToolOutput,
  WebProvider,
} from "../types.js";
import { normalizeContentText, pushIndentedBlock } from "./shared.js";

const CF_API_BASE =
  "https://api.cloudflare.com/client/v4/accounts/{accountId}/browser-rendering/markdown";

export class CloudflareProvider
  implements WebProvider<CloudflareProviderConfig>
{
  readonly id: "cloudflare" = "cloudflare";
  readonly label = "Cloudflare";
  readonly docsUrl =
    "https://developers.cloudflare.com/browser-rendering/rest-api/";
  readonly capabilities = ["contents"] as const;

  createTemplate(): CloudflareProviderConfig {
    return {
      enabled: false,
      apiToken: "CLOUDFLARE_API_TOKEN",
      accountId: "CLOUDFLARE_ACCOUNT_ID",
    };
  }

  getStatus(config: CloudflareProviderConfig | undefined): ProviderStatus {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    const apiToken = resolveConfigValue(config.apiToken);
    if (!apiToken) {
      return { available: false, summary: "missing apiToken" };
    }
    const accountId = resolveConfigValue(config.accountId);
    if (!accountId) {
      return { available: false, summary: "missing accountId" };
    }
    return { available: true, summary: "enabled" };
  }

  buildPlan(
    request: ProviderOperationRequest,
    config: CloudflareProviderConfig,
  ) {
    if (request.capability !== "contents") {
      return null;
    }
    return createSilentForegroundPlan({
      config,
      capability: request.capability,
      providerId: this.id,
      providerLabel: this.label,
      execute: (context: ProviderContext) =>
        this.contents(request.urls, config, context),
    });
  }

  async contents(
    urls: string[],
    config: CloudflareProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const apiToken = resolveConfigValue(config.apiToken);
    if (!apiToken) {
      throw new Error("Cloudflare is missing an API token.");
    }
    const accountId = resolveConfigValue(config.accountId);
    if (!accountId) {
      throw new Error("Cloudflare is missing an account ID.");
    }

    const endpoint = CF_API_BASE.replace("{accountId}", accountId);
    const timeoutMs = config.native?.requestTimeoutMs ?? 30_000;

    context.onProgress?.(
      `Fetching contents from Cloudflare for ${urls.length} URL(s)`,
    );

    const lines: string[] = [];
    const contentsEntries: ProviderContentsMetadataEntry[] = [];
    let successCount = 0;

    for (const url of urls) {
      context.onProgress?.(`Fetching: ${url}`);

      try {
        const controller = new AbortController();
        const combinedSignal = context.signal
          ? anySignal([context.signal, controller.signal])
          : controller.signal;

        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken}`,
          },
          body: JSON.stringify({ url }),
          signal: combinedSignal,
        });

        clearTimeout(timer);

        const json = (await response.json()) as {
          success?: boolean;
          result?: string;
          errors?: Array<{ message?: string }>;
        };

        if (json.success && json.result) {
          const body = normalizeContentText(json.result);
          const title = extractTitleFromMarkdown(json.result) ?? url;
          const entryLines = [
            `${successCount + 1}. ${title}`,
            `   ${url}`,
          ];
          pushIndentedBlock(entryLines, body);
          lines.push(...entryLines, "");

          contentsEntries.push({
            url,
            title,
            body,
            summary: "1 content result via Cloudflare",
            status: "ready",
          });
          successCount++;
        } else {
          const errorMessage =
            json.errors?.[0]?.message ?? `HTTP ${response.status}`;
          lines.push(`Error: ${url}`, `   ${errorMessage}`, "");
          contentsEntries.push({
            url,
            title: url,
            body: errorMessage,
            status: "failed",
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        lines.push(`Error: ${url}`, `   ${message}`, "");
        contentsEntries.push({
          url,
          title: url,
          body: message,
          status: "failed",
        });
      }
    }

    return {
      provider: this.id,
      text: lines.join("\n").trimEnd() || "No contents extracted.",
      summary: `${successCount} of ${urls.length} URL(s) extracted via Cloudflare`,
      itemCount: successCount,
      metadata: {
        contentsEntries: contentsEntries as unknown as JsonValue,
      },
    };
  }
}

/** Extract the first markdown heading as a title hint. */
function extractTitleFromMarkdown(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}

/**
 * Combine multiple AbortSignals so that aborting any one aborts the returned
 * signal. Uses the native `AbortSignal.any` when available (Node 20+),
 * otherwise falls back to a manual listener approach.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if ("any" in AbortSignal && typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}
