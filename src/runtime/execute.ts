import type {
  Capability,
  CapabilityDocument,
  CapabilityValues,
  InputResult,
  RequestOptions,
  ProgressEvent,
} from "../domain.js";
import type {
  ExecutionConfig,
  ProviderConfiguration,
} from "../configuration/types.js";
import type {
  ProviderAdapter,
  ProviderDefinition,
} from "../providers/definition.js";
import type {
  ProviderConfig,
  ProviderContext,
  ProviderRequest,
  ProviderResult,
} from "../providers/contract.js";
import { asWebfoxError, WebfoxError } from "../errors.js";
import { CredentialResolver } from "./credentials.js";
import { OutwardBoundary } from "./outward.js";
import { deadline, orderedMap, sleep, withSignal } from "./lifecycle.js";

export interface ExecutionPlan<C extends Capability> {
  capability: C;
  definition: ProviderDefinition;
  stored?: ProviderConfiguration;
  inputs: string[];
  options: Record<string, unknown>;
  maxResults?: number;
  policy: ExecutionConfig;
}
export class ExecutionRuntime {
  private readonly credentials: CredentialResolver;
  constructor(
    private readonly cwd: string,
    private readonly env: Record<string, string | undefined>,
  ) {
    this.credentials = new CredentialResolver(cwd, env);
  }
  async execute<C extends Capability>(
    plan: ExecutionPlan<C>,
    request: RequestOptions,
  ): Promise<CapabilityDocument<CapabilityValues[C], C>> {
    const { capability, definition, inputs } = plan;
    const timeoutMs =
      request.timeoutMs ??
      (capability === "research"
        ? (plan.policy.researchTimeoutMs ?? 1_800_000)
        : (plan.policy.timeoutMs ?? 30_000));
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > 2_147_483_647
    )
      throw new WebfoxError(
        "INVALID_INPUT",
        "timeoutMs must be a positive integer no larger than 2147483647.",
      );
    const scope = deadline(timeoutMs, request.signal);
    const outward = new OutwardBoundary();
    let active = true;
    const notify = (event: ProgressEvent) => {
      if (!active) return;
      try {
        request.onProgress?.(outward.value(event));
      } catch {
        // Observers must not interfere with execution or completion updates.
      }
    };
    const inputState = (
      input: string,
      inputIndex: number,
      state: NonNullable<ProgressEvent["state"]>,
    ) =>
      notify({
        capability,
        provider: definition.id,
        message: `${state}: ${input}`,
        input,
        inputIndex,
        state,
      });
    const context: ProviderContext = {
      cwd: this.cwd,
      env: this.env,
      signal: scope.signal,
      retryPolicy: {
        retries: plan.policy.retries ?? 0,
        delayMs: plan.policy.retryDelayMs ?? 2000,
      },
      onProgress: (message) => {
        if (!scope.signal.aborted)
          notify({ capability, provider: definition.id, message });
      },
    };
    const fail = (input: string, error: unknown): InputResult<never> => ({
      input,
      ok: false,
      error: outward.error(scope.signal.aborted ? scope.signal.reason : error),
    });
    try {
      scope.signal.throwIfAborted();
      const config = await this.credentials.prepare(
        definition,
        plan.stored,
        capability,
        scope.signal,
        outward,
      );
      const adapter = await withSignal<ProviderAdapter<any>>(
        definition.load(),
        scope.signal,
      );
      const run = async (
        input: string,
      ): Promise<InputResult<CapabilityValues[C]>> => {
        try {
          if (capability === "contents") {
            const response = (await this.run(
              adapter,
              config,
              {
                capability: "contents",
                urls: [input],
                options: plan.options,
              },
              plan,
              context,
            )) as ProviderResult<"contents">;
            if (
              response.answers.length !== 1 ||
              response.answers[0].inputIndex !== 0
            )
              throw new WebfoxError(
                "PROVIDER_FAILURE",
                "Provider returned missing, duplicate, or invalid contents input indexes.",
              );
            const answer = response.answers[0];
            if (answer.error)
              throw new WebfoxError(answer.error.code, answer.error.message, {
                retryable: answer.error.retryable,
              });
            const { inputIndex: _index, error: _error, ...value } = answer;
            return { input, ok: true, value: value as CapabilityValues[C] };
          }
          const operation: ProviderRequest =
            capability === "search"
              ? {
                  capability,
                  query: input,
                  maxResults: plan.maxResults!,
                  options: plan.options,
                }
              : capability === "answer"
                ? { capability, query: input, options: plan.options }
                : { capability: "research", input, options: plan.options };
          const result = await this.run(
            adapter,
            config,
            operation,
            plan,
            context,
          );
          const value =
            capability === "search"
              ? {
                  results: (result as ProviderResult<"search">).results.slice(
                    0,
                    plan.maxResults,
                  ),
                }
              : textValue(result as ProviderResult<"answer">);
          return { input, ok: true, value: value as CapabilityValues[C] };
        } catch (error) {
          return fail(input, error);
        }
      };
      // Schedule all inputs individually, preserving completed work and order.
      inputs.forEach((input, index) => inputState(input, index, "queued"));
      const results = await orderedMap(
        inputs,
        plan.policy.concurrency ?? 4,
        async (input, inputIndex) => {
          if (!scope.signal.aborted) inputState(input, inputIndex, "running");
          const result = await run(input);
          inputState(
            input,
            inputIndex,
            result.ok
              ? "done"
              : result.error.code === "CANCELLED"
                ? "cancelled"
                : "failed",
          );
          return result;
        },
      );
      return outward.value({
        schemaVersion: 1,
        capability,
        provider: definition.id,
        status: results.every((result) => result.ok) ? "ok" : "partial",
        results,
      });
    } catch (error) {
      if (scope.signal.aborted)
        return outward.value({
          schemaVersion: 1,
          capability,
          provider: definition.id,
          status: "partial",
          results: inputs.map((input) => fail(input, error)),
        });
      throw outward.exception(error);
    } finally {
      active = false;
      scope.dispose();
    }
  }

  private async run(
    adapter: ProviderAdapter<any>,
    config: ProviderConfig,
    request: ProviderRequest,
    plan: ExecutionPlan<Capability>,
    context: ProviderContext,
  ): Promise<ProviderResult> {
    const execute = adapter[request.capability];
    if (!execute)
      throw new WebfoxError(
        "PROVIDER_UNAVAILABLE",
        `Provider does not implement ${request.capability}.`,
      );
    const retries = plan.definition.capabilities[request.capability]?.retrySafe
      ? (context.retryPolicy?.retries ?? 0)
      : 0;
    for (let attempt = 0; ; attempt++) {
      context.signal!.throwIfAborted();
      try {
        // Dispatch is safe because request, definition, and resolved config were
        // selected together in the plan; no SDK types enter the application API.
        const result = await withSignal<ProviderResult>(
          execute(request as never, config, context),
          context.signal,
        );
        if (request.capability === "contents") {
          const page = (result as ProviderResult<"contents">).answers[0];
          if (page?.error)
            throw new WebfoxError(page.error.code, page.error.message, {
              retryable: page.error.retryable,
            });
        }
        return result;
      } catch (error) {
        if (context.signal!.aborted) throw context.signal!.reason;
        const normalized = asWebfoxError(error);
        if (!normalized.options.retryable || attempt >= retries)
          throw normalized;
        const delay = Math.min(
          (context.retryPolicy?.delayMs ?? 2000) * 2 ** attempt,
          30_000,
        );
        context.onProgress?.(
          `Retrying ${request.capability} in ${delay}ms (attempt ${attempt + 2}).`,
        );
        await sleep(delay, context.signal);
      }
    }
  }
}
function textValue(value: ProviderResult<"answer">) {
  return {
    text: value.text,
    ...(value.itemCount === undefined ? {} : { itemCount: value.itemCount }),
    ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
  };
}
