import './test-sprache.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { kontrast } from '../kontrast.mjs';
let ok = 0, schlecht = 0;
function pruefe(name, bedingung) {
  if (bedingung) ok++; else schlecht++;
  console.log(`${bedingung ? 'OK' : 'FEHLER'} ${name}`);
}
try {
  const { mischen, leiteAb, erzeugeCss, cssHash } = await import('../farben.mjs');
  const gut = { haupt: '#0b5cad', dunkel: '#000000', hell: '#f5f7fa' };
  pruefe('Mischen Anfang', mischen('#ABCDEF', '#123456', 0) === '#abcdef');
  pruefe('Mischen Ende', mischen('#abcdef', '#123456', 1) === '#123456');
  pruefe('Mischen Mitte und Rundung', mischen('#000000', '#ffffff', 0.5) === '#808080');
  pruefe('Mischen Reihenfolge', mischen('#123456', '#abcdef', 0.25) === mischen('#abcdef', '#123456', 0.75));
  const ergebnis = leiteAb(gut);
  pruefe('Determinismus', JSON.stringify(ergebnis) === JSON.stringify(leiteAb(gut)));
  pruefe('Guter Satz', ergebnis.gueltig && ergebnis.ok && ergebnis.probleme.length === 0);
  const beispiel = leiteAb({ ...gut, dunkel: '#10243e' });
  pruefe('Vorgeschlagenes Beispiel durch Fokus-Ableitung akzeptiert', beispiel.ok === true);
  const standard = leiteAb({ haupt: '#d4a843', dunkel: '#0d0a05', hell: '#faf6ee' });
  console.log('Standardfarben-Pruefung: ' + JSON.stringify(standard));
  pruefe('Standardfarben akzeptiert: alle 18 Paare ok', standard.gueltig && standard.ok === true && standard.pruefung.length === 18 && standard.pruefung.every(p => p.ok));
  pruefe('Standard goldL unveraendert', standard.tokens.goldL === '#e3c685');
  pruefe('Standard goldM erhaelt Verlauf', standard.tokens.goldM !== standard.tokens.gold);
  pruefe('Standard goldD erster geeigneter Schritt', standard.tokens.goldD === '#8a6d2c');
  for (const [vorn, hinten, soll] of [['white', 'goldD', 4.5], ['goldD', 'ivory', 4.5], ['focus', 'night', 3]]) {
    const wert = kontrast(standard.tokens[vorn], standard.tokens[hinten]);
    console.log(`Standard ungerundet ${vorn}/${hinten}: ${wert} (Soll ${soll})`);
    pruefe(`Standard ungerundet ${vorn}/${hinten}`, wert >= soll);
  }
  console.log('Standard footerText: ' + standard.tokens.footerText);
  pruefe('Standard footerText unveraendert', standard.tokens.footerText === '#cfcecd');
  const schwarz = leiteAb({ haupt: '#000000', dunkel: '#2b2b2b', hell: '#faf6ee' });
  console.log('Schwarzer Satz: ' + JSON.stringify({ ok: schwarz.ok, goldL: schwarz.tokens.goldL, night: kontrast(schwarz.tokens.goldL, schwarz.tokens.night), black: kontrast(schwarz.tokens.goldL, schwarz.tokens.black), probleme: schwarz.probleme }));
  for (const r of [standard, schwarz, leiteAb({ ...gut, dunkel: '#ffffff' })]) {
    for (const grund of ['night', 'black']) {
      const paar = `goldL/${grund}`, wert = kontrast(r.tokens.goldL, r.tokens[grund]);
      const p = r.pruefung.find(p => p.paar === paar);
      pruefe(`goldL ehrlich ${paar}`, !!p && p.soll === 4.5 && p.ok === (wert >= 4.5) && (p.ok || r.probleme.some(f => f.paar === paar)));
    }
  }
  pruefe('Schwarzer Satz akzeptiert oder benanntes Paar', schwarz.ok === true || schwarz.probleme.some(p => p.code === 'kontrast_zu_gering' && schwarz.pruefung.some(f => f.paar === p.paar && !f.ok)));
  pruefe('Schwarzer Satz goldL ausreichend aufgehellt', ['night', 'black'].every(g => kontrast(schwarz.tokens.goldL, schwarz.tokens[g]) >= 4.5));
  const unloesbar = leiteAb({ ...gut, dunkel: '#ffffff' });
  pruefe('goldL ohne Loesung letzter Wert Weiss und Fehler', unloesbar.tokens.goldL === '#ffffff' && unloesbar.probleme.some(p => p.paar === 'goldL/night'));
  const weisserFooter = leiteAb({ haupt: '#d4a843', dunkel: '#ffffff', hell: '#faf6ee' });
  for (const grund of ['night', 'black']) {
    const wert = kontrast(weisserFooter.tokens.footerText, weisserFooter.tokens[grund]);
    console.log(`Weisser Footer ungerundet footerText/${grund}: ${wert}`);
    pruefe(`Weisser Footer footerText/${grund}`, wert >= 4.5);
  }
  const hell = leiteAb({ haupt: '#ffd700', dunkel: '#222222', hell: '#ffffff' });
  console.log('Heller Satz: ' + JSON.stringify({ ok: hell.ok, probleme: hell.probleme }));
  pruefe('Heller Satz akzeptiert', hell.ok === true);
  const grau = leiteAb({ haupt: '#808080', dunkel: '#777777', hell: '#888888' });
  pruefe('Grauer Satz meldet Kontrastprobleme', grau.ok === false && grau.probleme.some(p => p.code === 'kontrast_zu_gering'));
  const namen = ['ink/ivory', 'knopfText/gold', 'textOnDark/night', 'footerText/night', 'footerText/black', 'goldD/ivory', 'goldD/white', 'white/goldD', 'focus/ivory', 'focus/white', 'focus/night', 'knopfText/goldM', 'knopfText/gradMitte', 'textOnDark/black', 'textSecond/ivory', 'textSecond/white', 'goldL/night', 'goldL/black'];
  pruefe('Exakt 18 Paare in Reihenfolge', JSON.stringify(ergebnis.pruefung.map(p => p.paar)) === JSON.stringify(namen));
  pruefe('Regression: kein knopfText/goldD', [standard, hell, ergebnis].every(r => !r.pruefung.some(p => p.paar === 'knopfText/goldD')));
  pruefe('Weisser Text auf goldD beschrieben', standard.pruefung.find(p => p.paar === 'white/goldD')?.beschreibung === 'Weisser Text auf goldD-Flaechen (Kuendigungsknopf, Hover)');
  for (const r of [standard, hell, ergebnis]) {
    const fokus = r.pruefung.filter(p => p.paar.startsWith('focus/'));
    const kandidaten = Array.from({ length: 11 }, (_, i) => mischen(r.tokens.goldD, '#767676', i / 10));
    const erwartet = kandidaten.find(k => [r.tokens.ivory, r.tokens.white, r.tokens.night].every(h => kontrast(k, h) >= 3)) ?? r.tokens.goldD;
    pruefe('Erste geeignete Fokusfarbe, drei Hintergruende, Soll 3, WCAG 1.4.11', r.tokens.focus === erwartet && JSON.stringify(fokus.map(p => p.paar)) === JSON.stringify(['focus/ivory', 'focus/white', 'focus/night']) && fokus.every(p => p.vordergrund === r.tokens.focus && p.soll === 3 && p.regel === '1.4.11'));
  }
  for (const dunkel of ['#0d0a05', '#ffffff', '#777777']) {
    const r = leiteAb({ ...gut, dunkel });
    const t = r.tokens;
    const bisher = mischen(t.textOnDark, t.night, 0.2);
    const erwartet = Array.from({ length: 5 }, (_, i) => mischen(t.textOnDark, t.night, (4 - i) / 20))
      .find(k => [t.night, t.black].every(h => kontrast(k, h) >= 4.5)) ?? bisher;
    pruefe('Erster geeigneter Footer-Kandidat oder bisheriger Wert', t.footerText === erwartet);
    for (const grund of ['night', 'black']) {
      const p = r.pruefung.find(p => p.paar === `footerText/${grund}`);
      pruefe(`Footer-Pruefpaar ehrlich ${grund}`, !!p && p.soll === 4.5 && p.ok === (kontrast(t.footerText, t[grund]) >= 4.5) && (p.ok || r.probleme.some(f => f.paar === p.paar)));
    }
  }
  const opus = leiteAb({ haupt: '#1f4fa0', dunkel: '#0d0a05', hell: '#faf6ee' });
  pruefe('Opus weiss auf goldM bestanden', opus.ok === true && opus.tokens.knopfText === '#ffffff' && opus.pruefung.find(p => p.paar === 'knopfText/goldM')?.ok === true);
  for (const [eingabe, paare] of [
    [{ ...gut, dunkel: '#ffffff' }, ['textOnDark/black']],
    [{ ...gut, hell: '#8a8a8a' }, ['textSecond/ivory', 'textSecond/white']]
  ]) {
    const r = leiteAb(eingabe);
    for (const paar of paare) {
      const p = r.pruefung.find(p => p.paar === paar);
      console.log('Grenzfall ' + JSON.stringify({ eingabe, pruefung: p, probleme: r.probleme }));
      pruefe(`Grenzfall ehrlich ${paar}`, !!p && (kontrast(p.vordergrund, p.hintergrund) >= 4.5 ? p.ok : !p.ok && r.probleme.some(f => f.paar === paar)));
    }
  }
  for (const r of [standard, ergebnis, opus]) {
    const t = r.tokens;
    const goldKandidaten = Array.from({ length: 21 }, (_, i) => mischen(t.gold, t.goldD, (20 - i) / 20));
    const goldErwartet = goldKandidaten.find(k => kontrast(t.knopfText, k) >= 4.5 && kontrast(t.knopfText, mischen(t.gold, k, 0.5)) >= 4.5) ?? t.gold;
    const textErwartet = Array.from({ length: 6 }, (_, i) => mischen(t.ink, t.ivory, (5 - i) / 20)).find(k => kontrast(k, t.ivory) >= 4.5 && kontrast(k, t.white) >= 4.5) ?? t.ink;
    pruefe('Groesster goldM und groesster textSecond Schritt', t.goldM === goldErwartet && t.textSecond === textErwartet);
    pruefe('Gradientmitte nur als Pruefwert', !('gradMitte' in t) && !erzeugeCss(t).includes('--grad') && r.pruefung.find(p => p.paar === 'knopfText/gradMitte')?.hintergrund === mischen(t.gold, t.goldM, 0.5));
  }
  const standardVertrag = r => r.ok === true && JSON.stringify(r.pruefung.map(p => p.paar)) === JSON.stringify(namen) && r.pruefung.every(p => p.ok && p.soll === (p.paar.startsWith('focus/') ? 3 : 4.5) && typeof p.beschreibung === 'string' && p.beschreibung.length > 0);
  pruefe('Standardvertrag mit Beschreibungen', standardVertrag(standard));
  const quelle = (await readFile(new URL('../farben.mjs', import.meta.url), 'utf8')).replace("'./kontrast.mjs'", JSON.stringify(new URL('../kontrast.mjs', import.meta.url).href));
  for (const [name, mutiert] of [
    ['Schwelle 4.5 auf 5.0', quelle.replaceAll('4.5', '5.0')],
    ['footerText/black entfernt', quelle.replace("['footerText', 'black'],", '')],
    ['goldL/night entfernt', quelle.replace("['goldL', 'night'],", '')],
    ['Neues Paar entfernt', quelle.replace("['knopfText', 'goldM'],", '')]
  ]) {
    const modul = await import('data:text/javascript;base64,' + Buffer.from(mutiert).toString('base64'));
    const bestanden = standardVertrag(modul.leiteAb({ haupt: '#d4a843', dunkel: '#0d0a05', hell: '#faf6ee' }));
    console.log(`Mutation ${name}: Standardvertrag ${bestanden ? 'GRUEN' : 'ROT'}`);
    pruefe(`Mutation erkannt: ${name}`, !bestanden);
  }
  console.log('Standardpalette Hex: ' + JSON.stringify(Object.fromEntries(['goldM', 'textSecond', 'focus', 'goldD', 'knopfText', 'black', 'textOnDark', 'goldL'].map(k => [k, standard.tokens[k]]))));
  console.log('Opus Fokus und Verhaeltnisse: ' + JSON.stringify({ focus: opus.tokens.focus, verhaeltnisse: Object.fromEntries(opus.pruefung.map(p => [p.paar, kontrast(p.vordergrund, p.hintergrund)])) }));
  for (const p of ergebnis.pruefung) {
    const wert = kontrast(p.vordergrund, p.hintergrund);
    pruefe(`Pruefung ${p.paar}`, p.verhaeltnis === Number(wert.toFixed(2)) && p.ok === (wert >= p.soll) && p.soll === (p.paar.startsWith('focus/') ? 3 : 4.5) && p.regel === (p.soll === 3 ? '1.4.11' : '1.4.3'));
  }
  for (const eingabe of [{ ...gut, haupt: '#000000' }, { ...gut, haupt: '#ffffff' }, { ...gut, dunkel: gut.hell }, { haupt: '#808080', dunkel: '#808080', hell: '#808080' }, { ...gut, hell: '#000000' }]) {
    const r = leiteAb(eingabe);
    pruefe('Extremwerte nachvollziehbar', r.gueltig && r.pruefung.length === 18 && (r.ok ? r.probleme.length === 0 && r.pruefung.every(p => p.ok) : r.probleme.length > 0 && r.pruefung.filter(p => !p.ok).every(p => r.probleme.some(f => f.code === 'kontrast_zu_gering' && f.paar === p.paar))));
  }
  pruefe('Nicht ableitbar gemeldet', leiteAb({ ...gut, hell: '#000000' }).probleme.some(p => p.code === 'gold_dunkel_nicht_ableitbar'));
  for (const eingabe of [undefined, null, {}, { ...gut, haupt: '#abc' }, { ...gut, haupt: 'red' }, { ...gut, haupt: '#fff;}body{display:none' }, 42, [], { ...gut, haupt: 42 }]) {
    const r = leiteAb(eingabe);
    pruefe('Ungueltige Eingabe', !r.gueltig && !r.ok && r.tokens === null && r.pruefung.length === 0 && r.probleme.length > 0 && r.probleme.every(p => p.code === 'hex_ungueltig') && erzeugeCss(r.tokens) === '');
  }
  for (const feld of ['haupt', 'dunkel', 'hell']) {
    const r = leiteAb({ ...gut, [feld]: undefined });
    pruefe(`Fehlendes Feld ${feld}`, JSON.stringify(r.probleme) === JSON.stringify([{ code: 'hex_ungueltig', feld }]));
  }
  for (const tokens of ['', undefined, null, [], {}, { gold: '#fff;}body{display:none' }, { ...ergebnis.tokens, gold: '#fff;}body{display:none' }, { ...ergebnis.tokens, ink: 42 }]) pruefe('CSS ungueltig oder Injektion', erzeugeCss(tokens) === '');
  const css = erzeugeCss(ergebnis.tokens);
  pruefe('CSS Syntax', /^:root\{(--[a-z-]+:#[0-9a-f]{6};)+\}$/.test(css));
  pruefe('CSS feste Reihenfolge', JSON.stringify([...css.matchAll(/--([a-z-]+):/g)].map(m => m[1])) === JSON.stringify(['gold', 'gold-m', 'gold-d', 'gold-l', 'night', 'black', 'ivory', 'ink', 'line', 'text-on-dark', 'text-second', 'footer-text', 'focus', 'knopf-text']));
  pruefe('Hash exakt SHA1', cssHash(css) === createHash('sha1').update(css).digest('hex').slice(0, 8));
  pruefe('Hash stabil', cssHash(css) === cssHash(erzeugeCss(leiteAb(gut).tokens)));
  pruefe('Hash aendert sich', cssHash(css) !== cssHash(erzeugeCss(leiteAb({ ...gut, haupt: '#0c5cad' }).tokens)));
} catch (e) {
  schlecht++;
  console.log('FEHLER Ausnahme: ' + (e?.stack || e));
}
console.log(`Ergebnis: ${ok} OK, ${schlecht} FEHLER`);
process.exitCode = schlecht ? 1 : 0;
