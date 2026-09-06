---
title: Accurate Ollama hosted-service discovery
type: bugfix
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T15:04:59.711628Z
---

Ollama is now identified as a hosted provider rather than a local service in library discovery. Webfox uses Ollama’s authenticated web search and fetch APIs, not its local model server. The README now explains API-key setup and includes `webfox search "your query" --provider ollama` and contents examples.
