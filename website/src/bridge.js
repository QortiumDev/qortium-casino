const DEFAULT_NODE_API = 'http://127.0.0.1:24891';

function qdnRequest(request) {
  if (typeof window.qdnRequest !== 'function') {
    throw new Error('This action is available only in Qortium Home.');
  }
  return window.qdnRequest(request);
}

function localNodeApi() {
  return window.QORTIUM_NODE_API_URL || DEFAULT_NODE_API;
}

function safeReadPath(path) {
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/?=-]*$/.test(path) || path.startsWith('//')) {
    throw new Error('Only absolute local node read paths are allowed.');
  }
  return path;
}

async function localRead(path) {
  const response = await fetch(`${localNodeApi()}${safeReadPath(path)}`, { method: 'GET' });
  if (!response.ok) throw new Error(`Local node read failed (${response.status}).`);
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}

export function isHome() {
  return typeof window.qdnRequest === 'function';
}

export async function getNodeStatus() {
  return isHome() ? qdnRequest({ action: 'GET_NODE_STATUS' }) : localRead('/admin/status');
}

export async function getSelectedAccount() {
  if (!isHome()) return null;
  return qdnRequest({ action: 'GET_SELECTED_ACCOUNT' });
}

export async function getAccountData() {
  if (!isHome()) return null;
  return qdnRequest({ action: 'GET_ACCOUNT_DATA' });
}

export async function getFaucetBalance(address, assetId) {
  const path = `/addresses/balance/${encodeURIComponent(address)}?assetId=${encodeURIComponent(assetId)}`;
  return isHome()
    ? qdnRequest({ action: 'FETCH_NODE_API', path, method: 'GET' })
    : localRead(path);
}

export async function sendClaimMessage(recipient) {
  if (!isHome()) throw new Error('Open this site in Qortium Home to claim.');
  const result = await qdnRequest({
    action: 'SEND_MESSAGE',
    recipient,
    message: 'SMPL faucet claim',
  });
  if (result?.accepted === false) {
    throw new Error(result.error || result.reason || 'Home did not accept the claim message.');
  }
  return result;
}
