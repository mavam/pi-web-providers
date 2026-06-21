This release surfaces provider-specific web tool guidance so agents can choose the right search and content options for each backend. It also refreshes provider SDK dependencies and keeps Parallel-backed web search and contents compatible with the current SDK.

## 🚀 Features

### Provider-specific web tool guidance

Provider-specific web tool guidance is now surfaced in the registered `web_search` tool, making it easier for agents to choose provider-specific options such as source filters, recency controls, search depth, and provider modes.

Valyu exposes more of its provider options for `web_search` and `web_contents`, including source filters, date filters, `summary`, `extractEffort`, `responseLength`, `maxPriceDollars`, and `screenshot`:

```json
{
  "tools": {
    "search": "valyu",
    "contents": "valyu"
  },
  "providers": {
    "valyu": {
      "credentials": {
        "api": "VALYU_API_KEY"
      },
      "options": {
        "contents": {
          "summary": true,
          "responseLength": "medium"
        }
      }
    }
  }
}
```

*By @mavam and @codex in #21.*

## 🐞 Bug fixes

### Parallel compatibility with the current SDK

Parallel-backed `web_search` and `web_contents` continue to work with the current Parallel SDK.

*By @mavam and @codex in #32.*

### Provider SDK dependency updates

Bun-based installs now use refreshed provider SDK dependencies for Claude, Gemini, Firecrawl, Codex, Exa, OpenAI, and Valyu.

| SDK                              | Previous  | Current   |
| -------------------------------- | --------- | --------- |
| `@anthropic-ai/claude-agent-sdk` | `0.3.177` | `0.3.185` |
| `@google/genai`                  | `2.8.0`   | `2.9.0`   |
| `@mendable/firecrawl-js`         | `4.25.4`  | `4.28.2`  |
| `@openai/codex-sdk`              | `0.139.0` | `0.141.0` |
| `exa-js`                         | `2.13.0`  | `2.14.0`  |
| `openai`                         | `6.42.0`  | `6.44.0`  |
| `valyu-js`                       | `2.8.0`   | `2.9.0`   |

The exposed provider options now include current OpenAI web search controls (`searchContextSize`, `allowedDomains`, and `userLocation`), Exa freshness and content controls, Firecrawl domain filters and scrape options, and Valyu source, answer, and research controls.

No longer supported options are no longer advertised, including Exa `deep-max` search mode and Valyu answer/research `responseLength`.

*By @mavam and @codex in #34.*
