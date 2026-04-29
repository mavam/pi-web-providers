This release adds Brave as a first-class web provider and standardizes provider credentials so integrations can support multiple API keys. It also improves search mode guidance, research prompt display, and dependency compatibility.

## 💥 Breaking changes

### Named provider credentials

Provider API credentials now live under the `credentials` map. Existing configuration files that use provider-specific credential keys such as `apiKey` or `apiToken` are rewritten to `credentials.api` when pi reads the config file.

Before:

```json
{
  "providers": {
    "exa": {
      "apiKey": "EXA_API_KEY"
    },
    "cloudflare": {
      "apiToken": "CLOUDFLARE_API_TOKEN",
      "accountId": "CLOUDFLARE_ACCOUNT_ID"
    }
  }
}
```

After:

```json
{
  "providers": {
    "exa": {
      "credentials": {
        "api": "EXA_API_KEY"
      }
    },
    "cloudflare": {
      "credentials": {
        "api": "CLOUDFLARE_API_TOKEN"
      },
      "accountId": "CLOUDFLARE_ACCOUNT_ID"
    }
  }
}
```

The automatic migration applies this change:

- `apiKey` → `credentials.api`
- `apiToken` → `credentials.api`

Non-credential fields such as `baseUrl`, `accountId`, `options`, and `settings` stay at their current locations.

This enables providers that require multiple credentials while keeping single-key providers consistent.

*By @mavam and @codex in #18.*

## 🚀 Features

### Brave web provider

`pi-web-providers` can now route `web_search`, `web_answer`, and `web_research` through Brave.

Configure Brave with separate credentials for Search and Answers:

```json
{
  "tools": {
    "search": "brave",
    "answer": "brave",
    "research": "brave"
  },
  "providers": {
    "brave": {
      "credentials": {
        "search": "BRAVE_SEARCH_API_KEY",
        "answers": "BRAVE_ANSWERS_API_KEY"
      }
    }
  }
}
```

`web_search` uses Brave Web Search by default to return source titles, URLs, snippets, and metadata. It also supports query-time modes for specialized Brave endpoints:

```json
{
  "mode": "llm_context"
}
```

The `llm_context` mode uses Brave LLM Context for query-based retrieval and places extracted source chunks directly in search snippets so agents can read them from normal `web_search` output. The `images` mode maps Brave Image Search results to their source pages while preserving image URLs and dimensions as metadata. The `places` mode maps Brave Place Search results to source-like entries with place metadata such as address, categories, rating, and provider URLs.

`web_answer` and `web_research` use Brave Answers. Answers stream grounded responses with citations and render a `Sources:` section when Brave returns citation data. Research enables Brave's research mode, normalizes the request to `enable_research=true`, `stream=true`, and `enable_citations=false`, and returns the generated report through pi's normal `web_research` artifact flow.

`web_contents` remains separate: use a URL-fetch-capable provider for page extraction, while Brave LLM Context remains available as a search/retrieval mode for query-grounded context.

*By @mavam and @codex in #18.*

## 🔧 Changes

### Clearer search mode guidance

Search tools now describe provider-specific modes more clearly so agents can make better use of each provider's native API options.

For example, local business queries can select places-style search where available, current-event queries can select news modes, and direct lookups can avoid heavier exploratory modes. This improves result relevance without requiring users to know the provider-specific option names.

*By @mavam in #18.*

## 🐞 Bug fixes

### Dependency compatibility updates

Package dependencies are up to date with their latest compatible releases.

This update bumps the provider SDKs and development toolchain used by pi-web-providers:

| Package                          | From       | To         |
| -------------------------------- | ---------- | ---------- |
| `@anthropic-ai/claude-agent-sdk` | `^0.2.119` | `^0.2.123` |
| `@tavily/core`                   | `^0.7.2`   | `^0.7.3`   |
| `openai`                         | `^6.34.0`  | `^6.35.0`  |
| `@mariozechner/pi-ai`            | `^0.70.2`  | `^0.70.6`  |
| `@mariozechner/pi-coding-agent`  | `^0.70.2`  | `^0.70.6`  |
| `@mariozechner/pi-tui`           | `^0.70.2`  | `^0.70.6`  |

*By @mavam in #18.*

### Full expanded web research prompts

Expanded `web_research` calls now provide a useful Markdown detail view without letting long prompts dominate the transcript.

Collapsed tool calls stay compact:

```text
web_research What is pi coding agent? Provide a concise overview...
Started web research via Brave (ctrl+o to expand)
```

Expanding the dispatch result now shows the full submitted brief and report path in a structured Markdown layout:

```md
Started web research via Brave.

## Research brief

What is pi coding agent? Provide a concise overview of its purpose, main features, modes of operation, customization options, and where to find documentation.

## Report path

`.pi/artifacts/research/...md`
```

This makes the collapsed state scannable while preserving the exact research brief for review when expanded.

*By @mavam and @codex in #18.*
