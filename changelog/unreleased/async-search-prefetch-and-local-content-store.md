---
title: Async search prefetch and in-memory content cache
type: feature
authors:
  - mavam
  - codex
created: 2026-03-15T20:54:55.904964Z
---

`web_search` now supports background page prefetching through `options.prefetch`, so you can warm an in-memory content cache while the search results are returned.

```json
{
  "queries": ["exa docs"],
  "options": {
    "prefetch": {
      "enabled": true,
      "maxUrls": 2
    }
  }
}
```

Later `web_contents` calls can reuse those prefetched pages instead of refetching matching URLs, which speeds up search-to-read workflows and avoids redundant network requests. The cache lives in memory for the duration of the session and is not persisted to disk.
