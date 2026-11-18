// Scheibe 13: HTTP- und Dateisystemtests gegen eine isolierte Wegwerf-Datenbank.
import './test-sprache.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const basis=mkdtempSync(join(tmpdir(),'schulung-vorschau-'));
const datei=join(basis,'test.db'), ordner=join(basis,'dateien');
const PORT=4435, BASE='http://127.0.0.1:'+PORT;
const passwort=randomBytes(24).toString('hex'), adminMail='vorschau-admin@example.com';
let ok=0,fail=0,server;
const check=(name,condition)=>{condition?ok++:fail++;console.log((condition?'OK     ':'FEHLER ')+name);};
const warte=ms=>new Promise(r=>setTimeout(r,ms));
function sql(kommando,...args){const d=new DatabaseSync(datei);try{return d.prepare(kommando).all(...args);}finally{d.close();}}
const one=(q,...args)=>sql(q,...args)[0];
function klient(){
 let cookie='';
 return async(method,url,data,head={})=>{
  const headers={...head};if(cookie)headers.Cookie=cookie;
  const options={method,headers};
  if(data!==undefined){
   if(Buffer.isBuffer(data)){options.body=data;headers['Content-Type']=headers['Content-Type']||'application/octet-stream';}
   else{options.body=JSON.stringify(data);headers['Content-Type']='application/json';}
  }
  const r=await fetch(BASE+url,options);
  const setCookie=r.headers.get('set-cookie');
  if(setCookie)cookie=setCookie.split(';')[0];
  const typ=r.headers.get('content-type')||'';
  const body=typ.includes('application/json')?await r.json().catch(()=>({})):Buffer.from(await r.arrayBuffer());
  return {status:r.status,body,header:r.headers};
 };
}
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]);
const jpg=Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1,0,0,0,0]);
const mp4=Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0]);
const leerVerzeichnis=()=>existsSync(join(ordner,'vorschau'))?readdirSync(join(ordner,'vorschau')).filter(n=>!n.startsWith('.tmp-')):[];
try{
 const init=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','tools/admin-anlegen.mjs',adminMail],
  {env:{...process.env,DB_DATEI:datei,ADMIN_PASSWORT:passwort},encoding:'utf8'});
 check('Test-Admin angelegt',init.status===0);
 server=spawn(process.execPath,['--disable-warning=ExperimentalWarning','tools/testserver-kurse.mjs'],
  {env:{...process.env,DB_DATEI:datei,DATEI_ORDNER:ordner,PORT:String(PORT),BASE_URL:BASE},
   stdio:['ignore','pipe','pipe']});
 let log='';server.stdout.on('data',b=>{log+=b.toString();});server.stderr.on('data',b=>{log+=b.toString();});
 for(let i=0;i<70&&!log.includes('Kurs-Testserver läuft');i++)await warte(200);
 if(!log.includes('Kurs-Testserver läuft'))throw Error('Serverstart: '+log.slice(0,300));
 const gast=klient(),kunde=klient(),admin=klient();
 check('Gast registriert',(await kunde('POST','/api/registrieren',{ zustimmung: true, email:'vorschau-kunde@example.com',passwort})).status===201);
 check('Admin angemeldet',(await admin('POST','/api/anmelden',{email:adminMail,passwort})).status===200);
 const erstellt=await admin('POST','/api/admin/kurse',{titel:'Vorschau-Kurs',beschreibung:'',preis_cent:10000,waehrung:'huf'});
 check('Kurs erstellt',erstellt.status===201);const id=erstellt.body.id;
 const uri='/api/admin/kurse/'+id+'/vorschau/';
 check('Gast Titelbild 401',(await gast('PUT',uri+'titelbild',png)).status===401);
 check('Kunde Trailer 403',(await kunde('PUT',uri+'trailer',mp4)).status===403);
 check('Gast Nutzen 401',(await gast('PATCH','/api/admin/kurse/'+id+'/nutzen',{nutzen:'Test'})).status===401);
 check('Kunde Löschen 403',(await kunde('DELETE',uri+'titelbild')).status===403);
 check('Gast Admin-Vorschaulesen 401',(await gast('GET','/api/admin/kurse/'+id+'/vorschau/titelbild')).status===401);
 check('Kunde Admin-Vorschaulesen 403',(await kunde('GET','/api/admin/kurse/'+id+'/vorschau/titelbild')).status===403);
 const bad=await admin('PUT',uri+'titelbild',Buffer.from('Kein PNG'),{'X-Dateiname':'test.png'});
 check('Text als PNG verweigert mit 400',bad.status===400&&bad.body.fehler==='vorschau_typ_ungueltig'&&leerVerzeichnis().length===0);
 const falscheEndung=await admin('PUT',uri+'titelbild',png,{'X-Dateiname':'bild.jpg'});
 check('PNG trotz .jpg erkannt',falscheEndung.status===201&&falscheEndung.body.typ==='image/png');
 const first=one('SELECT titelbild_datei FROM kurse WHERE id=?',id).titelbild_datei;
 check('Zufallsname, keine Nutzerpfade',/^[0-9a-f-]{36}$/.test(first)&&existsSync(join(ordner,'vorschau',first)));
 const genau=Buffer.alloc(2*1024*1024);png.copy(genau);
 check('Titelbild genau 2 MB erlaubt',(await admin('PUT',uri+'titelbild',genau)).status===201);
 check('Alter Titelbild-Dateiname gelöscht',!existsSync(join(ordner,'vorschau',first)));
 const vorZuGross=one('SELECT titelbild_datei FROM kurse WHERE id=?',id).titelbild_datei;
 const plus=Buffer.alloc(2*1024*1024+1);png.copy(plus);
 const gross=await admin('PUT',uri+'titelbild',plus);
 check('Titelbild 2 MB + 1 gibt 400 und behält altes',gross.status===400&&gross.body.fehler==='vorschau_zu_gross'&&one('SELECT titelbild_datei FROM kurse WHERE id=?',id).titelbild_datei===vorZuGross);
 const trailerFalsch=await admin('PUT',uri+'trailer',Buffer.from('Falscher Inhalt'));
 check('Trailer Magic verweigert',trailerFalsch.status===400&&trailerFalsch.body.fehler==='vorschau_typ_ungueltig');
 check('MP4 trotz falscher Endung erlaubt',(await admin('PUT',uri+'trailer',mp4,{'X-Dateiname':'clip.txt'})).status===201);
 const vorTrailer=one('SELECT trailer_datei FROM kurse WHERE id=?',id).trailer_datei;
 const trailerGenau=Buffer.alloc(30*1024*1024);mp4.copy(trailerGenau);
 check('Trailer genau 30 MB erlaubt',(await admin('PUT',uri+'trailer',trailerGenau)).status===201);
 check('Ersetzter Trailer von Platte entfernt',!existsSync(join(ordner,'vorschau',vorTrailer)));
 const alterTrailer=one('SELECT trailer_datei FROM kurse WHERE id=?',id).trailer_datei;
 const zuGross=Buffer.alloc(30*1024*1024+1);mp4.copy(zuGross);
 const trailerPlus=await admin('PUT',uri+'trailer',zuGross);
 check('Trailer 30 MB + 1 gibt 400',trailerPlus.status===400&&trailerPlus.body.fehler==='vorschau_zu_gross');
 check('Alter Trailer weiterhin da',existsSync(join(ordner,'vorschau',alterTrailer)));
 const invalid=await admin('PATCH','/api/admin/kurse/'+id+'/nutzen',{nutzen:Array(9).fill('Punkt').join('\n')});
 check('Neun Stichpunkte abgelehnt',invalid.status===400);
 check('121 Zeichen abgelehnt',(await admin('PATCH','/api/admin/kurse/'+id+'/nutzen',{nutzen:'x'.repeat(121)})).status===400);
 check('Genau acht mal 120 Zeichen erlaubt',(await admin('PATCH','/api/admin/kurse/'+id+'/nutzen',{nutzen:Array(8).fill('A'.repeat(120)).join('\n')})).status===200);
 check('Entwurf-Bild und Trailer 404',(await gast('GET','/api/kurse/'+id+'/titelbild')).status===404&&(await gast('GET','/api/kurse/'+id+'/trailer')).status===404);
 check('Admin kann Entwurfsbild ansehen',
   (await admin('GET','/api/admin/kurse/'+id+'/vorschau/titelbild')).status===200);
 check('Entwurf unsichtbar',(await gast('GET','/api/kurse')).body.every(k=>k.id!==id));
 await admin('POST','/api/admin/kurse/'+id+'/veroeffentlichen',{});
 const liste=await gast('GET','/api/kurse');
 const k=liste.body.find(k=>k.id===id);
 check('Nur boolesche Felder, nie Dateinamen in Kursliste',!!k&&!!k.hat_titelbild&&!!k.hat_trailer&&
   !JSON.stringify(k).includes(vorZuGross)&&!JSON.stringify(k).includes(alterTrailer)&&!('titelbild_datei' in k)&&!('trailer_datei' in k));
 const bild=await gast('GET','/api/kurse/'+id+'/titelbild');
 check('Öffentliches Bild 200, PNG, nosniff, Cache',bild.status===200&&bild.header.get('content-type')==='image/png'&&
   bild.header.get('x-content-type-options')==='nosniff'&&bild.header.get('cache-control').includes('max-age=300'));
 const stream=await gast('GET','/api/kurse/'+id+'/trailer',undefined,{Range:'bytes=0-99'});
 check('Trailer Range 206 / 100 Bytes',stream.status===206&&stream.body.length===100&&/^bytes 0-99\//.test(stream.header.get('content-range')));
 const trailerVoll=await gast('GET','/api/kurse/'+id+'/trailer');
 check('Trailer öffentlich 200 mit video/mp4',trailerVoll.status===200&&trailerVoll.header.get('content-type')==='video/mp4');
 await admin('POST','/api/admin/kurse/'+id+'/archivieren',{});
 check('Archivierte Vorschau nicht öffentlich',
   (await gast('GET','/api/kurse/'+id+'/titelbild')).status===404 &&
   (await gast('GET','/api/kurse')).body.every(e=>e.id!==id));
 check('Archivvorschau für Admin verfügbar',
   (await admin('GET','/api/admin/kurse/'+id+'/vorschau/titelbild')).status===200);
 const einladung=await admin('POST','/api/admin/kurse/'+id+'/zugaenge',{email:'vorschau-kunde@example.com'});
 check('Archivierer Kunde erhält Einladung',einladung.status===201||einladung.status===200);
 check('Archiviertes Titelbild nur für berechtigten Käufer',
   (await kunde('GET','/api/kurse/'+id+'/titelbild')).status===200 &&
   (await gast('GET','/api/kurse/'+id+'/titelbild')).status===404);

 async function roh(pfad) {
  return await new Promise((resolve,reject)=>{
   const q=request({hostname:'127.0.0.1',port:PORT,path:pfad},r=>{
     r.resume();r.on('end',()=>resolve(r.statusCode));
   });q.on('error',reject);q.end();
  });
 }
 const weg1=await roh('/api/kurse/../titelbild');
 const weg2=await roh('/api/kurse/%2e%2e/trailer');
 check('Pfadausbruch unverändert und kodiert gesperrt',weg1!==200&&weg2!==200);
 const delBild=await admin('DELETE',uri+'titelbild');
 check('Titelbild entfernen löscht Datei',delBild.status===200&&!existsSync(join(ordner,'vorschau',vorZuGross)));
 const delTrailer=await admin('DELETE',uri+'trailer');
 check('Trailer entfernen löscht Datei',delTrailer.status===200&&!existsSync(join(ordner,'vorschau',alterTrailer)));
 // Kurslöschung erfolgt ausschließlich bei Entwürfen ohne Käufern.
 const ent=await admin('POST','/api/admin/kurse',{titel:'Entwurf zum Löschen',preis_cent:10000});
 const loeschId=ent.body.id;
 await admin('PUT','/api/admin/kurse/'+loeschId+'/vorschau/titelbild',jpg);
 const loeschDatei=one('SELECT titelbild_datei FROM kurse WHERE id=?',loeschId).titelbild_datei;
 const loesch=await admin('DELETE','/api/admin/kurse/'+loeschId);
 check('Entwurf-Löschen entfernt Vorschau-Datei',loesch.status===200&&!existsSync(join(ordner,'vorschau',loeschDatei)));
 // Weitere erlaubte Magic-Bytes unabhängig von der Dateiendung.
 const mimeKurs=await admin('POST','/api/admin/kurse',{titel:'Formattest',preis_cent:10000});
 const mimeId=mimeKurs.body.id, mimeUri='/api/admin/kurse/'+mimeId+'/vorschau/';
 const webp=Buffer.from('RIFF0000WEBP','ascii');
 const webm=Buffer.from([0x1a,0x45,0xdf,0xa3,0,0,0,0,0,0,0,0,0,0,0,0]);
 check('WebP anhand von RIFF/WEBP erkannt',
   (await admin('PUT',mimeUri+'titelbild',webp,{'X-Dateiname':'anders.txt'})).body.typ==='image/webp');
 check('JPEG anhand von Magic Bytes erkannt',
   (await admin('PUT',mimeUri+'titelbild',jpg,{'X-Dateiname':'anders.png'})).body.typ==='image/jpeg');
 check('WebM anhand der EBML-Kennung erkannt',
   (await admin('PUT',mimeUri+'trailer',webm,{'X-Dateiname':'anders.mp4'})).body.typ==='video/webm');
 const mimeDateien=sql('SELECT titelbild_datei,trailer_datei FROM kurse WHERE id=?',mimeId)[0];
 await admin('DELETE','/api/admin/kurse/'+mimeId);
 check('Kurslöschung räumt beide Vorschau-Dateien ab',
   !existsSync(join(ordner,'vorschau',mimeDateien.titelbild_datei)) &&
   !existsSync(join(ordner,'vorschau',mimeDateien.trailer_datei)));
 const sonder=await admin('PUT',uri+'../../trailer',mp4);
 check('Unerlaubte Uploadpfade bleiben gesperrt',sonder.status!==201);
 const adminJs=readFileSync(resolve('public/admin/admin.js'),'utf8'), kundeJs=readFileSync(resolve('public/kunde.js'),'utf8');
 check('Admin-UI und Kunden-UI nur DOM ohne Inline-HTML',!adminJs.includes('innerHTML =')&&!kundeJs.includes('innerHTML =')&&!kundeJs.includes('autoplay:true'));
 check('Kursliste Bild/Platzhalter und Trailer im Detail',kundeJs.includes("function titelbild(")&&kundeJs.includes('kurs-bild-platzhalter')&&kundeJs.includes("function trailer("));
 check('409 Registrierung mit Passwort-Link',kundeJs.includes("r.status === 409")&&/href:\s*'#\/passwort-vergessen'/.test(kundeJs)&&/role:\s*'alert'/.test(kundeJs));
 // Regression: bezahlte Datei darf ohne gueltigen Zugang/Ticket nicht ausgeliefert werden.
 const neuesVideo=await admin('POST','/api/admin/kurse/'+id+'/lektionen',{titel:'Geschützte Lektion',art:'video',status:'veroeffentlicht'});   // Block 4: Status ausdruecklich
 const lektionId=neuesVideo.body.id;
 const protectedUpload=await admin('PUT','/api/admin/lektionen/'+lektionId+'/datei',mp4,{'Content-Type':'video/mp4'});
 check('Geschützte Lektion im Test angelegt',neuesVideo.status===201&&protectedUpload.status===201);
 check('Gast bekommt für bezahlte Datei 401',(await gast('GET','/api/lektionen/'+lektionId+'/datei')).status===401);
 const unberechtigt=klient();
 await unberechtigt('POST','/api/registrieren',{ zustimmung: true, email:'anderer-vorschau-kunde@example.com',passwort});
 check('Kunde ohne Kauf bleibt für Lektionsdatei gesperrt',
   (await unberechtigt('GET','/api/lektionen/'+lektionId+'/datei')).status===403);
 check('Eingeladener Käufer braucht weiter ein Wiedergabe-Ticket',
   (await kunde('GET','/api/lektionen/'+lektionId+'/datei')).status===403);
} catch(e){fail++;console.log('FEHLER Testablauf:',e.message);}
finally {
 if(server){server.kill();await warte(350);}
 try{rmSync(basis,{recursive:true,force:true});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
}
console.log('Vorschau: '+ok+' bestanden, '+fail+' fehlgeschlagen');
process.exitCode=fail?1:0;
