// A1a: Name im Seitentitel + hochgeladenes PNG-Logo in Shop und Admin.
// Abnahmekriterien A-G aus AUFTRAG A1a.
// Verwendet erstelleServer (wie selbsttest-kauf.mjs) damit /api/texte und / und /admin/ verfuegbar sind.
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';

// DB_DATEI VOR dem Import von app.mjs setzen (db.mjs Singleton)
const lauf = Date.now();
const tmpDir = mkdtempSync(join(tmpdir(), `pe-a1a-${lauf}-`));
const DB_PFAD = join(tmpDir, 'app.db');
process.env.DB_DATEI = DB_PFAD;

import './test-sprache.mjs';

const PLATTFORM_NAME = 'Testakademie Violett';

let ok = 0, schlecht = 0;
const pruefe = (name, bed, detail = '') => { bed ? ok++ : schlecht++; console.log(`${bed ? 'OK     ' : 'FEHLER '} ${name}${!bed && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimal gültiges 64x64-PNG (Graustufen) — pruefePng erfordert mindestens 64x64
function minPng() {
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000400000004008000000008f022e020000002449444154edd08100000000c3a0f953dfe004855061c0800103060c183060c0800103060c18f80303097e9ae90000000049454e44ae426082',
    'hex'
  );
}

// Zweites PNG: 128x128, damit v sich nach Dateiänderung nachweisbar ändert (D)
function altPng() {
  return Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000080000000800800000000e6553e170000005849444154edd08100000000c3a0f9531fe4855061c0800103060c183060c0800103060c183060c0800103060c183060c0800103060c183060c0800103060c183060c0800103060c183060c0800103060cbc0f0c5fc871420000000049454e44ae426082',
    'hex'
  );
}

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

const logoDir = join(tmpDir, 'marke');
mkdirSync(logoDir, { recursive: true });
const logoPfad = join(logoDir, 'logo.png');

const { erstelleServer } = await import('../app.mjs');

// Alle gestarteten Server zur gemeinsamen Bereinigung
const alleServer = [];

async function serverMitPng(extraOptionen = {}) {
  const app = erstelleServer({
    stripe: attrappe,
    webhookSecret: 'whsec_attrappe',
    base: 'http://localhost',
    nodeEnv: 'test',
    plattformName: PLATTFORM_NAME,
    dbDatei: DB_PFAD,
    ...extraOptionen,
  });
  const s = app.listen(0, '127.0.0.1');
  alleServer.push(s);
  await warte(300);
  return s;
}

async function holen(port, pfad, { headers = {} } = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, { headers: { Accept: 'text/html,application/json', ...headers }, redirect: 'manual' });
  const text = await r.text();
  return { status: r.status, text, headers: Object.fromEntries(r.headers) };
}

try {
  // =====================================================================
  abschnitt('A: _logo und _logo_vertikal beginnen mit /marke/logo.png?v=');
  writeFileSync(logoPfad, minPng());
  const sMain = await serverMitPng();
  const portMain = sMain.address().port;
  {
    const r = await holen(portMain, '/api/texte');
    const d = JSON.parse(r.text);
    pruefe('A1 _logo beginnt mit /marke/logo.png?v=', String(d._logo).startsWith('/marke/logo.png?v='), `_logo: ${d._logo}`);
    pruefe('A2 _logo_vertikal beginnt mit /marke/logo.png?v=', String(d._logo_vertikal).startsWith('/marke/logo.png?v='), `_logo_vertikal: ${d._logo_vertikal}`);
    pruefe('A3 _titel_praefix = "<Name> - " bei eigenem Namen (F-137)', d._titel_praefix === PLATTFORM_NAME + ' - ', `_titel_praefix: ${JSON.stringify(d._titel_praefix)}`);
  }

  // =====================================================================
  abschnitt('B: GET /marke/logo.png -> 200, image/png, nosniff, richtige Bytes');
  {
    const r = await holen(portMain, '/marke/logo.png');
    pruefe('B1 Status 200', r.status === 200, `Status: ${r.status}`);
    pruefe('B2 Content-Type: image/png', (r.headers['content-type'] || '').startsWith('image/png'), `Content-Type: ${r.headers['content-type']}`);
    pruefe('B3 X-Content-Type-Options: nosniff', r.headers['x-content-type-options'] === 'nosniff', `Header: ${r.headers['x-content-type-options']}`);
    const rBin = await fetch(`http://127.0.0.1:${portMain}/marke/logo.png`);
    const serviert = Buffer.from(await rBin.arrayBuffer());
    pruefe('B4 Body = exakt die gespeicherte PNG-Datei', Buffer.compare(serviert, readFileSync(logoPfad)) === 0, `Groesse: ${serviert.length} vs ${readFileSync(logoPfad).length}`);
  }

  // =====================================================================
  abschnitt('C: <title> enthaelt Plattformnamen');
  {
    const rIndex = await holen(portMain, '/');
    const titelIndex = /<title>([^<]*)<\/title>/.exec(rIndex.text)?.[1] ?? '';
    pruefe('C1 / Titel enthaelt Plattformnamen', titelIndex.includes(PLATTFORM_NAME), `title: ${titelIndex}`);
    const rAdmin = await holen(portMain, '/admin/');
    const titelAdmin = /<title>([^<]*)<\/title>/.exec(rAdmin.text)?.[1] ?? '';
    pruefe('C2 /admin/ Titel enthaelt Plattformnamen', titelAdmin.includes(PLATTFORM_NAME), `title: ${titelAdmin}`);
  }

  // =====================================================================
  abschnitt('D: v aendert sich nach Datei-Neuschreiben (im laufenden Server, kein Neustart)');
  {
    const r1 = await holen(portMain, '/api/texte');
    const v1 = new URL('http://x' + JSON.parse(r1.text)._logo).searchParams.get('v');

    // Andere Datei (andere Abmessung) schreiben + mtime 5 s vorwärts setzen
    const jetzt = Date.now() / 1000;
    writeFileSync(logoPfad, altPng());
    utimesSync(logoPfad, jetzt + 5, jetzt + 5);

    const r2 = await holen(portMain, '/api/texte');
    const v2 = new URL('http://x' + JSON.parse(r2.text)._logo).searchParams.get('v');

    pruefe('D v aendert sich nach Datei-Neuschreiben', v1 !== v2, `v1=${v1} v2=${v2}`);
  }
  await new Promise(r => sMain.close(r));

  // =====================================================================
  abschnitt('E: Ohne PNG -> _logo = /img/marke-logo.svg (eigener Name) / /img/muster-logo.svg (Standard)');
  rmSync(logoPfad, { force: true });
  {
    const s = await serverMitPng();
    const port = s.address().port;
    const r = await holen(port, '/api/texte');
    const d = JSON.parse(r.text);
    pruefe('E1 _logo = /img/marke-logo.svg (eigener Name, kein PNG)', d._logo === '/img/marke-logo.svg', `_logo: ${d._logo}`);
    await new Promise(r => s.close(r));
  }
  {
    // Standardname (kein PLATTFORM_NAME)
    const s = await serverMitPng({ plattformName: undefined });
    const port = s.address().port;
    const r = await holen(port, '/api/texte');
    const d = JSON.parse(r.text);
    pruefe('E2 _logo = /img/muster-logo.svg (Standardname, kein PNG)', d._logo === '/img/muster-logo.svg', `_logo: ${d._logo}`);
    pruefe('E4 _titel_praefix fehlt beim Standardnamen (F-137; Antwort wie vorher, selbsttest-admin verlangt nur nicht leere Werte)', !('_titel_praefix' in d), `_titel_praefix: ${JSON.stringify(d._titel_praefix)}`);
    const rIdx = await holen(port, '/');
    const titelStd = /<title>([^<]*)<\/title>/.exec(rIdx.text)?.[1] ?? '';
    pruefe('E3 Standardname: Titel = k_oldal_cim ohne Praefix', titelStd === d.k_oldal_cim, `titel="${titelStd}" k_oldal_cim="${d.k_oldal_cim}"`);
    await new Promise(r => s.close(r));
  }

  // =====================================================================
  abschnitt('F: Defekte Datei -> Rueckfall auf SVG, kein Absturz');
  writeFileSync(logoPfad, 'kein-png-inhalt');
  {
    const s = await serverMitPng();
    const port = s.address().port;
    try {
      const r = await holen(port, '/api/texte');
      const d = JSON.parse(r.text);
      pruefe('F1 Defekte Datei -> Rueckfall auf SVG', String(d._logo).endsWith('.svg'), `_logo: ${d._logo}`);
      pruefe('F2 Kein Absturz (Status 200)', r.status === 200, `Status: ${r.status}`);
    } catch (e) {
      pruefe('F1 Defekte Datei -> Rueckfall auf SVG', false, String(e));
      pruefe('F2 Kein Absturz', false, String(e));
    }
    await new Promise(r => s.close(r));
  }

  // =====================================================================
  abschnitt('G: HTML-Zeichen im Namen werden von pruefePlattformName abgelehnt / setzePlattform faellt zurueck');
  {
    const { pruefePlattformName, setzePlattform, plattformName, STANDARD_PLATTFORM_NAME } = await import('../marke.mjs');
    pruefe('G1 "<b>" als Name wird abgelehnt', pruefePlattformName('<b>') !== null, 'pruefePlattformName("<b>") sollte Fehler liefern');
    pruefe('G2 "A&B" wird abgelehnt', pruefePlattformName('A&B') !== null, 'pruefePlattformName("A&B") sollte Fehler liefern');
    setzePlattform('<b>x</b>');
    pruefe('G3 setzePlattform("<b>x</b>") faellt auf Standardnamen zurueck', plattformName() === STANDARD_PLATTFORM_NAME, `plattformName(): ${plattformName()}`);
  }

  // =====================================================================
  abschnitt('H: logoPfade() Cache — nur einmal pruefen bei gleicher Datei (F-138)');
  {
    const { logoPruefungen, setzeLogoPfad, logoPfade: lp } = await import('../marke.mjs');
    const tmpH = mkdtempSync(join(tmpdir(), `pe-a1a-h-${lauf}-`));
    const logoH = join(tmpH, 'marke', 'logo.png');
    mkdirSync(dirname(logoH), { recursive: true });
    writeFileSync(logoH, minPng());
    setzeLogoPfad(logoH);
    try {
      const p0 = logoPruefungen();
      for (let i = 0; i < 50; i++) lp();
      pruefe('H1 50x logoPfade() -> Pruefungen +1', logoPruefungen() === p0 + 1, `Delta: ${logoPruefungen() - p0}`);
      const v0 = lp().quer;
      const now = Date.now() / 1000;
      utimesSync(logoH, now + 5, now + 5);
      lp();
      pruefe('H2 mtime +5s -> Pruefungen +1', logoPruefungen() === p0 + 2, `Delta: ${logoPruefungen() - p0}`);
      const v1 = lp().quer;
      pruefe('H3 v aendert sich nach mtime-Aenderung', v0 !== v1, `v0=${v0} v1=${v1}`);
      writeFileSync(logoH, Buffer.from('kein-png'));
      utimesSync(logoH, now + 10, now + 10);
      const rDef = lp();
      pruefe('H4 defekte Datei -> SVG-Rueckfall', rDef.quer.endsWith('.svg'), `quer: ${rDef.quer}`);
      pruefe('H5 defekte Datei -> kein Absturz', true);
      unlinkSync(logoH);
      const rDel = lp();
      pruefe('H6 Datei geloescht -> SVG', rDel.quer.endsWith('.svg'), `quer: ${rDel.quer}`);
    } finally {
      try { rmSync(tmpH, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

} finally {
  for (const s of alleServer) {
    try { await new Promise(r => s.close(r)); } catch { /* ignore */ }
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// F-141: seiteAnsagen() (public/kunde.js) setzt bei jedem Ansichtswechsel document.title neu und darf den Plattform-Praefix nicht verlieren.
{
  abschnitt('F-141: Titel bei Ansichtswechsel behaelt den Plattformnamen (Quelltext; Browserbeweis fuehrt der Chef)');
  const kundeJs = readFileSync(new URL('../public/kunde.js', import.meta.url), 'utf8');
  const start = kundeJs.indexOf('function seiteAnsagen(');
  const ende = kundeJs.indexOf('\n}', start);
  const rumpf = start >= 0 && ende > start ? kundeJs.slice(start, ende) : '';
  const titelZeile = (rumpf.split('\n').find((z) => z.includes('document.title')) || '');
  pruefe('F-141 seiteAnsagen: Titel wird aus _titel_praefix gebildet (beide Zweige)', rumpf.includes('_titel_praefix') && /basisTitel/.test(titelZeile) && !/:\s*t\('k_oldal_cim'\);/.test(titelZeile), titelZeile.trim().slice(0, 200));
}

// F-143: Der Behaelter des Kopf-Logos braucht selbst eine Breitengrenze (ein sehr breites PNG schob sonst die Seite ueber die Fensterbreite; im Chrome gemessen).
{
  abschnitt('F-143: Kopf-Logo-Behaelter hat max-width (Quelltext; Browserbeweis fuehrt der Chef)');
  const kundeCss = readFileSync(new URL('../public/kunde.css', import.meta.url), 'utf8');
  const adminCss = readFileSync(new URL('../public/admin/admin.css', import.meta.url), 'utf8');
  const regel = (css, sel) => (css.split(/\r?\n/).find((z) => z.startsWith(sel + '{')) || '');
  pruefe('F-143 .marka hat max-width', /max-width/.test(regel(kundeCss, '.marka')), regel(kundeCss, '.marka'));
  pruefe('F-143 .admin-marke hat max-width', /max-width/.test(regel(adminCss, '.admin-marke')), regel(adminCss, '.admin-marke'));
}

console.log('');
console.log(`Ergebnis: ${ok} OK, ${schlecht} FEHLER`);
if (schlecht > 0) process.exit(1);
