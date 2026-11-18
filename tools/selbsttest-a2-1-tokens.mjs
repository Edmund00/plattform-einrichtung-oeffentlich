// A2-1: CSS-Token-Test — keine festen Farben (#hex, rgb, rgba, hsl) außerhalb :root.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let ok = 0, schlecht = 0;
const pruefe = (name, wert, detail = '') => {
  wert ? ok++ : schlecht++;
  console.log((wert ? 'OK     ' : 'FEHLER ') + name + (!wert && detail ? '  -> ' + String(detail).slice(0, 220) : ''));
};

const PUBLIC = new URL('../public', import.meta.url).pathname;

function alleDateien(dir, endung) {
  const ergebnisse = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) ergebnisse.push(...alleDateien(p, endung));
    else if (e.name.endsWith(endung)) ergebnisse.push(p);
  }
  return ergebnisse;
}

const FARB_REG = /#[0-9a-fA-F]{3,8}\b|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\)/g;

function rootBloeckeEntfernen(text) {
  return text.replace(/:root\s*\{[^}]*\}/gs, '');
}

// === CSS-Dateien (jogi/recht.css ausgenommen) ===
const cssDat = alleDateien(PUBLIC, '.css')
  .filter(p => !/[\\/]jogi[\\/]recht\.css$/.test(p))
  .sort();

for (const pfad of cssDat) {
  const rel = pfad.replace(PUBLIC + '/', '');
  const text = readFileSync(pfad, 'utf8');
  const ohneRoot = rootBloeckeEntfernen(text);
  const treffer = [...ohneRoot.matchAll(FARB_REG)].map(m => m[0]);
  pruefe(rel + ': keine Festfarben außerhalb :root', treffer.length === 0, treffer.slice(0, 6).join(', '));
}

// === HTML: keine <style>-Blöcke mit Festfarben ===
const htmlDat = alleDateien(PUBLIC, '.html').sort();
for (const pfad of htmlDat) {
  const rel = pfad.replace(PUBLIC + '/', '');
  const text = readFileSync(pfad, 'utf8');
  const stile = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  if (!stile) {
    pruefe(rel + ': keine <style>-Blöcke', true);
    continue;
  }
  const treffer = [...stile.matchAll(FARB_REG)].map(m => m[0]);
  pruefe(rel + ': keine Festfarben in <style>', treffer.length === 0, treffer.slice(0, 6).join(', '));
}

// === A2-1b: Knopftext, Verlauf, Hero, Standardwerte ===

const KUNDE_CSS = join(PUBLIC, 'kunde.css');
const ADMIN_CSS = join(PUBLIC, 'admin', 'admin.css');

function rootWert(text, varName) {
  const rm = text.match(/:root\s*\{([^}]*)\}/s);
  if (!rm) return null;
  const re = new RegExp(varName + '\\s*:\\s*([^;}]+)');
  const vm = rm[1].match(re);
  return vm ? vm[1].trim() : null;
}

function regelBloecke(text) {
  const ohneRoot = text.replace(/:root\s*\{[^}]*\}/gs, '');
  const re = /([^{}@\n][^{}]*)\{([^{}]*)\}/gs;
  const ergebnisse = [];
  let m;
  while ((m = re.exec(ohneRoot)) !== null) {
    ergebnisse.push({ sel: m[1].trim(), body: m[2] });
  }
  return ergebnisse;
}

// (b) --grad enthält --gold-m
{
  const text = readFileSync(KUNDE_CSS, 'utf8');
  const grad = rootWert(text, '--grad');
  pruefe('kunde.css: --grad enthält --gold-m', !!grad && grad.includes('--gold-m'), `--grad: ${grad}`);
}

// (c) :root Standardwerte
const STANDARD_KUNDE = {
  '--gold': '#d4a843', '--gold-m': '#8e702d', '--gold-d': '#8a6d2c',
  '--gold-l': '#e3c685', '--night': '#0d0a05', '--black': '#070503',
  '--ivory': '#faf6ee', '--ink': '#1a1a1a', '--line': '#dcd8d1',
  '--text-on-dark': '#ffffff', '--text-second': '#52514f',
  '--footer-text': '#cfcecd', '--focus': '#8a6d2c', '--knopf-text': '#000000',
};
for (const [pfad, name, standard] of [
  [KUNDE_CSS, 'kunde.css', STANDARD_KUNDE],
  [ADMIN_CSS, 'admin.css', { '--gold-m': '#8e702d', '--knopf-text': '#000000' }],
]) {
  const text = readFileSync(pfad, 'utf8');
  const fehler = [];
  for (const [v, erw] of Object.entries(standard)) {
    const ist = rootWert(text, v);
    if (ist !== erw) fehler.push(`${v}: ${ist ?? 'fehlt'}≠${erw}`);
  }
  pruefe(`${name}: :root Standardwerte`, fehler.length === 0, fehler.slice(0, 4).join('; '));
}

// (a) + (d) var(--grad)-Regeln
for (const [pfad, name] of [[KUNDE_CSS, 'kunde.css'], [ADMIN_CSS, 'admin.css']]) {
  const text = readFileSync(pfad, 'utf8');
  const gradRegeln = regelBloecke(text).filter(r => r.body.includes('var(--grad)'));

  const ohneKnopftext = gradRegeln.filter(r => !r.body.includes('color:var(--knopf-text)'));
  pruefe(`${name}: var(--grad)→color:var(--knopf-text)`,
    ohneKnopftext.length === 0, ohneKnopftext.map(r => r.sel.slice(0, 60)).join(' | '));

  const mitBlack = gradRegeln.filter(r => r.body.includes('color:var(--black)'));
  pruefe(`${name}: kein color:var(--black) auf var(--grad)`,
    mitBlack.length === 0, mitBlack.map(r => r.sel.slice(0, 60)).join(' | '));
}

// (e) Hero/Medien → --text-on-dark
{
  const text = readFileSync(KUNDE_CSS, 'utf8');
  const regeln = regelBloecke(text);

  const heroRegeln = regeln.filter(r => /\.hero\b/.test(r.sel) && !r.sel.includes('.lead'));
  const heroMitWhite = heroRegeln.filter(r => /color:var\(--white\)/.test(r.body));
  pruefe('kunde.css: Hero nutzt --text-on-dark statt --white',
    heroMitWhite.length === 0, heroMitWhite.map(r => r.sel.slice(0, 80)).join(' | '));

  const mediaH = regeln.filter(r => /media-tartalom.*h[123]/.test(r.sel));
  const mediaHMitWhite = mediaH.filter(r => /color:var\(--white\)/.test(r.body));
  pruefe('kunde.css: Media-Überschriften nutzen --text-on-dark',
    mediaHMitWhite.length === 0, mediaHMitWhite.map(r => r.sel.slice(0, 80)).join(' | '));
}

// (f) A2-3b: ::selection und .pdf-werkzeuge hover — Tokenisierung
{
  const text = readFileSync(KUNDE_CSS, 'utf8');
  // ::selection soll --knopf-text statt --black verwenden
  const selectionMatch = text.match(/::selection\s*\{([^}]*)\}/);
  const selectionBody = selectionMatch ? selectionMatch[1] : '';
  pruefe('kunde.css: ::selection nutzt --knopf-text (nicht --black)',
    selectionBody.includes('--knopf-text') && !selectionBody.includes('color:var(--black)'),
    `::selection body: ${selectionBody.trim()}`);
  // .pdf-werkzeuge .knopf:hover soll --text-on-dark statt --white verwenden
  const pdfHoverMatch = text.match(/\.pdf-werkzeuge\s+\.knopf:hover\s*\{([^}]*)\}/);
  const pdfHoverBody = pdfHoverMatch ? pdfHoverMatch[1] : 'nicht gefunden';
  pruefe('kunde.css: .pdf-werkzeuge .knopf:hover nutzt --text-on-dark (nicht --white)',
    pdfHoverBody.includes('--text-on-dark') && !pdfHoverBody.includes('color:var(--white)'),
    `.pdf-werkzeuge .knopf:hover body: ${pdfHoverBody.trim()}`);
}

console.log(`\nErgebnis: ${ok} OK, ${schlecht} FEHLER`);
if (schlecht > 0) process.exit(1);
