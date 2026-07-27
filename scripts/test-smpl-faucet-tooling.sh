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
[[ "$BYTES" == 1GjP8eqc81iGbaHWPZDSTSJy6jcSPYzqk9HDc5b7VxhYmxWdyQ2MSyN4c8BUDy2eq1nTSfZq9Ux2C2kB7CFFqyw6UemGxJ2bxpKKS94bNLTUPkuYP8hGzF7S1QfRpmuJgrjbaZXJpn3SjHBg7HxBk1RAj4ssjCKcnxt2EgnGivDaCgDtwFP9up8EAvJ4hfgDngZewCTN28nvwuUJFbj4H3UR7WN88vmmz5XydMfGFE9jbAM1h2DhkhkDHzsimcBSLYi4pMVRjKQFfYskwVL8AAYKaZDJcDnK1orCnHH99HatJD91Ptk8uBU1UTx6squF59aypwqtEyUq3Z4zdKeHjj3f6RovjSyxW7BFmsTVPqqy38XmsUXG1fRgo9Pexka161MZVGJvqMhhLxGecSyw9VLKX1ofJbZb315WViLRLWmzWboRERyYV2Mc12g4TXKh1gGKNxF9SM6Cswy76oAGz2z64drXDaZsFArH5eTRXtXFwiHFAv9raQc5Sy9yacZRWEwjcCQGdwUVjkcG5KEeG5rtqVevxiLrVXi5SmSPeCF9aovBzY8Lf4rioq42XeJJTJhnKfBcSXp6eYxeVKCB7pcgjmffhoJHSkHY6t8ZupebqBfxVeqcVAFXJYq81YYyUdRDR2GCRsjbFBuFLdTvjo8txQcDJms7ZJRGxCNa8jGCJu3ojBNVUQ6LAVoBGKhs741gQEd84 ]] || fail "canonical byte artifact unexpectedly changed"
pass "canonical byte artifact decodes to the pinned V1 SHA-256"
DEPLOY=$(smpl_build_deploy_request PUBKEY 47 "$BYTES" 123)
[[ "$DEPLOY" == *'"assetId": 47'* && "$DEPLOY" == *'"amount": "1000"'* && "$DEPLOY" == *'"nativeFeeReserve": "0"'* && "$DEPLOY" == *"\"creationBytes\": \"$BYTES\""* ]] || fail "deploy request fields"
pass "deploy request uses canonical bytes, dynamic asset ID, 1000 SMPL, and zero native reserve"
