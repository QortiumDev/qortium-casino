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
    curl --fail-with-body -sS -X "$method" "$NODE$path" -H "X-API-KEY: $APIKEY" \
      -H "Content-Type: application/json" -d "$body"
  else
    curl --fail-with-body -sS -X "$method" "$NODE$path" -H "X-API-KEY: $APIKEY"
  fi
}

# Read whose "absent" answer is an application error carried by an HTTP error
# status: Core answers GET /assets/info for an unknown asset with 400
# {"error":601}. Plain api() is strict by design and aborts there, which would
# make every first-time deployment fail before it could issue the asset. This
# keeps that strictness for transport failures while returning the error body so
# the caller's own three-way branch decides what the body means. Never use it for
# a call whose failure must stop the script outright.
api_read_or_error() { # api_read_or_error METHOD PATH
  local method="$1" path="$2" body status=0
  # `|| status=$?` keeps this a compound command, so errexit neither aborts here
  # nor has to be toggled: touching set -e would clobber the caller's own state.
  body=$(api "$method" "$path" 2>/dev/null) || status=$?

  # --fail-with-body prints the body and exits 22 for any HTTP >= 400; every
  # other nonzero status is a transport/DNS/connection failure with no body.
  if [ "$status" -ne 0 ] && [ "$status" -ne 22 ]; then
    echo "Node read $method $path failed to reach $NODE (curl exit $status)" >&2
    return 1
  fi

  printf '%s\n' "$body"
}

assert_base58() { # assert_base58 VALUE LABEL
  local value="$1" label="${2:-value}"
  [[ "$value" =~ ^[1-9A-HJ-NP-Za-km-z]+$ ]] || {
    echo "$label was not valid base58; refusing to continue" >&2
    return 1
  }
}

transaction_json_field() { # transaction_json_field JSON FIELD
  local json="$1" field="$2"
  python3 -c '
import json, sys
try:
    value = json.loads(sys.argv[1])[sys.argv[2]]
except (json.JSONDecodeError, KeyError, TypeError):
    raise SystemExit(1)
if value is None or isinstance(value, (dict, list)):
    raise SystemExit(1)
if isinstance(value, bool):
    print(str(value).lower())
else:
    print(value)
' "$json" "$field"
}

transaction_assert_process_result() { # transaction_assert_process_result JSON EXPECTED_TYPE
  local json="$1" expected_type="$2"
  python3 -c '
import json, sys
try:
    response = json.loads(sys.argv[1])
except json.JSONDecodeError:
    print("transaction processing did not return API v2 JSON", file=sys.stderr)
    raise SystemExit(1)
if not isinstance(response, dict):
    print("transaction processing returned a non-object response", file=sys.stderr)
    raise SystemExit(1)
if "error" in response:
    print(
        "transaction processing returned Core error "
        + str(response.get("error"))
        + ": "
        + str(response.get("message", "unknown error")),
        file=sys.stderr,
    )
    raise SystemExit(1)
if response.get("type") != sys.argv[2]:
    print(
        "transaction processing returned type "
        + str(response.get("type"))
        + ", expected "
        + sys.argv[2],
        file=sys.stderr,
    )
    raise SystemExit(1)
signature = response.get("signature")
if not isinstance(signature, str) or not signature:
    print("transaction processing returned no signature", file=sys.stderr)
    raise SystemExit(1)
' "$json" "$expected_type"
}

# Compute the MemPoW fee-alternative nonce (Previewnet has no native coin yet, so
# txs carry fee=0 + nonce), sign with $SIGNER_PRIVATE_KEY, then broadcast. The
# API v2 response proves Core accepted the expected transaction type.
mempow_sign_and_process() { # mempow_sign_and_process UNSIGNED_BASE58 EXPECTED_TYPE
  local unsigned="$1" expected_type="$2"
  [ -n "${SIGNER_PRIVATE_KEY:-}" ] || { echo "SIGNER_PRIVATE_KEY not set" >&2; return 1; }
  [ -n "$expected_type" ] || { echo "expected transaction type not set" >&2; return 1; }
  assert_base58 "$unsigned" "unsigned transaction" || return

  local with_nonce signed process_result
  echo "computing mempow nonce..." >&2
  with_nonce=$(curl --fail-with-body -sS -X POST "$NODE/transactions/mempow/compute" \
    -H "X-API-KEY: $APIKEY" -H "Content-Type: text/plain" -d "$unsigned") || return
  assert_base58 "$with_nonce" "MemPoW transaction" || return
  echo "nonce done: ${with_nonce:0:50}..." >&2
  signed=$(api POST /transactions/sign \
    "{\"privateKey\":\"$SIGNER_PRIVATE_KEY\",\"transactionBytes\":\"$with_nonce\"}") || return
  assert_base58 "$signed" "signed transaction" || return
  echo "signed tx: ${signed:0:50}..." >&2
  process_result=$(curl --fail-with-body -sS -X POST "$NODE/transactions/process" \
    -H "X-API-KEY: $APIKEY" -H "X-API-VERSION: 2" \
    -H "Content-Type: text/plain" -d "$signed") || return
  transaction_assert_process_result "$process_result" "$expected_type" || return
  printf '%s\n' "$process_result"
}
