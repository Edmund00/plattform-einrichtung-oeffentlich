// B5: Bilder fuer die Praesentation aus der AKTUELLEN Plattform (de/en/hu, Desktop 1440): start-<L>, kurs-<L>, admin-<L>. Kopie der Muster-DB, Port 4494, Testmodus.
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
const ord = resolve('daten/praesentation-bilder'); mkdirSync(ord, { recursive: true }); const ziel = resolve('../praesentation/bilder');
const dbf = `${ord}/p.db`; copyFileSync('daten/muster.db', dbf); for (const x of ['-wal', '-shm']) { try { copyFileSync('daten/muster.db' + x, dbf + x); } catch { /* */ } }
const PORT = 4494, BASE = `http://localhost:${PORT}`, pw = 'Bild-' + randomBytes(9).toString('hex') + '!', mail = 'bild.admin@example.com';
const env = { ...process.env, DB_DATEI: dbf, PORT: String(PORT), BASE_URL: BASE, DATEI_ORDNER: `${ord}/dateien`, MAIL_DUMP: `${ord}/m.jsonl`, ADMIN_PASSWORT: pw,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_platzhalter_nur_ansicht', STRIPE_WEBHOOK_SECRET: 'whsec_platzhalter', ANBIETER_NAME: 'Musterfirma (Demo)',
  ANBIETER_ANSCHRIFT: 'Beispielstrasse 1, 12345 Musterstadt', ANBIETER_TELEFON: '+49 30 0000000', ANBIETER_EMAIL: 'edmundautomat@gmail.com', VERKAUFSMELDUNG_MAIL: 'edmundautomat@gmail.com', SUPPORT_MAIL: 'edmundautomat@gmail.com' };
spawnSync('node', ['--disable-warning=ExperimentalWarning', 'tools/admin-anlegen.mjs', mail], { env, encoding: 'utf8' });
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'tools/e2e-server.mjs'], { env, stdio: 'ignore', windowsHide: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/anbieter'); break; } catch { await warte(500); } }
  const b = await chromium.launch();
  for (const L of ['de', 'en', 'hu']) {
    const c = await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: L }); const s = await c.newPage(); await c.addCookies([{ name: 'lang', value: L, url: BASE }]);
    await s.goto(BASE + '/#/', { waitUntil: 'networkidle' }); await s.waitForTimeout(1800); await s.screenshot({ path: `${ziel}/start-${L}.png` });
    await s.goto(BASE + '/#/kurs/1', { waitUntil: 'networkidle' }); await s.waitForTimeout(1800); await s.screenshot({ path: `${ziel}/kurs-${L}.png` });
    await s.request.post(BASE + '/api/anmelden', { data: { email: mail, passwort: pw }, headers: { Origin: BASE } });
    await s.goto(BASE + '/admin/', { waitUntil: 'networkidle' }); await s.waitForTimeout(2500); await s.screenshot({ path: `${ziel}/admin-${L}.png`, fullPage: false });
    await c.close();
  }
  await b.close();
} finally { try { process.kill(srv.pid, 'SIGKILL'); } catch { /* */ } }
for (const L of ['de', 'en', 'hu']) for (const n of ['start', 'kurs', 'admin']) console.log(`${n}-${L}.png`, statSync(`${ziel}/${n}-${L}.png`).size);
