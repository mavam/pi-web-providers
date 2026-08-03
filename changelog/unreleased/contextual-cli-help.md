---
title: Contextual CLI help
type: change
authors:
  - mavam
  - codex
prs:
  - 37
created: 2026-08-03T06:46:03.701626Z
---

Every `web` command now includes fuller task and option descriptions plus
copyable examples for its specific usage context:

```sh
web --help
web search --provider openai --help
web config init --help
```

Top-level help demonstrates complete workflows across capabilities, while
command help documents batching, stdin, output streams, provider selection,
and automation-friendly output. Selecting a provider also shows its exact
schema-derived options alongside the examples.
