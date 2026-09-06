---
title: Human-friendly YAML configuration
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T09:36:15.871708Z
---

Webfox now reads shared configuration from `~/.config/webfox/config.yaml`, respecting `XDG_CONFIG_HOME` (or `APPDATA` on Windows). YAML supports comments and avoids JSON punctuation for hand-edited settings:

```yaml
defaults:
  search:
    provider: exa
    maxResults: 5
```

`webfox config default search exa` preserves existing comments and unrelated settings. `webfox config show` prints redacted YAML. The CLI, library, and pi extension use the same configuration and schema validation.

Rename an existing `config.json` to `config.yaml`, or select it explicitly with `WEBFOX_CONFIG` or `--config`. Its JSON contents remain readable as YAML. Duplicate keys, multiple documents, aliases, explicit tags, non-string keys, and non-finite numbers are rejected. JSON result output and `--options-json` are unchanged.
