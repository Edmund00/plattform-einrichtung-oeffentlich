// Baut texte/<sprache>.json (de, en) aus tools/<sprache>/teil*.mjs und prueft gegen hu.json (Referenz): gleiche Schluessel, gleiche Platzhalter.
import { readFileSync, writeFileSync } from 'node:fs';
const hu = JSON.parse(readFileSync(new URL('../texte/hu.json', import.meta.url), 'utf8'));
const ph = s => (String(s).match(/\{[a-z_]+\}/g) || []).sort().join(',');
let rc = 0;
for (const l of process.argv.slice(2).length ? process.argv.slice(2) : ['de', 'en']) {
  const t = {};
  for (const teil of ['teil1', 'teil2', 'teil3']) Object.assign(t, (await import('./' + l + '/' + teil + '.mjs')).default);
  const fehlt = Object.keys(hu).filter(k => !(k in t)), zuviel = Object.keys(t).filter(k => !(k in hu));
  const phF = Object.keys(hu).filter(k => k in t && ph(hu[k]) !== ph(t[k]));
  console.log(l, 'hu', Object.keys(hu).length, l, Object.keys(t).length, 'fehlt:', fehlt.join(',') || '-', 'zuviel:', zuviel.join(',') || '-', 'Platzhalter:', phF.join(',') || '-');
  if (fehlt.length || zuviel.length || phF.length) { rc = 1; continue; }
  writeFileSync(new URL('../texte/' + l + '.json', import.meta.url), JSON.stringify(Object.fromEntries(Object.keys(hu).map(k => [k, t[k]])), null, 1) + '\n');
}
process.exit(rc);
