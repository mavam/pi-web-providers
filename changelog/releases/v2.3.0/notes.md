This release adds an OpenAI provider for web_search, web_answer, and web_research, including pi managed async research workflow. It gives you an API-key-based alternative to Codex when you want grounded answers and longer research runs without depending on a local Codex installation.

## 🚀 Features

### OpenAI provider for web search, answers, and research

You can now route `web_search`, `web_answer`, and `web_research` through OpenAI with an `OPENAI_API_KEY`, including longer async research runs through pi's managed research workflow.

```json
{
  "tools": {
    "search": "openai",
    "answer": "openai",
    "research": "openai"
  },
  "providers": {
    "openai": {
      "apiKey": "OPENAI_API_KEY"
    }
  }
}
```

This gives you an API-key-based OpenAI option alongside Codex. Codex is still useful when you want to reuse local Codex CLI auth for `web_search`, while OpenAI covers a broader set of web tools and is a better fit when you want grounded answers or research reports from the OpenAI API without depending on a local Codex installation.

*By @mavam and @codex.*
