#!/usr/bin/env node

import { parseArgs } from "node:util";
import { CAPABILITIES, createWebfox } from "../dist/index.js";

const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);

try {
  const { values } = parseArgs({
    options: {
      provider: { type: "string" },
      capability: { type: "string" },
      config: { type: "string" },
      "options-json": { type: "string", default: "{}" },
      "include-research": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: node scripts/live-smoke.mjs --provider <id> [--capability <name>] [--config <path>] [--options-json <json>] [--include-research]",
    );
    console.log(
      "Provider selection is required. Research needs explicit additional consent and can incur charges.",
    );
  } else {
    if (!values.provider)
      throw new Error(
        "Choose exactly one provider with --provider; credentials never select providers.",
      );
    if (values.capability && !CAPABILITIES.includes(values.capability))
      throw new Error(`Unknown capability: ${values.capability}`);
    if (values.capability === "research" && !values["include-research"])
      throw new Error(
        "Research requires --include-research because it can incur charges.",
      );

    const options = JSON.parse(values["options-json"]);
    if (!options || typeof options !== "object" || Array.isArray(options))
      throw new Error("--options-json must be a JSON object.");
    const client = createWebfox({ configPath: values.config });
    const provider = client.getProvider(values.provider);
    if (!provider) throw new Error(`Unknown provider: ${values.provider}`);
    const capabilities = values.capability
      ? [values.capability]
      : provider.capabilities.filter(
          (capability) =>
            capability !== "research" || values["include-research"],
        );
    if (!capabilities.length) throw new Error("No capabilities selected.");
    let failed = 0;
    for (const capability of capabilities) {
      controller.signal.throwIfAborted();
      try {
        client.inspectCapability(capability, provider.id);
        const controls = {
          provider: provider.id,
          options,
          timeoutMs: capability === "research" ? 1_200_000 : 90_000,
          signal: controller.signal,
          onProgress: ({ message }) => console.error(message),
        };
        const result =
          capability === "search"
            ? await client.search({
                ...controls,
                queries: ["Node.js AbortSignal documentation"],
                maxResults: 3,
              })
            : capability === "contents"
              ? await client.contents({
                  ...controls,
                  urls: ["https://nodejs.org/api/globals.html"],
                })
              : capability === "answer"
                ? await client.answer({
                    ...controls,
                    queries: [
                      "What does Node.js AbortSignal.timeout do? Cite a source.",
                    ],
                  })
                : await client.research({
                    ...controls,
                    input:
                      "Explain Node.js AbortSignal.timeout and cancellation in a short cited report.",
                  });
        if (result.status !== "ok")
          throw new Error(
            result.results.find((entry) => !entry.ok)?.error.message ??
              result.status,
          );
        if (!result.results.length || result.results.some((entry) => !entry.ok))
          throw new Error("Missing successful results.");
        for (const entry of result.results) {
          if (capability === "search" && !entry.value.results.length)
            throw new Error("Search returned no results.");
          if (
            (capability === "answer" || capability === "research") &&
            !entry.value.text.trim()
          )
            throw new Error("No textual answer returned.");
          if (
            capability === "contents" &&
            !entry.value.content &&
            !entry.value.summary
          )
            throw new Error("No content returned.");
        }
        console.log(`PASS ${provider.id}/${capability}`);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        failed++;
        console.error(
          `FAIL ${provider.id}/${capability}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    process.exitCode = failed ? 1 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  process.removeListener("SIGINT", cancel);
}
