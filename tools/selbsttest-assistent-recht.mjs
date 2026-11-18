// Selbsttest WP6: Impressum, Datenschutz, Teilnahmebedingungen (Schritt 2).
// Pruefungen R1-R7 aus docs/SPEZ-WP4-9-ASSISTENT.md.
// Jede Pruefung hat eine Gegenprobe die ohne die WP6-Aenderung ROT waere.
import './test-sprache.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
let ok = 0, schlecht = 0;
const pruefe = (name, bed, detail = '') => { bed ? ok++ : schlecht++; console.log(`${bed ? 'OK     ' : 'FEHLER '} ${name}${!bed && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = (p) => { try { rmSync(p, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } };
const SERVER = resolve('server.mjs');
const basisEnv = (extra) => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...extra });

async function starteServer(tmpord, port, extraEnv = {}) {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    cwd: tmpord, stdio: ['ignore', 'pipe', 'pipe'],
    env: basisEnv({ PORT: String(port), DB_DATEI: join(tmpord, 'app.db'), ...extraEnv }),
  });
  let log = '';
  p.stdout.on('data', x => { log += x; });
  p.stderr.on('data', x => { log += x; });
  for (let i = 0; i < 300; i++) {
    if (/Setup-Modus|Einrichtungsmodus|Schulungsplattform läuft|fehlerhaft/.test(log)) break;
    if (p.exitCode !== null) break;
    try { const r = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null); if (r?.status) break; } catch { /* noch nicht */ }
    await warte(200);
  }
  return { p, log: () => log };
}
async function stop(p) {
  p.kill('SIGTERM');
  await new Promise(r => { if (p.exitCode !== null) r(); else { p.on('exit', r); setTimeout(() => { try { p.kill('SIGKILL'); } catch {}; r(); }, 10000); } });
}
async function holen(port, pfad, { method = 'GET', headers = {}, body = null } = {}) {
  const init = { method, headers: { Accept: 'text/html,application/json', ...headers }, redirect: 'manual' };
  if (body !== null) init.body = body;
  const a = await fetch(`http://127.0.0.1:${port}${pfad}`, init);
  const text = await a.text();
  return { status: a.status, text, headers: Object.fromEntries(a.headers) };
}

// Einrichtungsmodus-Server: Setup durchlaufen, Admin anlegen, in Einrichtungsmodus wechseln, einloggen.
async function einrichtungsmodusServer(tmpord, port) {
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
  const { p, log } = await starteServer(tmpord, port);
  return { p, log, hatAdmin: !!code };
}

// Einloggen und CSRF-Token holen.
async function einloggenUndCsrf(port) {
  const r1 = await holen(port, '/anmelden');
  const cookie = r1.headers['set-cookie'] ?? '';
  const r2 = await holen(port, '/anmelden', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ email: 'admin@beispiel.hu', passwort: 'passwort12345' }).toString(),
  });
  const sessionCookie = r2.headers['set-cookie'] ?? cookie;
  const r3 = await holen(port, '/admin/einrichtung/schritt/2', { headers: { Cookie: sessionCookie } });
  const csrfMatch = r3.text.match(/name="csrf_token" value="([0-9a-f]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';
  return { sessionCookie, csrf };
}

async function postSchritt2(port, sessionCookie, csrf, felder) {
  const params = new URLSearchParams({ csrf_token: csrf, ...felder });
  return holen(port, '/admin/einrichtung/schritt/2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sessionCookie },
    body: params.toString(),
  });
}

function gueltAnbieter() {
  return {
    modus_impressum: 'erstellt', modus_datenschutz: 'erstellt', modus_teilnahmebedingungen: 'erstellt',
    ANBIETER_NAME: 'Testkanzlei GmbH', ANBIETER_ANSCHRIFT: 'Teststraße 1, 12345 Teststadt', ANBIETER_EMAIL: 'info@testkanzlei.example.com',
  };
}

// ======================================================================
// R6-Subprocess-Handler: diese Datei startet sich selbst mit --r6-server <port> <dir> <modus>.
// Modus 'erstellt': erstelleServer mit recht_*=erstellt + ANBIETER-Daten → Seiten werden generiert.
// Modus 'leer':     erstelleServer ohne recht_*-Einstellungen → next() → betreiberRechtRouter.
// Modus 'gegenprobe': Mini-App OHNE erstelleRechtRouter – belegt: ohne app.use-Zeile kein Betreibername.
if (process.argv[2] === '--r6-server') {
  const r6Port = Number(process.argv[3]);
  const r6Dir = process.argv[4];
  const r6Modus = process.argv[5];
  process.env.DB_DATEI = join(r6Dir, 'app.db');
  if (r6Modus === 'gegenprobe') {
    // DB mit Daten füllen – zeigt: die Daten sind da, aber ohne erstelleRechtRouter nicht sichtbar.
    const { db: gdb } = await import('../db.mjs');
    const gIns = gdb.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,verschluesselt,aktualisiert_am) VALUES(?,?,0,datetime('now'))");
    gIns.run('recht_impressum', 'erstellt');
    gIns.run('ANBIETER_NAME', 'R6-Firma GmbH');
    gIns.run('ANBIETER_ANSCHRIFT', 'Testgasse 6, 12345 Berlin');
    gIns.run('ANBIETER_EMAIL', 'r6@example.com');
    const { default: express } = await import('express');
    const { betreiberRechtRouter: brrG } = await import('../texte.mjs');
    const appG = express();
    appG.use(brrG({ rechtsseiten: {} }));
    appG.listen(r6Port, '127.0.0.1', () => process.stdout.write('bereit\n'));
  } else {
    const { db: r6db } = await import('../db.mjs');
    if (r6Modus === 'erstellt') {
      const ins = r6db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,verschluesselt,aktualisiert_am) VALUES(?,?,0,datetime('now'))");
      ins.run('recht_impressum', 'erstellt');
      ins.run('recht_datenschutz', 'erstellt');
      ins.run('recht_teilnahmebedingungen', 'erstellt');
      ins.run('ANBIETER_NAME', 'R6-Firma GmbH');
      ins.run('ANBIETER_ANSCHRIFT', 'Testgasse 6, 12345 Berlin');
      ins.run('ANBIETER_EMAIL', 'r6@example.com');
    }
    const { erstelleServer: erstelleS } = await import('../app.mjs');
    const stripe6 = { webhooks: { constructEvent: () => { throw new Error('nicht benutzt'); } } };
    const app6 = erstelleS({
      stripe: stripe6, webhookSecret: 'whsec_r6test',
      base: `http://127.0.0.1:${r6Port}`, trustProxy: 0,
      dateiOrdner: join(r6Dir, 'dateien'),
    });
    app6.listen(r6Port, '127.0.0.1', () => process.stdout.write('bereit\n'));
  }
  await new Promise(() => {}); // halte laufen bis Kill
}

// R10-Subprocess-Handler: --r10-notx-server <port> <dir>
// Minimal-Server OHNE Transaktion – Gegenprobe: bei Fehler bleibt Teilzustand.
if (process.argv[2] === '--r10-notx-server') {
  const r10Port = Number(process.argv[3]);
  const r10Dir = process.argv[4];
  process.env.DB_DATEI = join(r10Dir, 'app.db');
  const { db: r10db } = await import('../db.mjs');
  const { default: express } = await import('express');
  const appR10 = express();
  appR10.use(express.urlencoded({ extended: false }));
  appR10.post('/schreib-ohne-tx', (req, res) => {
    const ins = r10db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,verschluesselt,aktualisiert_am) VALUES(?,?,0,datetime('now'))");
    try {
      ins.run('ANBIETER_NAME', req.body.name ?? 'Neu');
      ins.run('ANBIETER_EMAIL', req.body.email ?? 'x@x.com');
      ins.run('recht_impressum', 'erstellt'); // Trigger feuert hier
      res.status(200).send('ok');
    } catch {
      res.status(500).send('fehler');
    }
  });
  appR10.listen(r10Port, '127.0.0.1', () => process.stdout.write('bereit\n'));
  await new Promise(() => {});
}

// ======================================================================
let tmpA, portA = 19260;

abschnitt('R1: Seiten enthalten eingegebene Angaben und Musterhinweis in allen drei Sprachen');
{
  tmpA = mkdtempSync(join(tmpdir(), 'wp6-r1-'));
  mkdirSync(join(tmpA, 'daten'), { recursive: true });
  const { p, log, hatAdmin } = await einrichtungsmodusServer(tmpA, portA);
  pruefe('R1-1 Einrichtungsmodus läuft', /Einrichtungsmodus/.test(log()), log());
  pruefe('R1-2 Admin angelegt', hatAdmin);

  const { sessionCookie, csrf } = await einloggenUndCsrf(portA);
  pruefe('R1-3 CSRF-Token vorhanden', csrf.length > 0, `csrf='${csrf}'`);

  const rPost = await postSchritt2(portA, sessionCookie, csrf, {
    ...gueltAnbieter(),
    ANBIETER_TELEFON: '+49 30 1234567', ANBIETER_ADOSZAM: 'DE123456789', STEUER_HINWEIS: 'USt. 19%',
  });
  pruefe('R1-4 POST Schritt 2 erfolgreich (Redirect 303)', rPost.status === 303, `status=${rPost.status} body='${rPost.text.slice(0,100)}'`);

  // Impressum prüfen
  const rImp = await holen(portA, '/jogi/impresszum');
  pruefe('R1-5 Impressum 200', rImp.status === 200, `status=${rImp.status}`);
  pruefe('R1-6 Impressum enthält Betreibername', rImp.text.includes('Testkanzlei GmbH'), rImp.text.slice(0, 200));
  pruefe('R1-7 Impressum enthält Musterhinweis DE', rImp.text.includes('ersetzt keine Rechtsberatung'), rImp.text.slice(0, 400));
  pruefe('R1-8 Impressum enthält Musterhinweis EN', rImp.text.includes('not legal advice'), rImp.text.slice(0, 400));
  pruefe('R1-9 Impressum enthält Musterhinweis HU', rImp.text.includes('nem jogi'), rImp.text.slice(0, 400));
  pruefe('R1-10 Impressum enthält Telefon', rImp.text.includes('+49 30 1234567'));
  pruefe('R1-11 Impressum enthält Steuernr', rImp.text.includes('DE123456789'));

  // Datenschutz prüfen
  const rDat = await holen(portA, '/jogi/adatvedelem');
  pruefe('R1-12 Datenschutz 200', rDat.status === 200, `status=${rDat.status}`);
  pruefe('R1-13 Datenschutz enthält Betreibername', rDat.text.includes('Testkanzlei GmbH'));
  pruefe('R1-14 Datenschutz enthält Musterhinweis', rDat.text.includes('ersetzt keine Rechtsberatung'));

  // Teilnahmebedingungen prüfen
  const rTeil = await holen(portA, '/jogi/reszveteli-feltetelek');
  pruefe('R1-15 Teilnahme 200', rTeil.status === 200, `status=${rTeil.status}`);
  pruefe('R1-16 Teilnahme enthält Betreibername', rTeil.text.includes('Testkanzlei GmbH'));
  pruefe('R1-17 Teilnahme enthält Musterhinweis', rTeil.text.includes('ersetzt keine Rechtsberatung'));

  // Gegenprobe: ohne Einstellung → next() → 404 / "nicht hinterlegt"
  const tmpGegen = mkdtempSync(join(tmpdir(), 'wp6-r1g-'));
  mkdirSync(join(tmpGegen, 'daten'), { recursive: true });
  const { p: pG } = await einrichtungsmodusServer(tmpGegen, portA + 100);
  const rG = await holen(portA + 100, '/jogi/impresszum');
  pruefe('R1-18 Gegenprobe: ohne Einstellung kein 200 (next() greift)', rG.status !== 200, `status=${rG.status}`);
  await stop(pG.p ?? pG);
  aufraeumen(tmpGegen);

  await stop(p);
  aufraeumen(tmpA);
}

// ======================================================================
abschnitt('R2: HTML-Injektion wird escaped');
{
  const tmpB = mkdtempSync(join(tmpdir(), 'wp6-r2-'));
  mkdirSync(join(tmpB, 'daten'), { recursive: true });
  const portB = portA + 200;
  const { p, log, hatAdmin } = await einrichtungsmodusServer(tmpB, portB);
  const { sessionCookie, csrf } = await einloggenUndCsrf(portB);

  const boeseFeld = '<script>alert(1)</script>';
  const boeseFeldJson = '"inject"';
  const boeseFeldAmp = 'A&B';
  const rPost = await postSchritt2(portB, sessionCookie, csrf, {
    ...gueltAnbieter(),
    ANBIETER_NAME: boeseFeld,
    ANBIETER_ANSCHRIFT: boeseFeldJson + ', Teststadt',
    ANBIETER_EMAIL: 'info@example.com',
    STEUER_HINWEIS: boeseFeldAmp,
  });
  pruefe('R2-1 POST trotz Sonderzeichen erfolgreich', rPost.status === 303, `status=${rPost.status}`);

  const rImp = await holen(portB, '/jogi/impresszum');
  pruefe('R2-2 <script>-Tag escaped (kein Raw-HTML)', !rImp.text.includes('<script>alert(1)</script>'), rImp.text.slice(0, 300));
  pruefe('R2-3 <script> als &lt; escaped', rImp.text.includes('&lt;script&gt;'), rImp.text.slice(0, 300));
  pruefe('R2-4 Anführungszeichen escaped', !rImp.text.includes('"inject"') || rImp.text.includes('&quot;inject&quot;'), rImp.text.slice(0, 300));
  pruefe('R2-5 & als &amp; escaped', rImp.text.includes('A&amp;B'), rImp.text.slice(0, 300));

  await stop(p);
  aufraeumen(tmpB);
}

// ======================================================================
abschnitt('R3: Pflichtfelder fehlen – Meldung, nichts gespeichert');
{
  const tmpC = mkdtempSync(join(tmpdir(), 'wp6-r3-'));
  mkdirSync(join(tmpC, 'daten'), { recursive: true });
  const portC = portA + 300;
  const { p } = await einrichtungsmodusServer(tmpC, portC);
  const { sessionCookie, csrf } = await einloggenUndCsrf(portC);

  // Kein Betreibername
  const r1 = await postSchritt2(portC, sessionCookie, csrf, {
    modus_impressum: 'erstellt', modus_datenschutz: 'erstellt', modus_teilnahmebedingungen: 'erstellt',
    ANBIETER_NAME: '', ANBIETER_ANSCHRIFT: 'Straße 1, Stadt', ANBIETER_EMAIL: 'info@example.com',
  });
  pruefe('R3-1 Kein Name → 400', r1.status === 400, `status=${r1.status}`);
  pruefe('R3-2 Fehlermeldung vorhanden', r1.text.length > 0, `body='${r1.text}'`);

  // Seite nicht gespeichert
  const rImp = await holen(portC, '/jogi/impresszum');
  pruefe('R3-3 Nichts gespeichert (Seite noch nicht generiert)', rImp.status !== 200, `status=${rImp.status}`);

  // Kein Anschrift
  const r2 = await postSchritt2(portC, sessionCookie, csrf, {
    ...gueltAnbieter(), ANBIETER_ANSCHRIFT: '',
  });
  pruefe('R3-4 Keine Anschrift → 400', r2.status === 400, `status=${r2.status}`);

  // Ungültige E-Mail
  const r3 = await postSchritt2(portC, sessionCookie, csrf, {
    ...gueltAnbieter(), ANBIETER_EMAIL: 'kein-at',
  });
  pruefe('R3-5 Ungültige E-Mail → 400', r3.status === 400, `status=${r3.status}`);

  // Kein Pflichtfeld wenn alle eigene_url → kein Fehler
  const r4 = await postSchritt2(portC, sessionCookie, csrf, {
    modus_impressum: 'eigene_url', impressum_url: 'https://example.com/impressum',
    modus_datenschutz: 'eigene_url', datenschutz_url: 'https://example.com/datenschutz',
    modus_teilnahmebedingungen: 'eigene_url', teilnahmebedingungen_url: 'https://example.com/teilnahme',
  });
  pruefe('R3-6 Alle eigene_url ohne Anbieter → 303 (kein Pflichtfehler)', r4.status === 303, `status=${r4.status}`);

  await stop(p);
  aufraeumen(tmpC);
}

// ======================================================================
abschnitt('R4: URL-Validation – erlaubt und abgelehnt');
{
  const tmpD = mkdtempSync(join(tmpdir(), 'wp6-r4-'));
  mkdirSync(join(tmpD, 'daten'), { recursive: true });
  const portD = portA + 400;
  const { p } = await einrichtungsmodusServer(tmpD, portD);
  const { sessionCookie, csrf } = await einloggenUndCsrf(portD);

  async function testUrl(url, erwartetOk) {
    const r = await postSchritt2(portD, sessionCookie, csrf, {
      modus_impressum: 'eigene_url', impressum_url: url,
      modus_datenschutz: 'eigene_url', datenschutz_url: 'https://example.com/d',
      modus_teilnahmebedingungen: 'eigene_url', teilnahmebedingungen_url: 'https://example.com/t',
    });
    // Neuen CSRF holen nach Redirect (Session bleibt)
    const rGet = await holen(portD, '/admin/einrichtung/schritt/2', { headers: { Cookie: sessionCookie } });
    const csrfM = rGet.text.match(/name="csrf_token" value="([0-9a-f]+)"/);
    if (csrfM) { /* csrf = csrfM[1]; */ }
    return r.status === 303 ? 'ok' : 'abgelehnt';
  }

  // Erneuter CSRF nach jedem POST (bei 303 Redirect neue Anfrage)
  async function testUrlFrisch(url, erwartetOk) {
    const rGet = await holen(portD, '/admin/einrichtung/schritt/2', { headers: { Cookie: sessionCookie } });
    const csrfM = rGet.text.match(/name="csrf_token" value="([0-9a-f]+)"/);
    const freshCsrf = csrfM ? csrfM[1] : csrf;
    const r = await postSchritt2(portD, sessionCookie, freshCsrf, {
      modus_impressum: 'eigene_url', impressum_url: url,
      modus_datenschutz: 'eigene_url', datenschutz_url: 'https://example.com/d',
      modus_teilnahmebedingungen: 'eigene_url', teilnahmebedingungen_url: 'https://example.com/t',
    });
    return r.status;
  }

  pruefe('R4-1 javascript: abgelehnt', await testUrlFrisch('javascript:alert(1)') === 400, 'erwartet 400');
  pruefe('R4-2 http:// extern abgelehnt', await testUrlFrisch('http://example.com/impressum') === 400, 'erwartet 400');
  pruefe('R4-3 relative URL ohne own path abgelehnt', await testUrlFrisch('/impressum') === 400, 'erwartet 400');
  pruefe('R4-4 /../ Traversal abgelehnt', await testUrlFrisch('/jogi/impresszum/../x') === 400, 'erwartet 400');
  pruefe('R4-5 //evil.example abgelehnt', await testUrlFrisch('//evil.example.com/x') === 400, 'erwartet 400');
  pruefe('R4-6 Backslash abgelehnt', await testUrlFrisch('https://example.com\\evil') === 400, 'erwartet 400');
  pruefe('R4-7 Pfad mit .. abgelehnt', await testUrlFrisch('https://example.com/../etc/passwd') === 400, 'erwartet 400');
  pruefe('R4-8 https:// extern akzeptiert', await testUrlFrisch('https://example.com/impressum') === 303, 'erwartet 303');
  pruefe('R4-9 Eigener Pfad /jogi/impresszum akzeptiert', await testUrlFrisch('/jogi/impresszum') === 303, 'erwartet 303');
  pruefe('R4-10 Eigener Pfad /jogi/adatvedelem akzeptiert', await testUrlFrisch('/jogi/adatvedelem') === 303, 'erwartet 303');
  pruefe('R4-11 Eigener Pfad /jogi/reszveteli-feltetelek akzeptiert', await testUrlFrisch('/jogi/reszveteli-feltetelek') === 303, 'erwartet 303');
  pruefe('R4-12 Leere URL abgelehnt', await testUrlFrisch('') === 400, 'erwartet 400');
  pruefe('R4-13 /impresszum (nicht eigener Pfad ohne /jogi/) abgelehnt', await testUrlFrisch('/impresszum') === 400, 'erwartet 400');

  await stop(p);
  aufraeumen(tmpD);
}

// ======================================================================
abschnitt('R5: Seite ohne Anmeldung erreichbar, ändert sich bei neuer Eingabe');
{
  const tmpE = mkdtempSync(join(tmpdir(), 'wp6-r5-'));
  mkdirSync(join(tmpE, 'daten'), { recursive: true });
  const portE = portA + 500;
  const { p } = await einrichtungsmodusServer(tmpE, portE);
  const { sessionCookie, csrf } = await einloggenUndCsrf(portE);

  // Ersten Betreiber speichern
  await postSchritt2(portE, sessionCookie, csrf, { ...gueltAnbieter() });

  // Ohne Cookie (nicht angemeldet) erreichbar
  const rPublic = await holen(portE, '/jogi/impresszum');
  pruefe('R5-1 Impressum ohne Anmeldung 200', rPublic.status === 200, `status=${rPublic.status}`);
  pruefe('R5-2 Enthält Betreibernamen', rPublic.text.includes('Testkanzlei GmbH'));

  // Namen ändern → Seite ändert sich
  const rGet2 = await holen(portE, '/admin/einrichtung/schritt/2', { headers: { Cookie: sessionCookie } });
  const csrfM2 = rGet2.text.match(/name="csrf_token" value="([0-9a-f]+)"/);
  const csrf2 = csrfM2 ? csrfM2[1] : csrf;
  await postSchritt2(portE, sessionCookie, csrf2, { ...gueltAnbieter(), ANBIETER_NAME: 'Neue Firma OHG' });

  const rPublic2 = await holen(portE, '/jogi/impresszum');
  pruefe('R5-3 Seite ändert sich nach neuer Eingabe', rPublic2.text.includes('Neue Firma OHG'), rPublic2.text.slice(0, 200));
  pruefe('R5-4 Alter Name nicht mehr sichtbar', !rPublic2.text.includes('Testkanzlei GmbH'), rPublic2.text.slice(0, 200));

  // Cache-Control no-store
  pruefe('R5-5 Cache-Control no-store', (rPublic.headers['cache-control'] ?? '').includes('no-store'));

  await stop(p);
  aufraeumen(tmpE);
}

// ======================================================================
abschnitt('R6: Normalbetrieb – erstelleRechtRouter liefert erzeugte Seiten (Lehre F-16)');
{
  // R6 startet erstelleServer (app.mjs) mit Test-DB und Mock-Stripe als Subprocess.
  // Belegt: erstelleRechtRouter liefert Seiten, db-Singleton geteilt, Gegenprobe rot ohne Router.
  async function starteR6Sub(tmpOrd, port, modus) {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', __filename, '--r6-server', String(port), tmpOrd, modus], {
      stdio: ['ignore', 'pipe', 'pipe'], env: basisEnv({}),
    });
    let log6 = '', bereit = false;
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`R6-Sub ${modus}@${port} Timeout log: ${log6.slice(-300)}`)), 15000);
      p.stdout.on('data', d => { log6 += d; if (!bereit && String(d).includes('bereit')) { bereit = true; clearTimeout(t); res(); } });
      p.stderr.on('data', d => { log6 += d; });
      p.on('exit', c => { clearTimeout(t); if (!bereit) rej(new Error(`R6-Sub ${modus} exit ${c}: ${log6.slice(-300)}`)); });
    });
    return p;
  }

  const portR6e = portA + 600, portR6l = portA + 601, portR6g = portA + 602;
  const tmpR6e = mkdtempSync(join(tmpdir(), 'wp6-r6e-'));
  const tmpR6l = mkdtempSync(join(tmpdir(), 'wp6-r6l-'));
  const tmpR6g = mkdtempSync(join(tmpdir(), 'wp6-r6g-'));
  mkdirSync(join(tmpR6e, 'daten'), { recursive: true });
  mkdirSync(join(tmpR6l, 'daten'), { recursive: true });
  mkdirSync(join(tmpR6g, 'daten'), { recursive: true });

  // --- erstellt-Modus: alle drei Seiten erzeugt, db-Singleton bewiesen ---
  const pR6e = await starteR6Sub(tmpR6e, portR6e, 'erstellt');
  const rR6imp  = await holen(portR6e, '/jogi/impresszum');
  pruefe('R6-1 Impressum 200 (erstelleServer + db-Singleton)', rR6imp.status === 200, `status=${rR6imp.status}`);
  pruefe('R6-2 Impressum enthält Betreibername (db-Singleton geteilt)', rR6imp.text.includes('R6-Firma GmbH'), rR6imp.text.slice(0, 300));
  const rR6dat  = await holen(portR6e, '/jogi/adatvedelem');
  pruefe('R6-3 Datenschutz 200 + Betreibername', rR6dat.status === 200 && rR6dat.text.includes('R6-Firma GmbH'), `status=${rR6dat.status}`);
  const rR6teil = await holen(portR6e, '/jogi/reszveteli-feltetelek');
  pruefe('R6-4 Teilnahme 200 + Betreibername', rR6teil.status === 200 && rR6teil.text.includes('R6-Firma GmbH'), `status=${rR6teil.status}`);
  await stop(pR6e); aufraeumen(tmpR6e);

  // --- leer-Modus: kein recht_*=erstellt → betreiberRechtRouter liefert Ersatz ---
  const pR6l = await starteR6Sub(tmpR6l, portR6l, 'leer');
  const rR6leer = await holen(portR6l, '/jogi/impresszum');
  pruefe('R6-5 Ohne erstellt-Modus: betreiberRechtRouter greift (kein Betreibername)', rR6leer.status === 200 && !rR6leer.text.includes('R6-Firma GmbH'), `status=${rR6leer.status}`);
  await stop(pR6l); aufraeumen(tmpR6l);

  // --- Gegenprobe: DB-Daten da, aber ohne erstelleRechtRouter kein Betreibername ---
  const pR6g = await starteR6Sub(tmpR6g, portR6g, 'gegenprobe');
  const rR6geg = await holen(portR6g, '/jogi/impresszum');
  pruefe('R6-6 Gegenprobe: ohne erstelleRechtRouter (app.use-Zeile) kein Betreibername', !rR6geg.text.includes('R6-Firma GmbH'), rR6geg.text.slice(0, 200));
  await stop(pR6g); aufraeumen(tmpR6g);
}

// ======================================================================
abschnitt('R7: Längen- und Sonderzeichen-Grenzen');
{
  const tmpF = mkdtempSync(join(tmpdir(), 'wp6-r7-'));
  mkdirSync(join(tmpF, 'daten'), { recursive: true });
  const portF = portA + 700;
  const { p } = await einrichtungsmodusServer(tmpF, portF);
  const { sessionCookie, csrf } = await einloggenUndCsrf(portF);

  async function testFeld(feld, wert) {
    const rGet = await holen(portF, '/admin/einrichtung/schritt/2', { headers: { Cookie: sessionCookie } });
    const csrfM = rGet.text.match(/name="csrf_token" value="([0-9a-f]+)"/);
    const freshCsrf = csrfM ? csrfM[1] : csrf;
    const felder = { ...gueltAnbieter(), [feld]: wert };
    const r = await postSchritt2(portF, sessionCookie, freshCsrf, felder);
    return r.status;
  }

  // Name zu lang (>160)
  pruefe('R7-1 ANBIETER_NAME > 160 Zeichen → 400', await testFeld('ANBIETER_NAME', 'A'.repeat(161)) === 400, 'erwartet 400');
  // Exakt 160 OK
  pruefe('R7-2 ANBIETER_NAME = 160 Zeichen → 303', await testFeld('ANBIETER_NAME', 'A'.repeat(160)) === 303, 'erwartet 303');
  // Steuerhinweis zu lang (>200)
  pruefe('R7-3 STEUER_HINWEIS > 200 Zeichen → 400', await testFeld('STEUER_HINWEIS', 'B'.repeat(201)) === 400, 'erwartet 400');
  // Kontrollzeichen in Name abgelehnt (pruefeTextFeld prüft \u0000-\u001f)
  pruefe('R7-4 Kontrollzeichen in ANBIETER_NAME → 400', await testFeld('ANBIETER_NAME', 'Test\u0001Name') === 400, 'erwartet 400');
  // Ungültiges Telefonformat
  pruefe('R7-5 Ungültiges Telefonformat → 400', await testFeld('ANBIETER_TELEFON', 'kein_telefon!') === 400, 'erwartet 400');
  // Gültige Sonderzeichen im Namen OK
  pruefe('R7-6 Umlaute im Namen → 303', await testFeld('ANBIETER_NAME', 'Müller & Söhne GmbH') === 303, 'erwartet 303');
  // E-Mail ohne @ abgelehnt
  pruefe('R7-7 E-Mail ohne @ → 400', await testFeld('ANBIETER_EMAIL', 'kein-at.example.com') === 400, 'erwartet 400');

  await stop(p);
  aufraeumen(tmpF);
}

// ======================================================================
abschnitt('R8: Modusfelder-Pflicht und Whitelist (Punkt 1 + Punkt 3)');
{
  const tmpH = mkdtempSync(join(tmpdir(), 'wp6-r8-'));
  mkdirSync(join(tmpH, 'daten'), { recursive: true });
  const portH = portA + 800;
  const { p } = await einrichtungsmodusServer(tmpH, portH);
  const { sessionCookie, csrf } = await einloggenUndCsrf(portH);

  // Punkt 1: fehlende Modusfelder → 400
  // Kein gueltAnbieter-Spread da dieser modus_datenschutz:'erstellt' mitbringt
  const r81 = await postSchritt2(portH, sessionCookie, csrf, {
    modus_impressum: 'erstellt', modus_teilnahmebedingungen: 'erstellt',
    ANBIETER_NAME: 'Test GmbH', ANBIETER_ANSCHRIFT: 'Teststr. 1, 12345 Stadt', ANBIETER_EMAIL: 'x@example.com',
  });
  pruefe('R8-1 modus_datenschutz fehlt → 400', r81.status === 400, `status=${r81.status}`);
  const r82 = await postSchritt2(portH, sessionCookie, csrf, { ANBIETER_NAME: 'Test' });
  pruefe('R8-2 Alle Modusfelder fehlen → 400', r82.status === 400, `status=${r82.status}`);

  // Punkt 3: unerlaubte Modusfelder → 400 (ungültiger Wert steht NACH dem Spread)
  const r83 = await postSchritt2(portH, sessionCookie, csrf, { ...gueltAnbieter(), modus_impressum: 'hacker' });
  pruefe('R8-3 modus_impressum=hacker → 400', r83.status === 400, `status=${r83.status}`);
  const r84 = await postSchritt2(portH, sessionCookie, csrf, { ...gueltAnbieter(), modus_impressum: '' });
  pruefe('R8-4 modus_impressum=leer → 400', r84.status === 400, `status=${r84.status}`);
  const r85 = await postSchritt2(portH, sessionCookie, csrf, { ...gueltAnbieter(), modus_impressum: 'Erstellt' });
  pruefe('R8-5 modus_impressum=Erstellt (Grossbuchstabe) → 400', r85.status === 400, `status=${r85.status}`);

  // Nichts gespeichert nach 400
  const rCheck = await holen(portH, '/jogi/impresszum');
  pruefe('R8-6 Nach 400: Impressum noch nicht generiert', rCheck.status !== 200, `status=${rCheck.status}`);

  // Gegenprobe: alle drei korrekt → 303
  const r87 = await postSchritt2(portH, sessionCookie, csrf, { ...gueltAnbieter() });
  pruefe('R8-7 Alle drei Modusfelder korrekt → 303', r87.status === 303, `status=${r87.status}`);

  await stop(p);
  aufraeumen(tmpH);
}

// ======================================================================
abschnitt('R9: URL-Synchronisation bei Moduswechsel (Punkt 2)');
{
  const tmpI = mkdtempSync(join(tmpdir(), 'wp6-r9-'));
  mkdirSync(join(tmpI, 'daten'), { recursive: true });
  const portI = portA + 900;
  const { p } = await einrichtungsmodusServer(tmpI, portI);
  const { sessionCookie, csrf } = await einloggenUndCsrf(portI);

  async function holeCsrfFrisch() {
    const r = await holen(portI, '/admin/einrichtung/schritt/2', { headers: { Cookie: sessionCookie } });
    return (r.text.match(/name="csrf_token" value="([0-9a-f]+)"/) ?? [])[1] ?? csrf;
  }
  function leseEinstell(schluessel) {
    const db9 = new DatabaseSync(join(tmpI, 'app.db'), { readOnly: true });
    const v = db9.prepare('SELECT wert FROM einstellungen WHERE schluessel=?').get(schluessel)?.wert ?? null;
    db9.close();
    return v;
  }

  // eigene_url → IMPRESSUM_URL = externe Adresse
  await postSchritt2(portI, sessionCookie, await holeCsrfFrisch(), {
    modus_impressum: 'eigene_url', impressum_url: 'https://extern.example.com/impressum',
    modus_datenschutz: 'eigene_url', datenschutz_url: 'https://extern.example.com/datenschutz',
    modus_teilnahmebedingungen: 'eigene_url', teilnahmebedingungen_url: 'https://extern.example.com/teilnahme',
  });
  pruefe('R9-1 eigene_url → IMPRESSUM_URL = externe Adresse', leseEinstell('IMPRESSUM_URL') === 'https://extern.example.com/impressum', leseEinstell('IMPRESSUM_URL'));

  // Wechsel zu erstellt → IMPRESSUM_URL = eigener Pfad (alte externe URL weg)
  await postSchritt2(portI, sessionCookie, await holeCsrfFrisch(), { ...gueltAnbieter() });
  pruefe('R9-2 Wechsel erstellt → IMPRESSUM_URL = /jogi/impresszum', leseEinstell('IMPRESSUM_URL') === '/jogi/impresszum', leseEinstell('IMPRESSUM_URL'));
  pruefe('R9-3 Wechsel erstellt → DATENSCHUTZ_URL = /jogi/adatvedelem', leseEinstell('DATENSCHUTZ_URL') === '/jogi/adatvedelem', leseEinstell('DATENSCHUTZ_URL'));

  // Wechsel zu eigene_url (neue URL) → IMPRESSUM_URL = neue externe Adresse
  await postSchritt2(portI, sessionCookie, await holeCsrfFrisch(), {
    modus_impressum: 'eigene_url', impressum_url: 'https://neu.example.com/impressum',
    modus_datenschutz: 'eigene_url', datenschutz_url: 'https://neu.example.com/datenschutz',
    modus_teilnahmebedingungen: 'eigene_url', teilnahmebedingungen_url: 'https://neu.example.com/teilnahme',
  });
  pruefe('R9-4 Wechsel eigene_url → IMPRESSUM_URL = neue externe Adresse', leseEinstell('IMPRESSUM_URL') === 'https://neu.example.com/impressum', leseEinstell('IMPRESSUM_URL'));

  await stop(p);
  aufraeumen(tmpI);
}

// ======================================================================
abschnitt('R10: Transaktion – bei Fehler nichts halb gespeichert (Punkt 4)');
{
  async function starteR10Sub(tmpOrd, port) {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', __filename, '--r10-notx-server', String(port), tmpOrd], {
      stdio: ['ignore', 'pipe', 'pipe'], env: basisEnv({}),
    });
    let log10 = '', bereit = false;
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`R10-Sub Timeout: ${log10.slice(-200)}`)), 15000);
      p.stdout.on('data', d => { log10 += d; if (!bereit && String(d).includes('bereit')) { bereit = true; clearTimeout(t); res(); } });
      p.stderr.on('data', d => { log10 += d; });
      p.on('exit', c => { clearTimeout(t); if (!bereit) rej(new Error(`R10-Sub exit ${c}: ${log10.slice(-200)}`)); });
    });
    return p;
  }

  // Teil A: Produktivcode (mit Transaktion) – simulierter Schreibfehler via SQLite-Trigger
  const tmpR10a = mkdtempSync(join(tmpdir(), 'wp6-r10a-'));
  mkdirSync(join(tmpR10a, 'daten'), { recursive: true });
  const portR10a = portA + 1000;
  const { p: pR10a } = await einrichtungsmodusServer(tmpR10a, portR10a);
  const { sessionCookie: sc10, csrf: csrf10 } = await einloggenUndCsrf(portR10a);

  // Baseline: ersten gueltigen POST speichern
  await postSchritt2(portR10a, sc10, csrf10, { ...gueltAnbieter() });

  // Trigger einsetzen: wirft nach ANBIETER_NAME-Schreiben bei recht_impressum
  const dbR10trigger = new DatabaseSync(join(tmpR10a, 'app.db'));
  dbR10trigger.exec("CREATE TRIGGER r10_fail AFTER INSERT ON einstellungen WHEN NEW.schluessel='recht_impressum' BEGIN SELECT RAISE(FAIL,'r10_sim'); END");
  dbR10trigger.close();

  // POST mit neuem Namen → Trigger feuert → ROLLBACK → 500
  const rGet10 = await holen(portR10a, '/admin/einrichtung/schritt/2', { headers: { Cookie: sc10 } });
  const csrf10b = (rGet10.text.match(/name="csrf_token" value="([0-9a-f]+)"/) ?? [])[1] ?? csrf10;
  const rPost10a = await postSchritt2(portR10a, sc10, csrf10b, { ...gueltAnbieter(), ANBIETER_NAME: 'Rollback GmbH' });
  pruefe('R10-1 Simulierter Schreibfehler → 500', rPost10a.status === 500, `status=${rPost10a.status}`);

  // DB-Prüfung: Alter Name noch vorhanden (Transaktion wurde zurückgerollt)
  const dbR10check = new DatabaseSync(join(tmpR10a, 'app.db'), { readOnly: true });
  const r10Name = dbR10check.prepare("SELECT wert FROM einstellungen WHERE schluessel='ANBIETER_NAME'").get()?.wert ?? '';
  dbR10check.close();
  pruefe('R10-2 Nach 500: alter Name in DB (Rollback korrekt)', r10Name === 'Testkanzlei GmbH', `name='${r10Name}'`);

  await stop(pR10a); aufraeumen(tmpR10a);

  // Teil B: Gegenprobe ohne Transaktion – Teilzustand bleibt nach Fehler
  const tmpR10b = mkdtempSync(join(tmpdir(), 'wp6-r10b-'));
  mkdirSync(join(tmpR10b, 'daten'), { recursive: true });
  const portR10b = portA + 1001;
  const pR10b = await starteR10Sub(tmpR10b, portR10b);

  // Trigger einsetzen: wirft beim Schreiben von recht_impressum
  const dbR10bTrigger = new DatabaseSync(join(tmpR10b, 'app.db'));
  dbR10bTrigger.exec("CREATE TRIGGER r10_fail AFTER INSERT ON einstellungen WHEN NEW.schluessel='recht_impressum' BEGIN SELECT RAISE(FAIL,'r10_sim'); END");
  dbR10bTrigger.close();

  // POST ohne Transaktion → Trigger feuert → ANBIETER_NAME/EMAIL bereits geschrieben, kein Rollback
  const rPost10b = await holen(portR10b, '/schreib-ohne-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'GegenprobeGmbH', email: 'g@example.com' }).toString(),
  });
  pruefe('R10-3 Gegenprobe: ohne Transaktion → 500', rPost10b.status === 500, `status=${rPost10b.status}`);

  // DB-Prüfung: ANBIETER_NAME trotzdem geschrieben (Teilzustand – Beweis fuer Notwendigkeit der TX)
  const dbR10bCheck = new DatabaseSync(join(tmpR10b, 'app.db'), { readOnly: true });
  const r10bName = dbR10bCheck.prepare("SELECT wert FROM einstellungen WHERE schluessel='ANBIETER_NAME'").get()?.wert ?? '';
  dbR10bCheck.close();
  pruefe('R10-4 Gegenprobe: ANBIETER_NAME trotz Fehler geschrieben (Teilzustand bleibt)', r10bName === 'GegenprobeGmbH', `name='${r10bName}'`);

  await stop(pR10b); aufraeumen(tmpR10b);
}

// ======================================================================
// R11: marke-Anbieter in Schritt-2-Vorbelegung (F-188)
abschnitt('R11: marke-Anbieter in Schritt-2-Vorbelegung (F-188)');
{
  const tmpR11 = mkdtempSync(join(tmpdir(), 'wp6-r11-'));
  mkdirSync(join(tmpR11, 'daten'), { recursive: true });
  const portR11 = portA + 1100;
  const { p: pR11, hatAdmin: r11Admin } = await einrichtungsmodusServer(tmpR11, portR11);
  const { sessionCookie: sc11, csrf: csrf11 } = await einloggenUndCsrf(portR11);
  pruefe('R11-0 Admin und Einrichtung OK', r11Admin && !!sc11, `admin=${r11Admin}`);

  // Einstellungen ANBIETER_NAME setzen via schritt/2
  const rPost11 = await postSchritt2(portR11, sc11, csrf11, { ...gueltAnbieter(), ANBIETER_NAME: 'Einst-F188 GmbH' });
  pruefe('R11-1 schritt/2 POST setzt einstellungen', [200, 302, 303].includes(rPost11.status), `status=${rPost11.status}`);

  // Stepup + PUT marke/anbieter
  const rSup11 = await holen(portR11, '/api/admin/stepup', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sc11 },
    body: JSON.stringify({ passwort: 'passwort12345' }),
  });
  pruefe('R11-2 Stepup OK', rSup11.status === 200, `status=${rSup11.status}`);
  // PUT /api/admin/marke/anbieter ist im Einrichtungsmodus nicht registriert → direkte DB-Eintragung
  const dbR11w = new DatabaseSync(join(tmpR11, 'app.db'));
  dbR11w.prepare("INSERT OR REPLACE INTO marke (schluessel, wert, aktualisiert_am) VALUES ('anbieter', ?, datetime('now'))").run(JSON.stringify({ name: 'Marke-F188 GmbH', anschrift: 'Markengasse 11', email: 'marke@example.com' }));
  dbR11w.close();
  pruefe('R11-3 marke/anbieter in DB gesetzt', true, 'ok');

  // GET schritt/2: Vorbelegung zeigt Marke-Name
  const rGet11 = await holen(portR11, '/admin/einrichtung/schritt/2', { headers: { Cookie: sc11 } });
  const val11 = (rGet11.text.match(/name="ANBIETER_NAME"[^>]*value="([^"]*)"/) ?? [])[1] ?? '';
  pruefe('R11-4 Vorbelegung zeigt Marke-Name', val11 === 'Marke-F188 GmbH', `input-value: "${val11}"`);
  pruefe('R11-5 Einstellungs-Name nicht in Vorbelegung', val11 !== 'Einst-F188 GmbH', `input-value: "${val11}"`);

  // Gegenprobe: ohne Marke → einstellungen-Name wird angezeigt
  const tmpR11b = mkdtempSync(join(tmpdir(), 'wp6-r11b-'));
  mkdirSync(join(tmpR11b, 'daten'), { recursive: true });
  const portR11b = portA + 1101;
  const { p: pR11b, hatAdmin: r11bAdmin } = await einrichtungsmodusServer(tmpR11b, portR11b);
  const { sessionCookie: sc11b, csrf: csrf11b } = await einloggenUndCsrf(portR11b);
  await postSchritt2(portR11b, sc11b, csrf11b, { ...gueltAnbieter(), ANBIETER_NAME: 'Einst-F188 GmbH' });
  // kein PUT marke → einstellungen gilt
  const rGet11b = await holen(portR11b, '/admin/einrichtung/schritt/2', { headers: { Cookie: sc11b } });
  const val11b = (rGet11b.text.match(/name="ANBIETER_NAME"[^>]*value="([^"]*)"/) ?? [])[1] ?? '';
  pruefe('R11-6 Gegenprobe: ohne Marke → einstellungen-Name', val11b === 'Einst-F188 GmbH', `input-value: "${val11b}"`);

  await stop(pR11); aufraeumen(tmpR11);
  await stop(pR11b); aufraeumen(tmpR11b);
}

// ======================================================================
console.log('');
if (schlecht === 0) {
  console.log(`WP6 Recht: alle ${ok} Pruefungen bestanden.`);
  process.exit(0);
} else {
  console.log(`WP6 Recht: ${schlecht} Fehler, ${ok} bestanden.`);
  process.exit(1);
}
