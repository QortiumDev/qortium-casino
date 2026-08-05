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

/**
 * A CIYAM AT "timestamp" packs the block height into its high 32 bits (then 8 bits of
 * blockchain ID and 24 bits of intra-block sequence — see org.ciyam.at.Timestamp). The AT's
 * `sleepUntilMessageTimestamp` is the timestamp of the last transaction its scan consumed, so
 * this yields the block the faucet's cursor has reached.
 *
 * Returns null when there is nothing to decode, which callers must treat as "unknown" rather
 * than as block zero.
 */
export function atCursorHeight(sleepUntilMessageTimestamp) {
  const raw = Number(sleepUntilMessageTimestamp);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw / 4_294_967_296);
}

/**
 * Resolves what actually became of a claim, using only evidence rather than a timeout.
 *
 * The order of these checks is the whole point:
 *
 * 1. The contract's own claim ledger outranks our local "we sent it" flag. It is the only
 *    authority on whether an account has been paid, and testing `claimSent` first pins a
 *    settled claim to "pending" for the rest of the session.
 * 2. A claim belongs to the account that sent it. Home can switch the selected account at any
 *    time, and the new account must not inherit the old one's claim.
 * 3. We only speak about the ledger when we could actually read it.
 * 4. Home accepting a MESSAGE is not the chain including it, so an unconfirmed claim is
 *    reported as unconfirmed — not as something the faucet did.
 * 5. Faucet V1 advances its cursor BEFORE filtering, so a claim it declines (below-Bronze
 *    trust snapshot, faucet underfunded, or map cap reached) is consumed leaving no marker, no
 *    payment and no on-chain error, and is never retried. That is only *provable* once the
 *    cursor has moved strictly past our claim's own block: at that point the faucet has
 *    definitely looked at our message and recorded nothing. Before then it is still queued —
 *    the faucet settles at most one claim per block (489 of 500 steps), so a backlog is
 *    ordinary and must never be mistaken for a refusal. An unknown cursor stays "pending",
 *    so a failed read can never manufacture a refusal.
 */
export function getClaimOutcome({
  claimSent, claimSentAddress, claimantAddress, claimSignature, claimConfirmedHeight,
  faucetCursorHeight, claimStatus, claimError,
} = {}) {
  if (claimStatus === true) return { kind: 'confirmed' };
  if (claimError) return { kind: 'error' };
  if (!claimSent) return { kind: 'idle' };
  if (claimSentAddress && claimantAddress && claimSentAddress !== claimantAddress) return { kind: 'idle' };
  // Without a readable ledger, or without the signature that lets us follow our own message,
  // we cannot account for the claim — and must not invent a verdict for it either way.
  if (claimStatus !== false || !claimSignature) return { kind: 'unaccounted' };

  // Note Number(null) === 0, which would read an unconfirmed claim as confirmed in block 0 and
  // then let any cursor convict the faucet. Heights must be positive to count as real.
  const confirmedAt = toHeight(claimConfirmedHeight);
  if (confirmedAt === null) return { kind: 'unconfirmed' };

  const cursor = toHeight(faucetCursorHeight);
  return cursor !== null && cursor > confirmedAt
    ? { kind: 'declined', confirmedAt, cursor }
    : { kind: 'pending', confirmedAt };
}

function toHeight(value) {
  if (value === null || value === undefined || value === '') return null;
  const height = Number(value);
  return Number.isFinite(height) && height > 0 ? height : null;
}

/**
 * The AT's own configured working asset is authoritative: the deployment tooling never
 * assumes an asset ID and neither should the site. The bundled value is only a fallback for
 * when the chain read fails, so a redeploy against a different asset cannot leave us
 * reporting some unrelated asset's balance as the vault.
 */
export function resolveAssetId(chainAssetId, configuredAssetId) {
  const fromChain = Number(chainAssetId);
  return Number.isSafeInteger(fromChain) && fromChain > 0 ? fromChain : configuredAssetId;
}

export function getClaimAvailability({ phase, inHome, trustStatus, minimumTrust, claimStatus, activationBlock }) {
  if (phase === 'checking') return { enabled: false, reason: 'Checking the chain before opening the vault.' };
  if (phase === 'countdown') return { enabled: false, reason: `The contract re-opens at block ${formatNumber(activationBlock)}.` };
  if (phase === 'coming-soon') return { enabled: false, reason: 'The chain is ready; the faucet is coming very soon.' };
  if (!inHome) return { enabled: false, reason: 'Open this site in Qortium Home to claim.' };
  if (claimStatus === true) return { enabled: false, reason: 'This selected account already received its ceremonial SMPL.' };
  if (!meetsMinimumTrust(trustStatus, minimumTrust)) {
    return { enabled: false, reason: `${normaliseTrust(trustStatus)} is below the on-chain Bronze minimum.` };
  }
  return { enabled: true, reason: 'Home will ask for transaction approval before sending your claim message.' };
}
