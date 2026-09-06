Managed tools now advertise explicit provider-specific option schemas, and provider options are scoped strictly to their respective capabilities.

## 🚀 Features

### Structured tool options with explicit provider schemas

Each managed tool (`web_search`, `web_contents`, `web_answer`, `web_research`) now advertises the exact provider-specific options available for the configured provider directly in the tool schema. This means the agent can discover supported knobs—such as Tavily's `searchDepth` and `country`, Exa's `category` and `userLocation`, or Gemini's `model` and `generation_config`—without relying on documentation or guesswork.

In practice, the agent is more likely to take advantage of provider features like domain filtering, search depth, or location hints when they would improve the quality of results for your query.

*By @mavam and @codex.*

## 🐞 Bug fixes

### Scope provider options by capability

Provider options are now scoped strictly to the managed tool that uses them. This fixes cases where search-only defaults or schema fields could appear to bleed into other tools, such as Exa `web_search` options showing up alongside `web_contents`.

As part of this cleanup, providers with capability-specific defaults now store them under capability-specific configuration blocks, and tools without per-call provider options no longer expose an empty `options.provider` object.

*By @mavam and @codex.*
