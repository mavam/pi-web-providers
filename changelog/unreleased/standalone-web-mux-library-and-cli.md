---
title: Standalone web-mux library and CLI
type: breaking
authors:
  - mavam
  - codex
prs:
  - 37
created: 2026-08-02T15:12:01.952462Z
---

Web access is now available as the standalone `web-mux` package, combining
typed library APIs, a `web` command, and a thin pi extension. Each capability
uses an explicitly configured provider, while normalized batch results,
foreground research progress, and strict XDG-based JSON configuration provide
consistent behavior across integrations.

```sh
npm install -g web-mux
web search "latest ECMAScript proposal"
```

Existing pi users must uninstall `pi-web-providers`, install `web-mux` with
`pi install npm:web-mux`, and recreate their configuration at
`$XDG_CONFIG_HOME/web-mux/config.json`. Configuration is not detected or
converted automatically.
