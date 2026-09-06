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
| `--quiet` | Suppress progress on stderr, not errors. |

Durations require a unit: `500ms`, `30s`, `20m`, or `1h`. Ctrl-C cancels waiting
for stdin, credential commands, subprocesses, and provider operations. Cancellation
stops the caller waiting even if an SDK cannot cancel its underlying request.
Cancelling a remote research request does not necessarily cancel its billable job.

### Progressive help

```sh
webfox search --help
webfox search --provider openai --help
webfox search --help-advanced
```

Ordinary help contains common controls. Explicit provider help adds that
provider’s exact schema-derived flags. For example, OpenAI exposes `--model`,
`--search-context-size`, and `--user-location-country`. Arrays use repeatable
flags; booleans provide `--foo` and `--no-foo`.

Advanced help exposes `--config <path>`, `--cwd <path>`, and
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
or execution diagnostics. Progress and command errors go to stderr. Error color
follows terminal detection, `NO_COLOR`, and the advanced `--no-color` flag;
JSON never acquires terminal styling.
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

Discovery distinguishes **Supported**, **Configured**, and **Selected default**.
Configured means that local settings or credential sources exist—not that
credentials, executables, or connectivity have been verified. Inspection and help
never run credential commands or initialize provider SDKs.

## ⚙️ Configuration

JSON is for advanced setups. You don’t need to learn its schema to select and
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
3. `%APPDATA%\webfox\config.json` on Windows, when `APPDATA` is set.
4. `$XDG_CONFIG_HOME/webfox/config.json`.
5. `~/.config/webfox/config.json`.

A missing default file means no saved settings. An explicitly selected missing
file is an error; `config default` can create it. The setter preserves unrelated
settings and atomically replaces the file.

See [example-config.json](./example-config.json). A smaller example:

```json
{
  "$schema": "https://unpkg.com/webfox@4.0.0/dist/config.schema.json",
  "defaults": {
    "search": { "provider": "brave", "maxResults": 5 },
    "answer": { "provider": "openai" }
  },
  "execution": {
    "timeoutMs": 30000,
    "researchTimeoutMs": 1800000,
    "retries": 1,
    "retryDelayMs": 2000,
    "concurrency": 4
  },
  "providers": {
    "brave": {
      "options": { "search": { "mode": "news" } }
    },
    "openai": {
      "credentials": {
        "api": { "command": ["op", "read", "op://vault/openai/api-key"] }
      },
      "options": { "answer": { "model": "gpt-4.1" } }
    }
  }
}
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

```json
{ "env": "OPENAI_API_KEY" }
{ "command": ["program", "argument"] }
{ "value": "literal-secret" }
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
| Gemini | ✓ | | ✓ | ✓ |
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

The pi interface stays generic: `web_search`, `web_contents`, `web_answer`, and
`web_research`, with labels such as “Web Search.”

The extension uses the same inspection and execution API, binds only explicitly
selected capability defaults, and exposes each provider’s option schema. Restart
pi after changing configuration. It forwards cancellation and progress, marks
partial results as errors, and truncates tool output at 2,000 lines or 50 KiB,
with full results saved to a temporary file. It needs no globally installed
`webfox` command and starts no background research jobs.

## 🧹 Uninstall

```sh
pi remove npm:webfox
```

For standalone installations, remove `webfox` with your package manager.

## 📄 License

[MIT](LICENSE)
