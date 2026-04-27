import {
  formatDuration,
  formatErrorMessage,
  runWithExecutionPolicy,
} from "./execution-policy.js";
import { formatProviderDiagnostic } from "./provider-diagnostics.js";
import { executeProviderCapability } from "./providers/definition.js";
import type { ProviderDefinition } from "./providers/definition.js";
import type {
  ExecutionSettings,
  ProviderConfig,
  ProviderContext,
  ProviderId,
  ProviderRequest,
  ProviderResult,
  Tool,
} from "./types.js";

interface ConfigWithSettings {
  settings?: ExecutionSettings;
}

export interface ProviderExecution<TTool extends Tool = Tool> {
  capability: TTool;
  providerLabel: string;
  settings?: ExecutionSettings;
  execute: (context: ProviderContext) => Promise<ProviderResult<TTool>>;
}

export async function executeProviderRequest<TTool extends Tool>(
  provider: ProviderDefinition<
    ProviderId,
    ProviderConfig,
    Partial<Record<Tool, any>>
  >,
  config: ProviderConfig,
  request: ProviderRequest<TTool>,
  context: ProviderContext,
): Promise<ProviderResult<TTool>> {
  return (await executeProviderExecution(
    {
      capability: request.capability,
      providerLabel: provider.label,
      settings: (config as ConfigWithSettings).settings,
      execute: (executionContext) =>
        executeProviderCapability(
          provider,
          request.capability,
          providerInputFromRequest(request),
          {
            ...executionContext,
            config,
          },
        ),
    },
    context,
  )) as ProviderResult<TTool>;
}

export async function executeProviderExecution<TTool extends Tool>(
  execution: ProviderExecution<TTool>,
  context: ProviderContext,
): Promise<ProviderResult<TTool>> {
  if (execution.capability === "research") {
    const deadline = createResearchDeadlineSignal(
      context.signal,
      execution.providerLabel,
      execution.settings?.researchTimeoutMs,
    );

    try {
      const researchContext = deadline
        ? { ...context, signal: deadline.signal }
        : context;
      return await withAbortSignal(
        execution.execute(researchContext),
        researchContext.signal,
      );
    } catch (error) {
      throw new Error(
        formatProviderDiagnostic(
          execution.providerLabel,
          formatErrorMessage(error),
        ),
      );
    } finally {
      deadline?.cleanup();
    }
  }

  const requestPolicy = resolveExecutionPolicy(execution.settings);
  try {
    return await runWithExecutionPolicy(
      `${execution.providerLabel} ${execution.capability} request`,
      execution.execute,
      requestPolicy,
      context,
    );
  } catch (error) {
    throw new Error(
      formatProviderDiagnostic(
        execution.providerLabel,
        formatErrorMessage(error),
      ),
    );
  }
}

function providerInputFromRequest(request: ProviderRequest): object {
  switch (request.capability) {
    case "search":
      return {
        query: request.query,
        maxResults: request.maxResults,
        options: request.options,
      };
    case "contents":
      return {
        urls: request.urls,
        options: request.options,
      };
    case "answer":
      return {
        query: request.query,
        options: request.options,
      };
    case "research":
      return {
        input: request.input,
        options: request.options,
      };
  }
}

function resolveExecutionPolicy(defaults: ExecutionSettings | undefined) {
  return {
    requestTimeoutMs: defaults?.requestTimeoutMs,
    retryCount: defaults?.retryCount ?? 0,
    retryDelayMs: defaults?.retryDelayMs ?? 2000,
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
