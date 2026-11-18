import './test-sprache.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir = mkdtempSync(join(tmpdir(), 'pe-farben-'));
process.env.DB_DATEI = join(dir, 'test.db');
const { erstelleServer } = await import('../app.mjs');
const { db } = await import('../db.mjs');
const { passwortHashen } = await import('../auth.mjs');
const { leiteAb } = await import('../farben.mjs');
const pass = 'FarbenTestPasswort99';
db.prepare('INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)').run('farbe@example.com', await passwortHashen(pass), 'admin', new Date().toISOString());
db.prepare('INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)').run('kunde@example.com', await passwortHashen(pass), 'kunde', new Date().toISOString());
const servers = [];
let port, cookie = '';
const gut = { haupt: '#0b5cad', dunkel: '#000000', hell: '#f5f7fa' };
const schlecht = { haupt: '#808080', dunkel: '#777777', hell: '#888888' };
async function start() {
  const s = erstelleServer({ stripe: {}, webhookSecret: 'test', base: 'http://localhost', nodeEnv: 'test', dbDatei: process.env.DB_DATEI }).listen(0, '127.0.0.1');
  servers.push(s);
  await new Promise((resolve, reject) => { s.once('listening', resolve); s.once('error', reject); });
  port = s.address().port;
}
async function req(path, method = 'GET', data, headers = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  const text = await r.text();
  return { status: r.status, headers: r.headers, text, json: () => JSON.parse(text) };
}
const api = (method, data, headers) => req('/api/admin/marke/farben', method, data, headers);
async function link() {
  let href;
  for (const path of ['/', '/admin/', '/jogi/impresszum', '/__farben-nicht-vorhanden']) {
    const r = await req(path, 'GET', undefined, { Accept: 'text/html' });
    assert.match(r.headers.get('content-security-policy'), /style-src 'self'/);
    const match = r.text.match(/<link rel="stylesheet" href="(\/marke.css\?v=[a-z0-9]+)">/);
    assert.ok(match, path);
    if (path === '/' || path === '/admin/' || r.status === 404) {
      const stilblatt = path === '/' ? 'href="kunde.css"' : path === '/admin/' ? 'href="admin.css"' : 'href="/kunde.css"';
      assert.ok(r.text.indexOf(stilblatt) >= 0 && r.text.indexOf(stilblatt) < match.index, path + ': marke.css nach ' + stilblatt);
    }
    if (href) assert.equal(match[1], href);
    href = match[1];
  }
  return href;
}
try {
  await start();
  let r = await req('/marke.css');
  assert.equal(r.status, 200, 'Standard CSS Status');
  assert.equal(r.text, '');
  assert.match(r.headers.get('content-type'), /text\/css/);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('etag'));
  const standardEtag = r.headers.get('etag');
  assert.equal((await req('/marke.css', 'GET', undefined, { 'If-None-Match': r.headers.get('etag') })).status, 304);
  const standardLink = await link();
  assert.equal(leiteAb({ haupt: '#d4a843', dunkel: '#0d0a05', hell: '#faf6ee' }).ok, true);
  for (const method of ['PUT', 'DELETE', 'POST']) {
    const path = '/api/admin/marke/' + (method === 'POST' ? 'farben-pruefen' : 'farben');
    assert.ok([401, 403].includes((await req(path, method, gut)).status));
  }
  const kunde = await req('/api/anmelden', 'POST', { email: 'kunde@example.com', passwort: pass });
  cookie = kunde.headers.get('set-cookie').split(';')[0];
  for (const method of ['PUT', 'DELETE', 'POST']) {
    const path = '/api/admin/marke/' + (method === 'POST' ? 'farben-pruefen' : 'farben');
    assert.equal((await req(path, method, gut)).status, 403);
  }
  const login = await req('/api/anmelden', 'POST', { email: 'farbe@example.com', passwort: pass });
  cookie = login.headers.get('set-cookie').split(';')[0];
  for (const method of ['PUT', 'DELETE']) assert.equal((await api(method, gut)).status, 401);
  assert.equal((await req('/api/admin/stepup', 'POST', { passwort: pass })).status, 200);
  for (const method of ['PUT', 'DELETE', 'POST']) {
    assert.equal((await req('/api/admin/marke/' + (method === 'POST' ? 'farben-pruefen' : 'farben'), method, gut, { Origin: 'https://fremd.example' })).status, 403);
  }
  for (const haupt of ['#abc', 'red', '#12345g']) {
    for (const path of ['farben', 'farben-pruefen']) {
      r = await req('/api/admin/marke/' + path, path === 'farben' ? 'PUT' : 'POST', { ...gut, haupt });
      assert.equal(r.status, 422);
      assert.equal(r.json().fehler, 'farbe_ungueltig');
      assert.ok(r.json().probleme.some(p => p.feld === 'haupt'));
    }
  }
  r = await req('/api/admin/marke/farben-pruefen', 'POST', schlecht);
  assert.equal(r.status, 200);
  assert.equal(r.json().ok, false);
  assert.equal(r.json().pruefung.length, 18);
  assert.equal((await req('/marke.css')).text, '');
  r = await api('PUT', schlecht);
  assert.equal(r.status, 422);
  assert.equal(r.json().fehler, 'farben_kontrast');
  assert.ok(r.json().probleme.some(p => p.paar && typeof p.verhaeltnis === 'number' && typeof p.soll === 'number'));
  assert.equal((await req('/marke.css')).text, '');
  assert.equal((await req('/api/admin/marke/farben-pruefen', 'POST', gut)).json().ok, true);
  assert.equal((await req('/marke.css')).text, '');
  assert.equal((await req('/api/admin/marke')).json().farben, null);
  assert.equal((await api('PUT', { ...gut, haupt: '#0B5CAD' })).status, 200);
  const css = (await req('/marke.css')).text;
  r = await req('/marke.css');
  assert.notEqual(r.headers.get('etag'), standardEtag);
  assert.equal((await req('/marke.css', 'GET', undefined, { 'If-None-Match': r.headers.get('etag') })).status, 304);
  assert.match(css, /^:root\{(--[a-z-]+:#[0-9a-f]{6};)+\}$/);
  assert.ok(css.includes('--gold:#0b5cad;') && css.includes('--night:#000000;') && css.includes('--ivory:#f5f7fa;'));
  const hash = createHash('sha1').update(css).digest('hex').slice(0, 8);
  assert.equal((await req('/api/admin/marke')).json().farben.hash, hash);
  assert.equal(await link(), '/marke.css?v=' + hash);
  assert.notEqual(await link(), standardLink);
  assert.deepEqual(JSON.parse(db.prepare("SELECT wert FROM marke WHERE schluessel='farben'").get().wert), gut);
  await new Promise(r => servers[0].close(r));
  await start();
  assert.equal((await req('/marke.css')).text, css);
  assert.equal(await link(), '/marke.css?v=' + hash);
  assert.equal((await api('PUT', schlecht)).status, 422);
  assert.equal((await req('/marke.css')).text, css);
  assert.equal((await api('DELETE')).status, 200);
  assert.equal((await req('/marke.css')).text, '');
  assert.equal((await req('/marke.css')).headers.get('etag'), standardEtag);
  assert.equal(await link(), standardLink);
  assert.equal((await req('/api/admin/marke')).json().farben, null);
  db.prepare("INSERT OR REPLACE INTO marke VALUES('farben',?,datetime('now'))").run('{defekt');
  assert.equal((await req('/marke.css')).text, '');
  console.log('FERTIG: Farben-Server alle Pruefungen gruen');
} catch (e) {
  console.error('FEHLER', e);
  process.exitCode = 1;
} finally {
  for (const s of servers) if (s.listening) await new Promise(r => s.close(r));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
