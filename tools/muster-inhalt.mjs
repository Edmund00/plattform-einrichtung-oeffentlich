// Fuellt die MUSTER-Datenbank (daten/muster.db) mit drei erfundenen Beispielkursen (Deutsch) direkt per SQL. Idempotent (nach Titel). Nur Demo-Inhalt, keine echten Daten.
// Aufruf: node --disable-warning=ExperimentalWarning tools/muster-inhalt.mjs [pfad-zur-db]
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2] || 'daten/muster.db');
const jetzt = new Date().toISOString();
import { KURSE } from '../demo-daten.mjs';
let neu = 0;
for (const k of KURSE) {
  const vorh = db.prepare('SELECT id FROM kurse WHERE titel=?').get(k.titel);
  if (vorh) { db.prepare('UPDATE kurse SET beschreibung=?,nutzen=?,geaendert=? WHERE id=?').run(k.beschreibung, k.nutzen, jetzt, vorh.id); continue; }
  const id = Number(db.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert,nutzen) VALUES (?,?,?,'eur','veroeffentlicht',?,?,?)").run(k.titel, k.beschreibung, k.preis, jetzt, jetzt, k.nutzen).lastInsertRowid);
  k.lektionen.forEach(([abschnitt, titel, inhalt], i) => db.prepare("INSERT INTO lektionen (kurs_id,abschnitt,titel,art,inhalt,reihenfolge,status,erstellt,geaendert) VALUES (?,?,?,'text',?,?,'veroeffentlicht',?,?)").run(id, abschnitt, titel, inhalt, i + 1, jetzt, jetzt));
  neu++;
}
console.log('Kurse neu:', neu, 'gesamt:', db.prepare('SELECT COUNT(*) n FROM kurse').get().n);
