import { pruefeEmailFormat, pruefeTelefonFormat } from './feldregeln.mjs';

const FELDER = ['name', 'anschrift', 'telefon', 'email', 'adoszam', 'steuerHinweis'];
export const NAME_MAX = 160;
export const TEXT_MAX = 500;
export const EMAIL_MAX = 254;
export const TELEFON_MAX = 50;
const VERBOTEN_UNICODE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00AD\u2028\u2029]/;

let anbieterCache;
let anbieterDb = null;
let anbieterBasis = null;
let anbieterBasisQuelle = 'umgebung';
export function setzeAnbieterDb(datenbank) { anbieterDb = datenbank; anbieterCache = undefined; }
export function setzeAnbieterBasis(obj, quelle = 'umgebung') { anbieterBasis = obj ?? null; anbieterBasisQuelle = quelle; anbieterCache = undefined; }

export function leseAnbieter() {
  // 1. marke-Tabelle (gespeichert per Admin, gecacht nach rohem JSON-Wert)
  let roh;
  try { roh = anbieterDb?.prepare("SELECT wert FROM marke WHERE schluessel='anbieter'").get()?.wert; } catch { roh = undefined; }
  if (anbieterCache && anbieterCache.roh === roh && roh !== undefined && roh !== null) return anbieterCache;

  if (roh !== undefined && roh !== null) {
    try {
      const wert = JSON.parse(roh);
      if (wert && typeof wert === 'object') {
        const a = {
          name: String(wert.name ?? ''),
          anschrift: String(wert.anschrift ?? ''),
          telefon: String(wert.telefon ?? ''),
          email: String(wert.email ?? ''),
          adoszam: String(wert.adoszam ?? ''),
          steuerHinweis: String(wert.steuerHinweis ?? ''),
          quelle: 'marke',
        };
        // A3d: Zeile mit leerem Namen gilt nicht (z.B. vor A3d gespeichert) → Fallback
        if (a.name.trim()) {
          anbieterCache = { roh, ...a };
          return anbieterCache;
        }
      }
    } catch { /* Defektes JSON: weiter */ }
  }
  // 2. anbieterBasis (Umgebungsvariablen, gesetzt über setzeAnbieterBasis)
  if (anbieterBasis?.ANBIETER_NAME?.trim()) {
    return {
      roh,
      name: String(anbieterBasis.ANBIETER_NAME || ''),
      anschrift: String(anbieterBasis.ANBIETER_ANSCHRIFT || ''),
      telefon: String(anbieterBasis.ANBIETER_TELEFON || ''),
      email: String(anbieterBasis.ANBIETER_EMAIL || ''),
      adoszam: String(anbieterBasis.ANBIETER_ADOSZAM || ''),
      steuerHinweis: String(anbieterBasis.STEUER_HINWEIS || ''),
      quelle: anbieterBasisQuelle,
    };
  }
  // 3+4. Fallback (einstellungen / Standard) wird nicht gecacht — ändert sich während WP4-Einrichtung
  return { roh, ...liesAnbieterFallback() };
}

function liesAnbieterFallback() {
  // 2. einstellungen-Tabelle (Rückfall für WP4-Assistent, nicht gecacht)
  if (anbieterDb) {
    try {
      const get = (k) => anbieterDb.prepare('SELECT wert FROM einstellungen WHERE schluessel=?').get(k)?.wert ?? '';
      const name = get('ANBIETER_NAME');
      if (name?.trim()) {
        return {
          name,
          anschrift: get('ANBIETER_ANSCHRIFT'),
          telefon: get('ANBIETER_TELEFON'),
          email: get('ANBIETER_EMAIL'),
          adoszam: get('ANBIETER_ADOSZAM'),
          steuerHinweis: get('STEUER_HINWEIS'),
          quelle: 'einstellungen',
        };
      }
    } catch { /* weiter */ }
  }
  // 3. Standard (leer)
  return { name: '', anschrift: '', telefon: '', email: '', adoszam: '', steuerHinweis: '', quelle: 'standard' };
}

export function pruefeAnbieter(daten, { pflicht = true } = {}) {
  if (!daten || typeof daten !== 'object' || Array.isArray(daten)) return { fehler: 'anbieter_ungueltig', felder: [] };
  // Unbekannte Felder
  for (const k of Object.keys(daten)) {
    if (!FELDER.includes(k)) return { fehler: 'anbieter_ungueltig', felder: [k] };
  }
  // Nicht-String-Werte
  for (const f of FELDER) {
    const w = daten[f];
    if (w !== undefined && w !== null && typeof w !== 'string') return { fehler: 'anbieter_ungueltig', felder: [f] };
  }
  // Steuerzeichen + verbotene Unicode-Kategorien
  for (const f of FELDER) {
    const w = daten[f];
    if (!w) continue;
    if (VERBOTEN_UNICODE.test(w)) return { fehler: 'anbieter_ungueltig', felder: [f] };
    if (f === 'anschrift') {
      if ((w.match(/\n/g) || []).length > 4) return { fehler: 'anbieter_ungueltig', felder: [f] };
      if (/[\x00-\x09\x0b-\x1f\x7f-]/.test(w)) return { fehler: 'anbieter_ungueltig', felder: [f] };
    } else {
      if (/[\x00-\x1f\x7f-]/.test(w)) return { fehler: 'anbieter_ungueltig', felder: [f] };
    }
  }
  // Pflichtfelder
  const fehlend = ['name', 'anschrift', 'email'].filter(f => !String(daten[f] ?? '').trim());
  if (pflicht && fehlend.length > 0) return { fehler: 'anbieter_pflicht', felder: fehlend };
  // Länge
  const { name, email, telefon } = daten;
  if (name && name.normalize('NFC').length > NAME_MAX) return { fehler: 'anbieter_ungueltig', felder: ['name'] };
  for (const f of ['anschrift', 'adoszam', 'steuerHinweis']) {
    const w = daten[f];
    if (w && w.normalize('NFC').length > TEXT_MAX) return { fehler: 'anbieter_ungueltig', felder: [f] };
  }
  // Format
  if (email && email.length > 254) return { fehler: 'anbieter_email_ungueltig' };
  if (email && pruefeEmailFormat(email)) return { fehler: 'anbieter_email_ungueltig' };
  if (telefon && pruefeTelefonFormat(telefon)) return { fehler: 'anbieter_telefon_ungueltig' };
  return null;
}

// Gemeinsame Datenform fuer Kaufversand und Vorschau, einschliesslich Konfigurations-Rueckfall.
export function mailAnbieter(fallback = {}, a = leseAnbieter()) {
  return a.quelle === 'standard' ? fallback : { ANBIETER_NAME: a.name, ANBIETER_ANSCHRIFT: a.anschrift, ANBIETER_EMAIL: a.email, ANBIETER_TELEFON: a.telefon, ANBIETER_ADOSZAM: a.adoszam, STEUER_HINWEIS: a.steuerHinweis };
}

// Einzelne Vorschaufelder ohne Pflichtpruefung; ungueltige Werte behalten den Bestand.
export function vorschauAnbieter(daten) {
  const a = { ...leseAnbieter() };
  if (!daten || typeof daten !== 'object' || Array.isArray(daten)) return a;
  for (const feld of FELDER) {
    const wert = daten[feld];
    if (typeof wert === 'string' && !pruefeAnbieter({ [feld]: wert }, { pflicht: false })) {
      a[feld] = wert.normalize('NFC');
      a.quelle = 'vorschau';
    }
  }
  return a;
}
