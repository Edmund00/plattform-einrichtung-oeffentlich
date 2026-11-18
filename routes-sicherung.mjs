import express from 'express';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {db} from './db.mjs';
import {nurAdmin} from './routes-kurse.mjs';
import {fehler} from './texte.mjs';
import {sicherungDienst,letzterErfolg,MUSTER,tempAufraeumen} from './sicherung.mjs';
export function sicherungRouter({ordner,schluessel,nodeEnv='development',bunny=null,alarm=null,fetchFn=fetch,startZeit=Date.now(),automatik=true,abgleichPruefen=null,demoModus=false}){
 const router=express.Router(),start=startZeit;
 const dienst=sicherungDienst({ordner,schluessel,bunny,alarm,fetchFn});
 const status=()=>{
  try{
   db.prepare('SELECT 1').get();
   // Demo (Gesamtpruefung 12.11.2026, F-07): bewusst ohne Sicherung und ohne dauerhafte Daten (Gratis-Tarif). Gesund heisst dort: die Datenbank antwortet.
   if(demoModus)return {ok:true,sicherung:'demo'};
   if(!schluessel)return nodeEnv==='production'?{ok:false}:{ok:true,sicherung:'aus'};
   const last=letzterErfolg();
   const backupOk=Date.now()-start<12*3600000 || !!(last&&Date.now()-Date.parse(last)<=12*3600000);
   return {ok:backupOk&&(nodeEnv!=='production'||!abgleichPruefen||abgleichPruefen())};
  }catch{return {ok:false}}
 };
 router.get('/api/gesundheit',(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const s=status();res.status(s.ok?200:503).json(s);
 });
 router.get('/api/admin/sicherung',nurAdmin,(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.json({aktiv:!!schluessel,letzte:letzterErfolg(),
   eintraege:db.prepare('SELECT id,zeit,art,ergebnis,dateiname,groesse_klartext,groesse_enc,sha256_klar,sha256_enc,tabellen_zeilen,ziel_lokal,ziel_extern,kurze_meldung FROM sicherung_protokoll ORDER BY id DESC LIMIT 100').all()});
 });
 router.post('/api/admin/sicherung/jetzt',nurAdmin,async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(!req.body||Object.keys(req.body).length!==1||!['manuell','vordeploy'].includes(req.body.art))return fehler(res,400,'sicherung_art');
  if(!schluessel)return fehler(res,503,'sicherung_aus');
  if(dienst.istBeschaeftigt())return fehler(res,409,'sicherung_busy');
  const result=await dienst.lauf(req.body.art);
  if(!result.ok)return fehler(res,503,'sicherung_fehler');
  res.json({ok:true,dateiname:result.dateiname,ziel_extern:result.extern});
 });
 router.get('/api/admin/sicherung/letzte',nurAdmin,async(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(!schluessel)return fehler(res,503,'sicherung_aus');
  const latest=db.prepare("SELECT dateiname FROM sicherung_protokoll WHERE ergebnis='ok' AND dateiname IS NOT NULL ORDER BY id DESC LIMIT 1").get()?.dateiname;
  if(!latest||!MUSTER.test(latest))return fehler(res,404,'nicht_gefunden');
  const file=join(ordner,latest);
  try{
   const size=await stat(file);res.setHeader('Content-Type','application/octet-stream');
   res.setHeader('X-Content-Type-Options','nosniff');
   res.setHeader('Content-Disposition','attachment; filename="'+latest+'"');
   res.setHeader('Content-Length',String(size.size));
   createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  }catch{return fehler(res,404,'nicht_gefunden')}
 });
 if(schluessel&&automatik){
  queueMicrotask(async()=>{await tempAufraeumen(ordner,0).catch(()=>{});void dienst.lauf('auto')});
  const timer=setInterval(()=>{
   void dienst.lauf('auto');
   const last=letzterErfolg();
   if(last&&Date.now()-Date.parse(last)>12*3600000&&alarm)void alarm('veraltet');
  },6*3600000);timer.unref?.();
 }
 return router;
}
