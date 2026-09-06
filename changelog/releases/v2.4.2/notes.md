This release makes Gemini-powered web research start reliably in the default pi workflow and improves the completion summary for saved reports. It also clarifies the expand hint for collapsed research details.

## 🐞 Bug fixes

### Clearer web research file marker

Web research result summaries now use a less visually distracting marker for the saved report path. The file location remains visible after a research job completes, but no longer appears with an arrow that suggests an expandable disclosure control.

*By @mavam.*

### Reliable Gemini web research

Gemini-powered `web_research` requests now start reliably with the default pi workflow. Previously, pi could generate Gemini-specific options that made the request fail before research started.

Collapsed research results also show the correct `ctrl+o to expand` hint when expanded details are available.

*By @mavam and @codex.*
