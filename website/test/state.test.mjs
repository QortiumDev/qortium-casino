import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksRemaining, formatNumber, getCampaignPhase, getClaimAvailability, meetsMinimumTrust } from '../src/state.js';

const config = { activationBlock: 70000, faucetAtAddress: null, smplAssetId: null };

test('campaign waits below activation, then honestly says coming soon without a faucet', () => {
  assert.equal(getCampaignPhase(69999, config), 'countdown');
  assert.equal(getCampaignPhase(70000, config), 'coming-soon');
  assert.equal(blocksRemaining(69674, 70000), 326);
});

test('campaign exposes claim only with both deployed identifiers', () => {
  assert.equal(getCampaignPhase(70000, { ...config, faucetAtAddress: 'AT1', smplAssetId: 12 }), 'claim');
  assert.equal(getCampaignPhase(null, config), 'checking');
});

test('Bronze and higher are eligible only in Home after the faucet is live', () => {
  assert.equal(meetsMinimumTrust('bronze', 'BRONZE'), true);
  assert.equal(meetsMinimumTrust('UNVERIFIED', 'BRONZE'), false);
  assert.equal(getClaimAvailability({ phase: 'claim', inHome: true, trustStatus: 'SILVER', minimumTrust: 'BRONZE' }).enabled, true);
  assert.match(getClaimAvailability({ phase: 'claim', inHome: true, trustStatus: 'UNVERIFIED', minimumTrust: 'BRONZE' }).reason, /below/);
  assert.equal(getClaimAvailability({ phase: 'claim', inHome: false, trustStatus: 'GOLD', minimumTrust: 'BRONZE' }).enabled, false);
});

test('formats the planned pool without locale surprises', () => {
  assert.equal(formatNumber(1000), '1,000');
  assert.equal(formatNumber('not-a-number'), '0');
});
