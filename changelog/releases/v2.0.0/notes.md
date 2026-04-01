Three new providers join the lineup: Tavily and Firecrawl add web search and contents support, while Cloudflare Browser Rendering enables full-page extraction for JavaScript-heavy sites. The web research workflow is now fully asynchronous, and the provider settings view shows each backend's supported capabilities at a glance.

## 💥 Breaking changes

### Async web research workflow

The `web_research` tool now always runs asynchronously and uses one execution model across providers.

Start research as before:

```json
{
  "input": "Compare the managed cloud SIEM market in 2026"
}
```

pi now returns immediately, tracks the running job, and later posts a completion message with the saved report path.

If you previously passed research-specific local execution controls such as `requestTimeoutMs`, `retryCount`, `retryDelayMs`, `pollIntervalMs`, `timeoutMs`, `maxConsecutivePollErrors`, or `resumeId` in `web_research.options`, remove them. The async workflow is now the only supported research behavior.

You can still configure the overall async research deadline in `~/.pi/agent/web-providers.json` with `settings.researchTimeoutMs` or a provider-specific override such as `providers.gemini.settings.researchTimeoutMs`.

*By @mavam and @codex.*

### Legacy provider config cleanup

Legacy provider-local enablement fields are no longer accepted in `~/.pi/agent/web-providers.json`.

If your configuration still uses `providers.<id>.enabled` or `providers.<id>.tools`, move capability routing to the top-level `tools` mapping instead.

Before:

```json
{
  "providers": {
    "exa": {
      "enabled": true,
      "tools": {
        "search": true,
        "contents": true
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
    "contents": "exa"
  },
  "providers": {
    "exa": {
      "apiKey": "EXA_API_KEY"
    }
  }
}
```

The release also removes the legacy custom `web_contents` response variant and continues a broader simplification pass across configuration parsing, provider wiring, diagnostics, and the in-memory contents cache. Background prefetch, per-URL reuse, TTL expiry, and session reset behavior still work the same way, but the internals now use smaller, clearer abstractions with less compatibility and caching cruft.

*By @mavam.*

## 🚀 Features

### Cloudflare Browser Rendering provider for web contents

The new `cloudflare` provider adds `web_contents` support via Cloudflare Browser Rendering. It renders pages in a real browser and converts them to Markdown, which helps with JavaScript-heavy sites that do not expose useful content to a plain HTTP fetch.

Configure it with a Cloudflare API token and account ID:

```json
{
  "tools": {
    "contents": "cloudflare"
  },
  "providers": {
    "cloudflare": {
      "apiToken": "CLOUDFLARE_API_TOKEN",
      "accountId": "CLOUDFLARE_ACCOUNT_ID"
    }
  }
}
```

You can also pass Browser Rendering options such as `gotoOptions`, `waitForSelector`, `waitForTimeout`, and `cacheTTL` through `providers.cloudflare.options` or per-call `web_contents.options`.

*By @arpagon, @mavam, and @codex in #9.*

### Firecrawl provider for web search and contents

The new `firecrawl` provider adds `web_search` and `web_contents` support via Firecrawl's official JavaScript SDK.

Configure it with a Firecrawl API key:

```json
{
  "tools": {
    "search": "firecrawl",
    "contents": "firecrawl"
  },
  "providers": {
    "firecrawl": {
      "apiKey": "FIRECRAWL_API_KEY"
    }
  }
}
```

You can pass Firecrawl search options such as `sources`, `categories`, `location`, `timeout`, and `scrapeOptions` through `providers.firecrawl.options.search` or per-call `web_search.options`.

You can pass Firecrawl scrape options such as `formats`, `onlyMainContent`, `waitFor`, `headers`, `location`, `mobile`, `proxy`, and cache controls through `providers.firecrawl.options.scrape` or per-call `web_contents.options`.

*By @mavam and @codex in #11.*

### Tavily provider for web search and contents

The new `tavily` provider adds `web_search` support via [Tavily](https://tavily.com) Search and `web_contents` support via Tavily Extract.

Configure it with a Tavily API key:

```json
{
  "tools": {
    "search": "tavily",
    "contents": "tavily"
  },
  "providers": {
    "tavily": {
      "apiKey": "TAVILY_API_KEY"
    }
  }
}
```

You can pass Tavily Search options such as `searchDepth`, `topic`, `timeRange`, `includeRawContent`, and `exactMatch` through `providers.tavily.options.search` or per-call `web_search.options`.

You can pass Tavily Extract options such as `extractDepth`, `format`, `includeImages`, `query`, and `chunksPerSource` through `providers.tavily.options.extract` or per-call `web_contents.options`.

*By @mavam and @codex.*

## 🔧 Changes

### Provider capability summary in /web-providers

The `/web-providers` settings view now shows each provider's supported capabilities directly in the `Providers` section, so you can see at a glance which backends support `web_search`, `web_contents`, `web_answer`, and `web_research` without leaving the UI.

For example, the provider list now includes capability columns alongside the provider status:

```text
Providers
  Provider    S C A R  Status
  Exa         ✔ ✔ ✔ ✔  configured
  Codex       ✔        builtin
```

This makes it easier to choose tool mappings without having to cross-reference the README.

*By @mavam and @codex.*

## 🐞 Bug fixes

### Claude and Codex no longer preflight local auth

The Claude and Codex providers no longer try to preflight local login state before exposing their managed tools.

Instead of probing CLI auth state up front, the extension now only validates obvious structural setup such as an explicitly configured executable path that does not exist. Real authentication failures are now surfaced by the underlying CLI at runtime.

For Codex, this also removes the old checks for environment variables and `~/.codex/auth.json`, which could produce false negatives for setups that use Codex's OS credential store, custom `CODEX_HOME` paths, or wrapper-based workflows.

*By @mavam and @codex.*

### Gemini research reliability and reporting

Gemini-backed `web_research` runs now fail earlier with clearer diagnostics when the provider stops making forward progress, and the resulting completion messages are easier to review in pi.

The overall research deadline is now configurable through `settings.researchTimeoutMs` or a provider-specific override such as `providers.gemini.settings.researchTimeoutMs`. The default deadline is now 30 minutes.

When Gemini returns terminal states such as `requires_action` or `incomplete`, the extension now reports those outcomes directly instead of continuing to poll until the outer timeout expires.

Async research result messages also render more cleanly in the TUI. The collapsed view now shows a compact metadata summary with the start time, duration, saved file, and any error, while `ctrl+o` expands the full report. Successful expanded reports now render as Markdown.

*By @mavam and @codex.*
