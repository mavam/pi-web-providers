---
title: Default search to Codex and hide unavailable tools
type: change
authors:
  - mavam
created: 2026-03-09
---

`web_search` now falls back to Codex when no search provider is explicitly
configured and the local Codex CLI is installed and authenticated, and the
extension keeps `web_search`, `web_contents`, `web_answer`, and
`web_research` inactive whenever no provider can satisfy those capabilities so
the LLM does not call them speculatively.
