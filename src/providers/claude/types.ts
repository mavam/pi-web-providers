import type { Provider } from "../contract.js";

export interface Claude extends Provider {
  pathToClaudeCodeExecutable?: string;
}
