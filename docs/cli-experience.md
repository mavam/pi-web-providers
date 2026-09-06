# CLI reference

Install the `webfox` package to use the `web` executable. Start with the
[README](../README.md) for setup and everyday examples.

## Commands and help

```sh
web --help
web search --help
web search --provider openai --help
web providers
web providers openai
web config default search brave
web config path
web config show
web config validate
```

Ordinary help shows all command controls. Explicit provider help adds that
provider's exact supported flags. For example, OpenAI exposes `--model`,
`--search-context-size`, and `--user-location-country`. Arrays use repeatable
flags; booleans provide `--foo` and `--no-foo`.

Root and capability help end with copyable examples. Help highlights headings,
commands, flags, and arguments on a terminal. Piped help stays plain;
`NO_COLOR` or `--no-color` disables styling.

## Inputs

Search and answer accept up to ten independent queries or questions. Quote each
input; results keep input order. Research accepts exactly one brief. Contents
accepts one or more URLs.

```sh
web search "Node.js cancellation" "Bun cancellation"
web answer "What is MCP?" "What is A2A?" --provider openai
web contents https://example.com/a https://example.com/b --provider tavily
web research "Compare databases" --provider gemini --timeout 20m
```

Omit positional input to read piped or redirected stdin:

```sh
# Read from files
web search < query.txt
web answer --provider openai < question.txt
web research --provider gemini < brief.md
web contents --provider tavily < urls.txt

# Pipe input
echo "What is MCP?" | web answer --provider openai
echo "https://example.com" | web contents --provider tavily
```

Search, answer, and research read one complete input, including newlines.
Contents reads newline-separated URLs. Positional arguments take precedence over
stdin. Without arguments, a terminal reports missing input instead of waiting;
piped or redirected stdin is read through EOF. Empty or whitespace-only stdin is
an input error. An explicit `-` still reads stdin, including from a terminal, but
cannot be mixed with positional input. Help never reads stdin.

None of these commands accepts repeated `--query`, `--output`, or `--raw` flags.

## Common controls

| Flag | Meaning |
| --- | --- |
| `--provider <id>` | Override the saved provider for this request. |
| `--max-results <n>` | Limit results per query; search only. |
| `--format text\|json` | Select the result format; text is the default, even when piped. |
| `--timeout <duration>` | Set the overall deadline, including credential commands and retries. |
| `--quiet` | Suppress progress and success notices on stderr, not errors. |
| `--no-color` | Disable terminal colors. |
| `--config <path>` | Select a configuration file. |
| `--cwd <path>` | Set the working directory for custom providers and option files. |
| `--options-json <json\|@file>` | Supply complex provider options; provider-specific flags take precedence. |

Durations require a unit: `500ms`, `30s`, `20m`, or `1h`. Ctrl-C cancels waiting
for stdin, credential commands, subprocesses, and provider operations.
Cancellation stops the caller waiting even if an SDK cannot cancel its underlying
request. Cancelling a remote research request does not necessarily cancel its
billable job.

Complex objects and options whose names collide with common flags remain
available through `--options-json`. Retry tuning belongs in configuration, not
CLI flags. See the [configuration reference](./reference.md#configuration) for
option precedence, deadlines, and retries.

## Provider inspection

`web providers` shows providers as rows and capabilities as columns:

- `☆` marks an unconfigured provider; `★` marks one with at least one configured
  capability. Providers with separate credentials may still need configuration
  for other capabilities.
- `✔︎` means supported, `✘︎` means unsupported, and `◉` means selected as the
  default for that capability. Selection is independent of configuration, so an
  unconfigured provider can still show `◉`.

The `custom` row appears only when a command is configured or a capability selects
it as its default. Its support checkmarks reflect configured commands. Use
`web providers custom` for inspection and setup guidance even before configuring
commands.

Configured means local settings or credential sources exist—not that credentials,
executables, or connectivity have been verified. Inspection and help never run
credential commands or initialize provider SDKs.

## Output and progress

Text remains the default when piped. Stdout contains results, not success banners
or execution diagnostics. Status messages go to stderr:

- `▶︎` for progress.
- `✔︎` for success.
- `✘︎` for errors.
- `■` for cancellation.

Errors include a stable error code and, for per-input failures, the affected input.
Use `--quiet` to suppress progress and success notices. Status colors follow
terminal detection, `NO_COLOR`, and `--no-color`; JSON never acquires terminal
styling. The CLI and library do not truncate results.

For remote research jobs, progress confirms submission and acceptance, then
reports provider status changes or elapsed time roughly every 30 seconds while
polling. Transient status-check failures show the retry delay and count; they do
not start a new research job. Opaque job IDs and duplicate completion messages
are omitted. One success line gives the total elapsed time; the report itself
goes to stdout. These updates describe provider status, not estimated completion
percentages or inferred research stages.

In text mode, failed-input diagnostics go only to stderr. JSON retains structured
errors in the result document as well.

## JSON results

Pipe JSON output into tools such as `jq`. For example, extract URLs from
successful search results:

```sh
web search "TypeBox" --format json | jq -r '.results[] | select(.ok) | .value.results[].url'
```

JSON is one versioned document with results in input order. Status is `ok` when
all inputs succeed and `partial` otherwise:

```json
{
  "schemaVersion": 1,
  "capability": "search",
  "provider": "brave",
  "status": "partial",
  "results": [
    { "input": "first query", "ok": true, "value": { "results": [] } },
    {
      "input": "second query",
      "ok": false,
      "error": { "code": "TIMEOUT", "message": "Operation exceeded its deadline." }
    }
  ]
}
```

A result has either `ok: true` and `value`, or `ok: false` and a structured
`error`. Partial batches retain completed successes, including when another input
times out or is cancelled. A contents result's `input` is the requested URL;
`value.url` is the final URL when the provider reports it.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success or help. |
| `1` | Provider failure, partial result, or timeout. |
| `2` | Invalid input or configuration. |
| `130` | Cancellation. |
