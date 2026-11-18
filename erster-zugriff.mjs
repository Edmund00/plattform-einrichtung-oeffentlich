import { db } from './db.mjs';
// Erster Zugriff je Kunde und Kurs (Widerruf). Nachbesserung Gesamtpruefung: Liegt der gespeicherte Zugriff VOR der neuesten Bestellung dieses Kunden fuer
// diesen Kurs (frueherer Besitz, z. B. erstattet und neu gekauft), wird er durch den jetzigen ersetzt: so gehoert der Zeitpunkt zur aktuellen Bestellung.
export function erstenZugriffMerken(benutzer,kurs){
  if(benutzer?.rolle==='admin'||!benutzer?.id||!kurs)return;
  try {db.prepare(`INSERT INTO erster_zugriff(benutzer_id,kurs_id,erster_zugriff) VALUES(?,?,?)
    ON CONFLICT(benutzer_id,kurs_id) DO UPDATE SET erster_zugriff=excluded.erster_zugriff
    WHERE erster_zugriff.erster_zugriff < (SELECT MAX(b.erstellt) FROM bestellungen b WHERE b.benutzer_id=excluded.benutzer_id AND b.kurs_id=excluded.kurs_id)`)
    .run(benutzer.id,kurs,new Date().toISOString());}
  catch {console.warn('Erster Lektionszugriff konnte nicht gespeichert werden');}
}
