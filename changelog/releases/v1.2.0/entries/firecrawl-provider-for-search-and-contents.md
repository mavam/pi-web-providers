---
title: Firecrawl provider for search and contents
type: feature
authors:
  - mavam
  - codex
created: 2026-03-20T15:31:14Z
---

`pi-web-providers` now supports Firecrawl as a built-in provider for `web_search` and `web_contents`.

The Firecrawl adapter uses Firecrawl's Node SDK for direct web search, single-page scraping, and batch page extraction. It integrates with the existing provider routing, `/web-providers` settings UI, search-prefetch flow, and example config.

This makes it easy to route search and content extraction through Firecrawl while keeping answers and research on other providers when needed.
