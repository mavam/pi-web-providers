# Provider Abstraction Simplification Plan

## Progress

- [x] Phase 1: Remove model-facing runtime options.
- [x] Phase 2: Make tool registration provider-bound.
- [x] Phase 3: Introduce `defineProvider`.
- [ ] Phase 4: Move config parsing to provider definitions.
- [ ] Phase 5: Move UI manifests into provider definitions.
- [ ] Phase 6: Migrate providers one group at a time.

## Goal

Adding a new web provider should be a surgical operation: define the provider's
configuration schema, define each supported tool schema, and implement the
mapping between pi's normalized tool inputs and the provider's native API.

The core should handle registration, configuration loading, capability routing,
execution policy, batching, caching, progress, rendering, and result shaping.
A provider implementation should not need to know about any of that.

## Core principle

For each configured tool/provider pair, pi should register a static tool schema
that exactly matches the selected provider.

For example:

```json
{
  "tools": {
    "search": "exa"
  }
}
```

should make the model see a `web_search` tool shaped like:

```ts
{
  queries: string[];
  maxResults?: number;
  options?: ExaSearchOptions;
}
```

not a generic runtime-routed schema like:

```ts
{
  options?: {
    provider?: Record<string, unknown>;
    runtime?: Record<string, unknown>;
  };
}
```

The model should only fill out the tool schema it was given and then perform
the tool call.

## Remove model-facing runtime options

Runtime options should not be part of model-visible tool schemas.

Remove these from tool-call inputs:

- `options.runtime.requestTimeoutMs`
- `options.runtime.retryCount`
- `options.runtime.retryDelayMs`
- `options.runtime.prefetch`

These are operational concerns, not semantic choices for the model. They belong
in configuration:

```json
{
  "settings": {
    "requestTimeoutMs": 30000,
    "retryCount": 1,
    "retryDelayMs": 1000,
    "search": {
      "provider": "exa",
      "maxUrls": 3,
      "ttlMs": 600000
    }
  }
}
```

After this change, provider execution should receive execution policy only from
resolved configuration, not from each tool call.

## Simplify tool options

Current shape:

```ts
options?: {
  provider?: ProviderOptions;
  runtime?: RuntimeOptions;
}
```

Target shape:

```ts
options?: ProviderOptions;
```

Do not flatten provider options into top-level tool arguments. Keeping provider
options under `options` avoids collisions with core fields like `queries`,
`urls`, `maxResults`, `input`, and `query`.

Examples:

```json
{
  "queries": ["exa sdk"],
  "maxResults": 5,
  "options": {
    "includeDomains": ["exa.ai"]
  }
}
```

If the selected provider has no provider-specific options, the `options` field
should not exist in the schema.

For example, Ollama currently supports only managed request fields:

- search: `query`, `max_results`
- contents: `url`

So with `tools.search = "ollama"`, `web_search` should expose no `options`
field.

## Static provider-bound tool registration

Tool registration should be config-driven:

1. Load config.
2. Resolve the configured provider for each capability.
3. Register only available configured tools.
4. Build the exact schema from the selected provider's capability definition.
5. Re-register tools after `/web-providers` changes config.

The model should never see options for unconfigured providers.

Examples:

- With `tools.search = "ollama"`, `web_search` has no `options` field and
  `maxResults.maximum` is `10`.
- With `tools.search = "exa"`, `web_search.options` is Exa's search schema.
- With `tools.contents = "linkup"`, `web_contents.options` is Linkup's fetch
  schema.

## Provider authoring target

Adding a provider should look roughly like this:

```ts
export const ollamaProvider = defineProvider({
  id: "ollama",
  label: "Ollama",
  docsUrl: "https://docs.ollama.com/capabilities/web-search",

  config: {
    schema: Type.Object({
      apiKey: Type.Optional(Type.String()),
      baseUrl: Type.Optional(Type.String()),
    }),
    template: {
      apiKey: "OLLAMA_API_KEY",
    },
    fields: [apiKeyField({ env: "OLLAMA_API_KEY" }), baseUrlField()],
  },

  capabilities: {
    search: defineCapability({
      maxResults: 10,
      options: undefined,

      async execute({ query, maxResults }, ctx) {
        // Map pi's normalized search request to Ollama's native API.
      },
    }),

    contents: defineCapability({
      options: undefined,

      async execute({ url }, ctx) {
        // Map pi's normalized contents request to Ollama's native API.
      },
    }),
  },
});
```

For a provider with options:

```ts
const serperSearchOptions = Type.Object(
  {
    gl: Type.Optional(Type.String()),
    hl: Type.Optional(Type.String()),
    location: Type.Optional(Type.String()),
    page: Type.Optional(Type.Integer({ minimum: 1 })),
    autocorrect: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

type SerperSearchOptions = Static<typeof serperSearchOptions>;

export const serperProvider = defineProvider({
  id: "serper",
  label: "Serper",
  docsUrl: "https://serper.dev/",

  config: {
    template: {
      apiKey: "SERPER_API_KEY",
    },
    fields: [apiKeyField({ env: "SERPER_API_KEY" }), baseUrlField()],
  },

  capabilities: {
    search: defineCapability({
      options: serperSearchOptions,

      async execute({ query, maxResults, options }, ctx) {
        const body = {
          q: query,
          num: maxResults,
          ...options,
        };
        // Call Serper and normalize the response.
      },
    }),
  },
});
```

The provider implementation should not need to know about:

- tool registration
- active tool sync
- runtime option splitting
- config parsing switch statements
- provider manifests
- availability routing
- batching multiple queries
- truncation and rendering
- cache or prefetch plumbing

## Provider definition abstraction

Introduce one central provider definition abstraction:

```ts
type SearchInput = {
  query: string;
  maxResults: number;
};

type ContentsInput = {
  url: string;
};

type AnswerInput = {
  query: string;
};

type ResearchInput = {
  input: string;
};

type CapabilityInput<TInput extends object, TOptions> = TInput & {
  options?: TOptions;
};

interface CapabilityDefinition<
  TInput extends object,
  TOptions extends object | undefined = undefined,
  TResult = unknown,
> {
  options?: TObject;
  limits?: CapabilityLimits;

  execute(
    input: CapabilityInput<TInput, TOptions>,
    context: ProviderExecutionContext,
  ): Promise<TResult>;
}

interface ProviderDefinition<
  TId extends string,
  TConfig,
  TCapabilities extends Partial<
    Record<Tool, CapabilityDefinition<object, object | undefined, unknown>>
  >,
> {
  id: TId;
  label: string;
  docsUrl: string;
  config: ProviderConfigDefinition<TConfig>;
  capabilities: TCapabilities;
}
```

The `options` argument is optional by design. Provider-specific call options are
always optional in the public tool schema, and providers without options use the
default `TOptions = undefined`. This keeps no-option handlers clean:

```ts
execute({ query, maxResults }, ctx) {
  // No unused options field.
}
```

Providers with an options schema receive a typed optional object:

```ts
execute({ query, maxResults, options }, ctx) {
  // options?: SerperSearchOptions
}
```

Use `defineCapability()` to infer `TInput`, `TOptions`, and `TResult` at the
provider boundary so provider implementations don't need to write these generic
parameters by hand.

Public tools may still batch, but provider handlers should generally receive a
single normalized unit. The core should batch and aggregate.

## Schema as source of truth

Provider option schemas should become the source of truth for:

- tool-call schemas
- config default validation
- TypeScript option types
- documentation hints
- runtime validation

Today this is duplicated across:

- `src/types.ts`
- provider-local TypeBox schemas
- `src/config.ts` provider parsing
- `src/provider-config-manifests.ts`
- provider runtime validation
- README text

Target pattern:

```ts
const exaSearchOptionsSchema = Type.Object(
  {
    type: Type.Optional(literalUnion(["keyword", "neural", "auto"])),
    category: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

type ExaSearchOptions = Static<typeof exaSearchOptionsSchema>;
```

Then:

- config parser accepts `providers.exa.options.search` using this schema
- tool schema exposes `options?: exaSearchOptionsSchema`
- handler receives `options: ExaSearchOptions`
- unknown keys are rejected automatically

Avoid `Record<string, unknown>` for public provider options unless the provider
has a deliberately documented free-form field.

## Registry-driven provider IDs

Provider IDs should come from the provider registry, not from a manually
maintained list.

Target:

```ts
export const PROVIDERS = defineProviders({
  claude,
  cloudflare,
  codex,
  exa,
  ollama,
  // ...
} as const);

export type ProviderId = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
```

Adding a provider should not require editing a separate `PROVIDER_IDS` array.

## Registry-driven config parsing

The large provider switch in `src/config.ts` should go away.

Instead of:

```ts
switch (providerId) {
  case "exa":
    return parseProviderWithShape(...);
  case "ollama":
    return parseProviderWithShape(...);
}
```

use the provider registry:

```ts
const definition = PROVIDERS[providerId];
return parseProviderConfig(definition, raw);
```

Provider definitions should declare:

- common config fields such as `apiKey`, `baseUrl`, `env`, and `settings`
- capability option schemas
- config defaults/templates
- setup-state logic when needed

Adding a provider should not require editing `src/config.ts`.

## Colocate config UI fields with providers

`src/provider-config-manifests.ts` is another manual wiring point. Move config
UI fields into provider definitions:

```ts
config: {
  template: { apiKey: "OLLAMA_API_KEY" },
  fields: [
    apiKeyField({ env: "OLLAMA_API_KEY" }),
    baseUrlField(),
  ],
}
```

The `/web-providers` UI can render these fields from the registry.

The manifest may remain internally, but it should be derived from provider
definitions instead of maintained separately.

## Execution policy cleanup

Once runtime options are gone, `provider-runtime.ts` should simplify.

Current shape:

```ts
executeProviderRequest(provider, config, request, runtimeOptions, context);
```

Target shape:

```ts
executeProviderRequest(provider, config, request, context);
```

Execution policy comes only from resolved config:

```ts
const policy = resolveExecutionPolicy(config.settings);
```

Remove:

- `parseLocalExecutionOptions`
- `validateRuntimeOptions`
- runtime option plumbing through `src/index.ts`
- `stripLocalExecutionOptions`
- defensive stripping in provider files

This removes a whole category of hidden behavior.

## Search prefetch becomes config-only

The model should not decide whether the local runtime prefetches content.

Current model-call shape:

```json
{
  "options": {
    "runtime": {
      "prefetch": {
        "provider": "exa",
        "maxUrls": 3
      }
    }
  }
}
```

Target config-only shape:

```json
{
  "settings": {
    "search": {
      "provider": "exa",
      "maxUrls": 3,
      "ttlMs": 600000
    }
  }
}
```

## Incremental implementation plan

### Phase 1: Remove model-facing runtime options

Goal: simplify tool schemas without changing the whole provider model yet.

This is a hard refactor. Do not keep backward-compatible tool-call shapes,
`prepareArguments` shims, or legacy aliases for `options.provider` and
`options.runtime`. Stale sessions that contain old tool calls may fail schema
validation and should be restarted.

Changes:

- Remove `options.runtime` from public tool schemas.
- Change tool-call options from `options.provider` to `options`.
- Keep execution settings in config only.
- Move prefetch to config-only behavior.
- Remove runtime option plumbing from:
  - `src/options.ts`
  - `src/index.ts`
  - `src/provider-runtime.ts`
  - `src/prefetch-manager.ts`
  - provider files that call `stripLocalExecutionOptions`

Acceptance criteria:

- No tool schema contains `runtime`.
- No provider receives execution-control keys as call options.
- Existing config-level timeout/retry behavior still works.
- Search prefetch still works from config.
- Provider-specific options are still visible in the static schema.
- Legacy `options.provider` and `options.runtime` inputs are rejected instead of
  translated.

### Phase 2: Make tool registration provider-bound

Goal: the model sees exactly the schema for the configured provider.

Changes:

- Do not register broad or generic managed tools before config is loaded.
- On startup/config refresh:
  - load config
  - resolve the configured provider for each capability
  - register the tool with that provider's schema
- Remove multi-provider schema fallback for active tools.
- Make provider-specific limits visible in schemas:
  - Ollama `maxResults.maximum = 10`
  - Serper `maxResults.maximum = 20`
  - default remains global max where the provider has no tighter limit

Acceptance criteria:

- With `tools.search = "ollama"`, `web_search` has no `options`.
- With `tools.search = "exa"`, `web_search.options` is Exa's schema.
- The model never sees options for unconfigured providers.
- Changing `/web-providers` re-registers schemas before the next call.

### Phase 3: Introduce `defineProvider`

Goal: create the single abstraction without migrating every provider at once.

Add:

- `defineProvider()`
- `defineCapability()`
- `ProviderDefinition`
- `ProviderRegistry`

Initially, wrap existing adapters so behavior stays stable.

Acceptance criteria:

- New providers can be authored using the new shape.
- Existing providers continue to work through a compatibility wrapper.
- Registry derives provider IDs and supported tools.

### Phase 4: Move config parsing to provider definitions

Goal: remove the provider switch in `src/config.ts`.

Changes:

- Provider definitions declare config fields.
- Core parser validates common and provider-specific fields from registry.
- Capability option config uses the same schema as tool-call options.

Acceptance criteria:

- Adding a provider does not require editing `src/config.ts`.
- Unknown provider config keys are rejected.
- Unknown provider option keys are rejected by schema.

### Phase 5: Move UI manifests into provider definitions

Goal: remove separate manifest wiring.

Changes:

- Provider config fields define UI labels, help, and secret handling.
- `/web-providers` renders fields from the registry.
- Delete or shrink `src/provider-config-manifests.ts`.

Acceptance criteria:

- Adding an API-key provider needs only `apiKeyField({ env: "FOO_API_KEY" })`.
- No provider-specific UI code is required unless the provider has genuinely
  special config.

### Phase 6: Migrate providers one group at a time

Recommended migration order:

1. Simple REST/search providers:
   - Ollama
   - Serper
   - Exa search path
2. Search + contents providers:
   - Linkup
   - Firecrawl
   - Tavily
   - Parallel
3. Answer/research providers:
   - OpenAI
   - Gemini
   - Perplexity
   - Valyu
4. Special providers:
   - Claude
   - Codex
   - Cloudflare
   - Custom

Each migration should reduce legacy adapter surface instead of adding parallel
complexity.

## End-state new provider checklist

Adding a provider should require:

1. Add one provider file, for example:

   ```ts
   src / providers / foo.ts;
   ```

2. Define:
   - config fields
   - capability schemas
   - capability handlers

3. Add one registry entry:

   ```ts
   foo,
   ```

4. Add README, changelog, and tests.

It should not require touching:

- `src/types.ts`
- `src/config.ts`
- `src/options.ts`
- `src/provider-runtime.ts`
- `src/provider-resolution.ts`
- `src/provider-tools.ts`
- `src/provider-config-manifests.ts`

## Invariants

- No hidden pass-through provider options.
- No `Record<string, unknown>` for public provider options unless deliberately
  documented.
- No model-facing runtime controls.
- No generic provider schemas when config selects one provider.
- Provider option schemas use `additionalProperties: false`.
- Config defaults and tool-call options use the same schema.
- Provider handlers receive typed, validated inputs.
- Core owns batching, retries, timeouts, progress, caching, truncation, and
  rendering.
- Providers only map normalized pi inputs to native API calls and normalize
  native responses back.
