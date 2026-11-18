// Scheibe 31: Kurspaket als neuer ENTWURF, keine Veröffentlichung, keine Stripe-Aufrufe.
import express from 'express';
import {createHash} from 'node:crypto';
import {db,transaktion} from './db.mjs';
import {nurAdmin} from './routes-kurse.mjs';
import {fehler} from './texte.mjs';
const router=express.Router();
const MAX=300*1024;
const own=(o,allowed,path,err)=>{
 for(const k of Object.keys(o))if(!allowed.includes(k))err.push({pfad:path?path+'.'+k:k,code:'feld_unbekannt'});
};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const badText=s=>/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(s)||/<\s*(?:\/?\s*[a-z][^>]*|![^>]*|\?[^>]*\?)>/i.test(s);
const error=(a,p,c)=>a.push({pfad:p,code:c});
function parse(input){
 const errors=[];
 if(typeof input!=='string'){error(errors,'paket','paket_text');return {errors};}
 if(Buffer.byteLength(input,'utf8')>MAX){error(errors,'paket','paket_groesse');return {errors};}
 let raw=input.trim();
 if(raw.startsWith('```')){
   const m=/^\`\`\`(?:json)?\s*\n([\s\S]*?)\n\`\`\`$/i.exec(raw);
   if(!m){error(errors,'paket','paket_json');return {errors};}
   raw=m[1];
 }
 let x;try{x=JSON.parse(raw)}catch{error(errors,'paket','paket_json');return {errors};}
 if(!plain(x)){error(errors,'paket','paket_objekt');return {errors};}
 own(x,['format','kurs','lektionen'],'',errors);
 if(x.format!=='valore-kurspaket-v1')error(errors,'format','paket_format');
 if(!plain(x.kurs))error(errors,'kurs','paket_objekt');
 if(!Array.isArray(x.lektionen)||x.lektionen.length<1||x.lektionen.length>40)error(errors,'lektionen','paket_lektionen');
 const text=(v,p,min,max)=>{
  if(typeof v!=='string'||v.length<min||v.length>max){error(errors,p,'paket_text');return '';}
  if(badText(v)){error(errors,p,'paket_zeichen');return '';}
  return v;
 };
 const c=x.kurs;
 const kurs={titel:'',beschreibung:'',preis_forint:0};
 if(plain(c)){
  own(c,['titel','beschreibung','preis_forint','abo_preis_forint','abo_intervall'],'kurs',errors);
  kurs.titel=text(c.titel,'kurs.titel',1,160);
  kurs.beschreibung=text(c.beschreibung??'','kurs.beschreibung',0,5000);
  if(c.preis_forint!==undefined && (!Number.isSafeInteger(c.preis_forint)||c.preis_forint<0||c.preis_forint>10000000))
   error(errors,'kurs.preis_forint','paket_preis');
  else kurs.preis_forint=c.preis_forint??0;
  if(c.abo_preis_forint!==undefined&&c.abo_preis_forint!==null &&
     (!Number.isSafeInteger(c.abo_preis_forint)||c.abo_preis_forint<0||c.abo_preis_forint>10000000))
   error(errors,'kurs.abo_preis_forint','paket_preis');
  if(c.abo_intervall!==undefined&&!['month','year'].includes(c.abo_intervall))
   error(errors,'kurs.abo_intervall','paket_intervall');
 }
 const lektionen=[];
 if(Array.isArray(x.lektionen)&&x.lektionen.length<=40){
  x.lektionen.forEach((l,i)=>{
   const p='lektionen['+i+']';
   if(!plain(l)){error(errors,p,'paket_objekt');return;}
   own(l,['titel','inhalt','reihenfolge'],p,errors);
   const titel=text(l.titel,p+'.titel',1,160),inhalt=text(l.inhalt??'',p+'.inhalt',0,20000);
   if(l.reihenfolge!==undefined&&(!Number.isSafeInteger(l.reihenfolge)||l.reihenfolge<0||l.reihenfolge>1000000))
    error(errors,p+'.reihenfolge','paket_reihenfolge');
   lektionen.push({titel,inhalt,reihenfolge:l.reihenfolge??i+1});
  });
 }
 if(errors.length)return {errors};
 const canon={format:'valore-kurspaket-v1',kurs:{titel:kurs.titel,beschreibung:kurs.beschreibung,preis_forint:kurs.preis_forint},lektionen};
 const hash=createHash('sha256').update(JSON.stringify(canon)).digest('hex');
 const warnungen=[];
 if(c.abo_preis_forint!=null||c.abo_intervall!=null)warnungen.push('paket_abo_ignoriert');
 return {canon,hash,warnungen,errors:[]};
}
const now=()=>new Date().toISOString();
const audit=(uid,hash,title,count,result,message,id=null)=>db.prepare(
 "INSERT INTO kurspaket_protokoll(zeit,benutzer_id,paket_hash,titel,anzahl_lektionen,ergebnis,kurs_id,kurze_meldung) VALUES(?,?,?,?,?,?,?,?)"
).run(now(),uid,hash,title.slice(0,80),count,result,id,message.slice(0,100));
function freierTitel(titel){
 let name=titel,n=2;
 while(db.prepare('SELECT 1 FROM kurse WHERE titel=?').get(name)){
   const suffix=' ('+(n++)+')';name=titel.slice(0,160-suffix.length)+suffix;
 }
 return name;
}
function body(req,res){
 if(!plain(req.body)||Object.keys(req.body).length!==1||typeof req.body.paket!=='string'){
  return {errors:[{pfad:'paket',code:'paket_text'}]};
 }
 return parse(req.body.paket);
}
router.use('/api/admin/kurspaket',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
router.use('/api/admin/kurse/:id/kurspaket',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
router.post('/api/admin/kurspaket/pruefen',nurAdmin,(req,res)=>{
 const p=body(req,res);
 if(p.errors.length)return res.status(400).json({fehler:p.errors});
 const existing=db.prepare("SELECT k.titel FROM kurspaket_protokoll p JOIN kurse k ON k.id=p.kurs_id AND k.status='entwurf' WHERE p.paket_hash=? AND p.ergebnis='ok' AND julianday(p.zeit)>=julianday('now')-5.0/1440 ORDER BY p.id DESC LIMIT 1").get(p.hash);
 const title=existing?.titel??freierTitel(p.canon.kurs.titel);
 res.json({titel:title,anzahl_lektionen:p.canon.lektionen.length,
  zeichen:p.canon.lektionen.map(l=>l.inhalt.length),preis_forint:p.canon.kurs.preis_forint,
  warnungen:p.warnungen,vorhanden:!!existing,umbenannt:!existing&&title!==p.canon.kurs.titel});
});
router.post('/api/admin/kurspaket/anlegen',nurAdmin,(req,res)=>{
 const p=body(req,res),uid=req.benutzer.id;
 if(p.errors.length){
  const text=typeof req.body?.paket==='string'?req.body.paket:'';
  const hash=createHash('sha256').update(text).digest('hex');
  try{audit(uid,hash,'',0,'abgelehnt',p.errors[0]?.code||'format');}
  catch{console.warn('Kurspaket-Ablehnung nicht protokolliert');}
  return res.status(400).json({fehler:p.errors});
 }
 try{
  const result=transaktion(()=>{
   const existing=db.prepare("SELECT p.kurs_id FROM kurspaket_protokoll p JOIN kurse k ON k.id=p.kurs_id AND k.status='entwurf' WHERE p.paket_hash=? AND p.ergebnis='ok' AND julianday(p.zeit)>=julianday('now')-5.0/1440 ORDER BY p.id DESC LIMIT 1").get(p.hash);
   if(existing)return {kurs_id:existing.kurs_id,vorhanden:true};
   if(db.prepare("SELECT COUNT(*) n FROM kurse WHERE beispiel_key IS NULL AND status IN ('entwurf','freigabe_offen')").get().n>=50){
    audit(uid,p.hash,p.canon.kurs.titel,p.canon.lektionen.length,'abgelehnt','limit');
    return {error:'paket_limit'};
   }
   const title=freierTitel(p.canon.kurs.titel),zeit=now();
   const id=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,?,'huf','entwurf',?,?)")
    .run(title,p.canon.kurs.beschreibung,p.canon.kurs.preis_forint*100,zeit,zeit).lastInsertRowid);
   const stmt=db.prepare("INSERT INTO lektionen(kurs_id,titel,art,inhalt,reihenfolge,status,erstellt,geaendert) VALUES(? ,?,'text',?,?,'entwurf',?,?)");
   for(const l of p.canon.lektionen)stmt.run(id,l.titel,l.inhalt,l.reihenfolge,zeit,zeit);
   audit(uid,p.hash,title,p.canon.lektionen.length,'ok','import',id);
   return {kurs_id:id,vorhanden:false,titel:title,warnungen:p.warnungen};
  });
  if(result.error)return res.status(409).json({fehler:[{pfad:'kurse',code:result.error}]});
  return res.status(result.vorhanden?200:201).json(result);
 }catch{
  // Auch bei Rollback niemals den Paketinhalt oder einen Token protokollieren.
  try{audit(uid,p.hash,p.canon.kurs.titel,p.canon.lektionen.length,'fehler','datenbank');}catch{}
  return fehler(res,500,'serverfehler');
 }
});
router.get('/api/admin/kurse/:id/kurspaket',nurAdmin,(req,res)=>{
 if(!/^[1-9]\d{0,15}$/.test(req.params.id))return fehler(res,400,'ungueltige_id');
 const id=Number(req.params.id),k=db.prepare("SELECT titel,beschreibung,preis_cent,waehrung FROM kurse WHERE beispiel_key IS NULL AND id=?").get(id);
 if(!k)return fehler(res,404,'nicht_gefunden');
 // Das Paketformat kennt nur Forint; ein Euro-Preis wuerde beim Reimport stillschweigend als Forint gelesen.
 if(k.waehrung!=='huf')return fehler(res,409,'paket_waehrung');
 const ls=db.prepare("SELECT titel,inhalt,reihenfolge FROM lektionen WHERE kurs_id=? ORDER BY reihenfolge,id").all(id);
 const out={format:'valore-kurspaket-v1',kurs:{titel:k.titel,beschreibung:k.beschreibung,preis_forint:k.preis_cent/100},lektionen:ls};
 // Bei einem noch leeren Entwurf kann der Export nicht sofort reimportiert werden.
 res.json(out);
});
export const kurspaketRouter=router;
