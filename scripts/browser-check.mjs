import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const port = Number(process.env.OSA_QA_PORT || 3000);
await mkdir('qa', { recursive: true });
const app = spawn(
  process.execPath,
  ['--env-file=.env', 'dist/apps/api/src/main.js'],
  {
    env: {
      ...process.env,
      OSA_PORT: String(port),
      OSA_SQLITE_PATH: `./qa/browser-${process.pid}.sqlite`,
      OSA_PUBLIC_URL: `http://127.0.0.1:${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let logs = '';
app.stdout.on('data', (c) => (logs += c.toString()));
app.stderr.on('data', (c) => (logs += c.toString()));
let browser;
try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health/ready`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
    if (i === 39) throw Error('API startup failed: ' + logs);
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.OSA_QA_CHROMIUM
      ? {
          executablePath: process.env.OSA_QA_CHROMIUM,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`);
  const token = (await readFile('data/access-token.txt', 'utf8')).trim();
  await page.getByLabel('Token dostępu').fill(token);
  await page.getByRole('button', { name: 'Wejdź do OSA' }).click();
  await page
    .getByRole('button', { name: 'Projekty', exact: false })
    .last()
    .waitFor();
  await page.getByRole('button', { name: 'Projekty', exact: true }).last().click();
  await page
    .getByRole('textbox', { name: 'Nowa misja' })
    .fill('OSA / sprawdzić infrastrukturę');
  await page
    .locator('.row-form')
    .first()
    .getByRole('button', { name: '+' })
    .click();
  await page
    .locator('.mission-work h2')
    .filter({ hasText: 'sprawdzić infrastrukturę' })
    .waitFor();
  await page
    .getByRole('textbox', { name: 'Nowy krok' })
    .fill('Wykonać kontrolę składni i zachować proof');
  await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await page.locator('.steps input').waitFor();
  await page
    .getByRole('button', { name: 'Zamknij z kontrolą', exact: true })
    .click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Wykonaj wszystkie kroki' })
    .waitFor();
  await page.getByRole('button', { name: 'Zamknij błąd' }).click();
  await page.locator('.steps input').check();
  await page.waitForFunction(
    () => !document.querySelector('.steps input')?.disabled,
  );
  await page.getByRole('button', { name: 'Uruchom silnik' }).click();
  await page
    .locator('.engine-lane')
    .getByRole('button', { name: 'Weryfikacja składni' })
    .click();
  await page
    .getByLabel('Kod JavaScript')
    .fill(
      'export const identity = Object.freeze({ name: "OSA", scope: "infrastructure" });',
    );
  await page.getByRole('button', { name: 'Zleć wykonanie' }).click();
  await page.locator('.output .state.succeeded').waitFor({ timeout: 15000 });
  assert.match(await page.locator('.output pre').innerText(), /Exit code: 0/);
  await page
    .locator('.command-dock')
    .getByRole('button', { name: 'Projekty' })
    .click();
  await page
    .getByRole('button', { name: 'Zamknij z kontrolą', exact: true })
    .click();
  await page.getByText('Zamknięte', { exact: false }).first().waitFor();
  await page.reload();
  await page
    .locator('.mission-row')
    .filter({ hasText: 'sprawdzić infrastrukturę' })
    .waitFor();
  await page
    .locator('.mission-row')
    .filter({ hasText: 'sprawdzić infrastrukturę' })
    .click();
  assert.match(await page.locator('.mission-work').innerText(), /Zamknięte/);
  await mkdir('qa', { recursive: true });
  await page.screenshot({ path: 'qa/desktop.png', fullPage: true });
  await page
    .locator('.command-dock')
    .getByRole('button', { name: 'Proof & zgody' })
    .click();
  await page
    .getByLabel('Draft / treść do zatwierdzenia')
    .fill('QA draft / recipient: test@example.org / NIE WYSŁANO');
  await page.getByRole('button', { name: 'Utwórz wniosek o zgodę' }).click();
  await page
    .getByRole('button', { name: 'Zatwierdź payload' })
    .first()
    .waitFor();
  await page.getByRole('button', { name: 'Zatwierdź payload' }).first().click();
  await page.locator('.approval-row').filter({ hasText: 'approved' }).waitFor();
  await page
    .locator('.command-dock')
    .getByRole('button', { name: 'Rytm / raporty' })
    .click();
  await page.getByRole('button', { name: 'Dodaj harmonogram' }).click();
  await page.locator('.schedule-row').waitFor();
  await page.getByRole('button', { name: 'Utwórz raport teraz' }).click();
  await page.locator('.output .state.succeeded').waitFor({ timeout: 15000 });
  assert.match(await page.locator('.output pre').innerText(), /RAPORT OSA/);
  await page
    .locator('.command-dock')
    .getByRole('button', { name: 'Akademia / Certyfikat' })
    .click();
  await page.getByLabel('Temat / cel nauki').fill('QA sesja czytania async');
  await page.getByLabel('Trwający oceniany egzamin').check();
  await page.getByRole('button', { name: 'Rozpocznij sesję' }).click();
  await page
    .getByText('Analiza egzaminu jest wyłączona po stronie API.', {
      exact: false,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Zakończ i zleć raport' })
      .isDisabled(),
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator('.command-dock')
    .getByRole('button', { name: 'Projekty' })
    .click();
  await page.screenshot({ path: 'qa/mobile.png', fullPage: true });
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  assert.ok(dimensions.width <= dimensions.viewport, 'mobile page overflow');
  await page
    .locator('.command-dock')
    .getByRole('button', { name: 'Platforma' })
    .click();
  await page.screenshot({ path: 'qa/platform-mobile.png', fullPage: true });
  assert.ok(
    (await page.locator('.integration').allTextContents()).some((t) =>
      t.includes('not_configured'),
    ),
  );
  await page.getByRole('button', { name: 'Wyloguj', exact: true }).click();
  await page.getByLabel('Token dostępu').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Browser PASS: login, CSRF-backed writes, mission closure guard, actual worker proof, durable reload, approval, scheduler/report, exam guard, mobile overflow and logout. Desktop/mobile screenshots saved.',
  );
} finally {
  await browser?.close();
  app.kill('SIGTERM');
  await new Promise((resolve) => app.once('exit', resolve));
}
