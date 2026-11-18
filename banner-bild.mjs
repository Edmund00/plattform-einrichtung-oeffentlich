// S1: Strukturprüfung ohne Dekodierung; PNG-Prüfung aus logo-png.mjs übernommen.
import { crc32 } from 'node:zlib';
import { readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
let db;
export function setzeS1Db(database) { db = database; }
export const BANNER_MAX_BYTES = 3145728;
const PNG_SIGNATUR = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

// Erlaubte Farbtyp+Bittiefe-Kombinationen nach PNG-Spezifikation.
const ERLAUBTE_BITTIEFE = new Map([
  [0, new Set([1, 2, 4, 8, 16])],  // Graustufen
  [2, new Set([8, 16])],            // RGB
  [3, new Set([1, 2, 4, 8])],       // Indiziert (erfordert PLTE)
  [4, new Set([8, 16])],            // Graustufen + Alpha
  [6, new Set([8, 16])],            // RGBA
]);

// Prüft den vollständigen Puffer als PNG.
// Liefert null bei Erfolg oder einen Fehlercode (string) ohne sensible Daten.
function pruefeBannerPng(buf) {
  if (!Buffer.isBuffer(buf)) return 'png_leer';
  if (buf.length === 0) return 'png_leer';
  if (buf.length > BANNER_MAX_BYTES) return 'png_zu_gross';

  // Signatur prüfen (8 Bytes)
  if (buf.length < 8) return 'png_kein_png';
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATUR[i]) return 'png_kein_png';
  }

  let offset = 8, metadaten = 0;
  let ersterChunk = true;
  let hatIdat = false;
  let hatIend = false;
  let hatPlte = false;
  let hatTrns = false;
  let farbtyp = -1;
  let bittiefe = -1;
  let plteNFarben = 0;
  let idatLaeuft = false; // true solange IDAT-Chunks aufeinander folgen

  while (offset < buf.length) {
    // Nach IEND darf nichts mehr folgen
    if (hatIend) return 'png_daten_nach_iend';

    // Mindestens 8 Bytes für Länge + Typ, dann 4 für CRC
    if (offset + 8 > buf.length) return 'png_chunk_abgeschnitten';

    const laenge = buf.readUInt32BE(offset);
    const typ = buf.toString('ascii', offset + 4, offset + 8);
    if (buf[offset + 4] & 32) metadaten += laenge + 12;
    if (metadaten > 256 * 1024) return 'png_metadaten_zu_gross';

    if (laenge > 0x7FFFFFFF) return 'png_chunk_zu_lang';
    if (offset + 12 + laenge > buf.length) return 'png_chunk_abgeschnitten';

    // Chunk-Typ: genau vier ASCII-Buchstaben; drittes Zeichen muss großgeschrieben sein (Reserved-Bit = 0).
    for (let i = 0; i < 4; i++) {
      const c = buf[offset + 4 + i];
      if (!((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A))) return 'png_chunk_typ_ungueltig';
    }
    if (buf[offset + 6] < 0x41 || buf[offset + 6] > 0x5A) return 'png_chunk_typ_ungueltig';

    // CRC-32 über Chunk-Typ + Chunk-Daten
    const crcGespeichert = buf.readUInt32BE(offset + 8 + laenge);
    const crcBerechnet = crc32(buf.subarray(offset + 4, offset + 8 + laenge)) >>> 0;
    if (crcGespeichert !== crcBerechnet) return 'png_crc_fehler';

    if (ersterChunk) {
      if (typ !== 'IHDR') return 'png_erster_chunk_kein_ihdr';
      ersterChunk = false;

      // IHDR muss genau 13 Bytes lang sein
      if (laenge !== 13) return 'png_ihdr_zu_kurz';
      const breite = buf.readUInt32BE(offset + 8);
      const hoehe = buf.readUInt32BE(offset + 12);
      if (breite < 400 || breite > 4096) return 'png_abmessung_ungueltig';
      if (hoehe < 400 || hoehe > 4096 || breite * hoehe > 16_777_216) return 'png_abmessung_ungueltig';

      bittiefe = buf[offset + 16];
      farbtyp = buf[offset + 17];
      const erlaubt = ERLAUBTE_BITTIEFE.get(farbtyp);
      if (!erlaubt || !erlaubt.has(bittiefe)) return 'png_farbtyp_ungueltig';

      // Kompressionsmethode, Filtermethode: müssen 0 sein; Interlace: 0 oder 1
      if (buf[offset + 18] !== 0) return 'png_ihdr_kompression_ungueltig';
      if (buf[offset + 19] !== 0) return 'png_ihdr_filter_ungueltig';
      if (buf[offset + 20] !== 0 && buf[offset + 20] !== 1) return 'png_ihdr_interlace_ungueltig';
    } else if (typ === 'IHDR') {
      return 'png_doppeltes_ihdr';
    } else if (typ === 'PLTE') {
      // PLTE: bekannter kritischer Chunk; höchstens einmal, vor dem ersten IDAT.
      if (hatPlte) return 'png_doppeltes_plte';
      if (hatIdat) return 'png_plte_nach_idat';
      // Länge: Vielfaches von 3, zwischen 3 und 768 (1 bis 256 Farben)
      if (laenge === 0 || laenge % 3 !== 0 || laenge > 768) return 'png_plte_laenge_ungueltig';
      // Bei Graustufen (0) und Graustufen+Alpha (4) verboten
      if (farbtyp === 0 || farbtyp === 4) return 'png_plte_verboten';
      // Farbtyp 3: Farbenanzahl darf 2^bittiefe nicht überschreiten
      if (farbtyp === 3 && laenge / 3 > Math.pow(2, bittiefe)) return 'png_plte_laenge_ungueltig';
      // tRNS muss nach PLTE stehen (nicht davor)
      if (hatTrns) return 'png_plte_nach_trns';
      plteNFarben = laenge / 3;
      hatPlte = true;
    } else if (typ === 'IDAT') {
      // IDAT-Chunks müssen lückenlos aufeinander folgen
      if (hatIdat && !idatLaeuft) return 'png_idat_unterbrochen';
      hatIdat = true;
      idatLaeuft = true;
    } else if (typ === 'IEND') {
      if (laenge !== 0) return 'png_iend_laenge_falsch';
      hatIend = true;
    } else if (typ === 'tRNS') {
      // tRNS: bekannter Ancillary-Chunk; höchstens einmal, vor dem ersten IDAT.
      if (hatTrns) return 'png_trns_ungueltig';
      if (hatIdat) return 'png_trns_ungueltig';
      // Farbtypen 4 und 6 (Alpha-Kanal im Bilddaten): verboten
      if (farbtyp === 4 || farbtyp === 6) return 'png_trns_ungueltig';
      // Farbtyp 3: nur nach PLTE; Einträge nicht mehr als Palettenfarben
      if (farbtyp === 3) {
        if (!hatPlte) return 'png_trns_ungueltig';
        if (laenge > plteNFarben) return 'png_trns_ungueltig';
      } else if (farbtyp === 0) {
        if (laenge !== 2) return 'png_trns_ungueltig';
      } else if (farbtyp === 2) {
        if (laenge !== 6) return 'png_trns_ungueltig';
      }
      hatTrns = true;
      if (idatLaeuft) idatLaeuft = false;
    } else {
      // Kritische Chunks (erster Buchstabe großgeschrieben) werden abgelehnt.
      // Ancillary Chunks (erster Buchstabe kleingeschrieben) werden ignoriert,
      // unterbrechen aber eine laufende IDAT-Folge.
      const c0 = buf[offset + 4];
      if (c0 >= 0x41 && c0 <= 0x5A) return 'png_unbekannter_kritischer_chunk';
      if (idatLaeuft) idatLaeuft = false;
    }

    offset += 12 + laenge;
  }

  // Farbtyp 3 (indiziert) erfordert PLTE
  if (farbtyp === 3 && !hatPlte) return 'png_plte_fehlt';
  if (!hatIdat) return 'png_kein_idat';
  if (!hatIend) return 'png_kein_iend';

  return null;
}


export function pruefeBanner(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return 'banner_leer';
  if (buf.length > BANNER_MAX_BYTES) return 'banner_zu_gross';
  if (buf.subarray(0, 8).equals(PNG_SIGNATUR)) {
    const e = pruefeBannerPng(buf);
    return e ? 'banner_' + e.slice(4) : { ok: true, ext: 'png', breite: buf.readUInt32BE(16), hoehe: buf.readUInt32BE(20) };
  }
  if (buf.length < 3 || buf[0] !== 255 || buf[1] !== 216 || buf[2] !== 255) return 'banner_format';
  let pos = 2, breite = 0, hoehe = 0, scan = false, scans = 0, metadaten = 0;
  // Harte Grenze; jeder Durchlauf konsumiert mindestens ein Byte.
  for (let n = 0; n < BANNER_MAX_BYTES && pos < buf.length; n++) {
    if (scan && buf[pos] !== 255) { pos++; continue; }
    if (buf[pos++] !== 255) return 'banner_jpeg_marker';
    while (pos < buf.length && buf[pos] === 255) pos++;
    if (pos >= buf.length) break;
    const marker = buf[pos++];
    if (scan && (marker === 0 || (marker >= 208 && marker <= 215))) continue;
    scan = false;
    if (marker === 217) return breite && scans && pos === buf.length ? { ok: true, ext: 'jpg', breite, hoehe } : 'banner_jpeg_ungueltig';
    if (marker === 0 || marker === 216 || (marker >= 208 && marker <= 215)) return 'banner_jpeg_marker';
    if (marker === 1) continue;
    if (pos + 2 > buf.length) break;
    const len = buf.readUInt16BE(pos);
    if (len < 2 || pos + len > buf.length) return 'banner_jpeg_abgeschnitten';
    if ((marker >= 224 && marker <= 239) || marker === 254) metadaten += len + 2;
    if (metadaten > 256 * 1024) return 'banner_metadaten_zu_gross';
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      if (breite || len < 8) return 'banner_jpeg_sof';
      hoehe = buf.readUInt16BE(pos + 3); breite = buf.readUInt16BE(pos + 5);
      const komponenten = buf[pos + 7];
      if (!komponenten || len !== 8 + 3 * komponenten) return 'banner_jpeg_sof';
      if (breite < 400 || hoehe < 400 || breite > 4096 || hoehe > 4096 || breite * hoehe > 16_777_216) return 'banner_abmessung_ungueltig';
    }
    if (marker === 218) {
      if (!breite || len < 6 || !buf[pos + 2] || len !== 6 + 2 * buf[pos + 2]) return 'banner_jpeg_sos';
      scan = true; scans++;
    }
    pos += len;
  }
  return 'banner_jpeg_abgeschnitten';
}
export function leseMarkeS1(key) {
  if (!db || !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='marke'").get()) return null;
  const row = db.prepare('SELECT wert FROM marke WHERE schluessel=?').get(key);
  try { return row ? JSON.parse(row.wert) : null; } catch { return null; }
}
export function bannerPfad(logoPfad, ext) {
  if (!['png', 'jpg'].includes(ext)) throw Error('banner_format');
  return join(dirname(logoPfad), 'banner.' + ext);
}
export function bannerUrl() {
  const b = leseMarkeS1('banner');
  if (!b || !db) return null;
  const file = db.prepare('PRAGMA database_list').all().find(x => x.name === 'main').file;
  return b && ['png', 'jpg'].includes(b.ext) && existsSync(join(dirname(file), 'marke', 'banner.' + b.ext)) ? '/marke/banner?v=' + encodeURIComponent(b.v) : null;
}
export function entferneBanner(logoPfad, ext) {
  try { unlinkSync(bannerPfad(logoPfad, ext)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
// Entfernt nur benannte Metadaten; Bilddaten und behaltene CRCs bleiben bytegleich.
export function bereinigeBanner(buf, ext) {
  const original = pruefeBanner(buf);
  if (!original.ok || original.ext !== ext) throw Error('banner_beschaedigt');
  const teile = [buf.subarray(0, ext === 'png' ? 8 : 2)];
  let pos = ext === 'png' ? 8 : 2;
  for (let n = 0; n < BANNER_MAX_BYTES && pos < buf.length; n++) {
    if (ext === 'png') {
      const ende = pos + 12 + buf.readUInt32BE(pos);
      if (!['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(buf.toString('ascii', pos + 4, pos + 8))) teile.push(buf.subarray(pos, ende));
      pos = ende;
    } else {
      const start = pos;
      while (buf[pos] === 255) pos++;
      const marker = buf[pos++];
      if (marker === 217) { teile.push(buf.subarray(start, pos)); break; }
      const ende = marker === 1 ? pos : pos + buf.readUInt16BE(pos);
      if (![225, 237, 254].includes(marker)) teile.push(buf.subarray(start, ende));
      pos = ende;
      if (marker === 218) {
        const scanStart = pos;
        // Stuffing, Restart-Marker und Fuellbytes gehoeren unveraendert zum Scan.
        for (let i = 0; i < BANNER_MAX_BYTES && pos < buf.length; i++) {
          if (buf[pos] !== 255) { pos++; continue; }
          let naechstes = pos + 1;
          while (naechstes < buf.length && buf[naechstes] === 255) naechstes++;
          const code = buf[naechstes];
          if (code === 0 || (code >= 208 && code <= 215)) { pos = naechstes + 1; continue; }
          break;
        }
        teile.push(buf.subarray(scanStart, pos));
      }
    }
  }
  const out = Buffer.concat(teile), geprueft = pruefeBanner(out);
  if (!geprueft.ok || geprueft.ext !== ext || geprueft.breite !== original.breite || geprueft.hoehe !== original.hoehe) throw Error('banner_beschaedigt');
  return out;
}
export function speichereBanner(buf, logoPfad, speichern = () => {}) {
  const b = pruefeBanner(buf);
  if (!b.ok) throw Error(b);
  const sauber = bereinigeBanner(buf, b.ext);
  const ziel = bannerPfad(logoPfad, b.ext), tmp = ziel + '.tmp.' + randomBytes(16).toString('hex');
  const vorher = existsSync(ziel) ? readFileSync(ziel) : null;
  const meta = { ext: b.ext, breite: b.breite, hoehe: b.hoehe, v: Date.now() + '-' + randomBytes(8).toString('hex') };
  mkdirSync(dirname(ziel), { recursive: true });
  try {
    writeFileSync(tmp, sauber, { flag: 'wx' }); renameSync(tmp, ziel);
    try { speichern(meta); }
    catch (e) {
      if (vorher) { writeFileSync(tmp, vorher, { flag: 'wx' }); renameSync(tmp, ziel); }
      else unlinkSync(ziel);
      throw e;
    }
  } finally { try { unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  entferneBanner(logoPfad, b.ext === 'png' ? 'jpg' : 'png');
  return meta;
}
export function bannerRouteHandler(logoPfad) {
  return (_req, res) => {
    const b = leseMarkeS1('banner');
    let bytes;
    try { bytes = b && readFileSync(bannerPfad(logoPfad, b.ext)); } catch { /* fehlt */ }
    if (!bytes) return res.set('Cache-Control', 'no-store').status(404).end();
    res.set({ 'Content-Type': b.ext === 'png' ? 'image/png' : 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'public, max-age=300' }).send(bytes);
  };
}
export function pruefeHero(body) {
  const objekt = x => x && typeof x === 'object' && !Array.isArray(x);
  if (!objekt(body) || Object.keys(body).some(k => !['de', 'en', 'hu'].includes(k))) return null;
  const out = {};
  for (const [lang, werte] of Object.entries(body)) {
    if (!objekt(werte) || Object.keys(werte).some(k => !['titel', 'untertitel'].includes(k))) return null;
    out[lang] = {};
    for (const [key, max] of [['titel', 80], ['untertitel', 200]]) {
      if (typeof werte[key] !== 'string') return null;
      const text = werte[key].normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '').trim();
      if ([...text].length > max) return null;
      out[lang][key] = text;
    }
  }
  return out;
}
