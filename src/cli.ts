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

interface HelpExample {
  description: string;
  command: string;
}

type ConfigAction = "path" | "init" | "show" | "edit" | "validate";

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
      "Unified web access through interchangeable providers. Search the public web, extract readable page contents, answer questions with web grounding, or run long-form research. Select a provider per invocation with --provider or configure an explicit default for each capability.",
    )
    .version(PACKAGE_VERSION, "--version", "Print the web-mux version and exit")
    .addOption(
      new Option(
        "--no-color",
        "Disable ANSI colors in human-readable output and help",
      ),
    )
    .helpOption("-h, --help", "Display help for this command")
    .helpCommand("help [command]", "Display help for a command")
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

  program.addHelpText(
    "after",
    () =>
      `\n${formatExamples(theme.out, [
        {
          description: "Search the web with an explicit provider:",
          command: 'web search --provider brave "Node.js 22 release notes"',
        },
        {
          description: "Extract readable content from several pages:",
          command:
            "web contents --provider firecrawl https://example.com/a https://example.com/b",
        },
        {
          description: "Return a web-grounded answer as normalized JSON:",
          command:
            'web answer --provider openai --output json "What changed in ECMAScript 2026?"',
        },
        {
          description: "Run a long-form research brief in the foreground:",
          command:
            'web research --provider gemini "Compare Node.js and Bun for backend services"',
        },
        {
          description: "Discover providers or create the configuration file:",
          command: "web providers\nweb config init",
        },
      ])}`,
  );

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
      summary: "Search the public web",
      description:
        "Submit one or more independent queries to a web-search provider. Results preserve input order and include normalized titles, URLs, snippets, and provider metadata. Search accepts at most ten inputs; the positional query is processed before repeated --query values.",
      usage: "[query|-] [options]",
      argument: "[query]",
      argumentDescription:
        "First search query, or '-' to read one query from stdin",
    },
    contents: {
      summary: "Fetch and extract URL contents",
      description:
        "Fetch one or more URLs and return normalized, readable page contents through a content-extraction provider. Input order is preserved, partial batches still emit successful pages, and any per-URL failure produces a nonzero exit status.",
      usage: "<url...|-> [options]",
      argument: "[urls...]",
      argumentDescription:
        "HTTP(S) URLs, or '-' alone to read newline-separated URLs from stdin",
    },
    answer: {
      summary: "Answer questions using web sources",
      description:
        "Ask one or more independent questions and receive provider-generated answers grounded in current web sources. Answers preserve input order and may include citations or source metadata. At most ten inputs are accepted; the positional question comes before repeated --query values.",
      usage: "[question|-] [options]",
      argument: "[question]",
      argumentDescription:
        "First question, or '-' to read one question from stdin",
    },
    research: {
      summary: "Run long-form web research",
      description:
        "Run one long-form research brief synchronously in the foreground. Progress events go to stderr and the final report goes to stdout, so output can be redirected safely. Press Ctrl-C to cancel the provider request through AbortSignal.",
      usage: "<brief|-> [options]",
      argument: "[brief]",
      argumentDescription:
        "Research brief, or '-' to read the complete brief from stdin",
    },
  } as const;
  const definition = definitions[capability];
  const command = program
    .command(capability)
    .description(definition.description)
    .summary(definition.summary)
    .usage(definition.usage)
    .argument(definition.argument, definition.argumentDescription)
    .allowExcessArguments(false);
  addCommonOptions(command, capability);

  const active =
    preparation?.capability === capability ? preparation : undefined;
  for (const flag of active?.flags ?? [])
    addDynamicOption(command, flag, active?.provider);
  command.addHelpText("after", () => {
    const providerStatus = active?.provider
      ? `${theme.out.dim("Provider:")} ${theme.out.bold(PROVIDERS_BY_ID[active.provider].label)} ${theme.out.dim(`(${active.provider})`)}`
      : `${theme.out.yellow("No provider selected.")} ${theme.out.dim("Pass --provider or configure a capability default. Provider-specific flags appear after selection.")}`;
    return `\n${providerStatus}\n\n${formatExamples(theme.out, capabilityExamples(capability, active?.provider))}`;
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
      new Option(
        "--provider <id>",
        "Use this provider; overrides the configured capability default",
      )
        .argParser(parseProviderId)
        .helpGroup(common),
    )
    .addOption(
      new Option(
        "--config <path>",
        "Read this configuration file instead of the resolved default",
      ).helpGroup(common),
    )
    .addOption(
      new Option(
        "--cwd <path>",
        "Resolve relative files and run custom providers from this directory",
      ).helpGroup(common),
    )
    .addOption(
      new Option(
        "--timeout <ms>",
        "Set the capability timeout in milliseconds for this invocation",
      )
        .argParser((value) => parseInteger(value, "--timeout", 1))
        .helpGroup(common),
    )
    .addOption(
      new Option(
        "--retries <n>",
        "Retry retryable provider failures this many times",
      )
        .argParser((value) => parseInteger(value, "--retries", 0))
        .helpGroup(common),
    )
    .addOption(
      new Option(
        "--retry-delay <ms>",
        "Set the initial retry backoff in milliseconds",
      )
        .argParser((value) => parseInteger(value, "--retry-delay", 0))
        .helpGroup(common),
    )
    .addOption(
      new Option(
        "--output <format>",
        "Write human-readable text or one normalized JSON document",
      )
        .choices(["text", "json"])
        .default("text")
        .helpGroup(common),
    )
    .addOption(
      new Option(
        "--raw",
        "Write unstable provider-native payloads; incompatible with --output json",
      ).helpGroup(common),
    )
    .addOption(
      new Option(
        "--options-json <json|@file>",
        "Merge provider options from inline JSON or @file before typed flags",
      ).helpGroup(common),
    )
    .addOption(
      new Option(
        "--quiet",
        "Suppress provider progress events written to stderr",
      ).helpGroup(common),
    );
  if (capability === "search" || capability === "answer") {
    command.addOption(
      new Option(
        "--query <input>",
        "Append another input after the positional value; repeatable, ten inputs total",
      )
        .argParser((value, previous: string[] | undefined) => [
          ...(previous ?? []),
          value,
        ])
        .helpGroup("Input options"),
    );
  }
  if (capability === "search") {
    command.addOption(
      new Option(
        "--max-results <n>",
        "Limit normalized search results returned for each query",
      )
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

function capabilityExamples(
  capability: Capability,
  selectedProvider: ProviderId | undefined,
): HelpExample[] {
  const provider =
    selectedProvider ??
    (
      {
        search: "brave",
        contents: "firecrawl",
        answer: "openai",
        research: "gemini",
      } satisfies Record<Capability, ProviderId>
    )[capability];
  return {
    search: [
      {
        description: "Run one search and return human-readable results:",
        command: `web search --provider ${provider} "TypeBox validation"`,
      },
      {
        description: "Search several queries in order with five results each:",
        command: `web search --provider ${provider} "Node.js AbortSignal" \\\n  --query "fetch cancellation" --max-results 5`,
      },
      {
        description: "Read one query from stdin and emit normalized JSON:",
        command: `printf "latest ECMAScript proposal" | web search --provider ${provider} - --output json`,
      },
    ],
    contents: [
      {
        description: "Extract readable content from multiple URLs:",
        command: `web contents --provider ${provider} https://example.com/a https://example.com/b`,
      },
      {
        description: "Read newline-separated URLs from stdin:",
        command: `printf "https://example.com/a\\nhttps://example.com/b\\n" | \\\n  web contents --provider ${provider} -`,
      },
      {
        description: "Return one normalized JSON document for automation:",
        command: `web contents --provider ${provider} --output json https://example.com`,
      },
    ],
    answer: [
      {
        description: "Ask one question using current web sources:",
        command: `web answer --provider ${provider} "What changed in Node.js 22?"`,
      },
      {
        description: "Answer several questions and preserve their input order:",
        command: `web answer --provider ${provider} "What is MCP?" --query "What is A2A?"`,
      },
      {
        description: "Read a question from stdin and emit normalized JSON:",
        command: `printf "Summarize today's browser news" | web answer --provider ${provider} - --output json`,
      },
    ],
    research: [
      {
        description: "Run a research brief while progress is shown on stderr:",
        command: `web research --provider ${provider} "Compare Node.js and Bun for backend services"`,
      },
      {
        description: "Read a longer brief from a file through stdin:",
        command: `web research --provider ${provider} - < brief.md`,
      },
      {
        description:
          "Produce quiet normalized output for an automated workflow:",
        command: `web research --provider ${provider} --quiet --output json \\\n  "Map the WebAssembly ecosystem"`,
      },
    ],
  }[capability];
}

function formatExamples(colors: Colors, examples: HelpExample[]): string {
  const entries = examples.map(
    ({ description, command }) =>
      `  ${description}\n    ${command
        .split("\n")
        .map((line) => colors.yellow(line))
        .join("\n    ")}`,
  );
  return `${colors.bold(colors.cyan("Examples:"))}\n${entries.join("\n\n")}`;
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
    .summary("Inspect provider capabilities and setup")
    .description(
      "List all built-in providers as a capability matrix and show which operations are available with the current configuration. Pass a provider id to inspect its required credentials, supported capabilities, defaults, documentation URL, and exact schema-derived option flags. This command does not make provider requests.",
    )
    .argument(
      "[id]",
      "Provider id to inspect; omit it to print the complete matrix",
    )
    .addOption(
      new Option(
        "--config <path>",
        "Read this configuration file instead of the resolved default",
      ),
    )
    .addOption(
      new Option(
        "--cwd <path>",
        "Use this directory while inspecting provider option schemas",
      ),
    )
    .addHelpText(
      "after",
      () =>
        `\n${formatExamples(theme.out, [
          {
            description: "Show the complete capability and setup matrix:",
            command: "web providers",
          },
          {
            description:
              "Inspect credentials, defaults, and options for OpenAI:",
            command: "web providers openai",
          },
          {
            description:
              "Inspect provider status using a specific configuration:",
            command: "web providers --config ./web-mux.json",
          },
        ])}`,
    );
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
    .summary("Manage web-mux configuration")
    .description(
      "Resolve, create, inspect, edit, and validate the strict JSON configuration used by the library, CLI, and pi extension. Configuration resolution honors --config, WEB_MUX_CONFIG, and the platform-specific XDG or AppData location.",
    )
    .addHelpText(
      "after",
      () =>
        `\n${formatExamples(theme.out, [
          {
            description: "Print the path selected by configuration resolution:",
            command: "web config path",
          },
          {
            description: "Create a starter configuration at the default path:",
            command: "web config init",
          },
          {
            description:
              "Inspect redacted values and validate provider options:",
            command: "web config show\nweb config validate",
          },
        ])}`,
    );
  for (const action of ["path", "init", "show", "edit", "validate"] as const) {
    const definition = configDefinition(action);
    const command = config
      .command(action)
      .summary(definition.summary)
      .description(definition.description)
      .addOption(
        new Option(
          "--config <path>",
          "Operate on this file instead of the resolved configuration path",
        ),
      )
      .addHelpText(
        "after",
        () => `\n${formatExamples(theme.out, definition.examples)}`,
      );
    if (action === "init")
      command.addOption(
        new Option(
          "--force",
          "Replace an existing configuration file instead of refusing",
        ),
      );
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

function configDefinition(action: ConfigAction): {
  summary: string;
  description: string;
  examples: HelpExample[];
} {
  return {
    path: {
      summary: "Print the resolved configuration path",
      description:
        "Print the configuration path selected by --config, WEB_MUX_CONFIG, or the platform-specific default. The file does not need to exist and is not read or validated.",
      examples: [
        {
          description: "Show the path selected by normal resolution:",
          command: "web config path",
        },
        {
          description: "Resolve an explicitly selected path:",
          command: "web config path --config ./web-mux.json",
        },
      ],
    },
    init: {
      summary: "Create an initial configuration",
      description:
        "Create a strict starter JSON configuration with its schema URL and recommended execution defaults. Existing files are preserved unless --force is supplied; no credentials or provider defaults are invented.",
      examples: [
        {
          description: "Create the default XDG or AppData configuration:",
          command: "web config init",
        },
        {
          description: "Create a project-local configuration:",
          command: "web config init --config ./web-mux.json",
        },
        {
          description: "Replace an existing project-local configuration:",
          command: "web config init --config ./web-mux.json --force",
        },
      ],
    },
    show: {
      summary: "Show the redacted configuration",
      description:
        "Load the selected configuration and print normalized, pretty JSON. Literal credential values and credential commands are always redacted before output, making the result safer to inspect or share.",
      examples: [
        {
          description: "Show the resolved configuration with secrets redacted:",
          command: "web config show",
        },
        {
          description: "Show a project-local configuration:",
          command: "web config show --config ./web-mux.json",
        },
      ],
    },
    edit: {
      summary: "Open the configuration in $VISUAL or $EDITOR",
      description:
        "Open the selected configuration directly in the program named by $VISUAL or $EDITOR and wait for the editor to exit. The command fails when neither environment variable is configured.",
      examples: [
        {
          description: "Edit the normally resolved configuration:",
          command: "web config edit",
        },
        {
          description: "Edit a project-local configuration:",
          command: "EDITOR=vim web config edit --config ./web-mux.json",
        },
      ],
    },
    validate: {
      summary: "Validate configuration without network access",
      description:
        "Strictly validate the selected JSON configuration and all configured provider option objects. Validation performs no network requests and does not execute credential commands.",
      examples: [
        {
          description: "Validate the normally resolved configuration:",
          command: "web config validate",
        },
        {
          description: "Validate a project-local configuration:",
          command: "web config validate --config ./web-mux.json",
        },
      ],
    },
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
  const legend = [
    `${theme.out.green(SUCCESS_MARK)} available`,
    `${theme.out.red(FAILURE_MARK)} setup required`,
    `${theme.out.dim("—")} unsupported`,
  ].join(` ${theme.out.dim("·")} `);
  io.stdout.write(
    `${[coloredHeaders, ...rows].map((row) => row.map((cell, index) => (index === row.length - 1 ? cell : padAnsi(cell, widths[index]))).join("  ")).join("\n")}\n\n${theme.out.dim("Legend:")} ${legend}\n`,
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
  if (status === "setup") return colors.red(FAILURE_MARK);
  if (status === "local") return colors.cyan(SUCCESS_MARK);
  return colors.green(SUCCESS_MARK);
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
  return [...stripVTControlCharacters(value).replace(/[\uFE0E\uFE0F]/g, "")]
    .length;
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
