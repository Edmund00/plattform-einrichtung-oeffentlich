// S2a: nur vom Chef ausführen. Startet eine isolierte App mit temporärer DB.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
const dir=mkdtempSync(join(tmpdir(),'s2-beispiele-'));
process.env.DB_DATEI=join(dir,'test.db');
let db, server;
const PW='Beispiele-Testpasswort-123';
const check=(name,bed)=>{assert.ok(bed,name);console.log('OK '+name);};
function migration(datei) {
  const r=spawnSync(process.execPath,['--input-type=module','-e',"await import('./db.mjs')"],{env:{...process.env,DB_DATEI:datei},encoding:'utf8',timeout:20000});
  assert.equal(r.status,0,r.stderr);
}
try {
  // Eine alte DB ohne S2-Spalte, danach zwei getrennte Initialisierungen.
  const alt=join(dir,'alt.db');
  const basis=spawnSync('git',['show','2c3463d:db.mjs'],{encoding:'utf8'});
  assert.equal(basis.status,0,basis.stderr);
  const altModul=join(dir,'basis-db.mjs');
  writeFileSync(altModul,basis.stdout);
  const initAlt=spawnSync(process.execPath,[altModul],{env:{...process.env,DB_DATEI:alt},encoding:'utf8',timeout:20000});
  assert.equal(initAlt.status,0,initAlt.stderr);
  let probe=new DatabaseSync(alt);
  probe.exec("INSERT INTO kurse(titel,preis_cent,erstellt,geaendert) VALUES('Altbestand',0,'alt','alt')");
  probe.close();
  for(let i=0;i<2;i++) {
    migration(alt);
    probe=new DatabaseSync(alt);
    check('Migration idempotent '+i,probe.prepare('PRAGMA table_info(kurse)').all().filter(c=>c.name==='beispiel_key').length===1);
    check('Altbestand erhalten und NULL',probe.prepare('SELECT titel,beispiel_key FROM kurse').get().titel==='Altbestand'&&probe.prepare('SELECT beispiel_key FROM kurse').get().beispiel_key===null);
    probe.close();
  }
  ({db}=await import('../db.mjs'));
  const { passwortHashen }=await import('../auth.mjs');
  const { erstelleServer }=await import('../app.mjs');
  const { BEISPIELE, tr }=await import('../beispiel-inhalte.mjs');
  const quelle=readFileSync('beispiel-inhalte.mjs','utf8');
  check('HU ohne unerlaubte Begriffe',!/kurzus|tanfolyam/i.test(quelle));
  check('DE echte Umlaute',quelle.includes('Überlege')&&quelle.includes('anschließend')&&quelle.includes('Übung'));
  assert.deepEqual(tr('planen','unbekannt'),BEISPIELE.planen.de);
  const zeit=new Date().toISOString(), hash=await passwortHashen(PW);
  for(const rolle of ['admin','kunde']) db.prepare('INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)').run(rolle+'@example.com',hash,rolle,zeit);
  server=erstelleServer({stripe:{},webhookSecret:'test',base:'http://localhost',nodeEnv:'test',dateiOrdner:dir,dbDatei:process.env.DB_DATEI,abgleichAutomatik:false,ellallasWiederaufnahme:false}).listen(0,'127.0.0.1');
  await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  function client() {
    const jar=new Map(); // echter Cookie-Speicher (Sitzung + lang), nicht nur das zuletzt gesetzte Cookie
    return async (path,method='GET',body,headers={}) => {
      const cookie=[...jar].map(([k,v])=>k+'='+v).join('; ');
      const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)});
      for(const c of r.headers.getSetCookie()){const [kv]=c.split(';');const i=kv.indexOf('=');jar.set(kv.slice(0,i),kv.slice(i+1));}
      const text=await r.text(); let d; try {d=JSON.parse(text);} catch {d=text;}
      return {s:r.status,d,cookies:r.headers.getSetCookie(),sprache:r.headers.get('content-language')};
    };
  }
  const gast=client(),admin=client(),kunde=client();
  for(const [c,rolle] of [[admin,'admin'],[kunde,'kunde']]) check('Login '+rolle,(await c('/api/anmelden','POST',{email:rolle+'@example.com',passwort:PW})).s===200);
  const status='/api/admin/beispiele/status', api='/api/admin/beispiele';
  assert.deepEqual((await admin(status)).d,{angeboten:false,vorhanden:false,anlegbar:true,anzahl:0});
  assert.deepEqual((await gast('/api/beispiele')).d,{vorhanden:false,kurse:[]});
  for(const [path,method] of [[status,'GET'],[api,'POST'],[api,'DELETE'],[api+'/1/uebernehmen','POST']]) {
    check('Gast gesperrt '+method+path,(await gast(path,method)).s===401);
    check('Kunde gesperrt '+method+path,(await kunde(path,method)).s===403);
  }
  for(const [path,method] of [[api,'POST'],[api,'DELETE'],[api+'/1/uebernehmen','POST']]) check('Step-up '+method+path,(await admin(path,method)).d.fehler==='stepup_noetig');
  check('Step-up erfolgreich',(await admin('/api/admin/stepup','POST',{passwort:PW})).s===200);
  for(const [path,method] of [[api,'POST'],[api,'DELETE'],[api+'/1/uebernehmen','POST']]) check('Origin '+method+path,(await admin(path,method,undefined,{Origin:'https://fremd.example'})).s===403);
  // Der Einrichtungskurs blockiert nur nach Veröffentlichung.
  const echter=Number(db.prepare("INSERT INTO kurse(titel,preis_cent,erstellt,geaendert) VALUES('Eigen',0,?,?)").run(zeit,zeit).lastInsertRowid);
  check('Einrichtungsentwurf erlaubt Angebot',(await admin(status)).d.anlegbar);
  for (const zustand of ['archiviert','freigabe_offen']) {
    db.prepare('UPDATE kurse SET status=? WHERE id=?').run(zustand,echter);
    check(zustand+' erlaubt Angebot',(await admin(status)).d.anlegbar);
  }
  db.prepare("UPDATE kurse SET status='veroeffentlicht' WHERE id=?").run(echter);
  const blockiert=await admin(api,'POST');
  check('Veröffentlichte echte Kurse verhindern Anlage',blockiert.s===409&&blockiert.d.fehler==='beispiele_nur_ohne_kurse');
  check('Status mit echtem Kurs nicht anlegbar',!(await admin(status)).d.anlegbar);
  db.prepare("UPDATE kurse SET status='entwurf' WHERE id=?").run(echter);
  // Eigene gleichnamige Kategorie bleibt unabhängig.
  const kat=Number(db.prepare("INSERT INTO kategorien(name_de,name_en,name_hu,erstellt,geaendert) VALUES('Beispiel','Example','Példa',?,?)").run(zeit,zeit).lastInsertRowid);
  db.prepare("INSERT INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES('erster_kurs_json',?,?)").run(JSON.stringify({waehrung:'eur'}),zeit);
  const parallel=await Promise.all([admin(api,'POST'),admin(api,'POST')]);
  check('Paralleles Anlegen genau einmal',parallel.filter(r=>r.s===201).length===1&&parallel.filter(r=>r.s===409).length===1);
  let r=parallel.find(r=>r.s===201);
  db.prepare('DELETE FROM kurse WHERE id=?').run(echter);
  const beispiele=db.prepare('SELECT * FROM kurse WHERE beispiel_key IS NOT NULL ORDER BY id').all();
  check('Drei Entwürfe mit eigener Kategorie',beispiele.length===3&&beispiele.every(k=>k.status==='entwurf'&&k.kategorie_id!==kat)&&db.prepare('SELECT COUNT(*) n FROM kategorien').get().n===2);
  assert.deepEqual((await admin(status)).d,{angeboten:true,vorhanden:true,anlegbar:false,anzahl:3});
  for(const k of beispiele) {
    const t=BEISPIELE[k.beispiel_key].de;
    check('Persistenz DE '+k.beispiel_key,k.titel===t.titel&&k.beschreibung===t.beschreibung&&k.preis_cent===BEISPIELE[k.beispiel_key].preis_cent&&k.waehrung==='eur');
    const l=db.prepare('SELECT * FROM lektionen WHERE kurs_id=?').all(k.id);
    check('Genau eine sichtbare Textlektion '+k.id,l.length===1&&l[0].art==='text'&&l[0].status==='veroeffentlicht'&&l[0].inhalt===t.lektionen[0].text);
  }
  r=await admin(api,'POST');check('Wiederholung 409',r.s===409&&r.d.fehler==='beispiele_bereits_angeboten'&&db.prepare('SELECT COUNT(*) n FROM kurse').get().n===3);
  check('Öffentliche Kursliste leer',(await gast('/api/kurse')).d.length===0);
  check('Katalog mit Parametern leer',(await gast('/api/kurse?seite=1&preis=alle')).d.gesamt===0);
  check('Admin sieht drei Entwürfe',(await admin('/api/admin/kurse')).d.filter(k=>k.status==='entwurf').length===3);
  const zahlen=(await admin('/api/admin/kennzahlen')).d;
  check('Keine veröffentlichten Kurse oder Umsätze',zahlen.kurse===0&&zahlen.umsatz.every(w=>w.cent===0)&&zahlen.bestellungen===0);
  const kategorien=(await admin('/api/admin/kategorien')).d;
  check('Kategorien zählen Beispiele nicht',kategorien.find(k=>k.id===kat).anzahl===0&&kategorien.find(k=>k.id===kat).anzahl_gesamt===0);
  for(const lang of ['de','en','hu']) {
    const liste=(await gast('/api/beispiele?lang='+lang)).d;
    check('Öffentlich drei Beispiele '+lang,liste.vorhanden&&liste.kurse.length===3);
    for(const k of liste.kurse) {
      const t=BEISPIELE[k.key][lang];
      assert.equal(k.titel,t.titel); assert.equal(k.beschreibung,t.beschreibung);
      assert.equal(k.gratis,BEISPIELE[k.key].gratis);
      const detail=await gast('/api/beispiele/'+k.id+'?lang='+lang);
      assert.equal(detail.s,200);assert.deepEqual(detail.d.lektionen,t.lektionen);
      check('Musterlektion ohne Anmeldung '+lang+k.key,!JSON.stringify(detail.d).match(/kurzus|tanfolyam/i));
    }
  }
  const hu=await gast('/api/beispiele?lang=hu');
  check('HU ohne Cookie',hu.cookies.length===0&&hu.sprache==='hu'&&hu.d.kurse[0].titel===BEISPIELE.planen.hu.titel);
  check('Detail ohne Cookie',(await gast('/api/beispiele/'+beispiele[0].id+'?lang=hu')).cookies.length===0);
  check('Startseite setzt Cookie',(await gast('/?lang=en')).cookies.some(c=>c.startsWith('lang=en;')));
  const unbekannt=Number(db.prepare("INSERT INTO kurse(titel,preis_cent,beispiel_key,erstellt,geaendert) VALUES('Unbekannt',0,'unbekannt',?,?)").run(zeit,zeit).lastInsertRowid);
  check('Unbekannter Schlüssel Liste',(await gast('/api/beispiele')).d.kurse.length===3);
  check('Unbekannter Schlüssel Admin',(await admin(status)).s===200);
  check('Unbekannter Schlüssel Übernahme',(await admin(api+'/'+unbekannt+'/uebernehmen','POST')).s===404);
  db.prepare('DELETE FROM kurse WHERE id=?').run(unbekannt);
  for(const k of beispiele) {
    const lid=db.prepare('SELECT id FROM lektionen WHERE kurs_id=?').get(k.id).id;
    const vorher=readdirSync(dir,{recursive:true}).sort();
    const kodiert=String(k.id).split('').map(z=>'%'+z.charCodeAt(0).toString(16)).join('');
    for(const [p,m,b] of [['kurse/'+kodiert+'/veroeffentlichen','POST'],['kurse/'+kodiert,'PATCH',{titel:'Verboten'}]]) {
      const antwort=await admin('/api/admin/'+p,m,b);
      check('Mutationssperre kodierte ID (F-294) '+p,antwort.s>=400&&antwort.s<500&&antwort.d.fehler==='beispiel_gesperrt');
    }
    for(const prefix of ['/API/admin/','/api//admin/','/api/admin/']) {
      for(const [p,m,b] of [
        ['kurse/'+k.id+'/veroeffentlichen/','POST'],
        ['kurse/'+k.id+'/','PATCH',{titel:'Verboten'}],
        ['lektionen/'+lid+'/datei/','PUT'],
        ['lektionen/'+lid+'/bunny-upload/','POST',{name:'video.mp4',groesse:12}],
        ['kurse/'+k.id+'/vorschau/bild/','PUT']
      ]) {
        const antwort=await admin(prefix+p,m,b);
        check('Mutationssperre '+prefix+p,antwort.s>=400&&antwort.s<500&&antwort.d.fehler==='beispiel_gesperrt');
      }
    }
    assert.deepEqual(readdirSync(dir,{recursive:true}).sort(),vorher);
  }
  for(const id of ['0','-1','1x','9007199254740992']) check('Strikte ID '+id,(await gast('/api/beispiele/'+id)).s===400);
  for(const k of beispiele) {
    r=await kunde('/api/kurse/'+k.id+'/kaufen','POST',{});
    check('Kaufsperre auch gratis '+k.beispiel_key,r.s===409&&r.d.fehler==='beispiel_nicht_kaufbar');
    check('Veröffentlichung gesperrt',(await admin('/api/admin/kurse/'+k.id+'/veroeffentlichen','POST')).s===409);
    check('Manueller Zugang gesperrt',(await admin('/api/admin/kurse/'+k.id+'/zugaenge','POST',{email:'kunde@example.com'})).s===409);
  }
  for(const t of ['zugaenge','bestellungen','ereignisse']) check('Keine Nebenwirkungen '+t,db.prepare('SELECT COUNT(*) n FROM '+t).get().n===0);
  const { setzeTestkaufDb, setzeTestkaufStripeKey, testkaufStatus }=await import('../testkauf.mjs');
  setzeTestkaufDb(db);
  setzeTestkaufStripeKey('sk_test_s2_ohne_netzwerk');
  db.prepare("INSERT INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES('einrichtung_abgeschlossen_am',?,?)").run(zeit,zeit);
  check('Testkauf ohne echten Kurs nicht möglich',testkaufStatus().grund==='kein_veroeffentlichter_kurs');
  // Agent weder lesen noch bearbeiten/freigeben; Export ist ausgeschlossen.
  const schluessel=(await admin('/api/admin/agent/schluessel','POST',{name:'S2 Test'})).d.schluessel;
  assert.ok(schluessel);
  const bearer={Authorization:'Bearer '+schluessel};
  const agentClient=client(); // eigener Client ohne Cookie-Speicher: die Agenten-Schnittstelle lehnt Anfragen mit Cookie ab
  check('Agentliste ohne Beispiele',(await agentClient('/api/agent/kurse','GET',undefined,bearer)).d.length===0);
  for(const k of beispiele) {
    for(const [p,m,b] of [['','GET'],['','PATCH',{titel:'Fremd'}],['/freigabe','POST'],['/vorschlag','POST',{feld:'titel',wert:'Fremd'}]]) check('Agent Beispiel gesperrt '+m+p,(await agentClient('/api/agent/kurse/'+k.id+p,m,b,bearer)).s===404);
    check('Kurspaket exportiert Beispiel nicht',(await admin('/api/admin/kurse/'+k.id+'/kurspaket')).s===404);
  }
  // Entwurfslimits zählen nur echte Kurse: 49 eigene + drei Beispiele.
  for(let i=0;i<49;i++) db.prepare("INSERT INTO kurse(titel,preis_cent,erstellt,geaendert) VALUES(?,0,?,?)").run('Limit '+i,zeit,zeit);
  const agentNeu=await agentClient('/api/agent/kurse','POST',{titel:'Agent Nummer 50'},bearer);
  check('Agentlimit ohne Beispiele',agentNeu.s===201);
  db.prepare('DELETE FROM kurse WHERE id=?').run(agentNeu.d.id);
  const paket={format:'valore-kurspaket-v1',kurs:{titel:'Paket Nummer 50',beschreibung:'Eigener Inhalt',preis_forint:4900},
    lektionen:[{titel:'Erste Lektion',inhalt:'Text eins'},{titel:'Zweite Lektion',inhalt:'Text zwei'},{titel:'Dritte Lektion',inhalt:'Text drei'}]};
  const paketNeu=await admin('/api/admin/kurspaket/anlegen','POST',{paket:JSON.stringify(paket)},{Origin:'http://localhost'});
  check('Kurspaketlimit ohne Beispiele',paketNeu.s===201);
  db.exec('DELETE FROM kurse WHERE beispiel_key IS NULL');
  // Aktuelle verschlüsselte Sicherung und echtes Restore enthalten die Markierung.
  const kopie=join(dir,'kopie.db');
  db.prepare('VACUUM INTO ?').run(kopie);
  const { verschluesseln }=await import('../sicherung-format.mjs');
  const key=randomBytes(32), backup=join(dir,'s2.vsic'), restore=join(dir,'restore.db');
  writeFileSync(backup,verschluesseln(readFileSync(kopie),key));
  const restored=spawnSync(process.execPath,['tools/sicherung-entschluesseln.mjs',backup,restore],{env:{...process.env,SICHERUNG_SCHLUESSEL:key.toString('base64')},encoding:'utf8',timeout:20000});
  assert.equal(restored.status,0,restored.stderr);
  probe=new DatabaseSync(restore);
  assert.deepEqual(probe.prepare('SELECT id,beispiel_key FROM kurse ORDER BY id').all().map(k=>({...k})),beispiele.map(k=>({id:k.id,beispiel_key:k.beispiel_key})));
  probe.close();check('Sicherung/Restore bewahrt beispiel_key',true);
  // Jede Übernahmesprache prüfen, jeweils einmal bewusst als Entwurf übernehmen.
  for(const [i,lang] of ['de','en','hu'].entries()) {
    const k=beispiele[i];
    r=await admin(api+'/'+k.id+'/uebernehmen?lang='+lang,'POST');
    check('Übernehmen '+lang,r.s===200&&r.d.id===k.id);
    const normal=db.prepare('SELECT * FROM kurse WHERE id=?').get(k.id), t=BEISPIELE[k.beispiel_key][lang];
    check('Normaler Entwurf '+lang,normal.beispiel_key===null&&normal.status==='entwurf'&&normal.kategorie_id===null&&normal.titel===t.titel&&normal.beschreibung===t.beschreibung&&normal.preis_cent===k.preis_cent);
    assert.equal(db.prepare('SELECT inhalt FROM lektionen WHERE kurs_id=?').get(k.id).inhalt,t.lektionen[0].text);
    check('Echte ID öffentlich 404',(await gast('/api/beispiele/'+k.id)).s===404);
    check('Nicht nochmals übernehmen',(await admin(api+'/'+k.id+'/uebernehmen','POST')).s===404);
  }
  check('Übernahmen unveröffentlicht',(await gast('/api/kurse')).d.length===0);
  assert.deepEqual((await gast('/api/beispiele')).d,{vorhanden:false,kurse:[]});
  // Für Löschtest separat markierte Zeilen aus der Sicherung zurückspielen.
  // Das Angebot-Flag bleibt gesetzt; keine öffentliche Möglichkeit zur Wiederanlage.
  for(const k of beispiele) db.prepare('INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,beispiel_key,kategorie_id,erstellt,geaendert) VALUES(?,?,?,?,?,?,?,?,?)').run(k.titel,k.beschreibung,k.preis_cent,k.waehrung,'entwurf',k.beispiel_key,kat,zeit,zeit);

  const loeschKurs=db.prepare('SELECT id FROM kurse WHERE beispiel_key IS NOT NULL LIMIT 1').get().id;
  const dateiname=randomUUID();
  writeFileSync(join(dir,dateiname),'PDF-Testinhalt');
  const dateiLektion=Number(db.prepare("INSERT INTO lektionen(kurs_id,titel,art,erstellt,geaendert) VALUES(?,'Datei','pdf',?,?)").run(loeschKurs,zeit,zeit).lastInsertRowid);
  db.prepare("INSERT INTO dateien(lektion_id,name,art,pfad,groesse,erstellt) VALUES(?,'test.pdf','pdf',?,14,?)").run(dateiLektion,dateiname,zeit);
  const normalVorher=db.prepare('SELECT * FROM kurse WHERE beispiel_key IS NULL ORDER BY id').all();
  const lektionenVorher=db.prepare('SELECT l.* FROM lektionen l JOIN kurse k ON k.id=l.kurs_id WHERE k.beispiel_key IS NULL ORDER BY l.id').all();
  r=await admin(api,'DELETE');check('Alle Beispiele entfernt',r.s===200&&r.d.entfernt===3);
  assert.deepEqual(db.prepare('SELECT * FROM kurse ORDER BY id').all(),normalVorher);
  assert.deepEqual(db.prepare('SELECT * FROM lektionen ORDER BY id').all(),lektionenVorher);
  check('Lokale Lektionsdatei entfernt',!existsSync(join(dir,dateiname)));
  check('Eigene Kategorie bleibt',!!db.prepare('SELECT 1 FROM kategorien WHERE id=?').get(kat));
  check('Wiederholtes Entfernen',(await admin(api,'DELETE')).d.entfernt===0);
  check('Angebot bleibt verbraucht',(await admin(api,'POST')).d.fehler==='beispiele_bereits_angeboten'&&(await admin(status)).d.angeboten);
  // Isolierter zweiter Lebenszyklus: HUF-Rückfall und Kategorie ohne eigene Kurse.
  db.exec("DELETE FROM kurse; DELETE FROM kategorien; DELETE FROM einstellungen WHERE schluessel IN ('beispiele_angeboten','erster_kurs_json')");
  db.prepare("INSERT INTO einstellungen(schluessel,wert,aktualisiert_am) VALUES('erster_kurs_json','{kaputt',?)").run(zeit);
  check('Kaputtes JSON Status',(await admin(status)).s===200);
  const eigeneKat=Number(db.prepare("INSERT INTO kategorien(name_de,name_en,name_hu,erstellt,geaendert) VALUES('Beispiel','Example','Példa',?,?)").run(zeit,zeit).lastInsertRowid);
  check('HUF Anlage',(await admin(api,'POST')).s===201);
  assert.deepEqual(db.prepare('SELECT beispiel_key,preis_cent,waehrung FROM kurse ORDER BY id').all().map(k=>({...k})),[
    {beispiel_key:'planen',preis_cent:1990000,waehrung:'huf'},
    {beispiel_key:'video',preis_cent:2990000,waehrung:'huf'},
    {beispiel_key:'plattform',preis_cent:0,waehrung:'huf'},
  ]);
  const lessons=db.prepare('SELECT COUNT(*) n FROM lektionen').get().n;
  check('HUF sichtbare Lektionen',lessons===3);
  check('Entfernen HUF',(await admin(api,'DELETE')).d.entfernt===3);
  check('Lektionskaskade und leere Beispielkategorie entfernt',db.prepare('SELECT COUNT(*) n FROM lektionen').get().n===0&&db.prepare('SELECT COUNT(*) n FROM kategorien').get().n===1&&!!db.prepare('SELECT id FROM kategorien WHERE id=?').get(eigeneKat));
  check('Nie nochmals angeboten',!(await admin(status)).d.anlegbar);
  console.log('S2-Beispiele-Server: alle Prüfungen bestanden');
} finally {
  if(server) {server.closeAllConnections();await new Promise(r=>server.close(r));}
  db?.close();rmSync(dir,{recursive:true,force:true});
}
