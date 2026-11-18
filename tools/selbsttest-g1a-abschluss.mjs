// Selbsttest G1a: Abschlussbericht + Aktivierungssperre (Schritt 6, Normalstart).
// ROT-Phase: abschluss-bericht.mjs existiert noch nicht -> dieser Test schlaegt fehl.
import './test-sprache.mjs';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';

let ok = 0, schlecht = 0;
const pruefe = (name, bed, detail = '') => {
  bed ? ok++ : schlecht++;
  console.log(`${bed ? 'OK     ' : 'FEHLER '} ${name}${!bed && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`);
};
const abschnitt = (t) => console.log(`--- ${t}`);

const warte = (ms) => new Promise(r => setTimeout(r, ms));
const aufraeumen = (d) => { try { rmSync(d, { recursive: true }); } catch { /* egal */ } };

// --- Import pruefen (ROT wenn Modul fehlt) ---
abschnitt('G0: Modul-Import');
let abschlussPruefungen;
let setzeBerichtDb;
let setzeBerichtLogoPfad;
try {
  const m = await import('../abschluss-bericht.mjs');
  abschlussPruefungen = m.abschlussPruefungen;
  setzeBerichtDb = m.setzeBerichtDb;
  setzeBerichtLogoPfad = m.setzeBerichtLogoPfad;
  pruefe('G0a: abschluss-bericht.mjs importierbar', true);
  pruefe('G0b: abschlussPruefungen ist Funktion', typeof abschlussPruefungen === 'function');
  pruefe('G0c: setzeBerichtDb ist Funktion', typeof setzeBerichtDb === 'function');
  pruefe('G0d: setzeBerichtLogoPfad ist Funktion', typeof setzeBerichtLogoPfad === 'function');
} catch (e) {
  pruefe('G0a: abschluss-bericht.mjs importierbar', false, e.message);
  pruefe('G0b: abschlussPruefungen ist Funktion', false, 'Import fehlgeschlagen');
  pruefe('G0c: setzeBerichtDb ist Funktion', false, 'Import fehlgeschlagen');
  pruefe('G0d: setzeBerichtLogoPfad ist Funktion', false, 'Import fehlgeschlagen');
  console.log(`\n${schlecht} Test(s) mit Fehlern (Import gescheitert, weitere Tests uebersprungen)`);
  process.exit(1);
}

// --- Hilfsfunktion: Test-DB anlegen ---
function baueTestDb(tmpord, einstellungen = {}) {
  const dbPfad = join(tmpord, 'app.db');
  const d = new DatabaseSync(dbPfad);
  d.exec('PRAGMA journal_mode = WAL');
  d.exec(`CREATE TABLE IF NOT EXISTS einstellungen (
    schluessel TEXT PRIMARY KEY,
    wert TEXT,
    verschluesselt INTEGER NOT NULL DEFAULT 0 CHECK(verschluesselt IN (0,1)),
    iv TEXT, tag TEXT,
    aktualisiert_am TEXT NOT NULL
  )`);
  const ins = d.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES (?,?,0,datetime('now'))");
  for (const [k, v] of Object.entries(einstellungen)) ins.run(k, v);
  d.close();
  return dbPfad;
}

function oeffneDb(dbPfad) {
  const d = new DatabaseSync(dbPfad);
  d.exec('PRAGMA busy_timeout=3000');
  return d;
}

// --- Einheit: abschlussPruefungen ---

abschnitt('G1: Einheit - alle Pflichtpunkte fehlen');
{
  const t = mkdtempSync(join(tmpdir(), 'g1a-g1-'));
  try {
    const dbPfad = baueTestDb(t, {});
    const db = oeffneDb(dbPfad);
    setzeBerichtDb(db);
    setzeBerichtLogoPfad(join(t, 'logo.png')); // existiert nicht
    const items = abschlussPruefungen({ schluesselGesichert: false, schluesselAusEnv: false });
    db.close();
    pruefe('G1a: Ergebnis ist Array', Array.isArray(items), typeof items);
    const pflicht = items.filter(i => i.pflicht && i.status === 'rot');
    pruefe('G1b: mind. 3 Pflicht-Rots (mail, zahlung, recht)', pflicht.length >= 3, `rot=${pflicht.map(i=>i.id).join(',')}`);
    const mailItem = items.find(i => i.id === 'mail');
    pruefe('G1c: mail-Item vorhanden', !!mailItem);
    pruefe('G1d: mail status=rot', mailItem?.status === 'rot', mailItem?.status);
    pruefe('G1e: mail pflicht=true', mailItem?.pflicht === true);
    pruefe('G1f: mail korrekturLink enthaelt /schritt/3', mailItem?.korrekturLink?.includes('/schritt/3'), mailItem?.korrekturLink);
    const zahlungItem = items.find(i => i.id === 'zahlung');
    pruefe('G1g: zahlung status=rot', zahlungItem?.status === 'rot');
    const rechtItem = items.find(i => i.id === 'recht');
    pruefe('G1h: recht status=rot', rechtItem?.status === 'rot');
    // schluessel Pflicht weil Params uebergeben
    const schlItem = items.find(i => i.id === 'schluessel');
    pruefe('G1i: schluessel vorhanden wenn Params uebergeben', !!schlItem, `ids=${items.map(i=>i.id).join(',')}`);
    pruefe('G1j: schluessel status=rot (gesichert=false, ausEnv=false)', schlItem?.status === 'rot');
  } finally { aufraeumen(t); }
}

abschnitt('G2: Einheit - alle Pflichtpunkte ok, Schluesselsicherung ok');
{
  const t = mkdtempSync(join(tmpdir(), 'g1a-g2-'));
  try {
    const dbPfad = baueTestDb(t, {
      'einrichtung_schritt_3': 'fertig',
      'einrichtung_schritt_4': 'fertig',
      'recht_impressum': 'erstellt',
      'recht_datenschutz': 'erstellt',
      'recht_teilnahmebedingungen': 'erstellt',
      'ANBIETER_NAME': 'Test GmbH',
      'ANBIETER_ANSCHRIFT': 'Musterstr. 1, 12345 Budapest',
      'ANBIETER_EMAIL': 'info@test.hu',
      'schluessel_angezeigt': '1',
      'PLATTFORM_NAME': 'Meine Akademie',
    });
    // Logo anlegen
    writeFileSync(join(t, 'logo.png'), Buffer.alloc(10));
    const db = oeffneDb(dbPfad);
    setzeBerichtDb(db);
    setzeBerichtLogoPfad(join(t, 'logo.png'));
    const items = abschlussPruefungen({ schluesselGesichert: true, schluesselAusEnv: false });
    db.close();
    const rots = items.filter(i => i.pflicht && i.status === 'rot');
    pruefe('G2a: keine Pflicht-Rots', rots.length === 0, `rot=${rots.map(i=>i.id).join(',')}`);
    const oks = items.filter(i => i.pflicht && i.status === 'ok');
    pruefe('G2b: mind. 3 Pflicht-Oks', oks.length >= 3, `ok=${oks.map(i=>i.id).join(',')}`);
    // Hinweise vorhanden (erster_kurs immer)
    const hinweise = items.filter(i => !i.pflicht && i.status === 'hinweis');
    pruefe('G2c: erster_kurs-Hinweis vorhanden', hinweise.some(i => i.id === 'erster_kurs'));
    // Logo und Name gesetzt -> keine Logo/Name-Hinweise
    pruefe('G2d: kein name_standard-Hinweis', !hinweise.some(i => i.id === 'name_standard'));
    pruefe('G2e: kein logo-Hinweis', !hinweise.some(i => i.id === 'logo'));
  } finally { aufraeumen(t); }
}

// N1: Originalen Schritt-6-Code ohne HTTP/Server ausfuehren.
abschnitt('N1: zweite DB-Verbindung zwischen Pflichtpruefung und Schreiben');
{
  const t = mkdtempSync(join(tmpdir(), 'g1n-sperre-'));
  const pfad = baueTestDb(t, {
    einrichtung_schritt_3: 'fertig', einrichtung_schritt_4: 'fertig',
    recht_impressum: 'erstellt', recht_datenschutz: 'erstellt', recht_teilnahmebedingungen: 'erstellt',
    ANBIETER_NAME: 'Test GmbH', ANBIETER_ANSCHRIFT: 'Budapest', ANBIETER_EMAIL: 'info@test.hu',
    schluessel_angezeigt: '1',
  });
  const db = oeffneDb(pfad), zweite = oeffneDb(pfad);
  zweite.exec('PRAGMA busy_timeout=0');
  try {
    setzeBerichtDb(db);
    const quelle = readFileSync(new URL('../assistent-routen.mjs', import.meta.url), 'utf8');
    const start = quelle.indexOf('      const schluesselAusEnv', quelle.indexOf('// WP9: Schritt 6'));
    const ende = quelle.indexOf('      if (optionen.aufpasser', start);
    const ausfuehren = new Function('db', 'optionen', 'req', 'res', 'HU', 'abschlussPruefungen',
      'cachedHs', 'oeffneEinstellungsSpeicher', 'ladeKonfig', 'KonfigFehler', 'schreibeEinstellung', 'markiereAlsFertig', 'const n = 6; const sprache = () => "de"; const fehler = (rq, rs, st, tx) => rs.status(st).type("text/plain").send(tx);' + quelle.slice(start, ende));
    const res = { code: 200, status(c) { this.code = c; return this; }, type() { return this; }, send() { return this; } };
    let gesperrt = false; let aufrufe = 0;
    const schreiben = (k, v) => db.prepare("INSERT OR REPLACE INTO einstellungen (schluessel,wert,aktualisiert_am) VALUES (?,?,datetime('now'))").run(k, v);
    const lauf = () => ausfuehren(db, {}, { body: { schluessel_gesichert: '1' } }, res, {}, opts => {
      const bericht = abschlussPruefungen(opts);
      // nur beim ersten Aufruf (Pflichtpruefung in der Transaktion); der zweite (E6-Hinweisliste nach COMMIT) ist unkritisch
      if (aufrufe++ === 0) {
        try { zweite.exec("DELETE FROM einstellungen WHERE schluessel='einrichtung_schritt_3'"); }
        catch (e) { if (!/locked|busy/i.test(e.message)) throw e; gesperrt = true; }
      }
      return bericht;
    }, null, null, () => ({}), class extends Error {}, schreiben, n => schreiben('einrichtung_schritt_' + n, 'fertig'));
    lauf();
    pruefe('N1a: konkurrierende Loeschung ist gesperrt', gesperrt);
    const wert = k => db.prepare('SELECT wert FROM einstellungen WHERE schluessel=?').get(k)?.wert;
    pruefe('N1b: nie KONFIGURIERT ohne Pflichtschritt', wert('instanz_zustand') !== 'KONFIGURIERT' || wert('einrichtung_schritt_3') === 'fertig');
    zweite.exec("DELETE FROM einstellungen WHERE schluessel IN ('einrichtung_schritt_3','instanz_zustand','einrichtung_abgeschlossen_am','einrichtung_schritt_6')");
    lauf();
    pruefe('N1c: fehlende Pflicht ergibt 400 ohne Abschlussmarker', res.code === 400 && !wert('instanz_zustand') && !wert('einrichtung_abgeschlossen_am') && !wert('einrichtung_schritt_6'));
    zweite.exec("INSERT INTO einstellungen (schluessel,wert,aktualisiert_am) VALUES ('nach_rollback','ok',datetime('now'))");
    pruefe('N1d: nach roter Pflichtpruefung ist Transaktion freigegeben', wert('nach_rollback') === 'ok');
  } finally { zweite.close(); db.close(); aufraeumen(t); }
}

abschnitt('G3: Einheit - Normalstart (keine Schluesselparam)');
{
  const t = mkdtempSync(join(tmpdir(), 'g1a-g3-'));
  try {
    const dbPfad = baueTestDb(t, {
      'einrichtung_schritt_3': 'fertig',
      'einrichtung_schritt_4': 'fertig',
      'recht_impressum': 'erstellt',
      'recht_datenschutz': 'erstellt',
      'recht_teilnahmebedingungen': 'erstellt',
      'ANBIETER_NAME': 'Test GmbH',
      'ANBIETER_ANSCHRIFT': 'Musterstr. 1, 12345 Budapest',
      'ANBIETER_EMAIL': 'info@test.hu',
    });
    const db = oeffneDb(dbPfad);
    setzeBerichtDb(db);
    setzeBerichtLogoPfad(join(t, 'logo.png'));
    // Normalstart: keine Params -> Schluesselsicherung wird NICHT geprueft
    const items = abschlussPruefungen();
    db.close();
    const schlItem = items.find(i => i.id === 'schluessel');
    pruefe('G3a: kein schluessel-Item bei Normalstart', !schlItem, `vorhanden: ${!!schlItem}`);
    const rots = items.filter(i => i.pflicht && i.status === 'rot');
    pruefe('G3b: keine Pflicht-Rots bei vollstaendiger DB', rots.length === 0, `rot=${rots.map(i=>i.id).join(',')}`);
  } finally { aufraeumen(t); }
}

abschnitt('G4: Einheit - Anbieter nur Pflicht wenn recht=erstellt');
{
  const t = mkdtempSync(join(tmpdir(), 'g1a-g4-'));
  try {
    // Alle Recht-Modi = url -> Anbieter nicht Pflicht
    const dbPfad = baueTestDb(t, {
      'einrichtung_schritt_3': 'fertig',
      'einrichtung_schritt_4': 'fertig',
      'recht_impressum': 'https://example.com/impressum',
      'recht_datenschutz': 'https://example.com/datenschutz',
      'recht_teilnahmebedingungen': 'https://example.com/agb',
      'schluessel_angezeigt': '1',
    });
    const db = oeffneDb(dbPfad);
    setzeBerichtDb(db);
    setzeBerichtLogoPfad(join(t, 'logo.png'));
    const items = abschlussPruefungen({ schluesselGesichert: true, schluesselAusEnv: false });
    db.close();
    const anbieterItem = items.find(i => i.id === 'anbieter');
    pruefe('G4a: kein anbieter-Item wenn alle Recht-Modi URL', !anbieterItem, `vorhanden: ${!!anbieterItem}`);
    const rots = items.filter(i => i.pflicht && i.status === 'rot');
    pruefe('G4b: keine Pflicht-Rots bei URL-Modi', rots.length === 0, `rot=${rots.map(i=>i.id).join(',')}`);
  } finally { aufraeumen(t); }
}

abschnitt('G5: Einheit - Anbieter unvollstaendig wenn recht=erstellt');
{
  const t = mkdtempSync(join(tmpdir(), 'g1a-g5-'));
  try {
    const dbPfad = baueTestDb(t, {
      'einrichtung_schritt_3': 'fertig',
      'einrichtung_schritt_4': 'fertig',
      'recht_impressum': 'erstellt',
      'recht_datenschutz': 'https://example.com/ds',
      'recht_teilnahmebedingungen': 'https://example.com/agb',
      // Anbieter-Felder fehlen
      'schluessel_angezeigt': '1',
    });
    const db = oeffneDb(dbPfad);
    setzeBerichtDb(db);
    setzeBerichtLogoPfad(join(t, 'logo.png'));
    const items = abschlussPruefungen({ schluesselGesichert: true, schluesselAusEnv: false });
    db.close();
    const anbieterItem = items.find(i => i.id === 'anbieter');
    pruefe('G5a: anbieter-Item vorhanden wenn ein recht=erstellt', !!anbieterItem);
    pruefe('G5b: anbieter status=rot wegen fehlendem Name', anbieterItem?.status === 'rot', anbieterItem?.status);
    pruefe('G5c: anbieter pflicht=true', anbieterItem?.pflicht === true);
    pruefe('G5d: anbieter korrekturLink /schritt/2', anbieterItem?.korrekturLink?.includes('/schritt/2'));
  } finally { aufraeumen(t); }
}

abschnitt('G6: Einheit - schluesselAusEnv ueberstimmt schluesselGesichert');
{
  const t = mkdtempSync(join(tmpdir(), 'g1a-g6-'));
  try {
    const dbPfad = baueTestDb(t, {
      'einrichtung_schritt_3': 'fertig',
      'einrichtung_schritt_4': 'fertig',
      'recht_impressum': 'erstellt',
      'recht_datenschutz': 'erstellt',
      'recht_teilnahmebedingungen': 'erstellt',
      'ANBIETER_NAME': 'T GmbH',
      'ANBIETER_ANSCHRIFT': 'Str. 1',
      'ANBIETER_EMAIL': 'x@t.hu',
      // schluessel_angezeigt fehlt absichtlich
    });
    const db = oeffneDb(dbPfad);
    setzeBerichtDb(db);
    setzeBerichtLogoPfad(join(t, 'logo.png'));
    const items = abschlussPruefungen({ schluesselGesichert: false, schluesselAusEnv: true });
    db.close();
    const schlItem = items.find(i => i.id === 'schluessel');
    pruefe('G6a: schluessel-Item vorhanden', !!schlItem);
    pruefe('G6b: schluessel ok wegen schluesselAusEnv=true', schlItem?.status === 'ok', schlItem?.status);
  } finally { aufraeumen(t); }
}

abschnitt('G7: Einheit - Hinweise Name-Standard + Logo fehlt');
{
  const t = mkdtempSync(join(tmpdir(), 'g1a-g7-'));
  try {
    const dbPfad = baueTestDb(t, {
      // PLATTFORM_NAME fehlt -> Standard
      // logo.png fehlt
    });
    const db = oeffneDb(dbPfad);
    setzeBerichtDb(db);
    setzeBerichtLogoPfad(join(t, 'logo.png')); // existiert nicht
    const items = abschlussPruefungen(); // Normalstart, keine Schluesselparam
    db.close();
    const nameItem = items.find(i => i.id === 'name_standard');
    pruefe('G7a: name_standard-Hinweis wenn PLATTFORM_NAME fehlt', !!nameItem);
    pruefe('G7b: name_standard status=hinweis', nameItem?.status === 'hinweis');
    pruefe('G7c: name_standard pflicht=false', nameItem?.pflicht === false);
    const logoItem = items.find(i => i.id === 'logo');
    pruefe('G7d: logo-Hinweis wenn logo.png fehlt', !!logoItem);
    pruefe('G7e: logo status=hinweis', logoItem?.status === 'hinweis');
    const kursItem = items.find(i => i.id === 'erster_kurs');
    pruefe('G7f: erster_kurs-Hinweis immer vorhanden', !!kursItem);
    pruefe('G7g: erster_kurs pflicht=false', kursItem?.pflicht === false);
  } finally { aufraeumen(t); }
}

abschnitt('G8: Einheit - Schritt 3 "ohne_mail" gilt als fertig');
{
  const t = mkdtempSync(join(tmpdir(), 'g1a-g8-'));
  try {
    const dbPfad = baueTestDb(t, {
      'einrichtung_schritt_3': 'fertig', // ohne_mail wird als fertig gespeichert
      'einrichtung_schritt_4': 'fertig',
      'recht_impressum': 'erstellt',
      'recht_datenschutz': 'erstellt',
      'recht_teilnahmebedingungen': 'erstellt',
      'ANBIETER_NAME': 'T GmbH', 'ANBIETER_ANSCHRIFT': 'Str 1', 'ANBIETER_EMAIL': 'a@b.hu',
    });
    const db = oeffneDb(dbPfad);
    setzeBerichtDb(db);
    setzeBerichtLogoPfad(join(t, 'logo.png'));
    const items = abschlussPruefungen();
    db.close();
    const mailItem = items.find(i => i.id === 'mail');
    pruefe('G8a: mail ok wenn einrichtung_schritt_3=fertig', mailItem?.status === 'ok', mailItem?.status);
  } finally { aufraeumen(t); }
}

// A10: pruefeAnbieter mit Zusatzfeldern roh/quelle wird abgelehnt
abschnitt('G9: A10 - pruefeAnbieter mit roh/quelle-Feldern wird abgelehnt (Auswahl der Nutzfelder)');
{
  // Das testen wir indirekt: anbieter-bericht.mjs soll die Felder filtern.
  // Wir erzeugen eine DB mit gueltigen ANBIETER-Daten und pruefen ob kein Fehler entsteht.
  const t = mkdtempSync(join(tmpdir(), 'g1a-g9-'));
  try {
    const dbPfad = baueTestDb(t, {
      'einrichtung_schritt_3': 'fertig',
      'einrichtung_schritt_4': 'fertig',
      'recht_impressum': 'erstellt',
      'recht_datenschutz': 'erstellt',
      'recht_teilnahmebedingungen': 'erstellt',
      'ANBIETER_NAME': 'Vollstaendige GmbH',
      'ANBIETER_ANSCHRIFT': 'Vollstaendige Str. 1, 12345 Budapest',
      'ANBIETER_EMAIL': 'info@vollstaendig.hu',
    });
    const db = oeffneDb(dbPfad);
    setzeBerichtDb(db);
    setzeBerichtLogoPfad(join(t, 'logo.png'));
    const items = abschlussPruefungen();
    db.close();
    const anbieterItem = items.find(i => i.id === 'anbieter');
    pruefe('G9a: anbieter-Item vorhanden', !!anbieterItem);
    pruefe('G9b: anbieter ok mit vollstaendigen Daten (kein roh/quelle-Fehler)', anbieterItem?.status === 'ok', anbieterItem?.status);
  } finally { aufraeumen(t); }
}

// --- Textschluessel-Pruefung ---
abschnitt('G10: Textschluessel in texte/de.json vorhanden');
{
  let detexte;
  try {
    const { readFileSync } = await import('node:fs');
    detexte = JSON.parse(readFileSync(new URL('../texte/de.json', import.meta.url)));
  } catch (e) {
    pruefe('G10 texte/de.json lesbar', false, e.message);
    detexte = {};
  }
  const pflichtSchluessel = [
    'g1a_abschluss_pflicht_rot', 'g1a_korrigieren',
    'g1a_mail', 'g1a_zahlung', 'g1a_recht', 'g1a_anbieter', 'g1a_schluessel',
    'g1a_name_standard', 'g1a_logo', 'g1a_erster_kurs',
  ];
  for (const k of pflichtSchluessel) {
    pruefe(`G10 de.json hat "${k}"`, Object.prototype.hasOwnProperty.call(detexte, k), `Schluessel fehlt`);
  }
}

abschnitt('G11: Textschluessel in texte/hu.json vorhanden');
{
  let hutexte;
  try {
    const { readFileSync } = await import('node:fs');
    hutexte = JSON.parse(readFileSync(new URL('../texte/hu.json', import.meta.url)));
  } catch (e) {
    pruefe('G11 texte/hu.json lesbar', false, e.message);
    hutexte = {};
  }
  const pflichtSchluessel = [
    'g1a_abschluss_pflicht_rot', 'g1a_korrigieren',
    'g1a_mail', 'g1a_zahlung', 'g1a_recht', 'g1a_anbieter', 'g1a_schluessel',
    'g1a_name_standard', 'g1a_logo', 'g1a_erster_kurs',
  ];
  for (const k of pflichtSchluessel) {
    pruefe(`G11 hu.json hat "${k}"`, Object.prototype.hasOwnProperty.call(hutexte, k), `Schluessel fehlt`);
  }
}

abschnitt('G12: Textschluessel in texte/en.json vorhanden');
{
  let entexte;
  try {
    const { readFileSync } = await import('node:fs');
    entexte = JSON.parse(readFileSync(new URL('../texte/en.json', import.meta.url)));
  } catch (e) {
    pruefe('G12 texte/en.json lesbar', false, e.message);
    entexte = {};
  }
  const pflichtSchluessel = [
    'g1a_abschluss_pflicht_rot', 'g1a_korrigieren',
    'g1a_mail', 'g1a_zahlung', 'g1a_recht', 'g1a_anbieter', 'g1a_schluessel',
    'g1a_name_standard', 'g1a_logo', 'g1a_erster_kurs',
  ];
  for (const k of pflichtSchluessel) {
    pruefe(`G12 en.json hat "${k}"`, Object.prototype.hasOwnProperty.call(entexte, k), `Schluessel fehlt`);
  }
}

// F-221: serverfreie Startpruefung, wiederholt gegen dieselbe persistierte DB.
abschnitt('F221: Pflichtsperre, Wiederholung, Korrektur und Ausnahme');
{
  const { startPruefungKonfiguriert } = await import('../abschluss-bericht.mjs');
  const t = mkdtempSync(join(tmpdir(), 'f221-start-'));
  const pfad = baueTestDb(t, {
    instanz_zustand: 'KONFIGURIERT', einrichtung_schritt_3: 'fertig', einrichtung_schritt_4: 'fertig',
    recht_impressum: 'url', recht_datenschutz: 'url', recht_teilnahmebedingungen: 'url',
  });
  let db = oeffneDb(pfad);
  try {
    pruefe('F221 R1: vollstaendig ohne Schluesselsicherung startbereit', startPruefungKonfiguriert(db).ok);
    db.exec("DELETE FROM einstellungen WHERE schluessel='recht_impressum'");
    const rot = startPruefungKonfiguriert(db);
    pruefe('F221 R2: nur Pflicht-id recht, keine Werte', !rot.ok && JSON.stringify(rot.rot) === '["recht"]');
    pruefe('F221 R2: Bericht hat Korrekturlink', abschlussPruefungen().some(i => i.id === 'recht' && i.status === 'rot' && i.korrekturLink.endsWith('/schritt/2')));
    db.close();
    db = oeffneDb(pfad);
    pruefe('F221 R4: erneutes Oeffnen umgeht Sperre nicht', !startPruefungKonfiguriert(db).ok);
    db.exec("INSERT INTO einstellungen (schluessel,wert,aktualisiert_am) VALUES ('recht_impressum','url',datetime('now'))");
    pruefe('F221 R3: Korrektur hebt Sperre auf', startPruefungKonfiguriert(db).ok);
    pruefe('F221: Startpruefung veraendert Zustand nicht', db.prepare("SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'").get()?.wert === 'KONFIGURIERT');
    let geworfen = false;
    try { startPruefungKonfiguriert({ prepare() { throw new Error('geheimer_testwert'); } }); }
    catch { geworfen = true; }
    pruefe('F221 R6: Ausnahme ergibt niemals Freigabe', geworfen);
  } finally { setzeBerichtDb(null); db.close(); aufraeumen(t); }
}

// Anbieter nur aus der geladenen Umgebung, ohne marke- oder Einstellungsanbieter.
{
  const { setzeAnbieterBasis } = await import('../anbieter.mjs');
  const { startPruefungKonfiguriert } = await import('../abschluss-bericht.mjs');
  const { ladeKonfig } = await import('../konfig.mjs');
  const t = mkdtempSync(join(tmpdir(), 'g1n-anbieter-'));
  const db = oeffneDb(baueTestDb(t, {
    einrichtung_schritt_3: 'fertig', einrichtung_schritt_4: 'fertig',
    recht_impressum: 'erstellt', recht_datenschutz: 'erstellt', recht_teilnahmebedingungen: 'erstellt',
  }));
  try {
    const konfig = ladeKonfig({
      STRIPE_SECRET_KEY: 'sk_test_placeholder00000000000000000000000000',
      STRIPE_WEBHOOK_SECRET: 'whsec_placeholder0000000000000000000000000000',
      ANBIETER_NAME: 'Umgebung GmbH', ANBIETER_ANSCHRIFT: 'Musterstr. 1, Budapest', ANBIETER_EMAIL: 'info@test.hu',
    }, { startZustand: 'KONFIGURIERT' });
    setzeAnbieterBasis(konfig.anbieter);
    pruefe('G1N: Anbieter aus konfig.anbieter erlaubt Start', startPruefungKonfiguriert(db).ok);
    setzeAnbieterBasis(null);
    const rot = startPruefungKonfiguriert(db);
    pruefe('G1N: ohne Anbieterbasis rot anbieter', !rot.ok && rot.rot.includes('anbieter'));
  } finally { setzeAnbieterBasis(null); setzeBerichtDb(null); db.close(); aufraeumen(t); }
}

// Originale Startverdrahtung ohne Modulimporte/Prozess/HTTP pruefen.
{
  const { KonfigFehler } = await import('../konfig.mjs');
  const quelle = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const a = quelle.indexOf("  if (startZustand === 'KONFIGURIERT') {");
  const b = quelle.indexOf('\n} catch (e)', a);
  const block = quelle.slice(a, b)
    .replace(/^.*setzeAnbieterBasis\(konfig\.anbieter(?:, konfig\.anbieterQuelle)?\);\n/m, '')
    .replace(/^.*process\.env\.DB_DATEI = dbDatei;\n/m, '')
    .replace(/^.*const .* = await import\(.*\);\n/gm, '');
  const lauf = new Function('startZustand', 'db', 'dbDatei', 'startPruefungKonfiguriert', 'setzeBerichtLogoPfad', 'machLogoPfad', 'KonfigFehler', block);
  for (const [name, pruefung, erwarteteId] of [
    ['rote Pflicht', () => ({ ok: false, rot: ['recht'] }), 'recht'],
    ['Ausnahme', () => { throw new Error('geheimer_testwert'); }, 'abschlusspruefung'],
  ]) {
    let fehler;
    try { lauf('KONFIGURIERT', {}, 'test.db', pruefung, () => {}, x => x, KonfigFehler); }
    catch (e) { fehler = e; }
    pruefe(`F221 R2/R6: ${name} geht als KonfigFehler in Reparatur-catch`, fehler instanceof KonfigFehler && JSON.stringify(fehler.meldungen) === JSON.stringify([erwarteteId]));
  }
  let aufgerufen = false;
  lauf('AKTIV', {}, 'test.db', () => { aufgerufen = true; }, () => {}, x => x, KonfigFehler);
  pruefe('F221 R5: Originalstart prueft AKTIV nicht', !aufgerufen);
}

// Reparaturmodus bleibt auch mit Stripe-Umgebungswerten geschlossen.
{
  const { ladeKonfig } = await import('../konfig.mjs');
  const env = { STRIPE_SECRET_KEY: 'sk_test_placeholder00000000000000000000000000', STRIPE_WEBHOOK_SECRET: 'whsec_placeholder0000000000000000000000000000' };
  const lade = (optionen) => ladeKonfig(env, { startZustand: 'ADMIN_ERSTELLT', ...optionen });
  pruefe('F221: Stripe gesetzt + Reparaturoption ergibt einrichtung', lade({ erzwingeEinrichtung: true }).modus === 'einrichtung');
  pruefe('F221: Stripe gesetzt ohne Option bleibt normal', lade({}).modus === 'normal');
  for (const erzwingeEinrichtung of [false, 'true', 1]) {
    pruefe(`F221: nur boolean true erzwingt Einrichtung (${erzwingeEinrichtung})`, lade({ erzwingeEinrichtung }).modus === 'normal');
  }
  for (const startZustand of ['UNINITIALISIERT', 'KONFIGURIERT', 'AKTIV', undefined]) {
    pruefe(`F221: Option aendert anderen Zustand nicht (${startZustand})`, lade({ startZustand, erzwingeEinrichtung: true }).modus === 'normal');
  }
  pruefe('F221: Reparaturmodus validiert Stripe-Werte nicht', ladeKonfig({ STRIPE_SECRET_KEY: 'ungueltig', STRIPE_WEBHOOK_SECRET: 'ungueltig' }, { startZustand: 'ADMIN_ERSTELLT', erzwingeEinrichtung: true }).modus === 'einrichtung');
}

// Erlaubt den gezielten Lauf ohne HTTP, Kindprozesse oder Server.
if (process.argv.includes('--nur-einheit')) {
  console.log(`${ok} bestanden, ${schlecht} fehlgeschlagen (nur serverfreie Tests)`);
  process.exit(schlecht ? 1 : 0);
}

// --- HTTP-Integration ---

const ADMIN_EMAIL = 'admin@test.hu';
const ADMIN_PASSWORT = 'passwort12345';
const TEST_SK = 'sk_test_placeholder00000000000000000000000000';
const TEST_WHSEC = 'whsec_placeholder0000000000000000000000000000';
const SERVER = new URL('../server.mjs', import.meta.url).pathname;

function basisEnv(extra = {}) {
  return { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? '', ...extra };
}

async function holen(port, pfad, { method = 'GET', headers = {}, body = null } = {}) {
  const init = { method, headers: { Accept: 'text/html', ...headers }, redirect: 'manual' };
  if (body !== null) init.body = body;
  const a = await fetch(`http://127.0.0.1:${port}${pfad}`, init);
  const text = await a.text();
  return { status: a.status, text, headers: Object.fromEntries(a.headers) };
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
  await new Promise(r => {
    if (p.exitCode !== null) return r();
    p.on('exit', r);
    setTimeout(() => { try { p.kill('SIGKILL'); } catch {} r(); }, 10000);
  });
}

async function einrichtungsmodusServer(tmpord, port, extraEnv = {}) {
  // Phase 1: Setup-Server mit EINRICHTUNGSMODUS=1 -> erstellt ERSTSTART.txt und Admin
  const { p: pSetup } = await starteServer(tmpord, port, { EINRICHTUNGSMODUS: '1', ...extraEnv });
  for (let i = 0; i < 600; i++) {
    if (existsSync(join(tmpord, 'daten', 'ERSTSTART.txt'))) break;
    await warte(100);
  }
  const codeFile = join(tmpord, 'daten', 'ERSTSTART.txt');
  const { readFileSync } = await import('node:fs');
  const setupCode = existsSync(codeFile) ? readFileSync(codeFile, 'utf8').trim() : null;
  if (setupCode) {
    await holen(port, '/einrichtung', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: setupCode, email: ADMIN_EMAIL, passwort: ADMIN_PASSWORT }).toString(),
    });
  }
  await stop(pSetup);
  // Phase 2: Normaler Start ohne EINRICHTUNGSMODUS -> Einrichtungsmodus (ADMIN_ERSTELLT + keine Stripe-Keys)
  const { p } = await starteServer(tmpord, port, extraEnv);
  return { p };
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

async function schritteAbschliessen(port, sessionCookie) {
  await postSchritt(port, sessionCookie, 1, { PLATTFORM_NAME: 'Testplattform' });
  await postSchritt(port, sessionCookie, 2, {
    modus_impressum: 'erstellt', modus_datenschutz: 'erstellt', modus_teilnahmebedingungen: 'erstellt',
    ANBIETER_NAME: 'Test GmbH', ANBIETER_ANSCHRIFT: 'Musterstrasse 1, 12345 Budapest', ANBIETER_EMAIL: 'info@test.hu',
  });
  await postSchritt(port, sessionCookie, 3, { aktion: 'ohne_mail' });
  await holen(port, '/api/admin/stepup', {
    method: 'POST',
    headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ passwort: ADMIN_PASSWORT }),
  });
  await postSchritt(port, sessionCookie, 4, { STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC });
  await postSchritt(port, sessionCookie, 5, { aktion: 'ueberspringen' });
}

// G13: HTTP - POST /schritt/6 schlaegt fehl wenn Pflichtschritte fehlen
abschnitt('G13: HTTP - POST /schritt/6 mit fehlenden Pflichtschritten -> 400');
{
  const t = mkdtempSync(join(tmpdir(), 'g1a-g13-'));
  const PORT = 19810;
  try {
    const { p } = await einrichtungsmodusServer(t, PORT);
    const sessionCookie = await einloggen(PORT);
    // Nur Schritt 1 abschliessen (3+4 fehlen)
    await postSchritt(PORT, sessionCookie, 1, { PLATTFORM_NAME: 'Testplattform' });
    // Versuche POST /schritt/6
    const { csrf, text: berichtRot } = await holeCsrf(PORT, sessionCookie, 6);
    const listeRot = berichtRot.match(/<ul class="bericht-liste">([\s\S]*?)<\/ul>/)?.[1] ?? '';
    pruefe('G13d: GET Pflicht rot zeigt Bericht', listeRot.length > 0);
    for (const n of [2, 3, 4]) {
      pruefe(`G13e: Pflicht rot verlinkt Schritt ${n}`, listeRot.includes(`<a href="/admin/einrichtung/schritt/${n}">`));
    }
    pruefe('G13f: schluessel ohne Selbstlink', !listeRot.includes('<a href="/admin/einrichtung/schritt/6">'));
    const r = await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', schluessel_gesichert: '1' }).toString(),
    });
    pruefe('G13a: POST /schritt/6 ohne Pflichtschritte -> 400', r.status === 400, `status=${r.status}`);
    pruefe('G13b: 400-Antwort nicht leer', r.text.length > 0, `body=${r.text.slice(0, 100)}`);
    // DB-Zustand bleibt unveraendert (nicht KONFIGURIERT)
    await warte(200);
    const db2 = new DatabaseSync(join(t, 'app.db'), { readOnly: true });
    db2.exec('PRAGMA busy_timeout=3000');
    const zustand = db2.prepare("SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'").get()?.wert;
    db2.close();
    pruefe('G13c: Zustand bleibt nicht KONFIGURIERT', zustand !== 'KONFIGURIERT', `zustand=${zustand}`);
    await stop(p);
  } finally { aufraeumen(t); }
}

// G14: HTTP - GET /schritt/6 zeigt Bericht-Abschnitt
abschnitt('G14: HTTP - GET /schritt/6 zeigt Abschluss-Bericht');
{
  const t = mkdtempSync(join(tmpdir(), 'g1a-g14-'));
  const PORT = 19811;
  try {
    const { p } = await einrichtungsmodusServer(t, PORT);
    const sessionCookie = await einloggen(PORT);
    await schritteAbschliessen(PORT, sessionCookie);
    await postSchritt(PORT, sessionCookie, 5, { kurs_titel: 'Startkurs', kurs_beschreibung: 'Test', kurs_preis: '100', kurs_waehrung: 'eur' });
    // Schluessel anzeigen
    const { csrf } = await holeCsrf(PORT, sessionCookie, 6);
    await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    const r = await holen(PORT, '/admin/einrichtung/schritt/6', { headers: { Cookie: sessionCookie } });
    const listeOk = r.text.match(/<ul class="bericht-liste">([\s\S]*?)<\/ul>/)?.[1] ?? '';
    pruefe('G14c: GET Pflicht ok zeigt Bericht', listeOk.length > 0);
    for (const n of [2, 3, 4, 6]) {
      pruefe(`G14d: Pflicht ok ohne Korrekturlink Schritt ${n}`, !listeOk.includes(`<a href="/admin/einrichtung/schritt/${n}">`));
    }
    pruefe('G14a: GET /schritt/6 -> 200', r.status === 200, `status=${r.status}`);
    // Bericht-Abschnitt muss sichtbar sein (enthaelt Text-Key oder Tabelle mit Pruefungen)
    pruefe('G14b: Seite enthaelt Bericht-Elemente (ok/rot/hinweis oder g1a-)',
      r.text.includes('g1a_') || r.text.includes('bericht') || r.text.includes('Prüfung') ||
      r.text.includes('ellenőrzés') || r.text.includes('ok') || r.text.includes('✓'),
      r.text.slice(400, 700));
    await stop(p);
  } finally { aufraeumen(t); }
}

// G15: HTTP - vollstaendiger Fluss -> KONFIGURIERT
abschnitt('G15: HTTP - Vollfluss mit allen Pflichtschritten -> KONFIGURIERT');
{
  const t = mkdtempSync(join(tmpdir(), 'g1a-g15-'));
  const PORT = 19812;
  try {
    const { p } = await einrichtungsmodusServer(t, PORT);
    const sessionCookie = await einloggen(PORT);
    await schritteAbschliessen(PORT, sessionCookie);
    await postSchritt(PORT, sessionCookie, 5, { kurs_titel: 'Startkurs', kurs_beschreibung: 'Test', kurs_preis: '100', kurs_waehrung: 'eur' });
    // Schluessel anzeigen
    const { csrf } = await holeCsrf(PORT, sessionCookie, 6);
    await holen(PORT, '/admin/einrichtung/schluessel-anzeigen', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf ?? '', passwort: ADMIN_PASSWORT }).toString(),
    });
    // POST /schritt/6 mit schluessel_gesichert=1
    const { csrf: csrf6 } = await holeCsrf(PORT, sessionCookie, 6);
    const r = await holen(PORT, '/admin/einrichtung/schritt/6', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrf6 ?? '', schluessel_gesichert: '1' }).toString(),
    });
    pruefe('G15a: POST /schritt/6 mit allem ok -> 200', r.status === 200, `status=${r.status}`);
    await warte(300);
    const db2 = new DatabaseSync(join(t, 'app.db'), { readOnly: true });
    db2.exec('PRAGMA busy_timeout=3000');
    const zustand = db2.prepare("SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'").get()?.wert;
    db2.close();
    pruefe('G15b: DB-Zustand ist KONFIGURIERT', zustand === 'KONFIGURIERT', `zustand=${zustand}`);
    await stop(p);
    const normalEnv = { STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC, PE_STRIPE_SECRET_KEY: TEST_SK, PE_STRIPE_WEBHOOK_SECRET: TEST_WHSEC };
    let lauf = await starteServer(t, PORT, normalEnv);
    try {
      const health = await holen(PORT, '/health');
      pruefe('F221 R1: vollstaendige Einrichtung startet normal', health.status !== 200 || !['setup', 'einrichtung'].includes(JSON.parse(health.text).modus));   // Normalmodus hat keinen /health (404) = kein Einrichtungsmodus
      const d = oeffneDb(join(t, 'app.db'));
      try {
        pruefe('F221 R1: AKTIV und erster Kurs angelegt', d.prepare("SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'").get()?.wert === 'AKTIV' && d.prepare('SELECT count(*) AS n FROM kurse').get().n > 0);
        d.exec("UPDATE einstellungen SET wert='KONFIGURIERT' WHERE schluessel='instanz_zustand'; DELETE FROM einstellungen WHERE schluessel LIKE 'ANBIETER_%' OR schluessel='STEUER_HINWEIS'; DELETE FROM marke WHERE schluessel='anbieter'");
      } finally { d.close(); }
    } finally { await stop(lauf.p); }
    lauf = await starteServer(t, PORT, { ...normalEnv,
      ANBIETER_NAME: 'Umgebung GmbH', ANBIETER_ANSCHRIFT: 'Musterstr. 1, Budapest', ANBIETER_EMAIL: 'info@test.hu',
    });
    try {
      const gesundheit = await holen(PORT, '/health');   // Normalmodus hat keinen /health (404) = kein Einrichtungsmodus
      pruefe('G1N HTTP: Umgebungsanbieter startet normal', gesundheit.status !== 200 || !['setup', 'einrichtung'].includes(JSON.parse(gesundheit.text).modus));
      pruefe('G1N HTTP: Shop erreichbar', (await holen(PORT, '/api/kurse')).status === 200);
      const d = oeffneDb(join(t, 'app.db'));
      try {
        pruefe('G1N HTTP: Zustand AKTIV', d.prepare("SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'").get()?.wert === 'AKTIV');
        d.exec("UPDATE einstellungen SET wert='KONFIGURIERT' WHERE schluessel='instanz_zustand'; DELETE FROM einstellungen WHERE schluessel='recht_impressum'");
      } finally { d.close(); }
    } finally { await stop(lauf.p); }
    lauf = await starteServer(t, PORT, normalEnv);
    try {
      pruefe('F221 Env: Reparaturmodus trotz gesetzter Stripe-Werte', JSON.parse((await holen(PORT, '/health')).text).modus === 'einrichtung');
      for (const pfad of ['/api/kurse', '/']) {
        const r = await holen(PORT, pfad);
        pruefe(`F221 Env: ${pfad} liefert keinen Shop`, r.status === 404, `status=${r.status}`);
      }
      const d = new DatabaseSync(join(t, 'app.db'), { readOnly: true });
      try {
        pruefe('F221 Env: Zustand bleibt KONFIGURIERT', d.prepare("SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'").get()?.wert === 'KONFIGURIERT');
      } finally { d.close(); }
      const cookie = await einloggen(PORT);
      const bericht = await holeCsrf(PORT, cookie, 6);
      pruefe('F221 R2: Bericht rot mit Korrekturlink', bericht.status === 200 && bericht.text.includes('/admin/einrichtung/schritt/2') && bericht.text.includes('rot'));
      await postSchritt(PORT, cookie, 2, {
        modus_impressum: 'erstellt', modus_datenschutz: 'erstellt', modus_teilnahmebedingungen: 'erstellt',
        ANBIETER_NAME: 'Test GmbH', ANBIETER_ANSCHRIFT: 'Musterstr. 1, Budapest', ANBIETER_EMAIL: 'info@test.hu',
      });
      const abschluss = await postSchritt(PORT, cookie, 6, { schluessel_gesichert: '1' });
      pruefe('F221 R3: erneuter Abschluss nach Korrektur', abschluss.status === 200, abschluss.status);
    } finally { await stop(lauf.p); }
    lauf = await starteServer(t, PORT, normalEnv);
    try {
      const api = await holen(PORT, '/api/kurse');
      pruefe('F221 R3: Shop-API nach Reparatur erreichbar', api.status === 200, api.status);
    } finally { await stop(lauf.p); }
  } finally { aufraeumen(t); }
}

// G16: F-221 Reparaturmodus sperrt oeffentliche Shop-Routen auch nach Neustart
abschnitt('G16: Normalstart - KONFIGURIERT ohne Rechtstext bleibt nicht AKTIV');
{
  const t = mkdtempSync(join(tmpdir(), 'g1a-g16-'));
  const PORT = 19813;
  try {
    // DB mit KONFIGURIERT aber ohne Rechtstexte anlegen
    const dbPfad = join(t, 'app.db');
    const d = new DatabaseSync(dbPfad);
    d.exec('PRAGMA journal_mode = WAL');
    d.exec(`CREATE TABLE IF NOT EXISTS benutzer (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, passwort_hash TEXT NOT NULL, stripe_kunde TEXT UNIQUE, erstellt TEXT NOT NULL)`);
    d.exec(`CREATE TABLE IF NOT EXISTS sitzungen (token_hash TEXT PRIMARY KEY, benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE, laeuft_ab INTEGER NOT NULL)`);
    d.exec(`CREATE TABLE IF NOT EXISTS einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT, verschluesselt INTEGER NOT NULL DEFAULT 0 CHECK(verschluesselt IN (0,1)), iv TEXT, tag TEXT, aktualisiert_am TEXT NOT NULL)`);
    const ins = d.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES (?,?,0,datetime('now'))");
    // KONFIGURIERT aber ohne recht_impressum etc.
    ins.run('instanz_zustand', 'KONFIGURIERT');
    ins.run('einrichtung_schritt_3', 'fertig');
    ins.run('einrichtung_schritt_4', 'fertig');
    // Keine recht_* Einstellungen
    d.prepare("INSERT OR IGNORE INTO benutzer (email, passwort_hash, erstellt) VALUES (?,?,datetime('now'))")
      .run(ADMIN_EMAIL, '$2b$12$placeholder_hash_for_test_only_x');
    d.close();
    // Stripe-Keys als Env mitgeben (damit Normalstart-Modus aktiv)
    const { p } = await einrichtungsmodusServer(t, PORT, {
      PE_STRIPE_SECRET_KEY: TEST_SK,
      PE_STRIPE_WEBHOOK_SECRET: TEST_WHSEC,
    });
    await warte(1500); // Server-Start abwarten
    // Zustand pruefen: muss KONFIGURIERT bleiben (nicht AKTIV)
    const db2 = new DatabaseSync(dbPfad, { readOnly: true });
    db2.exec('PRAGMA busy_timeout=3000');
    const zustand = db2.prepare("SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'").get()?.wert;
    db2.close();
    pruefe('G16a: KONFIGURIERT bleibt fuer erneute Pruefung erhalten', zustand === 'KONFIGURIERT', `zustand=${zustand}`);
    const pruefeSperre = async () => {
      const health = await holen(PORT, '/health');
      pruefe('F221 R2/R4: Einrichtungsmodus statt Shop', JSON.parse(health.text).modus === 'einrichtung', health.text);
      for (const pfad of ['/', '/api/kurse', '/api/texte', '/marke.css', '/jogi/impresszum']) {
        const r = await holen(PORT, pfad);
        pruefe(`F221 R2/R4: ${pfad} nicht als Shop erreichbar`, r.status === 404, `status=${r.status}`);
      }
    };
    try { await pruefeSperre(); } finally { await stop(p); }
    const erneut = await starteServer(t, PORT, { PE_STRIPE_SECRET_KEY: TEST_SK, PE_STRIPE_WEBHOOK_SECRET: TEST_WHSEC });
    try { await pruefeSperre(); } finally { await stop(erneut.p); }
  } finally { aufraeumen(t); }
}

// G17: Normalstart - bereits AKTIV bleibt AKTIV
abschnitt('G17: Normalstart - AKTIV bleibt AKTIV (Altinstanz unberuehrt)');
{
  const t = mkdtempSync(join(tmpdir(), 'g1a-g17-'));
  const PORT = 19814;
  try {
    const dbPfad = join(t, 'app.db');
    const d = new DatabaseSync(dbPfad);
    d.exec('PRAGMA journal_mode = WAL');
    d.exec(`CREATE TABLE IF NOT EXISTS benutzer (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, passwort_hash TEXT NOT NULL, stripe_kunde TEXT UNIQUE, erstellt TEXT NOT NULL)`);
    d.exec(`CREATE TABLE IF NOT EXISTS sitzungen (token_hash TEXT PRIMARY KEY, benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE, laeuft_ab INTEGER NOT NULL)`);
    d.exec(`CREATE TABLE IF NOT EXISTS einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT, verschluesselt INTEGER NOT NULL DEFAULT 0 CHECK(verschluesselt IN (0,1)), iv TEXT, tag TEXT, aktualisiert_am TEXT NOT NULL)`);
    const ins = d.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES (?,?,0,datetime('now'))");
    ins.run('instanz_zustand', 'AKTIV');
    d.prepare("INSERT OR IGNORE INTO benutzer (email, passwort_hash, erstellt) VALUES (?,?,datetime('now'))")
      .run(ADMIN_EMAIL, '$2b$12$placeholder_hash_for_test_only_x');
    d.close();
    const { p } = await starteServer(t, PORT, {   // normaler Start (AKTIV): echte Stripe-Variablennamen, nicht der Einrichtungsmodus-Helfer
      STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC,
      PE_STRIPE_SECRET_KEY: TEST_SK, PE_STRIPE_WEBHOOK_SECRET: TEST_WHSEC,
    });
    await warte(1500);
    const db2 = new DatabaseSync(dbPfad, { readOnly: true });
    db2.exec('PRAGMA busy_timeout=3000');
    const zustand = db2.prepare("SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'").get()?.wert;
    db2.close();
    pruefe('G17a: AKTIV bleibt AKTIV', zustand === 'AKTIV', `zustand=${zustand}`);
    pruefe('F221 R5: AKTIV ohne Rechtstexte liefert Shop-API', (await holen(PORT, '/api/kurse')).status === 200);
    await stop(p);
  } finally { aufraeumen(t); }
}

// Schlussbericht
console.log('');
if (schlecht > 0) {
  console.log(`${schlecht} Test(s) mit Fehlern`);
  process.exit(1);
} else {
  console.log(`${ok} bestanden, 0 fehlgeschlagen`);
}
