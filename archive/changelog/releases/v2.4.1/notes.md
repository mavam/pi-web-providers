This release restores compatibility with pi 0.69 and later by updating provider schemas and session lifecycle hooks for the current extension APIs. Installed web provider packages now load correctly after the pi TypeBox and session event updates.

## 🐞 Bug fixes

### Compatibility with pi 0.69

The extension now loads correctly with pi 0.69 and later.

Provider tool schemas and session lifecycle hooks now use the current pi extension APIs, so installed web provider packages keep working after pi’s TypeBox and session event updates.

*By @mavam and @codex.*
