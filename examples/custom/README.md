# Custom provider example

`provider.mjs` implements all four capabilities without network access. Run the
example from the repository root using the included `webfox.json`:

```sh
web search "example query" --config examples/custom/webfox.json
web contents https://example.com --config examples/custom/webfox.json --format json
```

The configuration defines explicit custom commands and saved defaults. In your
own setup, use absolute command paths or set the command’s `cwd`.

## Process contract

Each invocation receives one JSON request on stdin, writes one JSON object to
stdout, and sends newline-delimited progress to stderr. A nonzero exit signals
failure. The runtime bounds process output and terminates the process group on
cancellation or timeout (the direct child on Windows).

```json
{
  "schemaVersion": 1,
  "capability": "search",
  "input": { "query": "example", "maxResults": 5 },
  "options": {},
  "cwd": "/working/directory"
}
```

Payloads and responses:

| Capability | Input | Response |
| --- | --- | --- |
| Search | `{ "query": "...", "maxResults": 5 }` | `{ "results": [{ "title": "...", "url": "https://...", "snippet": "..." }] }` |
| Contents | `{ "urls": ["https://..."] }` | `{ "answers": [{ "inputIndex": 0, "url": "https://...", "content": "..." }] }` |
| Answer | `{ "query": "..." }` | `{ "text": "..." }` |
| Research | `{ "input": "..." }` | `{ "text": "..." }` |

Contents answers must cover every request index exactly once. `inputIndex`
associates a response with the requested URL; `url` can hold a redirected URL.
A failed page uses a structured error instead of content:

```json
{
  "inputIndex": 0,
  "url": "https://example.com",
  "error": { "code": "PROVIDER_FAILURE", "message": "Extraction failed." }
}
```

The runtime currently schedules one URL per invocation. Treat indices as local
to the supplied request, not the entire user batch.

Replace the deterministic branches with your own integrations. Credentials for
child processes go in the command’s `env` map as `{ "env": "NAME" }`,
`{ "command": ["program", "arg"] }`, or `{ "value": "..." }` sources.
