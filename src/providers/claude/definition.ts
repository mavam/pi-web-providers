import { defineProvider } from "../definition.js";

const display = { type: "string", enum: ["summarized", "omitted"] };
const options = {
  type: "object",
  properties: {
    model: { type: "string", description: "Claude model override." },
    effort: {
      type: "string",
      enum: ["low", "medium", "high", "xhigh", "max"],
      description:
        "Reasoning effort. Supported levels depend on the selected model.",
    },
    maxTurns: {
      type: "integer",
      minimum: 1,
      description: "Maximum number of Claude turns.",
    },
    maxThinkingTokens: {
      type: "integer",
      minimum: 0,
      deprecated: true,
      description:
        "Legacy thinking budget. Prefer thinking; thinking takes precedence.",
    },
    maxBudgetUsd: {
      type: "number",
      exclusiveMinimum: 0,
      description: "Maximum budget in USD.",
    },
    thinking: {
      anyOf: [
        {
          type: "object",
          properties: { type: { type: "string", const: "adaptive" }, display },
          required: ["type"],
        },
        {
          type: "object",
          properties: {
            type: { type: "string", const: "enabled" },
            budgetTokens: {
              type: "integer",
              minimum: 0,
              description:
                "Fixed thinking budget for models supporting budgeted thinking.",
            },
            display,
          },
          required: ["type"],
        },
        {
          type: "object",
          properties: { type: { type: "string", const: "disabled" } },
          required: ["type"],
        },
      ],
      description:
        "Model-specific thinking configuration. Adaptive thinking is preferred on newer models.",
    },
  },
  description: "Claude options.",
};

export const claudeProvider = defineProvider({
  id: "claude",
  label: "Claude",
  docsUrl: "https://github.com/anthropics/claude-agent-sdk-typescript",
  local: true,
  credentials: [
    { name: "api", environmentVariable: "ANTHROPIC_API_KEY", optional: true },
    {
      name: "oauth",
      environmentVariable: "CLAUDE_CODE_OAUTH_TOKEN",
      optional: true,
    },
  ],
  fields: ["credentials", "pathToClaudeCodeExecutable", "options"],
  defaults: {},
  credentialDefaults: {},
  capabilities: {
    search: {
      options,
      promptGuidelines: [
        "Use Claude search when Claude Code's agentic web-browsing and synthesis are useful for finding likely sources.",
        "Increase effort or maxTurns only for difficult, ambiguous, or multi-step source discovery; keep defaults for simple searches.",
        "Prefer web_contents after Claude search when the task requires direct inspection of a small set of selected URLs.",
      ],
      retrySafe: true,
    },
    answer: { options, retrySafe: false },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
