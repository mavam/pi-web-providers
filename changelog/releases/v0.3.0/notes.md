Adds Perplexity as a new provider for web search, answers, and research. Runtime options are now forwarded to Claude, Codex, and Gemini, giving callers fine-grained per-request control, and Gemini gains a web_contents tool that extracts page content via URL Context.

## 🚀 Features

### Broaden runtime options to Claude, Codex, and Gemini

The `options` object that tools accept at call time is now forwarded to the Claude, Codex, and Gemini providers, giving callers fine-grained control over each request without changing the shared tool interface.

Claude supports `model`, `effort`, `maxTurns`, `maxThinkingTokens`, `maxBudgetUsd`, and a `thinking` object. Codex supports `model`, `modelReasoningEffort`, and `webSearchMode`. Gemini supports provider-specific options: `model` plus `generation_config` for search, `model` plus `config` for answer and contents, and caller-supplied research options passed through to the underlying API.

Runtime options override provider defaults from the config, but managed tool inputs and tool wiring stay fixed.

*By @mavam in #3.*

### Gemini web contents via URL Context

The Gemini provider now supports the `web_contents` tool, which extracts the main textual content from one or more public URLs. The implementation uses Gemini's built-in URL Context tool (`urlContext`), letting the model read and return cleaned page content without an external extraction service.

Retrieval metadata is included in the output: successful fetches are counted in the summary, and failures (paywall, error, unsafe) are surfaced as retrieval issues. A new `contentsModel` setting controls which model is used for content extraction, defaulting to `gemini-2.5-flash`.

*By @mavam in #3.*

### Perplexity provider for grounded web workflows

`pi-web-providers` now supports Perplexity as a provider for `web_search`, `web_answer`, and `web_research`. You can enable it from `/web-providers`, authenticate it with `PERPLEXITY_API_KEY`, and use Perplexity-specific defaults such as Sonar for grounded answers and `sonar-deep-research` for longer investigations.

This matters if you want a provider that combines direct search results with grounded model responses without switching to a separate extension.

*By @mavam and @codex in #2.*

### Provider-specific search options for web_search

`web_search` now accepts a provider-specific `options` object, so providers can expose richer search controls without forcing every feature into the shared top-level tool shape. For example, Perplexity-backed searches can now pass values such as `country`, `search_mode`, `search_domain_filter`, and `search_recency_filter` through the same managed tool.

This keeps `pi-web-providers` flexible as more providers are added, while preserving a stable shared interface for search queries and result limits.

*By @mavam and @codex in #2.*
