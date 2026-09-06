---
title: Webfox 4.0
type: breaking
authors:
  - mavam
prs:
  - 37
created: 2026-08-02 15:12:01.952462+00:00
---

Webfox provides one toolkit for searching the web, extracting pages, getting
grounded answers, and running research. Use it through the `webfox` CLI, a
TypeScript library, or pi—all sharing the same provider configuration.

Use a provider directly with its standard environment credentials, then save a
capability default when you want to reuse that choice:

```sh
webfox search "Node.js release notes" --provider brave
webfox config default search brave
webfox search "TypeBox validation"
```

Credentials never select providers. Advanced JSON configuration keeps provider
options under `providers.<id>.options.<capability>`; capability defaults contain
only provider selection and portable settings. Configuration uses `WEBFOX_CONFIG`
or the platform's `webfox/config.json` configuration path.

Install the pi extension with `pi install npm:webfox`. Its tools are
`web_search`, `web_contents`, `web_answer`, and `web_research`, with generic
labels such as “Web Search.”

The library exposes `createWebfox()` with execution and inspection methods,
`WebfoxConfig` and `WebfoxClient` types, and `setCapabilityDefault()` for saving a
choice.
