// Alle sichtbaren Wörter liegen in hu.json; Ausgaben für E-Mail und öffentliche Informationsseite.
import {HU} from './texte.mjs';
const PFADE=Object.freeze({feltetelek:'/jogi/reszveteli-feltetelek/',adatvedelem:'/jogi/adatvedelem/',impresszum:'/jogi/impresszum/',ellallas:'/#/fiokom'});
export function rechtMap(base){const b=String(base||'').replace(/[/]+$/,'');return Object.freeze(Object.fromEntries(Object.entries(PFADE).map(([k,p])=>[k,b+p])));}

export function anbieterZeilen(anbieter={}){
 const z=[['ANBIETER_NAME','mailrecht_name'],['ANBIETER_ANSCHRIFT','mailrecht_anschrift'],
 ['ANBIETER_TELEFON','mailrecht_telefon'],['ANBIETER_EMAIL','mailrecht_email'],
 ['ANBIETER_ADOSZAM','mailrecht_adoszam']].filter(([feld])=>anbieter[feld])
 .map(([feld,key])=>HU[key]+': '+anbieter[feld]);
 return z.length?[HU.mailrecht_anbieter,...z]:[];
}
// Produktreife (12.11.2026): nur im Demo-Modus "(Muster)" im Titel und "..." fuer fehlende Anbieterangaben. Im Normalbetrieb steht dort
// der neutrale Hinweis "vom Betreiber noch nicht hinterlegt". Die Leerstellen fuer Kurs, Datum und Kunde gehoeren zum gesetzlichen Formular und bleiben.
export const ellallasTitel=(demo=false)=>demo?HU.mailrecht_ellallas_titel_demo:HU.mailrecht_ellallas_titel;
export function musterText({anbieter={},kurs='...',datum='...',kunde='...',adresse='...',demo=false }={}){
 const werte=[anbieter.ANBIETER_NAME,anbieter.ANBIETER_ANSCHRIFT,anbieter.ANBIETER_EMAIL];
 const an=!demo&&werte.every(v=>!v)?HU.recht_nicht_hinterlegt
   :werte.map(v=>v||(demo?'...':HU.recht_nicht_hinterlegt)).join(', ');
 return HU.mailrecht_muster
   .replaceAll('{anbieter}',an).replaceAll('{tanfolyam}',kurs||'...')
   .replaceAll('{datum}',datum||'...').replaceAll('{kunde}',kunde||'...')
   .replaceAll('{adresse}',adresse||'...');
}
export function widerrufsZeilen({anbieter={},kurs='...',datum='...',kunde='...',adresse='...',zustimmung=false,demo=false}={}){
 return [ellallasTitel(demo),HU.mailrecht_ellallas_frist,
   HU.mailrecht_ellallas_ausuebung+(anbieter.ANBIETER_EMAIL?' '+anbieter.ANBIETER_EMAIL:demo?'':' '+HU.recht_nicht_hinterlegt),
   HU.mailrecht_ellallas_folgen,
   ...(zustimmung?[HU.mailrecht_ellallas_zustimmung]:[]),
   musterText({anbieter,kurs,datum,kunde,adresse,demo})];
}
export function rechtLinks(base,demo=false){
 const RECHT_LINKS=rechtMap(base);
 return [HU.k_feltetelek+'\n'+RECHT_LINKS.feltetelek,HU.k_adatvedelem+'\n'+RECHT_LINKS.adatvedelem,
 HU.k_impresszum+'\n'+RECHT_LINKS.impresszum,
 ellallasTitel(demo)+'\n'+base+'/#/elallasi-tajekoztato'];
}
