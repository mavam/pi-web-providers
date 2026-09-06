---
title: 'A new name and standalone architecture: Webfox'
type: breaking
authors:
  - mavam
prs:
  - 37
created: 2026-09-06 15:08:59.411277+00:00
---

**pi-web-providers is now Webfox**, starting a new version series at **v0.1.0**.
Webfox releases use `webfox-v…` Git tags, beginning with `webfox-v0.1.0`.
The old pi-web-providers tags and published release history are preserved.

It is a standalone web-access toolkit with a TypeScript library, the `web` CLI,
and a Pi extension. All three share provider
selection, configuration, credentials, and execution. The library exposes
`createWebfox()`; using the CLI or library does not require Pi.

Install the `webfox` package to get the `web` command. If you used a preview with
the `webfox` executable, replace it with `web` in scripts and remove any
`alias web=webfox`. There is no compatibility executable. The package name,
library API, `WEBFOX_CONFIG`, and Webfox configuration directory are unchanged
by the command rename. An existing command named `web` can conflict.

```sh
web search "Node.js release notes" --provider brave
```

The README now focuses on setup and everyday use, with provider setup and caveats,
advanced configuration, scripting contracts, and library details in linked guides.
Webfox also has a new fox logo, with light and dark versions that switch
automatically in the README.

Replace the old Pi package:

```sh
pi remove npm:pi-web-providers
pi install npm:webfox
```

The four Pi tool names remain `web_search`, `web_contents`, `web_answer`, and
`web_research`. Tools are registered only for capabilities with a saved default;
credentials alone never select a provider. The model sees only the selected
provider's options.

**Recreate your configuration** at `~/.config/webfox/config.yaml` (respecting
`XDG_CONFIG_HOME`, or `APPDATA` on Windows), or select a file with `WEBFOX_CONFIG`.
The old `~/.pi/agent/web-providers.json` file and `/web-providers` settings UI are
no longer used. The old `tools`, `settings`, and credential-reference syntax are
not compatible with the new schema; renaming the old file is not a migration.

```yaml
defaults:
  search:
    provider: exa
    maxResults: 5
providers:
  exa:
    credentials:
      api:
        env: EXA_API_KEY
    options:
      search:
        type: auto
```

Put provider options under `providers.<id>.options.<capability>` and timeouts,
retries, and concurrency under `execution`. Credentials use explicit `env`,
`value`, or `command` sources; command sources are argv arrays, not shell strings.
Standard environment credentials need no provider section.

Use `web config default search exa` to save a selection and `web config
validate` to check the file without resolving credentials or making requests.
Updates preserve YAML comments; configuration display redacts secrets. Restart
Pi after changing defaults to refresh its tools.

Research now runs in the foreground with progress and cancellation. Automatic
search-result contents prefetch is removed; call `web_contents` explicitly.
Custom wrappers must follow the new versioned JSON stdin/stdout contract.
