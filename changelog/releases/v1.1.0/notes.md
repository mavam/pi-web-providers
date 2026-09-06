A new custom provider routes any managed tool through local wrapper commands, making it easy to integrate additional agent SDKs without adding a first-class provider. In-flight progress messages now also use consistent naming and capitalization across all providers.

## 🚀 Features

### Custom provider for local agent wrappers

`pi-web-providers` now supports a `custom` provider that runs caller-configured local commands for `web_search`, `web_contents`, `web_answer`, and `web_research`.

Each capability can point at its own wrapper command under `providers["custom"].options`. Wrappers read one JSON request from `stdin`, write one JSON response to `stdout`, and can stream progress updates on `stderr`.

This makes it easy to integrate additional local agent SDKs or CLIs without adding a dedicated first-class provider. For example, you can route `web_search` through a Codex wrapper, `web_contents` through a Gemini wrapper, and `web_answer` through a Claude wrapper while keeping the shared managed tool surface unchanged.

*By @mavam.*

## 🐞 Bug fixes

### Consistent provider names and progress messages

In-flight progress messages now use consistent capitalization and a uniform structure across all providers and tools.

Previously, the provider name was shown in lowercase in collapsed result summaries (e.g. `3 results via exa`) while the same provider appeared capitalized in in-flight messages (e.g. `Searching Exa for: …`). All collapsed summaries now use the same capitalized provider label.

The in-flight messages themselves have also been unified into a common pattern:

- Search: `Searching <Provider> for: <query>`
- Contents: `Fetching contents from <Provider> for N URL(s)`
- Answer: `Getting <Provider> answer for: <query>`
- Research: `Starting <Provider> research`
- Research heartbeat: `Researching via <Provider> (N elapsed)`

Previously, research messages used inconsistent phrasing such as `Creating Exa research task`, `Creating Valyu deep research task`, and `web_research still running via exa (30s elapsed)`.

*By @mavam and @claude in #7.*
