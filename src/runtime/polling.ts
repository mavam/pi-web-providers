import { asWebfoxError, WebfoxError } from "../errors.js";
import type {
  ProviderContext,
  ProviderId,
  ResearchJob,
  ResearchPollResult,
  ToolOutput,
} from "../providers/contract.js";
import { sleep, withSignal } from "./lifecycle.js";
import { formatDuration } from "./duration.js";
export { sleep } from "./lifecycle.js";

/** Shared provider polling mechanics. The runtime supplies the overall signal.
 * Job creation is performed exactly once; only transient polling is repeated.
 */
export async function executeAsyncResearch({
  providerLabel,
  providerId,
  context,
  pollIntervalMs = 3000,
  start,
  poll,
}: {
  providerLabel: string;
  providerId: ProviderId;
  context: ProviderContext;
  pollIntervalMs?: number;
  start: (context: ProviderContext) => Promise<ResearchJob>;
  poll: (id: string, context: ProviderContext) => Promise<ResearchPollResult>;
}): Promise<ToolOutput> {
  context.signal?.throwIfAborted();
  const startedAt = Date.now();
  context.onProgress?.(`Submitting research to ${providerLabel}.`);
  const job = await withSignal(start(context), context.signal);
  if (!job.id)
    throw new WebfoxError(
      "PROVIDER_FAILURE",
      `${providerLabel} returned no research job id.`,
    );
  context.onProgress?.(
    `${providerLabel} accepted the request; waiting for the report.`,
  );
  let errors = 0;
  let lastStatus = "in_progress";
  let lastUpdate = Date.now();
  while (true) {
    context.signal?.throwIfAborted();
    let result: ResearchPollResult;
    try {
      result = await withSignal(poll(job.id, context), context.signal);
      errors = 0;
    } catch (error) {
      if (context.signal?.aborted) throw context.signal.reason;
      const normalized = asWebfoxError(error);
      if (
        !normalized.options.retryable ||
        ++errors > (context.retryPolicy?.retries ?? 0)
      )
        throw normalized;
      const delayMs = Math.min(
        (context.retryPolicy?.delayMs ?? 2000) * 2 ** (errors - 1),
        30_000,
      );
      context.onProgress?.(
        `${providerLabel} status check failed; retrying in ${formatDuration(delayMs)} (retry ${errors}/${context.retryPolicy?.retries ?? 0}).`,
      );
      await sleep(delayMs, context.signal);
      continue;
    }
    // Terminal status is represented by the final result, not another
    // running/progress line immediately before a success or error message.
    if (result.status === "completed")
      return (
        result.output ?? {
          provider: providerId,
          text: `${providerLabel} research completed without textual output.`,
        }
      );
    if (result.status === "failed" || result.status === "cancelled")
      throw new WebfoxError(
        result.status === "cancelled" ? "CANCELLED" : "PROVIDER_FAILURE",
        `${providerLabel} research ${result.status}${result.error ? `: ${result.error}` : "."}`,
        { retryable: false },
      );
    const status = result.statusText ?? result.status;
    const now = Date.now();
    if (status !== lastStatus || now - lastUpdate >= 30_000) {
      const detail =
        status === "in_progress"
          ? "is still running"
          : `status: ${status.replaceAll("_", " ")}`;
      context.onProgress?.(
        `${providerLabel} research ${detail} (${formatDuration(now - startedAt)} elapsed).`,
      );
      lastStatus = status;
      lastUpdate = now;
    }
    await sleep(pollIntervalMs, context.signal);
  }
}
