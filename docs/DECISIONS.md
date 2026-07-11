# Decisions Log

## 2026-02-14: Initial Project Direction

### Accepted

- Q-Casino is the umbrella app for multiple games.
- Immediate focus is Slots only.
- Build and ship 3-reel first, then 5-reel.
- Any user may deploy/fund a slot AT.
- Slot AT creator can cancel and reclaim balance at any time.
- Slot AT creator is allowed to play their own machine.
- Core app UX remains intentionally simple while AT design is stabilized.
- Parameterize machines via data bytes appended in creation bytes.

### Deferred

- Blackjack and additional casino games.
- Bonus-heavy slot mechanics.
- 5-reel implementation details beyond reserved placeholders.

### Open

- Final v1 symbol strip and paytable values.
- Final machine detail stats set for MVP vs post-MVP.

## 2026-02-14: Provisional 3-Reel Config Baseline

### Accepted

- Use 10-symbol set for 3-reel v1:
  - 9 paying symbols (`CHERRY, LEMON, ORANGE, PLUM, BELL, BAR, DOUBLE_BAR, TRIPLE_BAR, SEVEN`)
  - plus `BLANK` filler.
- Use 24 stops per reel with counts documented in `SLOT_3_REEL_CONFIG_V1.md`.
- Use provisional paytable documented in `SLOT_3_REEL_CONFIG_V1.md`.
- Use strict pay evaluation precedence documented in `SLOT_3_REEL_CONFIG_V1.md`.

### Baseline Targets (Current Config)

- RTP: ~`91.33%`
- House edge: ~`8.67%`
- Hit rate: ~`17.31%`

### Open

- Whether to tune RTP upward/downward before v1 freeze.
- Whether to adjust volatility via top-end payouts vs cherry frequency/payout mix.

## 2026-02-14: RTP Profile Selection Model (3-Reel v1 Baseline)

### Accepted

- RTP selection is profile-based via deploy parameter `rtpProfileId`.
- v1 supports three profile ids:
  - `1` tight
  - `2` standard
  - `3` loose
- All profile paytables are embedded in AT code.
- AT data stores profile selection and display/safety values (`rtpProfileId`, `rtpBps`, `maxPayoutMultiplier`).
- All 3-reel profiles share a single 3-reel AT code hash.

### Baseline Profile Targets

- Profile 1: RTP ~`89.58%` (house edge ~`10.42%`)
- Profile 2: RTP ~`91.33%` (house edge ~`8.67%`)
- Profile 3: RTP ~`93.87%` (house edge ~`6.13%`)

### Rejected For v1

- Unbounded/unchecked custom RTP input.

### Open

- Whether profile 1 should be tightened/loosened before freeze.
- Whether profile 3 should be capped below ~`93.9%` for bankroll safety policy.

## 2026-02-14: Slot Family Split And RTP Customization Plan

### Accepted

- 3-reel and 5-reel are separate AT families/code hashes.
- Shared deploy parameters should be consistent across families where possible (`minBetAtoms`, `maxBetAtoms`, `betStepAtoms`, reserve/safety fields, RTP mode fields).
- RTP supports two modes:
  - `profile` mode (`tight`, `standard`, `loose`)
  - bounded `custom` mode (creator-supplied payout vector with validation)
- Min and max bet are mandatory deploy parameters for both families.

### Superseded

- Earlier profile-only stance is superseded by the bounded custom-mode plan.
- Custom mode is now allowed when guardrails/validation are enforced.

### Open

- Exact deploy-time validator rules and multiplier caps for custom mode.
- Whether custom mode ships with 3-reel first or after profile-mode production validation.

## 2026-02-14: 5-Reel Draft Structure And RTP Profiles

### Accepted (Draft)

- Planned 5-reel setup keeps `24` stops per reel.
- Planned 5-reel setup keeps the same symbol set as 3-reel (`9` paying + `BLANK`).
- Draft win logic uses one center line, left-to-right contiguous matching, highest single outcome only.
- Draft 5-reel profile set uses three RTP profiles with fixed multipliers in `SLOT_5_REEL_DRAFT.md`.

### Draft RTP Targets

- Profile 1 (tight): RTP `89.377710162%` (house edge `10.622289838%`)
- Profile 2 (standard): RTP `91.305428964%` (house edge `8.694571036%`)
- Profile 3 (loose): RTP `93.862764335%` (house edge `6.137235665%`)

### Open

- Whether 5-reel should remain single-line or move to multi-line for initial implementation.
- Whether to further tune 5-reel cherry/any-bar low-tier payouts to adjust perceived hit quality.

## 2026-02-14: Bankroll Solvency And Funding Policy

Status: superseded in part by `2026-02-18: Slot v1 Rewrite To Session Model (Unreleased)`.

### Accepted

- Runtime uses hard solvency checks before accepting/settling a spin:
  - `safeBalance = max(0, balance - payoutFeeReserve)`
  - `required = bet * maxPayoutMultiplier`
  - spin only allowed when `safeBalance >= required`
- Runtime uses dynamic max bet from live bankroll:
  - `effectiveMaxBet = floor((safeBalance / maxPayoutMultiplier) / betStep) * betStep`
  - accepted max bet is `min(configuredMaxBet, effectiveMaxBet)`
- If `effectiveMaxBet < minBet`, machine is temporarily unplayable until topped up.
- Creator funding guidance is profile-based (operational recommendation):
  - 3-reel: tight `10x`, standard `12x`, loose `15x` minimum exposure
  - 5-reel draft: tight `8x`, standard `10x`, loose `12x` minimum exposure

### Notes

- Absolute deploy minimum remains:
  - `minFunding = payoutFeeReserve + (minBet * maxPayoutMultiplier)`
- Recommended multipliers are policy guidance to reduce lockouts, not consensus validation rules.

## 2026-02-15: Exploratory Blackjack RNG Demo (No Scope Change)

### Accepted

- Add a local **simulation-only** one-player blackjack demo to explore tx-seeded randomness patterns.
- Demo uses tx-like payload data as deterministic RNG seed input for draw simulation.
- Demo does **not** deploy, submit, or settle real on-chain blackjack logic.
- Current implementation scope remains slots-first as defined in `PRODUCT_SCOPE.md`.

### Notes

- This demo is for UX/entropy flow exploration only and does not alter AT v1 slot requirements.

## 2026-02-15: Blackjack AT Draft Baseline (Exploratory/Deferred)

### Accepted (Draft)

- Blackjack AT design work is exploratory and deferred until slots-first milestones are complete.
- Draft flow uses **no-hole-card** behavior:
  - initial deal is `player1, dealerUp, player2`
  - dealer second card is generated only after player action lock.
- Randomness baseline is **per-action entropy** using action-triggering tx context (`0x0308` flow), then deterministic expansion for draws in that action.
- Card sampling policy is single-deck, no replacement, unbiased mapping (rejection sampling + k-th unused card selection).
- v0 rules target a reduced feature set:
  - one active player hand per table
  - no split/double/insurance/surrender
  - payout set: win, push, natural blackjack (3:2).
- Dealer rule for v0 draft is `S17` (stand on all 17, including soft 17).
- Timeout policy for v0 draft:
  - `actionTimeoutBlocks = 5` (initial default)
  - timeout outcome is `AUTO_STAND` (not auto-forfeit, not auto-refund).
- State layout baseline is captured in `BLACKJACK_AT_STATE_LAYOUT_DRAFT.md`:
  - concrete u64 index map with timeout deadline and entropy-source tx references
  - timeout auto-stand path reuses stored tx context for deterministic `0x0308` entropy.
- State-layout sizing decision for draft baseline:
  - trimmed from `112` to `96` u64 slots (`896 -> 768` data bytes)
  - keeps safer serialized-state headroom under Qortal `MAX_AT_STATE_LENGTH=1024`.

### Open

- Whether creator can forcibly void stale hands after timeout.
- Final action message format and hand-id encoding details.

## 2026-02-15: Java AT Workspace Placement

### Accepted

- Use a top-level multi-module workspace rooted at `at/`.
- Initial modules:
  - `at/common/` for shared deterministic builder/test helpers.
  - `at/blackjack-v0/` for exploratory blackjack implementation drafts.
- Keep frontend/Q-App code (`games/`, `assets/`) separate from AT builder code.
- Future AT family modules should be sibling folders under `at/` (for example `slot3-v1`, `slot5-v1`).

### Notes

- This is a structure/setup decision only; it does not change slots-first delivery scope.

## 2026-02-18: Slot v1 Rewrite To Session Model (Unreleased)

### Accepted

- Because Q-Casino is still unreleased, Slot v1 planning is rewritten in place instead of preserving legacy payment-per-spin assumptions.
- Slot v1 now uses a **single active player session** per machine:
  - session starts/funds via player `PAYMENT`
  - spins are `PULL` messages that debit/add internal session credit
  - payout txs are not emitted per pull
  - player exits via `CASHOUT` message
- Anti-lock rule:
  - session auto-cashes out after `sessionInactivityBlocks` with no valid player action.
- Creator cancel settlement order is fixed:
  - if active player credit exists, pay player first
  - then pay creator remainder
  - then finish.
- Solvency model now treats active player credit as an explicit liability:
  - `houseOwnedBalance = max(0, balance - activeSessionCredit)`
  - `safeHouseBalance = max(0, houseOwnedBalance - payoutFeeReserve)`
  - use `safeHouseBalance` for `required` and `effectiveMaxBet`.

### Clarifications

- AT logic executes on confirmed blocks, not mempool acceptance.
- Multiple player tx can be processed in one block in tx order, but throughput is bounded by AT step limits.
- Feeless `MESSAGE` tx with mempow remains valid for slot actions when recipient is an AT address.
- Mempool acceptance can be displayed in UI but does not finalize any game outcome.

### Entropy Decision (Accepted)

- Slot v1 uses a locked hybrid entropy model:
  - accepted pulls are queued
  - first unresolved pull becomes deterministic anchor
  - settlement waits `entropyConfirmDepthK` confirmations from anchor height
  - anchor tx is passed to `0x0308` (first call sleeps, second call yields epoch seed)
  - queued pulls resolve in order via deterministic hash expansion from epoch seed + pull tx context.
- Default `entropyConfirmDepthK = 2`; allowed range `1..3`.
- Cashout/cancel finalize only after pending queue settlement, then payout order applies.

### Superseded

- Earlier unreleased Slot v1 assumptions that required one payment per spin with immediate payout tx.
- Earlier solvency wording that treated full AT balance as house-owned without session-credit liability deduction.
