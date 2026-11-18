// Selbsttest Generator-Sync (13.11.2026): Die Generatorquellen tools/<sprache>/teil*.mjs (de, en) muessen EXAKT dem Inhalt von
// texte/<sprache>.json entsprechen (gleiche Schluessel, gleiche Werte), damit `node tools/sprachen-bauen.mjs` keine neueren Texte verliert
// und nicht mit "fehlt" abbricht. Dazu: Neuaufbau-Probelauf im Speicher gegen hu.json (Schluessel, Platzhalter). Kein Server, keine Schluessel.
// Aufruf: node tools/selbsttest-generator-sync.mjs   (vom Ordner plattform/ aus)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

let ok = 0, fehler = 0;
const pruefe = (b, text) => { if (b) ok++; else { fehler++; console.log('FEHLER:', text); } };
const lade = (l) => JSON.parse(readFileSync(`texte/${l}.json`, 'utf8').replace(/^﻿/, ''));
const ph = s => (String(s).match(/\{[a-z_]+\}/g) || []).sort().join(',');
const hu = lade('hu');

for (const l of ['de', 'en']) {
  const json = lade(l);
  const quelle = {};
  for (const teil of ['teil1', 'teil2', 'teil3']) {
    Object.assign(quelle, (await import(pathToFileURL(resolve(`tools/${l}/${teil}.mjs`)).href)).default);
  }
  const fehlt = Object.keys(json).filter(k => !(k in quelle));
  const zuviel = Object.keys(quelle).filter(k => !(k in json));
  const anders = Object.keys(json).filter(k => k in quelle && json[k] !== quelle[k]);
  pruefe(fehlt.length === 0, `${l}: Schluessel in texte/${l}.json, aber nicht im Generator (${fehlt.length}): ${fehlt.slice(0, 5).join(', ')}`);
  pruefe(zuviel.length === 0, `${l}: Schluessel im Generator, aber nicht in texte/${l}.json (${zuviel.length}): ${zuviel.slice(0, 5).join(', ')}`);
  pruefe(anders.length === 0, `${l}: abweichende Werte Generator <> JSON (${anders.length}): ${anders.slice(0, 5).join(', ')}`);
  const fehltHu = Object.keys(hu).filter(k => !(k in quelle));
  const phFehler = Object.keys(hu).filter(k => k in quelle && ph(hu[k]) !== ph(quelle[k]));
  pruefe(fehltHu.length === 0, `${l}: Generator hat nicht alle hu-Schluessel (${fehltHu.length})`);
  pruefe(phFehler.length === 0, `${l}: Platzhalter weichen von hu ab (${phFehler.length}): ${phFehler.slice(0, 5).join(', ')}`);
  pruefe(Object.keys(quelle).length === Object.keys(hu).length, `${l}: Schluesselanzahl Generator ${Object.keys(quelle).length} <> hu ${Object.keys(hu).length}`);
  // Stichproben der Backlog-Funktionen vom 12.11.2026 (Widerruf-Abschluss, Betrag, refund.failed)
  for (const k of ['a_widerruf_erledigen', 'a_widerruf_fallreferenz', 'a_erstattung_stripe_fehler', 'a_ar_seged_dezimal', 'grund_doppelt_bezahlt']) {
    pruefe(k in quelle && quelle[k] === json[k], `${l}: Stichprobe ${k} fehlt oder weicht ab`);
  }
}

console.log(fehler ? `${ok} bestanden, ${fehler} FEHLER` : `Generator-Sync: ${ok} bestanden, 0 Fehler`);
process.exit(fehler ? 1 : 0);
