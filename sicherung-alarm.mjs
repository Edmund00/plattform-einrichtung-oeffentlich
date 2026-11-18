import {db} from './db.mjs';
import {createHash} from 'node:crypto';
import { HU, sprache, locale } from './texte.mjs';
const htmlEscape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// texte (optional, Schritt 8 Bunny): {praefix,betreff,fehler,teendo} ersetzen die Sicherungs-Texte, wenn der Alarm einen anderen Grund hat (z. B. Bunny-Loeschauftraege).
// praefix (z. B. 'bunny') trennt den Eintrag von den Sicherungs-Eintraegen ('sicherung:...'): die Behebungs-Mail der Sicherung ("wieder in Ordnung")
// betrachtet NUR 'sicherung:%' und setzt fremde Alarme nicht zurueck (Pruefrunde Schritt 8, Fund 1).
export function alarmDienst({mailer,adressen=[]}){
 return async function alarm(grund,texte=null){
  if(!adressen.length||!mailer)return false;
  const now=Date.now(),stempel=new Date(now).toISOString(),behebung=grund==='behebung';
  const praefix=/^[a-z]{1,20}$/.test(texte?.praefix||'')?texte.praefix:'sicherung';
  const key=behebung?'sicherung':praefix+':'+grund;
  const vorher=db.prepare('SELECT letzter_versand,aktiv FROM sicherung_alarm WHERE grund=?').get(key);
  if(behebung){
   const fehler=db.prepare("SELECT grund FROM sicherung_alarm WHERE grund LIKE 'sicherung:%' AND aktiv=1").all();
   if(!fehler.length)return false;
   db.prepare("UPDATE sicherung_alarm SET aktiv=0 WHERE grund LIKE 'sicherung:%'").run();
  }else{
   if(vorher?.aktiv&&vorher.letzter_versand&&now-Date.parse(vorher.letzter_versand)<6*3600000)return false;
   db.prepare('INSERT INTO sicherung_alarm(grund,letzter_versand,aktiv) VALUES(?,?,1) ON CONFLICT(grund) DO UPDATE SET letzter_versand=excluded.letzter_versand,aktiv=1')
     .run(key,stempel);
  }
  const subject=behebung?HU.sicherung_alarm_ok_betreff:(texte?.betreff||HU.sicherung_alarm_betreff);
  const zeit=new Date(now).toLocaleString(locale(),{timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const text=[HU.sicherung_alarm_koszones,behebung?HU.sicherung_alarm_ok:(texte?.fehler||HU.sicherung_alarm_fehler),
   HU.sicherung_alarm_ido+': '+zeit,behebung?HU.sicherung_alarm_nincs_teendo:(texte?.teendo||HU.sicherung_alarm_teendo),HU.mail_systemhinweis].join('\n');
  const html='<!doctype html><html lang="'+sprache()+'"><body style="background:#faf6ee;padding:24px;color:#211a0e;font-family:Arial,sans-serif"><main style="max-width:640px;background:#fff;padding:24px;border:1px solid #e7ddc9"><h1 style="color:#a87c2a">'+htmlEscape(subject)+'</h1>'+text.split('\n').map(x=>'<p>'+htmlEscape(x)+'</p>').join('')+'</main></body></html>';
  const result=await Promise.allSettled(adressen.map(to=>mailer({to,subject,text,html,idempotencyKey:'schulung-backup-alarm-'+createHash('sha256').update(to+'|'+key+'|'+stempel).digest('hex').slice(0,32)})));
  return result.some(r=>r.status==='fulfilled'&&r.value===true);
 }
}
