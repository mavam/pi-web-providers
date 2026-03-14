import { randomUUID } from "node:crypto";
import {
  executeResearchWithLifecycle,
  type ResearchExecutionPolicy,
  resolveRequestExecutionPolicy,
  resolveResearchExecutionPolicy,
  runWithExecutionPolicy,
} from "./execution-policy.js";
import type {
  JsonObject,
  ProviderContext,
  ProviderOperationPlan,
  ProviderToolOutput,
  SearchResponse,
} from "./types.js";

export async function executeOperationPlan<
  TResult extends SearchResponse | ProviderToolOutput,
>(
  plan: ProviderOperationPlan<TResult>,
  options: JsonObject | undefined,
  context: ProviderContext,
): Promise<TResult> {
  assertResearchOptionsSupported(plan, options);

  if (plan.mode === "single") {
    return await runWithExecutionPolicy(
      `${plan.providerLabel} ${plan.capability} request`,
      plan.execute,
      resolveRequestExecutionPolicy(options, plan.traits?.policyDefaults),
      context,
    );
  }

  const researchPolicy = resolveResearchPolicy(plan, options);
  const supportsSafeStartRetries =
    plan.traits?.supportsIdempotentStartRetries === true;
  const supportsPollCancellation =
    plan.traits?.supportsPollCancellation === true;

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
    startRequestTimeoutMs: supportsSafeStartRetries
      ? researchPolicy.requestTimeoutMs
      : null,
    pollRequestTimeoutMs: supportsPollCancellation
      ? researchPolicy.requestTimeoutMs
      : null,
    deferDeadlineUntilStarted: !supportsSafeStartRetries,
    start: plan.start,
    poll: plan.poll,
  })) as TResult;
}

function resolveResearchPolicy<
  TResult extends SearchResponse | ProviderToolOutput,
>(
  plan: ProviderOperationPlan<TResult>,
  options: JsonObject | undefined,
): ResearchExecutionPolicy {
  return resolveResearchExecutionPolicy(options, plan.traits?.policyDefaults);
}

function assertResearchOptionsSupported<
  TResult extends SearchResponse | ProviderToolOutput,
>(plan: ProviderOperationPlan<TResult>, options: JsonObject | undefined): void {
  if (plan.capability !== "research") {
    return;
  }

  if (options?.resumeInteractionId !== undefined) {
    throw new Error(
      "resumeInteractionId is not supported. Use resumeId instead.",
    );
  }

  if (plan.mode === "job") {
    return;
  }

  const unsupported = [
    ["pollIntervalMs", options?.pollIntervalMs],
    ["timeoutMs", options?.timeoutMs],
    ["maxConsecutivePollErrors", options?.maxConsecutivePollErrors],
    ["resumeId", options?.resumeId],
  ].flatMap(([key, value]) => (value === undefined ? [] : [key]));

  if (unsupported.length === 0) {
    return;
  }

  throw new Error(
    `${plan.providerLabel} research runs synchronously and does not support ${unsupported.join(", ")}. Use requestTimeoutMs/retryCount/retryDelayMs instead.`,
  );
}
