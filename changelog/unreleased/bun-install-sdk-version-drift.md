---
title: Provider SDK dependency updates
type: bugfix
authors:
  - mavam
  - codex
prs:
  - 34
created: 2026-06-21T11:17:44.05824Z
---

Bun-based installs now use refreshed provider SDK dependencies for Claude, Gemini, Firecrawl, Codex, Exa, OpenAI, and Valyu.

| SDK | Previous | Current |
| --- | --- | --- |
| `@anthropic-ai/claude-agent-sdk` | `0.3.177` | `0.3.185` |
| `@google/genai` | `2.8.0` | `2.9.0` |
| `@mendable/firecrawl-js` | `4.25.4` | `4.28.2` |
| `@openai/codex-sdk` | `0.139.0` | `0.141.0` |
| `exa-js` | `2.13.0` | `2.14.0` |
| `openai` | `6.42.0` | `6.44.0` |
| `valyu-js` | `2.8.0` | `2.9.0` |

The exposed provider options now include current OpenAI web search controls (`searchContextSize`, `allowedDomains`, and `userLocation`), Exa freshness and content controls, Firecrawl domain filters and scrape options, and Valyu source, answer, and research controls.

No longer supported options are no longer advertised, including Exa `deep-max` search mode and Valyu answer/research `responseLength`.
