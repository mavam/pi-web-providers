#!/usr/bin/env bash
set -euo pipefail

: "${GOOGLE_API_KEY:?GOOGLE_API_KEY is required}"

request="$(cat)"
model="$(jq -r '.options.model // "gemini-2.5-flash"' <<<"$request")"
url_count="$(jq '.urls | length' <<<"$request")"
urls="$(jq -r '.urls[]' <<<"$request")"

prompt="$(
  cat <<EOF
Extract the main textual content from these URLs:
$urls

Return JSON only with this shape:
- answers: an array with exactly $url_count items
- each answer must include the input url, and either:
  - content: the extracted text as a string
  - or error: a short error string when extraction fails
- optionally include summary and metadata
EOF
)"

body="$(
  jq -n \
    --arg prompt "$prompt" \
    '{
    contents: [{parts: [{text: $prompt}]}],
    tools: [{urlContext: {}}],
    generationConfig: {responseMimeType: "application/json"}
  }'
)"

echo "Fetching contents with Gemini..." >&2
response="$(curl -sS -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$body")"

error="$(jq -r '.error.message // empty' <<<"$response")"
if [[ -n "$error" ]]; then
  echo "$error" >&2
  exit 1
fi

text="$(jq -r '[.candidates[]?.content.parts[]?.text // empty] | join("\n")' <<<"$response")"
json_text="$(printf '%s\n' "$text" | sed -e '1s/^```json[[:space:]]*//' -e '1s/^```[[:space:]]*//' -e '$s/```$//')"
jq . <<<"$json_text"
