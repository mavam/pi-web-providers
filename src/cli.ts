#!/usr/bin/env node

import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  createWebMux,
  createInitialConfig,
  loadConfig,
  redactConfig,
  resolveConfigPath,
  writeConfig,
  WebMuxError,
} from "./index.js";
import { PROVIDER_CATALOG, PROVIDERS_BY_ID } from "./web-mux/catalog.js";
import {
  deepMerge,
  renderTextDocument,
  validateConfiguredOptions,
} from "./web-mux/client.js";
import { loadProvider } from "./web-mux/provider-loader.js";
import type {
  Capability,
  CapabilityDocument,
  ProviderId,
  WebMuxConfig,
} from "./web-mux/public-types.js";

const VERSION = "0.1.0";
const RESERVED_FLAGS = new Set([
  "provider",
  "config",
  "cwd",
  "timeout",
  "retries",
  "retry-delay",
  "output",
  "raw",
  "options-json",
  "quiet",
  "color",
  "help",
  "version",
  "query",
  "max-results",
  "force",
]);

interface CliIO {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
  cwd: string;
  signalSource?: Pick<EventEmitter, "once" | "removeListener">;
}

interface ParsedArgs {
  positionals: string[];
  provider?: ProviderId;
  configPath?: string;
  cwd?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  output: "text" | "json";
  raw: boolean;
  optionsJson?: string;
  quiet: boolean;
  noColor: boolean;
  help: boolean;
  version: boolean;
  force: boolean;
  queries: string[];
  maxResults?: number;
  typedOptions: Record<string, unknown>;
}

export interface OptionFlag {
  flag: string;
  negativeFlag?: string;
  path: string[];
  kind: "string" | "number" | "integer" | "boolean" | "array";
  itemKind?: "string" | "number" | "integer" | "boolean";
  enumValues?: unknown[];
  description?: string;
}

export async function runCli(
  argv: string[],
  io: CliIO = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: process.cwd(),
  },
): Promise<number> {
  try {
    if (argv.length === 0) {
      io.stdout.write(`${rootHelp()}\n`);
      return 0;
    }
    if (argv.includes("--version") || argv[0] === "version") {
      io.stdout.write(`${VERSION}\n`);
      return 0;
    }
    if (argv[0] === "--help" || argv[0] === "help") {
      io.stdout.write(`${rootHelp()}\n`);
      return 0;
    }

    const command = argv[0];
    const rest = argv.slice(1);
    if (command === "providers") return await providersCommand(rest, io);
    if (command === "config") return await configCommand(rest, io);
    if (!isCapability(command)) usage(`Unknown command '${command}'`);

    const first = firstPass(rest);
    const configPath = first.configPath;
    const config = await loadConfig({ configPath, env: io.env });
    const selected = first.provider ?? config.defaults?.[command]?.provider;
    const schema = selected
      ? await createWebMux({
          config,
          cwd: first.cwd ?? io.cwd,
        }).getProviderOptionSchema(selected, command)
      : undefined;
    const flags = schema ? buildOptionFlags(schema) : [];
    const parsed = parseArgs(rest, flags);
    if (parsed.help) {
      io.stdout.write(`${capabilityHelp(command, selected, flags)}\n`);
      return 0;
    }

    const effective = applyExecutionOverrides(config, parsed, command);
    const cwd = parsed.cwd ? resolve(io.cwd, parsed.cwd) : io.cwd;
    const optionsJson = await parseOptionsJson(parsed.optionsJson, cwd);
    const providerOptions = deepMerge(optionsJson, parsed.typedOptions);
    const controller = new AbortController();
    const onSignal = () =>
      controller.abort(new DOMException("Operation cancelled", "AbortError"));
    const signalSource = io.signalSource ?? process;
    signalSource.once("SIGINT", onSignal);

    try {
      const client = createWebMux({ config: effective, cwd });
      const progress = parsed.quiet
        ? undefined
        : (event: { message: string }) => io.stderr.write(`${event.message}\n`);
      let result: CapabilityDocument<unknown>;
      if (command === "search") {
        const queries = await queryInputs(parsed, io, "search");
        result = await client.search({
          provider: parsed.provider,
          queries,
          ...(parsed.maxResults === undefined
            ? {}
            : { maxResults: parsed.maxResults }),
          options: providerOptions,
          signal: controller.signal,
          onProgress: progress,
          raw: parsed.raw,
        });
      } else if (command === "contents") {
        const urls = await contentsInputs(parsed.positionals, io);
        result = await client.contents({
          provider: parsed.provider,
          urls,
          options: providerOptions,
          signal: controller.signal,
          onProgress: progress,
          raw: parsed.raw,
        });
      } else if (command === "answer") {
        const queries = await queryInputs(parsed, io, "answer");
        result = await client.answer({
          provider: parsed.provider,
          queries,
          options: providerOptions,
          signal: controller.signal,
          onProgress: progress,
          raw: parsed.raw,
        });
      } else {
        const input = await researchInput(parsed.positionals, io);
        result = await client.research({
          provider: parsed.provider,
          input,
          options: providerOptions,
          signal: controller.signal,
          onProgress: progress,
          raw: parsed.raw,
        });
      }

      writeResult(result, parsed, io);
      if (result.results.some((entry) => entry.error?.code === "CANCELLED"))
        return 130;
      return result.status === "partial" ? 1 : 0;
    } finally {
      signalSource.removeListener("SIGINT", onSignal);
    }
  } catch (error) {
    const normalized =
      error instanceof WebMuxError
        ? error
        : new WebMuxError(
            "INVALID_INPUT",
            error instanceof Error ? error.message : String(error),
            { cause: error },
          );
    io.stderr.write(`web: ${normalized.message}\n`);
    return normalized.code === "CANCELLED"
      ? 130
      : normalized.code === "INVALID_CONFIG" ||
          normalized.code === "INVALID_INPUT"
        ? 2
        : 1;
  }
}

export function buildOptionFlags(
  schema: Record<string, unknown>,
): OptionFlag[] {
  const candidates: OptionFlag[] = [];
  walkSchema(schema, [], candidates);
  const counts = new Map<string, number>();
  for (const flag of candidates)
    counts.set(flag.flag, (counts.get(flag.flag) ?? 0) + 1);
  return candidates.filter(
    (entry) =>
      counts.get(entry.flag) === 1 && !RESERVED_FLAGS.has(entry.flag.slice(2)),
  );
}

function walkSchema(
  schema: Record<string, any>,
  path: string[],
  output: OptionFlag[],
): void {
  const properties = schema.properties;
  if (
    properties &&
    typeof properties === "object" &&
    !Array.isArray(properties)
  ) {
    for (const [name, child] of Object.entries(properties)) {
      const childSchema = child as Record<string, any>;
      const next = [...path, name];
      if (childSchema.type === "object" && childSchema.properties) {
        walkSchema(childSchema, next, output);
        continue;
      }
      const descriptor = flagForSchema(childSchema, next);
      if (descriptor) output.push(descriptor);
    }
  }
}

function flagForSchema(
  schema: Record<string, any>,
  path: string[],
): OptionFlag | undefined {
  const flag = `--${path.map(kebab).join("-")}`;
  const enumValues = readEnum(schema);
  const kind = schema.type ?? inferEnumKind(enumValues);
  if (["string", "number", "integer", "boolean"].includes(kind)) {
    return {
      flag,
      ...(kind === "boolean" ? { negativeFlag: `--no-${flag.slice(2)}` } : {}),
      path,
      kind,
      ...(enumValues ? { enumValues } : {}),
      ...(schema.description ? { description: schema.description } : {}),
    };
  }
  if (
    kind === "array" &&
    schema.items &&
    ["string", "number", "integer", "boolean"].includes(
      schema.items.type ?? inferEnumKind(readEnum(schema.items)),
    )
  ) {
    const itemKind = schema.items.type ?? inferEnumKind(readEnum(schema.items));
    return {
      flag,
      path,
      kind: "array",
      itemKind,
      ...(readEnum(schema.items) ? { enumValues: readEnum(schema.items) } : {}),
      ...(schema.description ? { description: schema.description } : {}),
    };
  }
  return undefined;
}

function readEnum(schema: Record<string, any>): unknown[] | undefined {
  if (Array.isArray(schema.enum)) return schema.enum;
  if (
    Array.isArray(schema.anyOf) &&
    schema.anyOf.every((entry: any) => "const" in entry)
  ) {
    return schema.anyOf.map((entry: any) => entry.const);
  }
  return undefined;
}

function inferEnumKind(
  values: unknown[] | undefined,
): "string" | "number" | "boolean" | undefined {
  const kind = typeof values?.[0];
  return kind === "string" || kind === "number" || kind === "boolean"
    ? kind
    : undefined;
}

function parseArgs(args: string[], flags: OptionFlag[]): ParsedArgs {
  const parsed: ParsedArgs = {
    positionals: [],
    output: "text",
    raw: false,
    quiet: false,
    noColor: false,
    help: false,
    version: false,
    force: false,
    queries: [],
    typedOptions: {},
  };
  const byFlag = new Map<
    string,
    { descriptor: OptionFlag; negative: boolean }
  >();
  for (const descriptor of flags) {
    byFlag.set(descriptor.flag, { descriptor, negative: false });
    if (descriptor.negativeFlag)
      byFlag.set(descriptor.negativeFlag, { descriptor, negative: true });
  }

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--") {
      parsed.positionals.push(...args.slice(index + 1));
      break;
    }
    const [name, inline] = splitFlag(token);
    if (!name.startsWith("--")) {
      parsed.positionals.push(token);
      continue;
    }
    const dynamic = byFlag.get(name);
    if (dynamic) {
      const { descriptor, negative } = dynamic;
      if (descriptor.kind === "boolean") {
        if (inline !== undefined) usage(`${name} does not take a value`);
        setPath(parsed.typedOptions, descriptor.path, !negative);
      } else {
        const raw = inline ?? nextValue(args, ++index, name);
        const value = parseTypedValue(raw, descriptor);
        if (descriptor.kind === "array")
          appendPath(parsed.typedOptions, descriptor.path, value);
        else setPath(parsed.typedOptions, descriptor.path, value);
      }
      continue;
    }
    const take = () => inline ?? nextValue(args, ++index, name);
    switch (name) {
      case "--provider": {
        const value = take();
        if (!(value in PROVIDERS_BY_ID)) usage(`Unknown provider '${value}'`);
        parsed.provider = value as ProviderId;
        break;
      }
      case "--config":
        parsed.configPath = take();
        break;
      case "--cwd":
        parsed.cwd = take();
        break;
      case "--timeout":
        parsed.timeout = integer(take(), name, 1);
        break;
      case "--retries":
        parsed.retries = integer(take(), name, 0);
        break;
      case "--retry-delay":
        parsed.retryDelay = integer(take(), name, 0);
        break;
      case "--output": {
        const value = take();
        if (value !== "text" && value !== "json")
          usage("--output must be text or json");
        parsed.output = value;
        break;
      }
      case "--options-json":
        parsed.optionsJson = take();
        break;
      case "--query":
        parsed.queries.push(take());
        break;
      case "--max-results":
        parsed.maxResults = integer(take(), name, 1);
        break;
      case "--raw":
        parsed.raw = true;
        break;
      case "--quiet":
        parsed.quiet = true;
        break;
      case "--no-color":
        parsed.noColor = true;
        break;
      case "--help":
        parsed.help = true;
        break;
      case "--version":
        parsed.version = true;
        break;
      case "--force":
        parsed.force = true;
        break;
      default:
        usage(`Unknown option '${name}'`);
    }
  }
  if (parsed.raw && parsed.output === "json")
    usage("--raw cannot be combined with --output json");
  return parsed;
}

function firstPass(args: string[]): {
  provider?: ProviderId;
  configPath?: string;
  cwd?: string;
} {
  const result: { provider?: ProviderId; configPath?: string; cwd?: string } =
    {};
  for (let index = 0; index < args.length; index += 1) {
    const [name, inline] = splitFlag(args[index]);
    if (name === "--provider")
      result.provider = (inline ?? args[index + 1]) as ProviderId;
    if (name === "--config") result.configPath = inline ?? args[index + 1];
    if (name === "--cwd") result.cwd = inline ?? args[index + 1];
    if (!inline && ["--provider", "--config", "--cwd"].includes(name))
      index += 1;
  }
  return result;
}

async function providersCommand(args: string[], io: CliIO): Promise<number> {
  const parsed = parseArgs(args, []);
  const config = await loadConfig({
    configPath: parsed.configPath,
    env: io.env,
  });
  const id = parsed.positionals[0] as ProviderId | undefined;
  if (id) {
    const metadata = PROVIDERS_BY_ID[id];
    if (!metadata) usage(`Unknown provider '${id}'`);
    io.stdout.write(
      `${metadata.label} (${metadata.id})\n${metadata.docsUrl}\n\nCapabilities: ${metadata.capabilities.join(", ")}\n`,
    );
    if (metadata.credentials.length > 0) {
      io.stdout.write(
        `Credentials:\n${metadata.credentials.map((entry) => `  ${entry.name}: ${entry.environmentVariable}`).join("\n")}\n`,
      );
    } else {
      io.stdout.write("Credentials: none\n");
    }
    if (id === "cloudflare") {
      io.stdout.write("  accountId: CLOUDFLARE_ACCOUNT_ID\n");
    }
    const definition = await loadProvider(id);
    const providerDefaults = (
      definition.config.createTemplate() as { options?: unknown }
    ).options;
    io.stdout.write(
      `Defaults:\n${providerDefaults === undefined ? "  SDK defaults\n" : `${indent(JSON.stringify(providerDefaults, null, 2))}\n`}`,
    );
    const selectedDefaults = Object.entries(config.defaults ?? {})
      .filter(([, entry]) => entry?.provider === id)
      .map(([capability, entry]) => `${capability}: ${JSON.stringify(entry)}`);
    if (selectedDefaults.length > 0) {
      io.stdout.write(
        `Configured capability defaults:\n${selectedDefaults.map((line) => `  ${line}`).join("\n")}\n`,
      );
    }
    const client = createWebMux({ config, cwd: parsed.cwd ?? io.cwd });
    for (const capability of metadata.capabilities) {
      const schema = await client.getProviderOptionSchema(id, capability);
      const flags = schema ? buildOptionFlags(schema) : [];
      io.stdout.write(
        `\n${capability} options: ${flags.length ? flags.map((entry) => entry.flag).join(", ") : "none"}\n`,
      );
    }
    return 0;
  }
  const headers = ["Provider", "Search", "Contents", "Answer", "Research"];
  const rows = PROVIDER_CATALOG.map((provider) => [
    provider.id,
    ...(["search", "contents", "answer", "research"] as Capability[]).map(
      (capability) =>
        provider.capabilities.includes(capability)
          ? providerStatus(provider.id, capability, config, io.env)
          : "—",
    ),
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  io.stdout.write(
    `${[headers, ...rows].map((row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ")).join("\n")}\n`,
  );
  return 0;
}

function providerStatus(
  id: ProviderId,
  capability: Capability,
  config: WebMuxConfig,
  env: NodeJS.ProcessEnv,
): string {
  if (id === "custom")
    return config.providers?.custom?.commands?.[capability] ? "ready" : "setup";
  const metadata = PROVIDERS_BY_ID[id];
  const credentials = metadata.credentials.filter(
    (credential) =>
      !credential.capabilities || credential.capabilities.includes(capability),
  );
  const credentialReady = credentials.every(
    (credential) =>
      config.providers?.[id]?.credentials?.[credential.name] !== undefined ||
      env[credential.environmentVariable] !== undefined,
  );
  if (!credentialReady) return "setup";
  if (
    id === "cloudflare" &&
    !config.providers?.cloudflare?.accountId &&
    !env.CLOUDFLARE_ACCOUNT_ID
  )
    return "setup";
  return metadata.local && credentials.length === 0 ? "local" : "ready";
}

async function configCommand(args: string[], io: CliIO): Promise<number> {
  const subcommand = args[0];
  const parsed = parseArgs(args.slice(1), []);
  const path = resolveConfigPath({
    configPath: parsed.configPath,
    env: io.env,
  });
  switch (subcommand) {
    case "path":
      io.stdout.write(`${path}\n`);
      return 0;
    case "init": {
      const written = await writeConfig(createInitialConfig(), {
        configPath: path,
        env: io.env,
        force: parsed.force,
      });
      io.stdout.write(`${written}\n`);
      return 0;
    }
    case "show": {
      const config = await loadConfig({ configPath: path, env: io.env });
      io.stdout.write(`${JSON.stringify(redactConfig(config), null, 2)}\n`);
      return 0;
    }
    case "validate": {
      const config = await loadConfig({ configPath: path, env: io.env });
      await validateConfiguredOptions(config);
      io.stdout.write(`Valid configuration: ${path}\n`);
      return 0;
    }
    case "edit": {
      const editor = io.env.VISUAL || io.env.EDITOR;
      if (!editor) usage("Set VISUAL or EDITOR before using 'web config edit'");
      await new Promise<void>((resolvePromise, reject) => {
        const child = spawn(editor, [path], { stdio: "inherit" });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolvePromise()
            : reject(new Error(`${editor} exited with code ${code}`)),
        );
      });
      return 0;
    }
    default:
      usage("Usage: web config path|init|show|edit|validate [--config <path>]");
  }
}

function applyExecutionOverrides(
  config: WebMuxConfig,
  parsed: ParsedArgs,
  capability: Capability,
): WebMuxConfig {
  const clone = structuredClone(config);
  clone.execution = {
    ...(clone.execution ?? {}),
    ...(parsed.timeout === undefined
      ? {}
      : capability === "research"
        ? { researchTimeoutMs: parsed.timeout }
        : { timeoutMs: parsed.timeout }),
    ...(parsed.retries === undefined ? {} : { retries: parsed.retries }),
    ...(parsed.retryDelay === undefined
      ? {}
      : { retryDelayMs: parsed.retryDelay }),
  };
  return clone;
}

async function parseOptionsJson(
  value: string | undefined,
  cwd: string,
): Promise<Record<string, unknown>> {
  if (!value) return {};
  const text = value.startsWith("@")
    ? await readFile(resolve(cwd, value.slice(1)), "utf8")
    : value;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      usage("--options-json must contain a JSON object");
    return parsed;
  } catch (error) {
    if (error instanceof WebMuxError) throw error;
    usage(
      `Invalid --options-json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function queryInputs(
  parsed: ParsedArgs,
  io: CliIO,
  capability: "search" | "answer",
): Promise<string[]> {
  if (parsed.positionals.length > 1)
    usage(
      `${capability} accepts at most one positional input; use repeated --query for more`,
    );
  const positional = parsed.positionals[0];
  const first =
    positional === "-" ? (await readStdin(io.stdin)).trim() : positional;
  const values = [...(first ? [first] : []), ...parsed.queries];
  if (values.length === 0) usage(`${capability} requires a query or '-'`);
  if (values.length > 10) usage(`${capability} accepts at most ten inputs`);
  return values;
}

async function contentsInputs(
  positionals: string[],
  io: CliIO,
): Promise<string[]> {
  if (positionals.length === 1 && positionals[0] === "-") {
    return (await readStdin(io.stdin))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (positionals.includes("-"))
    usage("Use '-' by itself for newline-separated URLs on stdin");
  if (positionals.length === 0)
    usage("contents requires one or more URLs or '-'");
  return positionals;
}

async function researchInput(
  positionals: string[],
  io: CliIO,
): Promise<string> {
  if (positionals.length !== 1)
    usage("research requires exactly one brief or '-'");
  return positionals[0] === "-"
    ? (await readStdin(io.stdin)).trim()
    : positionals[0];
}

async function readStdin(stream: NodeJS.ReadableStream): Promise<string> {
  let output = "";
  stream.setEncoding?.("utf8");
  for await (const chunk of stream) output += chunk;
  return output;
}

function writeResult(
  result: CapabilityDocument<unknown>,
  parsed: ParsedArgs,
  io: CliIO,
): void {
  if (parsed.raw) {
    const raw = {
      schemaVersion: 1,
      capability: result.capability,
      provider: result.provider,
      status: result.status,
      results: result.results.map((entry) => ({
        input: entry.input,
        ok: entry.ok,
        ...(entry.raw ? { raw: entry.raw.providerPayload } : {}),
        ...(entry.error ? { error: entry.error } : {}),
      })),
    };
    io.stdout.write(`${JSON.stringify(raw, null, 2)}\n`);
  } else if (parsed.output === "json") {
    io.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    io.stdout.write(`${renderTextDocument(result as any)}\n`);
  }
}

function capabilityHelp(
  capability: Capability,
  provider: ProviderId | undefined,
  flags: OptionFlag[],
): string {
  const syntax = {
    search: "web search [query|-] [--query <query>...] [--max-results <n>]",
    contents: "web contents <url...|->",
    answer: "web answer [question|-] [--query <question>...]",
    research: "web research <brief|->",
  }[capability];
  const common = [
    "--provider <id>",
    "--config <path>",
    "--cwd <path>",
    "--timeout <ms>",
    "--retries <n>",
    "--retry-delay <ms>",
    "--output text|json",
    "--raw",
    "--options-json <json|@file>",
    "--quiet",
    "--no-color",
    "--help",
    "--version",
  ];
  const providerSection = provider
    ? `\n${PROVIDERS_BY_ID[provider].label} options:\n${flags.length ? flags.map(formatFlagHelp).join("\n") : "  (none; use --options-json for complex values)"}`
    : "\nNo provider selected. Pass --provider or configure a capability default.";
  return `${syntax}\n\nOptions:\n${common.map((flag) => `  ${flag}`).join("\n")}${providerSection}`;
}

function formatFlagHelp(flag: OptionFlag): string {
  const syntax =
    flag.kind === "boolean"
      ? `${flag.flag} / ${flag.negativeFlag}`
      : `${flag.flag} <value>`;
  const values = flag.enumValues ? ` (${flag.enumValues.join("|")})` : "";
  return `  ${syntax}${values}${flag.description ? `  ${flag.description}` : ""}`;
}

function rootHelp(): string {
  return `web-mux ${VERSION}\n\nUsage: web <command> [options]\n\nCommands:\n  search      Search the web\n  contents    Fetch URL contents\n  answer      Produce grounded answers\n  research    Run foreground research\n  providers   Show provider capabilities and status\n  config      Manage configuration\n\nRun 'web <command> --help' for command options.`;
}

function parseTypedValue(raw: string, descriptor: OptionFlag): unknown {
  const itemKind =
    descriptor.kind === "array" ? inferArrayKind(descriptor) : descriptor.kind;
  let value: unknown = raw;
  if (itemKind === "number" || itemKind === "integer") {
    value = Number(raw);
    if (
      !Number.isFinite(value) ||
      (itemKind === "integer" && !Number.isInteger(value))
    )
      usage(`${descriptor.flag} requires a ${itemKind}`);
  } else if (itemKind === "boolean") {
    if (raw !== "true" && raw !== "false")
      usage(`${descriptor.flag} requires true or false`);
    value = raw === "true";
  }
  if (descriptor.enumValues && !descriptor.enumValues.includes(value)) {
    usage(
      `${descriptor.flag} must be one of: ${descriptor.enumValues.join(", ")}`,
    );
  }
  return value;
}

function inferArrayKind(
  descriptor: OptionFlag,
): "string" | "number" | "integer" | "boolean" {
  if (descriptor.itemKind) return descriptor.itemKind;
  if (descriptor.enumValues?.length) {
    const type = typeof descriptor.enumValues[0];
    if (type === "number") return "number";
    if (type === "boolean") return "boolean";
  }
  return "string";
}

function splitFlag(token: string): [string, string | undefined] {
  if (!token.startsWith("--")) return [token, undefined];
  const index = token.indexOf("=");
  return index < 0
    ? [token, undefined]
    : [token.slice(0, index), token.slice(index + 1)];
}

function nextValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--"))
    usage(`${flag} requires a value`);
  return value;
}

function integer(value: string, flag: string, min: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min)
    usage(`${flag} must be an integer >= ${min}`);
  return parsed;
}

function setPath(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let cursor = target;
  for (const part of path.slice(0, -1)) {
    const existing = cursor[part];
    cursor[part] =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? existing
        : {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[path.at(-1)!] = value;
}

function appendPath(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let cursor = target;
  for (const part of path.slice(0, -1)) {
    const existing = cursor[part];
    cursor[part] =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? existing
        : {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  const key = path.at(-1)!;
  cursor[key] = [
    ...(Array.isArray(cursor[key]) ? (cursor[key] as unknown[]) : []),
    value,
  ];
}

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function isCapability(value: string): value is Capability {
  return (
    value === "search" ||
    value === "contents" ||
    value === "answer" ||
    value === "research"
  );
}

function usage(message: string): never {
  throw new WebMuxError("INVALID_INPUT", message);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(realpathSync(resolve(process.argv[1]))).href
  : undefined;
if (invokedPath === import.meta.url) {
  process.exitCode = await runCli(process.argv.slice(2));
}
