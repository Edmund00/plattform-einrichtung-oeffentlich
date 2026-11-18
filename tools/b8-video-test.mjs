// B8: Avatar-Video nur auf der ungarischen Praesentationsseite. Prueft: Auslieferung (200, video/mp4, Groesse), Element sichtbar Desktop+Mobil, de/en ohne Video, Beschriftung, kein Autoplay.
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
const ROOT = 'C:/Users/diaco/Projekte/stripe-muster/praesentation/public', PORT = 4496;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
const srv = createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html'; const f = normalize(join(ROOT, u)); if (!f.startsWith(normalize(ROOT)) || !existsSync(f) || statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } const b = readFileSync(f); r.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Content-Length': b.length }); r.end(b); }).listen(PORT);
let ok = 0, n = 0; const pruefe = (name, gut, d = '') => { n++; if (gut) ok++; console.log((gut ? 'OK     ' : 'FEHLER ') + name + (gut ? '' : ' ' + d)); };
try {
  const dg = statSync(ROOT + '/media/praesentation-hu.mp4').size;
  const r = await fetch(`http://localhost:${PORT}/media/praesentation-hu.mp4`); const buf = Buffer.from(await r.arrayBuffer());
  pruefe(`Auslieferung: 200, video/mp4, Groesse ${dg} Byte stimmt`, r.status === 200 && r.headers.get('content-type') === 'video/mp4' && buf.length === dg && buf.subarray(4, 8).toString() === 'ftyp', `${r.status} ${r.headers.get('content-type')} ${buf.length}`);
  const b = await chromium.launch();
  for (const [gr, w] of [['desktop', 1440], ['mobil', 390]]) {
    const c = await b.newContext({ viewport: { width: w, height: 900 } });
    for (const [L, pfad] of [['hu', '/hu/index.html'], ['de', '/index.html'], ['en', '/en/index.html']]) {
      const s = await c.newPage(); await s.goto(`http://localhost:${PORT}${pfad}`); await s.waitForTimeout(1500);
      const v = s.locator('figure.hvideo video');
      if (L === 'hu') {
        const sichtbar = await v.isVisible(), box = await v.boundingBox(); const info = await v.evaluate((e) => ({ controls: e.controls, autoplay: e.autoplay, preload: e.preload, playsinline: e.hasAttribute('playsinline'), paused: e.paused, muted: e.muted, readyState: e.readyState, dauer: e.duration, breite: e.videoWidth }));
        const cap = (await s.locator('figure.hvideo figcaption').innerText()).trim();
        pruefe(`hu ${gr}: Video sichtbar (${Math.round(box?.width)}x${Math.round(box?.height)}), innerhalb des Bildschirms`, sichtbar && box.x >= 0 && box.x + box.width <= w + 1 && box.height > 100, JSON.stringify(box));
        pruefe(`hu ${gr}: controls, playsinline, preload=metadata, kein Autoplay, nicht gestartet`, info.controls && info.playsinline && info.preload === 'metadata' && !info.autoplay && info.paused, JSON.stringify(info));
        pruefe(`hu ${gr}: Beschriftung exakt "Bemutató videó, 20 mp"`, cap === 'Bemutató videó, 20 mp', cap);
        const m = await s.evaluate(() => document.documentElement.scrollWidth); pruefe(`hu ${gr}: keine Seitwaerts-Verschiebung`, m <= w, m);
        console.log(`   Info Metadaten (Chromium ohne H.264 kann scheitern): readyState=${info.readyState} dauer=${info.dauer} videoBreite=${info.breite}`);
      } else {
        const html = await s.content();
        pruefe(`${L} ${gr}: KEIN Video (kein video-Element, kein mp4-Verweis)`, (await s.locator('video').count()) === 0 && !/praesentation-hu\.mp4/.test(html));
      }
      await s.close();
    }
    await c.close();
  }
  await b.close();
} finally { srv.close(); }
console.log(`B8-Video: ${ok} von ${n}`); process.exit(ok === n ? 0 : 1);
