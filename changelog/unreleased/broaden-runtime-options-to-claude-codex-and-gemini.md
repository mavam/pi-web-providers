---
title: Broaden runtime options to Claude, Codex, and Gemini
type: feature
authors:
  - mavam
created: 2026-03-10T16:47:00.000000Z
---

The `options` object that tools accept at call time is now forwarded to the
Claude, Codex, and Gemini providers, giving callers fine-grained control over
each request without changing the shared tool interface.

Claude supports `model`, `effort`, `maxTurns`, `maxThinkingTokens`,
`maxBudgetUsd`, and a `thinking` object. Codex supports `model`,
`modelReasoningEffort`, and `webSearchMode`. Gemini supports provider-native
options: `model` plus `generation_config` for search, `model` plus `config` for
answer and contents, and caller-supplied research options passed through to the
underlying API.

Runtime options override provider defaults from the config, but managed tool
inputs and tool wiring stay fixed.
