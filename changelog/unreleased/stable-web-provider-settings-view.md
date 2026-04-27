---
title: Stable web provider settings view
type: bugfix
authors:
  - mavam
  - codex
pr: 17
created: 2026-04-27T11:40:54.526776Z
---

The `/web-providers` settings screen now stays open when a configured provider secret command fails and shows effective defaults for unset execution settings.

Previously, a missing command-backed secret such as a keychain lookup could crash the settings screen, and configurations that only set search preferences could display `undefined` for timeout and retry settings. The screen now reports the affected provider as misconfigured and shows the default timeout and retry values instead.

For example, this configuration now displays the default request timeout, retry count, retry delay, and research timeout in `/web-providers`:

```json
{
  "settings": {
    "search": {
      "provider": "exa"
    }
  }
}
```
