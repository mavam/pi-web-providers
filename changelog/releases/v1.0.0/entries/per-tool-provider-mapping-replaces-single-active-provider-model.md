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

Per-provider `tools` toggles are removed and shared execution defaults
(`requestTimeoutMs`, `retryCount`, `retryDelayMs`, and the research lifecycle
settings) move from per-provider `policy` blocks into a top-level
`settings` section. Provider-specific `policy` overrides still take
precedence. The `/web-providers` settings command now has three sections: tool
routing, provider settings, and shared settings. Existing config files must be
migrated to the new format.
