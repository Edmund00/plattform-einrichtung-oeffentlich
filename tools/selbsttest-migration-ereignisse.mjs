// Scheibe 20 (Abnahme): Migration der Ereignis-Tabelle (neue Typen abo_gekuendigt, geloescht) mit alter Datenbank, ohne Datenverlust.
import './test-sprache.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
let ok=0,fehler=0;
const pruefe=(name,wert)=>{wert?ok++:fehler++;console.log((wert?'OK     ':'FEHLER ')+name);};
const ordner=mkdtempSync(join(tmpdir(),'schulung-migration-'));
const datei=join(ordner,'alt.db');
try{
 // Alte Datenbank wie vor Scheibe 20: Typ-Prüfung nur mit sechs Typen, ohne Leerzeichen, Meldungsausgang verweist darauf.
 const alt=new DatabaseSync(datei);
 alt.exec(`
CREATE TABLE ereignisse (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 zeit INTEGER NOT NULL,
 typ TEXT NOT NULL CHECK(typ IN ('registriert','bestaetigt','gekauft','erstattet','abo_gestartet','abo_beendet')),
 kurs_id INTEGER,
 kurs_titel TEXT,
 betrag INTEGER,
 waehrung TEXT,
 email TEXT,
 status TEXT,
 quelle_id TEXT NOT NULL,
 UNIQUE(typ,quelle_id)
);
CREATE INDEX ereignisse_zeit ON ereignisse(zeit DESC,id DESC);
CREATE INDEX ereignisse_typ_zeit ON ereignisse(typ,zeit DESC);
CREATE TABLE meldung_ausgang (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 ereignis_id INTEGER NOT NULL UNIQUE REFERENCES ereignisse(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','gesendet','fehler')),
 versuche INTEGER NOT NULL DEFAULT 0 CHECK(versuche BETWEEN 0 AND 5),
 geaendert INTEGER NOT NULL
);`);
 alt.prepare("INSERT INTO ereignisse(zeit,typ,kurs_titel,betrag,waehrung,email,quelle_id) VALUES(1000,'gekauft','Kurs A',990000,'huf','a@example.com','q1')").run();
 alt.prepare("INSERT INTO ereignisse(zeit,typ,quelle_id) VALUES(2000,'abo_beendet','q2')").run();
 alt.prepare("INSERT INTO meldung_ausgang(ereignis_id,status,versuche,geaendert) VALUES(2,'gesendet',1,3000)").run();
 // Mit dem alten Schema scheitert der neue Typ wirklich (das war der Fehler).
 let alteGrenze=false;try{alt.prepare("INSERT INTO ereignisse(zeit,typ,quelle_id) VALUES(1,'abo_gekuendigt','x')").run();}catch{alteGrenze=true;}
 pruefe('Altes Schema lehnt abo_gekuendigt ab (Ausgangslage des Fehlers)',alteGrenze);
 alt.close();
 const skript=`
 import('./db.mjs').then(async({db})=>{
  const {ereignisHinzufuegen}=await import('./ereignis-liste.mjs');
  const rows=db.prepare('SELECT id,zeit,typ,kurs_titel,betrag,email,quelle_id FROM ereignisse ORDER BY id').all();
  const meld=db.prepare('SELECT ereignis_id,status,versuche FROM meldung_ausgang').all();
  const neu1=ereignisHinzufuegen('abo_gekuendigt','migr:1',{});
  const neu2=ereignisHinzufuegen('geloescht','migr:2',{});
  const dopp=ereignisHinzufuegen('abo_gekuendigt','migr:1',{});
  const idx=db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ereignisse'").all().map(x=>x.name);
  const fk=db.prepare('PRAGMA foreign_key_check').all().length;
  const sql=db.prepare("SELECT sql FROM sqlite_master WHERE name='ereignisse'").get().sql;
  const anzahl=db.prepare('SELECT COUNT(*) n FROM ereignisse').get().n;
  console.log('JSON '+JSON.stringify({rows,meld,neu1,neu2,dopp,idx,fk,hatTyp:sql.includes('abo_gekuendigt')&&sql.includes('geloescht'),anzahl}));
 });`;
 const lauf=()=>spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','-e',skript],{cwd:resolve('.'),env:{...process.env,DB_DATEI:datei},encoding:'utf8'});
 const r1=lauf();
 const z1=(r1.stdout.split('\n').find(l=>l.startsWith('JSON '))||'JSON {}').slice(5);
 const a=JSON.parse(z1);
 pruefe('Start mit alter Datenbank ohne Fehler',r1.status===0&&!!a.rows);
 pruefe('Alte Ereignisse samt IDs erhalten',a.rows?.length===2&&a.rows[0].id===1&&a.rows[0].kurs_titel==='Kurs A'&&a.rows[0].betrag===990000&&a.rows[1].typ==='abo_beendet');
 pruefe('Meldungsausgang bleibt verbunden',a.meld?.length===1&&a.meld[0].ereignis_id===2&&a.meld[0].status==='gesendet');
 pruefe('Neue Typen abo_gekuendigt und geloescht werden gespeichert',a.neu1===true&&a.neu2===true&&a.anzahl===4);
 pruefe('Doppelte Quelle wird nicht doppelt gespeichert',a.dopp===false&&a.anzahl===4);
 pruefe('Indizes nach Neuaufbau vorhanden',a.idx?.includes('ereignisse_zeit')&&a.idx?.includes('ereignisse_typ_zeit'));
 pruefe('Fremdschlüsselprüfung sauber, Schema enthält neue Typen',a.fk===0&&a.hatTyp===true);
 const r2=lauf();
 const b=JSON.parse((r2.stdout.split('\n').find(l=>l.startsWith('JSON '))||'JSON {}').slice(5));
 pruefe('Zweiter Start ohne Fehler und ohne Veränderung (idempotent)',r2.status===0&&b.anzahl===4&&b.rows?.length===4&&b.fk===0);
}catch(e){fehler++;console.log('FEHLER Testablauf: '+(e.code||e.message));}
finally{try{rmSync(ordner,{recursive:true,force:true});}catch{}}
console.log(`Migration Ereignisse: ${ok} bestanden, ${fehler} fehlgeschlagen`);
process.exit(fehler?1:0);
