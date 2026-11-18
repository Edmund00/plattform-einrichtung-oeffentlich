import { istStripeTestKey } from './feldregeln.mjs';

let db = null;
let stripeKey = '';

export function setzeTestkaufDb(d) { db = d; }
export function setzeTestkaufStripeKey(k) { stripeKey = String(k ?? ''); }

const emailMask = e => {
  const [v, d] = String(e || '').split('@');
  return v && d ? v.slice(0, 2) + '***@' + d : '***';
};

function leseEinstellung(schluessel) {
  const row = db.prepare('SELECT wert FROM einstellungen WHERE schluessel = ?').get(schluessel);
  return row ? row.wert : null;
}

export function testkaufStatus() {
  if (!istStripeTestKey(stripeKey)) {
    return { status: 'nicht_moeglich', grund: 'kein_testschluessel', bestellungen: [] };
  }

  const marker = leseEinstellung('einrichtung_abgeschlossen_am');
  if (!marker) {
    return { status: 'nicht_moeglich', grund: 'kein_marker', bestellungen: [] };
  }

  const auswahl = `
    SELECT b.id, b.erstellt, b.betrag, b.waehrung,
           u.email,
           k.titel AS kurs_titel,
           CASE WHEN z.benutzer_id IS NOT NULL THEN 1 ELSE 0 END AS zugang_vorhanden
    FROM bestellungen b
    LEFT JOIN benutzer u ON u.id = b.benutzer_id
    LEFT JOIN kurse k ON k.id = b.kurs_id
    LEFT JOIN zugaenge z ON z.benutzer_id = b.benutzer_id AND z.kurs_id = b.kurs_id
      AND (z.gueltig_bis IS NULL OR z.gueltig_bis > ?)
    WHERE b.status = 'bezahlt' AND b.erstellt > ?
  `;
  const jetzt = Date.now();
  const rows = db.prepare(auswahl + " ORDER BY b.id DESC LIMIT 5").all(jetzt, marker);
  const nachweisRow = db.prepare(auswahl + " AND z.benutzer_id IS NOT NULL ORDER BY b.id DESC LIMIT 1").get(jetzt, marker);

  const darstellen = r => ({
    id: r.id,
    erstellt: r.erstellt,
    betrag: r.betrag,
    waehrung: r.waehrung,
    email: emailMask(r.email),
    kurs: r.kurs_titel,
    zugang_vorhanden: r.zugang_vorhanden === 1,
  });
  const bestellungen = rows.map(darstellen);
  const nachweis = nachweisRow ? darstellen(nachweisRow) : null;
  const bestanden = !!nachweis;

  const kursAnzahl = db.prepare(
    "SELECT COUNT(*) AS n FROM kurse WHERE beispiel_key IS NULL AND status='veroeffentlicht'"
  ).get().n;
  if (!bestanden && kursAnzahl === 0) {
    return { status: 'nicht_moeglich', grund: 'kein_veroeffentlichter_kurs', marker, bestellungen: [] };
  }

  return {
    status: bestanden ? 'bestanden' : 'offen',
    marker,
    kurs_anzahl: kursAnzahl,
    bestellungen,
    nachweis,
  };
}
