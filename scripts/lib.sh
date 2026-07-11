#!/usr/bin/env bash
# Shared helpers for qortium-casino Previewnet scripts.
# Node: local Previewnet core (default port 24891). Signing happens on the local
# node via /transactions/sign — pass the signer's private key in env, never store it.
set -euo pipefail

NODE="${CASINO_NODE:-http://localhost:24891}"
APIKEY_FILE="${CASINO_APIKEY_FILE:-$HOME/qortium/git/qortium-core/preview/apikey.txt}"
APIKEY="${CASINO_APIKEY:-$(cat "$APIKEY_FILE")}"

api() { # api METHOD PATH [JSON_BODY]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" "$NODE$path" -H "X-API-KEY: $APIKEY" \
      -H "Content-Type: application/json" -d "$body"
  else
    curl -sS -X "$method" "$NODE$path" -H "X-API-KEY: $APIKEY"
  fi
}

# Sign an unsigned base58 tx with $SIGNER_PRIVATE_KEY, then broadcast it.
sign_and_process() { # sign_and_process UNSIGNED_BASE58
  local unsigned="$1"
  [ -n "${SIGNER_PRIVATE_KEY:-}" ] || { echo "SIGNER_PRIVATE_KEY not set" >&2; exit 1; }
  local signed
  signed=$(api POST /transactions/sign \
    "{\"privateKey\":\"$SIGNER_PRIVATE_KEY\",\"transactionBytes\":\"$unsigned\"}")
  echo "signed tx: ${signed:0:60}..." >&2
  api POST /transactions/process "$signed"
}
