// Schulungsplattform, Scheibe 5: Dateien hochladen (nur Admin) und NUR an Käufer (oder Admin) ausliefern.
//
// Upload:  PUT /api/admin/lektionen/:id/datei   Der Browser schickt den ROHEN Dateiinhalt als Anfrage-Inhalt (kein multer, kein neues Paket).
//          Dateityp = Kopfzeile Content-Type, Dateiname = Kopfzeile X-Dateiname (URL-kodiert, nur zur Anzeige).
// Ablage:  Der Server streamt direkt auf die Platte (nie die ganze Datei im Speicher) in den DATEI_ORDNER, unter einem ZUFÄLLIGEN Namen
//          (UUID). Der Originalname wird nie als Pfad benutzt. In der Datenbank steht nur dieser Zufallsname, nie ein Pfad.
// Prüfung: Obergrenze MAX_UPLOAD_MB, Whitelist der Typen je Lektionstyp UND die ersten Bytes (Magic Bytes) müssen zum Typ passen.
// Ausliefern: GET /api/lektionen/:id/datei prüft BEI JEDEM Aufruf Anmeldung und Zugang, unterstützt HTTP-Range (Teilabrufe).
//          Nie über express.static, nie über eine öffentliche Adresse.
import express from 'express';
import { erstenZugriffMerken } from './erster-zugriff.mjs';
import { createReadStream, createWriteStream, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { stat, unlink, rename } from 'node:fs/promises';
import { once } from 'node:events';
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { db, transaktion } from './db.mjs';
import { vormerken, nachholen } from './bunny-loeschen.mjs';
import { aktuellerBenutzer, aktuellesToken, sitzungFingerabdruck } from './auth.mjs';
import { gueltigerZugang } from './zugang.mjs';
import { fehler, sprache, gueltigeSprache, STANDARD_SPRACHE } from './texte.mjs';
import { downloadDateiname } from './marke.mjs';
import { nurAdmin } from './routes-kurse.mjs';
import { KOPFZEILEN } from './routes-admin-seite.mjs';

const idAus = (wert) => (/^[1-9]\d{0,15}$/.test(String(wert)) ? Number(wert) : null);
const jetzt = () => new Date().toISOString();
const NAME_OK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;   // so sehen unsere Zufallsnamen aus (UUID)
const TEMP_VORSPANN = '.tmp-';
// Einbett-Link-Gueltigkeit (A8-03, 12.11.2026): 15 Minuten statt 2 Stunden. Der Link ist nicht an Nutzer/IP gebunden (Bunny-Token = Schluessel+Video+Ablauf);
// ein weitergegebener oder nach Erstattung/Abo-Ende noch offener Link gilt so hoechstens 15 Minuten. Jedes Oeffnen der Lektion holt einen neuen Link
// (POST /api/lektionen/:id/wiedergabe prueft den Zugang jedes Mal), der Player laedt sofort (kein loading=lazy in kunde.js bunnyAnsicht).
// OFFEN (nur live pruefbar): ob ein geladener Player nach Ablauf weiter abspielt/spult (Bunny-Doku sagt dazu nichts) -> Live-Test vor Deploy.
const BUNNY_LINK_SEKUNDEN = 15 * 60;

// ---- Erlaubte Typen und ihre Magic Bytes ------------------------------------------------------------------------------------
const ist = (b, ab, text) => b.length >= ab + text.length && b.toString('latin1', ab, ab + text.length) === text;
const MAGIC = {
  ftyp: (b) => ist(b, 4, 'ftyp'),                                                                   // MP4 und M4A
  webm: (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  pdf: (b) => ist(b, 0, '%PDF-'),
  mp3: (b) => ist(b, 0, 'ID3') || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0),       // ID3-Kopf oder Frame-Synchronisation
  ogg: (b) => ist(b, 0, 'OggS'),
  zip: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,    // ZIP, DOCX, XLSX
};
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// Je Typ: für welche Lektionsarten erlaubt, welche Magic Bytes, unter welchem Typ gespeichert
const TYPEN = {
  'video/mp4': { arten: ['video'], magic: MAGIC.ftyp, speichern: 'video/mp4' },
  'video/webm': { arten: ['video'], magic: MAGIC.webm, speichern: 'video/webm' },
  'application/pdf': { arten: ['pdf'], magic: MAGIC.pdf, speichern: 'application/pdf' },
  'audio/mpeg': { arten: ['audio'], magic: MAGIC.mp3, speichern: 'audio/mpeg' },
  'audio/mp4': { arten: ['audio'], magic: MAGIC.ftyp, speichern: 'audio/mp4' },
  'audio/x-m4a': { arten: ['audio'], magic: MAGIC.ftyp, speichern: 'audio/mp4' },
  'audio/m4a': { arten: ['audio'], magic: MAGIC.ftyp, speichern: 'audio/mp4' },
  'audio/ogg': { arten: ['audio'], magic: MAGIC.ogg, speichern: 'audio/ogg' },

};
// Meldet der Browser keinen brauchbaren Typ (application/octet-stream), entscheidet die Endung des Dateinamens. Die Magic Bytes prüfen trotzdem.
const ENDUNGEN = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.zip': 'application/zip', '.docx': DOCX, '.xlsx': XLSX };
export const ENDUNGEN_JE_ART = { video: ['.mp4', '.webm'], pdf: ['.pdf'], audio: ['.mp3', '.m4a', '.ogg'], datei: [] };

// ---- Namen -------------------------------------------------------------------------------------------------------------------
// Der Anzeigename dient NUR der Anzeige und dem Namen beim Herunterladen. Er wird nie für einen Pfad benutzt.
export function anzeigeName(roh) {
  let n = String(roh ?? '');
  try { n = decodeURIComponent(n); } catch (e) { /* kein gültiger URL-Text: so lassen */ }
  n = n.split(/[\\/]/).pop();                                   // nur der letzte Teil (kein Verzeichnis)
  n = n.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>:"|?*]/g, '').trim();   // Steuerzeichen und Sonderzeichen entfernen
  n = n.replace(/^\.+/, '');                                    // keine führenden Punkte
  n = Array.from(n).slice(0, 200).join('');
  return n || 'fajl';
}

// ---- Teilabrufe (Range) -------------------------------------------------------------------------------------------------------------
// Ergebnis: { alle: true } (ganze Datei), { start, end } (ein Teil) oder { ungueltig: true } (-> 416). Unbekannte Einheit: Kopfzeile ignorieren.
export function bereichLesen(kopf, groesse) {
  if (kopf === undefined) return { alle: true };
  const m = /^bytes=(.*)$/i.exec(String(kopf).trim());
  if (!m) return { alle: true };
  const r = /^(\d*)-(\d*)$/.exec(m[1].trim());                  // genau EIN Bereich; mehrere ("0-1,5-6") unterstützen wir nicht
  if (!r || (r[1] === '' && r[2] === '')) return { ungueltig: true };
  let start, end;
  if (r[1] === '') {                                            // "-N": die letzten N Bytes
    const n = Number(r[2]);
    if (!Number.isSafeInteger(n) || n <= 0) return { ungueltig: true };
    start = Math.max(0, groesse - n); end = groesse - 1;
  } else {
    start = Number(r[1]); end = r[2] === '' ? groesse - 1 : Number(r[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || start >= groesse) return { ungueltig: true };
    end = Math.min(end, groesse - 1);
  }
  return { start, end };
}

class UploadFehler extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }
let aktiverDateiOrdner;
export async function dateienNachCommitLoeschen(zeilen) {
  const basis = aktiverDateiOrdner;                                 // gesetzt von dateienRouter (aus konfig.mjs), keine direkte Umgebungsabfrage
  // Lokale Dateien: nur Zeilen mit quelle 'lokal' (bei Bunny-Zeilen ist pfad nur ein Platzhalter und entspricht nie einem Zufallsnamen).
  if (basis) for (const d of zeilen) if (d.quelle !== 'bunny' && NAME_OK.test(d.pfad)) await tolerantLoeschen(join(basis, d.pfad));
  // Bunny-Videos: die Auftraege wurden vorgemerkt (Trigger und vormerken); jetzt bei Bunny loeschen, OHNE auf Bunny zu warten (die Admin-Antwort haengt nie an Bunny).
  void nachholen();
}
const tolerantLoeschen = async (pfad) => { try { await unlink(pfad); } catch (e) { if (e.code !== 'ENOENT') console.warn(`Datei konnte nicht gelöscht werden (${e.code})`); } };

// Streamt den Anfrage-Inhalt in eine Temp-Datei. Prüft unterwegs Größe und Magic Bytes. Bei JEDEM Fehler (auch Abbruch des Browsers)
// wird die Temp-Datei gelöscht. Der Anfrage-Strom wird dabei NICHT zerstört, damit die Antwort noch ankommt.
async function inDateiSchreiben(req, tempPfad, typ, maxBytes) {
  const ziel = createWriteStream(tempPfad, { flags: 'wx' });
  let schreibFehler = null;
  ziel.on('error', (e) => { schreibFehler = e; });
  const geschlossen = new Promise((fertig) => ziel.once('close', fertig));
  let gesamt = 0, kopf = Buffer.alloc(0), kopfGeprueft = false;
  try {
    for await (const stueck of req.iterator({ destroyOnReturn: false })) {
      if (schreibFehler) throw schreibFehler;
      gesamt += stueck.length;
      if (gesamt > maxBytes) throw new UploadFehler('datei_zu_gross', 413);
      if (!kopfGeprueft) {
        kopf = Buffer.concat([kopf, stueck.subarray(0, 16 - kopf.length)]);
        if (kopf.length >= 16) { if (!typ.magic(kopf)) throw new UploadFehler('dateiinhalt_passt_nicht', 400); kopfGeprueft = true; }
      }
      if (!ziel.write(stueck)) await once(ziel, 'drain');       // Rückstau: erst weiterlesen, wenn die Platte nachkommt
    }
    if (gesamt === 0) throw new UploadFehler('datei_leer', 400);
    if (!kopfGeprueft && !typ.magic(kopf)) throw new UploadFehler('dateiinhalt_passt_nicht', 400);   // sehr kurze Datei
    if (schreibFehler) throw schreibFehler;
    ziel.end();
    await geschlossen;
    if (schreibFehler) throw schreibFehler;
    return gesamt;
  } catch (e) {
    ziel.destroy();
    await geschlossen;                                           // erst wenn die Datei zu ist (Windows!), dann löschen
    await tolerantLoeschen(tempPfad);
    throw e;
  }
}

// ---- Router ------------------------------------------------------------------------------------------------------------------
export function dateienRouter({ ordner, maxBytes, wiedergabeSchluessel, bunny = null }) {
  // Im Testbetrieb ohne Umgebungsvariable ein einmaliger, zufälliger Schlüssel je Start.
  const geheimnis = Buffer.from(wiedergabeSchluessel || randomBytes(32).toString('hex'), 'utf8');
  const basis = resolve(ordner);
  aktiverDateiOrdner = basis;
  mkdirSync(basis, { recursive: true });
  // Reste von abgebrochenen Uploads aus einem früheren Lauf wegräumen (nur unsere Temp-Dateien)
  for (const name of readdirSync(basis)) if (name.startsWith(TEMP_VORSPANN)) { try { unlinkSync(join(basis, name)); } catch (e) { /* gesperrt: bleibt bis zum nächsten Start */ } }

  const router = express.Router();

  // Für die Admin-Seite: Größe und Endungen vorab, damit sie zu große oder falsche Dateien gar nicht erst sendet (der Server prüft trotzdem)
  router.get('/api/admin/upload-grenze', nurAdmin, (_req, res) => res.json({ max_bytes: maxBytes, endungen: ENDUNGEN_JE_ART }));

  router.put('/api/admin/lektionen/:id/datei', nurAdmin, async (req, res) => {
    // Bei einer Ablehnung vor dem Lesen des Inhalts wird die Verbindung geschlossen (der Browser soll nicht weiter senden).
    const ablehnen = (status, code) => { res.setHeader('Connection', 'close'); return fehler(res, status, code); };
    const id = idAus(req.params.id);
    if (!id) return ablehnen(400, 'ungueltige_id');
    const lektion = db.prepare('SELECT id, art FROM lektionen WHERE id = ?').get(id);
    if (!lektion) return ablehnen(404, 'nicht_gefunden');
    if (lektion.art === 'text') return ablehnen(400, 'lektion_ohne_datei');

    const name = anzeigeName(req.headers['x-dateiname']);
    let mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!mime || mime === 'application/octet-stream') mime = ENDUNGEN[extname(name).toLowerCase()] || '';
    const typ = Object.hasOwn(TYPEN, mime) ? TYPEN[mime] : null;
    if (!typ || !typ.arten.includes(lektion.art)) return ablehnen(400, 'dateityp_ungueltig');

    if (req.headers['content-length'] !== undefined) {
      const laenge = Number(req.headers['content-length']);
      if (!Number.isSafeInteger(laenge) || laenge < 0) return ablehnen(400, 'body_ungueltig');
      if (laenge === 0) return ablehnen(400, 'datei_leer');
      if (laenge > maxBytes) return ablehnen(413, 'datei_zu_gross');       // schon an der Kopfzeile erkannt: nichts wird gelesen
    }

    const zufallsName = randomUUID();
    const tempPfad = join(basis, TEMP_VORSPANN + randomUUID());
    const endPfad = join(basis, zufallsName);
    let groesse;
    try {
      groesse = await inDateiSchreiben(req, tempPfad, typ, maxBytes);
    } catch (e) {
      if (e instanceof UploadFehler) return ablehnen(e.status, e.code);
      console.warn(`Upload abgebrochen oder fehlgeschlagen (${e.code || e.name || 'unbekannt'})`);
      if (!res.headersSent && !req.destroyed) return ablehnen(500, 'upload_fehlgeschlagen');
      return;                                                                 // Browser ist weg: nichts mehr zu antworten
    }
    try {
      await rename(tempPfad, endPfad);                                        // erst jetzt ist die Datei "da"
      const alt = transaktion(() => {
        db.prepare('DELETE FROM bunny_ausstehend WHERE lektion_id = ? AND uebernommen = 0').run(lektion.id);   // ein neuer lokaler Upload verwirft ein ausstehendes Bunny-Video der Lektion
        const vorher = db.prepare('SELECT id, pfad, quelle, bunny_video_id FROM dateien WHERE lektion_id = ?').get(lektion.id);
        if (vorher) { db.prepare('DELETE FROM dateien WHERE id = ?').run(vorher.id); vormerken([vorher]); }   // ein neuer Upload ersetzt die alte Datei (ein altes Bunny-Video wird mitgeloescht)
        db.prepare('INSERT INTO dateien (lektion_id, name, art, pfad, groesse, mime, erstellt) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(lektion.id, name, lektion.art, zufallsName, groesse, typ.speichern, jetzt());
        return vorher;
      });
      if (alt && alt.quelle !== 'bunny' && NAME_OK.test(alt.pfad)) await tolerantLoeschen(join(basis, alt.pfad));   // alte Datei vom Datenträger entfernen
      void nachholen();                                                        // ein vorgemerktes altes Bunny-Video bei Bunny loeschen (ohne Warten)
      res.status(201).json({ lektion_id: lektion.id, name, art: lektion.art, groesse, mime: typ.speichern });
    } catch (e) {
      console.error(`Datei konnte nicht eingetragen werden (${e.code || e.message})`);
      await tolerantLoeschen(tempPfad); await tolerantLoeschen(endPfad);
      if (!res.headersSent) fehler(res, 500, 'upload_fehlgeschlagen');
    }
  });

  router.delete('/api/admin/lektionen/:id/datei', nurAdmin, async (req, res) => {
    if (req.body !== undefined && (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) return fehler(res, 400, 'body_ungueltig');
    const id = idAus(req.params.id);
    if (!id) return fehler(res, 400, 'ungueltige_id');
    if (!db.prepare('SELECT 1 FROM lektionen WHERE id = ?').get(id)) return fehler(res, 404, 'nicht_gefunden');
    const alt = transaktion(() => {
      // Ein ausstehendes Bunny-Video wird mitverworfen (der Trigger traegt es zum Loeschen ein), sonst ersetzt es spaeter still eine bewusst geloeschte Datei.
      db.prepare('DELETE FROM bunny_ausstehend WHERE lektion_id = ? AND uebernommen = 0').run(id);
      const d = db.prepare('SELECT pfad, quelle, bunny_video_id FROM dateien WHERE lektion_id = ?').get(id);
      if (d) { db.prepare('DELETE FROM dateien WHERE lektion_id = ?').run(id); vormerken([d]); }
      return d;
    });
    void nachholen();
    if (!alt) return fehler(res, 404, 'datei_fehlt');
    await dateienNachCommitLoeschen([alt]);
    res.json({ geloescht: true });
  });

  // Wiedergabe-Ticket: signiert, 6 Stunden gültig, an Sitzung und Lektion gebunden.
  // Schnittstelle für späteren PDF-Canvas-Renderer: dieselbe Ticket-Route kann
  // für Range/PDF-Seitenabrufe wiederverwendet werden.
  const GUELTIG_MS = 6 * 60 * 60 * 1000;
  const BASIS64 = /^[A-Za-z0-9_-]+$/;
  const unterschreiben = (daten) => createHmac('sha256', geheimnis).update(daten).digest('base64url');
  function abspielenErlaubt(benutzer, id) {
    const z = db.prepare(
      'SELECT l.status AS l_status, l.art, k.status AS k_status, k.id AS kurs_id, d.id AS datei_id, d.quelle, d.bunny_video_id, d.bunny_status FROM lektionen l JOIN kurse k ON k.id = l.kurs_id LEFT JOIN dateien d ON d.lektion_id = l.id WHERE l.id = ?'
    ).get(id);
    if (!z) return { code: 'nicht_gefunden', status: 404 };
    if (benutzer.rolle !== 'admin') {
      if (z.l_status !== 'veroeffentlicht' || !['veroeffentlicht','archiviert'].includes(z.k_status)) return { code: 'nicht_gefunden', status: 404 };
      if (!gueltigerZugang(benutzer.id, z.kurs_id)) return { code: 'kein_zugang', status: 403 };
      if (!['video','pdf','audio'].includes(z.art)) return { code: 'datei_nur_pdf', status: 403 };
    }
    if (!z.datei_id) return { code: 'datei_fehlt', status: 404 };
    return { z };
  }
  router.post('/api/lektionen/:id/wiedergabe', (req, res) => {
    if (Object.keys(req.query || {}).length) return fehler(res, 400, 'unbekanntes_feld');
    const benutzer = aktuellerBenutzer(req);
    if (!benutzer) return fehler(res, 401, 'nicht_angemeldet');
    const id = idAus(req.params.id);
    if (!id) return fehler(res, 400, 'ungueltige_id');
    if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) return fehler(res, 400, 'body_ungueltig');
    const berechtigung = abspielenErlaubt(benutzer, id);
    if (!berechtigung.z) return fehler(res, berechtigung.status, berechtigung.code);
    const sitzung = aktuellesToken(req);
    if (!sitzung) return fehler(res, 401, 'nicht_angemeldet');
    // Bunny-Video (docs/BUNNY-STREAM-PLAN.md Schritt 5): GLEICHE Zugangspruefung wie oben (abspielenErlaubt), dann statt Ticket ein signierter Einbett-Link.
    // Der Link ist nur fuer diesen einen Abruf gedacht (wird bei jedem Oeffnen der Lektion neu geholt) und laeuft nach BUNNY_LINK_SEKUNDEN ab.
    if (berechtigung.z.quelle === 'bunny') {
      if (berechtigung.z.art !== 'video') return fehler(res, 403, 'datei_nur_pdf');
      if (!bunny || !bunny.an) return fehler(res, 503, 'bunny_aus');
      if (berechtigung.z.bunny_status !== 'fertig') return fehler(res, 409, 'bunny_nicht_fertig');
      let link;
      try { link = bunny.einbettLink(berechtigung.z.bunny_video_id, BUNNY_LINK_SEKUNDEN, { autoplay: false }); }
      catch (e) { console.warn(`Bunny: Einbett-Link nicht erzeugt (${e?.code || e?.name || 'Fehler'})`); return fehler(res, 502, 'bunny_anfrage_fehlgeschlagen'); }
      res.setHeader('Cache-Control', 'no-store');
      erstenZugriffMerken(benutzer, berechtigung.z.kurs_id);
      return res.json({ art: 'bunny', einbett_url: link.url, ablauf: link.ablauf * 1000, email: benutzer.email });
    }
    const ablauf = Date.now() + GUELTIG_MS;
    const payload = Buffer.from(JSON.stringify([benutzer.id, id, sitzungFingerabdruck(sitzung), ablauf])).toString('base64url');
    const ticket = payload + '.' + unterschreiben(payload);
    res.setHeader('Cache-Control', 'no-store');
    erstenZugriffMerken(benutzer,berechtigung.z.kurs_id);
    return res.json({ ticket, ablauf, email: benutzer.email });
  });
  function ticketGueltig(req, benutzer, id) {
    const t = req.query?.ticket;
    if (typeof t !== 'string' || t.length > 2048) return false;
    const teile = t.split('.');
    if (teile.length !== 2 || teile[0].length > 1700 || !BASIS64.test(teile[0]) || !BASIS64.test(teile[1])) return false;
    const erwartet = Buffer.from(unterschreiben(teile[0]));
    const erhalten = Buffer.from(teile[1]);
    if (erwartet.length !== erhalten.length || !timingSafeEqual(erwartet, erhalten)) return false;
    try {
      const [uid, lid, sitzungHash, ablauf] = JSON.parse(Buffer.from(teile[0], 'base64url').toString('utf8'));
      return uid === benutzer.id && lid === id && sitzungHash === sitzungFingerabdruck(aktuellesToken(req) || '') &&
        Number.isSafeInteger(ablauf) && ablauf > Date.now() && ablauf <= Date.now() + GUELTIG_MS;
    } catch { return false; }
  }

  // ---- Ausliefern ------------------------------------------------------------------------------------------------------------
  router.get('/api/lektionen/:id/datei', async (req, res) => {
    if (Object.keys(req.query || {}).some(k => k !== 'ticket')) return fehler(res, 400, 'unbekanntes_feld');
    const benutzer = aktuellerBenutzer(req);                       // wer fragt? Bei JEDEM Aufruf neu geprüft
    if (!benutzer) return fehler(res, 401, 'nicht_angemeldet');
    const id = idAus(req.params.id);
    if (!id) return fehler(res, 400, 'ungueltige_id');
    const z = db.prepare(
      `SELECT l.status AS l_status, l.kurs_id, k.status AS k_status, d.id AS datei_id, d.name, d.art, d.pfad, d.mime, d.quelle
       FROM lektionen l JOIN kurse k ON k.id = l.kurs_id LEFT JOIN dateien d ON d.lektion_id = l.id WHERE l.id = ?`
    ).get(id);
    if (!z) return fehler(res, 404, 'nicht_gefunden');
    if (benutzer.rolle !== 'admin') {
      // Unveröffentlichtes gibt es für Kunden nicht (404, auch mit Zugang); ohne Zugang zum Kurs: 403
      if (z.l_status !== 'veroeffentlicht' || !['veroeffentlicht', 'archiviert'].includes(z.k_status)) return fehler(res, 404, 'nicht_gefunden');
      if (!gueltigerZugang(benutzer.id, z.kurs_id)) return fehler(res, 403, 'kein_zugang');   // zentrale Prüfung mit Ablaufdatum (Abo), bei JEDER Anfrage
    }
    if (benutzer.rolle !== 'admin' && (z.art === 'datei' || !['video','pdf','audio'].includes(z.art))) return fehler(res, 403, 'datei_nur_pdf');
    if (!z.datei_id || z.quelle === 'bunny' || !NAME_OK.test(z.pfad)) return fehler(res, 404, 'datei_fehlt');   // Bunny-Videos werden NIE ueber diese Route ausgeliefert (nur per Einbett-Link)
    if (!ticketGueltig(req, benutzer, id)) return fehler(res, 403, 'wiedergabe_ticket_ungueltig');
    const pfad = join(basis, z.pfad);
    let groesse;
    try { groesse = (await stat(pfad)).size; } catch (e) { console.error(`Datei zu Lektion ${id} fehlt auf dem Datenträger (${e.code})`); return fehler(res, 404, 'datei_fehlt'); }

    const bereich = bereichLesen(req.headers.range, groesse);
    if (bereich.ungueltig) { res.setHeader('Content-Range', `bytes */${groesse}`); return fehler(res, 416, 'bereich_ungueltig'); }

    res.setHeader('Content-Type', z.mime);                         // aus der Datenbank, nie aus dem Namen erraten
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const teil = !bereich.alle;
    const start = teil ? bereich.start : 0, end = teil ? bereich.end : groesse - 1;
    res.status(teil ? 206 : 200);
    if (teil) res.setHeader('Content-Range', `bytes ${start}-${end}/${groesse}`);
    res.setHeader('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') return res.end();
    const strom = createReadStream(pfad, { start, end });
    strom.once('error', (e) => { console.error(`Lesefehler bei Lektion ${id} (${e.code})`); res.destroy(); });
    res.once('close', () => strom.destroy());                      // Browser weg: Datei sofort freigeben
    strom.pipe(res);
  });

  // ---- Geschuetzter Download (Block 3, 12.11.2026) ----------------------------------------------------------------------------
  // Eng begrenzte AUSNAHME von "nur Ansicht": NUR Lektionen mit download_erlaubt = 1 (Standard 0; kein Admin-Weg setzt es, nur der Demo-Seed fuer das Handbuch).
  // Pruefung wie beim Lektionszugriff: angemeldet, Lektion gehoert zu genau diesem Kurs, fuer Kunden veroeffentlicht und JETZT gueltiger Zugang (gueltigerZugang,
  // auch Abo-Ablauf); Admin darf (Vorschau). Flag aus -> 404 wie eine unbekannte Lektion (nichts aufdeckbar). Keine Datei-URL: die Datei kommt nur ueber diese Route
  // aus dem DATEI_ORDNER unter ihrem Zufallsnamen (UUID-Pruefung, kein Pfad aus der Anfrage). Sprache: die der Bestellung (bestellungen.sprache), ohne Bestellung die
  // des Kontos bzw. die Standardsprache; Admin: Sprache der Anfrage. Fehlt diese Sprachfassung (Zeile oder Datei), dann Deutsch, dann die normale Lektionsdatei.
  // Ein VOLLSTAENDIG gesendeter Download zaehlt als erster Zugriff (Widerruf) und wird in download_protokoll eingetragen.
  const DOWNLOAD_MIME = new Set(Object.values(TYPEN).map((t) => t.speichern));
  const DOWNLOAD_ENDUNG = { 'application/pdf': '.pdf', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg' };
  router.get('/api/kurse/:id/lektionen/:lid/download', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (Object.keys(req.query || {}).length) return fehler(res, 400, 'unbekanntes_feld');
    const benutzer = aktuellerBenutzer(req);
    if (!benutzer) return fehler(res, 401, 'nicht_angemeldet');
    const kursId = idAus(req.params.id), lid = idAus(req.params.lid);
    if (!kursId || !lid) return fehler(res, 400, 'ungueltige_id');
    const istAdmin = benutzer.rolle === 'admin';
    const z = db.prepare('SELECT l.status AS l_status, l.download_erlaubt, k.status AS k_status FROM lektionen l JOIN kurse k ON k.id = l.kurs_id WHERE l.id = ? AND l.kurs_id = ?').get(lid, kursId);
    if (!z) return fehler(res, 404, 'nicht_gefunden');
    if (!istAdmin) {
      if (z.l_status !== 'veroeffentlicht' || !['veroeffentlicht', 'archiviert'].includes(z.k_status)) return fehler(res, 404, 'nicht_gefunden');
      if (!gueltigerZugang(benutzer.id, kursId)) return fehler(res, 403, 'kein_zugang');
    }
    if (z.download_erlaubt !== 1) return fehler(res, 404, 'nicht_gefunden');
    let gewuenscht;
    if (istAdmin) gewuenscht = sprache();
    else {
      const b = db.prepare("SELECT sprache FROM bestellungen WHERE benutzer_id = ? AND kurs_id = ? ORDER BY (status = 'bezahlt') DESC, id DESC LIMIT 1").get(benutzer.id, kursId);
      gewuenscht = b ? (gueltigeSprache(b.sprache) ?? STANDARD_SPRACHE)
        : (gueltigeSprache(db.prepare('SELECT sprache FROM benutzer WHERE id = ?').get(benutzer.id)?.sprache) ?? STANDARD_SPRACHE);
    }
    const variante = db.prepare('SELECT sprache, name, pfad, mime FROM download_varianten WHERE lektion_id = ? AND sprache = ?');
    const kandidaten = [variante.get(lid, gewuenscht), gewuenscht !== 'de' ? variante.get(lid, 'de') : null,
      db.prepare("SELECT NULL AS sprache, name, pfad, mime FROM dateien WHERE lektion_id = ? AND quelle = 'lokal'").get(lid)].filter(Boolean);
    let datei = null, groesse = 0;
    for (const k of kandidaten) {
      if (!NAME_OK.test(k.pfad) || !DOWNLOAD_MIME.has(k.mime)) continue;
      try { const s = await stat(join(basis, k.pfad)); if (s.isFile()) { datei = k; groesse = s.size; break; } }
      catch (e) { console.warn(`Download-Datei zu Lektion ${lid} fehlt auf dem Datenträger (${e.code})`); }
    }
    if (!datei) return fehler(res, 404, 'datei_fehlt');
    const dateiname = downloadDateiname(datei.name, DOWNLOAD_ENDUNG[datei.mime] || '');
    res.status(200);
    res.setHeader('Content-Type', datei.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${dateiname}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Length', String(groesse));
    if (req.method === 'HEAD') return res.end();
    res.once('finish', () => {
      if (istAdmin) return;
      erstenZugriffMerken(benutzer, kursId);
      try { db.prepare('INSERT INTO download_protokoll (benutzer_id, kurs_id, lektion_id, sprache, zeit) VALUES (?, ?, ?, ?, ?)').run(benutzer.id, kursId, lid, datei.sprache, jetzt()); }
      catch { console.warn('Download konnte nicht protokolliert werden'); }
    });
    const strom = createReadStream(join(basis, datei.pfad));
    strom.once('error', (e) => { console.error(`Lesefehler beim Download zu Lektion ${lid} (${e.code})`); res.destroy(); });
    res.once('close', () => strom.destroy());
    strom.pipe(res);
  });

  return router;
}
