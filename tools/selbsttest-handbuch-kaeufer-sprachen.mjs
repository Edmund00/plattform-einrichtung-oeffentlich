// Selbsttest Kaeufer-Handbuch Englisch und Ungarisch: prueft die fertigen PDFs und HTML-Quellen, ohne Browser und ohne Server.
// Aufruf (im Ordner plattform): node tools/selbsttest-handbuch-kaeufer-sprachen.mjs
//   anderes PDF (z. B. Gegenprobe mit eingeschleustem Wort): HANDBUCH_PDF_EN=<Pfad> bzw. HANDBUCH_PDF_HU=<Pfad>
// Bauen: node tools/handbuch-bauen.mjs --sprache=en  bzw.  --sprache=hu
// Prueft je Sprache: PDF vorhanden, 15-40 Seiten, richtige Sprache (deutsche Funktionswoerter unter Schwelle, Marker der Zielsprache vorhanden),
// HTML lang-Attribut, gleiche Kapitelzahl wie der DE-Master, alle Kapitel im PDF, Inhaltsverzeichnis mit Seitenzahlen, Versionszeile, Fusszeile,
// Marke der Zielsprache (EN "Example Academy", HU "Példa Akadémia") vorhanden, deutsche Marke "Beispiel-Akademie" und null/undefined verboten,
// KEINE verbotenen Begriffe (Demo/Test/Muster/Sample/Teszt/Minta, Testkarte, 4242, Schluessel, localhost, /api/; HU zusaetzlich "kurzus" und Sie-Form),
// Bilder nur aus bilder-<sprache>/ und alle vorhanden, nur E-Mail-Adressen @example.com.
// Eingebaute Gegenprobe: der Pruefer muss jeden eingeschleusten verbotenen Begriff finden (sonst ist der Pruefer selbst kaputt).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLATTFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HB = join(PLATTFORM, 'handbuch');
let ok = 0, fehler = 0;
const pruefe = (name, wert, info = '') => { wert ? ok++ : fehler++; console.log((wert ? 'OK     ' : 'FEHLER ') + name + (wert || !info ? '' : ' | ' + info)); };

const GEMEINSAM = [
  ['Demo', /demo/i], ['4242', /4242/], ['Testkarte', /testkarte/i], ['Testmodus', /testmodus/i], ['Muster', /muster/i],
  ['/api/', /\/api\//i], ['sk_-Schluessel', /\bsk_(test|live)_/i], ['pk_-Schluessel', /\bpk_(test|live)_/i], ['whsec_', /whsec_/i], ['rk_-Schluessel', /\brk_(test|live)_/i],
  ['null/undefined', /\b(null|undefined)\b/i], ['deutsche Marke Beispiel-Akademie', /beispiel/i],
  ['localhost', /localhost|127\.0\.0\.1/i], ['Stripe-Schluessel', /stripe[-_ ]?(secret|key)|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET/i],
];
const SPRACHEN = {
  en: {
    verboten: [['test card', /test ?cards?/i], ['test mode', /test ?mode/i], ['test payment', /test ?payments?/i], ['sample', /sample/i], ['Testzahlung', /testzahlung/i]],
    marke: 'Example Academy', fremdeMarke: /Példa Akadémia/i,
    marker: ['the', 'and', 'you', 'your', 'to', 'of', 'is', 'with'], markerMin: 0.10, zeichen: null,
    inhalt: 'Contents', version: /Version \d+\.\d+ · As of \d{1,2} [A-Z][a-z]+ \d{4} · Software commit [0-9a-f]{7,}/, fuss: /Page 3 of \d+/,
    gegenprobe: [['test card', 'Pay with the test card'], ['test mode', 'runs in test mode'], ['sample', 'Sample course'], ['Demo', 'demo platform'], ['4242', '4242 4242 4242 4242'], ['Stripe-Schluessel', 'STRIPE_SECRET_KEY'], ['deutsche Marke Beispiel-Akademie', 'Beispiel-Akademie'], ['null/undefined', 'Provider: null']],
  },
  hu: {
    verboten: [['Demó', /demó/i], ['teszt', /teszt/i], ['minta', /minta/i], ['kurzus (statt előadás)', /kurzus/i], ['Sie-Form (Ön)', /(?<!\p{L})Ön(?:nek|t|öket|ök|nél|re|é|)(?!\p{L})/u], ['Testzahlung', /testzahlung/i], ['sample', /sample/i]],
    marke: 'Példa Akadémia', fremdeMarke: /Example Academy/i,
    marker: ['a', 'az', 'és', 'hogy', 'nem', 'vagy', 'egy', 'ha', 'is', 'meg'], markerMin: 0.10, zeichen: /[őű]/,
    inhalt: 'Tartalomjegyzék', version: /Verzió \d+\.\d+ · Kiadás dátuma: \d{4}\. [a-záéíóöőúüű]+ \d{1,2}\. · Szoftver-commit [0-9a-f]{7,}/, fuss: /Oldal: 3 \/ \d+/,
    gegenprobe: [['teszt', 'Fizess a tesztkártyával'], ['minta', 'mintaplatform'], ['kurzus (statt előadás)', 'Új kurzus'], ['Sie-Form (Ön)', 'Kérjük, Ön töltse ki'], ['Demó', 'Demó előadás'], ['4242', '4242 4242'], ['deutsche Marke Beispiel-Akademie', 'Beispiel-Akademie'], ['null/undefined', 'undefined']],
  },
};
// Deutsche Funktionswoerter (kommen in EN/HU-Text praktisch nicht vor)
const DEUTSCH = new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'auf', 'für', 'ein', 'eine', 'du', 'dein', 'deine', 'wird', 'den', 'dem', 'zu', 'von', 'bei', 'sich', 'oder', 'auch', 'nach', 'unter', 'kannst']);
const DEUTSCH_MAX = 0.02;

async function seitenText(buffer) {
  const basis = join(PLATTFORM, 'public', 'vendor', 'pdfjs');
  const pdfjs = await import(pathToFileURL(join(basis, 'pdf.min.mjs')).href);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(basis, 'pdf.worker.min.mjs')).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
  const seiten = [];
  for (let i = 1; i <= doc.numPages; i++) seiten.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ').replace(/\s+/g, ' '));
  await doc.destroy();
  return seiten;
}
const woerter = (t) => t.toLowerCase().match(/\p{L}+/gu) || [];
const anteil = (ws, menge) => ws.filter((w) => menge.has(w)).length / Math.max(1, ws.length);

const deHtml = readFileSync(join(HB, 'handbuch-kaeufer.de.html'), 'utf8');
const deKapitel = [...deHtml.matchAll(/<h2 class="kapitel"/g)].length;
const deBilder = [...deHtml.matchAll(/src="(bilder\/[^"]+)"/g)].length;

for (const [l, S] of Object.entries(SPRACHEN)) {
  console.log('--- Sprache ' + l.toUpperCase());
  const funde = (text) => [...GEMEINSAM, ...S.verboten].filter(([, re]) => re.test(text)).map(([n]) => n);
  try {
    const PDF = process.env['HANDBUCH_PDF_' + l.toUpperCase()] || join(HB, 'ausgabe', 'handbuch-kaeufer-' + l + '.pdf');
    const QUELLE = join(HB, 'handbuch-kaeufer.' + l + '.html');
    pruefe(l + ': HTML-Quelle vorhanden', existsSync(QUELLE));
    pruefe(l + ': PDF vorhanden: ' + PDF, existsSync(PDF));
    if (!existsSync(PDF) || !existsSync(QUELLE)) throw new Error('PDF/Quelle fehlt (zuerst node tools/handbuch-bauen.mjs --sprache=' + l + ')');
    pruefe(l + ': PDF groesser als 100 KB', statSync(PDF).size > 100 * 1024, String(statSync(PDF).size));
    pruefe(l + ': PDF-Kopf %PDF', readFileSync(PDF).subarray(0, 4).toString('latin1') === '%PDF');
    const html = readFileSync(QUELLE, 'utf8');
    pruefe(l + ': HTML lang="' + l + '"', new RegExp('<html lang="' + l + '">').test(html));
    const seiten = await seitenText(readFileSync(PDF));
    const text = seiten.join('\n');
    pruefe(l + ': Seitenzahl 15-40', seiten.length >= 15 && seiten.length <= 40, String(seiten.length));
    // Sprache
    const ws = woerter(text);
    const de = anteil(ws, DEUTSCH), ziel = anteil(ws, new Set(S.marker));
    pruefe(l + ': deutsche Funktionswoerter unter ' + DEUTSCH_MAX * 100 + ' % (' + (de * 100).toFixed(2) + ' %)', de < DEUTSCH_MAX);
    pruefe(l + ': Marker der Zielsprache ueber ' + S.markerMin * 100 + ' % (' + (ziel * 100).toFixed(1) + ' %)', ziel > S.markerMin);
    if (S.zeichen) pruefe(l + ': typische Zeichen der Zielsprache vorhanden', S.zeichen.test(text));
    // Kapitel
    const kapitel = [...html.matchAll(/<h2 class="kapitel" id="k(\d+)"><span class="nr">([^<]+)<\/span>([^<]+)<\/h2>/g)].map((m) => [m[2], m[3]]);
    pruefe(l + ': gleiche Kapitelzahl wie DE (' + deKapitel + ')', kapitel.length === deKapitel, String(kapitel.length));
    const kompakt = text.replace(/\s+/g, '').toLowerCase();
    for (const [nr, titel] of kapitel) pruefe(l + ': Kapitel ' + nr + ' im PDF: ' + titel, kompakt.includes((nr + titel).replace(/\s+/g, '').toLowerCase()));
    pruefe(l + ': Schnellstart vorhanden (★-Kapitel)', kapitel.some(([nr]) => nr === '★'));
    const inhalt = seiten.find((s) => s.includes(S.inhalt)) || '';
    pruefe(l + ': Inhaltsverzeichnis "' + S.inhalt + '"', inhalt.length > 0);
    const letztes = kapitel[kapitel.length - 1]?.[1] || '###';
    pruefe(l + ': Inhaltsverzeichnis mit Seitenzahlen', new RegExp(letztes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\.*\\s*\\d+').test(inhalt), inhalt.slice(-80));
    pruefe(l + ': Versionszeile gefuellt', S.version.test(text));
    pruefe(l + ': Fusszeile mit Seitenangabe', S.fuss.test(text));
    pruefe(l + ': Marke "' + S.marke + '" im PDF', text.includes(S.marke));
    pruefe(l + ': Marke "' + S.marke + '" in der HTML-Quelle', html.includes(S.marke));
    pruefe(l + ': keine fremde Sprachmarke im PDF', !S.fremdeMarke.test(text));
    pruefe(l + ': Bild der Download-Lektion eingebunden', html.includes('bilder-' + l + '/42-lektion-download.png'));
    pruefe(l + ': Gegenprobe: fehlende Marke wird erkannt', !text.split(S.marke).join('').includes(S.marke));
    // Seitenumbruch-CSS wie im DE
    for (const css of ['orphans:3', 'widows:3', 'break-inside:avoid', 'break-before:page']) pruefe(l + ': CSS ' + css, html.includes(css));
    // verbotene Begriffe
    const f = funde(text);
    pruefe(l + ': keine verbotenen Begriffe im PDF', f.length === 0, f.join(', '));
    const fh = funde(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<!--[\s\S]*?-->/g, ''));
    pruefe(l + ': keine verbotenen Begriffe in der HTML-Quelle', fh.length === 0, fh.join(', '));
    // Bilder
    const bilder = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    const png = bilder.filter((b) => b.endsWith('.png'));
    pruefe(l + ': gleiche Bilderzahl wie DE (' + deBilder + ')', bilder.length === deBilder, String(bilder.length));
    pruefe(l + ': alle Bilder aus bilder-' + l + '/', bilder.every((b) => b.startsWith('bilder-' + l + '/')), bilder.filter((b) => !b.startsWith('bilder-' + l + '/')).join(', '));
    const fehlend = bilder.filter((b) => !existsSync(join(HB, b)));
    pruefe(l + ': alle Bilder vorhanden (' + png.length + ' PNG)', fehlend.length === 0, fehlend.join(', '));
    const mails = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) || []).filter((m) => !m.endsWith('@example.com'));
    pruefe(l + ': im PDF nur E-Mail-Adressen @example.com', mails.length === 0, mails.join(', '));
    // Gegenprobe
    for (const [name, beispiel] of S.gegenprobe) pruefe(l + ': Gegenprobe: Pruefer erkennt ' + name, funde(text + ' ' + beispiel).includes(name));
    pruefe(l + ': Gegenprobe: deutscher Text wird als falsche Sprache erkannt',
      anteil(woerter(text + (' Das ist der Kurs und du kannst die Lektion mit dem Konto auf der Seite nicht öffnen.').repeat(400)), DEUTSCH) >= DEUTSCH_MAX);
  } catch (e) { fehler++; console.log('FEHLER ' + l + ': ' + (e?.message || e)); }
}
console.log(`\nHandbuch-Sprachen-Selbsttest (EN/HU): ${ok} OK, ${fehler} FEHLER`);
process.exit(fehler ? 1 : 0);
