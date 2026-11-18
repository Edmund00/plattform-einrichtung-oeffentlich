// F-131: Browser-Anmeldung im Einrichtungsmodus liefert 403 (Referrer-Policy no-referrer -> Origin null).
// Fix: GET /anmelden setzt Referrer-Policy: same-origin statt no-referrer.
// Abnahme: A=Header, B=Login OK->303, C=Origin null->403, D=fremd->403, E=falschPW->401, F=kein Origin=unveraendert.
import './test-sprache.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 4491;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = 'admin@beispiel.hu';
const ADMIN_PW = 'passwort12345';

let ok = 0, schlecht = 0;
const pruefe = (name, bed, detail = '') => { bed ? ok++ : schlecht++; console.log(`${bed ? 'OK     ' : 'FEHLER '} ${name}${!bed && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = (p) => { try { rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ } };

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

function formBody(obj) { return new URLSearchParams(obj).toString(); }

// ---- Server im Einrichtungsmodus aufbauen ----
const tmpord = mkdtempSync(join(tmpdir(), `pe-f131-${Date.now()}-`));
let pEin = null;
let pSetup = null;
try {
  // Setup-Modus: Admin anlegen
  ({ p: pSetup } = await starteServer(tmpord, PORT, { EINRICHTUNGSMODUS: '1' }));
  for (let i = 0; i < 600; i++) {
    if (existsSync(join(tmpord, 'daten', 'ERSTSTART.txt'))) break;
    await warte(100);
  }
  const code = existsSync(join(tmpord, 'daten', 'ERSTSTART.txt'))
    ? readFileSync(join(tmpord, 'daten', 'ERSTSTART.txt'), 'utf8').trim() : null;
  if (code) {
    await holen(PORT, '/einrichtung', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ code, email: ADMIN_EMAIL, passwort: ADMIN_PW }),
    });
  }
  await stop(pSetup);

  // Einrichtungsmodus: mit BASE_URL damit Origin-Pruefung korrekt ist
  const einr = await starteServer(tmpord, PORT, { BASE_URL: BASE });
  pEin = einr.p;

  // =====================================================================
  abschnitt('F-131-A: GET /anmelden liefert Referrer-Policy: same-origin');
  {
    const r = await holen(PORT, '/anmelden');
    pruefe('F-131-A Status 200', r.status === 200, `Status: ${r.status}`);
    pruefe('F-131-A Referrer-Policy: same-origin', r.headers['referrer-policy'] === 'same-origin', `Header: ${r.headers['referrer-policy']}`);
  }

  // =====================================================================
  abschnitt('F-131-B: POST mit gueltigen Admin-Daten und Origin:<base> => 303 /admin/einrichtung');
  {
    const r = await holen(PORT, '/anmelden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': BASE },
      body: formBody({ email: ADMIN_EMAIL, passwort: ADMIN_PW }),
    });
    pruefe('F-131-B Status 303', r.status === 303, `Status: ${r.status}`);
    pruefe('F-131-B Location: /admin/einrichtung', r.headers['location'] === '/admin/einrichtung', `Location: ${r.headers['location']}`);
  }

  // =====================================================================
  abschnitt('F-131-C: POST mit Origin: null => 403 (bleibt abgelehnt)');
  {
    const r = await holen(PORT, '/anmelden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'null' },
      body: formBody({ email: ADMIN_EMAIL, passwort: ADMIN_PW }),
    });
    pruefe('F-131-C Status 403', r.status === 403, `Status: ${r.status}`);
  }

  // =====================================================================
  abschnitt('F-131-D: POST mit fremdem Origin => 403');
  {
    const r = await holen(PORT, '/anmelden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'https://evil.example' },
      body: formBody({ email: ADMIN_EMAIL, passwort: ADMIN_PW }),
    });
    pruefe('F-131-D Status 403', r.status === 403, `Status: ${r.status}`);
  }

  // =====================================================================
  abschnitt('F-131-E: POST mit richtigem Origin aber falschem Passwort => 401');
  {
    const r = await holen(PORT, '/anmelden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': BASE },
      body: formBody({ email: ADMIN_EMAIL, passwort: 'FalschesPasswort' }),
    });
    pruefe('F-131-E Status 401', r.status === 401, `Status: ${r.status}`);
  }

  // =====================================================================
  abschnitt('F-131-F: POST ohne Origin-Header => kein 403 (Server-zu-Server unveraendert)');
  {
    const r = await holen(PORT, '/anmelden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ email: ADMIN_EMAIL, passwort: ADMIN_PW }),
    });
    pruefe('F-131-F kein 403 (erwartet 303 oder 401)', r.status !== 403, `Status: ${r.status}`);
  }

} finally {
  if (pSetup) await stop(pSetup);
  if (pEin) await stop(pEin);
  aufraeumen(tmpord);
}

console.log('');
console.log(`Ergebnis: ${ok} OK, ${schlecht} FEHLER`);
if (schlecht > 0) process.exit(1);
