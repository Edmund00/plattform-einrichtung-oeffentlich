import {BANNER_MAX_BYTES,bannerPfad,pruefeBanner} from './banner-bild.mjs';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {machLogoPfad,LOGO_MAX_BYTES} from './logo-png.mjs';
import {verschluesseln,pruefeDatenbank,checksum,TABELLEN} from './sicherung-format.mjs';
export {entschluesseln,verschluesseln,pruefeDatenbank,checksum,MAGIC,TABELLEN} from './sicherung-format.mjs';
import {readFile,writeFile,open,unlink,mkdir,readdir,stat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {db} from './db.mjs';
export function quellZaehler(){
 return Object.fromEntries(TABELLEN.map(t=>[t,db.prepare('SELECT COUNT(*) n FROM '+t).get().n]));
}
// Nach einem Absturz mitten in der Sicherung bleibt die unverschluesselte Zwischenkopie liegen: sie wird geloescht (nur Dateien dieses Namensmusters).
export const TEMP_MUSTER=/^\.vsic-temp-[0-9a-f]{24}\.db$/;
export async function tempAufraeumen(ordner,mindestAlterMs=0,now=Date.now()){
 let n=0;
 try{
  for(const name of await readdir(ordner)){
   if(!TEMP_MUSTER.test(name))continue;
   const p=join(ordner,name);
   // Alter 0 = Start: keine Altersprüfung (die Dateizeit kann minimal in der Zukunft liegen)
   try{const st=await stat(p);if(st.isFile()&&(mindestAlterMs<=0||now-st.mtimeMs>=mindestAlterMs)){await unlink(p);n++}}catch{}
  }
 }catch{}
 return n;
}
export const MUSTER=/^vsic-\d{8}-\d{6}Z-(?:auto|manuell|vordeploy)\.db\.enc$/;
export async function aufraeumen(ordner,now=Date.now()){
 const list=(await readdir(ordner)).filter(n=>MUSTER.test(n)).sort().reverse();
 const keep=new Set(list.slice(0,3)),days=new Set(),months=new Set();
 const vorZwoelfMonaten=new Date(now);vorZwoelfMonaten.setUTCMonth(vorZwoelfMonaten.getUTCMonth()-12);
 for(const name of list){
  const m=/^vsic-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})Z-/.exec(name);
  if(!m)continue;
  const timestamp=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]);
  const age=now-timestamp,day=m[1]+m[2]+m[3],month=m[1]+m[2];
  if(age<0){keep.add(name);continue}
  if(age<=48*3600000){keep.add(name);continue}
  if(age<=30*86400000&&!days.has(day)){keep.add(name);days.add(day);continue}
  if(timestamp>=vorZwoelfMonaten.getTime()&&!months.has(month)){keep.add(name);months.add(month)}
 }
 for(const name of list)if(!keep.has(name))await unlink(join(ordner,name));
 await tempAufraeumen(ordner,600000,now);
 return {behalten:keep.size};
}
const jetzt=()=>new Date().toISOString();
export function letzterErfolg(){return db.prepare("SELECT zeit FROM sicherung_protokoll WHERE ergebnis='ok' ORDER BY id DESC LIMIT 1").get()?.zeit||null}
export function sicherungDienst({ordner,schluessel,bunny=null,alarm=null,fetchFn=fetch,pruefenFn=pruefeDatenbank,logoPfad=machLogoPfad(db.prepare('PRAGMA database_list').all().find(x=>x.name==='main').file)}){
 let running=false;
 async function lauf(art='auto'){
  if(!schluessel)return {ok:false,aus:true};
  if(running)return {ok:false,beschaeftigt:true};
  if(!['auto','manuell','vordeploy'].includes(art))throw Error('Art ungültig');
  running=true;
  const id=randomBytes(12).toString('hex'),temp=join(ordner,'.vsic-temp-'+id+'.db');
  const dateiname=()=> 'vsic-'+new Date().toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15)+'Z-'+art+'.db.enc';
  let filename=dateiname(),dest=join(ordner,filename);
  let selbstAngelegt=false,logoMeldung='';
  let lokal='fehler',extern='aus',ergebnis='fehler',meldung='sicherung_fehlgeschlagen',klar=null,enc=null,counts=null;
  try{
   await mkdir(ordner,{recursive:true,mode:0o700});
   db.exec("VACUUM INTO '"+temp.replaceAll("'","''")+"'");
   const checked=pruefenFn(temp),source=quellZaehler();
   if(JSON.stringify(checked)!==JSON.stringify(source))throw Error('Zeilenzahlen ungleich');
   counts=checked;
   // Nur die gepruefte Zwischenkopie erhaelt den Logo-Transportbehaelter.
   const kopie=new DatabaseSync(temp);
   try{
    kopie.exec('DROP TABLE IF EXISTS sicherung_logo; CREATE TABLE sicherung_logo(name TEXT PRIMARY KEY, inhalt BLOB NOT NULL, ext TEXT)');
    let logo=null;
    try{
     const st=await stat(logoPfad);
     if(!st.isFile())logoMeldung='logo_nicht_lesbar';
     else if(st.size>LOGO_MAX_BYTES)logoMeldung='logo_zu_gross';
     else{
      logo=await readFile(logoPfad);
      if(logo.length>LOGO_MAX_BYTES){logo=null;logoMeldung='logo_zu_gross'}
     }
    }catch(e){logoMeldung=e.code==='ENOENT'?'logo_fehlt':'logo_nicht_lesbar'}
    const bannerMeta=kopie.prepare("SELECT name FROM sqlite_master WHERE name='marke'").get()
      ? kopie.prepare("SELECT wert FROM marke WHERE schluessel='banner'").get() : null;
    if(bannerMeta){
     try{
     const meta=JSON.parse(bannerMeta.wert);
     const pfad=bannerPfad(logoPfad,meta.ext);
     const st=await stat(pfad);
     if(!st.isFile()||st.size>BANNER_MAX_BYTES)throw Error('banner_nicht_sicherbar');
     const bytes=await readFile(pfad),geprueft=pruefeBanner(bytes);
     if(!geprueft.ok||geprueft.ext!==meta.ext)throw Error('banner_nicht_sicherbar');
     kopie.prepare('INSERT INTO sicherung_logo(name,inhalt,ext) VALUES(?,?,?)').run('banner',bytes,meta.ext);
     }catch{console.warn('Warnung: Banner nicht sicherbar; Sicherung wird ohne Banner fortgesetzt.')}
    }
    if(logo)kopie.prepare('INSERT INTO sicherung_logo(name,inhalt) VALUES(?,?)').run('logo.png',logo);
   }finally{kopie.close()}
   const plain=await readFile(temp);
   klar={size:plain.length,sha:checksum(plain)};
   const encrypted=verschluesseln(plain,schluessel);
   // Exklusive Anlage: niemals eine vorhandene Datei überschreiben.
   let f;
   for(let versuch=0;versuch<3;versuch++){
     try{f=await open(dest,'wx',0o600);break}
     catch(e){if(e.code!=='EEXIST'||versuch===2)throw e;
       // Bei zwei Sicherungen in derselben Sekunde eine neue Sekunde abwarten; nie überschreiben.
       await new Promise(resolve=>setTimeout(resolve,1100));
       filename=dateiname();dest=join(ordner,filename);
     }
   }
   selbstAngelegt=true;
   try{await f.writeFile(encrypted);await f.sync()}finally{await f.close()}
   enc={size:encrypted.length,sha:checksum(encrypted)};
   // Klartext sofort entfernen, nicht erst nach dem externen Upload.
   await unlink(temp);
   lokal='ok';ergebnis='ok';meldung='sicherung_ok';
   if(bunny){
    extern='fehler';
    try{
     const target='https://'+bunny.host+'/'+encodeURIComponent(bunny.zone)+'/'+bunny.pfad+encodeURIComponent(filename);
     const ctrl=AbortSignal.timeout(60000);
     const put=await fetchFn(target,{method:'PUT',headers:{AccessKey:bunny.schluessel,'Content-Type':'application/octet-stream'},body:encrypted,signal:ctrl});
     if(!put.ok)throw Error('external');
     const head=await fetchFn(target,{method:'HEAD',headers:{AccessKey:bunny.schluessel},signal:ctrl});
     if(!head.ok||Number(head.headers.get('content-length'))!==encrypted.length)throw Error('external size');
     extern='ok';
    }catch{extern='fehler';meldung='sicherung_extern_fehler'}
   }
   try{await aufraeumen(ordner)}catch{meldung='sicherung_aufraeumen_fehler'}
   if(logoMeldung)meldung+=':'+logoMeldung;
   return {ok:true,dateiname:filename,extern};
  }catch(e){
   // Nur ein kurzer Fehlercode (zum Beispiel ENOSPC), nie Pfade, Texte oder Schlüssel.
   meldung='sicherung_fehlgeschlagen:'+String(e?.code||e?.name||'Error').replace(/[^A-Za-z0-9_]/g,'').slice(0,40);
   if(lokal!=='ok'&&selbstAngelegt)try{await unlink(dest)}catch{}
   return {ok:false};
  }finally{
   // Nur unsere zufällig angelegte Klartextdatei löschen, auch nach Fehlschlag.
   try{await unlink(temp)}catch{}
   try{
     db.prepare('INSERT INTO sicherung_protokoll(zeit,art,ergebnis,dateiname,groesse_klartext,groesse_enc,sha256_klar,sha256_enc,tabellen_zeilen,ziel_lokal,ziel_extern,kurze_meldung) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
       .run(jetzt(),art,ergebnis,lokal==='ok'?filename:null,klar?.size??null,enc?.size??null,klar?.sha??null,enc?.sha??null,counts?JSON.stringify(counts):null,lokal,extern,meldung);
   }catch{console.warn('Sicherungsprotokoll konnte nicht geschrieben werden');}
   finally{running=false;}
   if(alarm){
     const grund=lokal==='fehler'?'sicherung':extern==='fehler'?'extern':meldung.startsWith('sicherung_aufraeumen_fehler')?'aufraeumen':'behebung';
     Promise.resolve().then(()=>alarm(grund)).catch(()=>console.warn('Sicherungsalarm nicht verarbeitet'));
   }
  }
 }
 return {lauf,istBeschaeftigt:()=>running};
}
