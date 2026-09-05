import type { Capability } from "../../domain.js";
export interface CustomCommandConfig {
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
}
export interface Custom {
  commands?: Partial<Record<Capability, CustomCommandConfig>>;
}
