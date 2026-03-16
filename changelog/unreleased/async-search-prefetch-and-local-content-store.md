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

Later `web_contents` calls reuse cached or in-flight pages instead of
re-fetching them. Concurrent requests for the same URL are deduplicated
automatically—if a prefetch is still running when `web_contents` asks for the
same page, it piggybacks on the existing request rather than issuing a second
one. Partial cache hits fetch only the missing URLs while serving the rest from
the store.

The prefetch object also accepts `provider`, `ttlMs`, and `contentsOptions` for
finer control over which provider extracts the pages, how long entries stay
valid, and what extraction options to pass through.

The cache lives in memory for the duration of the session and is cleared on
session start.
