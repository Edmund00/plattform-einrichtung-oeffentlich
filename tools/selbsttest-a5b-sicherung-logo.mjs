// Offline-Integration: echte DB, Sicherungsdienst und Restore-Werkzeug, keine Server.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {machLogoPfad,LOGO_MAX_BYTES} from '../logo-png.mjs';
import {verschluesseln} from '../sicherung-format.mjs';

if(process.argv[2]==='--sichern'){
 const {db}=await import('../db.mjs');
 try{
  const {sicherungDienst}=await import('../sicherung.mjs');
  const result=await sicherungDienst({ordner:process.argv[3],schluessel:Buffer.from(process.argv[4],'base64')}).lauf('manuell');
  assert.equal(result.ok,true);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='sicherung_logo'").get(),undefined);
  console.log(JSON.stringify({...result,meldung:db.prepare('SELECT kurze_meldung FROM sicherung_protokoll ORDER BY id DESC LIMIT 1').get().kurze_meldung}));
 }finally{db.close()}
}else{
 const dir=mkdtempSync(join(tmpdir(),'a5b-logo-')),key=randomBytes(32).toString('base64');
 const a=join(dir,'a','data.db'),b=join(dir,'b','data.db');
 let ok=0;
 const check=(name,fn)=>{fn();ok++;console.log('OK '+name)};
 const run=(args,env={})=>{
  const r=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',...args],{env,encoding:'utf8',timeout:30000});
  assert.ifError(r.error);
  assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout+r.stderr;
 };
 const sichern=(datei,ordner)=>JSON.parse(run([resolve('tools/selbsttest-a5b-sicherung-logo.mjs'),'--sichern',ordner,key],{DB_DATEI:datei}).trim().split('\n')[0]);
 const restore=(enc,out,...options)=>run(['tools/sicherung-entschluesseln.mjs',enc,out,...options],{SICHERUNG_SCHLUESSEL:key});
 const rows=db=>Object.fromEntries(['marke','recht_text','recht_aktiv'].map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY 1,2').all()]));
 try{
  // Initialisierung durch db.mjs im isolierten Prozess.
  sichern(a,join(dir,'init'));
  const live=new DatabaseSync(a);
  live.exec('CREATE TABLE IF NOT EXISTS marke(schluessel TEXT PRIMARY KEY,wert TEXT NOT NULL,aktualisiert_am TEXT NOT NULL)');
  live.prepare("INSERT INTO marke(schluessel,wert,aktualisiert_am) VALUES(?,?,?)").run('name','A5b Marke','2026-11-16');
  live.prepare("INSERT INTO marke(schluessel,wert,aktualisiert_am) VALUES(?,?,?)").run('farben',JSON.stringify({primaer:'#123456'}),'2026-11-16');
  live.prepare("INSERT INTO marke(schluessel,wert,aktualisiert_am) VALUES(?,?,?)").run('anbieter',JSON.stringify({name:'Test GmbH',email:'test@example.org'}),'2026-11-16');
  // Spalten aus dem echten Schema; keine App und kein HTTP nötig.
  const schema=live.prepare('PRAGMA table_info(recht_text)').all();
  const values={seite:'impresszum',sprache:'de',version:1,inhalt:'Rechtstext A5b',erstellt:'2026-11-16',bearbeiter:'admin'};
  const cols=schema.filter(c=>c.name!=='id'&&(c.name in values));
  live.prepare(`INSERT INTO recht_text(${cols.map(c=>c.name)}) VALUES(${cols.map(()=>'?')})`).run(...cols.map(c=>values[c.name]));
  live.prepare("INSERT INTO recht_aktiv(seite,version) VALUES('impresszum',1)").run();
  const expected=rows(live);live.close();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  mkdirSync(dirname(machLogoPfad(a)),{recursive:true});writeFileSync(machLogoPfad(a),png);
  const first=sichern(a,join(dir,'backup'));const enc=join(dir,'backup',first.dateiname);
  mkdirSync(dirname(b),{recursive:true});const output=restore(enc,b);
  check('Logo bytegleich und Erfolgsmeldung',()=>{assert.match(output,/Logo wiederhergestellt/);assert.deepEqual(readFileSync(machLogoPfad(b)),png)});
  const restored=new DatabaseSync(b);
  check('Marke und Recht unverändert; Transporttabelle entfernt',()=>{assert.deepEqual(rows(restored),expected);assert.equal(restored.prepare("SELECT name FROM sqlite_master WHERE name='sicherung_logo'").get(),undefined)});restored.close();
  check('Zweite Sicherung nach Restore; Live-DB ohne Transporttabelle',()=>sichern(b,join(dir,'zweite')));
  for(const mode of ['fehlt','zu-gross','nicht-lesbar']){
   rmSync(machLogoPfad(a),{force:true,recursive:true});
   if(mode==='zu-gross')writeFileSync(machLogoPfad(a),Buffer.alloc(LOGO_MAX_BYTES+1));
   if(mode==='nicht-lesbar')mkdirSync(machLogoPfad(a));
   const folder=join(dir,mode),result=sichern(a,folder),out=join(dir,mode+'.db');
   check('Sicherung ohne Logo: '+mode,()=>{assert.match(result.meldung,/logo/);assert.match(restore(join(folder,result.dateiname),out),/kein Logo in der Sicherung/)});
  }
  const old=join(dir,'alt.enc');writeFileSync(old,verschluesseln(readFileSync(b),Buffer.from(key,'base64')));
  check('Alte Sicherung ohne Tabelle',()=>assert.match(restore(old,join(dir,'alt.db')),/kein Logo in der Sicherung/));
  const custom=join(dir,'custom','logo.png');
  check('Expliziter Logo-Ausgabepfad',()=>{assert.match(restore(enc,join(dir,'custom.db'),'--logo-ausgabe='+custom),/Logo wiederhergestellt/);assert.deepEqual(readFileSync(custom),png)});
  writeFileSync(custom,'bewahren');
  check('Vorhandenes Logo bleibt; DB-Restore gelingt mit Warnung',()=>{
   const out=join(dir,'konflikt.db');assert.match(restore(enc,out,'--logo-ausgabe='+custom),/Warnung/);assert.equal(readFileSync(custom,'utf8'),'bewahren');
   const d=new DatabaseSync(out);try{assert.deepEqual(rows(d),expected);assert.equal(d.prepare("SELECT name FROM sqlite_master WHERE name='sicherung_logo'").get(),undefined)}finally{d.close()}
  });
  check('Vorhandene Ausgabe-DB bleibt geschützt',()=>{const before=readFileSync(b);const r=spawnSync(process.execPath,['tools/sicherung-entschluesseln.mjs',enc,b],{env:{SICHERUNG_SCHLUESSEL:key},encoding:'utf8'});assert.ifError(r.error);assert.equal(r.status,1);assert.deepEqual(readFileSync(b),before)});
 }finally{rmSync(dir,{recursive:true,force:true})}
 console.log('A5b Sicherung Logo: '+ok+' bestanden');
}
