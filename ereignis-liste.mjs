// Scheibe 15: Geschäftsereignisse, niemals Stripe-Webhooks deduplizieren.
import { db } from './db.mjs';
const TYPEN = new Set(['registriert','bestaetigt','gekauft','erstattet','abo_gestartet','abo_beendet','abo_gekuendigt','geloescht']);
let empfaengerAktiv = false, registrierungMelden = true, nachCommit = null;
// Plattform-Meldung (Dashboard-Anbindung): optionaler zweiter Empfaenger der Ereignisse, getrennt vom Mail-Ausgang. Aus, solange nicht gesetzt.
let plattform = null;
export function ereignisPlattformSetzen(p) { plattform = p && p.an ? p : null; }
export function ereignisKonfigurieren({ aktiv=false, registrierung=true, senden=null }={}) {
  empfaengerAktiv=aktiv;
  registrierungMelden=registrierung;
  nachCommit=senden;
}
// Beträge werden aus der kleinsten Stripe-Einheit in Währungseinheiten umgerechnet, MIT Cent (A2-03: 1999 -> 19.99, nicht 20).
// HUF ist bei Stripe immer durch 100 teilbar und bleibt eine ganze Zahl. Gleiche Rechnung wie plattform-zeilen.mjs (kleinste/100).
export function ganzeEinheiten(klein) {
  return Number.isSafeInteger(klein)&&klein>=0 ? klein/100 : null;
}
export function ereignisHinzufuegen(typ,quelleId,wert={}) {
  try {
    if(!TYPEN.has(typ)||typeof quelleId!=='string'||!quelleId||quelleId.length>200)
      return false;
    const kurs = wert.kurs_id == null ? null :
      db.prepare('SELECT titel FROM kurse WHERE id=?').get(wert.kurs_id);
    const user = wert.benutzer_id == null ? null :
      db.prepare('SELECT email FROM benutzer WHERE id=?').get(wert.benutzer_id);
    const zeit=Date.now();
    const r=db.prepare(
      'INSERT OR IGNORE INTO ereignisse(zeit,typ,kurs_id,kurs_titel,betrag,waehrung,email,status,quelle_id) VALUES(?,?,?,?,?,?,?,?,?)'
    ).run(
      zeit,typ,wert.kurs_id??null,
      wert.kurs_titel??kurs?.titel??null,
      wert.betrag??null,wert.waehrung??null,
      wert.email??user?.email??null,wert.status??null,quelleId
    );
    if(r.changes && empfaengerAktiv && (typ!=='registriert'||registrierungMelden)) {
      db.prepare("INSERT OR IGNORE INTO meldung_ausgang(ereignis_id,status,versuche,geaendert) VALUES(?,'offen',0,?)")
        .run(Number(r.lastInsertRowid),zeit);
    }
    if(r.changes && plattform) { try { plattform.vormerken(Number(r.lastInsertRowid),typ); } catch { /* nie die Zahlung stoeren */ } }
    // Aufruf nach Commit wird in der aufrufenden Route angestoßen; hier niemals Netzwerk.
    return r.changes===1;
  } catch(e) {
    console.warn('Geschäftsereignis nicht gespeichert:', e.code||e.name||'unbekannt');
    return false; // Weder Zahlung noch Registrierung wegen Statistik unterbrechen.
  }
}
export function ereignisseNachCommit() {
  try { nachCommit?.(); } catch { console.warn('Ereignis-Mail konnte nicht gestartet werden'); }
  try { plattform?.nachCommit(); } catch { console.warn('Plattform-Meldung konnte nicht gestartet werden'); }
}
export function ereignisseAufraeumen(tage) {
  const grenze=Date.now()-tage*86400000;
  try { return db.prepare('DELETE FROM ereignisse WHERE zeit<?').run(grenze).changes; }
  catch(e) { console.warn('Ereignis-Aufbewahrung fehlgeschlagen:',e.code||e.name||'unbekannt'); return 0; }
}
export const EREIGNIS_TYPEN=Object.freeze([...TYPEN]);
