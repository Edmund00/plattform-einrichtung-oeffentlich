// Anmelde-Routen der Lern-App, aus server.mjs hierher verschoben, damit der Kurs-Teil ohne Stripe laufen und getestet werden kann.
// Die Registrierung vergibt IMMER nur die Rolle "kunde" (Standard der Datenbank). Admins legt nur tools/admin-anlegen.mjs an.
// Alle Fehlertexte kommen aus texte/hu.json (siehe texte.mjs).
import express from 'express';
import {adminErlaubt,adminListeAktiv,adminGesperrt,adminFehlversuch,adminSperrversuch,protokoll,alarmVersenden,maskEmail} from './admin-zugang.mjs';
import { db, transaktion } from './db.mjs';
import { ereignisHinzufuegen, ereignisseNachCommit } from './ereignis-liste.mjs';
import { fehler, sprache, gueltigeSprache } from './texte.mjs';
import { leseEinwilligungVersion } from './recht-text.mjs';
import { registrierungErlaubt } from './registrierung-limit.mjs';
import {
  passwortHashen, passwortPruefen, DUMMY_HASH, emailPruefen, passwortRegelnPruefen,
  sitzungErzeugen, sitzungBeenden, aktuellerBenutzer, aktuellesToken, cookieSetzen, cookieLoeschen,
  gesperrt, fehlversuchMerken, fehlversucheLoeschen, kontoGesperrt, kontoFehlversuchMerken, anmeldungErfolgreich,
  stepupErzeugen, sitzungInfo,
} from './auth.mjs';

const jetzt = () => new Date().toISOString();

// Schutz vor fremden Webseiten, die dein Cookie für Anfragen "in deinem Namen" nutzen wollen (CSRF):
// Bei allen ändernden Anfragen muss die Herkunft unsere eigene Adresse sein (falls der Browser sie mitschickt).
export function herkunftSchutz(base) {
  return (req, res, next) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && req.path !== '/webhook') {
      const herkunft = req.headers.origin;
      if (herkunft && herkunft !== base) return fehler(res, 403, 'herkunft_fremd');
    }
    next();
  };
}

export function erstelleAuthRouter({ secureCookies = false, maxSitzungen = 3, mails = null } = {}) {
const authRouter = express.Router();

authRouter.post('/api/registrieren', async (req, res) => {
  const email = emailPruefen(req.body?.email);
  const regelFehler = passwortRegelnPruefen(req.body?.passwort);
  if (!email) return fehler(res, 400, 'email_ungueltig');
  if (regelFehler) return fehler(res, 400, regelFehler);
  // Einwilligung (Teilnahmebedingungen und Datenschutz) ist Pflicht und wird mit Zeitpunkt und Textstand am Konto gespeichert.
  if (req.body?.zustimmung !== true) return fehler(res, 400, 'zustimmung_noetig');
  // Rate-Limit je IP und je Zieladresse (F-03), VOR jeder Wartezeit (Hash) gezaehlt: so kommen auch parallele Anfragen nicht ueber die Grenze.
  if (!registrierungErlaubt(req.ip, email)) return fehler(res, 429, 'registrierung_limit');
  try {
    const hash = await passwortHashen(req.body.passwort);
    // Keine Rolle in der Anfrage und keine Umgebungsvariable: neue Konten sind immer "kunde" (Standard der Spalte).
    const benutzerId = transaktion(() => {
      const zeit=jetzt();
      const r=db.prepare('INSERT INTO benutzer (email, passwort_hash, erstellt, einwilligung_zeit, einwilligung_version, sprache) VALUES (?, ?, ?, ?, ?, ?)').run(email, hash, zeit, zeit, leseEinwilligungVersion(), sprache());
      const id=Number(r.lastInsertRowid);
      if(mails?.mailAktiv) mails.emailVormerken(id);
      ereignisHinzufuegen('registriert',String(id),{benutzer_id:id,status:'registriert'});
      return id;
    });
    cookieSetzen(res, sitzungErzeugen(benutzerId, maxSitzungen), secureCookies);
    res.status(201).json({ email });
    ereignisseNachCommit();
    if(mails?.mailAktiv) mails.emailNachCommitSenden();
  } catch (e) {
    // UNIQUE-Verstoß = diese E-Mail gibt es schon. Die Datenbank erzwingt das, nicht erst unser Code.
    if (String(e.message).includes('UNIQUE')) return fehler(res, 409, 'email_vergeben');
    console.error('Registrierung fehlgeschlagen:', e.code || e.name || 'unbekannt'); fehler(res, 500, 'registrierung_fehlgeschlagen');
  }
});

authRouter.post('/api/anmelden', async (req, res) => {
  const email = emailPruefen(req.body?.email);
  const schluessel = `${req.ip}|${email}`;
  if (!email || typeof req.body?.passwort !== 'string') return fehler(res, 400, 'anmeldung_falsch');
  // A3-03: zusaetzlich Kontosperre ueber alle Adressen (verteiltes Raten), siehe auth.mjs.
  if (gesperrt(schluessel)||kontoGesperrt(email,req.ip)||adminGesperrt(req.ip,email)){
    const b=db.prepare('SELECT rolle FROM benutzer WHERE email=?').get(email);
    if(b?.rolle==='admin'){
      if(adminGesperrt(req.ip,email))adminSperrversuch(req.ip,email);
      else protokoll('gesperrt',email,req.ip);
    }
    return fehler(res,429,'zu_viele_versuche');
  }
  const benutzer = db.prepare('SELECT * FROM benutzer WHERE email = ?').get(email);
  // PUNKT-3: IP+E-Mail-Zaehler VOR dem await (Passwort-Hash) inkrementieren und danach nochmals pruefen →
  // verhindert paralleles Durchschluepfen (12 gleichzeitige Anfragen sehen alle count=0 beim ersten Check).
  fehlversuchMerken(schluessel);
  if(gesperrt(schluessel)){
    if(benutzer?.rolle==='admin'){
      if(adminGesperrt(req.ip,email))adminSperrversuch(req.ip,email);
      else protokoll('gesperrt',email,req.ip);
    }
    return fehler(res,429,'zu_viele_versuche');
  }
  // Auch bei unbekannter E-Mail rechnen wir ein Passwort durch, damit man an der Antwortzeit nicht erkennt, ob es das Konto gibt.
  let richtig;
  try { richtig = benutzer ? await passwortPruefen(req.body.passwort, benutzer.passwort_hash) : (await passwortPruefen(req.body.passwort, DUMMY_HASH), false); }
  catch (e) { if (e && e.message === 'scrypt_ueberlastet') return fehler(res, 429, 'zu_viele_versuche'); throw e; }
  if (!richtig) {
    kontoFehlversuchMerken(email);
    if(benutzer?.rolle==='admin'||(adminListeAktiv()&&adminErlaubt(email)))adminFehlversuch(req.ip,email);
    return fehler(res, 401, 'anmeldung_falsch');
  }
  if(benutzer.rolle==='admin'&&!adminErlaubt(email)){
    protokoll('nicht_erlaubt',email,req.ip);void alarmVersenden('nicht_erlaubt');
    return fehler(res,403,'kein_admin');
  }
  if(benutzer.rolle==='admin'){
    const last=db.prepare("SELECT zeit FROM admin_login_protokoll WHERE ergebnis='ok' AND email_maskiert=? ORDER BY id DESC LIMIT 1").get(maskEmail(email));
    if(last&&Date.now()-Date.parse(last.zeit)>30*86400000)void alarmVersenden('lange_pause');
    protokoll('ok',email,req.ip);
  }
  fehlversucheLoeschen(schluessel);
  anmeldungErfolgreich(email, req.ip);
  // F-116: altes Hash-Format (3 Teile, N=16384) im Hintergrund auf neues Format aktualisieren
  if (benutzer.passwort_hash.split('$').length === 3)
    void passwortHashen(req.body.passwort).then(h => { try { db.prepare('UPDATE benutzer SET passwort_hash=? WHERE id=? AND passwort_hash=?').run(h, benutzer.id, benutzer.passwort_hash); } catch {} }).catch(() => {});
  cookieSetzen(res, sitzungErzeugen(benutzer.id, maxSitzungen), secureCookies);
  // Konto vor Cookie: die gespeicherte Kontosprache wird beim Login zur aktiven Sprache.
  if (gueltigeSprache(benutzer.sprache)) res.append('Set-Cookie', 'lang=' + benutzer.sprache + '; Path=/; Max-Age=31536000; SameSite=Lax');
  res.json({ email: benutzer.email });
});

// Sprachwechsel: Cookie setzen und, wenn angemeldet, im Konto merken.
authRouter.post('/api/sprache', (req, res) => {
  const l = gueltigeSprache(req.body?.sprache);
  if (!l) return fehler(res, 400, 'sprache_ungueltig');
  res.append('Set-Cookie', 'lang=' + l + '; Path=/; Max-Age=31536000; SameSite=Lax');
  const b = aktuellerBenutzer(req);
  if (b) db.prepare('UPDATE benutzer SET sprache=? WHERE id=?').run(l, b.id);
  res.json({ sprache: l });
});

authRouter.post('/api/abmelden', (req, res) => {
  sitzungBeenden(aktuellesToken(req));
  cookieLoeschen(res, secureCookies);
  res.json({ ok: true });
});

authRouter.get('/api/ich', (req, res) => {
  const b = aktuellerBenutzer(req);
  res.json(b ? { angemeldet: true, email: b.email, rolle: b.rolle, email_bestaetigt: b.email_bestaetigt!==null, email_bestaetigung_pflicht:!!mails?.mailAktiv } : { angemeldet: false });
});

authRouter.post('/api/admin/stepup', async (req, res) => {
  const benutzer = aktuellerBenutzer(req);
  if (!benutzer || benutzer.rolle !== 'admin') return fehler(res, 401, 'nicht_angemeldet');
  if (typeof req.body?.passwort !== 'string') return fehler(res, 400, 'body_ungueltig');
  // F-109: Brute-Force-Schutz wie bei Anmeldung (P3-Muster: Zaehler vor Hash).
  const bfSchluessel = `${req.ip}|stepup`;
  if (gesperrt(bfSchluessel)) return fehler(res, 429, 'zu_viele_versuche');
  fehlversuchMerken(bfSchluessel);
  if (gesperrt(bfSchluessel)) return fehler(res, 429, 'zu_viele_versuche');
  const altHash = db.prepare('SELECT passwort_hash FROM benutzer WHERE id=?').get(benutzer.id)?.passwort_hash;
  const richtig = await passwortPruefen(req.body.passwort, altHash);
  if (!richtig) return fehler(res, 403, 'passwort_aktuell_falsch');
  fehlversucheLoeschen(bfSchluessel);
  stepupErzeugen(aktuellesToken(req));
  return res.json({ ok: true });
});

authRouter.get('/api/admin/sitzung-info', (req, res) => {
  // F-111: aktualisieren=false damit der Info-Abruf selbst den Idle-Timer nicht verlaengert.
  const benutzer = aktuellerBenutzer(req, { aktualisieren: false });
  if (!benutzer || benutzer.rolle !== 'admin') return fehler(res, 401, 'nicht_angemeldet');
  const info = sitzungInfo(req);
  if (!info) return fehler(res, 500, 'serverfehler');
  res.setHeader('Cache-Control', 'no-store');
  return res.json(info);
});

return authRouter;
}
