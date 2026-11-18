// Automatischer Selbsttest fuer WP3 Sicherheitsblock: geschuetzter Erststart mit Einmal-Einrichtungscode.
// Pruefungen C1-C12 aus docs/SPEZ-WP1-3-SICHERHEITSBLOCK.md. Polling statt fester Wartezeit (keine Zeitabhaengigkeit).
// Wichtig: positive Testfaelle (C7/C2) mit gueltigem Code laufen in frischen Server-Instanzen, damit Fehlversuch-Sperren
// von anderen Testfaellen sie nicht verhindern.
import './test-sprache.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let ok = 0, schlecht = 0;
const pruefe = (name, bedingung, detail = '') => { bedingung ? ok++ : schlecht++; console.log(`${bedingung ? 'OK     ' : 'FEHLER '} ${name}${!bedingung && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = (pfad) => { try { rmSync(pfad, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } };

const SERVER = resolve('server.mjs');
const basisEnv = (extra) => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...extra });

// Lese-Helfer: setzt busy_timeout, wiederholt bis zu 3x bei SQLITE_BUSY/locked (Test-Problem, nicht Server-Problem).
async function lies(dbPfad, sql, ...args) {
  let letzter;
  for (let i = 0; i < 3; i++) {
    const d = new DatabaseSync(dbPfad, { readOnly: true });
    try {
      d.exec('PRAGMA busy_timeout = 5000');
      return d.prepare(sql).all(...args);
    } catch (e) { letzter = e; if (e?.errcode !== 5) throw e; }
    finally { try { d.close(); } catch { /* ignore */ } }
    await warte(200);
  }
  throw letzter;
}
// Convenience: erste Zeile (oder null).
async function liesEine(dbPfad, sql, ...args) {
  const rows = await lies(dbPfad, sql, ...args);
  return rows[0] || null;
}

async function starteServer(tempordner, port, zusaetzlich = {}) {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    cwd: tempordner,
    env: basisEnv({ PORT: String(port), DB_DATEI: join(tempordner, 'app.db'), EINRICHTUNGSMODUS: '1', ...zusaetzlich }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  p.stdout.on('data', (x) => { log += x; });
  p.stderr.on('data', (x) => { log += x; });
  for (let i = 0; i < 300; i++) {
    if (/Setup-Modus|Einrichtungsmodus|Schulungsplattform läuft|fehlerhaft/.test(log)) break;
    if (p.exitCode !== null) break;
    try { const r = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null); if (r && r.status) break; } catch { /* noch nicht */ }
    await warte(200);
  }
  return { p, log: () => log };
}

async function stop(p) {
  p.kill('SIGTERM');
  await new Promise((r) => { if (p.exitCode !== null) r(); else { p.on('exit', r); setTimeout(() => { try { p.kill('SIGKILL'); } catch {}; r(); }, 10000); } });
}

async function holen(port, pfad, { method = 'GET', headers = {}, body = null } = {}) {
  const init = { method, headers: { Accept: 'text/html', ...headers }, redirect: 'manual' };
  if (body !== null) init.body = body;
  const a = await fetch(`http://127.0.0.1:${port}${pfad}`, init);
  const bytes = Buffer.from(await a.arrayBuffer());
  const text = bytes.toString('utf8');
  return { status: a.status, bytes, text, length: Buffer.byteLength(text), headers: Object.fromEntries(a.headers) };
}

function gleicheFehlerantwort(name, a, b) {
  pruefe(name + ': Status 400', a.status === 400 && b.status === 400);
  pruefe(name + ': byte-identischer Body', a.bytes.equals(b.bytes));
  pruefe(name + ': Content-Type HTML identisch', a.headers['content-type'] === 'text/html; charset=utf-8' && a.headers['content-type'] === b.headers['content-type']);
  pruefe(name + ': Content-Length identisch und korrekt', a.headers['content-length'] === b.headers['content-length'] && a.headers['content-length'] === String(a.bytes.length) && b.headers['content-length'] === String(b.bytes.length));
}

function codeAusDatei(ord) {
  const pfad = join(ord, 'daten', 'ERSTSTART.txt');
  return existsSync(pfad) ? readFileSync(pfad, 'utf8').trim() : null;
}

function form(c, e, p) { return new URLSearchParams({ code: c, email: e, passwort: p }).toString(); }
const FALSCHER_CODE = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX';

// =====================================================================================================
abschnitt('Vorbereitung: Setup-Modus-Server starten, Code lesen, Format pruefen (kein Fehlversuch!)');
const T = mkdtempSync(join(tmpdir(), 'wp3-vor-'));
const PORT = 4431;
const { p: p1, log: log1 } = await starteServer(T, PORT);
pruefe('Setup-Modus-Server gestartet', /Setup-Modus/.test(log1()));
const code = codeAusDatei(T);
pruefe('ERSTSTART.txt vorhanden und enthaelt formatierten Code (8 Gruppen à 4, Alphabet)', code && /^[2-9ABCDEFGHJKLMNPQRSTUVWXYZ]{4}(-[2-9ABCDEFGHJKLMNPQRSTUVWXYZ]{4}){7}$/.test(code), code || '<leer>');

abschnitt('C9 Headers no-store + no-referrer auf GET /einrichtung');
{
  const g = await holen(PORT, '/einrichtung');
  pruefe('GET /einrichtung: 200', g.status === 200);
  pruefe('GET /einrichtung: Cache-Control no-store', (g.headers['cache-control'] || '').includes('no-store'));
  pruefe('GET /einrichtung: Referrer-Policy no-referrer', (g.headers['referrer-policy'] || '').includes('no-referrer'));
}

abschnitt('C5 Vor-Pruefung: in der DB steht KEIN Klartext-Code');
{
  const roh = readFileSync(join(T, 'app.db'));
  const codeOhneTrenner = code.replace(/-/g, '');
  pruefe('C5: DB enthaelt den Code weder formatiert noch ohne Trenner', !roh.includes(Buffer.from(code, 'utf8')) && !roh.includes(Buffer.from(codeOhneTrenner, 'utf8')));
  pruefe('C5: Code taucht im Server-Log genau einmal auf (die eine Konsolenzeile)', (log1().split(code).length - 1) === 1);
}
await stop(p1);
aufraeumen(T);

// =====================================================================================================
abschnitt('C7 Mit GUELTIGEM Code aber schwachem Passwort / falscher Mail -> Formular mit Fehlertext');
{
  const t = mkdtempSync(join(tmpdir(), 'wp3-c7-'));
  const port = 4432;
  const { p, log } = await starteServer(t, port);
  pruefe('C7: Setup-Modus startet', /Setup-Modus/.test(log()));
  const code7 = codeAusDatei(t);
  try {
    const a = await holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(code7, 'admin@beispiel.hu', 'kurz') });
    pruefe('C7 Passwort kurz: 400 mit Formular', a.status === 400 && /Passwort/i.test(a.text), 'status=' + a.status + ' text=' + a.text.slice(0, 120));
    const b = await holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(code7, 'keine-mail', 'einLangesPasswort12345') });
    pruefe('C7 Mail ungueltig: 400 mit Formular', b.status === 400 && /E-?Mail/i.test(b.text));
    const zeile = await liesEine(join(t, 'app.db'), 'SELECT 1 AS da FROM einrichtungs_token WHERE id=1');
    const nAdmin = (await liesEine(join(t, 'app.db'), "SELECT COUNT(*) AS n FROM benutzer WHERE rolle='admin'")).n;
    pruefe('C7: Einrichtungscode-Zeile bleibt gueltig (nicht verbraucht)', !!zeile);
    pruefe('C7: Kein Admin-Konto wurde angelegt', nAdmin === 0);
  } finally { await stop(p); aufraeumen(t); }
}

// =====================================================================================================
abschnitt('C2 Gueltiger Code legt EIN Admin-Konto an + ADMIN_ERSTELLT + Token/Datei weg; zweiter POST neutral');
const TC2 = mkdtempSync(join(tmpdir(), 'wp3-c2-'));
const PORT_C2 = 4433;
const { p: pC2, log: logC2 } = await starteServer(TC2, PORT_C2);
const codeC2 = codeAusDatei(TC2);
pruefe('C2: Setup-Modus startet', /Setup-Modus/.test(logC2()));
{
  const r = await holen(PORT_C2, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(codeC2, 'admin@beispiel.hu', 'passwort12345') });
  pruefe('C2: Hinweisseite 200 nach erfolgreichem POST', r.status === 200 && r.text.includes('Konto erstellt'), 'status=' + r.status);
  const nAdmin = (await liesEine(join(TC2, 'app.db'), "SELECT COUNT(*) AS n FROM benutzer WHERE rolle='admin'")).n;
  const zustand = (await liesEine(join(TC2, 'app.db'), "SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'"))?.wert;
  const tokenZeile = await liesEine(join(TC2, 'app.db'), 'SELECT 1 AS da FROM einrichtungs_token WHERE id=1');
  pruefe('C2: genau 1 Admin-Konto', nAdmin === 1);
  pruefe('C2: instanz_zustand=ADMIN_ERSTELLT', zustand === 'ADMIN_ERSTELLT');
  pruefe('C2: Token-Zeile geloescht', !tokenZeile);
  pruefe('C2: ERSTSTART.txt geloescht nach Abschluss', !existsSync(join(TC2, 'daten', 'ERSTSTART.txt')));
  const r2 = await holen(PORT_C2, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(codeC2, 'admin2@beispiel.hu', 'passwort12345') });
  // Zweiter POST: Server ist noch im Setup-Modus-Prozess (Modus wird beim Start festgelegt), Code aber ungueltig (Token-Zeile weg) -> neutrale Fehlerantwort
  pruefe('C2: zweiter POST mit demselben Code -> neutral (nicht 303), ohne Codewiedergabe', r2.status === 400 && !r2.text.includes(codeC2));
  const rAnm = await holen(PORT_C2, '/anmelden');
  pruefe('C2: GET /anmelden im Setup-Modus -> 200 Hinweisseite', rAnm.status === 200 && rAnm.text.includes('Konto erstellt'), 'status=' + rAnm.status);
}
await stop(pC2);

abschnitt('C4 Nach Abschluss: Neustart -> Einrichtungsmodus, /einrichtung 404, kein neuer Code');
{
  const { p: p2, log: log2 } = await starteServer(TC2, PORT_C2 + 1, { EINRICHTUNGSMODUS: '0' });
  try {
    pruefe('C4: Neustart -> Einrichtungsmodus', /Einrichtungsmodus/.test(log2()));
    const g = await holen(PORT_C2 + 1, '/einrichtung');
    pruefe('C4: GET /einrichtung -> 404', g.status === 404);
    const pF = await holen(PORT_C2 + 1, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(codeC2, 'x@y.hu', 'passwort12345') });
    pruefe('C4: POST /einrichtung (mit altem Code) -> 404', pF.status === 404);
    pruefe('C4: ERSTSTART.txt bleibt geloescht', !existsSync(join(TC2, 'daten', 'ERSTSTART.txt')));
    pruefe('C4: Neustart erzeugt KEINE neue Einrichtungscode-Konsolenzeile', !/Einrichtungscode/.test(log2()));
  } finally { await stop(p2); }
}

abschnitt('A7-echt: Einrichtungsmodus - Admin kann sich mit E-Mail+Passwort anmelden und sieht /admin/einrichtung Platzhalter');
{
  const { p: p3, log: log3 } = await starteServer(TC2, PORT_C2 + 2, { EINRICHTUNGSMODUS: '0' });
  try {
    pruefe('A7: Einrichtungsmodus startet', /Einrichtungsmodus/.test(log3()));
    const g = await holen(PORT_C2 + 2, '/anmelden');
    pruefe('A7: GET /anmelden -> 200', g.status === 200);
    const falsch = await holen(PORT_C2 + 2, '/anmelden', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'admin@beispiel.hu', passwort: 'falsch_falsch_falsch' }).toString() });
    pruefe('A7: POST /anmelden mit falschem Passwort -> 401', falsch.status === 401);
    const r = await holen(PORT_C2 + 2, '/anmelden', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'admin@beispiel.hu', passwort: 'passwort12345' }).toString() });
    pruefe('A7: POST /anmelden richtig -> 303 /admin/einrichtung', r.status === 303 && (r.headers['location'] || '') === '/admin/einrichtung');
    const cookie = String(r.headers['set-cookie'] || '').split(';')[0];
    pruefe('A7: Set-Cookie vorhanden', cookie.length > 10);
    const ohne = await holen(PORT_C2 + 2, '/admin/einrichtung');
    pruefe('A7: /admin/einrichtung ohne Cookie -> 303 /anmelden', ohne.status === 303 && (ohne.headers['location'] || '') === '/anmelden');
    const mit = await holen(PORT_C2 + 2, '/admin/einrichtung', { headers: { Cookie: cookie } });
    pruefe('A7: /admin/einrichtung mit Cookie -> 200 Einrichtungsgeruest', mit.status === 200 && /admin\/einrichtung\/schritt/.test(mit.text), 'status=' + mit.status + ' text=' + mit.text.slice(0, 200));
  } finally { await stop(p3); }
}
aufraeumen(TC2);

// =====================================================================================================
abschnitt('C1 Identische Fehlerantwort bei falschem/leerem/vertauschtem Code');
{
  const t = mkdtempSync(join(tmpdir(), 'wp3-c1-'));
  const port = 4435;
  const { p, log } = await starteServer(t, port);
  pruefe('C1: Setup-Modus startet', /Setup-Modus/.test(log()));
  try {
    const a = await holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(FALSCHER_CODE, 'x@y.hu', 'passwort12345') });
    const b = await holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form('', 'x@y.hu', 'passwort12345') });
    const c = await holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form('ANDRS-FALSCHER', 'x@y.hu', 'passwort12345') });
    gleicheFehlerantwort('C1 falsch/leer', a, b);
    gleicheFehlerantwort('C1 falsch/vertauscht', a, c);
    pruefe('C1: gleiche Statuscodes', a.status === b.status && b.status === c.status);
    pruefe('C1: gleicher Antworttext', a.text === b.text && b.text === c.text);
    pruefe('C1: gleiche Content-Length', a.length === b.length && b.length === c.length);
    pruefe('C1: gestaltete neutrale Fehlerseite', a.status === 400 && a.text.includes('href="/kunde.css"') && a.text.includes('role="alert"'));
  } finally { await stop(p); aufraeumen(t); }
}

// =====================================================================================================
abschnitt('C10 ADMIN_ERSTELLT + EINRICHTUNGSMODUS=1 -> KEIN Setup-Modus, kein Token');
{
  const t = mkdtempSync(join(tmpdir(), 'wp3-c10-'));
  // Erst Setup-Modus -> Admin anlegen, dann Neustart mit Schalter
  const { p: pA, log: logA } = await starteServer(t, 4436);
  const codeA = codeAusDatei(t);
  await holen(4436, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(codeA, 'admin@beispiel.hu', 'passwort12345') });
  await stop(pA);
  const { p: pB, log: logB } = await starteServer(t, 4437, { EINRICHTUNGSMODUS: '1' });
  try {
    pruefe('C10: Server startet im Einrichtungsmodus (nicht Setup)', /Einrichtungsmodus/.test(logB()) && !/Setup-Modus/.test(logB()));
    pruefe('C10: Keine Konsolenzeile Einrichtungscode nach Admin-Erstellung', !/Einrichtungscode/.test(logB()));
    const g = await holen(4437, '/einrichtung');
    pruefe('C10: GET /einrichtung -> 404', g.status === 404);
  } finally { await stop(pB); aufraeumen(t); }
}

// =====================================================================================================
abschnitt('C11 Zwei gleichzeitige Prozesse auf derselben DB erzeugen GENAU EINEN gueltigen Code (3x hintereinander)');
for (let run = 1; run <= 3; run++) {
  const t = mkdtempSync(join(tmpdir(), `wp3-c11-r${run}-`));
  const port1 = 4440 + run * 2, port2 = 4441 + run * 2;
  const p1 = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], { cwd: t, env: basisEnv({ PORT: String(port1), DB_DATEI: join(t, 'app.db'), EINRICHTUNGSMODUS: '1' }), stdio: ['ignore','pipe','pipe'] });
  const p2 = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], { cwd: t, env: basisEnv({ PORT: String(port2), DB_DATEI: join(t, 'app.db'), EINRICHTUNGSMODUS: '1' }), stdio: ['ignore','pipe','pipe'] });
  let logA = '', logB = '';
  p1.stdout.on('data', x => logA += x); p1.stderr.on('data', x => logA += x);
  p2.stdout.on('data', x => logB += x); p2.stderr.on('data', x => logB += x);
  // Beide Prozesse muessen entweder "Setup-Modus" loggen ODER beendet sein, sonst weiter warten.
  for (let i = 0; i < 300; i++) {
    const aStart = /Setup-Modus|fehlerhaft/.test(logA) || p1.exitCode !== null;
    const bStart = /Setup-Modus|fehlerhaft/.test(logB) || p2.exitCode !== null;
    if (aStart && bStart) break;
    await warte(200);
  }
  // Noch kurz auf letzte stdout/stderr-Flushes warten (asynchron), ohne feste Wartezeit.
  await warte(300);
  const a = /Einrichtungscode/.test(logA);
  const b = /Einrichtungscode/.test(logB);
  const aExit = p1.exitCode;
  const bExit = p2.exitCode;
  const konsolenzeilen = (a ? 1 : 0) + (b ? 1 : 0);
  let n = -1, leseFehler = '';
  try { n = (await liesEine(join(t, 'app.db'), 'SELECT COUNT(*) AS n FROM einrichtungs_token')).n; }
  catch (e) { leseFehler = e?.errstr || e?.message || String(e); }
  const diag = (etikett) => `${etikett} run${run}: konsZeilen=${konsolenzeilen}, aExit=${aExit}, bExit=${bExit}, n=${n}, leseFehler=${leseFehler}\n--- logA ---\n${logA.slice(0, 1200)}\n--- logB ---\n${logB.slice(0, 1200)}`;
  pruefe(`C11 Lauf ${run}: GENAU EIN Prozess hat die Einrichtungscode-Konsolenzeile`, konsolenzeilen === 1, diag('K'));
  pruefe(`C11 Lauf ${run}: genau EINE einrichtungs_token-Zeile`, n === 1, diag('Z'));
  await stop(p1); await stop(p2); aufraeumen(t);
}

// =====================================================================================================
abschnitt('C3 Parallel zwei POST mit gueltigem Code: genau EINER gelingt');
{
  const t = mkdtempSync(join(tmpdir(), 'wp3-c3-'));
  const port = 4443;
  const { p, log } = await starteServer(t, port);
  pruefe('C3: Setup-Modus startet', /Setup-Modus/.test(log()));
  try {
    const codeC = codeAusDatei(t);
    const b1 = form(codeC, 'erster@beispiel.hu', 'passwort12345A');
    const b2 = form(codeC, 'zweiter@beispiel.hu', 'passwort12345B');
    const [r1, r2] = await Promise.all([
      holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b1 }),
      holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b2 }),
    ]);
    const erf = [r1, r2].filter(x => x.status === 200).length;
    const neu = [r1, r2].filter(x => x.status === 400).length;
    pruefe('C3: genau 1x 200 und 1x 400', erf === 1 && neu === 1);
    const n = (await liesEine(join(t, 'app.db'), "SELECT COUNT(*) AS n FROM benutzer WHERE rolle='admin'")).n;
    pruefe('C3: genau 1 Admin-Konto in der DB', n === 1);
  } finally { await stop(p); aufraeumen(t); }
}

// =====================================================================================================
abschnitt('C6 5 falsche Codes -> Sperre; richtiger Code danach auch neutrale 400');
{
  const t = mkdtempSync(join(tmpdir(), 'wp3-c6-'));
  const port = 4444;
  const { p, log } = await starteServer(t, port);
  pruefe('C6: Setup-Modus startet', /Setup-Modus/.test(log()));
  try {
    const codeR = codeAusDatei(t);
    let referenz;
    for (let i = 0; i < 5; i++) {
      const antwort = await holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(i === 1 ? '' : FALSCHER_CODE, 'x@y.hu', 'passwort12345') });
      referenz ??= antwort;
      gleicheFehlerantwort('C6 Fehlversuch ' + (i + 1), referenz, antwort);
    }
    for (const code of ['', FALSCHER_CODE]) {
      const gesperrt = await holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(code, 'x@y.hu', 'passwort12345') });
      gleicheFehlerantwort('C6 gesperrt leer/falsch', referenz, gesperrt);
    }
    const r = await holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(codeR, 'admin@beispiel.hu', 'passwort12345') });
    gleicheFehlerantwort('C6 gesperrt richtiger Code', referenz, r);
    pruefe('C6: nach 5 Fehlversuchen: richtiger Code wird abgewiesen (nicht 200)', r.status !== 200);
    const n = (await liesEine(join(t, 'app.db'), "SELECT COUNT(*) AS n FROM benutzer WHERE rolle='admin'")).n;
    pruefe('C6: kein Admin-Konto angelegt waehrend Sperre', n === 0);
  } finally { await stop(p); aufraeumen(t); }
}

// =====================================================================================================
abschnitt('C8 Ablaufzeit: manipulierte DB-Ablaufzeit in der Vergangenheit -> Token ungueltig');
{
  const t = mkdtempSync(join(tmpdir(), 'wp3-c8-'));
  const port = 4445;
  const { p, log } = await starteServer(t, port);
  pruefe('C8: Setup-Modus startet', /Setup-Modus/.test(log()));
  try {
    const codeE = codeAusDatei(t);
    const referenz = await holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form('', 'admin@beispiel.hu', 'passwort12345') });
    const dw = new DatabaseSync(join(t, 'app.db'));
    dw.exec('PRAGMA busy_timeout = 5000');
    dw.prepare('UPDATE einrichtungs_token SET laeuft_ab = ? WHERE id=1').run(Date.now() - 1000);
    dw.close();
    const r = await holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(codeE, 'admin@beispiel.hu', 'passwort12345') });
    gleicheFehlerantwort('C8 leer/abgelaufen', referenz, r);
    pruefe('C8: abgelaufener Code -> neutrale Fehlerantwort (nicht 200)', r.status !== 200);
  } finally { await stop(p); aufraeumen(t); }
}

// =====================================================================================================
abschnitt('C12 X-Forwarded-For ohne TRUST_PROXY: umgeht IP-Sperre nicht (Fehlversuche aus unterschiedlichen IPs)');
{
  const t = mkdtempSync(join(tmpdir(), 'wp3-c12-'));
  const port = 4446;
  const { p, log } = await starteServer(t, port);
  pruefe('C12: Setup-Modus startet', /Setup-Modus/.test(log()));
  try {
    const codeF = codeAusDatei(t);
    for (let i = 0; i < 5; i++) await holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': `9.9.9.${i}` }, body: form(FALSCHER_CODE, 'x@y.hu', 'passwort12345') });
    const r = await holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': '9.9.9.99' }, body: form(codeF, 'admin@beispiel.hu', 'passwort12345') });
    pruefe('C12: gefaelschte X-Forwarded-For umgeht Sperre nicht', r.status !== 200);
  } finally { await stop(p); aufraeumen(t); }
}

console.log(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`);
process.exit(schlecht === 0 ? 0 : 1);
