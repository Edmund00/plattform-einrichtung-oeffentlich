// Selbsttest Kaeufer-Handbuch (Deutsch): prueft das fertige PDF, ohne Browser und ohne Server.
// Aufruf (im Ordner plattform): node tools/selbsttest-handbuch.mjs      (anderes PDF: HANDBUCH_PDF=<Pfad>)
// Prueft: Datei vorhanden, mehr als 5 Seiten, Inhaltsverzeichnis und alle Kapitel im Text, KEINE verbotenen Begriffe
// (Testkarte, 4242, Demo, Muster, null/undefined, Testmodus, /api/, sk_/pk_/whsec_-Schluessel, localhost, Stripe-Schluessel), Bilder der Quelle vorhanden, Marke "Beispiel-Akademie" vorhanden (keine EN/HU-Marke).
// Eingebaute Gegenprobe: derselbe Pruefer muss einen eingeschleusten verbotenen Begriff finden (sonst ist der Pruefer selbst kaputt).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLATTFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PDF = process.env.HANDBUCH_PDF || join(PLATTFORM, 'handbuch', 'ausgabe', 'handbuch-kaeufer-de.pdf');
const QUELLE = join(PLATTFORM, 'handbuch', 'handbuch-kaeufer.de.html');
let ok = 0, fehler = 0;
const pruefe = (name, wert, info = '') => { wert ? ok++ : fehler++; console.log((wert ? 'OK     ' : 'FEHLER ') + name + (wert || !info ? '' : ' | ' + info)); };

const VERBOTEN = [
  ['Testkarte', /testkarte/i], ['4242', /4242/], ['Demo', /demo/i], ['Muster', /muster/i], ['Testmodus', /testmodus/i], ['Testzahlung', /testzahlung/i],
  ['/api/', /\/api\//i], ['sk_-Schluessel', /\bsk_(test|live)_/i], ['pk_-Schluessel', /\bpk_(test|live)_/i], ['whsec_', /whsec_/i], ['rk_-Schluessel', /\brk_(test|live)_/i],
  ['null/undefined', /\b(null|undefined)\b/i], ['localhost', /localhost|127\.0\.0\.1/i], ['Stripe-Schluessel', /stripe[-_ ]?(secret|schl(ü|ue)ssel|key)|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET/i],
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
  if (!existsSync(PDF)) throw new Error('PDF fehlt (zuerst node tools/handbuch-bauen.mjs)');
  pruefe('PDF groesser als 100 KB', statSync(PDF).size > 100 * 1024, String(statSync(PDF).size));
  pruefe('PDF-Kopf %PDF', readFileSync(PDF).subarray(0, 4).toString('latin1') === '%PDF');
  const seiten = await seitenText(readFileSync(PDF));
  const html = readFileSync(QUELLE, 'utf8');
  const text = seiten.join('\n');
  pruefe('Seitenzahl > 5', seiten.length > 5, String(seiten.length));
  pruefe('Text enthaelt "Inhaltsverzeichnis"', text.includes('Inhaltsverzeichnis'));
  const kompakt = text.replace(/\s+/g, '');
  const kapitel = ['Überblick', 'Registrierung und E-Mail-Bestätigung', 'Anmelden und Passwort', 'Kurse finden und auswählen', 'Einen Kurs kaufen',
    'Kurse und Lektionen nutzen', 'Mein Konto, Bestellungen und Belege', 'Abo verwalten und kündigen', 'Widerruf und Erstattung', 'Datenschutz und Konto löschen', 'Hilfe und Kontakt'];
  for (const [i, k] of kapitel.entries()) pruefe('Kapitel ' + (i + 1) + ' im Text: ' + k, kompakt.includes((i + 1) + k.replace(/\s+/g, '')));
  const inhalt = seiten.find((s) => s.includes('Inhaltsverzeichnis')) || '';
  pruefe('Inhaltsverzeichnis mit Seitenzahlen', /Hilfe und Kontakt\s*\.*\s*\d+/.test(inhalt) || /Kontakt \d+/.test(inhalt), inhalt.slice(-80));
  pruefe('Versionszeile (Version, Stand, Software-Commit) gefuellt', /Version \d+\.\d+ · Stand \d{2}\.\d{2}\.\d{4} · Software-Commit [0-9a-f]{7,}/.test(text));
  pruefe('Fusszeile mit "Seite x von y"', /Seite 3 von \d+/.test(text));
  pruefe('Marke "Beispiel-Akademie" im PDF (Deckblatt)', text.includes('Beispiel-Akademie'));
  pruefe('keine fremde Sprachmarke (Example Academy / Példa Akadémia)', !/Example Academy|Példa Akadémia/i.test(text));
  pruefe('Bild der Download-Lektion eingebunden', html.includes('bilder/42-lektion-download.png'));
  const f = funde(text);
  pruefe('keine verbotenen Begriffe im PDF', f.length === 0, f.join(', '));
  // Quelle: alle Bilder vorhanden, keine echten E-Mail-Adressen
  const bilder = [...html.matchAll(/src="(bilder\/[^"]+)"/g)].map((m) => m[1]);
  pruefe('Quelle verweist auf Bilder (' + bilder.length + ')', bilder.length >= 20);
  const fehlend = bilder.filter((b) => !existsSync(join(PLATTFORM, 'handbuch', b)));
  pruefe('alle Bilder der Quelle vorhanden', fehlend.length === 0, fehlend.join(', '));
  const mails = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) || []).filter((m) => !m.endsWith('@example.com'));
  pruefe('im PDF nur E-Mail-Adressen @example.com', mails.length === 0, mails.join(', '));
  // Gegenprobe des Pruefers: jeder verbotene Begriff muss gefunden werden
  for (const [name, beispiel] of [['Testkarte', 'Bezahle mit der Testkarte'], ['4242', '4242 4242 4242 4242'], ['Demo', 'Demo-Kurs'], ['/api/', 'GET /api/konto'],
    ['sk_-Schluessel', 'sk_test_abc'], ['null/undefined', 'Anbieter: null'], ['localhost', 'http://localhost:4400'], ['Stripe-Schluessel', 'STRIPE_SECRET_KEY']])
    pruefe('Gegenprobe: Pruefer erkennt ' + name, funde(text + ' ' + beispiel).includes(name));
} catch (e) { fehler++; console.log('FEHLER ' + (e?.message || e)); }
console.log(`\nHandbuch-Selbsttest: ${ok} OK, ${fehler} FEHLER`);
process.exit(fehler ? 1 : 0);
