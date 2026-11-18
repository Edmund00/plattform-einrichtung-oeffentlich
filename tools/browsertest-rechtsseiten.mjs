// Browsertest Rechtsseiten unter der strengen CSP (A5-02, Gesamtpruefung 12.11.2026). NICHT Teil von Selbsttest-Alle
// (braucht Chrome und playwright-core unter C:\Users\diaco\Projekte\browser-werkzeug).
// Startet die Plattform im Demo-Modus (Port 4486, Mock-Stripe, keine Mails) und prueft in echtem Chrome /jogi/* in DE/EN/HU:
// Stil wirkt (Kasten "DEMO", Seitenbreite), keine CSP-Verletzung, kein <style> und kein style-Attribut; dazu der Demo-Kasten der Startseite.
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'schulung-rechtsseiten-'));
process.env.DB_DATEI = join(dir, 'test.db');
const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
let ok = 0, fail = 0, server, browser;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + String(d).slice(0, 400))); };
const PORT = Number(process.env.TEST_PORT || 4486), BASE = 'http://127.0.0.1:' + PORT;
const stripe = { customers: { create: async () => ({ id: 'cus_demo' }), update: async () => ({}) },
  checkout: { sessions: { create: async () => ({ id: 'cs_demo', url: 'https://checkout.stripe.com/test' }), retrieve: async () => ({ payment_intent: 'pi_demo' }), list: async () => ({ data: [] }), expire: async () => ({}) } },
  paymentIntents: { retrieve: async (id) => ({ id }) }, refunds: { create: async () => ({ id: 're_demo' }), list: async () => ({ data: [] }) },
  billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/test' }) } }, webhooks: { constructEvent: () => ({}) } };
try {
  const demo = await import('../demo.mjs');
  const { erstelleServer } = await import('../app.mjs');
  await demo.demoSeedWennLeer();
  server = erstelleServer({ stripe, base: BASE, webhookSecret: 'x', mailer: async () => true, dateiOrdner: join(dir, 'dateien'), ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: true, trustProxy: 1 }).listen(PORT, '127.0.0.1');
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const lang of ['de', 'en', 'hu']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: 'lang', value: lang, url: BASE }]);
    const p = await ctx.newPage();
    const verstoesse = [];
    p.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) verstoesse.push(m.text()); });
    for (const seite of ['impresszum', 'adatvedelem', 'reszveteli-feltetelek']) {
      verstoesse.length = 0;
      const r = await p.goto(BASE + '/jogi/' + seite + '/', { waitUntil: 'load' });
      await p.waitForTimeout(300);
      const html = await r.text();
      const st = await p.evaluate(() => { const d = document.querySelector('.demo'), b = getComputedStyle(document.body); return { lang: document.documentElement.lang, maxw: b.maxWidth, bg: d && getComputedStyle(d).backgroundColor, rand: d && getComputedStyle(d).borderLeftStyle, inl: document.querySelectorAll('[style]').length, styleTags: document.querySelectorAll('style').length }; });
      check(`${lang} /jogi/${seite}/: gestaltet (Breite 760px, gelber DEMO-Kasten mit Rand)`, st.lang === lang && st.maxw === '760px' && st.bg === 'rgb(255, 243, 205)' && st.rand === 'solid', JSON.stringify(st));
      check(`${lang} /jogi/${seite}/: kein <style>, kein style-Attribut, keine CSP-Verletzung`, !/<style/i.test(html) && st.inl === 0 && st.styleTags === 0 && verstoesse.length === 0, JSON.stringify([st.inl, st.styleTags, verstoesse]).slice(0, 300));
    }
    // Demo-Kasten der Startseite (kunde.css, keine Inline-Stile)
    verstoesse.length = 0;
    await p.goto(BASE + '/', { waitUntil: 'load' }); await p.waitForTimeout(1500);
    const box = await p.evaluate(() => { const b = document.querySelector('.demo-box'); return b && { rand: getComputedStyle(b).borderTopStyle, inl: document.querySelectorAll('[style]').length }; });
    check(`${lang} Startseite: Demo-Kasten gestaltet (gestrichelter Rand), keine CSP-Verletzung`, box && box.rand === 'dashed' && verstoesse.length === 0, JSON.stringify([box, verstoesse]).slice(0, 300));
    await ctx.close();
  }
  const css = await fetch(BASE + '/jogi/recht.css');
  check('recht.css wird als text/css ausgeliefert', css.status === 200 && /text\/css/.test(css.headers.get('content-type') || ''), css.status + ' ' + css.headers.get('content-type'));
} finally { await browser?.close(); server?.close(); }
console.log(`Rechtsseiten: ${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
