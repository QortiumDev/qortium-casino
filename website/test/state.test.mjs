import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksRemaining, formatNumber, getCampaignPhase, getClaimAvailability, meetsMinimumTrust } from '../src/state.js';
import { faucetClaimKeys } from '../src/bridge.js';
import { CASINO_CONFIG, isFaucetConfigured } from '../src/config.js';

const config = { activationBlock: 80000, faucetAtAddress: null, smplAssetId: null };

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
