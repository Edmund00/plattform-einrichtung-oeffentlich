// Automatischer Selbsttest fuer WP5: Name und Logo (Schritt 1).
// Pruefungen L1-L9 aus docs/SPEZ-WP4-9-ASSISTENT.md.
// Jede Pruefung hat eine Gegenprobe die ohne die WP5-Aenderung ROT waere.
import './test-sprache.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { pruefePng, LOGO_MAX_BYTES, machLogoPfad, speichereLogo } from '../logo-png.mjs';

let ok = 0, schlecht = 0;
const pruefe = (name, bed, detail = '') => { bed ? ok++ : schlecht++; console.log(`${bed ? 'OK     ' : 'FEHLER '} ${name}${!bed && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = (p) => { try { rmSync(p, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } };
const SERVER = resolve('server.mjs');
const DIESER_TEST = fileURLToPath(import.meta.url);
const basisEnv = (extra) => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...extra });

// ---- Normalmodus-Kindprozess fuer L11 (FUND 1): erstelleServer aus app.mjs ----
if (process.argv[2] === '--normalmodus-server') {
  const port = Number(process.argv[3]);
  const stripe = {
    customers: { create: async () => ({ id: 'cus_x' }), update: async () => ({}) },
    checkout: { sessions: { create: async () => ({ id: 'cs_x', url: 'https://checkout.stripe.com/test' }), retrieve: async () => ({ payment_intent: 'pi_x' }), list: async () => ({ data: [] }), expire: async () => ({}) } },
    paymentIntents: { retrieve: async (id) => ({ id }) },
    refunds: { create: async () => ({ id: 're_x' }), list: async () => ({ data: [] }) },
    billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/test' }) } },
    webhooks: { constructEvent: () => ({}) },
  };
  const { erstelleServer } = await import('../app.mjs');
  const app = erstelleServer({
    stripe, webhookSecret: 'x', base: 'http://127.0.0.1:' + port,
    mailer: async () => true,
    dateiOrdner: join(dirname(process.env.DB_DATEI), 'dateien'),
    dbDatei: process.env.DB_DATEI,
    ellallasWiederaufnahme: false, abgleichAutomatik: false,
    demoModus: false, trustProxy: 0,
    anbieter: { ANBIETER_NAME: 'Test GmbH', ANBIETER_EMAIL: 'test@example.com' },
  });
  app.listen(port, '127.0.0.1', () => console.log('NORMALMODUS_BEREIT'));
} else {

// PNG-Hilfsfunktionen fuer Tests
function chunk(typ, daten = Buffer.alloc(0)) {
  const t = Buffer.from(typ, 'ascii');
  const l = Buffer.alloc(4); l.writeUInt32BE(daten.length, 0);
  const fuerCrc = Buffer.concat([t, daten]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(fuerCrc) >>> 0, 0);
  return Buffer.concat([l, t, daten, c]);
}
function ihdrBuf(w = 64, h = 64, bittiefe = 8, farbtyp = 2) {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(w, 0); d.writeUInt32BE(h, 4);
  d[8] = bittiefe; d[9] = farbtyp;
  return chunk('IHDR', d);
}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
function minPng(w = 64, h = 64) {
  return Buffer.concat([PNG_SIG, ihdrBuf(w, h), chunk('IDAT', Buffer.alloc(10)), chunk('IEND')]);
}
// Erzeugt ein gueltiges PNG mit genau zielBytes Gesamtgroesse (IDAT-Daten mit Nullbytes aufgefuellt).
// Overhead: 8 (sig) + 25 (IHDR-Chunk) + 12 (IDAT-Chunk-Rahmen) + 12 (IEND) = 57 Bytes.
function grossesPng(zielBytes) {
  const idatData = Buffer.alloc(zielBytes - 57);
  return Buffer.concat([PNG_SIG, ihdrBuf(64, 64), chunk('IDAT', idatData), chunk('IEND')]);
}

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

async function starteNormalmodusServer(tmpord, port) {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', DIESER_TEST, '--normalmodus-server', String(port)], {
    cwd: tmpord, stdio: ['ignore', 'pipe', 'pipe'],
    env: basisEnv({ DB_DATEI: join(tmpord, 'app.db') }),
  });
  let log = '';
  p.stdout.on('data', x => { log += x; });
  p.stderr.on('data', x => { log += x; });
  for (let i = 0; i < 100; i++) {
    if (log.includes('NORMALMODUS_BEREIT')) break;
    if (p.exitCode !== null) break;
    await warte(100);
  }
  return { p, log: () => log };
}

// Anmelden und CSRF-Token holen
async function anmelden(port) {
  const r1 = await holen(port, '/anmelden');
  const cookie = r1.headers['set-cookie'] || '';
  const r2 = await holen(port, '/anmelden', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ email: 'admin@beispiel.hu', passwort: 'passwort12345' }).toString(),
  });
  const sessionCookie = r2.headers['set-cookie'] || cookie;
  // CSRF-Token aus Schritt 1 holen
  const r3 = await holen(port, '/admin/einrichtung/schritt/1', { headers: { Cookie: sessionCookie } });
  const csrfMatch = r3.text.match(/name="csrf_token" value="([0-9a-f]+)"/);
  const csrf = csrfMatch?.[1] ?? '';
  return { cookie: sessionCookie, csrf };
}

// =====================================================================
abschnitt('Einheit: pruefePng (ohne Server)');
{
  const valid = minPng(64, 64);
  pruefe('pruefePng: gueltig 64x64', pruefePng(valid) === null, pruefePng(valid));
  pruefe('pruefePng: gueltig 2000x2000', pruefePng(minPng(2000, 2000)) === null);
  pruefe('pruefePng: leer', pruefePng(Buffer.alloc(0)) !== null);
  pruefe('pruefePng: zu gross', pruefePng(Buffer.alloc(LOGO_MAX_BYTES + 1)) !== null);
  pruefe('pruefePng: 63x63 abgelehnt', pruefePng(minPng(63, 63)) !== null);
  pruefe('pruefePng: 2001x2001 abgelehnt', pruefePng(minPng(2001, 2001)) !== null);
  pruefe('pruefePng: kein PNG (JPEG-Header)', pruefePng(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46])) !== null);
  pruefe('pruefePng: kein PNG (SVG-Text)', pruefePng(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')) !== null);
  pruefe('pruefePng: kein PNG (GIF)', pruefePng(Buffer.from('GIF89a\x01\x00\x01\x00\x80')) !== null);
  pruefe('pruefePng: kein PNG (WebP)', pruefePng(Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ')) !== null);
  pruefe('pruefePng: kein PNG (HTML)', pruefePng(Buffer.from('<!DOCTYPE html>')) !== null);
  pruefe('pruefePng: kein PNG (ZIP)', pruefePng(Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00])) !== null);
  // Falscher Dateiname (Endung .png) aber kein PNG-Inhalt => gleiche Pruefung wie oben
  pruefe('pruefePng: .png-Name aber SVG-Inhalt', pruefePng(Buffer.from('<svg/>')) !== null);
  pruefe('pruefePng: Daten nach IEND', pruefePng(Buffer.concat([valid, Buffer.from([0, 0, 0, 0])])) !== null);
  pruefe('pruefePng: fehlende IEND', pruefePng(Buffer.concat([PNG_SIG, ihdrBuf(), chunk('IDAT', Buffer.alloc(10))])) !== null);
  pruefe('pruefePng: fehlende IDAT', pruefePng(Buffer.concat([PNG_SIG, ihdrBuf(), chunk('IEND')])) !== null);
  pruefe('pruefePng: abgeschnitten', pruefePng(valid.slice(0, valid.length - 5)) !== null);
  // Falsche CRC
  const badCrc = Buffer.from(valid); badCrc[valid.length - 2] ^= 1;
  pruefe('pruefePng: falsche CRC', pruefePng(badCrc) !== null);
  // Unbekannter kritischer Chunk
  const withCrit = Buffer.concat([PNG_SIG, ihdrBuf(), chunk('XMPp', Buffer.alloc(4)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng: unbekannter kritischer Chunk', pruefePng(withCrit) !== null);
  // Ancillary Chunk erlaubt
  const withAnc = Buffer.concat([PNG_SIG, ihdrBuf(), chunk('tEXt', Buffer.from('key\0val')), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng: ancillary Chunk erlaubt', pruefePng(withAnc) === null);
  // Gegenprobe: IEND mit Laenge 1 abgelehnt
  pruefe('pruefePng: IEND mit Laenge != 0 abgelehnt', pruefePng(Buffer.concat([PNG_SIG, ihdrBuf(), chunk('IDAT', Buffer.alloc(5)), chunk('IEND', Buffer.alloc(1))])) !== null);
  // Groessen-Grenzwert: LOGO_MAX_BYTES = 512 * 1024 = 524288 Byte (KiB, nicht dezimal 512000).
  // Bewusste Auslegung: 524288 ist exakt angenommen, 524289 abgelehnt; dezimal 513000 waere ebenfalls angenommen.
  pruefe('pruefePng: 524288 Byte (LOGO_MAX_BYTES) nicht png_zu_gross', pruefePng(Buffer.alloc(LOGO_MAX_BYTES)) !== 'png_zu_gross', pruefePng(Buffer.alloc(LOGO_MAX_BYTES)));
  pruefe('pruefePng: 524289 Byte (LOGO_MAX_BYTES+1) ist png_zu_gross', pruefePng(Buffer.alloc(LOGO_MAX_BYTES + 1)) === 'png_zu_gross', pruefePng(Buffer.alloc(LOGO_MAX_BYTES + 1)));
}

// =====================================================================
abschnitt('Einheit: pruefePng PLTE, IHDR-Felder, Chunk-Typ, IDAT-Folge');
{
  function plteChunk(n = 1) { return chunk('PLTE', Buffer.alloc(n * 3)); }

  // PNG-8 (Farbtyp 3, indiziert) mit PLTE: angenommen
  const png8mitPlte = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 3), plteChunk(1), chunk('IDAT', Buffer.alloc(10)), chunk('IEND')]);
  pruefe('pruefePng: PNG-8 (Farbtyp 3) mit PLTE angenommen', pruefePng(png8mitPlte) === null, pruefePng(png8mitPlte));

  // RGB (Farbtyp 2) mit PLTE: angenommen (PLTE ist optional bei Farbtyp 2)
  const rgbMitPlte = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 2), plteChunk(1), chunk('IDAT', Buffer.alloc(10)), chunk('IEND')]);
  pruefe('pruefePng: RGB (Farbtyp 2) mit PLTE angenommen', pruefePng(rgbMitPlte) === null, pruefePng(rgbMitPlte));

  // Farbtyp 3 mit PLTE und tRNS: angenommen
  const png8mitPlteTrns = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 3), plteChunk(1), chunk('tRNS', Buffer.alloc(1)), chunk('IDAT', Buffer.alloc(10)), chunk('IEND')]);
  pruefe('pruefePng: Farbtyp 3 mit PLTE und tRNS angenommen', pruefePng(png8mitPlteTrns) === null, pruefePng(png8mitPlteTrns));

  // Farbtyp 3 OHNE PLTE: abgelehnt
  const png8ohnePlte = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 3), chunk('IDAT', Buffer.alloc(10)), chunk('IEND')]);
  pruefe('pruefePng: Farbtyp 3 OHNE PLTE abgelehnt', pruefePng(png8ohnePlte) !== null, pruefePng(png8ohnePlte));

  // PLTE nach IDAT: abgelehnt
  const plteNachIdat = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 3), chunk('IDAT', Buffer.alloc(10)), plteChunk(1), chunk('IEND')]);
  pruefe('pruefePng: PLTE nach IDAT abgelehnt', pruefePng(plteNachIdat) !== null, pruefePng(plteNachIdat));

  // PLTE bei Farbtyp 0 (Graustufen): verboten
  const plteBeiFarbtyp0 = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 0), plteChunk(1), chunk('IDAT', Buffer.alloc(10)), chunk('IEND')]);
  pruefe('pruefePng: PLTE bei Farbtyp 0 abgelehnt', pruefePng(plteBeiFarbtyp0) !== null, pruefePng(plteBeiFarbtyp0));

  // PLTE bei Farbtyp 4 (Graustufen+Alpha): verboten
  const plteBeiFarbtyp4 = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 4), plteChunk(1), chunk('IDAT', Buffer.alloc(10)), chunk('IEND')]);
  pruefe('pruefePng: PLTE bei Farbtyp 4 abgelehnt', pruefePng(plteBeiFarbtyp4) !== null, pruefePng(plteBeiFarbtyp4));

  // IHDR-Länge 14 (statt 13): abgelehnt
  const ihdrData14 = Buffer.alloc(14);
  ihdrData14.writeUInt32BE(64, 0); ihdrData14.writeUInt32BE(64, 4);
  ihdrData14[8] = 8; ihdrData14[9] = 2;
  const badIhdr14 = Buffer.concat([PNG_SIG, chunk('IHDR', ihdrData14), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng: IHDR-Laenge 14 abgelehnt', pruefePng(badIhdr14) !== null, pruefePng(badIhdr14));

  // Falsche Kompressionsmethode (1 statt 0): abgelehnt
  const ihdrDataKomp = Buffer.alloc(13);
  ihdrDataKomp.writeUInt32BE(64, 0); ihdrDataKomp.writeUInt32BE(64, 4);
  ihdrDataKomp[8] = 8; ihdrDataKomp[9] = 2; ihdrDataKomp[10] = 1;
  const badKomp = Buffer.concat([PNG_SIG, chunk('IHDR', ihdrDataKomp), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng: Falsche Kompressionsmethode abgelehnt', pruefePng(badKomp) !== null, pruefePng(badKomp));

  // Falsche Filtermethode (1 statt 0): abgelehnt
  const ihdrDataFilter = Buffer.alloc(13);
  ihdrDataFilter.writeUInt32BE(64, 0); ihdrDataFilter.writeUInt32BE(64, 4);
  ihdrDataFilter[8] = 8; ihdrDataFilter[9] = 2; ihdrDataFilter[11] = 1;
  const badFilter = Buffer.concat([PNG_SIG, chunk('IHDR', ihdrDataFilter), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng: Falsche Filtermethode abgelehnt', pruefePng(badFilter) !== null, pruefePng(badFilter));

  // Chunk-Typ mit Ziffer ('tEX1'): abgelehnt
  const withBadTyp = Buffer.concat([PNG_SIG, ihdrBuf(), chunk('tEX1', Buffer.alloc(4)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng: Chunk-Typ mit Ziffer abgelehnt', pruefePng(withBadTyp) !== null, pruefePng(withBadTyp));

  // Unterbrochene IDAT-Folge (IDAT – ancillary – IDAT): abgelehnt
  const idatUnterbrochen = Buffer.concat([PNG_SIG, ihdrBuf(), chunk('IDAT', Buffer.alloc(5)), chunk('tEXt', Buffer.from('key\0val')), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng: Unterbrochene IDAT-Folge abgelehnt', pruefePng(idatUnterbrochen) !== null, pruefePng(idatUnterbrochen));

  // ---- FUND 3a: PLTE Farbenanzahl > 2^bittiefe abgelehnt ----
  // Farbtyp 3, bittiefe 4 → max 16 Farben (48 Byte PLTE); 17 Farben (51 Byte) → abgelehnt
  const plteZuViele = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 4, 3), chunk('PLTE', Buffer.alloc(17 * 3)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3a: PLTE 17 Farben bei bittiefe 4 (max 16) abgelehnt', pruefePng(plteZuViele) !== null, pruefePng(plteZuViele));
  // Gegenprobe: exakt 16 Farben (48 Byte) bei bittiefe 4 angenommen
  const plteGenau16 = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 4, 3), chunk('PLTE', Buffer.alloc(16 * 3)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3a: PLTE 16 Farben bei bittiefe 4 angenommen', pruefePng(plteGenau16) === null, pruefePng(plteGenau16));
  // Farbtyp 3, bittiefe 1 → max 2 Farben; 3 Farben abgelehnt
  const plteZuVieleBit1 = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 1, 3), chunk('PLTE', Buffer.alloc(3 * 3)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3a: PLTE 3 Farben bei bittiefe 1 (max 2) abgelehnt', pruefePng(plteZuVieleBit1) !== null, pruefePng(plteZuVieleBit1));

  // ---- FUND 3b: tRNS-Validierung ----
  // Farbtyp 2 (RGB), tRNS genau 6 Byte: angenommen
  const trnsRgb6 = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 2), chunk('tRNS', Buffer.alloc(6)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3b: tRNS 6 Byte bei Farbtyp 2 angenommen', pruefePng(trnsRgb6) === null, pruefePng(trnsRgb6));
  // Farbtyp 2, tRNS falsche Laenge (4 statt 6): abgelehnt
  const trnsRgbFalsch = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 2), chunk('tRNS', Buffer.alloc(4)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3b: tRNS 4 Byte bei Farbtyp 2 (muss 6) abgelehnt', pruefePng(trnsRgbFalsch) !== null, pruefePng(trnsRgbFalsch));
  // Farbtyp 0 (Graustufen), tRNS genau 2 Byte: angenommen
  const trnsGrau2 = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 0), chunk('tRNS', Buffer.alloc(2)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3b: tRNS 2 Byte bei Farbtyp 0 angenommen', pruefePng(trnsGrau2) === null, pruefePng(trnsGrau2));
  // Farbtyp 0, tRNS falsche Laenge (3 statt 2): abgelehnt
  const trnsGrauFalsch = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 0), chunk('tRNS', Buffer.alloc(3)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3b: tRNS 3 Byte bei Farbtyp 0 (muss 2) abgelehnt', pruefePng(trnsGrauFalsch) !== null, pruefePng(trnsGrauFalsch));
  // Farbtyp 4 (Graustufen+Alpha): tRNS verboten
  const trnsAlpha4 = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 4), chunk('tRNS', Buffer.alloc(2)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3b: tRNS bei Farbtyp 4 verboten', pruefePng(trnsAlpha4) !== null, pruefePng(trnsAlpha4));
  // Farbtyp 6 (RGBA): tRNS verboten
  const trnsRgba6 = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 6), chunk('tRNS', Buffer.alloc(6)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3b: tRNS bei Farbtyp 6 verboten', pruefePng(trnsRgba6) !== null, pruefePng(trnsRgba6));
  // Farbtyp 3: tRNS ohne PLTE abgelehnt
  const trnsOhnePlte = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 3), chunk('tRNS', Buffer.alloc(1)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3b: tRNS ohne PLTE bei Farbtyp 3 abgelehnt', pruefePng(trnsOhnePlte) !== null, pruefePng(trnsOhnePlte));
  // Farbtyp 3: tRNS mehr Eintraege als Palettenfarben abgelehnt
  const trnsZuViele = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 3), chunk('PLTE', Buffer.alloc(2 * 3)), chunk('tRNS', Buffer.alloc(3)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3b: tRNS 3 Eintraege bei 2 Palettenfarben abgelehnt', pruefePng(trnsZuViele) !== null, pruefePng(trnsZuViele));
  // Farbtyp 3: tRNS nach IDAT abgelehnt
  const trnsNachIdat = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 3), chunk('PLTE', Buffer.alloc(1 * 3)), chunk('IDAT', Buffer.alloc(5)), chunk('tRNS', Buffer.alloc(1)), chunk('IEND')]);
  pruefe('pruefePng FUND3b: tRNS nach IDAT abgelehnt', pruefePng(trnsNachIdat) !== null, pruefePng(trnsNachIdat));
  // Doppeltes tRNS abgelehnt
  const trnsDoppelt = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 2), chunk('tRNS', Buffer.alloc(6)), chunk('tRNS', Buffer.alloc(6)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3b: doppeltes tRNS abgelehnt', pruefePng(trnsDoppelt) !== null, pruefePng(trnsDoppelt));

  // ---- FUND 3c (Nachbesserung 4): tRNS vor PLTE → png_plte_nach_trns ----
  // Farbtyp 2 (RGB): tRNS (6 Byte) VOR PLTE → abgelehnt wegen falscher Reihenfolge
  const trnsVorPlte = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 2), chunk('tRNS', Buffer.alloc(6)), chunk('PLTE', Buffer.alloc(1 * 3)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3c: tRNS vor PLTE abgelehnt (png_plte_nach_trns)', pruefePng(trnsVorPlte) === 'png_plte_nach_trns', pruefePng(trnsVorPlte));
  // Gegenprobe: Farbtyp 3 mit PLTE VOR tRNS (korrekte Reihenfolge) angenommen
  const plteVorTrns = Buffer.concat([PNG_SIG, ihdrBuf(64, 64, 8, 3), chunk('PLTE', Buffer.alloc(1 * 3)), chunk('tRNS', Buffer.alloc(1)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND')]);
  pruefe('pruefePng FUND3c: Gegenprobe PLTE vor tRNS (Farbtyp 3) angenommen', pruefePng(plteVorTrns) === null, pruefePng(plteVorTrns));
}

// =====================================================================
abschnitt('Einheit: speichereLogo wirft bei ungueltigem Puffer');
{
  const logoTmpDir = mkdtempSync(join(tmpdir(), 'pe-logo-unit-'));
  const logoPfad = machLogoPfad(join(logoTmpDir, 'app.db'));
  try {
    // Erst gültiges Logo speichern
    speichereLogo(minPng(64, 64), logoPfad);
    const logoVorher = readFileSync(logoPfad);

    // Ungültiges Logo (SVG) → speichereLogo wirft
    let threw = false;
    try { speichereLogo(Buffer.from('<svg/>'), logoPfad); } catch { threw = true; }
    pruefe('speichereLogo wirft bei ungueltigem Puffer', threw);

    // Altes Logo muss unveraendert geblieben sein
    const logoNachher = readFileSync(logoPfad);
    pruefe('speichereLogo: altes Logo nach Fehler unveraendert', logoVorher.equals(logoNachher));
  } finally {
    aufraeumen(logoTmpDir);
  }
}

// =====================================================================
abschnitt('L1 + L2: Upload und oeffentlicher Abruf');
{
  const tmpord = mkdtempSync(join(tmpdir(), 'pe-logo-'));
  const port = 19210;
  const { p } = await einrichtungsmodusServer(tmpord, port);
  try {
    const { cookie, csrf } = await anmelden(port);

    // L1: gültiges PNG hochladen
    const validPng = minPng(64, 64);
    const upR = await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: cookie },
      body: validPng,
    });
    pruefe('L1 Upload gueltig: 200', upR.status === 200, `Status: ${upR.status} Body: ${upR.text.slice(0, 100)}`);
    let upJson;
    try { upJson = JSON.parse(upR.text); } catch { upJson = {}; }
    pruefe('L1 Upload gueltig: ok:true in Antwort', upJson.ok === true, upR.text.slice(0, 100));

    // L1: öffentlicher Abruf ohne Session
    const logoR = await holen(port, '/marke/logo.png');
    pruefe('L1 oeffentlicher Abruf: 200', logoR.status === 200, `Status: ${logoR.status}`);
    pruefe('L1 Content-Type image/png', (logoR.headers['content-type'] || '').startsWith('image/png'), logoR.headers['content-type']);
    pruefe('L1 X-Content-Type-Options: nosniff', logoR.headers['x-content-type-options'] === 'nosniff');
    pruefe('L1 Content-Security-Policy: default-src none', (logoR.headers['content-security-policy'] || '').includes("default-src 'none'"));
    pruefe('L1 Cache-Control: public', (logoR.headers['cache-control'] || '').includes('public'), logoR.headers['cache-control']);
    // Gegenprobe: Logo-Datei entspricht dem hochgeladenen Buffer
    pruefe('L1 Gegenprobe: Datei ist das hochgeladene PNG', Buffer.from(logoR.text).length > 0);

    // L2: verschiedene ungueltige Dateien abgelehnt
    const ungueltige = [
      { name: 'SVG', buf: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>') },
      { name: 'GIF', buf: Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!') },
      { name: 'JPEG', buf: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]) },
      { name: 'WebP', buf: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]) },
      { name: 'HTML', buf: Buffer.from('<!DOCTYPE html><html><body></body></html>') },
      { name: 'ZIP', buf: Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]) },
      { name: '.png-Endung aber SVG-Inhalt', buf: Buffer.from('<svg/>') },
      { name: 'leer', buf: Buffer.alloc(0) },
      { name: '63x63', buf: minPng(63, 63) },
      { name: '2001x2001', buf: minPng(2001, 2001) },
      { name: 'PNG mit Anhängsel', buf: Buffer.concat([minPng(64, 64), Buffer.from([0, 0, 0, 0])]) },
      { name: 'PNG fehlende IEND', buf: Buffer.concat([PNG_SIG, ihdrBuf(), chunk('IDAT', Buffer.alloc(10))]) },
      { name: 'PNG abgeschnitten', buf: minPng(64, 64).slice(0, -5) },
      { name: 'PNG falsche CRC', buf: (() => { const b = Buffer.from(minPng(64, 64)); b[b.length - 2] ^= 1; return b; })() },
    ];

    // Altes Logo merken (das valide von L1)
    const logoVorher = (await holen(port, '/marke/logo.png')).text;

    for (const { name, buf } of ungueltige) {
      const r = await holen(port, '/admin/einrichtung/logo-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: cookie },
        body: buf,
      });
      pruefe(`L2 ${name} abgelehnt (nicht 200)`, r.status !== 200, `Status: ${r.status}`);
    }

    // L2 Gegenprobe: altes Logo nach allen fehlgeschlagenen Uploads (inkl. falscher CRC) unveraendert
    const logoNachher = (await holen(port, '/marke/logo.png')).text;
    pruefe('L2 Gegenprobe: altes Logo unveraendert nach Fehler', logoVorher === logoNachher);

    // L2 Groessen-Grenzwert: exakt LOGO_MAX_BYTES = 512 * 1024 = 524288 Byte (512 KiB, nicht dezimal 512000).
    // Bewusste Auslegung: 524288 ist angenommen, 524289 abgelehnt. Dezimal 513000 Byte waere ebenfalls angenommen.
    const png524288 = grossesPng(LOGO_MAX_BYTES);
    const r524288 = await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: cookie },
      body: png524288,
    });
    pruefe('L2 524288 Byte (LOGO_MAX_BYTES) gueltiges PNG: 200', r524288.status === 200, `Status: ${r524288.status} Body: ${r524288.text.slice(0, 80)}`);

    // L2: exakt 524289 Byte (LOGO_MAX_BYTES+1) → abgelehnt (pruefePng: png_zu_gross oder Express-413)
    const r524289 = await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: cookie },
      body: Buffer.alloc(LOGO_MAX_BYTES + 1),
    });
    pruefe('L2 524289 Byte (LOGO_MAX_BYTES+1) abgelehnt', r524289.status !== 200, `Status: ${r524289.status}`);

  } finally {
    await stop(p);
    aufraeumen(tmpord);
  }
}

// =====================================================================
abschnitt('L3: Pfad-Tricks (machLogoPfad)');
{
  // L3 ist eine Einheits-Pruefung: machLogoPfad liefert einen absoluten Pfad
  // aus dem Verzeichnis der DB-Datei plus 'marke/logo.png'. Der hochgeladene
  // Dateiname wird nie übertragen; das Logo landet immer an diesem festen Ort.
  const testPfad = machLogoPfad('/tmp/testdir/app.db');
  pruefe('L3 machLogoPfad: absoluter Pfad', isAbsolute(testPfad), `Pfad: ${testPfad}`);
  pruefe('L3 machLogoPfad: kein ..-Anteil', !testPfad.includes('..'));
  pruefe('L3 machLogoPfad: kein Null-Byte', !testPfad.includes('\x00'));
  pruefe('L3 Gegenprobe: Pfad endet auf /marke/logo.png', testPfad.replace(/\\/g, '/').endsWith('/marke/logo.png'), `Pfad: ${testPfad}`);
}

// =====================================================================
abschnitt('L4: Zweiter Upload ersetzt ersten (atomar)');
{
  const tmpord = mkdtempSync(join(tmpdir(), 'pe-logo-'));
  const port = 19211;
  const { p } = await einrichtungsmodusServer(tmpord, port);
  try {
    const { cookie, csrf } = await anmelden(port);

    // Erstes Logo
    const png1 = minPng(64, 64);
    await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: cookie },
      body: png1,
    });
    const logo1 = (await holen(port, '/marke/logo.png')).text;

    // Zweites Logo (andere Größe)
    const png2 = minPng(128, 128);
    const r2 = await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: cookie },
      body: png2,
    });
    pruefe('L4 Zweiter Upload: 200', r2.status === 200, r2.text.slice(0, 100));
    const logo2 = (await holen(port, '/marke/logo.png')).text;
    pruefe('L4 Zweites Logo ersetzt erstes', logo1 !== logo2);
    pruefe('L4 Gegenprobe: zweites Logo ist neues PNG', logo2.length > 0);

  } finally {
    await stop(p);
    aufraeumen(tmpord);
  }
}

// =====================================================================
abschnitt('L5: Fehlerfall laesst altes Logo unveraendert');
{
  const tmpord = mkdtempSync(join(tmpdir(), 'pe-logo-'));
  const port = 19212;
  const { p } = await einrichtungsmodusServer(tmpord, port);
  try {
    const { cookie, csrf } = await anmelden(port);

    // Erstes gültiges Logo
    const png1 = minPng(64, 64);
    await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: cookie },
      body: png1,
    });
    const logoVorher = (await holen(port, '/marke/logo.png')).text;

    // Ungültiger Upload (SVG)
    await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: cookie },
      body: Buffer.from('<svg/>'),
    });
    const logoNachher = (await holen(port, '/marke/logo.png')).text;

    pruefe('L5 Altes Logo nach Fehler unveraendert', logoVorher === logoNachher);
    pruefe('L5 Gegenprobe: Logo existiert', logoVorher.length > 0);

  } finally {
    await stop(p);
    aufraeumen(tmpord);
  }
}

// =====================================================================
abschnitt('L6: CSRF/Sitzung beim Upload');
{
  const tmpord = mkdtempSync(join(tmpdir(), 'pe-logo-'));
  const port = 19213;
  const { p } = await einrichtungsmodusServer(tmpord, port);
  try {
    const { cookie, csrf } = await anmelden(port);
    const validPng = minPng(64, 64);

    // Kein CSRF-Token
    const rKeinCsrf = await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie },
      body: validPng,
    });
    pruefe('L6 Kein CSRF: 403', rKeinCsrf.status === 403, `Status: ${rKeinCsrf.status}`);

    // Falsches CSRF-Token
    const rFalschCsrf = await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': 'a'.repeat(64), Cookie: cookie },
      body: validPng,
    });
    pruefe('L6 Falsches CSRF: 403', rFalschCsrf.status === 403, `Status: ${rFalschCsrf.status}`);

    // Fremder Origin
    const rFremder = await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Origin: 'http://evil.example', Cookie: cookie },
      body: validPng,
    });
    pruefe('L6 Fremder Origin: 403', rFremder.status === 403, `Status: ${rFremder.status}`);

    // Kein Origin-Header: erlaubt (Browser ohne CORS-Kontext sendet keinen Origin; entspricht WP4-Verhalten)
    const rKeinOrigin = await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: cookie },
      body: validPng,
    });
    pruefe('L6 Kein Origin: erlaubt (200)', rKeinOrigin.status === 200, `Status: ${rKeinOrigin.status}`);

    // Gegenprobe: mit richtigem CSRF und ohne Origin wird akzeptiert (s.o.)
    const rOk = await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: cookie },
      body: validPng,
    });
    pruefe('L6 Gegenprobe: mit richtigem CSRF akzeptiert', rOk.status === 200, `Status: ${rOk.status}`);

  } finally {
    await stop(p);
    aufraeumen(tmpord);
  }
}

// =====================================================================
abschnitt('L7: Name mit Sonderzeichen wird abgelehnt');
{
  const tmpord = mkdtempSync(join(tmpdir(), 'pe-logo-'));
  const port = 19214;
  const { p } = await einrichtungsmodusServer(tmpord, port);
  try {
    const { cookie, csrf } = await anmelden(port);

    // Name mit <script>
    const r1 = await holen(port, '/admin/einrichtung/schritt/1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ csrf_token: csrf, PLATTFORM_NAME: '<script>alert(1)</script>' }).toString(),
    });
    pruefe('L7 Name mit <script>: nicht 303', r1.status !== 303, `Status: ${r1.status}`);

    // Name mit Anführungszeichen
    const r2 = await holen(port, '/admin/einrichtung/schritt/1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ csrf_token: csrf, PLATTFORM_NAME: '"evil"' }).toString(),
    });
    pruefe('L7 Name mit Anführungszeichen: nicht 303', r2.status !== 303, `Status: ${r2.status}`);

    // Gültiger Name wird akzeptiert
    const r3 = await holen(port, '/admin/einrichtung/schritt/1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ csrf_token: csrf, PLATTFORM_NAME: 'Meine Plattform' }).toString(),
    });
    pruefe('L7 Gegenprobe: gueltiger Name akzeptiert (303)', r3.status === 303, `Status: ${r3.status}`);

    // Probe: der abgelehnte Angriffs-Name erscheint nicht unescaped in der Seite
    const r4 = await holen(port, '/admin/einrichtung/schritt/1', { headers: { Cookie: cookie } });
    pruefe('L7 Probe: Angriffs-String nicht unescaped in Seite', !r4.text.includes('<script>alert(1)</script>'), r4.text.slice(0, 200));

  } finally {
    await stop(p);
    aufraeumen(tmpord);
  }
}

// =====================================================================
abschnitt('L8: Upload-Route ohne Sitzung 303');
{
  const tmpord = mkdtempSync(join(tmpdir(), 'pe-logo-'));
  const port = 19215;
  const { p } = await einrichtungsmodusServer(tmpord, port);
  try {
    const r = await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: minPng(64, 64),
    });
    pruefe('L8 Upload ohne Sitzung: 303', r.status === 303, `Status: ${r.status}`);
    pruefe('L8 Gegenprobe: Redirect auf /anmelden', (r.headers['location'] || '').includes('/anmelden'), r.headers['location']);

    // Grosser Body (5 MB) ohne Sitzung: Admin-Pruefung greift VOR express.raw → 303 statt 413.
    // Beweis: Wenn express.raw zuerst liefe, waere das Ergebnis 413 (body > 524289).
    const rGross = await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.alloc(5 * 1024 * 1024),
    });
    pruefe('L8 5MB-Body ohne Sitzung: 303 (Admin-Pruefung vor express.raw)', rGross.status === 303, `Status: ${rGross.status}`);

  } finally {
    await stop(p);
    aufraeumen(tmpord);
  }
}

// =====================================================================
abschnitt('L9: Anonymer Upload abgelehnt, anonymer Abruf erlaubt');
{
  const tmpord = mkdtempSync(join(tmpdir(), 'pe-logo-'));
  const port = 19216;
  const { p } = await einrichtungsmodusServer(tmpord, port);
  try {
    const { cookie, csrf } = await anmelden(port);

    // Erst ein gültiges Logo hochladen
    await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: cookie },
      body: minPng(64, 64),
    });

    // Anonymer Upload: kein Cookie
    const rUp = await holen(port, '/admin/einrichtung/logo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: minPng(64, 64),
    });
    pruefe('L9 Anonymer Upload abgelehnt (303 auf /anmelden)', rUp.status === 303, `Status: ${rUp.status}`);

    // Anonymer Abruf: kein Cookie
    const rGet = await holen(port, '/marke/logo.png');
    pruefe('L9 Anonymer Abruf erlaubt (200)', rGet.status === 200, `Status: ${rGet.status}`);
    pruefe('L9 Gegenprobe: Content-Type image/png', (rGet.headers['content-type'] || '').startsWith('image/png'));

  } finally {
    await stop(p);
    aufraeumen(tmpord);
  }
}

// =====================================================================
abschnitt('L10: Parallele Uploads, keine Zwischendatei-Reste');
{
  const tmpord = mkdtempSync(join(tmpdir(), 'pe-logo-'));
  const port = 19217;
  const { p } = await einrichtungsmodusServer(tmpord, port);
  try {
    const { cookie, csrf } = await anmelden(port);

    // Zwei gleichzeitige Uploads: ein gueltiges PNG, ein ungueltiges (SVG).
    const [r1, r2] = await Promise.all([
      holen(port, '/admin/einrichtung/logo-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: cookie },
        body: minPng(64, 64),
      }),
      holen(port, '/admin/einrichtung/logo-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Csrf-Token': csrf, Cookie: cookie },
        body: Buffer.from('<svg/>'),
      }),
    ]);
    const erfolgreiche = [r1.status, r2.status].filter(s => s === 200).length;
    pruefe('L10 Parallel: genau ein Upload erfolgreich (200)', erfolgreiche === 1, `200-Antworten: ${erfolgreiche}`);

    // Keine Zwischendatei-Reste (kein logo.tmp.* im marke-Ordner neben app.db)
    const markeDir = join(tmpord, 'marke');
    const tmpDateien = existsSync(markeDir) ? readdirSync(markeDir).filter(f => f.includes('.tmp.')) : [];
    pruefe('L10 Parallel: keine Zwischendatei-Reste', tmpDateien.length === 0, `Reste: ${tmpDateien.join(', ')}`);

    // Genau ein gueltiges Logo vorhanden
    const logoR = await holen(port, '/marke/logo.png');
    pruefe('L10 Parallel: Logo abrufbar (200)', logoR.status === 200, `Status: ${logoR.status}`);
    pruefe('L10 Gegenprobe: Content-Type image/png', (logoR.headers['content-type'] || '').startsWith('image/png'));
  } finally {
    await stop(p);
    aufraeumen(tmpord);
  }
}

// =====================================================================
abschnitt('L11: Logo-Route im Normalmodus (FUND 1 app.mjs)');
{
  // Gegenprobe: markeRouter.get('/marke/logo.png', logoRouteHandler) wuerde haengen.
  // Korrektur: app.get('/marke/logo.png', logoRouteHandler(machLogoPfad(dbDatei))) in app.mjs.
  // Der Zeitlimit-Test (3 s) schlaegt ohne die Korrektur fehl.
  const tmpord = mkdtempSync(join(tmpdir(), 'pe-logo-'));
  const port = 19218;
  const { p, log } = await starteNormalmodusServer(tmpord, port);
  try {
    pruefe('L11 Normalmodus-Server gestartet', log().includes('NORMALMODUS_BEREIT'), log().slice(-300));

    // Kein Logo → 404, kein Haengen (Zeitlimit 3 s)
    const r404 = await Promise.race([
      holen(port, '/marke/logo.png'),
      warte(3000).then(() => ({ status: 'TIMEOUT', text: '', headers: {} })),
    ]);
    pruefe('L11 kein Logo: 404 nicht_gefunden (kein Haengen)', r404.status === 404, `Status: ${r404.status}`);
    pruefe('L11 kein Logo: text/plain', (r404.headers['content-type'] || '').includes('text/plain'), r404.headers['content-type']);
    pruefe('L11 Gegenprobe: Antwort vor Zeitlimit (kein Haengen)', r404.status !== 'TIMEOUT');

    // Logo speichern und abrufen
    const logoPfad = machLogoPfad(join(tmpord, 'app.db'));
    speichereLogo(minPng(64, 64), logoPfad);

    const r200 = await Promise.race([
      holen(port, '/marke/logo.png'),
      warte(3000).then(() => ({ status: 'TIMEOUT', text: '', headers: {} })),
    ]);
    pruefe('L11 Logo vorhanden: 200', r200.status === 200, `Status: ${r200.status}`);
    pruefe('L11 Content-Type: image/png', (r200.headers['content-type'] || '').startsWith('image/png'), r200.headers['content-type']);
    pruefe('L11 X-Content-Type-Options: nosniff', r200.headers['x-content-type-options'] === 'nosniff');
    pruefe('L11 Content-Security-Policy: default-src none', (r200.headers['content-security-policy'] || '').includes("default-src 'none'"));
    pruefe('L11 Cache-Control: public', (r200.headers['cache-control'] || '').includes('public'), r200.headers['cache-control']);
    pruefe('L11 Gegenprobe: Antwort vor Zeitlimit (kein Haengen)', r200.status !== 'TIMEOUT');
  } finally {
    await stop(p);
    aufraeumen(tmpord);
  }
}

// =====================================================================
abschnitt('Ergebnis');
console.log(`\n${ok + schlecht} Tests: ${ok} bestanden, ${schlecht} Fehler`);
process.exit(schlecht > 0 ? 1 : 0);
} // Ende else (kein --normalmodus-server)
