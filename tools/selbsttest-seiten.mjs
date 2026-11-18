// Automatischer Selbsttest für die Kundenseiten (und die Texte der Admin-Seite): werden die Seiten mit den Sicherheits-Kopfzeilen
// ausgeliefert, steckt kein innerHTML/eval und kein fester Satz im HTML oder JavaScript, kommen alle Texte aus /api/texte, und
// gibt es die aufgerufenen Server-Routen wirklich. Eigene Test-Datenbank, Port 4409, keine Schlüssel nötig.
// Der Ablauf im echten Browser (Chromium) ist ein eigener, einmaliger Lauf außerhalb des Repos (siehe Protokoll).
// Aufruf: tools\Selbsttest-Seiten.ps1
import './test-sprache.mjs';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = 4409;
const BASE = `http://localhost:${PORT}`;
mkdirSync('daten', { recursive: true });
const lauf = Date.now();
const DB = resolve(`daten/selbsttest-seiten-${lauf}.db`);
const HU = JSON.parse(readFileSync('texte/hu.json', 'utf8').replace(/^﻿/, ''));

let ok = 0, schlecht = 0;
const pruefe = (name, bedingung, detail = '') => { bedingung ? ok++ : schlecht++; console.log(`${bedingung ? 'OK     ' : 'FEHLER '} ${name}${!bedingung && detail ? '  -> ' + detail : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = () => { for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s, { force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } } }; // Windows: Datei kann noch gesperrt sein
const rohAnfrage = (pfad) => new Promise((erfuellt, fehlschlag) => {
  const r = request({ host: '127.0.0.1', port: PORT, path: pfad, method: 'GET' }, (a) => { let t = ''; a.on('data', (x) => { t += x; }); a.on('end', () => erfuellt({ s: a.statusCode, kopf: a.headers, text: t })); });
  r.on('error', fehlschlag); r.end();
});

const ohneKommentar = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const WOERTER = /\b(der|die|das|und|ist|nicht|bitte|für|mit|ein|eine|noch|kein|keine|fehler|hinzufügen|speichern|a|az|és|hogy|nem|egy|vagy|kérlek|mentés|hiba|előadás|fizetés)\b/i;
function sprachPruefung(name, code) {
  const rein = ohneKommentar(code);
  pruefe(`${name}: keine Buchstaben mit Akzent oder Umlaut im Code (also keine festen deutschen oder ungarischen Wörter)`, !/[À-ɏ]/.test(rein), (rein.match(/.{0,20}[À-ɏ].{0,20}/) || [''])[0]);
  const literale = [...rein.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]).filter((x) => /[A-Za-z]{2,}/.test(x) && /\s/.test(x.trim()));
  // CSS-Klassennamen mit Bindestrich (zum Beispiel "kurzus-kartya") sind keine Sätze und werden vor der Wortprüfung entfernt.
  const verdaechtig = literale.filter((x) => WOERTER.test(x.replace(/[a-z0-9]+(?:-[a-z0-9]+)+/gi, '')));
  pruefe(`${name}: keine Zeichenkette enthält deutsche oder ungarische Sätze`, verdaechtig.length === 0, verdaechtig.join(' | '));
  pruefe(`${name}: kein innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, new Function`, !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|setTimeout\s*\(\s*['"`]/.test(rein));
  pruefe(`${name}: lädt nichts von außen (keine http-Adressen außer dem Stripe-Vorspann)`, [...rein.matchAll(/https?:\/\/[^\s'"`)]*/g)].every((m) => m[0] === 'https://checkout.stripe.com/' || m[0] === 'https://billing.stripe.com/' || m[0] === 'https://valorebusinessclub.com/'));   // Weiterleitung zu Stripe: Kasse und Kundenportal
}

let server;
try {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/testserver-kurse.mjs'], { env: { ...process.env, PORT: String(PORT), BASE_URL: BASE, DB_DATEI: DB }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', (x) => { log += x; }); server.stderr.on('data', (x) => { log += x; });
  for (let i = 0; i < 40 && !/Kurs-Testserver läuft/.test(log); i++) await warte(250);
  if (!/Kurs-Testserver läuft/.test(log)) throw new Error('Server nicht gestartet: ' + log);

  // =================================================================================================
  abschnitt('Startseite /');
  const start = await fetch(BASE + '/');
  const html = await start.text();
  const csp = start.headers.get('content-security-policy') || '';
  pruefe('GET /: 200, HTML, lang="hu"', start.status === 200 && /text\/html/.test(start.headers.get('content-type') || '') && html.includes('<html lang="hu">'));
  pruefe("Content-Security-Policy: default-src 'self', script-src 'self', media-src 'self' (für Video und Audio), object-src 'none', keine Ausnahmen", csp.includes("media-src 'self'") && csp.includes("object-src 'none'") && csp.includes("default-src 'self'") && csp.includes("script-src 'self'") && csp.includes("worker-src 'self'") && csp.includes("connect-src 'self'") && csp.includes("style-src 'self'") && csp.includes("frame-ancestors 'none'") && !/unsafe-inline|unsafe-eval|blob:|https?:\/\//.test(csp), csp);
  pruefe('nosniff, X-Frame-Options DENY, Referrer-Policy no-referrer', start.headers.get('x-content-type-options') === 'nosniff' && start.headers.get('x-frame-options') === 'DENY' && start.headers.get('referrer-policy') === 'no-referrer');
  const sichtbar = html.replace(/<title>[^<]*<\/title>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, '').trim();
  pruefe('index.html enthält als sichtbaren Text nur den festen ungarischen Notfalltext (Titel ungarisch, alles andere aus hu.json)', sichtbar === 'Az oldal most nem tölthető be. Kérlek, frissítsd az oldalt néhány perc múlva.A használathoz kapcsold be a JavaScriptet.' && /<title>[^<]+<\/title>/.test(html), sichtbar);
  pruefe('index.html: keine Inline-Skripte, keine Inline-Stile, keine Ereignis-Attribute', !/<script(?![^>]*\ssrc=)/i.test(html) && !/\sstyle=/i.test(html) && !/\son[a-z]+=/i.test(html));
  pruefe('Lokale Schrift, Favicon, CSS und JS verlinkt', html.includes('href="/fonts/fonts.css"') && html.includes('href="kunde.css"') && html.includes('href="/favicon.svg"') && html.includes('src="kunde.js"') && html.indexOf('/fonts/fonts.css') < html.indexOf('kunde.css') && html.includes('name="theme-color" content="#000000"') && !html.includes('https://'));
  for (const [pfad, typ] of [['/kunde.js', /javascript/], ['/preis.js', /javascript/], ['/kunde.css', /text\/css/]]) {
    const a = await fetch(BASE + pfad);
    pruefe(`${pfad}: 200, richtiger Typ, Sicherheits-Kopfzeilen`, a.status === 200 && typ.test(a.headers.get('content-type') || '') && a.headers.get('x-content-type-options') === 'nosniff' && (a.headers.get('content-security-policy') || '').includes("default-src 'self'"));
  }
  for (const pfad of ['/vendor/pdfjs/pdf.min.mjs', '/vendor/pdfjs/pdf.worker.min.mjs']) {
    const a = await fetch(BASE + pfad);
    pruefe(pfad + ': 200, JavaScript-Modul, nosniff und sichere CSP',
      a.status === 200 && /(?:text|application)\/javascript/.test(a.headers.get('content-type') || '') &&
      a.headers.get('x-content-type-options') === 'nosniff' &&
      (a.headers.get('content-security-policy') || '').includes("worker-src 'self'"));
  }
  pruefe('Muster-Logos, Favicon und lokale Schriften vorhanden',
    ['public/img/muster-logo.svg','public/img/muster-logo-vertikal.svg','public/favicon.svg','public/fonts/fonts.css'].every(existsSync));
  const stil = readFileSync('public/kunde.css','utf8');
  const fonts = readFileSync('public/fonts/fonts.css','utf8');
  pruefe('VALORE-Farben, Schriftfamilien und mobile Raster in Kunde-CSS',
    stil.includes('--ivory:#faf6ee') && stil.includes('--gold:#d4a843') &&
    stil.includes('Cormorant Garamond') && stil.includes('Jost') &&
    stil.includes('grid-template-columns:repeat(3,minmax(0,1fr))') &&
    stil.includes('prefers-reduced-motion') && fonts.includes('woff2') &&
    !fonts.includes('fonts.googleapis') && !fonts.includes('fonts.gstatic') && !stil.includes('fonts.googleapis'));
  const kundeDesignJs = readFileSync('public/kunde.js', 'utf8');
  pruefe('Sichtbare Seiten haben Kopf, Hero, Footer und Muster-Markenbilder',
    kundeDesignJs.includes('function kopfzeile()') && kundeDesignJs.includes('function fusszeile()') &&
    kundeDesignJs.includes('function hero(') && kundeDesignJs.includes('muster-logo.svg') &&
    kundeDesignJs.includes('muster-logo.svg') && kundeDesignJs.includes('muster-logo-vertikal.svg') &&
    !kundeDesignJs.includes('setAttribute("style"') && !kundeDesignJs.includes("setAttribute('style'"));
  const api = await fetch(BASE + '/api/kurse');
  pruefe('Die Kopfzeilen stehen auch auf API-Antworten und auf 404', api.headers.get('x-content-type-options') === 'nosniff' && (await fetch(BASE + '/gibt-es-nicht')).headers.get('x-frame-options') === 'DENY');

  // Pruefrunde 4 (Sprache, 01.11.2026): unbekannte Adressen duerfen keine englische Express-Seite zeigen
  {
    const html404 = await fetch(BASE + '/gibt-es-nicht-mehr', { headers: { Accept: 'text/html' } });
    const html404Text = await html404.text();
    pruefe('Unbekannte Seite im Browser: 404 auf Ungarisch (lang hu, Text und Rueckweg), kein englisches Cannot GET', html404.status === 404 && /lang="hu"/.test(html404Text) && html404Text.includes(HU.oldal_nem_talalhato) && html404Text.includes(HU.oldal_vissza) && !/Cannot GET|lang="en"/.test(html404Text), html404Text.slice(0, 120));
    const api404 = await fetch(BASE + '/api/gibt-es-nicht');
    const api404Daten = await api404.json().catch(() => ({}));
    pruefe('Unbekannte API-Adresse: 404 als JSON mit ungarischem Text', api404.status === 404 && api404Daten.fehler === 'nicht_gefunden' && api404Daten.text === HU.nicht_gefunden);
    const del404 = await fetch(BASE + '/', { method: 'DELETE', headers: { Accept: 'text/html' } });
    pruefe('Andere Methode auf unbekannter Route: ungarisches JSON, keine englische Seite', del404.status === 404 && (await del404.json().catch(() => ({}))).text === HU.nicht_gefunden);
  }

  abschnitt('Alte Lern-App ist weg, nur public/ wird ausgeliefert');
  for (const datei of ['app.js', 'danke.html', 'style.css']) pruefe(`public/${datei} gibt es nicht mehr und wird nicht ausgeliefert`, !existsSync(`public/${datei}`) && (await fetch(`${BASE}/${datei}`)).status === 404);
  pruefe('setup.mjs (Stripe-Objekte der Lern-App) gibt es nicht mehr', !existsSync('setup.mjs') && !JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8').replace(/^﻿/, '')).scripts).includes('setup'));
  pruefe('Nur erwartete Dateien in public/ (Muster ohne Erklaervideo, mit eigenen Demo-Rechtsseiten (jogi))', readdirSync('public').sort().join(',') === 'admin,favicon.svg,fonts,img,index.html,jogi,kunde.css,kunde.js,preis.js,vendor', readdirSync('public').join(','));
  for (const pfad of ['/server.mjs', '/package.json', '/zahlung.mjs', '/db.mjs', '/konfig.mjs', '/texte/hu.json', '/docs/UMGEBUNG.md', '/daten/', '/.git/config', '/tools/selbsttest-kauf.mjs', '/CLAUDE.md']) {
    const a = await fetch(BASE + pfad);
    if (a.status === 200) pruefe(`${pfad} wird NICHT ausgeliefert`, false, String(a.status));
  }
  const rauf = await rohAnfrage('/%2e%2e/server.mjs');
  pruefe('Quellcode, Konfiguration, Texte, Doku und Tests werden nicht ausgeliefert (Pfade nach oben auch nicht)', rauf.s !== 200 && !rauf.text.includes('import '));
  pruefe('/admin bleibt erreichbar und eigenständig', (await fetch(BASE + '/admin/')).status === 200 && (await fetch(BASE + '/admin/admin.js')).status === 200);

  // =================================================================================================
  abschnitt('Texte: nichts Festes im Code, alles aus /api/texte');
  const kundeJs = readFileSync('public/kunde.js', 'utf8').replace(/\r\n/g, '\n');   // Windows-Zeilenenden (CRLF) vereinheitlichen
  const adminJs = readFileSync('public/admin/admin.js', 'utf8');
  const preisJs = readFileSync('public/preis.js', 'utf8');
  sprachPruefung('kunde.js', kundeJs);
  sprachPruefung('preis.js', preisJs);
  sprachPruefung('admin.js', adminJs);
  // Schlüssel stehen als Zeichenkette im Code (auch wenn sie erst später an t() übergeben werden); 'k_art_' ist nur ein Vorspann
const kKeys = new Set([...kundeJs.matchAll(/['"](k_[a-z_0-9]*[a-z0-9])['"]/g)].map((m) => m[1]));
  for (const a of ['text', 'video', 'pdf', 'audio', 'datei']) kKeys.add('k_art_' + a);
  for (const a of ['month', 'year']) kKeys.add('k_abo_' + a);        // t('k_art_' + art) ist dynamisch
  const fehlen = [...kKeys].filter((k) => typeof HU[k] !== 'string' || !HU[k].trim());
  pruefe(`Alle ${kKeys.size} in kunde.js verwendeten Textschlüssel stehen in hu.json`, kKeys.size > 30 && fehlen.length === 0, 'fehlt: ' + fehlen.join(', '));
  const ungenutzt = Object.keys(HU).filter((k) => k.startsWith('k_') && !kKeys.has(k));
  pruefe('Alle k_-Texte in hu.json werden auch benutzt', ungenutzt.length === 0, ungenutzt.join(', '));
  const texte = await (await fetch(BASE + '/api/texte')).json();
  pruefe('/api/texte liefert alle Kundentexte (k_...) und Admintexte (a_...), alle ungarisch und nicht leer', Object.keys(HU).filter((k) => /^(k_|a_|grund_)/.test(k)).every((k) => texte[k] === String(HU[k]).split('{plattform}').join('Musterakademie') && texte[k].trim().length > 0));   // {plattform} = Standardname (Produktreife Block 2)
  pruefe('Die Kundentexte enthalten ungarische Buchstaben und keine deutschen Wörter', Object.entries(HU).filter(([k]) => k.startsWith('k_')).every(([, v]) => !/\b(der|die|das|und|nicht|bitte|kurs|fehler)\b/i.test(v)));
  const gruende = new Set([...readFileSync('zahlung.mjs', 'utf8').matchAll(/grund = '([a-z_]+)'/g)].map((m) => m[1]).concat(['erstattung_voll', 'teilerstattung']));
  pruefe(`Jeder Grund einer Bestellung (${[...gruende].join(', ')}) hat einen ungarischen Text (grund_...)`, gruende.size >= 6 && [...gruende].every((g) => typeof HU['grund_' + g] === 'string' && HU['grund_' + g].length > 5));
  pruefe('Admin-Seite zeigt den Abschnitt "Ellenőrzendő fizetések" mit Erklärung (Texte aus hu.json) und ruft die Admin-API', /api\/admin\/bestellungen\?status=pruefen/.test(adminJs) && /t\('a_pruefen_cim'\)/.test(adminJs) && /t\('a_pruefen_magyarazat'\)/.test(adminJs) && HU.a_pruefen_cim === 'Ellenőrzendő fizetések' && HU.a_pruefen_magyarazat.length > 120);

  abschnitt('Sicherheit der Seiten (Lesen des Codes)');
  pruefe('Weiterleitung zu Stripe nur an https://checkout.stripe.com/ (sonst nie)', /STRIPE_ELOTAG\s*=\s*'https:\/\/checkout\.stripe\.com\/'/.test(kundeJs) && /startsWith\(STRIPE_ELOTAG\)[\s\S]{0,200}location\.assign\(v\.d\.url\)/.test(kundeJs) && (kundeJs.match(/location\.assign\(/g) || []).length === 3 && /u\.hostname==='billing\.stripe\.com'\)location\.assign\(u\.href\)/.test(kundeJs));
  pruefe('Ziel nach der Anmeldung nur aus einer Liste bekannter Seiten (kein Weiterleiten auf fremde Adressen)', /ERLAUBTES_ZIEL\s*=\s*\/\^/.test(kundeJs) && /ERLAUBTES_ZIEL\.test\(vissza/.test(kundeJs) && !/location\.(href|replace)\s*=/.test(kundeJs));
  pruefe('Verschachtelte Elementlisten werden vollständig aufgelöst (flat(Infinity)), sonst erschiene "[object HTMLElement]" auf der Seite', /kinder\.flat\(Infinity\)/.test(kundeJs) && /kinder\.flat\(Infinity\)/.test(adminJs) && !/kinder\.flat\(\)/.test(kundeJs + adminJs));
  pruefe('PDF mit lokalem pdf.js-Worker, nur Leinwand und Wasserzeichen',
    kundeJs.includes("import('/vendor/pdfjs/pdf.min.mjs')") &&
    kundeJs.includes("pdf.worker.min.mjs") && kundeJs.includes("h('canvas'") &&
    kundeJs.includes('seite.render(') && kundeJs.includes('wasserzeichenAufLeinwand') &&
    // Bunny-Videos (Schritt 5): ein iframe, aber NUR einmal und NUR in bunnyAnsicht (ein Bereich mit genau einer Funktion); sonst nirgends, in keiner Schreibweise.
    ((bereich) => (kundeJs.match(/['"`]iframe['"`]/g) || []).length === 1 && bereich.includes("h('iframe'") && (bereich.match(/function /g) || []).length === 1 && !/createElement\(\s*['"`]iframe/i.test(kundeJs))(kundeJs.slice(kundeJs.indexOf('function bunnyAnsicht'), kundeJs.indexOf('async function geschuetzteAnsicht'))) &&
    !kundeJs.includes('toolbar=0') && !kundeJs.includes('download: true'));
  pruefe('Admin-Seite lädt per PUT mit Fortschritt hoch und prüft die Größe vorab, Dateiname nur URL-kodiert als Kopfzeile', /x\.open\('PUT'/.test(adminJs) && /x\.upload\.onprogress/.test(adminJs) && /encodeURIComponent\(datei\.name\)/.test(adminJs) && /datei\.size > maxBytes/.test(adminJs) && !/FormData/.test(adminJs));
  pruefe('Kein Zugriff auf localStorage, sessionStorage oder document.cookie (Sitzung bleibt im HttpOnly-Cookie)', !/localStorage|sessionStorage|document\.cookie/.test(kundeJs + adminJs));
  pruefe('Die Seite berechnet keine Preise für den Server: beim Kaufen wird nur modell und (Einmalkauf mit Preis oder Abo) die Zustimmung mitgeschickt', kundeJs.includes("{ modell, ...((modell==='einmal'&&k.preis_cent>0)||modell==='abo'?{zustimmung:zustimmInput.checked}:{}) }"));

  pruefe('Passwortseiten nutzen Hash-Routing, HU-Texte und geschützte Passwortfelder',
    kundeJs.includes("case 'passwort-vergessen'") && kundeJs.includes("case 'passwort-neu'") &&
    kundeJs.includes("case 'passwort-aendern'") && kundeJs.includes("autocomplete:'new-password'") &&
    kundeJs.includes("autocomplete:'current-password'") && !kundeJs.includes('setAttribute("style"'));
  pruefe('Admin-Anmeldung enthält Passwort-vergessen-Link zur Kundenseite',
    adminJs.includes("href:'/#/passwort-vergessen'") && adminJs.includes("t('a_passwort_vergessen')"));
  pruefe('Admin-Ereignisliste: Filter, CSV/JSON und alle Beschriftungen aus hu.json',
    adminJs.includes('ereignisseBereich()') &&
    adminJs.includes("t('a_ereignisse_cim')") &&
    adminJs.includes("t('a_ereignisse_export_csv')") &&
    adminJs.includes("t('a_ereignisse_export_json')") &&
    adminJs.includes("new URLSearchParams()") &&
    adminJs.includes('Europe/Budapest'));
  pruefe('Scheibe 22: öffentliche Widerrufsbelehrung und Anbietertext',
    kundeJs.includes("case 'elallasi-tajekoztato'") &&
    kundeJs.includes("href:'#/elallasi-tajekoztato'") &&
    kundeJs.includes("href: '#/elallasi-tajekoztato'") &&
    kundeJs.includes("'/api/anbieter'") &&
    HU.mailrecht_ellallas_titel==='Elállási tájékoztató' &&
    HU.mailrecht_muster.includes('Elállási nyilatkozat-minta') &&
    HU.k_mailrecht_seite_hinweis==='Az elállási jogról itt tájékozódhatsz');
  pruefe('Scheibe 21: Kaufzustimmung und zweistufiger Widerruf',
    kundeJs.includes("type:'checkbox'") &&
    kundeJs.includes("zustimmung:zustimmInput.checked") &&
    kundeJs.includes("'/ellallas'") &&
    HU.k_ellallas_megerosites==='Elállás megerősítése' &&
    HU.k_ellallas_zustimmung.includes('elveszítem az elállási jogomat') &&
    HU.ellallas_erklaerung==='Kijelentem, hogy elállok a fent megjelölt szerződéstől.');
  pruefe('Scheibe 20: Kündigung aus Fiókom und Kurzusaim erreichbar',
    kundeJs.includes("'/api/abo/lemondas'") &&
    kundeJs.includes("b.abo_ende") &&
    HU.k_abo_lemondas==='Előfizetés lemondása');
  pruefe('Scheibe 19: PDF-Beleg nur bei bezahlten Bestellungen',
    kundeJs.includes("b.status==='bezahlt'&&!b.ellallas_ergebnis&&b.grund!=='erstattung_voll'&&b.betrag>0") &&
    kundeJs.includes("'/beleg'") &&
    HU.k_fiokom_beleg==='Fizetési bizonylat');
  pruefe('Scheibe 18: Fiókom-Menü und gesicherte Kontoseite auf Ungarisch',
    kundeJs.includes("href: '#/fiokom'") &&
    kundeJs.includes("case 'fiokom': return fiokom()") &&
    kundeJs.includes("'/api/konto/auskunft'") &&
    kundeJs.includes("'/api/konto/loeschen'") &&
    HU.k_nav_fiokom==='Fiókom' &&
    HU.k_fiokom_rendelesek==='Rendeléseim' &&
    !/setAttribute\(['"]style['"]/.test(kundeJs));
  // Kundenweg 03.11.2026 (KW-1 bis KW-3, Aufnahme des Kaufablaufs)
  pruefe('KW-1: Link auf die aktuelle Adresse baut die Seite neu auf (VISSZA nach Mailbestaetigung, ELŐADÁSOK auf #/), Sondertasten bleiben frei',
    kundeJs.includes("closest('a[href^=\"#/\"]')") && kundeJs.includes("a.getAttribute('href') === location.hash") &&
    /test\(location\.hash\)\) \{ e\.preventDefault\(\); route\(\); \}/.test(kundeJs) && kundeJs.includes('/^#\\/(eloadasaim|fiokom)?$/') && kundeJs.includes('e.ctrlKey || e.metaKey || e.shiftKey || e.altKey') &&
    kundeJs.includes("history.replaceState(null,'',location.pathname+location.search+'#/')"));
  pruefe('KW-2: Kursliste markiert eigene Kurse (nur angemeldet, Besitz aus /api/meine-kurse, Fehler = Liste wie bisher), Texte vorhanden',
    kundeJs.includes("ich.angemeldet ? api('GET', '/api/meine-kurse') : Promise.resolve(null)") && kundeJs.includes('if (location.hash !== hashBeginn) return;') &&
    kundeJs.includes('if (m && m.ok && Array.isArray(m.d))') &&
    kundeJs.includes("t('k_megvasarolva')") && kundeJs.includes("href: '#/eloadas/' + k.id") &&
    HU.k_megvasarolva === 'Megvásárolva' && HU.k_megnyitas === 'Megnyitás');
  pruefe('KW-3: Danke-Seite hat nach dem Hauptknopf einen zweiten Knopf "További előadások" (bezahlt und Timeout)',
    (kundeJs.match(/knopf hell', href: '#\/' \}, t\('k_tovabbi_eloadasok'\)/g) || []).length === 2 &&
    kundeJs.indexOf("knopf gross gruen', href: '#/eloadas/' + talalt.id") < kundeJs.indexOf("t('k_tovabbi_eloadasok')") &&
    HU.k_tovabbi_eloadasok === 'További előadások');
  pruefe('KW-4: eigene Registrierungsseite (#/regisztracio) mit Pflicht-Haeckchen, Passwort einmal, Link zum Login; Login ohne Registrieren-Knopf',
    kundeJs.includes("case 'regisztracio': return regisztracio(vissza);") && kundeJs.includes('function regisztracio(vissza)') &&
    /type:\s*'checkbox', name: 'elfogad', required: true/.test(kundeJs) && kundeJs.includes('zustimmung: hozzajarul.checked === true') && !kundeJs.includes('zustimmung: true') &&
    (kundeJs.match(/autocomplete: 'new-password'/g) || []).length === 1 &&
    !kundeJs.includes("kuldes('/api/registrieren'") && kundeJs.includes("href: '#/regisztracio' + (lepj") &&
    kundeJs.includes("href: '#/regisztracio' }, t('k_nav_regisztracio')") &&
    HU.k_nav_regisztracio === 'Regisztráció' && HU.k_belepes_cim === 'Belépés' && !!HU.k_elfogadas_kotelezo && !!HU.zustimmung_noetig && !!HU.k_nincs_fiok && !!HU.k_van_fiok);
  { const kl = await rohAnfrage('/api/kurse'); let liste = []; try { liste = JSON.parse(kl.text); } catch {}
    pruefe('KW-2: /api/kurse fuer Gaeste unveraendert (kein Besitz-Feld, nichts Personenbezogenes)', kl.s === 200 && Array.isArray(liste) && liste.every((k) => !('zugang' in k) && !('besitz' in k) && !('hat' in k) && !('benutzer_id' in k)), kl.text.slice(0, 120)); }
  pruefe('Scheibe 17: Ereignistabelle zeigt Benutzer bei Registrierung/Bestätigung ohne Kurs und Betrag',
    adminJs.includes("const konto=['registriert','bestaetigt'].includes(e.typ)") && adminJs.includes("konto?'–':(e.kurs||t('a_ismeretlen'))") &&
    adminJs.includes("konto?'a_ereignisse_benutzer':'a_ereignisse_email'") &&
    HU.a_ereignisse_benutzer==='Felhasználó'&&HU.a_ereignisse_email==='Vásárló');
  const { formatBetrag, formatGanzeEinheiten } = await import(pathToFileURL(resolve('public/preis.js')).href);
  pruefe('Scheibe 17: Admin-Karten formatieren 4 900 Ft mit Tausenderabstand',
    adminJs.includes('formatGanzeEinheiten(e.betrag)') &&
    formatGanzeEinheiten(4900)==='4 900');
  pruefe('Scheibe 17: Exportpfad und Exportspalten unverändert',
    adminJs.includes("p.set('format',format)") &&
    adminJs.includes("exportieren('csv')")&&adminJs.includes("exportieren('json')"));
  const kursRender = kundeJs.slice(kundeJs.indexOf('  // Trailer zuerst im DOM.'),
    kundeJs.indexOf('// ---- Anmeldung und Registrierung'));
  const kursCss = readFileSync('public/kunde.css', 'utf8').replace(/\r\n/g, '\n');
  pruefe('Scheibe 16: Trailer vor Beschreibung und Preis im Kurs-DOM',
    kursRender.includes('trailer(k)') &&
    kursRender.indexOf('trailer(k)') < kursRender.indexOf('kurs-beschreibung') &&
    kursRender.indexOf('trailer(k)') < kursRender.indexOf('kurs-kauf-rechts'));
  pruefe('Scheibe 17: PDF Werkzeugleiste vor Canvas-Seiten, Abstand auf Mobil',
    kundeJs.includes('ansicht.append(leiste, seiten)')&&
    kursCss.includes('.pdf-seiten{padding-top:72px}')&&
    !kundeJs.includes('pdf-seitenmarke')&&!kursCss.includes('.pdf-seitenmarke'));
  pruefe('Scheibe 16: Mobile Reihenfolge Trailer, Preis, Beschreibung und pre-line',
    kursCss.includes("grid-template-areas:'trailer' 'preis' 'beschreibung' 'lektionen'") &&
    kursCss.includes('.kurs-beschreibung-text{white-space:pre-line'));
  pruefe('Scheibe 16: Kurslistenbild bleibt, Trailer mit Controls und Poster ohne Autostart',
    /titelbild\(k\),\s*h\('h2', \{\}, k\.titel\)/.test(kundeJs) &&
    kundeJs.includes("class:'kurs-trailer-video',controls:true") &&
    !kundeJs.includes("autoplay:true"));
  abschnitt('Die Seiten rufen nur Routen auf, die es gibt');
  const routenQuellen = ['routes-auth.mjs', 'routes-passwort.mjs', 'routes-bestaetigung.mjs', 'routes-kurse.mjs', 'routes-bestellungen.mjs', 'routes-ereignisse.mjs', 'routes-konto.mjs', 'zahlung.mjs', 'texte.mjs', 'dateien.mjs', 'app.mjs', 'demo.mjs', ...readdirSync('.').filter((f) => /^routes-.*\.mjs$/.test(f))].map((f) => readFileSync(f, 'utf8')).join('\n');
  const agentQuelle = readFileSync('routes-agent.mjs', 'utf8');
  const routen = [
    ...[...routenQuellen.matchAll(/(?:Router|router|app)\.(?:get|post|patch|put|delete)\(\s*'(\/[^']+)'/g)].map((m) => m[1]),
    ...[...agentQuelle.matchAll(/adminRouter\.(?:get|post|patch|put|delete)\(\s*'(\/[^']+)'/g)].map((m) => '/api/admin/agent' + m[1]),
  ];
  const aufrufe = new Set([...(kundeJs + adminJs).matchAll(/['"`](\/api\/[A-Za-z0-9_\-/?=&]*)/g)].map((m) => m[1].split('?')[0].replace(/\/$/, '')));
  const unbekannt = [...aufrufe].filter((a) => !routen.some((r) => r === a || r.startsWith(a + '/') || r.startsWith(a)));
  pruefe(`Alle ${aufrufe.size} Adressen, die die Seiten aufrufen (${[...aufrufe].join(' ')}), gibt es als Route`, aufrufe.size >= 10 && unbekannt.length === 0, 'fehlt: ' + unbekannt.join(', '));

  abschnitt('Preis-Anzeige (preis.js)');
  pruefe('HUF: 3990000 -> "39 900 Ft", 0 -> "0 Ft"', formatBetrag(3990000, 'huf') === '39 900 Ft' && formatBetrag(0, 'huf') === '0 Ft');
  pruefe('EUR: 1500 -> "15,00 EUR", 12345 -> "123,45 EUR"', formatBetrag(1500, 'eur') === '15,00 EUR' && formatBetrag(12345, 'eur') === '123,45 EUR');
  const { formatMeret } = await import(pathToFileURL(resolve('public/preis.js')).href);
  pruefe('Dateigröße: 1234567 -> "1,2 MB", 52000 -> "50,8 KB", 900 -> "900 B", 3 GB', formatMeret(1234567) === '1,2\u00a0MB' && formatMeret(52000) === '50,8\u00a0KB' && formatMeret(900) === '900\u00a0B' && formatMeret(3 * 1024 ** 3) === '3,0\u00a0GB');
  pruefe('Ungültige Größen ergeben nichts', formatMeret(-1) === '' && formatMeret(1.5) === '' && formatMeret(null) === '');
  pruefe('Ungültige Beträge ergeben nichts (kein "NaN")', formatBetrag(-1, 'huf') === '' && formatBetrag(1.5, 'eur') === '' && formatBetrag(null, 'huf') === '' && formatBetrag(undefined, 'eur') === '');
} catch (e) {
  schlecht++; console.log('FEHLER  Unerwarteter Abbruch: ' + e.stack);
} finally {
  if (server) server.kill();
  await warte(500);
  aufraeumen();
  console.log(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`);
  process.exit(schlecht === 0 ? 0 : 1);
}
