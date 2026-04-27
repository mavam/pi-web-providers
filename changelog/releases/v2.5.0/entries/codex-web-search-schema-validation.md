---
title: Codex web_search schema validation
type: bugfix
author: dzonatan
pr: 15
created: 2026-04-27T08:16:14.376053Z
---

The Codex provider's `web_search` tool now works with Codex response schema validation. Previously, searches could fail immediately with an `invalid_json_schema` error before returning any results.
