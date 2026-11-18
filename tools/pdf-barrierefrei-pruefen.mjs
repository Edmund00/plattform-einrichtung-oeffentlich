// Pruefwerkzeug Barrierefreiheit fuer die Handbuch-PDFs (12.11.2026). Keine neue Abhaengigkeit: liest das PDF mit dem vorhandenen pdf.js
// (public/vendor/pdfjs, 4.10.38), das Struktur-Baum, Markierung, Sprache, Titel, Anzeige-Einstellungen und Gliederung ausliest.
// Aufruf (im Ordner plattform):  node tools/pdf-barrierefrei-pruefen.mjs <pdf> [--sprache=de] [--titel="..."] [--kapitel=12] [--bilder=38] [--seiten=28]
// Als Modul: const { pruefePdf } = await import('./pdf-barrierefrei-pruefen.mjs'); const { pruefungen } = await pruefePdf(buffer, erwartung)
// Geprueft (je Eintrag in pruefungen: { name, ok, info }):
// - Tagged-Flag: Katalog /MarkInfo << /Marked true >>
// - Struktur-Baum (StructTreeRoot) vorhanden: jede Seite hat einen Struktur-Baum mit Inhalt
// - /Lang im Katalog = erwartete Sprache (de, en, hu)
// - Titel (Info /Title) gesetzt und = erwarteter Titel; ViewerPreferences /DisplayDocTitle true (Titel statt Dateiname im Fenster)
// - Gliederung (Outline/Lesezeichen) vorhanden, Anzahl Eintraege >= Kapitelzahl, jedes erwartete Kapitel als Lesezeichen
// - Figure-Tags: jedes Figure hat /Alt (ausser reinen Gruppen-Figures, die nur andere Figures/Caption enthalten), Anzahl verschiedener
//   Alt-Texte = erwartete Bilderzahl, erwartete Alt-Texte (aus der HTML-Quelle) alle im PDF
// - Ueberschriften H1 genau einmal, H2/H3 vorhanden; Tabellen haben TH
// - Seitenzahl = erwartet
// - (12.11.2026) Lesezeichen: keine doppelten Zierzeichen ("★★"), mit erwartung.ueberschriften: jedes Lesezeichen = eine Ueberschrift (keine
//   zusammengeklebten Woerter an Zeilenumbruechen, Heuristik lesezeichenFehler)
// - (12.11.2026) Fusszeile (erwartung.fuss = RegExp der Seitenzahl, CLI --fuss="Seite \d+ von \d+"): auf jeder Seite gefunden und NICHT als
//   getaggter Inhalt im Strukturbaum. Ob sie als /Artifact markiert ist, steht in hinweise (Chromium schreibt kein /Artifact, siehe unten).
// Grenze (gemessen 12.11.2026, Chrome + Playwright 1.64): page.pdf({ tagged: true }) markiert die Fusszeile aus footerTemplate und auch
// @page-Randfelder weder als Struktur noch als /Artifact (kein BDC/BMC um diesen Text). Sie steht nicht im Strukturbaum, Screenreader lesen
// sie nicht als Inhalt; ein PDF/UA-Pruefer (z. B. PAC) meldet sie aber als "weder getaggt noch Artefakt". Keine PDF/UA-Behauptung.
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLATTFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kompakt = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();

async function pdfJs() {
  const basis = join(PLATTFORM, 'public', 'vendor', 'pdfjs');
  const warn = console.warn, log0 = console.log; console.warn = console.log = () => {};
  const pdfjs = await import(pathToFileURL(join(basis, 'pdf.min.mjs')).href).finally(() => { console.warn = warn; console.log = log0; });
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(basis, 'pdf.worker.min.mjs')).href;
  return pdfjs;
}

// Liest die Barrierefreiheits-Merkmale eines PDFs (ohne Bewertung).
export async function lesePdf(buffer) {
  const pdfjs = await pdfJs();
  const warn = console.warn, log0 = console.log; console.warn = console.log = () => {};
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
    const { info } = await doc.getMetadata();
    const markInfo = await doc.getMarkInfo();
    const vp = await doc.getViewerPreferences();
    const outline = (await doc.getOutline()) || [];
    const lesezeichen = []; const geh = (l) => { for (const o of l) { lesezeichen.push(o.title); geh(o.items || []); } }; geh(outline);
    const rollen = {}, alts = new Set(); let seitenMitBaum = 0, figurenOhneAlt = 0;
    // Markierter Inhalt je Seite (12.11.2026): Text in Struktur-Inhalt (MCID, im Strukturbaum), in /Artifact oder ganz ohne Markierung.
    const inhalt = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent({ includeMarkedContent: true });
      const stapel = [], s = { getaggt: '', artefakt: '', unmarkiert: '' };
      for (const it of tc.items) {
        if (it.type === 'beginMarkedContent' || it.type === 'beginMarkedContentProps') stapel.push({ tag: it.tag || '', mcid: !!it.id });
        else if (it.type === 'endMarkedContent') stapel.pop();
        else if (typeof it.str === 'string') {
          const art = stapel.some((x) => x.tag === 'Artifact') ? 'artefakt' : stapel.some((x) => x.mcid) ? 'getaggt' : 'unmarkiert';
          s[art] += it.str + (it.hasEOL ? '\n' : '');
        }
      }
      inhalt.push(s);
    }
    for (let i = 1; i <= doc.numPages; i++) {
      const baum = await (await doc.getPage(i)).getStructTree();
      if (baum && (baum.children || []).length) seitenMitBaum++;
      const lauf = (n) => {
        if (!n) return;
        if (n.role) rollen[n.role] = (rollen[n.role] || 0) + 1;
        if (n.role === 'Figure') {
          const nurGruppe = (n.children || []).length > 0 && n.children.every((c) => c.role === 'Figure' || c.role === 'Caption');
          if (n.alt && n.alt.trim()) alts.add(n.alt.trim()); else if (!nurGruppe) figurenOhneAlt++;
        }
        for (const c of n.children || []) lauf(c);
      };
      lauf(baum);
    }
    const ergebnis = { seiten: doc.numPages, lang: info?.Language ?? null, titel: info?.Title ?? null, marked: markInfo?.Marked === true,
      displayDocTitle: vp?.DisplayDocTitle === true, lesezeichen, rollen, alts: [...alts], figurenOhneAlt, seitenMitBaum, inhalt };
    await doc.destroy();
    return ergebnis;
  } finally { console.warn = warn; console.log = log0; }
}

// Lesezeichen-Heuristik (12.11.2026): jedes Lesezeichen muss zu einer Ueberschrift der Quelle passen. Verglichen wird ohne Zierzeichen
// (Symbole wie ★) und mit normalisiertem Leerraum. Fehler: Lesezeichen ohne passende Ueberschrift; gleiche Buchstabenfolge, aber andere
// Leerzeichen (zusammengeklebte Woerter wie "fürKäuferinnen"); doppeltes Zierzeichen ("★★"); Leerraum am Anfang oder Ende.
const ZIER = /\p{So}/gu;
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const ohneZier = (s) => norm(String(s ?? '').replace(ZIER, ''));
export function lesezeichenFehler(lesezeichen, ueberschriften) {
  const fehler = [];
  const hs = ueberschriften.map(ohneZier);
  for (const l of lesezeichen) {
    if (/(\p{So})\s*\1/u.test(l)) { fehler.push('doppeltes Zierzeichen: "' + l + '"'); continue; }
    if (l !== l.trim()) { fehler.push('Leerraum am Rand: "' + l + '"'); continue; }
    const o = ohneZier(l);
    if (hs.includes(o)) continue;
    const k = o.replace(/\s/g, '').toLowerCase();
    const nah = hs.find((h) => h.replace(/\s/g, '').toLowerCase() === k);
    fehler.push(nah ? 'Woerter zusammengeklebt: "' + l + '" statt "' + nah + '"' : 'keine passende Ueberschrift: "' + l + '"');
  }
  return fehler;
}

// Fusszeile je Seite: inhalt = [{ getaggt, artefakt, unmarkiert }] aus lesePdf, fuss = RegExp der Seitenzahl. Zaehlt Seiten mit Fusszeile
// ueberhaupt, als getaggter Inhalt (im Strukturbaum) und als /Artifact.
export function fussBefund(inhalt, fuss) {
  const re = new RegExp(fuss.source);
  return { gefunden: inhalt.filter((s) => re.test(s.artefakt) || re.test(s.unmarkiert) || re.test(s.getaggt)).length,
    imBaum: inhalt.filter((s) => re.test(s.getaggt)).length, artefakt: inhalt.filter((s) => re.test(s.artefakt)).length };
}

// erwartung: { sprache, titel, kapitel: [Kapiteltitel], bilder: Zahl, altTexte: [Texte], seiten: Zahl,
//              ueberschriften: [Texte der h1-h3 der Quelle], fuss: RegExp der Seitenzahl in der Fusszeile } (alles optional)
// Rueckgabe zusaetzlich: hinweise (Liste { name, info }) fuer Dinge, die Chromium nicht kann und die deshalb nicht als Fehler zaehlen.
export async function pruefePdf(buffer, erwartung = {}) {
  const d = await lesePdf(buffer);
  const pruefungen = [], hinweise = [];
  const p = (name, ok, info = '') => pruefungen.push({ name, ok: !!ok, info });
  p('Tagged-Flag (MarkInfo /Marked true)', d.marked);
  p('Struktur-Baum (StructTreeRoot) auf allen Seiten', d.seitenMitBaum === d.seiten && d.seiten > 0, d.seitenMitBaum + '/' + d.seiten);
  p('/Lang gesetzt' + (erwartung.sprache ? ' = ' + erwartung.sprache : ''), d.lang && (!erwartung.sprache || d.lang.toLowerCase() === erwartung.sprache), String(d.lang));
  p('Titel gesetzt' + (erwartung.titel ? ' = "' + erwartung.titel + '"' : ''), d.titel && (!erwartung.titel || d.titel === erwartung.titel), String(d.titel));
  p('DisplayDocTitle true', d.displayDocTitle);
  const kap = erwartung.kapitel || [];
  p('Gliederung vorhanden, Eintraege >= Kapitel (' + kap.length + ')', d.lesezeichen.length > 0 && d.lesezeichen.length >= kap.length, String(d.lesezeichen.length));
  const lk = d.lesezeichen.map(kompakt);
  const fehlendeKap = kap.filter((k) => !lk.some((l) => l.includes(kompakt(k))));
  p('jedes Kapitel als Lesezeichen', fehlendeKap.length === 0, fehlendeKap.slice(0, 3).join(' | '));
  p('H1 genau einmal, H2 und H3 vorhanden', d.rollen.H1 === 1 && d.rollen.H2 > 0 && d.rollen.H3 > 0, JSON.stringify({ H1: d.rollen.H1, H2: d.rollen.H2, H3: d.rollen.H3 }));
  p('Listen als L/LI getaggt', d.rollen.L > 0 && d.rollen.LI > 0);
  p('Tabellen mit TH', !d.rollen.Table || d.rollen.TH > 0, JSON.stringify({ Table: d.rollen.Table, TH: d.rollen.TH }));
  p('Figure-Tags vorhanden', (d.rollen.Figure || 0) > 0, String(d.rollen.Figure || 0));
  p('jedes Figure mit /Alt', d.figurenOhneAlt === 0, d.figurenOhneAlt + ' ohne Alt');
  if (erwartung.bilder != null) p('verschiedene Alt-Texte = Bilder (' + erwartung.bilder + ')', d.alts.length === erwartung.bilder, String(d.alts.length));
  if (erwartung.altTexte) { const fehlt = erwartung.altTexte.filter((a) => !d.alts.includes(a)); p('alle Alt-Texte der Quelle im PDF', fehlt.length === 0, fehlt.slice(0, 2).join(' | ')); }
  if (erwartung.seiten != null) p('Seitenzahl = ' + erwartung.seiten, d.seiten === erwartung.seiten, String(d.seiten));
  p('Lesezeichen ohne doppelte Zierzeichen', !d.lesezeichen.some((l) => /(\p{So})\s*\1/u.test(l)), d.lesezeichen.filter((l) => /(\p{So})\s*\1/u.test(l)).join(' | '));
  if (erwartung.ueberschriften) { const f = lesezeichenFehler(d.lesezeichen, erwartung.ueberschriften); p('Lesezeichen = Ueberschriften (keine zusammengeklebten Woerter)', f.length === 0, f.slice(0, 3).join(' | ')); }
  if (erwartung.fuss) {
    // Fusszeile (displayHeaderFooter): darf nicht als echter Inhalt im Strukturbaum stehen. Ob sie als /Artifact markiert ist, wird nur gemeldet.
    const { gefunden, imBaum, artefakt } = fussBefund(d.inhalt, erwartung.fuss);
    p('Fusszeile auf jeder Seite gefunden', gefunden === d.seiten, gefunden + '/' + d.seiten);
    p('Fusszeile nicht im Strukturbaum (kein getaggter Inhalt)', imBaum === 0, imBaum + ' Seiten mit getaggter Fusszeile');
    if (artefakt < d.seiten) hinweise.push({ name: 'Fusszeile nicht als /Artifact markiert', info: (d.seiten - artefakt) + '/' + d.seiten + ' Seiten: weder getaggt noch Artefakt (Chromium page.pdf schreibt kein /Artifact)' });
  }
  const unmarkiert = d.inhalt.reduce((n, s) => n + (s.unmarkiert.trim() ? 1 : 0), 0);
  if (unmarkiert) hinweise.push({ name: 'Seiten mit Text ausserhalb von Struktur und /Artifact', info: unmarkiert + '/' + d.seiten });
  return { daten: d, pruefungen, hinweise, ok: pruefungen.every((x) => x.ok) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
  const datei = process.argv.slice(2).find((x) => !x.startsWith('--'));
  if (!datei) { console.error('Aufruf: node tools/pdf-barrierefrei-pruefen.mjs <pdf> [--sprache=de] [--titel=...] [--bilder=N] [--seiten=N]'); process.exit(2); }
  const zahl = (n) => (arg(n) ? Number(arg(n)) : undefined);
  const kapitel = zahl('kapitel') ? Array.from({ length: zahl('kapitel') }, () => '') : undefined;
  const { pruefungen, hinweise, ok } = await pruefePdf(readFileSync(datei), { sprache: arg('sprache') || undefined, titel: arg('titel') || undefined, kapitel, bilder: zahl('bilder'), seiten: zahl('seiten'),
    fuss: arg('fuss') ? new RegExp(arg('fuss')) : undefined });
  for (const x of pruefungen) console.log((x.ok ? 'OK     ' : 'FEHLER ') + x.name + (x.ok || !x.info ? '' : ' | ' + x.info));
  for (const x of hinweise) console.log('HINWEIS ' + x.name + ' | ' + x.info);
  process.exit(ok ? 0 : 1);
}
