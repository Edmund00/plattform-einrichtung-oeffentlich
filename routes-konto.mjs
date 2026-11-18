// Scheibe 18: Kundenkonto. Keine Kauf-, Webhook- oder Wiedergaberouten werden verändert.
import express from 'express';
import { plattformSlug } from './marke.mjs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { db, transaktion } from './db.mjs';
import { aktuellerBenutzer, aktuellesToken, sitzungFingerabdruck, passwortPruefen, emailPruefen, cookieLoeschen } from './auth.mjs';
import { fehler, fehlerSeite, HU, sprache, locale } from './texte.mjs';
import { titelUebersetzt, beschreibungUebersetzt } from './demo-uebersetzung.mjs';
import { quittungVonStripe } from './beleg.mjs';
import { auskunftUngarisch } from './auskunft-hu.mjs';
import { stripeKundeVormerken, stripeKundenNachholen } from './stripe-kunde-loeschen.mjs';

const router=express.Router();
const tokenFormat=/^[A-Za-z0-9_-]{43}$/;
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
const limits=new Map();
function rate(key,max=5) {
  const now=Date.now(), stunden=3600000;
  if(!limits.has(key)&&limits.size>=10000){
    for(const [k,v] of limits)if(now-v.time>=stunden)limits.delete(k);
    if(limits.size>=10000)return false;
  }
  const v=limits.get(key);
  if(!v||now-v.time>=stunden){limits.set(key,{time:now,n:1});return true;}
  v.n++;return v.n<=max;
}
const exakt=(b,keys)=>!!b&&typeof b==='object'&&!Array.isArray(b)&&Object.keys(b).every(k=>keys.includes(k));
const konto=(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const b=aktuellerBenutzer(req);
  if(!b)return fehler(res,401,'nicht_angemeldet');
  if(b.rolle==='admin')return fehler(res,403,'konto_nur_kunde');
  req.konto=b;next();
};
// Beleg-Link wird als Seite geöffnet: ohne Anmeldung ungarische Fehlerseite statt JSON.
const kontoSeite=(req,res,next)=>{
  const b=aktuellerBenutzer(req);
  if(!b||b.rolle==='admin'){res.setHeader('Cache-Control','no-store');return fehlerSeite(req,res,b?403:401,b?'konto_nur_kunde':'nicht_angemeldet');}
  return konto(req,res,next);
};
const daten=id=>db.prepare('SELECT id,email,erstellt,email_bestaetigt FROM benutzer WHERE id=? AND geloescht IS NULL').get(id);
// Auskunft nennt auch altgespeicherte Felder (frueher in Fiokom eingebbar), damit keine gespeicherten Personendaten fehlen.
const datenVoll=id=>db.prepare('SELECT id,email,erstellt,email_bestaetigt,anzeigename,rechnung_name,rechnung_land,rechnung_plz,rechnung_ort,rechnung_strasse,rechnung_steuernr,einwilligung_zeit,einwilligung_version FROM benutzer WHERE id=? AND geloescht IS NULL').get(id);
const bestellungen=id=>db.prepare(
  "SELECT b.id,b.erstellt,b.betrag,b.waehrung,b.status,b.grund,b.art,k.titel AS kurs,k.id AS kurs_id,"+
  "(SELECT e.ergebnis FROM ellallas e WHERE e.bestellung_id=b.id) AS ellallas_ergebnis,a.id AS abo_id,a.status AS abo_status,a.endet_zum_periodenende,a.gueltig_bis AS abo_ende FROM bestellungen b LEFT JOIN kurse k ON k.id=b.kurs_id "+
  "LEFT JOIN abos a ON a.id=(SELECT aa.id FROM abos aa WHERE aa.benutzer_id=b.benutzer_id AND aa.kurs_id=b.kurs_id ORDER BY aa.id DESC LIMIT 1) "+
  "WHERE b.benutzer_id=? ORDER BY b.id DESC"
).all(id).map(b=>({...b,kurs:titelUebersetzt(b.kurs),
  // Backlog b/Teil 2 (12.11.2026): Erstattung beim Widerruf fehlgeschlagen ODER von Hand ohne Erstattung abgeschlossen (ellallas_erledigt).
  // Dann zeigt das Konto "Erstattung fehlgeschlagen – bitte kontaktiere den Anbieter" und nie "Erstattet", auch wenn die Bestellung anders markiert ist.
  // Refund-Failed (12.11.2026): ebenso, wenn Stripe eine Erstattung dieser Bestellung nachtraeglich als fehlgeschlagen/abgebrochen meldet und der Eintrag
  // noch offen ist (erstattung_fehler; auch bei Teilerstattung, Bestellung bleibt dann "bezahlt").
  erstattung_fehlgeschlagen:b.ellallas_ergebnis==='fehler'||!!erledigtFrage.get(b.id)||!!stripeFehlerFrage.get(b.id)}));
const erledigtFrage=db.prepare('SELECT 1 FROM ellallas_erledigt WHERE bestellung_id=?');
const stripeFehlerFrage=db.prepare("SELECT 1 FROM erstattung_fehler WHERE bestellung_id=? AND status IN ('fehlgeschlagen','abgebrochen')");
// Datenauskunft: alle Stripe-Erstattungsfehler zu den eigenen Bestellungen (auch geloeste, mit Zeitpunkt), ohne interne Ereigniszeit.
const erstattungFehlerListe=id=>db.prepare('SELECT f.refund_id,f.bestellung_id,f.zeit,f.betrag,f.waehrung,f.status,f.geloest FROM erstattung_fehler f JOIN bestellungen b ON b.id=f.bestellung_id WHERE b.benutzer_id=? ORDER BY f.zeit DESC,f.refund_id').all(id);
const BELEG_HOST='pay.stripe.com';
const belegLimit=new Map();
router.get('/api/bestellungen/:id/beleg',kontoSeite,async(req,res)=>{
  if(!/^[1-9]\d{0,15}$/.test(req.params.id))return fehlerSeite(req,res,404,'nicht_gefunden');
  const b=db.prepare('SELECT id,benutzer_id,stripe_sitzung,zahlung_id,status,grund,art,betrag FROM bestellungen WHERE id=? AND benutzer_id=?')
    .get(Number(req.params.id),req.konto.id);
  if(!b)return fehlerSeite(req,res,404,'nicht_gefunden');
  if(b.status!=='bezahlt'||b.grund==='erstattung_voll'||b.betrag===0)return fehlerSeite(req,res,404,'beleg_nicht_verfuegbar');
  const key=String(req.konto.id)+'|'+String(req.ip);
  const now=Date.now(),old=belegLimit.get(key);
  if(!old||now-old.start>=3600000)belegLimit.set(key,{start:now,count:1});
  else if(++old.count>10)return fehlerSeite(req,res,429,'passwort_rate');
  if(belegLimit.size>10000)for(const [k,v] of belegLimit)if(now-v.start>=3600000)belegLimit.delete(k);
  try{
    const receipt=await quittungVonStripe(req.app.locals.kontoStripe,b);
    if(!receipt)return fehlerSeite(req,res,503,'beleg_nicht_erreichbar');
    const ziel=new URL(receipt);
    if(ziel.protocol!=='https:'||ziel.hostname!==BELEG_HOST||ziel.port||ziel.username||ziel.password)
      return fehlerSeite(req,res,502,'beleg_domain_fehler');
    if(!ziel.pathname.startsWith('/receipts/'))return fehlerSeite(req,res,502,'beleg_domain_fehler');
    // Nur Quittungen mit Query (Abo-Rechnung) haben ein PDF; die Quittung eines Einmalkaufs hat keine und bleibt die Stripe-Seite (mit Download-Knopf).
    if(ziel.search)ziel.pathname=ziel.pathname.replace(/\/$/,'')+'/pdf';
    return res.redirect(302,ziel.toString());
  }catch{
    return fehlerSeite(req,res,503,'beleg_nicht_erreichbar');
  }
});
// Direkter Stripe-Kündigungsablauf. Kein Statuswechsel vor bestätigtem Webhook.
router.post('/api/abo/lemondas',konto,async(req,res)=>{
  if(!exakt(req.body??{},['abo_id'])||Object.keys(req.body??{}).length>1||
    (req.body?.abo_id!==undefined&&(!Number.isSafeInteger(req.body.abo_id)||req.body.abo_id<1)))
    return fehler(res,400,'konto_felder_ungueltig');
  if(!rate('abo-lemondas:'+hash(String(req.ip)+'|'+req.konto.id),10))
    return fehler(res,429,'passwort_rate');
  const auswahl=req.body?.abo_id;
  // Wie der Knopf in kunde.js: auch ein Abo mit offener Zahlung (zahlung_offen) laesst sich kuendigen.
  const abo=auswahl===undefined
    ?db.prepare("SELECT * FROM abos WHERE benutzer_id=? AND status IN ('aktiv','zahlung_offen') AND endet_zum_periodenende=0 ORDER BY id DESC LIMIT 1").get(req.konto.id)
    :db.prepare("SELECT * FROM abos WHERE id=? AND benutzer_id=? AND status IN ('aktiv','zahlung_offen') AND endet_zum_periodenende=0").get(auswahl,req.konto.id);
  if(!abo)return fehler(res,auswahl===undefined?409:404,auswahl===undefined?'abo_kein_aktives':'nicht_gefunden');
  if(!req.konto.stripe_kunde)return fehler(res,503,'abo_lemondas_fehler');
  try{
    const base=req.app.locals.kontoBase;
    const sitzung=await req.app.locals.kontoStripe.billingPortal.sessions.create({
      customer:req.konto.stripe_kunde,return_url:base+'/#/fiokom',locale: sprache(),
      flow_data:{type:'subscription_cancel',
        subscription_cancel:{subscription:abo.stripe_abo},
        after_completion:{type:'redirect',redirect:{return_url:base+'/#/fiokom?abo=lemondva'}}}
    });
    const url=new URL(sitzung?.url);
    if(url.protocol!=='https:'||url.hostname!=='billing.stripe.com'||url.username||url.password||
      url.port||!url.pathname.startsWith('/'))return fehler(res,502,'abo_lemondas_fehler');
    return res.json({url:url.toString()});
  }catch{return fehler(res,503,'abo_lemondas_fehler');}
});
router.get('/api/konto',konto,(req,res)=>{
  const b=daten(req.konto.id);
  if(!b)return fehler(res,401,'nicht_angemeldet');
  return res.json({daten:b,bestellungen:bestellungen(b.id)});
});
router.get('/api/konto/auskunft',konto,(req,res)=>{
  const b=daten(req.konto.id);
  if(!b)return fehler(res,401,'nicht_angemeldet');
  const zugaenge=db.prepare('SELECT z.kurs_id,k.titel,z.gueltig_bis FROM zugaenge z LEFT JOIN kurse k ON k.id=z.kurs_id WHERE z.benutzer_id=? ORDER BY z.kurs_id').all(b.id);
  const vorherige_emails=db.prepare('SELECT email,bis FROM konto_email_historie WHERE benutzer_id=? ORDER BY bis DESC').all(b.id);
  const erklaerungen=db.prepare('SELECT e.bestellung_id,e.zeit,e.ergebnis,e.hinweis FROM ellallas e JOIN bestellungen o ON o.id=e.bestellung_id WHERE o.benutzer_id=? ORDER BY e.zeit DESC').all(b.id);
  const zustimmungen=db.prepare('SELECT kurs_id,text_version,zeit FROM kauf_zustimmung WHERE benutzer_id=? ORDER BY zeit DESC').all(b.id);
  const erste_zugriffe=db.prepare('SELECT kurs_id,erster_zugriff FROM erster_zugriff WHERE benutzer_id=? ORDER BY erster_zugriff DESC').all(b.id);
  // Block 3: Downloads von Download-Produkten (Kurs, Lektion, Sprache, Zeit). Bleiben bei Kontoloeschung wie erster_zugriff pseudonym erhalten (docs/AUFBEWAHRUNG.md).
  const downloads=db.prepare('SELECT kurs_id,lektion_id,sprache,zeit FROM download_protokoll WHERE benutzer_id=? ORDER BY zeit DESC,id DESC').all(b.id);
  const antwort={daten:datenVoll(b.id),bestellungen:bestellungen(b.id),zugaenge,vorherige_emails,erklaerungen,zustimmungen,erste_zugriffe,downloads,fehlgeschlagene_erstattungen:erstattungFehlerListe(b.id)};
  res.setHeader('Content-Disposition','attachment; filename="'+plattformSlug()+'-adataim.json"');
  return res.type('application/json; charset=utf-8').send(JSON.stringify(auskunftUngarisch(antwort)));
});
router.post('/api/konto/email-aendern',konto,async(req,res)=>{
  if(!exakt(req.body,['email','passwort'])||Object.keys(req.body).length!==2||
     typeof req.body.email!=='string'||typeof req.body.passwort!=='string')
    return fehler(res,400,'konto_felder_ungueltig');
  const key=hash(String(req.ip)+'|'+req.konto.id);
  if(!rate('email:'+key,5))return fehler(res,429,'passwort_rate');
  const neu=emailPruefen(req.body.email);
  if(!neu)return fehler(res,400,'email_ungueltig');
  const b=db.prepare('SELECT email,passwort_hash FROM benutzer WHERE id=? AND geloescht IS NULL').get(req.konto.id);
  if(!b||!await passwortPruefen(req.body.passwort,b.passwort_hash))return fehler(res,401,'passwort_aktuell_falsch');
  // Identische Antwort unabhängig davon, ob die Zieladresse schon verwendet wird.
  const neutral=()=>res.json({text:HU.konto_email_neutral});
  if(neu===b.email||db.prepare('SELECT id FROM benutzer WHERE email=?').get(neu))return neutral();
  if(!req.app.locals.kontoMailAktiv)return fehler(res,503,'konto_mail_fehlend');
  const token=randomBytes(32).toString('base64url'), jetzt=Date.now();
  transaktion(()=>{
    db.prepare('DELETE FROM email_aender_token WHERE benutzer_id=?').run(req.konto.id);
    db.prepare('INSERT INTO email_aender_token(benutzer_id,neue_email,token_hash,erstellt,laeuft_ab) VALUES(?,?,?,?,?)')
      .run(req.konto.id,neu,hash(token),jetzt,jetzt+86400000);
  });
  // Versand außerhalb der Transaktion. Bei Versandfehler den noch offenen Token entwerten.
  const ok=await req.app.locals.kontoMailSenden(neu,'email_pruefen',{link:req.app.locals.kontoBase+'/#/email-aendern/'+token});
  if(!ok)db.prepare('DELETE FROM email_aender_token WHERE token_hash=?').run(hash(token));
  return neutral();
});
router.post('/api/email-aendern-bestaetigen',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(!exakt(req.body,['token'])||Object.keys(req.body).length!==1||
    typeof req.body.token!=='string'||!tokenFormat.test(req.body.token))
    return fehler(res,400,'konto_token_ungueltig');
  if(!rate('token:'+hash(req.ip||''),10))return fehler(res,429,'passwort_rate');
  const finger=hash(req.body.token);
  const t=db.prepare('SELECT * FROM email_aender_token WHERE token_hash=?').get(finger);
  if(!timingSafeEqual(Buffer.from(finger,'hex'),Buffer.from(t?.token_hash||'0'.repeat(64),'hex'))||
    !t||t.benutzt!==null||t.laeuft_ab<=Date.now())
    return fehler(res,400,'konto_token_ungueltig');
  let alt;
  try{
    alt=transaktion(()=>{
      const b=db.prepare('SELECT email,geloescht FROM benutzer WHERE id=?').get(t.benutzer_id);
      if(!b||b.geloescht!==null||db.prepare('SELECT id FROM benutzer WHERE email=? AND id<>?').get(t.neue_email,t.benutzer_id))return null;
      if(db.prepare('UPDATE email_aender_token SET benutzt=? WHERE id=? AND benutzt IS NULL AND laeuft_ab>?')
        .run(Date.now(),t.id,Date.now()).changes!==1)return null;
      db.prepare('INSERT OR IGNORE INTO konto_email_historie(benutzer_id,email,bis) VALUES(?,?,?)').run(t.benutzer_id,b.email,Date.now());
      db.prepare('UPDATE benutzer SET email=?,email_bestaetigt=? WHERE id=?').run(t.neue_email,Date.now(),t.benutzer_id);
      db.prepare('DELETE FROM sitzungen WHERE benutzer_id=?').run(t.benutzer_id);
      db.prepare('UPDATE email_token SET benutzt=? WHERE benutzer_id=? AND benutzt IS NULL').run(Date.now(),t.benutzer_id);
      db.prepare('DELETE FROM email_aender_token WHERE benutzer_id=? AND id<>?').run(t.benutzer_id,t.id);
      db.prepare('UPDATE passwort_token SET benutzt=? WHERE benutzer_id=? AND benutzt IS NULL').run(Date.now(),t.benutzer_id);
      return b.email;
    });
  }catch{return fehler(res,400,'konto_token_ungueltig');}
  if(!alt)return fehler(res,400,'konto_token_ungueltig');
  // Die alte Adresse bekommt eine Sicherheitsmitteilung, aber keinen Token.
  void req.app.locals.kontoMailSenden?.(alt,'email_geaendert',{}).catch(()=>{});
  return res.json({text:HU.konto_email_fertig});
});
router.post('/api/konto/loeschen',konto,async(req,res)=>{
  if(!exakt(req.body,['passwort','bestaetigt'])||Object.keys(req.body).length!==2||
    req.body.bestaetigt!==true||typeof req.body.passwort!=='string')
    return fehler(res,400,'konto_loeschung_bestaetigen');
  if(!rate('loeschen:'+hash(String(req.ip)+'|'+req.konto.id),5))return fehler(res,429,'passwort_rate');
  const b=db.prepare('SELECT * FROM benutzer WHERE id=? AND geloescht IS NULL').get(req.konto.id);
  if(!b||!await passwortPruefen(req.body.passwort,b.passwort_hash))return fehler(res,401,'passwort_aktuell_falsch');
  if(db.prepare("SELECT 1 FROM abos WHERE benutzer_id=? AND status<>'beendet' AND endet_zum_periodenende=0 LIMIT 1").get(b.id))
    return fehler(res,409,'konto_abo_aktiv');
  const anonym='geloescht-'+b.id+'@invalid.invalid',now=Date.now(),stripeId=b.stripe_kunde,alt=b.email;
  transaktion(()=>{
    // Alle wartenden Nachrichten löschen, damit nie eine Zahlungskopie an die anonymisierte Adresse geht.
    db.prepare('DELETE FROM sitzungen WHERE benutzer_id=?').run(b.id);
    db.prepare('DELETE FROM passwort_token WHERE benutzer_id=?').run(b.id);
    db.prepare('DELETE FROM email_token WHERE benutzer_id=?').run(b.id);
    db.prepare('DELETE FROM email_aender_token WHERE benutzer_id=?').run(b.id);
    db.prepare('DELETE FROM email_ausgang WHERE benutzer_id=?').run(b.id);
    db.prepare('DELETE FROM mail_ausgang WHERE benutzer_id=?').run(b.id);
    db.prepare('DELETE FROM gratis_mail_ausgang WHERE benutzer_id=?').run(b.id);
    db.prepare('DELETE FROM zugang_mail_ausgang WHERE benutzer_id=?').run(b.id);   // Block 4
    db.prepare('DELETE FROM zugaenge WHERE benutzer_id=?').run(b.id);
    if(req.app.locals.kontoMailAktiv)db.prepare("INSERT INTO konto_mail_ausgang(benutzer_id,empfaenger,typ,erstellt) VALUES(?,?,'konto_geloescht',?)").run(b.id,alt,now);
    db.prepare('UPDATE benutzer SET email=?,passwort_hash=?,stripe_kunde=NULL,email_bestaetigt=NULL,anzeigename=NULL,rechnung_name=NULL,rechnung_land=NULL,rechnung_plz=NULL,rechnung_ort=NULL,rechnung_strasse=NULL,rechnung_steuernr=NULL,einwilligung_zeit=NULL,einwilligung_version=NULL,geloescht=? WHERE id=?')
      .run(anonym,'geloescht',now,b.id);
    db.prepare('DELETE FROM meldung_ausgang WHERE ereignis_id IN (SELECT id FROM ereignisse WHERE email=?)').run(alt);
    db.prepare('UPDATE ereignisse SET email=NULL WHERE email=?').run(alt);
    for(const altEmail of db.prepare('SELECT email,bis FROM konto_email_historie WHERE benutzer_id=?').all(b.id)){
      db.prepare('DELETE FROM meldung_ausgang WHERE ereignis_id IN (SELECT id FROM ereignisse WHERE email=? AND zeit<=?)').run(altEmail.email,altEmail.bis);
      db.prepare('UPDATE ereignisse SET email=NULL WHERE email=? AND zeit<=?').run(altEmail.email,altEmail.bis);
    }
    db.prepare('DELETE FROM konto_email_historie WHERE benutzer_id=?').run(b.id);
    // A6-01: Stripe-Kunden-ID vor dem Nullsetzen im Auftragsbuch vormerken (nur die cus_-ID); geloescht wird nach dem Commit, mit Wiederholung.
    stripeKundeVormerken(stripeId);
    // Bestellungen bleiben über die Benutzer-ID erhalten, persönliche Daten werden nicht übertragen.
  });
  cookieLoeschen(res,req.app.locals.kontoSecureCookies);
  res.json({text:HU.konto_geloescht_ok});
  // Nach COMMIT und HTTP-Antwort: externe Vorgänge können die Löschung nicht rückgängig machen.
  req.app.locals.kontoNachCommitSenden?.();
  if(stripeId)void stripeKundenNachholen(req.app.locals.kontoStripe);
});
export const kontoRouter=router;
