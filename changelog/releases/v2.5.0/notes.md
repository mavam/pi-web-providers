This release adds Ollama as a provider for web search and page fetching, giving pi another API-backed option for search-plus-content workflows. It also makes provider behavior more predictable by aligning tool options, timeout and retry settings, and prefetch behavior with saved extension settings.

## 🚀 Features

### Ollama provider for web search and contents

Ollama can now power `web_search` and `web_contents` through its Web Search and Web Fetch APIs:

```json
{
  "tools": {
    "search": "ollama",
    "contents": "ollama"
  },
  "providers": {
    "ollama": {
      "apiKey": "OLLAMA_API_KEY"
    }
  }
}
```

This gives users another API-backed option for search-plus-page-fetch workflows, including installations that already use Ollama Cloud credentials.

*By @mcowger in #16.*

## 🔧 Changes

### More predictable web provider behavior

Web interactions now follow the provider selected in your saved extension settings more closely.

The available web tool settings are tailored to the configured provider, so pi no longer offers irrelevant options for providers you aren't using. Provider-specific limits are also reflected more accurately, such as Ollama's smaller search result limit.

Timeout, retry, and background content prefetch behavior now comes from the saved extension settings. This makes web search and page-reading behavior more predictable across sessions because these operational preferences no longer vary from one generated request to the next.

Most users don't need to change their configuration. If you experimented with per-request timeout, retry, or prefetch overrides, move those preferences into the saved extension settings instead:

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

*By @mavam.*

## 🐞 Bug fixes

### Codex web_search schema validation

The Codex provider's `web_search` tool now works with Codex response schema validation. Previously, searches could fail immediately with an `invalid_json_schema` error before returning any results.

*By @dzonatan in #15.*

### Stable web provider settings view

The `/web-providers` settings screen now stays open when a configured provider secret command fails and shows effective defaults for unset execution settings.

Previously, a missing command-backed secret such as a keychain lookup could crash the settings screen, and configurations that only set search preferences could display `undefined` for timeout and retry settings. The screen now reports the affected provider as misconfigured and shows the default timeout and retry values instead.

For example, this configuration now displays the default request timeout, retry count, retry delay, and research timeout in `/web-providers`:

```json
{
  "settings": {
    "search": {
      "provider": "exa"
    }
  }
}
```

*By @mavam and @codex in #17.*
