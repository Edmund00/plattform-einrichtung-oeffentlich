// Isolierte Scheibe-24-Tests: keine Netzaufrufe zu Stripe, keine echten Schlüssel.
import './test-sprache.mjs';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
const tmp=mkdtempSync(join(tmpdir(),'agent-test-'));
process.env.DB_DATEI=join(tmp,'agent.db');
const BASE='http://127.0.0.1:4497',PW=randomBytes(18).toString('hex');
let server,db,passed=0,failed=0;
const check=(n,v)=>{v?passed++:failed++;console.log((v?'OK ':'FEHLER ')+n)};
const mock={webhooks:{constructEvent:()=>({})},checkout:{sessions:{create:async()=>({id:'cs_mock',url:'https://checkout.stripe.com/test'})}}};
const customer=()=>{let cookie='';return async (method,path,body,headers={})=>{
 const h={...headers};if(cookie)h.cookie=cookie;if(body!==undefined)h['Content-Type']='application/json';
 const resp=await fetch(BASE+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
 if(resp.headers.get('set-cookie'))cookie=resp.headers.get('set-cookie').split(';')[0];
 return {status:resp.status,data:await resp.json(),headers:resp.headers};
}};
try{
 ({db}=await import('../db.mjs'));
 const {passwortHashen}=await import('../auth.mjs');
 const {erstelleServer}=await import('../app.mjs');
 const pass=await passwortHashen(PW),t=new Date().toISOString();
 db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,'admin',?)").run('agent-admin@example.com',pass,t);
 server=erstelleServer({stripe:mock,webhookSecret:'test',base:BASE,dateiOrdner:join(tmp,'dateien')}).listen(4497,'127.0.0.1');
 await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 const admin=customer(),anon=customer();
 await admin('POST','/api/anmelden',{email:'agent-admin@example.com',passwort:PW});
 const api='/api/admin/agent',agent='/api/agent';
 const bad=await anon('GET',agent+'/kurse');
 check('Ohne Schlüssel 401',bad.status===401);
 const newKey=await admin('POST',api+'/schluessel',{name:'Gabriella Test'});
 const key=newKey.data.schluessel;
 check('Schlüssel einmalig nur im Erzeugungs-Response',newKey.status===201&&/^vat_[A-Za-z0-9_-]{43}$/.test(key));
 const record=db.prepare('SELECT schluessel_hash,vorschau FROM agent_schluessel WHERE id=?').get(newKey.data.id);
 check('Datenbank nur SHA-256 und 8 Zeichen Vorschau',record.schluessel_hash===createHash('sha256').update(key).digest('hex')&&record.vorschau===key.slice(0,8)&&
  !JSON.stringify(record).includes(key));
 const listing=await admin('GET',api+'/schluessel');
 check('Liste enthält niemals Klartext',!JSON.stringify(listing.data).includes(key));
 const bearer={authorization:'Bearer '+key},fake={authorization:'Bearer vat_'+randomBytes(32).toString('base64url')};
 check('Falscher Schlüssel 401',(await anon('GET',agent+'/kurse',undefined,fake)).status===401);
 check('Cookie ohne Bearer 401',(await admin('GET',agent+'/kurse')).status===401);
 check('Cookie und Bearer 401',(await admin('GET',agent+'/kurse',undefined,bearer)).status===401);
 check('Agent-Schlüssel an /api/admin 403',(await anon('GET','/api/admin/kurse',undefined,bearer)).status===403);
 let extraKeys=[];
 for(let i=0;i<4;i++)extraKeys.push(await admin('POST',api+'/schluessel',{name:'Zusatz '+i}));
 check('Maximal fünf aktive Schlüssel',extraKeys.every(x=>x.status===201)&&
  (await admin('POST',api+'/schluessel',{name:'Zu viel'})).status===409);
  const creates=await anon('POST',agent+'/kurse',{titel:'Privater Entwurf',beschreibung:'Inhalt',preis_cent:990000},bearer);
 check('Entwurf anlegen 201',creates.status===201&&creates.data.status==='entwurf');
 const cid=creates.data.id;
 check('Entwurf ändern',(await anon('PATCH',agent+'/kurse/'+cid,{titel:'Neuer Titel'},bearer)).status===200);
 check('GPT-Bearer trotz fremder Origin, keine Cookie-CSRF',(await anon('PATCH',agent+'/kurse/'+cid,{beschreibung:'GPT'}, {...bearer,origin:'https://chatgpt.com'})).status===200);
 check('Browser-Admin-CSRF bleibt geschützt',(await admin('POST',api+'/schluessel',{name:'Verboten'}, {origin:'https://chatgpt.com'})).status===403);
 check('Längengrenze 160',(await anon('PATCH',agent+'/kurse/'+cid,{titel:'X'.repeat(161)},bearer)).status===400);
 const lesson=await anon('POST',agent+'/kurse/'+cid+'/lektionen',{titel:'Lektion',inhalt:'<script>alert(1)</script>'},bearer);
 check('Lektion anlegen',lesson.status===201);
 const lid=lesson.data.id;
 check('Nur Text gespeichert',db.prepare('SELECT inhalt FROM lektionen WHERE id=?').get(lid).inhalt==='<script>alert(1)</script>');
 check('Textgrenze 20000',(await anon('PATCH',agent+'/lektionen/'+lid,{inhalt:'a'.repeat(20001)},bearer)).status===400);
 check('20.000 Zeichen inklusive Unicode möglich',(await anon('PATCH',agent+'/lektionen/'+lid,{inhalt:'á'.repeat(20000)},bearer)).status===200);
 check('Reihenfolge und Änderung',(await anon('PATCH',agent+'/lektionen/'+lid,{reihenfolge:8,inhalt:'Korrigiert'},bearer)).status===200);
 const pub=await anon('POST',agent+'/kurse/'+cid+'/freigabe',{},bearer);
 check('Freigabeantrag blockiert weitere Agent-Änderung',pub.status===201&&
   db.prepare('SELECT status FROM kurse WHERE id=?').get(cid).status==='freigabe_offen'&&
   (await anon('PATCH',agent+'/kurse/'+cid,{titel:'Trotzdem'},bearer)).status===403);
 const pending=await admin('GET',api+'/antraege');
 check('Antrag in Freigabeliste',pending.data.some(x=>x.id===pub.data.antrag_id));
 const approved=await admin('POST',api+'/antraege/'+pub.data.antrag_id+'/entscheiden',{entscheidung:'freigeben'});
 check('Nur Admin veröffentlicht und Lektion sichtbar',approved.status===200&&
   db.prepare('SELECT status FROM kurse WHERE id=?').get(cid).status==='veroeffentlicht'&&
   db.prepare('SELECT status FROM lektionen WHERE id=?').get(lid).status==='veroeffentlicht');
 check('Doppelte Freigabe abgelehnt',(await admin('POST',api+'/antraege/'+pub.data.antrag_id+'/entscheiden',{entscheidung:'freigeben'})).status===409);
 const before=db.prepare('SELECT titel FROM kurse WHERE id=?').get(cid).titel;
 const prop=await anon('POST',agent+'/kurse/'+cid+'/vorschlag',{feld:'titel',wert:'Vorgeschlagen'},bearer);
 check('Vorschlag ändert veröffentlichte Kurse nicht',prop.status===201&&db.prepare('SELECT titel FROM kurse WHERE id=?').get(cid).titel===before);
 check('Änderung am veröffentlichten Kurs 403',(await anon('PATCH',agent+'/kurse/'+cid,{preis_cent:100000},bearer)).status===403);
 check('Lektion veröffentlicht ändern 403',(await anon('PATCH',agent+'/lektionen/'+lid,{titel:'Unbefugt'},bearer)).status===403);
 check('Veröffentlichten Kurs löschen 403',(await anon('DELETE',agent+'/kurse/'+cid,undefined,bearer)).status===403);
 check('Veröffentlichung als Agent verboten',(await anon('POST',agent+'/kurse/'+cid+'/veroeffentlichen',{},bearer)).status===403);
 check('Agent-Dateien, Zahlungen, Stripe, Mail und Upload 403',
   (await anon('GET',agent+'/dateien',undefined,bearer)).status===403&&
   (await anon('POST',agent+'/stripe',{},bearer)).status===403&&
   (await anon('POST',agent+'/upload',{},bearer)).status===403&&
   (await anon('GET',agent+'/mails',undefined,bearer)).status===403);
 check('Verbote Benutzer/Bestellung/Export 403',(await anon('GET',agent+'/benutzer',undefined,bearer)).status===403&&
   (await anon('GET',agent+'/bestellungen',undefined,bearer)).status===403&&
   (await anon('GET',agent+'/export',undefined,bearer)).status===403);
 check('Agent-Audit enthält abgelehnte Versuche',db.prepare("SELECT COUNT(*) n FROM agent_protokoll WHERE ergebnis='abgelehnt'").get().n>=10);
 check('Agent-Audit ohne Geheimnisse',!db.prepare('SELECT beschreibung FROM agent_protokoll').all().some(x=>x.beschreibung.includes(key)));
 check('Nur ein Schlüssel-Klartext in der Erzeugungsantwort',!JSON.stringify((await admin('GET',api+'/protokoll')).data).includes(key));
 check('Vorschlagsfreigabe erst bei Admin', (await admin('POST',api+'/antraege/'+prop.data.antrag_id+'/entscheiden',{entscheidung:'freigeben'})).status===200&&
   db.prepare('SELECT titel FROM kurse WHERE id=?').get(cid).titel==='Vorgeschlagen');
 const priceProposal=await anon('POST',agent+'/kurse/'+cid+'/vorschlag',{feld:'preis_cent',wert:105000},bearer);
 check('Preisvorschlag beeinflusst veröffentlichten Preis nicht',priceProposal.status===201&&db.prepare('SELECT preis_cent FROM kurse WHERE id=?').get(cid).preis_cent===990000);
 check('Preis erst nach Admin-Freigabe geändert',
   (await admin('POST',api+'/antraege/'+priceProposal.data.antrag_id+'/entscheiden',{entscheidung:'freigeben'})).status===200&&
   db.prepare('SELECT preis_cent FROM kurse WHERE id=?').get(cid).preis_cent===105000);
 const weg=await anon('POST',agent+'/kurse',{titel:'Löschbarer Entwurf'},bearer);
 check('Nur Entwurf ohne Dateien löschbar',weg.status===201&&
   (await anon('DELETE',agent+'/kurse/'+weg.data.id,undefined,bearer)).status===200&&
   !db.prepare('SELECT id FROM kurse WHERE id=?').get(weg.data.id));
 const spec=(await anon('GET','/agent/openapi.json')).data;
 const ops=Object.values(spec.paths).flatMap(x=>Object.values(x));
 check('OpenAPI 3.1, höchstens 15 Operationen, Beschreibungen kurz',
   spec.openapi==='3.1.0'&&ops.length<=15&&ops.every(x=>x.operationId&&x.description.length<=300)&&
   !JSON.stringify(spec).includes(key));
 const stamp=new Date().toISOString();
 for(let i=0;i<50;i++)db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,'',0,'huf','entwurf',?,?)").run('Testentwurf '+i,stamp,stamp);
 check('50 offene Entwürfe: neuer Entwurf 409',(await anon('POST',agent+'/kurse',{titel:'Zusätzlich'},bearer)).status===409);
 for(let i=0;i<65;i++)await anon('GET',agent+'/kurse',undefined,bearer);
 check('Agent-Rate-Limit 429',(await anon('GET',agent+'/kurse',undefined,bearer)).status===429);
 const revoked=await admin('POST',api+'/schluessel/'+newKey.data.id+'/widerrufen',{});
 check('Widerruf sofort',revoked.status===200&&(await anon('GET',agent+'/kurse',undefined,bearer)).status===401);
 const short=await admin('POST',api+'/schluessel',{name:'Ablauf'});
 db.prepare('UPDATE agent_schluessel SET laeuft_ab=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),short.data.id);
 check('Abgelaufener Schlüssel 401',(await anon('GET',agent+'/kurse',undefined,{authorization:'Bearer '+short.data.schluessel})).status===401);
 const ui=readFileSync(resolve('public/admin/admin.js'),'utf8').replace(/\r\n/g,'\n');
 check('Admin-Vorschau ist DOM-basiert',ui.includes('async function agentBereich')&&!/\.\s*innerHTML\s*=/.test(ui));
 const vorher=db.prepare('SELECT COUNT(*) n FROM agent_protokoll').get().n;
 for(let i=0;i<80;i++)await anon('GET',agent+'/kurse/'+i,undefined,fake);
 const zuwachs=db.prepare('SELECT COUNT(*) n FROM agent_protokoll').get().n-vorher;
 check('80 anonyme Fehlversuche fluten das Protokoll nicht (höchstens 30 Zeilen)',zuwachs>=1&&zuwachs<=30);
 const logs=await admin('GET',api+'/protokoll');
 check('Admin-Protokoll zeigt Einträge',logs.status===200&&logs.data.length>0);
 {
  // J7: die echte Anzeigelogik aus admin.js gegen echte Protokollzeilen: nie API-Pfade, nie rohe Codes.
  const {readFileSync}=await import('node:fs'), {HU}=await import('../texte.mjs');
  const quelle=readFileSync(new URL('../public/admin/admin.js',import.meta.url),'utf8');
  const zeile=n=>quelle.split(/\r?\n/).find(s=>s.startsWith(n));
  const anzeige=new Function('T','t',zeile('const agentAnzeige')+';'+zeile('const agentZiel')+';return {agentAnzeige,agentZiel};')(HU,k=>HU[k]);
  const zeilen=logs.data.map(x=>[anzeige.agentAnzeige('aktion',x.aktion),anzeige.agentAnzeige('ergebnis',x.ergebnis),anzeige.agentAnzeige('grund',x.beschreibung),anzeige.agentZiel(x.ziel)].join(' | '));
  check('Admin-Protokoll: keine API-Pfade, keine rohen Codes, ungarisch ('+zeilen.length+' Zeilen)',
   zeilen.length>0&&zeilen.every(s=>!/\/api\/|agent_|[a-z]+_[a-z]+/.test(s)),zeilen.find(s=>/\/api\/|agent_|[a-z]+_[a-z]+/.test(s)));
  check('Unbekannte Aktion/Pfad wird zu "ismeretlen", Methode wird übersetzt',
   anzeige.agentAnzeige('aktion','GET /api/agent/kurse')===HU.agent_protokoll_aktion_GET&&anzeige.agentAnzeige('grund','irgendein_code')===HU.a_ismeretlen&&anzeige.agentZiel('/api/agent/kurse')==='');
 }
}catch(e){failed++;console.log('FEHLER Testablauf '+(e.code||e.message))}
finally{try{await new Promise(r=>server?server.close(r):r())}catch{}try{db?.close()}catch{}try{rmSync(tmp,{recursive:true,force:true})}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e}}
console.log('Agent: '+passed+' OK, '+failed+' FEHLER');process.exitCode=failed?1:0;
