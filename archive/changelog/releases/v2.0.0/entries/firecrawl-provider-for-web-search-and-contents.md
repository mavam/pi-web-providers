---
title: Firecrawl provider for web search and contents
type: feature
authors:
  - mavam
  - codex
pr: 11
created: 2026-04-01T04:50:55.401198Z
---

The new `firecrawl` provider adds `web_search` and `web_contents`
support via Firecrawl's official JavaScript SDK.

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

You can pass Firecrawl search options such as `sources`, `categories`,
`location`, `timeout`, and `scrapeOptions` through
`providers.firecrawl.options.search` or per-call `web_search.options`.

You can pass Firecrawl scrape options such as `formats`,
`onlyMainContent`, `waitFor`, `headers`, `location`, `mobile`,
`proxy`, and cache controls through
`providers.firecrawl.options.scrape` or per-call `web_contents.options`.
