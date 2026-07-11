#!/usr/bin/env bash
# Deploy the Faucet AT v0 on Previewnet (see docs/FAUCET_AT_V0.md).
# Prereqs: CHIP issued (scripts/issue-chip.sh) — pass its assetId; creation bytes
# from the at/ module builder (java ...FaucetV0 prints base58).
# Usage: SIGNER_PRIVATE_KEY=... CREATOR_PUBKEY=... CHIP_ASSET_ID=N \
#        CREATION_BYTES=<base58> ./deploy-faucet.sh
set -euo pipefail
cd "$(dirname "$0")" && source ./lib.sh

for v in CREATOR_PUBKEY CHIP_ASSET_ID CREATION_BYTES; do
  [ -n "$(eval echo "\${$v:-}")" ] || { echo "$v not set" >&2; exit 1; }
done

# Qortium dropped last-reference chaining; unsigned builds need no reference.
TIMESTAMP=$(($(date +%s) * 1000))

UNSIGNED=$(api POST /at "{
  \"timestamp\": $TIMESTAMP,
  \"fee\": \"${TX_FEE:-0}\",
  \"creatorPublicKey\": \"$CREATOR_PUBKEY\",
  \"name\": \"casino-faucet-v0\",
  \"description\": \"Qortium Casino CHIP faucet: send a MESSAGE, receive free chips.\",
  \"aTType\": \"casino-faucet\",
  \"tags\": \"casino,faucet,chip\",
  \"creationBytes\": \"$CREATION_BYTES\",
  \"amount\": \"${INITIAL_CHIP_FUNDING:-100000}\",
  \"assetId\": $CHIP_ASSET_ID,
  \"nativeFeeReserve\": \"${NATIVE_FEE_RESERVE:-0}\"
}")
echo "unsigned: ${UNSIGNED:0:60}..." >&2
mempow_sign_and_process "$UNSIGNED"
