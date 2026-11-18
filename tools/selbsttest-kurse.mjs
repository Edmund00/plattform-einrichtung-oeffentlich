// Automatischer Selbsttest der Kurs-API (Scheibe 1). Keine Stripe-Schlüssel nötig.
// Startet tools/testserver-kurse.mjs auf Port 4402 mit eigener Test-Datenbank, prüft, räumt wieder auf.
// Aufruf: node --disable-warning=ExperimentalWarning tools/selbsttest-kurse.mjs   (oder tools\Selbsttest-Kurse.ps1)
import './test-sprache.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const PORT = 4402;
const BASE = `http://localhost:${PORT}`;
mkdirSync('daten', { recursive: true });
const lauf = Date.now();
const DB = `daten/selbsttest-kurse-${lauf}.db`;
const ALT_DB = `daten/selbsttest-kurse-alt-${lauf}.db`;
const HU = JSON.parse(readFileSync('texte/hu.json', 'utf8'));
const mailAdmin = `Selbsttest.Admin.${lauf}@Example.com`;   // absichtlich gemischt geschrieben
const mailWannabe = `wannabe.admin.${lauf}@example.com`;   // steht in ADMIN_EMAIL, darf trotzdem nie Admin werden
const pw = 'Geheim-Passwort-123';

let ok = 0, schlecht = 0;
const pruefe = (name, bedingung, detail = '') => { bedingung ? ok++ : schlecht++; console.log(`${bedingung ? 'OK     ' : 'FEHLER '} ${name}${!bedingung && detail ? '  -> ' + detail : ''}`); };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = () => { for (const d of [DB, ALT_DB]) for (const s of ['', '-wal', '-shm']) { try { rmSync(d + s, { force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } } }; // Windows: Datei kann noch gesperrt sein

// ---- Test der Migration: eine ALTE Datenbank (ohne Spalte "rolle") darf nicht kaputtgehen ----
console.log('--- Alte Datenbank wird sauber ergänzt');
{
  const alt = new DatabaseSync(ALT_DB);
  alt.exec(`CREATE TABLE benutzer (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, passwort_hash TEXT NOT NULL, stripe_kunde TEXT UNIQUE, erstellt TEXT NOT NULL);
            CREATE TABLE bestellungen (schluessel TEXT PRIMARY KEY, benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE, art TEXT, betrag INTEGER, waehrung TEXT, status TEXT, erstellt TEXT NOT NULL, geaendert TEXT NOT NULL);`);
  alt.prepare('INSERT INTO benutzer (email, passwort_hash, stripe_kunde, erstellt) VALUES (?, ?, ?, ?)').run('alt@example.com', 'scrypt$aa$bb', 'cus_alt', '2026-01-01');
  alt.prepare('INSERT INTO bestellungen VALUES (?, 1, ?, ?, ?, ?, ?, ?)').run('pi_alt', 'probe', 990, 'eur', 'bezahlt', '2026-01-01', '2026-01-01');
  alt.close();
  let lauf1, lauf2;
  for (let i = 0; i < 2; i++) { // zweimal: die Ergänzung muss wiederholbar sein
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', "await import('./db.mjs')"], { env: { ...process.env, DB_DATEI: ALT_DB }, encoding: 'utf8' });
    i === 0 ? (lauf1 = r) : (lauf2 = r);
  }
  pruefe('Start mit alter Datenbank (1. und 2. Mal) ohne Fehler', lauf1.status === 0 && lauf2.status === 0, (lauf1.stderr || '') + (lauf2.stderr || ''));
  const d = new DatabaseSync(ALT_DB);
  const b = d.prepare('SELECT email, stripe_kunde, rolle FROM benutzer').all();
  pruefe('Alter Benutzer ist erhalten und hat Rolle "kunde"', b.length === 1 && b[0].email === 'alt@example.com' && b[0].stripe_kunde === 'cus_alt' && b[0].rolle === 'kunde', JSON.stringify(b));
  pruefe('Alte Lern-App-Bestellung ist erhalten (Tabelle umbenannt, nichts gelöscht)', d.prepare('SELECT COUNT(*) AS n FROM bestellungen_lern_app_alt').get().n === 1 && d.prepare('SELECT betrag FROM bestellungen_lern_app_alt').get().betrag === 990);
  pruefe('Neue Tabelle "bestellungen" hat die neuen Spalten und ist leer', ['stripe_sitzung', 'zahlung_id', 'kurs_id', 'status', 'grund'].every((c) => d.prepare('PRAGMA table_info(bestellungen)').all().some((x) => x.name === c)) && d.prepare('SELECT COUNT(*) AS n FROM bestellungen').get().n === 0);
  const tabellen = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  pruefe('Neue Tabellen sind da (kurse, lektionen, dateien, zugaenge)', ['kurse', 'lektionen', 'dateien', 'zugaenge'].every((t) => tabellen.includes(t)), tabellen.join(','));
  d.close();
}

// ---- Admin NUR über das Skript anlegen (die Registrierung vergibt nie Admin) ----
{
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/admin-anlegen.mjs', mailAdmin], { env: { ...process.env, DB_DATEI: DB, ADMIN_PASSWORT: pw }, encoding: 'utf8' });
  pruefe('Admin-Skript legt den Admin an ("Admin angelegt")', r.status === 0 && r.stdout.trim() === 'Admin angelegt', r.stdout + r.stderr);
}

// ---- Server starten ----
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/testserver-kurse.mjs'], {
  env: { ...process.env, PORT: String(PORT), BASE_URL: BASE, DB_DATEI: DB, ADMIN_EMAIL: mailWannabe }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
for (let i = 0; i < 40 && !/Kurs-Testserver läuft/.test(serverLog); i++) await warte(250);
if (!/Kurs-Testserver läuft/.test(serverLog)) { console.log('Server nicht gestartet:\n' + serverLog); server.kill(); aufraeumen(); process.exit(1); }

// ---- Hilfen ----
function client() {
  let cookie = '';
  return {
    async anfrage(methode, pfad, body, kopf = {}) {
      const r = await fetch(BASE + pfad, { method: methode, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...kopf }, body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
      const sc = r.headers.get('set-cookie');
      if (sc) { const roh = sc.split(';')[0]; cookie = roh.endsWith('=') ? '' : roh; }
      let d = {}; try { d = await r.json(); } catch (e) {}
      return { s: r.status, d };
    },
  };
}
const db = () => new DatabaseSync(DB);

try {
  const admin = client(), kunde = client(), gast = client(), kunde2 = client(), listiger = client(), listiger2 = client();

  console.log('--- Rollen: Admin nur über das Skript, nie über die Registrierung');
  pruefe('Admin meldet sich an (angelegt per Skript): 200', (await admin.anfrage('POST', '/api/anmelden', { email: mailAdmin, passwort: pw })).s === 200);
  pruefe('Wer die E-Mail aus ADMIN_EMAIL registriert, wird NICHT Admin', (await listiger2.anfrage('POST', '/api/registrieren', { zustimmung: true, email: mailWannabe, passwort: pw })).s === 201
    && (await listiger2.anfrage('GET', '/api/ich')).d.rolle === 'kunde');
  pruefe('Normaler Benutzer registriert sich: 201', (await kunde.anfrage('POST', '/api/registrieren', { zustimmung: true, email: `kunde.${lauf}@example.com`, passwort: pw })).s === 201);
  pruefe('Zweiter normaler Benutzer: 201', (await kunde2.anfrage('POST', '/api/registrieren', { zustimmung: true, email: `kunde2.${lauf}@example.com`, passwort: pw })).s === 201);
  pruefe('Wer "rolle: admin" mitschickt, wird trotzdem "kunde"', (await listiger.anfrage('POST', '/api/registrieren', { zustimmung: true, email: `listig.${lauf}@example.com`, passwort: pw, rolle: 'admin' })).s === 201
    && (await listiger.anfrage('GET', '/api/ich')).d.rolle === 'kunde');
  pruefe('/api/ich: Admin hat Rolle "admin"', (await admin.anfrage('GET', '/api/ich')).d.rolle === 'admin');
  pruefe('/api/ich: Kunde hat Rolle "kunde"', (await kunde.anfrage('GET', '/api/ich')).d.rolle === 'kunde');
  const d0 = db();
  const rollen = d0.prepare('SELECT email, rolle FROM benutzer ORDER BY id').all();
  d0.close();
  pruefe('Datenbank: genau 1 Admin (der per Skript angelegte), alle anderen "kunde"', rollen.filter((r) => r.rolle === 'admin').length === 1 && rollen[0].rolle === 'admin' && rollen.slice(1).every((r) => r.rolle === 'kunde'), JSON.stringify(rollen));

  console.log('--- Admin-Routen: 401 ohne Anmeldung, 403 für Nicht-Admin');
  const adminRouten = [
    ['GET', '/api/admin/kurse', undefined],
    ['POST', '/api/admin/kurse', { titel: 'X', preis_cent: 100 }],
    ['PATCH', '/api/admin/kurse/1', { titel: 'Y' }],
    ['POST', '/api/admin/kurse/1/veroeffentlichen', {}],
    ['POST', '/api/admin/kurse/1/lektionen', { titel: 'L' }],
    ['PATCH', '/api/admin/lektionen/1', { titel: 'Y' }],
  ];
  for (const [m, p, b] of adminRouten) {
    const r = await gast.anfrage(m, p, b);
    pruefe(`Ohne Anmeldung ${m} ${p}: 401`, r.s === 401 && r.d.fehler === 'nicht_angemeldet' && r.d.text === HU.nicht_angemeldet, JSON.stringify(r));
  }
  for (const [m, p, b] of adminRouten) {
    const r = await kunde.anfrage(m, p, b);
    pruefe(`Nicht-Admin ${m} ${p}: 403`, r.s === 403 && r.d.fehler === 'kein_admin' && r.d.text === HU.kein_admin, JSON.stringify(r));
  }
  const dKeinKurs = db(); const nKurse0 = dKeinKurs.prepare('SELECT COUNT(*) AS n FROM kurse').get().n; dKeinKurs.close();
  pruefe('Abgewiesene Anfragen haben nichts angelegt', nKurse0 === 0);
  pruefe('Fremde Herkunft bei PATCH: 403', (await admin.anfrage('PATCH', '/api/admin/kurse/1', { titel: 'Y' }, { Origin: 'http://boese-seite.example' })).s === 403);

  console.log('--- Admin legt einen Kurs an (Entwurf)');
  const neu = await admin.anfrage('POST', '/api/admin/kurse', { titel: '  Szín- és stílustanácsadás  ', beschreibung: 'Alapok', preis_cent: 4990000 });
  pruefe('Kurs anlegen: 201, Status "entwurf", Titel gekürzt, Währung huf', neu.s === 201 && neu.d.status === 'entwurf' && neu.d.titel === 'Szín- és stílustanácsadás' && neu.d.waehrung === 'huf' && neu.d.preis_cent === 4990000, JSON.stringify(neu));
  const kursId = neu.d.id;
  const statusEinschleusen = await admin.anfrage('POST', '/api/admin/kurse', { titel: 'Schlau', preis_cent: 1, status: 'veroeffentlicht' });
  pruefe('Status beim Anlegen mitschicken: 400 (unbekanntes Feld)', statusEinschleusen.s === 400 && statusEinschleusen.d.fehler === 'unbekanntes_feld');

  console.log('--- Öffentliche Liste: kein Entwurf');
  const liste1 = await gast.anfrage('GET', '/api/kurse');
  pruefe('Öffentliche Liste ist leer (nur Entwurf vorhanden)', liste1.s === 200 && Array.isArray(liste1.d) && liste1.d.length === 0, JSON.stringify(liste1.d));
  pruefe('Entwurf einzeln für Gast: 404', (await gast.anfrage('GET', `/api/kurse/${kursId}`)).s === 404);
  pruefe('Entwurf einzeln für Kunde: 404', (await kunde.anfrage('GET', `/api/kurse/${kursId}`)).s === 404);
  const adminSicht = await admin.anfrage('GET', `/api/kurse/${kursId}`);
  pruefe('Entwurf einzeln für Admin: 200 und Status "entwurf"', adminSicht.s === 200 && adminSicht.d.status === 'entwurf', JSON.stringify(adminSicht));

  console.log('--- Ungültige Eingaben: 400 mit Code und ungarischem Text');
  const ungueltig = [
    ['Leerer Titel', 'POST', '/api/admin/kurse', { titel: '   ', preis_cent: 100 }, 'titel_ungueltig'],
    ['Titel fehlt', 'POST', '/api/admin/kurse', { preis_cent: 100 }, 'titel_ungueltig'],
    ['Titel keine Zeichenkette', 'POST', '/api/admin/kurse', { titel: 123, preis_cent: 100 }, 'titel_ungueltig'],
    ['Negativer Preis', 'POST', '/api/admin/kurse', { titel: 'A', preis_cent: -1 }, 'preis_ungueltig'],
    ['Preis mit Komma-Zahl', 'POST', '/api/admin/kurse', { titel: 'A', preis_cent: 9.5 }, 'preis_ungueltig'],
    ['Preis als Text', 'POST', '/api/admin/kurse', { titel: 'A', preis_cent: '100' }, 'preis_ungueltig'],
    ['Preis fehlt', 'POST', '/api/admin/kurse', { titel: 'A' }, 'preis_ungueltig'],
    ['Preis unsinnig hoch', 'POST', '/api/admin/kurse', { titel: 'A', preis_cent: 1e15 }, 'preis_ungueltig'],
    ['Unerlaubte Währung', 'POST', '/api/admin/kurse', { titel: 'A', preis_cent: 1, waehrung: 'usd' }, 'waehrung_ungueltig'],
    ['Unbekanntes Feld (id)', 'POST', '/api/admin/kurse', { titel: 'A', preis_cent: 1, id: 99 }, 'unbekanntes_feld'],
    ['Body ist ein Array', 'POST', '/api/admin/kurse', [1, 2], 'body_ungueltig'],
    ['Kaputtes JSON', 'POST', '/api/admin/kurse', '{"titel": ', 'ungueltiges_json'],
    ['PATCH Kurs: negativer Preis', 'PATCH', `/api/admin/kurse/${kursId}`, { preis_cent: -5 }, 'preis_ungueltig'],
    ['PATCH Kurs: Status ändern geht nicht', 'PATCH', `/api/admin/kurse/${kursId}`, { status: 'veroeffentlicht' }, 'unbekanntes_feld'],
    ['PATCH Kurs: leer', 'PATCH', `/api/admin/kurse/${kursId}`, {}, 'nichts_zu_aendern'],
    ['Kurs-ID kein Zahlenwert', 'PATCH', '/api/admin/kurse/abc', { titel: 'A' }, 'ungueltige_id'],
    ['Lektion: leerer Titel', 'POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: '' }, 'titel_ungueltig'],
    ['Lektion: falsche Art', 'POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: 'L', art: 'film' }, 'art_ungueltig'],
    ['Lektion: negative Reihenfolge', 'POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: 'L', reihenfolge: -1 }, 'reihenfolge_ungueltig'],
    ['Lektion: falscher Status', 'POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: 'L', status: 'geheim' }, 'status_ungueltig'],
    ['Lektion: Inhalt zu lang', 'POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: 'L', inhalt: 'x'.repeat(8001) }, 'inhalt_ungueltig'],
    ['PATCH Lektion: falsche Art', 'PATCH', '/api/admin/lektionen/1', { art: 'film' }, 'art_ungueltig'],
  ];
  const dUngueltigVor = db(); const vorher = dUngueltigVor.prepare('SELECT COUNT(*) AS n FROM kurse').get().n + dUngueltigVor.prepare('SELECT COUNT(*) AS n FROM lektionen').get().n; dUngueltigVor.close();
  for (const [name, m, p, b, code] of ungueltig) {
    // PATCH auf Lektion 1 gibt es noch nicht: erst unten anlegen, hier genügt 404/400 nicht -> eigener Fall
    if (name === 'PATCH Lektion: falsche Art') continue;
    const r = await admin.anfrage(m, p, b);
    pruefe(`${name}: 400 ${code}`, r.s === 400 && r.d.fehler === code && r.d.text === HU[code], JSON.stringify(r));
  }
  pruefe('Unbekannter Kurs: 404', (await admin.anfrage('PATCH', '/api/admin/kurse/999999', { titel: 'A' })).s === 404);
  pruefe('Lektion für unbekannten Kurs: 404', (await admin.anfrage('POST', '/api/admin/kurse/999999/lektionen', { titel: 'A' })).s === 404);
  const dUngueltigNach = db(); const nachher = dUngueltigNach.prepare('SELECT COUNT(*) AS n FROM kurse').get().n + dUngueltigNach.prepare('SELECT COUNT(*) AS n FROM lektionen').get().n; dUngueltigNach.close();
  pruefe('Ungültige Eingaben haben nichts gespeichert', vorher === nachher, `${vorher} -> ${nachher}`);
  const g = await gast.anfrage('GET', '/api/kurse/abc');
  pruefe('GET Kurs mit ungültiger ID: 400', g.s === 400 && g.d.fehler === 'ungueltige_id');

  console.log('--- Kurs ändern und veröffentlichen');
  const gepatcht = await admin.anfrage('PATCH', `/api/admin/kurse/${kursId}`, { preis_cent: 3990000, waehrung: 'eur' });
  pruefe('Kurs ändern: Preis und Währung neu, Status bleibt "entwurf"', gepatcht.s === 200 && gepatcht.d.preis_cent === 3990000 && gepatcht.d.waehrung === 'eur' && gepatcht.d.status === 'entwurf', JSON.stringify(gepatcht));
  const veroeff = await admin.anfrage('POST', `/api/admin/kurse/${kursId}/veroeffentlichen`, {});
  pruefe('Veröffentlichen: 200, Status "veroeffentlicht"', veroeff.s === 200 && veroeff.d.status === 'veroeffentlicht', JSON.stringify(veroeff));
  pruefe('Veröffentlichen unbekannter Kurs: 404', (await admin.anfrage('POST', '/api/admin/kurse/999999/veroeffentlichen', {})).s === 404);
  const liste2 = await gast.anfrage('GET', '/api/kurse');
  pruefe('Danach in der öffentlichen Liste (genau 1)', liste2.s === 200 && liste2.d.length === 1 && liste2.d[0].id === kursId && liste2.d[0].preis_cent === 3990000, JSON.stringify(liste2.d));
  pruefe('Öffentliche Liste verrät keinen Status und keine Zeitstempel', !('status' in liste2.d[0]) && !('erstellt' in liste2.d[0]));
  pruefe('Veröffentlichter Kurs einzeln für Gast: 200', (await gast.anfrage('GET', `/api/kurse/${kursId}`)).s === 200);
  const zweiterEntwurf = await admin.anfrage('POST', '/api/admin/kurse', { titel: 'Zweiter Kurs', preis_cent: 100 });
  pruefe('Ein weiterer Entwurf taucht in der öffentlichen Liste nicht auf', (await gast.anfrage('GET', '/api/kurse')).d.length === 1 && zweiterEntwurf.s === 201);

  console.log('--- Lektionen und Reihenfolge');
  // Block 4: Im veroeffentlichten Kurs entstehen neue Lektionen ohne Angabe ausgeblendet; diese Lektionen sollen sofort sichtbar sein, daher status ausdruecklich.
  const L1 = await admin.anfrage('POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: 'Bevezetés', abschnitt: '1. Alapok', art: 'text', inhalt: 'Geheimer Text der ersten Lektion', status: 'veroeffentlicht' });
  const L2 = await admin.anfrage('POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: 'Videó', abschnitt: '1. Alapok', art: 'video', inhalt: 'Geheime Videobeschreibung', status: 'veroeffentlicht' });
  const L3 = await admin.anfrage('POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: 'Jegyzet', abschnitt: '2. Mélyítés', art: 'pdf', inhalt: 'Geheimes PDF', reihenfolge: 0, status: 'veroeffentlicht' });
  pruefe('Lektionen angelegt: 201', L1.s === 201 && L2.s === 201 && L3.s === 201, JSON.stringify([L1.d, L2.d, L3.d]));
  pruefe('Ohne Angabe kommt die Lektion ans Ende (1, 2)', L1.d.reihenfolge === 1 && L2.d.reihenfolge === 2, `${L1.d.reihenfolge}, ${L2.d.reihenfolge}`);
  const entwurfLektion = await admin.anfrage('POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: 'Noch nicht fertig', status: 'entwurf', reihenfolge: 9 });
  const lP = await admin.anfrage('PATCH', `/api/admin/lektionen/${L2.d.id}`, { reihenfolge: 5, titel: 'Videó (új)' });
  pruefe('Lektion ändern (Reihenfolge, Titel): 200', lP.s === 200 && lP.d.reihenfolge === 5 && lP.d.titel === 'Videó (új)', JSON.stringify(lP));
  pruefe('Lektion ändern: falsche Art -> 400', (await admin.anfrage('PATCH', `/api/admin/lektionen/${L2.d.id}`, { art: 'film' })).d.fehler === 'art_ungueltig');
  pruefe('Unbekannte Lektion: 404', (await admin.anfrage('PATCH', '/api/admin/lektionen/999999', { titel: 'A' })).s === 404);
  const gastSicht = await gast.anfrage('GET', `/api/kurse/${kursId}`);
  pruefe('Titelliste ist nach Reihenfolge sortiert (Jegyzet, Bevezetés, Videó)', gastSicht.d.lektionen?.map((l) => l.titel).join('|') === 'Jegyzet|Bevezetés|Videó (új)', JSON.stringify(gastSicht.d.lektionen));
  pruefe('Gast sieht Entwurfs-Lektion nicht', !gastSicht.d.lektionen.some((l) => l.titel === 'Noch nicht fertig') && gastSicht.d.lektionen.length === 3);

  console.log('--- Lektionsinhalt: ohne Zugang gesperrt, mit Zugang sichtbar');
  const dDatei = db();
  dDatei.prepare('INSERT INTO dateien (lektion_id, name, art, pfad, groesse, erstellt) VALUES (?, ?, ?, ?, ?, ?)').run(L2.d.id, 'film.mp4', 'video', 'intern/geheim/film.mp4', 123456, new Date().toISOString());
  dDatei.close();
  const textGast = JSON.stringify(gastSicht.d);
  pruefe('Gast: zugang=false, kein Inhalt, keine Dateien', gastSicht.d.zugang === false && !textGast.includes('Geheim') && !textGast.includes('film.mp4') && gastSicht.d.lektionen.every((l) => !('inhalt' in l) && !('dateien' in l)), textGast);
  const kundeOhne = await kunde.anfrage('GET', `/api/kurse/${kursId}`);
  pruefe('Angemeldeter Kunde ohne Zugang: gesperrt wie der Gast', kundeOhne.d.zugang === false && !JSON.stringify(kundeOhne.d).includes('Geheim') && !JSON.stringify(kundeOhne.d).includes('film.mp4'));
  const dZ = db();
  const kundeId = dZ.prepare("SELECT id FROM benutzer WHERE email = ?").get(`kunde.${lauf}@example.com`).id;
  dZ.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, erstellt) VALUES (?, ?, 'einladung', ?)").run(kundeId, kursId, new Date().toISOString());
  dZ.close();
  const kundeMit = await kunde.anfrage('GET', `/api/kurse/${kursId}`);
  // F-04: Lektionstexte nur je Lektion (?lektion=); hier alle Lektionsanfragen zusammen pruefen, die Kursseite allein hat keinen Text.
  const kundeText = JSON.stringify(kundeMit.d) + (await Promise.all(kundeMit.d.lektionen.map(l => kunde.anfrage('GET', `/api/kurse/${kursId}?lektion=${l.id}`)))).map(r => JSON.stringify(r.d)).join(' ');
  pruefe('Kunde MIT Zugang: Kursseite ohne Lektionstext (nur Kopfdaten)', !JSON.stringify(kundeMit.d).includes('Geheimer Text der ersten Lektion'));
  pruefe('Kunde MIT Zugang: zugang=true und Inhalt sichtbar', kundeMit.d.zugang === true && kundeText.includes('Geheimer Text der ersten Lektion') && kundeText.includes('Geheimes PDF'), kundeText);
  pruefe('Kunde MIT Zugang sieht die Dateien (Name, Art, Größe), aber nie den internen Pfad', kundeText.includes('film.mp4') && !kundeText.includes('intern/geheim') && !kundeText.includes('pfad'), kundeText);
  pruefe('Kunde MIT Zugang sieht keine Entwurfs-Lektion', !kundeText.includes('Noch nicht fertig'));
  const kunde2Sicht = await kunde2.anfrage('GET', `/api/kurse/${kursId}`);
  pruefe('Der Zugang gehört nur dem einen Kunden: Kunde 2 bleibt gesperrt', kunde2Sicht.d.zugang === false && !JSON.stringify(kunde2Sicht.d).includes('Geheim'));
  const adminVoll = await admin.anfrage('GET', `/api/kurse/${kursId}`);
  pruefe('Admin sieht alles, auch die Entwurfs-Lektion', adminVoll.d.zugang === true && adminVoll.d.lektionen.length === 4 && JSON.stringify(adminVoll.d).includes('Noch nicht fertig'));
  // Zugang gilt nur für DIESEN Kurs
  const anderer = await admin.anfrage('POST', `/api/admin/kurse/${zweiterEntwurf.d.id}/veroeffentlichen`, {});
  await admin.anfrage('POST', `/api/admin/kurse/${zweiterEntwurf.d.id}/lektionen`, { titel: 'Anderer Kurs', inhalt: 'Anderer geheimer Inhalt' });
  const kundeAnderer = await kunde.anfrage('GET', `/api/kurse/${zweiterEntwurf.d.id}`);
  pruefe('Zugang zu Kurs 1 öffnet NICHT Kurs 2', anderer.s === 200 && kundeAnderer.d.zugang === false && !JSON.stringify(kundeAnderer.d).includes('Anderer geheimer'));

  console.log('--- Datenbank: UNIQUE und Fremdschlüssel');
  const dU = db();
  dU.exec('PRAGMA foreign_keys = ON;');
  let doppelt = '';
  try { dU.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, erstellt) VALUES (?, ?, 'zahlung', ?)").run(kundeId, kursId, new Date().toISOString()); } catch (e) { doppelt = String(e.message); }
  pruefe('Doppelter Zugang (gleicher Benutzer, gleicher Kurs) wird abgelehnt (UNIQUE)', /UNIQUE/i.test(doppelt), doppelt);
  pruefe('Es bleibt bei genau 1 Zugang', dU.prepare('SELECT COUNT(*) AS n FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ?').get(kundeId, kursId).n === 1);
  let quelle = ''; try { dU.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, erstellt) VALUES (?, ?, 'geschenkt', ?)").run(kundeId, zweiterEntwurf.d.id, new Date().toISOString()); } catch (e) { quelle = String(e.message); }
  pruefe('Unerlaubte Quelle beim Zugang wird abgelehnt (CHECK)', /CHECK/i.test(quelle), quelle);
  let fk = ''; try { dU.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, erstellt) VALUES (99999, ?, 'zahlung', ?)").run(kursId, new Date().toISOString()); } catch (e) { fk = String(e.message); }
  pruefe('Zugang für nicht vorhandenen Benutzer wird abgelehnt (Fremdschlüssel)', /FOREIGN KEY/i.test(fk), fk);
  let fk2 = ''; try { dU.prepare("INSERT INTO lektionen (kurs_id, titel, erstellt, geaendert) VALUES (99999, 'x', 'z', 'z')").run(); } catch (e) { fk2 = String(e.message); }
  pruefe('Lektion für nicht vorhandenen Kurs wird abgelehnt (Fremdschlüssel)', /FOREIGN KEY/i.test(fk2), fk2);
  let preisDb = ''; try { dU.prepare("INSERT INTO kurse (titel, preis_cent, erstellt, geaendert) VALUES ('x', -1, 'z', 'z')").run(); } catch (e) { preisDb = String(e.message); }
  pruefe('Negativer Preis wird auch von der Datenbank selbst abgelehnt (CHECK)', /CHECK/i.test(preisDb), preisDb);
  dU.close();

  console.log('--- Bleibt der Server heil?');
  pruefe('Server läuft noch und antwortet', (await gast.anfrage('GET', '/api/kurse')).s === 200);
} catch (e) {
  schlecht++; console.log('FEHLER  Unerwarteter Abbruch: ' + e.stack);
} finally {
  server.kill();
  await warte(500);
  aufraeumen();
  console.log(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`);
  process.exit(schlecht === 0 ? 0 : 1);
}
