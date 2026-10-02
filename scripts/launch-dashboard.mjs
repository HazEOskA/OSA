import { access, mkdir, open, readFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseEnv } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runFile = promisify(execFile);
const check = process.argv.includes('--check');
const exists = async path => { try { await access(path); return true; } catch { return false; } };
let child, spawnError;
async function ready(base) {
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw Error('Nie udało się uruchomić procesu OSA: ' + spawnError.message);
    if (child && child.exitCode !== null) throw Error('Proces OSA zakończył się. Szczegóły są w data/dashboard-error.log.');
    try { const r = await fetch(base + '/health/ready', { signal: AbortSignal.timeout(1000) }); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw Error('OSA nie zgłosiła gotowości. Szczegóły są w data/dashboard-error.log.');
}
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Ta wersja OSA wymaga Node.js 24. Pakiet Windows zawiera własny runtime.');
  if (!await exists(join(root, 'dist/apps/api/src/main.js'))) throw Error('Brakuje gotowego buildu. Użyj pakietu osa-dashboard-windows albo wykonaj npm ci oraz npm run build w repo.');
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) if (key.startsWith('OSA_') || ['DATABASE_URL', 'OPENAI_API_KEY', 'OPENAI_MODEL'].includes(key)) delete childEnv[key];
  if (!await exists(join(root, '.env'))) {
    if (await exists(join(root, 'data/access-token.txt'))) throw Error('Istnieje token bez konfiguracji .env. Niczego nie nadpisano.');
    await runFile(process.execPath, [join(root, 'scripts/setup.mjs')], { cwd: root, env: childEnv, windowsHide: true });
  }
  const config = parseEnv(await readFile(join(root, '.env'), 'utf8'));
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.OSA_HOST || '127.0.0.1')) throw Error('Launcher lokalny wymaga adresu loopback. Niczego nie zmieniono w konfiguracji.');
  const port = Number(config.OSA_PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Nieprawidłowy port OSA.');
  const base = 'http://127.0.0.1:' + port;
  if (new URL(config.OSA_PUBLIC_URL || base).origin !== base) throw Error('Lokalny adres OSA_PUBLIC_URL musi odpowiadać ' + base + '. Konfiguracja pozostała bez zmian.');
  const token = (await readFile(join(root, 'data/access-token.txt'), 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error('Nieprawidłowy format lokalnego tokenu. Plik pozostał bez zmian.');
  let alreadyRunning = false;
  try {
    const r = await fetch(base + '/api/organizer', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(1000) });
    if (r.ok) alreadyRunning = true;
    else throw Error('Port jest zajęty przez inny proces. Nie zatrzymano go.');
  } catch (e) {
    if (e.message === 'Port jest zajęty przez inny proces. Nie zatrzymano go.') throw e;
  }
  if (!alreadyRunning) {
    await mkdir(join(root, 'data'), { recursive: true });
    const out = await open(join(root, 'data/dashboard-output.log'), 'a');
    const err = await open(join(root, 'data/dashboard-error.log'), 'a');
    try {
      child = spawn(process.execPath, ['--env-file=' + join(root, '.env'), join(root, 'dist/apps/api/src/main.js')], {
        cwd: root, env: childEnv, detached: !check, windowsHide: true, stdio: ['ignore', out.fd, err.fd],
      });
      child.on('error', error => { spawnError = error; });
      await ready(base);
    } finally { await out.close(); await err.close(); }
  }
  const r = await fetch(base + '/api/organizer', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw Error('Konfiguracja serwera nie pasuje do lokalnego tokenu. Niczego nie nadpisano.');
  const snapshot = await r.json();
  const html = await fetch(base).then(r => r.text());
  if (!html.includes('id="root"')) throw Error('Serwer nie udostępnia interfejsu OSA.');
  if (check) {
    console.log('OSA_LAUNCHER_PASS ' + JSON.stringify({ date: snapshot.date, privateNamespace: snapshot.plan.tenantId.startsWith('organizer:'), reports: Array.isArray(snapshot.reports), staticUi: true, node: process.versions.node }));
    if (child) { const exit = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exit; }
  } else {
    const url = base + '/#osa-token=' + encodeURIComponent(token);
    try {
      if (process.platform === 'win32') await runFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true });
      else if (process.platform === 'darwin') await runFile('open', [url]);
      else await runFile('xdg-open', [url]);
    } catch { console.error('Nie udało się otworzyć przeglądarki. OSA działa: ' + base + '. Token znajduje się w data/access-token.txt.'); }
    child?.unref();
    console.log('Dashboard OSA: ' + base + '\nTwoje dane: ' + join(root, 'data'));
  }
} catch (e) {
  if (child?.pid && child.exitCode === null && !spawnError) { const exit = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exit; }
  console.error('OSA: ' + e.message); process.exitCode = 1;
}
