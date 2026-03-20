Firecrawl is now available as a built-in provider for `web_search` and `web_contents`, adding Firecrawl-backed search plus markdown-first page extraction through the existing per-tool provider routing model.

## 🚀 Features

### Firecrawl provider for search and contents

`pi-web-providers` now supports Firecrawl as a built-in provider for `web_search` and `web_contents`.

The Firecrawl adapter uses Firecrawl's Node SDK for direct web search, single-page scraping, and batch page extraction. It integrates with the existing provider routing, `/web-providers` settings UI, search-prefetch flow, and example config.

This makes it easy to route search and content extraction through Firecrawl while keeping answers and research on other providers when needed.

*By @mavam and @codex.*
