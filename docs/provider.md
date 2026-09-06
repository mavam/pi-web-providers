# Provider guide

Choose a provider for each capability, then supply its credentials. Save your
choices with `web config default`, or select a provider for one request with
`--provider`.

```sh
web providers
web providers brave
web search --provider brave --help
web config default search brave
```

`web providers <id>` shows setup guidance and supported capabilities. Configured
means local settings or credential sources exist—not that credentials or
connectivity have been verified. Inspection and help don't run credential commands
or make provider requests.

Use `web <capability> --provider <id> --help` for the full list of supported
options. To save options or read credentials from a password manager, see the
[configuration reference](./reference.md#configuration).

## Brave

Supports search, answers, and research. Set `BRAVE_SEARCH_API_KEY` for search and
`BRAVE_ANSWERS_API_KEY` for answers and research. The keys are separate; configuring
one doesn't configure the other capabilities.

```sh
web search "Node.js release notes" --provider brave
```

## Cloudflare

Supports page extraction through Cloudflare Browser Rendering. Set both
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

```sh
web contents https://example.com --provider cloudflare
```

## Custom

Connect your own command for any of the four capabilities. Configure
`providers.custom.commands.<capability>.argv`, optionally with `cwd` and
credential-source `env` entries. Only configured commands are available.

The process receives one JSON request:

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
objects. See the [custom-provider example](../examples/custom/README.md) for a
working command and the complete request/response contract.

## Exa

Supports search, page extraction, answers, and research. Set `EXA_API_KEY`.
Research returns a synthesized report with source links.

```sh
web search "Node.js release notes" --provider exa
web research "Compare databases for an analytics service" --provider exa --timeout 20m
```

## Firecrawl

Supports search, page extraction, and page-scoped answers. Set `FIRECRAWL_API_KEY`
for the hosted service. A self-hosted `providers.firecrawl.baseUrl` can work
without an API key.

Answers require a page URL, supplied through provider defaults or `--url`:

```sh
web contents https://example.com --provider firecrawl
web answer "What does this page explain?" --provider firecrawl --url https://example.com
```

## Gemini

Supports grounded answers and research, not standalone search. Set
`GOOGLE_API_KEY`. Google's Search tool runs inside a model interaction; Webfox
does not discard the generated answer and present its sources as ordinary search
results.

Answers default to `gemini-3.8-flash`. Override the model with
`providers.gemini.options.answer.model` or the answer command's `--model` flag.
Research uses `deep-research-preview-04-2026`, Google's standard
[Deep Research agent](https://ai.google.dev/gemini-api/docs/deep-research).
The research agent is fixed; answer model settings don't affect it.

If you previously selected Gemini for search, choose a search-capable provider
and remove `providers.gemini.options.search` from your configuration.

## Linkup

Supports search, page extraction, and research. Set `LINKUP_API_KEY`.

```sh
web search "Node.js release notes" --provider linkup
```

## Ollama

Supports search and page extraction through **hosted web APIs** at
`https://ollama.com`, not through the local Ollama model server. Set
`OLLAMA_API_KEY` from your Ollama account; no model download or local daemon is
required.

```sh
web search "Node.js streams documentation" --provider ollama --max-results 5
web contents https://example.com --provider ollama
```

Search supports up to 10 results. The `contents` capability uses Ollama's web
fetch endpoint. `providers.ollama.baseUrl` can point to a compatible proxy; it
does not turn the local inference API into a web search service.

## OpenAI

Supports search, grounded answers, and research. Set `OPENAI_API_KEY`.

```sh
web answer "What is MCP?" --provider openai --model gpt-6-astra
web search --provider openai --help
```

## Parallel

Supports search and page extraction. Set `PARALLEL_API_KEY`.

```sh
web search "Node.js release notes" --provider parallel
```

## Perplexity

Supports search, grounded answers, and research. Set `PERPLEXITY_API_KEY`.

```sh
web answer "What is MCP?" --provider perplexity
```

## Serper

Supports search. Set `SERPER_API_KEY`.

```sh
web search "Node.js release notes" --provider serper
```

## Tavily

Supports search and page extraction. Set `TAVILY_API_KEY`.

```sh
web contents https://example.com --provider tavily
```

## Valyu

Supports search, page extraction, answers, and research. Set `VALYU_API_KEY`.

```sh
web search "Node.js release notes" --provider valyu
```
