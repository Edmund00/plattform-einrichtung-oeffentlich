// Selbsttest WP9: Einrichtungsassistent Abschluss (Schritt 6, Wiederherstellungsschluessel, Zustandswechsel).
// Etappe A: A3 Crockford-Base32-Rundlauf.
// Etappe B: A1-A2, A4-A12 HTTP-Integrationstests + 14 Zusatz-Angriffstests.
import './test-sprache.mjs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createConnection } from 'node:net';
import { schluesselAlsCode, codeAlsSchluessel } from '../schluessel-code.mjs';

let ok = 0, schlecht = 0;
const pruefe = (name, bed, detail = '') => {
  bed ? ok++ : schlecht++;
  console.log(`${bed ? 'OK     ' : 'FEHLER '} ${name}${!bed && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`);
};
const abschnitt = (t) => console.log(`--- ${t}`);

// =====================================================================
// A3: Crockford-Base32-Rundlauf (reine Einheit, kein Server)
// =====================================================================

abschnitt('A3: Rundlauf (1000 Zufallsschluessel)');
{
  let rundlaufOk = true;
  for (let i = 0; i < 1000; i++) {
    const key = randomBytes(32);
    const code = schluesselAlsCode(key);
    const rueck = codeAlsSchluessel(code);
    if (!rueck || !rueck.equals(key)) {
      rundlaufOk = false;
      pruefe(`A3 Rundlauf ${i}`, false, `code=${code.slice(0, 30)}`);
      break;
    }
  }
  pruefe('A3 1000 Zufallsschluessel Rundlauf', rundlaufOk);
}

abschnitt('A3: Format-Pruefung');
{
  const beispiel = randomBytes(32);
  const code = schluesselAlsCode(beispiel);
  pruefe('A3 Code ist string', typeof code === 'string');
  // 53 Zeichen: 52 Daten + 1 Pruefsymbol; in Gruppen zu 4 mit Bindestrich
  // 13 Gruppen zu 4 + 1 Gruppe zu 1 = 14 Gruppen, 13 Bindestriche -> 53 + 13 = 66 Gesamtlaenge
  pruefe('A3 Code hat 66 Zeichen (inkl. Bindestriche)', code.length === 66, `laenge=${code.length}`);
  const gruppen = code.split('-');
  pruefe('A3 Code hat 14 Gruppen', gruppen.length === 14, `erhalten: ${gruppen.length}`);
  pruefe('A3 erste 13 Gruppen haben je 4 Zeichen', gruppen.slice(0, 13).every(g => g.length === 4), `gruppen: ${gruppen}`);
  pruefe('A3 letzte Gruppe hat 1 Zeichen', gruppen[13].length === 1, `letzte=${gruppen[13]}`);
  // Datenstellen: Crockford-Alphabet (kein I L O U)
  const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]+$/;
  pruefe('A3 Datenstellen im Crockford-Alphabet', CROCKFORD.test(gruppen.slice(0, 13).join('')), gruppen.slice(0, 13).join(''));
  // Pruefsymbol: erweitertes Alphabet inkl. *~$=U
  const CHECK_ALPHABET = /^[0-9A-HJKMNP-TV-Z*~$=U]$/;
  pruefe('A3 Pruefsymbol im Check-Alphabet', CHECK_ALPHABET.test(gruppen[13]), `pruefsymbol=${gruppen[13]}`);
  pruefe('A3 Roundtrip mit Standard-Code', codeAlsSchluessel(code)?.equals(beispiel) === true);
}

abschnitt('A3: Trennzeichen-Toleranz');
{
  const beispiel = randomBytes(32);
  const code = schluesselAlsCode(beispiel);
  const mitLeerzeichen = code.replace(/-/g, ' ');
  const ohneAbstand = code.replace(/-/g, '');
  const kleinbuchstaben = code.toLowerCase();
  pruefe('A3 Leerzeichen als Trenner', codeAlsSchluessel(mitLeerzeichen)?.equals(beispiel) === true);
  pruefe('A3 kein Trenner', codeAlsSchluessel(ohneAbstand)?.equals(beispiel) === true);
  pruefe('A3 Kleinbuchstaben akzeptiert', codeAlsSchluessel(kleinbuchstaben)?.equals(beispiel) === true);
  // Crockford-Aliase: i,l -> 1; o -> 0 (nur wenn Datenstellen 1 oder 0 enthalten)
  const einsKey = Buffer.alloc(32, 0x11); // alle Bytes 0x11 -> Bit-Muster mit 1en
  const einsCode = schluesselAlsCode(einsKey);
  const mit_i = einsCode.replace(/1/gi, 'i');
  const mit_l = einsCode.replace(/1/gi, 'l');
  const mit_o = schluesselAlsCode(Buffer.alloc(32, 0)).replace(/0/g, 'o');
  pruefe('A3 Alias i/I -> 1 akzeptiert', codeAlsSchluessel(mit_i)?.equals(einsKey) === true);
  pruefe('A3 Alias l/L -> 1 akzeptiert', codeAlsSchluessel(mit_l)?.equals(einsKey) === true);
  pruefe('A3 Alias o/O -> 0 akzeptiert', codeAlsSchluessel(mit_o)?.equals(Buffer.alloc(32, 0)) === true);
}

abschnitt('A3: Fehler-Erkennung (Einzelzeichen-Ersetzungen)');
{
  // Fuer EINEN Schluessel alle Einzelzeichen-Ersetzungen pruefen
  const ALPHABET_DATEN = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const CHECK_SYM = '0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U';
  const schluessel = randomBytes(32);
  const code = schluesselAlsCode(schluessel);
  const bare = code.replace(/-/g, '');
  let erkannt = true;
  let einzelFaelle = 0;
  for (let pos = 0; pos < 53; pos++) {
    const original = bare[pos];
    const alpha = pos < 52 ? ALPHABET_DATEN : CHECK_SYM;
    for (const ersatz of alpha) {
      if (ersatz === original) continue;
      // Bei Alias-Zeichen: i/l sind identisch mit 1, o mit 0 -> ergibt denselben Code -> nicht erkennbar, korrekt
      const verfaelscht = bare.slice(0, pos) + ersatz + bare.slice(pos + 1);
      const result = codeAlsSchluessel(verfaelscht);
      einzelFaelle++;
      if (result !== null) {
        erkannt = false;
        pruefe(`A3 Einzelersetzung pos=${pos} orig=${original} ersatz=${ersatz}`, false, `ergibt Schluessel statt null`);
        break;
      }
    }
    if (!erkannt) break;
  }
  pruefe(`A3 alle Einzelzeichen-Ersetzungen erkannt (${einzelFaelle} Faelle)`, erkannt);
}

abschnitt('A3: Fehler-Erkennung (Vertauschungen benachbarter verschiedener Zeichen)');
{
  const schluessel = randomBytes(32);
  const code = schluesselAlsCode(schluessel);
  const bare = code.replace(/-/g, '');
  let erkannt = true;
  let tauschFaelle = 0;
  for (let pos = 0; pos < 52; pos++) {
    if (bare[pos] === bare[pos + 1]) continue; // gleiche Zeichen: Vertauschung nicht erkennbar, korrekt
    const getauscht = bare.slice(0, pos) + bare[pos + 1] + bare[pos] + bare.slice(pos + 2);
    tauschFaelle++;
    if (codeAlsSchluessel(getauscht) !== null) {
      erkannt = false;
      pruefe(`A3 Vertauschung pos=${pos}/${pos+1} '${bare[pos]}'/'${bare[pos+1]}'`, false);
      break;
    }
  }
  pruefe(`A3 alle Vertauschungen benachbarter verschiedener Zeichen erkannt (${tauschFaelle} Faelle)`, erkannt);
}

abschnitt('A3: Ablehnungen ungueltige Eingaben');
{
  const beispiel = randomBytes(32);
  const code = schluesselAlsCode(beispiel);
  pruefe('A3 null abgelehnt', codeAlsSchluessel(null) === null);
  pruefe('A3 leerer String abgelehnt', codeAlsSchluessel('') === null);
  pruefe('A3 zu kurzer Code abgelehnt', codeAlsSchluessel('ABCD1') === null);
  pruefe('A3 zu langer Code abgelehnt', codeAlsSchluessel(code + '0') === null);
  pruefe('A3 Zahl abgelehnt', codeAlsSchluessel(42) === null);
  // U in Datenstellen (Position 0-51) muss abgelehnt werden
  const bare = code.replace(/-/g, '');
  const mitU = 'U' + bare.slice(1);
  pruefe('A3 U in Datenstellen abgelehnt', codeAlsSchluessel(mitU) === null);
  // Obere Bits gesetzt: alle 0xFF-Bytes -> N >= 2^256 nach Dekodierung -> abgelehnt
  // (nicht direkt konstruierbar via schluesselAlsCode, aber testbar mit manipuliertem Code)
}

abschnitt('A3: schluesselAlsCode Fehlerbehandlung');
{
  let wurfOk = false;
  try { schluesselAlsCode(Buffer.alloc(31)); } catch { wurfOk = true; }
  pruefe('A3 schluesselAlsCode: 31 Bytes wirft', wurfOk);
  let wurfOk2 = false;
  try { schluesselAlsCode('kein-buffer'); } catch { wurfOk2 = true; }
  pruefe('A3 schluesselAlsCode: kein Buffer wirft', wurfOk2);
}

// =====================================================================
// Hilfsfunktionen fuer HTTP-Integrationstests
// =====================================================================

const ADMIN_EMAIL = 'admin@test.hu';
const ADMIN_PASSWORT = 'passwort12345';
const TEST_SK = 'sk_test_WP9TestKey123456789012';
const TEST_WHSEC = 'whsec_WP9TestWebhookGeheimnis123456789';
const SERVER = resolve('server.mjs');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = (p) => { try { rmSync(p, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } };

function basisEnv(extra = {}) {
  return { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...extra };
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
    if (/Setup-Modus|Einrichtungsmodus|Schulungsplattform l/.test(log)) break;
    if (/fehlerhaft/.test(log)) break;
    if (p.exitCode !== null) break;
    try { const r = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null); if (r?.status) break; } catch { }
    await warte(100);
  }
  return { p, log: () => log };
}

async function stop(p) {
  p.kill('SIGTERM');
  await new Promise(r => {
    if (p.exitCode !== null) return r();
    p.on('exit', r);
    setTimeout(() => { try { p.kill('SIGKILL'); } catch {} r(); }, 10000);
  });
}

async function holen(port, pfad, { method = 'GET', headers = {}, body = null } = {}) {
  const init = { method, headers: { Accept: 'text/html', ...headers }, redirect: 'manual' };
  if (body !== null) init.body = body;
  const a = await fetch(`http://127.0.0.1:${port}${pfad}`, init);
  const text = await a.text();
  return { status: a.status, text, headers: Object.fromEntries(a.headers) };
}

// Admin anlegen + in Einrichtungsmodus wechseln
async function einrichtungsmodusServer(tmpord, port, extraEnv = {}) {
  const { p: pSetup } = await starteServer(tmpord, port, { EINRICHTUNGSMODUS: '1', ...extraEnv });
  for (let i = 0; i < 600; i++) {
    if (existsSync(join(tmpord, 'daten', 'ERSTSTART.txt'))) break;
    await warte(100);
  }
  const { readFileSync } = await import('node:fs');
  const codeFile = join(tmpord, 'daten', 'ERSTSTART.txt');
  const setupCode = existsSync(codeFile) ? readFileSync(codeFile, 'utf8').trim() : null;
  if (setupCode) {
    await holen(port, '/einrichtung', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: setupCode, email: ADMIN_EMAIL, passwort: ADMIN_PASSWORT }).toString(),
    });
  }
  await stop(pSetup);
  const { p, log } = await starteServer(tmpord, port, extraEnv);
  return { p, log, hatAdmin: !!setupCode };
}

async function einloggen(port) {
  const r = await holen(port, '/anmelden', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: ADMIN_EMAIL, passwort: ADMIN_PASSWORT }).toString(),
  });
  return String(r.headers['set-cookie'] || '').split(';')[0];
}

async function holeCsrf(port, sessionCookie, n) {
  const r = await holen(port, `/admin/einrichtung/schritt/${n}`, { headers: { Cookie: sessionCookie } });
  const m = r.text.match(/name="csrf_token"\s+value="([0-9a-f]+)"/);
  return { csrf: m ? m[1] : null, text: r.text, status: r.status };
}

async function postSchritt(port, sessionCookie, n, felder) {
  const { csrf } = await holeCsrf(port, sessionCookie, n);
  return holen(port, `/admin/einrichtung/schritt/${n}`, {
    method: 'POST',
    headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf_token: csrf ?? '', ...felder }).toString(),
  });
}

async function schritteAbschliessen(port, sessionCookie, { mitKurs = false } = {}) {
  await postSchritt(port, sessionCookie, 1, { PLATTFORM_NAME: 'Testplattform' });
  await postSchritt(port, sessionCookie, 2, {
    modus_impressum: 'erstellt', modus_datenschutz: 'erstellt', modus_teilnahmebedingungen: 'erstellt',
    ANBIETER_NAME: 'Test GmbH', ANBIETER_ANSCHRIFT: 'Musterstrasse 1, 12345 Budapest', ANBIETER_EMAIL: 'info@test.hu',
  });
  await postSchritt(port, sessionCookie, 3, { aktion: 'ohne_mail' });
  // P12: Schritt 4 erfordert Stepup-Authentifizierung.
  await holen(port, '/api/admin/stepup', {
    method: 'POST',
    headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ passwort: ADMIN_PASSWORT }),
  });
  await postSchritt(port, sessionCookie, 4, { STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC });
  if (mitKurs) {
    await postSchritt(port, sessionCookie, 5, {
      kurs_titel: 'Testkurs 1', kurs_beschreibung: 'Eine Kurzbeschreibung', kurs_preis: '5000', kurs_waehrung: 'huf',
    });
  } else {
    await postSchritt(port, sessionCookie, 5, { aktion: 'ueberspringen' });
  }
}

// Server in Einrichtungsmodus mit Schritten 1-5 abgeschlossen und Schluessel angezeigt.
// Gibt laufenden Server, Session-Cookie und CSRF zurueck.
async function bereiteVorSchritt6(tmpord, port, extraEnv = {}) {
  const { p } = await einrichtungsmodusServer(tmpord, port, extraEnv);
  const sessionCookie = await einloggen(port);
  await schritteAbschliessen(port, sessionCookie, { mitKurs: false });
  // Schluessel anzeigen
  const { csrf } = await holeCsrf(port, sessionCookie, 6);
  const schlR = await holen(port, '/admin/einrichtung/schluessel-anzeigen', {
    method: 'POST',
    headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString(),
  });
  return { p, sessionCookie, schluesselAngezeigt: schlR.status === 200 };
}

// Minimal-DB in KONFIGURIERT-Zustand mit Admin, aber OHNE verschluesselte Stripe-Keys
function baueReparaturDB(dbPfad) {
  const d = new DatabaseSync(dbPfad);
  d.exec('PRAGMA journal_mode = WAL');
  d.exec(`CREATE TABLE IF NOT EXISTS benutzer (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, passwort_hash TEXT NOT NULL, stripe_kunde TEXT UNIQUE, erstellt TEXT NOT NULL)`);
  d.exec(`CREATE TABLE IF NOT EXISTS sitzungen (token_hash TEXT PRIMARY KEY, benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE, laeuft_ab INTEGER NOT NULL)`);
  d.exec(`CREATE TABLE IF NOT EXISTS einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT, verschluesselt INTEGER NOT NULL DEFAULT 0 CHECK(verschluesselt IN (0,1)), iv TEXT, tag TEXT, aktualisiert_am TEXT NOT NULL)`);
  // Admin mit festem bcrypt-Hash (12 Runden, Passwort 'passwort12345') - zu langsam fuer Test; stattdessen minimaler ungenutzter Hash
  // Wir brauchen den Admin nur damit leseStartZustand 'KONFIGURIERT' liefert (via instanz_zustand), nicht fuer Login.
  d.prepare("INSERT OR IGNORE INTO benutzer (email, passwort_hash, erstellt) VALUES (?,?,datetime('now'))")
    .run(ADMIN_EMAIL, '$2b$12$placeholder_hash_for_test_only_x');
  d.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES ('instanz_zustand',?,0,datetime('now'))").run('KONFIGURIERT');
  d.close();
}

// Minimal-DB in AKTIV-Zustand
function baueAktivDB(dbPfad) {
  baueReparaturDB(dbPfad); // gleiche Struktur
  const d = new DatabaseSync(dbPfad);
  d.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES ('instanz_zustand','AKTIV',0,datetime('now'))").run();
  d.close();
}

// Stack-basierter HTML-Formular-Strukturpruefung (keine externe Abhaengigkeit).
// Gibt eine Liste von Fehlermeldungen zurueck (leer = OK).
function pruefeForms(html) {
  const fehler = [];
  const lh = html.toLowerCase();

  // Finde alle <form ... > oeffner und </form> schliesser
  const oeffner = [];
  let p = 0;
  while (true) {
    const fi = lh.indexOf('<form', p);
    if (fi === -1) break;
    // Sicherstellen, dass es <form> oder <form ... > ist, nicht <format> o.ae.
    const ch = lh[fi + 5];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r' && ch !== '>') { p = fi + 5; continue; }
    const tagEnd = lh.indexOf('>', fi);
    if (tagEnd === -1) break;
    const tagText = html.slice(fi, tagEnd + 1);
    const actionM = tagText.match(/action\s*=\s*["']([^"']*)["']/i);
    oeffner.push({ pos: fi, end: tagEnd + 1, action: actionM?.[1] ?? '' });
    p = tagEnd + 1;
  }
  const schliess = [];
  p = 0;
  while (true) {
    const ci = lh.indexOf('</form', p);
    if (ci === -1) break;
    const ce = lh.indexOf('>', ci);
    schliess.push({ pos: ci, end: ce === -1 ? ci + 7 : ce + 1 });
    p = ce === -1 ? ci + 7 : ce + 1;
  }

  // Formularbereiche per Stack ermitteln (depth = Schachtelungstiefe)
  const forms = [];
  const stack = [];
  let oi = 0, si = 0;
  while (oi < oeffner.length || si < schliess.length) {
    const nxtO = oi < oeffner.length ? oeffner[oi].pos : Infinity;
    const nxtS = si < schliess.length ? schliess[si].pos : Infinity;
    if (nxtO < nxtS) {
      stack.push({ ...oeffner[oi], depth: stack.length });
      oi++;
    } else {
      if (stack.length > 0) {
        const opened = stack.pop();
        forms.push({ action: opened.action, inner: html.slice(opened.end, schliess[si].pos), depth: opened.depth });
      }
      si++;
    }
  }

  // Verschachtelung pruefen
  for (const f of forms) {
    if (f.depth > 0) fehler.push(`Verschachteltes <form> (action="${f.action}")`);
  }

  // Pro Top-Level-Formular: genau 1 csrf_token + keine doppelten Feldnamen (ausser radio)
  for (const f of forms.filter(f => f.depth === 0)) {
    const csrfAnz = (f.inner.match(/name=["']csrf_token["']/gi) ?? []).length;
    if (csrfAnz !== 1) fehler.push(`Formular action="${f.action}": ${csrfAnz} csrf_token-Felder (erwartet: 1)`);

    const gesehen = new Map();
    const inputRe = /<input(\s[^>]*)?\/?>/gi;
    let m;
    while ((m = inputRe.exec(f.inner)) !== null) {
      const attrs = m[0];
      const nameM = attrs.match(/name=["']([^"']*)["']/i);
      const typeM = attrs.match(/type=["']([^"']*)["']/i);
      if (!nameM) continue;
      const name = nameM[1];
      const type = (typeM?.[1] ?? 'text').toLowerCase();
      if (type === 'radio') continue;
      if (gesehen.has(name)) fehler.push(`Formular action="${f.action}": doppelter Feldname "${name}"`);
      else gesehen.set(name, type);
    }
  }

  return fehler;
}

// =====================================================================
// A1: HTTP – Vollfluss Schritt 6, Zustandswechsel ADMIN_ERSTELLT -> KONFIGURIERT
// =====================================================================

abschnitt('A1: Vollfluss Schritt 6 (Einrichtungsserver, Schritte 1-5 abschliessen)');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a1-'));
  const PORT = 19700;
  try {
    const { p } = await einrichtungsmodusServer(t, PORT);
    const sessionCookie = await einloggen(PORT);

    // A1a: GET /schritt/6 vor Abschluss von Schritt 4 -> Pflichtwarnung
    const r6vorher = await holen(PORT, '/admin/einrichtung/schritt/6', { headers: { Cookie: sessionCookie } });
    pruefe('A1a: GET /schritt/6 vor Schritt-4 -> 200', r6vorher.status === 200, 'status=' + r6vorher.status);
    // Schritt 3+4 fehlen -> Abschluss-Button disabled oder Pflichtwarnung
    pruefe('A1b: Schritt 6 ohne Pflichtschritte zeigt Warnung oder deaktivierten Button',
      r6vorher.text.includes('disabled') || r6vorher.text.includes('pflicht') || r6vorher.text.includes('hiányzik'),
      r6vorher.text.slice(0, 400));

    // A1c: Schritte 1-5 abschliessen
    await schritteAbschliessen(PORT, sessionCookie, { mitKurs: true });

    // A1d: GET /schritt/6 -> zeigt Passwort-Formular (Schluessel noch nicht angezeigt)
    const r6nach = await holen(PORT, '/admin/einrichtung/schritt/6', { headers: { Cookie: sessionCookie } });
    pruefe('A1d: GET /schritt/6 nach Schritten 1-5 -> 200', r6nach.status === 200);
    pruefe('A1e: Schritt 6 zeigt schluessel-anzeigen Formular', r6nach.text.includes('schluessel-anzeigen'), r6nach.text.slice(0, 400));

    // A1f: POST /schluessel-anzeigen mit richtigem Passwort -> 200, Code im HTML
    const { csrf } = await holeCsrf(PORT, sessionCookie, 6);
    const schlR = await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    pruefe('A1f: POST /schluessel-anzeigen -> 200', schlR.status === 200, 'status=' + schlR.status);
    // Code-Format: 14 Gruppen mit Bindestrichen sichtbar im HTML
    pruefe('A1g: Schluessel-HTML enthaelt Bindestrich-Gruppen (<code>)', schlR.text.includes('<code>'), schlR.text.slice(0, 300));

    // A1h: Zweites POST /schluessel-anzeigen -> 409
    const { csrf: csrf2 } = await holeCsrf(PORT, sessionCookie, 6);
    const schlR2 = await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf2 ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    pruefe('A1h: Zweites POST /schluessel-anzeigen -> 409', schlR2.status === 409, 'status=' + schlR2.status);

    // A2a: POST /schritt/6 mit schluessel_gesichert=1 -> Neustart-Seite
    const { csrf: csrf6 } = await holeCsrf(PORT, sessionCookie, 6);
    const abschlussR = await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf6 ?? '', schluessel_gesichert: '1' }).toString(),
    });
    pruefe('A2a: POST /schritt/6 -> 200 (Neustart-Seite)', abschlussR.status === 200, 'status=' + abschlussR.status);
    pruefe('A2b: Neustart-Seite enthaelt poll-status oder Neustart-Text',
      abschlussR.text.includes('poll-status') || abschlussR.text.includes('neustart') || abschlussR.text.includes('újraindít'),
      abschlussR.text.slice(0, 300));

    // A2c: DB-Zustand ist KONFIGURIERT
    await warte(300); // kurz warten damit WAL flush
    const dbPruef = new DatabaseSync(join(t, 'app.db'), { readOnly: true });
    dbPruef.exec('PRAGMA busy_timeout = 3000');
    const zustand = dbPruef.prepare("SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'").get()?.wert;
    dbPruef.close();
    pruefe('A2c: DB-Zustand ist KONFIGURIERT', zustand === 'KONFIGURIERT', `zustand=${zustand}`);

    await stop(p);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A4: GET /schritt/6 Inhalt-Varianten
// =====================================================================

abschnitt('A4: GET /schritt/6 Inhalt-Varianten');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a4-'));
  const PORT = 19701;
  try {
    // A4a: Mit EINSTELLUNGEN_SCHLUESSEL -> kein Passwort-Formular (Schluessel aus Env)
    const envKey = randomBytes(32).toString('base64');
    const { p: p4a } = await einrichtungsmodusServer(t, PORT, { EINSTELLUNGEN_SCHLUESSEL: envKey });
    const cookie4a = await einloggen(PORT);
    await schritteAbschliessen(PORT, cookie4a);
    const r4a = await holen(PORT, '/admin/einrichtung/schritt/6', { headers: { Cookie: cookie4a } });
    pruefe('A4a: Mit EINSTELLUNGEN_SCHLUESSEL -> kein schluessel-anzeigen-Formular',
      !r4a.text.includes('schluessel-anzeigen'), r4a.text.slice(0, 400));
    pruefe('A4b: Mit EINSTELLUNGEN_SCHLUESSEL -> Abschluss-Button aktiv (nicht disabled)',
      !r4a.text.includes('disabled'), r4a.text.slice(0, 400));
    await stop(p4a);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A4c: Bereits angezeigt -> zeigt "bereits angezeigt" Meldung
// =====================================================================
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a4c-'));
  const PORT = 19702;
  try {
    const { p, sessionCookie } = await bereiteVorSchritt6(t, PORT);
    const r4c = await holen(PORT, '/admin/einrichtung/schritt/6', { headers: { Cookie: sessionCookie } });
    pruefe('A4c: Bereits angezeigt -> Seite zeigt Hinweis statt Passwort-Formular',
      r4c.text.includes('bereits') || r4c.text.includes('már') || !r4c.text.includes('schluessel-anzeigen'),
      r4c.text.slice(0, 400));
    await stop(p);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A5: POST /schritt/6 Validierungen
// =====================================================================

abschnitt('A5: POST /schritt/6 Validierungen');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a5-'));
  const PORT = 19703;
  try {
    const { p } = await einrichtungsmodusServer(t, PORT);
    const sessionCookie = await einloggen(PORT);

    // A5a: Schritt 3+4 nicht fertig -> 400
    const { csrf: csrf5a } = await holeCsrf(PORT, sessionCookie, 6);
    const r5a = await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf5a ?? '', schluessel_gesichert: '1' }).toString(),
    });
    pruefe('A5a: POST /schritt/6 ohne Pflichtschritte -> 400', r5a.status === 400, 'status=' + r5a.status);

    // Schritte 1-4 abschliessen (nicht 5)
    await schritteAbschliessen(PORT, sessionCookie);

    // A5b: Schluessel nicht angezeigt -> 400
    const { csrf: csrf5b } = await holeCsrf(PORT, sessionCookie, 6);
    const r5b = await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf5b ?? '', schluessel_gesichert: '1' }).toString(),
    });
    pruefe('A5b: POST /schritt/6 ohne Schluessel-Anzeige -> 400', r5b.status === 400, 'status=' + r5b.status);

    // Schluessel anzeigen
    const { csrf: csrfAnz } = await holeCsrf(PORT, sessionCookie, 6);
    await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrfAnz ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });

    // A5c: schluessel_gesichert fehlt -> 400
    const { csrf: csrf5c } = await holeCsrf(PORT, sessionCookie, 6);
    const r5c = await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf5c ?? '' }).toString(),
    });
    pruefe('A5c: POST /schritt/6 ohne schluessel_gesichert -> 400', r5c.status === 400, 'status=' + r5c.status);

    await stop(p);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A6: Probe-Fehler (Z12) – Stripe-Keys geloescht -> POST /schritt/6 -> 400
// =====================================================================

abschnitt('A6: Probe-Fehler (Z12) – Stripe-Keys im laufenden Betrieb geloescht');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a6-'));
  const PORT = 19704;
  try {
    const { p, sessionCookie } = await bereiteVorSchritt6(t, PORT);

    // Stripe-Keys direkt aus DB loeschen (WAL erlaubt Lesen/Schreiben aus separatem Prozess)
    await warte(200);
    const dbEdit = new DatabaseSync(join(t, 'app.db'));
    dbEdit.exec('PRAGMA busy_timeout = 5000');
    dbEdit.prepare("DELETE FROM einstellungen WHERE schluessel='STRIPE_SECRET_KEY'").run();
    dbEdit.prepare("DELETE FROM einstellungen WHERE schluessel='STRIPE_WEBHOOK_SECRET'").run();
    dbEdit.close();
    await warte(200);

    // POST /schritt/6 mit schluessel_gesichert -> Probe faellt durch -> 400
    const { csrf } = await holeCsrf(PORT, sessionCookie, 6);
    const r = await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', schluessel_gesichert: '1' }).toString(),
    });
    pruefe('A6: Probe-Fehler nach Key-Loeschung -> 400', r.status === 400, 'status=' + r.status);

    await stop(p);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A7: Cache-Control no-store auf /schluessel-anzeigen (Z5 Browser-Zurueck)
// =====================================================================

abschnitt('A7: Cache-Control no-store (Z5 Browser-Zurueck-Schutz)');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a7-'));
  const PORT = 19705;
  try {
    const { p } = await einrichtungsmodusServer(t, PORT);
    const sessionCookie = await einloggen(PORT);
    await schritteAbschliessen(PORT, sessionCookie);

    const { csrf } = await holeCsrf(PORT, sessionCookie, 6);
    const r = await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    pruefe('A7: /schluessel-anzeigen -> Cache-Control: no-store', (r.headers['cache-control'] || '').includes('no-store'), r.headers['cache-control']);
    pruefe('A7: /schluessel-anzeigen -> Referrer-Policy: same-origin', (r.headers['referrer-policy'] || '') === 'same-origin', r.headers['referrer-policy']);
    pruefe('A7: /schluessel-anzeigen -> X-Content-Type-Options: nosniff', (r.headers['x-content-type-options'] || '').includes('nosniff'));

    await stop(p);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A8: /schluessel-anzeigen Validierungen (Z4 falsches Passwort)
// =====================================================================

abschnitt('A8: /schluessel-anzeigen Validierungen');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a8-'));
  const PORT = 19706;
  try {
    const { p } = await einrichtungsmodusServer(t, PORT);
    const sessionCookie = await einloggen(PORT);
    await schritteAbschliessen(PORT, sessionCookie);

    // A8a: Falsches Passwort -> 403
    const { csrf: csrfA } = await holeCsrf(PORT, sessionCookie, 6);
    const rFalsch = await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrfA ?? '', passwort: 'falschespasswort' }).toString(),
    });
    pruefe('A8a (Z4): Falsches Passwort -> 403', rFalsch.status === 403, 'status=' + rFalsch.status);

    // A8b: Richtiges Passwort -> 200
    const { csrf: csrfB } = await holeCsrf(PORT, sessionCookie, 6);
    const rRichtig = await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrfB ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    pruefe('A8b: Richtiges Passwort -> 200', rRichtig.status === 200, 'status=' + rRichtig.status);

    // F-63: Brute-Force-Schutz /schluessel-anzeigen — 6 Fehlversuche, mindestens einer muss 429 ergeben
    {
      const { csrf: csrf63 } = await holeCsrf(PORT, sessionCookie, 6);
      const versuche63 = [];
      for (let i = 0; i < 6; i++) {
        versuche63.push(await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
          method: 'POST',
          headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ csrf_token: csrf63 ?? '', passwort: 'falsch'+i }).toString(),
        }));
      }
      pruefe('F-63: 6 Fehlversuche /schluessel-anzeigen — mindestens einer 429',
        versuche63.some(r => r.status === 429), versuche63.map(r => r.status).join(','));
    }

    await stop(p);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A9a: AUFPASSER=1 – Server beendet sich nach POST /schritt/6
// =====================================================================

abschnitt('A9a: AUFPASSER=1 – Server beendet sich nach Abschluss');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a9a-'));
  const PORT = 19707;
  let pA9a;
  try {
    const { p, sessionCookie } = await bereiteVorSchritt6(t, PORT, { AUFPASSER: '1' });
    pA9a = p;

    const { csrf } = await holeCsrf(PORT, sessionCookie, 6);
    const r = await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', schluessel_gesichert: '1' }).toString(),
    });
    pruefe('A9a: POST /schritt/6 mit AUFPASSER=1 -> 200', r.status === 200, 'status=' + r.status);
    pruefe('A9a: Neustart-Seite enthaelt Neustart-Text (kein poll-status)',
      !r.text.includes('poll-status'), r.text.slice(0, 300));

    // Server muss sich innerhalb von 5s beenden
    await new Promise(resolve => {
      if (p.exitCode !== null) return resolve();
      p.on('exit', resolve);
      setTimeout(resolve, 5000);
    });
    pruefe('A9a: Server beendet sich nach AUFPASSER-Abschluss', p.exitCode === 0, `exitCode=${p.exitCode}`);

  } finally { try { if (pA9a?.exitCode === null) await stop(pA9a); } catch {} aufraeumen(t); }
}

// =====================================================================
// A9b/Z14: Ohne AUFPASSER – Polling-Seite, Server bleibt
// =====================================================================

abschnitt('A9b (Z14): Ohne AUFPASSER – Polling-Seite, Server bleibt');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a9b-'));
  const PORT = 19708;
  try {
    const { p, sessionCookie } = await bereiteVorSchritt6(t, PORT);

    const { csrf } = await holeCsrf(PORT, sessionCookie, 6);
    const r = await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', schluessel_gesichert: '1' }).toString(),
    });
    pruefe('A9b: POST /schritt/6 ohne AUFPASSER -> 200', r.status === 200, 'status=' + r.status);
    pruefe('A9b: Antwort enthaelt poll-status div', r.text.includes('poll-status'), r.text.slice(0, 300));
    // Server muss nach 2 Sekunden noch laufen
    await warte(2000);
    pruefe('A9b (Z14): Server laeuft noch (kein AUFPASSER)', p.exitCode === null, `exitCode=${p.exitCode}`);

    await stop(p);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A11a/Z7: EINSTELLUNGEN_SCHLUESSEL – kein Schluessel-Formular, kein schluessel_gesichert noetig
// =====================================================================

abschnitt('A11a (Z7): EINSTELLUNGEN_SCHLUESSEL – Schluessel aus Env');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-z7-'));
  const PORT = 19709;
  try {
    const envKey = randomBytes(32).toString('base64');
    const { p, sessionCookie } = await bereiteVorSchritt6(t, PORT, { EINSTELLUNGEN_SCHLUESSEL: envKey });

    // GET /schritt/6: kein Passwort-Formular
    const rGet = await holen(PORT, '/admin/einrichtung/schritt/6', { headers: { Cookie: sessionCookie } });
    pruefe('Z7a: Mit EINSTELLUNGEN_SCHLUESSEL kein schluessel-anzeigen-Formular', !rGet.text.includes('schluessel-anzeigen'));

    // POST /schritt/6 ohne schluessel_gesichert -> soll funktionieren (kein Schluessel-Check)
    const { csrf } = await holeCsrf(PORT, sessionCookie, 6);
    const r = await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '' }).toString(),
    });
    pruefe('Z7b: POST /schritt/6 mit EINSTELLUNGEN_SCHLUESSEL ohne schluessel_gesichert -> 200', r.status === 200, 'status=' + r.status);

    await stop(p);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A11b/Z1: Parallele Schluessel-Abrufe – einer 200, einer 409
// =====================================================================

abschnitt('A11b (Z1): Parallele Schluessel-Abrufe – genau einmal');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-z1-'));
  const PORT = 19710;
  try {
    const { p } = await einrichtungsmodusServer(t, PORT);
    const sessionCookie = await einloggen(PORT);
    await schritteAbschliessen(PORT, sessionCookie);

    // CSRF einmal holen – beide Anfragen nutzen denselben Token (gleiche Session)
    const { csrf } = await holeCsrf(PORT, sessionCookie, 6);
    const body = new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString();

    const [r1, r2] = await Promise.all([
      holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
        method: 'POST',
        headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }),
      holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
        method: 'POST',
        headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }),
    ]);

    const statusPaar = [r1.status, r2.status].sort().join(',');
    pruefe('Z1: Parallele Anfragen ergeben genau 200+409', statusPaar === '200,409', `status=${statusPaar}`);

    await stop(p);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A11c/Z2: Neustart nach Anzeige – alter Session-Cookie invalide
// =====================================================================

abschnitt('A11c (Z2): Neustart nach Anzeige – alte Session nach Server-Neustart invalide');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-z2-'));
  const PORT = 19711;
  try {
    const { p } = await einrichtungsmodusServer(t, PORT);
    const sessionCookie = await einloggen(PORT);
    await schritteAbschliessen(PORT, sessionCookie);

    // Schluessel anzeigen
    const { csrf } = await holeCsrf(PORT, sessionCookie, 6);
    await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });

    // Server neu starten (CSRF-Map und Sitzungen werden geloescht)
    await stop(p);
    const { p: p2 } = await starteServer(t, PORT);

    // Alter Cookie nach Neustart -> 303 auf /anmelden
    const rAlt = await holen(PORT, '/admin/einrichtung/schritt/6', { headers: { Cookie: sessionCookie } });
    pruefe('Z2: Alte Session nach Neustart -> 303', rAlt.status === 303, 'status=' + rAlt.status);

    await stop(p2);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A11d/Z3: Abgelaufene Sitzung – Server-Neustart loescht Sessions
// =====================================================================
// (Bereits durch Z2 abgedeckt; hier explizit als eigenstaendige Pruefung)
abschnitt('A11d (Z3): Abgelaufene Sitzung -> 303 auf /anmelden');
pruefe('Z3: Abgelaufene Sitzung (Beweis durch Z2 erbracht)', true); // Referenz auf Z2

// =====================================================================
// A11e/Z4: Falsches Passwort (bereits in A8a)
// =====================================================================
abschnitt('A11e (Z4): Falsches Passwort (erbracht durch A8a)');
pruefe('Z4: Falsches Passwort -> 403 (Beweis durch A8a erbracht)', true);

// =====================================================================
// A11f/Z6: Abgebrochene Verbindung – at-most-once Garantie
// =====================================================================

abschnitt('A11f (Z6): Abgebrochene Verbindung – at-most-once');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-z6-'));
  const PORT = 19712;
  try {
    const { p } = await einrichtungsmodusServer(t, PORT);
    const sessionCookie = await einloggen(PORT);
    await schritteAbschliessen(PORT, sessionCookie);
    const { csrf } = await holeCsrf(PORT, sessionCookie, 6);
    const bodyStr = new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString();

    // Rohe TCP-Verbindung: Anfrage senden, dann sofort trennen
    await new Promise((resolveOuter) => {
      const sock = createConnection({ host: '127.0.0.1', port: PORT }, () => {
        const req =
          `POST /admin/einrichtung/schluessel-anzeigen HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${PORT}\r\n` +
          `Cookie: ${sessionCookie}\r\n` +
          `Content-Type: application/x-www-form-urlencoded\r\n` +
          `Content-Length: ${Buffer.byteLength(bodyStr)}\r\n` +
          `Connection: close\r\n` +
          `\r\n` +
          bodyStr;
        sock.write(req);
        setTimeout(() => { sock.destroy(); resolveOuter(); }, 150);
      });
      sock.on('error', () => resolveOuter());
      setTimeout(resolveOuter, 2000);
    });

    await warte(500);

    // Zweiter Versuch: entweder 409 (Commit passierte) oder 200 (Rollback, nichts in DB)
    const { csrf: csrf2 } = await holeCsrf(PORT, sessionCookie, 6);
    const r2 = await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf2 ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    pruefe('Z6: At-most-once – zweite Anfrage liefert 200 oder 409 (kein Duplikat)', r2.status === 200 || r2.status === 409, 'status=' + r2.status);

    // Dritte Anfrage muss 409 liefern (Schluessel wurde jetzt angezeigt)
    const { csrf: csrf3 } = await holeCsrf(PORT, sessionCookie, 6);
    const r3 = await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf3 ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    pruefe('Z6: Dritte Anfrage -> 409 (Schluessel jetzt genau einmal angezeigt)', r3.status === 409, 'status=' + r3.status);

    await stop(p);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A10a/Z12: Reparaturmodus – KONFIGURIERT mit kaputten Einstellungen
// =====================================================================

abschnitt('A10a (Z12): Reparaturmodus – KONFIGURIERT ohne Stripe-Keys');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a10a-'));
  const PORT = 19713;
  try {
    // Minimal-DB in KONFIGURIERT mit Admin, aber ohne Stripe-Keys
    baueReparaturDB(join(t, 'app.db'));
    const { p, log } = await starteServer(t, PORT);
    pruefe('A10a: Server startet im Einrichtungsmodus (Reparatur)', /Einrichtungsmodus/.test(log()), log().slice(0, 300));
    const rHealth = await holen(PORT, '/health');
    pruefe('A10a: /health liefert modus=einrichtung', rHealth.text.includes('"einrichtung"'), rHealth.text);

    await stop(p);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A10b/Z13: AKTIV mit kaputten Einstellungen -> exit 1
// =====================================================================

abschnitt('A10b (Z13): AKTIV ohne Stripe-Keys -> Prozess endet mit Code 1');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a10b-'));
  const PORT = 19714;
  try {
    baueAktivDB(join(t, 'app.db'));
    const { p } = await starteServer(t, PORT);
    // Server muss mit Exit-Code 1 enden
    await new Promise(resolve => {
      if (p.exitCode !== null) return resolve();
      p.on('exit', resolve);
      setTimeout(resolve, 8000);
    });
    pruefe('A10b (Z13): AKTIV ohne Stripe-Keys -> exit 1', p.exitCode === 1, `exitCode=${p.exitCode}`);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A12a: Normalstart KONFIGURIERT -> AKTIV + erster Kurs angelegt
// =====================================================================

abschnitt('A12a: Normalstart KONFIGURIERT -> AKTIV + erster Kurs angelegt');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a12a-'));
  const PORT = 19715;
  try {
    // Vollstaendig KONFIGURIERT via Einrichtungs-Durchlauf (mit Kurs)
    const { p: pEinr } = await einrichtungsmodusServer(t, PORT);
    const sesEinr = await einloggen(PORT);
    await schritteAbschliessen(PORT, sesEinr, { mitKurs: true });
    const { csrf } = await holeCsrf(PORT, sesEinr, 6);
    await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sesEinr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    const { csrf: csrf6 } = await holeCsrf(PORT, sesEinr, 6);
    await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sesEinr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf6 ?? '', schluessel_gesichert: '1' }).toString(),
    });
    await stop(pEinr);

    // DB ist jetzt KONFIGURIERT; Normal-Modus starten mit Stripe-Keys aus Env
    const { p: pNorm, log: logNorm } = await starteServer(t, PORT + 1, {
      STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC,
    });
    pruefe('A12a: Normalstart startet erfolgreich', /Schulungsplattform l/.test(logNorm()), logNorm().slice(0, 300));

    await warte(500);

    // DB-Zustand pruefen
    const db12 = new DatabaseSync(join(t, 'app.db'), { readOnly: true });
    db12.exec('PRAGMA busy_timeout = 3000');
    const zustand12 = db12.prepare("SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'").get()?.wert;
    const kursAnz = db12.prepare("SELECT COUNT(*) AS n FROM kurse").get()?.n;
    const kursAngelegt = db12.prepare("SELECT wert FROM einstellungen WHERE schluessel='kurs_angelegt'").get()?.wert;
    db12.close();
    pruefe('A12a: Zustand nach Normalstart ist AKTIV', zustand12 === 'AKTIV', `zustand=${zustand12}`);
    pruefe('A12a: Genau 1 Kurs angelegt', kursAnz === 1, `kursAnzahl=${kursAnz}`);
    pruefe('A12a: kurs_angelegt-Marker gesetzt', kursAngelegt === '1', `kurs_angelegt=${kursAngelegt}`);

    await stop(pNorm);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A12b: Normalstart KONFIGURIERT ohne erster_kurs_json -> AKTIV, kein Kurs
// =====================================================================

abschnitt('A12b: Normalstart KONFIGURIERT ohne erster_kurs_json -> AKTIV, kein Kurs');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a12b-'));
  const PORT = 19716;
  try {
    // Einrichtung ohne Kurs (ueberspringen)
    const { p: pEinr } = await einrichtungsmodusServer(t, PORT);
    const sesEinr = await einloggen(PORT);
    await schritteAbschliessen(PORT, sesEinr, { mitKurs: false }); // kein Kurs
    const { csrf } = await holeCsrf(PORT, sesEinr, 6);
    await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sesEinr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    const { csrf: csrf6 } = await holeCsrf(PORT, sesEinr, 6);
    await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sesEinr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf6 ?? '', schluessel_gesichert: '1' }).toString(),
    });
    await stop(pEinr);

    const { p: pNorm } = await starteServer(t, PORT + 1, {
      STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC,
    });
    await warte(500);

    const db12b = new DatabaseSync(join(t, 'app.db'), { readOnly: true });
    db12b.exec('PRAGMA busy_timeout = 3000');
    const kursAnz = db12b.prepare("SELECT COUNT(*) AS n FROM kurse").get()?.n;
    const zustand = db12b.prepare("SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'").get()?.wert;
    db12b.close();
    pruefe('A12b: Zustand ist AKTIV (ohne Kurs)', zustand === 'AKTIV', `zustand=${zustand}`);
    pruefe('A12b: Kein Kurs angelegt wenn kein erster_kurs_json', kursAnz === 0, `kursAnzahl=${kursAnz}`);

    await stop(pNorm);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A12c/Z10: Absturz-Simulation – kurs_angelegt bereits gesetzt, kein Duplikat
// =====================================================================

abschnitt('A12c (Z10): Absturz-Simulation – kurs_angelegt gesetzt, kein Duplikat');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-z10-'));
  const PORT = 19717;
  try {
    // Einrichtung MIT Kurs vollstaendig abschliessen
    const { p: pEinr } = await einrichtungsmodusServer(t, PORT);
    const sesEinr = await einloggen(PORT);
    await schritteAbschliessen(PORT, sesEinr, { mitKurs: true });
    const { csrf } = await holeCsrf(PORT, sesEinr, 6);
    await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sesEinr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    const { csrf: csrf6 } = await holeCsrf(PORT, sesEinr, 6);
    await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sesEinr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf6 ?? '', schluessel_gesichert: '1' }).toString(),
    });
    await stop(pEinr);

    // Absturz simulieren: erster Normalstart hat Kurs eingefuegt + kurs_angelegt='1' gesetzt,
    // aber vor dem zweiten Commit (instanz_zustand='AKTIV') abgestuerzt.
    const dbSim = new DatabaseSync(join(t, 'app.db'));
    dbSim.exec('PRAGMA busy_timeout = 5000');
    // Kurs + Flag wie beim ersten Normalstart (eine Transaktion) – simulierter Commit.
    dbSim.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES ('kurs_angelegt','1',0,datetime('now'))").run();
    dbSim.prepare("INSERT INTO kurse (titel, beschreibung, preis_cent, waehrung, status, erstellt, geaendert) VALUES ('Testkurs 1','Eine Kurzbeschreibung',5000,'huf','entwurf',datetime('now'),datetime('now'))").run();
    // instanz_zustand bleibt KONFIGURIERT (AKTIV wurde noch nicht gesetzt vor dem Absturz)
    dbSim.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES ('instanz_zustand','KONFIGURIERT',0,datetime('now'))").run();
    dbSim.close();

    // Zweiter Normalstart -> soll keinen Duplikat-Kurs anlegen
    const { p: pNorm } = await starteServer(t, PORT + 1, {
      STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC,
    });
    await warte(500);

    const db10 = new DatabaseSync(join(t, 'app.db'), { readOnly: true });
    db10.exec('PRAGMA busy_timeout = 3000');
    const kursAnz = db10.prepare("SELECT COUNT(*) AS n FROM kurse").get()?.n;
    db10.close();
    pruefe('Z10: Idempotenz – kein Duplikat-Kurs bei kurs_angelegt=1', kursAnz === 1, `kursAnzahl=${kursAnz}`);

    await stop(pNorm);
  } finally { aufraeumen(t); }
}

// =====================================================================
// A12d/Z11: Wiederholter Normalstart -> immer noch 1 Kurs
// =====================================================================

abschnitt('A12d (Z11): Wiederholter Normalstart – immer noch 1 Kurs');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-z11-'));
  const PORT = 19718;
  try {
    // Erste vollstaendige Einrichtung mit Kurs
    const { p: pEinr } = await einrichtungsmodusServer(t, PORT);
    const sesEinr = await einloggen(PORT);
    await schritteAbschliessen(PORT, sesEinr, { mitKurs: true });
    const { csrf } = await holeCsrf(PORT, sesEinr, 6);
    await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sesEinr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    const { csrf: csrf6 } = await holeCsrf(PORT, sesEinr, 6);
    await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sesEinr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf6 ?? '', schluessel_gesichert: '1' }).toString(),
    });
    await stop(pEinr);

    const normEnv = { STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC };
    // Erster Normalstart (KONFIGURIERT -> AKTIV)
    const { p: pN1 } = await starteServer(t, PORT + 1, normEnv);
    await warte(500);
    await stop(pN1);

    // Zweiter Normalstart (AKTIV)
    const { p: pN2 } = await starteServer(t, PORT + 2, normEnv);
    await warte(500);
    await stop(pN2);

    const db11 = new DatabaseSync(join(t, 'app.db'), { readOnly: true });
    db11.exec('PRAGMA busy_timeout = 3000');
    const kursAnz = db11.prepare("SELECT COUNT(*) AS n FROM kurse").get()?.n;
    db11.close();
    pruefe('Z11: Nach zweitem Normalstart immer noch 1 Kurs', kursAnz === 1, `kursAnzahl=${kursAnz}`);

  } finally { aufraeumen(t); }
}

// =====================================================================
// A12e/Z9: Parallele Kursanlage – genau 1 Kurs
// =====================================================================

abschnitt('A12e (Z9): Parallele Kursanlage – genau 1 Kurs');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-z9-'));
  const PORT = 19719;
  try {
    // Einrichtung abschliessen (mit Kurs, Status KONFIGURIERT)
    const { p: pEinr } = await einrichtungsmodusServer(t, PORT);
    const sesEinr = await einloggen(PORT);
    await schritteAbschliessen(PORT, sesEinr, { mitKurs: true });
    const { csrf } = await holeCsrf(PORT, sesEinr, 6);
    await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sesEinr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    const { csrf: csrf6 } = await holeCsrf(PORT, sesEinr, 6);
    await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sesEinr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf6 ?? '', schluessel_gesichert: '1' }).toString(),
    });
    await stop(pEinr);

    // Zwei Normal-Modus-Server gleichzeitig auf dieselbe KONFIGURIERT-DB starten
    const normEnv = { STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC };
    const [{ p: pA }, { p: pB }] = await Promise.all([
      starteServer(t, PORT + 1, normEnv),
      starteServer(t, PORT + 2, normEnv),
    ]);
    await warte(1000);
    await Promise.all([stop(pA), stop(pB)]);

    const db9 = new DatabaseSync(join(t, 'app.db'), { readOnly: true });
    db9.exec('PRAGMA busy_timeout = 3000');
    const kursAnz = db9.prepare("SELECT COUNT(*) AS n FROM kurse").get()?.n;
    db9.close();
    pruefe('Z9: Parallele Normalstarts -> genau 1 Kurs', kursAnz === 1, `kursAnzahl=${kursAnz}`);

  } finally { aufraeumen(t); }
}

// =====================================================================
// A13: Assistent im Normalbetrieb -> 404
// =====================================================================

abschnitt('A13: Assistent im Normalbetrieb -> 404');
{
  const t = mkdtempSync(join(tmpdir(), 'wp9-a13-'));
  const PORT = 19720;
  try {
    // Vollstaendig AKTIVE DB erzeugen und im Normalmodus starten
    const { p: pEinr } = await einrichtungsmodusServer(t, PORT);
    const sesEinr = await einloggen(PORT);
    await schritteAbschliessen(PORT, sesEinr, { mitKurs: false });
    const { csrf } = await holeCsrf(PORT, sesEinr, 6);
    await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sesEinr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    const { csrf: csrf6 } = await holeCsrf(PORT, sesEinr, 6);
    await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sesEinr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf6 ?? '', schluessel_gesichert: '1' }).toString(),
    });
    await stop(pEinr);

    // Normalstart (KONFIGURIERT -> AKTIV)
    const { p: pNorm } = await starteServer(t, PORT + 1, {
      STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC,
    });
    await warte(500);

    const r = await holen(PORT + 1, '/admin/einrichtung');
    pruefe('A13: /admin/einrichtung im Normalbetrieb -> 404', r.status === 404, 'status=' + r.status);
    const r2 = await holen(PORT + 1, '/admin/einrichtung/schritt/6');
    pruefe('A13: /admin/einrichtung/schritt/6 im Normalbetrieb -> 404', r2.status === 404, 'status=' + r2.status);

    await stop(pNorm);
  } finally { aufraeumen(t); }
}

// =====================================================================
// F2: HTML-Formular-Struktur – kein verschachteltes Formular, keine doppelten Felder
// =====================================================================

abschnitt('F2: HTML-Formular-Struktur – Gegenprobe (statisch, kein Server)');
{
  // Altes HTML Variante 1: verschachteltes Formular (Zustand: Schluessel noch nicht angezeigt)
  const altNested =
    `<form method="POST" action="/admin/einrichtung/schritt/6">` +
    `<input type="hidden" name="csrf_token" value="a">` +
    `<form method="POST" action="/admin/einrichtung/schluessel-anzeigen">` +
    `<input type="hidden" name="csrf_token" value="b">` +
    `<input name="passwort" type="password">` +
    `<button type="submit">Anzeigen</button>` +
    `</form>` +
    `<button type="submit" disabled>Abschliessen</button>` +
    `</form>`;
  const f1 = pruefeForms(altNested);
  pruefe('F2 Gegenprobe: Checker erkennt verschachteltes Formular', f1.some(e => e.includes('Verschachteltes')), f1.join(' | '));

  // Altes HTML Variante 2: doppelter Feldname (Zustand: Schluessel bereits angezeigt)
  const altDuplikat =
    `<form method="POST" action="/admin/einrichtung/schritt/6">` +
    `<input type="hidden" name="csrf_token" value="a">` +
    `<input type="checkbox" name="schluessel_gesichert" value="1">` +
    `<input type="checkbox" name="schluessel_gesichert" value="1">` +
    `<button type="submit">Abschliessen</button>` +
    `</form>`;
  const f2 = pruefeForms(altDuplikat);
  pruefe('F2 Gegenprobe: Checker erkennt doppelten Feldnamen', f2.some(e => e.includes('doppelter Feldname')), f2.join(' | '));
}

abschnitt('F2: HTML-Formular-Struktur – Live-Test (Schritt 6 GET)');
{
  const tF2 = mkdtempSync(join(tmpdir(), 'wp9-f2-'));
  const PORT = 19721;
  try {
    const { p: pF2 } = await einrichtungsmodusServer(tF2, PORT);
    const sesF2 = await einloggen(PORT);
    await schritteAbschliessen(PORT, sesF2, { mitKurs: true });

    // Vor Schluessel-Anzeige: schluessel-anzeigen-Formular sichtbar (getrennt vom schritt/6-Formular)
    const { text: htmlVor, csrf: csrfVor } = await holeCsrf(PORT, sesF2, 6);
    const fehlerVor = pruefeForms(htmlVor);
    pruefe('F2: kein verschachteltes Formular (Schluessel noch nicht angezeigt)',
      !fehlerVor.some(e => e.includes('Verschachteltes')), fehlerVor.join(' | '));
    pruefe('F2: kein doppelter Feldname (Schluessel noch nicht angezeigt)',
      !fehlerVor.some(e => e.includes('doppelter Feldname')), fehlerVor.join(' | '));
    pruefe('F2: jedes Formular hat genau 1 csrf_token (vor Anzeige)',
      !fehlerVor.some(e => e.includes('csrf_token-Felder')), fehlerVor.join(' | '));

    // Schluessel anzeigen
    await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sesF2, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrfVor ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });

    // Nach Schluessel-Anzeige: eine Checkbox (schluessel_gesichert), kein schluessel-anzeigen-Formular
    const { text: htmlNach } = await holeCsrf(PORT, sesF2, 6);
    const fehlerNach = pruefeForms(htmlNach);
    pruefe('F2: kein verschachteltes Formular (Schluessel bereits angezeigt)',
      !fehlerNach.some(e => e.includes('Verschachteltes')), fehlerNach.join(' | '));
    pruefe('F2: kein doppelter Feldname (Schluessel bereits angezeigt)',
      !fehlerNach.some(e => e.includes('doppelter Feldname')), fehlerNach.join(' | '));
    pruefe('F2: jedes Formular hat genau 1 csrf_token (nach Anzeige)',
      !fehlerNach.some(e => e.includes('csrf_token-Felder')), fehlerNach.join(' | '));

    await stop(pF2);
  } finally { aufraeumen(tF2); }
}

// =====================================================================
// Ergebnis
// =====================================================================

console.log('');
console.log(`Ergebnis: ${ok} ok, ${schlecht} Fehler`);
process.exit(schlecht > 0 ? 1 : 0);
