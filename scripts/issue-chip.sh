#!/usr/bin/env bash
# Issue the CHIP asset on Previewnet (see docs/CHIP_ASSET.md).
# Usage: SIGNER_PRIVATE_KEY=... ISSUER_PUBKEY=... ./issue-chip.sh
# Base-transaction fields (timestamp/reference/fee) are fetched/filled below.
set -euo pipefail
cd "$(dirname "$0")" && source ./lib.sh

[ -n "${ISSUER_PUBKEY:-}" ] || { echo "ISSUER_PUBKEY (base58 public key of issuing account) not set" >&2; exit 1; }

ASSET_NAME="${CHIP_NAME:-CHIP}"
QUANTITY="${CHIP_QUANTITY:-1000000000}"
TIMESTAMP=$(($(date +%s) * 1000))
ADDRESS=$(api GET "/addresses/convert/$ISSUER_PUBKEY" || true)
REFERENCE=$(api GET "/addresses/lastreference/$ADDRESS")

UNSIGNED=$(api POST /assets/issue "{
  \"timestamp\": $TIMESTAMP,
  \"reference\": \"$REFERENCE\",
  \"fee\": \"${TX_FEE:-0.01}\",
  \"issuerPublicKey\": \"$ISSUER_PUBKEY\",
  \"assetName\": \"$ASSET_NAME\",
  \"description\": \"Qortium Casino free-play chip. No monetary value.\",
  \"quantity\": $QUANTITY,
  \"isDivisible\": false,
  \"data\": \"{}\",
  \"isUnspendable\": false
}")
echo "unsigned: ${UNSIGNED:0:60}..." >&2
sign_and_process "$UNSIGNED"
