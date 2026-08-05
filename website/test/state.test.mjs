import test from 'node:test';
import assert from 'node:assert/strict';
import { atCursorHeight, blocksRemaining, formatNumber, getCampaignPhase, getClaimAvailability, getClaimOutcome, meetsMinimumTrust, resolveAssetId } from '../src/state.js';
import { faucetClaimKeys, readClaimMarker } from '../src/bridge.js';
import { CASINO_CONFIG, isFaucetConfigured } from '../src/config.js';

const config = { activationBlock: 80000, faucetAtAddress: null, smplAssetId: null };

// A claim that Home accepted, the chain confirmed into block 80,500, and whose ledger read
// succeeded and came back empty. Only `faucetCursorHeight` then decides queued vs declined.
const CLAIMANT = 'QXHdsTPtPsLYXjr74gBLrpTjdTkSd4dXbK';
const SENT = Object.freeze({
  claimSent: true,
  claimSentAddress: CLAIMANT,
  claimSignature: 'sig-of-the-claim-message',
  claimConfirmedHeight: 80500,
  claimStatus: false,
});

test('campaign waits below activation, then honestly says coming soon without a faucet', () => {
  assert.equal(getCampaignPhase(79999, config), 'countdown');
  assert.equal(getCampaignPhase(80000, config), 'coming-soon');
  assert.equal(blocksRemaining(79674, 80000), 326);
});

test('campaign exposes claim only with both deployed identifiers', () => {
  assert.equal(getCampaignPhase(80000, { ...config, faucetAtAddress: 'AT1', smplAssetId: 12 }), 'claim');
  assert.equal(getCampaignPhase(null, config), 'checking');
});

test('shipped config carries the deployed faucet and the re-opening height', () => {
  assert.equal(isFaucetConfigured(CASINO_CONFIG), true);
  assert.equal(CASINO_CONFIG.activationBlock, 80000);
  assert.equal(CASINO_CONFIG.smplAssetId, 3);
});

test('countdown copy quotes the configured activation block, not a stale one', () => {
  const availability = getClaimAvailability({ phase: 'countdown', activationBlock: config.activationBlock });
  assert.equal(availability.enabled, false);
  assert.match(availability.reason, /80,000/);
});

test('Bronze and higher are eligible only in Home after the faucet is live', () => {
  assert.equal(meetsMinimumTrust('bronze', 'BRONZE'), true);
  assert.equal(meetsMinimumTrust('UNVERIFIED', 'BRONZE'), false);
  assert.equal(getClaimAvailability({ phase: 'claim', inHome: true, trustStatus: 'SILVER', minimumTrust: 'BRONZE' }).enabled, true);
  assert.match(getClaimAvailability({ phase: 'claim', inHome: true, trustStatus: 'UNVERIFIED', minimumTrust: 'BRONZE' }).reason, /below/);
  assert.match(getClaimAvailability({ phase: 'claim', inHome: true, trustStatus: 'GOLD', minimumTrust: 'BRONZE', claimStatus: true }).reason, /already received/);
  assert.equal(getClaimAvailability({ phase: 'claim', inHome: false, trustStatus: 'GOLD', minimumTrust: 'BRONZE' }).enabled, false);
});

test('formats the planned pool without locale surprises', () => {
  assert.equal(formatNumber(1000), '1,000');
  assert.equal(formatNumber('not-a-number'), '0');
});

test('derives the exact padded-address map keys used by Faucet V1', async () => {
  const keys = await faucetClaimKeys('QixPbJUwsaHsVEofJdozU9zgVqkK6aYhrK');
  assert.deepEqual(keys, [-4712341010936457684n, -4822863109364650559n]);
});

test('reproduces the live Faucet V1 claim keys observed on Previewnet', async () => {
  // Verified 2026-08-05 against /at/AG9QWs1tEBTmXoH2rrQXwV4LdMAM99o5WD/map/value:
  // these keys return value 1 for a paid claimant and 0 for the Bronze-gate rejection.
  assert.deepEqual(
    await faucetClaimKeys('QT4zHex8JEULmBhYmKd5UhpiNA46T5wUko'),
    [4231512295620517273n, -2116919403778073510n],
  );
  assert.deepEqual(
    await faucetClaimKeys('Qav323D9mPm8xVj86PgSMw7K9Rm717ATgU'),
    [6397016502246601997n, -5465137485528062985n],
  );
});

test('the on-chain claim marker outranks a locally sent claim', () => {
  // Regression: claimSent used to be tested first, pinning a settled claim to "pending"
  // for the rest of the session and hiding the success state entirely.
  const outcome = getClaimOutcome({ ...SENT, claimStatus: true });
  assert.equal(outcome.kind, 'confirmed');
});

test('a settled marker still wins long after the faucet scanned past the claim', () => {
  assert.equal(getClaimOutcome({ ...SENT, faucetCursorHeight: 99999, claimStatus: true }).kind, 'confirmed');
});

test('a claim stays pending until the faucet has actually scanned past its block', () => {
  // The faucet settles at most one claim per block, so a backlog is ordinary. Only a cursor
  // strictly past our block proves it looked at us and recorded nothing.
  assert.equal(getClaimOutcome({ ...SENT, faucetCursorHeight: 80490 }).kind, 'pending');
  assert.equal(getClaimOutcome({ ...SENT, faucetCursorHeight: 80500 }).kind, 'pending');

  const declined = getClaimOutcome({ ...SENT, faucetCursorHeight: 80501 });
  assert.equal(declined.kind, 'declined');
  assert.equal(declined.confirmedAt, 80500);
});

test('a deep queue is never mistaken for a refusal, however long it takes', () => {
  // Codex review case: with the whole remaining map capacity queued ahead, the marker can
  // legitimately arrive hundreds of blocks later. Elapsed time must not convict the faucet.
  assert.equal(getClaimOutcome({ ...SENT, faucetCursorHeight: 80499 }).kind, 'pending');
  // Same block as ours is ambiguous by intra-block sequence, so it must stay pending too.
  assert.equal(getClaimOutcome({ ...SENT, faucetCursorHeight: 80500 }).kind, 'pending');
});

test('an unknown faucet cursor can never manufacture a refusal', () => {
  assert.equal(getClaimOutcome({ ...SENT, faucetCursorHeight: null }).kind, 'pending');
  assert.equal(getClaimOutcome({ ...SENT, faucetCursorHeight: undefined }).kind, 'pending');
  assert.equal(getClaimOutcome({ ...SENT, faucetCursorHeight: 'nope' }).kind, 'pending');
});

test('a claim message Home accepted but the chain has not included is not the faucet\'s doing', () => {
  // Regression: Number(null) is 0, which read an unconfirmed claim as confirmed in block 0 and
  // let any cursor convict the faucet of declining a message it had never even seen.
  for (const claimConfirmedHeight of [null, undefined, 0, '', 'soon']) {
    assert.equal(
      getClaimOutcome({ ...SENT, claimConfirmedHeight, faucetCursorHeight: 99999 }).kind,
      'unconfirmed',
      `claimConfirmedHeight ${JSON.stringify(claimConfirmedHeight)} must read as unconfirmed`,
    );
  }
});

test('an unreadable ledger, or an untrackable message, is never reported as a refusal', () => {
  // Only a ledger we actually read (claimStatus === false) may convict the faucet.
  assert.equal(getClaimOutcome({ ...SENT, claimStatus: 'unknown' }).kind, 'unaccounted');
  assert.equal(getClaimOutcome({ ...SENT, claimStatus: undefined }).kind, 'unaccounted');
  // No signature means we cannot follow our own message, so we claim nothing about it.
  assert.equal(getClaimOutcome({ ...SENT, claimSignature: null, faucetCursorHeight: 99999 }).kind, 'unaccounted');
});

test('switching the selected account does not let it inherit another account\'s claim', () => {
  // Codex review case: A sends, Home switches to B. B must start clean, not adopt A's pending
  // claim, and must never be told a claim it never made was declined.
  const asB = { ...SENT, claimantAddress: 'QBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', faucetCursorHeight: 99999 };
  assert.equal(getClaimOutcome(asB).kind, 'idle');
  // The original claimant still sees the real verdict.
  assert.equal(getClaimOutcome({ ...SENT, claimantAddress: CLAIMANT, faucetCursorHeight: 99999 }).kind, 'declined');
});

test('claim outcome stays idle before sending and surfaces send errors', () => {
  assert.equal(getClaimOutcome().kind, 'idle');
  assert.equal(getClaimOutcome({ claimStatus: 'unknown' }).kind, 'idle');
  assert.equal(getClaimOutcome({ claimError: 'Home said no' }).kind, 'error');
});

test('decodes the faucet scan cursor out of a CIYAM AT timestamp', () => {
  // Observed live 2026-08-05: sleepUntilMessageTimestamp 345809291837440 for a faucet whose
  // last processed claim MESSAGE confirmed in block 80,515.
  assert.equal(atCursorHeight(345809291837440), 80515);
  assert.equal(atCursorHeight(0), null);
  assert.equal(atCursorHeight(null), null);
  assert.equal(atCursorHeight(undefined), null);
  assert.equal(atCursorHeight('nonsense'), null);
});

test('the deployed AT decides the working asset, with config only as a fallback', () => {
  assert.equal(resolveAssetId(7, 3), 7);
  assert.equal(resolveAssetId(3, 3), 3);
  assert.equal(resolveAssetId(undefined, 3), 3);
  assert.equal(resolveAssetId(null, 3), 3);
  assert.equal(resolveAssetId(0, 3), 3);
  assert.equal(resolveAssetId('not-an-asset', 3), 3);
});

test('an unreadable claim marker is an error, never a silent "already claimed"', () => {
  // Regression: `Number(entry?.value) !== 0` is true for undefined/NaN, so a body we failed to
  // parse reported the account as already paid — permanently locking out an eligible guest.
  assert.equal(readClaimMarker({ value: 0 }), false);
  assert.equal(readClaimMarker({ value: 1 }), true);
  assert.equal(readClaimMarker({ value: '1' }), true);
  for (const entry of [undefined, null, {}, { value: null }, { value: 'yes' }, 'not json', { nope: 1 }]) {
    assert.throws(() => readClaimMarker(entry), /readable marker value/,
      `entry ${JSON.stringify(entry)} must not be read as a claim`);
  }
});
