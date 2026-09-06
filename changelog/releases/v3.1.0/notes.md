This release expands web provider coverage with Serper vertical search modes while keeping Brave, Firecrawl, and current Pi installations working with their latest APIs and package scope. It also improves startup behavior by resolving provider secrets only when a web tool runs.

## 🚀 Features

### Serper vertical search modes

Serper-backed `web_search` now supports Serper's vertical modes and webpage scraping through the `mode` option:

```json
{
  "mode": "news",
  "gl": "us",
  "hl": "en",
  "tbs": "qdr:d"
}
```

Use modes such as `images`, `videos`, `maps`, `reviews`, `shopping`, `scholar`, `patents`, `autocomplete`, `lens`, and `webpage` to route a search to the matching Serper endpoint. Webpage scraping includes Markdown by default, making scraped pages easier for agents to consume.

*By @mavam and @codex in #19.*

## 🔧 Changes

### Clearer web tool call summaries

Collapsed web tool calls are easier to scan in pi.

Running `web_*` tools now show concise progress and provider context, successful results focus on the outcome, `web_answer` shows a short answer preview, and mixed results show both the successful and failed parts in one line. Expand a result to read the full output.

*By @mavam and @codex in #23.*

## 🐞 Bug fixes

### Brave Answers API compatibility

Brave-backed `web_answer` and `web_research` now use the current Brave Answers API request format.

Existing Brave configurations continue to work, and users can opt into Brave Pro for answer or research calls:

```json
{
  "providers": {
    "brave": {
      "options": {
        "answer": {
          "model": "brave-pro"
        },
        "research": {
          "model": "brave-pro"
        }
      }
    }
  }
}
```

This keeps Brave grounded answers and research compatible after Brave deprecated the Summarizer API in favor of Answers.

*By @mavam and @codex in #27.*

### Lazy provider secret resolution

Provider secrets are now resolved only when a configured web tool is used, instead of during session startup.

Configurations that use environment variables or `!command` values for provider credentials no longer pay the secret lookup cost just because a pi session starts. For example:

```json
{
  "providers": {
    "exa": {
      "credentials": {
        "api": "!op read op://Private/Exa/api-key"
      }
    }
  }
}
```

If the secret is missing or the command fails, the error is reported when the matching web tool is called.

*By @mavam and @codex in #28.*

### Pi package scope migration compatibility

The extension now works with Pi's new `@earendil-works/*` package scope after the upstream repository migration. Users can install or build the package against current Pi releases without resolving stale `@mariozechner/*` internal package references.

*By @mavam.*

### Support unauthenticated Firecrawl base URLs

Firecrawl provider configurations can now use a custom base URL without requiring an API key, enabling unauthenticated self-hosted instances and local proxies while preserving API key checks for Firecrawl Cloud.

*By @mavam in #29.*
