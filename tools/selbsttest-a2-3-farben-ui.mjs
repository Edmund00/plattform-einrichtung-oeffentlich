// A2-3: Admin-Oberfläche "Farben" in "Meine Marke" — statische Code- und Textprüfungen + Server-Integration.
import './test-sprache.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ordner = mkdtempSync(join(tmpdir(), 'pe-a2-3-'));
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

  const farbenTextSchluessel = [
    'marke_farben_bezeichnung',
    'farben_haupt', 'farben_dunkel', 'farben_hell',
    'farben_pruefen_knopf', 'farben_speichern_knopf', 'farben_zuruecksetzen_knopf',
    'farben_vorschau_titel',
    'farben_paar_kopf', 'farben_kontrast_kopf', 'farben_soll_kopf', 'farben_status_kopf',
    'farben_status_ok', 'farben_status_schlecht',
    'farben_gespeichert_neuladen',
  ];

  // Die 18 Kontrast-Paare aus farben.mjs (paar-Name → farben_paar_<id>)
  const paarIds = [
    'ink_ivory', 'knopfText_gold',
    'textOnDark_night', 'footerText_night', 'footerText_black', 'goldD_ivory',
    'goldD_white', 'white_goldD', 'focus_ivory',
    'focus_white', 'focus_night',
    'knopfText_goldM', 'knopfText_gradMitte', 'textOnDark_black',
    'textSecond_ivory', 'textSecond_white', 'goldL_night', 'goldL_black',
  ];
  const paarSchluessel = paarIds.map(id => `farben_paar_${id}`);

  const alleSchluessel = [...farbenTextSchluessel, ...paarSchluessel];

  for (const k of alleSchluessel) {
    pruefe(`de.json: ${k} vorhanden und nicht leer`, typeof de[k] === 'string' && de[k].length > 1, de[k]);
    pruefe(`hu.json: ${k} vorhanden und nicht leer`, typeof hu[k] === 'string' && hu[k].length > 1, hu[k]);
    pruefe(`en.json: ${k} vorhanden und nicht leer`, typeof en[k] === 'string' && en[k].length > 1, en[k]);
  }

  // ======== B) admin.js — statische Codeprüfungen =================================
  const admin = lies('public/admin/admin.js');
  const markeStart = admin.indexOf('async function markeBereich()');

  pruefe('admin.js: marke_farben_bezeichnung verwendet', admin.slice(markeStart).includes("t('marke_farben_bezeichnung')"));
  const farbenCode = admin.slice(markeStart);
  pruefe('admin.js: farben_haupt oder dynamisch t(farben_+name) verwendet',
    farbenCode.includes("t('farben_haupt')") || farbenCode.includes("t('farben_' + name)") || farbenCode.includes('farben_haupt'));
  pruefe('admin.js: farben_dunkel oder dynamisch verwendet',
    farbenCode.includes("t('farben_dunkel')") || farbenCode.includes("t('farben_' + name)") || farbenCode.includes('farben_dunkel'));
  pruefe('admin.js: farben_hell oder dynamisch verwendet',
    farbenCode.includes("t('farben_hell')") || farbenCode.includes("t('farben_' + name)") || farbenCode.includes('farben_hell'));
  // Kann 1× (via map) oder 3× (explizit) sein – beides akzeptabel
  pruefe('admin.js: color-Input(s) vorhanden (type color)', (farbenCode.match(/type:\s*'color'/g) || []).length >= 1);
  pruefe('admin.js: farb-hex Textfeld vorhanden', farbenCode.includes("'farb-hex") || farbenCode.includes('"farb-hex'));
  pruefe('admin.js: Prüfen-Knopf (farben_pruefen_knopf)', admin.slice(markeStart).includes("t('farben_pruefen_knopf')"));
  pruefe('admin.js: Speichern-Knopf (farben_speichern_knopf)', admin.slice(markeStart).includes("t('farben_speichern_knopf')"));
  pruefe('admin.js: Zurücksetzen-Knopf (farben_zuruecksetzen_knopf)', admin.slice(markeStart).includes("t('farben_zuruecksetzen_knopf')"));
  pruefe('admin.js: Debounce 400ms für auto-prüfen', admin.slice(markeStart).includes('400'));
  pruefe('admin.js: POST farben-pruefen', admin.slice(markeStart).includes("'/api/admin/marke/farben-pruefen'"));
  pruefe('admin.js: apiMitStepup PUT farben', admin.slice(markeStart).includes("apiMitStepup('PUT', '/api/admin/marke/farben'"));
  pruefe('admin.js: apiMitStepup DELETE farben', admin.slice(markeStart).includes("apiMitStepup('DELETE', '/api/admin/marke/farben'"));
  pruefe('admin.js: Vorschau-Tabelle (farben_vorschau_titel)', admin.slice(markeStart).includes("t('farben_vorschau_titel')"));
  pruefe('admin.js: location.reload() nach Speichern/Zurücksetzen', (admin.slice(markeStart).match(/location\.reload\(\)/g) || []).length >= 2);
  pruefe('admin.js: Schlechte Paare zuerst (sort)', admin.slice(markeStart).includes('.sort('));
  pruefe('admin.js: Verhältnis-Format "x:1" in Vorschau', admin.slice(markeStart).includes(':1'));
  pruefe('admin.js: 422 farbe_ungueltig behandelt', admin.slice(markeStart).includes("'farbe_ungueltig'") || admin.slice(markeStart).includes('"farbe_ungueltig"'));
  pruefe('admin.js: 422 farben_kontrast behandelt', admin.slice(markeStart).includes("'farben_kontrast'") || admin.slice(markeStart).includes('"farben_kontrast"'));
  pruefe('admin.js: kein innerHTML im Farben-Bereich', !admin.slice(markeStart).includes('innerHTML'));
  // F-170: Standardwerte wenn keine gespeicherten Farben vorhanden
  pruefe('admin.js: Standardwert #d4a843 (haupt) definiert', farbenCode.includes('#d4a843'));
  pruefe('admin.js: Standardwert #0d0a05 (dunkel) definiert', farbenCode.includes('#0d0a05'));
  pruefe('admin.js: Standardwert #faf6ee (hell) definiert', farbenCode.includes('#faf6ee'));
  // Opus Punkt 4: Sequenzzähler gegen Race Condition
  pruefe('admin.js: Sequenzzähler (seq/counter) in autoVorschau', farbenCode.includes('seq') || farbenCode.includes('zaehler') || farbenCode.includes('counter'));

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

  const PASS = 'FarbenUITest99';
  const ph = await passwortHashen(PASS);
  db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)").run('farbenui@example.com', ph, 'admin', new Date().toISOString());

  const app = erstelleServer({ stripe: attrappe, webhookSecret: 'whsec_test', base: 'http://localhost', nodeEnv: 'test', dbDatei: process.env.DB_DATEI });
  const server = app.listen(0, '127.0.0.1');
  alleServer.push(server);
  await warte(300);
  const port = server.address().port;

  const gut = { haupt: '#0b5cad', dunkel: '#000000', hell: '#f5f7fa' };
  const schlecht2 = { haupt: '#808080', dunkel: '#777777', hell: '#888888' };
  const ungueltig = { haupt: '#zzzzzz', dunkel: '#000000', hell: '#f5f7fa' };

  async function req(path, method = 'GET', data, headers = {}) {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const text = await r.text();
    return { status: r.status, headers: r.headers, text, json: () => JSON.parse(text) };
  }

  let cookie = '';

  // Texte-Endpunkt liefert alle Farben-Schlüssel
  const texteR = await req('/api/texte');
  const texte = texteR.json();
  pruefe('/api/texte HTTP 200', texteR.status === 200, `status: ${texteR.status}`);
  for (const k of alleSchluessel) {
    pruefe(`/api/texte: ${k} vorhanden`, typeof texte[k] === 'string' && texte[k].length > 1, texte[k]);
  }

  // Ohne Login → 401/403
  let r = await req('/api/admin/marke/farben-pruefen', 'POST', gut);
  pruefe('/api/admin/marke/farben-pruefen ohne Login → 401/403', [401, 403].includes(r.status), `status: ${r.status}`);

  // Anmelden als Admin
  const login = await req('/api/anmelden', 'POST', { email: 'farbenui@example.com', passwort: PASS });
  cookie = login.headers.get('set-cookie').split(';')[0];
  pruefe('Anmeldung erfolgreich', login.status === 200, `status: ${login.status}`);

  // Prüfen mit schlechtem Satz → 200 ok:false mit zu geringen Paaren
  r = await req('/api/admin/marke/farben-pruefen', 'POST', schlecht2);
  pruefe('Prüfen schlecht → 200', r.status === 200, `status: ${r.status}`);
  const pruefData = r.json();
  pruefe('Prüfen schlecht → ok:false', pruefData.ok === false, `ok: ${pruefData.ok}`);
  pruefe('Prüfen schlecht → pruefung mit 18 Paaren', Array.isArray(pruefData.pruefung) && pruefData.pruefung.length === 18, `len: ${pruefData.pruefung?.length}`);
  pruefe('Prüfen schlecht → mindestens ein Kontrast-Problem', Array.isArray(pruefData.probleme) && pruefData.probleme.some(p => p.code === 'kontrast_zu_gering'), JSON.stringify(pruefData.probleme?.slice(0, 2)));

  // Prüfen mit ungültigem Hex → 422 farbe_ungueltig
  r = await req('/api/admin/marke/farben-pruefen', 'POST', ungueltig);
  pruefe('Prüfen ungültig → 422', r.status === 422, `status: ${r.status}`);
  pruefe('Prüfen ungültig → fehler farbe_ungueltig', r.json().fehler === 'farbe_ungueltig', r.json().fehler);

  // Speichern erfordert Step-up → 401 ohne Step-up
  r = await req('/api/admin/marke/farben', 'PUT', gut);
  pruefe('Speichern ohne Step-up → 401', r.status === 401, `status: ${r.status}`);
  pruefe('Speichern ohne Step-up → stepup_noetig', r.json().fehler === 'stepup_noetig', r.json().fehler);

  // Speichern mit schlechtem Satz → 422 farben_kontrast (nach Step-up)
  r = await req('/api/admin/stepup', 'POST', { passwort: PASS });
  pruefe('Step-up erfolgreich', r.status === 200, `status: ${r.status}`);

  r = await req('/api/admin/marke/farben', 'PUT', schlecht2);
  pruefe('Speichern schlechte Farben → 422', r.status === 422, `status: ${r.status}`);
  pruefe('Speichern schlechte Farben → farben_kontrast', r.json().fehler === 'farben_kontrast', r.json().fehler);

  // /marke.css noch leer
  r = await req('/marke.css');
  pruefe('/marke.css nach schlechtem Speichern noch leer', r.text === '', `Länge: ${r.text.length}`);

  // Speichern mit gutem Satz → 200, /marke.css enthält --gold
  r = await req('/api/admin/marke/farben', 'PUT', gut);
  pruefe('Speichern gute Farben → 200', r.status === 200, `status: ${r.status}`);

  r = await req('/marke.css');
  pruefe('/marke.css enthält --gold:#0b5cad', r.text.includes('--gold:#0b5cad'), `Anfang: ${r.text.slice(0, 80)}`);
  pruefe('/marke.css enthält --night:#000000', r.text.includes('--night:#000000'), `...`);
  pruefe('/marke.css enthält --ivory:#f5f7fa', r.text.includes('--ivory:#f5f7fa'), `...`);

  // GET /api/admin/marke liefert farben-Objekt
  r = await req('/api/admin/marke');
  const markeD = r.json();
  pruefe('/api/admin/marke: farben.haupt korrekt', markeD.farben?.haupt === '#0b5cad', JSON.stringify(markeD.farben));

  // Zurücksetzen → /marke.css wieder leer
  r = await req('/api/admin/marke/farben', 'DELETE');
  pruefe('Zurücksetzen → 200', r.status === 200, `status: ${r.status}`);

  r = await req('/marke.css');
  pruefe('/marke.css nach Zurücksetzen leer', r.text === '', `Länge: ${r.text.length}`);

  r = await req('/api/admin/marke');
  pruefe('/api/admin/marke: farben null nach Zurücksetzen', r.json().farben === null, JSON.stringify(r.json().farben));

  // F-170: Standardwerte werden im UI-Code belegt (statisch geprüft oben); hier Server-seitig:
  // wenn keine Farben gespeichert, GET /api/admin/marke liefert farben:null — Standardwerte sind UI-seitig
  r = await req('/api/admin/marke');
  pruefe('F-170: /api/admin/marke farben=null → UI setzt Standardwerte (server liefert null)', r.json().farben === null, JSON.stringify(r.json().farben));

} finally {
  for (const s of alleServer) await new Promise((r) => s.close(r));
  try { rmSync(ordner, { recursive: true, force: true }); } catch {}
  console.log(`\nErgebnis: ${ok} OK, ${schlecht} FEHLER`);
  if (schlecht > 0) process.exit(1);
}
