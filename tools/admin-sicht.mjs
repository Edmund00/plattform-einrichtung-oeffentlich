// Muster-Admin im Browser ansehen (nur lokal, Testmodus): Kopie der Muster-DB, eigener Port 4462, Wegwerf-Admin mit Zufallspasswort (nirgends gespeichert).
// Aufruf: node tools/admin-sicht.mjs <ausgabeordner> [sprache] [breite]   (Env wie Muster-Start.ps1 wird NICHT gebraucht: Stripe-Schluessel nur als Platzhalter-Testwert)
import { copyFileSync, mkdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
const [ord = 'daten/admin-sicht', L = 'de', breite = '1280'] = process.argv.slice(2);
mkdirSync(ord, { recursive: true });
const dbf = `${ord}/sicht.db`; copyFileSync('daten/muster.db', dbf); for (const x of ['-wal', '-shm']) { try { copyFileSync('daten/muster.db' + x, dbf + x); } catch { /* nicht vorhanden */ } }
const pw = 'Sicht-' + randomBytes(9).toString('hex') + '!'; const email = 'sicht.admin@example.com';
const env = { ...process.env, DB_DATEI: dbf, PORT: '4462', BASE_URL: 'http://localhost:4462', DATEI_ORDNER: `${ord}/dateien`, MAIL_DUMP: `${ord}/mails.jsonl`, ADMIN_PASSWORT: pw,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_platzhalter_nur_ansicht', STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_platzhalter',
  ANBIETER_NAME: 'Musterfirma (Demo)', ANBIETER_ANSCHRIFT: 'Beispielstrasse 1, 12345 Musterstadt', ANBIETER_TELEFON: '+49 30 0000000', ANBIETER_EMAIL: 'edmundautomat@gmail.com', VERKAUFSMELDUNG_MAIL: 'edmundautomat@gmail.com', SUPPORT_MAIL: 'edmundautomat@gmail.com' };
const a = spawnSync('node', ['--disable-warning=ExperimentalWarning', 'tools/admin-anlegen.mjs', email], { env, encoding: 'utf8' });
console.log('Admin:', (a.stdout + a.stderr).trim().slice(0, 80));
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'tools/e2e-server.mjs'], { env, stdio: 'ignore', windowsHide: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 40; i++) { try { await fetch('http://localhost:4462/api/anbieter'); break; } catch { await warte(500); } }
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: +breite, height: 900 }, locale: L }); const s = await ctx.newPage();
  await ctx.addCookies([{ name: 'lang', value: L, url: 'http://localhost:4462' }]);
  const r = await s.request.post('http://localhost:4462/api/anmelden', { data: { email, passwort: pw }, headers: { Origin: 'http://localhost:4462' } });
  console.log('Login', r.status());
  await s.goto('http://localhost:4462/admin/', { waitUntil: 'networkidle' }); await s.waitForTimeout(2500);
  await s.screenshot({ path: `${ord}/admin-${L}-${breite}.png`, fullPage: true, ...(process.env.CLIP_H ? { clip: { x: 0, y: 0, width: +breite, height: +process.env.CLIP_H } } : {}) });
  console.log('Text:', (await s.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 600));
  await b.close();
} finally { try { process.kill(srv.pid, 'SIGKILL'); } catch { /* weg */ } }
