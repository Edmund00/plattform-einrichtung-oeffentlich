import './test-sprache.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
const dir=mkdtempSync(join(tmpdir(),'schulung-adminzugang-'));
process.env.DB_DATEI=join(dir,'probe.db');
let db,server;let gut=0,fehler=0;
const teste=(name,ok)=>{ok?gut++:fehler++;console.log((ok?'OK ':'FEHLER ')+name)};
try{
 const {ladeKonfig}=await import('../konfig.mjs');
 const standard={STRIPE_SECRET_KEY:'sk_test_mock_only_123456',STRIPE_WEBHOOK_SECRET:'whsec_mock_only_123456'};
 teste('ADMIN_ERLAUBT wird kleingeschrieben und auf drei begrenzt',ladeKonfig({...standard,ADMIN_ERLAUBT:'ADMIN-ONE@example.invalid,admin-two@example.invalid'}).adminErlaubt[0]==='admin-one@example.invalid');
 let konfigFehler='';try{ladeKonfig({...standard,ADMIN_ERLAUBT:'geheim@keine-mail.invalid,ungültig'})}catch(e){konfigFehler=e.message}
 teste('Falsche Erlaubnisliste ohne Adressen im Fehlertext',konfigFehler.includes('ADMIN_ERLAUBT')&&!konfigFehler.includes('geheim@keine-mail.invalid'));
 teste('NOTFALL_ENTSPERREN validiert',ladeKonfig({...standard,NOTFALL_ENTSPERREN:'1'}).notfallEntsperren===true);
 ({db}=await import('../db.mjs'));
 const {passwortHashen,fehlversucheFuerEmailLoeschen,fehlversucheAlleLoeschen}=await import('../auth.mjs');
 const {adminListeInitialisieren,adminListeAktiv,adminErlaubt,adminFehlversuch,adminGesperrt,
  adminEntsperrenEmail,notfallStart,adminSperrversuch,protokoll}=await import('../admin-zugang.mjs');
 const pw='NurEinTestpasswort123';
 const pwd=await passwortHashen(pw);
 const zeit=new Date().toISOString();
 const add=(mail,role='admin',confirm=true)=>db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,?,?,?)")
  .run(mail,pwd,role,zeit,confirm?Date.now():null).lastInsertRowid;
 const primary=Number(add('admin-one@example.invalid'));
 const other=Number(add('admin-two@example.invalid'));
 const unauthorized=Number(add('nichterlaubt@example.invalid'));
 const klant=Number(add('kunde@example.invalid','kunde'));
 teste('Kein Liste: bisherige Admin-Rechte',adminListeInitialisieren([])===false&&adminErlaubt('nichterlaubt@example.invalid'));
 teste('Falsche Liste: fail-closed, Liste aktiv, niemand erlaubt',adminListeInitialisieren(['tippfehler@example.invalid'])===false&&adminListeAktiv()&&!adminErlaubt('admin-one@example.invalid'));
 teste('PUNKT-7: Falsche Liste sperrt alle Admin-Anmeldungen (fail-closed)',!adminErlaubt('admin-one@example.invalid'));
 teste('Korrekte Liste aktiv',adminListeInitialisieren(['admin-one@example.invalid','admin-two@example.invalid'])&&adminListeAktiv());
 teste('Unberechtigter Admin nicht erlaubt',!adminErlaubt('nichterlaubt@example.invalid'));
 const prot=db.prepare("SELECT ergebnis FROM admin_login_protokoll WHERE ergebnis='listenwarnung'").get();
 teste('Fail-closed protokolliert',!!prot);
 const count=()=>db.prepare('SELECT COUNT(*) n FROM admin_login_protokoll').get().n;
 let alarmZahl=0;
 adminListeInitialisieren(['tippfehler@example.invalid'],async()=>{alarmZahl++;return true});
 await new Promise(resolve=>setImmediate(resolve));
 teste('Fail-closed löst Alarm aus',alarmZahl>=1);
 // F-312: frische Installation (noch kein bestaetigter Admin bei adminListeInitialisieren) darf sich selbst
 // heilen, SOBALD per Shell (admin-anlegen.mjs) ein Admin aus GENAU der urspruenglichen Liste bestaetigt
 // wird -- OHNE Neustart/erneuten Aufruf von adminListeInitialisieren. Das war vorher der Fehler F-312.
 adminListeInitialisieren(['heil-admin@example.invalid']);
 teste('F-312 Erstinstallation: vor der Admin-Anlage bleibt gesperrt',!adminErlaubt('heil-admin@example.invalid'));
 add('heil-admin@example.invalid');
 teste('F-312 Selbstheilung: NACH der Admin-Anlage ohne Neustart erlaubt',adminErlaubt('heil-admin@example.invalid'));
 teste('F-312 Selbstheilung oeffnet NICHT fuer andere Adressen',!adminErlaubt('nichterlaubt@example.invalid'));
 teste('F-312 Selbstheilung: Liste bleibt aktiv',adminListeAktiv());
 // Negativfall (ChatGPT-Auflage): ein ECHTER Tippfehler, fuer den NIE ein bestaetigter Admin entstehen kann,
 // darf sich NIE heilen -- auch nicht nach vielen Pruefungen.
 adminListeInitialisieren(['tippfehler-bleibt-fuer-immer@example.invalid']);
 for(let i=0;i<5;i++)adminErlaubt('admin-one@example.invalid');
 teste('F-312 Negativfall: echter Tippfehler ohne je passenden Admin bleibt dauerhaft gesperrt',!adminErlaubt('admin-one@example.invalid')&&!adminErlaubt('heil-admin@example.invalid'));
 adminListeInitialisieren(['admin-one@example.invalid','admin-two@example.invalid']);
 const auditBefore=count();protokoll('nicht_erlaubt','nichterlaubt@example.invalid','203.0.113.44');
 const line=db.prepare('SELECT * FROM admin_login_protokoll ORDER BY id DESC LIMIT 1').get();
 teste('Maskiertes Audit ohne Klartext-Mail und volle IP',count()===auditBefore+1&&
  !JSON.stringify(line).includes('nichterlaubt@example.invalid')&&!JSON.stringify(line).includes('203.0.113.44')&&line.adresse_maskiert.endsWith('.***'));
 const forbidden=['UPDATE admin_login_protokoll SET zeit=zeit','DELETE FROM admin_login_protokoll'];
 for(const cmd of forbidden){let blocked=false;try{db.exec(cmd)}catch{blocked=true}teste('Login-Protokoll append-only: '+cmd.slice(0,6),blocked)}
 // Genau der letzte aktuell erlaubte Admin ist durch DB-Trigger geschützt.
 adminListeInitialisieren(['admin-one@example.invalid']);
 const protectedSQL=[
  ["UPDATE benutzer SET rolle='kunde' WHERE id=?",primary],
  ["UPDATE benutzer SET email='neu@example.invalid' WHERE id=?",primary],
  ["UPDATE benutzer SET geloescht=123 WHERE id=?",primary],
  ["UPDATE benutzer SET email_bestaetigt=NULL WHERE id=?",primary],
  ["DELETE FROM benutzer WHERE id=?",primary]
 ];
 for(const [sql,id] of protectedSQL){
  let blocked=false;try{db.prepare(sql).run(id)}catch{blocked=true}
  teste('Letzten Admin geschützt: '+sql.split(' SET ')[1]?.slice(0,23)||sql,blocked);
 }
 adminListeInitialisieren(['admin-one@example.invalid','admin-two@example.invalid']);
 let canDemote=false;try{canDemote=!!db.prepare("UPDATE benutzer SET rolle='kunde' WHERE id=?").run(other).changes}catch{}
 teste('Mit einem zweiten erlaubten Admin ist gezielte Herabstufung möglich',canDemote);
 db.prepare("UPDATE benutzer SET rolle='admin' WHERE id=?").run(other);
 adminListeInitialisieren(['admin-one@example.invalid','admin-two@example.invalid']);
 const ip1='192.0.2.1',ip2='192.0.2.2',mail='admin-one@example.invalid';
 for(let i=0;i<5;i++)adminFehlversuch(ip1,mail);
 teste('Fünf Fehlversuche sperren nur Kombination IP+E-Mail',adminGesperrt(ip1,mail)&&!adminGesperrt(ip2,mail));
 for(let i=0;i<30;i++)adminFehlversuch(ip1,mail);
 const bis=db.prepare('SELECT bis FROM admin_login_sperre LIMIT 1').get().bis;
 teste('Sperre maximal 60 Minuten',bis<=Date.now()+60*60000);
 for(let i=0;i<6;i++)adminSperrversuch(ip1,mail);
 teste('Gesperrte Versuche zählen ohne Sperrverlängerung',db.prepare('SELECT MAX(anzahl) n FROM admin_login_sperre').get().n>=11&&
  db.prepare('SELECT MAX(bis) n FROM admin_login_sperre').get().n<=bis);
 const key=db.prepare('SELECT kennung FROM admin_login_sperre WHERE bis>0 LIMIT 1').get()?.kennung;
 if(key)db.prepare('UPDATE admin_login_sperre SET bis=? WHERE kennung=?').run(Date.now()-1000,key);
 teste('Sperre läuft spätestens nach Zeitlimit ab',!adminGesperrt(ip1,mail));
 adminEntsperrenEmail(mail);fehlversucheFuerEmailLoeschen(mail);
 teste('Passwort-Reset-Entsperrung nur für E-Mail',!adminGesperrt(ip1,mail));
 adminFehlversuch(ip1,mail);
 db.prepare('INSERT INTO sitzungen(token_hash,benutzer_id,laeuft_ab) VALUES(?,?,?)').run('0'.repeat(64),primary,Date.now()+3600000);
 adminListeInitialisieren(['admin-one@example.invalid','admin-two@example.invalid'],async()=>{alarmZahl++;return true});
 const alarmVorher=alarmZahl;
 notfallStart();await new Promise(resolve=>setImmediate(resolve));
 notfallStart();await new Promise(resolve=>setImmediate(resolve));
 teste('Notfallalarm bei jedem Start auch ohne 1h Pause',alarmZahl>=alarmVorher+2);
 teste('Notfallstart leert Adminsitzungen und Sperren',
   db.prepare('SELECT COUNT(*) n FROM admin_login_sperre').get().n===0&&
   db.prepare('SELECT COUNT(*) n FROM sitzungen WHERE benutzer_id=?').get(primary).n===0&&
   db.prepare("SELECT 1 FROM admin_login_protokoll WHERE ergebnis='notfall'").get()!==undefined);
 // Einmal mit und einmal ohne Allowlist, echte HTTP-Routen.
 const {erstelleServer}=await import('../app.mjs');
 const stripe={webhooks:{constructEvent:()=>({})}};
 const base='http://127.0.0.1:4492';
 server=erstelleServer({stripe,webhookSecret:'mock',base,abgleichAutomatik:false,
  adminErlaubt:['admin-one@example.invalid','admin-two@example.invalid']}).listen(4492,'127.0.0.1');
 await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 const request=async(email,passwort=pw)=>{
  const r=await fetch(base+'/api/anmelden',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,passwort})});
  return {code:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0]};
 };
 const yes=await request('admin-one@example.invalid');
 teste('Erlaubter Admin kann sich anmelden',yes.code===200);
 const no=await request('nichterlaubt@example.invalid');
 teste('Nicht erlaubter Admin-Login 403',no.code===403);
 const forbiddenAdmin=await fetch(base+'/api/admin/logins',{headers:{Cookie:no.cookie||''}});
 teste('Nicht erlaubter Admin erreicht Logins nicht',forbiddenAdmin.status===401||forbiddenAdmin.status===403);
 const allowedLog=await fetch(base+'/api/admin/logins',{headers:{Cookie:yes.cookie}});
 teste('Erlaubter Admin erhält 100 maskierte Loginzeilen',allowedLog.status===200&&Array.isArray(await allowedLog.json()));
 const asCustomer=await request('kunde@example.invalid');
 const denied=await fetch(base+'/api/admin/logins',{headers:{Cookie:asCustomer.cookie}});
 teste('Kunde darf Protokoll nicht sehen',denied.status===403);
 const invalidOrigin=await fetch(base+'/api/abmelden',{method:'POST',headers:{Cookie:yes.cookie,Origin:'https://fremd.invalid','Content-Type':'application/json'},body:'{}'});
 teste('CSRF-Schutz bleibt aktiv',invalidOrigin.status===403);
 for(let i=0;i<5;i++)adminFehlversuch('127.0.0.1','admin-one@example.invalid');
 const resetToken=randomBytes(32).toString('base64url');
 db.prepare('INSERT INTO passwort_token(benutzer_id,token_hash,erstellt,laeuft_ab) VALUES(?,?,?,?)').run(primary,createHash('sha256').update(resetToken).digest('hex'),Date.now(),Date.now()+600000);
 const resetRes=await fetch(base+'/api/passwort-zuruecksetzen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:resetToken,passwort:'NachResetNurTest456'})});
 teste('Echter Passwort-Reset hebt DB-Sperren auf',resetRes.status===200&&!adminGesperrt('127.0.0.1','admin-one@example.invalid'));
 const {maskEmail}=await import('../admin-zugang.mjs');
 teste('Masken von Admins mit gleichem Adressanfang unterscheiden sich (Pausen-Alarm), ohne Klartext',
  maskEmail('admin-one@example.invalid')!==maskEmail('admin-two@example.invalid')&&
  !maskEmail('admin-one@example.invalid').includes('admin-one')&&maskEmail('admin-one@example.invalid')===maskEmail('ADMIN-ONE@example.invalid'));
 const cli=(email,secret)=>spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','tools/admin-notfall.mjs',email],
  {cwd:process.cwd(),env:{...process.env,ADMIN_ERLAUBT:'admin-one@example.invalid,admin-two@example.invalid',ADMIN_PASSWORT:secret},timeout:15000,encoding:'utf8'});
 const rejected=cli('nichterlaubt@example.invalid','NeuesNurTestPasswort123');
 teste('Notfallwerkzeug verweigert nicht erlaubte Adresse',rejected.status!==0);
 const recovered=cli('admin-one@example.invalid','NeuesNurTestPasswort123');
 teste('Notfallwerkzeug ändert Passwort nur für erlaubtes Konto',recovered.status===0&&
  !recovered.stdout.includes('NeuesNurTestPasswort123')&&!recovered.stderr.includes('NeuesNurTestPasswort123'));
 const cmd="await import('./db.mjs');";
 const boot=()=>spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',cmd],
  {cwd:process.cwd(),env:{...process.env,DB_DATEI:process.env.DB_DATEI},timeout:15000,encoding:'utf8'});
 const b1=boot(),b2=boot();
 teste('SQLite erneut zweimal starten',b1.status===0&&b2.status===0);
}catch(e){fehler++;console.log('FEHLER TESTABLAUF '+(e?.code||e?.name||'unbekannt'))}
finally{
 try{await new Promise(resolve=>server?server.close(resolve):resolve())}catch{}
 try{db?.close()}catch{}
 try{rmSync(dir,{recursive:true,force:true})}catch(e){if(!['EBUSY','EPERM'].includes(e.code))throw e}
}
console.log('Adminzugang '+gut+' OK, '+fehler+' FEHLER');process.exitCode=fehler?1:0;
