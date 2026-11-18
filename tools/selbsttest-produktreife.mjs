import './test-sprache.mjs';
// Produktreife Block 1 (12.11.2026): Demo-/Test-/Muster-Texte nur im Demo-Modus, Betreiber-Rechtsseiten konfigurierbar.
// Aufruf (im Ordner plattform): node tools/selbsttest-produktreife.mjs
// Teil A: Texte (DE/EN/HU), mail-recht.mjs (Kaufmail-Bausteine) und Quelltext von kunde.js/mail.mjs.
// Teil B: zwei EIGENE Instanzen als Kindprozesse (Port 4531 ohne Demo, Port 4532 mit Demo; je eigene Temp-Datenbank, Stripe-Attrappe,
//         keine Mails, kein Netz) und HTTP-Pruefung von /api/anbieter und /jogi/* in DE/EN/HU.
// Teil C: echter Chrome (headless, playwright-core aus C:\Users\diaco\Projekte\browser-werkzeug): Kursliste, Kursseite, Widerrufsbelehrung,
//         Fusszeile in DE/EN/HU. Fehlt Chrome/playwright-core, wird Teil C sichtbar als UEBERSPRUNGEN gemeldet (A und B laufen trotzdem).
// Beendet nur die eigenen Kindprozesse und den eigenen Browser.
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const PLATTFORM = resolve(HIER, '..');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------------------------
// Kindprozess: eine Instanz starten (node tools/selbsttest-produktreife.mjs --server <port> <demo 0|1>)
// ---------------------------------------------------------------------------------------------------------------------------
if (process.argv[2] === '--server') {
  const port = Number(process.argv[3]), demo = process.argv[4] === '1';
  const stripe = { customers: { create: async () => ({ id: 'cus_pr' }), update: async () => ({}) },
    checkout: { sessions: { create: async () => ({ id: 'cs_pr', url: 'https://checkout.stripe.com/test' }), retrieve: async () => ({ payment_intent: 'pi_pr' }), list: async () => ({ data: [] }), expire: async () => ({}) } },
    paymentIntents: { retrieve: async (id) => ({ id }) }, refunds: { create: async () => ({ id: 're_pr' }), list: async () => ({ data: [] }) },
    billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/test' }) } }, webhooks: { constructEvent: () => ({}) } };
  const { db } = await import('../db.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const jetzt = new Date().toISOString();
  db.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES (?,?,?,'eur','veroeffentlicht',?,?)")
    .run('Souverän präsentieren', 'Vortraege klar aufbauen und ruhig auftreten.', 24900, jetzt, jetzt);
  const app = erstelleServer({ stripe, webhookSecret: 'x', base: 'http://127.0.0.1:' + port, mailer: async () => true, dateiOrdner: join(dirname(process.env.DB_DATEI), 'dateien'),
    ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: demo, trustProxy: 0,
    anbieter: { ANBIETER_NAME: 'Beispiel Akademie GmbH', ANBIETER_EMAIL: 'kontakt@example.com' },
    rechtsseiten: demo ? {} : { impresszum: 'https://betreiber.example.com/impressum' } });
  app.listen(port, '127.0.0.1');
} else {
// ---------------------------------------------------------------------------------------------------------------------------
// Pruefer
// ---------------------------------------------------------------------------------------------------------------------------
let ok = 0, fail = 0, uebersprungen = 0;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' | ' + String(d).slice(0, 300))); };
const SPRACHEN = ['de', 'en', 'hu'];
const T = Object.fromEntries(SPRACHEN.map((l) => [l, JSON.parse(readFileSync(join(PLATTFORM, 'texte', l + '.json'), 'utf8'))]));
// Sichtbare Demo-/Test-/Muster-Hinweise, die OHNE Demo-Modus nirgends erscheinen duerfen (alle drei Sprachen).
const VERBOTEN = /\bdemo\b|demó|demonstr|testkarte|tesztkártya|test card|testzahlung|tesztfizetés|test payment|testmodus|teszt mód|test mode|\(muster\)|\(sample\)|mintaplatform|musterplattform|sample platform|demo platform|beispielkurs|sample course|példa-előadás|platzhalter|placeholder|erfunden|fictitious|kitalált|musterfirma|mustermann/i;
const kinder = [];
const dirs = [];
try {
  // ---- Teil A: Texte ----
  for (const l of SPRACHEN) {
    check(`[${l}] mailrecht_ellallas_titel ohne Muster-/Demo-Kennzeichen`, !VERBOTEN.test(T[l].mailrecht_ellallas_titel) && !/muster|sample|minta/i.test(T[l].mailrecht_ellallas_titel), T[l].mailrecht_ellallas_titel);
    check(`[${l}] mailrecht_ellallas_titel_demo vorhanden (Demo unveraendert)`, typeof T[l].mailrecht_ellallas_titel_demo === 'string' && T[l].mailrecht_ellallas_titel_demo.length > 0);
    check(`[${l}] recht_nicht_hinterlegt vorhanden und neutral`, typeof T[l].recht_nicht_hinterlegt === 'string' && T[l].recht_nicht_hinterlegt.length > 5 && !VERBOTEN.test(T[l].recht_nicht_hinterlegt));
    check(`[${l}] bunny_aus (Fehlermeldung auch im Normalbetrieb) ohne Muster-/Demo-Version`, !/muster|demo|minta/i.test(T[l].bunny_aus), T[l].bunny_aus);
  }
  check('Demo-Titel DE/EN unveraendert wie live', T.de.mailrecht_ellallas_titel_demo === 'Widerrufsbelehrung (Muster)' && T.en.mailrecht_ellallas_titel_demo === 'Withdrawal information (sample)' && T.hu.mailrecht_ellallas_titel_demo === 'Elállási tájékoztató');

  // ---- Teil A: Kaufmail-Bausteine (Widerrufsbelehrung, Formular, Rechtslinks) ----
  process.env.DB_DATEI = join(mkdtempSync(join(tmpdir(), 'produktreife-a-')), 'a.db');
  dirs.push(dirname(process.env.DB_DATEI));
  const { mitSprache } = await import('../texte.mjs');
  const recht = await import('../mail-recht.mjs');
  for (const l of SPRACHEN) {
    await mitSprache(l, async () => {
      const ohne = [...recht.widerrufsZeilen({ anbieter: {}, demo: false }), ...recht.rechtLinks('https://k.example.com', false)].join('\n');
      check(`[${l}] Kaufmail ohne Demo: kein Muster-/Demo-Titel`, !ohne.includes(T[l].mailrecht_ellallas_titel_demo) || T[l].mailrecht_ellallas_titel_demo === T[l].mailrecht_ellallas_titel, ohne.slice(0, 120));
      check(`[${l}] Kaufmail ohne Demo, ohne Anbieterangaben: "${T[l].recht_nicht_hinterlegt}" statt Platzhalter "..."`, ohne.includes(T[l].recht_nicht_hinterlegt) && !/: \.\.\., \.\.\., \.\.\./.test(ohne), ohne.slice(0, 300));
      const mit = recht.widerrufsZeilen({ anbieter: { ANBIETER_NAME: 'A GmbH', ANBIETER_ANSCHRIFT: 'Weg 1', ANBIETER_EMAIL: 'a@example.com' }, demo: false }).join('\n');
      check(`[${l}] Kaufmail ohne Demo, mit Anbieterangaben: Angaben im Formular, kein Hinweis`, mit.includes('A GmbH, Weg 1, a@example.com') && !mit.includes(T[l].recht_nicht_hinterlegt));
      const demo = [...recht.widerrufsZeilen({ anbieter: {}, demo: true }), ...recht.rechtLinks('https://k.example.com', true)].join('\n');
      check(`[${l}] Kaufmail im Demo-Modus wie heute (Demo-Titel, Platzhalter "...")`, demo.includes(T[l].mailrecht_ellallas_titel_demo) && demo.includes('..., ..., ...') && !demo.includes(T[l].recht_nicht_hinterlegt), demo.slice(0, 200));
    });
  }
  const mailQ = (readFileSync(join(PLATTFORM, 'mail.mjs'), 'utf8') + String.fromCharCode(10) + readFileSync(join(PLATTFORM, 'kaufmail-vorlage.mjs'), 'utf8'));
  check('mail.mjs: Kaufmail gibt den Demo-Modus an Widerrufsbelehrung und Rechtslinks weiter', mailQ.includes('demo:!!demoModus}),...rechtLinks(base,!!demoModus))') && mailQ.includes('rechtLinks(base,!!demoModus).includes(v)') && mailQ.includes('v===ellallasTitel(!!demoModus)'));

  // ---- Teil A: Quelltext kunde.js: jeder Demo-Hinweis haengt am Demo-Schalter ----
  const kunde = readFileSync(join(PLATTFORM, 'public', 'kunde.js'), 'utf8').split(/\r?\n/);
  // (demo_box_* und demo_reset_hinweis stehen in demoBox(), die ohne demo:true sofort null liefert; das prueft Teil C im Browser.)
  for (const key of ['k_demo_kurs', 'k_kaufbox_demo', 'k_anbieter_demo', 'mailrecht_ellallas_titel_demo']) {
    const zeilen = kunde.filter((z) => z.includes("'" + key + "'"));
    check(`kunde.js: '${key}' nur hinter dem Demo-Schalter (${zeilen.length} Stelle(n))`, zeilen.length > 0 && zeilen.every((z) => /DEMO|\bdemo\b|d\?\.demo/.test(z)), zeilen.join(' || ').slice(0, 300));
  }
  check("kunde.js: kein t('mailrecht_ellallas_titel') ohne Demo-Unterscheidung", !kunde.some((z) => z.includes("t('mailrecht_ellallas_titel')")));
  check('kunde.js: Demo-Schalter aus /api/anbieter (demo:true/false)', kunde.some((z) => z.includes("DEMO = !!(an.ok && an.d?.demo)")));

  // ---- Teil B: zwei Instanzen ----
  const starte = (port, demo) => {
    const d = mkdtempSync(join(tmpdir(), 'produktreife-' + (demo ? 'demo' : 'prod') + '-')); dirs.push(d);
    const env = { ...process.env, DB_DATEI: join(d, 'test.db'), TEXT_SPRACHE: 'de' };
    const k = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), '--server', String(port), demo ? '1' : '0'], { env, cwd: PLATTFORM, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; k.stderr.on('data', (c) => { err += c; }); kinder.push(k); k.fehlertext = () => err;
    return k;
  };
  const PROD = 'http://127.0.0.1:4531', DEMO = 'http://127.0.0.1:4532';
  const kp = starte(4531, false), kd = starte(4532, true);
  const bereit = async (b) => { for (let i = 0; i < 80; i++) { try { const r = await fetch(b + '/api/anbieter'); if (r.ok) return true; } catch { /* noch nicht */ } await warte(250); } return false; };
  check('Instanz ohne Demo (4531) gestartet', await bereit(PROD), kp.fehlertext());
  check('Instanz mit Demo (4532) gestartet', await bereit(DEMO), kd.fehlertext());
  const holen = async (b, pfad, l, opt = {}) => { const r = await fetch(b + pfad, { redirect: 'manual', headers: { Cookie: 'lang=' + l, Accept: 'text/html', ...opt } }); return { s: r.status, ort: r.headers.get('location'), text: await r.text() }; };
  const ap = await (await fetch(PROD + '/api/anbieter')).json(), ad = await (await fetch(DEMO + '/api/anbieter')).json();
  check('/api/anbieter meldet demo:false ohne Demo-Modus, demo:true mit Demo-Modus (keine Geheimnisse: nur anbieter + demo)', ap.demo === false && ad.demo === true && Object.keys(ap).sort().join() === 'anbieter,demo', JSON.stringify(ap));
  for (const l of SPRACHEN) {
    const imp = await holen(PROD, '/jogi/impresszum/', l);
    check(`[${l}] ohne Demo: /jogi/impresszum/ leitet auf die hinterlegte Betreiber-Adresse (302)`, imp.s === 302 && imp.ort === 'https://betreiber.example.com/impressum', imp.s + ' ' + imp.ort);
    for (const [seite, key] of [['adatvedelem', 'k_adatvedelem'], ['reszveteli-feltetelek', 'k_feltetelek']]) {
      for (const pfad of ['/jogi/' + seite + '/', '/jogi/' + seite + '/index.html', '/jogi/' + seite]) {
        const r = await holen(PROD, pfad, l);
        check(`[${l}] ohne Demo: ${pfad} neutral "${T[l].recht_nicht_hinterlegt}" (ohne Muster-/Demotext)`, r.s === 200 && r.text.includes('lang="' + l + '"') && r.text.includes('<h1>' + T[l][key] + '</h1>') && r.text.includes(T[l].recht_nicht_hinterlegt) && !VERBOTEN.test(r.text), r.s + ' ' + r.text.slice(0, 200));
      }
      const d = await holen(DEMO, '/jogi/' + seite + '/', l);
      check(`[${l}] mit Demo: /jogi/${seite}/ zeigt die Muster-Seite wie heute`, d.s === 200 && /DEMONSTR/.test(d.text) && !d.text.includes(T[l].recht_nicht_hinterlegt), d.text.slice(0, 160));
    }
    const di = await holen(DEMO, '/jogi/impresszum/', l);
    check(`[${l}] mit Demo: /jogi/impresszum/ Muster-Impressum wie heute (keine Weiterleitung)`, di.s === 200 && /DEMONSTR/.test(di.text) && /Muster/.test(di.text));
  }

  // ---- Teil C: Browser ----
  const PW = process.env.PLAYWRIGHT_CORE || 'C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs';
  const CHROME = process.env.CHROME_PFAD || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (!existsSync(PW) || !existsSync(CHROME)) {
    uebersprungen++; console.log('UEBERSPRUNGEN Teil C (Browser): playwright-core oder Chrome fehlt (' + (existsSync(PW) ? CHROME : PW) + ')');
  } else {
    const { chromium } = await import(pathToFileURL(PW).href);
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
      const kursId = 1;
      for (const l of SPRACHEN) {
        for (const [basis, demo] of [[PROD, false], [DEMO, true]]) {
          const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: l });
          await ctx.addCookies([{ name: 'lang', value: l, url: basis }]);
          const p = await ctx.newPage();
          const art = demo ? 'mit Demo' : 'ohne Demo';
          // Kursliste + Fusszeile
          await p.goto(basis + '/#/', { waitUntil: 'load' });
          await p.waitForSelector('.kurzus-kartya', { timeout: 8000 }).catch(() => {});
          await p.waitForTimeout(400);
          const liste = await p.evaluate(() => ({ text: document.body.innerText, plakette: document.querySelectorAll('.demo-plakette').length, karten: document.querySelectorAll('.kurzus-kartya').length, fuss: document.querySelector('.fuss-links')?.innerText || '' }));
          if (!demo) {
            const v = VERBOTEN.exec(liste.text);
            check(`[${l}] ${art}: Kursliste ohne Demo-/Test-/Muster-Text, keine Demo-Plakette`, liste.karten === 1 && liste.plakette === 0 && !v, (v ? v[0] : '') + ' karten=' + liste.karten + ' plakette=' + liste.plakette);
            check(`[${l}] ${art}: Fusszeile "${T[l].mailrecht_ellallas_titel}" ohne (Muster)`, liste.fuss.includes(T[l].mailrecht_ellallas_titel) && (T[l].mailrecht_ellallas_titel_demo === T[l].mailrecht_ellallas_titel || !liste.fuss.includes(T[l].mailrecht_ellallas_titel_demo)), liste.fuss);
          } else {
            check(`[${l}] ${art}: Kursliste wie heute (Demo-Plakette "${T[l].k_demo_kurs}", Demo-Kasten)`, liste.plakette === 1 && liste.text.toLowerCase().includes(T[l].k_demo_kurs.toLowerCase()) && liste.text.toLowerCase().includes(T[l].demo_box_titel.toLowerCase()), 'plakette=' + liste.plakette);
            check(`[${l}] ${art}: Fusszeile wie heute ("${T[l].mailrecht_ellallas_titel_demo}")`, liste.fuss.includes(T[l].mailrecht_ellallas_titel_demo), liste.fuss);
          }
          // Kursseite
          await p.goto(basis + '/#/kurs/' + kursId, { waitUntil: 'load' });
          await p.waitForSelector('.preis-kasten', { timeout: 8000 }).catch(() => {});
          await p.waitForFunction(() => document.querySelector('.anbieter-block h3'), null, { timeout: 5000 }).catch(() => {});
          await p.waitForTimeout(300);
          const kurs = await p.evaluate(() => ({ text: document.body.innerText, kaufdemo: document.querySelectorAll('.kaufbox-demo').length, anbieterKlein: document.querySelectorAll('.anbieter-block p.klein').length, anbieter: document.querySelector('.anbieter-block')?.innerText || '' }));
          check(`[${l}] ${art}: Anbieterkasten ohne Text "null" (Kinder-null im Client)`, !/(^|\s)null(\s|$)/.test(kurs.anbieter), JSON.stringify(kurs.anbieter.slice(0,80)));
          if (!demo) {
            const v = VERBOTEN.exec(kurs.text);
            check(`[${l}] ${art}: Kursseite ohne Demo-/Testkarten-Hinweis, Anbieterkasten ohne Demo-Satz`, kurs.kaufdemo === 0 && kurs.anbieterKlein === 0 && kurs.anbieter.includes('Beispiel Akademie GmbH') && !v, (v ? v[0] : '') + ' ' + JSON.stringify([kurs.kaufdemo, kurs.anbieterKlein, kurs.anbieter.slice(0, 80)]));
          } else {
            check(`[${l}] ${art}: Kursseite wie heute (Kaufbox-Demo-Hinweis und Demo-Satz im Anbieterkasten)`, kurs.kaufdemo === 1 && kurs.anbieterKlein === 1 && kurs.text.includes(T[l].k_kaufbox_demo) && kurs.text.includes(T[l].k_anbieter_demo), JSON.stringify([kurs.kaufdemo, kurs.anbieterKlein]));
          }
          // Widerrufsbelehrung
          await p.goto(basis + '/#/elallasi-tajekoztato', { waitUntil: 'load' });
          await p.waitForSelector('.mailrecht-muster', { timeout: 8000 }).catch(() => {});
          await p.waitForTimeout(300);
          const wb = await p.evaluate(() => ({ text: document.body.innerText, h1: document.querySelector('h1')?.innerText || '' }));
          if (!demo) {
            const v = VERBOTEN.exec(wb.text);
            check(`[${l}] ${art}: Widerrufsbelehrung ohne (Muster), fehlende Anschrift als "${T[l].recht_nicht_hinterlegt}"`, wb.h1 === T[l].mailrecht_ellallas_titel && wb.text.includes(T[l].recht_nicht_hinterlegt) && !v, (v ? v[0] : '') + ' h1=' + wb.h1);
          } else {
            check(`[${l}] ${art}: Widerrufsbelehrung wie heute ("${T[l].mailrecht_ellallas_titel_demo}", Platzhalter "...")`, wb.h1 === T[l].mailrecht_ellallas_titel_demo && !wb.text.includes(T[l].recht_nicht_hinterlegt) && wb.text.includes('...'), 'h1=' + wb.h1);
          }
          await ctx.close();
        }
      }
    } finally { await browser.close(); }
  }
} catch (e) {
  check('Testablauf', false, e.stack || e.message);
} finally {
  for (const k of kinder) { try { k.kill(); } catch { /* ignorieren */ } }
  await warte(500);
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignorieren */ } }
}
console.log(`\nProduktreife: ${ok} bestanden, ${fail} fehlgeschlagen` + (uebersprungen ? `, Teil C uebersprungen` : ''));
process.exit(fail ? 1 : 0);
}
