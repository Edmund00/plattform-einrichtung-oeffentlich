// Scheibe 7: Offline-Schutztest mit Wegwerf-DB und Stripe-Attrappe, kein Schlüssel und keine neuen Pakete.
import './test-sprache.mjs';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = mkdtempSync(join(tmpdir(),'schulung-schutz-'));
const dbDatei = join(root,'schutz.db'), ordner = join(root,'dateien');
const PORT = 4417, base = 'http://127.0.0.1:' + PORT;
const pw = randomBytes(24).toString('base64url');
const key = randomBytes(32).toString('hex');
process.env.DB_DATEI = dbDatei;
let ok = 0, schlecht = 0, server;
function check(name, gut, detail) {
  gut ? ok++ : schlecht++;
  console.log((gut ? 'OK     ' : 'FEHLER ') + name + (!gut && detail ? ' -> ' + String(detail).slice(0,200) : ''));
}
function sql(abfrage,...werte) {
  const d = new DatabaseSync(dbDatei);
  try { return d.prepare(abfrage).all(...werte); } finally { d.close(); }
}
function exec(abfrage,...werte) {
  const d = new DatabaseSync(dbDatei);
  try { return d.prepare(abfrage).run(...werte); } finally { d.close(); }
}
function client() {
  let cookie = '';
  return {
    async anfrage(methode, pfad, body, header = {}) {
      const r = await fetch(base + pfad, {
        method:methode, headers:{...(cookie ? {Cookie:cookie}:{}),...(body !== undefined ? {'Content-Type':'application/json'}:{}),...header},
        ...(body !== undefined ? {body:JSON.stringify(body)} : {}),
      });
      const setCookie = r.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const bytes = Buffer.from(await r.arrayBuffer());
      let daten = {};
      if (r.headers.get('content-type')?.includes('json')) {
        try { daten = JSON.parse(bytes.toString('utf8')); } catch {}
      }
      return { status:r.status, daten, header:r.headers, bytes };
    },
    get cookie() { return cookie; }
  };
}
const warten = ms => new Promise(r=>setTimeout(r,ms));
try {
  mkdirSync(ordner,{recursive:true});
  const { erstelleServer } = await import(pathToFileURL(resolve('app.mjs')).href);
  const stripe = new Proxy({}, {get:()=> {throw new Error('Kein Stripe-Zugriff im Schutztest');}});
  server = erstelleServer({stripe,webhookSecret:'nur_test',base, dateiOrdner:ordner, maxUploadBytes:1048576,
    wiedergabeSchluessel:key, maxSitzungen:3}).listen(PORT,'127.0.0.1');
  await new Promise((fertig, fehler) => {
    if (server.listening) return fertig();
    server.once('listening', fertig);
    server.once('error', fehler);
  });
  const admin = client(), kunde = client(), fremd = client(), gast = client();
  const adminMail = 'schutz.admin@example.com', kundeMail='schutz.kunde@example.com', fremdMail='schutz.fremd@example.com';
  const script = spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','tools/admin-anlegen.mjs',adminMail],
    {env:{...process.env, ADMIN_PASSWORT:pw},encoding:'utf8'});
  check('Admin angelegt',script.status===0,script.stderr);
  check('Admin angemeldet',(await admin.anfrage('POST','/api/anmelden',{email:adminMail,passwort:pw})).status===200);
  check('Kunde registriert',(await kunde.anfrage('POST','/api/registrieren',{ zustimmung: true, email:kundeMail,passwort:pw})).status===201);
  check('Fremder Kunde registriert',(await fremd.anfrage('POST','/api/registrieren',{ zustimmung: true, email:fremdMail,passwort:pw})).status===201);
  const uid=sql('SELECT id FROM benutzer WHERE email=?',kundeMail)[0].id;
  const kurs=(await admin.anfrage('POST','/api/admin/kurse',{titel:'Schutz-Test',preis_cent:10000})).daten.id;
  const lek=(await admin.anfrage('POST','/api/admin/kurse/'+kurs+'/lektionen',{titel:'PDF',art:'pdf'})).daten.id;
  const lex=(await admin.anfrage('POST','/api/admin/kurse/'+kurs+'/lektionen',{titel:'Audio',art:'audio'})).daten.id;
  const alt=(await admin.anfrage('POST','/api/admin/kurse/'+kurs+'/lektionen',{titel:'Alt',art:'datei'})).daten.id;
  const name='11111111-1111-4111-8111-111111111111', daten=Buffer.from('%PDF-1.4\n'+ 'x'.repeat(200));
  const audioName='22222222-2222-4222-8222-222222222222', audio=Buffer.from('ID3\\x03\\x00\\x00xxxx','latin1');
  writeFileSync(join(ordner,audioName),audio);
  writeFileSync(join(ordner,name),daten);
  exec('INSERT INTO dateien (lektion_id,name,art,pfad,groesse,mime,erstellt) VALUES (?,?,?,?,?,?,?)',
    lek,'Privat-Kurs.pdf','pdf',name,daten.length,'application/pdf',new Date().toISOString());
  exec('INSERT INTO dateien (lektion_id,name,art,pfad,groesse,mime,erstellt) VALUES (?,?,?,?,?,?,?)',
    lex,'hoerbuch.mp3','audio',audioName,audio.length,'audio/mpeg',new Date().toISOString());
  await admin.anfrage('POST','/api/admin/kurse/'+kurs+'/veroeffentlichen',{});
  check('Kunde bekommt Kurszugang',(await admin.anfrage('POST','/api/admin/kurse/'+kurs+'/zugaenge',{email:kundeMail})).status===201);
  check('Fremder bekommt Zugang für Sitzungstest',(await admin.anfrage('POST','/api/admin/kurse/'+kurs+'/zugaenge',{email:fremdMail})).status===201);
  const ticketURL='/api/lektionen/'+lek+'/wiedergabe';
  const dateiURL='/api/lektionen/'+lek+'/datei';
  check('Ohne Anmeldung kein Ticket',(await gast.anfrage('POST',ticketURL,{})).status===401);
  const t=(await kunde.anfrage('POST',ticketURL,{})).daten;
  check('Ticket signiert mit Ablauf nach 6 Stunden',typeof t.ticket==='string' && t.ticket.includes('.') &&
    t.ablauf>Date.now()+5.9*3600000 && t.ablauf<Date.now()+6.1*3600000);
  check('Wasserzeichen-Adresse vom Server',t.email===kundeMail);
  check('Gast ohne Sitzung erhält keine Datei',(await gast.anfrage('GET',dateiURL+'?ticket='+t.ticket)).status===401);
  check('Mit Sitzung aber ohne Ticket 403',(await kunde.anfrage('GET',dateiURL)).status===403);
  const file=await kunde.anfrage('GET',dateiURL+'?ticket='+t.ticket);
  check('Datei vollständig inline lesbar',file.status===200 && file.bytes.equals(daten));
  check('PDF darf nicht in fremde oder eigene Frames eingebettet werden',
    file.header.get('x-frame-options')==='DENY' &&
    file.header.get('content-security-policy')?.includes("frame-ancestors 'none'"));
  check('Kein attachment und kein Originalname im Header',file.header.get('content-disposition')==='inline' &&
    !JSON.stringify([...file.header]).includes('Privat-Kurs.pdf'));
  check('Range 206', (await kunde.anfrage('GET',dateiURL+'?ticket='+t.ticket,undefined,{Range:'bytes=0-8'})).status===206);
  check('Range liefert 9 richtige Bytes',(await kunde.anfrage('GET',dateiURL+'?ticket='+t.ticket,undefined,{Range:'bytes=0-8'})).bytes.equals(daten.subarray(0,9)));
  check('Falscher Benutzer 403',(await fremd.anfrage('GET',dateiURL+'?ticket='+t.ticket)).status===403);
  check('Falsche Lektion 403',(await kunde.anfrage('GET','/api/lektionen/'+lex+'/datei?ticket='+t.ticket)).status===403);
  check('Ticket für Audio erlaubt',(await kunde.anfrage('POST','/api/lektionen/'+lex+'/wiedergabe',{})).status===200);
  check('Ungültige Signatur 403',(await kunde.anfrage('GET',dateiURL+'?ticket='+t.ticket+'x')).status===403);
  const sessionHash=createHash('sha256').update(kunde.cookie.split('=')[1]).digest('hex');
  const abgelaufen=Buffer.from(JSON.stringify([uid,lek,sessionHash,Date.now()-1])).toString('base64url');
  const sign=createHmac('sha256',key).update(abgelaufen).digest('base64url');
  check('Abgelaufenes Ticket 403',(await kunde.anfrage('GET',dateiURL+'?ticket='+abgelaufen+'.'+sign)).status===403);
  await warten(12);
  const erneuert=await kunde.anfrage('POST',ticketURL,{});
  check('Ticket erneuerbar',erneuert.status===200 && erneuert.daten.ablauf>=t.ablauf);
  const andereSitzung=client();
  await andereSitzung.anfrage('POST','/api/anmelden',{email:kundeMail,passwort:pw});
  check('Andere Sitzung desselben Benutzers 403',(await andereSitzung.anfrage('GET',dateiURL+'?ticket='+t.ticket)).status===403);
  const verboten=await admin.anfrage('POST','/api/admin/kurse/'+kurs+'/archivieren',{});
  check('Archiviert',verboten.daten.status==='archiviert');
  check('Archiviertes PDF für Käufer abrufbar',(await kunde.anfrage('GET',dateiURL+'?ticket='+t.ticket)).status===200);
  check('ZIP/Docx in alter datei-Lektion: kein Ticket',(await kunde.anfrage('POST','/api/lektionen/'+alt+'/wiedergabe',{})).status===403);
  check('Kunde kann alten Dateityp nicht abrufen',(await kunde.anfrage('GET','/api/lektionen/'+alt+'/datei?ticket='+t.ticket)).status===403);
  const zip=Buffer.from('PK\x03\x04ein Test');
  const upload=await fetch(base+'/api/admin/lektionen/'+alt+'/datei',{method:'PUT',
    headers:{Cookie:admin.cookie,'Content-Type':'application/zip','X-Dateiname':'alt.zip'},body:zip});
  check('ZIP-Upload gesperrt',upload.status===400);
  await admin.anfrage('DELETE','/api/admin/kurse/'+kurs+'/zugaenge/'+uid);
  check('Nach Zugangsentzug sofort 403 trotz Ticket',(await kunde.anfrage('GET',dateiURL+'?ticket='+t.ticket)).status===403);
  check('Neues Ticket nach Entzug 403',(await kunde.anfrage('POST',ticketURL,{})).status===403);
  await admin.anfrage('POST','/api/admin/kurse/'+kurs+'/zugaenge',{email:kundeMail});
  check('Nach erneuter Freigabe wieder 200',(await kunde.anfrage('GET',dateiURL+'?ticket='+t.ticket)).status===200);
  const dritter=client(), vierter=client();
  await dritter.anfrage('POST','/api/anmelden',{email:kundeMail,passwort:pw});
  await vierter.anfrage('POST','/api/anmelden',{email:kundeMail,passwort:pw});
  check('Gerätelimit beendet älteste Sitzung',(await kunde.anfrage('GET','/api/ich')).daten.angemeldet===false);
  check('Alter Wiedergabe-Link nach Sitzungsende 401',(await kunde.anfrage('GET',dateiURL+'?ticket='+t.ticket)).status===401);
  check('Neue Sitzung weiterhin aktiv',(await vierter.anfrage('GET','/api/ich')).daten.angemeldet===true);
  // Browsercode wird zusätzlich statisch geprüft; echte Bildschirmaufnahme kann nie verhindert werden.
  // Regression-Schutz: Scheibe 8 hatte einmal die Ablaufprüfung im echten Dateiabruf vergessen.
  const dateienCode = readFileSync(resolve('dateien.mjs'), 'utf8');
  check('Abo-Ablauf in Ticket UND Dateiabruf zentral geprüft',
    (dateienCode.match(/gueltigerZugang\(benutzer\.id, z\.kurs_id\)/g) || []).length === 2 &&
    !/FROM zugaenge/.test(dateienCode));
  const js=readFileSync(resolve('public/kunde.js'),'utf8'), css=readFileSync(resolve('public/kunde.css'),'utf8');
  check('Bewegtes E-Mail-Wasserzeichen im Kundencode',js.includes("wasserzeichen(ticketAntwort.d.email)") && js.includes('setInterval(bewegen') && css.includes('.wasserzeichen'));
  check('Video ohne Download-Schaltfläche',js.includes('nodownload') && js.includes('disablePictureInPicture'));
  check('PDF nur auf Canvas und ohne Download-Link',
    js.includes("h('canvas'") && js.includes('wasserzeichenAufLeinwand') &&
    js.includes('pdf.min.mjs') &&
    // Bunny-Videos (Schritt 5) nutzen einen iframe, aber NUR einmal und NUR in bunnyAnsicht (ein Bereich mit genau einer Funktion); sonst nirgends, in keiner Schreibweise.
    ((bereich) => (js.match(/['"`]iframe['"`]/g) || []).length === 1 && bereich.includes("h('iframe'") && (bereich.match(/function /g) || []).length === 1 && !/createElement\(\s*['"`]iframe/i.test(js))(js.slice(js.indexOf('function bunnyAnsicht'), js.indexOf('async function geschuetzteAnsicht'))) &&
    !js.includes('download: true'));
} catch(e) {
  schlecht++; console.error('FEHLER Testablauf:',e);
} finally {
  if(server) await new Promise(done=>server.close(done));
  try { rmSync(root,{recursive:true,force:true}); } catch(e) { if(!['EPERM','EBUSY'].includes(e.code)) throw e; }
}
console.log('Schutz: '+ok+' bestanden, '+schlecht+' fehlgeschlagen');
process.exitCode=schlecht?1:0;
