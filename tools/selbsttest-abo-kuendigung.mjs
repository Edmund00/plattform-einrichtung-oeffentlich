import './test-sprache.mjs';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
const ordner=mkdtempSync(join(tmpdir(),'schulung-abo-kuendigung-'));
process.env.DB_DATEI=join(ordner,'test.db');
const BASE='http://127.0.0.1:4498',PASS=randomBytes(24).toString('hex');
let db,server,ok=0,fehler=0,portals=[],mails=[],stripeFehler=false,fremdeUrl=false,mailFehler=false;
const pruefe=(name,wert)=>{wert?ok++:fehler++;console.log((wert?'OK ':'FEHLER ')+name);};
const stripe={billingPortal:{sessions:{create:async data=>{
 portals.push(data);if(stripeFehler)throw Error('PRIVATE_PROVIDER_ERROR');
 return {url:fremdeUrl?'https://example.org/abc':'https://billing.stripe.com/p/session_test'};
}}},webhooks:{constructEvent:body=>JSON.parse(body.toString())}};
const mailer=async mail=>{mails.push(mail);return !(mailFehler&&mail.to==='kuend-c@example.com')};
function client(){let cookie='';return {async post(path,body){
 const headers={'Content-Type':'application/json'};if(cookie)headers.Cookie=cookie;
 const r=await fetch(BASE+path,{method:'POST',headers,body:JSON.stringify(body)});
 const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];
 return {status:r.status,d:await r.json(),cache:r.headers.get('cache-control')};
}};}
try{
 ({db}=await import('../db.mjs'));
 const {passwortHashen}=await import('../auth.mjs');
 const {erstelleServer}=await import('../app.mjs');
 const ph=await passwortHashen(PASS);
 const insert=(email,rolle='kunde')=>Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt,stripe_kunde) VALUES(?,?,?,?,?,?)")
 .run(email,ph,rolle,new Date().toISOString(),Date.now(),'cus_'+email.split('@')[0]).lastInsertRowid);
 const a=insert('kuend-a@example.com'),b=insert('kuend-b@example.com'),adminId=insert('kuend-admin@example.com','admin');
 const k=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,'',990000,'huf','veroeffentlicht',?,?)")
 .run('VALORE Abo',new Date().toISOString(),new Date().toISOString()).lastInsertRowid);
 const abo=(user,stripeId)=>Number(db.prepare("INSERT INTO abos(stripe_abo,benutzer_id,kurs_id,status,gueltig_bis,erstellt,geaendert) VALUES(?,?,?,'aktiv',?,?,?)")
 .run(stripeId,user,k,Date.now()+30*86400000,new Date().toISOString(),new Date().toISOString()).lastInsertRowid);
 const a1=abo(a,'sub_kuend_a'),b1=abo(b,'sub_kuend_b');
 const c=insert('kuend-c@example.com'),c1=abo(c,'sub_kuend_c');
 server=erstelleServer({stripe,webhookSecret:'test',base:BASE,mailer,verkaufsmeldungMail:'owner@example.com'}).listen(4498,'127.0.0.1');
 await new Promise((yes,no)=>{if(server.listening)return yes();server.once('listening',yes);server.once('error',no)});
 const guest=client(),kunde=client(),admin=client();
 pruefe('Gast 401',(await guest.post('/api/abo/lemondas',{})).status===401);
 await admin.post('/api/anmelden',{email:'kuend-admin@example.com',passwort:PASS});
 pruefe('Admin 403',(await admin.post('/api/abo/lemondas',{})).status===403);
 await kunde.post('/api/anmelden',{email:'kuend-a@example.com',passwort:PASS});
 pruefe('Fremdes Abo 404',(await kunde.post('/api/abo/lemondas',{abo_id:b1})).status===404);
 const start=await kunde.post('/api/abo/lemondas',{abo_id:a1});
 pruefe('Stripe-Portal flow_data, no-store',start.status===200&&start.cache==='no-store'&&
  portals.at(-1).flow_data.type==='subscription_cancel'&&
  portals.at(-1).flow_data.subscription_cancel.subscription==='sub_kuend_a'&&
  portals.at(-1).return_url===BASE+'/#/fiokom'&&portals.at(-1).flow_data.after_completion.redirect.return_url===BASE+'/#/fiokom?abo=lemondva');
 fremdeUrl=true;pruefe('Fremde URL 502',(await kunde.post('/api/abo/lemondas',{})).status===502);fremdeUrl=false;
 stripeFehler=true;const failure=await kunde.post('/api/abo/lemondas',{});
 pruefe('Providerfehler 503, ohne Details',failure.status===503&&!JSON.stringify(failure.d).includes('PRIVATE_PROVIDER_ERROR'));stripeFehler=false;
 const event={id:'evt_kuend_a',type:'customer.subscription.updated',created:Math.floor(Date.now()/1000)+1,
  data:{object:{id:'sub_kuend_a',cancel_at_period_end:true}}};
 const webhook=async e=>fetch(BASE+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'test'},body:JSON.stringify({livemode:false,...e})});
 pruefe('Erster Webhook erfolgreich',(await webhook(event)).status===200);
 await webhook(event);
 pruefe('Kündigung in DB gespeichert',db.prepare('SELECT endet_zum_periodenende FROM abos WHERE id=?').get(a1).endet_zum_periodenende===1);
 const tasks=db.prepare('SELECT * FROM abo_kuendigung_mail WHERE abo_id=?').all(a1);
 pruefe('Doppelte Webhooks nur ein Mailauftrag',tasks.length===1);
 for(let i=0;i<80&&!mails.some(m=>m.to==='kuend-a@example.com');i++)await new Promise(r=>setTimeout(r,10));
 const mail=mails.filter(m=>m.to==='kuend-a@example.com');
 pruefe('Eine Kündigungsmail, Datum, Kurs und Footer',mail.length===1&&mail[0].text.includes('VALORE Abo')&&mail[0].text.includes('A lemondás rögzítésének időpontja:')&&mail[0].text.includes('A hozzáférésed eddig tart:')&&mail[0].text.includes('rendszerüzenet'));
 pruefe('Gabriella-Ereignis',db.prepare("SELECT COUNT(*) n FROM ereignisse WHERE typ='abo_gekuendigt'").get().n===1);
 for(let i=0;i<150&&!mails.some(m=>m.to==='owner@example.com'&&/lemondva/.test(m.subject));i++)await new Promise(r=>setTimeout(r,10));
 const meldung=mails.filter(m=>m.to==='owner@example.com'&&/lemondva/.test(m.subject));
 pruefe('Meldungsmail an Gabriella wird wirklich gesendet (Betreff mit Kurs, Kunde, Enddatum)',meldung.length===1&&meldung[0].subject==='Előfizetés lemondva: VALORE Abo'&&
   meldung[0].text.includes('kuend-a@example.com')&&meldung[0].text.includes('A felhasználó hozzáférése eddig tart:')&&!meldung[0].text.includes('A hozzáférésed'));
 pruefe('Meldung steht im Ausgang als gesendet',db.prepare("SELECT COUNT(*) n FROM meldung_ausgang m JOIN ereignisse e ON e.id=m.ereignis_id WHERE e.typ='abo_gekuendigt' AND m.status='gesendet'").get().n===1);
 // Ein Update ohne Zustandswechsel darf keine Kündigungsmail erzeugen.
 await webhook({...event,id:'evt_kuend_a_repeat',created:event.created+1});
 pruefe('Update ohne Statuswechsel erstellt keinen weiteren Auftrag',db.prepare('SELECT COUNT(*) n FROM abo_kuendigung_mail WHERE abo_id=?').get(a1).n===1);
 mailFehler=true;
 const evC={id:'evt_kuend_c',type:'customer.subscription.updated',created:event.created+2,data:{object:{id:'sub_kuend_c',cancel_at_period_end:true}}};
 await webhook(evC);
 pruefe('Mailversandfehler ändert Abo-Status nicht',db.prepare('SELECT status,endet_zum_periodenende FROM abos WHERE id=?').get(c1).endet_zum_periodenende===1);
 const another=await kunde.post('/api/abo/lemondas',{});
 pruefe('Nach Kündigung kein aktives Abo 409',another.status===409);
 // Punkt 1: Der Knopf wird auch bei offener Zahlung angezeigt (kunde.js), also muss die Route dann ebenfalls kuendigen (vorher "Nem található").
 const dNutzer=insert('kuend-d@example.com'),d1=abo(dNutzer,'sub_kuend_d');
 db.prepare("UPDATE abos SET status='zahlung_offen' WHERE id=?").run(d1);
 const kd=client();await kd.post('/api/anmelden',{email:'kuend-d@example.com',passwort:PASS});
 const offen=await kd.post('/api/abo/lemondas',{});
 pruefe('Abo mit offener Zahlung laesst sich ueber den Knopf kuendigen (Portal-Ablauf)',offen.status===200&&portals.at(-1).flow_data.subscription_cancel.subscription==='sub_kuend_d');
 const offenId=await kd.post('/api/abo/lemondas',{abo_id:d1});
 pruefe('... auch mit abo_id (richtiges Stripe-Abo)',offenId.status===200&&portals.at(-1).flow_data.subscription_cancel.subscription==='sub_kuend_d');
 db.prepare("UPDATE abos SET status='beendet' WHERE id=?").run(d1);
 pruefe('Beendetes Abo bleibt nicht kuendbar (404 mit abo_id, 409 ohne)',(await kd.post('/api/abo/lemondas',{abo_id:d1})).status===404&&(await kd.post('/api/abo/lemondas',{})).status===409);
 const js=readFileSync(resolve('public/kunde.js'),'utf8').replace(/\r\n/g,'\n');
 const hu=JSON.parse(readFileSync(resolve('texte/hu.json'),'utf8'));
 pruefe('Punkt 4: "Megnyitás" in Fiókom nur bei bezahlter Bestellung (nicht bei erstatteter)',
   /b\.kurs_id&&b\.status==='bezahlt'\?h\('a',\{class:'knopf klein',href:'#\/eloadas\/'\+b\.kurs_id\},t\('k_megnyitas'\)\)/.test(js));
 pruefe('Fiókom- und Kurzusaim-Knopf, Enddatum',js.includes("'/api/abo/lemondas'")&&js.includes('b.abo_ende')&&js.includes("href:'#/fiokom'")&&hu.k_abo_lemondas==='Előfizetés lemondása');
}catch(e){fehler++;console.log('FEHLER Testablauf: '+(e.code||e.message))}
finally{try{await new Promise(r=>server?server.close(r):r())}catch{}try{db?.close()}catch{}try{rmSync(ordner,{recursive:true,force:true})}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e}}
console.log('Abo-Kuendigung: '+ok+' bestanden, '+fehler+' fehlgeschlagen');process.exitCode=fehler?1:0;
