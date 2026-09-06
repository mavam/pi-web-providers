# Webfox reference

This reference covers advanced configuration and the TypeScript API. For everyday
commands, start with the [README](../README.md). See the
[provider guide](./provider.md) for setup and provider-specific behavior, or the
[CLI reference](./cli-experience.md) for scripting and output contracts.

## Configuration

### File selection and validation

Configuration paths resolve in this order:

1. `--config` or the library's `configPath`.
2. `WEBFOX_CONFIG`.
3. `%APPDATA%\webfox\config.yaml` on Windows, when `APPDATA` is set.
4. `$XDG_CONFIG_HOME/webfox/config.yaml`.
5. `~/.config/webfox/config.yaml`.

A missing default file means no saved settings. An explicitly selected missing
file is an error; `web config default` can create it. The setter preserves
unrelated settings and comments and atomically replaces the file with owner-only
permissions. `web config show` emits redacted YAML, hiding literal credentials
and credential commands. `web config validate` checks configuration and provider
option schemas without resolving credentials or making requests.

Use YAML 1.2 with string mapping keys and finite numbers. Duplicate keys,
multiple documents, aliases, explicit tags, and unknown configuration fields are
rejected. Empty files are valid and mean no saved settings. The published JSON
Schema supports validation and editor completion and is available as
`webfox/config.schema.json`.

Existing `config.json` files are no longer discovered automatically. Rename yours
to `config.yaml`, or select it with `WEBFOX_CONFIG` or `--config`. JSON syntax is
also valid YAML, so existing contents remain readable. This file-discovery change
is separate from the executable rename; JSON output and `--options-json` are
unchanged.

See the [example configuration](../example-config.yaml).

### Defaults and provider options

Capability defaults contain only provider selection and portable settings
(currently search's `maxResults`). Provider-specific options belong exclusively
under that provider:

```yaml
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

Options have one precedence order, from lowest to highest:

1. Provider defaults.
2. `providers.<id>.options.<capability>`.
3. Request options, or CLI `--options-json`.
4. Provider-specific CLI flags.

Switching providers never carries the previous provider's options into a request.
Defaults and overrides can be incomplete; required fields are checked after
merging. For example, Firecrawl answers need a `url` supplied in defaults or
with `--url`.

### Credentials

Each credential source has exactly one form:

```yaml
{ env: OPENAI_API_KEY }
{ command: [program, argument] }
{ value: "literal-secret" }
```

Standard environment references work without a provider section. `web providers
<id>` lists credential names. See the [provider guide](./provider.md) for each
provider's keys and setup requirements.

Credential commands run asynchronously as argument arrays, never through a shell.
They inherit the client's environment and working directory and obey its request
signal. Successful outputs are cached per client, not globally. Overriding one
credential preserves the provider's other standard references.

Resolved credentials are redacted from results, progress, and public errors
before they reach callers. Secret-bearing metadata fields are also redacted.
This policy is not a sandbox for untrusted adapters or commands.

### Timeouts, retries, and cancellation

Defaults are 30 seconds for ordinary operations, 30 minutes for research, four
concurrent inputs, and no retries. Retry backoff starts at two seconds and grows
up to 30 seconds within the same overall deadline. The deadline includes
credential commands, provider operations, and retries.

Only transient failures on operations the adapter marks retry-safe are retried.
Research job creation is never blindly retried; polling applies the configured
retry count and backoff without creating another job. URL operations are
scheduled separately so completed pages survive another page's failure or
timeout.

Cancellation stops the caller waiting even if an SDK cannot cancel its underlying
request. Cancelling a remote research request does not necessarily cancel its
billable job.

## TypeScript library

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
remain in the document. Results use the same
[document contract as CLI JSON](./cli-experience.md#json-results), without
truncation. Provider registration is deliberately not public; use a
[custom provider command](./provider.md#custom) to connect another backend.

For all capabilities, `onProgress` includes per-input lifecycle events with
`inputIndex`, `input`, and `state` (`queued`, `running`, `done`, `failed`, or
`cancelled`). Indexes refer to the original input order, including duplicate
inputs. Provider progress messages may omit these fields.

## pi extension behavior

Webfox exposes `web_search`, `web_contents`, `web_answer`, and `web_research`
for capabilities with an explicitly configured default provider. Each tool's
parameter schema is built dynamically from that provider: the model sees its
supported options rather than parameters for every backend. Unsupported
parameters are rejected with their exact paths and, when unambiguous, a suggested
valid location.

Restart pi after changing configuration to refresh the tool schemas. The
extension forwards cancellation and progress, marks partial results as errors,
and truncates tool output at 2,000 lines or 50 KiB, with full results saved to a
temporary file. It needs no globally installed `web` command and starts no
background research jobs.
