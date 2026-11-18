// schluessel-code.mjs – WP9: Wiederherstellungsschluessel als druckbaren Code darstellen und einlesen.
// Format: Crockford Base32, 52 Datenstellen + 1 Pruefsymbol = 53 Zeichen, in Gruppen zu 4 mit Bindestrich.
// Alphabet (Daten): 0123456789ABCDEFGHJKMNPQRSTVWXYZ (32 Zeichen; ohne I L O U, kein Verwechslungsrisiko)
// Pruefsymbol: Schluessel-Zahl N (256-Bit BigInt) modulo 37 (kleinste Primzahl ueber 32);
//   37 Symbole in Reihenfolge: 0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U
// Erkennt: alle Einzelzeichen-Ersetzungen und alle Vertauschungen benachbarter verschiedener Zeichen.
// Erkennt nicht: Vertauschungen benachbarter gleicher Zeichen, nicht benachbarte Vertauschungen.
// Quelle: https://www.crockford.com/base32.html (gelesen 2026-11-14)

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 Crockford-Datenstellen
const CHECK    = '0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U'; // 37 Pruefsymbole

// Dekodier-Tabelle fuer Datenstellen (inkl. Crockford-Aliase)
const DECODE = Object.create(null);
for (let i = 0; i < 32; i++) DECODE[ALPHABET[i]] = i;
DECODE['I'] = 1; DECODE['L'] = 1; DECODE['O'] = 0; // Crockford-Aliase (I,L -> 1; O -> 0)

export function schluesselAlsCode(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('schluessel_ungueltig');

  // 32 Bytes -> BigInt N (big-endian)
  let n = 0n;
  for (let i = 0; i < 32; i++) n = (n << 8n) | BigInt(key[i]);

  // 52 Crockford-Datenstellen (5 Bit je Stelle, 260 Bit gesamt; obere 4 Bit sind 0 da N < 2^256)
  let tmp = n;
  const chars = new Array(52);
  for (let i = 51; i >= 0; i--) {
    chars[i] = ALPHABET[Number(tmp & 31n)];
    tmp >>= 5n;
  }

  // Pruefsymbol: N mod 37
  chars.push(CHECK[Number(n % 37n)]);

  // Gruppen zu 4 Zeichen, Bindestrich als Trenner (letzte Gruppe hat 1 Zeichen)
  const full = chars.join('');
  const gruppen = [];
  for (let i = 0; i < 53; i += 4) gruppen.push(full.slice(i, i + 4));
  return gruppen.join('-');
}

export function codeAlsSchluessel(code) {
  if (typeof code !== 'string') return null;

  // Bindestriche und Leerzeichen entfernen, Grossbuchstaben, Aliase anwenden
  const s = code.replace(/[-\s]/g, '').toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');

  if (s.length !== 53) return null;

  // Datenstellen dekodieren (Positionen 0-51)
  let n = 0n;
  for (let i = 0; i < 52; i++) {
    const v = DECODE[s[i]];
    if (v === undefined) return null; // ungueltige Stelle (z.B. U in Daten)
    n = (n << 5n) | BigInt(v);
  }

  // Obere 4 Bit muessen 0 sein (N < 2^256)
  if (n >= (1n << 256n)) return null;

  // Pruefsymbol (Position 52)
  const checkIdx = CHECK.indexOf(s[52]);
  if (checkIdx < 0) return null;
  if (Number(n % 37n) !== checkIdx) return null;

  // BigInt -> 32 Bytes (big-endian)
  const buf = Buffer.alloc(32);
  let tmp = n;
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(tmp & 0xffn);
    tmp >>= 8n;
  }
  return buf;
}
