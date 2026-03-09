---
title: Truncate large provider tool output
type: change
authors:
  - mavam
created: 2026-03-09
---

`web_contents`, `web_answer`, and `web_research` now use the same truncation
and temp-file spillover path as `web_search`, which keeps large provider
responses from flooding the transcript while still preserving the full output.
