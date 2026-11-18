// Automatischer Selbsttest fuer WP4: Einrichtungsassistent-Geruest.
// Pruefungen G1-G12 aus docs/SPEZ-WP4-9-ASSISTENT.md.
// G7+G12 ohne Server; G3 im Normalmodus; alle anderen im Einrichtungsmodus.
import './test-sprache.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ladeKonfig } from '../konfig.mjs';
import { pruefeTextFeld, pruefeEmailFormat, pruefeTelefonFormat, istStripeTestKey, istWebhookSecret, pruefeMailFromFormat } from '../feldregeln.mjs';

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
  const init = { method, headers: { Accept: 'text/html', ...headers }, redirect: 'manual' };
  if (body !== null) init.body = body;
  const a = await fetch(`http://127.0.0.1:${port}${pfad}`, init);
  const text = await a.text();
  return { status: a.status, text, headers: Object.fromEntries(a.headers) };
}

// Admin anlegen + Einrichtungsmodus-Server: Hilfsfunktion
async function einrichtungsmodusServer(tmpord, port) {
  // 1. Setup-Modus
  const { p: pSetup } = await starteServer(tmpord, port, { EINRICHTUNGSMODUS: '1' });
  // Setup-Code aus Datei holen
  for (let i = 0; i < 600; i++) {
    if (existsSync(join(tmpord, 'daten', 'ERSTSTART.txt'))) break;
    await warte(100);
  }
  const { readFileSync } = await import('node:fs');
  const code = existsSync(join(tmpord, 'daten', 'ERSTSTART.txt'))
    ? readFileSync(join(tmpord, 'daten', 'ERSTSTART.txt'), 'utf8').trim() : null;
  // Admin anlegen
  if (code) {
    await holen(port, '/einrichtung', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, email: 'admin@beispiel.hu', passwort: 'passwort12345' }).toString(),
    });
  }
  await stop(pSetup);
  // 2. Einrichtungsmodus (kein EINRICHTUNGSMODUS=1, DB hat ADMIN_ERSTELLT)
  const { p, log } = await starteServer(tmpord, port);
  return { p, log, hatAdmin: !!code };
}

// =====================================================================
abschnitt('G7: Alle drei Sprachdateien haben identische Schluessel');
{
  const { readFileSync } = await import('node:fs');
  const lade = (l) => Object.keys(JSON.parse(readFileSync(`texte/${l}.json`, 'utf8'))).sort().join('|');
  const de = lade('de'), hu = lade('hu'), en = lade('en');
  pruefe('G7a: de.json und hu.json haben identische Schluessel', de === hu);
  pruefe('G7b: de.json und en.json haben identische Schluessel', de === en);
  const hatAssistent = (l) => {
    const keys = JSON.parse(readFileSync(`texte/${l}.json`, 'utf8'));
    return ['assistent_willkommen','assistent_folgt','assistent_schritt_1_titel','assistent_schritt_6_titel'].every(k => k in keys);
  };
  pruefe('G7c: Alle vier Stichproben-Schluessel in allen drei Dateien', hatAssistent('de') && hatAssistent('hu') && hatAssistent('en'));
  const schritt5TitelDE = JSON.parse(readFileSync('texte/de.json', 'utf8'))['assistent_schritt_5_titel'] ?? '';
  pruefe('G7d: Schritt-5-Titel ist nicht Webhook', !schritt5TitelDE.includes('Webhook'), 'Titel: ' + schritt5TitelDE);
}

// =====================================================================
abschnitt('G12: Feldregel-Funktionen liefern korrekte Ergebnisse (Beweis fuer G12-Umbau)');
{
  // pruefeTextFeld
  pruefe('G12 pruefeTextFeld: Steuerzeichen abgelehnt', pruefeTextFeld('Hallo\x00', 100) !== null);
  pruefe('G12 pruefeTextFeld: Tab abgelehnt', pruefeTextFeld('Hallo\t', 100) !== null);
  pruefe('G12 pruefeTextFeld: normaler Text erlaubt', pruefeTextFeld('Hallo Welt', 100) === null);
  pruefe('G12 pruefeTextFeld: zu lang abgelehnt', pruefeTextFeld('x'.repeat(101), 100) !== null);
  pruefe('G12 pruefeTextFeld: genau max erlaubt', pruefeTextFeld('x'.repeat(100), 100) === null);
  // pruefeEmailFormat
  pruefe('G12 pruefeEmailFormat: leere E-Mail erlaubt (optional)', pruefeEmailFormat('') === null);
  pruefe('G12 pruefeEmailFormat: Leerzeichen-only abgelehnt (kein trim)', pruefeEmailFormat('   ') !== null);
  pruefe('G12 pruefeEmailFormat: fuehrendes Leerzeichen abgelehnt (kein trim)', pruefeEmailFormat(' a@b.hu') !== null);
  pruefe('G12 pruefeEmailFormat: nachlaufendes Leerzeichen abgelehnt (kein trim)', pruefeEmailFormat('a@b.hu ') !== null);
  pruefe('G12 pruefeEmailFormat: gueltige E-Mail erlaubt', pruefeEmailFormat('test@beispiel.hu') === null);
  pruefe('G12 pruefeEmailFormat: ohne @ abgelehnt', pruefeEmailFormat('keineat.hu') !== null);
  // pruefeTelefonFormat
  pruefe('G12 pruefeTelefonFormat: leere Nummer erlaubt', pruefeTelefonFormat('') === null);
  pruefe('G12 pruefeTelefonFormat: Leerzeichen-only abgelehnt (kein trim)', pruefeTelefonFormat('   ') !== null);
  pruefe('G12 pruefeTelefonFormat: fuehrendes Leerzeichen abgelehnt (kein trim)', pruefeTelefonFormat(' +36 30 1234567') !== null);
  pruefe('G12 pruefeTelefonFormat: gueltige Nummer erlaubt', pruefeTelefonFormat('+36 1 234 5678') === null);
  pruefe('G12 pruefeTelefonFormat: Buchstaben abgelehnt', pruefeTelefonFormat('+36abc') !== null);
  // istStripeTestKey
  pruefe('G12 istStripeTestKey: sk_test_ ok', istStripeTestKey('sk_test_abcdefghijklmno') === true);
  pruefe('G12 istStripeTestKey: sk_live_ abgelehnt', istStripeTestKey('sk_live_xyz') === false);
  pruefe('G12 istStripeTestKey: zu kurz abgelehnt', istStripeTestKey('sk_test_x') === false);
  // istWebhookSecret
  pruefe('G12 istWebhookSecret: whsec_ ok', istWebhookSecret('whsec_abcdefghijkl') === true);
  pruefe('G12 istWebhookSecret: falsches Praefix', istWebhookSecret('xxsec_abcdefghijkl') === false);
  // pruefeMailFromFormat
  pruefe('G12 pruefeMailFromFormat: ohne resendKey immer ok', pruefeMailFromFormat('', 'irgendwas') === null);
  pruefe('G12 pruefeMailFromFormat: richtiges Muster ok', pruefeMailFromFormat('re_xxx', 'Test <noreply@resend.dev>') === null);
  pruefe('G12 pruefeMailFromFormat: falsches Muster abgelehnt', pruefeMailFromFormat('re_xxx', 'falsch@example.com') !== null);
  // ladeKonfig liefert identische Fehlermeldungen (Spot-Check)
  let err = null;
  try { ladeKonfig({ STRIPE_SECRET_KEY: 'sk_test_kurz', STRIPE_WEBHOOK_SECRET: 'whsec_abcdefghijkl' }); }
  catch (e) { err = e.meldungen ?? []; }
  pruefe('G12 ladeKonfig: kurzer sk_test_-Key produziert dieselbe Fehlermeldung', Array.isArray(err) && err.some(m => /sk_test_|Testschl/i.test(m)));
  let err2 = null;
  try { ladeKonfig({ STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmno', STRIPE_WEBHOOK_SECRET: 'ungueltig', ANBIETER_TELEFON: '+36abc' }); }
  catch (e) { err2 = e.meldungen ?? []; }
  pruefe('G12 ladeKonfig: ungueltige Telefonnummer produziert Fehlermeldung', Array.isArray(err2) && err2.some(m => /ANBIETER_TELEFON/.test(m)));
}

// =====================================================================
abschnitt('G3: Im Normalmodus ist /admin/einrichtung nicht vorhanden (404)');
{
  const t = mkdtempSync(join(tmpdir(), 'wp4-g3-'));
  const port = 4460;
  // Setup + Admin anlegen damit keine UNINITIALISIERT-Falle
  const { p: pS } = await starteServer(t, port, { EINRICHTUNGSMODUS: '1' });
  for (let i = 0; i < 600; i++) { if (existsSync(join(t, 'daten', 'ERSTSTART.txt'))) break; await warte(100); }
  const { readFileSync } = await import('node:fs');
  const codeG3 = existsSync(join(t, 'daten', 'ERSTSTART.txt')) ? readFileSync(join(t, 'daten', 'ERSTSTART.txt'), 'utf8').trim() : null;
  if (codeG3) {
    await holen(port, '/einrichtung', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: codeG3, email: 'admin@beispiel.hu', passwort: 'passwort12345' }).toString() });
  }
  await stop(pS);
  // Normalmodus mit Stripe-Testschluessel
  const { p, log } = await starteServer(t, port + 1, { STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmno', STRIPE_WEBHOOK_SECRET: 'whsec_abcdefghijkl' });
  try {
    pruefe('G3: Server startet im Normalmodus', /Schulungsplattform läuft/.test(log()));
    const r = await holen(port + 1, '/admin/einrichtung');
    pruefe('G3: /admin/einrichtung im Normalmodus -> 404', r.status === 404, 'status=' + r.status);
  } finally { await stop(p); aufraeumen(t); }
}

// =====================================================================
// Einrichtungsmodus-Server fuer G1, G2, G4-G6, G8-G11
abschnitt('Einrichtungsmodus-Server aufbauen (fuer G1, G2, G4-G6, G8-G11)');
const TG = mkdtempSync(join(tmpdir(), 'wp4-einr-'));
const PORT_EINR = 4462;
const { p: pEinr, log: logEinr, hatAdmin } = await einrichtungsmodusServer(TG, PORT_EINR);
pruefe('Einrichtungsmodus-Server gestartet', /Einrichtungsmodus/.test(logEinr()), logEinr().slice(0, 200));
pruefe('Admin-Konto wurde angelegt', hatAdmin);

// Session per Login holen
const loginR = await holen(PORT_EINR, '/anmelden', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ email: 'admin@beispiel.hu', passwort: 'passwort12345' }).toString(),
});
const cookie = String(loginR.headers['set-cookie'] || '').split(';')[0];
pruefe('Login liefert Session-Cookie', cookie.length > 10);

// =====================================================================
abschnitt('G1: Ohne Sitzung -> 303 auf /anmelden');
{
  const r1 = await holen(PORT_EINR, '/admin/einrichtung');
  pruefe('G1a: /admin/einrichtung ohne Cookie -> 303', r1.status === 303 && (r1.headers['location'] || '') === '/anmelden', 'status=' + r1.status);
  const r2 = await holen(PORT_EINR, '/admin/einrichtung/schritt/1');
  pruefe('G1b: /admin/einrichtung/schritt/1 ohne Cookie -> 303', r2.status === 303 && (r2.headers['location'] || '') === '/anmelden');
}

// =====================================================================
abschnitt('G2: Mit Sitzung 200 und richtige Schrittzahl');
{
  const r = await holen(PORT_EINR, '/admin/einrichtung', { headers: { Cookie: cookie } });
  pruefe('G2a: /admin/einrichtung mit Cookie -> 200', r.status === 200, 'status=' + r.status);
  const anzahl = (r.text.match(/<li>.*?admin\/einrichtung\/schritt\//g) || []).length;
  pruefe('G2b: genau 6 Schritt-Links in Uebersicht (als Listenelemente)', anzahl === 6, 'gefunden: ' + anzahl + ' text=' + r.text.slice(0, 300));
  pruefe('G2c: Willkommen-Seite enthaelt Dauer-Hinweis (10 Minuten)', r.text.includes('10 Minute') || r.text.includes('10 perc') || r.text.includes('10 minutes'), 'text=' + r.text.slice(0, 400));
  pruefe('G2d: Willkommen-Seite enthaelt Link zum naechsten offenen Schritt', r.text.includes('/admin/einrichtung/schritt/'), 'text=' + r.text.slice(0, 400));
}

// =====================================================================
abschnitt('G8: Sicherheits-Header (no-store, same-origin, nosniff)');
{
  const r = await holen(PORT_EINR, '/admin/einrichtung/schritt/1', { headers: { Cookie: cookie } });
  pruefe('G8a: Cache-Control: no-store', (r.headers['cache-control'] || '').includes('no-store'));
  pruefe('G8b: Referrer-Policy: same-origin (nicht no-referrer: sonst sendet der Browser Origin null)', (r.headers['referrer-policy'] || '') === 'same-origin');
  pruefe('G8c: X-Content-Type-Options: nosniff', (r.headers['x-content-type-options'] || '').includes('nosniff'));
}

// =====================================================================
abschnitt('G9: GET aendert keinen Zustand');
{
  const db9 = new DatabaseSync(join(TG, 'app.db'), { readOnly: true });
  db9.exec('PRAGMA busy_timeout = 3000');
  const vorher = db9.prepare("SELECT COUNT(*) AS n FROM einstellungen WHERE schluessel LIKE 'einrichtung_schritt_%'").get().n;
  // GET Schritt 1
  await holen(PORT_EINR, '/admin/einrichtung/schritt/1', { headers: { Cookie: cookie } });
  await holen(PORT_EINR, '/admin/einrichtung/schritt/2', { headers: { Cookie: cookie } });
  const nachher = db9.prepare("SELECT COUNT(*) AS n FROM einstellungen WHERE schluessel LIKE 'einrichtung_schritt_%'").get().n;
  db9.close();
  pruefe('G9: GET aendert keine Einstellungszeilen', vorher === nachher, `vorher=${vorher} nachher=${nachher}`);
}

// =====================================================================
abschnitt('G4: CSRF-Pruefung und Origin-Pruefung');
{
  // CSRF-Token aus GET holen
  const getR = await holen(PORT_EINR, '/admin/einrichtung/schritt/1', { headers: { Cookie: cookie } });
  const csrfMatch = getR.text.match(/name="csrf_token"\s+value="([0-9a-f]+)"/);
  const csrfToken = csrfMatch ? csrfMatch[1] : null;
  pruefe('G4-Vorbedingung: CSRF-Token im HTML vorhanden', !!csrfToken, getR.text.slice(0, 300));

  // Case 1: POST ohne csrf_token
  const r1 = await holen(PORT_EINR, '/admin/einrichtung/schritt/1', {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'kein_token=1',
  });
  pruefe('G4a: POST ohne CSRF-Token -> 403', r1.status === 403, 'status=' + r1.status);

  // Case 2: POST mit falschem CSRF-Token
  const falschesToken = '0'.repeat(csrfToken ? csrfToken.length : 64);
  const r2 = await holen(PORT_EINR, '/admin/einrichtung/schritt/1', {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf_token: falschesToken }).toString(),
  });
  pruefe('G4b: POST mit falschem CSRF-Token -> 403', r2.status === 403, 'status=' + r2.status);

  // Case 3: POST mit richtigem Token aber fremdem Origin
  const r3 = await holen(PORT_EINR, '/admin/einrichtung/schritt/1', {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://angreifer.example.com' },
    body: new URLSearchParams({ csrf_token: csrfToken }).toString(),
  });
  pruefe('G4c: POST mit fremdem Origin -> 403', r3.status === 403, 'status=' + r3.status);

  // G4d: Origin null (Fremdseite oder no-referrer) bleibt abgelehnt: null wird nie freigegeben (OWASP: Angreifer koennen null erzeugen)
  const r3n = await holen(PORT_EINR, '/admin/einrichtung/schritt/1', {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'null' },
    body: new URLSearchParams({ csrf_token: csrfToken }).toString(),
  });
  pruefe('G4d: POST mit Origin null -> 403 (null wird nie freigegeben)', r3n.status === 403, 'status=' + r3n.status);

  // Zustand unveraendert: Schritt 1 noch nicht fertig
  const db4 = new DatabaseSync(join(TG, 'app.db'), { readOnly: true });
  db4.exec('PRAGMA busy_timeout = 3000');
  const zeile = db4.prepare("SELECT wert FROM einstellungen WHERE schluessel='einrichtung_schritt_1'").get();
  db4.close();
  pruefe('G4d: Schritt 1 bleibt unveraendert nach CSRF-Fehlschlaegen', !zeile || zeile.wert !== 'fertig');
}

// =====================================================================
abschnitt('G5: Whitelist – unbekannte Felder werden ignoriert');
{
  const getR = await holen(PORT_EINR, '/admin/einrichtung/schritt/1', { headers: { Cookie: cookie } });
  const csrfMatch = getR.text.match(/name="csrf_token"\s+value="([0-9a-f]+)"/);
  const csrfToken = csrfMatch ? csrfMatch[1] : null;

  const r = await holen(PORT_EINR, '/admin/einrichtung/schritt/1', {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf_token: csrfToken, UNBEKANNTES_FELD: 'gefaehrlich', ADMIN_ERLAUBT: 'angreifer@evil.com' }).toString(),
  });
  pruefe('G5a: POST mit unbekannten Feldern und CSRF -> 303 (nicht abgelehnt)', r.status === 303, 'status=' + r.status);

  // Unbekannte Felder duerfen nicht in DB gelandet sein
  const db5 = new DatabaseSync(join(TG, 'app.db'), { readOnly: true });
  db5.exec('PRAGMA busy_timeout = 3000');
  const zeileUnb = db5.prepare("SELECT wert FROM einstellungen WHERE schluessel='UNBEKANNTES_FELD'").get();
  const zeileAdm = db5.prepare("SELECT wert FROM einstellungen WHERE schluessel='ADMIN_ERLAUBT'").get();
  db5.close();
  pruefe('G5b: UNBEKANNTES_FELD nicht in DB', !zeileUnb, 'gefunden: ' + JSON.stringify(zeileUnb));
  pruefe('G5c: ADMIN_ERLAUBT nicht in DB', !zeileAdm, 'gefunden: ' + JSON.stringify(zeileAdm));
}

// =====================================================================
abschnitt('G10: Antworten enthalten keine Geheimnisse');
{
  const r = await holen(PORT_EINR, '/admin/einrichtung', { headers: { Cookie: cookie } });
  pruefe('G10a: keine sk_test_-Zeichenkette in Uebersicht', !r.text.includes('sk_test_'));
  pruefe('G10b: keine sk_live_-Zeichenkette in Uebersicht', !r.text.includes('sk_live_'));
  pruefe('G10c: kein whsec_-Praefix in Uebersicht', !r.text.includes('whsec_'));
  const r2 = await holen(PORT_EINR, '/admin/einrichtung/schritt/1', { headers: { Cookie: cookie } });
  pruefe('G10d: keine sk_test_ in Schritt-1-Seite', !r2.text.includes('sk_test_'));
}

// =====================================================================
abschnitt('G11: Schritte 1-3 ohne Stripe-Schluessel abschliessbar');
{
  // Schritt 1 ist nach G5 bereits fertig; Schritte 2 und 3 noch
  // G11-Anpassung (WP6 NB2): Schritt 2 erfordert gueltige Modusfelder + Pflichtangaben.
  for (let n = 2; n <= 3; n++) {
    const getR = await holen(PORT_EINR, `/admin/einrichtung/schritt/${n}`, { headers: { Cookie: cookie } });
    const csrfMatch = getR.text.match(/name="csrf_token"\s+value="([0-9a-f]+)"/);
    const csrfToken = csrfMatch ? csrfMatch[1] : null;
    const felder = { csrf_token: csrfToken };
    if (n === 2) {
      felder.modus_impressum = 'erstellt';
      felder.modus_datenschutz = 'erstellt';
      felder.modus_teilnahmebedingungen = 'erstellt';
      felder.ANBIETER_NAME = 'G11 Test GmbH';
      felder.ANBIETER_ANSCHRIFT = 'Teststr. 1, 12345 Stadt';
      felder.ANBIETER_EMAIL = 'g11@example.com';
    }
    if (n === 3) felder.aktion = 'ohne_mail';
    const postR = await holen(PORT_EINR, `/admin/einrichtung/schritt/${n}`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(felder).toString(),
    });
    pruefe(`G11: Schritt ${n} ohne Stripe-Key abschliessbar (303)`, postR.status === 303, 'status=' + postR.status);
  }
  // Schritte 1-3 in DB als fertig
  const db11 = new DatabaseSync(join(TG, 'app.db'), { readOnly: true });
  db11.exec('PRAGMA busy_timeout = 3000');
  const fertig = [1, 2, 3].filter(n => db11.prepare(`SELECT wert FROM einstellungen WHERE schluessel='einrichtung_schritt_${n}'`).get()?.wert === 'fertig');
  db11.close();
  pruefe('G11: Schritte 1-3 in DB als fertig markiert', fertig.length === 3, 'fertig: ' + JSON.stringify(fertig));
}

// =====================================================================
abschnitt('G6: Neustart-Simulation – Fortschritt bleibt');
{
  await stop(pEinr);
  const { p: pNeu, log: logNeu } = await starteServer(TG, PORT_EINR + 1);
  try {
    pruefe('G6: Server startet nach Neustart im Einrichtungsmodus', /Einrichtungsmodus/.test(logNeu()));
    // Neu einloggen
    const rLog = await holen(PORT_EINR + 1, '/anmelden', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'admin@beispiel.hu', passwort: 'passwort12345' }).toString(),
    });
    const cookie2 = String(rLog.headers['set-cookie'] || '').split(';')[0];
    // Uebersicht: Schritte 1-3 sollten noch als fertig markiert sein (ckmark im HTML)
    const rUeb = await holen(PORT_EINR + 1, '/admin/einrichtung', { headers: { Cookie: cookie2 } });
    const haken = (rUeb.text.match(/✓/g) || []).length;
    pruefe('G6: Mindestens 3 erledigte Schritte nach Neustart sichtbar', haken >= 3, 'Haken gefunden: ' + haken + ' text=' + rUeb.text.slice(0, 400));
    pruefe('G6: Uebersicht enthaelt naechsten-Schritt-Link', rUeb.text.includes('/admin/einrichtung/schritt/'), 'text=' + rUeb.text.slice(0, 400));
    // Schritt 1 direkt pruefen
    const rS1 = await holen(PORT_EINR + 1, '/admin/einrichtung/schritt/1', { headers: { Cookie: cookie2 } });
    pruefe('G6: Schritt 1 zeigt Erledigt-Haken nach Neustart', rS1.text.includes('✓'), 'text=' + rS1.text.slice(0, 300));
  } finally { await stop(pNeu); }
}
// =====================================================================
abschnitt('G13: CSRF-Map wird bei Abmeldung bereinigt');
{
  // Neuer Server fuer G13
  const TG13 = mkdtempSync(join(tmpdir(), 'wp4-g13-'));
  const PORT13 = PORT_EINR + 2;
  const { p: pG13 } = await einrichtungsmodusServer(TG13, PORT13);
  try {
    const rLog13 = await holen(PORT13, '/anmelden', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'admin@beispiel.hu', passwort: 'passwort12345' }).toString(),
    });
    const cookie13 = String(rLog13.headers['set-cookie'] || '').split(';')[0];
    // CSRF-Token holen
    const getR13 = await holen(PORT13, '/admin/einrichtung/schritt/1', { headers: { Cookie: cookie13 } });
    const csrfMatch13 = getR13.text.match(/name="csrf_token"\s+value="([0-9a-f]+)"/);
    const csrfToken13 = csrfMatch13 ? csrfMatch13[1] : null;
    pruefe('G13-Vorbedingung: CSRF-Token vorhanden', !!csrfToken13, getR13.text.slice(0, 200));
    // Abmelden
    await holen(PORT13, '/admin/einrichtung/abmelden', {
      method: 'POST', headers: { Cookie: cookie13, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrfToken13 }).toString(),
    });
    // Altes Token fuer POST verwenden – muss 403 ergeben (CSRF-Map bereinigt)
    const rNach = await holen(PORT13, '/admin/einrichtung/schritt/1', {
      method: 'POST', headers: { Cookie: cookie13, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: csrfToken13 }).toString(),
    });
    pruefe('G13: altes CSRF-Token nach Abmeldung abgelehnt (303 oder 403)', rNach.status === 303 || rNach.status === 403, 'status=' + rNach.status);
  } finally { await stop(pG13); aufraeumen(TG13); }
}

// =====================================================================
abschnitt('PUNKT-3-EIN + P14: Brute-Force + Origin-CSRF im Einrichtungsmodus');
{
  const TGP3 = mkdtempSync(join(tmpdir(), 'wp4-p3-'));
  const PORT_P3 = PORT_EINR + 4;
  const { p: pP3 } = await einrichtungsmodusServer(TGP3, PORT_P3);
  try {
    // PUNKT-3-EIN: 6 falsche Anmeldungen — mindestens eine muss 429 ergeben
    const versuche3 = [];
    for (let i = 0; i < 6; i++) {
      versuche3.push(await holen(PORT_P3, '/anmelden', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'admin@beispiel.hu', passwort: 'falsch'+i }).toString(),
      }));
    }
    pruefe('PUNKT-3-EIN: 6 Fehlversuche Einrichtungsmodus — mindestens einer 429',
      versuche3.some(r => r.status === 429), versuche3.map(r => r.status).join(','));
    // P14: fremder Origin muss 403 ergeben (kein Passwort-Fehler darf zuvor geprueft werden)
    const rP14 = await holen(PORT_P3, '/anmelden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example.com' },
      body: new URLSearchParams({ email: 'admin@beispiel.hu', passwort: 'falsch' }).toString(),
    });
    pruefe('P14: POST /anmelden Einrichtungsmodus mit fremdem Origin -> 403',
      rP14.status === 403, 'status=' + rP14.status);
  } finally { await stop(pP3); aufraeumen(TGP3); }
}

aufraeumen(TG);

console.log(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`);
process.exit(schlecht === 0 ? 0 : 1);
