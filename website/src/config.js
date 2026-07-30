export const CASINO_CONFIG = Object.freeze({
  // Re-opening height: the atNoNativeAssetFeeWaiverHeight feature trigger
  // (Core 1.6.2). The AT below is deployed and prefunded but cannot execute
  // a step before this height, because step fees were priced in the chain's
  // absent native asset. Original opening was 70,000.
  activationBlock: 80000,
  plannedSmplSupply: 1000,
  minimumTrust: 'BRONZE',
  // Faucet V1, confirmed at Previewnet block 73,375 with 1,000 SMPL prefunded.
  // Values read from the confirmed DEPLOY_AT; do not change without a redeploy.
  faucetAtAddress: 'AG9QWs1tEBTmXoH2rrQXwV4LdMAM99o5WD',
  smplAssetId: 3,
});

export function isFaucetConfigured(config = CASINO_CONFIG) {
  return typeof config.faucetAtAddress === 'string'
    && config.faucetAtAddress.length > 0
    && Number.isSafeInteger(config.smplAssetId)
    && config.smplAssetId > 0;
}
