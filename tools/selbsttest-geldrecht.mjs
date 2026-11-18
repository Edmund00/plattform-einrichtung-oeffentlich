// Selbsttest Gesamtpruefung Block 2 (Geld und Recht), 12.11.2026. Nur Mock-Stripe, Temp-DB, Port 4480.
// Deckt ab: F-04 (Lektionstext = erster Zugriff), F-05 (Doppelkauf/Doppel-Abo vor dem Webhook), Abo-Zustimmung, A1-03 (Erstattungsliste scheitert),
// A2-01 (Abo-Intervall), A2-03 (Cent in Ereignissen/Meldungen).
import './test-sprache.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
const dir=mkdtempSync(join(tmpdir(),'schulung-geldrecht-'));
process.env.DB_DATEI=join(dir,'test.db');
let ok=0,fail=0,db,server;
const check=(name,x,info='')=>{if(x)ok++;else fail++;console.log((x?'OK ':'FEHLER ')+name+(x||!info?'':' | '+String(info).slice(0,300)))};
const PORT=4480,BASE='http://127.0.0.1:'+PORT,password=randomBytes(24).toString('hex');

// ---- Mock-Stripe ---------------------------------------------------------------------------------
const sitzungen=[],erstellt=[],abgelaufen=[],refundsCreate=[],mails=[];
const piStatus={},subStatus={},refundsJePi={},invoiceAbo={};
let kundenNr=0,listeFehler=false,refundListeFehler=false;
const stripe={
 customers:{create:async()=>({id:'cus_gr_'+(++kundenNr)}),update:async()=>({})},
 checkout:{sessions:{
  create:async x=>{const s={id:'cs_gr_'+(sitzungen.length+1),url:'https://checkout.stripe.com/gr/'+(sitzungen.length+1),status:'open',mode:x.mode,customer:x.customer,
    metadata:{...x.metadata},amount_total:x.line_items[0].price_data.unit_amount,currency:x.line_items[0].price_data.currency,payment_status:'unpaid',
    expires_at:Math.floor(Date.now()/1000)+86400,interval:x.line_items[0].price_data.recurring?.interval};
   sitzungen.push(s);erstellt.push(s);return s;},
  list:async({customer,status})=>{if(listeFehler)throw Object.assign(new Error('netz'),{code:'api_connection_error'});return {data:sitzungen.filter(s=>s.customer===customer&&(!status||s.status===status)).slice().reverse(),has_more:false};},
  expire:async id=>{const s=sitzungen.find(x=>x.id===id);if(s)s.status='expired';abgelaufen.push(id);return s;},
  retrieve:async id=>sitzungen.find(x=>x.id===id)??{id}}},
 paymentIntents:{retrieve:async id=>({id,status:piStatus[id]??'succeeded'})},
 subscriptions:{retrieve:async id=>({id,status:subStatus[id]??'active',metadata:{}}),cancel:async id=>({id,status:'canceled'})},
 refunds:{list:async({payment_intent})=>{if(refundListeFehler)throw Object.assign(new Error('rate'),{code:'rate_limit'});return {data:refundsJePi[payment_intent]??[],has_more:false};},
  create:async(data,opts)=>{refundsCreate.push({data,opts});return {id:'re_gr_'+refundsCreate.length,status:'succeeded'};}},
 invoices:{retrieve:async id=>({id,payment_intent:'pi_'+id,billing_reason:'subscription_create',parent:{subscription_details:{subscription:invoiceAbo[id]}}}),list:async()=>({data:[],has_more:false})},
 invoicePayments:{list:async()=>({data:[]})},
 billingPortal:{sessions:{create:async()=>({url:'https://billing.stripe.com/gr'})}},
 webhooks:{constructEvent:raw=>JSON.parse(Buffer.isBuffer(raw)?raw.toString('utf8'):String(raw))}};

function client(){let cookie='';return {async req(method,path,body){
 const headers={};if(cookie)headers.Cookie=cookie;if(body!==undefined)headers['Content-Type']='application/json';
 const r=await fetch(BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];
 let j=null;try{j=await r.json();}catch{}
 return {s:r.status,b:j};
}}}
let evtNr=0;
const webhook=async(type,object,created=Math.floor(Date.now()/1000))=>{
 const r=await fetch(BASE+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':'mock'},body:JSON.stringify({id:'evt_gr_'+(++evtNr),type,created,livemode:false,data:{object}})});
 await new Promise(r=>setTimeout(r,20));
 return r.status;
};
const warte=async(bed,ms=2000)=>{for(let i=0;i<ms/20&&!bed();i++)await new Promise(r=>setTimeout(r,20));return bed();};

try{
 ({db}=await import('../db.mjs'));
 const {passwortHashen}=await import('../auth.mjs'),{erstelleServer}=await import('../app.mjs');
 const ph=await passwortHashen(password),stamp=new Date().toISOString();
 const nutzer=email=>Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,'kunde',?,?)").run(email,ph,stamp,Date.now()).lastInsertRowid);
 db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES('gr-admin@example.com',?,'admin',?,?)").run(ph,stamp,Date.now());
 const kurs=(titel,preis,waehrung='huf',abo=null,intervall=null)=>Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,abo_preis_cent,abo_intervall,status,erstellt,geaendert) VALUES(?,'',?,?,?,?,'veroeffentlicht',?,?)").run(titel,preis,waehrung,abo,intervall,stamp,stamp).lastInsertRowid);
 const lektion=(k,inhalt,art='text')=>db.prepare("INSERT INTO lektionen(kurs_id,titel,art,inhalt,status,erstellt,geaendert) VALUES(?,'Lecke',?,?,'veroeffentlicht',?,?)").run(k,art,inhalt,stamp,stamp);
 const K1=kurs('Geld Kurs 1',990000,'huf',990000,'month'), K2=kurs('Geld Kurs 2 Text',990000), K3=kurs('Geld Kurs EUR',1999,'eur'), K4=kurs('Geld Kurs Jahr',990000,'huf',990000,'year');
 const L1=Number(lektion(K1,'Lektionstext Kurs 1').lastInsertRowid), L2=Number(lektion(K2,'Lektionstext Kurs 2').lastInsertRowid); lektion(K2,'','video');
 server=erstelleServer({stripe,base:BASE,webhookSecret:'test',mailer:async m=>{mails.push(m);return true;},verkaufsmeldungMail:'inhaber@example.com',dateiOrdner:join(dir,'dateien'),ellallasWiederaufnahme:false,abgleichAutomatik:false}).listen(PORT,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const anmelden=async email=>{const c=client();await c.req('POST','/api/anmelden',{email,passwort:password});return c;};
 const kunde=uid=>db.prepare('SELECT stripe_kunde FROM benutzer WHERE id=?').get(uid).stripe_kunde;
 const bestellung=sid=>db.prepare('SELECT id,status,grund,art FROM bestellungen WHERE stripe_sitzung=?').get(sid);
 const zugang=(uid,k)=>db.prepare('SELECT quelle,gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=?').get(uid,k);
 const bezahlt=(s,extra={})=>({id:s.id,object:'checkout.session',mode:s.mode,status:'complete',payment_status:'paid',customer:s.customer,metadata:s.metadata,amount_total:s.amount_total,currency:s.currency,payment_intent:'pi_'+s.id,...extra});
 const kaufen=async(c,k,body={zustimmung:true})=>c.req('POST','/api/kurse/'+k+'/kaufen',body);
 const rechnung=(id,sub,uid,k,betrag=990000,meta={})=>({id,object:'invoice',status:'paid',customer:kunde(uid),currency:'huf',amount_paid:betrag,billing_reason:'subscription_create',
   parent:{subscription_details:{subscription:sub,metadata:{kurs_id:String(k),benutzer_id:String(uid),modell:'abo',...meta}}},lines:{data:[{period:{end:Math.floor(Date.now()/1000)+30*86400}}]}});
 const aboKaufen=async(uid,c,k,sub,inv,meta={})=>{                 // Kauf ueber die App + Checkout-Ereignis + bezahlte erste Rechnung
  const r=await kaufen(c,k,{modell:'abo',zustimmung:true});
  const s=sitzungen.find(x=>x.url===r.b?.url);
  if(s){s.status='complete';s.payment_status='paid';s.subscription=sub;}
  invoiceAbo[inv]=sub;
  await webhook('checkout.session.completed',{id:s?.id,object:'checkout.session',mode:'subscription',status:'complete',payment_status:'paid',subscription:sub,customer:kunde(uid),metadata:s?.metadata});
  await webhook('invoice.paid',rechnung(inv,sub,uid,k,990000,{abo_intervall:s?.metadata?.abo_intervall,...meta}));
  return {r,s};
 };

 // ---- (1) F-04: Lektionstext zaehlt als erster Zugriff -------------------------------------------
 {
  const a=nutzer('gr-f04-a@example.com'),b=nutzer('gr-f04-b@example.com');
  const ca=await anmelden('gr-f04-a@example.com'),cb=await anmelden('gr-f04-b@example.com');
  const ra=await kaufen(ca,K2),rb=await kaufen(cb,K2);
  const sa=sitzungen.find(x=>x.url===ra.b?.url),sb=sitzungen.find(x=>x.url===rb.b?.url);
  check('F-04 Vorbedingung: Kauf mit Zustimmung startet Checkout, Zustimmung gespeichert',ra.s===200&&!!db.prepare('SELECT 1 FROM kauf_zustimmung WHERE stripe_sitzung=?').get(sa?.id),JSON.stringify(ra));
  sa.status='complete';sb.status='complete';
  await webhook('checkout.session.completed',bezahlt(sa)); await webhook('checkout.session.completed',bezahlt(sb));
  check('F-04 Vorbedingung: beide Kaeufe bezahlt mit Zugang',bestellung(sa.id)?.status==='bezahlt'&&bestellung(sb.id)?.status==='bezahlt'&&!!zugang(a,K2)&&!!zugang(b,K2));
  const seite=await ca.req('GET','/api/kurse/'+K2);
  check('F-04 Nachbesserung: Kurs-/Verkaufsseite und Lektionsliste liefern keinen Lektionstext',seite.s===200&&seite.b?.zugang===true&&seite.b.lektionen.length===2&&seite.b.lektionen.every(l=>l.inhalt===undefined&&Array.isArray(l.dateien)),JSON.stringify(seite.b?.lektionen));
  check('F-04 Nachbesserung: Besuch der Kursseite speichert keinen ersten Zugriff',!db.prepare('SELECT 1 FROM erster_zugriff WHERE benutzer_id=? AND kurs_id=?').get(a,K2));
  check('F-04 Nachbesserung: ungueltiger Lektionsparameter 400',(await ca.req('GET','/api/kurse/'+K2+'?lektion=abc')).s===400);
  const kursA=await ca.req('GET','/api/kurse/'+K2+'?lektion='+L2);
  check('F-04: Lektionsseite bekommt den Text NUR dieser Lektion',kursA.s===200&&kursA.b?.lektionen?.filter(l=>l.inhalt!==undefined).length===1&&kursA.b.lektionen.find(l=>l.id===L2)?.inhalt==='Lektionstext Kurs 2',JSON.stringify(kursA.b?.lektionen));
  check('F-04: Oeffnen der Textlektion speichert den ersten Zugriff',!!db.prepare('SELECT 1 FROM erster_zugriff WHERE benutzer_id=? AND kurs_id=?').get(a,K2));
  const wa=await ca.req('POST','/api/bestellungen/'+bestellung(sa.id).id+'/ellallas',{bestaetigt:true});
  check('F-04: Widerruf nach Lesen des Textes abgelehnt (abgelehnt_zustimmung, keine Erstattung)',wa.s===409&&wa.b?.ergebnis==='abgelehnt_zustimmung'&&refundsCreate.length===0,JSON.stringify(wa));
  const wb=await cb.req('POST','/api/bestellungen/'+bestellung(sb.id).id+'/ellallas',{bestaetigt:true});
  check('F-04 Gegenfall: ohne Abruf bleibt der Widerruf erlaubt (Erstattung)',wb.s===200&&wb.b?.ergebnis==='erstattung'&&refundsCreate.length===1,JSON.stringify(wb));
  const adm=await anmelden('gr-admin@example.com');
  const vor=db.prepare('SELECT COUNT(*) n FROM erster_zugriff').get().n;
  await adm.req('GET','/api/kurse/'+K2);
  check('F-04: Admin-Abruf speichert keinen ersten Zugriff',db.prepare('SELECT COUNT(*) n FROM erster_zugriff').get().n===vor);
  const gast=client(); const g=await gast.req('GET','/api/kurse/'+K2);
  check('F-04: Gast ohne Zugang bekommt keinen Text, nichts gespeichert',g.s===200&&g.b?.lektionen?.every(l=>l.inhalt===undefined)&&db.prepare('SELECT COUNT(*) n FROM erster_zugriff').get().n===vor);
 }

 // ---- (2) F-05: bezahlte, noch nicht gebuchte Sitzung verhindert zweiten Checkout ----------------
 {
  const c=nutzer('gr-f05-c@example.com'),cc=await anmelden('gr-f05-c@example.com');
  const r1=await kaufen(cc,K1); const s1=sitzungen.find(x=>x.url===r1.b?.url);
  check('F-05 Vorbedingung: erster Checkout',r1.s===200&&!!s1);
  s1.status='complete';s1.payment_status='paid';         // bei Stripe bezahlt, Webhook noch nicht da
  const zahlVor=erstellt.length;
  const r2=await kaufen(cc,K1);
  check('F-05: zweiter Einmalkauf waehrend bezahlter, ungebuchter Sitzung -> 409 zahlung_wird_verarbeitet, keine neue Sitzung',r2.s===409&&r2.b?.fehler==='zahlung_wird_verarbeitet'&&erstellt.length===zahlVor,JSON.stringify(r2));
  check('F-05: Fehlertext vorhanden (kein roher Code)',typeof r2.b?.text==='string'&&r2.b.text!=='zahlung_wird_verarbeitet');
  const r2abo=await kaufen(cc,K1,{modell:'abo',zustimmung:true});
  check('F-05: auch ein Abo fuer denselben Kurs wird verhindert (409)',r2abo.s===409&&r2abo.b?.fehler==='zahlung_wird_verarbeitet'&&erstellt.length===zahlVor,JSON.stringify(r2abo));
  // Webhook kommt: Bestellung bezahlt; danach greift die normale Pruefung (Zugang vorhanden)
  await webhook('checkout.session.completed',bezahlt(s1));
  check('F-05: erste Zahlung gebucht (bezahlt, Zugang)',bestellung(s1.id)?.status==='bezahlt'&&zugang(c,K1)?.quelle==='zahlung');
  const r3=await kaufen(cc,K1);
  check('F-05: nach Buchung normale Antwort 409 zugang_vorhanden',r3.s===409&&r3.b?.fehler==='zugang_vorhanden');
  // Zweite Zahlung kommt trotzdem (z. B. zweiter Tab vor dem Fix): pruefen + Meldung statt still bezahlt
  const meldVor=db.prepare("SELECT COUNT(*) n FROM ereignisse WHERE typ='gekauft' AND status='pruefen'").get().n;
  const s2={...s1,id:'cs_gr_doppel_c',url:null};
  await webhook('checkout.session.completed',bezahlt(s2));
  const b2=bestellung('cs_gr_doppel_c');
  check('F-05: zweite Zahlung fuer besessenen Kurs -> Bestellung pruefen, Grund doppelt_bezahlt',b2?.status==='pruefen'&&b2?.grund==='doppelt_bezahlt',JSON.stringify(b2));
  check('F-05: Betreiber-Meldung fuer die Doppelzahlung angelegt',db.prepare("SELECT COUNT(*) n FROM ereignisse WHERE typ='gekauft' AND status='pruefen'").get().n===meldVor+1);
  check('F-05: Zugang bleibt unveraendert (aus der ersten Zahlung)',zugang(c,K1)?.quelle==='zahlung'&&bestellung(s1.id)?.status==='bezahlt');
  await webhook('checkout.session.async_payment_succeeded',bezahlt(s1));
  check('F-05: zweites Ereignis zur SELBEN Sitzung ist kein Doppel (bleibt bezahlt, keine Meldung)',bestellung(s1.id)?.status==='bezahlt'&&db.prepare("SELECT COUNT(*) n FROM ereignisse WHERE typ='gekauft' AND status='pruefen'").get().n===meldVor+1);
  await warte(()=>mails.some(m=>m.to==='inhaber@example.com'&&/ellenőr|pruef|prüf/i.test(m.subject+m.text)));
  check('F-05: Meldungsmail an die Inhaberin verschickt',mails.some(m=>m.to==='inhaber@example.com'),mails.map(m=>m.to+':'+m.subject).join(' | '));

  // SEPA: Sitzung complete, payment_status unpaid, Zahlung laeuft (processing) -> blockiert; gescheiterte Zahlung -> blockiert nicht
  const d=nutzer('gr-f05-d@example.com'),cd=await anmelden('gr-f05-d@example.com');
  const rd=await kaufen(cd,K1); const sd=sitzungen.find(x=>x.url===rd.b?.url);
  sd.status='complete';sd.payment_status='unpaid';sd.payment_intent='pi_sepa_d';piStatus.pi_sepa_d='processing';
  await webhook('checkout.session.completed',{...bezahlt(sd),payment_status:'unpaid',payment_intent:'pi_sepa_d'});
  check('F-05 SEPA Vorbedingung: unbezahltes Checkout-Ereignis bucht nichts',!bestellung(sd.id)&&!zugang(d,K1));
  const rd2=await kaufen(cd,K1);
  check('F-05 SEPA: laufende Lastschrift (processing) -> 409 zahlung_wird_verarbeitet',rd2.s===409&&rd2.b?.fehler==='zahlung_wird_verarbeitet',JSON.stringify(rd2));
  piStatus.pi_sepa_d='requires_payment_method';
  const rd3=await kaufen(cd,K1);
  check('F-05 SEPA: gescheiterte Lastschrift blockiert nicht (neuer Checkout)',rd3.s===200&&typeof rd3.b?.url==='string',JSON.stringify(rd3));
  // Stripe-Abfrage scheitert: Kauf laeuft weiter (wie bisher bei offenen Sitzungen), Doppel faengt der Webhook
  listeFehler=true; const rd4=await kaufen(cd,K1); listeFehler=false;
  check('F-05: Stripe-Liste nicht erreichbar -> Kauf blockiert nicht (200)',rd4.s===200,JSON.stringify(rd4));

  // Abo: bezahlte Abo-Sitzung ohne Abo-Zeile -> kein zweites Abo
  const e=nutzer('gr-f05-e@example.com'),ce=await anmelden('gr-f05-e@example.com');
  const re1=await kaufen(ce,K1,{modell:'abo',zustimmung:true}); const se1=sitzungen.find(x=>x.url===re1.b?.url);
  se1.status='complete';se1.payment_status='paid';se1.subscription='sub_gr_e1';
  const re2=await kaufen(ce,K1,{modell:'abo',zustimmung:true});
  check('F-05 Abo: bezahlte, ungebuchte Abo-Sitzung -> kein zweites Abo (409)',re2.s===409&&re2.b?.fehler==='zahlung_wird_verarbeitet',JSON.stringify(re2));
  // SEPA-Abo: unpaid, Abo bei Stripe incomplete -> blockiert
  se1.payment_status='unpaid';subStatus.sub_gr_e1='incomplete';
  check('F-05 Abo: erste Abo-Zahlung laeuft noch (incomplete) -> 409',(await kaufen(ce,K1,{modell:'abo',zustimmung:true})).s===409);
  subStatus.sub_gr_e1='incomplete_expired';
  check('F-05 Abo: abgelaufene erste Zahlung (incomplete_expired) blockiert nicht',(await kaufen(ce,K1,{modell:'abo',zustimmung:true})).s===200);
  // Zwei Abos kommen trotzdem bei Stripe an: das zweite wird pruefen (doppelt_bezahlt) mit Meldung, Verlaengerung des ersten bleibt bezahlt
  const f=nutzer('gr-f05-f@example.com'),cf=await anmelden('gr-f05-f@example.com');
  await aboKaufen(f,cf,K1,'sub_gr_f1','in_gr_f1');
  check('F-05 Abo Vorbedingung: erstes Abo bezahlt und aktiv',bestellung('in_gr_f1')?.status==='bezahlt'&&db.prepare("SELECT status FROM abos WHERE stripe_abo='sub_gr_f1'").get()?.status==='aktiv'&&zugang(f,K1)?.quelle==='abo');
  const bisVor=zugang(f,K1)?.gueltig_bis, aboMeldVor=db.prepare("SELECT COUNT(*) n FROM ereignisse WHERE typ='abo_gestartet' AND status='pruefen'").get().n;
  await webhook('checkout.session.completed',{id:'cs_gr_f2',object:'checkout.session',mode:'subscription',status:'complete',payment_status:'paid',subscription:'sub_gr_f2',customer:kunde(f),metadata:{kurs_id:String(K1),benutzer_id:String(f),modell:'abo',abo_intervall:'month'}});
  await webhook('invoice.paid',rechnung('in_gr_f2','sub_gr_f2',f,K1,990000,{abo_intervall:'month'}));
  check('F-05 Abo: zweites Abo -> Rechnung pruefen, Grund doppelt_bezahlt',bestellung('in_gr_f2')?.status==='pruefen'&&bestellung('in_gr_f2')?.grund==='doppelt_bezahlt',JSON.stringify(bestellung('in_gr_f2')));
  check('F-05 Abo: Meldung an die Inhaberin, Zugang unveraendert',db.prepare("SELECT COUNT(*) n FROM ereignisse WHERE typ='abo_gestartet' AND status='pruefen'").get().n===aboMeldVor+1&&zugang(f,K1)?.gueltig_bis===bisVor);
  await webhook('invoice.paid',{...rechnung('in_gr_f1b','sub_gr_f1',f,K1,990000,{abo_intervall:'month'}),billing_reason:'subscription_cycle'});
  check('F-05 Abo: Verlaengerung des ersten (bezahlten) Abos bleibt bezahlt',bestellung('in_gr_f1b')?.status==='bezahlt',JSON.stringify(bestellung('in_gr_f1b')));
  await webhook('invoice.paid',{...rechnung('in_gr_f2b','sub_gr_f2',f,K1,990000,{abo_intervall:'month'}),billing_reason:'subscription_cycle'});
  check('F-05 Abo: Verlaengerung des doppelten Abos wird nicht still bezahlt (pruefen)',bestellung('in_gr_f2b')?.status==='pruefen'&&bestellung('in_gr_f2b')?.grund==='doppelt_bezahlt',JSON.stringify(bestellung('in_gr_f2b')));
  // Gegenfall: gekuendigtes UND abgelaufenes erstes Abo -> neues Abo ist KEIN Doppel. (Ein gekuendigtes Abo mit noch laufender Restzeit zaehlt dagegen als Besitz:
  // Angreifer-Fund P3, siehe selbsttest-aboschutz.mjs; die Kauf-Route lehnt dann einen neuen Kauf ohnehin mit 409 zugang_vorhanden ab.)
  const h=nutzer('gr-f05-h@example.com'),chh=await anmelden('gr-f05-h@example.com');
  await aboKaufen(h,chh,K1,'sub_gr_h1','in_gr_h1');
  db.prepare("UPDATE abos SET status='gekuendigt', gueltig_bis=? WHERE stripe_abo='sub_gr_h1'").run(Date.now()-1000);
  await webhook('checkout.session.completed',{id:'cs_gr_h2',object:'checkout.session',mode:'subscription',status:'complete',payment_status:'paid',subscription:'sub_gr_h2',customer:kunde(h),metadata:{kurs_id:String(K1),benutzer_id:String(h),modell:'abo',abo_intervall:'month'}});
  await webhook('invoice.paid',rechnung('in_gr_h2','sub_gr_h2',h,K1,990000,{abo_intervall:'month'}));
  check('F-05 Gegenfall: neues Abo nach Kuendigung UND Ablauf des alten ist bezahlt (kein Doppel)',bestellung('in_gr_h2')?.status==='bezahlt',JSON.stringify(bestellung('in_gr_h2')));
 }

 // ---- Nachbesserung: Rueckkauf nach Admin-Entzug ist kein Doppel --------------------------------------
 {
  const adm=await anmelden('gr-admin@example.com');
  const rr=nutzer('gr-rk-r@example.com'),cr=await anmelden('gr-rk-r@example.com');
  const k1=await kaufen(cr,K2); const s1=sitzungen.find(x=>x.url===k1.b?.url); s1.status='complete';
  await webhook('checkout.session.completed',bezahlt(s1));
  check('Rueckkauf Vorbedingung: erster Kauf bezahlt mit Zugang',bestellung(s1.id)?.status==='bezahlt'&&zugang(rr,K2)?.quelle==='zahlung');
  const ent=await adm.req('DELETE','/api/admin/kurse/'+K2+'/zugaenge/'+rr);
  check('Rueckkauf Vorbedingung: Admin entzieht den Zugang (alte Bestellung bleibt bezahlt)',ent.s===200&&!zugang(rr,K2)&&bestellung(s1.id)?.status==='bezahlt',JSON.stringify(ent));
  const k2=await kaufen(cr,K2); const s2=sitzungen.find(x=>x.url===k2.b?.url);
  check('Rueckkauf: Kauf-Route erlaubt neuen Checkout',k2.s===200&&!!s2,JSON.stringify(k2));
  s2.status='complete'; await webhook('checkout.session.completed',bezahlt(s2));
  check('Rueckkauf: neue Zahlung ist bezahlt (nicht doppelt_bezahlt) und der Zugang ist wieder da',bestellung(s2.id)?.status==='bezahlt'&&bestellung(s2.id)?.grund===null&&zugang(rr,K2)?.quelle==='zahlung',JSON.stringify(bestellung(s2.id)));
  // Abo: Entzug beendet das Abo; ein neues Abo ist normal bezahlt und haengt nicht in zahlung_offen
  const sa=nutzer('gr-rk-s@example.com'),cs=await anmelden('gr-rk-s@example.com');
  await aboKaufen(sa,cs,K1,'sub_gr_s1','in_gr_s1');
  check('Rueckkauf Abo Vorbedingung: erstes Abo bezahlt',bestellung('in_gr_s1')?.status==='bezahlt'&&!!zugang(sa,K1));
  check('Rueckkauf Abo Vorbedingung: Admin entzieht (Abo beendet)',(await adm.req('DELETE','/api/admin/kurse/'+K1+'/zugaenge/'+sa)).s===200&&db.prepare("SELECT status FROM abos WHERE stripe_abo='sub_gr_s1'").get()?.status==='beendet');
  await aboKaufen(sa,cs,K1,'sub_gr_s2','in_gr_s2');
  check('Rueckkauf Abo: neues Abo bezahlt, aktiv, Zugang wieder da',bestellung('in_gr_s2')?.status==='bezahlt'&&db.prepare("SELECT status FROM abos WHERE stripe_abo='sub_gr_s2'").get()?.status==='aktiv'&&zugang(sa,K1)?.quelle==='abo',JSON.stringify(bestellung('in_gr_s2')));
 }

 // ---- Nachbesserung: erster Zugriff gehoert zur Bestellung -----------------------------------------------
 {
  const tt=nutzer('gr-ez-t@example.com'),ct=await anmelden('gr-ez-t@example.com');
  db.prepare('INSERT INTO erster_zugriff(benutzer_id,kurs_id,erster_zugriff) VALUES(?,?,?)').run(tt,K2,'2026-01-01T00:00:00.000Z');   // Zugriff aus frueherem Besitz
  const k=await kaufen(ct,K2); const s=sitzungen.find(x=>x.url===k.b?.url); s.status='complete'; await webhook('checkout.session.completed',bezahlt(s));
  const w=await ct.req('POST','/api/bestellungen/'+bestellung(s.id).id+'/ellallas',{bestaetigt:true});
  check('Erster Zugriff: alter Zugriff aus frueherem Besitz zaehlt nicht fuer den neuen Kauf (Widerruf erlaubt)',w.s===200&&w.b?.ergebnis==='erstattung',JSON.stringify(w));
  const uu=nutzer('gr-ez-u@example.com'),cu=await anmelden('gr-ez-u@example.com');
  db.prepare('INSERT INTO erster_zugriff(benutzer_id,kurs_id,erster_zugriff) VALUES(?,?,?)').run(uu,K2,'2026-01-01T00:00:00.000Z');
  const ku=await kaufen(cu,K2); const su=sitzungen.find(x=>x.url===ku.b?.url); su.status='complete'; await webhook('checkout.session.completed',bezahlt(su));
  await cu.req('GET','/api/kurse/'+K2+'?lektion='+L2);
  check('Erster Zugriff: Oeffnen nach dem neuen Kauf ersetzt den alten Zeitpunkt',db.prepare('SELECT erster_zugriff FROM erster_zugriff WHERE benutzer_id=? AND kurs_id=?').get(uu,K2)?.erster_zugriff>'2026-11-01');
  const wu=await cu.req('POST','/api/bestellungen/'+bestellung(su.id).id+'/ellallas',{bestaetigt:true});
  check('Erster Zugriff: nach Oeffnen im neuen Besitz Widerruf abgelehnt (abgelehnt_zustimmung)',wu.s===409&&wu.b?.ergebnis==='abgelehnt_zustimmung',JSON.stringify(wu));
 }

 // ---- (3) Abo-Zustimmung ---------------------------------------------------------------------------
 {
  const g=nutzer('gr-z-g@example.com'),cg=await anmelden('gr-z-g@example.com');
  const ohne=await kaufen(cg,K1,{modell:'abo'});
  check('Abo-Zustimmung: Abo-Kauf ohne Zustimmung 400 ellallas_zustimmung_pflicht',ohne.s===400&&ohne.b?.fehler==='ellallas_zustimmung_pflicht',JSON.stringify(ohne));
  const {s:sg}=await aboKaufen(g,cg,K1,'sub_gr_g1','in_gr_g1');
  const zg=db.prepare('SELECT text_version,stripe_sitzung FROM kauf_zustimmung WHERE stripe_sitzung=?').get(sg?.id);
  check('Abo-Zustimmung: mit Zustimmung gespeichert (Version, Checkout-Sitzung)',zg?.text_version==='v1'&&zg.stripe_sitzung===sg.id&&db.prepare("SELECT stripe_sitzung FROM abos WHERE stripe_abo='sub_gr_g1'").get()?.stripe_sitzung===sg.id);
  check('Abo-Zustimmung Vorbedingung: erste Abo-Rechnung bezahlt',bestellung('in_gr_g1')?.status==='bezahlt');
  await cg.req('GET','/api/kurse/'+K1+'?lektion='+L1);
  const wg=await cg.req('POST','/api/bestellungen/'+bestellung('in_gr_g1').id+'/ellallas',{bestaetigt:true});
  check('Abo-Zustimmung: Widerruf nach Zustimmung UND Oeffnen -> abgelehnt_zustimmung, keine Erstattung',wg.s===409&&wg.b?.ergebnis==='abgelehnt_zustimmung',JSON.stringify(wg));
  const i=nutzer('gr-z-i@example.com'),ci=await anmelden('gr-z-i@example.com');
  await aboKaufen(i,ci,K1,'sub_gr_i1','in_gr_i1');
  const refVor=refundsCreate.length;
  const wi=await ci.req('POST','/api/bestellungen/'+bestellung('in_gr_i1').id+'/ellallas',{bestaetigt:true});
  check('Abo-Zustimmung Gegenfall: Zustimmung, aber nicht geoeffnet -> Widerruf erlaubt (Erstattung)',wi.s===200&&wi.b?.ergebnis==='erstattung'&&refundsCreate.length===refVor+1,JSON.stringify(wi));
  const {entscheidung}=await import('../erstattung-regeln.mjs');
  const best={art:'abo',erstellt:new Date().toISOString()};
  check('Abo-Regel: erste Zahlung + Zustimmung + Zugriff -> abgelehnt_zustimmung',entscheidung({bestellung:best,zustimmung:true,ersterZugriff:true,ersteAboZahlung:true})==='abgelehnt_zustimmung');
  check('Abo-Regel: erste Zahlung ohne Zugriff -> erlaubt; ohne Zustimmung trotz Zugriff -> erlaubt',entscheidung({bestellung:best,zustimmung:true,ersterZugriff:false,ersteAboZahlung:true})==='erlaubt'&&entscheidung({bestellung:best,zustimmung:false,ersterZugriff:true,ersteAboZahlung:true})==='erlaubt');
  check('Abo-Regel: spaetere Zahlung -> abgelehnt_frist (unveraendert)',entscheidung({bestellung:best,zustimmung:false,ersterZugriff:false,ersteAboZahlung:false})==='abgelehnt_frist');
 }

 // ---- (4) A1-03: Erstattungsliste scheitert -> kein Zugang, Stripe wiederholt -----------------------
 {
  const j=nutzer('gr-a103-j@example.com'),cj=await anmelden('gr-a103-j@example.com');
  const rj=await kaufen(cj,K2); const sj=sitzungen.find(x=>x.url===rj.b?.url); sj.status='complete';
  refundListeFehler=true;
  const code=await webhook('checkout.session.completed',bezahlt(sj));
  refundListeFehler=false;
  check('A1-03: refunds.list scheitert -> 500 (Stripe wiederholt), keine Bestellung, kein Zugang',code===500&&!bestellung(sj.id)&&!zugang(j,K2),'code='+code);
  refundsJePi['pi_'+sj.id]=[{id:'re_voll',status:'succeeded',amount:sj.amount_total}];
  const code2=await webhook('checkout.session.completed',bezahlt(sj));
  check('A1-03: Wiederholung mit voller Erstattung -> Bestellung erstattet, kein Zugang',code2===200&&bestellung(sj.id)?.status==='erstattet'&&!zugang(j,K2),'code='+code2+' '+JSON.stringify(bestellung(sj.id)));
 }

 // ---- (5) A2-01: Abo-Intervall ----------------------------------------------------------------------
 {
  const m=nutzer('gr-a201-m@example.com'),cm=await anmelden('gr-a201-m@example.com');
  const r1=await kaufen(cm,K4,{modell:'abo',zustimmung:true}); const s1=sitzungen.find(x=>x.url===r1.b?.url);
  check('A2-01: Abo-Sitzung traegt das Intervall in den Metadaten',s1?.metadata?.abo_intervall==='year'&&s1.interval==='year');
  const r1b=await kaufen(cm,K4,{modell:'abo',zustimmung:true});
  check('A2-01 Vorbedingung: gleiche offene Sitzung wird wiederverwendet',r1b.s===200&&r1b.b?.url===s1.url);
  db.prepare("UPDATE kurse SET abo_intervall='month' WHERE id=?").run(K4);
  const r2=await kaufen(cm,K4,{modell:'abo',zustimmung:true});
  check('A2-01: nach Intervallaenderung keine Wiederverwendung (neue Sitzung, alte abgelaufen)',r2.s===200&&r2.b?.url!==s1.url&&abgelaufen.includes(s1.id)&&sitzungen.find(x=>x.url===r2.b?.url)?.metadata?.abo_intervall==='month',JSON.stringify(r2));
  // Rechnung zum alten Intervall (Jahr) bei Kurs jetzt Monat -> pruefen
  db.prepare("UPDATE benutzer SET stripe_kunde=? WHERE id=?").run(kunde(m),m);
  await webhook('checkout.session.completed',{id:s1.id,object:'checkout.session',mode:'subscription',status:'complete',payment_status:'paid',subscription:'sub_gr_m1',customer:kunde(m),metadata:s1.metadata});
  await webhook('invoice.paid',rechnung('in_gr_m1','sub_gr_m1',m,K4,990000,{abo_intervall:'year'}));
  check('A2-01: Rechnung mit abweichendem Intervall -> pruefen (Grund abo_intervall), kein Zugang',bestellung('in_gr_m1')?.status==='pruefen'&&bestellung('in_gr_m1')?.grund==='abo_intervall'&&!zugang(m,K4),JSON.stringify(bestellung('in_gr_m1')));
  const n=nutzer('gr-a201-n@example.com'),cn=await anmelden('gr-a201-n@example.com');
  await kaufen(cn,K3);   // nur damit ein Stripe-Kunde entsteht
  await webhook('invoice.paid',rechnung('in_gr_n1','sub_gr_n1',n,K4,990000,{abo_intervall:'month'}));
  check('A2-01 Gegenfall: passendes Intervall -> bezahlt',bestellung('in_gr_n1')?.status==='bezahlt',JSON.stringify(bestellung('in_gr_n1')));
  const o=nutzer('gr-a201-o@example.com'),co=await anmelden('gr-a201-o@example.com');
  await kaufen(co,K3);
  const ohneMeta=rechnung('in_gr_o1','sub_gr_o1',o,K4); ohneMeta.lines.data[0].price={recurring:{interval:'year'}};
  await webhook('invoice.paid',ohneMeta);
  check('A2-01: Intervall nur am Rechnungspreis (aeltere API) -> ebenfalls erkannt (pruefen)',bestellung('in_gr_o1')?.status==='pruefen'&&bestellung('in_gr_o1')?.grund==='abo_intervall',JSON.stringify(bestellung('in_gr_o1')));
  const p=nutzer('gr-a201-p@example.com'),cp=await anmelden('gr-a201-p@example.com');
  await kaufen(cp,K3);
  await webhook('invoice.paid',rechnung('in_gr_p1','sub_gr_p1',p,K4));
  check('A2-01: Rechnung ohne jede Intervallangabe (Alt-Abo) wird nicht abgewiesen',bestellung('in_gr_p1')?.status==='bezahlt',JSON.stringify(bestellung('in_gr_p1')));
 }

 // ---- (6) A2-03: Cent in Ereignissen und Meldungen ----------------------------------------------------
 {
  const {ganzeEinheiten}=await import('../ereignis-liste.mjs');
  check('A2-03: ganzeEinheiten rundet nicht (1999 -> 19.99, 990000 -> 9900, 0 -> 0)',ganzeEinheiten(1999)===19.99&&ganzeEinheiten(990000)===9900&&ganzeEinheiten(0)===0&&ganzeEinheiten(-1)===null);
  const q=nutzer('gr-a203-q@example.com'),cq=await anmelden('gr-a203-q@example.com');
  const rq=await kaufen(cq,K3); const sq=sitzungen.find(x=>x.url===rq.b?.url); sq.status='complete';
  await webhook('checkout.session.completed',bezahlt(sq));
  const ev=db.prepare("SELECT betrag,waehrung FROM ereignisse WHERE typ='gekauft' AND kurs_id=? AND status='bezahlt'").get(K3);
  check('A2-03: EUR-Kauf 19,99 -> Ereignis-Betrag 19.99 (nicht 20)',ev?.betrag===19.99&&ev.waehrung==='eur',JSON.stringify(ev));
  await warte(()=>mails.some(m=>m.to==='inhaber@example.com'&&String(m.text).includes('19,99')));
  check('A2-03: Meldungsmail an die Inhaberin zeigt 19,99 EUR',mails.some(m=>m.to==='inhaber@example.com'&&String(m.text).includes('19,99 EUR')),mails.filter(m=>m.to==='inhaber@example.com').map(m=>String(m.text).match(/.*EUR.*/)?.[0]).join(' | '));
  const adm=await anmelden('gr-admin@example.com');
  const liste=await adm.req('GET','/api/admin/ereignisse');
  const zeile=Array.isArray(liste.b?.adatok)?liste.b.adatok.find(e=>e.kurs==='Geld Kurs EUR'&&e.typ==='gekauft'):null;
  check('A2-03: Admin-Ereignisliste liefert 19.99',liste.s===200&&zeile?.betrag===19.99,liste.s+' '+JSON.stringify(liste.b).slice(0,300));
 }
}catch(e){fail++;console.log('FEHLER Testablauf '+(e.code||'')+' '+String(e.message).slice(0,200)+' '+String(e.stack).split('\n').find(l=>l.includes('selbsttest-geldrecht'))?.trim())}
finally{try{await new Promise(r=>server?server.close(r):r())}catch{}try{db?.close()}catch{}try{rmSync(dir,{recursive:true,force:true})}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e}}
console.log('Geldrecht: '+ok+' bestanden, '+fail+' fehlgeschlagen');process.exitCode=fail?1:0;
