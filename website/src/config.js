export const CASINO_CONFIG = Object.freeze({
  activationBlock: 70000,
  plannedSmplSupply: 1000,
  minimumTrust: 'BRONZE',
  // Set both only after the SMPL asset is issued and Faucet V1 is deployed.
  // These are intentionally null so the pre-launch site cannot issue a claim.
  faucetAtAddress: null,
  smplAssetId: null,
});

export function isFaucetConfigured(config = CASINO_CONFIG) {
  return typeof config.faucetAtAddress === 'string'
    && config.faucetAtAddress.length > 0
    && Number.isSafeInteger(config.smplAssetId)
    && config.smplAssetId > 0;
}
