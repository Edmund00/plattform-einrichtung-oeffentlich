// Selbsttest G1b: Testkauf-Nachweis im Admin NACH der Aktivierung.
// ROT-Phase: testkauf.mjs existiert noch nicht -> dieser Test schlaegt fehl.
import './test-sprache.mjs';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn, spawnSync } from 'node:child_process';

let ok = 0, schlecht = 0;
const pruefe = (name, bed, detail = '') => {
  bed ? ok++ : schlecht++;
  console.log(`${bed ? 'OK     ' : 'FEHLER '} ${name}${!bed && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`);
};
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise(r => setTimeout(r, ms));
const aufraeumen = (d) => { try { rmSync(d, { recursive: true }); } catch { /* egal */ } };

// --- T0: Modul-Import ---
abschnitt('T0: Modul-Import');
let testkaufStatus, setzeTestkaufDb, setzeTestkaufStripeKey;
try {
  const m = await import('../testkauf.mjs');
  testkaufStatus = m.testkaufStatus;
  setzeTestkaufDb = m.setzeTestkaufDb;
  setzeTestkaufStripeKey = m.setzeTestkaufStripeKey;
  pruefe('T0a: testkauf.mjs importierbar', true);
  pruefe('T0b: testkaufStatus ist Funktion', typeof testkaufStatus === 'function');
  pruefe('T0c: setzeTestkaufDb ist Funktion', typeof setzeTestkaufDb === 'function');
  pruefe('T0d: setzeTestkaufStripeKey ist Funktion', typeof setzeTestkaufStripeKey === 'function');
} catch (e) {
  pruefe('T0a: testkauf.mjs importierbar', false, e.message);
  pruefe('T0b: testkaufStatus ist Funktion', false, 'Import fehlgeschlagen');
  pruefe('T0c: setzeTestkaufDb ist Funktion', false, 'Import fehlgeschlagen');
  pruefe('T0d: setzeTestkaufStripeKey ist Funktion', false, 'Import fehlgeschlagen');
  console.log(`\n${schlecht} Test(s) mit Fehlern (Import gescheitert, Unit-Tests uebersprungen)`);
  process.exit(1);
}

// --- Hilfsfunktionen fuer Unit-Tests ---
function baueDb(tmpord, opts = {}) {
  const dbPfad = join(tmpord, 'app.db');
  const d = new DatabaseSync(dbPfad);
  d.exec('PRAGMA journal_mode = WAL');
  d.exec('PRAGMA foreign_keys = ON');
  d.exec(`CREATE TABLE IF NOT EXISTS einstellungen (
    schluessel TEXT PRIMARY KEY, wert TEXT,
    verschluesselt INTEGER NOT NULL DEFAULT 0 CHECK(verschluesselt IN (0,1)),
    iv TEXT, tag TEXT, aktualisiert_am TEXT NOT NULL)`);
  d.exec(`CREATE TABLE IF NOT EXISTS benutzer (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
    passwort_hash TEXT NOT NULL, stripe_kunde TEXT UNIQUE,
    erstellt TEXT NOT NULL, rolle TEXT NOT NULL DEFAULT 'kunde' CHECK(rolle IN ('kunde','admin')))`);
  d.exec(`CREATE TABLE IF NOT EXISTS kurse (
    id INTEGER PRIMARY KEY AUTOINCREMENT, titel TEXT NOT NULL,
    beispiel_key TEXT NULL,
    beschreibung TEXT NOT NULL DEFAULT '', preis_cent INTEGER NOT NULL CHECK(preis_cent >= 0),
    waehrung TEXT NOT NULL DEFAULT 'huf' CHECK(waehrung IN ('huf','eur')),
    status TEXT NOT NULL DEFAULT 'entwurf' CHECK(status IN ('entwurf','veroeffentlicht')),
    erstellt TEXT NOT NULL, geaendert TEXT NOT NULL)`);
  d.exec(`CREATE TABLE IF NOT EXISTS bestellungen (
    id INTEGER PRIMARY KEY AUTOINCREMENT, stripe_sitzung TEXT NOT NULL UNIQUE,
    zahlung_id TEXT, benutzer_id INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    kurs_id INTEGER REFERENCES kurse(id) ON DELETE SET NULL,
    betrag INTEGER NOT NULL CHECK(betrag >= 0), waehrung TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('bezahlt','pruefen','erstattet')),
    grund TEXT, erstellt TEXT NOT NULL, geaendert TEXT NOT NULL)`);
  d.exec(`CREATE TABLE IF NOT EXISTS zugaenge (
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    kurs_id INTEGER NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
    quelle TEXT NOT NULL CHECK(quelle IN ('zahlung','einladung')),
    erstellt TEXT NOT NULL, gueltig_bis INTEGER, UNIQUE(benutzer_id, kurs_id))`);

  const ins = d.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES (?,?,0,datetime('now'))");
  if (opts.marker) ins.run('einrichtung_abgeschlossen_am', opts.marker);

  let benutzerId = null, kursId = null;
  if (opts.mitBenutzer) {
    d.prepare("INSERT OR IGNORE INTO benutzer (email,passwort_hash,erstellt,rolle) VALUES (?,?,datetime('now'),'kunde')").run('kaeufer@test.hu', 'hash');
    benutzerId = d.prepare("SELECT id FROM benutzer WHERE email='kaeufer@test.hu'").get()?.id;
  }
  for (let i = 0; i < (opts.kursAnzahl ?? 0); i++) {
    d.prepare("INSERT INTO kurse (titel,preis_cent,waehrung,status,erstellt,geaendert) VALUES (?,?,?,?,datetime('now'),datetime('now'))").run(`Testkurs ${i + 1}`, 10000, 'huf', 'veroeffentlicht');
  }
  if (opts.kursAnzahl > 0) kursId = d.prepare("SELECT id FROM kurse WHERE status='veroeffentlicht' LIMIT 1").get()?.id;

  for (const o of (opts.bestellungen ?? [])) {
    d.prepare("INSERT INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert) VALUES (?,?,?,?,?,?,?,?,?)").run(
      o.sitzung ?? ('cs_test_' + Math.random().toString(36).slice(2)),
      o.zahlung_id ?? null, o.benutzer_id ?? benutzerId, o.kurs_id ?? kursId,
      o.betrag ?? 10000, o.waehrung ?? 'huf', o.status ?? 'bezahlt', o.erstellt, o.erstellt
    );
  }
  for (const z of (opts.zugaenge ?? [])) {
    d.prepare("INSERT OR IGNORE INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES (?,?,?,datetime('now'),?)").run(
      z.benutzer_id ?? benutzerId, z.kurs_id ?? kursId, z.quelle ?? 'zahlung', z.gueltig_bis ?? null
    );
  }
  d.close();
  return { dbPfad, benutzerId, kursId };
}

function oeffneDb(dbPfad) {
  const d = new DatabaseSync(dbPfad);
  d.exec('PRAGMA busy_timeout=3000');
  return d;
}

const MARKER = '2026-11-15T10:00:00.000Z';
const VOR_MARKER = '2026-11-14T10:00:00.000Z';
const NACH_MARKER = '2026-11-16T10:00:00.000Z';
const TEST_KEY = 'sk_test_NICHT_ECHT';
const LIVE_KEY = 'sk_live_NICHT_ECHT';

// --- T1: offen, keine Bestellungen ---
abschnitt('T1: Status offen - keine Bestellungen nach Marker');
{
  const t = mkdtempSync(join(tmpdir(), 'g1b-t1-'));
  try {
    const { dbPfad } = baueDb(t, { marker: MARKER, kursAnzahl: 1 });
    const db = oeffneDb(dbPfad);
    setzeTestkaufDb(db); setzeTestkaufStripeKey(TEST_KEY);
    const r = testkaufStatus();
    db.close();
    pruefe('T1a: status=offen', r.status === 'offen', `status=${r.status}`);
    pruefe('T1b: bestellungen=[]', Array.isArray(r.bestellungen) && r.bestellungen.length === 0);
    pruefe('T1c: marker vorhanden', !!r.marker, `marker=${r.marker}`);
    pruefe('T1d: kurs_anzahl >= 1', (r.kurs_anzahl ?? 0) >= 1, `kurs_anzahl=${r.kurs_anzahl}`);
  } finally { aufraeumen(t); }
}

// --- T2: Bestellung VOR Marker zaehlt nicht ---
abschnitt('T2: Bestellung bezahlt vor Marker zaehlt nicht');
{
  const t = mkdtempSync(join(tmpdir(), 'g1b-t2-'));
  try {
    const { dbPfad } = baueDb(t, {
      marker: MARKER, kursAnzahl: 1, mitBenutzer: true,
      bestellungen: [{ sitzung: 'cs_vor', erstellt: VOR_MARKER, status: 'bezahlt' }],
    });
    const db = oeffneDb(dbPfad);
    setzeTestkaufDb(db); setzeTestkaufStripeKey(TEST_KEY);
    const r = testkaufStatus();
    db.close();
    pruefe('T2a: status=offen (Bestellung vor Marker ignoriert)', r.status === 'offen', `status=${r.status}`);
    pruefe('T2b: bestellungen leer', r.bestellungen.length === 0, `len=${r.bestellungen.length}`);
  } finally { aufraeumen(t); }
}

// --- T3: Bestellung nach Marker ohne Zugang ---
abschnitt('T3: Bestellung nach Marker ohne Zugang -> offen');
{
  const t = mkdtempSync(join(tmpdir(), 'g1b-t3-'));
  try {
    const { dbPfad } = baueDb(t, {
      marker: MARKER, kursAnzahl: 1, mitBenutzer: true,
      bestellungen: [{ sitzung: 'cs_nach', erstellt: NACH_MARKER, status: 'bezahlt' }],
    });
    const db = oeffneDb(dbPfad);
    setzeTestkaufDb(db); setzeTestkaufStripeKey(TEST_KEY);
    const r = testkaufStatus();
    db.close();
    pruefe('T3a: status=offen (kein Zugang)', r.status === 'offen', `status=${r.status}`);
    pruefe('T3b: 1 Bestellung gelistet', r.bestellungen.length === 1, `len=${r.bestellungen.length}`);
    pruefe('T3c: zugang_vorhanden=false', r.bestellungen[0]?.zugang_vorhanden === false, `zugang=${r.bestellungen[0]?.zugang_vorhanden}`);
    pruefe('T3d: email maskiert (enthaelt ***)', String(r.bestellungen[0]?.email ?? '').includes('***'), `email=${r.bestellungen[0]?.email}`);
  } finally { aufraeumen(t); }
}

// --- T4: Bestellung nach Marker MIT Zugang -> bestanden ---
abschnitt('T4: Bestellung nach Marker mit Zugang -> bestanden');
{
  const t = mkdtempSync(join(tmpdir(), 'g1b-t4-'));
  try {
    const { dbPfad } = baueDb(t, {
      marker: MARKER, kursAnzahl: 1, mitBenutzer: true,
      bestellungen: [{ sitzung: 'cs_zugang', erstellt: NACH_MARKER, status: 'bezahlt' }],
      zugaenge: [{}],
    });
    const db = oeffneDb(dbPfad);
    setzeTestkaufDb(db); setzeTestkaufStripeKey(TEST_KEY);
    const r = testkaufStatus();
    db.close();
    pruefe('T4a: status=bestanden', r.status === 'bestanden', `status=${r.status}`);
    pruefe('T4b: 1 Bestellung', r.bestellungen.length === 1, `len=${r.bestellungen.length}`);
    pruefe('T4c: zugang_vorhanden=true', r.bestellungen[0]?.zugang_vorhanden === true, `zugang=${r.bestellungen[0]?.zugang_vorhanden}`);
    pruefe('T4d: betrag vorhanden', typeof r.bestellungen[0]?.betrag === 'number', `betrag=${r.bestellungen[0]?.betrag}`);
    pruefe('T4e: waehrung vorhanden', !!r.bestellungen[0]?.waehrung, `waehrung=${r.bestellungen[0]?.waehrung}`);
  } finally { aufraeumen(t); }
}

// F-232: Nur zeitlich gueltige Zugaenge liefern einen Nachweis.
abschnitt('F-232: Ablaufdatum des Kaeuferzugangs');
for (const [fall, gueltigBis, gueltig] of [
  ['Vergangenheit', Date.now() - 60_000, false],
  ['Zukunft', Date.now() + 3_600_000, true],
  ['NULL', null, true],
]) {
  const t = mkdtempSync(join(tmpdir(), 'g1b-f232-'));
  try {
    const { dbPfad } = baueDb(t, {
      marker: MARKER, kursAnzahl: 1, mitBenutzer: true,
      bestellungen: [{ sitzung: 'cs_ablauf', erstellt: NACH_MARKER, status: 'bezahlt' }],
      zugaenge: [{ gueltig_bis: gueltigBis }],
    });
    const db = oeffneDb(dbPfad);
    try {
      setzeTestkaufDb(db); setzeTestkaufStripeKey(TEST_KEY);
      const r = testkaufStatus();
      pruefe(`F-232 ${fall}: Status`, r.status === (gueltig ? 'bestanden' : 'offen'), r.status);
      pruefe(`F-232 ${fall}: gelisteter Zugang`, r.bestellungen.length === 1 && r.bestellungen[0].zugang_vorhanden === gueltig);
      pruefe(`F-232 ${fall}: Nachweis`, gueltig ? r.nachweis?.zugang_vorhanden === true : r.nachweis === null);
    } finally { db.close(); }
  } finally { aufraeumen(t); }
}

// --- T5: erstattet/pruefen zaehlen nicht ---
abschnitt('T5: Status erstattet und pruefen zaehlen nicht');
{
  const t = mkdtempSync(join(tmpdir(), 'g1b-t5-'));
  try {
    const { dbPfad } = baueDb(t, {
      marker: MARKER, kursAnzahl: 1, mitBenutzer: true,
      bestellungen: [
        { sitzung: 'cs_erstattet', erstellt: NACH_MARKER, status: 'erstattet' },
        { sitzung: 'cs_pruefen', erstellt: NACH_MARKER, status: 'pruefen' },
      ],
    });
    const db = oeffneDb(dbPfad);
    setzeTestkaufDb(db); setzeTestkaufStripeKey(TEST_KEY);
    const r = testkaufStatus();
    db.close();
    pruefe('T5a: status=offen (erstattet+pruefen ignoriert)', r.status === 'offen', `status=${r.status}`);
    pruefe('T5b: bestellungen leer', r.bestellungen.length === 0, `len=${r.bestellungen.length}`);
  } finally { aufraeumen(t); }
}

// --- T6: Live-Key -> nicht_moeglich, keine Werte ---
abschnitt('T6: Live-Schluessel -> nicht_moeglich, keine Werte');
{
  const t = mkdtempSync(join(tmpdir(), 'g1b-t6-'));
  try {
    const { dbPfad } = baueDb(t, { marker: MARKER, kursAnzahl: 1 });
    const db = oeffneDb(dbPfad);
    setzeTestkaufDb(db); setzeTestkaufStripeKey(LIVE_KEY);
    const r = testkaufStatus();
    db.close();
    pruefe('T6a: status=nicht_moeglich', r.status === 'nicht_moeglich', `status=${r.status}`);
    pruefe('T6b: grund=kein_testschluessel', r.grund === 'kein_testschluessel', `grund=${r.grund}`);
    pruefe('T6c: keine bestellungen', r.bestellungen.length === 0, `len=${r.bestellungen.length}`);
    pruefe('T6d: kein kurs_anzahl (kein DB-Zugriff)', !r.kurs_anzahl, `kurs_anzahl=${r.kurs_anzahl}`);
  } finally { aufraeumen(t); }
}

// --- T7: Altinstanz ohne Marker -> nicht_moeglich, kein Fehler ---
abschnitt('T7: Altinstanz ohne Marker -> nicht_moeglich, kein Fehler');
{
  const t = mkdtempSync(join(tmpdir(), 'g1b-t7-'));
  try {
    const { dbPfad } = baueDb(t, { kursAnzahl: 1 });
    const db = oeffneDb(dbPfad);
    setzeTestkaufDb(db); setzeTestkaufStripeKey(TEST_KEY);
    let r = null, ausnahme = null;
    try { r = testkaufStatus(); } catch (e) { ausnahme = e; }
    db.close();
    pruefe('T7a: kein Ausnahme (kein 500)', ausnahme === null, ausnahme?.message);
    pruefe('T7b: status=nicht_moeglich', r?.status === 'nicht_moeglich', `status=${r?.status}`);
    pruefe('T7c: grund=kein_marker', r?.grund === 'kein_marker', `grund=${r?.grund}`);
    pruefe('T7d: bestellungen=[]', (r?.bestellungen?.length ?? -1) === 0, `len=${r?.bestellungen?.length}`);
  } finally { aufraeumen(t); }
}

// G1-N: Nachweis unabhaengig von Anzeigelimit und aktuellem Kursstatus.
abschnitt('N2/N3/N4/N5: dauerhafter, eindeutiger Nachweis');
{
  const t = mkdtempSync(join(tmpdir(), 'g1n-nachweis-'));
  try {
    const { dbPfad } = baueDb(t, {
      marker: MARKER, kursAnzahl: 1, mitBenutzer: true,
      bestellungen: [{ sitzung: 'cs_nachweis', erstellt: NACH_MARKER }], zugaenge: [{}],
    });
    const db = oeffneDb(dbPfad);
    try {
      // Andere Benutzer: deren Bestellungen besitzen keinen Zugang.
      db.prepare("INSERT INTO benutzer (email,passwort_hash,erstellt) VALUES ('ohne@test.hu','hash',?)").run(NACH_MARKER);
      const ohne = db.prepare("SELECT id FROM benutzer WHERE email='ohne@test.hu'").get().id;
      for (let i = 0; i < 6; i++) db.prepare(`INSERT INTO bestellungen
        (stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert)
        VALUES (?,?,1,10000,'huf','bezahlt',?,?)`).run('cs_neuer_' + i, ohne, NACH_MARKER, NACH_MARKER);
      setzeTestkaufDb(db); setzeTestkaufStripeKey(TEST_KEY);
      let r = testkaufStatus();
      pruefe('N2a: sieben Bestellungen, alter Nachweis besteht', r.status === 'bestanden');
      pruefe('N2b: Anzeige bleibt auf fuenf ohne Zugang begrenzt', r.bestellungen.length === 5 && r.bestellungen.every(b => !b.zugang_vorhanden));
      pruefe('N2c: separater Nachweis mit maskierter Mail', r.nachweis?.id === 1 && r.nachweis.zugang_vorhanden && r.nachweis.email.includes('***'));
      db.exec("UPDATE kurse SET status='entwurf'");
      r = testkaufStatus();
      pruefe('N3a: Nachweis bleibt bei Entwurf bestehen', r.status === 'bestanden' && r.nachweis?.id === 1);
      db.exec('DELETE FROM zugaenge');
      r = testkaufStatus();
      pruefe('N3b: ohne Nachweis und Veroeffentlichung nicht moeglich', r.status === 'nicht_moeglich' && r.grund === 'kein_veroeffentlichter_kurs');
      for (const sprache of ['de', 'en', 'hu']) {
        const texte = JSON.parse(readFileSync(new URL('../texte/' + sprache + '.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
        pruefe('N5: API-Grund uebersetzt in ' + sprache, !!texte['g1b_testkauf_grund_' + r.grund]);
        if (sprache === 'hu') pruefe('N5: HU Testkauf-Texte ohne verbotene Kurswoerter', Object.entries(texte).filter(([k]) => k.startsWith('g1b_testkauf_')).every(([, v]) => !/kurzus|tanfolyam/i.test(v)));
      }
      const ui = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
      pruefe('N4: UI verwendet separaten Nachweis', /const eintrag = d\.nachweis;/.test(ui));
    } finally { db.close(); }
  } finally { aufraeumen(t); }
}

// G1-N: Sprach- und Generatorpruefung laufen in der Abnahmekette mit.
for (const datei of ['selbsttest-generator-sync.mjs', 'selbsttest-sprache.mjs']) {
  const lauf = spawnSync(process.execPath, [new URL(datei, import.meta.url).pathname], {
    cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8',
  });
  pruefe('N5: ' + datei, lauf.status === 0, lauf.stdout + lauf.stderr);
}

// --ohne-server fuehrt ausschliesslich serverfreie Pruefungen aus.
if (!process.argv.includes('--ohne-server')) {
// --- T8: HTTP-Tests ---
abschnitt('T8: HTTP - Route /api/admin/testkauf');

const ADMIN_EMAIL = 'admin@test.hu';
const ADMIN_PASSWORT = 'passwort12345';
const TEST_SK = 'sk_test_placeholder00000000000000000000000000';
const TEST_WHSEC = 'whsec_placeholder0000000000000000000000000000';
const SERVER = new URL('../server.mjs', import.meta.url).pathname;
const PORT8 = 19820;

function basisEnv(extra = {}) {
  return { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? '', ...extra };
}

async function holenHttp(port, pfad, { method = 'GET', headers = {}, body = null } = {}) {
  const init = { method, headers: { Accept: 'text/html', ...headers }, redirect: 'manual' };
  if (body !== null) init.body = body;
  try {
    const a = await fetch(`http://127.0.0.1:${port}${pfad}`, init);
    const text = await a.text();
    return { status: a.status, text, headers: Object.fromEntries(a.headers) };
  } catch { return { status: 0, text: '', headers: {} }; }
}

async function starteServer(tmpord, port, extraEnv = {}) {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    cwd: tmpord, stdio: ['ignore', 'pipe', 'pipe'],
    env: basisEnv({ PORT: String(port), DB_DATEI: join(tmpord, 'app.db'), BASE_URL: `http://127.0.0.1:${port}`, ...extraEnv }),
  });
  let log = '';
  p.stdout.on('data', x => { log += x; });
  p.stderr.on('data', x => { log += x; });
  for (let i = 0; i < 300; i++) {
    if (p.exitCode !== null) break;
    try { const r = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null); if (r?.status) break; } catch { /* */ }
    await warte(100);
  }
  return { p, log: () => log };
}

async function stop(p) {
  p.kill('SIGTERM');
  await new Promise(r => { if (p.exitCode !== null) return r(); p.on('exit', r); setTimeout(() => { try { p.kill('SIGKILL'); } catch {} r(); }, 10000); });
}

async function einrichtungsmodusServer(tmpord, port, extraEnv = {}) {
  const { p: pSetup } = await starteServer(tmpord, port, { EINRICHTUNGSMODUS: '1', ...extraEnv });
  for (let i = 0; i < 600; i++) {
    if (existsSync(join(tmpord, 'daten', 'ERSTSTART.txt'))) break;
    await warte(100);
  }
  const codeFile = join(tmpord, 'daten', 'ERSTSTART.txt');
  const setupCode = existsSync(codeFile) ? readFileSync(codeFile, 'utf8').trim() : null;
  if (setupCode) {
    await holenHttp(port, '/einrichtung', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: setupCode, email: ADMIN_EMAIL, passwort: ADMIN_PASSWORT }).toString(),
    });
  }
  await stop(pSetup);
  const { p } = await starteServer(tmpord, port, extraEnv);
  return { p };
}

async function einloggen(port) {
  const r = await holenHttp(port, '/anmelden', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: ADMIN_EMAIL, passwort: ADMIN_PASSWORT }).toString(),
  });
  return String(r.headers['set-cookie'] || '').split(';')[0];
}

async function einloggenJson(port) {
  const r = await holenHttp(port, '/api/anmelden', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, passwort: ADMIN_PASSWORT }),
  });
  return String(r.headers['set-cookie'] || '').split(';')[0];
}

async function holeCsrf(port, sessionCookie, n) {
  const r = await holenHttp(port, `/admin/einrichtung/schritt/${n}`, { headers: { Cookie: sessionCookie } });
  const m = r.text.match(/name="csrf_token"\s+value="([0-9a-f]+)"/);
  return { csrf: m ? m[1] : null };
}

async function postSchritt(port, sessionCookie, n, felder) {
  const { csrf } = await holeCsrf(port, sessionCookie, n);
  return holenHttp(port, `/admin/einrichtung/schritt/${n}`, {
    method: 'POST', headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf_token: csrf ?? '', ...felder }).toString(),
  });
}

async function schritteAbschliessen(port, sessionCookie) {
  await postSchritt(port, sessionCookie, 1, { PLATTFORM_NAME: 'Testplattform' });
  await postSchritt(port, sessionCookie, 2, {
    modus_impressum: 'erstellt', modus_datenschutz: 'erstellt', modus_teilnahmebedingungen: 'erstellt',
    ANBIETER_NAME: 'Test GmbH', ANBIETER_ANSCHRIFT: 'Musterstrasse 1, 12345 Budapest', ANBIETER_EMAIL: 'info@test.hu',
  });
  await postSchritt(port, sessionCookie, 3, { aktion: 'ohne_mail' });
  await holenHttp(port, '/api/admin/stepup', {
    method: 'POST', headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ passwort: ADMIN_PASSWORT }),
  });
  await postSchritt(port, sessionCookie, 4, { STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC });
  await postSchritt(port, sessionCookie, 5, { aktion: 'ueberspringen' });
}

{
  const t = mkdtempSync(join(tmpdir(), 'g1b-t8-'));
  try {
    // Phase 1: Einrichtungsmodus -> alle Schritte -> KONFIGURIERT (einrichtung_abgeschlossen_am gesetzt)
    const { p: pE } = await einrichtungsmodusServer(t, PORT8);
    const cookie = await einloggen(PORT8);
    await schritteAbschliessen(PORT8, cookie);
    const { csrf: csrfKey } = await holeCsrf(PORT8, cookie, 6);
    await holenHttp(PORT8, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrfKey ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    const { csrf: csrf6 } = await holeCsrf(PORT8, cookie, 6);
    await holenHttp(PORT8, '/admin/einrichtung/schritt/6', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf6 ?? '', schluessel_gesichert: '1' }).toString(),
    });
    await stop(pE);
    // Phase 2: Voller Server (KONFIGURIERT -> AKTIV via WP9)
    const { p: pFull } = await starteServer(t, PORT8, { STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC });
    await warte(1500);
    const vollGestartet = pFull.exitCode === null;
    // T8a: ohne Admin-Cookie -> 401/403
    const r401 = await holenHttp(PORT8, '/api/admin/testkauf');
    pruefe('T8a: ohne Admin-Cookie -> 401 oder 403', r401.status === 401 || r401.status === 403, `status=${r401.status}, gestartet=${vollGestartet}`);
    // T8b: GET aendert instanz_zustand nicht
    const db8 = new DatabaseSync(join(t, 'app.db'), { readOnly: true });
    db8.exec('PRAGMA busy_timeout=3000');
    const zustand8 = db8.prepare("SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'").get()?.wert;
    db8.close();
    pruefe('T8b: instanz_zustand unveraendert (AKTIV)', zustand8 === 'AKTIV', `zustand=${zustand8}`);
    // T8c+d: mit Admin-Cookie -> 200 + strukturierter Response
    if (vollGestartet) {
      const adminCookie = await einloggenJson(PORT8);
      const r200 = await holenHttp(PORT8, '/api/admin/testkauf', { headers: { Cookie: adminCookie, Accept: 'application/json' } });
      pruefe('T8c: mit Admin-Cookie -> 200', r200.status === 200, `status=${r200.status}`);
      let body200 = null;
      try { body200 = JSON.parse(r200.text); } catch { /* */ }
      pruefe('T8d: Response hat status-Feld', typeof body200?.status === 'string', `body=${r200.text?.slice(0, 80)}`);
      await stop(pFull);
    } else {
      pruefe('T8c: mit Admin-Cookie -> 200', false, 'Server nicht gestartet (ROT erwartet)');
      pruefe('T8d: Response hat status-Feld', false, 'Server nicht gestartet');
    }
  } finally { aufraeumen(t); }
}

}

// --- T9: Textschluessel ---
abschnitt('T9: Textschluessel in texte/*.json und tools/*/teil3.mjs');
const g1bSchluessel = [
  'g1b_testkauf_titel', 'g1b_testkauf_anleitung', 'g1b_testkauf_aktualisieren',
  'g1b_testkauf_bestanden', 'g1b_testkauf_offen', 'g1b_testkauf_nicht_moeglich',
  'g1b_testkauf_grund_kein_testschluessel', 'g1b_testkauf_grund_kein_marker',
  'g1b_testkauf_grund_kein_veroeffentlichter_kurs',
];
for (const [label, datei] of [['de.json', '../texte/de.json'], ['hu.json', '../texte/hu.json'], ['en.json', '../texte/en.json']]) {
  let texte = {};
  try { texte = JSON.parse(readFileSync(new URL(datei, import.meta.url))); } catch { /* */ }
  for (const k of g1bSchluessel) {
    pruefe(`T9 ${label} hat "${k}"`, Object.prototype.hasOwnProperty.call(texte, k));
  }
}
for (const [label, datei] of [['de/teil3', '../tools/de/teil3.mjs'], ['en/teil3', '../tools/en/teil3.mjs']]) {
  let inhalt = '';
  try { inhalt = readFileSync(new URL(datei, import.meta.url), 'utf8'); } catch { /* */ }
  for (const k of g1bSchluessel) {
    pruefe(`T9 ${label} enthaelt "${k}"`, inhalt.includes(k));
  }
}

// Schlussbericht
console.log('');
if (schlecht > 0) {
  console.log(`${schlecht} Test(s) mit Fehlern`);
  process.exit(1);
} else {
  console.log(`${ok} bestanden, 0 fehlgeschlagen`);
}
