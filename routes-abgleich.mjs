import express from 'express';
import {db,transaktion} from './db.mjs';
import {erstattungVerarbeiten} from './zahlung.mjs';
import {ereignisseNachCommit} from './ereignis-liste.mjs';
import {nurAdmin} from './routes-kurse.mjs';
import {fehler} from './texte.mjs';
import {abgleichDienst,letzterAbgleich} from './abgleich.mjs';
export function abgleichRouter({stripe,modus='test',alarm=null,automatik=true,delay=300000,pause}){
 const router=express.Router(),dienst=abgleichDienst({stripe,modus,alarm,pause});
 router.use('/api/admin/abgleich',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next()});
 router.get('/api/admin/abgleich',nurAdmin,(_req,res)=>{
  const last=letzterAbgleich();
  const abweichungen=last?db.prepare("SELECT a.id,a.art,a.stripe_id,a.bestell_id,a.benutzer_id,a.betrag,a.waehrung,a.text,a.zeit, CASE WHEN EXISTS(SELECT 1 FROM abgleich_abweichung alt WHERE alt.lauf_id=(SELECT MAX(id) FROM abgleich_lauf WHERE id<?) AND alt.art=a.art AND COALESCE(alt.stripe_id,'')=COALESCE(a.stripe_id,'') AND COALESCE(alt.bestell_id,-1)=COALESCE(a.bestell_id,-1)) THEN 0 ELSE 1 END AS neu FROM abgleich_abweichung a WHERE a.lauf_id=? ORDER BY a.id").all(last.id,last.id):[];
  const verlauf=db.prepare('SELECT id,start,ende,modus,fenster_tage,geprueft_sitzungen,geprueft_rechnungen,geprueft_erstattungen,geprueft_abos,abweichungen_anzahl,status,meldung FROM abgleich_lauf ORDER BY id DESC LIMIT 30').all();
  res.json({letzter:last,abweichungen,verlauf});
 });
 router.post('/api/admin/abgleich/nachbuchen',nurAdmin,async(req,res)=>{
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||
     Object.keys(req.body).length!==1||typeof req.body.stripe_id!=='string'||
     !/^re_[A-Za-z0-9_]{1,100}$/.test(req.body.stripe_id))
    return fehler(res,400,'body_ungueltig');
  const rid=req.body.stripe_id;
  const abweichung=db.prepare("SELECT stripe_id FROM abgleich_abweichung WHERE art='erstattung_nicht_verarbeitet' AND stripe_id=? ORDER BY id DESC LIMIT 1").get(rid);
  if(!abweichung)return fehler(res,404,'nicht_gefunden');
  const zeit=()=>new Date().toISOString();
  let order=null;
  try{
    const refund=await stripe.refunds.retrieve(rid);
    if(refund?.id!==rid || refund.status!=='succeeded')return fehler(res,409,'abgleich_fehler');
    const chargeId=typeof refund.charge==='string'?refund.charge:refund.charge?.id;
    if(!chargeId)return fehler(res,503,'abgleich_fehler');
    const charge=await stripe.charges.retrieve(chargeId);
    const pi=typeof charge?.payment_intent==='string'?charge.payment_intent:charge?.payment_intent?.id;
    if(!pi)return fehler(res,503,'abgleich_fehler');
    order=db.prepare("SELECT id,benutzer_id FROM bestellungen WHERE zahlung_id=? LIMIT 1").get(pi);
    let rechnungId=null;
    if(!order){
      const payments=await stripe.invoicePayments.list({payment:{type:'payment_intent',payment_intent:pi},limit:20});
      const candidates=payments?.data||[];
      for(const p of candidates){
        const invoice=typeof p.invoice==='string'?p.invoice:p.invoice?.id;
        const match=invoice&&db.prepare("SELECT id,benutzer_id FROM bestellungen WHERE stripe_sitzung=? AND art='abo'").get(invoice);
        if(match){order=match;rechnungId=invoice;break;}
      }
    }
    if(!order)return fehler(res,404,'nicht_gefunden');
    const existing=db.prepare('SELECT art,stripe_sitzung FROM bestellungen WHERE id=?').get(order.id);
    if(existing?.art!=='abo')return fehler(res,409,'abgleich_fehler');
    let periodEnd=null;
    const invoice=await stripe.invoices.retrieve(existing.stripe_sitzung);
    const seconds=(invoice?.lines?.data||[]).reduce((m,x)=>Math.max(m,Number.isSafeInteger(x.period?.end)?x.period.end:0),0);
    if(seconds>0)periodEnd=seconds*1000;
    transaktion(()=>{
      erstattungVerarbeiten({id:'nachbuchung:'+rid,type:'charge.refunded'}, {...charge,payment_intent:pi,refunds:{data:[refund]}},
        {rechnungId,refundId:rid,periodEnd});
      db.prepare("INSERT INTO abgleich_nachbuchung(zeit,abweichung_stripe_id,bestell_id,ergebnis,benutzer_id) VALUES(?,?,?,'ok',?)")
        .run(zeit(),rid,order.id,order.benutzer_id);
    });
    queueMicrotask(()=>{ereignisseNachCommit();req.app.locals.aboErstattungNachCommitSenden?.();});
    return res.json({status:'ok',bestell_id:order.id});
  }catch{
    try{db.prepare("INSERT INTO abgleich_nachbuchung(zeit,abweichung_stripe_id,bestell_id,ergebnis,benutzer_id) VALUES(?,?,?,'fehler',?)").run(zeit(),rid,order?.id||null,order?.benutzer_id||null);}
    catch{console.warn('Nachbuchung konnte nicht protokolliert werden');}
    return fehler(res,503,'abgleich_fehler');
  }
 });
 router.post('/api/admin/abgleich/jetzt',nurAdmin,async(req,res)=>{
  if(req.body&&(!Array.isArray(req.body)&&Object.keys(req.body).length>0||Array.isArray(req.body)))return fehler(res,400,'body_ungueltig');
  if(dienst.istBeschaeftigt())return fehler(res,409,'abgleich_busy');
  const r=await dienst.lauf();
  if(!r.ok)return fehler(res,503,'abgleich_fehler');
  res.setHeader('Cache-Control','no-store');
  res.json({status:r.status,abweichungen:r.abweichungen});
 });
 if(automatik){
  const due=()=>{const last=letzterAbgleich();return !last||Date.now()-Date.parse(last.ende)>=(last.status==='fehler'?3600000:24*3600000)};
  const first=setTimeout(()=>{if(due())void dienst.lauf()},delay);first.unref?.();
  // Stündlich nur die Fälligkeit prüfen; ein echter Lauf frühestens alle 24 Stunden.
  const timer=setInterval(()=>{if(due())void dienst.lauf()},3600000);timer.unref?.();
 }
 return router;
}
