# Custom wrapper examples

These examples keep the wrapper logic small. They are bash scripts that use
`jq` for JSON handling. Each wrapper uses a different backend pattern:

- `wrappers/codex-search.sh` — `codex --search exec`
- `wrappers/gemini-contents.sh` — Gemini API via `curl`
- `wrappers/claude-answer.sh` — `claude -p`
- `wrappers/perplexity-research.sh` — Perplexity API via `curl`

Each wrapper:

- reads one JSON request from `stdin`
- writes one JSON response to `stdout`
- may write progress text to `stderr`

## Requirements

You need:

- `bash`
- `jq`
- `curl`
- `codex` on your `PATH` and authenticated locally
- `claude` on your `PATH` and authenticated locally
- `GOOGLE_API_KEY` for the Gemini example
- `PERPLEXITY_API_KEY` for the Perplexity example

## Copy the wrappers into your project

```bash
mkdir -p ./wrappers
cp examples/custom/wrappers/codex-search.sh ./wrappers/
cp examples/custom/wrappers/gemini-contents.sh ./wrappers/
cp examples/custom/wrappers/claude-answer.sh ./wrappers/
cp examples/custom/wrappers/perplexity-research.sh ./wrappers/
chmod +x ./wrappers/*.sh
```

Then configure `custom` like this:

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
      "enabled": true,
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

`web_research` runs as a foreground wrapper command, so polling controls and
`resumeId` do not apply to `custom`.

## Core command shapes

### Search with Codex

```bash
codex --search exec \
  --skip-git-repo-check \
  --sandbox read-only \
  --output-schema ./schema.json \
  "Search the public web and return JSON only"
```

### Contents with Gemini and `curl`

```bash
curl -sS -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$GOOGLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "Extract the main content from https://example.com and return JSON only"}]}],
    "tools": [{"urlContext": {}}],
    "generationConfig": {"responseMimeType": "application/json"}
  }'
```

### Answers with Claude

```bash
claude -p \
  --output-format json \
  --json-schema "$schema" \
  --permission-mode dontAsk \
  --allowedTools "WebSearch,WebFetch" \
  "Answer this question using current public web information"
```

### Research with Perplexity and `curl`

```bash
curl -sS https://api.perplexity.ai/chat/completions \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sonar-deep-research",
    "stream": false,
    "messages": [{"role": "user", "content": "Research this topic and return a long-form answer"}]
  }'
```

## Try a wrapper directly

### Search

```bash
printf '%s' '{
  "capability": "search",
  "query": "latest Codex CLI release notes",
  "maxResults": 5,
  "options": {},
  "cwd": "'"$PWD"'"
}' | bash examples/custom/wrappers/codex-search.sh
```

### Contents

```bash
printf '%s' '{
  "capability": "contents",
  "urls": ["https://example.com"],
  "options": {},
  "cwd": "'"$PWD"'"
}' | bash examples/custom/wrappers/gemini-contents.sh
```

### Answer

```bash
printf '%s' '{
  "capability": "answer",
  "query": "What changed in the latest Claude Code release?",
  "options": {},
  "cwd": "'"$PWD"'"
}' | bash examples/custom/wrappers/claude-answer.sh
```

### Research

```bash
printf '%s' '{
  "capability": "research",
  "input": "Compare current local agent CLIs for web-grounded tasks.",
  "options": {},
  "cwd": "'"$PWD"'"
}' | bash examples/custom/wrappers/perplexity-research.sh
```

## Request and response contract

### Search request

```json
{
  "capability": "search",
  "query": "latest Codex CLI release notes",
  "maxResults": 5,
  "options": {},
  "cwd": "/path/to/project"
}
```

### Search response

```json
{
  "results": [
    {
      "title": "Codex CLI docs",
      "url": "https://github.com/openai/codex",
      "snippet": "CLI docs, examples, and release information."
    }
  ]
}
```

### Contents response

```json
{
  "answers": [
    {
      "url": "https://example.com",
      "content": "# Example\n\nMain page content",
      "summary": "Optional short summary",
      "metadata": {}
    }
  ]
}
```

### Answer and research response

```json
{
  "text": "Rendered tool output",
  "summary": "Optional short summary",
  "itemCount": 1,
  "metadata": {}
}
```
