import type { TObject } from "typebox";
import type {
  ProviderCapabilityStatus,
  ProviderConfig,
  ProviderContext,
  ProviderId,
  ProviderResult,
  Tool,
} from "../types.js";

export type SearchInput = {
  query: string;
  maxResults: number;
};

export type ContentsInput = {
  urls: string[];
};

export type AnswerInput = {
  query: string;
};

export type ResearchInput = {
  input: string;
};

export type CapabilityInput<TInput extends object, TOptions> = TInput &
  (TOptions extends undefined ? object : { options?: TOptions });

export interface CapabilityLimits {
  maxResults?: number;
}

export interface CapabilityDefinition<
  TInput extends object,
  TOptions extends object | undefined = undefined,
  TResult = unknown,
> {
  options?: TObject;
  limits?: CapabilityLimits;
  promptGuidelines?: readonly string[];
  execute(
    input: CapabilityInput<TInput, TOptions>,
    context: ProviderExecutionContext,
  ): Promise<TResult>;
}

export interface ProviderExecutionContext extends ProviderContext {
  config: ProviderConfig;
}

export type ProviderConfigField =
  | "accountId"
  | "credentials"
  | "baseUrl"
  | "codexPath"
  | "config"
  | "customOptions"
  | "env"
  | "options"
  | "pathToClaudeCodeExecutable"
  | "settings";

export interface ProviderConfigDefinition<TConfig> {
  createTemplate: () => TConfig;
  fields: readonly ProviderConfigField[];
  credentials?: Record<string, string>;
  optionCapabilities?: readonly Tool[];
}

export interface ProviderDefinition<
  TId extends string,
  TConfig,
  TCapabilities extends Partial<Record<Tool, CapabilityDefinition<object>>>,
> {
  id: TId;
  label: string;
  docsUrl: string;
  config: ProviderConfigDefinition<TConfig>;
  capabilities: TCapabilities;
  getCapabilityStatus(
    config: TConfig | undefined,
    cwd: string,
    tool?: Tool,
  ): ProviderCapabilityStatus;
}

export type ProviderRegistry = Record<
  ProviderId,
  ProviderDefinition<
    ProviderId,
    ProviderConfig,
    Partial<Record<Tool, CapabilityDefinition<object>>>
  >
>;

export function defineCapability<
  TInput extends object,
  TOptions extends object | undefined = undefined,
  TResult = unknown,
>(
  definition: CapabilityDefinition<TInput, TOptions, TResult>,
): CapabilityDefinition<TInput, TOptions, TResult> {
  return definition;
}

export function defineProvider<
  const TId extends string,
  TConfig,
  const TCapabilities extends Partial<
    Record<Tool, CapabilityDefinition<object>>
  >,
>(
  definition: ProviderDefinition<TId, TConfig, TCapabilities>,
): ProviderDefinition<TId, TConfig, TCapabilities> {
  return definition;
}

export function defineProviders<const TProviders extends ProviderRegistry>(
  providers: TProviders,
): TProviders {
  return providers;
}

export async function executeProviderCapability<TTool extends Tool>(
  definition: ProviderDefinition<
    ProviderId,
    ProviderConfig,
    Partial<Record<Tool, CapabilityDefinition<object>>>
  >,
  capability: TTool,
  input: object,
  context: ProviderExecutionContext,
): Promise<ProviderResult<TTool>> {
  const handler = definition.capabilities[capability];
  if (!handler) {
    throw new Error(
      `Provider '${definition.id}' does not support '${capability}'.`,
    );
  }
  return (await handler.execute(input, context)) as ProviderResult<TTool>;
}
