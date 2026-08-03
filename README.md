# web-mux

Configurable web search, content extraction, grounded answers, and research through interchangeable providers, with a TypeScript library, `web` CLI, and pi extension.

`web-mux` gives applications and agents one interface for four web capabilities while keeping provider selection explicit. It ships integrations for Brave, Claude, Cloudflare, Codex, Custom, Exa, Firecrawl, Gemini, Linkup, Ollama, OpenAI, Parallel, Perplexity, Serper, Tavily, and Valyu.

Requires Node.js 22 or newer.

## Install

Install the `web` executable globally:

```sh
npm install -g web-mux
web --help
```

Run it without installing globally:

```sh
npx web-mux search "Node.js 22 release notes" --provider brave
```

Or add the library to an application:

```sh
npm install web-mux
```

## CLI

```text
web search [query|-] [--query <query>...] [--max-results <n>]
web contents <url...|->
web answer [question|-] [--query <question>...]
web research <brief|->
```

Search and answer accept up to ten inputs. The positional input comes first, followed by repeated `--query` values. `web contents -` reads newline-separated URLs from stdin. Research stays in the foreground, writes progress to stderr, writes only its result to stdout, and cancels on Ctrl-C.

Common options:

```text
--provider <id>              Select a provider for this invocation
--config <path>              Use an explicit configuration file
--cwd <path>                 Set the execution and custom-command directory
--timeout <ms>               Override the request timeout
--retries <n>                Override the retry count
--retry-delay <ms>           Override the initial retry delay
--output text|json           Select human-readable or normalized output
--raw                        Emit an unstable provider-payload wrapper
--options-json <json|@file>  Supply options that cannot be flags
--quiet                      Suppress progress on stderr
--no-color                   Disable color
--help                       Show provider-aware help
--version                    Show the version
```

`web --help` includes broad workflow examples across all four capabilities. Each command and configuration action has its own contextual examples, and selecting a provider before `--help` adds that provider's exact schema-derived options—for example, `web search --provider openai --help`.

The CLI loads the selected provider's TypeBox schema and creates exact flags for scalar fields. For example, `searchContextSize` becomes `--search-context-size`, `userLocation.country` becomes `--user-location-country`, arrays are repeatable, and booleans have both `--foo` and `--no-foo`. Objects, records, and colliding flag names remain available through `--options-json`.

Option precedence is:

1. provider defaults
2. configured capability options
3. `--options-json`
4. generated typed flags

No provider is selected implicitly. If neither `--provider` nor a configured capability default is present, `web` exits with a list of compatible providers.

### Output

Text is the default and never truncates provider results. `--output json` writes one normalized document:

Interactive text output and help use color automatically, with `✔︎` for success and `✘︎` for failures or partial results. Colors are disabled when output is redirected, when `--no-color` is present, or when `NO_COLOR` is set. `FORCE_COLOR` can enable colors for a non-interactive terminal. JSON and raw output never contain ANSI color codes.

```json
{
  "schemaVersion": 1,
  "capability": "search",
  "provider": "brave",
  "status": "ok",
  "results": [
    {
      "input": "example query",
      "ok": true,
      "value": { "results": [] }
    }
  ]
}
```

A partial batch includes both successful results and per-input errors, sets `status` to `partial`, and exits nonzero.

`--raw` is mutually exclusive with `--output json`. It emits a small wrapper around the payload captured before the CLI renders it. Secret-looking fields are redacted and request headers and credentials are never included. The payload shape is intentionally unstable across provider and SDK versions.

Exit codes are `0` for success, `1` for provider or partial-result failures, `2` for usage or configuration failures, `130` for cancellation.

### Supporting commands

```sh
web providers
web providers openai

web config path
web config init
web config init --force
web config show
web config edit
web config validate
```

`config show` always redacts literal and command credentials. `config validate` checks JSON and structure only; it performs no network requests and does not execute credential commands.

## Library

```ts
import { createWebMux } from "web-mux";

const web = createWebMux();

const result = await web.search({
  provider: "brave",
  queries: ["TypeBox validation", "Node.js AbortSignal"],
  maxResults: 8,
  options: { searchContextSize: "high" },
  onProgress: ({ message }) => console.error(message),
});

if (result.status === "partial") {
  // Successful inputs remain available in result.results.
}
```

The client provides:

- `search({ provider?, queries, maxResults?, options?, signal?, onProgress?, raw? })`
- `contents({ provider?, urls, options?, signal?, onProgress?, raw? })`
- `answer({ provider?, queries, options?, signal?, onProgress?, raw? })`
- `research({ provider?, input, options?, signal?, onProgress?, raw? })`
- `listProviders()` and `getProvider(id)`
- `getProviderOptionSchema(id, capability)`

The package exports typed configuration, requests, normalized results, provider metadata, `WebMuxError`, and the error codes `INVALID_CONFIG`, `INVALID_INPUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_FAILURE`, `PARTIAL_BATCH`, `TIMEOUT`, and `CANCELLED`. Provider registration is intentionally not public.

The published configuration schema is available as `web-mux/config.schema.json`.

## Configuration

Configuration is strict JSON. It is resolved in this order:

1. `--config`
2. `WEB_MUX_CONFIG`
3. `$XDG_CONFIG_HOME/web-mux/config.json`
4. `~/.config/web-mux/config.json`, or `%APPDATA%\web-mux\config.json` on Windows

Start with [example-config.json](./example-config.json) or run `web config init`. A complete shape looks like this:

```json
{
  "$schema": "https://unpkg.com/web-mux@0.1.0/dist/config.schema.json",
  "defaults": {
    "search": {
      "provider": "brave",
      "maxResults": 5,
      "options": {}
    },
    "contents": { "provider": "tavily" },
    "answer": { "provider": "openai" },
    "research": { "provider": "gemini" }
  },
  "execution": {
    "timeoutMs": 30000,
    "retries": 1,
    "retryDelayMs": 2000,
    "researchTimeoutMs": 1800000
  },
  "providers": {
    "brave": {
      "credentials": {
        "search": { "env": "BRAVE_SEARCH_API_KEY" }
      },
      "options": {
        "search": { "mode": "web" }
      }
    },
    "openai": {
      "credentials": {
        "api": { "command": ["op", "read", "op://vault/openai/api-key"] }
      },
      "options": {
        "answer": { "model": "gpt-5-mini" }
      }
    }
  }
}
```

Credential values are exactly one of:

```json
{ "env": "NAME" }
{ "command": ["program", "arg", "..."] }
{ "value": "literal" }
```

Credential commands run directly, never through a shell. Their trimmed stdout is cached in the client process. Standard environment variables work without an explicit provider section; see `web providers <id>` for each provider's names.

## Provider matrix

| Provider | Search | Contents | Answer | Research |
| --- | :---: | :---: | :---: | :---: |
| Brave | ✓ |  | ✓ | ✓ |
| Claude | ✓ |  | ✓ |  |
| Cloudflare |  | ✓ |  |  |
| Codex | ✓ |  |  |  |
| Custom | ✓ | ✓ | ✓ | ✓ |
| Exa | ✓ | ✓ | ✓ | ✓ |
| Firecrawl | ✓ | ✓ | ✓ |  |
| Gemini | ✓ |  | ✓ | ✓ |
| Linkup | ✓ | ✓ |  | ✓ |
| Ollama | ✓ | ✓ |  |  |
| OpenAI | ✓ |  | ✓ | ✓ |
| Parallel | ✓ | ✓ |  |  |
| Perplexity | ✓ |  | ✓ | ✓ |
| Serper | ✓ |  |  |  |
| Tavily | ✓ | ✓ |  |  |
| Valyu | ✓ | ✓ | ✓ | ✓ |

All provider SDKs are package dependencies. Provider modules are loaded dynamically, so unrelated SDKs do not run during CLI startup.

## Custom providers

Custom providers use a versioned, language-neutral process contract. Configure an argv array for each capability:

```json
{
  "defaults": { "search": { "provider": "custom" } },
  "providers": {
    "custom": {
      "commands": {
        "search": {
          "argv": ["node", "./examples/custom/provider.mjs"]
        }
      }
    }
  }
}
```

The process receives one JSON request on stdin:

```json
{
  "schemaVersion": 1,
  "capability": "search",
  "input": { "query": "example", "maxResults": 5 },
  "options": {},
  "cwd": "/working/directory"
}
```

It writes one normalized capability result to stdout and diagnostics to stderr. A nonzero exit means failure. Commands are argv arrays and are never interpreted by a shell. See [examples/custom/README.md](./examples/custom/README.md).

## pi extension

```sh
pi install npm:web-mux
```

The `web-mux/pi` entry point imports the library directly. At session startup it binds `web_search`, `web_contents`, `web_answer`, and `web_research` to their configured defaults and exposes each selected provider's exact option schema. Restart pi after changing configuration. The extension uses pi cancellation and progress callbacks and has no settings UI, management commands, background jobs, artifacts, cache, or dependency on a globally installed `web` command.

## Migrating from `pi-web-providers`

The old configuration is not detected or converted. There are no aliases or compatibility shims.

1. Uninstall the former package: `pi remove pi-web-providers` or `npm uninstall -g pi-web-providers`.
2. Install this package with `npm install -g web-mux`, run it once with `npx web-mux`, or install it in pi with `pi install npm:web-mux`.
3. Create a fresh XDG configuration with `web config init`.
4. Manually map fields:

| Former field | `web-mux` field |
| --- | --- |
| `tools.search` | `defaults.search.provider` |
| `tools.contents` | `defaults.contents.provider` |
| `tools.answer` | `defaults.answer.provider` |
| `tools.research` | `defaults.research.provider` |
| `settings.requestTimeoutMs` | `execution.timeoutMs` |
| `settings.retryCount` | `execution.retries` |
| `settings.retryDelayMs` | `execution.retryDelayMs` |
| `settings.researchTimeoutMs` | `execution.researchTimeoutMs` |
| provider credential string | `providers.<id>.credentials.<name>.env`, `.command`, or `.value` object |
| provider option object | `providers.<id>.options.<capability>` |
| custom provider option/command | `providers.custom.commands.<capability>` |

## Development

```sh
npm run check
npm test
npm run build
npm pack
```

Live provider smoke tests remain opt-in and credential-gated. Research smoke tests should be enabled separately because they can be slow and expensive.
