---
title: Consistent control-character filtering in Pi
type: bugfix
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T15:03:19.805162Z
---

Pi input rows now consistently remove terminal control characters, including bell characters, while displaying newlines, tabs, and quotes as escaped text. Rendering no longer depends on whether the runtime preserves stray control bytes when stripping terminal sequences.
