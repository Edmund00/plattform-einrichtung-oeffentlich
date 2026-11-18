// K1a: nur vom Chef ausführen. Startet isolierte echte Apps mit temporärer DB.
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const dir = mkdtempSync(join(tmpdir(),'k1-katalog-'));
process.env.DB_DATEI = join(dir,'test.db');
const server = [];
let db;
const PASS = 'Katalog-Testpasswort-123';
const check = (name, bed) => { assert.ok(bed,name); console.log('OK '+name); };
const child = (code, datei) => spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,DB_DATEI:datei},encoding:'utf8',timeout:20000});
try {
  // Restaurierte alte Sicherung: echte verschlüsselte Datei ohne neue Tabelle/Spalte.
  const alt = join(dir,'alt.db');
  check('aktuelle DB initialisiert',child("await import('./db.mjs')",alt).status===0);
  const altDb = new DatabaseSync(alt);
  altDb.exec("INSERT INTO kurse(titel,preis_cent,erstellt,geaendert) VALUES('Altbestand',0,'alt','alt')");
  const bestand = altDb.prepare('SELECT * FROM kurse').all().map(({kategorie_id,...k})=>k);
  // Node 24/node:sqlite: DROP COLUMN wird hier direkt geprüft; ein Fehler bricht den Test ab.
  altDb.exec('DROP INDEX kurse_katalog; ALTER TABLE kurse DROP COLUMN kategorie_id; DROP TABLE kategorien');
  altDb.close();
  const alteBytes = readFileSync(alt);
  function migriert(datei) {
    for(let i=0;i<2;i++) {
      check('Migration wiederholbar '+datei+' '+i,child("await import('./db.mjs')",datei).status===0);
      const probe = new DatabaseSync(datei);
      check('Kategorientabelle vorhanden',!!probe.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kategorien'").get());
      check('Kategoriespalte vorhanden',probe.prepare('PRAGMA table_info(kurse)').all().some(c=>c.name==='kategorie_id'));
      check('Katalogindex vorhanden',!!probe.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='kurse_katalog'").get());
      const rows=probe.prepare('SELECT * FROM kurse').all();
      assert.deepEqual(rows.map(({kategorie_id,...k})=>k),bestand);
      check('Altbestand Kategorie NULL',rows.every(k=>k.kategorie_id===null));
      probe.close();
    }
  }
  migriert(alt);
  const { verschluesseln, pruefeDatenbank } = await import('../sicherung-format.mjs');
  const key = randomBytes(32), backup = join(dir,'alt.vsic'), restore = join(dir,'restore.db');
  writeFileSync(backup,verschluesseln(alteBytes,key));
  const r = spawnSync(process.execPath,['tools/sicherung-entschluesseln.mjs',backup,restore],{env:{...process.env,SICHERUNG_SCHLUESSEL:key.toString('base64')},encoding:'utf8',timeout:20000});
  check('Restore alter Sicherung ohne Kategorien',r.status===0);
  check('alte Sicherung prüfbar',pruefeDatenbank(restore).kategorien===0);
  migriert(restore);
  ({db} = await import('../db.mjs'));
  const { passwortHashen } = await import('../auth.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const hash = await passwortHashen(PASS), zeit = new Date().toISOString();
  for(const rolle of ['admin','kunde']) db.prepare('INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)').run(rolle+'@example.com',hash,rolle,zeit);
  async function start(extra={}) {
    const app = erstelleServer({stripe:{},webhookSecret:'test',base:'http://localhost',nodeEnv:'test',dateiOrdner:dir,dbDatei:process.env.DB_DATEI,abgleichAutomatik:false,ellallasWiederaufnahme:false,...extra});
    const s = app.listen(0,'127.0.0.1'); server.push(s); await once(s,'listening');
    return 'http://127.0.0.1:'+s.address().port;
  }
  const base = await start();
  function client(url=base) {
    let cookie='';
    return async (path,method='GET',body,headers={}) => {
      const r = await fetch(url+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)});
      if(r.headers.get('set-cookie')) cookie=r.headers.get('set-cookie').split(';')[0];
      const text=await r.text(); let d; try { d=JSON.parse(text); } catch { d=text; }
      return {s:r.status,d,bytes:Buffer.byteLength(text)};
    };
  }
  const admin=client(), kunde=client(), gast=client();
  for(const [c,rolle] of [[admin,'admin'],[kunde,'kunde']]) check('Login '+rolle,(await c('/api/anmelden','POST',{email:rolle+'@example.com',passwort:PASS})).s===200);
  check('Kategorie-Schreiben verlangt Step-up',(await admin('/api/admin/kategorien','POST',{name_de:'A',name_en:'A',name_hu:'A'})).d.fehler==='stepup_noetig');
  await admin('/api/admin/stepup','POST',{passwort:PASS});
  const namen={name_de:' Küche ',name_en:'Kitchen',name_hu:'Konyha'};
  for(const [c,status] of [[gast,401],[kunde,403]]) for(const [path,method,body] of [['/api/admin/kategorien','GET'],['/api/admin/kategorien','POST',namen],['/api/admin/kategorien/1','PUT',namen],['/api/admin/kategorien/1','DELETE']]) check('Kategorie-Rechte '+method+' '+status,(await c(path,method,body)).s===status);
  check('Kategorie-Origin-Schutz',(await admin('/api/admin/kategorien','POST',namen,{Origin:'http://fremd.example'})).s===403);
  const k=(await admin('/api/admin/kategorien','POST',namen)).d;
  check('Kategorie NFC/Trim',k.name_de==='Küche');
  check('PUT Kategorie',(await admin('/api/admin/kategorien/'+k.id,'PUT',{...namen,reihenfolge:-1})).s===200);
  for(const [body,code] of [[{...namen,x:1},'unbekanntes_feld'],[{...namen,name_de:''},'kategorie_name_ungueltig'],[{...namen,name_en:'a'.repeat(81)},'kategorie_name_ungueltig'],[{...namen,name_hu:'a\u202eb'},'kategorie_name_ungueltig'],[{...namen,name_de:'a\nb'},'kategorie_name_ungueltig'],[{...namen,reihenfolge:1.2},'reihenfolge_ungueltig']]) {
    const r=await admin('/api/admin/kategorien','POST',body);
    check('Kategorie-Validierung '+code,r.s===400&&r.d.fehler===code);
  }
  for(const method of ['PUT','DELETE']) check('fehlende Kategorie '+method,(await admin('/api/admin/kategorien/999999',method,method==='PUT'?namen:undefined)).s===404);
  const leer=(await admin('/api/admin/kategorien','POST',{...namen,name_de:'Leer'})).d;
  const ins=db.prepare('INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,kategorie_id,erstellt,geaendert) VALUES(?,?,?,\'eur\',?,?,?,?)');
  for(let i=0;i<25;i++) ins.run(i<2?'Gleich':'Kurs '+i,i===2?'Őröm Äpfel % _':'Text',i%2?100:0,'veroeffentlicht',i<10?k.id:null,zeit,zeit);
  for(const status of ['entwurf','archiviert','freigabe_offen']) ins.run('Versteckt','Őröm',0,status,k.id,zeit,zeit);
  check('ohne Parameter Array',(await gast('/api/kurse')).d.length===25);
  check('lang allein bleibt Array',Array.isArray((await gast('/api/kurse?lang=en')).d));
  for(const [seite,n] of [[1,12],[3,1],[4,0]]) { const r=await gast('/api/kurse?seite='+seite); check('Seite '+seite,r.d.kurse.length===n&&r.d.gesamt===25&&r.d.seiten===3); }
  for(const preis of ['gratis','bezahlt']) { const r=await gast('/api/kurse?preis='+preis);check('Preisfilter '+preis,r.d.kurse.every(k=>preis==='gratis'?k.preis_cent===0:k.preis_cent>0)); }
  check('Kategorie-Filter',(await gast('/api/kurse?kategorie='+k.id)).d.gesamt===10);
  for(const q of ['őRÖM','äPFEL','%','_']) check('Suche literal '+q,(await gast('/api/kurse?q='+encodeURIComponent(q))).d.gesamt===1);
  for(const sort of ['neu','preis_auf','preis_ab']) {
    const rows=(await gast('/api/kurse?sort='+sort)).d.kurse;
    check('Sortierung '+sort,rows.every((k,i)=>!i||(sort==='neu'?rows[i-1].id>k.id:sort==='preis_auf'?rows[i-1].preis_cent<=k.preis_cent:rows[i-1].preis_cent>=k.preis_cent)));
  }
  check('Suche Titel',(await gast('/api/kurse?q=gleich')).d.gesamt===2);
  const gleich=(await gast('/api/kurse?q=gleich&sort=name')).d.kurse;
  check('gleiche Titel stabil',gleich.length===2&&gleich[0].id<gleich[1].id);
  for(const query of ['sort=x','seite=0','seite=10001','pro_seite=13','q='+('x'.repeat(101)),'q=a&q=b','kategorie=999999','preis=x','lang=de&lang=en']) { const r=await gast('/api/kurse?'+query);check('ungültiger Parameter '+query.slice(0,30),r.s===400&&typeof r.d.text==='string'&&r.d.text!==r.d.fehler); }
  // F-295 (18.11.2026): unbekannte Parameter (Cache-Breaker wie ?_=..., Tracking wie ?utm_source=...) werden ignoriert statt mit 400 abgelehnt.
  for(const query of ['unbekannt=1','_=123456','utm_source=newsletter&utm_medium=email','q=test&utm_source=x']) { const r=await gast('/api/kurse?'+query);check('unbekannter Parameter ignoriert '+query.slice(0,30),r.s===200); }
  const leerKatalog=await gast('/api/kurse?q='+('x'.repeat(100))+'&seite=3');
  check('100 Zeichen und leerer Katalog',leerKatalog.s===200&&leerKatalog.d.gesamt===0&&leerKatalog.d.seiten===0&&leerKatalog.d.seite===1&&leerKatalog.d.kurse.length===0);
  check('Admin ohne Parameter Array',Array.isArray((await admin('/api/admin/kurse')).d));
  check('Admin Statusfilter',(await admin('/api/admin/kurse?status=archiviert')).d.gesamt===1);
  check('Admin Entwurf',(await admin('/api/admin/kurse?status=entwurf')).d.gesamt===1);
  const offen=(await admin('/api/admin/kurse?status=freigabe_offen')).d;
  check('Admin Freigabe offen',offen.gesamt===1&&offen.kurse.length===1&&offen.kurse.every(k=>k.status==='freigabe_offen'));
  const adminListe=(await admin('/api/admin/kurse?q=kurs&kategorie='+k.id+'&preis=bezahlt&sort=preis_ab&seite=1')).d;
  assert.deepEqual(adminListe.kurse.map(k=>k.id),db.prepare("SELECT id FROM kurse WHERE titel LIKE 'Kurs %' AND kategorie_id=? AND preis_cent>0 ORDER BY preis_cent DESC,id LIMIT 12").all(k.id).map(k=>k.id));
  check('Admin kombinierte Filter',adminListe.gesamt===4&&adminListe.seite===1);
  const adminSeite=(await admin('/api/admin/kurse?status=alle&seite=2')).d;
  assert.deepEqual(adminSeite.kurse.map(k=>k.id),db.prepare('SELECT id FROM kurse ORDER BY id DESC LIMIT 12 OFFSET 12').all().map(k=>k.id));
  check('Admin Gesamt',(await admin('/api/admin/kurse?status=alle')).d.gesamt===28);
  for(const [l,name] of [['de','Küche'],['en','Kitchen'],['hu','Konyha']]) { const r=await gast('/api/kategorien?lang='+l); check('öffentliche Kategorien '+l,r.d.length===1&&r.d[0].name===name&&r.d[0].anzahl===10); }
  const katZahlen=(await admin('/api/admin/kategorien')).d;
  check('Admin Kategorie zählt alle Status',katZahlen.some(c=>c.id===k.id&&c.anzahl===10&&c.anzahl_gesamt===13));
  check('Leere Kategorie Gesamtzahl',katZahlen.some(c=>c.id===leer.id&&c.anzahl_gesamt===0));
  check('Öffentliche Kategorien ohne Gesamtzahl',(await gast('/api/kategorien')).d.every(c=>!Object.hasOwn(c,'anzahl_gesamt')));
  check('Admin sieht leere Kategorie',(await admin('/api/admin/kategorien')).d.some(c=>c.id===leer.id&&c.anzahl===0));
  const neu=await admin('/api/admin/kurse','POST',{titel:'Zuordnung',preis_cent:0,waehrung:'eur',kategorie_id:k.id});
  check('Kurs POST Kategorie',neu.s===201&&neu.d.kategorie_id===k.id);
  check('Kurs PATCH Kategorie',(await admin('/api/admin/kurse/'+neu.d.id,'PATCH',{kategorie_id:null})).d.kategorie_id===null);
  check('ungültige Kategorie',(await admin('/api/admin/kurse/'+neu.d.id,'PATCH',{kategorie_id:999999})).s===400);
  const frei=db.prepare("SELECT id FROM kurse WHERE preis_cent=0 AND status='veroeffentlicht' ORDER BY id").get().id;
  check('Kaufen fremdes Feld bleibt 400',(await kunde('/api/kurse/'+frei+'/kaufen','POST',{gratis:true})).s===400);
  check('Gratis ohne Mailpflicht',(await kunde('/api/kurse/'+frei+'/kaufen','POST',{})).d.code==='kostenloser_kurs');
  const mitMail=client(await start({mailer:async()=>true}));
  await mitMail('/api/anmelden','POST',{email:'kunde@example.com',passwort:PASS});
  const frei2=db.prepare("SELECT id FROM kurse WHERE preis_cent=0 AND status='veroeffentlicht' AND id<>? ORDER BY id").get(frei).id;
  check('Gratis mit Mailpflicht unbestätigt',(await mitMail('/api/kurse/'+frei2+'/kaufen','POST',{})).d.fehler==='email_unbestaetigt');
  db.prepare("UPDATE benutzer SET email_bestaetigt=? WHERE rolle='kunde'").run(zeit);
  check('Gratis mit bestätigter E-Mail',(await mitMail('/api/kurse/'+frei2+'/kaufen','POST',{})).d.code==='kostenloser_kurs');
  const vorher=db.prepare('SELECT COUNT(*) n FROM kurse').get().n;
  db.exec('PRAGMA foreign_keys=OFF');
  check('Foreign Keys aus',db.prepare('PRAGMA foreign_keys').get().foreign_keys===0);
  check('Kategorie löschen',(await admin('/api/admin/kategorien/'+k.id,'DELETE')).s===200);
  check('Kurse erhalten und Zuordnung NULL',db.prepare('SELECT COUNT(*) n FROM kurse').get().n===vorher&&db.prepare('SELECT COUNT(*) n FROM kurse WHERE kategorie_id IS NOT NULL').get().n===0);
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('BEGIN');for(let i=25;i<1000;i++) ins.run('Last '+i,'Beschreibung',100,'veroeffentlicht',null,zeit,zeit);db.exec('COMMIT');
  await gast('/api/kurse?pro_seite=12');
  const t=performance.now(), last=await gast('/api/kurse?pro_seite=12'), ms=performance.now()-t;
  check('1000 Kurse: 12 Ergebnisse, <20 KB, <500 ms',last.d.gesamt===1000&&last.d.kurse.length===12&&last.bytes<20000&&ms<=500);
  if(ms>=100) console.warn('WARNUNG: Schnellpfad benötigt '+ms.toFixed(1)+' ms (Ziel <100 ms)');
  const { KURSE } = await import('../demo-daten.mjs');
  const { demoUebersetzungAn, kursUebersetzt } = await import('../demo-uebersetzung.mjs');
  const { mitSprache } = await import('../texte.mjs');
  const seed=KURSE[0];
  const demoId=Number(ins.run(seed.titel,seed.beschreibung,0,'veroeffentlicht',null,zeit,zeit).lastInsertRowid);
  db.prepare('UPDATE kurse SET nutzen=? WHERE id=?').run(seed.nutzen,demoId);
  demoUebersetzungAn(true);
  try {
    for(const lang of ['en','hu']) {
      const anzeige=mitSprache(lang,()=>kursUebersetzt({id:demoId,titel:seed.titel,beschreibung:seed.beschreibung,nutzen:seed.nutzen}));
      check('Demo-Titel übersetzt '+lang,anzeige.titel!==seed.titel);
      const treffer=await gast('/api/kurse?lang='+lang+'&q='+encodeURIComponent(anzeige.titel));
      check('Demo-Suche nach angezeigtem Titel '+lang,treffer.d.kurse.some(k=>k.id===demoId));
      const beschreibung=await gast('/api/kurse?lang='+lang+'&q='+encodeURIComponent(anzeige.beschreibung.slice(0,80)));
      check('Demo-Suche nach angezeigter Beschreibung '+lang,beschreibung.d.kurse.some(k=>k.id===demoId));
    }
  } finally { demoUebersetzungAn(false); }
  const sortIds=[];
  for(const titel of ['Zebra','Ábel','Ábel','Äpfel']) sortIds.push(Number(ins.run(titel,'Namensprobe',0,'veroeffentlicht',null,zeit,zeit).lastInsertRowid));
  const namenSort=(await gast('/api/kurse?lang=hu&q=Namensprobe&sort=name')).d.kurse;
  assert.deepEqual(namenSort.map(k=>k.id),[sortIds[1],sortIds[2],sortIds[3],sortIds[0]]);
  check('Name hu: Akzente und ID-Gleichstand',namenSort[0].titel==='Ábel'&&namenSort.at(-1).titel==='Zebra');
  // K2a: eigene Kategorie, Preis-/Titelgleichstände und alle realen Kursstatus.
  const skalierung=(await admin('/api/admin/kategorien','POST',{name_de:'Skalierung',name_en:'Scale',name_hu:'Skála'})).d;
  assert.ok(skalierung.id);
  db.exec('BEGIN');
  for(let i=0;i<1000;i++) ins.run('Gleich '+(i%7),'Skalierungsprobe',i%4*100,
    ['veroeffentlicht','entwurf','archiviert','freigabe_offen'][i%4],i%3?skalierung.id:null,zeit,zeit);
  db.exec('COMMIT');
  for(const [c,pfad,istAdmin] of [[gast,'/api/kurse',false],[admin,'/api/admin/kurse',true]]) {
    const array=(await c(pfad)).d;
    check('Array-Kompatibilität K2a '+pfad,Array.isArray(array));
    assert.deepEqual(array.map(k=>k.id),db.prepare(`SELECT id FROM kurse ${istAdmin?'':"WHERE status='veroeffentlicht'"} ORDER BY id ${istAdmin?'DESC':'ASC'}`).all().map(k=>k.id));
    for(const kategorie of ['',String(skalierung.id),String(leer.id)])
      for(const preis of ['alle','gratis','bezahlt'])
        for(const sort of ['neu','preis_auf','preis_ab'])
          for(const status of istAdmin?['alle','veroeffentlicht','entwurf','archiviert','freigabe_offen']:['alle']) {
            const referenz=array.filter(k=>(!kategorie||k.kategorie_id===Number(kategorie))&&
              (preis==='alle'||(preis==='gratis'?k.preis_cent===0:k.preis_cent>0))&&
              (status==='alle'||k.status===status)).sort((a,b)=>sort==='neu'?b.id-a.id:
                (sort==='preis_auf'?a.preis_cent-b.preis_cent:b.preis_cent-a.preis_cent)||a.id-b.id);
            for(const seite of [1,2,Math.max(1,Math.ceil(referenz.length/12)),10000]) {
              const query=new URLSearchParams({preis,sort,seite:String(seite),pro_seite:'12'});
              if(kategorie) query.set('kategorie',kategorie);
              if(istAdmin) query.set('status',status);
              const r=await c(pfad+'?'+query);
              assert.equal(r.s,200);
              const erwartetSeite=referenz.length?seite:1;
              assert.deepEqual(r.d,{kurse:referenz.slice((erwartetSeite-1)*12,erwartetSeite*12),
                gesamt:referenz.length,seite:erwartetSeite,pro_seite:12,seiten:Math.ceil(referenz.length/12)},pfad+'?'+query);
            }
          }
    check('SQL-Seiten entsprechen JS-Referenz '+pfad,true);
  }
  // Keine INDEXED-BY-Vorgabe: tatsächliche SQLite-Planwahl dokumentieren.
  for(const [name,sql,args] of [
    ['öffentlich Standard',"SELECT id FROM kurse WHERE status=? ORDER BY id DESC LIMIT 12",['veroeffentlicht']],
    ['öffentlich Kategorie',"SELECT id FROM kurse WHERE status=? AND kategorie_id=? ORDER BY id DESC LIMIT 12",['veroeffentlicht',skalierung.id]],
    ['Admin Standard','SELECT id FROM kurse ORDER BY id DESC LIMIT 12',[]],
    ['Preis',"SELECT id FROM kurse WHERE status=? ORDER BY preis_cent ASC,id ASC LIMIT 12",['veroeffentlicht']]
  ]) {
    const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(r=>r.detail).join('; ');
    console.log('K2a EXPLAIN '+name+': '+plan);
    if(/TEMP B-TREE/.test(plan)) console.warn('WARNUNG: SQLite sortiert '+name+' temporär; Index (status,kategorie_id,id) deckt nicht jede Sortierung ab');
    if(name==='Admin Standard') check('Admin Standard ohne temporäre Sortierung',!/TEMP B-TREE/.test(plan));
    if(name==='öffentlich Kategorie') check('Kategorie nutzt Katalogindex ohne temporäre Sortierung',/kurse_katalog/.test(plan)&&!/TEMP B-TREE/.test(plan));
  }
  // Exakt 6000 gefilterte Kandidaten, unabhängig vom vorherigen Testbestand.
  db.prepare('UPDATE kurse SET status=? WHERE kategorie_id=?').run('veroeffentlicht',skalierung.id);
  const vorhandenSkalierung=db.prepare('SELECT COUNT(*) n FROM kurse WHERE kategorie_id=?').get(skalierung.id).n;
  db.exec('BEGIN');
  for(let i=vorhandenSkalierung;i<6000;i++) ins.run('Gleich','Skalierungsprobe',100,'veroeffentlicht',skalierung.id,zeit,zeit);
  db.exec('COMMIT');
  for(const [c,pfad,richtung] of [[gast,'/api/kurse','ASC'],[admin,'/api/admin/kurse','DESC']]) {
    const kandidaten=db.prepare(`SELECT id FROM kurse WHERE kategorie_id=? ORDER BY id ${richtung} LIMIT 5000`).all(skalierung.id).map(k=>k.id).sort((a,b)=>b-a);
    const beginn=performance.now();
    const r=await c(pfad+'?kategorie='+skalierung.id+'&q=Skalierungsprobe');
    const dauer=performance.now()-beginn;
    check('6000 Kandidaten begrenzt '+pfad,r.s===200&&r.d.abgeschnitten===true&&r.d.gesamt===5000&&r.d.seiten===417&&dauer<2000);
    assert.deepEqual(r.d.kurse.map(k=>k.id),kandidaten.slice(0,12));
    check('Array bleibt unbegrenzt '+pfad,(await c(pfad)).d.filter(k=>k.kategorie_id===skalierung.id).length===6000);
    check('Namenspfad begrenzt '+pfad,(await c(pfad+'?kategorie='+skalierung.id+'&sort=name')).d.abgeschnitten===true);
  }
  demoUebersetzungAn(true);
  try {
    check('Demopfad ohne Suchtext begrenzt',(await gast('/api/kurse?kategorie='+skalierung.id)).d.abgeschnitten===true);
  } finally { demoUebersetzungAn(false); }
  console.log('K1-Katalog-Server: alle Prüfungen bestanden');
} finally {
  for(const s of server) { s.closeAllConnections(); await new Promise(r=>s.close(r)); }
  db?.close();
  rmSync(dir,{recursive:true,force:true});
}
