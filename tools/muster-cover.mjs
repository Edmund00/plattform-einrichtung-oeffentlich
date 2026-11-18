// Erzeugt drei eigene Cover-Bilder (1200x675 JPEG, Markenfarben, keine Fremdbilder) fuer die Beispielkurse und legt sie in die Muster-DB (Vorschau-Ordner).
// Aufruf: node --disable-warning=ExperimentalWarning tools/muster-cover.mjs [db] [dateiordner]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
const dbPfad = process.argv[2] || 'daten/muster.db', ordner = process.argv[3] || 'daten/muster-dateien';
const font = (f) => 'data:font/woff2;base64,' + readFileSync('public/fonts/' + f).toString('base64');
const COVER = [
  { titel: 'Musterkurs: Stripe Billing in der Praxis', ueber: 'ZAHLUNGEN & ABOS', haupt: 'Stripe Billing\nin der Praxis', unter: 'Vom Kauf bis zum Zugang', deko: 'kreise' },
  { titel: 'Muster: Online-Kurse professionell verkaufen', ueber: 'ANGEBOT & KAUFWEG', haupt: 'Online-Kurse\nprofessionell verkaufen', unter: 'Für Trainer und Akademien', deko: 'linien' },
  { titel: 'Muster: Kundenbetreuung und Erstattungen', ueber: 'SERVICE & RECHT', haupt: 'Kundenbetreuung\nund Erstattungen', unter: 'Widerruf sicher abwickeln', deko: 'raster' },
];
const deko = {
  kreise: '<circle cx="1010" cy="170" r="210" fill="none" stroke="#d4a843" stroke-opacity=".55" stroke-width="2"/><circle cx="1010" cy="170" r="140" fill="none" stroke="#d4a843" stroke-opacity=".4" stroke-width="2"/><circle cx="1010" cy="170" r="70" fill="#d4a843" fill-opacity=".9"/><circle cx="1130" cy="520" r="120" fill="none" stroke="#e8c777" stroke-opacity=".35" stroke-width="2"/>',
  linien: Array.from({ length: 9 }, (_, i) => `<path d="M${700 + i * 60} 675 L${1000 + i * 40} 0" stroke="#d4a843" stroke-opacity="${0.15 + i * 0.07}" stroke-width="${2 + i * 0.6}"/>`).join('') + '<rect x="930" y="110" width="150" height="150" rx="14" fill="#d4a843" fill-opacity=".9"/>',
  raster: Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, c) => `<rect x="${760 + c * 70}" y="${90 + r * 70}" width="52" height="52" rx="9" fill="#d4a843" fill-opacity="${(r + c) % 3 === 0 ? 0.9 : 0.16 + ((r * c) % 4) * 0.06}"/>`).join('')).join(''),
};
const html = (c) => `<!doctype html><meta charset=utf-8><style>@font-face{font-family:C;src:url(${font('cormorant-garamond-normal-latin.woff2')});font-weight:300 700}@font-face{font-family:J;src:url(${font('jost-latin.woff2')});font-weight:300 700}
html,body{margin:0}body{width:1200px;height:675px;background:radial-gradient(900px 600px at 85% 20%,#2a2010,#0d0a05 70%);position:relative;overflow:hidden;color:#faf6ee}
svg{position:absolute;inset:0}.t{position:absolute;left:80px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;width:760px}
.o{font:600 20px J;letter-spacing:.28em;color:#d4a843;margin-bottom:26px}.h{font:600 76px/1.04 C;white-space:pre-line}.u{font:300 28px J;color:#e8c777;margin-top:30px}
.l{position:absolute;left:80px;bottom:46px;font:500 18px J;letter-spacing:.2em;color:#faf6ee;opacity:.75}.b{position:absolute;left:80px;top:0;width:90px;height:6px;background:#d4a843}</style>
<svg width=1200 height=675>${deko[c.deko]}</svg><div class=b></div><div class=t><div class=o>${c.ueber}</div><div class=h>${c.haupt}</div><div class=u>${c.unter}</div></div><div class=l>MUSTERAKADEMIE · DEMO</div>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 675 } });
const db = new DatabaseSync(dbPfad); mkdirSync(resolve(ordner, 'vorschau'), { recursive: true });
for (const c of COVER) {
  const k = db.prepare('SELECT id,titelbild_datei FROM kurse WHERE titel=?').get(c.titel); if (!k) { console.log('Kurs fehlt:', c.titel); continue; }
  await p.setContent(html(c)); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
  const jpg = await p.screenshot({ type: 'jpeg', quality: 88 }); const name = randomUUID();
  writeFileSync(resolve(ordner, 'vorschau', name), jpg);
  db.prepare("UPDATE kurse SET titelbild_datei=?,titelbild_typ='image/jpeg',geaendert=? WHERE id=?").run(name, new Date().toISOString(), k.id);
  writeFileSync(`daten/admin-sicht/cover-${k.id}.jpg`, jpg); console.log('Cover', k.id, Math.round(jpg.length / 1024) + ' KB');
}
await b.close();
