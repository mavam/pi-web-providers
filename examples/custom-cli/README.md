# Custom CLI wrapper examples

The `custom-cli` provider runs one local command per capability. Each wrapper:

- reads one JSON request from `stdin`
- writes one JSON response to `stdout`
- may stream progress lines on `stderr`

A mixed setup can route different managed tools through different wrappers:

```json
{
  "tools": {
    "search": "custom-cli",
    "contents": "custom-cli",
    "answer": "custom-cli",
    "research": null
  },
  "providers": {
    "custom-cli": {
      "enabled": true,
      "native": {
        "search": {
          "argv": ["node", "./wrappers/codex-search.mjs"]
        },
        "contents": {
          "argv": ["node", "./wrappers/gemini-contents.mjs"]
        },
        "answer": {
          "argv": ["node", "./wrappers/claude-answer.mjs"]
        }
      }
    }
  }
}
```

That example uses:

- Codex for `web_search`
- Gemini for `web_contents`
- Claude for `web_answer`

## Request shapes

Every wrapper receives a single request object. The shape depends on the
capability:

### `search`

```json
{
  "capability": "search",
  "query": "latest codex sdk docs",
  "maxResults": 5,
  "options": {},
  "cwd": "/path/to/project"
}
```

### `contents`

```json
{
  "capability": "contents",
  "urls": ["https://example.com"],
  "options": {},
  "cwd": "/path/to/project"
}
```

### `answer`

```json
{
  "capability": "answer",
  "query": "What changed in the latest Claude Code release?",
  "options": {},
  "cwd": "/path/to/project"
}
```

### `research`

```json
{
  "capability": "research",
  "input": "Compare current local agent SDKs for web-grounded tasks.",
  "options": {},
  "cwd": "/path/to/project"
}
```

## Response shapes

### `search`

```json
{
  "results": [
    {
      "title": "Codex SDK docs",
      "url": "https://github.com/openai/codex/tree/main/sdk/typescript",
      "snippet": "TypeScript SDK reference and examples."
    }
  ]
}
```

### `contents`, `answer`, `research`

```json
{
  "text": "Rendered tool output",
  "summary": "Optional short summary",
  "itemCount": 1,
  "metadata": {}
}
```

## Wrapper sketch: Codex search

```js
// codex-search.mjs
import { Codex } from "@openai/codex-sdk";

const request = await readJsonStdin();
const codex = new Codex();
const thread = codex.startThread({
  approvalPolicy: "never",
  sandboxMode: "read-only",
  skipGitRepoCheck: true,
  webSearchEnabled: true,
  workingDirectory: request.cwd,
});

const streamed = await thread.runStreamed(
  `Search the public web and return JSON with at most ${request.maxResults} results for: ${request.query}`,
  {
    outputSchema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              snippet: { type: "string" },
            },
            required: ["title", "url", "snippet"],
          },
        },
      },
      required: ["results"],
    },
  },
);

let finalText = "";
for await (const event of streamed.events) {
  if (event.type === "item.completed" && event.item.type === "agent_message") {
    finalText = event.item.text;
  }
}
process.stdout.write(finalText);
```

## Wrapper sketch: Gemini contents

```js
// gemini-contents.mjs
import { GoogleGenAI } from "@google/genai";

const request = await readJsonStdin();
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const prompt = `Extract the main textual content from these URLs:\n${request.urls.join("\n")}`;
const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: prompt,
  config: {
    tools: [{ urlContext: {} }],
  },
});
process.stdout.write(
  JSON.stringify({
    text: response.text ?? "No content returned.",
    summary: `Contents via Gemini for ${request.urls.length} URL(s)`,
    itemCount: request.urls.length,
  }),
);
```

## Wrapper sketch: Claude answer

```js
// claude-answer.mjs
import { query } from "@anthropic-ai/claude-agent-sdk";

const request = await readJsonStdin();
const stream = query({
  prompt: `Answer using current public web information: ${request.query}`,
  options: {
    allowedTools: ["WebSearch", "WebFetch"],
    cwd: request.cwd,
    outputFormat: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
      },
    },
    permissionMode: "dontAsk",
    persistSession: false,
  },
});

let finalText = "";
for await (const message of stream) {
  if (message.type === "result") {
    finalText = message.result;
  }
}
process.stdout.write(finalText);
```

The wrapper code above is intentionally minimal. In practice you will usually
add stricter schemas, better error handling, and richer summaries or metadata.
