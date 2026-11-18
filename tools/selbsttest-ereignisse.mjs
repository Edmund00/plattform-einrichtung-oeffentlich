// Scheibe 15: isolierte Offline-Pruefung, kein echter Stripe-/Resend-Aufruf.
import './test-sprache.mjs';
import { randomBytes } from 'node:crypto';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const temp=mkdtempSync(join(tmpdir(),'schulung-ereignisse-'));
const datei=join(temp,'test.db');
process.env.DB_DATEI=datei;
const BASE='http://127.0.0.1:4447', EMP='inhaberin@example.com';
const PASS=randomBytes(32).toString('hex');
let ok=0,fehler=0,server,ohneServer,datenbank,versand=[],mailFehler=false,checkoutCount=0;
const pruefe=(name,wert)=>{wert?ok++:fehler++;console.log((wert?'OK     ':'FEHLER ')+name);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function warten(fn){for(let i=0;i<120;i++){if(fn())return true;await pause(10);}return false;}
function dbOpen(){return new DatabaseSync(datei);}
function sql(q,...args){const d=dbOpen();try{return d.prepare(q).all(...args);}finally{d.close();}}
function ausf(q,...args){const d=dbOpen();try{return d.prepare(q).run(...args);}finally{d.close();}}
const one=(q,...a)=>sql(q,...a)[0];
const zaehle=(typ,q)=>one('SELECT COUNT(*) AS n FROM ereignisse WHERE typ=? AND quelle_id=?',typ,q).n;
const protokoll=[],altWarn=console.warn,altError=console.error;
console.warn=(...x)=>protokoll.push(x.map(String).join(' '));
console.error=(...x)=>protokoll.push(x.map(String).join(' '));
const mailer=async m=>{versand.push(m);return !(mailFehler&&m.to===EMP);};
const stripe={
 webhooks:{constructEvent:b=>JSON.parse(b.toString())},
 customers:{create:async()=>({id:'cus_test_15'})},
 checkout:{sessions:{create:async()=>{checkoutCount++;return{id:'cs_test_ereignisse_mock_'+checkoutCount,url:'https://checkout.stripe.com/test-15'};}}},
 subscriptions:{retrieve:async()=>({metadata:{}})},
 billingPortal:{sessions:{create:async()=>({url:'https://billing.stripe.com/test'})}},
};
function klient(basis=BASE){
 let cookie='';
 return {async api(method,path,body){
  const headers={};if(cookie)headers.Cookie=cookie;
  const args={method,headers};
  if(body!==undefined){headers['Content-Type']='application/json';args.body=JSON.stringify(body);}
  const r=await fetch(basis+path,args),sc=r.headers.get('set-cookie');
  if(sc)cookie=sc.split(';')[0];
  const ct=r.headers.get('content-type')||'';
  return {s:r.status,d:ct.includes('application/json')?await r.json():await r.text(),h:r.headers};
 }};
}
async function webhook(id,type,object,created=Math.floor(Date.now()/1000)){
 const r=await fetch(BASE+'/webhook',{method:'POST',headers:{'Content-Type':'application/json',
  'Stripe-Signature':'test'},body:JSON.stringify({id,type,created,livemode:false,data:{object}})});
 return r.status;
}
try {
 const old=dbOpen();
 old.exec('CREATE TABLE ereignisse(id TEXT PRIMARY KEY,typ TEXT NOT NULL,verarbeitet TEXT NOT NULL)');
 old.prepare('INSERT INTO ereignisse VALUES(?,?,?)').run('evt_legacy_15','checkout.session.completed','2026-10-31');
 old.close();
 const migrate=()=>spawnSync(process.execPath,
   ['--disable-warning=ExperimentalWarning','--input-type=module','-e',"import('./db.mjs')"],
   {cwd:resolve('.'),env:{...process.env,DB_DATEI:datei},encoding:'utf8'});
 const m1=migrate(),m2=migrate();
 pruefe('Alte DB startet zweimal nach Migration ohne Fehler',m1.status===0&&m2.status===0);
 const {db}=await import('../db.mjs');
 datenbank=db;
 const {passwortHashen}=await import('../auth.mjs');
 const {erstelleServer}=await import('../app.mjs');
 const {ereignisHinzufuegen,ereignisKonfigurieren,ereignisseAufraeumen}=await import('../ereignis-liste.mjs');
 pruefe('Alt-Stripe-IDs bleiben erhalten',one("SELECT COUNT(*) AS n FROM stripe_ereignisse WHERE id='evt_legacy_15'").n===1);
 pruefe('Neue Ereignis-ID ist INTEGER',sql('PRAGMA table_info(ereignisse)').some(x=>x.name==='id'&&x.type==='INTEGER'));
 const ph=await passwortHashen(PASS);
 ausf("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,'admin',?,?)",
  'admin15@example.com',ph,new Date().toISOString(),Date.now());
 server=erstelleServer({stripe,webhookSecret:'test',base:BASE,mailer,
  verkaufsmeldungMail:EMP,registrierungMeldung:true}).listen(4447,'127.0.0.1');
 await new Promise((j,n)=>{if(server.listening)return j();server.once('listening',j);server.once('error',n);});
 const gast=klient(),kunde=klient(),admin=klient(),email='kunde15@example.com';
 pruefe('Gast darf Liste/CSV/JSON nicht lesen',
  (await gast.api('GET','/api/admin/ereignisse')).s===401&&
  (await gast.api('GET','/api/admin/ereignisse?format=csv')).s===401&&
  (await gast.api('GET','/api/admin/ereignisse?format=json')).s===401);
 pruefe('Registrierung 201',(await kunde.api('POST','/api/registrieren',{ zustimmung: true, email,passwort:PASS})).s===201);
 const uid=one('SELECT id FROM benutzer WHERE email=?',email).id;
 pruefe('Registrierung nur einmal',zaehle('registriert',String(uid))===1);
 pruefe('Kunde darf Liste/Export nicht lesen',
  (await kunde.api('GET','/api/admin/ereignisse')).s===403&&
  (await kunde.api('GET','/api/admin/ereignisse?format=json')).s===403);
 pruefe('Registrierungsmail an Inhaberin genau einmal',
  await warten(()=>versand.filter(m=>m.to===EMP).length===1));
 const regMail=versand.find(m=>m.to===EMP);
 pruefe('Registrierungsmail: Betreff, Benutzer, Budapest-Zeit, genau ein Admin-Link',
  regMail?.subject==='Új regisztráció'&&regMail.text.includes(email)&&regMail.text.includes('Budapest')&&
  regMail.text.includes('Felhasználó e-mail-címe') && !regMail.text.includes('Vásárló e-mail-címe') &&
  regMail.text.split('Adminfelület megnyitása').length===2 &&
  !regMail.text.includes('Új esemény történt'));
 await warten(()=>versand.some(m=>m.to===email&&m.subject.includes('Erősítsd meg')));
 const token=versand.find(m=>m.to===email&&m.subject.includes('Erősítsd meg'))
  ?.text.match(/megerosites\/([A-Za-z0-9_-]{43})/)?.[1];
 pruefe('Bestätigung ohne Klartexttoken in Ereignissen',
  !!token&&!JSON.stringify(sql('SELECT * FROM ereignisse')).includes(token));
 pruefe('Bestätigungslink 200',(await gast.api('POST','/api/email-bestaetigen',{token})).s===200);
 pruefe('Bestätigung einmalig',zaehle('bestaetigt',String(uid))===1&&
  (await gast.api('POST','/api/email-bestaetigen',{token})).s===400);
 pruefe('Adminlogin',(await admin.api('POST','/api/anmelden',
  {email:'admin15@example.com',passwort:PASS})).s===200);
 async function kurs(titel,preis,abo){
  const o={titel,preis_cent:preis,waehrung:'huf'};
  if(abo){o.abo_preis_cent=abo;o.abo_intervall='month';}
  const r=await admin.api('POST','/api/admin/kurse',o);
  if(r.s!==201)throw Error('Kurs anlegen '+r.s);
  const p=await admin.api('POST','/api/admin/kurse/'+r.d.id+'/veroeffentlichen',{});
  if(p.s!==200)throw Error('Kurs veröffentlichen '+p.s);
  return r.d.id;
 }
 const paid=await kurs('VALORE 9900',990000),gratis=await kurs('VALORE gratis',0),
  aboKurs=await kurs('VALORE Előfizetés',990000,990000);
 pruefe('Checkout gestartet',(await kunde.api('POST','/api/kurse/'+paid+'/kaufen',{modell:'einmal',zustimmung:true})).s===200);
 const meta={kurs_id:String(paid),benutzer_id:String(uid),modell:'einmal'};
 const obj={id:'cs_15_1',mode:'payment',payment_status:'paid',customer:'cus_test_15',
  metadata:meta,payment_intent:'pi_15_1',amount_total:990000,currency:'huf'};
 pruefe('Bezahlter Webhook 200',await webhook('evt_15_kauf_1','checkout.session.completed',obj)===200);
 pruefe('Kauf: einmal 9900 Ft',zaehle('gekauft','evt_15_kauf_1')===1 &&
  one("SELECT betrag,waehrung FROM ereignisse WHERE quelle_id='evt_15_kauf_1'").betrag===9900);
 await warten(()=>versand.some(m=>m.to===EMP&&m.subject.includes('Új rendelés')));
 const kauMail=versand.find(m=>m.to===EMP&&m.subject.includes('Új rendelés'));
 pruefe('Kaufmail mit Titel, Betrag, Käufer und Zeitpunkt',
  !!kauMail&&kauMail.text.includes('VALORE 9900')&&
  /9[\s\u00a0\u202f]900 Ft/.test(kauMail.text)&&/9[\s\u00a0\u202f]900 Ft/.test(kauMail.html)&&kauMail.text.includes(email)&&kauMail.text.includes('Budapest'));
 {
  // L1: falscher Betrag => Bestellung "pruefen", Inhaberin bekommt eine eigene Mail "Ellenőrzendő fizetés"
  const falsch={...obj,id:'cs_15_pruefen',payment_intent:'pi_15_pruefen',amount_total:1};
  pruefe('Webhook mit falschem Betrag 200',await webhook('evt_15_pruefen','checkout.session.completed',falsch)===200);
  await warten(()=>versand.some(m=>m.to===EMP&&m.subject.includes('Ellenőrzendő fizetés')));
  const pm=versand.find(m=>m.to===EMP&&m.subject.includes('Ellenőrzendő fizetés'));
  pruefe('L1: Prüfzahlung => Mail an die Inhaberin (Betreff, nicht-"Új rendelés", ohne Zugang)',!!pm&&pm.text.includes('NEM kapott hozzáférést')&&!pm.subject.includes('Új rendelés'));
 }
 const zuvor=versand.filter(m=>m.to===EMP&&m.subject.includes('Új rendelés')).length;
 pruefe('Doppel-Webhook 200',await webhook('evt_15_kauf_1','checkout.session.completed',obj)===200);
 await pause(30);
 pruefe('Doppel: keine weitere Mail und kein Ereignis',
  zaehle('gekauft','evt_15_kauf_1')===1&&versand.filter(m=>m.to===EMP&&m.subject.includes('Új rendelés')).length===zuvor);
 pruefe('Zugang vorhanden',one('SELECT COUNT(*) AS n FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,paid).n===1);
 pruefe('Gratis-Freischaltung 200',(await kunde.api('POST','/api/kurse/'+gratis+'/kaufen',{modell:'einmal',zustimmung:true})).s===200);
 const gratisId='gratis:'+uid+':'+gratis;
 pruefe('Gratis-Ereignis 0 Ft und Status kostenlos',
  zaehle('gekauft',gratisId)===1 &&
  one('SELECT betrag,status FROM ereignisse WHERE quelle_id=?',gratisId).betrag===0 &&
  one('SELECT status FROM ereignisse WHERE quelle_id=?',gratisId).status==='kostenlos');
 const refund={payment_intent:'pi_15_1',amount:990000,amount_refunded:990000,refunded:true};
 pruefe('Erstattung Webhook 200',await webhook('evt_15_refund','charge.refunded',refund)===200);
 pruefe('Erstattung genau einmal, Betrag 9900',one("SELECT COUNT(*) AS n FROM ereignisse WHERE typ='erstattet'").n===1 &&
  one("SELECT betrag FROM ereignisse WHERE typ='erstattet'").betrag===9900);
 await warten(()=>versand.some(m=>m.to===EMP&&m.subject.includes('Visszatérítés')));
 pruefe('Erstattungs-Mail mit getrenntem Betrag in Text und HTML',
   versand.some(m=>m.to===EMP&&m.subject.includes('Visszatérítés')&&
   /9[\s\u00a0\u202f]900 Ft/.test(m.text)&&/9[\s\u00a0\u202f]900 Ft/.test(m.html)));
 pruefe('Doppelte Erstattung kein zweites Ereignis',
  await webhook('evt_15_refund','charge.refunded',refund)===200 &&
  one("SELECT COUNT(*) AS n FROM ereignisse WHERE typ='erstattet'").n===1);
 pruefe('Abo-Checkout 200',(await kunde.api('POST','/api/kurse/'+aboKurs+'/kaufen',{modell:'abo',zustimmung:true})).s===200);
 const aboMeta={kurs_id:String(aboKurs),benutzer_id:String(uid),modell:'abo'};
 pruefe('Abo-Session 200',await webhook('evt_15_abo_checkout','checkout.session.completed',
  {id:'cs_15_abo',mode:'subscription',subscription:'sub_15_abo',customer:'cus_test_15',metadata:aboMeta})===200);
 const invoice={id:'in_15_abo',subscription:'sub_15_abo',customer:'cus_test_15',
  amount_paid:990000,currency:'huf',payment_intent:'pi_15_abo',
  lines:{data:[{period:{end:Math.floor(Date.now()/1000)+30*86400}}]}};
 pruefe('Erste Abo-Rechnung 200',await webhook('evt_15_abo_paid','invoice.paid',invoice)===200);
 pruefe('Abo-Start einmal, Betrag 9900',zaehle('abo_gestartet','evt_15_abo_paid')===1 &&
  one("SELECT betrag FROM ereignisse WHERE typ='abo_gestartet'").betrag===9900);
 // U3: Abo-Rechnung mit falschem Betrag -> Prüfmeldung an die Inhaberin (Art Abo, Hinweis: nicht freigebbar, nur ablehnen/erstatten)
 const falsch={...invoice,id:'in_15_abo_falsch',amount_paid:123,payment_intent:'pi_15_abo_falsch'};
 pruefe('Abo-Rechnung mit falschem Betrag 200',await webhook('evt_15_abo_falsch','invoice.paid',falsch)===200);
 await warten(()=>versand.some(m=>m.to===EMP&&m.text.includes('előfizetéses fizetés: jóváhagyni nem lehet')));
 pruefe('Abo-Prüfmeldung: Betreff Ellenőrzendő, Art Előfizetés, Hinweis zum Ablehnen/Erstatten',versand.some(m=>m.to===EMP&&m.subject.includes('Ellenőrzendő fizetés')&&
  m.text.includes('előfizetéses fizetés: jóváhagyni nem lehet')&&m.text.includes('Előfizetés')&&m.html.includes('előfizetéses fizetés')));
 // U4: Streitfall-Meldung (eigener Betreff und Einleitung, keine Einmal-/Abo-Art-Zeile)
 pruefe('Streitfall-Webhook 200',await webhook('evt_15_streit','charge.dispute.created',{id:'dp_15',payment_intent:'pi_15_unbekannt',amount:990000,currency:'huf',status:'needs_response'})===200);
 await warten(()=>versand.some(m=>m.to===EMP&&m.subject.includes('vitatott fizetés')));
 pruefe('Streitfall-Mail: Betreff, Einleitung, Betrag, keine Art-Zeile',versand.some(m=>m.to===EMP&&m.subject.includes('FIGYELEM – vitatott fizetés')&&
  m.text.includes('visszaterhelés')&&/9[\s  ]900 Ft/.test(m.text)&&!m.text.includes('Egyszeri vásárlás')));
 const ended={id:'sub_15_abo',customer:'cus_test_15',metadata:aboMeta,cancel_at_period_end:true};
 pruefe('Abo-Ende 200',await webhook('evt_15_abo_end','customer.subscription.deleted',ended,Math.floor(Date.now()/1000)+2)===200);
 pruefe('Abo-Ende einmal',zaehle('abo_beendet','evt_15_abo_end')===1);
 await warten(()=>versand.some(m=>m.to===EMP&&m.subject.includes('Új előfizetés')));
 pruefe('Abo-Mail enthält Betrag und Kurs',versand.some(m=>m.to===EMP&&m.subject.includes('Új előfizetés')&&
  m.text.includes('VALORE Előfizetés')&&/9[\s\u00a0\u202f]900 Ft/.test(m.text)&&/9[\s\u00a0\u202f]900 Ft/.test(m.html)));
 pruefe('Geschäftsmails enthalten weder Token, Stripe-IDs noch Kartendaten',
  versand.filter(m=>m.to===EMP).every(m=>!/(evt_15_|cs_15_|pi_15_|sub_15_|424242|megerosites\/)/.test(m.text+m.html)));
 pruefe('Resend-Meldungen mit Idempotency-Key',
  versand.filter(m=>m.to===EMP).every(m=>/^schulung-meldung-[a-f0-9]{16}-\d+$/.test(m.idempotencyKey)));
 const fehlerKurs=await kurs('VALORE Mailhiba',990000);
 await kunde.api('POST','/api/kurse/'+fehlerKurs+'/kaufen',{modell:'einmal',zustimmung:true});
 mailFehler=true;
 const fehlerSession={id:'cs_15_fail',mode:'payment',payment_status:'paid',customer:'cus_test_15',
  metadata:{kurs_id:String(fehlerKurs),benutzer_id:String(uid),modell:'einmal'},
  payment_intent:'pi_15_fail',amount_total:990000,currency:'huf'};
 const fehlerWebhook=await webhook('evt_15_mailfail','checkout.session.completed',fehlerSession);
 pruefe('Mailfehler: Webhook 200 und Zugang unberührt',
  fehlerWebhook===200&&one('SELECT COUNT(*) AS n FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,fehlerKurs).n===1);
 await warten(()=>versand.some(m=>m.to===EMP&&m.subject.includes('VALORE Mailhiba')));
 pruefe('Fehlerhafter Versand bleibt offen',
  one("SELECT status FROM meldung_ausgang WHERE ereignis_id=(SELECT id FROM ereignisse WHERE quelle_id='evt_15_mailfail')").status==='offen');
 mailFehler=false;
 const {mailDienst}=await import('../mail.mjs');
 // A8-02: Wiederholung erst nach der Backoff-Frist (1 Minute); die Uhr dieses Dienstes steht eine Stunde vorn.
 const retry=mailDienst({mailer,base:BASE,verkaufsmeldungMail:EMP,jetzt:()=>Date.now()+3600000});
 await retry.meldungAusgangSenden();
 pruefe('Mail nach Providerfehler erneut gesendet',
  one("SELECT status FROM meldung_ausgang WHERE ereignis_id=(SELECT id FROM ereignisse WHERE quelle_id='evt_15_mailfail')").status==='gesendet');
 const list=await admin.api('GET','/api/admin/ereignisse');
 pruefe('Admin-Liste neueste zuerst, max 50',list.s===200&&list.d.adatok.length<=50&&
  list.d.adatok.every((x,i,a)=>i===0||x.zeit<=a[i-1].zeit));
 const search=await admin.api('GET','/api/admin/ereignisse?typ=gekauft&suche=kunde15');
 pruefe('Typfilter und E-Mail-Suche',search.s===200&&search.d.adatok.length>=2&&
  search.d.adatok.every(x=>x.typ==='gekauft'&&x.email===email));
 const morgen=new Date(Date.now()+86400000).toISOString().slice(0,10);
 pruefe('Datumsfilter Zukunft ergibt leer',(await admin.api('GET','/api/admin/ereignisse?von='+morgen)).d.adatok.length===0);
 const gestern=new Date(Date.now()-86400000).toISOString().slice(0,10);
 pruefe('Bis-Filter vor gestern liefert nur alte Ereignisse',
  (await admin.api('GET','/api/admin/ereignisse?bis='+gestern)).d.adatok.length===0);
 pruefe('Ungültiges Datum abgelehnt',
  (await admin.api('GET','/api/admin/ereignisse?von=2026-02-30')).s===400);
 pruefe('Unzulässige Filter 400',
  (await admin.api('GET','/api/admin/ereignisse?typ=geheim')).s===400 &&
  (await admin.api('GET','/api/admin/ereignisse?seite=-1')).s===400);
 // REGISTRIERUNG_MELDUNG aus: Eintrag ja, aber keine Mail in der Ausgangsliste.
 ereignisKonfigurieren({aktiv:true,registrierung:false});
 const still=ereignisHinzufuegen('registriert','registration-disabled-fixture',{email:'toggle@example.com'});
 pruefe('REGISTRIERUNG_MELDUNG aus: Ereignis ohne Mailausgang',still&&
  one("SELECT COUNT(*) AS n FROM meldung_ausgang WHERE ereignis_id=(SELECT id FROM ereignisse WHERE quelle_id='registration-disabled-fixture')").n===0);
 ereignisKonfigurieren({aktiv:false});
 for(let i=0;i<56;i++)ereignisHinzufuegen('registriert','seite-'+i,{email:'seite'+i+'@example.com'});
 const p1=await admin.api('GET','/api/admin/ereignisse?seite=1');
 const p2=await admin.api('GET','/api/admin/ereignisse?seite=2');
 pruefe('Paginierung 50 / weitere Seite',
  p1.d.adatok.length===50&&p2.d.adatok.length>0&&p1.d.adatok.at(-1).quelle_id!==p2.d.adatok[0].quelle_id);
 ereignisHinzufuegen('gekauft','csv-fixture',{
  kurs_titel:'=HYPERLINK("x")',email:'csv-tester@example.com',betrag:9900,waehrung:'huf',status:'bezahlt'});
 const csv=await admin.api('GET','/api/admin/ereignisse?format=csv&suche=csv-tester');
 const json=await admin.api('GET','/api/admin/ereignisse?format=json&suche=csv-tester');
 const spalten=['Időpont (UTC)','Típus','Előadás','Összeg','Pénznem','Vásárló e-mail-címe','Állapot','Forrásazonosító'];
 pruefe('CSV-Header exakt acht Spalten',csv.s===200&&
  csv.d.replace(/^\ufeff/,'').startsWith(spalten.map(s=>'"'+s+'"').join(',')+'\r\n'));
 pruefe('CSV-Injection + doppelte Quotes geschützt',csv.d.includes("'=HYPERLINK")&&csv.d.includes('""x""'));
 pruefe('Export-Anhang, no-store, nosniff',
  csv.h.get('content-disposition')?.includes('attachment')&&
  csv.h.get('cache-control')==='no-store'&&csv.h.get('x-content-type-options')==='nosniff');
 pruefe('JSON-Spalten exakt und Reihenfolge',json.s===200&&Array.isArray(json.d)&&json.d.length===1&&
  Object.keys(json.d[0]).join('|')===spalten.join('|'));
 pruefe('Exportwerte unverändert, inklusive numerischem Betrag und CSV-Schutz',
   json.d[0]['Előadás']==='=HYPERLINK("x")'&&json.d[0]['Összeg']===9900&&
   json.d[0]['Pénznem']==='HUF'&&json.d[0]['Vásárló e-mail-címe']==='csv-tester@example.com'&&
   json.d[0]['Típus']==='Vásárlás'&&json.d[0]['Állapot']==='Fizetve'&&
   csv.d.includes('9900')&&csv.d.includes("'=HYPERLINK"));
 const insert=db.prepare("INSERT INTO ereignisse(zeit,typ,email,status,quelle_id) VALUES(?, 'registriert', ?,'registriert',?)");
 db.exec('BEGIN');
 try{for(let i=0;i<10010;i++)insert.run(Date.now(),'test'+i+'@example.com','massen-'+i);db.exec('COMMIT');}
 catch(e){db.exec('ROLLBACK');throw e;}
 const exportLimit=await admin.api('GET','/api/admin/ereignisse?format=json');
 pruefe('JSON-Export maximal 10000 Zeilen',Array.isArray(exportLimit.d)&&exportLimit.d.length===10000);
 ausf("INSERT INTO ereignisse(zeit,typ,email,status,quelle_id) VALUES(?,'registriert',?,'registriert',?)",
  Date.now()-731*86400000,'alt@example.com','alt-ereignis');
 const count=ereignisseAufraeumen(730);
 pruefe('Aufbewahrung entfernt Alt, behält Neu',count>=1&&
  one("SELECT COUNT(*) AS n FROM ereignisse WHERE quelle_id='alt-ereignis'").n===0&&
  one("SELECT COUNT(*) AS n FROM ereignisse WHERE quelle_id='massen-1'").n===1);
 pruefe('Stripe-IDs bei Löschung erhalten',one("SELECT COUNT(*) AS n FROM stripe_ereignisse WHERE id='evt_legacy_15'").n===1);
 pruefe('Keine Klartextpasswörter oder Tokens in Logs',!protokoll.join(' ').includes(PASS)&&
  !protokoll.join(' ').includes(token));
 ohneServer=erstelleServer({stripe,webhookSecret:'test',base:'http://127.0.0.1:4448',
  mailer,verkaufsmeldungMail:''}).listen(4448,'127.0.0.1');
 await new Promise((j,n)=>{if(ohneServer.listening)return j();ohneServer.once('listening',j);ohneServer.once('error',n);});
 const ohne=klient('http://127.0.0.1:4448'),vor=versand.filter(m=>m.to===EMP).length;
 const ohneReg=await ohne.api('POST','/api/registrieren',{ zustimmung: true, email:'ohne-meldung@example.com',passwort:PASS});
 await pause(30);
 pruefe('Ohne Empfänger weiterhin Ereignis, keine Inhabermail',ohneReg.s===201&&
  versand.filter(m=>m.to===EMP).length===vor&&
  one("SELECT COUNT(*) AS n FROM ereignisse WHERE email='ohne-meldung@example.com'").n===1);
 const ui=readFileSync(resolve('public/admin/admin.js'),'utf8');
 pruefe('Admin UI hat Ereignisse, Filter, Exporte ohne innerHTML',
  ui.includes('ereignisseBereich()')&&ui.includes('a_ereignisse_cim')&&!/\.innerHTML\s*=/.test(ui));
} catch(e){fehler++;console.log('FEHLER Testablauf: '+e.message);}
finally {
 console.warn=altWarn;console.error=altError;
 if(ohneServer)await new Promise(r=>ohneServer.close(r));
 if(server)await new Promise(r=>server.close(r));
 try{datenbank?.close();}catch{}
 try{rmSync(temp,{recursive:true,force:true});}
 catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
}
console.log('Ereignisse: '+ok+' bestanden, '+fehler+' fehlgeschlagen');
process.exitCode=fehler?1:0;
