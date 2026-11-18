// logo-png.mjs — WP5: PNG-Prüfung und Logo-Hilfsfunktionen.
// Keine npm-Pakete; CRC-32 über node:zlib (seit Node 22.2.0 verfügbar).
import { crc32 } from 'node:zlib';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const LOGO_MAX_BYTES = 512 * 1024;

// Liefert den absoluten Pfad der Logo-Datei: Verzeichnis der DB-Datei + marke/logo.png.
// Einmal beim Start berechnen und an leseLogo/speichereLogo/logoRouteHandler übergeben.
export function machLogoPfad(dbDatei) {
  return resolve(dirname(dbDatei), 'marke', 'logo.png');
}

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
export function pruefePng(buf) {
  if (!Buffer.isBuffer(buf)) return 'png_leer';
  if (buf.length === 0) return 'png_leer';
  if (buf.length > LOGO_MAX_BYTES) return 'png_zu_gross';

  // Signatur prüfen (8 Bytes)
  if (buf.length < 8) return 'png_kein_png';
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATUR[i]) return 'png_kein_png';
  }

  let offset = 8;
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
      if (breite < 64 || breite > 2000) return 'png_abmessung_ungueltig';
      if (hoehe < 64 || hoehe > 2000) return 'png_abmessung_ungueltig';

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

// Liest das gespeicherte Logo (null wenn nicht vorhanden).
export function leseLogo(logoPfad) {
  try {
    return existsSync(logoPfad) ? readFileSync(logoPfad) : null;
  } catch {
    return null;
  }
}

// Speichert Logo atomar: pruefePng als Schutz, kryptografisch zufälliger Zwischenname (wx-Flag),
// dann umbenennen. Bei jedem Fehler wird logoPfad nicht verändert und die Zwischendatei gelöscht.
export function speichereLogo(buf, logoPfad) {
  const fehler = pruefePng(buf);
  if (fehler) throw new Error(fehler);

  const sfx = randomBytes(16).toString('hex');
  const tmpPfad = join(dirname(logoPfad), `logo.tmp.${sfx}.png`);
  mkdirSync(dirname(logoPfad), { recursive: true });
  let tmpErstellt = false;
  try {
    writeFileSync(tmpPfad, buf, { flag: 'wx' }); // wx: exklusiv anlegen, schlägt fehl wenn vorhanden
    tmpErstellt = true;
    renameSync(tmpPfad, logoPfad);
    tmpErstellt = false;
  } finally {
    if (tmpErstellt) try { unlinkSync(tmpPfad); } catch { /* ignorieren */ }
  }
}

// Express-Route-Handler-Fabrik: öffentlich, keine Sitzung nötig.
// logoPfad einmal beim Start berechnen (machLogoPfad) und hier übergeben.
export function logoRouteHandler(logoPfad) {
  return (req, res) => {
    const logo = leseLogo(logoPfad);
    if (!logo) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).type('text/plain').send('nicht_gefunden');
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(logo);
  };
}
