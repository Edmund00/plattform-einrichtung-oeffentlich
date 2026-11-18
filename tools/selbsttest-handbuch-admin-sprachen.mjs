// Selbsttest Admin-Handbuch Englisch und Ungarisch: prueft die fertigen PDFs, ohne Browser und ohne Server. Vorbild: tools/selbsttest-handbuch-admin.mjs (Deutsch).
// Aufruf (im Ordner plattform): node tools/selbsttest-handbuch-admin-sprachen.mjs              (beide Sprachen)
//                               node tools/selbsttest-handbuch-admin-sprachen.mjs --sprache=en (nur eine; anderes PDF: HANDBUCH_ADMIN_PDF_EN / HANDBUCH_ADMIN_PDF_HU=<Pfad>)
// Prueft je Sprache: PDF vorhanden, 20-45 Seiten, lang-Attribut der Quelle, richtige Sprache (Anteil deutscher Funktionswoerter unter Schwelle, Anteil der
// Funktionswoerter der Zielsprache ueber Schwelle; HU: "előadás" statt "kurzus"), gleiche Kapitelzahl wie die deutsche Master-Fassung, alle Kapitel mit Nummer im Text,
// Inhaltsverzeichnis mit Seitenzahlen, Versions- und Fusszeile, rechtliche Hinweise, KEINE verbotenen Begriffe (demo, test card/test mode/sample bzw. teszt/minta,
// Umgebungsvariablen, agent, /admin, localhost, sk_/pk_/rk_/whsec_ ...), nur E-Mail-Adressen @example.com, alle Bilder der Quelle vorhanden, gleiche Bildzahl wie DE.
// Eingebaute Gegenprobe: eingeschleuste verbotene Begriffe, deutscher Text und Text der jeweils anderen Sprache muessen ROT werden.
// Gegenprobe am echten PDF (von Hand): node tools/handbuch-admin-bauen.mjs --sprache=en --nur-pdf --einschleusen="test card 4242" --ausgabe=<tmp.pdf>
//   und dann HANDBUCH_ADMIN_PDF_EN=<tmp.pdf> node tools/selbsttest-handbuch-admin-sprachen.mjs --sprache=en  -> muss mit FEHLER enden.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLATTFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HB = join(PLATTFORM, 'handbuch');
const nur = (process.argv.find((x) => x.startsWith('--sprache=')) || '').slice(10);
const SPRACHEN = nur ? [nur] : ['en', 'hu'];
let ok = 0, fehler = 0;
const pruefe = (name, wert, info = '') => { wert ? ok++ : fehler++; console.log((wert ? 'OK     ' : 'FEHLER ') + name + (wert || !info ? '' : ' | ' + info)); };

const GEMEINSAM = [
  ['4242', /4242/], ['Demo', /demo/i], ['/api/', /\/api\//i], ['sk_-Schluessel', /\bsk_(test|live)_/i], ['pk_-Schluessel', /\bpk_(test|live)_/i],
  ['rk_-Schluessel', /\brk_(test|live)_/i], ['whsec_', /whsec_/i], ['localhost', /localhost|127\.0\.0\.1/i],
  ['Einrichtungsvariable', /ADMIN_ERLAUBT|NOTFALL_ENTSPERREN|SICHERUNG_SCHLUESSEL|RESEND_API_KEY|STRIPE_[A-Z_]+|BUNNY_[A-Z_]+|PLATTFORM_NAME|DB_DATEI|TEXT_SPRACHE/],
  ['Agent-Schluessel', /\bvat_[A-Za-z0-9]/], ['null/undefined', /\bnull\b|\bundefined\b|\bNaN\b/], ['Agent/Anbindung', /\bagent\b/i], ['Pfadangabe', /\/admin\b/i], ['deutsche Beispielmarke', /beispiel/i], ['Muster', /muster/i],
];
const S = {
  en: { titel: 'Admin area manual', inhalt: 'Contents', schnell: '★Quickstartinsixsteps',
    verboten: [['test card', /test ?cards?/i], ['test mode', /test ?mode/i], ['test payment', /test ?payments?/i], ['sample', /sample/i],
      ['environment variable', /environment variables?/i], ['Schluessel', /api[ -]?key|secret key|webhook secret/i]],
    marker: ['the', 'and', 'you', 'to', 'is', 'of', 'a', 'in', 'for', 'with', 'or', 'it'], markerMin: 0.15,
    version: /Version \d+\.\d+ · Date \d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4} · Software commit [0-9a-f]{7,}/, fuss: /Page 3 of \d+/,
    recht: [/must be legally reviewed before use in operation with real money/, /Statutory rights may exist independently of this/, /retention periods legally reviewed/],
    alt: [/Cent amounts are not possible/, /does not receive an email/, /no separate list of withdrawals/, /Invitation/i, /lesson is <?\w*>?visible<?\/?\w*>? immediately|is visible immediately/],
    neu: [/19\.99 or 19,99/, /EUR 49\.00, HUF 19900/, /Free access/, /Open withdrawals/, /Email to the customer/, /created hidden|lesson hidden at first/, /12 Nov 2026/],
    inhaltLetzte: /common messages\s*\.*\s*\d+/, gegen: [['test card', 'Pay with the test card'], ['sample', 'Sample course'], ['environment variable', 'set via environment variable']] },
  hu: { titel: 'Kézikönyv az admin felülethez', inhalt: 'Tartalomjegyzék', schnell: '★Gyorskezdéshatlépésben',
    verboten: [['teszt', /teszt/i], ['minta', /minta/i], ['kurzus (Plattform sagt előadás)', /kurzus/i], ['környezeti változó', /környezeti változ/i], ['Schluessel', /api-?kulcs|titkos kulcs/i]],
    marker: ['a', 'az', 'és', 'hogy', 'nem', 'egy', 'is', 'meg', 'vagy', 'csak', 'már'], markerMin: 0.10,
    version: /\d+\.\d+\. verzió · Kiadás dátuma: \d{4}\. (január|február|március|április|május|június|július|augusztus|szeptember|október|november|december) \d{1,2}\. · Szoftver-commit: [0-9a-f]{7,}/, fuss: /3\. oldal \/ \d+/,
    recht: [/valódi pénzzel történő üzemeltetés előtt jogilag ellenőriztetni kell/, /törvényes jogok ettől függetlenül fennállhatnak/, /megőrzési időket az üzemeltetőnek jogilag ellenőriztetnie kell/],
    alt: [/Centes összegek/, /nem kap e-mailt a platformtól/, /nincs külön elállási lista/, /Meghívás/i, /leállítjuk(?!; a pénzt)/, /rögzítjük/, /térítünk/],
    neu: [/19,99 vagy 19\.99/, /EUR 49,00, HUF 19900/, /Ingyenes hozzáférés/, /Nyitott elállások/, /E-mail a vásárlónak/, /először rejtve/, /2026\. 11\. 12\./],
    inhaltLetzte: /gyakori üzenetek\s*\.*\s*\d+/, gegen: [['teszt', 'Fizess a tesztkártyával'], ['minta', 'Mintaplatform'], ['kurzus (Plattform sagt előadás)', 'Új kurzus']] },
};
// Deutsche Funktionswoerter (in EN/HU-Text praktisch nicht vorhanden)
const DE_WOERTER = new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'für', 'auf', 'ein', 'eine', 'einen', 'den', 'dem', 'des', 'wird', 'werden', 'sich', 'zu', 'von', 'im', 'bei', 'oder', 'auch', 'nach', 'wenn', 'kann', 'sind', 'du', 'dein']);
const DE_MAX = 0.015;
const woerter = (text) => text.toLowerCase().match(/[\p{L}]+/gu) || [];
const anteil = (text, set) => { const w = woerter(text); return w.length ? w.filter((x) => set.has(x)).length / w.length : 0; };
const funde = (text, sp) => [...GEMEINSAM, ...S[sp].verboten].filter(([, re]) => re.test(text)).map(([n]) => n);
const spracheOk = (text, sp) => anteil(text, DE_WOERTER) < DE_MAX && anteil(text, new Set(S[sp].marker)) > S[sp].markerMin;
const kapitelAus = (html) => [...html.matchAll(/<h2 class="kapitel" id="k(\d+)"><span class="nr">[^<]*<\/span>([^<]+)<\/h2>/g)].map((m) => ({ nr: m[1], text: m[2] }));
const htmlText = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');

async function seitenText(buffer) {
  const basis = join(PLATTFORM, 'public', 'vendor', 'pdfjs');
  const pdfjs = await import(pathToFileURL(join(basis, 'pdf.min.mjs')).href);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(basis, 'pdf.worker.min.mjs')).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
  const seiten = [];
  // Teile ohne Zeilenende direkt aneinanderfuegen: pdf.js zerlegt Woerter an Zeichen aus der Latin-Ext-Schrift (z. B. "el" "ő" "adás").
  for (let i = 1; i <= doc.numPages; i++) seiten.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str + (x.hasEOL ? ' ' : '')).join('').replace(/\s+/g, ' '));
  await doc.destroy();
  return seiten;
}

const deHtml = readFileSync(join(HB, 'handbuch-admin.de.html'), 'utf8');
const deKapitel = kapitelAus(deHtml);
const deBilder = [...deHtml.matchAll(/src="bilder-admin\/([^"]+)"/g)].map((m) => m[1]);
const deText = htmlText(deHtml);
pruefe('DE-Master: Kapitel gefunden (' + deKapitel.length + ')', deKapitel.length >= 15);

for (const sp of SPRACHEN) {
  console.log('\n--- ' + sp.toUpperCase() + ' ---');
  try {
    if (!S[sp]) throw new Error('unbekannte Sprache ' + sp);
    const c = S[sp];
    const quelle = join(HB, 'handbuch-admin.' + sp + '.html');
    const pdf = process.env['HANDBUCH_ADMIN_PDF_' + sp.toUpperCase()] || join(HB, 'ausgabe', 'handbuch-admin-' + sp + '.pdf');
    pruefe('Quelle vorhanden: ' + quelle, existsSync(quelle));
    pruefe('PDF vorhanden: ' + pdf, existsSync(pdf));
    if (!existsSync(quelle) || !existsSync(pdf)) throw new Error('Quelle oder PDF fehlt (zuerst node tools/handbuch-admin-bauen.mjs --sprache=' + sp + ')');
    const html = readFileSync(quelle, 'utf8');
    pruefe('lang-Attribut "' + sp + '"', new RegExp('<html lang="' + sp + '">').test(html));
    pruefe('PDF groesser als 100 KB', statSync(pdf).size > 100 * 1024, String(statSync(pdf).size));
    pruefe('PDF-Kopf %PDF', readFileSync(pdf).subarray(0, 4).toString('latin1') === '%PDF');
    const seiten = await seitenText(readFileSync(pdf));
    const text = seiten.join('\n');
    const kompakt = text.replace(/\s+/g, '');
    pruefe('Seitenzahl 20-45', seiten.length >= 20 && seiten.length <= 45, String(seiten.length));
    pruefe('Titel "' + c.titel + '"', text.includes(c.titel));
    pruefe('Inhaltsverzeichnis "' + c.inhalt + '"', text.includes(c.inhalt));
    const inhalt = seiten.find((s) => s.includes(c.inhalt)) || '';
    pruefe('Inhaltsverzeichnis mit Seitenzahlen', c.inhaltLetzte.test(inhalt), inhalt.slice(-80));
    pruefe('Schnellstart-Kapitel im Text', kompakt.includes(c.schnell));
    const kap = kapitelAus(html);
    pruefe('gleiche Kapitelzahl wie DE (' + deKapitel.length + ')', kap.length === deKapitel.length && kap.every((k, i) => k.nr === deKapitel[i].nr), String(kap.length));
    for (const k of kap.filter((x) => x.nr !== '0')) pruefe('Kapitel ' + k.nr + ' im Text: ' + k.text, kompakt.includes(k.nr + k.text.replace(/\s+/g, '')));
    pruefe('Versionszeile gefuellt', c.version.test(text));
    pruefe('Fusszeile mit Seitenangabe', c.fuss.test(text));
    for (const re of c.recht) pruefe('Rechtlicher Hinweis ' + re.source.slice(0, 40), re.test(text));
    const aDe = anteil(text, DE_WOERTER), aZiel = anteil(text, new Set(c.marker));
    pruefe('deutscher Funktionswortanteil < ' + DE_MAX * 100 + ' % (' + (aDe * 100).toFixed(2) + ' %)', aDe < DE_MAX);
    pruefe('Funktionswortanteil ' + sp.toUpperCase() + ' > ' + c.markerMin * 100 + ' % (' + (aZiel * 100).toFixed(1) + ' %)', aZiel > c.markerMin);
    if (sp === 'hu') pruefe('Begriff "előadás" (wie Plattform hu.json) mindestens 30-mal', (text.match(/előadás/gi) || []).length >= 30, String((text.match(/előadás/gi) || []).length));
    for (const re of c.alt) pruefe('veraltet nicht mehr im PDF: ' + re.source.slice(0, 40), !re.test(text));
    for (const re of c.neu) pruefe('neu im PDF: ' + re.source.slice(0, 40), re.test(text));
    pruefe('Gegenprobe: veraltete Aussage wird erkannt', c.alt.some((re) => re.test(sp === 'en' ? 'origin Invitation' : 'Meghívás eredet')));
    const f = funde(text, sp);
    pruefe('keine verbotenen Begriffe im PDF', f.length === 0, f.join(', '));
    const mails = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) || []).filter((m) => !m.endsWith('@example.com'));
    pruefe('im PDF nur E-Mail-Adressen @example.com', mails.length === 0, mails.join(', '));
    const bilder = [...html.matchAll(new RegExp('src="(bilder-admin-' + sp + '/[^"]+)"', 'g'))].map((m) => m[1]);
    pruefe('Quelle verweist auf ' + bilder.length + ' Bilder in bilder-admin-' + sp + '/ (DE: ' + deBilder.length + ')', bilder.length === deBilder.length && !/src="bilder-admin\//.test(html));
    const fehlend = bilder.filter((b) => !existsSync(join(HB, b)));
    pruefe('alle Bilder der Quelle vorhanden', fehlend.length === 0, fehlend.join(', '));
    const fq = funde(htmlText(html), sp);
    pruefe('keine verbotenen Begriffe in der HTML-Quelle (ohne Kommentare)', fq.length === 0, fq.join(', '));
    // Gegenprobe: der Pruefer muss rot werden
    for (const [name, beispiel] of [...c.gegen, ['4242', '4242 4242 4242 4242'], ['Demo', 'Demo course'], ['/api/', 'GET /api/admin/kurse'], ['sk_-Schluessel', 'sk_test_abc'],
      ['whsec_', 'whsec_abc'], ['localhost', 'http://localhost:4400'], ['Einrichtungsvariable', 'ADMIN_ERLAUBT=a@b.c'], ['Agent/Anbindung', 'Agent'], ['null/undefined', 'Price: null'], ['Pfadangabe', 'https://x/admin/']])
      pruefe('Gegenprobe: Pruefer erkennt ' + name, funde(text + ' ' + beispiel, sp).includes(name));
    pruefe('Gegenprobe: deutscher Text wird als falsche Sprache erkannt', !spracheOk(deText, sp));
    pruefe('Gegenprobe: Text der anderen Sprache wird erkannt', !spracheOk(sp === 'en' ? 'Az előadás a vásárlók számára nem látható, és a hozzáférés megszűnik, ha nem fizetnek.' : 'The course is not visible to customers, and the access ends if they do not pay for it.', sp));
    pruefe('Gegenprobe: eigener Text gilt als richtige Sprache', spracheOk(text, sp));
    pruefe('Gegenprobe: halb deutscher Text wird rot', !spracheOk(text + ' ' + deText, sp));
  } catch (e) { fehler++; console.log('FEHLER ' + (e?.message || e)); }
}
console.log(`\nAdmin-Handbuch-Sprachen-Selbsttest (${SPRACHEN.join(', ')}): ${ok} OK, ${fehler} FEHLER`);
process.exit(fehler ? 1 : 0);
