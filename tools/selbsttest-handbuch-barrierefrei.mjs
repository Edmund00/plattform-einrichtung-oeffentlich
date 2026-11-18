// Selbsttest Barrierefreiheit der sechs Handbuch-PDFs (Kaeufer und Admin, je DE/EN/HU), ohne Browser und ohne Server (12.11.2026).
// Aufruf (im Ordner plattform): node tools/selbsttest-handbuch-barrierefrei.mjs
// Prueft je PDF mit tools/pdf-barrierefrei-pruefen.mjs (pdf.js, keine neue Abhaengigkeit): Tagged-Flag, Struktur-Baum, /Lang = Sprache der Quelle,
// Titel = <title> der Quelle, DisplayDocTitle, Gliederung mit allen Kapiteln, H1/H2/H3, Listen, Tabellen mit TH, jedes Figure mit Alt-Text,
// alle Alt-Texte der Quelle im PDF, Seitenzahl unveraendert (Kaeufer 28, Admin 32).
// Prueft je HTML-Quelle: lang, <title>, jedes Bild mit beschreibendem Alt-Text (kein Dateiname, keine verbotenen Woerter), th mit scope,
// figure als Gruppe (sonst ein zweites Figure-Tag ohne Alt im PDF), Kontrast der Textfarben nach WCAG AA (statisch aus den CSS-Farben).
// Gegenproben: das alte, ungetaggte PDF aus Git (Commit 359fa6d) muss rot sein; falsche Sprache/Titel/Bilderzahl/Seitenzahl/Alt-Text/Kapitel muessen rot sein;
// verbotenes Wort im Alt-Text und die alte Goldfarbe #a87c2a als Textfarbe werden erkannt.
// Erweitert 12.11.2026: Lesezeichen = Ueberschriften der Quelle (keine zusammengeklebten Woerter, kein doppeltes Zierzeichen, Heuristik
// lesezeichenFehler), Fusszeile auf jeder Seite und nicht im Strukturbaum (Artefakt-Markierung nur als HINWEIS, Chromium kann sie nicht),
// Alt-Text wiederholt die Bildunterschrift nicht 1:1, Alt-Text-Korrekturen der Pruefrunde 12.11.2026 stehen in der Quelle (alte Fassungen fehlen).
// Gegenproben: PDFs vor der Lesezeichen-Korrektur (Commit 58780bb) rot bei Lesezeichen; zusammengeklebte/doppelte/randige Lesezeichen rot;
// getaggte oder fehlende Fusszeile rot; alte, falsche Alt-Texte (z. B. "Status aktiv", "Vorherige Lektion") in einer Quellkopie rot.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATTFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HB = join(PLATTFORM, 'handbuch');
const { pruefePdf, lesePdf, lesezeichenFehler, fussBefund } = await import('./pdf-barrierefrei-pruefen.mjs');
let ok = 0, fehler = 0;
const pruefe = (name, wert, info = '') => { wert ? ok++ : fehler++; console.log((wert ? 'OK     ' : 'FEHLER ') + name + (wert || !info ? '' : ' | ' + info)); };

const SEITEN = { kaeufer: 28, admin: 32 };
// Seitenzahl in der Fusszeile je Sprache (Kaeufer-HU "Oldal: 3 / 28", Admin-HU "3. oldal / 32")
const FUSS = { de: /Seite \d+ von \d+/, en: /Page \d+ of \d+/, hu: /Oldal: \d+ \/ \d+|\d+\. oldal \/ \d+/ };
// Alt-Texte, die in der Pruefrunde 12.11.2026 als falsch erkannt wurden (Bildinhalt oder Knopfname stimmte nicht): duerfen nicht zurueckkommen.
const ALT_FALSCH = [/Vorherige Lektion|buttons for the previous lesson|Előző lecke/, /Status aktiv|status active|állapota aktív/, /Erstattung nachträglich verbuchen|Book refund retroactively|Visszatérítés utólagos rögzítése/,
  /Admin-Anmeldungen und Datensicherung|Admin sign-ins and Backup|Admin-bejelentkezések és Biztonsági mentés/, /open reviews/, /megszakító gomb/, /elszámolási időszak/];
const VERBOTEN_ALT = {
  de: /demo|muster|\btest|test(karte|modus|zahlung)|4242|\bnull\b|undefined|localhost/i,
  en: /demo|sample|\btest|4242|\bnull\b|undefined|localhost/i,
  hu: /demó|demo|teszt|minta|kurzus|4242|\bnull\b|undefined|localhost|(?<!\p{L})Ön(?:nek|t|ök|nél|re|é|)(?!\p{L})/iu,
};
// Bildunterschrift ohne "Abb. 5 –" / "Fig. 5 –" / "5. ábra –", nur Buchstaben und Ziffern: gleich wie der Alt-Text = 1:1-Wiederholung
const kern = (s) => s.replace(/^(?:(?:Abb\.|Fig\.)\s*\S+|\d+[a-z]?\. ábra)\s*[–-]\s*/, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const entit = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const ohneTags = (s) => entit(s.replace(/<[^>]+>/g, '')).trim();

function quelle(datei) {
  const html = readFileSync(datei, 'utf8');
  const lang = (html.match(/<html[^>]*\blang="([^"]*)"/) || [])[1] || '';
  const titel = ohneTags((html.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1]);
  const kapitel = [...html.matchAll(/<h2 class="kapitel"[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => ohneTags(m[1].replace(/<span class="nr">[\s\S]*?<\/span>/, '')));
  const bilder = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => ({ src: (m[0].match(/src="([^"]*)"/) || [])[1] || '', alt: m[0].match(/\balt="([^"]*)"/) ? entit(m[0].match(/\balt="([^"]*)"/)[1]) : null }));
  const th = [...html.matchAll(/<th\b[^>]*>/g)].map((m) => m[0]);
  const figuren = [...html.matchAll(/<figure\b[^>]*>/g)].map((m) => m[0]);
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  const ueberschriften = [...html.matchAll(/<(h[123])\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => ohneTags(m[2]).replace(/\s+/g, ' '));
  const figs = [...html.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/g)].map((m) => ({ alt: entit((m[1].match(/\balt="([^"]*)"/) || [, ''])[1]), cap: ohneTags((m[1].match(/<figcaption>([\s\S]*?)<\/figcaption>/) || [, ''])[1]) }));
  return { lang, titel, kapitel, bilder, th, figuren, css, ueberschriften, figs };
}

// Kontrast (WCAG 2.1): Textfarben aus dem CSS gegen Weiss und Elfenbein (Seiten- und Hinweis-Hintergrund).
const lum = (hex) => { const v = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const kontrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function textfarben(css) {
  const vars = Object.fromEntries([...css.matchAll(/--([\w-]+):(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  const farbe = (sel) => { const r = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*?(?<![-\\w])color:([^;}]+)')); if (!r) return null; const v = r[1].trim(); return v.startsWith('var(') ? vars[v.slice(6, -1)] : v; };
  // [Farbe, Hintergruende, auf denen sie vorkommt]: .ui steht auch in Hinweiskaesten (Elfenbein), Bildunterschrift und Nummern nur auf Weiss
  return { '.ui (10,5 pt)': [farbe('.ui'), ['#ffffff', vars.ivory]], 'figcaption (8,5 pt)': [farbe('figcaption'), ['#ffffff']], 'Inhaltsverzeichnis-Nummer (12 pt)': [farbe('.inhalt a .nr'), ['#ffffff']], 'body': [farbe('body'), ['#ffffff', vars.ivory]] };
}

try {
  for (const art of ['kaeufer', 'admin']) for (const sp of ['de', 'en', 'hu']) {
    const name = art + '-' + sp;
    const q = quelle(join(HB, 'handbuch-' + art + '.' + sp + '.html'));
    console.log('--- ' + name);
    // HTML-Quelle
    pruefe(name + ': html lang = ' + sp, q.lang === sp, q.lang);
    pruefe(name + ': <title> gesetzt', q.titel.length > 5, q.titel);
    pruefe(name + ': Kapitel gefunden', q.kapitel.length >= 10, String(q.kapitel.length));
    const ohneAlt = q.bilder.filter((b) => !b.alt || b.alt.trim().length < 15);
    pruefe(name + ': jedes Bild mit Alt-Text (>= 15 Zeichen)', ohneAlt.length === 0, ohneAlt.slice(0, 3).map((b) => b.src).join(', '));
    const dateiAlt = q.bilder.filter((b) => b.alt && (b.alt.includes(b.src.split('/').pop()) || /\.(png|svg|jpe?g)\b/i.test(b.alt)));
    pruefe(name + ': kein Alt-Text ist ein Dateiname', dateiAlt.length === 0, dateiAlt.map((b) => b.src).join(', '));
    const altSet = [...new Set(q.bilder.map((b) => b.alt))];
    pruefe(name + ': Alt-Texte eindeutig je Bild', altSet.length === q.bilder.length, altSet.length + '/' + q.bilder.length);
    const verbotenAlt = q.bilder.filter((b) => b.alt && VERBOTEN_ALT[sp].test(b.alt));
    pruefe(name + ': keine verbotenen Woerter in Alt-Texten', verbotenAlt.length === 0, verbotenAlt.map((b) => b.alt).join(' | ').slice(0, 160));
    const wiederholt = q.figs.filter((x) => x.cap && kern(x.alt) === kern(x.cap));
    pruefe(name + ': kein Alt-Text wiederholt die Bildunterschrift 1:1', wiederholt.length === 0, wiederholt.map((x) => x.alt).join(' | ').slice(0, 160));
    const falsch = q.bilder.filter((b) => b.alt && ALT_FALSCH.some((r) => r.test(b.alt)));
    pruefe(name + ': keine als falsch bekannten Alt-Texte (Pruefrunde 12.11.2026)', falsch.length === 0, falsch.map((b) => b.src).join(', '));
    pruefe(name + ': jede Tabellen-Kopfzelle mit scope', q.th.length > 0 && q.th.every((t) => /scope="(col|row)"/.test(t)), q.th.filter((t) => !/scope=/.test(t)).length + ' ohne scope');
    pruefe(name + ': jede figure als Gruppe (role="group")', q.figuren.length > 0 && q.figuren.every((f) => /role="group"/.test(f)), String(q.figuren.length));
    for (const [teil, [f, hg]] of Object.entries(textfarben(q.css))) {
      const k = f && hg.every(Boolean) ? Math.min(...hg.map((h) => kontrast(f, h))) : 0;
      pruefe(name + ': Kontrast ' + teil + ' >= 4,5:1', k >= 4.5, f + ' ' + k.toFixed(2));
    }
    // PDF
    const pdf = join(HB, 'ausgabe', 'handbuch-' + art + '-' + sp + '.pdf');
    pruefe(name + ': PDF vorhanden', existsSync(pdf));
    if (!existsSync(pdf)) continue;
    const r = await pruefePdf(readFileSync(pdf), { sprache: sp, titel: q.titel, kapitel: q.kapitel, bilder: q.bilder.length, altTexte: altSet, seiten: SEITEN[art], ueberschriften: q.ueberschriften, fuss: FUSS[sp] });
    for (const x of r.pruefungen) pruefe(name + ' PDF: ' + x.name, x.ok, x.info);
    for (const x of r.hinweise) console.log('HINWEIS ' + name + ' PDF: ' + x.name + ' | ' + x.info);
  }

  console.log('--- Gegenproben');
  const qDe = quelle(join(HB, 'handbuch-kaeufer.de.html'));
  const neu = readFileSync(join(HB, 'ausgabe', 'handbuch-kaeufer-de.pdf'));
  // 1) altes PDF ohne Tags (Stand vor der Barrierefreiheit). F-271 (18.11.2026): der Commit 359fa6d gehoert zum
  // Vorgaengerprojekt stripe-muster, nie zu diesem Repo (plattform-einrichtung startete als Einzelschnappschuss ohne
  // dessen Historie) -- darum war "git show 359fa6d:..." hier IMMER leer, nie ein Klon- oder Umgebungsproblem.
  // Fixtur-Datei einmalig aus stripe-muster extrahiert (git show 359fa6d:plattform/handbuch/ausgabe/handbuch-kaeufer-de.pdf), jetzt lokal.
  let altPdf = null;
  try { altPdf = readFileSync(join(PLATTFORM, 'tools', 'testdaten', 'gegenproben-pdf', '359fa6d-handbuch-kaeufer-de.pdf')); } catch { /* Fixtur fehlt */ }
  pruefe('Gegenprobe: altes PDF aus Fixtur lesbar', altPdf && altPdf.length > 100000);
  if (altPdf) {
    const r = await pruefePdf(altPdf, { sprache: 'de', titel: qDe.titel, kapitel: qDe.kapitel, bilder: qDe.bilder.length, seiten: 28 });
    const rot = (teil) => r.pruefungen.some((x) => x.name.startsWith(teil) && !x.ok);
    pruefe('Gegenprobe: altes PDF ohne Tags wird rot', !r.ok);
    for (const teil of ['Tagged-Flag', 'Struktur-Baum', '/Lang', 'Gliederung', 'Figure-Tags']) pruefe('Gegenprobe: altes PDF rot bei ' + teil, rot(teil));
  }
  // 2) falsche Sprache, falscher Titel, falsche Bilderzahl, falsche Seitenzahl, fehlender Alt-Text
  const g = await pruefePdf(neu, { sprache: 'en', titel: 'Guide for Buyers', bilder: qDe.bilder.length + 1, seiten: 27, altTexte: ['Ein Alt-Text, der im PDF nicht vorkommt'], kapitel: ['Ein Kapitel, das es nicht gibt'] });
  for (const teil of ['/Lang', 'Titel', 'verschiedene Alt-Texte', 'Seitenzahl', 'alle Alt-Texte', 'jedes Kapitel']) pruefe('Gegenprobe: neues PDF rot bei falscher Erwartung ' + teil, g.pruefungen.some((x) => x.name.startsWith(teil) && !x.ok));
  // 3) verbotenes Wort im Alt-Text, alte Goldfarbe als Textfarbe, Kontrastrechner
  pruefe('Gegenprobe: verbotenes Wort im Alt-Text erkannt (de/en/hu)', VERBOTEN_ALT.de.test('Demo-Kurs') && VERBOTEN_ALT.en.test('Sample course') && VERBOTEN_ALT.hu.test('Új kurzus'));
  pruefe('Gegenprobe: alte Goldfarbe #a87c2a als Text < 4,5:1', kontrast('#a87c2a', '#ffffff') < 4.5);
  pruefe('Gegenprobe: Kontrastrechner Schwarz/Weiss = 21:1', Math.abs(kontrast('#000000', '#ffffff') - 21) < 0.01);
  pruefe('Gegenprobe: verbotenes Wort "test" im EN-Alt-Text erkannt', VERBOTEN_ALT.en.test('Pay with the test card') && !VERBOTEN_ALT.en.test('the latest orders'));

  // 4) Lesezeichen (12.11.2026): PDFs vor der Korrektur (Commit 58780bb) muessen rot sein, Heuristik mit kuenstlichen Fehlern.
  // F-271 (18.11.2026): 58780bb gehoert ebenfalls nur zu stripe-muster; Fixturen lokal, wie oben bei 359fa6d.
  const fixturDatei = (art, sp) => { try { return readFileSync(join(PLATTFORM, 'tools', 'testdaten', 'gegenproben-pdf', '58780bb-handbuch-' + art + '-' + sp + '.pdf')); } catch { return null; } };
  for (const [art, sp, teile] of [['kaeufer', 'de', ['Lesezeichen ohne doppelte', 'Lesezeichen = Ueberschriften']], ['admin', 'hu', ['Lesezeichen ohne doppelte', 'Lesezeichen = Ueberschriften']], ['kaeufer', 'en', ['Lesezeichen ohne doppelte']]]) {
    const alt = fixturDatei(art, sp);
    pruefe('Gegenprobe: PDF ' + art + '-' + sp + ' vor der Lesezeichen-Korrektur aus Fixtur lesbar', alt && alt.length > 100000);
    if (!alt) continue;
    const q = quelle(join(HB, 'handbuch-' + art + '.' + sp + '.html'));
    const r = await pruefePdf(alt, { ueberschriften: q.ueberschriften });
    for (const teil of teile) pruefe('Gegenprobe: altes PDF ' + art + '-' + sp + ' rot bei ' + teil, r.pruefungen.some((x) => x.name.startsWith(teil) && !x.ok));
  }
  const hs = ['Handbuch für Käuferinnen und Käufer', 'Inhaltsverzeichnis', '★ Schnellstart in fünf Schritten', '1 Überblick'];
  pruefe('Gegenprobe: saubere Lesezeichen ergeben keinen Fehler', lesezeichenFehler(['Handbuch für Käuferinnen und Käufer', 'Inhaltsverzeichnis', 'Schnellstart in fünf Schritten', '★ Schnellstart in fünf Schritten', '1 Überblick'], hs).length === 0);
  pruefe('Gegenprobe: zusammengeklebte Woerter erkannt', /zusammengeklebt/.test(lesezeichenFehler(['Handbuch fürKäuferinnen undKäufer'], hs).join()));
  pruefe('Gegenprobe: doppeltes Zierzeichen erkannt', /doppeltes Zierzeichen/.test(lesezeichenFehler(['★★ Schnellstart in fünf Schritten'], hs).join()));
  pruefe('Gegenprobe: Leerraum am Rand erkannt', /Leerraum/.test(lesezeichenFehler([' Schnellstart in fünf Schritten'], hs).join()));
  pruefe('Gegenprobe: Lesezeichen ohne Ueberschrift erkannt', /keine passende/.test(lesezeichenFehler(['Ein Kapitel, das es nicht gibt'], hs).join()));

  // 5) Fusszeile: im neuen PDF auf jeder Seite, nicht im Strukturbaum; kuenstlich getaggte oder fehlende Fusszeile wird rot
  const dNeu = await lesePdf(neu);
  const fb = fussBefund(dNeu.inhalt, FUSS.de);
  pruefe('Gegenprobe: Fusszeile im neuen PDF gefunden (' + fb.gefunden + '/' + dNeu.seiten + '), nicht getaggt', fb.gefunden === dNeu.seiten && fb.imBaum === 0);
  const getaggt = fussBefund([{ getaggt: 'Text Seite 2 von 28', artefakt: '', unmarkiert: '' }], FUSS.de);
  pruefe('Gegenprobe: als Struktur getaggte Fusszeile erkannt', getaggt.imBaum === 1);
  pruefe('Gegenprobe: fehlende Fusszeile erkannt', fussBefund([{ getaggt: 'Text', artefakt: '', unmarkiert: 'Handbuch' }], FUSS.de).gefunden === 0);
  pruefe('Gegenprobe: Fusszeile als /Artifact erkannt', fussBefund([{ getaggt: '', artefakt: 'Seite 1 von 28', unmarkiert: '' }], FUSS.de).artefakt === 1);

  // 6) Alt-Texte: alte Quellen (Commit 58780bb) enthalten die als falsch erkannten Alt-Texte und werden rot; 1:1-Wiederholung wird erkannt.
  // F-271 (18.11.2026): auch diese HTML-Quellen aus Commit 58780bb gehoeren nur zu stripe-muster, jetzt als lokale Fixtur.
  for (const [art, sp] of [['kaeufer', 'de'], ['kaeufer', 'en'], ['kaeufer', 'hu'], ['admin', 'de'], ['admin', 'en'], ['admin', 'hu']]) {
    let alt = null;
    try { alt = readFileSync(join(PLATTFORM, 'tools', 'testdaten', 'gegenproben-html', '58780bb-handbuch-' + art + '.' + sp + '.html')); } catch { /* Fixtur fehlt */ }
    const altAlts = alt ? [...alt.toString('utf8').matchAll(/<img\b[^>]*\balt="([^"]*)"/g)].map((m) => entit(m[1])) : [];
    pruefe('Gegenprobe: alte Quelle ' + art + '.' + sp + ' hat falsche Alt-Texte (rot)', altAlts.some((a) => ALT_FALSCH.some((r) => r.test(a))));
  }
  pruefe('Gegenprobe: Alt-Text = Bildunterschrift wird erkannt', kern('Bestätigung erfolgreich.') === kern('Abb. 5 – Bestätigung erfolgreich') && kern('Sikeres megerősítés') === kern('5. ábra – Sikeres megerősítés') && kern('A') !== kern('Fig. 3a – B'));
} catch (e) { pruefe('Ausnahme: ' + (e?.message || e), false); }

console.log(`\nErgebnis: ${ok} OK, ${fehler} FEHLER`);
process.exit(fehler ? 1 : 0);
