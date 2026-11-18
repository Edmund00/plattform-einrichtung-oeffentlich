import express from 'express';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {db,transaktion} from './db.mjs';
import {nurAdmin} from './routes-kurse.mjs';
import {fehler} from './texte.mjs';
const router=express.Router(),adminRouter=express.Router(),zeit=()=>new Date().toISOString();
const rate=new Map(),FELDER=['titel','beschreibung','preis_cent'];
const reinigen=v=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ')
  .replace(/vat_[A-Za-z0-9_-]+/g,'[geschuetzt]')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,'[email]').slice(0,120);
const id=v=>/^[1-9]\d{0,15}$/.test(String(v))?Number(v):null;
export const agentAudit=(schluessel,aktion,ziel,ergebnis,beschreibung='')=>{
  db.prepare('INSERT INTO agent_protokoll(zeit,schluessel_id,aktion,ziel,ergebnis,beschreibung) VALUES(?,?,?,?,?,?)')
    .run(zeit(),schluessel||null,reinigen(aktion),reinigen(ziel),ergebnis,reinigen(beschreibung));
};
// Fehlversuche ohne gültigen Schlüssel dürfen das Protokoll nicht fluten: höchstens 30 Einträge pro Minute für alle zusammen.
const anonym={start:0,n:0};
const authAudit=(schluessel,aktion,code)=>{
  const jetzt=Date.now();
  if(jetzt-anonym.start>=60000){anonym.start=jetzt;anonym.n=0;}
  if(++anonym.n<=30)agentAudit(schluessel,aktion,'','abgelehnt',code);
};
const fail=(res,status,code,token,action,target)=>{
  agentAudit(token,action,target,'abgelehnt',code);return fehler(res,status,code);
};
function feld(v,name){
  if(typeof v==='string'&&/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))return null;
  if(name==='titel')return typeof v==='string'&&v.trim().length>0&&v.trim().length<=160?v.trim():null;
  if(name==='beschreibung')return typeof v==='string'&&v.length<=5000?v:null;
  if(name==='preis_cent')return Number.isSafeInteger(v)&&v>=0&&v<=1000000000&&v%100===0?v:null;
  if(name==='inhalt')return typeof v==='string'&&v.length<=20000?v:null;
  if(name==='reihenfolge')return Number.isSafeInteger(v)&&v>=0&&v<=100000?v:null;
  return null;
}
function bodyPruefen(b,erlaubt,pflicht=[]){
 if(!b||typeof b!=='object'||Array.isArray(b)||!Object.keys(b).length)return false;
 if(Object.keys(b).some(k=>!erlaubt.includes(k))||pflicht.some(k=>!Object.hasOwn(b,k)))return false;
 return Object.keys(b).every(k=>feld(b[k],k)!==null);
}
const kursLesen=k=>({id:k.id,titel:k.titel,beschreibung:k.beschreibung,status:k.status,preis_cent:k.preis_cent,waehrung:k.waehrung,
 lektionen:db.prepare('SELECT id,titel,inhalt,reihenfolge FROM lektionen WHERE kurs_id=? ORDER BY reihenfolge,id').all(k.id)});
function nurEntwurf(req,res,kursId){
 const k=db.prepare('SELECT id,status FROM kurse WHERE beispiel_key IS NULL AND id=?').get(kursId);
 if(!k)return fail(res,404,'nicht_gefunden',req.agent.id,req.path,kursId);
 if(k.status!=='entwurf')return fail(res,403,'agent_nur_entwurf',req.agent.id,req.path,kursId);
 return k;
}
router.use((req,res,next)=>{
 res.setHeader('Cache-Control','no-store');
 const value=req.headers.authorization||'';
 const allowed=/^Bearer vat_[A-Za-z0-9_-]{43}$/.test(value);
 if(req.headers.cookie){authAudit(null,req.method+' '+req.path,'cookie_not_allowed');return fehler(res,401,'agent_auth');}
 if(!allowed){authAudit(null,req.method+' '+req.path,'agent_auth');return fehler(res,401,'agent_auth');}
 const digest=createHash('sha256').update(value.slice(7)).digest();
 let found=null;
 // Hashvergleich wird auch bei unbekannten Token zeitkonstant ausgeführt.
 for(const k of db.prepare('SELECT id,schluessel_hash,widerrufen_am,laeuft_ab FROM agent_schluessel').all()){
   const buf=Buffer.from(k.schluessel_hash,'hex');
   if(buf.length===digest.length&&timingSafeEqual(buf,digest))found=k;
 }
 if(!found||found.widerrufen_am||(found.laeuft_ab&&Date.parse(found.laeuft_ab)<=Date.now())){
   authAudit(found?.id||null,req.method+' '+req.path,'agent_auth');return fehler(res,401,'agent_auth');
 }
 req.agent={id:found.id};
 const time=Date.now(),previous=rate.get(found.id);
 if(!previous||time-previous.start>=60000)rate.set(found.id,{start:time,n:1});
 else if(++previous.n>60)return fail(res,429,'agent_limit',found.id,req.method+' '+req.path,'');
 db.prepare('UPDATE agent_schluessel SET zuletzt_benutzt=? WHERE id=?').run(zeit(),found.id);
 next();
});
router.get('/kurse',(req,res)=>{
 const k=db.prepare("SELECT id,titel,beschreibung,status,preis_cent,waehrung FROM kurse WHERE beispiel_key IS NULL ORDER BY id DESC LIMIT 100").all();
 agentAudit(req.agent.id,'liste','kurse','ok');res.json(k.map(kursLesen));
});
router.get('/kurse/:id',(req,res)=>{
 const k=db.prepare('SELECT id,titel,beschreibung,status,preis_cent,waehrung FROM kurse WHERE beispiel_key IS NULL AND id=?').get(id(req.params.id));
 if(!k)return fail(res,404,'nicht_gefunden',req.agent.id,'lesen',req.params.id);
 agentAudit(req.agent.id,'lesen',k.id,'ok');res.json(kursLesen(k));
});
router.post('/kurse',(req,res)=>{
 if(!bodyPruefen(req.body,FELDER,['titel']))return fail(res,400,'agent_felder',req.agent.id,'anlegen','');
 const created=transaktion(()=>{
  if(db.prepare("SELECT COUNT(*) n FROM kurse WHERE beispiel_key IS NULL AND status IN ('entwurf','freigabe_offen')").get().n>=50)return null;
  const b=req.body,z=zeit();
  const r=db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,?,'huf','entwurf',?,?)")
   .run(feld(b.titel,'titel'),b.beschreibung??'',b.preis_cent??0,z,z);
  return Number(r.lastInsertRowid);
 });
 if(!created)return fail(res,409,'agent_entwurf_limit',req.agent.id,'anlegen','');
 agentAudit(req.agent.id,'anlegen',created,'ok');res.status(201).json(kursLesen(db.prepare('SELECT id,titel,beschreibung,status,preis_cent,waehrung FROM kurse WHERE id=?').get(created)));
});
router.patch('/kurse/:id',(req,res)=>{
 const k=nurEntwurf(req,res,id(req.params.id));if(!k?.id)return;
 if(!bodyPruefen(req.body,FELDER))return fail(res,400,'agent_felder',req.agent.id,'aendern',k.id);
 const columns=Object.keys(req.body),values=columns.map(x=>feld(req.body[x],x));
 db.prepare('UPDATE kurse SET '+columns.map(x=>x+'=?').join(',')+',geaendert=? WHERE id=? AND status=\'entwurf\'').run(...values,zeit(),k.id);
 agentAudit(req.agent.id,'aendern',k.id,'ok');res.json({ok:true});
});
router.post('/kurse/:id/lektionen',(req,res)=>{
 const k=nurEntwurf(req,res,id(req.params.id));if(!k?.id)return;
 if(!bodyPruefen(req.body,['titel','inhalt','reihenfolge'],['titel']))return fail(res,400,'agent_felder',req.agent.id,'lektion_anlegen',k.id);
 const z=zeit(),b=req.body;
 const r=db.prepare("INSERT INTO lektionen(kurs_id,titel,art,inhalt,reihenfolge,status,erstellt,geaendert) VALUES(? ,?,'text',?,?,'entwurf',?,?)")
 .run(k.id,feld(b.titel,'titel'),b.inhalt??'',b.reihenfolge??db.prepare('SELECT COALESCE(MAX(reihenfolge),0)+1 n FROM lektionen WHERE kurs_id=?').get(k.id).n,z,z);
 agentAudit(req.agent.id,'lektion_anlegen',r.lastInsertRowid,'ok');res.status(201).json({id:Number(r.lastInsertRowid)});
});
router.patch('/lektionen/:id',(req,res)=>{
 const l=db.prepare('SELECT l.id,l.kurs_id,k.status FROM lektionen l JOIN kurse k ON k.id=l.kurs_id WHERE k.beispiel_key IS NULL AND l.id=?').get(id(req.params.id));
 if(!l)return fail(res,404,'nicht_gefunden',req.agent.id,'lektion_aendern',req.params.id);
 if(l.status!=='entwurf')return fail(res,403,'agent_nur_entwurf',req.agent.id,'lektion_aendern',l.id);
 if(!bodyPruefen(req.body,['titel','inhalt','reihenfolge']))return fail(res,400,'agent_felder',req.agent.id,'lektion_aendern',l.id);
 const columns=Object.keys(req.body),values=columns.map(x=>feld(req.body[x],x));
 db.prepare('UPDATE lektionen SET '+columns.map(x=>x+'=?').join(',')+',geaendert=? WHERE id=?').run(...values,zeit(),l.id);
 agentAudit(req.agent.id,'lektion_aendern',l.id,'ok');res.json({ok:true});
});
router.delete('/lektionen/:id',(req,res)=>{
 const l=db.prepare('SELECT l.id,l.kurs_id,k.status FROM lektionen l JOIN kurse k ON k.id=l.kurs_id WHERE k.beispiel_key IS NULL AND l.id=?').get(id(req.params.id));
 if(!l)return fail(res,404,'nicht_gefunden',req.agent.id,'lektion_loeschen',req.params.id);
 if(l.status!=='entwurf')return fail(res,403,'agent_nur_entwurf',req.agent.id,'lektion_loeschen',l.id);
 // Ausschließlich agentgeschriebene Textlektionen ohne hochgeladene Datei.
 if(db.prepare('SELECT 1 FROM dateien WHERE lektion_id=?').get(l.id))return fail(res,403,'agent_nur_entwurf',req.agent.id,'lektion_loeschen',l.id);
 db.prepare('DELETE FROM lektionen WHERE id=?').run(l.id);agentAudit(req.agent.id,'lektion_loeschen',l.id,'ok');res.json({ok:true});
});
router.delete('/kurse/:id',(req,res)=>{
 const k=nurEntwurf(req,res,id(req.params.id));if(!k?.id)return;
 const result=transaktion(()=>{
  if(db.prepare('SELECT 1 FROM dateien d JOIN lektionen l ON l.id=d.lektion_id WHERE l.kurs_id=?').get(k.id)||
     db.prepare('SELECT 1 FROM bestellungen WHERE kurs_id=?').get(k.id)||
     db.prepare('SELECT 1 FROM zugaenge WHERE kurs_id=?').get(k.id)||
     db.prepare('SELECT 1 FROM abos WHERE kurs_id=?').get(k.id)||
     db.prepare('SELECT 1 FROM agent_antraege WHERE kurs_id=?').get(k.id))return false;
  return db.prepare("DELETE FROM kurse WHERE beispiel_key IS NULL AND id=? AND status='entwurf'").run(k.id).changes===1;
 });
 if(!result)return fail(res,403,'agent_verboten',req.agent.id,'kurs_loeschen',k.id);
 agentAudit(req.agent.id,'kurs_loeschen',k.id,'ok');res.json({ok:true});
});
router.post('/kurse/:id/freigabe',(req,res)=>{
 const k=nurEntwurf(req,res,id(req.params.id));if(!k?.id)return;
 if(req.body&&Object.keys(req.body).length)return fail(res,400,'agent_felder',req.agent.id,'freigabe',k.id);
 const request=transaktion(()=>{
  db.prepare("UPDATE kurse SET status='freigabe_offen',geaendert=? WHERE id=? AND status='entwurf'").run(zeit(),k.id);
  return db.prepare("INSERT INTO agent_antraege(kurs_id,schluessel_id,art,vorher,nachher,erstellt) VALUES(?,?,'veroeffentlichen','entwurf','veroeffentlicht',?)").run(k.id,req.agent.id,zeit()).lastInsertRowid;
 });
 agentAudit(req.agent.id,'freigabe_beantragen',k.id,'ok');res.status(201).json({antrag_id:Number(request)});
});
router.post('/kurse/:id/vorschlag',(req,res)=>{
 const k=db.prepare('SELECT id,status,titel,beschreibung,preis_cent FROM kurse WHERE beispiel_key IS NULL AND id=?').get(id(req.params.id));
 if(!k)return fail(res,404,'nicht_gefunden',req.agent.id,'vorschlag',req.params.id);
 if(k.status!=='veroeffentlicht')return fail(res,403,'agent_nur_veroeffentlicht',req.agent.id,'vorschlag',k.id);
 if(!req.body||Array.isArray(req.body)||Object.keys(req.body).length!==2||!Object.hasOwn(req.body,'feld')||!Object.hasOwn(req.body,'wert')||!FELDER.includes(req.body.feld))return fail(res,400,'agent_felder',req.agent.id,'vorschlag',k.id);
 const feldname=req.body.feld,v=feld(req.body.wert,feldname);
 if(v===null)return fail(res,400,'agent_felder',req.agent.id,'vorschlag',k.id);
 const r=db.prepare("INSERT INTO agent_antraege(kurs_id,schluessel_id,art,feld,vorher,nachher,erstellt) VALUES(?,?,'aendern',?,?,?,?)")
 .run(k.id,req.agent.id,feldname,String(k[feldname]),String(v),zeit());
 agentAudit(req.agent.id,'vorschlag',k.id,'ok');res.status(201).json({antrag_id:Number(r.lastInsertRowid)});
});
router.use((req,res)=>fail(res,403,'agent_verboten',req.agent.id,req.method,req.path));
export const agentRouter=router;
adminRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
adminRouter.use(nurAdmin);
adminRouter.post('/schluessel',(req,res)=>{
 const b=req.body;
 if(!b||Array.isArray(b)||Object.keys(b).some(x=>!['name','laeuft_ab'].includes(x))||typeof b.name!=='string'||!b.name.trim()||b.name.length>80||/[\u0000-\u001f\u007f]/.test(b.name)||/vat_[A-Za-z0-9_-]+/.test(b.name)||
 (b.laeuft_ab!==undefined&&(typeof b.laeuft_ab!=='string'||!Number.isFinite(Date.parse(b.laeuft_ab))||Date.parse(b.laeuft_ab)<=Date.now())))return fehler(res,400,'agent_felder');
 const result=transaktion(()=>{
  if(db.prepare("SELECT COUNT(*) n FROM agent_schluessel WHERE widerrufen_am IS NULL AND (laeuft_ab IS NULL OR laeuft_ab>?)").get(zeit()).n>=5)return null;
  const secret='vat_'+randomBytes(32).toString('base64url');
  const hash=createHash('sha256').update(secret).digest('hex');
  const row=db.prepare('INSERT INTO agent_schluessel(name,schluessel_hash,vorschau,erstellt,laeuft_ab) VALUES(?,?,?,?,?)')
   .run(b.name.trim(),hash,secret.slice(0,8),zeit(),b.laeuft_ab?new Date(b.laeuft_ab).toISOString():null);
  return {id:Number(row.lastInsertRowid),schluessel:secret};
 });
 if(!result)return fehler(res,409,'agent_schluessel_limit');
 agentAudit(null,'schluessel_anlegen',result.id,'ok');res.status(201).json(result);
});
adminRouter.get('/schluessel',(_req,res)=>res.json(db.prepare('SELECT id,name,vorschau,erstellt,zuletzt_benutzt,widerrufen_am,laeuft_ab FROM agent_schluessel ORDER BY id DESC').all()));
adminRouter.post('/schluessel/:id/widerrufen',(req,res)=>{
 if(!id(req.params.id))return fehler(res,404,'nicht_gefunden');
 const r=db.prepare('UPDATE agent_schluessel SET widerrufen_am=? WHERE id=? AND widerrufen_am IS NULL').run(zeit(),id(req.params.id));
 if(!r.changes)return fehler(res,404,'nicht_gefunden');
 agentAudit(null,'schluessel_widerrufen',req.params.id,'ok');res.json({ok:true});
});
adminRouter.get('/antraege',(_req,res)=>res.json(db.prepare("SELECT a.id,a.kurs_id,a.art,a.feld,a.vorher,a.nachher,a.erstellt,k.titel,k.beschreibung,k.waehrung FROM agent_antraege a JOIN kurse k ON k.id=a.kurs_id WHERE k.beispiel_key IS NULL AND a.status='offen' ORDER BY a.id").all()));
adminRouter.post('/antraege/:id/entscheiden',(req,res)=>{
 if(!id(req.params.id)||!req.body||Object.keys(req.body).length!==1||!['freigeben','ablehnen'].includes(req.body.entscheidung))return fehler(res,400,'agent_felder');
 const r=transaktion(()=>{
  const a=db.prepare("SELECT a.*,k.status AS kurs_status,k.titel,k.beschreibung,k.preis_cent FROM agent_antraege a JOIN kurse k ON k.id=a.kurs_id WHERE k.beispiel_key IS NULL AND a.id=?").get(id(req.params.id));
  if(!a||a.status!=='offen')return false;
  if(req.body.entscheidung==='freigeben'){
   if(a.art==='veroeffentlichen'){
    if(a.kurs_status!=='freigabe_offen')return false;
    db.prepare("UPDATE kurse SET status='veroeffentlicht',geaendert=? WHERE beispiel_key IS NULL AND id=? AND status='freigabe_offen'").run(zeit(),a.kurs_id);
    // Text-Lektionen werden erst beim menschlichen Freigabeklick veröffentlicht.
    db.prepare("UPDATE lektionen SET status='veroeffentlicht' WHERE kurs_id=? AND status='entwurf'").run(a.kurs_id);
   }else{
    if(a.kurs_status!=='veroeffentlicht'||!FELDER.includes(a.feld)||String(a[a.feld])!==a.vorher)return false;
    const v=a.feld==='preis_cent'?Number(a.nachher):a.nachher;
    if(feld(v,a.feld)===null)return false;
    db.prepare('UPDATE kurse SET '+a.feld+'=?,geaendert=? WHERE id=?').run(feld(v,a.feld),zeit(),a.kurs_id);
   }
  }else if(a.art==='veroeffentlichen'){
   db.prepare("UPDATE kurse SET status='entwurf',geaendert=? WHERE id=? AND status='freigabe_offen'").run(zeit(),a.kurs_id);
  }
  db.prepare('UPDATE agent_antraege SET status=?,entschieden=? WHERE id=? AND status=\'offen\'')
   .run(req.body.entscheidung==='freigeben'?'freigegeben':'abgelehnt',zeit(),a.id);
  return true;
 });
 if(!r)return fehler(res,409,'agent_antrag_erledigt');
 agentAudit(null,'entscheidung',req.params.id,'ok');res.json({ok:true});
});
adminRouter.get('/protokoll',(_req,res)=>res.json(db.prepare('SELECT zeit,aktion,ziel,ergebnis,beschreibung FROM agent_protokoll ORDER BY id DESC LIMIT 200').all()));
export const agentAdminRouter=adminRouter;
