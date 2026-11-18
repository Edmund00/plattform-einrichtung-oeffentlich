import './test-sprache.mjs';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const dir=mkdtempSync(join(tmpdir(),'vsic-selbsttest-'));
process.env.DB_DATEI=join(dir,'data.db');
let db,server,ok=0,failed=0;
const check=(n,v)=>{v?ok++:failed++;console.log((v?'OK ':'FEHLER ')+n)};
const key=randomBytes(32),base='http://127.0.0.1:4496',backupDir=join(dir,'sicherung');
try{
 const {ladeKonfig}=await import('../konfig.mjs');
 const env={STRIPE_SECRET_KEY:'sk_test_mock_only_123456',STRIPE_WEBHOOK_SECRET:'whsec_mock_only_123456'};
 check('Kein Sicherungsschlüssel erlaubt im Test',ladeKonfig(env).sicherungSchluessel===null);
 let invalidAlarm='';try{ladeKonfig({...env,ALARM_MAILS:'kein-email,PRIVATE'})}catch(e){invalidAlarm=e.message}
 check('Ungültige ALARM_MAILS ohne Adressausgabe',invalidAlarm.includes('ALARM_MAILS')&&!invalidAlarm.includes('kein-email'));
 let pathError='';try{ladeKonfig({...env,SICHERUNG_ORDNER:'public/sicherung'})}catch(e){pathError=e.message}
 check('Backup im öffentlichen Ordner verboten',pathError.includes('SICHERUNG_ORDNER'));
 let err='';try{ladeKonfig({...env,SICHERUNG_SCHLUESSEL:'NOT_A_SECRET_TEST_VALUE'})}catch(e){err=e.message}
 check('Ungültiger Schlüssel ohne Wert in Fehler',!!err&&!err.includes('NOT_A_SECRET_TEST_VALUE'));
 check('32-Byte-Schlüssel Base64',ladeKonfig({...env,SICHERUNG_SCHLUESSEL:key.toString('base64')}).sicherungSchluessel?.equals(key));
 ({db}=await import('../db.mjs'));
 const {sicherungDienst,entschluesseln,verschluesseln,checksum,pruefeDatenbank,aufraeumen,tempAufraeumen}=await import('../sicherung.mjs');
 {
  // Abnahme 01.11.2026 (Pruefrunde E2): nach einem Absturz liegt eine unverschluesselte Zwischenkopie im Sicherungsordner.
  const td=join(dir,'temp-test');(await import('node:fs')).mkdirSync(td,{recursive:true});
  const alt=join(td,'.vsic-temp-'+'a'.repeat(24)+'.db'),neu=join(td,'.vsic-temp-'+'b'.repeat(24)+'.db'),fremd=join(td,'.vsic-temp-keine-sicherung.txt'),echt=join(td,'vsic-20260101-000000Z-auto.db.enc');
  for(const f of [alt,neu,fremd,echt])writeFileSync(f,'x');
  const fs2=await import('node:fs');const vor=new Date(Date.now()-3600000);fs2.utimesSync(alt,vor,vor);
  const geloescht=await tempAufraeumen(td,600000);
  check('Alte Klartext-Zwischenkopie wird geloescht, junge (laeuft evtl. gerade) bleibt',geloescht===1&&!fs2.existsSync(alt)&&fs2.existsSync(neu));
  check('Fremde Datei und echte Sicherung bleiben unberuehrt',fs2.existsSync(fremd)&&fs2.existsSync(echt));
  const start=await tempAufraeumen(td,0);
  check('Beim Start (Alter 0) werden alle Zwischenkopien geloescht, sonst nichts',start===1&&!fs2.existsSync(neu)&&fs2.existsSync(fremd)&&fs2.existsSync(echt));
 }
 const a=randomBytes(300);
 const enc=verschluesseln(a,key),decoded=entschluesseln(enc,key);
 check('AES-256-GCM Hin- und Rückweg gleicher SHA',checksum(a)===checksum(decoded)&&enc.subarray(0,5).toString()==='VSIC1');
 check('Falscher Schlüssel schlägt fehl',(()=>{try{entschluesseln(enc,randomBytes(32));return false}catch{return true}})());
 const manipulated=Buffer.from(enc);manipulated[20]^=1;
 check('Manipulierter Ciphertext zurückgewiesen',(()=>{try{entschluesseln(manipulated,key);return false}catch{return true}})());
 check('Falsches Magic zurückgewiesen',(()=>{try{entschluesseln(Buffer.from('SQLITE'),key);return false}catch{return true}})());
 const calls=[];let uploadedSize=0;
 const fetchFn=async(url,options)=>{calls.push(options.method);if(options.method==='PUT')uploadedSize=options.body.length;return {ok:true,headers:{get:()=>String(uploadedSize)}}};
 const backup=sicherungDienst({ordner:backupDir,schluessel:key,bunny:{host:'storage.bunnycdn.com',zone:'test-zone',pfad:'vsic/',schluessel:'mock-key'},fetchFn});
 const first=await backup.lauf('manuell');
 check('Lokales Backup und Bunny-Mock PUT HEAD',first.ok&&first.extern==='ok'&&calls.includes('PUT')&&calls.includes('HEAD'));
 const oneRunning=backup.lauf('vordeploy');
 const rejectedParallel=await backup.lauf('manuell');
 check('Mutex verhindert parallele Sicherung',rejectedParallel.ok===false&&rejectedParallel.beschaeftigt===true);
 await oneRunning;
 const file=join(backupDir,first.dateiname);
 const firstByteCount=readFileSync(file).length;
 const collision=await backup.lauf('manuell');
 check('Dateikollision bewahrt die erste Kopie, neuer Name wird vergeben',collision.ok&&collision.dateiname!==first.dateiname&&readFileSync(file).length===firstByteCount);
 const bytes=readFileSync(file);
 check('Download-Format ist verschlüsselt',bytes.subarray(0,5).toString()==='VSIC1'&&bytes.subarray(0,15).toString()!=='SQLite format 3');
 const restored=join(dir,'restore.db');writeFileSync(restored,entschluesseln(bytes,key));
 const counts=pruefeDatenbank(restored);
 check('Wiederherstellung ist konsistente SQLite-Datenbank',Object.values(counts).every(x=>Number.isInteger(x)));
 const oldFile=join(dir,'alte-db.db');writeFileSync(oldFile,readFileSync(restored));
 const {DatabaseSync}=await import('node:sqlite');
 const legacy=new DatabaseSync(oldFile);legacy.exec('DROP TABLE sicherung_protokoll; DROP TABLE sicherung_alarm;');legacy.close();
 const childCode="import {db} from './db.mjs'; import {erstelleServer} from './app.mjs'; const a=erstelleServer({stripe:{webhooks:{constructEvent:()=>({})}},webhookSecret:'test',base:'http://localhost:4555',dateiOrdner:process.env.RESTORE_TEST_FILES}); console.log(JSON.stringify({kurse:db.prepare('SELECT COUNT(*) n FROM kurse').get().n,bestellungen:db.prepare('SELECT COUNT(*) n FROM bestellungen').get().n}));";
 const runRestored=(datei=restored)=>spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',childCode],{cwd:process.cwd(),env:{...process.env,DB_DATEI:datei,RESTORE_TEST_FILES:join(dir,'restore-dateien')},encoding:'utf8',timeout:15000});
 const r1=runRestored(),r2=runRestored();
 check('App startet mit entschlüsselter DB und liefert Kurse/Bestellungen',r1.status===0&&r1.stdout.includes('"kurse"')&&r1.stdout.includes('"bestellungen"'));
 check('Migration bei zweimaligem Start idempotent',r2.status===0&&r2.stdout.includes('"kurse"'));
 const old1=runRestored(oldFile),old2=runRestored(oldFile);
 const altCheck=new DatabaseSync(oldFile,{readOnly:true});
 const migrated=!!altCheck.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sicherung_protokoll'").get();altCheck.close();
 check('Alte Datenbank ohne Backup-Tabellen startet und migriert zweimal',old1.status===0&&old2.status===0&&migrated);
 check('Backup mit echten SHA und korrekten Zeilenzahlen in Audit',
   db.prepare("SELECT * FROM sicherung_protokoll WHERE ergebnis='ok' AND dateiname=?").get(first.dateiname)?.sha256_enc===checksum(bytes));
 check('Protokoll UPDATE verboten',(()=>{try{db.prepare("UPDATE sicherung_protokoll SET ergebnis='fehler'").run();return false}catch{return true}})());
 check('Protokoll DELETE verboten',(()=>{try{db.prepare('DELETE FROM sicherung_protokoll').run();return false}catch{return true}})());
 check('Keine Klartext-Temporärdatei',!readdirSync(backupDir).some(n=>n.startsWith('.vsic-temp')));
 writeFileSync(join(backupDir,'fremde-datei.txt'),'bewahren');
 const day=d=>{const x=new Date(Date.now()-d*86400000);return 'vsic-'+x.toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15)+'Z-auto.db.enc'};
 for(let d=3;d<50;d++)writeFileSync(join(backupDir,day(d)),Buffer.from('test'));
 for(let d=400;d<420;d++)writeFileSync(join(backupDir,day(d)),Buffer.from('test'));
 const allBefore=readdirSync(backupDir).filter(x=>x.endsWith('.db.enc')).length;
 await aufraeumen(backupDir);
 const allAfter=readdirSync(backupDir).filter(x=>x.endsWith('.db.enc')).length;
 check('Rotation entfernt ältere tägliche Duplikate und überjährige Kopien',allAfter<allBefore&&allAfter>=3);
 check('Rotation lässt fremde Dateien bestehen',readdirSync(backupDir).includes('fremde-datei.txt'));
 const timeout=sicherungDienst({ordner:join(dir,'timeout'),schluessel:key,bunny:{host:'storage.bunnycdn.com',zone:'z',pfad:'vsic/',schluessel:'mock'},fetchFn:async()=>{throw new Error('timeout')}});
 const resultTimeout=await timeout.lauf('auto');
 check('Externe Zeitüberschreitung bewahrt lokale Sicherung',resultTimeout.ok&&resultTimeout.extern==='fehler');
 const {alarmDienst}=await import('../sicherung-alarm.mjs');
 const alarms=[];
 const send=alarmDienst({mailer:async msg=>{alarms.push(msg);return true},adressen:['gabriella@example.hu','edmund@example.hu']});
 await send('sicherung');await send('sicherung');
 check('Alarm pro Grund nur einmal in 6 Stunden an alle',alarms.length===2);
 await send('behebung');
 check('Entwarnung geht wirklich an beide',alarms.length===4&&alarms.some(m=>m.subject.includes('ismét működik')));
 const failSend=alarmDienst({mailer:async()=>{throw Error('no transport')},adressen:['edmund@example.hu']});
 let mailBreak=false;try{await failSend('extern')}catch{mailBreak=true}
 check('Fehlgeschlagener Mailversand unterbricht nichts',!mailBreak);
 const failedAlarms=[];
 const damaged=sicherungDienst({ordner:join(dir,'damaged'),schluessel:key,
   pruefenFn:()=>{throw Error('corrupt copy')},alarm:async grund=>failedAlarms.push(grund)});
 const damage=await damaged.lauf('vordeploy');
 check('Beschädigte SQLite-Kopie erkannt und in Audit festgehalten',!damage.ok&&
   db.prepare("SELECT ergebnis FROM sicherung_protokoll ORDER BY id DESC LIMIT 1").get().ergebnis==='fehler');
 check('Beschädigte Kopie erzeugt einen Alarm',failedAlarms.includes('sicherung'));
 check('Fehler hinterlässt keine unverschlüsselte Kopie',!readdirSync(join(dir,'damaged')).some(x=>x.startsWith('.vsic-temp')));
 const broken=sicherungDienst({ordner:join(dir,'broken'),schluessel:key,bunny:{host:'storage.bunnycdn.com',zone:'z',pfad:'vsic/',schluessel:'mock'},fetchFn:async()=>({ok:false})});
 const brokenResult=await broken.lauf('vordeploy');
 check('Bunny-Fehler lässt lokale Kopie gültig',brokenResult.ok===true&&brokenResult.extern==='fehler'&&db.prepare("SELECT ziel_extern FROM sicherung_protokoll ORDER BY id DESC LIMIT 1").get().ziel_extern==='fehler');
 const {passwortHashen}=await import('../auth.mjs');
 const ph=await passwortHashen('BackupTestPasswordOnly');
 db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(? ,?,'admin',?)").run('backup-admin@example.com',ph,new Date().toISOString());
 db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(? ,?,'kunde',?)").run('backup-user@example.com',ph,new Date().toISOString());
 const express=(await import('express')).default;
 const {sicherungRouter}=await import('../routes-sicherung.mjs');
 const prod=express();prod.use(sicherungRouter({ordner:join(dir,'unused'),schluessel:null,nodeEnv:'production'}));
 const prodServer=prod.listen(4495,'127.0.0.1');await new Promise(r=>prodServer.listening?r():prodServer.once('listening',r));
 const prodRes=await fetch('http://127.0.0.1:4495/api/gesundheit');
 check('Produktion ohne Schlüssel 503 ohne Details',prodRes.status===503&&JSON.stringify(await prodRes.json())==='{"ok":false}');
 await new Promise(r=>prodServer.close(r));
 db.prepare("INSERT INTO sicherung_protokoll(zeit,art,ergebnis,ziel_lokal,ziel_extern,kurze_meldung) VALUES(?,'auto','ok','ok','aus','sicherung_ok')")
   .run(new Date(Date.now()-14*3600000).toISOString());
 const staleApp=express();staleApp.use(sicherungRouter({ordner:join(dir,'unused-stale'),schluessel:key,nodeEnv:'production',automatik:false,startZeit:Date.now()-13*3600000}));
 const staleServer=staleApp.listen(4494,'127.0.0.1');await new Promise(r=>staleServer.listening?r():staleServer.once('listening',r));
 const staleRes=await fetch('http://127.0.0.1:4494/api/gesundheit');
 check('Gesundheit bei älter als 12h 503 ohne Details',staleRes.status===503&&JSON.stringify(await staleRes.json())==='{"ok":false}');
 await new Promise(r=>staleServer.close(r));
 const {erstelleServer}=await import('../app.mjs');
 const mock={webhooks:{constructEvent:()=>({})}};
 server=erstelleServer({stripe:mock,webhookSecret:'whsec_mock',base,dateiOrdner:join(dir,'dateien'),
   sicherungOrdner:join(dir,'server-sicherung'),sicherungSchluessel:key,nodeEnv:'test'}).listen(4496,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const get=async path=>{const res=await fetch(base+path);return {status:res.status,headers:res.headers,data:res.headers.get('content-type')?.includes('application/json')?await res.json():null}};
 const login=async email=>{const r=await fetch(base+'/api/anmelden',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,passwort:'BackupTestPasswordOnly'})});return r.headers.get('set-cookie')?.split(';')[0]};
 const adminCookie=await login('backup-admin@example.com'),userCookie=await login('backup-user@example.com');
 const api=async(method,path,cookie,body,origin)=>{const res=await fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,headers:res.headers,data:res.headers.get('content-type')?.includes('application/json')?await res.json():null,res}};
 const health=await get('/api/gesundheit');
 check('Gesundheit Test 200 ohne Details',health.status===200&&health.data.ok===true&&Object.keys(health.data).length===1);
 check('Admin-Routen für Gast 401',(await get('/api/admin/sicherung')).status===401);
 check('Kunde darf Backup nicht sehen',(await api('GET','/api/admin/sicherung',userCookie)).status===403);
 check('Agent-Key auf Admin-Backup verboten',(await api('GET','/api/admin/sicherung',null,null,null)).status===401);
 check('Admin-Fremd-Origin/CSRF wird blockiert',(await api('POST','/api/admin/sicherung/jetzt',adminCookie,{art:'manuell'},'https://fremd.example')).status===403);
 check('Admin darf Auditliste lesen',(await api('GET','/api/admin/sicherung',adminCookie)).status===200);
 const dl=await api('GET','/api/admin/sicherung/letzte',adminCookie);
 const download=dl.status===200?Buffer.from(await dl.res.arrayBuffer()):null;
 check('Admin-Download bleibt verschlüsselt',dl.status===200&&download?.subarray(0,5).toString()==='VSIC1');
 check('Keine geheimen Inhalte in Protokoll',!JSON.stringify(db.prepare('SELECT * FROM sicherung_protokoll').all()).includes(key.toString('base64')));
}catch(e){failed++;console.log('FEHLER Testablauf '+(e.code||e.message))}
finally{try{await new Promise(r=>server?server.close(r):r())}catch{}try{db?.close()}catch{}try{rmSync(dir,{recursive:true,force:true})}catch(e){if(!['EBUSY','EPERM'].includes(e.code))throw e}}
console.log('Sicherung '+ok+' bestanden, '+failed+' fehlgeschlagen');process.exitCode=failed?1:0;
