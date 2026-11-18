import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
export const MAGIC=Buffer.from('VSIC1');
export const TABELLEN=['benutzer','kategorien','kurse','lektionen','bestellungen','zugaenge','abos'];
export const checksum=b=>createHash('sha256').update(b).digest('hex');
export function verschluesseln(plain,key){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
 return Buffer.concat([MAGIC,Buffer.from([1]),iv,encrypted,cipher.getAuthTag()]);
}
export function entschluesseln(data,key){
 if(data.length<34||!data.subarray(0,5).equals(MAGIC)||data[5]!==1)throw new Error('Ungültiges Sicherungsformat');
 const iv=data.subarray(6,18),tag=data.subarray(-16),crypt=data.subarray(18,-16);
 const dec=createDecipheriv('aes-256-gcm',key,iv);dec.setAuthTag(tag);
 return Buffer.concat([dec.update(crypt),dec.final()]);
}
export function pruefeDatenbank(path){
 const copy=new DatabaseSync(path,{readOnly:true});
 try{
  if(copy.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw Error('integrity');
  if(copy.prepare('PRAGMA foreign_key_check').all().length)throw Error('foreign');
  return Object.fromEntries(TABELLEN.map(t=>[t,t === 'kategorien' && !copy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kategorien'").get() ? 0 : copy.prepare('SELECT COUNT(*) n FROM '+t).get().n]));
 }finally{copy.close();}
}
