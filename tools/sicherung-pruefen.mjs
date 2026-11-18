import {readFile,writeFile,unlink,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {entschluesseln,pruefeDatenbank} from '../sicherung-format.mjs';
const input=process.argv[2],raw=process.env.SICHERUNG_SCHLUESSEL||'';
const key=Buffer.from(raw,'base64');
if(!input||key.length!==32||key.toString('base64')!==raw){console.error('Pfad oder SICHERUNG_SCHLUESSEL fehlt/ungültig');process.exit(1)}
let temp,dir;
try{
 dir=await mkdtemp(join(tmpdir(),'vsic-pruefen-'));temp=join(dir,'pruefung.db');
 await writeFile(temp,entschluesseln(await readFile(input),key),{flag:'wx',mode:0o600});
 const counts=pruefeDatenbank(temp);
 console.log('Integrität: ok; Fremdschlüssel: ok; Zeilenzahlen:',JSON.stringify(counts));
}catch{console.error('Sicherungsprüfung fehlgeschlagen');process.exitCode=1}
finally{if(temp)try{await unlink(temp)}catch{}if(dir){const {rmdir}=await import('node:fs/promises');try{await rmdir(dir)}catch{}}}
