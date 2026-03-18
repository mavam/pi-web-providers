#!/usr/bin/env bash
set -euo pipefail

request="$(cat)"
cwd="$(jq -r '.cwd // "."' <<<"$request")"
query="$(jq -r '.query' <<<"$request")"
model="$(jq -r '.options.model // empty' <<<"$request")"

schema='{"type":"object","properties":{"text":{"type":"string"},"summary":{"type":"string"},"itemCount":{"type":"integer"},"metadata":{"type":"object"}},"required":["text","summary","itemCount","metadata"],"additionalProperties":false}'
prompt="$(
  cat <<EOF
Answer this question using current public web information:
$query

Return JSON only with these fields:
- text: the full grounded answer
- summary: a one-sentence summary
- itemCount: use 1
- metadata: include a short note such as the task type

Use WebSearch and WebFetch when needed.
EOF
)"

args=(
  -p
  --output-format json
  --json-schema "$schema"
  --permission-mode dontAsk
  --allowedTools "WebSearch,WebFetch"
  --no-session-persistence
)

if [[ -n "$model" ]]; then
  args+=(--model "$model")
fi

echo "Answering with Claude..." >&2
(
  cd "$cwd"
  claude "${args[@]}" "$prompt"
)
