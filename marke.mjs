// Produktreife Block 2 (12.11.2026): Marke einstellbar. Der Name der Plattform kommt aus PLATTFORM_NAME (konfig.mjs prueft ihn),
// Standard ist "Musterakademie": ohne Einstellung sieht alles exakt aus wie bisher (gleiche Texte, gleiche Logo-Dateien).
// Texte in texte/<sprache>.json enthalten den Platzhalter {plattform}; texte.mjs ersetzt ihn hier beim Lesen (Server UND /api/texte).
// Grammatik ohne Bruch:
//   HU: "a {plattform}" / "A {plattform}" bekommt den richtigen Artikel (a/az, nach dem Anlaut des Namens).
//   DE: "der {plattform}" (Genitiv) bleibt nur bei weiblichen Namen (…akademie, …schule, …plattform usw.), sonst wird daraus "von <Name>".
// Logo: beim Standardnamen die bisherigen Dateien /img/muster-logo*.svg; bei eigenem Namen ein Textlogo (SVG aus dem Namen, gleiche Gestaltung,
// erster Buchstabe im Quadrat) unter /img/marke-logo.svg und /img/marke-logo-vertikal.svg. Kein fremdes Bild, keine externe Adresse (CSP bleibt unveraendert).
import express from 'express';
import { statSync } from 'node:fs';
import { leiteAb, erzeugeCss, cssHash } from './farben.mjs';
import { hexPruefen } from './kontrast.mjs';
import { leseLogo, pruefePng } from './logo-png.mjs';

export const STANDARD_PLATTFORM_NAME = 'Musterakademie';
export const PLATTFORM_NAME_MAX = 60;
let NAME = STANDARD_PLATTFORM_NAME;

// Prueft einen Namen. Liefert null (gueltig) oder einen Fehlertext OHNE den Wert.
// Erlaubt: 1 bis 60 Zeichen, mindestens ein Buchstabe oder eine Ziffer; verboten: HTML-/Attributzeichen < > & " ' `, Klammern { } und \, Steuerzeichen/Zeilenumbrueche.
export function pruefePlattformName(name) {
  const n = String(name ?? '');
  if (!n.length || n.length > PLATTFORM_NAME_MAX) return 'PLATTFORM_NAME ist ungültig (1 bis ' + PLATTFORM_NAME_MAX + ' Zeichen).';
  if (/[\u0000-\u001f\u007f-\u009f<>&"'`{}\\]/.test(n)) return 'PLATTFORM_NAME enthält unzulässige Zeichen (kein HTML, keine Anführungszeichen, keine Klammern { }, keine Zeilenumbrüche).';
  if (!/[\p{L}\p{N}]/u.test(n)) return 'PLATTFORM_NAME muss mindestens einen Buchstaben oder eine Ziffer enthalten.';
  if (n !== n.trim() || /\s{2,}/.test(n)) return 'PLATTFORM_NAME darf nicht mit Leerzeichen beginnen oder enden und keine doppelten Leerzeichen enthalten.';
  return null;
}

// Wird von erstelleServer gesetzt (ein Name je Prozess). Ungueltiges faellt auf den Standard zurueck (konfig.mjs laesst es gar nicht erst durch).
export function setzePlattform(name) {
  NAME = name && !pruefePlattformName(name) ? String(name) : STANDARD_PLATTFORM_NAME;
}
export const plattformName = () => NAME;
export const plattformStandard = () => NAME === STANDARD_PLATTFORM_NAME;
// Fuer Dateinamen (Downloads): Kleinbuchstaben, Umlaute vereinfacht, sonst Bindestriche. Standard: "musterakademie" (wie bisher).
export function plattformSlug() {
  const s = NAME.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'plattform';
}
// Block 3 (Download-Produkte): Dateiname fuer Content-Disposition, nur a-z, 0-9 und Bindestriche (kein Anfuehrungszeichen, kein Pfad, keine
// Kopfzeilen-Injektion moeglich). Beispiel: ("handbuch-kaeufer-de.pdf", ".pdf") -> "musterakademie-handbuch-kaeufer-de.pdf".
export function downloadDateiname(name, endung) {
  const basis = String(name ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
  const end = /^\.[a-z0-9]{1,5}$/.test(String(endung)) ? endung : '';
  return plattformSlug() + (basis ? '-' + basis : '') + end;
}
let LOGO_PNG_PFAD = null;
let _logoCache = null; // { mtimeMs, size, gueltig, v, leseFehlerBis } — leseFehlerBis: null=dauerhaft, sonst Ablauf-Timestamp
let _logoPruefungen = 0;
let _leseFehlerAblaufMs = 5000;
export function setzeLogoPfad(pfad) { LOGO_PNG_PFAD = pfad; _logoCache = null; }
// Zaehlt echte leseLogo+pruefePng-Laeufe (steigt nur bei geaenderter mtimeMs/size oder Lesefehler-Ablauf).
export function logoPruefungen() { return _logoPruefungen; }
// Fuer Tests: wie lange ein Lesefehler (leseLogo=null) gecacht wird, bevor erneut gelesen wird (Standard 5000 ms).
export function setzeLogoLesefehlerAblaufMs(ms) { _leseFehlerAblaufMs = ms; }

export const logoPfade = () => {
  if (LOGO_PNG_PFAD) {
    try {
      const { mtimeMs, size } = statSync(LOGO_PNG_PFAD);
      const cacheMiss = !_logoCache || _logoCache.mtimeMs !== mtimeMs || _logoCache.size !== size;
      const leseFehlerAbgelaufen = !cacheMiss && _logoCache.leseFehlerBis !== null && Date.now() >= _logoCache.leseFehlerBis;
      if (cacheMiss || leseFehlerAbgelaufen) {
        _logoPruefungen++;
        const buf = leseLogo(LOGO_PNG_PFAD);
        if (buf === null) {
          // Kurzer Lesefehler (z. B. EBUSY): nur kurz cachen, danach erneut lesen
          _logoCache = { mtimeMs, size, gueltig: false, v: 0, leseFehlerBis: Date.now() + _leseFehlerAblaufMs };
        } else {
          const gueltig = !pruefePng(buf);
          _logoCache = { mtimeMs, size, gueltig, v: gueltig ? Math.floor(mtimeMs) : 0, leseFehlerBis: null };
        }
      }
      if (_logoCache.gueltig) {
        return { quer: `/marke/logo.png?v=${_logoCache.v}`, vertikal: `/marke/logo.png?v=${_logoCache.v}` };
      }
    } catch {
      _logoCache = null; // Datei fehlt oder statSync fehlgeschlagen -> SVG
    }
  }
  return plattformStandard()
    ? { quer: '/img/muster-logo.svg', vertikal: '/img/muster-logo-vertikal.svg' }
    : { quer: '/img/marke-logo.svg', vertikal: '/img/marke-logo-vertikal.svg' };
};

// HU-Artikel: "az" vor Vokal (auch ungarische Sonderbuchstaben) und vor Zahlen, die mit Vokal gesprochen werden (1 egy, 5 öt, 1000 ezer ...).
function huArtikel(name) {
  if (/^[aáeéiíoóöőuúüűAÁEÉIÍOÓÖŐUÚÜŰ]/.test(name)) return 'az';
  const z = /^\d+/.exec(name);
  if (z) { const d = z[0]; if (d[0] === '5' || (d[0] === '1' && [1, 4, 7, 10].includes(d.length))) return 'az'; }
  return 'a';
}
// DE: weibliche Namen (letztes Wort) behalten "der <Name>"; sonst "von <Name>".
const DE_WEIBLICH = /(akademie|schule|plattform|werkstatt|universität|hochschule|stiftung|agentur|gesellschaft|gemeinschaft|initiative|manufaktur|fabrik|bühne|zentrale|klinik|praxis|ung|heit|keit|schaft|ion|tät|ie|ik)$/i;
const deGenitiv = (name) => (DE_WEIBLICH.test(name.split(/[\s-]+/).pop() || '') ? 'der ' + name : 'von ' + name);

// Ersetzt {plattform} in einem Text der Sprache l. Texte ohne Platzhalter bleiben unveraendert (gleiches Objekt).
export function ersetzeMarke(text, l) {
  if (typeof text !== 'string' || !text.includes('{plattform}')) return text;
  let t = text;
  if (l === 'hu') {
    const art = huArtikel(NAME);
    t = t.replace(/(^|[^\p{L}])([aA]) \{plattform\}/gu, (_m, vor, a) => vor + (a === 'A' ? art[0].toUpperCase() + art.slice(1) : art) + ' ' + NAME);
  } else if (l === 'de') {
    t = t.replace(/(^|[^\p{L}])der \{plattform\}/gu, (_m, vor) => vor + deGenitiv(NAME));
  }
  return t.split('{plattform}').join(NAME);
}

// Textlogo als SVG (nur bei eigenem Namen). Der Name ist von konfig.mjs gegen < > & " ' gesichert; hier zusaetzlich escapen.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function textLogoSvg(vertikal = false) {
  const name = esc(NAME);
  const initiale = esc((NAME.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase());
  const breite = Math.max(200, Math.ceil(96 + [...NAME].length * 28));
  const [quadrat, zeichen, schrift] = vertikal ? ['#E5B86C', '#101827', '#FFFFFF'] : ['#101827', '#E5B86C', '#101827'];
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + breite + ' 80" role="img" aria-label="' + name + '">' +
    '<rect x="4" y="8" width="64" height="64" rx="14" fill="' + quadrat + '"/>' +
    '<text x="36" y="53" text-anchor="middle" font-family="Manrope,Inter,Arial,sans-serif" font-size="34" font-weight="800" fill="' + zeichen + '">' + initiale + '</text>' +
    '<text x="84" y="53" font-family="Manrope,Inter,Arial,sans-serif" font-size="34" font-weight="800" fill="' + schrift + '">' + name + '</text></svg>';
}
export const markeRouter = express.Router();
markeRouter.get('/favicon.svg', (req, res, next) => {
  if (plattformStandard()) return next();
  const initiale = esc((NAME.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase());
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="' + esc(NAME) + '">' +
    '<rect width="64" height="64" rx="14" fill="#101827"/>' +
    '<text x="32" y="45" text-anchor="middle" font-family="Manrope,Inter,Arial,sans-serif" font-size="36" font-weight="800" fill="#E5B86C">' + initiale + '</text></svg>';
  res.setHeader('Cache-Control', 'no-cache');
  res.type('image/svg+xml').send(svg);
});
markeRouter.get(['/img/marke-logo.svg', '/img/marke-logo-vertikal.svg'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('image/svg+xml').send(textLogoSvg(req.path.includes('vertikal')));
});

// Cache nach gespeichertem JSON: Ableitung und Hash nur bei geaendertem Wert.
let farbenCache;
// Die Datenbank wird NICHT hier importiert (db.mjs oeffnet beim Import die Datei und wuerde den Start-Fehlerpfad umgehen,
// Test setupmodus A9): markeAdminRouter reicht sie nach dem regulaeren Start herein. Ohne Datenbank gilt der Standard.
let farbenDb = null;
export function setzeFarbenDb(datenbank) { farbenDb = datenbank; farbenCache = undefined; }
export function leseFarben() {
  let roh;
  try { roh = farbenDb?.prepare("SELECT wert FROM marke WHERE schluessel='farben'").get()?.wert; } catch { roh = undefined; }
  if (farbenCache && farbenCache.roh === roh) return farbenCache;
  let farben = null, css = '';
  try {
    const wert = JSON.parse(roh);
    const ab = leiteAb(wert);
    if (ab.ok === true) {
      css = erzeugeCss(ab.tokens);
      farben = Object.fromEntries(['haupt', 'dunkel', 'hell'].map(feld => [feld, hexPruefen(wert[feld])]));
      farben.hash = cssHash(css);
    }
  } catch { /* Defektes JSON: unveraenderter Standard. */ }
  farbenCache = { roh, farben, css, hash: css ? cssHash(css) : 'standard' };
  return farbenCache;
}
export const farbenLink = () => '<link rel="stylesheet" href="/marke.css?v=' + leseFarben().hash + '">';
markeRouter.get('/marke.css', (req, res) => {
  const { css } = leseFarben();
  const etag = '"' + cssHash(css) + '"';
  res.type('text/css').set({
    'Cache-Control': 'no-cache',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  });
  const passt = String(req.headers['if-none-match'] ?? '').split(',').some(wert => {
    const tag = wert.trim();
    return tag === '*' || (tag.startsWith('W/') ? tag.slice(2) : tag) === etag;
  });
  if (passt) return res.status(304).end();
  res.send(css);
});
