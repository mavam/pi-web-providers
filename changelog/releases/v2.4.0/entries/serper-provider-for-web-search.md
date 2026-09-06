---
title: Serper provider for web search
type: feature
author: Thinkscape
pr: 13
created: 2026-04-15T07:44:29.409618Z
---

You can now route `web_search` through Serper with a `SERPER_API_KEY`, giving you another API-backed provider for fast Google-style search results.

```json
{
  "tools": {
    "search": "serper"
  },
  "providers": {
    "serper": {
      "apiKey": "SERPER_API_KEY"
    }
  }
}
```

Serper preserves rich search context such as sitelinks, answer boxes, knowledge graph data, and related searches, which makes the returned results more useful for follow-up analysis.
