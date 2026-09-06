import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { expect, it, vi } from "vitest";

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    interactions = {
      create: async () => ({ id: "opaque-research-job" }),
      get: async () => ({
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text: "# The question of life\n\nResearch report.",
              },
            ],
          },
        ],
      }),
    };
  },
}));

import { runCli } from "../src/cli.js";

it.each([false, true])(
  "keeps Gemini research logs on stderr and the report on stdout (quiet=%s)",
  async (quiet) => {
    const directory = await mkdtemp(join(tmpdir(), "webfox-research-cli-"));
    try {
      const config = join(directory, "config.yaml");
      await writeFile(config, "{}");
      let stdout = "";
      let stderr = "";
      const order: string[] = [];
      const code = await runCli(
        [
          "research",
          "--provider",
          "gemini",
          "research the question of life",
          ...(quiet ? ["--quiet"] : []),
        ],
        {
          cwd: directory,
          env: { WEBFOX_CONFIG: config, GOOGLE_API_KEY: "test-only-key" },
          stdin: Readable.from([]),
          stdout: new Writable({
            write(chunk, _encoding, done) {
              stdout += chunk;
              order.push("stdout");
              done();
            },
          }),
          stderr: new Writable({
            write(chunk, _encoding, done) {
              stderr += chunk;
              order.push("stderr");
              done();
            },
          }),
        },
      );
      expect(code).toBe(0);
      expect(stdout).toContain("# The question of life\n\nResearch report.");
      expect(stdout).not.toMatch(/Submitting|accepted|completed in|[▶✔]/);
      if (quiet) {
        expect(stderr).toBe("");
      } else {
        expect(stderr).toMatch(
          /^▶︎ Submitting research to Gemini\.\n▶︎ Gemini accepted the request; waiting for the report\.\n✔︎ Research via Gemini completed in \d+s\.\n$/,
        );
        expect(stderr).not.toContain("opaque-research-job");
        expect(stderr).not.toContain("# The question");
        expect(order).toEqual(["stderr", "stderr", "stderr", "stdout"]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
