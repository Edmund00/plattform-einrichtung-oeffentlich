// Selbsttest WP8: Stripe-Zahlungsverbindung (Schritt 4), nur Testmodus.
// Pruefungen S1-S9 aus docs/SPEZ-WP4-9-ASSISTENT.md.
// Stripe-API wird durch lokalen Mock ersetzt (PE_STRIPE_URL=http://127.0.0.1:<mock>).
// Kein Netz, keine echten Schluessel.
import './test-sprache.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Stripe from 'stripe';
import express from 'express';
import { stripeVerbindungTesten, stripeWebhookSelbsttest } from '../stripe-verbindung.mjs';

let ok = 0, schlecht = 0;
const pruefe = (name, bed, detail = '') => { bed ? ok++ : schlecht++; console.log(`${bed ? 'OK     ' : 'FEHLER '} ${name}${!bed && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = (p) => { try { rmSync(p, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } };
const SERVER = resolve('server.mjs');
const basisEnv = (extra) => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...extra });

// Mock-Stripe-Server: reagiert auf GET /v1/balance.
const STRIPE_MOCK_PORT = 19600;
let stripeMockAnfragen = [];
let stripeMockAntwortFn = () => ({ status: 200, body: { object: 'balance', available: [], pending: [] } });

const stripeMockServer = await new Promise((resolve, reject) => {
  const srv = createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      stripeMockAnfragen.push({ method: req.method, url: req.url });
      const { status, body, hang } = stripeMockAntwortFn(req) ?? { status: 200, body: {} };
      if (hang) return;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body ?? {}));
    });
  });
  srv.listen(STRIPE_MOCK_PORT, '127.0.0.1', () => resolve(srv));
  srv.on('error', reject);
});
const STRIPE_MOCK_URL = `http://127.0.0.1:${STRIPE_MOCK_PORT}`;

async function starteServer(tmpord, port, extraEnv = {}) {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    cwd: tmpord, stdio: ['ignore', 'pipe', 'pipe'],
    env: basisEnv({ PORT: String(port), DB_DATEI: join(tmpord, 'app.db'), ...extraEnv }),
  });
  let log = '';
  p.stdout.on('data', x => { log += x; });
  p.stderr.on('data', x => { log += x; });
  for (let i = 0; i < 300; i++) {
    if (/Schulungsplattform|fehlerhaft/.test(log)) break;
    if (p.exitCode !== null) break;
    try { const r = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null); if (r?.status) break; } catch { /* noch nicht */ }
    await warte(200);
  }
  return { p, log: () => log };
}

async function stop(p) {
  p.kill('SIGTERM');
  await new Promise(r => { if (p.exitCode !== null) r(); else { p.on('exit', r); setTimeout(() => { try { p.kill('SIGKILL'); } catch {} r(); }, 10000); } });
}

async function holen(port, pfad, { method = 'GET', headers = {}, body = null } = {}) {
  const init = { method, headers: { Accept: 'text/html,application/json', ...headers }, redirect: 'manual' };
  if (body !== null) init.body = body;
  const a = await fetch(`http://127.0.0.1:${port}${pfad}`, init);
  const text = await a.text();
  return { status: a.status, text, headers: Object.fromEntries(a.headers) };
}

async function einrichtungsmodusServer(tmpord, port, extraEnv = {}) {
  const { p: pSetup } = await starteServer(tmpord, port, { EINRICHTUNGSMODUS: '1' });
  for (let i = 0; i < 600; i++) {
    if (existsSync(join(tmpord, 'daten', 'ERSTSTART.txt'))) break;
    await warte(100);
  }
  const code = existsSync(join(tmpord, 'daten', 'ERSTSTART.txt'))
    ? readFileSync(join(tmpord, 'daten', 'ERSTSTART.txt'), 'utf8').trim() : null;
  if (code) {
    await holen(port, '/einrichtung', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, email: 'admin@beispiel.hu', passwort: 'passwort12345' }).toString(),
    });
  }
  await stop(pSetup);
  const { p, log } = await starteServer(tmpord, port, { EINRICHTUNGSMODUS: '1', PE_STRIPE_URL: STRIPE_MOCK_URL, ...extraEnv });
  return { p, log, hatAdmin: !!code };
}

async function einloggenUndCsrf4(port) {
  const r1 = await holen(port, '/anmelden');
  const cookie = r1.headers['set-cookie'] ?? '';
  const r2 = await holen(port, '/anmelden', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ email: 'admin@beispiel.hu', passwort: 'passwort12345' }).toString(),
  });
  const sessionCookie = r2.headers['set-cookie'] ?? cookie;
  await holen(port, '/api/admin/stepup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({ passwort: 'passwort12345' }),
  });
  const r3 = await holen(port, '/admin/einrichtung/schritt/4', { headers: { Cookie: sessionCookie } });
  const csrfMatch = r3.text.match(/name="csrf_token" value="([0-9a-f]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';
  return { sessionCookie, csrf, schritt4Html: r3.text };
}

async function postSchritt4(port, sessionCookie, csrf, felder) {
  return holen(port, '/admin/einrichtung/schritt/4', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sessionCookie },
    body: new URLSearchParams({ csrf_token: csrf, ...felder }).toString(),
  });
}

async function postStripeVerbindung(port, sessionCookie, csrf, koerper = {}) {
  return holen(port, '/admin/einrichtung/stripe-verbindung', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': csrf, Cookie: sessionCookie },
    body: JSON.stringify(koerper),
  });
}

// Gueltige Testwerte
const TEST_SK = 'sk_test_WP8TestKey123456789012';
const TEST_WHSEC = 'whsec_WP8TestWebhookGeheimnis123456789';

// ======================================================================
abschnitt('S1: GET /schritt/4 zeigt Stripe-Einrichtungsseite');
let tmpS1; const portS1 = 19601;
{
  tmpS1 = mkdtempSync(join(tmpdir(), 'wp8-s1-'));
  mkdirSync(join(tmpS1, 'daten'), { recursive: true });
  const { p, log, hatAdmin } = await einrichtungsmodusServer(tmpS1, portS1);
  pruefe('S1-1 Server gestartet', /Schulungsplattform/.test(log()), log());
  pruefe('S1-2 Admin angelegt', hatAdmin);

  const { sessionCookie, csrf, schritt4Html: html } = await einloggenUndCsrf4(portS1);
  pruefe('S1-3 GET /schritt/4 liefert 200', html.length > 50, `len=${html.length}`);
  pruefe('S1-4 CSRF-Token vorhanden', csrf.length === 64, `csrf='${csrf}'`);
  pruefe('S1-5 Stripe-Schluessel-Eingabe vorhanden', html.includes('STRIPE_SECRET_KEY'), html.slice(0, 200));
  pruefe('S1-6 Webhook-Secret-Eingabe vorhanden', html.includes('STRIPE_WEBHOOK_SECRET'), html.slice(0, 200));
  pruefe('S1-7 Webhook-Adresse sichtbar', html.includes('stripe-webhook-adresse'), html.slice(0, 200));
  pruefe('S1-8 Webhook-Adresse endet mit /webhook', /stripe-webhook-adresse[^<]*\/webhook</.test(html), html.slice(0, 300));
  pruefe('S1-9 Verbindung-testen-Button vorhanden', html.includes('stripe-verbindung-btn'), html.slice(0, 200));
  pruefe('S1-10 Webhook-ungeprueft-Hinweis sichtbar', html.includes('stripe-webhook-ungeprueft-hinweis'), html.slice(0, 200));
  pruefe('S1-11 Kein vollstaendiger Schluessel ohne gespeichertem Key', !/sk_test_[A-Za-z0-9]{12,}/.test(html), html.slice(0, 300));

  await stop(p); aufraeumen(tmpS1);
}

// ======================================================================
abschnitt('S2: Live-Schluessel werden abgelehnt, nichts gespeichert');
let tmpS2; const portS2 = 19602;
{
  tmpS2 = mkdtempSync(join(tmpdir(), 'wp8-s2-'));
  mkdirSync(join(tmpS2, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpS2, portS2);
  const { sessionCookie, csrf } = await einloggenUndCsrf4(portS2);

  const liveKeyFaelle = [
    ['sk_live_NICHT_ECHT', 'sk_live_... Standardform'],
    ['rk_live_NICHT_ECHT', 'rk_live_...'],
    ['SK_LIVE_NICHT_ECHT', 'SK_LIVE_... Grossbuchstaben'],
    ['sk_live', 'sk_live ohne Suffix'],
  ];
  for (const [key, beschreibung] of liveKeyFaelle) {
    const r = await postSchritt4(portS2, sessionCookie, csrf, { STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: TEST_WHSEC });
    pruefe(`S2 ${beschreibung} → 400`, r.status === 400, `status=${r.status} body='${r.text.slice(0, 80)}'`);
  }
  // Gegenprobe: nichts gespeichert (GET /schritt/4 zeigt kein gespeichertes Schluessel-Muster)
  // P12: neue Anmeldung loescht alte Sitzung → neues sessionCookie2/csrf2 ab hier verwenden.
  const { schritt4Html: htmlNach, sessionCookie: sessionCookie2, csrf: csrf2 } = await einloggenUndCsrf4(portS2);
  pruefe('S2-5 Live-Key nicht gespeichert', !htmlNach.includes('sk_live') && !htmlNach.includes('rk_live'), htmlNach.slice(0, 200));
  // Exakter Ablehnungstext laut Spezifikation
  const rExakt = await postSchritt4(portS2, sessionCookie2, csrf2, { STRIPE_SECRET_KEY: 'sk_live_NICHT_ECHT', STRIPE_WEBHOOK_SECRET: TEST_WHSEC });
  pruefe('S2-6 Ablehnungstext exakt', rExakt.text.includes('Echte Zahlungen sind in dieser Version noch nicht freigeschaltet'), `body='${rExakt.text.slice(0, 120)}'`);
  // Gegenprobe: Test-Schluessel wird akzeptiert
  stripeMockAntwortFn = () => ({ status: 200, body: { object: 'balance', available: [], pending: [] } });
  const rOk = await postSchritt4(portS2, sessionCookie2, csrf2, { STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC });
  pruefe('S2-7 Test-Schluessel → kein 400', rOk.status !== 400, `status=${rOk.status}`);
  pruefe('S2-8 Test-Schluessel → Redirect zu Schritt 5', rOk.status === 303 || rOk.headers['location']?.includes('schritt/5'), `status=${rOk.status} loc=${rOk.headers['location'] ?? ''}`);

  await stop(p); aufraeumen(tmpS2);
}

// ======================================================================
abschnitt('S3: Falsches Format abgelehnt');
let tmpS3; const portS3 = 19603;
{
  tmpS3 = mkdtempSync(join(tmpdir(), 'wp8-s3-'));
  mkdirSync(join(tmpS3, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpS3, portS3);
  const { sessionCookie, csrf } = await einloggenUndCsrf4(portS3);

  const r1 = await postSchritt4(portS3, sessionCookie, csrf, { STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: TEST_WHSEC });
  pruefe('S3-1 Leerer Schluessel → 400', r1.status === 400, `status=${r1.status}`);

  const r2 = await postSchritt4(portS3, sessionCookie, csrf, { STRIPE_SECRET_KEY: 'pk_test_PublicKey123456789', STRIPE_WEBHOOK_SECRET: TEST_WHSEC });
  pruefe('S3-2 Falsches Schluessel-Praefix → 400', r2.status === 400, `status=${r2.status}`);

  const r3 = await postSchritt4(portS3, sessionCookie, csrf, { STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: 'ungueltig_kein_whsec' });
  pruefe('S3-3 Falsches Webhook-Format → 400', r3.status === 400, `status=${r3.status}`);

  const r4 = await postSchritt4(portS3, sessionCookie, csrf, { STRIPE_SECRET_KEY: TEST_SK + '\x01', STRIPE_WEBHOOK_SECRET: TEST_WHSEC });
  pruefe('S3-4 Steuerzeichen im Schluessel → 400', r4.status === 400, `status=${r4.status}`);

  await stop(p); aufraeumen(tmpS3);
}

// ======================================================================
abschnitt('S4: Stripe-Verbindungsfehler → einfache Meldung, kein Schluessel im Text, kein Wiederholen');
let tmpS4; const portS4 = 19604;
{
  tmpS4 = mkdtempSync(join(tmpdir(), 'wp8-s4-'));
  mkdirSync(join(tmpS4, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpS4, portS4);

  // S4-1: kein Schluessel gespeichert → 400 kein_schluessel
  const { sessionCookie, csrf: csrf0 } = await einloggenUndCsrf4(portS4);
  const r41 = await postStripeVerbindung(portS4, sessionCookie, csrf0);
  pruefe('S4-1 Kein Schluessel gespeichert → 400', r41.status === 400, `status=${r41.status}`);
  let r41d; try { r41d = JSON.parse(r41.text); } catch { r41d = {}; }
  pruefe('S4-1 Fehler kein_schluessel', r41d.fehler === 'kein_schluessel', `fehler='${r41d.fehler}'`);

  // Schluessel speichern
  stripeMockAntwortFn = () => ({ status: 200, body: { object: 'balance', available: [], pending: [] } });
  const { sessionCookie: sc, csrf } = await einloggenUndCsrf4(portS4);
  await postSchritt4(portS4, sc, csrf, { STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC });

  // Neue Session nach Speichern
  const { sessionCookie: sck, csrf: csrf2 } = await einloggenUndCsrf4(portS4);

  // S4-2: Mock 401 → schluessel_abgelehnt
  stripeMockAnfragen = [];
  stripeMockAntwortFn = () => ({ status: 401, body: { error: { type: 'authentication_error', message: 'No such api_key' } } });
  const r42 = await postStripeVerbindung(portS4, sck, csrf2);
  let r42d; try { r42d = JSON.parse(r42.text); } catch { r42d = {}; }
  pruefe('S4-2 Mock 401 → schluessel_abgelehnt', r42d.fehler === 'schluessel_abgelehnt', `fehler='${r42d.fehler}' body='${r42.text.slice(0, 100)}'`);

  // S4-3: Einheit – Mock 500 → stripe_fehler (kein AJAX, vermeidet Abklingzeit)
  {
    let calls43 = 0;
    const mock43 = await new Promise((res, rej) => {
      const s = createServer((req, r) => { calls43++; r.writeHead(500, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ error: { message: 'Internal server error' } })); });
      s.listen(19643, '127.0.0.1', () => res(s));
      s.on('error', rej);
    });
    const r43 = await stripeVerbindungTesten({ stripeSecretKey: 'sk_test_FakeFor500Test12345678901', stripeOptionen: { host: '127.0.0.1', port: 19643, protocol: 'http' } });
    pruefe('S4-3 Mock 500 → stripe_fehler', r43.fehler === 'stripe_fehler', `fehler='${r43.fehler}'`);
    mock43.close();
  }

  // S4-4: Einheit – Timeout (stripeVerbindungTesten direkt, 200 ms Limit, haengender Mock)
  const hangPort = 19640;
  const hangServer = await new Promise((res, rej) => {
    const s = createServer(() => { /* haengt – kein Response */ });
    s.listen(hangPort, '127.0.0.1', () => res(s));
    s.on('error', rej);
  });
  const r44 = await stripeVerbindungTesten({ stripeSecretKey: 'sk_test_FakeTimeoutKey123456789', zeitlimitMs: 400, stripeOptionen: { host: '127.0.0.1', port: hangPort, protocol: 'http' } });
  pruefe('S4-4 Timeout → timeout', r44.fehler === 'timeout', `fehler='${r44.fehler}'`);
  hangServer.close();

  // S4-5: Einheit – Netz weg (geschlossener Port → netzwerk_fehler oder timeout)
  const r45 = await stripeVerbindungTesten({ stripeSecretKey: 'sk_test_FakeNetworkKey123456789', zeitlimitMs: 2000, stripeOptionen: { host: '127.0.0.1', port: 19641, protocol: 'http' } });
  pruefe('S4-5 Netz weg → Verbindungsfehler', r45.fehler === 'netzwerk_fehler' || r45.fehler === 'timeout', `fehler='${r45.fehler}'`);

  // S4-6: Einheit – maxNetworkRetries=0: genau ein Aufruf bei Fehler
  let callCount46 = 0;
  const countServer = await new Promise((res, rej) => {
    const s = createServer((req, r) => {
      callCount46++;
      r.writeHead(500, { 'Content-Type': 'application/json' });
      r.end(JSON.stringify({ error: { message: 'server error' } }));
    });
    s.listen(19642, '127.0.0.1', () => res(s));
    s.on('error', rej);
  });
  await stripeVerbindungTesten({ stripeSecretKey: 'sk_test_FakeRetryKey12345678901', stripeOptionen: { host: '127.0.0.1', port: 19642, protocol: 'http' } });
  pruefe('S4-6 maxNetworkRetries=0: genau ein Aufruf', callCount46 === 1, `aufrufe=${callCount46}`);
  countServer.close();

  // S4-7: Rate-Limit – zweiter Aufruf innerhalb 10s → 429
  const { sessionCookie: sck7a, csrf: csrf7a } = await einloggenUndCsrf4(portS4);
  stripeMockAntwortFn = () => ({ status: 200, body: { object: 'balance', available: [], pending: [] } });
  await postStripeVerbindung(portS4, sck7a, csrf7a);  // erster Aufruf verbraucht Abklingzeit
  const { sessionCookie: sck7b, csrf: csrf7b } = await einloggenUndCsrf4(portS4);
  const r47 = await postStripeVerbindung(portS4, sck7b, csrf7b);  // zweiter direkt danach
  pruefe('S4-7 Rate-Limit → 429', r47.status === 429, `status=${r47.status}`);

  await stop(p); aufraeumen(tmpS4);
}

// ======================================================================
abschnitt('S5: Webhook-Adresse stimmt mit realem Webhook-Pfad ueberein');
let tmpS5; const portS5 = 19605;
{
  tmpS5 = mkdtempSync(join(tmpdir(), 'wp8-s5-'));
  mkdirSync(join(tmpS5, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpS5, portS5);
  const { schritt4Html: html } = await einloggenUndCsrf4(portS5);

  // Adresse aus HTML extrahieren
  const adresseMatch = html.match(/id="stripe-webhook-adresse"[^>]*>([^<]+)</);
  const adresse = adresseMatch ? adresseMatch[1].trim() : '';
  pruefe('S5-1 Webhook-Adresse extrahierbar', adresse.length > 0, `html-snippet='${html.slice(0, 300)}'`);
  pruefe('S5-2 Webhook-Adresse endet mit /webhook', adresse.endsWith('/webhook'), `adresse='${adresse}'`);
  pruefe('S5-3 Webhook-Adresse verwendet korrekten Port', adresse.includes(String(portS5)), `adresse='${adresse}'`);

  await stop(p); aufraeumen(tmpS5);
}

// ======================================================================
abschnitt('S6: Schluessel nie im Klartext in Antworten oder Logs');
let tmpS6; const portS6 = 19606;
{
  tmpS6 = mkdtempSync(join(tmpdir(), 'wp8-s6-'));
  mkdirSync(join(tmpS6, 'daten'), { recursive: true });
  const { p, log } = await einrichtungsmodusServer(tmpS6, portS6);

  const geheimKey = 'sk_test_GeheimSchluessel123456789';
  const geheimWhsec = 'whsec_GeheimWebhookSecretABCDEFGH';

  // Schluessel speichern
  stripeMockAntwortFn = () => ({ status: 200, body: { object: 'balance', available: [], pending: [] } });
  const { sessionCookie: sc1, csrf: csrf1 } = await einloggenUndCsrf4(portS6);
  await postSchritt4(portS6, sc1, csrf1, { STRIPE_SECRET_KEY: geheimKey, STRIPE_WEBHOOK_SECRET: geheimWhsec });

  // GET /schritt/4 darf Schluessel nicht im Klartext zeigen
  const { sessionCookie: sc2, csrf: csrf2, schritt4Html: html } = await einloggenUndCsrf4(portS6);
  pruefe('S6-1 GET /schritt/4: Stripe-Key nicht im Klartext', !html.includes(geheimKey), html.includes('sk_') ? html.slice(html.indexOf('sk_'), html.indexOf('sk_') + 60) : '');
  pruefe('S6-2 GET /schritt/4: Webhook-Secret nicht im Klartext', !html.includes(geheimWhsec), html.includes('whsec_') ? html.slice(html.indexOf('whsec_'), html.indexOf('whsec_') + 60) : '');

  // AJAX-Antwort darf Schluessel nicht enthalten
  stripeMockAntwortFn = () => ({ status: 200, body: { object: 'balance', available: [], pending: [] } });
  const r = await postStripeVerbindung(portS6, sc2, csrf2);
  pruefe('S6-3 AJAX-Antwort: Schluessel nicht im Klartext', !r.text.includes(geheimKey) && !r.text.includes(geheimWhsec), `resp='${r.text.slice(0, 200)}'`);

  await stop(p); aufraeumen(tmpS6);
}

// ======================================================================
abschnitt('S7: Schluessel ersetzen – altes Geheimnis ist ueberschrieben');
let tmpS7; const portS7 = 19607;
{
  tmpS7 = mkdtempSync(join(tmpdir(), 'wp8-s7-'));
  mkdirSync(join(tmpS7, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpS7, portS7);

  stripeMockAntwortFn = () => ({ status: 200, body: { object: 'balance', available: [], pending: [] } });

  // Schluessel A speichern
  const keyA = 'sk_test_KeyAAAAAAAAAAAAAAAAAAA';
  const { sessionCookie: sc1, csrf: csrf1 } = await einloggenUndCsrf4(portS7);
  await postSchritt4(portS7, sc1, csrf1, { STRIPE_SECRET_KEY: keyA, STRIPE_WEBHOOK_SECRET: TEST_WHSEC });

  // Schritt-4-Seite zeigt gespeichertes Key-A-Muster (erster 8 Zeichen + *****)
  const { sessionCookie: sc2, csrf: csrf2, schritt4Html: html1 } = await einloggenUndCsrf4(portS7);
  pruefe('S7-1 Key-A gespeichert (Maske sichtbar)', html1.includes('sk_test_••••AAAA') && html1.includes('details'), `html-snippet='${html1.slice(0, 400)}'`);

  // Schluessel B ersetzen
  const keyB = 'sk_test_KeyBBBBBBBBBBBBBBBBBBB';
  await postSchritt4(portS7, sc2, csrf2, { STRIPE_SECRET_KEY: keyB, STRIPE_WEBHOOK_SECRET: TEST_WHSEC });

  // GET /schritt/4 zeigt jetzt Key-B-Muster, nicht Key-A
  const { schritt4Html: html2 } = await einloggenUndCsrf4(portS7);
  const keineSpurVonKeyA = !html2.includes('AAAAAAAAAAAAAAAAAAAAAAAAA');
  const keyBMaskiert = html2.includes('sk_te');
  pruefe('S7-2 Key-A nach Ersetzen nicht mehr sichtbar', keineSpurVonKeyA, html2.slice(0, 300));
  pruefe('S7-3 Key-B-Maske jetzt sichtbar', keyBMaskiert, html2.slice(0, 300));

  await stop(p); aufraeumen(tmpS7);
}

// ======================================================================
abschnitt('S8: CSRF und Sitzung');
let tmpS8; const portS8 = 19608;
{
  tmpS8 = mkdtempSync(join(tmpdir(), 'wp8-s8-'));
  mkdirSync(join(tmpS8, 'daten'), { recursive: true });
  const { p } = await einrichtungsmodusServer(tmpS8, portS8);
  const { sessionCookie, csrf } = await einloggenUndCsrf4(portS8);

  // S8-1: POST /schritt/4 ohne CSRF → 403
  const r81 = await holen(portS8, '/admin/einrichtung/schritt/4', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sessionCookie },
    body: new URLSearchParams({ STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC }).toString(),
  });
  pruefe('S8-1 POST ohne CSRF → 403', r81.status === 403, `status=${r81.status}`);

  // S8-2: POST /schritt/4 mit falschem CSRF → 403
  const r82 = await postSchritt4(portS8, sessionCookie, 'a'.repeat(64), { STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC });
  pruefe('S8-2 POST mit falschem CSRF → 403', r82.status === 403, `status=${r82.status}`);

  // S8-3: POST /stripe-verbindung ohne X-Csrf-Token → 403
  const r83 = await holen(portS8, '/admin/einrichtung/stripe-verbindung', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({}),
  });
  pruefe('S8-3 AJAX ohne X-Csrf-Token → 403', r83.status === 403, `status=${r83.status}`);

  // S8-4: GET /schritt/4 ohne Sitzung → Redirect
  const r84 = await holen(portS8, '/admin/einrichtung/schritt/4');
  pruefe('S8-4 GET ohne Sitzung → Redirect zu /anmelden', r84.status === 302 || r84.status === 303 || (r84.headers['location'] ?? '').includes('anmelden'), `status=${r84.status} loc=${r84.headers['location'] ?? ''}`);

  // S8-5: POST /stripe-verbindung mit falschem Origin → 403
  const r85 = await holen(portS8, '/admin/einrichtung/stripe-verbindung', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': csrf, Cookie: sessionCookie, Origin: 'http://evil.example.com' },
    body: JSON.stringify({}),
  });
  pruefe('S8-5 AJAX mit fremdem Origin → 403', r85.status === 403, `status=${r85.status}`);

  await stop(p); aufraeumen(tmpS8);
}

// ======================================================================
abschnitt('S9: Signiertes Testereignis akzeptiert, unsigniertes abgelehnt, Hinweis sichtbar');
let tmpS9; const portS9 = 19609;
{
  tmpS9 = mkdtempSync(join(tmpdir(), 'wp8-s9-'));
  mkdirSync(join(tmpS9, 'daten'), { recursive: true });

  // S9-1: Einheit – stripeWebhookSelbsttest mit gueltigem whsec_ → ok
  const r91 = stripeWebhookSelbsttest({ whsec: TEST_WHSEC });
  pruefe('S9-1 Webhook-Selbsttest mit gueltigem whsec_ → ok', r91.ok === true, `ergebnis=${JSON.stringify(r91)}`);

  // S9-2: Einrichtungsmodus – Hinweistext "Webhook ungeprüft" ist tatsaechlich im HTML gerendert
  {
    const tmpS9h = mkdtempSync(join(tmpdir(), 'wp8-s9h-'));
    mkdirSync(join(tmpS9h, 'daten'), { recursive: true });
    const { p: pH } = await einrichtungsmodusServer(tmpS9h, 19650);
    const { schritt4Html: htmlH } = await einloggenUndCsrf4(19650);
    pruefe('S9-2 Webhook-ungeprueft-Hinweis hat sichtbaren Textinhalt',
      htmlH.includes('stripe-webhook-ungeprueft-hinweis') &&
      /stripe-webhook-ungeprueft-hinweis[^>]*>[^<]+</.test(htmlH),
      htmlH.slice(0, 300));
    await stop(pH); aufraeumen(tmpS9h);
  }

  // S9-3 bis S9-5: Normalbetrieb-Server testen (/webhook-Route)
  const whsecNorm = 'whsec_NormbetriebWebhookTest1234567';
  const { p: pNorm } = await starteServer(tmpS9, portS9, {
    STRIPE_SECRET_KEY: 'sk_test_NormbetriebFakeKey123456789',
    STRIPE_WEBHOOK_SECRET: whsecNorm,
    BASE_URL: `http://127.0.0.1:${portS9}`,
  });

  // Warten bis Normalbetrieb laeuft
  for (let i = 0; i < 50; i++) {
    const r = await holen(portS9, '/health').catch(() => null);
    if (r?.status) break;
    await warte(200);
  }

  // Hilfsfunktion: signiertes Webhook-Ereignis senden
  const stripeFuerSignatur = new Stripe('sk_test_FakeKeyForHeaderGeneration1234');
  async function sendeWebhook(payload, sigHeader) {
    return fetch(`http://127.0.0.1:${portS9}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': sigHeader },
      body: payload,
    });
  }

  // Testereignis: customer.subscription.updated ohne Abo-ID → keine Stripe-API-Aufrufe noetig
  const payload93 = JSON.stringify({
    id: 'evt_test_wp8_s9',
    object: 'event',
    type: 'customer.subscription.updated',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
  });
  const header93 = stripeFuerSignatur.webhooks.generateTestHeaderString({ payload: payload93, secret: whsecNorm });

  // S9-3: korrekte Signatur → kein 400 (Signatur wird akzeptiert)
  const r93 = await sendeWebhook(payload93, header93);
  pruefe('S9-3 Korrektes Ereignis → kein 400 (Signatur ok)', r93.status !== 400, `status=${r93.status}`);

  // S9-4: falsche Signatur → 400
  const r94 = await sendeWebhook(payload93, 't=1,v1=aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899');
  pruefe('S9-4 Falsche Signatur → 400', r94.status === 400, `status=${r94.status}`);

  // S9-5: livemode=true → 400
  const payload95 = JSON.stringify({
    id: 'evt_test_wp8_s9_live',
    object: 'event',
    type: 'customer.subscription.updated',
    livemode: true,
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
  });
  const header95 = stripeFuerSignatur.webhooks.generateTestHeaderString({ payload: payload95, secret: whsecNorm });
  const r95 = await sendeWebhook(payload95, header95);
  pruefe('S9-5 livemode=true → 400', r95.status === 400, `status=${r95.status}`);

  await stop(pNorm); aufraeumen(tmpS9);
}

// ======================================================================
abschnitt('N1: abgleichModus steuert Livemode-Pruefung');
let tmpN1; const portN1 = 19641;
{
  // N1-1 und N1-2: Testmodus via normalem Normalbetrieb-Server (sk_test_ → abgleichModus='test')
  tmpN1 = mkdtempSync(join(tmpdir(), 'wp8-n1-'));
  mkdirSync(join(tmpN1, 'daten'), { recursive: true });
  const whsecN1 = 'whsec_NachbesserungN1TestKey12345678';
  const { p: pN1 } = await starteServer(tmpN1, portN1, {
    STRIPE_SECRET_KEY: 'sk_test_NachbesserungN1FakeKey1234567',
    STRIPE_WEBHOOK_SECRET: whsecN1,
    BASE_URL: `http://127.0.0.1:${portN1}`,
    PE_STRIPE_URL: STRIPE_MOCK_URL,
  });
  for (let i = 0; i < 50; i++) {
    const r = await holen(portN1, '/health').catch(() => null);
    if (r?.status) break;
    await warte(200);
  }
  const stripeN1 = new Stripe('sk_test_FakeKeyForN1HeaderGen1234567');

  // N1-1: Testmodus + livemode=false → angenommen (kein webhook_livemode_abgelehnt)
  const pN11 = JSON.stringify({ id: 'evt_n1_1', object: 'event', type: 'customer.subscription.updated', livemode: false, created: Math.floor(Date.now() / 1000), data: { object: {} } });
  const hN11 = stripeN1.webhooks.generateTestHeaderString({ payload: pN11, secret: whsecN1 });
  const rN11 = await fetch(`http://127.0.0.1:${portN1}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': hN11 }, body: pN11 });
  const tN11 = await rN11.text();
  pruefe('N1-1 Testmodus + livemode=false → nicht wegen Modus abgelehnt', !tN11.includes('webhook_livemode_abgelehnt'), `status=${rN11.status} text=${tN11.slice(0, 100)}`);

  // N1-2: Testmodus + livemode=true → 400 (Gegenprobe zu N1-1)
  const pN12 = JSON.stringify({ id: 'evt_n1_2', object: 'event', type: 'customer.subscription.updated', livemode: true, created: Math.floor(Date.now() / 1000), data: { object: {} } });
  const hN12 = stripeN1.webhooks.generateTestHeaderString({ payload: pN12, secret: whsecN1 });
  const rN12 = await fetch(`http://127.0.0.1:${portN1}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': hN12 }, body: pN12 });
  const tN12 = await rN12.text();
  pruefe('N1-2 Testmodus + livemode=true → 400 (Gegenprobe)', rN12.status === 400 && tN12.includes('webhook_livemode_abgelehnt'), `status=${rN12.status} text=${tN12.slice(0, 100)}`);

  await stop(pN1); aufraeumen(tmpN1);
}

// N1-3 und N1-4: Live-Modus via In-Prozess-Server (direkter webhookHandler-Aufruf, kein konfig.mjs)
// konfig.mjs erlaubt sk_live_ noch nicht; der Handler selbst wird hier direkt mit abgleichModus='live' getestet.
let tmpN1L;
{
  tmpN1L = mkdtempSync(join(tmpdir(), 'wp8-n1l-'));
  mkdirSync(join(tmpN1L, 'daten'), { recursive: true });
  // DB_DATEI vor dem dynamischen Import setzen, damit db.mjs die richtige Datei oeffnet.
  process.env.DB_DATEI = join(tmpN1L, 'daten', 'n1l.db');
  const { webhookHandler } = await import('../zahlung.mjs');

  const portN1L = 19642;
  const whsecN1L = 'whsec_NachbesserungN1LiveAttrappe12345';
  const stripeN1L = new Stripe('sk_test_FakeKeyN1LiveHeaderGen12345678');

  const appN1L = express();
  appN1L.disable('x-powered-by');
  appN1L.post('/webhook', ...webhookHandler({ stripe: stripeN1L, webhookSecret: whsecN1L, mails: null, abgleichModus: 'live' }));
  const srvN1L = await new Promise((res, rej) => { const s = appN1L.listen(portN1L, '127.0.0.1', () => res(s)); s.on('error', rej); });

  // N1-3: Live-Modus + livemode=true → nicht wegen Modus abgelehnt
  const pN13 = JSON.stringify({ id: 'evt_n1_3', object: 'event', type: 'customer.subscription.updated', livemode: true, created: Math.floor(Date.now() / 1000), data: { object: {} } });
  const hN13 = stripeN1L.webhooks.generateTestHeaderString({ payload: pN13, secret: whsecN1L });
  const rN13 = await fetch(`http://127.0.0.1:${portN1L}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': hN13 }, body: pN13 });
  const tN13 = await rN13.text();
  pruefe('N1-3 Live-Modus + livemode=true → nicht wegen Modus abgelehnt', !tN13.includes('webhook_livemode_abgelehnt'), `status=${rN13.status} text=${tN13.slice(0, 100)}`);

  // N1-4: Live-Modus + livemode=false → 400 (Gegenprobe zu N1-3)
  const pN14 = JSON.stringify({ id: 'evt_n1_4', object: 'event', type: 'customer.subscription.updated', livemode: false, created: Math.floor(Date.now() / 1000), data: { object: {} } });
  const hN14 = stripeN1L.webhooks.generateTestHeaderString({ payload: pN14, secret: whsecN1L });
  const rN14 = await fetch(`http://127.0.0.1:${portN1L}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': hN14 }, body: pN14 });
  const tN14 = await rN14.text();
  pruefe('N1-4 Live-Modus + livemode=false → 400 (Gegenprobe)', rN14.status === 400 && tN14.includes('webhook_livemode_abgelehnt'), `status=${rN14.status} text=${tN14.slice(0, 100)}`);

  srvN1L.close();
  aufraeumen(tmpN1L);
}

// ======================================================================
abschnitt('N2: Globaler Fehlerhandler neutralisiert Express-Stacktraces');
// N2-GP: Gegenprobe – ohne globalen Fehlerhandler gibt Express den Stacktrace heraus.
{
  const portN2GP = 19643;
  const appGP = express();
  appGP.disable('x-powered-by');
  // Limit 100 Bytes, kein globaler Fehlerhandler (simuliert den Zustand vor der Nachbesserung).
  appGP.post('/logo-upload', express.raw({ type: 'application/octet-stream', limit: 100 }), (_req, res) => { res.json({ ok: true }); });
  const srvGP = await new Promise((res, rej) => { const s = appGP.listen(portN2GP, '127.0.0.1', () => res(s)); s.on('error', rej); });
  const rGP = await fetch(`http://127.0.0.1:${portN2GP}/logo-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.alloc(600, 0xAB),
  });
  const tGP = await rGP.text();
  // Express-Standardhandler (dev) schreibt Fehlertyp oder Stack in die Antwort.
  pruefe('N2-GP Ohne Fehlerhandler: Antwort enthaelt Fehlertyp (Gegenprobe)', tGP.includes(' at ') || tGP.includes('PayloadTooLargeError') || tGP.includes('request entity too large') || tGP.toLowerCase().includes('error'), `status=${rGP.status} text=${tGP.slice(0, 200)}`);
  srvGP.close();
}

// N2-1 bis N2-6: Einrichtungsmodus mit globalem Fehlerhandler.
let tmpN2; const portN2 = 19644;
{
  tmpN2 = mkdtempSync(join(tmpdir(), 'wp8-n2-'));
  mkdirSync(join(tmpN2, 'daten'), { recursive: true });
  const { p: pN2 } = await einrichtungsmodusServer(tmpN2, portN2);
  const { sessionCookie, csrf } = await einloggenUndCsrf4(portN2);

  // N2-1 + N2-2: 600 kB an /logo-upload → 413, kein Stacktrace
  const groesserAlsLimit = Buffer.alloc(600 * 1024, 0xAB);
  const rN21 = await fetch(`http://127.0.0.1:${portN2}/admin/einrichtung/logo-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: sessionCookie },
    body: groesserAlsLimit,
  });
  const tN21 = await rN21.text();
  pruefe('N2-1 600 kB an logo-upload → 413', rN21.status === 413, `status=${rN21.status} text=${tN21.slice(0, 100)}`);
  pruefe('N2-2 Antwort enthaelt keinen Stacktrace (logo-upload)', !tN21.includes(' at ') && !tN21.includes('node_modules'), `text=${tN21.slice(0, 200)}`);

  // N2-3 + N2-4: Ungueltiges JSON an /mail-test → 400, kein Stacktrace
  const rN23 = await fetch(`http://127.0.0.1:${portN2}/admin/einrichtung/mail-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': csrf, Cookie: sessionCookie },
    body: '{ungueltiges json',
  });
  const tN23 = await rN23.text();
  pruefe('N2-3 Ungueltiges JSON an mail-test → 400', rN23.status === 400, `status=${rN23.status} text=${tN23.slice(0, 100)}`);
  pruefe('N2-4 Antwort enthaelt keinen Stacktrace (mail-test)', !tN23.includes(' at ') && !tN23.includes('node_modules'), `text=${tN23.slice(0, 200)}`);

  // N2-5 + N2-6: Ungueltiges JSON an /stripe-verbindung → 400, kein Stacktrace
  const rN25 = await fetch(`http://127.0.0.1:${portN2}/admin/einrichtung/stripe-verbindung`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': csrf, Cookie: sessionCookie },
    body: '{ungueltiges json',
  });
  const tN25 = await rN25.text();
  pruefe('N2-5 Ungueltiges JSON an stripe-verbindung → 400', rN25.status === 400, `status=${rN25.status} text=${tN25.slice(0, 100)}`);
  pruefe('N2-6 Antwort enthaelt keinen Stacktrace (stripe-verbindung)', !tN25.includes(' at ') && !tN25.includes('node_modules'), `text=${tN25.slice(0, 200)}`);

  await stop(pN2); aufraeumen(tmpN2);
}

// ======================================================================
abschnitt('N3: Livemode-Typ-Pruefung – nur boolean akzeptiert');
// zahlung.mjs ist bereits gecacht vom N1L-Block; re-import gibt dasselbe Modul.
// Die Livemode-Pruefung laeuft vor jeder DB-Aktion, stale Handle ist kein Problem.
let tmpN3;
{
  tmpN3 = mkdtempSync(join(tmpdir(), 'wp8-n3-'));
  mkdirSync(join(tmpN3, 'daten'), { recursive: true });
  const { webhookHandler } = await import('../zahlung.mjs');
  const portN3 = 19645;
  const whsecN3 = 'whsec_NachbesserungN3TypeTest12345678';
  const stripeN3 = new Stripe('sk_test_FakeKeyN3TypeTestHeader12345');

  const appN3 = express();
  appN3.disable('x-powered-by');
  appN3.post('/webhook', ...webhookHandler({ stripe: stripeN3, webhookSecret: whsecN3, mails: null, abgleichModus: 'test' }));
  const srvN3 = await new Promise((res, rej) => { const s = appN3.listen(portN3, '127.0.0.1', () => res(s)); s.on('error', rej); });

  const basis3 = { object: 'event', type: 'customer.subscription.updated', created: Math.floor(Date.now() / 1000), data: { object: {} } };
  async function sendeN3(extraFelder) {
    const payload = JSON.stringify({ ...basis3, ...extraFelder });
    const hdr = stripeN3.webhooks.generateTestHeaderString({ payload, secret: whsecN3 });
    const r = await fetch(`http://127.0.0.1:${portN3}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': hdr }, body: payload });
    return { status: r.status, text: await r.text() };
  }

  // N3-1: livemode-Feld fehlt komplett → 400
  const rN31 = await sendeN3({ id: 'evt_n3_1' });
  pruefe('N3-1 Kein livemode-Feld → 400 webhook_livemode_abgelehnt', rN31.status === 400 && rN31.text.includes('webhook_livemode_abgelehnt'), `status=${rN31.status} text=${rN31.text.slice(0, 100)}`);

  // N3-2: livemode=null → 400
  const rN32 = await sendeN3({ id: 'evt_n3_2', livemode: null });
  pruefe('N3-2 livemode=null → 400 webhook_livemode_abgelehnt', rN32.status === 400 && rN32.text.includes('webhook_livemode_abgelehnt'), `status=${rN32.status} text=${rN32.text.slice(0, 100)}`);

  // N3-3: livemode='false' (Text statt Boolean) → 400
  const rN33 = await sendeN3({ id: 'evt_n3_3', livemode: 'false' });
  pruefe("N3-3 livemode='false' (Text) → 400 webhook_livemode_abgelehnt", rN33.status === 400 && rN33.text.includes('webhook_livemode_abgelehnt'), `status=${rN33.status} text=${rN33.text.slice(0, 100)}`);

  // N3-GP: livemode=false (Boolean, korrekt fuer Testmodus) → Gegenprobe, kein livemode_abgelehnt
  const rN3GP = await sendeN3({ id: 'evt_n3_gp', livemode: false });
  pruefe('N3-GP livemode=false (Boolean) → kein webhook_livemode_abgelehnt (Gegenprobe)', !rN3GP.text.includes('webhook_livemode_abgelehnt'), `status=${rN3GP.status} text=${rN3GP.text.slice(0, 100)}`);

  srvN3.close();
  aufraeumen(tmpN3);
}

// ======================================================================
abschnitt('N4: key_loeschen – Transaktion schuetzt vor Halbloeschung');
let tmpN4; const portN4 = 19646;
{
  tmpN4 = mkdtempSync(join(tmpdir(), 'wp8-n4-'));
  mkdirSync(join(tmpN4, 'daten'), { recursive: true });
  stripeMockAntwortFn = () => ({ status: 200, body: { object: 'balance', available: [], pending: [] } });
  const { p: pN4 } = await einrichtungsmodusServer(tmpN4, portN4);

  // Schluesseln speichern (POST schritt/4 mit gueltigen Test-Werten)
  const { sessionCookie: sc4a, csrf: csrf4a } = await einloggenUndCsrf4(portN4);
  await postSchritt4(portN4, sc4a, csrf4a, { STRIPE_SECRET_KEY: TEST_SK, STRIPE_WEBHOOK_SECRET: TEST_WHSEC });

  // Trigger einrichten: schlaegt beim DELETE von einrichtung_schritt_4 fehl → Rollback
  const dbTrig = new DatabaseSync(join(tmpN4, 'app.db'));
  dbTrig.exec("CREATE TRIGGER wp8_n4_fail BEFORE DELETE ON einstellungen WHEN old.schluessel='einrichtung_schritt_4' BEGIN SELECT RAISE(FAIL,'n4_sim'); END");
  dbTrig.close();

  // key_loeschen mit aktivem Trigger → 500 speicher_fehler
  const { sessionCookie: sc4b, csrf: csrf4b } = await einloggenUndCsrf4(portN4);
  const rN41 = await postSchritt4(portN4, sc4b, csrf4b, { aktion: 'key_loeschen' });
  pruefe('N4-1 Fehlfall key_loeschen → 500 speicher_fehler', rN41.status === 500 && rN41.text.includes('speicher_fehler'), `status=${rN41.status} text=${rN41.text.slice(0, 100)}`);

  // Alle drei Zeilen muessen noch vorhanden sein (Rollback hat alle drei DELETEs rueckgaengig gemacht)
  const dbChk = new DatabaseSync(join(tmpN4, 'app.db'), { readOnly: true });
  const skRow = dbChk.prepare("SELECT 1 FROM einstellungen WHERE schluessel='STRIPE_SECRET_KEY'").get();
  const whRow = dbChk.prepare("SELECT 1 FROM einstellungen WHERE schluessel='STRIPE_WEBHOOK_SECRET'").get();
  const s4Row = dbChk.prepare("SELECT 1 FROM einstellungen WHERE schluessel='einrichtung_schritt_4'").get();
  dbChk.close();
  pruefe('N4-2 Nach Fehlfall: STRIPE_SECRET_KEY unveraendert (Rollback)', !!skRow, 'Zeile fehlt');
  pruefe('N4-3 Nach Fehlfall: STRIPE_WEBHOOK_SECRET unveraendert (Rollback)', !!whRow, 'Zeile fehlt');
  pruefe('N4-4 Nach Fehlfall: einrichtung_schritt_4 unveraendert (Rollback)', !!s4Row, 'Zeile fehlt');

  // Trigger entfernen, dann normalen Loeschweg testen (Gegenprobe: bleibt gruen)
  const dbDrop = new DatabaseSync(join(tmpN4, 'app.db'));
  dbDrop.exec('DROP TRIGGER IF EXISTS wp8_n4_fail');
  dbDrop.close();

  const { sessionCookie: sc4c, csrf: csrf4c } = await einloggenUndCsrf4(portN4);
  const rN45 = await postSchritt4(portN4, sc4c, csrf4c, { aktion: 'key_loeschen' });
  pruefe('N4-5 Normaler Loeschweg → 303', rN45.status === 303, `status=${rN45.status}`);

  const dbAfter = new DatabaseSync(join(tmpN4, 'app.db'), { readOnly: true });
  const skGone = dbAfter.prepare("SELECT 1 FROM einstellungen WHERE schluessel='STRIPE_SECRET_KEY'").get();
  const whGone = dbAfter.prepare("SELECT 1 FROM einstellungen WHERE schluessel='STRIPE_WEBHOOK_SECRET'").get();
  const s4Gone = dbAfter.prepare("SELECT 1 FROM einstellungen WHERE schluessel='einrichtung_schritt_4'").get();
  dbAfter.close();
  pruefe('N4-6 Nach erfolgreichem Loeschen: alle Schluesseldaten entfernt', !skGone && !whGone && !s4Gone, `sk=${!!skGone} wh=${!!whGone} s4=${!!s4Gone}`);

  await stop(pN4); aufraeumen(tmpN4);
}

// ======================================================================
stripeMockServer.close();
const gesamt = ok + schlecht;
console.log(`\n${schlecht === 0 ? 'Alle' : schlecht + ' von'} ${gesamt} Pruefungen ${schlecht === 0 ? 'bestanden' : 'fehlgeschlagen'} (${ok} ok, ${schlecht} schlecht)`);
process.exit(schlecht > 0 ? 1 : 0);
