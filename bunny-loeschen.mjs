// Bunny Stream, Schritt 4: Videos bei Bunny sicher loeschen (Auftragsbuch).
// Eintraege entstehen (a) durch die Datenbank-Trigger bunny_datei_geloescht / bunny_ausstehend_geloescht (auf jedem Weg, auch durch Kaskaden) und
// (b) durch vormerken() in den Loesch-Transaktionen (doppelt gemoppelt, INSERT OR IGNORE; das Trigger-Netz ist die Absicherung).
// nachholen() arbeitet das Buch NACH dem Commit ab und entfernt einen Auftrag nur bei Erfolg (oder "gibt es nicht mehr").
// Importiert nur db und den Bunny-Fehlertyp, damit es von dateien.mjs und routes-kurse.mjs ohne Kreisimport genutzt werden kann.
import { db } from './db.mjs';
import { BunnyFehler, videoIdGueltig } from './bunny.mjs';

let aktivesBunny = null, uebernahmeHaken = null;
export const setzeBunny = (bunny) => { aktivesBunny = bunny || null; };
// Haken: wird fuer ausstehende Videos aufgerufen, die aelter als 2 Minuten sind (routes-bunny.mjs: fertig gemeldet -> in die Lektion uebernehmen).
// So wird ein fertig hochgeladenes Video auch uebernommen, wenn der Admin den Browser nach dem Upload schliesst.
export const setzeUebernahmeHaken = (fn) => { uebernahmeHaken = typeof fn === 'function' ? fn : null; };
const AUSSTEHEND_MIN_SEKUNDEN = 120;
const AUSSTEHEND_MAX_TAGE = 3;       // ein nie fertig hochgeladenes Video wird nach 3 Tagen zum Loeschen vorgemerkt
const MAX_RUNDEN = 3;
// Schritt 8 (VIDEO-11): Scheitert ein Loeschauftrag zum ALARM_AB_VERSUCHEN-ten Mal oder oefter (z. B. API-Schluessel erneuert), wird bei JEDEM weiteren
// Fehlversuch der Alarm-Haken gerufen (app.mjs: Mail an die Alarm-Adressen); dass daraus hoechstens alle 6 Stunden eine Mail wird, regelt die Drossel im
// Alarmdienst (so geht ein gescheiterter oder gedrosselter Versand nicht verloren). Der Haken darf nie einen Lauf kippen.
export const ALARM_AB_VERSUCHEN = 5;
let alarmHaken = null;
export const setzeAlarmHaken = (fn) => { alarmHaken = typeof fn === 'function' ? fn : null; };

// zeilen: Eintraege mit quelle und bunny_video_id (andere werden ignoriert). In der Transaktion des Loeschens aufrufen.
export function vormerken(zeilen) {
  const stmt = db.prepare('INSERT OR IGNORE INTO bunny_loeschauftraege (video_id, erstellt) VALUES (?, ?)');
  const jetzt = new Date().toISOString();
  let n = 0;
  for (const z of zeilen || []) {
    if (z && z.quelle === 'bunny' && videoIdGueltig(z.bunny_video_id)) { stmt.run(z.bunny_video_id, jetzt); n++; }
  }
  return n;
}

const offen = () => { try { return db.prepare('SELECT COUNT(*) n FROM bunny_loeschauftraege').get().n; } catch { return -1; } };

let laeuft = null, nochmal = false;
// Arbeitet das Auftragsbuch ab. Wirft NIE (ein Fehler bei Bunny darf nie eine Admin-Aktion kippen). Ruft man es waehrend eines Laufs auf, gibt es diesen Lauf
// zurueck und er prueft nach seinem Ende noch einmal (so geht ein gerade neu vorgemerkter Auftrag nicht verloren).
export function nachholen() {
  if (laeuft) { nochmal = true; return laeuft; }
  laeuft = (async () => {
    let erledigt = 0, aus = false;
    try {
      // Ausstehende Videos, die schon laenger als 2 Minuten warten: fragen, ob Bunny "fertig" meldet, und dann uebernehmen (Haken). Fehler dort stoppen nichts.
      if (uebernahmeHaken && aktivesBunny && aktivesBunny.an) {
        const reif = new Date(Date.now() - AUSSTEHEND_MIN_SEKUNDEN * 1000).toISOString();
        for (const p of db.prepare('SELECT lektion_id FROM bunny_ausstehend WHERE uebernommen = 0 AND erstellt < ? ORDER BY erstellt LIMIT 20').all(reif)) {
          try { await uebernahmeHaken(p.lektion_id); } catch (e) { console.warn(`Ausstehendes Bunny-Video (Lektion ${p.lektion_id}) nicht geprueft (${e?.code || e?.name || 'Fehler'})`); }
        }
      }
      if (!aktivesBunny || !aktivesBunny.an) { aus = true; }
      else {
        // Nie fertig hochgeladene Videos nach 3 Tagen aufraeumen: der Trigger traegt sie ins Auftragsbuch ein.
        // Schritt 8 (VIDEO-13): NUR wenn Bunny an ist. Ist Bunny aus, konnte niemand nachfragen, ob das Video fertig ist; dann bleibt der Eintrag.
        const grenze = new Date(Date.now() - AUSSTEHEND_MAX_TAGE * 86400000).toISOString();
        db.prepare('DELETE FROM bunny_ausstehend WHERE uebernommen = 0 AND erstellt < ?').run(grenze);
        for (let runde = 0; runde < MAX_RUNDEN; runde++) {
          nochmal = false;
          // Aufgaben mit vielen Fehlversuchen sinken nach hinten, damit sie neuere nicht blockieren.
          const auftraege = db.prepare('SELECT video_id FROM bunny_loeschauftraege ORDER BY versuche, erstellt LIMIT 50').all();
          for (const a of auftraege) {
            try {
              await aktivesBunny.videoLoeschen(a.video_id);
              db.prepare('DELETE FROM bunny_loeschauftraege WHERE video_id = ?').run(a.video_id);
              erledigt++;
            } catch (e) {
              const code = e instanceof BunnyFehler ? e.code + (e.status ? `:${e.status}` : '') : 'unbekannt';
              let versuche = 0;
              try { db.prepare('UPDATE bunny_loeschauftraege SET versuche = versuche + 1, letzter_fehler = ? WHERE video_id = ?').run(code, a.video_id); versuche = db.prepare('SELECT versuche FROM bunny_loeschauftraege WHERE video_id = ?').get(a.video_id)?.versuche ?? 0; } catch { /* Datenbank selbst gestoert */ }
              console.warn(`Video ${a.video_id} konnte bei Bunny nicht geloescht werden (${code}); bleibt im Auftragsbuch`);
              if (versuche >= ALARM_AB_VERSUCHEN && alarmHaken) { try { const p = alarmHaken('bunny_loeschen'); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch { /* Alarm darf den Lauf nie kippen */ } }
            }
          }
          if (!nochmal) break;
        }
      }
    } catch (e) {
      console.warn(`Bunny-Auftragsbuch nicht abgearbeitet (${e?.code || e?.name || 'Fehler'})`);
    }
    return aus ? { erledigt, offen: offen(), aus: true } : { erledigt, offen: offen() };
  })().finally(() => { laeuft = null; nochmal = false; });
  return laeuft;
}

export const offeneAuftraege = () => db.prepare('SELECT video_id, versuche, letzter_fehler, erstellt FROM bunny_loeschauftraege ORDER BY erstellt').all();
// Schritt 8 (VIDEO-11): Zusammenfassung fuer den Admin (GET /api/admin/bunny): wie viele Auftraege offen, wie viele mehrfach gescheitert.
export const auftragsLage = () => {
  const alle = offeneAuftraege();
  return { offen: alle.length, fehlgeschlagen: alle.filter((a) => a.versuche >= ALARM_AB_VERSUCHEN).length, aelteste: alle[0]?.erstellt ?? null, liste: alle.slice(0, 20) };
};
