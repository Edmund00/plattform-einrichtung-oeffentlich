// Preise (gemeinsam für die Kundenseiten und Gabriellas Admin-Seite): Die Seiten zeigen und tippen FORINT, die API rechnet in der kleinsten Einheit (preis_cent = Forint mal 100).
// Reine Funktionen ohne Seiteneffekte, deshalb auch vom Selbsttest prüfbar.

export const MAX_CENT = 1_000_000_000; // gleiche Obergrenze wie die API

// "39900", "39 900" -> 3990000. Alles andere (Kommazahlen, Buchstaben, negativ, leer, zu groß) -> null.
export function forintZuCent(text) {
  const s = String(text ?? '').replace(/[\s ]/g, '');
  if (!/^\d{1,9}$/.test(s)) return null;
  const cent = Number(s) * 100;
  return Number.isSafeInteger(cent) && cent <= MAX_CENT ? cent : null;
}

// Produktreife Block 4 (12.11.2026): Preiseingabe je Waehrung. HUF nur ganze Forint (Stripe-Sonderfall, wie bisher);
// alle anderen Waehrungen (EUR) mit hoechstens zwei Nachkommastellen, Komma oder Punkt. Gerechnet wird nur mit ganzen Zahlen.
export const dezimalstellen = (waehrung) => (waehrung === 'huf' ? 0 : 2);

// HUF: "19900" -> 1990000. EUR: "19,99" / "19.99" -> 1999, "19,9" -> 1990, "19" -> 1900. Ungueltig -> null
// (leer, Buchstaben, negativ, mehr als zwei Nachkommastellen, Tausenderpunkte, Exponent, zu gross, bei HUF jede Nachkommastelle).
export function preisZuCent(text, waehrung) {
  if (waehrung === 'huf') return forintZuCent(text);
  const s = String(text ?? '').replace(/[\s  ]/g, '');
  const m = /^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cent = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cent) && cent <= MAX_CENT ? cent : null;
}

// Wert fuer das Eingabefeld beim Bearbeiten (ohne Gruppierung, damit er unveraendert wieder gespeichert werden kann).
// HUF: 3990000 -> "39900". EUR: 1999 -> "19,99" (Englisch "19.99"), 4900 -> "49,00". Ungueltig -> "".
export function centZuEingabe(cent, waehrung) {
  if (!Number.isSafeInteger(cent) || cent < 0) return '';
  if (waehrung === 'huf') return String(Math.trunc(cent / 100)) + (cent % 100 ? ',' + String(cent % 100).padStart(2, '0') : '');
  return String(Math.trunc(cent / 100)) + dezimalZeichen() + String(cent % 100).padStart(2, '0');
}

// Platzhalter-Beispiel im Preisfeld: HUF "19900", EUR "49,00" (Englisch "49.00").
export const preisBeispiel = (waehrung) => (waehrung === 'huf' ? '19900' : '49' + dezimalZeichen() + '00');

// Dezimalzeichen nach Seitensprache: Englisch Punkt, Deutsch/Ungarisch Komma (Browser: <html lang>; sonst Komma).
function dezimalZeichen() {
  return typeof document !== 'undefined' && document.documentElement?.lang === 'en' ? '.' : ',';
}

// 3990000 -> 39900 (Zahl). Ungültig -> null.
// (In Scheibe 30 versehentlich gelöscht; admin.js importiert sie und formatForint braucht sie. Von Claude Code wiederhergestellt.)
export function centZuForint(cent) {
  return Number.isSafeInteger(cent) && cent >= 0 ? cent / 100 : null;
}

// Formatiert ganze Währungseinheiten mit einheitlicher Gruppierung ab vier Ziffern.
export function formatGanzeEinheiten(wert) {
  if (!Number.isSafeInteger(wert) || wert < 0) return '';
  const fallback = String(wert).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  try {
    const lokal = new Intl.NumberFormat('hu-HU', { useGrouping: 'always', maximumFractionDigits: 0 }).format(wert).replace(/[\u00a0\u202f]/g, ' ');
    if (lokal === fallback) return lokal;
  } catch { /* Browser-Fallback. */ }
  return fallback;
}

// 3990000 -> "39 900" ohne Währungswort.
export function formatForint(cent) {
  const forint = centZuForint(cent);
  if (forint === null) return '';
  const [ganz, rest] = forint.toFixed(Number.isInteger(forint) ? 0 : 2).split('.');
  return formatGanzeEinheiten(Number(ganz)) + (rest ? ',' + rest : '');
}

// Backlog b (12.11.2026): EIN Betragsformat fuer Seiten, Mails und Server-Texte (betrag.mjs ruft genau diese Funktion auf).
// Eingabe immer in der kleinsten Einheit (EUR Cent, HUF Filler = Forint mal 100), ganzzahlig gerechnet, kein Intl (keine ICU-Unterschiede, keine geschuetzten Leerzeichen).
//   de/hu: EUR "59,00 EUR" (ohne Tausendertrenner, wie bisher, Test produktreife4), HUF "12 345 Ft" (normales Leerzeichen ab vier Ziffern, wie bisher).
//   en:    EUR "59.00 EUR" (wie die englische Seite bisher),           HUF "12,345 HUF" (Komma als Tausendertrenner, internationaler Code statt "Ft").
// HUF zeigt ganze Forint (Filler-Rest wird abgeschnitten wie bisher in Mails; Stripe verlangt bei HUF ohnehin Vielfache von 100).
// Normales statt geschuetztes Leerzeichen: Mailprogramme stellen U+00A0/U+202F teils als Fragezeichen oder falsch dar (Entscheidung Politur, bleibt).
const BETRAG_FORMAT = {
  de: { tausend: ' ', dezimal: ',', huf: 'Ft' },
  hu: { tausend: ' ', dezimal: ',', huf: 'Ft' },
  en: { tausend: ',', dezimal: '.', huf: 'HUF' },
};
export function betragText(cent, waehrung, sprache) {
  if (!Number.isSafeInteger(cent) || cent < 0) return '';
  const f = BETRAG_FORMAT[sprache] ?? BETRAG_FORMAT.de;
  const ganz = Math.trunc(cent / 100);
  if (String(waehrung ?? '').toLowerCase() === 'huf') return String(ganz).replace(/\B(?=(\d{3})+(?!\d))/g, f.tausend) + ' ' + f.huf;
  return String(ganz) + f.dezimal + String(cent % 100).padStart(2, '0') + ' ' + String(waehrung ?? '').toUpperCase();
}

// Sprache der Seite (Browser: <html lang>); ausserhalb des Browsers (Tests) Deutsch.
function seitenSprache() {
  const l = typeof document !== 'undefined' ? document.documentElement?.lang : '';
  return l in BETRAG_FORMAT ? l : 'de';
}

// Betrag mit Währung für die Anzeige in der Seitensprache: HUF als "39 900 Ft" (Englisch "39,900 HUF"), andere als "15,00 EUR" (Englisch "15.00 EUR").
export function formatBetrag(cent, waehrung) {
  return betragText(cent, waehrung, seitenSprache());
}

// Dateigröße für die Anzeige: 1 234 567 Bytes -> "1,2 MB", 52 000 -> "50,8 KB", 900 -> "900 B"
export function formatMeret(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return '';
  if (bytes < 1024) return bytes + '\u00a0B';
  const rund = (x) => x.toFixed(1).replace('.', ',');
  if (bytes < 1024 * 1024) return rund(bytes / 1024) + '\u00a0KB';
  if (bytes < 1024 * 1024 * 1024) return rund(bytes / (1024 * 1024)) + '\u00a0MB';
  return rund(bytes / (1024 * 1024 * 1024)) + '\u00a0GB';
}
