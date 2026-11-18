import './test-sprache.mjs';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=mkdtempSync(join(tmpdir(),'schulung-notaus-'));
process.env.DB_DATEI=join(dir,'test.db');
let server,db,ok=0,fail=0;
const pruefe=(name,cond)=>{cond?ok++:fail++;console.log((cond?'OK ':'FEHLER ')+name)};
try{
 const {ladeKonfig}=await import('../konfig.mjs');
 const env={STRIPE_SECRET_KEY:'sk_test_mock_only_123456',STRIPE_WEBHOOK_SECRET:'whsec_mock_only_123456'};
 pruefe('Standard-Schalter aus',ladeKonfig(env).verkaufPausiert===false);
 pruefe('Umgebung pausiert',ladeKonfig({...env,VERKAUF_PAUSIERT:'1'}).verkaufPausiert===true);
 let err='';try{ladeKonfig({...env,VERKAUF_PAUSIERT:'GEHEIM_NICHT_AUSGEBEN'})}catch(e){err=e.message}
 pruefe('Ungültiger Env-Wert ohne Wert im Fehler',err.includes('VERKAUF_PAUSIERT')&&!err.includes('GEHEIM_NICHT_AUSGEBEN'));
 ({db}=await import('../db.mjs'));
 const {verkaufStatus,verkaufStart,verkaufRouter}=await import('../routes-verkauf.mjs');
 const {erstelleServer}=await import('../app.mjs');
 const {passwortHashen}=await import('../auth.mjs');
 const hash=await passwortHashen('NurTestPasswort123');
 const stamp=new Date().toISOString();
 db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,email_bestaetigt,erstellt) VALUES(? ,?,'admin',?,?)").run('notaus-admin@example.invalid',hash,Date.now(),stamp);
 db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,email_bestaetigt,erstellt) VALUES(? ,?,'kunde',?,?)").run('notaus-kunde@example.invalid',hash,Date.now(),stamp);
 db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert,abo_preis_cent,abo_intervall) VALUES('Bezahlkurs','',990000,'huf','veroeffentlicht',?,?,990000,'month')").run(stamp,stamp);
 db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES('Gratis','',0,'huf','veroeffentlicht',?,?)").run(stamp,stamp);
 // Eigener Abo-Kurs (id 3) fuer die Abo-Rechnung: derselbe Kunde hat Kurs 1 schon per Einmalkauf bezahlt; eine Abo-Zahlung fuer Kurs 1 waere seit F-05 eine Doppelzahlung ('pruefen').
 db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert,abo_preis_cent,abo_intervall) VALUES('Abokurs','',990000,'huf','veroeffentlicht',?,?,990000,'month')").run(stamp,stamp);
 const payments=[],mails=[];
 const stripe={
  customers:{create:async()=>({id:'cus_notau'})},
  checkout:{sessions:{create:async x=>{payments.push(x);return {id:'cs_mock_'+payments.length,url:'https://checkout.stripe.com/test'}}}},
  billingPortal:{sessions:{create:async()=>({url:'https://billing.stripe.com/session/mock'})}},
  webhooks:{constructEvent:raw=>JSON.parse(raw.toString('utf8'))}
 };
 const base='http://127.0.0.1:4491';
 server=erstelleServer({stripe,webhookSecret:'test',base,mailer:async x=>{mails.push(x);return true},
  alarmMails:['alarm1@example.invalid','alarm2@example.invalid'],abgleichAutomatik:false}).listen(4491,'127.0.0.1');
 await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 const login=async email=>{
  const res=await fetch(base+'/api/anmelden',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,passwort:'NurTestPasswort123'})});
  return res.headers.get('set-cookie')?.split(';')[0];
 };
 const admin=await login('notaus-admin@example.invalid'),kunde=await login('notaus-kunde@example.invalid');
 const request=async(method,path,cookie,body,headers={})=>{
  const res=await fetch(base+path,{method,headers:{...headers,...(cookie?{cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,body:res.headers.get('content-type')?.includes('json')?await res.json():null};
 };
 const status=()=>request('GET','/api/verkauf-status');
 pruefe('Start nicht pausiert und nur Public-Boolesch',(await status()).body.pausiert===false);
 const kauf=body=>request('POST','/api/kurse/1/kaufen',kunde,body);
 const vor=await kauf({modell:'einmal',zustimmung:true});
 pruefe('Kauf startet Checkout vor Pause',vor.status===200&&payments.length===1);
 const deny=await request('POST','/api/admin/verkauf/pausieren',undefined,{grund:'Problem'});
 pruefe('Gast nicht Admin',deny.status===401);
 const kundeDenied=await request('POST','/api/admin/verkauf/pausieren',kunde,{grund:'Problem'});
 pruefe('Kunde nicht Admin',kundeDenied.status===403);
 const csrf=await request('POST','/api/admin/verkauf/pausieren',admin,{grund:'Problem'},{origin:'https://fremd.invalid'});
 pruefe('Admin CSRF sperrt fremden Ursprung',csrf.status===403);
 for(const grund of ['', 'a'.repeat(201),'x\nb']){
  const r=await request('POST','/api/admin/verkauf/pausieren',admin,{grund});
  pruefe('Ungültiger Grund mit 400: '+grund.length,r.status===400);
 }
 const pause=await request('POST','/api/admin/verkauf/pausieren',admin,{grund:'Falscher Preis'});
 pruefe('Admin kann pausieren',pause.status===200&&pause.body.pausiert===true);
 pruefe('Public-Status zeigt nur pausiert',JSON.stringify((await status()).body)==='{"pausiert":true}');
 const payBefore=payments.length;
 const one=await kauf({modell:'einmal',zustimmung:true}),abo=await kauf({modell:'abo',zustimmung:true});
 pruefe('Einmal und Abo 503 mit verkauf_pausiert',one.status===503&&abo.status===503&&one.body.fehler==='verkauf_pausiert'&&abo.body.fehler==='verkauf_pausiert');
 pruefe('Pause erzeugt keine neue Checkout-Sitzung',payments.length===payBefore);
 const webhook=async e=>{
  const r=await fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':'mock'},body:JSON.stringify({livemode:false,...e})});
  return r.status;
 };
 const paid={id:'evt_notau_paid',type:'checkout.session.completed',data:{object:{id:'cs_mock_1',mode:'payment',payment_status:'paid',
   metadata:{kurs_id:'1',benutzer_id:'2'},customer:'cus_notau',currency:'huf',amount_total:990000,payment_intent:'pi_notau'}}};
 const paidCode=await webhook(paid);
 pruefe('Bereits geöffnete Checkout-Sitzung wird trotz Pause verbucht',paidCode===200&&
  db.prepare("SELECT status FROM bestellungen WHERE stripe_sitzung='cs_mock_1'").get()?.status==='bezahlt');
 const invoice={id:'evt_notau_invoice',type:'invoice.paid',created:Math.floor(Date.now()/1000),data:{object:{
  id:'in_notau',subscription:'sub_notau',status:'paid',customer:'cus_notau',currency:'huf',amount_paid:990000,
  parent:{subscription_details:{subscription:'sub_notau',metadata:{kurs_id:'3',benutzer_id:'2'}}},
  lines:{data:[{period:{end:Math.floor(Date.now()/1000)+2592000}}]}}}};
 const invoiceCode=await webhook(invoice);
 pruefe('Abo-Rechnung trotz Pause verarbeitet',invoiceCode===200&&
  db.prepare("SELECT status FROM bestellungen WHERE stripe_sitzung='in_notau'").get()?.status==='bezahlt');
 const refund={id:'evt_notau_refund',type:'charge.refunded',data:{object:{payment_intent:'pi_notau',amount:990000,amount_refunded:990000,refunded:true,currency:'huf'}}};
 const refundCode=await webhook(refund);
 pruefe('Rückerstattungs-Webhooks bleiben trotz Pause aktiv',refundCode===200&&
  db.prepare("SELECT status FROM bestellungen WHERE stripe_sitzung='cs_mock_1'").get()?.status==='erstattet');
 const gratis=await request('POST','/api/kurse/2/kaufen',kunde,{modell:'einmal'});
 pruefe('Gratis-Kurs bleibt frei',gratis.status===200&&gratis.body.code==='kostenloser_kurs');
 const ich=await request('GET','/api/ich',kunde);
 pruefe('Anmeldung und Konto weiter erreichbar',ich.status===200&&ich.body.angemeldet);
 const konto=await request('GET','/api/konto',kunde);
 pruefe('Konto bleibt auch bei Pause abrufbar',konto.status===200);
 const portal=await request('POST','/api/abo/portal',kunde,{});
 pruefe('Abo-Kundenportal bleibt bei Pause erreichbar',portal.status===200);
 const health=await request('GET','/api/gesundheit');
 pruefe('Gesundheitsroute bleibt bei Pause 200',health.status===200);
 const getMeine=await request('GET','/api/meine-kurse',kunde);
 pruefe('Gekaufte / Gratis-Kurse weiter erreichbar',getMeine.status===200&&getMeine.body.some(k=>k.id===2));
 const pro=await request('GET','/api/admin/verkauf',admin);
 pruefe('Protokoll im Admin',pro.status===200&&pro.body.protokoll.length>=2);
 const again=await request('POST','/api/admin/verkauf/pausieren',admin,{grund:'Wiederholung'});
 pruefe('Doppelte Pause harmlos, aber protokolliert',again.status===200&&again.body.protokoll.length===pro.body.protokoll.length+1);
 const fort=await request('POST','/api/admin/verkauf/fortsetzen',admin,{});
 pruefe('Fortsetzen erfolgreich',fort.status===200&&!fort.body.pausiert);
 const fort2=await request('POST','/api/admin/verkauf/fortsetzen',admin,{});
 pruefe('Doppeltes Fortsetzen idempotent und protokolliert',fort2.status===200&&fort2.body.protokoll.length===fort.body.protokoll.length+1);
 // Ein früherer Testschritt hat den Zugang zu Kurs 1 gebucht (Webhook während der Pause); für einen NEUEN Kauf muss er weg.
 db.prepare("DELETE FROM zugaenge WHERE benutzer_id=(SELECT id FROM benutzer WHERE email='notaus-kunde@example.invalid') AND kurs_id=1").run();
 // Das Abo aus dem Webhook-Schritt laeuft sonst weiter und sperrt den Neukauf (Punkt 2); hier ist es beendet, damit der Test nur die Notaus-Aufhebung pruefen.
 db.prepare("UPDATE abos SET status='beendet' WHERE stripe_abo='sub_notau'").run();
 const after=await kauf({modell:'einmal',zustimmung:true});
 pruefe('Checkout nach Fortsetzen wieder möglich',after.status===200&&payments.length===payBefore+1);
 {
  const {HU}=await import('../texte.mjs');
  const weiter=mails.filter(m=>m.subject===HU.verkauf_alarm_weiter_betreff),pause=mails.filter(m=>m.subject===HU.verkauf_alarm_pause_betreff);
  pruefe('Fortsetzen-Mail nennt keinen Grund und NICHT "Umgebungsvariable" (Admin-Weg), Pause-Mail nennt Grund und was Kunden sehen',
   weiter.length>0&&weiter.every(m=>!m.text.includes(HU.verkauf_alarm_grund+':')&&!m.text.includes(HU.verkauf_alarm_env))&&
   pause.length>0&&pause.every(m=>m.text.includes(HU.verkauf_alarm_grund+':')&&m.text.includes(HU.verkauf_alarm_kunden+': '+HU.verkauf_hinweis)));
 }
 const agent=await request('GET','/api/admin/verkauf',undefined,undefined,{authorization:'Bearer vat_'+'A'.repeat(43)});
 pruefe('Agent-Token 403 und Ablehnung protokolliert',agent.status===403&&
  db.prepare("SELECT 1 FROM agent_protokoll WHERE ergebnis='abgelehnt' AND beschreibung='agent_verboten'").get()!==undefined);
 pruefe('Protokoll ist nur anhängbar',(()=>{
  try{db.exec('UPDATE verkauf_protokoll SET grund=grund');return false}catch{return true}
 })()&&(()=>{try{db.exec('DELETE FROM verkauf_protokoll');return false}catch{return true}})());
 db.prepare('UPDATE verkauf_schalter SET pausiert=1 WHERE id=1').run();
 pruefe('DB-Sperre bei laufender App sofort wirksam',verkaufStatus(false)===true);
 db.prepare('UPDATE verkauf_schalter SET pausiert=0 WHERE id=1').run();
 pruefe('Umgebung erzwingt Pause unabhängig von DB',verkaufStatus(true)===true);
 db.exec('DROP TABLE verkauf_schalter');
 pruefe('Fehlende DB-Tabelle fail-closed',verkaufStatus(false)===true);
 const expr=(await import('express')).default;
 const envApp=expr();envApp.use(expr.json());envApp.use(verkaufRouter({env:true}));
 const envServer=envApp.listen(4490,'127.0.0.1');await new Promise(resolve=>envServer.listening?resolve():envServer.once('listening',resolve));
 const envRes=await fetch('http://127.0.0.1:4490/api/verkauf-status');
 pruefe('ENV=1 pausiert ohne DB-Änderung',envRes.status===200&&(await envRes.json()).pausiert===true);
 await new Promise(resolve=>envServer.close(resolve));
 const js=readFileSync(resolve('public/kunde.js'),'utf8');
 pruefe('Kunde prüft API und zeigt DOM-Hinweis',js.includes('/api/verkauf-status')&&js.includes('verkaufHinweis()')&&js.includes('verkaufPausiert&&!k.zugang'));
 const adminJs=readFileSync(resolve('public/admin/admin.js'),'utf8');
 pruefe('Admin-Schalter DOM-basiert',adminJs.includes('async function verkaufBereich')&&!/\.innerHTML\s*=/.test(adminJs));
 pruefe('Alarm an beide Empfänger ausgelöst',mails.filter(m=>m.subject?.includes('Musterakademie')).length>=4);
 const child=()=>spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',"await import('./db.mjs')"],{cwd:process.cwd(),env:{...process.env,DB_DATEI:join(dir,'migration.db')},encoding:'utf8',timeout:15000});
 const boot1=child(),boot2=child();
 pruefe('DB-Migration startet zweimal',boot1.status===0&&boot2.status===0);
 // Kopie der voll migrierten Test-Datenbank OHNE die Tabellen aus Scheibe 28 = Stand "Scheibe 25 bis 27" (wie die echte Render-Datenbank).
 const {DatabaseSync}=await import('node:sqlite');
 const cloneDb=join(dir,'kopie-25-27.db');
 db.exec("VACUUM INTO '"+cloneDb.replaceAll("'","''")+"'");
 {const c=new DatabaseSync(cloneDb);c.exec('DROP TABLE IF EXISTS verkauf_protokoll;DROP TABLE IF EXISTS verkauf_schalter');c.close();}
 const migrated=()=>spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',"await import('./db.mjs')"],
  {cwd:process.cwd(),env:{...process.env,DB_DATEI:cloneDb},encoding:'utf8',timeout:15000});
 const old1=migrated(),old2=migrated();
 pruefe('Bereits mit Scheiben 25 bis 27 migrierte Kopie startet zweimal',old1.status===0&&old2.status===0);
 {const g=new DatabaseSync(cloneDb,{readOnly:true});
  pruefe('Kopie ohne Scheibe-28-Tabellen: Schalter wird angelegt und steht auf AUS (Verkauf läuft)',g.prepare('SELECT pausiert FROM verkauf_schalter WHERE id=1').get()?.pausiert===0&&
   g.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'verkauf_%'").get().n>=2);g.close();}
}catch(e){fail++;console.log('FEHLER Testablauf '+(e.code||e.name||'unbekannt'))}
finally{
 try{await new Promise(resolve=>server?server.close(resolve):resolve())}catch{}
 try{db?.close()}catch{}
 try{rmSync(dir,{recursive:true,force:true})}catch(e){if(!['EBUSY','EPERM'].includes(e.code))throw e}
}
console.log('Notaus '+ok+' OK, '+fail+' FEHLER');process.exitCode=fail?1:0;
