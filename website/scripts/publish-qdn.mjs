import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NODE_API_URL = (process.env.QORTIUM_CASINO_NODE_API_URL ?? 'http://127.0.0.1:24891').replace(/\/+$/, '');
const SERVICE = 'WEBSITE';
const NAME = 'Casino';
const IDENTIFIER = 'Sample';
const TITLE = 'Qortium Casino — Opening Soon';
const DESCRIPTION = 'A deliberately excessive Qortium Casino opening campaign.';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 180_000;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_BASE = BigInt(BASE58_ALPHABET.length);
const REGISTER_NAME_TRANSACTION_TYPE = 3;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '..');
const distPath = resolve(root, 'dist');

function expandHome(filePath) {
  return filePath === '~' ? homedir() : filePath.startsWith('~/') ? resolve(homedir(), filePath.slice(2)) : filePath;
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8').trim();
}

function readEnvFile(filePath) {
  const values = {};
  for (const line of readText(filePath).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    values[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

function getPublisher() {
  const treasuryEnvPath = expandHome(
    process.env.QORTIUM_CASINO_TREASURY_ENV ?? '~/.local/share/qortium-casino/treasury.env',
  );
  if (!existsSync(treasuryEnvPath)) {
    throw new Error(`Treasury environment was not found at ${treasuryEnvPath}. Set QORTIUM_CASINO_TREASURY_ENV.`);
  }
  const treasury = readEnvFile(treasuryEnvPath);
  const account = {
    accountAddress: treasury.CASINO_TREASURY_ADDRESS,
    accountPublicKey: treasury.CASINO_TREASURY_PUBLIC_KEY,
    accountPrivateKey: treasury.CASINO_TREASURY_PRIVATE_KEY,
  };
  if (Object.values(account).some((value) => !value)) {
    throw new Error(`Treasury environment at ${treasuryEnvPath} is missing a Casino publisher value.`);
  }
  return account;
}

function decodeBase58(value) {
  let decoded = 0n;
  for (const character of value) {
    const index = BASE58_ALPHABET.indexOf(character);
    if (index === -1) throw new Error('Invalid Base58 character.');
    decoded = decoded * BASE58_BASE + BigInt(index);
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
  return Buffer.from(bytes);
}

function encodeBase58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % BASE58_BASE)] + encoded;
    value /= BASE58_BASE;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || '1';
}

function intBytes(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value);
  return bytes;
}

function longBytes(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigInt64BE(BigInt(value));
  return bytes;
}

function sizedStringBytes(value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([intBytes(bytes.length), bytes]);
}

function buildRegisterNameRawBytes58(account) {
  const publicKey = decodeBase58(account.accountPublicKey);
  if (publicKey.length !== 32) throw new Error('Casino publisher public key must be 32 bytes.');
  return encodeBase58(Buffer.concat([
    intBytes(REGISTER_NAME_TRANSACTION_TYPE), longBytes(Date.now()), intBytes(0), publicKey, intBytes(0),
    sizedStringBytes(NAME), sizedStringBytes(JSON.stringify({ app: 'Casino', purpose: 'Qortium Casino WEBSITE' })), longBytes(0),
  ]));
}

function isLoopback() {
  try {
    const hostname = new URL(NODE_API_URL).hostname;
    return hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  } catch {
    return false;
  }
}

function gitValue(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function requireReviewedMain() {
  if (gitValue('branch', '--show-current') !== 'main') throw new Error('Refusing to publish from a non-main branch.');
  if (gitValue('status', '--porcelain')) throw new Error('Refusing to publish with local changes; commit or stash them first.');
}

const apiKeyPath = expandHome(process.env.QORTIUM_CASINO_NODE_API_KEY_PATH ?? '~/.config/qortium-core/runtime/apikey.txt');
if (!existsSync(apiKeyPath)) throw new Error(`Node API key was not found at ${apiKeyPath}. Set QORTIUM_CASINO_NODE_API_KEY_PATH.`);
const apiKey = readText(apiKeyPath);

function headers(contentType) {
  return { 'X-API-KEY': apiKey, ...(contentType ? { 'Content-Type': contentType } : {}) };
}

async function request(pathname, options = {}) {
  const response = await fetch(`${NODE_API_URL}${pathname}`, options);
  const text = await response.text();
  if (!response.ok) throw new Error(text || `${options.method ?? 'GET'} ${pathname} failed with HTTP ${response.status}.`);
  return text;
}

async function requestJson(pathname, options = {}) {
  const text = await request(pathname, options);
  return text ? JSON.parse(text) : null;
}

async function waitFor(label, predicate) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${label}.${lastError ? ` Last error: ${lastError.message}` : ''}`);
}

async function signAndProcess(unsignedBytes58, privateKey58, computePath = '/arbitrary/compute') {
  const withNonce = await request(computePath, { method: 'POST', headers: headers('text/plain'), body: unsignedBytes58 });
  const signedBytes = await request('/transactions/sign', {
    method: 'POST', headers: headers('application/json'), body: JSON.stringify({ privateKey: privateKey58, transactionBytes: withNonce }),
  });
  const result = (await request('/transactions/process', { method: 'POST', headers: headers('text/plain'), body: signedBytes })).trim();
  if (result === 'true') return;
  let parsed;
  try { parsed = JSON.parse(result); } catch { throw new Error(`Transaction was not accepted: ${result.slice(0, 300)}`); }
  if (!parsed || typeof parsed.type !== 'string' || parsed.error !== undefined) {
    throw new Error(`Transaction was not accepted: ${result.slice(0, 300)}`);
  }
}

async function ensureName(account) {
  const response = await fetch(`${NODE_API_URL}/names/${encodeURIComponent(NAME)}`);
  if (response.status === 404) {
    console.log(`Registering name: ${NAME}`);
    await signAndProcess(buildRegisterNameRawBytes58(account), account.accountPrivateKey, '/transactions/mempow/compute');
    await waitFor(`name ${NAME}`, async () => {
      const name = await requestJson(`/names/${encodeURIComponent(NAME)}`);
      return name?.owner === account.accountAddress ? name : null;
    });
    console.log(`Name registered: ${NAME}`);
    return;
  }
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Name lookup failed with HTTP ${response.status}.`);
  const name = JSON.parse(text);
  if (name.owner !== account.accountAddress) throw new Error(`${NAME} is already owned by ${name.owner}.`);
  console.log(`Name already registered: ${NAME} (${name.owner})`);
}

async function publish(account) {
  const path = `/arbitrary/${SERVICE}/${NAME}/${IDENTIFIER}?${new URLSearchParams({ title: TITLE, description: DESCRIPTION, fee: '0' })}`;
  const unsignedBytes = await request(path, { method: 'POST', headers: headers('text/plain'), body: distPath });
  await signAndProcess(unsignedBytes, account.accountPrivateKey);
}

if (!existsSync(resolve(distPath, 'index.html'))) throw new Error('Build first with `npm run build`; no publishing attempt was made.');
if (process.env.QORTIUM_CASINO_ALLOW_PUBLISH !== '1') {
  throw new Error('Publishing is armed only with QORTIUM_CASINO_ALLOW_PUBLISH=1; no external action was taken.');
}
if (!isLoopback() && !NODE_API_URL.startsWith('https://')) throw new Error(`Refusing non-HTTPS remote signing endpoint ${NODE_API_URL}.`);
requireReviewedMain();
const status = await requestJson('/admin/status');
if (!status || status.syncPercent !== 100 || status.isSynchronizing) throw new Error(`Node is not synced: ${JSON.stringify(status)}`);
const publisher = getPublisher();
console.log(`Node: ${NODE_API_URL}`);
console.log(`Owner: ${publisher.accountAddress}`);
console.log(`Resource: qdn://${SERVICE}/${NAME}/${IDENTIFIER}`);
await ensureName(publisher);
await publish(publisher);
const ready = await waitFor(`${SERVICE}/${NAME}/${IDENTIFIER}`, async () => {
  const resource = await requestJson(`/arbitrary/resource/status/${SERVICE}/${NAME}/${IDENTIFIER}?build=true`, { headers: headers() });
  if (resource?.status === 'READY') return resource;
  if (resource?.status === 'BLOCKED' || resource?.status === 'BUILD_FAILED') throw new Error(`Resource status is ${resource.status}.`);
  return null;
});
console.log(`Ready: qdn://${SERVICE}/${NAME}/${IDENTIFIER}`);
console.log(`Status: ${ready.status}${ready.description ? ` - ${ready.description}` : ''}`);
