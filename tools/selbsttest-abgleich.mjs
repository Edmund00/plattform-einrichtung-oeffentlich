import './test-sprache.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=mkdtempSync(join(tmpdir(),'schulung-abgleich-'));
process.env.DB_DATEI=join(dir,'test.db');
let db,server,ok=0,fail=0;
const check=(name,cond)=>{if(cond)ok++;else fail++;console.log((cond?'OK ':'FEHLER ')+name)};
try{
 ({db}=await import('../db.mjs'));
 const {abgleichDienst,stripePages,stripeRead,abgleichGesundheit}=await import('../abgleich.mjs');
 const {abgleichAlarm}=await import('../abgleich-alarm.mjs');
 const {HU}=await import('../texte.mjs');
 const date=new Date().toISOString();
 db.prepare("INSERT INTO benutzer(email,passwort_hash,stripe_kunde,erstellt) VALUES(?,'test','cus_1',?)").run('buyer@example.invalid',date);
 db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES('Kurs','',990000,'huf','veroeffentlicht',?,?)").run(date,date);
 const order=()=>db.prepare("SELECT * FROM bestellungen WHERE stripe_sitzung='cs_one'").get();
 const putOrder=()=>db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES('cs_one','pi_one',1,1,990000,'huf','bezahlt','einmal',?,?)").run(date,date);
 const session={id:'cs_one',mode:'payment',payment_status:'paid',amount_total:990000,currency:'huf',customer:'cus_1',metadata:{benutzer_id:'1',kurs_id:'1'}};
 const seen={};
 const mock=(data={})=>{
  const d={sessions:[session],invoices:[],refunds:[],subscriptions:[],...data};
  const list=name=>async(args)=>{seen[name]=args;return {data:d[name],has_more:false}};
  return {checkout:{sessions:{list:list('sessions')}},invoices:{list:list('invoices')},refunds:{list:list('refunds')},subscriptions:{list:list('subscriptions')}};
 };
 putOrder();
 const before=JSON.stringify(db.prepare('SELECT * FROM bestellungen').all());
 const good=await abgleichDienst({stripe:mock()}).lauf();
 check('Sauberer Lauf ohne Abweichung',good.ok&&good.abweichungen===0);
 check('Abgleich ändert Bestellungen nicht',before===JSON.stringify(db.prepare('SELECT * FROM bestellungen').all()));
 const counts=()=>db.prepare("SELECT art,stripe_id,bestell_id,betrag FROM abgleich_abweichung WHERE lauf_id=(SELECT MAX(id) FROM abgleich_lauf)").all();
 db.prepare("DELETE FROM bestellungen WHERE stripe_sitzung='cs_one'").run();
 const missing=await abgleichDienst({stripe:mock()}).lauf();
 check('Stripe bezahlt, Bestellung fehlt',missing.abweichungen>=1&&counts().some(x=>x.art==='stripe_ohne_bestellung'&&x.stripe_id==='cs_one'&&x.betrag===990000));
 putOrder();
 const platform=await abgleichDienst({stripe:mock({sessions:[]})}).lauf();
 check('Plattform bezahlt ohne Stripe',platform.abweichungen>=1&&counts().some(x=>x.art==='bestellung_ohne_stripe'&&x.stripe_id==='cs_one'));
 const mismatch=await abgleichDienst({stripe:mock({sessions:[{...session,amount_total:880000}]})}).lauf();
 check('Betrag falsch',mismatch.abweichungen>=1&&counts().some(x=>x.art==='betrag'&&x.betrag===880000));
 db.prepare("UPDATE bestellungen SET status='erstattet' WHERE stripe_sitzung='cs_one'").run();
 const refunded=await abgleichDienst({stripe:mock({refunds:[]})}).lauf();
 check('Plattform erstattet ohne Stripe',refunded.abweichungen>=1&&counts().some(x=>x.art==='erstattung_ohne_stripe'));
 db.prepare("UPDATE bestellungen SET status='bezahlt' WHERE stripe_sitzung='cs_one'").run();
 const refund={id:'re_one',status:'succeeded',payment_intent:'pi_one',amount:990000,currency:'huf'};
 const r=await abgleichDienst({stripe:mock({refunds:[refund]})}).lauf();
 check('Stripe-Rückzahlung unverbucht',r.abweichungen>=1&&counts().some(x=>x.art==='erstattung_nicht_verarbeitet'&&x.stripe_id==='re_one'));

 // Abo-Rechnungen werden über die echte Parent-Struktur aus Stripe 18/Basil zugeordnet.
 const invoice={id:'in_one',status:'paid',amount_paid:990000,currency:'huf',customer:'cus_1',
  parent:{subscription_details:{subscription:'sub_one',metadata:{benutzer_id:'1',kurs_id:'1'}}}};
 db.prepare("INSERT INTO abos(stripe_abo,benutzer_id,kurs_id,status,erstellt,geaendert) VALUES('sub_one',1,1,'aktiv',?,?)").run(date,date);
 const invTest=await abgleichDienst({stripe:mock({invoices:[invoice]})}).lauf();
 check('Bezahlte Abo-Rechnung ohne Plattform-Bestellung',invTest.abweichungen>0&&counts().some(x=>x.art==='stripe_ohne_bestellung'&&x.stripe_id==='in_one'&&x.betrag===990000));
 const subTest=await abgleichDienst({stripe:mock({subscriptions:[{id:'sub_one',status:'canceled'}]})}).lauf();
 check('Abo-Status-Abweichung',subTest.abweichungen>0&&counts().some(x=>x.art==='abo_status'&&x.stripe_id==='sub_one'));
 db.prepare("INSERT INTO zugaenge(benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES(1,1,'zahlung',?,?)").run(date,Date.now()+86400000);
 db.prepare("UPDATE zugaenge SET quelle='abo' WHERE benutzer_id=1 AND kurs_id=1").run();
 db.prepare("UPDATE bestellungen SET status='erstattet' WHERE stripe_sitzung='cs_one'").run();
 const accessTest=await abgleichDienst({stripe:mock({subscriptions:[{id:'sub_one',status:'canceled'}]})}).lauf();
 check('Beendetes Abo mit aktiver Zugangssperre-Abweichung',accessTest.abweichungen>0&&counts().some(x=>x.art==='abo_zugang'&&x.stripe_id==='sub_one'));
 db.prepare('DELETE FROM zugaenge WHERE benutzer_id=1 AND kurs_id=1').run();
 // I5/U4: App-Abo beendet, bei Stripe laeuft es noch -> der Abgleich beendet es dort nachtraeglich (nur Stripe, die App-Tabellen bleiben unveraendert)
 db.prepare("UPDATE abos SET status='beendet' WHERE stripe_abo='sub_one'").run();
 const aboVorher=JSON.stringify(db.prepare('SELECT * FROM abos').all());
 const gekuendigt=[]; const heilMock=(fehler=false)=>{const m=mock({subscriptions:[{id:'sub_one',status:'active'}]});
  m.subscriptions.retrieve=async()=>({status:'active'});m.subscriptions.cancel=async id=>{gekuendigt.push(id);if(fehler)throw new Error('stripe down');return {id,status:'canceled'};};return m;};
 const heil=await abgleichDienst({stripe:heilMock()}).lauf();
 check('Heilung: App beendet, Stripe aktiv -> bei Stripe beendet und gemeldet (abo_nachgekuendigt)',gekuendigt.includes('sub_one')&&counts().some(x=>x.art==='abo_nachgekuendigt'&&x.stripe_id==='sub_one'));
 check('Heilung aendert keine App-Tabelle',aboVorher===JSON.stringify(db.prepare('SELECT * FROM abos').all()));
 gekuendigt.length=0;
 const heilFehler=await abgleichDienst({stripe:heilMock(true)}).lauf();
 check('Heilung scheitert -> Abweichung abo_status bleibt, Lauf ok',heilFehler.ok&&counts().some(x=>x.art==='abo_status'&&x.stripe_id==='sub_one')&&!counts().some(x=>x.art==='abo_nachgekuendigt'));
 const endExp=await abgleichDienst({stripe:mock({subscriptions:[{id:'sub_one',status:'incomplete_expired'}]})}).lauf();
 check('Status incomplete_expired passt zu beendet (keine Abweichung)',!counts().some(x=>x.art==='abo_status'));
 db.prepare("UPDATE abos SET status='aktiv' WHERE stripe_abo='sub_one'").run();
 await abgleichDienst({stripe:mock({subscriptions:[{id:'sub_one',status:'incomplete_expired'}]})}).lauf();
 check('incomplete_expired bei Stripe, App aktiv -> Abweichung abo_status',counts().some(x=>x.art==='abo_status'&&x.stripe_id==='sub_one'));
 db.prepare("UPDATE abos SET status='beendet' WHERE stripe_abo='sub_one'").run();
 db.prepare("UPDATE abos SET status='zahlung_offen' WHERE stripe_abo='sub_one'").run();
 await abgleichDienst({stripe:mock({subscriptions:[{id:'sub_one',status:'unpaid'}]})}).lauf();
 const keinAbw1=!counts().some(x=>x.art==='abo_status');
 await abgleichDienst({stripe:mock({subscriptions:[{id:'sub_one',status:'paused'}]})}).lauf();
 check('Status unpaid und paused passen zu zahlung_offen (keine Abweichung)',keinAbw1&&!counts().some(x=>x.art==='abo_status'));
 db.prepare("UPDATE abos SET status='aktiv' WHERE stripe_abo='sub_one'").run();
 // U4: Streitfall bei Stripe (needs_response/under_review/lost), Bestellung in der App noch "bezahlt" -> Abweichung streit_nicht_verarbeitet; gewonnene/Anfragen nicht
 db.prepare("UPDATE bestellungen SET status='bezahlt' WHERE stripe_sitzung='cs_one'").run();
 const streitMock=(status)=>{const m=mock();m.disputes={list:async()=>({data:[{id:'du_one',payment_intent:'pi_one',status,amount:990000,currency:'huf',created:Math.floor(Date.now()/1000)}],has_more:false})};return m;};
 await abgleichDienst({stripe:streitMock('needs_response')}).lauf();
 check('Streitfall bei Stripe, Bestellung noch bezahlt -> Abweichung streit_nicht_verarbeitet',counts().some(x=>x.art==='streit_nicht_verarbeitet'&&x.stripe_id==='du_one'));
 await abgleichDienst({stripe:streitMock('won')}).lauf();
 const streitWon=!counts().some(x=>x.art==='streit_nicht_verarbeitet');
 await abgleichDienst({stripe:streitMock('warning_needs_response')}).lauf();
 check('Gewonnener Streit und bloße Bank-Anfrage: keine Abweichung',streitWon&&!counts().some(x=>x.art==='streit_nicht_verarbeitet'));
 db.prepare("UPDATE bestellungen SET status='pruefen',grund='streitfall' WHERE stripe_sitzung='cs_one'").run();
 await abgleichDienst({stripe:streitMock('needs_response')}).lauf();
 check('Streitfall schon verarbeitet (Bestellung pruefen): keine Abweichung',!counts().some(x=>x.art==='streit_nicht_verarbeitet'));
 db.prepare("UPDATE bestellungen SET status='bezahlt',grund=NULL WHERE stripe_sitzung='cs_one'").run();
 let dup=false;try{db.prepare("INSERT INTO benutzer(email,passwort_hash,stripe_kunde,erstellt) VALUES('dup@example.invalid','hash','cus_1',?)").run(date)}catch{dup=true}
 check('Doppelte Stripe-Kunden-Zuordnung schon durch UNIQUE blockiert',dup);

 const list=async(args)=>({data:[{id:args.starting_after?'cs_last':'cs_first'}],has_more:!args.starting_after});
 check('Stripe-Paginierung', (await stripePages(list,0)).length===2);
 let pagesCalls=0,pagesBlocked=false;
 try{await stripePages(async()=>({data:[{id:'cs_page_'+(++pagesCalls)}],has_more:true}),0)}catch{pagesBlocked=true}
 check('Stripe-Limit nach 50 Seiten abgebrochen',pagesBlocked&&pagesCalls===50);
 let release;const pending=new Promise(r=>release=r);
 const pendingMock=mock();pendingMock.checkout.sessions.list=async()=>{await pending;return {data:[],has_more:false}};
 const mutex=abgleichDienst({stripe:pendingMock});
 const firstRun=mutex.lauf();const secondRun=await mutex.lauf();release();await firstRun;
 check('Kein zweiter Lauf parallel',!secondRun.ok&&secondRun.beschaeftigt);
 let retries=0;
 await stripeRead(async()=>{if(++retries<3)throw {statusCode:429};return {ok:true}},{pause:async()=>{}});
 check('429 zweimal wiederholt',retries===3);
 let error=false;try{await stripeRead(async()=>{throw {statusCode:503}},{pause:async()=>{}})}catch{error=true}
 check('3x 503 führt zum Fehler',error);
 const beforeLog=db.prepare('SELECT COUNT(*) n FROM abgleich_lauf').get().n;
 const failed=await abgleichDienst({stripe:{checkout:{sessions:{list:async()=>{throw {statusCode:503}}}},invoices:{list:async()=>({data:[]})},refunds:{list:async()=>({data:[]})},subscriptions:{list:async()=>({data:[]})}},pause:async()=>{}}).lauf();
 check('Fehlerlauf wird protokolliert',!failed.ok&&db.prepare('SELECT COUNT(*) n FROM abgleich_lauf').get().n===beforeLog+1);
 check('Gesundheit nach Fehlerlauf nicht gesund',abgleichGesundheit()===false);

 const cleanId=db.prepare("INSERT INTO abgleich_lauf(start,ende,modus,fenster_tage,geprueft_sitzungen,geprueft_rechnungen,geprueft_erstattungen,geprueft_abos,abweichungen_anzahl,status,meldung) VALUES(?,?,'test',35,0,0,0,0,0,'ok','abgleich_ok')").run(date,new Date().toISOString()).lastInsertRowid;
 check('Gesundheit nach neuem sauberem Lauf gesund',abgleichGesundheit()===true);
 const testRunId=db.prepare("INSERT INTO abgleich_lauf(start,ende,modus,fenster_tage,geprueft_sitzungen,geprueft_rechnungen,geprueft_erstattungen,geprueft_abos,abweichungen_anzahl,status,meldung) VALUES(?,?,'test',35,0,0,0,0,1,'abweichung','abgleich_abweichung')").run(date,new Date().toISOString()).lastInsertRowid;
 db.prepare("INSERT INTO abgleich_abweichung(lauf_id,art,stripe_id,betrag,waehrung,text,zeit) VALUES(?,'stripe_ohne_bestellung','cs_alt_sandbox',990000,'huf','abgleich_stripe_ohne_bestellung',?)").run(testRunId,new Date().toISOString());
 check('Im TEST-Modus faerben alte Sandbox-Zahlungen die Gesundheit nicht rot',abgleichGesundheit()===true);
 const criticalId=db.prepare("INSERT INTO abgleich_lauf(start,ende,modus,fenster_tage,geprueft_sitzungen,geprueft_rechnungen,geprueft_erstattungen,geprueft_abos,abweichungen_anzahl,status,meldung) VALUES(?,?,'live',35,0,0,0,0,1,'abweichung','abgleich_abweichung')").run(date,new Date().toISOString()).lastInsertRowid;
 db.prepare("INSERT INTO abgleich_abweichung(lauf_id,art,stripe_id,betrag,waehrung,text,zeit) VALUES(?,'stripe_ohne_bestellung','cs_critical',990000,'huf','abgleich_stripe_ohne_bestellung',?)").run(criticalId,new Date().toISOString());
 check('Gesundheit bei offener bezahlter Stripe-Bestellung im LIVE-Modus kritisch',abgleichGesundheit()===false);
 const staleDate=new Date(Date.now()-37*3600000).toISOString();
 db.prepare("INSERT INTO abgleich_lauf(start,ende,modus,fenster_tage,geprueft_sitzungen,geprueft_rechnungen,geprueft_erstattungen,geprueft_abos,abweichungen_anzahl,status,meldung) VALUES(?,?,'test',35,0,0,0,0,0,'ok','abgleich_ok')").run(staleDate,staleDate);
 check('Gesundheit bei 37h altem Abgleich kritisch',abgleichGesundheit()===false);
 // Abnahme 01.11.2026 (Pruefrunde, Fund 4): neue leere Datenbank ohne bisherigen Lauf
 check('Neue leere Datenbank (kein Lauf), erste Stunde nach dem Start: gesund (kein 503 beim Livegang)',abgleichGesundheit(30,null)===true);
 check('Kein Lauf und mehr als eine Stunde nach dem Start: nicht gesund (Automatik arbeitet nicht)',abgleichGesundheit(7200,null)===false);
 const spawnDb=()=>spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',"await import('./db.mjs')"],{cwd:process.cwd(),env:{...process.env,DB_DATEI:process.env.DB_DATEI},encoding:'utf8',timeout:15000});
 const boot1=spawnDb(),boot2=spawnDb();
 check('Neue Tabellen bei zweimaligem Start idempotent',boot1.status===0&&boot2.status===0);
 await abgleichDienst({stripe:mock()}).lauf();
 check('Abos werden mit status all abgefragt (auch beendete)',seen.subscriptions?.status==='all');
 db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt) VALUES('anon@example.invalid','test',?)").run(date);
 const gone=Number(db.prepare("SELECT id FROM benutzer WHERE email='anon@example.invalid'").get().id);
 db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES('cs_anon','pi_anon',?,1,990000,'huf','bezahlt','einmal',?,?)").run(gone,date,date);
 const anon={...session,id:'cs_anon',customer:'cus_geloescht',metadata:{benutzer_id:String(gone),kurs_id:'1'}};
 await abgleichDienst({stripe:mock({sessions:[anon]})}).lauf();
 check('Geloeschter Kunde ohne Kundennummer erzeugt keine Betrags-Abweichung',!counts().some(x=>x.art==='betrag'&&x.stripe_id==='cs_anon'));

 for(const name of ['abgleich_lauf','abgleich_abweichung']){
  let blockedUpdate=false,blockedDelete=false;
  try{db.prepare('UPDATE '+name+' SET id=id').run()}catch{blockedUpdate=true}
  try{db.prepare('DELETE FROM '+name).run()}catch{blockedDelete=true}
  check(name+' append-only',blockedUpdate&&blockedDelete);
 }
 const sent=[];const alarm=abgleichAlarm({mailer:async x=>{sent.push(x);return true},adressen:['alarm@example.invalid'],base:'https://platform.invalid'});
 await alarm({status:'abweichung',items:[{art:'betrag',stripe_id:'cs_one',bestell_id:1,betrag:990000,waehrung:'huf',text:'abgleich_betrag'}]});
 await alarm({status:'abweichung',items:[{art:'betrag',stripe_id:'cs_one',bestell_id:1,betrag:990000,waehrung:'huf',text:'abgleich_betrag'}]});
 check('Alarm für identische Liste einmal',sent.length===1);
 await alarm({status:'ok',items:[]});
 check('Entwarnung nach sauberem Lauf',sent.length===2&&sent[1].subject===HU.abgleich_alarm_ok_betreff);
 check('Kein Passwort oder Kundendaten in Audit',!JSON.stringify(db.prepare('SELECT * FROM abgleich_abweichung').all()).includes('buyer@example.invalid'));

 const {passwortHashen}=await import('../auth.mjs');
 const hash=await passwortHashen('AbgleichTestPasswordOnly');
 db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(? ,?,'admin',?)").run('admin@beispiel.invalid',hash,date);
 db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(? ,?,'kunde',?)").run('kunde@beispiel.invalid',hash,date);
 const {erstelleServer}=await import('../app.mjs');
 const stripe={...mock(),webhooks:{constructEvent:()=>({})}};
 const base='http://127.0.0.1:4493';
 server=erstelleServer({stripe,webhookSecret:'whsec_mock',base,abgleichAutomatik:false}).listen(4493,'127.0.0.1');
 await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 const login=async email=>{
  const r=await fetch(base+'/api/anmelden',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,passwort:'AbgleichTestPasswordOnly'})});
  return r.headers.get('set-cookie')?.split(';')[0];
 };
 const adminCookie=await login('admin@beispiel.invalid'),kundeCookie=await login('kunde@beispiel.invalid');
 const request=async(method,path,cookie,body,headers={})=>{
  const r=await fetch(base+path,{method,headers:{...headers,...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},
    body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
 };
 check('Gast Admin-API 401',(await request('GET','/api/admin/abgleich')).status===401);
 check('Kunde Admin-API 403',(await request('GET','/api/admin/abgleich',kundeCookie)).status===403);
 check('Agent-Bearer Admin-API 403',(await request('GET','/api/admin/abgleich',null,undefined,{authorization:'Bearer vat_'+'A'.repeat(43)})).status===403);
 check('Admin darf Verlauf mit Bestell-IDs lesen',(await request('GET','/api/admin/abgleich',adminCookie)).status===200);
 check('Admin CSRF bleibt gesperrt',(await request('POST','/api/admin/abgleich/jetzt',adminCookie,{},{Origin:'https://fremd.invalid'})).status===403);
 const manual=await request('POST','/api/admin/abgleich/jetzt',adminCookie,{});
 check('Manueller Abgleich liefert nur Ergebnis',manual.status===200&&['ok','abweichung'].includes(manual.body.status));

}catch(e){fail++;console.log('FEHLER TESTABLAUF '+(e?.code||e?.message))}
finally{try{await new Promise(resolve=>server?server.close(resolve):resolve())}catch{}try{db?.close()}catch{}try{rmSync(dir,{recursive:true,force:true})}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e}}
console.log('Abgleich '+ok+' OK, '+fail+' FEHLER');process.exitCode=fail?1:0;
