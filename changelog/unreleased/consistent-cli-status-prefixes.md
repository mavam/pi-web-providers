---
title: Consistent CLI status prefixes
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T13:44:10.490216Z
---

CLI status messages now use the same prefixes as Pi tools: `✔︎` for success,
`✘︎` for errors, `▶︎` for progress, and `■` for cancellation. Argument,
configuration, and provider errors include a consistent error code. For example:

```text
✘︎ mavam: TIMEOUT: Operation exceeded its 30s overall deadline.
```

All status messages stay on stderr, leaving text and JSON results unchanged on
stdout. `--quiet` suppresses progress and success notices but never errors.
Status colors respect terminal detection, `NO_COLOR`, and `--no-color`.
