// recht-text.mjs — A4a: Speicher- und Validierungslogik für Admin-Rechtstexte.
// Kein db-Import am Modulkopf; Injektion via setzeRechtDb(db) wie anbieter.mjs.

// URL-Segment → Datenbank-Schlüssel (recht_*) — gleiche Tabelle wie in recht-vorlagen.mjs
export const URL_ZU_SCHLUESSEL = { 'impresszum': 'impressum', 'adatvedelem': 'datenschutz', 'reszveteli-feltetelek': 'teilnahmebedingungen' };

let rechtDb = null;
let testFehlerAktiv = false;

export function setzeRechtDb(db) {
  rechtDb = db;
}

// Nur für Tests: wirft beim nächsten Schreibzugriff vor dem recht_aktiv-Update.
export function setzeTestFehler(val) {
  testFehlerAktiv = val;
}

// Verbotene Zeichen: C0/C1 außer \n \t, Zero-Width, Bidi, BOM, SHY, LS, PS
const VERBOTEN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\u00ad\u2028\u2029]/;

function validiereInhalt(inhalt) {
  if (typeof inhalt !== 'string' || inhalt.length === 0) return 'leer';
  const nfc = inhalt.normalize('NFC');
  if (VERBOTEN.test(nfc)) return 'zeichen';
  if ([...nfc].length > 20000) return 'laenge';
  return null;
}

// Liest Einstellungswert recht_<schluessel> für eine URL-Seite.
function leseRechtModus(seite) {
  const schluessel = URL_ZU_SCHLUESSEL[seite];
  if (!schluessel) return null;
  return rechtDb.prepare('SELECT wert FROM einstellungen WHERE schluessel=?').get(`recht_${schluessel}`)?.wert ?? null;
}

// Nächste Versionsnummer für eine Seite (MAX + 1).
function naechsteVersion(seite) {
  const row = rechtDb.prepare('SELECT MAX(version) AS m FROM recht_text WHERE seite=?').get(seite);
  return (row?.m ?? 0) + 1;
}

// Speichert neuen Text atomar. Gibt {version} zurück oder wirft bei Fehler.
export function speichereText(seite, inhalt, sprache, basisVersion, bearbeiter) {
  const modus = leseRechtModus(seite);
  if (modus !== 'erstellt') {
    const e = new Error('recht_url_aktiv');
    e.code = 'recht_url_aktiv';
    throw e;
  }
  const fehler = validiereInhalt(inhalt);
  if (fehler) {
    const e = new Error('recht_text_ungueltig');
    e.code = fehler === 'zeichen' || fehler === 'laenge' ? 'recht_text_ungueltig' : 'recht_text_ungueltig';
    e.feld = fehler;
    throw e;
  }
  if (!['de', 'en', 'hu'].includes(sprache)) {
    const e = new Error('recht_sprache_ungueltig');
    e.code = 'recht_sprache_ungueltig';
    throw e;
  }

  const nfc = inhalt.normalize('NFC');

  rechtDb.exec('BEGIN IMMEDIATE');
  try {
    const aktiv = rechtDb.prepare('SELECT version FROM recht_aktiv WHERE seite=?').get(seite);
    const aktiveVersion = aktiv?.version ?? 0;
    if (aktiveVersion !== basisVersion) {
      rechtDb.exec('ROLLBACK');
      const e = new Error('recht_konflikt');
      e.code = 'recht_konflikt';
      throw e;
    }
    const version = naechsteVersion(seite);
    const erstellt = new Date().toISOString();
    rechtDb.prepare('INSERT INTO recht_text(seite,version,sprache,inhalt,bearbeiter,erstellt) VALUES(?,?,?,?,?,?)').run(seite, version, sprache, nfc, bearbeiter, erstellt);
    if (testFehlerAktiv) {
      testFehlerAktiv = false;
      throw new Error('Simulierter Testfehler vor recht_aktiv-Update');
    }
    rechtDb.prepare('INSERT OR REPLACE INTO recht_aktiv(seite,version) VALUES(?,?)').run(seite, version);
    rechtDb.exec('COMMIT');
    return { version, erstellt };
  } catch (e) {
    try { rechtDb.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

// Stellt eine alte Version als neue aktive Version wieder her.
export function stelleWiederHer(seite, wiederherstellungsVersion, basisVersion, bearbeiter) {
  const modus = leseRechtModus(seite);
  if (modus !== 'erstellt') {
    const e = new Error('recht_url_aktiv');
    e.code = 'recht_url_aktiv';
    throw e;
  }

  rechtDb.exec('BEGIN IMMEDIATE');
  try {
    const aktiv = rechtDb.prepare('SELECT version FROM recht_aktiv WHERE seite=?').get(seite);
    const aktiveVersion = aktiv?.version ?? 0;
    if (aktiveVersion !== basisVersion) {
      rechtDb.exec('ROLLBACK');
      const e = new Error('recht_konflikt');
      e.code = 'recht_konflikt';
      throw e;
    }
    const quelle = rechtDb.prepare('SELECT inhalt, sprache FROM recht_text WHERE seite=? AND version=?').get(seite, wiederherstellungsVersion);
    if (!quelle) {
      rechtDb.exec('ROLLBACK');
      const e = new Error('nicht_gefunden');
      e.code = 'nicht_gefunden';
      throw e;
    }
    const version = naechsteVersion(seite);
    const erstellt = new Date().toISOString();
    rechtDb.prepare('INSERT INTO recht_text(seite,version,sprache,inhalt,bearbeiter,erstellt) VALUES(?,?,?,?,?,?)').run(seite, version, quelle.sprache, quelle.inhalt, bearbeiter, erstellt);
    if (testFehlerAktiv) {
      testFehlerAktiv = false;
      throw new Error('Simulierter Testfehler');
    }
    rechtDb.prepare('INSERT OR REPLACE INTO recht_aktiv(seite,version) VALUES(?,?)').run(seite, version);
    rechtDb.exec('COMMIT');
    return { version, erstellt };
  } catch (e) {
    try { rechtDb.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

// Liest alle drei Seiten als Übersicht (letzte 50 Versionen je Seite).
export function leseRechtUebersicht() {
  const seiten = ['impresszum', 'adatvedelem', 'reszveteli-feltetelek'];
  return seiten.map(seite => {
    const schluessel = URL_ZU_SCHLUESSEL[seite];
    const moduswert = schluessel ? (rechtDb.prepare('SELECT wert FROM einstellungen WHERE schluessel=?').get(`recht_${schluessel}`)?.wert ?? null) : null;
    let modus;
    if (moduswert === 'erstellt') modus = 'erstellt';
    else if (moduswert) modus = 'url';
    else modus = 'nicht_gesetzt';

    const aktiv = rechtDb.prepare('SELECT version FROM recht_aktiv WHERE seite=?').get(seite);
    const aktivMeta = aktiv ? rechtDb.prepare('SELECT version, sprache, erstellt, bearbeiter FROM recht_text WHERE seite=? AND version=?').get(seite, aktiv.version) : null;

    const versionen = rechtDb.prepare(
      'SELECT version, sprache, erstellt, bearbeiter FROM recht_text WHERE seite=? ORDER BY version DESC LIMIT 50'
    ).all(seite);

    return { seite, modus, aktiv: aktivMeta ?? null, versionen };
  });
}

// Liest eine einzelne Version mit Inhalt.
export function leseRechtVersion(seite, version) {
  return rechtDb.prepare('SELECT version, sprache, inhalt, erstellt, bearbeiter FROM recht_text WHERE seite=? AND version=?').get(seite, version) ?? null;
}

// Liest den aktiven Text einer Seite (wenn recht_<seite>='erstellt' und aktiv vorhanden).
export function leseAktivenText(seite) {
  const modus = leseRechtModus(seite);
  if (modus !== 'erstellt') return null;
  const aktiv = rechtDb.prepare('SELECT version FROM recht_aktiv WHERE seite=?').get(seite);
  if (!aktiv) return null;
  return rechtDb.prepare('SELECT version, sprache, inhalt FROM recht_text WHERE seite=? AND version=?').get(seite, aktiv.version) ?? null;
}

// D8: einwilligung_version — 'reg-2026-11-03' + optionales '+ds<v>+tb<v>'
export function leseEinwilligungVersion() {
  const basis = 'reg-2026-11-03';
  if (!rechtDb) return basis;
  const dsAktiv = leseAktivenText('adatvedelem');
  const tbAktiv = leseAktivenText('reszveteli-feltetelek');
  if (!dsAktiv && !tbAktiv) return basis;
  const dsV = dsAktiv?.version ?? 0;
  const tbV = tbAktiv?.version ?? 0;
  return `${basis}+ds${dsV}+tb${tbV}`;
}

// Rendert Klartext-Inhalt zu HTML (h2/p/ul/li, esc() auf alles).
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

export function rendereKlartext(inhalt) {
  const zeilen = inhalt.split('\n');
  const teile = [];
  let inListe = false;

  for (const zeile of zeilen) {
    if (zeile.startsWith('# ')) {
      if (inListe) { teile.push('</ul>'); inListe = false; }
      teile.push(`<h2>${esc(zeile.slice(2))}</h2>`);
    } else if (zeile.startsWith('- ')) {
      if (!inListe) { teile.push('<ul>'); inListe = true; }
      teile.push(`<li>${esc(zeile.slice(2))}</li>`);
    } else if (zeile.trim() === '') {
      if (inListe) { teile.push('</ul>'); inListe = false; }
    } else {
      if (inListe) { teile.push('</ul>'); inListe = false; }
      teile.push(`<p>${esc(zeile)}</p>`);
    }
  }
  if (inListe) teile.push('</ul>');
  return teile.join('\n');
}
