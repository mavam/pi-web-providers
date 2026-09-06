This release makes web research manageable from an interactive browser that shows active and finished researches, supports cancellation, and lets users reopen, copy, or inject completed reports. It also restores Gemini-powered research and grounded answers with the current Gemini steps schema.

## 🚀 Features

### Interactive web research browser

The `/web-research` command now opens an interactive research browser: a table of running and finished researches showing status, date, provider, duration, and title.

```text
/web-research
```

- Running researches appear at the top with a live spinner and elapsed time. Press `c` twice to cancel one; cancelled researches are recorded as durable `cancelled` reports instead of appearing as failures.
- Press `Enter` on a finished research to read the full report in a scrollable Markdown overlay.
- From the report view, press `c` to copy the report as Markdown to the clipboard, or `i` to inject the report into the current conversation so the agent can build on earlier research without re-running it.

While researches run, the indicator above the editor is now a single summary line with the number of active researches and their status and elapsed time, instead of a multi-line job list.

*By @mavam and @claude in #22.*

## 🐞 Bug fixes

### Gemini research compatibility with the steps schema

Gemini-powered `web_research`, `web_search`, and answer grounding work again with the current Gemini API. Google retired the legacy Interactions API schema in May 2026, which made Gemini research fail at dispatch:

```text
400 The legacy Interactions API schema is no longer supported.
```

The extension now uses `@google/genai` 2.x and reads interaction results through the new `steps` schema. No configuration changes are required; existing Gemini provider settings keep working.

*By @mavam and @claude in #22.*
