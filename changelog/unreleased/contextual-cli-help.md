---
title: Unified CLI help
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T09:25:04.437603Z
---

All command controls are visible with `--help`, including configuration, working directory, complex JSON options, and color settings. Add an explicit provider, such as `webfox search --provider openai --help`, to include its schema-derived flags. Provider discovery distinguishes supported capabilities, locally configured credential sources, and saved defaults without running credential commands or claiming that credentials have been verified. Save a selection with `webfox config default search brave`.
