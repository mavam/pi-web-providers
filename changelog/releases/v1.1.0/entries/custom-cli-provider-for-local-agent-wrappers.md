---
title: Custom CLI provider for local agent wrappers
type: feature
authors:
  - mavam
created: 2026-03-17T19:38:30Z
---

`pi-web-providers` now supports a `custom-cli` provider that runs caller-configured local commands for `web_search`, `web_contents`, `web_answer`, and `web_research`.

Each capability can point at its own wrapper command under `providers["custom-cli"].native`. Wrappers read one JSON request from `stdin`, write one JSON response to `stdout`, and can stream progress updates on `stderr`.

This makes it easy to integrate additional local agent SDKs or CLIs without adding a dedicated first-class provider. For example, you can route `web_search` through a Codex wrapper, `web_contents` through a Gemini wrapper, and `web_answer` through a Claude wrapper while keeping the shared managed tool surface unchanged.
