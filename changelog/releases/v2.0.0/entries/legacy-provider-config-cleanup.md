---
title: Legacy provider config cleanup
type: breaking
author: mavam
created: 2026-03-31T05:09:59.094113Z
---

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
