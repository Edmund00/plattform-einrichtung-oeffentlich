// Scheibe 28: nur neue Checkout-Sitzungen blockieren, nie Webhooks oder laufende Abos.
import express from 'express';
import {db,transaktion} from './db.mjs';
import {nurAdmin} from './routes-kurse.mjs';
import { fehler,HU, sprache, locale } from './texte.mjs';

const zeit=()=>new Date().toISOString();
const grundOK=g=>typeof g==='string'&&g.trim().length>=1&&g.trim().length<=200&&!/[\u0000-\u001f\u007f]/.test(g);
const emailMask=e=>{const [v,d]=String(e||'').split('@');return v&&d?v.slice(0,2)+'***@'+d:'***';};
export const verkaufStatus=env=>{
 try{
  const s=db.prepare('SELECT pausiert FROM verkauf_schalter WHERE id=1').get();
  if(!s||![0,1].includes(s.pausiert))throw Error('schalter');
  return env===true||s.pausiert===1;
 }catch{
  console.error('Verkaufsschalter nicht lesbar: Verkauf vorsorglich pausiert.');
  return true;
 }
};
export function verkaufStart(env,mailer=null,alarmMails=[]){
 // Der Umgebungswert wird bei jedem Start protokolliert, ohne bestehenden DB-Zustand zu verändern.
 const letzter=db.prepare("SELECT aktion FROM verkauf_protokoll WHERE quelle='env' ORDER BY id DESC LIMIT 1").get()?.aktion;
 db.prepare("INSERT INTO verkauf_protokoll(zeit,aktion,benutzer_id,grund,quelle) VALUES(?,?,?,?, 'env')")
  .run(zeit(),env?'env_an':'env_aus',null,env?'env':'');
 if(lastEnvChanged(letzter,env)&&mailer&&alarmMails.length){
  const subject=env?HU.verkauf_alarm_pause_betreff:HU.verkauf_alarm_weiter_betreff;
  const text=[HU.verkauf_alarm_anrede,env?HU.verkauf_alarm_pause:HU.verkauf_alarm_weiter,
    HU.verkauf_alarm_zeit+': '+new Date().toLocaleString(locale(),{timeZone:'Europe/Budapest'}),
    HU.verkauf_alarm_grund+': '+HU.verkauf_alarm_env,
    HU.verkauf_alarm_wer+': '+HU.verkauf_alarm_env,
    env?HU.verkauf_hinweis:HU.verkauf_laeuft,HU.mail_systemhinweis].join('\n');
  const html='<main style="background:#faf6ee;padding:24px;color:#211a0e"><h2>'+subject+'</h2>'+text.split('\n').map(x=>'<p>'+x+'</p>').join('')+'</main>';
  void Promise.allSettled(alarmMails.map(to=>Promise.resolve().then(()=>mailer({to,subject,text,html}))));
 }
}
function lastEnvChanged(last,env){return last!==(env?'env_an':'env_aus')&&(env||last!==undefined);}
export function verkaufRouter({env=false,mailer=null,alarmMails=[]}={}){
 const router=express.Router();
 const aktuell=()=>verkaufStatus(env);
 const melden=(aktion,grund,wer)=>{
  if(!mailer||!alarmMails.length)return;
  const now=new Date().toLocaleString(locale(),{timeZone:'Europe/Budapest'});
  const betreff=aktion==='pausieren'?HU.verkauf_alarm_pause_betreff:HU.verkauf_alarm_weiter_betreff;
  const nachricht=[HU.verkauf_alarm_anrede,
   aktion==='pausieren'?HU.verkauf_alarm_pause:HU.verkauf_alarm_weiter,
   HU.verkauf_alarm_zeit+': '+now,
   // Beim Fortsetzen gibt es keinen Grund; "Umgebungsvariable" steht nur dort, wo der Env-Weg wirklich der Auslöser ist.
   ...(aktion==='pausieren'?[HU.verkauf_alarm_grund+': '+(grund||HU.verkauf_alarm_env)]:[]),
   HU.verkauf_alarm_wer+': '+wer,
   aktuell()?HU.verkauf_alarm_kunden+': '+HU.verkauf_hinweis:HU.verkauf_laeuft,
   HU.mail_systemhinweis].join('\n');
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html='<main style="font-family:Arial,sans-serif;background:#faf6ee;color:#211a0e;padding:24px"><div style="max-width:600px;background:#fff;padding:24px;border:1px solid #e7ddc9"><h2 style="color:#a87c2a">'+escape(betreff)+'</h2>'+nachricht.split('\n').map(x=>'<p>'+escape(x)+'</p>').join('')+'</div></main>';
  Promise.allSettled(alarmMails.map(to=>Promise.resolve().then(()=>mailer({to,subject:betreff,text:nachricht,html}))))
    .catch(()=>console.warn('Verkaufsalarm konnte nicht gestartet werden'));
 };
 const statusAdmin=()=>{
  let s;
  try{s=db.prepare('SELECT pausiert,seit,grund,benutzer_id FROM verkauf_schalter WHERE id=1').get();}catch{s=null}
  const user=s?.benutzer_id?db.prepare('SELECT email FROM benutzer WHERE id=?').get(s.benutzer_id):null;
  return {pausiert:aktuell(),db_pausiert:s?.pausiert===1,env_pausiert:env,seit:s?.seit||null,
   grund:s?.grund||'',wer:emailMask(user?.email),
   protokoll:db.prepare('SELECT zeit,aktion,grund,quelle,benutzer_id FROM verkauf_protokoll ORDER BY id DESC LIMIT 50').all()
    .map(r=>({...r,benutzer_id:undefined,wer:emailMask(r.benutzer_id?db.prepare('SELECT email FROM benutzer WHERE id=?').get(r.benutzer_id)?.email:'')}))};
 };
 router.get('/api/verkauf-status',(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.json({pausiert:aktuell()});
 });
 router.use('/api/admin/verkauf',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next()});
 router.get('/api/admin/verkauf',nurAdmin,(_req,res)=>res.json(statusAdmin()));
 router.post('/api/admin/verkauf/pausieren',nurAdmin,(req,res)=>{
  if(!req.body||Array.isArray(req.body)||Object.keys(req.body).length!==1||!grundOK(req.body.grund))
   return fehler(res,400,'verkauf_grund_fehler');
  const grund=req.body.grund.trim();
  transaktion(()=>{
   db.prepare('UPDATE verkauf_schalter SET pausiert=1,seit=?,grund=?,benutzer_id=? WHERE id=1 AND pausiert=0')
    .run(zeit(),grund,req.benutzer.id);
   db.prepare("INSERT INTO verkauf_protokoll(zeit,aktion,benutzer_id,grund,quelle) VALUES(?,'pausieren',?,?,'admin')")
    .run(zeit(),req.benutzer.id,grund);
  });
  melden('pausieren',grund,emailMask(req.benutzer.email));
  res.json(statusAdmin());
 });
 router.post('/api/admin/verkauf/fortsetzen',nurAdmin,(req,res)=>{
  if(req.body===null||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length)
   return fehler(res,400,'body_ungueltig');
  transaktion(()=>{
   if(!env)db.prepare('UPDATE verkauf_schalter SET pausiert=0,seit=NULL,grund=NULL,benutzer_id=NULL WHERE id=1').run();
   db.prepare("INSERT INTO verkauf_protokoll(zeit,aktion,benutzer_id,grund,quelle) VALUES(?,'fortsetzen',?,'','admin')")
    .run(zeit(),req.benutzer.id);
  });
  if(!env)melden('fortsetzen','',emailMask(req.benutzer.email));
  res.json(statusAdmin());
 });
 return router;
}
