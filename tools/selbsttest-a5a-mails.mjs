// Scheibe A5a: Plattformname und Logo (CID) in allen neun Mail-Vorlagen.
import './test-sprache.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ordner = mkdtempSync(join(tmpdir(), 'schulung-a5a-'));
process.env.DB_DATEI = join(ordner, 'test.db');
let bestanden = 0, fehlgeschlagen = 0;
const pruefe = (name, ok) => { ok ? bestanden++ : fehlgeschlagen++; console.log((ok ? 'OK     ' : 'FEHLER ') + name); };

// Zwei verschiedene "Logo"-Dateien (Inhalt beliebig für Base64-Vergleich)
// (Seit A5-Haertung muss die Datei eine PNG-Signatur tragen; der Rest ist beliebig.)
const PNG_KOPF = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const LOGO1 = Buffer.concat([PNG_KOPF, Buffer.from('fake-logo-version-1-TestAkademie-alpha')]);
const LOGO2 = Buffer.concat([PNG_KOPF, Buffer.from('fake-logo-version-2-TestAkademie-beta-')]);
const BASE = 'https://test.a5a.hu';
const NAME = 'TestAkademie';
const ADMIN_MAIL = 'admin@test.a5a.hu';
const logoPfad = join(ordner, 'logo.png');

try {
  // ------------------------------------------------------------------ (a) resendMailer
  const { resendMailer } = await import('../mail.mjs');

  let letzterBody = null;
  const fetchFake = async (_url, opts) => { letzterBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) }; };
  const mailerOhne = resendMailer({ apiKey: null, from: 'x@y.com', fetchFn: fetchFake });
  pruefe('a1 kein API-Schlüssel → null', mailerOhne === null);

  const mailerMit = resendMailer({ apiKey: 'testapikey', from: 'x@y.com', fetchFn: fetchFake });
  await mailerMit({ to: 'z@w.com', subject: 'S', html: '<p>H</p>', text: 'T' });
  pruefe('a2 ohne anhaenge: kein attachments-Feld', !!(letzterBody && !('attachments' in letzterBody)));

  const logoB64 = LOGO1.toString('base64');
  letzterBody = null;
  await mailerMit({ to: 'z@w.com', subject: 'S', html: '<p>H</p>', text: 'T',
    anhaenge: [{ dateiname: 'logo.png', inhaltBase64: logoB64, typ: 'image/png', contentId: 'marke-logo' }] });
  pruefe('a3 mit anhaenge: attachments-Feld vorhanden', !!(letzterBody && 'attachments' in letzterBody));
  pruefe('a4 attachments[0].content_id = marke-logo', letzterBody?.attachments?.[0]?.content_id === 'marke-logo');
  pruefe('a5 attachments[0].content_type = image/png', letzterBody?.attachments?.[0]?.content_type === 'image/png');
  pruefe('a6 attachments[0].filename = logo.png', letzterBody?.attachments?.[0]?.filename === 'logo.png');
  pruefe('a7 attachments[0].content = Base64 Logoinhalt', letzterBody?.attachments?.[0]?.content === logoB64);

  // ------------------------------------------------------------------ DB + mailDienst
  const { db } = await import('../db.mjs');
  const { mailDienst, kaufVormerken } = await import('../mail.mjs');
  const { setzePlattform } = await import('../marke.mjs');

  setzePlattform(NAME);
  writeFileSync(logoPfad, LOGO1);

  const sendungen = [];
  const attrappe = async mail => { sendungen.push(mail); return true; };
  const dienst = mailDienst({ mailer: attrappe, base: BASE, logoPfad, verkaufsmeldungMail: ADMIN_MAIL });

  const hatImg = m => !!(m?.html?.includes('<img src="cid:marke-logo"'));
  const hatAnhang = m => Array.isArray(m?.anhaenge) && m.anhaenge.some(a => a.contentId === 'marke-logo');
  const hatName = m => !!(m?.html?.includes(NAME));

  const jetzt_iso = new Date().toISOString();
  const jetzt_ms = Date.now();

  // ------------------------------------------------------------------ (b) Vorlage 1: nachricht() — reset
  sendungen.length = 0;
  dienst.versandStarten('reset', { email: 'k1@a5a.hu' }, { link: BASE + '/r/T1' });
  await new Promise(r => setTimeout(r, 0));
  pruefe('b1 Reset: HTML enthält Plattformname', hatName(sendungen[0]));
  pruefe('b2 Reset: HTML enthält Logo-img', hatImg(sendungen[0]));
  pruefe('b3 Reset: anhaenge mit marke-logo', hatAnhang(sendungen[0]));

  // ------------------------------------------------------------------ (b) Vorlage 1: nachricht() — geaendert
  sendungen.length = 0;
  dienst.versandStarten('geaendert', { email: 'k2@a5a.hu' }, {});
  await new Promise(r => setTimeout(r, 0));
  pruefe('b4 Geändert: HTML enthält Plattformname', hatName(sendungen[0]));
  pruefe('b5 Geändert: HTML enthält Logo-img', hatImg(sendungen[0]));

  // ------------------------------------------------------------------ (b) Vorlage 2: kaufNachricht() — ausgangSenden
  const b2b = db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt) VALUES(?,?,?,?)").run('kauf@a5a.hu','h',jetzt_iso,jetzt_ms).lastInsertRowid;
  const b2k = db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,990000,'huf','veroeffentlicht',?,?)").run('A5a Kauf','',jetzt_iso,jetzt_iso).lastInsertRowid;
  const b2best = db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES(?,?,?,990000,'huf','bezahlt','einmal',?,?)").run('cs_a5a_kauf',b2b,b2k,jetzt_iso,jetzt_iso).lastInsertRowid;
  kaufVormerken(b2b, b2best, 'kauf');
  sendungen.length = 0;
  await dienst.ausgangSenden();
  pruefe('b6 Kaufmail: HTML enthält Plattformname', hatName(sendungen[0]));
  pruefe('b7 Kaufmail: HTML enthält Logo-img', hatImg(sendungen[0]));
  pruefe('b8 Kaufmail: anhaenge mit marke-logo', hatAnhang(sendungen[0]));

  // ------------------------------------------------------------------ (b) Vorlage 3: zugangNachricht()
  const b3b = db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt) VALUES(?,?,?,?)").run('zug@a5a.hu','h',jetzt_iso,jetzt_ms).lastInsertRowid;
  const b3k = db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,990000,'huf','veroeffentlicht',?,?)").run('A5a Zugang','',jetzt_iso,jetzt_iso).lastInsertRowid;
  db.prepare("INSERT INTO zugang_mail_ausgang(benutzer_id,kurs_id,status,versuche,erstellt,geaendert) VALUES(?,?,'offen',0,?,?)").run(b3b,b3k,jetzt_ms,jetzt_ms);
  sendungen.length = 0;
  await dienst.zugangAusgangSenden();
  pruefe('b9 Zugang: HTML enthält Plattformname', hatName(sendungen[0]));
  pruefe('b10 Zugang: HTML enthält Logo-img', hatImg(sendungen[0]));
  pruefe('b11 Zugang: anhaenge mit marke-logo', hatAnhang(sendungen[0]));

  // ------------------------------------------------------------------ (b) Vorlage 4: kontoMailSenden()
  sendungen.length = 0;
  await dienst.kontoMailSenden('konto@a5a.hu', 'konto_geloescht');
  pruefe('b12 Konto: HTML enthält Plattformname', hatName(sendungen[0]));
  pruefe('b13 Konto: HTML enthält Logo-img', hatImg(sendungen[0]));
  pruefe('b14 Konto: anhaenge mit marke-logo', hatAnhang(sendungen[0]));

  // ------------------------------------------------------------------ (b) Vorlage 5: aboKuendigungAusgangSenden
  const b5b = db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt) VALUES(?,?,?,?)").run('kund@a5a.hu','h',jetzt_iso,jetzt_ms).lastInsertRowid;
  const b5k = db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,990000,'huf','veroeffentlicht',?,?)").run('A5a Abo','',jetzt_iso,jetzt_iso).lastInsertRowid;
  const b5abo = db.prepare("INSERT INTO abos(stripe_abo,benutzer_id,kurs_id,status,erstellt,geaendert) VALUES(?,?,?,'gekuendigt',?,?)").run('sub_a5a_b5',b5b,b5k,jetzt_iso,jetzt_iso).lastInsertRowid;
  db.prepare("INSERT INTO abo_kuendigung_mail(abo_id,benutzer_id,kurs_id,erfasst,ende,status,versuche) VALUES(?,?,?,?,?,'offen',0)").run(b5abo,b5b,b5k,jetzt_ms,jetzt_ms+30*24*3600000);
  sendungen.length = 0;
  await dienst.aboKuendigungAusgangSenden();
  pruefe('b15 Kündigung: HTML enthält Plattformname', hatName(sendungen[0]));
  pruefe('b16 Kündigung: HTML enthält Logo-img', hatImg(sendungen[0]));
  pruefe('b17 Kündigung: anhaenge mit marke-logo', hatAnhang(sendungen[0]));

  // ------------------------------------------------------------------ (b) Vorlage 6: meldungNachricht()
  const b6k = db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,990000,'huf','veroeffentlicht',?,?)").run('A5a Meldung','',jetzt_iso,jetzt_iso).lastInsertRowid;
  const b6e = db.prepare("INSERT INTO ereignisse(zeit,typ,kurs_id,kurs_titel,betrag,waehrung,email,status,quelle_id) VALUES(?,?,?,?,?,?,?,?,?)").run(jetzt_ms,'gekauft',b6k,'A5a Meldung',990000,'huf','mel@a5a.hu','bezahlt','evt_a5a_mel').lastInsertRowid;
  db.prepare("INSERT INTO meldung_ausgang(ereignis_id,geaendert) VALUES(?,?)").run(b6e,jetzt_ms);
  sendungen.length = 0;
  await dienst.meldungAusgangSenden();
  pruefe('b18 Meldung: HTML enthält Plattformname', hatName(sendungen[0]));
  pruefe('b19 Meldung: HTML enthält Logo-img', hatImg(sendungen[0]));
  pruefe('b20 Meldung: anhaenge mit marke-logo', hatAnhang(sendungen[0]));

  // Vorlage 7 (demoSammelSenden) nur in Demo-Modus mit überschrittener Stundenlimite auslösbar
  // → wird im Bericht als nicht direkt testbar aufgeführt.

  // ------------------------------------------------------------------ (b) Vorlage 8: ellallasAusgangSenden
  const b8b = db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt) VALUES(?,?,?,?)").run('ell@a5a.hu','h',jetzt_iso,jetzt_ms).lastInsertRowid;
  const b8k = db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,990000,'huf','veroeffentlicht',?,?)").run('A5a Widerruf','',jetzt_iso,jetzt_iso).lastInsertRowid;
  const b8best = db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES(?,?,?,990000,'huf','bezahlt','einmal',?,?)").run('cs_a5a_ell',b8b,b8k,jetzt_iso,jetzt_iso).lastInsertRowid;
  db.prepare("INSERT INTO ellallas(bestellung_id,zeit,ergebnis,aktualisiert) VALUES(?,?,?,?)").run(b8best,jetzt_iso,'erstattung',jetzt_iso);
  db.prepare("INSERT INTO ellallas_mail(bestellung_id,empfaenger,status,versuche) VALUES(?,'kunde','offen',0)").run(b8best);
  sendungen.length = 0;
  await dienst.ellallasAusgangSenden();
  pruefe('b21 Widerruf: HTML enthält Plattformname', hatName(sendungen[0]));
  pruefe('b22 Widerruf: HTML enthält Logo-img', hatImg(sendungen[0]));
  pruefe('b23 Widerruf: anhaenge mit marke-logo', hatAnhang(sendungen[0]));

  // ------------------------------------------------------------------ (b) Vorlage 9: aboErstattungAusgangSenden
  const b9b = db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt) VALUES(?,?,?,?)").run('erst@a5a.hu','h',jetzt_iso,jetzt_ms).lastInsertRowid;
  const b9k = db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,990000,'huf','veroeffentlicht',?,?)").run('A5a Erstattung','',jetzt_iso,jetzt_iso).lastInsertRowid;
  const b9best = db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES(?,?,?,990000,'huf','bezahlt','abo',?,?)").run('cs_a5a_erst',b9b,b9k,jetzt_iso,jetzt_iso).lastInsertRowid;
  db.prepare("INSERT INTO abo_erstattung_mail(bestell_id,refund_id,betrag,status,versuche) VALUES(?,?,990000,'offen',0)").run(b9best,'re_a5a_test');
  sendungen.length = 0;
  await dienst.aboErstattungAusgangSenden();
  pruefe('b24 Erstattung: HTML enthält Plattformname', hatName(sendungen[0]));
  pruefe('b25 Erstattung: HTML enthält Logo-img', hatImg(sendungen[0]));
  pruefe('b26 Erstattung: anhaenge mit marke-logo', hatAnhang(sendungen[0]));

  // ------------------------------------------------------------------ (c) Logo-Wechsel
  writeFileSync(logoPfad, LOGO2);
  sendungen.length = 0;
  dienst.versandStarten('reset', { email: 'c@a5a.hu' }, { link: BASE + '/r/TC' });
  await new Promise(r => setTimeout(r, 0));
  const b64_1 = LOGO1.toString('base64');
  const b64_2 = LOGO2.toString('base64');
  const anhangNachWechsel = sendungen[0]?.anhaenge?.[0]?.inhaltBase64;
  pruefe('c1 Logo-Wechsel: neuer Base64, nicht der alte', anhangNachWechsel === b64_2 && anhangNachWechsel !== b64_1);

  // ------------------------------------------------------------------ (d) Ohne Logodatei
  const dienstOhneLogo = mailDienst({ mailer: attrappe, base: BASE,
    logoPfad: join(ordner, 'kein-logo.png'), verkaufsmeldungMail: ADMIN_MAIL });
  sendungen.length = 0;
  dienstOhneLogo.versandStarten('reset', { email: 'd@a5a.hu' }, { link: BASE + '/r/TD' });
  await new Promise(r => setTimeout(r, 0));
  pruefe('d1 ohne Logo: kein <img src="cid:"', !sendungen[0]?.html?.includes('<img src="cid:'));
  pruefe('d2 ohne Logo: kein marke-logo-Anhang', !hatAnhang(sendungen[0]));
  pruefe('d3 ohne Logo: Plattformname als Text vorhanden', hatName(sendungen[0]));
  pruefe('d4 ohne Logo: Mail trotzdem gesendet', !!(sendungen[0]?.to));

  // ------------------------------------------------------------------ (e) Plattformname mit Umlauten
  const NAME_U = 'Sörtész Plattform';
  setzePlattform(NAME_U);
  writeFileSync(logoPfad, LOGO1);
  const dienstUmlaut = mailDienst({ mailer: attrappe, base: BASE, logoPfad, verkaufsmeldungMail: ADMIN_MAIL });
  sendungen.length = 0;
  dienstUmlaut.versandStarten('reset', { email: 'e@a5a.hu' }, { link: BASE + '/r/TE' });
  await new Promise(r => setTimeout(r, 0));
  pruefe('e1 Umlaut-Name im HTML enthalten', !!(sendungen[0]?.html?.includes(NAME_U)));
  pruefe('e2 Umlaut-Name in alt-Attribut', !!(sendungen[0]?.html?.includes('alt="' + NAME_U + '"')));

  // ------------------------------------------------------------------ (f) Haertung: ein defektes Logo darf den Mailversand nie behindern (Codex/Opus A5)
  setzePlattform(NAME);
  const ohneLogoPruefen = async (kennung, pfad) => {
    const d = mailDienst({ mailer: attrappe, base: BASE, logoPfad: pfad, verkaufsmeldungMail: ADMIN_MAIL });
    sendungen.length = 0;
    d.versandStarten('reset', { email: kennung + '@a5a.hu' }, { link: BASE + '/r/' + kennung });
    await new Promise(r => setTimeout(r, 0));
    pruefe(kennung + ': Mail trotzdem gesendet', !!sendungen[0]?.to);
    pruefe(kennung + ': kein Logo-img und kein Anhang', !sendungen[0]?.html?.includes('<img src="cid:') && !hatAnhang(sendungen[0]));
    pruefe(kennung + ': Plattformname als Text', hatName(sendungen[0]));
  };
  const verzeichnis = join(ordner, 'logo-ist-verzeichnis'); mkdirSync(verzeichnis);
  await ohneLogoPruefen('f1verzeichnis', verzeichnis);
  const keinPng = join(ordner, 'kein.png'); writeFileSync(keinPng, Buffer.from('das ist keine PNG-Datei, nur Text'));
  await ohneLogoPruefen('f2keinpng', keinPng);
  const { LOGO_MAX_BYTES } = await import('../logo-png.mjs');
  const zuGross = join(ordner, 'gross.png'); writeFileSync(zuGross, Buffer.concat([PNG_KOPF, Buffer.alloc(LOGO_MAX_BYTES + 1 - PNG_KOPF.length, 1)]));   // genau LOGO_MAX_BYTES + 1
  await ohneLogoPruefen('f3zugross', zuGross);
  const genauMax = join(ordner, 'genau-max.png'); writeFileSync(genauMax, Buffer.concat([PNG_KOPF, Buffer.alloc(LOGO_MAX_BYTES - PNG_KOPF.length, 1)]));   // genau LOGO_MAX_BYTES: erlaubt
  const dMax = mailDienst({ mailer: attrappe, base: BASE, logoPfad: genauMax, verkaufsmeldungMail: ADMIN_MAIL });
  sendungen.length = 0; dMax.versandStarten('reset', { email: 'f3max@a5a.hu' }, { link: BASE + '/r/f3max' }); await new Promise(r => setTimeout(r, 0));
  pruefe('f3max: Logo mit genau LOGO_MAX_BYTES wird eingebettet', hatImg(sendungen[0]) && hatAnhang(sendungen[0]));
  const leer = join(ordner, 'leer.png'); writeFileSync(leer, Buffer.alloc(0));
  await ohneLogoPruefen('f4leer', leer);
  const echtesLogo = join(ordner, 'echt.png'); writeFileSync(echtesLogo, LOGO1);
  const link = join(ordner, 'link.png'); let linkOk = true;
  try { symlinkSync(echtesLogo, link); } catch { linkOk = false; }
  if (linkOk) await ohneLogoPruefen('f5symlink', link);
  else pruefe('f5symlink: UEBERSPRUNGEN (Symlink hier nicht anlegbar), kein Fehler', true);
  // Positivprobe: gueltiges PNG wird weiter eingebettet
  const dg = mailDienst({ mailer: attrappe, base: BASE, logoPfad: echtesLogo, verkaufsmeldungMail: ADMIN_MAIL });
  sendungen.length = 0;
  dg.versandStarten('reset', { email: 'f6gut@a5a.hu' }, { link: BASE + '/r/f6' });
  await new Promise(r => setTimeout(r, 0));
  pruefe('f6 gueltiges PNG: img und Anhang vorhanden', hatImg(sendungen[0]) && hatAnhang(sendungen[0]));
  pruefe('f7 img ohne ungueltiges height="auto"-Attribut', !sendungen[0]?.html?.includes('height="auto"'));

} catch (e) {
  console.error('UNERWARTETER FEHLER:', e.message);
  fehlgeschlagen++;
} finally {
  try { rmSync(ordner, { recursive: true, force: true }); } catch {}
}

const gesamt = bestanden + fehlgeschlagen;
console.log(`\na5a-mails: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen (von ${gesamt})`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
