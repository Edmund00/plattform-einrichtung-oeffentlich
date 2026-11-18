// Automatischer Selbsttest fuer WP1 Sicherheitsblock (Setup-/Einrichtungsmodus).
// Chef-Entscheidung R1 = Variante D (2026-11-13): Setup-Modus startet nur mit EINRICHTUNGSMODUS=1.
// Einrichtungsmodus (ADMIN_ERSTELLT) laeuft OHNE Schalter. Ohne Schalter + ohne Admin: Verhalten wie bisher (Abbruch).
// Offline, ohne echte Schluessel. Aufruf: node --disable-warning=ExperimentalWarning tools/selbsttest-setupmodus.mjs
import './test-sprache.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

let ok = 0, schlecht = 0;
const pruefe = (name, bedingung, detail = '') => { bedingung ? ok++ : schlecht++; console.log(`${bedingung ? 'OK     ' : 'FEHLER '} ${name}${!bedingung && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = (pfad) => { try { rmSync(pfad, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } };

const { ladeKonfig, KonfigFehler, leseStartZustand } = await import(pathToFileURL(resolve('konfig.mjs')).href);
const MARKE = 'GEHEIMMARKE_SETUP_9876';
const gut = { STRIPE_SECRET_KEY: 'sk_test_platzhalter_nur_fuer_tests', STRIPE_WEBHOOK_SECRET: 'whsec_platzhalter_nur_fuer_tests' };
const basisEnv = (extra) => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...extra });

// Minimale Datenbank mit optionalem Admin und/oder instanz_zustand anlegen.
function dbAnlegen(pfad, { mitAdmin = false, instanzZustand = null } = {}) {
  mkdirSync(resolve(pfad, '..'), { recursive: true });
  const d = new DatabaseSync(pfad);
  d.exec(`CREATE TABLE IF NOT EXISTS benutzer (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, passwort_hash TEXT NOT NULL, stripe_kunde TEXT UNIQUE, erstellt TEXT NOT NULL, rolle TEXT NOT NULL DEFAULT 'kunde' CHECK (rolle IN ('kunde','admin')))`);
  d.exec(`CREATE TABLE IF NOT EXISTS einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT, verschluesselt INTEGER NOT NULL DEFAULT 0 CHECK(verschluesselt IN (0,1)), iv TEXT, tag TEXT, aktualisiert_am TEXT NOT NULL)`);
  if (mitAdmin) d.prepare("INSERT INTO benutzer (email, passwort_hash, erstellt, rolle) VALUES (?, ?, ?, 'admin')").run('admin@beispiel.hu', 'nur-fuer-tests', new Date().toISOString());
  if (instanzZustand) d.prepare('INSERT OR REPLACE INTO einstellungen (schluessel,wert,verschluesselt,aktualisiert_am) VALUES (?,?,0,?)').run('instanz_zustand', instanzZustand, new Date().toISOString());
  d.close();
}

const werfen = (fn) => { try { return fn(); } catch (e) { return e; } };

// =====================================================================================================
abschnitt('A1 Modus-Unterscheidung in ladeKonfig (Variante D: EINRICHTUNGSMODUS-Schalter)');
{
  // Mit Stripe-Variablen: immer normal, Schalter irrelevant
  pruefe('Mit Variablen, ohne Schalter: Modus "normal"', ladeKonfig({ ...gut }, { startZustand: 'UNINITIALISIERT' }).modus === 'normal');
  pruefe('Mit Variablen, mit Schalter: Modus "normal" (Schalter irrelevant)', ladeKonfig({ ...gut, EINRICHTUNGSMODUS: '1' }, { startZustand: 'UNINITIALISIERT' }).modus === 'normal');

  // Ohne Stripe, UNINITIALISIERT, OHNE Schalter: Abbruch wie bisher
  const ohneSchalter = werfen(() => ladeKonfig({}, { startZustand: 'UNINITIALISIERT' }));
  pruefe('Ohne Variablen + UNINITIALISIERT, OHNE EINRICHTUNGSMODUS=1: KonfigFehler (wie bisher)', ohneSchalter instanceof KonfigFehler);

  // Ohne Stripe, UNINITIALISIERT, MIT Schalter: Setup-Modus
  const k2 = ladeKonfig({ EINRICHTUNGSMODUS: '1' }, { startZustand: 'UNINITIALISIERT' });
  pruefe('Ohne Variablen + UNINITIALISIERT + EINRICHTUNGSMODUS=1: Modus "setup"', k2.modus === 'setup');
  pruefe('Setup-Modus-Konfig enthaelt nur netzrelevante Felder', Object.isFrozen(k2) && typeof k2.port === 'number' && typeof k2.host === 'string' && typeof k2.dbDatei === 'string' && k2.stripeSecretKey === undefined);

  // Einrichtungsmodus: Admin vorhanden, Stripe fehlt, OHNE Schalter (Spez-Regel: sonst Sackgasse)
  pruefe('Ohne Variablen + ADMIN_ERSTELLT, OHNE Schalter: Modus "einrichtung"', ladeKonfig({}, { startZustand: 'ADMIN_ERSTELLT' }).modus === 'einrichtung');
  pruefe('Ohne Variablen + ADMIN_ERSTELLT, MIT Schalter: Modus "einrichtung" (Schalter nicht noetig)', ladeKonfig({ EINRICHTUNGSMODUS: '1' }, { startZustand: 'ADMIN_ERSTELLT' }).modus === 'einrichtung');

  // EINRICHTUNGSMODUS mit beliebigem anderen Wert: Schalter zaehlt nicht
  for (const wert of ['', '0', 'ja', 'true', 'ein']) {
    const e = werfen(() => ladeKonfig({ EINRICHTUNGSMODUS: wert }, { startZustand: 'UNINITIALISIERT' }));
    pruefe(`EINRICHTUNGSMODUS="${wert}" ist nicht "1" -> KonfigFehler`, e instanceof KonfigFehler);
  }
}

// =====================================================================================================
abschnitt('A3 Admin vorhanden / Konfig-Zustaende ohne Stripe-Variablen -> KonfigFehler');
{
  // ohne optionen (Rueckwaertskompatibilitaet): KonfigFehler wie bisher
  const g1 = werfen(() => ladeKonfig({}));
  pruefe('Ohne optionen: KonfigFehler (bisheriges Verhalten)', g1 instanceof KonfigFehler);
  pruefe('Fehlermeldung nennt STRIPE_SECRET_KEY', g1 && g1.meldungen.join(' ').includes('STRIPE_SECRET_KEY'));
  pruefe('Fehlermeldung nennt STRIPE_WEBHOOK_SECRET', g1 && g1.meldungen.join(' ').includes('STRIPE_WEBHOOK_SECRET'));

  // ohne optionen, aber Schalter gesetzt: bleibt KonfigFehler (Schalter braucht UNINITIALISIERT-Zustand)
  const g0 = werfen(() => ladeKonfig({ EINRICHTUNGSMODUS: '1' }));
  pruefe('Schalter gesetzt, startZustand fehlt: KonfigFehler', g0 instanceof KonfigFehler);

  // KONFIGURIERT / AKTIV: Fehler wie bisher, auch mit Schalter
  const g2 = werfen(() => ladeKonfig({}, { startZustand: 'KONFIGURIERT' }));
  pruefe('KONFIGURIERT ohne Stripe: KonfigFehler', g2 instanceof KonfigFehler);
  const g2b = werfen(() => ladeKonfig({ EINRICHTUNGSMODUS: '1' }, { startZustand: 'KONFIGURIERT' }));
  pruefe('KONFIGURIERT + Schalter: KonfigFehler (Schutz gegen Uebernahme einer fertigen Instanz)', g2b instanceof KonfigFehler);
  const g3 = werfen(() => ladeKonfig({}, { startZustand: 'AKTIV' }));
  pruefe('AKTIV ohne Stripe: KonfigFehler', g3 instanceof KonfigFehler);
}

// =====================================================================================================
abschnitt('A4 sk_live_ wird in jedem Modus abgelehnt');
{
  const g1 = werfen(() => ladeKonfig({ STRIPE_SECRET_KEY: `sk_live_${MARKE}`, STRIPE_WEBHOOK_SECRET: gut.STRIPE_WEBHOOK_SECRET, EINRICHTUNGSMODUS: '1' }, { startZustand: 'UNINITIALISIERT' }));
  pruefe('sk_live_ + Schalter + UNINITIALISIERT: KonfigFehler', g1 instanceof KonfigFehler);
  pruefe('sk_live_-Wert nicht in Fehlermeldung', g1 && !g1.meldungen.join(' ').includes(MARKE));

  const g2 = werfen(() => ladeKonfig({ STRIPE_SECRET_KEY: `sk_live_${MARKE}`, STRIPE_WEBHOOK_SECRET: gut.STRIPE_WEBHOOK_SECRET }, { startZustand: 'ADMIN_ERSTELLT' }));
  pruefe('sk_live_ + ADMIN_ERSTELLT: KonfigFehler', g2 instanceof KonfigFehler);
}

// =====================================================================================================
abschnitt('A6 Zustandsmatrix (Variante D): startZustand x Stripe x EINRICHTUNGSMODUS');
{
  // Hilfsfunktion: Erwartung pruefen (string "setup"/"einrichtung"/"normal" oder "fehler")
  const matrix = [
    // startZustand, env, erwartet
    ['UNINITIALISIERT', {}, 'fehler'],                                     // kein Schalter -> wie bisher
    ['UNINITIALISIERT', { EINRICHTUNGSMODUS: '1' }, 'setup'],              // mit Schalter -> Setup
    ['UNINITIALISIERT', { ...gut }, 'normal'],                             // Stripe da -> normal
    ['UNINITIALISIERT', { ...gut, EINRICHTUNGSMODUS: '1' }, 'normal'],     // Stripe + Schalter -> normal
    ['UNINITIALISIERT', { STRIPE_SECRET_KEY: gut.STRIPE_SECRET_KEY }, 'fehler'],   // nur eine
    ['UNINITIALISIERT', { STRIPE_SECRET_KEY: gut.STRIPE_SECRET_KEY, EINRICHTUNGSMODUS: '1' }, 'fehler'],   // nur eine + Schalter
    ['UNINITIALISIERT', { STRIPE_WEBHOOK_SECRET: gut.STRIPE_WEBHOOK_SECRET, EINRICHTUNGSMODUS: '1' }, 'fehler'],
    ['UNINITIALISIERT', { STRIPE_SECRET_KEY: 'sk_test_kurz', STRIPE_WEBHOOK_SECRET: gut.STRIPE_WEBHOOK_SECRET }, 'fehler'],   // zu kurz
    ['UNINITIALISIERT', { STRIPE_SECRET_KEY: gut.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: 'falsch' }, 'fehler'],
    ['UNINITIALISIERT', { STRIPE_SECRET_KEY: `sk_live_${MARKE}`, STRIPE_WEBHOOK_SECRET: gut.STRIPE_WEBHOOK_SECRET, EINRICHTUNGSMODUS: '1' }, 'fehler'],
    ['ADMIN_ERSTELLT', {}, 'einrichtung'],                                 // Admin da, kein Stripe -> Einrichtung (ohne Schalter)
    ['ADMIN_ERSTELLT', { EINRICHTUNGSMODUS: '1' }, 'einrichtung'],         // Schalter bei Admin ist egal
    ['ADMIN_ERSTELLT', { ...gut }, 'normal'],                              // Admin da, Stripe da -> normal
    ['KONFIGURIERT', {}, 'fehler'],                                        // Schutz: fertige Instanz nie in Setup kippen
    ['KONFIGURIERT', { EINRICHTUNGSMODUS: '1' }, 'fehler'],                // auch mit Schalter nicht
    ['AKTIV', {}, 'fehler'],
    ['AKTIV', { EINRICHTUNGSMODUS: '1' }, 'fehler'],
  ];
  for (const [zustand, env, erwartet] of matrix) {
    const anzeige = zustand + ' / ' + (Object.keys(env).length ? Object.keys(env).join('+') : 'leer');
    if (erwartet === 'fehler') {
      const e = werfen(() => ladeKonfig(env, { startZustand: zustand }));
      pruefe(`${anzeige} -> KonfigFehler`, e instanceof KonfigFehler);
    } else {
      const k = werfen(() => ladeKonfig(env, { startZustand: zustand }));
      pruefe(`${anzeige} -> Modus "${erwartet}"`, k && k.modus === erwartet, k instanceof Error ? k.message : k && k.modus);
    }
  }
}

// =====================================================================================================
abschnitt('leseStartZustand: DB-Pruefung (Nachbesserung 1: Admin-Fallback AKTIV; Nachbesserung 2: fail-closed)');
{
  const t = mkdtempSync(join(tmpdir(), 'wp1-leseZustand-'));
  const dbA = join(t, 'leer.db');
  const dbB = join(t, 'mit-admin.db');
  const dbC = join(t, 'mit-zustand-konfiguriert.db');
  const dbE = join(t, 'mit-zustand-adminErstellt.db');
  const dbF = join(t, 'fehlt-nicht-da.db');
  dbAnlegen(dbA, {});
  dbAnlegen(dbB, { mitAdmin: true });
  dbAnlegen(dbC, { mitAdmin: true, instanzZustand: 'KONFIGURIERT' });
  dbAnlegen(dbE, { mitAdmin: true, instanzZustand: 'ADMIN_ERSTELLT' });

  pruefe('Nicht existierende DB -> UNINITIALISIERT', leseStartZustand(dbF) === 'UNINITIALISIERT');
  pruefe('Leere DB (keine Admin-Zeile) -> UNINITIALISIERT', leseStartZustand(dbA) === 'UNINITIALISIERT');
  pruefe('DB mit Admin, KEIN instanz_zustand -> AKTIV (Nachbesserung 1: Altbestand nie still in Einrichtungsmodus)', leseStartZustand(dbB) === 'AKTIV');
  pruefe('DB mit instanz_zustand=KONFIGURIERT -> KONFIGURIERT', leseStartZustand(dbC) === 'KONFIGURIERT');
  pruefe('DB mit instanz_zustand=ADMIN_ERSTELLT (nur wenn WP3 das setzt) -> ADMIN_ERSTELLT', leseStartZustand(dbE) === 'ADMIN_ERSTELLT');

  // Nachbesserung 2: fail-closed. Kaputte Datei -> KonfigFehler, keine Werte in der Meldung
  const dbX = join(t, 'kaputt.db');
  writeFileSync(dbX, 'das ist keine SQLite-Datei nur Muell' + MARKE);
  const kaputtFehler = werfen(() => leseStartZustand(dbX));
  pruefe('Kaputte DB-Datei -> KonfigFehler (fail-closed, nicht UNINITIALISIERT)', kaputtFehler instanceof KonfigFehler);
  pruefe('Kaputt-Fehler enthaelt klare Meldung ohne Werte', kaputtFehler instanceof KonfigFehler && /Datenbank vorhanden, Zustand nicht lesbar/.test(kaputtFehler.meldungen.join(' ')) && !kaputtFehler.meldungen.join(' ').includes(MARKE));

  aufraeumen(t);
}

// =====================================================================================================
abschnitt('WAL-DB real pruefen (readOnly-Zugriff waehrend aktiver WAL-Datei)');
{
  // Nachbesserung 2: Chef-Vorgabe - real pruefen, ob readOnly auf einer WAL-DB (mit -wal/-shm, laufender Server) funktioniert
  const t = mkdtempSync(join(tmpdir(), 'wp1-wal-'));
  const dbP = join(t, 'wal.db');
  // DB mit WAL anlegen und offen halten; so entstehen -wal/-shm Dateien
  const live = new DatabaseSync(dbP);
  live.exec('PRAGMA journal_mode=WAL');
  live.exec(`CREATE TABLE IF NOT EXISTS benutzer (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, passwort_hash TEXT NOT NULL, stripe_kunde TEXT UNIQUE, erstellt TEXT NOT NULL, rolle TEXT NOT NULL DEFAULT 'kunde' CHECK (rolle IN ('kunde','admin')))`);
  live.exec(`CREATE TABLE IF NOT EXISTS einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT, verschluesselt INTEGER NOT NULL DEFAULT 0 CHECK(verschluesselt IN (0,1)), iv TEXT, tag TEXT, aktualisiert_am TEXT NOT NULL)`);
  live.prepare("INSERT INTO benutzer (email, passwort_hash, erstellt, rolle) VALUES (?, ?, ?, 'admin')").run('wal@beispiel.hu', 'nur-fuer-tests', new Date().toISOString());
  // Eine wartende Schreib-Transaktion erzwingt die WAL-Datei (fuehrt KEIN COMMIT durch, damit Dateien sichtbar bleiben)
  live.exec('BEGIN IMMEDIATE'); live.exec('COMMIT');
  pruefe('WAL-Datei vorhanden (-wal existiert)', existsSync(dbP + '-wal'));
  pruefe('Shared-Memory-Datei vorhanden (-shm existiert)', existsSync(dbP + '-shm'));
  // Jetzt readOnly ueber leseStartZustand aufrufen
  const z = werfen(() => leseStartZustand(dbP));
  pruefe('readOnly-Zugriff auf WAL-DB waehrend live-Verbindung: liefert Zustand ohne Fehler', typeof z === 'string' && ['UNINITIALISIERT', 'ADMIN_ERSTELLT', 'KONFIGURIERT', 'AKTIV'].includes(z));
  pruefe('WAL-DB mit Admin ohne instanz_zustand -> AKTIV', z === 'AKTIV');
  live.close();
  aufraeumen(t);
}

// =====================================================================================================
abschnitt('A2 + A7 Server-Verhalten (Setup- und Einrichtungsmodus)');

const SERVER = resolve('server.mjs');

async function starteServer(tempordner, { env = {}, port = 4412 } = {}) {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    cwd: tempordner,
    env: basisEnv({ PORT: String(port), ...env }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  p.stdout.on('data', (x) => { log += x; });
  p.stderr.on('data', (x) => { log += x; });
  // Nachbesserung 1 (Chef 2026-11-13): auf Bereitschaft pollen (bis 30 s, 200 ms Takt), nicht feste Zeit.
  // Fertig wenn: eine der Startzeilen im Log ODER /health erreichbar ODER Prozess beendet (fehlerhaft).
  for (let i = 0; i < 150; i++) {
    if (/Setup-Modus|Einrichtungsmodus|Schulungsplattform läuft|fehlerhaft/.test(log)) break;
    if (p.exitCode !== null) break;
    try { const r = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null); if (r && r.status) break; } catch { /* noch nicht da */ }
    await warte(200);
  }
  return { p, log: () => log };
}

async function holen(port, pfad, { method = 'GET', accept = 'application/json' } = {}) {
  const url = `http://127.0.0.1:${port}${pfad}`;
  const antwort = await fetch(url, { method, headers: { Accept: accept } });
  const text = await antwort.text();
  return { status: antwort.status, text, headers: Object.fromEntries(antwort.headers) };
}

{
  // A2: Setup-Modus (leere DB, keine Stripe, EINRICHTUNGSMODUS=1).
  // Hinweis WP3: Im Setup-Modus wird jetzt die DB geladen (fuer die Token-Zeile des Einrichtungscodes).
  // Spez-A2 verlangt nur /health=200 und die genannten Pfade=404; /einrichtung ist jetzt (WP3) kein 404 mehr.
  const t = mkdtempSync(join(tmpdir(), 'wp1-setup-'));
  const dbPfad = join(t, 'db', 'leer.db');
  const port = 4412;
  const { p, log } = await starteServer(t, { env: { DB_DATEI: dbPfad, EINRICHTUNGSMODUS: '1' }, port });
  try {
    pruefe('Setup-Modus: Server startet mit EINRICHTUNGSMODUS=1', /Setup-Modus/.test(log()));

    const h = await holen(port, '/health');
    pruefe('GET /health: Status 200', h.status === 200);
    pruefe('GET /health: Antwort enthaelt genau {"modus":"setup"}', JSON.stringify(JSON.parse(h.text)) === JSON.stringify({ modus: 'setup' }));
    pruefe('GET /health: Cache-Control no-store', (h.headers['cache-control'] || '').includes('no-store'));

    for (const pfad of ['/', '/kurse', '/admin', '/webhook', '/api/konto', '/api/anmelden']) {
      const a = await holen(port, pfad);
      pruefe(`GET ${pfad}: 404`, a.status === 404);
      const tLow = (a.text || '').toLowerCase();
      pruefe(`GET ${pfad}: Antwort ohne Pfadnamen/Version/Stacktrace`,
        !tLow.includes(pfad.toLowerCase()) && !/\bv?\d+\.\d+\.\d+\b/.test(tLow) && !/stack|trace|error:|express/i.test(a.text || ''));
    }
    const post = await holen(port, '/kurse', { method: 'POST' });
    pruefe('POST /kurse: 404 ohne Pfadhinweis', post.status === 404 && !(post.text || '').toLowerCase().includes('/kurse'));
    // WP3 (Spez): /einrichtung ist im Setup-Modus das Einrichtungs-Formular, nicht 404.
    const e = await holen(port, '/einrichtung');
    pruefe('GET /einrichtung: 200 (Einrichtungsformular, WP3)', e.status === 200 && (e.headers['cache-control'] || '').includes('no-store'));
  } finally {
    p.kill('SIGTERM');
    await warte(300);
    aufraeumen(t);
  }
}

{
  // Gegenprobe: ohne Schalter -> Server bricht ab (bisheriges Verhalten)
  const t = mkdtempSync(join(tmpdir(), 'wp1-ohne-schalter-'));
  const dbPfad = join(t, 'db', 'leer.db');
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    cwd: t,
    env: basisEnv({ PORT: '4415', DB_DATEI: dbPfad }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  p.stdout.on('data', (x) => { log += x; });
  p.stderr.on('data', (x) => { log += x; });
  const exitCode = await new Promise((r) => { p.on('exit', (c) => r(c)); setTimeout(() => { p.kill("SIGKILL"); r(-1); }, 30000); });
  pruefe('Ohne EINRICHTUNGSMODUS=1 und ohne Stripe: Server bricht ab (bisheriges Verhalten)', exitCode === 1 && /fehlerhaft/.test(log));
  pruefe('Ohne Schalter: keine Setup-Modus-Zeile im Log', !/Setup-Modus/.test(log));
  aufraeumen(t);
}

{
  // A7: Einrichtungsmodus - instanz_zustand='ADMIN_ERSTELLT' muss ausdruecklich gesetzt sein (Nachbesserung 1)
  const t = mkdtempSync(join(tmpdir(), 'wp1-einrichtung-'));
  const dbPfad = join(t, 'db', 'mit-admin.db');
  dbAnlegen(dbPfad, { mitAdmin: true, instanzZustand: 'ADMIN_ERSTELLT' });
  const port = 4413;
  const { p, log } = await starteServer(t, { env: { DB_DATEI: dbPfad }, port });
  try {
    pruefe('A7 Einrichtungsmodus startet mit instanz_zustand=ADMIN_ERSTELLT ohne Schalter', /Einrichtungsmodus/.test(log()) && !/fehlerhaft/.test(log()));
    const h = await holen(port, '/health');
    pruefe('A7 /health: 200 mit modus "einrichtung"', h.status === 200 && JSON.parse(h.text).modus === 'einrichtung');
    const a = await holen(port, '/kurse');
    pruefe('A7 /kurse: 404 (kein Shop)', a.status === 404);
    // Strukturell: Admin-Login-Endpoint ist in WP1 noch nicht eingehaengt (voller Login-Test in WP3)
    const anm = await holen(port, '/api/anmelden', { method: 'POST' });
    pruefe('A7 /api/anmelden: 404 in WP1 (strukturelle Belegung, echter Login-Test in WP3)', anm.status === 404);
  } finally {
    p.kill('SIGTERM');
    await warte(300);
    aufraeumen(t);
  }
}

{
  // A8 (Nachbesserung 1): DB mit Admin, OHNE instanz_zustand, ohne Stripe -> Abbruch wie bisher
  // (Altbestand soll nie still in Einrichtungsmodus kippen.) Mit UND ohne EINRICHTUNGSMODUS=1 beides Exit 1.
  for (const [etikett, env] of [['ohne Schalter', {}], ['mit EINRICHTUNGSMODUS=1', { EINRICHTUNGSMODUS: '1' }]]) {
    const t = mkdtempSync(join(tmpdir(), 'wp1-A8-'));
    const dbPfad = join(t, 'db', 'alt-admin.db');
    dbAnlegen(dbPfad, { mitAdmin: true });   // Admin da, instanz_zustand NICHT gesetzt => AKTIV
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
      cwd: t,
      env: basisEnv({ PORT: '4416', DB_DATEI: dbPfad, ...env }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    p.stdout.on('data', (x) => { log += x; });
    p.stderr.on('data', (x) => { log += x; });
    const exitCode = await new Promise((r) => { p.on('exit', (c) => r(c)); setTimeout(() => { p.kill("SIGKILL"); r(-1); }, 30000); });
    pruefe(`A8 Admin in DB ohne instanz_zustand (${etikett}): Abbruch Exit 1 wie bisher`, exitCode === 1 && /fehlerhaft/.test(log));
    pruefe(`A8 ${etikett}: kein Setup-/Einrichtungsmodus im Log`, !/Setup-Modus|Einrichtungsmodus/.test(log));
    aufraeumen(t);
  }
}

{
  // A9 (Nachbesserung 2): kaputte DB-Datei + EINRICHTUNGSMODUS=1 -> Abbruch Exit 1 (fail-closed), kein Setup-Modus
  const t = mkdtempSync(join(tmpdir(), 'wp1-A9-'));
  const dbPfad = join(t, 'db', 'kaputt.db');
  mkdirSync(join(t, 'db'), { recursive: true });
  writeFileSync(dbPfad, 'Dies_ist_keine_SQLite_Datei_' + MARKE);
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    cwd: t,
    env: basisEnv({ PORT: '4417', DB_DATEI: dbPfad, EINRICHTUNGSMODUS: '1' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  p.stdout.on('data', (x) => { log += x; });
  p.stderr.on('data', (x) => { log += x; });
  const exitCode = await new Promise((r) => { p.on('exit', (c) => r(c)); setTimeout(() => { p.kill("SIGKILL"); r(-1); }, 30000); });
  pruefe('A9 Kaputte DB + EINRICHTUNGSMODUS=1: Abbruch Exit 1 (fail-closed, nicht Setup-Modus)', exitCode === 1);
  pruefe('A9 Meldung "Datenbank vorhanden, Zustand nicht lesbar"', /Datenbank vorhanden, Zustand nicht lesbar/.test(log));
  pruefe('A9 Kein Setup-Modus im Log', !/Setup-Modus/.test(log));
  pruefe('A9 Datei-Inhalt (MARKE) taucht nicht im Log auf', !log.includes(MARKE));
  aufraeumen(t);
}

// =====================================================================================================
abschnitt('Integritaet: Ausgaben enthalten keine Schluesselwerte');
{
  const t = mkdtempSync(join(tmpdir(), 'wp1-geheimnis-'));
  const port = 4414;
  const { p, log } = await starteServer(t, { env: { DB_DATEI: join(t, 'x.db'), EINRICHTUNGSMODUS: '1', WIEDERGABE_GEHEIMNIS: 'WIEDERGABE_GEHEIMNIS_' + MARKE }, port });
  try {
    const h = await holen(port, '/health');
    pruefe('Setup-Modus trotz WIEDERGABE_GEHEIMNIS gestartet', /Setup-Modus/.test(log()) && h.status === 200);
    pruefe('WIEDERGABE_GEHEIMNIS taucht nicht im Log auf', !log().includes(MARKE));
    pruefe('WIEDERGABE_GEHEIMNIS taucht nicht in /health auf', !h.text.includes(MARKE));
  } finally {
    p.kill('SIGTERM');
    await warte(300);
    aufraeumen(t);
  }
}

console.log(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`);
process.exit(schlecht === 0 ? 0 : 1);
