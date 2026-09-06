import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { TSchema } from "typebox";
import { parseDocument, visit, isAlias, isMap, isScalar } from "yaml";
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
    return join(env.APPDATA, "webfox", "config.yaml");
  return join(
    env.XDG_CONFIG_HOME ?? join(options.home ?? homedir(), ".config"),
    "webfox",
    "config.yaml",
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
// Keep the YAML document for narrow, comment-preserving updates.
export function parseConfigDocument(text: string, source = "config.yaml") {
  try {
    const document = parseDocument(text, { version: "1.2", schema: "core" });
    if (
      document.errors.length ||
      document.warnings.length ||
      document.directives?.yaml.version !== "1.2"
    )
      throw new Error("Invalid YAML 1.2");
    visit(document, (_key, node) => {
      if (
        isAlias(node) ||
        (node && typeof node === "object" && "tag" in node && node.tag)
      )
        throw new Error("Aliases and explicit tags are not supported");
      if (
        isMap(node) &&
        node.items.some(
          ({ key }) => !isScalar(key) || typeof key.value !== "string",
        )
      )
        throw new Error("Mapping keys must be strings");
      if (
        isScalar(node) &&
        typeof node.value === "number" &&
        !Number.isFinite(node.value)
      )
        throw new Error("Numbers must be finite");
    });
    return document;
  } catch {
    // Parser diagnostics can contain source snippets, including credentials.
    throw new WebfoxError(
      "INVALID_CONFIG",
      `Invalid YAML in ${source}. Use one YAML 1.2 document with unique keys, with string keys and finite numbers, without aliases or explicit tags.`,
    );
  }
}
export function parseConfig(
  text: string,
  source = "config.yaml",
): WebfoxConfig {
  const document = parseConfigDocument(text, source);
  return validateConfig(
    document.contents === null ? {} : document.toJS({ maxAliasCount: 0 }),
    source,
  );
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
