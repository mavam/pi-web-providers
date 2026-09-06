# webfox

Configurable web search, content extraction, grounded answers, and research through interchangeable providers, with a TypeScript library, `webfox` CLI, and pi extension.

## 🚀 Installation

Install `webfox` with your preferred package manager. A global installation
provides the `webfox` executable; an application dependency provides the TypeScript
library. Requires Node.js 22 or newer.

For pi:

```sh
pi install npm:webfox
```

## ✨ Usage

The executable is `webfox`. If you prefer `web` interactively, add an optional
shell alias (Bash or Zsh):

```sh
alias web=webfox
```

The package does not install a `web` executable, so it won't conflict with another
command of that name. Use `webfox` in scripts.

Make your first request without a configuration file:

```sh
export BRAVE_SEARCH_API_KEY=…
webfox search "Node.js release notes" --provider brave
```

Save your choice for subsequent requests:

```sh
webfox config default search brave
webfox search "TypeBox validation"
```

Provider selection is always explicit: use `--provider` or a saved capability
default. Credentials never determine which provider runs.

### Everyday commands

```sh
webfox search "Node.js cancellation" "Bun cancellation"
webfox contents https://example.com/a https://example.com/b --provider tavily
webfox answer "What is MCP?" "What is A2A?" --provider openai
webfox research "Compare databases" --provider gemini --timeout 20m
```

Quote each independent query or question. Search and answer accept up to ten
inputs. Research accepts exactly one brief. Use `-` alone for stdin:

```sh
webfox search - < query.txt
webfox answer - < question.txt
webfox research - --provider gemini < brief.md
webfox contents - --provider tavily < urls.txt
```

Search, answer, and research read one complete text input, including newlines.
Contents reads newline-separated URLs. Stdin is never read implicitly.

Common controls:

| Flag | Meaning |
| --- | --- |
| `--provider <id>` | Override the saved provider for this request. |
| `--max-results <n>` | Limit results per query; search only. |
| `--format text\|json` | Select the result format; text is the default. |
| `--timeout <duration>` | Set the overall deadline, including credential commands and retries. |
| `--quiet` | Suppress progress and success notices on stderr, not errors. |

Durations require a unit: `500ms`, `30s`, `20m`, or `1h`. Ctrl-C cancels waiting
for stdin, credential commands, subprocesses, and provider operations. Cancellation
stops the caller waiting even if an SDK cannot cancel its underlying request.
Cancelling a remote research request does not necessarily cancel its billable job.

### Help

```sh
webfox search --help
webfox search --provider openai --help
```

Root and capability help end with an Examples section containing only copyable
invocations, including provider-specific help commands.
Help highlights headings, commands, flags, and arguments when stdout is a
terminal, including examples. Piped help stays plain; `NO_COLOR` or `--no-color` disables styling.

`--help` shows all command controls. Explicit provider help adds that
provider’s exact schema-derived flags. For example, OpenAI exposes `--model`,
`--search-context-size`, and `--user-location-country`. Arrays use repeatable
flags; booleans provide `--foo` and `--no-foo`. Available options include
provider-supported reasoning, source filtering, and page-loading controls.

Help includes `--config <path>`, `--cwd <path>`, and
`--options-json <json|@file>`. Complex objects and colliding flag names remain
available through JSON. Retry tuning belongs in configuration, not CLI flags.

Options have one precedence order:

1. Provider defaults.
2. `providers.<id>.options.<capability>`.
3. Request options, or CLI `--options-json`.
4. Schema-derived CLI flags.

Switching providers never carries the previous provider’s options into a request.
Defaults and overrides can be incomplete; required fields are checked after
merging. For example, Firecrawl answers need a `url` supplied in defaults or
with `--url`.

### Predictable output

```sh
webfox search "TypeBox" --format text
webfox search "TypeBox" --format json
```

Text remains the default when piped. Stdout contains results, not success banners
or execution diagnostics. Status messages go to stderr with the same prefixes
as Pi tools: `▶︎` for progress, `✔︎` for success, `✘︎` for errors, and `■` for
cancellation. Errors include a stable error code and, for per-input failures,
the affected input. Use `--quiet` to suppress progress and success notices.
Status colors follow terminal detection, `NO_COLOR`, and the `--no-color` flag;
JSON never acquires terminal styling.

For background research jobs, progress confirms submission and acceptance,
then reports provider status changes or elapsed time roughly every 30 seconds
while polling. Transient status-check failures show the retry delay and count;
they do not start a new research job. Opaque job IDs and duplicate completion
messages are omitted. One success line gives the total elapsed time; the report
itself goes to stdout. These updates describe provider status, not estimated
completion percentages or inferred research stages.

In text mode, failed-input diagnostics go only to stderr. JSON retains structured
errors in the result document as well. Results are not truncated by the CLI or
library.

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
times out or is cancelled. A contents result’s `input` is the requested URL;
`value.url` is the final URL when the provider reports it.

Exit codes: **0** success/help, **1** provider failure, partial result, or timeout,
**2** invalid input/configuration, **130** cancellation.

### Inspect providers

```sh
webfox providers
webfox providers openai
```

The table shows left-aligned providers as rows and centered capability cells:
`✔︎` means supported and `✘︎` means unsupported. A star beside the support glyph means
configured (`☆`) or configured and selected as the default (`★`). Unconfigured
capabilities have no star, even if selected as the default.

Configured means that local settings or credential sources exist—not that
credentials, executables, or connectivity have been verified. Inspection and help
never run credential commands or initialize provider SDKs.

## ⚙️ Configuration

YAML configures advanced setups. You don’t need to learn its schema to select and
save a provider. Inspect or validate the file with:

```sh
webfox config path
webfox config show
webfox config validate
```

`show` redacts literal credential values and credential commands. `validate`
checks configuration and provider option schemas without resolving credentials
or making requests.

Configuration paths resolve in this order:

1. `--config` or the library’s `configPath`.
2. `WEBFOX_CONFIG`.
3. `%APPDATA%\webfox\config.yaml` on Windows, when `APPDATA` is set.
4. `$XDG_CONFIG_HOME/webfox/config.yaml`.
5. `~/.config/webfox/config.yaml`.

A missing default file means no saved settings. An explicitly selected missing
file is an error; `config default` can create it. The setter preserves unrelated
settings and comments and atomically replaces the file with owner-only permissions.
`config show` emits redacted YAML.

Use YAML 1.2 with string mapping keys and finite numbers. Duplicate keys,
multiple documents, aliases, and explicit tags are rejected. Empty files are
valid and mean no saved settings. JSON Schema validation and editor completion
remain available for YAML.

Existing `config.json` files are no longer discovered automatically. Rename yours
to `config.yaml`, or select it with `WEBFOX_CONFIG` or `--config`. JSON syntax is
also valid YAML, so existing contents remain readable. JSON result output and
`--options-json` are unchanged.

See [example-config.yaml](./example-config.yaml). A smaller example:

```yaml
$schema: https://unpkg.com/webfox@4.0.0/dist/config.schema.json
defaults:
  search:
    provider: brave
    maxResults: 5
  answer:
    provider: openai
execution:
  timeoutMs: 30000
  researchTimeoutMs: 1800000
  retries: 1
  retryDelayMs: 2000
  concurrency: 4
providers:
  brave:
    options:
      search:
        mode: news
  openai:
    credentials:
      api:
        command: [op, read, "op://vault/openai/api-key"]
    options:
      answer:
        model: gpt-4.1
```

Capability defaults contain only provider selection and portable settings
(currently search’s `maxResults`). Provider-specific options belong exclusively
under that provider. Unknown configuration fields are rejected. The published
schema is available as `webfox/config.schema.json`.

Defaults are 30 seconds for ordinary operations, 30 minutes for research, four
concurrent inputs, and no retries. Retry backoff starts at two seconds and grows
up to 30 seconds within the same overall deadline. Only structurally classified
transient failures on operations the adapter marks retry-safe are retried.
Research job creation is never blindly retried; polling applies the configured
retry count and backoff without creating another job. URL operations are scheduled separately so
completed pages survive another page’s failure or timeout.

### Credentials

Each credential source has exactly one form:

```yaml
{ env: OPENAI_API_KEY }
{ command: [program, argument] }
{ value: "literal-secret" }
```

Standard environment references work without a provider section. `webfox providers
<id>` lists credential names. Brave uses `BRAVE_SEARCH_API_KEY` for search and
`BRAVE_ANSWERS_API_KEY` for answers/research. Cloudflare additionally requires
`CLOUDFLARE_ACCOUNT_ID`. Claude and Codex can use their local SDK authentication.
Claude also accepts `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. A self-hosted
Firecrawl `baseUrl` can work without an API key.

Credential commands run asynchronously as argv arrays, never through a shell.
They inherit the client’s environment and working directory and obey its request
signal. Successful outputs are cached per client, not globally. Overriding one
credential preserves the provider’s other standard references.

A single runtime boundary redacts resolved credentials from results, progress,
and public errors before they reach callers. Secret-bearing metadata fields are
also redacted. This policy is not a sandbox for untrusted adapters or commands.

## 📚 Library

For all capabilities, `onProgress` includes per-input lifecycle events with
`inputIndex`, `input`, and `state` (`queued`, `running`, `done`, `failed`, or
`cancelled`). Indexes refer to the original input order, including duplicate
inputs. Provider progress messages may omit these fields.

```ts
import { createWebfox } from "webfox";

const web = createWebfox();
const document = await web.search({
  provider: "openai",
  queries: ["TypeBox validation", "Node.js AbortSignal"],
  maxResults: 5,
  options: { searchContextSize: "high" },
  timeoutMs: 30_000,
  onProgress: ({ message }) => console.error(message),
});

for (const result of document.results) {
  if (result.ok) console.log(result.value.results);
  else console.error(result.error.code, result.error.message);
}
```

`createWebfox({ config?, configPath?, cwd?, env? })` snapshots configuration and
environment for one client. It exposes:

- `search({ queries, maxResults?, ...controls })`.
- `contents({ urls, ...controls })`.
- `answer({ queries, ...controls })`.
- `research({ input, ...controls })`.
- `inspectCapability(capability, provider?)`: selection, configuration status,
  provider option-override schema, and effective non-secret defaults.
- `listProviders()` and `getProvider(id)`: supported/configured capabilities and
  saved selections.

Request controls are `provider`, `options`, `timeoutMs`, `signal`, and
`onProgress`. Planning errors throw `WebfoxError`; per-input execution failures
remain in the document. Provider registration is deliberately not public.

## 🔌 Providers

| Provider | Search | Contents | Answer | Research |
| --- | :---: | :---: | :---: | :---: |
| Brave | ✓ | | ✓ | ✓ |
| Claude | ✓ | | ✓ | |
| Cloudflare | | ✓ | | |
| Codex | ✓ | | | |
| Custom | ✓ | ✓ | ✓ | ✓ |
| Exa | ✓ | ✓ | ✓ | ✓ |
| Firecrawl | ✓ | ✓ | ✓ | |
| Gemini | | | ✓ | ✓ |
| Linkup | ✓ | ✓ | | ✓ |
| Ollama | ✓ | ✓ | | |
| OpenAI | ✓ | | ✓ | ✓ |
| Parallel | ✓ | ✓ | | |
| Perplexity | ✓ | | ✓ | ✓ |
| Serper | ✓ | | | |
| Tavily | ✓ | ✓ | | |
| Valyu | ✓ | ✓ | ✓ | ✓ |

SDKs are dependencies but load only when executing their provider. Lightweight
provider definitions supply discovery, help, defaults, and validation.
Exa research returns a synthesized report with source links.

Gemini answers default to `gemini-3.8-flash`. Override the model with
`providers.gemini.options.answer.model` or the answer command's `--model` flag.
Gemini supports grounded answers and research, not standalone search. Its Google
Search tool runs inside a model interaction; Webfox does not discard the generated
answer and present its sources as ordinary search results. If you previously
selected Gemini for search, choose a search-capable provider and remove
`providers.gemini.options.search` from your configuration.

### Gemini research

Gemini research uses `deep-research-preview-04-2026`, Google's standard
[Deep Research agent](https://ai.google.dev/gemini-api/docs/deep-research).
The research agent is fixed; search and answer model settings don't affect it.

### Custom providers

Configure `providers.custom.commands.<capability>.argv`, optionally with `cwd`
and credential-source `env` entries. The process receives one JSON request:

```json
{
  "schemaVersion": 1,
  "capability": "search",
  "input": { "query": "example", "maxResults": 5 },
  "options": {},
  "cwd": "/working/directory"
}
```

Write one normalized result object to stdout and newline-delimited progress to
stderr. A nonzero exit signals failure. Contents answers must include a zero-based
`inputIndex` relative to the process request; `url` separately represents the final
URL. Errors are structured `{ "code": "PROVIDER_FAILURE", "message": "..." }`
objects. See the deterministic [custom-provider example](./examples/custom/README.md).

### pi extension

Webfox exposes `web_search`, `web_contents`, `web_answer`, and `web_research`
for capabilities with an explicitly configured default provider. Each tool’s
parameter schema is built dynamically from that provider: the model sees its
supported options, including provider-specific model settings, search controls,
and extraction options, rather than parameters for every backend. Unsupported
parameters are rejected with their exact paths and, when unambiguous, a suggested
valid location.

The extension shares configuration and execution with the CLI and library.
Restart pi after changing configuration to refresh the tool schemas. It forwards
cancellation and progress, marks partial results as errors, and truncates tool
output at 2,000 lines or 50 KiB, with full results saved to a temporary file. It needs no globally installed
`webfox` command and starts no background research jobs.

## 🧹 Uninstall

```sh
pi remove npm:webfox
```

For standalone installations, remove `webfox` with your package manager.

## 📄 License

[MIT](LICENSE)
