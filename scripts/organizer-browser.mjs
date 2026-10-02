import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const port = Number(process.env.OSA_QA_ORGANIZER_PORT || 3001);
const base = 'http://127.0.0.1:' + port;
const database = './qa/organizer-' + process.pid + '.sqlite';
await mkdir('qa', { recursive: true });
let app, browser, page, logs = '';
function start() {
  const processHandle = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/apps/api/src/main.js'], {
    env: { ...process.env, OSA_PORT: String(port), OSA_DB_KIND: 'sqlite', OSA_SQLITE_PATH: database, OSA_PUBLIC_URL: base, OSA_AI_PROVIDER: 'disabled' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processHandle.stdout.on('data', c => { logs += c.toString(); });
  processHandle.stderr.on('data', c => { logs += c.toString(); });
  return processHandle;
}
async function ready() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/health/ready')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw Error('Organizer API startup failed: ' + logs);
}
async function stop() {
  if (!app || app.exitCode !== null) return;
  const exited = once(app, 'exit');
  app.kill('SIGTERM');
  await exited;
}
async function action(p, locator, status = 200) {
  const responsePromise = p.waitForResponse(r => new URL(r.url()).pathname === '/api/organizer' && r.request().method() === 'POST');
  await locator.click();
  const response = await responsePromise;
  const value = await response.json();
  assert.equal(response.status(), status, JSON.stringify(value.error || value));
  // Wait for the mutation to leave React's busy state, not an arbitrary delay.
  await p.waitForFunction(() => !document.querySelector('.o-capture-actions button')?.disabled || !document.querySelector('.o-capture textarea')?.value);
  return value;
}
async function snapshot(p = page, date = '') {
  return p.evaluate(async d => {
    const response = await fetch('/api/organizer' + (d ? '?date=' + d : ''));
    if (!response.ok) throw Error('Snapshot failed');
    return response.json();
  }, date);
}
async function capture(text) {
  await page.getByLabel('Myśl do skrzynki').fill(text);
  const response = await action(page, page.getByRole('button', { name: 'Zapisz w skrzynce' }));
  await page.waitForFunction(() => document.querySelector('#o-capture')?.value === '');
  return response.entries.find(e => e.text === text);
}
const inboxRow = text => page.locator('.o-inbox-row').filter({ has: page.getByRole('button', { name: text, exact: true }) });
async function screenshot(name, preview = false) {
  await page.screenshot({ path: 'qa/organizer-' + name + '.png', fullPage: true });
  if (preview && process.env.OSA_QA_IMAGE_LOG === 'true') {
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 65, fullPage: name === 'mobile' });
    console.log('OSA_QA_PREVIEW ' + name + ' ' + jpeg.toString('base64'));
  }
}
try {
  app = start(); await ready();
  browser = await chromium.launch({ headless: true, ...(process.env.OSA_QA_CHROMIUM ? { executablePath: process.env.OSA_QA_CHROMIUM } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  const token = (await readFile('data/access-token.txt', 'utf8')).trim();
  await page.getByLabel('Token dostępu').fill(token);
  await page.getByRole('button', { name: 'Wejdź do OSA' }).click();
  await page.getByRole('heading', { level: 1 }).filter({ hasText: 'Ustaw swój dzień' }).waitFor();
  let s = await snapshot();
  assert.equal(s.entries.length, 0);
  assert.equal(s.blocks.length, 0);
  await screenshot('empty');
  // All modules are available before selecting a task. Opening one preserves
  // the organizer draft and does not invoke any model or enqueue a run.
  await page.getByLabel('Myśl do skrzynki').fill('Niezapisany szkic bez utraty kontekstu');
  await page.locator('.o-tools-context').getByRole('button', { name: 'Prompt God' }).click();
  await page.getByLabel('Cel i kontekst').waitFor();
  assert.equal(await page.getByLabel('Myśl do skrzynki').inputValue(), 'Niezapisany szkic bez utraty kontekstu');
  assert.equal((await snapshot()).plan.priorityIds.length, 0);
  assert.equal((await page.evaluate(async ()=>(await (await fetch('/api/runs')).json()).items)).length,0);
  await page.getByRole('button', { name: 'Zamknij pracownię' }).click();
  await page.getByLabel('Myśl do skrzynki').fill('');

  const firstText = 'Uporządkować dokumentację OSA';
  const first = await capture(firstText);
  assert.equal((await snapshot()).plan.priorityIds.length, 0, 'capture must not schedule work');
  await action(page, inboxRow(firstText).getByRole('button', { name: 'Na dziś', exact: true }));
  await page.getByRole('heading', { level: 1, name: firstText }).waitFor();
  await action(page, page.getByRole('button', { name: 'Rozpocznij blok' }), 409);
  await page.getByRole('alert').filter({ hasText: 'następny krok' }).waitFor();
  await page.getByRole('button', { name: 'Zamknij błąd' }).click();
  await page.getByRole('button', { name: 'Zapisz następny krok', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByLabel('Następny krok', { exact: true }).fill('Otwórz docs/ORGANIZER.md i opisz przepływ od skrzynki do domknięcia dnia.');
  await page.getByLabel('Szacowany czas w minutach').fill('50');
  await action(page, page.getByRole('dialog').getByRole('button', { name: 'Zapisz następny krok' }));
  await page.getByRole('dialog').waitFor({ state: 'hidden' });

  const secondText = 'Przejrzeć przepływ logowania';
  const thirdText = 'Przeczytać moduł workera';
  const second = await capture(secondText);
  await action(page, inboxRow(secondText).getByRole('button', { name: 'Na dziś', exact: true }));
  await capture(thirdText);
  await action(page, inboxRow(thirdText).getByRole('button', { name: 'Na dziś', exact: true }));
  const longText = ('Spisać pomysł do OSA Labs\n').padEnd(4000, 'ą');
  const fourth = await capture(longText);
  const row = page.locator('.o-inbox-row').filter({ hasText: 'Spisać pomysł' });
  await action(page, row.getByRole('button', { name: 'Na dziś', exact: true }), 409);
  assert.equal((await snapshot()).entries.find(e => e.id === fourth.id).status, 'inbox');
  await page.getByRole('button', { name: 'Zamknij błąd' }).click();
  await action(page, row.getByRole('button', { name: 'Później', exact: true }));
  await page.locator('.o-list-tabs').getByRole('button', { name: 'Później', exact: true }).click();
  await action(page, page.locator('.o-inbox-row').filter({ hasText: 'Spisać pomysł' }).getByRole('button', { name: 'Archiwizuj' }));
  await page.locator('.o-list-tabs').getByRole('button', { name: 'Archiwum' }).click();
  await action(page, page.locator('.o-inbox-row').filter({ hasText: 'Spisać pomysł' }).getByRole('button', { name: 'Przywróć' }));
  await page.locator('.o-list-tabs').getByRole('button', { name: 'Później', exact: true }).click();
  await page.locator('.o-inbox-row').filter({ hasText: 'Spisać pomysł' }).getByRole('button', { name: 'Spisać pomysł do OSA Labs', exact: true }).click();
  assert.equal(await page.getByLabel('Pełna treść wpisu').inputValue(), longText);
  await page.getByRole('button', { name: 'Zamknij wpis' }).click();

  await page.getByRole('button', { name: 'Mam 90 min' }).click();
  await page.getByLabel('Dostępny czas tego dnia w minutach').fill('40');
  await action(page, page.getByRole('button', { name: 'Zapisz czas', exact: true }));
  await page.getByText('Plan przekracza Twój czas o 60 min.', { exact: false }).waitFor();
  await page.locator('.o-list-tabs').getByRole('button', { name: 'Skrzynka', exact: false }).click();

  await page.locator('.o-tools-context').getByRole('button', { name: 'Prompt God' }).click();
  assert.match(await page.getByLabel('Cel i kontekst').inputValue(), /Uporządkować dokumentację OSA/);
  assert.match(await page.getByLabel('Cel i kontekst').inputValue(), /docs\/ORGANIZER\.md/);
  const runs = await page.evaluate(async () => (await (await fetch('/api/runs')).json()).items);
  assert.equal(runs.length, 0, 'opening a contextual tool must not enqueue execution');
  await page.locator('.o-workspace-nav').getByRole('button', { name: 'Mój dzień' }).click();
  await page.getByRole('heading', { level: 1, name: firstText }).waitFor();
  await screenshot('desktop', true);

  await page.getByRole('button', { name: '5 min', exact: true }).click();
  const started = await action(page, page.getByRole('button', { name: 'Rozpocznij blok' }));
  const blockId = started.activeBlock.id, initialVersion = started.activeBlock.version;
  await page.locator('.o-focused').waitFor();
  assert.equal(await page.locator('.o-priorities').count(), 0);
  assert.equal(await page.locator('.o-inbox').count(), 0);
  assert.equal(await page.locator('.o-tools-context').count(), 0);
  await screenshot('focus', true);
  await page.waitForFunction(() => document.querySelector('.o-timer')?.textContent !== '05:00');
  await page.reload();
  await page.getByRole('heading', { level: 1, name: firstText }).waitFor();
  assert.equal((await snapshot()).activeBlock.id, blockId);

  const other = await context.newPage();
  other.on('pageerror', e => errors.push(e.message));
  await other.goto(base);
  await other.getByRole('heading', { level: 1, name: firstText }).waitFor();
  await action(page, page.getByRole('button', { name: 'Pauza', exact: true }));
  const stale = await other.evaluate(async body => {
    const me = await (await fetch('/api/auth/me')).json();
    const response = await fetch('/api/organizer', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OSA-CSRF': me.csrf }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { action: 'block.resume', id: blockId, version: initialVersion });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
  await other.getByRole('button', { name: 'Wznów blok', exact: true }).waitFor();
  const pausedClock = await other.locator('.o-timer').innerText();
  await other.waitForTimeout(1100);
  assert.equal(await other.locator('.o-timer').innerText(), pausedClock);
  await action(other, other.getByRole('button', { name: 'Wznów blok', exact: true }));

  // The same file and session are re-opened by a new server process.
  await stop(); app = start(); await ready();
  await page.reload();
  await page.getByRole('heading', { level: 1, name: firstText }).waitFor();
  s = await snapshot();
  assert.equal(s.activeBlock.id, blockId);
  assert.equal(s.activeBlock.status, 'running');
  await other.close();
  await action(page, page.getByRole('button', { name: 'Zakończ blok', exact: true }));
  await action(page, page.getByRole('button', { name: 'Oznacz ukończenie', exact: true }));
  s = await snapshot();
  assert.equal(s.activeBlock, null);
  assert.equal(s.entries.find(e => e.id === first.id).status, 'done');
  await action(page, page.locator('.o-priority').filter({ hasText: secondText }).getByRole('button', { name: 'Wybierz', exact: true }));
  await page.getByRole('button', { name: 'Zapisz następny krok', exact: true }).click();
  await page.getByLabel('Następny krok', { exact: true }).fill('Otwórz auth.ts i prześledź wygasanie sesji.');
  await action(page, page.getByRole('dialog').getByRole('button', { name: 'Zapisz następny krok' }));
  await page.getByRole('dialog').waitFor({ state: 'hidden' });

  const personalReport = await action(page, page.getByRole('button', { name: 'Wygeneruj raport', exact: true }));
  assert.equal(personalReport.reports[0].done[0].id, first.id);
  assert.equal(personalReport.reports[0].unfinished.length, 2);
  await page.getByRole('article', { name: 'Raport osobistego dnia' }).waitFor();
  assert.match(await page.locator('.o-daily-report').innerText(), /Przejrzeć przepływ logowania/);
  await page.getByRole('button', { name: 'Zwiń raport' }).click();
  const scheduleResponse = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/schedules'&&r.request().method()==='POST');
  await page.getByRole('button', { name:'Włącz raport wieczorny' }).click();
  assert.equal((await scheduleResponse).status(),201);
  await page.getByText('Wieczorem o 21:00', { exact:false }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await screenshot('mobile', true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile overflow');
  await page.getByRole('button', { name: 'Domknij dzień', exact: true }).first().click();
  await page.getByLabel('Co dziś zadziałało?').fill('QA: dokumentacja ma konkretny przepływ.');
  await page.getByLabel('Co zatrzymało pracę?').fill('QA: brakowało jednego testu wygasłej sesji.');
  await page.getByLabel('Jedna praca na jutro').selectOption(second.id);
  const closed = await action(page, page.getByRole('button', { name: 'Zapisz i domknij dzień' }));
  await page.getByRole('heading', { name: 'Możesz już odłożyć ten dzień.' }).waitFor();
  const report = closed.closures.find(c => c.date === closed.date);
  assert.equal(report.done[0].id, first.id);
  assert.equal(report.tomorrow.id, second.id);
  assert.equal(report.unfinished.length, 2);
  await screenshot('evening');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'evening mobile overflow');
  await page.reload();
  await page.getByRole('heading', { name: 'Możesz już odłożyć ten dzień.' }).waitFor();
  assert.equal((await snapshot()).plan.closureId, report.id);
  await page.getByRole('button', { name: 'Przejdź do jutra' }).click();
  await page.getByRole('heading', { level: 1, name: secondText }).waitFor();
  assert.equal(await page.getByLabel('Wybierz dzień').inputValue(), report.tomorrowDate);
  assert.deepEqual((await snapshot(page, report.tomorrowDate)).plan.priorityIds, [second.id]);
  assert.deepEqual(errors, []);
  await page.getByRole('button', { name: 'Wyloguj', exact: true }).click();
  await page.getByLabel('Token dostępu').waitFor();
  await page.goto(base + '/#osa-token=' + encodeURIComponent(token));
  await page.locator('.o-now h1').waitFor();
  assert.equal((await snapshot()).plan.closureId, report.id);
  assert.equal(new URL(page.url()).hash,'');
  assert.deepEqual(errors, []);
  console.log('Organizer browser PASS: empty state, full capture/archive restore, 3 priorities/4th retained, next-step guard, budget, context without auto-run, focus, timer reload/two tabs/server restart, completion, mobile overflow, immutable evening snapshot and tomorrow task; integrated tools, draft preservation, private daily report, owned evening schedule and local automatic login.');
} catch (e) {
  if (page) {
    try { await page.screenshot({ path: 'qa/organizer-failure.png', fullPage: true }); console.error('Organizer UI at failure: ' + (await page.locator('body').innerText()).slice(0, 2500)); } catch {}
  }
  throw e;
} finally {
  await browser?.close(); await stop();
}
