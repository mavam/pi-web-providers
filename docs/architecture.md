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
- `src/configuration/` handles paths, YAML parsing and schema validation, option merging, and atomic
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

Store test keys as encrypted secrets in the **Live provider tests** GitHub
environment, using the standard names shown by `webfox providers <id>`; Cloudflare
also needs `CLOUDFLARE_ACCOUNT_ID`. Configure environment approval rules as
appropriate. The workflow binds this environment by its exact name; no local
credential file is uploaded. Only the selected provider’s secrets are exposed
to the test step. Do not put credentials in workflow inputs, configuration
examples, or committed files.

Run Brave search on the PR branch through the existing **CI** workflow:

```sh
gh workflow run ci.yaml --repo mavam/pi-web-providers --ref "$(git branch --show-current)" \
  -f live-provider=brave -f live-capability=search
```

Repeat with `live-capability=answer` to test the Brave answers key. Research
requires both `live-capability=research` and `include-research=true`.

Regular pull-request CI and manual runs with a blank `live-provider` perform
only offline checks. Explicit live selections invoke the reusable
`.github/workflows/live-smoke.yaml` at the same revision as the caller. This
also works before GitHub registers the new standalone workflow on the default
branch. Once registered, you can dispatch **Live provider smoke test** directly.

To add another provider, store its named secret in the same environment and
select that provider and a supported capability. The reusable workflow already
maps all built-in provider credential names. It never selects providers based
on which secrets exist. Custom providers require a separate command setup.

An offline check of the same harness uses the deterministic custom example:

```sh
node scripts/live-smoke.mjs --provider custom --config examples/custom/webfox.json
```
