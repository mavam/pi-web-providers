import type {
  ExecutionPolicyDefaults,
  JobProviderOperationPlan,
  ProviderPlanTraits,
  SingleProviderOperationPlan,
} from "./types.js";

interface ConfigWithPolicy {
  policy?: ExecutionPolicyDefaults;
}

export function createSingleOperationPlan<TResult>({
  config,
  traits,
  ...plan
}: Omit<SingleProviderOperationPlan<TResult>, "mode" | "traits"> & {
  config: ConfigWithPolicy;
  traits?: Omit<ProviderPlanTraits, "policyDefaults">;
}): SingleProviderOperationPlan<TResult> {
  const builtTraits = buildTraits(config.policy, traits);

  return {
    ...plan,
    mode: "single",
    ...(builtTraits ? { traits: builtTraits } : {}),
  };
}

export function createResearchJobPlan({
  config,
  traits,
  ...plan
}: Omit<JobProviderOperationPlan, "mode" | "traits"> & {
  config: ConfigWithPolicy;
  traits?: Omit<ProviderPlanTraits, "policyDefaults">;
}): JobProviderOperationPlan {
  const builtTraits = buildTraits(config.policy, traits);

  return {
    ...plan,
    mode: "job",
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
