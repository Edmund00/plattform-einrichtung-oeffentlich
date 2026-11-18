import './test-sprache.mjs';
// F-108: Passwort-Dialog bei stepup_noetig in admin.js (Widerruf erledigt) und
// Einrichtungs-Assistent Schritt 4 (Stripe-Schuessel setzen/loeschen).
// Pruefungen: Quelltextinhalt + API-Verhalten (kein Browser noetig).
// Aufruf: node --disable-warning=ExperimentalWarning tools/selbsttest-stepup-frontend.mjs
import { readFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const PLATTFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPRACHEN = ['de', 'en', 'hu'];
const T = Object.fromEntries(SPRACHEN.map((l) => [l, JSON.parse(readFileSync(join(PLATTFORM, 'texte', l + '.json'), 'utf8'))]));
const adminJs = readFileSync(join(PLATTFORM, 'public', 'admin', 'admin.js'), 'utf8');
const assistentMjs = readFileSync(join(PLATTFORM, 'assistent-routen.mjs'), 'utf8');

let ok = 0, schlecht = 0;
const pruefe = (name, bed, detail = '') => { bed ? ok++ : schlecht++; console.log(`${bed ? 'OK     ' : 'FEHLER '} ${name}${!bed && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = (p) => { try { rmSync(p, { recursive: true, force: true }); } catch { /* Temp */ } };

const SERVER = resolve(PLATTFORM, 'server.mjs');
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
  const { p, log } = await starteServer(tmpord, port, { EINRICHTUNGSMODUS: '1' });
  return { p, log, hatAdmin: !!code };
}

async function anmeldenMitCookie(port, email, passwort) {
  const r1 = await holen(port, '/anmelden');
  const cookie = r1.headers['set-cookie'] ?? '';
  const r2 = await holen(port, '/anmelden', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ email, passwort }).toString(),
  });
  return r2.headers['set-cookie'] ?? cookie;
}

// ======================================================================
abschnitt('A: Quelltextprüfungen admin.js');
pruefe('A-1 stepupAnfordern() vorhanden', adminJs.includes('function stepupAnfordern()'), 'Funktion fehlt');
pruefe('A-2 apiMitStepup() vorhanden', adminJs.includes('function apiMitStepup('), 'Funktion fehlt');
pruefe('A-3 Widerruf-erledigt nutzt apiMitStepup', adminJs.includes("apiMitStepup('POST', '/api/admin/widerrufe/"), 'widerruf call fehlt');
pruefe('A-4 stepupAnfordern: 401 stepup_noetig erkennt', adminJs.includes("r.d?.fehler !== 'stepup_noetig'"), 'Erkennung fehlt');
pruefe('A-5 stepupAnfordern: bei 429 kein Wiederholversuch', adminJs.includes("r.status === 429") && adminJs.includes("abbrechenKnopf.click()"), 'Sperre fehlt');
pruefe('A-6 stepupAnfordern: Text stepup_noetig benutzt', adminJs.includes("t('stepup_noetig')"), 'Text fehlt');

// ======================================================================
abschnitt('B: Quelltextprüfungen assistent-routen.mjs');
pruefe('B-1 zeigeStepupDialog in Schritt-4-Skript', assistentMjs.includes('zeigeStepupDialog'), 'Funktion fehlt');
pruefe('B-2 submitieren in Schritt-4-Skript', assistentMjs.includes('function submitieren('), 'Funktion fehlt');
pruefe('B-3 submitieren: fängt 401 stepup_noetig ab', assistentMjs.includes("'stepup_noetig'")&&assistentMjs.includes('zeigeStepupDialog(function(){submitieren(aktion);}'), 'Wiederholung fehlt');
pruefe('B-4 submitieren: location.href auf Redirect', assistentMjs.includes('location.href=r.url'), 'Redirect fehlt');
pruefe('B-5 zeigeStepupDialog: POST /api/admin/stepup', assistentMjs.includes("'/api/admin/stepup'"), 'API-Aufruf fehlt');

// ======================================================================
abschnitt('C: Texte stepup_bestaetigen / stepup_noetig');
for (const l of SPRACHEN) {
  pruefe(`C-${l}-1 stepup_noetig vorhanden`, typeof T[l].stepup_noetig === 'string' && T[l].stepup_noetig.length >= 5);
  pruefe(`C-${l}-2 stepup_bestaetigen vorhanden`, typeof T[l].stepup_bestaetigen === 'string' && T[l].stepup_bestaetigen.length >= 5);
}

// ======================================================================
abschnitt('D: API-Verhalten Einrichtungs-Assistent Schritt 4');
let tmpD;
const portD = 19580;
{
  tmpD = mkdtempSync(join(tmpdir(), 'stepup-frontend-d-'));
  mkdirSync(join(tmpD, 'daten'), { recursive: true });
  let pD;
  try {
    const { p, log, hatAdmin } = await einrichtungsmodusServer(tmpD, portD);
    pD = p;
    pruefe('D-1 Einrichtungsmodus-Server gestartet', /Schulungsplattform/.test(log()), log().slice(0, 300));
    pruefe('D-2 Admin-Konto angelegt', hatAdmin);

    const ck = await anmeldenMitCookie(portD, 'admin@beispiel.hu', 'passwort12345');
    // Schritt 4 ohne Stepup
    const r4Html = await holen(portD, '/admin/einrichtung/schritt/4', { headers: { Cookie: ck } });
    const csrfMatch = r4Html.text.match(/name="csrf_token" value="([0-9a-f]+)"/);
    const csrf = csrfMatch ? csrfMatch[1] : '';
    pruefe('D-3 Schritt-4-Seite: 200', r4Html.status === 200, r4Html.status);
    pruefe('D-4 Schritt-4-Seite: CSRF-Token vorhanden', csrf.length === 64, `csrf='${csrf}'`);

    const ohneStepup = await holen(portD, '/admin/einrichtung/schritt/4', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: ck },
      body: new URLSearchParams({ csrf_token: csrf, STRIPE_SECRET_KEY: 'sk_test_dummy123456789012345', STRIPE_WEBHOOK_SECRET: 'whsec_test123' }).toString(),
    });
    pruefe('D-5 Schritt-4-POST ohne Stepup → 401', ohneStepup.status === 401, `status=${ohneStepup.status}`);
    pruefe('D-6 Schritt-4-POST ohne Stepup → stepup_noetig', ohneStepup.text.trim() === 'stepup_noetig', `body='${ohneStepup.text.slice(0, 100)}'`);

    // Stepup durchführen, dann Schritt 4 nochmal
    const stepupRes = await holen(portD, '/api/admin/stepup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ck },
      body: JSON.stringify({ passwort: 'passwort12345' }),
    });
    pruefe('D-7 Stepup erfolgreich', stepupRes.status === 200, `status=${stepupRes.status} body=${stepupRes.text.slice(0,100)}`);

    const mitStepup = await holen(portD, '/admin/einrichtung/schritt/4', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: ck },
      body: new URLSearchParams({ csrf_token: csrf, STRIPE_SECRET_KEY: 'sk_test_dummy123456789012345', STRIPE_WEBHOOK_SECRET: 'whsec_test123' }).toString(),
    });
    pruefe('D-8 Schritt-4-POST mit Stepup → Redirect (kein 401)', mitStepup.status !== 401 && (mitStepup.status === 302 || mitStepup.status === 303 || mitStepup.status === 200), `status=${mitStepup.status}`);
  } finally {
    if (pD) await stop(pD);
    aufraeumen(tmpD);
  }
}

console.log(`\nstepup-frontend: ${ok} OK, ${schlecht} FEHLER`);
process.exit(schlecht ? 1 : 0);
