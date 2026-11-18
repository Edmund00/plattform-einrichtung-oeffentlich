// B4 Nachweis: Rate-Limit je KONTO bei PARALLELEN Anfragen. 30 gleichzeitige Widerrufe von 30 verschiedenen Bestellungen EINES Kontos:
// erlaubt sind 20 pro Stunde -> genau 20 gehen durch (je eine Erstattung mit eigenem Schluessel), genau 10 bekommen 429 (keine Erstattung, keine Zeile).
// Dazu: zweites Konto bleibt unberuehrt; derselbe Widerruf 10x gleichzeitig -> genau eine Erstattung.
import './test-sprache.mjs';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
process.env.TEXT_SPRACHE='hu';   // Test setzt seine Sprache selbst
const dir=mkdtempSync(join(tmpdir(),'schulung-ratelimit-'));
process.env.DB_DATEI=join(dir,'test.db');
let ok=0,fail=0,db,server;const refunds=[];
const check=(n,x,d='')=>{if(x)ok++;else fail++;console.log((x?'OK ':'FEHLER ')+n+(x?'':' '+d))};
const PORT=4492,BASE='http://127.0.0.1:'+PORT,password=randomBytes(24).toString('hex');
const stripe={customers:{create:async()=>({id:'cus_rl'}),update:async()=>({})},
 checkout:{sessions:{create:async()=>({id:'cs_rl',url:'https://checkout.stripe.com/test'}),retrieve:async()=>({payment_intent:'pi_rl'})}},
 paymentIntents:{retrieve:async(id)=>({id})},
 refunds:{create:async(data,opts)=>{await new Promise(r=>setTimeout(r,20));refunds.push({data,opts});return {id:'re_'+refunds.length};}},
 webhooks:{constructEvent:()=>({})}};
function client(){const jar=new Map();return {async request(method,path,body){
 const headers={};if(jar.size)headers.Cookie=[...jar].map(([k,v])=>k+'='+v).join('; ');if(body!==undefined)headers['Content-Type']='application/json';
 const r=await fetch(BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 for(const c of r.headers.getSetCookie?.()??[]){const [kv]=c.split(';');const i=kv.indexOf('=');jar.set(kv.slice(0,i),kv.slice(i+1));}
 let b={};try{b=await r.json();}catch{}
 return {status:r.status,body:b};
}}}
try{
 ({db}=await import('../db.mjs'));
 const {passwortHashen}=await import('../auth.mjs'),{erstelleServer}=await import('../app.mjs');
 const ph=await passwortHashen(password);const jetzt=new Date().toISOString();
 const uid=s=>Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,'kunde',?,?)").run(s,ph,jetzt,Date.now()).lastInsertRowid);
 const a=uid('rl-a@example.com'),b=uid('rl-b@example.com');
 const k=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES('RL','',990000,'huf','veroeffentlicht',?,?)").run(jetzt,jetzt).lastInsertRowid);
 const order=(id,u)=>Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES(?,?,?,?,990000,'huf','bezahlt','einmal',?,?)").run(id,'pi_'+id,u,k,jetzt,jetzt).lastInsertRowid);
 const ordA=[];for(let i=0;i<30;i++)ordA.push(order('cs_rl_a'+i,a));
 const ordB=[order('cs_rl_b0',b)];
 const zeit=new Date().toISOString();
 for(const x of [...ordA,...ordB]){const u=db.prepare('SELECT benutzer_id FROM bestellungen WHERE id=?').get(x).benutzer_id;db.prepare('INSERT INTO kauf_zustimmung(benutzer_id,kurs_id,text_version,zeit,stripe_sitzung) VALUES(?,?,?,?,?)').run(u,k,'v1',zeit,db.prepare('SELECT stripe_sitzung s FROM bestellungen WHERE id=?').get(x).s);}
 server=erstelleServer({stripe,base:BASE,webhookSecret:'test',mailer:async()=>true,dateiOrdner:join(dir,'dateien'),ellallasWiederaufnahme:false}).listen(PORT,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const ca=client(),cb=client();
 await ca.request('POST','/api/anmelden',{email:'rl-a@example.com',passwort:password});
 await cb.request('POST','/api/anmelden',{email:'rl-b@example.com',passwort:password});
 const pfad=id=>'/api/bestellungen/'+id+'/ellallas';
 // 1) 30 gleichzeitige Widerrufe desselben Kontos
 const res=await Promise.all(ordA.map(id=>ca.request('POST',pfad(id),{bestaetigt:true})));
 const durch=res.filter(r=>r.status!==429),limit=res.filter(r=>r.status===429),fuenf=res.filter(r=>r.status>=500);
 console.log(`30 parallele Anfragen eines Kontos: durchgelassen=${durch.length} (200: ${res.filter(r=>r.status===200).length}), 429=${limit.length}, 5xx=${fuenf.length}`);
 check('30 parallele Anfragen: genau 20 durchgelassen',durch.length===20,durch.length);
 check('30 parallele Anfragen: genau 10 mit 429',limit.length===10,limit.length);
 check('keine 5xx-Fehler',fuenf.length===0,fuenf.length);
 check('Stripe: genau 20 Erstattungen, 20 verschiedene Schluessel',refunds.length===20&&new Set(refunds.map(x=>x.opts.idempotencyKey)).size===20,refunds.length);
 check('Datenbank: 20 Widerrufszeilen, 20 Versuche gezaehlt; abgelehnte 10 hinterlassen keine Zeile',db.prepare('SELECT COUNT(*) n FROM ellallas WHERE bestellung_id IN ('+ordA.join(',')+')').get().n===20&&db.prepare('SELECT COUNT(*) n FROM ellallas_versuch WHERE benutzer_id=?').get(a).n===20);
 // 2) anderes Konto unberuehrt
 const rb=await cb.request('POST',pfad(ordB[0]),{bestaetigt:true});
 check('zweites Konto waehrend das erste gesperrt ist: nicht betroffen (200)',rb.status===200,rb.status);
 // 3) derselbe Widerruf 10x gleichzeitig (anderes Konto, frische Bestellung): genau eine Erstattung
 const o2=order('cs_rl_b1',b);db.prepare('INSERT INTO kauf_zustimmung(benutzer_id,kurs_id,text_version,zeit,stripe_sitzung) VALUES(?,?,?,?,?)').run(b,k,'v1',zeit,'cs_rl_b1');
 const vor=refunds.length;
 const r10=await Promise.all(Array.from({length:10},()=>cb.request('POST',pfad(o2),{bestaetigt:true})));
 check('derselbe Widerruf 10x gleichzeitig: genau eine Stripe-Erstattung',refunds.length===vor+1,refunds.length-vor);
 const t503=r10.filter(r=>r.status===503).map(r=>r.body.text);
 console.log('derselbe Widerruf 10x gleichzeitig: '+r10.map(r=>r.status+'/'+r.body.ergebnis).join(' '));
 check('derselbe Widerruf 10x gleichzeitig: genau eine Antwort 200, die anderen 9 melden "in Bearbeitung" (503, ergebnis bearbeitung), sonst nichts',r10.filter(r=>r.status===200).length===1&&r10.filter(r=>r.status===503&&r.body.ergebnis==='bearbeitung').length===9,r10.map(r=>r.status).join(','));
 check('503-Text (hu) verstaendlich: "bereits in Bearbeitung, kurz warten, nichts erneut senden"',t503.length===9&&t503.every(x=>x.includes('már folyamatban')&&x.includes('várj')&&x.includes('Nem kell újra')),t503[0]);
 const o3=order('cs_rl_b2',b);db.prepare('INSERT INTO kauf_zustimmung(benutzer_id,kurs_id,text_version,zeit,stripe_sitzung) VALUES(?,?,?,?,?)').run(b,k,'v1',zeit,'cs_rl_b2');
 await cb.request('POST',pfad(o3),{bestaetigt:true});
 db.prepare("UPDATE ellallas SET ergebnis='bearbeitung' WHERE bestellung_id=?").run(o3);
 for(const [l,teile] of [['de',['bereits bearbeitet','warte kurz','nichts erneut']],['en',['already being processed','wait a moment','not need to submit']],['hu',['már folyamatban','várj','Nem kell újra']]]){
  const rr=await cb.request('POST',pfad(o3)+'?lang='+l,{bestaetigt:true});
  check('503-Text in Sprache '+l+' verstaendlich (Status 503, ergebnis bearbeitung)',rr.status===503&&rr.body.ergebnis==='bearbeitung'&&teile.every(x=>(rr.body.text||'').includes(x)),JSON.stringify(rr.body));
 }
 const vorSpaet=refunds.length;
 const spaet=await cb.request('POST',pfad(o2),{bestaetigt:true});
 check('spaetere Wiederholung nach Abschluss: 200 (Ergebnis erstattung), weiter nur eine Erstattung',spaet.status===200&&refunds.length===vorSpaet,spaet.status);
}finally{server?.close();}
console.log(`Ratelimit-parallel: ${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail?1:0);
