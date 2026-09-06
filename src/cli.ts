#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { EventEmitter } from "node:events";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
} from "commander";
import pc from "picocolors";
import { stringify } from "yaml";
import { PACKAGE_VERSION } from "./package-metadata.js";
import {
  CAPABILITIES,
  PROVIDER_IDS,
  createWebfox,
  loadConfig,
  redactConfig,
  resolveConfigPath,
  setCapabilityDefault,
  validateConfiguredOptions,
  WebfoxError,
  type Capability,
  type ProgressEvent,
  type ProviderId,
} from "./index.js";
import { renderTextDocument } from "./render.js";
import { createDiagnostics } from "./cli/diagnostics.js";
import { formatDuration } from "./runtime/duration.js";
import {
  buildOptionFlags,
  parseTypedValue,
  setPath,
  type OptionFlag,
} from "./cli/flags.js";
export { buildOptionFlags } from "./cli/flags.js";

interface CliIO {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
  cwd: string;
  signalSource?: Pick<EventEmitter, "once" | "removeListener">;
}
interface Controls {
  provider?: ProviderId;
  config?: string;
  cwd?: string;
  timeout?: number;
  format: "text" | "json";
  quiet?: boolean;
  maxResults?: number;
  optionsJson?: string;
  help?: boolean;
}
const summaries: Record<Capability, string> = {
  search: "Search the public web",
  contents: "Extract readable pages",
  answer: "Answer questions using web sources",
  research: "Run research in the foreground",
};

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
  const beforeSeparator = argv.slice(
    0,
    argv.indexOf("--") < 0 ? argv.length : argv.indexOf("--"),
  );
  const colors = pc.createColors(
    Boolean((io.stderr as NodeJS.WriteStream).isTTY) &&
      !("NO_COLOR" in io.env) &&
      !beforeSeparator.includes("--no-color"),
  );
  const helpColors = pc.createColors(
    Boolean((io.stdout as NodeJS.WriteStream).isTTY) &&
      !("NO_COLOR" in io.env) &&
      !beforeSeparator.includes("--no-color"),
  );
  const diagnostics = createDiagnostics(io.stderr, colors);
  const controller = new AbortController();
  const abort = () =>
    controller.abort(new WebfoxError("CANCELLED", "Operation cancelled."));
  const signals = io.signalSource ?? process;
  signals.once("SIGINT", abort);
  signals.once("SIGTERM", abort);
  let exitCode = 0;
  const output = (command: Command) =>
    command
      .exitOverride()
      .configureHelp({
        styleTitle: helpColors.bold,
        styleCommandText: helpColors.cyan,
        styleSubcommandText: helpColors.cyan,
        styleOptionText: helpColors.cyan,
        styleArgumentText: helpColors.yellow,
      })
      .configureOutput({
        getOutHasColors: () => helpColors.isColorSupported,
        getErrHasColors: () => colors.isColorSupported,
        writeOut: (value) => io.stdout.write(value),
        writeErr: (value) => io.stderr.write(value),
        outputError: (value) =>
          diagnostics.error({
            code: "INVALID_INPUT",
            message: value.replace(/^error: /, ""),
          }),
      });
  try {
    // The route and final parse share the same common option declarations.
    // Commander consumes their values (including JSON and paths), honors '--',
    // and leaves only schema-dependent options for the second stage.
    while (argv[0] === "--no-color") argv = argv.slice(1);
    if (argv[0] === "help" && CAPABILITIES.includes(argv[1] as Capability))
      argv = [argv[1], "--help", ...argv.slice(2)];
    const root = output(new Command("webfox"))
      .description(
        "webfox: search, extract pages, answer questions, and research with an explicit provider.",
      )
      .version(PACKAGE_VERSION, "--version")
      .helpCommand(false);
    root.addHelpText(
      "after",
      [
        `\n${helpColors.bold("Examples:")}`,
        `  ${helpColors.cyan("webfox search")} ${helpColors.yellow('"Node.js release notes"')} ${helpColors.cyan("--provider")} ${helpColors.yellow("brave")}`,
        `  ${helpColors.cyan("webfox config default")} ${helpColors.yellow("search brave")}`,
        `  ${helpColors.cyan("webfox search --help")}`,
        `  ${helpColors.cyan("webfox search --provider")} ${helpColors.yellow("brave")} ${helpColors.cyan("--help")}`,
      ].join("\n"),
    );
    for (const capability of CAPABILITIES) {
      const command = root
        .command(capability)
        .description(summaries[capability])
        .argument(
          capability === "research"
            ? "[brief]"
            : capability === "contents"
              ? "[urls...]"
              : "[queries...]",
        )
        .allowExcessArguments(false)
        .helpOption(false);
      addControls(command, capability);
      command.addOption(new Option("-h, --help", "Show help"));
      if (argv[0] !== capability) continue;
      const route = output(new Command())
        .allowUnknownOption(true)
        .helpOption(false);
      addControls(route, capability);
      route.addOption(new Option("-h, --help"));
      route.parseOptions(argv.slice(1));
      const controls = route.opts<Controls>();
      const cwd = resolve(io.cwd, controls.cwd ?? ".");
      const help = controls.help;
      // Common help is independent of configuration; explicit provider help
      // inspects only lightweight definitions and never resolves credentials.
      const client =
        help && !controls.provider
          ? undefined
          : createWebfox({
              configPath: controls.config && resolve(io.cwd, controls.config),
              cwd,
              env: io.env,
            });
      const inspection = client?.inspectCapability(
        capability,
        controls.provider,
      );
      const flags = inspection?.optionSchema
        ? buildOptionFlags(inspection.optionSchema)
        : [];
      for (const flag of flags)
        addProviderOption(command, flag, !controls.provider && !!help);
      command.addHelpText("after", capabilityHelp(capability, helpColors));
      if (help) {
        // Validate the same complete grammar before displaying help, without
        // requiring positional input or entering execution.
        command.action(() => command.outputHelp());
      } else
        command.action(async function (this: Command) {
          const parsed = this.opts<Controls>();
          const values = this.processedArgs.flatMap((value) =>
            Array.isArray(value)
              ? value
              : value === undefined
                ? []
                : [String(value)],
          );
          const inputs = await readInputs(
            capability,
            values,
            io.stdin,
            controller.signal,
          );
          const providerOptions = await readOptions(parsed.optionsJson, cwd);
          for (const flag of flags) {
            const option = this.options.find(
              (option) => option.long === flag.flag,
            )!;
            if (this.getOptionValueSource(option.attributeName()) === "cli")
              setPath(
                providerOptions,
                flag.path,
                this.getOptionValue(option.attributeName()),
              );
          }
          const request = {
            provider: inspection?.provider,
            options: providerOptions,
            timeoutMs: parsed.timeout,
            signal: controller.signal,
            onProgress: parsed.quiet
              ? undefined
              : (event: ProgressEvent) => {
                  // Lifecycle events drive Pi rows; CLI completions are emitted
                  // once from the final result, in input order.
                  if (!event.state) diagnostics.progress(event.message);
                },
          };
          const startedAt = Date.now();
          const result =
            capability === "search"
              ? await client!.search({
                  ...request,
                  queries: inputs,
                  maxResults: parsed.maxResults,
                })
              : capability === "contents"
                ? await client!.contents({ ...request, urls: inputs })
                : capability === "answer"
                  ? await client!.answer({ ...request, queries: inputs })
                  : await client!.research({ ...request, input: inputs[0] });
          for (const entry of result.results) {
            if (!entry.ok) diagnostics.error(entry.error, entry.input);
            else if (!parsed.quiet)
              diagnostics.success(
                capability === "research"
                  ? `Research via ${client!.getProvider(result.provider)!.label} completed in ${formatDuration(Date.now() - startedAt)}.`
                  : entry.input,
              );
          }
          const rendered =
            parsed.format === "json"
              ? JSON.stringify(result)
              : renderTextDocument(result, { includeErrors: false });
          if (rendered) io.stdout.write(`${rendered}\n`);
          exitCode = result.results.some(
            (entry) => !entry.ok && entry.error.code === "CANCELLED",
          )
            ? 130
            : result.status === "partial"
              ? 1
              : 0;
        });
    }
    root
      .command("providers")
      .description(
        "Inspect supported, configured, and selected capabilities (not verified)",
      )
      .argument("[id]")
      .option("--config <path>", "Advanced: read this configuration file")
      .action((id: string | undefined, controls: { config?: string }) => {
        const client = createWebfox({
          configPath: controls.config && resolve(io.cwd, controls.config),
          cwd: io.cwd,
          env: io.env,
        });
        const entries = id
          ? [client.getProvider(parseProvider(id))!]
          : client.listProviders();
        const rows = [
          ["", "Provider", ...CAPABILITIES],
          ...entries.map((entry) => [
            entry.configured.length > 0 ? "★" : "☆",
            entry.id,
            ...CAPABILITIES.map((capability) =>
              entry.selectedDefaults.includes(capability)
                ? "◉"
                : entry.capabilities.includes(capability)
                  ? "✔︎"
                  : "✘︎",
            ),
          ]),
        ];
        // Text-presentation selectors in the status glyphs occupy no columns.
        const width = (value: string) => value.replaceAll("\uFE0E", "").length;
        const widths = rows[0].map((_, index) =>
          Math.max(...rows.map((row) => width(row[index]))),
        );
        io.stdout.write(
          rows
            .map((row, rowIndex) =>
              row
                .map((value, i) => {
                  const left =
                    rowIndex > 0 && i > 1
                      ? Math.floor((widths[i] - width(value)) / 2)
                      : 0;
                  const padded =
                    " ".repeat(left) +
                    value +
                    (i === row.length - 1
                      ? ""
                      : " ".repeat(widths[i] - left - width(value)));
                  if (rowIndex === 0) return helpColors.bold(padded);
                  return padded
                    .replace("✔︎", helpColors.green("✔︎"))
                    .replace("✘︎", helpColors.dim("✘︎"))
                    .replace("◉", helpColors.cyan("◉"))
                    .replace("★", helpColors.yellow("★"))
                    .replace("☆", helpColors.dim("☆"));
                })
                .join("  ")
                .trimEnd(),
            )
            .join("\n") +
            "\n\n☆ Unconfigured  ★ Configured  ✔︎ Supported  ✘︎ Unsupported  ◉ Selected default\n",
        );
        if (id) {
          const entry = entries[0];
          io.stdout.write(
            `\n${entry.docsUrl}\n${entry.credentials.map((c) => `${c.name}: ${c.environmentVariable}${c.optional ? " (optional)" : ""}`).join("\n")}\n`,
          );
          for (const [key, env] of Object.entries(
            entry.configurationRequirements,
          ))
            io.stdout.write(`${key}: ${env}\n`);
          for (const capability of entry.capabilities)
            io.stdout.write(
              `\n${capability} defaults: ${JSON.stringify(client.inspectCapability(capability, entry.id).defaults)}\nOptions: webfox ${capability} --provider ${entry.id} --help\n`,
            );
        }
      });
    const config = root
      .command("config")
      .description("Save provider choices or inspect YAML configuration");
    config
      .command("default")
      .description("Save one capability’s provider choice")
      .argument("<capability>")
      .argument("<provider>")
      .option("--config <path>", "Advanced: update this configuration file")
      .action(
        async (
          capability: string,
          provider: string,
          controls: { config?: string },
        ) => {
          await setCapabilityDefault(
            capability as Capability,
            parseProvider(provider),
            { configPath: controls.config, cwd: io.cwd, env: io.env },
          );
          diagnostics.success(`Saved ${capability} default: ${provider}`);
        },
      );
    for (const action of ["path", "show", "validate"] as const)
      config
        .command(action)
        .description(
          {
            path: "Print the configuration path",
            show: "Show configuration with secrets redacted",
            validate: "Validate without credentials or network requests",
          }[action],
        )
        .option("--config <path>", "Use this configuration file")
        .action(async (controls: { config?: string }) => {
          const options = {
            configPath: controls.config,
            cwd: io.cwd,
            env: io.env,
          };
          if (action === "path")
            io.stdout.write(`${resolveConfigPath(options)}\n`);
          else {
            const value = await loadConfig(options);
            if (action === "show")
              io.stdout.write(stringify(redactConfig(value)));
            else {
              validateConfiguredOptions(value);
              diagnostics.success(
                "Configuration is valid. Credentials and connectivity have not been verified.",
              );
            }
          }
        });
    config.action(() => config.outputHelp());
    if (!argv.length) {
      root.outputHelp();
      return 0;
    }
    await root.parseAsync(argv, { from: "user" });
    return exitCode;
  } catch (error) {
    // Parser errors are already printed, but argument errors thrown directly
    // by command actions still need a diagnostic.
    if (
      error instanceof CommanderError &&
      !(error instanceof InvalidArgumentError)
    )
      return error.exitCode === 0 ? 0 : 2;
    const normalized =
      error instanceof WebfoxError
        ? error
        : new WebfoxError(
            "INVALID_INPUT",
            error instanceof Error ? error.message : String(error),
          );
    diagnostics.error(normalized);
    return normalized.code === "CANCELLED"
      ? 130
      : ["INVALID_INPUT", "INVALID_CONFIG"].includes(normalized.code)
        ? 2
        : 1;
  } finally {
    signals.removeListener("SIGINT", abort);
    signals.removeListener("SIGTERM", abort);
  }
}
function addControls(command: Command, capability: Capability): void {
  command.addOption(
    new Option(
      "--provider <id>",
      `Override the saved ${capability} provider`,
    ).argParser(parseProvider),
  );
  if (capability === "search")
    command.addOption(
      new Option("--max-results <n>", "Maximum results per query").argParser(
        (value) => positiveInteger(value, "--max-results"),
      ),
    );
  command.addOption(
    new Option("--format <text|json>", "Result format (text even when piped)")
      .choices(["text", "json"])
      .default("text"),
  );
  command.addOption(
    new Option(
      "--timeout <duration>",
      "Overall deadline including retries (30s, 20m)",
    ).argParser(parseDuration),
  );
  command.option("--quiet", "Suppress progress and success notices on stderr");
  command.addOption(new Option("--no-color", "Disable terminal colors"));
  command.addOption(
    new Option("--config <path>", "Read this YAML configuration file"),
  );
  command.addOption(
    new Option(
      "--cwd <path>",
      "Working directory for custom providers and option files",
    ),
  );
  command.addOption(
    new Option(
      "--options-json <json|@file>",
      "Complex provider options; typed flags take precedence",
    ),
  );
}
function addProviderOption(
  command: Command,
  flag: OptionFlag,
  hidden: boolean,
): void {
  const description = `${flag.description ?? flag.path.join(".")}${flag.enumValues ? ` (${flag.enumValues.join(" | ")})` : ""}`;
  const option = new Option(
    flag.kind === "boolean" ? flag.flag : `${flag.flag} <value>`,
    description,
  )
    .helpGroup("Provider options")
    .hideHelp(hidden);
  if (flag.kind === "array")
    option.argParser((value, previous: unknown[] = []) => [
      ...previous,
      parseTypedValue(value, flag),
    ]);
  else if (flag.kind !== "boolean")
    option.argParser((value) => parseTypedValue(value, flag));
  command.addOption(option);
  if (flag.negativeFlag)
    command.addOption(
      new Option(flag.negativeFlag, `Disable ${flag.path.join(".")}`)
        .helpGroup("Provider options")
        .hideHelp(hidden),
    );
}
function capabilityHelp(
  capability: Capability,
  colors: ReturnType<typeof pc.createColors>,
): string {
  const examples: Record<Capability, { input: string; provider: ProviderId }> =
    {
      search: {
        input: '"Node.js cancellation" "Bun cancellation"',
        provider: "brave",
      },
      contents: { input: "https://example.com", provider: "tavily" },
      answer: { input: '"What is MCP?" "What is A2A?"', provider: "openai" },
      research: { input: '"Compare databases"', provider: "gemini" },
    };
  const { input, provider } = examples[capability];
  const command = colors.cyan(`webfox ${capability}`);
  const providerFlag = `${colors.cyan("--provider")} ${colors.yellow(provider)}`;
  return [
    "",
    capability === "contents"
      ? "Use '-' alone for newline-separated URLs on stdin."
      : capability === "research"
        ? "Provide exactly one brief, or '-' for one complete stdin input."
        : "Quote each independent input (up to ten). Use '-' alone for one complete stdin input.",
    "Results preserve input order. Progress and errors go to stderr.",
    "",
    colors.bold("Examples:"),
    `  ${command} ${colors.yellow(input)} ${providerFlag}${capability === "research" ? ` ${colors.cyan("--timeout")} ${colors.yellow("20m")}` : ""}`,
    `  ${command} ${providerFlag} ${colors.cyan("--help")}`,
  ].join("\n");
}
export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  const ms = match
    ? Number(match[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]]!
    : NaN;
  if (!Number.isSafeInteger(ms) || ms < 1 || ms > 2_147_483_647)
    throw new InvalidArgumentError(
      "Use a positive duration with ms, s, m, or h (for example 30s or 20m).",
    );
  return ms;
}
function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new InvalidArgumentError(`${flag} requires a positive integer`);
  return parsed;
}
function parseProvider(value: string): ProviderId {
  if (!PROVIDER_IDS.includes(value as ProviderId))
    throw new InvalidArgumentError(
      `Unknown provider '${value}'. See webfox providers.`,
    );
  return value as ProviderId;
}
async function readInputs(
  capability: Capability,
  inputs: string[],
  stdin: NodeJS.ReadableStream,
  signal: AbortSignal,
): Promise<string[]> {
  if (!inputs.length || (capability === "research" && inputs.length !== 1))
    throw new WebfoxError(
      "INVALID_INPUT",
      `${capability} requires ${capability === "research" ? "exactly one brief" : "one or more inputs"} or '-'.`,
    );
  if (!inputs.includes("-")) return inputs;
  if (inputs.length !== 1)
    throw new WebfoxError("INVALID_INPUT", "Use '-' by itself for stdin.");
  const text = await new Promise<string>((resolvePromise, reject) => {
    let text = "";
    const cleanup = () => {
      stdin.removeListener("data", data);
      stdin.removeListener("end", end);
      stdin.removeListener("error", error);
      signal.removeEventListener("abort", abort);
    };
    const data = (chunk: string | Buffer) => {
      text += chunk;
    };
    const end = () => {
      cleanup();
      resolvePromise(text.trim());
    };
    const error = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => {
      cleanup();
      stdin.pause();
      reject(signal.reason);
    };
    if (signal.aborted) {
      abort();
      return;
    }
    stdin.setEncoding?.("utf8");
    stdin.on("data", data);
    stdin.once("end", end);
    stdin.once("error", error);
    signal.addEventListener("abort", abort, { once: true });
  });
  return capability === "contents"
    ? text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [text];
}
async function readOptions(
  value: string | undefined,
  cwd: string,
): Promise<Record<string, unknown>> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(
      value.startsWith("@")
        ? await readFile(resolve(cwd, value.slice(1)), "utf8")
        : value,
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed;
  } catch {
    throw new WebfoxError(
      "INVALID_INPUT",
      "--options-json must contain a JSON object or name a readable @file.",
    );
  }
}
const invokedPath = process.argv[1]
  ? pathToFileURL(realpathSync(resolve(process.argv[1]))).href
  : undefined;
if (invokedPath === import.meta.url)
  process.exitCode = await runCli(process.argv.slice(2));
