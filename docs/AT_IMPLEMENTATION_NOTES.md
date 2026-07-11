# AT Implementation Notes

## Reference Repositories

- CIYAM AT core/opcodes: `~/github/AT`
- Qortal runtime/API integration: `~/github/qortal`
- Qortal lottery+dice examples: `~/Documents/github/lottery`

## Useful Example Files

- Dice AT: `~/Documents/github/lottery/src/main/java/org/qortal/at/lottery/Dice.java`
- Dice tests: `~/Documents/github/lottery/src/test/java/org/qortal/at/lottery/DiceTests.java`
- Lottery AT: `~/Documents/github/lottery/src/main/java/org/qortal/at/lottery/Lottery.java`

## Function Codes To Use (Likely)

- `GET_CREATION_TIMESTAMP`
- `PUT_TX_AFTER_TIMESTAMP_INTO_A`
- `CHECK_A_IS_ZERO`
- `GET_TIMESTAMP_FROM_TX_IN_A`
- `PUT_ADDRESS_FROM_TX_IN_A_INTO_B`
- `GET_TYPE_FROM_TX_IN_A`
- `GET_AMOUNT_FROM_TX_IN_A`
- `GET_CURRENT_BALANCE`
- `PAY_TO_ADDRESS_IN_B`
- `PAY_ALL_TO_ADDRESS_IN_B`
- `GENERATE_RANDOM_USING_TX_IN_A` (`0x0308`)
- `SHA256_INTO_B`
- `GET_B1..GET_B4`
- `GET_B_DAT` / `SET_B_DAT`
- Qortal: `GET_MESSAGE_LENGTH_FROM_TX_IN_A`
- Qortal: `PUT_PARTIAL_MESSAGE_FROM_TX_IN_A_INTO_B`
- Qortal: `SLEEP_UNTIL_MESSAGE` / `SLEEP_UNTIL_MESSAGE_OR_HEIGHT`

## Testing Expectations

- Unit-level AT behavior tests (compile + execution cycles).
- Determinism tests for repeated node replay.
- Statistical sanity tests on reel stop frequencies.
- Per-profile payout branch tests (`rtpProfileId` 1..3).
- Per-mode payout branch tests (`rtpMode=profile/custom`).
- Session ownership tests (empty -> occupied -> empty).
- Non-owner payment-while-occupied refund tests.
- Cashout message tests.
- Inactivity auto-cashout tests.
- Creator-cancel settlement order tests (player credit first, creator remainder second).
- Creator-play tests.
- Solvency formula tests (`houseOwnedBalance`, `safeHouseBalance`, `requiredPayout`, `effectiveMaxBet`).
- Low-bankroll pause behavior tests (`effectiveMaxBet < minBet`).
- Burst tx tests (multiple messages in one block, bounded by step budget).
- Hybrid entropy tests:
  - anchor selection from first unresolved queued pull
  - confirmation-depth gating (`entropyConfirmDepthK`)
  - `0x0308` two-call sleep/return behavior
  - deterministic per-pull expansion from epoch seed + pull tx context
  - queue drain ordering and ring-buffer wrap behavior
- Settlement gating tests:
  - cashout defers until pending queue is drained
  - creator cancel defers until pending queue is drained, then pays player first

## Size/Complexity Notes

- Embedding three paytables in AT code is expected to be size-safe, but final compiled code must still respect Qortal deploy limits (notably AT code size and overall creation/state size constraints).
- Qortal default chain settings currently expose `maxStepsPerRound=500` and `stepsPerFunctionCall=10`; message burst behavior must be measured against this budget.
- 5-reel logic increases branch count and payout table size; run early code-size checks before implementation commits.
- Keep 3-reel and 5-reel as separate AT families to limit per-contract complexity.
