const DEFAULT_NODE_API = 'http://127.0.0.1:24891';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

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

function unpackNodeRead(result) {
  // Home's generic read bridge preserves response metadata, while ordinary
  // browser reads return the decoded body directly. Keep the site portable
  // without treating an HTTP error object as a successful faucet response.
  if (result && typeof result === 'object' && Object.hasOwn(result, 'ok') && Object.hasOwn(result, 'data')) {
    if (result.ok !== true) throw new Error(`Node read failed (${result.status ?? 'unknown'}).`);
    return result.data;
  }
  return result;
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
    ? unpackNodeRead(await qdnRequest({ action: 'FETCH_NODE_API', path, method: 'GET' }))
    : localRead(path);
}

/**
 * Reads the deployed AT, whose `assetId` is the working asset it was created with. Preferred
 * over the bundled config value so the site never assumes an asset ID.
 */
export async function getFaucetAt(faucetAtAddress) {
  const path = `/at/${encodeURIComponent(faucetAtAddress)}`;
  return isHome()
    ? unpackNodeRead(await qdnRequest({ action: 'FETCH_NODE_API', path, method: 'GET' }))
    : localRead(path);
}

/**
 * Returns the block height our claim MESSAGE confirmed in, or null while it is still
 * unconfirmed (or unreadable). Home accepting a message is not the chain including it.
 */
export async function getTransactionHeight(signature) {
  if (!signature) return null;
  const path = `/transactions/signature/${encodeURIComponent(signature)}`;
  const data = isHome()
    ? unpackNodeRead(await qdnRequest({ action: 'FETCH_NODE_API', path, method: 'GET' }))
    : await localRead(path);
  const height = Number(data?.blockHeight);
  return Number.isFinite(height) && height > 0 ? height : null;
}

function decodeBase58(value) {
  let decoded = 0n;

  for (const character of value) {
    const index = BASE58_ALPHABET.indexOf(character);
    if (index === -1) throw new Error('Selected account address is not valid Base58.');
    decoded = decoded * 58n + BigInt(index);
  }

  const bytes = [];
  while (decoded > 0n) {
    bytes.unshift(Number(decoded & 0xffn));
    decoded >>= 8n;
  }
  for (const character of value) {
    if (character !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export async function faucetClaimKeys(address) {
  const addressBytes = decodeBase58(address);
  if (addressBytes.length !== 25) throw new Error('Selected account address has an unexpected length.');

  // Faucet V1 hashes the 25 decoded address bytes padded to the four 64-bit
  // A-register slots, then uses the first two signed big-endian longs as keys.
  const packedAddress = new Uint8Array(32);
  packedAddress.set(addressBytes);
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable in this browser.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', packedAddress);
  const view = new DataView(digest);
  return [view.getBigInt64(0, false), view.getBigInt64(8, false)];
}

export async function getFaucetClaimStatus(faucetAtAddress, claimantAddress) {
  const [key1, key2] = await faucetClaimKeys(claimantAddress);
  const path = `/at/${encodeURIComponent(faucetAtAddress)}/map/value?key1=${key1}&key2=${key2}`;
  const entry = isHome()
    ? unpackNodeRead(await qdnRequest({ action: 'FETCH_NODE_API', path, method: 'GET' }))
    : await localRead(path);

  // Insist on a real number. `Number(undefined) !== 0` is true, so a body we failed to parse
  // used to read as "already claimed" — the one wrong answer that permanently locks an eligible
  // guest out of a claim they never made. Throwing instead lets the caller say "unknown".
  return readClaimMarker(entry);
}

export function readClaimMarker(entry) {
  const raw = entry?.value;
  // Reject null/undefined/'' explicitly: Number() maps all three to 0, which would report a
  // body we could not read as a definite "not claimed".
  const value = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error('The faucet claim ledger did not return a readable marker value.');
  }
  return value !== 0;
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
