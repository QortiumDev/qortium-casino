#!/usr/bin/env bash
# Deploy the canonical SMPL Faucet V1 only after AT map storage is active.
# It never accepts an arbitrary asset ID, funding amount, native reserve, or bytecode.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib.sh"
source "$SCRIPT_DIR/smpl-faucet-lib.sh"

[ -n "${CREATOR_PUBKEY:-}" ] || { echo "CREATOR_PUBKEY (base58 creator public key) not set" >&2; exit 2; }
[ -n "${SMPL_ASSET_ID:-}" ] || { echo "SMPL_ASSET_ID not set" >&2; exit 2; }

STATUS=$(api GET /admin/status)
INFO=$(api GET /admin/info)
HEIGHT=$(api GET /blocks/height)
smpl_assert_node_ready "$STATUS" "$INFO" "$HEIGHT"

CONFIRMED_DEPLOYS=$(api GET "/transactions/search?txType=DEPLOY_AT&confirmationStatus=CONFIRMED&limit=20&reverse=true")
UNCONFIRMED_DEPLOYS=$(api GET "/transactions/unconfirmed?txType=DEPLOY_AT")
smpl_assert_clean_deploy_slate "$CONFIRMED_DEPLOYS" "$UNCONFIRMED_DEPLOYS"

ASSET_INFO=$(api GET "/assets/info?assetId=$SMPL_ASSET_ID")
VERIFIED_ASSET_ID=$(smpl_assert_asset_info "$ASSET_INFO")
[ "$VERIFIED_ASSET_ID" = "$SMPL_ASSET_ID" ] || { echo "SMPL asset ID changed while validating; refusing deployment" >&2; exit 1; }

CREATION_BYTES=$(smpl_canonical_creation_bytes "$REPO_DIR")
TIMESTAMP=$(($(date +%s) * 1000))
UNSIGNED=$(smpl_build_deploy_request "$CREATOR_PUBKEY" "$SMPL_ASSET_ID" "$CREATION_BYTES" "$TIMESTAMP")
echo "SMPL Faucet V1 deployment is valid: assetId=$SMPL_ASSET_ID, funding=$SMPL_SUPPLY SMPL, Bronze-or-higher claims only, fee=0, native reserve=0." >&2
UNSIGNED=$(api POST /at "$UNSIGNED")
echo "unsigned: ${UNSIGNED:0:60}..." >&2
PROCESS_RESULT=$(mempow_sign_and_process "$UNSIGNED" DEPLOY_AT)
AT_ADDRESS=$(smpl_deployed_at_address "$PROCESS_RESULT") || {
  echo "accepted DEPLOY_AT response did not include an AT address under atAddress or the legacy aTAddress: $PROCESS_RESULT" >&2
  exit 1
}
[[ "$AT_ADDRESS" =~ ^A[1-9A-HJ-NP-Za-km-z]{30,40}$ ]] || {
  echo "accepted DEPLOY_AT response included an invalid AT address: $AT_ADDRESS" >&2
  exit 1
}
echo "SMPL Faucet V1 deployment accepted: atAddress=$AT_ADDRESS" >&2
printf '%s\n' "$AT_ADDRESS"
