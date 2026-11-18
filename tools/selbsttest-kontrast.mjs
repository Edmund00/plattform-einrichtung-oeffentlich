import './test-sprache.mjs';
import { readFileSync } from 'node:fs';
let ok = 0, schlecht = 0;
function pruefe(name, bedingung) {
  if (bedingung) ok++; else schlecht++;
  console.log(`${bedingung ? 'OK' : 'FEHLER'} ${name}`);
}
const nahe = (ist, soll, toleranz = 1e-12) => Math.abs(ist - soll) <= toleranz;
try {
  const { hexPruefen, relativeLuminanz, kontrast, pruefeFarben } = await import('../kontrast.mjs');
  // Hexkanaele treffen das Intervall zwischen alter und neuer Schwelle nicht.
  // Eine reine Testkopie macht die interne Umrechnung fuer Zwischenwerte erreichbar.
  const quelle = readFileSync(new URL('../kontrast.mjs', import.meta.url), 'utf8');
  const intern = await import(`data:text/javascript;base64,${Buffer.from(quelle + '\nexport { linearisiere };').toString('base64')}`);
  pruefe('sRGB-Schwelle 0.04045: Zwischenwert linear', nahe(intern.linearisiere(0.04), 0.04 / 12.92));
  pruefe('sRGB-Schwelle einschliesslich Grenzwert', nahe(intern.linearisiere(0.04045), 0.04045 / 12.92));
  pruefe('sRGB oberhalb der Schwelle', nahe(intern.linearisiere(0.041), ((0.041 + 0.055) / 1.055) ** 2.4));
  for (const [hex, soll] of [['#ff0000', 0.2126], ['#00ff00', 0.7152], ['#0000ff', 0.0722], ['#000000', 0], ['#ffffff', 1]]) {
    pruefe(`Luminanz ${hex}`, nahe(relativeLuminanz(hex), soll));
  }
  pruefe('Schwarz/Weiss = 21', nahe(kontrast('#000000', '#ffffff'), 21, 0.01));
  pruefe('Gleiche Farbe = 1', kontrast('#123456', '#123456') === 1);
  pruefe('Grauwert 128 = ca. 3.95', nahe(kontrast('#808080', '#ffffff'), 3.95, 0.01));
  pruefe('Grauwert 118 besteht 4.5', nahe(kontrast('#767676', '#ffffff'), 4.54, 0.01) && kontrast('#767676', '#ffffff') >= 4.5);
  pruefe('Grauwert 119 unterschreitet 4.5', nahe(kontrast('#777777', '#ffffff'), 4.48, 0.01) && kontrast('#777777', '#ffffff') < 4.5);
  pruefe('Reihenfolge egal', kontrast('#abcdef', '#123456') === kontrast('#123456', '#abcdef'));
  pruefe('Hex normalisiert', hexPruefen('#ABCDEF') === '#abcdef');
  for (const wert of ['#abc', 'abcdef', '#GGGGGG', ' #ffffff', '#ffffff ', 123, null, '#ffffff00', '#ffffff\n', 'rgb(0,0,0)', 'red', undefined, {}, Symbol('farbe'), '#'.repeat(100000)]) {
    pruefe(`Ungueltiger Hexwert (${typeof wert})`, hexPruefen(wert) === null);
  }
  for (const aufruf of [() => relativeLuminanz('#abc'), () => kontrast('#ffffff', null), () => kontrast(null, '#ffffff')]) {
    let richtig = false;
    try { aufruf(); } catch (e) { richtig = e instanceof Error && e.message === 'hex_ungueltig'; }
    pruefe('Ungueltiger Rechenwert wirft hex_ungueltig', richtig);
  }
  const gut = { text: '#1a1a1a', grund: '#ffffff', haupt: '#0b5cad', akzent: '#b45309' };
  const ergebnis = pruefeFarben(gut);
  pruefe('Guter Farbsatz', ergebnis.ok === true && ergebnis.gueltig === true && ergebnis.probleme.length === 0);
  const schlechtText = pruefeFarben({ ...gut, text: '#777777' });
  pruefe('Textproblem mit Rundung und Regel', !schlechtText.ok && schlechtText.gueltig && schlechtText.probleme.some(p => p.paar === 'text/grund' && p.verhaeltnis === 4.48 && p.min === 4.5 && p.regel === '1.4.3'));
  const alle = pruefeFarben({ text: '#ffffff', grund: '#ffffff', haupt: '#ffffff', akzent: '#ffffff' });
  pruefe('Alle fuenf Paare und Regeln', JSON.stringify(alle.probleme) === JSON.stringify([
    { paar: 'text/grund', verhaeltnis: 1, min: 4.5, regel: '1.4.3' },
    { paar: 'haupt/grund', verhaeltnis: 1, min: 3, regel: '1.4.11' },
    { paar: 'akzent/grund', verhaeltnis: 1, min: 3, regel: '1.4.11' },
    { paar: 'weiss/haupt', verhaeltnis: 1, min: 4.5, regel: '1.4.3' },
    { paar: 'weiss/akzent', verhaeltnis: 1, min: 4.5, regel: '1.4.3' }
  ]));
  for (const feld of ['haupt', 'akzent', 'text', 'grund']) {
    const ungueltig = pruefeFarben({ ...gut, [feld]: '#xyz' });
    pruefe(`Ungueltiges Feld ${feld}`, !ungueltig.ok && !ungueltig.gueltig && ungueltig.probleme.some(p => p.feld === feld && p.fehler === 'hex_ungueltig'));
  }
} catch (e) {
  schlecht++;
  console.log('FEHLER Ausnahme: ' + (e?.stack || e));
}
console.log(`Ergebnis: ${ok} OK, ${schlecht} FEHLER`);
process.exitCode = schlecht ? 1 : 0;
