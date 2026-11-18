// Scheibe 8: isolierte Abo-Tests mit Stripe-Attrappe. Keine echten Schlüssel, keine Pakete.
import './test-sprache.mjs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const BASIS=mkdtempSync(join(tmpdir(),'schulung-abo-')), DATEI=join(BASIS,'abo.db'), ORDNER=join(BASIS,'dateien');
const PORT=4418, BASE='http://127.0.0.1:'+PORT, PASS=randomBytes(24).toString('hex');
process.env.DB_DATEI=DATEI;
let ok=0, schlecht=0, server, portalFehler=false, webhookFehler=false;
const pruefe=(n,g,d='')=>{g?ok++:schlecht++;console.log((g?'OK     ':'FEHLER ')+n+(!g?' '+String(d).slice(0,250):''));};
function sql(q,...v){const d=new DatabaseSync(DATEI);try{return d.prepare(q).all(...v);}finally{d.close();}}
function run(q,...v){const d=new DatabaseSync(DATEI);try{return d.prepare(q).run(...v);}finally{d.close();}}
const ein=(q,...v)=>sql(q,...v)[0];
function client(){
  let cookie='';
  return {async req(m,p,body,headers={}){
    const r=await fetch(BASE+p,{method:m,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];
    const bytes=Buffer.from(await r.arrayBuffer());let d={};
    try{d=JSON.parse(bytes.toString());}catch{}
    return {s:r.status,d,bytes,headers:r.headers};
  },get cookie(){return cookie;}};
}
let checkout=[];
const stripe={
  customers:{create:async()=>({id:'cus_abo_test'})},
  checkout:{sessions:{create:async p=>{checkout.push(p);return {id:'cs_test_abo_mock_'+checkout.length,url:'https://checkout.stripe.com/c/test'};}}},
  billingPortal:{sessions:{create:async()=>{if(portalFehler)throw Error('not configured');return {url:'https://billing.stripe.com/test'};}}},
  subscriptions:{retrieve:async()=>({metadata:{},customer:'cus_abo_test'})},
  webhooks:{constructEvent:buf=>{if(webhookFehler)throw Error('bad signature');return JSON.parse(buf.toString());}},
};
try {
  mkdirSync(ORDNER,{recursive:true});
  const {erstelleServer}=await import(pathToFileURL(resolve('app.mjs')).href);
  server=erstelleServer({stripe,webhookSecret:'stub',base:BASE,dateiOrdner:ORDNER}).listen(PORT,'127.0.0.1');
  await new Promise((yes,no)=>{if(server.listening)return yes();server.once('listening',yes);server.once('error',no);});
  const admin=client(), kunde=client(), gast=client(), anderer=client();
  const adminMail='abo.admin@example.com',kundeMail='abo.kunde@example.com';
  const start=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','tools/admin-anlegen.mjs',adminMail],
    {env:{...process.env,ADMIN_PASSWORT:PASS},encoding:'utf8'});
  pruefe('Admin angelegt',start.status===0,start.stderr);
  pruefe('Admin angemeldet',(await admin.req('POST','/api/anmelden',{email:adminMail,passwort:PASS})).s===200);
  pruefe('Kunde registriert',(await kunde.req('POST','/api/registrieren',{ zustimmung: true, email:kundeMail,passwort:PASS})).s===201);
  pruefe('Zweiter Kunde registriert',(await anderer.req('POST','/api/registrieren',{ zustimmung: true, email:'abo.anderer@example.com',passwort:PASS})).s===201);
  const uid=ein('SELECT id FROM benutzer WHERE email=?',kundeMail).id;
  const kurs=(await admin.req('POST','/api/admin/kurse',
    {titel:'Előfizetés',preis_cent:5990000,abo_preis_cent:990000,abo_intervall:'month'})).d;
  pruefe('Abo-Kurs als Entwurf erstellt',kurs?.status==='entwurf'&&kurs.abo_preis_cent===990000);
  await admin.req('POST','/api/admin/kurse/'+kurs.id+'/veroeffentlichen',{});
  const lek=(await admin.req('POST','/api/admin/kurse/'+kurs.id+'/lektionen',{titel:'PDF',art:'pdf',status:'veroeffentlicht'})).d.id;   // Block 4: sonst im veroeffentlichten Kurs zuerst ausgeblendet
  pruefe('Kursliste zeigt Abo-Angebot',(await gast.req('GET','/api/kurse')).d.some(k=>k.abo_preis_cent===990000));
  pruefe('Detail zeigt Abo-Angebot',(await kunde.req('GET','/api/kurse/'+kurs.id)).d.abo_intervall==='month');
  pruefe('Gast darf nicht kaufen',(await gast.req('POST','/api/kurse/'+kurs.id+'/kaufen',{modell:'abo',zustimmung:true})).s===401);
  pruefe('Fremdes Preisfeld 400',(await kunde.req('POST','/api/kurse/'+kurs.id+'/kaufen',{modell:'abo',preis_cent:1})).s===400);
  pruefe('Ungültiges Modell 400',(await kunde.req('POST','/api/kurse/'+kurs.id+'/kaufen',{modell:'gratis'})).s===400);
  pruefe('Abo-Checkout',(await kunde.req('POST','/api/kurse/'+kurs.id+'/kaufen',{modell:'abo',zustimmung:true})).s===200);
  pruefe('Stripe subscription und recurring aus DB',checkout.at(-1).mode==='subscription' &&
    checkout.at(-1).line_items[0].price_data.unit_amount===990000 && checkout.at(-1).line_items[0].price_data.recurring.interval==='month');
  pruefe('Abo-Metadaten an Subscription',checkout.at(-1).subscription_data.metadata.modell==='abo');
  // Punkt 3: keine automatische Umrechnung (Adaptive Pricing): die Kundin zahlt genau den Preis des Kurses in dessen Waehrung.
  pruefe('Punkt 3: Abo-Checkout schaltet Adaptive Pricing aus',checkout.at(-1).adaptive_pricing?.enabled===false);
  pruefe('Checkout gibt keinen Zugang',ein('SELECT COUNT(*) AS n FROM zugaenge').n===0);
  const once=await kunde.req('POST','/api/kurse/'+kurs.id+'/kaufen',{zustimmung:true});
  pruefe('Einmalkauf weiter payment',once.s===200&&checkout.at(-1).mode==='payment'&&checkout.at(-1).line_items[0].price_data.unit_amount===5990000);
  pruefe('Punkt 3: Einmalkauf-Checkout schaltet Adaptive Pricing aus',checkout.at(-1).adaptive_pricing?.enabled===false);
  const ohne=(await admin.req('POST','/api/admin/kurse',{titel:'Ohne Abo',preis_cent:10000})).d;
  await admin.req('POST','/api/admin/kurse/'+ohne.id+'/veroeffentlichen',{});
  pruefe('Kurs ohne Abo weist Modell abo zurück',(await kunde.req('POST','/api/kurse/'+ohne.id+'/kaufen',{modell:'abo',zustimmung:true})).s===400);
  pruefe('Abo-Preis ohne Intervall abgelehnt',(await admin.req('PATCH','/api/admin/kurse/'+ohne.id,{abo_preis_cent:10000})).s===400);
  pruefe('Abo-Preis mit HUF-Bruch abgelehnt',(await admin.req('PATCH','/api/admin/kurse/'+ohne.id,{abo_preis_cent:10001,abo_intervall:'year'})).s===400);
  pruefe('Abo-Preis und Jahr speichern',(await admin.req('PATCH','/api/admin/kurse/'+ohne.id,{abo_preis_cent:150000,abo_intervall:'year'})).d.abo_intervall==='year');
  pruefe('Abo-Adminroute Gast 401',(await gast.req('GET','/api/admin/kurse/'+kurs.id+'/abos')).s===401);
  pruefe('Abo-Adminroute Kunde 403',(await kunde.req('GET','/api/admin/kurse/'+kurs.id+'/abos')).s===403);
  const t0=1761930000, periodeEnd=t0+30*86400;
  let zaehler=0;
  const webhook=async(type,obj,created=t0,ident=null)=>{
    const e={id:ident||'evt_abo_'+(++zaehler),type,created,livemode:false,data:{object:obj}};
    const r=await fetch(BASE+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'stub'},body:JSON.stringify(e)});
    return {s:r.status,d:await r.json(),id:e.id};
  };
  const m={kurs_id:String(kurs.id),benutzer_id:String(uid),modell:'abo'};
  const subscription='sub_selftest_abo';
  const done=await webhook('checkout.session.completed',{id:'cs_abo_selftest',mode:'subscription',subscription,
    customer:'cus_abo_test',metadata:m,payment_status:'paid'});
  pruefe('Subscription Checkout angenommen',done.s===200);
  pruefe('Checkout ohne invoice noch kein Zugang',ein('SELECT COUNT(*) AS n FROM zugaenge').n===0);
  const invoice=(id,amount=990000,end=periodeEnd)=>({id,subscription,customer:'cus_abo_test',
    amount_paid:amount,currency:'huf',payment_intent:'pi_abo_'+id,lines:{data:[{period:{end}}]}});
  let paid=await webhook('invoice.paid',invoice('in_abo_1'));
  pruefe('Bezahlte Rechnung angenommen',paid.s===200);
  pruefe('Abo und Bestellung aktiv',ein('SELECT status FROM abos WHERE stripe_abo=?',subscription).status==='aktiv' &&
    ein("SELECT status,art FROM bestellungen WHERE stripe_sitzung='in_abo_1'").art==='abo');
  pruefe('Abo-Zugang endet 2 Tage (Puffer, L3) nach dem Periodenende, das Abo selbst genau am Periodenende',ein('SELECT gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id).gueltig_bis===periodeEnd*1000+172800000&&
 ein('SELECT gueltig_bis FROM abos WHERE stripe_abo=?',subscription).gueltig_bis===periodeEnd*1000);
  // Der Zeitraum ist für das Testdatum ggf. schon abgelaufen; auf kontrollierte Zukunft verlängern.
  const bisZukunft=Math.floor(Date.now()/1000)+30*86400;
  await webhook('invoice.paid',invoice('in_abo_zukunft',990000,bisZukunft),t0+1);
  pruefe('Zugang nach aktiver Zahlung sichtbar',(await kunde.req('GET','/api/kurse/'+kurs.id)).d.zugang===true);
  const duplikat=await webhook('invoice.paid',invoice('in_abo_1'),t0,'evt_abo_2');
  pruefe('Doppeltes Stripe-Ereignis erkannt',duplikat.d.doppelt===true);
  pruefe('Eine Bestellung je Rechnung',ein("SELECT COUNT(*) AS n FROM bestellungen WHERE stripe_sitzung='in_abo_1'").n===1);
  // Abnahme 01.11.2026 (Pruefrunde C1): Kurspreis wird geaendert, waehrend das Abo laeuft; Stripe belastet weiter den alten Preis.
  await admin.req('PATCH','/api/admin/kurse/'+kurs.id,{abo_preis_cent:1190000});
  await webhook('invoice.paid',invoice('in_abo_erneuerung_alter_preis',990000,bisZukunft),t0+2);
  pruefe('Preis nach Abschluss geaendert: Verlaengerung zum ALTEN Preis bleibt "bezahlt" (Zugang wird nicht entzogen)',ein("SELECT status,grund FROM bestellungen WHERE stripe_sitzung='in_abo_erneuerung_alter_preis'").status==='bezahlt');
  await webhook('invoice.paid',invoice('in_abo_unbekannter_betrag',555000,bisZukunft),t0+2);
  pruefe('Ein Betrag, der weder dem aktuellen Preis noch einer frueheren Zahlung entspricht, bleibt "pruefen"',ein("SELECT status FROM bestellungen WHERE stripe_sitzung='in_abo_unbekannter_betrag'").status==='pruefen');
  // Fall: die fruehere Rechnung wurde voll erstattet, danach Preisaenderung, Stripe belastet weiter den alten Betrag
  run("UPDATE bestellungen SET status='erstattet' WHERE stripe_sitzung IN ('in_abo_1','in_abo_zukunft','in_abo_erneuerung_alter_preis')");
  await webhook('invoice.paid',invoice('in_abo_nach_erstattung',990000,bisZukunft),t0+2);
  pruefe('Auch wenn die fruehere Rechnung inzwischen erstattet ist: Verlaengerung zum alten Betrag bleibt "bezahlt"',ein("SELECT status FROM bestellungen WHERE stripe_sitzung='in_abo_nach_erstattung'").status==='bezahlt');
  {
    const zugangEnde=()=>ein('SELECT gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id).gueltig_bis;
    pruefe('L3: aktives Abo hat Puffer nach dem Periodenende',zugangEnde()===bisZukunft*1000+172800000);
    await webhook('customer.subscription.updated',{id:subscription,cancel_at_period_end:true},t0+3);
    pruefe('L3: gekündigt (Periodenende): Puffer entfällt, Zugang endet genau am Periodenende',zugangEnde()===bisZukunft*1000);
    await webhook('customer.subscription.updated',{id:subscription,cancel_at_period_end:false},t0+4);
    pruefe('L3: Kündigung zurückgenommen: Puffer wieder da',zugangEnde()===bisZukunft*1000+172800000);
    // G1: Ein entzogener oder erstatteter Zugang darf durch ein subscription.updated NICHT neu entstehen (Stripe: updated ist kein Zahlungsereignis).
    const zugangVorher=ein('SELECT * FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id);
    run('DELETE FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id);
    await webhook('customer.subscription.updated',{id:subscription,cancel_at_period_end:false},t0+4);
    pruefe('G1: subscription.updated legt keinen entzogenen Zugang neu an',ein('SELECT COUNT(*) AS n FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id).n===0);
    run('INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES (?,?,?,?,?)',zugangVorher.benutzer_id,zugangVorher.kurs_id,zugangVorher.quelle,zugangVorher.erstellt,zugangVorher.gueltig_bis);
  }
  run("UPDATE bestellungen SET status='bezahlt' WHERE stripe_sitzung IN ('in_abo_1','in_abo_zukunft','in_abo_erneuerung_alter_preis')");
  await admin.req('PATCH','/api/admin/kurse/'+kurs.id,{abo_preis_cent:990000});
  {
    // G1: auch eine fehlgeschlagene Abbuchung ist kein Zahlungseingang und darf einen entzogenen Zugang nicht als Kulanz neu anlegen.
    const zv=ein('SELECT * FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id);
    run('DELETE FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id);
    await webhook('invoice.payment_failed',invoice('in_abo_fehlgeschlagen_g1',0,bisZukunft),t0+5);
    pruefe('G1: payment_failed legt keinen entzogenen Zugang als Kulanz neu an',ein('SELECT COUNT(*) AS n FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id).n===0);
    run('INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES (?,?,?,?,?)',zv.benutzer_id,zv.kurs_id,zv.quelle,zv.erstellt,zv.gueltig_bis);
  }
  const failure=await webhook('invoice.payment_failed',invoice('in_abo_fehlgeschlagen',0,bisZukunft),t0+5);
  pruefe('Fehlgeschlagene Rechnung markiert offen',failure.s===200&&ein('SELECT status FROM abos WHERE stripe_abo=?',subscription).status==='zahlung_offen');
  pruefe('Kulanz 3 Tage',ein('SELECT gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id).gueltig_bis===bisZukunft*1000+259200000);
  await webhook('customer.subscription.updated',{id:subscription,cancel_at_period_end:true},t0+6);
  pruefe('Kündigung zum Periodenende gespeichert',ein('SELECT status,endet_zum_periodenende FROM abos WHERE stripe_abo=?',subscription).endet_zum_periodenende===1);
  {
    // Punkt 4: Stripe meldet das Abo weiter als 'past_due' (Zahlung offen). Nach Kuendigung und Ruecknahme muss die App 'zahlung_offen' zeigen (nicht 'aktiv')
    // und die 3 Tage Kulanz behalten (nicht auf den 2-Tage-Puffer schrumpfen).
    const zugangEnde4=()=>ein('SELECT gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id).gueltig_bis;
    await webhook('customer.subscription.updated',{id:subscription,cancel_at_period_end:false,status:'past_due'},t0+6);
    const a4=ein('SELECT status,endet_zum_periodenende FROM abos WHERE stripe_abo=?',subscription);
    pruefe('Punkt 4: Ruecknahme bei Stripe-Status past_due: App bleibt "zahlung_offen"',a4.status==='zahlung_offen'&&a4.endet_zum_periodenende===0);
    pruefe('Punkt 4: ... und die Kulanz bleibt bei 3 Tagen',zugangEnde4()===bisZukunft*1000+259200000);
    await webhook('customer.subscription.updated',{id:subscription,cancel_at_period_end:true,status:'past_due'},t0+6);
    pruefe('Punkt 4: erneute Kuendigung wieder "gekuendigt"',ein('SELECT status FROM abos WHERE stripe_abo=?',subscription).status==='gekuendigt');
  }
  {
    // G1: das Ende des Abos bei Stripe darf einen entzogenen Zugang nicht bis zum Periodenende neu anlegen.
    const zv=ein('SELECT * FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id);
    const av=ein('SELECT status,gueltig_bis,endet_zum_periodenende,letzte_ereignis_zeit FROM abos WHERE stripe_abo=?',subscription);
    run('DELETE FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id);
    await webhook('customer.subscription.deleted',{id:subscription},t0+7);
    pruefe('G1: subscription.deleted legt keinen entzogenen Zugang neu an',ein('SELECT COUNT(*) AS n FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id).n===0);
    // Aufbau des folgenden Tests wiederherstellen: Zugang UND Abo-Zustand wie vor diesem Block (sonst gilt das naechste deleted zu Recht als "schon beendet").
    run('INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES (?,?,?,?,?)',zv.benutzer_id,zv.kurs_id,zv.quelle,zv.erstellt,zv.gueltig_bis);
    run('UPDATE abos SET status=?,gueltig_bis=?,endet_zum_periodenende=?,letzte_ereignis_zeit=? WHERE stripe_abo=?',av.status,av.gueltig_bis,av.endet_zum_periodenende,av.letzte_ereignis_zeit,subscription);
  }
  await webhook('customer.subscription.deleted',{id:subscription},t0+7);
  pruefe('Kündigung entfernt Kulanz und bewahrt bezahltes Ende',ein('SELECT status,gueltig_bis FROM abos WHERE stripe_abo=?',subscription).status==='beendet' &&
    ein('SELECT gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id).gueltig_bis===bisZukunft*1000);
  await webhook('customer.subscription.updated',{id:subscription,cancel_at_period_end:false},t0+3);
  pruefe('Veraltetes Update ändert Ende nicht',ein('SELECT status FROM abos WHERE stripe_abo=?',subscription).status==='beendet');
  // Punkt 4: Ein beendetes Abo wird nie wieder lebendig, auch nicht durch ein spaeteres oder gleichzeitiges subscription.updated (ein Stripe-Abo laesst sich nach dem Ende nicht reaktivieren).
  await webhook('customer.subscription.updated',{id:subscription,cancel_at_period_end:false,status:'active'},t0+9);
  await webhook('customer.subscription.updated',{id:subscription,cancel_at_period_end:false,status:'active'},t0+7);
  pruefe('Punkt 4: spaeteres/gleichzeitiges Update macht ein beendetes Abo nicht wieder aktiv',ein('SELECT status,endet_zum_periodenende e FROM abos WHERE stripe_abo=?',subscription).status==='beendet');
  // F3: Stripe garantiert keine Reihenfolge der Ereignisse. Eine verspaetete Zahlungs-fehlgeschlagen-Meldung darf ein beendetes Abo nicht auf "zahlung_offen" setzen und keine Kulanz verlaengern.
  await webhook('invoice.payment_failed',invoice('in_abo_fehlgeschlagen_f3',0,bisZukunft),t0+10);
  pruefe('F3: spaetes payment_failed laesst ein beendetes Abo beendet',ein('SELECT status FROM abos WHERE stripe_abo=?',subscription).status==='beendet');
  pruefe('F3: ... und verlaengert den Zugang nicht um die Kulanz',ein('SELECT gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id).gueltig_bis===bisZukunft*1000);
  const dateiName='11111111-1111-4111-8111-111111111111';
  const bytes=Buffer.from('%PDF-1.4\n'+ 'x'.repeat(300));
  writeFileSync(join(ORDNER,dateiName),bytes);
  run("INSERT INTO dateien (lektion_id,name,art,pfad,groesse,mime,erstellt) VALUES (?,?,?,?,?,?,?)",
    lek,'abo.pdf','pdf',dateiName,bytes.length,'application/pdf',new Date().toISOString());
  const play=await kunde.req('POST','/api/lektionen/'+lek+'/wiedergabe',{});
  pruefe('Wiedergabe-Ticket für aktives Abo',play.s===200);
  pruefe('Range 206 mit Abo',(await kunde.req('GET','/api/lektionen/'+lek+'/datei?ticket='+play.d.ticket,undefined,{Range:'bytes=0-9'})).s===206);
  run('UPDATE zugaenge SET gueltig_bis=? WHERE benutzer_id=? AND kurs_id=?',Date.now()-1000,uid,kurs.id);
  pruefe('Abgelaufener Zugang im Kursdetail false',(await kunde.req('GET','/api/kurse/'+kurs.id)).d.zugang===false);
  pruefe('Abgelaufenes Abo nicht in Meine Kurse',(await kunde.req('GET','/api/meine-kurse')).d.every(x=>x.id!==kurs.id));
  pruefe('Abgelaufenes Ticket wird 403',(await kunde.req('POST','/api/lektionen/'+lek+'/wiedergabe',{})).s===403);
  pruefe('Abgelaufene Datei wird 403',(await kunde.req('GET','/api/lektionen/'+lek+'/datei?ticket='+play.d.ticket)).s===403);
  // Punkt 2: Laeuft das Abo noch (wird noch abgebucht), aber der Zugang ist weg (z. B. Erstattung), darf derselbe Kurs nicht noch einmal gekauft werden
  // (sonst zwei Abos oder Abo plus Einmalkauf, doppelt bezahlt).
  for (const st of ['aktiv','zahlung_offen']) {
    run('UPDATE abos SET status=? WHERE stripe_abo=?',st,subscription);
    const zweitesAbo=await kunde.req('POST','/api/kurse/'+kurs.id+'/kaufen',{modell:'abo',zustimmung:true});
    const einmal=await kunde.req('POST','/api/kurse/'+kurs.id+'/kaufen',{modell:'einmal',zustimmung:true});
    pruefe('Punkt 2: Abo "'+st+'" ohne Zugang: kein zweites Abo (409 abo_laeuft_bereits)',zweitesAbo.s===409&&zweitesAbo.d.fehler==='abo_laeuft_bereits');
    pruefe('Punkt 2: Abo "'+st+'" ohne Zugang: auch kein Einmalkauf (409 abo_laeuft_bereits)',einmal.s===409&&einmal.d.fehler==='abo_laeuft_bereits');
  }
  {
    // Anzeige: bei abo_laeuft_bereits bleibt die Kundin auf der Kursseite und sieht den Text in Rot (nicht die Weiterleitung wie bei zugang_vorhanden).
    const js=readFileSync(resolve('public/kunde.js'),'utf8').replace(/\r\n/g,'\n');
    const stelle=js.slice(js.indexOf('async function bezahlenAusfuehren'),js.indexOf('const zustimmInput'));
    const iAbo=stelle.indexOf("abo_laeuft_bereits"),i409=stelle.lastIndexOf('v.status === 409');
    pruefe('Punkt 2: kunde.js zeigt abo_laeuft_bereits als rote Meldung auf der Seite, vor der allgemeinen 409-Weiterleitung',
      iAbo>=0&&i409>=0&&iAbo<i409&&/abo_laeuft_bereits[^\n]*meldung\(fehlerText\(v\), ?'rot'\)/.test(stelle));
  }
  run("UPDATE abos SET status='gekuendigt' WHERE stripe_abo=?",subscription);
  pruefe('Punkt 2: gekuendigtes Abo (keine Abbuchung mehr) blockiert den Neukauf nicht',(await kunde.req('POST','/api/kurse/'+kurs.id+'/kaufen',{modell:'abo',zustimmung:true})).s===200);
  run("UPDATE abos SET status='beendet' WHERE stripe_abo=?",subscription);
  pruefe('Nach Ablauf neuer Checkout erlaubt',(await kunde.req('POST','/api/kurse/'+kurs.id+'/kaufen',{modell:'abo',zustimmung:true})).s===200);
  await admin.req('POST','/api/admin/kurse/'+kurs.id+'/archivieren',{});
  pruefe('Archiv kein neuer Kauf',(await anderer.req('POST','/api/kurse/'+kurs.id+'/kaufen',{modell:'abo',zustimmung:true})).s===404);
  pruefe('Abo-Portal vorhanden',(await kunde.req('POST','/api/abo/portal',{})).d.url?.startsWith('https://billing.stripe.com/'));
  portalFehler=true;
  pruefe('Portalfehler abgefangen',(await kunde.req('POST','/api/abo/portal',{})).s===503);
  pruefe('Portal Gast 401',(await gast.req('POST','/api/abo/portal',{})).s===401);
  // Rollback: Fehler beim Zugang führt zum Webhook-500 und nicht gespeicherter Ereignis-ID.
  const kurs2=(await admin.req('POST','/api/admin/kurse',{titel:'Rollback',preis_cent:10000,abo_preis_cent:10000,abo_intervall:'month'})).d;
  const abo2='sub_rollback', m2={kurs_id:String(kurs2.id),benutzer_id:String(uid),modell:'abo'};
  await webhook('checkout.session.completed',{id:'cs_rollback',mode:'subscription',subscription:abo2,customer:'cus_abo_test',metadata:m2},t0+10);
  run("CREATE TRIGGER rollback_abo BEFORE INSERT ON zugaenge BEGIN SELECT RAISE(ABORT,'Testrollback'); END");
  const inv2={id:'in_rollback',subscription:abo2,customer:'cus_abo_test',amount_paid:10000,currency:'huf',
    lines:{data:[{period:{end:bisZukunft}}]}};
  const failed=await webhook('invoice.paid',inv2,t0+11,'evt_rollback');
  pruefe('Abo-Webhook bei SQL-Fehler 500',failed.s===500);
  pruefe('Abo-Webhook-Rollback ohne Bestellung',ein("SELECT COUNT(*) AS n FROM bestellungen WHERE stripe_sitzung='in_rollback'").n===0);
  pruefe('Event-ID nach Rollback nicht gespeichert',ein("SELECT COUNT(*) AS n FROM stripe_ereignisse WHERE id='evt_rollback'").n===0);
  run('DROP TRIGGER rollback_abo');
  const retry=await webhook('invoice.paid',inv2,t0+11,'evt_rollback');
  pruefe('Stripe-Retry nach Rollback erfolgreich',retry.s===200&&retry.d.doppelt===false);
  pruefe('Admin sieht Abos',(await admin.req('GET','/api/admin/kurse/'+kurs.id+'/abos')).d.some(a=>a.email===kundeMail));
  {
    // PUNKT 1 (Sicherheitspaket 1a): subscription.deleted fuer altes Abo darf Zugang des neuen Abos nicht ueberschreiben.
    // Abo A: in der Vergangenheit bezahlt und gekuendigt (gueltig_bis in der Vergangenheit).
    // Abo B: danach neu bezahlt (Zugang bis in die Zukunft).
    // Ereignis: customer.subscription.deleted fuer Abo A trifft spaet ein — Abo B-Zugang muss erhalten bleiben.
    const subP1A='sub_p1_abo_a', subP1B='sub_p1_abo_b';
    const mP1={kurs_id:String(kurs.id),benutzer_id:String(uid),modell:'abo'};
    const tP1=Math.floor(Date.now()/1000);
    const endA=tP1-10*86400; // 10 Tage in der Vergangenheit
    const endB=tP1+30*86400; // 30 Tage in der Zukunft
    const invP1=(id,sub,end,pi)=>({id,subscription:sub,customer:'cus_abo_test',amount_paid:990000,currency:'huf',
      payment_intent:pi,lines:{data:[{period:{end}}]}});
    // Abo A: checkout -> invoice.paid -> subscription.updated (gekuendigt zum Periodenende)
    await webhook('checkout.session.completed',{id:'cs_p1a',mode:'subscription',subscription:subP1A,
      customer:'cus_abo_test',metadata:mP1},tP1-200);
    await webhook('invoice.paid',invP1('in_p1a',subP1A,endA,'pi_p1a'),tP1-190);
    await webhook('customer.subscription.updated',{id:subP1A,cancel_at_period_end:true},tP1-150);
    // Abo B: checkout -> invoice.paid (setzt spaeteres Zugangsende)
    await webhook('checkout.session.completed',{id:'cs_p1b',mode:'subscription',subscription:subP1B,
      customer:'cus_abo_test',metadata:mP1},tP1-100);
    await webhook('invoice.paid',invP1('in_p1b',subP1B,endB,'pi_p1b'),tP1-90);
    const zugangVorP1=ein('SELECT gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=? AND quelle=\'abo\'',uid,kurs.id).gueltig_bis;
    pruefe('PUNKT-1 Vorbedingung: Abo B hat spaeteres Zugangsende gesetzt',
      zugangVorP1===endB*1000+172800000,'got:'+zugangVorP1+' want:'+(endB*1000+172800000));
    // customer.subscription.deleted fuer Abo A (spaetes Ereignis nach Abo-B-Zahlung)
    await webhook('customer.subscription.deleted',{id:subP1A},tP1+1);
    const zugangNachP1=ein('SELECT gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=? AND quelle=\'abo\'',uid,kurs.id).gueltig_bis;
    pruefe('PUNKT-1: Zugang von Abo B bleibt nach subscription.deleted von Abo A erhalten',
      zugangNachP1===endB*1000+172800000,'got:'+zugangNachP1+' want:'+(endB*1000+172800000));
  }
  const before=sql('SELECT COUNT(*) AS n FROM zugaenge')[0].n;
  webhookFehler=true;
  const sig=await webhook('customer.subscription.deleted',{id:subscription},t0+15);
  pruefe('Webhook-Signaturfehler abgewiesen',sig.s===400);
  pruefe('Abgewiesenes Ereignis ändert nichts',sql('SELECT COUNT(*) AS n FROM zugaenge')[0].n===before);
} catch(e) {
  schlecht++;console.error('FEHLER Testablauf:',e);
} finally {
  if(server) await new Promise(done=>server.close(done));
  try{rmSync(BASIS,{recursive:true,force:true});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
}
console.log('Abo: '+ok+' bestanden, '+schlecht+' fehlgeschlagen');
process.exitCode=schlecht?1:0;
