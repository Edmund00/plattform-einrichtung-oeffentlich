import { createHash } from 'node:crypto';
import { hexPruefen, kontrast } from './kontrast.mjs';

// Mischt die sRGB-Bytes ohne Umrechnung in lineares Licht.
export function mischen(hexA, hexB, t) {
  const a = hexPruefen(hexA), b = hexPruefen(hexB);
  if (a === null || b === null || !Number.isFinite(t) || t < 0 || t > 1) throw new Error('mischung_ungueltig');
  return '#' + [1, 3, 5].map(i => Math.round(
    parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t
  ).toString(16).padStart(2, '0')).join('');
}

export function leiteAb(eingabe) {
  const probleme = [], farben = {};
  for (const feld of ['haupt', 'dunkel', 'hell']) {
    const wert = eingabe !== null && typeof eingabe === 'object' && !Array.isArray(eingabe) ? eingabe[feld] : undefined;
    farben[feld] = hexPruefen(wert);
    if (farben[feld] === null) probleme.push({ code: 'hex_ungueltig', feld });
  }
  if (probleme.length) return { gueltig: false, ok: false, tokens: null, pruefung: [], probleme };
  const { haupt, dunkel, hell } = farben;
  let goldD, gefunden = false;
  for (let schritt = 0; schritt <= 19; schritt++) {
    goldD = mischen(haupt, '#000000', schritt / 20);
    if (kontrast(goldD, hell) >= 4.5 && kontrast(goldD, '#ffffff') >= 4.5) {
      gefunden = true;
      break;
    }
  }
  // Ohne Treffer bleibt der letzte Kandidat fuer die vollstaendige Pruefung erhalten.
  if (!gefunden) probleme.push({ code: 'gold_dunkel_nicht_ableitbar' });
  const bester = (a, b, grund) => kontrast(a, grund) >= kontrast(b, grund) ? a : b;
  const textOnDark = bester('#ffffff', '#111111', dunkel);
  const tokens = {
    gold: haupt, night: dunkel, ivory: hell, white: '#ffffff', goldD,
    goldL: mischen(haupt, '#ffffff', 0.35), black: mischen(dunkel, '#000000', 0.5),
    line: mischen(hell, '#000000', 0.12), ink: bester('#1a1a1a', '#ffffff', hell),
    textOnDark, footerText: mischen(textOnDark, dunkel, 0.2),
    knopfText: bester('#000000', '#ffffff', haupt), focus: goldD
  };
  // Den bisherigen Mischanteil erhalten, sofern beide dunklen Flaechen passen.
  // Ohne Treffer bleibt Weiss als letzter Kandidat fuer die Pruefung erhalten.
  for (let schritt = 35; schritt <= 100; schritt++) {
    tokens.goldL = mischen(haupt, '#ffffff', schritt / 100);
    if ([tokens.night, tokens.black].every(grund => kontrast(tokens.goldL, grund) >= 4.5)) break;
  }
  for (let schritt = 4; schritt >= 0; schritt--) {
    const kandidat = mischen(textOnDark, dunkel, schritt / 20);
    if ([tokens.night, tokens.black].every(grund => kontrast(kandidat, grund) >= 4.5)) {
      tokens.footerText = kandidat;
      break;
    }
  }
  tokens.goldM = haupt;
  for (let schritt = 20; schritt >= 0; schritt--) {
    const kandidat = mischen(haupt, goldD, schritt / 20);
    if (kontrast(tokens.knopfText, kandidat) >= 4.5 && kontrast(tokens.knopfText, mischen(tokens.gold, kandidat, 0.5)) >= 4.5) {
      tokens.goldM = kandidat;
      break;
    }
  }
  tokens.textSecond = tokens.ink;
  for (let schritt = 5; schritt >= 0; schritt--) {
    const kandidat = mischen(tokens.ink, hell, schritt / 20);
    if (kontrast(kandidat, hell) >= 4.5 && kontrast(kandidat, tokens.white) >= 4.5) {
      tokens.textSecond = kandidat;
      break;
    }
  }
  for (let schritt = 0; schritt <= 10; schritt++) {
    const kandidat = mischen(goldD, '#767676', schritt / 10);
    if ([hell, tokens.white, dunkel].every(grund => kontrast(kandidat, grund) >= 3)) {
      tokens.focus = kandidat;
      break;
    }
  }
  const pruefwerte = { ...tokens, gradMitte: mischen(tokens.gold, tokens.goldM, 0.5) };
  const paare = [
    ['ink', 'ivory'], ['knopfText', 'gold'],
    ['textOnDark', 'night'], ['footerText', 'night'], ['footerText', 'black'], ['goldD', 'ivory'],
    ['goldD', 'white'], ['white', 'goldD'], ['focus', 'ivory'],
    ['focus', 'white'], ['focus', 'night'],
    ['knopfText', 'goldM'], ['knopfText', 'gradMitte'], ['textOnDark', 'black'],
    ['textSecond', 'ivory'], ['textSecond', 'white'], ['goldL', 'night'], ['goldL', 'black']
  ];
  const pruefung = paare.map(([vorn, hinten]) => {
    const paar = `${vorn}/${hinten}`, soll = vorn === 'focus' ? 3 : 4.5;
    const wert = kontrast(pruefwerte[vorn], pruefwerte[hinten]);
    // Die Entscheidung nutzt den ungerundeten Wert.
    const verhaeltnis = Number(wert.toFixed(2)), ok = wert >= soll;
    if (!ok) probleme.push({ code: 'kontrast_zu_gering', paar, verhaeltnis, soll });
    return { paar, vordergrund: pruefwerte[vorn], hintergrund: pruefwerte[hinten], verhaeltnis, soll, regel: soll === 3 ? '1.4.11' : '1.4.3',
      beschreibung: paar === 'white/goldD' ? 'Weisser Text auf goldD-Flaechen (Kuendigungsknopf, Hover)' : `${vorn} auf ${hinten}`, ok };
  });
  return { gueltig: true, ok: probleme.length === 0, tokens, pruefung, probleme };
}

const cssFelder = [
  ['gold', 'gold'], ['gold-m', 'goldM'], ['gold-d', 'goldD'], ['gold-l', 'goldL'], ['night', 'night'],
  ['black', 'black'], ['ivory', 'ivory'], ['ink', 'ink'], ['line', 'line'],
  ['text-on-dark', 'textOnDark'], ['text-second', 'textSecond'], ['footer-text', 'footerText'],
  ['focus', 'focus'], ['knopf-text', 'knopfText']
];

export function erzeugeCss(tokens) {
  if (tokens === null || typeof tokens !== 'object' || Array.isArray(tokens)) return '';
  const werte = cssFelder.map(([, feld]) => hexPruefen(tokens[feld]));
  if (werte.some(wert => wert === null)) return '';
  return ':root{' + cssFelder.map(([name], i) => `--${name}:${werte[i]};`).join('') + '}';
}

export function cssHash(css) {
  return createHash('sha1').update(css).digest('hex').slice(0, 8);
}
