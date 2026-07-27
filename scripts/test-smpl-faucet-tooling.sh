#!/usr/bin/env bash
# Offline checks for the SMPL Faucet V1 request builders and safety guards.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/smpl-faucet-lib.sh"

pass() { printf 'ok - %s\n' "$1"; }
fail() { printf 'not ok - %s\n' "$1" >&2; exit 1; }
expect_fail() {
  local status
  set +e
  "$@" >/dev/null 2>&1
  status=$?
  set -e
  [ "$status" -ne 0 ] || fail "expected failure: $*"
}

SYNCED='{"syncPhase":"SYNCED","isSynchronizing":false}'
INFO='{"buildVersion":"1.6.0","type":"full"}'
REAL_FORMAT_INFO='{"buildVersion":"qortium-1.6.0-6578cde","type":"full"}'
VALID_ASSET='{"assetId":47,"name":"SMPL","quantity":100000000000,"isDivisible":false,"isUnspendable":false}'

smpl_assert_node_ready "$SYNCED" "$INFO" 70000 || fail "ready node should pass"
pass "height 70000 on synced Core 1.6.0 passes"
smpl_assert_node_ready "$SYNCED" "$REAL_FORMAT_INFO" 70000 || fail "real Qortium build version should pass"
pass "Qortium-prefixed Core build version passes"
expect_fail smpl_assert_node_ready "$SYNCED" "$INFO" 69999
pass "pre-trigger height refuses deployment"
expect_fail smpl_assert_node_ready '{"syncPhase":"BEHIND","isSynchronizing":false}' "$INFO" 70000
pass "behind node refuses deployment"
expect_fail smpl_assert_node_ready "$SYNCED" '{"buildVersion":"1.5.1","type":"full"}' 70000
pass "old Core refuses deployment"

[ "$(smpl_assert_asset_info "$VALID_ASSET")" = 47 ] || fail "valid dynamic SMPL asset should return ID"
pass "valid SMPL asset returns dynamic ID"
expect_fail smpl_assert_asset_info '{"assetId":3,"name":"SMPL","quantity":1000,"isDivisible":false,"isUnspendable":false}'
pass "whole-unit quantity is rejected when raw API quantity is wrong"
expect_fail smpl_assert_asset_info '{"assetId":3,"name":"SMPL","quantity":100000000000,"isDivisible":true,"isUnspendable":false}'
pass "divisible lookalike asset is rejected"
smpl_is_missing_asset_response '{"error":601,"message":"Invalid asset ID"}' || fail "missing-asset response should be recognized"
expect_fail smpl_is_missing_asset_response '{"error":4,"message":"Unauthorized"}'
pass "only Core INVALID_ASSET_ID permits first issuance"

ISSUE=$(smpl_build_issue_request PUBKEY 123)
[[ "$ISSUE" == *'"quantity": "1000"'* && "$ISSUE" == *'"fee": "0"'* && "$ISSUE" == *'"isDivisible": false'* ]] || fail "issue request fields"
pass "issue request uses 1000 API units, zero fee, and indivisible SMPL"

BYTES=$(smpl_canonical_creation_bytes "$REPO_DIR")
[[ "$BYTES" == 16TbQNnSFh8ddHmc4szgcdmXqEXSdQXNMZGVJF6tis3N1isyxWqLqSHgwCFLkRffoRe9uC7xuA3kEGAHfLYW3YzgcVaqYqxbz8FkBM7rDRcxvf12JzZwr1SPLbeWxDpM4mVmYvx4S1i85dhVY1vYfCSPDA3ue6LMp4nFKUX2jYzB1aoenCyiHoBaKFqfYPUzHHRawPLLPxpuHsFFktbRne5JPcMW6ULWb9ykLMV1tL9pzLsHqAqzQWfrAdodciH6xPdArM1wegp8hFNMjwZkSXVbonsPUwn5BRhCPDk24uuAdoCKu5AdBuvPAD2RJjbwjH7wY1GVvjGZJwzk8GchWQQSXEHQNEAQY3Jd9cjJG533Kb8tZxhRaaoiKat9sPitqwkomZrpvMvHD2zMuipbRuEjyszGYfoCiQxvjyCP58hLDaiVXiYCfrtTwccw2bhVu425iKY61mZZx3L2w6C8ygv9XXuvM3QxeZQorwvVPNebfwz8iw6HgqXLiPHFLdPyuEYP4LjjbYr1twtFf3Jcy2MZ9RSuKdr4VoF2vasitwgVtRsTY2ktN5aLJQXUUKuzUedo49YRS9ZfBsQpXt5JgSXGeRXToxRGTjbkdZFsGov5icVS49NFbxgPr3t3v15kHJnhVfGTNKGYqjDqmcrU ]] || fail "canonical byte artifact unexpectedly changed"
pass "canonical byte artifact decodes to the pinned V1 SHA-256"
DEPLOY=$(smpl_build_deploy_request PUBKEY 47 "$BYTES" 123)
[[ "$DEPLOY" == *'"assetId": 47'* && "$DEPLOY" == *'"amount": "1000"'* && "$DEPLOY" == *'"nativeFeeReserve": "0"'* && "$DEPLOY" == *"\"creationBytes\": \"$BYTES\""* ]] || fail "deploy request fields"
pass "deploy request uses canonical bytes, dynamic asset ID, 1000 SMPL, and zero native reserve"
