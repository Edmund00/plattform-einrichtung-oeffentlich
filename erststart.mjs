// WP3 Sicherheitsblock: Einmal-Einrichtungscode fuer den geschuetzten Erststart.
// - 8 Gruppen à 4 Zeichen aus dem Alphabet 23456789ABCDEFGHJKLMNPQRSTUVWXYZ (32 Zeichen, keine Verwechsler
//   wie 0/O, 1/I/l). 32 Zeichen x 5 Bit = 160 Bit Zufall (Spez: mindestens 128 Bit).
// - Nur der Hash (SHA-256 ueber salz + code) steht in der DB-Tabelle einrichtungs_token.
// - INSERT OR IGNORE gegen UNIQUE id=1 -> zwei gleichzeitig startende Prozesse erzeugen nie zwei gueltige Codes.
// - Klartext-Code steht EINMAL in der Konsole und in daten/ERSTSTART.txt (0600); beides beim Abschluss geloescht.
// - timingSafeEqual auf gleich langen Hashes beim Vergleich; kein Klartext, keine URL, keine HTTP-Antwort, kein Log.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { writeFileSync, chmodSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // 32 Zeichen (5 Bit/Zeichen)
export const CODE_LAENGE = 32;                                      // 8 Gruppen à 4 -> 160 Bit Zufall
const CODE_GUELTIG_MS = 24 * 60 * 60 * 1000;                        // 24 h

export function formatiereCode(reinerCode) {
  // "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" -> "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ01-2345"
  const g = [];
  for (let i = 0; i < reinerCode.length; i += 4) g.push(reinerCode.slice(i, i + 4));
  return g.join('-');
}

export function entferneTrennzeichen(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function erzeugeCode() {
  const roh = randomBytes(CODE_LAENGE);
  let c = '';
  for (let i = 0; i < CODE_LAENGE; i++) c += CODE_ALPHABET[roh[i] % 32];
  return c;
}

function hashCode(code, salz) {
  // SHA-256 ueber salz || code (beide Buffer). Salz macht Rainbow-Tabellen wertlos; die Code-Entropie ist 160 Bit.
  return createHash('sha256').update(Buffer.concat([salz, Buffer.from(code, 'utf8')])).digest();
}

// Erzeugt (einmalig pro aktiver Zeile) einen neuen Code, legt ihn in die DB (id=1, INSERT OR IGNORE)
// und schreibt ihn in die Datei (0600) + eine Konsolenzeile. Rueckgabe:
//   { codeFormatiert, bereitsVorhanden: boolean }
// bereitsVorhanden=true -> eine gueltige Zeile existiert schon (anderer Prozess war schneller); kein Konsolenaufruf, keine Datei.
// Abgelaufene Zeile wird vor dem Einfuegen entfernt.
// Retry-Loop um BEGIN IMMEDIATE: wenn SQLite trotz busy_timeout mit SQLITE_BUSY aussteigt (parallele DDL beim
// gleichzeitigen Server-Start, Chef-Review 2026-11-13), bis zu N Mal wiederholen. Jede Wiederholung prueft neu,
// ob die Zeile inzwischen von einem anderen Prozess angelegt wurde (bereitsVorhanden=true, Spez-C11).
export function erzeugeEinrichtungscode(db, { dateiPfad = 'daten/ERSTSTART.txt', jetzt = Date.now(), konsole = true, maxVersuche = 10, warteMsBasis = 100 } = {}) {
  let letzterFehler;
  for (let versuch = 0; versuch < maxVersuche; versuch++) {
    try {
      return _erzeugeEinrichtungscode(db, { dateiPfad, jetzt, konsole });
    } catch (e) {
      letzterFehler = e;
      // SQLITE_BUSY=5. Andere Fehler sofort weiterreichen.
      if (e?.errcode !== 5 && !/busy|locked/i.test(e?.message || '')) throw e;
      // Linear schlafen, nicht lang. Die Transaktion wartet selbst schon via busy_timeout; dieser Loop deckt
      // den Fall ab, dass busy_timeout trotz paralleler DDL zuwenig ist.
      const dt = warteMsBasis * (versuch + 1);
      const ende = Date.now() + dt; while (Date.now() < ende) { /* busy wait, sync */ }
    }
  }
  throw letzterFehler;
}

function _erzeugeEinrichtungscode(db, { dateiPfad, jetzt, konsole }) {
  db.exec('BEGIN IMMEDIATE');
  try {
    // Abgelaufene Zeile raeumen (nach Ablauf oder Neustart soll ein NEUER Token erzeugt werden, aber ein nicht abgelaufener bleibt).
    db.prepare('DELETE FROM einrichtungs_token WHERE id=1 AND laeuft_ab <= ?').run(jetzt);
    // Wenn bereits eine gueltige Zeile existiert, nichts tun (C11: beide Prozesse laufen hier durch, aber nur einer kommt dran).
    const vorhanden = db.prepare('SELECT 1 AS da FROM einrichtungs_token WHERE id=1').get();
    if (vorhanden) {
      db.exec('COMMIT');
      return { codeFormatiert: null, bereitsVorhanden: true };
    }
    // Einmaliges Einfuegen. Die UNIQUE id=1 + die laufende Transaktion garantieren, dass nur ein Prozess hier ankommt.
    const code = erzeugeCode();
    const salz = randomBytes(32);
    const codeHash = hashCode(code, salz).toString('base64');
    db.prepare('INSERT INTO einrichtungs_token (id, code_hash, salz, erzeugt_am, laeuft_ab) VALUES (1, ?, ?, ?, ?)')
      .run(codeHash, salz.toString('base64'), jetzt, jetzt + CODE_GUELTIG_MS);
    db.exec('COMMIT');
    const formatiert = formatiereCode(code);
    try { mkdirSync(dirname(dateiPfad), { recursive: true }); writeFileSync(dateiPfad, formatiert + '\n', { mode: 0o600 }); try { chmodSync(dateiPfad, 0o600); } catch { /* best effort */ } } catch { /* best effort */ }
    if (konsole) {
      // Einzige erlaubte Ausnahme von "keine Geheimnisse in Logs": genau DIESE Zeile fuer den Betreiber.
      console.log(`Einrichtungscode (24 h gueltig): ${formatiert}`);
    }
    return { codeFormatiert: formatiert, bereitsVorhanden: false };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

// Prueft einen vom Benutzer eingegebenen (vermutlich getrennten) Code gegen die gueltige Zeile.
// Rueckgabe { gueltig: boolean } in konstanter Zeit (timingSafeEqual auf 32-Byte-Hashes).
// Wenn keine Zeile existiert oder die vorhandene abgelaufen ist, liefert sie {gueltig:false}; die Zeile wird NICHT geloescht.
export function pruefeEinrichtungscode(db, eingabe, { jetzt = Date.now() } = {}) {
  const code = entferneTrennzeichen(eingabe);
  const zeile = db.prepare('SELECT code_hash, salz, laeuft_ab FROM einrichtungs_token WHERE id=1').get();
  // Konstant-Zeit-Dummy, wenn keine Zeile: wir rechnen trotzdem einen Hash, damit der Gesamtaufwand nicht leakt.
  const dummySalz = Buffer.alloc(32);
  const dummyHash = Buffer.alloc(32);
  const vorhanden = !!zeile;
  const nichtAbgelaufen = vorhanden && zeile.laeuft_ab > jetzt;
  const salz = vorhanden ? Buffer.from(zeile.salz, 'base64') : dummySalz;
  const gespeichert = vorhanden ? Buffer.from(zeile.code_hash, 'base64') : dummyHash;
  const berechnet = hashCode(code, salz);
  const gleich = gespeichert.length === berechnet.length && timingSafeEqual(gespeichert, berechnet);
  return { gueltig: vorhanden && nichtAbgelaufen && gleich };
}

// Zustands-Marker fuer eine "abgeschlossene" Einrichtung: die Zeile wird im POST /einrichtung-Handler in der gleichen
// Transaktion wie das Admin-Konto geloescht, damit es keinen halben Zustand gibt.
export function tokenZeileLoeschen(db) {
  db.prepare('DELETE FROM einrichtungs_token WHERE id=1').run();
}

// Loescht die Datei, in der der Code im Klartext fuer den Betreiber steht. "Best effort" - wenn die Datei fehlt, schweigend weiter.
export function loescheErststartDatei(dateiPfad = 'daten/ERSTSTART.txt') {
  try { if (existsSync(dateiPfad)) unlinkSync(dateiPfad); } catch { /* best effort */ }
}

// ---- Sperre nach Fehlversuchen (im Prozess-Speicher, wie auth.mjs) -----------------------------------
// Je IP: max 5 Fehlversuche in 15 min -> danach 15 min gesperrt.
// Global: max 20 Fehlversuche in 60 min -> danach 15 min Pause.
const IP_MAX = 5;
const IP_FENSTER = 15 * 60 * 1000;
const IP_SPERRE = 15 * 60 * 1000;
const GLOBAL_MAX = 20;
const GLOBAL_FENSTER = 60 * 60 * 1000;
const GLOBAL_SPERRE = 15 * 60 * 1000;

const ipFehlversuche = new Map();   // ip -> number[] (ms-Zeitpunkte)
let globalFehlversuche = [];

function filter(liste, jetzt, fenster) {
  return liste.filter(t => t > jetzt - fenster);
}

export function sperreZustand(ip, { jetzt = Date.now() } = {}) {
  const ipListe = filter(ipFehlversuche.get(ip) || [], jetzt, Math.max(IP_FENSTER, IP_SPERRE));
  const gListe = filter(globalFehlversuche, jetzt, Math.max(GLOBAL_FENSTER, GLOBAL_SPERRE));
  const ipGesperrt = ipListe.length >= IP_MAX && (jetzt - ipListe[ipListe.length - IP_MAX] < IP_SPERRE);
  const globalGesperrt = gListe.length >= GLOBAL_MAX && (jetzt - gListe[gListe.length - GLOBAL_MAX] < GLOBAL_SPERRE);
  return { ipGesperrt, globalGesperrt, gesperrt: ipGesperrt || globalGesperrt };
}

export function fehlversuchMerken(ip, { jetzt = Date.now() } = {}) {
  const ipListe = filter(ipFehlversuche.get(ip) || [], jetzt, Math.max(IP_FENSTER, IP_SPERRE));
  ipListe.push(jetzt);
  ipFehlversuche.set(ip, ipListe);
  globalFehlversuche = filter(globalFehlversuche, jetzt, Math.max(GLOBAL_FENSTER, GLOBAL_SPERRE));
  globalFehlversuche.push(jetzt);
}

export function sperrenZuruecksetzen() {
  ipFehlversuche.clear();
  globalFehlversuche = [];
}
