import { defineProvider } from "../definition.js";

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
      options: {
        type: "object",
        properties: {
          model: {
            type: "string",
            description: "Claude model override.",
          },
          effort: {
            anyOf: [
              {
                type: "string",
                const: "low",
              },
              {
                type: "string",
                const: "medium",
              },
              {
                type: "string",
                const: "high",
              },
              {
                type: "string",
                const: "max",
              },
            ],
            description: "How much effort Claude should use.",
          },
          maxTurns: {
            type: "integer",
            minimum: 1,
            description: "Maximum number of Claude turns.",
          },
          maxThinkingTokens: {
            type: "integer",
            minimum: 0,
            description: "Maximum thinking tokens.",
          },
          maxBudgetUsd: {
            type: "number",
            exclusiveMinimum: 0,
            description: "Maximum budget in USD.",
          },
          thinking: {
            type: "object",
            properties: {
              type: {
                type: "string",
                description: "Claude thinking mode.",
              },
            },
            description: "Claude thinking configuration.",
          },
        },
        description: "Claude options.",
      },
      promptGuidelines: [
        "Use Claude search when Claude Code's agentic web-browsing and synthesis are useful for finding likely sources.",
        "Increase effort or maxTurns only for difficult, ambiguous, or multi-step source discovery; keep defaults for simple searches.",
        "Prefer web_contents after Claude search when the task requires direct inspection of a small set of selected URLs.",
      ],
      retrySafe: true,
    },
    answer: {
      options: {
        type: "object",
        properties: {
          model: {
            type: "string",
            description: "Claude model override.",
          },
          effort: {
            anyOf: [
              {
                type: "string",
                const: "low",
              },
              {
                type: "string",
                const: "medium",
              },
              {
                type: "string",
                const: "high",
              },
              {
                type: "string",
                const: "max",
              },
            ],
            description: "How much effort Claude should use.",
          },
          maxTurns: {
            type: "integer",
            minimum: 1,
            description: "Maximum number of Claude turns.",
          },
          maxThinkingTokens: {
            type: "integer",
            minimum: 0,
            description: "Maximum thinking tokens.",
          },
          maxBudgetUsd: {
            type: "number",
            exclusiveMinimum: 0,
            description: "Maximum budget in USD.",
          },
          thinking: {
            type: "object",
            properties: {
              type: {
                type: "string",
                description: "Claude thinking mode.",
              },
            },
            description: "Claude thinking configuration.",
          },
        },
        description: "Claude options.",
      },
      retrySafe: false,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
