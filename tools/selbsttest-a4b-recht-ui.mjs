// A4b: ohne Server prüfen: node tools/selbsttest-a4b-recht-ui.mjs --statisch
// Volltest erst nach A4a-Integration. Optional: --playwright=/pfad/index.mjs --chrome=/pfad/chrome
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { scryptSync, randomBytes } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const lies = p => readFileSync(join(root, p), 'utf8');
const texte = Object.fromEntries(['de', 'en', 'hu'].map(l => [l, JSON.parse(lies('texte/' + l + '.json'))]));
const admin = lies('public/admin/admin.js');
const start = admin.indexOf('// Rechtstexte-Bereich (A4b)');
const ende = admin.indexOf('// Ende Rechtstexte-Bereich (A4b)');
assert(start >= 0 && ende > start, 'Rechtstexte-Abschnitt vorhanden');
const code = admin.slice(start, ende);
assert(!/innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|\bstyle\s*=/.test(code), 'Sichere DOM-Erzeugung ohne Inline-Styles');
const keys = ['ueberschrift', 'titel_impresszum', 'titel_adatvedelem', 'titel_feltetelek',
  'status_erstellt', 'status_url', 'status_nicht_gesetzt', 'keine_version', 'hinweis_url',
  'hinweis_muster', 'hinweis_format', 'sprache', 'text', 'speichern', 'gespeichert', 'verlauf',
  'ansehen', 'wiederherstellen', 'wiederherstellen_ja', 'neu_laden', 'fehler_url_aktiv',
  'fehler_konflikt', 'fehler_ungueltig'].map(k => 'recht_admin_' + k);
for (const k of keys) {
  for (const l of ['de', 'en', 'hu']) assert(texte[l][k]?.trim(), l + ': ' + k);
  assert.notEqual(texte.en[k], texte.hu[k], k + ': Englisch ist kein Ungarisch');
  for (const l of ['de', 'en']) {
    const generator = await import(new URL('./' + l + '/teil3.mjs', import.meta.url));
    assert(Object.values(generator).some(obj => obj?.[k] === texte[l][k]), 'Generator: ' + l + ' ' + k);
  }
}
console.log('OK: statische DOM- und Übersetzungsprüfungen');

if (!process.argv.includes('--statisch')) {
  const arg = (name, standard) => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3) || standard;
  const playwrightPfad = arg('playwright', 'C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs');
  const chromePfad = arg('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
  if (!existsSync(playwrightPfad) || !existsSync(chromePfad)) {
    // Der Browserteil läuft mit echtem Chrome auf dem Windows-Laptop (Standardpfade oben); auf dem Omen (Linux) gibt es diese Pfade nicht.
    console.log('UEBERSPRUNGEN: Browserteil (playwright-core oder Chrome nicht gefunden); er wird auf dem Windows-Laptop gemessen, Optionen --playwright=... --chrome=...');
    process.exit(0);
  }
  const { chromium } = await import(pathToFileURL(playwrightPfad).href);
  const { DatabaseSync } = await import('node:sqlite');
  const ordner = mkdtempSync(join(tmpdir(), 'pe-a4b-recht-ui-'));
  const dbDatei = join(ordner, 'test.db');
  let browser, datenbank, kind;
  try {
    // DB_DATEI nur als Startoption des isolierten Kindes; kein Import des globalen db.mjs.
    // Freien Port vorab wählen: base muss exakt der Browser-Herkunft (Origin) entsprechen, sonst lehnt der Herkunftsschutz Anmeldungen ab.
    const portFrei = await new Promise(aufgeloest => {
      const probe = createServer();
      probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => aufgeloest(p)); });
    });
    kind = spawn(process.execPath, ['--input-type=module', '-e', `
      import { erstelleServer } from './app.mjs';
      const stripe = { webhooks: {}, customers: {}, checkout: { sessions: {} } };
      const app = erstelleServer({ stripe, webhookSecret: 'whsec_test', base: 'http://127.0.0.1:${portFrei}',
        nodeEnv: 'test', dbDatei: ${JSON.stringify(dbDatei)}, abgleichAutomatik: false,
        dateiOrdner: ${JSON.stringify(join(ordner, 'dateien'))}, sicherungOrdner: ${JSON.stringify(join(ordner, 'sicherung'))} });
      const server = app.listen(${portFrei}, '127.0.0.1', () => console.log('A4B_PORT=' + server.address().port));
    `], { cwd: root, env: { DB_DATEI: dbDatei, TEXT_SPRACHE: 'de', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'inherit'] });
    const port = await new Promise((resolve, reject) => {
      let ausgabe = '';
      const timer = setTimeout(() => reject(new Error('Testserver meldet keinen Port')), 20000);
      kind.once('error', e => { clearTimeout(timer); reject(e); });
      kind.once('exit', c => { clearTimeout(timer); reject(new Error('Testserver beendet: ' + c)); });
      kind.stdout.on('data', b => {
        ausgabe += b;
        const m = ausgabe.match(/A4B_PORT=(\d+)/);
        if (m) { clearTimeout(timer); resolve(Number(m[1])); }
      });
    });
    const base = 'http://127.0.0.1:' + port;
    datenbank = new DatabaseSync(dbDatei);
    datenbank.exec('PRAGMA busy_timeout=5000');
    const passwort = 'RechtUITest99!';
    const salz = randomBytes(16).toString('hex');
    const hash = 'scrypt$16384$8$1$' + salz + '$' + scryptSync(passwort, Buffer.from(salz, 'hex'), 64, { N: 16384, r: 8, p: 1 }).toString('hex');
    datenbank.prepare('INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)')
      .run('rechtui@example.com', hash, 'admin', new Date().toISOString());
    // Vorhandene WP6-Schlüssel heißen recht_impressum / recht_datenschutz / recht_teilnahmebedingungen.
    const modusSetzen = wert => datenbank.prepare('INSERT INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES(?,?,?) ON CONFLICT(schluessel) DO UPDATE SET wert=excluded.wert,aktualisiert_am=excluded.aktualisiert_am')
      .run('recht_impressum', wert, new Date().toISOString());
    modusSetzen('erstellt');
    browser = await chromium.launch({ executablePath: arg('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });
    const ctx = await browser.newContext();
    const ctx2 = await browser.newContext();
    for (const c of [ctx, ctx2]) {
      await c.addCookies([{ name: 'lang', value: 'de', url: base }]);
    }
    const page = await ctx.newPage();
    const t = texte.de;
    const karte = page.locator('[data-recht-seite="impresszum"]');
    const oeffnen = async () => {
      await page.goto(base + '/admin/');
      // Entweder Anmeldeformular oder Übersicht abwarten (die Seite rendert per JavaScript).
      await page.locator('input[name=email], button').first().waitFor();
      await page.waitForTimeout(500);
      if (await page.locator('input[name=email]').count()) {
        await page.fill('input[name=email]', 'rechtui@example.com');
        await page.fill('input[name=passwort]', passwort);
        await page.click('button[type=submit]');
      }
      // exact:true noetig, seit E7 auf dem Dashboard zusaetzlich "Meine Marke gestalten" anbietet (sonst Mehrdeutigkeit).
      await page.getByRole('button', { name: t.marke_titel, exact: true }).click();
      await karte.waitFor();
    };
    await oeffnen();
    assert(await page.getByRole('heading', { name: t.recht_admin_ueberschrift, exact: true }).isVisible());
    const text1 = '# Erste Fassung\n\nA4b eigener Rechtstext\n\n<script>window.a4bAngriff=1</script>';
    const fuellen = async text => {
      // Der Label-Text der Sprachauswahl enthält auch die Optionen; daher direkte Elementauswahl innerhalb der Karte.
      await karte.locator('label.feld select').selectOption('de');
      await karte.locator('label.feld textarea').fill(text);
    };
    const gespeichert = async () => {
      await page.locator('[data-recht-admin] > [role="status"]').getByText(t.recht_admin_gespeichert, { exact: true }).waitFor();
      await karte.locator('textarea:not([disabled])').waitFor();
    };
    await fuellen(text1);
    await karte.getByRole('button', { name: t.recht_admin_speichern, exact: true }).click();
    // Der erste Schreibzugriff muss die vorhandene Step-up-Abfrage öffnen.
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.locator('input[type="password"]').fill(passwort);
    await dialog.locator('form').evaluate(form => form.requestSubmit());
    await gespeichert();
    const publicPage = await ctx.newPage();
    await publicPage.goto(base + '/jogi/impresszum');
    assert((await publicPage.locator('body').innerText()).includes('A4b eigener Rechtstext'));
    assert((await publicPage.locator('body').innerText()).includes('<script>window.a4bAngriff=1</script>'));
    assert.equal(await publicPage.evaluate(() => window.a4bAngriff), undefined, 'Skript wird nicht ausgeführt');
    assert.equal(await karte.locator('textarea').getAttribute('lang'), 'de');
    await fuellen('Zweite Fassung A4b');
    await karte.getByRole('button', { name: t.recht_admin_speichern, exact: true }).click();
    await gespeichert();
    await karte.locator('summary').click();
    assert.equal(await karte.locator('li').count(), 2, 'Verlauf zeigt zwei Versionen');
    await karte.getByRole('button', { name: t.recht_admin_ansehen, exact: true }).last().click();
    await karte.locator('pre').waitFor();
    assert.equal(await karte.locator('pre').textContent(), text1);
    const restore = karte.getByRole('button', { name: t.recht_admin_wiederherstellen, exact: true }).last();
    await restore.click();
    await karte.getByRole('button', { name: t.recht_admin_wiederherstellen_ja, exact: true }).click();
    await gespeichert();
    // Die Erfolgsmeldung der vorherigen Speicherung kann noch stehen, während die Wiederherstellung läuft: auf den neuen Textfeldinhalt warten.
    for (let i = 0; i < 50 && (await karte.locator('textarea').inputValue()) !== text1; i++) await page.waitForTimeout(200);
    assert.equal(await karte.locator('textarea').inputValue(), text1);
    const liste = async c => {
      const r = await c.request.get(base + '/api/admin/recht');
      assert.equal(r.status(), 200);
      return (await r.json()).seiten.find(s => s.seite === 'impresszum');
    };
    assert.equal((await liste(ctx)).aktiv.version, 3, 'Wiederherstellen erzeugt Version 3');
    // Zweiter, anonymer Browser (Käufer): sieht die wiederhergestellte Fassung, das Skript läuft nicht.
    const kaeufer = await browser.newContext();
    const kaeuferSeite = await kaeufer.newPage();
    await kaeuferSeite.goto(base + '/jogi/impresszum');
    const kaeuferText = await kaeuferSeite.locator('body').innerText();
    assert(kaeuferText.includes('A4b eigener Rechtstext'), 'Käufer sieht die wiederhergestellte Fassung');
    assert(!kaeuferText.includes('Zweite Fassung A4b'), 'Käufer sieht nicht die Zwischenfassung');
    assert.equal(await kaeuferSeite.evaluate(() => window.a4bAngriff), undefined, 'Skript läuft beim Käufer nicht');
    await kaeufer.close();
    // Ein Admin-Login beendet alle anderen Sitzungen desselben Admins (auth.mjs sitzungErzeugen); ein Konflikt entsteht daher
    // nur mit einem zweiten Tab DERSELBEN Sitzung. Der zweite Tab wird über dieselbe Kontext-Sitzung (Cookie) simuliert.
    assert.equal((await ctx.request.post(base + '/api/admin/stepup', { headers: { Origin: base }, data: { passwort } })).status(), 200);
    const fremd = await ctx.request.post(base + '/api/admin/recht/impresszum', {
      headers: { Origin: base },
      data: { inhalt: 'Zwischenzeitliche Änderung', sprache: 'de', basis_version: 3 },
    });
    assert([200, 201].includes(fremd.status()), 'Zweite Sitzung speichert (Status ' + fremd.status() + ')');
    await fuellen('Lokale ungespeicherte Änderung');
    await karte.getByRole('button', { name: t.recht_admin_speichern, exact: true }).click();
    await karte.getByText(t.recht_admin_fehler_konflikt, { exact: true }).waitFor();
    assert.equal(await karte.locator('textarea').inputValue(), 'Lokale ungespeicherte Änderung');
    await karte.getByRole('button', { name: t.recht_admin_neu_laden, exact: true }).click();
    await karte.locator('textarea:not([disabled])').waitFor();
    assert.equal(await karte.locator('textarea').inputValue(), 'Zwischenzeitliche Änderung');
    modusSetzen('https://example.com/impressum');
    await oeffnen();
    await karte.getByText(t.recht_admin_hinweis_url, { exact: true }).waitFor();
    assert.equal(await karte.locator('textarea,select').count(), 0, 'URL-Modus ohne Bearbeitungsfelder');
    assert.equal(await karte.getByRole('button', { name: t.recht_admin_speichern, exact: true }).count(), 0);
    console.log('OK: Browser, Klartext, Verlauf, Version 3, Konflikt und URL-Modus');
  } finally {
    if (browser) await browser.close();
    if (datenbank) datenbank.close();
    if (kind && kind.exitCode === null) { const beendet = once(kind, 'exit'); kind.kill(); await beendet; }
    rmSync(ordner, { recursive: true, force: true });
  }
}
