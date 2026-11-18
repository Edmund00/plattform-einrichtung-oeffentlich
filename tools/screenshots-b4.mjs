// Screenshots fuer die Pruefung (Etappe B4, nur lokal, Testmodus, ohne Anzeige): Kursplattform (Liste, Kursseite, nach Kauf, Meine Kurse),
// Admin (Tabelle, Kennzahlen), Praesentation (Vollseite de/en/hu), je Desktop 1440 und Mobil 390.
// Aufruf: node tools/screenshots-b4.mjs <ausgabeordner>      (Kopie der Muster-DB, Port 4493, Wegwerf-Konten mit Zufallspasswort, nichts gespeichert)
import { copyFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
const ord = resolve(process.argv[2] || 'daten/screenshots-b4'); mkdirSync(ord, { recursive: true });
const dbf = `${ord}/sicht.db`; copyFileSync('daten/muster.db', dbf);
for (const x of ['-wal', '-shm']) { try { copyFileSync('daten/muster.db' + x, dbf + x); } catch { /* nicht vorhanden */ } }
const PORT = 4493, BASE = `http://localhost:${PORT}`;
const pw = 'Sicht-' + randomBytes(9).toString('hex') + '!', adminMail = 'sicht.admin@example.com', kundeMail = 'sicht.kunde@example.com';
const env = { ...process.env, DB_DATEI: dbf, PORT: String(PORT), BASE_URL: BASE, DATEI_ORDNER: `${ord}/dateien`, MAIL_DUMP: `${ord}/mails.jsonl`, ADMIN_PASSWORT: pw,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_platzhalter_nur_ansicht', STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_platzhalter',
  ANBIETER_NAME: 'Musterfirma (Demo)', ANBIETER_ANSCHRIFT: 'Beispielstrasse 1, 12345 Musterstadt', ANBIETER_TELEFON: '+49 30 0000000', ANBIETER_EMAIL: 'edmundautomat@gmail.com',
  VERKAUFSMELDUNG_MAIL: 'edmundautomat@gmail.com', SUPPORT_MAIL: 'edmundautomat@gmail.com' };
const a = spawnSync('node', ['--disable-warning=ExperimentalWarning', 'tools/admin-anlegen.mjs', adminMail], { env, encoding: 'utf8' });
console.log('Admin:', (a.stdout + a.stderr).trim().slice(0, 60));
// Kunde mit gekauftem Kurs 1 direkt in der Kopie anlegen (bestaetigt, Zugang, bezahlte Bestellung)
Object.assign(process.env, { DB_DATEI: dbf });
const { db } = await import(pathToFileURL(resolve('db.mjs')).href); const { passwortHashen } = await import(pathToFileURL(resolve('auth.mjs')).href);
const jetzt = new Date().toISOString();
const uid = Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,'kunde',?,?)").run(kundeMail, await passwortHashen(pw), jetzt, Date.now()).lastInsertRowid);
const kurs = db.prepare("SELECT id,preis_cent,waehrung FROM kurse WHERE status='veroeffentlicht' ORDER BY id LIMIT 1").get();
db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES('cs_sicht','pi_sicht',?,?,?,?,'bezahlt','einmal',?,?)").run(uid, kurs.id, kurs.preis_cent, kurs.waehrung, jetzt, jetzt);
db.prepare("INSERT OR IGNORE INTO zugaenge(benutzer_id,kurs_id,quelle,erstellt) VALUES(?,?,'zahlung',?)").run(uid, kurs.id, jetzt);
db.close?.();
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'tools/e2e-server.mjs'], { env, stdio: 'ignore', windowsHide: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const dateien = [];
try {
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/anbieter'); break; } catch { await warte(500); } }
  const b = await chromium.launch();
  const aufnahme = async (s, name) => { const p = `${ord}/${name}.png`; await s.screenshot({ path: p, fullPage: true }); dateien.push(p); };
  for (const [gr, breite, hoehe] of [['desktop', 1440, 900], ['mobil', 390, 844]]) {
    // --- Kunde, Sprache de ---
    const ctx = await b.newContext({ viewport: { width: breite, height: hoehe }, locale: 'de' }); const s = await ctx.newPage();
    await ctx.addCookies([{ name: 'lang', value: 'de', url: BASE }]);
    await s.goto(BASE + '/#/', { waitUntil: 'networkidle' }); await s.waitForTimeout(1800); await aufnahme(s, `plattform-liste-${gr}`);
    await s.goto(BASE + `/#/kurs/${kurs.id}`, { waitUntil: 'networkidle' }); await s.waitForTimeout(1800); await aufnahme(s, `plattform-kursseite-${gr}`);
    { const m3 = await s.evaluate(() => { const e = document.querySelector('.kurs-beschreibung-text'); const cs = e ? getComputedStyle(e) : null; return { hyphens: cs?.hyphens, ow: cs?.overflowWrap, scroll: document.documentElement.scrollWidth, fenster: innerWidth }; });
      console.log(gr, 'B7 Kursbeschreibung:', JSON.stringify(m3));
      if (m3.hyphens !== 'manual' || m3.ow !== 'break-word' || m3.scroll > m3.fenster) { console.log('FEHLER B7 Kursbeschreibung Umbruch'); process.exitCode = 1; } }
    const r = await s.request.post(BASE + '/api/anmelden', { data: { email: kundeMail, passwort: pw }, headers: { Origin: BASE } }); console.log(gr, 'Kunde-Login', r.status());
    await s.goto(BASE + `/?kauf=erfolg&kurs=${kurs.id}`, { waitUntil: 'networkidle' }); await s.waitForTimeout(2500); await aufnahme(s, `plattform-nach-kauf-${gr}`);
    await s.goto(BASE + '/#/eloadasaim', { waitUntil: 'networkidle' }); await s.waitForTimeout(1800); await aufnahme(s, `plattform-meine-kurse-${gr}`);
    await ctx.close();
    // --- Admin ---
    const ca = await b.newContext({ viewport: { width: breite, height: hoehe }, locale: 'de' }); const sa = await ca.newPage();
    await ca.addCookies([{ name: 'lang', value: 'de', url: BASE }]);
    const ra = await sa.request.post(BASE + '/api/anmelden', { data: { email: adminMail, passwort: pw }, headers: { Origin: BASE } }); console.log(gr, 'Admin-Login', ra.status());
    await sa.goto(BASE + '/admin/', { waitUntil: 'networkidle' }); await sa.waitForTimeout(2500); await aufnahme(sa, `admin-gesamt-${gr}`);
    {   // B5 Pruefung: schmal = Karten statt Tabelle, keine Seitwaerts-Verschiebung, kein Buchstaben-Umbruch
      const m = await sa.evaluate(() => { const tr = [...document.querySelectorAll('.ereignis-tabelle tbody tr')]; const td = tr[0]?.querySelector('td:nth-child(3)');
        return { zeilen: tr.length, trAnzeige: tr[0] ? getComputedStyle(tr[0]).display : null, breiteSeite: document.documentElement.scrollWidth, fenster: innerWidth, tdBreite: td ? Math.round(td.getBoundingClientRect().width) : null, theadSichtbar: (() => { const h = document.querySelector('.ereignis-tabelle thead'); return h ? h.getBoundingClientRect().width > 5 : null; })() }; });
      console.log(gr, 'Ereignisse:', JSON.stringify(m));
      const m2 = await sa.evaluate(() => { const tr = [...document.querySelectorAll('.ereignis-tabelle tbody tr')]; const h = tr.map((x) => x.getBoundingClientRect().height); const bt = [...document.querySelectorAll('.ereignis-export .knopf')].map((x) => { const r = x.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }; });
        return { kartenHoeheMittel: Math.round(h.reduce((s, x) => s + x, 0) / Math.max(1, h.length)), export: bt }; });
      console.log(gr, 'B7 Karten/Export:', JSON.stringify(m2));
      if (gr === 'mobil' && !(m2.kartenHoeheMittel <= 135 && m2.export.length === 2 && m2.export[0].top === m2.export[1].top && m2.export.every((x) => x.h >= 44 && x.w >= 120))) { console.log('FEHLER B7 Admin mobil: Karten zu hoch oder Export nicht einzeilig/gross'); process.exitCode = 1; }
      if (gr === 'mobil' && !(m.zeilen > 0 && m.trAnzeige === 'flex' && m.breiteSeite <= m.fenster && m.tdBreite > 120 && m.theadSichtbar === false)) { console.log('FEHLER mobile Ereigniskarten'); process.exitCode = 1; }
      if (gr === 'desktop' && !(m.trAnzeige === 'table-row' && m.theadSichtbar === true)) { console.log('FEHLER Desktop-Tabelle veraendert'); process.exitCode = 1; }
    }
    // Kennzahlen = oberer Bereich, Tabelle = erste Tabelle der Seite
    const kz = sa.locator('[class*=kennzahl], [id*=kennzahl], .kpi, [class*=kpi]').first();
    if (await kz.count()) { const p = `${ord}/admin-kennzahlen-${gr}.png`; await kz.screenshot({ path: p }); dateien.push(p); } else console.log(gr, 'Hinweis: kein eigener Kennzahlen-Block gefunden, siehe admin-gesamt');
    const tb = sa.locator('table').first();
    if (await tb.count()) { const p = `${ord}/admin-tabelle-${gr}.png`; await tb.screenshot({ path: p }); dateien.push(p); } else console.log(gr, 'Hinweis: keine Tabelle gefunden, siehe admin-gesamt');
    await ca.close();
    // --- Praesentation, Vollseite je Sprache ---
    for (const [L, pfad] of [['de', 'index.html'], ['en', 'en/index.html'], ['hu', 'hu/index.html']]) {
      const cp = await b.newContext({ viewport: { width: breite, height: hoehe } }); const sp = await cp.newPage();
      await sp.goto(pathToFileURL(resolve('../praesentation/public/' + pfad)).href, { waitUntil: 'load' }); await sp.waitForTimeout(1200);
      {   // B7 Pruefung Praesentation
        const k = await sp.evaluate(() => { const f = document.querySelector('.kontakt-fix'); const n = document.querySelector('details.nachweis'); return { kontaktSichtbar: f ? getComputedStyle(f).display !== 'none' : false, nachweisOffen: n ? n.open : null, scroll: document.documentElement.scrollWidth, fenster: innerWidth }; });
        await sp.locator('figure a').first().scrollIntoViewIfNeeded(); await sp.locator('figure a').first().click(); await sp.waitForTimeout(500);
        const lb = await sp.evaluate(() => { const d = document.getElementById('lb'); return { offen: d.open, src: d.querySelector('img').getAttribute('src'), breite: Math.round(d.querySelector('img').getBoundingClientRect().width) }; });
        console.log(gr, L, 'B7 Praesentation:', JSON.stringify({ ...k, lightbox: lb }));
        const ok = lb.offen && /bilder\//.test(lb.src) && lb.breite >= (gr === 'mobil' ? 880 : 1000) && k.scroll <= k.fenster && (gr === 'mobil' ? k.kontaktSichtbar && k.nachweisOffen === false : k.kontaktSichtbar === false && k.nachweisOffen === true);
        if (!ok) { console.log('FEHLER B7 Praesentation', gr, L); process.exitCode = 1; }
        await sp.keyboard.press('Escape');
      }
      await aufnahme(sp, `praesentation-${L}-${gr}`); await cp.close();
    }
  }
  await b.close();
} finally { try { process.kill(srv.pid, 'SIGKILL'); } catch { /* weg */ } }
let leer = 0; for (const p of dateien) { const g = statSync(p).size; if (g < 5000) leer++; }
console.log(`Dateien: ${dateien.length}, davon kleiner 5 KB: ${leer}, Ordner: ${ord}`);
for (const f of readdirSync(ord).filter((x) => x.endsWith('.png'))) console.log(f, statSync(`${ord}/${f}`).size);
