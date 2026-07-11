# Slot AT v1 Spec (3-Reel)

## Purpose

Define the first on-chain slot machine AT used by Q-Casino.

This spec is for **3-reel slots only**.  
5-reel slots will be a separate follow-up spec/version.

## Design Goals

1. Deterministic, replayable outcomes on all nodes.
2. One active player session at a time, with inactivity auto-release.
3. Player flow: deposit once, pull via messages, cash out via message.
4. Creator can cancel at any time, but player credit is paid first.
5. Safe bankroll accounting that respects outstanding player credit liabilities.

## Runtime Constraints (Qortal/CIYAM)

- CIYAM AT version: `>= 2` (use v2).
- AT message size limit: 256 bytes.
- AT tx is payment or message, not both.
- Feeless `MESSAGE` tx is allowed via mempow and is confirmable when recipient is AT address.
- AT execution occurs on blocks, not mempool admission.
- Respect deploy/runtime limits for creation/code/state sizes and step fees.

## Contract Lifecycle

1. **DEPLOYED_ACTIVE**
   - AT is live.
   - No active player session, or one active player session in use.
2. **CANCELED_BY_CREATOR**
   - Creator-issued cancel message received.
   - If player credit exists, pay player first.
   - Pay remaining balance to creator and finish.
3. **FINISHED_FATAL** (undesired)
   - Fatal AT failure state.

## Inputs

### Deposit Input (`PAYMENT`)

- A `PAYMENT` transaction to AT address.
- Sender can be any address, including creator.
- Behavior:
  - if no active player: sender becomes active player, amount is added to session credit.
  - if sender is already active player: amount is added to session credit (top-up).
  - if another player is active: payment is refunded.

### Player Action Input (`MESSAGE`)

- A `MESSAGE` transaction from the active player.
- Binary message format (v1):
  - `byte 0`: opcode
    - `0x01 = PULL`
    - `0x02 = CASHOUT`
    - `0x7F = CREATOR_CANCEL` (creator-only)
  - `bytes 1..8`: `betAtoms` for `PULL` (u64, big-endian)
  - other bytes currently ignored

### Creator Cancel Input (`MESSAGE`)

- A `MESSAGE` transaction to AT address from creator.
- Either `0x7F` opcode or sender-only authorization can be accepted in v1.

## Session Model (v1)

- Exactly one active player session per machine at a time.
- Session fields:
  - active player address
  - player credit balance (in atoms)
  - deadline height (`sessionDeadlineHeight`)
  - pull nonce/counter
- Inactivity policy:
  - each accepted player action extends the deadline by `sessionInactivityBlocks`
  - if deadline is reached with positive player credit, AT auto-cashes out and clears session
- Goal: avoid permanent machine lock by idle players.

## Transaction Processing Loop

1. Sleep until next message/payment after `lastProcessedTimestamp`.
2. If session active, also wake at `sessionDeadlineHeight` using `SLEEP_UNTIL_MESSAGE_OR_HEIGHT`.
3. Fetch next tx after `lastProcessedTimestamp`.
4. For each tx found:
   - move cursor to tx timestamp
   - branch by type and sender rules
   - for valid `PULL`, reserve bet from session credit and enqueue pending pull record
   - continue scanning additional txs in deterministic order
5. After scanning, attempt pending-pull settlement when entropy conditions are met.
6. If no tx and wake happened at timeout height:
   - if pending pulls exist, finish settlement first
   - then auto-cashout active player credit
   - clear session
7. Return to sleep.

Note:
- Multiple player messages can be included in one block and processed in tx order.
- Throughput is still bounded by per-round AT step budget.

## Pull Validation (v1)

For `PULL` message from active player:

- `betAtoms >= minBetAtoms`
- `betAtoms <= min(maxBetAtoms, effectiveMaxBet, sessionCreditAtoms)`
- `betAtoms % betStepAtoms == 0`

If invalid:
- ignore pull (no payout tx)
- keep session active

If valid:
- subtract bet from `sessionCreditAtoms` immediately (bet reservation)
- enqueue pull record (`tx` reference + bet + pull nonce)
- mark pull as pending settlement
- when settled, derive outcome and add win amount to `sessionCreditAtoms`
- no external payout tx is emitted during pull settlement

## Cashout Behavior (v1)

On valid `CASHOUT` from active player:

- if no pending pulls:
  - pay `sessionCreditAtoms` to active player (if > 0)
  - clear active session
  - keep AT active for next player
- if pending pulls exist:
  - set `pendingCashout` flag
  - settle pending pulls first
  - then pay resulting `sessionCreditAtoms` and clear session

## Randomness & Fairness (Locked v1 Hybrid)

### Baseline objective

- Remove reliance on mutable block-hash-only entropy that can visibly reorg-change outcomes.
- Avoid tx-context-only entropy that allows player-side grinding.
- Keep deterministic replay across all nodes.

### Locked entropy flow

1. Accepted pulls are queued in tx order.
2. First unresolved queued pull becomes the entropy anchor (`anchorTx`).
3. Wait until `currentHeight >= anchorHeight + entropyConfirmDepthK`.
4. Load `anchorTx` into A and call `0x0308 GENERATE_RANDOM_USING_TX_IN_A`:
   - first call sleeps one block
   - second call returns `epochSeed64`
5. Resolve queued pulls in order using deterministic expansion:
   - `pullSeed = H(epochSeed64 || pullTxSig || pullNonce || domainTag)`
   - derive reel stops from `pullSeed` with rejection sampling
6. Update session credit and counters from each resolved outcome.

### Confirmation depth parameter

- `entropyConfirmDepthK` is a deploy-time parameter.
- v1 default: `2`.
- v1 allowed range: `1..3`.
- Higher `K` lowers tip-reorg sensitivity but increases settlement delay.

### Modulo bias policy

- Use rejection sampling for each reel stop index:
  - `limit = floor(2^64 / reelLength) * reelLength`
  - accept candidate only if `< limit`
  - otherwise re-hash with deterministic attempt counter

## Reel/Payout Model (v1 Baseline)

- Reel count: 3
- Reel stops: 24 per reel
- Paylines: 1 (center line only)
- Symbols/reel strips: fixed in code for v1, defined in `SLOT_3_REEL_CONFIG_V1.md`
- Paytable: fixed in code for v1, defined in `SLOT_3_REEL_CONFIG_V1.md`
- Bet scales payout linearly by bet amount

RTP model (3-reel v1):

- `rtpMode=profile` and deploy parameter `rtpProfileId` selects one of three paytable profiles.
- All three profile paytables live in code and are selected by branch logic.
- This allows a single **3-reel** code hash for profile variants.

Planned extension (not required for initial release):

- bounded `rtpMode=custom` using creator-supplied payout vectors validated at deploy.
- see `SLOT_PARAMETER_MODEL.md`.

Current provisional profile math (from `SLOT_3_REEL_CONFIG_V1.md`):

- Profile 1 (tight): RTP `89.5833333%`
- Profile 2 (standard): RTP `91.3339120%`
- Profile 3 (loose): RTP `93.8730469%`

## Bankroll Safety (With Session Liability)

Per pull:

- `playerLiability = sessionCreditAtoms`
- `houseOwnedBalance = max(0, currentBalance - playerLiability)`
- `safeHouseBalance = max(0, houseOwnedBalance - payoutFeeReserveAtoms)`
- `requiredPayout = betAmount * maxPayoutMultiplier`
- accept pull only if `safeHouseBalance >= requiredPayout`

Dynamic runtime bet ceiling:

- `effectiveMaxBet = floor((safeHouseBalance / maxPayoutMultiplier) / betStepAtoms) * betStepAtoms`
- accepted max is `min(configuredMaxBet, effectiveMaxBet, sessionCreditAtoms)`
- if `effectiveMaxBet < minBetAtoms`, machine is temporarily unplayable until topped up

Operational guidance for creators:

- absolute minimum funding: `payoutFeeReserveAtoms + (minBetAtoms * maxPayoutMultiplier)`
- practical startup funding should use profile-based multiples documented in:
  - `SLOT_3_REEL_CONFIG_V1.md`
  - `SLOT_PARAMETER_MODEL.md`

## Creator Controls

- Creator can cancel at any time via message.
- On cancel:
  - if pending pulls exist, settle them before final payouts
  - if active player credit > 0, pay active player first
  - then pay remaining balance to creator
  - set state/status to canceled
  - `FIN_IMD`

## State Fields (Conceptual)

- machine version / game type
- creator address
- min/max/step bets
- payout reserve
- session inactivity timeout blocks
- entropy confirmation depth (`entropyConfirmDepthK`)
- tx cursor (`lastProcessedTimestamp`)
- active player session (address, credit, deadline, pull nonce)
- pending pull queue state (count/head/tail + anchor fields)
- pending cashout/cancel flags
- counters: spins, wagered, paid, refunded, deposited, cashed out
- last spin info (optional compact fields)
- status flag (active/canceled/finished)

Exact index layout is defined in `AT_PARAMETERS_AND_LAYOUT.md`.

## Observability

The AT must expose enough state for UI machine cards/details:

- status
- bet limits
- dynamic `effectiveMaxBet`
- current active player (if any)
- current session credit
- session deadline height
- pending pull count / settlement state
- entropy confirmation depth (`entropyConfirmDepthK`)
- total spins / wagered / paid / deposits / cashouts
- last processed timestamp

## Known Tradeoffs (v1)

- One-session-only improves simplicity and anti-race correctness, but limits concurrency per machine.
- Cancel-at-any-time remains creator-friendly; UI must disclose this clearly.
- Outcomes are final only after AT settlement on confirmed blocks; mempool can only be shown as pending UI state.
- Hybrid entropy adds settlement delay (`K` confirmations + `0x0308` second-call block) but hardens against tx grinding.
