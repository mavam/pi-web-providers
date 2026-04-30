# 🌍 pi-web-providers

A _meta_ web extension for [pi](https://pi.dev) that routes search, content
extraction, quick grounded answers, and research through configurable per-tool
providers, with explicit provider-specific option schemas for each managed tool.

## Why?

Most web extensions hard-wire a single backend. **pi-web-providers** lets you
mix and match providers per tool instead, so `web_search`, `web_contents`,
`web_answer`, and `web_research` can each use a different backend or be turned
off entirely. Treat `web_answer` as a fast path for simple grounded questions,
not as a replacement for source inspection or deeper research.

## ✨ Features

- **Multiple providers**: Brave, Claude, Cloudflare, Codex, Exa, Firecrawl,
  Gemini, Linkup, Ollama, OpenAI, Perplexity, Parallel, Serper,
  [Tavily](https://tavily.com), Valyu
- **Provider-aware tool options**: pi only exposes the provider settings that
  actually apply to the backend you selected, so tool calls are easier to
  discover and harder to get wrong
- **Batched search and answers**: run several related queries or questions in a
  single `web_search` or `web_answer` call and get grouped results back in one
  response
- **Background contents prefetch**: optionally start `web_contents`
  extraction from `web_search` results in the background and reuse the cached
  pages later for faster follow-up reads

## 📦 Install

```bash
pi install npm:pi-web-providers
```

## ⚙️ Configure

Run:

```text
/web-providers
```

This edits the global config file `~/.pi/agent/web-providers.json`. The
settings UI mirrors the three sections below: tools, providers, and settings.

Each tool can be routed to any compatible provider:

**Built-in local providers**

| Provider   | search | contents | answer | research | Auth                   |
| ---------- | :----: | :------: | :----: | :------: | ---------------------- |
| **Claude** |   ✔    |          |   ✔    |          | Local Claude Code auth |
| **Codex**  |   ✔    |          |        |          | Local Codex CLI auth   |

**API-backed providers**

| Provider       | search | contents | answer | research | Auth                                             |
| -------------- | :----: | :------: | :----: | :------: | ------------------------------------------------ |
| **Brave**      |   ✔    |          |   ✔    |    ✔     | `BRAVE_SEARCH_API_KEY` / `BRAVE_ANSWERS_API_KEY` |
| **Cloudflare** |        |    ✔     |        |          | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` |
| **Exa**        |   ✔    |    ✔     |   ✔    |    ✔     | `EXA_API_KEY`                                    |
| **Firecrawl**  |   ✔    |    ✔     |        |          | `FIRECRAWL_API_KEY`                              |
| **Gemini**     |   ✔    |          |   ✔    |    ✔     | `GOOGLE_API_KEY`                                 |
| **Linkup**     |   ✔    |    ✔     |        |          | `LINKUP_API_KEY`                                 |
| **Ollama**     |   ✔    |    ✔     |        |          | `OLLAMA_API_KEY`                                 |
| **OpenAI**     |   ✔    |          |   ✔    |    ✔     | `OPENAI_API_KEY`                                 |
| **Parallel**   |   ✔    |    ✔     |        |          | `PARALLEL_API_KEY`                               |
| **Perplexity** |   ✔    |          |   ✔    |    ✔     | `PERPLEXITY_API_KEY`                             |
| **Serper**     |   ✔    |          |        |          | `SERPER_API_KEY`                                 |
| **Tavily**     |   ✔    |    ✔     |        |          | `TAVILY_API_KEY`                                 |
| **Valyu**      |   ✔    |    ✔     |   ✔    |    ✔     | `VALYU_API_KEY`                                  |

Advanced option: `custom` can route any managed tool through a local wrapper
command using a JSON stdin/stdout contract.

See [`example-config.json`](example-config.json) for the minimal default
configuration.

### Tools

Each managed tool maps to one provider id under the top-level `tools` key.
Removing a tool mapping turns that tool off. A tool is only exposed when it is
mapped to a compatible provider and that provider is currently available.
Shared defaults and tool-specific settings live under `settings`; search-specific
settings live under `settings.search`, and async research uses
`settings.researchTimeoutMs`. Provider option schemas are strict: only the keys
shown for the active provider are accepted.

#### `web_search`

Search the public web for up to 10 queries in one call. It returns grouped
titles, URLs, and snippets for each query. Batch related queries when grouped
comparison matters; use separate sibling `web_search` calls when independent
results should arrive as soon as they are ready.

<details>
<summary><strong>Parameters and behavior</strong></summary>

| Parameter    | Type     | Default  | Description                                                        |
| ------------ | -------- | -------- | ------------------------------------------------------------------ |
| `queries`    | string[] | required | One or more search queries to run (max 10)                         |
| `maxResults` | integer  | `5`      | Result count per query, clamped to `1–20`                          |
| `options`    | object   | —        | Provider-specific settings exposed by the selected provider schema |

`options` is omitted when the configured search provider has no per-call
provider options. Runtime controls are not accepted in tool calls. Configure
retry, timeout, and background contents prefetch under `settings` and
`settings.search`; prefetch starts only when `settings.search.provider` is set.

</details>

#### `web_contents`

Read the main text from one or more web pages. It reuses cached pages when they
match and fetches only missing or stale URLs. Batch related pages when they are
meant to be read as one bundle; use separate sibling `web_contents` calls when
each page can be acted on independently.

<details>
<summary><strong>Parameters and behavior</strong></summary>

| Parameter | Type     | Default  | Description                                                        |
| --------- | -------- | -------- | ------------------------------------------------------------------ |
| `urls`    | string[] | required | One or more URLs to extract                                        |
| `options` | object   | —        | Provider-specific settings exposed by the selected provider schema |

`web_contents` reuses any matching cached pages already present in the local
in-memory cache—whether they came from prefetch or an earlier read—and only
fetches missing or stale URLs.

</details>

#### `web_answer`

Answer one or more simple factual questions using web-grounded evidence. Use it
as a lightweight shortcut when you want a concise grounded answer without
manually selecting and reading sources. Prefer `web_search` plus `web_contents`
when source selection matters or you need to inspect primary sources directly;
prefer `web_research` for open-ended, controversial, or multi-step
investigations.

When you ask more than one question, the response is grouped into per-question
sections. Batch related questions when the answers belong together; split them
into sibling calls when earlier independent answers can unblock the next step.

<details>
<summary><strong>Parameters and behavior</strong></summary>

| Parameter | Type     | Default  | Description                                                        |
| --------- | -------- | -------- | ------------------------------------------------------------------ |
| `queries` | string[] | required | One or more questions to answer in one call (max 10)               |
| `options` | object   | —        | Provider-specific settings exposed by the selected provider schema |

Responses are grouped into per-question sections when more than one question is
provided.

</details>

#### `web_research`

Investigate a topic across web sources and produce a longer report.
`web_research` is always asynchronous: it starts a background run, returns a
short dispatch notice immediately, and later posts a completion message with a
saved report path.

<details>
<summary><strong>Parameters and behavior</strong></summary>

| Parameter | Type   | Default  | Description                                                        |
| --------- | ------ | -------- | ------------------------------------------------------------------ |
| `input`   | string | required | Research brief or question                                         |
| `options` | object | —        | Provider-specific settings exposed by the selected provider schema |

`options` is provider-specific. Equivalent concepts can use different field
names across SDKs—for example Perplexity uses `country`, Exa uses
`userLocation`, and Valyu uses `countryCode`. Runtime controls are not accepted
in tool calls.

Unlike the other managed tools, `web_research` does not accept local timeout,
retry, polling, or resume controls. Research has one opinionated execution
style: pi starts it asynchronously, tracks it locally, and saves the final
report under `.pi/artifacts/research/`.

</details>

### Providers

The built-in providers below integrate with official SDKs or documented APIs.

<details>
<summary><strong>Brave</strong></summary>

- API: Brave Search API and Brave Answers API
- Supports `web_search` via Web Search, plus optional `llm_context`, `news`, `videos`, `images`, and `places` search modes
- Supports `web_answer` and `web_research` via Brave Answers streaming chat completions
- `web_contents` stays routed to URL-fetch providers; Brave LLM Context is query-based retrieval and is exposed as a search mode instead
- Brave Answers may require a different key or plan than Brave Search

**Setup**

```json
{
  "tools": {
    "search": "brave",
    "answer": "brave",
    "research": "brave"
  },
  "providers": {
    "brave": {
      "credentials": {
        "search": "BRAVE_SEARCH_API_KEY",
        "answers": "BRAVE_ANSWERS_API_KEY"
      }
    }
  }
}
```

Use `providers.brave.options.search.mode` or per-call search options to select
`llm_context`, `news`, `videos`, `images`, or `places`. Places details and
descriptions are opt-in because they can add calls, latency, and place-specific
semantics.

</details>

<details>
<summary><strong>Claude</strong></summary>

- SDK: `@anthropic-ai/claude-agent-sdk`
- Uses Claude Code's built-in `WebSearch` and `WebFetch` tools with structured JSON output
- Exposes `model`, `thinking`, `effort`, `maxThinkingTokens`, `maxTurns`, and
  `maxBudgetUsd` as provider options for search and answer calls
- Great for search plus grounded answers if you already use Claude Code locally

</details>

<details>
<summary><strong>Cloudflare</strong></summary>

- SDK: `cloudflare`
- Supports `web_contents` via Cloudflare Browser Rendering's `/markdown`
  endpoint
- Good for JavaScript-heavy pages that need a real browser render before
  extraction
- Exposes `gotoOptions.waitUntil` as the provider-specific contents option

**Setup**

1. In the Cloudflare dashboard, create an API token.
2. Grant it this permission:
   - `Account | Browser Rendering | Edit`
3. Scope it to the account you want to use.
4. Copy that account's **Account ID** from the Cloudflare dashboard.
5. Configure pi with both values:

```json
{
  "tools": {
    "contents": "cloudflare"
  },
  "providers": {
    "cloudflare": {
      "credentials": {
        "api": "CLOUDFLARE_API_TOKEN"
      },
      "accountId": "CLOUDFLARE_ACCOUNT_ID"
    }
  }
}
```

If Cloudflare returns `401 Authentication error`, the token permission, token
scope, or account ID is usually wrong.

</details>

<details>
<summary><strong>Codex</strong></summary>

- SDK: `@openai/codex-sdk`
- Runs in read-only mode with web search enabled
- Exposes `model`, `modelReasoningEffort`, and `webSearchMode` as provider
  options for `web_search`
- Best if you already use the local Codex CLI and auth flow

</details>

<details>
<summary><strong>Exa</strong></summary>

- SDK: `exa-js`
- Supports `web_search`, `web_contents`, `web_answer`, and `web_research`
- `web_research` is exposed through pi's async research workflow
- Neural, keyword, hybrid, and deep-research search modes
- Inline text-content extraction on search results
- Exposes search options such as `category`, `type`, date filters,
  `includeDomains`, `excludeDomains`, `userLocation`, and `contents`
- Persisted Exa defaults are scoped under `providers.exa.options.search`
- `web_contents`, `web_answer`, and `web_research` currently use fixed provider behavior with no extra per-call provider options

</details>

<details>
<summary><strong>Firecrawl</strong></summary>

- SDK: `@mendable/firecrawl-js`
- Supports `web_search` and `web_contents`
- Search can optionally include Firecrawl scrape-backed result enrichment
- Contents extraction uses Firecrawl scrape with markdown-first defaults
- Exposes search options such as `lang`, `country`, `sources`, `categories`,
  `location`, `timeout`, and `scrapeOptions`
- Exposes contents options such as `formats`, `onlyMainContent`, `includeTags`,
  `excludeTags`, `waitFor`, `headers`, `location`, `mobile`, and `proxy`

</details>

<details>
<summary><strong>Gemini</strong></summary>

- SDK: `@google/genai`
- Supports `web_search`, `web_answer`, and `web_research`
- `web_research` is exposed through pi's async research workflow
- Google Search grounding for answers
- Deep-research agents via Google's Gemini API
- Exposes `model` and `generation_config` for search, `model` and `config`
  for answers, and only the conservative deep-research option
  `agent_config.thinking_summaries` for research
- Gemini research intentionally does not expose or send Interactions API
  `tools`, `response_format`, `response_modalities`, or `system_instruction`
  because the default deep-research agent rejects several of those fields

</details>

<details>
<summary><strong>Linkup</strong></summary>

- SDK: `linkup-sdk`
- Supports `web_search` via Linkup Search with fixed `searchResults` output
- Supports `web_contents` via Linkup Fetch and always returns markdown
- Exposes search options `depth`, `includeImages`, `includeDomains`,
  `excludeDomains`, `fromDate`, and `toDate`
- Exposes contents options `renderJs`, `includeRawHtml`, and `extractImages`
- Good fit for a simple search-plus-markdown setup without extra provider wiring

</details>

<details>
<summary><strong>Ollama</strong></summary>

- API: [Ollama Web Search and Fetch API](https://docs.ollama.com/capabilities/web-search)
- Supports `web_search` via Ollama's `POST /api/web_search` endpoint
- Supports `web_contents` via Ollama's `POST /api/web_fetch` endpoint
- Authenticates with an Ollama API key using `OLLAMA_API_KEY` by default
- Optional `baseUrl` overrides the default `https://ollama.com` API host for
  proxies or compatible endpoints
- Ollama caps search requests at 10 results, so `web_search.maxResults` is
  clamped to `1–10` for this provider

Minimal config:

```json
{
  "tools": {
    "search": "ollama",
    "contents": "ollama"
  },
  "providers": {
    "ollama": {
      "credentials": {
        "api": "OLLAMA_API_KEY"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>OpenAI</strong></summary>

- SDK: `openai`
- Supports `web_search`, `web_answer`, and `web_research`
- Uses the Responses API for structured web search, grounded answers, and
  deep-research runs
- Always enables OpenAI's built-in `web_search_preview` tool for search,
  answer, and research calls
- Exposes `model` and `instructions` for `web_search` and `web_answer`
- Exposes `model`, `instructions`, and `max_tool_calls` for `web_research`
- Good fit when you want official OpenAI web-grounded search, answers, and deep
  research behind pi's managed tool abstractions

**Setup**

1. Create or reuse an OpenAI API key.
2. Configure pi to route `web_search`, `web_answer`, `web_research`, or any
   subset of them to `openai`.
3. Optionally set default models under `providers.openai.options.search.model`,
   `providers.openai.options.answer.model`, and
   `providers.openai.options.research.model`.

```json
{
  "tools": {
    "search": "openai",
    "answer": "openai",
    "research": "openai"
  },
  "providers": {
    "openai": {
      "credentials": {
        "api": "OPENAI_API_KEY"
      },
      "options": {
        "search": {
          "model": "gpt-4.1"
        },
        "answer": {
          "model": "gpt-4.1"
        },
        "research": {
          "model": "o4-mini-deep-research"
        }
      }
    }
  }
}
```

You can also set `instructions` as a provider default under
`providers.openai.options.search`, `providers.openai.options.answer`, or
`providers.openai.options.research`, and set `max_tool_calls` under
`providers.openai.options.research`. All of them can also be overridden per
call.

</details>

<details>
<summary><strong>Perplexity</strong></summary>

- SDK: `@perplexity-ai/perplexity_ai`
- Supports `web_search`, `web_answer`, and `web_research`
- `web_research` is exposed through pi's async research workflow
- Uses Perplexity Search for `web_search`
- Uses Sonar for `web_answer` and `sonar-deep-research` for `web_research`
- Exposes search options `country`, `search_mode`,
  `search_domain_filter`, and `search_recency_filter`
- Exposes `model` for answer and research calls

</details>

<details>
<summary><strong>Parallel</strong></summary>

- SDK: `parallel-web`
- Agentic and one-shot search modes
- Page content extraction with excerpt and full-content toggles
- Exposes search option `mode`
- Exposes contents options `excerpts` and `full_content`

</details>

<details>
<summary><strong>Serper</strong></summary>

- API: Serper HTTP API
- Supports `web_search` via Serper's Google endpoints for web, image, video,
  places, maps, reviews, news, shopping, product reviews, Lens, Scholar,
  patents, autocomplete, and webpage results
- Good fit for fast, straightforward Google-style search results
- Exposes search options `mode`, `gl`, `hl`, `location`, `page`, `tbs`,
  `autocorrect`, and mode-specific fields such as `url`, `ll`, `placeId`,
  `cid`, `fid`, `productId`, `nextPageToken`, and webpage include flags.
  `includeMarkdown` defaults to `true` for webpage scraping
- Preserves rich metadata from Serper responses, including ranking position,
  sitelinks, attributes, and top-level response context such as
  `knowledgeGraph`, `answerBox`, `peopleAlsoAsk`, and `relatedSearches`
- Optional `baseUrl` overrides are supported for proxies and testing

Minimal config:

```json
{
  "tools": {
    "search": "serper"
  },
  "providers": {
    "serper": {
      "credentials": {
        "api": "SERPER_API_KEY"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Tavily</strong></summary>

- SDK: `@tavily/core`
- Supports `web_search` via Tavily Search
- Supports `web_contents` via Tavily Extract
- Good for pairing LLM-oriented web search with lightweight page extraction
- Exposes search options `topic`, `searchDepth`, `timeRange`, `country`,
  `exactMatch`, `includeAnswer`, `includeRawContent`, `includeImages`,
  `includeFavicon`, `includeDomains`, `excludeDomains`, and `days`
- Exposes contents options `extractDepth`, `format`, `includeImages`, `query`,
  `chunksPerSource`, and `includeFavicon`

</details>

<details>
<summary><strong>Valyu</strong></summary>

- SDK: `valyu-js`
- Supports `web_search`, `web_contents`, `web_answer`, and `web_research`
- `web_research` is exposed through pi's async research workflow
- Web, proprietary, and news search types
- Exposes search options `searchType`, `responseLength`, and `countryCode`
- Exposes answer and research options `responseLength` and `countryCode`
- Persisted Valyu defaults are scoped under `providers.valyu.options.search`,
  `providers.valyu.options.answer`, and `providers.valyu.options.research`
- `web_contents` currently uses fixed provider behavior with no extra per-call
  provider options

</details>

### Custom provider

The `custom` provider lets you bring your own wrapper command for any
managed tool. Each capability can point at a different local command under
`providers["custom"].options`.

`custom` does not expose standard per-call `options` fields. Put
provider-specific behavior in the wrapper configuration or in the wrapper
implementation.

The repo includes actual wrapper examples under
[`examples/custom/wrappers/`](examples/custom/wrappers/). They are
small bash scripts that use `jq` for JSON handling. Each one uses a different
backend pattern:

- `codex --search exec` for `web_search`
- Gemini API via `curl` for `web_contents`
- `claude -p` for `web_answer`
- Perplexity API via `curl` for `web_research`

<details>
<summary><strong>Configuration example</strong></summary>

Copy the example wrappers into a local `./wrappers/` directory, then configure:

```json
{
  "tools": {
    "search": "custom",
    "contents": "custom",
    "answer": "custom",
    "research": "custom"
  },
  "providers": {
    "custom": {
      "options": {
        "search": {
          "argv": ["bash", "./wrappers/codex-search.sh"]
        },
        "contents": {
          "argv": ["bash", "./wrappers/gemini-contents.sh"]
        },
        "answer": {
          "argv": ["bash", "./wrappers/claude-answer.sh"]
        },
        "research": {
          "argv": ["bash", "./wrappers/perplexity-research.sh"]
        }
      }
    }
  }
}
```

Those example wrappers deliberately use different local CLIs and APIs so you
can see several wrapper styles in one setup without extra glue code.

Each capability can also set an optional `cwd` and `env` block. Use `cwd` when
one wrapper must run from a specific directory. Use `env` for per-command
variables; each value can be a literal string, an environment variable name, or
`!command`.

`web_research` uses the same async workflow as every other research provider:
pi starts the wrapper in the background, tracks the job locally, and writes the
final report to a file when it finishes.

Wrapper contract:

- `stdin`: one JSON request object with `capability` plus the per-call managed
  inputs (`query`, `urls`, `input`, `maxResults`, `options`, `cwd`)
- `stdout`: one JSON response object
  - `search`: `{ "results": [{ "title", "url", "snippet" }] }`
  - `contents`: `{ "answers": [{ "url", "content"?: "...", "summary"?: unknown, "metadata"?: {}, "error"?: "..." }] }`
  - `answer` / `research`: `{ "text": "...", "summary"?: "...", "itemCount"?: 1, "metadata"?: {} }`
- `stderr`: optional progress lines
- exit code `0`: success
- non-zero exit code: failure

</details>

See [`examples/custom/README.md`](examples/custom/README.md) for a
copy-and-pasteable setup, and see
[`examples/custom/wrappers/`](examples/custom/wrappers/) for the actual
wrapper files.

### Settings

The `settings` block holds shared execution defaults that apply to all
providers unless overridden in a provider's own `settings` block:

| Field               | Default   | Description                                                 |
| ------------------- | --------- | ----------------------------------------------------------- |
| `requestTimeoutMs`  | `30000`   | Maximum time for a single provider request                  |
| `retryCount`        | `3`       | Retries for transient failures                              |
| `retryDelayMs`      | `2000`    | Initial delay before retrying                               |
| `researchTimeoutMs` | `1800000` | Maximum total time for an async `web_research` job (30 min) |

## 🔎 Live smoke tests

Use the opt-in live smoke runner to validate the configured providers with the
same config-resolution and execution path the extension uses at runtime:

```bash
npm run smoke:live
```

Optional filters:

```bash
npm run smoke:live -- --provider gemini
npm run smoke:live -- --tool contents
npm run smoke:live -- --include-research
```

The default run exercises `search`, `contents`, and `answer`. Research probes
are excluded unless you pass `--include-research`, because they are slower and
may incur higher provider cost.

## 📄 License

[MIT](LICENSE)
