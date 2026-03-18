#!/usr/bin/env bash
set -euo pipefail

: "${PERPLEXITY_API_KEY:?PERPLEXITY_API_KEY is required}"

request="$(cat)"
input="$(jq -r '.input' <<<"$request")"
model="$(jq -r '.options.model // "sonar-deep-research"' <<<"$request")"

body="$(
  jq -n \
    --arg model "$model" \
    --arg input "$input" \
    '{
    model: $model,
    stream: false,
    messages: [{role: "user", content: $input}]
  }'
)"

echo "Researching with Perplexity..." >&2
response="$(curl -sS https://api.perplexity.ai/chat/completions \
  -H "Authorization: Bearer ${PERPLEXITY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$body")"

error="$(jq -r '.error.message // empty' <<<"$response")"
if [[ -n "$error" ]]; then
  echo "$error" >&2
  exit 1
fi

citations="$(jq '.citations // []' <<<"$response")"
count="$(jq '(.citations // []) | length' <<<"$response")"
text="$(jq -r '
  (.choices[0].message.content // "No research returned.") as $text
  | (.citations // []) as $citations
  | if ($citations | length) == 0 then
      $text
    else
      $text + "\n\nSources:\n" + ($citations | to_entries | map("\(.key + 1). \(.value)") | join("\n"))
    end
' <<<"$response")"

jq -n \
  --arg text "$text" \
  --arg summary "Research via Perplexity with $count source(s)" \
  --argjson itemCount "$count" \
  --argjson citations "$citations" \
  '{
    text: $text,
    summary: $summary,
    itemCount: $itemCount,
    metadata: {citations: $citations}
  }'
