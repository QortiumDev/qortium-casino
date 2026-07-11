# CHIP asset (Previewnet, free-play)

Status: DRAFT 2026-07-11 — parameters pending QuickMythril confirmation before issuance.

## Purpose
Casino-wide free-play currency for all qortium-casino games (slots first). One asset for
the whole casino, not per-game — game identity is the AT address, not the token. CHIP has
**no redeemable value**; it exists so people can test the games and the AT/asset stack.

## Proposed parameters (ISSUE_ASSET on Previewnet)
- name: `CHIP`
- description: "Qortium Casino free-play chip. No monetary value."
- quantity: `1_000_000_000` (1B)
- isDivisible: `false` (whole chips only; bets are 10–50 CHIP so integers suffice, and it
  avoids decimal confusion in the UI)
- issuer: TBD (QuickMythril account vs QortiumHomeTest test account)

## Distribution
- Faucet AT (see [FAUCET_AT_V0.md](FAUCET_AT_V0.md)) prefunded with CHIP; grants
  1,000 CHIP per claim message.
- Grant size vs bet size is the psychology lever: 1,000 CHIP with 10–50 CHIP bets feels
  like 20–100 decisions. Tune min/max bet to the grant, not vice versa.
- Daily-claim cadence enforced app-side in v0 (see faucet spec for the honest-enforcement
  roadmap: ring buffer v1 → last-payment-timestamp opcode later).

## Economics notes
- Free-test phase: sybil claiming is tolerated (each claim costs a native tx fee anyway).
  Optional gate exists if needed: `GET_ACCOUNT_LEVEL_FROM_ACCOUNT_IN_B >= 1`.
- If CHIP ever becomes redeemable, revisit: issuance custody, buyback AT, and real
  per-user faucet enforcement become mandatory first.
