---
title: Gemini grounded answers and research only
type: breaking
authors:
  - mavam
prs:
  - 37
created: 2026-09-06 14:12:00.391153+00:00
---

Gemini no longer offers standalone search. Use its Google Search-grounded answer
capability instead:

```sh
web answer "your question" --provider gemini
```

If Gemini was your search default, select a search-capable provider and remove
`providers.gemini.options.search` from your configuration. Grounded answers now
use `gemini-3.8-flash` by default; explicit model overrides remain supported.
Deep research uses the dedicated `deep-research-preview-04-2026` agent.
