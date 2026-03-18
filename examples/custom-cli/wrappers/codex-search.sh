#!/usr/bin/env bash
set -euo pipefail

request="$(cat)"
cwd="$(jq -r '.cwd // "."' <<<"$request")"
query="$(jq -r '.query' <<<"$request")"
max_results="$(jq -r '.maxResults // 5' <<<"$request")"
model="$(jq -r '.options.model // empty' <<<"$request")"

schema_file="$(mktemp)"
output_file="$(mktemp)"
trap 'rm -f "$schema_file" "$output_file"' EXIT

cat >"$schema_file" <<'JSON'
{
  "type": "object",
  "properties": {
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "url": { "type": "string" },
          "snippet": { "type": "string" }
        },
        "required": ["title", "url", "snippet"],
        "additionalProperties": false
      }
    }
  },
  "required": ["results"],
  "additionalProperties": false
}
JSON

prompt="$(
  cat <<EOF
Search the public web for: $query

Return JSON only.
Return at most $max_results results.
Each result must include:
- title
- url
- snippet

Prefer primary or official sources when possible.
EOF
)"

args=(
  --search exec
  --skip-git-repo-check
  --sandbox read-only
  --color never
  --cd "$cwd"
  --output-schema "$schema_file"
  --output-last-message "$output_file"
)

if [[ -n "$model" ]]; then
  args+=(--model "$model")
fi

echo "Searching with Codex..." >&2
codex "${args[@]}" "$prompt" >/dev/null
jq . "$output_file"
