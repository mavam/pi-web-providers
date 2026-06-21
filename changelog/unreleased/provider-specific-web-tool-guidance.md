---
title: Provider-specific web tool guidance
type: feature
authors:
  - mavam
  - codex
prs:
  - 21
created: 2026-06-21T10:53:33.485622Z
---

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
