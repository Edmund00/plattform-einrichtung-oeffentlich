// Scheibe 18: isolierter Offline-Selbsttest (nur Testdatenbank und Mock-Mails/Stripe).
import './test-sprache.mjs';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
const ordner=mkdtempSync(join(tmpdir(),'schulung-konto-'));
process.env.DB_DATEI=join(ordner,'test.db');
const basis='http://127.0.0.1:4488', pass=randomBytes(20).toString('hex');
const mails=[], stripeDeletes=[];
let server,db,ok=0,fehler=0;
const pruefe=(titel,wert)=>{wert?ok++:fehler++;console.log((wert?'OK     ':'FEHLER ')+titel);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function warten(fn){for(let i=0;i<120;i++){if(fn())return true;await pause(10);}return false;}
const mailer=async mail=>{mails.push(mail);return true;};
// A6-01: cus_konto_fehler scheitert genau EINMAL (Netzfehler), danach gelingt es; cus_konto_weg gibt es bei Stripe nicht mehr (resource_missing).
const stripe={customers:{del:async id=>{stripeDeletes.push(id);if(id==='cus_konto_fehler'&&stripeDeletes.filter(x=>x===id).length===1)throw Object.assign(Error('mock stripe deletion'),{type:'StripeConnectionError'});if(id==='cus_konto_weg')throw Object.assign(Error('No such customer'),{code:'resource_missing',statusCode:404});return {id,deleted:true};}},
  webhooks:{constructEvent:()=>({})}};
function client(){
 let cookie='';
 return {async api(method,path,body){
   const h={};if(cookie)h.Cookie=cookie;
   const init={method,headers:h};
   if(body!==undefined){h['Content-Type']='application/json';init.body=JSON.stringify(body);}
   const res=await fetch(basis+path,init);
   const c=res.headers.get('set-cookie');if(c)cookie=c.split(';')[0];
   const ct=res.headers.get('content-type')||'';
   return {s:res.status,d:ct.includes('application/json')?await res.json():await res.text(),h:res.headers};
 },cookie:()=>cookie};
}
const ein=(sql,...args)=>db.prepare(sql).run(...args);
const eins=(sql,...args)=>db.prepare(sql).get(...args);
try{
 const {db:dbInstance}=await import('../db.mjs');db=dbInstance;
 const {passwortHashen}=await import('../auth.mjs');
 const {erstelleServer}=await import('../app.mjs');
 const pw=await passwortHashen(pass);
 const insertUser=(email,rolle='kunde')=>Number(ein(
  'INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt,rolle,einwilligung_zeit,einwilligung_version) VALUES(?,?,?,?,?,?,?)',
  email,pw,new Date().toISOString(),Date.now(),rolle,new Date().toISOString(),'reg-2026-11-03').lastInsertRowid);
 const A=insertUser('konto-a@example.com'),B=insertUser('konto-b@example.com'),ADMIN=insertUser('konto-admin@example.com','admin');
 const kurs=Number(ein("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?, '', 990000,'huf','veroeffentlicht',?,?)",
  'VALORE Konto',new Date().toISOString(),new Date().toISOString()).lastInsertRowid);
 ein("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES(?,?,?,?,?,?,?,?,?)",
  'cs_konto_a_1',A,kurs,990000,'huf','bezahlt','einmal',new Date().toISOString(),new Date().toISOString());
 ein("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES(?,?,?,?,?,?,?,?,?)",
  'cs_konto_b_1',B,kurs,490000,'huf','bezahlt','einmal',new Date().toISOString(),new Date().toISOString());
 ein("INSERT INTO zugaenge(benutzer_id,kurs_id,quelle,erstellt) VALUES(?,?,'zahlung',?)",A,kurs,new Date().toISOString());
 ein("INSERT INTO ereignisse(zeit,typ,email,status,quelle_id) VALUES(?,'gekauft',?,'bezahlt',?)",
  Date.now(),'konto-a@example.com','konto-event-a');
 ein("INSERT INTO ereignisse(zeit,typ,email,status,quelle_id) VALUES(?,'gekauft',?,'bezahlt',?)",
  Date.now(),'konto-b@example.com','konto-event-b');
 server=erstelleServer({stripe,webhookSecret:'test',base:basis,mailer}).listen(4488,'127.0.0.1');
 await new Promise((yes,no)=>{if(server.listening)return yes();server.once('listening',yes);server.once('error',no);});
 const a=client(),b=client(),admin=client(),gast=client();
 pruefe('Anmeldung A',(await a.api('POST','/api/anmelden',{email:'konto-a@example.com',passwort:pass})).s===200);
 pruefe('Anmeldung B',(await b.api('POST','/api/anmelden',{email:'konto-b@example.com',passwort:pass})).s===200);
 pruefe('Anmeldung Admin',(await admin.api('POST','/api/anmelden',{email:'konto-admin@example.com',passwort:pass})).s===200);
 pruefe('Gast 401',(await gast.api('GET','/api/konto')).s===401);
 const data=(await a.api('GET','/api/konto'));
 pruefe('Nur eigene Bestellungen, korrekte Nummer und Betrag',
   data.s===200&&data.d.bestellungen.length===1&&data.d.bestellungen[0].betrag===990000&&
   data.d.bestellungen[0].id===eins('SELECT id FROM bestellungen WHERE benutzer_id=?',A).id&&
   !JSON.stringify(data.d).includes('cs_konto_a_1')&&!JSON.stringify(data.d).includes('konto-b@example.com'));
 pruefe('A kann B nicht sehen',(await b.api('GET','/api/konto')).d.bestellungen.every(x=>x.betrag===490000));
 const kontoAntwort=await a.api('GET','/api/konto');
 pruefe('GET /api/konto liefert nur E-Mail-Daten, keine Rechnungsfelder',kontoAntwort.s===200&&!('rechnung_name' in kontoAntwort.d.daten)&&!('anzeigename' in kontoAntwort.d.daten));
 pruefe('PATCH /api/konto gibt es nicht mehr',[404,405].includes((await a.api('PATCH','/api/konto',{rechnung_name:'Cég'})).s));
 const exp=await a.api('GET','/api/konto/auskunft');
 pruefe('DSGVO-Auskunft: Attachment/no-store und keine fremden Daten',
   exp.s===200&&exp.h.get('content-disposition')?.includes('attachment')&&
   exp.h.get('cache-control')==='no-store'&&
   exp.d.hozzaferesek.length===1&&!JSON.stringify(exp.d).includes('konto-b@example.com'));
 pruefe('Auskunft ungarisch: Schlüssel und Werte ohne deutsche Codes',
   ['adatok','rendelesek','hozzaferesek','korabbi_email_cimek','elallasi_nyilatkozatok','hozzajarulasok','elso_hozzaferesek'].every(k=>k in exp.d)&&
   !/"(daten|bestellungen|zugaenge|vorherige_emails|erklaerungen|zustimmungen|erste_zugriffe|betrag|waehrung|status|rechnung_\w+|kurs_id)"/.test(JSON.stringify(exp.d))&&
   !/"(bezahlt|pruefen|erstattet|einmal|abo|huf|eur)"/.test(JSON.stringify(exp.d))&&
   exp.d.rendelesek.every(r=>r.penznem===r.penznem.toUpperCase()&&typeof r.allapot==='string'&&r.allapot.length>0));
 pruefe('Auskunft enthält Einwilligung (Zeitpunkt und Textstand) auf Ungarisch',!!exp.d.adatok.hozzajarulas_idopontja&&exp.d.adatok.hozzajarulas_szovegverzioja==='reg-2026-11-03'&&!('einwilligung_zeit' in exp.d.adatok));
 {
  const seite=async(c)=>{const r=await fetch(basis+'/api/bestellungen/999999/beleg',{headers:{Accept:'text/html,application/xhtml+xml',...(c?{Cookie:c}:{})}});return {s:r.status,t:await r.text(),ct:r.headers.get('content-type')||''};};
  const angemeldet=await seite(a.cookie()), anonym=await seite('');
  pruefe('Beleg-Link im Browser: Fehler als ungarische HTML-Seite (angemeldet 404, anonym 401), kein rohes JSON',
   angemeldet.s===404&&anonym.s===401&&angemeldet.ct.includes('text/html')&&anonym.ct.includes('text/html')&&
   angemeldet.t.includes('lang="hu"')&&angemeldet.t.includes('<h1>')&&anonym.t.includes('<h1>')&&!angemeldet.t.startsWith('{')&&!anonym.t.startsWith('{'));
  pruefe('Beleg-Aufruf per API (ohne Accept html) liefert weiter JSON mit ungarischem Text',
   (await a.api('GET','/api/bestellungen/999999/beleg')).d?.fehler==='nicht_gefunden');
 }
 pruefe('Auskunft enthält keinen Hash/Token/Stripe-ID',
   !/passwort_hash|token_hash|stripe_sitzung|stripe_kunde|cs_konto_a_1/.test(JSON.stringify(exp.d)));
 pruefe('Bestellformat in bestehender Preisfunktion', 
   (await import('../public/preis.js')).formatBetrag(990000,'huf').replace(/[\s  ]/g,' ')==='9 900 Ft');
 pruefe('E-Mail wechseln: falsches Passwort',
   (await a.api('POST','/api/konto/email-aendern',{email:'neu-a@example.com',passwort:'falsch'})).s===401);
 pruefe('E-Mail wechseln: bereits vergeben, neutral',
   (await a.api('POST','/api/konto/email-aendern',{email:'konto-b@example.com',passwort:pass})).d.text===
   (await import('../texte.mjs')).HU.konto_email_neutral);
 pruefe('E-Mail wechseln: Token angefordert',
   (await a.api('POST','/api/konto/email-aendern',{email:'neu-a@example.com',passwort:pass})).s===200);
 const zweitesGeraet=client();
 await zweitesGeraet.api('POST','/api/anmelden',{email:'konto-a@example.com',passwort:pass});
 const neuMail=mails.find(x=>x.to==='neu-a@example.com');
 const token=neuMail?.text.match(/email-aendern\/([A-Za-z0-9_-]{43})/)?.[1];
 pruefe('Token: nur Hash gespeichert',!!token&&!JSON.stringify(db.prepare('SELECT * FROM email_aender_token').all()).includes(token));
 pruefe('Falscher Token 400',(await gast.api('POST','/api/email-aendern-bestaetigen',{token:'x'.repeat(43)})).s===400);
 const abgelaufen='expired-token-'+randomBytes(32).toString('base64url').slice(0,29);
 const {createHash}=await import('node:crypto');
 const altHash=createHash('sha256').update(abgelaufen).digest('hex');
 ein('INSERT INTO email_aender_token(benutzer_id,neue_email,token_hash,erstellt,laeuft_ab) VALUES(?,?,?,?,?)',
   B,'abgelaufen@example.com',altHash,Date.now()-90000000,Date.now()-86400000);
 pruefe('Abgelaufener E-Mail-Token 400',(await gast.api('POST','/api/email-aendern-bestaetigen',{token:abgelaufen})).s===400);
 pruefe('Bestätigung 200 und einmalig',
   (await gast.api('POST','/api/email-aendern-bestaetigen',{token})).s===200&&
   (await gast.api('POST','/api/email-aendern-bestaetigen',{token})).s===400);
 pruefe('Benutzeradresse geändert und Sitzungen beendet',
   eins('SELECT email FROM benutzer WHERE id=?',A).email==='neu-a@example.com'&&
   (await a.api('GET','/api/konto')).s===401&&
   (await zweitesGeraet.api('GET','/api/konto')).s===401);
 pruefe('Alte Adresse erhält Hinweis',await warten(()=>mails.some(m=>m.to==='konto-a@example.com'&&m.subject.includes('megváltozott'))));
 const aNeu=client();
 pruefe('Login mit neuer Adresse',(await aNeu.api('POST','/api/anmelden',{email:'neu-a@example.com',passwort:pass})).s===200);
 // Separate Lösch- und Abo-Fälle verwenden unabhängige Konten.
 const aboId=insertUser('konto-abo@example.com');
 ein("INSERT INTO abos(stripe_abo,benutzer_id,kurs_id,status,erstellt,geaendert) VALUES(?,?,?,'aktiv',?,?)",
  'sub_konto_aktiv_1',aboId,kurs,new Date().toISOString(),new Date().toISOString());
 const abo=client();
 await abo.api('POST','/api/anmelden',{email:'konto-abo@example.com',passwort:pass});
 pruefe('Aktives Abo blockiert Löschung',(await abo.api('POST','/api/konto/loeschen',{passwort:pass,bestaetigt:true})).s===409);
 pruefe('Admin 403',(await admin.api('POST','/api/konto/loeschen',{passwort:pass,bestaetigt:true})).s===403);
 pruefe('Falsches Passwort blockiert Löschung',(await b.api('POST','/api/konto/loeschen',{passwort:'falsch',bestaetigt:true})).s===401);
 ein('UPDATE benutzer SET stripe_kunde=? WHERE id=?','cus_konto_test',B);
 pruefe('Löschung erfolgreich',(await b.api('POST','/api/konto/loeschen',{passwort:pass,bestaetigt:true})).s===200);
 pruefe('Löschung: Anmeldung und Zugriff nicht mehr möglich',
   (await b.api('GET','/api/konto')).s===401&&
   (await gast.api('POST','/api/anmelden',{email:'konto-b@example.com',passwort:pass})).s===401);
 const geloescht=eins('SELECT * FROM benutzer WHERE id=?',B);
 pruefe('Anonymisiert, aber Bestellung bleibt',
   geloescht.email==='geloescht-'+B+'@invalid.invalid'&&geloescht.stripe_kunde===null&&
   geloescht.passwort_hash==='geloescht'&&!!geloescht.geloescht&&
   eins('SELECT COUNT(*) n FROM bestellungen WHERE benutzer_id=?',B).n===1);
 pruefe('Einwilligung (Zeitpunkt, Textstand) wird bei Kontolöschung entfernt',geloescht.einwilligung_zeit===null&&geloescht.einwilligung_version===null);
 pruefe('Stripe-Kundenlöschung per Mock',await warten(()=>stripeDeletes.includes('cus_konto_test')));
 pruefe('Löschmail an alte Adresse, Adresse danach aus Auftrag entfernt',
   await warten(()=>mails.some(m=>m.to==='konto-b@example.com'&&m.subject.includes('töröltük')))&&
   eins('SELECT empfaenger FROM konto_mail_ausgang WHERE benutzer_id=?',B).empfaenger===null);
 pruefe('Löschung anonymisiert eigene Ereignisse, nicht die anderer Kunden',
   eins("SELECT email FROM ereignisse WHERE quelle_id='konto-event-b'").email===null&&
   eins("SELECT email FROM ereignisse WHERE quelle_id='konto-event-a'").email==='konto-a@example.com');
 const fehlerId=insertUser('stripe-fehler@example.com');
 ein('UPDATE benutzer SET stripe_kunde=? WHERE id=?','cus_konto_fehler',fehlerId);
 const fehlerClient=client();
 await fehlerClient.api('POST','/api/anmelden',{email:'stripe-fehler@example.com',passwort:pass});
 pruefe('Stripe-Fehler nach Commit hebt Kontolöschung nicht auf',
   (await fehlerClient.api('POST','/api/konto/loeschen',{passwort:pass,bestaetigt:true})).s===200&&
   !!eins('SELECT geloescht FROM benutzer WHERE id=?',fehlerId).geloescht&&
   await warten(()=>stripeDeletes.includes('cus_konto_fehler')));
 // A6-01: gescheiterte Stripe-Loeschung bleibt mit der cus_-ID (ohne Personendaten) im Auftragsbuch und wird wiederholt.
 const auftrag=await warten(()=>eins("SELECT versuche FROM stripe_kunde_loeschauftraege WHERE stripe_kunde='cus_konto_fehler'")?.versuche===1)&&eins("SELECT * FROM stripe_kunde_loeschauftraege WHERE stripe_kunde='cus_konto_fehler'");
 pruefe('A6-01: Stripe-Fehler -> Auftrag bleibt mit 1 Versuch und kurzem Fehlercode, nur cus_-ID gespeichert',!!auftrag&&auftrag.letzter_fehler==='StripeConnectionError'&&Object.keys(auftrag).sort().join()==='erstellt,letzter_fehler,stripe_kunde,versuche'&&!JSON.stringify(auftrag).includes('@'));
 pruefe('A6-01: erfolgreiche Loeschung hinterlaesst keinen Auftrag',!eins("SELECT 1 FROM stripe_kunde_loeschauftraege WHERE stripe_kunde='cus_konto_test'"));
 const {stripeKundenNachholen,stripeKundeVormerken}=await import('../stripe-kunde-loeschen.mjs');
 await stripeKundenNachholen(stripe);
 pruefe('A6-01: Wiederholung loescht den Kunden bei Stripe und entfernt den Auftrag',stripeDeletes.filter(x=>x==='cus_konto_fehler').length===2&&!eins("SELECT 1 FROM stripe_kunde_loeschauftraege WHERE stripe_kunde='cus_konto_fehler'"));
 stripeKundeVormerken('cus_konto_weg');stripeKundeVormerken('keine-cus-id');stripeKundeVormerken(null);
 await stripeKundenNachholen(stripe);
 pruefe('A6-01: Kunde gibt es bei Stripe nicht mehr -> Auftrag erledigt; ungueltige IDs werden nicht vorgemerkt',eins('SELECT COUNT(*) n FROM stripe_kunde_loeschauftraege').n===0&&stripeDeletes.includes('cus_konto_weg'));
 // Angreifer-Nachbesserung: eine Warnzeile je Lauf; bei 401/403 verdoppelte Pause (20 min ... max 6 h) statt alle 10 Minuten.
 {const {stripeLoeschPause,PAUSE_MAX_MS}=await import('../stripe-kunde-loeschen.mjs');
  const warn=console.warn,zeilen=[];console.warn=(...a)=>zeilen.push(a.join(' '));
  try{
   for(const id of ['cus_netz_1','cus_netz_2','cus_netz_3'])stripeKundeVormerken(id);
   const netz={customers:{del:async()=>{throw Object.assign(Error('netz'),{type:'StripeConnectionError'})}}};
   const r1=await stripeKundenNachholen(netz);
   pruefe('Drei gescheiterte Loeschungen -> genau EINE Warnzeile mit Anzahl, keine Pause',r1.fehlgeschlagen===3&&zeilen.length===1&&zeilen[0].includes('3 Loeschung')&&stripeLoeschPause().pauseMs===0);
   zeilen.length=0;let aufrufe=0,t=1e12;
   const gesperrt={customers:{del:async()=>{aufrufe++;throw Object.assign(Error('Invalid API Key'),{type:'StripeAuthenticationError',statusCode:401})}}};
   await stripeKundenNachholen(gesperrt,{jetzt:()=>t});
   pruefe('401: Lauf bricht nach dem ersten Versuch ab, Pause 20 min, eine Warnzeile',aufrufe===1&&stripeLoeschPause().pauseMs===20*60000&&stripeLoeschPause().pauseBis===t+20*60000&&zeilen.length===1&&zeilen[0].includes('20 min'));
   t+=60000;const r2=await stripeKundenNachholen(gesperrt,{jetzt:()=>t});
   pruefe('Waehrend der Pause kein Stripe-Aufruf',r2.pausiert===true&&aufrufe===1);
   const folge=[];for(let i=0;i<8;i++){t=stripeLoeschPause().pauseBis+1;await stripeKundenNachholen(gesperrt,{jetzt:()=>t});folge.push(stripeLoeschPause().pauseMs/60000);}
   pruefe('Pause verdoppelt sich bis hoechstens 6 h: '+folge.join(','),JSON.stringify(folge)===JSON.stringify([40,80,160,320,360,360,360,360])&&stripeLoeschPause().pauseMs===PAUSE_MAX_MS);
   t=stripeLoeschPause().pauseBis+1;await stripeKundenNachholen(stripe,{jetzt:()=>t});
   pruefe('Nach Erfolg: Auftraege geloescht, Pause zurueckgesetzt',eins('SELECT COUNT(*) n FROM stripe_kunde_loeschauftraege').n===0&&stripeLoeschPause().pauseMs===0&&stripeLoeschPause().pauseBis===0);
  }finally{console.warn=warn;}}
 pruefe('Konto-Löschaufträge nach Versand ohne persönliche Adresse',
   await warten(()=>eins("SELECT COUNT(*) n FROM konto_mail_ausgang WHERE empfaenger IS NOT NULL AND status='gesendet'").n===0));
 const kundeCode=readFileSync(resolve('public/kunde.js'),'utf8').replace(/\r\n/g,'\n');
 const css=readFileSync(resolve('public/kunde.css'),'utf8').replace(/\r\n/g,'\n');
 pruefe('Fiókom-Route und Menü, keine Inline-Styles',
   kundeCode.includes("case 'fiokom': return fiokom()")&&
   kundeCode.includes("href: '#/fiokom'")&&css.includes('.konto-form')&&
   !/setAttribute\(['"]style['"]/.test(kundeCode));
 const fuss=(await import('../texte.mjs')).HU.mail_systemhinweis;
 const mailCode=(readFileSync(resolve('mail.mjs'),'utf8')+String.fromCharCode(10)+readFileSync(resolve('kaufmail-vorlage.mjs'),'utf8')).replace(/\r\n/g,'\n');
 pruefe('System-Footer auch in Bestätigung, Passwort und Kaufmail implementiert',
   mailCode.includes("text += '\\n'+HU.mail_systemhinweis")&&
   mailCode.includes('z.push(HU.mail_systemhinweis)'));
 pruefe('Systemhinweis in neuen Konto-Mails',mails.filter(m=>/konto-|neu-a@/.test(m.to)).every(m=>m.text.includes(fuss)&&m.html.includes(fuss)));
}catch(e){fehler++;console.log('FEHLER Testablauf: '+(e.code||e.message));}
finally{
 try{await new Promise(r=>server?.close(r)??r());}catch{}
 try{db?.close();}catch{}
 try{rmSync(ordner,{recursive:true,force:true});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
}
console.log('Konto: '+ok+' bestanden, '+fehler+' fehlgeschlagen');
process.exitCode=fehler?1:0;
