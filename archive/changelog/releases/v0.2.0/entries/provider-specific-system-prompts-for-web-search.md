---
title: Self-describing tool prompts for web tools
type: change
authors:
  - mavam
  - claude
created: 2026-03-09T11:42:07.171885Z
---

Each web tool now carries its own usage guidance in its description rather than
relying on capability-aware system prompts injected from the outside. For
example, `web_contents` describes itself as "Use after web_search to read full
page content" and `web_answer` as "Best for quick factual questions." This
removes the cross-tool awareness machinery and lets the LLM pick the right tool
from descriptions alone.
