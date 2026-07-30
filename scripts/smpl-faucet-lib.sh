#!/usr/bin/env bash
# Pure validation/request helpers for the SMPL Faucet V1 operator scripts.
# This file deliberately does not source lib.sh, read API keys, or sign anything,
# so its checks can be exercised offline.

SMPL_FEATURE_HEIGHT=70000
SMPL_MIN_CORE_VERSION=1.6.0
SMPL_ASSET_NAME=SMPL
SMPL_SUPPLY=1000
SMPL_AMOUNT_MULTIPLIER=100000000
SMPL_SUPPLY_RAW=100000000000

smpl_fail() {
  echo "SMPL faucet: $*" >&2
  return 1
}

smpl_json_field() { # smpl_json_field JSON field
  local json="$1" field="$2"
  python3 -c '
import json, sys
try:
    value = json.loads(sys.argv[1])[sys.argv[2]]
except (json.JSONDecodeError, KeyError, TypeError):
    raise SystemExit(1)
if value is True:
    print("true")
elif value is False:
    print("false")
elif value is None:
    print("null")
else:
    print(value)
' "$json" "$field"
}

smpl_version_at_least() { # smpl_version_at_least ACTUAL REQUIRED
  python3 -c '
import re, sys
def parse(value):
    # Core reports builds as, for example, qortium-1.6.0-6578cde.
    match = re.search(r"(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)", value)
    if not match:
        raise ValueError(value)
    return tuple(map(int, match.groups()))
try:
    raise SystemExit(0 if parse(sys.argv[1]) >= parse(sys.argv[2]) else 1)
except ValueError:
    raise SystemExit(2)
' "$1" "$2"
}

smpl_assert_node_ready() { # STATUS_JSON INFO_JSON HEIGHT
  local status_json="$1" info_json="$2" height="$3"
  local sync_phase synchronizing node_type version

  [[ "$height" =~ ^[0-9]+$ ]] || { smpl_fail "node returned an invalid chain height: $height"; return; }
  sync_phase=$(smpl_json_field "$status_json" syncPhase) || {
    smpl_fail "node status has no syncPhase; install Qortium Core $SMPL_MIN_CORE_VERSION or newer"; return;
  }
  synchronizing=$(smpl_json_field "$status_json" isSynchronizing) || {
    smpl_fail "node status has no isSynchronizing flag"; return;
  }
  node_type=$(smpl_json_field "$info_json" type) || {
    smpl_fail "node info has no node type"; return;
  }
  version=$(smpl_json_field "$info_json" buildVersion) || {
    smpl_fail "node info has no build version"; return;
  }

  [ "$node_type" = full ] || { smpl_fail "node type is $node_type; a fully synced full node is required"; return; }
  [ "$sync_phase" = SYNCED ] && [ "$synchronizing" = false ] || {
    smpl_fail "node is not fully synced (phase=$sync_phase, isSynchronizing=$synchronizing)"; return;
  }
  smpl_version_at_least "$version" "$SMPL_MIN_CORE_VERSION" || {
    smpl_fail "Core $version is too old or unparseable; require $SMPL_MIN_CORE_VERSION+ with AT map storage"; return;
  }
  [ "$height" -ge "$SMPL_FEATURE_HEIGHT" ] || {
    smpl_fail "chain height $height is before AT-map activation $SMPL_FEATURE_HEIGHT; refusing deployment"; return;
  }
}

smpl_assert_asset_info() { # JSON; prints dynamic asset ID on success
  local asset_json="$1"
  local asset_id name quantity divisible unspendable
  asset_id=$(smpl_json_field "$asset_json" assetId) || { smpl_fail "SMPL asset response has no assetId"; return; }
  name=$(smpl_json_field "$asset_json" name) || { smpl_fail "SMPL asset response has no name"; return; }
  quantity=$(smpl_json_field "$asset_json" quantity) || { smpl_fail "SMPL asset response has no quantity"; return; }
  divisible=$(smpl_json_field "$asset_json" isDivisible) || { smpl_fail "SMPL asset response has no isDivisible flag"; return; }
  unspendable=$(smpl_json_field "$asset_json" isUnspendable) || { smpl_fail "SMPL asset response has no isUnspendable flag"; return; }

  [[ "$asset_id" =~ ^[1-9][0-9]*$ ]] || { smpl_fail "invalid SMPL assetId: $asset_id"; return; }
  [ "$name" = "$SMPL_ASSET_NAME" ] || { smpl_fail "asset $asset_id is named $name, not $SMPL_ASSET_NAME"; return; }
  [ "$quantity" = "$SMPL_SUPPLY_RAW" ] || {
    smpl_fail "SMPL asset $asset_id has raw quantity $quantity, expected $SMPL_SUPPLY_RAW ($SMPL_SUPPLY SMPL)"; return;
  }
  [ "$divisible" = false ] || { smpl_fail "SMPL asset $asset_id must be indivisible"; return; }
  [ "$unspendable" = false ] || { smpl_fail "SMPL asset $asset_id must be spendable"; return; }
  printf '%s\n' "$asset_id"
}

smpl_is_missing_asset_response() { # JSON from GET /assets/info
  local response="$1" error_code
  error_code=$(smpl_json_field "$response" error 2>/dev/null) || return 1
  [ "$error_code" = 601 ] # Core ApiError.INVALID_ASSET_ID
}

smpl_assert_no_pending_issue() { # UNCONFIRMED_ISSUE_ASSET_JSON
  local transactions_json="$1"
  python3 -c '
import json, sys
try:
    transactions = json.loads(sys.argv[1])
except json.JSONDecodeError:
    print("SMPL faucet: pending ISSUE_ASSET search returned invalid JSON", file=sys.stderr)
    raise SystemExit(1)
if not isinstance(transactions, list):
    print("SMPL faucet: pending ISSUE_ASSET search did not return a list", file=sys.stderr)
    raise SystemExit(1)
matches = [
    transaction
    for transaction in transactions
    if isinstance(transaction, dict)
    and transaction.get("type") == "ISSUE_ASSET"
    and transaction.get("assetName") == sys.argv[2]
]
if matches:
    print(
        "SMPL faucet: found an unconfirmed SMPL issuance; wait for it to confirm "
        "or expire before retrying",
        file=sys.stderr,
    )
    raise SystemExit(1)
' "$transactions_json" "$SMPL_ASSET_NAME"
}

smpl_assert_clean_deploy_slate() { # CONFIRMED_DEPLOY_AT_JSON UNCONFIRMED_DEPLOY_AT_JSON
  local confirmed_json="$1" unconfirmed_json="$2"
  python3 -c '
import json, sys
labels = ("confirmed", "unconfirmed")
counts = []
for label, raw in zip(labels, sys.argv[1:]):
    try:
        transactions = json.loads(raw)
    except json.JSONDecodeError:
        print("SMPL faucet: " + label + " DEPLOY_AT search returned invalid JSON", file=sys.stderr)
        raise SystemExit(1)
    if not isinstance(transactions, list):
        print("SMPL faucet: " + label + " DEPLOY_AT search did not return a list", file=sys.stderr)
        raise SystemExit(1)
    counts.append(len(transactions))
if any(counts):
    print(
        "SMPL faucet: Previewnet is no longer on the required clean deployment "
        "slate (confirmed DEPLOY_AT="
        + str(counts[0])
        + ", unconfirmed DEPLOY_AT="
        + str(counts[1])
        + "); refusing to create another AT",
        file=sys.stderr,
    )
    raise SystemExit(1)
' "$confirmed_json" "$unconfirmed_json"
}

smpl_canonical_creation_bytes() { # REPO_ROOT
  local artifact="$1/at/faucet-v1-creation-bytes.txt" bytes hash
  local expected_hash=3cd6292352232c8243753b9ec3b5c78649088981804770133f8a7cc3228aec4e
  [ -r "$artifact" ] || { smpl_fail "canonical creation-bytes artifact is missing: $artifact"; return; }
  bytes=$(sed -n 's/^Base58: //p' "$artifact")
  [[ "$bytes" =~ ^[1-9A-HJ-NP-Za-km-z]+$ ]] || { smpl_fail "canonical creation bytes are absent or invalid"; return; }
  hash=$(python3 -c '
import hashlib, sys
alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
value = 0
for character in sys.argv[1]:
    value = value * 58 + alphabet.index(character)
decoded = value.to_bytes((value.bit_length() + 7) // 8, "big")
decoded = bytes(len(sys.argv[1]) - len(sys.argv[1].lstrip("1"))) + decoded
print(hashlib.sha256(decoded).hexdigest())
' "$bytes") || { smpl_fail "could not decode canonical creation bytes"; return; }
  [ "$hash" = "$expected_hash" ] || {
    smpl_fail "canonical creation bytes SHA-256 mismatch ($hash); refusing noncanonical V1 bytecode"; return;
  }
  printf '%s\n' "$bytes"
}

smpl_build_issue_request() { # ISSUER_PUBKEY TIMESTAMP
  local issuer_pubkey="$1" timestamp="$2"
  [[ "$timestamp" =~ ^[0-9]+$ ]] || { smpl_fail "invalid issue timestamp: $timestamp"; return; }
  [ -n "$issuer_pubkey" ] || { smpl_fail "ISSUER_PUBKEY not set"; return; }
  cat <<EOF
{
  "timestamp": $timestamp,
  "fee": "0",
  "issuerPublicKey": "$issuer_pubkey",
  "assetName": "$SMPL_ASSET_NAME",
  "description": "Qortium Casino free sample. No monetary value.",
  "quantity": "$SMPL_SUPPLY",
  "isDivisible": false,
  "data": "{}",
  "isUnspendable": false
}
EOF
}

smpl_build_deploy_request() { # CREATOR_PUBKEY ASSET_ID CREATION_BYTES TIMESTAMP
  local creator_pubkey="$1" asset_id="$2" creation_bytes="$3" timestamp="$4"
  [ -n "$creator_pubkey" ] || { smpl_fail "CREATOR_PUBKEY not set"; return; }
  [[ "$asset_id" =~ ^[1-9][0-9]*$ ]] || { smpl_fail "invalid SMPL assetId: $asset_id"; return; }
  [[ "$creation_bytes" =~ ^[1-9A-HJ-NP-Za-km-z]+$ ]] || { smpl_fail "invalid canonical creation bytes"; return; }
  [[ "$timestamp" =~ ^[0-9]+$ ]] || { smpl_fail "invalid deployment timestamp: $timestamp"; return; }
  cat <<EOF
{
  "timestamp": $timestamp,
  "fee": "0",
  "creatorPublicKey": "$creator_pubkey",
  "name": "casino-smpl-faucet-v1",
  "description": "Qortium Casino SMPL faucet: one Bronze-or-higher free sample per account.",
  "aTType": "casino-faucet-v1",
  "tags": "casino,faucet,smpl,bronze,exactly-once",
  "creationBytes": "$creation_bytes",
  "amount": "$SMPL_SUPPLY",
  "assetId": $asset_id,
  "nativeFeeReserve": "0"
}
EOF
}

# Read the deployed AT address out of an accepted DEPLOY_AT process response.
#
# Core publishes it as `atAddress`. Nodes older than the 2026-07-30 API fix
# (qortium-core PR #186) published the same value as `aTAddress`, because the
# JSON key came straight from a Java field name that nobody had noticed was
# inconsistent. Reading only `atAddress` is what made a fully successful faucet
# deployment abort with "did not include an AT address" on 2026-07-30.
#
# Accept either key while 1.6.1 nodes are still in use; the released seeds and
# most installed nodes will lag behind main for a while. Drop the `aTAddress`
# fallback once no supported node publishes it.
smpl_deployed_at_address() { # smpl_deployed_at_address PROCESS_RESULT_JSON
  local process_result="$1" address
  address=$(transaction_json_field "$process_result" atAddress 2>/dev/null) \
    || address=$(transaction_json_field "$process_result" aTAddress 2>/dev/null) \
    || return 1
  printf '%s\n' "$address"
}
