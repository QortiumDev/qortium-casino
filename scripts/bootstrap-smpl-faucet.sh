#!/usr/bin/env bash
# User-run SMPL Faucet V1 bootstrap. Do not run before Previewnet height 70,000.
# It may issue SMPL and then deploy the prefunded canonical AT; both actions sign.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
source "$SCRIPT_DIR/smpl-faucet-lib.sh"
source "${TREASURY_ENV:-$HOME/.local/share/qortium-casino/treasury.env}"
export SIGNER_PRIVATE_KEY="$CASINO_TREASURY_PRIVATE_KEY"

echo "== treasury: $CASINO_TREASURY_ADDRESS"
STATUS=$(api GET /admin/status)
INFO=$(api GET /admin/info)
HEIGHT=$(api GET /blocks/height)
smpl_assert_node_ready "$STATUS" "$INFO" "$HEIGHT"

ASSET_INFO=$(api GET "/assets/info?assetName=$SMPL_ASSET_NAME")
if SMPL_ASSET_ID=$(smpl_assert_asset_info "$ASSET_INFO" 2>/dev/null); then
  echo "== SMPL already exists: assetId=$SMPL_ASSET_ID"
elif smpl_is_missing_asset_response "$ASSET_INFO"; then
  echo "== SMPL is absent; issuing $SMPL_SUPPLY indivisible SMPL..."
  ISSUER_PUBKEY="$CASINO_TREASURY_PUBLIC_KEY" "$SCRIPT_DIR/issue-smpl.sh"

  echo "== waiting for ISSUE_ASSET confirmation..."
  ASSET_INFO=""
  for i in $(seq 1 60); do
    sleep 10
    ASSET_INFO=$(api GET "/assets/info?assetName=$SMPL_ASSET_NAME")
    if SMPL_ASSET_ID=$(smpl_assert_asset_info "$ASSET_INFO" 2>/dev/null); then
      break
    fi
    smpl_is_missing_asset_response "$ASSET_INFO" || {
      echo "SMPL lookup failed while waiting for confirmation; refusing to continue: $ASSET_INFO" >&2
      exit 1
    }
    echo "   ...still unconfirmed ($i)"
  done
  [ -n "${SMPL_ASSET_ID:-}" ] || { echo "SMPL was not confirmed with the required fixed properties after 10 minutes" >&2; exit 1; }
else
  echo "An existing asset named SMPL does not match the required fixed faucet asset; refusing to issue or deploy." >&2
  exit 1
fi

echo "== deploying canonical SMPL Faucet V1, prefunded with all $SMPL_SUPPLY SMPL..."
CREATOR_PUBKEY="$CASINO_TREASURY_PUBLIC_KEY" SMPL_ASSET_ID="$SMPL_ASSET_ID" "$SCRIPT_DIR/deploy-smpl-faucet.sh"
echo "== deployment submitted. Wait for confirmation, then record the returned AT address before any claim test."
