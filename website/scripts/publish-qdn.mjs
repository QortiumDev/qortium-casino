import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const identity = 'qdn://WEBSITE/Casino/Sample';
await access(resolve(root, 'dist', 'index.html'), constants.R_OK).catch(() => {
  throw new Error('Build first with `npm run build`; no publishing attempt was made.');
});

throw new Error([
  `${identity} is a reserved launch identity, not an automatic publish target.`,
  'Confirm the Casino publisher owns the name, the deployed faucet values are configured,',
  'and obtain explicit publication approval before replacing this safety guard with the approved publisher workflow.',
].join(' '));
