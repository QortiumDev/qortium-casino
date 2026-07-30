#!/usr/bin/env bash
# Offline checks for the SMPL Faucet V1 request builders and safety guards.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export CASINO_APIKEY=offline-test-key
source "$SCRIPT_DIR/lib.sh"
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

smpl_assert_no_pending_issue '[]' || fail "empty pending issue list should pass"
smpl_assert_no_pending_issue '[{"type":"ISSUE_ASSET","assetName":"OTHER"}]' || fail "unrelated pending issue should pass"
expect_fail smpl_assert_no_pending_issue '[{"type":"ISSUE_ASSET","assetName":"SMPL"}]'
expect_fail smpl_assert_no_pending_issue '{"error":1}'
pass "pending SMPL issuance and malformed search responses refuse a retry"

smpl_assert_clean_deploy_slate '[]' '[]' || fail "empty deployment slate should pass"
expect_fail smpl_assert_clean_deploy_slate '[{"type":"DEPLOY_AT"}]' '[]'
expect_fail smpl_assert_clean_deploy_slate '[]' '[{"type":"DEPLOY_AT"}]'
expect_fail smpl_assert_clean_deploy_slate 'not-json' '[]'
pass "confirmed, unconfirmed, and malformed deployment searches refuse deployment"

ISSUE_RESULT='{"type":"ISSUE_ASSET","signature":"3MN5"}'
transaction_assert_process_result "$ISSUE_RESULT" ISSUE_ASSET || fail "valid API v2 process response should pass"
[ "$(transaction_json_field "$ISSUE_RESULT" signature)" = 3MN5 ] || fail "transaction field extraction"
expect_fail transaction_assert_process_result true ISSUE_ASSET
expect_fail transaction_assert_process_result '{"error":701,"message":"Transaction invalid"}' ISSUE_ASSET
expect_fail transaction_assert_process_result '{"type":"DEPLOY_AT","signature":"3MN5"}' ISSUE_ASSET
expect_fail transaction_assert_process_result '{"type":"ISSUE_ASSET"}' ISSUE_ASSET
pass "process response must be API v2 JSON with expected type and signature"

assert_base58 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz "test value" || fail "valid base58 should pass"
expect_fail assert_base58 '0OIl' "test value"
pass "transaction stages reject non-base58 API error bodies"

ISSUE=$(smpl_build_issue_request PUBKEY 123)
[[ "$ISSUE" == *'"quantity": "1000"'* && "$ISSUE" == *'"fee": "0"'* && "$ISSUE" == *'"isDivisible": false'* ]] || fail "issue request fields"
pass "issue request uses 1000 API units, zero fee, and indivisible SMPL"

BYTES=$(smpl_canonical_creation_bytes "$REPO_DIR")
[[ "$BYTES" == 1GjP8eqc81iGbaHWPZDSTSJy6jcSPYzqk9HDc5b7VxhYmxWdyQ2MSyN4c8BUDy2eq1nTSfZq9Ux2C2kB7CFFqyw6UemGxJ2bxpKKS94bNLTUPkuYP8hGzF7S1QfRpmuJgrjbaZXJpn3SjHBg7HxBk1RAj4ssjCKcnxt2EgnGivDaCgDtwFP9up8EAvJ4hfgDngZewCTN28nvwuUJFbj4H3UR7WN88vmmz5XydMfGFE9jbAM1h2DhkhkDHzsimcBSLYi4pMVRjKQFfYskwVL8AAYKaZDJcDnK1orCnHH99HatJD91Ptk8uBU1UTx6squF59aypwqtEyUq3Z4zdKeHjj3f6RovjSyxW7BFmsTVPqqy38XmsUXG1fRgo9Pexka161MZVGJvqMhhLxGecSyw9VLKX1ofJbZb315WViLRLWmzWboRERyYV2Mc12g4TXKh1gGKNxF9SM6Cswy76oAGz2z64drXDaZsFArH5eTRXtXFwiHFAv9raQc5Sy9yacZRWEwjcCQGdwUVjkcG5KEeG5rtqVevxiLrVXi5SmSPeCF9aovBzY8Lf4rioq42XeJJTJhnKfBcSXp6eYxeVKCB7pcgjmffhoJHSkHY6t8ZupebqBfxVeqcVAFXJYq81YYyUdRDR2GCRsjbFBuFLdTvjo8txQcDJms7ZJRGxCNa8jGCJu3ojBNVUQ6LAVoBGKhs741gQEd84 ]] || fail "canonical byte artifact unexpectedly changed"
pass "canonical byte artifact decodes to the pinned V1 SHA-256"
DEPLOY=$(smpl_build_deploy_request PUBKEY 47 "$BYTES" 123)
[[ "$DEPLOY" == *'"assetId": 47'* && "$DEPLOY" == *'"amount": "1000"'* && "$DEPLOY" == *'"nativeFeeReserve": "0"'* && "$DEPLOY" == *"\"creationBytes\": \"$BYTES\""* ]] || fail "deploy request fields"
pass "deploy request uses canonical bytes, dynamic asset ID, 1000 SMPL, and zero native reserve"

MOCK_CURL_LOG=$(mktemp)
trap 'rm -f "$MOCK_CURL_LOG"' EXIT
MOCK_PROCESS_TYPE=DEPLOY_AT
curl() {
  printf '%s\n' "$*" >>"$MOCK_CURL_LOG"
  case "$*" in
    *"/transactions/mempow/compute"*) printf '%s\n' 456 ;;
    *"/transactions/sign"*) printf '%s\n' 789 ;;
    *"/transactions/process"*)
      printf '{"type":"%s","signature":"3MN5","atAddress":"A111111111111111111111111111111111"}\n' "$MOCK_PROCESS_TYPE"
      ;;
    *) return 1 ;;
  esac
}
export SIGNER_PRIVATE_KEY=offline-private-key
PROCESS_RESULT=$(mempow_sign_and_process 123 DEPLOY_AT) || fail "mocked MemPoW process should pass"
[ "$(transaction_json_field "$PROCESS_RESULT" atAddress)" = A111111111111111111111111111111111 ] || fail "AT address should survive API v2 processing"
grep -q -- '--fail-with-body' "$MOCK_CURL_LOG" || fail "curl must fail on HTTP errors"
grep -q -- 'X-API-VERSION: 2' "$MOCK_CURL_LOG" || fail "process call must request API v2"
pass "MemPoW processing fails on HTTP errors and requests the accepted transaction JSON"

MOCK_PROCESS_TYPE=ISSUE_ASSET
expect_fail mempow_sign_and_process 123 DEPLOY_AT
pass "MemPoW processing refuses an accepted transaction of the wrong type"

# --- absent-asset probe -------------------------------------------------------
# Core answers GET /assets/info for an unknown asset with HTTP 400
# {"error":601}. Strict api() aborts there, so before api_read_or_error every
# first-time SMPL deployment died before it could issue. Exercise the real
# curl contract (body on stdout, exit 22) rather than only the detector.
unset -f curl
curl() { printf '%s\n' '{"error":601,"message":"invalid asset ID"}'; return 22; }

ABSENT=$(api_read_or_error GET "/assets/info?assetName=SMPL") \
  || fail "an HTTP 400 application-error body must not abort the absence probe"
[ "$ABSENT" = '{"error":601,"message":"invalid asset ID"}' ] \
  || fail "absence probe must return the error body verbatim, got: $ABSENT"
smpl_is_missing_asset_response "$ABSENT" \
  || fail "the probed 400 body must be recognized as an absent asset"
expect_fail smpl_assert_asset_info "$ABSENT"
pass "absent SMPL returns Core's 601 body and routes to the issuance branch"

# A real asset still reaches the caller unchanged through the same helper.
curl() { printf '%s\n' '{"assetId":47,"name":"SMPL","quantity":100000000000,"isDivisible":false,"isUnspendable":false}'; }
PRESENT=$(api_read_or_error GET "/assets/info?assetName=SMPL") || fail "a 200 probe must succeed"
[ "$(smpl_assert_asset_info "$PRESENT")" = 47 ] || fail "present SMPL must still yield its asset ID"
pass "present SMPL passes through the probe unchanged"

# An unreachable node must stay fatal: it must not be mistaken for "absent" and
# silently trigger an issuance.
curl() { return 7; }
expect_fail api_read_or_error GET "/assets/info?assetName=SMPL"
UNREACHABLE=$(api_read_or_error GET "/assets/info?assetName=SMPL" 2>/dev/null || true)
[ -z "$UNREACHABLE" ] || fail "a transport failure must not yield a body, got: $UNREACHABLE"
expect_fail smpl_is_missing_asset_response "$UNREACHABLE"
pass "an unreachable node fails the probe instead of reading as an absent asset"
unset -f curl
