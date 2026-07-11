# Slot Parameter Model (Cross-AT Plan)

## Purpose

Define which parameters are shared across slot AT families, which are family-specific, and how RTP customization works.

## AT Family Split (Accepted Plan)

Use separate AT families/code hashes:

- `slot3` AT family (3-reel logic)
- `slot5` AT family (5-reel logic)

Reason:

- Lower code-size and branch complexity per AT.
- Easier testing/auditing and safer rollouts.
- 5-reel changes do not risk 3-reel behavior.

## Shared Deploy Parameters (Both Families)

- `minBetAtoms`
- `maxBetAtoms`
- `betStepAtoms`
- `payoutFeeReserveAtoms`
- `sessionInactivityBlocks`
- `entropyConfirmDepthK` (hybrid entropy confirmation depth)
- `rtpMode` (`0=profile`, `1=custom`)
- `rtpProfileId` (required when `rtpMode=profile`)
- `rtpBpsDisplay` (derived/display value)
- `maxPayoutMultiplier` (derived/safety value)
- `reelsLayoutVersion`
- `paytableVersion`

These values should be present in both AT families with the same meaning where possible.

Entropy default policy:

- `entropyConfirmDepthK` default is `2`.
- allowed deploy range is `1..3`.
- higher value improves reorg robustness but increases settlement delay.

## Family-Specific Parameters

- `slot3`:
  - reel count fixed to `3`
  - custom payout vector length: `12` outcomes
- `slot5`:
  - reel count fixed to `5`
  - custom payout vector length: `32` outcomes

## RTP Customization Strategy

### Mode A: Profile Mode

- Creator selects `rtpProfileId` (`tight`, `standard`, `loose`).
- AT uses built-in profile tables.
- Best for simple/verified machines.

### Mode B: Custom Mode

- Creator provides payout vector in AT data segment.
- AT evaluates outcomes against custom multipliers.
- UI computes/displays expected RTP and marks machine as custom.

## Custom Mode Guardrails

At deploy-time validation:

- `minBetAtoms > 0`
- `maxBetAtoms >= minBetAtoms`
- `betStepAtoms > 0`
- both min/max divisible by step
- each payout multiplier within configured cap
- monotonic sanity rules for same-symbol tiers (for example 5-of-kind >= 4-of-kind >= 3-of-kind)
- `maxPayoutMultiplier` derived from table maximum

At runtime:

- payout must pass bankroll safety check before payment.

## Bankroll Solvency Policy (Shared)

Use the same runtime solvency model in both families:

1. Per-pull hard solvency check
   - `playerLiability = activeSessionCredit`
   - `houseOwnedBalance = max(0, currentBalance - playerLiability)`
   - `safeHouseBalance = max(0, houseOwnedBalance - payoutFeeReserveAtoms)`
   - `required = betAmount * maxPayoutMultiplier`
   - accept pull only when `safeHouseBalance >= required`
2. Dynamic max bet from live balance
   - `effectiveMaxBet = floor((safeHouseBalance / maxPayoutMultiplier) / betStepAtoms) * betStepAtoms`
   - runtime play check is `betAmount <= min(configuredMaxBet, effectiveMaxBet)`
3. Underfunded machine behavior
   - if `effectiveMaxBet < minBetAtoms`, machine is temporarily unplayable until topped up
   - machine remains active; creator can still fund or cancel

This avoids insolvent win commitments while preventing avoidable payout failures.

## Session Occupancy Policy (v1)

- v1 uses one active player session per machine.
- Session ownership is acquired by first accepted deposit when session is empty.
- Same player can top up with additional deposits.
- Other players' deposits while occupied are refunded.
- Session auto-cashes out after `sessionInactivityBlocks` without valid action.

## Entropy Policy (v1)

- Pulls are queued in deterministic tx order.
- First unresolved pull is entropy anchor for an epoch.
- Settlement waits for anchor confirmation depth (`entropyConfirmDepthK`).
- Epoch seed is generated via `0x0308` against anchor tx (two-call behavior).
- Queued pulls resolve from deterministic expansion of epoch seed and per-pull tx context.

## Creator Funding Guidance (Operational)

Absolute minimum at deployment:

- `minFunding = payoutFeeReserveAtoms + (minBetAtoms * maxPayoutMultiplier)`

Recommended startup bankroll (operational, not consensus rule):

### 3-Reel (`slot3`)

- Tight: `10x` minimum exposure
- Standard: `12x` minimum exposure
- Loose: `15x` minimum exposure

At `minBet=1 QORT` (excluding reserve):

- Tight (`maxMult=1940`): minimum `1,940`, recommended `~19,400`
- Standard (`maxMult=2000`): minimum `2,000`, recommended `~24,000`
- Loose (`maxMult=2080`): minimum `2,080`, recommended `~31,200`

### 5-Reel (`slot5`, draft)

- Tight: `8x` minimum exposure
- Standard: `10x` minimum exposure
- Loose: `12x` minimum exposure

At `minBet=1 QORT` (excluding reserve):

- Tight (`maxMult=3867`): minimum `3,867`, recommended `~30,936`
- Standard (`maxMult=4028`): minimum `4,028`, recommended `~40,280`
- Loose (`maxMult=4109`): minimum `4,109`, recommended `~49,308`

## Data Size Notes

- 3-reel custom vector: `12 * 8 = 96` bytes
- 5-reel custom vector: `32 * 8 = 256` bytes

This is expected to be manageable, but final state-size checks are required during implementation.

## Hash Behavior

- 3-reel and 5-reel families use different code hashes.
- Within each family, profile/custom can share one hash if both modes are supported in code and selected by data.

## Rollout Recommendation

1. Ship `slot3` with profile mode first.
2. Add bounded custom mode to `slot3` after profile path is stable.
3. Implement `slot5` with profile mode.
4. Add bounded custom mode to `slot5` after stability and size/step verification.
