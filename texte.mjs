// Ungarische Texte der Plattform: alle Texte stehen in texte/hu.json (Schlüssel -> Text).
// API-Fehler sehen so aus: { fehler: "<code>", text: "<ungarischer Text>" }. Der Code bleibt für Programme stabil, der Text ist für Menschen.
import express from 'express';
import { bannerUrl, leseMarkeS1 } from './banner-bild.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Drei gleichwertige Sprachen: texte/en.json, texte/de.json, texte/hu.json (gleiche Schluessel). hu.json ist Gabriellas Fassung und bleibt unveraendert.
// Die Sprache gilt PRO ANFRAGE (Cookie "lang" oder ?lang=), Rueckfall = Standardsprache (Deutsch; Umgebungsvariable TEXT_SPRACHE=hu|en|de setzt den Standard, die Tests nutzen das).
// HU[schluessel] liefert automatisch den Text der aktuellen Anfrage-Sprache (AsyncLocalStorage); Webhooks nutzen die Sprache aus den Checkout-Metadaten.
import { AsyncLocalStorage } from 'node:async_hooks';
import { farbenLink, ersetzeMarke, plattformName, plattformSlug, plattformStandard, logoPfade } from './marke.mjs';
export const SPRACHEN = ['en', 'de', 'hu'];
const LOCALES = { en: 'en-GB', de: 'de-DE', hu: 'hu-HU' };
export const STANDARD_SPRACHE = SPRACHEN.includes(process.env.TEXT_SPRACHE) ? process.env.TEXT_SPRACHE : 'de';
const DATEIEN = Object.fromEntries(SPRACHEN.map(l => [l, JSON.parse(readFileSync(new URL('./texte/' + l + '.json', import.meta.url), 'utf8'))]));
const kontext = new AsyncLocalStorage();
export const gueltigeSprache = l => (SPRACHEN.includes(l) ? l : null);
export const mitSprache = (l, fn) => kontext.run(gueltigeSprache(l) ?? STANDARD_SPRACHE, fn);
export const sprache = () => kontext.getStore() ?? STANDARD_SPRACHE;
// Fuer Hintergrundjobs (Mail-Warteschlange): setzt die gespeicherte Sprache des Vorgangs fuer den Rest dieses Jobs; ohne gueltige Sprache gilt die Standardsprache.
export const spracheSetzen = (l) => { kontext.enterWith(gueltigeSprache(l) ?? STANDARD_SPRACHE); };
export const locale = () => LOCALES[sprache()];
// Produktreife Block 2: {plattform} wird beim Lesen durch den eingestellten Plattformnamen ersetzt (marke.mjs, mit HU-Artikel und DE-Genitiv).
const textVon = (l, k) => { const q = DATEIEN[l][k] !== undefined ? l : 'de'; return ersetzeMarke(DATEIEN[q][k], q); };
export const texteFuer = l => { const s = gueltigeSprache(l) ?? STANDARD_SPRACHE; return Object.fromEntries(Object.keys(DATEIEN[s]).map(k => [k, textVon(s, k)])); };
// Name HU bleibt aus Kompatibilitaet: aktive Sprache der Anfrage (Fallback Deutsch, wenn ein Schluessel fehlt).
export const HU = new Proxy({}, {
  get: (_t, k) => (typeof k === 'string' ? textVon(sprache(), k) : undefined),
  has: (_t, k) => k in DATEIEN.de,
  ownKeys: () => Reflect.ownKeys(DATEIEN[sprache()]),
  getOwnPropertyDescriptor: (_t, k) => (k in DATEIEN.de ? { enumerable: true, configurable: true, value: textVon(sprache(), k) } : undefined),
});
const cookieWert = (req, name) => (req.headers.cookie ?? '').split('; ').map(c => c.split('=')).find(([n]) => n === name)?.[1];
// Middleware. Prioritaet: ausdrueckliche Wahl (URL-Praefix /de /en /hu oder ?lang=) > Konto (beim Login wird die Kontosprache ins Cookie geschrieben) > Cookie > Browsersprache > Standard (Deutsch).
export function spracheMiddleware(req, res, next) {
  // Vorschau-Abfragen duerfen die gespeicherte Browsersprache nicht aendern.
  const nurAntwort = req.method === 'GET' && /^\/api\/(?:texte\/?$|beispiele(?:\/|$))/i.test(req.path.replace(/\/+/g,'/'));
  let wunsch = gueltigeSprache(typeof req.query.lang === 'string' ? req.query.lang : null);
  const m = new RegExp('^/(en|de|hu)(?=/|$)').exec(req.path);
  if (m) { wunsch = wunsch ?? m[1]; req.url = req.url.slice(3) || '/'; if (!req.url.startsWith('/') ) req.url = '/' + req.url; }
  const browser = (req.headers['accept-language'] ?? '').split(',').map(x => x.trim().slice(0, 2).toLowerCase()).find(x => SPRACHEN.includes(x));
  const l = wunsch ?? gueltigeSprache(cookieWert(req, 'lang')) ?? gueltigeSprache(browser) ?? STANDARD_SPRACHE;
  if (!nurAntwort && wunsch && cookieWert(req, 'lang') !== wunsch) res.append('Set-Cookie', 'lang=' + wunsch + '; Path=/; Max-Age=31536000; SameSite=Lax');
  res.setHeader('Content-Language', l);
  res.append('Vary', 'Cookie, Accept-Language');
  kontext.run(l, next);
}

export function fehler(res, status, code) {
  return res.status(status).json({ fehler: code, text: HU[code] ?? code });
}

// Für Links, die der Browser in einem neuen Tab öffnet (zum Beispiel Beleg): bei Fehlern eine ungarische Seite statt rohem JSON.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function fehlerSeite(req, res, status, code) {
  if (req.accepts(['json', 'html']) !== 'html') return fehler(res, status, code);
  const text = esc(HU[code] ?? HU.a_ismeretlen);
  return res.status(status).type('html').send('<!doctype html><html lang="' + sprache() + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>' + text + '</title><link rel="stylesheet" href="/kunde.css">' + farbenLink() + '</head><body><main class="oldal-main"><h1>' + text + '</h1><p><a class="knopf" href="/#/fiokom">' + esc(HU.oldal_vissza) + '</a></p></main></body></html>');
}

// Öffentlich: alle Oberflächentexte für die Seiten (enthalten nichts Geheimes).
export const texteRouter = express.Router();
texteRouter.get('/api/texte', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  // _plattform, _plattform_slug, _logo, _logo_vertikal: oeffentlicher Markenname und Logo-Pfade (Produktreife Block 2, keine Geheimnisse).
  const logo = logoPfade();
  // F-137: _titel_praefix = '<Name> - ' nur bei eigenem Namen (fuer document.title im Frontend). Beim Standardnamen fehlt das Feld,
  // damit die Antwort wie vorher aussieht (selbsttest-admin verlangt, dass jeder Wert eine nicht leere Zeichenkette ist); das Frontend nutzt (T._titel_praefix || '').
  const titelPraefix = plattformStandard() ? {} : { _titel_praefix: plattformName() + ' - ' };
  res.json({ ...HU, _banner: bannerUrl(), _hero: leseMarkeS1('hero')?.[sprache()] ?? null, _sprache: sprache(), _locale: locale(), _plattform: plattformName(), _plattform_slug: plattformSlug(), _logo: logo.quer, _logo_vertikal: logo.vertikal, ...titelPraefix });
});

// Startseiten (Kunde und Admin): die festen HTML-Dateien bekommen lang, Titel und Notfalltexte der Anfrage-Sprache.
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const seitenCache = new Map();
function seiteMitSprache(datei, titelSchluessel) {
  return (_req, res) => {
    if (!seitenCache.has(datei)) seitenCache.set(datei, readFileSync(new URL('./public/' + datei, import.meta.url), 'utf8'));
    const html = seitenCache.get(datei)
      .replace('<link rel="stylesheet" href="/marke.css?v=standard">', () => farbenLink())
      .replace(/<html lang="[a-z]+">/, '<html lang="' + sprache() + '">')
      .replace(new RegExp('<title>[^<]*</title>'), '<title>' + (plattformStandard() ? '' : escHtml(plattformName()) + ' - ') + escHtml(HU[titelSchluessel]) + '</title>')
      .replace(new RegExp('<p id="notfall">[^<]*</p>'), '<p id="notfall">' + escHtml(HU.notfall_seite) + '</p>')
      .replace(new RegExp('<noscript><p>[^<]*</p></noscript>'), '<noscript><p>' + escHtml(HU.notfall_js) + '</p></noscript>')
      .replace(/<link rel="icon" type="[^"]*" href="[^"]*">/, () => {
        const logo = logoPfade();
        if (logo.quer.startsWith('/marke/logo.png')) return '<link rel="icon" type="image/png" href="' + logo.quer + '">';
        // Cache-Schluessel = Hash des NAMENS (nicht die Laenge): A -> B mit gleicher Laenge muss eine neue Adresse ergeben, sonst zeigt der Browser das alte Tab-Symbol.
        if (!plattformStandard()) return '<link rel="icon" type="image/svg+xml" href="/favicon.svg?n=' + createHash('sha1').update(plattformName()).digest('hex').slice(0, 8) + '">';
        return '<link rel="icon" type="image/svg+xml" href="/favicon.svg">';
      });
    res.type('html').send(html);
  };
}
export const seitenRouter = express.Router();
seitenRouter.get(['/', '/index.html'], seiteMitSprache('index.html', 'k_oldal_cim'));
// F-311: Express behandelt registrierte Pfade standardmaessig schraegstrich-unempfindlich, darum traf diese
// Route (urspruenglich nur ['/admin/', '/admin/index.html']) auch den Aufruf OHNE Schraegstrich ('/admin').
// Die Seite selbst verweist auf admin.css/admin.js relativ -- der Browser loest das dann gegen die falsche
// (eine Ebene zu hohe) Basis-URL auf und die Admin-Seite bleibt leer. Deshalb zuerst gezielt nur den echten
// Aufruf ohne Schraegstrich abfangen und umleiten (req.path, nicht die Musterangabe, zeigt die echte URL);
// '/admin/' und '/admin/index.html' fallen unveraendert zur Inhalts-Route durch.
seitenRouter.get('/admin', (req, res, next) => req.path === '/admin'
  ? res.redirect(301, '/admin/' + (req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''))
  : next());
seitenRouter.get(['/admin/', '/admin/index.html'], seiteMitSprache('admin/index.html', 'a_titel'));

// Rechtsseiten je Sprache: PLATZHALTER (Muster, Anwalt vor Livegang), nicht maschinell uebersetzte Rechtstexte. HU bleibt die vorhandene statische Datei (faellt durch an express.static).
const RECHT = {
  de: {
    zurueck: '← Zurück', demo: '<b>MUSTER / DEMONSTRATION.</b> Dies ist eine Musterplattform mit erfundenen Daten und ausschließlich Testzahlungen. Es gibt keine echten Käufe. Platzhaltertext, vor einem echten Betrieb vom Anwalt zu prüfen.',
    impresszum: ['Impressum', '<p><b>Musterfirma (Demo)</b><br>Mustermann Max, Beispielstraße 1, 12345 Musterstadt<br>Telefon: Muster-Telefon (erfunden)<br>E-Mail: Die Mails dieser Demo laufen über ein Test-Postfach.</p><p>Angaben erfunden. Kein echter Anbieter.</p>'],
    adatvedelem: ['Datenschutz', '<p>Diese Demo verarbeitet nur erfundene Musterdaten (Mustermann). Es werden keine echten Personendaten und keine echten Zahlungen verarbeitet. Zahlungen laufen ausschließlich im Stripe-Testmodus (Testkarten). E-Mails gehen nur an ein Test-Postfach.</p><p>Vor einem echten Betrieb sind Hosting, Auftragsverarbeitung, Rechtsgrundlagen und Löschfristen an den tatsächlichen Betreiber anzupassen.</p>'],
    'reszveteli-feltetelek': ['Teilnahmebedingungen', '<p>Demonstration: Es gibt keine echten Verträge. Der Kauf eines Musterkurses ist eine Testzahlung ohne Geldfluss. Der Widerruf kann im Kundenkonto ausgelöst werden und führt im Test zu einer Testerstattung und dem Entzug des Zugangs.</p>'],
  },
  en: {
    zurueck: '← Back', demo: '<b>SAMPLE / DEMONSTRATION.</b> This is a sample platform with fictitious data and test payments only. No real purchases take place. Placeholder text: to be reviewed by a lawyer before any real operation.',
    impresszum: ['Legal notice', '<p><b>Sample Company (demo)</b><br>Max Mustermann, Beispielstrasse 1, 12345 Musterstadt<br>Phone: sample number (fictitious)<br>Email: the emails of this demo go to a test mailbox.</p><p>Details are fictitious. Not a real provider.</p>'],
    adatvedelem: ['Privacy notice', '<p>This demo processes fictitious sample data only (Mustermann). No real personal data and no real payments are processed. Payments run exclusively in Stripe test mode (test cards). Emails go to a test mailbox only.</p><p>Before real operation, hosting, data processing agreements, legal bases and retention periods must be adapted to the actual operator.</p>'],
    'reszveteli-feltetelek': ['Terms of participation', '<p>Demonstration: there are no real contracts. Buying a sample course is a test payment without any money flow. Withdrawal can be triggered in the customer account and results, in the test, in a test refund and removal of access.</p>'],
  },
};
// Produktreife (12.11.2026): Rechtsseiten im NORMALBETRIEB (ohne Demo-Modus). Die Muster-Seiten unten und die statischen Dateien in public/jogi
// gibt es nur noch im Demo-Modus. Sonst: Weiterleitung auf die Adresse des Betreibers (IMPRESSUM_URL, DATENSCHUTZ_URL, TEILNAHMEBEDINGUNGEN_URL)
// oder, wenn nichts hinterlegt ist, eine neutrale Seite "Vom Betreiber noch nicht hinterlegt" in der Anfrage-Sprache. Es wird kein Rechtstext erfunden.
const RECHT_TITEL = { impresszum: 'k_impresszum', adatvedelem: 'k_adatvedelem', 'reszveteli-feltetelek': 'k_feltetelek' };
export function betreiberRechtRouter({ demoModus = false, rechtsseiten = {} } = {}) {
  const r = express.Router();
  if (demoModus) return r;
  r.get(/^\/jogi\/(impresszum|adatvedelem|reszveteli-feltetelek)\/?(?:index\.html)?$/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ziel = rechtsseiten[req.params[0]];
    if (ziel) return res.redirect(302, ziel);
    const titel = escHtml(HU[RECHT_TITEL[req.params[0]]]);
    res.type('html').send('<!doctype html><html lang="' + sprache() + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + titel + '</title><link rel="stylesheet" href="/jogi/recht.css">' + farbenLink() + '</head><body><p><a href="/">' + escHtml(HU.oldal_vissza) + '</a></p><h1>' + titel + '</h1><p class="nicht-hinterlegt">' + escHtml(HU.recht_nicht_hinterlegt) + '</p></body></html>');
  });
  return r;
}
export const rechtRouter = express.Router();
rechtRouter.get(/^\/jogi\/(impresszum|adatvedelem|reszveteli-feltetelek)\/?(?:index\.html)?$/, (req, res, next) => {
  const l = sprache(); const R = RECHT[l];
  if (!R) {
    const html = readFileSync(new URL('./public/jogi/' + req.params[0] + '/index.html', import.meta.url), 'utf8');
    return res.type('html').send(html.replace('</head>', farbenLink() + '</head>'));
  }
  const [titel, text] = R[req.params[0]];
  res.type('html').send('<!doctype html><html lang="' + l + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + titel + ' | ' + escHtml(plattformName()) + ' (DEMO)</title><link rel="stylesheet" href="/jogi/recht.css">' + farbenLink() + '</head><body><p><a href="/">' + R.zurueck + '</a></p><h1>' + titel + '</h1><div class="demo">' + R.demo + '</div>' + text + '</body></html>');
});
