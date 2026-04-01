---
title: Claude and Codex no longer preflight local auth
type: bugfix
authors:
  - mavam
  - codex
created: 2026-04-01T21:12:00Z
---

The Claude and Codex providers no longer try to preflight local login state before exposing their managed tools.

Instead of probing CLI auth state up front, the extension now only validates obvious structural setup such as an explicitly configured executable path that does not exist. Real authentication failures are now surfaced by the underlying CLI at runtime.

For Codex, this also removes the old checks for environment variables and `~/.codex/auth.json`, which could produce false negatives for setups that use Codex's OS credential store, custom `CODEX_HOME` paths, or wrapper-based workflows.
