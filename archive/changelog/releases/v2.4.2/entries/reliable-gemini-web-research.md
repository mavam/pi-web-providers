---
title: Reliable Gemini web research
type: bugfix
authors:
  - mavam
  - codex
created: 2026-04-25T08:55:03.570509Z
---

Gemini-powered `web_research` requests now start reliably with the default pi workflow. Previously, pi could generate Gemini-specific options that made the request fail before research started.

Collapsed research results also show the correct `ctrl+o to expand` hint when expanded details are available.
