import { CASINO_CONFIG } from './config.js';
import { getAccountData, getFaucetBalance, getFaucetClaimStatus, getNodeStatus, getSelectedAccount, isHome, sendClaimMessage } from './bridge.js';
import { blocksRemaining, formatNumber, getCampaignPhase, getClaimAvailability, normaliseTrust } from './state.js';

const $ = (id) => document.getElementById(id);
const ui = Object.freeze({
  phaseBadge: $('phase-badge'), blockCount: $('block-count'), blockCaption: $('block-caption'), progress: $('progress-meter'),
  supplyLabel: $('supply-label'), supplyCount: $('supply-count'), supplyCaption: $('supply-caption'),
  accountName: $('account-name'), trustStatus: $('trust-status'), eligibility: $('eligibility-copy'),
  claimTitle: $('claim-title'), claimCopy: $('claim-copy'), claimButton: $('claim-button'),
});

let current = { height: null, trustStatus: 'UNVERIFIED', inHome: isHome(), account: null, phase: 'checking', claimStatus: 'unknown' };

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
  const availability = getClaimAvailability({ ...current, minimumTrust });
  const belowActivation = current.phase === 'countdown';

  ui.blockCount.textContent = current.height === null ? '—' : belowActivation ? formatNumber(remaining) : 'OPEN';
  ui.blockCaption.textContent = current.height === null
    ? 'Connecting to Previewnet for the block count.'
    : belowActivation ? `blocks until ${formatNumber(activationBlock)}. The roulette wheel is warming up.` : `Previewnet is at block ${formatNumber(current.height)}.`;
  ui.progress.style.width = current.height === null ? '0%' : `${Math.min(100, (current.height / activationBlock) * 100)}%`;

  const phaseCopy = {
    checking: ['loading', 'Checking the velvet rope…'],
    countdown: ['countdown', 'THE DOORS OPEN AT BLOCK 70,000'],
    'coming-soon': ['soon', 'BLOCK 70,000: ACHIEVED. VAULT: COMING VERY SOON.'],
    claim: ['open', 'THE SMPL VAULT IS OPEN'],
  }[current.phase];
  ui.phaseBadge.className = `phase-badge ${phaseCopy[0]}`;
  ui.phaseBadge.textContent = phaseCopy[1];

  ui.supplyLabel.textContent = current.faucetBalance === undefined ? 'PLANNED SMPL POOL' : 'SMPL REMAINING IN VAULT';
  ui.supplyCount.textContent = formatNumber(current.faucetBalance ?? plannedSmplSupply);
  ui.supplyCaption.textContent = current.faucetBalance === undefined
    ? '1,000 SMPL are planned for the opening ceremony.'
    : 'Live read from the configured faucet AT.';

  const address = accountAddress(current.account, current.accountData);
  ui.accountName.textContent = address ? `${address.slice(0, 7)}…${address.slice(-6)}` : 'Open in Qortium Home';
  ui.trustStatus.textContent = address ? `Trust status: ${current.trustStatus}` : 'Trust status: waiting for Home';
  ui.trustStatus.className = `trust-status ${current.trustStatus.toLowerCase()}`;
  ui.eligibility.textContent = address
    ? `${availability.reason} Bronze or higher is enforced on-chain.`
    : 'Open in Qortium Home to inspect the selected account. Bronze or higher is enforced on-chain.';

  const claimCopy = current.claimSent ? ['The message is on its way.', 'Home handled approval and signing. The vault will confirm it after the next refresh.'] : current.claimError ? ['The chandelier coughed.', current.claimError] : current.claimStatus === true ? ['Your SMPL already left the building.', 'This selected account has already received its one ceremonial SMPL.'] : {
    checking: ['The chandelier is calculating.', 'We are checking the current Previewnet block.'],
    countdown: ['The doors are not open yet.', 'The countdown is real. The velvet rope is realer.'],
    'coming-soon': ['The chain says go. The vault says: almost.', 'The faucet address has not been configured yet. Please admire the chrome.'],
    claim: [availability.enabled ? 'Your ceremonial SMPL awaits.' : 'The bouncer has a clipboard.', availability.reason],
  }[current.phase];
  ui.claimTitle.textContent = claimCopy[0];
  ui.claimCopy.textContent = claimCopy[1];
  ui.claimButton.disabled = !availability.enabled || current.claimSent;
  ui.claimButton.textContent = current.claimSent ? 'MESSAGE SENT' : availability.enabled ? 'ASK HOME FOR MY SMPL' : current.phase === 'coming-soon' ? 'VAULT COMING VERY SOON' : 'POLISHING THE BUTTON';
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
    try {
      current.faucetBalance = await getFaucetBalance(CASINO_CONFIG.faucetAtAddress, CASINO_CONFIG.smplAssetId);
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
  }
  render();
}

ui.claimButton.addEventListener('click', async () => {
  const availability = getClaimAvailability({ ...current, minimumTrust: CASINO_CONFIG.minimumTrust });
  if (!availability.enabled) return;
  ui.claimButton.disabled = true;
  ui.claimButton.textContent = 'ASKING HOME…';
  try {
    await sendClaimMessage(CASINO_CONFIG.faucetAtAddress);
    current.claimSent = true;
  } catch (error) {
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
