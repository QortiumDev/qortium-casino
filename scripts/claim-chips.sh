#!/usr/bin/env bash
# Send a MESSAGE to the faucet AT to claim Previewnet casino chips.
# Usage: PRIVATE_KEY=... ./scripts/claim-chips.sh <faucetAtAddress> [messageText]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib.sh"

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: PRIVATE_KEY=... $0 <faucetAtAddress> [messageText]" >&2
  exit 2
fi

[ -n "${PRIVATE_KEY:-}" ] || { echo "PRIVATE_KEY not set" >&2; exit 2; }

CORE_JAR="/home/user/qortium/git/qortium-core/target/qortium-1.4.0.jar"
HELPER_SOURCE="$REPO_DIR/tools/SendMessageTx.java"
HELPER_CLASS="$REPO_DIR/tools/SendMessageTx.class"

if [ ! -f "$CORE_JAR" ]; then
  echo "Qortium Core shaded jar not found: $CORE_JAR" >&2
  exit 1
fi

if [ ! -f "$HELPER_CLASS" ] || [ "$HELPER_SOURCE" -nt "$HELPER_CLASS" ]; then
  echo "compiling SendMessageTx.java..." >&2
  (cd "$REPO_DIR" && javac -cp "$CORE_JAR" tools/SendMessageTx.java)
fi

MESSAGE_TEXT="${2:-claim chips}"
SIGNED_TRANSACTION=$(java -cp "$CORE_JAR:$REPO_DIR/tools" SendMessageTx "$1" "$MESSAGE_TEXT")
api POST /transactions/process "$SIGNED_TRANSACTION"
