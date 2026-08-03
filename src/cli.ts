#!/usr/bin/env node

import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
} from "commander";
import pc from "picocolors";
import { PACKAGE_VERSION } from "./package-metadata.js";
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

const SUCCESS_MARK = "✔︎";
const FAILURE_MARK = "✘︎";
type Colors = ReturnType<typeof pc.createColors>;

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
  queries: string[];
  maxResults?: number;
  typedOptions: Record<string, unknown>;
}

interface CommanderOptions {
  provider?: ProviderId;
  config?: string;
  cwd?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  output?: "text" | "json";
  raw?: boolean;
  optionsJson?: string;
  quiet?: boolean;
  query?: string[];
  maxResults?: number;
  force?: boolean;
}

interface CliTheme {
  out: Colors;
  err: Colors;
}

interface CapabilityPreparation {
  capability: Capability;
  config: WebMuxConfig;
  provider?: ProviderId;
  flags: OptionFlag[];
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
  const theme = createTheme(argv, io);
  let exitCode = 0;
  try {
    const preparation = await prepareCapability(argv, io);
    const program = createProgram(argv, io, theme, preparation, (code) => {
      exitCode = code;
    });
    if (argv.length === 0) {
      program.outputHelp();
      return 0;
    }
    await program.parseAsync(argv, { from: "user" });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
    const normalized =
      error instanceof WebMuxError
        ? error
        : new WebMuxError(
            "INVALID_INPUT",
            error instanceof Error ? error.message : String(error),
            { cause: error },
          );
    writeCliError(normalized.message, io, theme);
    return normalized.code === "CANCELLED"
      ? 130
      : normalized.code === "INVALID_CONFIG" ||
          normalized.code === "INVALID_INPUT"
        ? 2
        : 1;
  }
}

async function prepareCapability(
  argv: string[],
  io: CliIO,
): Promise<CapabilityPreparation | undefined> {
  const capability = argv[0];
  if (!isCapability(capability)) return undefined;
  const first = firstPass(argv.slice(1));
  const config = await loadConfig({
    configPath: first.configPath,
    env: io.env,
  });
  const provider = first.provider ?? config.defaults?.[capability]?.provider;
  const schema = provider
    ? await createWebMux({
        config,
        cwd: first.cwd ?? io.cwd,
      }).getProviderOptionSchema(provider, capability)
    : undefined;
  return {
    capability,
    config,
    provider,
    flags: schema ? buildOptionFlags(schema) : [],
  };
}

async function executeCapability(
  capability: Capability,
  parsed: ParsedArgs,
  config: WebMuxConfig,
  io: CliIO,
  theme: CliTheme,
): Promise<number> {
  if (parsed.raw && parsed.output === "json")
    usage("--raw cannot be combined with --output json");
  const effective = applyExecutionOverrides(config, parsed, capability);
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
      : (event: { message: string }) =>
          io.stderr.write(
            `${theme.err.cyan("›")} ${theme.err.dim(event.message)}\n`,
          );
    let result: CapabilityDocument<unknown>;
    if (capability === "search") {
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
    } else if (capability === "contents") {
      const urls = await contentsInputs(parsed.positionals, io);
      result = await client.contents({
        provider: parsed.provider,
        urls,
        options: providerOptions,
        signal: controller.signal,
        onProgress: progress,
        raw: parsed.raw,
      });
    } else if (capability === "answer") {
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

    writeResult(result, parsed, io, theme);
    if (result.results.some((entry) => entry.error?.code === "CANCELLED"))
      return 130;
    return result.status === "partial" ? 1 : 0;
  } finally {
    signalSource.removeListener("SIGINT", onSignal);
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

function createProgram(
  argv: string[],
  io: CliIO,
  theme: CliTheme,
  preparation: CapabilityPreparation | undefined,
  setExitCode: (code: number) => void,
): Command {
  const program = new Command();
  program
    .name("web")
    .description(
      "Search, extract, answer, and research through interchangeable web providers.",
    )
    .version(PACKAGE_VERSION, "--version", "Show the version")
    .addOption(new Option("--no-color", "Disable colored output"))
    .helpOption("-h, --help", "Show help")
    .helpCommand("help [command]", "Show help for a command")
    .showSuggestionAfterError(true)
    .exitOverride()
    .configureOutput({
      writeOut: (value) => io.stdout.write(value),
      writeErr: (value) => io.stderr.write(value),
      getOutHelpWidth: () => streamColumns(io.stdout),
      getErrHelpWidth: () => streamColumns(io.stderr),
      getOutHasColors: () => theme.out.isColorSupported,
      getErrHasColors: () => theme.err.isColorSupported,
      stripColor: stripVTControlCharacters,
      outputError: (value, write) => {
        const message = stripVTControlCharacters(value)
          .replace(/^error:\s*/i, "")
          .trimEnd();
        write(
          `${theme.err.red(theme.err.bold(FAILURE_MARK))} ${theme.err.red(message)}\n`,
        );
      },
    })
    .configureHelp({
      showGlobalOptions: true,
      styleTitle: (value) => theme.out.bold(theme.out.cyan(value)),
      styleUsage: (value) => theme.out.bold(value),
      styleCommandText: (value) => theme.out.cyan(value),
      styleOptionText: (value) => theme.out.yellow(value),
      styleArgumentText: (value) => theme.out.magenta(value),
      styleSubcommandTerm: (value) => theme.out.cyan(value),
      styleOptionTerm: (value) => theme.out.yellow(value),
      styleArgumentTerm: (value) => theme.out.magenta(value),
    });

  for (const capability of [
    "search",
    "contents",
    "answer",
    "research",
  ] as const) {
    addCapabilityCommand(
      program,
      capability,
      io,
      theme,
      preparation,
      setExitCode,
    );
  }
  addProvidersCommand(program, io, theme, setExitCode);
  addConfigCommand(program, io, theme, setExitCode);

  const version = new Command("version").action(() => {
    io.stdout.write(`${PACKAGE_VERSION}\n`);
    setExitCode(0);
  });
  program.addCommand(version, { hidden: true });
  return program;
}

function addCapabilityCommand(
  program: Command,
  capability: Capability,
  io: CliIO,
  theme: CliTheme,
  preparation: CapabilityPreparation | undefined,
  setExitCode: (code: number) => void,
): void {
  const definitions = {
    search: {
      description: "Search the public web",
      usage: "[query|-] [options]",
      argument: "[query]",
      argumentDescription: "Query or '-' for stdin",
    },
    contents: {
      description: "Fetch and extract URL contents",
      usage: "<url...|-> [options]",
      argument: "[urls...]",
      argumentDescription: "URLs or '-' for newline-separated stdin",
    },
    answer: {
      description: "Produce web-grounded answers",
      usage: "[question|-] [options]",
      argument: "[question]",
      argumentDescription: "Question or '-' for stdin",
    },
    research: {
      description: "Run foreground web research",
      usage: "<brief|-> [options]",
      argument: "[brief]",
      argumentDescription: "Research brief or '-' for stdin",
    },
  } as const;
  const definition = definitions[capability];
  const command = program
    .command(capability)
    .description(definition.description)
    .usage(definition.usage)
    .argument(definition.argument, definition.argumentDescription)
    .allowExcessArguments(false);
  addCommonOptions(command, capability);

  const active =
    preparation?.capability === capability ? preparation : undefined;
  for (const flag of active?.flags ?? [])
    addDynamicOption(command, flag, active?.provider);
  command.addHelpText("after", () => {
    if (active?.provider) {
      return `\n${theme.out.dim("Provider:")} ${theme.out.bold(PROVIDERS_BY_ID[active.provider].label)} ${theme.out.dim(`(${active.provider})`)}`;
    }
    return `\n${theme.out.yellow("No provider selected.")} ${theme.out.dim("Pass --provider or configure a capability default.")}`;
  });

  command.action(async function (this: Command) {
    const flags = active?.flags ?? [];
    const parsed = parsedArgs(this, capability, flags);
    const config =
      active?.config ??
      (await loadConfig({ configPath: parsed.configPath, env: io.env }));
    setExitCode(await executeCapability(capability, parsed, config, io, theme));
  });
}

function addCommonOptions(command: Command, capability: Capability): void {
  const common = "Common options";
  command
    .addOption(
      new Option("--provider <id>", "Select a provider")
        .argParser(parseProviderId)
        .helpGroup(common),
    )
    .addOption(
      new Option(
        "--config <path>",
        "Use an explicit configuration file",
      ).helpGroup(common),
    )
    .addOption(
      new Option("--cwd <path>", "Set the execution directory").helpGroup(
        common,
      ),
    )
    .addOption(
      new Option("--timeout <ms>", "Override the request timeout")
        .argParser((value) => parseInteger(value, "--timeout", 1))
        .helpGroup(common),
    )
    .addOption(
      new Option("--retries <n>", "Override the retry count")
        .argParser((value) => parseInteger(value, "--retries", 0))
        .helpGroup(common),
    )
    .addOption(
      new Option("--retry-delay <ms>", "Override the initial retry delay")
        .argParser((value) => parseInteger(value, "--retry-delay", 0))
        .helpGroup(common),
    )
    .addOption(
      new Option("--output <format>", "Select text or normalized JSON output")
        .choices(["text", "json"])
        .default("text")
        .helpGroup(common),
    )
    .addOption(
      new Option("--raw", "Emit unstable provider-native payloads").helpGroup(
        common,
      ),
    )
    .addOption(
      new Option(
        "--options-json <json|@file>",
        "Supply options that cannot be expressed as flags",
      ).helpGroup(common),
    )
    .addOption(
      new Option("--quiet", "Suppress progress output").helpGroup(common),
    );
  if (capability === "search" || capability === "answer") {
    command.addOption(
      new Option("--query <input>", "Add another input")
        .argParser((value, previous: string[] | undefined) => [
          ...(previous ?? []),
          value,
        ])
        .helpGroup("Input options"),
    );
  }
  if (capability === "search") {
    command.addOption(
      new Option("--max-results <n>", "Maximum results per query")
        .argParser((value) => parseInteger(value, "--max-results", 1))
        .helpGroup("Input options"),
    );
  }
}

function addDynamicOption(
  command: Command,
  descriptor: OptionFlag,
  provider: ProviderId | undefined,
): void {
  const group = provider
    ? `${PROVIDERS_BY_ID[provider].label} options`
    : "Provider options";
  const values = descriptor.enumValues?.length
    ? ` (${descriptor.enumValues.join(" | ")})`
    : "";
  const description = `${descriptor.description ?? descriptor.path.join(".")}${values}`;
  if (descriptor.kind === "boolean") {
    command.addOption(
      new Option(descriptor.flag, description).helpGroup(group),
    );
    command.addOption(
      new Option(
        descriptor.negativeFlag!,
        `Disable ${descriptor.path.join(".")}`,
      ).helpGroup(group),
    );
    return;
  }
  const option = new Option(`${descriptor.flag} <value>`, description);
  if (descriptor.kind === "array") {
    option.argParser((value, previous: unknown[] | undefined) => [
      ...(previous ?? []),
      parseTypedValue(value, descriptor),
    ]);
  } else {
    option.argParser((value) => parseTypedValue(value, descriptor));
  }
  option.helpGroup(group);
  command.addOption(option);
}

function parsedArgs(
  command: Command,
  capability: Capability,
  flags: OptionFlag[],
): ParsedArgs {
  const options = command.opts<CommanderOptions>();
  const typedOptions: Record<string, unknown> = {};
  for (const descriptor of flags) {
    const option = command.options.find(
      (candidate) => candidate.long === descriptor.flag,
    );
    if (!option) continue;
    const key = option.attributeName();
    if (command.getOptionValueSource(key) !== "cli") continue;
    setPath(typedOptions, descriptor.path, command.getOptionValue(key));
  }
  const positionals = command.processedArgs.flatMap((value) =>
    Array.isArray(value) ? value : value === undefined ? [] : [String(value)],
  );
  return {
    positionals,
    provider: options.provider,
    configPath: options.config,
    cwd: options.cwd,
    timeout: options.timeout,
    retries: options.retries,
    retryDelay: options.retryDelay,
    output: options.output ?? "text",
    raw: options.raw ?? false,
    optionsJson: options.optionsJson,
    quiet: options.quiet ?? false,
    queries:
      capability === "search" || capability === "answer"
        ? (options.query ?? [])
        : [],
    maxResults: options.maxResults,
    typedOptions,
  };
}

function addProvidersCommand(
  program: Command,
  io: CliIO,
  theme: CliTheme,
  setExitCode: (code: number) => void,
): void {
  const command = program
    .command("providers")
    .description("Show provider capabilities and configuration status")
    .argument("[id]", "Provider id")
    .addOption(
      new Option("--config <path>", "Use an explicit configuration file"),
    )
    .addOption(new Option("--cwd <path>", "Set the execution directory"));
  command.action(async function (this: Command) {
    const options = this.opts<CommanderOptions>();
    const id = this.processedArgs[0] as string | undefined;
    setExitCode(await providersCommand(id, options, io, theme));
  });
}

function addConfigCommand(
  program: Command,
  io: CliIO,
  theme: CliTheme,
  setExitCode: (code: number) => void,
): void {
  const config = program
    .command("config")
    .description("Manage web-mux configuration");
  for (const action of ["path", "init", "show", "edit", "validate"] as const) {
    const command = config
      .command(action)
      .description(configDescription(action))
      .addOption(
        new Option("--config <path>", "Use an explicit configuration file"),
      );
    if (action === "init")
      command.addOption(new Option("--force", "Replace an existing file"));
    command.action(async function (this: Command) {
      setExitCode(
        await configCommand(action, this.opts<CommanderOptions>(), io, theme),
      );
    });
  }
  config.action(() => {
    config.outputHelp();
    setExitCode(0);
  });
}

function configDescription(
  action: "path" | "init" | "show" | "edit" | "validate",
): string {
  return {
    path: "Print the resolved configuration path",
    init: "Create an initial configuration",
    show: "Show the redacted configuration",
    edit: "Open the configuration in $VISUAL or $EDITOR",
    validate: "Validate configuration without network access",
  }[action];
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

function firstPass(args: string[]): {
  provider?: ProviderId;
  configPath?: string;
  cwd?: string;
} {
  const result: { provider?: ProviderId; configPath?: string; cwd?: string } =
    {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--") break;
    const [name, inline] = splitFlag(args[index]);
    if (name === "--provider") {
      const value = inline ?? args[index + 1];
      if (value && value in PROVIDERS_BY_ID)
        result.provider = value as ProviderId;
    }
    if (name === "--config") result.configPath = inline ?? args[index + 1];
    if (name === "--cwd") result.cwd = inline ?? args[index + 1];
    if (!inline && ["--provider", "--config", "--cwd"].includes(name))
      index += 1;
  }
  return result;
}

async function providersCommand(
  idValue: string | undefined,
  options: CommanderOptions,
  io: CliIO,
  theme: CliTheme,
): Promise<number> {
  const config = await loadConfig({
    configPath: options.config,
    env: io.env,
  });
  const id = idValue as ProviderId | undefined;
  if (id) {
    const metadata = PROVIDERS_BY_ID[id];
    if (!metadata) usage(`Unknown provider '${id}'`);
    io.stdout.write(
      `${theme.out.bold(theme.out.cyan(metadata.label))} ${theme.out.dim(`(${metadata.id})`)}\n${theme.out.underline(metadata.docsUrl)}\n\n${theme.out.bold("Capabilities:")} ${metadata.capabilities.join(", ")}\n`,
    );
    if (metadata.credentials.length > 0) {
      io.stdout.write(
        `${theme.out.bold("Credentials:")}\n${metadata.credentials.map((entry) => `  ${theme.out.yellow(entry.name)}: ${entry.environmentVariable}`).join("\n")}\n`,
      );
    } else {
      io.stdout.write(
        `${theme.out.bold("Credentials:")} ${theme.out.dim("none")}\n`,
      );
    }
    if (id === "cloudflare") {
      io.stdout.write(
        `  ${theme.out.yellow("accountId")}: CLOUDFLARE_ACCOUNT_ID\n`,
      );
    }
    const definition = await loadProvider(id);
    const providerDefaults = (
      definition.config.createTemplate() as { options?: unknown }
    ).options;
    io.stdout.write(
      `${theme.out.bold("Defaults:")}\n${providerDefaults === undefined ? `  ${theme.out.dim("SDK defaults")}\n` : `${indent(JSON.stringify(providerDefaults, null, 2))}\n`}`,
    );
    const selectedDefaults = Object.entries(config.defaults ?? {})
      .filter(([, entry]) => entry?.provider === id)
      .map(([capability, entry]) => `${capability}: ${JSON.stringify(entry)}`);
    if (selectedDefaults.length > 0) {
      io.stdout.write(
        `${theme.out.bold("Configured capability defaults:")}\n${selectedDefaults.map((line) => `  ${line}`).join("\n")}\n`,
      );
    }
    const cwd = options.cwd ? resolve(io.cwd, options.cwd) : io.cwd;
    const client = createWebMux({ config, cwd });
    for (const capability of metadata.capabilities) {
      const schema = await client.getProviderOptionSchema(id, capability);
      const flags = schema ? buildOptionFlags(schema) : [];
      io.stdout.write(
        `\n${theme.out.bold(`${capability} options:`)} ${flags.length ? flags.map((entry) => theme.out.yellow(entry.flag)).join(", ") : theme.out.dim("none")}\n`,
      );
    }
    return 0;
  }
  const headers = ["Provider", "Search", "Contents", "Answer", "Research"];
  const rows = PROVIDER_CATALOG.map((provider) => [
    theme.out.bold(provider.id),
    ...(["search", "contents", "answer", "research"] as Capability[]).map(
      (capability) =>
        provider.capabilities.includes(capability)
          ? formatProviderStatus(
              providerStatus(provider.id, capability, config, io.env),
              theme.out,
            )
          : theme.out.dim("—"),
    ),
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => visibleWidth(row[index]))),
  );
  const coloredHeaders = headers.map((header) =>
    theme.out.bold(theme.out.cyan(header)),
  );
  io.stdout.write(
    `${[coloredHeaders, ...rows].map((row) => row.map((cell, index) => padAnsi(cell, widths[index])).join("  ")).join("\n")}\n`,
  );
  return 0;
}

function providerStatus(
  id: ProviderId,
  capability: Capability,
  config: WebMuxConfig,
  env: NodeJS.ProcessEnv,
): "ready" | "setup" | "local" {
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

function formatProviderStatus(
  status: "ready" | "setup" | "local",
  colors: Colors,
): string {
  if (status === "setup") return colors.red(`${FAILURE_MARK} setup`);
  if (status === "local") return colors.cyan(`${SUCCESS_MARK} local`);
  return colors.green(`${SUCCESS_MARK} ready`);
}

async function configCommand(
  subcommand: "path" | "init" | "show" | "edit" | "validate",
  options: CommanderOptions,
  io: CliIO,
  theme: CliTheme,
): Promise<number> {
  const path = resolveConfigPath({
    configPath: options.config,
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
        force: options.force,
      });
      io.stdout.write(
        `${theme.out.green(SUCCESS_MARK)} ${theme.out.bold("Created configuration:")} ${written}\n`,
      );
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
      io.stdout.write(
        `${theme.out.green(SUCCESS_MARK)} ${theme.out.bold("Valid configuration:")} ${path}\n`,
      );
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
  theme: CliTheme,
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
    const mark =
      result.status === "ok"
        ? theme.out.green(SUCCESS_MARK)
        : theme.out.red(FAILURE_MARK);
    const provider = theme.out.bold(
      theme.out.cyan(PROVIDERS_BY_ID[result.provider].label),
    );
    const status =
      result.status === "partial"
        ? ` ${theme.out.dim("·")} ${theme.out.red("partial")}`
        : "";
    const body = styleHumanText(
      renderTextDocument(result as any),
      result.capability,
      theme.out,
    );
    io.stdout.write(
      `${mark} ${provider} ${theme.out.dim("·")} ${theme.out.bold(result.capability)}${status}\n\n${body}\n`,
    );
  }
}

function styleHumanText(
  value: string,
  capability: Capability,
  colors: Colors,
): string {
  return value
    .split("\n")
    .map((line) => {
      if (line.startsWith("Error:")) return colors.red(line);
      if (line.startsWith("## ")) return colors.bold(colors.cyan(line));
      if (capability === "search") {
        const title = /^(\d+\. )(.*)$/.exec(line);
        if (title) return `${colors.dim(title[1])}${colors.bold(title[2])}`;
        if (/^\s+https?:\/\//.test(line))
          return colors.cyan(colors.underline(line));
      }
      return line;
    })
    .join("\n");
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
      throw new InvalidArgumentError(
        `${descriptor.flag} requires a ${itemKind}`,
      );
  } else if (itemKind === "boolean") {
    if (raw !== "true" && raw !== "false")
      throw new InvalidArgumentError(
        `${descriptor.flag} requires true or false`,
      );
    value = raw === "true";
  }
  if (descriptor.enumValues && !descriptor.enumValues.includes(value)) {
    throw new InvalidArgumentError(
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

function parseInteger(value: string, flag: string, min: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min)
    throw new InvalidArgumentError(`${flag} must be an integer >= ${min}`);
  return parsed;
}

function parseProviderId(value: string): ProviderId {
  if (!(value in PROVIDERS_BY_ID))
    throw new InvalidArgumentError(`Unknown provider '${value}'`);
  return value as ProviderId;
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

function createTheme(argv: string[], io: CliIO): CliTheme {
  const noColor =
    optionBeforeSeparator(argv, "--no-color") ||
    Object.hasOwn(io.env, "NO_COLOR");
  const forceColor = io.env.FORCE_COLOR;
  const forcedOff = forceColor === "0";
  const forcedOn = forceColor !== undefined && !forcedOff;
  const colorsFor = (stream: NodeJS.WritableStream) =>
    pc.createColors(
      !noColor &&
        !forcedOff &&
        (forcedOn || Boolean((stream as NodeJS.WriteStream).isTTY)),
    );
  return { out: colorsFor(io.stdout), err: colorsFor(io.stderr) };
}

function optionBeforeSeparator(argv: string[], option: string): boolean {
  const separator = argv.indexOf("--");
  const options = separator === -1 ? argv : argv.slice(0, separator);
  return options.includes(option);
}

function streamColumns(stream: NodeJS.WritableStream): number {
  return (stream as NodeJS.WriteStream).columns ?? 80;
}

function visibleWidth(value: string): number {
  return [...stripVTControlCharacters(value)].length;
}

function padAnsi(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visibleWidth(value)))}`;
}

function writeCliError(message: string, io: CliIO, theme: CliTheme): void {
  io.stderr.write(
    `${theme.err.red(theme.err.bold(FAILURE_MARK))} ${theme.err.red("web:")} ${message}\n`,
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
