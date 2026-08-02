import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test-new/**/*.test.ts",
      "test/*-provider.test.ts",
      "test/contents-providers.test.ts",
      "test/execution-policy.test.ts",
      "test/provider-diagnostics.test.ts",
      "test/provider-runtime.test.ts",
      "test/research-lifecycle-providers.test.ts",
    ],
  },
});
