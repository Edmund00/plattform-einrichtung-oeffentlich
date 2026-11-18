// Scheibe 31 – Offline-Selbsttest Kurspaket, Stripe-Attrappe, Wegwerf-Datenbank.
import './test-sprache.mjs';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const tmp=mkdtempSync(join(tmpdir(),'kurspaket-test-'));process.env.DB_DATEI=join(tmp,'db.sqlite');
const BASE='http://127.0.0.1:4521',PW=randomBytes(24).toString('hex');
let server,db,ok=0,failed=0;
const check=(n,yes)=>{yes?ok++:failed++;console.log((yes?'OK ':'FEHLER ')+n)};
function client(){let cookie='';return async(method,path,body,headers={})=>{
 const r=await fetch(BASE+path,{method,headers:{...(method==='POST'?{Origin:BASE}:{}),...headers,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];
 let data;try{data=await r.json()}catch{data={}};
 return {status:r.status,data,headers:r.headers};
}}
const src=p=>readFileSync(resolve(p),'utf8');
const baseP={format:'valore-kurspaket-v1',kurs:{titel:'Kapcsolatépítés',beschreibung:'Leírás',preis_forint:4900},
 lektionen:[{titel:'Első lecke',inhalt:'Szia\nÍgy kezdd.'},{titel:'Második lecke',inhalt:'Fontos'},{titel:'Harmadik lecke',inhalt:'Gyakorlat'}]};
const wrap=p=>({paket:JSON.stringify(p)});
try{
 ({db}=await import('../db.mjs'));
 const {passwortHashen}=await import('../auth.mjs');
 const {erstelleServer}=await import('../app.mjs');
 const ph=await passwortHashen(PW),date=new Date().toISOString();
 db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,'admin',?)").run('import-admin@example.invalid',ph,date);
 db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,'kunde',?)").run('import-customer@example.invalid',ph,date);
 server=erstelleServer({stripe:{webhooks:{constructEvent:()=>({})}},webhookSecret:'stub',base:BASE,abgleichAutomatik:false}).listen(4521,'127.0.0.1');
 await new Promise((yes,no)=>{if(server.listening)return yes();server.once('listening',yes);server.once('error',no)});
 const admin=client(),kunde=client(),gast=client(),agent=client();
 const login=await admin('POST','/api/anmelden',{email:'import-admin@example.invalid',passwort:PW});
 const adminCookie=login.headers.get('set-cookie')?.split(';')[0];
 await kunde('POST','/api/anmelden',{email:'import-customer@example.invalid',passwort:PW});
 const verify='/api/admin/kurspaket/pruefen',create='/api/admin/kurspaket/anlegen';
 const before=()=>db.prepare('SELECT COUNT(*) n FROM kurse').get().n;
 const initial=before(),lessonsBefore=db.prepare('SELECT COUNT(*) n FROM lektionen').get().n,
  auditInitial=db.prepare('SELECT COUNT(*) n FROM kurspaket_protokoll').get().n;
 const testPreview=await admin('POST',verify,wrap(baseP));
 check('Gueltiges Paket: nur Vorschau mit drei Lektionen und 4900 Ft',testPreview.status===200&&testPreview.data.anzahl_lektionen===3&&testPreview.data.preis_forint===4900&&before()===initial);
 check('Trockenlauf ändert weder Lektionen noch Protokoll',db.prepare('SELECT COUNT(*) n FROM lektionen').get().n===lessonsBefore&&db.prepare('SELECT COUNT(*) n FROM kurspaket_protokoll').get().n===auditInitial);
 check('Prüfantwort: no-store',testPreview.headers.get('cache-control')==='no-store');
 const made=await admin('POST',create,wrap(baseP)),id=made.data.kurs_id;
 check('Gueltiges Paket: genau ein Kurs als Entwurf',made.status===201&&before()===initial+1&&db.prepare('SELECT status FROM kurse WHERE id=?').get(id)?.status==='entwurf');
 check('Drei Textlektionen als Entwurf und richtige Reihenfolge',JSON.stringify(db.prepare('SELECT titel,status,art,reihenfolge FROM lektionen WHERE kurs_id=? ORDER BY reihenfolge').all(id).map(x=>[x.status,x.art,x.reihenfolge]))===JSON.stringify([['entwurf','text',1],['entwurf','text',2],['entwurf','text',3]]));
 check('Server speichert 4900 Forint als 490000 Cent',db.prepare('SELECT preis_cent FROM kurse WHERE id=?').get(id).preis_cent===490000);
 const dupBefore=before(),dup=await admin('POST',create,wrap(baseP));
 check('Gleiches Paket binnen 5 Minuten: kein zweiter Entwurf',dup.status===200&&dup.data.vorhanden&&dup.data.kurs_id===id&&before()===dupBefore);
 const fenced={paket:'```json\n'+JSON.stringify({...baseP,kurs:{...baseP.kurs,titel:'Másik tanfolyam'}})+'\n```'};
 const fence=await admin('POST',create,fenced);
 check('Markdown JSON-Zaun wird importiert',fence.status===201);
 const lang={...baseP,kurs:{...baseP.kurs,titel:'Hosszabb tanfolyam'},lektionen:[{titel:'Hosszú lecke',inhalt:'A'.repeat(12000)}]};
 const longBefore=before(),long=await admin('POST',create,wrap(lang));
 check('Groesser als 10 KB: eigener Parser akzeptiert gueltiges Paket',
  long.status===201&&before()===longBefore+1&&db.prepare('SELECT length(inhalt) AS n FROM lektionen WHERE kurs_id=?').get(long.data.kurs_id)?.n===12000);
 const forty={...baseP,kurs:{...baseP.kurs,titel:'Negyven lecke'},lektionen:Array.from({length:40},(_,i)=>({titel:'Lecke '+(i+1),inhalt:'Szöveg'}))};
 const fortyBefore=before(),fortyR=await admin('POST',create,wrap(forty));
 check('Genau 40 Lektionen erlaubt',fortyR.status===201&&before()===fortyBefore+1&&db.prepare('SELECT COUNT(*) n FROM lektionen WHERE kurs_id=?').get(fortyR.data.kurs_id)?.n===40);
 const changed={...baseP,kurs:{...baseP.kurs,preis_forint:0,abo_preis_forint:990,abo_intervall:'month'}};
 const warning=await admin('POST',verify,wrap(changed));
 check('Abo-Felder: Vorschau mit Warnung',warning.status===200&&warning.data.warnungen.includes('paket_abo_ignoriert'));
 const wCreate=await admin('POST',create,wrap(changed));
 check('Abo-Felder werden nicht gespeichert',wCreate.status===201&&db.prepare('SELECT abo_preis_cent FROM kurse WHERE id=?').get(wCreate.data.kurs_id)?.abo_preis_cent===null);
 const ohnePreis={...baseP,kurs:{titel:'Ingyenes piszkozat',beschreibung:'Előkészítés'}};
 const ohnePreisVor=before(),ohnePreisR=await admin('POST',create,wrap(ohnePreis));
 check('Fehlender Preis wird nur im neuen Entwurf als 0 Ft gespeichert',
  ohnePreisR.status===201&&before()===ohnePreisVor+1&&
  db.prepare('SELECT preis_cent FROM kurse WHERE id=?').get(ohnePreisR.data.kurs_id)?.preis_cent===0);
 const same={...baseP,kurs:{...baseP.kurs,titel:'Kapcsolatépítés',preis_forint:4901}};
 const titlePrev=await admin('POST',verify,wrap(same));
 check('Doppelter Titel: Vorschau mit Suffix',titlePrev.status===200&&/\(3\)$/.test(titlePrev.data.titel)&&titlePrev.data.umbenannt);
 const titleCreate=await admin('POST',create,wrap(same));
 check('Doppelter Titel: Original bleibt unverändert',titleCreate.status===201&&db.prepare('SELECT titel FROM kurse WHERE id=?').get(id).titel==='Kapcsolatépítés');
 const snapshotBefore=JSON.stringify(db.prepare("SELECT * FROM kurse WHERE id=?").get(id))+
   JSON.stringify(db.prepare("SELECT * FROM lektionen WHERE kurs_id=? ORDER BY id").all(id));
 const invalid=[
 ['Unbekanntes Feld',{...baseP,geheim:true},'geheim'],
 ['Fehlender Titel',{...baseP,kurs:{beschreibung:'X'}},'kurs.titel'],
 ['Titel 161 Zeichen',{...baseP,kurs:{titel:'X'.repeat(161)}},'kurs.titel'],
 ['Inhalt 20001 Zeichen',{...baseP,lektionen:[{titel:'Test',inhalt:'X'.repeat(20001)}]},'lektionen[0].inhalt'],
 ['41 Lektionen',{...baseP,lektionen:Array.from({length:41},()=>({titel:'Test'}))},'lektionen'],
 ['Steuerzeichen',{...baseP,kurs:{titel:'X'+String.fromCharCode(1)}},'kurs.titel'],
 ['HTML',{...baseP,lektionen:[{titel:'A',inhalt:'<script>hallo</script>'}]},'lektionen[0].inhalt'],
 ['Falsches Format',{...baseP,format:'andere'},'format'],
 ['Unbekanntes Lektionsfeld',{...baseP,lektionen:[{titel:'A',geheim:true}]},'lektionen[0].geheim'],
 ['Zu langer Beschreibung',{...baseP,kurs:{...baseP.kurs,beschreibung:'X'.repeat(5001)}},'kurs.beschreibung'],
 ['Negativer Preis',{...baseP,kurs:{...baseP.kurs,preis_forint:-1}},'kurs.preis_forint'],
 ['Abo-Intervall unbekannt',{...baseP,kurs:{...baseP.kurs,abo_intervall:'daily'}},'kurs.abo_intervall'],
 ];
 for(const [name,p,path] of invalid){
  const beforeCount=before(),r=await admin('POST',create,wrap(p));
  check(name+': 400 mit Pfad, keine Anlage',r.status===400&&r.data.fehler?.some(x=>x.pfad===path)&&before()===beforeCount);
 }
 check('Bestehender Kurs und seine Lektionen durch fehlerhafte Importe unveraendert',
   snapshotBefore===JSON.stringify(db.prepare("SELECT * FROM kurse WHERE id=?").get(id))+
    JSON.stringify(db.prepare("SELECT * FROM lektionen WHERE kurs_id=? ORDER BY id").all(id)));
 const brokenBefore=before(),broken=await admin('POST',create,{paket:'{'});
 check('Defektes JSON: 400 ohne Anlage',broken.status===400&&broken.data.fehler?.some(x=>x.pfad==='paket')&&before()===brokenBefore);
 const bigBefore=before(),big=await admin('POST',create,{paket:'A'.repeat(300*1024+1)});
 check('300KB Limit: 400 ohne Anlage',big.status===400&&before()===bigBefore);
 const aboveParser=before(),tooBig=await admin('POST',create,{paket:'A'.repeat(320*1024)});
 check('Eigenes JSON-Parser-Limit: 400 mit Pfad, ohne Anlage',tooBig.status===400&&tooBig.data.fehler?.[0]?.pfad==='paket'&&before()===aboveParser);
 check('Anonym: 401',(await gast('POST',create,wrap(baseP))).status===401);
 check('Kunde: 403',(await kunde('POST',create,wrap(baseP))).status===403);
 const auditBefore=db.prepare('SELECT COUNT(*) n FROM agent_protokoll').get().n;
 const forbidden=await agent('POST',create,wrap(baseP),{Authorization:'Bearer vat_'+randomBytes(32).toString('base64url')});
 check('Agent-Bearer: 403 mit Audit',forbidden.status===403&&db.prepare('SELECT COUNT(*) n FROM agent_protokoll').get().n===auditBefore+1);
 check('CSRF fremde Origin: 403',(await admin('POST',create,wrap(baseP),{Origin:'https://fremd.invalid'})).status===403);
 const noOrigin=await fetch(BASE+create,{method:'POST',headers:{Cookie:adminCookie,'Content-Type':'application/json'},body:JSON.stringify(wrap(baseP))});
 check('CSRF ohne Origin: 403',noOrigin.status===403);
 db.exec("CREATE TRIGGER IF NOT EXISTS kurspaket_test_rollback BEFORE INSERT ON lektionen WHEN NEW.titel='Rollback' BEGIN SELECT RAISE(ABORT,'rollback'); END");
 const rBefore=before(),rLessons=db.prepare('SELECT COUNT(*) n FROM lektionen').get().n;
 const rFail=await admin('POST',create,wrap({...baseP,kurs:{titel:'Rollback kurzus'},lektionen:[{titel:'Rollback',inhalt:'Próba'}]}));
 check('SQL-Fehler: komplette Importtransaktion rollt zurueck',rFail.status===500&&before()===rBefore&&db.prepare('SELECT COUNT(*) n FROM lektionen').get().n===rLessons);
 db.exec('DROP TRIGGER kurspaket_test_rollback');
 const exportR=await admin('GET','/api/admin/kurse/'+id+'/kurspaket');
 check('Export gültig, nur Kurs/Lektion/Preis',exportR.status===200&&exportR.data.format===baseP.format&&exportR.data.kurs.preis_forint===4900&&exportR.data.lektionen.length===3);
 check('Export-Antwort: no-store',exportR.headers.get('cache-control')==='no-store');
 check('Export ohne personenbezogene/Datei-/Bestelldaten',!/(benutzer|bestellungen|dateien|stripe|passwort)/.test(JSON.stringify(exportR.data)));
 const exportPreview=await admin('POST',verify,{paket:JSON.stringify(exportR.data)});
 check('Export als neuer Entwurf importierbar',exportPreview.status===200);
 const existingTitle='Külön eredeti tanfolyam';
 const oldId=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,'Eredeti leiras',800000,'huf','veroeffentlicht',?,?)").run(existingTitle,date,date).lastInsertRowid);
 db.prepare("INSERT INTO lektionen(kurs_id,titel,inhalt,art,reihenfolge,status,erstellt,geaendert) VALUES(?,'Regi lecke','Csak szoveg','text',1,'veroeffentlicht',?,?)").run(oldId,date,date);
 const original=JSON.stringify(db.prepare('SELECT * FROM kurse WHERE id=?').get(oldId))+
   JSON.stringify(db.prepare('SELECT * FROM lektionen WHERE kurs_id=?').all(oldId));
 // Abnahme 01.11.2026 (Pruefrunde Fund 8): Euro-Kurs darf nicht als Forint exportiert werden
 const eurId=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES('Euro Kurs','x',1999,'eur','veroeffentlicht',?,?)").run(date,date).lastInsertRowid);
 const eurExport=await admin('GET','/api/admin/kurse/'+eurId+'/kurspaket');
 check('Export eines Euro-Kurses: 409 paket_waehrung (nicht als Forint)',eurExport.status===409&&eurExport.data?.fehler==='paket_waehrung');
 const oldExport=await admin('GET','/api/admin/kurse/'+oldId+'/kurspaket');
 const newFromOld=await admin('POST',create,{paket:JSON.stringify(oldExport.data)});
 check('Bestehenden veroeffentlichten Kurs als NEUEN Entwurf reimportieren',
   oldExport.status===200&&newFromOld.status===201&&newFromOld.data.kurs_id!==oldId&&
   db.prepare('SELECT status FROM kurse WHERE id=?').get(newFromOld.data.kurs_id)?.status==='entwurf');
 check('Export/Reimport aendert bestehenden Kurs und Lektion nicht',
   original===JSON.stringify(db.prepare('SELECT * FROM kurse WHERE id=?').get(oldId))+
   JSON.stringify(db.prepare('SELECT * FROM lektionen WHERE kurs_id=?').all(oldId)));
 const hash=createHash('sha256').update(JSON.stringify({format:baseP.format,kurs:baseP.kurs,lektionen:baseP.lektionen.map((x,i)=>({...x,reihenfolge:i+1}))})).digest('hex');
 const audits=db.prepare("SELECT * FROM kurspaket_protokoll WHERE kurs_id=?").all(id);
 check('Protokoll nur Hash, kein Paketinhalt',audits.length===1&&audits[0].paket_hash===hash&&!JSON.stringify(audits).includes('Első lecke'));
 let update=false,del=false;
 try{db.prepare("UPDATE kurspaket_protokoll SET titel=titel WHERE id=?").run(audits[0].id)}catch{update=true}
 try{db.prepare("DELETE FROM kurspaket_protokoll WHERE id=?").run(audits[0].id)}catch{del=true}
 check('Append-only Trigger mit vorhandener Zeile',update&&del);
 const free=db.prepare("SELECT COUNT(*) n FROM kurse WHERE status IN ('entwurf','freigabe_offen')").get().n;
 for(let i=free;i<50;i++)db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,'',0,'huf','entwurf',?,?)").run('Limit '+i,date,date);
 const limitBefore=before(),limit=await admin('POST',create,wrap({...baseP,kurs:{titel:'Limitkurs'}}));
 check('50 Entwürfe: neuer Import 409 ohne Anlage',limit.status===409&&before()===limitBefore);
 const adminJs=src('public/admin/admin.js'),preisJs=src('public/preis.js');
 const exports=[...adminJs.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/preis\.js['"]/g)];
 check('Browser-Import trifft vorhandene export-Funktionen',exports.length===1&&exports[0][1].split(',').every(x=>preisJs.includes('export function '+x.trim())||preisJs.includes('export const '+x.trim())));
 check('Admin-Import ohne HTML-Strings und Inline-Styles',!adminJs.includes('.innerHTML=')&&!adminJs.includes("setAttribute('style'")&&!/\.style\.(?!setProperty\()/.test(adminJs));   // A6: nur die CSSOM-Methode style.setProperty(...) ist erlaubt (CSP-konform, Browser-Gegenprobe: keine Verletzung); direkte .style.-Zuweisungen bleiben verboten
 // Abnahme 01.11.2026: replaceChildren(null) schreibt den Text "null" in die Seite (Vorschau zeigte "nullnull").
 const importTeil=adminJs.slice(adminJs.indexOf('async function kurspaketImport'),adminJs.indexOf('async function kurspaketExport'));
 check('Admin-Import: replaceChildren bekommt keine null-Werte',importTeil.length>100&&!/replaceChildren\([^;]*\?[^;]*:\s*null/.test(importTeil));
 // Pruefrunde 3 (Agent G, 01.11.2026): Frontend-Fehler, die vorher kein Test sah
 {
  const kundeJs=src('public/kunde.js');
  const m=/(\/\[[^\n]*?\]\/)\.test\(text\)\)return meldung\(t\('verkauf_grund_fehler'\)/.exec(adminJs);
  const re=m?new RegExp(m[1].slice(1,-1)):null;   // der Regex-Quelltext aus der Datei, ohne die Schraegstriche
  check('Not-Aus-Grund im Browser: Grossbuchstaben und Ziffern ("Karbantartas 2") werden NICHT abgelehnt, Steuerzeichen schon',!!re&&!re.test('Karbantartas 2')&&!re.test('Hiba: Stripe')&&re.test('a\u0001b'));
  check('Admin: Kursformular sperrt den Speichern-Knopf erst nach allen Pruefungen',adminJs.includes("knopf.disabled = true;   // erst NACH allen Pruefungen")&&adminJs.indexOf("knopf.disabled = true;   // erst NACH")>adminJs.indexOf("aboCent === null) return meldung(aboFehler")&&adminJs.indexOf("aboCent === null) return meldung(aboFehler")>0);
  check('Admin: Preisaenderung des Agenten wird als Forint-Betrag gezeigt, nicht als Cent',adminJs.includes("['preis_cent','abo_preis_cent'].includes(x.feld)"));
  check('Kunde: Lektionsvideo hat playsinline (iPhone)',kundeJs.includes("controls:true, playsinline:true, controlsList"));
  check('Kunde: Kaufknopf gegen Doppelklick gesperrt',kundeJs.includes('bezahlenLaeuft')&&kundeJs.includes('finally { bezahlenLaeuft = false; }'));
  check('Kunde: Fehler bei "Passwort vergessen" erscheinen nicht als gruene Erfolgsmeldung',/passwort_neutral'\), \(r\.status === 0/.test(kundeJs));
  const serverJs=src('server.mjs');
  check('Server: Handler gegen unbehandelte Fehler und sauberes Beenden bei SIGTERM vorhanden',serverJs.includes("process.on('unhandledRejection'")&&serverJs.includes("process.on('uncaughtException'")&&serverJs.includes("process.on('SIGTERM'"));
  check('Vorschau-Auslieferung gibt die Datei frei, wenn der Client abbricht',src('vorschau.mjs').includes("res.once('close',()=>teil.destroy())")&&src('vorschau.mjs').includes("res.once('close',()=>ganz.destroy())"));
  const kundeCss=src('public/kunde.css');
  check('Kunde (iPhone-Foto 01.11.2026): Zustimmungs-Haekchen hat feste Groesse und der Text bekommt den Rest (sonst riesiges Haekchen und schmale Textspalte)',kundeCss.includes('input[type=checkbox],input[type=radio]{width:24px;height:24px;min-height:0')&&kundeCss.includes('label.ellallas-zustimmung:has(input[type=checkbox])')&&kundeCss.includes('.ellallas-zustimmung span{flex:1 1 auto;min-width:0'));
  // Pruefrunde 4 (Agent J, Sprache): Rohwerte aus der Datenbank duerfen nicht als deutsche Woerter im Admin erscheinen
  {
    const HUx = JSON.parse(src('texte/hu.json'));
    const fehlend = [];
    for (const v of ['manuell', 'auto', 'vordeploy', 'ok', 'fehler', 'aus']) if (!HUx['sicherung_wert_' + v]) fehlend.push('sicherung_wert_' + v);
    for (const v of ['test', 'live', 'ok', 'abweichung', 'fehler']) if (!HUx['abgleich_wert_' + v]) fehlend.push('abgleich_wert_' + v);
    for (const v of ['titel', 'beschreibung', 'preis_cent', 'abo_preis_cent', 'abo_intervall', 'status']) if (!HUx['agent_feld_' + v]) fehlend.push('agent_feld_' + v);
    for (const v of ['month', 'year']) if (!HUx['agent_wert_' + v]) fehlend.push('agent_wert_' + v);
    check('Sprache: fuer alle Rohwerte (Sicherung, Abgleich, Agent-Antrag) gibt es ungarische Texte in hu.json', fehlend.length === 0, fehlend.join(','));
    check('Sprache: Admin uebersetzt Sicherungs-, Abgleich- und Agent-Rohwerte ueber wert()', adminJs.includes("wert('sicherung_wert_',x.art)") && adminJs.includes("wert('abgleich_wert_',x.modus)") && adminJs.includes("wert('agent_feld_',x.feld)"));
    check('Sprache: kein deutsches Wort Kursbemutato, kein Siezen im Admin-Rechtehinweis, Kurspaket-Pfad nie roh', !/Kursbemutat/.test(JSON.stringify(HUx)) && HUx.a_nincs_jog === 'Nincs jogosultságod.' && adminJs.includes("  return '';") );
  }
  check('Rueckmeldungen scrollen ins Bild (Admin und Kunde)',adminJs.includes('meldungsfeld.scrollIntoView')&&kundeJs.includes('meldungsfeld.scrollIntoView'));
 }
 const HU=JSON.parse(src('texte/hu.json'));
 const routeJs=src('routes-kurspaket.mjs'),keyNames=Object.keys(HU).filter(x=>x.startsWith('paket_')||x==='feld_unbekannt');
 check('Alle '+keyNames.length+' Kurspaket-HU-Texte sind vorhanden und im Code referenziert',
  keyNames.length>=30&&keyNames.every(x=>typeof HU[x]==='string'&&(adminJs.includes("'"+x+"'")||routeJs.includes("'"+x+"'"))));
 // ADMIN_ERLAUBT: ein bestätigter Admin bleibt autorisiert, ein anderer erhält 403.
 db.prepare("UPDATE benutzer SET email_bestaetigt=? WHERE email='import-admin@example.invalid'").run(Date.now());
 db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,'admin',?,?)")
  .run('import-gesperrt@example.invalid',ph,date,Date.now());
 const gesperrt=client();await gesperrt('POST','/api/anmelden',{email:'import-gesperrt@example.invalid',passwort:PW});
 const {adminListeInitialisieren}=await import('../admin-zugang.mjs');
 const aktiv=adminListeInitialisieren(['import-admin@example.invalid']);
 check('Aktive Admin-Erlaubnisliste: nur erlaubter Admin darf prüfen',
  aktiv&&(await admin('POST',verify,wrap(baseP))).status===200&&
  (await gesperrt('POST',verify,wrap(baseP))).status===403);
 adminListeInitialisieren([]);
 const boot=()=>spawnSync(process.execPath,['--input-type=module','--disable-warning=ExperimentalWarning','-e',"await import('./db.mjs')"],{cwd:process.cwd(),env:{...process.env},encoding:'utf8'});
 check('DB-Schema startet zweimal',boot().status===0&&boot().status===0);
 // Eine DB aus Scheibe 30 hat die neue Tabelle noch nicht: Schema neu ergänzen, dann erneut starten.
 db.exec('DROP TABLE IF EXISTS kurspaket_protokoll');
 check('Vorherige DB-Version startet zweimal und ergaenzt neue Tabelle',
   boot().status===0&&boot().status===0&&
   !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kurspaket_protokoll'").get());
}catch(e){failed++;console.error('FEHLER Testabbruch',e?.name,e?.message);}
finally{if(server)await new Promise(done=>server.close(done));try{rmSync(tmp,{force:true,recursive:true,maxRetries:8,retryDelay:250})}catch(e){console.warn('Testordner besetzt')}console.log('Kurspaket: '+ok+' bestanden, '+failed+' fehlgeschlagen');process.exitCode=failed?1:0;}
