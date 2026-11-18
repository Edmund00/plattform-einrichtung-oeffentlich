// Admin-Handbuch bauen: Bilder der echten Admin-Oberflaeche aufnehmen und das PDF erzeugen. Deutsch = Master-Fassung, Englisch/Ungarisch = Uebersetzungen.
// Aufruf (im Ordner plattform):  node tools/handbuch-admin-bauen.mjs            Deutsch: Bilder neu aufnehmen + PDF (Standard, unveraendert)
//                                node tools/handbuch-admin-bauen.mjs --nur-pdf  nur das PDF aus der HTML-Quelle und den vorhandenen Bildern
//                                node tools/handbuch-admin-bauen.mjs --sprache=en   (oder --sprache en | hu | de)
//   Sprache en/hu: Quelle handbuch-admin.<sprache>.html, Bilder bilder-admin-<sprache>/, PDF ausgabe/handbuch-admin-<sprache>.pdf,
//   Admin-Oberflaeche in der Zielsprache (Cookie lang, TEXT_SPRACHE), Beispieldaten in der Zielsprache. Deutsch bleibt bei bilder-admin/.
// Nur fuer die Gegenprobe des Selbsttests: --einschleusen="Text" --ausgabe=<Pfad> (fuegt Text in das PDF ein, schreibt an einen anderen Ort).
//
// Vorbild: tools/handbuch-bauen.mjs (Kaeufer-Handbuch). Was dieses Skript tut (nichts davon verlaesst den Rechner):
// - startet eine EIGENE, saubere Instanz der Plattform auf 127.0.0.1:5047 (HANDBUCH_ADMIN_PORT) mit Datenbank, Datei- und Sicherungsordner in %TEMP% (kein Demo-Modus),
// - Stripe ist eine Attrappe im Prozess (keine Verbindung zu Stripe, keine Schluessel), Mails landen nur in einer Liste im Speicher,
// - der Sicherungsschluessel ist ein Zufallswert nur fuer diesen Lauf (nie ausgegeben, nie gespeichert), die Sicherung landet im Temp-Ordner,
// - legt ein Admin-Konto und erfundene Kaeuferkonten an (nur @example.com), Kaeufe laufen ueber die echten Wege der Software (Kauf-API + Webhook der Attrappe),
// - klickt die Admin-Ablaeufe in Chrome (headless) durch; der Browser sieht die Plattform unter https://kurse.example.com (im Browser auf die lokale
//   Instanz umgeleitet, kein DNS, kein Netz), alle anderen Adressen werden blockiert,
// - die Admin-Anfragen tragen eine Adresse aus dem Dokumentationsbereich 203.0.113.0/24 (RFC 5737), damit das Anmeldeprotokoll keine lokale Adresse zeigt,
// - beendet die Instanz und den Browser am Ende selbst (nur eigene Prozesse) und loescht den Temp-Ordner.
// Voraussetzungen: Chrome unter C:\Program Files\Google\Chrome, playwright-core unter C:\Users\diaco\Projekte\browser-werkzeug, ffmpeg im PATH (Beispielvideo).
const SPRACHE = (() => { const a = process.argv.find((x) => x.startsWith('--sprache=')); if (a) return a.slice(10); const i = process.argv.indexOf('--sprache'); return i >= 0 ? process.argv[i + 1] : 'de'; })();
if (!['de', 'en', 'hu'].includes(SPRACHE)) { console.error('FEHLER unbekannte Sprache: ' + SPRACHE + ' (erlaubt: de, en, hu)'); process.exit(2); }
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
// HANDBUCH_ADMIN_BILDER=<Ordner>: Bilder nur fuer eine Probe woandershin schreiben (die freigegebenen Bilder bleiben unberuehrt).
const BILDER = process.env.HANDBUCH_ADMIN_BILDER || join(HB, SPRACHE === 'de' ? 'bilder-admin' : 'bilder-admin-' + SPRACHE);
const QUELLE = join(HB, 'handbuch-admin.' + SPRACHE + '.html');
const arg = (name) => { const a = process.argv.find((x) => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : null; };
const NUR_PDF = process.argv.includes('--nur-pdf');
const EINSCHLEUSEN = arg('einschleusen');
const AUSGABE = arg('ausgabe') || join(HB, 'ausgabe', 'handbuch-admin-' + SPRACHE + '.pdf');
// Texte der Admin-Oberflaeche in der Zielsprache (dieselben Dateien, die die Plattform ausliefert): Knoepfe und Meldungen werden ueber ihren Schluessel gesucht.
const T = JSON.parse(readFileSync(join(PLATTFORM, 'texte', SPRACHE + '.json'), 'utf8'));
const U = (k) => { if (typeof T[k] !== 'string') throw new Error('Text fehlt: ' + k + ' (' + SPRACHE + ')'); return T[k]; };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RE = (...k) => new RegExp(k.map((x) => esc(U(x))).join('|'));
// Sprachabhaengige Einstellungen und Beispieldaten (erfunden, nur @example.com). Deutsch: genau die bisherigen Werte.
const SP = {
  de: { locale: 'de-DE', accept: 'de-DE,de;q=0.9', marke: 'Beispiel-Akademie', inhalt: 'Inhaltsverzeichnis',
    fuss: (v) => `<span>Handbuch für den Admin-Bereich · Version ${v}</span><span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span>`,
    verboten: null,
    titelbilder: [['Souverän präsentieren', 'Wirkung, Aufbau und Auftreten'], ['Zeitmanagement im Alltag', 'Prioritäten setzen, Ruhe gewinnen'], ['Gesprächsführung', 'Grundlagen für klare Gespräche'], ['Lernen mit System', 'Kostenloser Schnupperkurs']],
    titelNeu: ['Erfolgreich verhandeln', 'Vorbereitung, Gespräch, Abschluss'], folie: ['LEKTION 2', 'Die Vorbereitung', 'Erfolgreich verhandeln'],
    checkliste: ['Checkliste: Verhandlung vorbereiten', ['Was ist mein Ziel, was mein Minimum?', 'Welche Interessen hat die Gegenseite?', 'Welche Alternativen habe ich?']],
    kurse: [
      ['Souverän präsentieren', 'Vom ersten Satz bis zur letzten Folie: Du lernst, wie du Vorträge klar aufbaust, ruhig auftrittst und dein Publikum erreichst.',
        'Einen Vortrag in drei Teilen klar aufbauen\nDie ersten 30 Sekunden bewusst gestalten\nLampenfieber in Energie verwandeln',
        [['Grundlagen', 'Willkommen und Überblick', 'Schön, dass du dabei bist!'], ['Grundlagen', 'Die ersten 30 Sekunden', 'Drei Möglichkeiten, einen Vortrag zu beginnen.'], ['Praxis', 'Lampenfieber in Energie verwandeln', 'Drei Übungen gegen Anspannung.']]],
      ['Zeitmanagement im Alltag', 'Ein praxisnaher Kurs mit monatlich neuen Impulsen: Prioritäten setzen, Aufgaben bündeln und den Tag mit Ruhe planen.',
        'Wichtiges von Dringendem unterscheiden\nDen Wochenplan in 15 Minuten erstellen',
        [['Start', 'Dein Zeitprotokoll', 'Notiere eine Woche lang, wofür du deine Zeit verwendest.'], ['Start', 'Prioritäten setzen', 'Ordne deine Aufgaben in vier Felder.']]],
      ['Grundlagen der Gesprächsführung', 'Klar, freundlich und auf den Punkt: die wichtigsten Werkzeuge für gute Gespräche im Beruf.',
        'Aktiv zuhören und nachfragen\nSchwierige Gespräche vorbereiten', [['Grundlagen', 'Aktives Zuhören', 'Zuhören heißt: ausreden lassen, zusammenfassen, nachfragen.']]],
      ['Schnupperkurs: Lernen mit System', 'Kostenlos zum Kennenlernen: drei kurze Lektionen, wie du dir Neues schneller merkst.',
        'Wiederholen mit Plan\nLernzeiten richtig wählen', [['Einführung', 'Wie wir lernen', 'Wiederholung in wachsenden Abständen hilft dem Gedächtnis.']]]],
    neu: ['Erfolgreich verhandeln', 'Gut vorbereitet in jedes Gespräch: Du lernst, Ziele festzulegen, Interessen zu erkennen und fair zum Abschluss zu kommen.'],
    lektionen: [['Grundlagen', 'Willkommen und Ziel des Kurses', 'Schön, dass du dabei bist! In vier Lektionen bereitest du eine echte Verhandlung vor. Halte Papier und Stift bereit.'],
      ['Grundlagen', 'Die Vorbereitung', 'Im Video siehst du, wie du Ziel, Minimum und Alternativen festlegst.'],
      ['Praxis', 'Checkliste zur Vorbereitung', 'Fülle die Checkliste vor deinem nächsten Gespräch aus.'],
      ['Praxis', 'Bonus: Gesprächsnotizen', 'Eine Vorlage für deine Notizen während des Gesprächs.']],
    nutzen: 'Ziele und Minimum klar festlegen\nInteressen der Gegenseite erkennen\nEinwände ruhig beantworten\nFair zum Abschluss kommen',
    verkaufGrund: 'Kurse werden überarbeitet', preis: '149,00', standFormat: { day: '2-digit', month: '2-digit', year: 'numeric' },
    lektionSpaeter: ['Praxis', 'Bonus: Einwände ruhig beantworten', 'Drei Sätze, mit denen du auf typische Einwände antwortest.'],
    mails: ['lena.beispiel@example.com', 'jonas.beispiel@example.com', 'mara.beispiel@example.com', 'paul.beispiel@example.com'], dateien: ['die-vorbereitung.mp4', 'checkliste.pdf'] },
  en: { locale: 'en-GB', accept: 'en-GB,en;q=0.9', marke: 'Example Academy', inhalt: 'Contents',
    fuss: (v) => `<span>Admin area manual · Version ${v}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>`,
    verboten: /test ?card|test ?mode|test ?payment|sample/i,
    titelbilder: [['Presenting with confidence', 'Impact, structure and presence'], ['Time management in everyday life', 'Set priorities, gain calm'], ['Conversation skills', 'Basics for clear conversations'], ['Learning with a system', 'Free taster course']],
    titelNeu: ['Negotiating successfully', 'Preparation, conversation, agreement'], folie: ['LESSON 2', 'The preparation', 'Negotiating successfully'],
    checkliste: ['Checklist: preparing a negotiation', ['What is my goal, what is my minimum?', 'What interests does the other side have?', 'What alternatives do I have?']],
    kurse: [
      ['Presenting with confidence', 'From the first sentence to the last slide: you learn how to structure talks clearly, appear calm and reach your audience.',
        'Structure a talk clearly in three parts\nShape the first 30 seconds deliberately\nTurn stage fright into energy',
        [['Basics', 'Welcome and overview', 'Great to have you here!'], ['Basics', 'The first 30 seconds', 'Three ways to open a talk.'], ['Practice', 'Turning stage fright into energy', 'Three exercises against tension.']]],
      ['Time management in everyday life', 'A practical course with new impulses every month: set priorities, bundle tasks and plan your day calmly.',
        'Tell the important from the urgent\nCreate your weekly plan in 15 minutes',
        [['Start', 'Your time log', 'For one week, note down what you spend your time on.'], ['Start', 'Setting priorities', 'Sort your tasks into four fields.']]],
      ['Basics of conversation skills', 'Clear, friendly and to the point: the most important tools for good conversations at work.',
        'Listen actively and ask questions\nPrepare difficult conversations', [['Basics', 'Active listening', 'Listening means: letting others finish, summarising, asking questions.']]],
      ['Taster course: Learning with a system', 'Free, to get to know us: three short lessons on how to remember new things faster.',
        'Review with a plan\nChoose the right learning times', [['Introduction', 'How we learn', 'Repetition at growing intervals helps your memory.']]]],
    neu: ['Negotiating successfully', 'Well prepared for every conversation: you learn to set goals, recognise interests and reach a fair agreement.'],
    lektionen: [['Basics', 'Welcome and course goal', 'Great to have you here! In four lessons you will prepare a real negotiation. Keep pen and paper ready.'],
      ['Basics', 'The preparation', 'In the video you see how to set your goal, your minimum and your alternatives.'],
      ['Practice', 'Preparation checklist', 'Fill in the checklist before your next conversation.'],
      ['Practice', 'Bonus: conversation notes', 'A template for your notes during the conversation.']],
    nutzen: 'Set your goal and minimum clearly\nRecognise the interests of the other side\nAnswer objections calmly\nReach a fair agreement',
    verkaufGrund: 'Courses are being revised', preis: '149.00', standFormat: { day: 'numeric', month: 'long', year: 'numeric' },
    lektionSpaeter: ['Practice', 'Bonus: answering objections calmly', 'Three sentences you can use to answer typical objections.'],
    mails: ['emma.reed@example.com', 'jack.hill@example.com', 'mia.ward@example.com', 'paul.carter@example.com'], dateien: ['the-preparation.mp4', 'checklist.pdf'] },
  hu: { locale: 'hu-HU', accept: 'hu-HU,hu;q=0.9', marke: 'Példa Akadémia', inhalt: 'Tartalomjegyzék',
    fuss: (v) => `<span>Kézikönyv az admin felülethez · ${v}. verzió</span><span><span class="pageNumber"></span>. oldal / <span class="totalPages"></span></span>`,
    verboten: /teszt|minta|kurzus/i,
    titelbilder: [['Magabiztos prezentálás', 'Hatás, felépítés és fellépés'], ['Időgazdálkodás a hétköznapokban', 'Prioritások, több nyugalom'], ['Beszélgetésvezetés', 'Alapok a világos beszélgetésekhez'], ['Tanulás rendszerrel', 'Ingyenes bemutató előadás']],
    titelNeu: ['Sikeres tárgyalás', 'Felkészülés, beszélgetés, megállapodás'], folie: ['2. LECKE', 'A felkészülés', 'Sikeres tárgyalás'],
    checkliste: ['Ellenőrzőlista: a tárgyalás előkészítése', ['Mi a célom, és mi a minimumom?', 'Milyen érdekei vannak a másik félnek?', 'Milyen alternatíváim vannak?']],
    kurse: [
      ['Magabiztos prezentálás', 'Az első mondattól az utolsó diáig: megtanulod, hogyan építs fel világosan egy prezentációt, hogyan lépj fel nyugodtan, és hogyan érd el a közönségedet.',
        'Prezentáció világos felépítése három részben\nAz első 30 másodperc tudatos alakítása\nA lámpaláz átalakítása energiává',
        [['Alapok', 'Üdvözlés és áttekintés', 'Örülök, hogy itt vagy!'], ['Alapok', 'Az első 30 másodperc', 'Három lehetőség egy prezentáció kezdésére.'], ['Gyakorlat', 'A lámpaláz átalakítása energiává', 'Három gyakorlat a feszültség ellen.']]],
      ['Időgazdálkodás a hétköznapokban', 'Gyakorlatias előadás havonta új ötletekkel: prioritások felállítása, feladatok csoportosítása és nyugodt napi tervezés.',
        'A fontos és a sürgős megkülönböztetése\nHeti terv elkészítése 15 perc alatt',
        [['Kezdés', 'Az időnaplód', 'Egy héten át jegyezd fel, mire fordítod az idődet.'], ['Kezdés', 'Prioritások felállítása', 'Sorold a feladataidat négy mezőbe.']]],
      ['A beszélgetésvezetés alapjai', 'Világosan, barátságosan és lényegre törően: a legfontosabb eszközök a jó munkahelyi beszélgetésekhez.',
        'Aktív odafigyelés és visszakérdezés\nNehéz beszélgetések előkészítése', [['Alapok', 'Aktív odafigyelés', 'Odafigyelni annyit jelent: végighallgatni, összefoglalni, visszakérdezni.']]],
      ['Ismerkedés: Tanulás rendszerrel', 'Ingyenes ismerkedés: három rövid lecke arról, hogyan jegyezheted meg gyorsabban az újdonságokat.',
        'Ismétlés terv szerint\nA megfelelő tanulási idő kiválasztása', [['Bevezetés', 'Hogyan tanulunk', 'Az egyre hosszabb időközönkénti ismétlés segíti az emlékezetet.']]]],
    neu: ['Sikeres tárgyalás', 'Jól felkészülve minden beszélgetésre: megtanulod kitűzni a céljaidat, felismerni az érdekeket, és tisztességes megállapodásra jutni.'],
    lektionen: [['Alapok', 'Üdvözlés és az előadás célja', 'Örülök, hogy itt vagy! Négy leckében egy valódi tárgyalásra készülsz fel. Tarts kéznél papírt és tollat.'],
      ['Alapok', 'A felkészülés', 'A videóban megnézed, hogyan határozd meg a célodat, a minimumodat és az alternatíváidat.'],
      ['Gyakorlat', 'Ellenőrzőlista a felkészüléshez', 'Töltsd ki az ellenőrzőlistát a következő beszélgetésed előtt.'],
      ['Gyakorlat', 'Bónusz: jegyzetek a beszélgetéshez', 'Sablon a beszélgetés közbeni jegyzeteidhez.']],
    nutzen: 'A cél és a minimum világos meghatározása\nA másik fél érdekeinek felismerése\nAz ellenvetések nyugodt megválaszolása\nTisztességes megállapodás elérése',
    verkaufGrund: 'Az előadások átdolgozás alatt állnak', preis: '149,00', standFormat: { year: 'numeric', month: 'long', day: 'numeric' },
    lektionSpaeter: ['Gyakorlat', 'Bónusz: nyugodt válasz az ellenvetésekre', 'Három mondat, amellyel a tipikus ellenvetésekre válaszolhatsz.'],
    mails: ['kiss.anna@example.com', 'nagy.bence@example.com', 'toth.reka@example.com', 'szabo.peter@example.com'], dateien: ['a-felkeszules.mp4', 'ellenorzolista.pdf'] },
}[SPRACHE];
const CHROME = process.env.CHROME_PFAD || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PW = process.env.PLAYWRIGHT_CORE || 'C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs';
const PORT = Number(process.env.HANDBUCH_ADMIN_PORT) || 5047, LOKAL = 'http://127.0.0.1:' + PORT, BASE = 'https://kurse.example.com';
const ADMIN = 'betrieb@example.com';
const ADMIN_IP = '203.0.113.25';
const VERSION = '1.0';
// Deckblatt-Logo: neutrales Textlogo fuer den Beispielanbieter (kein Demo-/Musterlogo im PDF)
// Die Breite des Schriftzugs wird im Browser gemessen und die viewBox angepasst: die Schaetzung in marke.mjs ist fuer breite Schriften zu knapp,
// lange Namen wurden rechts abgeschnitten. Das Deckblatt-CSS begrenzt das Logo zusaetzlich auf die Seitenbreite (max-width:100%).
const MARKE_NAME = process.env.HANDBUCH_ADMIN_MARKE || SP.marke;   // HANDBUCH_ADMIN_MARKE nur fuer Proben mit langen Namen (zusammen mit HANDBUCH_ADMIN_BILDER/--ausgabe)
async function logoSchreiben(b) {
  const m = await import('../marke.mjs'); m.setzePlattform(MARKE_NAME); mkdirSync(BILDER, { recursive: true });
  let svg = m.textLogoSvg(true);
  const pg = await b.newPage();
  const breite = await pg.evaluate((s) => { document.body.innerHTML = s; const t = document.querySelectorAll('svg text')[1].getBBox(); return Math.ceil(t.x + t.width + 16); }, svg);
  await pg.close();
  svg = svg.replace(/viewBox="0 0 \d+ 80"/, 'viewBox="0 0 ' + Math.max(200, breite) + ' 80"');
  writeFileSync(join(BILDER, 'marke-logo-vertikal.svg'), svg);
}

// Sichtbare Woerter, die in KEINEM Bild stehen duerfen (geprueft am sichtbaren Seitentext vor jeder Aufnahme).
const BILD_VERBOTEN_DE = /demo|testkarte|testmodus|testzahlung|testumsatz|4242|localhost|127\.0\.0|\/api\/|\b(sk|pk|rk)_(test|live)|whsec_|muster|agent_|vat_|\bnull\b|\bundefined\b|\bNaN\b/i;
// Zielsprache: zusaetzlich die Entsprechungen (EN: test card/test mode/sample, HU: teszt/minta, kurzus statt előadás).
const BILD_VERBOTEN = SP.verboten ? new RegExp(BILD_VERBOTEN_DE.source + '|' + SP.verboten.source, 'i') : BILD_VERBOTEN_DE;

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
  tmp = mkdtempSync(join(tmpdir(), 'handbuch-admin-'));
  process.env.DB_DATEI = join(tmp, 'handbuch.db');
  const dateiOrdner = join(tmp, 'dateien');
  const sicherungOrdner = join(tmp, 'sicherung');
  mkdirSync(join(dateiOrdner, 'vorschau'), { recursive: true });
  mkdirSync(sicherungOrdner, { recursive: true });
  for (const f of readdirSync(BILDER)) if (f.endsWith('.png')) unlinkSync(join(BILDER, f));

  // ---- Stripe-Attrappe (keine Verbindung zu Stripe) ----
  const stripeLog = [];
  let kundenNr = 0, erstattungNr = 0, erstattungScheitert = false;
  const leer = async () => ({ data: [], has_more: false });
  const stripe = {
    customers: { create: async () => ({ id: 'cus_hb_' + (++kundenNr) }), update: async () => ({}), del: async (id) => ({ id, deleted: true }) },
    checkout: { sessions: {
      create: async (p) => { const id = 'cs_hb_' + (stripeLog.length + 1); stripeLog.push({ id, p }); return { id, url: 'https://checkout.stripe.com/c/pay/' + id }; },
      list: leer, expire: async () => ({}), retrieve: async (id) => ({ id, payment_intent: null }) } },
    paymentIntents: { retrieve: async (id) => ({ id, latest_charge: null }) },
    refunds: { create: async () => { if (erstattungScheitert) throw Object.assign(new Error('Beispiel: Erstattung abgelehnt'), { type: 'StripeInvalidRequestError' }); return { id: 're_hb_' + (++erstattungNr), status: 'succeeded' }; }, list: leer },
    billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/p/session/hb' }) } },
    subscriptions: { retrieve: async (id) => ({ id, status: 'active' }), update: async (id) => ({ id }), cancel: async (id) => ({ id }), list: leer },
    invoices: { retrieve: async (id) => ({ id }), list: leer },
    invoicePayments: { list: leer },
    disputes: { list: leer },
    webhooks: { constructEvent: (body) => JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body)) },
  };
  const mails = [];
  const mailer = async (m) => { mails.push(m); return true; };

  const { db } = await import('../db.mjs');
  const { passwortHashen } = await import('../auth.mjs');
  const { ereignisHinzufuegen, ereignisseNachCommit } = await import('../ereignis-liste.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const app = erstelleServer({ stripe, webhookSecret: 'lokal', base: BASE, mailer, dateiOrdner, ellallasWiederaufnahme: false, abgleichAutomatik: false,
    demoModus: false, trustProxy: 1, nodeEnv: 'development', supportMail: 'kontakt@example.com', verkaufsmeldungMail: ADMIN,
    sicherungOrdner, sicherungSchluessel: randomBytes(32), abgleichModus: 'live',
    plattformName: SP.marke, anbieter: { ANBIETER_NAME: SP.marke, ANBIETER_EMAIL: 'kontakt@example.com' } });
  server = app.listen(PORT, '127.0.0.1');
  await new Promise((ja, nein) => { server.once('listening', ja); server.once('error', nein); });
  log('Instanz laeuft auf', LOKAL, '(PID', process.pid + ', Datenbank im Temp-Ordner)');

  // ---- Admin-Konto (wie tools/admin-anlegen.mjs: Rolle admin, bestaetigte Adresse; Passwort nur fuer diesen Lauf) ----
  const adminPasswort = randomBytes(9).toString('base64url') + 'Aa1';
  db.prepare("INSERT INTO benutzer (email,passwort_hash,erstellt,rolle,email_bestaetigt) VALUES (?,?,?,'admin',?)")
    .run(ADMIN, await passwortHashen(adminPasswort), new Date().toISOString(), Date.now());

  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--lang=' + SP.locale] });   // Browsersprache: Platzhalter der Datumsfelder in der Zielsprache
  await logoSchreiben(browser);

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
  const farben = ['#5a3d12', '#1f3d36', '#3a2a4a', '#2c3550'];
  const bilder = [];
  for (const [i, [titel, unter]] of SP.titelbilder.entries()) bilder.push(await titelbild(titel, unter, farben[i]));
  const titelNeu = join(tmp, 'titelbild-verhandeln.png');
  writeFileSync(titelNeu, await titelbild(SP.titelNeu[0], SP.titelNeu[1], '#4a2a12'));
  await werkzeug.setViewportSize({ width: 1280, height: 720 });
  await werkzeug.setContent(`<html><body style="margin:0"><div style="width:1280px;height:720px;background:#14100a;color:#faf6ee;font-family:Georgia,serif;display:flex;flex-direction:column;justify-content:center;align-items:center">
    <div style="font-size:30px;color:#e8c777;font-family:Arial,sans-serif;letter-spacing:4px">${SP.folie[0]}</div><div style="font-size:72px;margin-top:20px">${SP.folie[1]}</div>
    <div style="font-size:28px;margin-top:26px;font-family:Arial,sans-serif;color:#b8ad94">${SP.folie[2]}</div></div></body></html>`);
  const folie = join(tmp, 'folie.png');
  writeFileSync(folie, await werkzeug.screenshot({ type: 'png' }));
  const videoDatei = join(tmp, SP.dateien[0]);
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', folie, '-t', '6', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoDatei]);
  const videoDa = ff.status === 0 && existsSync(videoDatei);
  if (!videoDa) log('WARNUNG: ffmpeg nicht verfuegbar, die Videolektion bleibt ohne Datei.');
  await werkzeug.setContent(`<html><body style="font-family:Arial,sans-serif;color:#211a0e;padding:20px 30px">
    <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:30px;border-bottom:3px solid #d4a843;padding-bottom:10px">${SP.checkliste[0]}</h1>
    ${SP.checkliste[1]
      .map((x, i) => `<h2 style="font-size:18px;margin-top:28px">${i + 1}. ${x}</h2><div style="border:1px solid #e7ddc9;border-radius:8px;height:120px"></div>`).join('')}
    </body></html>`);
  const pdfDatei = join(tmp, SP.dateien[1]);
  writeFileSync(pdfDatei, await werkzeug.pdf({ format: 'A4', printBackground: true }));
  await werkzeug.close();

  // ---- Beispieldaten: vorhandene Kurse (erfunden, wie im Kaeufer-Handbuch) ----
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
  const kursMit = ([titel, beschreibung, nutzen, lektionen], preis, abo, bild) => {
    const id = kursAnlegen(titel, beschreibung, nutzen, preis, abo, bild);
    for (const [abschnitt, lt, inhalt] of lektionen) lektion(id, abschnitt, lt, 'text', inhalt);
    return id;
  };
  const K1 = kursMit(SP.kurse[0], 24900, null, bilder[0]);
  const K2 = kursMit(SP.kurse[1], 8900, [1200, 'month'], bilder[1]);
  const K3 = kursMit(SP.kurse[2], 4900, null, bilder[2]);
  const K4 = kursMit(SP.kurse[3], 0, null, bilder[3]);
  const [T_K1, T_K2] = [SP.kurse[0][0], SP.kurse[1][0]];
  const [T_NEU, L_WILLKOMMEN, L_VIDEO, L_PDF, L_BONUS] = [SP.neu[0], ...SP.lektionen.map((x) => x[1])];

  // ---- Kaeufer ueber die echten Wege der Software (Registrierung, Bestaetigung, Kauf-API, Webhook der Attrappe, Widerruf) ----
  const warteMail = async (pruef) => { for (let i = 0; i < 100; i++) { const m = mails.find(pruef); if (m) return m; await pause(100); } throw new Error('Mail kam nicht'); };
  let ipNr = 10;
  async function kunde(email) {
    const ip = '198.51.100.' + (ipNr++);   // Dokumentationsbereich (RFC 5737), je Konto eine eigene Adresse
    let cookie = 'lang=' + SPRACHE;
    const anfrage = async (methode, pfad, body) => {
      const r = await fetch(LOKAL + pfad, { method: methode, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie, 'X-Forwarded-For': ip },
        body: body !== undefined ? JSON.stringify(body) : undefined });
      for (const c of r.headers.getSetCookie?.() || []) { const [nv] = c.split(';'); const n = nv.split('=')[0]; cookie = cookie.split('; ').filter((x) => !x.startsWith(n + '=')).concat(nv).join('; '); }
      let d = {}; try { d = await r.json(); } catch { /* leer */ }
      return { s: r.status, d };
    };
    const pw = randomBytes(9).toString('base64url') + 'Aa1';
    const reg = await anfrage('POST', '/api/registrieren', { email, passwort: pw, zustimmung: true });
    if (reg.s !== 200 && reg.s !== 201) throw new Error('Registrierung ' + email + ': ' + reg.s);
    const m = await warteMail((x) => x.to === email && /megerosites/.test(x.html || x.text || ''));
    const token = /#\/megerosites\/([A-Za-z0-9_-]{43})/.exec(m.html || m.text)[1];
    const b = await anfrage('POST', '/api/email-bestaetigen', { token });
    if (b.s !== 200) throw new Error('Bestaetigung ' + email + ': ' + b.s);
    const id = db.prepare('SELECT id FROM benutzer WHERE email=?').get(email).id;
    return { email, id, anfrage };
  }
  const webhook = async (ereignis) => {
    const r = await fetch(LOKAL + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 'lokal' }, body: JSON.stringify(ereignis) });
    if (r.status !== 200) throw new Error('Webhook ' + r.status);
  };
  let piNr = 0;
  async function kaufStarten(k, kursId) {
    const r = await k.anfrage('POST', '/api/kurse/' + kursId + '/kaufen', { modell: 'einmal', zustimmung: true });
    if (r.s !== 200) throw new Error('Kauf ' + k.email + ': ' + r.s + ' ' + JSON.stringify(r.d));
    return stripeLog[stripeLog.length - 1];
  }
  async function bezahlt(k, sitzung, kursId, betrag) {
    const kundeId = db.prepare('SELECT stripe_kunde FROM benutzer WHERE id=?').get(k.id).stripe_kunde;
    await webhook({ id: 'evt_' + sitzung.id, type: 'checkout.session.completed', data: { object: {
      id: sitzung.id, mode: 'payment', payment_status: 'paid', customer: kundeId, amount_total: betrag, currency: 'eur', payment_intent: 'pi_hb_' + (++piNr),
      metadata: { kurs_id: String(kursId), benutzer_id: String(k.id), modell: 'einmal', sprache: SPRACHE } } } });
  }

  // ---- Browser: der Admin sieht https://kurse.example.com (umgeleitet auf die lokale Instanz, alles andere blockiert) ----
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 2, locale: SP.locale, bypassCSP: true,
    extraHTTPHeaders: { 'Accept-Language': SP.accept, 'X-Forwarded-For': ADMIN_IP } });
  await ctx.addCookies([{ name: 'lang', value: SPRACHE, url: BASE }]);
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === BASE || url.startsWith(BASE + '/')) {
      try { const antwort = await route.fetch({ url: LOKAL + url.slice(BASE.length) }); return route.fulfill({ response: antwort }); }
      catch { return route.abort(); }
    }
    if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    return route.abort();
  });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());   // window.confirm (Kurspaket, Nachbuchen) – wird hier nicht ausgeloest, Sicherheitsnetz
  const bildListe = [];
  async function textPruefen(name) {
    const text = await p.evaluate(() => document.body.innerText);
    const t = BILD_VERBOTEN.exec(text);
    if (t) throw new Error('Bild ' + name + ': verbotener sichtbarer Text "' + t[0] + '"');
    const fremd = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) || []).filter((m) => !m.endsWith('@example.com'));
    if (fremd.length) throw new Error('Bild ' + name + ': E-Mail-Adresse ausserhalb von example.com');
  }
  async function ruhig() { await p.evaluate(() => document.fonts.ready); await p.evaluate(() => document.activeElement?.blur?.()); await pause(500); }
  async function bild(name, ziel = null, opt = {}) {
    await ruhig(); await textPruefen(name);
    const datei = join(BILDER, name + '.png');
    // Die Kopfzeile klebt beim Scrollen oben und wuerde Ausschnitte verdecken: fuer die Aufnahme nur im Browser feststehend machen (Software unveraendert).
    await p.evaluate(() => { if (!document.getElementById('hb-kopf')) { const s = document.createElement('style'); s.id = 'hb-kopf'; s.textContent = 'header.kopf{position:static!important}'; document.head.append(s); } });
    if (ziel) { const l = typeof ziel === 'string' ? p.locator(ziel).first() : ziel; await l.scrollIntoViewIfNeeded(); await l.screenshot({ path: datei, ...opt }); }
    else await p.screenshot({ path: datei, ...opt });
    bildListe.push(name); log('Bild', name);
  }
  const knopf = (text, bereich = p) => bereich.locator('button', { hasText: text }).first();
  // Genauer Knopftext (Pfeil davor erlaubt): "Up" darf nicht "Upload file" treffen.
  const knopfGenau = (text, bereich = p) => bereich.locator('button', { hasText: new RegExp('^[^\\p{L}]*' + esc(text) + '[^\\p{L}]*$', 'u') }).first();
  const meldungIst = async (re) => {
    try { await p.waitForFunction((q) => new RegExp(q).test(document.querySelector('#app > .meldung')?.textContent || ''), re.source, { timeout: 15000 }); }
    catch { throw new Error('Meldung ' + re + ' kam nicht, sichtbar: "' + (await p.evaluate(() => document.querySelector('#app > .meldung')?.textContent || '')) + '"'); }
  };
  const zurUebersicht = async () => { await p.goto(BASE + '/admin/'); await p.waitForSelector('.kpi-reihe .kpi'); await p.waitForSelector('.ereignis-tabelle, .ereignis-bereich p'); await pause(600); };
  const kursOeffnen = async (titel) => {
    await zurUebersicht();
    await p.locator('article.kurskarte', { hasText: titel }).first().locator('button', { hasText: U('a_megnyitas') }).click();
    await p.waitForSelector(`h2:text("${U('a_leckek')}")`); await pause(500);
  };
  const lektionZeile = (titel) => p.locator('ol.lecken > li', { hasText: titel }).first();
  // Datei-Uploads: Playwright reicht den Rohinhalt eines XHR-PUT (Datei-Objekt) bei der Umleitung nicht weiter. Darum geht der Upload mit DERSELBEN
  // Admin-Sitzung (Cookie des Browsers) und denselben Kopfzeilen wie in admin.js direkt an die Instanz; danach wird die Seite neu geladen.
  const hochladen = async (pfad, datei, mime) => {
    const cookie = (await ctx.cookies(BASE)).map((c) => c.name + '=' + c.value).join('; ');
    const r = await fetch(LOKAL + pfad, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': mime, 'X-Dateiname': encodeURIComponent(datei.split(/[\/]/).pop()), 'X-Forwarded-For': ADMIN_IP }, body: readFileSync(datei) });
    if (r.status !== 201 && r.status !== 200) throw new Error('Upload ' + pfad + ': ' + r.status + ' ' + (await r.text()).slice(0, 120));
  };
  const lektionId = (kursId, titel) => db.prepare('SELECT id FROM lektionen WHERE kurs_id=? AND titel=?').get(kursId, titel).id;

  // 1) Anmeldung (ein Fehlversuch, dann richtig)
  await p.goto(BASE + '/admin/'); await p.waitForSelector('form.karte input[name=email]');
  await p.fill('input[name=email]', ADMIN); await p.fill('input[name=passwort]', 'falsch-' + randomBytes(4).toString('hex'));
  await p.click('form.karte button[type=submit]'); await meldungIst(RE('anmeldung_falsch'));
  await bild('a01-anmeldung-fehler', 'main#app');
  await p.fill('input[name=passwort]', adminPasswort);
  await meldungIst(RE('anmeldung_falsch'));
  await p.evaluate(() => { const m = document.querySelector('#app > .meldung'); m.textContent = ''; m.className = 'meldung'; });
  await bild('a02-anmeldung', 'main#app');
  await p.click('form.karte button[type=submit]'); await p.waitForSelector('.kpi-reihe .kpi');
  await pause(800);

  // 2) Stripe-Abgleich und Datensicherung (vor den Bestellungen: Attrappe kennt keine Zahlungen, der Abgleich bleibt ohne Befund)
  await knopf(U('abgleich_titel')).click(); await p.waitForSelector(`h2:text("${U('abgleich_letzter')}")`);
  await knopf(U('abgleich_jetzt')).click(); await meldungIst(RE('abgleich_ok', 'abgleich_abweichung')); await p.waitForSelector('section.karte p.klein >> nth=1');
  await pause(600); await bild('a30-abgleich');
  await zurUebersicht();
  await knopf(U('sicherung_titel')).click(); await p.waitForSelector(`h2:text("${U('sicherung_eredmeny')}")`);
  await knopf(U('sicherung_jetzt')).click(); await meldungIst(RE('sicherung_ok'));
  await p.waitForFunction(() => document.querySelectorAll('section.karte')[1]?.querySelector('p.klein'), null, { timeout: 15000 });
  await bild('a32-sicherung');

  // 3) Kaeufer und Bestellungen (erfunden, ueber die echten Wege)
  const lena = await kunde(SP.mails[0]);
  const jonas = await kunde(SP.mails[1]);
  const mara = await kunde(SP.mails[2]);
  const paul = await kunde(SP.mails[3]);
  { const s = await kaufStarten(lena, K1); await bezahlt(lena, s, K1, 24900); }
  { const r = await lena.anfrage('POST', '/api/kurse/' + K4 + '/kaufen', { modell: 'einmal' }); if (r.s !== 200) throw new Error('Gratiskurs ' + r.s); }
  {
    // Laufendes Abo (Datensaetze wie nach bestaetigter Stripe-Zahlung; Stripe-Abo-Ereignisse werden hier nicht nachgespielt)
    const bis = Date.now() + 30 * 24 * 3600 * 1000;
    db.prepare("INSERT INTO abos (stripe_abo,stripe_sitzung,benutzer_id,kurs_id,status,gueltig_bis,endet_zum_periodenende,erstellt,geaendert) VALUES ('sub_hb_1','cs_hb_abo',?,?,'aktiv',?,0,?,?)").run(lena.id, K2, bis, jetzt, jetzt);
    db.prepare("INSERT INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert,stripe_abo) VALUES ('in_hb_abo1','pi_hb_abo1',?,?,1200,'eur','bezahlt','abo',?,?,'sub_hb_1')").run(lena.id, K2, jetzt, jetzt);
    db.prepare("INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES (?,?,'abo',?,?)").run(lena.id, K2, jetzt, bis);
    // Weitere Abo-Beispiele fuer die Abo-Liste (Datensaetze wie nach entsprechenden Stripe-Meldungen): gekuendigt zum Periodenende, Zahlung ausstehend
    db.prepare("INSERT INTO abos (stripe_abo,stripe_sitzung,benutzer_id,kurs_id,status,gueltig_bis,endet_zum_periodenende,erstellt,geaendert) VALUES ('sub_hb_2','cs_hb_abo2',?,?,'gekuendigt',?,1,?,?)").run(mara.id, K2, bis - 9 * 24 * 3600 * 1000, jetzt, jetzt);
    db.prepare("INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES (?,?,'abo',?,?)").run(mara.id, K2, jetzt, bis - 9 * 24 * 3600 * 1000);
    db.prepare("INSERT INTO abos (stripe_abo,stripe_sitzung,benutzer_id,kurs_id,status,gueltig_bis,endet_zum_periodenende,erstellt,geaendert) VALUES ('sub_hb_3','cs_hb_abo3',?,?,'zahlung_offen',?,0,?,?)").run(paul.id, K2, Date.now() + 2 * 24 * 3600 * 1000, jetzt, jetzt);
    ereignisHinzufuegen('abo_gestartet', 'hb-abo-1', { kurs_id: K2, benutzer_id: lena.id, betrag: 12, waehrung: 'eur', status: 'bezahlt' }); ereignisseNachCommit();
  }
  // Preisaenderung waehrend einer offenen Zahlung: Jonas startet den Kauf zu 49 EUR, danach wird der Preis auf 59 EUR geaendert (ueber die Admin-Seite
  // des angemeldeten Browsers), die Zahlung kommt zum alten Preis an -> "Zu pruefende Zahlung" (Grund: Betrag/Waehrung passt nicht).
  const sJonas = await kaufStarten(jonas, K3);
  { const r = await p.evaluate(async (id) => (await fetch('/api/admin/kurse/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preis_cent: 5900 }) })).status, K3);
    if (r !== 200) throw new Error('Preisaenderung ' + r); }
  await bezahlt(jonas, sJonas, K3, 4900);
  // Mara kauft Kurs 3 zum neuen Preis und widerruft, ohne den Inhalt geoeffnet zu haben (automatische Erstattung ueber die Attrappe)
  { const s = await kaufStarten(mara, K3); await bezahlt(mara, s, K3, 5900);
    const best = db.prepare("SELECT id FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND status='bezahlt'").get(mara.id, K3);
    const w = await mara.anfrage('POST', '/api/bestellungen/' + best.id + '/ellallas', { bestaetigt: true });
    if (w.s !== 200 || w.d?.ergebnis !== 'erstattung') throw new Error('Widerruf: ' + w.s + ' ' + JSON.stringify(w.d));
    // Danach meldet Stripe die Erstattung per Webhook (charge.refunded), wie im Echtbetrieb: erst dieses Ereignis erzeugt den Eintrag "Erstattung".
    const pi = db.prepare('SELECT zahlung_id FROM bestellungen WHERE id=?').get(best.id).zahlung_id;
    await webhook({ id: 'evt_hb_refund_1', type: 'charge.refunded', data: { object: { id: 'ch_hb_1', payment_intent: pi, refunded: true, amount: 5900, amount_refunded: 5900, currency: 'eur',
      refunds: { data: [{ id: 're_hb_1', amount: 5900, status: 'succeeded' }] } } } }); }
  // Paul kauft Kurs 3 und widerruft; die Erstattung scheitert bei der Attrappe -> Eintrag in "Offene Widerrufe" (Stand: nicht geklappt)
  { const s = await kaufStarten(paul, K3); await bezahlt(paul, s, K3, 5900);
    const best = db.prepare("SELECT id FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND status='bezahlt'").get(paul.id, K3);
    erstattungScheitert = true;
    const w = await paul.anfrage('POST', '/api/bestellungen/' + best.id + '/ellallas', { bestaetigt: true });
    erstattungScheitert = false;
    if (w.d?.ergebnis !== 'fehler') throw new Error('Widerruf (Fehlerbeispiel): ' + w.s + ' ' + JSON.stringify(w.d)); }
  await pause(800);

  // 4) Uebersicht
  await zurUebersicht();
  await p.waitForSelector(`section.karte:has(h2:text("${U('a_pruefen_cim')}")) article`);
  // Ganze Seite, aber nur bis vor die Werkzeugleiste (dort steht die technische Anbindung, die nicht Teil des Handbuchs ist)
  { await bild('a03-uebersicht', null, { fullPage: true, clip: await (async () => { const y = await p.evaluate(() => document.querySelector('nav.admin-werkzeuge').getBoundingClientRect().top + window.scrollY);
      return { x: 0, y: 0, width: 1200, height: Math.floor(y - 8) }; })() }); }
  // Vergroesserte Ausschnitte: oberer Teil (Kennzahlen, Knoepfe, Kursliste) und die ersten Zeilen der Ereignistabelle
  { const y = await p.evaluate(() => document.querySelector('section.karte:has(article.lecke)')?.getBoundingClientRect().top + window.scrollY);
    await bild('a03b-uebersicht-oben', null, { fullPage: true, clip: { x: 40, y: 50, width: 1120, height: Math.floor(y - 60) } }); }
  { const t = p.locator('.ereignis-tabelle'); await t.scrollIntoViewIfNeeded(); const b = await t.boundingBox();
    const sy = await p.evaluate(() => window.scrollY);
    await bild('a03c-ereignisse-tabelle', null, { fullPage: true, clip: { x: b.x, y: b.y + sy, width: b.width, height: Math.min(b.height, 260) } }); }
  await bild('a04-kennzahlen', '.kpi-reihe');
  await bild('a05-hauptknoepfe', '.admin-haupt');
  await bild('a06-kurskarte', p.locator('article.kurskarte', { hasText: T_K1 }).first());
  await bild('a07-pruefen', p.locator('section.karte', { has: p.locator('h2', { hasText: U('a_pruefen_cim') }) }).first());
  { const wb = p.locator('section.karte', { has: p.locator('h2', { hasText: U('a_widerruf_cim') }) }).first();
    await wb.locator('article').first().waitFor({ timeout: 15000 });
    await bild('a07b-widerrufe', wb); }
  await bild('a08-ereignisse', '.ereignis-bereich');
  // Werkzeugleiste nur bis einschliesslich "Datensicherung" (die folgende Schaltflaeche der technischen Anbindung wird nicht abgebildet)
  { const nav = p.locator('nav.admin-werkzeuge'); await nav.scrollIntoViewIfNeeded(); const n = await nav.boundingBox(); const d = await knopf(U('sicherung_titel'), nav).boundingBox();
    const sy = await p.evaluate(() => window.scrollY);
    await bild('a09-werkzeuge', null, { fullPage: true, clip: { x: n.x, y: n.y + sy, width: Math.ceil(d.x + d.width - n.x + 6), height: n.height } }); }

  // 5) Zu pruefende Zahlung bestaetigen
  {
    const box = p.locator('section.karte', { has: p.locator('h2', { hasText: U('a_pruefen_cim') }) }).first();
    await knopf(U('a_pruefen_jovahagyom'), box).click(); await p.waitForSelector('[role=alertdialog]');
    await bild('a10-pruefen-frage', '[role=alertdialog]');
    await knopf(U('a_igen'), p.locator('[role=alertdialog]')).click(); await meldungIst(RE('a_pruefen_erledigt'));
    await p.waitForFunction((q) => document.body.innerText.includes(q), U('a_nincs_pruefen'), { timeout: 15000 });
    await p.evaluate(() => window.scrollTo(0, 0));
    await bild('a11-pruefen-erledigt', p.locator('section.karte', { has: p.locator('h2', { hasText: U('a_pruefen_cim') }) }).first());
  }
  // 6) Ereignisse filtern
  await p.locator('.ereignis-filter select').selectOption('erstattet');
  await p.locator('.ereignis-filter button[type=submit]').click(); await pause(1200);
  await bild('a12-ereignisse-filter', '.ereignis-bereich');

  // 7) Neuen Kurs anlegen (Erfolgreich verhandeln)
  await zurUebersicht();
  await knopf(U('a_uj_kurzus')).click(); await p.waitForSelector('form.karte');
  const kf = p.locator('form.karte').first();
  await kf.locator('input[type=text]').first().fill(T_NEU);
  await kf.locator('textarea').first().fill(SP.neu[1]);
  await kf.locator('select').first().selectOption('eur');
  { // Preisfeld (Block 4): nach der Wahl EUR ist es ein Dezimalfeld mit Platzhalter 49,00 (Englisch 49.00); Reihenfolge der Textfelder: Titel, Preis, Abopreis
    const preis = kf.locator('input[type=text]').nth(1);
    const ph = await preis.getAttribute('placeholder');
    if (ph !== (SPRACHE === 'en' ? '49.00' : '49,00')) throw new Error('Platzhalter EUR stimmt nicht: ' + ph);
    await preis.fill(SP.preis); }
  await bild('a13-neuer-kurs', 'form.karte');
  await knopf(U('a_mentes'), kf).click(); await p.waitForSelector(`h2:text("${U('a_leckek')}")`); await meldungIst(RE('a_kurzus_letrehozva'));
  await bild('a14-kurs-entwurf');
  const KN = db.prepare('SELECT id FROM kurse WHERE titel=?').get(T_NEU).id;
  // Lektionen ueber das Formular
  const neueLektion = async (abschnitt, titel, art, text, bildName) => {
    const f = p.locator('form.karte', { has: p.locator('h3', { hasText: U('a_uj_lecke') }) });
    const felder = f.locator('input[type=text]');
    await felder.nth(0).fill(abschnitt); await felder.nth(1).fill(titel);
    await f.locator('select').selectOption(art); if (text) await f.locator('textarea').fill(text);
    if (bildName) await bild(bildName, f);
    await knopf(U('a_hozzaadas'), f).click(); await meldungIst(RE('a_lecke_hozzaadva')); await pause(400);
  };
  for (const [[abschnitt, titel, text], art, bildName] of SP.lektionen.map((l, i) => [l, ['text', 'video', 'pdf', 'text'][i], ['a15-lektion-neu', 'a16-lektion-neu-video', null, null][i]]))
    await neueLektion(abschnitt, titel, art, text, bildName);
  // Dateien hochladen (Video, PDF)
  if (videoDa) await hochladen('/api/admin/lektionen/' + lektionId(KN, L_VIDEO) + '/datei', videoDatei, 'video/mp4');
  await hochladen('/api/admin/lektionen/' + lektionId(KN, L_PDF) + '/datei', pdfDatei, 'application/pdf');
  await kursOeffnen(T_NEU);
  await bild('a17-lektion-datei', lektionZeile(L_VIDEO));
  // Reihenfolge: Bonus nach oben schieben und wieder zurueck ist unnoetig; Checkliste eine Stelle nach oben
  await knopfGenau(U('a_fel'), lektionZeile(L_PDF)).click(); await meldungIst(RE('a_sorrend_mentve')); await pause(400);
  // Ausblenden
  await knopf(U('a_elrejtes'), lektionZeile(L_BONUS)).click(); await meldungIst(RE('a_lecke_elrejtve')); await pause(400);
  await bild('a18-lektionsliste', 'ol.lecken');
  // Bearbeiten
  await knopf(U('a_szerkesztes'), lektionZeile(L_WILLKOMMEN)).click();
  const bf = p.locator('#app > form.karte').last(); await bf.waitFor();
  await bild('a19-lektion-bearbeiten', bf);
  await p.goto(BASE + '/admin/'); await kursOeffnen(T_NEU);
  // Vorschau: Titelbild und "Das lernst du"
  await hochladen('/api/admin/kurse/' + KN + '/vorschau/titelbild', titelNeu, 'application/octet-stream');
  await kursOeffnen(T_NEU);
  await p.locator('.admin-vorschau textarea').fill(SP.nutzen);
  await knopf(U('a_mentes'), p.locator('.admin-vorschau')).click(); await meldungIst(RE('a_kurzus_mentve', 'a_lecke_mentve')); await pause(500);
  await bild('a20-vorschau', '.admin-vorschau');
  // Kursdaten bearbeiten (aufgeklappt)
  await p.locator('details.karte > summary').click(); await pause(300);
  await bild('a21-kursdaten', 'details.karte');
  await p.locator('details.karte > summary').click();
  await bild('a22-aktionen-entwurf', p.locator('#app > section.karte').filter({ has: p.locator('button', { hasText: U('a_kurs_loeschen') }) }).first());
  // Veroeffentlichen
  await knopf(U('a_kesz')).click(); await p.waitForSelector('.kesz-bereich [role=alertdialog]');
  await bild('a23-veroeffentlichen-frage', '.kesz-bereich');
  await knopf(U('a_igen'), p.locator('.kesz-bereich')).click(); await meldungIst(RE('a_kozzetetel_ok')); await pause(500);
  await p.evaluate(() => window.scrollTo(0, 0));
  await bild('a24-kurs-veroeffentlicht');
  { // Neue Lektion im veroeffentlichten Kurs: entsteht ausgeblendet (Block 4)
    const f = p.locator('form.karte', { has: p.locator('h3', { hasText: U('a_uj_lecke') }) });
    const felder = f.locator('input[type=text]');
    await felder.nth(0).fill(SP.lektionSpaeter[0]); await felder.nth(1).fill(SP.lektionSpaeter[1]);
    await f.locator('select').selectOption('text'); await f.locator('textarea').fill(SP.lektionSpaeter[2]);
    if (!(await f.innerText()).includes(U('a_uj_lecke_rejtett_hinweis'))) throw new Error('Hinweis fuer neue Lektion im veroeffentlichten Kurs fehlt');
    // Nur der obere Teil des Formulars (Ueberschrift, Hinweis, Abschnitt, Titel): dort steht das Neue
    { await f.scrollIntoViewIfNeeded(); const fb = await f.boundingBox(); const tb = await felder.nth(1).boundingBox(); const sy = await p.evaluate(() => window.scrollY);
      await bild('a18b-lektion-neu-ausgeblendet', null, { fullPage: true, clip: { x: fb.x, y: fb.y + sy, width: fb.width, height: Math.ceil(tb.y + tb.height - fb.y + 12) } }); }
    await knopf(U('a_hozzaadas'), f).click(); await meldungIst(RE('a_lecke_hozzaadva_rejtett')); await pause(400);
    if (db.prepare('SELECT status FROM lektionen WHERE kurs_id=? AND titel=?').get(KN, SP.lektionSpaeter[1])?.status !== 'entwurf') throw new Error('Neue Lektion ist nicht ausgeblendet'); }
  await knopf(U('a_archivieren')).click(); await p.waitForSelector('#app > [role=alertdialog]');
  await bild('a25-archivieren-frage', '#app > [role=alertdialog]');
  await knopf(U('a_megse'), p.locator('#app > [role=alertdialog]')).click();

  // 8) Zugaenge (Kurs 1): Liste, Zugang erteilen, Entziehen-Rueckfrage
  await kursOeffnen(T_K1);
  const zb = p.locator('section.karte', { has: p.locator('h2', { hasText: U('a_zugaenge') }) }).first();
  await zb.locator('input[type=email]').fill(paul.email);
  await bild('a26-zugang-erteilen', zb);
  await knopf(U('a_zugang_geben'), zb).click(); await meldungIst(RE('a_zugang_ok')); await pause(500);
  const zb2 = p.locator('section.karte', { has: p.locator('h2', { hasText: U('a_zugaenge') }) }).first();
  await bild('a27-zugaenge', zb2);
  await knopf(U('a_zugang_entziehen'), zb2.locator('.lecke', { hasText: paul.email })).click(); await p.waitForSelector('#app > [role=alertdialog]');
  await bild('a28-zugang-entziehen-frage', '#app > [role=alertdialog]');
  await knopf(U('a_megse'), p.locator('#app > [role=alertdialog]')).click();
  // Kurs 2: Abos
  await kursOeffnen(T_K2);
  await bild('a29-abos', p.locator('section.karte', { has: p.locator('h2', { hasText: U('a_abok') }) }).first());
  await p.locator('details.karte > summary').click(); await pause(300);
  await bild('a21b-kursdaten-abo', 'details.karte');

  // 9) Verkauf pausieren und fortsetzen
  await zurUebersicht();
  await knopf(U('verkauf_titel')).click(); await p.waitForSelector(`h2:text("${U('verkauf_laeuft')}")`);
  await p.locator('textarea').fill(SP.verkaufGrund);
  await bild('a33-verkauf-laeuft');
  await knopf(U('verkauf_pausieren')).click(); await p.waitForSelector('[role=alertdialog]');
  await knopf(U('a_igen'), p.locator('[role=alertdialog]')).click(); await p.waitForSelector(`h2:text("${U('verkauf_pausiert_status')}")`);
  await bild('a34-verkauf-pausiert');
  await knopf(U('verkauf_fortsetzen')).click(); await p.waitForSelector('[role=alertdialog]');
  await knopf(U('a_igen'), p.locator('[role=alertdialog]')).click(); await p.waitForSelector(`h2:text("${U('verkauf_laeuft')}")`);

  // 10) Admin-Anmeldungen, Kurspaket
  await zurUebersicht();
  await knopf(U('admin_logins_titel')).click(); await p.waitForSelector('section.karte p.klein');
  await bild('a31-admin-anmeldungen');
  await zurUebersicht();
  await knopf(U('paket_titel')).click(); await p.waitForSelector('.kurspaket-import');
  await bild('a35-kurspaket');

  // 11) Benachrichtigung an den Betreiber (Widerruf)
  const inhaberMail = mails.find((m) => m.to === ADMIN && (m.subject || '').startsWith(U('ellallas_inhaber_betreff').split('{')[0]));
  if (inhaberMail?.html) {
    const mp = await ctx.newPage(); await mp.setViewportSize({ width: 760, height: 480 });
    await mp.setContent(inhaberMail.html, { waitUntil: 'load' });
    const text = await mp.evaluate(() => document.body.innerText);
    if (BILD_VERBOTEN.test(text)) throw new Error('Mail an Betreiber: verbotener Text');
    await mp.screenshot({ path: join(BILDER, 'a36-mail-widerruf.png'), fullPage: true }); bildListe.push('a36-mail-widerruf'); log('Bild a36-mail-widerruf');
    await mp.close();
  } else log('WARNUNG: keine Widerrufs-Mail an den Betreiber im Speicher');

  await ctx.close();
  log('Bilder:', bildListe.length, '| Mails im Speicher:', mails.length);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Teil 2: PDF (wie im Kaeufer-Handbuch: zwei Durchgaenge fuer die Seitenzahlen im Inhaltsverzeichnis)
// ---------------------------------------------------------------------------------------------------------------------------
async function pdfBauen() {
  if (!browser) { browser = await chromium.launch({ executablePath: CHROME, headless: true }); if (process.env.HANDBUCH_ADMIN_MARKE || !existsSync(join(BILDER, 'marke-logo-vertikal.svg'))) await logoSchreiben(browser); }
  let commit = 'unbekannt';
  try { commit = execFileSync('git', ['-C', PLATTFORM, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* ohne git */ }
  // Deckblatt-Datum je Sprache: DE 12.11.2026, EN 12 November 2026, HU 2026. november 12.
  const stand = new Date().toLocaleDateString(SP.locale, { ...SP.standFormat, timeZone: 'Europe/Budapest' });
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
  if (MARKE_NAME !== SP.marke) await p.evaluate(({ alt, neu }) => { const i = document.querySelector('.deckblatt .marke img'); if (i) i.alt = i.alt.replace(alt, neu); }, { alt: SP.marke, neu: MARKE_NAME });   // Alt-Text des Logos folgt der Probe-Marke
  // Barrierefreiheit (12.11.2026): Sprache, Titel, Ueberschriften, Alt-Texte, th scope, Linktexte, Kontrast WCAG AA (tools/handbuch-barrierefrei.mjs)
  await p.emulateMedia({ media: 'print' });
  const bf = await barrierefreiFehler(p, SPRACHE); if (bf.length) throw new Error('Barrierefreiheit: ' + bf.join('; '));
  // Lesezeichen (12.11.2026): Leerzeichen am Zeilenumbruch des Titels, kein doppeltes Zierzeichen (tools/handbuch-barrierefrei.mjs)
  const lz = await lesezeichenVorbereiten(p); if (lz.length) throw new Error('Lesezeichen-Vorbereitung: ' + lz.join('; '));
  const optionen = { format: 'A4', printBackground: true, displayHeaderFooter: true, preferCSSPageSize: false, tagged: true, outline: true,   // Barrierefreiheit: getaggtes PDF + Lesezeichen (Playwright 1.64 page.pdf)
    margin: { top: '16mm', bottom: '18mm', left: '17mm', right: '17mm' },
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="font-family:Arial,sans-serif;font-size:7.5px;color:#7d7362;width:100%;padding:0 17mm;display:flex;justify-content:space-between">
      ${SP.fuss(VERSION)}</div>` };
  const kapitel = await p.evaluate(() => [...document.querySelectorAll('h2.kapitel')].map((h) => ({ id: h.id, text: h.textContent.replace(/\s+/g, '') })));
  const seiten1 = await pdfSeitenText(await p.pdf(optionen));
  const inhaltSeite = seiten1.findIndex((s) => s.includes(SP.inhalt));
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
