---
title: Linkup research provider support
type: feature
authors:
  - mavam
  - codex
prs:
  - 30
created: 2026-05-24T19:37:37.847981Z
---

Linkup can now power the `web_research` tool in addition to `web_search` and `web_contents`.

Example configuration:

```json
{
  "tools": {
    "research": "linkup"
  },
  "providers": {
    "linkup": {
      "credentials": {
        "api": "LINKUP_API_KEY"
      }
    }
  }
}
```

Research calls support Linkup's sourced-answer and structured output modes, plus mode, reasoning-depth, domain, and date filters for controlling the investigation.
