---
title: Multi-provider web access extension for pi
type: feature
authors:
  - mavam
  - claude
created: 2026-03-09T08:14:13.692925Z
---

A new pi extension that gives your agent flexible web access through five
interchangeable providers: **Codex**, **Exa**, **Gemini**, **Parallel**, and
**Valyu**. Rather than locking you into a single search backend, you pick the
provider that fits your workflow and the extension dynamically registers the
right tools.

The extension exposes up to four capabilities—web search, content extraction,
grounded answers, and deep research—depending on what your chosen provider
supports. For example, Exa and Valyu offer all four, Gemini delivers
search plus answers and research, and Codex focuses on fast search. Switching
providers is a single config change; no tool rewiring needed.

Run `/web-providers` to open a TUI that lets you select a provider and fine-tune
its settings, such as search mode, content extraction flags, or response length.
Each provider view shows only the knobs that actually apply, so configuration
stays simple. You can also toggle individual tools on or off per provider if you
want the agent to see only a subset of capabilities.

If no provider is explicitly enabled, the extension automatically falls back to
the first available one. Authentication is per-provider—just set the relevant API
key environment variable or use the Codex CLI's local auth—and you're ready
to go.
