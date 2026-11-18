// B9: DEMO-Modus (DEMO_MODUS=1). Eine eigene Demo-Instanz zum Ausprobieren: Beispielkurse, Demo-Kaeuferkonten, Demo-Admin NUR ANSICHT.
// Regeln: kein echtes Geld (Stripe-Testmodus), keine Mails an Fremde, keine echten Kundendaten, jede aendernde Admin-Aktion 403 "Demo: nur Ansicht".
// Ohne DEMO_MODUS tut dieses Modul nichts ausser eine leere Tabelle anzulegen.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { db } from './db.mjs';
import { passwortHashen, aktuellerBenutzer, sitzungErzeugen, cookieSetzen } from './auth.mjs';
import { fehler } from './texte.mjs';
import { KURSE, HANDBUCH, HANDBUECHER } from './demo-daten.mjs';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Block 3: Quellordner der fertigen Handbuch-PDFs (Repo). Tests geben einen eigenen Ordner mit Test-PDFs mit.
export const HANDBUCH_ORDNER_STANDARD = fileURLToPath(new URL('./handbuch/ausgabe', import.meta.url));
const istPdf = (pfad) => { try { return statSync(pfad).isFile() && readFileSync(pfad).subarray(0, 5).toString('latin1') === '%PDF-'; } catch { return false; } };
// Legt EIN Handbuch-Produkt an (Standard: Kaeufer-Handbuch), wenn ALLE drei Sprachfassungen als PDF vorliegen; sonst nichts (Ergebnis false). Kopiert die PDFs
// unter Zufallsnamen in den DATEI_ORDNER (ausgeliefert nur ueber GET /api/kurse/:id/lektionen/:lid/download, nie statisch).
export function handbuchSeed({ dateiOrdner, handbuchOrdner = HANDBUCH_ORDNER_STANDARD, jetzt = new Date().toISOString(), handbuch = HANDBUCH } = {}) {
  if (!dateiOrdner) return false;
  const quellen = Object.entries(handbuch.dateien).map(([l, name]) => [l, name, join(handbuchOrdner, name)]);
  if (!quellen.every(([, , p]) => existsSync(p) && istPdf(p))) return false;
  const ziel = resolve(dateiOrdner); mkdirSync(ziel, { recursive: true });
  const kopiert = quellen.map(([l, name, p]) => { const zufall = randomUUID(); copyFileSync(p, join(ziel, zufall)); return [l, name, zufall, statSync(join(ziel, zufall)).size]; });
  const id = Number(db.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert,nutzen) VALUES (?,?,?,'eur','veroeffentlicht',?,?,?)")
    .run(handbuch.titel, handbuch.beschreibung, handbuch.preis, jetzt, jetzt, handbuch.nutzen).lastInsertRowid);
  const [abschnitt, titel, inhalt] = handbuch.lektion;
  const lid = Number(db.prepare("INSERT INTO lektionen (kurs_id,abschnitt,titel,art,inhalt,reihenfolge,status,erstellt,geaendert,download_erlaubt) VALUES (?,?,?,'pdf',?,1,'veroeffentlicht',?,?,1)")
    .run(id, abschnitt, titel, inhalt, jetzt, jetzt).lastInsertRowid);
  for (const [l, name, zufall, groesse] of kopiert)
    db.prepare("INSERT INTO download_varianten (lektion_id,sprache,name,pfad,groesse,mime,erstellt) VALUES (?,?,?,?,?,'application/pdf',?)").run(lid, l, name, zufall, groesse, jetzt);
  return { kursId: id, lektionId: lid };
}
// Alle Handbuecher in fester Reihenfolge (HANDBUECHER: Kaeufer, dann Admin). Jedes einzeln: fehlt bei einem eine PDF oder scheitert das Kopieren,
// bleibt nur dieses weg. Ergebnis: Liste mit { titel, kursId, lektionId } bzw. { titel, fehlt: true }.
export function handbuecherSeed({ dateiOrdner, handbuchOrdner = HANDBUCH_ORDNER_STANDARD, jetzt = new Date().toISOString(), handbuecher = HANDBUECHER } = {}) {
  return handbuecher.map((handbuch) => {
    try { const r = handbuchSeed({ dateiOrdner, handbuchOrdner, jetzt, handbuch }); return r ? { titel: handbuch.titel, ...r } : { titel: handbuch.titel, fehlt: true }; }
    catch (e) { console.warn(`Demo: Handbuch nicht angelegt (${e?.code || e?.name || 'Fehler'})`); return { titel: handbuch.titel, fehlt: true }; }
  });
}

db.exec(`CREATE TABLE IF NOT EXISTS demo_konten (
  benutzer_id INTEGER PRIMARY KEY REFERENCES benutzer(id) ON DELETE CASCADE,
  art TEXT NOT NULL CHECK (art IN ('kaeufer','admin')),
  erstellt INTEGER NOT NULL
);`);

export const DEMO_ADMIN_EMAIL = 'demo-admin@example.com';
// Obergrenze neu angelegter Demo-Kaeufer in 24 Stunden (Missbrauchsbremse; jeder Demo-Kauf mailt dem Betreiber). Standard 150, per Variable DEMO_MAX_KAEUFER_TAG (ganze Zahl 1 bis 5000) aenderbar.
export let DEMO_MAX_KAEUFER_TAG = 150;   // Standard; die Konfiguration (konfig.mjs) setzt den Wert ueber demoKonfigSetzen
let demoBunnyVideoId = '';
// Einstellungen aus der Konfiguration uebernehmen (app.mjs ruft das beim Start auf; demo.mjs liest selbst keine Umgebungsvariablen).
export function demoKonfigSetzen({ maxKaeuferTag, bunnyVideoId } = {}) {
  if (Number.isInteger(maxKaeuferTag) && maxKaeuferTag >= 1 && maxKaeuferTag <= 5000) DEMO_MAX_KAEUFER_TAG = maxKaeuferTag;
  demoBunnyVideoId = String(bunnyVideoId || '');
}
export const DEMO_MAX_JE_IP_STUNDE = 10;     // Demo-Starts je Adresse und Stunde
const demoMail = (n) => `demo-${n}@example.com`;
export const istDemoAdresse = (adresse) => /^demo-[a-z0-9-]+@example\.com$/i.test(String(adresse || ''));

// Mails an Demo-Konten werden nie versendet (Meldungen an den Betreiber laufen normal).
export function demoMailer(mailer) {
  if (!mailer) return mailer;
  return async (m) => (istDemoAdresse(m?.to) ? true : mailer(m));
}

// Beim ersten Start einer LEEREN Datenbank: Beispielkurse, Demo-Admin, ein fester Demo-Kaeufer. Erfundene Daten.
export async function demoSeedWennLeer({ dateiOrdner = null, handbuchOrdner = HANDBUCH_ORDNER_STANDARD } = {}) {
  if (db.prepare('SELECT COUNT(*) n FROM kurse').get().n > 0 || db.prepare('SELECT COUNT(*) n FROM benutzer').get().n > 0) return false;
  const jetzt = new Date().toISOString();
  for (const k of KURSE) {
    const id = Number(db.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert,nutzen) VALUES (?,?,?,'eur','veroeffentlicht',?,?,?)")
      .run(k.titel, k.beschreibung, k.preis, jetzt, jetzt, k.nutzen).lastInsertRowid);
    k.lektionen.forEach(([abschnitt, titel, inhalt], i) => db.prepare("INSERT INTO lektionen (kurs_id,abschnitt,titel,art,inhalt,reihenfolge,status,erstellt,geaendert) VALUES (?,?,?,'text',?,?,'veroeffentlicht',?,?)")
      .run(id, abschnitt, titel, inhalt, i + 1, jetzt, jetzt));
  }
  // Optional: ein Test-Video aus der Demo-Bibliothek bei Bunny als Videolektion im ersten Kurs (nur wenn die ID gesetzt UND Bunny konfiguriert ist; sonst unveraendert).
  const bunnyVideo = demoBunnyVideoId;   // aus der Konfiguration: nur gesetzt, wenn gueltig UND alle drei Bunny-Stream-Variablen vorhanden sind
  if (bunnyVideo) {
    const kursId = db.prepare('SELECT id FROM kurse ORDER BY id LIMIT 1').get()?.id;
    if (kursId) {
      const nr = (db.prepare('SELECT MAX(reihenfolge) m FROM lektionen WHERE kurs_id=?').get(kursId).m ?? 0) + 1;
      const lid = Number(db.prepare("INSERT INTO lektionen (kurs_id,abschnitt,titel,art,inhalt,reihenfolge,status,erstellt,geaendert) VALUES (?,?,?,'video',?,?,'veroeffentlicht',?,?)")
        .run(kursId, 'Videoprobe', 'Test-Video (Demo)', 'Kurzes Testvideo: so sieht eine Videolektion aus. Das Video liegt geschützt bei Bunny Stream.', nr, jetzt, jetzt).lastInsertRowid);
      db.prepare("INSERT INTO dateien (lektion_id, name, art, pfad, groesse, mime, erstellt, quelle, bunny_video_id, bunny_status) VALUES (?, ?, 'video', 'bunny', 0, 'application/octet-stream', ?, 'bunny', ?, 'fertig')")
        .run(lid, 'Test-Video (Demo)', jetzt, bunnyVideo);
    }
  }
  // Block 3: Handbuch-Produkte (Kaeufer = Kurs 4, Admin = Kurs 5) je nur, wenn alle drei PDFs da sind. Scheitert eines, bleibt die Demo ohne dieses Handbuch.
  handbuecherSeed({ dateiOrdner, handbuchOrdner, jetzt });
  const hash = await passwortHashen(randomBytes(24).toString('hex'));   // Zufallspasswort, nirgends gespeichert: Zugang nur ueber die Demo-Knoepfe
  const admin = Number(db.prepare("INSERT INTO benutzer (email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES (?,?,'admin',?,?)").run(DEMO_ADMIN_EMAIL, hash, jetzt, Date.now()).lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO admin_schutz (benutzer_id) VALUES (?)').run(admin);
  db.prepare("INSERT INTO demo_konten (benutzer_id,art,erstellt) VALUES (?,'admin',?)").run(admin, Date.now());
  return true;
}

const demoArt = (benutzerId) => db.prepare('SELECT art FROM demo_konten WHERE benutzer_id=?').get(benutzerId)?.art ?? null;

// Aenderungen, die ein Demo-KAEUFER nie ausloesen darf (Konto, Passwort, E-Mail): sonst koennten Besucher fremde Adressen anschreiben lassen.
// Alle Pruefungen laufen auf dem NORMALISIERTEN Pfad (klein geschrieben, doppelte Schraegstriche zusammengefasst), denn Express leitet
// /api/Admin, /API/admin und /api/admin/ auf dieselben Routen (Gesamtpruefung 12.11.2026, F-02). Die Ausdruecke tragen zusaetzlich /i.
const KAEUFER_GESPERRT = /^\/api\/(passwort-|konto\/|email-|registrieren|admin)/i;
// Lesende Admin-Wege, die echte oder sensible Daten zeigen koennten: Sicherung, Agent, Login-Protokoll, Stripe-Abgleich, Bunny-Abgleich, Exporte.
// Block 4: dazu die Widerrufsliste (E-Mail-Adressen der Kaeufer).
const ADMIN_LESEN_GESPERRT = /^\/api\/admin\/(sicherung|agent|logins|abgleich|bunny\/abgleich|widerrufe)/i;
export const demoPfad = (pfad) => String(pfad || '').toLowerCase().replace(/\/{2,}/g, '/');
const REGISTRIEREN = /^\/api\/registrieren\/?$/;

// Middleware: VOR allen Routen (app.mjs haengt sie vor jeden /api-Router). Fuer normale Konten ohne Wirkung,
// ausser der Registrierung: die ist in der Demo fuer alle gesperrt (Demo-Kaeufer entstehen nur ueber /api/demo/zugang; F-03, A4-03).
export function demoSchutz(req, res, next) {
  const pfad = demoPfad(req.path);
  const schreibend = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (schreibend && REGISTRIEREN.test(pfad)) { res.setHeader('Cache-Control', 'no-store'); return fehler(res, 403, 'demo_registrierung'); }
  const benutzer = aktuellerBenutzer(req);
  const art = benutzer ? demoArt(benutzer.id) : null;
  if (!art) return next();
  res.setHeader('Cache-Control', 'no-store');
  if (art === 'admin') {
    if (schreibend && pfad.replace(/\/$/, '') !== '/api/abmelden') return fehler(res, 403, 'demo_nur_ansicht');
    if (!schreibend && (ADMIN_LESEN_GESPERRT.test(pfad) || (pfad.startsWith('/api/admin/') && 'format' in req.query))) return fehler(res, 403, 'demo_nur_ansicht');
    return next();
  }
  if (schreibend && KAEUFER_GESPERRT.test(pfad)) return fehler(res, 403, 'demo_gesperrt');
  if (pfad.startsWith('/api/admin')) return fehler(res, 403, 'kein_admin');
  next();
}

export function demoRouter({ maxSitzungen = 3, secureCookies = false } = {}) {
  const router = express.Router();
  const je = new Map();   // Adresse -> Zeitpunkte der Demo-Starts
  const erlaubt = (ip) => { const jetzt = Date.now(); const z = (je.get(ip) || []).filter((x) => x > jetzt - 3600000); if (z.length >= DEMO_MAX_JE_IP_STUNDE) { je.set(ip, z); return false; } z.push(jetzt); je.set(ip, z); return true; };
  router.post('/api/demo/zugang', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const rolle = req.body?.rolle;
    if (Object.keys(req.body ?? {}).some((k) => k !== 'rolle') || !['kaeufer', 'admin'].includes(rolle)) return fehler(res, 400, 'demo_rolle');
    if (!erlaubt(req.ip)) return fehler(res, 429, 'demo_limit');
    let benutzerId;
    if (rolle === 'admin') {
      benutzerId = db.prepare("SELECT b.id FROM benutzer b JOIN demo_konten d ON d.benutzer_id=b.id WHERE d.art='admin' ORDER BY b.id LIMIT 1").get()?.id;
      if (!benutzerId) return fehler(res, 404, 'nicht_gefunden');
    } else {
      if (db.prepare("SELECT COUNT(*) n FROM demo_konten WHERE art='kaeufer' AND erstellt>?").get(Date.now() - 86400000).n >= DEMO_MAX_KAEUFER_TAG) return fehler(res, 429, 'demo_limit');
      const hash = await passwortHashen(randomBytes(24).toString('hex'));
      const email = demoMail(randomBytes(6).toString('hex'));
      benutzerId = Number(db.prepare('INSERT INTO benutzer (email,passwort_hash,erstellt,email_bestaetigt) VALUES (?,?,?,?)').run(email, hash, new Date().toISOString(), Date.now()).lastInsertRowid);
      db.prepare("INSERT INTO demo_konten (benutzer_id,art,erstellt) VALUES (?,'kaeufer',?)").run(benutzerId, Date.now());
    }
    cookieSetzen(res, sitzungErzeugen(benutzerId, maxSitzungen), secureCookies);
    res.json({ ok: true, rolle });
  });
  return router;
}
