# 🌍 pi-web-providers

A _meta_ web extension for [pi](https://pi.dev).

## Why?

Most web extensions hard-wire a single search-and-fetch pipeline. That works
until you want to swap providers, compare results, or use a capability—like deep
research—that only one backend offers.

**pi-web-providers** takes a different approach: it doesn't do web work itself.
Instead it dispatches every request to a **configurable set of providers**,
giving you maximum flexibility and choice when it comes to consuming web results.

The tool surface is **capability-based, not static**. At startup the extension
inspects which providers are available and what each one supports, then registers
only the tools that make sense. If your active provider offers search and
content extraction but not deep research, the agent never sees a research tool.
Switch to a provider that supports it and the tool appears automatically.

The extension also separates **available tools** from the **active tool set**.
When a session starts, it can add every available managed tool. Before each
agent run, it removes tools that are no longer available but keeps any managed
tools that you explicitly removed from the active set disabled. That keeps the
tool prompt aligned with the tools that the agent can actually call.

## ✨ Features

- **Provider-driven tool surface** — tools are injected based on what the active
  provider actually supports, not a fixed list
- **Six providers**: Claude, Codex, Exa, Gemini, Parallel, Valyu — each with
  its own SDK, strengths, and capability set
- **One config command** (`/web-providers`) with a TUI that adapts to the
  selected provider
- **Transparent fallback** — search falls back to Codex first, then Claude,
  when no provider is explicitly enabled and the local CLI is installed and
  authenticated
- **Per-provider tool toggles** — disable individual capabilities you don't need
  without switching providers
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

This command edits a single global config file:
`~/.pi/agent/web-providers.json`.

The flow is provider-first: pick the active provider, then configure only that
provider's tool toggles and settings. Each provider view surfaces the knobs that
actually apply—Claude shows model/effort/turns settings; Codex shows
reasoning-effort and web-search-mode toggles; Exa shows search type and
text-content flags; and so on.

## 🔧 Tools

Which of the tools below are registered depends on the capabilities of the
available providers. If no provider supports a given capability, the
corresponding tool is never exposed to the agent.

### `web_search`

Search the web and return titles, URLs, and snippets.

| Parameter    | Type    | Default  | Description                                                                   |
| ------------ | ------- | -------- | ----------------------------------------------------------------------------- |
| `query`      | string  | required | What to search for                                                            |
| `maxResults` | integer | `5`      | Result count, clamped to `1–20`                                               |
| `provider`   | string  | auto     | Optional override: `claude`, `codex`, `exa`, `gemini`, `parallel`, or `valyu` |

### `web_contents`

Extract contents for one or more URLs.

| Parameter  | Type     | Default  | Description                                             |
| ---------- | -------- | -------- | ------------------------------------------------------- |
| `urls`     | string[] | required | One or more URLs to extract                             |
| `options`  | object   | —        | Provider-specific extraction options                    |
| `provider` | string   | auto     | Optional override among providers that support contents |

### `web_answer`

Get a provider-generated answer grounded in search results.

| Parameter  | Type   | Default  | Description                                            |
| ---------- | ------ | -------- | ------------------------------------------------------ |
| `query`    | string | required | Question to answer                                     |
| `options`  | object | —        | Provider-specific answer options                       |
| `provider` | string | auto     | Optional override among providers that support answers |

### `web_research`

Run a longer-form research task.

| Parameter  | Type   | Default  | Description                                             |
| ---------- | ------ | -------- | ------------------------------------------------------- |
| `input`    | string | required | Research brief or question                              |
| `options`  | object | —        | Provider-specific research options                      |
| `provider` | string | auto     | Optional override among providers that support research |

## 🔌 Providers

Every provider is a thin adapter around an official SDK. The table below
summarises which capabilities each provider exposes:

| Provider     | search | contents | answer | research | Auth                   |
| ------------ | :----: | :------: | :----: | :------: | ---------------------- |
| **Claude**   |   ✓    |          |   ✓    |          | Local Claude Code auth |
| **Codex**    |   ✓    |          |        |          | Local Codex CLI auth   |
| **Exa**      |   ✓    |    ✓     |   ✓    |    ✓     | `EXA_API_KEY`          |
| **Gemini**   |   ✓    |          |   ✓    |    ✓     | `GOOGLE_API_KEY`       |
| **Parallel** |   ✓    |    ✓     |        |          | `PARALLEL_API_KEY`     |
| **Valyu**    |   ✓    |    ✓     |   ✓    |    ✓     | `VALYU_API_KEY`        |

### Claude

- SDK: `@anthropic-ai/claude-agent-sdk`
- Uses Claude Code's built-in `WebSearch` and `WebFetch` tools behind a
  structured JSON adapter
- Great for search plus grounded answers if you already use Claude Code locally

### Codex

- SDK: `@openai/codex-sdk`
- Runs in read-only mode with web search enabled
- Best if you already use the local Codex CLI and auth flow

### Exa

- SDK: `exa-js`
- Neural, keyword, hybrid, and deep-research search modes
- Inline text-content extraction on search results

### Gemini

- SDK: `@google/genai`
- Grounded answers and deep-research agents via Google's Gemini API

### Parallel

- SDK: `parallel-web`
- Agentic and one-shot search modes
- Page content extraction with excerpt and full-content toggles

### Valyu

- SDK: `valyu-js`
- Web, proprietary, and news search types
- Configurable response length for answers and research

## 📝 Config Notes

- `/web-providers` keeps exactly one provider active by writing `enabled: true`
  for the selected provider and `enabled: false` for the others
- Each provider can also enable or disable its individual tools through a `tools`
  block
- Managed tools are registered from available provider capabilities, but the
  active tool set can still be narrower if you removed a tool from the session
- If no provider is explicitly enabled for search, the extension falls back to
  Codex first and then Claude when the local CLI is installed and authenticated,
  unless either provider was explicitly configured as disabled
- Tools stay inactive when no provider is available for their capability, so
  they are not injected into the LLM prompt
- Before each agent run, the extension removes newly unavailable managed tools
  and keeps manually pruned managed tools inactive instead of re-adding them
- Secret-like values can be:
  - literal strings
  - environment variable names such as `EXA_API_KEY`
  - shell commands prefixed with `!`

Example:

```json
{
  "version": 1,
  "providers": {
    "claude": {
      "enabled": false,
      "tools": {
        "search": true,
        "answer": true
      }
    },
    "codex": {
      "enabled": true,
      "tools": {
        "search": true
      },
      "defaults": {
        "webSearchMode": "live",
        "networkAccessEnabled": true
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
      "defaults": {
        "type": "auto",
        "contents": {
          "text": true
        }
      }
    },
    "gemini": {
      "enabled": false,
      "tools": {
        "search": true,
        "answer": true,
        "research": true
      },
      "apiKey": "GOOGLE_API_KEY",
      "defaults": {
        "searchModel": "gemini-2.5-flash",
        "answerModel": "gemini-2.5-flash",
        "researchAgent": "deep-research-pro-preview-12-2025"
      }
    },
    "parallel": {
      "enabled": false,
      "tools": {
        "search": true,
        "contents": true
      },
      "apiKey": "PARALLEL_API_KEY",
      "defaults": {
        "search": {
          "mode": "agentic"
        },
        "extract": {
          "excerpts": true,
          "full_content": false
        }
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
      "defaults": {
        "searchType": "all",
        "responseLength": "short"
      }
    }
  }
}
```

## 🛠️ Development

```bash
npm run check
npm test
```

## 📄 License

[MIT](LICENSE)
