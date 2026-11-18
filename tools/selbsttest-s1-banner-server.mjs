// S1: Nur vom Chef ausführen; startet selbst eine isolierte Testinstanz.
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

const lauf = Date.now();
const tmpDir = mkdtempSync(join(tmpdir(), `pe-a1b-${lauf}-`));
const DB_PFAD = join(tmpDir, 'app.db');
process.env.DB_DATEI = DB_PFAD;

import './test-sprache.mjs';

let ok = 0, schlecht = 0;
const pruefe = (name, bed, detail = '') => { bed ? ok++ : schlecht++; console.log(`${bed ? 'OK     ' : 'FEHLER '} ${name}${!bed && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

function minPng() {
  return Buffer.from('89504e470d0a1a0a0000000d49484452000000400000004008000000008f022e020000002449444154edd08100000000c3a0f953dfe004855061c0800103060c183060c0800103060c18f80303097e9ae90000000049454e44ae426082', 'hex');
}
function altPng() {
  // 128x128 Graustufen-PNG (gültig, pruefePng=null, anderer Size als minPng)
  return Buffer.from('89504e470d0a1a0a0000000d4948445200000080000000800800000000e6553e170000005949444154789cedce21010000000220a73bdd191658407a160101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101817760bc0401e15dd421b70000000049454e44ae426082', 'hex');
}
// 40x40 PNG: zu klein (< 64 px)
function kleinPng() {
  return Buffer.from('89504e470d0a1a0a0000000d494844520000002800000028080000000026065f380000001e49444154edd08100000000c3a0f953dfe0048550610003c001060c18306ac080f570030000000049454e44ae426082', 'hex');
}

const attrappe = {
  webhooks: { constructEventAsync: async () => { throw new Error('kein webhook'); } },
  customers: { create: async () => ({ id: 'cus_attrappe' }) },
  checkout: { sessions: { create: async () => ({ id: 'cs_attrappe', url: 'https://example.com/checkout', status: 'open' }), list: async () => ({ data: [] }) } },
};

const { erstelleServer } = await import('../app.mjs');
const { passwortHashen } = await import('../auth.mjs');
const { db } = await import('../db.mjs');

const PASS = 'MarkeTestPasswort99';
const ph = await passwortHashen(PASS);
db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,'"+ph+"','admin',?)").run('marke-admin@example.com', new Date().toISOString());
db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,'"+ph+"','kunde',?)").run('marke-kunde@example.com', new Date().toISOString());

const alleServer = [];
async function startServer(extraOptionen = {}) {
  const app = erstelleServer({ stripe: attrappe, webhookSecret: 'whsec_attrappe', base: 'http://localhost', nodeEnv: 'test', dbDatei: DB_PFAD, ...extraOptionen });
  const s = app.listen(0, '127.0.0.1');
  alleServer.push(s);
  await warte(300);
  return s;
}

async function holen(port, pfad, { method = 'GET', headers = {}, body = undefined, raw = false } = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, { method, headers: { Accept: 'application/json', ...headers }, body, redirect: 'manual' });
  const text = raw ? null : await r.text();
  const ab = raw ? await r.arrayBuffer() : null;
  return { status: r.status, text, buf: ab ? Buffer.from(ab) : null, headers: Object.fromEntries(r.headers) };
}
async function login(port, email, pass) {
  const r = await fetch(`http://127.0.0.1:${port}/api/anmelden`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, passwort: pass }) });
  return r.headers.get('set-cookie')?.split(';')[0] ?? '';
}
async function stepup(port, cookie, pass) {
  return holen(port, '/api/admin/stepup', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ passwort: pass }) });
}
const { default: assert } = await import('node:assert/strict');
const { crc32, deflateSync } = await import('node:zlib');
const { spawnSync } = await import('node:child_process');
const { randomBytes } = await import('node:crypto');
const { verschluesseln } = await import('../sicherung-format.mjs');
function chunk(type, data) {
    const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, -4)) >>> 0, b.length - 4); return b;
}
function png(w = 400, h = 400) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((w + 1) * h))), chunk('IEND', Buffer.alloc(0))]);
}
// Marker-Fixture, absichtlich keine vollständige Bilddekodierung; echte Bilder separat abnehmen.
const jpeg = Buffer.from('ffd8ffc0000b080190019001011100ffda0008010100003f001122ff0033ffd9', 'hex');
const restore = (enc, out, key, options = []) => {
  const r = spawnSync(process.execPath, ['tools/sicherung-entschluesseln.mjs', enc, out, ...options], { env: { ...process.env, SICHERUNG_SCHLUESSEL: key.toString('base64') }, encoding: 'utf8' });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout;
};
const { pruefeBanner, speichereBanner, bereinigeBanner } = await import('../banner-bild.mjs');
const seg = (marker, data) => { const h = Buffer.alloc(4); h[0] = 255; h[1] = marker; h.writeUInt16BE(data.length + 2, 2); return Buffer.concat([h, data]); };
const mitPngMeta = (...chunks) => Buffer.concat([png().subarray(0, 33), ...chunks, png().subarray(33)]);
const mitJpegMeta = (...segments) => Buffer.concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)]);
try {
  // Strukturgrenzen ohne Dekodierung, einschließlich der exakten Transportgrenze.
  assert.equal(pruefeBanner(png(4096, 4096)).ok, true);
  assert.equal(pruefeBanner(png(4097, 400)), 'banner_abmessung_ungueltig');
  const grossJpeg = Buffer.from(jpeg); grossJpeg.writeUInt16BE(5000, 7); grossJpeg.writeUInt16BE(5000, 9);
  assert.equal(pruefeBanner(grossJpeg), 'banner_abmessung_ungueltig');
  const markerJpeg = mitJpegMeta(...[0xc4, 0xc8, 0xcc].map(m => seg(m, Buffer.from([1]))));
  assert.equal(pruefeBanner(markerJpeg).ok, true);
  const basis = png(), exakt = Buffer.concat([basis.subarray(0, -12), chunk('IDAT', Buffer.alloc(3145728 - basis.length - 12)), basis.subarray(-12)]);
  assert.equal(exakt.length, 3145728); assert.equal(pruefeBanner(exakt).ok, true);
  const corrupt = Buffer.from(png()); corrupt[29] ^= 1;
  assert.equal(pruefeBanner(corrupt), 'banner_crc_fehler');
  // B3: Mehrere progressive Scans, Metadaten dazwischen und unveraenderte Scandaten.
  const kopf = Buffer.from(jpeg.subarray(0, 15)); kopf[3] = 0xc2;
  const sos = jpeg.subarray(15, 25);
  const scan1 = Buffer.from('1122ff0033ffd044ffffd755', 'hex');
  const scan2 = Buffer.from('66ff0077ffd188', 'hex');
  const behalten = [0xe0, 0xe2, 0xee, 0xc4, 0xdb, 0xdd].map(m => seg(m, Buffer.from([1, 2])));
  const ohneMeta = Buffer.concat([kopf, sos, scan1, ...behalten, sos, scan2, Buffer.from('ffd9', 'hex')]);
  const mehrfach = Buffer.concat([kopf, sos, scan1, ...[0xe1, 0xed, 0xfe].map(m => seg(m, Buffer.from('GEHEIM'))), ...behalten, sos, scan2, Buffer.from('ffd9', 'hex')]);
  assert.equal(pruefeBanner(mehrfach).ok, true);
  const sauberMehrfach = bereinigeBanner(mehrfach, 'jpg');
  assert.equal(sauberMehrfach.includes(Buffer.from('GEHEIM')), false);
  assert.deepEqual(sauberMehrfach, ohneMeta);
  assert.deepEqual(pruefeBanner(sauberMehrfach), pruefeBanner(mehrfach));
  assert.deepEqual(bereinigeBanner(ohneMeta, 'jpg'), ohneMeta);
  assert.deepEqual(bereinigeBanner(jpeg, 'jpg'), jpeg);
  // Die Obergrenze summiert Metadaten vor und nach dem ersten SOS.
  const grosseMeta = () => seg(0xe1, Buffer.alloc(60 * 1024));
  assert.equal(pruefeBanner(Buffer.concat([kopf, grosseMeta(), grosseMeta(), sos, scan1, grosseMeta(), grosseMeta(), grosseMeta(), sos, scan2, Buffer.from('ffd9', 'hex')])), 'banner_metadaten_zu_gross');
  // DB-Fehler muss bei gleicher sowie anderer Endung die bisherigen Bytes erhalten.
  const rollbackLogo = join(tmpDir, 'rollback', 'logo.png');
  speichereBanner(png(), rollbackLogo);
  for (const bytes of [png(401), jpeg]) {
    assert.throws(() => speichereBanner(bytes, rollbackLogo, () => { throw Error('DB'); }));
    assert.deepEqual(readFileSync(join(tmpDir, 'rollback', 'banner.png')), png());
    assert.equal(existsSync(join(tmpDir, 'rollback', 'banner.jpg')), false);
  }
  const s = await startServer(), port = s.address().port;
  const englisch = await holen(port, '/api/texte?lang=en', { headers: { Cookie: 'lang=hu', 'Accept-Language': 'de' } });
  assert.equal(JSON.parse(englisch.text)._sprache, 'en');
  assert.equal(JSON.parse(englisch.text).k_oldal_cim, (await import('../texte.mjs')).texteFuer('en').k_oldal_cim);
  assert.equal(englisch.headers['set-cookie'], undefined);
  const startEnglisch = await holen(port, '/?lang=en');
  assert.match(startEnglisch.headers['set-cookie'], /lang=en;/);
  const cookieTexte = await holen(port, '/api/texte', { headers: { Cookie: 'lang=hu', 'Accept-Language': 'en' } });
  assert.equal(JSON.parse(cookieTexte.text)._sprache, 'hu');
  assert.equal(cookieTexte.headers['set-cookie'], undefined);
  assert.equal(JSON.parse((await holen(port, '/api/texte', { headers: { 'Accept-Language': 'en' } })).text)._sprache, 'en');
  const praefix = await holen(port, '/hu/api/texte?lang=en');
  assert.equal(JSON.parse(praefix.text)._sprache, 'en');
  assert.match(praefix.headers['set-cookie'], /lang=en;/);
  const ck = await login(port, 'marke-admin@example.com', PASS);
  const put = (body, cookie = ck, headers = {}) => holen(port, '/api/admin/marke/banner', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie, ...headers }, body });
  const jput = body => holen(port, '/api/admin/marke/hero', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify(body) });
  assert.equal((await put(png(), '')).status, 401);
  assert.equal((await put(png())).status, 401);
  assert.equal((await jput({})).status, 401);
  assert.equal((await holen(port, '/api/admin/marke/banner', { method: 'DELETE', headers: { Cookie: ck } })).status, 401);
  await stepup(port, ck, PASS);
  const kunde = await login(port, 'marke-kunde@example.com', PASS);
  assert.equal((await put(png(), kunde)).status, 403);
  assert.equal((await holen(port, '/api/admin/marke/hero', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await put(png(), ck, { Origin: 'https://fremd.example' })).status, 403);
  assert.equal((await put(png(), ck, { 'Content-Type': 'image/gif' })).status, 415);
  assert.equal(JSON.parse((await put(png(), ck, { 'Content-Type': 'text/plain' })).text).fehler, 'banner_typ');
  assert.equal((await put(exakt)).status, 200);
  assert.equal((await put(Buffer.concat([exakt, Buffer.from([0])]))).status, 413);
  for (const bytes of [Buffer.concat([png(), Buffer.from([0])]), Buffer.concat([jpeg, Buffer.from([0])]), corrupt, grossJpeg, png(4097, 400)]) assert.equal((await put(bytes)).status, 400);
  const metaPng = mitPngMeta(chunk('tEXt', Buffer.from('Exif-GPS')), chunk('eXIf', Buffer.from('Exif-GPS')));
  const metaJpeg = mitJpegMeta(seg(225, Buffer.from('Exif-GPS')), seg(254, Buffer.from('Exif-GPS')));
  for (const [bytes, clean] of [[metaPng, png()], [metaJpeg, jpeg]]) {
    assert.deepEqual(bereinigeBanner(bytes, bytes === metaPng ? 'png' : 'jpg'), clean);
    assert.equal((await put(bytes)).status, 200);
    const got = await holen(port, '/marke/banner', { raw: true });
    assert.deepEqual(got.buf, clean); assert.equal(got.buf.includes(Buffer.from('Exif-GPS')), false);
  }
  const tooMuch = mitJpegMeta(...Array.from({length: 5}, () => seg(254, Buffer.alloc(60 * 1024))));
  for (const bytes of [tooMuch, mitPngMeta(chunk('tEXt', Buffer.alloc(300 * 1024)))]) {
    const r = await put(bytes); assert.equal(r.status, 400); assert.equal(JSON.parse(r.text).fehler, 'banner_metadaten_zu_gross');
  }
  let lastUrl;
  for (const bytes of [png(), jpeg, png()]) {
    const r = await put(bytes, ck, { 'Content-Disposition': 'attachment; filename="../../fremd.png"' });
    assert.equal(r.status, 200, r.text);
    const url = JSON.parse(r.text).url; assert.match(url, /^\/marke\/banner\?v=/); assert.notEqual(url, lastUrl); lastUrl = url;
    const g = await holen(port, url, { raw: true }); assert.equal(g.status, 200); assert.deepEqual(g.buf, bytes);
    assert.equal(g.headers['x-content-type-options'], 'nosniff');
    assert.equal(readFileSync(join(tmpDir, 'marke', bytes === jpeg ? 'banner.jpg' : 'banner.png')).equals(bytes), true);
  }
  assert.equal(existsSync(join(tmpDir, 'marke', 'fremd.png')), false);
  assert.equal((await jput(JSON.parse('{"__proto__":{"titel":"","untertitel":""}}'))).status, 400);
  for (const bad of [Buffer.from('<svg/>'), Buffer.from('GIF89a'), Buffer.from('text.png'), png().subarray(0, -3), jpeg.subarray(0, -2), png(5000, 5000)]) {
    assert.equal((await put(bad)).status, 400);
  }
  assert.equal((await put(Buffer.alloc(3145729))).status, 413);
  for (const body of [{ fr: { titel: '', untertitel: '' } }, { de: { titel: 'x'.repeat(81), untertitel: '' } }, { de: { titel: '', untertitel: 'x'.repeat(201) } }, { de: { titel: 1, untertitel: '' } }]) assert.equal((await jput(body)).status, 400);
  // B2 N1: Leerraum wird als leer gespeichert; NFC kann Code-Punkte vermehren.
  assert.equal((await jput({ de: { titel: '  \t ', untertitel: ' \n ' } })).status, 200);
  const leer = JSON.parse(db.prepare("SELECT wert FROM marke WHERE schluessel='hero'").get().wert);
  assert.deepEqual(leer.de, { titel: '', untertitel: '' });
  for (const [feld, grenze] of [['titel', 80], ['untertitel', 200]]) {
    const body = text => ({ de: { titel: '', untertitel: '', [feld]: text } });
    assert.equal((await jput(body('\u0958'.repeat(grenze / 2)))).status, 200);
    const gespeichert = JSON.parse(db.prepare("SELECT wert FROM marke WHERE schluessel='hero'").get().wert).de[feld];
    assert.equal(gespeichert, '\u0958'.repeat(grenze / 2).normalize('NFC'));
    assert.equal([...gespeichert].length, grenze);
    assert.equal((await jput(body('\u0958'.repeat(grenze / 2 + 1)))).status, 400);
  }
  const hero = { de: { titel: 'D\u0000\u202e\u061c\u2060\u2061\u2062\u2063\u2064E', untertitel: '' }, en: { titel: 'English', untertitel: 'Sub' }, hu: { titel: 'Magyar', untertitel: '' } };
  assert.equal((await jput(hero)).status, 200);
  for (const lang of ['de', 'en', 'hu']) {
    const t = JSON.parse((await holen(port, '/api/texte?lang=' + lang)).text);
    assert.equal(t._banner, lastUrl); assert.equal(t._hero.titel, lang === 'de' ? 'DE' : hero[lang].titel);
    assert.equal(typeof t.k_oldal_cim, 'string');
  }
  const admin = JSON.parse((await holen(port, '/api/admin/marke', { headers: { Cookie: ck } })).text);
  assert.equal(admin.banner.ext, 'png'); assert.equal(admin.hero.de.titel, 'DE');
  const key = randomBytes(32), folder = join(tmpDir, 'backup');
  const { sicherungDienst } = await import('../sicherung.mjs');
  writeFileSync(join(tmpDir, 'marke', 'logo.png'), minPng());
  const backup = await sicherungDienst({ ordner: folder, schluessel: key }).lauf('manuell'); assert.equal(backup.ok, true);
  const out = join(tmpDir, 'restored', 'app.db'); mkdirSync(join(tmpDir, 'restored'));
  assert.match(restore(join(folder, backup.dateiname), out, key), /Banner wiederhergestellt/);
  assert.deepEqual(readFileSync(join(tmpDir, 'restored', 'marke', 'banner.png')), png());
  assert.deepEqual(readFileSync(join(tmpDir, 'restored', 'marke', 'logo.png')), minPng());
  // Fehlende Datei, ungültige Endung und kaputtes JSON bleiben nachsichtige Sicherungsfälle.
  const savedMeta = db.prepare("SELECT wert FROM marke WHERE schluessel='banner'").get().wert;
  unlinkSync(join(tmpDir, 'marke', 'banner.png'));
  for (const wert of [savedMeta, '{"ext":"gif"}', '{']) {
    db.prepare("UPDATE marke SET wert=? WHERE schluessel='banner'").run(wert);
    const b = await sicherungDienst({ ordner: join(tmpDir, 'missing-' + randomBytes(4).toString('hex')), schluessel: key }).lauf('manuell');
    assert.equal(b.ok, true);
  }
  db.prepare("UPDATE marke SET wert=? WHERE schluessel='banner'").run(savedMeta);
  writeFileSync(join(tmpDir, 'marke', 'banner.png'), png());
  // Kaputter Banner und EEXIST dürfen jeweils das gültige Logo nicht verhindern.
  const { DatabaseSync: RestoreDb } = await import('node:sqlite');
  for (const mode of ['kaputt', 'existiert', 'gueltig']) {
    const transport = join(tmpDir, mode + '.db');
    const transportDb = new RestoreDb(transport);
    transportDb.exec('CREATE TABLE sicherung_logo(name TEXT PRIMARY KEY, inhalt BLOB NOT NULL, ext TEXT)');
    transportDb.prepare('INSERT INTO sicherung_logo VALUES(?,?,?)').run('banner', mode === 'kaputt' ? Buffer.from('kaputt') : png(), 'png');
    transportDb.prepare('INSERT INTO sicherung_logo VALUES(?,?,?)').run('logo.png', minPng(), null); transportDb.close();
    const encrypted = transport + '.enc'; writeFileSync(encrypted, verschluesseln(readFileSync(transport), key));
    const dir = join(tmpDir, mode), logoZiel = join(dir, 'eigenes-logo.png'); mkdirSync(dir);
    if (mode === 'existiert') writeFileSync(join(dir, 'banner.png'), 'vorhanden');
    assert.match(restore(encrypted, join(tmpDir, mode + '-restored.db'), key, ['--logo-ausgabe=' + logoZiel]), /Logo wiederhergestellt/);
    assert.deepEqual(readFileSync(logoZiel), minPng());
    if (mode === 'existiert') assert.equal(readFileSync(join(dir, 'banner.png'), 'utf8'), 'vorhanden');
    if (mode === 'gueltig') assert.deepEqual(readFileSync(join(dir, 'banner.png')), png());
  }
  // Frische App auf wiederhergestellter DB in eigenem Prozess; keine Modul-/DB-Caches teilen.
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const {erstelleServer}=await import('./app.mjs');
    const app=erstelleServer({stripe:{},base:'http://localhost',nodeEnv:'test',dbDatei:process.env.DB_DATEI});
    const s=app.listen(0,'127.0.0.1'); await new Promise(r=>s.once('listening',r));
    try { const r=await fetch('http://127.0.0.1:'+s.address().port+'/marke/banner');
      if(r.status!==200||Buffer.from(await r.arrayBuffer()).toString('base64')!==process.env.BANNER_TEST)throw Error('Restore-Bytes');
    } finally {s.closeAllConnections();await new Promise(r=>s.close(r));}
  `], { env: { ...process.env, DB_DATEI: out, BANNER_TEST: png().toString('base64') }, encoding: 'utf8', timeout: 30000 });
  assert.ifError(probe.error); assert.equal(probe.status, 0, probe.stderr);
  for (const path of ['banner', 'hero']) {
    assert.equal((await holen(port, '/api/admin/marke/' + path, { method: 'DELETE' })).status, 401);
    assert.equal((await holen(port, '/api/admin/marke/' + path, { method: 'DELETE', headers: { Cookie: ck } })).status, 200);
  }
  assert.equal((await holen(port, '/marke/banner')).status, 404);
  const t = JSON.parse((await holen(port, '/api/texte')).text); assert.equal(t._banner, null); assert.equal(t._hero, null);
  // Historisches Format ohne Transporttabelle.
  const oldDb = join(tmpDir, 'old.db'); db.exec("VACUUM INTO '" + oldDb.replaceAll("'", "''") + "'");
  const oldEnc = join(tmpDir, 'old.enc'); writeFileSync(oldEnc, verschluesseln(readFileSync(oldDb), key));
  assert.match(restore(oldEnc, join(tmpDir, 'old-restored.db'), key), /Entschlüsselung erfolgreich/);
  const { DatabaseSync } = await import('node:sqlite');
  const legacy = new DatabaseSync(oldDb);
  legacy.exec('CREATE TABLE sicherung_logo(name TEXT PRIMARY KEY, inhalt BLOB NOT NULL)'); legacy.close();
  writeFileSync(oldEnc, verschluesseln(readFileSync(oldDb), key));
  assert.match(restore(oldEnc, join(tmpDir, 'legacy-restored.db'), key), /Entschlüsselung erfolgreich/);
  console.log('S1 Banner/Hero/Sicherung: alle Prüfungen bestanden');
} finally {
  for (const s of alleServer) { s.closeAllConnections(); await new Promise(r => s.close(r)); }
  db.close(); rmSync(tmpDir, { recursive: true, force: true });
}
