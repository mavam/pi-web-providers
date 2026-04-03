import {
  DEFAULT_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS,
  DEFAULT_RESEARCH_POLL_INTERVAL_MS,
  DEFAULT_RESEARCH_TIMEOUT_MS,
} from "./execution-policy-defaults.js";
import {
  formatProviderDiagnostic,
  formatResearchTerminalDiagnostic,
} from "./provider-diagnostics.js";
import type {
  ExecutionSettings,
  ProviderContext,
  ProviderId,
  ResearchJob,
  ResearchPollResult,
  ToolOutput,
} from "./types.js";

const MAX_RETRY_DELAY_MS = 30000;

export interface RequestExecutionPolicy {
  requestTimeoutMs?: number;
  retryCount: number;
  retryDelayMs: number;
  retryOnTimeout?: boolean;
}

class RequestTimeoutError extends Error {
  override name = "RequestTimeoutError";
}

export interface LocalExecutionOptions {
  requestTimeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
}

export function stripLocalExecutionOptions(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!options) {
    return undefined;
  }

  const {
    requestTimeoutMs: _requestTimeoutMs,
    retryCount: _retryCount,
    retryDelayMs: _retryDelayMs,
    prefetch: _prefetch,
    ...rest
  } = options;

  return Object.keys(rest).length > 0
    ? (rest as Record<string, unknown>)
    : undefined;
}

export function parseLocalExecutionOptions(
  options: Record<string, unknown> | undefined,
): LocalExecutionOptions {
  return {
    requestTimeoutMs: parseOptionalPositiveIntegerOption(
      options,
      "requestTimeoutMs",
    ),
    retryCount: parseOptionalNonNegativeIntegerOption(options, "retryCount"),
    retryDelayMs: parseOptionalPositiveIntegerOption(options, "retryDelayMs"),
  };
}

export function resolveRequestExecutionPolicy(
  options: Record<string, unknown> | undefined,
  defaults: ExecutionSettings | undefined,
): RequestExecutionPolicy {
  const localOptions = parseLocalExecutionOptions(options);

  return {
    requestTimeoutMs:
      localOptions.requestTimeoutMs ?? defaults?.requestTimeoutMs,
    retryCount: localOptions.retryCount ?? defaults?.retryCount ?? 0,
    retryDelayMs: localOptions.retryDelayMs ?? defaults?.retryDelayMs ?? 2000,
  };
}

export async function runWithExecutionPolicy<T>(
  label: string,
  operation: (context: ProviderContext) => Promise<T>,
  settings: RequestExecutionPolicy,
  context: ProviderContext,
): Promise<T> {
  const maxAttempts = Math.max(1, settings.retryCount + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(context.signal);

    const {
      context: attemptContext,
      abort,
      cleanup,
    } = createAttemptContext(context);

    try {
      const result = operation(attemptContext);
      const timeoutMessage =
        settings.requestTimeoutMs === undefined
          ? undefined
          : `${label} timed out after ${formatDuration(settings.requestTimeoutMs)}.`;
      return await withAbortAndOptionalTimeout(
        result,
        settings.requestTimeoutMs,
        context.signal,
        timeoutMessage,
        timeoutMessage
          ? () => abort(new RequestTimeoutError(timeoutMessage))
          : undefined,
      );
    } catch (error) {
      if (!shouldRetryError(error, settings) || attempt >= maxAttempts) {
        throw error;
      }

      const delayMs = Math.min(
        settings.retryDelayMs * 2 ** (attempt - 1),
        MAX_RETRY_DELAY_MS,
      );
      context.onProgress?.(
        `${label} failed (${formatErrorMessage(error)}). Retrying in ${formatDuration(delayMs)} (attempt ${attempt + 1}/${maxAttempts}).`,
      );
      await sleep(delayMs, context.signal);
    } finally {
      cleanup();
    }
  }

  throw new Error(`${label} failed.`);
}

export async function executeAsyncResearch({
  providerLabel,
  providerId,
  context,
  pollIntervalMs = DEFAULT_RESEARCH_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_RESEARCH_TIMEOUT_MS,
  maxConsecutivePollErrors = DEFAULT_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS,
  start,
  poll,
}: {
  providerLabel: string;
  providerId: ProviderId;
  context: ProviderContext;
  pollIntervalMs?: number;
  timeoutMs?: number;
  maxConsecutivePollErrors?: number;
  start: (context: ProviderContext) => Promise<ResearchJob>;
  poll: (id: string, context: ProviderContext) => Promise<ResearchPollResult>;
}): Promise<ToolOutput> {
  const timeoutMessage = `${providerLabel} research exceeded ${formatDuration(timeoutMs)}.`;
  const deadline = createDeadlineSignal(
    context.signal,
    timeoutMs,
    timeoutMessage,
  );
  const researchContext: ProviderContext = {
    ...context,
    signal: deadline.signal,
  };
  let lastStatus: ResearchPollResult["status"] | undefined;
  let lastProgressStatus: string | undefined;
  const startedAt = Date.now();

  try {
    researchContext.onProgress?.(`Starting research via ${providerLabel}`);
    const job = await withAbortAndOptionalTimeout(
      start(researchContext),
      undefined,
      researchContext.signal,
      undefined,
    );
    const jobId = job.id;

    if (!jobId) {
      throw new Error(`${providerLabel} research did not return a job id.`);
    }

    researchContext.onProgress?.(`${providerLabel} research started: ${jobId}`);

    let consecutivePollErrors = 0;

    while (true) {
      throwIfAborted(
        researchContext.signal,
        `${providerLabel} research aborted.`,
      );

      try {
        const result = await withAbortAndOptionalTimeout(
          poll(jobId, researchContext),
          undefined,
          researchContext.signal,
          undefined,
        );
        consecutivePollErrors = 0;

        const progressStatus = result.statusText ?? result.status;
        if (
          result.status !== lastStatus ||
          progressStatus !== lastProgressStatus
        ) {
          researchContext.onProgress?.(
            `Research via ${providerLabel}: ${progressStatus} (${formatElapsed(Date.now() - startedAt)} elapsed)`,
          );
          lastStatus = result.status;
          lastProgressStatus = progressStatus;
        }

        if (result.status === "completed") {
          return (
            result.output ?? {
              provider: providerId,
              text: `${providerLabel} research completed without textual output.`,
            }
          );
        }

        if (result.status === "failed" || result.status === "cancelled") {
          throw new Error(
            formatResearchTerminalDiagnostic(
              providerLabel,
              result.status,
              result.error,
            ),
          );
        }
      } catch (error) {
        if (isAbortErrorFromSignal(researchContext.signal, error)) {
          throw error;
        }
        if (!isRetryableError(error)) {
          throw normalizeError(error);
        }

        consecutivePollErrors += 1;
        if (consecutivePollErrors >= maxConsecutivePollErrors) {
          throw new Error(
            `${providerLabel} research polling failed too many times in a row: ${formatErrorMessage(error)}`,
          );
        }

        researchContext.onProgress?.(
          `${providerLabel} research poll is still retrying after transient errors (${consecutivePollErrors}/${maxConsecutivePollErrors} consecutive poll failures). Background job id: ${jobId}`,
        );
      }

      await sleep(pollIntervalMs, researchContext.signal);
    }
  } catch (error) {
    if (isAbortErrorFromSignal(researchContext.signal, error)) {
      throw new Error(
        formatProviderDiagnostic(providerLabel, formatErrorMessage(error)),
      );
    }

    throw new Error(
      formatProviderDiagnostic(providerLabel, formatErrorMessage(error)),
    );
  } finally {
    deadline.cleanup();
  }
}

function shouldRetryError(
  error: unknown,
  settings: Pick<RequestExecutionPolicy, "retryOnTimeout">,
): boolean {
  if (error instanceof RequestTimeoutError) {
    return settings.retryOnTimeout === true;
  }

  return isRetryableError(error);
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof RequestTimeoutError) {
    return false;
  }

  const message = formatErrorMessage(error).toLowerCase();
  if (!message || message === "operation aborted.") {
    return false;
  }

  return /429|500|502|503|504|deadline exceeded|econnreset|ecanceled|ehostunreach|eai_again|enotfound|etimedout|fetch failed|gateway timeout|internal error|network|overloaded|rate limit|resource exhausted|socket hang up|temporarily unavailable|timeout|unavailable/.test(
    message,
  );
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${totalSeconds}s`;
}

export function formatDuration(ms: number): string {
  if (ms >= 60000) {
    return formatElapsed(ms);
  }

  if (ms >= 1000) {
    return `${Math.floor(ms / 1000)}s`;
  }

  return `${ms}ms`;
}

export async function sleep(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(getAbortError(signal));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function throwIfAborted(
  signal: AbortSignal | undefined,
  message = "Operation aborted.",
): void {
  if (signal?.aborted) {
    throw getAbortError(signal, message);
  }
}

function createAttemptContext(context: ProviderContext): {
  context: ProviderContext;
  abort: (reason?: unknown) => void;
  cleanup: () => void;
} {
  const controller = new AbortController();

  if (context.signal?.aborted) {
    controller.abort(getAbortError(context.signal));
  }

  const onAbort = () => {
    controller.abort(getAbortError(context.signal));
  };

  context.signal?.addEventListener("abort", onAbort, { once: true });

  return {
    context: {
      ...context,
      signal: controller.signal,
    },
    abort: (reason?: unknown) => controller.abort(reason),
    cleanup: () => context.signal?.removeEventListener("abort", onAbort),
  };
}

async function withAbortAndOptionalTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  message: string | undefined,
  onTimeout?: () => void,
): Promise<T> {
  if (timeoutMs === undefined && !signal) {
    return await promise;
  }

  throwIfAborted(signal);

  return await new Promise<T>((resolve, reject) => {
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            onTimeout?.();
            cleanup();
            reject(
              new RequestTimeoutError(
                message ??
                  `Operation timed out after ${formatDuration(timeoutMs)}.`,
              ),
            );
          }, timeoutMs);

    const onAbort = () => {
      cleanup();
      reject(getAbortError(signal));
    };

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function getAbortError(
  signal: AbortSignal | undefined,
  message = "Operation aborted.",
): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === "string" && reason.length > 0) {
    return new Error(reason);
  }
  return new Error(message);
}

function isAbortErrorFromSignal(
  signal: AbortSignal | undefined,
  error: unknown,
): boolean {
  return signal?.aborted === true && signal.reason === error;
}

function createDeadlineSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string,
): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
} {
  const controller = new AbortController();

  if (signal?.aborted) {
    controller.abort(getAbortError(signal));
  }

  const onAbort = () => {
    controller.abort(getAbortError(signal));
  };

  signal?.addEventListener("abort", onAbort, { once: true });

  const timer = setTimeout(() => {
    controller.abort(new RequestTimeoutError(timeoutMessage));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(formatErrorMessage(error));
}

function parseOptionalPositiveIntegerOption(
  options: Record<string, unknown> | undefined,
  key: keyof Pick<LocalExecutionOptions, "requestTimeoutMs" | "retryDelayMs">,
): number | undefined {
  const value = options?.[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`options.${key} must be a positive integer.`);
  }

  return value;
}

function parseOptionalNonNegativeIntegerOption(
  options: Record<string, unknown> | undefined,
  key: "retryCount",
): number | undefined {
  const value = options?.[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`options.${key} must be a non-negative integer.`);
  }

  return value;
}
