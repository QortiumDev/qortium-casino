#!/usr/bin/env bash
# One-shot Previewnet bootstrap: issue CHIP, wait for confirmation, deploy the
# prefunded faucet AT. Signs with the casino treasury key, so run this yourself:
#   ! ~/qortium/git/qortium-casino/scripts/bootstrap-casino.sh
set -euo pipefail
cd "$(dirname "$0")" && source ./lib.sh
source "${TREASURY_ENV:-$HOME/.local/share/qortium-casino/treasury.env}"
export SIGNER_PRIVATE_KEY="$CASINO_TREASURY_PRIVATE_KEY"

echo "== treasury: $CASINO_TREASURY_ADDRESS"

# --- 1. Issue CHIP (skip if it already exists, so the script is re-runnable) ---
ASSET_INFO=$(api GET "/assets/info?assetName=CHIP" || true)
if echo "$ASSET_INFO" | grep -q '"assetId"'; then
  echo "== CHIP already exists, skipping issuance"
else
  echo "== issuing CHIP (1,000,000,000, indivisible)..."
  ISSUER_PUBKEY="$CASINO_TREASURY_PUBLIC_KEY" ./issue-chip.sh
  echo
  echo "== waiting for ISSUE_ASSET confirmation..."
  for i in $(seq 1 60); do
    sleep 10
    ASSET_INFO=$(api GET "/assets/info?assetName=CHIP" || true)
    echo "$ASSET_INFO" | grep -q '"assetId"' && break
    echo "   ...still unconfirmed ($i)"
  done
  echo "$ASSET_INFO" | grep -q '"assetId"' || { echo "CHIP not confirmed after 10min" >&2; exit 1; }
fi
CHIP_ASSET_ID=$(echo "$ASSET_INFO" | sed -n 's/.*"assetId":\([0-9]*\).*/\1/p')
echo "== CHIP assetId: $CHIP_ASSET_ID"

# --- 2. Deploy faucet AT, funded with 100,000 CHIP ---
CREATION_BYTES=$(sed -n 's/^Base58: //p' ../at/faucet-v0-creation-bytes.txt)
echo "== deploying faucet AT..."
CREATOR_PUBKEY="$CASINO_TREASURY_PUBLIC_KEY" CHIP_ASSET_ID="$CHIP_ASSET_ID" \
  CREATION_BYTES="$CREATION_BYTES" ./deploy-faucet.sh
echo
echo "== waiting for DEPLOY_AT confirmation (faucet AT should hold CHIP)..."
BALANCES=""
for i in $(seq 1 60); do
  sleep 10
  BALANCES=$(api GET "/assets/balances?assetid=$CHIP_ASSET_ID&excludeZero=true" || true)
  # two holders = treasury + AT
  [ "$(echo "$BALANCES" | grep -o '"address"' | wc -l)" -ge 2 ] && break
  echo "   ...still unconfirmed ($i)"
done
echo "== CHIP balances (faucet AT should hold 100000):"
echo "$BALANCES"
echo
echo "== done. The non-treasury address above is the faucet AT."
