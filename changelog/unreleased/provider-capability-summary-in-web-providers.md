---
title: Provider capability summary in /web-providers
type: change
authors:
  - mavam
  - codex
created: 2026-04-01T04:55:21.760706Z
---

The `/web-providers` settings view now shows each provider's supported capabilities directly in the `Providers` section, so you can see at a glance which backends support `web_search`, `web_contents`, `web_answer`, and `web_research` without leaving the UI.

For example, the provider list now includes capability columns alongside the provider status:

```text
Providers
  Provider    S C A R  Status
  Exa         ✔ ✔ ✔ ✔  configured
  Codex       ✔        builtin
```

This makes it easier to choose tool mappings without having to cross-reference the README.
