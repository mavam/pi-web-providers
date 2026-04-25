import { afterEach, describe, expect, it, vi } from "vitest";

const { codexCtorMock, startThreadMock, runStreamedMock } = vi.hoisted(() => ({
  codexCtorMock: vi.fn(),
  startThreadMock: vi.fn(),
  runStreamedMock: vi.fn(),
}));

vi.mock("@openai/codex-sdk", () => ({
  Codex: codexCtorMock.mockImplementation(function MockCodex() {
    return {
      startThread: startThreadMock,
    };
  }),
}));

import { codexAdapter } from "../src/providers/codex.js";

afterEach(() => {
  codexCtorMock.mockClear();
  startThreadMock.mockReset();
  runStreamedMock.mockReset();
});

describe("CodexAdapter", () => {
  it("forwards only user-facing search options and keeps managed thread settings fixed", async () => {
    startThreadMock.mockReturnValue({
      runStreamed: runStreamedMock.mockResolvedValue({
        events: createEvents([
          {
            type: "item.completed",
            item: {
              type: "agent_message",
              text: JSON.stringify({
                sources: [
                  {
                    title: "Official docs",
                    url: "https://example.com/docs",
                    snippet: "Primary documentation",
                  },
                ],
              }),
            },
          },
        ]),
      }),
    });

    const provider = codexAdapter;
    const response = await provider.search(
      "latest docs",
      5,
      {
        apiKey: "literal-key",
        options: {
          model: "gpt-4.1",
          modelReasoningEffort: "low",
          webSearchMode: "live",
          networkAccessEnabled: true,
          webSearchEnabled: true,
          additionalDirectories: ["docs"],
        },
      },
      {
        cwd: "/repo",
      },
      {
        model: "gpt-5-codex",
        modelReasoningEffort: "high",
        webSearchMode: "cached",
        sandboxMode: "danger-full-access",
        workingDirectory: "/tmp/override",
        skipGitRepoCheck: false,
        approvalPolicy: "on-request",
        networkAccessEnabled: false,
        webSearchEnabled: false,
        additionalDirectories: ["tmp"],
      },
    );

    expect(startThreadMock).toHaveBeenCalledWith({
      additionalDirectories: ["docs"],
      approvalPolicy: "never",
      model: "gpt-5-codex",
      modelReasoningEffort: "high",
      networkAccessEnabled: true,
      sandboxMode: "read-only",
      skipGitRepoCheck: true,
      webSearchEnabled: true,
      webSearchMode: "cached",
      workingDirectory: "/repo",
    });
    expect(response.results).toEqual([
      {
        title: "Official docs",
        url: "https://example.com/docs",
        snippet: "Primary documentation",
      },
    ]);
  });
});

function createEvents(events: unknown[]) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}
