import './test-sprache.mjs';
// P12 (F-49, OWASP Session Management): Idle-Timeout, absoluter Timeout, Step-up-Auth.
// Admin: 15 Min Leerlauf, 8h absolut, neue Anmeldung beendet alte Sitzungen.
// Käufer: 24h Leerlauf, 7 Tage absolut.
// POST /api/admin/stepup: Passwort-Bestätigung (5 Min gültig) vor Zugriff auf kritische Routen.
// GET /api/admin/sitzung-info: Timing-Info für Warn-Anzeige in der Admin-Oberfläche.
// Tests mit verschiebbarer Uhr (kein echtes Warten). Muss mit main (48b8c1a) ROT sein.
// Aufruf: node --disable-warning=ExperimentalWarning tools/selbsttest-sitzungsablauf.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ordner = mkdtempSync(join(tmpdir(), 'schulung-sitzungsablauf-'));
process.env.DB_DATEI = join(ordner, 'test.db');
const PORT = 4501, BASE = 'http://127.0.0.1:' + PORT;
const echtJetzt = Date.now; let versatz = 0; Date.now = () => echtJetzt() + versatz;
let gut = 0, schlecht = 0, server;
const pruefe = (name, ok, info = '') => { ok ? gut++ : schlecht++; console.log((ok ? 'OK     ' : 'FEHLER ') + name + (ok || !info ? '' : ' -> ' + info)); };

const j = (pfad, methode = 'GET', body, cookie = '') => {
  const h = { 'Content-Type': 'application/json' };
  if (cookie) h.Cookie = cookie;
  return fetch(`${BASE}${pfad}`, { method: methode, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
};
const cookie = (res) => res.headers.get('set-cookie')?.split(';')[0] ?? '';
const angemeldet = async (c) => (await (await j('/api/ich', 'GET', undefined, c)).json()).angemeldet;

try {
  const A = await import('../auth.mjs');

  // ---- Konstanten ----
  pruefe('ADMIN_IDLE_MS: 15 Minuten', A.ADMIN_IDLE_MS === 15 * 60 * 1000);
  pruefe('ADMIN_ABSOLUT_MS: 8 Stunden', A.ADMIN_ABSOLUT_MS === 8 * 60 * 60 * 1000);
  pruefe('KUNDE_IDLE_MS: 24 Stunden', A.KUNDE_IDLE_MS === 24 * 60 * 60 * 1000);
  pruefe('KUNDE_ABSOLUT_MS: 7 Tage', A.KUNDE_ABSOLUT_MS === 7 * 24 * 60 * 60 * 1000);
  pruefe('STEPUP_MS: 5 Minuten', A.STEPUP_MS === 5 * 60 * 1000);
  pruefe('SITZUNG_WARNUNG_MS: 2 Minuten', A.SITZUNG_WARNUNG_MS === 2 * 60 * 1000);

  const { db } = await import('../db.mjs');
  const { erstelleServer } = await import('../app.mjs');

  const pw = 'TestPasswort1!';
  const hash = await A.passwortHashen(pw);
  const zeit = new Date().toISOString();
  db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,?,?,?)").run('admin@beispiel.hu', hash, 'admin', zeit, echtJetzt());
  db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,?,?,?)").run('kunde@beispiel.hu', hash, 'kunde', zeit, echtJetzt());

  const stripe = { webhooks: { constructEvent: () => { throw Error('nicht benutzt'); } } };
  server = erstelleServer({ stripe, webhookSecret: 'whsec_nur_test', base: BASE,
    adminErlaubt: ['admin@beispiel.hu'], abgleichAutomatik: false }).listen(PORT, '127.0.0.1');
  await new Promise(r => server.listening ? r() : server.once('listening', r));

  const anmelden = async (email, passwort = pw) => {
    const r = await j('/api/anmelden', 'POST', { email, passwort });
    return cookie(r);
  };

  // ---- Admin: Idle-Timeout nach 15 Minuten ----
  const c1 = await anmelden('admin@beispiel.hu');
  pruefe('Admin nach Anmeldung aktiv', await angemeldet(c1));
  versatz += A.ADMIN_IDLE_MS + 1;
  pruefe('Admin nach 15 Min Leerlauf abgemeldet', !await angemeldet(c1));
  versatz = 0;

  // ---- Admin: Leerlauf verlängert sich durch Anfragen ----
  const c2 = await anmelden('admin@beispiel.hu');
  versatz += A.ADMIN_IDLE_MS - 60000; // 1 Min vor Ablauf
  await j('/api/ich', 'GET', undefined, c2); // aktive Anfrage verlängert Leerlauf
  versatz += A.ADMIN_IDLE_MS - 60000; // weitere fast-15 Min
  pruefe('Leerlauf nach Anfrage verlängert (noch aktiv)', await angemeldet(c2));
  versatz = 0;

  // ---- Admin: 8 Stunden absoluter Timeout ----
  const c3 = await anmelden('admin@beispiel.hu');
  versatz += A.ADMIN_ABSOLUT_MS + 1;
  pruefe('Admin nach 8h absolut abgemeldet', !await angemeldet(c3));
  versatz = 0;

  // ---- Neue Admin-Anmeldung beendet alte Sitzung ----
  const cAlt = await anmelden('admin@beispiel.hu');
  pruefe('Alte Sitzung vor neuem Login aktiv', await angemeldet(cAlt));
  await anmelden('admin@beispiel.hu'); // neue Anmeldung
  pruefe('Alte Sitzung nach neuem Login ungültig', !await angemeldet(cAlt));

  // ---- Käufer: Idle-Timeout nach 24 Stunden ----
  const cK = await anmelden('kunde@beispiel.hu');
  versatz += A.KUNDE_IDLE_MS + 1;
  pruefe('Kunde nach 24h Leerlauf abgemeldet', !await angemeldet(cK));
  versatz = 0;

  // ---- Käufer: 7 Tage absolut ----
  const cK2 = await anmelden('kunde@beispiel.hu');
  versatz += A.KUNDE_ABSOLUT_MS + 1;
  pruefe('Kunde nach 7 Tagen absolut abgemeldet', !await angemeldet(cK2));
  versatz = 0;

  // ---- GET /api/admin/sitzung-info ----
  const cInfo = await anmelden('admin@beispiel.hu');
  const infoRes = await j('/api/admin/sitzung-info', 'GET', undefined, cInfo);
  pruefe('GET /api/admin/sitzung-info: 200', infoRes.status === 200, infoRes.status);
  if (infoRes.status === 200) {
    const info = await infoRes.json();
    pruefe('sitzung-info hat naechstes_ende', typeof info.naechstes_ende === 'number');
    pruefe('sitzung-info hat warnung_ab', typeof info.warnung_ab === 'number');
    pruefe('sitzung-info naechstes_ende <= jetzt + 15 Min', info.naechstes_ende <= Date.now() + A.ADMIN_IDLE_MS);
  } else { for (const n of ['sitzung-info hat naechstes_ende', 'sitzung-info hat warnung_ab', 'sitzung-info naechstes_ende <= jetzt + 15 Min']) pruefe(n, false, '404'); }

  // ---- POST /api/admin/stepup ----
  const cStep = await anmelden('admin@beispiel.hu');
  const sf = await j('/api/admin/stepup', 'POST', { passwort: 'falschesPasswort' }, cStep);
  pruefe('Step-up: falsches Passwort → 403', sf.status === 403, sf.status);
  const sr = await j('/api/admin/stepup', 'POST', { passwort: pw }, cStep);
  pruefe('Step-up: richtiges Passwort → 200', sr.status === 200, sr.status);

  // ---- Step-up abgelaufen nach 5 Minuten ----
  const cStep2 = await anmelden('admin@beispiel.hu');
  await j('/api/admin/stepup', 'POST', { passwort: pw }, cStep2);
  versatz += A.STEPUP_MS + 1;
  const wr1 = await j('/api/admin/widerrufe/1/erledigt', 'POST',
    { begruendung: 'x'.repeat(5), fallreferenz: 'ref-123', stripe_geprueft: true }, cStep2);
  pruefe('Step-up nach 5 Min abgelaufen → 401', wr1.status === 401, wr1.status);
  versatz = 0;

  // ---- Widerruf-erledigt ohne Step-up → 401 ----
  const cNoStep = await anmelden('admin@beispiel.hu');
  const wr2 = await j('/api/admin/widerrufe/1/erledigt', 'POST',
    { begruendung: 'x'.repeat(5), fallreferenz: 'ref-123', stripe_geprueft: true }, cNoStep);
  pruefe('Widerruf-erledigt ohne Step-up → 401', wr2.status === 401, wr2.status);

  // ---- Widerruf-erledigt mit gültigem Step-up → nicht 401 ----
  await j('/api/admin/stepup', 'POST', { passwort: pw }, cNoStep);
  const wr3 = await j('/api/admin/widerrufe/1/erledigt', 'POST',
    { begruendung: 'x'.repeat(5), fallreferenz: 'ref-123', stripe_geprueft: true }, cNoStep);
  pruefe('Widerruf-erledigt mit Step-up → nicht 401', wr3.status !== 401, wr3.status);

  // ---- F-109: Brute-Force-Schutz für /api/admin/stepup ----
  A.fehlversucheAlleLoeschen();
  const cBf = await anmelden('admin@beispiel.hu');
  const bfFehler = [];
  for (let i = 0; i < 5; i++) bfFehler.push((await j('/api/admin/stepup', 'POST', { passwort: 'falsch' }, cBf)).status);
  pruefe('F-109: 5 Fehlversuche Stepup → alle 403 (kein Lock)', bfFehler.every(s => s === 403), bfFehler.join());
  const bf6 = await j('/api/admin/stepup', 'POST', { passwort: 'falsch' }, cBf);
  pruefe('F-109: 6. Fehlversuch Stepup → 429 (gesperrt)', bf6.status === 429, bf6.status);
  A.fehlversucheAlleLoeschen();

  // ---- F-110: Admin-Sitzung ohne zuletzt_aktiv läuft bei erstellt + ADMIN_ABSOLUT_MS ab ----
  const cF110 = await anmelden('admin@beispiel.hu');
  const tokenF110 = cF110.replace(/^sitzung=/, '');
  const hashF110 = A.sitzungFingerabdruck(tokenF110);
  db.prepare('UPDATE sitzungen SET zuletzt_aktiv = NULL WHERE token_hash = ?').run(hashF110);
  pruefe('F-110: Sitzung ohne zuletzt_aktiv im gültigen Fenster aktiv', (await j('/api/ich', 'GET', undefined, cF110)).ok);
  versatz += A.ADMIN_ABSOLUT_MS + 1;
  pruefe('F-110: Sitzung ohne zuletzt_aktiv nach ADMIN_ABSOLUT_MS abgemeldet', !await angemeldet(cF110));
  versatz = 0;

  // ---- F-111: GET /api/admin/sitzung-info verlängert zuletzt_aktiv NICHT ----
  const cF111 = await anmelden('admin@beispiel.hu');
  const tokenF111 = cF111.replace(/^sitzung=/, '');
  const hashF111 = A.sitzungFingerabdruck(tokenF111);
  const vorInfo = db.prepare('SELECT zuletzt_aktiv FROM sitzungen WHERE token_hash = ?').get(hashF111);
  versatz += 1000; // 1 Sekunde verschieben
  await j('/api/admin/sitzung-info', 'GET', undefined, cF111);
  const nachInfo = db.prepare('SELECT zuletzt_aktiv FROM sitzungen WHERE token_hash = ?').get(hashF111);
  pruefe('F-111: sitzung-info ändert zuletzt_aktiv nicht', vorInfo?.zuletzt_aktiv === nachInfo?.zuletzt_aktiv,
    `vorher=${vorInfo?.zuletzt_aktiv} nachher=${nachInfo?.zuletzt_aktiv}`);
  // /api/ich hingegen verlängert zuletzt_aktiv (Kontrolltest)
  await j('/api/ich', 'GET', undefined, cF111);
  const nachIch = db.prepare('SELECT zuletzt_aktiv FROM sitzungen WHERE token_hash = ?').get(hashF111);
  pruefe('F-111 Kontrolle: /api/ich verlängert zuletzt_aktiv', nachIch?.zuletzt_aktiv !== vorInfo?.zuletzt_aktiv,
    `vorher=${vorInfo?.zuletzt_aktiv} nachher=${nachIch?.zuletzt_aktiv}`);
  versatz = 0;

} catch (e) {
  schlecht++;
  console.log('FEHLER Abbruch: ' + (e?.stack || e));
} finally {
  Date.now = echtJetzt;
  server?.close();
  setTimeout(() => {
    try { rmSync(ordner, { recursive: true, force: true }); } catch { /* Temp */ }
    console.log(`\nsitzungsablauf: ${gut} OK, ${schlecht} FEHLER`);
    process.exit(schlecht ? 1 : 0);
  }, 100);
}
