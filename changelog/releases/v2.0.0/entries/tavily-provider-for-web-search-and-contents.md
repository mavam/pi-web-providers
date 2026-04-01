---
title: Tavily provider for web search and contents
type: feature
authors:
  - mavam
  - codex
created: 2026-04-01T04:15:46Z
---

The new `tavily` provider adds `web_search` support via [Tavily](https://tavily.com) Search and
`web_contents` support via Tavily Extract.

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

You can pass Tavily Search options such as `searchDepth`, `topic`,
`timeRange`, `includeRawContent`, and `exactMatch` through
`providers.tavily.options.search` or per-call `web_search.options`.

You can pass Tavily Extract options such as `extractDepth`, `format`,
`includeImages`, `query`, and `chunksPerSource` through
`providers.tavily.options.extract` or per-call `web_contents.options`.
