---
title: Linkup provider for web search and contents
type: feature
author: mavam
created: 2026-04-01T22:20:31.238323Z
---

The extension now supports Linkup as a provider for `web_search` and `web_contents`.

You can route both tools to Linkup with `LINKUP_API_KEY`:

```json
{
  "tools": {
    "search": "linkup",
    "contents": "linkup"
  },
  "providers": {
    "linkup": {
      "apiKey": "LINKUP_API_KEY"
    }
  }
}
```

This adds a simple option for standard web search plus markdown page extraction.
