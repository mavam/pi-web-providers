import type { ExecutionSettings } from "./types.js";

export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
export const DEFAULT_RETRY_COUNT = 3;
export const DEFAULT_RETRY_DELAY_MS = 2000;
export const DEFAULT_RESEARCH_POLL_INTERVAL_MS = 3000;
export const DEFAULT_RESEARCH_TIMEOUT_MS = 1800000;
export const DEFAULT_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS = 3;
export const DEFAULT_GEMINI_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS = 10;

export function createDefaultExecutionSettings(
  overrides: Partial<ExecutionSettings> = {},
): ExecutionSettings {
  return {
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    retryCount: DEFAULT_RETRY_COUNT,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    researchTimeoutMs: DEFAULT_RESEARCH_TIMEOUT_MS,
    ...overrides,
  };
}
