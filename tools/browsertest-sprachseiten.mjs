// Browsertest Sprachreinheit (NICHT Teil von Selbsttest-Alle, braucht Chrome und playwright-core unter C:\Users\diaco\Projekte\browser-werkzeug).
// Startet die Plattform im Demo-Modus (Port 4499, Mock-Stripe, kein stripe listen, keine Mails) und geht in echtem Chrome alle Kunden- und Admin-Seiten
// in DE/EN/HU durch. Je Seite wird der sichtbare Text auf Fremdsprachen-Funktionswoerter geprueft (Heuristik, Treffer werden mit Textstelle gemeldet).
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'schulung-sprachseiten-'));
process.env.DB_DATEI = join(dir, 'test.db');
let ok = 0, fail = 0, server, browser;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + String(d).slice(0, 400))); };
const PORT = Number(process.env.TEST_PORT || 4499), LIVE = process.env.LIVE_BASE || '';   // LIVE_BASE=https://demo.edmundshop.com prueft die echte Seite (nur Lesen + 6 Demo-Zugaenge), sonst lokaler Server
const BASE = LIVE || 'http://127.0.0.1:' + PORT;
const stripe = { customers: { create: async () => ({ id: 'cus_demo' }), update: async () => ({}) },
  checkout: { sessions: { create: async () => ({ id: 'cs_demo', url: 'https://checkout.stripe.com/test' }), retrieve: async () => ({ payment_intent: 'pi_demo' }), list: async () => ({ data: [] }), expire: async () => ({}) } },
  paymentIntents: { retrieve: async (id) => ({ id }) }, refunds: { create: async () => ({ id: 're_demo' }), list: async () => ({ data: [] }) },
  billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/test' }) } }, webhooks: { constructEvent: () => ({}) } };
// Funktionswoerter, die in der jeweils anderen Sprache nicht vorkommen sollen.
const MARKER = {
  de: ['und', 'der', 'nicht', 'ist', 'für', 'bitte', 'oder', 'wird', 'sind', 'kann', 'noch', 'auch', 'zum', 'zur', 'ein', 'eine', 'dein', 'deine', 'dich', 'dir'],
  en: ['the', 'and', 'your', 'with', 'you', 'are', 'not', 'this', 'that', 'will', 'can', 'please', 'from', 'have', 'has'],
  hu: ['és', 'nem', 'hogy', 'egy', 'meg', 'van', 'vagy', 'ez', 'kérlek', 'minden', 'már', 'csak', 'még', 'után', 'nincs'],
};
// Eigennamen/Fachwoerter, die in jeder Sprache stehen duerfen, werden nicht als Marker verwendet (Liste oben enthaelt sie nicht).
const fremd = (text, sprache) => {
  const worte = text.toLowerCase().split(/[^a-zà-ž0-9]+/i).filter(Boolean);
  const treffer = [];
  for (const [l, liste] of Object.entries(MARKER)) {
    if (l === sprache) continue;
    for (const w of liste) { const i = worte.indexOf(w); if (i >= 0) treffer.push(l + ':' + w + ' …' + worte.slice(Math.max(0, i - 3), i + 4).join(' ') + '…'); }
  }
  return treffer;
};
const pruefeSeite = async (p, name, sprache) => {
  await p.waitForTimeout(1200);
  const text = await p.evaluate(() => document.body.innerText);
  const t = fremd(text, sprache);
  check(name + ' [' + sprache + ']: keine Fremdsprachen-Funktionswoerter', t.length === 0, t.slice(0, 4).join(' | '));
  const lang = await p.evaluate(() => document.documentElement.lang);
  check(name + ' [' + sprache + ']: html lang=' + sprache, lang === sprache, lang);
  const titel = await p.title();
  check(name + ' [' + sprache + ']: Seitentitel nicht leer', titel.trim().length > 0, titel);
  return text;
};
try {
  if (!LIVE) {
  const demo = await import('../demo.mjs');
    const { erstelleServer } = await import('../app.mjs');
    await demo.demoSeedWennLeer();
    server = erstelleServer({ stripe, base: BASE, webhookSecret: 'x', mailer: async () => true, dateiOrdner: join(dir, 'dateien'), ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: true, trustProxy: 1 }).listen(PORT, '127.0.0.1');
    await new Promise((r) => setTimeout(r, 600));
  }
  const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  if (LIVE) console.log('LIVE-Pruefung gegen ' + LIVE);
  for (const sprache of ['de', 'en', 'hu']) {
    // ---- Besucher ----
    let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: sprache + '-' + sprache.toUpperCase() });
    await ctx.addCookies([{ name: 'lang', value: sprache, url: BASE }]);
    let p = await ctx.newPage();
    for (const [name, pfad] of [['Startseite', '/'], ['Kursseite 1', '/#/eloadas/1'], ['Kursseite 2', '/#/eloadas/2'], ['Kursseite 3', '/#/eloadas/3'], ['Anmeldung', '/#/belepes'], ['Registrierung', '/#/regisztracio'], ['Passwort vergessen', '/#/passwort-vergessen']]) {
      await p.goto(BASE + '/?lang=' + sprache + '#' + (pfad.split('#')[1] ?? '/'));
      await pruefeSeite(p, name, sprache);
      if (name === 'Startseite') {
        const hinweis = await p.locator('.demo-reset').first().innerText().catch(() => '');
        const erwartet = { de: /Testmodus.*zurückgesetzt/s, en: /Test mode.*reset/s, hu: /Tesztmód.*törlődhetnek/s }[sprache];
        check('Startseite [' + sprache + ']: Hinweis auf Datenreset in der Demo-Box', erwartet.test(hinweis), hinweis);
      }
    }
    await ctx.close();
    // ---- Demo-Kaeufer ----
    ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: 'lang', value: sprache, url: BASE }]);
    const z = await ctx.request.post(BASE + '/api/demo/zugang', { data: { rolle: 'kaeufer' } });
    check('Demo-Kaeufer-Zugang [' + sprache + ']', z.ok(), z.status());
    if (!LIVE) {   // Kauf nachstellen: Zugang + bezahlte Bestellung fuer den Demo-Kaeufer (Kurs 3), damit "Meine Kurse" und "Meine Bestellungen" gefuellt sind
      const { db } = await import('../db.mjs');
      const kid = db.prepare("SELECT benutzer_id FROM demo_konten WHERE art='kaeufer' ORDER BY benutzer_id DESC LIMIT 1").get()?.benutzer_id;
      const jetzt = new Date().toISOString();
      db.prepare("INSERT OR IGNORE INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt) VALUES (?,3,'zahlung',?)").run(kid, jetzt);
      db.prepare("INSERT OR IGNORE INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert) VALUES (?,?,?,3,14900,'eur','bezahlt',?,?)").run('cs_test_' + sprache + '_' + kid, 'pi_x_' + kid, kid, jetzt, jetzt);
      db.prepare("INSERT OR IGNORE INTO ereignisse (zeit,typ,kurs_id,kurs_titel,betrag,waehrung,email,status,quelle_id) VALUES (?,'gekauft',3,'Muster: Kundenbetreuung und Erstattungen',14900,'eur','demo@example.com','ok',?)").run(Date.now(), 'cs_test_' + sprache + '_' + kid);   // Ereignis-Feed im Admin zeigt den Kurstitel
    }
    p = await ctx.newPage();
    for (const [name, h] of [['Mein Konto', '/fiokom'], ['Meine Kurse', '/eloadasaim'], ['Kurs-Lektionen', '/eloadas/3']]) {
      await p.goto(BASE + '/?lang=' + sprache + '#' + h);
      await pruefeSeite(p, name, sprache);
    }
    await ctx.close();
    // ---- Demo-Admin (nur Ansicht) ----
    ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: 'lang', value: sprache, url: BASE }]);
    const za = await ctx.request.post(BASE + '/api/demo/zugang', { data: { rolle: 'admin' } });
    check('Demo-Admin-Zugang [' + sprache + ']', za.ok(), za.status());
    p = await ctx.newPage();
    await p.goto(BASE + '/admin/?lang=' + sprache);
    await pruefeSeite(p, 'Admin Start', sprache);
    const navTexte = await p.evaluate(() => [...document.querySelectorAll('nav a, nav button, .menue a, .menue button')].map((e) => e.innerText.trim()).filter(Boolean));
    for (const nt of [...new Set(navTexte)].filter((x) => !/abmeld|sign out|log ?out|kilép|logout/i.test(x)).slice(0, 12)) {
      const el = p.locator('nav a, nav button, .menue a, .menue button', { hasText: nt }).first();
      if (!(await el.count())) continue;
      await el.click({ timeout: 4000 }).catch(() => {});
      await pruefeSeite(p, 'Admin "' + nt + '"', sprache);
    }
    // Kursformular im Admin: Preisfelder zeigen die Waehrung (nicht fest Forint), Waehrungsauswahl vorhanden
    await p.goto(BASE + '/admin/?lang=' + sprache); await p.waitForTimeout(1200);
    const NEU = { de: 'Neuer Kurs', en: 'New course', hu: 'Új előadás' }, KURSE_NAV = { de: /Kurse/i, en: /Courses/i, hu: /Előadások/i };
    let neu = p.locator('button', { hasText: NEU[sprache] }).first();
    if (!(await neu.count())) { await p.locator('nav a, nav button, .menue a, .menue button', { hasText: KURSE_NAV[sprache] }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(1000); neu = p.locator('button', { hasText: NEU[sprache] }).first(); }
    if (await neu.count()) {
      await neu.click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(800);
      const labels = await p.evaluate(() => [...document.querySelectorAll('form .beschriftung')].map((e) => e.textContent.trim()));
      check('Admin Kursformular [' + sprache + ']: Preisfelder mit Waehrung (HUF/EUR), kein festes Forint', labels.some((l) => /HUF|EUR/.test(l)) && !labels.some((l) => /forint|Ft/i.test(l)), labels.join(' | '));
    } else check('Admin Kursformular [' + sprache + ']: Knopf Neuer Kurs gefunden', false, 'Knoepfe: ' + (await p.evaluate(() => [...document.querySelectorAll('button, a')].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 25).join(' | '))));
    await ctx.close();
  }
} catch (e) { fail++; console.log('FEHLER Ausnahme: ' + (e?.stack || e).toString().slice(0, 500)); }
finally { await browser?.close().catch(() => {}); server?.close?.(); }
console.log(`Sprachseiten: ${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
