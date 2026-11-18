// Selbsttest WP7: E-Mail-Versand (Resend), Schritt 3 Einrichtungsassistent.
// Pruefungen M1-M7 aus docs/SPEZ-WP4-9-ASSISTENT.md plus 14 Faelle aus Material Teil 2.
// Resend-API wird durch lokalen Mock ersetzt (PE_RESEND_URL=http://127.0.0.1:<mock>).
// Kein Netzwerk, keine echten Schluessel.
import './test-sprache.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolve as urlResolve, pathToFileURL } from 'node:url';

let ok = 0, schlecht = 0;
const pruefe = (name, bed, detail = '') => { bed ? ok++ : schlecht++; console.log(`${bed ? 'OK     ' : 'FEHLER '} ${name}${!bed && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = (p) => { try { rmSync(p, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } };
const SERVER = resolve('server.mjs');
const basisEnv = (extra) => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...extra });

// Mock-Resend-Server: eine Instanz, Verhalten per Test konfigurierbar.
const MOCK_PORT = 19380;
let mockAnfragen = [];
let mockAntwortFn = (req) => ({ status: 200, body: { id: 'mock_id' } });

const mockServer = await new Promise((resolve, reject) => {
  const srv = createServer((req, res) => {
    let rohdaten = '';
    req.on('data', c => { rohdaten += c; });
    req.on('end', () => {
      const idKey = req.headers['idempotency-key'] ?? null;
      mockAnfragen.push({ headers: { ...req.headers }, body: rohdaten, idempotencyKey: idKey });
      const { status, body, hang, retryAfter } = mockAntwortFn(req) ?? { status: 200, body: { id: 'x' } };
      if (hang) return; // kein Response → Timeout-Test
      const respHeaders = { 'Content-Type': 'application/json' };
      if (retryAfter != null) respHeaders['retry-after'] = String(retryAfter);
      res.writeHead(status, respHeaders);
      res.end(JSON.stringify(body ?? { id: 'mock' }));
    });
  });
  srv.listen(MOCK_PORT, '127.0.0.1', () => resolve(srv));
  srv.on('error', reject);
});
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

async function starteServer(tmpord, port, extraEnv = {}) {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    cwd: tmpord, stdio: ['ignore', 'pipe', 'pipe'],
    env: basisEnv({ PORT: String(port), DB_DATEI: join(tmpord, 'app.db'), PE_RESEND_URL: MOCK_URL, ...extraEnv }),
  });
  let log = '';
  p.stdout.on('data', x => { log += x; });
  p.stderr.on('data', x => { log += x; });
  for (let i = 0; i < 300; i++) {
    if (/Setup-Modus|Einrichtungsmodus|Schulungsplattform läuft|fehlerhaft/.test(log)) break;
    if (p.exitCode !== null) break;
    try { const r = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null); if (r?.status) break; } catch { /* noch nicht */ }
    await warte(200);
  }
  return { p, log: () => log };
}
async function stop(p) {
  p.kill('SIGTERM');
  await new Promise(r => { if (p.exitCode !== null) r(); else { p.on('exit', r); setTimeout(() => { try { p.kill('SIGKILL'); } catch {}; r(); }, 10000); } });
}
async function holen(port, pfad, { method = 'GET', headers = {}, body = null } = {}) {
  const init = { method, headers: { Accept: 'text/html,application/json', ...headers }, redirect: 'manual' };
  if (body !== null) init.body = body;
  const a = await fetch(`http://127.0.0.1:${port}${pfad}`, init);
  const text = await a.text();
  return { status: a.status, text, headers: Object.fromEntries(a.headers) };
}

async function einrichtungsmodusServer(tmpord, port, extraEnv = {}) {
  const { p: pSetup } = await starteServer(tmpord, port, { EINRICHTUNGSMODUS: '1' });
  for (let i = 0; i < 600; i++) {
    if (existsSync(join(tmpord, 'daten', 'ERSTSTART.txt'))) break;
    await warte(100);
  }
  const code = existsSync(join(tmpord, 'daten', 'ERSTSTART.txt'))
    ? readFileSync(join(tmpord, 'daten', 'ERSTSTART.txt'), 'utf8').trim() : null;
  if (code) {
    await holen(port, '/einrichtung', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, email: 'admin@beispiel.hu', passwort: 'passwort12345' }).toString(),
    });
  }
  await stop(pSetup);
  const { p, log } = await starteServer(tmpord, port, extraEnv);
  return { p, log, hatAdmin: !!code };
}

async function einloggenUndCsrf3(port) {
  const r1 = await holen(port, '/anmelden');
  const cookie = r1.headers['set-cookie'] ?? '';
  const r2 = await holen(port, '/anmelden', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ email: 'admin@beispiel.hu', passwort: 'passwort12345' }).toString(),
  });
  const sessionCookie = r2.headers['set-cookie'] ?? cookie;
  const r3 = await holen(port, '/admin/einrichtung/schritt/3', { headers: { Cookie: sessionCookie } });
  const csrfMatch = r3.text.match(/name="csrf_token" value="([0-9a-f]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';
  return { sessionCookie, csrf, schritt3Html: r3.text };
}

async function postSchritt3(port, sessionCookie, csrf, felder) {
  return holen(port, '/admin/einrichtung/schritt/3', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sessionCookie },
    body: new URLSearchParams({ csrf_token: csrf, ...felder }).toString(),
  });
}

async function postMailTest(port, sessionCookie, csrf, koerper) {
  return holen(port, '/admin/einrichtung/mail-test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Csrf-Token': csrf,
      Cookie: sessionCookie,
    },
    body: JSON.stringify(koerper),
  });
}

// ======================================================================
abschnitt('M1: GET /schritt/3 zeigt E-Mail-Einrichtungsseite');
let tmpM1, portM1 = 19381;
{
  tmpM1 = mkdtempSync(join(tmpdir(), 'wp7-m1-'));
  mkdirSync(join(tmpM1, 'daten'), { recursive: true });
  const { p, log, hatAdmin } = await einrichtungsmodusServer(tmpM1, portM1);
  pruefe('M1-1 Server gestartet', /Schulungsplattform/.test(log()), log());
  pruefe('M1-2 Admin angelegt', hatAdmin);

  const { sessionCookie, csrf, schritt3Html: html } = await einloggenUndCsrf3(portM1);
  pruefe('M1-3 GET /schritt/3 liefert 200', html.length > 50, `len=${html.length}`);
  pruefe('M1-4 CSRF-Token vorhanden', csrf.length === 64, `csrf='${csrf}'`);
  pruefe('M1-5 Seite enthält RESEND-Schluessel-Eingabe (kein Key gesetzt)', html.includes('RESEND_API_KEY'), html.slice(0, 300));
  pruefe('M1-6 Seite enthält MAIL_FROM-Eingabe', html.includes('MAIL_FROM'), html.slice(0, 300));
  pruefe('M1-7 Seite enthält Test-Mail-Button', html.includes('mail-test-btn'), html.slice(0, 300));
  pruefe('M1-8 Seite enthält „Ohne E-Mail fortfahren"-Button', html.includes('ohne_mail'), html.slice(0, 300));

  // Gegenprobe: kein maskierter Schluessel ohne gespeicherten Key
  pruefe('M1-9 Gegenprobe: kein maskierter Schluessel ohne gespeicherten Key', !html.includes('key_maskiert') && !html.includes('re_••••'), html.slice(0, 300));

  await stop(p); aufraeumen(tmpM1);
}

// ======================================================================
abschnitt('M2: POST /schritt/3 ohne Schluessel → 400');
let tmpM2, portM2 = 19382;
{
  tmpM2 = mkdtempSync(join(tmpdir(), 'wp7-m2-'));
  mkdirSync(join(tmpM2, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpM2, portM2);
  const { sessionCookie, csrf } = await einloggenUndCsrf3(portM2);

  // POST ohne Schluessel und ohne vorhandenen Key in DB
  const r = await postSchritt3(portM2, sessionCookie, csrf, { MAIL_FROM: 'Test <t@ex.com>' });
  pruefe('M2-1 Kein Schluessel → 400', r.status === 400, `status=${r.status}`);

  // Gegenprobe: mit Schluessel → kein 400
  mockAntwortFn = () => ({ status: 200, body: { id: 'x' } });
  const rOk = await postSchritt3(portM2, sessionCookie, csrf, {
    RESEND_API_KEY: 're_TestSchluessel12345', MAIL_FROM: 'Test <absender@beispiel.hu>',
  });
  pruefe('M2-2 Gegenprobe: mit Schluessel → kein 400 (303)', rOk.status === 303, `status=${rOk.status}`);

  await stop(p); aufraeumen(tmpM2);
}

// ======================================================================
abschnitt('M3: POST /schritt/3 speichert Key verschluesselt + MAIL_FROM unverschluesselt');
let tmpM3, portM3 = 19383;
{
  tmpM3 = mkdtempSync(join(tmpdir(), 'wp7-m3-'));
  mkdirSync(join(tmpM3, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpM3, portM3);
  const { sessionCookie, csrf } = await einloggenUndCsrf3(portM3);

  const r = await postSchritt3(portM3, sessionCookie, csrf, {
    RESEND_API_KEY: 're_GeheimerTestSchluessel', MAIL_FROM: 'Testverwaltung <admin@plattform.hu>',
  });
  pruefe('M3-1 POST Schritt 3 → 303 Redirect zu /schritt/4', r.status === 303, `status=${r.status} loc=${r.headers['location']}`);
  pruefe('M3-2 Redirect zeigt auf /schritt/4', (r.headers['location'] ?? '').includes('/schritt/4'), `loc=${r.headers['location']}`);

  // DB direkt pruefen
  const db3 = new DatabaseSync(join(tmpM3, 'app.db'), { readOnly: true });
  const keyRow = db3.prepare("SELECT wert, verschluesselt FROM einstellungen WHERE schluessel='RESEND_API_KEY'").get();
  const mailFromRow = db3.prepare("SELECT wert, verschluesselt FROM einstellungen WHERE schluessel='MAIL_FROM'").get();
  const stepRow = db3.prepare("SELECT wert FROM einstellungen WHERE schluessel='einrichtung_schritt_3'").get();
  db3.close();

  pruefe('M3-3 RESEND_API_KEY in DB gespeichert', !!keyRow, 'keyRow missing');
  pruefe('M3-4 RESEND_API_KEY verschluesselt (nicht Klartext)', !!keyRow && keyRow.verschluesselt === 1 && keyRow.wert !== 're_GeheimerTestSchluessel', `verschluesselt=${keyRow?.verschluesselt} wert=${keyRow?.wert?.slice(0,30)}`);
  pruefe('M3-5 MAIL_FROM unverschluesselt gespeichert', !!mailFromRow && mailFromRow.verschluesselt === 0 && mailFromRow.wert === 'Testverwaltung <admin@plattform.hu>', `wert=${mailFromRow?.wert}`);
  pruefe('M3-6 Schritt 3 als fertig markiert', stepRow?.wert === 'fertig', `wert=${stepRow?.wert}`);

  // GET: maskierter Schluessel erscheint nach Speichern
  const { schritt3Html: html3 } = await einloggenUndCsrf3(portM3);
  pruefe('M3-7 Maskierter Schluessel sichtbar nach Speichern', html3.includes('re_••••') || html3.includes('key_maskiert') || html3.includes('gespeichert'), html3.slice(0, 400));
  pruefe('M3-8 Klartext-Schluessel nicht in GET-Antwort', !html3.includes('re_GeheimerTestSchluessel'), html3.slice(0, 400));
  pruefe('M3-9 Schluessel-loeschen-Button erscheint nach Speichern', html3.includes('key_loeschen'), html3.slice(0, 400));

  await stop(p); aufraeumen(tmpM3);
}

// ======================================================================
abschnitt('M4: MAIL_FROM Validation');
let tmpM4, portM4 = 19384;
{
  tmpM4 = mkdtempSync(join(tmpdir(), 'wp7-m4-'));
  mkdirSync(join(tmpM4, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpM4, portM4);
  const { sessionCookie, csrf } = await einloggenUndCsrf3(portM4);

  // MAIL_FROM ohne spitze Klammern
  const rKlammern = await postSchritt3(portM4, sessionCookie, csrf, {
    RESEND_API_KEY: 're_TestFormat', MAIL_FROM: 'admin@beispiel.hu',
  });
  pruefe('M4-1 MAIL_FROM ohne Klammern → 400', rKlammern.status === 400, `status=${rKlammern.status}`);

  // MAIL_FROM mit gueltiger beliebiger Domain (nicht nur resend.dev)
  const rEigen = await postSchritt3(portM4, sessionCookie, csrf, {
    RESEND_API_KEY: 're_TestFormat', MAIL_FROM: 'Plattform <noreply@plattform.hu>',
  });
  pruefe('M4-2 Gegenprobe: MAIL_FROM mit eigener Domain → 303', rEigen.status === 303, `status=${rEigen.status}`);

  await stop(p); aufraeumen(tmpM4);
}

// ======================================================================
abschnitt('M5: POST aktion=ohne_mail → fertig, weiter zu Schritt 4');
let tmpM5, portM5 = 19385;
{
  tmpM5 = mkdtempSync(join(tmpdir(), 'wp7-m5-'));
  mkdirSync(join(tmpM5, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpM5, portM5);
  const { sessionCookie, csrf } = await einloggenUndCsrf3(portM5);

  const r = await postSchritt3(portM5, sessionCookie, csrf, { aktion: 'ohne_mail' });
  pruefe('M5-1 ohne_mail → 303 zu /schritt/4', r.status === 303 && (r.headers['location'] ?? '').includes('/schritt/4'), `status=${r.status} loc=${r.headers['location']}`);

  const dbM5 = new DatabaseSync(join(tmpM5, 'app.db'), { readOnly: true });
  const stepM5 = dbM5.prepare("SELECT wert FROM einstellungen WHERE schluessel='einrichtung_schritt_3'").get();
  const keyM5 = dbM5.prepare("SELECT wert FROM einstellungen WHERE schluessel='RESEND_API_KEY'").get();
  dbM5.close();
  pruefe('M5-2 Schritt 3 als fertig markiert', stepM5?.wert === 'fertig', `wert=${stepM5?.wert}`);
  pruefe('M5-3 Kein RESEND_API_KEY gespeichert', !keyM5, `keyRow=${JSON.stringify(keyM5)}`);

  await stop(p); aufraeumen(tmpM5);
}

// ======================================================================
abschnitt('M6: POST aktion=key_loeschen → Key weg, Schritt entmarkiert');
let tmpM6, portM6 = 19386;
{
  tmpM6 = mkdtempSync(join(tmpdir(), 'wp7-m6-'));
  mkdirSync(join(tmpM6, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpM6, portM6);
  const { sessionCookie, csrf } = await einloggenUndCsrf3(portM6);

  // Erst Key speichern
  await postSchritt3(portM6, sessionCookie, csrf, {
    RESEND_API_KEY: 're_zuLoeschen', MAIL_FROM: 'Test <t@ex.com>',
  });

  // Frischen CSRF von Schritt 3 holen
  const { csrf: csrf2, sessionCookie: sc2 } = await einloggenUndCsrf3(portM6);
  const r = await postSchritt3(portM6, sc2, csrf2, { aktion: 'key_loeschen' });
  pruefe('M6-1 key_loeschen → 303 zurück zu /schritt/3', r.status === 303 && (r.headers['location'] ?? '').includes('/schritt/3'), `status=${r.status} loc=${r.headers['location']}`);

  const dbM6 = new DatabaseSync(join(tmpM6, 'app.db'), { readOnly: true });
  const keyM6 = dbM6.prepare("SELECT wert FROM einstellungen WHERE schluessel='RESEND_API_KEY'").get();
  const stepM6 = dbM6.prepare("SELECT wert FROM einstellungen WHERE schluessel='einrichtung_schritt_3'").get();
  dbM6.close();
  pruefe('M6-2 RESEND_API_KEY aus DB geloescht', !keyM6, `keyRow=${JSON.stringify(keyM6)}`);
  pruefe('M6-3 Schritt 3 nicht mehr als fertig markiert', !stepM6 || stepM6.wert !== 'fertig', `wert=${stepM6?.wert}`);

  // GET nach Loeschen: kein Schluessel-loeschen-Button mehr
  const { schritt3Html: htmlNach } = await einloggenUndCsrf3(portM6);
  pruefe('M6-4 Gegenprobe: nach Loeschen kein key_loeschen-Button', !htmlNach.includes('value="key_loeschen"'), htmlNach.slice(0, 400));

  await stop(p); aufraeumen(tmpM6);
}

// ======================================================================
abschnitt('M7: POST /mail-test — Mock-Integration');
let tmpM7, portM7 = 19387;
{
  tmpM7 = mkdtempSync(join(tmpdir(), 'wp7-m7-'));
  mkdirSync(join(tmpM7, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpM7, portM7);
  const { sessionCookie, csrf } = await einloggenUndCsrf3(portM7);

  // Key + MAIL_FROM speichern, damit /mail-test funktioniert
  await postSchritt3(portM7, sessionCookie, csrf, {
    RESEND_API_KEY: 're_MockTestKey', MAIL_FROM: 'Mock <mock@test.hu>',
  });
  const { sessionCookie: sc7, csrf: csrf7 } = await einloggenUndCsrf3(portM7);

  // M7-1: Mock OK → {ok:true}
  mockAnfragen = [];
  mockAntwortFn = () => ({ status: 200, body: { id: 'sent_1' } });
  const rOk = await postMailTest(portM7, sc7, csrf7, { testEmpfaenger: 'empfaenger@test.hu' });
  let dOk;
  try { dOk = JSON.parse(rOk.text); } catch { dOk = {}; }
  pruefe('M7-1 Mock OK → HTTP 200', rOk.status === 200, `status=${rOk.status} body=${rOk.text.slice(0,100)}`);
  pruefe('M7-2 Mock OK → {ok:true} in Antwort', dOk.ok === true, `body=${rOk.text.slice(0,100)}`);
  pruefe('M7-3 Mock OK → meldung in Antwort', typeof dOk.meldung === 'string' && dOk.meldung.length > 0, `meldung='${dOk.meldung}'`);

  // M7-4: Idempotency-Key wurde gesendet (im Mock-Request vorhanden)
  pruefe('M7-4 Idempotency-Key im Mock-Request enthalten', mockAnfragen.length > 0 && !!mockAnfragen[0].idempotencyKey, `idKey=${mockAnfragen[0]?.idempotencyKey}`);

  // M7-5: Genau ein Request an Mock (kein Retry)
  pruefe('M7-5 Genau ein Request an Mock (kein Retry)', mockAnfragen.length === 1, `anfragen=${mockAnfragen.length}`);
  pruefe('M7-12 Klartext-Schluessel nicht in HTTP-Antwort', !rOk.text.includes('re_MockTestKey'), `body=${rOk.text.slice(0,200)}`);

  // M7-9: POST /mail-test ohne CSRF → 403
  const rNoCSRF = await holen(portM7, '/admin/einrichtung/mail-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': 'ungueltig00000000000000000000000000000000000000000000000000000000', Cookie: sc7 },
    body: JSON.stringify({ testEmpfaenger: 'x@test.hu' }),
  });
  pruefe('M7-9 Falscher CSRF → 403', rNoCSRF.status === 403, `status=${rNoCSRF.status}`);

  // M7-10: POST /mail-test ohne Empfaenger → 400
  mockAnfragen = [];
  mockAntwortFn = () => ({ status: 200, body: { id: 'x' } });
  const rNoTo = await postMailTest(portM7, sc7, csrf7, {});
  pruefe('M7-10 Kein Empfaenger → 400', rNoTo.status === 400, `status=${rNoTo.status}`);
  pruefe('M7-11 Kein Empfaenger → kein Mock-Request (kein Netzwerkaufruf)', mockAnfragen.length === 0, `anfragen=${mockAnfragen.length}`);

  await stop(p); aufraeumen(tmpM7);
}

// ======================================================================
abschnitt('M7-13+14: /mail-test ohne Key/MAIL_FROM in DB, Normalbetrieb');
let tmpM13, portM13 = 19388;
{
  tmpM13 = mkdtempSync(join(tmpdir(), 'wp7-m13-'));
  mkdirSync(join(tmpM13, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpM13, portM13);
  const { sessionCookie: sc13, csrf: csrf13 } = await einloggenUndCsrf3(portM13);

  // M7-13: /mail-test ohne Key in DB → 400 fehler:kein_schluessel
  mockAnfragen = [];
  const rNoKey = await postMailTest(portM13, sc13, csrf13, { testEmpfaenger: 'x@test.hu' });
  let dNoKey; try { dNoKey = JSON.parse(rNoKey.text); } catch { dNoKey = {}; }
  pruefe('M7-13 Kein Key in DB → 400 {fehler:kein_schluessel}', rNoKey.status === 400 && dNoKey.fehler === 'kein_schluessel', `status=${rNoKey.status} body=${rNoKey.text.slice(0,100)}`);

  // Key speichern, MAIL_FROM absichtlich weglassen → kein_absender
  const { sessionCookie: scSave, csrf: csrfSave } = await einloggenUndCsrf3(portM13);
  await postSchritt3(portM13, scSave, csrfSave, { RESEND_API_KEY: 're_NurKey', MAIL_FROM: 'Test <t@t.com>' });
  // MAIL_FROM direkt aus DB loeschen
  const dbDel = new DatabaseSync(join(tmpM13, 'app.db'));
  dbDel.prepare("DELETE FROM einstellungen WHERE schluessel='MAIL_FROM'").run();
  dbDel.close();

  const { sessionCookie: sc13b, csrf: csrf13b } = await einloggenUndCsrf3(portM13);
  const rNoFrom = await postMailTest(portM13, sc13b, csrf13b, { testEmpfaenger: 'x@test.hu' });
  let dNoFrom; try { dNoFrom = JSON.parse(rNoFrom.text); } catch { dNoFrom = {}; }
  pruefe('M7-14 Kein MAIL_FROM in DB → 400 {fehler:kein_absender}', rNoFrom.status === 400 && dNoFrom.fehler === 'kein_absender', `status=${rNoFrom.status} body=${rNoFrom.text.slice(0,100)}`);

  await stop(p); aufraeumen(tmpM13);
}

// ======================================================================
abschnitt('M7-6: Mock 401 → schluessel_abgelehnt (frischer Server)');
let tmpM76, portM76 = 19392;
{
  tmpM76 = mkdtempSync(join(tmpdir(), 'wp7-m76-'));
  mkdirSync(join(tmpM76, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpM76, portM76);
  const { sessionCookie: sc76a, csrf: csrf76a } = await einloggenUndCsrf3(portM76);
  await postSchritt3(portM76, sc76a, csrf76a, { RESEND_API_KEY: 're_Test401', MAIL_FROM: 'Test <t@ex.com>' });
  const { sessionCookie: sc76, csrf: csrf76 } = await einloggenUndCsrf3(portM76);
  mockAnfragen = [];
  mockAntwortFn = () => ({ status: 401, body: { name: 'missing_api_key' } });
  const r401 = await postMailTest(portM76, sc76, csrf76, { testEmpfaenger: 'x@test.hu' });
  let d401; try { d401 = JSON.parse(r401.text); } catch { d401 = {}; }
  pruefe('M7-6 Mock 401 → {fehler:schluessel_abgelehnt}', d401.fehler === 'schluessel_abgelehnt', `body=${r401.text.slice(0,100)}`);
  await stop(p); aufraeumen(tmpM76);
}

// ======================================================================
abschnitt('M7-7: Mock 403 → absender_abgelehnt (frischer Server)');
let tmpM77, portM77 = 19393;
{
  tmpM77 = mkdtempSync(join(tmpdir(), 'wp7-m77-'));
  mkdirSync(join(tmpM77, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpM77, portM77);
  const { sessionCookie: sc77a, csrf: csrf77a } = await einloggenUndCsrf3(portM77);
  await postSchritt3(portM77, sc77a, csrf77a, { RESEND_API_KEY: 're_Test403', MAIL_FROM: 'Test <t@ex.com>' });
  const { sessionCookie: sc77, csrf: csrf77 } = await einloggenUndCsrf3(portM77);
  mockAnfragen = [];
  mockAntwortFn = () => ({ status: 403, body: { name: 'validation_error' } });
  const r403 = await postMailTest(portM77, sc77, csrf77, { testEmpfaenger: 'x@test.hu' });
  let d403; try { d403 = JSON.parse(r403.text); } catch { d403 = {}; }
  pruefe('M7-7 Mock 403 → {fehler:absender_abgelehnt}', d403.fehler === 'absender_abgelehnt', `body=${r403.text.slice(0,100)}`);
  await stop(p); aufraeumen(tmpM77);
}

// ======================================================================
abschnitt('M7-8: Mock 429 → limit_erreicht (frischer Server)');
let tmpM78, portM78 = 19394;
{
  tmpM78 = mkdtempSync(join(tmpdir(), 'wp7-m78-'));
  mkdirSync(join(tmpM78, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpM78, portM78);
  const { sessionCookie: sc78a, csrf: csrf78a } = await einloggenUndCsrf3(portM78);
  await postSchritt3(portM78, sc78a, csrf78a, { RESEND_API_KEY: 're_Test429', MAIL_FROM: 'Test <t@ex.com>' });
  const { sessionCookie: sc78, csrf: csrf78 } = await einloggenUndCsrf3(portM78);
  mockAnfragen = [];
  mockAntwortFn = () => ({ status: 429, body: { name: 'rate_limit_exceeded' }, retryAfter: 5 });
  const r429 = await postMailTest(portM78, sc78, csrf78, { testEmpfaenger: 'x@test.hu' });
  let d429; try { d429 = JSON.parse(r429.text); } catch { d429 = {}; }
  pruefe('M7-8 Mock 429 → {fehler:limit_erreicht}', d429.fehler === 'limit_erreicht', `body=${r429.text.slice(0,100)}`);
  await stop(p); aufraeumen(tmpM78);
}

// ======================================================================
abschnitt('M7-15+16: timeout und netzwerk_fehler (Unit-Ebene ueber fetchFn)');
{
  // Direkte mailTesten-Importe vermeiden Wartezeit von 10 Sekunden bei Timeout-Test.
  const { mailTesten } = await import(pathToFileURL(resolve('mail.mjs')).href);

  // AbortError → {fehler:'timeout'}
  const rTimeout = await mailTesten({
    apiKey: 're_unit', from: 'T <t@t.com>', to: 'x@x.com',
    idempotencyKey: 'unit-timeout-test',
    fetchFn: () => new Promise((_, reject) => {
      const e = new Error('simulated abort'); e.name = 'AbortError'; reject(e);
    }),
  });
  pruefe('M7-15 AbortError → {fehler:timeout}', rTimeout.fehler === 'timeout', `ergebnis=${JSON.stringify(rTimeout)}`);

  // Netzwerkfehler (ECONNREFUSED) → {fehler:'netzwerk_fehler'}
  const rNetz = await mailTesten({
    apiKey: 're_unit', from: 'T <t@t.com>', to: 'x@x.com',
    idempotencyKey: 'unit-netz-test',
    fetchFn: () => Promise.reject(new Error('ECONNREFUSED')),
  });
  pruefe('M7-16 ECONNREFUSED → {fehler:netzwerk_fehler}', rNetz.fehler === 'netzwerk_fehler', `ergebnis=${JSON.stringify(rNetz)}`);
}

// ======================================================================
abschnitt('M7-17+18: eingabe_fehler fuer HTTP 400/422 (Unit-Ebene)');
{
  const { mailTesten: mtUnit } = await import(pathToFileURL(resolve('mail.mjs')).href);

  const r400 = await mtUnit({
    apiKey: 're_unit', from: 'T <t@t.com>', to: 'x@x.com',
    fetchFn: () => Promise.resolve({ ok: false, status: 400, headers: { get: () => null } }),
  });
  pruefe('M7-17 HTTP 400 → {fehler:eingabe_fehler}', r400.fehler === 'eingabe_fehler', `ergebnis=${JSON.stringify(r400)}`);

  const r422 = await mtUnit({
    apiKey: 're_unit', from: 'T <t@t.com>', to: 'x@x.com',
    fetchFn: () => Promise.resolve({ ok: false, status: 422, headers: { get: () => null } }),
  });
  pruefe('M7-18 HTTP 422 → {fehler:eingabe_fehler}', r422.fehler === 'eingabe_fehler', `ergebnis=${JSON.stringify(r422)}`);
}

// ======================================================================
abschnitt('M8: EINSTELLUNGEN_SCHLUESSEL gesetzt → kein .hauptschluessel-File, Key nach Neustart lesbar');
let tmpM8, portM8 = 19389;
const TEST_ENV_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // Buffer.alloc(32).toString('base64')
{
  tmpM8 = mkdtempSync(join(tmpdir(), 'wp7-m8-'));
  mkdirSync(join(tmpM8, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpM8, portM8, { EINSTELLUNGEN_SCHLUESSEL: TEST_ENV_KEY });
  pruefe('M8-1 Server gestartet mit EINSTELLUNGEN_SCHLUESSEL', p.exitCode === null);

  const { sessionCookie, csrf } = await einloggenUndCsrf3(portM8);
  const rSave = await postSchritt3(portM8, sessionCookie, csrf, {
    RESEND_API_KEY: 're_UmgebungsTest', MAIL_FROM: 'Test <t@ex.com>',
  });
  pruefe('M8-2 Key speichern → 303', rSave.status === 303, `status=${rSave.status}`);
  // Gegenprobe: alter Code (env:{}) wuerde .hauptschluessel anlegen; neuer Code nicht
  pruefe('M8-3 Gegenprobe: keine .hauptschluessel-Datei angelegt', !existsSync(join(tmpM8, 'daten', '.hauptschluessel')), 'Datei existiert!');

  await stop(p);

  const { p: p2 } = await starteServer(tmpM8, portM8, { EINSTELLUNGEN_SCHLUESSEL: TEST_ENV_KEY });
  pruefe('M8-4 Neustart mit demselben Umgebungsschluessel erfolgreich', p2.exitCode === null);
  const { schritt3Html: html8 } = await einloggenUndCsrf3(portM8);
  pruefe('M8-5 Nach Neustart: maskierter Key sichtbar (Umgebungsschluessel entschluesselt)', html8.includes('re_••••') || html8.includes('key_maskiert') || html8.includes('gespeichert'), html8.slice(0, 300));
  await stop(p2); aufraeumen(tmpM8);
}

// ======================================================================
abschnitt('M9: E-Mail-Validierung und Abklingzeit (testEmpfaenger)');
let tmpM9, portM9 = 19390;
{
  tmpM9 = mkdtempSync(join(tmpdir(), 'wp7-m9-'));
  mkdirSync(join(tmpM9, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpM9, portM9);
  const { sessionCookie: sc9a, csrf: csrf9a } = await einloggenUndCsrf3(portM9);
  await postSchritt3(portM9, sc9a, csrf9a, { RESEND_API_KEY: 're_RateTest', MAIL_FROM: 'Test <t@ex.com>' });
  const { sessionCookie: sc9, csrf: csrf9 } = await einloggenUndCsrf3(portM9);

  // M9-1: ungueltige Adresse → 400
  const rUngueltig = await postMailTest(portM9, sc9, csrf9, { testEmpfaenger: 'kein-at-zeichen' });
  pruefe('M9-1 Ungueltige Adresse → 400', rUngueltig.status === 400, `status=${rUngueltig.status}`);

  // M9-2: zwei Adressen → 400
  const rZwei = await postMailTest(portM9, sc9, csrf9, { testEmpfaenger: 'a@a.com, b@b.com' });
  pruefe('M9-2 Zwei Adressen → 400', rZwei.status === 400, `status=${rZwei.status}`);

  // M9-3: erste gueltige Anfrage durch Rate-Limiter → 200
  mockAnfragen = [];
  mockAntwortFn = () => ({ status: 200, body: { id: 'x' } });
  const rErst = await postMailTest(portM9, sc9, csrf9, { testEmpfaenger: 'empf@test.hu' });
  pruefe('M9-3 Erste gueltige Anfrage → 200', rErst.status === 200, `status=${rErst.status}`);

  // M9-4: sofortige zweite Anfrage → 429 {fehler:'limit'}
  // Gegenprobe: ohne Abklingzeit waere status 200
  const rLimit = await postMailTest(portM9, sc9, csrf9, { testEmpfaenger: 'empf@test.hu' });
  let dLimit; try { dLimit = JSON.parse(rLimit.text); } catch { dLimit = {}; }
  pruefe('M9-4 Sofortige zweite Anfrage → 429 {fehler:limit}', rLimit.status === 429 && dLimit.fehler === 'limit', `status=${rLimit.status} body=${rLimit.text.slice(0, 100)}`);

  await stop(p); aufraeumen(tmpM9);
}

// ======================================================================
abschnitt('M10: aktion=ohne_mail loescht Key und MAIL_FROM');
let tmpM10, portM10 = 19391;
{
  tmpM10 = mkdtempSync(join(tmpdir(), 'wp7-m10-'));
  mkdirSync(join(tmpM10, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpM10, portM10);
  const { sessionCookie: sc10a, csrf: csrf10a } = await einloggenUndCsrf3(portM10);

  await postSchritt3(portM10, sc10a, csrf10a, { RESEND_API_KEY: 're_OhneMailTest', MAIL_FROM: 'Test <t@ex.com>' });
  const dbPre = new DatabaseSync(join(tmpM10, 'app.db'), { readOnly: true });
  const keyPre = dbPre.prepare("SELECT wert FROM einstellungen WHERE schluessel='RESEND_API_KEY'").get();
  const fromPre = dbPre.prepare("SELECT wert FROM einstellungen WHERE schluessel='MAIL_FROM'").get();
  dbPre.close();
  pruefe('M10-1 Key + MAIL_FROM gespeichert (Vorbedingung)', !!keyPre && !!fromPre, `key=${!!keyPre} from=${!!fromPre}`);

  const { sessionCookie: sc10b, csrf: csrf10b } = await einloggenUndCsrf3(portM10);
  const rOhne = await postSchritt3(portM10, sc10b, csrf10b, { aktion: 'ohne_mail' });
  pruefe('M10-2 ohne_mail → 303 zu /schritt/4', rOhne.status === 303 && (rOhne.headers['location'] ?? '').includes('/schritt/4'), `status=${rOhne.status} loc=${rOhne.headers['location']}`);

  const dbNach = new DatabaseSync(join(tmpM10, 'app.db'), { readOnly: true });
  const keyNach = dbNach.prepare("SELECT wert FROM einstellungen WHERE schluessel='RESEND_API_KEY'").get();
  const fromNach = dbNach.prepare("SELECT wert FROM einstellungen WHERE schluessel='MAIL_FROM'").get();
  dbNach.close();
  // Gegenprobe: ohne Fix waere keyNach noch vorhanden
  pruefe('M10-3 Gegenprobe: RESEND_API_KEY geloescht', !keyNach, `keyRow=${JSON.stringify(keyNach)}`);
  pruefe('M10-4 MAIL_FROM geloescht', !fromNach, `fromRow=${JSON.stringify(fromNach)}`);

  await stop(p); aufraeumen(tmpM10);
}

// ======================================================================
// Mock-Server beenden
mockServer.close();

console.log('');
if (schlecht === 0) {
  console.log(`WP7 Mail (Nachbesserung 1): alle ${ok} Pruefungen bestanden.`);
  process.exit(0);
} else {
  console.log(`WP7 Mail (Nachbesserung 1): ${schlecht} Fehler, ${ok} bestanden.`);
  process.exit(1);
}
