---
title: Gemini web contents via URL Context
type: feature
authors:
  - mavam
pr: 3
created: 2026-03-10T09:15:15.000000Z
---

The Gemini provider now supports the `web_contents` tool, which extracts the
main textual content from one or more public URLs. The implementation uses
Gemini's built-in URL Context tool (`urlContext`), letting the model read and
return cleaned page content without an external extraction service.

Retrieval metadata is included in the output: successful fetches are counted in
the summary, and failures (paywall, error, unsafe) are surfaced as retrieval
issues. A new `contentsModel` setting controls which model is used for content
extraction, defaulting to `gemini-2.5-flash`.
