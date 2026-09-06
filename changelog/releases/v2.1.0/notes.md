The extension now supports Linkup as a provider for web_search and web_contents, letting you route both tools to Linkup with a single API key. This adds a straightforward option for standard web search and Markdown page extraction alongside existing providers.

## 🚀 Features

### Linkup provider for web search and contents

The extension now supports Linkup as a provider for `web_search` and `web_contents`.

You can route both tools to Linkup with `LINKUP_API_KEY`:

```json
{
  "tools": {
    "search": "linkup",
    "contents": "linkup"
  },
  "providers": {
    "linkup": {
      "apiKey": "LINKUP_API_KEY"
    }
  }
}
```

This adds a simple option for standard web search plus markdown page extraction.

*By @mavam.*
