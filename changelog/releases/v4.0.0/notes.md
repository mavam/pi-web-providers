Pi Web Providers becomes Webfox, a standalone web-access toolkit with a TypeScript library, the web CLI, and a Pi extension. This release unifies provider configuration and execution, updates provider controls, and adds one-dispatch live testing.

## 💥 Breaking changes

### A new name and standalone architecture: Webfox

**pi-web-providers is now Webfox** with **v4.0.0**, continuing the existing release history.

It is a standalone web-access toolkit with a TypeScript library, the `web` CLI, and a Pi extension. All three share provider selection, configuration, credentials, and execution. The library exposes `createWebfox()`; using the CLI or library does not require Pi.

Install the `webfox` package to get the `web` command.

```sh
web search "Node.js release notes" --provider brave
```

The README now focuses on setup and everyday use, with provider setup and caveats, advanced configuration, scripting contracts, and library details in linked guides. The Pi setup guide covers installation, provider selection, and API keys without requiring the CLI. Webfox also has a new fox logo, with light and dark versions that switch automatically in the README.

Replace the old Pi package:

```sh
pi remove npm:pi-web-providers
pi install npm:webfox
```

The four Pi tool names remain `web_search`, `web_contents`, `web_answer`, and `web_research`. Tools are registered only for capabilities with a saved default; credentials alone never select a provider. The model sees only the selected provider's options.

**Recreate your configuration** at `~/.config/webfox/config.yaml` (respecting `XDG_CONFIG_HOME`, or `APPDATA` on Windows), or select a file with `WEBFOX_CONFIG`. The old `~/.pi/agent/web-providers.json` file and `/web-providers` settings UI are no longer used. The old `tools`, `settings`, and credential-reference syntax are not compatible with the new schema; renaming the old file is not a migration.

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

Put provider options under `providers.<id>.options.<capability>` and timeouts, retries, and concurrency under `execution`. Credentials use explicit `env`, `value`, or `command` sources; command sources are argv arrays, not shell strings. Standard environment credentials need no provider section.

Use `web config default search exa` to save a selection and `web config validate` to check the file without resolving credentials or making requests. Updates preserve YAML comments; configuration display redacts secrets. Restart Pi after changing defaults to refresh its tools.

Research now runs in the foreground with progress and cancellation. Automatic search-result contents prefetch is removed; call `web_contents` explicitly. Custom wrappers must follow the new versioned JSON stdin/stdout contract.

*By @mavam in #37.*

### Gemini grounded answers and research only

Gemini no longer offers standalone search. Use its Google Search-grounded answer capability instead:

```sh
web answer "your question" --provider gemini
```

If Gemini was your search default, select a search-capable provider and remove `providers.gemini.options.search` from your configuration. Grounded answers now use `gemini-3.8-flash` by default; explicit model overrides remain supported. Deep research uses the dedicated `deep-research-preview-04-2026` agent.

*By @mavam in #37.*

### Removal of Claude and Codex providers

Claude and Codex are no longer Webfox providers. Webfox supplies web capabilities; the calling agent owns orchestration rather than launching another coding agent for web access.

Remove `providers.claude` and `providers.codex`, replace defaults that select them, and update explicit provider selections in scripts and library calls. For example, with Exa credentials configured:

```sh
web search "your query" --provider exa
web config default search exa
web config default answer exa
```

Old provider selections and configuration sections are rejected, not silently routed elsewhere. Run `web providers` to see supported alternatives.

*By @mavam in #37.*

### Updated provider options and working Exa research

Provider options now more closely match the underlying services. Some old settings are no longer accepted:

- **Exa:** remove `livecrawl`, `startCrawlDate`, and `endCrawlDate`. Set `options.contents.maxAgeHours` for freshness, using `0` to fetch fresh content.
- **Firecrawl:** search `location` is a string; scrape location uses `country` and `languages`, not `city` or `region`. Remove obsolete search language and country settings.
- **Tavily:** use `markdown` or `text` for raw content, rather than `true`.
- **OpenAI:** remove `userLocation` from research options.
- **Valyu:** research tool settings accept a boolean or supported `enabled`/`max_calls` controls, not arbitrary objects.

For example:

```sh
web search "current release notes" --provider exa --contents-max-age-hours 0
web search --provider firecrawl --help
```

Exa research works again and returns a synthesized report with source links. Gemini and OpenAI expose more thinking and generation controls; OpenAI also supports cache-only web access. Parallel and Perplexity expose more retrieval controls, while Cloudflare and Linkup offer more page-loading options. Requested Tavily answers/images and Linkup raw content are retained in results. Supported reasoning settings still depend on the selected model.

*By @mavam in #37.*

## 🚀 Features

### Standalone CLI with explicit routing and predictable output

Use `web` to search, extract pages, answer questions, and run research from scripts or a terminal. Provider-aware help exposes only relevant options, and provider discovery separates capability support, configuration, and selected defaults without running credential commands or claiming connectivity is verified.

```sh
web providers
web search --provider exa --help
web search "first query" "second query" --provider exa --format json
web contents --provider tavily < urls.txt
echo "What is MCP?" | web answer --provider openai
```

Results go to stdout; progress, completion notices, and errors go to stderr. Text is the default even when piped; `--format json` returns a versioned result document. When positional input is omitted, pipes and redirected files are read automatically: one complete query, question, or research brief, or newline-separated URLs for contents. Positional arguments take precedence; explicit `-` remains supported. A bare command in a terminal reports missing input instead of waiting, and empty stdin is rejected.

Batches preserve input order and completed results on partial failure. Error codes distinguish invalid input, provider failures, timeouts, and cancellation; deadlines include credential resolution and retries. Research polling reports acceptance, elapsed time, and retry delays without submitting duplicate jobs. `--quiet` hides progress and success notices but never errors. Colors respect terminal detection, `NO_COLOR`, and `--no-color`.

*By @mavam in #37.*

## 🔧 Changes

### Compact Pi results with per-input progress

All four Pi web tools show one status row per input, in request order. Rows update in place and preserve completed work when another input fails or the request is cancelled. Successful result bodies stay collapsed; errors remain visible. Expansion hints respect configured shortcuts.

Headers show explicit parameter choices rather than inherited defaults:

```text
web search limit=2 type=neural contents.text=true
✔︎ first query
▶︎ second query
```

Expanded search titles and snippets remain literal text with clickable source links. Extracted contents, answers, and research reports render as Markdown. Credential-bearing options are redacted and terminal control sequences are removed from displayed inputs. Model-facing result content is unchanged.

Invalid tool parameters report their exact paths and suggest an unambiguous valid location when possible, rather than dumping the full argument payload or silently moving options. Library progress callbacks expose indexed input lifecycle events for every capability.

*By @mavam in #37.*

### One-dispatch live provider tests

You can now test all configured web providers with one CI dispatch:

```sh
gh workflow run ci.yaml
```

The run covers supported non-research capabilities, reports missing credentials as skips, and fails if no live tests run. You can still select an individual provider or capability. Research remains opt-in.

*By @mavam.*
