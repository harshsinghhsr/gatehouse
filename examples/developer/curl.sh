#!/usr/bin/env bash
# The gateway with nothing but curl — no SDK, no language runtime.
#
#     GATEHOUSE_KEY=sk-... ./developer/curl.sh
#
# This is an ordinary OpenAI chat-completions request. Nothing about it is Gatehouse-shaped:
# any client that can reach api.openai.com can reach the gateway by changing two things.
set -euo pipefail

: "${GATEHOUSE_KEY:?Set GATEHOUSE_KEY to a gateway key (an operator mints one with operator/onboard-developer.ts)}"
BASE_URL="${GATEHOUSE_OPENAI_URL:-http://localhost:4000/v1}"
MODEL="${GATEHOUSE_MODEL:-gpt-4o}"

# --dump-header keeps x-litellm-response-cost visible: that number is what the gateway charged
# this call, and it is what shows up as the developer's spend in operator/read-spend.ts.
curl --silent --show-error --fail-with-body \
  "$BASE_URL/chat/completions" \
  --header "Authorization: Bearer $GATEHOUSE_KEY" \
  --header 'Content-Type: application/json' \
  --data "$(printf '{"model":"%s","messages":[{"role":"user","content":"Say hello from the gateway."}]}' "$MODEL")" \
  --dump-header /dev/stdout \
  | grep -iE '^(HTTP/|x-litellm-response-cost|x-litellm-model-id)|^\{'
