// F1/F2: Wer den Zugang eines Abos entzieht oder voll erstattet, beendet das Abo auch bei Stripe (sonst bucht Stripe weiter ab
// und der Kunde zahlt ohne Gegenleistung). Stripe-Attrappe, keine echten Schluessel.
import './test-sprache.mjs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const BASIS=mkdtempSync(join(tmpdir(),'schulung-abo-beenden-')), DATEI=join(BASIS,'beenden.db'), ORDNER=join(BASIS,'dateien');
const PORT=4450, BASE='http://127.0.0.1:'+PORT, PASS=randomBytes(24).toString('hex');
process.env.DB_DATEI=DATEI;
let ok=0, schlecht=0, server;
const pruefe=(n,g,d='')=>{g?ok++:schlecht++;console.log((g?'OK     ':'FEHLER ')+n+(!g?' '+String(d).slice(0,250):''));};
function sql(q,...v){const d=new DatabaseSync(DATEI);try{return d.prepare(q).all(...v);}finally{d.close();}}
function run(q,...v){const d=new DatabaseSync(DATEI);try{return d.prepare(q).run(...v);}finally{d.close();}}
const ein=(q,...v)=>sql(q,...v)[0];
function client(){
  let cookie='';
  return {async req(m,p,body){
    const r=await fetch(BASE+p,{method:m,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];
    let d={};try{d=JSON.parse(Buffer.from(await r.arrayBuffer()).toString());}catch{}
    return {s:r.status,d};
  }};
}
const cancelAufrufe=[]; let cancelFehler=false; const bereitsBeendet=new Set();
const perioden=new Map(); // Rechnungs-ID -> Periodenende (Sekunden)
const zahlungen=new Map(); // payment_intent -> Rechnungs-ID
const piKunde=new Map(); // payment_intent -> Stripe-Kunde (fuer paymentIntents.retrieve)
const subMeta=new Map(); // sub_... -> {metadata,customer} (wie Stripe: das Abo kennt die Metadaten, mit denen es angelegt wurde)
const refundListe=new Map(); // payment_intent -> Erstattungen laut Stripe (fuer refunds.list)
const stripe={
  customers:{create:async()=>({id:'cus_beenden'})},
  checkout:{sessions:{create:async()=>({id:'cs_test_beenden',url:'https://checkout.stripe.com/c/test'})}},
  billingPortal:{sessions:{create:async()=>({url:'https://billing.stripe.com/test'})}},
  subscriptions:{
    retrieve:async id=>({metadata:subMeta.get(id)?.metadata||{},customer:subMeta.get(id)?.customer||'cus_beenden',...(bereitsBeendet.has(id)?{status:'canceled'}:{})}),
    cancel:async id=>{cancelAufrufe.push(id);if(cancelFehler)throw Object.assign(new Error('stripe down'),{statusCode:503});return {id,status:'canceled'};},
  },
  paymentIntents:{retrieve:async id=>({id,customer:piKunde.get(id)||null})},
  invoices:{list:async()=>({data:[],has_more:false}),retrieve:async id=>({id,lines:{data:[{period:{end:perioden.get(id)||0}}]}})},
  invoicePayments:{list:async q=>{
    const pi=q?.payment?.payment_intent, inv=q?.invoice||zahlungen.get(pi);
    return {data:inv?[{status:'paid',invoice:inv,payment:{payment_intent:[...zahlungen.entries()].find(([,v])=>v===inv)?.[0]}}]:[]};
  }},
  refunds:{list:async q=>({data:refundListe.get(q?.payment_intent)||[],has_more:false})},
  webhooks:{constructEvent:buf=>JSON.parse(buf.toString())},
};
try {
  mkdirSync(ORDNER,{recursive:true});
  const {erstelleServer}=await import(pathToFileURL(resolve('app.mjs')).href);
  server=erstelleServer({stripe,webhookSecret:'stub',base:BASE,dateiOrdner:ORDNER}).listen(PORT,'127.0.0.1');
  await new Promise((yes,no)=>{if(server.listening)return yes();server.once('listening',yes);server.once('error',no);});
  const admin=client();
  const adminMail='beenden.admin@example.com';
  const start=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','tools/admin-anlegen.mjs',adminMail],
    {env:{...process.env,ADMIN_PASSWORT:PASS},encoding:'utf8'});
  pruefe('Admin angelegt',start.status===0,start.stderr);
  pruefe('Admin angemeldet',(await admin.req('POST','/api/anmelden',{email:adminMail,passwort:PASS})).s===200);
  const kurs=(await admin.req('POST','/api/admin/kurse',{titel:'Beenden',preis_cent:5990000,abo_preis_cent:990000,abo_intervall:'month'})).d;
  await admin.req('POST','/api/admin/kurse/'+kurs.id+'/veroeffentlichen',{});
  const t0=1761930000;
  let zaehler=0;
  const webhook=async(type,obj,created=t0)=>{
    const e={id:'evt_beenden_'+(++zaehler),type,created,livemode:false,data:{object:obj}};
    const r=await fetch(BASE+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'stub'},body:JSON.stringify(e)});
    return {s:r.status,d:await r.json().catch(()=>({})),id:e.id};
  };
  const bisZukunft=Math.floor(Date.now()/1000)+30*86400;
  let nr=0;
  // Legt Kunde + Abo + bezahlte Rechnungen an. rechnungen: [{id, ende}] in zeitlicher Reihenfolge.
  async function kundeMitAbo(rechnungen){
    nr++;
    const mail='beenden.kunde'+nr+'@example.com', c=client();
    await c.req('POST','/api/registrieren',{ zustimmung: true, email:mail,passwort:PASS});
    const uid=ein('SELECT id FROM benutzer WHERE email=?',mail).id;
    const cus='cus_beenden_'+nr; run('UPDATE benutzer SET stripe_kunde=? WHERE id=?',cus,uid);
    const subscription='sub_beenden_'+nr;
    await webhook('checkout.session.completed',{id:'cs_beenden_'+nr,mode:'subscription',subscription,customer:cus,
      metadata:{kurs_id:String(kurs.id),benutzer_id:String(uid),modell:'abo'},payment_status:'paid'});
    let z=0;
    for(const r of rechnungen){
      perioden.set(r.id,r.ende); zahlungen.set('pi_'+r.id,r.id);
      await webhook('invoice.paid',{id:r.id,subscription,customer:cus,amount_paid:990000,currency:'huf',payment_intent:'pi_'+r.id,
        lines:{data:[{period:{end:r.ende}}]}},t0+(++z));
    }
    return {uid,subscription,c,mail};
  }
  const aboStatus=s=>ein('SELECT status FROM abos WHERE stripe_abo=?',s)?.status;
  const zugangDa=(uid)=>ein('SELECT COUNT(*) AS n FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id).n===1;

  // ---- F1: Admin entzieht den Zugang eines Abo-Kunden ----
  const k1=await kundeMitAbo([{id:'in_f1_a',ende:bisZukunft}]);
  pruefe('F1 Aufbau: Abo aktiv, Zugang da',aboStatus(k1.subscription)==='aktiv'&&zugangDa(k1.uid));
  cancelAufrufe.length=0;
  const e1=await admin.req('DELETE','/api/admin/kurse/'+kurs.id+'/zugaenge/'+k1.uid);
  pruefe('F1: Entzug antwortet 200',e1.s===200,JSON.stringify(e1));
  pruefe('F1: Abo wurde bei Stripe beendet (subscriptions.cancel)',cancelAufrufe.includes(k1.subscription),JSON.stringify(cancelAufrufe));
  pruefe('F1: Zugang ist weg',!zugangDa(k1.uid));
  pruefe('F1: Abo in der App auf "beendet"',aboStatus(k1.subscription)==='beendet');
  // Das spaetere Stripe-Ereignis "Abo beendet" darf den Zugang nicht neu anlegen (G1) und nichts kaputt machen.
  const d1=await webhook('customer.subscription.deleted',{id:k1.subscription},t0+20);
  pruefe('F1: spaeteres subscription.deleted angenommen, Zugang bleibt weg',d1.s===200&&!zugangDa(k1.uid));

  // ---- F1: Stripe-Fehler -> nichts aendern, Admin bekommt Fehler ----
  const k2=await kundeMitAbo([{id:'in_f1_b',ende:bisZukunft}]);
  cancelFehler=true; cancelAufrufe.length=0;
  const e2=await admin.req('DELETE','/api/admin/kurse/'+kurs.id+'/zugaenge/'+k2.uid);
  pruefe('F1: Stripe-Fehler -> Antwort 502 statt Erfolg',e2.s===502,JSON.stringify(e2));
  pruefe('F1: Stripe-Fehler -> Zugang bleibt, Abo bleibt aktiv',zugangDa(k2.uid)&&aboStatus(k2.subscription)==='aktiv');
  cancelFehler=false;
  const e2b=await admin.req('DELETE','/api/admin/kurse/'+kurs.id+'/zugaenge/'+k2.uid);
  pruefe('F1: zweiter Versuch ohne Stripe-Fehler klappt',e2b.s===200&&!zugangDa(k2.uid)&&aboStatus(k2.subscription)==='beendet');

  // ---- F1: Zugang ohne Abo (Einladung): kein Stripe-Aufruf ----
  nr++;
  const mailE='beenden.einladung@example.com';
  await client().req('POST','/api/registrieren',{ zustimmung: true, email:mailE,passwort:PASS});
  const uE=ein('SELECT id FROM benutzer WHERE email=?',mailE).id;
  const g=await admin.req('POST','/api/admin/kurse/'+kurs.id+'/zugaenge',{email:mailE});
  pruefe('F1 Aufbau: Einladung gegeben',g.s===201,JSON.stringify(g));
  cancelAufrufe.length=0;
  const eE=await admin.req('DELETE','/api/admin/kurse/'+kurs.id+'/zugaenge/'+uE);
  pruefe('F1: Entzug ohne Abo klappt ohne Stripe-Aufruf',eE.s===200&&cancelAufrufe.length===0&&!zugangDa(uE),JSON.stringify(eE));
  // ---- F2: volle Erstattung der LETZTEN Abo-Rechnung (z. B. im Stripe-Dashboard) ----
  const charge=(rechnung,voll=true)=>({id:'ch_'+rechnung,payment_intent:'pi_'+rechnung,refunded:voll,amount:990000,amount_refunded:voll?990000:100000,
    currency:'huf',refunds:{data:[{id:'re_'+rechnung,status:'succeeded',amount:voll?990000:100000}]}});
  const gueltigBis=uid=>ein("SELECT gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=? AND quelle='abo'",uid,kurs.id)?.gueltig_bis;
  const zugangOffen=uid=>{const g=gueltigBis(uid);return g!==undefined&&(g===null||g>Date.now());};
  const bestStatus=r=>ein('SELECT status FROM bestellungen WHERE stripe_sitzung=?',r)?.status;
  const k3=await kundeMitAbo([{id:'in_f2_a',ende:bisZukunft-30*86400},{id:'in_f2_b',ende:bisZukunft}]);
  pruefe('F2 Aufbau: zwei bezahlte Monate, Zugang offen',bestStatus('in_f2_a')==='bezahlt'&&bestStatus('in_f2_b')==='bezahlt'&&zugangOffen(k3.uid));
  cancelAufrufe.length=0;
  const r3=await webhook('charge.refunded',charge('in_f2_b'));
  pruefe('F2: Erstattung angenommen',r3.s===200,JSON.stringify(r3));
  pruefe('F2: letzter Monat steht auf erstattet',bestStatus('in_f2_b')==='erstattet');
  pruefe('F2: Abo wurde bei Stripe beendet',cancelAufrufe.includes(k3.subscription),JSON.stringify(cancelAufrufe));
  pruefe('F2: Zugang ist trotz frueherem bezahlten Monat nicht mehr offen',!zugangOffen(k3.uid),String(gueltigBis(k3.uid)));
  pruefe('F2: Abo in der App auf "beendet"',aboStatus(k3.subscription)==='beendet');
  // Das Stripe-Ereignis 'Abo beendet' kommt NACH der Erstattung (wir haben das Abo ja beendet) und darf den Zugang nicht wieder oeffnen.
  const d3=await webhook('customer.subscription.deleted',{id:k3.subscription},t0+60);
  pruefe('F2: spaeteres subscription.deleted oeffnet den Zugang nach der Erstattung NICHT wieder',d3.s===200&&!zugangOffen(k3.uid),String(gueltigBis(k3.uid)));
  // Der alte Monat ist erstattet UND das Abo noch aktiv: eine ALTE Rechnung zu erstatten beendet das Abo nicht.
  const k4=await kundeMitAbo([{id:'in_f2_c',ende:bisZukunft-30*86400},{id:'in_f2_d',ende:bisZukunft}]);
  cancelAufrufe.length=0;
  const r4=await webhook('charge.refunded',charge('in_f2_c'));
  pruefe('F2: Erstattung einer ALTEN Rechnung: kein Stripe-Abbruch, Abo bleibt aktiv, Zugang bleibt',
    r4.s===200&&cancelAufrufe.length===0&&aboStatus(k4.subscription)==='aktiv'&&zugangOffen(k4.uid),JSON.stringify([r4.s,cancelAufrufe,aboStatus(k4.subscription)]));
  // Teilerstattung beendet nichts.
  const k6=await kundeMitAbo([{id:'in_f2_g',ende:bisZukunft}]);
  cancelAufrufe.length=0;
  const r6=await webhook('charge.refunded',charge('in_f2_g',false));
  pruefe('F2: Teilerstattung beendet das Abo nicht',r6.s===200&&cancelAufrufe.length===0&&aboStatus(k6.subscription)==='aktiv'&&zugangOffen(k6.uid));
  // Halber Erfolg: das Abo ist bei Stripe schon beendet (Wiederholung): kein zweiter Kuendigungsversuch, Buchung klappt trotzdem.
  const k7=await kundeMitAbo([{id:'in_f2_h',ende:bisZukunft}]);
  bereitsBeendet.add(k7.subscription); cancelAufrufe.length=0;
  const r7=await webhook('charge.refunded',charge('in_f2_h'));
  pruefe('F2: Abo bei Stripe schon beendet -> kein zweiter Aufruf, Buchung klappt',r7.s===200&&!cancelAufrufe.includes(k7.subscription)&&bestStatus('in_f2_h')==='erstattet'&&!zugangOffen(k7.uid)&&aboStatus(k7.subscription)==='beendet',JSON.stringify([r7.s,cancelAufrufe]));
  // Stripe-Fehler beim Beenden: 500 an Stripe (Wiederholung), nichts gebucht; nach dem Retry mit DERSELBEN Ereignis-ID klappt alles.
  const k5=await kundeMitAbo([{id:'in_f2_e',ende:bisZukunft}]);
  cancelFehler=true; cancelAufrufe.length=0;
  const fest={id:'evt_beenden_fest',type:'charge.refunded',created:t0+50,livemode:false,data:{object:charge('in_f2_e')}};
  const senden=async()=>{const r=await fetch(BASE+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'stub'},body:JSON.stringify(fest)});return {s:r.status,d:await r.json().catch(()=>({}))};};
  const f1=await senden();
  pruefe('F2: Stripe-Fehler -> Webhook antwortet 500 (Stripe wiederholt)',f1.s===500,JSON.stringify(f1));
  pruefe('F2: Stripe-Fehler -> nichts gebucht (Bestellung bezahlt, Zugang offen, Abo aktiv)',bestStatus('in_f2_e')==='bezahlt'&&zugangOffen(k5.uid)&&aboStatus(k5.subscription)==='aktiv');
  cancelFehler=false;
  const f2=await senden();
  pruefe('F2: Wiederholung desselben Ereignisses klappt (nicht als Doppel verworfen)',f2.s===200&&f2.d.doppelt===false,JSON.stringify(f2));
  pruefe('F2: danach erstattet, Abo bei Stripe beendet, Zugang weg, Abo beendet',bestStatus('in_f2_e')==='erstattet'&&cancelAufrufe.includes(k5.subscription)&&!zugangOffen(k5.uid)&&aboStatus(k5.subscription)==='beendet');
  const vorher=cancelAufrufe.length;
  const f3=await senden();
  pruefe('F2: dritte Zustellung ist ein Doppel und beendet nichts erneut',f3.s===200&&f3.d.doppelt===true&&cancelAufrufe.length===vorher,JSON.stringify([f3,vorher,cancelAufrufe.length]));

  // ---- H5/F8: Zahlung nach beendetem Abo (Stripe garantiert keine Reihenfolge, oder Stripe bucht nach Entzug noch einmal ab) ----
  // Es darf KEIN Zugang entstehen; das Geld ist aber da: Bestellung auf "pruefen" und Meldung an die Inhaberin.
  const gekauftPruefen=()=>ein("SELECT COUNT(*) AS n FROM ereignisse WHERE typ IN ('gekauft','abo_gestartet') AND status='pruefen'").n;
  const neuerRechnung=async(k,id,ende,created)=>{perioden.set(id,ende);zahlungen.set('pi_'+id,id);
    return webhook('invoice.paid',{id,subscription:k.subscription,customer:'cus_beenden_'+(k.nr),amount_paid:990000,currency:'huf',payment_intent:'pi_'+id,
      lines:{data:[{period:{end:ende}}]}},created);};
  // (a) Abo war schon bezahlt, Admin entzieht, danach kommt noch eine NEUE Rechnung
  const h5a=await kundeMitAbo([{id:'in_h5_a',ende:bisZukunft}]); h5a.nr=nr;
  await admin.req('DELETE','/api/admin/kurse/'+kurs.id+'/zugaenge/'+h5a.uid);
  const h5v1=gekauftPruefen();
  await neuerRechnung(h5a,'in_h5_neu',bisZukunft+30*86400,t0+100);
  pruefe('H5 (a): Zahlung nach Entzug gibt keinen Zugang',!zugangDa(h5a.uid));
  pruefe('H5 (a): Abo bleibt beendet',aboStatus(h5a.subscription)==='beendet');
  pruefe('H5 (a): Bestellung steht auf "pruefen"',bestStatus('in_h5_neu')==='pruefen');
  pruefe('H5 (a): Meldung "gekauft/pruefen" an die Inhaberin',gekauftPruefen()===h5v1+1,gekauftPruefen()+' statt '+(h5v1+1));
  // (b) erste Rechnung kommt NACH dem Beenden (verspaetetes Ereignis)
  const h5b=await kundeMitAbo([]); h5b.nr=nr;
  await webhook('customer.subscription.deleted',{id:h5b.subscription},t0+200);
  pruefe('H5 (b) Aufbau: Abo beendet ohne bezahlte Rechnung',aboStatus(h5b.subscription)==='beendet');
  const h5v2=gekauftPruefen();
  await neuerRechnung(h5b,'in_h5_spaet',bisZukunft,t0+150);
  pruefe('H5 (b): verspaetete erste Rechnung gibt keinen Zugang',!zugangDa(h5b.uid));
  pruefe('H5 (b): Bestellung "pruefen", Meldung gesendet',bestStatus('in_h5_spaet')==='pruefen'&&gekauftPruefen()===h5v2+1);
  // (c) dasselbe Ereignis zweimal: keine zweite Meldung
  const h5v3=gekauftPruefen();
  await neuerRechnung(h5b,'in_h5_spaet',bisZukunft,t0+150);
  pruefe('H5 (c): Wiederholung meldet nicht doppelt',gekauftPruefen()===h5v3);
  // (d) ein ZWEITES Ereignis zur schon bekannten letzten Rechnung (gleiches Periodenende) darf nach dem Entzug den Zugang nicht neu anlegen
  await neuerRechnung(h5a,'in_h5_a',bisZukunft,t0+300);
  pruefe('H5 (d): erneutes Ereignis zur bekannten Rechnung legt keinen Zugang an',!zugangDa(h5a.uid)&&bestStatus('in_h5_a')==='bezahlt');
  // (e) Erstattung des letzten Monats, dann verspaetete neue Rechnung ('pruefen'), dann subscription.deleted: Zugang bleibt zu
  const h5c=await kundeMitAbo([{id:'in_h5_x1',ende:bisZukunft-30*86400},{id:'in_h5_x2',ende:bisZukunft}]); h5c.nr=nr;
  await webhook('charge.refunded',charge('in_h5_x2'),t0+400);
  pruefe('H5 (e) Aufbau: erstattet, Zugang zu, Abo beendet',bestStatus('in_h5_x2')==='erstattet'&&!zugangOffen(h5c.uid)&&aboStatus(h5c.subscription)==='beendet');
  await neuerRechnung(h5c,'in_h5_x3',bisZukunft+30*86400,t0+410);
  await webhook('customer.subscription.deleted',{id:h5c.subscription},t0+420);
  pruefe('H5 (e): pruefen-Bestellung oeffnet den erstatteten Zugang beim Abo-Ende NICHT',!zugangOffen(h5c.uid)&&bestStatus('in_h5_x3')==='pruefen',String(gueltigBis(h5c.uid)));

  // ---- U2/I5: JEDER Weg, der einen Abo-Zugang dauerhaft macht oder eine Abo-Zahlung ablehnt, beendet das Abo auch bei Stripe ----
  const quelle=uid=>ein('SELECT quelle FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,kurs.id)?.quelle;
  // (1) Einladung bei laufendem Abo
  const u1=await kundeMitAbo([{id:'in_u2_a',ende:bisZukunft}]);
  cancelAufrufe.length=0;
  const i1=await admin.req('POST','/api/admin/kurse/'+kurs.id+'/zugaenge',{email:u1.mail});
  pruefe('U2 Einladung: 201, Zugang jetzt Einladung',i1.s===201&&quelle(u1.uid)==='einladung',JSON.stringify(i1));
  pruefe('U2 Einladung: laufendes Abo wurde bei Stripe beendet, in der App beendet',cancelAufrufe.includes(u1.subscription)&&aboStatus(u1.subscription)==='beendet',JSON.stringify(cancelAufrufe));
  // (2) Einladung, Stripe-Fehler: nichts aendern
  const u2=await kundeMitAbo([{id:'in_u2_b',ende:bisZukunft}]);
  cancelFehler=true; cancelAufrufe.length=0;
  const i2=await admin.req('POST','/api/admin/kurse/'+kurs.id+'/zugaenge',{email:u2.mail});
  pruefe('U2 Einladung bei Stripe-Fehler: 502, Zugang bleibt Abo-Zugang, Abo aktiv',i2.s===502&&quelle(u2.uid)==='abo'&&aboStatus(u2.subscription)==='aktiv',JSON.stringify(i2));
  cancelFehler=false;
  const i2b=await admin.req('POST','/api/admin/kurse/'+kurs.id+'/zugaenge',{email:u2.mail});
  pruefe('U2 Einladung: zweiter Versuch klappt',i2b.s===201&&aboStatus(u2.subscription)==='beendet'&&quelle(u2.uid)==='einladung',JSON.stringify(i2b));
  // (3) Einladung ohne Abo: kein Stripe-Aufruf (Regression)
  nr++; const mailU3='beenden.u2einl'+nr+'@example.com'; await client().req('POST','/api/registrieren',{ zustimmung: true, email:mailU3,passwort:PASS});
  cancelAufrufe.length=0;
  const i3=await admin.req('POST','/api/admin/kurse/'+kurs.id+'/zugaenge',{email:mailU3});
  pruefe('U2 Einladung ohne Abo: 201 ohne Stripe-Aufruf',i3.s===201&&cancelAufrufe.length===0);
  // (4) Freigabe einer Einmal-Pruefbestellung bei laufendem Abo
  const u4=await kundeMitAbo([{id:'in_u2_d',ende:bisZukunft}]);
  const bestId=(sitzung,art,uid)=>{run("INSERT INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,grund,art,erstellt,geaendert) VALUES (?,?,?,?,?,?,'pruefen','betrag_waehrung',?,?,?)",
    sitzung,'pi_'+sitzung,uid,kurs.id,5990000,'huf',art,new Date().toISOString(),new Date().toISOString());return ein('SELECT id FROM bestellungen WHERE stripe_sitzung=?',sitzung).id;};
  const b4=bestId('cs_u2_frei','einmal',u4.uid);
  cancelAufrufe.length=0;
  const f4=await admin.req('POST','/api/admin/bestellungen/'+b4+'/freigeben',{});
  pruefe('U2 Freigabe: 200, Zugang dauerhaft (zahlung), Abo bei Stripe beendet',f4.s===200&&quelle(u4.uid)==='zahlung'&&cancelAufrufe.includes(u4.subscription)&&aboStatus(u4.subscription)==='beendet',JSON.stringify(f4));
  const u5=await kundeMitAbo([{id:'in_u2_e',ende:bisZukunft}]);
  const b5=bestId('cs_u2_frei2','einmal',u5.uid);
  cancelFehler=true; cancelAufrufe.length=0;
  const f5=await admin.req('POST','/api/admin/bestellungen/'+b5+'/freigeben',{});
  pruefe('U2 Freigabe bei Stripe-Fehler: 502, Bestellung bleibt pruefen, Abo aktiv',f5.s===502&&bestStatus('cs_u2_frei2')==='pruefen'&&aboStatus(u5.subscription)==='aktiv',JSON.stringify(f5));
  cancelFehler=false;
  // (5) Ablehnen einer Abo-Pruefbestellung beendet das Abo bei Stripe
  const u6=await kundeMitAbo([]);
  const b6=bestId('in_u2_abl','abo',u6.uid);
  cancelAufrufe.length=0;
  const a6=await admin.req('POST','/api/admin/bestellungen/'+b6+'/ablehnen',{});
  pruefe('U2 Ablehnen Abo-Zahlung: 200, abgelehnt, Abo bei Stripe beendet, in der App beendet',a6.s===200&&bestStatus('in_u2_abl')==='abgelehnt'&&cancelAufrufe.includes(u6.subscription)&&aboStatus(u6.subscription)==='beendet',JSON.stringify(a6));
  const u7=await kundeMitAbo([]);
  const b7=bestId('in_u2_abl2','abo',u7.uid);
  cancelFehler=true;
  const a7=await admin.req('POST','/api/admin/bestellungen/'+b7+'/ablehnen',{});
  pruefe('U2 Ablehnen bei Stripe-Fehler: 502, Bestellung bleibt pruefen',a7.s===502&&bestStatus('in_u2_abl2')==='pruefen',JSON.stringify(a7));
  cancelFehler=false;
  // (6) Ablehnen einer Einmal-Pruefbestellung: kein Stripe-Aufruf (Regression)
  nr++; const mailU8='beenden.u2abl'+nr+'@example.com'; await client().req('POST','/api/registrieren',{ zustimmung: true, email:mailU8,passwort:PASS});
  const uid8=ein('SELECT id FROM benutzer WHERE email=?',mailU8).id; const b8=bestId('cs_u2_abl3','einmal',uid8);
  cancelAufrufe.length=0;
  const a8=await admin.req('POST','/api/admin/bestellungen/'+b8+'/ablehnen',{});
  pruefe('U2 Ablehnen Einmalzahlung: 200 ohne Stripe-Aufruf',a8.s===200&&cancelAufrufe.length===0&&bestStatus('cs_u2_abl3')==='abgelehnt',JSON.stringify(a8));

  // ---- Batch 2: U3 Meldung, N3 robuste Preispruefung, N1 Gratis-Kurs ohne Abo, M2 Erstattung Pruef-Abo, N5 Erstattung vor Kauf ----
  const aboPruefenMeldungen=()=>ein("SELECT COUNT(*) AS n FROM ereignisse WHERE typ='abo_gestartet' AND status='pruefen'").n;
  const rechnung=async(k,id,betrag,ende,created,waehr='huf')=>{perioden.set(id,ende);zahlungen.set('pi_'+id,id);
    return webhook('invoice.paid',{id,subscription:k.subscription,customer:'cus_beenden_'+k.nr,amount_paid:betrag,currency:waehr,payment_intent:'pi_'+id,
      lines:{data:[{period:{end:ende}}]}},created);};
  // U3: falscher Betrag bei einer Abo-Rechnung -> Pruefen UND Meldung an die Inhaberin (genau einmal)
  const m1=await kundeMitAbo([]); m1.nr=nr;
  const mv=aboPruefenMeldungen();
  await rechnung(m1,'in_b2_falsch',1230,bisZukunft,t0+500);
  pruefe('U3: falscher Betrag -> Bestellung pruefen, kein Zugang',bestStatus('in_b2_falsch')==='pruefen'&&!zugangDa(m1.uid));
  pruefe('U3: Meldung (abo_gestartet/pruefen) genau einmal',aboPruefenMeldungen()===mv+1,aboPruefenMeldungen()+' statt '+(mv+1));
  await rechnung(m1,'in_b2_falsch',1230,bisZukunft,t0+501);
  pruefe('U3: Wiederholung meldet nicht doppelt',aboPruefenMeldungen()===mv+1);
  // N3: Kurs-Abo wird abgeschaltet / Waehrung geaendert, laufender Abonnent mit gleichem Betrag bezahlt weiter -> bleibt gueltig (kein stilles Pruefen)
  const n3=await kundeMitAbo([{id:'in_b2_n3a',ende:bisZukunft-30*86400}]); n3.nr=nr;
  run('UPDATE kurse SET abo_preis_cent=NULL, abo_intervall=NULL WHERE id=?',kurs.id);
  await rechnung(n3,'in_b2_n3b',990000,bisZukunft,t0+510);
  pruefe('N3: Abo-Angebot abgeschaltet, laufender Abonnent zahlt weiter -> bezahlt, Zugang bis neues Periodenende',bestStatus('in_b2_n3b')==='bezahlt'&&zugangOffen(n3.uid),bestStatus('in_b2_n3b'));
  run("UPDATE kurse SET abo_preis_cent=990000, abo_intervall='month' WHERE id=?",kurs.id);
  const n3w=await kundeMitAbo([{id:'in_b2_n3c',ende:bisZukunft-30*86400}]); n3w.nr=nr;
  run("UPDATE kurse SET waehrung='eur' WHERE id=?",kurs.id);
  await rechnung(n3w,'in_b2_n3d',990000,bisZukunft,t0+520);
  pruefe('N3: Kurswaehrung geaendert, laufender Abonnent (alte Waehrung) -> bezahlt',bestStatus('in_b2_n3d')==='bezahlt'&&zugangOffen(n3w.uid),bestStatus('in_b2_n3d'));
  run("UPDATE kurse SET waehrung='huf' WHERE id=?",kurs.id);
  // N3 Gegenprobe: Neukunde mit falschem Betrag bleibt pruefen
  const n3g=await kundeMitAbo([]); n3g.nr=nr;
  run('UPDATE kurse SET abo_preis_cent=NULL, abo_intervall=NULL WHERE id=?',kurs.id);
  await rechnung(n3g,'in_b2_n3e',990000,bisZukunft,t0+530);
  pruefe('N3 Gegenprobe: Neukunde bei abgeschaltetem Abo bleibt pruefen',bestStatus('in_b2_n3e')==='pruefen'&&!zugangDa(n3g.uid));
  run("UPDATE kurse SET abo_preis_cent=990000, abo_intervall='month' WHERE id=?",kurs.id);
  // M2: volle Erstattung einer Pruef-Abo-Rechnung beendet das Abo bei Stripe, Bestellung erstattet
  const m2=await kundeMitAbo([]); m2.nr=nr;
  await rechnung(m2,'in_b2_m2',1230,bisZukunft,t0+540);
  cancelAufrufe.length=0;
  const rm2=await webhook('charge.refunded',{id:'ch_in_b2_m2',payment_intent:'pi_in_b2_m2',refunded:true,amount:1230,amount_refunded:1230,currency:'huf',
    refunds:{data:[{id:'re_b2_m2',status:'succeeded',amount:1230}]}},t0+541);
  pruefe('M2: Erstattung angenommen',rm2.s===200,JSON.stringify(rm2));
  pruefe('M2: Pruef-Bestellung steht auf erstattet, Abo bei Stripe beendet, in der App beendet',bestStatus('in_b2_m2')==='erstattet'&&cancelAufrufe.includes(m2.subscription)&&aboStatus(m2.subscription)==='beendet',bestStatus('in_b2_m2')+' '+JSON.stringify(cancelAufrufe));
  // N5: Erstattung kommt VOR dem Kauf-Ereignis (Einmalkauf): kein Zugang, Bestellung erstattet
  const einmalKauf=async(tag,erstattet)=>{
    nr++; const mail='beenden.n5'+tag+nr+'@example.com', c=client(); await c.req('POST','/api/registrieren',{ zustimmung: true, email:mail,passwort:PASS});
    const uid=ein('SELECT id FROM benutzer WHERE email=?',mail).id, cus='cus_n5_'+tag+nr; run('UPDATE benutzer SET stripe_kunde=? WHERE id=?',cus,uid);
    if(erstattet)refundListe.set('pi_n5_'+tag+nr,[{id:'re_n5_'+tag+nr,status:'succeeded',amount:erstattet}]);
    await webhook('checkout.session.completed',{id:'cs_n5_'+tag+nr,mode:'payment',customer:cus,payment_intent:'pi_n5_'+tag+nr,payment_status:'paid',
      amount_total:5990000,currency:'huf',metadata:{kurs_id:String(kurs.id),benutzer_id:String(uid)}},t0+600+nr);
    return {uid,sitz:'cs_n5_'+tag+nr};
  };
  const n5a=await einmalKauf('voll',5990000);
  pruefe('N5: schon voll erstattet beim Eintreffen des Kaufs -> erstattet, KEIN Zugang',bestStatus(n5a.sitz)==='erstattet'&&!zugangDa(n5a.uid),bestStatus(n5a.sitz)+' zugang='+zugangDa(n5a.uid));
  const n5b=await einmalKauf('teil',100000);
  pruefe('N5: nur teilweise erstattet -> normaler Kauf mit Zugang (Regression)',bestStatus(n5b.sitz)==='bezahlt'&&zugangDa(n5b.uid),bestStatus(n5b.sitz));
  const n5c=await einmalKauf('keine',0);
  pruefe('N5: keine Erstattung -> normaler Kauf mit Zugang (Regression)',bestStatus(n5c.sitz)==='bezahlt'&&zugangDa(n5c.uid),bestStatus(n5c.sitz));
  // Agentenfund 1: Ablehnen/Erstatten einer ALTEN Pruef-Rechnung darf ein NEUES, korrekt laufendes Abo desselben Kunden nicht beenden
  const ag=await kundeMitAbo([{id:'in_ag_a',ende:bisZukunft}]); ag.nr=nr;
  await admin.req('DELETE','/api/admin/kurse/'+kurs.id+'/zugaenge/'+ag.uid);               // Abo A beendet
  await rechnung(ag,'in_ag_spaet',990000,bisZukunft+30*86400,t0+700);                       // verspaetete Rechnung von A -> pruefen
  await new Promise(r=>setTimeout(r,20));
  const cusAg='cus_beenden_'+ag.nr;
  await webhook('checkout.session.completed',{id:'cs_ag_b',mode:'subscription',subscription:'sub_ag_b',customer:cusAg,
    metadata:{kurs_id:String(kurs.id),benutzer_id:String(ag.uid),modell:'abo'},payment_status:'paid'},t0+710);
  perioden.set('in_ag_b',bisZukunft+60*86400); zahlungen.set('pi_in_ag_b','in_ag_b');
  await webhook('invoice.paid',{id:'in_ag_b',subscription:'sub_ag_b',customer:cusAg,amount_paid:990000,currency:'huf',payment_intent:'pi_in_ag_b',
    lines:{data:[{period:{end:bisZukunft+60*86400}}]}},t0+711);
  pruefe('Agentenfund 1 Aufbau: Abo B laeuft, alte Rechnung steht auf pruefen',aboStatus('sub_ag_b')==='aktiv'&&bestStatus('in_ag_spaet')==='pruefen',aboStatus('sub_ag_b')+' '+bestStatus('in_ag_spaet'));
  cancelAufrufe.length=0;
  const agAbl=await admin.req('POST','/api/admin/bestellungen/'+ein('SELECT id FROM bestellungen WHERE stripe_sitzung=?','in_ag_spaet').id+'/ablehnen',{});
  pruefe('Agentenfund 1: Ablehnen der alten Rechnung laesst das neue Abo B unberuehrt',agAbl.s===200&&!cancelAufrufe.includes('sub_ag_b')&&aboStatus('sub_ag_b')==='aktiv',JSON.stringify([agAbl.s,cancelAufrufe,aboStatus('sub_ag_b')]));
  // Agentenfund 1 (Erstattung): dasselbe bei voller Erstattung der alten Pruef-Rechnung
  await rechnung(ag,'in_ag_spaet2',990000,bisZukunft+31*86400,t0+720);
  cancelAufrufe.length=0;
  await webhook('charge.refunded',{id:'ch_ag2',payment_intent:'pi_in_ag_spaet2',refunded:true,amount:990000,amount_refunded:990000,currency:'huf',
    refunds:{data:[{id:'re_ag2',status:'succeeded',amount:990000}]}},t0+721);
  pruefe('Agentenfund 1: Erstattung der alten Pruef-Rechnung laesst Abo B unberuehrt',bestStatus('in_ag_spaet2')==='erstattet'&&!cancelAufrufe.includes('sub_ag_b')&&aboStatus('sub_ag_b')==='aktiv',JSON.stringify([bestStatus('in_ag_spaet2'),cancelAufrufe,aboStatus('sub_ag_b')]));
  // Agentenfund 3: eine erstattete Pruef-Zahlung zaehlt nicht als "schon bezahlter Betrag"
  const ag3=await kundeMitAbo([]); ag3.nr=nr;
  await rechnung(ag3,'in_ag3_x',777000,bisZukunft,t0+730);
  await webhook('charge.refunded',{id:'ch_ag3',payment_intent:'pi_in_ag3_x',refunded:true,amount:777000,amount_refunded:777000,currency:'huf',
    refunds:{data:[{id:'re_ag3',status:'succeeded',amount:777000}]}},t0+731);
  await webhook('customer.subscription.deleted',{id:ag3.subscription},t0+732);
  const ag3b=await kundeMitAbo([]); // anderes Abo, gleicher Betrag darf NICHT als bezahlt gelten (anderer Kunde): Gegenprobe ueber denselben Kunden
  pruefe('Agentenfund 3: erstattete Pruef-Bestellung bleibt "betrag_waehrung" (nicht als bezahlt gewertet)',ein('SELECT grund FROM bestellungen WHERE stripe_sitzung=?','in_ag3_x')?.grund==='betrag_waehrung',ein('SELECT grund FROM bestellungen WHERE stripe_sitzung=?','in_ag3_x')?.grund);
  // N1: Gratis-Kurs (Preis 0) darf kein Abo haben; sonst gaebe 'einmal' dem Kunden den Abo-Kurs umsonst
  const g1=await admin.req('POST','/api/admin/kurse',{titel:'GratisAbo',preis_cent:0,abo_preis_cent:990000,abo_intervall:'month'});
  pruefe('N1: neuer Kurs Preis 0 + Abo -> 400',g1.s===400&&g1.d.fehler==='gratis_ohne_abo',JSON.stringify(g1));
  const g2=await admin.req('POST','/api/admin/kurse',{titel:'Gratis',preis_cent:0});
  pruefe('N1: neuer Gratis-Kurs ohne Abo bleibt moeglich (201)',g2.s===201,JSON.stringify(g2));
  const g3=await admin.req('PATCH','/api/admin/kurse/'+g2.d.id,{abo_preis_cent:990000,abo_intervall:'month'});
  pruefe('N1: Gratis-Kurs nachtraeglich mit Abo -> 400',g3.s===400&&g3.d.fehler==='gratis_ohne_abo',JSON.stringify(g3));
  const g4=await admin.req('PATCH','/api/admin/kurse/'+kurs.id,{preis_cent:0});
  pruefe('N1: Kurs mit Abo auf Preis 0 setzen -> 400',g4.s===400&&g4.d.fehler==='gratis_ohne_abo',JSON.stringify(g4));
  // Abwehr im Kauf selbst, falls ein solcher Kurs trotzdem existiert (alte Daten)
  run('UPDATE kurse SET preis_cent=0 WHERE id=?',kurs.id);
  nr++; const gm='beenden.n1kauf'+nr+'@example.com', gc=client(); await gc.req('POST','/api/registrieren',{ zustimmung: true, email:gm,passwort:PASS}); await gc.req('POST','/api/anmelden',{email:gm,passwort:PASS});
  const gk=await gc.req('POST','/api/kurse/'+kurs.id+'/kaufen',{modell:'einmal'});
  const gId=ein('SELECT id FROM benutzer WHERE email=?',gm).id;
  pruefe('N1: Kauf "einmal" bei Preis 0 + Abo gibt KEINEN Gratis-Zugang',gk.s!==200&&!zugangDa(gId),JSON.stringify(gk));
  run('UPDATE kurse SET preis_cent=5990000 WHERE id=?',kurs.id);

  // ---- Batch 3 (U4): Ereignistypen, die Stripe schickt und die wir behandeln muessen ----
  const meld=st=>ein("SELECT COUNT(*) AS n FROM ereignisse WHERE typ='gekauft' AND status=?",st).n;
  const orderGrund=s=>ein('SELECT grund FROM bestellungen WHERE stripe_sitzung=?',s)?.grund;
  // (a) Streitfall (Chargeback) bei Einmalkauf: Bestellung pruefen/streitfall, Zugang weg, Meldung genau einmal; Freigabe stellt den Zugang wieder her
  const s1=await einmalKauf('streit',0);
  const piS1='pi_n5_streit'+nr;
  pruefe('Streitfall Aufbau: Kauf bezahlt, Zugang da',bestStatus(s1.sitz)==='bezahlt'&&zugangDa(s1.uid));
  const dm=meld('streitfall');
  const dispute=(id,pi,status='needs_response')=>({id,charge:'ch_'+id,payment_intent:pi,amount:5990000,currency:'huf',status,reason:'fraudulent'});
  const ds1=await webhook('charge.dispute.created',dispute('dp_s1',piS1),t0+800);
  pruefe('Streitfall: Webhook 200',ds1.s===200,JSON.stringify(ds1));
  pruefe('Streitfall: Bestellung pruefen/streitfall, Zugang entzogen',bestStatus(s1.sitz)==='pruefen'&&orderGrund(s1.sitz)==='streitfall'&&!zugangDa(s1.uid),bestStatus(s1.sitz)+' '+orderGrund(s1.sitz));
  pruefe('Streitfall: Meldung an die Inhaberin genau einmal',meld('streitfall')===dm+1);
  await webhook('charge.dispute.created',dispute('dp_s1',piS1),t0+801);
  pruefe('Streitfall: zweites Ereignis zum selben Streit meldet nicht doppelt',meld('streitfall')===dm+1);
  const fr=await admin.req('POST','/api/admin/bestellungen/'+ein('SELECT id FROM bestellungen WHERE stripe_sitzung=?',s1.sitz).id+'/freigeben',{});
  pruefe('Streitfall gewonnen: Admin-Freigabe stellt den Zugang wieder her',fr.s===200&&zugangDa(s1.uid)&&bestStatus(s1.sitz)==='bezahlt',JSON.stringify(fr));
  // (b) Streitfall bei Abo-Zahlung: Abo bei Stripe beenden, Zugang weg
  const s2=await kundeMitAbo([{id:'in_b3_d',ende:bisZukunft}]); s2.nr=nr;
  cancelAufrufe.length=0;
  await webhook('charge.dispute.created',dispute('dp_s2','pi_in_b3_d'),t0+810);
  pruefe('Streitfall Abo: Bestellung pruefen, Abo bei Stripe beendet, App-Abo beendet, Zugang weg',
    bestStatus('in_b3_d')==='pruefen'&&cancelAufrufe.includes(s2.subscription)&&aboStatus(s2.subscription)==='beendet'&&!zugangDa(s2.uid),bestStatus('in_b3_d')+' '+JSON.stringify(cancelAufrufe));
  // (c) Streitfall bei Stripe-Fehler: 500 (Stripe wiederholt), nichts gebucht
  const s3=await kundeMitAbo([{id:'in_b3_e',ende:bisZukunft}]); s3.nr=nr;
  cancelFehler=true;
  const ds3=await webhook('charge.dispute.created',dispute('dp_s3','pi_in_b3_e'),t0+820);
  pruefe('Streitfall Abo bei Stripe-Fehler: 500, nichts gebucht',ds3.s===500&&bestStatus('in_b3_e')==='bezahlt'&&zugangDa(s3.uid)&&aboStatus(s3.subscription)==='aktiv',JSON.stringify(ds3));
  cancelFehler=false;
  // (d) unbekannte Zahlung: trotzdem Meldung, 200
  const dm2=meld('streitfall');
  const ds4=await webhook('charge.dispute.created',dispute('dp_s4','pi_unbekannt_xyz'),t0+830);
  pruefe('Streitfall zu unbekannter Zahlung: 200 und Meldung',ds4.s===200&&meld('streitfall')===dm2+1,JSON.stringify(ds4));
  // (e) Streit beendet: gewonnen/verloren nur Meldung (gewonnen aendert nichts am Zugang)
  const dg=meld('streit_gewonnen'), dv=meld('streit_verloren');
  await webhook('charge.dispute.closed',dispute('dp_s1',piS1,'won'),t0+840);
  pruefe('Streit gewonnen: nur Meldung',meld('streit_gewonnen')===dg+1&&bestStatus(s1.sitz)==='bezahlt'&&zugangDa(s1.uid));
  const s5=await einmalKauf('verl',0); const piS5='pi_n5_verl'+nr;
  await webhook('charge.dispute.closed',dispute('dp_s5',piS5,'lost'),t0+850);
  pruefe('Streit verloren (ohne vorheriges created): Zugang entzogen, Meldung',meld('streit_verloren')===dv+1&&!zugangDa(s5.uid)&&bestStatus(s5.sitz)==='pruefen');
  // (f) Erstattung fehlgeschlagen: nur Meldung, einmal je Erstattung; erfolgreiches Update meldet nichts
  const fm=meld('erstattung_fehlgeschlagen');
  const refundObj=(id,status)=>({id,payment_intent:'pi_in_b3_d',status,amount:990000,currency:'huf'});
  await webhook('refund.failed',refundObj('re_f1','failed'),t0+860);
  await webhook('refund.failed',refundObj('re_f1','failed'),t0+861);
  await webhook('charge.refund.updated',refundObj('re_f2','failed'),t0+862);
  await webhook('refund.updated',refundObj('re_f3','succeeded'),t0+863);
  pruefe('Erstattung fehlgeschlagen: je Erstattung eine Meldung (2), erfolgreiches Update keine',meld('erstattung_fehlgeschlagen')===fm+2,meld('erstattung_fehlgeschlagen')+' statt '+(fm+2));
  // Agentenfunde Batch 3
  // (1) Streit auf eine ALTE Rechnung von Abo A (beendet), waehrend Abo B laeuft: B und sein Zugang bleiben, nur die alte Zahlung wird markiert + gemeldet
  const t1=await kundeMitAbo([{id:'in_b3a_a',ende:bisZukunft}]); t1.nr=nr;
  await admin.req('DELETE','/api/admin/kurse/'+kurs.id+'/zugaenge/'+t1.uid);                 // A beendet (Zahlung bleibt bezahlt)
  await new Promise(r=>setTimeout(r,20));
  const cusT1='cus_beenden_'+t1.nr;
  await webhook('checkout.session.completed',{id:'cs_b3a_b',mode:'subscription',subscription:'sub_b3a_b',customer:cusT1,metadata:{kurs_id:String(kurs.id),benutzer_id:String(t1.uid),modell:'abo'},payment_status:'paid'},t0+900);
  perioden.set('in_b3a_b',bisZukunft+30*86400); zahlungen.set('pi_in_b3a_b','in_b3a_b');
  await webhook('invoice.paid',{id:'in_b3a_b',subscription:'sub_b3a_b',customer:cusT1,amount_paid:990000,currency:'huf',payment_intent:'pi_in_b3a_b',lines:{data:[{period:{end:bisZukunft+30*86400}}]}},t0+901);
  cancelAufrufe.length=0;
  await webhook('charge.dispute.created',dispute('dp_b3a','pi_in_b3a_a'),t0+902);
  pruefe('Agentenfund 1: Streit auf alte Rechnung von A: A-Zahlung pruefen, Abo B + Zugang bleiben, B nicht bei Stripe beendet',
    bestStatus('in_b3a_a')==='pruefen'&&aboStatus('sub_b3a_b')==='aktiv'&&zugangDa(t1.uid)&&!cancelAufrufe.includes('sub_b3a_b'),JSON.stringify([bestStatus('in_b3a_a'),aboStatus('sub_b3a_b'),zugangDa(t1.uid),cancelAufrufe]));
  // (2) Zahlungs-ID der Abo-Rechnung fehlt in der App: Streit findet die Bestellung ueber die Rechnung bei Stripe
  const t2=await kundeMitAbo([{id:'in_b3b_a',ende:bisZukunft}]); t2.nr=nr;
  run("UPDATE bestellungen SET zahlung_id=NULL WHERE stripe_sitzung='in_b3b_a'");
  cancelAufrufe.length=0;
  await webhook('charge.dispute.created',dispute('dp_b3b','pi_in_b3b_a'),t0+910);
  pruefe('Agentenfund 2: Streit ohne gespeicherte Zahlungs-ID: Bestellung ueber die Rechnung gefunden, Zugang weg, Abo beendet',
    bestStatus('in_b3b_a')==='pruefen'&&!zugangDa(t2.uid)&&cancelAufrufe.includes(t2.subscription),JSON.stringify([bestStatus('in_b3b_a'),zugangDa(t2.uid),cancelAufrufe]));
  // (3) Einmalkauf-Streit, obwohl fuer den Kurs auch eine bezahlte Abo-Rechnung existiert: der dauerhafte Einmal-Zugang wird trotzdem entzogen
  const t3=await einmalKauf('f3',0); const piT3='pi_n5_f3'+nr;
  run("INSERT INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES ('in_f3_abo','pi_f3_abo',?,?,990000,'huf','bezahlt','abo',?,?)",t3.uid,kurs.id,new Date().toISOString(),new Date().toISOString());
  await webhook('charge.dispute.created',dispute('dp_b3c',piT3),t0+920);
  pruefe('Agentenfund 3: Einmal-Streit entzieht den Einmal-Zugang auch wenn eine Abo-Zahlung existiert',bestStatus(t3.sitz)==='pruefen'&&!zugangDa(t3.uid),bestStatus(t3.sitz)+' '+zugangDa(t3.uid));
  // (4) Bank-Anfrage (warning_*) ohne Rueckbuchung: nur Meldung, Zugang bleibt; erst die Eskalation (updated, needs_response) entzieht
  const t4=await einmalKauf('f4',0); const piT4='pi_n5_f4'+nr;
  const am=meld('streit_anfrage'), sm=meld('streitfall');
  await webhook('charge.dispute.created',dispute('dp_b3d',piT4,'warning_needs_response'),t0+930);
  pruefe('Agentenfund 4: Bank-Anfrage: Zugang bleibt, Bestellung bezahlt, Meldung streit_anfrage',bestStatus(t4.sitz)==='bezahlt'&&zugangDa(t4.uid)&&meld('streit_anfrage')===am+1&&meld('streitfall')===sm);
  await webhook('charge.dispute.updated',dispute('dp_b3d',piT4,'needs_response'),t0+931);
  pruefe('Agentenfund 4: Eskalation zum Streit (updated, needs_response): Zugang weg, Meldung streitfall',bestStatus(t4.sitz)==='pruefen'&&!zugangDa(t4.uid)&&meld('streitfall')===sm+1);
  // (h) Streit kommt VOR der Bestellung (Ereignisse ohne Reihenfolge) bei einem Kunden der Plattform: 500, damit Stripe spaeter wiederholt; danach wird er verarbeitet
  const v1=await kundeMitAbo([]); v1.nr=nr; const cusV1='cus_beenden_'+v1.nr;
  piKunde.set('pi_in_b3_spaet',cusV1);
  const vm=meld('streitfall');
  const vd=await webhook('charge.dispute.created',dispute('dp_v1','pi_in_b3_spaet'),t0+940);
  pruefe('B4 Streit vor der Bestellung (Kunde der Plattform): 200 (nicht 500), dauerhaft gespeichert, noch keine Meldung',vd.s===200&&meld('streitfall')===vm&&ein('SELECT COUNT(*) n FROM wartende_ereignisse WHERE ereignis_id=? AND verarbeitet IS NULL',vd.id).n===1,JSON.stringify(vd)+' '+meld('streitfall'));
  const vdDoppel=await fetch(BASE+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'stub'},body:JSON.stringify({id:vd.id,type:'charge.dispute.created',created:t0+940,livemode:false,data:{object:dispute('dp_v1','pi_in_b3_spaet')}})});
  pruefe('B4 gleiche Ereignis-ID erneut: 200, weiter genau eine Zeile',vdDoppel.status===200&&ein('SELECT COUNT(*) n FROM wartende_ereignisse WHERE ereignis_id=?',vd.id).n===1);
  await rechnung(v1,'in_b3_spaet',990000,bisZukunft,t0+941);
  for(let i=0;i<40&&bestStatus('in_b3_spaet')!=='pruefen';i++)await new Promise(r=>setTimeout(r,250));
  pruefe('B4 mit Eintreffen der Bestellung wird der gespeicherte Streit selbst verarbeitet: pruefen, Zugang weg, genau eine Meldung, als verarbeitet markiert',bestStatus('in_b3_spaet')==='pruefen'&&!zugangDa(v1.uid)&&meld('streitfall')===vm+1&&!!ein('SELECT verarbeitet v FROM wartende_ereignisse WHERE ereignis_id=?',vd.id)?.v,JSON.stringify([bestStatus('in_b3_spaet'),meld('streitfall')]));
  const vd2=await webhook('charge.dispute.created',dispute('dp_v1','pi_in_b3_spaet'),t0+942);
  await new Promise(r=>setTimeout(r,500));
  pruefe('B4 spaete Wiederholung (neue Ereignis-ID): 200, keine zweite Meldung (Idempotenz)',vd2.s===200&&meld('streitfall')===vm+1,JSON.stringify([vd2.s,meld('streitfall')]));
  // B6: DREI Streit-Ereignisse zur selben Zahlung VOR der Bestellung (created -> updated -> closed/won): Reihenfolge bleibt, jedes genau einmal
  const v3=await kundeMitAbo([]); v3.nr=nr; piKunde.set('pi_in_b6_reihe','cus_beenden_'+v3.nr);
  const idsV3=[];
  for(const [typ,st,off] of [['charge.dispute.created','needs_response',960],['charge.dispute.updated','under_review',961],['charge.dispute.closed','won',962]]){
    const w=await webhook(typ,dispute('dp_b6',  'pi_in_b6_reihe',st),t0+off); idsV3.push(w.id);
    pruefe('B6 '+typ+' ('+st+') vor der Bestellung: 200',w.s===200,JSON.stringify(w));
  }
  const wartendV3=ein('SELECT COUNT(*) n FROM wartende_ereignisse WHERE zahlung_id=? AND verarbeitet IS NULL','pi_in_b6_reihe').n;
  pruefe('B6 alle 3 Ereignisse dauerhaft gespeichert, noch keine Meldung',wartendV3===3&&ein("SELECT COUNT(*) n FROM ereignisse WHERE quelle_id LIKE '%dp_b6'").n===0,wartendV3);
  await rechnung(v3,'in_b6_reihe',990000,bisZukunft,t0+963);
  for(let i=0;i<60&&ein('SELECT COUNT(*) n FROM wartende_ereignisse WHERE zahlung_id=? AND verarbeitet IS NULL','pi_in_b6_reihe').n>0;i++)await new Promise(r=>setTimeout(r,250));
  const ev3=sql("SELECT id,status,quelle_id FROM ereignisse WHERE quelle_id LIKE '%dp_b6' ORDER BY id");
  pruefe('B6 nach Anlage der Bestellung: alle 3 verarbeitet, in Reihenfolge Streitfall -> gewonnen, jedes genau einmal',ev3.length===2&&ev3[0].status==='streitfall'&&ev3[1].status==='streit_gewonnen',JSON.stringify(ev3));
  pruefe('B6 Verarbeitungsreihenfolge = Eingangsreihenfolge (rowid)',JSON.stringify(sql('SELECT ereignis_id FROM wartende_ereignisse WHERE zahlung_id=? ORDER BY verarbeitet, rowid','pi_in_b6_reihe').map(x=>x.ereignis_id))===JSON.stringify(idsV3),JSON.stringify(sql('SELECT ereignis_id,verarbeitet FROM wartende_ereignisse WHERE zahlung_id=? ORDER BY rowid','pi_in_b6_reihe')));
  for(const [typ,st,off] of [['charge.dispute.created','needs_response',960],['charge.dispute.updated','under_review',961],['charge.dispute.closed','won',962]])await webhook(typ,dispute('dp_b6','pi_in_b6_reihe',st),t0+off+100);
  await new Promise(r=>setTimeout(r,600));
  pruefe('B6 alle 3 nochmal zugestellt (neue IDs, Stripe-Retry): keine zusaetzliche Meldung',ein("SELECT COUNT(*) n FROM ereignisse WHERE quelle_id LIKE '%dp_b6'").n===2,ein("SELECT COUNT(*) n FROM ereignisse WHERE quelle_id LIKE '%dp_b6'").n);
  // fremde Zahlung (Kunde nicht von uns): 200 mit Meldung, kein Dauerfehler
  piKunde.set('pi_fremd_q','cus_fremd_unbekannt');
  const vm2=meld('streitfall');
  const vf=await webhook('charge.dispute.created',dispute('dp_v2','pi_fremd_q'),t0+950);
  pruefe('Streit zu fremder Zahlung (unbekannter Stripe-Kunde): 200 und Meldung',vf.s===200&&meld('streitfall')===vm2+1,JSON.stringify(vf));
  // (g) Abo-Status von Stripe: incomplete_expired beendet das nie bezahlte Abo (sonst blockiert es den Neukauf), canceled im Update wie deleted, paused/unpaid = zahlung_offen
  const x1=await kundeMitAbo([]);
  await webhook('customer.subscription.updated',{id:x1.subscription,status:'incomplete_expired',cancel_at_period_end:false},t0+870);
  pruefe('Abo incomplete_expired: in der App beendet, kein Zugang',aboStatus(x1.subscription)==='beendet'&&!zugangDa(x1.uid),aboStatus(x1.subscription));
  const x2=await kundeMitAbo([{id:'in_b3_x2',ende:bisZukunft}]);
  await webhook('customer.subscription.updated',{id:x2.subscription,status:'canceled',cancel_at_period_end:false},t0+880);
  pruefe('Abo canceled im Update: beendet, Zugang bis zum bezahlten Periodenende',aboStatus(x2.subscription)==='beendet'&&zugangOffen(x2.uid),aboStatus(x2.subscription));
  const x3=await kundeMitAbo([{id:'in_b3_x3',ende:bisZukunft}]);
  await webhook('customer.subscription.updated',{id:x3.subscription,status:'paused',cancel_at_period_end:false},t0+890);
  pruefe('Abo paused: zahlung_offen (Kulanz), nicht aktiv',aboStatus(x3.subscription)==='zahlung_offen',aboStatus(x3.subscription));

  // ---- Vollstaendigkeit: die Liste der abonnierten Ereignisse ist festgelegt, und jedes davon wird auch mit leerem/falschem Inhalt ohne Absturz angenommen ----
  const {WEBHOOK_EREIGNISSE}=await import(pathToFileURL(resolve('zahlung.mjs')).href);
  const erwartet=['checkout.session.completed','checkout.session.async_payment_succeeded','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted','charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','refund.failed','refund.updated','charge.refund.updated'];
  pruefe('Webhook-Ereignisliste ist genau die festgelegte (Stripe-Endpunkt muss dieselben abonnieren)',JSON.stringify([...WEBHOOK_EREIGNISSE].sort())===JSON.stringify([...erwartet].sort()));
  let leerOk=true; for(const typ of WEBHOOK_EREIGNISSE){ for(const obj of [{},{id:'x'},{id:'in_leer',subscription:'sub_unbekannt_xx'}]){ const r=await webhook(typ,obj,t0+2000); if(r.s!==200){leerOk=false;console.log('   Absturz bei',typ,JSON.stringify(obj),r.s);} } }
  pruefe('Jedes abonnierte Ereignis mit leerem/fremdem Inhalt: 200, kein Absturz',leerOk);

  // ---- Zufallsreihenfolge: dieselben Ereignisse eines Abos in vielen Reihenfolgen (Stripe garantiert keine); feste Regeln muessen IMMER gelten ----
  let seed=12345; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
  const mischen=a=>{const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;};
  let rzProbleme=[]; const DAUER3=3*86400000;
  for(let lauf=0;lauf<Number(process.env.RZ_LAEUFE||60);lauf++){
    nr++; const mail='beenden.rz'+nr+'@example.com', c=client(); await c.req('POST','/api/registrieren',{ zustimmung: true, email:mail,passwort:PASS});
    const uid=ein('SELECT id FROM benutzer WHERE email=?',mail).id, cus='cus_beenden_'+nr, sub='sub_rz_'+nr; run('UPDATE benutzer SET stripe_kunde=? WHERE id=?',cus,uid);
    const i1='in_rz1_'+nr, i2='in_rz2_'+nr, e1=bisZukunft-30*86400, e2=bisZukunft;
    perioden.set(i1,e1);perioden.set(i2,e2);zahlungen.set('pi_'+i1,i1);zahlungen.set('pi_'+i2,i2);
    const inv=(id,ende)=>({id,subscription:sub,customer:cus,amount_paid:990000,currency:'huf',payment_intent:'pi_'+id,lines:{data:[{period:{end:ende}}]}});
    const meta={kurs_id:String(kurs.id),benutzer_id:String(uid),modell:'abo'};
    subMeta.set(sub,{metadata:meta,customer:cus});
    const liste=[
      ['checkout.session.completed',{id:'cs_rz_'+nr,mode:'subscription',subscription:sub,customer:cus,metadata:meta,payment_status:'paid'},t0+3000],
      ['invoice.paid',inv(i1,e1),t0+3001],
      ['invoice.paid',inv(i2,e2),t0+3002],
      ['customer.subscription.updated',{id:sub,status:'active',cancel_at_period_end:true},t0+3003],
      ['charge.refunded',{id:'ch_'+i2,payment_intent:'pi_'+i2,refunded:true,amount:990000,amount_refunded:990000,currency:'huf',refunds:{data:[{id:'re_'+i2,status:'succeeded',amount:990000}]}},t0+3004],
      ['customer.subscription.deleted',{id:sub},t0+3005],
    ];
    let offen=mischen(liste), runden=0, alleOk=true;
    const ordnung=offen.map(x=>x[0].replace('customer.subscription.','sub.').replace('checkout.session.completed','checkout').replace('charge.refunded','refund').replace('invoice.paid',x[1].id?.includes('rz1')?'paid1':'paid2')).join('>');
    while(offen.length&&runden<6){ runden++; const nochmal=[];
      for(const [typ,obj,created] of offen){ const r=await webhook(typ,obj,created); if(r.s!==200)nochmal.push([typ,obj,created]); }
      offen=nochmal; }                      // 500 = Stripe wiederholt spaeter
    if(offen.length){alleOk=false;rzProbleme.push('Lauf '+lauf+': Ereignisse nie angenommen '+offen.map(x=>x[0]).join(','));}
    // Invarianten
    const z=ein("SELECT quelle,gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=?",uid,kurs.id);
    const bestellt=sql("SELECT stripe_sitzung,status FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND art='abo'",uid,kurs.id);
    const bezahlte=bestellt.filter(b=>b.status==='bezahlt');
    if(bestellt.length<2&&alleOk)rzProbleme.push('Lauf '+lauf+' I3: Zahlung ohne Bestellung ('+bestellt.length+' von 2)');
    if(z&&z.gueltig_bis!==null&&z.gueltig_bis>Date.now()){
      if(!bezahlte.length)rzProbleme.push('Lauf '+lauf+' I1: offener Zugang ohne bezahlte Bestellung');
      const maxEnde=Math.max(0,...bezahlte.map(b=>(perioden.get(b.stripe_sitzung)||0)*1000));
      if(z.gueltig_bis>maxEnde+DAUER3)rzProbleme.push('Lauf '+lauf+' I7: Zugang laenger als bezahlter Zeitraum + Kulanz');
    }
    if(bestellt.some(b=>b.stripe_sitzung===i2&&b.status==='erstattet')&&z&&(z.gueltig_bis===null||z.gueltig_bis>Date.now()+60000))
      rzProbleme.push('Lauf '+lauf+' I6: letzter Monat erstattet, Zugang trotzdem offen bis '+new Date(z.gueltig_bis).toISOString()+' [Reihenfolge '+ordnung+']');
    for(const b of bestellt.filter(b=>b.status==='pruefen'))
      if(!ein("SELECT 1 AS x FROM ereignisse WHERE quelle_id=?",'pruefen:'+b.stripe_sitzung))rzProbleme.push('Lauf '+lauf+' I4: pruefen-Bestellung ohne Meldung');
  }
  pruefe('Zufallsreihenfolge (60 Laeufe, 6 Ereignisse): alle Regeln I1/I3/I4/I6/I7 gelten',rzProbleme.length===0,rzProbleme.slice(0,4).join(' | '));
  if(rzProbleme.length)console.log('   ...insgesamt '+rzProbleme.length+' Verstoesse; Beispiele: '+[...new Set(rzProbleme.map(p=>p.replace(/^Lauf \d+/,'')))].slice(0,6).join(' || '));
} catch(e) {
  schlecht++;console.error('FEHLER Testablauf:',e);
} finally {
  if(server) await new Promise(done=>server.close(done));
  try{rmSync(BASIS,{recursive:true,force:true});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
}
console.log('Abo-Beenden: '+ok+' bestanden, '+schlecht+' fehlgeschlagen');
process.exitCode=schlecht?1:0;
