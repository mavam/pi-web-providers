---
title: Provider capability matrix
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T13:46:52.482205Z
---

`webfox providers` now displays providers as rows and capabilities as columns, using `✔︎` and `✘︎` for support. A hollow star (`☆`) marks configured capabilities; a filled star (`★`) marks capabilities that are both configured and selected as the default. Unconfigured capabilities have no star. A compact legend replaces the configuration disclaimer. Terminal colors respect `NO_COLOR` and `--no-color`.
