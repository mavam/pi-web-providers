# CLI contract

These target screens define the common command surface. Provider options appear
only when you explicitly request provider help. All command controls appear in
ordinary help.

## Root help

```text
Usage: webfox <command>

Search, extract pages, answer questions, and research with an explicit provider.

Commands:
  search <query...>       Search the public web
  contents <url...>       Extract readable pages
  answer <question...>   Answer questions using web sources
  research <brief>       Run research in the foreground
  providers [id]         Inspect supported and configured capabilities
  config default <capability> <provider>  Save a provider choice
  config path|show|validate              Inspect advanced configuration

Examples:
  webfox search "Node.js release notes" --provider brave
  webfox config default search brave
  webfox search --help
  webfox search --provider brave --help
```

## Common capability help

```text
Usage: webfox search <query...> [options]

Search up to ten independent queries. Quote each query; results keep input order.
Use '-' alone to read one complete query from stdin.

Options:
  --provider <id>       Override the saved search provider
  --max-results <n>     Maximum results per query
  --format <text|json>  Result format (default: text, even when piped)
  --timeout <duration>  Overall deadline, including retries (for example 30s, 20m)
  --quiet              Suppress progress on stderr
  --no-color           Disable terminal colors
  --config <path>      Read this YAML configuration file
  --cwd <path>         Working directory for custom providers and option files
  --options-json <json|@file>  Complex provider options; typed flags take precedence
  -h, --help           Show help

Examples:
  webfox search "Node.js release notes" --provider brave
  webfox search "Node.js cancellation" "Bun cancellation"
  webfox search - --format json < query.txt
```

Contents takes newline-separated URLs with `-`. Answer takes quoted questions
or one complete stdin question. Research takes exactly one brief or complete
stdin input. None of these commands accepts repeated `--query`, `--output`, or
`--raw`. Only search has `--max-results`.

`webfox search --provider openai --help` adds schema-derived OpenAI options such as
`--model`, `--instructions`, and `--search-context-size`. Ordinary help includes
`--config`, `--cwd`, `--options-json`, and `--no-color`; retry tuning lives in YAML configuration only.

## First and second requests

```sh
export BRAVE_SEARCH_API_KEY=…
webfox search "Node.js release notes" --provider brave
# stdout: numbered titles, URLs, and snippets; no execution banner
webfox config default search brave
# stderr: Saved search default: brave
webfox search "TypeBox validation"
```

With no selection, fail without inspecting credentials:

```text
No search provider selected.

Run with --provider brave, or save a default:
  webfox config default search brave

See available providers: webfox providers
```

## Discovery and output

`webfox providers` has separate Supported, Configured, and Selected default columns.
Configured means local settings or credential sources exist, not that credentials,
executables, or connectivity were verified. Inspection never runs credential
commands or initializes SDKs.

Text is the default regardless of redirection. JSON is one versioned document,
with ordered discriminated success/error results. Progress and command errors go
to stderr. Partial documents retain successful results and per-input errors.
Exit codes: 0 success/help, 1 provider failure/partial/timeout, 2 invalid input or
configuration, 130 cancellation. Ctrl-C also interrupts stdin and credential
commands. The operation deadline includes credential resolution and retry waits.
