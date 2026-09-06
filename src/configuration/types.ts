import type { Capability, ProviderId } from "../domain.js";

export type CredentialSource =
  | { env: string }
  | { command: [string, ...string[]] }
  | { value: string };
export interface ExecutionConfig {
  timeoutMs?: number;
  researchTimeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  concurrency?: number;
}
export interface CapabilityDefault {
  provider?: ProviderId;
  maxResults?: number;
}
export interface CustomCommand {
  argv: [string, ...string[]];
  cwd?: string;
  env?: Record<string, CredentialSource>;
}
export interface ProviderConfiguration {
  credentials?: Record<string, CredentialSource>;
  baseUrl?: string;
  accountId?: CredentialSource;
  codexPath?: string;
  pathToClaudeCodeExecutable?: string;
  env?: Record<string, CredentialSource>;
  config?: Record<string, unknown>;
  options?: Partial<Record<Capability, Record<string, unknown>>>;
  commands?: Partial<Record<Capability, CustomCommand>>;
}
export interface WebfoxConfig {
  $schema?: string;
  defaults?: Partial<Record<Capability, CapabilityDefault>>;
  execution?: ExecutionConfig;
  providers?: Partial<Record<ProviderId, ProviderConfiguration>>;
}
