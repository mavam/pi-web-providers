# Custom provider example

`provider.mjs` implements all four custom-provider capabilities using the `schemaVersion: 1` process contract. It reads exactly one JSON request from stdin, writes diagnostics to stderr, and writes exactly one JSON result to stdout.

Configure it from the repository root:

```json
{
  "defaults": {
    "search": { "provider": "custom" }
  },
  "providers": {
    "custom": {
      "commands": {
        "search": { "argv": ["node", "./examples/custom/provider.mjs"] },
        "contents": { "argv": ["node", "./examples/custom/provider.mjs"] },
        "answer": { "argv": ["node", "./examples/custom/provider.mjs"] },
        "research": { "argv": ["node", "./examples/custom/provider.mjs"] }
      }
    }
  }
}
```

The example is deterministic and performs no network calls. Replace its capability branches with calls to your own service.
