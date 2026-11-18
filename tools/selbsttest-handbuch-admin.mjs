// Selbsttest Admin-Handbuch (Deutsch): prueft das fertige PDF, ohne Browser und ohne Server. Vorbild: tools/selbsttest-handbuch.mjs.
// Aufruf (im Ordner plattform): node tools/selbsttest-handbuch-admin.mjs      (anderes PDF: HANDBUCH_ADMIN_PDF=<Pfad>)
// Prueft: Datei vorhanden, mindestens 10 Seiten, Inhaltsverzeichnis mit Seitenzahlen, alle Kapitel im Text, Versions- und Fusszeile, KEINE verbotenen Begriffe
// (Demo, Muster, Testkarte, Testmodus, Testzahlung, 4242, /api/, sk_/pk_/rk_/whsec_, localhost, Stripe-Schluessel, Umgebungsvariablen-Namen der Einrichtung),
// nur E-Mail-Adressen @example.com, Hinweis "rechtlich pruefen" im Widerrufskapitel, alle Bilder der Quelle vorhanden.
// Eingebaute Gegenprobe: derselbe Pruefer muss eingeschleuste verbotene Begriffe finden (sonst ist der Pruefer selbst kaputt).
// Gegenprobe am echten PDF (von Hand): node tools/handbuch-admin-bauen.mjs --nur-pdf --einschleusen="Testkarte 4242" --ausgabe=<tmp.pdf>
//   und dann HANDBUCH_ADMIN_PDF=<tmp.pdf> node tools/selbsttest-handbuch-admin.mjs  -> muss mit FEHLER enden.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLATTFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PDF = process.env.HANDBUCH_ADMIN_PDF || join(PLATTFORM, 'handbuch', 'ausgabe', 'handbuch-admin-de.pdf');
const QUELLE = join(PLATTFORM, 'handbuch', 'handbuch-admin.de.html');
let ok = 0, fehler = 0;
const pruefe = (name, wert, info = '') => { wert ? ok++ : fehler++; console.log((wert ? 'OK     ' : 'FEHLER ') + name + (wert || !info ? '' : ' | ' + info)); };

const VERBOTEN = [
  ['Testkarte', /testkarte/i], ['4242', /4242/], ['Demo', /demo/i], ['Muster', /muster/i], ['Testmodus', /testmodus/i], ['Testzahlung', /testzahlung/i],
  ['/api/', /\/api\//i], ['sk_-Schluessel', /\bsk_(test|live)_/i], ['pk_-Schluessel', /\bpk_(test|live)_/i], ['whsec_', /whsec_/i], ['rk_-Schluessel', /\brk_(test|live)_/i],
  ['localhost', /localhost|127\.0\.0\.1/i], ['Stripe-Schluessel', /stripe[-_ ]?(secret|schl(ü|ue)ssel|key)|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET/i],
  ['Einrichtungsvariable', /ADMIN_ERLAUBT|NOTFALL_ENTSPERREN|SICHERUNG_SCHLUESSEL|RESEND_API_KEY|BUNNY_[A-Z_]+|PLATTFORM_NAME|DB_DATEI/],
  ['Agent-Schluessel', /\bvat_[A-Za-z0-9]/], ['null/undefined', /\bnull\b|\bundefined\b|\bNaN\b/],
  ['Agent/Anbindung', /\bAgent\b/], ['Umgebungsvariable', /umgebungsvariable/i], ['Pfadangabe', /\/admin\b/i],
];
const funde = (text) => VERBOTEN.filter(([, re]) => re.test(text)).map(([n]) => n);

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

try {
  pruefe('PDF vorhanden: ' + PDF, existsSync(PDF));
  if (!existsSync(PDF)) throw new Error('PDF fehlt (zuerst node tools/handbuch-admin-bauen.mjs)');
  pruefe('PDF groesser als 100 KB', statSync(PDF).size > 100 * 1024, String(statSync(PDF).size));
  pruefe('PDF-Kopf %PDF', readFileSync(PDF).subarray(0, 4).toString('latin1') === '%PDF');
  const seiten = await seitenText(readFileSync(PDF));
  const text = seiten.join('\n');
  pruefe('Seitenzahl >= 10', seiten.length >= 10, String(seiten.length));
  pruefe('Text enthaelt "Inhaltsverzeichnis"', text.includes('Inhaltsverzeichnis'));
  pruefe('Titel "Handbuch für den Admin-Bereich"', text.includes('Handbuch für den Admin-Bereich'));
  const kompakt = text.replace(/\s+/g, '');
  pruefe('Schnellstart-Kapitel im Text', kompakt.includes('★Schnellstart'));
  const kapitel = ['Anmeldung im Admin-Bereich', 'Die Übersicht', 'Kurse anlegen und bearbeiten', 'Lektionen und Medien', 'Veröffentlichen, Archivieren, Löschen',
    'Bestellungen und Zugänge', 'Erstattungen und Widerruf', 'Kunden und Konten', 'Ereignisse und Protokolle', 'Verkauf pausieren', 'Datensicherung',
    'Ein typischer Ablauf', 'Auswirkungen von Änderungen', 'Funktionen im Admin-Bereich', 'Hilfe und häufige Meldungen'];
  for (const [i, k] of kapitel.entries()) pruefe('Kapitel ' + (i + 1) + ' im Text: ' + k, kompakt.includes((i + 1) + k.replace(/\s+/g, '')));
  const inhalt = seiten.find((s) => s.includes('Inhaltsverzeichnis')) || '';
  pruefe('Inhaltsverzeichnis mit Seitenzahlen', /häufige Meldungen\s*\.*\s*\d+/.test(inhalt), inhalt.slice(-80));
  pruefe('Versionszeile (Version, Stand, Software-Commit) gefuellt', /Version \d+\.\d+ · Stand \d{2}\.\d{2}\.\d{4} · Software-Commit [0-9a-f]{7,}/.test(text));
  pruefe('Fusszeile mit "Seite x von y"', /Seite 3 von \d+/.test(text));
  pruefe('Hinweis "rechtlich prüfen lassen" im Widerrufskapitel', /Echtgeldbetrieb rechtlich prüfen zu lassen/.test(text));
  // Produktreife Block 4: veraltete Aussagen duerfen nicht mehr vorkommen, die neuen muessen da sein
  for (const [name, re] of [['Cent-Satz', /Cent-Beträge sind im Formular nicht möglich/], ['keine Zugangs-Mail', /keine E-Mail von der Plattform/], ['keine Widerrufsliste', /keine eigene Widerrufsliste/],
    ['Herkunft Einladung', /Einladung/], ['neue Lektion sofort sichtbar', /neue Lektion ist sofort/]])
    pruefe('veraltet nicht mehr im PDF: ' + name, !re.test(text));
  for (const [name, re] of [['Dezimalpreis EUR', /19,99 oder 19\.99/], ['Platzhalter', /EUR 49,00, HUF 19900/], ['Kostenloser Zugang', /Kostenloser Zugang/], ['Offene Widerrufe', /Offene Widerrufe/],
    ['Zugangs-Mail', /E-Mail an den Kunden/], ['neue Lektion ausgeblendet', /zunächst ausgeblendet/], ['Datumsformat', /12\.11\.2026/]])
    pruefe('neu im PDF: ' + name, re.test(text));
  pruefe('Gegenprobe: veraltete Aussage wird erkannt', /keine eigene Widerrufsliste/.test('Der Admin-Bereich hat keine eigene Widerrufsliste.'));
  const f = funde(text);
  pruefe('keine verbotenen Begriffe im PDF', f.length === 0, f.join(', '));
  const mails = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) || []).filter((m) => !m.endsWith('@example.com'));
  pruefe('im PDF nur E-Mail-Adressen @example.com', mails.length === 0, mails.join(', '));
  // Quelle: alle Bilder vorhanden, keine verbotenen Begriffe im sichtbaren Quelltext
  const html = readFileSync(QUELLE, 'utf8');
  const bilder = [...html.matchAll(/src="(bilder-admin\/[^"]+)"/g)].map((m) => m[1]);
  pruefe('Quelle verweist auf Bilder (' + bilder.length + ')', bilder.length >= 25);
  const fehlend = bilder.filter((b) => !existsSync(join(PLATTFORM, 'handbuch', b)));
  pruefe('alle Bilder der Quelle vorhanden', fehlend.length === 0, fehlend.join(', '));
  const sichtbar = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style>[\s\S]*?<\/style>/, '');
  const fq = funde(sichtbar);
  pruefe('keine verbotenen Begriffe in der HTML-Quelle (ohne Kommentare)', fq.length === 0, fq.join(', '));
  // Gegenprobe des Pruefers: jeder verbotene Begriff muss gefunden werden
  for (const [name, beispiel] of [['Testkarte', 'Bezahle mit der Testkarte'], ['4242', '4242 4242 4242 4242'], ['Demo', 'Demo-Kurs'], ['Muster', 'Musterakademie'],
    ['Testmodus', 'im Testmodus'], ['/api/', 'GET /api/admin/kurse'], ['sk_-Schluessel', 'sk_test_abc'], ['whsec_', 'whsec_abc'], ['localhost', 'http://localhost:4400'],
    ['Stripe-Schluessel', 'STRIPE_SECRET_KEY'], ['Einrichtungsvariable', 'ADMIN_ERLAUBT=a@b.c'], ['Agent/Anbindung', 'Knopf Agent'], ['Umgebungsvariable', 'per Umgebungsvariable'], ['null/undefined', 'Preis: null'], ['Pfadangabe', 'Adresse mit /admin/']])
    pruefe('Gegenprobe: Pruefer erkennt ' + name, funde(text + ' ' + beispiel).includes(name));
  pruefe('Gegenprobe: fremde E-Mail-Adresse wird erkannt', ('x person@firma.de').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g).some((m) => !m.endsWith('@example.com')));
} catch (e) { fehler++; console.log('FEHLER ' + (e?.message || e)); }
console.log(`\nAdmin-Handbuch-Selbsttest: ${ok} OK, ${fehler} FEHLER`);
process.exit(fehler ? 1 : 0);
