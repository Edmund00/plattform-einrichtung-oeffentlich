import {createHash} from 'node:crypto';
import {db} from './db.mjs';
import { HU, sprache, locale } from './texte.mjs';
import { formatGeld } from './betrag.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function abgleichAlarm({mailer,adressen=[],base}){
 return async function senden({status,items=[]}){
  if(!mailer||!adressen.length)return false;
  const aktiv=status!=='ok';
  const sig=createHash('sha256').update(JSON.stringify({status,entries:items.map(x=>[x.art,x.stripe_id,x.bestell_id,x.betrag,x.waehrung]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})).digest('hex');
  const old=db.prepare('SELECT fingerprint,aktiv,letzte_mail FROM abgleich_alarm WHERE id=1').get();
  if(!aktiv&&!old?.aktiv)return false;
  if(aktiv&&old?.aktiv&&old.fingerprint===sig&&Date.now()-Date.parse(old.letzte_mail)<24*3600000)return false;
  const time=new Date().toISOString();
  const subject=aktiv?HU.abgleich_alarm_fehler_betreff:HU.abgleich_alarm_ok_betreff;
  const datum=new Date().toLocaleString(locale(),{timeZone:'Europe/Budapest'});
  const lines=[HU.abgleich_alarm_szia,aktiv?HU.abgleich_alarm_fehler:HU.abgleich_alarm_ok,
    HU.abgleich_alarm_datum+': '+datum,HU.abgleich_alarm_anzahl+': '+items.length,
    ...items.slice(0,5).map(x=>String(x.stripe_id||'-')+' · '+(formatGeld(x.betrag,x.waehrung,sprache())||'-')+' · '+(HU[x.text]||HU.abgleich_hiba)),
    HU.abgleich_alarm_ellenoriz,base+'/admin/',HU.mail_systemhinweis];
  const text=lines.join('\n');
  const html='<!doctype html><html lang="'+sprache()+'"><body style="margin:0;padding:24px;background:#faf6ee;font-family:Arial,sans-serif;color:#211a0e"><main style="max-width:640px;margin:auto;padding:24px;background:#fff;border:1px solid #e7ddc9;border-radius:18px"><h1 style="color:#a87c2a">'+esc(subject)+'</h1>'+
   lines.map(x=>x===base+'/admin/'?'<p><a style="display:inline-block;background:#d4a843;color:#211a0e;border-radius:40px;padding:12px 20px" href="'+esc(x)+'">'+esc(HU.abgleich_titel)+'</a></p>':'<p>'+esc(x)+'</p>').join('')+'</main></body></html>';
  const result=await Promise.allSettled(adressen.map(to=>mailer({to,subject,text,html,
   idempotencyKey:'schulung-abgleich-'+createHash('sha256').update(to+'|'+sig+'|'+time.slice(0,10)).digest('hex').slice(0,32)})));
  if(!result.every(x=>x.status==='fulfilled'&&x.value===true))return false;
  db.prepare('INSERT INTO abgleich_alarm(id,fingerprint,aktiv,letzte_mail) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,aktiv=excluded.aktiv,letzte_mail=excluded.letzte_mail').run(sig,aktiv?1:0,time);
  return true;
 };
}
