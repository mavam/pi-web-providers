# 🌍 pi-web-providers

A _meta_ web extension for [pi](https://pi.dev) that routes search, content
extraction, answers, and research through configurable providers.

## Why?

Most web extensions hard-wire a single backend. **pi-web-providers** dispatches
every request to a **configurable provider** instead, so you can swap backends,
compare results, or tap into capabilities—like deep research—that only certain
providers offer. The tool surface adapts automatically: only tools supported by
your active provider are exposed to the agent.

## ✨ Features

- **Provider-driven tool surface** — tools are registered based on what the
  active provider actually supports, not a fixed list
- **Multiple providers** — Claude, Codex, Exa, Gemini, Perplexity, Parallel,
  Valyu
- **One config command** (`/web-providers`) with a TUI that adapts to the
  selected provider
- **Transparent fallback** — search falls back to Codex when no provider is
  explicitly enabled and the local CLI is installed and authenticated
- **Per-provider tool toggles** — disable individual capabilities without
  switching providers
- **Timeout and retry controls** — configurable request timeouts, retries,
  research polling, deadlines, and resumable background jobs
- **Truncated output with temp-file spillover** for large results

## 📦 Install

```bash
pi install npm:pi-web-providers
```

## ⚙️ Configure

Run:

```text
/web-providers
```

This edits the global config file `~/.pi/agent/web-providers.json`. The flow is
provider-first: pick the active provider, then configure its tool toggles and
settings.

## 🔧 Tools

Which tools are registered depends on the active provider's capabilities. If no
provider supports a given capability, the corresponding tool is never exposed.

### `web_search`

Find likely sources on the public web and return titles, URLs, and snippets.

| Parameter    | Type    | Default  | Description                      |
| ------------ | ------- | -------- | -------------------------------- |
| `query`      | string  | required | What to search for               |
| `maxResults` | integer | `5`      | Result count, clamped to `1–20`  |
| `options`    | object  | —        | Provider-specific search options |
| `provider`   | string  | auto     | Optional provider override       |

### `web_contents`

Read and extract the main contents of one or more web pages.

| Parameter  | Type     | Default  | Description                          |
| ---------- | -------- | -------- | ------------------------------------ |
| `urls`     | string[] | required | One or more URLs to extract          |
| `options`  | object   | —        | Provider-specific extraction options |
| `provider` | string   | auto     | Optional provider override           |

### `web_answer`

Answer a question using web-grounded evidence.

| Parameter  | Type   | Default  | Description                |
| ---------- | ------ | -------- | -------------------------- |
| `query`    | string | required | Question to answer         |
| `options`  | object | —        | Provider-specific options  |
| `provider` | string | auto     | Optional provider override |

### `web_research`

Investigate a topic across web sources and produce a longer report.

| Parameter  | Type   | Default  | Description                |
| ---------- | ------ | -------- | -------------------------- |
| `input`    | string | required | Research brief or question |
| `options`  | object | —        | Provider-specific options  |
| `provider` | string | auto     | Optional provider override |

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

## 🔌 Providers

Every provider is a thin adapter around an official SDK. The table below
summarises capabilities and authentication:

| Provider       | search | contents | answer | research | Auth                   |
| -------------- | :----: | :------: | :----: | :------: | ---------------------- |
| **Claude**     |   ✓    |          |   ✓    |          | Local Claude Code auth |
| **Codex**      |   ✓    |          |        |          | Local Codex CLI auth   |
| **Exa**        |   ✓    |    ✓     |   ✓    |    ✓     | `EXA_API_KEY`          |
| **Gemini**     |   ✓    |    ✓     |   ✓    |    ✓     | `GOOGLE_API_KEY`       |
| **Perplexity** |   ✓    |          |   ✓    |    ✓     | `PERPLEXITY_API_KEY`   |
| **Parallel**   |   ✓    |    ✓     |        |          | `PARALLEL_API_KEY`     |
| **Valyu**      |   ✓    |    ✓     |   ✓    |    ✓     | `VALYU_API_KEY`        |

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
- Search, contents, and answer run in **silent foreground** mode
- Research runs in **background research** mode and supports `resumeId`
- Google Search grounding for answers and URL Context extraction for page
  contents
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

## 📝 Config Notes

- `/web-providers` keeps exactly one provider active (`enabled: true`) and
  disables the rest
- Each provider can enable or disable individual tools through a `tools` block
- Provider config is split into `native` settings (forwarded to the SDK) and
  `policy` settings (enforced by the extension runtime); legacy `defaults`
  blocks are still accepted when reading
- If no provider is explicitly enabled for search, the extension falls back to
  Codex when the local CLI is installed and authenticated
- Secret-like values can be literal strings, environment variable names (e.g.,
  `EXA_API_KEY`), or shell commands prefixed with `!`

<details>
<summary><strong>Full config example</strong></summary>

```json
{
  "version": 1,
  "providers": {
    "claude": {
      "enabled": false,
      "tools": {
        "search": true,
        "answer": true
      },
      "policy": {
        "requestTimeoutMs": 30000,
        "retryCount": 3,
        "retryDelayMs": 2000
      }
    },
    "codex": {
      "enabled": true,
      "tools": {
        "search": true
      },
      "native": {
        "webSearchMode": "live",
        "networkAccessEnabled": true
      },
      "policy": {
        "requestTimeoutMs": 30000,
        "retryCount": 3,
        "retryDelayMs": 2000
      }
    },
    "exa": {
      "enabled": false,
      "tools": {
        "search": true,
        "contents": true,
        "answer": true,
        "research": true
      },
      "apiKey": "EXA_API_KEY",
      "native": {
        "type": "auto",
        "contents": {
          "text": true
        }
      },
      "policy": {
        "requestTimeoutMs": 30000,
        "retryCount": 3,
        "retryDelayMs": 2000,
        "researchPollIntervalMs": 3000,
        "researchTimeoutMs": 21600000,
        "researchMaxConsecutivePollErrors": 3
      }
    },
    "gemini": {
      "enabled": false,
      "tools": {
        "search": true,
        "contents": true,
        "answer": true,
        "research": true
      },
      "apiKey": "GOOGLE_API_KEY",
      "native": {
        "searchModel": "gemini-2.5-flash",
        "contentsModel": "gemini-2.5-flash",
        "answerModel": "gemini-2.5-flash",
        "researchAgent": "deep-research-pro-preview-12-2025"
      },
      "policy": {
        "requestTimeoutMs": 30000,
        "retryCount": 3,
        "retryDelayMs": 2000,
        "researchPollIntervalMs": 3000,
        "researchTimeoutMs": 21600000,
        "researchMaxConsecutivePollErrors": 10
      }
    },
    "perplexity": {
      "enabled": false,
      "tools": {
        "search": true,
        "answer": true,
        "research": true
      },
      "apiKey": "PERPLEXITY_API_KEY",
      "native": {
        "search": {
          "country": "US"
        },
        "answer": {
          "model": "sonar"
        },
        "research": {
          "model": "sonar-deep-research"
        }
      },
      "policy": {
        "requestTimeoutMs": 30000,
        "retryCount": 3,
        "retryDelayMs": 2000
      }
    },
    "parallel": {
      "enabled": false,
      "tools": {
        "search": true,
        "contents": true
      },
      "apiKey": "PARALLEL_API_KEY",
      "native": {
        "search": {
          "mode": "agentic"
        },
        "extract": {
          "excerpts": true,
          "full_content": false
        }
      },
      "policy": {
        "requestTimeoutMs": 30000,
        "retryCount": 3,
        "retryDelayMs": 2000
      }
    },
    "valyu": {
      "enabled": false,
      "tools": {
        "search": true,
        "contents": true,
        "answer": true,
        "research": true
      },
      "apiKey": "VALYU_API_KEY",
      "native": {
        "searchType": "all",
        "responseLength": "short"
      },
      "policy": {
        "requestTimeoutMs": 30000,
        "retryCount": 3,
        "retryDelayMs": 2000,
        "researchPollIntervalMs": 3000,
        "researchTimeoutMs": 21600000,
        "researchMaxConsecutivePollErrors": 3
      }
    }
  }
}
```

</details>

## 🛠️ Development

```bash
npm run check
npm test
```

## 📄 License

[MIT](LICENSE)
