---
title: Consistent web interaction settings
type: change
author: mavam
created: 2026-04-27T09:10:47.332163Z
---

Web interactions now use the saved extension settings consistently for timeout, retry, and background content prefetch behavior.

This makes web search and page-reading behavior more predictable across sessions because these operational settings no longer vary from one generated request to the next. If you configured search prefetch under `settings.search`, it continues to run from there:

```json
{
  "settings": {
    "requestTimeoutMs": 30000,
    "retryCount": 1,
    "retryDelayMs": 1000,
    "search": {
      "provider": "exa",
      "maxUrls": 3,
      "ttlMs": 600000
    }
  }
}
```

Most users don't need to change their configuration. If you experimented with per-request timeout, retry, or prefetch overrides, move those preferences into the saved extension settings instead.
