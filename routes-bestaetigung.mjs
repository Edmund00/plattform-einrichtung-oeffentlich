// Scheibe 14: E-Mail-Verifizierung ohne Klartext-Token in Datenbank oder Logs.
import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { db, transaktion } from './db.mjs';
import { ereignisHinzufuegen, ereignisseNachCommit } from './ereignis-liste.mjs';
import { aktuellerBenutzer } from './auth.mjs';
import { fehler, HU } from './texte.mjs';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const FENSTER = 60*60*1000;
const ipLimit = new Map(), benutzerLimit = new Map();
const sha = x => createHash('sha256').update(String(x)).digest('hex');
function erlaubt(map,key,max) {
  const now=Date.now();
  if(!map.has(key) && map.size>=10000) {
    for(const [k,werte] of map) if(!werte.length || now-werte[werte.length-1]>=FENSTER) map.delete(k);
    if(map.size>=10000)return false;
  }
  const werte=(map.get(key)||[]).filter(v=>now-v<FENSTER);
  if(werte.length>=max){map.set(key,werte);return false;}
  werte.push(now);map.set(key,werte);return true;
}
export function bestaetigungRouter({ mails }) {
  const router=express.Router();
  router.use(['/api/email-bestaetigen','/api/email-bestaetigung-erneut'],(_req,res,next)=>{
    res.setHeader('Cache-Control','no-store');next();
  });
  router.post('/api/email-bestaetigen',(req,res)=>{
    if(!req.body || typeof req.body!=='object' || Array.isArray(req.body) ||
      Object.keys(req.body).length!==1 || typeof req.body.token!=='string' ||
      !TOKEN.test(req.body.token))return fehler(res,400,'bestaetigung_link_ungueltig');
    const tokenHash=sha(req.body.token);
    const zeile=db.prepare('SELECT id,benutzer_id,token_hash,laeuft_ab,benutzt FROM email_token WHERE token_hash=?').get(tokenHash);
    const probe=Buffer.from(zeile?.token_hash || '0'.repeat(64),'hex');
    const gleich=timingSafeEqual(Buffer.from(tokenHash,'hex'),probe);
    if(!zeile || !gleich || zeile.benutzt!==null || zeile.laeuft_ab<=Date.now())
      return fehler(res,400,'bestaetigung_link_ungueltig');
    const klappt=transaktion(()=>{
      const now=Date.now();
      const r=db.prepare('UPDATE email_token SET benutzt=? WHERE id=? AND benutzt IS NULL AND laeuft_ab>?')
        .run(now,zeile.id,now);
      if(r.changes!==1)return false;
      db.prepare('UPDATE benutzer SET email_bestaetigt=COALESCE(email_bestaetigt,?) WHERE id=?').run(now,zeile.benutzer_id);
      db.prepare('UPDATE email_token SET benutzt=? WHERE benutzer_id=? AND benutzt IS NULL').run(now,zeile.benutzer_id);
      db.prepare("UPDATE email_ausgang SET status='gesendet',geaendert=? WHERE benutzer_id=?").run(now,zeile.benutzer_id);
      ereignisHinzufuegen('bestaetigt',String(zeile.benutzer_id),{benutzer_id:zeile.benutzer_id,status:'bestaetigt'});
      return true;
    });
    if(klappt) ereignisseNachCommit();
    if(!klappt)return fehler(res,400,'bestaetigung_link_ungueltig');
    return res.json({text:HU.bestaetigung_erfolg});
  });
  router.post('/api/email-bestaetigung-erneut',(req,res)=>{
    const benutzer=aktuellerBenutzer(req);
    if(!benutzer)return fehler(res,401,'nicht_angemeldet');
    if(!req.body || typeof req.body!=='object' || Array.isArray(req.body) || Object.keys(req.body).length)
      return fehler(res,400,'body_ungueltig');
    const neutral=()=>res.status(200).json({text:HU.bestaetigung_neutral});
    const ipOk=erlaubt(ipLimit,sha(req.ip||''),10);
    const userOk=erlaubt(benutzerLimit,String(benutzer.id),3);
    if(!ipOk||!userOk||benutzer.email_bestaetigt!==null||!mails?.mailAktiv)return neutral();
    try {
      mails.emailTokenNeu(benutzer.id);
      mails.emailNachCommitSenden();
    } catch {console.warn('E-Mail-Verifizierung nicht vorgemerkt');}
    return neutral();
  });
  return router;
}
