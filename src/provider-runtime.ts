import type { ContentsResponse } from "./contents.js";
import {
  formatDuration,
  formatErrorMessage,
  parseLocalExecutionOptions,
  runWithExecutionPolicy,
} from "./execution-policy.js";
import { formatProviderDiagnostic } from "./provider-diagnostics.js";
import type {
  ExecutionSettings,
  ProviderContext,
  ProviderPlan,
  SearchResponse,
  ToolOutput,
} from "./types.js";

export async function executeOperationPlan<
  TResult extends SearchResponse | ContentsResponse | ToolOutput,
>(
  plan: ProviderPlan<TResult>,
  options: Record<string, unknown> | undefined,
  context: ProviderContext,
): Promise<TResult> {
  if (plan.capability === "research") {
    rejectResearchExecutionControls(plan.providerLabel, options);
    const deadline = createResearchDeadlineSignal(
      context.signal,
      plan.providerLabel,
      plan.traits?.settings?.researchTimeoutMs,
    );

    try {
      const researchContext = deadline
        ? { ...context, signal: deadline.signal }
        : context;
      return await withAbortSignal(
        plan.execute(researchContext),
        researchContext.signal,
      );
    } catch (error) {
      throw new Error(
        formatProviderDiagnostic(plan.providerLabel, formatErrorMessage(error)),
      );
    } finally {
      deadline?.cleanup();
    }
  }

  const requestPolicy = resolveExecutionPolicy(plan.traits?.settings, options);
  try {
    return await runWithExecutionPolicy(
      `${plan.providerLabel} ${plan.capability} request`,
      plan.execute,
      requestPolicy,
      context,
    );
  } catch (error) {
    throw new Error(
      formatProviderDiagnostic(plan.providerLabel, formatErrorMessage(error)),
    );
  }
}

function resolveExecutionPolicy(
  defaults: ExecutionSettings | undefined,
  options: Record<string, unknown> | undefined,
) {
  validateRuntimeOptions(options);
  const localOptions = parseLocalExecutionOptions(options);

  return {
    requestTimeoutMs:
      localOptions.requestTimeoutMs ?? defaults?.requestTimeoutMs,
    retryCount: localOptions.retryCount ?? defaults?.retryCount ?? 0,
    retryDelayMs: localOptions.retryDelayMs ?? defaults?.retryDelayMs ?? 2000,
  };
}

function createResearchDeadlineSignal(
  signal: AbortSignal | undefined,
  providerLabel: string,
  timeoutMs: number | undefined,
): { signal: AbortSignal; cleanup: () => void } | undefined {
  if (timeoutMs === undefined) {
    return undefined;
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
      new Error(
        `${providerLabel} research exceeded ${formatDuration(timeoutMs)}.`,
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

async function withAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return await promise;
  }

  if (signal.aborted) {
    throw getAbortError(signal);
  }

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(getAbortError(signal));
    };

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
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

function rejectResearchExecutionControls(
  providerLabel: string,
  options: Record<string, unknown> | undefined,
): void {
  if (!options || Object.keys(options).length === 0) {
    return;
  }

  throw new Error(`${providerLabel} research does not accept options.runtime.`);
}

function validateRuntimeOptions(
  options: Record<string, unknown> | undefined,
): void {
  if (!options) {
    return;
  }

  const unsupportedKeys = Object.keys(options).filter(
    (key) =>
      key !== "requestTimeoutMs" &&
      key !== "retryCount" &&
      key !== "retryDelayMs",
  );

  if (unsupportedKeys.length === 0) {
    return;
  }

  throw new Error(
    `Unsupported runtime options: ${unsupportedKeys.join(", ")}.`,
  );
}
