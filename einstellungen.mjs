// WP2 Sicherheitsblock: verschluesselter Einstellungsspeicher auf Basis der Tabelle einstellungen (WP1).
// Geheimnisse (Stripe, Webhook, Mail, Bunny, Sicherung, Wiedergabe, Plattform-Webhook) werden mit
// AES-256-GCM verschluesselt; IV ist pro Wert 12 Byte zufaellig, Tag 16 Byte wird mit abgelegt.
// Hauptschluessel: 32 Byte Zufallsdaten in daten/.hauptschluessel (0600, in .gitignore) oder EINSTELLUNGEN_SCHLUESSEL (Base64).
// Keine Geheimnisse in Logs, Fehlermeldungen, API-Antworten: nach aussen nur maskiert (letzte 4 Zeichen) oder gesetzt:true/false.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { KonfigFehler } from './konfig.mjs';

// Namen der env-Variablen/Schluessel, deren Werte als Geheimnis gelten und immer verschluesselt gespeichert werden.
// (Mindestens: Stripe, Stripe-Webhook, Resend/SMTP, Bunny, Sicherung, Wiedergabe laut Spez; Plattform-Webhook-Schluessel ebenso.)
export const GEHEIMNISFELDER = new Set([
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'BUNNY_STREAM_API_KEY',
  'BUNNY_STREAM_TOKEN_KEY',
  'SICHERUNG_BUNNY_SCHLUESSEL',
  'SICHERUNG_SCHLUESSEL',
  'WIEDERGABE_GEHEIMNIS',
  'PLATTFORM_WEBHOOK_KEY',
]);

export const HAUPTSCHLUESSEL_LAENGE = 32;   // 256 Bit
const IV_LAENGE = 12;                       // GCM-Standard
const TAG_LAENGE = 16;                      // GCM-Standard

function base64D(s) { return Buffer.from(String(s), 'base64'); }
function base64E(b) { return Buffer.from(b).toString('base64'); }

// Liefert den 32-Byte-Hauptschluessel zum LESEN. Reihenfolge: env.EINSTELLUNGEN_SCHLUESSEL (Base64) > Datei.
// Beim Lesen wird NIE ein Schluessel erzeugt (Chef-Review 2026-11-13, Spez-Konsequenz: keine Seiteneffekte in Bestandsinstanzen).
// Fehlen beide bei vorhandenen verschluesselten Werten: KonfigFehler (B4). Fehlen beide ohne verschluesselte Werte: return null.
// Der Aufrufer (schreibeGeheimnisErstmalig) ist dafuer zustaendig, den Schluessel bei Bedarf einmalig anzulegen.
export function holeHauptschluessel({ env = {}, dateiPfad = 'daten/.hauptschluessel', verschluesselteWerteVorhanden = false } = {}) {
  const roh = env.EINSTELLUNGEN_SCHLUESSEL ? String(env.EINSTELLUNGEN_SCHLUESSEL).trim() : '';
  if (roh) {
    let b;
    try { b = base64D(roh); } catch { throw new KonfigFehler(['EINSTELLUNGEN_SCHLUESSEL muss Base64 von genau 32 Bytes sein.']); }
    if (b.length !== HAUPTSCHLUESSEL_LAENGE) throw new KonfigFehler(['EINSTELLUNGEN_SCHLUESSEL muss Base64 von genau 32 Bytes sein.']);
    return b;
  }
  if (existsSync(dateiPfad)) {
    const inhalt = readFileSync(dateiPfad);
    if (inhalt.length === HAUPTSCHLUESSEL_LAENGE) return inhalt;
    throw new KonfigFehler(['Hauptschluessel-Datei hat nicht die erwartete Laenge (32 Bytes).']);
  }
  if (verschluesselteWerteVorhanden) {
    throw new KonfigFehler(['Hauptschluessel fehlt (Datei oder EINSTELLUNGEN_SCHLUESSEL), aber verschluesselte Werte sind vorhanden. Wiederherstellung siehe docs/WP2-EINSTELLUNGEN.md.']);
  }
  return null;   // keine verschluesselten Werte und kein Schluessel: Leerzustand, kein Fehler, keine Datei anlegen.
}

// Legt EINMAL einen 32-Byte-Hauptschluessel in dateiPfad an (Rechte 0600, Ordner wird bei Bedarf angelegt).
// Atomarer Schreibversuch via flag:'wx' — bei EEXIST (Datei vorhanden) wird die vorhandene Datei gelesen
// und zurückgegeben, damit parallele Prozessstart keine Race Condition produzieren.
export function erzeugeHauptschluesselDatei(dateiPfad = 'daten/.hauptschluessel') {
  mkdirSync(dirname(dateiPfad), { recursive: true });
  const neu = randomBytes(HAUPTSCHLUESSEL_LAENGE);
  try {
    writeFileSync(dateiPfad, neu, { flag: 'wx', mode: 0o600 });
    try { chmodSync(dateiPfad, 0o600); } catch { /* best effort */ }
    return neu;
  } catch (e) {
    if (e.code === 'EEXIST') {
      // Codex Lauf 10: Der andere Prozess schreibt eventuell noch; kurz warten, bis die Datei vollstaendig (32 Bytes) ist.
      for (let i = 0; i < 40; i++) {
        const inhalt = readFileSync(dateiPfad);
        if (inhalt.length === HAUPTSCHLUESSEL_LAENGE) return inhalt;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
      throw new KonfigFehler(['Hauptschluessel-Datei ist unvollstaendig.']);
    }
    throw e;
  }
}

// Read-only-Pruefung direkt auf der DB-Datei: enthaelt die Tabelle einstellungen Zeilen ausser instanz_zustand?
// Analog zu leseStartZustand - OHNE db.mjs zu laden (keine Seiteneffekte in Bestandsinstanzen).
// Fehlende Datei/Tabelle oder nur instanz_zustand-Zeile -> false.
export function hatGespeicherteEinstellungen(dbDatei) {
  if (!dbDatei || typeof dbDatei !== 'string' || !existsSync(dbDatei)) return false;
  let d;
  try {
    d = new DatabaseSync(dbDatei, { readOnly: true });
    const tab = d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='einstellungen'").get();
    if (!tab) return false;
    const r = d.prepare("SELECT 1 FROM einstellungen WHERE schluessel != 'instanz_zustand' LIMIT 1").get();
    return !!r;
  } catch { return false; }
  finally { if (d) { try { d.close(); } catch { /* ignore */ } } }
}

// Verschluesselt einen Wert; bindet den Feldnamen als AAD (Additional Authenticated Data),
// damit ein Chiffretext NICHT zwischen Feldern vertauscht werden kann (Nachbesserung 4, Chef 2026-11-13).
export function verschluesseleGeheimnis(wert, hauptschluessel, aadName) {
  if (!(hauptschluessel instanceof Buffer) || hauptschluessel.length !== HAUPTSCHLUESSEL_LAENGE) throw new KonfigFehler(['Hauptschluessel hat nicht die erwartete Laenge.']);
  if (typeof aadName !== 'string' || !aadName) throw new KonfigFehler(['verschluesseleGeheimnis: aadName fehlt.']);
  const iv = randomBytes(IV_LAENGE);
  const c = createCipheriv('aes-256-gcm', hauptschluessel, iv);
  c.setAAD(Buffer.from(aadName, 'utf8'));
  const chiffre = Buffer.concat([c.update(Buffer.from(String(wert), 'utf8')), c.final()]);
  const tag = c.getAuthTag();
  return { chiffre, iv, tag };
}

export function entschluesseleGeheimnis({ chiffre, iv, tag }, hauptschluessel, aadName) {
  if (!(hauptschluessel instanceof Buffer) || hauptschluessel.length !== HAUPTSCHLUESSEL_LAENGE) throw new KonfigFehler(['Hauptschluessel hat nicht die erwartete Laenge.']);
  if (typeof aadName !== 'string' || !aadName) throw new KonfigFehler(['entschluesseleGeheimnis: aadName fehlt.']);
  const d = createDecipheriv('aes-256-gcm', hauptschluessel, iv);
  d.setAuthTag(tag);
  d.setAAD(Buffer.from(aadName, 'utf8'));
  // Die Fehlermeldung enthaelt den Wert NIE (GCM-AuthFail wirft generisch; wir fangen und ersetzen).
  try {
    const klar = Buffer.concat([d.update(chiffre), d.final()]);
    return klar.toString('utf8');
  } catch {
    throw new KonfigFehler(['Einstellungswert nicht lesbar (Integritaetspruefung fehlgeschlagen).']);
  }
}

// Maskiert ein Geheimnis fuer die externe Anzeige:
// - Werte kuerzer als 12 Zeichen komplett maskiert ('••••' ohne Endung) (Nachbesserung 5, Chef 2026-11-13).
// - sonst bekannter Praefix + '••••' + letzte 4 Zeichen (sk_test_••••abcd).
// - Leerer Wert -> ''.
export function maskiereGeheimnis(wert) {
  if (typeof wert !== 'string' || !wert) return '';
  if (wert.length < 12) return '••••';
  const letzte = wert.slice(-4);
  const prefix = wert.match(/^(sk_test_|sk_live_|whsec_|pk_test_|pk_live_|rk_test_|rk_live_|re_)/);
  return prefix ? `${prefix[0]}••••${letzte}` : `••••${letzte}`;
}

// Prueft, ob die Tabelle einstellungen bereits Zeilen mit verschluesselt=1 enthaelt.
export function verschluesselteWerteVorhanden(db) {
  try {
    const r = db.prepare('SELECT 1 FROM einstellungen WHERE verschluesselt=1 LIMIT 1').get();
    return !!r;
  } catch { return false; }
}

// Oeffnet den Einstellungsspeicher und entschluesselt einmal alle Werte in einen Cache.
// Rueckgabe:
//   lese(name)  : Klartext (string) oder null (intern; nie fuer API ausgeben!)
//   schreibe(name, wert): legt einen Wert ab. Geheimnisfelder werden verschluesselt.
//   anzeige(name): { gesetzt: true|false, maskiert|wert } fuer die externe Ausgabe.
//   lade()      : Cache neu aus der DB fuellen (nach externem Schreibvorgang).
export function oeffneEinstellungsSpeicher(db, { hauptschluessel }) {
  const cache = new Map();
  const jetzt = () => new Date().toISOString();

  function lade() {
    cache.clear();
    const rows = db.prepare('SELECT schluessel, wert, verschluesselt, iv, tag FROM einstellungen').all();
    for (const r of rows) {
      // Nachbesserung 2 (Chef 2026-11-13): Downgrade abwehren. Fuer Geheimnisfelder MUSS verschluesselt=1 sein.
      if (GEHEIMNISFELDER.has(r.schluessel) && r.verschluesselt !== 1) {
        throw new KonfigFehler([`Einstellung "${r.schluessel}": Geheimnis nicht verschluesselt gespeichert.`]);
      }
      if (r.verschluesselt === 1) {
        // Nachbesserung 3 (Chef 2026-11-13): Fehlende Felder in einer "verschluesselt"-Zeile sind Defekt/Manipulation,
        // nicht stille Uebergehung.
        if (!r.wert || !r.iv || !r.tag) {
          throw new KonfigFehler([`Einstellung "${r.schluessel}" ist defekt (fehlende iv/tag/wert bei verschluesselt=1).`]);
        }
        // AAD = Schluesselname (Nachbesserung 4): vertauschte Chiffretexte schlagen hier fehl.
        const klar = entschluesseleGeheimnis({ chiffre: base64D(r.wert), iv: base64D(r.iv), tag: base64D(r.tag) }, hauptschluessel, r.schluessel);
        cache.set(r.schluessel, klar);
      } else {
        cache.set(r.schluessel, r.wert ?? '');
      }
    }
  }

  function lese(name) { return cache.has(name) ? cache.get(name) : null; }

  function schreibe(name, wert) {
    const stmt = db.prepare('INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, iv, tag, aktualisiert_am) VALUES (?, ?, ?, ?, ?, ?)');
    if (GEHEIMNISFELDER.has(name)) {
      const { chiffre, iv, tag } = verschluesseleGeheimnis(wert, hauptschluessel, name);   // AAD = Feldname
      stmt.run(name, base64E(chiffre), 1, base64E(iv), base64E(tag), jetzt());
    } else {
      stmt.run(name, String(wert), 0, null, null, jetzt());
    }
    cache.set(name, String(wert));
  }

  function anzeige(name) {
    const w = lese(name);
    if (w === null || w === undefined || w === '') return { gesetzt: false };
    if (GEHEIMNISFELDER.has(name)) return { gesetzt: true, maskiert: maskiereGeheimnis(w) };
    return { gesetzt: true, wert: w };
  }

  lade();
  return { lese, schreibe, lade, anzeige };
}
