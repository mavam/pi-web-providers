---
title: Provider capability matrix
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T14:59:41.582497Z
---

`webfox providers` now displays providers as rows and capabilities as centered columns. Leading stars distinguish unconfigured providers (`☆`) from those with at least one configured capability (`★`). Capability cells show support (`✔︎`), lack of support (`✘︎`), or the selected default (`◉`), independently of credentials. A compact legend replaces the configuration disclaimer. Terminal colors respect `NO_COLOR` and `--no-color`.
