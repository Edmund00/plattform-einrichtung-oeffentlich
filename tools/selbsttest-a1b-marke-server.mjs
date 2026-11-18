// A1b-1: Admin-API "Meine Marke" — GET/PUT name, PUT/DELETE logo.
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const lauf = Date.now();
const tmpDir = mkdtempSync(join(tmpdir(), `pe-a1b-${lauf}-`));
const DB_PFAD = join(tmpDir, 'app.db');
process.env.DB_DATEI = DB_PFAD;

import './test-sprache.mjs';

let ok = 0, schlecht = 0;
const pruefe = (name, bed, detail = '') => { bed ? ok++ : schlecht++; console.log(`${bed ? 'OK     ' : 'FEHLER '} ${name}${!bed && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

function minPng() {
  return Buffer.from('89504e470d0a1a0a0000000d49484452000000400000004008000000008f022e020000002449444154edd08100000000c3a0f953dfe004855061c0800103060c183060c0800103060c18f80303097e9ae90000000049454e44ae426082', 'hex');
}
function altPng() {
  // 128x128 Graustufen-PNG (gültig, pruefePng=null, anderer Size als minPng)
  return Buffer.from('89504e470d0a1a0a0000000d4948445200000080000000800800000000e6553e170000005949444154789cedce21010000000220a73bdd191658407a160101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101817760bc0401e15dd421b70000000049454e44ae426082', 'hex');
}
// 40x40 PNG: zu klein (< 64 px)
function kleinPng() {
  return Buffer.from('89504e470d0a1a0a0000000d494844520000002800000028080000000026065f380000001e49444154edd08100000000c3a0f953dfe0048550610003c001060c18306ac080f570030000000049454e44ae426082', 'hex');
}

const attrappe = {
  webhooks: { constructEventAsync: async () => { throw new Error('kein webhook'); } },
  customers: { create: async () => ({ id: 'cus_attrappe' }) },
  checkout: { sessions: { create: async () => ({ id: 'cs_attrappe', url: 'https://example.com/checkout', status: 'open' }), list: async () => ({ data: [] }) } },
};

const { erstelleServer } = await import('../app.mjs');
const { passwortHashen } = await import('../auth.mjs');
const { db } = await import('../db.mjs');

const PASS = 'MarkeTestPasswort99';
const ph = await passwortHashen(PASS);
db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,'"+ph+"','admin',?)").run('marke-admin@example.com', new Date().toISOString());
db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,'"+ph+"','kunde',?)").run('marke-kunde@example.com', new Date().toISOString());

const alleServer = [];
async function startServer(extraOptionen = {}) {
  const app = erstelleServer({ stripe: attrappe, webhookSecret: 'whsec_attrappe', base: 'http://localhost', nodeEnv: 'test', dbDatei: DB_PFAD, ...extraOptionen });
  const s = app.listen(0, '127.0.0.1');
  alleServer.push(s);
  await warte(300);
  return s;
}

async function holen(port, pfad, { method = 'GET', headers = {}, body = undefined, raw = false } = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, { method, headers: { Accept: 'application/json', ...headers }, body, redirect: 'manual' });
  const text = raw ? null : await r.text();
  const ab = raw ? await r.arrayBuffer() : null;
  return { status: r.status, text, buf: ab ? Buffer.from(ab) : null, headers: Object.fromEntries(r.headers) };
}
async function login(port, email, pass) {
  const r = await fetch(`http://127.0.0.1:${port}/api/anmelden`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, passwort: pass }) });
  return r.headers.get('set-cookie')?.split(';')[0] ?? '';
}
async function stepup(port, cookie, pass) {
  return holen(port, '/api/admin/stepup', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ passwort: pass }) });
}

try {
  // =====================================================================
  abschnitt('A: GET /api/admin/marke — Zugriffskontrolle');
  const s = await startServer();
  const port = s.address().port;
  {
    const r = await holen(port, '/api/admin/marke');
    pruefe('A1 Ohne Anmeldung 401', r.status === 401, `status: ${r.status}`);
    const ckKunde = await login(port, 'marke-kunde@example.com', PASS);
    const rK = await holen(port, '/api/admin/marke', { headers: { Cookie: ckKunde } });
    pruefe('A2 Kunde 403', rK.status === 403, `status: ${rK.status}`);
    const ckAdmin = await login(port, 'marke-admin@example.com', PASS);
    const rA = await holen(port, '/api/admin/marke', { headers: { Cookie: ckAdmin } });
    pruefe('A3 Admin 200', rA.status === 200, `status: ${rA.status} body: ${rA.text?.slice(0,100)}`);
    const d = JSON.parse(rA.text);
    pruefe('A4 Antwort enthält name, standard, hat_logo, logo', 'name' in d && 'standard' in d && 'hat_logo' in d && 'logo' in d, JSON.stringify(d));
    pruefe('A5 Cache-Control: no-store', (rA.headers['cache-control'] || '').includes('no-store'), rA.headers['cache-control']);
  }

  // =====================================================================
  abschnitt('B: PUT /api/admin/marke/name — Namensänderung');
  {
    const ck = await login(port, 'marke-admin@example.com', PASS);
    // Ohne Step-up
    const rOhne = await holen(port, '/api/admin/marke/name', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ name: 'NeuName' }) });
    pruefe('B1 Ohne Step-up 401 stepup_noetig', rOhne.status === 401 && JSON.parse(rOhne.text).fehler === 'stepup_noetig', `status: ${rOhne.status} body: ${rOhne.text}`);
    await stepup(port, ck, PASS);

    // Negativtests: ungültige Namen
    const rLeer = await holen(port, '/api/admin/marke/name', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ name: '' }) });
    pruefe('B2 Leerer Name 400', rLeer.status === 400, `status: ${rLeer.status}`);
    const rHtml = await holen(port, '/api/admin/marke/name', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ name: '<b>x</b>' }) });
    pruefe('B3 HTML-Name 400', rHtml.status === 400, `status: ${rHtml.status}`);
    const r61 = await holen(port, '/api/admin/marke/name', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ name: 'A'.repeat(61) }) });
    pruefe('B4 61-Zeichen-Name 400', r61.status === 400, `status: ${r61.status}`);
    const rDoppelt = await holen(port, '/api/admin/marke/name', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ name: 'A  B' }) });
    pruefe('B5 Doppeltes Leerzeichen 400', rDoppelt.status === 400, `status: ${rDoppelt.status}`);
    // Fehlermeldungen dürfen den Wert nicht enthalten
    const rBadBody = JSON.parse(rHtml.text ?? '{}');
    pruefe('B6 Fehlerantwort enthält nicht den eingesandten Wert', !JSON.stringify(rBadBody).includes('<b>x</b>'), JSON.stringify(rBadBody));

    // GET nach Negativtests: Name unverändert (Standard) — kein neues Login (Admin-Login löscht alle Sessions)
    const rVor = await holen(port, '/api/admin/marke', { headers: { Cookie: ck } });
    const dVor = JSON.parse(rVor.text);
    pruefe('B7 Negativtests: Name unverändert (standard=true)', dVor.standard === true, `standard: ${dVor.standard}`);

    // Gültiger Name
    await stepup(port, ck, PASS);
    const rOk = await holen(port, '/api/admin/marke/name', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ name: 'Testakademie Blau' }) });
    pruefe('B8 Gültiger Name 200', rOk.status === 200, `status: ${rOk.status} body: ${rOk.text}`);
    pruefe('B9 Antwort enthält name', JSON.parse(rOk.text ?? '{}').name === 'Testakademie Blau', rOk.text);

    // Sofort sichtbar ohne Neustart
    const rTexte = await holen(port, '/api/texte');
    const dTexte = JSON.parse(rTexte.text);
    pruefe('B10 /api/texte _plattform = neuer Name sofort', dTexte._plattform === 'Testakademie Blau', `_plattform: ${dTexte._plattform}`);
    pruefe('B11 _titel_praefix enthält neuen Namen', dTexte._titel_praefix === 'Testakademie Blau - ', `_titel_praefix: ${dTexte._titel_praefix}`);
    const rIdx = await holen(port, '/');
    const titelIdx = /<title>([^<]*)<\/title>/.exec(rIdx.text)?.[1] ?? '';
    pruefe('B12 <title> von / enthält neuen Namen ohne Neustart', titelIdx.includes('Testakademie Blau'), `title: ${titelIdx}`);
  }

  // =====================================================================
  abschnitt('C: PUT /api/admin/marke/logo — Logo hochladen');
  {
    const ck = await login(port, 'marke-admin@example.com', PASS);
    const rOhne = await holen(port, '/api/admin/marke/logo', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Cookie: ck }, body: minPng() });
    pruefe('C1 Ohne Step-up 401 stepup_noetig', rOhne.status === 401, `status: ${rOhne.status}`);
    await stepup(port, ck, PASS);

    // Kein PNG
    const rKein = await holen(port, '/api/admin/marke/logo', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Cookie: ck }, body: Buffer.from('kein-png') });
    pruefe('C2 Kein PNG 400', rKein.status === 400, `status: ${rKein.status} body: ${rKein.text}`);

    // Zu groß (> 512 KiB)
    const gross = Buffer.alloc(513 * 1024, 0x00);
    const rGross = await holen(port, '/api/admin/marke/logo', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Cookie: ck }, body: gross });
    pruefe('C3 Zu groß 413', rGross.status === 413, `status: ${rGross.status}`);

    // Gültiges PNG
    const rOk = await holen(port, '/api/admin/marke/logo', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Cookie: ck }, body: minPng() });
    pruefe('C4 Gültiges PNG 200', rOk.status === 200, `status: ${rOk.status} body: ${rOk.text}`);
    const dOk = JSON.parse(rOk.text ?? '{}');
    pruefe('C5 Antwort: logo beginnt mit /marke/logo.png?v=', String(dOk.logo).startsWith('/marke/logo.png?v='), `logo: ${dOk.logo}`);

    // /api/texte zeigt neues Logo
    const rTexte = await holen(port, '/api/texte');
    pruefe('C6 /api/texte _logo = /marke/logo.png?v=...', String(JSON.parse(rTexte.text)._logo).startsWith('/marke/logo.png?v='), `_logo: ${JSON.parse(rTexte.text)._logo}`);

    // GET /marke/logo.png liefert die richtigen Bytes
    const rBin = dOk.logo ? await holen(port, dOk.logo, { raw: true }) : { buf: null };
    pruefe('C7 GET logo URL = korrekte Bytes', rBin.buf !== null && Buffer.compare(rBin.buf, minPng()) === 0, `size: ${rBin.buf?.length}`);

    // Zweites anderes PNG: v ändert sich
    await stepup(port, ck, PASS);
    const v1 = dOk.logo ? new URL('http://x' + dOk.logo).searchParams.get('v') : null;
    const rAlt = await holen(port, '/api/admin/marke/logo', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Cookie: ck }, body: altPng() });
    pruefe('C8 Zweites PNG 200', rAlt.status === 200, `status: ${rAlt.status} body: ${rAlt.text?.slice(0,200)}`);
    const dAlt = JSON.parse(rAlt.text ?? '{}');
    const v2 = dAlt.logo ? new URL('http://x' + dAlt.logo).searchParams.get('v') : null;
    pruefe('C9 v ändert sich nach zweitem Upload', v1 !== v2, `v1=${v1} v2=${v2}`);
  }

  // =====================================================================
  abschnitt('D: DELETE /api/admin/marke/logo — Logo entfernen');
  {
    const ck = await login(port, 'marke-admin@example.com', PASS);
    const rOhne = await holen(port, '/api/admin/marke/logo', { method: 'DELETE', headers: { Cookie: ck } });
    pruefe('D1 Ohne Step-up 401 stepup_noetig', rOhne.status === 401, `status: ${rOhne.status}`);
    await stepup(port, ck, PASS);
    const rDel = await holen(port, '/api/admin/marke/logo', { method: 'DELETE', headers: { Cookie: ck } });
    pruefe('D2 DELETE 200', rDel.status === 200, `status: ${rDel.status}`);

    // Idempotent: nochmal löschen auch 200
    await stepup(port, ck, PASS);
    const rDel2 = await holen(port, '/api/admin/marke/logo', { method: 'DELETE', headers: { Cookie: ck } });
    pruefe('D3 Zweites DELETE 200 (idempotent)', rDel2.status === 200, `status: ${rDel2.status}`);

    // /api/texte: _logo zurück auf SVG
    const rTexte = await holen(port, '/api/texte');
    pruefe('D4 Nach DELETE: _logo zurück auf SVG', String(JSON.parse(rTexte.text)._logo).endsWith('.svg'), `_logo: ${JSON.parse(rTexte.text)._logo}`);
  }

  // =====================================================================
  abschnitt('E: Fremde Origin 403');
  {
    const ck = await login(port, 'marke-admin@example.com', PASS);
    await stepup(port, ck, PASS);
    const rFremd = await holen(port, '/api/admin/marke/name', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: ck, Origin: 'https://fremd.example.com' }, body: JSON.stringify({ name: 'Angriff' }) });
    pruefe('E1 Fremde Origin 403', rFremd.status === 403, `status: ${rFremd.status}`);
  }

  // =====================================================================
  abschnitt('F: Namensspeicherung überlebt Neustart (gleiche DB)');
  {
    // Name setzen
    const ck = await login(port, 'marke-admin@example.com', PASS);
    await stepup(port, ck, PASS);
    await holen(port, '/api/admin/marke/name', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ name: 'NeuStartName' }) });
    await new Promise(r => s.close(r));

    // Neuer Server mit gleicher DB
    const s2 = await startServer();
    const port2 = s2.address().port;
    const rTexte = await holen(port2, '/api/texte');
    pruefe('F1 Name überlebt Neustart: _plattform = NeuStartName', JSON.parse(rTexte.text)._plattform === 'NeuStartName', `_plattform: ${JSON.parse(rTexte.text)._plattform}`);
    await new Promise(r => s2.close(r));
  }

  // =====================================================================
  // G: Nachbesserungen aus Opus-Pruefung A1b-1 (Chef 15.11.2026)
  abschnitt('G: Typpruefung, Auth auf allen Schreibrouten, Limit 413, Umgebungsvorrang, Start ohne Hauptschluessel');
  {
    const s3 = await startServer();
    const p3 = s3.address().port;
    let ck = await login(p3, 'marke-admin@example.com', PASS);
    await stepup(p3, ck, PASS);
    let J = { 'Content-Type': 'application/json', Cookie: ck };
    const stand = async () => JSON.parse((await holen(p3, '/api/admin/marke', { headers: { Cookie: ck } })).text);
    const vorher = (await stand()).name;

    // G1: Eingaben, die kein Text sind, werden abgelehnt (nicht in Text umgewandelt)
    for (const [bez, wert] of [['Objekt', {}], ['Zahl', 123], ['Liste', ['A', 'B']], ['null', null]]) {
      const r = await holen(p3, '/api/admin/marke/name', { method: 'PUT', headers: J, body: JSON.stringify({ name: wert }) });
      pruefe(`G1 Name als ${bez} -> 400 name_ungueltig`, r.status === 400 && JSON.parse(r.text).fehler === 'name_ungueltig', `status ${r.status} ${r.text}`);
    }
    pruefe('G1 Name unveraendert nach Fehleingaben', (await stand()).name === vorher, (await stand()).name);

    // G2: alle drei Schreibrouten ohne Anmeldung 401 und als Kunde 403
    const ckKunde = await login(p3, 'marke-kunde@example.com', PASS);
    for (const [m, pf, ct, body] of [['PUT', '/api/admin/marke/name', 'application/json', '{"name":"X"}'], ['PUT', '/api/admin/marke/logo', 'image/png', minPng()], ['DELETE', '/api/admin/marke/logo', 'application/json', undefined]]) {
      const ohne = await holen(p3, pf, { method: m, headers: { 'Content-Type': ct }, body });
      pruefe(`G2 ${m} ${pf} ohne Anmeldung 401`, ohne.status === 401, `status ${ohne.status}`);
      const kunde = await holen(p3, pf, { method: m, headers: { 'Content-Type': ct, Cookie: ckKunde }, body });
      pruefe(`G2 ${m} ${pf} als Kunde 403`, kunde.status === 403, `status ${kunde.status}`);
      // G3: fremde Origin
      const fremd = await holen(p3, pf, { method: m, headers: { 'Content-Type': ct, Cookie: ck, Origin: 'https://fremd.example.com' }, body });
      pruefe(`G3 ${m} ${pf} fremde Origin 403`, fremd.status === 403, `status ${fremd.status}`);
    }

    // G4: Limit LOGO_MAX_BYTES (512 KiB): 600 KB und 3 MB -> 413 png_zu_gross
    for (const groesse of [600 * 1024, 3 * 1024 * 1024]) {
      const r = await holen(p3, '/api/admin/marke/logo', { method: 'PUT', headers: { 'Content-Type': 'image/png', Cookie: ck }, body: Buffer.alloc(groesse, 1) });
      pruefe(`G4 Logo ${Math.round(groesse / 1024)} KB -> 413 png_zu_gross`, r.status === 413 && JSON.parse(r.text).fehler === 'png_zu_gross', `status ${r.status} ${String(r.text).slice(0, 80)}`);
    }

    // G5: Name ueber Umgebungsvariable fixiert -> 409, name_fix true; danach wieder frei
    // nameFix kommt von server.mjs (PLATTFORM_NAME in der Umgebung); hier ueber den Parameter nachgestellt.
    const sFix = await startServer({ nameFix: true });
    const pFix = sFix.address().port;
    const ckFix = await login(pFix, 'marke-admin@example.com', PASS);
    await stepup(pFix, ckFix, PASS);
    {
      const r = await holen(pFix, '/api/admin/marke/name', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: ckFix }, body: JSON.stringify({ name: 'WillÜberschreiben' }) });
      pruefe('G5 Name durch Umgebung fixiert -> 409 name_durch_umgebung', r.status === 409 && JSON.parse(r.text).fehler === 'name_durch_umgebung', `status ${r.status} ${r.text}`);
      const g = JSON.parse((await holen(pFix, '/api/admin/marke', { headers: { Cookie: ckFix } })).text);
      pruefe('G5 GET meldet name_fix true', g.name_fix === true);
    }
    await new Promise(r => sFix.close(r));
    // Maximal 3 Sitzungen je Benutzer: die Anmeldung am nameFix-Server hat die alte Sitzung verdraengt -> neu anmelden
    ck = await login(p3, 'marke-admin@example.com', PASS);
    await stepup(p3, ck, PASS);
    J = { 'Content-Type': 'application/json', Cookie: ck };
    pruefe('G5 ohne nameFix: name_fix false', (await stand()).name_fix === false);

    // G6: Der Name liegt in der Tabelle marke, NICHT in einstellungen: sonst verlangt server.mjs beim Start einen Hauptschluessel
    const { hatGespeicherteEinstellungen } = await import('../einstellungen.mjs');
    await holen(p3, '/api/admin/marke/name', { method: 'PUT', headers: J, body: JSON.stringify({ name: 'OhneSchluessel' }) });
    const inEinst = db.prepare("SELECT COUNT(*) AS n FROM einstellungen WHERE schluessel='PLATTFORM_NAME'").get().n;
    const inMarke = db.prepare("SELECT wert FROM marke WHERE schluessel='name'").get()?.wert;
    pruefe('G6 Name steht in Tabelle marke', inMarke === 'OhneSchluessel', String(inMarke));
    pruefe('G6 Name steht NICHT in einstellungen', inEinst === 0, `Zeilen: ${inEinst}`);
    pruefe('G6 hatGespeicherteEinstellungen bleibt false (Start ohne Hauptschluessel moeglich)', hatGespeicherteEinstellungen(DB_PFAD) === false);
    await new Promise(r => s3.close(r));
  }

  // G7: Jeder Fehlercode, den routes-marke.mjs ausgibt, hat in ALLEN Sprachen einen nicht leeren Text (selbsttest-admin liest diese Datei nicht).
  abschnitt('G7: Fehlercodes von routes-marke.mjs haben Texte in en/de/hu');
  {
    const quelle = readFileSync(new URL('../routes-marke.mjs', import.meta.url), 'utf8');
    const codes = new Set([...quelle.matchAll(/fehler\(res,\s*\d+,\s*'([a-z_]+)'\)/g)].map((m) => m[1]));
    // dynamischer Code aus pruefePng: die vier bekannten plus png_ungueltig
    for (const c of ['png_leer', 'png_zu_gross', 'png_kein_png', 'png_abmessung_ungueltig', 'png_ungueltig']) codes.add(c);
    pruefe('G7 mindestens 8 Fehlercodes gefunden', codes.size >= 8, [...codes].join(','));
    for (const l of ['en', 'de', 'hu']) {
      const j = JSON.parse(readFileSync(new URL(`../texte/${l}.json`, import.meta.url), 'utf8'));
      const fehlt = [...codes].filter((c) => typeof j[c] !== 'string' || j[c].trim() === '');
      pruefe(`G7 ${l}: alle Fehlercodes haben einen Text`, fehlt.length === 0, 'fehlt: ' + fehlt.join(','));
    }
  }

} finally {
  for (const sv of alleServer) { try { await new Promise(r => sv.close(r)); } catch { /* ignore */ } }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('');
console.log(`Ergebnis: ${ok} OK, ${schlecht} FEHLER`);
if (schlecht > 0) process.exit(1);
