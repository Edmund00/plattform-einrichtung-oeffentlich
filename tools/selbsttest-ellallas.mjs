import './test-sprache.mjs';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
const dir=mkdtempSync(join(tmpdir(),'schulung-ellallas-'));
process.env.DB_DATEI=join(dir,'test.db');
let ok=0,fail=0,db,server,refunds=[],cancels=[],mails=[];
const check=(name,x)=>{if(x)ok++;else fail++;console.log((x?'OK ':'FEHLER ')+name)};
const BASE='http://127.0.0.1:4499',password=randomBytes(24).toString('hex');

const pi_rest={};
let refundFehler=false,cancelFehler=false,refundHaengt=false;
const stripe={customers:{create:async()=>({id:'cus_ell_a'}),update:async()=>({})},
 checkout:{sessions:{create:async()=>({id:'cs_ell_new',url:'https://checkout.stripe.com/test'}),retrieve:async()=>({payment_intent:'pi_ell'})}},
 paymentIntents:{retrieve:async(id)=>({id,latest_charge:pi_rest[id]??undefined})},
 refunds:{create:async(data,opts)=>{refunds.push({data,opts});if(refundHaengt)return new Promise(()=>{});if(refundFehler)throw Error('SECRET_PROVIDER_ERROR');return {id:'re_ell'};}},
 subscriptions:{cancel:async id=>{cancels.push(id);if(cancelFehler)throw Error('stripe down');return {id}}},
 invoices:{retrieve:async id=>({id,payment_intent:'pi_abo',billing_reason:id==='in_abo_first'||id==='in_abo_c'||id==='in_abo_c2'||id==='in_abo_wd'?'subscription_create':'subscription_cycle',parent:{subscription_details:{subscription:id==='in_abo_c'?'sub_ell_c':id==='in_abo_c2'?'sub_ell_c2':id==='in_abo_wd'?'sub_ell_wd':'sub_ell_a'}}}),list:async()=>({data:[{id:'in_abo_later',status:'paid',amount_paid:990000,created:200},{id:'in_abo_first',status:'paid',amount_paid:990000,created:100}],has_more:false})},
 billingPortal:{sessions:{create:async()=>({url:'https://billing.stripe.com/test'})}},
 webhooks:{constructEvent:()=>({})}};
const mailer=async mail=>{mails.push(mail);return true};
function client(){let cookie='';return {async request(method,path,body){
 const headers={};if(cookie)headers.Cookie=cookie;if(body!==undefined)headers['Content-Type']='application/json';
 const r=await fetch(BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];
 return {status:r.status,headers:r.headers,body:await r.json()};
}}}
try{
 ({db}=await import('../db.mjs'));
 const {passwortHashen}=await import('../auth.mjs'),{erstelleServer}=await import('../app.mjs');
 const ph=await passwortHashen(password);
 const uid=(s,rolle='kunde')=>Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,?,?,?)").run(s,ph,rolle,new Date().toISOString(),Date.now()).lastInsertRowid);
 const a=uid('ell-a@example.com'),b=uid('ell-b@example.com'),admin=uid('ell-admin@example.com','admin');
 const k=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,'',990000,'huf','veroeffentlicht',?,?)").run('VALORE teszt',new Date().toISOString(),new Date().toISOString()).lastInsertRowid);
 const order=(id,u,{age=1,art='einmal'}={})=>Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES(?, ?, ?, ?, 990000, 'huf','bezahlt',?,?,?)")
 .run(id,'pi_'+id,u,k,art,new Date(Date.now()-age*86400000).toISOString(),new Date().toISOString()).lastInsertRowid);
 const clean=order('cs_ell_clean',a),other=order('cs_ell_other',b),expired=order('cs_ell_expired',a,{age:15}),withConsent=order('cs_ell_consent',a),access=order('cs_ell_access',a);
 const stamp=new Date().toISOString();
 db.prepare("INSERT INTO kauf_zustimmung(benutzer_id,kurs_id,text_version,zeit,stripe_sitzung) VALUES(?,?,?,?,?)").run(a,k,'v1',stamp,'cs_ell_consent');
 db.prepare("INSERT INTO kauf_zustimmung(benutzer_id,kurs_id,text_version,zeit,stripe_sitzung) VALUES(?,?,?,?,?)").run(a,k,'v1',stamp,'cs_ell_access');
 server=erstelleServer({stripe,base:BASE,webhookSecret:'test',mailer,verkaufsmeldungMail:'gabriella@example.com',dateiOrdner:join(dir,'dateien'),ellallasWiederaufnahme:false}).listen(4499,'127.0.0.1');
 await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 const guest=client(),user=client(),adm=client();
 const path=id=>'/api/bestellungen/'+id+'/ellallas';
 check('Gast 401',(await guest.request('POST',path(clean),{bestaetigt:true})).status===401);
 await adm.request('POST','/api/anmelden',{email:'ell-admin@example.com',passwort:password});
 check('Admin 403',(await adm.request('POST',path(clean),{bestaetigt:true})).status===403);
 await user.request('POST','/api/anmelden',{email:'ell-a@example.com',passwort:password});
 check('Fremd 404',(await user.request('POST',path(other),{bestaetigt:true})).status===404);
 check('Body 400',(await user.request('POST',path(clean),{bestaetigt:false})).status===400);
 const cleanResult=await user.request('POST',path(clean),{bestaetigt:true});
 check('Erlaubt 200 und no-store',cleanResult.status===200&&cleanResult.headers.get('cache-control')==='no-store');
 check('Erstattung mit vollem Betrag und Idempotenz',refunds.length===1&&refunds[0].data.amount===990000&&String(refunds[0].opts.idempotencyKey).startsWith('valore-ellallas-'+clean+'-'));
 check('Idempotenzschluessel enthaelt die Zahlung (pi_), damit Bestellnummern nach einem DB-Reset keinen Schluesselkonflikt erzeugen',/^valore-ellallas-\d+-pi_?\w+$/.test(String(refunds[0].opts.idempotencyKey))&&String(refunds[0].opts.idempotencyKey).length>'valore-ellallas-1-pi'.length);
 check('Doppel-POST keine zweite Erstattung',(await user.request('POST',path(clean),{bestaetigt:true})).status===200&&refunds.length===1);
 check('Abgelaufene Frist 409',(await user.request('POST',path(expired),{bestaetigt:true})).status===409);
 const consentResult=await user.request('POST',path(withConsent),{bestaetigt:true});
 check('Zustimmung ohne Zugriff erlaubt',consentResult.status===200);
 // Eigenständige Kurs-ID vermeidet gegenseitige Beeinflussung der Zugriffstests.
 const k2=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,'',990000,'huf','veroeffentlicht',?,?)").run('VALORE 2',stamp,stamp).lastInsertRowid);
 db.prepare("UPDATE bestellungen SET kurs_id=? WHERE id=?").run(k2,access);
 db.prepare("UPDATE kauf_zustimmung SET kurs_id=? WHERE stripe_sitzung=?").run(k2,'cs_ell_access');
 db.prepare("INSERT INTO erster_zugriff(benutzer_id,kurs_id,erster_zugriff) VALUES(?,?,?)").run(a,k2,stamp);
 const refused=await user.request('POST',path(access),{bestaetigt:true});
 check('Zustimmung und Zugriff 409, keine zusätzliche Erstattung',refused.status===409&&refunds.length===2);
 const noConsent=order('cs_ell_opened_without_consent',a);
 db.prepare('UPDATE bestellungen SET kurs_id=? WHERE id=?').run(k2,noConsent);
 check('Ohne Zustimmung trotz Zugriff erlaubt',(await user.request('POST',path(noConsent),{bestaetigt:true})).status===200);
 const {entscheidung}=await import('../erstattung-regeln.mjs');
 check('Zustimmung UND Zugriff verweigert',entscheidung({bestellung:{art:'einmal',erstellt:stamp},zustimmung:true,ersterZugriff:true})==='abgelehnt_zustimmung');
 const aboFirst=order('in_abo_first',a,{art:'abo'});
 db.prepare("INSERT INTO abos(stripe_abo,benutzer_id,kurs_id,status,erstellt,geaendert) VALUES(?,?,?,'aktiv',?,?)")
   .run('sub_ell_a',a,k,new Date().toISOString(),new Date().toISOString());
 check('Erste Abo-Zahlung erstattet und sofort gekündigt',
   (await user.request('POST',path(aboFirst),{bestaetigt:true})).status===200&&cancels.includes('sub_ell_a'));
 {
  // Widerruf: Erstattung klappt, das Beenden bei Stripe scheitert. Die Erstattung bleibt ein Erfolg, das Abo ist in der App trotzdem beendet (der Abgleich
  // beendet es bei Stripe nach, eine spaetere Rechnung gaebe sonst wieder Zugang), und Gabriella bekommt einen Hinweis.
  const d=uid('ell-widerruf-d@example.com'),stampD=new Date().toISOString(),bisD=Date.now()+30*86400000;
  const kd=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,'',990000,'huf','veroeffentlicht',?,?)").run('VALORE abo teszt D',stampD,stampD).lastInsertRowid);
  const od=Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES('in_abo_wd',NULL,?,?,990000,'huf','bezahlt','abo',?,?)").run(d,kd,stampD,stampD).lastInsertRowid);
  db.prepare("INSERT INTO abos(stripe_abo,benutzer_id,kurs_id,status,gueltig_bis,erstellt,geaendert) VALUES('sub_ell_wd',?,?,'aktiv',?,?,?)").run(d,kd,bisD,stampD,stampD);
  db.prepare("INSERT INTO zugaenge(benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES(?,?,'abo',?,?)").run(d,kd,stampD,bisD);
  const userD=client();await userD.request('POST','/api/anmelden',{email:'ell-widerruf-d@example.com',passwort:password});
  cancelFehler=true;
  const rd=await userD.request('POST',path(od),{bestaetigt:true});
  cancelFehler=false;
  check('Widerruf Abo bei Stripe-Fehler: 200, Erstattung bleibt Erfolg (ergebnis erstattung, Hinweis stripe_abo)',rd.status===200&&db.prepare('SELECT ergebnis,hinweis FROM ellallas WHERE bestellung_id=?').get(od)?.ergebnis==='erstattung'&&db.prepare('SELECT hinweis FROM ellallas WHERE bestellung_id=?').get(od)?.hinweis==='stripe_abo',JSON.stringify(db.prepare('SELECT ergebnis,hinweis FROM ellallas WHERE bestellung_id=?').get(od)));
  check('Widerruf Abo bei Stripe-Fehler: Bestellung erstattet, App-Abo trotzdem beendet, Zugang weg',db.prepare('SELECT status FROM bestellungen WHERE id=?').get(od)?.status==='erstattet'&&db.prepare("SELECT status FROM abos WHERE stripe_abo='sub_ell_wd'").get()?.status==='beendet'&&!db.prepare("SELECT 1 FROM zugaenge WHERE benutzer_id=? AND kurs_id=?").get(d,kd));
 }
 {
  // Eigener Benutzer und eigener Kurs: Abo-Elállás muss Bestellung und Abo-Zugang sofort erledigen, und das spätere
  // Stripe-Ereignis "Abo beendet" darf den erstatteten Zeitraum NICHT wieder freischalten.
  const c=uid('ell-c@example.com'),stampC=new Date().toISOString(),bis=Date.now()+30*86400000;
  const kc=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,'',990000,'huf','veroeffentlicht',?,?)").run('VALORE abo teszt',stampC,stampC).lastInsertRowid);
  const oc=Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES('in_abo_c',NULL,?,?,990000,'huf','bezahlt','abo',?,?)").run(c,kc,stampC,stampC).lastInsertRowid);
  db.prepare("INSERT INTO abos(stripe_abo,benutzer_id,kurs_id,status,gueltig_bis,erstellt,geaendert) VALUES('sub_ell_c',?,?,'aktiv',?,?,?)").run(c,kc,bis,stampC,stampC);
  db.prepare("INSERT INTO zugaenge(benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES(?,?,'abo',?,?)").run(c,kc,stampC,bis);
  check('Vorbedingung: Abo-Zugang des Testkunden besteht',!!db.prepare("SELECT 1 FROM zugaenge WHERE benutzer_id=? AND kurs_id=? AND quelle='abo'").get(c,kc));
  const userC=client();await userC.request('POST','/api/anmelden',{email:'ell-c@example.com',passwort:password});
  const rc=await userC.request('POST',path(oc),{bestaetigt:true});
  check('Abo-Elállás (eigener Kunde) 200 und Abo gekündigt',rc.status===200&&cancels.includes('sub_ell_c'));
  const nachher=db.prepare('SELECT status,grund FROM bestellungen WHERE id=?').get(oc);
  check('Abo-Elállás: Bestellung steht auf erstattet (erstattung_voll)',nachher.status==='erstattet'&&nachher.grund==='erstattung_voll');
  check('Abo-Elállás: Abo-Zugang ist sofort weg',!db.prepare("SELECT 1 FROM zugaenge WHERE benutzer_id=? AND kurs_id=? AND quelle='abo'").get(c,kc));
  const {aboVerarbeiten}=await import('../abo.mjs');
  aboVerarbeiten({id:'evt_ell_deleted_c',type:'customer.subscription.deleted',created:Math.floor(Date.now()/1000)+5,data:{object:{id:'sub_ell_c'}}});
  check('Abo beendet nach Elállás: Status beendet, aber KEIN neuer Zugang',
    db.prepare("SELECT status FROM abos WHERE stripe_abo='sub_ell_c'").get().status==='beendet'&&
    !db.prepare("SELECT 1 FROM zugaenge WHERE benutzer_id=? AND kurs_id=? AND quelle='abo'").get(c,kc));
  // M2: Neu-Abschluss nach erfolgtem Widerruf darf nicht erneut automatisch erstattet werden (sonst endlos kostenloser Zugang).
  const oc2=Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES('in_abo_c2','pi_c2',?,?,990000,'huf','bezahlt','abo',?,?)").run(c,kc,new Date().toISOString(),new Date().toISOString()).lastInsertRowid);
  db.prepare("INSERT INTO abos(stripe_abo,benutzer_id,kurs_id,status,gueltig_bis,erstellt,geaendert) VALUES('sub_ell_c2',?,?,'aktiv',?,?,?)").run(c,kc,bis,stampC,stampC);
  const refundsVor=refunds.length;
  await userC.request('POST',path(oc2),{bestaetigt:true});
  check('M2: zweiter Abo-Widerruf derselben Kundin für denselben Kurs wird nicht erstattet',
    refunds.length===refundsVor&&db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id=?').get(oc2)?.ergebnis==='abgelehnt_frist'&&
    db.prepare('SELECT status FROM bestellungen WHERE id=?').get(oc2).status==='bezahlt');
  // Gegenprobe: normale Kündigung ohne Erstattung behält den Zugang bis zum Periodenende.
  const d=uid('ell-d@example.com');
  db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES('in_abo_d',NULL,?,?,990000,'huf','bezahlt','abo',?,?)").run(d,kc,stampC,stampC);
  db.prepare("INSERT INTO abos(stripe_abo,benutzer_id,kurs_id,status,gueltig_bis,erstellt,geaendert) VALUES('sub_ell_d',?,?,'aktiv',?,?,?)").run(d,kc,bis,stampC,stampC);
  // Wie im echten Ablauf: die bezahlte Rechnung (invoice.paid) hat den Zugang schon angelegt (mit 2 Tagen Puffer); das Abo-Ende kürzt ihn auf das Periodenende.
  db.prepare("INSERT INTO zugaenge(benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES(?,?,'abo',?,?)").run(d,kc,stampC,bis+172800000);
  aboVerarbeiten({id:'evt_ell_deleted_d',type:'customer.subscription.deleted',created:Math.floor(Date.now()/1000)+6,data:{object:{id:'sub_ell_d'}}});
  check('Gegenprobe: normales Abo-Ende ohne Erstattung behält den Zugang bis zum Periodenende',
    db.prepare("SELECT gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=? AND quelle='abo'").get(d,kc)?.gueltig_bis===bis);
 }
 const aboLater=order('in_abo_later',a,{art:'abo'});
 check('Spätere Abo-Zahlung 409',(await user.request('POST',path(aboLater),{bestaetigt:true})).status===409);
 refundFehler=true;
 const broken=order('cs_ell_stripe_failure',a);
 const brokenResult=await user.request('POST',path(broken),{bestaetigt:true});
 check('Stripe-Fehler 503 ohne Providermeldung',brokenResult.status===503&&!JSON.stringify(brokenResult.body).includes('SECRET_PROVIDER_ERROR'));
 check('Fehlererklärung bleibt gespeichert',db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id=?').get(broken)?.ergebnis==='fehler');
 refundFehler=false;
 for(let i=0;i<70&&!mails.some(x=>x.subject?.startsWith('FIGYELEM'));i++)await new Promise(r=>setTimeout(r,10));
 check('Warn-Mail tatsächlich an Inhaberin zugestellt',mails.some(x=>x.to==='gabriella@example.com'&&x.subject?.startsWith('FIGYELEM')&&x.text.includes(String(broken))));
  {
   // Pruefrunde 3 (Agent H): hängender Widerruf nach Prozessabbruch
   const alt=order('cs_ell_haengend_alt',a),jung=order('cs_ell_haengend_jung',a);
   const frueh=new Date(Date.now()-3600000).toISOString(),jetzt=new Date().toISOString();
   db.prepare("INSERT INTO ellallas(bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES(?,?,'bearbeitung',NULL,?)").run(alt,frueh,frueh);
   db.prepare("INSERT INTO ellallas(bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES(?,?,'bearbeitung',NULL,?)").run(jung,jetzt,jetzt);
   const {haengendeEllallasRetten}=await import('../routes-ellallas.mjs');
   const n=haengendeEllallasRetten(600000);
   check('Haengender Widerruf (aelter als 10 Minuten) wird zu fehler mit Hinweis abbruch, junger bleibt in Bearbeitung',n===1&&db.prepare('SELECT ergebnis,hinweis FROM ellallas WHERE bestellung_id=?').get(alt)?.ergebnis==='fehler'&&db.prepare('SELECT hinweis FROM ellallas WHERE bestellung_id=?').get(alt)?.hinweis==='abbruch'&&db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id=?').get(jung)?.ergebnis==='bearbeitung');
   check('Fuer den haengenden Widerruf wird eine Warnmail an die Inhaberin vorgemerkt (genau einmal)',db.prepare("SELECT COUNT(*) n FROM ellallas_mail WHERE bestellung_id=? AND empfaenger='warnung'").get(alt).n===1&&haengendeEllallasRetten(600000)===0);
  }
  {
   // P0 Zahlungshaertung: Abbruch waehrend der Erstattung -> automatische Wiederaufnahme, genau EINE Erstattung (gleicher Idempotenzschluessel)
   const {haengendeEllallasWiederaufnehmen}=await import('../routes-ellallas.mjs');
   const p0=order('cs_ell_p0_haengend',a),p0jung=order('cs_ell_p0_jung',a),p0abo=order('in_ell_p0_abo',a,{art:'abo'});
   const frueh2=new Date(Date.now()-120000).toISOString(),jetzt2=new Date().toISOString();
   for(const [id,z] of [[p0,frueh2],[p0jung,jetzt2],[p0abo,frueh2]])db.prepare("INSERT INTO ellallas(bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES(?,?,'bearbeitung',NULL,?)").run(id,z,z);
   const vor=refunds.length;
   refundFehler=true;
   const n0=await haengendeEllallasWiederaufnehmen(stripe,null,60000);
   check('P0: Stripe faellt bei der Wiederaufnahme aus -> Widerruf bleibt in Bearbeitung (wird erneut versucht), nichts verloren',n0===0&&db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id=?').get(p0)?.ergebnis==='bearbeitung');
   refundFehler=false;
   db.prepare('UPDATE ellallas SET aktualisiert=? WHERE bestellung_id=?').run(frueh2,p0);
   const bz0=db.prepare('SELECT benutzer_id,kurs_id,status FROM bestellungen WHERE id=?').get(p0);
   const vor2=refunds.length;
   const n1=await haengendeEllallasWiederaufnehmen(stripe,null,60000);
   const mit=refunds.slice(vor2).filter(x=>String(x.opts.idempotencyKey).startsWith('valore-ellallas-'+p0+'-'));
   check('P0: haengender Einmalkauf-Widerruf wird automatisch erstattet (mit dem urspruenglichen Idempotenzschluessel)',n1===1&&mit.length===1&&db.prepare('SELECT ergebnis,hinweis FROM ellallas WHERE bestellung_id=?').get(p0)?.ergebnis==='erstattung');
   {const bz=db.prepare('SELECT status,grund FROM bestellungen WHERE id=?').get(p0);
    check('B3: nach der Wiederaufnahme ist die Bestellung ERSTATTET (auch ohne Webhook charge.refunded) '+JSON.stringify(bz),bz.status==='erstattet'&&bz.grund==='erstattung_voll');
    const u3=Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES('b3."+Date.now()+"@example.com','x','kunde',?,?)").run(new Date().toISOString(),Date.now()).lastInsertRowid);
    const p3=order('cs_ell_b3_allein',u3);db.prepare("INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt) VALUES (?,?,'zahlung',?)").run(u3,bz0.kurs_id,Date.now());
    db.prepare("INSERT INTO ellallas(bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES(?,?,'bearbeitung',NULL,?)").run(p3,frueh2,frueh2);
    await haengendeEllallasWiederaufnehmen(stripe,null,60000);
    const b3=db.prepare('SELECT status FROM bestellungen WHERE id=?').get(p3),z3=db.prepare("SELECT COUNT(*) c FROM zugaenge WHERE benutzer_id=? AND kurs_id=?").get(u3,bz0.kurs_id).c;
    check('B3: Einzelkauf ohne weitere Bestellung: nach Wiederaufnahme erstattet UND Zugang entzogen, ohne Webhook '+b3.status+' zugaenge='+z3,b3.status==='erstattet'&&z3===0);}
   check('P0: junger Widerruf (unter 60 s) und Abo-Widerruf werden NICHT angefasst',db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id=?').get(p0jung)?.ergebnis==='bearbeitung'&&db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id=?').get(p0abo)?.ergebnis==='bearbeitung');
   const n2=await haengendeEllallasWiederaufnehmen(stripe,null,60000);
   check('P0: zweiter Lauf erstattet nichts erneut (keine Doppelerstattung)',n2===0&&refunds.slice(vor2).filter(x=>String(x.opts.idempotencyKey).startsWith('valore-ellallas-'+p0+'-')).length===1);
   const [r1,r2]=await Promise.all([haengendeEllallasWiederaufnehmen(stripe,null,0),haengendeEllallasWiederaufnehmen(stripe,null,0)]);
   check('P0: zwei gleichzeitige Laeufe: der zweite startet nichts (Sperre), keine Doppelerstattung',r2===0&&refunds.slice(vor2).filter(x=>String(x.opts.idempotencyKey).startsWith('valore-ellallas-'+p0+'-')).length===1);
  }
  {
   // P1: Stripe antwortet nicht (Zeitueberschreitung) -> Kunde bekommt zeitnah eine Antwort, Zeile bleibt bearbeitung, spaeter automatische Klaerung
   (await import('../routes-ellallas.mjs')).erstattungZeitlimitSetzen(400);
   const th=order('cs_ell_p1_timeout',a);
   refundHaengt=true;
   const t0=Date.now();
   const rt=await user.request('POST',path(th),{bestaetigt:true});
   refundHaengt=false;
   check('P1: Stripe-Zeitueberschreitung -> Antwort 503 "wird bearbeitet" innerhalb weniger Sekunden, keine haengende Anfrage',rt.status===503&&rt.body?.ergebnis==='bearbeitung'&&Date.now()-t0<5000);
   check('P1: Zeile bleibt bearbeitung (nicht fehler), keine Warnmail, damit die Wiederaufnahme es klaert',db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id=?').get(th)?.ergebnis==='bearbeitung'&&db.prepare("SELECT COUNT(*) n FROM ellallas_mail WHERE bestellung_id=? AND empfaenger='warnung'").get(th).n===0);
   const {haengendeEllallasWiederaufnehmen:wa}=await import('../routes-ellallas.mjs');
   db.prepare('UPDATE ellallas SET aktualisiert=? WHERE bestellung_id=?').run(new Date(Date.now()-120000).toISOString(),th);
   const vorT=refunds.length;
   const nT=await wa(stripe,null,60000);
   check('P1: Wiederaufnahme klaert den Fall mit dem Originalschluessel (eine Erstattung, Ergebnis erstattung)',nT>=1&&refunds.slice(vorT).filter(x=>String(x.opts.idempotencyKey).startsWith('valore-ellallas-'+th+'-')).length===1&&db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id=?').get(th)?.ergebnis==='erstattung');
  }
  {
   // P1: Rate-Limit je Konto in der Datenbank (Neustart- und IP-fest)
   const ts=Date.now();
   const uid=db.prepare("SELECT id FROM benutzer WHERE email='ell-a@example.com'").get().id;
   for(let i=0;i<20;i++)db.prepare('INSERT INTO ellallas_versuch(benutzer_id,zeit) VALUES(?,?)').run(uid,ts-1000);
   const rl=order('cs_ell_p1_rate',a);
   const rr=await user.request('POST',path(rl),{bestaetigt:true});
   check('P1: Rate-Limit je Konto: nach 20 Versuchen in der Stunde 429 (Zaehler liegt in der Datenbank, ueberlebt Neustart)',rr.status===429&&!db.prepare('SELECT 1 FROM ellallas WHERE bestellung_id=?').get(rl));
   db.prepare('DELETE FROM ellallas_versuch WHERE benutzer_id=?').run(uid);
   const rr2=await user.request('POST',path(rl),{bestaetigt:true});
   check('P1: nach Ablauf/Loeschen der Zaehler geht der Widerruf wieder',rr2.status!==429);
  }
  {
   // P1 Teilerstattung: schon teilweise erstattet -> Widerruf erstattet nur den Restbetrag; schon voll erstattet -> kein zweiter Stripe-Aufruf
   const tp=order('cs_ell_p1_teil',a),vp=order('cs_ell_p1_voll',a);
   const zahl=id=>db.prepare('SELECT zahlung_id FROM bestellungen WHERE id=?').get(id).zahlung_id;
   pi_rest[zahl(tp)]={amount:990000,amount_refunded:400000}; pi_rest[zahl(vp)]={amount:990000,amount_refunded:990000};
   const v0=refunds.length;
   const rteil=await user.request('POST',path(tp),{bestaetigt:true});
   check('P1: Teilerstattung vorhanden (4000 von 9900) -> Widerruf erstattet nur den Restbetrag 5900, Erfolg',rteil.status===200&&refunds.length===v0+1&&refunds[v0].data.amount===590000);
   const rvoll=await user.request('POST',path(vp),{bestaetigt:true});
   check('P1: schon voll erstattet -> Widerruf erledigt ohne zweiten Stripe-Aufruf (keine Doppelerstattung)',rvoll.status===200&&refunds.length===v0+1);
  }
  check('Frist 14 Tage',entscheidung({bestellung:{art:'einmal',erstellt:new Date(Date.now()-15*86400000).toISOString()},zustimmung:false,ersterZugriff:false})==='abgelehnt_frist');
 for(let i=0;i<50&&mails.length<2;i++)await new Promise(r=>setTimeout(r,10));
 check('Kundenmail-Ausgang tatsächlich angelegt',db.prepare("SELECT COUNT(*) n FROM ellallas_mail WHERE bestellung_id=?").get(clean).n===2);
 check('Kunden- und Inhabermail vom Mock erhalten',mails.some(x=>x.to==='ell-a@example.com'&&x.subject==='Az elállási nyilatkozatod megérkezett')&&mails.some(x=>x.to==='gabriella@example.com'&&x.subject.startsWith('Elállás:')));
 check('Widerrufsmails neutral formuliert: keine Ich-Form der Kundin in der Inhaber-Mail',
  mails.filter(x=>x.to==='gabriella@example.com'&&x.subject.startsWith('Elállás:')).every(x=>!x.text.includes('Kijelentem')&&x.text.includes('Elállási nyilatkozat érkezett')));
 check('Budapest-Zeit und Systemhinweis wirklich in Mail',mails.some(x=>x.to==='ell-a@example.com'&&x.text.includes('A nyilatkozat beérkezésének időpontja:')&&x.text.includes('rendszerüzenet')));
 check('Widerruf dauerhaft gespeichert',db.prepare("SELECT ergebnis FROM ellallas WHERE bestellung_id=?").get(clean).ergebnis==='erstattung');
 const lektionId=Number(db.prepare("INSERT INTO lektionen(kurs_id,titel,art,status,erstellt,geaendert) VALUES(?,'Film','video','veroeffentlicht',?,?)").run(k2,stamp,stamp).lastInsertRowid);
 db.prepare("INSERT INTO dateien(lektion_id,name,art,pfad,groesse,erstellt,mime) VALUES(?,'Film','video',?,100,?,'video/mp4')").run(lektionId,randomBytes(16).toString('hex'),stamp);
 db.prepare("INSERT INTO zugaenge(benutzer_id,kurs_id,quelle,erstellt) VALUES(?,?,'einladung',?)").run(a,k2,stamp);
 const vorher= db.prepare('SELECT COUNT(*) AS n FROM erster_zugriff WHERE benutzer_id=? AND kurs_id=?').get(a,k2).n;
 // Für die Wiedergabeprüfung bewusst den bisherigen Eintrag entfernen: ein Testfall, keine Fremddaten.
 db.prepare('DELETE FROM erster_zugriff WHERE benutzer_id=? AND kurs_id=?').run(a,k2);
 const testKurs=await user.request('GET','/api/kurse/'+k2);
 check('Kurs-/Lektionsliste protokolliert keinen Erstzugriff',testKurs.status===200&&
    db.prepare('SELECT COUNT(*) n FROM erster_zugriff WHERE benutzer_id=? AND kurs_id=?').get(a,k2).n===0);
 const ticket=await user.request('POST','/api/lektionen/'+lektionId+'/wiedergabe',{});
 check('Berechtigtes Wiedergabe-Ticket',ticket.status===200);
 const ticket2=await user.request('POST','/api/lektionen/'+lektionId+'/wiedergabe',{});
 check('Erster Zugriff nur einmal',ticket2.status===200&&
    db.prepare('SELECT COUNT(*) n FROM erster_zugriff WHERE benutzer_id=? AND kurs_id=?').get(a,k2).n===1);
 const {erstenZugriffMerken}=await import('../erster-zugriff.mjs');
 let blockiert=false;try{erstenZugriffMerken({id:a,rolle:'kunde'},99999999);}catch{blockiert=true;}
 check('Fehler bei Protokollierung blockiert Wiedergabe nicht',!blockiert);
 check('Keine Admin-Protokollierung',(()=>{const n=db.prepare('SELECT COUNT(*) n FROM erster_zugriff').get().n;
    erstenZugriffMerken({id:admin,rolle:'admin'},k2);return db.prepare('SELECT COUNT(*) n FROM erster_zugriff').get().n===n;})());
 // Im echten Ablauf meldet Stripe nach der Kuendigung (Elállás) customer.subscription.deleted und das Abo steht auf 'beendet'; erst danach ist ein Neukauf erlaubt (Punkt 2).
 db.prepare("UPDATE abos SET status='beendet' WHERE stripe_abo='sub_ell_a'").run();
 const ohneZustimmung=await user.request('POST','/api/kurse/'+k+'/kaufen',{modell:'einmal'});
 check('Einmalkauf ohne Pflicht-Häkchen 400',ohneZustimmung.status===400);
 const mitZustimmung=await user.request('POST','/api/kurse/'+k+'/kaufen',{modell:'einmal',zustimmung:true});
 const zustimmung=db.prepare('SELECT text_version,zeit,stripe_sitzung FROM kauf_zustimmung WHERE stripe_sitzung=?').get('cs_ell_new');
 check('Einmalkauf mit Zustimmung 200 und persistente Zeit/Version/Sitzung',mitZustimmung.status===200&&zustimmung?.text_version==='v1'&&!!Date.parse(zustimmung.zeit)&&zustimmung.stripe_sitzung==='cs_ell_new');
 db.prepare("UPDATE kurse SET abo_preis_cent=990000,abo_intervall='month' WHERE id=?").run(k);
 check('Abo-Kauf ohne Zustimmung 400 (Gesamtpruefung: Zustimmung auch beim Abo Pflicht)',(await user.request('POST','/api/kurse/'+k+'/kaufen',{modell:'abo'})).status===400);
 check('Abo-Kauf mit Zustimmung 200',(await user.request('POST','/api/kurse/'+k+'/kaufen',{modell:'abo',zustimmung:true})).status===200);
 const neuerKauf=order('cs_ell_new',a);
 const {kaufVormerken,mailDienst}=await import('../mail.mjs');
 kaufVormerken(a,neuerKauf,'kauf');
 const mailTest=mailDienst({mailer,base:BASE});
 await mailTest.ausgangSenden();
 check('Kaufmail enthält exakten Zustimmungstext und Budapest-Zeit',mails.some(m=>m.to==='ell-a@example.com'&&m.text.includes('Kifejezetten kérem a szolgáltatás azonnali megkezdését')&&m.text.includes('A hozzájárulásod időpontja:')));
 await new Promise(r=>setTimeout(r,500));
 // Mail an die Inhaberin beim Widerruf: sie muss erkennen koennen, WER widerrufen hat.
 const inhaberMails=mails.filter(m=>m.to==='gabriella@example.com'&&String(m.subject).startsWith('Elállás:'));
 check('Widerruf-Inhabermail: es gibt Inhabermails (sonst waere die Pruefung leer)',inhaberMails.length>0);
 check('Widerruf-Inhabermail ist fuer die Inhaberin formuliert (keine Anrede der Kundin, kein Verweis auf den Kundendienst)',inhaberMails.every(m=>!/elállásodat|nyilatkozatod|hozzájárulásod|vedd fel a kapcsolatot|kérjük, vedd/i.test(m.text)),inhaberMails.map(m=>m.text.slice(0,400)).join(' ## '));
 check('Widerruf-Inhabermail nennt die E-Mail-Adresse der Kundin',inhaberMails.every(m=>/ell-[a-z0-9.+-]*@example.com/.test(m.text)),inhaberMails.map(m=>m.text.slice(0,200)).join(' ## '));
 const src=readFileSync(resolve('public/kunde.js'),'utf8').replace(/\r\n/g,'\n');
 const hu=JSON.parse(readFileSync(resolve('texte/hu.json'),'utf8'));
 check('Zwei Bestätigungsschritte und Pflicht-Häkchen',src.includes("type:'checkbox'")&&src.includes("'/ellallas'")&&hu.k_ellallas_megerosites==='Elállás megerősítése');
 check('Interner Widerrufslink (Konto) bleibt',src.includes("#/fiokom"));
}catch(e){fail++;console.log('FEHLER Testablauf '+(e.code||e.message)+(e.code?' '+String(e.message).slice(0,120)+' '+String(e.stack).split('\n').find(l=>l.includes('selbsttest-ellallas'))?.trim():''))}
finally{try{await new Promise(r=>server?server.close(r):r())}catch{}try{db?.close()}catch{}try{rmSync(dir,{recursive:true,force:true})}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e}}
console.log('Ellallas: '+ok+' bestanden, '+fail+' fehlgeschlagen');process.exitCode=fail?1:0;
