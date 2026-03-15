import { afterEach, describe, expect, it, vi } from "vitest";

const {
  exaCtorMock,
  exaResearchCreateMock,
  exaResearchGetMock,
  valyuCtorMock,
  valyuDeepResearchCreateMock,
  valyuDeepResearchStatusMock,
} = vi.hoisted(() => ({
  exaCtorMock: vi.fn(),
  exaResearchCreateMock: vi.fn(),
  exaResearchGetMock: vi.fn(),
  valyuCtorMock: vi.fn(),
  valyuDeepResearchCreateMock: vi.fn(),
  valyuDeepResearchStatusMock: vi.fn(),
}));

vi.mock("exa-js", () => ({
  Exa: exaCtorMock.mockImplementation(function MockExa() {
    return {
      research: {
        create: exaResearchCreateMock,
        get: exaResearchGetMock,
      },
    };
  }),
}));

vi.mock("valyu-js", () => ({
  Valyu: valyuCtorMock.mockImplementation(function MockValyu() {
    return {
      deepresearch: {
        create: valyuDeepResearchCreateMock,
        status: valyuDeepResearchStatusMock,
      },
    };
  }),
}));

import { __test__ } from "../src/index.js";
import type { WebProvidersConfig } from "../src/types.js";

afterEach(() => {
  vi.useRealTimers();
  exaCtorMock.mockClear();
  exaResearchCreateMock.mockReset();
  exaResearchGetMock.mockReset();
  valyuCtorMock.mockClear();
  valyuDeepResearchCreateMock.mockReset();
  valyuDeepResearchStatusMock.mockReset();
});

describe("research lifecycle providers", () => {
  it("uses Exa lifecycle polling so transient poll errors do not create duplicate jobs", async () => {
    vi.useFakeTimers();

    exaResearchCreateMock.mockResolvedValue({ researchId: "exa-job-1" });
    exaResearchGetMock
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({
        status: "completed",
        output: {
          content: "Exa research result",
        },
      });

    const promise = __test__.executeProviderTool({
      capability: "research",
      config: {
        version: 1,
        providers: {
          exa: {
            enabled: true,
            apiKey: "literal-key",
          },
        },
      } satisfies WebProvidersConfig,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: { pollIntervalMs: 1 },
      input: "Investigate Exa lifecycle polling",
    });

    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(exaCtorMock).toHaveBeenCalledWith("literal-key", undefined);
    expect(exaResearchCreateMock).toHaveBeenCalledTimes(1);
    expect(exaResearchGetMock).toHaveBeenCalledTimes(2);
    expect(exaResearchGetMock).toHaveBeenNthCalledWith(1, "exa-job-1", {
      events: false,
    });
    expect(result.content[0]?.text).toBe("Exa research result");
  });

  it("filters unsupported request timeout defaults from non-idempotent Exa research starts", async () => {
    vi.useFakeTimers();

    exaResearchCreateMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ researchId: "exa-job-1" });
          }, 5);
        }),
    );
    exaResearchGetMock.mockResolvedValueOnce({
      status: "completed",
      output: {
        content: "Exa research result",
      },
    });

    const promise = __test__.executeProviderTool({
      capability: "research",
      config: {
        version: 1,
        providers: {
          exa: {
            enabled: true,
            apiKey: "literal-key",
            policy: {
              requestTimeoutMs: 1,
            },
          },
        },
      } satisfies WebProvidersConfig,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: { pollIntervalMs: 1 },
      input: "Investigate Exa lifecycle polling",
    });

    await vi.advanceTimersByTimeAsync(4);
    expect(exaResearchCreateMock).toHaveBeenCalledTimes(1);
    expect(exaResearchGetMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2);
    const result = await promise;

    expect(exaResearchCreateMock).toHaveBeenCalledTimes(1);
    expect(exaResearchGetMock).toHaveBeenCalledTimes(1);
    expect(result.content[0]?.text).toBe("Exa research result");
  });

  it("applies the overall research timeout while Exa job creation is still pending", async () => {
    vi.useFakeTimers();

    exaResearchCreateMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ researchId: "exa-job-1" });
          }, 5);
        }),
    );

    const promise = __test__.executeProviderTool({
      capability: "research",
      config: {
        version: 1,
        providers: {
          exa: {
            enabled: true,
            apiKey: "literal-key",
          },
        },
      } satisfies WebProvidersConfig,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: { timeoutMs: 1 },
      input: "Investigate Exa lifecycle polling",
    });
    const rejection = expect(promise).rejects.toThrow(
      "Exa research exceeded 1ms. The provider may still create a background job, but no job id was returned so this run cannot be resumed automatically.",
    );

    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(exaResearchCreateMock).toHaveBeenCalledTimes(1);
    expect(exaResearchGetMock).not.toHaveBeenCalled();
  });

  it("filters unsupported request timeout defaults from uncancellable Exa polls", async () => {
    vi.useFakeTimers();

    exaResearchCreateMock.mockResolvedValue({ researchId: "exa-job-1" });
    exaResearchGetMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({ status: "running" });
            }, 5);
          }),
      )
      .mockResolvedValueOnce({
        status: "completed",
        output: {
          content: "Exa research result",
        },
      });

    const promise = __test__.executeProviderTool({
      capability: "research",
      config: {
        version: 1,
        providers: {
          exa: {
            enabled: true,
            apiKey: "literal-key",
            policy: {
              requestTimeoutMs: 1,
            },
          },
        },
      } satisfies WebProvidersConfig,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: { pollIntervalMs: 1 },
      input: "Investigate Exa lifecycle polling",
    });

    await vi.advanceTimersByTimeAsync(4);
    expect(exaResearchGetMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2);
    const result = await promise;

    expect(exaResearchCreateMock).toHaveBeenCalledTimes(1);
    expect(exaResearchGetMock).toHaveBeenCalledTimes(2);
    expect(result.content[0]?.text).toBe("Exa research result");
  });

  it("uses Valyu lifecycle polling so transient poll errors do not create duplicate jobs", async () => {
    vi.useFakeTimers();

    valyuDeepResearchCreateMock.mockResolvedValue({
      success: true,
      deepresearch_id: "valyu-job-1",
    });
    valyuDeepResearchStatusMock
      .mockResolvedValueOnce({
        success: false,
        error: "fetch failed",
      })
      .mockResolvedValueOnce({
        success: true,
        status: "completed",
        output: "Valyu research result",
        sources: [
          {
            title: "Source A",
            url: "https://example.com/a",
          },
        ],
      });

    const promise = __test__.executeProviderTool({
      capability: "research",
      config: {
        version: 1,
        providers: {
          valyu: {
            enabled: true,
            apiKey: "literal-key",
          },
        },
      } satisfies WebProvidersConfig,
      explicitProvider: "valyu",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: { pollIntervalMs: 1 },
      input: "Investigate Valyu lifecycle polling",
    });

    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(valyuCtorMock).toHaveBeenCalledWith("literal-key", undefined);
    expect(valyuDeepResearchCreateMock).toHaveBeenCalledTimes(1);
    expect(valyuDeepResearchStatusMock).toHaveBeenCalledTimes(2);
    expect(valyuDeepResearchStatusMock).toHaveBeenNthCalledWith(
      1,
      "valyu-job-1",
    );
    expect(result.content[0]?.text).toBe(
      "Valyu research result\n\nSources:\n1. Source A\n   https://example.com/a",
    );
  });
});
