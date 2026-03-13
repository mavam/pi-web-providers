import type {
  GeminiProviderConfig,
  JsonObject,
  ProviderContext,
  ProviderId,
  ProviderResearchJob,
  ProviderResearchPollResult,
  ProviderToolOutput,
} from "./types.js";

const DEFAULT_RESEARCH_POLL_INTERVAL_MS = 3000;
const MAX_RETRY_DELAY_MS = 30000;

export interface RequestExecutionPolicy {
  requestTimeoutMs?: number;
  retryCount: number;
  retryDelayMs: number;
  retryOnTimeout?: boolean;
}

export interface ResearchExecutionPolicy extends RequestExecutionPolicy {
  pollIntervalMs: number;
  timeoutMs?: number;
  maxConsecutivePollErrors: number;
  resumeId?: string;
}

class RequestTimeoutError extends Error {
  override name = "RequestTimeoutError";
}

class NonResumableResearchError extends Error {
  override name = "NonResumableResearchError";
}

export function stripLocalExecutionOptions(
  options: JsonObject | undefined,
): JsonObject | undefined {
  if (!options) {
    return undefined;
  }

  const {
    requestTimeoutMs: _requestTimeoutMs,
    retryCount: _retryCount,
    retryDelayMs: _retryDelayMs,
    pollIntervalMs: _pollIntervalMs,
    timeoutMs: _timeoutMs,
    maxConsecutivePollErrors: _maxConsecutivePollErrors,
    resumeId: _resumeId,
    ...rest
  } = options;

  return Object.keys(rest).length > 0 ? rest : undefined;
}

export function resolveRequestExecutionPolicy(
  providerId: ProviderId,
  providerConfig: unknown,
  options: JsonObject | undefined,
): RequestExecutionPolicy {
  const geminiDefaults = getGeminiDefaults(providerId, providerConfig);

  return {
    requestTimeoutMs:
      readPositiveInteger(options?.requestTimeoutMs) ??
      geminiDefaults?.requestTimeoutMs,
    retryCount:
      readNonNegativeInteger(options?.retryCount) ??
      geminiDefaults?.retryCount ??
      0,
    retryDelayMs:
      readPositiveInteger(options?.retryDelayMs) ??
      geminiDefaults?.retryDelayMs ??
      2000,
  };
}

export function resolveResearchExecutionPolicy(
  providerId: ProviderId,
  providerConfig: unknown,
  options: JsonObject | undefined,
): ResearchExecutionPolicy {
  const request = resolveRequestExecutionPolicy(
    providerId,
    providerConfig,
    options,
  );
  const geminiDefaults = getGeminiDefaults(providerId, providerConfig);

  return {
    ...request,
    pollIntervalMs:
      readPositiveInteger(options?.pollIntervalMs) ??
      geminiDefaults?.researchPollIntervalMs ??
      DEFAULT_RESEARCH_POLL_INTERVAL_MS,
    timeoutMs:
      readPositiveInteger(options?.timeoutMs) ??
      geminiDefaults?.researchTimeoutMs,
    maxConsecutivePollErrors:
      readPositiveInteger(options?.maxConsecutivePollErrors) ??
      geminiDefaults?.researchMaxConsecutivePollErrors ??
      3,
    resumeId: readNonEmptyString(options?.resumeId),
  };
}

export async function runWithExecutionPolicy<T>(
  label: string,
  operation: (context: ProviderContext) => Promise<T>,
  policy: RequestExecutionPolicy,
  context: ProviderContext,
): Promise<T> {
  const maxAttempts = Math.max(1, policy.retryCount + 1);

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
        policy.requestTimeoutMs === undefined
          ? undefined
          : `${label} timed out after ${formatDuration(policy.requestTimeoutMs)}.`;
      return await withAbortAndOptionalTimeout(
        result,
        policy.requestTimeoutMs,
        context.signal,
        timeoutMessage,
        timeoutMessage
          ? () => abort(new RequestTimeoutError(timeoutMessage))
          : undefined,
      );
    } catch (error) {
      if (!shouldRetryError(error, policy) || attempt >= maxAttempts) {
        throw error;
      }

      const delayMs = Math.min(
        policy.retryDelayMs * 2 ** (attempt - 1),
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

export async function executeResearchWithLifecycle({
  providerLabel,
  providerId,
  input,
  options,
  context,
  policy,
  startRetryCount = 0,
  startRetryNotice,
  startIdempotencyKey,
  startRetryOnTimeout = false,
  startRequestTimeoutMs,
  pollRequestTimeoutMs,
  deferDeadlineUntilStarted = false,
  start,
  poll,
}: {
  providerLabel: string;
  providerId: ProviderId;
  input: string;
  options: JsonObject | undefined;
  context: ProviderContext;
  policy: ResearchExecutionPolicy;
  startRetryCount?: number;
  startRetryNotice?: string;
  startIdempotencyKey?: string;
  startRetryOnTimeout?: boolean;
  startRequestTimeoutMs?: number | null;
  pollRequestTimeoutMs?: number | null;
  deferDeadlineUntilStarted?: boolean;
  start: (
    input: string,
    options: JsonObject | undefined,
    context: ProviderContext,
  ) => Promise<ProviderResearchJob>;
  poll: (
    id: string,
    options: JsonObject | undefined,
    context: ProviderContext,
  ) => Promise<ProviderResearchPollResult>;
}): Promise<ProviderToolOutput> {
  const providerOptions = stripLocalExecutionOptions(options);
  const effectiveStartRequestTimeoutMs =
    startRequestTimeoutMs === undefined
      ? policy.requestTimeoutMs
      : (startRequestTimeoutMs ?? undefined);
  const effectivePollRequestTimeoutMs =
    pollRequestTimeoutMs === undefined
      ? policy.requestTimeoutMs
      : (pollRequestTimeoutMs ?? undefined);
  const timeoutMessage =
    policy.timeoutMs === undefined
      ? undefined
      : `${providerLabel} research exceeded ${formatDuration(policy.timeoutMs)}.`;

  let lastStatus: ProviderResearchPollResult["status"] | undefined;
  let lifecycleStartedAt = Date.now();
  let lifecycleSignal = context.signal;
  let cleanupLifecycle = () => {};
  let lifecycleContext: ProviderContext = {
    ...context,
    signal: lifecycleSignal,
  };

  const activateLifecycleDeadline = () => {
    const deadline = createDeadlineSignal(
      context.signal,
      policy.timeoutMs,
      timeoutMessage,
    );
    lifecycleSignal = deadline.signal;
    cleanupLifecycle = deadline.cleanup;
    lifecycleStartedAt = Date.now();
    lifecycleContext = {
      ...context,
      signal: lifecycleSignal,
    };
  };

  let jobId = policy.resumeId;
  if (jobId || !deferDeadlineUntilStarted) {
    activateLifecycleDeadline();
  }

  try {
    if (jobId) {
      lifecycleContext.onProgress?.(
        `Resuming ${providerLabel} research: ${jobId}`,
      );
    } else {
      lifecycleContext.onProgress?.(`Starting ${providerLabel} research`);
      if (startRetryNotice) {
        lifecycleContext.onProgress?.(startRetryNotice);
      }
      const job = await runWithExecutionPolicy(
        `${providerLabel} research start`,
        (attemptContext) =>
          start(input, providerOptions, {
            ...attemptContext,
            idempotencyKey: startIdempotencyKey,
          }),
        {
          ...policy,
          requestTimeoutMs: effectiveStartRequestTimeoutMs,
          retryCount: startRetryCount,
          retryOnTimeout: startRetryOnTimeout,
        },
        lifecycleContext,
      );
      jobId = job.id;
      if (deferDeadlineUntilStarted) {
        activateLifecycleDeadline();
      }
      lifecycleContext.onProgress?.(
        `${providerLabel} research started: ${jobId}`,
      );
    }

    if (!jobId) {
      throw new Error(`${providerLabel} research did not return a job id.`);
    }

    let consecutivePollErrors = 0;

    while (true) {
      throwIfAborted(
        lifecycleContext.signal,
        `${providerLabel} research aborted.`,
      );

      try {
        const result = await runWithExecutionPolicy(
          `${providerLabel} research poll`,
          (attemptContext) => poll(jobId!, providerOptions, attemptContext),
          {
            ...policy,
            requestTimeoutMs: effectivePollRequestTimeoutMs,
          },
          lifecycleContext,
        );
        consecutivePollErrors = 0;

        if (result.status !== lastStatus) {
          lifecycleContext.onProgress?.(
            `${providerLabel} research status: ${result.status} (${formatElapsed(Date.now() - lifecycleStartedAt)} elapsed)`,
          );
          lastStatus = result.status;
        }

        if (result.status === "completed") {
          return (
            result.output ?? {
              provider: providerId,
              text: `${providerLabel} research completed without textual output.`,
              summary: `Research via ${providerLabel}`,
            }
          );
        }

        if (result.status === "failed" || result.status === "cancelled") {
          throw new NonResumableResearchError(
            result.error || `${providerLabel} research ${result.status}.`,
          );
        }
      } catch (error) {
        if (error instanceof NonResumableResearchError) {
          throw error;
        }
        if (isAbortErrorFromSignal(lifecycleContext.signal, error)) {
          throw error;
        }
        if (
          !(error instanceof RequestTimeoutError) &&
          !isRetryableError(error)
        ) {
          throw buildResumeError(error, jobId);
        }

        consecutivePollErrors += 1;
        if (consecutivePollErrors >= policy.maxConsecutivePollErrors) {
          throw buildResumeError(
            `${providerLabel} research polling failed too many times in a row: ${formatErrorMessage(error)}`,
            jobId,
          );
        }

        lifecycleContext.onProgress?.(
          `${providerLabel} research poll is still retrying after transient errors (${consecutivePollErrors}/${policy.maxConsecutivePollErrors} consecutive poll failures). Background job id: ${jobId}`,
        );
      }

      await sleep(policy.pollIntervalMs, lifecycleContext.signal);
    }
  } catch (error) {
    if (jobId && isAbortErrorFromSignal(lifecycleContext.signal, error)) {
      throw buildResumeError(error, jobId);
    }
    throw error;
  } finally {
    cleanupLifecycle();
  }
}

function shouldRetryError(
  error: unknown,
  policy: Pick<RequestExecutionPolicy, "retryOnTimeout">,
): boolean {
  if (error instanceof RequestTimeoutError) {
    return policy.retryOnTimeout === true;
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
  timeoutMs: number | undefined,
  timeoutMessage: string | undefined,
): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
} {
  if (timeoutMs === undefined) {
    return {
      signal,
      cleanup: () => {},
    };
  }

  const controller = new AbortController();

  if (signal?.aborted) {
    controller.abort(getAbortError(signal));
  }

  const onAbort = () => {
    controller.abort(getAbortError(signal));
  };

  signal?.addEventListener("abort", onAbort, { once: true });

  const timer = setTimeout(() => {
    controller.abort(
      new RequestTimeoutError(
        timeoutMessage ??
          `Operation timed out after ${formatDuration(timeoutMs)}.`,
      ),
    );
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function buildResumeError(error: string | unknown, jobId: string): Error {
  const message = typeof error === "string" ? error : formatErrorMessage(error);
  return new Error(
    `${message} Resume the background job with options.resumeId=${JSON.stringify(jobId)}.`,
  );
}

function getGeminiDefaults(
  providerId: ProviderId,
  providerConfig: unknown,
): GeminiProviderConfig["defaults"] | undefined {
  if (providerId !== "gemini") {
    return undefined;
  }

  return (providerConfig as GeminiProviderConfig | undefined)?.defaults;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.trunc(value)
    : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}
