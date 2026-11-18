// Scheibe 14: Unabhaengiger Offline-Test, keine externen E-Mails oder Stripe-Zahlungen.
import './test-sprache.mjs';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const temp=mkdtempSync(join(tmpdir(),'schulung-email-'));
const DATEI=join(temp,'alt.db');
process.env.DB_DATEI=DATEI; // vor Modulimport
const basis='http://127.0.0.1:4441';
const pw=randomBytes(32).toString('hex');
let bestanden=0,fehler=0,server,ohneServer;
const logAusgaben=[];
const altesWarn=console.warn, altesError=console.error;
console.warn=(...a)=>{logAusgaben.push(a.map(String).join(' '));};
console.error=(...a)=>{logAusgaben.push(a.map(String).join(' '));};
const pruefe=(titel,ok)=>{ok?bestanden++:fehler++;console.log((ok?'OK     ':'FEHLER ')+titel);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function warte(b,anzahl=150){for(let i=0;i<anzahl;i++){if(b())return true;await pause(10);}return false;}
const d=()=>new DatabaseSync(DATEI);
function sql(q,...params){const x=d();try{return x.prepare(q).all(...params);}finally{x.close();}}
function exec(q,...params){const x=d();try{return x.prepare(q).run(...params);}finally{x.close();}}
const eins=(q,...params)=>sql(q,...params)[0];
function klient(host=basis) {
 let cookie='';
 return { async api(m,path,body){
  const headers={};
  if(cookie)headers.Cookie=cookie;
  const opts={method:m,headers};
  if(body!==undefined){headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
  const r=await fetch(host+path,opts);
  const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];
  return {s:r.status,d:await r.json().catch(()=>({})),h:r.headers};
 },get cookie(){return cookie;} };
}
let versand=[],emailsFehler=false,stripeAufrufe=0;
const mailer=async email=>{versand.push(email);return !emailsFehler;};
const stripe={
 customers:{create:async()=>{stripeAufrufe++;return{id:'cus_bestaetigung_'+stripeAufrufe};}},   // je Aufruf eindeutig (stripe_kunde ist UNIQUE)
 checkout:{sessions:{create:async()=>{stripeAufrufe++;return{id:'cs_test_bestaetigung_mock_'+stripeAufrufe,url:'https://checkout.stripe.com/c/atest'};}}},
 webhooks:{constructEvent:()=>{throw Error('not used');}},
};
try {
 // Alter Benutzer ohne Spalte email_bestaetigt, der nach Migration weiterarbeiten muss.
 const alt=d();
 alt.exec("CREATE TABLE benutzer(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL UNIQUE,passwort_hash TEXT NOT NULL,stripe_kunde TEXT UNIQUE,rolle TEXT NOT NULL DEFAULT 'kunde',erstellt TEXT NOT NULL)");
 alt.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt) VALUES(?,?,?)").run('alt@example.com','scrypt$00$00',new Date().toISOString());
 alt.close();
 const start=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',
   "import('./db.mjs').then(()=>process.exit(0)).catch(()=>process.exit(1))"],
   {cwd:resolve('.'),env:{...process.env,DB_DATEI:DATEI},encoding:'utf8'});
 pruefe('Migration auf echter Alttabelle erfolgreich',start.status===0);
 const vorher=eins('SELECT email_bestaetigt FROM benutzer WHERE email=?','alt@example.com').email_bestaetigt;
 pruefe('Bestandskonto erhält Bestätigungszeitpunkt',Number.isSafeInteger(vorher)&&vorher>0);
 const erneut=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',
   "import('./db.mjs').then(()=>process.exit(0)).catch(()=>process.exit(1))"],
   {cwd:resolve('.'),env:{...process.env,DB_DATEI:DATEI},encoding:'utf8'});
 pruefe('Migration beim zweiten Start idempotent',erneut.status===0&&eins('SELECT email_bestaetigt FROM benutzer WHERE email=?','alt@example.com').email_bestaetigt===vorher);
 const adminMail='bestaetigung-admin@example.com';
 const admin=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','tools/admin-anlegen.mjs',adminMail],
   {env:{...process.env,ADMIN_PASSWORT:pw},encoding:'utf8'});
 pruefe('Admin-Skript bestätigt neue Admins sofort',admin.status===0&&eins('SELECT email_bestaetigt FROM benutzer WHERE email=?',adminMail)?.email_bestaetigt>0);

 const {erstelleServer}=await import('../app.mjs');
 server=erstelleServer({stripe,webhookSecret:'test',base:basis,mailer}).listen(4441,'127.0.0.1');
 await new Promise((resolve,reject)=>{if(server.listening)return resolve();server.once('listening',resolve);server.once('error',reject);});
 const gast=klient(),user=klient(),other=klient(),kundeMail='neue-bestaetigung@example.com';
 const reg=await user.api('POST','/api/registrieren',{ zustimmung: true, email:kundeMail,passwort:pw});
 pruefe('Registrierung bleibt 201 und angemeldet',reg.s===201&&(await user.api('GET','/api/ich')).d.angemeldet===true);
 pruefe('Neue E-Mail ist unbestätigt',eins('SELECT email_bestaetigt FROM benutzer WHERE email=?',kundeMail).email_bestaetigt===null);
 pruefe('Mail nach Commit genau einmal erzeugt',await warte(()=>versand.length===1));
 const email=versand[0],link=email?.text.match(/\/#\/megerosites\/([A-Za-z0-9_-]{43})/);
 const token=link?.[1]||'',digest=createHash('sha256').update(token).digest('hex');
 pruefe('Willkommensmail enthält Betreff und Link im Fragment',!!link&&email.subject==='Üdv a Musterakademie előadásokon! Erősítsd meg az e-mail-címedet'&&email.html.includes('Megerősítem'));
 pruefe('E-Mail hat nur einen Einmal-Token (Hash in DB)',!!eins('SELECT id FROM email_token WHERE token_hash=?',digest) &&
   !readFileSync(DATEI).toString('latin1').includes(token));
 pruefe('Nur ein registrierter Mail-Ausgang',eins('SELECT COUNT(*) AS n FROM email_ausgang').n===1);
 pruefe('Resend-Idempotency-Key der Bestätigungsmail gesetzt',
   /^schulung-email-[a-f0-9]{16}-\d+-[a-f0-9]{32}$/.test(email?.idempotencyKey||''));
 const userId=eins('SELECT id FROM benutzer WHERE email=?',kundeMail).id;
 const kurs=await adminLoginKurs();
 async function adminLoginKurs() {
   const gabi=klient();
   const login=await gabi.api('POST','/api/anmelden',{email:adminMail,passwort:pw});
   pruefe('Admin-Testlogin',login.s===200);
   const erstellt=await gabi.api('POST','/api/admin/kurse',
     {titel:'E-Mail-geschützter Kurs',beschreibung:'',preis_cent:10000,abo_preis_cent:10000,abo_intervall:'month',waehrung:'huf'});
   pruefe('Testkurs im Entwurf angelegt',erstellt.s===201);
   await gabi.api('POST','/api/admin/kurse/'+erstellt.d.id+'/veroeffentlichen',{});
   const free=await gabi.api('POST','/api/admin/kurse',{titel:'Gratiszugang',preis_cent:0,waehrung:'huf'});
   await gabi.api('POST','/api/admin/kurse/'+free.d.id+'/veroeffentlichen',{});
   return {id:erstellt.d.id,gratis:free.d.id};
 }
 for(const [art,post] of [['Einmalkauf',{modell:'einmal',zustimmung:true}],['Abo',{modell:'abo',zustimmung:true}],['Gratiszugang',{modell:'einmal',zustimmung:true}]]) {
   const id=art==='Gratiszugang'?kurs.gratis:kurs.id;
   const r=await user.api('POST','/api/kurse/'+id+'/kaufen',post);
   pruefe(art+' unbestätigt: 403 email_unbestaetigt',r.s===403&&r.d.fehler==='email_unbestaetigt');
 }
 pruefe('Vor Verifizierung keine Stripe-Aufrufe/Bestellungen/Zugänge',stripeAufrufe===0&&
   eins('SELECT COUNT(*) AS n FROM bestellungen').n===0&&eins('SELECT COUNT(*) AS n FROM zugaenge').n===0);
 const unbekannt=randomBytes(32).toString('base64url');
 pruefe('Falscher Token 400',(await gast.api('POST','/api/email-bestaetigen',{token:unbekannt})).s===400);
 pruefe('Manipulierter Token 400',(await gast.api('POST','/api/email-bestaetigen',{token:token+'x'})).s===400);
 exec('UPDATE email_token SET laeuft_ab=? WHERE token_hash=?',Date.now()-1,digest);
 pruefe('Abgelaufener Token 400',(await gast.api('POST','/api/email-bestaetigen',{token})).s===400);
 // Neue Anforderung: erster Link bleibt invalidiert; der Mailer erzeugt Ersatz.
 const resend=await user.api('POST','/api/email-bestaetigung-erneut',{});
 pruefe('Erneut neutral HTTP 200',resend.s===200&&resend.d.text);
 pruefe('Genau zweite Mail nach neuer Anforderung',await warte(()=>versand.length===2));
 const neuer=versand[1]?.text.match(/\/#\/megerosites\/([A-Za-z0-9_-]{43})/)?.[1]||'';
 pruefe('Alter Token bleibt entwertet',(await gast.api('POST','/api/email-bestaetigen',{token})).s===400);
 const ok=await gast.api('POST','/api/email-bestaetigen',{token:neuer});
 pruefe('Gültiger Link einmalig bestätigt',ok.s===200&&(await user.api('GET','/api/ich')).d.email_bestaetigt===true);
 pruefe('Doppeltes Bestätigen 400',(await gast.api('POST','/api/email-bestaetigen',{token:neuer})).s===400);
 const checkout=await user.api('POST','/api/kurse/'+kurs.id+'/kaufen',{modell:'einmal',zustimmung:true});
 pruefe('Bestätigt: Checkout freigegeben',checkout.s===200&&stripeAufrufe>0);
 const aboErlaubt=await user.api('POST','/api/kurse/'+kurs.id+'/kaufen',{modell:'abo',zustimmung:true});
 pruefe('Bestätigt: Abo-Checkout freigegeben',aboErlaubt.s===200);
 const gratis=await user.api('POST','/api/kurse/'+kurs.gratis+'/kaufen',{modell:'einmal',zustimmung:true});
 pruefe('Bestätigt: Gratiszugang freigegeben',gratis.s===200&&gratis.d.code==='kostenloser_kurs');
 pruefe('Bestätigung beendet keine aktuelle Sitzung',(await user.api('GET','/api/ich')).d.angemeldet===true);

 // Neuer unbestätigter Kunde, Mail-Ausfall und Wiederholgrenzen.
 emailsFehler=true;
 const user2=klient(),email2='mail-fehler@example.com';
 const regFehler=await user2.api('POST','/api/registrieren',{ zustimmung: true, email:email2,passwort:pw});
 pruefe('Mail-Fehler ändert Registrierung 201 nicht',regFehler.s===201);
 await warte(()=>versand.some(v=>v.to===email2));
 pruefe('Fehlgeschlagene Mail bleibt offen',eins('SELECT status FROM email_ausgang WHERE benutzer_id=(SELECT id FROM benutzer WHERE email=?)',email2)?.status==='offen');
 emailsFehler=false;
 const altEmailToken=versand.find(m=>m.to===email2)?.text.match(/\/\#\/megerosites\/([A-Za-z0-9_-]{43})/)?.[1];
 const neutral=[];
 let vierterOhneSend=false;
 for(let i=0;i<4;i++) {
   const vor=versand.filter(m=>m.to===email2).length;
   neutral.push(await user2.api('POST','/api/email-bestaetigung-erneut',{}));
   if(i<3)await warte(()=>versand.filter(m=>m.to===email2).length>vor);
   else {await pause(40);vierterOhneSend=versand.filter(m=>m.to===email2).length===vor;}
 }
 pruefe('Benutzerlimit 3 pro Stunde, gleiche 200-Antwort',neutral.every(x=>x.s===200&&x.d.text===neutral[0].d.text)&&vierterOhneSend);
 pruefe('Neuer Token macht bisherigen noch gültigen Link ungültig',
   !!altEmailToken && (await gast.api('POST','/api/email-bestaetigen',{token:altEmailToken})).s===400);
 pruefe('Pro Benutzer exakt drei neue Mails, die vierte nicht',
   versand.filter(m=>m.to===email2).length===4);
 // IP-Limit: neue Konten dürfen den Rate-Speicher nicht umgehen.
 const ipK=klient();
 await ipK.api('POST','/api/registrieren',{ zustimmung: true, email:'limit@example.com',passwort:pw});
 let limitR=[];for(let i=0;i<11;i++)limitR.push(await ipK.api('POST','/api/email-bestaetigung-erneut',{}));
 pruefe('IP-Limit neutral und begrenzt',limitR.every(x=>x.s===200&&x.d.text===limitR[0].d.text));
 const ipNeuer=klient(),ipMail='ip-grenze@example.com';
 await ipNeuer.api('POST','/api/registrieren',{ zustimmung: true, email:ipMail,passwort:pw});
 await warte(()=>versand.some(m=>m.to===ipMail));
 const ipVorher=versand.filter(m=>m.to===ipMail).length;
 const ipAntwort=await ipNeuer.api('POST','/api/email-bestaetigung-erneut',{});
 await pause(25);
 pruefe('IP-Grenze verhindert neue Mail auch bei anderem Benutzer',
   ipAntwort.s===200 && versand.filter(m=>m.to===ipMail).length===ipVorher);

 // Ohne Maildienst darf ein neues Konto auch ohne Verifikation kaufen.
 ohneServer=erstelleServer({stripe,webhookSecret:'test',base:'http://127.0.0.1:4442',mailer:null})
   .listen(4442,'127.0.0.1');
 await new Promise((resolve,reject)=>{if(ohneServer.listening)return resolve();ohneServer.once('listening',resolve);ohneServer.once('error',reject);});
 const ohne=klient('http://127.0.0.1:4442');
 await ohne.api('POST','/api/registrieren',{ zustimmung: true, email:'ohne-mail@example.com',passwort:pw});
 const gekauft=await ohne.api('POST','/api/kurse/'+kurs.id+'/kaufen',{modell:'einmal',zustimmung:true});
 pruefe('Ohne Maildienst ist Verifizierung nicht Pflicht',gekauft.s===200);
 const ichOhne=await ohne.api('GET','/api/ich');
 pruefe('Ohne Mailer meldet API Pflicht=false, tatsächlicher Status=false',
   ichOhne.d.email_bestaetigung_pflicht===false && ichOhne.d.email_bestaetigt===false);
 // Passwort-Reset bestätigt eine Adresse erst bei erfolgreich verbrauchtem Link.
 const resetMail='passwort-bestaetigung@example.com';
 const resetK=klient();
 const resetReg=await resetK.api('POST','/api/registrieren',{ zustimmung: true, email:resetMail,passwort:pw});
 pruefe('Reset-Testkunde unbestätigt registriert',resetReg.s===201&&
   eins('SELECT email_bestaetigt FROM benutzer WHERE email=?',resetMail).email_bestaetigt===null);
 const falschReset=await gast.api('POST','/api/passwort-zuruecksetzen',
   {token:randomBytes(32).toString('base64url'),passwort:pw});
 pruefe('Falscher Passwort-Token bestätigt E-Mail nicht',falschReset.s===400&&
   eins('SELECT email_bestaetigt FROM benutzer WHERE email=?',resetMail).email_bestaetigt===null);
 await gast.api('POST','/api/passwort-vergessen',{email:resetMail});
 pruefe('Reset-Mail über bestehenden Versand',
   await warte(()=>versand.some(m=>m.to===resetMail&&m.subject==='Jelszó-visszaállítás')));
 const resetToken=versand.find(m=>m.to===resetMail&&m.subject==='Jelszó-visszaállítás')
   ?.text.match(/passwort-neu\/([A-Za-z0-9_-]{43})/)?.[1];
 const resetErfolg=await gast.api('POST','/api/passwort-zuruecksetzen',{token:resetToken,passwort:pw});
 pruefe('Gültiger Passwort-Reset bestätigt E-Mail',resetErfolg.s===200&&
   eins('SELECT email_bestaetigt FROM benutzer WHERE email=?',resetMail).email_bestaetigt>0);
 pruefe('Kein Token in Server-Warn-/Fehlerprotokoll',
   [token,neuer,resetToken].every(t=>!t || !logAusgaben.join(' ').includes(t)));

 const html=readFileSync(resolve('public/kunde.js'),'utf8');
 pruefe('Hash-Router, Leiste und Kaufen-Sperre in Kundenseite',html.includes("case 'megerosites'")&&
   html.includes("role:'status'")&&html.includes("ich.email_bestaetigt === false"));
} catch(e) {
 fehler++;console.log('FEHLER Testablauf:',e.message);
} finally {
 console.warn=altesWarn;console.error=altesError;
 if(ohneServer)await new Promise(r=>ohneServer.close(r));
 if(server)await new Promise(r=>server.close(r));
 try{rmSync(temp,{recursive:true,force:true});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
}
console.log('Bestätigung: '+bestanden+' bestanden, '+fehler+' fehlgeschlagen');
process.exitCode=fehler?1:0;
