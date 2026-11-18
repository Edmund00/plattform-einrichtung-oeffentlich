// A4a: Rechtstexte im Admin — Backend (recht_text, recht_aktiv, Klartext-Format, Einwilligung)
import './test-sprache.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ordner = mkdtempSync(join(tmpdir(), 'pe-a4a-'));
process.env.DB_DATEI = join(ordner, 'test.db');

let ok = 0, schlecht = 0;
const pruefe = (name, wert, detail = '') => {
  wert ? ok++ : schlecht++;
  console.log((wert ? 'OK     ' : 'FEHLER ') + name + (!wert && detail ? '  -> ' + String(detail).slice(0, 220) : ''));
};
const lies = (pfad) => readFileSync(new URL('../' + pfad, import.meta.url), 'utf8');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

const alleServer = [];

try {
  // ======== A) Texte (Fehlercodes in allen drei Sprachen) =====================
  const de = JSON.parse(lies('texte/de.json'));
  const hu = JSON.parse(lies('texte/hu.json'));
  const en = JSON.parse(lies('texte/en.json'));

  const neueKs = ['recht_url_aktiv', 'recht_konflikt', 'recht_text_ungueltig', 'recht_sprache_ungueltig'];
  for (const k of neueKs) {
    pruefe(`de.json: ${k}`, typeof de[k] === 'string' && de[k].length > 1, de[k]);
    pruefe(`hu.json: ${k}`, typeof hu[k] === 'string' && hu[k].length > 1, hu[k]);
    pruefe(`en.json: ${k}`, typeof en[k] === 'string' && en[k].length > 1, en[k]);
  }
  pruefe('en.json ≠ hu.json (recht_url_aktiv)', en['recht_url_aktiv'] !== hu['recht_url_aktiv'], 'gleich!');

  // ======== B) Modul-Exporte ==================================================
  const rechtTextModul = await import('../recht-text.mjs');
  pruefe('recht-text.mjs: setzeRechtDb', typeof rechtTextModul.setzeRechtDb === 'function');
  pruefe('recht-text.mjs: leseEinwilligungVersion', typeof rechtTextModul.leseEinwilligungVersion === 'function');
  pruefe('recht-text.mjs: setzeTestFehler (Atomic-Hook)', typeof rechtTextModul.setzeTestFehler === 'function');

  // ======== C) Server-Setup ===================================================
  const attrappe = {
    webhooks: { constructEventAsync: async () => { throw new Error('kein webhook'); } },
    customers: { create: async () => ({ id: 'cus_attrappe' }) },
    checkout: {
      sessions: {
        create: async () => ({ id: 'cs_attrappe', url: 'https://example.com/checkout', status: 'open' }),
        list: async () => ({ data: [] }),
      },
    },
  };

  const { erstelleServer } = await import('../app.mjs');
  const { passwortHashen } = await import('../auth.mjs');
  const { db } = await import('../db.mjs');

  const tabellenNamen = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  pruefe('DB: Tabelle recht_text', tabellenNamen.includes('recht_text'), JSON.stringify(tabellenNamen));
  pruefe('DB: Tabelle recht_aktiv', tabellenNamen.includes('recht_aktiv'), JSON.stringify(tabellenNamen));

  const PASS = 'RechtTest99';
  const ph = await passwortHashen(PASS);
  db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)").run('admin@recht.local', ph, 'admin', new Date().toISOString());
  const phK = await passwortHashen(PASS);
  db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)").run('kunde@recht.local', phK, 'kunde', new Date().toISOString());

  const BASE = 'http://localhost';
  const app = erstelleServer({ stripe: attrappe, webhookSecret: 'whsec_test', base: BASE, nodeEnv: 'test', dbDatei: process.env.DB_DATEI });
  const srv = app.listen(0, '127.0.0.1');
  alleServer.push(srv);
  await warte(300);
  const port = srv.address().port;

  let ckAdmin = '', ckKunde = '';

  async function req(path, method = 'GET', body, hdrs = {}) {
    const headers = { 'Content-Type': 'application/json', Cookie: ckAdmin, Origin: BASE, ...hdrs };
    if ('Origin' in hdrs && hdrs.Origin === null) delete headers.Origin;
    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await r.text();
    return { status: r.status, headers: r.headers, text, json: () => JSON.parse(text) };
  }

  let r;

  // Admin anmelden
  r = await req('/api/anmelden', 'POST', { email: 'admin@recht.local', passwort: PASS }, { Cookie: '', Origin: BASE });
  ckAdmin = r.headers.get('set-cookie')?.split(';')[0] ?? '';
  pruefe('C: Admin-Anmeldung', r.status === 200, `${r.status}`);

  // Kunde anmelden
  r = await req('/api/anmelden', 'POST', { email: 'kunde@recht.local', passwort: PASS }, { Cookie: '', Origin: BASE });
  ckKunde = r.headers.get('set-cookie')?.split(';')[0] ?? '';

  // Step-up
  r = await req('/api/admin/stepup', 'POST', { passwort: PASS });
  pruefe('C: Step-up', r.status === 200, `${r.status}`);

  // recht_impressum = 'erstellt'
  db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES('recht_impressum','erstellt',datetime('now'))").run();

  // ======== K1) Neuer Text sichtbar ==========================================

  // Öffentliche Seite vor eigenem Text (generierte Vorlage, Musterhinweis erwartet)
  r = await req('/jogi/impresszum', 'GET', undefined, { Cookie: '', Origin: BASE });
  pruefe('K1 vor POST: impresszum 200', r.status === 200, `${r.status}`);

  // POST neuer Text
  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: '# Impresszum\n\nTest GmbH, Musterstr. 1\n\n- Telefon: 123', sprache: 'de', basis_version: 0 });
  pruefe('K1 POST neuer Text → 201', r.status === 201, `${r.status} ${r.text.slice(0, 100)}`);
  let v1 = r.json?.()?.version;
  pruefe('K1 POST: version in Antwort', typeof v1 === 'number' && v1 >= 1, `v1=${v1}`);

  // GET nach POST: neuer Text, kein Musterhinweis
  r = await req('/jogi/impresszum', 'GET', undefined, { Cookie: '', Origin: BASE });
  pruefe('K1 GET nach POST: 200', r.status === 200, `${r.status}`);
  pruefe('K1 GET nach POST: enthält <h2>', r.text.includes('<h2>'), r.text.slice(0, 300));
  pruefe('K1 GET nach POST: enthält <ul>', r.text.includes('<ul>'), r.text.slice(0, 300));
  pruefe('K1 GET nach POST: kein Musterhinweis-Block', !r.text.includes('musterhinweis-block'), r.text.slice(0, 300));

  // GET Liste
  r = await req('/api/admin/recht');
  pruefe('K1 GET /api/admin/recht: 200', r.status === 200, `${r.status}`);
  const liste1 = r.json?.()?.seiten;
  pruefe('K1 GET Liste: { seiten: Array }', Array.isArray(liste1), JSON.stringify(liste1)?.slice(0, 100));
  const imprEintrag = Array.isArray(liste1) ? liste1.find(e => e.seite === 'impresszum') : null;
  pruefe('K1 GET Liste: impresszum-Eintrag', !!imprEintrag, JSON.stringify(liste1)?.slice(0, 200));
  pruefe('K1 GET Liste: modus = erstellt', imprEintrag?.modus === 'erstellt', `modus: ${imprEintrag?.modus}`);
  pruefe('K1 GET Liste: aktiv.version = v1', imprEintrag?.aktiv?.version === v1, `aktiv: ${JSON.stringify(imprEintrag?.aktiv)}`);

  // GET einzelne Version
  r = await req(`/api/admin/recht/impresszum/${v1}`);
  pruefe('K1 GET /:seite/:version: 200', r.status === 200, `${r.status}`);
  pruefe('K1 GET /:seite/:version: inhalt vorhanden', typeof r.json?.()?.inhalt === 'string', r.text.slice(0, 100));

  // ======== K2) Escaping ======================================================
  const xssInhalt = '# Test\n\n<script>window.__x=1</script>\n\n"><img src=x onerror=window.__x=2>\n\n& und \'';
  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: xssInhalt, sprache: 'de', basis_version: v1 });
  pruefe('K2 POST XSS → 201', r.status === 201, `${r.status} ${r.text.slice(0, 100)}`);
  let v2 = r.json?.()?.version;

  r = await req('/jogi/impresszum', 'GET', undefined, { Cookie: '', Origin: BASE });
  pruefe('K2 response: &lt;script&gt;', r.text.includes('&lt;script&gt;'), r.text.slice(0, 400));
  pruefe('K2 response: kein rohes <script', !r.text.includes('<script'), r.text.slice(0, 400));
  pruefe('K2 response: kein onerror-Tag', !/<[^>]+onerror/.test(r.text), r.text.slice(0, 400));
  pruefe('K2 response: &amp; escaped', r.text.includes('&amp;'), r.text.slice(0, 400));

  // ======== K3) Autorisierung =================================================
  const zeilenVorK3 = db.prepare('SELECT COUNT(*) AS n FROM recht_text').get().n;

  // Ohne Anmeldung → 401
  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: 'x', sprache: 'de', basis_version: 0 }, { Cookie: '', Origin: BASE });
  pruefe('K3 ohne Anmeldung → 401', r.status === 401, `${r.status}`);

  // Als Kunde → 403
  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: 'x', sprache: 'de', basis_version: 0 }, { Cookie: ckKunde, Origin: BASE });
  pruefe('K3 als Kunde → 403', r.status === 403, `${r.status}`);

  // Admin ohne Step-up: neue Login-Session (kein Step-up darin)
  const loginFresh = await fetch(`http://127.0.0.1:${port}/api/anmelden`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email: 'admin@recht.local', passwort: PASS }),
  });
  const ckFresh = loginFresh.headers.get('set-cookie')?.split(';')[0] ?? '';
  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: 'x', sprache: 'de', basis_version: 0 }, { Cookie: ckFresh, Origin: BASE });
  pruefe('K3 ohne Step-up → 401', r.status === 401, `${r.status}`);

  // ckAdmin nach ckFresh-Login wiederherstellen (auth.mjs löscht alle Admin-Sessions beim neuen Login)
  {
    const relogin = await fetch(`http://127.0.0.1:${port}/api/anmelden`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ email: 'admin@recht.local', passwort: PASS }),
    });
    ckAdmin = relogin.headers.get('set-cookie')?.split(';')[0] ?? '';
    await req('/api/admin/stepup', 'POST', { passwort: PASS });
  }

  // Fehlender Origin → 403
  {
    const r3 = await fetch(`http://127.0.0.1:${port}/api/admin/recht/impresszum`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ckAdmin },
      body: JSON.stringify({ inhalt: 'x', sprache: 'de', basis_version: 0 }),
    });
    pruefe('K3 fehlender Origin → 403', r3.status === 403, `${r3.status}`);
  }

  // Fremder Origin → 403
  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: 'x', sprache: 'de', basis_version: 0 }, { Origin: 'http://evil.example.com' });
  pruefe('K3 fremder Origin → 403', r.status === 403, `${r.status}`);

  // DB unveraendert
  const zeilenNachK3 = db.prepare('SELECT COUNT(*) AS n FROM recht_text').get().n;
  pruefe('K3 DB unveraendert', zeilenNachK3 === zeilenVorK3, `vorher: ${zeilenVorK3} nachher: ${zeilenNachK3}`);

  // ======== K4) Wiederherstellen =============================================
  // Aktuelle aktive Version = v2 (von K2)
  r = await req('/api/admin/recht/impresszum/wiederherstellen', 'POST', { version: v1 ?? 1, basis_version: v2 ?? 2 });
  pruefe('K4 Wiederherstellen → 201', r.status === 201, `${r.status} ${r.text.slice(0, 100)}`);
  const v3 = r.json?.()?.version;
  pruefe('K4 version 3', v3 === 3, `v3=${v3}`);

  // v3 inhalt bytegleich zu v1
  const v1Row = db.prepare('SELECT inhalt FROM recht_text WHERE seite=? AND version=?').get('impresszum', v1 ?? 1);
  const v3Row = db.prepare('SELECT inhalt FROM recht_text WHERE seite=? AND version=?').get('impresszum', v3 ?? 3);
  pruefe('K4 v3 inhalt = v1 inhalt', v1Row?.inhalt === v3Row?.inhalt, `v1: ${v1Row?.inhalt?.slice(0, 40)} v3: ${v3Row?.inhalt?.slice(0, 40)}`);

  const aktiv4 = db.prepare('SELECT version FROM recht_aktiv WHERE seite=?').get('impresszum');
  pruefe('K4 aktiv = v3', aktiv4?.version === (v3 ?? 3), `aktiv: ${aktiv4?.version}`);

  const gesamt4 = db.prepare('SELECT COUNT(*) AS n FROM recht_text WHERE seite=?').get('impresszum').n;
  pruefe('K4 Gesamtzahl = 3', gesamt4 === 3, `gesamt: ${gesamt4}`);

  // ======== K5) Beständigkeit (neuer Server) ==================================
  const app5 = erstelleServer({ stripe: attrappe, webhookSecret: 'whsec_test', base: BASE, nodeEnv: 'test', dbDatei: process.env.DB_DATEI });
  const srv5 = app5.listen(0, '127.0.0.1');
  alleServer.push(srv5);
  await warte(300);
  const port5 = srv5.address().port;

  const r5 = await fetch(`http://127.0.0.1:${port5}/jogi/impresszum`);
  const t5 = await r5.text();
  pruefe('K5 neuer Server: impresszum 200', r5.status === 200, `${r5.status}`);
  pruefe('K5 neuer Server: enthält <h2>', t5.includes('<h2>'), t5.slice(0, 300));

  const aktiv5 = db.prepare('SELECT version FROM recht_aktiv WHERE seite=?').get('impresszum');
  pruefe('K5 recht_aktiv unveraendert', aktiv5?.version === (v3 ?? 3), `aktiv: ${aktiv5?.version}`);
  const gesamt5 = db.prepare('SELECT COUNT(*) AS n FROM recht_text WHERE seite=?').get('impresszum').n;
  pruefe('K5 Verlauf unveraendert (3 Zeilen)', gesamt5 === 3, `gesamt: ${gesamt5}`);

  // ======== K6) Grenzen =======================================================
  const basisV = db.prepare('SELECT version FROM recht_aktiv WHERE seite=?').get('impresszum')?.version ?? v3 ?? 3;

  // 20000 'ő' = ok (NFC, 2 Bytes UTF-8 pro Zeichen, aber Zeichenanzahl = 20000)
  const inhalt20k = 'ő'.repeat(20000);
  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: inhalt20k, sprache: 'hu', basis_version: basisV });
  pruefe('K6 20000 ő → 201', r.status === 201, `${r.status}`);
  const v4 = r.json?.()?.version;

  // 20001 → 422 mit felder ['inhalt']
  const basisV4 = db.prepare('SELECT version FROM recht_aktiv WHERE seite=?').get('impresszum')?.version ?? v4;
  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: 'ő'.repeat(20001), sprache: 'hu', basis_version: basisV4 });
  pruefe('K6 20001 ő → 422', r.status === 422, `${r.status}`);
  pruefe('K6 20001: felder enthält inhalt', r.json?.()?.felder?.includes('inhalt'), r.text.slice(0, 100));

  // Leer → 422
  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: '', sprache: 'de', basis_version: basisV4 });
  pruefe('K6 leer → 422', r.status === 422, `${r.status}`);

  // Steuerzeichen (NUL) → 422
  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: 'Text\x00Ende', sprache: 'de', basis_version: basisV4 });
  pruefe('K6 Steuerzeichen NUL → 422', r.status === 422, `${r.status}`);

  // Bidi (RTL override U+202E) → 422
  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: 'Text‮Ende', sprache: 'de', basis_version: basisV4 });
  pruefe('K6 Bidi RTL → 422', r.status === 422, `${r.status}`);

  // sprache 'xx' → 422
  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: 'Test', sprache: 'xx', basis_version: basisV4 });
  pruefe('K6 sprache xx → 422', r.status === 422, `${r.status}`);

  // >100 kb Request → 413
  const grossBody = JSON.stringify({ inhalt: 'x'.repeat(102400), sprache: 'de', basis_version: 0 });
  {
    const r6 = await fetch(`http://127.0.0.1:${port}/api/admin/recht/impresszum`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ckAdmin, Origin: BASE },
      body: grossBody,
    });
    pruefe('K6 >100kb → 413', r6.status === 413, `${r6.status}`);
  }

  // ======== K7) Modi ===========================================================
  // URL-Modus: adatvedelem → recht_datenschutz = URL
  db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES('recht_datenschutz','https://beispiel.example/ds',datetime('now'))").run();

  {
    const r7 = await fetch(`http://127.0.0.1:${port}/jogi/adatvedelem`, {
      method: 'GET', headers: { Cookie: '', Origin: BASE }, redirect: 'manual',
    });
    pruefe('K7 URL-Modus: GET adatvedelem → 302', r7.status === 302, `${r7.status}`);
  }

  r = await req('/api/admin/recht/adatvedelem', 'POST', { inhalt: 'Test', sprache: 'de', basis_version: 0 });
  pruefe('K7 URL-Modus: POST → 409', r.status === 409, `${r.status}`);
  pruefe('K7 URL-Modus: Fehler recht_url_aktiv', r.json?.()?.fehler === 'recht_url_aktiv', r.text.slice(0, 100));

  const zeilenAdat7 = db.prepare('SELECT COUNT(*) AS n FROM recht_text WHERE seite=?').get('adatvedelem').n;
  pruefe('K7 URL-Modus: Tabelle unveraendert', zeilenAdat7 === 0, `zeilen: ${zeilenAdat7}`);

  // NULL-Modus: reszveteli-feltetelek → recht_teilnahmebedingungen nicht gesetzt
  r = await req('/api/admin/recht/reszveteli-feltetelek', 'POST', { inhalt: 'Test', sprache: 'de', basis_version: 0 });
  pruefe('K7 NULL-Modus: POST → 409', r.status === 409, `${r.status}`);
  pruefe('K7 NULL-Modus: Fehler recht_url_aktiv', r.json?.()?.fehler === 'recht_url_aktiv', r.text.slice(0, 100));

  const zeilenTb7 = db.prepare('SELECT COUNT(*) AS n FROM recht_text WHERE seite=?').get('reszveteli-feltetelek').n;
  pruefe('K7 NULL-Modus: Tabelle unveraendert', zeilenTb7 === 0, `zeilen: ${zeilenTb7}`);

  // ======== K8) Konflikt ======================================================
  const basis8 = db.prepare('SELECT version FROM recht_aktiv WHERE seite=?').get('impresszum')?.version ?? basisV4;

  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: 'Erster Gewinner', sprache: 'de', basis_version: basis8 });
  pruefe('K8 erster POST → 201', r.status === 201, `${r.status}`);
  const v5 = r.json?.()?.version;

  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: 'Zweiter Verlierer', sprache: 'de', basis_version: basis8 });
  pruefe('K8 zweiter POST gleiche basis → 409', r.status === 409, `${r.status}`);
  pruefe('K8 Fehler recht_konflikt', r.json?.()?.fehler === 'recht_konflikt', r.text.slice(0, 100));

  const gesamt8 = db.prepare('SELECT COUNT(*) AS n FROM recht_text WHERE seite=?').get('impresszum').n;
  pruefe('K8 nur eine neue Zeile (gesamt = 5)', gesamt8 === 5, `gesamt: ${gesamt8}`);

  // ======== K9) Atomar ========================================================
  const aktuelleVorK9 = db.prepare('SELECT version FROM recht_aktiv WHERE seite=?').get('impresszum')?.version;
  const zeilenVorK9 = db.prepare('SELECT COUNT(*) AS n FROM recht_text WHERE seite=?').get('impresszum').n;

  rechtTextModul.setzeTestFehler(true);
  r = await req('/api/admin/recht/impresszum', 'POST', { inhalt: 'Fehler-Test', sprache: 'de', basis_version: v5 ?? 5 });
  rechtTextModul.setzeTestFehler(false);
  pruefe('K9 bei Fehler → 500', r.status === 500, `${r.status}`);

  const zeilenNachK9 = db.prepare('SELECT COUNT(*) AS n FROM recht_text WHERE seite=?').get('impresszum').n;
  pruefe('K9 keine neue Zeile', zeilenNachK9 === zeilenVorK9, `vorher: ${zeilenVorK9} nachher: ${zeilenNachK9}`);

  const aktuelleNachK9 = db.prepare('SELECT version FROM recht_aktiv WHERE seite=?').get('impresszum')?.version;
  pruefe('K9 recht_aktiv unveraendert', aktuelleNachK9 === aktuelleVorK9, `vorher: ${aktuelleVorK9} nachher: ${aktuelleNachK9}`);

  r = await req('/jogi/impresszum', 'GET', undefined, { Cookie: '', Origin: BASE });
  pruefe('K9 vorherige Fassung noch öffentlich', r.status === 200, `${r.status}`);

  // ======== K10) Einwilligung =================================================
  // Kein aktiver ds/tb Text → 'reg-2026-11-03'
  pruefe('K10 ohne eigenen Text: reg-2026-11-03', rechtTextModul.leseEinwilligungVersion() === 'reg-2026-11-03', rechtTextModul.leseEinwilligungVersion());

  // adatvedelem auf 'erstellt' setzen + Text anlegen
  db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES('recht_datenschutz','erstellt',datetime('now'))").run();
  r = await req('/api/admin/recht/adatvedelem', 'POST', { inhalt: 'Adatvédelmi tájékoztató', sprache: 'hu', basis_version: 0 });
  pruefe('K10 adatvedelem POST → 201', r.status === 201, `${r.status}`);
  const dsV = r.json?.()?.version ?? 1;

  // reszveteli-feltetelek auf 'erstellt' setzen + Text anlegen
  db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES('recht_teilnahmebedingungen','erstellt',datetime('now'))").run();
  r = await req('/api/admin/recht/reszveteli-feltetelek', 'POST', { inhalt: 'Részvételi feltételek', sprache: 'hu', basis_version: 0 });
  pruefe('K10 reszveteli POST → 201', r.status === 201, `${r.status}`);
  const tbV = r.json?.()?.version ?? 1;

  const einwV10 = rechtTextModul.leseEinwilligungVersion();
  pruefe(`K10 mit ds+tb: reg-2026-11-03+ds${dsV}+tb${tbV}`, einwV10 === `reg-2026-11-03+ds${dsV}+tb${tbV}`, einwV10);

  // ======== K11) Versionsgrenze (60 Versionen) ================================
  // Für adatvedelem: schon 1 Version (dsV). Loop bis 60.
  let letzteV11 = dsV;
  for (let i = 2; i <= 60; i++) {
    const rr = await req('/api/admin/recht/adatvedelem', 'POST', { inhalt: `Version ${i}`, sprache: 'de', basis_version: letzteV11 });
    if (rr.status === 201) letzteV11 = rr.json?.()?.version ?? (letzteV11 + 1);
  }
  pruefe('K11 60 Versionen gespeichert', letzteV11 >= 60, `letzte: ${letzteV11}`);

  r = await req('/api/admin/recht');
  const adat11 = r.json?.()?.seiten?.find?.(e => e.seite === 'adatvedelem');
  pruefe('K11 Liste zeigt max 50', adat11?.versionen?.length === 50, `zeigt: ${adat11?.versionen?.length}`);

  const gesamt11 = db.prepare('SELECT COUNT(*) AS n FROM recht_text WHERE seite=?').get('adatvedelem').n;
  pruefe('K11 DB hat alle 60', gesamt11 === 60, `DB: ${gesamt11}`);

  // ======== K13) Gleichzeitigkeit =============================================
  const basis13 = db.prepare('SELECT version FROM recht_aktiv WHERE seite=?').get('impresszum')?.version ?? v5;

  const [r13a, r13b] = await Promise.all([
    req('/api/admin/recht/impresszum', 'POST', { inhalt: 'Parallel A', sprache: 'de', basis_version: basis13 }),
    req('/api/admin/recht/impresszum', 'POST', { inhalt: 'Parallel B', sprache: 'de', basis_version: basis13 }),
  ]);

  const st13 = [r13a.status, r13b.status].sort();
  pruefe('K13 genau ein Gewinner 201', st13.filter(s => s === 201).length === 1, JSON.stringify(st13));
  pruefe('K13 genau ein 409', st13.filter(s => s === 409).length === 1, JSON.stringify(st13));

  const gesamt13 = db.prepare('SELECT COUNT(*) AS n FROM recht_text WHERE seite=?').get('impresszum').n;
  pruefe('K13 nur eine neue Zeile (gesamt = 6)', gesamt13 === 6, `gesamt: ${gesamt13}`);

  // ======== K14) Modusschutz gilt für alle Schreiboperationen ================
  // adatvedelem auf URL setzen
  db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES('recht_datenschutz','https://url.example/ds',datetime('now'))").run();

  const aktiv14 = db.prepare('SELECT version FROM recht_aktiv WHERE seite=?').get('adatvedelem')?.version ?? letzteV11;
  r = await req('/api/admin/recht/adatvedelem/wiederherstellen', 'POST', { version: 1, basis_version: aktiv14 });
  pruefe('K14 Wiederherstellen bei URL-Modus → 409', r.status === 409, `${r.status}`);
  pruefe('K14 Fehler recht_url_aktiv', r.json?.()?.fehler === 'recht_url_aktiv', r.text.slice(0, 100));

  // ======== K15) Einwilligung nicht rückwirkend ==============================
  // ds und tb auf URL setzen → leseEinwilligungVersion() = 'reg-2026-11-03'
  db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES('recht_datenschutz','https://url.example',datetime('now'))").run();
  db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES('recht_teilnahmebedingungen','https://url.example',datetime('now'))").run();
  pruefe('K15 Setup: Einwilligung = reg-2026-11-03', rechtTextModul.leseEinwilligungVersion() === 'reg-2026-11-03', rechtTextModul.leseEinwilligungVersion());

  // Registrieren (kein Step-up nötig)
  r = await req('/api/registrieren', 'POST', { email: 'neu15@recht.local', passwort: 'Passwort99!', zustimmung: true }, { Cookie: '', Origin: BASE });
  pruefe('K15 Registrierung → 201', r.status === 201, `${r.status} ${r.text.slice(0, 100)}`);

  const zeile15 = db.prepare("SELECT einwilligung_version FROM benutzer WHERE email=?").get('neu15@recht.local');
  pruefe('K15 Einwilligung gespeichert (reg-2026-11-03)', zeile15?.einwilligung_version === 'reg-2026-11-03', zeile15?.einwilligung_version);

  // ds+tb aktivieren
  db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES('recht_datenschutz','erstellt',datetime('now'))").run();
  db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES('recht_teilnahmebedingungen','erstellt',datetime('now'))").run();

  // Bestehender Benutzer: unverändert
  const zeile15nach = db.prepare("SELECT einwilligung_version FROM benutzer WHERE email=?").get('neu15@recht.local');
  pruefe('K15 bestehender Benutzer unveraendert', zeile15nach?.einwilligung_version === 'reg-2026-11-03', zeile15nach?.einwilligung_version);

  // Neuer Benutzer erhält neue Version
  const einwV15neu = rechtTextModul.leseEinwilligungVersion();
  r = await req('/api/registrieren', 'POST', { email: 'neu15b@recht.local', passwort: 'Passwort99!', zustimmung: true }, { Cookie: '', Origin: BASE });
  pruefe('K15 neuer Benutzer → 201', r.status === 201, `${r.status}`);
  const zeile15b = db.prepare("SELECT einwilligung_version FROM benutzer WHERE email=?").get('neu15b@recht.local');
  pruefe('K15 neuer Benutzer erhält neue Version', zeile15b?.einwilligung_version === einwV15neu, `${zeile15b?.einwilligung_version} vs ${einwV15neu}`);

} catch (e) {
  console.error('UNERWARTETER FEHLER:', e);
  schlecht++;
} finally {
  for (const s of alleServer) s.close();
  try { rmSync(ordner, { recursive: true }); } catch {}
  console.log(`\nErgebnis: ${ok} OK, ${schlecht} FEHLER`);
  process.exit(schlecht > 0 ? 1 : 0);
}
