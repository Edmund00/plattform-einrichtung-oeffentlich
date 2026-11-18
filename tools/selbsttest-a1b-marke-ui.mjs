// A1b-2: Admin-Oberfläche "Meine Marke" — statische Code- und Textprüfungen + /api/texte-Integration.
import './test-sprache.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ordner = mkdtempSync(join(tmpdir(), 'pe-a1b-ui-'));
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

  const markeTextSchluessel = [
    'marke_titel', 'marke_name_bezeichnung', 'marke_name_ok',
    'marke_logo_bezeichnung', 'marke_logo_hilfe',
    'marke_logo_hochladen', 'marke_logo_loeschen', 'marke_logo_loeschen_frage',
    'marke_logo_ok', 'marke_logo_entfernt', 'marke_logo_vorschau_alt',
  ];
  for (const k of markeTextSchluessel) {
    pruefe(`de.json: ${k} vorhanden und nicht leer`, typeof de[k] === 'string' && de[k].length > 2, de[k]);
    pruefe(`hu.json: ${k} vorhanden und nicht leer`, typeof hu[k] === 'string' && hu[k].length > 2, hu[k]);
    pruefe(`en.json: ${k} vorhanden und nicht leer`, typeof en[k] === 'string' && en[k].length > 2, en[k]);
  }

  // ======== B) admin.js — statische Codeprüfungen =================================
  const admin = lies('public/admin/admin.js');

  pruefe('admin.js: markeBereich Funktion vorhanden', admin.includes('async function markeBereich()'));
  pruefe('admin.js: markeKnopf mit markeBereich-Referenz vorhanden', admin.includes('onclick:markeBereich') || admin.includes('onclick: markeBereich'));
  pruefe('admin.js: markeKnopf im werkzeugReihe eingebunden', /werkzeugReihe\s*=\s*h\([\s\S]*?markeKnopf[\s\S]*?\);/.test(admin));
  pruefe('admin.js: marke_titel Text verwendet', admin.includes("t('marke_titel')"));
  pruefe('admin.js: marke_name_bezeichnung verwendet', admin.includes("t('marke_name_bezeichnung')"));
  pruefe('admin.js: marke_logo_bezeichnung verwendet', admin.includes("t('marke_logo_bezeichnung')"));
  pruefe('admin.js: marke_logo_hilfe verwendet', admin.includes("t('marke_logo_hilfe')"));
  pruefe('admin.js: apiMitStepup für Name-Änderung', admin.includes("apiMitStepup('PUT', '/api/admin/marke/name'"));
  pruefe('admin.js: apiMitStepup für Logo-Löschen', admin.includes("apiMitStepup('DELETE', '/api/admin/marke/logo'"));
  pruefe('admin.js: Step-up beim Logo-Upload nur bei 401 stepup_noetig, danach EINE Wiederholung',
    admin.includes("rr.d?.fehler === 'stepup_noetig'") && admin.includes('await stepupAnfordern()') && admin.includes('rr = await logoSenden(bytes)') && admin.includes('const bytes = logoBytes'));   // A6/A6-N: Auswahl und Upload getrennt; beim Klick werden die Bytes festgehalten (const bytes), Wiederholung nutzt dieselben
  pruefe('admin.js: Logo-Upload als Rohbytes (PUT /api/admin/marke/logo, octet-stream, arrayBuffer)',
    admin.includes("fetch('/api/admin/marke/logo', { method: 'PUT'") &&
    admin.includes("'Content-Type': 'application/octet-stream'") &&
    admin.includes('arrayBuffer()'));
  pruefe('admin.js: Vorpruefung im Browser (Endung .png, Groesse 512 KB)',
    admin.includes('/\\.png$/i') && admin.includes('d.logo_max_bytes') && admin.includes("datei.type !== 'image/png'"));   // A6: Grenze kommt vom Server (LOGO_MAX_BYTES = 512 KB, routes-marke.mjs); Typ, Endung und Groesse lokal vorgeprueft
  pruefe('admin.js: nach Name/Logo-Aenderung Titel und Kopf erneuern (markeNeuLaden, _titel_praefix, .admin-marke img)',
    (admin.match(/await markeNeuLaden\(\)/g) || []).length >= 3 && admin.includes('T._titel_praefix = n._titel_praefix') && admin.includes(".admin-marke img"));
  pruefe('admin.js: name_fix sperrt das Namensfeld und zeigt den Hinweis (name_durch_umgebung)',
    admin.includes('d.name_fix') && admin.includes("t('name_durch_umgebung')") && admin.includes('nameEingabe.disabled = true'));
  pruefe('admin.js: Marke-Bereich ohne innerHTML',
    !admin.slice(admin.indexOf('async function markeNeuLaden'), admin.indexOf('const markeKnopf') > 0 ? admin.indexOf('const markeKnopf') : undefined).includes('innerHTML'));
  pruefe('admin.js: Logo-Vorschau nur wenn hat_logo=true (d.hat_logo)',
    admin.includes('d.hat_logo'));
  pruefe('admin.js: Logo-Löschen-Knopf nur wenn hat_logo=true',
    /d\.hat_logo\s*\?.*marke_logo_loeschen/.test(admin) ||
    /d\.hat_logo\s*\?.*h\('button'/.test(admin.slice(admin.indexOf('markeBereich'))));
  pruefe('admin.js: zurück-Knopf zu uebersicht', admin.slice(admin.indexOf('async function markeBereich')).includes('onclick: uebersicht') || admin.slice(admin.indexOf('async function markeBereich')).includes('onclick:uebersicht'));
  pruefe('admin.js: file-input accept=image/png', admin.includes("accept: 'image/png'"));
  pruefe('admin.js: marke_logo_loeschen_frage als Bestätigungsfrage', admin.includes("'marke_logo_loeschen_frage'"));

  // ======== C) /api/texte liefert marke-Schlüssel ====================================
  const attrappe = {
    webhooks: { constructEventAsync: async () => { throw new Error('kein webhook'); } },
    customers: { create: async () => ({ id: 'cus_attrappe' }) },
    checkout: { sessions: { create: async () => ({ id: 'cs_attrappe', url: 'https://example.com/checkout', status: 'open' }), list: async () => ({ data: [] }) } },
  };

  const { erstelleServer } = await import('../app.mjs');
  const { passwortHashen } = await import('../auth.mjs');
  const { db } = await import('../db.mjs');

  const PASS = 'MarkeUITest99';
  const ph = await passwortHashen(PASS);
  db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)").run('markeui@example.com', ph, 'admin', new Date().toISOString());

  const app = erstelleServer({ stripe: attrappe, webhookSecret: 'whsec_test', base: 'http://localhost', nodeEnv: 'test', dbDatei: process.env.DB_DATEI });
  const server = app.listen(0, '127.0.0.1');
  alleServer.push(server);
  await warte(300);
  const port = server.address().port;

  const r = await fetch(`http://127.0.0.1:${port}/api/texte`);
  const texte = await r.json();
  pruefe('/api/texte HTTP 200', r.status === 200, `status: ${r.status}`);
  for (const k of markeTextSchluessel) {
    pruefe(`/api/texte: ${k} vorhanden`, typeof texte[k] === 'string' && texte[k].length > 2, texte[k]);
  }

} finally {
  for (const s of alleServer) await new Promise((r) => s.close(r));
  try { rmSync(ordner, { recursive: true, force: true }); } catch {}
  console.log(`\nErgebnis: ${ok} OK, ${schlecht} FEHLER`);
  if (schlecht > 0) process.exit(1);
}
