// HTTP-Test nur beim Chef ausführen; startet einen isolierten Server, kein /health.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mitVorschauName, rendereKaufmail as renderOffline } from '../kaufmail-vorlage.mjs';
import { plattformName } from '../marke.mjs';
import { crc32, deflateSync } from 'node:zlib';
function testName() {
  const vorher = plattformName();
  const mail = mitVorschauName('Vorschau-Name', () => renderOffline({ titel: 'Probe', betrag: 1900, waehrung: 'EUR', erstellt: '2026-11-16', bestellung_id: 'MUSTER' }, { base: '' }));
  assert.match(mail.text, /Vorschau-Name/);
  assert.ok(mail.html.split('Vorschau-Name').length > 2);
  assert.equal(plattformName(), vorher);
  assert.throws(() => mitVorschauName('Vorschau-Name', () => { throw new Error('Renderfehler'); }), /Renderfehler/);
  assert.equal(plattformName(), vorher);
}
function testPng() {
  const chunk = (typ, data) => {
    const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length); b.write(typ, 4); data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, -4)) >>> 0, b.length - 4); return b;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(64); ihdr.writeUInt32BE(64, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(64 * 257))), chunk('IEND', Buffer.alloc(0))]);
}
testName();
if (process.argv.includes('--offline')) {
  const { pruefePng } = await import('../logo-png.mjs');
  assert.equal(pruefePng(testPng()), null);
  const { vorschauAnbieter, mailAnbieter, setzeAnbieterBasis } = await import('../anbieter.mjs');
  setzeAnbieterBasis({ ANBIETER_NAME: 'Bestand', ANBIETER_EMAIL: 'bestand@example.com' });
  const a = vorschauAnbieter({ name: '<img src=x onerror=alert(1)>', email: 'kaputt', anschrift: '', fremd: 'ignoriert' });
  assert.equal(a.email, 'bestand@example.com');
  assert.equal(a.anschrift, '');
  assert.equal(a.fremd, undefined);
  const html = renderOffline({ titel: 'Probe', betrag: 1900, waehrung: 'EUR', erstellt: '2026-11-16', bestellung_id: 'MUSTER' }, { base: '', anbieter: mailAnbieter({}, a) }).html;
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.equal(vorschauAnbieter({ name: 'x'.repeat(161) }).name, 'Bestand');
  assert.equal(vorschauAnbieter({ name: 'x\u200b' }).name, 'Bestand');
  assert.equal(vorschauAnbieter({ name: '' }).name, '');
  assert.equal(mailAnbieter().ANBIETER_NAME, 'Bestand');
  setzeAnbieterBasis(null);
  console.log('A6-N: synchrone Namensvorschau, Text/Signatur, Fehler-Ruecksetzung und PNG serverfrei OK');
} else if (!process.argv.includes('--isoliert')) {
  const dir = mkdtempSync(join(tmpdir(), 'a6-'));
  try {
    const r = spawnSync(process.execPath, [import.meta.filename, '--isoliert'], { stdio: 'inherit', env: {
      DB_DATEI: join(dir, 'test.db'), TEXT_SPRACHE: 'de', STRIPE_SECRET_KEY: 'sk_test_attrappe', STRIPE_WEBHOOK_SECRET: 'whsec_attrappe',
    } });
    process.exitCode = r.status ?? 1;
  } finally { rmSync(dir, { recursive: true, force: true }); }
} else {
  const { erstelleServer } = await import('../app.mjs');
  const { db } = await import('../db.mjs');
  const { passwortHashen } = await import('../auth.mjs');
  const { MAIL_TABELLEN } = await import('../mail.mjs');
  const { rendereKaufmail } = await import('../kaufmail-vorlage.mjs');
  let versendet = 0;
  const app = erstelleServer({ stripe: {}, webhookSecret: 'whsec_attrappe', base: 'http://localhost', nodeEnv: 'test', mailer: async () => { versendet++; return true; } });
  const passwort = 'VorschauTestPasswort99';
  db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,'admin',?)").run('a6@example.com', await passwortHashen(passwort), new Date().toISOString());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/api/admin/marke/vorschau/mail?name=Probe')).status, 401);
    const login = await fetch(base + '/api/anmelden', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a6@example.com', passwort }) });
    const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
    const stand = async () => (await fetch(base + '/api/admin/marke', { headers })).json();
    const vorher = await stand();
    const zahlen = () => Object.fromEntries(['marke', ...MAIL_TABELLEN].map(t => [t, db.prepare('SELECT COUNT(*) AS n FROM ' + t).get().n]));
    const vor = zahlen();
    const post = (body, auth = headers) => fetch(base + '/api/admin/marke/vorschau/mail', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ name: 'Probe' }, {})).status, 401);
    const png = 'data:image/png;base64,' + testPng().toString('base64');
    const getToken = (token, auth = headers) => fetch(base + '/api/admin/marke/vorschau/mail?token=' + encodeURIComponent(token), { headers: auth });
    const frameHeader = r => {
      assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'");
    };
    const gut = await post({ name: 'Vorschau-Name', logo: png });
    assert.equal(gut.status, 200);
    const { token } = await gut.json();
    assert.match(token, /^[a-f0-9]{32}$/);
    const mail = await getToken(token); assert.equal(mail.status, 200); frameHeader(mail);
    const inhalt = await mail.text(); assert.match(inhalt, /src="data:image\/png;base64,/);
    assert.ok(inhalt.split('Vorschau-Name').length > 2);
    assert.equal((await getToken(token, {})).status, 401);
    db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,'admin',?)").run('a6-fremd@example.com', await passwortHashen(passwort), new Date().toISOString());
    const fremdLogin = await fetch(base + '/api/anmelden', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a6-fremd@example.com', passwort }) });
    const fremd = await getToken(token, { Cookie: fremdLogin.headers.get('set-cookie').split(';')[0] });
    assert.equal(fremd.status, 404); frameHeader(fremd); assert.equal((await fremd.json()).fehler, 'vorschau_abgelaufen');
    const unbekannt = await getToken('0'.repeat(32)); assert.equal(unbekannt.status, 404); frameHeader(unbekannt);
    const echteZeit = Date.now;
    try {
      Date.now = () => echteZeit() + 120_001;
      const abgelaufen = await getToken(token); assert.equal(abgelaufen.status, 404); frameHeader(abgelaufen);
      assert.equal((await abgelaufen.json()).fehler, 'vorschau_abgelaufen');
    } finally { Date.now = echteZeit; }
    for (const logo of ['data:image/png;base64,a2FwdXR0', 'data:image/png;base64,' + Buffer.alloc(512 * 1024 + 1).toString('base64'), '']) {
      const kaputt = await post({ name: 'Probe', logo }); assert.equal(kaputt.status, 200);
      const vorschau = await getToken((await kaputt.json()).token);
      assert.equal(vorschau.status, 200); assert.doesNotMatch(await vorschau.text(), /src="data:/);
    }
    const gross = await post({ name: 'Probe', logo: 'x'.repeat(901 * 1024) });
    assert.equal(gross.status, 413); frameHeader(gross);
    const jsonKaputt = await fetch(base + '/api/admin/marke/vorschau/mail', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(jsonKaputt.status, 400); frameHeader(jsonKaputt);
    assert.equal((await jsonKaputt.json()).fehler, 'ungueltiges_json');
    // Zusaetzliches Padding ist dekodierbar, aber nicht kanonisch.
    const nichtKanonisch = await post({ name: 'Probe', logo: png + '=' });
    assert.doesNotMatch(await (await getToken((await nichtKanonisch.json()).token)).text(), /src="data:/);
    const fremdHeaders = { Cookie: fremdLogin.headers.get('set-cookie').split(';')[0] };
    const fremdToken = (await (await post({ name: 'Probe' }, fremdHeaders)).json()).token;
    const eigeneTokens = [];
    for (let i = 0; i < 6; i++) eigeneTokens.push((await (await post({ name: 'Probe' })).json()).token);
    assert.equal((await getToken(eigeneTokens[0])).status, 404);
    assert.equal((await getToken(eigeneTokens[1])).status, 200);
    assert.equal((await getToken(fremdToken, fremdHeaders)).status, 200);
    assert.equal((await post({ name: '<img src=x onerror=alert(1)>' })).status, 422);
    assert.equal((await post({ name: 'Probe' }, { ...headers, Origin: 'https://fremd.example' })).status, 403);
    let erster;
    for (let i = 0; i < 21; i++) {
      const antwort = await post({ name: 'Probe' }); assert.equal(antwort.status, 200);
      const { token } = await antwort.json(); if (i === 0) erster = token;
    }
    const verdraengt = await getToken(erster); assert.equal(verdraengt.status, 404); frameHeader(verdraengt);
    const r = await fetch(base + '/api/admin/marke/vorschau/mail?name=Ungespeicherte%20Marke', { headers });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'");
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');   // Browser-Gegenprobe: globales DENY haette den Iframe der Admin-Seite blockiert
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(await r.text(), /Ungespeicherte Marke/);
    for (const name of ['', '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"', "'", 'a'.repeat(61)]) {
      const ungueltig = await fetch(base + '/api/admin/marke/vorschau/mail?name=' + encodeURIComponent(name), { headers });
      assert.equal(ungueltig.status, 422); frameHeader(ungueltig);
    }
    const farbe = await fetch(base + '/api/admin/marke/farben-pruefen', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ haupt: '#d4a843', dunkel: '#0d0a05', hell: '#faf6ee' }) });
    assert.ok((await farbe.json()).tokens.gold);
    const html = rendereKaufmail({ titel: 'Beispiel', betrag: 1900, waehrung: 'EUR', erstellt: '2026-11-16', bestellung_id: 'MUSTER' }, { base: '', name: '<img src=x onerror=alert(1)>"\'', logo: '/marke/logo.png' }).html;
    assert.match(html, /&lt;img/); assert.match(html, /&quot;/); assert.match(html, /&#39;/);
    assert.match(html, /src="\/marke\/logo.png"/); assert.doesNotMatch(html, /<img src=x/);
    assert.deepEqual(zahlen(), vor);
    assert.deepEqual(await stand(), vorher);
    assert.equal(versendet, 0);
    const { mailAnbieter } = await import('../anbieter.mjs');
    const { HU } = await import('../texte.mjs');
    const anbieter = { name: 'Anbieter Test', anschrift: 'Teststrasse 1', email: 'anbieter@example.com', telefon: '+36123456789', adoszam: '12345678-1-42', steuerHinweis: 'Steuerhinweis Probe' };
    db.prepare("INSERT OR REPLACE INTO marke(schluessel,wert,aktualisiert_am) VALUES('anbieter',?,datetime('now'))").run(JSON.stringify(anbieter));
    const preview = await (await getToken((await (await post({ name: 'Vorschau-Name' })).json()).token)).text();
    const echt = mitVorschauName('Vorschau-Name', () => rendereKaufmail({ titel: HU.marke_vorschau_beispiel, betrag: 1900, waehrung: 'EUR', erstellt: '2026-11-16T12:00:00Z', bestellung_id: 'MUSTER', email: '', typ: 'einmal' }, { base: '', anbieter: mailAnbieter() }));
    assert.equal(preview, echt.html);
    const entwurf = await post({ name: 'Vorschau-Name', anbieter: { name: '<img src=x onerror=alert(1)>', email: 'kaputt', telefon: '', fremd: 'UNBEKANNT' } });
    const entwurfHtml = await (await getToken((await entwurf.json()).token)).text();
    assert.match(entwurfHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(entwurfHtml, /<img src=x|UNBEKANNT/);
    assert.ok(entwurfHtml.includes(anbieter.email));
    assert.ok(!entwurfHtml.includes(anbieter.telefon));
    assert.deepEqual((await stand()).anbieter.name, anbieter.name);
    for (const feld of Object.values(anbieter)) assert.ok(preview.includes(feld));
    assert.equal(plattformName(), vorher.name);
    console.log('A6: HTTP, Header, XSS, Tokens und Nebenwirkungsfreiheit OK');
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
}
