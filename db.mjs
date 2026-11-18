// LEKTION 6: Eine echte Datenbank (SQLite)
// ------------------------------------------------------------------
// Vorher lag alles in einer JSON-Datei. Das geht schief, sobald zwei Dinge gleichzeitig passieren
// (zwei Webhooks, zwei Kunden) oder etwas mittendrin abbricht. Eine Datenbank löst das:
//   - Tabellen mit festen Spalten (jede Zeile hat dieselbe Form)
//   - UNIQUE: dieselbe E-Mail oder dieselbe Ereignis-ID kann nie zweimal vorkommen
//   - Transaktionen: entweder wird ALLES gespeichert oder NICHTS
//
// SQLite ist eine Datenbank in EINER Datei (hier daten/lern-app.db). Node bringt sie mit ("node:sqlite"),
// wir brauchen kein zusätzliches Paket. Für große Systeme nimmt man später eine Server-Datenbank
// (zum Beispiel PostgreSQL), die Denkweise und das SQL bleiben fast gleich.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DATEI = process.env.DB_DATEI || 'daten/lern-app.db';
mkdirSync(dirname(DATEI), { recursive: true });

export const db = new DatabaseSync(DATEI);
db.exec('PRAGMA busy_timeout = 5000;');  // WP3: zuerst - sonst kann schon journal_mode=WAL bei paralleler Initialisierung mit SQLITE_BUSY aussteigen
db.exec('PRAGMA journal_mode = WAL;');   // robuster bei gleichzeitigem Lesen und Schreiben
db.exec('PRAGMA foreign_keys = ON;');    // Verweise zwischen Tabellen werden wirklich geprüft
// Plattform-Meldung (Dashboard-Anbindung): Ihre Trigger auf benutzer/bestellungen/abos werden VOR allen Umbauten entfernt (ein RENAME/DROP einer Tabelle
// mit Trigger-Verweisen wuerde sonst den Start brechen) und nach dem Start von plattform-meldung.mjs neu angelegt, falls die Meldung an ist.
for (const x of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()) if (String(x.name).startsWith('plattform_t_')) db.exec('DROP TRIGGER IF EXISTS ' + x.name);

// Scheibe 15: bisherige Stripe-Duplikat-Tabelle einmalig umbenennen,
// bevor die neue Ereignisliste denselben Namen erhaelt. Keine Daten gehen verloren.
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ereignisse'").get() &&
    db.prepare('PRAGMA table_info(ereignisse)').all().some(x=>x.name==='verarbeitet')) {
  db.exec('ALTER TABLE ereignisse RENAME TO stripe_ereignisse');
}

db.exec(`
  -- Wer hat sich registriert? Das Passwort wird NIE im Klartext gespeichert (siehe auth.mjs).
  CREATE TABLE IF NOT EXISTS benutzer (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,        -- UNIQUE: keine zwei Konten mit derselben E-Mail
    passwort_hash TEXT NOT NULL,
    stripe_kunde  TEXT UNIQUE,                 -- die Kunden-ID bei Stripe (cus_...), entsteht beim ersten Kauf
    erstellt      TEXT NOT NULL
  );

  -- Wer ist gerade angemeldet? Wir speichern nur einen Fingerabdruck (Hash) des Sitzungs-Tokens.
  CREATE TABLE IF NOT EXISTS sitzungen (
    token_hash  TEXT PRIMARY KEY,
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    laeuft_ab   INTEGER NOT NULL               -- Zeitpunkt in Millisekunden
  );

  -- Welche Stripe-Ereignisse haben wir schon verarbeitet? Die Ereignis-ID ist UNIQUE:
  -- Ein zweites Mal einfügen geht nicht, so erkennt die Datenbank doppelte Webhooks von allein.
  CREATE TABLE IF NOT EXISTS stripe_ereignisse (
    id          TEXT PRIMARY KEY,
    typ         TEXT NOT NULL,
    verarbeitet TEXT NOT NULL
  );

  -- B4: Stripe-Ereignisse, die VOR ihrer Bestellung ankamen (zum Beispiel ein Streit vor dem Kauf-Ereignis). Sie gehen nicht verloren und
  -- brauchen keinen Stripe-Wiederholversuch: gespeichert, bei Anlage der Bestellung genau einmal verarbeitet (verarbeitet bleibt bis dahin NULL).
  CREATE TABLE IF NOT EXISTS wartende_ereignisse (
    ereignis_id     TEXT PRIMARY KEY,
    typ             TEXT NOT NULL,
    zahlung_id      TEXT NOT NULL,
    ereignis_json   TEXT NOT NULL,
    erstellt        TEXT NOT NULL,
    verarbeitet     TEXT
  );
  CREATE INDEX IF NOT EXISTS wartende_ereignisse_offen ON wartende_ereignisse(verarbeitet, zahlung_id);
`);

// Geschaeftsereignisse sind von den Stripe-Webhook-Duplikat-IDs getrennt.
db.exec(`
CREATE TABLE IF NOT EXISTS ereignisse (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 zeit INTEGER NOT NULL,
 typ TEXT NOT NULL CHECK(typ IN ('registriert','bestaetigt','gekauft','erstattet','abo_gestartet','abo_beendet','abo_gekuendigt','geloescht')),
 kurs_id INTEGER,
 kurs_titel TEXT,
 betrag INTEGER,
 waehrung TEXT,
 email TEXT,
 status TEXT,
 quelle_id TEXT NOT NULL,
 UNIQUE(typ,quelle_id)
);
CREATE INDEX IF NOT EXISTS ereignisse_zeit ON ereignisse(zeit DESC,id DESC);
CREATE INDEX IF NOT EXISTS ereignisse_typ_zeit ON ereignisse(typ,zeit DESC);
`);

// Getrennter, dauerhaft wiederholbarer Mail-Ausgang. Die bestehende email_ausgang-
// Tabelle ist strikt auf eine Bestätigungsmail pro Benutzer begrenzt und bleibt unverändert.
db.exec(`
CREATE TABLE IF NOT EXISTS meldung_ausgang (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 ereignis_id INTEGER NOT NULL UNIQUE REFERENCES ereignisse(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','gesendet','fehler')),
 versuche INTEGER NOT NULL DEFAULT 0 CHECK(versuche BETWEEN 0 AND 5),
 geaendert INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS meldung_ausgang_offen ON meldung_ausgang(status,versuche,id);
`);

// WP1 Sicherheitsblock: Einstellungsspeicher fuer instanz_zustand (jetzt) und spaetere verschluesselte Werte (WP2).
// Das Schema steht schon in der Form, die WP2 braucht; so muss WP2 die Spalten nicht nachtraeglich ergaenzen.
// Werte sind standardmaessig im Klartext (verschluesselt=0); WP2 setzt verschluesselt=1 mit iv und tag.
db.exec(`
CREATE TABLE IF NOT EXISTS einstellungen (
 schluessel       TEXT PRIMARY KEY,
 wert             TEXT,
 verschluesselt   INTEGER NOT NULL DEFAULT 0 CHECK(verschluesselt IN (0,1)),
 iv               TEXT,
 tag              TEXT,
 aktualisiert_am  TEXT NOT NULL
);
`);

// WP3 Sicherheitsblock: Einrichtungscode (einmalig, nur Hash, 24 h). id=1 erzwingt genau EINE gueltige Zeile ueber alle Prozesse
// (INSERT OR IGNORE sichert C11: zwei gleichzeitig startende Prozesse erzeugen nie zwei gueltige Codes).
db.exec(`
CREATE TABLE IF NOT EXISTS einrichtungs_token (
 id               INTEGER PRIMARY KEY CHECK (id = 1),
 code_hash        TEXT NOT NULL,
 salz             TEXT NOT NULL,
 erzeugt_am       INTEGER NOT NULL,
 laeuft_ab        INTEGER NOT NULL
);
`);

// Scheibe 20: Die Typ-Prüfung der Ereignisse kannte abo_gekuendigt und geloescht nicht; INSERT OR IGNORE hat solche Ereignisse
// still verworfen. SQLite kann CHECK nicht ändern, deshalb Tabelle neu aufbauen (Daten, IDs und Verweise bleiben erhalten).
{
  const schema=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ereignisse'").get()?.sql;
  if(schema&&!schema.includes("'abo_gekuendigt'")){
    if(!schema.includes("'abo_beendet')"))throw new Error('Schema für ereignisse ist unbekannt');
    const spalten=db.prepare('PRAGMA table_info(ereignisse)').all().map(x=>x.name).join(',');
    const neuSchema=schema.replace('CREATE TABLE IF NOT EXISTS ereignisse','CREATE TABLE ereignisse_neu').replace('CREATE TABLE ereignisse (','CREATE TABLE ereignisse_neu (')
      .replace("'abo_beendet')","'abo_beendet','abo_gekuendigt','geloescht')");
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      db.exec(neuSchema);
      db.exec('INSERT INTO ereignisse_neu ('+spalten+') SELECT '+spalten+' FROM ereignisse');
      db.exec('DROP TABLE ereignisse');
      db.exec('ALTER TABLE ereignisse_neu RENAME TO ereignisse');
      db.exec('CREATE INDEX IF NOT EXISTS ereignisse_zeit ON ereignisse(zeit DESC,id DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS ereignisse_typ_zeit ON ereignisse(typ,zeit DESC)');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    finally { db.exec('PRAGMA foreign_keys = ON'); }
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Fremdschlüsselprüfung nach Migration fehlgeschlagen');
  }
}

// ---- Schulungsplattform, Scheibe 1: Kurse, Lektionen, Dateien (nur Metadaten), Zugänge -------------
// Alles mit IF NOT EXISTS: bestehende Daten bleiben unberührt.
db.exec(`
  -- preis_cent: kleinste Einheit wie bei Stripe, immer eine ganze Zahl. Der Server bestimmt den Preis, nie der Client.
  CREATE TABLE IF NOT EXISTS kurse (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    titel        TEXT NOT NULL,
    beschreibung TEXT NOT NULL DEFAULT '',
    preis_cent   INTEGER NOT NULL CHECK (preis_cent >= 0),
    waehrung     TEXT NOT NULL DEFAULT 'huf' CHECK (waehrung IN ('huf', 'eur')),
    status       TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf', 'veroeffentlicht')),
    erstellt     TEXT NOT NULL,
    geaendert    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lektionen (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    kurs_id      INTEGER NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
    abschnitt    TEXT NOT NULL DEFAULT '',
    titel        TEXT NOT NULL,
    art          TEXT NOT NULL DEFAULT 'text' CHECK (art IN ('text', 'video', 'pdf', 'audio', 'datei')),
    inhalt       TEXT NOT NULL DEFAULT '',     -- Text der Lektion; nur mit Zugang sichtbar
    reihenfolge  INTEGER NOT NULL DEFAULT 0 CHECK (reihenfolge >= 0),
    status       TEXT NOT NULL DEFAULT 'veroeffentlicht' CHECK (status IN ('entwurf', 'veroeffentlicht')),
    erstellt     TEXT NOT NULL,
    geaendert    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS lektionen_kurs ON lektionen (kurs_id, reihenfolge);

  -- Nur Metadaten. Der Upload selbst kommt in einer späteren Scheibe.
  CREATE TABLE IF NOT EXISTS dateien (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lektion_id  INTEGER NOT NULL REFERENCES lektionen(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    art         TEXT NOT NULL CHECK (art IN ('video', 'pdf', 'audio', 'datei')),
    pfad        TEXT NOT NULL,                 -- interner Ablageort, wird nie nach außen gegeben
    groesse     INTEGER NOT NULL DEFAULT 0 CHECK (groesse >= 0),
    erstellt    TEXT NOT NULL
  );

  -- Wer darf welchen Kurs? UNIQUE: derselbe Zugang kann nie doppelt entstehen.
  CREATE TABLE IF NOT EXISTS zugaenge (
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    kurs_id     INTEGER NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
    quelle      TEXT NOT NULL CHECK (quelle IN ('zahlung', 'einladung')),
    erstellt    TEXT NOT NULL,
    UNIQUE (benutzer_id, kurs_id)
  );
`);

// Spalte "rolle" nur ergänzen, wenn sie fehlt (alte Datenbanken bleiben heil; alle bisherigen Benutzer sind "kunde").
if (!db.prepare('PRAGMA table_info(benutzer)').all().some((s) => s.name === 'rolle')) {
  db.exec(`ALTER TABLE benutzer ADD COLUMN rolle TEXT NOT NULL DEFAULT 'kunde' CHECK (rolle IN ('kunde', 'admin'))`);
}

// P12 (F-49): Sitzungs-Lebenszyklus (Idle- und Absolut-Timeout, Step-up-Auth).
{
  const sp = db.prepare('PRAGMA table_info(sitzungen)').all().map(x => x.name);
  if (!sp.includes('erstellt')) db.exec('ALTER TABLE sitzungen ADD COLUMN erstellt INTEGER');
  if (!sp.includes('zuletzt_aktiv')) db.exec('ALTER TABLE sitzungen ADD COLUMN zuletzt_aktiv INTEGER');
}
db.exec(`CREATE TABLE IF NOT EXISTS stepup_sitzungen (
  sitzung_hash TEXT PRIMARY KEY,
  laeuft_ab    INTEGER NOT NULL
);`);
db.prepare('DELETE FROM stepup_sitzungen WHERE laeuft_ab <= ?').run(Date.now());

// ---- Schulungsplattform, Scheibe 5: Dateien ----------------------------------------------------------------
// "pfad" ist der zufällige Dateiname im DATEI_ORDNER (nie ein Pfad, nie der Originalname). "mime" ist der geprüfte Dateityp, der beim
// Ausliefern als Content-Type gesendet wird (er wird nie aus dem Dateinamen erraten). Höchstens eine Datei je Lektion.
if (!db.prepare('PRAGMA table_info(dateien)').all().some((sp) => sp.name === 'mime')) {
  db.exec("ALTER TABLE dateien ADD COLUMN mime TEXT NOT NULL DEFAULT 'application/octet-stream'");
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS dateien_je_lektion ON dateien (lektion_id)');

// Bunny Stream (docs/BUNNY-STREAM-PLAN.md, Schritt 2): "quelle" sagt, wo die Datei liegt. Alle bisherigen Dateien sind "lokal" (Render-Festplatte, Verhalten
// unveraendert). Bei "bunny" liegt das Video bei Bunny Stream und "bunny_video_id" ist seine ID; "pfad" bleibt dann ein fester Platzhalter ohne Datei.
// Spalten werden nur ergaenzt, wenn sie fehlen (alte Datenbanken bleiben heil).
{
  const spalten = db.prepare('PRAGMA table_info(dateien)').all().map((sp) => sp.name);
  if (!spalten.includes('quelle')) db.exec("ALTER TABLE dateien ADD COLUMN quelle TEXT NOT NULL DEFAULT 'lokal' CHECK (quelle IN ('lokal', 'bunny'))");
  if (!spalten.includes('bunny_video_id')) db.exec('ALTER TABLE dateien ADD COLUMN bunny_video_id TEXT');
  if (!spalten.includes('bunny_status')) db.exec('ALTER TABLE dateien ADD COLUMN bunny_status TEXT');
}
// Schritt 4: Auftragsbuch fuer das Loeschen bei Bunny. Wird in DERSELBEN Transaktion gefuellt wie das Loeschen der Datenbankzeile; danach versucht der Server
// das Loeschen bei Bunny und entfernt den Auftrag nur bei Erfolg. So bleibt nie ein Video bei Bunny liegen (und kostet weiter), auch wenn Bunny kurz nicht erreichbar ist.
db.exec(`
  CREATE TABLE IF NOT EXISTS bunny_loeschauftraege (
    video_id       TEXT PRIMARY KEY,
    erstellt       TEXT NOT NULL,
    versuche       INTEGER NOT NULL DEFAULT 0,
    letzter_fehler TEXT
  );
  -- Ein bei Bunny angelegtes, aber noch nicht fertig hochgeladenes Video. Die bisherige Datei der Lektion bleibt, bis Bunny "fertig" meldet.
  -- uebernommen = 1 heisst: das Video ist in dateien uebernommen worden (dann darf es NICHT geloescht werden).
  CREATE TABLE IF NOT EXISTS bunny_ausstehend (
    lektion_id  INTEGER PRIMARY KEY REFERENCES lektionen(id) ON DELETE CASCADE,
    video_id    TEXT NOT NULL,
    erstellt    TEXT NOT NULL,
    uebernommen INTEGER NOT NULL DEFAULT 0
  );
  -- WICHTIG fuer kuenftigen Code: Zeilen in dateien/bunny_ausstehend nur mit DELETE entfernen und neu einfuegen, NIE mit INSERT OR REPLACE (das umgeht die Trigger,
  -- weil recursive_triggers aus ist) und nie mit PRAGMA ignore_check_constraints o. ae.
  -- Sicherheitsnetz: verschwindet eine Bunny-Zeile oder ein nicht uebernommenes ausstehendes Video AUF IRGENDEINEM Weg (auch durch Kaskaden beim Loeschen
  -- von Lektion oder Kurs), wird automatisch ein Loesch-Auftrag eingetragen. So kann kein Weg ein Video bei Bunny vergessen.
  CREATE TRIGGER IF NOT EXISTS bunny_datei_geloescht AFTER DELETE ON dateien
    WHEN OLD.quelle = 'bunny' AND OLD.bunny_video_id IS NOT NULL
    BEGIN INSERT OR IGNORE INTO bunny_loeschauftraege (video_id, erstellt) VALUES (OLD.bunny_video_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')); END;
  CREATE TRIGGER IF NOT EXISTS bunny_ausstehend_geloescht AFTER DELETE ON bunny_ausstehend
    WHEN OLD.uebernommen = 0
    BEGIN INSERT OR IGNORE INTO bunny_loeschauftraege (video_id, erstellt) VALUES (OLD.video_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')); END;
`);

// Scheibe 31: Kurspaket-Import, nur anhängbares Kurzprotokoll ohne Paketinhalt.
db.exec(`
 CREATE TABLE IF NOT EXISTS kurspaket_protokoll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zeit TEXT NOT NULL,
  benutzer_id INTEGER NOT NULL,
  paket_hash TEXT NOT NULL CHECK(length(paket_hash)=64),
  titel TEXT NOT NULL CHECK(length(titel)<=80),
  anzahl_lektionen INTEGER NOT NULL DEFAULT 0,
  ergebnis TEXT NOT NULL CHECK(ergebnis IN ('ok','abgelehnt','fehler')),
  kurs_id INTEGER,
  kurze_meldung TEXT NOT NULL DEFAULT ''
 );
 CREATE INDEX IF NOT EXISTS kurspaket_protokoll_hash ON kurspaket_protokoll(benutzer_id,paket_hash,zeit);
 CREATE TRIGGER IF NOT EXISTS kurspaket_protokoll_update BEFORE UPDATE ON kurspaket_protokoll
 BEGIN SELECT RAISE(ABORT,'append only'); END;
 CREATE TRIGGER IF NOT EXISTS kurspaket_protokoll_delete BEFORE DELETE ON kurspaket_protokoll
 BEGIN SELECT RAISE(ABORT,'append only'); END;
`);

// ---- Schulungsplattform, Scheibe 4: Bestellungen ----------------------------------------------------------------
// Die Bestellungen der alten Lern-App hatten dieselbe Tabellenbezeichnung mit anderen Spalten (schluessel, art, ...).
// Sie werden NICHT gelöscht, sondern umbenannt (bestellungen_lern_app_alt); danach entsteht die neue Tabelle.
{
  const spalten = db.prepare('PRAGMA table_info(bestellungen)').all().map((s) => s.name);
  if (spalten.includes('schluessel') && !spalten.includes('stripe_sitzung')) db.exec('ALTER TABLE bestellungen RENAME TO bestellungen_lern_app_alt');
}
db.exec(`
  -- Eine Zeile je bezahlter Checkout-Sitzung. status: "bezahlt" (passt zum Kurspreis, Zugang vergeben), "pruefen" (bezahlt, aber passt
  -- nicht: KEIN Zugang, Gabriella soll prüfen) oder "erstattet". benutzer_id und kurs_id sind leer, wenn es sie nicht (mehr) gibt.
  CREATE TABLE IF NOT EXISTS bestellungen (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    stripe_sitzung TEXT NOT NULL UNIQUE,       -- cs_...: dieselbe Zahlung kann nie zweimal eingetragen werden
    zahlung_id     TEXT,                       -- pi_...: damit eine Erstattung (charge.refunded) die Bestellung findet
    benutzer_id    INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    kurs_id        INTEGER REFERENCES kurse(id) ON DELETE SET NULL,
    betrag         INTEGER NOT NULL CHECK (betrag >= 0),   -- was tatsächlich bezahlt wurde (kleinste Einheit)
    waehrung       TEXT NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('bezahlt', 'pruefen', 'erstattet')),
    grund          TEXT,                       -- Code: Warum "pruefen" oder "erstattet" (Text steht in texte/hu.json)
    erstellt       TEXT NOT NULL,
    geaendert      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bestellungen_zahlung ON bestellungen (zahlung_id);
  CREATE INDEX IF NOT EXISTS bestellungen_status ON bestellungen (status, id);
`);
// Sprache je Konto und je Bestellung (en/de/hu), nachtraeglich ergaenzt; alte Zeilen bleiben NULL (= Standardsprache).
for (const [tabelle, spalte] of [['benutzer', 'sprache'], ['bestellungen', 'sprache']]) {
  const sp = db.prepare('PRAGMA table_info(' + tabelle + ')').all().map((x) => x.name);
  if (!sp.includes(spalte)) db.exec('ALTER TABLE ' + tabelle + ' ADD COLUMN ' + spalte + " TEXT CHECK (" + spalte + " IS NULL OR " + spalte + " IN ('en','de','hu'))");
}


// Scheibe 6: SQLite-CHECK-Listen ohne Datenverlust erweitern. Fremdschlüssel werden
// nur während des Tabellen-Neuaufbaus abgeschaltet; danach auf Konsistenz prüfen.
function statusMigration(tabelle, alterStatus, neuerStatus) {
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabelle)?.sql;
  if (!schema) return;
  const spalten = db.prepare('PRAGMA table_info(' + tabelle + ')').all().map(x => x.name);
  const alt = "'"+alterStatus.join("', '")+"'";
  const neu = "'"+neuerStatus.join("', '")+"'";
  if (schema.includes(neu)) return;
  if (!schema.includes(alt)) throw new Error('Schema für ' + tabelle + ' ist unbekannt');
  // Nach einem früheren Neuaufbau schreibt SQLite den Namen in Anführungszeichen ("kurse"); beide Schreibweisen erkennen.
  const kopf = new RegExp('^CREATE TABLE (?:IF NOT EXISTS )?"?' + tabelle + '"?\\s*\\(');
  if (!kopf.test(schema)) throw new Error('Schema für ' + tabelle + ' ist unbekannt');
  const neuSchema = schema.replace(kopf, 'CREATE TABLE ' + tabelle + '_neu (').replace(alt, neu);
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(neuSchema);
    db.exec('INSERT INTO ' + tabelle + '_neu (' + spalten.join(',') + ') SELECT ' + spalten.join(',') + ' FROM ' + tabelle);
    db.exec('DROP TABLE ' + tabelle);
    db.exec('ALTER TABLE ' + tabelle + '_neu RENAME TO ' + tabelle);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { db.exec('PRAGMA foreign_keys = ON'); }
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Fremdschlüsselprüfung nach Migration fehlgeschlagen');
}
statusMigration('kurse', ['entwurf', 'veroeffentlicht'], ['entwurf', 'veroeffentlicht', 'archiviert']);
statusMigration('kurse', ['entwurf', 'veroeffentlicht', 'archiviert'], ['entwurf', 'veroeffentlicht', 'archiviert', 'freigabe_offen']);
statusMigration('bestellungen', ['bezahlt', 'pruefen', 'erstattet'], ['bezahlt', 'pruefen', 'erstattet', 'abgelehnt']);
db.exec('CREATE INDEX IF NOT EXISTS bestellungen_zahlung ON bestellungen (zahlung_id)');
db.exec('CREATE INDEX IF NOT EXISTS bestellungen_status ON bestellungen (status, id)');
db.exec(`
CREATE TABLE IF NOT EXISTS verwaltung_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 admin_id INTEGER NOT NULL REFERENCES benutzer(id),
 aktion TEXT NOT NULL,
 kurs_id INTEGER,
 benutzer_id INTEGER,
 bestellung_id INTEGER,
 erstellt TEXT NOT NULL
);
`);

// Scheibe 8: bestehende Tabellen behalten alle Daten; Migration wiederholbar.
// CHECK der Quelle benötigt einen SQLite-Tabellenumbau (Spalte allein reicht nicht).
if (!db.prepare('PRAGMA table_info(kurse)').all().some(s => s.name === 'abo_preis_cent'))
  db.exec('ALTER TABLE kurse ADD COLUMN abo_preis_cent INTEGER CHECK (abo_preis_cent IS NULL OR (abo_preis_cent >= 0 AND abo_preis_cent <= 1000000000))');
if (!db.prepare('PRAGMA table_info(kurse)').all().some(s => s.name === 'abo_intervall'))
  db.exec("ALTER TABLE kurse ADD COLUMN abo_intervall TEXT CHECK (abo_intervall IS NULL OR abo_intervall IN ('month','year'))");
if (!db.prepare('PRAGMA table_info(bestellungen)').all().some(s => s.name === 'art'))
  db.exec("ALTER TABLE bestellungen ADD COLUMN art TEXT NOT NULL DEFAULT 'einmal' CHECK (art IN ('einmal','abo'))");
// Jede Abo-Rechnung kennt ihr Stripe-Abo (sub_...): Ablehnen/Erstatten einer Prüf-Rechnung beendet nur DIESES Abo, nie ein später abgeschlossenes neues.
if (!db.prepare('PRAGMA table_info(bestellungen)').all().some(s => s.name === 'stripe_abo'))
  db.exec('ALTER TABLE bestellungen ADD COLUMN stripe_abo TEXT');
// F-92: bisher von Stripe bestaetigter, kumulativer Erstattungsbetrag (kleinste Einheit). Die Kennzahl "Umsatz" zieht ihn ab (Teilerstattungen).
if (!db.prepare('PRAGMA table_info(bestellungen)').all().some(s => s.name === 'erstattet_betrag'))
  db.exec('ALTER TABLE bestellungen ADD COLUMN erstattet_betrag INTEGER NOT NULL DEFAULT 0 CHECK (erstattet_betrag >= 0)');
if (!db.prepare('PRAGMA table_info(zugaenge)').all().some(s => s.name === 'gueltig_bis')) {
  db.exec('ALTER TABLE zugaenge ADD COLUMN gueltig_bis INTEGER');
}
{
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='zugaenge'").get().sql;
  if (!schema.includes("'abo'")) {
    db.exec('PRAGMA foreign_keys=OFF');
    try {
      db.exec('BEGIN');
      db.exec("CREATE TABLE zugaenge_neu (benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE, kurs_id INTEGER NOT NULL REFERENCES kurse(id) ON DELETE CASCADE, quelle TEXT NOT NULL CHECK (quelle IN ('zahlung','einladung','abo')), erstellt TEXT NOT NULL, gueltig_bis INTEGER, UNIQUE (benutzer_id,kurs_id))");
      db.exec('INSERT INTO zugaenge_neu (benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) SELECT benutzer_id,kurs_id,quelle,erstellt,gueltig_bis FROM zugaenge');
      db.exec('DROP TABLE zugaenge');
      db.exec('ALTER TABLE zugaenge_neu RENAME TO zugaenge');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    finally { db.exec('PRAGMA foreign_keys=ON'); }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Zugangsmigration: Fremdschlüssel fehlerhaft');
  }
}
db.exec(`
CREATE TABLE IF NOT EXISTS abos (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 stripe_abo TEXT NOT NULL UNIQUE,
 stripe_sitzung TEXT UNIQUE,
 benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
 kurs_id INTEGER NOT NULL REFERENCES kurse(id),
 status TEXT NOT NULL DEFAULT 'zahlung_offen' CHECK(status IN ('aktiv','zahlung_offen','gekuendigt','beendet')),
 gueltig_bis INTEGER,
 endet_zum_periodenende INTEGER NOT NULL DEFAULT 0 CHECK (endet_zum_periodenende IN (0,1)),
 letzte_ereignis_zeit INTEGER NOT NULL DEFAULT 0,
 erstellt TEXT NOT NULL,
 geaendert TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS abos_benutzer_kurs ON abos(benutzer_id,kurs_id);
`);
// Keine Abo-Kursdaten verlieren; Paar muss entweder vollständig gesetzt oder leer sein.
// Neue/aktualisierte Kurse prüfen diese Bedingung in routes-kurse.mjs.

// Scheibe 11: Passwort-Rücksetzung und transaktionaler Mail-Ausgang.
// Token ausschließlich als SHA-256 gespeichert; keine Klartext-Spalte.
db.exec(`
CREATE TABLE IF NOT EXISTS passwort_token (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE,
 erstellt INTEGER NOT NULL,
 laeuft_ab INTEGER NOT NULL,
 benutzt INTEGER
);
CREATE INDEX IF NOT EXISTS passwort_token_benutzer ON passwort_token(benutzer_id, laeuft_ab);
CREATE TABLE IF NOT EXISTS mail_ausgang (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 typ TEXT NOT NULL CHECK (typ IN ('kauf','abo')),
 benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
 bestellung_id INTEGER NOT NULL REFERENCES bestellungen(id),
 status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','gesendet','fehler')),
 versuche INTEGER NOT NULL DEFAULT 0 CHECK (versuche BETWEEN 0 AND 5),
 erstellt INTEGER NOT NULL,
 geaendert INTEGER NOT NULL,
 UNIQUE(typ,bestellung_id)
);
CREATE INDEX IF NOT EXISTS mail_ausgang_offen ON mail_ausgang(status,versuche,id);
`);

// Scheibe 13: idempotente Vorschau-Felder, niemals vorhandene Kursdaten verwerfen.
for (const [spalte,typ] of [
  ['titelbild_datei','TEXT'],['titelbild_typ','TEXT'],
  ['trailer_datei','TEXT'],['trailer_typ','TEXT'],
  ['nutzen',"TEXT NOT NULL DEFAULT ''"],
]) {
  if (!db.prepare('PRAGMA table_info(kurse)').all().some(x=>x.name === spalte))
    db.exec('ALTER TABLE kurse ADD COLUMN ' + spalte + ' ' + typ);
}

// Scheibe 14: Bestandskonten bleiben bestätigt; Migration läuft nur beim ersten Mal.
if (!db.prepare('PRAGMA table_info(benutzer)').all().some(x => x.name === 'email_bestaetigt')) {
  db.exec('ALTER TABLE benutzer ADD COLUMN email_bestaetigt INTEGER');
  db.prepare('UPDATE benutzer SET email_bestaetigt=? WHERE email_bestaetigt IS NULL').run(Date.now());
}
db.exec(`
CREATE TABLE IF NOT EXISTS email_token (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE,
 erstellt INTEGER NOT NULL,
 laeuft_ab INTEGER NOT NULL,
 benutzt INTEGER
);
CREATE INDEX IF NOT EXISTS email_token_benutzer ON email_token(benutzer_id,laeuft_ab);
CREATE TABLE IF NOT EXISTS email_ausgang (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 benutzer_id INTEGER NOT NULL UNIQUE REFERENCES benutzer(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','gesendet','fehler')),
 versuche INTEGER NOT NULL DEFAULT 0 CHECK (versuche BETWEEN 0 AND 5),
 erstellt INTEGER NOT NULL,
 geaendert INTEGER NOT NULL,
 generation INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS email_ausgang_offen ON email_ausgang(status,versuche,id);
`);
if (!db.prepare('PRAGMA table_info(email_ausgang)').all().some(x=>x.name==='generation'))
  db.exec('ALTER TABLE email_ausgang ADD COLUMN generation INTEGER NOT NULL DEFAULT 0');

// Scheibe 16: Kein Stripe-Bestelldatensatz fuer Gratis-Freischaltung vorhanden.
// Separate, idempotente Mailausgangsliste statt erfundener Stripe-ID.
db.exec(`
CREATE TABLE IF NOT EXISTS gratis_mail_ausgang (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
 kurs_id INTEGER NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','gesendet','fehler')),
 versuche INTEGER NOT NULL DEFAULT 0 CHECK(versuche BETWEEN 0 AND 5),
 erstellt INTEGER NOT NULL,
 geaendert INTEGER NOT NULL,
 UNIQUE(benutzer_id,kurs_id)
);
CREATE INDEX IF NOT EXISTS gratis_mail_offen ON gratis_mail_ausgang(status,versuche,id);
`);

// Scheibe 18: Nur additive, idempotente Kontofelder; bestehende Buchungen bleiben bestehen.
for (const [name,typ] of Object.entries({
  anzeigename:'TEXT', rechnung_name:'TEXT', rechnung_land:'TEXT',
  rechnung_plz:'TEXT', rechnung_ort:'TEXT', rechnung_strasse:'TEXT',
  rechnung_steuernr:'TEXT', geloescht:'INTEGER',
  einwilligung_zeit:'TEXT', einwilligung_version:'TEXT'
})) {
  if (!db.prepare('PRAGMA table_info(benutzer)').all().some(s=>s.name===name))
    db.exec('ALTER TABLE benutzer ADD COLUMN '+name+' '+typ);
}
db.exec(`
CREATE TABLE IF NOT EXISTS email_aender_token (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
 neue_email TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 erstellt INTEGER NOT NULL,
 laeuft_ab INTEGER NOT NULL,
 benutzt INTEGER
);
CREATE INDEX IF NOT EXISTS email_aender_token_benutzer ON email_aender_token(benutzer_id,laeuft_ab);
CREATE TABLE IF NOT EXISTS konto_email_historie (
 benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
 email TEXT NOT NULL,
 bis INTEGER NOT NULL,
 PRIMARY KEY(benutzer_id,email)
);
CREATE TABLE IF NOT EXISTS konto_mail_ausgang (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 benutzer_id INTEGER NOT NULL,
 empfaenger TEXT,
 typ TEXT NOT NULL CHECK(typ IN ('konto_geloescht')),
 versuche INTEGER NOT NULL DEFAULT 0,
 erstellt INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','gesendet','fehler'))
);
`);

// Scheibe 20: Kündigungsbelege – pro Abo-Kündigung nur ein transaktionaler Mailauftrag.
db.exec(`
CREATE TABLE IF NOT EXISTS abo_kuendigung_mail (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 abo_id INTEGER NOT NULL REFERENCES abos(id),
 benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
 kurs_id INTEGER NOT NULL REFERENCES kurse(id),
 erfasst INTEGER NOT NULL,
 ende INTEGER,
 status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','gesendet','fehler')),
 versuche INTEGER NOT NULL DEFAULT 0 CHECK(versuche BETWEEN 0 AND 5),
 UNIQUE(abo_id,erfasst)
);
CREATE INDEX IF NOT EXISTS abo_kuendigung_mail_offen ON abo_kuendigung_mail(status,versuche,id);
`);


// Scheibe 21 – additive Tabellen, bestehende Bestellung und Zugänge bleiben erhalten.
db.exec(`
CREATE TABLE IF NOT EXISTS kauf_zustimmung (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
 kurs_id INTEGER NOT NULL REFERENCES kurse(id),
 text_version TEXT NOT NULL,
 zeit TEXT NOT NULL,
 stripe_sitzung TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS erster_zugriff (
 benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
 kurs_id INTEGER NOT NULL REFERENCES kurse(id),
 erster_zugriff TEXT NOT NULL,
 PRIMARY KEY(benutzer_id,kurs_id)
);
CREATE TABLE IF NOT EXISTS ellallas (
 bestellung_id INTEGER PRIMARY KEY REFERENCES bestellungen(id),
 zeit TEXT NOT NULL,
 ergebnis TEXT NOT NULL CHECK(ergebnis IN ('bearbeitung','erstattung','abgelehnt_frist','abgelehnt_zustimmung','fehler')),
 hinweis TEXT,
 aktualisiert TEXT NOT NULL
);
-- Rate-Limit je KONTO (nicht je IP), ueberlebt Neustarts: jeder neue Widerrufsversuch wird gezaehlt.
CREATE TABLE IF NOT EXISTS ellallas_versuch (benutzer_id INTEGER NOT NULL, zeit INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ellallas_versuch_benutzer ON ellallas_versuch(benutzer_id,zeit);
CREATE TABLE IF NOT EXISTS ellallas_mail (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 bestellung_id INTEGER NOT NULL REFERENCES bestellungen(id),
 empfaenger TEXT NOT NULL CHECK(empfaenger IN ('kunde','inhaber','warnung')),
 status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','gesendet','fehler')),
 versuche INTEGER NOT NULL DEFAULT 0 CHECK(versuche BETWEEN 0 AND 5),
 UNIQUE(bestellung_id,empfaenger)
);
`);
// F-93: tatsaechlich durch den Widerruf erstatteter Betrag (kleinste Einheit); NULL = unbekannt (alte Zeilen, schon vorher voll erstattet).
if (!db.prepare('PRAGMA table_info(ellallas)').all().some(s => s.name === 'erstattet_betrag'))
  db.exec('ALTER TABLE ellallas ADD COLUMN erstattet_betrag INTEGER CHECK (erstattet_betrag IS NULL OR erstattet_betrag >= 0)');
// Backlog a (12.11.2026): administrative Erledigung eines Widerrufs, dessen Erstattung bei Stripe fehlgeschlagen ist. EIGENE Tabelle: die Zeile in ellallas
// (ergebnis = Stripe-Erstattungsstatus) bleibt unveraendert, die Erledigung ist KEINE Erstattung. Eine Erledigung je Widerruf (Primaerschluessel). Idempotent.
db.exec(`
CREATE TABLE IF NOT EXISTS ellallas_erledigt (
 bestellung_id INTEGER PRIMARY KEY REFERENCES ellallas(bestellung_id),
 zeit TEXT NOT NULL,
 admin_id INTEGER NOT NULL REFERENCES benutzer(id),
 begruendung TEXT NOT NULL CHECK(length(trim(begruendung)) BETWEEN 5 AND 500)
);
`);
// Backlog c (12.11.2026): Pflicht-Fallreferenz (Ticketnummer/Stripe-Referenz, 3..100 Zeichen) und Pflicht-Bestaetigung "Erstattungsstatus in Stripe geprueft".
// Idempotent (Spalte nur anlegen, wenn sie fehlt). Erledigungen von vor dieser Aenderung behalten NULL (ehrlich: damals nicht erfasst).
{
  const sp = db.prepare('PRAGMA table_info(ellallas_erledigt)').all().map((x) => x.name);
  if (!sp.includes('fallreferenz')) db.exec('ALTER TABLE ellallas_erledigt ADD COLUMN fallreferenz TEXT CHECK(fallreferenz IS NULL OR length(trim(fallreferenz)) BETWEEN 3 AND 100)');
  if (!sp.includes('stripe_geprueft')) db.exec('ALTER TABLE ellallas_erledigt ADD COLUMN stripe_geprueft INTEGER CHECK(stripe_geprueft IS NULL OR stripe_geprueft = 1)');
}
// Refund-Failed (12.11.2026): Stripe meldet eine Erstattung nachtraeglich als fehlgeschlagen/abgebrochen (refund.failed, refund.updated, charge.refund.updated).
// Eine Zeile je Stripe-Erstattung (Primaerschluessel refund_id, idempotent). Offen = status 'fehlgeschlagen'/'abgebrochen': dann zeigt das Kundenkonto nie "Erstattet",
// und der Fall steht in den offenen Pruefungen des Admins. Geloest (status 'erfolgreich' = spaeteres Stripe-Ereignis "succeeded" fuer DIESELBE Erstattung,
// 'ersetzt' = eine neue erfolgreiche Erstattung mindestens in dieser Hoehe). ereignis_zeit = Stripe-Ereigniszeit (created, Sekunden): Stripe garantiert keine
// Reihenfolge, nur ein NEUERES Ereignis darf den Zustand aendern (bei Gleichstand gewinnt der Fehler). Keine Personendaten (nur Bestellnummer).
db.exec(`
CREATE TABLE IF NOT EXISTS erstattung_fehler (
 refund_id TEXT PRIMARY KEY CHECK(length(refund_id) BETWEEN 4 AND 200),
 bestellung_id INTEGER NOT NULL REFERENCES bestellungen(id),
 zeit TEXT NOT NULL,
 ereignis_zeit INTEGER NOT NULL,
 betrag INTEGER,
 waehrung TEXT,
 status TEXT NOT NULL CHECK(status IN ('fehlgeschlagen','abgebrochen','erfolgreich','ersetzt')),
 geloest TEXT
);
CREATE INDEX IF NOT EXISTS erstattung_fehler_bestellung ON erstattung_fehler(bestellung_id, status);
`);


// Scheibe 24: Agentenschlüssel, gesonderte Freigaben und Auditprotokoll.
db.exec(`
CREATE TABLE IF NOT EXISTS agent_schluessel(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL, schluessel_hash TEXT NOT NULL UNIQUE,
 vorschau TEXT NOT NULL, erstellt TEXT NOT NULL,
 zuletzt_benutzt TEXT, widerrufen_am TEXT, laeuft_ab TEXT
);
CREATE TABLE IF NOT EXISTS agent_antraege(
 id INTEGER PRIMARY KEY AUTOINCREMENT, kurs_id INTEGER NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
 schluessel_id INTEGER REFERENCES agent_schluessel(id),
 art TEXT NOT NULL CHECK(art IN ('veroeffentlichen','aendern')),
 feld TEXT, vorher TEXT, nachher TEXT,
 status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','freigegeben','abgelehnt')),
 erstellt TEXT NOT NULL, entschieden TEXT
);
CREATE INDEX IF NOT EXISTS agent_antraege_status ON agent_antraege(status,id);
CREATE TABLE IF NOT EXISTS agent_protokoll(
 id INTEGER PRIMARY KEY AUTOINCREMENT, zeit TEXT NOT NULL,
 schluessel_id INTEGER REFERENCES agent_schluessel(id),
 aktion TEXT NOT NULL, ziel TEXT, ergebnis TEXT NOT NULL,
 beschreibung TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_protokoll_zeit ON agent_protokoll(id DESC);
`);


 // Scheibe 25: append-only Audit, keine Erweiterung alter CHECK-Tabellen.
db.exec(`
CREATE TABLE IF NOT EXISTS sicherung_protokoll(
 id INTEGER PRIMARY KEY AUTOINCREMENT, zeit TEXT NOT NULL,
 art TEXT NOT NULL CHECK(art IN ('auto','manuell','vordeploy')),
 ergebnis TEXT NOT NULL CHECK(ergebnis IN ('ok','fehler')),
 dateiname TEXT, groesse_klartext INTEGER, groesse_enc INTEGER,
 sha256_klar TEXT, sha256_enc TEXT, tabellen_zeilen TEXT,
 ziel_lokal TEXT NOT NULL CHECK(ziel_lokal IN ('ok','fehler')),
 ziel_extern TEXT NOT NULL CHECK(ziel_extern IN ('ok','fehler','aus')),
 kurze_meldung TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS sicherung_protokoll_kein_update BEFORE UPDATE ON sicherung_protokoll
BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER IF NOT EXISTS sicherung_protokoll_kein_delete BEFORE DELETE ON sicherung_protokoll
BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TABLE IF NOT EXISTS sicherung_alarm(
 grund TEXT PRIMARY KEY, letzter_versand TEXT, aktiv INTEGER NOT NULL DEFAULT 0
);
`);


db.exec(`
CREATE TABLE IF NOT EXISTS abgleich_lauf (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 start TEXT NOT NULL, ende TEXT NOT NULL,
 modus TEXT NOT NULL CHECK(modus IN ('test','live')),
 fenster_tage INTEGER NOT NULL,
 geprueft_sitzungen INTEGER NOT NULL,
 geprueft_rechnungen INTEGER NOT NULL,
 geprueft_erstattungen INTEGER NOT NULL,
 geprueft_abos INTEGER NOT NULL,
 abweichungen_anzahl INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('ok','abweichung','fehler')),
 meldung TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS abgleich_abweichung (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 lauf_id INTEGER NOT NULL REFERENCES abgleich_lauf(id),
 art TEXT NOT NULL, stripe_id TEXT,
 bestell_id INTEGER, benutzer_id INTEGER,
 betrag INTEGER, waehrung TEXT, text TEXT NOT NULL, zeit TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS abgleich_abweichung_lauf ON abgleich_abweichung(lauf_id,id);
CREATE TRIGGER IF NOT EXISTS abgleich_lauf_update BEFORE UPDATE ON abgleich_lauf BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER IF NOT EXISTS abgleich_lauf_delete BEFORE DELETE ON abgleich_lauf BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER IF NOT EXISTS abgleich_abweichung_update BEFORE UPDATE ON abgleich_abweichung BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER IF NOT EXISTS abgleich_abweichung_delete BEFORE DELETE ON abgleich_abweichung BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TABLE IF NOT EXISTS abgleich_nachbuchung (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 zeit TEXT NOT NULL,
 abweichung_stripe_id TEXT NOT NULL,
 bestell_id INTEGER,
 ergebnis TEXT NOT NULL CHECK(ergebnis IN ('ok','fehler')),
 benutzer_id INTEGER
);
CREATE TRIGGER IF NOT EXISTS abgleich_nachbuchung_update BEFORE UPDATE ON abgleich_nachbuchung BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER IF NOT EXISTS abgleich_nachbuchung_delete BEFORE DELETE ON abgleich_nachbuchung BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TABLE IF NOT EXISTS abo_erstattung_mail (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 bestell_id INTEGER NOT NULL REFERENCES bestellungen(id),
 refund_id TEXT NOT NULL,
 betrag INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','gesendet','fehler')),
 versuche INTEGER NOT NULL DEFAULT 0,
 UNIQUE(bestell_id,refund_id)
);
CREATE TABLE IF NOT EXISTS abo_erstattung_eintrag (
 stripe_refund_id TEXT NOT NULL,
 bestell_id INTEGER NOT NULL REFERENCES bestellungen(id),
 zeit TEXT NOT NULL,
 PRIMARY KEY(stripe_refund_id,bestell_id)
);
CREATE TRIGGER IF NOT EXISTS abo_erstattung_eintrag_update BEFORE UPDATE ON abo_erstattung_eintrag BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER IF NOT EXISTS abo_erstattung_eintrag_delete BEFORE DELETE ON abo_erstattung_eintrag BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TABLE IF NOT EXISTS abgleich_alarm (
 id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT, aktiv INTEGER NOT NULL DEFAULT 0,
 letzte_mail TEXT
);
`);


db.exec(`
CREATE TABLE IF NOT EXISTS admin_login_protokoll (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 zeit TEXT NOT NULL,
 ergebnis TEXT NOT NULL CHECK(ergebnis IN ('ok','falsch','gesperrt','nicht_erlaubt','notfall','reset','listenwarnung')),
 email_maskiert TEXT NOT NULL,
 adresse_maskiert TEXT NOT NULL,
 hinweis TEXT NOT NULL DEFAULT ''
);
CREATE TRIGGER IF NOT EXISTS admin_login_kein_update BEFORE UPDATE ON admin_login_protokoll
BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER IF NOT EXISTS admin_login_kein_delete BEFORE DELETE ON admin_login_protokoll
BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE INDEX IF NOT EXISTS admin_login_zeit ON admin_login_protokoll(id DESC);
CREATE TABLE IF NOT EXISTS admin_login_sperre (
 kennung TEXT PRIMARY KEY, email_hash TEXT NOT NULL,
 anzahl INTEGER NOT NULL,
 erster INTEGER NOT NULL,
 bis INTEGER NOT NULL,
 stufe INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS admin_schutz (benutzer_id INTEGER PRIMARY KEY REFERENCES benutzer(id));
CREATE TRIGGER IF NOT EXISTS admin_letzter_schutz BEFORE UPDATE OF rolle,email,geloescht,email_bestaetigt ON benutzer
WHEN OLD.id IN (SELECT benutzer_id FROM admin_schutz)
 AND (NEW.rolle<>'admin' OR NEW.email<>OLD.email OR NEW.geloescht IS NOT NULL OR NEW.email_bestaetigt IS NULL)
 AND (SELECT COUNT(*) FROM admin_schutz s JOIN benutzer b ON b.id=s.benutzer_id WHERE b.rolle='admin' AND b.geloescht IS NULL AND b.email_bestaetigt IS NOT NULL)<=1
BEGIN SELECT RAISE(ABORT,'letzter admin'); END;
CREATE TRIGGER IF NOT EXISTS admin_letzter_delete BEFORE DELETE ON benutzer
WHEN OLD.id IN (SELECT benutzer_id FROM admin_schutz)
 AND (SELECT COUNT(*) FROM admin_schutz s JOIN benutzer b ON b.id=s.benutzer_id WHERE b.rolle='admin' AND b.geloescht IS NULL AND b.email_bestaetigt IS NOT NULL)<=1
BEGIN SELECT RAISE(ABORT,'letzter admin'); END;
CREATE TABLE IF NOT EXISTS admin_login_alarm (
 grund TEXT PRIMARY KEY, letzter_versand TEXT
);
`);


db.exec(`
CREATE TABLE IF NOT EXISTS verkauf_schalter (
 id INTEGER PRIMARY KEY CHECK(id=1),
 pausiert INTEGER NOT NULL CHECK(pausiert IN (0,1)),
 seit TEXT, grund TEXT, benutzer_id INTEGER
);
INSERT OR IGNORE INTO verkauf_schalter(id,pausiert,seit,grund,benutzer_id) VALUES(1,0,NULL,NULL,NULL);
CREATE TABLE IF NOT EXISTS verkauf_protokoll (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 zeit TEXT NOT NULL,
 aktion TEXT NOT NULL CHECK(aktion IN ('pausieren','fortsetzen','env_an','env_aus')),
 benutzer_id INTEGER, grund TEXT NOT NULL DEFAULT '',
 quelle TEXT NOT NULL CHECK(quelle IN ('admin','env')),
 CHECK(length(grund)<=200 AND grund NOT GLOB '*['||char(1)||'-'||char(31)||']*')
);
CREATE TRIGGER IF NOT EXISTS verkauf_protokoll_grund_pruefen BEFORE INSERT ON verkauf_protokoll
WHEN length(NEW.grund)>200 OR instr(NEW.grund,char(0))>0 OR instr(NEW.grund,char(127))>0
 OR NEW.grund GLOB '*['||char(1)||'-'||char(31)||']*'
 OR (NEW.aktion='pausieren' AND length(trim(NEW.grund))<1)
BEGIN SELECT RAISE(ABORT,'ungueltiger Grund'); END;
CREATE TRIGGER IF NOT EXISTS verkauf_protokoll_no_update BEFORE UPDATE ON verkauf_protokoll
 BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER IF NOT EXISTS verkauf_protokoll_no_delete BEFORE DELETE ON verkauf_protokoll
 BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE INDEX IF NOT EXISTS verkauf_protokoll_zeit ON verkauf_protokoll(id DESC);
`);

// Produktreife Block 4 (12.11.2026): Benachrichtigung an den Kunden, wenn der Admin einen (kostenlosen) Zugang erteilt.
// Eine Zeile je Erteilung (kein UNIQUE: nach Entzug und erneuter Erteilung kommt wieder eine Mail); Versand mit Backoff wie alle Mail-Warteschlangen.
db.exec(`
CREATE TABLE IF NOT EXISTS zugang_mail_ausgang (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
 kurs_id INTEGER NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','gesendet','fehler')),
 versuche INTEGER NOT NULL DEFAULT 0 CHECK(versuche BETWEEN 0 AND 5),
 erstellt INTEGER NOT NULL,
 geaendert INTEGER NOT NULL,
 naechster_versuch INTEGER
);
CREATE INDEX IF NOT EXISTS zugang_mail_offen ON zugang_mail_ausgang(status,versuche,id);
`);

// A8-02 (12.11.2026): Backoff fuer alle Mail-Warteschlangen. Nur additive Spalte; NULL = sofort faellig, alte Zeilen bleiben gueltig.
for (const tabelle of ['mail_ausgang', 'email_ausgang', 'gratis_mail_ausgang', 'konto_mail_ausgang', 'abo_kuendigung_mail', 'meldung_ausgang', 'ellallas_mail', 'abo_erstattung_mail', 'zugang_mail_ausgang']) {
  if (!db.prepare('PRAGMA table_info(' + tabelle + ')').all().some(s => s.name === 'naechster_versuch'))
    db.exec('ALTER TABLE ' + tabelle + ' ADD COLUMN naechster_versuch INTEGER');
}
// A8-04 (12.11.2026): In der Demo ueber der Obergrenze nicht gesendete Betreibermeldung (Status 'gesendet' = erledigt, unterdrueckt=1).
if (!db.prepare('PRAGMA table_info(meldung_ausgang)').all().some(s => s.name === 'unterdrueckt'))
  db.exec('ALTER TABLE meldung_ausgang ADD COLUMN unterdrueckt INTEGER NOT NULL DEFAULT 0');

// Block 3 (12.11.2026): geschuetzter Download. Eng begrenzte AUSNAHME von "nur Ansicht" fuer ausdruecklich verkaufte Download-Produkte (z. B. Handbuch-PDF).
// download_erlaubt: Standard 0 fuer ALLE bestehenden und neuen Lektionen (kein Admin-Weg setzt es; nur der Demo-Seed fuer das Handbuch).
if (!db.prepare('PRAGMA table_info(lektionen)').all().some(s => s.name === 'download_erlaubt'))
  db.exec('ALTER TABLE lektionen ADD COLUMN download_erlaubt INTEGER NOT NULL DEFAULT 0 CHECK (download_erlaubt IN (0, 1))');
db.exec(`
-- Sprachfassungen einer Download-Datei. pfad = Zufallsname (UUID) im DATEI_ORDNER, nie ein Pfad, nie nach aussen gegeben.
CREATE TABLE IF NOT EXISTS download_varianten (
 lektion_id INTEGER NOT NULL REFERENCES lektionen(id) ON DELETE CASCADE,
 sprache TEXT NOT NULL CHECK (sprache IN ('de','en','hu')),
 name TEXT NOT NULL,
 pfad TEXT NOT NULL,
 groesse INTEGER NOT NULL DEFAULT 0 CHECK (groesse >= 0),
 mime TEXT NOT NULL DEFAULT 'application/pdf',
 erstellt TEXT NOT NULL,
 PRIMARY KEY (lektion_id, sprache)
);
-- Protokoll erfolgreicher Downloads (ohne Geheimnisse: keine Sitzung, kein Pfad, keine IP). Bewusst ohne Fremdschluessel (blockiert kein Loeschen).
CREATE TABLE IF NOT EXISTS download_protokoll (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 benutzer_id INTEGER NOT NULL,
 kurs_id INTEGER NOT NULL,
 lektion_id INTEGER NOT NULL,
 sprache TEXT,
 zeit TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS download_protokoll_benutzer ON download_protokoll (benutzer_id, kurs_id);
`);

// Eine Transaktion: Alles in der Funktion gelingt gemeinsam, oder es wird komplett zurückgenommen.
export function transaktion(arbeit) {
  db.exec('BEGIN');
  try {
    const ergebnis = arbeit();
    db.exec('COMMIT');
    return ergebnis;
  } catch (fehler) {
    db.exec('ROLLBACK');
    throw fehler;
  }
}

// PUNKT-6 (15.11.2026): Eine UUID pro Kaufabsicht als Idempotency-Key fuer Stripe Checkout.
db.exec(`
CREATE TABLE IF NOT EXISTS kaufabsichten (
 benutzer_id INTEGER NOT NULL,
 kurs_id INTEGER NOT NULL,
 modell TEXT NOT NULL,
 uuid TEXT NOT NULL,
 stripe_sitzung_id TEXT,
 erstellt TEXT NOT NULL,
 UNIQUE(benutzer_id, kurs_id, modell)
);
`);

// A4a: Rechtstexte im Admin — unveränderliche Versionstabelle + aktive Versionszeiger
db.exec(`
CREATE TABLE IF NOT EXISTS recht_text (
 id INTEGER PRIMARY KEY,
 seite TEXT NOT NULL,
 version INTEGER NOT NULL,
 sprache TEXT NOT NULL,
 inhalt TEXT NOT NULL,
 bearbeiter TEXT NOT NULL,
 erstellt TEXT NOT NULL,
 UNIQUE(seite, version)
);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS recht_aktiv (
 seite TEXT PRIMARY KEY,
 version INTEGER NOT NULL
);
`);

// Abgelaufene Sitzungen aufräumen (beim Start)
db.prepare('DELETE FROM sitzungen WHERE laeuft_ab < ?').run(Date.now());

// K1: erst nach den Tabellenmigrationen, damit ein Tabellenneubau den Index nicht entfernt.
db.exec(`CREATE TABLE IF NOT EXISTS kategorien (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name_de TEXT NOT NULL CHECK(length(trim(name_de)) BETWEEN 1 AND 80),
 name_en TEXT NOT NULL CHECK(length(trim(name_en)) BETWEEN 1 AND 80),
 name_hu TEXT NOT NULL CHECK(length(trim(name_hu)) BETWEEN 1 AND 80),
 reihenfolge INTEGER NOT NULL DEFAULT 0,
 erstellt TEXT NOT NULL,
 geaendert TEXT NOT NULL
);`);
if (!db.prepare('PRAGMA table_info(kurse)').all().some(s => s.name === 'kategorie_id')) {
 db.exec('ALTER TABLE kurse ADD COLUMN kategorie_id INTEGER REFERENCES kategorien(id) ON DELETE SET NULL');
}
db.exec('CREATE INDEX IF NOT EXISTS kurse_katalog ON kurse(status, kategorie_id, id)');

// S2: normale Entwürfe mit ausdrücklich markierten Beispielinhalten.
if (!db.prepare('PRAGMA table_info(kurse)').all().some(c => c.name === 'beispiel_key')) {
  db.exec('ALTER TABLE kurse ADD COLUMN beispiel_key TEXT NULL');
}
