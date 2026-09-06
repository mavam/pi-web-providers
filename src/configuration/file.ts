import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { TSchema } from "typebox";
import { Check, Errors } from "typebox/value";
import { CONFIG_SCHEMA_URL } from "../package-metadata.js";
import { WebfoxError } from "../errors.js";
import { configurationSchema } from "./schema.js";
import type { WebfoxConfig } from "./types.js";
export { CONFIG_SCHEMA_URL };

export interface ConfigPathOptions {
  configPath?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  home?: string;
}
export function resolveConfigPath(options: ConfigPathOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  if (options.configPath) return resolve(cwd, options.configPath);
  if (env.WEBFOX_CONFIG) return resolve(cwd, env.WEBFOX_CONFIG);
  if ((options.platform ?? process.platform) === "win32" && env.APPDATA)
    return join(env.APPDATA, "webfox", "config.json");
  return join(
    env.XDG_CONFIG_HOME ?? join(options.home ?? homedir(), ".config"),
    "webfox",
    "config.json",
  );
}
export async function loadConfig(
  options: ConfigPathOptions = {},
): Promise<WebfoxConfig> {
  const path = resolveConfigPath(options);
  try {
    return parseConfig(await readFile(path, "utf8"), path);
  } catch (error) {
    return readFailure(error, options, path);
  }
}
export function loadConfigSync(options: ConfigPathOptions = {}): WebfoxConfig {
  const path = resolveConfigPath(options);
  try {
    return parseConfig(readFileSync(path, "utf8"), path);
  } catch (error) {
    return readFailure(error, options, path);
  }
}
function readFailure(
  error: unknown,
  options: ConfigPathOptions,
  path: string,
): WebfoxConfig {
  if (
    (error as NodeJS.ErrnoException).code === "ENOENT" &&
    !options.configPath &&
    !(options.env ?? process.env).WEBFOX_CONFIG
  )
    return {};
  if (error instanceof WebfoxError) throw error;
  throw new WebfoxError(
    "INVALID_CONFIG",
    `Could not read configuration: ${path}. Check the path and file permissions.`,
  );
}
export function parseConfig(
  text: string,
  source = "config.json",
): WebfoxConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WebfoxError(
      "INVALID_CONFIG",
      `Invalid JSON in ${source}. Fix its JSON syntax and try again.`,
    );
  }
  return validateConfig(parsed, source);
}
export function validateConfig(
  value: unknown,
  source = "configuration",
): WebfoxConfig {
  const schema = configurationSchema as unknown as TSchema;
  if (!Check(schema, value)) {
    const detail = Errors(schema, value)
      .slice(0, 3)
      .map((error) => `${error.instancePath || "/"}: ${error.message}`)
      .join("; ");
    throw new WebfoxError(
      "INVALID_CONFIG",
      `Invalid ${source}: ${detail}. Provider options belong under providers.<id>.options.<capability>.`,
    );
  }
  return structuredClone(value) as WebfoxConfig;
}
export function redactConfig(config: WebfoxConfig): unknown {
  const visit = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(visit);
    if (!entry || typeof entry !== "object") return entry;
    if ("value" in entry) return { value: "[redacted]" };
    if ("command" in entry) return { command: ["[redacted]"] };
    return Object.fromEntries(
      Object.entries(entry).map(([key, child]) => [key, visit(child)]),
    );
  };
  return visit(config);
}
