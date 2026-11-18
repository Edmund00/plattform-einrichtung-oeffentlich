// Datenauskunft (Download der Kundin): Schlüssel und Werte auf Ungarisch. Die Datenbank bleibt unverändert, nur die Ausgabe wird übersetzt.
import { HU } from './texte.mjs';

const KEY = Object.freeze({
  daten: 'adatok', bestellungen: 'rendelesek', zugaenge: 'hozzaferesek', vorherige_emails: 'korabbi_email_cimek',
  erklaerungen: 'elallasi_nyilatkozatok', zustimmungen: 'hozzajarulasok', erste_zugriffe: 'elso_hozzaferesek',
  id: 'azonosito', email: 'email_cim', erstellt: 'letrehozva', email_bestaetigt: 'email_megerositve',
  anzeigename: 'megjelenitett_nev', rechnung_name: 'szamlazasi_nev', rechnung_land: 'szamlazasi_orszag',
  rechnung_plz: 'szamlazasi_iranyitoszam', rechnung_ort: 'szamlazasi_telepules', rechnung_strasse: 'szamlazasi_utca',
  rechnung_steuernr: 'szamlazasi_adoszam', betrag: 'osszeg', waehrung: 'penznem', status: 'allapot', grund: 'ok',
  art: 'tipus', kurs: 'eloadas', kurs_id: 'eloadas_azonosito', ellallas_ergebnis: 'elallas_eredmeny',
  abo_id: 'elofizetes_azonosito', abo_status: 'elofizetes_allapot', endet_zum_periodenende: 'lemondva_idoszak_vegere',
  abo_ende: 'elofizetes_vege', titel: 'cim', gueltig_bis: 'ervenyes_eddig', bis: 'eddig',
  bestellung_id: 'rendeles_azonosito', zeit: 'idopont', ergebnis: 'eredmeny', hinweis: 'megjegyzes',
  einwilligung_zeit: 'hozzajarulas_idopontja', einwilligung_version: 'hozzajarulas_szovegverzioja',
  text_version: 'szoveg_verzioja', erster_zugriff: 'elso_hozzaferes',
  downloads: 'letoltesek', lektion_id: 'lecke_azonosito', sprache: 'nyelv',
  erstattung_fehlgeschlagen: 'visszaterites_sikertelen',
  // Refund-Failed (12.11.2026): von Stripe gemeldete fehlgeschlagene Erstattungen (status: fehlgeschlagen/abgebrochen/erfolgreich/ersetzt)
  fehlgeschlagene_erstattungen: 'sikertelen_visszateritesek', refund_id: 'visszaterites_azonosito', geloest: 'megoldva',
});
// Felder, deren Wert ein interner Code ist (Zahlen, Zeiten, E-Mail-Adressen und Titel bleiben unverändert).
const CODEFELDER = new Set(['status', 'grund', 'art', 'ellallas_ergebnis', 'abo_status', 'ergebnis', 'hinweis']);

function wert(schluessel, v) {
  if (v === null || v === undefined) return v;
  if (schluessel === 'waehrung') return String(v).toUpperCase();
  if (CODEFELDER.has(schluessel) && typeof v === 'string') return HU['auskunft_wert_' + v] ?? HU.a_ismeretlen;
  return v;
}

export function auskunftUngarisch(x) {
  if (Array.isArray(x)) return x.map(auskunftUngarisch);
  if (x && typeof x === 'object') {
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [
      KEY[k] ?? k,
      v && typeof v === 'object' ? auskunftUngarisch(v) : wert(k, v),
    ]));
  }
  return x;
}
