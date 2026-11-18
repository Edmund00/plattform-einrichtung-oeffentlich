import {HU} from './texte.mjs';
import {adminListeInitialisieren,notfallStart} from './admin-zugang.mjs';
import {fehlversucheAlleLoeschen} from './auth.mjs';
export function adminStart({liste=[],notfall=false,mailer=null,alarmMails=[]}={}){
 const alarm=async grund=>{
  if(!mailer||!alarmMails.length)return false;
  const subject=HU.admin_alarm_betreff;
  const content=HU.admin_alarm_text+' '+(HU['admin_alarm_'+grund]||HU.admin_alarm_allgemein);
  const html='<main style="font-family:Arial;padding:24px;background:#faf6ee;color:#211a0e"><h2>'+subject+'</h2><p>'+content+'</p></main>';
  const result=await Promise.allSettled(alarmMails.map(to=>mailer({to,subject,text:content,html})));
  return result.every(r=>r.status==='fulfilled'&&r.value===true);
 };
 adminListeInitialisieren(liste,alarm);
 if(notfall){fehlversucheAlleLoeschen();notfallStart();}
}
