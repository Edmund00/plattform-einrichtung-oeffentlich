// Oeffentliche Seiten der Muster-Plattform ansehen (Kopie der Muster-DB, Port 4464, Testmodus-Platzhalter). Aufruf: node tools/seiten-sicht.mjs <ordner> <sprache> <breite> [kurs-id ...]
import { copyFileSync, mkdirSync, cpSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
const [ord = 'daten/admin-sicht', L = 'de', breite = '1280', ...ids] = process.argv.slice(2);
mkdirSync(ord, { recursive: true }); const dbf = `${ord}/seiten.db`; copyFileSync('daten/muster.db', dbf);
for (const x of ['-wal', '-shm']) { try { copyFileSync('daten/muster.db' + x, dbf + x); } catch { /* */ } }
cpSync('daten/muster-dateien', `${ord}/seiten-dateien`, { recursive: true });
const env = { ...process.env, DB_DATEI: dbf, PORT: '4464', BASE_URL: 'http://localhost:4464', DATEI_ORDNER: `${ord}/seiten-dateien`, MAIL_DUMP: `${ord}/m.jsonl`,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_platzhalter_nur_ansicht', STRIPE_WEBHOOK_SECRET: 'whsec_platzhalter',
  ANBIETER_NAME: 'Musterfirma (Demo)', ANBIETER_ANSCHRIFT: 'Beispielstrasse 1, 12345 Musterstadt', ANBIETER_TELEFON: '+49 30 0000000', ANBIETER_EMAIL: 'edmundautomat@gmail.com', VERKAUFSMELDUNG_MAIL: 'edmundautomat@gmail.com', SUPPORT_MAIL: 'edmundautomat@gmail.com' };
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'tools/e2e-server.mjs'], { env, stdio: 'ignore', windowsHide: true });
try {
  for (let i = 0; i < 40; i++) { try { await fetch('http://localhost:4464/api/anbieter'); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: +breite, height: 900 }, locale: L }); const s = await ctx.newPage();
  await ctx.addCookies([{ name: 'lang', value: L, url: 'http://localhost:4464' }]);
  for (const [name, hash] of [['start', '#/'], ...ids.map((i) => ['kurs' + i, '#/kurs/' + i])]) {
    await s.goto('http://localhost:4464/' + hash, { waitUntil: 'networkidle' }); await s.waitForTimeout(1800);
    await s.screenshot({ path: `${ord}/${name}-${L}-${breite}.png`, fullPage: true, ...(process.env.CLIP_H ? { clip: { x: 0, y: 0, width: +breite, height: +process.env.CLIP_H } } : {}) }); console.log(name, s.url());
  }
  await b.close();
} finally { try { process.kill(srv.pid, 'SIGKILL'); } catch { /* */ } }
