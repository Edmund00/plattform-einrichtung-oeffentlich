// Scheibe 16: Unabhaengiger Offline-Test fuer Kaufmail, Gratis-Mail und Medien-Layout.
import './test-sprache.mjs';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
const ordner=mkdtempSync(join(tmpdir(),'schulung-kaufmail-'));
process.env.DB_DATEI=join(ordner,'test.db');
let bestanden=0,fehlgeschlagen=0,datenbank=null;
const pruefe=(name,ok)=>{ok?bestanden++:fehlgeschlagen++;console.log((ok?'OK     ':'FEHLER ')+name);};
const basis='http://localhost:4476',support='hilfe@example.com';
let sendungen=[];
const mailer=async mail=>{sendungen.push(mail);return true;};
try{
  const {db}=await import('../db.mjs');
  datenbank=db;
  const {mailDienst,kaufVormerken}=await import('../mail.mjs');
  const {ladeKonfig}=await import('../konfig.mjs');
  const {HU}=await import('../texte.mjs');
  const basisEnv={STRIPE_SECRET_KEY:['sk','test','platzhalter_nur_fuer_tests'].join('_'),
    STRIPE_WEBHOOK_SECRET:['whsec','platzhalter_nur_fuer_tests'].join('_')};
  pruefe('SUPPORT_MAIL fehlt: optional',
    ladeKonfig({...basisEnv}).supportMail==='');
  pruefe('SUPPORT_MAIL gueltig und unveraendert',
    ladeKonfig({...basisEnv,SUPPORT_MAIL:support}).supportMail===support);
  for(const falsch of ['falsch','zwei@example.com,drei@example.com','<test@example.com>']){
    let gemeldet='';
    try{ladeKonfig({...basisEnv,SUPPORT_MAIL:falsch});}catch(e){gemeldet=e.message;}
    pruefe('SUPPORT_MAIL abgelehnt ohne Wert im Fehler: '+falsch,
      gemeldet.includes('SUPPORT_MAIL')&&!gemeldet.includes(falsch));
  }
  const benutzer=db.prepare('INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt) VALUES(?,?,?,?)')
    .run('test-kaufmail@example.com','nur-fuer-selbsttest',new Date().toISOString(),Date.now()).lastInsertRowid;
  const kurseintrag=(titel,abo=null)=>{
    const zeit=new Date().toISOString();
    return db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,abo_preis_cent,abo_intervall,erstellt,geaendert) VALUES(?,?,990000,'huf','veroeffentlicht',?,?,?,?)")
      .run(titel,'',abo,'month',zeit,zeit).lastInsertRowid;
  };
  const titel='<script>alert("x")</script> & Kurzus';
  const kurs1=kurseintrag(titel),kurs2=kurseintrag('VALORE Abo',490000);
  const kursGratis=kurseintrag('VALORE ingyenes');
  const bestellung=(kurs,session,art,betrag=990000)=>{
    const zeit='2026-10-31T22:41:00.000Z';
    return db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES(?,?,?,?,'huf','bezahlt',?,?,?)")
      .run(session,benutzer,kurs,betrag,art,zeit,zeit).lastInsertRowid;
  };
  const b1=bestellung(kurs1,'cs_kaufmail_einmal','einmal');
  const b2=bestellung(kurs2,'in_kaufmail_abo','abo',490000);
  const dienst=mailDienst({mailer,base:basis,supportMail:support});
  kaufVormerken(benutzer,b1,'kauf');
  kaufVormerken(benutzer,b1,'kauf');
  kaufVormerken(benutzer,b2,'abo');
  pruefe('Pro Bestelltyp genau eine vorgemerkte Mail',
    db.prepare('SELECT COUNT(*) AS n FROM mail_ausgang').get().n===2);
  await dienst.ausgangSenden();
  pruefe('Einmalkauf und Abo: genau zwei Mails',sendungen.length===2);
  const einmal=sendungen.find(x=>x.subject.includes('<script>'));
  const abo=sendungen.find(x=>x.subject.includes('VALORE Abo'));
  pruefe('Neuer Kaufbetreff mit Kurstitel',
    einmal?.subject==='Köszönjük a vásárlást! – '+titel);
  pruefe('Betrag korrekt in Forint: 9 900 Ft',
    /9[\s\u00a0\u202f]900 Ft/.test(einmal?.text||'')&&/9[\s\u00a0\u202f]900 Ft/.test(einmal?.html||''));
  pruefe('Abo: 4 900 Ft in HTML und Plaintext, mit Intervall',
    /4[\s\u00a0\u202f]900 Ft \/ hónap/.test(abo?.text||'')&&
    /4[\s\u00a0\u202f]900 Ft \/ hónap/.test(abo?.html||''));
  pruefe('Kein ungetrennter Betrag im Mailtext',
    !/9900 Ft|4900 Ft/.test((einmal?.html||'')+(einmal?.text||'')+(abo?.html||'')+(abo?.text||'')));
  pruefe('Ungarische Überschrift genau einmal, Schlussformel genau einmal (HTML und Text)',
    !!einmal && ['html','text'].every(f=>
      (einmal[f].match(/Köszönjük a vásárlást!/g)||[]).length===1&&
      (einmal[f].match(/Köszönjük a bizalmadat!/g)||[]).length===1)&&
    einmal.html.includes('<h1')&&einmal.html.includes('Köszönjük a vásárlást!</h1>'));
  pruefe('Budapester Zeit aus Bestellungsdatum',
    !!einmal?.text.includes('2026. 10. 31. 23:41'));
  pruefe('Laufende DB-Bestellnummer, keine Stripe-ID',
    !!einmal?.text.includes('Rendelésszám: '+b1)&&
    !/cs_kaufmail|in_kaufmail|pi_|evt_/.test(einmal?.text+einmal?.html));
  pruefe('Kaufknopf und Link zur Kursliste',
    einmal?.text.includes('Előadásom megnyitása')&&
    einmal?.html.includes(basis+'/#/eloadasaim'));
  pruefe('Kundenhinweise und Support-Mail vorhanden',
    einmal?.text.includes('Tudnivalók')&&
    einmal?.text.includes(support) &&
    einmal?.text.includes('nyomtatás'));
  pruefe('HTML-Escaping: Script und Anfuehrungszeichen nicht ausführbar',
    einmal?.html.includes('&lt;script&gt;')&&
    einmal?.html.includes('&quot;x&quot;')&&
    !einmal?.html.includes('<script>')&&
    einmal?.text.includes('<script>'));
  pruefe('Abo-Variante mit Betrag, Intervall und Portal',
    !!abo?.text.includes('Előfizetés:')&&abo.text.includes('hónap')&&
    abo.text.includes('Stripe ügyfélportálján'));
  pruefe('Mail mit HTML UND Plaintext',
    !!einmal?.html.startsWith('<!doctype html>')&&
    !!einmal?.text.includes('Szia!')&&
    einmal?.text.includes('Köszönjük a bizalmadat!'));
  pruefe('Mail Idempotency-Key pro Bestellung eindeutig',
    sendungen.every(x=>/^schulung-[a-f0-9]{16}-\d+$/.test(x.idempotencyKey))&&
    new Set(sendungen.map(x=>x.idempotencyKey)).size===2);
  await dienst.ausgangSenden();
  pruefe('Zweiter Mail-Ausgangslauf: keine weitere Mail',sendungen.length===2);
  pruefe('Alle Kaufmails als gesendet markiert',
    db.prepare("SELECT COUNT(*) AS n FROM mail_ausgang WHERE status='gesendet'").get().n===2);
  const ohneSupport=mailDienst({mailer,base:basis});
  const kurs3=kurseintrag('Kein Support im Text');
  const b3=bestellung(kurs3,'cs_kaufmail_ohne_support','einmal');
  kaufVormerken(benutzer,b3,'kauf');
  await ohneSupport.ausgangSenden();
  const supportlos=sendungen.find(x=>x.subject.includes('Kein Support'));
  pruefe('Ohne SUPPORT_MAIL entfällt Support-Satz',
    !!supportlos&&!supportlos.text.includes('Ha kérdésed van')&&!supportlos.text.includes(support));
  dienst.gratisVormerken(benutzer,kursGratis);
  dienst.gratisVormerken(benutzer,kursGratis);
  pruefe('Gratis-Zugang hat nur einen eigenen Ausgangseintrag',
    db.prepare('SELECT COUNT(*) AS n FROM gratis_mail_ausgang').get().n===1);
  await dienst.gratisAusgangSenden();
  const gratis=sendungen.find(x=>x.subject.includes('Ingyenes előadás'));
  pruefe('Gratis-Variante ohne bezahlte Zeile',
    !!gratis&&gratis.text.includes('Ingyenes előadás')&&
    !gratis.text.includes('Fizetett összeg')&&!gratis.text.includes('Fizetés:'));
  const vor=sendungen.length;
  await dienst.gratisAusgangSenden();
  pruefe('Gratis-Mail exakt einmal',sendungen.length===vor);
  let fehlerMail=[];
  const failDienst=mailDienst({mailer:async m=>{fehlerMail.push(m);return false;},
    base:basis,supportMail:support});
  const kursFail=kurseintrag('Resend-Fehler');
  const bFail=bestellung(kursFail,'cs_kaufmail_provider_fehler','einmal');
  kaufVormerken(benutzer,bFail,'kauf');
  await failDienst.ausgangSenden();
  pruefe('Provider-Fehler lässt Bestell-Mail offen',
    db.prepare("SELECT status FROM mail_ausgang WHERE bestellung_id=?").get(bFail).status==='offen');
  // A8-02: Backoff (1 Minute nach dem Fehlversuch) im Test ablaufen lassen; vorher galt "sofort erneut".
  db.prepare("UPDATE mail_ausgang SET naechster_versuch=0 WHERE bestellung_id=?").run(bFail);
  await dienst.ausgangSenden();
  pruefe('Nachversuch sendet nur ein Exemplar und bleibt idempotent',
    db.prepare("SELECT status FROM mail_ausgang WHERE bestellung_id=?").get(bFail).status==='gesendet' &&
    fehlerMail[0].idempotencyKey===sendungen.at(-1).idempotencyKey);
  const js=readFileSync(resolve('public/kunde.js'),'utf8').replace(/\r\n/g,'\n');   // Windows-Zeilenenden (CRLF) vereinheitlichen
  const css=readFileSync(resolve('public/kunde.css'),'utf8').replace(/\r\n/g,'\n');
  const layout=js.slice(js.indexOf('  // Trailer zuerst im DOM.'),js.indexOf('// ---- Anmeldung und Registrierung'));
  pruefe('Kursseite DOM: Trailer vor Beschreibung und Preis',
    layout.indexOf('trailer(k)')>=0&&layout.indexOf('trailer(k)')<layout.indexOf('kurs-beschreibung')&&
    layout.indexOf('trailer(k)')<layout.indexOf('kurs-kauf-rechts'));
  pruefe('Mobil: Trailer vor Preis und Beschreibung, Desktop mit Preis rechts',
    css.includes("grid-template-areas:'trailer' 'preis' 'beschreibung' 'lektionen'")&&
    css.includes("grid-template-areas:'trailer preis' 'beschreibung preis' 'lektionen preis'"));
  pruefe('Beschreibung erhaelt Zeilenumbrueche',
    css.includes('.kurs-beschreibung-text{white-space:pre-line'));
  pruefe('Trailer weiterhin mit controls, poster und ohne autoplay',
    js.includes("class:'kurs-trailer-video',controls:true")&&
    js.includes("poster:'/api/kurse/'+k.id+'/titelbild'")&&
    !js.includes("autoplay:true"));
  pruefe('Kursliste unverändert im Quellaufbau',
    /titelbild\(k\),\s*h\('h2', \{\}, k\.titel\)/.test(js));
  pruefe('Keine neu eingefuegten Inline-Styles in HTML',
    !/setAttribute\(['"]style['"]/.test(js)&&
    !/<[^>]*style=/.test(js));
  const w=js.match(/const PDF_WASSERZEICHEN = Object.freeze\(\{([^}]+)\}\)/)?.[1]||'';
  const zahl=(key)=>Number(w.match(new RegExp(key+':\\s*([\\d.]+)'))?.[1]);
  pruefe('PDF-Wasserzeichen Deckkraft 8 bis 14 Prozent',
    zahl('deckkraft')>=.08&&zahl('deckkraft')<=.14);
  pruefe('PDF-Wasserzeichen kleine Schrift und weite Abstaende',
    zahl('schriftPx')<=15&&zahl('abstandX')>=420&&zahl('abstandY')>=300);
  pruefe('Canvas-Wasserzeichen bleibt eingebrannt, diagonaler Kontrast',
    js.includes("wasserzeichenAufLeinwand(ctx, canvas.width, canvas.height)")&&
    js.includes('ctx.strokeText(email')&&js.includes('ctx.fillText(email')&&
    js.includes('ctx.rotate(PDF_WASSERZEICHEN.drehung)'));
  pruefe('PDF: keine zweite große Wasserzeichen-Ebene',
    !js.includes('pdf-seitenmarke')&&!css.includes('.pdf-seitenmarke')&&
    js.includes('box.append(canvas);'));
  pruefe('PDF: Toolbar vor Seiten und mobiler Abstand',
    js.indexOf('ansicht.append(leiste, seiten)')>=0&&
    css.includes('padding:72px 0 16px')&&
    css.includes('.pdf-seiten{padding-top:72px}'));
  pruefe('Video-Wasserzeichen dezenter, aber bewegt',
    css.includes('--watermark-fg:rgba(255,255,255,.12)')&&
    css.includes('color:var(--watermark-fg)')&&
    js.includes('WASSERZEICHEN_WECHSEL_MS')&&
    js.includes('zeichen.style.left'));
  pruefe('PDF Druckschutz und Downloadverbot bleiben',
    css.includes('@media print{.schutz-rahmen')&&
    js.includes("'nodownload'")&&
    js.includes("oncontextmenu: e => e.preventDefault()"));
  pruefe('Kauftexte und Eventtexte in hu.json vorhanden',
    ['mail_kauf_betreff_neu','mail_kauf_gratis','mail_kauf_abo','mail_meldung_intro_registriert']
      .every(k=>typeof HU[k]==='string'));
} catch(e){fehlgeschlagen++;console.log('FEHLER Testablauf: '+e.message);}
finally{
 try{datenbank?.close();}catch{}
 try{rmSync(ordner,{recursive:true,force:true});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
}
console.log('Kaufmail: '+bestanden+' bestanden, '+fehlgeschlagen+' fehlgeschlagen');
process.exitCode=fehlgeschlagen?1:0;
