import { isFaucetConfigured } from './config.js';

export const TRUST_ORDER = Object.freeze({
  SUSPICIOUS: 0,
  UNVERIFIED: 1,
  BRONZE: 2,
  SILVER: 3,
  GOLD: 4,
});

export function formatNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(Number(value) || 0);
}

export function normaliseTrust(value) {
  const trust = String(value || 'UNVERIFIED').toUpperCase();
  return Object.hasOwn(TRUST_ORDER, trust) ? trust : 'UNVERIFIED';
}

export function meetsMinimumTrust(trust, minimumTrust) {
  return TRUST_ORDER[normaliseTrust(trust)] >= TRUST_ORDER[normaliseTrust(minimumTrust)];
}

export function getCampaignPhase(height, config) {
  if (!Number.isFinite(height)) return 'checking';
  if (height < config.activationBlock) return 'countdown';
  return isFaucetConfigured(config) ? 'claim' : 'coming-soon';
}

export function blocksRemaining(height, activationBlock) {
  return Math.max(0, activationBlock - (Number(height) || 0));
}

export function getClaimAvailability({ phase, inHome, trustStatus, minimumTrust, claimStatus }) {
  if (phase === 'checking') return { enabled: false, reason: 'Checking the chain before opening the vault.' };
  if (phase === 'countdown') return { enabled: false, reason: 'The contract opens at block 70,000.' };
  if (phase === 'coming-soon') return { enabled: false, reason: 'The chain is ready; the faucet is coming very soon.' };
  if (!inHome) return { enabled: false, reason: 'Open this site in Qortium Home to claim.' };
  if (claimStatus === true) return { enabled: false, reason: 'This selected account already received its ceremonial SMPL.' };
  if (!meetsMinimumTrust(trustStatus, minimumTrust)) {
    return { enabled: false, reason: `${normaliseTrust(trustStatus)} is below the on-chain Bronze minimum.` };
  }
  return { enabled: true, reason: 'Home will ask for transaction approval before sending your claim message.' };
}
