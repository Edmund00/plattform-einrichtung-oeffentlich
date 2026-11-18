// B9: Demo-Instanz lokal ansehen und pruefen (leere DB, DEMO_MODUS=1, Port 4500, Stripe-Platzhalter, keine Mails). Ergebnis: Pruefzeilen + Screenshots in <ordner>.
import { mkdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
const ord = resolve(process.argv[2] || 'daten/demo-sicht'); mkdirSync(ord, { recursive: true });
const PORT = 4500, BASE = `http://localhost:${PORT}`;
const env = { ...process.env, DB_DATEI: `${ord}/demo.db`, PORT: String(PORT), BASE_URL: BASE, DATEI_ORDNER: `${ord}/dateien`, MAIL_DUMP: `${ord}/m.jsonl`, DEMO_MODUS: '1',
  STRIPE_SECRET_KEY: 'sk_test_platzhalter_nur_ansicht', STRIPE_WEBHOOK_SECRET: 'whsec_platzhalter', ANBIETER_NAME: 'Musterakademie (Demo)', ANBIETER_ANSCHRIFT: 'Beispielstrasse 1, 12345 Musterstadt', ANBIETER_EMAIL: 'demo@example.com' };
delete env.TEXT_SPRACHE;
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'tools/e2e-server.mjs'], { env, stdio: 'ignore', windowsHide: true });
let ok = 0, n = 0; const pruefe = (name, gut, d = '') => { n++; if (gut) ok++; console.log((gut ? 'OK     ' : 'FEHLER ') + name + (gut ? '' : ' ' + d)); };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/anbieter'); break; } catch { await warte(500); } }
  await warte(1500);
  const kurse = await (await fetch(BASE + '/api/kurse')).json();
  pruefe('Demo-Seed beim ersten Start: 3 Beispielkurse', kurse.length === 3, kurse.length);
  const b = await chromium.launch();
  for (const [gr, w, h] of [['desktop', 1440, 900], ['mobil', 390, 844]]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, locale: 'de' }); const s = await c.newPage(); await c.addCookies([{ name: 'lang', value: 'de', url: BASE }]);
    await s.goto(BASE + '/#/', { waitUntil: 'networkidle' }); await s.waitForTimeout(1500);
    const box = s.locator('.demo-box'); const txt = (await box.innerText()).replace(/\s+/g, ' ');
    pruefe(`${gr}: Demo-Box sichtbar mit Testmodus-Hinweis und Testkarte 4242 4242 4242 4242`, await box.isVisible() && /4242 4242 4242 4242/.test(txt) && /abgebucht/.test(txt), txt);
    pruefe(`${gr}: zwei Knoepfe "Als Demo-Kaeufer starten" und "Admin ansehen (nur Ansicht)"`, (await box.locator('button').count()) === 2 && /Demo-Käufer/i.test(txt) && /nur Ansicht/i.test(txt));
    pruefe(`${gr}: keine Seitwaerts-Verschiebung`, (await s.evaluate(() => document.documentElement.scrollWidth)) <= w);
    await s.screenshot({ path: `${ord}/demo-box-${gr}.png`, fullPage: false });
    await box.locator('button').first().click(); await s.waitForTimeout(2500);
    const ich = await s.evaluate(async () => (await (await fetch('/api/ich')).json()));
    pruefe(`${gr}: Klick "Demo-Kaeufer" meldet an`, ich.angemeldet === true, JSON.stringify(ich));
    await s.screenshot({ path: `${ord}/demo-kaeufer-${gr}.png` });
    await c.close();
    const ca = await b.newContext({ viewport: { width: w, height: h }, locale: 'de' }); const sa = await ca.newPage(); await ca.addCookies([{ name: 'lang', value: 'de', url: BASE }]);
    await sa.goto(BASE + '/?demo=admin', { waitUntil: 'networkidle' }); await sa.waitForTimeout(3000);
    pruefe(`${gr}: Link ?demo=admin fuehrt in den Admin (angemeldet)`, sa.url().includes('/admin'), sa.url());
    const banner = (await sa.locator('.demo-banner').innerText().catch(() => '')).trim();
    pruefe(`${gr}: Admin zeigt Banner "Demo: nur Ansicht"`, /nur Ansicht/.test(banner), banner);
    const kpi = await sa.locator('.kpi').count(); pruefe(`${gr}: Demo-Admin sieht Kennzahlen (${kpi})`, kpi >= 5);
    const w2 = await sa.evaluate(async () => { const r = await fetch('/api/admin/kurse/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titel: 'Hack' }) }); return { s: r.status, d: await r.json() }; });
    pruefe(`${gr}: Schreibversuch im Admin-Browser: 403 mit freundlichem Hinweis`, w2.s === 403 && /nur Ansicht/.test(w2.d.text || ''), JSON.stringify(w2));
    await sa.screenshot({ path: `${ord}/demo-admin-${gr}.png` });
    await ca.close();
  }
  await b.close();
  for (const f of ['demo-box', 'demo-kaeufer', 'demo-admin']) for (const g of ['desktop', 'mobil']) pruefe(`Screenshot ${f}-${g} nicht leer`, statSync(`${ord}/${f}-${g}.png`).size > 10000);
} finally { try { process.kill(srv.pid, 'SIGKILL'); } catch { /* weg */ } }
console.log(`Demo-Sicht: ${ok} von ${n}`); process.exit(ok === n ? 0 : 1);
