import './test-sprache.mjs';
// Produktreife Block 2 (12.11.2026): Marke einstellbar (PLATTFORM_NAME). Aufruf (im Ordner plattform): node tools/selbsttest-marke.mjs
// Teil A (im Prozess): Konfig-Pruefung von PLATTFORM_NAME (ohne Wert in Fehlern), Grammatik (HU a/az, DE der/von), alle Texte DE/EN/HU
//         mit eigenem Namen frei von "Musterakademie", Standard unveraendert; Kaufmail, Bestaetigungs- und Passwortmail ueber Mail-Attrappe.
// Teil B: zwei EIGENE Instanzen als Kindprozesse (Port 4661 mit PLATTFORM_NAME='Beispiel-Akademie', 4662 ohne; DEMO_MODUS aus, je eigene
//         Temp-Datenbank, Stripe-Attrappe, keine Mails, kein Netz) und HTTP-Pruefung von Seiten, Client-Dateien, API-Texten, Logo, Downloads.
// Teil C: echter Chrome (headless, playwright-core aus C:\Users\diaco\Projekte\browser-werkzeug): Kunden- und Admin-Seiten in DE/EN/HU
//         (sichtbarer Text, Titel, Logo-Bild und Alt-Text). Fehlt Chrome/playwright-core, wird Teil C sichtbar als UEBERSPRUNGEN gemeldet.
// Beendet nur die eigenen Kindprozesse und den eigenen Browser.
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const PLATTFORM = resolve(HIER, '..');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = 'Beispiel-Akademie';
const MUSTER = /musterakademie/i;
const BASIS_ENV = { STRIPE_SECRET_KEY: ['sk', 'test', 'platzhalter_nur_fuer_tests'].join('_'), STRIPE_WEBHOOK_SECRET: ['whsec', 'platzhalter_nur_fuer_tests'].join('_') };

// ---------------------------------------------------------------------------------------------------------------------------
// Kindprozess: node tools/selbsttest-marke.mjs --server <port>   (PLATTFORM_NAME aus der Umgebung, ueber ladeKonfig wie server.mjs)
// ---------------------------------------------------------------------------------------------------------------------------
if (process.argv[2] === '--server') {
  const port = Number(process.argv[3]);
  const stripe = { customers: { create: async () => ({ id: 'cus_mk' }), update: async () => ({}) },
    checkout: { sessions: { create: async () => ({ id: 'cs_mk', url: 'https://checkout.stripe.com/test' }), retrieve: async () => ({ payment_intent: 'pi_mk' }), list: async () => ({ data: [] }), expire: async () => ({}) } },
    paymentIntents: { retrieve: async (id) => ({ id }) }, refunds: { create: async () => ({ id: 're_mk' }), list: async () => ({ data: [] }) },
    billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/test' }) } }, webhooks: { constructEvent: () => ({}) } };
  const { ladeKonfig } = await import('../konfig.mjs');
  const konfig = ladeKonfig({ ...BASIS_ENV, PLATTFORM_NAME: process.env.PLATTFORM_NAME || '' });
  const { db } = await import('../db.mjs');
  const { sitzungErzeugen } = await import('../auth.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const jetzt = new Date().toISOString();
  db.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES (?,?,?,'eur','veroeffentlicht',?,?)")
    .run('Souverän präsentieren', 'Vortraege klar aufbauen und ruhig auftreten.', 24900, jetzt, jetzt);
  const kunde = db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt,rolle) VALUES(?,?,?,?,'kunde')").run('kunde-marke@example.com', 'nur-fuer-selbsttest', jetzt, Date.now()).lastInsertRowid;
  const admin = db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt,rolle) VALUES(?,?,?,?,'admin')").run('admin-marke@example.com', 'nur-fuer-selbsttest', jetzt, Date.now()).lastInsertRowid;
  const app = erstelleServer({ stripe, webhookSecret: 'x', base: 'http://127.0.0.1:' + port, mailer: async () => true, dateiOrdner: join(dirname(process.env.DB_DATEI), 'dateien'),
    ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: false, trustProxy: 0, plattformName: konfig.plattformName,
    anbieter: { ANBIETER_NAME: 'Beispiel Akademie GmbH', ANBIETER_EMAIL: 'kontakt@example.com' } });
  app.listen(port, '127.0.0.1', () => console.log('BEREIT ' + JSON.stringify({ kunde: sitzungErzeugen(kunde), admin: sitzungErzeugen(admin) })));
} else {
// ---------------------------------------------------------------------------------------------------------------------------
// Pruefer
// ---------------------------------------------------------------------------------------------------------------------------
let ok = 0, fail = 0, uebersprungen = 0;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' | ' + String(d).slice(0, 300))); };
const SPRACHEN = ['de', 'en', 'hu'];
const kinder = [], dirs = [];
const fund = (s) => { const m = MUSTER.exec(String(s)); return m ? '…' + String(s).slice(Math.max(0, m.index - 60), m.index + 40) + '…' : ''; };
// Jeder Teil laeuft fuer sich: ein Fehler in einem Teil (z. B. fehlendes Modul im unveraenderten Stand) bricht die anderen nicht ab (Gegenprobe).
const teil = async (name, fn) => { try { await fn(); } catch (e) { check('Teil ' + name + ' lief durch', false, e.message); } };
let marke = null, HU = null, mitSprache = null, texteFuer = null;
try {
  // ---- Teil A: Konfiguration ----
  await teil('A-Konfig', async () => {
  const { ladeKonfig } = await import('../konfig.mjs');
  check('PLATTFORM_NAME fehlt: Standard "Musterakademie"', ladeKonfig({ ...BASIS_ENV }).plattformName === 'Musterakademie');
  check('PLATTFORM_NAME "Beispiel-Akademie" wird uebernommen', ladeKonfig({ ...BASIS_ENV, PLATTFORM_NAME: NAME }).plattformName === NAME);
  check('PLATTFORM_NAME mit Umlauten/Akzenten (60 Zeichen) erlaubt', ladeKonfig({ ...BASIS_ENV, PLATTFORM_NAME: 'Ő'.repeat(60) }).plattformName.length === 60);
  for (const falsch of ['<b>X</b>', 'A'.repeat(61), 'Name {plattform}', 'Mein "Kurs"', "O'Neil", 'Zeile\u0007Umbruch', '---', 'A & B', 'Doppel  Leer']) {
    let gemeldet = '';
    try { ladeKonfig({ ...BASIS_ENV, PLATTFORM_NAME: falsch }); } catch (e) { gemeldet = e.message; }
    check('PLATTFORM_NAME abgelehnt ohne Wert in der Meldung: ' + JSON.stringify(falsch).slice(0, 30), gemeldet.includes('PLATTFORM_NAME') && !gemeldet.includes(falsch), gemeldet);
  }
  const serverQ = readFileSync(join(PLATTFORM, 'server.mjs'), 'utf8');
  check('server.mjs gibt konfig.plattformName an erstelleServer weiter', serverQ.includes('plattformName:konfig.plattformName'));
  const umgebung = readFileSync(join(PLATTFORM, 'docs', 'UMGEBUNG.md'), 'utf8');
  check('docs/UMGEBUNG.md beschreibt PLATTFORM_NAME', umgebung.includes('`PLATTFORM_NAME`'));
  });

  // ---- Teil A: Texte und Grammatik ----
  process.env.DB_DATEI = join(mkdtempSync(join(tmpdir(), 'marke-a-')), 'a.db');
  dirs.push(dirname(process.env.DB_DATEI));
  ({ HU, mitSprache, texteFuer } = await import('../texte.mjs'));
  await teil('A-Texte', async () => {
  marke = await import('../marke.mjs');
  const roh = Object.fromEntries(SPRACHEN.map((l) => [l, JSON.parse(readFileSync(join(PLATTFORM, 'texte', l + '.json'), 'utf8').replace(/^\uFEFF/, ''))]));
  const mitPlatzhalter = Object.keys(roh.hu).filter((k) => roh.hu[k].includes('{plattform}'));
  check('texte/*.json: kein festes "Musterakademie" mehr, Platzhalter {plattform} in DE/EN/HU an denselben Stellen (' + mitPlatzhalter.length + ')',
    SPRACHEN.every((l) => !MUSTER.test(JSON.stringify(roh[l])) && mitPlatzhalter.every((k) => roh[l][k].includes('{plattform}'))) && mitPlatzhalter.length >= 12);
  marke.setzePlattform(NAME);
  for (const l of SPRACHEN) {
    mitSprache(l, () => {
      const alle = { ...HU }, fuer = texteFuer(l);
      const schlecht = Object.entries(alle).filter(([, v]) => MUSTER.test(v) || String(v).includes('{plattform}')).map(([k]) => k);
      check(`[${l}] alle Texte mit eigenem Namen ohne "Musterakademie" und ohne offenen Platzhalter`, schlecht.length === 0, schlecht.join(','));
      check(`[${l}] texteFuer() ersetzt ebenso`, Object.values(fuer).every((v) => !MUSTER.test(v)) && mitPlatzhalter.every((k) => fuer[k].includes(NAME)));
      check(`[${l}] Markenstellen nennen "${NAME}" (${mitPlatzhalter.length} Schluessel)`, mitPlatzhalter.every((k) => HU[k].includes(NAME)), mitPlatzhalter.filter((k) => !HU[k].includes(NAME)).join(','));
    });
  }
  const grammatik = [
    ['hu', 'Okos Akadémia', 'mail_kauf_signatur', 'Az Okos Akadémia csapata'],
    ['hu', 'Okos Akadémia', 'mail_bestaetigung_betreff', 'Üdv az Okos Akadémia előadásokon! Erősítsd meg az e-mail-címedet'],
    ['hu', '5 Elem Klub', 'mail_geaendert_text', 'Az 5 Elem Klub-fiókod jelszava megváltozott.'],
    ['hu', NAME, 'mail_meldung_einleitung', 'Új esemény történt a ' + NAME + ' előadásplatformján.'],
    ['de', 'Kurswerk', 'mail_kauf_signatur', 'Das Team von Kurswerk'],
    ['de', 'Kurswerk', 'k_logo_alt', 'Logo von Kurswerk'],
    ['de', NAME, 'mail_bestaetigung_willkommen', 'Danke für deine Registrierung auf der Kursplattform der ' + NAME + '. Schön, dass du da bist!'],
    ['en', 'Kurswerk', 'mail_bestaetigung_signatur', 'The Kurswerk team'],
  ];
  for (const [l, n, k, soll] of grammatik) {
    marke.setzePlattform(n);
    const ist = mitSprache(l, () => HU[k]);
    check(`[${l}] Grammatik mit "${n}": ${k} = "${soll}"`, ist === soll, ist);
  }
  marke.setzePlattform(null);
  const standard = { hu: ['mail_bestaetigung_betreff', 'Üdv a Musterakademie előadásokon! Erősítsd meg az e-mail-címedet'], de: ['k_logo_alt', 'Logo der Musterakademie'], en: ['mail_kauf_signatur', 'The Musterakademie team'] };
  for (const [l, [k, soll]] of Object.entries(standard)) check(`[${l}] Standard ohne PLATTFORM_NAME exakt wie bisher: "${soll}"`, mitSprache(l, () => HU[k]) === soll, mitSprache(l, () => HU[k]));
  check('Standard: Logo-Pfade unveraendert /img/muster-logo*.svg', JSON.stringify(marke.logoPfade()) === JSON.stringify({ quer: '/img/muster-logo.svg', vertikal: '/img/muster-logo-vertikal.svg' }));

  });
  // ---- Teil A: Mails ueber Attrappe (Kaufmail, Bestaetigung, Passwort geaendert) ----
  await teil('A-Mails', async () => {
  marke.setzePlattform(NAME);
  const { db } = await import('../db.mjs');
  const { mailDienst, kaufVormerken } = await import('../mail.mjs');
  const sendungen = [];
  const dienst = mailDienst({ mailer: async (m) => { sendungen.push(m); return true; }, base: 'http://localhost:4663', supportMail: 'hilfe@example.com', anbieter: { ANBIETER_NAME: 'Beispiel Akademie GmbH' } });
  const zeit = new Date().toISOString();
  const kurs = db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES('Kurs Marke','',990000,'huf','veroeffentlicht',?,?)").run(zeit, zeit).lastInsertRowid;
  for (const l of SPRACHEN) {
    const b = db.prepare('INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt,sprache) VALUES(?,?,?,?,?)').run('marke-' + l + '@example.com', 'x', zeit, Date.now(), l).lastInsertRowid;
    const o = db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert,sprache) VALUES(?,?,?,990000,'huf','bezahlt','einmal',?,?,?)").run('cs_marke_' + l, b, kurs, zeit, zeit, l).lastInsertRowid;
    kaufVormerken(b, o, 'kauf');
  }
  await dienst.ausgangSenden();
  for (const l of SPRACHEN) {
    const m = sendungen.find((x) => x.to === 'marke-' + l + '@example.com');
    const sig = mitSprache(l, () => HU.mail_kauf_signatur);
    check(`[${l}] Kaufmail: Betreff, Text, HTML und Signatur ohne "Musterakademie", Signatur "${sig}"`, !!m && !MUSTER.test(m.subject + m.text + m.html) && m.text.includes(sig) && sig.includes(NAME), m ? fund(m.subject + m.text + m.html) : 'keine Mail');
    for (const typ of ['bestaetigung', 'geaendert']) {
      const vorher = sendungen.length;
      mitSprache(l, () => dienst.versandStarten(typ, { email: 'konto-' + l + '@example.com' }, { link: 'http://localhost:4663/#/x' }));
      for (let i = 0; i < 40 && sendungen.length === vorher; i++) await warte(25);
      const k = sendungen[vorher];
      const erwartet = typ === 'bestaetigung' ? mitSprache(l, () => HU.mail_bestaetigung_betreff) : mitSprache(l, () => HU.mail_geaendert_text);
      check(`[${l}] Kontomail "${typ}" ohne "Musterakademie", mit "${NAME}"`, !!k && !MUSTER.test(k.subject + k.text + k.html) && (k.subject + k.text).includes(erwartet) && erwartet.includes(NAME), k ? fund(k.subject + k.text + k.html) : 'keine Mail');
    }
  }
  marke.setzePlattform(null);
  });

  // ---- Teil B: zwei Instanzen ----
  let EIGEN, STD, tokE, tokS;
  await teil('B-HTTP', async () => {
  const starte = (port, name) => {
    const d = mkdtempSync(join(tmpdir(), 'marke-' + port + '-')); dirs.push(d);
    const env = { ...process.env, DB_DATEI: join(d, 'test.db'), TEXT_SPRACHE: 'de', PLATTFORM_NAME: name };
    const k = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), '--server', String(port)], { env, cwd: PLATTFORM, stdio: ['ignore', 'pipe', 'pipe'] });
    let aus = '', err = ''; k.stdout.on('data', (c) => { aus += c; }); k.stderr.on('data', (c) => { err += c; }); kinder.push(k);
    k.bereit = async () => { for (let i = 0; i < 240; i++) {   /* 60 s: auf dem Omen brauchen zwei parallel gestartete Server oft > 20 s (F-218) */ const m = /BEREIT (\{.*\})/.exec(aus); if (m) return JSON.parse(m[1]); await warte(250); } return null; };
    k.fehlertext = () => err + aus;
    return k;
  };
  EIGEN = 'http://127.0.0.1:4661'; STD = 'http://127.0.0.1:4662';
  const ke = starte(4661, NAME), ks = starte(4662, '');
  tokE = await ke.bereit(); tokS = await ks.bereit();
  check('Instanz mit PLATTFORM_NAME (4661) gestartet', !!tokE, ke.fehlertext());
  check('Instanz ohne PLATTFORM_NAME (4662) gestartet', !!tokS, ks.fehlertext());
  const holen = async (b, pfad, l, kopf = {}) => { const r = await fetch(b + pfad, { redirect: 'manual', headers: { Cookie: 'lang=' + l, Accept: 'text/html,application/json', ...kopf } }); return { s: r.status, typ: r.headers.get('content-type') || '', cd: r.headers.get('content-disposition') || '', text: await r.text() }; };
  const PFADE = ['/', '/index.html', '/admin/', '/api/texte', '/api/anbieter', '/api/kurse', '/api/ich', '/agent/openapi.json', '/kunde.js', '/preis.js', '/admin/admin.js', '/kunde.css', '/admin/admin.css',
    '/fonts/fonts.css', '/favicon.svg', '/jogi/impresszum/', '/jogi/adatvedelem/', '/jogi/reszveteli-feltetelek/', '/jogi/recht.css', '/gibt-es-nicht', '/api/gibt-es-nicht', '/img/marke-logo.svg', '/img/marke-logo-vertikal.svg'];
  for (const l of SPRACHEN) {
    const schlecht = [];
    for (const p of PFADE) { const r = await holen(EIGEN, p, l); if (MUSTER.test(r.text)) schlecht.push(p + ' ' + fund(r.text)); }
    const angemeldet = [];
    for (const p of ['/api/ich', '/api/konto', '/api/konto/auskunft', '/api/eloadasaim']) {
      const r = await holen(EIGEN, p, l, { Cookie: 'lang=' + l + '; sitzung=' + tokE.kunde });
      if (MUSTER.test(r.text + r.cd)) angemeldet.push(p + ' ' + fund(r.text + r.cd));
    }
    for (const p of ['/admin/', '/api/admin/kurse', '/api/admin/ereignisse/export?format=csv']) {
      const r = await holen(EIGEN, p, l, { Cookie: 'lang=' + l + '; sitzung=' + tokE.admin });
      if (MUSTER.test(r.text + r.cd)) angemeldet.push(p + ' ' + fund(r.text + r.cd));
    }
    check(`[${l}] eigener Name: ${PFADE.length} Seiten/Dateien/APIs ohne "Musterakademie"`, schlecht.length === 0, schlecht.join(' || '));
    check(`[${l}] eigener Name: angemeldete Kunden-/Admin-APIs und Downloads ohne "Musterakademie"`, angemeldet.length === 0, angemeldet.join(' || '));
    const t = JSON.parse((await holen(EIGEN, '/api/texte', l)).text);
    check(`[${l}] /api/texte meldet _plattform "${NAME}", Textlogo-Pfade, Alt-Text mit Namen`, t._plattform === NAME && t._logo === '/img/marke-logo.svg' && t._logo_vertikal === '/img/marke-logo-vertikal.svg' && t.k_logo_alt.includes(NAME) && t.a_logo_alt.includes(NAME), JSON.stringify([t._plattform, t._logo, t.k_logo_alt]));
    const s = JSON.parse((await holen(STD, '/api/texte', l)).text);
    check(`[${l}] Standard: /api/texte wie bisher (Musterakademie, /img/muster-logo.svg, Alt "${s.k_logo_alt}")`, s._plattform === 'Musterakademie' && s._logo === '/img/muster-logo.svg' && s._logo_vertikal === '/img/muster-logo-vertikal.svg' && /Musterakademie/.test(s.k_logo_alt) && !JSON.stringify(s).includes('{plattform}'), JSON.stringify([s._plattform, s._logo, s.k_logo_alt]));
  }
  const logo = await holen(EIGEN, '/img/marke-logo.svg', 'de'), logoV = await holen(EIGEN, '/img/marke-logo-vertikal.svg', 'de');
  check('Textlogo: SVG mit Namen, Anfangsbuchstabe, Alt/aria-label aus dem Namen', logo.s === 200 && /image\/svg\+xml/.test(logo.typ) && logo.text.includes('aria-label="' + NAME + '"') && logo.text.includes('>' + NAME + '</text>') && logo.text.includes('>B</text>') && logoV.s === 200 && logoV.text.includes('#FFFFFF'), logo.s + ' ' + logo.typ);
  const ausk = await holen(EIGEN, '/api/konto/auskunft', 'de', { Cookie: 'sitzung=' + tokE.kunde });
  check('Download-Dateiname aus dem Namen: beispiel-akademie-adataim.json', ausk.cd.includes('filename="beispiel-akademie-adataim.json"'), ausk.s + ' ' + ausk.cd);
  const auskS = await holen(STD, '/api/konto/auskunft', 'de', { Cookie: 'sitzung=' + tokS.kunde });
  check('Standard: Download-Dateiname wie bisher musterakademie-adataim.json', auskS.cd.includes('filename="musterakademie-adataim.json"'), auskS.s + ' ' + auskS.cd);
  const oa = JSON.parse((await holen(EIGEN, '/agent/openapi.json', 'de')).text), oaS = JSON.parse((await holen(STD, '/agent/openapi.json', 'de')).text);
  check('OpenAPI-Titel mit eigenem Namen, Standard wie bisher', oa.info.title === NAME + ' Agent Entwürfe' && oaS.info.title === 'Musterakademie Agent Entwürfe', oa.info.title + ' / ' + oaS.info.title);
  const an = JSON.parse((await holen(EIGEN, '/api/anbieter', 'de')).text);
  check('/api/anbieter unveraendert (nur anbieter + demo, keine Geheimnisse)', Object.keys(an).sort().join() === 'anbieter,demo' && an.demo === false);
  });

  // ---- Teil C: Browser ----
  await teil('C-Browser', async () => {
  const PW = process.env.PLAYWRIGHT_CORE || 'C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs';
  const CHROME = process.env.CHROME_PFAD || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (!existsSync(PW) || !existsSync(CHROME)) {
    uebersprungen++; console.log('UEBERSPRUNGEN Teil C (Browser): playwright-core oder Chrome fehlt (' + (existsSync(PW) ? CHROME : PW) + ')');
  } else {
    const { chromium } = await import(pathToFileURL(PW).href);
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    // Textlogo: der Name muss komplett in die Logo-Flaeche passen (nicht rechts abgeschnitten)
    for (const n of ['Example Academy', 'Példa Akadémia', 'Beispiel-Akademie', 'WMW Media World', 'Internationale Akademie für Kommunikation']) {
      const mm = await import(pathToFileURL(join(PLATTFORM, 'marke.mjs')).href); mm.setzePlattform(n);
      const seite = await browser.newPage(); await seite.setContent('<body>' + mm.textLogoSvg(true) + '</body>');
      const m = await seite.evaluate(() => { const sv = document.querySelector('svg'); const tt = sv.querySelectorAll('text')[1]; return { vb: sv.viewBox.baseVal.width, ende: tt.getBBox().x + tt.getBBox().width }; });
      check('Textlogo "' + n + '": Name passt in die Logo-Flaeche', m.ende <= m.vb - 8, JSON.stringify(m)); await seite.close();
    }
    (await import(pathToFileURL(join(PLATTFORM, 'marke.mjs')).href)).setzePlattform('Musterakademie');
    const sicht = () => ({ text: document.body.innerText, titel: document.title,
      bilder: [...document.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src'), alt: i.alt, w: i.naturalWidth })) });
    try {
      for (const l of SPRACHEN) {
        for (const [basis, eigen, tok] of [[EIGEN, true, tokE], [STD, false, tokS]]) {
          const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: l });
          const art = eigen ? 'eigener Name' : 'Standard';
          const seiten = [];
          const p = await ctx.newPage();
          for (const [rolle, wo] of [['', '/#/'], ['', '/#/kurs/1'], ['', '/#/belepes'], ['kunde', '/#/fiokom'], ['kunde', '/#/eloadasaim'], ['', '/admin/'], ['admin', '/admin/']]) {
            await ctx.clearCookies();
            await ctx.addCookies([{ name: 'lang', value: l, url: basis }, ...(rolle ? [{ name: 'sitzung', value: tok[rolle], url: basis }] : [])]);
            await p.goto(basis + wo, { waitUntil: 'load' });
            await p.waitForSelector('header img, .kopf img', { timeout: 8000 }).catch(() => {});
            await p.waitForTimeout(700);
            seiten.push({ wo: wo + (rolle ? ' (' + rolle + ')' : ''), ...(await p.evaluate(sicht)) });
          }
          const logos = seiten.flatMap((s) => s.bilder.filter((b) => /logo/.test(b.src || '')).map((b) => ({ ...b, wo: s.wo })));
          if (eigen) {
            const treffer = seiten.filter((s) => MUSTER.test(s.text + s.titel + JSON.stringify(s.bilder))).map((s) => s.wo + ' ' + fund(s.text + s.titel + JSON.stringify(s.bilder)));
            check(`[${l}] ${art}: ${seiten.length} Kunden-/Admin-Seiten im Browser ohne "Musterakademie" (Text, Titel, Bilder, Alt)`, treffer.length === 0, treffer.join(' || '));
            check(`[${l}] ${art}: Logos sind das Textlogo (/img/marke-logo*.svg), geladen, Alt-Text mit "${NAME}" (${logos.length})`, logos.length >= seiten.length && logos.every((b) => /^\/img\/marke-logo(-vertikal)?\.svg$/.test(b.src) && b.w > 0 && b.alt.includes(NAME)), JSON.stringify(logos.slice(0, 3)));
          } else {
            check(`[${l}] ${art}: Logos wie bisher /img/muster-logo*.svg mit Alt "Musterakademie" (${logos.length})`, logos.length >= seiten.length && logos.every((b) => /^\/img\/muster-logo(-vertikal)?\.svg$/.test(b.src) && b.w > 0 && /Musterakademie/.test(b.alt)), JSON.stringify(logos.slice(0, 3)));
          }
          await ctx.close();
        }
      }
    } finally { await browser.close(); }
  }
  });
} catch (e) {
  check('Testablauf', false, e.stack || e.message);
} finally {
  for (const k of kinder) { try { k.kill(); } catch { /* ignorieren */ } }
  await warte(500);
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignorieren */ } }
}
console.log(`\nMarke: ${ok} bestanden, ${fail} fehlgeschlagen` + (uebersprungen ? ', Teil C uebersprungen' : ''));
process.exit(fail ? 1 : 0);
}
