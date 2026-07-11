#!/usr/bin/env bash
# Shared helpers for qortium-casino Previewnet scripts.
# Node: local Previewnet core (default port 24891). Signing happens on the local
# node via /transactions/sign — pass the signer's private key in env, never store it.
set -euo pipefail

NODE="${CASINO_NODE:-http://localhost:24891}"
# The RUNNING node's key (Home-launched node lives under ~/.config/qortium-core),
# not the repo's preview/ copy — gated endpoints reject the stale repo key.
APIKEY_FILE="${CASINO_APIKEY_FILE:-$HOME/.config/qortium-core/runtime/apikey.txt}"
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

# Compute the MemPoW fee-alternative nonce (Previewnet has no native coin yet, so
# txs carry fee=0 + nonce), sign with $SIGNER_PRIVATE_KEY, then broadcast.
mempow_sign_and_process() { # mempow_sign_and_process UNSIGNED_BASE58
  local unsigned="$1"
  [ -n "${SIGNER_PRIVATE_KEY:-}" ] || { echo "SIGNER_PRIVATE_KEY not set" >&2; exit 1; }
  local with_nonce signed
  echo "computing mempow nonce..." >&2
  with_nonce=$(curl -sS -X POST "$NODE/transactions/mempow/compute" \
    -H "X-API-KEY: $APIKEY" -H "Content-Type: text/plain" -d "$unsigned")
  echo "nonce done: ${with_nonce:0:50}..." >&2
  signed=$(api POST /transactions/sign \
    "{\"privateKey\":\"$SIGNER_PRIVATE_KEY\",\"transactionBytes\":\"$with_nonce\"}")
  echo "signed tx: ${signed:0:50}..." >&2
  api POST /transactions/process "$signed"
}
