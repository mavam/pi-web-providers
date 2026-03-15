import type {
  BackgroundResearchOperationPlan,
  ExecutionPolicyDefaults,
  ProviderPlanTraits,
  SingleProviderOperationPlan,
} from "./types.js";

interface ConfigWithPolicy {
  policy?: ExecutionPolicyDefaults;
}

// Silent foreground plans wait for a final result without surfacing partial
// provider output while the request is still running.
export function createSilentForegroundPlan<TResult>({
  config,
  traits,
  ...plan
}: Omit<SingleProviderOperationPlan<TResult>, "deliveryMode" | "traits"> & {
  config: ConfigWithPolicy;
  traits?: Omit<ProviderPlanTraits, "policyDefaults">;
}): SingleProviderOperationPlan<TResult> {
  return buildSinglePlan("silent-foreground", config.policy, traits, plan);
}

// Streaming foreground plans can surface intermediate provider output, but the
// tool result is still only consumed once the call finishes.
export function createStreamingForegroundPlan<TResult>({
  config,
  traits,
  ...plan
}: Omit<SingleProviderOperationPlan<TResult>, "deliveryMode" | "traits"> & {
  config: ConfigWithPolicy;
  traits?: Omit<ProviderPlanTraits, "policyDefaults">;
}): SingleProviderOperationPlan<TResult> {
  return buildSinglePlan("streaming-foreground", config.policy, traits, plan);
}

// Background research plans model providers that return a durable research job
// which pi can poll and later resume via `resumeId`.
export function createBackgroundResearchPlan({
  config,
  traits,
  ...plan
}: Omit<BackgroundResearchOperationPlan, "deliveryMode" | "traits"> & {
  config: ConfigWithPolicy;
  traits?: Omit<ProviderPlanTraits, "policyDefaults">;
}): BackgroundResearchOperationPlan {
  const builtTraits = buildTraits(config.policy, traits);

  return {
    ...plan,
    deliveryMode: "background-research",
    ...(builtTraits ? { traits: builtTraits } : {}),
  };
}

function buildSinglePlan<TResult>(
  deliveryMode: SingleProviderOperationPlan<TResult>["deliveryMode"],
  policyDefaults: ExecutionPolicyDefaults | undefined,
  traits: Omit<ProviderPlanTraits, "policyDefaults"> | undefined,
  plan: Omit<SingleProviderOperationPlan<TResult>, "deliveryMode" | "traits">,
): SingleProviderOperationPlan<TResult> {
  const builtTraits = buildTraits(policyDefaults, traits);

  return {
    ...plan,
    deliveryMode,
    ...(builtTraits ? { traits: builtTraits } : {}),
  };
}

function buildTraits(
  policyDefaults: ExecutionPolicyDefaults | undefined,
  traits: Omit<ProviderPlanTraits, "policyDefaults"> | undefined,
): ProviderPlanTraits | undefined {
  const builtTraits: ProviderPlanTraits = {
    ...(policyDefaults ? { policyDefaults } : {}),
    ...(traits ?? {}),
  };

  return Object.keys(builtTraits).length > 0 ? builtTraits : undefined;
}
