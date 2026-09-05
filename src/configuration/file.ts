import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { TSchema } from "typebox";
import { Check, Errors } from "typebox/value";
import { CONFIG_SCHEMA_URL } from "../package-metadata.js";
import { WebMuxError } from "../errors.js";
import { configurationSchema } from "./schema.js";
import type { WebMuxConfig } from "./types.js";
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
  if (env.WEB_MUX_CONFIG) return resolve(cwd, env.WEB_MUX_CONFIG);
  if ((options.platform ?? process.platform) === "win32" && env.APPDATA)
    return join(env.APPDATA, "web-mux", "config.json");
  return join(
    env.XDG_CONFIG_HOME ?? join(options.home ?? homedir(), ".config"),
    "web-mux",
    "config.json",
  );
}
export async function loadConfig(
  options: ConfigPathOptions = {},
): Promise<WebMuxConfig> {
  const path = resolveConfigPath(options);
  try {
    return parseConfig(await readFile(path, "utf8"), path);
  } catch (error) {
    return readFailure(error, options, path);
  }
}
export function loadConfigSync(options: ConfigPathOptions = {}): WebMuxConfig {
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
): WebMuxConfig {
  if (
    (error as NodeJS.ErrnoException).code === "ENOENT" &&
    !options.configPath &&
    !(options.env ?? process.env).WEB_MUX_CONFIG
  )
    return {};
  if (error instanceof WebMuxError) throw error;
  throw new WebMuxError(
    "INVALID_CONFIG",
    `Could not read configuration: ${path}. Check the path and file permissions.`,
  );
}
export function parseConfig(
  text: string,
  source = "config.json",
): WebMuxConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WebMuxError(
      "INVALID_CONFIG",
      `Invalid JSON in ${source}. Fix its JSON syntax and try again.`,
    );
  }
  return validateConfig(parsed, source);
}
export function validateConfig(
  value: unknown,
  source = "configuration",
): WebMuxConfig {
  const schema = configurationSchema as unknown as TSchema;
  if (!Check(schema, value)) {
    const detail = Errors(schema, value)
      .slice(0, 3)
      .map((error) => `${error.instancePath || "/"}: ${error.message}`)
      .join("; ");
    throw new WebMuxError(
      "INVALID_CONFIG",
      `Invalid ${source}: ${detail}. Provider options belong under providers.<id>.options.<capability>.`,
    );
  }
  return structuredClone(value) as WebMuxConfig;
}
export function redactConfig(config: WebMuxConfig): unknown {
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
