// Schulungsplattform, Scheibe 1: API für Kurse und Lektionen (Express 5).
// Regeln: Der Server prüft bei JEDEM Aufruf, wer fragt. Preise bestimmt nur der Server. Eingaben werden streng geprüft.
// Fehler-Antworten: { fehler: "<code>", text: "<ungarischer Text aus texte/hu.json>" }
import express from 'express';
import { db, transaktion } from './db.mjs';
import { vormerken } from './bunny-loeschen.mjs';
import { aktuellerBenutzer } from './auth.mjs';
import { gueltigerZugang } from './zugang.mjs';
import { erstenZugriffMerken } from './erster-zugriff.mjs';
import { aboBeiStripeBeenden, laufendeAbosBeendenStripe, abosBeendetSetzen } from './abo.mjs';
import { fehler, sprache } from './texte.mjs';
import { kursUebersetzt, lektionenUebersetzt, demoUebersetzungAktiv } from './demo-uebersetzung.mjs';

// Nur in der Demo: Beispielkurse in der Sprache der Anfrage anzeigen (die Datenbank haelt die deutsche Fassung).
const DEMO = () => demoUebersetzungAktiv();

const jetzt = () => new Date().toISOString();
const leererBody = body => body === undefined || (body !== null && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0);

const ARTEN = ['text', 'video', 'pdf', 'audio', 'datei'];
const STATUS = ['entwurf', 'veroeffentlicht']; // Lektionenstatus; Kurse unterstützen zusätzlich archiviert
const WAEHRUNGEN = ['huf', 'eur'];
const MAX_PREIS = 1_000_000_000;

// HUF: Stripe rechnet in HUF zwar mit zwei Dezimalstellen (Preis = Forint mal 100), verlangt aber bei Auszahlungen Beträge, die
// durch 100 teilbar sind (docs.stripe.com/currencies, Sonderfall HUF). Deshalb sind bei HUF nur ganze Forint erlaubt.
const hufUngueltig = (waehrung, preisCent) => waehrung === 'huf' && preisCent % 100 !== 0;

// Fehler von express.json (kaputtes JSON, zu großer Inhalt) als Code und ungarischer Text statt HTML ausgeben.
export function jsonFehler(err, _req, res, next) {
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') return fehler(res, 400, 'ungueltiges_json');
  next(err);
}

// ---- Wer fragt? ----------------------------------------------------------------------------
export function nurAdmin(req, res, next) {
  const benutzer = aktuellerBenutzer(req);
  if (!benutzer) return fehler(res, 401, 'nicht_angemeldet');
  if (benutzer.rolle !== 'admin') return fehler(res, 403, 'kein_admin');
  req.benutzer = benutzer;
  next();
}

const idAus = (wert) => (/^[1-9]\d{0,15}$/.test(String(wert)) ? Number(wert) : null);

// ---- Eingaben prüfen -------------------------------------------------------------------------
// Jede Prüfung liefert { ok: true, wert } oder { ok: false, code }.
const ok = (wert) => ({ ok: true, wert });
const nein = (code) => ({ ok: false, code });
const PRUEFER = {
  kategorie_id: v => v === null || (Number.isSafeInteger(v) && v > 0 && db.prepare('SELECT 1 FROM kategorien WHERE id=?').get(v)) ? ok(v) : nein('kategorie_ungueltig'),
  titel: (v) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 200 ? ok(v.trim()) : nein('titel_ungueltig')),
  beschreibung: (v) => (typeof v === 'string' && v.length <= 5000 ? ok(v) : nein('beschreibung_ungueltig')),
  preis_cent: (v) => (Number.isSafeInteger(v) && v >= 0 && v <= MAX_PREIS ? ok(v) : nein('preis_ungueltig')),
  waehrung: (v) => (WAEHRUNGEN.includes(v) ? ok(v) : nein('waehrung_ungueltig')),
  abschnitt: (v) => (typeof v === 'string' && v.length <= 200 ? ok(v.trim()) : nein('abschnitt_ungueltig')),
  art: (v) => (ARTEN.includes(v) ? ok(v) : nein('art_ungueltig')),
  reihenfolge: (v) => (Number.isSafeInteger(v) && v >= 0 && v <= 100000 ? ok(v) : nein('reihenfolge_ungueltig')),
  inhalt: (v) => (typeof v === 'string' && v.length <= 8000 ? ok(v) : nein('inhalt_ungueltig')),
  status: (v) => (STATUS.includes(v) ? ok(v) : nein('status_ungueltig')),
  abo_preis_cent: (v) => (v === null || (Number.isSafeInteger(v) && v > 0 && v <= MAX_PREIS) ? ok(v) : nein('abo_preis_ungueltig')),
  abo_intervall: (v) => (v === null || ['month', 'year'].includes(v) ? ok(v) : nein('abo_intervall_ungueltig')),
};

// Prüft den Body gegen eine Liste erlaubter Felder. Unbekannte Felder (zum Beispiel "rolle", "id", "erstellt") => Fehler.
// pflicht: Felder, die vorhanden sein müssen. Gibt { wert: {...} } oder { code } zurück.
function bodyPruefen(body, erlaubt, pflicht = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { code: 'body_ungueltig' };
  for (const k of Object.keys(body)) if (!erlaubt.includes(k)) return { code: 'unbekanntes_feld' };
  const wert = {};
  for (const feld of erlaubt) {
    if (body[feld] === undefined) {
      if (pflicht.includes(feld)) return { code: PRUEFER[feld]('').code ?? 'body_ungueltig' };
      continue;
    }
    const r = PRUEFER[feld](body[feld]);
    if (!r.ok) return { code: r.code };
    wert[feld] = r.wert;
  }
  return { wert };
}

// ---- Router ------------------------------------------------------------------------------------
export const kurseRouter = express.Router();

// Öffentlich: nur veröffentlichte Kurse
kurseRouter.get('/api/kurse', (req, res) => katalogListe(req, res, false));

// Ein Kurs. Entwürfe sieht nur ein Admin. Lektionen immer als Titelliste; Inhalt und Dateien nur mit Zugang (oder als Admin).
kurseRouter.get('/api/kurse/:id', (req, res) => {
  const id = idAus(req.params.id);
  if (!id) return fehler(res, 400, 'ungueltige_id');
  const benutzer = aktuellerBenutzer(req);
  const istAdmin = benutzer?.rolle === 'admin';
  const kurs = db.prepare('SELECT id, kategorie_id, titel, beschreibung, preis_cent, waehrung, abo_preis_cent, abo_intervall, nutzen, status, (titelbild_datei IS NOT NULL) AS hat_titelbild, (trailer_datei IS NOT NULL) AS hat_trailer FROM kurse WHERE id = ?').get(id);
  // Entwürfe sind für alle außer Admin "nicht gefunden" (verrät nicht, dass es sie gibt)
  if (!kurs || (!istAdmin && kurs.status !== 'veroeffentlicht' && !(kurs.status === 'archiviert' && gueltigerZugang(benutzer?.id ?? -1, id)))) return fehler(res, 404, 'nicht_gefunden');

  const zugang = istAdmin || (!!benutzer && gueltigerZugang(benutzer.id, id));
  // F-04 (Nachbesserung): Den TEXT einer Lektion bekommt ein Kunde nur ueber die Lektionsseite (?lektion=<id>), und nur fuer diese eine Lektion.
  // Kurs-/Verkaufsseite und Lektionsliste bekommen nur Kopfdaten (Titel, Art, Dateiliste). Der Admin sieht alle Texte.
  const lektionRoh = req.query?.lektion;
  const lektionId = lektionRoh === undefined ? null : idAus(Array.isArray(lektionRoh) ? '' : lektionRoh);
  if (lektionRoh !== undefined && !lektionId) return fehler(res, 400, 'ungueltige_id');
  const lektionen = db.prepare(
    `SELECT id, abschnitt, titel, art, reihenfolge, status, inhalt, download_erlaubt FROM lektionen
     WHERE kurs_id = ? ${istAdmin ? '' : "AND status = 'veroeffentlicht'"} ORDER BY reihenfolge, id`
  ).all(id);
  // ohne "pfad". Nur der Admin sieht zusaetzlich, ob die Datei lokal oder bei Bunny liegt und den Bunny-Status (Kunden bekommen diese Felder nie).
  const dateienStmt = db.prepare(istAdmin ? 'SELECT id, name, art, groesse, quelle, bunny_status FROM dateien WHERE lektion_id = ? ORDER BY id' : 'SELECT id, name, art, groesse FROM dateien WHERE lektion_id = ? ORDER BY id');
  const ausstehendStmt = istAdmin ? db.prepare('SELECT 1 FROM bunny_ausstehend WHERE lektion_id = ? AND uebernommen = 0') : null;

  const uebersetzen = DEMO();   // Nur Demo: der Demo-Admin ist reine Ansicht (alle Schreibwege 403), darum ist die Uebersetzung auch dort gefahrlos
  const kursAnzeige = (o) => (uebersetzen ? kursUebersetzt(o) : o);
  const lektionenAnzeige = (ls) => (uebersetzen ? lektionenUebersetzt(kurs.titel, ls) : ls);
  // F-04 (Gesamtpruefung): Sobald ein Kunde (nicht Admin) mit Zugang den TEXT einer Lektion erhaelt (Lektionsseite), ist der digitale Inhalt bereitgestellt.
  // Das zaehlt fuer den Widerruf wie das Oeffnen eines Videos oder PDFs (dateien.mjs). Titel/Metadaten ohne Text zaehlen nicht.
  // Block 3: Bei einer Download-Lektion ist die DATEI das Produkt; ihr Begleittext zaehlt nicht, erst der vollstaendige Download (dateien.mjs).
  if (!istAdmin && zugang && benutzer && lektionId && lektionen.some(l => l.id === lektionId && l.download_erlaubt !== 1 && typeof l.inhalt === 'string' && l.inhalt.trim() !== '')) erstenZugriffMerken(benutzer, kurs.id);
  res.json({
    ...kursAnzeige(istAdmin ? {...kurs,hat_titelbild:!!kurs.hat_titelbild,hat_trailer:!!kurs.hat_trailer} : { id: kurs.id, kategorie_id: kurs.kategorie_id, titel: kurs.titel, beschreibung: kurs.beschreibung, preis_cent: kurs.preis_cent, waehrung: kurs.waehrung, abo_preis_cent: kurs.abo_preis_cent, abo_intervall: kurs.abo_intervall, nutzen: kurs.nutzen, hat_titelbild: !!kurs.hat_titelbild, hat_trailer: !!kurs.hat_trailer }),
    zugang,
    lektionen: lektionenAnzeige(lektionen).map((l) => {
      const kopf = { id: l.id, abschnitt: l.abschnitt, titel: l.titel, art: l.art, reihenfolge: l.reihenfolge, ...(l.download_erlaubt === 1 ? { download: true } : {}), ...(istAdmin ? { status: l.status, bunny_ausstehend: !!ausstehendStmt.get(l.id) } : {}) };
      if (!zugang) return kopf;
      return istAdmin || l.id === lektionId ? { ...kopf, inhalt: l.inhalt, dateien: dateienStmt.all(l.id) } : { ...kopf, dateien: dateienStmt.all(l.id) };
    }),
  });
});

// ---- Admin -------------------------------------------------------------------------------------
// Alle Kurse (auch Entwürfe) für Gabriellas Übersicht, mit Anzahl der Lektionen.
kurseRouter.get('/api/admin/kurse', nurAdmin, (req, res) => katalogListe(req, res, true));

kurseRouter.post('/api/admin/kurse', nurAdmin, (req, res) => {
  const p = bodyPruefen(req.body, ['titel', 'beschreibung', 'preis_cent', 'waehrung', 'abo_preis_cent', 'abo_intervall', 'kategorie_id'], ['titel', 'preis_cent']);
  if (p.code) return fehler(res, 400, p.code);
  const k = { beschreibung: '', waehrung: 'huf', ...p.wert };
  if (hufUngueltig(k.waehrung, k.preis_cent)) return fehler(res, 400, 'preis_huf_teilbar');
  if ((k.abo_preis_cent == null) !== (k.abo_intervall == null)) return fehler(res, 400, 'abo_paar_ungueltig');
  if (k.abo_preis_cent != null && hufUngueltig(k.waehrung, k.abo_preis_cent)) return fehler(res, 400, 'preis_huf_teilbar');
  // N1: Ein Gratis-Kurs (Preis 0) bekommt kein Abo; sonst gäbe der Einmal-Kauf den Abo-Kurs umsonst.
  if (k.preis_cent === 0 && k.abo_preis_cent != null) return fehler(res, 400, 'gratis_ohne_abo');
  const zeit = jetzt();
  const r = db.prepare(
    `INSERT INTO kurse (titel, beschreibung, preis_cent, waehrung, abo_preis_cent, abo_intervall, kategorie_id, status, erstellt, geaendert) VALUES (?, ?, ?, ?, ?, ?, ?, 'entwurf', ?, ?)`
  ).run(k.titel, k.beschreibung, k.preis_cent, k.waehrung, k.abo_preis_cent ?? null, k.abo_intervall ?? null, k.kategorie_id ?? null, zeit, zeit);
  res.status(201).json(db.prepare('SELECT * FROM kurse WHERE id = ?').get(Number(r.lastInsertRowid)));
});

kurseRouter.patch('/api/admin/kurse/:id', nurAdmin, (req, res) => {
  const id = idAus(req.params.id);
  if (!id) return fehler(res, 400, 'ungueltige_id');
  const bisher = db.prepare('SELECT preis_cent, waehrung, abo_preis_cent, abo_intervall FROM kurse WHERE id = ?').get(id);
  if (!bisher) return fehler(res, 404, 'nicht_gefunden');
  // Der Status wird NICHT hier geändert, sondern nur über /veroeffentlichen.
  const p = bodyPruefen(req.body, ['titel', 'beschreibung', 'preis_cent', 'waehrung', 'abo_preis_cent', 'abo_intervall', 'kategorie_id']);
  if (p.code) return fehler(res, 400, p.code);
  const felder = Object.keys(p.wert);
  if (felder.length === 0) return fehler(res, 400, 'nichts_zu_aendern');
  if ((felder.includes('preis_cent') || felder.includes('waehrung')) && hufUngueltig(p.wert.waehrung ?? bisher.waehrung, p.wert.preis_cent ?? bisher.preis_cent)) return fehler(res, 400, 'preis_huf_teilbar');
  const aboPreis = p.wert.abo_preis_cent !== undefined ? p.wert.abo_preis_cent : bisher.abo_preis_cent;
  const aboIntervall = p.wert.abo_intervall !== undefined ? p.wert.abo_intervall : bisher.abo_intervall;
  if ((aboPreis == null) !== (aboIntervall == null)) return fehler(res, 400, 'abo_paar_ungueltig');
  if (aboPreis != null && hufUngueltig(p.wert.waehrung ?? bisher.waehrung, aboPreis)) return fehler(res, 400, 'preis_huf_teilbar');
  if ((felder.includes('preis_cent') || felder.includes('abo_preis_cent') || felder.includes('abo_intervall')) &&
      (p.wert.preis_cent ?? bisher.preis_cent) === 0 && aboPreis != null) return fehler(res, 400, 'gratis_ohne_abo');
  db.prepare(`UPDATE kurse SET ${felder.map((f) => `${f} = ?`).join(', ')}, geaendert = ? WHERE id = ?`)
    .run(...felder.map((f) => p.wert[f]), jetzt(), id);
  res.json(db.prepare('SELECT * FROM kurse WHERE id = ?').get(id));
});

kurseRouter.post('/api/admin/kurse/:id/veroeffentlichen', nurAdmin, (req, res) => {
  const id = idAus(req.params.id);
  if (!id) return fehler(res, 400, 'ungueltige_id');
  const r = db.prepare(`UPDATE kurse SET status = 'veroeffentlicht', geaendert = ? WHERE id = ?`).run(jetzt(), id);
  if (r.changes === 0) return fehler(res, 404, 'nicht_gefunden');
  res.json(db.prepare('SELECT * FROM kurse WHERE id = ?').get(id));
});

kurseRouter.post('/api/admin/kurse/:id/lektionen', nurAdmin, (req, res) => {
  const id = idAus(req.params.id);
  if (!id) return fehler(res, 400, 'ungueltige_id');
  const kursStatus = db.prepare('SELECT status FROM kurse WHERE id = ?').get(id)?.status;
  if (!kursStatus) return fehler(res, 404, 'nicht_gefunden');
  const p = bodyPruefen(req.body, ['titel', 'abschnitt', 'art', 'inhalt', 'reihenfolge', 'status'], ['titel']);
  if (p.code) return fehler(res, 400, p.code);
  // Block 4: In einem Kurs, den Kaeufer schon sehen (veroeffentlicht oder archiviert mit Bestandszugang), entsteht eine neue Lektion ohne
  // ausdrueckliche Angabe AUSGEBLENDET (Entwurf); der Admin gibt sie mit "Einblenden" frei. Im Entwurfskurs bleibt der Standard sichtbar,
  // denn dort sieht ohnehin noch niemand etwas. Bestehende Lektionen bleiben unveraendert (keine Migration noetig).
  const l = { abschnitt: '', art: 'text', inhalt: '', status: kursStatus === 'entwurf' ? 'veroeffentlicht' : 'entwurf', ...p.wert };
  const zeit = jetzt();
  // Ohne Angabe kommt die Lektion ans Ende. Lesen und Einfügen in einer Transaktion, damit zwei gleichzeitige Anfragen nicht dieselbe Nummer bekommen.
  const neu = transaktion(() => {
    const reihenfolge = l.reihenfolge ?? (db.prepare('SELECT COALESCE(MAX(reihenfolge), 0) + 1 AS n FROM lektionen WHERE kurs_id = ?').get(id).n);
    const r = db.prepare(
      `INSERT INTO lektionen (kurs_id, abschnitt, titel, art, inhalt, reihenfolge, status, erstellt, geaendert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, l.abschnitt, l.titel, l.art, l.inhalt, reihenfolge, l.status, zeit, zeit);
    return db.prepare('SELECT * FROM lektionen WHERE id = ?').get(Number(r.lastInsertRowid));
  });
  res.status(201).json(neu);
});

kurseRouter.patch('/api/admin/lektionen/:id', nurAdmin, (req, res) => {
  const id = idAus(req.params.id);
  if (!id) return fehler(res, 400, 'ungueltige_id');
  const bisher = db.prepare('SELECT art FROM lektionen WHERE id = ?').get(id);
  if (!bisher) return fehler(res, 404, 'nicht_gefunden');
  const p = bodyPruefen(req.body, ['titel', 'abschnitt', 'art', 'inhalt', 'reihenfolge', 'status']);
  if (p.code) return fehler(res, 400, p.code);
  const felder = Object.keys(p.wert);
  if (felder.length === 0) return fehler(res, 400, 'nichts_zu_aendern');
  // Der Typ einer Lektion bleibt, solange eine Datei daran hängt (sonst passte die Datei nicht mehr zum Typ)
  // Eine Lektion mit Datei ODER mit einem noch ausstehenden Bunny-Video darf ihre Art nicht wechseln (sonst haengt spaeter ein Video an einer Textlektion).
  if (p.wert.art !== undefined && p.wert.art !== bisher.art && (db.prepare('SELECT 1 FROM dateien WHERE lektion_id = ?').get(id) || db.prepare('SELECT 1 FROM bunny_ausstehend WHERE lektion_id = ? AND uebernommen = 0').get(id))) return fehler(res, 400, 'art_hat_datei');
  db.prepare(`UPDATE lektionen SET ${felder.map((f) => `${f} = ?`).join(', ')}, geaendert = ? WHERE id = ?`)
    .run(...felder.map((f) => p.wert[f]), jetzt(), id);
  res.json(db.prepare('SELECT * FROM lektionen WHERE id = ?').get(id));
});


kurseRouter.post('/api/admin/kurse/:id/archivieren', nurAdmin, (req, res) => {
  const id = idAus(req.params.id);
  if (!id) return fehler(res, 400, 'ungueltige_id');
  if (!leererBody(req.body)) return fehler(res, 400, 'body_ungueltig');
  const r = db.prepare("UPDATE kurse SET status = 'archiviert', geaendert = ? WHERE id = ?").run(jetzt(), id);
  if (!r.changes) return fehler(res, 404, 'nicht_gefunden');
  res.json(db.prepare('SELECT * FROM kurse WHERE id = ?').get(id));
});
kurseRouter.delete('/api/admin/kurse/:id', nurAdmin, async (req, res) => {
  if (!leererBody(req.body)) return fehler(res, 400, 'body_ungueltig');
  const id = idAus(req.params.id);
  if (!id) return fehler(res, 400, 'ungueltige_id');
  const kurs = db.prepare('SELECT status,titelbild_datei,trailer_datei FROM kurse WHERE id = ?').get(id);
  if (!kurs) return fehler(res, 404, 'nicht_gefunden');
  if (kurs.status !== 'entwurf' || db.prepare('SELECT 1 FROM zugaenge WHERE kurs_id = ?').get(id) ||
      db.prepare('SELECT 1 FROM bestellungen WHERE kurs_id = ?').get(id) ||
      db.prepare('SELECT 1 FROM abos WHERE kurs_id = ?').get(id))
    return fehler(res, 409, 'archivieren_statt_loeschen');
  const dateien = transaktion(() => {
    // Nochmals innerhalb der Transaktion prüfen.
    if (db.prepare("SELECT 1 FROM kurse WHERE id = ? AND status != 'entwurf'").get(id) ||
        db.prepare('SELECT 1 FROM zugaenge WHERE kurs_id = ?').get(id) ||
        db.prepare('SELECT 1 FROM bestellungen WHERE kurs_id = ?').get(id) ||
        db.prepare('SELECT 1 FROM abos WHERE kurs_id = ?').get(id)) throw new Error('Kurs inzwischen geschützt');
    const zeilen = db.prepare('SELECT d.pfad, d.quelle, d.bunny_video_id FROM dateien d JOIN lektionen l ON l.id = d.lektion_id WHERE l.kurs_id = ?').all(id);
    // Block 3: Download-Sprachfassungen (Kaskade loescht die Zeilen) auch vom Datentraeger entfernen.
    const varianten = db.prepare("SELECT v.pfad, 'lokal' AS quelle, NULL AS bunny_video_id FROM download_varianten v JOIN lektionen l ON l.id = v.lektion_id WHERE l.kurs_id = ?").all(id);
    db.prepare('DELETE FROM kurse WHERE id = ?').run(id);
    vormerken(zeilen);                                    // Bunny-Videos des Kurses zum Loeschen vormerken (gleiche Transaktion)
    return [...zeilen, ...varianten];
  });
  // Dateisystem erst NACH erfolgreichem Datenbank-COMMIT ändern.
  const { dateienNachCommitLoeschen } = await import('./dateien.mjs');
  await dateienNachCommitLoeschen(dateien);
  const { vorschauNachKursLoeschen } = await import('./vorschau.mjs');
  await vorschauNachKursLoeschen(req.app.locals.dateiOrdner,[kurs]);
  res.json({ geloescht: true });
});
kurseRouter.delete('/api/admin/lektionen/:id', nurAdmin, async (req, res) => {
  if (!leererBody(req.body)) return fehler(res, 400, 'body_ungueltig');
  const id = idAus(req.params.id);
  if (!id) return fehler(res, 400, 'ungueltige_id');
  const l = db.prepare('SELECT l.kurs_id, k.status, l.status AS lektion_status FROM lektionen l JOIN kurse k ON k.id = l.kurs_id WHERE l.id = ?').get(id);
  if (!l) return fehler(res, 404, 'nicht_gefunden');
  // Loeschbar ist eine Lektion, wenn der KURS noch Entwurf ist (nichts war je sichtbar) ODER die LEKTION selbst Entwurf ist (versteckt).
  // Frueher wurde nur l.status (= Kursstatus) geprueft: dann liess sich in einem veroeffentlichten Kurs keine versteckte Lektion loeschen.
  if (l.status !== 'entwurf' && l.lektion_status !== 'entwurf') return fehler(res, 409, 'lektion_verstecken_statt_loeschen');
  const dateien = transaktion(() => {
    const zeilen = db.prepare('SELECT pfad, quelle, bunny_video_id FROM dateien WHERE lektion_id = ?').all(id);
    const varianten = db.prepare("SELECT pfad, 'lokal' AS quelle, NULL AS bunny_video_id FROM download_varianten WHERE lektion_id = ?").all(id);   // Block 3
    db.prepare('DELETE FROM lektionen WHERE id = ?').run(id);
    vormerken(zeilen);                                    // Bunny-Video der Lektion zum Loeschen vormerken (gleiche Transaktion)
    return [...zeilen, ...varianten];
  });
  const { dateienNachCommitLoeschen } = await import('./dateien.mjs');
  await dateienNachCommitLoeschen(dateien);
  res.json({ geloescht: true });
});


kurseRouter.get('/api/admin/kurse/:id/zugaenge', nurAdmin, (req, res) => {
  const id = idAus(req.params.id);
  if (!id) return fehler(res, 400, 'ungueltige_id');
  if (!db.prepare('SELECT 1 FROM kurse WHERE id = ?').get(id)) return fehler(res, 404, 'nicht_gefunden');
  res.json(db.prepare(`SELECT z.benutzer_id, b.email, z.quelle, z.gueltig_bis, z.erstellt
    FROM zugaenge z JOIN benutzer b ON b.id = z.benutzer_id WHERE z.kurs_id = ? ORDER BY z.erstellt DESC`).all(id));
});
kurseRouter.post('/api/admin/kurse/:id/zugaenge', nurAdmin, async (req, res) => {
  const id = idAus(req.params.id);
  if (!id) return fehler(res, 400, 'ungueltige_id');
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || typeof body.email !== 'string' ||
      body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
    return fehler(res, 400, 'email_ungueltig');
  const email = body.email.trim().toLowerCase();
  const benutzer = db.prepare('SELECT id FROM benutzer WHERE email = ?').get(email);
  if (!db.prepare('SELECT 1 FROM kurse WHERE id = ?').get(id)) return fehler(res, 404, 'nicht_gefunden');
  if (!benutzer) return fehler(res, 404, 'benutzer_unbekannt');
  // U2/I5: Ein laufendes Abo wird zuerst bei Stripe beendet (sonst zahlt der Kunde weiter, obwohl der Zugang jetzt dauerhaft ist). Scheitert das, ändert sich nichts.
  // Hat der Kunde schon einen dauerhaften Zugang (nicht Abo), bleibt alles wie es ist: 409 ohne Stripe-Aufruf.
  const vorhanden = db.prepare('SELECT quelle FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ?').get(benutzer.id, id);
  if (vorhanden && vorhanden.quelle !== 'abo') return fehler(res, 409, 'zugang_vorhanden');
  let beendeteAbos = [];
  try { beendeteAbos = await laufendeAbosBeendenStripe(req.app.locals.kontoStripe, benutzer.id, id); }
  catch { console.warn('Einladung: Abo konnte bei Stripe nicht beendet werden'); return fehler(res, 502, 'stripe_abo_fehler'); }
  const hinzu = transaktion(() => {
    abosBeendetSetzen(beendeteAbos);
    const r = db.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, erstellt) VALUES (?, ?, 'einladung', ?) ON CONFLICT(benutzer_id,kurs_id) DO UPDATE SET quelle='einladung', gueltig_bis=NULL WHERE zugaenge.quelle='abo'").run(benutzer.id, id, jetzt());
    if (r.changes) db.prepare('INSERT INTO verwaltung_log (admin_id, aktion, kurs_id, benutzer_id, erstellt) VALUES (?, ?, ?, ?, ?)').run(req.benutzer.id, 'zugang_geben', id, benutzer.id, jetzt());
    if (r.changes) req.app.locals.zugangMailVormerken?.(benutzer.id, id);   // Block 4: Benachrichtigung an den Kunden (gleiche Transaktion)
    return r.changes;
  });
  if (!hinzu) return fehler(res, 409, 'zugang_vorhanden');
  req.app.locals.zugangNachCommitSenden?.();
  res.status(201).json({ ok: true });
});
kurseRouter.delete('/api/admin/kurse/:id/zugaenge/:benutzerId', nurAdmin, async (req, res) => {
  if (!leererBody(req.body)) return fehler(res, 400, 'body_ungueltig');
  const id = idAus(req.params.id), benutzerId = idAus(req.params.benutzerId);
  if (!id || !benutzerId) return fehler(res, 400, 'ungueltige_id');
  if (!db.prepare('SELECT 1 FROM zugaenge WHERE kurs_id = ? AND benutzer_id = ?').get(id, benutzerId)) return fehler(res, 404, 'nicht_gefunden');
  // F1: Ein laufendes Abo wird zuerst bei Stripe beendet. Scheitert das, bleibt ALLES wie es ist und der Admin sieht einen Fehler
  // (sonst bucht Stripe weiter ab, und die naechste Zahlung gaebe den Zugang zurueck).
  const abos = db.prepare("SELECT id, stripe_abo FROM abos WHERE kurs_id = ? AND benutzer_id = ? AND status != 'beendet'").all(id, benutzerId);
  try {
    for (const a of abos) await aboBeiStripeBeenden(req.app.locals.kontoStripe, a.stripe_abo);
  } catch {
    console.warn('Admin-Entzug: Abo konnte bei Stripe nicht beendet werden');
    return fehler(res, 502, 'stripe_abo_fehler');
  }
  const geloescht = transaktion(() => {
    const r = db.prepare('DELETE FROM zugaenge WHERE kurs_id = ? AND benutzer_id = ?').run(id, benutzerId);
    for (const a of abos) db.prepare("UPDATE abos SET status = 'beendet', geaendert = ? WHERE id = ?").run(jetzt(), a.id);
    if (r.changes) db.prepare('INSERT INTO verwaltung_log (admin_id, aktion, kurs_id, benutzer_id, erstellt) VALUES (?, ?, ?, ?, ?)').run(req.benutzer.id, 'zugang_entziehen', id, benutzerId, jetzt());
    return r.changes;
  });
  if (!geloescht) return fehler(res, 404, 'nicht_gefunden');
  res.json({ ok: true });
});
kurseRouter.get('/api/admin/kurse/:id/abos', nurAdmin, (req,res) => {
  const id=idAus(req.params.id);
  if (!id) return fehler(res,400,'ungueltige_id');
  if (!db.prepare('SELECT 1 FROM kurse WHERE id=?').get(id)) return fehler(res,404,'nicht_gefunden');
  res.json(db.prepare('SELECT a.id,b.email,a.status,a.gueltig_bis,a.endet_zum_periodenende,a.erstellt FROM abos a JOIN benutzer b ON b.id=a.benutzer_id WHERE a.kurs_id=? ORDER BY a.id DESC').all(id));
});
// Unerwartete Fehler: kein Absturz, nur ein allgemeiner Code (Details nur im Server-Log)
export function kurseFehlerBehandlung(err, _req, res, next) {
  if (res.headersSent) return next(err);
  console.error('Kurs-API fehlgeschlagen:', err.code || err.name || 'unbekannt');
  return fehler(res, 500, 'serverfehler');
}

// Paginierte Standardlisten vollständig in SQL; Suche/Name/Demo nutzen Anzeige-Texte.
function katalogListe(req, res, admin) {
  const roh = new URL(req.originalUrl, 'http://katalog.local').searchParams;
  const erlaubt = ['q', 'kategorie', 'preis', 'sort', 'seite', 'pro_seite', 'lang', ...(admin ? ['status'] : [])];
  // F-295: unbekannte Parameter (Cache-Breaker wie ?_=..., Tracking wie ?utm_source=...) werden ignoriert statt
  // mit 400 abgelehnt, damit geteilte/markierte Katalog-Links nie auf einer Fehlerseite landen.
  const parameter = new URLSearchParams();
  for (const key of erlaubt) {
    const werte = roh.getAll(key);
    if (werte.length > 1) return fehler(res, 400, 'katalog_parameter_ungueltig');
    if (werte.length === 1) parameter.set(key, werte[0]);
  }
  const aktiv = [...parameter.keys()].some(k => k !== 'lang');
  const q = parameter.get('q') ?? '';
  const preis = parameter.get('preis') ?? 'alle';
  const sort = parameter.get('sort') ?? 'neu';
  const status = parameter.get('status') ?? 'alle';
  const seiteText = parameter.get('seite') ?? '1';
  if ([...q].length > 100 || !['alle','gratis','bezahlt'].includes(preis) ||
      !['neu','preis_auf','preis_ab','name'].includes(sort) ||
      !['alle','entwurf','veroeffentlicht','archiviert','freigabe_offen'].includes(status) ||
      !/^[1-9]\d{0,4}$/.test(seiteText) || Number(seiteText) > 10000 ||
      (parameter.has('pro_seite') && parameter.get('pro_seite') !== '12')) return fehler(res, 400, 'katalog_parameter_ungueltig');
  const where = [], werte = [];
  if (!admin || status !== 'alle') { where.push('k.status = ?'); werte.push(admin ? status : 'veroeffentlicht'); }
  if (parameter.has('kategorie')) {
    const id = idAus(parameter.get('kategorie'));
    if (!Number.isSafeInteger(id) || !db.prepare('SELECT 1 FROM kategorien WHERE id=?').get(id)) return fehler(res,400,'kategorie_ungueltig');
    where.push('k.kategorie_id = ?'); werte.push(id);
  }
  if (preis !== 'alle') where.push(preis === 'gratis' ? 'k.preis_cent = 0' : 'k.preis_cent > 0');
  const extra = admin ? ', k.status, k.erstellt, k.geaendert, (SELECT COUNT(*) FROM lektionen l WHERE l.kurs_id=k.id) AS lektionen' : '';
  const demo = DEMO();
  const schnell = aktiv && !q && sort !== 'name' && !demo;
  const bedingung = where.length ? 'WHERE '+where.join(' AND ') : '';
  const ordnung = schnell ? (sort === 'neu' ? 'k.id DESC' : `k.preis_cent ${sort === 'preis_auf' ? 'ASC' : 'DESC'}, k.id ASC`) : `k.id ${admin ? 'DESC' : 'ASC'}`;
  if (schnell) {
    const gesamt = db.prepare(`SELECT COUNT(*) AS n FROM kurse k ${bedingung}`).get(...werte).n;
    const seite = gesamt === 0 ? 1 : Number(seiteText);
    const kurse = lesen('LIMIT 12 OFFSET ?', (seite-1)*12);
    return res.json({kurse, gesamt, seite, pro_seite:12, seiten:Math.ceil(gesamt/12)});
  }
  // Harte Grenze nur für paginierte Suche/Name/Demo: 5001 erkennen Überlauf;
  // ausschließlich die ersten 5000 Kandidaten in stabiler ID-Reihenfolge auswerten.
  let kurse = lesen(aktiv ? 'LIMIT 5001' : '');
  const abgeschnitten = aktiv && kurse.length > 5000;
  if (abgeschnitten) kurse.length = 5000;
  if (demo) kurse = kurse.map(k => kursUebersetzt(k));
  function lesen(limit, ...seitenWerte) {
    return db.prepare(`SELECT k.id, k.kategorie_id, k.titel, k.beschreibung, k.preis_cent, k.waehrung, k.abo_preis_cent, k.abo_intervall, k.nutzen,
    (k.titelbild_datei IS NOT NULL) AS hat_titelbild, (k.trailer_datei IS NOT NULL) AS hat_trailer
    ${admin ? ", k.beispiel_key" : ""} ${extra} FROM kurse k ${bedingung} ORDER BY ${ordnung} ${limit}`).all(...werte, ...seitenWerte)
      .map(k => ({...k, hat_titelbild: !!k.hat_titelbild, hat_trailer: !!k.hat_trailer}));
  }
  if (!aktiv) return res.json(kurse);
  const normal = v => v.normalize('NFC').toLocaleLowerCase('und');
  if (q) { const suche = normal(q); kurse = kurse.filter(k => normal(k.titel).includes(suche) || normal(k.beschreibung).includes(suche)); }
  kurse.sort((a,b) => {
    if (sort === 'neu') return b.id-a.id;
    const vergleich = sort === 'name' ? a.titel.localeCompare(b.titel, sprache()) : sort === 'preis_auf' ? a.preis_cent-b.preis_cent : b.preis_cent-a.preis_cent;
    return vergleich || a.id-b.id;
  });
  const gesamt = kurse.length, seite = gesamt === 0 ? 1 : Number(seiteText);
  return res.json({kurse: kurse.slice((seite-1)*12, seite*12), gesamt, seite, pro_seite:12, seiten:Math.ceil(gesamt/12), ...(abgeschnitten ? {abgeschnitten:true} : {})});
}
