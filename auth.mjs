// LEKTION 7: Anmeldung (Registrieren, Anmelden, Abmelden)
// ------------------------------------------------------------------
// Ziel: Jeder sieht nur SEINE Bestellungen und öffnet nur SEIN Kundenportal.
// Dafür muss die App wissen, wer gerade vor dem Bildschirm sitzt. So funktioniert das hier:
//
//  1. Registrieren: E-Mail + Passwort. Das Passwort speichern wir nicht, sondern nur einen "Hash"
//     (eine Einbahnstraße: aus dem Hash kann man das Passwort nicht zurückrechnen, nur prüfen).
//     Dazu kommt ein zufälliges "Salz", damit gleiche Passwörter verschiedene Hashes ergeben.
//  2. Anmelden: Passwort prüfen. Stimmt es, erzeugen wir einen langen Zufalls-Code (Token) und
//     schicken ihn als Cookie an den Browser. Der Browser sendet ihn bei jeder Anfrage mit.
//  3. In der Datenbank steht nur der Fingerabdruck des Tokens. Würde jemand die Datenbank stehlen,
//     könnte er damit keine Sitzung übernehmen.
//  4. Abmelden: Sitzung in der Datenbank löschen.
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.mjs';
import { PASSWORT_MIN_LAENGE } from './passwort-regeln.mjs';
import {adminErlaubt} from './admin-zugang.mjs';

const scryptAsync = promisify(scrypt);
const COOKIE = 'sitzung';

// ---- Passwörter --------------------------------------------------------------------------
const SCRYPT_N = 131072; // 2^17 — OWASP-Empfehlung (war 2^14)
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 160 * 1024 * 1024; // 160 MiB

// Codex Lauf 10: hoechstens 2 scrypt-Rechnungen mit 128 MiB gleichzeitig (sonst Speicher-DoS durch parallele Logins), Parameter aus dem gespeicherten Hash nur aus fester Liste.
const ERLAUBTE_SCRYPT = new Set(['16384:8:1', '131072:8:1']);
let scryptLaeuft = 0; const scryptWarteschlange = [];
const SCRYPT_MAX_WARTENDE = 16, SCRYPT_WARTE_MS = 15000;
// Opus-Pruefung 5ab875e: Warteschlange begrenzen (max. 16 Wartende) und Wartezeit begrenzen (15 s), sonst blockiert ein Angreifer mit
// vielen Anmeldungen fuer unbekannte E-Mails alle Passwortpruefungen. Ueberlast -> Fehler scrypt_ueberlastet (fail-closed).
async function scryptBegrenzt(passwort, salz, laenge, optionen) {
  if (scryptLaeuft >= 2) {
    if (scryptWarteschlange.length >= SCRYPT_MAX_WARTENDE) throw new Error('scrypt_ueberlastet');
    await new Promise((ok, nein) => {
      const eintrag = { ok, nein, t: null };
      eintrag.t = setTimeout(() => { const i = scryptWarteschlange.indexOf(eintrag); if (i >= 0) scryptWarteschlange.splice(i, 1); nein(new Error('scrypt_ueberlastet')); }, SCRYPT_WARTE_MS);
      scryptWarteschlange.push(eintrag);
    });
  }
  scryptLaeuft++;
  try { return await scryptAsync(passwort, salz, laenge, optionen); }
  finally { scryptLaeuft--; const n = scryptWarteschlange.shift(); if (n) { clearTimeout(n.t); n.ok(); } }
}

export async function passwortHashen(passwort) {
  const salz = randomBytes(16);
  const schluessel = await scryptBegrenzt(passwort, salz, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salz.toString('hex')}$${schluessel.toString('hex')}`;
}

export async function passwortPruefen(passwort, gespeichert) {
  const teile = String(gespeichert).split('$');
  let salzHex, schluesselHex, N, r, p;
  if (teile.length === 6 && teile[0] === 'scrypt') {
    // Neues Format: scrypt$N$r$p$salz$hash
    [, N, r, p, salzHex, schluesselHex] = teile;
    N = parseInt(N, 10); r = parseInt(r, 10); p = parseInt(p, 10);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  } else if (teile.length === 3 && teile[0] === 'scrypt') {
    // Altes Format: scrypt$salz$hash — Rückwärtskompatibilität
    [, salzHex, schluesselHex] = teile;
    N = 16384; r = 8; p = 1; // alte Defaults
  } else {
    return false;
  }
  if (!salzHex || !schluesselHex) return false;
  if (!ERLAUBTE_SCRYPT.has(N + ':' + r + ':' + p)) return false; // Parameter aus der Datenbank nie ungeprueft verwenden
  if (!/^[0-9a-f]+$/i.test(salzHex) || !/^[0-9a-f]+$/i.test(schluesselHex)) return false;
  const erwartet = Buffer.from(schluesselHex, 'hex');
  if (erwartet.length === 0) return false;
  const maxmem = SCRYPT_MAXMEM; // fest: 160 MiB reichen fuer die erlaubten Parameter
  const berechnet = await scryptBegrenzt(passwort, Buffer.from(salzHex, 'hex'), erwartet.length, { N, r, p, maxmem });
  if (berechnet.length !== erwartet.length) return false;
  return timingSafeEqual(berechnet, erwartet); // gleich schnell bei richtig und falsch (gegen Zeit-Angriffe)
}

// ---- Eingaben prüfen -----------------------------------------------------------------
export function emailPruefen(email) {
  const e = String(email || '').trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e; // klein geschrieben, damit "Max@x.de" und "max@x.de" dasselbe Konto sind
}
export { PASSWORT_MIN_LAENGE };
export function passwortRegelnPruefen(passwort) {
  const p = String(passwort || '');
  if (p.length < PASSWORT_MIN_LAENGE) return 'passwort_zu_kurz';
  if (p.length > 200) return 'passwort_zu_lang';
  return null;
}

// ---- Sitzungs-Timeouts (P12/F-49) ---------------------------------------------------
export const ADMIN_IDLE_MS     = 15 * 60 * 1000;
export const ADMIN_ABSOLUT_MS  = 8 * 60 * 60 * 1000;
export const KUNDE_IDLE_MS     = 24 * 60 * 60 * 1000;
export const KUNDE_ABSOLUT_MS  = 7 * 24 * 60 * 60 * 1000;
export const STEPUP_MS         = 5 * 60 * 1000;
export const SITZUNG_WARNUNG_MS = 2 * 60 * 1000;

// ---- Sitzungen -----------------------------------------------------------------------
export const sitzungFingerabdruck = (token) => createHash('sha256').update(token).digest('hex');

export function sitzungErzeugen(benutzerId, maxSitzungen = 3) {
  const token = randomBytes(32).toString('hex');
  const jetzt = Date.now();
  const rolle = db.prepare('SELECT rolle FROM benutzer WHERE id = ?').get(benutzerId)?.rolle;
  const absolutMs = rolle === 'admin' ? ADMIN_ABSOLUT_MS : KUNDE_ABSOLUT_MS;
  if (rolle === 'admin') {
    db.prepare('DELETE FROM sitzungen WHERE benutzer_id = ?').run(benutzerId);
  }
  db.prepare('INSERT INTO sitzungen (token_hash, benutzer_id, laeuft_ab, erstellt, zuletzt_aktiv) VALUES (?, ?, ?, ?, ?)')
    .run(sitzungFingerabdruck(token), benutzerId, jetzt + absolutMs, jetzt, jetzt);
  if (rolle !== 'admin') {
    const liste = db.prepare('SELECT token_hash FROM sitzungen WHERE benutzer_id = ? AND laeuft_ab > ? ORDER BY rowid DESC').all(benutzerId, jetzt);
    for (const alt of liste.slice(maxSitzungen)) db.prepare('DELETE FROM sitzungen WHERE token_hash = ?').run(alt.token_hash);
  }
  return token;
}

export function sitzungBeenden(token) {
  if (token) db.prepare('DELETE FROM sitzungen WHERE token_hash = ?').run(sitzungFingerabdruck(token));
}

function tokenAusCookie(req) {
  const roh = req.headers.cookie || '';
  for (const teil of roh.split(';')) {
    const [name, ...wert] = teil.trim().split('=');
    if (name === COOKIE) return wert.join('=');
  }
  return null;
}

// Wer ist gerade angemeldet? (oder null) — prüft Absolut- und Idle-Timeout, verlängert zuletzt_aktiv.
// F-111: aktualisieren=false → prüft Gültigkeit ohne zuletzt_aktiv zu erneuern (für sitzung-info).
// F-110: zuletzt_aktiv NULL bei Admin-Sitzungen → Absolut-Timeout über erstellt-Spalte prüfen.
export function aktuellerBenutzer(req, { aktualisieren = true } = {}) {
  const token = tokenAusCookie(req);
  if (!token) return null;
  const hash = sitzungFingerabdruck(token);
  const zeile = db.prepare(
    `SELECT b.id, b.email, b.stripe_kunde, b.rolle, b.email_bestaetigt, s.laeuft_ab, s.zuletzt_aktiv, s.erstellt
     FROM sitzungen s JOIN benutzer b ON b.id = s.benutzer_id WHERE s.token_hash = ?`
  ).get(hash);
  if (!zeile) return null;
  const jetzt = Date.now();
  if (zeile.laeuft_ab <= jetzt) return null;
  if (zeile.zuletzt_aktiv !== null && zeile.zuletzt_aktiv !== undefined) {
    const idleMs = zeile.rolle === 'admin' ? ADMIN_IDLE_MS : KUNDE_IDLE_MS;
    if (zeile.zuletzt_aktiv + idleMs <= jetzt) return null;
  } else if (zeile.rolle === 'admin' && zeile.erstellt + ADMIN_ABSOLUT_MS <= jetzt) {
    // F-110: alte Admin-Sitzung ohne zuletzt_aktiv — gegen Erstellzeit + Absolut-Limit prüfen
    return null;
  }
  if (aktualisieren) db.prepare('UPDATE sitzungen SET zuletzt_aktiv = ? WHERE token_hash = ?').run(jetzt, hash);
  if (zeile.rolle === 'admin' && !adminErlaubt(zeile.email))
    return { id: zeile.id, email: zeile.email, stripe_kunde: zeile.stripe_kunde, rolle: 'kunde', email_bestaetigt: zeile.email_bestaetigt };
  return { id: zeile.id, email: zeile.email, stripe_kunde: zeile.stripe_kunde, rolle: zeile.rolle, email_bestaetigt: zeile.email_bestaetigt };
}
export const aktuellesToken = tokenAusCookie;

// ---- Step-up-Auth (P12/F-49): 5-Minuten-Passwortbestätigung vor kritischen Routen ----
export function stepupErzeugen(token) {
  db.prepare('INSERT OR REPLACE INTO stepup_sitzungen (sitzung_hash, laeuft_ab) VALUES (?, ?)')
    .run(sitzungFingerabdruck(token), Date.now() + STEPUP_MS);
}
export function stepupGueltig(req) {
  const token = tokenAusCookie(req);
  if (!token) return false;
  return !!db.prepare('SELECT 1 FROM stepup_sitzungen WHERE sitzung_hash = ? AND laeuft_ab > ?')
    .get(sitzungFingerabdruck(token), Date.now());
}
export function stepupLoeschen(req) {
  const token = tokenAusCookie(req);
  if (token) db.prepare('DELETE FROM stepup_sitzungen WHERE sitzung_hash = ?').run(sitzungFingerabdruck(token));
}

// ---- Sitzungs-Timing-Info für Warn-Anzeige (P12/F-49) --------------------------------
export function sitzungInfo(req) {
  const token = tokenAusCookie(req);
  if (!token) return null;
  const zeile = db.prepare('SELECT laeuft_ab, zuletzt_aktiv FROM sitzungen WHERE token_hash = ?')
    .get(sitzungFingerabdruck(token));
  if (!zeile) return null;
  const idleBis = (zeile.zuletzt_aktiv ?? Date.now()) + ADMIN_IDLE_MS;
  const naechstes_ende = Math.min(zeile.laeuft_ab, idleBis);
  return { naechstes_ende, warnung_ab: naechstes_ende - SITZUNG_WARNUNG_MS };
}

// Das Cookie: HttpOnly = JavaScript im Browser kommt nicht heran (schützt vor Diebstahl durch fremde Skripte).
// SameSite=Lax = fremde Webseiten können es nicht für Anfragen in deinem Namen mitschicken.
// "Secure" (nur über https senden) kommt automatisch dazu, wenn BASE_URL mit https beginnt (siehe konfig.mjs).
export function cookieSetzen(res, token, secure = false) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.ceil(KUNDE_ABSOLUT_MS / 1000)}${secure ? '; Secure' : ''}`);
}
export function cookieLoeschen(res, secure = false) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
}

// ---- Bremse gegen Passwort-Raten ------------------------------------------------------
// Nach 5 Fehlversuchen pro Adresse und E-Mail ist 15 Minuten Pause. (Im Arbeitsspeicher: bei Neustart zurückgesetzt.)
const fehlversuche = new Map();
const FENSTER = 15 * 60 * 1000;
// A3-03/A5-04 (12.11.2026): feste Obergrenze fuer beide Speicher. Map haelt die Einfuegereihenfolge; ein aktualisierter Eintrag wandert
// ans Ende (LRU). Ist die Grenze erreicht, wird der aelteste Eintrag verworfen.
export const MAX_EINTRAEGE = 10000;
function lruSetzen(map, schluessel, wert) {
  map.delete(schluessel);
  while (map.size >= MAX_EINTRAEGE) map.delete(map.keys().next().value);
  map.set(schluessel, wert);
}
// F-112: Schwelle 6 statt 5, damit der 5. Versuch mit richtigem Passwort nicht gesperrt wird.
// Mit P3-Muster (Zaehler vor Hash): 5 Fehlversuche machen Zaehler=5 (<6, nicht gesperrt),
// 6. Versuch macht Zaehler=6 (>=6, gesperrt). So koennen 5 Fehlversuche auftreten, bevor die Sperre greift.
export function gesperrt(schluessel) {
  const e = fehlversuche.get(schluessel);
  return !!e && e.anzahl >= 6 && Date.now() - e.erster < FENSTER;
}
export function fehlversuchMerken(schluessel) {
  const e = fehlversuche.get(schluessel);
  if (!e || Date.now() - e.erster >= FENSTER) lruSetzen(fehlversuche, schluessel, { anzahl: 1, erster: Date.now() });
  else { e.anzahl += 1; lruSetzen(fehlversuche, schluessel, e); }
}
export function fehlversucheLoeschen(schluessel) { fehlversuche.delete(schluessel); }
export function fehlversucheAlleLoeschen(){fehlversuche.clear();kontoFehler.clear();vertraute.clear()}
export function fehlversucheFuerEmailLoeschen(email){
 for(const key of fehlversuche.keys())if(key.endsWith('|'+email))fehlversuche.delete(key);
 kontoFehler.delete(email);
}
// ---- Zweite Bremse je KONTO (ueber alle Adressen), gegen verteiltes Raten -----------------------------------------------
// Ab KONTO_SCHWELLE Fehlversuchen in KONTO_FENSTER ist das Konto KONTO_SPERRE lang gesperrt, auch fuer das richtige Passwort (gleiche
// Antwort 429 wie die IP-Sperre). Damit ein Angreifer den Inhaber (z. B. den Admin) nicht aussperren kann:
// - Die Sperre ist zeitlich begrenzt; danach beginnt die Zaehlung neu.
// - Adressen, von denen sich dieses Konto in den letzten VERTRAUT_TAGE erfolgreich angemeldet hat, sind von der Kontosperre ausgenommen
//   (die IP-Sperre 5/15 min gilt dort weiter).
// - Passwort-Ruecksetzen und NOTFALL_ENTSPERREN (fehlversucheAlleLoeschen) heben die Sperre auf.
// Im Arbeitsspeicher wie die IP-Bremse: ein Neustart setzt beide zurueck.
export const KONTO_SCHWELLE = 40;
export const KONTO_FENSTER = 60 * 60 * 1000;
export const KONTO_SPERRE = 15 * 60 * 1000;
export const VERTRAUT_TAGE = 30;
const VERTRAUT_JE_KONTO = 5;
const kontoFehler = new Map();   // email -> {anzahl, erster, bis}
const vertraute = new Map();     // email -> Map(ip -> zeit der letzten erfolgreichen Anmeldung)
function istVertraut(email, ip) {
  const z = vertraute.get(email)?.get(String(ip));
  return !!z && Date.now() - z < VERTRAUT_TAGE * 86400000;
}
export function kontoGesperrt(email, ip) {
  const e = kontoFehler.get(email);
  return !!e && e.bis > Date.now() && !istVertraut(email, ip);
}
export function kontoFehlversuchMerken(email) {
  const jetzt = Date.now();
  let e = kontoFehler.get(email);
  if (!e || (jetzt - e.erster >= KONTO_FENSTER && !(e.bis > jetzt))) e = { anzahl: 0, erster: jetzt, bis: 0 };
  e.anzahl += 1;
  if (e.anzahl >= KONTO_SCHWELLE) { e.bis = jetzt + KONTO_SPERRE; e.anzahl = 0; e.erster = jetzt; }
  lruSetzen(kontoFehler, email, e);
}
export function anmeldungErfolgreich(email, ip) {
  const alt = vertraute.get(email) || new Map();
  alt.delete(String(ip)); alt.set(String(ip), Date.now());
  while (alt.size > VERTRAUT_JE_KONTO) alt.delete(alt.keys().next().value);
  lruSetzen(vertraute, email, alt);
}
export const _speicherGroesse = () => ({ fehlversuche: fehlversuche.size, kontoFehler: kontoFehler.size, vertraute: vertraute.size });

// Codex Lauf 10: unbekannte Konten gleich teuer pruefen wie bekannte (gleiche Parameter wie neue Hashes)
export const DUMMY_HASH = 'scrypt$131072$8$1$00000000000000000000000000000000$00';
