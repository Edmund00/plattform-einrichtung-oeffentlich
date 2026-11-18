// Selbsttest Dreisprachigkeit (en, de, hu): Schluesselgleichheit, Platzhalter, keine Sprachvermischung, Rangfolge der Sprachwahl,
// Konto-Sprache, URL-Praefix, Fehlertexte je Sprache, Startseite je Sprache. Eigene Test-Datenbank, Port 4452, keine Schluessel noetig.
// Aufruf: node tools/selbsttest-sprachen.mjs
import './test-sprache.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 4452, BASE = `http://localhost:${PORT}`;
mkdirSync('daten', { recursive: true });
const DB = resolve(`daten/selbsttest-sprachen-${Date.now()}.db`);
const lade = (l) => JSON.parse(readFileSync(`texte/${l}.json`, 'utf8').replace(/^﻿/, ''));
const T = { en: lade('en'), de: lade('de'), hu: lade('hu') };
let ok = 0, schlecht = 0;
const pruefe = (name, b, detail = '') => { b ? ok++ : schlecht++; console.log(`${b ? 'OK     ' : 'FEHLER '} ${name}${!b && detail ? '  -> ' + String(detail).slice(0, 300) : ''}`); };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ph = (s) => (String(s).match(/\{[a-z_]+\}/g) || []).sort().join(',');

// ---- 1. Dateien -------------------------------------------------------------------------------------------
const keys = Object.keys(T.hu);
for (const l of ['en', 'de']) {
  const fehlt = keys.filter((k) => !(k in T[l])), zuviel = Object.keys(T[l]).filter((k) => !(k in T.hu));
  pruefe(`${l}.json hat genau die Schluessel von hu.json (${keys.length})`, !fehlt.length && !zuviel.length, fehlt.concat(zuviel).join(','));
  pruefe(`${l}.json: alle Werte sind nichtleere Zeichenketten`, keys.every((k) => typeof T[l][k] === 'string' && T[l][k].trim() !== ''));
  pruefe(`${l}.json: Platzhalter ({n}, {mb} ...) identisch zu hu.json`, keys.filter((k) => ph(T.hu[k]) !== ph(T[l][k])).length === 0, keys.filter((k) => ph(T.hu[k]) !== ph(T[l][k])).join(','));
  // unuebersetzt = Text identisch zur ungarischen Vorlage (ausser sprachneutral: Einheiten, Formate, Eigennamen)
  const neutral = /^(\{[a-z]+\}\s*%?|Ft|PDF|Video|Audio|Text|Agent|Stripe|JSON|CSV)$/i;
  const gleich = keys.filter((k) => T[l][k] === T.hu[k] && !neutral.test(T.hu[k]));
  pruefe(`${l}.json: kein unuebersetzter (ungarischer) Text`, gleich.length === 0, gleich.join(','));
  pruefe(`${l}.json: keine ungarischen Sonderbuchstaben (ő, ű)`, keys.every((k) => !/[őűŐŰ]/.test(T[l][k])));
}
pruefe('en.json: keine deutschen Umlaute/ß', keys.every((k) => !/[äöüÄÖÜß]/.test(T.en[k])));
const deEnGleich = keys.filter((k) => T.de[k] === T.en[k] && !/^(\{[a-z]+\}\s*%?|Ft|PDF|Video|Audio|Text|Agent|Status|Name|Interval|JSON|CSV|Admin|Stripe)$/i.test(T.en[k]));
pruefe('en.json und de.json unterscheiden sich (keine deutschen Reste in en)', deEnGleich.length <= 6, deEnGleich.join(','));
pruefe('Sprachumschalter-Schluessel in allen drei Sprachen', ['sprache_label', 'sprache_ungueltig', 'notfall_seite', 'notfall_js'].every((k) => ['en', 'de', 'hu'].every((l) => T[l][k])));
pruefe('Waehrung wechselt nicht mit der Sprache: Bestell-/Preistexte enthalten kein festes EUR/HUF', keys.every((k) => !/\b(EUR|HUF)\b/.test(T.en[k] + T.de[k])));

// ---- 2. Server --------------------------------------------------------------------------------------------
const rohr = async (pfad, { methode = 'GET', kopf = {}, body } = {}) => {
  const r = await fetch(BASE + pfad, { method: methode, redirect: 'manual', headers: { Origin: BASE, ...(body ? { 'Content-Type': 'application/json' } : {}), ...kopf }, body: body ? JSON.stringify(body) : undefined });
  const cookies = r.headers.getSetCookie?.() ?? [];
  const text = await r.text();
  return { s: r.status, text, cookies, json: () => JSON.parse(text), langCookie: (cookies.find((c) => c.startsWith('lang=')) || '').split(';')[0] };
};
const sprachVon = async (opt, pfad = '/api/texte') => { const r = await rohr(pfad, opt); try { return r.json()._sprache; } catch { return null; } };
let server;
try {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/testserver-kurse.mjs'], { env: { ...process.env, PORT: String(PORT), BASE_URL: BASE, DB_DATEI: DB, TEXT_SPRACHE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', (x) => { log += x; }); server.stderr.on('data', (x) => { log += x; });
  for (let i = 0; i < 40 && !/Kurs-Testserver läuft/.test(log); i++) await warte(250);
  if (!/Kurs-Testserver läuft/.test(log)) throw new Error('Server nicht gestartet: ' + log);

  pruefe('Standard ohne Wahl: Deutsch (Rueckfall)', await sprachVon({}) === 'de');
  pruefe('Cookie lang=en -> Englisch', await sprachVon({ kopf: { Cookie: 'lang=en' } }) === 'en');
  pruefe('Cookie lang=hu -> Ungarisch', await sprachVon({ kopf: { Cookie: 'lang=hu' } }) === 'hu');
  pruefe('Browsersprache (Accept-Language: hu) wirkt ohne Cookie', await sprachVon({ kopf: { 'Accept-Language': 'hu-HU,hu;q=0.9' } }) === 'hu');
  pruefe('Unbekannte Browsersprache (fr) -> Deutsch', await sprachVon({ kopf: { 'Accept-Language': 'fr-FR' } }) === 'de');
  pruefe('Cookie schlaegt Browsersprache', await sprachVon({ kopf: { Cookie: 'lang=en', 'Accept-Language': 'hu' } }) === 'en');
  pruefe('Ausdrueckliche Wahl (?lang=hu) schlaegt Cookie und Browser', await sprachVon({ kopf: { Cookie: 'lang=en', 'Accept-Language': 'de' } }, '/api/texte?lang=hu') === 'hu');
  pruefe('URL-Praefix /en/ waehlt Englisch (auch gegen Cookie de)', await sprachVon({ kopf: { Cookie: 'lang=de' } }, '/en/api/texte') === 'en');
  const pre = await rohr('/hu/api/texte');
  pruefe('URL-Praefix /hu/ setzt das Sprach-Cookie', pre.langCookie === 'lang=hu', pre.cookies.join(' | '));
  pruefe('Ungueltige Sprache (?lang=xx) wird ignoriert', await sprachVon({}, '/api/texte?lang=xx') === 'de');
  const texte = (await rohr('/api/texte', { kopf: { Cookie: 'lang=en' } })).json();
  pruefe('/api/texte liefert vollstaendig die Sprachdatei plus _locale', keys.every((k) => texte[k] === String(T.en[k]).split('{plattform}').join('Musterakademie')) && texte._locale === 'en-GB');   // {plattform} = Standardname (Produktreife Block 2)
  for (const [l, locale] of [['de', 'de-DE'], ['hu', 'hu-HU']]) {
    const x = (await rohr('/api/texte', { kopf: { Cookie: `lang=${l}` } })).json();
    pruefe(`/api/texte (${l}) vollstaendig, _locale ${locale}`, keys.every((k) => x[k] === String(T[l][k]).split('{plattform}').join('Musterakademie')) && x._locale === locale);
  }
  for (const l of ['en', 'de', 'hu']) {
    const s = await rohr('/', { kopf: { Cookie: `lang=${l}` } });
    pruefe(`Startseite (${l}): lang-Attribut, Titel und Notfalltext in der Sprache`, s.text.includes(`<html lang="${l}">`) && s.text.includes(`<title>${T[l].k_oldal_cim}</title>`) && s.text.includes(T[l].notfall_seite), s.text.slice(0, 200));
    const a = await rohr('/admin/', { kopf: { Cookie: `lang=${l}` } });
    pruefe(`Admin-Startseite (${l}): lang und Titel`, a.text.includes(`<html lang="${l}">`) && a.text.includes(`<title>${T[l].a_titel}</title>`));
    const f = await rohr('/api/anmelden', { methode: 'POST', kopf: { Cookie: `lang=${l}` }, body: { email: 'niemand@example.com', passwort: 'falsch-falsch-1' } });
    pruefe(`API-Fehlertext (${l}) in der Sprache, Code bleibt stabil`, f.s === 401 && f.json().fehler === 'anmeldung_falsch' && f.json().text === T[l].anmeldung_falsch, f.text);
  }
  // Konto-Sprache: Registrierung merkt die Sprache, der Login stellt sie wieder her, der Umschalter speichert sie im Konto.
  const email = 'sprachtest@example.com', pass = 'Sprach-Test-2026!';
  const reg = await rohr('/api/registrieren', { methode: 'POST', kopf: { Cookie: 'lang=en' }, body: { zustimmung: true, email, passwort: pass } });
  pruefe('Registrierung 201 (Englisch)', reg.s === 201, reg.text);
  const login = async (cookie) => rohr('/api/anmelden', { methode: 'POST', kopf: cookie ? { Cookie: cookie } : {}, body: { email, passwort: pass } });
  let l1 = await login('lang=de');
  pruefe('Login: Kontosprache (en) wird zur aktiven Sprache (Konto vor Cookie)', l1.s === 200 && l1.langCookie === 'lang=en', l1.cookies.join(' | '));
  const sitz = (l1.cookies.find((c) => !c.startsWith('lang=')) || '').split(';')[0];
  const sw = await rohr('/api/sprache', { methode: 'POST', kopf: { Cookie: sitz + '; lang=en' }, body: { sprache: 'hu' } });
  pruefe('Umschalter /api/sprache speichert im Konto und setzt das Cookie', sw.s === 200 && sw.langCookie === 'lang=hu', sw.text);
  const l2 = await login('lang=de');
  pruefe('Nach dem Wechsel liefert der Login Ungarisch', l2.langCookie === 'lang=hu', l2.cookies.join(' | '));
  const bad = await rohr('/api/sprache', { methode: 'POST', body: { sprache: 'fr' } });
  pruefe('Ungueltige Sprache beim Umschalter: 400 mit lokalisiertem Text', bad.s === 400 && bad.json().fehler === 'sprache_ungueltig');
  const k404 = await rohr('/nicht-vorhanden', { kopf: { Cookie: 'lang=en', Accept: 'text/html' } });
  pruefe('404-Seite im Browser in der Sprache (en)', k404.s === 404 && k404.text.includes('lang="en"') && k404.text.includes(T.en.oldal_nem_talalhato), k404.text.slice(0, 160));
  for (const [l, w] of [['en','Legal notice'],['de','Impressum']]) {
    const r = await rohr('/jogi/impresszum/', { kopf: { Cookie: 'lang=' + l } });
    pruefe(`Rechtsseite Impressum in ${l}: Sprache, Platzhalterhinweis, kein Ungarisch`, r.s === 200 && r.text.includes('lang="' + l + '"') && r.text.includes('<h1>' + w + '</h1>') && !r.text.includes('Vissza'), r.text.slice(0, 120));
  }
  const rh = await rohr('/jogi/adatvedelem/', { kopf: { Cookie: 'lang=hu' } });
  // Produktreife (12.11.2026): diese Instanz laeuft OHNE Demo-Modus und ohne DATENSCHUTZ_URL: neutrale ungarische Seite statt der Muster-Datei
  // (die Muster-Datei im Demo-Modus prueft tools/selbsttest-produktreife.mjs).
  pruefe('Rechtsseite Datenschutz in hu (ohne Demo): neutraler Hinweis auf Ungarisch, keine Muster-Datei', rh.s === 200 && rh.text.includes('lang="hu"') && rh.text.includes(T.hu.recht_nicht_hinterlegt) && !/DEMONSTR|Muster/i.test(rh.text), rh.text.slice(0, 200));
} catch (e) {
  pruefe('Testablauf', false, e.stack || e.message);
} finally {
  try { server?.kill(); } catch { /* ignorieren */ }
  await warte(400);
  for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s, { force: true }); } catch { /* ignorieren */ } }
}
console.log(`\nSprachen: ${ok} bestanden, ${schlecht} fehlgeschlagen`);
process.exit(schlecht ? 1 : 0);
