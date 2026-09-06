---
title: Unified vertical web tool rendering
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T09:59:11.442231Z
---

All four Pi web tools now show one unquoted status row per input, rather than mixing horizontal query previews with vertical URL lists:

```text
web search · limit 2
✔︎ example.com example domain
◌ IANA reserved example domains
```

Rows update in place, stay in input order, and use text-style `✔︎` and `✘︎` glyphs for completion and failure. The entire search-limit annotation is gray. Results stay collapsed until expanded, then use Pi’s native Markdown rendering for headings, links, lists, and syntax-highlighted code blocks.

Library `onProgress` callbacks now expose indexed, credential-redacted lifecycle events for every capability, not just contents. CLI progress logs remain unchanged.
