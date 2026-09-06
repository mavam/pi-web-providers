---
title: Scope provider options by capability
type: bugfix
authors:
  - mavam
  - codex
created: 2026-04-03T17:45:00Z
---

Provider options are now scoped strictly to the managed tool that uses them. This fixes cases where search-only defaults or schema fields could appear to bleed into other tools, such as Exa `web_search` options showing up alongside `web_contents`.

As part of this cleanup, providers with capability-specific defaults now store them under capability-specific configuration blocks, and tools without per-call provider options no longer expose an empty `options.provider` object.
