// Admin: Übersicht der Bestellungen, vor allem die "pruefen"-Fälle (bezahlt, aber nicht zum Kurspreis passend, kein Zugang vergeben).
import express from 'express';
import { db, transaktion } from './db.mjs';
import { fehler } from './texte.mjs';
import { titelUebersetzt, beschreibungUebersetzt } from './demo-uebersetzung.mjs';
import { nurAdmin } from './routes-kurse.mjs';
import { kaufVormerken } from './mail.mjs';
import { laufendeAbosBeendenStripe, abosBeendetSetzen } from './abo.mjs';
import { ereignisHinzufuegen, ereignisseNachCommit, ganzeEinheiten } from './ereignis-liste.mjs';
import { stepupGueltig } from './auth.mjs';

const STATUS = ['bezahlt', 'pruefen', 'erstattet', 'abgelehnt'];
// Backlog a: administrativ erledigte Widerrufe (ellallas_erledigt) zaehlen nicht mehr als offen. Gilt fuer Liste UND Kennzahl (gleiche Bedingung).
const NICHT_ERLEDIGT = 'NOT EXISTS (SELECT 1 FROM ellallas_erledigt x WHERE x.bestellung_id = e.bestellung_id)';
// Refund-Failed (12.11.2026): von Stripe nachtraeglich als fehlgeschlagen/abgebrochen gemeldete Erstattungen (erstattung_fehler, offen) zaehlen ebenfalls als offen,
// eine Zeile je Stripe-Erstattung, gleiche Bedingung fuer Liste UND Kennzahl. Sie verschwinden, sobald Stripe dieselbe Erstattung spaeter als erfolgreich meldet
// oder eine neue erfolgreiche Erstattung mindestens in dieser Hoehe kommt. Der Abschluss "ohne Erstattung" (ellallas_erledigt) gilt nur fuer Widerrufe, deren
// Erstattung schon beim Anlegen scheiterte (ellallas.ergebnis 'fehler'); fuer diese Zeilen gibt es ihn bewusst nicht (docs/OFFENE-RISIKEN.md).
const STRIPE_FEHLER_OFFEN = "f.status IN ('fehlgeschlagen','abgebrochen')";

export const bestellungenRouter = express.Router();

// GET /api/admin/kennzahlen: Management-Uebersicht (nur Zahlen, keine personenbezogenen Daten)
bestellungenRouter.get('/api/admin/kennzahlen', nurAdmin, (req, res) => {
  const einzel = (sql) => db.prepare(sql).get();
  res.json({
    modus: req.app.locals.abgleichModus === 'live' ? 'live' : 'test',
    // F-92: Umsatz ohne Erstattungen: Teilerstattungen (erstattet_betrag) werden abgezogen, ganze kleinste Einheiten je Waehrung (kein Gleitkomma).
    umsatz: db.prepare("SELECT waehrung, COALESCE(SUM(betrag - MIN(erstattet_betrag, betrag)),0) AS cent FROM bestellungen WHERE status='bezahlt' GROUP BY waehrung").all(),
    bestellungen: einzel("SELECT COUNT(*) AS n FROM bestellungen WHERE status='bezahlt'").n,
    teilnehmer: einzel("SELECT COUNT(DISTINCT benutzer_id) AS n FROM zugaenge WHERE gueltig_bis IS NULL OR gueltig_bis > strftime('%s','now')*1000").n,
    erstattungen: einzel("SELECT COUNT(*) AS n FROM bestellungen WHERE status='erstattet'").n,
    offen: einzel("SELECT (SELECT COUNT(*) FROM bestellungen WHERE status='pruefen') + (SELECT COUNT(*) FROM ellallas e WHERE e.ergebnis IN ('bearbeitung','fehler') AND " + NICHT_ERLEDIGT + ")"
      + " + (SELECT COUNT(*) FROM erstattung_fehler f JOIN bestellungen b ON b.id = f.bestellung_id WHERE " + STRIPE_FEHLER_OFFEN + ") AS n").n,
    kurse: einzel("SELECT COUNT(*) AS n FROM kurse WHERE beispiel_key IS NULL AND status='veroeffentlicht'").n,
  });
});

// GET /api/admin/bestellungen            alle (neueste zuerst, höchstens 200)
// GET /api/admin/bestellungen?status=pruefen   nur die zu prüfenden
bestellungenRouter.get('/api/admin/bestellungen', nurAdmin, (req, res) => {
  for (const k of Object.keys(req.query)) if (k !== 'status') return fehler(res, 400, 'unbekanntes_feld');
  const status = req.query.status;
  if (status !== undefined && !STATUS.includes(status)) return fehler(res, 400, 'status_ungueltig');
  const zeilen = db.prepare(
    `SELECT b.id, b.stripe_sitzung, b.zahlung_id, b.benutzer_id, u.email AS benutzer_email, b.kurs_id, k.titel AS kurs_titel,
            b.betrag, b.waehrung, b.art, b.status, b.grund, b.erstellt, b.geaendert
     FROM bestellungen b LEFT JOIN benutzer u ON u.id = b.benutzer_id LEFT JOIN kurse k ON k.id = b.kurs_id
     ${status ? 'WHERE b.status = ?' : ''} ORDER BY b.id DESC LIMIT 200`
  ).all(...(status ? [status] : []));
  res.json(zeilen.map(z => ({ ...z, kurs_titel: titelUebersetzt(z.kurs_titel) })));
});

// GET /api/admin/widerrufe: offene Widerrufe (Erstattung in Bearbeitung oder fehlgeschlagen), die in "Offene Pruefungen" mitzaehlen (Block 4).
// Nur lesend, nur Admin. Enthaelt E-Mail-Adressen: im Demo-Modus fuer den Demo-Admin gesperrt (demo.mjs, ADMIN_LESEN_GESPERRT).
bestellungenRouter.get('/api/admin/widerrufe', nurAdmin, (req, res) => {
  if (Object.keys(req.query).length) return fehler(res, 400, 'unbekanntes_feld');
  // quelle 'widerruf' (ellallas) oder 'stripe_refund_failed' (erstattung_fehler: ergebnis 'stripe_refund_failed', Betrag/Waehrung der fehlgeschlagenen Erstattung).
  const zeilen = db.prepare(
    `SELECT * FROM (
       SELECT e.bestellung_id, e.zeit, e.ergebnis, e.aktualisiert, b.betrag, b.waehrung, b.art, b.kurs_id, k.titel AS kurs_titel, u.email AS benutzer_email,
              'widerruf' AS quelle, NULL AS refund_id
       FROM ellallas e JOIN bestellungen b ON b.id = e.bestellung_id LEFT JOIN benutzer u ON u.id = b.benutzer_id LEFT JOIN kurse k ON k.id = b.kurs_id
       WHERE e.ergebnis IN ('bearbeitung','fehler') AND ${NICHT_ERLEDIGT}
       UNION ALL
       SELECT f.bestellung_id, f.zeit, 'stripe_refund_failed', f.zeit, COALESCE(f.betrag, b.betrag), COALESCE(f.waehrung, b.waehrung), b.art, b.kurs_id, k.titel, u.email,
              'stripe_refund_failed', f.refund_id
       FROM erstattung_fehler f JOIN bestellungen b ON b.id = f.bestellung_id LEFT JOIN benutzer u ON u.id = b.benutzer_id LEFT JOIN kurse k ON k.id = b.kurs_id
       WHERE ${STRIPE_FEHLER_OFFEN}
     ) ORDER BY zeit DESC, bestellung_id DESC LIMIT 200`
  ).all();
  res.json(zeilen.map(z => ({ ...z, kurs_titel: titelUebersetzt(z.kurs_titel) })));
});

// Backlog a (12.11.2026): GET /api/admin/widerrufe/erledigt: administrativ ohne Erstattung abgeschlossene Widerrufe (Zeitpunkt, Bearbeiter, Begruendung).
// 'ergebnis' ist weiter der UNVERAENDERTE Stripe-Erstattungsstatus (fehler), die Erledigung steht getrennt in erledigt_*. Im Demo-Modus gesperrt (Pfad beginnt mit /api/admin/widerrufe).
bestellungenRouter.get('/api/admin/widerrufe/erledigt', nurAdmin, (req, res) => {
  if (Object.keys(req.query).length) return fehler(res, 400, 'unbekanntes_feld');
  const zeilen = db.prepare(
    `SELECT e.bestellung_id, e.zeit, e.ergebnis, b.betrag, b.waehrung, b.art, b.kurs_id, k.titel AS kurs_titel, u.email AS benutzer_email,
            x.zeit AS erledigt_zeit, x.admin_id AS erledigt_admin_id, a.email AS erledigt_admin_email, x.begruendung AS erledigt_begruendung,
            x.fallreferenz AS erledigt_fallreferenz, x.stripe_geprueft AS erledigt_stripe_geprueft
     FROM ellallas_erledigt x JOIN ellallas e ON e.bestellung_id = x.bestellung_id JOIN bestellungen b ON b.id = e.bestellung_id
     LEFT JOIN benutzer u ON u.id = b.benutzer_id LEFT JOIN kurse k ON k.id = b.kurs_id LEFT JOIN benutzer a ON a.id = x.admin_id
     ORDER BY x.zeit DESC, x.bestellung_id DESC LIMIT 200`
  ).all();
  res.json(zeilen.map(z => ({ ...z, kurs_titel: titelUebersetzt(z.kurs_titel) })));
});

// Backlog a: POST /api/admin/widerrufe/:id/erledigt { begruendung, fallreferenz, stripe_geprueft }: Widerruf mit FEHLGESCHLAGENER Erstattung administrativ abschliessen.
// Backlog c (12.11.2026): fallreferenz Pflicht (3..100 Zeichen, eine Zeile, keine Steuerzeichen), stripe_geprueft muss genau true sein (Pflicht-Checkbox im Formular).
// Aendert NUR ellallas_erledigt und das Verwaltungsprotokoll: kein Stripe-Aufruf, keine Aenderung an ellallas (Erstattungsstatus), Bestellung oder Zugang.
// Nur ergebnis 'fehler'. 'bearbeitung' wird abgelehnt (409): dort laeuft die automatische Wiederaufnahme noch und koennte die Erstattung doch ausfuehren
// (nach 6 Stunden ohne Erfolg setzt haengendeEllallasRetten die Zeile auf 'fehler', dann ist die Erledigung moeglich).
const BEGRUENDUNG_MIN = 5, BEGRUENDUNG_MAX = 500;
const STEUERZEICHEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const FALLREFERENZ_MIN = 3, FALLREFERENZ_MAX = 100;
const STEUERZEICHEN_ZEILE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;   // Fallreferenz ist eine Zeile: auch kein Tab oder Zeilenumbruch
const FELDER_ERLEDIGT = ['begruendung', 'fallreferenz', 'stripe_geprueft'];
bestellungenRouter.post('/api/admin/widerrufe/:id/erledigt', nurAdmin, (req, res) => {
  if (!stepupGueltig(req)) return fehler(res, 401, 'stepup_noetig');
  res.setHeader('Cache-Control', 'no-store');
  const id = idAus(req.params.id);
  if (!id) return fehler(res, 404, 'nicht_gefunden');
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => !FELDER_ERLEDIGT.includes(k)) || typeof body.begruendung !== 'string')
    return fehler(res, 400, 'widerruf_begruendung');
  const begruendung = body.begruendung.trim();
  const laenge = [...begruendung].length;
  if (laenge < BEGRUENDUNG_MIN || laenge > BEGRUENDUNG_MAX || STEUERZEICHEN.test(begruendung)) return fehler(res, 400, 'widerruf_begruendung');
  if (typeof body.fallreferenz !== 'string') return fehler(res, 400, 'widerruf_fallreferenz');
  const fallreferenz = body.fallreferenz.trim();
  const refLaenge = [...fallreferenz].length;
  if (refLaenge < FALLREFERENZ_MIN || refLaenge > FALLREFERENZ_MAX || STEUERZEICHEN_ZEILE.test(fallreferenz)) return fehler(res, 400, 'widerruf_fallreferenz');
  if (body.stripe_geprueft !== true) return fehler(res, 400, 'widerruf_stripe_geprueft');
  const zeit = new Date().toISOString();
  // Alles in EINER Transaktion: Pruefung und Eintrag koennen nicht von einem parallelen Aufruf ueberholt werden (zweiter Aufruf: 409).
  const ergebnis = transaktion(() => {
    const e = db.prepare('SELECT e.bestellung_id, e.ergebnis, b.kurs_id, b.benutzer_id FROM ellallas e JOIN bestellungen b ON b.id = e.bestellung_id WHERE e.bestellung_id = ?').get(id);
    if (!e) return 'nicht_gefunden';
    if (db.prepare('SELECT 1 FROM ellallas_erledigt WHERE bestellung_id = ?').get(id)) return 'widerruf_schon_erledigt';
    if (e.ergebnis === 'bearbeitung') return 'widerruf_laeuft_noch';
    if (e.ergebnis !== 'fehler') return 'widerruf_nicht_offen';
    const r = db.prepare('INSERT OR IGNORE INTO ellallas_erledigt (bestellung_id, zeit, admin_id, begruendung, fallreferenz, stripe_geprueft) VALUES (?, ?, ?, ?, ?, 1)').run(id, zeit, req.benutzer.id, begruendung, fallreferenz);
    if (!r.changes) return 'widerruf_schon_erledigt';
    db.prepare('INSERT INTO verwaltung_log (admin_id, aktion, kurs_id, benutzer_id, bestellung_id, erstellt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.benutzer.id, 'widerruf_erledigt', e.kurs_id, e.benutzer_id, id, zeit);
    return 'ok';
  });
  if (ergebnis === 'nicht_gefunden') return fehler(res, 404, 'nicht_gefunden');
  if (ergebnis !== 'ok') return fehler(res, 409, ergebnis);
  res.json({ bestellung_id: id, erledigt_zeit: zeit, erledigt_admin_id: req.benutzer.id, fallreferenz, stripe_geprueft: true, ergebnis: 'fehler' });
});

const idAus = (v) => /^[1-9]\d{0,15}$/.test(String(v)) ? Number(v) : null;
for (const [aktion, status] of [['freigeben', 'bezahlt'], ['ablehnen', 'abgelehnt']]) {
  bestellungenRouter.post('/api/admin/bestellungen/:id/' + aktion, nurAdmin, async (req, res) => {
    const id = idAus(req.params.id);
    if (!id) return fehler(res, 400, 'ungueltige_id');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)
      return fehler(res, 400, 'body_ungueltig');
    const b = db.prepare('SELECT * FROM bestellungen WHERE id = ?').get(id);
    if (!b) return fehler(res, 404, 'nicht_gefunden');
    if (b.status !== 'pruefen') return fehler(res, 409, 'bestellung_nicht_pruefen');
    if (b.art === 'abo' && status === 'bezahlt') return fehler(res, 409, 'abo_nur_stripe_freigabe');
    if (status === 'bezahlt' && (!b.kurs_id || !b.benutzer_id ||
        !db.prepare('SELECT 1 FROM kurse WHERE id = ?').get(b.kurs_id) ||
        !db.prepare('SELECT 1 FROM benutzer WHERE id = ?').get(b.benutzer_id)))
      return fehler(res, 409, 'bestellung_kein_ziel');
    // U2/I5: Eine Freigabe macht den Zugang dauerhaft, eine abgelehnte Abo-Zahlung soll nicht weiterlaufen: in beiden Fällen wird ein laufendes Abo zuerst bei Stripe
    // beendet. Scheitert das, ändert sich nichts (502), sonst bucht Stripe weiter ab.
    let beendeteAbos = [];
    if (status === 'bezahlt' || b.art === 'abo') {
      try { beendeteAbos = await laufendeAbosBeendenStripe(req.app.locals.kontoStripe, b.benutzer_id, b.kurs_id, status === 'abgelehnt' ? b : null); }
      catch { console.warn('Bestellung ' + aktion + ': Abo konnte bei Stripe nicht beendet werden'); return fehler(res, 502, 'stripe_abo_fehler'); }
    }
    const zeit = new Date().toISOString();
    const geaendert = transaktion(() => {
      const r = db.prepare("UPDATE bestellungen SET status = ?, geaendert = ? WHERE id = ? AND status = 'pruefen'").run(status, zeit, id);
      if (!r.changes) return false;
      abosBeendetSetzen(beendeteAbos);
      if (status === 'bezahlt')
        db.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, erstellt) VALUES (?, ?, 'zahlung', ?) ON CONFLICT(benutzer_id,kurs_id) DO UPDATE SET quelle='zahlung', gueltig_bis=NULL WHERE zugaenge.quelle='abo'").run(b.benutzer_id, b.kurs_id, zeit);   // wie im Webhook: ein befristeter Abo-Zugang wird durch eine bezahlte Einmalzahlung dauerhaft
      // L4: Auch eine freigegebene Prüfzahlung bekommt die Kaufmail (Bestätigung und Widerrufs-Pflichtangaben).
      if(status==='bezahlt')kaufVormerken(b.benutzer_id,b.id,'kauf');
      if(status==='bezahlt')ereignisHinzufuegen('gekauft','bestellung:'+b.id,{
        kurs_id:b.kurs_id,benutzer_id:b.benutzer_id,betrag:ganzeEinheiten(b.betrag),
        waehrung:b.waehrung,status:'bezahlt'});
      db.prepare('INSERT INTO verwaltung_log (admin_id, aktion, kurs_id, benutzer_id, bestellung_id, erstellt) VALUES (?, ?, ?, ?, ?, ?)')
        .run(req.benutzer.id, aktion, b.kurs_id, b.benutzer_id, b.id, zeit);
      return true;
    });
    if (!geaendert) return fehler(res, 409, 'bestellung_nicht_pruefen');
    res.json({ id, status });
    ereignisseNachCommit();
    if (status === 'bezahlt') req.app.locals.kaufMailSenden?.();
  });
}
