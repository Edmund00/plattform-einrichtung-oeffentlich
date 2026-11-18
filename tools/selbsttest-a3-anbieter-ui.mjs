// A3b: Admin-Oberfläche "Anbieterdaten" in "Meine Marke" — statische Code- und Textprüfungen + Server-Integration.
import './test-sprache.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ordner = mkdtempSync(join(tmpdir(), 'pe-a3-anbieter-ui-'));
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

  const anbieterTextSchluessel = [
    'marke_anbieter_bezeichnung',
    'anbieter_name',
    'anbieter_anschrift',
    'anbieter_telefon',
    'anbieter_email',
    'anbieter_adoszam',
    'anbieter_steuerhinweis',
    'anbieter_speichern_knopf',
    'anbieter_zuruecksetzen_knopf',
    'anbieter_gespeichert',
    'anbieter_quelle',
    'anbieter_quelle_marke',
    'anbieter_quelle_einstellungen',
    'anbieter_quelle_standard',
    'anbieter_quelle_umgebung',
    'anbieter_pflicht',
    'anbieter_pflichtfeld_hinweis',
  ];

  for (const k of anbieterTextSchluessel) {
    pruefe(`de.json: ${k} vorhanden und nicht leer`, typeof de[k] === 'string' && de[k].length > 1, de[k]);
    pruefe(`hu.json: ${k} vorhanden und nicht leer`, typeof hu[k] === 'string' && hu[k].length > 1, hu[k]);
    pruefe(`en.json: ${k} vorhanden und nicht leer`, typeof en[k] === 'string' && en[k].length > 1, en[k]);
  }

  // hu und en dürfen nicht gleich sein (außer bei neutralen Begriffen wie E-Mail, URL-Slugs)
  const neutraleWoerter = ['E-Mail', 'e-mail', 'Email', 'email'];
  const pureHuEn = (s) => neutraleWoerter.reduce((a, w) => a.replace(new RegExp(w, 'gi'), ''), s).trim();
  for (const k of anbieterTextSchluessel) {
    if (hu[k] && en[k]) {
      const huRein = pureHuEn(hu[k]);
      const enRein = pureHuEn(en[k]);
      if (huRein.length > 2 && enRein.length > 2) {
        pruefe(`hu.json ≠ en.json: ${k}`, hu[k] !== en[k], `hu=${hu[k]} / en=${en[k]}`);
      }
    }
  }

  // ======== B) admin.js — statische Codeprüfungen =================================
  const admin = lies('public/admin/admin.js');
  const markeStart = admin.indexOf('async function markeBereich()');
  pruefe('admin.js: markeBereich() gefunden', markeStart >= 0);
  const markeCode = markeStart >= 0 ? admin.slice(markeStart) : '';

  pruefe('admin.js: marke_anbieter_bezeichnung in markeBereich()', markeCode.includes("t('marke_anbieter_bezeichnung')"));

  // Sechs Felder — entweder direkt oder dynamisch (t('anbieter_' + feld) o.ä.)
  const feldNamen = ['name', 'anschrift', 'telefon', 'email', 'adoszam', 'steuerhinweis'];
  for (const f of feldNamen) {
    pruefe(`admin.js: Feld ${f} (anbieter_${f}) in markeBereich()`,
      markeCode.includes(`t('anbieter_${f}')`) || markeCode.includes(`anbieter_${f}`) || markeCode.includes(`'anbieter_' + `));
  }

  // Vorbelegung mit effektiven Werten: GET /api/admin/marke → d.anbieter.*
  pruefe('admin.js: d.anbieter (GET-Ergebnis) als Vorbelegung verwendet', markeCode.includes('d.anbieter') || markeCode.includes('.anbieter'));

  // Quelle anzeigen
  pruefe('admin.js: anbieter_quelle in markeBereich()', markeCode.includes("t('anbieter_quelle'") || markeCode.includes("'anbieter_quelle'"));
  pruefe('admin.js: anbieter_quelle_marke oder quelle_* Texte verwendet',
    markeCode.includes("'anbieter_quelle_marke'") || markeCode.includes("anbieter_quelle_") );

  // Speichern und Zurücksetzen
  pruefe('admin.js: apiMitStepup PUT anbieter', markeCode.includes("apiMitStepup('PUT', '/api/admin/marke/anbieter'"));
  pruefe('admin.js: apiMitStepup DELETE anbieter', markeCode.includes("apiMitStepup('DELETE', '/api/admin/marke/anbieter'"));
  pruefe('admin.js: anbieter_speichern_knopf verwendet', markeCode.includes("t('anbieter_speichern_knopf')"));
  pruefe('admin.js: anbieter_zuruecksetzen_knopf verwendet', markeCode.includes("t('anbieter_zuruecksetzen_knopf')"));
  pruefe('admin.js: anbieter_gespeichert nach Speichern', markeCode.includes("t('anbieter_gespeichert')") || markeCode.includes("'anbieter_gespeichert'"));

  // Fehler am Feld — drei Fehlercodes werden im UI behandelt
  pruefe('admin.js: anbieter_ungueltig Fehlercode behandelt',
    markeCode.includes("'anbieter_ungueltig'") || markeCode.includes('"anbieter_ungueltig"'));
  pruefe('admin.js: anbieter_email_ungueltig Fehlercode behandelt',
    markeCode.includes("'anbieter_email_ungueltig'") || markeCode.includes('"anbieter_email_ungueltig"'));
  pruefe('admin.js: anbieter_telefon_ungueltig Fehlercode behandelt',
    markeCode.includes("'anbieter_telefon_ungueltig'") || markeCode.includes('"anbieter_telefon_ungueltig"'));

  // A3d: Pflichtfelder-Behandlung
  pruefe('admin.js: anbieter_pflicht Fehlercode behandelt',
    markeCode.includes("'anbieter_pflicht'") || markeCode.includes('"anbieter_pflicht"'));
  pruefe('admin.js: anbieter_pflichtfeld_hinweis verwendet',
    markeCode.includes("'anbieter_pflichtfeld_hinweis'") || markeCode.includes('"anbieter_pflichtfeld_hinweis"'));
  pruefe('admin.js: Pflichtfelder mit * markiert',
    markeCode.includes("' *'") || markeCode.includes('" *"') || markeCode.includes("PFLICHT") || markeCode.includes("pflicht"));

  // Kein innerHTML mit Nutzerdaten
  pruefe('admin.js: kein innerHTML im markeBereich()', !markeCode.includes('innerHTML'));

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

  const PASS = 'AnbieterUITest99';
  const ph = await passwortHashen(PASS);
  db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)").run('anbieterui@example.com', ph, 'admin', new Date().toISOString());

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

  // /api/texte liefert alle neuen Schlüssel
  const texteR = await req('/api/texte');
  const texte = texteR.json();
  pruefe('/api/texte HTTP 200', texteR.status === 200, `status: ${texteR.status}`);
  for (const k of anbieterTextSchluessel) {
    pruefe(`/api/texte: ${k} vorhanden`, typeof texte[k] === 'string' && texte[k].length > 1, texte[k]);
  }

  // Ohne Login → 401/403 bei PUT
  let r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'Test GmbH' });
  pruefe('PUT anbieter ohne Login → 401/403', [401, 403].includes(r.status), `status: ${r.status}`);

  // Anmelden als Admin
  const login = await req('/api/anmelden', 'POST', { email: 'anbieterui@example.com', passwort: PASS });
  cookie = login.headers.get('set-cookie').split(';')[0];
  pruefe('Anmeldung erfolgreich', login.status === 200, `status: ${login.status}`);

  // Ohne Step-up → 401 stepup_noetig
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'Test GmbH' });
  pruefe('PUT anbieter ohne Step-up → 401', r.status === 401, `status: ${r.status}`);
  pruefe('PUT anbieter ohne Step-up → stepup_noetig', r.json().fehler === 'stepup_noetig', r.json().fehler);

  // Step-up
  r = await req('/api/admin/stepup', 'POST', { passwort: PASS });
  pruefe('Step-up erfolgreich', r.status === 200, `status: ${r.status}`);

  // Ungültige E-Mail → 422 anbieter_email_ungueltig (A3d: anschrift als Pflichtfeld ergänzt)
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'Test', anschrift: 'Musterstr. 1', email: 'kein-email' });
  pruefe('PUT ungültige E-Mail → 422', r.status === 422, `status: ${r.status}`);
  pruefe('PUT ungültige E-Mail → anbieter_email_ungueltig', r.json().fehler === 'anbieter_email_ungueltig', r.json().fehler);

  // Ungültige Telefonnummer → 422 anbieter_telefon_ungueltig (A3d: anschrift+email als Pflichtfelder ergänzt)
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'Test', anschrift: 'Musterstr. 1', email: 'x@x.test', telefon: 'keintelefon' });
  pruefe('PUT ungültige Telefon → 422', r.status === 422, `status: ${r.status}`);
  pruefe('PUT ungültige Telefon → anbieter_telefon_ungueltig', r.json().fehler === 'anbieter_telefon_ungueltig', r.json().fehler);

  // Gültige Daten speichern → 200
  const gueltig = { name: 'Test GmbH & Co.', anschrift: 'Musterstr. 1, 12345 Musterstadt', telefon: '+49 30 1234567', email: 'info@test.example.com', adoszam: 'DE123456789', steuerHinweis: 'Steuerbefreit nach §4.' };
  r = await req('/api/admin/marke/anbieter', 'PUT', gueltig);
  pruefe('PUT gültige Daten → 200', r.status === 200, `status: ${r.status}`);
  pruefe('PUT gültige Daten → ok:true', r.json().ok === true, r.text);

  // GET /api/admin/marke → anbieter-Objekt mit gespeicherten Werten
  r = await req('/api/admin/marke');
  pruefe('GET /api/admin/marke: anbieter vorhanden', r.json().anbieter !== null, JSON.stringify(r.json().anbieter));
  pruefe('GET /api/admin/marke: anbieter.name korrekt', r.json().anbieter?.name === gueltig.name, r.json().anbieter?.name);
  pruefe('GET /api/admin/marke: anbieter.email korrekt', r.json().anbieter?.email === gueltig.email, r.json().anbieter?.email);

  // DELETE → 200
  r = await req('/api/admin/marke/anbieter', 'DELETE');
  pruefe('DELETE anbieter → 200', r.status === 200, `status: ${r.status}`);

  // GET nach DELETE → anbieter null
  r = await req('/api/admin/marke');
  pruefe('GET /api/admin/marke: anbieter null nach Löschen', r.json().anbieter === null, JSON.stringify(r.json().anbieter));

  // F-183: GET /api/admin/marke liefert quelle im anbieter-Objekt
  r = await req('/api/admin/marke/anbieter', 'PUT', gueltig);
  pruefe('F-183 Neu-Speichern → 200', r.status === 200, `status: ${r.status}`);
  r = await req('/api/admin/marke');
  pruefe('F-183 GET /api/admin/marke: anbieter.quelle vorhanden', typeof r.json().anbieter?.quelle === 'string', JSON.stringify(r.json().anbieter));
  pruefe('F-183 GET /api/admin/marke: anbieter.quelle === marke', r.json().anbieter?.quelle === 'marke', r.json().anbieter?.quelle);

  // F-184: PUT anbieter_ungueltig → felder mit verursachendem Feld
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'X\nY', anschrift: 'Z', email: 'x@x.test' });
  pruefe('F-184 PUT anbieter_ungueltig: 422', r.status === 422, `status: ${r.status}`);
  pruefe('F-184 PUT anbieter_ungueltig: felder vorhanden', Array.isArray(r.json().felder), JSON.stringify(r.json()));
  pruefe('F-184 PUT anbieter_ungueltig: felder enthält name', r.json().felder?.includes('name'), JSON.stringify(r.json().felder));

  // F-187: anbieter_ungueltig bei Längenüberschreitung enthält felder:[name]
  r = await req('/api/admin/marke/anbieter', 'PUT', { name: 'x'.repeat(161), anschrift: 'Z', email: 'x@x.test' });
  pruefe('F-187 PUT name 161 Zeichen → 422', r.status === 422, `status: ${r.status}`);
  pruefe('F-187 PUT name 161 → anbieter_ungueltig', r.json().fehler === 'anbieter_ungueltig', r.json().fehler);
  pruefe('F-187 PUT name 161 → felder:[name]', Array.isArray(r.json().felder) && r.json().felder.includes('name'), JSON.stringify(r.json().felder));

  // Cache-Control: no-store auf PUT und DELETE
  r = await req('/api/admin/marke/anbieter', 'PUT', gueltig);
  pruefe('PUT anbieter: Cache-Control no-store', (r.headers.get('cache-control') || '').includes('no-store'), r.headers.get('cache-control'));

  // ======== A3d: Pflicht-Validierung über API =====================================
  // PUT {} → 422 anbieter_pflicht, 3 Felder
  r = await req('/api/admin/marke/anbieter', 'PUT', {});
  pruefe('A3d UI PUT {} → 422', r.status === 422, `status: ${r.status}`);
  pruefe('A3d UI PUT {} → anbieter_pflicht', r.json().fehler === 'anbieter_pflicht', r.json().fehler);
  pruefe('A3d UI PUT {} → felder 3', r.json().felder?.length === 3, JSON.stringify(r.json().felder));

  // PUT ohne name → felder enthält name
  r = await req('/api/admin/marke/anbieter', 'PUT', { anschrift: 'Z', email: 'x@x.test' });
  pruefe('A3d UI PUT ohne name → felder enthält name', r.json().felder?.includes('name'), JSON.stringify(r.json().felder));

  // /api/texte liefert anbieter_pflicht und anbieter_pflichtfeld_hinweis
  const texteR2 = await req('/api/texte');
  const texte2 = texteR2.json();
  pruefe('A3d /api/texte: anbieter_pflicht vorhanden', typeof texte2['anbieter_pflicht'] === 'string' && texte2['anbieter_pflicht'].length > 1, texte2['anbieter_pflicht']);
  pruefe('A3d /api/texte: anbieter_pflichtfeld_hinweis vorhanden', typeof texte2['anbieter_pflichtfeld_hinweis'] === 'string' && texte2['anbieter_pflichtfeld_hinweis'].length > 1, texte2['anbieter_pflichtfeld_hinweis']);

} finally {
  for (const s of alleServer) await new Promise((r) => s.close(r));
  try { rmSync(ordner, { recursive: true, force: true }); } catch {}
  console.log(`\nErgebnis: ${ok} OK, ${schlecht} FEHLER`);
  if (schlecht > 0) process.exit(1);
}
