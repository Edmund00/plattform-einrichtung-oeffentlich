// Einheitliche serverseitige Zugangsprüfung: alte Käufe/Einladungen unbegrenzt,
// Abos nur bis zum Ablaufzeitpunkt. Aufruf bei JEDER Kurs- und Dateianfrage.
import { db } from './db.mjs';
export const gueltigerZugang = (benutzerId, kursId, zeit = Date.now()) =>
  !!db.prepare('SELECT 1 FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ? AND (gueltig_bis IS NULL OR gueltig_bis > ?)').get(benutzerId, kursId, zeit);
export const zugangFuer = (benutzer, kursId) =>
  benutzer?.rolle === 'admin' || (!!benutzer && gueltigerZugang(benutzer.id, kursId));
