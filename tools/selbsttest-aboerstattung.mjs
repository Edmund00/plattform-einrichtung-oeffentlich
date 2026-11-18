// Scheibe 29 – isolierte Offline-Pruefungen mit eigener SQLite-Datenbank.
import './test-sprache.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const dir=mkdtempSync(join(tmpdir(),'schulung-aboerstattung-'));
process.env.DB_DATEI=join(dir,'test.db');
const base='http://127.0.0.1:4519';
let server,ok=0,fail=0;
const check=(name,result)=>{if(result)ok++;else fail++;console.log((result?'OK ':'FEHLER ')+name)};
try {
 const {db}=await import('../db.mjs');
 const {aboVerarbeiten}=await import('../abo.mjs');
 const {erstattungVerarbeiten}=await import('../zahlung.mjs');
 const {abgleichDienst}=await import('../abgleich.mjs');
 const {passwortHashen}=await import('../auth.mjs');
 const {erstelleServer}=await import('../app.mjs');
 const {mailDienst}=await import('../mail.mjs');
 const now=()=>new Date().toISOString();
 let seq=0;
 const future=Math.floor(Date.now()/1000)+32*86400;
 const testPass=randomBytes(24).toString('hex');
 const hash=await passwortHashen(testPass);
 function scene(){
   const n=++seq,stamp=now();
   const user=Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,stripe_kunde,erstellt,email_bestaetigt) VALUES(?,?,?,?,?)")
     .run('abo29-'+n+'@example.invalid',hash,'cus_abo29_'+n,stamp,Date.now()).lastInsertRowid);
   const course=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,abo_preis_cent,abo_intervall,erstellt,geaendert) VALUES(?,'',990000,'huf','veroeffentlicht',990000,'month',?,?)")
     .run('Tanfolyam '+n,stamp,stamp).lastInsertRowid);
   const sub='sub_abo29_'+n;
   return {n,user,course,sub,stamp};
 }
 let event=0;
 const perioden=new Map();
 function paid(s,inv,bis=future,pi='pi_abo29_'+inv){
   const o={id:inv,parent:{subscription_details:{subscription:s.sub,metadata:{benutzer_id:String(s.user),kurs_id:String(s.course)}}},
     customer:'cus_abo29_'+s.n,amount_paid:990000,currency:'huf',lines:{data:[{period:{end:bis}}]}};
   perioden.set(inv,bis*1000);
   aboVerarbeiten({id:'evt_abo29_'+(++event),type:'invoice.paid',created:Math.floor(Date.now()/1000),data:{object:o}},
     {rechnungZahlungId:pi});
   return {o,pi};
 }
 function refund(s,inv,pi,{full=true,id='re_abo29_'+(++event)}={}){
   const charge={id:'ch_abo29_'+s.n,payment_intent:pi,amount:990000,amount_refunded:full?990000:100000,refunded:full,
     refunds:{data:[{id,status:'succeeded',amount:full?990000:100000}]}};
   erstattungVerarbeiten({id:'evt_refund_abo29_'+(++event),type:'charge.refunded'},charge,{periodEnd:perioden.get(inv)});
   return {charge,id};
 }
 const order=inv=>db.prepare('SELECT * FROM bestellungen WHERE stripe_sitzung=?').get(inv);
 const access=s=>db.prepare("SELECT * FROM zugaenge WHERE benutzer_id=? AND kurs_id=? AND quelle='abo'").get(s.user,s.course);
 const s1=scene(),i1='in_abo29_'+s1.n;
 paid(s1,i1);
 check('Neue Rechnung: Zahlungs-ID gespeichert',order(i1)?.zahlung_id==='pi_abo29_'+i1);
 check('Neue Rechnung: Zugang bezahlt und gültig',order(i1)?.status==='bezahlt'&&!!access(s1));
 const s2=scene(),i2='in_abo29_'+s2.n;
 paid(s2,i2);
 refund(s2,i2,'pi_abo29_'+i2);
 check('Voll letzte Periode: erstattet und kein Zugang',order(i2)?.status==='erstattet'&&order(i2)?.grund==='erstattung_voll'&&!access(s2));
 const s3=scene(),old='in_abo29_old_'+s3.n,latest='in_abo29_new_'+s3.n;
 paid(s3,old,future-86400);
 paid(s3,latest,future+86400);
 refund(s3,old,'pi_abo29_'+old);
 check('Fruehere Periode: erstattet und neuer Zugang bleibt',order(old)?.status==='erstattet'&&!!access(s3));
 const s4=scene(),i4='in_abo29_'+s4.n;
 paid(s4,i4);
 refund(s4,i4,'pi_abo29_'+i4,{full:false});
 check('Teilerstattung: bezahlt und Zugang bleibt',order(i4)?.status==='bezahlt'&&order(i4)?.grund==='teilerstattung'&&!!access(s4));
 const s5=scene(),i5='in_abo29_'+s5.n;
 paid(s5,i5);
 const dup=refund(s5,i5,'pi_abo29_'+i5);
 const entriesBefore=db.prepare('SELECT COUNT(*) n FROM abo_erstattung_eintrag WHERE stripe_refund_id=?').get(dup.id).n;
 erstattungVerarbeiten({id:'evt_abo29_dup_new_event',type:'charge.refunded'},dup.charge);
 check('Doppeltes Refund: nur ein Eintrag',entriesBefore===1&&db.prepare('SELECT COUNT(*) n FROM abo_erstattung_eintrag WHERE stripe_refund_id=?').get(dup.id).n===1);
 check('Doppeltes Refund: nur eine Abo-Mail',db.prepare('SELECT COUNT(*) n FROM abo_erstattung_mail WHERE bestell_id=?').get(order(i5).id).n===1);
 check('Doppeltes Refund: nur ein Geschaeftsereignis',
   db.prepare("SELECT COUNT(*) n FROM ereignisse WHERE typ='erstattet' AND kurs_id=?").get(s5.course).n===1);
 // PUNKT 2 (Sicherheitspaket 1a): Wenn extra.refundsData die Gesamtsumme abdeckt, muss voll=true gelten,
 // auch wenn charge.amount_refunded im einzelnen Ereignis noch kleiner als charge.amount ist.
 {
   const sP2=scene(),iP2='in_abo29_p2_'+sP2.n,piP2='pi_abo29_'+iP2;
   paid(sP2,iP2);
   const ridP2a='re_p2a_'+sP2.n,ridP2b='re_p2b_'+sP2.n;
   const chargeP2={id:'ch_p2_'+sP2.n,payment_intent:piP2,amount:990000,amount_refunded:400000,refunded:false,
     refunds:{data:[{id:ridP2a,status:'succeeded',amount:400000}]}};
   const refundsDataP2=[{id:ridP2a,status:'succeeded',amount:400000},{id:ridP2b,status:'succeeded',amount:590000}];
   erstattungVerarbeiten({id:'evt_p2_partial_'+sP2.n,type:'charge.refunded'},chargeP2,
     {periodEnd:perioden.get(iP2),refundsData:refundsDataP2});
   check('PUNKT-2: refunds.list-Summe ergibt voll=true, Auftrag erstattet und Zugang entzogen',
     order(iP2)?.status==='erstattet'&&!access(sP2));
   const mailsP2=db.prepare('SELECT COUNT(*) n FROM abo_erstattung_mail WHERE bestell_id=?').get(order(iP2).id).n;
   erstattungVerarbeiten({id:'evt_p2_full_'+sP2.n,type:'charge.refunded'},
     {...chargeP2,amount_refunded:990000,refunded:true,refunds:{data:refundsDataP2}},
     {periodEnd:perioden.get(iP2),refundsData:refundsDataP2});
   check('PUNKT-2: Folge-Webhook idempotent, keine zweite Mail',
     order(iP2)?.status==='erstattet'&&
     db.prepare('SELECT COUNT(*) n FROM abo_erstattung_mail WHERE bestell_id=?').get(order(iP2).id).n===mailsP2);
 }
 const s6=scene(),i6='in_abo29_'+s6.n;
 paid(s6,i6);
 db.prepare('UPDATE bestellungen SET zahlung_id=NULL WHERE stripe_sitzung=?').run(i6);
 const refunds=new Map(),payments=new Map(),charges=new Map();
 let refundCreates=0,subscriptionCancels=0;
 const chargeOld={id:'ch_abo29_old',payment_intent:'pi_abo29_'+i6,amount:990000,amount_refunded:990000,refunded:true,
   refunds:{data:[{id:'re_abo29_old',status:'succeeded',amount:990000}]}};
 charges.set(chargeOld.id,chargeOld);
 refunds.set('re_abo29_old',{id:'re_abo29_old',status:'succeeded',charge:chargeOld.id,payment_intent:chargeOld.payment_intent,amount:990000,currency:'huf'});
 payments.set(chargeOld.payment_intent,i6);
 const stripe={
   webhooks:{constructEvent:bytes=>JSON.parse(bytes.toString())},
   invoicePayments:{list:async q=>{
     if(q.invoice)return {data:[{status:'paid',payment:{payment_intent:'pi_abo29_'+q.invoice}}],has_more:false};
     const inv=payments.get(q.payment?.payment_intent);
     return {data:inv?[{invoice:inv,status:'paid',payment:{payment_intent:q.payment.payment_intent}}]:[],has_more:false};
   }},
   refunds:{retrieve:async id=>refunds.get(id),list:async()=>({data:[...refunds.values()],has_more:false}),create:async()=>{refundCreates++;return {id:'re_abo29_ellallas',status:'succeeded'}}},
   charges:{retrieve:async id=>charges.get(id)},
   subscriptions:{retrieve:async()=>({metadata:{}}),list:async()=>({data:[],has_more:false}),cancel:async()=>{subscriptionCancels++;return {id:'sub_cancelled'}}},
   invoices:{list:async()=>({data:[],has_more:false}),retrieve:async id=>({id,lines:{data:[{period:{end:Math.floor((perioden.get(id)||future*1000)/1000)}}]}})},
   checkout:{sessions:{list:async()=>({data:[],has_more:false})}},
   billingPortal:{sessions:{create:async()=>({url:'https://billing.stripe.com/test'})}}
 };
 server=erstelleServer({stripe,webhookSecret:'mock',base,abgleichAutomatik:false}).listen(4519,'127.0.0.1');
 await new Promise((resolve,reject)=>{if(server.listening)return resolve();server.once('listening',resolve);server.once('error',reject)});
 const webhook=async(type,obj,id)=>{const r=await fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'mock'},body:JSON.stringify({id,type,livemode:false,data:{object:obj}})});return r.status;};
 check('Alte Rechnung: Rueckwaertssuche erfolgreich',(await webhook('charge.refunded',chargeOld,'evt_abo29_old_charge'))===200&&order(i6)?.zahlung_id===chargeOld.payment_intent&&order(i6)?.status==='erstattet');
 const switched=scene(),isw='in_abo29_swapped_'+switched.n,pisw='pi_abo29_'+isw;
 payments.set(pisw,isw);
 const invSw={id:isw,parent:{subscription_details:{subscription:switched.sub,metadata:{benutzer_id:String(switched.user),kurs_id:String(switched.course)}}},
   customer:'cus_abo29_'+switched.n,metadata:{benutzer_id:String(switched.user),kurs_id:String(switched.course)},
   amount_paid:990000,currency:'huf',lines:{data:[{period:{end:future}}]}};
 const swCharge={id:'ch_swapped',payment_intent:pisw,amount:990000,amount_refunded:990000,refunded:true,
   refunds:{data:[{id:'re_swapped',amount:990000,status:'succeeded'}]}};
 const previousRetrieve=stripe.invoices.retrieve;
 stripe.invoices.retrieve=async id=>id===isw?invSw:previousRetrieve(id);
 const firstSw=await webhook('charge.refunded',swCharge,'evt_abo29_swapped_refund');
 check('Vertauschte Reihenfolge: Erstattung vor Rechnung 500 und kein Ereignis gespeichert',
   firstSw===500&&!db.prepare("SELECT 1 FROM stripe_ereignisse WHERE id='evt_abo29_swapped_refund'").get());
 const invoiceSw=await webhook('invoice.paid',invSw,'evt_abo29_swapped_paid');
 check('Vertauschte Reihenfolge: Rechnung wird mit Zahlungs-ID gebucht',invoiceSw===200&&order(isw)?.status==='bezahlt'&&order(isw)?.zahlung_id===pisw);
 const retrySw=await webhook('charge.refunded',swCharge,'evt_abo29_swapped_refund');
 check('Vertauschte Reihenfolge: Stripe-Retry bucht Erstattung',retrySw===200&&order(isw)?.status==='erstattet'&&!access(switched));
 stripe.invoices.retrieve=previousRetrieve;
 const s7=scene(),i7='in_abo29_'+s7.n;paid(s7,i7);db.prepare('UPDATE bestellungen SET zahlung_id=NULL WHERE stripe_sitzung=?').run(i7);
 const chargeFail={...chargeOld,id:'ch_abo29_fail',payment_intent:'pi_abo29_unknown',refunds:{data:[{id:'re_abo29_fail',status:'succeeded',amount:990000}]}};
 const realList=stripe.invoicePayments.list;
 stripe.invoicePayments.list=async()=>{throw {statusCode:503}};
 check('Stripe 503: Webhook erneut versuchen, Bestellung nicht anfassen',(await webhook('charge.refunded',chargeFail,'evt_abo29_503'))===500&&
   !db.prepare("SELECT 1 FROM stripe_ereignisse WHERE id='evt_abo29_503'").get()&&order(i7)?.status==='bezahlt');
 stripe.invoicePayments.list=async()=>{const e=new Error('timeout');e.code='ETIMEDOUT';throw e;};
 check('Stripe Timeout: Webhook 500 und Ereignis bleibt wiederholbar',
   (await webhook('charge.refunded',chargeFail,'evt_abo29_timeout'))===500&&
   !db.prepare("SELECT 1 FROM stripe_ereignisse WHERE id='evt_abo29_timeout'").get());
 stripe.invoicePayments.list=realList;
 const s8=scene(),i8='in_abo29_'+s8.n;paid(s8,i8);
 const stranger={...chargeOld,payment_intent:'pi_abo29_stranger',refunds:{data:[{id:'re_abo29_stranger',status:'succeeded',amount:990000}]}};
 const warnungen=[],oldWarn=console.warn;
 console.warn=(...args)=>{warnungen.push(args.join(' '));};
 const unknownStatus=await webhook('charge.refunded',stranger,'evt_abo29_stranger');
 console.warn=oldWarn;
 check('Unbekannte Zahlung: Warnung ohne Absturz',unknownStatus===200&&warnungen.some(x=>x.includes('Zahlung unbekannt')));
 const s9=scene(),i9='in_abo29_'+s9.n;
 paid(s9,i9);
 const other=db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES(?,?,?, ?,990000,'huf','bezahlt','einmal',?,?)")
   .run('cs_abo29_other_'+s9.n,'pi_other_'+s9.n,s9.user,s9.course,s9.stamp,s9.stamp);
 refund(s9,i9,'pi_abo29_'+i9);
 check('Andere bezahlte Bestellung: Zugang bleibt',!!access(s9)&&order(i9)?.status==='erstattet');
 const s10=scene(),i10='in_abo29_'+s10.n;paid(s10,i10);
 db.prepare("UPDATE bestellungen SET status='erstattet',grund='erstattung_voll' WHERE stripe_sitzung=?").run(i10);
 db.prepare("DELETE FROM zugaenge WHERE benutzer_id=? AND kurs_id=?").run(s10.user,s10.course);
 const before10=db.prepare("SELECT COUNT(*) n FROM abo_erstattung_mail WHERE bestell_id=?").get(order(i10).id).n;
 refund(s10,i10,'pi_abo29_'+i10);
 check('Elallas zuerst: Webhook erzeugt keine zweite Mail',db.prepare("SELECT COUNT(*) n FROM abo_erstattung_mail WHERE bestell_id=?").get(order(i10).id).n===before10);
 const s11=scene(),i11='in_abo29_'+s11.n;paid(s11,i11);refund(s11,i11,'pi_abo29_'+i11);
 check('Webhook zuerst: Erstattung bereits verbucht',order(i11)?.status==='erstattet');
 const ell=scene(),ellInvoice='in_abo29_ell_'+ell.n;
 paid(ell,ellInvoice);
 const invRetrieveBefore=stripe.invoices.retrieve;
 stripe.invoices.retrieve=async id=>id===ellInvoice?{id,billing_reason:'subscription_create',parent:{subscription_details:{subscription:ell.sub}},
   lines:{data:[{period:{end:future}}]}}:invRetrieveBefore(id);
 const cookieFor=async scene=>{const response=await fetch(base+'/api/anmelden',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({email:'abo29-'+scene.n+'@example.invalid',passwort:testPass})});
   return response.headers.get('set-cookie')?.split(';')[0];};
 const ellCookie=await cookieFor(ell);
 const ellUrl=base+'/api/bestellungen/'+order(ellInvoice).id+'/ellallas';
 const cancelsVorEll=subscriptionCancels; // F2: volle Erstattungen frueherer Szenen beenden jetzt das Abo bei Stripe; hier zaehlt nur der Widerruf.
 const firstEll=await fetch(ellUrl,{method:'POST',headers:{'Content-Type':'application/json',Cookie:ellCookie},body:JSON.stringify({bestaetigt:true})});
 check('Elallas-Route vor Webhook: Bestellung erstattet, Zugang entzogen, Abo genau einmal bei Stripe beendet',firstEll.status===200&&order(ellInvoice)?.status==='erstattet'&&!access(ell)&&refundCreates===1&&subscriptionCancels-cancelsVorEll===1);
 const ellCharge={id:'ch_abo29_ell',payment_intent:'pi_abo29_'+ellInvoice,amount:990000,amount_refunded:990000,refunded:true,
   refunds:{data:[{id:'re_abo29_ellallas',status:'succeeded',amount:990000}]}};
 const beforeEll=db.prepare("SELECT COUNT(*) n FROM abo_erstattung_mail WHERE bestell_id=?").get(order(ellInvoice).id).n;
 const eventEll=await webhook('charge.refunded',ellCharge,'evt_abo29_after_ellallas');
 check('Elallas zuerst, Webhook danach: keine zweite Mail',eventEll===200&&db.prepare("SELECT COUNT(*) n FROM abo_erstattung_mail WHERE bestell_id=?").get(order(ellInvoice).id).n===beforeEll);
 const refundCreatesBefore=refundCreates;
 const s11Cookie=await cookieFor(s11);
 const laterEll=await fetch(base+'/api/bestellungen/'+order(i11).id+'/ellallas',
   {method:'POST',headers:{'Content-Type':'application/json',Cookie:s11Cookie},body:JSON.stringify({bestaetigt:true})});
 check('Webhook zuerst, Elallas danach: keine zweite Stripe-Erstattung',laterEll.status===409&&refundCreates===refundCreatesBefore);
 stripe.invoices.retrieve=invRetrieveBefore;
 { const o2=db.prepare('SELECT benutzer_id,kurs_id FROM bestellungen WHERE id=?').get(order(i2).id); db.prepare("UPDATE abos SET status='beendet' WHERE benutzer_id=? AND kurs_id=?").run(o2.benutzer_id,o2.kurs_id); } // F2: dieses Abo gilt als automatisch beendet
 const send=[];const mail=mailDienst({mailer:async x=>{send.push(x);return true},base,verkaufsmeldungMail:'owner@example.invalid'});
 await mail.aboErstattungAusgangSenden();
 check('Inhaber-Mail: Kurs, Betrag und Bestell-ID enthalten',send.some(x=>x.text.includes('Tanfolyam')&&x.text.includes(String(order(i2).id))&&x.text.includes('Ft')));
 check('Inhaber-Mail: keine Stripe-Geheimnisse',send.every(x=>!x.text.includes('sk_test_')&&!x.text.includes('re_abo29_')));
 // F2: Ist das Abo schon beendet (volle Erstattung beendet es automatisch bei Stripe), darf die Mail NICHT behaupten, es koenne noch aktiv sein.
 const beendetMails=send.filter(x=>{const m=x.text.match(/Rendelésszám: (\d+)/);if(!m)return false;const b=db.prepare('SELECT benutzer_id,kurs_id FROM bestellungen WHERE id=?').get(Number(m[1]));return db.prepare('SELECT status FROM abos WHERE benutzer_id=? AND kurs_id=? ORDER BY id DESC LIMIT 1').get(b?.benutzer_id,b?.kurs_id)?.status==='beendet';});
 check('F2-Mail: es gibt Erstattungsmails zu bereits beendeten Abos (sonst waere die Pruefung leer)',beendetMails.length>0);
 check('F2-Mail: bei beendetem Abo steht, dass es automatisch beendet wurde, und NICHT, dass es noch aktiv sein kann',beendetMails.every(x=>x.text.includes('automatikusan leállította')&&!x.text.includes('továbbra is aktív')&&!x.subject.includes('ellenőrzés szükséges')));
 check('F2-Mail: bei noch laufendem Abo (Teilerstattung) bleibt die Warnung',send.filter(x=>!beendetMails.includes(x)).every(x=>x.text.includes('továbbra is aktív')));
 const sf=scene(),ifail='in_abo29_'+sf.n;
 const invoiceFail={id:ifail,parent:{subscription_details:{subscription:sf.sub,metadata:{benutzer_id:String(sf.user),kurs_id:String(sf.course)}}},customer:'cus_abo29_'+sf.n,amount_paid:990000,currency:'huf',lines:{data:[{period:{end:future}}]}};
 stripe.invoicePayments.list=async()=>{throw {statusCode:503}};
 check('InvoicePayments-Fehler: bezahlte Rechnung und Zugang bleiben',(await webhook('invoice.paid',invoiceFail,'evt_abo29_invoice_fail'))===200&&order(ifail)?.status==='bezahlt'&&!!access(sf));
 stripe.invoicePayments.list=realList;
 // Trigger feuern nur pro vorhandener Zeile: abgleich_nachbuchung ist an dieser Stelle noch leer, also eine Probezeile anlegen.
 db.prepare("INSERT INTO abgleich_nachbuchung(zeit,abweichung_stripe_id,bestell_id,ergebnis,benutzer_id) VALUES('2026-01-01T00:00:00.000Z','re_probe_append_only',NULL,'ok',NULL)").run();
 for (const table of ['abgleich_nachbuchung','abo_erstattung_eintrag']){
   check(table+' existiert',!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
   check(table+' hat mindestens eine Zeile (sonst wäre der Append-only-Test wertlos)',db.prepare('SELECT COUNT(*) n FROM '+table).get().n>0);
   let update=false,del=false;
   try{db.prepare('UPDATE '+table+' SET zeit=zeit').run()}catch{update=true}
   try{db.prepare('DELETE FROM '+table).run()}catch{del=true}
   check(table+' append-only',update&&del);
 }
 const starts=()=>spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',"await import('./db.mjs')"],
   {cwd:process.cwd(),env:{...process.env,DB_DATEI:process.env.DB_DATEI},encoding:'utf8',timeout:15000});
 check('Bestehende Datenbank startet zweimal',starts().status===0&&starts().status===0);
 // Simuliert die Schema-Version vor Scheibe 29: alte Daten bleiben, nur die drei neuen Tabellen fehlen.
 for(const table of ['abo_erstattung_mail','abo_erstattung_eintrag','abgleich_nachbuchung'])
   db.exec('DROP TABLE IF EXISTS '+table);
 check('Schema aus Scheibe 28 wird zweimal ohne Fehler erweitert',starts().status===0&&starts().status===0&&
   !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='abgleich_nachbuchung'").get());
 const admin=scene(),guestCookie='',customer=scene();
 db.prepare("UPDATE benutzer SET rolle='admin' WHERE id=?").run(admin.user);
 const login=async s=>{const r=await fetch(base+'/api/anmelden',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'abo29-'+s.n+'@example.invalid',passwort:testPass})});return r.headers.get('set-cookie')?.split(';')[0]};
 const adminCookie=await login(admin),customerCookie=await login(customer);
 const req=async(cookie,body,headers={})=>{const r=await fetch(base+'/api/admin/abgleich/nachbuchen',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},body:JSON.stringify(body)});return r.status;};
 check('Nachbuchen: Gast 401',(await req('',{stripe_id:'re_abo29_old'}))===401);
 check('Nachbuchen: Kunde 403',(await req(customerCookie,{stripe_id:'re_abo29_old'}))===403);
 check('Nachbuchen: Agent 403',(await req('',{stripe_id:'re_abo29_old'},{authorization:'Bearer vat_'+'A'.repeat(43)}))===403);
 check('Nachbuchen: CSRF 403',(await req(adminCookie,{stripe_id:'re_abo29_old'},{Origin:'https://fremd.invalid'}))===403);
 check('Nachbuchen: falsche ID abgelehnt',(await req(adminCookie,{stripe_id:'bad'}))===400);
 const manualScene=scene(),manualInv='in_abo29_manual_'+manualScene.n,manualPI='pi_abo29_'+manualInv,manualRid='re_abo29_manual';
 paid(manualScene,manualInv);
 db.prepare('UPDATE bestellungen SET zahlung_id=NULL WHERE stripe_sitzung=?').run(manualInv);
 payments.set(manualPI,manualInv);
 const manualCharge={id:'ch_abo29_manual',payment_intent:manualPI,amount:990000,amount_refunded:990000,refunded:true,
   refunds:{data:[{id:manualRid,status:'succeeded',amount:990000}]}};
 charges.set(manualCharge.id,manualCharge);
 refunds.set(manualRid,{id:manualRid,status:'succeeded',charge:manualCharge.id,payment_intent:manualPI,amount:990000,currency:'huf'});
 check('Nachbuchung Altfall: Ausgangszustand bezahlt ohne Zahlungs-ID',order(manualInv)?.status==='bezahlt'&&order(manualInv)?.zahlung_id===null&&!!access(manualScene));
 const lauf=Number(db.prepare("INSERT INTO abgleich_lauf(start,ende,modus,fenster_tage,geprueft_sitzungen,geprueft_rechnungen,geprueft_erstattungen,geprueft_abos,abweichungen_anzahl,status,meldung) VALUES(?,?,'test',35,0,0,0,0,1,'abweichung','abgleich_abweichung')").run(now(),now()).lastInsertRowid);
 db.prepare("INSERT INTO abgleich_abweichung(lauf_id,art,stripe_id,betrag,waehrung,text,zeit) VALUES(?,'erstattung_nicht_verarbeitet','re_abo29_manual',990000,'huf','abgleich_erstattung_nicht_verarbeitet',?)").run(lauf,now());
 const beforeOrders=db.prepare('SELECT COUNT(*) n FROM bestellungen').get().n;
 const otherBefore=JSON.stringify(db.prepare('SELECT id,status,grund,zahlung_id FROM bestellungen WHERE id<>? ORDER BY id').all(order(manualInv).id));
 const success=await req(adminCookie,{stripe_id:manualRid});
 check('Nachbuchen: Admin 200, alte Bestellung erstattet und Zahlungs-ID nachgetragen',
   success===200&&order(manualInv)?.status==='erstattet'&&order(manualInv)?.zahlung_id===manualPI&&!access(manualScene));
 check('Nachbuchen: keine neue oder andere Bestellung veraendert',
   db.prepare('SELECT COUNT(*) n FROM bestellungen').get().n===beforeOrders&&
   otherBefore===JSON.stringify(db.prepare('SELECT id,status,grund,zahlung_id FROM bestellungen WHERE id<>? ORDER BY id').all(order(manualInv).id)));
 check('Nachbuchen: Protokoll erfasst',db.prepare("SELECT COUNT(*) n FROM abgleich_nachbuchung WHERE abweichung_stripe_id=? AND ergebnis='ok'").get(manualRid).n===1);
 check('Nachbuchen: doppelt harmlos',(await req(adminCookie,{stripe_id:manualRid}))===200&&
   db.prepare('SELECT COUNT(*) n FROM abo_erstattung_mail WHERE bestell_id=?').get(order(manualInv).id).n===1);
 const readScene=scene(),readInv='in_abo29_readonly_'+readScene.n,readPI='pi_abo29_'+readInv;
 paid(readScene,readInv);
 const readRefund=refund(readScene,readInv,readPI);
 db.prepare('UPDATE bestellungen SET zahlung_id=NULL WHERE stripe_sitzung=?').run(readInv);
 payments.set(readPI,readInv);
 refunds.set(readRefund.id,{id:readRefund.id,status:'succeeded',payment_intent:readPI,amount:990000,currency:'huf'});
 const snapshotBefore=JSON.stringify(db.prepare('SELECT id,status,grund,zahlung_id FROM bestellungen ORDER BY id').all())+
   JSON.stringify(db.prepare('SELECT * FROM zugaenge ORDER BY benutzer_id,kurs_id').all());
 let reverseReads=0;
 const readonly={
   checkout:{sessions:{list:async()=>({data:[],has_more:false})}},
   invoices:{list:async()=>({data:[],has_more:false})},
   refunds:{list:async()=>({data:[...refunds.values()],has_more:false})},
   subscriptions:{list:async()=>({data:[],has_more:false})},
   invoicePayments:{list:async q=>{reverseReads++;return realList(q)}}
 };
 const after=await abgleichDienst({stripe:readonly}).lauf();
 const snapshotAfter=JSON.stringify(db.prepare('SELECT id,status,grund,zahlung_id FROM bestellungen ORDER BY id').all())+
   JSON.stringify(db.prepare('SELECT * FROM zugaenge ORDER BY benutzer_id,kurs_id').all());
 check('Abgleich alte Abo-Erstattung: Rueckwaertssuche nur lesend',
   after.ok&&reverseReads>0&&snapshotBefore===snapshotAfter);
 check('Abgleich alte verbuchte Abo-Erstattung: keine Refund-Abweichung',
   !db.prepare("SELECT 1 FROM abgleich_abweichung WHERE lauf_id=(SELECT MAX(id) FROM abgleich_lauf) AND art IN ('erstattung_nicht_verarbeitet','erstattung_ohne_stripe') AND (stripe_id=? OR bestell_id=?)").get(readRefund.id,order(readInv).id));
 const stripeRefundRetrieve=stripe.refunds.retrieve;
 stripe.refunds.retrieve=async()=>{throw {statusCode:503}};
 const logBefore=db.prepare("SELECT COUNT(*) n FROM abgleich_nachbuchung WHERE ergebnis='fehler'").get().n;
 // Bestellungszahl unmittelbar vor dem Aufruf merken (frühere Szenen haben nach beforeOrders weitere Testbestellungen angelegt).
 const ordersVor503=db.prepare('SELECT COUNT(*) n FROM bestellungen').get().n;
 check('Nachbuchen Stripe 503: Fehler protokolliert und keine neue Bestellung',
   (await req(adminCookie,{stripe_id:manualRid}))===503&&
   db.prepare("SELECT COUNT(*) n FROM abgleich_nachbuchung WHERE ergebnis='fehler'").get().n===logBefore+1&&
   db.prepare('SELECT COUNT(*) n FROM bestellungen').get().n===ordersVor503);
 stripe.refunds.retrieve=stripeRefundRetrieve;
 check('Nachgebuchte Erstattung hat im neuen Abgleich keine offene Abweichung',
   !db.prepare("SELECT 1 FROM abgleich_abweichung WHERE lauf_id=(SELECT MAX(id) FROM abgleich_lauf) AND art='erstattung_nicht_verarbeitet' AND stripe_id=?").get(manualRid));
} catch(e){fail++;console.error('FEHLER Testabbruch:',e?.name||'Error',e?.message||'');}
finally{
 if(server)await new Promise(done=>server.close(done));
 for(let i=0;i<4;i++){try{rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:200});break}catch(e){if(i===3)console.warn('Testordner konnte nicht entfernt werden')}}
 console.log('Aboerstattung: '+ok+' bestanden, '+fail+' fehlgeschlagen');
 process.exitCode=fail?1:0;
}
