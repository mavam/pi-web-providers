# Provider contract audit

Snapshot: 2026-09-06. This is an engineering record, not a provider usage guide.

## Scope and evidence

The remaining audit scope covers all 14 registered providers and 37 capability
surfaces after removing the Claude and Codex agent-backed integrations,
including providers that use HTTP or local executables rather than an SDK.
Inspected definitions, adapter option handling, and installed SDK types;
consulted the official references linked below for relevant API behavior.

All 10 remaining provider SDKs matched the npm registry's latest release at the
time of this check. SDK currency alone did not prevent schema drift.

This is not a claim of complete upstream API coverage or production compatibility.
No paid provider calls or research runs were made. Some SDKs accept fields more
permissively than their HTTP APIs, and model-specific support still varies.

## Findings and disposition

| Provider | Capabilities | SDK | Disposition |
| --- | --- | --- | --- |
| Brave | Search, answer, research | HTTP | Reviewed mode routing and field allowlists against existing fixtures and the Answers reference. No changes in this pass; no live validation of every search mode. |
| Cloudflare | Contents | 7.1.0 | Existing navigation setting matched the SDK. Added navigation/action timeouts, cache TTL, element waits, JavaScript, and user-agent controls. Credential-bearing browser state and script injection remain unexposed. |
| Custom | All four | Subprocess protocol | No upstream SDK. Arbitrary provider options remain intentional; managed command configuration is separate. |
| Exa | All four | 2.19.0 | Previous repair replaced retired research calls and corrected freshness controls. Existing real-SDK local HTTP tests retained. This pass did not attempt exhaustive Exa search-feature parity. |
| Firecrawl | Search, contents, answer | 4.38.0 | Search location was incorrectly an object; now a string. Scrape location now exposes country/languages rather than unsupported city/region. Removed obsolete search language/country fields; added current source/category enums, highlights, nested scrape tuning, and redaction mode. Page-question answers remain URL-scoped. |
| Gemini | Answer, research | 2.21.0 | Found Interactions/generate-content schema confusion in the former search capability. A concurrent change removed model-mediated search entirely. Added generate-content thinking settings to answers; fixed-agent research remains a separate schema. |
| Linkup | Search, contents, research | 3.6.0 | Added fetch strategy and `includeRawContent`; retained deprecated raw HTML compatibility. Requested raw content/images were being discarded; they now survive as metadata. Structured research's required-schema checks remain in the adapter. |
| Ollama | Search, contents | HTTP | Current web-search/web-fetch payloads expose query/count and URL, respectively. Existing 10-result cap matches the reference. No extra option surface invented. |
| OpenAI | Search, answer, research | 7.10.0 | Added reasoning/output budgets and live-versus-cache access with forwarding. Removed user location from deep research, which the official guide says does not support it. Retained existing model defaults; no unverified model migration. |
| Parallel | Search, contents | 1.3.3 | Added `fast`, source/fetch/excerpt policies, objective, session/model hints, and total excerpt budget. Preserved managed result count. Verified the SDK calls current `/v1/search`. |
| Perplexity | Search, answer, research | 0.38.5 | Corrected mode/recency enums; added date/language/content-budget controls. Sonar now exposes retrieval filters, reasoning and generation budgets, with web-search settings nested separately from standalone search settings. |
| Serper | Search modes | HTTP | Reviewed per-mode request construction and existing fixtures. Public documentation is less complete than the SDK-backed providers; full current mode/parameter parity remains unverified without authenticated API documentation. |
| Tavily | Search, contents | 0.7.9 | Added fast depths, answer/raw-content variants, date/chunk/automatic controls and extraction timeout. Constrained time-range and extraction-depth enums. Requested generated answers/images now survive as search metadata. |
| Valyu | All four | 2.10.1 | Existing SDK field forwarding matched the exposed subset. Replaced unrestricted research tool objects with `enabled`/`max_calls` controls. Broader workflow, callback, and external-MCP configuration remains unexposed. |

## Regression coverage

- `test/provider-option-contracts.test.ts`: SDK-typed examples validated against
  actual capability schemas; invalid combinations and rejection of
  host-managed/foreign options across all non-custom capability surfaces.
- `test/provider-sdk-wire.test.ts`: real SDKs against a local HTTP server for
  Firecrawl, Parallel, Tavily, Perplexity, OpenAI, and Linkup. Checks actual
  request paths, serialization, nested settings, and selected result metadata.
- Existing Exa local-wire tests, Gemini native capability tests, and remaining
  provider fixtures continue to run.
- Generated configuration schema rebuilt from the same definitions used for
  dynamic CLI and Pi options.

Typed examples do not prove every possible value or combination is supported.
Local HTTP servers verify request contracts, not upstream availability,
credentials, subscription permissions, result quality, or billing.

## Deliberate boundaries and follow-ups

- These tools expose a supported subset, not arbitrary SDK request passthrough.
  Credentials, executable configuration, callbacks/webhooks, custom external
  tools, streaming ownership, and managed inputs remain outside per-call schemas.
- Complex SDK features such as custom Firecrawl output-format objects, additional
  OpenAI web-search tools, Cloudflare authenticated browser state, and Valyu
  workflows need their own normalization and safety review before exposure.
- Reasoning controls remain provider-specific. SDK-level accepted values are not
  a promise that every model supports every level. Proxy/custom model names make
  a universal hardcoded model-to-level table inappropriate.
- A bounded live smoke pass is still needed before asserting production API
  compatibility. The earlier missing-`pi-tui` smoke failure was subsequently
  traced to a plain Node import bypassing Pi's extension loader. The package
  smoke test now loads and executes the installed extension through Pi with
  nested host dependencies; standalone consumers still need no Pi packages.

## Official references

- [Cloudflare markdown API](https://developers.cloudflare.com/api/resources/browser_rendering/subresources/markdown/methods/create/)
- [Firecrawl search](https://docs.firecrawl.dev/api-reference/endpoint/search)
- [Firecrawl scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape)
- [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking)
- [Linkup fetch](https://docs.linkup.so/pages/documentation/endpoints/fetch/reference)
- [Linkup research](https://docs.linkup.so/pages/documentation/endpoints/research/overview)
- [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Parallel advanced search](https://docs.parallel.ai/search/advanced-search-settings)
- [Parallel search modes](https://docs.parallel.ai/search/modes)
- [Perplexity search](https://docs.perplexity.ai/api-reference/search-post)
- [Tavily search](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Valyu research](https://docs.valyu.ai/guides/deepresearch)
- [Ollama web search](https://docs.ollama.com/capabilities/web-search)
- [Brave Answers](https://api-dashboard.search.brave.com/api-reference/summarizer/answers)
- [Serper](https://serper.dev/)
