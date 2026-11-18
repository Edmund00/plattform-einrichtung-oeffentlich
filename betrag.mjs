// Gemeinsame reine Server-Formatierung; interne Beträge bleiben Cent.
// Backlog b (12.11.2026): Die Darstellung kommt aus EINER Funktion (public/preis.js betragText), die auch die Seiten benutzen.
// Die Sprache wird ausdruecklich uebergeben (Mails: Bestell-/Kontosprache des Jobs, siehe mail.mjs geldText); ohne Angabe Deutsch.
import { betragText, formatGanzeEinheiten } from './public/preis.js';
export { formatGanzeEinheiten };
export function formatGeld(cent, waehrung, sprache = 'de') {
  return betragText(cent, waehrung, sprache);
}
// Betraege der Ereignisliste stehen in ganzen Einheiten (ganzeEinheiten(): 19.99 EUR, 9900 HUF). Zurueck in die kleinste Einheit ohne Gleitkomma-Rest.
export function formatGeldEinheiten(wert, waehrung, sprache = 'de') {
  const zahl = Number(wert);
  if (wert === null || wert === undefined || !Number.isFinite(zahl) || zahl < 0) return '';
  return betragText(Math.round(zahl * 100), waehrung, sprache);
}
