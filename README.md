# qortium-casino

Free-play casino for **Qortium Previewnet**: on-chain games as ATs, a CHIP free-play
asset, and a QDN web app. Successor to the never-shipped Q-Casino planning repo
(Qortal); Qortium's asset-aware AT layer (working-asset ATs, `0x053x` opcodes) removes
the constraints that stalled the original.

## Layout
- `docs/` — specs. Start with [CHIP_ASSET.md](docs/CHIP_ASSET.md) and
  [FAUCET_AT_V0.md](docs/FAUCET_AT_V0.md). Slot AT docs inherited from Q-Casino
  planning ([AT_SLOT_V1_SPEC.md](docs/AT_SLOT_V1_SPEC.md) etc.) — written for Qortal,
  to be simplified for Qortium (chips + asset opcodes, no hybrid-entropy queue needed
  for v0).
- `at/` — Java creation-bytes builders + tests for the ATs (maven).
- `games/`, `index.html`, `assets/` — web app; game pages are local-logic demos
  inherited from Q-Casino until wired to on-chain ATs.
- `scripts/` — issue/deploy/claim helpers against a Previewnet node.

## Phases
1. **Faucet loop** (current): issue CHIP → deploy prefunded faucet AT → message-to-claim
   1,000 CHIP → app "Get free chips" button.
2. **Slots AT v0**: stateless per-pull 3-reel slot, chips in / chips out
   (Dice-with-a-paytable; the old spec's sessions/RTP-profiles/entropy-queue are
   deferred).
3. Roulette, blackjack, per-user faucet enforcement (ring buffer → core opcode).

## Provenance
`games/`, `assets/`, `index.html`, and the slot docs were seeded 2026-07-11 from the
Q-Casino reference snapshot at
`/mnt/archive/archive/qubes-backup/kicksecure-lan/files/home/user/qgit/Q-Casino`.
