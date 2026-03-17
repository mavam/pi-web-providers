Web tools now route to providers per-tool, replacing the single active-provider model so you can assign different providers to search, contents, answer, and research independently. Search prefetching warms an in-memory cache in the background, letting follow-up web_contents calls skip re-fetching pages already seen. All tools also gain configurable timeouts, retries, and backoff, while web_search and web_answer now accept batched query arrays to cut round-trips.

## 💥 Breaking changes

### Per-tool provider mapping replaces single active-provider model

The config file format changes from a single active-provider model to explicit per-tool provider mappings. Instead of enabling one provider and toggling its individual tool capabilities, you now assign each tool (`web_search`, `web_contents`, `web_answer`, `web_research`) to a specific provider or turn it off with `null`.

Before:

```json
{
  "providers": {
    "exa": {
      "enabled": true,
      "tools": {
        "search": true,
        "contents": true,
        "answer": false
      }
    }
  }
}
```

After:

```json
{
  "tools": {
    "search": "exa",
    "contents": "exa",
    "answer": null
  },
  "providers": {
    "exa": {
      "apiKey": "EXA_API_KEY"
    }
  }
}
```

Per-provider `tools` toggles are removed and shared execution defaults (`requestTimeoutMs`, `retryCount`, `retryDelayMs`, and the research lifecycle settings) move from per-provider `policy` blocks into a top-level `genericSettings` section. Provider-specific `policy` overrides still take precedence. The `/web-providers` settings command now has three sections: tool routing, provider settings, and generic settings. Existing config files must be migrated to the new format.

*By @mavam and @codex.*

## 🚀 Features

### Async search prefetch and in-memory content cache

`web_search` now supports background page prefetching through `options.prefetch`, so you can warm an in-memory content cache while the search results are returned.

```json
{
  "queries": ["exa docs"],
  "options": {
    "prefetch": {
      "enabled": true,
      "maxUrls": 2
    }
  }
}
```

Later `web_contents` calls reuse cached or in-flight pages instead of re-fetching them. Concurrent requests for the same URL are deduplicated automatically—if a prefetch is still running when `web_contents` asks for the same page, it piggybacks on the existing request rather than issuing a second one. Partial cache hits fetch only the missing URLs while serving the rest from the store.

The prefetch object also accepts `provider`, `ttlMs`, and `contentsOptions` for finer control over which provider extracts the pages, how long entries stay valid, and what extraction options to pass through.

The cache lives in memory for the duration of the session and is cleared on session start.

*By @mavam and @codex.*

### Timeout, retry, and resume controls for all web tools

Web tools now support parent-managed retry and backoff settings through the `options` object, plus per-call timeouts where the selected provider lifecycle can safely enforce them:

- `requestTimeoutMs` — per-request timeout
- `retryCount` — number of retries on transient errors (429, 5xx, network failures)
- `retryDelayMs` — base delay between retries (doubles on each attempt, capped at 30 s)

The `web_research` tool adds controls for long-running investigations. The overall `timeoutMs` starts when the research request begins, including background job creation:

- `pollIntervalMs` — how often to check for completion
- `timeoutMs` — overall deadline for the research job
- `maxConsecutivePollErrors` — consecutive poll failures to tolerate before aborting
- `resumeId` — resume a previously timed-out research job by its ID

Perplexity research remains synchronous, so it only supports `requestTimeoutMs`, `retryCount`, and `retryDelayMs`. Exa and Valyu research support polling, overall deadlines, and resume IDs after job creation, but reject `requestTimeoutMs` because their current SDK lifecycles do not safely support per-request local timeouts. Their research start requests also avoid automatic start retries, because retrying a non-idempotent background-job creation call could create duplicate jobs.

When a research job times out, the error message includes the job ID so you can pick up where it left off:

```
Gemini research exceeded 6h. Resume the background job with
options.resumeId="abc123".
```

All settings are configurable per provider in `~/.pi/agent/web-providers.json`, with provider-native knobs under `native` and parent-managed runtime controls under `policy`.

*By @mavam and @claude.*

## 🔧 Changes

### Batched multi-query web search

The agent can now run several related web searches in a single `web_search` call instead of issuing them one at a time. This reduces round-trips, speeds up research workflows, and returns results grouped by query so context stays organized. Each call can include up to 10 queries.

```json
{
  "queries": ["exa sdk docs", "exa pricing", "exa API limits"],
  "maxResults": 5
}
```

The `query` parameter has been replaced by a required `queries` array. Single searches still work the same way—just wrap the query in a list, up to 10 queries per call.

*By @mavam.*

### Batched web answers and multiline tool-call rendering

`web_answer` now accepts a required `queries` array, matching `web_search`, so you can batch several related questions into one grounded-answer call.

```json
{
  "queries": [
    "What are common Tenzir use cases?",
    "How does Tenzir help with SIEM migration?"
  ]
}
```

Tool-call rendering is also easier to scan: `web_answer` shows the tool name on the first line and each question on its own line below it, and multi-query `web_search` calls now list each query the same way instead of collapsing them into a count. Partial foreground updates for `web_search`, `web_contents`, and `web_answer` no longer clutter the pending tool box.

*By @mavam and @codex.*

### Prettier tool-call display and Markdown web results

Web tool rendering is now cleaner and more consistent:

- `provider=auto` is no longer shown in tool-call headers
- default `maxResults=5` is hidden, while non-default values are shown compactly
- single-query and single-URL calls render on one line with the tool name
- collapsed summaries now consistently show the resolved provider, for example `3 results via gemini`
- provider casing is normalized in partial progress updates

Expanded `web_search` and `web_answer` output now renders as Markdown blocks with `##` headings for each query or question, along with improved spacing between sections. This makes batched results much easier to scan without changing the tool output content.

*By @mavam and @codex.*

### Visible URLs in web_contents tool call header

The `web_contents` tool call header now displays each URL on its own line instead of showing only a count. This makes it easy to see which pages are being fetched without expanding the tool call.

*By @mavam and @claude.*
