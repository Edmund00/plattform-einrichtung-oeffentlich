// Browsertest Sprachumschalter (NICHT Teil von Selbsttest-Alle, braucht Chrome und playwright-core unter C:\Users\diaco\Projekte\browser-werkzeug).
// Startet die Plattform im Demo-Modus (Port 4498, Mock-Stripe) und prueft in echtem Chrome, bei Desktop- und Handybreite:
// Umschalter sichtbar (EN/DE/HU), innerhalb des Fensters, kein waagerechter Ueberlauf, aktiver Knopf markiert, Umschalten wechselt Sprache und Cookie.
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'schulung-sprachwahl-'));
process.env.DB_DATEI = join(dir, 'test.db');
let ok = 0, fail = 0, server, browser;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + String(d).slice(0, 240))); };
const PORT = 4498, BASE = 'http://127.0.0.1:' + PORT;
const stripe = { customers: { create: async () => ({ id: 'cus_demo' }), update: async () => ({}) },
  checkout: { sessions: { create: async () => ({ id: 'cs_demo', url: 'https://checkout.stripe.com/test' }), retrieve: async () => ({ payment_intent: 'pi_demo' }), list: async () => ({ data: [] }), expire: async () => ({}) } },
  paymentIntents: { retrieve: async (id) => ({ id }) }, refunds: { create: async () => ({ id: 're_demo' }), list: async () => ({ data: [] }) },
  billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/test' }) } }, webhooks: { constructEvent: () => ({}) } };
try {
  const demo = await import('../demo.mjs');
  const { erstelleServer } = await import('../app.mjs');
  await demo.demoSeedWennLeer();
  server = erstelleServer({ stripe, base: BASE, webhookSecret: 'x', mailer: async () => true, dateiOrdner: join(dir, 'dateien'), ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: true, trustProxy: 1 }).listen(PORT, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 600));
  const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const [name, breite, hoehe] of [['Desktop 1280', 1280, 800], ['Handy 390', 390, 800], ['Handy klein 320', 320, 700]]) {
    const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, locale: 'de-DE' });
    const p = await ctx.newPage();
    await p.goto(BASE + '/?lang=de'); await p.waitForSelector('nav.sprachwahl', { timeout: 15000 }).catch(() => {});
    const n = await p.locator('nav.sprachwahl button').count();
    check(name + ': Umschalter sichtbar mit 3 Knoepfen', n === 3, 'Knoepfe: ' + n);
    if (n !== 3) { await ctx.close(); continue; }
    const texte = await p.locator('nav.sprachwahl button').allInnerTexts();
    check(name + ': Reihenfolge EN DE HU', texte.join(' ') === 'EN DE HU', texte.join(' '));
    const innen = await p.evaluate(() => { const r = [...document.querySelectorAll('nav.sprachwahl button')].map((b) => b.getBoundingClientRect()); return { alleImFenster: r.every((x) => x.left >= 0 && x.right <= innerWidth && x.top >= 0 && x.bottom <= innerHeight), kleinsteHoehe: Math.min(...r.map((x) => x.height)), kleinsteBreite: Math.min(...r.map((x) => x.width)), ueberlauf: document.documentElement.scrollWidth - innerWidth }; });
    check(name + ': alle Knoepfe im Fenster', innen.alleImFenster, JSON.stringify(innen));
    check(name + ': Knoepfe mindestens 44 px gross (Fingertauglich)', innen.kleinsteHoehe >= 44 && innen.kleinsteBreite >= 44, JSON.stringify(innen));
    check(name + ': kein waagerechter Seitenueberlauf', innen.ueberlauf <= 0, JSON.stringify(innen));
    check(name + ': Deutsch aktiv markiert', (await p.locator('nav.sprachwahl button[aria-current="true"]').getAttribute('lang')) === 'de');
    const menue = await p.evaluate(() => { const m = document.querySelector('.menue').getBoundingClientRect(); const s = document.querySelector('.sprachwahl').getBoundingClientRect(); return { menueRechts: m.right <= innerWidth, ueberschneidung: !(s.left >= m.right || s.right <= m.left || s.top >= m.bottom || s.bottom <= m.top) }; });
    check(name + ': Menue und Umschalter ueberdecken sich nicht', !menue.ueberschneidung && menue.menueRechts, JSON.stringify(menue));
    await p.locator('nav.sprachwahl button[lang="en"]').click(); await p.waitForLoadState('load'); await p.waitForTimeout(1500);
    check(name + ': Klick EN -> Seite englisch', (await p.evaluate(() => document.documentElement.lang)) === 'en' && /COURSES|Courses/.test(await p.innerText('.menue')), await p.innerText('.menue'));
    const ck = (await ctx.cookies()).find((c) => c.name === 'lang');
    check(name + ': Cookie lang=en gesetzt', ck?.value === 'en', JSON.stringify(ck));
    await p.locator('nav.sprachwahl button[lang="hu"]').click(); await p.waitForTimeout(1800);
    check(name + ': Klick HU -> Seite ungarisch', (await p.evaluate(() => document.documentElement.lang)) === 'hu' && /ELŐADÁSOK|Előadások/i.test(await p.innerText('.menue')));
    await p.reload(); await p.waitForTimeout(1200);
    check(name + ': Sprache bleibt nach Neuladen (Cookie)', (await p.evaluate(() => document.documentElement.lang)) === 'hu');
    await p.locator('nav.sprachwahl button[lang="de"]').click(); await p.waitForTimeout(1800);
    check(name + ': Klick DE -> Seite deutsch', (await p.evaluate(() => document.documentElement.lang)) === 'de' && /KURSE|Kurse/i.test(await p.innerText('.menue')));
    const nachAnmeldung = await p.goto(BASE + '/#/belepes').then(() => p.waitForTimeout(800)).then(() => p.locator('nav.sprachwahl button').count());
    check(name + ': Umschalter auch auf der Anmeldeseite', nachAnmeldung === 3, nachAnmeldung);
    // Einstieg ueber Praefix-Adresse (/hu/): Wechsel nach EN darf nicht zurueckspringen
    await p.goto(BASE + '/hu/'); await p.waitForSelector('nav.sprachwahl'); await p.waitForTimeout(800);
    check(name + ': Einstieg ueber /hu/ zeigt Ungarisch', (await p.evaluate(() => document.documentElement.lang)) === 'hu');
    await p.locator('nav.sprachwahl button[lang="en"]').click(); await p.waitForTimeout(2000);
    check(name + ': von /hu/ nach EN: Seite englisch, Praefix aus der Adresse entfernt', (await p.evaluate(() => document.documentElement.lang)) === 'en' && !/\/hu(\/|$)/.test(new URL(p.url()).pathname), p.url());
    await ctx.close();
  }
} catch (e) { fail++; console.log('FEHLER Ausnahme: ' + (e?.stack || e).toString().slice(0, 400)); }
finally { try { await browser?.close(); } catch { /* egal */ } try { server?.close(); } catch { /* egal */ } }
console.log('Sprachumschalter: ' + ok + ' bestanden, ' + fail + ' fehlgeschlagen');
process.exit(fail ? 1 : 0);
