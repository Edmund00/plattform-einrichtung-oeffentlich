// A3: Anbieterdaten — Datenschicht (anbieter.mjs), API, Verbraucher (recht-vorlagen, mail).
import './test-sprache.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const ordner = mkdtempSync(join(tmpdir(), 'pe-a3-'));
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
  // ======== A) Texte (alle drei Sprachen) =========================================
  const de = JSON.parse(lies('texte/de.json'));
  const hu = JSON.parse(lies('texte/hu.json'));
  const en = JSON.parse(lies('texte/en.json'));

  const schluessel = ['anbieter_ungueltig', 'anbieter_email_ungueltig', 'anbieter_telefon_ungueltig'];

  for (const k of schluessel) {
    pruefe(`de.json: ${k} vorhanden`, typeof de[k] === 'string' && de[k].length > 1, de[k]);
    pruefe(`hu.json: ${k} vorhanden`, typeof hu[k] === 'string' && hu[k].length > 1, hu[k]);
    pruefe(`en.json: ${k} vorhanden`, typeof en[k] === 'string' && en[k].length > 1, en[k]);
  }

  // ======== B) Statische Prüfungen ================================================

  // B1: anbieter.mjs – Exporte und Validierung
  const { leseAnbieter, setzeAnbieterDb, pruefeAnbieter, setzeAnbieterBasis } = await import('../anbieter.mjs');
  pruefe('anbieter.mjs: leseAnbieter exportiert', typeof leseAnbieter === 'function');
  pruefe('anbieter.mjs: setzeAnbieterDb exportiert', typeof setzeAnbieterDb === 'function');
  pruefe('anbieter.mjs: pruefeAnbieter exportiert', typeof pruefeAnbieter === 'function');
  pruefe('anbieter.mjs: setzeAnbieterBasis exportiert (F-180)', typeof setzeAnbieterBasis === 'function');

  // A3d: pruefeAnbieter gibt jetzt Objekte zurück (kein roher String mehr)
  const pflRet = pruefeAnbieter({});
  pruefe('pruefeAnbieter: leer → anbieter_pflicht (3 Felder)', pflRet?.fehler === 'anbieter_pflicht' && pflRet?.felder?.length === 3, JSON.stringify(pflRet));
  pruefe('pruefeAnbieter: {} → felder enthält name', pflRet?.felder?.includes('name'), JSON.stringify(pflRet?.felder));
  pruefe('pruefeAnbieter: {} → felder enthält anschrift', pflRet?.felder?.includes('anschrift'), JSON.stringify(pflRet?.felder));
  pruefe('pruefeAnbieter: {} → felder enthält email', pflRet?.felder?.includes('email'), JSON.stringify(pflRet?.felder));
  pruefe('pruefeAnbieter: gültige Daten → null', pruefeAnbieter({ name: 'Test GmbH', anschrift: 'Musterstr. 1', email: 'test@example.com', telefon: '+43 1 234 5678' }) === null);
  pruefe('pruefeAnbieter: ungültige E-Mail → anbieter_email_ungueltig', pruefeAnbieter({ name: 'X', anschrift: 'Z', email: 'kein-email' })?.fehler === 'anbieter_email_ungueltig');
  pruefe('pruefeAnbieter: ungültige Telefon → anbieter_telefon_ungueltig', pruefeAnbieter({ name: 'X', anschrift: 'Z', email: 'x@x.test', telefon: 'aaabbb###---!!!@@@' })?.fehler === 'anbieter_telefon_ungueltig');
  pruefe('pruefeAnbieter: Name zu lang → anbieter_ungueltig', pruefeAnbieter({ name: 'x'.repeat(161), anschrift: 'Z', email: 'x@x.test' })?.fehler === 'anbieter_ungueltig');
  // F-184: anbieter_ungueltig liefert felder mit verursachendem Feld
  const ungueltF184 = pruefeAnbieter({ name: 'X\nY', anschrift: 'Z', email: 'x@x.test' });
  pruefe('F-184 pruefeAnbieter: anbieter_ungueltig enthält felder', Array.isArray(ungueltF184?.felder), JSON.stringify(ungueltF184));
  pruefe('F-184 pruefeAnbieter: felder enthält name (LF im Namen)', ungueltF184?.felder?.includes('name'), JSON.stringify(ungueltF184?.felder));
  // F-185: C1-Zeichen (U+0080–U+009F) werden abgelehnt
  pruefe('F-185 pruefeAnbieter: U+0080 → anbieter_ungueltig', pruefeAnbieter({ name: 'XY', anschrift: 'Z', email: 'x@x.test' })?.fehler === 'anbieter_ungueltig');
  pruefe('F-185 pruefeAnbieter: U+009F → anbieter_ungueltig', pruefeAnbieter({ name: 'XY', anschrift: 'Z', email: 'x@x.test' })?.fehler === 'anbieter_ungueltig');
  // F-185: E-Mail > 254 Zeichen → anbieter_email_ungueltig
  pruefe('F-185 pruefeAnbieter: E-Mail > 254 → anbieter_email_ungueltig', pruefeAnbieter({ name: 'X', anschrift: 'Z', email: 'a@' + 'b'.repeat(252) + '.test' })?.fehler === 'anbieter_email_ungueltig');
  // Test gap (b): E-Mail-Grenzen exakt (253 / 254 / 255 Zeichen)
  pruefe('Gap(b) E-Mail 253 Zeichen → null', pruefeAnbieter({ name: 'X', anschrift: 'Z', email: 'a@' + 'b'.repeat(248) + '.de' }) === null);
  pruefe('Gap(b) E-Mail 254 Zeichen → null', pruefeAnbieter({ name: 'X', anschrift: 'Z', email: 'a@' + 'b'.repeat(249) + '.de' }) === null);
  pruefe('Gap(b) E-Mail 255 Zeichen → anbieter_email_ungueltig', pruefeAnbieter({ name: 'X', anschrift: 'Z', email: 'a@' + 'b'.repeat(250) + '.de' })?.fehler === 'anbieter_email_ungueltig');
  // Pflicht: ein Feld fehlt
  const pfl2 = pruefeAnbieter({ name: 'X', email: 'x@x.test' });
  pruefe('pruefeAnbieter: ohne anschrift → anbieter_pflicht', pfl2?.fehler === 'anbieter_pflicht', JSON.stringify(pfl2));
  pruefe('pruefeAnbieter: ohne anschrift → felder:[anschrift]', pfl2?.felder?.length === 1 && pfl2?.felder?.[0] === 'anschrift', JSON.stringify(pfl2?.felder));
  // Steuerzeichen
  pruefe('pruefeAnbieter: LF im Namen → anbieter_ungueltig', pruefeAnbieter({ name: 'X\nY', anschrift: 'Z', email: 'x@x.test' })?.fehler === 'anbieter_ungueltig');
  pruefe('pruefeAnbieter: LF in anschrift (2×) → null', pruefeAnbieter({ name: 'X', anschrift: 'Str.\nPLZ Ort', email: 'x@x.test' }) === null);
  pruefe('pruefeAnbieter: >4 LF in anschrift → anbieter_ungueltig', pruefeAnbieter({ name: 'X', anschrift: '1\n2\n3\n4\n5\n', email: 'x@x.test' })?.fehler === 'anbieter_ungueltig');
  // Unbekannte Felder / Nicht-Strings
  pruefe('pruefeAnbieter: unbekanntes Feld → anbieter_ungueltig', pruefeAnbieter({ name: 'X', anschrift: 'Z', email: 'x@x.test', extra: 'blah' })?.fehler === 'anbieter_ungueltig');
  pruefe('pruefeAnbieter: Objekt als Wert → anbieter_ungueltig', pruefeAnbieter({ name: {}, anschrift: 'Z', email: 'x@x.test' })?.fehler === 'anbieter_ungueltig');
  pruefe('pruefeAnbieter: Zahl als Wert → anbieter_ungueltig', pruefeAnbieter({ name: 'X', anschrift: 'Z', email: 42 })?.fehler === 'anbieter_ungueltig');
  // F-187: felder bei allen anbieter_ungueltig-Fällen
  pruefe('F-187 name 161 → felder:[name]', pruefeAnbieter({ name: 'x'.repeat(161), anschrift: 'Z', email: 'x@x.test' })?.felder?.[0] === 'name', JSON.stringify(pruefeAnbieter({ name: 'x'.repeat(161), anschrift: 'Z', email: 'x@x.test' })));
  pruefe('F-187 unbekanntes Feld extra → felder:[extra]', pruefeAnbieter({ name: 'X', anschrift: 'Z', email: 'x@x.test', extra: 'blah' })?.felder?.[0] === 'extra', JSON.stringify(pruefeAnbieter({ name: 'X', anschrift: 'Z', email: 'x@x.test', extra: 'blah' })));
  pruefe('F-187 Objekt als name → felder:[name]', pruefeAnbieter({ name: {}, anschrift: 'Z', email: 'x@x.test' })?.felder?.[0] === 'name', JSON.stringify(pruefeAnbieter({ name: {}, anschrift: 'Z', email: 'x@x.test' })));

  // B2: routes-marke.mjs – Statische Codeprüfungen
  const routesMarke = lies('routes-marke.mjs');
  pruefe("routes-marke.mjs: leseAnbieter aus anbieter.mjs importiert", routesMarke.includes('leseAnbieter') && routesMarke.includes("'./anbieter.mjs'"));
  pruefe('routes-marke.mjs: setzeAnbieterDb importiert', routesMarke.includes('setzeAnbieterDb'));
  pruefe("routes-marke.mjs: PUT '/api/admin/marke/anbieter' vorhanden", routesMarke.includes("'/api/admin/marke/anbieter'"));
  pruefe('routes-marke.mjs: anbieter-Feld in GET-Antwort', routesMarke.includes('leseAnbieter') && routesMarke.includes('anbieter:'));
  pruefe('routes-marke.mjs: pruefeAnbieter verwendet', routesMarke.includes('pruefeAnbieter'));

  // B3: recht-vorlagen.mjs – Statische Codeprüfungen
  const rechtVorlagen = lies('recht-vorlagen.mjs');
  pruefe("recht-vorlagen.mjs: importiert leseAnbieter aus anbieter.mjs", rechtVorlagen.includes("from './anbieter.mjs'") && rechtVorlagen.includes('leseAnbieter'));
  pruefe('recht-vorlagen.mjs: kein a.ANBIETER_NAME mehr (verwendet a.name)', !rechtVorlagen.includes('.ANBIETER_NAME'));

  // B4: mail.mjs – liest anbieter beim Senden aus leseAnbieter()
  const mailMjs = lies('mail.mjs');
  // A6: Kaufversand und Vorschau nutzen die gemeinsame Funktion mailAnbieter (anbieter.mjs), die leseAnbieter() beim Aufruf liest (nicht beim Laden).
  pruefe("mail.mjs: importiert mailAnbieter aus anbieter.mjs (liest die Anbieterdaten beim Senden)", mailMjs.includes("from './anbieter.mjs'") && mailMjs.includes('mailAnbieter(anbieter)'));
  pruefe("anbieter.mjs: mailAnbieter liest leseAnbieter() beim Aufruf", lies('anbieter.mjs').includes('export function mailAnbieter(fallback = {}, a = leseAnbieter())'));

  // ======== C) Server-Integration =================================================
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

  const PASS = 'AnbieterTest99';
  const ph = await passwortHashen(PASS);
  db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)").run('anbieter@example.com', ph, 'admin', new Date().toISOString());

  const app = erstelleServer({ stripe: attrappe, webhookSecret: 'whsec_test', base: 'http://localhost', nodeEnv: 'test', dbDatei: process.env.DB_DATEI });
  const server = app.listen(0, '127.0.0.1');
  alleServer.push(server);
  await warte(300);
  const port = server.address().port;

  let cookie = '';

  async function req(path, method = 'GET', data, headers = {}) {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const text = await r.text();
    return { status: r.status, headers: r.headers, text, json: () => JSON.parse(text) };
  }

  // /api/texte liefert alle Anbieter-Fehlerschlüssel
  let r = await req('/api/texte');
  pruefe('/api/texte HTTP 200', r.status === 200, `status: ${r.status}`);
  const texte = r.json();
  for (const k of schluessel) {
    pruefe(`/api/texte: ${k} vorhanden`, typeof texte[k] === 'string' && texte[k].length > 1, texte[k]);
  }

  // Ohne Login → 401/403
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'Test GmbH' });
  pruefe('/api/admin/marke/anbieter ohne Login → 401/403', [401, 403].includes(r.status), `status: ${r.status}`);

  // Anmelden
  const login = await req('/api/anmelden', 'POST', { email: 'anbieter@example.com', passwort: PASS });
  cookie = login.headers.get('set-cookie').split(';')[0];
  pruefe('Anmeldung erfolgreich', login.status === 200, `status: ${login.status}`);

  // GET /api/admin/marke enthält anbieter-Feld
  r = await req('/api/admin/marke');
  pruefe('GET /api/admin/marke: HTTP 200', r.status === 200, `status: ${r.status}`);
  pruefe('GET /api/admin/marke: anbieter-Feld vorhanden', 'anbieter' in r.json(), JSON.stringify(Object.keys(r.json())));

  // PUT ohne Step-up → 401 stepup_noetig
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'Test GmbH', email: 'test@example.com' });
  pruefe('PUT ohne Step-up → 401', r.status === 401, `status: ${r.status}`);
  pruefe('PUT ohne Step-up → stepup_noetig', r.json().fehler === 'stepup_noetig', r.json().fehler);

  // Step-up
  r = await req('/api/admin/stepup', 'POST', { passwort: PASS });
  pruefe('Step-up erfolgreich', r.status === 200, `status: ${r.status}`);

  // PUT mit ungültiger E-Mail → 422 (A3d: anschrift als Pflichtfeld ergänzt)
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'Test GmbH', anschrift: 'Musterstr. 1', email: 'kein-email' });
  pruefe('PUT ungültige E-Mail → 422', r.status === 422, `status: ${r.status}`);
  pruefe('PUT ungültige E-Mail → anbieter_email_ungueltig', r.json().fehler === 'anbieter_email_ungueltig', r.json().fehler);

  // PUT mit gültigen Daten → 200
  const guteDaten = { name: 'Test GmbH', anschrift: 'Testgasse 1, 1010 Wien', email: 'info@test.at', telefon: '+43 1 234 5678', adoszam: 'ATU12345678' };
  r = await req('/api/admin/marke/anbieter', 'PUT', guteDaten);
  pruefe('PUT gültige Daten → 200', r.status === 200, `status: ${r.status}`);

  // GET nach PUT: anbieter enthält gespeicherte Daten
  r = await req('/api/admin/marke');
  const markeNach = r.json();
  pruefe('GET nach PUT: anbieter.name korrekt', markeNach.anbieter?.name === 'Test GmbH', JSON.stringify(markeNach.anbieter));
  pruefe('GET nach PUT: anbieter.email korrekt', markeNach.anbieter?.email === 'info@test.at', markeNach.anbieter?.email);

  // F-180: GET /api/anbieter gibt den zuletzt gespeicherten Namen zurück (nicht den gefrorenen ENV)
  r = await req('/api/anbieter');
  pruefe('F-180 GET /api/anbieter: HTTP 200', r.status === 200, `status: ${r.status}`);
  pruefe('F-180 GET /api/anbieter: ANBIETER_NAME korrekt', r.json().anbieter?.ANBIETER_NAME === 'Test GmbH', JSON.stringify(r.json().anbieter));

  // Impressum-Seite zeigt gespeicherten Namen
  db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES('recht_impressum','erstellt',datetime('now'))").run();
  r = await req('/jogi/impresszum');
  pruefe('/jogi/impresszum: enthält gespeicherten Namen', r.text.includes('Test GmbH'), `Anfang: ${r.text.slice(0, 200)}`);

  // DELETE → 200 (Step-up noch gültig)
  r = await req('/api/admin/marke/anbieter', 'DELETE');
  pruefe('DELETE /api/admin/marke/anbieter → 200', r.status === 200, `status: ${r.status}`);

  // GET nach DELETE: kein gespeicherter Anbieter in DB
  r = await req('/api/admin/marke');
  pruefe('GET nach DELETE: anbieter = null', r.json().anbieter === null, JSON.stringify(r.json().anbieter));

  // ======== A3d: Neue Server-Validierung ==========================================
  // PUT {} → 422 anbieter_pflicht, 3 fehlende Pflichtfelder
  r = await req('/api/admin/marke/anbieter', 'PUT', {});
  pruefe('A3d PUT {} → 422', r.status === 422, `status: ${r.status}`);
  pruefe('A3d PUT {} → anbieter_pflicht', r.json().fehler === 'anbieter_pflicht', r.json().fehler);
  pruefe('A3d PUT {} → felder 3', r.json().felder?.length === 3, JSON.stringify(r.json().felder));

  // PUT ohne anschrift → felder:[anschrift]
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'X', email: 'x@x.test' });
  pruefe('A3d PUT ohne anschrift → 422', r.status === 422, `status: ${r.status}`);
  pruefe('A3d PUT ohne anschrift → felder:[anschrift]', r.json().felder?.includes('anschrift') && r.json().felder?.length === 1, JSON.stringify(r.json().felder));

  // PUT mit LF im Namen → 422 anbieter_ungueltig
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'X\nY', anschrift: 'Z', email: 'x@x.test' });
  pruefe('A3d PUT LF im Namen → 422', r.status === 422, `status: ${r.status}`);
  pruefe('A3d PUT LF im Namen → anbieter_ungueltig', r.json().fehler === 'anbieter_ungueltig', r.json().fehler);

  // PUT unbekanntes Feld → 422 anbieter_ungueltig
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'X', anschrift: 'Z', email: 'x@x.test', extra: 'baz' });
  pruefe('A3d PUT unbekanntes Feld → 422', r.status === 422, `status: ${r.status}`);
  pruefe('A3d PUT unbekanntes Feld → anbieter_ungueltig', r.json().fehler === 'anbieter_ungueltig', r.json().fehler);

  // PUT Objekt als Wert → 422 anbieter_ungueltig
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: {}, anschrift: 'Z', email: 'x@x.test' });
  pruefe('A3d PUT Objekt als Wert → 422', r.status === 422, `status: ${r.status}`);
  pruefe('A3d PUT Objekt als Wert → anbieter_ungueltig', r.json().fehler === 'anbieter_ungueltig', r.json().fehler);

  // leseAnbieter: marke-Zeile mit leerem Namen → Fallback auf einstellungen
  db.prepare("INSERT OR IGNORE INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES(?,?,datetime('now'))").run('ANBIETER_NAME', 'FallbackFirma');
  db.prepare("INSERT OR REPLACE INTO marke(schluessel,wert,aktualisiert_am) VALUES(?,?,datetime('now'))").run('anbieter', JSON.stringify({ name: '', anschrift: 'X', email: 'x@x.test' }));
  setzeAnbieterDb(db); // Cache leeren
  const anb = leseAnbieter();
  pruefe('A3d leseAnbieter: leer in marke → Fallback einstellungen', anb?.quelle === 'einstellungen', JSON.stringify({ quelle: anb?.quelle, name: anb?.name }));
  pruefe('A3d leseAnbieter: Fallback-Name korrekt', anb?.name === 'FallbackFirma', anb?.name);
  // Testdaten aufräumen
  db.prepare("DELETE FROM marke WHERE schluessel='anbieter'").run();
  db.prepare("DELETE FROM einstellungen WHERE schluessel='ANBIETER_NAME'").run();
  setzeAnbieterDb(db);

  // ======== A3e: Escaping, Unicode, Maximalwerte ==========================================

  // Step-up erneuern (vorheriger könnte abgelaufen sein)
  r = await req('/api/admin/stepup', 'POST', { passwort: PASS });
  pruefe('A3e Step-up', r.status === 200, `stepup: ${r.status}`);

  // ---- XSS-Schutz: esc() muss in allen drei Rechtsseiten wirken ----
  r = await req('/api/admin/marke/anbieter', 'PUT', {
    name: '<script>alert(1)</script>Boese',
    anschrift: '"><img src=x onerror=alert(1)>',
    email: 'xss@example.com',
  });
  pruefe('A3e PUT XSS-Payload → 200', r.status === 200, `status: ${r.status}`);

  for (const k of ['recht_impressum', 'recht_datenschutz', 'recht_teilnahmebedingungen']) {
    db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES(?,?,datetime('now'))").run(k, 'erstellt');
  }
  for (const [seite, label] of [['impresszum', 'Impressum'], ['adatvedelem', 'Datenschutz'], ['reszveteli-feltetelek', 'Teilnahme']]) {
    r = await req(`/jogi/${seite}`);
    pruefe(`A3e ${label}: &lt;script&gt; vorhanden`, r.text.includes('&lt;script&gt;'), r.text.slice(0, 200));
    pruefe(`A3e ${label}: kein rohes <script>alert`, !r.text.includes('<script>alert'), r.text.slice(0, 200));
    pruefe(`A3e ${label}: &lt;img vorhanden`, r.text.includes('&lt;img'), r.text.slice(0, 200));
  }

  // ---- Unicode verbotene Zeichen (unit) ----
  const valide = { name: 'Firma', anschrift: 'Str. 1', email: 'x@x.test' };
  for (const [label, cp] of [
    ['U+200B ZWS', 0x200B], ['U+200F RLM', 0x200F],
    ['U+202A LRE', 0x202A], ['U+202E RLO', 0x202E],
    ['U+2066 LRI', 0x2066], ['U+2069 PDI', 0x2069],
    ['U+FEFF BOM', 0xFEFF], ['U+00AD SHY', 0x00AD],
    ['U+2028 LS',  0x2028], ['U+2029 PS',  0x2029],
  ]) {
    const zeichen = String.fromCodePoint(cp);
    const erg = pruefeAnbieter({ ...valide, name: 'Test' + zeichen + 'X' });
    pruefe(`pruefeAnbieter: ${label} im Namen → anbieter_ungueltig`, erg?.fehler === 'anbieter_ungueltig', JSON.stringify(erg));
  }

  // Server: Unicode verboten → 422
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'Test' + String.fromCodePoint(0x200B) + 'X', anschrift: 'Str. 1', email: 'x@x.test' });
  pruefe('A3e PUT U+200B im Namen → 422', r.status === 422, `status: ${r.status}`);
  pruefe('A3e PUT U+200B → anbieter_ungueltig', r.json().fehler === 'anbieter_ungueltig', r.json().fehler);

  // ---- NFC-Normalisierung: u + combining diaeresis (U+0308) → ü ----
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'über GmbH', anschrift: 'Str. 1', email: 'x@x.test' });
  pruefe('A3e PUT kombiniert → 200', r.status === 200, `status: ${r.status}`);
  r = await req('/api/admin/marke');
  const nfcName = r.json().anbieter?.name ?? '';
  pruefe('A3e NFC: u+combining → ü gespeichert', nfcName === 'über GmbH', `gespeichert: ${JSON.stringify(nfcName)}`);

  // ---- Maximalwerte mit Umlauts ----
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'ä'.repeat(160), anschrift: 'Str. 1', email: 'x@x.test' });
  pruefe('A3e name 160×ä → 200', r.status === 200, `status: ${r.status}`);
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'ä'.repeat(161), anschrift: 'Str. 1', email: 'x@x.test' });
  pruefe('A3e name 161×ä → 422', r.status === 422, `status: ${r.status}`);
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'Firma', anschrift: 'x'.repeat(500), email: 'x@x.test' });
  pruefe('A3e anschrift 500×x → 200', r.status === 200, `status: ${r.status}`);
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'Firma', anschrift: 'x'.repeat(501), email: 'x@x.test' });
  pruefe('A3e anschrift 501×x → 422', r.status === 422, `status: ${r.status}`);

  // F-189: leerzeichen-only ANBIETER_NAME in anbieterBasis fällt durch zu einstellungen
  {
    const { setzeAnbieterBasis: sab189, leseAnbieter: la189, setzeAnbieterDb: sadb189 } = await import('../anbieter.mjs');
    const freshDb = new DatabaseSync(':memory:');
    freshDb.exec('CREATE TABLE marke (schluessel TEXT PRIMARY KEY, wert TEXT)');
    freshDb.exec('CREATE TABLE einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT)');
    freshDb.exec("INSERT INTO einstellungen VALUES ('ANBIETER_NAME','Einst-F189-GmbH')");
    sadb189(freshDb);
    sab189({ ANBIETER_NAME: '   ' }); // leerzeichen-only → soll ignoriert werden
    const a189 = la189();
    pruefe('F-189 ANBIETER_NAME nur Leerzeichen → einstellungen gewinnt', a189.quelle === 'einstellungen', `quelle=${a189.quelle}, name=${a189.name}`);
    pruefe('F-189 name korrekt aus einstellungen', a189.name === 'Einst-F189-GmbH', `name=${a189.name}`);
    sab189(null);
    const { db: db189 } = await import('../db.mjs');
    sadb189(db189);
  }

  // Test gap (a): mailDienst Marke-Name im Mail-Text (nicht eingefrorener anbieter-Parameter)
  {
    const { mailDienst: md, kaufVormerken: kv } = await import('../mail.mjs');
    const { db: dbMail } = await import('../db.mjs');
    await req('/api/admin/marke/anbieter', 'PUT', { name: 'Marke-A3g GmbH', anschrift: 'Markengasse 1', email: 'marke@a3g.test' });
    const mailSendungen = [];
    const dienst = md({ mailer: async m => { mailSendungen.push(m); return true; }, base: 'http://localhost:4400' });
    const mailBId = dbMail.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,?,?,?)").run('kauf-gap-a@test.example', 'x', 'kunde', new Date().toISOString(), Date.now()).lastInsertRowid;
    const mailKId = dbMail.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,?,?,?,?,?)").run('Gap-a Kurs', '', 1000, 'huf', 'veroeffentlicht', new Date().toISOString(), new Date().toISOString()).lastInsertRowid;
    const mailBestId = dbMail.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES(?,?,?,?,'huf','bezahlt','einmal',?,?)").run('cs_gap_a', mailBId, mailKId, 1000, new Date().toISOString(), new Date().toISOString()).lastInsertRowid;
    kv(mailBId, mailBestId, 'kauf');
    await dienst.ausgangSenden();
    const mailText = mailSendungen[0]?.text ?? '';
    pruefe('Gap(a) mailDienst: Marke-Name im Mail-Text', mailText.includes('Marke-A3g GmbH'), `len=${mailText.length} text: ${mailText.slice(0, 200)}`);
  }

  // ======== F-193(a): einstellungen-Name nur Leerzeichen + leere ENV → quelle='standard' ======
  {
    const freshDb193a = new DatabaseSync(':memory:');
    freshDb193a.exec("CREATE TABLE marke (schluessel TEXT PRIMARY KEY, wert TEXT)");
    freshDb193a.exec("CREATE TABLE einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT)");
    freshDb193a.exec("INSERT INTO einstellungen VALUES ('ANBIETER_NAME','   ')");
    setzeAnbieterDb(freshDb193a);
    setzeAnbieterBasis(null);
    const a193a = leseAnbieter();
    pruefe('F-193(a) nur-Leerzeichen-Name in einstellungen → quelle=standard', a193a.quelle === 'standard', `quelle=${a193a.quelle}, name=${JSON.stringify(a193a.name)}`);
    pruefe('F-193(a) name leer', a193a.name === '', `name=${JSON.stringify(a193a.name)}`);
    setzeAnbieterDb(db);
  }

  // ======== F-193(b): pruefeAnbieter-Zweige mit felder-Angabe ============================
  {
    const valide193 = { name: 'X', anschrift: 'Z', email: 'x@x.test' };
    pruefe('F-193(b) anschrift 501 → felder:[anschrift]', pruefeAnbieter({ ...valide193, anschrift: 'x'.repeat(501) })?.felder?.[0] === 'anschrift', JSON.stringify(pruefeAnbieter({ ...valide193, anschrift: 'x'.repeat(501) })));
    pruefe('F-193(b) adoszam 501 → felder:[adoszam]', pruefeAnbieter({ ...valide193, adoszam: 'x'.repeat(501) })?.felder?.[0] === 'adoszam', JSON.stringify(pruefeAnbieter({ ...valide193, adoszam: 'x'.repeat(501) })));
    pruefe('F-193(b) steuerHinweis 501 → felder:[steuerHinweis]', pruefeAnbieter({ ...valide193, steuerHinweis: 'x'.repeat(501) })?.felder?.[0] === 'steuerHinweis', JSON.stringify(pruefeAnbieter({ ...valide193, steuerHinweis: 'x'.repeat(501) })));
    pruefe('F-193(b) Array → felder:[]', pruefeAnbieter([])?.fehler === 'anbieter_ungueltig' && JSON.stringify(pruefeAnbieter([])?.felder) === '[]', JSON.stringify(pruefeAnbieter([])));
    pruefe('F-193(b) null → felder:[]', pruefeAnbieter(null)?.fehler === 'anbieter_ungueltig' && JSON.stringify(pruefeAnbieter(null)?.felder) === '[]', JSON.stringify(pruefeAnbieter(null)));
    pruefe('F-193(b) Zahl → felder:[]', pruefeAnbieter(42)?.fehler === 'anbieter_ungueltig' && JSON.stringify(pruefeAnbieter(42)?.felder) === '[]', JSON.stringify(pruefeAnbieter(42)));
  }

  // ======== F-198: ENV-Stufe per HTTP testen =============================================
  {
    // Marke-Daten aus vorherigen Tests entfernen; Cache leeren
    db.prepare("DELETE FROM marke WHERE schluessel='anbieter'").run();
    setzeAnbieterDb(db);

    // Neuer Server MIT anbieter-Parameter (testet setzeAnbieterBasis(anbieter) in app.mjs)
    const envAnbieter198 = { ANBIETER_NAME: 'Env GmbH', ANBIETER_ANSCHRIFT: 'Env-Gasse 1', ANBIETER_EMAIL: 'env@example.com' };
    const app198 = erstelleServer({ stripe: attrappe, webhookSecret: 'whsec_test', base: 'http://localhost', nodeEnv: 'test', dbDatei: process.env.DB_DATEI, anbieter: envAnbieter198 });
    const srv198 = app198.listen(0, '127.0.0.1');
    alleServer.push(srv198);
    await warte(300);
    const p198 = srv198.address().port;

    let ck198 = '';
    async function q198(pfad, method = 'GET', daten) {
      const r = await fetch(`http://127.0.0.1:${p198}${pfad}`, {
        method, redirect: 'manual',
        headers: { 'Content-Type': 'application/json', Cookie: ck198 },
        body: daten === undefined ? undefined : JSON.stringify(daten),
      });
      const text = await r.text();
      return { status: r.status, headers: r.headers, text, json: () => JSON.parse(text) };
    }

    // Ohne marke-Eintrag: /api/anbieter → Env GmbH
    let r198 = await q198('/api/anbieter');
    pruefe('F-198 GET /api/anbieter ohne marke → Env GmbH', r198.json().anbieter?.ANBIETER_NAME === 'Env GmbH', JSON.stringify(r198.json().anbieter));

    // Admin einrichten und anmelden
    const ph198 = await passwortHashen('Env198-Pass!1');
    db.prepare("INSERT OR IGNORE INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)").run('env198@test.local', ph198, 'admin', new Date().toISOString());
    const login198 = await q198('/api/anmelden', 'POST', { email: 'env198@test.local', passwort: 'Env198-Pass!1' });
    ck198 = (login198.headers.get('set-cookie') ?? '').split(';')[0];
    pruefe('F-198 Admin-Anmeldung', login198.status === 200, `status: ${login198.status}`);

    // GET /api/admin/marke: quelle='umgebung'
    r198 = await q198('/api/admin/marke');
    pruefe('F-198 GET /api/admin/marke: quelle=umgebung', r198.json().anbieter?.quelle === 'umgebung', JSON.stringify(r198.json().anbieter));

    // Step-up + PUT → Admin-Name wird gespeichert, quelle wechselt auf 'marke'
    await q198('/api/admin/stepup', 'POST', { passwort: 'Env198-Pass!1' });
    r198 = await q198('/api/admin/marke/anbieter', 'PUT', { name: 'Admin-Firma GmbH', anschrift: 'Admin-Str. 1', email: 'admin@test.local' });
    pruefe('F-198 PUT marke/anbieter → 200', r198.status === 200, `status: ${r198.status}`);
    r198 = await q198('/api/anbieter');
    pruefe('F-198 GET /api/anbieter nach PUT → Admin-Firma GmbH', r198.json().anbieter?.ANBIETER_NAME === 'Admin-Firma GmbH', JSON.stringify(r198.json().anbieter));
    r198 = await q198('/api/admin/marke');
    pruefe('F-198 GET /api/admin/marke nach PUT: quelle=marke', r198.json().anbieter?.quelle === 'marke', JSON.stringify(r198.json().anbieter));

    // DELETE → zurück zu Env GmbH und quelle=umgebung
    r198 = await q198('/api/admin/marke/anbieter', 'DELETE');
    pruefe('F-198 DELETE marke/anbieter → 200', r198.status === 200, `status: ${r198.status}`);
    r198 = await q198('/api/anbieter');
    pruefe('F-198 GET /api/anbieter nach DELETE → Env GmbH', r198.json().anbieter?.ANBIETER_NAME === 'Env GmbH', JSON.stringify(r198.json().anbieter));
    r198 = await q198('/api/admin/marke');
    pruefe('F-198 GET /api/admin/marke nach DELETE: quelle=umgebung', r198.json().anbieter?.quelle === 'umgebung', JSON.stringify(r198.json().anbieter));

    // Impressum zeigt Env GmbH (recht_impressum='erstellt' bereits in DB)
    r198 = await q198('/jogi/impresszum');
    pruefe('F-198 impresszum: enthält Env GmbH', r198.text.includes('Env GmbH'), `Anfang: ${r198.text.slice(0, 200)}`);

    // Reset: anbieterBasis zurücksetzen
    setzeAnbieterBasis(null);
    db.prepare("DELETE FROM benutzer WHERE email='env198@test.local'").run();
  }

} finally {
  for (const s of alleServer) await new Promise((r) => s.close(r));
  try { rmSync(ordner, { recursive: true, force: true }); } catch {}
  console.log(`\nErgebnis: ${ok} OK, ${schlecht} FEHLER`);
  if (schlecht > 0) process.exit(1);
}
