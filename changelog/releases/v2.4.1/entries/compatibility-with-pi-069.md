---
title: Compatibility with pi 0.69
type: bugfix
authors:
  - mavam
  - codex
created: 2026-04-23T06:58:20.422657Z
---

The extension now loads correctly with pi 0.69 and later.

Provider tool schemas and session lifecycle hooks now use the current pi extension APIs, so installed web provider packages keep working after pi’s TypeBox and session event updates.
