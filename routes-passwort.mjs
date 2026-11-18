// Passwort-Sicherheit: neutrale Antworten, 256-Bit-Einmal-Tokens und keine Daten in Logs.
import express from 'express';
import {adminEntsperrenEmail,protokoll} from './admin-zugang.mjs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { db, transaktion } from './db.mjs';
import { fehler, HU } from './texte.mjs';
import {
  emailPruefen, passwortRegelnPruefen, passwortHashen, passwortPruefen,
  aktuellerBenutzer, aktuellesToken, sitzungFingerabdruck,
  gesperrt, fehlversuchMerken, fehlversucheLoeschen,fehlversucheFuerEmailLoeschen,
} from './auth.mjs';

const FENSTER = 60 * 60 * 1000, DAUER = 30 * 60 * 1000;
const ipAnfragen = new Map(), emailAnfragen = new Map();
const tokenFormat = /^[A-Za-z0-9_-]{43}$/;
const nurFelder = (body, erlaubt) => !!body && typeof body === 'object' &&
  !Array.isArray(body) && Buffer.byteLength(JSON.stringify(body), 'utf8') <= 1024 && Object.keys(body).every(k => erlaubt.includes(k));
const sha = t => createHash('sha256').update(t).digest('hex');
function limit(map, schluessel, maximal) {
  const jetzt = Date.now();
  // Keine unbegrenzte Anzahl gespeicherter IP-/Mail-Hashes unter Missbrauch.
  if (!map.has(schluessel) && map.size >= 10000) {
    for (const [k,v] of map) if (!v.length || jetzt - v[v.length-1] >= FENSTER) map.delete(k);
    if (map.size >= 10000) return false; // neutraler 200 bei vergessen, 429 beim Zurücksetzen
  }
  const bisher = (map.get(schluessel) || []).filter(t => jetzt - t < FENSTER);
  if (bisher.length >= maximal) { map.set(schluessel, bisher); return false; }
  bisher.push(jetzt); map.set(schluessel, bisher);
  return true;
}
async function neutral(res, beginn) {
  // Auch bei unbekannter Adresse bis zum selben Mindest-Zeitfenster warten.
  await new Promise(r => setTimeout(r, Math.max(0, 250 - (Date.now() - beginn))));
  res.setHeader('Cache-Control','no-store');
  return res.status(200).json({ text: HU.passwort_neutral });
}
function cacheNein(_req, res, next) { res.setHeader('Cache-Control','no-store'); next(); }
const dummyHash = Buffer.alloc(32);
const festGleich = (a,b) => timingSafeEqual(a,b);

export function passwortRouter({ base, mailDienst }) {
  const router = express.Router();
  router.use(['/api/passwort-vergessen','/api/passwort-zuruecksetzen','/api/passwort-aendern'],cacheNein);

  router.post('/api/passwort-vergessen', async (req,res) => {
    const beginn = Date.now();
    const ip = sha(String(req.ip || ''));
    const ipOk = limit(ipAnfragen,ip,10);
    // Unbekannte Adressen durchlaufen dieselbe Token-/Hash-Arbeit.
    const token = randomBytes(32).toString('base64url');
    const hash = sha(token);
    const email = nurFelder(req.body,['email']) && typeof req.body.email === 'string'
      ? emailPruefen(req.body.email) : null;
    const emailOk = email ? limit(emailAnfragen,sha(email),3) : false;
    try {
      const benutzer = email ? db.prepare('SELECT id,email FROM benutzer WHERE email=?').get(email) : null;
      if (ipOk && emailOk && benutzer) {
        const jetzt = Date.now();
        transaktion(() => {
          db.prepare('UPDATE passwort_token SET benutzt=? WHERE benutzer_id=? AND benutzt IS NULL')
            .run(jetzt,benutzer.id);
          db.prepare('INSERT INTO passwort_token (benutzer_id,token_hash,erstellt,laeuft_ab) VALUES (?,?,?,?)')
            .run(benutzer.id,hash,jetzt,jetzt+DAUER);
        });
        const link = base + '/#/passwort-neu/' + token;
        mailDienst?.versandStarten('reset',benutzer,{link});
      } else {
        db.prepare('SELECT id FROM passwort_token WHERE token_hash=?').get(hash);
      }
    } catch { console.warn('Passwort-Token konnte nicht verarbeitet werden'); }
    return neutral(res,beginn);
  });

  router.post('/api/passwort-zuruecksetzen', async (req,res) => {
    if (!limit(ipAnfragen,sha(String(req.ip || '')),10)) return fehler(res,429,'passwort_rate');
    if (!nurFelder(req.body,['token','passwort']) || typeof req.body.token !== 'string' ||
        typeof req.body.passwort !== 'string' || !tokenFormat.test(req.body.token))
      return fehler(res,400,'passwort_link_ungueltig');
    const regel = passwortRegelnPruefen(req.body.passwort);
    if (regel) return fehler(res,400,regel);
    const hash = sha(req.body.token);
    const zeile = db.prepare('SELECT id,benutzer_id,token_hash,laeuft_ab,benutzt FROM passwort_token WHERE token_hash=?').get(hash);
    const probe = Buffer.from(zeile?.token_hash || dummyHash.toString('hex'),'hex');
    const istGleich = festGleich(Buffer.from(hash,'hex'),probe);
    if (!zeile || !istGleich || zeile.benutzt !== null || zeile.laeuft_ab <= Date.now())
      return fehler(res,400,'passwort_link_ungueltig');
    const passwortHash = await passwortHashen(req.body.passwort);
    let email;
    try {
      email = transaktion(() => {
        // Race sicher abfangen: nur ein Request darf den Token verbrauchen.
        const aktualisiert = db.prepare('UPDATE passwort_token SET benutzt=? WHERE id=? AND benutzt IS NULL AND laeuft_ab>?')
          .run(Date.now(),zeile.id,Date.now());
        if (aktualisiert.changes !== 1) return null;
        db.prepare('UPDATE benutzer SET passwort_hash=?,email_bestaetigt=COALESCE(email_bestaetigt,?) WHERE id=?').run(passwortHash,Date.now(),zeile.benutzer_id);
        db.prepare('UPDATE email_token SET benutzt=? WHERE benutzer_id=? AND benutzt IS NULL').run(Date.now(),zeile.benutzer_id);
        db.prepare("UPDATE email_ausgang SET status='gesendet',geaendert=? WHERE benutzer_id=?").run(Date.now(),zeile.benutzer_id);
        db.prepare('UPDATE passwort_token SET benutzt=? WHERE benutzer_id=? AND benutzt IS NULL').run(Date.now(),zeile.benutzer_id);
        db.prepare('DELETE FROM sitzungen WHERE benutzer_id=?').run(zeile.benutzer_id);
        db.prepare('DELETE FROM email_aender_token WHERE benutzer_id=?').run(zeile.benutzer_id);
        return db.prepare('SELECT email FROM benutzer WHERE id=?').get(zeile.benutzer_id)?.email || null;
      });
    } catch {
      return fehler(res,500,'serverfehler');
    }
    if (!email) return fehler(res,400,'passwort_link_ungueltig');
    adminEntsperrenEmail(email);fehlversucheFuerEmailLoeschen(email);
    if(db.prepare('SELECT rolle FROM benutzer WHERE email=?').get(email)?.rolle==='admin')protokoll('reset',email,req.ip);
    mailDienst?.versandStarten('geaendert',{email});
    return res.json({ text: HU.passwort_zurueck_ok });
  });

  router.post('/api/passwort-aendern', async (req,res) => {
    const benutzer = aktuellerBenutzer(req);
    if (!benutzer) return fehler(res,401,'nicht_angemeldet');
    if (!nurFelder(req.body,['aktuell','neu']) || typeof req.body.aktuell !== 'string' || typeof req.body.neu !== 'string')
      return fehler(res,400,'body_ungueltig');
    const schluessel = String(req.ip) + '|' + benutzer.id + '|passwort';
    if (gesperrt(schluessel)) return fehler(res,429,'zu_viele_versuche');
    const regel = passwortRegelnPruefen(req.body.neu);
    if (regel) return fehler(res,400,regel);
    const altHash = db.prepare('SELECT passwort_hash FROM benutzer WHERE id=?').get(benutzer.id)?.passwort_hash;
    const richtig = await passwortPruefen(req.body.aktuell,altHash);
    if (!richtig) {
      fehlversuchMerken(schluessel);
      return fehler(res,401,'passwort_aktuell_falsch');
    }
    fehlversucheLoeschen(schluessel);
    const hash = await passwortHashen(req.body.neu);
    const sitzung = sitzungFingerabdruck(aktuellesToken(req) || '');
    transaktion(() => {
      db.prepare('UPDATE benutzer SET passwort_hash=? WHERE id=?').run(hash,benutzer.id);
      db.prepare('UPDATE passwort_token SET benutzt=? WHERE benutzer_id=? AND benutzt IS NULL').run(Date.now(),benutzer.id);
      db.prepare('DELETE FROM sitzungen WHERE benutzer_id=? AND token_hash<>?').run(benutzer.id,sitzung);
      db.prepare('DELETE FROM email_aender_token WHERE benutzer_id=?').run(benutzer.id);
    });
    mailDienst?.versandStarten('geaendert',benutzer);
    return res.json({ text: HU.passwort_geaendert_ok });
  });
  return router;
}
