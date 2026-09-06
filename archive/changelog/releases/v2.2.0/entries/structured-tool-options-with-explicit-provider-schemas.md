---
title: Structured tool options with explicit provider schemas
type: feature
authors:
  - mavam
  - codex
created: 2026-04-03T17:10:01.570396Z
---

Each managed tool (`web_search`, `web_contents`, `web_answer`, `web_research`) now advertises the exact provider-specific options available for the configured provider directly in the tool schema. This means the agent can discover supported knobs—such as Tavily's `searchDepth` and `country`, Exa's `category` and `userLocation`, or Gemini's `model` and `generation_config`—without relying on documentation or guesswork.

In practice, the agent is more likely to take advantage of provider features like domain filtering, search depth, or location hints when they would improve the quality of results for your query.
