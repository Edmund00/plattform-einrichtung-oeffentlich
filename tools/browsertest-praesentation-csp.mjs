// Browsertest Praesentation mit den Netlify-Kopfzeilen aus praesentation/public/_headers (A7-06, Gesamtpruefung 12.11.2026).
// NICHT Teil von Selbsttest-Alle (braucht Chrome und playwright-core unter C:\Users\diaco\Projekte\browser-werkzeug).
// Ein kleiner lokaler Server (Port 4485, nur 127.0.0.1) liefert praesentation/public mit genau den Kopfzeilen aus _headers aus,
// dann prueft echtes Chrome /, /en/, /hu/ und die Rechtsseiten: keine CSP-Verletzung, Stile, Schriften, Bilder, Video (hu),
// Sprachumschalter, Lightbox, Kontaktformular (Absenden wird abgefangen, kein Neuladen), Kopfzeilen vorhanden.
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
const ROOT = resolve(fileURLToPath(new URL('../../praesentation/public/', import.meta.url)));
const PORT = Number(process.env.TEST_PORT || 4485), BASE = 'http://127.0.0.1:' + PORT;
let ok = 0, fail = 0;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + String(d).slice(0, 400))); };
// _headers lesen (Netlify-Format: Pfadzeile, darunter eingerueckte "Name: Wert"); hier gibt es nur den Block "/*".
const kopf = {}; let block = null;
for (const z of readFileSync(join(ROOT, '_headers'), 'utf8').split(/\r?\n/)) {
  if (!z.trim()) continue;
  if (!/^\s/.test(z)) { block = z.trim(); continue; }
  if (block === '/*') { const i = z.indexOf(':'); kopf[z.slice(0, i).trim()] = z.slice(i + 1).trim(); }
}
check('_headers: CSP, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options vorhanden', kopf['Content-Security-Policy'] && kopf['X-Content-Type-Options'] === 'nosniff' && kopf['Referrer-Policy'] && kopf['Permissions-Policy'] && kopf['X-Frame-Options'] === 'DENY', JSON.stringify(kopf));
check("_headers: CSP ohne 'unsafe-inline'/'unsafe-eval', frame-ancestors 'none', default-src 'none'", !/unsafe-/.test(kopf['Content-Security-Policy']) && /frame-ancestors 'none'/.test(kopf['Content-Security-Policy']) && /default-src 'none'/.test(kopf['Content-Security-Policy']));
const TYP = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, BASE).pathname); if (p.endsWith('/')) p += 'index.html';
  const f = resolve(join(ROOT, p));
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  for (const [k, v] of Object.entries(kopf)) res.setHeader(k, v);
  res.setHeader('Content-Type', TYP[extname(f)] || 'application/octet-stream'); res.setHeader('Accept-Ranges', 'bytes');
  const daten = readFileSync(f), r = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (r) { const a = r[1] ? Number(r[1]) : 0, b = r[2] ? Number(r[2]) : daten.length - 1; res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${daten.length}`, 'Content-Length': b - a + 1 }); return res.end(daten.subarray(a, b + 1)); }
  res.writeHead(200, { 'Content-Length': daten.length }); res.end(daten);
}).listen(PORT, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const verstoesse = [], fehler = [];
  p.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) verstoesse.push(m.text()); else if (m.type() === 'error' && !/status of 404/.test(m.text())) fehler.push(m.text()); });   // 404 einzeln ueber 'response' (ausser favicon.ico, das die Praesentation nicht hat)
  p.on('pageerror', (e) => fehler.push(String(e)));
  p.on('response', (r) => { if (r.status() >= 400 && !/favicon.ico$/.test(r.url())) fehler.push(r.status() + ' ' + r.url()); });
  for (const [pfad, lang, demohinweis] of [['/', 'de', 'Demo-Postfach'], ['/en/', 'en', 'Demo mailbox'], ['/hu/', 'hu', 'Demó postafiók']]) {
    verstoesse.length = 0; fehler.length = 0;
    const antwort = await p.goto(BASE + pfad, { waitUntil: 'load' });
    await p.waitForTimeout(800);
    check(`${pfad}: Kopfzeile CSP kommt an`, (antwort.headers()['content-security-policy'] || '') === kopf['Content-Security-Policy']);
    const st = await p.evaluate(() => {
      const d = document.querySelector('.demohinweis'), k = document.querySelector('.kontakt-kick'), body = getComputedStyle(document.body);
      const imgs = [...document.querySelectorAll('img')].filter((i) => i.getAttribute('src'));
      return { lang: document.documentElement.lang, border: d && getComputedStyle(d).borderTopStyle, maxw: d && getComputedStyle(d).maxWidth, kickMt: k && getComputedStyle(k).marginTop, text: d && d.textContent,
        font: body.fontFamily, manrope: document.fonts.check('800 20px Manrope'), inter: document.fonts.check('400 18px Inter'), hero: getComputedStyle(document.querySelector('.hero')).backgroundColor, imgs: imgs.length, inlineStyle: document.querySelectorAll('[style]').length, inlineScript: [...document.scripts].filter((s) => !s.src).length };
    });
    check(`${pfad}: html lang=${lang}`, st.lang === lang, st.lang);
    check(`${pfad}: Stylesheet wirkt (Hero dunkel, Demo-Hinweis gestrichelt, max. 640px, Kontakt-Kicker ohne Abstand oben)`, st.hero === 'rgb(16, 24, 39)' && st.border === 'dashed' && st.maxw === '640px' && st.kickMt === '0px' && st.text.includes(demohinweis), JSON.stringify(st));
    await p.evaluate(() => document.fonts.ready);
    const fonts = await p.evaluate(() => ({ manrope: document.fonts.check('800 20px Manrope'), inter: document.fonts.check('400 18px Inter'), geladen: [...document.fonts].filter((f) => f.status === 'loaded').length }));
    check(`${pfad}: eigene Schriften geladen (Manrope, Inter)`, fonts.geladen >= 1 && fonts.manrope && fonts.inter, JSON.stringify(fonts));
    // alle Bilder laden (lazy: einmal ganz nach unten scrollen)
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    await p.evaluate(() => Promise.all([...document.images].map((i) => { i.loading = 'eager'; return i.decode().catch(() => {}); })));
    const bilder = await p.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.getAttribute('src')).map((i) => [i.getAttribute('src'), i.complete && i.naturalWidth > 0]));
    check(`${pfad}: alle ${bilder.length} Bilder geladen`, bilder.length >= 4 && bilder.every((b) => b[1]), JSON.stringify(bilder.filter((b) => !b[1])));
    check(`${pfad}: kein style-Attribut und kein Inline-Skript im Dokument`, st.inlineStyle === 0 && st.inlineScript === 0, JSON.stringify([st.inlineStyle, st.inlineScript]));
    if (lang === 'hu') {
      const v = await p.evaluate(async () => { const v = document.querySelector('video'); if (!v) return null; if (v.readyState < 1) await new Promise((r) => { v.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 5000); }); return { rs: v.readyState, dauer: v.duration }; });
      check('/hu/: Video laedt (Metadaten, Dauer > 0)', v && v.rs >= 1 && v.dauer > 0, JSON.stringify(v));
    }
    // Lightbox
    await p.locator('figure a').first().click();
    await p.waitForTimeout(300);
    const lb = await p.evaluate(() => ({ offen: document.getElementById('lb').open, src: document.querySelector('#lb img').getAttribute('src') }));
    check(`${pfad}: Lightbox oeffnet mit grossem Bild`, lb.offen && /bilder\//.test(lb.src || ''), JSON.stringify(lb));
    await p.locator('#lb .lbx').click(); await p.waitForTimeout(200);
    check(`${pfad}: Lightbox schliesst`, !(await p.evaluate(() => document.getElementById('lb').open)));
    // Kontaktformular: Absenden wird abgefangen (kein Neuladen), Daten fuer die Mail stehen im Formular
    await p.evaluate(() => { window.__markierung = 1; });
    await p.fill('#kf input[name=n]', 'Test Name'); await p.fill('#kf input[name=e]', 'test@example.com'); await p.fill('#kf textarea[name=m]', 'Hallo');
    await p.locator('#kf button[type=submit]').click(); await p.waitForTimeout(500);
    const kf = await p.evaluate(() => ({ mark: window.__markierung, url: location.pathname, d: { ...document.getElementById('kf').dataset } }));
    check(`${pfad}: Kontaktformular wird vom Skript abgefangen (kein Neuladen) und hat Mail-Daten`, kf.mark === 1 && kf.url === pfad && /@/.test(kf.d.mail) && /%M%/.test(kf.d.text) && kf.d.betreff.length > 3, JSON.stringify(kf));
    check(`${pfad}: keine CSP-Verletzung, keine Skriptfehler`, verstoesse.length === 0 && fehler.length === 0, JSON.stringify([...verstoesse, ...fehler]).slice(0, 400));
  }
  // Sprachumschalter: von / nach EN und HU und zurueck
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.locator('.lang a[hreflang=en]').click(); await p.waitForLoadState('load');
  const en = await p.evaluate(() => [location.pathname, document.documentElement.lang]);
  await p.locator('.lang a[hreflang=hu]').click(); await p.waitForLoadState('load');
  const hu = await p.evaluate(() => [location.pathname, document.documentElement.lang]);
  await p.locator('.lang a[hreflang=de]').click(); await p.waitForLoadState('load');
  const de = await p.evaluate(() => [location.pathname, document.documentElement.lang]);
  check('Sprachumschalter DE -> EN -> HU -> DE', en[1] === 'en' && hu[1] === 'hu' && de[1] === 'de' && /\/en\//.test(en[0]) && /\/hu\//.test(hu[0]), JSON.stringify([en, hu, de]));
  for (const s of ['/impressum.html', '/datenschutz.html']) {
    verstoesse.length = 0; fehler.length = 0;
    await p.goto(BASE + s, { waitUntil: 'load' }); await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({ mt: getComputedStyle(document.querySelector('h1')).marginTop, inl: document.querySelectorAll('[style]').length }));
    check(`${s}: gestaltet (h1 Abstand oben 46px), kein style-Attribut, keine CSP-Verletzung`, r.mt === '46px' && r.inl === 0 && verstoesse.length === 0 && fehler.length === 0, JSON.stringify([r, verstoesse, fehler]));
  }
  // A10-12: Kontraste der Kicker/Tags/Aufklapper und vorher/nachher im Dunkel- UND Hellmodus (WCAG 1.4.3, Text bis 18px -> 4,5:1), berechnet aus den
  // gerenderten Farben; Hintergrund = erste nicht transparente Hintergrundfarbe der Vorfahren.
  for (const schema of ['dark', 'light']) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: schema }); const cp = await c.newPage();
    for (const pfad of ['/', '/en/', '/hu/']) {
      await cp.goto(BASE + pfad, { waitUntil: 'load' }); await cp.waitForTimeout(300);
      const werte = await cp.evaluate(() => {
        const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
        const lum = ([r, g, b]) => { const k = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
        const grund = (el) => { for (let e = el; e; e = e.parentElement) { const f = rgb(getComputedStyle(e).backgroundColor); if (f.length === 3 || (f.length === 4 && f[3] > 0)) return f.slice(0, 3); } return [255, 255, 255]; };
        return [...document.querySelectorAll('.kick, .tag, details.mehr summary, .pl .vorher, .pl .nachher')].filter((e) => e.getClientRects().length).map((e) => {
          const a = lum(rgb(getComputedStyle(e).color)), b = lum(grund(e));
          return { k: e.className || e.tagName, text: e.textContent.trim().slice(0, 24), farbe: getComputedStyle(e).color, ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 };
        });
      });
      const schlecht = werte.filter((w) => w.ratio < 4.5);
      check(`${pfad} ${schema}: ${werte.length} Kicker/Tags/vorher/nachher mit Kontrast >= 4,5:1 (kleinster ${Math.min(...werte.map((w) => w.ratio))})`, werte.length >= 8 && schlecht.length === 0, JSON.stringify(schlecht.slice(0, 4)));
    }
    await c.close();
  }
  // Mobil: Kontakt-Knopf und Nachweis eingeklappt (Skript laeuft)
  const m = await browser.newContext({ viewport: { width: 390, height: 860 } }); const mp = await m.newPage();
  await mp.goto(BASE + '/', { waitUntil: 'load' }); await mp.waitForTimeout(400);
  const mob = await mp.evaluate(() => ({ nachweisOffen: document.querySelector('details.nachweis').open, fix: getComputedStyle(document.querySelector('.kontakt-fix')).display }));
  check('Mobil 390px: Nachweis eingeklappt (seite.js laeuft), Kontakt-Knopf sichtbar', mob.nachweisOffen === false && mob.fix === 'flex', JSON.stringify(mob));
  await m.close();
} finally { await browser.close(); server.close(); }
console.log(`Praesentation CSP: ${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
