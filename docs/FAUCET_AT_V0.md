# Faucet AT v0 — "send a message, get chips"

Status: SPEC 2026-07-11. Target: Qortium Previewnet.

## Goal
The simplest possible end-to-end loop: issue CHIP → prefund this AT → anyone sends a
MESSAGE to the AT address → AT pays them a fixed CHIP grant. Per-user rate limiting is
**not** enforced on-chain in v0 (app hides the claim button for the cooldown); see
"Roadmap" for honest enforcement.

## On-chain design
- Deployed with **configured working asset = CHIP** (`DeployAtTransactionData.assetId`)
  and a `nativeFeeReserve` funding execution fees in native coin.
- Prefunded/topped up by TRANSFER_ASSET of CHIP to the AT address.

### Constants (baked into creation bytes)
- `GRANT_AMOUNT` = 1000 CHIP (in indivisible units)
- creator address (implicit — from creation tx)

### Main loop (Dice/Lottery builder pattern)
1. On first run: store creation timestamp as the tx-scan cursor.
2. `SLEEP_UNTIL_MESSAGE` (0x0503) — idle until a tx arrives.
3. Loop: `PUT_TX_AFTER_TIMESTAMP_INTO_A`; if none, go to 2.
4. Advance cursor (`GET_TIMESTAMP_FROM_TX_IN_A`).
5. Only process MESSAGE-type txs (`GET_TYPE_FROM_TX_IN_A`); skip others (incoming
   payments/assets are simply kept by the AT).
6. `PUT_ADDRESS_FROM_TX_IN_A_INTO_B` (sender into B).
7. **Creator shutdown path:** if sender == creator, pay entire CHIP balance to creator
   (`GET_ASSET_BALANCE` 0x0531 + `PAY_ASSET_AMOUNT_TO_B` 0x0533) and finish (native
   remainder returns to creator on finish).
8. Otherwise: if spendable CHIP balance >= `GRANT_AMOUNT`
   (`GET_CONFIGURED_ASSET_ID` 0x0530 + `GET_ASSET_BALANCE` 0x0531), then
   `PAY_ASSET_AMOUNT_TO_B(chipAssetId, GRANT_AMOUNT)` (0x0533).
   If balance < grant: skip payout (claims resume after a top-up), continue loop.
9. Back to 3.

### Explicit non-goals in v0
- No per-user cooldown on-chain (app-side only).
- No refunds of wrong-asset/native payments (kept; creator shutdown recovers CHIP).
- No sybil gate (optional later: `GET_ACCOUNT_LEVEL_FROM_ACCOUNT_IN_B >= 1`).

## Implementation
- Java creation-bytes builder in `at/` (maven module), modeled on the Qortal lottery
  repo's `Dice.java`/`Lottery.java` (archive:
  `/mnt/archive/archive/qubes-backup/kicksecure-lan/files/home/user/Documents/github/lottery`).
- CIYAM AT dep: `com.github.QuickMythril:AT:1b731d1` via JitPack (same as qortium-core).
- Qortium-specific function codes (from qortium-core `ChainFunctionCode.java`):
  `SLEEP_UNTIL_MESSAGE=0x0503`, `GET_CONFIGURED_ASSET_ID=0x0530`,
  `GET_ASSET_BALANCE=0x0531`, `GET_ASSET_ID_FROM_TX_IN_A=0x0532`,
  `PAY_ASSET_AMOUNT_TO_B=0x0533`, `GET_AMOUNT_FROM_TX_IN_A_FOR_ASSET=0x0534`.
  These are emitted as raw shorts by the builder; the CIYAM jar doesn't know them.
- Tests: CIYAM `MachineState` + a test `API` subclass stubbing the Qortium platform
  functions (asset balances, asset payments) — assert grant payout per message, creator
  shutdown, and low-balance pause. Step budget sanity: `maxStepsPerRound=500`,
  `stepsPerFunctionCall=10`.

## Claim transaction notes
- Claims are MESSAGE txs with fee=0 and MESSAGE's own built-in MemPoW nonce
  (confirmable difficulty 12 / 8MiB) — use `scripts/claim-chips.sh`. MESSAGE txs only
  *confirm* when the recipient is an AT address (core `isConfirmable()`); a MESSAGE to a
  regular Q-address sits unconfirmed until expiry by design.
- Deploying this AT requires core >= 1.4.1 and Previewnet height >= 60000
  (`deployAtWorkingAssetHeight` feature trigger; see QortiumDev/qortium-core#119).

## Roadmap
- v1: per-user cooldown via ring buffer of (address-hash, last-claim-timestamp) in AT
  data (OK for ~100 claimants; scan cost spans blocks as it grows).
- v2: propose `GET_TIMESTAMP_OF_LAST_PAYMENT_FROM_AT_TO_ADDRESS_IN_B` opcode in
  qortium-core (feature-trigger activation) → stateless unbounded faucet; also powers
  streak/loyalty mechanics in games.
