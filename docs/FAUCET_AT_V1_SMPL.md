# Faucet AT v1 — SMPL "free sample", Bronze-or-higher, exactly once per account

Status: SPEC 2026-07-22. Target: Qortium Previewnet, requires AT map storage
(activates at block 70,000; Core `51c4731ce`+).

## Goal

The original exactly-once faucet that motivated map storage: issue **SMPL**
(indivisible, supply 1,000), prefund this AT with all of it, and an account with a
stored **Bronze, Silver, or Gold** trust snapshot can send the AT a MESSAGE to
receive exactly **1 SMPL**, once per account. Both eligibility and exactly-once
protection are enforced **on-chain**. Unverified and Suspicious accounts, and repeat
requests, are ignored (no error, no marker, no payment).

## Asset

- Name `SMPL`, indivisible, supply 1,000. Its asset ID is deliberately assigned
  by the chain: deployment tooling must look it up by name and validate its fixed
  properties; **never assume assetId 3**.
- All amounts on-chain are 1e8-scaled raw longs even for indivisible assets:
  1 SMPL grant = `100_000_000` raw.

## Map usage (design decisions)

- **Claim key** (map key1/key2, 128 bits): first 16 bytes of
  `SHA256(sender address as packed in B)`, computed in-bytecode via
  `SHA256_A_TO_B` after the sender address is in A. Rationale: the 25-byte
  address cannot fit the 16-byte map key; a truncated SHA-256 is
  collision-resistant dedup (not identity storage). No extra domain separation:
  this AT's map holds exactly one record type, and write-self semantics mean no
  other contract can pollute it.
- **Marker value**: constant `1`. Zero means "never claimed" (map returns 0 for
  unset; zero SET deletes — so the marker must be nonzero).
- **Cap interplay**: the per-AT map cap starts at 500 entries but supply is
  1,000. Decision: prefund all 1,000 anyway. When the cap fills at 500 claims,
  the mandatory readback-after-SET fails (cap-rejected SET is a no-op), so **no
  payment happens and no marker is recorded** — claims pause until dev-group
  governance raises the cap, which deliberately exercises the governance path.

## Ordering invariant (consensus-critical)

Per claim, strictly:

1. `GET_TRUST_STATUS_FROM_ACCOUNT_IN_B` (0x0522) for the non-creator sender —
   status below `BRONZE=1` ⇒ ignore **without reading or writing the map**.
2. `GET` claim key (self, B all-zero) — nonzero ⇒ already claimed ⇒ ignore.
3. Balance check — spendable SMPL < grant ⇒ ignore **without writing a marker**
   (an account must never be marked claimed and unpaid; claims resume on top-up).
4. `SET` marker = 1.
5. `GET` readback — zero ⇒ the SET was cap-rejected ⇒ ignore (no payment).
6. `PAY_ASSET_AMOUNT_TO_B` 1 SMPL to the sender.

A failed map write must never pay, and a payment must never precede its marker.

## Main loop (extends FaucetV0's builder pattern)

1. Init: cursor = creation timestamp.
2. `SLEEP_UNTIL_MESSAGE` (0x0503).
3. `PUT_TX_AFTER_TIMESTAMP_INTO_A`; none ⇒ 2.
4. Advance cursor (`GET_TIMESTAMP_FROM_TX_IN_A`).
5. Non-MESSAGE type ⇒ 3 (incoming asset/native transfers are simply kept).
6. `PUT_ADDRESS_FROM_TX_IN_A_INTO_B`, `SWAP_A_AND_B` (sender → A),
   `PUT_CREATOR_INTO_B`, compare: creator ⇒ **shutdown path**: pay entire
   configured-asset (SMPL) balance to creator, `FIN_IMD` (native remainder
   returns to creator on finish). Unclaimed map entries are simply abandoned.
7. Non-creator (sender still in A):
   - `SWAP_A_AND_B` temporarily puts the sender in B; query
     `GET_TRUST_STATUS_FROM_ACCOUNT_IN_B` (0x0522), swap back, and require a
     result of at least `BRONZE=1`. `UNVERIFIED=0`, `SUSPICIOUS=-1`, or an
     unusable address are ignored before map or balance work.
   - Save sender: `GET_A1..A4` → data vars (A gets clobbered below; B will be
     needed for the payment).
   - `SHA256_A_TO_B`; key1 = `GET_B1`, key2 = `GET_B2` → data vars.
   - `CLEAR_B` (all-zero B = read own map), `SET_A1`(key1), `SET_A2`(key2),
     `GET_MAP_VALUE_KEYS_IN_A` (0x0600) ⇒ nonzero ⇒ 3.
   - `GET_CONFIGURED_ASSET_ID` (0x0530), `GET_ASSET_BALANCE` (0x0531);
     balance < grant ⇒ 3.
   - `SET_A4`(markerOne), `SET_MAP_VALUE_KEYS_IN_A` (0x0601) — A1/A2 still hold
     the key.
   - Readback: `CLEAR_B`, re-`SET_A1`/`SET_A2` (defensive), `GET_MAP…` ⇒ zero ⇒ 3.
   - Restore sender into B: `SET_B1..B4` from saved vars.
   - `PAY_ASSET_AMOUNT_TO_B` (0x0533) with (assetId, grantAmount) ⇒ 3.

## Step budget

The trust gate adds three ordinary external calls plus one branch. Under the raised
hashing cost, a successful claim is exactly **489 of 500** steps. The unit and Core
tests pin this so a pricing or bytecode change cannot silently split a claim across
blocks.

## Function codes (raw shorts, not in the CIYAM jar)

`SLEEP_UNTIL_MESSAGE=0x0503`, `GET_CONFIGURED_ASSET_ID=0x0530`,
`GET_ASSET_BALANCE=0x0531`, `PAY_ASSET_AMOUNT_TO_B=0x0533`,
`GET_TRUST_STATUS_FROM_ACCOUNT_IN_B=0x0522` (stored snapshot: Suspicious=-1,
Unverified=0, Bronze=1, Silver=2, Gold=3),
`GET_MAP_VALUE_KEYS_IN_A=0x0600` (0 params, returns value),
`SET_MAP_VALUE_KEYS_IN_A=0x0601` (0 params, no return; key A1/A2, value A4,
zero deletes; GET reads target AT address from B, all-zero B = self).

## Testing

1. **Unit (this repo)**: CIYAM `MachineState` + test `API` subclass stubbing the
   platform functions incl. an in-memory map honoring the 500-entry cap and
   cap-rejected-SET-as-no-op. Cases: first claim pays exactly 1 SMPL raw and
   records the marker; Bronze/Silver/Gold accounts are eligible while Unverified
   and Suspicious accounts leave no marker or payment; second claim from the same
   account is ignored; distinct accounts each get one; unfunded claim leaves NO marker and later succeeds
   after top-up; cap-full claim leaves no marker and pays nothing; creator
   message sweeps balance and finishes; non-MESSAGE txs skipped; step count
   asserted under budget.
2. **End-to-end (qortium-core)**: embed the canonical creation bytes (below) in
   a Core test against the map-enabled test chain: deploy, real MESSAGE txs,
   Bronze success and Unverified/Suspicious rejection without map or balance change,
   first-claim pay / repeat-ignore, same-block double claim from one account
   (second must see the overlay marker), unfunded pause without marker,
   readback-guard behavior at the cap, creator shutdown, and orphan/rollback of
   a claim block restoring both marker absence and balances. Plus the
   69,999→70,000 rehearsal: deployment and claims must fail cleanly pre-trigger
   and work at exactly the trigger height.

## Artifacts

- Builder: `at/src/main/java/org/qortium/at/casino/FaucetV1.java`
  (pattern-identical to FaucetV0; two-pass label resolution).
- Canonical creation bytes: `at/faucet-v1-creation-bytes.txt` (hex + Base58),
  regenerated-and-asserted by a unit test so the committed artifact can't drift
  from the builder. Core's e2e test embeds this hex with a provenance comment.
- AT dependency: repinned from `com.github.QuickMythril:AT:1b731d1` to
  `com.github.QortiumDev:AT:0525eec` — the exact commit qortium-core pins for
  consensus. CI installs Core's vendored `lib/…/AT-0525eec.jar` and POM from a
  fixed Core commit after checking both SHA-256 hashes.

## Deployment (later, user-run)

Use `scripts/bootstrap-smpl-faucet.sh` (not the CHIP-v0 bootstrap): it checks a
fully synced **full** Core 1.6.0+ node and refuses to proceed below height 70,000;
it then finds or issues the exact fixed SMPL asset, looks up its chain-assigned
asset ID, and deploys only the committed canonical creation bytes. The script is
user-run because it signs with the treasury key.

The bootstrap and standalone SMPL operator scripts refuse to continue if a
matching SMPL issuance is already unconfirmed or if any confirmed/unconfirmed
`DEPLOY_AT` exists on the clean Previewnet slate. Transaction submission uses
Core API v2 and verifies the returned transaction type and signature. A
successful deployment prints the deterministic `atAddress`; record that exact
value before testing a claim.

The deploy request is deliberately `fee: "0"` and `nativeFeeReserve: "0"`:
Previewnet has no native asset. It prefunds `amount: "1000"` in the API's decimal
format, which Core converts to `100_000_000_000` raw units for the indivisible
asset. Do **not** deploy this AT pre-trigger: a pre-70,000 trust-query (and later map)
call fatally errors the faucet on its first claim. After confirmation, make one
real MESSAGE claim only after the user has approved that live acceptance step.
