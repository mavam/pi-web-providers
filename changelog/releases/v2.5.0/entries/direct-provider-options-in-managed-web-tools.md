---
title: More predictable web provider behavior
type: change
author: mavam
created: 2026-04-27T09:10:47.332163Z
---

Web interactions now follow the provider selected in your saved extension settings more closely.

The available web tool settings are tailored to the configured provider, so pi no longer offers irrelevant options for providers you aren't using. Provider-specific limits are also reflected more accurately, such as Ollama's smaller search result limit.

Timeout, retry, and background content prefetch behavior now comes from the saved extension settings. This makes web search and page-reading behavior more predictable across sessions because these operational preferences no longer vary from one generated request to the next.

Most users don't need to change their configuration. If you experimented with per-request timeout, retry, or prefetch overrides, move those preferences into the saved extension settings instead:

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
