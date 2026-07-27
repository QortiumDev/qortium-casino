#!/usr/bin/env bash
# Issue the fixed SMPL asset used only by the Faucet V1 deployment flow.
# This is an operator command: it signs and broadcasts only after all guards pass.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
source "$SCRIPT_DIR/smpl-faucet-lib.sh"

[ -n "${ISSUER_PUBKEY:-}" ] || { echo "ISSUER_PUBKEY (base58 issuing public key) not set" >&2; exit 2; }

STATUS=$(api GET /admin/status)
INFO=$(api GET /admin/info)
HEIGHT=$(api GET /blocks/height)
smpl_assert_node_ready "$STATUS" "$INFO" "$HEIGHT"

TIMESTAMP=$(($(date +%s) * 1000))
UNSIGNED=$(smpl_build_issue_request "$ISSUER_PUBKEY" "$TIMESTAMP")
echo "SMPL issue request is valid: supply=$SMPL_SUPPLY indivisible, fee=0." >&2
UNSIGNED=$(api POST /assets/issue "$UNSIGNED")
echo "unsigned: ${UNSIGNED:0:60}..." >&2
mempow_sign_and_process "$UNSIGNED"
