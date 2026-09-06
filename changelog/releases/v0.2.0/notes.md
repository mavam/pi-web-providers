Web tools now support Claude as a provider for search and answers, and default to Codex when no search provider is configured. Each tool carries self-describing prompts, unavailable tools stay hidden, and Gemini-backed tools return cleaner, more reliable results.

## 🚀 Features

### Claude provider for web search and answers

`pi-web-providers` now supports Claude as a provider for `web_search` and `web_answer` when Claude Code is installed and authenticated locally. This lets you route grounded web lookups through Claude Code's built-in `WebSearch` and `WebFetch` tools and configure Claude-specific defaults such as the model, effort level, maximum turns, and executable path from `/web-providers`.

*By @mavam and @codex.*

## 🔧 Changes

### Default search to Codex and hide unavailable tools

`web_search` now falls back to Codex when no search provider is explicitly configured and the local Codex CLI is installed and authenticated, and the extension keeps `web_search`, `web_contents`, `web_answer`, and `web_research` inactive whenever no provider can satisfy those capabilities so the LLM does not call them speculatively.

*By @mavam.*

### Self-describing tool prompts for web tools

Each web tool now carries its own usage guidance in its description rather than relying on capability-aware system prompts injected from the outside. For example, `web_contents` describes itself as "Use after web_search to read full page content" and `web_answer` as "Best for quick factual questions." This removes the cross-tool awareness machinery and lets the LLM pick the right tool from descriptions alone.

*By @mavam and @claude.*

### Truncate large provider tool output

`web_contents`, `web_answer`, and `web_research` now use the same truncation and temp-file spillover path as `web_search`, which keeps large provider responses from flooding the transcript while still preserving the full output.

*By @mavam.*

## 🐞 Bug fixes

### Gemini web tool reliability improvements

Gemini-backed web tools now behave more consistently. `web_search` again returns the actual Google Search results, resolves Google grounding redirect links to their underlying pages when possible, and avoids showing misleading snippet text derived from Gemini's HTML search widgets.

`web_answer` now shows cleaner source lists by suppressing opaque Google grounding redirect URLs, and long-running `web_research` runs emit periodic progress updates so it is easier to tell the difference between a slow provider and a stalled one. Truncated tool call previews now also include an ellipsis so clipped prompts are clearly marked as incomplete.

*By @mavam and @codex.*
