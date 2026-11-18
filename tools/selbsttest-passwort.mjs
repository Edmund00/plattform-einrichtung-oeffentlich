// Scheibe 11 – isolierte Tests, keine echten Resend- oder Stripe-Schlüssel.
import './test-sprache.mjs';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const basis=mkdtempSync(join(tmpdir(),'schulung-passwort-')), datei=join(basis,'pw.db');
process.env.DB_DATEI=datei;
const base='http://127.0.0.1:4420';
const passwort=randomBytes(24).toString('hex');
const neuesPasswort=randomBytes(24).toString('hex');
const anderesPasswort=randomBytes(24).toString('hex');
const adminNeuesPasswort=randomBytes(24).toString('hex');
const falschesPasswort=randomBytes(24).toString('hex');
const kurzesPasswort=randomBytes(2).toString('hex');
let ok=0,fehlerzahl=0,server;
const pruefe=(n,b)=>{if(b)ok++;else fehlerzahl++;console.log((b?'OK     ':'FEHLER ')+n);};
const warte=()=>new Promise(r=>setTimeout(r,15));
async function bis(f,anzahl=100){for(let i=0;i<anzahl;i++){if(f())return true;await warte();}return false;}
function sql(q,...a){const d=new DatabaseSync(datei);try{return d.prepare(q).all(...a);}finally{d.close();}}
const eins=(q,...a)=>sql(q,...a)[0];
function client(ip) {
  let cookie='';
  return {async api(m,path,body,headers={}){
    const r=await fetch(base+path,{method:m,headers:{'X-Forwarded-For':ip,...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},
      ...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];
    let d={};try{d=await r.json();}catch{}
    return {s:r.status,d,h:r.headers};
  },get cookie(){return cookie;}};
}
let mails=[],mailFehler=false;
const warnAlt=console.warn, errorAlt=console.error, protokoll=[];
console.warn=(...teile)=>{ protokoll.push(teile.map(String).join(' ')); warnAlt(...teile); };
console.error=(...teile)=>{ protokoll.push(teile.map(String).join(' ')); errorAlt(...teile); };
const mailer=async mail=>{mails.push(mail);if(mailFehler)throw Error('Mailanbieter simuliert nicht erreichbar');return true;};
const stripe={webhooks:{constructEvent:b=>JSON.parse(b.toString())},customers:{create:async()=>({id:'cus_pw_1'})},
  checkout:{sessions:{create:async()=>({url:'https://checkout.stripe.com/test'})}},
  subscriptions:{retrieve:async()=>({metadata:{}})}};
try{
  const {erstelleServer}=await import(pathToFileURL(resolve('app.mjs')).href);
  server=erstelleServer({stripe,webhookSecret:'fake',base,trustProxy:1,mailer}).listen(4420,'127.0.0.1');
  await new Promise((a,b)=>{if(server.listening)return a();server.once('listening',a);server.once('error',b);});
  const adminMail='pw.admin@example.com', kundeMail='pw.kunde@example.com';
  const cmd=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','tools/admin-anlegen.mjs',adminMail],
    {env:{...process.env,ADMIN_PASSWORT:passwort},encoding:'utf8'});
  pruefe('Admin angelegt',cmd.status===0);
  const kunde=client('203.0.113.1'), admin=client('203.0.113.2'), andereSitzung=client('203.0.113.3');
  pruefe('Kunde registriert',(await kunde.api('POST','/api/registrieren',{ zustimmung: true, email:kundeMail,passwort})).s===201);
  { const z=client('203.0.113.9'); const mailZ='zustimmung-'+kundeMail;
    const nein=await z.api('POST','/api/registrieren',{email:mailZ,passwort,zustimmung:false});
    pruefe('KW-4: Registrierung mit zustimmung:false wird abgelehnt (400 zustimmung_noetig), kein Konto',nein.s===400&&JSON.stringify(nein).includes('zustimmung_noetig')&&sql('SELECT 1 FROM benutzer WHERE email=?',mailZ).length===0);
    pruefe('KW-4: Registrierung mit zustimmung:true klappt (201)',(await z.api('POST','/api/registrieren',{email:mailZ,passwort,zustimmung:true})).s===201);
    const ohneFeld=await z.api('POST','/api/registrieren',{email:'ohne-'+mailZ,passwort});
    pruefe('KW-4: Registrierung OHNE Einwilligungsfeld wird abgelehnt (400 zustimmung_noetig), kein Konto',ohneFeld.s===400&&JSON.stringify(ohneFeld).includes('zustimmung_noetig')&&sql('SELECT 1 FROM benutzer WHERE email=?','ohne-'+mailZ).length===0);
    const ez=sql('SELECT einwilligung_zeit z,einwilligung_version v FROM benutzer WHERE email=?',mailZ)[0];
    pruefe('KW-4: Einwilligung am Konto gespeichert (Zeitpunkt jetzt, Textstand reg-2026-11-03)',!!ez&&Math.abs(Date.now()-Date.parse(ez.z))<120000&&ez.v==='reg-2026-11-03'); }
  pruefe('Zweite Sitzung desselben Benutzers',(await andereSitzung.api('POST','/api/anmelden',{email:kundeMail,passwort})).s===200);
  pruefe('Admin angemeldet',(await admin.api('POST','/api/anmelden',{email:adminMail,passwort})).s===200);
  const resetA=client('203.0.113.11'),resetB=client('203.0.113.12');
  const bekannt=await resetA.api('POST','/api/passwort-vergessen',{email:kundeMail});
  const unbekannt=await resetB.api('POST','/api/passwort-vergessen',{email:'niemand@example.com'});
  pruefe('Bekannt/unbekannt: gleiche 200-Antwort und Struktur',bekannt.s===200&&unbekannt.s===200&&JSON.stringify(bekannt.d)===JSON.stringify(unbekannt.d));
  pruefe('Neutrale Antwort ohne Token',!JSON.stringify(bekannt.d).includes('passwort-neu') && !JSON.stringify(bekannt.d).includes('token'));
  pruefe('Beide Antworten no-store',bekannt.h.get('cache-control')==='no-store'&&unbekannt.h.get('cache-control')==='no-store');
  const resetMails=()=>mails.filter(x=>x.subject==='Jelszó-visszaállítás');
  pruefe('Reset-Mail asynchron erzeugt',await bis(()=>resetMails().length===1));
  const mail1=resetMails()[0];
  const match=mail1?.text.match(/http:\/\/127\.0\.0\.1:4420\/#\/passwort-neu\/([A-Za-z0-9_-]{43})/);
  const token=match?.[1]||'';
  pruefe('Reset-Link nur im Fragment und 43 Zeichen',!!match&&mail1.html.includes('#/passwort-neu/')&&!bekannt.d.token);
  pruefe('Token und Klartextpasswort in keinem Serverlog',!protokoll.join(' ').includes(token)&&!protokoll.join(' ').includes(passwort));
  pruefe('Keine Kartendaten in Reset-Mail',!JSON.stringify(mail1).includes('4242')&&!JSON.stringify(mail1).includes('payment_intent'));
  const hash=createHash('sha256').update(token).digest('hex');
  pruefe('DB speichert nur SHA-256, nicht Klartext',!!eins('SELECT id FROM passwort_token WHERE token_hash=?',hash)&&
    !sql('SELECT token_hash FROM passwort_token').some(x=>x.token_hash===token)&&
    !readFileSync(datei).toString('latin1').includes(token));
  const dAbgelaufen=new DatabaseSync(datei);
  dAbgelaufen.prepare('UPDATE passwort_token SET laeuft_ab=? WHERE token_hash=?').run(Date.now()-1,hash);
  dAbgelaufen.close();
  pruefe('Abgelaufenes Token zurückgewiesen',
    (await client('203.0.113.20').api('POST','/api/passwort-zuruecksetzen',
      {token,passwort:neuesPasswort})).s===400);
  const zweite=await client('203.0.113.13').api('POST','/api/passwort-vergessen',{email:kundeMail});
  pruefe('Neuer Token angefordert',zweite.s===200&&await bis(()=>resetMails().length===2));
  const token2=resetMails()[1]?.text.match(/passwort-neu\/([A-Za-z0-9_-]{43})/)?.[1]||'';
  const reset=client('203.0.113.21');
  pruefe('Erster Token entwertet',(await reset.api('POST','/api/passwort-zuruecksetzen',{token,passwort:neuesPasswort})).s===400);
  pruefe('Falsches Token abgelehnt',(await reset.api('POST','/api/passwort-zuruecksetzen',{token:randomBytes(32).toString('base64url'),passwort:neuesPasswort})).s===400);
  pruefe('Manipulierter Token abgelehnt',(await reset.api('POST','/api/passwort-zuruecksetzen',{token:token2.slice(0,-1)+'$',passwort:neuesPasswort})).s===400);
  pruefe('Passwortregel: zu kurz',(await reset.api('POST','/api/passwort-zuruecksetzen',{token:token2,passwort:kurzesPasswort})).s===400);
  const fertig=await reset.api('POST','/api/passwort-zuruecksetzen',{token:token2,passwort:neuesPasswort});
  pruefe('Gültiger Token setzt Passwort einmalig',fertig.s===200);
  pruefe('Token danach verbraucht',(await reset.api('POST','/api/passwort-zuruecksetzen',{token:token2,passwort:randomBytes(24).toString('hex')})).s===400);
  pruefe('Reset beendet alle Sitzungen',(await kunde.api('GET','/api/ich')).d.angemeldet===false&&
    (await andereSitzung.api('GET','/api/ich')).d.angemeldet===false);
  pruefe('Benachrichtigung nach Reset',await bis(()=>mails.some(x=>x.subject.includes('megváltozott'))));
  const wieder=client('203.0.113.24'),zweiteSitzung=client('203.0.113.25');
  pruefe('Altes Passwort funktioniert nicht mehr',(await wieder.api('POST','/api/anmelden',{email:kundeMail,passwort})).s===401);
  pruefe('Neues Passwort funktioniert',(await wieder.api('POST','/api/anmelden',{email:kundeMail,passwort:neuesPasswort})).s===200);
  await zweiteSitzung.api('POST','/api/anmelden',{email:kundeMail,passwort:neuesPasswort});
  pruefe('Passwortänderung mit falschem alten Passwort 401',(await wieder.api('POST','/api/passwort-aendern',{aktuell:falschesPasswort,neu:anderesPasswort})).s===401);
  pruefe('Passwortänderung mit richtigem alten Passwort',(await wieder.api('POST','/api/passwort-aendern',{aktuell:neuesPasswort,neu:anderesPasswort})).s===200);
  pruefe('Änderung behält eigene Sitzung, beendet andere',(await wieder.api('GET','/api/ich')).d.angemeldet===true &&
    (await zweiteSitzung.api('GET','/api/ich')).d.angemeldet===false);
  const adminReset=await client('203.0.113.26').api('POST','/api/passwort-vergessen',{email:adminMail});
  pruefe('Admin kann Reset anfordern',adminReset.s===200&&await bis(()=>mails.some(x=>x.to===adminMail)));
  const adminToken=mails.find(x=>x.to===adminMail && x.subject==='Jelszó-visszaállítás')?.text.match(/passwort-neu\/([A-Za-z0-9_-]{43})/)?.[1];
  pruefe('Admin kann Passwort zurücksetzen',(await client('203.0.113.27').api('POST','/api/passwort-zuruecksetzen',{token:adminToken,passwort:adminNeuesPasswort})).s===200);
  pruefe('Admin-Sitzung danach beendet',(await admin.api('GET','/api/ich')).d.angemeldet===false);
  // Eigener Rate-IP-Prüfer am Schluss, damit vorherige Sicherheitsfälle isoliert sind.
  pruefe('HTTP-Passwortantwort ohne HSTS',(await kunde.api('GET','/api/ich')).h.get('strict-transport-security')===null);
  const fehlerhaft=await fetch(base+'/api/passwort-vergessen',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
  pruefe('Auch JSON-Fehler hat no-store',fehlerhaft.status===400&&fehlerhaft.headers.get('cache-control')==='no-store');
  // HTTPS-Basisadresse schaltet HSTS ein, obwohl dieser reine Testserver nur HTTP bindet.
  const hstsServer=erstelleServer({stripe,webhookSecret:'fake',base:'https://beispiel.valorebusinessclub.com',mailer}).listen(4421,'127.0.0.1');
  await new Promise((ja,nein)=>{if(hstsServer.listening)return ja();hstsServer.once('listening',ja);hstsServer.once('error',nein);});
  const hstsAntwort=await fetch('http://127.0.0.1:4421/api/ich');
  pruefe('HTTPS-Basis schaltet HSTS max-age=31536000',hstsAntwort.headers.get('strict-transport-security')==='max-age=31536000');
  await new Promise(done=>hstsServer.close(done));
  const limit=client('203.0.113.99');
  let reaktionen=[];for(let i=0;i<11;i++)reaktionen.push(await limit.api('POST','/api/passwort-vergessen',{email:'nobody@example.com'}));
  pruefe('Auch oberhalb IP-Limit neutrales 200',reaktionen.every(x=>x.s===200&&JSON.stringify(x.d)===JSON.stringify(reaktionen[0].d)));
  pruefe('Reset nach IP-Limit 429',(await limit.api('POST','/api/passwort-zuruecksetzen',{token:token2,passwort:anderesPasswort})).s===429);
  const limitMail='pw.limit@example.com';
  const userLimit=client('203.0.113.101');
  await userLimit.api('POST','/api/registrieren',{ zustimmung: true, email:limitMail,passwort});
  let vorher=resetMails().filter(x=>x.to===limitMail).length;
  for(let i=0;i<4;i++)await client('203.0.113.'+(110+i)).api('POST','/api/passwort-vergessen',{email:limitMail});
  pruefe('Pro E-Mail maximal 3 Reset-Mails',await bis(()=>resetMails().filter(x=>x.to===limitMail).length===vorher+3));
  const neueRegel=client('203.0.113.125');
  await neueRegel.api('POST','/api/anmelden',{email:limitMail,passwort});
  let falsch=[];for(let i=0;i<7;i++)falsch.push((await neueRegel.api('POST','/api/passwort-aendern',{aktuell:falschesPasswort,neu:randomBytes(24).toString('hex')})).s);
  pruefe('Sechs Fehlversuche (kein P3) und dann 429 (Schwelle 6)',falsch.slice(0,6).every(x=>x===401)&&falsch[6]===429);
  // Eigener bezahlter Stripe-Webhook: Kauf-Mail wird nur vorgemerkt und erst nach COMMIT verschickt.
  const kauf=client('203.0.113.132');
  await kauf.api('POST','/api/anmelden',{email:kundeMail,passwort:anderesPasswort});
  const kurs=(await client('203.0.113.133').api('GET','/api/kurse')).d;
  // Kurs und Stripe-Kunde für Test-Webhook direkt in der Wegwerf-DB anlegen.
  const d=new DatabaseSync(datei);
  const uid=d.prepare('SELECT id FROM benutzer WHERE email=?').get(kundeMail).id;
  d.prepare("UPDATE benutzer SET stripe_kunde=? WHERE id=?").run('cus_pw_1',uid);
  const k=d.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES (?, '',10000,'huf','veroeffentlicht',?,?)").run('Testkurzus',new Date().toISOString(),new Date().toISOString()).lastInsertRowid;
  d.close();
  const event={id:'evt_pw_kauf_1',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_pw_kauf_1',mode:'payment',payment_status:'paid',metadata:{kurs_id:String(k),benutzer_id:String(uid)},customer:'cus_pw_1',currency:'huf',amount_total:10000,payment_intent:'pi_pw_1'}}};
  mailFehler=true;
  const wh=await fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'fake'},body:JSON.stringify(event)});
  pruefe('Webhook bleibt 200 trotz Mailanbieterfehler',wh.status===200);
  pruefe('Zugang trotz Mailfehler',eins('SELECT COUNT(*) AS n FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,Number(k)).n===1);
  await bis(()=>mails.filter(x=>x.subject.includes('vásárlás')).length===1);
  pruefe('Kaufmail nach Fehler offen',eins("SELECT status FROM mail_ausgang WHERE typ='kauf'").status==='offen');
  const wh2=await fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'fake'},body:JSON.stringify(event)});
  pruefe('Doppelwebhook 200, nur ein Ausgangseintrag',wh2.status===200&&eins("SELECT COUNT(*) AS n FROM mail_ausgang WHERE typ='kauf'").n===1);
  pruefe('Kaufmail ohne Kartendaten, mit Kurstitel',mails.some(x=>x.subject.includes('vásárlás')&&x.text.includes('Testkurzus')&&!x.text.includes('pi_pw_1')));
  // Nach fünf fehlgeschlagenen Zustellversuchen wird der Eintrag als Fehler erhalten.
  const { mailDienst, resendMailer } = await import(pathToFileURL(resolve('mail.mjs')).href);
  // A8-02 (12.11.2026): Seit dem Backoff wartet jeder Fehlversuch (1, 5, 15, 60 Minuten). Frueher war hier "5x sofort hintereinander -> fehler"
  // festgeschrieben; das war genau der Fehler. Jetzt: sofortiger Neuanstoss versucht NICHT erneut, die Uhr des Dienstes wird je Schritt vorgestellt.
  let retryUhr = Date.now();
  const retryDienst = mailDienst({ mailer: async () => false, base, jetzt: () => retryUhr });
  await bis(() => eins("SELECT versuche FROM mail_ausgang WHERE typ='kauf'").versuche >= 1);
  const vorSofort = eins("SELECT versuche FROM mail_ausgang WHERE typ='kauf'").versuche;
  await retryDienst.ausgangSenden();
  pruefe('Backoff: sofortiger Neuanstoss zaehlt keinen weiteren Versuch', eins("SELECT versuche FROM mail_ausgang WHERE typ='kauf'").versuche === vorSofort);
  for (let i=0;i<5;i++) { retryUhr += 5 * 3600 * 1000; await retryDienst.ausgangSenden(); }
  const retryStand=eins("SELECT status,versuche FROM mail_ausgang WHERE typ='kauf'");
  pruefe('Nach höchstens fünf Versuchen Status fehler',retryStand.status==='fehler'&&retryStand.versuche===5);

  const kaufMail = mails.find(x=>x.subject.includes('vásárlás'));
  pruefe('Kaufbestätigung besitzt stabilen Idempotency-Key',
    /^schulung-[a-f0-9]{16}-[1-9][0-9]*$/.test(kaufMail?.idempotencyKey || ''));
  let resendHeader=null, resendAdresse=null;
  const probeTransport=resendMailer({
    apiKey:randomBytes(32).toString('hex'), from:'VALORE Előadások <eloadasok@valorebusinessclub.com>',
    fetchFn:async(url,option)=>{resendHeader=option.headers;resendAdresse=url;return {ok:true,status:200};},
  });
  const transportOK=await probeTransport({to:kundeMail,subject:'Próba',html:'<p>Próba</p>',text:'Próba',
    idempotencyKey:'schulung-test-stabil'});
  pruefe('Resend POST trägt Idempotency-Key und Bearer-Header',transportOK===true &&
    resendAdresse==='https://api.resend.com/emails' &&
    resendHeader['Idempotency-Key']==='schulung-test-stabil' &&
    resendHeader.Authorization.startsWith('Bearer '));

  // SQL-Fehler beim Vormerken der Mail muss Bestellung, Zugang UND Event-ID zurückrollen.
  const dRoll=new DatabaseSync(datei);
  const kRoll=dRoll.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES (?, '',10000,'huf','veroeffentlicht',?,?)")
    .run('Rollback Testkurzus',new Date().toISOString(),new Date().toISOString()).lastInsertRowid;
  dRoll.exec("CREATE TRIGGER test_mail_rollback BEFORE INSERT ON mail_ausgang BEGIN SELECT RAISE(ABORT,'Mail-Ausgang-Testfehler'); END");
  dRoll.close();
  const rollEvent={id:'evt_pw_rollback',type:'checkout.session.completed',livemode:false,data:{object:{
    id:'cs_pw_rollback',mode:'payment',payment_status:'paid',
    metadata:{kurs_id:String(kRoll),benutzer_id:String(uid)},customer:'cus_pw_1',
    currency:'huf',amount_total:10000,payment_intent:'pi_pw_rollback'}}};
  const rollFail=await fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'fake'},body:JSON.stringify(rollEvent)});
  pruefe('SQL-Ausgangsfehler: Webhook 500',rollFail.status===500);
  pruefe('Rollback entfernt Bestellung, Zugang und Event-ID',
    eins("SELECT COUNT(*) AS n FROM bestellungen WHERE stripe_sitzung='cs_pw_rollback'").n===0 &&
    eins('SELECT COUNT(*) AS n FROM zugaenge WHERE benutzer_id=? AND kurs_id=?',uid,Number(kRoll)).n===0 &&
    eins("SELECT COUNT(*) AS n FROM stripe_ereignisse WHERE id='evt_pw_rollback'").n===0);
  const dDrop=new DatabaseSync(datei);dDrop.exec('DROP TRIGGER test_mail_rollback');dDrop.close();
  mailFehler=false;
  const rollRetry=await fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'fake'},body:JSON.stringify(rollEvent)});
  pruefe('Webhook kann nach Rollback erneut erfolgreich verarbeitet werden',rollRetry.status===200 &&
    eins("SELECT COUNT(*) AS n FROM mail_ausgang WHERE bestellung_id=(SELECT id FROM bestellungen WHERE stripe_sitzung='cs_pw_rollback')").n===1);

  // Erste erfolgreiche Abo-Rechnung erzeugt einmal eine Kaufmail, Folgeperioden nicht.
  mailFehler=false;
  const dAbo=new DatabaseSync(datei);
  const kAbo=dAbo.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert,abo_preis_cent,abo_intervall) VALUES (?, '',10000,'huf','veroeffentlicht',?,?,10000,'month')")
    .run('Abo Testkurzus',new Date().toISOString(),new Date().toISOString()).lastInsertRowid;
  dAbo.close();
  async function aboWebhook(typ,id,object) {
    const event={id,created:Math.floor(Date.now()/1000),type:typ,livemode:false,data:{object}};
    const r=await fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'fake'},body:JSON.stringify(event)});
    return r.status;
  }
  const aboMetadata={kurs_id:String(kAbo),benutzer_id:String(uid),modell:'abo'};
  const subscription='sub_passwort_mail_1';
  pruefe('Abo-Checkout registriert',
    await aboWebhook('checkout.session.completed','evt_pw_abo_checkout',
      {id:'cs_pw_abo',mode:'subscription',subscription,customer:'cus_pw_1',metadata:aboMetadata})===200);
  const end=Math.floor(Date.now()/1000)+30*86400;
  const inv=(id,bis)=>({id,subscription,customer:'cus_pw_1',amount_paid:10000,currency:'huf',payment_intent:'pi_'+id,
    lines:{data:[{period:{end:bis}}]}});
  pruefe('Erste Abo-Rechnung bestätigt',await aboWebhook('invoice.paid','evt_pw_abo_invoice_1',inv('in_pw_abo_1',end))===200);
  pruefe('Abo-Kaufmail vorgemerkt',eins("SELECT COUNT(*) AS n FROM mail_ausgang WHERE typ='abo'").n===1);
  await bis(()=>mails.some(x=>x.text.includes('Abo Testkurzus')));
  pruefe('Erste Abo-Kaufbestätigung wurde gesendet',mails.some(x=>x.text.includes('Abo Testkurzus')));
  pruefe('Folge-Abo-Rechnung bestätigt',
    await aboWebhook('invoice.paid','evt_pw_abo_invoice_2',inv('in_pw_abo_2',end+30*86400))===200);
  pruefe('Nur eine Abo-Kaufmail trotz Folgeperiode',eins("SELECT COUNT(*) AS n FROM mail_ausgang WHERE typ='abo'").n===1);

  const resetHeader = await kunde.api('POST','/api/passwort-zuruecksetzen',{token:token2,passwort:anderesPasswort});
  const aenderHeader = await kunde.api('POST','/api/passwort-aendern',{aktuell:falschesPasswort,neu:anderesPasswort});
  pruefe('Alle Passwort-APIs senden no-store',
    resetHeader.h.get('cache-control')==='no-store' && aenderHeader.h.get('cache-control')==='no-store');
  pruefe('Kein Reset-Token oder Klartextpasswort in den erfassten Serverlogs',
    [token,token2,adminToken,passwort,neuesPasswort,anderesPasswort,adminNeuesPasswort].every(x=>!x || !protokoll.join(' ').includes(x)));
  // Kein Resend konfiguriert: kein Absturz, neutrale API-Rückmeldung.
  const appOhneMail = erstelleServer({stripe,webhookSecret:'fake',base,trustProxy:1,mailer:null});
  const serverOhneMail = appOhneMail.listen(4422,'127.0.0.1');
  await new Promise((ja,nein)=>{if(serverOhneMail.listening)return ja();serverOhneMail.once('listening',ja);serverOhneMail.once('error',nein);});
  const ohneMail = await fetch('http://127.0.0.1:4422/api/passwort-vergessen',
    {method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'203.0.113.150'},
      body:JSON.stringify({email:kundeMail})});
  const ohneMailBody = await ohneMail.json();
  pruefe('Ohne Resend: Passwort-vergessen bleibt neutral und 200',
    ohneMail.status===200 && !('token' in ohneMailBody) && ohneMailBody.text===bekannt.d.text);
  await new Promise(done=>serverOhneMail.close(done));
} catch(e) {
  fehlerzahl++;console.error('FEHLER TESTABLAUF:',e.message);
} finally {
  console.warn=warnAlt;console.error=errorAlt;
  if(server)await new Promise(r=>server.close(r));
  try{rmSync(basis,{recursive:true,force:true});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
}
console.log('Passwort: '+ok+' bestanden, '+fehlerzahl+' fehlgeschlagen');
process.exitCode=fehlerzahl?1:0;
