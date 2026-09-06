---
title: Removal of Claude and Codex providers
type: breaking
authors:
  - mavam
prs:
  - 37
created: 2026-09-06 14:47:15.919508+00:00
---

Claude and Codex are no longer Webfox providers. Webfox supplies web capabilities;
the calling agent owns orchestration rather than launching another coding agent
for web access.

Remove `providers.claude` and `providers.codex`, replace defaults that select
them, and update explicit provider selections in scripts and library calls.
For example, with Exa credentials configured:

```sh
webfox search "your query" --provider exa
webfox config default search exa
webfox config default answer exa
```

Old provider selections and configuration sections are rejected, not silently
routed elsewhere. Run `webfox providers` to see supported alternatives.
