---
title: Per-URL web status rows
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T09:51:30.031417Z
---

Pi now shows one status row per requested URL for web contents, in input order: `○` queued, `◌` running, `✓` done, `✗` failed, and `−` cancelled. Rows update in place and remain visible after completion while page bodies stay collapsed. Other web tools use glyph-prefixed progress and failure lines. Library contents callbacks expose indexed, credential-redacted lifecycle events; CLI progress logs are unchanged.
