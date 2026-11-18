// Restore-Pflichtnachweis (A7-02, Gesamtpruefung 12.11.2026): echte Sicherung mit Daten -> Wiederherstellung in LEEREN Ordner -> Vergleich.
// Ergaenzt selbsttest-sicherung.mjs (dort: Format, Rotation, Alarm, Rechte; Round-Trip nur mit fast leerer DB und nur "Zeilenzahlen sind Zahlen").
// Hier: Kurs, Lektion, Kunde, Bestellung, Zugang, Abo anlegen, mit sicherungDienst() verschluesseln, mit den Runbook-Werkzeugen
// tools/sicherung-entschluesseln.mjs und tools/sicherung-pruefen.mjs (docs/WIEDERHERSTELLUNG.md B.3/B.4) zurueckholen und JEDE Tabelle
// nach Zeilenzahl und Inhalts-Pruefsumme vergleichen. Falscher Schluessel, manipulierte und gekuerzte Datei, vorhandene Zieldatei muessen scheitern.
import './test-sprache.mjs';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const dir=mkdtempSync(join(tmpdir(),'vsic-restore-'));
process.env.DB_DATEI=join(dir,'quelle','data.db');
let db,ok=0,failed=0;
const check=(n,v)=>{v?ok++:failed++;console.log((v?'OK ':'FEHLER ')+n)};
const key=randomBytes(32),falsch=randomBytes(32),backupDir=join(dir,'sicherung'),leer=join(dir,'wiederhergestellt');
// Inhalt jeder Tabelle als Pruefsumme (Zeilen nach rowid, Spalten in Schemareihenfolge). Interne sqlite_*-Tabellen ausgenommen.
function abbild(d){
 const tabellen=d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
 const aus={};
 for(const t of tabellen){
  const zeilen=d.prepare('SELECT * FROM "'+t+'" ORDER BY rowid').all();
  aus[t]={n:zeilen.length,sha:createHash('sha256').update(JSON.stringify(zeilen)).digest('hex')};
 }
 return aus;
}
// Schema: ALLE sqlite_master-Eintraege (Tabellen, Indizes, Trigger, Views) mit Typ, Name, Tabelle und normalisiertem SQL (Leerraum zusammengefasst).
function schema(d){
 return d.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all().map(x=>[x.type,x.name,x.tbl_name,x.sql==null?null:String(x.sql).replace(/\s+/g,' ').trim()]);
}
const schemaVergleich=(a,b)=>{const k=x=>JSON.stringify(x),A=new Set(a.map(k)),B=new Set(b.map(k));return [...a.filter(x=>!B.has(k(x))),...b.filter(x=>!A.has(k(x)))].map(x=>x[0]+':'+x[1])};
const vergleich=(a,b)=>{const namen=[...new Set([...Object.keys(a),...Object.keys(b)])];return namen.filter(t=>JSON.stringify(a[t])!==JSON.stringify(b[t]))};
const werkzeug=(skript,args,schluessel)=>spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','tools/'+skript,...args],
 {cwd:process.cwd(),env:{...process.env,SICHERUNG_SCHLUESSEL:schluessel.toString('base64')},encoding:'utf8',timeout:20000});
try{
 ({db}=await import('../db.mjs'));
 const {sicherungDienst,TABELLEN}=await import('../sicherung.mjs');
 const {passwortHashen}=await import('../auth.mjs');
 const t=new Date().toISOString(),bis=Date.now()+30*86400000,ph=await passwortHashen('RestoreTestPasswordOnly');
 const admin=db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,'admin',?)").run('restore-admin@example.com',ph,t).lastInsertRowid;
 const kunde=db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,stripe_kunde,erstellt,sprache) VALUES(?,?,'kunde','cus_restoretest1',?,'de')").run('restore-kunde@example.com',ph,t).lastInsertRowid;
 const kurs=db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,?,?,'veroeffentlicht',?,?)").run('Wiederherstellungskurs äöü ő ű','Beschreibung mit Umlauten',1999000,'huf',t,t).lastInsertRowid;
 const kurs2=db.prepare("INSERT INTO kurse(titel,preis_cent,waehrung,status,erstellt,geaendert) VALUES('Abo-Kurs',4900,'eur','veroeffentlicht',?,?)").run(t,t).lastInsertRowid;
 db.prepare("INSERT INTO lektionen(kurs_id,titel,art,inhalt,reihenfolge,erstellt,geaendert) VALUES(?,?,'text',?,1,?,?)").run(kurs,'Lektion 1','Geheimer Lektionstext nur mit Zugang',t,t);
 db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert,sprache) VALUES('cs_test_restore1','pi_test_restore1',?,?,1999000,'huf','bezahlt',?,?,'de')").run(kunde,kurs,t,t);
 db.prepare("INSERT INTO zugaenge(benutzer_id,kurs_id,quelle,erstellt) VALUES(?,?,'zahlung',?)").run(kunde,kurs,t);
 db.prepare("INSERT INTO abos(stripe_abo,stripe_sitzung,benutzer_id,kurs_id,status,gueltig_bis,erstellt,geaendert) VALUES('sub_test_restore1','cs_test_restore2',?,?,'aktiv',?,?,?)").run(kunde,kurs2,bis,t,t);
 db.prepare("INSERT INTO zugaenge(benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES(?,?,'abo',?,?)").run(kunde,kurs2,t,bis);
 const vorher=abbild(db),schemaVorher=schema(db);
 check('Testdaten angelegt (Kunde, 2 Kurse, Lektion, Bestellung, 2 Zugaenge, Abo)',vorher.benutzer.n===2&&vorher.kurse.n===2&&vorher.lektionen.n===1&&vorher.bestellungen.n===1&&vorher.zugaenge.n===2&&vorher.abos.n===1&&admin>0);
 // 1. Echte Sicherung mit dem Produktionscode (VACUUM INTO, Pruefung, AES-256-GCM, exklusive Anlage, Protokoll).
 const lauf=await sicherungDienst({ordner:backupDir,schluessel:key}).lauf('manuell');
 check('Sicherung erfolgreich erzeugt',lauf.ok===true&&MUSTER_OK(lauf.dateiname));
 const datei=join(backupDir,lauf.dateiname),roh=readFileSync(datei);
 check('Sicherungsdatei ist verschluesselt (VSIC1, kein SQLite-Kopf, kein Klartext)',roh.subarray(0,5).toString()==='VSIC1'&&!roh.includes(Buffer.from('SQLite format 3'))&&!roh.includes(Buffer.from('restore-kunde@example.com'))&&!roh.includes(Buffer.from('Geheimer Lektionstext')));
 const prot=db.prepare("SELECT * FROM sicherung_protokoll WHERE dateiname=? AND ergebnis='ok'").get(lauf.dateiname);
 check('Protokoll mit Pruefsumme und Zeilenzahlen der Quelle',prot&&prot.sha256_enc===createHash('sha256').update(roh).digest('hex')&&JSON.stringify(JSON.parse(prot.tabellen_zeilen))===JSON.stringify(Object.fromEntries(TABELLEN.map(x=>[x,vorher[x].n]))));
 // 2. Wiederherstellung in einen LEEREN, neuen Ordner mit dem Runbook-Werkzeug.
 mkdirSync(leer);
 check('Zielordner ist vor der Wiederherstellung leer',readdirSync(leer).length===0);
 const ziel=join(leer,'data.db');
 const ent=werkzeug('sicherung-entschluesseln.mjs',[datei,ziel],key);
 check('sicherung-entschluesseln.mjs mit richtigem Schluessel: Exit 0, Datei neu angelegt',ent.status===0&&existsSync(ziel));
 const pr=werkzeug('sicherung-pruefen.mjs',[datei],key);
 const zahlen=pr.status===0?JSON.parse(pr.stdout.slice(pr.stdout.indexOf('{'))):null;
 check('sicherung-pruefen.mjs: Integritaet ok, Zeilenzahlen = Quelle',!!zahlen&&TABELLEN.every(x=>zahlen[x]===vorher[x].n));
 check('Werkzeugausgaben enthalten weder Schluessel noch Kundendaten',![ent.stdout,ent.stderr,pr.stdout,pr.stderr].join('').match(new RegExp(key.toString('base64').replace(/[+/=]/g,'.')+'|restore-kunde')));
 // 3. Vergleich: jede Tabelle (nicht nur die 6 gezaehlten) mit Zeilenzahl und Inhalts-Pruefsumme.
 const wieder=new DatabaseSync(ziel,{readOnly:true});
 const nachher=abbild(wieder),schemaNachher=schema(wieder);
 const integ=wieder.prepare('PRAGMA integrity_check').get().integrity_check,fk=wieder.prepare('PRAGMA foreign_key_check').all().length;
 const zentral=wieder.prepare("SELECT b.email,b.stripe_kunde,k.titel,o.betrag,o.status,z.quelle FROM bestellungen o JOIN benutzer b ON b.id=o.benutzer_id JOIN kurse k ON k.id=o.kurs_id JOIN zugaenge z ON z.benutzer_id=b.id AND z.kurs_id=k.id").get();
 const abo=wieder.prepare("SELECT a.status,z.quelle,z.gueltig_bis=a.gueltig_bis gleich FROM abos a JOIN zugaenge z ON z.benutzer_id=a.benutzer_id AND z.kurs_id=a.kurs_id").get();
 wieder.close();
 const abweichung=vergleich(vorher,nachher);
 check('Alle '+Object.keys(vorher).length+' Tabellen: Zeilenzahl und Inhalts-Pruefsumme identisch'+(abweichung.length?' (Abweichung: '+abweichung.join(',')+')':''),abweichung.length===0&&Object.keys(nachher).length===Object.keys(vorher).length);
 check('integrity_check ok, foreign_key_check leer',integ==='ok'&&fk===0);
 const typen=t=>schemaVorher.filter(x=>x[0]===t).length,schemaAbw=schemaVergleich(schemaVorher,schemaNachher);
 check('Schema identisch: '+typen('table')+' Tabellen, '+typen('index')+' Indizes, '+typen('trigger')+' Trigger (Name + SQL)'+(schemaAbw.length?' (Abweichung: '+schemaAbw.join(',')+')':''),schemaAbw.length===0&&typen('index')>0&&typen('trigger')>0);
 check('Wichtige Tabellen nicht leer verglichen (benutzer, kurse, bestellungen, zugaenge, abos je >= 1 Zeile)',['benutzer','kurse','bestellungen','zugaenge','abos'].every(x=>nachher[x]?.n>=1));
 check('Zentrale Felder: Kunde, Stripe-Kunde, Kurstitel mit Sonderzeichen, Betrag, Status, Zugang',zentral?.email==='restore-kunde@example.com'&&zentral.stripe_kunde==='cus_restoretest1'&&zentral.titel==='Wiederherstellungskurs äöü ő ű'&&zentral.betrag===1999000&&zentral.status==='bezahlt'&&zentral.quelle==='zahlung');
 check('Abo und Abo-Zugang mit gleichem Ablauf wiederhergestellt',abo?.status==='aktiv'&&abo.quelle==='abo'&&abo.gleich===1);
 // Gegenprobe des Vergleichs: eine einzige geaenderte Zelle muss auffallen (sonst waere der Vergleich wertlos).
 const kopie=join(dir,'gegenprobe.db');writeFileSync(kopie,readFileSync(ziel));
 const g=new DatabaseSync(kopie);g.prepare('UPDATE bestellungen SET betrag=betrag+1').run();const geaendert=abbild(g);g.close();
 check('Gegenprobe: eine geaenderte Zelle wird vom Vergleich erkannt',JSON.stringify(vergleich(vorher,geaendert))==='["bestellungen"]');
 {const g2=new DatabaseSync(kopie);const tr=g2.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name LIMIT 1").get().name,ix=g2.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name LIMIT 1").get().name;
  g2.exec('DROP TRIGGER "'+tr+'"; DROP INDEX "'+ix+'"');const s2=schema(g2);g2.close();
  check('Gegenprobe: fehlender Trigger und fehlender Index werden vom Schemavergleich erkannt',JSON.stringify(schemaVergleich(schemaVorher,s2).sort())===JSON.stringify(['index:'+ix,'trigger:'+tr].sort()));}
 // 4. App-Code startet auf der wiederhergestellten DB (Migrationen laufen), Daten bleiben unveraendert.
 const kind="import {db} from './db.mjs'; const z=db.prepare(\"SELECT COUNT(*) n FROM zugaenge\").get().n; const k=db.prepare('SELECT titel FROM kurse ORDER BY id').all().map(x=>x.titel); console.log(JSON.stringify({z,k}));";
 const start=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',kind],{cwd:process.cwd(),env:{...process.env,DB_DATEI:ziel},encoding:'utf8',timeout:20000});
 const st=start.status===0?JSON.parse(start.stdout.trim().split('\n').pop()):null;
 check('db.mjs startet auf der wiederhergestellten DB, Zugaenge und Kurse vorhanden',st?.z===2&&st.k[0]==='Wiederherstellungskurs äöü ő ű');
 // 5. Negativfaelle: muessen scheitern und duerfen keine Datei anlegen oder ueberschreiben.
 const z2=join(leer,'falsch.db');
 const r1=werkzeug('sicherung-entschluesseln.mjs',[datei,z2],falsch);
 check('Falscher Schluessel: Exit 1, keine Ausgabedatei',r1.status===1&&!existsSync(z2));
 const r1b=werkzeug('sicherung-pruefen.mjs',[datei],falsch);
 check('Falscher Schluessel: sicherung-pruefen scheitert',r1b.status===1);
 const mani=join(dir,'manipuliert.db.enc'),bytes=Buffer.from(roh);bytes[Math.floor(bytes.length/2)]^=0x01;writeFileSync(mani,bytes);
 const r2=werkzeug('sicherung-entschluesseln.mjs',[mani,z2],key);
 check('Manipulierte Datei (1 Bit): Exit 1, keine Ausgabedatei',r2.status===1&&!existsSync(z2));
 const kurz=join(dir,'gekuerzt.db.enc');writeFileSync(kurz,roh.subarray(0,roh.length-100));
 const r3=werkzeug('sicherung-entschluesseln.mjs',[kurz,z2],key);
 check('Gekuerzte Datei: Exit 1, keine Ausgabedatei',r3.status===1&&!existsSync(z2));
 const r4=werkzeug('sicherung-pruefen.mjs',[mani],key);
 check('Manipulierte Datei: sicherung-pruefen scheitert',r4.status===1);
 const vorhanden=join(leer,'vorhanden.db');writeFileSync(vorhanden,'BLEIBT');
 const r5=werkzeug('sicherung-entschluesseln.mjs',[datei,vorhanden],key);
 check('Vorhandene Zieldatei wird nicht ueberschrieben',r5.status===1&&readFileSync(vorhanden,'utf8')==='BLEIBT');
 const r6=spawnSync(process.execPath,['tools/sicherung-entschluesseln.mjs',datei,join(leer,'ohne.db')],{cwd:process.cwd(),env:{...process.env,SICHERUNG_SCHLUESSEL:''},encoding:'utf8'});
 check('Ohne Schluessel: Exit 1, keine Ausgabedatei',r6.status===1&&!existsSync(join(leer,'ohne.db')));
}catch(e){failed++;console.log('FEHLER Testablauf '+(e.code||e.message))}
finally{try{db?.close()}catch{}try{rmSync(dir,{recursive:true,force:true})}catch(e){if(!['EBUSY','EPERM'].includes(e.code))throw e}}
function MUSTER_OK(n){return /^vsic-\d{8}-\d{6}Z-manuell\.db\.enc$/.test(n||'')}
console.log('Restore '+ok+' bestanden, '+failed+' fehlgeschlagen');process.exitCode=failed?1:0;
