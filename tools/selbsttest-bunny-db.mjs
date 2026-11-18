// Bunny Stream, Schritt 2: Die neuen Spalten dateien.quelle / bunny_video_id / bunny_status kommen in alte Datenbanken, ohne etwas zu veraendern.
// Ablauf: Datenbank mit dem neuen Schema anlegen, die drei Spalten wieder entfernen (= Zustand VOR Bunny, mit einer echten Datei-Zeile),
// dann db.mjs erneut laden (= Start der neuen Version) und pruefen.
import './test-sprache.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const ordner = mkdtempSync(join(tmpdir(), 'schulung-bunny-db-'));
const DB = join(ordner, 'test.db');
let ok = 0, fehler = 0;
const pruefe = (name, wert, detail = '') => { wert ? ok++ : fehler++; console.log((wert ? 'OK     ' : 'FEHLER ') + name + (!wert && detail ? ' ' + detail : '')); };
const lauf = (code) => {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', code], { env: { ...process.env, DB_DATEI: DB }, encoding: 'utf8', cwd: process.cwd() });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};
try {
  // 1) Neues Schema anlegen, dann zurueck in den alten Zustand versetzen und Altdaten eintragen.
  const alt = lauf(`
    const { db } = await import('./db.mjs');
    const jetzt = new Date().toISOString();
    db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES ('Alt','',0,'huf','veroeffentlicht',?,?)").run(jetzt, jetzt);
    db.prepare("INSERT INTO lektionen(kurs_id,titel,art,erstellt,geaendert) VALUES (1,'Altes Video','video',?,?)").run(jetzt, jetzt);
    db.prepare("INSERT INTO dateien(lektion_id,name,art,pfad,groesse,mime,erstellt) VALUES (1,'alt.mp4','video','abcdef0123456789abcdef0123456789.mp4',1234,'video/mp4',?)").run(jetzt);
    db.exec('DROP TRIGGER IF EXISTS bunny_datei_geloescht');
    for (const s of ['quelle','bunny_video_id','bunny_status']) db.exec('ALTER TABLE dateien DROP COLUMN ' + s);
    const spalten = db.prepare('PRAGMA table_info(dateien)').all().map(x => x.name);
    console.log(JSON.stringify(spalten));
    db.close();
  `);
  pruefe('Vorbereitung: alter Zustand ohne Bunny-Spalten erzeugt', alt.ok && !/quelle|bunny/.test(alt.out), alt.err.slice(0, 200) + alt.out);

  // 2) Neue Version startet auf der alten Datenbank.
  const neu = lauf(`
    const { db } = await import('./db.mjs');
    const spalten = db.prepare('PRAGMA table_info(dateien)').all().map(x => x.name);
    const z = db.prepare('SELECT * FROM dateien WHERE lektion_id = 1').get();
    console.log(JSON.stringify({ spalten, z }));
    db.close();
  `);
  let n = {}; try { n = JSON.parse(neu.out); } catch { /* bleibt leer */ }
  pruefe('Start der neuen Version auf alter Datenbank gelingt', neu.ok && !!n.spalten, neu.err.slice(0, 200));
  pruefe('Drei neue Spalten sind da', ['quelle', 'bunny_video_id', 'bunny_status'].every(s => n.spalten?.includes(s)));
  pruefe('Alte Datei-Zeile unveraendert (Name, Pfad, Groesse, Typ)', n.z?.name === 'alt.mp4' && n.z?.pfad === 'abcdef0123456789abcdef0123456789.mp4' && n.z?.groesse === 1234 && n.z?.mime === 'video/mp4');
  pruefe('Alte Datei ist "lokal", ohne Bunny-ID und ohne Bunny-Status', n.z?.quelle === 'lokal' && n.z?.bunny_video_id === null && n.z?.bunny_status === null);

  // 3) Zweiter Start ist wirkungslos (idempotent), neue Zeilen, Pruefregel.
  const nochmal = lauf(`
    const { db } = await import('./db.mjs');
    const jetzt = new Date().toISOString();
    db.prepare("INSERT INTO lektionen(kurs_id,titel,art,erstellt,geaendert) VALUES (1,'Neu','video',?,?)").run(jetzt, jetzt);
    db.prepare("INSERT INTO dateien(lektion_id,name,art,pfad,groesse,mime,erstellt) VALUES (2,'neu.mp4','video','x.mp4',1,'video/mp4',?)").run(jetzt);
    const standard = db.prepare('SELECT quelle FROM dateien WHERE lektion_id = 2').get().quelle;
    db.prepare("INSERT INTO lektionen(kurs_id,titel,art,erstellt,geaendert) VALUES (1,'Bunny','video',?,?)").run(jetzt, jetzt);
    db.prepare("INSERT INTO dateien(lektion_id,name,art,pfad,groesse,mime,erstellt,quelle,bunny_video_id,bunny_status) VALUES (3,'b.mp4','video','bunny',0,'video/mp4',?,'bunny','guid-123','erstellt')").run(jetzt);
    const b = db.prepare('SELECT quelle,bunny_video_id,bunny_status FROM dateien WHERE lektion_id = 3').get();
    let abgelehnt = false;
    try { db.prepare("UPDATE dateien SET quelle='irgendwo' WHERE lektion_id = 3").run(); } catch { abgelehnt = true; }
    const anzahl = db.prepare('PRAGMA table_info(dateien)').all().filter(x => ['quelle','bunny_video_id','bunny_status'].includes(x.name)).length;
    console.log(JSON.stringify({ standard, b, abgelehnt, anzahl }));
    db.close();
  `);
  let m = {}; try { m = JSON.parse(nochmal.out); } catch { /* leer */ }
  pruefe('Zweiter Start auf derselben Datenbank laeuft ohne Fehler, Spalten nicht doppelt', nochmal.ok && m.anzahl === 3, nochmal.err.slice(0, 200));
  pruefe('Neue Datei ohne Angabe ist "lokal" (Standard)', m.standard === 'lokal');
  pruefe('Bunny-Zeile speichert Quelle, Video-ID und Status', m.b?.quelle === 'bunny' && m.b?.bunny_video_id === 'guid-123' && m.b?.bunny_status === 'erstellt');
  pruefe('Ungueltige Quelle wird von der Datenbank abgelehnt', m.abgelehnt === true);
} catch (e) {
  fehler++; console.log('FEHLER Testablauf: ' + (e.code || e.message));
} finally {
  try { rmSync(ordner, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; }
}
console.log('Bunny-Datenbank: ' + ok + ' bestanden, ' + fehler + ' fehlgeschlagen');
process.exitCode = fehler ? 1 : 0;
