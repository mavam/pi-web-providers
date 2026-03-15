---
title: Async search prefetch and local content store
type: feature
authors:
  - mavam
  - codex
created: 2026-03-15T20:54:55.904964Z
---

`web_search` now supports background page prefetching through `options.prefetch`, so you can warm a local content cache while the search results are returned.

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

Later `web_contents` calls can reuse those prefetched pages instead of refetching matching URLs, which speeds up search-to-read workflows and avoids redundant network requests.
