# Architecture

The public surface is a client, canonical request/result types, provider
inspection, and a narrow default setter. There is no public provider registry or
raw SDK response contract.

```text
CLI ─┐                    ┌─ lightweight provider definitions
pi  ─┼─ application API ───┼─ configuration and option planning
API ─┘                    └─ execution runtime ── lazy provider adapters
                                 │
                                 └─ credentials, deadlines, retries,
                                    polling, concurrency, redaction
```

## Boundaries

- `src/domain.ts` defines capabilities, discriminated input results, documents,
  requests, progress, and serialized errors. It imports no SDKs.
- `src/application.ts` snapshots configuration and environment, selects a
  provider, combines options, and exposes inspection. Credentials do not select
  providers. Inspection never resolves credential commands or initializes SDKs.
- `src/configuration/` handles paths, JSON validation, option merging, and atomic
  default updates. Provider definitions generate the configuration schema.
  Defaults and request overrides can be incomplete; required fields are checked
  on the merged request.
- `src/providers/<id>/definition.ts` contains lightweight metadata, credential
  declarations, schemas, defaults, retry safety, and one lazy loader. SDK imports
  and response translation stay in `adapter.ts`. Provider-specific resolved
  configuration types stay beside that adapter.
- `src/runtime/` resolves credential sources before loading adapters and owns the
  overall deadline, retry policy, ordered concurrency, subprocess cancellation,
  and the outward redaction boundary. Research adapters supply start/poll
  translations to the shared polling helper; creation runs once.
- `src/render.ts`, `src/cli.ts`, and `src/pi.ts` handle presentation and
  frontend-specific behavior. The pi frontend alone truncates model-facing
  output. The CLI keeps stdout machine-consumable and stderr diagnostic.

## Execution invariants

One operation deadline includes credential commands, retries, polling, and all
inputs. SDK retries are disabled where configurable. Firecrawl calls its total
attempt count `maxRetries`, so `1` means one attempt; its separate scrape
resumption is also disabled. SDK methods without cancellation support are raced
against the same signal. Late completions cannot publish further progress.

Only structurally classified transient failures can retry, and only when the
adapter declares the entire operation safe to repeat. Polling uses the runtime
retry count/backoff without repeating job creation. Valyu contents can create an
async job, so repeating the entire contents operation is not marked safe.

Contents operations are scheduled one URL at a time. Adapters return explicit
request-local indexes, not URL-based associations. The runtime rejects missing,
duplicate, or out-of-range indexes. This preserves duplicate inputs and completed
pages when another page times out; the requested URL and a reported final URL
remain separate.

The outward boundary redacts known credentials from strings, object keys,
progress, results, and serialized errors. Public exceptions omit unsafe causes.
Credential caches belong to a client, never a process-wide singleton. Adapters
receive resolved strings, not credential commands or unresolved configuration.

## Validation

```sh
bun run check
bun run test
bun run format:check
bun run build
bun run smoke:package
```

The package smoke test installs the archive in an isolated directory, exercises
all four custom-provider capabilities, then installs the optional pi host to
check its extension entry point. Provider contracts use mocked SDK calls rather
than a paid exhaustive provider matrix.

### Opt-in live tests

Build first, then select one provider explicitly. Available credentials never
select a provider. Missing credentials, empty results, and failed or partial
documents fail the smoke test rather than producing a misleading skip/pass.

```sh
node scripts/live-smoke.mjs --provider brave --capability search
node scripts/live-smoke.mjs --provider firecrawl --capability answer \
  --options-json '{"url":"https://nodejs.org/api/globals.html"}'
node scripts/live-smoke.mjs --provider gemini --capability research --include-research
```

Research requires separate consent and can incur charges. Cancelling the caller
does not necessarily cancel an already-created remote research job. The script
also accepts an explicit advanced `--config` path.

`.github/workflows/live-smoke.yaml` runs only on manual dispatch. Store test keys
as encrypted secrets in the `live-provider-tests` GitHub environment, using the
standard names shown by `web providers <id>`; Cloudflare also needs
`CLOUDFLARE_ACCOUNT_ID`. Configure environment approval rules as appropriate.
Only the selected provider’s secrets are exposed to the test step. Do not put
credentials in workflow inputs, configuration examples, or committed files.

An offline check of the same harness uses the deterministic custom example:

```sh
node scripts/live-smoke.mjs --provider custom --config examples/custom/web-mux.json
```
