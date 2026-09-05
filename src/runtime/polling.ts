import { asWebMuxError, WebMuxError } from "../errors.js";
import type {
  ProviderContext,
  ProviderId,
  ResearchJob,
  ResearchPollResult,
  ToolOutput,
} from "../providers/contract.js";
import { sleep, withSignal } from "./lifecycle.js";
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
  context.onProgress?.(`Starting research via ${providerLabel}`);
  const job = await withSignal(start(context), context.signal);
  if (!job.id)
    throw new WebMuxError(
      "PROVIDER_FAILURE",
      `${providerLabel} returned no research job id.`,
    );
  context.onProgress?.(`${providerLabel} research started: ${job.id}`);
  let errors = 0;
  let lastStatus = "";
  while (true) {
    context.signal?.throwIfAborted();
    let result: ResearchPollResult;
    try {
      result = await withSignal(poll(job.id, context), context.signal);
      errors = 0;
    } catch (error) {
      if (context.signal?.aborted) throw context.signal.reason;
      const normalized = asWebMuxError(error);
      if (
        !normalized.options.retryable ||
        ++errors > (context.retryPolicy?.retries ?? 0)
      )
        throw normalized;
      context.onProgress?.(
        `${providerLabel} research poll retry ${errors}; job ${job.id}.`,
      );
      await sleep(
        Math.min(
          (context.retryPolicy?.delayMs ?? 2000) * 2 ** (errors - 1),
          30_000,
        ),
        context.signal,
      );
      continue;
    }
    const status = result.statusText ?? result.status;
    if (status !== lastStatus) {
      context.onProgress?.(`Research via ${providerLabel}: ${status}`);
      lastStatus = status;
    }
    if (result.status === "completed")
      return (
        result.output ?? {
          provider: providerId,
          text: `${providerLabel} research completed without textual output.`,
        }
      );
    if (result.status === "failed" || result.status === "cancelled")
      throw new WebMuxError(
        result.status === "cancelled" ? "CANCELLED" : "PROVIDER_FAILURE",
        `${providerLabel} research ${result.status}${result.error ? `: ${result.error}` : "."}`,
        { retryable: false },
      );
    await sleep(pollIntervalMs, context.signal);
  }
}
