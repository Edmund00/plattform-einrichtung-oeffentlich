// Scheibe 26: read-only Stripe reconciliation. No mutations of course/customer/payment tables.
import {createHash} from 'node:crypto';
import {db,transaktion} from './db.mjs';
import {rechnungsAbo,aboBeiStripeBeenden} from './abo.mjs';
import {HU} from './texte.mjs';
const now=()=>new Date().toISOString();
const asId=v=>typeof v==='string'?v:v?.id||null;
const validId=v=>typeof v==='string'&&/^(?:cs|in|pi|re|sub|du|dp)_[A-Za-z0-9_]+$/.test(v)?v:null;
const validInt=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const cleanCurrency=v=>typeof v==='string'&&/^[a-z]{3}$/.test(v.toLowerCase())?v.toLowerCase():null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function stripeRead(fn,{pause=sleep}={}){
 for(let i=0;i<3;i++){
  try{return await Promise.race([fn(),new Promise((_,reject)=>{
   const t=setTimeout(()=>reject(new Error('stripe timeout')),12000);t.unref?.();
  })]);}catch(e){
   const retry=e?.statusCode===429||e?.statusCode>=500||e?.code==='ETIMEDOUT'||e?.message==='stripe timeout';
   if(!retry||i===2)throw new Error('stripe read unavailable');
   await pause((i+1)*500);
  }
 }
}
export async function stripePages(list,created,{pause=sleep}={}){
 const all=[],seen=new Set();let after;
 for(let page=0;page<50;page++){
  const args={limit:100,...(created==null?{}:{created:{gte:created}}),...(after?{starting_after:after}:{})};
  const result=await stripeRead(()=>list(args),{pause}),rows=result?.data;
  if(!Array.isArray(rows))throw new Error('stripe invalid listing');
  for(const x of rows)all.push(x);
  if(!result.has_more)return all;
  const end=rows.at(-1)?.id;
  if(!end||seen.has(end))throw new Error('stripe pagination invalid');
  after=end;seen.add(end);
 }
 throw new Error('stripe page limit');
}
export function letzterAbgleich(){
 return db.prepare('SELECT id,ende,status,abweichungen_anzahl,modus FROM abgleich_lauf ORDER BY id DESC LIMIT 1').get()||null;
}
// Ohne bisherigen Lauf (neue, leere Datenbank, zum Beispiel beim Livegang als neuer Dienst) ist die Antwort in der ersten Stunde nach dem
// Start NICHT rot: der erste Lauf kommt 5 Minuten nach dem Start. Danach ohne Lauf = rot (die Automatik arbeitet nicht).
export function abgleichGesundheit(uptimeSekunden=process.uptime(),last=letzterAbgleich()){
 if(!last)return uptimeSekunden<3600;
 if(Date.now()-Date.parse(last.ende)>36*3600000||last.status==='fehler')return false;
 // Offene Abweichungen "Stripe bezahlt, Plattform kennt es nicht" färben die Gesundheit nur im LIVE-Modus rot. Im Testmodus liegen
 // zwangsläufig alte Test-Zahlungen in der Sandbox, die die Plattform nie gesehen hat; dort zählen nur Alter und Fehler des Laufs.
 if(last.modus!=='live')return true;
 return !db.prepare("SELECT 1 FROM abgleich_abweichung WHERE lauf_id=? AND art='stripe_ohne_bestellung' LIMIT 1").get(last.id);
}
const STELLEN={
 stripe_ohne_bestellung:'abgleich_stripe_ohne_bestellung',
 bestellung_ohne_stripe:'abgleich_bestellung_ohne_stripe',
 betrag:'abgleich_betrag',
 erstattung_nicht_verarbeitet:'abgleich_erstattung_nicht_verarbeitet',
 erstattung_ohne_stripe:'abgleich_erstattung_ohne_stripe',
 abo_status:'abgleich_abo_status',
 abo_zugang:'abgleich_abo_zugang',
 abo_nachgekuendigt:'abgleich_abo_nachgekuendigt',
 streit_nicht_verarbeitet:'abgleich_streit_nicht_verarbeitet',
 doppelkunde:'abgleich_doppelkunde',
 summen:'abgleich_summen'
};
function kopieRows(){
 return {
  orders:db.prepare("SELECT id,stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,grund,art,erstellt FROM bestellungen").all(),
  subscriptions:db.prepare("SELECT id,stripe_abo,benutzer_id,kurs_id,status,gueltig_bis FROM abos").all(),
  users:db.prepare("SELECT id,stripe_kunde FROM benutzer WHERE stripe_kunde IS NOT NULL").all(),
  access:db.prepare("SELECT benutzer_id,kurs_id,quelle,gueltig_bis FROM zugaenge").all()
 };
}
// U4: Alle Stripe-Abo-Status kennen: incomplete_expired/canceled = beendet; past_due/unpaid/paused/incomplete = zahlung_offen (keine Gegenleistung ohne Zahlung).
const statusAbo=s=>s==='canceled'||s==='incomplete_expired'?'beendet':['past_due','unpaid','paused','incomplete'].includes(s)?'zahlung_offen':s==='active'||s==='trialing'?'aktiv':null;
// Stripe-Status, bei denen Stripe noch abbucht oder abbuchen kann.
const STRIPE_LAEUFT=['active','trialing','past_due','unpaid','incomplete','paused'];
export function abgleichDienst({stripe,modus='test',alarm=null,pause=sleep}){
 let aktiv=false;
 async function lauf(){
  if(aktiv)return {ok:false,beschaeftigt:true};
  aktiv=true;const start=now(),cut=Math.floor(Date.now()/1000)-35*86400;
  const counts={sessions:0,invoices:0,refunds:0,subscriptions:0};
  let status='fehler',meldung='abgleich_fehler',items=[],webhook='nicht_pruefbar';
  try{
   if(!stripe?.checkout?.sessions?.list||!stripe?.invoices?.list||!stripe?.refunds?.list||!stripe?.subscriptions?.list)
    throw Error('missing readonly endpoint');
   const source=kopieRows();
   const [sessions,invoices,refunds,subscriptions]=await Promise.all([
    stripePages(x=>stripe.checkout.sessions.list(x),cut,{pause}),
    stripePages(x=>stripe.invoices.list(x),cut,{pause}),
    stripePages(x=>stripe.refunds.list(x),cut,{pause}),
    // status:'all', sonst liefert Stripe beendete (canceled) Abos nicht mit und jedes beendete Abo sähe wie ein Fehler aus.
    stripePages(x=>stripe.subscriptions.list({...x,status:'all'}),null,{pause})
   ]);
   counts.sessions=sessions.length;counts.invoices=invoices.length;counts.refunds=refunds.length;counts.subscriptions=subscriptions.length;
   const seen=new Set();
   const add=(art,stripeId,order,amount,currency,benutzer=null,stripeZeit=null)=>{
    const sid=validId(stripeId);const n=Number.isSafeInteger(amount)?amount:null;
    const key=[art,sid,order?.id||null,currency||''].join(':');if(seen.has(key))return;seen.add(key);
    items.push({art,stripe_id:sid,bestell_id:order?.id||null,benutzer_id:benutzer||order?.benutzer_id||null,
      betrag:n,waehrung:cleanCurrency(currency),text:STELLEN[art],
      zeit:Number.isSafeInteger(stripeZeit)&&stripeZeit>0?new Date(stripeZeit*1000).toISOString():now()});
   };
   const orderMap=new Map(source.orders.map(o=>[o.stripe_sitzung,o]));
   const sessionMap=new Map(sessions.map(x=>[x.id,x]));
   const invoiceMap=new Map(invoices.map(x=>[x.id,x]));
   const customerMap=new Map(source.users.map(x=>[x.id,x.stripe_kunde]));
   const comparePaid=(x,amount,id,expectedUser,expectedCourse,currency)=>{
    const o=orderMap.get(id);
    if(!o){add('stripe_ohne_bestellung',id,null,amount,currency,expectedUser,x.created);return;}
    if((o.status!=='bezahlt'&&o.status!=='erstattet')||!expectedUser||!expectedCourse||o.betrag!==amount||o.waehrung!==currency||
       (expectedUser&&o.benutzer_id!==expectedUser)||(expectedCourse&&o.kurs_id!==expectedCourse)||
       // Kundennummer nur vergleichen, wenn der Benutzer noch eine hat (nach Kontolöschung/Anonymisierung fehlt sie bewusst).
       (x.customer&&customerMap.has(o.benutzer_id)&&customerMap.get(o.benutzer_id)!==asId(x.customer)))
      add('betrag',id,o,amount,currency,null,x.created);
   };
   for(const x of sessions.filter(x=>x.mode==='payment'&&x.payment_status==='paid')){
    const user=Number(x.metadata?.benutzer_id),course=Number(x.metadata?.kurs_id);
    comparePaid(x,validInt(x.amount_total),x.id,Number.isSafeInteger(user)?user:null,Number.isSafeInteger(course)?course:null,cleanCurrency(x.currency));
   }
   const paidInvoices=invoices.filter(x=>x.status==='paid'&&validInt(x.amount_paid)>0&&!!rechnungsAbo(x));
   for(const x of paidInvoices){
    const abo=source.subscriptions.find(a=>a.stripe_abo===rechnungsAbo(x));
    const u=Number(x.parent?.subscription_details?.metadata?.benutzer_id||x.metadata?.benutzer_id);
    const c=Number(x.parent?.subscription_details?.metadata?.kurs_id||x.metadata?.kurs_id);
    comparePaid(x,x.amount_paid,x.id,abo?.benutzer_id||u||null,abo?.kurs_id||c||null,cleanCurrency(x.currency));
   }
   for(const o of source.orders.filter(o=>o.status==='bezahlt'&&Date.parse(o.erstellt)>=cut*1000)){
    const remote=o.stripe_sitzung?.startsWith('in_')?invoiceMap.get(o.stripe_sitzung):sessionMap.get(o.stripe_sitzung);
    if(!remote||(o.stripe_sitzung.startsWith('in_')?remote.status!=='paid':remote.payment_status!=='paid'))
      add('bestellung_ohne_stripe',o.stripe_sitzung,o,o.betrag,o.waehrung);
   }
   const refundByPI=new Map(),refundByOrder=new Map();
   const alteRechnungen=new Map();
   for(const refund of refunds.filter(x=>x.status==='succeeded')){
    const pi=asId(refund.payment_intent);
    if (!pi || source.orders.some(o=>o.zahlung_id===pi) || !stripe.invoicePayments?.list) continue;
    const reply=await stripeRead(()=>stripe.invoicePayments.list({payment:{type:'payment_intent',payment_intent:pi},limit:20}),{pause});
    const invoices=Array.isArray(reply?.data)?reply.data:[];
    const match=invoices.map(p=>asId(p.invoice)).find(id=>source.orders.some(o=>o.art==='abo'&&o.stripe_sitzung===id));
    if(match)alteRechnungen.set(pi,match);
   }
   for(const refund of refunds.filter(x=>x.status==='succeeded')){
    const pi=asId(refund.payment_intent);
    const order=source.orders.find(x=>pi&&(x.zahlung_id===pi||(x.art==='abo'&&x.stripe_sitzung===alteRechnungen.get(pi))));
    if(pi){refundByPI.set(pi,(refundByPI.get(pi)||0)+(refund.amount||0));}
    if(!order)add('erstattung_nicht_verarbeitet',refund.id,null,refund.amount,refund.currency,null,refund.created);
    if(order){
     refundByOrder.set(order.id,(refundByOrder.get(order.id)||0)+(refund.amount||0));
     if(refundByOrder.get(order.id)<order.betrag && order.status==='bezahlt' && order.grund!=='teilerstattung')
      add('erstattung_nicht_verarbeitet',refund.id,order,refund.amount,refund.currency,null,refund.created);
     if(refundByOrder.get(order.id)>=order.betrag){
      const others=source.orders.some(x=>x.id!==order.id&&x.benutzer_id===order.benutzer_id&&x.kurs_id===order.kurs_id&&x.status==='bezahlt');
      const access=source.access.find(x=>x.benutzer_id===order.benutzer_id&&x.kurs_id===order.kurs_id&&x.quelle===(order.art==='abo'?'abo':'zahlung'));
      const abo=source.subscriptions.find(x=>x.benutzer_id===order.benutzer_id&&x.kurs_id===order.kurs_id);
      const inv=invoiceMap.get(order.stripe_sitzung);
      const seconds=(inv?.lines?.data||[]).reduce((m,x)=>Math.max(m,Number.isSafeInteger(x.period?.end)?x.period.end:0),0);
      const aktuellePeriode=order.art!=='abo'||(seconds>0&&abo?.gueltig_bis===seconds*1000);
      const accessWrong=aktuellePeriode&&!!access;
      if(order.status!=='erstattet'||(!others&&accessWrong))add('erstattung_nicht_verarbeitet',refund.id,order,refund.amount,refund.currency,null,refund.created);
     }
    }
   }
   for(const o of source.orders.filter(x=>x.status==='erstattet'&&Date.parse(x.erstellt)>=cut*1000)){
    const zugeordnet=(o.zahlung_id&&refundByPI.has(o.zahlung_id))||
      (o.art==='abo'&&[...alteRechnungen.entries()].some(([pi,invoice])=>invoice===o.stripe_sitzung&&refundByPI.has(pi)));
    if(!zugeordnet)add('erstattung_ohne_stripe',o.zahlung_id||o.stripe_sitzung,o,o.betrag,o.waehrung);
   }
   for(const a of source.subscriptions.filter(a=>!subscriptions.some(x=>x.id===a.stripe_abo)))
     add('abo_status',a.stripe_abo,null,null,null,a.benutzer_id);
   for(const x of subscriptions){
    const a=source.subscriptions.find(o=>o.stripe_abo===x.id);
    if(!a)continue;
    const expected=statusAbo(x.status);
    if(a.status==='beendet'&&STRIPE_LAEUFT.includes(x.status)){
     // I5 Selbstheilung: Die App hat das Abo beendet (Entzug, Erstattung, Streitfall), bei Stripe laeuft es aber noch (Beenden war damals gescheitert): sonst
     // bucht Stripe weiter ab. Nur Stripe wird geaendert, nie die App-Tabellen. Gelingt es, steht es als Hinweis im Bericht; sonst bleibt die Abweichung.
     let geheilt=false;
     if(stripe.subscriptions?.cancel){try{await aboBeiStripeBeenden(stripe,x.id);geheilt=true;}catch{}}
     add(geheilt?'abo_nachgekuendigt':'abo_status',x.id,null,null,null,a.benutzer_id,x.created);
    }else if(expected&&a.status!==expected&&!(x.cancel_at_period_end&&a.status==='gekuendigt'))
      add('abo_status',x.id,null,null,null,a.benutzer_id,x.created);
    if(expected==='beendet'){
     const hasOther=source.orders.some(o=>o.benutzer_id===a.benutzer_id&&o.kurs_id===a.kurs_id&&o.status==='bezahlt'&&o.art!=='abo');
     const wrong=source.access.some(z=>z.benutzer_id===a.benutzer_id&&z.kurs_id===a.kurs_id&&z.quelle==='abo'&&(!z.gueltig_bis||z.gueltig_bis>Date.now()));
     if(wrong&&!hasOther)add('abo_zugang',x.id,null,null,null,a.benutzer_id,x.created);
    }
   }
   // U4: Streitfälle (Chargebacks) bei Stripe, deren Bestellung in der App noch "bezahlt" ist: der Webhook hat sie nicht verarbeitet. Gewonnene Streitfälle und
   // bloße Bank-Anfragen (warning_*) zählen nicht.
   if(stripe.disputes?.list){
    const streite=await stripePages(x=>stripe.disputes.list(x),cut,{pause});
    for(const d of streite){
     if(!['needs_response','under_review','lost'].includes(d.status))continue;
     const pi=asId(d.payment_intent);
     const o=pi&&source.orders.find(x=>x.zahlung_id===pi);
     if(o&&o.status==='bezahlt')add('streit_nicht_verarbeitet',d.id,o,d.amount,d.currency,null,d.created);
    }
   }
   const customers=new Map();
   for(const u of source.users){
    if(customers.has(u.stripe_kunde))add('doppelkunde',null,null,null,null,u.id);
    customers.set(u.stripe_kunde,u.id);
   }
   // Aggregation only for objectively comparable fully captured Stripe payments in window.
   // If Stripe listing incomplete, entire run fails rather than declaring a clean balance.
   const stripeTotals=new Map(),localTotals=new Map();
   const accumulate=(map,c,v)=>{if(!c||!Number.isSafeInteger(v))return;map.set(c,(map.get(c)||0)+v)};
   for(const s of sessions.filter(x=>x.mode==='payment'&&x.payment_status==='paid'))accumulate(stripeTotals,cleanCurrency(s.currency),s.amount_total);
   for(const i of paidInvoices)accumulate(stripeTotals,cleanCurrency(i.currency),i.amount_paid);
   for(const r of refunds.filter(x=>x.status==='succeeded'))accumulate(stripeTotals,cleanCurrency(r.currency),-r.amount);
   for(const o of source.orders.filter(o=>Date.parse(o.erstellt)>=cut*1000)){
    if(o.status==='bezahlt'||o.status==='erstattet')accumulate(localTotals,cleanCurrency(o.waehrung),o.betrag);
    if(o.status==='erstattet')accumulate(localTotals,cleanCurrency(o.waehrung),-o.betrag);
   }
   for(const c of new Set([...stripeTotals.keys(),...localTotals.keys()])){
    if(stripeTotals.get(c)!==localTotals.get(c))add('summen',null,null,(stripeTotals.get(c)||0)-(localTotals.get(c)||0),c);
   }
   status=items.length?'abweichung':'ok';meldung='abgleich_'+status;
  }catch{status='fehler';meldung='abgleich_fehler';items=[];}
  finally{
   let runId=null;
   try{runId=transaktion(()=>{
    const r=db.prepare("INSERT INTO abgleich_lauf(start,ende,modus,fenster_tage,geprueft_sitzungen,geprueft_rechnungen,geprueft_erstattungen,geprueft_abos,abweichungen_anzahl,status,meldung) VALUES(?,?,?,35,?,?,?,?,?,?,?)")
      .run(start,now(),modus,counts.sessions,counts.invoices,counts.refunds,counts.subscriptions,items.length,status,meldung);
    const id=Number(r.lastInsertRowid);
    const insert=db.prepare("INSERT INTO abgleich_abweichung(lauf_id,art,stripe_id,bestell_id,benutzer_id,betrag,waehrung,text,zeit) VALUES(?,?,?,?,?,?,?,?,?)");
    for(const x of items)insert.run(id,x.art,x.stripe_id,x.bestell_id,x.benutzer_id,x.betrag,x.waehrung,x.text,x.zeit);
    return id;
   });}catch{console.warn('Stripe-Abgleich konnte nicht protokolliert werden');}
   aktiv=false;
   if(alarm&&runId)Promise.resolve().then(()=>alarm({laufId:runId,status,items,modus})).catch(()=>console.warn('Abgleichalarm nicht verarbeitet'));
  }
  return {ok:status!=='fehler',status,abweichungen:items.length,webhook,counts};
 }
 return {lauf,istBeschaeftigt:()=>aktiv};
}
