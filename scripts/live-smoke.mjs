#!/usr/bin/env node

import process from "node:process";
import { __test__ } from "../dist/index.js";

const PROVIDERS_BY_TOOL = {
  search: [
    "claude",
    "codex",
    "custom",
    "exa",
    "gemini",
    "perplexity",
    "parallel",
    "serper",
    "valyu",
  ],
  contents: ["custom", "exa", "parallel", "valyu"],
  answer: ["claude", "custom", "exa", "gemini", "perplexity", "valyu"],
  research: ["custom", "exa", "gemini", "perplexity", "valyu"],
};

const PROBE_INPUTS = {
  search: {
    maxResults: 3,
    options: { requestTimeoutMs: 30_000 },
    timeoutMs: 45_000,
    query: "OpenAI API",
  },
  contents: {
    options: { requestTimeoutMs: 45_000 },
    timeoutMs: 60_000,
    urlsByProvider: {
      custom: ["https://platform.openai.com/docs/overview"],
      exa: ["https://platform.openai.com/docs/overview"],
      parallel: ["https://openai.com/api/"],
      valyu: ["https://github.com/openai/openai-python"],
    },
  },
  answer: {
    options: { requestTimeoutMs: 60_000 },
    timeoutMs: 90_000,
    query: "What is the OpenAI API?",
  },
  research: {
    input:
      "Write a short web-grounded report explaining what the OpenAI API is, with cited sources.",
    options: {
      timeoutMs: 180_000,
      pollIntervalMs: 3_000,
      maxConsecutivePollErrors: 2,
    },
    timeoutMs: 240_000,
  },
};

const argv = process.argv.slice(2);
const filters = parseArgs(argv);
const config = await __test__.loadConfig();
const cwd = process.cwd();
const probes = buildProbes(filters);
const outcomes = [];

for (const probe of probes) {
  const status = __test__.getProviderStatusForTool(
    config,
    cwd,
    probe.providerId,
    probe.capability,
  );
  if (!status.available) {
    const outcome = {
      probe,
      status: "skipped",
      message: status.summary,
    };
    outcomes.push(outcome);
    printOutcome(outcome);
    continue;
  }

  try {
    const signal = AbortSignal.timeout(probe.timeoutMs);
    const result = await Promise.race([
      __test__.executeRawProviderRequest({
        capability: probe.capability,
        config,
        explicitProvider: probe.providerId,
        ctx: { cwd },
        signal,
        options: probe.options,
        ...(probe.capability === "search"
          ? {
              maxResults: probe.maxResults,
              query: probe.query,
            }
          : probe.capability === "contents"
            ? {
                urls: probe.urls,
              }
            : probe.capability === "answer"
              ? {
                  query: probe.query,
                }
              : {
                  input: probe.input,
                }),
      }),
      createProbeTimeout(probe),
    ]);

    const message = summarizeProbeResult(probe, result);
    const outcome = {
      probe,
      status: "passed",
      message,
    };
    outcomes.push(outcome);
    printOutcome(outcome);
  } catch (error) {
    const outcome = {
      probe,
      status: "failed",
      message: formatError(error),
    };
    outcomes.push(outcome);
    printOutcome(outcome);
  }
}

printSummary(outcomes);
process.exit(outcomes.some((outcome) => outcome.status === "failed") ? 1 : 0);

function parseArgs(args) {
  const filters = {
    includeResearch: false,
    providerId: undefined,
    capability: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--include-research") {
      filters.includeResearch = true;
      continue;
    }
    if (arg === "--provider") {
      filters.providerId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--tool") {
      filters.capability = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return filters;
}

function printHelp() {
  console.log(
    [
      "Usage: npm run smoke:live -- [--provider <id>] [--tool <capability>] [--include-research]",
      "",
      "Options:",
      "  --provider <id>        Run probes only for a single provider id",
      "  --tool <capability>    Run probes only for one tool: search|contents|answer|research",
      "  --include-research     Include research probes (slower and higher cost)",
    ].join("\n"),
  );
}

function buildProbes(filters) {
  const capabilities = filters.capability
    ? [filters.capability]
    : Object.keys(PROVIDERS_BY_TOOL).filter(
        (capability) =>
          capability !== "research" || filters.includeResearch === true,
      );

  return capabilities.flatMap((capability) =>
    PROVIDERS_BY_TOOL[capability]
      .filter(
        (providerId) =>
          filters.providerId === undefined || providerId === filters.providerId,
      )
      .map((providerId) => buildProbe(capability, providerId)),
  );
}

function buildProbe(capability, providerId) {
  if (capability === "search") {
    return {
      capability,
      providerId,
      query: PROBE_INPUTS.search.query,
      maxResults: PROBE_INPUTS.search.maxResults,
      options: PROBE_INPUTS.search.options,
      timeoutMs: PROBE_INPUTS.search.timeoutMs,
    };
  }

  if (capability === "contents") {
    return {
      capability,
      providerId,
      urls: PROBE_INPUTS.contents.urlsByProvider[providerId],
      options: PROBE_INPUTS.contents.options,
      timeoutMs: PROBE_INPUTS.contents.timeoutMs,
    };
  }

  if (capability === "answer") {
    return {
      capability,
      providerId,
      query: PROBE_INPUTS.answer.query,
      options: PROBE_INPUTS.answer.options,
      timeoutMs: PROBE_INPUTS.answer.timeoutMs,
    };
  }

  return {
    capability,
    providerId,
    input: PROBE_INPUTS.research.input,
    options: PROBE_INPUTS.research.options,
    timeoutMs: PROBE_INPUTS.research.timeoutMs,
  };
}

function createProbeTimeout(probe) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`probe timed out after ${formatDuration(probe.timeoutMs)}`),
      );
    }, probe.timeoutMs);
    timer.unref?.();
  });
}

function formatDuration(durationMs) {
  const totalSeconds = Math.ceil(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

function summarizeProbeResult(probe, result) {
  if (probe.capability === "search") {
    return `${result.results.length} result(s)`;
  }

  if (probe.capability === "contents") {
    const successes = result.answers.filter(
      (answer) =>
        typeof answer.content === "string" || answer.summary !== undefined,
    );
    if (successes.length === 0) {
      throw new Error(
        result.answers[0]?.error ||
          "contents probe returned no readable content",
      );
    }
    return `${successes.length}/${result.answers.length} URL(s) returned content`;
  }

  const text = result.text?.trim() ?? "";
  if (!text) {
    throw new Error("probe returned empty text");
  }

  return `${text.length} char(s)`;
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function printOutcome(outcome) {
  const label = `${outcome.probe.providerId}/${outcome.probe.capability}`;
  console.log(
    `${outcome.status.toUpperCase().padEnd(7)} ${label.padEnd(18)} ${outcome.message}`,
  );
}

function printSummary(outcomes) {
  const counts = outcomes.reduce(
    (summary, outcome) => {
      summary[outcome.status] += 1;
      return summary;
    },
    { passed: 0, failed: 0, skipped: 0 },
  );

  console.log("");
  console.log(
    `Summary: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped`,
  );
}
