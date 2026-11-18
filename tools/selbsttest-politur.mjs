// Scheibe 30: Offline-Code- und Formatpruefung, ohne fremde Dienste.
import './test-sprache.mjs';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
const read=p=>readFileSync(resolve(p),'utf8');
const kunde=read('public/kunde.js'),admin=read('public/admin/admin.js');
const css=read('public/kunde.css'),acss=read('public/admin/admin.css');
const mail=read('mail.mjs'),agent=read('routes-agent.mjs');
const preis=read('public/preis.js'),hu=JSON.parse(read('texte/hu.json'));
let ok=0,fehl=0;
function test(name,pass){console.log((pass?'OK ':'FEHLER ')+name);if(pass)ok++;else fehl++;}
const count=(source,regex)=>(source.match(regex)||[]).length;
try{
 const inputs=count(kunde,/type:\s*['\"]password['\"]/g);
 const wrapped=count(kunde,/jelszoMezo\((?:jelszo|neu|nochmal|alt|emailPass|loeschPass)\)/g);
 test('Neun Kunden-Passwortfelder haben neun sichtbare Auge-Aufrufe (Login, Registrierung, Rest)',inputs===9&&wrapped===inputs);
 test('Admin-Passwortfeld hat genau einen Auge-Aufruf',count(admin,/type:\s*['\"]password['\"]/g)===1&&count(admin,/jelszoMezo\(passwort\)/g)===1);
 for(const [name,source] of [['Kunde',kunde],['Admin',admin]]){
   test(name+': Knopf ist kein Submit, Aria und Standard-Verborgen',source.includes("type:'button',class:'jelszo-auge'")&&source.includes("'aria-label':t('jelszo_zeigen')")&&source.includes("'aria-pressed':'false'")&&source.includes("input.type='password'"));
   test(name+': Reset bei Submit, Hashchange, Pagehide',source.includes("addEventListener('submit',jelszoZuruecksetzen,true)")&&source.includes("addEventListener('hashchange',jelszoZuruecksetzen)")&&source.includes("addEventListener('pagehide',jelszoZuruecksetzen)")&&source.includes('jelszoZuruecksetzen();'));
   test(name+': Cursor und Fokus bleiben im Eingabefeld',source.includes("input.focus({preventScroll:true})")&&source.includes('input.setSelectionRange(start,end)')&&source.includes("document.createElementNS(ns,'svg')"));
   const newCode=source.slice(source.indexOf('// Passwort wird nur im Eingabefeld'),source.indexOf("const app = document.getElementById('app');"));
   test(name+': kein innerHTML, Inline-Style oder localStorage im neuen Code',!/(?:innerHTML|localStorage|setAttribute\(['"]style['"]|\.style\.)/.test(newCode));
 }
 test('Neue ungarische Sichtbarkeits-Texte existieren und werden verwendet',hu.jelszo_zeigen==='Jelszó megjelenítése'&&hu.jelszo_verbergen==='Jelszó elrejtése'&&kunde.includes("t(offen?'jelszo_verbergen':'jelszo_zeigen')")&&admin.includes("t(offen?'jelszo_verbergen':'jelszo_zeigen')"));
 test('Kunden-Passwortfeld Login: urspruengliche Attribute erhalten',kunde.includes("type: 'password', name: 'passwort', autocomplete: 'current-password', required: true, minlength: '8'"));
 test('Kunden-Passwortfelder Reset/Aenderung: Attribute erhalten',count(kunde,/type:'password',autocomplete:'new-password',minlength:'8',maxlength:'200',required:true/g)===4&&count(kunde,/type:'password',autocomplete:'current-password',required:true/g)===1);
 test('Konto-Passwortfelder: Attribute erhalten',count(kunde,/type:'password',required:true,autocomplete:'current-password'/g)===2);
 test('Admin-Login: Passwortattribute erhalten',admin.includes("type: 'password', name: 'passwort', autocomplete: 'current-password', required: true"));
 test('44px Touch bei Footer, Checkboxes und beiden Auge-CSS',css.includes('.fuss-links a{display:inline-flex;align-items:center;min-height:44px}')&&css.includes('label:has(input[type=checkbox])')&&css.includes('.jelszo-auge{')&&css.includes('min-height:44px')&&acss.includes('.jelszo-auge{min-height:44px'));
 test('Adminzeit: gemeinsame Budapestzeit und keine lokalen toLocaleString-Strings',admin.includes('function budapestZeit(wert)')&&admin.includes("timeZone:'Europe/Budapest'")&&!/toLocaleString\('hu-HU'/.test(admin)&&!admin.includes('.toISOString()'));
 test('Agentzeit, Sicherungszeit und Abo-Benutzerzeiten nutzen Budapest',admin.includes('budapestZeit(x.zeit)')&&admin.includes('budapestZeit(z.gueltig_bis)')&&admin.includes('budapestZeit(x.zuletzt_benutzt)'));
 // Werte direkt aus den Audit-/Fehlerstellen lesen. Neue Aktionen oder Fehlercodes duerfen nicht unbemerkt erscheinen.
 const actions=[...new Set([
  ...[...agent.matchAll(/agentAudit\([^,\n]+,\s*'([a-z_]+)'/g)].map(x=>x[1]),
  ...[...agent.matchAll(/fail\([^,\n]+,\s*\d+,\s*'[^']+'\s*,\s*[^,\n]+,\s*'([a-z_]+)'/g)].map(x=>x[1])
 ])];
 const codes=[...new Set([...agent.matchAll(/'(agent_[a-z_]+|cookie_not_allowed|nicht_gefunden)'/g)].map(x=>x[1]))];
 test('Alle '+actions.length+' Agentaktionen in ungarischer Anzeige vorhanden',actions.length>=14&&actions.every(x=>!!hu['agent_protokoll_aktion_'+x]));
 test('Alle '+codes.length+' Agentgruende in ungarischer Anzeige vorhanden',codes.length>=11&&codes.every(x=>!!hu['agent_protokoll_grund_'+x]));
 test('Agent-Ergebnisse vorhanden; unbekannte Werte werden "ismeretlen" statt Rohtext (J7)',!!hu.agent_protokoll_ergebnis_abgelehnt&&!!hu.agent_protokoll_ergebnis_ok&&admin.includes("t('a_ismeretlen')")&&!admin.includes("??wert??'–'"));
 const {formatGeld}=await import('../betrag.mjs');
 const examples=[[490000,'huf','4 900 Ft'],[3990000,'huf','39 900 Ft'],[99000,'huf','990 Ft'],[0,'huf','0 Ft'],[123456789,'huf','1 234 567 Ft'],[1500,'eur','15,00 EUR']];
 for(const [cent,currency,expected] of examples)test('Betrag '+cent+' '+currency+' -> '+expected,formatGeld(cent,currency)===expected);
 test('Nur zentrale Formatierungsdatei benutzt Intl-NumberFormat hu-HU',![kunde,admin,mail].some(x=>x.includes("Intl.NumberFormat('hu-HU'"))&&preis.includes("useGrouping: 'always'"));
 test('Abo-Erstattungsmail benutzt gemeinsamen Formatter, Admin-Link und Systemtext',mail.includes("const geld=geldText(j.betrag,j.waehrung)")&&mail.includes("const geldText=(cent,waehrung)=>formatGeld(cent,waehrung,sprache())")&&mail.includes("const adminLink=base+'/admin/'")&&mail.includes('HU.mail_systemhinweis')&&mail.includes('schulung-abo-erstattung-'));
 const {formatBetrag}=await import('../public/preis.js');
 test('Browserbetrag: normale statt geschuetzter Leerzeichen',formatBetrag(490000,'huf')==='4 900 Ft'&&formatBetrag(3990000,'huf')==='39 900 Ft');
 const dir=mkdtempSync(join(tmpdir(),'schulung-politur-'));
 try{
   process.env.DB_DATEI=join(dir,'probe.db');
   const {db}=await import('../db.mjs');
   const {mailDienst}=await import('../mail.mjs');
   const stamp=new Date().toISOString();
   const uid=Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt) VALUES(?,'probe',?)").run('politur@example.invalid',stamp).lastInsertRowid);
   const cid=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES('Politur tanfolyam','',490000,'huf','entwurf',?,?)").run(stamp,stamp).lastInsertRowid);
   const bid=Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,grund,art,erstellt,geaendert) VALUES(?,?,?,490000,'huf','erstattet','erstattung_voll','abo',?,?)").run('in_politur_test',uid,cid,stamp,stamp).lastInsertRowid);
   db.prepare("INSERT INTO abo_erstattung_mail(bestell_id,refund_id,betrag) VALUES(?,'re_politur_test',490000)").run(bid);
   const sent=[];
   const m=mailDienst({mailer:async x=>{sent.push(x);return true},base:'https://valore.invalid',verkaufsmeldungMail:'inhaber@example.invalid'});
   await m.aboErstattungAusgangSenden();
   test('Abo-Erstattungsmail: eine Nachricht mit 4 900 Ft, Link und Systemhinweis',sent.length===1&&sent[0].text.includes('4 900 Ft')&&sent[0].text.includes('https://valore.invalid/admin/')&&sent[0].text.includes(hu.mail_systemhinweis)&&sent[0].html.includes('href="https://valore.invalid/admin/"')&&sent[0].html.includes(hu.mail_systemhinweis));
   test('Mail-Sicherheit: kein API-Schluessel, kein Refund-Identifier',sent.length===1&&!sent[0].text.includes('re_politur_test')&&!sent[0].text.includes('sk_test_'));
 }finally{try{rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:200});}catch{}}
}catch(e){fehl++;console.error('FEHLER Testabbruch:',e?.name||'Fehler',e?.message||'');}
// Regression aus der Abnahme von Scheibe 30: ChatGPT löschte versehentlich `export function centZuForint`, admin.js importiert sie; dadurch lud die ganze Admin-Seite nicht mehr.
// Jeder benannte Import aus preis.js muss in preis.js wirklich exportiert werden (für kunde.js, admin.js und alle weiteren Browser-Dateien).
try{
  const exportiert=new Set([...preis.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/g)].map(m=>m[1]));
  const dateien={'public/kunde.js':kunde,'public/admin/admin.js':admin};
  for(const [datei,quelle] of Object.entries(dateien)){
    const importe=[...quelle.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"][./]*preis\.js['"]/g)].flatMap(m=>m[1].split(',').map(s=>s.trim().split(/\s+as\s+/)[0]).filter(Boolean));
    const fehlend=importe.filter(n=>!exportiert.has(n));
    test(datei+': alle '+importe.length+' Importe aus preis.js existieren als Export'+(fehlend.length?' (fehlt: '+fehlend.join(',')+')':''),importe.length>0&&fehlend.length===0);
  }
  // Jede in preis.js selbst aufgerufene Funktion muss dort definiert sein (kein Aufruf einer gelöschten Hilfsfunktion).
  const definiert=new Set([...preis.matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)].map(m=>m[1]));
  const aufgerufen=[...new Set([...preis.matchAll(/\b(centZuForint|forintZuCent|formatGanzeEinheiten|formatForint|formatBetrag|formatMeret)\s*\(/g)].map(m=>m[1]))];
  test('preis.js: jede intern aufgerufene Preisfunktion ist dort definiert',aufgerufen.every(n=>definiert.has(n)));
}catch(e){fehl++;console.error('FEHLER Regressionstest:',e?.message||'');}
console.log('Politur: '+ok+' bestanden, '+fehl+' fehlgeschlagen');
process.exitCode=fehl?1:0;
