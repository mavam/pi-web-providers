#!/usr/bin/env node

import { createWebMux, loadConfig, WebMuxError } from "../dist/index.js";

const args = process.argv.slice(2);
const providerFilter = readOption(args, "--provider");
const capabilityFilter =
  readOption(args, "--capability") ?? readOption(args, "--tool");
const includeResearch = args.includes("--include-research");

if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "Usage: npm run smoke:live -- [--provider <id>] [--capability <name>] [--include-research]",
  );
  process.exit(0);
}

const config = await loadConfig();
const client = createWebMux({ config });
const outcomes = [];

for (const provider of client.listProviders()) {
  if (providerFilter && provider.id !== providerFilter) continue;
  for (const capability of provider.capabilities) {
    if (capabilityFilter && capability !== capabilityFilter) continue;
    if (capability === "research" && !includeResearch) continue;

    try {
      const signal = AbortSignal.timeout(
        capability === "research" ? 360_000 : 90_000,
      );
      const result =
        capability === "search"
          ? await client.search({
              provider: provider.id,
              queries: ["OpenAI API"],
              maxResults: 3,
              signal,
            })
          : capability === "contents"
            ? await client.contents({
                provider: provider.id,
                urls: ["https://openai.com/api/"],
                signal,
              })
            : capability === "answer"
              ? await client.answer({
                  provider: provider.id,
                  queries: ["What is the OpenAI API?"],
                  signal,
                })
              : await client.research({
                  provider: provider.id,
                  input:
                    "Write a concise web-grounded explanation of the OpenAI API with cited sources.",
                  signal,
                });

      if (result.status === "partial") {
        throw new Error(
          result.results.find((entry) => !entry.ok)?.error?.message ??
            "partial result",
        );
      }
      outcomes.push("passed");
      console.log(`PASS ${provider.id}/${capability}`);
    } catch (error) {
      if (
        error instanceof WebMuxError &&
        error.code === "PROVIDER_UNAVAILABLE"
      ) {
        outcomes.push("skipped");
        console.log(`SKIP ${provider.id}/${capability}: ${error.message}`);
      } else {
        outcomes.push("failed");
        console.error(
          `FAIL ${provider.id}/${capability}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

const passed = outcomes.filter((value) => value === "passed").length;
const skipped = outcomes.filter((value) => value === "skipped").length;
const failed = outcomes.filter((value) => value === "failed").length;
console.log(`\n${passed} passed, ${skipped} skipped, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;

function readOption(argv, name) {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}
