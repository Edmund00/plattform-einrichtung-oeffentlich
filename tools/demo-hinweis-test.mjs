// B4 Aufgabe 4: Demo-Hinweis am Kontaktweg der Praesentation (de/en/hu) sichtbar, Desktop und Mobil.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
const erwartet = { 'index.html': 'Demo-Postfach, es wird nichts an Kunden gesendet.', 'en/index.html': 'Demo mailbox, nothing is sent to customers.', 'hu/index.html': 'Demó postafiók, ügyfeleknek nem megy ki semmi.' };
const b = await chromium.launch(); let ok = 0, n = 0;
for (const [p, text] of Object.entries(erwartet)) for (const w of [1440, 390]) {
  const c = await b.newContext({ viewport: { width: w, height: 900 } }); const s = await c.newPage();
  await s.goto(pathToFileURL(resolve('../praesentation/public/' + p)).href); const el = s.locator('.demohinweis'); await el.scrollIntoViewIfNeeded();
  const sichtbar = await el.isVisible(), t = (await el.innerText()).trim(), box = await el.boundingBox(); const imVor = box && box.x >= 0 && box.x + box.width <= w + 1;
  const gut = sichtbar && t === text && imVor; n++; if (gut) ok++;
  console.log(`${gut ? 'OK' : 'FEHLER'} ${p} ${w}px sichtbar=${sichtbar} text="${t}" imBildschirm=${imVor}`); await c.close();
}
await b.close(); console.log(`Demo-Hinweis: ${ok} von ${n}`); process.exit(ok === n ? 0 : 1);
