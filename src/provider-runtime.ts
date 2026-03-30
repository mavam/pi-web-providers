import { randomUUID } from "node:crypto";
import type { ContentsResponse } from "./contents.js";
import {
  executeResearchWithLifecycle,
  formatErrorMessage,
  parseLocalExecutionOptions,
  type ResearchExecutionPolicy,
  resolveRequestExecutionPolicy,
  resolveResearchExecutionPolicy,
  runWithExecutionPolicy,
} from "./execution-policy.js";
import { formatProviderDiagnostic } from "./provider-diagnostics.js";
import {
  EXECUTION_CONTROL_KEYS,
  type ExecutionControlKey,
  type ExecutionSettings,
  type ExecutionSupport,
  type ProviderContext,
  type ProviderPlan,
  type SearchResponse,
  type SingleProviderPlan,
  type ToolOutput,
} from "./types.js";

export async function executeOperationPlan<
  TResult extends SearchResponse | ContentsResponse | ToolOutput,
>(
  plan: ProviderPlan<TResult>,
  options: Record<string, unknown> | undefined,
  context: ProviderContext,
): Promise<TResult> {
  if (plan.deliveryMode !== "background-research") {
    const requestPolicy = resolveForegroundExecutionPolicy(plan, options);
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

  const researchPolicy = resolveBackgroundResearchExecutionPolicy(
    plan,
    options,
  );
  const lifecycleTraits = plan.traits?.researchLifecycle;
  const supportsSafeStartRetries =
    lifecycleTraits?.supportsStartRetries === true;
  const supportsRequestTimeouts =
    lifecycleTraits?.supportsRequestTimeouts === true;

  return (await executeResearchWithLifecycle({
    providerLabel: plan.providerLabel,
    providerId: plan.providerId,
    context,
    settings: researchPolicy,
    startRetryCount: supportsSafeStartRetries ? researchPolicy.retryCount : 0,
    startRetryNotice:
      !supportsSafeStartRetries && researchPolicy.retryCount > 0
        ? `${plan.providerLabel} research start retries are disabled to avoid duplicate background jobs; configured retries apply after the job starts.`
        : undefined,
    startIdempotencyKey: supportsSafeStartRetries
      ? `pi-web-providers:${plan.providerId}:${randomUUID()}`
      : undefined,
    startRetryOnTimeout: supportsSafeStartRetries,
    startRequestTimeoutMs: supportsRequestTimeouts
      ? researchPolicy.requestTimeoutMs
      : undefined,
    pollRequestTimeoutMs: supportsRequestTimeouts
      ? researchPolicy.requestTimeoutMs
      : undefined,
    start: plan.start,
    poll: plan.poll,
  })) as TResult;
}

export function resolvePlanExecutionSupport<
  TResult extends SearchResponse | ContentsResponse | ToolOutput,
>(plan: ProviderPlan<TResult>): Required<ExecutionSupport> {
  const explicit = plan.traits?.executionSupport ?? {};

  return {
    requestTimeoutMs:
      explicit.requestTimeoutMs ??
      inferExecutionSupport(plan, "requestTimeoutMs"),
    retryCount:
      explicit.retryCount ?? inferExecutionSupport(plan, "retryCount"),
    retryDelayMs:
      explicit.retryDelayMs ?? inferExecutionSupport(plan, "retryDelayMs"),
    pollIntervalMs:
      explicit.pollIntervalMs ?? inferExecutionSupport(plan, "pollIntervalMs"),
    timeoutMs: explicit.timeoutMs ?? inferExecutionSupport(plan, "timeoutMs"),
    maxConsecutivePollErrors:
      explicit.maxConsecutivePollErrors ??
      inferExecutionSupport(plan, "maxConsecutivePollErrors"),
    resumeId: explicit.resumeId ?? inferExecutionSupport(plan, "resumeId"),
  };
}

function resolveForegroundExecutionPolicy<
  TResult extends SearchResponse | ContentsResponse | ToolOutput,
>(
  plan: SingleProviderPlan<TResult>,
  options: Record<string, unknown> | undefined,
) {
  const localOptions = parseLocalExecutionOptions(options);
  const executionSupport = resolvePlanExecutionSupport(plan);
  const unsupportedControls = getUnsupportedExecutionControls(
    localOptions,
    executionSupport,
  );

  if (options?.resumeInteractionId !== undefined) {
    throw new Error(
      "resumeInteractionId is not supported. Use resumeId instead.",
    );
  }

  if (unsupportedControls.length > 0) {
    if (plan.capability === "research") {
      throw new Error(
        `${plan.providerLabel} research runs in ${formatForegroundMode(plan.deliveryMode)} mode and does not support ${unsupportedControls.join(", ")}. Use ${formatSupportedControls(executionSupport, plan.capability)} instead.`,
      );
    }

    throw new Error(
      `${plan.providerLabel} ${plan.capability} does not support ${unsupportedControls.join(", ")}. These controls only apply to web_research. Use ${formatSupportedControls(executionSupport, plan.capability)} instead.`,
    );
  }

  return resolveRequestExecutionPolicy(
    options,
    filterPolicyDefaults(plan.traits?.settings, executionSupport),
  );
}

function resolveBackgroundResearchExecutionPolicy<
  TResult extends SearchResponse | ContentsResponse | ToolOutput,
>(
  plan: ProviderPlan<TResult>,
  options: Record<string, unknown> | undefined,
): ResearchExecutionPolicy {
  const localOptions = parseLocalExecutionOptions(options);
  const executionSupport = resolvePlanExecutionSupport(plan);

  if (options?.resumeInteractionId !== undefined) {
    throw new Error(
      "resumeInteractionId is not supported. Use resumeId instead.",
    );
  }

  const unsupportedControls = getUnsupportedExecutionControls(
    localOptions,
    executionSupport,
  );
  if (unsupportedControls.length > 0) {
    throw new Error(
      `${plan.providerLabel} research does not support ${unsupportedControls.join(", ")}. Use ${formatSupportedControls(executionSupport, plan.capability)} instead.`,
    );
  }

  return resolveResearchExecutionPolicy(
    options,
    filterPolicyDefaults(plan.traits?.settings, executionSupport),
  );
}

function inferExecutionSupport<
  TResult extends SearchResponse | ContentsResponse | ToolOutput,
>(plan: ProviderPlan<TResult>, key: ExecutionControlKey): boolean {
  switch (key) {
    case "requestTimeoutMs":
      if (plan.deliveryMode !== "background-research") {
        return true;
      }
      return plan.traits?.researchLifecycle?.supportsRequestTimeouts === true;
    case "retryCount":
    case "retryDelayMs":
      return true;
    case "pollIntervalMs":
    case "timeoutMs":
    case "maxConsecutivePollErrors":
    case "resumeId":
      return (
        plan.capability === "research" &&
        plan.deliveryMode === "background-research"
      );
  }
}

function getUnsupportedExecutionControls(
  localOptions: ReturnType<typeof parseLocalExecutionOptions>,
  executionSupport: Required<ExecutionSupport>,
): ExecutionControlKey[] {
  return EXECUTION_CONTROL_KEYS.filter((key) => {
    const value = localOptions[key];
    return value !== undefined && executionSupport[key] !== true;
  });
}

function filterPolicyDefaults(
  defaults: ExecutionSettings | undefined,
  executionSupport: Required<ExecutionSupport>,
): ExecutionSettings | undefined {
  if (!defaults) {
    return undefined;
  }

  const filtered: ExecutionSettings = {
    requestTimeoutMs: executionSupport.requestTimeoutMs
      ? defaults.requestTimeoutMs
      : undefined,
    retryCount: executionSupport.retryCount ? defaults.retryCount : undefined,
    retryDelayMs: executionSupport.retryDelayMs
      ? defaults.retryDelayMs
      : undefined,
    researchPollIntervalMs: executionSupport.pollIntervalMs
      ? defaults.researchPollIntervalMs
      : undefined,
    researchTimeoutMs: executionSupport.timeoutMs
      ? defaults.researchTimeoutMs
      : undefined,
    researchMaxConsecutivePollErrors: executionSupport.maxConsecutivePollErrors
      ? defaults.researchMaxConsecutivePollErrors
      : undefined,
  };

  return Object.values(filtered).some((value) => value !== undefined)
    ? filtered
    : undefined;
}

function formatSupportedControls(
  executionSupport: Required<ExecutionSupport>,
  capability: SingleProviderPlan<unknown>["capability"],
): string {
  const supportedControls = EXECUTION_CONTROL_KEYS.filter(
    (key) => executionSupport[key] === true,
  ).filter((key) => capability === "research" || key !== "resumeId");

  return supportedControls.length > 0
    ? supportedControls.join("/")
    : "no local execution controls";
}

function formatForegroundMode(
  deliveryMode: SingleProviderPlan<unknown>["deliveryMode"],
): "silent foreground" | "streaming foreground" {
  return deliveryMode === "streaming-foreground"
    ? "streaming foreground"
    : "silent foreground";
}
