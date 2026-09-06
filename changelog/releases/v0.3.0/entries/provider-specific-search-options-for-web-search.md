---
title: Provider-specific search options for web_search
type: feature
authors:
  - mavam
  - codex
pr: 2
created: 2026-03-10T08:28:16.86975Z
---

`web_search` now accepts a provider-specific `options` object, so providers can expose richer search controls without forcing every feature into the shared top-level tool shape. For example, Perplexity-backed searches can now pass values such as `country`, `search_mode`, `search_domain_filter`, and `search_recency_filter` through the same managed tool.

This keeps `pi-web-providers` flexible as more providers are added, while preserving a stable shared interface for search queries and result limits.
