// WCAG 2.2, W3C Recommendation vom 12.12.2024: deckende sRGB-Hexfarben.
export function hexPruefen(s) {
  if (typeof s !== 'string' || s.length !== 7 || !/^#[0-9a-fA-F]{6}$/.test(s)) return null;
  return s.toLowerCase();
}

function linearisiere(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminanz(hex) {
  const farbe = hexPruefen(hex);
  if (farbe === null) throw new Error('hex_ungueltig');
  const kanal = (start) => linearisiere(parseInt(farbe.slice(start, start + 2), 16) / 255);
  return 0.2126 * kanal(1) + 0.7152 * kanal(3) + 0.0722 * kanal(5);
}

export function kontrast(hexA, hexB) {
  const a = relativeLuminanz(hexA), b = relativeLuminanz(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function pruefeFarben({ haupt, akzent, text, grund }) {
  const farben = { haupt, akzent, text, grund };
  const probleme = [];
  for (const [feld, wert] of Object.entries(farben)) {
    if (hexPruefen(wert) === null) probleme.push({ feld, fehler: 'hex_ungueltig' });
  }
  if (probleme.length) return { ok: false, probleme, gueltig: false };
  const paare = [
    ['text/grund', text, grund, 4.5, '1.4.3'],
    ['haupt/grund', haupt, grund, 3, '1.4.11'],
    ['akzent/grund', akzent, grund, 3, '1.4.11'],
    ['weiss/haupt', '#ffffff', haupt, 4.5, '1.4.3'],
    ['weiss/akzent', '#ffffff', akzent, 4.5, '1.4.3']
  ];
  for (const [paar, vorn, hinten, min, regel] of paare) {
    const wert = kontrast(vorn, hinten);
    // Erst vergleichen, dann ausschliesslich fuer die Ausgabe runden.
    if (wert < min) probleme.push({ paar, verhaeltnis: Number(wert.toFixed(2)), min, regel });
  }
  return { ok: probleme.length === 0, probleme, gueltig: true };
}
