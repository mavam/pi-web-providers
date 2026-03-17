---
title: Per-tool provider mapping replaces single active-provider model
type: breaking
authors:
  - mavam
  - codex
created: 2026-03-17T14:29:01.565226Z
---

The config file format changes from a single active-provider model to explicit
per-tool provider mappings. Instead of enabling one provider and toggling its
individual tool capabilities, you now assign each tool (`web_search`,
`web_contents`, `web_answer`, `web_research`) to a specific provider or turn it
off with `null`.

Before:

```json
{
  "version": 1,
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

The `version` field and per-provider `tools` toggles are removed. The
`/web-providers` settings command now has a dedicated tool-mapping section.
Existing config files must be migrated to the new format.
