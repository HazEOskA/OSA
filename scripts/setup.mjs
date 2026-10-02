import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
try {
  await access('.env');
  console.error('Konfiguracja .env już istnieje. Nic nie nadpisano.');
  process.exit(1);
} catch {}
await mkdir('data', { recursive: true, mode: 0o700 });
const token = randomBytes(32).toString('base64url');
const identities = [
  {
    tenantId: 'osa-local',
    subject: 'osa',
    role: 'owner',
    tokenHash: createHash('sha256').update(token).digest('hex'),
  },
];
await writeFile('data/access-token.txt', token + '\n', {
  mode: 0o600,
  flag: 'wx',
});
await writeFile(
  '.env',
  `OSA_HOST=127.0.0.1\nOSA_PORT=3000\nOSA_PUBLIC_URL=http://127.0.0.1:3000\nOSA_DB_KIND=sqlite\nOSA_SQLITE_PATH=./data/osa.sqlite\nOSA_IDENTITIES_JSON=${JSON.stringify(identities)}\nOSA_EMBEDDED_WORKER=true\nOSA_AI_PROVIDER=disabled\nOSA_TIMEZONE=Europe/Amsterdam\nOSA_MCP_URL=http://127.0.0.1:3000\nOSA_MCP_TOKEN=${token}\n`,
  { mode: 0o600, flag: 'wx' },
);
console.log(
  'Konfiguracja utworzona. Prywatny token logowania: data/access-token.txt (nie publikuj pliku).',
);
