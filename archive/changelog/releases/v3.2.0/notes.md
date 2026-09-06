Linkup can now power web research in addition to search and contents, giving users a single Linkup-backed provider for sourced investigations. The release adds structured answer modes and investigation controls such as reasoning depth, domains, and date filters.

## 🚀 Features

### Linkup research provider support

Linkup can now power the `web_research` tool in addition to `web_search` and `web_contents`.

Example configuration:

```json
{
  "tools": {
    "research": "linkup"
  },
  "providers": {
    "linkup": {
      "credentials": {
        "api": "LINKUP_API_KEY"
      }
    }
  }
}
```

Research calls support Linkup's sourced-answer and structured output modes, plus mode, reasoning-depth, domain, and date filters for controlling the investigation.

*By @mavam and @codex in #30.*
