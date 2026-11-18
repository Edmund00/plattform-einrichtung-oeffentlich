// Nur vom Chef ausführen: startet eigene Server mit isolierter Test-DB.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { SETUP_DATEIEN } from '../setup-statisch.mjs';
const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'e2e3-'));
const port = Number(process.env.E2E3_TEST_PORT || 4497);
const basis = `http://127.0.0.1:${port}`;
let child;
const pause = ms => new Promise(r => setTimeout(r, ms));
async function stop() {
  if (!child || child.exitCode !== null) return;
  const ende = new Promise(r => child.once('exit', r));
  child.kill();
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  await ende;
  clearTimeout(timer);
}
async function start() {
  child = spawn(process.execPath, [join(root, 'server.mjs')], {
    cwd: temp, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      PORT: String(port), DB_DATEI: join(temp, 'app.db'), EINRICHTUNGSMODUS: '1', TEXT_SPRACHE: 'de' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 150; i++) {
    assert.equal(child.exitCode, null, 'Testserver unerwartet beendet');
    try { const r = await fetch(basis + '/health'); if (r.ok) return; } catch { /* wartet auf Start */ }
    await pause(100);
  }
  throw new Error('Testserver nicht bereit');
}
// Roher HTTP-Pfad verhindert die Normalisierung von Traversal durch fetch/URL.
function raw(pfad) {
  return new Promise((ok, nein) => {
    const req = request({ hostname: '127.0.0.1', port, path: pfad }, res => { let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; }); res.on('end', () => ok({ status: res.statusCode, body })); });
    req.on('error', nein); req.end();
  });
}
// Attribute am jeweiligen Element prüfen, damit Formular- und Feldwerte getrennt bleiben.
function pruefePasswortmanager(html, erststart) {
  const forms = html.match(/<form\b[^>]*>/g) || [];
  assert.equal(forms.length, 1);
  assert.doesNotMatch(forms[0], /\bautocomplete\s*=\s*["']off["']/i);
  const input = name => {
    const tag = (html.match(/<input\b[^>]*>/g) || []).find(t => t.includes('name="' + name + '"'));
    assert.ok(tag, 'Feld fehlt: ' + name);
    return tag;
  };
  assert.match(input('email'), /\btype="email"/);
  assert.ok(input('email').includes('autocomplete="' + (erststart ? 'email' : 'username') + '"'));
  assert.match(input('passwort'), /\btype="password"/);
  assert.ok(input('passwort').includes('autocomplete="' + (erststart ? 'new-password' : 'current-password') + '"'));
  if (erststart) {
    assert.match(input('code'), /\bautocomplete="off"/);
    assert.match(input('code'), /\bspellcheck="false"/);
    assert.match(input('code'), /\bautocapitalize="off"/);
  }
}
const post = (pfad, body) => fetch(basis + pfad, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
try {
  const serverQuelle = readFileSync(join(root, 'server.mjs'), 'utf8');
  const serverAnfang = serverQuelle.split(/^.*\bawait\b.*$/m)[0];
  assert.doesNotMatch(serverAnfang, /\bimport\s+(?!\()[^;]*['"]\.\/(?:einrichtung-routen|texte|auth|db|marke)\.mjs['"]/,
    'Vor der ersten await-Zeile keine statischen Importe mit DB-Nebenwirkungen');
  const src = readFileSync(join(root, 'setup-statisch.mjs'), 'utf8');
  assert.match(src, /resolve\(modulOrdner, 'public', '\.' \+ pfad\)/);
  assert.doesNotMatch(src, /express\.static/);
  assert.equal(SETUP_DATEIEN.length, 9);
  const fonts = [...readFileSync(join(root, 'public/fonts/fonts.css'), 'utf8').matchAll(/url\(([^)]+)\)/g)].map(m => m[1]);
  assert.deepEqual(SETUP_DATEIEN.filter(p => p.endsWith('.woff2')).sort(), fonts.sort());
  for (const p of SETUP_DATEIEN) {
    assert.ok(/\.(css|woff2)$/.test(p) && !p.includes('..'));
    assert.ok(resolve(root, 'public', '.' + p).startsWith(join(root, 'public') + sep));
  }
  await start();
  for (const l of ['hu', 'en', 'de']) {
    const t = JSON.parse(readFileSync(join(root, 'texte', l + '.json'), 'utf8'));
    for (const path of ['/einrichtung', '/anmelden']) {
      const r = await fetch(basis + path + '?lang=' + l);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('set-cookie'), new RegExp('lang=' + l));
      const html = await r.text();
      assert.ok(html.includes(`lang="${l}"`) && html.includes('href="/kunde.css"'));
      assert.ok(html.includes(t[path === '/einrichtung' ? 'einrichtung_willkommen' : 'einrichtung_konto']));
      if (path === '/einrichtung') {
        pruefePasswortmanager(html, true);
        assert.ok(!html.includes(t.einrichtung_neutral));
        assert.doesNotMatch(html, /role="alert"/);
        assert.doesNotMatch(html, /href=["']#code["']/);
        const buttons = [...html.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)];
        assert.equal(buttons.length, 1);
        assert.equal(buttons[0][1], t.einrichtung_starten);
        assert.match(buttons[0][0], /type="submit"/);
        if (l === 'de') assert.equal(buttons[0][1], 'Einrichtung starten');
        assert.ok(html.includes('<h2>' + t.einrichtung_zugang + '</h2>'));
      }
      assert.equal((r.headers.get('set-cookie').match(/lang=/g) || []).length, 1);
      for (const w of ['de', 'hu', 'en']) assert.ok(html.includes('?lang=' + w));
    }
  }
  for (const p of SETUP_DATEIEN) {
    const r = await fetch(basis + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), p.endsWith('.css') ? /text\/css/ : /font\/woff2/);
    assert.match(r.headers.get('cache-control'), /max-age=300(?:,|$)/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    await r.arrayBuffer();
  }
  for (const p of ['/kunde.js', '/admin/admin.js', '/fonts/fonts.css/', '/KUNDE.CSS', '//kunde.css', '/fonts/%2e%2e/server.mjs', '/fonts/..%2fserver.mjs', '/fonts/..\\server.mjs', '/admin/../server.mjs', '/fonts/../server.mjs', '/%2e%2e/server.mjs']) {
    const r = await raw(p);
    assert.notEqual(r.status, 200, p);
    for (const f of ['server.mjs', 'public/kunde.js', 'public/admin/admin.js']) {
      const source = readFileSync(join(root, f), 'utf8');
      assert.ok(!r.body.includes(source), p + ': kein vollständiger Quelltext');
    }
    assert.doesNotMatch(r.body, /(?:^|\n)\s*(?:import\s|export\s|const\s|let\s|function\s)|@font-face|--[a-z-]+\s*:/, p);
  }
  const neutraleAntworten = new Map();
  for (const l of ['hu', 'en']) {
    const t = JSON.parse(readFileSync(join(root, 'texte', l + '.json'), 'utf8'));
    let vorher;
    for (const code of ['ungueltig', '']) {
      const invalid = await post('/einrichtung?lang=' + l, { code, email: 'admin@example.test', passwort: '12345678' });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.equal(invalid.headers.get('content-language'), l);
      const bytes = Buffer.from(await invalid.arrayBuffer());
      const html = bytes.toString('utf8');
      const antwort = { bytes, typ: invalid.headers.get('content-type'), laenge: invalid.headers.get('content-length') };
      assert.equal(antwort.laenge, String(bytes.length));
      if (neutraleAntworten.has(l)) assert.deepEqual(antwort, neutraleAntworten.get(l));
      neutraleAntworten.set(l, antwort);
      assert.ok(html.includes('lang="' + l + '"') && html.includes(t.einrichtung_neutral));
      assert.match(html, /href="\/kunde.css"/);
      assert.match(html, /role="alert" class="meldung rot"/);
      assert.doesNotMatch(html, /<input[^>]*\svalue=/);
      if (vorher !== undefined) assert.equal(html, vorher);
      vorher = html;
    }
  }
  const code = readFileSync(join(temp, 'daten/ERSTSTART.txt'), 'utf8').trim();
  // Vier Fehlversuche oben, der fuenfte loest die unveraenderte IP-Sperre aus.
  await (await post('/einrichtung?lang=en', { code: 'falsch' })).arrayBuffer();
  for (const l of ['hu', 'en']) {
    for (const gesperrterCode of ['', 'falsch', code]) {
      const r = await post('/einrichtung?lang=' + l, { code: gesperrterCode, email: 'admin@example.test', passwort: '12345678' });
      assert.equal(r.status, 400);
      assert.deepEqual({ bytes: Buffer.from(await r.arrayBuffer()), typ: r.headers.get('content-type'), laenge: r.headers.get('content-length') }, neutraleAntworten.get(l));
    }
  }
  // Neue Prozessinstanz fuer die folgenden positiven Faelle (Sperren sind pro Prozess).
  await stop(); await start();
  const kurz = await post('/einrichtung?lang=en', { code, email: 'admin@example.test', passwort: 'kurz' });
  assert.equal(kurz.status, 400);
  const kurzHtml = await kurz.text();
  assert.match(kurzHtml, /role="alert"/);
  assert.match(kurzHtml, /<html lang="en">/);
  const angelegt = await post('/einrichtung?lang=hu', { code, email: 'admin@example.test', passwort: '12345678' });
  assert.equal(angelegt.status, 200);
  const db = new DatabaseSync(join(temp, 'app.db'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT sprache FROM benutzer WHERE email=?').get('admin@example.test').sprache, 'hu'); } finally { db.close(); }
  await stop(); await start();
  const anmeldung = await fetch(basis + '/anmelden?lang=en');
  const anmeldungHtml = await anmeldung.text();
  assert.match(anmeldungHtml, /Sign in/);
  pruefePasswortmanager(anmeldungHtml, false);
  const login = await post('/anmelden?lang=en', { email: 'admin@example.test', passwort: '12345678' });
  assert.equal(login.status, 303);
  assert.match(login.headers.get('set-cookie'), /lang=en;/);
  assert.doesNotMatch(login.headers.get('set-cookie'), /lang=hu;/);
  assert.equal((login.headers.get('set-cookie').match(/lang=/g) || []).length, 1);
  for (const cookie of ['lang=en', '']) {
    const r = await fetch(basis + '/anmelden', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: new URLSearchParams({ email: 'admin@example.test', passwort: '12345678' }) });
    assert.equal(r.status, 303);
    if (cookie) assert.doesNotMatch(r.headers.get('set-cookie'), /lang=/);
    else assert.match(r.headers.get('set-cookie'), /lang=hu;/);
  }
  assert.equal((await fetch(basis + '/kunde.css')).status, 200);
  assert.equal((await raw('/admin/admin.js')).status, 404);
  console.log('E2/E3 Einrichtung: alle Prüfungen bestanden');
} finally {
  await stop();
  rmSync(temp, { recursive: true, force: true });
}
