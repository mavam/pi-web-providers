import type { Provider } from "../contract.js";

export interface Codex extends Provider {
  codexPath?: string;
  baseUrl?: string;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
}
