// Browsertest Handbuch-Seiten der Praesentation (12.11.2026). NICHT Teil von Selbsttest-Alle (braucht Chrome und playwright-core unter
// C:\Users\diaco\Projekte\browser-werkzeug). Muster: browsertest-praesentation-csp.mjs. Ein lokaler Server (Port 5485, nur 127.0.0.1) liefert
// praesentation/public mit genau den Kopfzeilen aus _headers; echtes Chrome prueft /handbuch/, /en/handbuch/, /hu/handbuch/:
// Sprache (kein Sprachmix), Titel und Kapitel wie in plattform/handbuch/handbuch-<typ>.<l>.html, Vorschaubilder (alt, width/height, lazy, geladen),
// je ein Kauf-Link fuer beide Handbuecher (demo.edmundshop.com, richtiges lang, Kaeufer #/kurs/4 mit 9 EUR, Admin #/kurs/5 mit 19 EUR), kein "bald verfuegbar", keine PDFs,
// keine CSP-Verletzung, Canonical/hreflang, Sprachumschalter, Link "Handbuch" in Menue und Fusszeile aller Seiten, Kontrast hell/dunkel, Handybreite.
// Gegenprobe (muss ROT werden): GEGENPROBE=wort (deutsches Wort in der EN-Seite) oder GEGENPROBE=alt (fehlender Alt-Text in der HU-Seite);
// die Aenderung passiert nur in der Server-Antwort, keine Datei wird geaendert.
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
const ROOT = resolve(fileURLToPath(new URL('../../praesentation/public/', import.meta.url)));
const HB_HTML = resolve(fileURLToPath(new URL('../handbuch/', import.meta.url)));
const PORT = Number(process.env.TEST_PORT || 5485), BASE = 'http://127.0.0.1:' + PORT, PRAES = 'https://praesentation.edmundshop.com';
const GEGEN = process.env.GEGENPROBE || '';
let ok = 0, fail = 0;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + String(d).slice(0, 400))); };
const kopf = {}; let block = null;
for (const z of readFileSync(join(ROOT, '_headers'), 'utf8').split(/\r?\n/)) {
  if (!z.trim()) continue;
  if (!/^\s/.test(z)) { block = z.trim(); continue; }
  if (block === '/*') { const i = z.indexOf(':'); kopf[z.slice(0, i).trim()] = z.slice(i + 1).trim(); }
}
// Keine PDF-Datei im veroeffentlichten Ordner (das Handbuch gibt es nur ueber die Demo)
const pdfs = []; (function such(d) { for (const e of readdirSync(d)) { const f = join(d, e); if (statSync(f).isDirectory()) such(f); else if (/\.pdf$/i.test(e)) pdfs.push(f); } })(ROOT);
check('praesentation/public enthaelt keine PDF-Datei', pdfs.length === 0, pdfs.join(', '));
const ent = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const quelle = (typ, l) => { const h = readFileSync(join(HB_HTML, `handbuch-${typ}.${l}.html`), 'utf8'); return { titel: ent(h.match(/<h1>([^<]+)<\/h1>/)[1]).trim(), kap: [...h.matchAll(/<h2 class="kapitel" id="k\d+"><span class="nr">[^<]*<\/span>([^<]+)<\/h2>/g)].map((m) => ent(m[1]).trim()) }; };
const TYP = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, BASE).pathname); if (p.endsWith('/')) p += 'index.html';
  const f = resolve(join(ROOT, p));
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  for (const [k, v] of Object.entries(kopf)) res.setHeader(k, v);
  res.setHeader('Content-Type', TYP[extname(f)] || 'application/octet-stream');
  let daten = readFileSync(f);
  if (GEGEN === 'wort' && p === '/en/handbuch/index.html') daten = Buffer.from(daten.toString('utf8').replace('<h3>Preview</h3>', '<h3>Preview und Inhalt</h3>'));
  if (GEGEN === 'alt' && p === '/hu/handbuch/index.html') daten = Buffer.from(daten.toString('utf8').replace(/ alt="[^"]+"/, ''));
  res.writeHead(200, { 'Content-Length': daten.length }); res.end(daten);
}).listen(PORT, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
// Funktionswoerter, die in einer anderen Sprache nicht vorkommen duerfen (ganze Woerter, klein geschrieben)
const WORT = { de: ['und', 'der', 'die', 'das', 'mit', 'für', 'nicht', 'oder', 'sie', 'ist', 'ein', 'eine', 'den', 'zur', 'vorschau'],
  en: ['the', 'and', 'with', 'your', 'for', 'of', 'buy', 'preview', 'cover', 'guide', 'guides'],
  hu: ['és', 'az', 'egy', 'vagy', 'nem', 'hogy', 'előnézet', 'kézikönyv', 'oldal'] };
const VERBOTEN = { de: [...WORT.en, ...WORT.hu], en: [...WORT.de, ...WORT.hu], hu: [...WORT.de, ...WORT.en] };
const BALD = { de: 'Bald verfügbar', en: 'Coming soon', hu: 'Hamarosan' };   // darf seit dem Admin-Kaufprodukt (Kurs 5) nicht mehr erscheinen
const wurzel = (l) => (l === 'de' ? '/' : `/${l}/`);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const verstoesse = [], fehler = [];
  p.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) verstoesse.push(m.text()); else if (m.type() === 'error' && !/status of 404/.test(m.text())) fehler.push(m.text()); });
  p.on('pageerror', (e) => fehler.push(String(e)));
  p.on('response', (r) => { if (r.status() >= 400 && !/favicon.ico$/.test(r.url())) fehler.push(r.status() + ' ' + r.url()); });
  for (const lang of ['de', 'en', 'hu']) {
    const pfad = wurzel(lang) + 'handbuch/';
    verstoesse.length = 0; fehler.length = 0;
    const antwort = await p.goto(BASE + pfad, { waitUntil: 'load' });
    await p.waitForTimeout(500);
    check(`${pfad}: erreichbar (200), CSP-Kopfzeile kommt an`, antwort.status() === 200 && antwort.headers()['content-security-policy'] === kopf['Content-Security-Policy'], antwort.status());
    const d = await p.evaluate(() => ({ lang: document.documentElement.lang, canon: document.querySelector('link[rel=canonical]')?.href, alt: Object.fromEntries([...document.querySelectorAll('link[rel=alternate][hreflang]')].map((l) => [l.hreflang, l.href])),
      h2: [...document.querySelectorAll('.hbteil h2')].map((h) => h.textContent), kap: [...document.querySelectorAll('.hbteil')].map((s) => [...s.querySelectorAll('ol.kap li')].map((li) => li.textContent.replace(/^\s*(★|\d+\.)\s*/, '').trim())),
      text: [document.title.split(' | ')[0], /* Markenname 'Stripe-Systeme mit Nachweis' bleibt in allen Sprachen */ document.querySelector('main').innerText, [...document.querySelectorAll('nav > a, footer a')].map((a) => a.textContent).join(' '), [...document.querySelectorAll('main img, main a[aria-label]')].map((e) => e.getAttribute('alt') || e.getAttribute('aria-label') || '').join(' ')].join(' '),
      inlineStyle: document.querySelectorAll('[style]').length, inlineScript: [...document.scripts].filter((s) => !s.src).length,
      pdfLinks: [...document.querySelectorAll('a[href]')].filter((a) => /\.pdf(\?|#|$)/i.test(a.getAttribute('href'))).length }));
    check(`${pfad}: html lang=${lang}`, d.lang === lang, d.lang);
    const soll = (l) => `${PRAES}${wurzel(l)}handbuch/`;
    check(`${pfad}: Canonical und hreflang (de/en/hu/x-default) korrekt`, d.canon === soll(lang) && d.alt.de === soll('de') && d.alt.en === soll('en') && d.alt.hu === soll('hu') && d.alt['x-default'] === soll('de'), JSON.stringify([d.canon, d.alt]));
    const qk = quelle('kaeufer', lang), qa = quelle('admin', lang);
    check(`${pfad}: Titel beider Handbuecher wie in der Sprach-HTML`, d.h2[0] === qk.titel && d.h2[1] === qa.titel, JSON.stringify([d.h2, qk.titel, qa.titel]));
    check(`${pfad}: Inhaltsverzeichnisse = Kapitelueberschriften der Sprach-HTML (${qk.kap.length} + ${qa.kap.length})`, JSON.stringify(d.kap[0]) === JSON.stringify(qk.kap) && JSON.stringify(d.kap[1]) === JSON.stringify(qa.kap), JSON.stringify(d.kap).slice(0, 300));
    const woerter = new Set(d.text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean));
    const mix = VERBOTEN[lang].filter((w) => woerter.has(w));
    check(`${pfad}: kein Sprachmix (keine Funktionswoerter anderer Sprachen in Text, Menue, Alt-Texten)`, mix.length === 0, mix.join(', '));
    check(`${pfad}: kein style-Attribut, kein Inline-Skript, kein Link auf eine PDF-Datei`, d.inlineStyle === 0 && d.inlineScript === 0 && d.pdfLinks === 0, JSON.stringify([d.inlineStyle, d.inlineScript, d.pdfLinks]));
    // Bilder: alt, width/height, lazy, geladen
    const attr = await p.evaluate(() => [...document.querySelectorAll('main img[src]')].map((i) => ({ src: i.getAttribute('src'), alt: i.getAttribute('alt'), w: i.getAttribute('width'), h: i.getAttribute('height'), lazy: i.getAttribute('loading') })));
    const bildOk = attr.length === 6 && attr.every((a) => a.alt && a.alt.trim().length >= 10 && +a.w >= 800 && +a.h >= 1000 && a.lazy === 'lazy');
    check(`${pfad}: 6 Vorschaubilder mit Alt-Text, width/height, loading=lazy`, bildOk, JSON.stringify(attr.filter((a) => !(a.alt && a.alt.trim().length >= 10 && a.lazy === 'lazy' && +a.w >= 800))).slice(0, 300));
    check(`${pfad}: Bilder sind die Sprachfassung (bilder/handbuch/<typ>-${lang}-1..3.png)`, attr.length === 6 && attr.every((a, i) => new RegExp(`bilder/handbuch/${i < 3 ? 'kaeufer' : 'admin'}-${lang}-${(i % 3) + 1}\\.png$`).test(a.src)), JSON.stringify(attr.map((a) => a.src)));
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); } window.scrollTo(0, 0); });
    await p.evaluate(() => Promise.all([...document.images].map((i) => { i.loading = 'eager'; return Promise.race([i.decode().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]); })));   // lazy: nach dem Scrollen auf eager, decode mit Zeitlimit
    const geladen = await p.evaluate(() => [...document.querySelectorAll('main img[src]')].map((i) => [i.getAttribute('src'), i.complete && i.naturalWidth > 0, i.naturalWidth, i.naturalHeight]));
    check(`${pfad}: alle Vorschaubilder geladen (naturalWidth > 0, Masse wie Attribute)`, geladen.length === 6 && geladen.every((g, i) => g[1] && g[2] === +attr[i].w && g[3] === +attr[i].h), JSON.stringify(geladen.filter((g) => !g[1])));
    // Kauf-Links beider Handbuecher
    const kauf = await p.evaluate(() => ({ k: [...document.querySelectorAll('#kaeufer a[href^="http"]')].map((a) => a.href), a: [...document.querySelectorAll('#admin a[href^="http"]')].map((a) => a.href), alle: [...document.querySelectorAll('a[href*="demo.edmundshop.com"]')].length,
      kText: document.getElementById('kaeufer').innerText, aText: document.getElementById('admin').innerText }));
    const ku = kauf.k.length === 1 ? new URL(kauf.k[0]) : null, au = kauf.a.length === 1 ? new URL(kauf.a[0]) : null;
    check(`${pfad}: Kaeufer-Handbuch: genau ein Kauf-Link https://demo.edmundshop.com/?lang=${lang}#/kurs/4, Preis 9 EUR`, ku && ku.protocol === 'https:' && ku.host === 'demo.edmundshop.com' && ku.searchParams.get('lang') === lang && ku.hash === '#/kurs/4' && kauf.alle === 2 && /\b9 EUR|EUR 9\b/.test(kauf.kText), JSON.stringify(kauf.k));
    check(`${pfad}: Admin-Handbuch: genau ein Kauf-Link https://demo.edmundshop.com/?lang=${lang}#/kurs/5, Preis 19 EUR, kein "${BALD[lang]}"`, au && au.protocol === 'https:' && au.host === 'demo.edmundshop.com' && au.searchParams.get('lang') === lang && au.hash === '#/kurs/5' && /\b19 EUR|EUR 19\b/.test(kauf.aText) && !d.text.includes(BALD[lang]), JSON.stringify([kauf.a, kauf.aText.slice(0, 120)]));
    const knoepfe = await p.evaluate(() => [...document.querySelectorAll('.hbkauf a.btn')].map((a) => a.getAttribute('aria-label') || ''));
    check(`${pfad}: beide Kaufknoepfe mit eindeutigem Namen (aria-label endet mit dem Handbuch-Titel)`, knoepfe.length === 2 && knoepfe[0].endsWith(qk.titel) && knoepfe[1].endsWith(qa.titel), JSON.stringify(knoepfe));
    // Lightbox mit Vorschaubild
    await p.locator('.hbbilder figure a').first().click(); await p.waitForTimeout(300);
    const lb = await p.evaluate(() => ({ offen: document.getElementById('lb').open, src: document.querySelector('#lb img').getAttribute('src'), alt: document.querySelector('#lb img').alt }));
    check(`${pfad}: Lightbox oeffnet das Vorschaubild gross (mit Alt-Text)`, lb.offen && /bilder\/handbuch\//.test(lb.src || '') && lb.alt.length > 5, JSON.stringify(lb));
    await p.locator('#lb .lbx').click(); await p.waitForTimeout(150);
    check(`${pfad}: keine CSP-Verletzung, keine Skript- oder Ladefehler`, verstoesse.length === 0 && fehler.length === 0, JSON.stringify([...verstoesse, ...fehler]));
  }
  // Sprachumschalter zwischen den drei Handbuch-Seiten
  await p.goto(BASE + '/handbuch/', { waitUntil: 'load' });
  const weg = [];
  for (const l of ['en', 'hu', 'de']) { await p.locator(`.lang a[hreflang=${l}]`).click(); await p.waitForLoadState('load'); weg.push(await p.evaluate(() => [location.pathname, document.documentElement.lang, document.querySelector('.lang a.on')?.hreflang])); }
  check('Sprachumschalter Handbuch DE -> EN -> HU -> DE bleibt auf der Handbuch-Seite', weg[0][0] === '/en/handbuch/index.html' && weg[0][1] === 'en' && weg[1][0] === '/hu/handbuch/index.html' && weg[1][1] === 'hu' && weg[2][0] === '/handbuch/index.html' && weg[2][1] === 'de' && weg.every((w) => w[1] === w[2]), JSON.stringify(weg));
  // Link "Handbuch" in Menue und Fusszeile aller Seiten, Ziel = Handbuch-Seite derselben Sprache
  for (const [s, l] of [['/', 'de'], ['/en/', 'en'], ['/hu/', 'hu'], ['/impressum.html', 'de'], ['/datenschutz.html', 'de'], ['/handbuch/', 'de'], ['/en/handbuch/', 'en'], ['/hu/handbuch/', 'hu']]) {
    await p.goto(BASE + s, { waitUntil: 'load' });
    const z = BASE + wurzel(l) + 'handbuch/index.html';
    const r = await p.evaluate((ziel) => ({ nav: [...document.querySelectorAll('header nav > a')].filter((a) => a.href === ziel).length, fuss: [...document.querySelectorAll('footer a')].filter((a) => a.href === ziel).length }), z);
    check(`${s}: Link zur Handbuch-Seite (${l}) im Menue und in der Fusszeile`, r.nav === 1 && r.fuss === 1, JSON.stringify(r));
  }
  // Startseiten bekommen ebenfalls Canonical/hreflang; Rechtsseiten (nur deutsch) keine Sprachvarianten
  const sk = await p.goto(BASE + '/en/').then(() => p.evaluate(() => [document.querySelector('link[rel=canonical]')?.href, document.querySelector('link[hreflang=hu]')?.href]));
  check('/en/: Canonical und hreflang der Startseite', sk[0] === PRAES + '/en/' && sk[1] === PRAES + '/hu/', JSON.stringify(sk));
  // Kontrast hell und dunkel (WCAG 1.4.3, 4,5:1) fuer Handbuch-Texte, Handybreite ohne waagerechten Ueberlauf
  for (const schema of ['dark', 'light']) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: schema }); const cp = await c.newPage();
    for (const l of ['de', 'en', 'hu']) {
      await cp.goto(BASE + wurzel(l) + 'handbuch/', { waitUntil: 'load' }); await cp.waitForTimeout(200);
      const werte = await cp.evaluate(() => {
        const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
        const lum = ([r, g, b]) => { const k = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
        const grund = (el) => { for (let e = el; e; e = e.parentElement) { const f = rgb(getComputedStyle(e).backgroundColor); if (f.length === 3 || (f.length === 4 && f[3] > 0)) return f.slice(0, 3); } return [255, 255, 255]; };
        return [...document.querySelectorAll('main h1, main h2, main h3, .hb .tag, .hbteil > p, .hbpreis, .hbbald, .hb .status, ol.kap li, ol.kap .nr, .hb .note, .hb .lead, .hbbilder figcaption, .hbkauf .btn')].filter((e) => e.getClientRects().length).map((e) => {
          const a = lum(rgb(getComputedStyle(e).color)), b = lum(grund(e)); return { k: e.className || e.tagName, ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 };
        });
      });
      const schlecht = werte.filter((w) => w.ratio < 4.5);
      check(`/${l}/handbuch ${schema}: ${werte.length} Textelemente mit Kontrast >= 4,5:1 (kleinster ${Math.min(...werte.map((w) => w.ratio))})`, werte.length >= 30 && schlecht.length === 0, JSON.stringify(schlecht.slice(0, 4)));
    }
    await c.close();
  }
  const m = await browser.newContext({ viewport: { width: 390, height: 860 } }); const mp = await m.newPage();
  for (const l of ['de', 'en', 'hu']) {
    await mp.goto(BASE + wurzel(l) + 'handbuch/', { waitUntil: 'load' }); await mp.waitForTimeout(200);
    const u = await mp.evaluate(() => ({ ueber: document.documentElement.scrollWidth - innerWidth, bildBreite: Math.round(document.querySelector('.hbbilder img').getBoundingClientRect().width) }));
    check(`Handy 390 px /${l}/handbuch: kein waagerechter Ueberlauf, Vorschaubild mindestens 300 px breit`, u.ueber <= 0 && u.bildBreite >= 300, JSON.stringify(u));
  }
  await m.close();
} finally { await browser.close(); server.close(); }
console.log(`Praesentation Handbuch${GEGEN ? ' (GEGENPROBE=' + GEGEN + ')' : ''}: ${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
