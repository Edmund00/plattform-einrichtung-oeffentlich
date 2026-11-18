// Scheibe 22: gesendete Testmails, Konfigurationsgrenzen und Informationsseite.
import './test-sprache.mjs';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
const tmp=mkdtempSync(join(tmpdir(),'schulung-mailrecht-'));
process.env.DB_DATEI=join(tmp,'test.db');
let db,ok=0,fehler=0;
const pruefe=(name,v)=>{v?ok++:fehler++;console.log((v?'OK ':'FEHLER ')+name);};
const lesen=p=>readFileSync(resolve(p),'utf8').replace(/\r\n/g,'\n');
const testEnv={STRIPE_SECRET_KEY:'sk_test_attrappe_ohne_netz',STRIPE_WEBHOOK_SECRET:'whsec_attrappe_ohne_netz'};
const provider={ANBIETER_NAME:'Gabriella <&> Kft.',ANBIETER_ANSCHRIFT:'Budapest & Utca 3',
 ANBIETER_TELEFON:'+36 1 234 5678',ANBIETER_EMAIL:'office@example.hu',
 ANBIETER_ADOSZAM:'HU-01234',STEUER_HINWEIS:'Adómentes szolgáltatás.'};
try{
 const {ladeKonfig,KonfigFehler}=await import('../konfig.mjs');
 const leer=ladeKonfig(testEnv);
 pruefe('Optionale Anbieterangaben fehlen: gültig',!leer.anbieter.ANBIETER_NAME);
 const cfg=ladeKonfig({...testEnv,...provider});
 pruefe('Anbieterdaten normal übernommen',cfg.anbieter.ANBIETER_NAME===provider.ANBIETER_NAME);
 for(const [feld,wert] of [['ANBIETER_NAME','x\nPRIVATE-SECRET'],['ANBIETER_TELEFON','schlechter-Wert'],
   ['ANBIETER_EMAIL','falsch@'],['STEUER_HINWEIS','Z'.repeat(201)]]){
   let msg='';try{ladeKonfig({...testEnv,[feld]:wert});}catch(e){msg=e.message;}
   pruefe('Ungültige Variable '+feld+' ohne Wert in Fehlermeldung',msg.includes(feld)&&!msg.includes(wert));
 }
 ({db}=await import('../db.mjs'));
 const {mailDienst,kaufVormerken}=await import('../mail.mjs');
 const zeit=new Date().toISOString();
 db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt,rechnung_name,rechnung_strasse) VALUES(?,?,?,?,?)")
   .run('kunde@example.hu','hash-test',zeit,'Vásárló','Fő út 1');
 const uid=Number(db.prepare('SELECT id FROM benutzer WHERE email=?').get('kunde@example.hu').id);
 const k=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,abo_preis_cent,abo_intervall,erstellt,geaendert) VALUES(?,'',990000,'huf','veroeffentlicht',990000,'month',?,?)").run('Kurzus <&>',zeit,zeit).lastInsertRowid);
 const insert=(id,art)=>Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES(?,?,?,990000,'huf','bezahlt',?,?,?)").run(id,uid,k,art,zeit,zeit).lastInsertRowid);
 const einz=insert('cs_mailrecht_once','einmal');
 const abo=insert('in_mailrecht_subscription','abo');
 db.prepare("INSERT INTO kauf_zustimmung(benutzer_id,kurs_id,text_version,zeit,stripe_sitzung) VALUES(?,?,'v1',?,?)").run(uid,k,zeit,'cs_mailrecht_once');
 const mails=[];
 const mailer=async m=>{mails.push(m);return true;};
 const dienst=mailDienst({mailer,base:'https://test.example.hu',anbieter:cfg.anbieter});
 kaufVormerken(uid,einz,'kauf');kaufVormerken(uid,abo,'abo');
 await dienst.ausgangSenden();
 const einmal=mails.find(x=>x.text?.includes('A hozzájárulásod időpontja'));
 const mon=mails.find(x=>x.text?.includes('havonta automatikusan'));
 pruefe('Einmalkauf-Mail wirklich versendet',!!einmal);
 pruefe('Anbieterdaten und Gesamtpreis in gesendeter Kaufmail',
   !!einmal&&Object.values(provider).every(v=>einmal.text.includes(v))&&
   einmal.text.includes('Teljes ár (az adókat is tartalmazza)')&&einmal.text.includes('9 900 Ft'));
 pruefe('Elállási tájékoztató, Muster und Bestelldaten',
   !!einmal&&einmal.text.includes('Elállási nyilatkozat-minta')&&einmal.text.includes('Kurzus <&>')&&
   einmal.text.includes('Vásárló')&&einmal.text.includes('A hozzájárulásod időpontja'));
 pruefe('Rechtslinks und URL zur Plattforminfo',
   !!einmal&&einmal.text.includes('reszveteli-feltetelek/')&&einmal.text.includes('adatvedelem/')&&
   einmal.text.includes('impresszum/')&&einmal.text.includes('#/elallasi-tajekoztato'));
 pruefe('Abo mit Verlängerung, Einmalkauf ohne Abo-Absatz',
   !!mon&&!einmal.text.includes('havonta automatikusan'));
 pruefe('HTML-Escaping Anbieter und Kurstitel',
   !!einmal&&einmal.html.includes('Gabriella &lt;&amp;&gt; Kft.')&&
   !einmal.html.includes('Gabriella <&> Kft.')&&einmal.html.includes('Kurzus &lt;&amp;&gt;'));
 const ohne=[];
 const d2=mailDienst({mailer:async m=>{ohne.push(m);return true},base:'https://test.example.hu'});
 db.prepare("UPDATE mail_ausgang SET status='offen',naechster_versuch=NULL WHERE bestellung_id=?").run(einz);   // A8-02: ohne Backoff-Frist erneut faellig
 await d2.ausgangSenden();
 pruefe('Kaufmail ohne Anbieter: kein Block und kein Fehler',ohne.length===1&&!ohne[0].text.includes('A szolgáltató adatai'));
 dienst.versandStarten('bestaetigung',{email:'kunde@example.hu'},{link:'https://test.example.hu/#/megerosites/token'});
 for(let i=0;i<20&&!mails.some(m=>m.subject===JSON.parse(lesen('texte/hu.json')).mail_bestaetigung_betreff.replace('{plattform}','Musterakademie'));i++)
   await new Promise(r=>setTimeout(r,10));
 const willkommen=mails.find(m=>m.subject===JSON.parse(lesen('texte/hu.json')).mail_bestaetigung_betreff.replace('{plattform}','Musterakademie'));
 pruefe('Registrierungs-Bestätigungsmail tatsächlich erzeugt und zugestellt',
   !!willkommen&&willkommen.text.includes('Részvételi feltételek')&&
   willkommen.text.includes('adatvedelem/')&&willkommen.text.includes(provider.ANBIETER_NAME));
 pruefe('Willkommensmail: Rechtslinks tragen ihren eigenen Text, nicht den Bestätigungs-Knopf',
   !!willkommen&&(willkommen.html.match(/Megerősítem/g)||[]).length===1&&
   willkommen.html.includes('style="color:#a87c2a">Részvételi feltételek</a>')&&
   willkommen.html.includes('style="color:#a87c2a">Adatvédelem</a>'));
 await dienst.kontoMailSenden('neu@example.hu','email_pruefen',{link:'https://test.example.hu/#/email-aendern/token'});
 await dienst.kontoMailSenden('alt@example.hu','email_geaendert',{});
 const neuMail=mails.find(x=>x.to==='neu@example.hu'),altMail=mails.find(x=>x.to==='alt@example.hu');
 pruefe('E-Mail-Änderungsmails tatsächlich erzeugt und Inhalt erhalten',
   !!neuMail&&!!altMail&&neuMail.text.includes('https://test.example.hu/')&&
   neuMail.html.includes('background:#faf6ee')&&altMail.html.includes('background:#faf6ee'));
 const aboid=Number(db.prepare("INSERT INTO abos(stripe_abo,benutzer_id,kurs_id,status,erstellt,geaendert) VALUES(?,?,?,'gekuendigt',?,?)")
  .run('sub_mailrecht_test',uid,k,zeit,zeit).lastInsertRowid);
 db.prepare('INSERT INTO abo_kuendigung_mail(abo_id,benutzer_id,kurs_id,erfasst,ende) VALUES(?,?,?,?,?)')
  .run(aboid,uid,k,Date.now(),Date.now()+86400000);
 await dienst.aboKuendigungAusgangSenden();
 pruefe('Kündigungsmail tatsächlich erzeugt und im VALORE-Stil',
   mails.some(x=>x.subject==='Az előfizetésed lemondását rögzítettük'&&x.html.includes('background:#faf6ee')));
 const reg=await import('../mail-recht.mjs');
 pruefe('Muster ohne Anbieter mit Auslassungen',reg.musterText().includes('...'));
 const kunde=lesen('public/kunde.js'),mail=lesen('mail.mjs'),hu=JSON.parse(lesen('texte/hu.json'));
 pruefe('Öffentliche Info-Route, Footer und Kurs-Link',
   kunde.includes("case 'elallasi-tajekoztato'")&&kunde.includes("href:'#/elallasi-tajekoztato'")&&
   kunde.includes("href: '#/elallasi-tajekoztato'")&&kunde.includes("'/api/anbieter'"));
 pruefe('Kein Inline-Style und kein innerHTML für neue Seite',
   kunde.includes('function elallasiTajekoztato()')&&!/\.innerHTML\s*=/.test(kunde));
 pruefe('Willkommensmail mit Datenschutzhinweisen und Anbieter-Block',
   mail.includes('HU.mailrecht_willkommen_links')&&(mail.includes('...anbieterZeilen(anbieter)')||mail.includes('...anbieterZeilen(anbieterAktuell())')));
 pruefe('E-Mail-Änderung und Kündigung mit VALORE-Stil',
   mail.includes('mail_konto_email_text')&&mail.includes('mail_konto_geaendert_text')&&
   mail.includes('aboKuendigungAusgangSenden')&&mail.includes('background:#faf6ee'));
 pruefe('Alle Textschlüssel vorhanden',
   ['mailrecht_anbieter','mailrecht_muster','mailrecht_ellallas_titel','k_mailrecht_seite_hinweis'].every(x=>!!hu[x]));
}catch(e){fehler++;console.log('FEHLER Testablauf: '+(e.code||e.message))}
finally{try{db?.close()}catch{}try{rmSync(tmp,{recursive:true,force:true})}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e}}
console.log('Mailrecht: '+ok+' bestanden, '+fehler+' fehlgeschlagen');process.exitCode=fehler?1:0;
