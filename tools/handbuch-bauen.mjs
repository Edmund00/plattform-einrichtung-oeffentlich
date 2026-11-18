// Kaeufer-Handbuch (Deutsch, Englisch, Ungarisch) bauen: Bilder der echten Oberflaeche aufnehmen und das PDF erzeugen.
// Aufruf (im Ordner plattform):  node tools/handbuch-bauen.mjs            Bilder neu aufnehmen + PDF
//                                node tools/handbuch-bauen.mjs --nur-pdf  nur das PDF aus der HTML-Quelle und den vorhandenen Bildern
// Nur fuer die Gegenprobe des Selbsttests: --einschleusen="Text" --ausgabe=<Pfad> (fuegt Text in das PDF ein, schreibt an einen anderen Ort).
//
// Was das Skript tut (nichts davon verlaesst den Rechner):
// - startet eine EIGENE, saubere Instanz der Plattform auf 127.0.0.1:4520 (EN 4951, HU 4952; HANDBUCH_PORT ueberschreibt) mit Datenbank und Dateiordner in %TEMP% (kein Demo-Modus),
// - Stripe ist eine Attrappe im Prozess (keine Verbindung zu Stripe, keine Schluessel), Mails landen nur in einer Liste im Speicher,
// - legt erfundene Beispielkurse und ein Kaeuferkonto (@example.com) an, klickt die Kaeuferablaeufe in Chrome (headless) durch,
// - der Browser sieht die Plattform unter https://kurse.example.com (wird im Browser auf die lokale Instanz umgeleitet, kein DNS, kein Netz),
//   alle anderen Adressen werden blockiert (auch die Zahlungsseite von Stripe: sie wird NICHT bebildert),
// - beendet die Instanz und den Browser am Ende selbst (nur eigene Prozesse) und loescht den Temp-Ordner.
// Voraussetzungen: Chrome unter C:\Program Files\Google\Chrome, playwright-core unter C:\Users\diaco\Projekte\browser-werkzeug, ffmpeg im PATH (fuer das Beispielvideo).
// Sprachen (12.11.2026): --sprache=de|en|hu (auch "--sprache en"). Ohne Parameter: Deutsch wie bisher (Quelle handbuch-kaeufer.de.html, Bilder in bilder/,
// PDF ausgabe/handbuch-kaeufer-de.pdf). EN/HU: Quelle handbuch-kaeufer.<sprache>.html, Bilder in bilder-<sprache>/, PDF ausgabe/handbuch-kaeufer-<sprache>.pdf.
// Die Oberflaeche wird in der Zielsprache aufgenommen (TEXT_SPRACHE, Cookie lang, Browser-Locale); Beispieldaten je Sprache in tools/handbuch-kaeufer-daten.mjs.
const SPRACHE = (() => { const i = process.argv.findIndex((x) => x === '--sprache'); const a = process.argv.find((x) => x.startsWith('--sprache='));
  const s = a ? a.slice(10) : (i >= 0 ? process.argv[i + 1] : 'de'); if (!['de', 'en', 'hu'].includes(s)) { console.error('FEHLER --sprache muss de, en oder hu sein'); process.exit(1); } return s; })();
process.env.TEXT_SPRACHE = SPRACHE;
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const PLATTFORM = resolve(HIER, '..');
const HB = join(PLATTFORM, 'handbuch');
const BILDER_ORDNER = SPRACHE === 'de' ? 'bilder' : 'bilder-' + SPRACHE;
const BILDER = join(HB, BILDER_ORDNER);
const QUELLE = join(HB, 'handbuch-kaeufer.' + SPRACHE + '.html');
const { DATEN } = await import('./handbuch-kaeufer-daten.mjs');
const D = DATEN[SPRACHE];
const arg = (name) => { const a = process.argv.find((x) => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : null; };
const NUR_PDF = process.argv.includes('--nur-pdf');
const EINSCHLEUSEN = arg('einschleusen');
const AUSGABE = arg('ausgabe') || join(HB, 'ausgabe', 'handbuch-kaeufer-' + SPRACHE + '.pdf');
const CHROME = process.env.CHROME_PFAD || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PW = process.env.PLAYWRIGHT_CORE || 'C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs';
const PORT = Number(process.env.HANDBUCH_PORT) || { de: 4520, en: 4951, hu: 4952 }[SPRACHE], LOKAL = 'http://127.0.0.1:' + PORT, BASE = 'https://kurse.example.com';
// Deckblatt-Logo: neutrales Textlogo fuer den Beispielanbieter (kein Demo-/Musterlogo im PDF). Marke je Sprache (D.marke: DE "Beispiel-Akademie",
// EN "Example Academy", HU "Példa Akadémia"), dieselbe Marke in Logo, Bildern (plattformName/ANBIETER_NAME) und Text.
// Nur fuer den Layout-Test des Deckblatts: --marke="<langer Name>" (zusammen mit --nur-pdf --ausgabe=<Pfad>) setzt das Logo NUR im erzeugten PDF
// (als data:-Bild), die Logo-Datei in bilder*/ bleibt unveraendert.
const MARKE_TEST = arg('marke');
const MARKE = D.marke;
const { textLogoSvg: logoSvg, setzePlattform: markeSetzen } = await import('../marke.mjs');
let LOGO_TEST = null;
if (MARKE_TEST) { markeSetzen(MARKE_TEST); LOGO_TEST = 'data:image/svg+xml;base64,' + Buffer.from(logoSvg(true)).toString('base64'); }
markeSetzen(MARKE); mkdirSync(BILDER, { recursive: true });
if (!MARKE_TEST) writeFileSync(join(BILDER, 'marke-logo-vertikal.svg'), logoSvg(true));
const KAEUFER = D.kaeufer;
const VERSION = '1.0';

// Sichtbare Woerter, die in KEINEM Bild stehen duerfen (geprueft am sichtbaren Seitentext vor jeder Aufnahme).
const BILD_VERBOTEN_BASIS = /demo|testkarte|testmodus|testzahlung|4242|localhost|127\.0\.0\.1|\/api\/|sk_(test|live)|musterkurs|musterplattform|musterakademie|\bnull\b|\bundefined\b/i;
const BILD_VERBOTEN = D.bildVerboten ? new RegExp(BILD_VERBOTEN_BASIS.source + '|' + D.bildVerboten.source, 'i') : BILD_VERBOTEN_BASIS;
const T = JSON.parse(readFileSync(join(PLATTFORM, 'texte', SPRACHE + '.json'), 'utf8'));   // sichtbare Knopftexte der Zielsprache (fuer Selektoren)
// Produktreife (12.11.2026): Die frueheren Ausblendungen (.demo-plakette, .kaufbox-demo, .anbieter-block p.klein) sind entfallen. Ohne Demo-Modus
// zeigt die Software diese Demo-Hinweise selbst nicht mehr; die Bilder sind unveraenderte Aufnahmen. BILD_VERBOTEN wacht weiter darueber.

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...x) => console.log(...x);

const { chromium } = await import(pathToFileURL(PW).href);
const { barrierefreiFehler, lesezeichenVorbereiten } = await import('./handbuch-barrierefrei.mjs');
const { lesePdf, lesezeichenFehler } = await import('./pdf-barrierefrei-pruefen.mjs');
let browser, server, tmp;

async function pdfJs() {
  const basis = join(PLATTFORM, 'public', 'vendor', 'pdfjs');
  const warn = console.warn, log0 = console.log; console.warn = console.log = () => {};
  const pdfjs = await import(pathToFileURL(join(basis, 'pdf.min.mjs')).href).finally(() => { console.warn = warn; console.log = log0; });
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(basis, 'pdf.worker.min.mjs')).href;
  return pdfjs;
}
async function pdfSeitenText(buffer) {
  const pdfjs = await pdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
  const seiten = [];
  for (let i = 1; i <= doc.numPages; i++) seiten.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ').replace(/\s+/g, ' '));
  await doc.destroy();
  return seiten;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Teil 1: Bilder aufnehmen
// ---------------------------------------------------------------------------------------------------------------------------
async function bilderAufnehmen() {
  tmp = mkdtempSync(join(tmpdir(), 'handbuch-kaeufer-'));
  process.env.DB_DATEI = join(tmp, 'handbuch.db');
  const dateiOrdner = join(tmp, 'dateien');
  mkdirSync(join(dateiOrdner, 'vorschau'), { recursive: true });
  mkdirSync(BILDER, { recursive: true });
  for (const f of readdirSync(BILDER)) if (f.endsWith('.png')) unlinkSync(join(BILDER, f));

  // ---- Stripe-Attrappe (keine Verbindung zu Stripe) ----
  const stripeLog = [];
  const stripe = {
    customers: { create: async () => ({ id: 'cus_hb_1' }), update: async () => ({}), del: async (id) => ({ id, deleted: true }) },
    checkout: { sessions: {
      create: async (p) => { const id = 'cs_hb_' + (stripeLog.length + 1); stripeLog.push({ id, p }); return { id, url: 'https://checkout.stripe.com/c/pay/' + id }; },
      list: async () => ({ data: [] }), expire: async () => ({}), retrieve: async (id) => ({ id, payment_intent: null }) } },
    paymentIntents: { retrieve: async (id) => ({ id, latest_charge: null }) },
    refunds: { create: async () => ({ id: 're_hb_1', status: 'succeeded' }), list: async () => ({ data: [], has_more: false }) },
    billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/p/session/hb' }) } },
    subscriptions: { retrieve: async (id) => ({ id, status: 'active' }), update: async (id) => ({ id }), cancel: async (id) => ({ id }) },
    invoices: { retrieve: async (id) => ({ id }), list: async () => ({ data: [], has_more: false }) },
    invoicePayments: { list: async () => ({ data: [] }) },
    webhooks: { constructEvent: (body) => JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body)) },
  };
  const mails = [];
  const mailer = async (m) => { mails.push(m); return true; };

  const { db } = await import('../db.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const app = erstelleServer({ stripe, webhookSecret: 'lokal', base: BASE, mailer, dateiOrdner, ellallasWiederaufnahme: false, abgleichAutomatik: false,
    demoModus: false, trustProxy: 0, nodeEnv: 'development', supportMail: 'kontakt@example.com',
    plattformName: MARKE, anbieter: { ANBIETER_NAME: MARKE, ANBIETER_EMAIL: 'kontakt@example.com' } });
  server = app.listen(PORT, '127.0.0.1');
  await new Promise((ja, nein) => { server.once('listening', ja); server.once('error', nein); });
  log('Instanz laeuft auf', LOKAL, '(PID', process.pid + ', Datenbank im Temp-Ordner)');

  browser = await chromium.launch({ executablePath: CHROME, headless: true });

  // ---- Beispielmedien erzeugen (Titelbilder, Video, PDF) ----
  const werkzeug = await browser.newPage({ viewport: { width: 1200, height: 675 } });
  async function titelbild(titel, unter, farbe) {
    await werkzeug.setViewportSize({ width: 1200, height: 675 });
    await werkzeug.setContent(`<html><body style="margin:0"><div style="width:1200px;height:675px;display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box;
      background:linear-gradient(135deg,${farbe} 0%,#0d0a05 100%);color:#faf6ee;font-family:Georgia,serif">
      <div style="width:90px;height:4px;background:#d4a843;margin-bottom:34px"></div>
      <div style="font-size:66px;line-height:1.1">${titel}</div><div style="font-size:30px;margin-top:22px;color:#e8c777;font-family:Arial,sans-serif">${unter}</div></div></body></html>`);
    return werkzeug.screenshot({ type: 'png' });
  }
  const bilder = [];
  for (const [titel, unter, farbe] of D.titelbilder) bilder.push(await titelbild(titel, unter, farbe));
  await werkzeug.setViewportSize({ width: 1280, height: 720 });
  await werkzeug.setContent(`<html><body style="margin:0"><div style="width:1280px;height:720px;background:#14100a;color:#faf6ee;font-family:Georgia,serif;display:flex;flex-direction:column;justify-content:center;align-items:center">
    <div style="font-size:30px;color:#e8c777;font-family:Arial,sans-serif;letter-spacing:4px">${D.folie.oben}</div><div style="font-size:72px;margin-top:20px">${D.folie.titel}</div>
    <div style="font-size:28px;margin-top:26px;font-family:Arial,sans-serif;color:#b8ad94">${D.folie.unter}</div></div></body></html>`);
  const folie = join(tmp, 'folie.png');
  writeFileSync(folie, await werkzeug.screenshot({ type: 'png' }));
  const videoDatei = join(tmp, 'lektion.mp4');
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', folie, '-t', '6', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoDatei]);
  const videoDa = ff.status === 0 && existsSync(videoDatei);
  if (!videoDa) log('WARNUNG: ffmpeg nicht verfuegbar, die Videolektion bleibt ohne Datei.');
  await werkzeug.setContent(`<html lang="${SPRACHE}"><body style="font-family:Arial,sans-serif;color:#211a0e;padding:20px 30px">
    <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:30px;border-bottom:3px solid #d4a843;padding-bottom:10px">${D.blatt.titel}</h1>
    <p style="font-size:15px;line-height:1.6">${D.blatt.text}</p>
    ${D.blatt.fragen
      .map((x, i) => `<h2 style="font-size:18px;margin-top:28px">${i + 1}. ${x}</h2><div style="border:1px solid #e7ddc9;border-radius:8px;height:120px"></div>`).join('')}
    </body></html>`);
  const pdfBytes = await werkzeug.pdf({ format: 'A4', printBackground: true });
  // Checkliste fuer die Download-Lektion (Datei wird im Handbuch nicht gezeigt, nur die Schaltflaeche)
  await werkzeug.setContent(`<html lang="${SPRACHE}"><body style="font-family:Arial,sans-serif;color:#211a0e;padding:20px 30px">
    <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:30px;border-bottom:3px solid #d4a843;padding-bottom:10px">${D.download.titel}</h1>
    ${D.download.punkte.map((x) => `<p style="font-size:16px;margin:18px 0"><span style="display:inline-block;width:16px;height:16px;border:2px solid #a87c2a;margin-right:12px;vertical-align:-3px"></span>${x}</p>`).join('')}
    </body></html>`);
  const checklisteBytes = await werkzeug.pdf({ format: 'A4', printBackground: true });
  await werkzeug.close();

  // ---- Beispieldaten: Kurse und Lektionen (erfunden) ----
  const jetzt = new Date().toISOString();
  const kursAnlegen = (titel, beschreibung, nutzen, preis, abo, bild) => {
    const bildName = randomUUID();
    writeFileSync(join(dateiOrdner, 'vorschau', bildName), bild);
    return Number(db.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert,nutzen,abo_preis_cent,abo_intervall,titelbild_datei,titelbild_typ) VALUES (?,?,?,'eur','veroeffentlicht',?,?,?,?,?,?,'image/png')")
      .run(titel, beschreibung, preis, jetzt, jetzt, nutzen, abo ? abo[0] : null, abo ? abo[1] : null, bildName).lastInsertRowid);
  };
  let reihenfolge = 0;
  const lektion = (kurs, abschnitt, titel, art, inhalt) => Number(db.prepare("INSERT INTO lektionen (kurs_id,abschnitt,titel,art,inhalt,reihenfolge,status,erstellt,geaendert) VALUES (?,?,?,?,?,?,'veroeffentlicht',?,?)")
    .run(kurs, abschnitt, titel, art, inhalt, ++reihenfolge, jetzt, jetzt).lastInsertRowid);
  const datei = (lektionId, name, art, bytes, mime) => { const pfad = randomUUID(); writeFileSync(join(dateiOrdner, pfad), bytes);
    db.prepare('INSERT INTO dateien (lektion_id,name,art,pfad,groesse,mime,erstellt) VALUES (?,?,?,?,?,?,?)').run(lektionId, name, art, pfad, bytes.length, mime, jetzt); };

  const kursIds = [];
  D.kurse.forEach((k, i) => {
    const id = kursAnlegen(k.titel, k.beschreibung, k.nutzen, k.preis, k.abo, bilder[i]); kursIds.push(id);
    for (const [abschnitt, titel, art, inhalt] of k.lektionen) {
      const lid = lektion(id, abschnitt, titel, art, inhalt);
      if (art === 'video' && videoDa) datei(lid, D.dateinamen.video, 'video', readFileSync(videoDatei), 'video/mp4');
      if (art === 'pdf') datei(lid, D.dateinamen.pdf, 'pdf', pdfBytes, 'application/pdf');
    }
  });
  const [K1, K2, K3, K4] = kursIds;
  // Download-Lektion (Block 3): im ersten Kurs, download_erlaubt = 1 (wie der Handbuch-Seed der Software; kein Admin-Weg setzt das Feld)
  const DL = lektion(K1, ...D.download.lektion);
  db.prepare('UPDATE lektionen SET download_erlaubt = 1 WHERE id = ?').run(DL);
  datei(DL, D.dateinamen.download, 'pdf', checklisteBytes, 'application/pdf');
  const [TITEL1, TITEL2, TITEL3] = D.kurse.map((k) => k.titel);

  // ---- Browser: der Kaeufer sieht https://kurse.example.com (umgeleitet auf die lokale Instanz, alles andere blockiert) ----
  const checkoutAufrufe = [];
  async function kontext() {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 2, locale: D.locale, bypassCSP: true,
      extraHTTPHeaders: { 'Accept-Language': D.accept } });
    await ctx.addCookies([{ name: 'lang', value: SPRACHE, url: BASE }]);
    await ctx.route('**/*', async (route) => {
      const url = route.request().url();
      if (url === BASE || url.startsWith(BASE + '/')) {
        try { const antwort = await route.fetch({ url: LOKAL + url.slice(BASE.length) }); return route.fulfill({ response: antwort }); }
        catch { return route.abort(); }
      }
      if (url.startsWith('https://checkout.stripe.com/') || url.startsWith('https://billing.stripe.com/')) checkoutAufrufe.push(url);
      if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      return route.abort();
    });
    return ctx;
  }
  const bildListe = [];
  async function textPruefen(p, name) {
    const text = await p.evaluate(() => document.body.innerText);
    const t = BILD_VERBOTEN.exec(text);
    if (t) throw new Error('Bild ' + name + ': verbotener sichtbarer Text "' + t[0] + '"');
    const fremd = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) || []).filter((m) => !m.endsWith('@example.com'));
    if (fremd.length) throw new Error('Bild ' + name + ': E-Mail-Adresse ausserhalb von example.com');
  }
  async function ruhig(p) { await p.evaluate(() => document.fonts.ready); await p.evaluate(() => document.activeElement?.blur?.()); await pause(500); }
  async function bild(p, name, ziel = null, opt = {}) {
    await ruhig(p); await textPruefen(p, name);
    const datei = join(BILDER, name + '.png');
    if (ziel) await p.locator(ziel).first().screenshot({ path: datei, ...opt });
    else await p.screenshot({ path: datei, ...opt });
    bildListe.push(name); log('Bild', name);
  }
  async function gehe(p, hash) { await p.evaluate((h) => { location.hash = h; }, hash); await pause(900); }
  const webhook = async (ereignis) => {
    const r = await fetch(LOKAL + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 'lokal' }, body: JSON.stringify(ereignis) });
    if (r.status !== 200) throw new Error('Webhook ' + r.status);
  };
  const bezahlt = (sitzung, kursId, betrag, pi) => webhook({ id: 'evt_' + sitzung, type: 'checkout.session.completed', data: { object: {
    id: sitzung, mode: 'payment', payment_status: 'paid', customer: 'cus_hb_1', amount_total: betrag, currency: 'eur', payment_intent: pi,
    metadata: { kurs_id: String(kursId), benutzer_id: String(db.prepare('SELECT id FROM benutzer WHERE email=?').get(KAEUFER).id), modell: 'einmal', sprache: SPRACHE } } } });
  const mailBild = async (ctx, mail, name) => {
    const p = await ctx.newPage(); await p.setViewportSize({ width: 760, height: 900 });
    await p.setContent(mail.html, { waitUntil: 'load' }); await bild(p, name, null, { fullPage: true }); await p.close();
  };
  const warteMail = async (pruef) => { for (let i = 0; i < 100; i++) { const m = mails.find(pruef); if (m) return m; await pause(100); } throw new Error('Mail kam nicht'); };

  const ctx = await kontext();
  const p = await ctx.newPage();
  const passwort = randomBytes(9).toString('base64url') + 'Aa1';   // nur fuer diesen Lauf, nirgends gespeichert oder ausgegeben

  // 1) Startseite als Gast, Sprachwahl
  await p.goto(BASE + '/'); await p.waitForSelector('.kurzus-kartya');
  await bild(p, '01-startseite');
  await bild(p, '02-kopfzeile', 'header.kopf');
  // 2) Kursseite als Gast
  await gehe(p, '#/kurs/' + K1); await p.waitForSelector('.preis-kasten');
  await bild(p, '03-kursseite', null, { fullPage: true });
  await bild(p, '04-lektionen-gesperrt', '.kurs-lektionen');
  // 3) Registrierung
  await gehe(p, '#/regisztracio'); await p.waitForSelector('form');
  await p.fill('input[name=email]', KAEUFER); await p.fill('input[name=passwort]', passwort);
  await p.check('input[name=elfogad]');
  await bild(p, '05-registrierung', 'form');
  await p.click('form button[type=submit]'); await p.waitForSelector('.email-hinweis');
  await bild(p, '06-nach-registrierung');
  const bestMail = await warteMail((m) => m.to === KAEUFER && /megerosites/.test(m.html || m.text || ''));
  await mailBild(ctx, bestMail, '07-mail-bestaetigung');
  const link = /https:\/\/kurse\.example\.com\/#\/megerosites\/[A-Za-z0-9_-]{43}/.exec(bestMail.html || bestMail.text)[0];
  // 4) Kaufversuch ohne Bestaetigung: Hinweis
  await gehe(p, '#/kurs/' + K1); await p.waitForSelector('.preis-kasten');
  await p.click('.ellallas-zustimmung input'); await p.click('.preis-kasten .knopf.gross.gruen');
  await p.waitForSelector('.meldung.rot'); await p.evaluate(() => window.scrollTo(0, 0));
  await bild(p, '08-hinweis-bestaetigen');
  // 5) E-Mail bestaetigen (Link aus der Mail)
  await p.goto(link); await p.waitForSelector('.meldung.ok');
  await bild(p, '09-email-bestaetigt');
  // 6) Abmelden, Anmelden
  await p.click("nav.menue button"); await pause(900);
  await gehe(p, '#/belepes'); await p.waitForSelector('form');
  await p.fill('input[name=email]', KAEUFER); await p.fill('input[name=passwort]', passwort);
  await bild(p, '10-anmeldung', 'form');
  await p.click('form button[type=submit]'); await pause(1200);
  // 7) Passwort vergessen (eigener Gast-Kontext)
  {
    const g = await kontext(); const gp = await g.newPage();
    await gp.goto(BASE + '/#/passwort-vergessen'); await gp.waitForSelector('form');
    await gp.fill('input[type=email]', KAEUFER); await gp.click('form button[type=submit]'); await gp.waitForSelector('.meldung.ok');
    await bild(gp, '11-passwort-vergessen');
    const reset = await warteMail((m) => m.to === KAEUFER && /passwort-neu/.test(m.html || m.text || ''));
    await mailBild(g, reset, '12-mail-passwort');
    const rlink = /https:\/\/kurse\.example\.com\/#\/passwort-neu\/[A-Za-z0-9_-]{43}/.exec(reset.html || reset.text)[0];
    await gp.goto(rlink); await gp.waitForSelector('form');
    await bild(gp, '13-passwort-neu', 'form');
    await g.close();
  }
  // 8) Kauf Kurs 1: Zustimmung, Weiterleitung (Zahlungsseite selbst wird nicht aufgenommen), Rueckkehr, Bestaetigung
  await gehe(p, '#/kurs/' + K1); await p.waitForSelector('.preis-kasten');
  await bild(p, '14-kaufkasten-vorher', '.kurs-kauf-rechts');
  await p.click('.ellallas-zustimmung input');
  await bild(p, '15-kaufkasten-zustimmung', '.kurs-kauf-rechts');
  const vorher = checkoutAufrufe.length;
  await p.click('.preis-kasten .knopf.gross.gruen');
  for (let i = 0; i < 50 && checkoutAufrufe.length === vorher; i++) await pause(100);
  if (checkoutAufrufe.length === vorher) throw new Error('Weiterleitung zur Zahlungsseite kam nicht');
  await p.waitForLoadState('load').catch(() => {}); await pause(800);   // blockierte Weiterleitung erst ausklingen lassen (sonst bricht goto ab)
  const sitzung1 = stripeLog[stripeLog.length - 1];
  await p.goto(BASE + '/?kauf=erfolg&kurs=' + K1); await p.waitForSelector('.allapot-kartya');
  await bild(p, '16-zahlung-wird-geprueft');
  await bezahlt(sitzung1.id, K1, 24900, 'pi_hb_1');
  await p.waitForFunction(() => document.querySelector('.allapot-kartya .knopf.gruen'), null, { timeout: 30000 });
  await bild(p, '17-zahlung-eingegangen');
  const kaufMail = await warteMail((m) => m.to === KAEUFER && (m.subject || '').includes(TITEL1));
  await mailBild(ctx, kaufMail, '18-mail-kauf');
  // Abbruch-Seite
  await p.goto(BASE + '/?kauf=abgebrochen&kurs=' + K1); await p.waitForSelector('.allapot-kartya');
  await bild(p, '19-zahlung-abgebrochen');
  // Abo- und Gratis-Kaufkasten
  await gehe(p, '#/kurs/' + K2); await p.waitForSelector('.preis-kasten');
  await bild(p, '20-kaufkasten-abo', '.kurs-kauf-rechts');
  await gehe(p, '#/kurs/' + K4); await p.waitForSelector('.preis-kasten');
  await bild(p, '21-kaufkasten-kostenlos', '.kurs-kauf-rechts');
  await p.click('.preis-kasten .knopf.gross.gruen'); await p.waitForSelector('.tananyag-fej'); await p.waitForSelector('.meldung.ok');
  await bild(p, '22-kostenlos-freigeschaltet');
  // Kurs 3 (wird spaeter widerrufen, nie geoeffnet) und ein laufendes Abo fuer Kurs 2 (erfundene Datensaetze, wie nach bestaetigter Zahlung)
  const r3 = await p.evaluate(async (id) => (await fetch('/api/kurse/' + id + '/kaufen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modell: 'einmal', zustimmung: true }) })).status, K3);
  if (r3 !== 200) throw new Error('Kauf Kurs 3: ' + r3);
  await bezahlt(stripeLog[stripeLog.length - 1].id, K3, 4900, 'pi_hb_3');
  {
    const uid = db.prepare('SELECT id FROM benutzer WHERE email=?').get(KAEUFER).id;
    const bis = Date.now() + 30 * 24 * 3600 * 1000;
    db.prepare("INSERT INTO abos (stripe_abo,stripe_sitzung,benutzer_id,kurs_id,status,gueltig_bis,endet_zum_periodenende,erstellt,geaendert) VALUES ('sub_hb_1','cs_hb_abo',?,?,'aktiv',?,0,?,?)").run(uid, K2, bis, jetzt, jetzt);
    db.prepare("INSERT INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert,stripe_abo) VALUES ('in_hb_abo1','pi_hb_abo1',?,?,1200,'eur','bezahlt','abo',?,?,'sub_hb_1')").run(uid, K2, new Date().toISOString(), new Date().toISOString());
    db.prepare("INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES (?,?,'abo',?,?)").run(uid, K2, jetzt, bis);
  }
  // 9) Meine Kurse, Kursuebersicht, Lektionen
  await gehe(p, '#/eloadasaim'); await p.waitForSelector('.kurzus-racs');
  await bild(p, '23-meine-kurse', null, { fullPage: true });
  await gehe(p, '#/eloadas/' + K1); await p.waitForSelector('.lecke-kartya');
  await bild(p, '24-kursuebersicht');
  const lektionen = db.prepare('SELECT id,art FROM lektionen WHERE kurs_id=? ORDER BY reihenfolge').all(K1);
  await gehe(p, '#/lecke/' + K1 + '/' + lektionen[0].id); await p.waitForSelector('.lecke-nezet');
  await bild(p, '25-lektion-text');
  await gehe(p, '#/lecke/' + K1 + '/' + lektionen[1].id); await p.waitForSelector('.lecke-nezet');
  if (videoDa) {
    await p.waitForFunction(() => { const v = document.querySelector('video.medium'); return v && v.readyState >= 2; }, null, { timeout: 20000 });
    await p.evaluate(() => { const v = document.querySelector('video.medium'); v.currentTime = 1; });
    await pause(700);
  }
  await bild(p, '26-lektion-video');
  await gehe(p, '#/lecke/' + K1 + '/' + lektionen[2].id);
  await p.waitForFunction(() => /\d+[^/\d]{0,12}\/ \d+/.test(document.querySelector('.pdf-zaehler')?.textContent || ''), null, { timeout: 20000 });
  await pause(1200);
  await bild(p, '27-lektion-pdf');
  await gehe(p, '#/lecke/' + K1 + '/' + DL); await p.waitForSelector('.lecke-nezet a.knopf.gross[download]');
  await bild(p, '42-lektion-download', '.lecke-nezet');   // nur die Lektionskarte (Titel, Text, Schaltflaeche, Hinweis)
  // 10) Mein Konto
  await gehe(p, '#/fiokom'); await p.waitForSelector('.konto-bestellung');
  await bild(p, '28-konto-oben');
  const karteNach = (text) => p.locator('.konto-bestellung', { hasText: text }).first();
  await ruhig(p); await textPruefen(p, '29-bestellung-einmal');
  await karteNach(TITEL1).screenshot({ path: join(BILDER, '29-bestellung-einmal.png') }); bildListe.push('29-bestellung-einmal');
  await karteNach(TITEL2).screenshot({ path: join(BILDER, '30-bestellung-abo.png') }); bildListe.push('30-bestellung-abo');
  for (const [name, n] of [['31-konto-passwort', 2], ['32-konto-daten-anfordern', 3], ['33-konto-email-aendern', 4], ['34-konto-loeschen', 5]]) {
    await p.locator('main > section.szakasz').nth(n).screenshot({ path: join(BILDER, name + '.png') }); bildListe.push(name);
  }
  await gehe(p, '#/passwort-aendern'); await p.waitForSelector('form');
  await bild(p, '35-passwort-aendern', 'form');
  // 11) Widerruf (Kurs 3, Inhalt nie geoeffnet)
  await gehe(p, '#/fiokom'); await p.waitForSelector('.konto-bestellung');
  await karteNach(TITEL3).screenshot({ path: join(BILDER, '36-bestellung-vor-widerruf.png') }); bildListe.push('36-bestellung-vor-widerruf');
  await karteNach(TITEL3).locator('button', { hasText: T.k_elallas }).click();
  await p.waitForSelector('main .karte h2'); await bild(p, '37-widerruf-schritt1', 'main .karte');
  await p.locator('main .karte button').click(); await pause(800);
  await bild(p, '38-widerruf-schritt2', 'main .karte');
  await p.locator('main .karte button').click(); await p.waitForSelector('.konto-bestellung'); await pause(800);
  await p.evaluate(() => window.scrollTo(0, 0));
  await bild(p, "39-widerruf-meldung", ".oldal-main > .meldung");
  await karteNach(TITEL3).screenshot({ path: join(BILDER, '40-bestellung-nach-widerruf.png') }); bildListe.push('40-bestellung-nach-widerruf');
  // 12) Fusszeile
  await bild(p, '41-fusszeile', 'footer.fuss');

  await ctx.close();
  log('Bilder:', bildListe.length, '| Weiterleitungen zur Zahlungsseite (blockiert):', checkoutAufrufe.length, '| Mails im Speicher:', mails.length);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Teil 2: PDF
// ---------------------------------------------------------------------------------------------------------------------------
async function pdfBauen() {
  if (!browser) browser = await chromium.launch({ executablePath: CHROME, headless: true });
  let commit = 'unbekannt';
  try { commit = execFileSync('git', ['-C', PLATTFORM, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* ohne git */ }
  const stand = new Date().toLocaleDateString(D.locale, { day: '2-digit', month: D.locale.startsWith('de') ? '2-digit' : 'long', year: 'numeric', timeZone: 'Europe/Budapest' });
  const ctx = await browser.newContext();
  await ctx.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));   // nur lokale Dateien
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(QUELLE).href, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  const fehlend = await p.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
  if (fehlend.length) throw new Error('Bilder fehlen: ' + fehlend.join(', ') + ' (zuerst ohne --nur-pdf bauen)');
  await p.evaluate(({ version, stand, commit, extra }) => {
    for (const el of document.querySelectorAll('[data-feld=version]')) el.textContent = version;
    for (const el of document.querySelectorAll('[data-feld=stand]')) el.textContent = stand;
    for (const el of document.querySelectorAll('[data-feld=commit]')) el.textContent = commit;
    if (extra) { const x = document.createElement('p'); x.textContent = extra; document.querySelector('main').append(x); }
  }, { version: VERSION, stand, commit, extra: EINSCHLEUSEN });
  if (LOGO_TEST) { await p.evaluate((src) => new Promise((ok) => { const i = document.querySelector('.deckblatt .marke img'); i.onload = ok; i.src = src; }), LOGO_TEST);
    await p.evaluate(({ alt, neu }) => { const i = document.querySelector('.deckblatt .marke img'); i.alt = i.alt.replace(alt, neu); }, { alt: MARKE, neu: MARKE_TEST }); }   // Alt-Text des Logos folgt der Probe-Marke
  await p.emulateMedia({ media: 'print' }); await p.setViewportSize({ width: 665, height: 1100 });   // Breite = A4 minus Raender (176 mm)
  // Deckblatt-Waechter: Logo nicht rechts abgeschnitten, Titel und Beschreibung innerhalb des Titelbereichs (auch bei langem Markennamen).
  const deck = await p.evaluate(() => {
    const d = document.querySelector('.deckblatt'), r = d.getBoundingClientRect(), cs = getComputedStyle(d);
    const innen = { l: r.left + parseFloat(cs.paddingLeft) - 1, r: r.right - parseFloat(cs.paddingRight) + 1, o: r.top - 1, u: r.bottom + 1 };
    const fehler = [];
    for (const el of d.querySelectorAll('.marke img, h1, .unter, .stand')) { const b = el.getBoundingClientRect();
      if (b.left < innen.l || b.right > innen.r || b.top < innen.o || b.bottom > innen.u) fehler.push(el.tagName + '.' + el.className); }
    if (d.scrollHeight > d.clientHeight + 1 || d.scrollWidth > d.clientWidth + 1) fehler.push('Deckblatt laeuft ueber');
    return fehler;
  });
  if (deck.length) throw new Error('Deckblatt-Layout: ' + deck.join(', '));
  // Barrierefreiheit (12.11.2026): Sprache, Titel, Ueberschriften, Alt-Texte, th scope, Linktexte, Kontrast WCAG AA (tools/handbuch-barrierefrei.mjs)
  const bf = await barrierefreiFehler(p, SPRACHE); if (bf.length) throw new Error('Barrierefreiheit: ' + bf.join('; '));
  // Lesezeichen (12.11.2026): Leerzeichen am Zeilenumbruch des Titels, kein doppeltes Zierzeichen (tools/handbuch-barrierefrei.mjs)
  const lz = await lesezeichenVorbereiten(p); if (lz.length) throw new Error('Lesezeichen-Vorbereitung: ' + lz.join('; '));
  const optionen = { format: 'A4', printBackground: true, displayHeaderFooter: true, preferCSSPageSize: false, tagged: true, outline: true,   // Barrierefreiheit: getaggtes PDF + Lesezeichen (Playwright 1.64 page.pdf)
    margin: { top: '16mm', bottom: '18mm', left: '17mm', right: '17mm' },
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="font-family:Arial,sans-serif;font-size:7.5px;color:#7d7362;width:100%;padding:0 17mm;display:flex;justify-content:space-between">
      <span>${D.pdf.fuss} ${VERSION}</span><span>${D.pdf.seite}</span></div>` };
  // Pass 1: Seiten der Kapitel bestimmen (Text je Seite), Pass 2: Seitenzahlen im Inhaltsverzeichnis eintragen
  const kapitel = await p.evaluate(() => [...document.querySelectorAll('h2.kapitel')].map((h) => ({ id: h.id, text: h.textContent.replace(/\s+/g, '') })));
  const inhaltTitel = await p.evaluate(() => document.querySelector('.inhalt h2').textContent.trim());   // "Inhaltsverzeichnis" bzw. Zielsprache
  const seiten1 = await pdfSeitenText(await p.pdf(optionen));
  const inhaltSeite = seiten1.findIndex((s) => s.includes(inhaltTitel));
  const nummern = {};
  let ab = inhaltSeite + 1;
  for (const k of kapitel) {
    const i = seiten1.findIndex((s, n) => n >= ab && s.replace(/\s+/g, '').toLowerCase().includes(k.text.toLowerCase()));
    if (i < 0) throw new Error('Kapitel im PDF nicht gefunden: ' + k.text);
    nummern[k.id] = i + 1; ab = i;
  }
  await p.evaluate((n) => { for (const el of document.querySelectorAll('[data-seite]')) el.textContent = n[el.dataset.seite] ?? ''; }, nummern);
  const pdf = await p.pdf(optionen);
  const lzf = lesezeichenFehler((await lesePdf(pdf)).lesezeichen, await p.evaluate(() => [...document.querySelectorAll('h1,h2,h3')].map((h) => h.textContent)));
  if (lzf.length) throw new Error('Lesezeichen: ' + lzf.join('; '));
  const seiten2 = await pdfSeitenText(pdf);
  for (const k of kapitel) if (!seiten2[nummern[k.id] - 1].replace(/\s+/g, '').toLowerCase().includes(k.text.toLowerCase())) throw new Error('Seitenzahl verschoben: ' + k.text);
  mkdirSync(dirname(AUSGABE), { recursive: true });
  writeFileSync(AUSGABE, pdf);
  await ctx.close();
  log('PDF:', AUSGABE, '|', seiten2.length, 'Seiten | Commit', commit, '| Stand', stand);
}

let fehler = null;
try {
  if (!NUR_PDF) await bilderAufnehmen();
  await pdfBauen();
} catch (e) { fehler = e; console.error('FEHLER', e?.message || e); }
finally {
  if (browser) await browser.close().catch(() => {});
  if (server) { server.closeAllConnections?.(); await new Promise((r) => server.close(() => r())); log('Instanz beendet'); }
  if (tmp) { try { const { db } = await import('../db.mjs'); db.close(); } catch { /* schon zu */ } try { rmSync(tmp, { recursive: true, force: true }); } catch { log('Temp-Ordner bleibt:', tmp); } }
}
process.exit(fehler ? 1 : 0);
