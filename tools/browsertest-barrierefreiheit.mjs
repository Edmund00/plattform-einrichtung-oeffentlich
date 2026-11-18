// Browsertest Barrierefreiheit (A10-02, A10-03, A10-04; Gesamtpruefung 12.11.2026). NICHT Teil von Selbsttest-Alle (braucht Chrome und
// playwright-core unter C:\Users\diaco\Projekte\browser-werkzeug). Startet die Plattform im Demo-Modus auf Port 4459 (Mock-Stripe, keine Mails,
// Temp-DB) und prueft in echtem Chrome: (1) Fokusring-Farbe mit WCAG-Kontrast >= 3:1 gegen Weiss, Elfenbein, Schwarz und Nacht (berechnet aus dem
// tatsaechlich gerenderten outline-color); (2) Seitentitel wechselt je Route; (3) nach Routenwechsel liegt der Fokus auf der Hauptueberschrift,
// beim ersten Laden NICHT; (4) kein Scroll-Sprung durch den Fokus (alle focus()-Aufrufe mit preventScroll); (5) Kunden- und Admin-Seite haben genau eine main-Landmarke.
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'schulung-a11y-'));
process.env.DB_DATEI = join(dir, 'test.db');
let ok = 0, fail = 0, server, browser;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + String(d).slice(0, 300))); };
const PORT = Number(process.env.PORT_A11Y || 4459), BASE = 'http://127.0.0.1:' + PORT;
const stripe = { customers: { create: async () => ({ id: 'cus_demo' }), update: async () => ({}) },
  checkout: { sessions: { create: async () => ({ id: 'cs_demo', url: 'https://checkout.stripe.com/test' }), retrieve: async () => ({ payment_intent: 'pi_demo' }), list: async () => ({ data: [] }), expire: async () => ({}) } },
  paymentIntents: { retrieve: async (id) => ({ id }) }, refunds: { create: async () => ({ id: 're_demo' }), list: async () => ({ data: [] }) },
  billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/test' }) } }, webhooks: { constructEvent: () => ({}) } };
// WCAG 2.x relative Leuchtdichte und Kontrastverhaeltnis
const lum = ([r, g, b]) => { const c = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const kontrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const rgb = (s) => (String(s).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
const FLAECHEN = { weiss: [255, 255, 255], elfenbein: [250, 246, 238], schwarz: [0, 0, 0], nacht: [13, 10, 5] };
try {
  const demo = await import('../demo.mjs');
  const { erstelleServer } = await import('../app.mjs');
  await demo.demoSeedWennLeer();
  server = erstelleServer({ stripe, base: BASE, webhookSecret: 'x', mailer: async () => true, dateiOrdner: join(dir, 'dateien'), ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: true, trustProxy: 1 }).listen(PORT, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 600));
  const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 700 }, locale: 'de-DE' });
  await ctx.addCookies([{ name: 'lang', value: 'de', url: BASE }]);
  // Jeder focus()-Aufruf der Seite wird mit seinen Optionen mitgeschrieben (Beleg fuer preventScroll, unabhaengig von der Seitenlaenge).
  await ctx.addInitScript(() => { const orig = HTMLElement.prototype.focus; window.__fokus = []; HTMLElement.prototype.focus = function (o) { window.__fokus.push({ tag: this.tagName, preventScroll: !!(o && o.preventScroll) }); return orig.call(this, o); }; });
  const p = await ctx.newPage();
  await p.goto(BASE + '/?lang=de#/');
  await p.waitForSelector('a[href^="#/kurs/"]', { timeout: 8000 });
  await p.waitForTimeout(400);
  // (5) main-Landmarke Kundenseite
  check('Kundenseite: genau eine main-Landmarke', (await p.getByRole('main').count()) === 1);
  // (3) erster Aufruf: Fokus bleibt, wo der Browser ihn hat (kein Sprung beim Laden)
  check('Erster Aufruf: Fokus wird nicht verschoben', await p.evaluate(() => document.activeElement === document.body));
  const titelStart = await p.title();
  check('Startseite hat einen Titel', titelStart.trim().length > 0, titelStart);
  // (1) Fokusring per Tastatur (focus-visible) auf einen Kurs-Link
  const link = p.locator('a[href^="#/kurs/"]').first();
  await link.focus(); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
  const ring = await p.evaluate(() => { const s = getComputedStyle(document.activeElement); return { farbe: s.outlineColor, stil: s.outlineStyle, breite: parseFloat(s.outlineWidth), href: document.activeElement.getAttribute('href') }; });
  check('Fokusring sichtbar (solid, mind. 2 px)', ring.stil === 'solid' && ring.breite >= 2, JSON.stringify(ring));
  for (const [name, flaeche] of Object.entries(FLAECHEN)) {
    const k = kontrast(rgb(ring.farbe), flaeche);
    check('Fokusring ' + ring.farbe + ' gegen ' + name + ': Kontrast ' + k.toFixed(2) + ':1 >= 3:1 (WCAG 1.4.11)', k >= 3);
  }
  // (2)+(3)+(4) Routenwechsel per Tastatur (Enter)
  await p.evaluate(() => { window.__fokus = []; });
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => location.hash.startsWith('#/kurs/') && document.querySelector('main h1, main h2') && !document.querySelector('main')?.textContent.includes('...'), null, { timeout: 8000 });
  await p.waitForTimeout(500);
  const nach = await p.evaluate(() => {
    const u = document.querySelector('main h1, main h2'); const a = document.activeElement;
    return { titel: document.title, ueberschrift: u?.textContent.trim(), fokusAufUeberschrift: a === u, tabindex: u?.getAttribute('tabindex'), tag: a?.tagName, fokusAufrufe: window.__fokus };
  });
  check('Routenwechsel: Seitentitel wechselt und nennt die Ueberschrift', nach.titel !== titelStart && nach.titel.includes(nach.ueberschrift), nach.titel + ' / ' + titelStart);
  check('Routenwechsel: Fokus auf der Hauptueberschrift (tabindex -1)', nach.fokusAufUeberschrift && nach.tabindex === '-1', JSON.stringify(nach));
  check('Routenwechsel: kein Scroll-Sprung, jeder Fokus-Aufruf der Weiche mit preventScroll', nach.fokusAufrufe.length > 0 && nach.fokusAufrufe.every((f) => f.preventScroll), JSON.stringify(nach.fokusAufrufe));
  check('Routenwechsel: weiterhin genau eine main-Landmarke', (await p.getByRole('main').count()) === 1);
  // Zurueck (Browser-Zurueck = hashchange): Titel wieder der Startseitentitel, Fokus wieder auf der Ueberschrift
  await p.goBack(); await p.waitForTimeout(900);
  const zurueck = await p.evaluate(() => ({ titel: document.title, fokus: document.activeElement === document.querySelector('main h1, main h2') }));
  check('Zurueck: Titel der Startseite und Fokus auf deren Ueberschrift', zurueck.titel === titelStart && zurueck.fokus, JSON.stringify(zurueck));
  // Fehlerseite nach Routenwechsel: vorhandener Fehlertext ist h1, Fokus und Titel dort
  await p.evaluate(() => { location.hash = '#/passwort-neu/ungueltig'; }); await p.waitForTimeout(700);
  const fs = await p.evaluate(() => { const u = document.querySelector('main h1'); return { text: u?.textContent.trim(), fokus: document.activeElement === u, titel: document.title, rot: u?.classList.contains('meldung') }; });
  check('Fehlerseite: Fehlertext als h1, Fokus darauf, Titel nennt ihn', !!fs.text && fs.fokus && fs.rot && fs.titel.startsWith(fs.text), JSON.stringify(fs));
  // Widerrufsablauf (Zwischenschritte ohne Routenwechsel): jeder Schritt hat eine Ueberschrift, Titel und Fokus folgen
  const z = await ctx.request.post(BASE + '/api/demo/zugang', { data: { rolle: 'kaeufer' } });
  check('Demo-Kaeufer-Zugang', z.ok(), z.status());
  { const { db } = await import('../db.mjs'); const kid = db.prepare("SELECT benutzer_id FROM demo_konten WHERE art='kaeufer' ORDER BY benutzer_id DESC LIMIT 1").get()?.benutzer_id; const j = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt) VALUES (?,3,'zahlung',?)").run(kid, j);
    db.prepare("INSERT OR IGNORE INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert) VALUES (?,?,?,3,14900,'eur','bezahlt',?,?)").run('cs_test_a11y_' + kid, 'pi_a11y_' + kid, kid, j, j); }
  const T = await (await ctx.request.get(BASE + '/api/texte')).json();
  await p.goto(BASE + '/?lang=de&neu=1#/fiokom');   // neue Adresse = echtes Neuladen (Anmeldung ist neu) await p.waitForSelector('main h1'); await p.waitForTimeout(500);
  const schritt = async (knopf, erwartet) => {
    await p.locator('main button', { hasText: knopf }).first().click(); await p.waitForTimeout(700);
    return p.evaluate((e) => { const a = document.activeElement; return { tag: a?.tagName, text: a?.textContent.trim(), tabindex: a?.getAttribute('tabindex'), titel: document.title, ok: /^H[12]$/.test(a?.tagName || '') && a.textContent.trim() === e && document.title.startsWith(e) }; }, erwartet);
  };
  const s1 = await schritt(T.k_elallas, T.k_elallas);
  check('Widerruf Schritt 1: Fokus auf Ueberschrift "' + T.k_elallas + '", Titel passend', s1.ok && s1.tabindex === '-1', JSON.stringify(s1));
  const s2 = await schritt(T.k_ellallas_tovabb, T.k_ellallas_megerosites);
  check('Widerruf nach "' + T.k_ellallas_tovabb + '": Fokus auf Ueberschrift "' + T.k_ellallas_megerosites + '", Titel passend', s2.ok && s2.tabindex === '-1', JSON.stringify(s2));
  const s3 = await schritt(T.k_ellallas_megerosites, T.k_fiokom_cim);
  check('Widerruf nach "' + T.k_ellallas_megerosites + '": Fokus auf Ueberschrift "' + T.k_fiokom_cim + '", Titel passend', s3.ok, JSON.stringify(s3));
  // (5) Admin-Seite
  const a = await ctx.newPage();
  await a.goto(BASE + '/admin/?lang=de'); await a.waitForTimeout(1200);
  check('Admin-Seite: genau eine main-Landmarke', (await a.getByRole('main').count()) === 1);
  check('Admin-Seite: Inhalt (Kopf und Formular) liegt in main', await a.evaluate(() => !!document.querySelector('main #notfall, main .kopf, main form')));
} catch (e) { fail++; console.log('FEHLER Testablauf: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }
finally { try { await browser?.close(); } catch {} try { server?.close(); } catch {} }
console.log('Barrierefreiheit: ' + ok + ' bestanden, ' + fail + ' fehlgeschlagen');
process.exit(fail ? 1 : 0);
