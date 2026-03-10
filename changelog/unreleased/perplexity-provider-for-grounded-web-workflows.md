---
title: Perplexity provider for grounded web workflows
type: feature
authors:
  - mavam
  - codex
pr: 2
created: 2026-03-10T08:28:16.118911Z
---

`pi-web-providers` now supports Perplexity as a provider for `web_search`, `web_answer`, and `web_research`. You can enable it from `/web-providers`, authenticate it with `PERPLEXITY_API_KEY`, and use Perplexity-specific defaults such as Sonar for grounded answers and `sonar-deep-research` for longer investigations.

This matters if you want a provider that combines direct search results with grounded model responses without switching to a separate extension.
