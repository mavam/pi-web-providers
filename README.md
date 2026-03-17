# 🌍 pi-web-providers

A _meta_ web extension for [pi](https://pi.dev) that routes search, content
extraction, answers, and research through configurable per-tool providers.

## Why?

Most web extensions hard-wire a single backend. **pi-web-providers** lets you
mix and match providers per tool instead, so `web_search`, `web_contents`,
`web_answer`, and `web_research` can each use a different backend or be turned
off entirely.

## ✨ Features

- **Multiple providers** — Claude, Codex, Custom CLI, Exa, Gemini,
  Perplexity, Parallel, Valyu
- **Bring-your-own wrappers** — route tools through any local command that reads
  JSON on stdin and writes JSON on stdout
- **Batched search and answers** — run several related queries in a single
  `web_search` or `web_answer` call and get grouped results back in one response
- **Async contents prefetch** — optionally start background `web_contents`
  extraction from `web_search` results and reuse the cached pages later

## 📦 Install

```bash
pi install npm:pi-web-providers
```

## ⚙️ Configure

Run:

```text
/web-providers
```

This edits the global config file `~/.pi/agent/web-providers.json`. The
settings UI mirrors the three sections below: tools, providers, and generic
settings.

Each tool can be routed to any compatible provider:

| Provider       | search | contents | answer | research | Auth                   |
| -------------- | :----: | :------: | :----: | :------: | ---------------------- |
| **Claude**     |   ✔    |          |   ✔    |          | Local Claude Code auth |
| **Codex**      |   ✔    |          |        |          | Local Codex CLI auth   |
| **Exa**        |   ✔    |    ✔     |   ✔    |    ✔     | `EXA_API_KEY`          |
| **Gemini**     |   ✔    |          |   ✔    |    ✔     | `GOOGLE_API_KEY`       |
| **Perplexity** |   ✔    |          |   ✔    |    ✔     | `PERPLEXITY_API_KEY`   |
| **Parallel**   |   ✔    |    ✔     |        |          | `PARALLEL_API_KEY`     |
| **Valyu**      |   ✔    |    ✔     |   ✔    |    ✔     | `VALYU_API_KEY`        |

Advanced option: `custom-cli` is a configurable adapter provider that can route
any managed tool through a local wrapper command using a JSON stdin/stdout
contract.

See [`example-config.json`](example-config.json) for a full default
configuration.

### Tools

Each managed tool maps to one provider id or `null` for off under the top-level
`tools` key. A tool is only exposed when it is mapped to a compatible provider
and that provider is currently available. Tool-specific settings live under
`toolSettings`; today this covers `toolSettings.search.prefetch`.

#### `web_search`

Find likely sources on the public web for up to 10 queries in a single call
and return titles, URLs, and snippets grouped by query.

| Parameter    | Type     | Default  | Description                                                          |
| ------------ | -------- | -------- | -------------------------------------------------------------------- |
| `queries`    | string[] | required | One or more search queries to run (max 10)                           |
| `maxResults` | integer  | `5`      | Result count per query, clamped to `1–20`                            |
| `options`    | object   | —        | Provider-specific search options plus local `prefetch` orchestration |

`web_search.options.prefetch` is local-only and not forwarded into the provider
SDK. It accepts `provider`, `maxUrls`, `ttlMs`, and `contentsOptions`, and
starts a background page-extraction workflow only when `prefetch.provider` is
set. `/web-providers` can also persist default search prefetch settings under
`toolSettings.search.prefetch`.

#### `web_contents`

Read and extract the main contents of one or more web pages.

| Parameter | Type     | Default  | Description                          |
| --------- | -------- | -------- | ------------------------------------ |
| `urls`    | string[] | required | One or more URLs to extract          |
| `options` | object   | —        | Provider-specific extraction options |

`web_contents` reuses any matching cached pages already present in the local
content store—whether they came from prefetch or an earlier read—and only
fetches missing or stale URLs.

#### `web_answer`

Answer one or more questions using web-grounded evidence.

| Parameter | Type     | Default  | Description                                          |
| --------- | -------- | -------- | ---------------------------------------------------- |
| `queries` | string[] | required | One or more questions to answer in one call (max 10) |
| `options` | object   | —        | Provider-specific options                            |

Responses are grouped into per-question sections when more than one question is provided.

#### `web_research`

Investigate a topic across web sources and produce a longer report.

| Parameter | Type   | Default  | Description                |
| --------- | ------ | -------- | -------------------------- |
| `input`   | string | required | Research brief or question |
| `options` | object | —        | Provider-specific options  |

`options` are provider-native and provider-specific. Equivalent concepts can use
different field names across SDKs—for example Perplexity uses `country`, Exa
uses `userLocation`, and Valyu uses `countryCode`. Runtime `options` override
provider-native config, but managed tool inputs and tool wiring stay fixed.

<details>
<summary><strong>Timeout, retry, and delivery modes</strong></summary>

The extension accepts local control fields for robustness: `requestTimeoutMs`,
`retryCount`, and `retryDelayMs` on request/response tools, plus
`pollIntervalMs`, `timeoutMs`, `maxConsecutivePollErrors`, and `resumeId` on
`web_research` for lifecycle-based research providers. These fields are handled
by the extension and are not forwarded into the provider SDK call.

- Exa and Valyu research support polling, overall deadlines, and resume IDs
  but reject `requestTimeoutMs` and do not retry non-idempotent job creation.
- Perplexity research runs in streaming foreground mode and only supports
  `requestTimeoutMs`, `retryCount`, and `retryDelayMs`.

Providers deliver results in one of three modes:

- **Silent foreground** — no intermediate output; result returned when done.
- **Streaming foreground** — progress updates while running, but the result is
  still only usable after the tool finishes.
- **Background research** — the provider runs in the background; if
  interrupted, the run can be resumed later via `resumeId`.

</details>

### Providers

Every provider is a thin adapter around an official SDK. Each provider has an
`enabled` toggle that controls whether it is eligible for tool mappings.
Provider config is split into `native` settings (forwarded to the SDK) and
`policy` settings (local overrides that take precedence over generic settings);
legacy `defaults` blocks are still accepted when reading. Secret-like values
can be literal strings, environment variable names (e.g., `EXA_API_KEY`), or
shell commands prefixed with `!`.

<details>
<summary><strong>Claude</strong></summary>

- SDK: `@anthropic-ai/claude-agent-sdk`
- Uses Claude Code's built-in `WebSearch` and `WebFetch` tools behind a
  structured JSON adapter
- Runs in **silent foreground** mode
- Supports request-shaping `options` such as `model`, `thinking`, `effort`, and
  `maxTurns`
- Great for search plus grounded answers if you already use Claude Code locally

</details>

<details>
<summary><strong>Codex</strong></summary>

- SDK: `@openai/codex-sdk`
- Runs in read-only mode with web search enabled
- Runs in **silent foreground** mode
- Supports request-shaping `web_search.options` such as `model`,
  `modelReasoningEffort`, and `webSearchMode`
- Best if you already use the local Codex CLI and auth flow

</details>

<details>
<summary><strong>Custom CLI</strong></summary>

- Runs a caller-configured local command per capability
- Commands read one JSON request from `stdin` and must write one JSON result to
  `stdout`
- `stderr` is treated as progress output and streamed into the tool call while
  the command runs
- Good for wrapping local agent CLIs, shell scripts, or small adapter programs
  without adding a first-class provider to this extension

</details>

<details>
<summary><strong>Exa</strong></summary>

- SDK: `exa-js`
- Search, contents, and answer run in **silent foreground** mode
- Research runs in **background research** mode and supports `resumeId`
- Neural, keyword, hybrid, and deep-research search modes
- Inline text-content extraction on search results

</details>

<details>
<summary><strong>Gemini</strong></summary>

- SDK: `@google/genai`
- Search and answer run in **silent foreground** mode
- Research runs in **background research** mode and supports `resumeId`
- Google Search grounding for answers
- Deep-research agents via Google's Gemini API
- Supports provider-native request options such as `model`, `config`,
  `generation_config`, and `agent_config` depending on the tool

</details>

<details>
<summary><strong>Perplexity</strong></summary>

- SDK: `@perplexity-ai/perplexity_ai`
- `web_search` and `web_answer` run in **silent foreground** mode
- `web_research` runs in **streaming foreground** mode (no `resumeId` support)
- Uses Perplexity Search for `web_search`
- Uses Sonar for `web_answer` and `sonar-deep-research` for `web_research`
- Supports provider-specific `web_search.options` such as `country`,
  `search_mode`, `search_domain_filter`, and `search_recency_filter`

</details>

<details>
<summary><strong>Parallel</strong></summary>

- SDK: `parallel-web`
- Runs in **silent foreground** mode
- Agentic and one-shot search modes
- Page content extraction with excerpt and full-content toggles
- Supports provider-native search and extraction options from the Parallel SDK

</details>

<details>
<summary><strong>Valyu</strong></summary>

- SDK: `valyu-js`
- Search, contents, and answer run in **silent foreground** mode
- Research runs in **background research** mode and supports `resumeId`
- Web, proprietary, and news search types
- Supports provider-native options such as `countryCode`, `responseLength`, and
  search/source filters
- Configurable response length for answers and research

</details>

### Custom CLI provider

`custom-cli` lets you bring your own wrapper command for any managed tool. Each
capability can point at a different local command under
`providers["custom-cli"].native`:

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

That example uses three different wrappers behind the same provider mapping:
Codex for `web_search`, Gemini for `web_contents`, and Claude for
`web_answer`.

Wrapper contract:

- `stdin`: one JSON request object with `capability` plus the per-call managed
  inputs (`query`, `urls`, `input`, `maxResults`, `options`, `cwd`)
- `stdout`: one JSON response object
  - `search`: `{ "results": [{ "title", "url", "snippet" }] }`
  - `contents` / `answer` / `research`: `{ "text": "...", "summary"?: "...", "itemCount"?: 1, "metadata"?: {} }`
- `stderr`: optional progress lines
- exit code `0`: success
- non-zero exit code: failure

See [`examples/custom-cli/README.md`](examples/custom-cli/README.md) for a
longer example showing Codex, Claude, and Gemini wrappers.

### Generic settings

The `genericSettings` block sets shared execution defaults that apply to all
providers unless overridden in a provider's `policy` block:

| Field                              | Default    | Description                                    |
| ---------------------------------- | ---------- | ---------------------------------------------- |
| `requestTimeoutMs`                 | `30000`    | Maximum time for a single provider request     |
| `retryCount`                       | `3`        | Retries for transient failures                 |
| `retryDelayMs`                     | `2000`     | Initial delay before retrying                  |
| `researchPollIntervalMs`           | `3000`     | How often to poll long-running research jobs   |
| `researchTimeoutMs`                | `21600000` | Overall deadline for research before returning |
| `researchMaxConsecutivePollErrors` | `3`        | Consecutive poll failures before stopping      |

## 🛠️ Development

```bash
npm run check
npm test
```

## 📄 License

[MIT](LICENSE)
