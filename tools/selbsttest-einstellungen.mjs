// Automatischer Selbsttest fuer WP2 Sicherheitsblock: verschluesselter Einstellungsspeicher.
// Pruefungen B1-B9 (plus B10 Lazy-Opening) aus docs/SPEZ-WP1-3-SICHERHEITSBLOCK.md.
// Offline, ohne echte Schluessel. Aufruf: node --disable-warning=ExperimentalWarning tools/selbsttest-einstellungen.mjs
import './test-sprache.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, statSync, readdirSync, cpSync, chmodSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

let ok = 0, schlecht = 0;
const pruefe = (name, bedingung, detail = '') => { bedingung ? ok++ : schlecht++; console.log(`${bedingung ? 'OK     ' : 'FEHLER '} ${name}${!bedingung && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = (pfad) => { try { rmSync(pfad, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } };
const werfen = (fn) => { try { return fn(); } catch (e) { return e; } };

const E = await import(pathToFileURL(resolve('einstellungen.mjs')).href);
const K = await import(pathToFileURL(resolve('konfig.mjs')).href);

// Minimale DB mit einstellungen-Tabelle anlegen (Spiegel des WP1-Schemas)
function dbNeuAnlegen(pfad) {
  mkdirSync(resolve(pfad, '..'), { recursive: true });
  const d = new DatabaseSync(pfad);
  d.exec(`CREATE TABLE IF NOT EXISTS einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT, verschluesselt INTEGER NOT NULL DEFAULT 0 CHECK(verschluesselt IN (0,1)), iv TEXT, tag TEXT, aktualisiert_am TEXT NOT NULL)`);
  d.exec(`CREATE TABLE IF NOT EXISTS benutzer (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, passwort_hash TEXT NOT NULL, stripe_kunde TEXT UNIQUE, erstellt TEXT NOT NULL, rolle TEXT NOT NULL DEFAULT 'kunde' CHECK (rolle IN ('kunde','admin')))`);
  return d;
}

const MARKE = 'GEHEIMMARKE_WP2_42XZ';
const GEHEIM = 'sk_test_' + MARKE + '_1234';   // enthaelt MARKE, wie ein Stripe-Testschluessel-Praefix

// =====================================================================================================
abschnitt('B1 Rundlauf (schreiben, lesen, DB hat keinen Klartext)');
{
  const t = mkdtempSync(join(tmpdir(), 'wp2-b1-'));
  const dbPfad = join(t, 'daten', 'app.db');
  const schlPfad = join(t, 'daten', '.hauptschluessel');
  const db = dbNeuAnlegen(dbPfad);
  const hs = E.erzeugeHauptschluesselDatei(schlPfad);
  pruefe('Hauptschluessel-Datei neu angelegt (32 Bytes)', readFileSync(schlPfad).length === 32 && hs.length === 32);
  const sp = E.oeffneEinstellungsSpeicher(db, { hauptschluessel: hs });
  sp.schreibe('STRIPE_SECRET_KEY', GEHEIM);
  sp.schreibe('PLATTFORM_NAME', 'Testmarke');
  sp.lade();
  pruefe('Geheimnis wird korrekt zurueckgelesen', sp.lese('STRIPE_SECRET_KEY') === GEHEIM);
  pruefe('Klartextfeld PLATTFORM_NAME zurueckgelesen', sp.lese('PLATTFORM_NAME') === 'Testmarke');

  // In der DB-Datei darf KEIN Klartext eines Geheimnisses stehen.
  db.close();
  const roh = readFileSync(dbPfad);
  pruefe('DB-Datei enthaelt den Klartext des Geheimnisses nicht', !roh.includes(Buffer.from(GEHEIM, 'utf8')));
  pruefe('DB-Datei enthaelt die MARKE (Teilstring des Geheimnisses) nicht', !roh.includes(Buffer.from(MARKE, 'utf8')));
  // Klartext-Feld darf drinstehen (ist nicht geheim)
  pruefe('Klartextfeld PLATTFORM_NAME steht als Bytes in der DB', roh.includes(Buffer.from('Testmarke', 'utf8')));
  // Hauptschluessel-Datei enthaelt die MARKE nicht (sie ist 32 Byte Zufall)
  pruefe('Hauptschluessel-Datei enthaelt die MARKE nicht', !readFileSync(schlPfad).includes(Buffer.from(MARKE, 'utf8')));
  aufraeumen(t);
}

// =====================================================================================================
abschnitt('B2 Zwei Schreibvorgaenge desselben Wertes: andere IV und andere Chiffre');
{
  const t = mkdtempSync(join(tmpdir(), 'wp2-b2-'));
  const dbPfad = join(t, 'daten', 'app.db');
  const schlPfad = join(t, 'daten', '.hauptschluessel');
  const db = dbNeuAnlegen(dbPfad);
  const hs = E.erzeugeHauptschluesselDatei(schlPfad);
  const sp = E.oeffneEinstellungsSpeicher(db, { hauptschluessel: hs });
  sp.schreibe('STRIPE_SECRET_KEY', GEHEIM);
  const r1 = db.prepare('SELECT iv, wert FROM einstellungen WHERE schluessel=?').get('STRIPE_SECRET_KEY');
  sp.schreibe('STRIPE_SECRET_KEY', GEHEIM);
  const r2 = db.prepare('SELECT iv, wert FROM einstellungen WHERE schluessel=?').get('STRIPE_SECRET_KEY');
  pruefe('IV unterschiedlich zwischen zwei Schreibvorgaengen', r1.iv !== r2.iv);
  pruefe('Chiffre unterschiedlich zwischen zwei Schreibvorgaengen', r1.wert !== r2.wert);
  db.close();
  aufraeumen(t);
}

// =====================================================================================================
abschnitt('B3 Manipulierter Chiffretext/Tag -> Fehler ohne Wert-Ausgabe');
{
  const t = mkdtempSync(join(tmpdir(), 'wp2-b3-'));
  const dbPfad = join(t, 'daten', 'app.db');
  const schlPfad = join(t, 'daten', '.hauptschluessel');
  const db = dbNeuAnlegen(dbPfad);
  const hs = E.erzeugeHauptschluesselDatei(schlPfad);
  const sp = E.oeffneEinstellungsSpeicher(db, { hauptschluessel: hs });
  sp.schreibe('STRIPE_SECRET_KEY', GEHEIM);
  // Chiffre-Byte manipulieren (einfach: anderes Base64)
  db.prepare("UPDATE einstellungen SET wert=? WHERE schluessel='STRIPE_SECRET_KEY'").run(Buffer.from('nichtDieEchteChiffre', 'utf8').toString('base64'));
  const fehler = werfen(() => sp.lade());
  pruefe('Manipulierte Chiffre -> KonfigFehler', fehler instanceof K.KonfigFehler);
  const text = fehler instanceof Error ? fehler.meldungen ? fehler.meldungen.join(' ') : fehler.message : String(fehler);
  pruefe('Fehlermeldung enthaelt den Wert (MARKE) NICHT', !text.includes(MARKE));
  pruefe('Fehlermeldung enthaelt das Geheimnis NICHT', !text.includes(GEHEIM));
  // Tag manipulieren
  sp.schreibe('STRIPE_SECRET_KEY', GEHEIM);
  db.prepare("UPDATE einstellungen SET tag=? WHERE schluessel='STRIPE_SECRET_KEY'").run(Buffer.alloc(16, 0).toString('base64'));
  const fehler2 = werfen(() => sp.lade());
  pruefe('Manipulierter Tag -> KonfigFehler', fehler2 instanceof K.KonfigFehler);
  db.close();
  aufraeumen(t);
}

// =====================================================================================================
abschnitt('B4 Fehlender Hauptschluessel bei vorhandenen verschluesselten Werten -> Abbruch, KEINE neue Datei');
{
  const t = mkdtempSync(join(tmpdir(), 'wp2-b4-'));
  const dbPfad = join(t, 'daten', 'app.db');
  const schlPfad = join(t, 'daten', '.hauptschluessel');
  const db = dbNeuAnlegen(dbPfad);
  const hs = E.erzeugeHauptschluesselDatei(schlPfad);
  const sp = E.oeffneEinstellungsSpeicher(db, { hauptschluessel: hs });
  sp.schreibe('STRIPE_SECRET_KEY', GEHEIM);
  db.close();
  rmSync(schlPfad);   // Schluesseldatei entfernen; verschluesselte Werte bleiben.
  pruefe('Hauptschluessel-Datei entfernt', !existsSync(schlPfad));

  // Jetzt holeHauptschluessel mit verschluesselteWerteVorhanden=true aufrufen
  const fehler = werfen(() => E.holeHauptschluessel({ env: {}, dateiPfad: schlPfad, verschluesselteWerteVorhanden: true }));
  pruefe('B4: Abbruch mit KonfigFehler', fehler instanceof K.KonfigFehler);
  pruefe('B4: Meldung enthaelt "Hauptschluessel fehlt"', fehler instanceof K.KonfigFehler && fehler.meldungen.join(' ').includes('Hauptschluessel fehlt'));
  pruefe('B4: KEINE neue Hauptschluessel-Datei angelegt', !existsSync(schlPfad));
  aufraeumen(t);
}

// =====================================================================================================
abschnitt('B5 Rechte der Hauptschluessel-Datei (Linux: 0600; Windows: nicht geprueft)');
{
  const t = mkdtempSync(join(tmpdir(), 'wp2-b5-'));
  const schlPfad = join(t, 'daten', '.hauptschluessel');
  E.erzeugeHauptschluesselDatei(schlPfad);
  if (platform() === 'win32') {
    console.log('OK      B5: Windows-Plattform -> Rechteprueefung uebersprungen (nicht geprueft; Hauptschluessel-Schutz unter Windows erfolgt per ACL/NTFS)');
    ok++;
  } else {
    const modeOkt = (statSync(schlPfad).mode & 0o777).toString(8);
    pruefe('B5: Hauptschluessel-Datei hat Rechte 600 (nur Besitzer)', modeOkt === '600', modeOkt);
  }
  aufraeumen(t);
}

// =====================================================================================================
abschnitt('B6 Vorrang: Umgebungsvariable gewinnt gegen Einstellungsspeicher');
{
  const t = mkdtempSync(join(tmpdir(), 'wp2-b6-'));
  const dbPfad = join(t, 'daten', 'app.db');
  const schlPfad = join(t, 'daten', '.hauptschluessel');
  const db = dbNeuAnlegen(dbPfad);
  const hs = E.erzeugeHauptschluesselDatei(schlPfad);
  const sp = E.oeffneEinstellungsSpeicher(db, { hauptschluessel: hs });
  sp.schreibe('STRIPE_SECRET_KEY', 'sk_test_aus_dem_speicher_xx_12345');
  sp.schreibe('STRIPE_WEBHOOK_SECRET', 'whsec_aus_dem_speicher_xx_12345');
  // env setzt STRIPE_SECRET_KEY auf einen anderen Wert
  const env = { STRIPE_SECRET_KEY: 'sk_test_aus_der_umgebung_YY_12345', STRIPE_WEBHOOK_SECRET: 'whsec_aus_der_umgebung_YY_12345' };
  const k = K.ladeKonfig(env, { speicher: sp });
  pruefe('B6: env > Speicher (SECRET_KEY aus env)', k.stripeSecretKey === 'sk_test_aus_der_umgebung_YY_12345');
  pruefe('B6: env > Speicher (WEBHOOK_SECRET aus env)', k.stripeWebhookSecret === 'whsec_aus_der_umgebung_YY_12345');
  // Nur Speicher (env leer)
  const k2 = K.ladeKonfig({}, { speicher: sp });
  pruefe('B6: ohne env -> Speicher liefert', k2.stripeSecretKey === 'sk_test_aus_dem_speicher_xx_12345');
  // Weder env noch Speicher -> ohne optionen: wie bisher Fehler
  const fehler = werfen(() => K.ladeKonfig({}));
  pruefe('B6: ohne env und ohne Speicher -> KonfigFehler wie bisher', fehler instanceof K.KonfigFehler);
  db.close();
  aufraeumen(t);
}

// =====================================================================================================
abschnitt('B7 Maskierte Ausgabe + Log-Faenger (Geheimnis taucht nirgends im Log auf)');
{
  // Log-Fang
  const logs = [];
  const origLog = console.log, origWarn = console.warn, origErr = console.error;
  console.log = (...a) => logs.push(a.map(String).join(' '));
  console.warn = (...a) => logs.push(a.map(String).join(' '));
  console.error = (...a) => logs.push(a.map(String).join(' '));

  let m, a;
  try {
    const t = mkdtempSync(join(tmpdir(), 'wp2-b7-'));
    const dbPfad = join(t, 'daten', 'app.db');
    const schlPfad = join(t, 'daten', '.hauptschluessel');
    const db = dbNeuAnlegen(dbPfad);
    const hs = E.erzeugeHauptschluesselDatei(schlPfad);
    const sp = E.oeffneEinstellungsSpeicher(db, { hauptschluessel: hs });
    sp.schreibe('STRIPE_SECRET_KEY', GEHEIM);
    sp.schreibe('PLATTFORM_NAME', 'Testmarke');
    m = sp.anzeige('STRIPE_SECRET_KEY');
    a = sp.anzeige('PLATTFORM_NAME');
    db.close();
    aufraeumen(t);
  } finally {
    console.log = origLog; console.warn = origWarn; console.error = origErr;
  }
  pruefe('B7: Maskierte Anzeige {gesetzt:true, maskiert:"sk_test_••••..."}', m && m.gesetzt === true && typeof m.maskiert === 'string' && m.maskiert.startsWith('sk_test_') && m.maskiert.includes('••••'));
  pruefe('B7: Maskierte Anzeige zeigt hoechstens die letzten 4 Zeichen', m && m.maskiert.slice(-4) === GEHEIM.slice(-4) && !m.maskiert.includes(MARKE));
  pruefe('B7: Klartextfeld Anzeige {gesetzt:true, wert:"Testmarke"}', a && a.gesetzt === true && a.wert === 'Testmarke');
  pruefe('B7: Log-Faenger sieht das Geheimnis nicht', !logs.join('\n').includes(GEHEIM) && !logs.join('\n').includes(MARKE));
  pruefe('B7: Maskierung-Funktion direkt: sk_live_wert_abcd -> sk_live_••••abcd', E.maskiereGeheimnis('sk_live_wert_abcd') === 'sk_live_••••abcd');
  pruefe('B7: Maskierung-Funktion: Wert ohne bekanntes Praefix', E.maskiereGeheimnis('XYZxyz1234abcd') === '••••abcd');
  pruefe('B7: Maskierung-Funktion: leerer Wert', E.maskiereGeheimnis('') === '');
}

// =====================================================================================================
abschnitt('B9 Wiederherstellung (DB plus Schluesseldatei einspielen -> lesbar; ohne Schluesseldatei -> klarer Fehler)');
{
  // Phase 1: Instanz A anlegen, Geheimnis schreiben, beide Dateien kopieren
  const tA = mkdtempSync(join(tmpdir(), 'wp2-b9-a-'));
  const dbA = join(tA, 'daten', 'app.db');
  const schlA = join(tA, 'daten', '.hauptschluessel');
  const dbObjA = dbNeuAnlegen(dbA);
  const hsA = E.erzeugeHauptschluesselDatei(schlA);
  const spA = E.oeffneEinstellungsSpeicher(dbObjA, { hauptschluessel: hsA });
  spA.schreibe('STRIPE_SECRET_KEY', GEHEIM);
  dbObjA.close();

  // Phase 2: In frische leere Instanz B einspielen (DB + Schluessel)
  const tB = mkdtempSync(join(tmpdir(), 'wp2-b9-b-'));
  mkdirSync(join(tB, 'daten'), { recursive: true });
  cpSync(dbA, join(tB, 'daten', 'app.db'));
  cpSync(schlA, join(tB, 'daten', '.hauptschluessel'));
  const dbObjB = new DatabaseSync(join(tB, 'daten', 'app.db'));
  const hsB = E.holeHauptschluessel({ env: {}, dateiPfad: join(tB, 'daten', '.hauptschluessel'), verschluesselteWerteVorhanden: true });
  const spB = E.oeffneEinstellungsSpeicher(dbObjB, { hauptschluessel: hsB });
  pruefe('B9: Instanz B liest das Geheimnis korrekt', spB.lese('STRIPE_SECRET_KEY') === GEHEIM);
  dbObjB.close();

  // Phase 3: In frische leere Instanz C einspielen (nur DB, keine Schluesseldatei)
  const tC = mkdtempSync(join(tmpdir(), 'wp2-b9-c-'));
  mkdirSync(join(tC, 'daten'), { recursive: true });
  cpSync(dbA, join(tC, 'daten', 'app.db'));
  const fehler = werfen(() => E.holeHauptschluessel({ env: {}, dateiPfad: join(tC, 'daten', '.hauptschluessel'), verschluesselteWerteVorhanden: true }));
  pruefe('B9: Instanz C -> klare Fehlermeldung "Hauptschluessel fehlt"', fehler instanceof K.KonfigFehler && fehler.meldungen.join(' ').includes('Hauptschluessel fehlt'));
  pruefe('B9: Instanz C -> keine neue Schluesseldatei angelegt', !existsSync(join(tC, 'daten', '.hauptschluessel')));

  aufraeumen(tA); aufraeumen(tB); aufraeumen(tC);
}

// =====================================================================================================
abschnitt('B10 (Chef-Nachbesserung): Bestandsinstanz mit Umgebungsvariablen bleibt bit-gleich');
{
  // Admin in DB, Stripe-Variablen gesetzt, keine Zeilen in einstellungen ausser instanz_zustand (bzw. keine Zeile).
  // Server startet, danach darf KEIN daten/.hauptschluessel existieren und der Arbeitsordner-Inhalt unveraendert sein.
  const t = mkdtempSync(join(tmpdir(), 'wp2-b10-'));
  const dbPfad = join(t, 'app.db');
  const db = dbNeuAnlegen(dbPfad);
  db.prepare("INSERT INTO benutzer (email, passwort_hash, erstellt, rolle) VALUES (?, ?, ?, 'admin')").run('alt@beispiel.hu', 'h', new Date().toISOString());
  // optional: instanz_zustand explizit auf AKTIV
  db.prepare('INSERT OR REPLACE INTO einstellungen (schluessel,wert,verschluesselt,aktualisiert_am) VALUES (?,?,0,?)').run('instanz_zustand', 'AKTIV', new Date().toISOString());
  db.close();

  const inhaltVor = readdirSync(t).sort().join(',');
  pruefe('B10: hatGespeicherteEinstellungen sagt false (nur instanz_zustand)', E.hatGespeicherteEinstellungen(dbPfad) === false);

  const SERVER = resolve('server.mjs');
  const PORT = 4421;
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    cwd: t,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(PORT), DB_DATEI: dbPfad, STRIPE_SECRET_KEY: 'sk_test_bit_gleich_xx_1234', STRIPE_WEBHOOK_SECRET: 'whsec_bit_gleich_xx_1234', WIEDERGABE_GEHEIMNIS: 'T'.repeat(40) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  p.stdout.on('data', (x) => { log += x; });
  p.stderr.on('data', (x) => { log += x; });
  // Nachbesserung 1 (Chef 2026-11-13): auf Bereitschaft pollen (nicht feste Zeit). Bis 30 s, 200 ms Takt.
  // Fertig wenn: /läuft:/ im Log ODER GET /health erreichbar ODER Prozess beendet.
  let bereit = false;
  for (let i = 0; i < 150 && !bereit; i++) {
    if (/Schulungsplattform läuft/.test(log)) { bereit = true; break; }
    if (p.exitCode !== null) break;
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`).catch(() => null); if (r && r.status < 500) { bereit = true; break; } } catch { /* noch nicht da */ }
    await warte(200);
  }
  pruefe('B10: Server startet im Normalbetrieb (Stripe-Variablen gesetzt)', bereit, 'log=' + log.slice(0, 200));
  p.kill('SIGTERM');
  // Auf wirklichen Prozessende warten (bis 10 s), damit nachfolgende Pruefungen korrekt sehen koennen.
  await new Promise((r) => { if (p.exitCode !== null) r(); else { p.on('exit', r); setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* ignore */ } r(); }, 10000); } });

  // Entscheidende Pruefung: WP2 darf KEINE neuen Dateien anlegen, wenn keine Einstellungen gespeichert sind.
  // Der daten/-Ordner darf vom Pre-WP2-Server trotzdem fuer DATEI_ORDNER/SICHERUNG_ORDNER entstehen (Altverhalten).
  // Aber Hauptschluessel-Dateien (anywhere) duerfen nicht entstehen.
  pruefe('B10: KEIN daten/.hauptschluessel angelegt', !existsSync(join(t, 'daten', '.hauptschluessel')));
  pruefe('B10: KEIN .hauptschluessel direkt im Arbeitsordner angelegt', !existsSync(join(t, '.hauptschluessel')));
  // einstellungen-Tabelle in der DB: unveraendert ausser instanz_zustand
  const geheimnisse = new DatabaseSync(dbPfad, { readOnly: true }).prepare('SELECT COUNT(*) AS n FROM einstellungen WHERE verschluesselt=1').get();
  pruefe('B10: keine verschluesselten Werte in der DB (bit-gleich zum Pre-WP2-Lauf)', geheimnisse.n === 0);

  aufraeumen(t);
}

// =====================================================================================================
abschnitt('B11 (Nachbesserung 2): Downgrade - Geheimnisfeld mit verschluesselt!=1 wird als Angriff erkannt');
{
  const t = mkdtempSync(join(tmpdir(), 'wp2-b11-'));
  const dbPfad = join(t, 'daten', 'app.db');
  const schlPfad = join(t, 'daten', '.hauptschluessel');
  const db = dbNeuAnlegen(dbPfad);
  const hs = E.erzeugeHauptschluesselDatei(schlPfad);
  // Angreifer schreibt GEHEIM-Feld im Klartext (verschluesselt=0) direkt in die DB
  db.prepare('INSERT INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES (?,?,0,?)').run('STRIPE_SECRET_KEY', 'sk_test_direkt_eingeschleust_' + MARKE, new Date().toISOString());
  const fehler = werfen(() => E.oeffneEinstellungsSpeicher(db, { hauptschluessel: hs }));
  pruefe('B11: Downgrade bei Geheimnisfeld -> KonfigFehler', fehler instanceof K.KonfigFehler);
  pruefe('B11: Fehlermeldung "Geheimnis nicht verschluesselt gespeichert"', fehler instanceof K.KonfigFehler && fehler.meldungen.join(' ').includes('Geheimnis nicht verschluesselt gespeichert'));
  pruefe('B11: Fehlermeldung enthaelt den eingeschleusten Wert NICHT', fehler instanceof K.KonfigFehler && !fehler.meldungen.join(' ').includes(MARKE));
  db.close();
  aufraeumen(t);
}

// =====================================================================================================
abschnitt('B12 (Nachbesserung 3): Verschluesselt=1 aber iv/tag/wert fehlt -> Defekt-Fehler (nicht still uebersprungen)');
{
  const t = mkdtempSync(join(tmpdir(), 'wp2-b12-'));
  const dbPfad = join(t, 'daten', 'app.db');
  const schlPfad = join(t, 'daten', '.hauptschluessel');
  const db = dbNeuAnlegen(dbPfad);
  const hs = E.erzeugeHauptschluesselDatei(schlPfad);
  db.prepare('INSERT INTO einstellungen (schluessel, wert, verschluesselt, iv, tag, aktualisiert_am) VALUES (?,?,1,NULL,NULL,?)').run('STRIPE_SECRET_KEY', '', new Date().toISOString());
  const fehler = werfen(() => E.oeffneEinstellungsSpeicher(db, { hauptschluessel: hs }));
  pruefe('B12: defekte verschluesselte Zeile -> KonfigFehler', fehler instanceof K.KonfigFehler);
  pruefe('B12: Fehlermeldung nennt "defekt" oder "iv/tag"', fehler instanceof K.KonfigFehler && /defekt|iv\/tag/.test(fehler.meldungen.join(' ')));
  db.close();
  aufraeumen(t);
}

// =====================================================================================================
abschnitt('B13 (Nachbesserung 4): AAD-Bindung - Chiffretext zwischen zwei Feldern vertauscht schlaegt fehl');
{
  const t = mkdtempSync(join(tmpdir(), 'wp2-b13-'));
  const dbPfad = join(t, 'daten', 'app.db');
  const schlPfad = join(t, 'daten', '.hauptschluessel');
  const db = dbNeuAnlegen(dbPfad);
  const hs = E.erzeugeHauptschluesselDatei(schlPfad);
  const sp = E.oeffneEinstellungsSpeicher(db, { hauptschluessel: hs });
  sp.schreibe('STRIPE_WEBHOOK_SECRET', 'whsec_eins_geheim_wert_abcd1234');
  sp.schreibe('RESEND_API_KEY',       're_zwei_geheim_wert_xyz987654');
  // Jetzt Chiffre von STRIPE_WEBHOOK_SECRET in die RESEND_API_KEY-Zeile kopieren (gleicher Schluessel, falscher AAD-Name)
  const geklaut = db.prepare("SELECT wert, iv, tag FROM einstellungen WHERE schluessel='STRIPE_WEBHOOK_SECRET'").get();
  db.prepare("UPDATE einstellungen SET wert=?, iv=?, tag=? WHERE schluessel='RESEND_API_KEY'").run(geklaut.wert, geklaut.iv, geklaut.tag);
  const fehler = werfen(() => sp.lade());
  pruefe('B13: Vertauschter Chiffretext -> KonfigFehler', fehler instanceof K.KonfigFehler);
  pruefe('B13: Meldung enthaelt keinen Klartext (Integritaetspruefung)', fehler instanceof K.KonfigFehler && !fehler.meldungen.join(' ').includes('whsec_eins_geheim_wert_abcd1234'));
  db.close();
  aufraeumen(t);
}

// =====================================================================================================
abschnitt('B14 (Nachbesserung 5): maskiereGeheimnis - kurze Werte komplett maskiert');
{
  pruefe('B14: Wert kuerzer als 12 Zeichen -> "••••" ohne Endung', E.maskiereGeheimnis('kurz123') === '••••');
  pruefe('B14: Wert mit 11 Zeichen -> "••••"', E.maskiereGeheimnis('11char12345') === '••••');
  pruefe('B14: Wert mit 12 Zeichen -> Praefix (keiner) + ••••+ letzte 4', E.maskiereGeheimnis('123456789abc') === '••••9abc');
  pruefe('B14: Wert mit 13 Zeichen -> Praefix + ••••+ letzte 4 (ohne Praefix: nur Bullets+4)', E.maskiereGeheimnis('abcdef1234567') === '••••4567');
  pruefe('B14: sk_test_ mit kurzem Rest (<12 insgesamt)', E.maskiereGeheimnis('sk_test_1') === '••••');   // Gesamtlaenge 9 -> komplett maskiert
  pruefe('B14: Praefix-Form bei ausreichender Laenge', E.maskiereGeheimnis('sk_test_WERT_abcd') === 'sk_test_••••abcd');
  pruefe('B14: leerer Wert bleibt leer', E.maskiereGeheimnis('') === '');
}

// =====================================================================================================
abschnitt('Integritaetscheck: einstellungen.mjs liest NICHT process.env direkt');
{
  const quelle = readFileSync('einstellungen.mjs', 'utf8').replace(/\/\/.*$/gm, '');
  pruefe('einstellungen.mjs beruehrt process.env nicht', !/process\.env/.test(quelle));
}

console.log(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`);
process.exit(schlecht === 0 ? 0 : 1);
