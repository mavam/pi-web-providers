---
title: Removal of Claude and Codex providers
type: breaking
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T14:47:15.919508Z
---

Claude and Codex are no longer available as Webfox providers. Webfox supplies web capabilities; the calling agent owns orchestration rather than launching another coding agent for web access.

Remove `providers.claude` and `providers.codex` from your configuration and replace any defaults that select them. For example, after configuring Exa credentials:

```yaml
defaults:
  search:
    provider: exa
  answer:
    provider: exa
```

Replace `--provider claude` and `--provider codex` in scripts and library calls with a supported provider. Old provider selections and configuration sections are rejected rather than silently routed elsewhere. Run `webfox providers` to see the remaining providers.
