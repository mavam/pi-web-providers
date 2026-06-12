---
title: Gemini research compatibility with the steps schema
type: bugfix
authors:
  - mavam
  - claude
prs:
  - 22
created: 2026-06-12T07:04:32.33324Z
---

Gemini-powered `web_research`, `web_search`, and answer grounding work again with the current Gemini API. Google retired the legacy Interactions API schema in May 2026, which made Gemini research fail at dispatch:

```text
400 The legacy Interactions API schema is no longer supported.
```

The extension now uses `@google/genai` 2.x and reads interaction results through the new `steps` schema. No configuration changes are required; existing Gemini provider settings keep working.
