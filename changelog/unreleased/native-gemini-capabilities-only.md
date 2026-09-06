---
title: Native Gemini capabilities only
type: breaking
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T14:12:00.391153Z
---

Gemini now offers grounded answers and deep research without advertising standalone search. The former search integration ran a model interaction and discarded its generated answer, exposing only discovered sources. Use `webfox answer "your question" --provider gemini` for Google Search-grounded answers. If Gemini was your search default, select a search-capable provider with `webfox config default search <provider>` and remove `providers.gemini.options.search` from your configuration.
