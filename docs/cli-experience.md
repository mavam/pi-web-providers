# CLI contract

These target screens define the common command surface. Provider options appear
only when you explicitly request provider help; advanced controls stay out of
ordinary help.

## Root help

```text
Usage: web <command>

Search, extract pages, answer questions, and research with an explicit provider.

Commands:
  search <query...>       Search the public web
  contents <url...>       Extract readable pages
  answer <question...>   Answer questions using web sources
  research <brief>       Run research in the foreground
  providers [id]         Inspect supported and configured capabilities
  config default <capability> <provider>  Save a provider choice
  config path|show|validate              Inspect advanced configuration

Run web <command> --help for common controls.
Run web <command> --provider <id> --help for provider options.
Run web <command> --help-advanced for configuration and complex options.
```

## Common capability help

```text
Usage: web search <query...> [options]

Search up to ten independent queries. Quote each query; results keep input order.
Use '-' alone to read one complete query from stdin.

Options:
  --provider <id>       Override the saved search provider
  --max-results <n>     Maximum results per query
  --format <text|json>  Result format (default: text, even when piped)
  --timeout <duration>  Overall deadline, including retries (for example 30s, 20m)
  --quiet              Suppress progress on stderr
  -h, --help           Show help

Examples:
  web search "Node.js release notes" --provider brave
  web search "Node.js cancellation" "Bun cancellation"
  web search - --format json < query.txt
```

Contents takes newline-separated URLs with `-`. Answer takes quoted questions
or one complete stdin question. Research takes exactly one brief or complete
stdin input. None of these commands accepts repeated `--query`, `--output`, or
`--raw`. Only search has `--max-results`.

`web search --provider openai --help` adds schema-derived OpenAI options such as
`--model`, `--instructions`, and `--search-context-size`. Advanced help adds
`--config`, `--cwd`, and `--options-json`; retry tuning lives in JSON only.

## First and second requests

```sh
export BRAVE_SEARCH_API_KEY=…
web search "Node.js release notes" --provider brave
# stdout: numbered titles, URLs, and snippets; no execution banner
web config default search brave
# stderr: Saved search default: brave
web search "TypeBox validation"
```

With no selection, fail without inspecting credentials:

```text
No search provider selected.

Run with --provider brave, or save a default:
  web config default search brave

See available providers: web providers
```

## Discovery and output

`web providers` has separate Supported, Configured, and Selected default columns.
Configured means local settings or credential sources exist, not that credentials,
executables, or connectivity were verified. Inspection never runs credential
commands or initializes SDKs.

Text is the default regardless of redirection. JSON is one versioned document,
with ordered discriminated success/error results. Progress and command errors go
to stderr. Partial documents retain successful results and per-input errors.
Exit codes: 0 success/help, 1 provider failure/partial/timeout, 2 invalid input or
configuration, 130 cancellation. Ctrl-C also interrupts stdin and credential
commands. The operation deadline includes credential resolution and retry waits.
