// Restore: SICHERUNG_SCHLUESSEL (Base64, 32 Bytes) in der Umgebung setzen.
// 1. Verschluesselte Sicherung und NEUE Ausgabe-DB angeben (kein Ueberschreiben).
// 2. Logo wird neben der DB unter marke/logo.png exklusiv angelegt; optional
//    --logo-ausgabe=<Pfad>. Warnungen pruefen, bevor die App mit der DB startet.
// 3. App auf die neue DB einstellen; alte Sicherungen ohne Logo sind kompatibel.
import {readFile,open,mkdir,writeFile} from 'node:fs/promises';
import {bannerPfad,pruefeBanner} from '../banner-bild.mjs';
import {DatabaseSync} from 'node:sqlite';
import {machLogoPfad,LOGO_MAX_BYTES} from '../logo-png.mjs';
import {resolve,dirname} from 'node:path';
import {entschluesseln} from '../sicherung-format.mjs';
const [input,output,...options]=process.argv.slice(2);
const logoOption=options.find(x=>x.startsWith('--logo-ausgabe='));
if(!input||!output||resolve(input)===resolve(output)||options.length>1||options.some(x=>!x.startsWith('--logo-ausgabe=')||!x.slice(15))){console.error('Benutzung: node tools/sicherung-entschluesseln.mjs <verschluesselt> <neue-db-datei> [--logo-ausgabe=<Pfad>]');process.exit(1)}
const raw=process.env.SICHERUNG_SCHLUESSEL||'';
const key=Buffer.from(raw,'base64');
if(key.length!==32||key.toString('base64')!==raw){console.error('SICHERUNG_SCHLUESSEL fehlt oder ist ungültig');process.exit(1)}
let file;
try{
 const data=entschluesseln(await readFile(input),key);
 // Kein Überschreiben, auch nicht bei gleichnamiger Datei oder Symlink.
 file=await open(output,'wx',0o600);
 await file.writeFile(data);await file.sync();
 await file.close();file=null;
 let kopie;
 try{
  kopie=new DatabaseSync(output);
  if(kopie.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sicherung_logo'").get()){
   try{
    try{
    if(kopie.prepare('PRAGMA table_info(sicherung_logo)').all().some(c=>c.name==='ext')){
     const banner=kopie.prepare("SELECT inhalt,ext FROM sicherung_logo WHERE name='banner'").get();
     if(banner){
      const bytes=Buffer.from(banner.inhalt),b=pruefeBanner(bytes);
      if(!b.ok||b.ext!==banner.ext)throw Error('Banner ungueltig');
      const ziel=bannerPfad(logoOption?logoOption.slice(15):machLogoPfad(output),banner.ext);
      await mkdir(dirname(ziel),{recursive:true,mode:0o700});
      await writeFile(ziel,bytes,{flag:'wx',mode:0o600});
      console.log('Banner wiederhergestellt');
     }
    }
    }catch{console.warn('Warnung: Banner-Wiederherstellung fehlgeschlagen.')}
    try{
    const logo=kopie.prepare("SELECT inhalt FROM sicherung_logo WHERE name='logo.png'").get();
    if(logo){
     if(logo.inhalt.length>LOGO_MAX_BYTES)throw Error('Logo zu gross');
     const ziel=logoOption?logoOption.slice(15):machLogoPfad(output);
     await mkdir(dirname(ziel),{recursive:true,mode:0o700});
     await writeFile(ziel,logo.inhalt,{flag:'wx',mode:0o600});
     console.log('Logo wiederhergestellt');
    }else console.log('kein Logo in der Sicherung');
    }catch{console.warn('Warnung: Logo-Wiederherstellung fehlgeschlagen.')}
   }finally{kopie.exec('DROP TABLE sicherung_logo; VACUUM;')}
  }else console.log('kein Logo in der Sicherung');
 }catch{console.warn('Warnung: Banner/Logo-Wiederherstellung fehlgeschlagen; Datenbank wurde wiederhergestellt. Logo-Ziel und Berechtigungen pruefen.')}
 finally{try{kopie?.close()}catch{console.warn('Warnung: Logo-Datenbank konnte nicht geschlossen werden.')}}

 console.log('Entschlüsselung erfolgreich. Ausgabe neu angelegt.');
}catch{console.error('Wiederherstellung fehlgeschlagen; Format, Schlüssel, Dateiintegrität oder Ausgabe prüfen');process.exitCode=1}
finally{await file?.close()}
