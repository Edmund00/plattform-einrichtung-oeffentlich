// assistent-routen.mjs – WP4/WP5/WP6/WP7: Einrichtungsassistent-Router (Baustein 1-7).
// WP5: Schritt 1 (Name + Logo). WP6: Schritt 2 (Impressum, Datenschutz, Teilnahme).
// WP7: Schritt 3 (Resend E-Mail, verschluesselter API-Schluessel, Test-Mail AJAX).
import express, { Router } from 'express';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { aktuellesToken, sitzungFingerabdruck, aktuellerBenutzer, sitzungBeenden, cookieLoeschen, passwortPruefen, gesperrt, fehlversuchMerken, fehlversucheLoeschen, stepupGueltig } from './auth.mjs';
import { spracheMiddleware, HU, sprache } from './texte.mjs';
import { farbenLink, pruefePlattformName, STANDARD_PLATTFORM_NAME } from './marke.mjs';
import { pruefePng, LOGO_MAX_BYTES, machLogoPfad, speichereLogo, leseLogo } from './logo-png.mjs';
import { pruefeTextFeld, pruefeEmailFormat, pruefeTelefonFormat, pruefeMailFromFormat, istStripeTestKey, istLiveStripeKey, istWebhookSecret } from './feldregeln.mjs';
import { oeffneEinstellungsSpeicher, holeHauptschluessel, erzeugeHauptschluesselDatei, maskiereGeheimnis, verschluesselteWerteVorhanden } from './einstellungen.mjs';
import { mailTesten } from './mail.mjs';
import { stripeVerbindungTesten } from './stripe-verbindung.mjs';
import { WEBHOOK_EREIGNISSE } from './zahlung.mjs';
import { schluesselAlsCode } from './schluessel-code.mjs';
import { ladeKonfig, KonfigFehler } from './konfig.mjs';
import { leseAnbieter } from './anbieter.mjs';
import { abschlussPruefungen, setzeBerichtDb, setzeBerichtLogoPfad } from './abschluss-bericht.mjs';

const SCHRITTE = 6;
const CSRF_MAX = 1000;

// WP6: Eigene Plattform-Pfade fuer Rechtsseiten (akzeptiert als "eigene URL", entspricht 'erstellt').
const EIGENE_RECHT_PFADE = new Set(['/jogi/impresszum', '/jogi/adatvedelem', '/jogi/reszveteli-feltetelek']);

// WP6: URL-Validation fuer Rechtsseiten-URL-Felder.
// Akzeptiert: exakt die 3 eigenen Pfade (als 'eigener_pfad') oder externe https://-Adresse.
// Ablehnt: javascript:, http://, Pfad-Traversal, Backslash, Schema-relativ.
function validiereRechtUrl(wert) {
  const v = String(wert ?? '').trim();
  if (!v) return 'leer';
  if (EIGENE_RECHT_PFADE.has(v)) return 'eigener_pfad';
  if (v.includes('\\') || v.includes('..')) return 'ungueltig';
  if (!v.startsWith('https://')) return 'ungueltig';
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') return 'ungueltig';
    if (u.username || u.password) return 'ungueltig';
    if (v.length > 500) return 'ungueltig';
    return 'ok';
  } catch {
    return 'ungueltig';
  }
}

// Whitelist der erlaubten POST-Felder (WP4: noch nicht genutzt, aber definiert fuer WP5+)
const WHITELIST = new Set([
  'PLATTFORM_NAME', 'ANBIETER_NAME', 'ANBIETER_ANSCHRIFT', 'ANBIETER_TELEFON',
  'ANBIETER_EMAIL', 'ANBIETER_ADOSZAM', 'STEUER_HINWEIS',
  'IMPRESSUM_URL', 'DATENSCHUTZ_URL', 'TEILNAHMEBEDINGUNGEN_URL',
  'RESEND_API_KEY', 'MAIL_FROM', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BASE_URL',
  'kurs_titel', 'kurs_beschreibung', 'kurs_preis', 'kurs_waehrung',
]);

const KURS_MAX_PREIS = 1_000_000_000;

// In-Memory CSRF-Map: Fingerabdruck (SHA-256 des Session-Tokens) -> Token-Hex
const csrfMap = new Map();

function holeCsrfToken(fp) {
  if (!csrfMap.has(fp)) {
    if (csrfMap.size >= CSRF_MAX) csrfMap.delete(csrfMap.keys().next().value);
    csrfMap.set(fp, randomBytes(32).toString('hex'));
  }
  return csrfMap.get(fp);
}

function pruefeCsrf(req) {
  const token = aktuellesToken(req);
  if (!token) return false;
  const fp = sitzungFingerabdruck(token);
  const erwartet = csrfMap.get(fp);
  if (!erwartet) return false;
  const gesendet = req.body?.csrf_token;
  if (typeof gesendet !== 'string' || gesendet.length !== erwartet.length) return false;
  try {
    return timingSafeEqual(Buffer.from(erwartet, 'hex'), Buffer.from(gesendet, 'hex'));
  } catch {
    return false;
  }
}

// Wie pruefeCsrf, liest aber aus dem X-Csrf-Token-Header (für octet-stream-Uploads).
function pruefeCsrfHeader(req) {
  const token = aktuellesToken(req);
  if (!token) return false;
  const fp = sitzungFingerabdruck(token);
  const erwartet = csrfMap.get(fp);
  if (!erwartet) return false;
  const gesendet = req.headers['x-csrf-token'];
  if (typeof gesendet !== 'string' || gesendet.length !== erwartet.length) return false;
  try {
    return timingSafeEqual(Buffer.from(erwartet, 'hex'), Buffer.from(gesendet, 'hex'));
  } catch {
    return false;
  }
}

const ESC_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC_HTML[c]);
const escJs = (s) => { const m = {'\\':'\\\\',"'":"\\'",'<':'\\u003c','>':'\\u003e','&':'\\u0026'}; return String(s).replace(/[\\<>&']/g, c => m[c]); };

function sicherheitsheader(res) {
  res.setHeader('Cache-Control', 'no-store');
  // same-origin statt no-referrer: Chrome sendet bei no-referrer in Formular-POSTs Origin: null (MDN Referrer-Policy), die strenge Origin-Pruefung wuerde jedes Formular ablehnen; same-origin sendet den echten Origin, Fremdseiten bekommen weiter null
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sprachumschalter(req) {
  const basis = req.path === '/' ? '/admin/einrichtung/' : req.path.startsWith('/schritt/') ? `/admin/einrichtung${req.path}` : `/admin/einrichtung${req.path}`;
  return `<nav><a href="${basis}?lang=hu">HU</a> <a href="${basis}?lang=de">DE</a> <a href="${basis}?lang=en">EN</a></nav>`;
}

function kopf(titel, lang) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titel}</title><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/kunde.css"><link rel="stylesheet" href="/admin/admin.css">${farbenLink()}</head><body><div id="app">`;
}

function fuss() {
  return `</div></body></html>`;
}

function abschlussSeite(lang, automatisch, berichtItems) {
  const hinweise = berichtItems.filter(item => !item.pflicht && item.status === 'hinweis');
  return kopf(escHtml(HU.assistent_abschluss_erfolg_titel), lang) +
    `<main class="einr-abschluss"><h1>${escHtml(HU.assistent_abschluss_erfolg_titel)}</h1>` +
    `<p>${escHtml(HU.assistent_abschluss_erfolg_text)}</p>` +
    `<p id="neustart-anleitung">${escHtml(automatisch ? HU.assistent_abschluss_neustart_erklaerung : HU.assistent_abschluss_neustart_anleitung)}</p>` +
    `<p id="${automatisch ? 'neustart-status' : 'poll-status'}" role="status">${escHtml(HU.assistent_abschluss_neustart_warten)}</p>` +
    `<nav id="abschluss-aktionen" class="einr-abschluss-aktionen" hidden>` +
    `<a class="knopf gross" href="/">${escHtml(HU.assistent_abschluss_shop)}</a>` +
    `<a href="/admin/">${escHtml(HU.assistent_abschluss_kurs)}</a>` +
    `<a href="/admin/">${escHtml(HU.assistent_abschluss_marke)}</a></nav>` +
    (hinweise.length ? `<section><h2>${escHtml(HU.assistent_abschluss_offen)}</h2><ul>` +
      hinweise.map(item => `<li>${escHtml(HU[item.grund])}</li>`).join('') + `</ul></section>` : '') +
    `</main><script>(function(){` +
    `var msg=document.getElementById('${automatisch ? 'neustart-status' : 'poll-status'}');` +
    `var fertig='${escJs(HU.assistent_abschluss_neustart_fertig)}';` +
    `var versuche=0;function poll(){versuche++;if(versuche>150){return;}fetch('/api/kurse',{cache:'no-store'}).then(function(r){var typ=r.headers.get('content-type')||'';if(r.ok&&typ.indexOf('json')>=0){document.getElementById('neustart-anleitung').hidden=true;msg.textContent=fertig;document.getElementById('abschluss-aktionen').hidden=false;}else{setTimeout(poll,2000);}}).catch(function(){setTimeout(poll,3000);});}` +
    `setTimeout(poll,3000);` +
    `})();</script>` + fuss();
}

// E5: Nur Darstellung; keine Schlüsselwerte oder Speicherung.
function einrAnleitung(art) {
  const t = suffix => escHtml(HU['assistent_anleitung_' + art + '_' + suffix]);
  const link = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  const mail = art === 'mail';
  const links = mail
    ? { 1: link('https://resend.com/api-keys', 'Resend: API Keys'), 5: link('https://resend.com/domains', 'Resend: Domains') }
    : { 1: link('https://dashboard.stripe.com/apikeys', 'Stripe: API keys') };
  const liste = [1, 2, 3, 4, 5].map(n => `<li>${t('schritt_' + n)}${links[n] ? ' ' + links[n] : ''}</li>`).join('');
  const lokal = mail ? '' : `<p>${t('lokal')} ${link('https://docs.stripe.com/stripe-cli', t('cli'))}</p>`;
  const quellen = mail
    ? link('https://resend.com/docs/dashboard/api-keys/introduction', t('quelle'))
    : link('https://docs.stripe.com/keys', t('quelle_keys')) + ' · ' + link('https://docs.stripe.com/webhooks', t('quelle_webhooks'));
  return `<details class="einr-anleitung"><summary>${t('titel')}</summary><ol>${liste}</ol>${lokal}<p class="einr-anleitung-block">${t('erfolg')}</p><p class="einr-anleitung-block">${t('sicherheit')}</p><p>${quellen}</p></details>`;
}

function einrText(key, werte = {}) {
  return Object.entries(werte).reduce((text, [name, wert]) => text.replaceAll('{'+name+'}', String(wert)), HU[key] ?? key);
}

// P1: Ausschließlich Darstellung der vorhandenen Abschlussprüfungen.
function einrPruefliste(items) {
  const fehlend = items.filter(item => item.pflicht && item.status === 'rot' && item.id !== 'schluessel').length;
  const zeile = (item, pflicht) => {
    const unten = pflicht && item.status === 'rot' && item.id === 'schluessel';
    const fehlt = pflicht && item.status === 'rot' && !unten;
    const status = unten ? `→ ${escHtml(HU.assistent_pruefliste_unten)}`
      : pflicht
        ? `${fehlt ? '✗' : '✓'} ${escHtml(HU[fehlt ? 'assistent_pruefliste_fehlt' : 'assistent_pruefliste_erledigt'])}`
        : '→';
    const korrektur = item.id !== 'schluessel' && item.korrekturLink != null &&
      (item.status === 'rot' || item.status === 'hinweis')
      ? ` <a href="${escHtml(item.korrekturLink)}">${escHtml(HU.g1a_korrigieren)}</a>` : '';
    return `<li class="${pflicht ? (fehlt ? 'bericht-rot' : (unten ? 'einr-optional-zeile' : 'bericht-ok')) : 'einr-optional-zeile'}"><strong class="einr-pruefstatus">${status}</strong> ${escHtml(HU[item.grund] ?? item.grund)}${korrektur}</li>`;
  };
  return `<section class="einr-pruefliste"><h2>${escHtml(HU.assistent_pruefliste_pflicht)}</h2>` +
    `<p>${escHtml(einrText(fehlend ? 'assistent_pruefliste_fehlen' : 'assistent_pruefliste_alle_erledigt', { n: fehlend }))}</p>` +
    `<ul class="bericht-liste">${items.filter(item => item.pflicht).map(item => zeile(item, true)).join('')}</ul></section>` +
    `<section class="einr-pruefliste einr-optional"><h2>${escHtml(HU.assistent_pruefliste_optional)}</h2>` +
    `<ul>${items.filter(item => !item.pflicht).map(item => zeile(item, false)).join('')}</ul></section>`;
}

function einrFortschritt(n, key, mitText = true) {
  const text = einrText(key, { n, gesamt: SCHRITTE });
  return `${mitText ? `<p>${escHtml(text)}</p>` : ''}<progress class="einr-fortschritt" value="${n}" max="${SCHRITTE}" aria-label="${escHtml(text)}">${escHtml(text)}</progress>`;
}

function einrSchrittkopf(n, titel) {
  return `<header class="einr-kopf"><p>${escHtml(einrText('assistent_schritt_x_von', { n, gesamt: SCHRITTE }))}</p><h1>${escHtml(titel)}</h1>${einrFortschritt(n, 'assistent_schritt_x_von', false)}<p>${escHtml(einrText('assistent_schritt_'+n+'_zweck'))}</p></header>`;
}

function einrNavigation(n) {
  const zurueck = n === 1 ? '/admin/einrichtung/' : '/admin/einrichtung/schritt/'+(n-1);
  return `<nav class="einr-navigation"><a href="${zurueck}">${escHtml(HU.assistent_zurueck)}</a> <a href="/admin/einrichtung/">${escHtml(HU.assistent_zur_uebersicht)}</a></nav>`;
}

function einrUebersicht(istFertig, naechsterOffenerSchritt) {
  let anzahl = 0;
  const eintraege = [];
  for (let n = 1; n <= SCHRITTE; n++) {
    const fertig = istFertig(n);
    if (fertig) anzahl++;
    const status = HU[fertig ? 'assistent_status_fertig' : n === 5 ? 'assistent_status_optional' : 'assistent_status_offen'];
    eintraege.push(`<li><a href="/admin/einrichtung/schritt/${n}">${escHtml(HU['assistent_schritt_'+n+'_titel'])}</a> <span class="einr-status">${fertig ? '✓ ' : ''}${escHtml(status)}</span></li>`);
  }
  const naechster = anzahl === SCHRITTE ? SCHRITTE : naechsterOffenerSchritt();
  const weiter = anzahl === SCHRITTE ? HU.assistent_zur_abschlusspruefung : einrText('assistent_weiter_mit_schritt', { n: naechster });
  return `<h1>${escHtml(HU.assistent_uebersicht_titel)}</h1><p>${escHtml(HU.assistent_uebersicht_einleitung)}</p>${einrFortschritt(anzahl, 'assistent_uebersicht_fortschritt')}<p>${escHtml(HU.assistent_dauer)}</p><ol class="einr-liste">${eintraege.join('\n')}</ol><p><a class="knopf" href="/admin/einrichtung/schritt/${naechster}">${escHtml(weiter)}</a></p>`;
}

// E4b: Nur klassische HTML-Formular-POSTs erhalten die Fehlerseite.
function istBrowserFormular(req) {
  return req.method === 'POST' &&
    String(req.headers.accept ?? '').toLowerCase().includes('text/html') &&
    !('x-requested-with' in req.headers) &&
    !String(req.headers['content-type'] ?? '').toLowerCase().includes('json');
}

function fehler(req, res, status, text, n) {
  if (!istBrowserFormular(req)) return res.status(status).type('text/plain').send(text);
  sicherheitsheader(res);
  const schritt = Number.isInteger(n) && n >= 1 && n <= SCHRITTE;
  const titel = HU.assistent_fehlerseite_titel;
  // Sprachwechsel fuehrt auf eine vorhandene GET-Seite, niemals auf den POST-Endpunkt.
  const pfad = schritt ? '/schritt/'+n : '/';
  return res.status(status).type('html').send(
    kopf(escHtml(titel), sprache()) +
    sprachumschalter({ path: pfad }) +
    `<main class="einr-fehlerseite">` +
    (schritt ? einrSchrittkopf(n, titel) : `<h1>${escHtml(titel)}</h1>`) +
    `<p role="alert"${typeof HU[text] === 'string' ? ` data-code="${escHtml(text)}"` : ''}>${escHtml(typeof HU[text] === 'string' ? HU[text] : text)}</p>` +
    `<p>${escHtml(HU.assistent_fehlerseite_hilfe)}</p>` +
    `<nav class="einr-navigation">` +
    (schritt ? `<a href="/admin/einrichtung/schritt/${n}">${escHtml(einrText('assistent_fehlerseite_zurueck', { n }))}</a> ` : '') +
    `<a href="/admin/einrichtung/">${escHtml(HU.assistent_zur_uebersicht)}</a></nav></main>` + fuss()
  );
}

export function erstelleAssistentRouter(db, konfig, hauptschluesselVorgabe = null, optionen = {}) {
  const router = Router();
  const logoPfad = machLogoPfad(konfig.dbDatei);
  setzeBerichtDb(db);
  setzeBerichtLogoPfad(logoPfad);

  // Baustein 3: Sprache
  router.use(spracheMiddleware);

  // Baustein 1: Authentifizierung (bereinigt auch CSRF-Map bei ungültiger Sitzung)
  router.use((req, res, next) => {
    const token = aktuellesToken(req);
    const b = aktuellerBenutzer(req);
    if (!b || b.rolle !== 'admin') {
      if (token) csrfMap.delete(sitzungFingerabdruck(token));
      return res.redirect(303, '/anmelden');
    }
    next();
  });

  // DB-Helfer: Schritt-Fortschritt lesen/schreiben (Baustein 2 + G6 Neustart-Sicherheit)
  function istFertig(n) {
    return db.prepare("SELECT wert FROM einstellungen WHERE schluessel=?")
      .get(`einrichtung_schritt_${n}`)?.wert === 'fertig';
  }
  function markiereAlsFertig(n) {
    db.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES (?, 'fertig', 0, datetime('now'))")
      .run(`einrichtung_schritt_${n}`);
  }
  function naechsterOffenerSchritt() {
    for (let n = 1; n <= SCHRITTE; n++) { if (!istFertig(n)) return n; }
    return 1;
  }

  // WP5: PLATTFORM_NAME lesen/schreiben (nicht verschlüsselt)
  function lesePlattformName() {
    return db.prepare("SELECT wert FROM einstellungen WHERE schluessel='PLATTFORM_NAME'").get()?.wert ?? '';
  }
  function schreibePlattformName(name) {
    db.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES ('PLATTFORM_NAME', ?, 0, datetime('now'))")
      .run(name);
  }

  // WP6: Generischer Einstellungs-Helfer (nicht verschlüsselt)
  function leseEinstellung(schluessel) {
    return db.prepare('SELECT wert FROM einstellungen WHERE schluessel=?').get(schluessel)?.wert ?? '';
  }
  function schreibeEinstellung(schluessel, wert) {
    db.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES (?, ?, 0, datetime('now'))")
      .run(schluessel, wert);
  }

  // WP9: Einrichtungs-ID – einmal erzeugt, nie geaendert (Idempotenz-Anker fuer Kursanlage)
  function holeEinrichtungId() {
    const existing = leseEinstellung('einrichtung_id');
    if (existing) return existing;
    const id = randomBytes(16).toString('hex');
    schreibeEinstellung('einrichtung_id', id);
    return id;
  }

  // WP7: Schluessel-Helfer fuer RESEND_API_KEY (verschluesselt via oeffneEinstellungsSpeicher)
  const SCHLUESSEL_PFAD = 'daten/.hauptschluessel';
  let cachedHs = hauptschluesselVorgabe;
  const mailTestAbklingzeit = { letzte: 0, stundeBeginn: 0, zaehler: 0 };
  const stripeTestAbklingzeit = { letzte: 0, stundeBeginn: 0, zaehler: 0 };
  function leseStripeKey() {
    try {
      if (!cachedHs) return null;
      return oeffneEinstellungsSpeicher(db, { hauptschluessel: cachedHs }).lese('STRIPE_SECRET_KEY') || null;
    } catch { return null; }
  }
  function leseWebhookSecretGespeichert() {
    try {
      if (!cachedHs) return null;
      return oeffneEinstellungsSpeicher(db, { hauptschluessel: cachedHs }).lese('STRIPE_WEBHOOK_SECRET') || null;
    } catch { return null; }
  }
  function loescheStripeKeys() {
    db.prepare("DELETE FROM einstellungen WHERE schluessel='STRIPE_SECRET_KEY'").run();
    db.prepare("DELETE FROM einstellungen WHERE schluessel='STRIPE_WEBHOOK_SECRET'").run();
  }
  function leseResendKey() {
    try {
      if (!cachedHs) return null;
      return oeffneEinstellungsSpeicher(db, { hauptschluessel: cachedHs }).lese('RESEND_API_KEY') || null;
    } catch { return null; }
  }
  function schreibeResendKey(schluessel) {
    if (!cachedHs) {
      if (!existsSync(SCHLUESSEL_PFAD)) {
        cachedHs = erzeugeHauptschluesselDatei(SCHLUESSEL_PFAD);
      } else {
        cachedHs = holeHauptschluessel({ env: {}, dateiPfad: SCHLUESSEL_PFAD, verschluesselteWerteVorhanden: verschluesselteWerteVorhanden(db) });
      }
    }
    oeffneEinstellungsSpeicher(db, { hauptschluessel: cachedHs }).schreibe('RESEND_API_KEY', schluessel);
  }
  function loescheResendKey() {
    db.prepare("DELETE FROM einstellungen WHERE schluessel='RESEND_API_KEY'").run();
  }

  // GET /admin/einrichtung – Uebersicht (Baustein 2, G2: 200 + Schrittzahl)
  router.get('/', (req, res) => {
    sicherheitsheader(res);
    const lang = sprache();
    res.type('text/html; charset=utf-8').send(
      kopf(escHtml(HU.assistent_uebersicht_titel), lang) + sprachumschalter(req) +
      einrUebersicht(istFertig, naechsterOffenerSchritt) + fuss()
    );
  });

  // GET /admin/einrichtung/schritt/:n (Baustein 2, G9: GET aendert keinen Zustand)
  router.get('/schritt/:n', (req, res) => {
    sicherheitsheader(res);
    const n = parseInt(req.params.n, 10);
    if (!n || n < 1 || n > SCHRITTE) return fehler(req, res, 404, 'nicht_gefunden');

    const lang = sprache();
    const token = aktuellesToken(req);
    const fp = sitzungFingerabdruck(token);
    const csrf = holeCsrfToken(fp);
    const fertig = istFertig(n);
    const titelKey = `assistent_schritt_${n}_titel`;
    const titel = HU[titelKey] ?? `Schritt ${n}`;

    const fortschrittTmpl = HU.assistent_schritt_x_von;
    const fortschritt = fortschrittTmpl.replace('{n}', String(n)).replace('{gesamt}', String(SCHRITTE));

    let schaltflaechen = null;
    let inhalt;
    if (n === 1) {
      // WP5: Schritt 1 — Name und Logo
      const aktuellerName = lesePlattformName();
      const hatLogo = !!leseLogo(logoPfad);
      const istStandard = !aktuellerName || aktuellerName === STANDARD_PLATTFORM_NAME;
      const anzeigeWert = aktuellerName || STANDARD_PLATTFORM_NAME;
      inhalt =
        `<label for="pname">${HU.assistent_name_bezeichnung ?? 'Name der Plattform'}</label>` +
        `<input id="pname" name="PLATTFORM_NAME" type="text" maxlength="60" value="${escHtml(anzeigeWert)}" autocomplete="off">` +
        `<p class="feldhilfe">${HU.assistent_name_hilfe ?? ''}</p>` +
        (istStandard ? `<p class="hinweis">${HU.assistent_name_standardhinweis ?? ''}</p>` : '') +
        `<hr>` +
        `<p><strong>${HU.assistent_logo_bezeichnung ?? 'Logo (optional)'}</strong></p>` +
        `<p class="feldhilfe">${HU.assistent_logo_hilfe ?? ''}</p>` +
        (hatLogo ? `<p><img src="/marke/logo.png" alt="Logo" class="einr-logo"></p>` : '') +
        `<div id="logo-bereich">` +
        `<input id="logo-datei" type="file" accept=".png,image/png">` +
        `<span id="logo-meldung" role="status"></span>` +
        `</div>` +
        `<script>` +
        `(function(){` +
        `var inp=document.getElementById('logo-datei');` +
        `var msg=document.getElementById('logo-meldung');` +
        `inp.addEventListener('change',function(){` +
        `var f=inp.files[0]; if(!f) return;` +
        `var r=new FileReader();` +
        `r.onload=function(e){` +
        `fetch('/admin/einrichtung/logo-upload',{` +
        `method:'POST',` +
        `headers:{'Content-Type':'application/octet-stream','X-Csrf-Token':'${csrf}'},` +
        `body:e.target.result` +
        `}).then(function(res){return res.json().then(function(d){return{ok:res.ok,d:d};});})` +
        `.then(function(r){msg.textContent=r.d.meldung||'';})` +
        `.catch(function(){msg.textContent='${escJs(HU.assistent_logo_fehler ?? 'Fehler')}';});` +
        `};` +
        `r.readAsArrayBuffer(f);` +
        `});` +
        `})();` +
        `</script>`;
    } else if (n === 2) {
      // WP6: Schritt 2 — Impressum, Datenschutz, Teilnahmebedingungen
      const seiten = ['impressum', 'datenschutz', 'teilnahmebedingungen'];
      const aktModi = {};
      const aktUrls = {};
      for (const s of seiten) {
        const gespeichert = leseEinstellung(`recht_${s}`);
        aktModi[s] = (gespeichert && gespeichert !== 'erstellt') ? 'eigene_url' : 'erstellt';
        aktUrls[s] = (gespeichert && gespeichert !== 'erstellt') ? gespeichert : '';
      }
      const _a = leseAnbieter();
      const anb = {
        name: _a.name,
        anschrift: _a.anschrift,
        email: _a.email,
        telefon: _a.telefon,
        adoszam: _a.adoszam,
        steuerhinweis: _a.steuerHinweis,
      };
      const einleitungText = HU.assistent_recht_einleitung ?? 'Impressum und Datenschutz';
      const modusFrage = HU.assistent_recht_modus_frage ?? 'Wie einrichten?';
      const modusErstellt = HU.assistent_recht_modus_erstellt ?? 'Bitte erstellen';
      const modusEigene = HU.assistent_recht_modus_eigene ?? 'Eigene Seite';
      const urlBez = HU.assistent_recht_url_bezeichnung ?? 'URL';
      function seitenAbschnitt(schluessel, labelKey, namePfx) {
        const label = HU[labelKey] ?? schluessel;
        const istEigene = aktModi[schluessel] === 'eigene_url';
        return `<fieldset><legend><strong>${escHtml(label)}</strong></legend>` +
          `<label><input type="radio" name="modus_${namePfx}" value="erstellt"${!istEigene ? ' checked' : ''}> ${escHtml(modusErstellt)}</label><br>` +
          `<label><input type="radio" name="modus_${namePfx}" value="eigene_url"${istEigene ? ' checked' : ''}> ${escHtml(modusEigene)}</label>` +
          `<div class="url-feld" id="url-${namePfx}"><br>` +
          `<label>${escHtml(urlBez)}<br><input type="url" name="${namePfx}_url" value="${escHtml(aktUrls[schluessel])}" autocomplete="off"></label>` +
          `</div></fieldset>`;
      }
      const impAbschn = HU.assistent_recht_impressum_abschnitt ?? 'Impressum';
      const datAbschn = HU.assistent_recht_datenschutz_abschnitt ?? 'Datenschutz';
      const teilAbschn = HU.assistent_recht_teilnahme_abschnitt ?? 'Teilnahmebedingungen';
      const betreiberTitel = HU.assistent_recht_betreiber_titel ?? 'Ihre Angaben';
      inhalt =
        `<p>${escHtml(einleitungText)}</p>` +
        seitenAbschnitt('impressum', 'assistent_recht_impressum_abschnitt', 'impressum') +
        seitenAbschnitt('datenschutz', 'assistent_recht_datenschutz_abschnitt', 'datenschutz') +
        seitenAbschnitt('teilnahmebedingungen', 'assistent_recht_teilnahme_abschnitt', 'teilnahmebedingungen') +
        `<fieldset><legend><strong>${escHtml(betreiberTitel)}</strong></legend>` +
        `<label>${escHtml(HU.assistent_recht_name_bezeichnung ?? 'Name')}<br><input name="ANBIETER_NAME" type="text" maxlength="160" value="${escHtml(anb.name)}" autocomplete="off"></label><br>` +
        `<label>${escHtml(HU.assistent_recht_anschrift_bezeichnung ?? 'Anschrift')}<br><input name="ANBIETER_ANSCHRIFT" type="text" maxlength="240" value="${escHtml(anb.anschrift)}" autocomplete="off"></label><br>` +
        `<label>${escHtml(HU.assistent_recht_email_bezeichnung ?? 'E-Mail')}<br><input name="ANBIETER_EMAIL" type="email" maxlength="254" value="${escHtml(anb.email)}" autocomplete="off"></label><br>` +
        `<label>${escHtml(HU.assistent_recht_telefon_bezeichnung ?? 'Telefon')}<br><input name="ANBIETER_TELEFON" type="text" maxlength="50" value="${escHtml(anb.telefon)}" autocomplete="off"></label><br>` +
        `<label>${escHtml(HU.assistent_recht_adoszam_bezeichnung ?? 'Steuernr.')}<br><input name="ANBIETER_ADOSZAM" type="text" maxlength="60" value="${escHtml(anb.adoszam)}" autocomplete="off"></label><br>` +
        `<label>${escHtml(HU.assistent_recht_steuerhinweis_bezeichnung ?? 'Steuerhinweis')}<br><input name="STEUER_HINWEIS" type="text" maxlength="200" value="${escHtml(anb.steuerhinweis)}" autocomplete="off"></label>` +
        `</fieldset>` +
        `<script>(function(){` +
        `var prfx=['impressum','datenschutz','teilnahmebedingungen'];` +
        `prfx.forEach(function(p){` +
        `var radios=document.querySelectorAll('[name="modus_'+p+'"]');` +
        `var div=document.getElementById('url-'+p);` +
        `function upd(){div.style.display=document.querySelector('[name="modus_'+p+'"]:checked').value==='eigene_url'?'':'none';}` +
        `radios.forEach(function(r){r.addEventListener('change',upd);});upd();` +
        `});})();</script>`;
    } else if (n === 3) {
      // WP7: Schritt 3 — Resend E-Mail-Versand
      const aktuellerKey = leseResendKey();
      const keyGesetzt = !!aktuellerKey;
      const aktuellesMailFrom = leseEinstellung('MAIL_FROM');

      let keyAbschnitt;
      if (keyGesetzt) {
        keyAbschnitt =
          `<p>${escHtml(HU.assistent_mail_key_maskiert ?? 'Schlüssel gespeichert:')} <code>${escHtml(maskiereGeheimnis(aktuellerKey))}</code></p>` +
          `<details><summary>${escHtml(HU.assistent_mail_key_ersetzen ?? 'Schlüssel ersetzen')}</summary>` +
          `<label>${escHtml(HU.assistent_mail_key_bezeichnung ?? 'Resend API-Schlüssel')}<br>` +
          `<input aria-describedby="einr-mail-key-hilfe" name="RESEND_API_KEY" type="password" maxlength="80" autocomplete="off"></label>` +
          `<p class="feldhilfe" id="einr-mail-key-hilfe">${escHtml(HU.assistent_mail_key_hilfe)}</p>` +
          `</details>`;
      } else {
        keyAbschnitt =
          `<label>${escHtml(HU.assistent_mail_key_bezeichnung ?? 'Resend API-Schlüssel')}<br>` +
          `<input aria-describedby="einr-mail-key-hilfe" name="RESEND_API_KEY" type="password" maxlength="80" autocomplete="off"></label>` +
          `<p class="feldhilfe" id="einr-mail-key-hilfe">${escHtml(HU.assistent_mail_key_hilfe)}</p>`;
      }

      inhalt =
        `<p>${escHtml(HU.assistent_mail_erklaerung ?? '')}</p>` +
        einrAnleitung('mail') +
        `<p class="feldhilfe">${escHtml(HU.assistent_mail_testabsender_hinweis ?? '')}</p>` +
        `<p class="feldhilfe">${escHtml(HU.assistent_mail_domain_hinweis ?? '')}</p>` +
        keyAbschnitt +
        `<br><label>${escHtml(HU.assistent_mail_from_bezeichnung ?? 'Absenderadresse')}<br>` +
        `<input name="MAIL_FROM" type="text" maxlength="320" value="${escHtml(aktuellesMailFrom)}" autocomplete="off" placeholder="${escHtml(HU.assistent_mail_from_hilfe ?? '')}"></label>` +
        `<hr>` +
        `<label>${escHtml(HU.assistent_mail_empfaenger_bezeichnung ?? 'Test-Empfänger')}<br>` +
        `<input id="testEmpfaenger" type="email" maxlength="254" autocomplete="off"></label>` +
        `<p><button class="knopf" type="button" id="mail-test-btn">${escHtml(HU.assistent_mail_test_senden ?? 'Test-Mail senden')}</button></p>` +
        `<p id="mail-test-meldung" role="status"></p>` +
        `<script>(function(){` +
        `var csrf='${escJs(csrf)}';` +
        `var btn=document.getElementById('mail-test-btn');` +
        `var meld=document.getElementById('mail-test-meldung');` +
        `var tested=false;` +
        `var msgs={empfaenger_fehler:'${escJs(HU.assistent_mail_test_empfaenger_fehler)}',kein_absender:'${escJs(HU.assistent_mail_test_kein_absender)}',allgemein:'${escJs(HU.assistent_mail_test_allgemein)}',csrf_fehler:'${escJs(HU.assistent_mail_test_allgemein)}',limit:'${escJs(HU.assistent_mail_test_limit)}',eingabe_fehler:'${escJs(HU.assistent_mail_test_eingabe_fehler)}',kein_schluessel:'${escJs(HU.assistent_mail_test_kein_schluessel ?? '')}',ok:'${escJs(HU.assistent_mail_test_ok ?? '')}',schluessel_abgelehnt:'${escJs(HU.assistent_mail_test_schluessel_abgelehnt ?? '')}',absender_abgelehnt:'${escJs(HU.assistent_mail_test_absender_abgelehnt ?? '')}',limit_erreicht:'${escJs(HU.assistent_mail_test_limit_erreicht ?? '')}',timeout:'${escJs(HU.assistent_mail_test_timeout ?? '')}',netzwerk_fehler:'${escJs(HU.assistent_mail_test_netzwerk_fehler ?? '')}'};` +
        `btn.addEventListener('click',function(){` +
        `var to=document.getElementById('testEmpfaenger').value.trim();` +
        `if(!to){meld.textContent=msgs.empfaenger_fehler;return;}` +
        `btn.disabled=true;meld.textContent='';` +
        `fetch('/admin/einrichtung/mail-test',{method:'POST',headers:{'Content-Type':'application/json','X-Csrf-Token':csrf},body:JSON.stringify({testEmpfaenger:to})})` +
        `.then(function(r){return r.json().catch(function(){return{fehler:'allgemein'};}).then(function(d){return{ok:r.ok,d:d||{}};});})` +
        `.then(function(r){if(r.ok&&r.d.ok){tested=true;meld.textContent=msgs.ok;}else{meld.textContent=r.d.meldung||msgs[r.d.fehler]||msgs.allgemein;}btn.disabled=false;})` +
        `.catch(function(){meld.textContent=msgs.netzwerk_fehler;btn.disabled=false;});` +
        `});` +
        `var form=document.querySelector('form');` +
        `if(form){form.addEventListener('submit',function(e){` +
        `var aktion=(document.activeElement&&document.activeElement.name==='aktion')?document.activeElement.value:'';` +
        `if(aktion==='ohne_mail'||aktion==='key_loeschen')return;` +
        `if(!tested&&!confirm('${escJs(HU.assistent_mail_warnung_ungetestet ?? '')}'))e.preventDefault();` +
        `});}` +
        `})();</script>`;

      schaltflaechen =
        `<button class="knopf" type="submit">${escHtml(HU.assistent_weiter ?? 'Weiter')}</button> ` +
        `<button class="knopf" type="submit" name="aktion" value="ohne_mail">${escHtml(HU.assistent_mail_ohne ?? 'Ohne E-Mail fortfahren')}</button>` +
        (keyGesetzt ? ` <button class="knopf" type="submit" name="aktion" value="key_loeschen">${escHtml(HU.assistent_mail_key_loeschen ?? 'Mail ausschalten (Schlüssel löschen)')}</button>` : '');
    } else if (n === 4) {
      // WP8: Schritt 4 — Stripe-Zahlungsverbindung (nur Testmodus)
      const aktuellerStripeKey = leseStripeKey();
      const aktuellerWebhookSecret = leseWebhookSecretGespeichert();
      const keysGesetzt = !!(aktuellerStripeKey && aktuellerWebhookSecret);

      let keyAbschnitt;
      if (aktuellerStripeKey) {
        keyAbschnitt =
          `<p>${escHtml(HU.assistent_stripe_key_maskiert ?? 'Schlüssel gespeichert:')} <code>${escHtml(maskiereGeheimnis(aktuellerStripeKey))}</code></p>` +
          `<details><summary>${escHtml(HU.assistent_stripe_key_ersetzen ?? 'Schlüssel ersetzen')}</summary>` +
          `<label>${escHtml(HU.assistent_stripe_key_bezeichnung ?? 'Geheimer Stripe-Testschlüssel')}<br>` +
          `<input aria-describedby="einr-stripe-key-hilfe" name="STRIPE_SECRET_KEY" type="password" maxlength="120" autocomplete="off"></label>` +
          `<p class="feldhilfe" id="einr-stripe-key-hilfe">${escHtml(HU.assistent_stripe_key_hilfe)}</p>` +
          `</details>`;
      } else {
        keyAbschnitt =
          `<label>${escHtml(HU.assistent_stripe_key_bezeichnung ?? 'Geheimer Stripe-Testschlüssel')}<br>` +
          `<input aria-describedby="einr-stripe-key-hilfe" name="STRIPE_SECRET_KEY" type="password" maxlength="120" autocomplete="off"></label>` +
          `<p class="feldhilfe" id="einr-stripe-key-hilfe">${escHtml(HU.assistent_stripe_key_hilfe)}</p>`;
      }

      let webhookAbschnitt;
      if (aktuellerWebhookSecret) {
        webhookAbschnitt =
          `<p>${escHtml(HU.assistent_stripe_webhook_maskiert ?? 'Webhook-Geheimnis gespeichert:')} <code>${escHtml(maskiereGeheimnis(aktuellerWebhookSecret))}</code></p>` +
          `<details><summary>${escHtml(HU.assistent_stripe_webhook_ersetzen ?? 'Webhook-Geheimnis ersetzen')}</summary>` +
          `<label>${escHtml(HU.assistent_stripe_webhook_bezeichnung ?? 'Webhook-Geheimnis')}<br>` +
          `<input aria-describedby="einr-webhook-hilfe" name="STRIPE_WEBHOOK_SECRET" type="password" maxlength="120" autocomplete="off"></label>` +
          `<p class="feldhilfe" id="einr-webhook-hilfe">${escHtml(HU.assistent_stripe_webhook_hilfe)}</p>` +
          `</details>`;
      } else {
        webhookAbschnitt =
          `<label>${escHtml(HU.assistent_stripe_webhook_bezeichnung ?? 'Webhook-Geheimnis')}<br>` +
          `<input aria-describedby="einr-webhook-hilfe" name="STRIPE_WEBHOOK_SECRET" type="password" maxlength="120" autocomplete="off"></label>` +
          `<p class="feldhilfe" id="einr-webhook-hilfe">${escHtml(HU.assistent_stripe_webhook_hilfe)}</p>`;
      }

      const webhookAdresse = `${konfig.baseUrl}/webhook`;
      const ereignisListe = Array.isArray(WEBHOOK_EREIGNISSE)
        ? WEBHOOK_EREIGNISSE.map(e => `<li><code>${escHtml(e)}</code></li>`).join('')
        : '';

      const stripeAktionen =
        (keysGesetzt ? `<p role="status" id="stripe-teststatus"><strong>${escHtml(HU.assistent_stripe_gespeichert_ungetestet)}</strong></p>` : '') +
        `<button class="knopf" type="submit">${escHtml(HU.assistent_weiter ?? 'Weiter')}</button>` +
        `<p><button class="knopf-sekundaer" type="button" id="stripe-verbindung-btn">${escHtml(HU.assistent_stripe_verbindung_testen ?? 'Verbindung testen')}</button></p>` +
        (keysGesetzt ? '' : `<p class="feldhilfe">${escHtml(HU.assistent_stripe_test_hinweis)}</p>`) +
        (keysGesetzt ? ` <button class="knopf-sekundaer" type="submit" name="aktion" value="key_loeschen">${escHtml(HU.assistent_stripe_key_loeschen ?? 'Stripe-Verbindung trennen (Schlüssel löschen)')}</button>` : '');

      inhalt =
        `<p>${escHtml(HU.assistent_stripe_erklaerung ?? '')}</p>` +
        einrAnleitung('stripe') +
        keyAbschnitt +
        `<br>` +
        webhookAbschnitt +
        `<hr>` +
        `<p><strong>${escHtml(HU.assistent_stripe_webhook_adresse_bezeichnung ?? 'Webhook-Adresse:')}</strong><br>` +
        `<code id="stripe-webhook-adresse">${escHtml(webhookAdresse)}</code></p>` +
        (ereignisListe ? `<details><summary>${escHtml(HU.assistent_stripe_webhook_ereignisse)}</summary><ul>${ereignisListe}</ul></details>` : '') +
        `<p id="stripe-webhook-ungeprueft-hinweis">${escHtml(HU.assistent_stripe_webhook_ungeprueft ?? '')}</p>` +
        stripeAktionen +
        `<p id="stripe-verbindung-meldung" role="status"></p>` +
        `<script>(function(){` +
        `var csrf='${escJs(csrf)}';` +
        `var btn=document.getElementById('stripe-verbindung-btn');` +
        `var meld=document.getElementById('stripe-verbindung-meldung');` +
        `var teststatus=document.getElementById('stripe-teststatus');` +
        `var tested=false;` +
        `var msgs={ok:'${escJs(HU.assistent_stripe_verbindung_ok ?? '')}',kein_schluessel:'${escJs(HU.assistent_stripe_verbindung_kein_schluessel ?? '')}',schluessel_abgelehnt:'${escJs(HU.assistent_stripe_verbindung_schluessel_abgelehnt ?? '')}',stripe_fehler:'${escJs(HU.assistent_stripe_verbindung_stripe_fehler ?? '')}',timeout:'${escJs(HU.assistent_stripe_verbindung_timeout ?? '')}',netzwerk_fehler:'${escJs(HU.assistent_stripe_verbindung_netzwerk_fehler ?? '')}',webhook_fehler:'${escJs(HU.assistent_stripe_verbindung_webhook_fehler ?? '')}',limit:'${escJs(HU.assistent_stripe_verbindung_limit ?? '')}'};` +
        `btn.addEventListener('click',function(){` +
        `btn.disabled=true;meld.textContent='';` +
        `fetch('/admin/einrichtung/stripe-verbindung',{method:'POST',headers:{'Content-Type':'application/json','X-Csrf-Token':csrf},body:JSON.stringify({})})` +
        `.then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});})` +
        `.then(function(r){if(r.ok&&r.d.ok){tested=true;meld.textContent=msgs.ok;if(teststatus)teststatus.textContent=msgs.ok;}else{meld.textContent=r.d.meldung||msgs[r.d.fehler]||'';}btn.disabled=false;})` +
        `.catch(function(){meld.textContent=msgs.netzwerk_fehler;btn.disabled=false;});` +
        `});` +
        `function zeigeStepupDialog(danach){` +
        `var ol=document.createElement('div');ol.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:999';` +
        `var box=document.createElement('div');box.className='karte';box.style.maxWidth='28em';box.style.width='90%';` +
        `var p=document.createElement('p');p.textContent='${escJs(HU.stepup_noetig ?? 'Biztonsági megerősítés szükséges.')}';` +
        `var pw=document.createElement('input');pw.type='password';pw.autocomplete='current-password';pw.style.width='100%';pw.style.marginTop='0.5em';` +
        `var err=document.createElement('p');err.style.color='red';err.style.minHeight='1.5em';` +
        `var zeile=document.createElement('div');zeile.style.display='flex';zeile.style.gap='0.5em';zeile.style.marginTop='0.75em';` +
        `var okBtn=document.createElement('button');okBtn.type='button';okBtn.className='knopf';okBtn.textContent='OK';` +
        `var abbBtn=document.createElement('button');abbBtn.type='button';abbBtn.className='knopf hell';abbBtn.textContent='${escJs(HU.a_megse ?? 'Mégse')}';` +
        `abbBtn.addEventListener('click',function(){ol.remove();});` +
        `okBtn.addEventListener('click',function(){` +
        `if(!pw.value)return;okBtn.disabled=true;err.textContent='';` +
        `fetch('/api/admin/stepup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passwort:pw.value})})` +
        `.then(function(r){if(r.ok)return r.json().then(function(){ol.remove();danach();});return r.text().then(function(t){okBtn.disabled=false;err.textContent=t||'Hiba';pw.value='';if(r.status===429){ol.remove();}else{pw.focus();}});})` +
        `.catch(function(){okBtn.disabled=false;err.textContent=msgs.netzwerk_fehler;pw.value='';pw.focus();});` +
        `});` +
        `zeile.append(okBtn,abbBtn);box.append(p,pw,err,zeile);ol.append(box);document.body.append(ol);pw.focus();` +
        `}` +
        `function submitieren(aktion){` +
        `var fd=new FormData(form);` +
        `if(aktion)fd.set('aktion',aktion);` +
        `fetch(form.action,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fd).toString(),redirect:'follow'})` +
        `.then(function(r){` +
        `if(r.status===401)return r.text().then(function(t){if(t.trim()==='stepup_noetig')zeigeStepupDialog(function(){submitieren(aktion);});});` +
        `if(r.ok){location.href=r.url;return;}` +
        `r.text().then(function(t){meld.textContent=t||msgs.netzwerk_fehler;});` +
        `})` +
        `.catch(function(){meld.textContent=msgs.netzwerk_fehler;});` +
        `}` +
        `var form=document.querySelector('form');` +
        `if(form){form.addEventListener('submit',function(e){` +
        `e.preventDefault();` +
        `var aktion=(document.activeElement&&document.activeElement.name==='aktion')?document.activeElement.value:'';` +
        `if(!aktion&&!tested&&!confirm('${escJs(HU.assistent_stripe_webhook_ungeprueft ?? '')}'))return;` +
        `submitieren(aktion);` +
        `});}` +
        `})();</script>`;

      schaltflaechen = '';
    } else if (n === 5) {
      // WP9: Schritt 5 — Erster Kurs (optional)
      holeEinrichtungId();
      const vorhandenerJson = leseEinstellung('erster_kurs_json');
      let vTitel = '', vBeschreibung = '', vPreis = '', vWaehrung = 'huf';
      if (vorhandenerJson) {
        try {
          const vd = JSON.parse(vorhandenerJson);
          vTitel = String(vd.titel ?? '');
          vBeschreibung = String(vd.beschreibung ?? '');
          vPreis = String(vd.preis_cent ?? '');
          vWaehrung = vd.waehrung === 'eur' ? 'eur' : 'huf';
        } catch { /* ungueltig, ignorieren */ }
      }
      inhalt =
        `<p>${escHtml(HU.assistent_kurs_erklaerung ?? '')}</p>` +
        `<label for="kurs_titel">${escHtml(HU.assistent_kurs_titel_bezeichnung ?? 'Kursname')}</label>` +
        `<small>${escHtml(HU.assistent_kurs_titel_hilfe ?? '')}</small>` +
        `<input id="kurs_titel" name="kurs_titel" type="text" maxlength="200" value="${escHtml(vTitel)}" autocomplete="off">` +
        `<label for="kurs_beschreibung">${escHtml(HU.assistent_kurs_beschreibung_bezeichnung ?? '')}</label>` +
        `<textarea id="kurs_beschreibung" name="kurs_beschreibung" maxlength="5000" rows="3">${escHtml(vBeschreibung)}</textarea>` +
        `<label for="kurs_preis">${escHtml(HU.assistent_kurs_preis_bezeichnung ?? '')}</label>` +
        `<small>${escHtml(HU.assistent_kurs_preis_hilfe ?? '')}</small>` +
        `<input id="kurs_preis" name="kurs_preis" type="number" min="0" max="${KURS_MAX_PREIS}" step="1" value="${escHtml(vPreis)}" autocomplete="off">` +
        `<label for="kurs_waehrung">${escHtml(HU.assistent_kurs_waehrung_bezeichnung ?? '')}</label>` +
        `<select id="kurs_waehrung" name="kurs_waehrung">` +
        `<option value="huf"${vWaehrung === 'huf' ? ' selected' : ''}>Forint (HUF)</option>` +
        `<option value="eur"${vWaehrung === 'eur' ? ' selected' : ''}>Euro (EUR)</option>` +
        `</select>`;
      schaltflaechen =
        `<button class="knopf" type="submit">${escHtml(HU.assistent_weiter ?? 'Weiter')}</button>` +
        ` <button class="knopf" type="submit" name="aktion" value="ueberspringen">${escHtml(HU.assistent_kurs_ueberspringen ?? 'Überspringen')}</button>`;
    } else if (n === 6) {
      const schluesselAusEnv = !!optionen.schluesselAusEnv;
      const schritt3ok = istFertig(3) || leseEinstellung('einrichtung_schritt_3') === 'fertig';
      const schritt4ok = istFertig(4);
      const bereit = schritt3ok && schritt4ok;

      const schrittListe = [];
      for (let s = 1; s <= SCHRITTE; s++) {
        const sf = istFertig(s);
        const tKey = `assistent_schritt_${s}_titel`;
        const label = HU[tKey] ?? `Schritt ${s}`;
        schrittListe.push(`<li>${sf ? (HU.assistent_fertig_haken ?? '&#10003;') + ' ' : ''}${escHtml(label)}</li>`);
      }

      const reparaturHinweis = optionen.reparaturFehler
        ? `<p role="alert">${escHtml(HU.assistent_reparatur_erklaerung ?? '')}</p>`
        : '';

      // schluesselBereich: separate top-level form for /schluessel-anzeigen, never nested inside schritt/6 form
      let schluesselBereich;
      if (schluesselAusEnv) {
        schluesselBereich = `<p>${escHtml(HU.assistent_schluessel_env_erklaerung ?? '')}</p>`;
      } else if (leseEinstellung('schluessel_angezeigt') === '1') {
        schluesselBereich = `<p>${escHtml(HU.assistent_schluessel_bereits_angezeigt ?? '')}</p>`;
      } else {
        schluesselBereich =
          `<p>${escHtml(HU.assistent_schluessel_erklaerung ?? '')}</p>` +
          `<p><strong>${escHtml(HU.assistent_schluessel_einmal_hinweis ?? '')}</strong></p>` +
          `<form method="POST" action="/admin/einrichtung/schluessel-anzeigen">` +
          `<input type="hidden" name="csrf_token" value="${csrf}">` +
          `<label>${escHtml(HU.assistent_schluessel_passwort_bezeichnung ?? 'Passwort')}<br>` +
          `<input name="passwort" type="password" maxlength="200" required autocomplete="current-password"></label>` +
          `<button class="knopf-sekundaer" type="submit">${escHtml(HU.assistent_schluessel_anzeigen ?? '')}</button>` +
          `</form>`;
      }

      // abschlussInhalt: exactly ONE checkbox (name="schluessel_gesichert") when key was shown
      let abschlussInhalt;
      if (!bereit) {
        abschlussInhalt =
          `<p role="alert">${escHtml(HU.assistent_abschluss_pflicht_fehlt ?? '')}</p>` +
          `<p class="hinweis">${escHtml(HU.assistent_abschluss_gesperrt_hinweis)}</p>`;
      } else if (schluesselAusEnv) {
        abschlussInhalt = `<button class="knopf" type="submit">${escHtml(HU.assistent_abschluss_button ?? 'Abschließen')}</button>`;
      } else if (leseEinstellung('schluessel_angezeigt') === '1') {
        abschlussInhalt =
          `<label><input type="checkbox" name="schluessel_gesichert" value="1"> ${escHtml(HU.assistent_schluessel_gesichert_bezeichnung ?? '')}</label><br>` +
          `<button class="knopf" type="submit">${escHtml(HU.assistent_abschluss_button ?? 'Abschließen')}</button>`;
      } else {
        abschlussInhalt = `<p class="hinweis">${escHtml(HU.assistent_abschluss_gesperrt_hinweis)}</p>`;
      }

      const berichtItems6 = abschlussPruefungen({ schluesselAusEnv, schluesselGesichert: false });
      const berichtHtml6 = einrPruefliste(berichtItems6);
      return res.type('text/html; charset=utf-8').send(
        kopf(escHtml(fortschritt + ' – ' + titel), lang) +
        sprachumschalter(req) +
        einrSchrittkopf(n, titel) +
        (fertig ? `<p>${HU.assistent_fertig_haken ?? '✓'}</p>` : '') +
        reparaturHinweis +
        ((bereit && !berichtItems6.some(it => it.pflicht && it.status === 'rot' && it.id !== 'schluessel')) ? `<p>${escHtml(HU.assistent_abschluss_erklaerung ?? '')}</p>` : '') +
        `<ul>${schrittListe.join('')}</ul>` +
        berichtHtml6 +
        schluesselBereich +
        `<form method="POST" action="/admin/einrichtung/schritt/${n}">` +
        `<input type="hidden" name="csrf_token" value="${csrf}">` +
        abschlussInhalt +
        `</form>` +
        `<form method="POST" action="/admin/einrichtung/abmelden">` +
        `<input type="hidden" name="csrf_token" value="${csrf}">` +
        `<button class="einr-textlink" type="submit">${HU.assistent_abmelden ?? 'Abmelden'}</button></form>` +
        einrNavigation(n) +
        fuss()
      );
    } else {
      inhalt = `<p>${HU.assistent_folgt ?? 'Folgt.'}</p>`;
    }

    res.type('text/html; charset=utf-8').send(
      kopf(escHtml(fortschritt + ' – ' + titel), lang) +
      sprachumschalter(req) +
      einrSchrittkopf(n, titel) +
      (fertig ? `<p>${HU.assistent_fertig_haken ?? '✓'}</p>` : '') +
      `<form method="POST" action="/admin/einrichtung/schritt/${n}">` +
      `<input type="hidden" name="csrf_token" value="${csrf}">` +
      inhalt +
      `${schaltflaechen ?? `<button class="knopf" type="submit">${HU.assistent_weiter ?? 'Weiter'}</button>`}</form>` +
      `<form method="POST" action="/admin/einrichtung/abmelden">` +
      `<input type="hidden" name="csrf_token" value="${csrf}">` +
      `<button class="einr-textlink" type="submit">${HU.assistent_abmelden ?? 'Abmelden'}</button></form>` +
      einrNavigation(n) +
      fuss()
    );
  });

  // POST /admin/einrichtung/schritt/:n (Baustein 4+5+7)
  router.post('/schritt/:n', (req, res) => {
    sicherheitsheader(res);
    const n = parseInt(req.params.n, 10);
    if (!n || n < 1 || n > SCHRITTE) return fehler(req, res, 404, 'nicht_gefunden', n);

    // Baustein 5: Origin-Pruefung (kein Header = durchlassen, falscher Header = 403)
    const origin = req.headers['origin'];
    if (origin && origin !== konfig.baseUrl) {
      return fehler(req, res, 403, HU.assistent_csrf_fehler ?? 'csrf_fehler', n);
    }

    // Baustein 4: CSRF-Pruefung
    if (!pruefeCsrf(req)) {
      return fehler(req, res, 403, HU.assistent_csrf_fehler ?? 'csrf_fehler', n);
    }

    // WP5: Schritt 1 — PLATTFORM_NAME speichern
    if (n === 1) {
      const rohName = String(req.body?.PLATTFORM_NAME ?? '').trim();
      const name = rohName || STANDARD_PLATTFORM_NAME;
      const nameFehler = pruefePlattformName(name);
      if (nameFehler) {
        return fehler(req, res, 400, HU.assistent_name_fehler ?? 'name_fehler', n);
      }
      schreibePlattformName(name);
    }

    // WP6: Schritt 2 — Impressum, Datenschutz, Teilnahmebedingungen speichern
    if (n === 2) {
      const seitenInfo = [
        { schluessel: 'impressum',            modusFeld: 'modus_impressum',           urlFeld: 'impressum_url',           urlSchluessel: 'IMPRESSUM_URL',           eigenPfad: '/jogi/impresszum'            },
        { schluessel: 'datenschutz',          modusFeld: 'modus_datenschutz',         urlFeld: 'datenschutz_url',         urlSchluessel: 'DATENSCHUTZ_URL',         eigenPfad: '/jogi/adatvedelem'           },
        { schluessel: 'teilnahmebedingungen', modusFeld: 'modus_teilnahmebedingungen',urlFeld: 'teilnahmebedingungen_url',urlSchluessel: 'TEILNAHMEBEDINGUNGEN_URL',eigenPfad: '/jogi/reszveteli-feltetelek' },
      ];
      // Punkt 1 + Punkt 3: alle drei Modusfelder müssen vorhanden und erlaubt sein
      const ERLAUBTE_MODI = new Set(['erstellt', 'eigene_url']);
      for (const { modusFeld } of seitenInfo) {
        const v = req.body?.[modusFeld];
        if (v === undefined || !ERLAUBTE_MODI.has(v)) {
          return fehler(req, res, 400, HU.assistent_recht_modus_fehler ?? 'modus_fehler', n);
        }
      }
      const seitenModi = [];
      for (const info of seitenInfo) {
        const modus = req.body[info.modusFeld];
        const url = modus === 'eigene_url' ? String(req.body?.[info.urlFeld] ?? '').trim() : '';
        if (modus === 'eigene_url') {
          const erg = validiereRechtUrl(url);
          if (erg === 'ungueltig' || erg === 'leer') {
            return fehler(req, res, 400, HU.assistent_recht_url_fehler ?? 'url_fehler', n);
          }
        }
        seitenModi.push({ ...info, modus, url });
      }
      const brauchtAnbieter = seitenModi.some(s => s.modus === 'erstellt');
      let anName, anAnschrift, anEmail, anTelefon, anAdoszam, anSteuer;
      if (brauchtAnbieter) {
        anName      = String(req.body?.ANBIETER_NAME      ?? '').trim();
        anAnschrift = String(req.body?.ANBIETER_ANSCHRIFT ?? '').trim();
        anEmail     = String(req.body?.ANBIETER_EMAIL     ?? '').trim();
        if (!anName || pruefeTextFeld(anName, 160))             return fehler(req, res, 400, HU.assistent_recht_pflicht_fehler ?? 'pflicht_fehler', n);
        if (!anAnschrift || pruefeTextFeld(anAnschrift, 240))   return fehler(req, res, 400, HU.assistent_recht_pflicht_fehler ?? 'pflicht_fehler', n);
        if (!anEmail || pruefeEmailFormat(anEmail) || pruefeTextFeld(anEmail, 254)) return fehler(req, res, 400, HU.assistent_recht_email_fehler ?? 'email_fehler', n);
        anTelefon = String(req.body?.ANBIETER_TELEFON ?? '').trim();
        anAdoszam = String(req.body?.ANBIETER_ADOSZAM ?? '').trim();
        anSteuer  = String(req.body?.STEUER_HINWEIS   ?? '').trim();
        if (anTelefon && pruefeTelefonFormat(anTelefon))  return fehler(req, res, 400, HU.assistent_recht_pflicht_fehler ?? 'pflicht_fehler', n);
        if (anAdoszam && pruefeTextFeld(anAdoszam, 60))   return fehler(req, res, 400, HU.assistent_recht_pflicht_fehler ?? 'pflicht_fehler', n);
        if (anSteuer  && pruefeTextFeld(anSteuer, 200))   return fehler(req, res, 400, HU.assistent_recht_pflicht_fehler ?? 'pflicht_fehler', n);
      }
      // Punkt 4: alle Schreibvorgänge + markiereAlsFertig(2) in einer Transaktion
      try {
        db.exec('BEGIN');
        if (brauchtAnbieter) {
          schreibeEinstellung('ANBIETER_NAME',      anName);
          schreibeEinstellung('ANBIETER_ANSCHRIFT', anAnschrift);
          schreibeEinstellung('ANBIETER_EMAIL',     anEmail);
          if (anTelefon) schreibeEinstellung('ANBIETER_TELEFON', anTelefon);
          if (anAdoszam) schreibeEinstellung('ANBIETER_ADOSZAM', anAdoszam);
          if (anSteuer)  schreibeEinstellung('STEUER_HINWEIS',   anSteuer);
        }
        // Punkt 2: recht_* und URL-Felder immer beide setzen (Moduswechsel-Synchronisation)
        for (const { schluessel, modus, url, urlSchluessel, eigenPfad } of seitenModi) {
          const erg = modus === 'eigene_url' ? validiereRechtUrl(url) : 'erstellt';
          if (erg === 'eigener_pfad' || modus === 'erstellt') {
            schreibeEinstellung(`recht_${schluessel}`, 'erstellt');
            schreibeEinstellung(urlSchluessel, eigenPfad);
          } else {
            schreibeEinstellung(`recht_${schluessel}`, url);
            schreibeEinstellung(urlSchluessel, url);
          }
        }
        markiereAlsFertig(n);
        db.exec('COMMIT');
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch {}
        return fehler(req, res, 500, 'speicher_fehler', n);
      }
      const naechster2 = n < SCHRITTE ? n + 1 : 1;
      return res.redirect(303, `/admin/einrichtung/schritt/${naechster2}`);
    }

    // WP7: Schritt 3 — RESEND_API_KEY + MAIL_FROM
    if (n === 3) {
      const aktion = String(req.body?.aktion ?? '');

      if (aktion === 'key_loeschen') {
        loescheResendKey();
        db.prepare("DELETE FROM einstellungen WHERE schluessel='einrichtung_schritt_3'").run();
        return res.redirect(303, '/admin/einrichtung/schritt/3');
      }

      if (aktion === 'ohne_mail') {
        loescheResendKey();
        db.prepare("DELETE FROM einstellungen WHERE schluessel='MAIL_FROM'").run();
        markiereAlsFertig(3);
        return res.redirect(303, '/admin/einrichtung/schritt/4');
      }

      const rohKey = String(req.body?.RESEND_API_KEY ?? '').trim();
      const mailFrom = String(req.body?.MAIL_FROM ?? '').trim();
      const vorhandenerKey = leseResendKey();
      const effektiverKey = rohKey || (vorhandenerKey ?? '');

      if (!effektiverKey) {
        return fehler(req, res, 400, 'schluessel_fehler', n);
      }

      const mailFromFehler = pruefeMailFromFormat(effektiverKey, mailFrom);
      if (mailFromFehler) {
        return fehler(req, res, 400, HU.assistent_mail_from_fehler ?? 'from_fehler', n);
      }

      try {
        db.exec('BEGIN');
        if (rohKey) schreibeResendKey(rohKey);
        schreibeEinstellung('MAIL_FROM', mailFrom);
        markiereAlsFertig(3);
        db.exec('COMMIT');
      } catch {
        try { db.exec('ROLLBACK'); } catch {}
        return fehler(req, res, 500, 'speicher_fehler', n);
      }

      return res.redirect(303, '/admin/einrichtung/schritt/4');
    }

    // WP8: Schritt 4 — STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
    if (n === 4) {
      // Protokoll-Antwort fuer den Step-up-Dialog der Seite (Skript prueft den Text): immer text/plain, nie als Fehlerseite
      if (!stepupGueltig(req)) return res.status(401).type('text/plain').send('stepup_noetig');
      const aktion = String(req.body?.aktion ?? '');

      if (aktion === 'key_loeschen') {
        try {
          db.exec('BEGIN');
          loescheStripeKeys();
          db.prepare("DELETE FROM einstellungen WHERE schluessel='einrichtung_schritt_4'").run();
          db.exec('COMMIT');
        } catch {
          try { db.exec('ROLLBACK'); } catch {}
          return fehler(req, res, 500, 'speicher_fehler', n);
        }
        return res.redirect(303, '/admin/einrichtung/schritt/4');
      }

      const rohStripeKey = String(req.body?.STRIPE_SECRET_KEY ?? '').trim();
      const rohWebhookSecret = String(req.body?.STRIPE_WEBHOOK_SECRET ?? '').trim();
      const vorhandenerStripeKey = leseStripeKey();
      const vorhandenerWebhookSecret = leseWebhookSecretGespeichert();
      const effektiverKey = rohStripeKey || (vorhandenerStripeKey ?? '');
      const effektiverWebhook = rohWebhookSecret || (vorhandenerWebhookSecret ?? '');

      // Live-Schlüssel abgelehnt (exakter Text laut Spezifikation)
      const keyLower = effektiverKey.toLowerCase();
      if (keyLower.startsWith('sk_live') || keyLower.startsWith('rk_live')) {
        return fehler(req, res, 400, HU.assistent_stripe_live_abgelehnt ?? 'Echte Zahlungen sind in dieser Version noch nicht freigeschaltet', n);
      }

      if (!effektiverKey || !istStripeTestKey(effektiverKey) || /[\x00-\x1f\x7f]/.test(effektiverKey)) {
        return fehler(req, res, 400, HU.assistent_stripe_key_format_fehler ?? 'schluessel_format_fehler', n);
      }

      if (!effektiverWebhook || !istWebhookSecret(effektiverWebhook) || /[\x00-\x1f\x7f]/.test(effektiverWebhook)) {
        return fehler(req, res, 400, HU.assistent_stripe_webhook_format_fehler ?? 'webhook_format_fehler', n);
      }

      // Hauptschlüssel vor der Transaktion sichern (kein File-I/O in Transaktion)
      if ((rohStripeKey || rohWebhookSecret) && !cachedHs) {
        if (!existsSync(SCHLUESSEL_PFAD)) {
          cachedHs = erzeugeHauptschluesselDatei(SCHLUESSEL_PFAD);
        } else {
          cachedHs = holeHauptschluessel({ env: {}, dateiPfad: SCHLUESSEL_PFAD, verschluesselteWerteVorhanden: verschluesselteWerteVorhanden(db) });
        }
      }

      try {
        db.exec('BEGIN');
        const speicher = oeffneEinstellungsSpeicher(db, { hauptschluessel: cachedHs });
        if (rohStripeKey) speicher.schreibe('STRIPE_SECRET_KEY', rohStripeKey);
        if (rohWebhookSecret) speicher.schreibe('STRIPE_WEBHOOK_SECRET', rohWebhookSecret);
        markiereAlsFertig(4);
        db.exec('COMMIT');
      } catch {
        try { db.exec('ROLLBACK'); } catch {}
        return fehler(req, res, 500, 'speicher_fehler', n);
      }

      return res.redirect(303, '/admin/einrichtung/schritt/5');
    }

    // WP9: Schritt 5 — Erster Kurs speichern oder ueberspringen
    if (n === 5) {
      const aktion = String(req.body?.aktion ?? '');

      if (aktion === 'ueberspringen') {
        try {
          db.exec('BEGIN');
          markiereAlsFertig(5);
          db.exec('COMMIT');
        } catch {
          try { db.exec('ROLLBACK'); } catch {}
          return fehler(req, res, 500, 'speicher_fehler', n);
        }
        return res.redirect(303, '/admin/einrichtung/schritt/6');
      }

      const rohTitel = String(req.body?.kurs_titel ?? '').trim();
      const rohBeschreibung = String(req.body?.kurs_beschreibung ?? '');
      const rohPreis = String(req.body?.kurs_preis ?? '').trim();
      const rohWaehrung = String(req.body?.kurs_waehrung ?? '').trim();

      if (!rohTitel || rohTitel.length > 200) {
        return fehler(req, res, 400, HU.assistent_kurs_titel_fehler ?? 'titel_fehler', n);
      }
      if (rohBeschreibung.length > 5000) {
        return fehler(req, res, 400, HU.assistent_kurs_beschreibung_bezeichnung ?? 'beschreibung_fehler', n);
      }
      const preisCent = Number.isInteger(Number(rohPreis)) ? parseInt(rohPreis, 10) : NaN;
      if (!Number.isSafeInteger(preisCent) || preisCent < 0 || preisCent > KURS_MAX_PREIS) {
        return fehler(req, res, 400, HU.assistent_kurs_preis_fehler ?? 'preis_fehler', n);
      }
      const waehrung = rohWaehrung === 'eur' ? 'eur' : (rohWaehrung === 'huf' ? 'huf' : null);
      if (!waehrung) {
        return fehler(req, res, 400, HU.assistent_kurs_preis_fehler ?? 'waehrung_fehler', n);
      }
      if (waehrung === 'huf' && preisCent % 100 !== 0) {
        return fehler(req, res, 400, HU.assistent_kurs_preis_huf_fehler ?? 'preis_huf_fehler', n);
      }

      const kursJson = JSON.stringify({ titel: rohTitel, beschreibung: rohBeschreibung, preis_cent: preisCent, waehrung });

      try {
        db.exec('BEGIN');
        holeEinrichtungId();
        schreibeEinstellung('erster_kurs_json', kursJson);
        markiereAlsFertig(5);
        db.exec('COMMIT');
      } catch {
        try { db.exec('ROLLBACK'); } catch {}
        return fehler(req, res, 500, 'speicher_fehler', n);
      }
      return res.redirect(303, '/admin/einrichtung/schritt/6');
    }

    // WP9: Schritt 6 — Abschluss (Zustandswechsel + Neustart)
    if (n === 6) {
      const schluesselAusEnv = !!optionen.schluesselAusEnv;

      // Konfigurations-Probelauf
      let probeKonfig;
      try {
        const probeSpeicher = cachedHs ? oeffneEinstellungsSpeicher(db, { hauptschluessel: cachedHs }) : null;
        probeKonfig = ladeKonfig(optionen.env ?? {}, { startZustand: 'KONFIGURIERT', speicher: probeSpeicher });
      } catch (e) {
        if (e instanceof KonfigFehler) {
          return fehler(req, res, 400, HU.assistent_abschluss_probelauf_fehler ?? 'probelauf_fehler', n);
        }
        throw e;
      }
      void probeKonfig;

      // Zustand auf KONFIGURIERT setzen
      try {
        db.exec('BEGIN IMMEDIATE');
        // Pflichtpruefung via abschlussPruefungen (G1a)
        const berichtItems = abschlussPruefungen({
          schluesselAusEnv,
          schluesselGesichert: req.body?.schluessel_gesichert === '1',
        });
        const pflichtRot = berichtItems.filter(it => it.pflicht && it.status === 'rot');
        if (pflichtRot.length > 0) {
          db.exec('ROLLBACK');
          return fehler(req, res, 400, HU.g1a_abschluss_pflicht_rot ?? 'pflicht_fehlt', n);
        }

        schreibeEinstellung('instanz_zustand', 'KONFIGURIERT');
        schreibeEinstellung('einrichtung_abgeschlossen_am', new Date().toISOString());
        markiereAlsFertig(6);
        db.exec('COMMIT');
      } catch {
        try { db.exec('ROLLBACK'); } catch {}
        return fehler(req, res, 500, 'speicher_fehler', n);
      }

      const lang = sprache();
      let hinweise = [];
      try {
        hinweise = abschlussPruefungen({
          schluesselAusEnv,
          schluesselGesichert: req.body?.schluessel_gesichert === '1',
        });
      } catch { hinweise = []; }
      if (optionen.aufpasser && typeof optionen.neustarten === 'function') {
        // AUFPASSER=1: Server beendet sich selbst, Aufsicht startet neu
        sicherheitsheader(res);
        res.type('text/html; charset=utf-8').send(abschlussSeite(lang, true, hinweise));
        res.once('finish', () => optionen.neustarten());
      } else {
        // Manueller Neustart: Anleitung + JS-Polling /health
        sicherheitsheader(res);
        res.type('text/html; charset=utf-8').send(abschlussSeite(lang, false, hinweise));
      }
      return;
    }

    markiereAlsFertig(n);

    const naechster = n < SCHRITTE ? n + 1 : 1;
    res.redirect(303, `/admin/einrichtung/schritt/${naechster}`);
  });

  // POST /admin/einrichtung/logo-upload (WP5: octet-stream PNG-Upload)
  router.post('/logo-upload',
    express.raw({ type: 'application/octet-stream', limit: LOGO_MAX_BYTES + 1 }),
    (req, res) => {
      sicherheitsheader(res);

      // Origin-Pruefung
      const origin = req.headers['origin'];
      if (origin && origin !== konfig.baseUrl) {
        return res.status(403).json({ meldung: HU.assistent_csrf_fehler ?? 'csrf_fehler' });
      }

      // CSRF aus Header (body ist Binärdaten)
      if (!pruefeCsrfHeader(req)) {
        return res.status(403).json({ meldung: HU.assistent_csrf_fehler ?? 'csrf_fehler' });
      }

      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        return res.status(400).json({ meldung: HU.assistent_logo_fehler ?? 'logo_fehler' });
      }

      const fehler = pruefePng(buf);
      if (fehler === 'png_zu_gross') {
        return res.status(413).json({ meldung: HU.assistent_logo_zu_gross ?? 'zu_gross' });
      }
      if (fehler === 'png_kein_png') {
        return res.status(400).json({ meldung: HU.assistent_logo_kein_png ?? 'kein_png' });
      }
      if (fehler === 'png_abmessung_ungueltig') {
        return res.status(400).json({ meldung: HU.assistent_logo_abmessung ?? 'abmessung' });
      }
      if (fehler) {
        return res.status(400).json({ meldung: HU.assistent_logo_fehler ?? 'logo_fehler' });
      }

      try {
        speichereLogo(buf, logoPfad);
      } catch {
        return res.status(500).json({ meldung: HU.assistent_logo_fehler ?? 'logo_fehler' });
      }

      res.status(200).json({ ok: true, meldung: HU.assistent_logo_gespeichert ?? 'gespeichert' });
    }
  );

  // POST /admin/einrichtung/mail-test (WP7: AJAX Test-Mail, kein Retry)
  router.post('/mail-test',
    express.json({ limit: '1kb' }),
    async (req, res) => {
      sicherheitsheader(res);

      const origin = req.headers['origin'];
      if (origin && origin !== konfig.baseUrl) {
        return res.status(403).json({ fehler: 'csrf_fehler' });
      }

      if (!pruefeCsrfHeader(req)) {
        return res.status(403).json({ fehler: 'csrf_fehler' });
      }

      const to = String(req.body?.testEmpfaenger ?? '').trim();
      if (!to || pruefeEmailFormat(to) || to.length > 254) {
        return res.status(400).json({ fehler: 'empfaenger_fehler' });
      }

      const apiKey = leseResendKey();
      if (!apiKey) {
        return res.status(400).json({ fehler: 'kein_schluessel' });
      }

      const mailFrom = leseEinstellung('MAIL_FROM');
      if (!mailFrom) {
        return res.status(400).json({ fehler: 'kein_absender' });
      }

      const jetzt = Date.now();
      if (jetzt - mailTestAbklingzeit.letzte < 10000) {
        return res.status(429).json({ fehler: 'limit', meldung: HU.assistent_mail_test_limit ?? '' });
      }
      if (jetzt - mailTestAbklingzeit.stundeBeginn > 3600000) {
        mailTestAbklingzeit.zaehler = 0;
        mailTestAbklingzeit.stundeBeginn = jetzt;
      }
      if (mailTestAbklingzeit.zaehler >= 10) {
        return res.status(429).json({ fehler: 'limit', meldung: HU.assistent_mail_test_limit ?? '' });
      }
      mailTestAbklingzeit.letzte = jetzt;
      mailTestAbklingzeit.zaehler++;

      const idempotencyKey = randomBytes(16).toString('hex');
      const ergebnis = await mailTesten({ apiKey, from: mailFrom, to, ueberschreibName: leseEinstellung('MAIL_ABSENDER_NAME'), idempotencyKey, resendUrl: konfig.resendUrl });

      if (ergebnis.ok) {
        return res.json({ ok: true, meldung: HU.assistent_mail_test_ok ?? '' });
      }

      const fehlertexte = {
        schluessel_abgelehnt: HU.assistent_mail_test_schluessel_abgelehnt ?? '',
        absender_abgelehnt: HU.assistent_mail_test_absender_abgelehnt ?? '',
        eingabe_fehler: HU.assistent_mail_test_eingabe_fehler ?? '',
        limit_erreicht: HU.assistent_mail_test_limit_erreicht ?? '',
        timeout: HU.assistent_mail_test_timeout ?? '',
        netzwerk_fehler: HU.assistent_mail_test_netzwerk_fehler ?? '',
      };
      return res.json({ fehler: ergebnis.fehler, meldung: fehlertexte[ergebnis.fehler] ?? '' });
    }
  );

  // POST /admin/einrichtung/stripe-verbindung (WP8: AJAX Verbindungstest)
  router.post('/stripe-verbindung',
    express.json({ limit: '1kb' }),
    async (req, res) => {
      sicherheitsheader(res);

      const origin = req.headers['origin'];
      if (origin && origin !== konfig.baseUrl) {
        return res.status(403).json({ fehler: 'csrf_fehler' });
      }

      if (!pruefeCsrfHeader(req)) {
        return res.status(403).json({ fehler: 'csrf_fehler' });
      }

      const apiKey = leseStripeKey();
      const webhookSecr = leseWebhookSecretGespeichert();
      if (!apiKey || !webhookSecr) {
        return res.status(400).json({ fehler: 'kein_schluessel', meldung: HU.assistent_stripe_verbindung_kein_schluessel ?? '' });
      }

      const jetzt = Date.now();
      if (jetzt - stripeTestAbklingzeit.letzte < 10000) {
        return res.status(429).json({ fehler: 'limit', meldung: HU.assistent_stripe_verbindung_limit ?? '' });
      }
      if (jetzt - stripeTestAbklingzeit.stundeBeginn > 3600000) {
        stripeTestAbklingzeit.zaehler = 0;
        stripeTestAbklingzeit.stundeBeginn = jetzt;
      }
      if (stripeTestAbklingzeit.zaehler >= 10) {
        return res.status(429).json({ fehler: 'limit', meldung: HU.assistent_stripe_verbindung_limit ?? '' });
      }
      stripeTestAbklingzeit.letzte = jetzt;
      stripeTestAbklingzeit.zaehler++;

      const verbErgebnis = await stripeVerbindungTesten({
        stripeSecretKey: apiKey,
        stripeOptionen: konfig.stripeOptionen ?? {},
      });
      if (!verbErgebnis.ok) {
        const fehlertexte = {
          schluessel_abgelehnt: HU.assistent_stripe_verbindung_schluessel_abgelehnt ?? '',
          stripe_fehler: HU.assistent_stripe_verbindung_stripe_fehler ?? '',
          timeout: HU.assistent_stripe_verbindung_timeout ?? '',
          netzwerk_fehler: HU.assistent_stripe_verbindung_netzwerk_fehler ?? '',
        };
        return res.json({ fehler: verbErgebnis.fehler, meldung: fehlertexte[verbErgebnis.fehler] ?? '' });
      }

      return res.json({ ok: true, meldung: HU.assistent_stripe_verbindung_ok ?? '' });
    }
  );

  // POST /admin/einrichtung/schluessel-anzeigen (WP9: Wiederherstellungsschluessel einmalig anzeigen)
  router.post('/schluessel-anzeigen',
    express.urlencoded({ extended: false, limit: '4kb' }),
    async (req, res) => {
      sicherheitsheader(res);

      const origin = req.headers['origin'];
      if (origin && origin !== konfig.baseUrl) {
        return fehler(req, res, 403, HU.assistent_csrf_fehler ?? 'csrf_fehler', 6);
      }
      if (!pruefeCsrf(req)) {
        return fehler(req, res, 403, HU.assistent_csrf_fehler ?? 'csrf_fehler', 6);
      }

      const passwort = String(req.body?.passwort ?? '');
      const row = db.prepare('SELECT passwort_hash FROM benutzer WHERE rolle=? LIMIT 1').get('admin');
      if (!row) return fehler(req, res, 403, HU.assistent_schluessel_passwort_fehler ?? 'passwort_fehler', 6);
      // F-63: Brute-Force-Schutz — Zaehler vor dem Hash inkrementieren und danach nochmals pruefen.
      const bf63schluessel = req.ip + '|schluessel-anzeigen';
      if (gesperrt(bf63schluessel)) return fehler(req, res, 429, HU.zu_viele_versuche ?? 'zu_viele_versuche', 6);
      fehlversuchMerken(bf63schluessel);
      if (gesperrt(bf63schluessel)) return fehler(req, res, 429, HU.zu_viele_versuche ?? 'zu_viele_versuche', 6);
      const korrekt = await passwortPruefen(passwort, row.passwort_hash);
      if (!korrekt) {
        return fehler(req, res, 403, HU.assistent_schluessel_passwort_fehler ?? 'passwort_fehler', 6);
      }
      fehlversucheLoeschen(bf63schluessel);

      if (!cachedHs) {
        return fehler(req, res, 500, 'schluessel_fehler', 6);
      }

      // BEGIN IMMEDIATE: atomische Einmal-Anzeige sicherstellen
      let code;
      try {
        db.exec('BEGIN IMMEDIATE');
        const bereits = db.prepare("SELECT wert FROM einstellungen WHERE schluessel='schluessel_angezeigt'").get();
        if (bereits?.wert === '1') {
          db.exec('COMMIT');
          return fehler(req, res, 409, HU.assistent_schluessel_bereits_angezeigt ?? 'bereits_angezeigt', 6);
        }
        code = schluesselAlsCode(cachedHs);
        db.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES ('schluessel_angezeigt', '1', 0, datetime('now'))").run();
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch {}
        return fehler(req, res, 500, 'speicher_fehler', 6);
      }

      // Schluessel niemals loggen; no-store damit Browser nicht cached
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'same-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const lang = sprache();
      const gruppen = code.split('-');
      const codeHtml = gruppen.map(g => `<code>${escHtml(g)}</code>`).join('-');
      res.type('text/html; charset=utf-8').send(
        kopf(HU.assistent_schluessel_anzeigen ?? 'Wiederherstellungscode', lang) +
        `<p><strong>${escHtml(HU.assistent_schluessel_einmal_hinweis ?? '')}</strong></p>` +
        `<p>${escHtml(HU.assistent_schluessel_erklaerung_code ?? '')}</p>` +
        `<p style="font-size:1.2em;letter-spacing:0.1em;word-break:break-all">${codeHtml}</p>` +
        `<p><a href="/admin/einrichtung/schritt/6">${escHtml(HU.assistent_zurueck ?? 'Zurück')}</a></p>` +
        fuss()
      );
    }
  );

  // POST /admin/einrichtung/abmelden
  router.post('/abmelden', (req, res) => {
    sicherheitsheader(res);

    // Baustein 5: Origin-Pruefung
    const origin = req.headers['origin'];
    if (origin && origin !== konfig.baseUrl) {
      return fehler(req, res, 403, HU.assistent_csrf_fehler ?? 'csrf_fehler');
    }

    // Baustein 4: CSRF-Pruefung
    if (!pruefeCsrf(req)) {
      return fehler(req, res, 403, HU.assistent_csrf_fehler ?? 'csrf_fehler');
    }

    const token = aktuellesToken(req);
    if (token) {
      csrfMap.delete(sitzungFingerabdruck(token));
      sitzungBeenden(token);
    }
    cookieLoeschen(res, konfig.secureCookies);
    res.redirect(303, '/anmelden');
  });

  return router;
}
