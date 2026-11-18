import express from 'express';
import {db,transaktion} from './db.mjs';
import {aktuellerBenutzer} from './auth.mjs';
import {fehler,HU} from './texte.mjs';
import {entscheidung,ABO_RECHNUNGEN_MAX} from './erstattung-regeln.mjs';
import {vollErstatten} from './erstattung-stripe.mjs';
import {rechnungsAbo,aboBeiStripeBeenden} from './abo.mjs';
const router=express.Router();
let ERSTATTUNG_ZEITLIMIT_MS=25000;
export const erstattungZeitlimitSetzen=ms=>{ERSTATTUNG_ZEITLIMIT_MS=ms;};
const now=()=>new Date().toISOString();
const resultCode={erstattung:200,bearbeitung:503,fehler:503,abgelehnt_frist:409,abgelehnt_zustimmung:409};
function antwort(res,e){
 const code=resultCode[e.ergebnis]||503;
 const grund=HU['ellallas_'+e.ergebnis]||HU.ellallas_fehler;
 const support=res.app?.locals?.ellallasSupportMail;
 const text=e.ergebnis.startsWith('abgelehnt')&&typeof support==='string'&&support?grund+' '+support:grund;
 return res.status(code).json({text,ergebnis:e.ergebnis});
}
// Pruefrunde 3 (Agent H): bricht der Prozess nach dem Eintrag 'bearbeitung' ab (Deploy/Absturz), bliebe der Widerruf fuer immer in diesem
// Zustand: der Kunde bekommt dauerhaft 503, niemand eine Mail. Solche Zeilen werden zu 'fehler' mit Warnmail an die Inhaberin (die dann von Hand prueft).
export function haengendeEllallasRetten(alterMs=21600000){
 const grenze=new Date(Date.now()-alterMs).toISOString();
 return transaktion(()=>{
  const zeilen=db.prepare("SELECT bestellung_id FROM ellallas WHERE ergebnis='bearbeitung' AND aktualisiert<?").all(grenze);
  for(const z of zeilen){
   db.prepare("UPDATE ellallas SET ergebnis='fehler',hinweis='abbruch',aktualisiert=? WHERE bestellung_id=? AND ergebnis='bearbeitung'").run(now(),z.bestellung_id);
   db.prepare("INSERT OR IGNORE INTO ellallas_mail(bestellung_id,empfaenger) VALUES(?,'warnung')").run(z.bestellung_id);
  }
  return zeilen.length;
 });
}
// P0 (Zahlungshaertung): bricht der Prozess nach dem Eintrag 'bearbeitung' ab, wird der Widerruf beim naechsten Lauf (Start und jede Minute) AUTOMATISCH
// wieder aufgenommen. Gleicher Idempotenzschluessel wie beim ersten Versuch: Stripe fuehrt die Erstattung genau EINMAL aus (kam der erste Aufruf schon
// an, liefert Stripe dieselbe Erstattung zurueck). Nur Einmalkaeufe; Abos bleiben beim Rettungsweg (Warnmail, Handpruefung), weil das Beenden des Abos Zustand braucht.
// Scheitert Stripe, bleibt die Zeile 'bearbeitung' und wird erneut versucht; nach 6 Stunden uebernimmt haengendeEllallasRetten (Warnmail).
// B3: Bei Einmalkaeufen bucht die Plattform die vollstaendige Erstattung SELBST (Bestellung erstattet, Zugang weg), sobald Stripe sie bestaetigt hat, und wartet nicht
// auf den Webhook charge.refunded. Geht dieser verloren (Server war gerade aus, stripe listen wiederholt nicht), bliebe die Bestellung sonst 'bezahlt' mit Zugang.
// Idempotent: tut nichts, wenn der Webhook schneller war. Gleiche Regeln wie zahlung.mjs (Zugang nur weg, wenn es keine weitere bezahlte Einmal-Bestellung gibt).
function einmalErstattetBuchen(b){
 if(b.art!=='einmal')return;
 db.prepare("UPDATE bestellungen SET status='erstattet',grund='erstattung_voll',geaendert=? WHERE id=? AND status='bezahlt'").run(now(),b.id);
 const x=db.prepare('SELECT benutzer_id,kurs_id,status FROM bestellungen WHERE id=?').get(b.id);
 if(x?.status!=='erstattet'||!x.benutzer_id||!x.kurs_id)return;
 const andere=db.prepare("SELECT 1 FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND status='bezahlt' AND art!='abo' AND id!=?").get(x.benutzer_id,x.kurs_id,b.id);
 if(!andere)db.prepare("DELETE FROM zugaenge WHERE benutzer_id=? AND kurs_id=? AND quelle='zahlung'").run(x.benutzer_id,x.kurs_id);
}
let wiederaufnahmeLaeuft=false;
export async function haengendeEllallasWiederaufnehmen(stripe,mailSenden,alterMs=60000){
 if(!stripe||wiederaufnahmeLaeuft)return 0;
 wiederaufnahmeLaeuft=true;
 let fertig=0;
 try{
  const grenze=new Date(Date.now()-alterMs).toISOString();
  const zeilen=db.prepare("SELECT b.id,b.betrag,b.art,b.zahlung_id,b.stripe_sitzung FROM ellallas e JOIN bestellungen b ON b.id=e.bestellung_id WHERE e.ergebnis='bearbeitung' AND e.aktualisiert<? AND b.art='einmal' ORDER BY e.bestellung_id LIMIT 20").all(grenze);
  for(const b of zeilen){
   const beansprucht=db.prepare("UPDATE ellallas SET aktualisiert=? WHERE bestellung_id=? AND ergebnis='bearbeitung' AND aktualisiert<?").run(now(),b.id,grenze);
   if(beansprucht.changes!==1)continue;
   try{
    const refund=await vollErstatten(stripe,b,'valore-ellallas-'+b.id);
    if(!refund?.id||['failed','canceled'].includes(refund.status))throw new Error('Refund incomplete');
    transaktion(()=>{
     db.prepare("UPDATE ellallas SET ergebnis='erstattung',hinweis='wiederaufgenommen',erstattet_betrag=?,aktualisiert=? WHERE bestellung_id=? AND ergebnis='bearbeitung'").run(Number.isSafeInteger(refund.erstattet_betrag)?refund.erstattet_betrag:null,now(),b.id);
     einmalErstattetBuchen(b);
    });
    fertig++;
   }catch(e){console.warn('Widerruf Wiederaufnahme fehlgeschlagen (wird erneut versucht):',e?.type||e?.name||'',e?.code||'');}
  }
  if(fertig)mailSenden?.();
 }finally{wiederaufnahmeLaeuft=false;}
 return fertig;
}
try{haengendeEllallasRetten()}catch{console.warn('Haengende Widerrufe konnten nicht geprueft werden')}
const rettenZeitgeber=setInterval(()=>{try{haengendeEllallasRetten()}catch{}},3600000);rettenZeitgeber.unref?.();
router.post('/api/bestellungen/:id/ellallas',async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 const user=aktuellerBenutzer(req);
 if(!user)return fehler(res,401,'nicht_angemeldet');
 if(user.rolle==='admin')return fehler(res,403,'konto_nur_kunde');
 if(!/^[1-9]\d{0,15}$/.test(req.params.id))return fehler(res,404,'nicht_gefunden');
 const b=db.prepare('SELECT id,benutzer_id,kurs_id,art,betrag,waehrung,erstellt,status,grund,zahlung_id,stripe_sitzung,stripe_abo FROM bestellungen WHERE id=? AND benutzer_id=?').get(Number(req.params.id),user.id);
 if(!b)return fehler(res,404,'nicht_gefunden');
 if(b.betrag<=0)return fehler(res,404,'ellallas_nicht_bezahlt');
 if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length!==1||req.body.bestaetigt!==true)return fehler(res,400,'ellallas_bestaetigung_pflicht');
 const prev=db.prepare('SELECT * FROM ellallas WHERE bestellung_id=?').get(b.id);
 if(prev)return antwort(res,prev);
 // Rate-Limit je Konto, in der Datenbank (ueberlebt Neustart, nicht per IP-Wechsel umgehbar): hoechstens 20 neue Versuche pro Stunde.
 {const ts=Date.now();
  db.prepare('DELETE FROM ellallas_versuch WHERE zeit<?').run(ts-86400000);
  if(db.prepare('SELECT COUNT(*) n FROM ellallas_versuch WHERE benutzer_id=? AND zeit>=?').get(user.id,ts-3600000).n>=20)return fehler(res,429,'passwort_rate');
  db.prepare('INSERT INTO ellallas_versuch(benutzer_id,zeit) VALUES(?,?)').run(user.id,ts);}
 // Einmalkauf: Zustimmung haengt an der Checkout-Sitzung der Bestellung. Abo: die Bestellung ist eine Rechnung (in_...); die Zustimmung haengt an der
 // Checkout-Sitzung des Abos (abos.stripe_sitzung). Ist diese noch nicht bekannt (Checkout-Ereignis fehlt noch), gilt: keine Zustimmung (Widerruf erlaubt).
 const zustimmung=b.art==='abo'
  ?db.prepare('SELECT 1 FROM kauf_zustimmung z JOIN abos a ON a.stripe_sitzung=z.stripe_sitzung WHERE a.stripe_abo=? AND a.benutzer_id=? AND a.kurs_id=? AND z.benutzer_id=? AND z.kurs_id=?').get(b.stripe_abo,user.id,b.kurs_id,user.id,b.kurs_id)
  :db.prepare('SELECT 1 FROM kauf_zustimmung WHERE stripe_sitzung=? AND benutzer_id=? AND kurs_id=?').get(b.stripe_sitzung,user.id,b.kurs_id);
 // Nur ein Zugriff NACH dieser Bestellung zaehlt (ein Zugriff aus frueherem Besitz desselben Kurses nicht).
 const erster=db.prepare('SELECT 1 FROM erster_zugriff WHERE benutzer_id=? AND kurs_id=? AND erster_zugriff>=?').get(user.id,b.kurs_id,b.erstellt);
 // M2/L7: Widerruf nur an der ERSTEN Abo-Zahlung und höchstens einmal je Kundin und Kurs (sonst endlos kostenloser Zugang durch Neu-Abschluss).
 const frueheresAbo=!!db.prepare("SELECT 1 FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND art='abo' AND id<?").get(user.id,b.kurs_id,b.id);
 const schonWiderrufen=b.art==='abo'&&!!db.prepare("SELECT 1 FROM ellallas e JOIN bestellungen o ON o.id=e.bestellung_id WHERE o.benutzer_id=? AND o.kurs_id=? AND o.art='abo' AND o.id<>? AND e.ergebnis IN ('bearbeitung','erstattung')").get(user.id,b.kurs_id,b.id);
 const entscheid=entscheidung({bestellung:b,zustimmung:!!zustimmung,ersterZugriff:!!erster,ersteAboZahlung:!frueheresAbo});
 const abgelehnt=b.status!=='bezahlt'||b.grund==='erstattung_voll'||schonWiderrufen?'abgelehnt_frist':entscheid==='erlaubt'?'bearbeitung':entscheid;
 let neu;
 try{
  neu=transaktion(()=>{
   const eintrag=db.prepare('INSERT OR IGNORE INTO ellallas(bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES(?,?,?,?,?)').run(b.id,now(),abgelehnt,null,now());
   if(!eintrag.changes)return false;
   db.prepare("INSERT OR IGNORE INTO ellallas_mail(bestellung_id,empfaenger) VALUES(?,'kunde')").run(b.id);
   db.prepare("INSERT OR IGNORE INTO ellallas_mail(bestellung_id,empfaenger) VALUES(?,'inhaber')").run(b.id);
   return true;
  });
 }catch{return fehler(res,503,'ellallas_fehler');}
 if(!neu)return antwort(res,db.prepare('SELECT * FROM ellallas WHERE bestellung_id=?').get(b.id));
 const stripe=req.app.locals.kontoStripe;
 if(abgelehnt!=='bearbeitung'){
  req.app.locals.ellallasMailSenden?.();
  return antwort(res,db.prepare('SELECT * FROM ellallas WHERE bestellung_id=?').get(b.id));
 }
 try{
  let abo=null;
  if(b.art==='abo'){
    const inv=await stripe.invoices.retrieve(b.stripe_sitzung);
    const sid=rechnungsAbo(inv);
    abo=sid?db.prepare('SELECT id,stripe_abo FROM abos WHERE stripe_abo=? AND benutzer_id=? AND kurs_id=?').get(sid,user.id,b.kurs_id):null;
    let ersteZahlung=inv.billing_reason==='subscription_create';
    if(abo&&!ersteZahlung){
      const history=await stripe.invoices.list({subscription:abo.stripe_abo,limit:ABO_RECHNUNGEN_MAX});
      if(!Array.isArray(history?.data))throw new Error('Invoice history unavailable');
      const bezahlt=history.data.filter(x=>x.status==='paid'&&Number.isSafeInteger(x.amount_paid)&&x.amount_paid>0)
        .sort((x,y)=>x.created-y.created);
      ersteZahlung=history.has_more!==true&&bezahlt[0]?.id===b.stripe_sitzung;
    }
    if(!abo||!ersteZahlung){
      db.prepare("UPDATE ellallas SET ergebnis='abgelehnt_frist',aktualisiert=? WHERE bestellung_id=?").run(now(),b.id);
      req.app.locals.ellallasMailSenden?.();
      return antwort(res,db.prepare('SELECT * FROM ellallas WHERE bestellung_id=?').get(b.id));
    }
  }
  let zeitgeber;
  const refund=await Promise.race([vollErstatten(stripe,b,'valore-ellallas-'+b.id),new Promise((_,nein)=>{zeitgeber=setTimeout(()=>nein(Object.assign(new Error('Stripe-Zeitueberschreitung'),{name:'ZeitUeberschreitung'})),ERSTATTUNG_ZEITLIMIT_MS);})]).finally(()=>clearTimeout(zeitgeber));
  if(!refund?.id||['failed','canceled'].includes(refund.status))throw new Error('Refund incomplete');
  // Die Erstattung ist erfolgt: Bestellung und Zugang sofort anpassen, noch VOR der Abo-Kündigung, damit das spätere
  // Stripe-Ereignis "Abo beendet" den bezahlten (und schon erstatteten) Zeitraum nicht wieder freischaltet.
  transaktion(()=>{
   db.prepare("UPDATE ellallas SET ergebnis='erstattung',erstattet_betrag=?,aktualisiert=? WHERE bestellung_id=?").run(Number.isSafeInteger(refund.erstattet_betrag)?refund.erstattet_betrag:null,now(),b.id);
   einmalErstattetBuchen(b);
   if(b.art==='abo'){
    db.prepare("UPDATE bestellungen SET status='erstattet',grund='erstattung_voll',geaendert=? WHERE id=? AND status='bezahlt'").run(now(),b.id);
    const andere=db.prepare("SELECT 1 FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND status='bezahlt' AND id!=?").get(user.id,b.kurs_id,b.id);
    if(!andere)db.prepare("DELETE FROM zugaenge WHERE benutzer_id=? AND kurs_id=? AND quelle='abo'").run(user.id,b.kurs_id);
    // Das Abo ist in der App SOFORT beendet (auch wenn Stripe gleich scheitert): sonst gäbe die nächste Rechnung wieder Zugang. Läuft es bei Stripe noch,
    // beendet der tägliche Abgleich es dort nach.
    if(abo?.stripe_abo)db.prepare("UPDATE abos SET status='beendet',geaendert=? WHERE stripe_abo=? AND status!='beendet'").run(now(),abo.stripe_abo);
   }
  });
  // Scheitert nur das Beenden bei Stripe, bleibt die Erstattung ein Erfolg (das Geld ist zurück): Hinweis an Gabriella, der Abgleich holt es nach.
  if(b.art==='abo'&&abo?.stripe_abo){
   try{await aboBeiStripeBeenden(stripe,abo.stripe_abo);}
   catch{db.prepare("UPDATE ellallas SET hinweis='stripe_abo',aktualisiert=? WHERE bestellung_id=?").run(now(),b.id);}
  }
 }catch(e){
  if(e?.name==='ZeitUeberschreitung'){
   // Stripe antwortet nicht: ob die Erstattung dort schon laeuft, ist unklar. Zeile bleibt 'bearbeitung'; die automatische Wiederaufnahme (gleicher Idempotenzschluessel) klaert es ohne Doppelerstattung.
   console.warn('Widerruf: Stripe-Zeitueberschreitung, Wiederaufnahme folgt');
   return antwort(res,db.prepare('SELECT * FROM ellallas WHERE bestellung_id=?').get(b.id));
  }
  console.warn('Widerruf: Erstattung fehlgeschlagen:',e?.type||e?.name||'',e?.code||'',String(e?.message||'').slice(0,160));
  db.prepare("UPDATE ellallas SET ergebnis='fehler',hinweis='stripe',aktualisiert=? WHERE bestellung_id=?").run(now(),b.id);
  db.prepare("INSERT OR IGNORE INTO ellallas_mail(bestellung_id,empfaenger) VALUES(?,'warnung')").run(b.id);
 }
 req.app.locals.ellallasMailSenden?.();
 return antwort(res,db.prepare('SELECT * FROM ellallas WHERE bestellung_id=?').get(b.id));
});
export const ellallasRouter=router;
