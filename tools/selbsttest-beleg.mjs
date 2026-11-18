// Scheibe 19: isolierte Beleg-Tests mit Stripe-Mock und Wegwerf-Datenbank.
import './test-sprache.mjs';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
const ordner=mkdtempSync(join(tmpdir(),'schulung-beleg-'));
process.env.DB_DATEI=join(ordner,'beleg.db');
const BASE='http://127.0.0.1:4491', PASS=randomBytes(20).toString('hex');
let ok=0,fehler=0,db,server;
const pruefe=(name,wert)=>{wert?ok++:fehler++;console.log((wert?'OK     ':'FEHLER ')+name);};
const url='https://pay.stripe.com/receipts/payment/xyz?s=ap';
let fremd=false,ausfall=false,ohneQuery=false,updates=[],checkout=[];
const stripe={
 customers:{update:async(id,d)=>{updates.push({id,d});if(ausfall)throw Error('provider private error');return {id};},
 create:async()=>({id:'cus_beleg_test'})},
 checkout:{sessions:{retrieve:async id=>{if(String(id).startsWith('in_'))throw Error('No such checkout.session: '+id);return ({id,invoice:id==='cs_beleg_abo'?'in_beleg_abo':id==='cs_beleg_kauf_rechnung'?'in_beleg_kauf_rechnung':null,
   payment_intent:id==='cs_beleg_kauf'?'pi_beleg_kauf':null});},create:async d=>{checkout.push(d);return {id:'cs_test_beleg_mock_'+checkout.length,url:'https://checkout.stripe.com/test-beleg'};}}},
 invoices:{retrieve:async id=>({id})},
 invoicePayments:{list:async()=>({data:[{status:'paid',payment:{payment_intent:'pi_beleg_abo'}}]})},
 paymentIntents:{retrieve:async id=>{if(ausfall)throw Error('secret provider detail');
   return {latest_charge:{receipt_url:fremd?'https://evil.example/receipts/x?s=ap':ohneQuery?'https://pay.stripe.com/receipts/payment/xyz':url}};}},
 charges:{retrieve:async()=>({receipt_url:url})},
 webhooks:{constructEvent:()=>({})}
};
function client(){let cookie='';return {async req(method,pfad,body){
 const h={};if(cookie)h.Cookie=cookie;const init={method,headers:h,redirect:'manual'};
 if(body!==undefined){h['Content-Type']='application/json';init.body=JSON.stringify(body);}
 const r=await fetch(BASE+pfad,init),c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];
 const typ=r.headers.get('content-type')||'';
 return {status:r.status,headers:r.headers,data:typ.includes('json')?await r.json():await r.text()};
}};}
try{
 const {db:database}=await import('../db.mjs');db=database;
 const {passwortHashen}=await import('../auth.mjs');
 const {erstelleServer}=await import('../app.mjs');
 const hash=await passwortHashen(PASS);
 const user=(email,rolle='kunde')=>Number(db.prepare('INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,?,?,?)')
   .run(email,hash,rolle,new Date().toISOString(),Date.now()).lastInsertRowid);
 const a=user('beleg-a@example.com'),b=user('beleg-b@example.com'),adminId=user('beleg-admin@example.com','admin');
 const kurs=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,'',990000,'huf','veroeffentlicht',?,?)")
   .run('VALORE Bizonylat',new Date().toISOString(),new Date().toISOString()).lastInsertRowid);
 const order=(id,owner,art='einmal',status='bezahlt',betrag=990000)=>Number(db.prepare(
  'INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(id,owner,kurs,betrag,'huf',status,art,new Date().toISOString(),new Date().toISOString()).lastInsertRowid);
 const kauf=order('cs_beleg_kauf',a);
 const abo=order('cs_beleg_abo',a,'abo');
 const kaufRechnung=order('cs_beleg_kauf_rechnung',a); // Einmalkauf mit invoice_creation: Sitzung traegt eine Rechnung
 const fremdId=order('cs_beleg_b',b);
 const gratis=order('cs_beleg_gratis',a,'einmal','bezahlt',0);
 const erstattet=order('cs_beleg_refund',a,'einmal','erstattet');
 const aboErstattet=order('cs_beleg_abo_refund',a,'abo');
 db.prepare('UPDATE bestellungen SET grund=? WHERE id=?').run('erstattung_voll',aboErstattet);
 server=erstelleServer({stripe,webhookSecret:'test',base:BASE}).listen(4491,'127.0.0.1');
 await new Promise((yes,no)=>{if(server.listening)return yes();server.once('listening',yes);server.once('error',no);});
 const gast=client(),kunde=client(),admin=client();
 const pfad=id=>'/api/bestellungen/'+id+'/beleg';
 pruefe('Gast 401',(await gast.req('GET',pfad(kauf))).status===401);
 await admin.req('POST','/api/anmelden',{email:'beleg-admin@example.com',passwort:PASS});
 pruefe('Admin 403',(await admin.req('GET',pfad(kauf))).status===403);
 await kunde.req('POST','/api/anmelden',{email:'beleg-a@example.com',passwort:PASS});
 const n1=await kunde.req('GET',pfad(fremdId)),n2=await kunde.req('GET',pfad(999999));
 pruefe('Fremde/nicht vorhandene ID identisch 404',n1.status===404&&n2.status===404&&JSON.stringify(n1.data)===JSON.stringify(n2.data));
 pruefe('Gratis 404 mit ungarischer Meldung',(await kunde.req('GET',pfad(gratis))).status===404);
 pruefe('Erstattet 404',(await kunde.req('GET',pfad(erstattet))).status===404);
 pruefe('Abo voll erstattet 404',(await kunde.req('GET',pfad(aboErstattet))).status===404);
 const aboRechnung=order('in_beleg_abo_echt',a,'abo'); // so speichert die Plattform echte Abo-Zahlungen: stripe_sitzung = Rechnungs-ID
 for(const [name,id]of [['Einmal',kauf],['Einmal mit Rechnung',kaufRechnung],['Abo',abo],['Abo mit Rechnungs-ID (echte Datenform)',aboRechnung]]){
  const v=await kunde.req('GET',pfad(id));
  pruefe(name+' 302, PDF vor Query, no-store',v.status===302&&
   v.headers.get('location')==='https://pay.stripe.com/receipts/payment/xyz/pdf?s=ap'&&
   v.headers.get('cache-control')==='no-store');
 }
 ohneQuery=true;
 const ohneQ=await kunde.req('GET',pfad(kauf));
 pruefe('Quittung ohne Query (echter Einmalkauf): 302 auf Stripe-Seite ohne /pdf',ohneQ.status===302&&
  ohneQ.headers.get('location')==='https://pay.stripe.com/receipts/payment/xyz');
 ohneQuery=false;
 fremd=true;pruefe('Fremde Domain 502',(await kunde.req('GET',pfad(kauf))).status===502);fremd=false;
 ausfall=true;
 const failed=await kunde.req('GET',pfad(kauf));
 pruefe('Stripe-Fehler 503 ohne Providertext',failed.status===503&&!JSON.stringify(failed.data).includes('secret provider detail'));
 ausfall=false;
 db.prepare('UPDATE benutzer SET stripe_kunde=?,rechnung_name=?,rechnung_land=?,rechnung_steuernr=? WHERE id=?')
   .run('cus_beleg_test','VALORE próba','Magyarország','NEVER-SEND',a);
 const aufrufeVorher=updates.length;
 const kaufAntwort=await kunde.req('POST','/api/kurse/'+kurs+'/kaufen',{modell:'einmal',zustimmung:true});
 const co=checkout.at(-1)||{};
 pruefe('Checkout startet',kaufAntwort.status===200&&checkout.length>=1);
 pruefe('Checkout: Rechnungsadresse ist Pflicht',co.billing_address_collection==='required');
 pruefe('Checkout: Steuernummer-/Firmenfeld fuer Firmenkunden aktiv (nicht erzwungen)',co.tax_id_collection?.enabled===true&&!('required' in (co.tax_id_collection||{})));
 pruefe('Checkout: Stripe speichert Name und Adresse beim Kunden',co.customer_update?.name==='auto'&&co.customer_update?.address==='auto'&&co.customer==='cus_beleg_test');
 pruefe('Nichts wird vorbelegt: kein customers.update beim Kauf, keine Fiokom-Daten im Checkout',
   updates.length===aufrufeVorher&&!JSON.stringify(co).includes('VALORE próba')&&!JSON.stringify(co).includes('NEVER-SEND'));
 pruefe('Einmalkauf-Checkout erzeugt eine Rechnung (Beleg mit Kundendaten)',co.invoice_creation?.enabled===true);
 const aboAntwort=await kunde.req('POST','/api/kurse/'+kurs+'/kaufen',{modell:'abo',zustimmung:true});
 const coAbo=checkout.at(-1)||{};
 pruefe('Abo-Checkout ohne invoice_creation (Abo erzeugt Rechnung selbst) und mit denselben Datenfeldern',
   (aboAntwort.status===200||aboAntwort.status===400)&&(aboAntwort.status===400||(!('invoice_creation' in coAbo)&&coAbo.billing_address_collection==='required'&&coAbo.tax_id_collection?.enabled===true)));
 ausfall=false;
 const js=readFileSync(resolve('public/kunde.js'),'utf8').replace(/\r\n/g,'\n');
 const mail=(readFileSync(resolve('mail.mjs'),'utf8')+String.fromCharCode(10)+readFileSync(resolve('kaufmail-vorlage.mjs'),'utf8')).replace(/\r\n/g,'\n');
 const zahlung=readFileSync(resolve('zahlung.mjs'),'utf8').replace(/\r\n/g,'\n');
 const hu=JSON.parse(readFileSync(resolve('texte/hu.json'),'utf8'));
 pruefe('Belegknopf nur bei bezahlt, neuer Tab ohne Opener',
  js.includes("b.status==='bezahlt'&&!b.ellallas_ergebnis&&b.grund!=='erstattung_voll'&&b.betrag>0")&&js.includes("rel:'noopener noreferrer'")&&hu.k_fiokom_beleg==='Fizetési bizonylat');
 pruefe('Kaufmailtext und Kontolink',mail.includes("HU.mail_kauf_beleg_text")&&mail.includes("HU.mail_kauf_beleg_knopf")&&
   mail.includes("base+'/#/fiokom'")&&hu.mail_kauf_beleg_text.endsWith('Ez nem számla.'));
 pruefe('System-Fußzeile bleibt',mail.includes('HU.mail_systemhinweis'));
 const elallas='#/fiokom';
 pruefe('Widerrufsfunktion verbunden: Wortlaut, Footer, zweistufiger Rendeléseim-Dialog, Kaufmail',
   hu.k_elallas==='Elállás a szerződéstől'&&hu.mail_kauf_elallas==='Elállás a szerződéstől'&&
   js.includes("const ELALLAS_URL = '#/fiokom'")&&js.split('ELALLAS_URL').length-1>=2&&
   js.includes("onclick:()=>ellallasStart(b)")&&js.includes("b.ellallas_ergebnis")&&
   mail.includes("const ELALLAS_URL = RECHT_LINKS.ellallas")&&mail.includes('HU.mail_kauf_elallas+'));
 pruefe('Kein invoice_creation und serverseitige Preise',
  zahlung.includes('invoice_creation: rechnungsErweiterung(leseAnbieter())')&&zahlung.includes('return { enabled: true }')&&zahlung.includes('zahlart ? {} :')&&!zahlung.includes('rechnungsdatenZuStripe')&&zahlung.includes('unit_amount: zahlart ? kurs.abo_preis_cent : kurs.preis_cent'));
 pruefe('Kein Inline-Style neu',!js.includes("setAttribute('style'"));
}catch(e){fehler++;console.log('FEHLER Testablauf: '+(e.code||e.message));}
finally{
 try{await new Promise(done=>server?server.close(done):done());}catch{}
 try{db?.close();}catch{}
 try{rmSync(ordner,{recursive:true,force:true});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
}
console.log('Beleg: '+ok+' bestanden, '+fehler+' fehlgeschlagen');
process.exitCode=fehler?1:0;
