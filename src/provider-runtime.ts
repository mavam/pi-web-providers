import { randomUUID } from "node:crypto";
import {
  executeResearchWithLifecycle,
  parseLocalExecutionOptions,
  type ResearchExecutionPolicy,
  resolveRequestExecutionPolicy,
  resolveResearchExecutionPolicy,
  runWithExecutionPolicy,
} from "./execution-policy.js";
import type {
  ExecutionPolicyDefaults,
  JsonObject,
  ProviderContext,
  ProviderOperationPlan,
  ProviderToolOutput,
  SearchResponse,
  SingleProviderOperationPlan,
} from "./types.js";

export async function executeOperationPlan<
  TResult extends SearchResponse | ProviderToolOutput,
>(
  plan: ProviderOperationPlan<TResult>,
  options: JsonObject | undefined,
  context: ProviderContext,
): Promise<TResult> {
  if (plan.deliveryMode !== "background-research") {
    const requestPolicy = resolveForegroundExecutionPolicy(plan, options);
    return await runWithExecutionPolicy(
      `${plan.providerLabel} ${plan.capability} request`,
      plan.execute,
      requestPolicy,
      context,
    );
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
    policy: researchPolicy,
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

function resolveForegroundExecutionPolicy<
  TResult extends SearchResponse | ProviderToolOutput,
>(plan: SingleProviderOperationPlan<TResult>, options: JsonObject | undefined) {
  // Silent foreground plans inherit the full request policy. Streaming
  // foreground plans intentionally drop the default request timeout so that a
  // provider can keep streaming progress without being cut off by a short
  // request/response timeout that was tuned for silent foreground tools.
  const localOptions = parseLocalExecutionOptions(options);

  const researchOnlyOptions = [
    ["pollIntervalMs", localOptions.pollIntervalMs],
    ["timeoutMs", localOptions.timeoutMs],
    ["maxConsecutivePollErrors", localOptions.maxConsecutivePollErrors],
    ["resumeId", localOptions.resumeId],
    ["resumeInteractionId", options?.resumeInteractionId],
  ].flatMap(([key, value]) => (value === undefined ? [] : [key]));

  if (plan.capability === "research") {
    if (options?.resumeInteractionId !== undefined) {
      throw new Error(
        "resumeInteractionId is not supported. Use resumeId instead.",
      );
    }

    if (researchOnlyOptions.length > 0) {
      throw new Error(
        `${plan.providerLabel} research runs in ${formatForegroundMode(plan.deliveryMode)} mode and does not support ${researchOnlyOptions.join(", ")}. Use requestTimeoutMs/retryCount/retryDelayMs instead.`,
      );
    }
  } else if (researchOnlyOptions.length > 0) {
    throw new Error(
      `${plan.providerLabel} ${plan.capability} does not support ${researchOnlyOptions.join(", ")}. These controls only apply to web_research. Use requestTimeoutMs/retryCount/retryDelayMs instead.`,
    );
  }

  return resolveRequestExecutionPolicy(
    options,
    getSupportedForegroundPolicyDefaults(plan),
  );
}

function resolveBackgroundResearchExecutionPolicy<
  TResult extends SearchResponse | ProviderToolOutput,
>(
  plan: ProviderOperationPlan<TResult>,
  options: JsonObject | undefined,
): ResearchExecutionPolicy {
  const localOptions = parseLocalExecutionOptions(options);

  if (options?.resumeInteractionId !== undefined) {
    throw new Error(
      "resumeInteractionId is not supported. Use resumeId instead.",
    );
  }

  if (
    localOptions.requestTimeoutMs !== undefined &&
    plan.traits?.researchLifecycle?.supportsRequestTimeouts !== true
  ) {
    throw new Error(
      `${plan.providerLabel} research does not support requestTimeoutMs. Use retryCount/retryDelayMs/pollIntervalMs/timeoutMs/maxConsecutivePollErrors/resumeId instead.`,
    );
  }

  return resolveResearchExecutionPolicy(
    options,
    getSupportedBackgroundResearchPolicyDefaults(plan),
  );
}

function formatForegroundMode(
  deliveryMode: SingleProviderOperationPlan<unknown>["deliveryMode"],
): "silent foreground" | "streaming foreground" {
  return deliveryMode === "streaming-foreground"
    ? "streaming foreground"
    : "silent foreground";
}

function getSupportedForegroundPolicyDefaults<TResult>(
  plan: SingleProviderOperationPlan<TResult>,
): ExecutionPolicyDefaults | undefined {
  const defaults = plan.traits?.policyDefaults;
  if (!defaults) {
    return undefined;
  }

  if (plan.deliveryMode === "silent-foreground") {
    return defaults;
  }

  const { requestTimeoutMs: _requestTimeoutMs, ...rest } = defaults;
  return Object.values(rest).some((value) => value !== undefined)
    ? rest
    : undefined;
}

function getSupportedBackgroundResearchPolicyDefaults<
  TResult extends SearchResponse | ProviderToolOutput,
>(plan: ProviderOperationPlan<TResult>): ExecutionPolicyDefaults | undefined {
  const defaults = plan.traits?.policyDefaults;
  if (!defaults) {
    return undefined;
  }

  if (plan.traits?.researchLifecycle?.supportsRequestTimeouts === true) {
    return defaults;
  }

  const { requestTimeoutMs: _requestTimeoutMs, ...rest } = defaults;
  return Object.values(rest).some((value) => value !== undefined)
    ? rest
    : undefined;
}
