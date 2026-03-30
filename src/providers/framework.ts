import type { ContentsResponse } from "../contents.js";
import {
  createBackgroundResearchPlan,
  createSilentForegroundPlan,
  createStreamingForegroundPlan,
} from "../provider-plans.js";
import type {
  AnswerRequest,
  BackgroundResearchPlan,
  ContentsRequest,
  ExecutionSettings,
  ProviderContext,
  ProviderPlan,
  ProviderPlanTraits,
  ProviderRequest,
  ResearchJob,
  ResearchPollResult,
  ResearchRequest,
  SearchRequest,
  SearchResponse,
  ToolOutput,
} from "../types.js";

interface ConfigWithSettings {
  settings?: ExecutionSettings;
}

type ForegroundHandler<
  TConfig,
  TRequest extends ProviderRequest,
  TResult extends SearchResponse | ContentsResponse | ToolOutput,
> = {
  deliveryMode: "silent-foreground" | "streaming-foreground";
  traits?: Omit<ProviderPlanTraits, "settings">;
  execute: (
    request: TRequest,
    config: TConfig,
    context: ProviderContext,
  ) => Promise<TResult>;
};

type BackgroundResearchHandler<TConfig> = {
  deliveryMode: "background-research";
  traits?: Omit<ProviderPlanTraits, "settings">;
  start: (
    request: ResearchRequest,
    config: TConfig,
    context: ProviderContext,
  ) => Promise<ResearchJob>;
  poll: (
    request: ResearchRequest,
    config: TConfig,
    id: string,
    context: ProviderContext,
  ) => Promise<ResearchPollResult>;
};

export interface ProviderCapabilityHandlers<TConfig> {
  search?: ForegroundHandler<TConfig, SearchRequest, SearchResponse>;
  contents?: ForegroundHandler<TConfig, ContentsRequest, ContentsResponse>;
  answer?: ForegroundHandler<TConfig, AnswerRequest, ToolOutput>;
  research?:
    | ForegroundHandler<TConfig, ResearchRequest, ToolOutput>
    | BackgroundResearchHandler<TConfig>;
}

export function buildProviderPlan<TConfig>({
  request,
  config,
  providerId,
  providerLabel,
  handlers,
  resolvePlanConfig,
}: {
  request: ProviderRequest;
  config: TConfig;
  providerId: ProviderPlan["providerId"];
  providerLabel: string;
  handlers: ProviderCapabilityHandlers<TConfig>;
  resolvePlanConfig?: (config: TConfig) => ConfigWithSettings;
}): ProviderPlan | null {
  const planConfig = resolvePlanConfig?.(config) ?? asPlanConfig(config);
  switch (request.capability) {
    case "search":
      return buildForegroundPlan({
        request,
        config,
        providerId,
        providerLabel,
        planConfig,
        handler: handlers.search,
      });
    case "contents":
      return buildForegroundPlan({
        request,
        config,
        providerId,
        providerLabel,
        planConfig,
        handler: handlers.contents,
      });
    case "answer":
      return buildForegroundPlan({
        request,
        config,
        providerId,
        providerLabel,
        planConfig,
        handler: handlers.answer,
      });
    case "research": {
      const handler = handlers.research;
      if (!handler) {
        return null;
      }

      if (isBackgroundResearchHandler(handler)) {
        return createBackgroundResearchPlan({
          config: planConfig,
          capability: "research",
          providerId,
          providerLabel,
          ...(handler.traits ? { traits: handler.traits } : {}),
          start: (context: ProviderContext) =>
            handler.start(request, config, context),
          poll: (id: string, context: ProviderContext) =>
            handler.poll(request, config, id, context),
        });
      }

      return buildForegroundPlan({
        request,
        config,
        providerId,
        providerLabel,
        planConfig,
        handler,
      });
    }
  }
}

function buildForegroundPlan<
  TConfig,
  TRequest extends ProviderRequest,
  TResult extends SearchResponse | ContentsResponse | ToolOutput,
>({
  request,
  config,
  providerId,
  providerLabel,
  planConfig,
  handler,
}: {
  request: TRequest;
  config: TConfig;
  providerId: ProviderPlan["providerId"];
  providerLabel: string;
  planConfig: ConfigWithSettings;
  handler: ForegroundHandler<TConfig, TRequest, TResult> | undefined;
}): ProviderPlan<TResult> | null {
  if (!handler) {
    return null;
  }

  const factory =
    handler.deliveryMode === "streaming-foreground"
      ? createStreamingForegroundPlan
      : createSilentForegroundPlan;

  return factory({
    config: planConfig,
    capability: request.capability,
    providerId,
    providerLabel,
    ...(handler.traits ? { traits: handler.traits } : {}),
    execute: (context: ProviderContext) =>
      handler.execute(request, config, context),
  });
}

function isBackgroundResearchHandler<TConfig>(
  handler:
    | ForegroundHandler<TConfig, ResearchRequest, ToolOutput>
    | BackgroundResearchHandler<TConfig>,
): handler is BackgroundResearchHandler<TConfig> {
  return handler.deliveryMode === "background-research";
}

function asPlanConfig<TConfig>(config: TConfig): ConfigWithSettings {
  if (typeof config === "object" && config !== null && "settings" in config) {
    return config as ConfigWithSettings;
  }
  return {};
}
