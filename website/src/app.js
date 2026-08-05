import { CASINO_CONFIG } from './config.js';
import { getAccountData, getFaucetAt, getFaucetBalance, getFaucetClaimStatus, getNodeStatus, getSelectedAccount, getTransactionHeight, isHome, sendClaimMessage } from './bridge.js';
import { atCursorHeight, blocksRemaining, formatNumber, getCampaignPhase, getClaimAvailability, getClaimOutcome, normaliseTrust, resolveAssetId } from './state.js';

const $ = (id) => document.getElementById(id);
const ui = Object.freeze({
  phaseBadge: $('phase-badge'), blockLabel: $('block-label'), blockCount: $('block-count'), blockCaption: $('block-caption'), progress: $('progress-meter'),
  supplyLabel: $('supply-label'), supplyCount: $('supply-count'), supplyCaption: $('supply-caption'),
  accountName: $('account-name'), trustStatus: $('trust-status'), eligibility: $('eligibility-copy'),
  claimTitle: $('claim-title'), claimCopy: $('claim-copy'), claimButton: $('claim-button'),
});

let current = {
  height: null, trustStatus: 'UNVERIFIED', inHome: isHome(), account: null, phase: 'checking', claimStatus: 'unknown',
  // A claim in flight. `claimSentAddress` binds it to the account that sent it, because Home can
  // switch the selected account at any moment. The signature lets us ask the chain whether the
  // message actually confirmed, and `faucetCursorHeight` says how far the faucet has scanned —
  // together those decide whether a missing marker means "queued" or "declined".
  claimSent: false, claimSentAddress: null, claimSignature: null, claimConfirmedHeight: null,
  faucetCursorHeight: null, claimError: null,
  // Resolved from the deployed AT; the config value is only a fallback.
  assetId: CASINO_CONFIG.smplAssetId,
};

function getHeight(status) {
  const height = Number(status?.height ?? status?.numberOfBlocks);
  return Number.isFinite(height) ? height : null;
}

function accountAddress(account, data) {
  return account?.address || account?.selectedAddress || data?.address || null;
}

function render() {
  const { activationBlock, plannedSmplSupply, minimumTrust } = CASINO_CONFIG;
  const remaining = blocksRemaining(current.height, activationBlock);
  const availability = getClaimAvailability({ ...current, minimumTrust, activationBlock });
  const belowActivation = current.phase === 'countdown';

  ui.blockLabel.textContent = belowActivation ? 'GRAND RE-OPENING IN' : 'THE VAULT DOOR';
  ui.blockCount.textContent = current.height === null ? '—' : belowActivation ? formatNumber(remaining) : 'OPEN';
  ui.blockCaption.textContent = current.height === null
    ? 'Connecting to Previewnet for the block count.'
    : belowActivation ? `blocks until ${formatNumber(activationBlock)}. The roulette wheel is warming up. Again.` : `Previewnet is at block ${formatNumber(current.height)}.`;
  ui.progress.style.width = current.height === null ? '0%' : `${Math.min(100, (current.height / activationBlock) * 100)}%`;

  const phaseCopy = {
    checking: ['loading', 'Checking the velvet rope…'],
    countdown: ['countdown', `THE VAULT RE-OPENS AT BLOCK ${formatNumber(activationBlock)}`],
    'coming-soon': ['soon', `BLOCK ${formatNumber(activationBlock)}: ACHIEVED. VAULT: COMING VERY SOON.`],
    claim: ['open', 'THE SMPL VAULT IS OPEN'],
  }[current.phase];
  ui.phaseBadge.className = `phase-badge ${phaseCopy[0]}`;
  ui.phaseBadge.textContent = phaseCopy[1];

  const balanceUnknown = current.faucetBalance === undefined;
  ui.supplyLabel.textContent = balanceUnknown ? 'SMPL IN VAULT' : 'SMPL REMAINING IN VAULT';
  ui.supplyCount.textContent = balanceUnknown ? '—' : formatNumber(current.faucetBalance);
  ui.supplyCaption.textContent = balanceUnknown
    ? `Waiting on a live read from the vault. ${formatNumber(plannedSmplSupply)} SMPL were confirmed into it at block 73,375.`
    : 'Live read from the deployed faucet AT.';

  const address = accountAddress(current.account, current.accountData);
  ui.accountName.textContent = address ? `${address.slice(0, 7)}…${address.slice(-6)}` : 'Open in Qortium Home';
  ui.trustStatus.textContent = address ? `Trust status: ${current.trustStatus}` : 'Trust status: waiting for Home';
  ui.trustStatus.className = `trust-status ${current.trustStatus.toLowerCase()}`;
  ui.eligibility.textContent = address
    ? `${availability.reason} Bronze or higher is enforced on-chain.`
    : 'Open in Qortium Home to inspect the selected account. Bronze or higher is enforced on-chain.';

  // The contract's own claim ledger outranks our local "we sent it" flag, so a settled claim
  // shows as settled — and only the faucet's own scan cursor may convict it of declining one.
  const outcome = getClaimOutcome({ ...current, claimantAddress: address });
  const claimCopy = {
    confirmed: ['Your SMPL has left the building.', 'The contract recorded this account in its claim ledger. That is the whole ceremony; there is no second SMPL.'],
    error: ['The chandelier coughed.', current.claimError],
    unconfirmed: ['Signed, sealed, not yet delivered.', 'Home signed your claim message, but the chain has not confirmed it into a block yet. The vault cannot see it until then.'],
    pending: ['The message is on its way.', `Confirmed into block ${formatNumber(outcome.confirmedAt)}, and the vault has not scanned that far yet. It settles at most one claim per block, in order, so a queue ahead of you is perfectly normal.`],
    declined: ['The vault kept its composure, and your SMPL.', `The vault has now scanned past your claim's block (${formatNumber(outcome.confirmedAt)}) and recorded nothing, so it declined this one — the account's stored trust snapshot was below Bronze when the contract looked, the vault is empty, or its claim ledger is full. A declined claim is never retried. Nothing was charged, and you may send another.`],
    unaccounted: ['The ledger is behind a locked door.', 'Your claim message was sent, but we cannot yet account for what became of it — the contract’s claim ledger is not reading right now. That is our reading failing, not the vault. Nothing was charged; we keep checking, and reloading the page is safe.'],
    idle: null,
  }[outcome.kind] ?? {
    checking: ['The chandelier is calculating.', 'We are checking the current Previewnet block.'],
    countdown: ['The doors are not open. Again.', 'The countdown is real. The velvet rope is realer. The hinge fees have been negotiated down to zero.'],
    'coming-soon': ['The chain says go. The vault says: almost.', 'The faucet address has not been configured yet. Please admire the chrome.'],
    claim: [availability.enabled ? 'Your ceremonial SMPL awaits.' : 'The bouncer has a clipboard.', availability.reason],
  }[current.phase];
  ui.claimTitle.textContent = claimCopy[0];
  ui.claimCopy.textContent = claimCopy[1];
  // A claim we cannot account for keeps the button shut: inviting a duplicate MESSAGE when the
  // first may already have been paid only spends the guest's MemPoW work for nothing.
  const claimUnresolved = outcome.kind === 'pending' || outcome.kind === 'unconfirmed' || outcome.kind === 'unaccounted';
  ui.claimButton.disabled = !availability.enabled || claimUnresolved;
  ui.claimButton.textContent = outcome.kind === 'confirmed' ? 'ALREADY CLAIMED'
    : outcome.kind === 'unconfirmed' ? 'AWAITING CONFIRMATION'
    : outcome.kind === 'pending' ? 'MESSAGE SENT'
    : outcome.kind === 'unaccounted' ? 'CHECKING THE LEDGER'
    : outcome.kind === 'declined' ? 'TRY ANOTHER CLAIM'
    : availability.enabled ? 'ASK HOME FOR MY SMPL'
    : current.phase === 'coming-soon' ? 'VAULT COMING VERY SOON' : 'POLISHING THE BUTTON';
}

async function refresh() {
  try {
    const status = await getNodeStatus();
    current.height = getHeight(status);
  } catch (error) {
    console.warn('Unable to read node status', error);
    current.height = null;
  }
  current.phase = getCampaignPhase(current.height, CASINO_CONFIG);

  if (current.inHome) {
    try {
      [current.account, current.accountData] = await Promise.all([getSelectedAccount(), getAccountData()]);
      current.trustStatus = normaliseTrust(current.accountData?.trustStatus);
    } catch (error) {
      console.warn('Unable to read selected account', error);
    }
  }

  if (current.phase === 'claim') {
    // One read of the AT answers two questions: which working asset it was actually deployed
    // with (never assume), and how far its message scan has advanced.
    try {
      const at = await getFaucetAt(CASINO_CONFIG.faucetAtAddress);
      current.assetId = resolveAssetId(at?.assetId, CASINO_CONFIG.smplAssetId);
      if (current.assetId !== CASINO_CONFIG.smplAssetId) {
        console.warn(`Faucet AT is configured for asset ${current.assetId}, not the bundled ${CASINO_CONFIG.smplAssetId}.`);
      }
      current.faucetCursorHeight = atCursorHeight(at?.sleepUntilMessageTimestamp);
    } catch (error) {
      console.warn('Unable to read the faucet AT; falling back to the bundled asset ID', error);
      current.assetId = CASINO_CONFIG.smplAssetId;
      // Leave the cursor unknown: an unknown cursor keeps a claim pending rather than
      // letting a failed read masquerade as the faucet refusing it.
      current.faucetCursorHeight = null;
    }

    try {
      current.faucetBalance = await getFaucetBalance(CASINO_CONFIG.faucetAtAddress, current.assetId);
    } catch (error) {
      console.warn('Unable to read faucet balance', error);
      current.faucetBalance = undefined;
    }

    const address = accountAddress(current.account, current.accountData);
    if (address) {
      try {
        current.claimStatus = await getFaucetClaimStatus(CASINO_CONFIG.faucetAtAddress, address);
      } catch (error) {
        console.warn('Unable to read faucet claim marker', error);
        current.claimStatus = 'unknown';
      }
    }

    // Home accepting a claim message is not the chain including it. Resolve the block it
    // confirmed in, because that is what the faucet's scan cursor gets compared against.
    // Re-read every cycle rather than caching the first answer: if that block is ever orphaned
    // the height must go back to unknown, not linger and risk a premature "declined".
    if (current.claimSignature) {
      try {
        current.claimConfirmedHeight = await getTransactionHeight(current.claimSignature);
      } catch (error) {
        console.warn('Unable to check whether the claim message confirmed', error);
        current.claimConfirmedHeight = null;
      }
    }
  }
  render();
}

ui.claimButton.addEventListener('click', async () => {
  const availability = getClaimAvailability({ ...current, minimumTrust: CASINO_CONFIG.minimumTrust, activationBlock: CASINO_CONFIG.activationBlock });
  if (!availability.enabled) return;
  const claimantAddress = accountAddress(current.account, current.accountData);
  ui.claimButton.disabled = true;
  ui.claimButton.textContent = 'ASKING HOME…';
  current.claimError = null;
  try {
    const result = await sendClaimMessage(CASINO_CONFIG.faucetAtAddress);
    current.claimSent = true;
    // Bind the claim to the account that sent it, and start a fresh confirmation lookup so a
    // retry is never judged by the previous attempt's evidence.
    current.claimSentAddress = claimantAddress;
    current.claimSignature = result?.signature ?? null;
    current.claimConfirmedHeight = null;
  } catch (error) {
    current.claimSent = false;
    current.claimSentAddress = null;
    current.claimSignature = null;
    current.claimConfirmedHeight = null;
    current.claimError = error instanceof Error ? error.message : 'Home could not send the claim message.';
  } finally {
    render();
  }
});

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab));
  document.querySelectorAll('.page').forEach((page) => {
    const active = page.id === tab.dataset.tab;
    page.hidden = !active;
    page.classList.toggle('active', active);
  });
}));

refresh();
setInterval(refresh, 30_000);
