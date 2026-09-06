---
title: Gemini 3.8 Flash answers by default
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T14:32:31.962862Z
---

Gemini grounded answers now use `gemini-3.8-flash` by default instead of `gemini-2.5-flash`. Run `webfox answer "your question" --provider gemini` to use the new default. Explicit model overrides remain unchanged, and Gemini deep research continues to use its dedicated research agent.
