#!/usr/bin/env bash
# 2. Call the gateway with that key, using nothing but curl.
#
#     ./2-call-gateway.sh
#
# The point: this is a bog-standard OpenAI chat-completions request. Nothing about it is
# Gatehouse-shaped. Any client that can talk to api.openai.com can talk to the gateway by
# changing the base URL and the key — which is the whole product.
set -euo pipefail
cd "$(dirname "$0")"

BASE_URL="${GATEHOUSE_GATEWAY_URL:-http://localhost:4000/v1}"
MODEL="${GATEHOUSE_MODEL:-gpt-4o}"

case "$BASE_URL" in
  http://localhost:*|http://127.0.0.1:*) ;;
  *) echo "Refusing to run against $BASE_URL: these examples are localhost only." >&2; exit 1 ;;
esac

if [ ! -f .gatehouse-key ]; then
  echo "No key on disk. Run 'node 1-issue-key.mjs' first." >&2
  exit 1
fi
# The file holds "<key id> <developer id> <plaintext>"; only the third field is the secret.
# Reading it into a variable keeps it out of the shell history and every process list but curl's.
KEY="$(cut -d' ' -f3 .gatehouse-key)"

echo "POST $BASE_URL/chat/completions  (model: $MODEL)"
curl --silent --show-error --fail-with-body \
  "$BASE_URL/chat/completions" \
  --header "Authorization: Bearer $KEY" \
  --header 'Content-Type: application/json' \
  --data "$(printf '{"model":"%s","messages":[{"role":"user","content":"Say hello from the gateway."}]}' "$MODEL")" \
  --dump-header /dev/stdout \
  | grep -iE '^(HTTP/|x-litellm-response-cost|x-litellm-model-id)|^\{'

echo
echo "The x-litellm-response-cost header is what the gateway charged this call."
echo "That number is what shows up as this developer's spend in example 5."
