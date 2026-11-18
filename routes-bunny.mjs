// Bunny Stream, Schritt 4: Admin-Routen fuer Videos bei Bunny (nur Admin). Kunden-Wiedergabe kommt in Schritt 5, Oberflaeche in Schritt 6.
//   GET  /api/admin/bunny                        -> { an: true|false }  (ist Bunny eingerichtet?)
//   POST /api/admin/lektionen/:id/bunny-upload   -> legt ein Video bei Bunny an (AUSSTEHEND) und gibt die Upload-Daten fuer den Browser zurueck.
//                                                   Die bisherige Datei der Lektion bleibt UNBERUEHRT, bis das neue Video fertig ist.
//   GET  /api/admin/lektionen/:id/bunny-status   -> Verarbeitungsstand bei Bunny. Meldet Bunny "fertig" und es gibt ein ausstehendes Video, wird es jetzt
//                                                   in die Lektion uebernommen (die alte Datei bzw. das alte Bunny-Video wird dabei ersetzt und geloescht).
// Dieselbe Pruefung laeuft auch von selbst im Hintergrund (bunny-loeschen.mjs, Haken), damit ein fertig hochgeladenes Video auch dann uebernommen wird,
// wenn der Admin den Browser nach dem Upload schliesst. Der API-Schluessel verlaesst den Server nie; der Browser bekommt nur die fertige Upload-Signatur.
import express from 'express';
import { db, transaktion } from './db.mjs';
import { fehler } from './texte.mjs';
import { nurAdmin } from './routes-kurse.mjs';
import { BunnyFehler } from './bunny.mjs';
import { vormerken, nachholen, setzeUebernahmeHaken, auftragsLage } from './bunny-loeschen.mjs';
import { dateienNachCommitLoeschen } from './dateien.mjs';

const idAus = (wert) => (/^[1-9]\d{0,15}$/.test(String(wert)) ? Number(wert) : null);
const jetzt = () => new Date().toISOString();
const leererBody = (b) => b === undefined || (b !== null && typeof b === 'object' && !Array.isArray(b) && Object.keys(b).length === 0);
// Schritt 8 (VIDEO-10): Der Browser meldet Groesse und Typ der Datei VOR dem Anlegen bei Bunny. Beide Felder sind freiwillig (alte Aufrufe ohne Body
// bleiben gueltig), aber wenn sie da sind, muessen sie stimmen: groesse 1..maxBytes, mime leer oder video/... Nichts anderes im Body.
// Gibt null (in Ordnung) oder [status, code] zurueck.
function uploadBodyPruefen(body, maxBytes) {
  if (leererBody(body)) return null;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return [400, 'body_ungueltig'];
  if (Object.keys(body).some((k) => !['groesse', 'mime'].includes(k))) return [400, 'unbekanntes_feld'];
  if (body.groesse !== undefined) {
    if (!Number.isSafeInteger(body.groesse) || body.groesse < 1) return [400, 'bunny_groesse_ungueltig'];
    if (body.groesse > maxBytes) return [413, 'bunny_zu_gross'];
  }
  if (body.mime !== undefined && (typeof body.mime !== 'string' || body.mime.length > 100 || (body.mime !== '' && !/^video\//i.test(body.mime)))) return [400, 'bunny_nur_video'];
  return null;
}
// Status, die ein schon fertiges Video NICHT zuruecksetzen duerfen (VIDEO-13): nur ein echter Fehler darf "fertig" ueberschreiben.
const ENDGUELTIG_SCHLECHT = ['fehler', 'upload_fehler'];

// Kern der Status-Route (auch vom Hintergrund-Haken benutzt). Gibt { fehler: [status, code] } oder { antwort } zurueck; wirft BunnyFehler bei Bunny-Problemen.
export async function bunnyStatusUndUebernahme(bunny, id) {
  const lektion = db.prepare('SELECT id, titel, art FROM lektionen WHERE id = ?').get(id);
  if (!lektion) return { fehler: [404, 'nicht_gefunden'] };
  const ausstehend = db.prepare('SELECT video_id FROM bunny_ausstehend WHERE lektion_id = ? AND uebernommen = 0').get(id);
  const datei = db.prepare("SELECT id, bunny_video_id FROM dateien WHERE lektion_id = ? AND quelle = 'bunny'").get(id);
  const ziel = ausstehend ? ausstehend.video_id : datei?.bunny_video_id;
  if (!ziel) return { fehler: [404, 'bunny_kein_video'] };
  if (!bunny.an) return { fehler: [503, 'bunny_aus'] };

  let st;
  try { st = await bunny.videoStatus(ziel); } catch (e) {
    if (e instanceof BunnyFehler && e.code === 'bunny_nicht_gefunden') {
      // Das Video gibt es bei Bunny nicht mehr: ein ausstehender Eintrag wird verworfen (der Trigger traegt ihn ein; Bunny meldet dann 404 = erledigt).
      if (ausstehend) db.prepare('DELETE FROM bunny_ausstehend WHERE lektion_id = ? AND video_id = ?').run(id, ausstehend.video_id);
      return { fehler: [404, 'bunny_kein_video'] };
    }
    throw e;
  }

  const antwort = (extra) => ({ antwort: { lektion_id: id, status: st.status, ausstehend: false, uebernommen: false, laenge: st.laenge, aufloesungen: st.aufloesungen, ...extra } });
  if (!ausstehend) {                                            // bestehendes Bunny-Video der Lektion: nur Status merken
    // VIDEO-13: Ein fertiges Video bleibt "fertig", auch wenn Bunny voruebergehend etwas anderes meldet (z. B. Nachbearbeitung, unbekannte Zahl);
    // sonst bekaemen Kunden kurzzeitig 409. Nur ein echter Fehler darf es zuruecksetzen.
    // ENDGUELTIG_SCHLECHT ist eine Konstante dieses Moduls (kein Nutzerwert), st.status laeuft als Parameter; COALESCE faengt einen NULL-Status ab.
    db.prepare(`UPDATE dateien SET bunny_status = CASE WHEN bunny_status = 'fertig' AND COALESCE(?, 'unbekannt') NOT IN ('fertig', ${ENDGUELTIG_SCHLECHT.map((s) => `'${s}'`).join(', ')}) THEN bunny_status ELSE COALESCE(?, 'unbekannt') END WHERE id = ?`).run(st.status, st.status, datei.id);
    const gemerkt = db.prepare('SELECT bunny_status FROM dateien WHERE id = ?').get(datei.id)?.bunny_status;
    return { antwort: { lektion_id: id, status: gemerkt ?? st.status, bunny_meldet: st.status, ausstehend: false, uebernommen: false, laenge: st.laenge, aufloesungen: st.aufloesungen } };
  }
  if (st.status !== 'fertig') return antwort({ ausstehend: true });
  if (lektion.art !== 'video') {                                // die Lektion ist inzwischen keine Videolektion mehr: Video verwerfen, nichts anhaengen
    db.prepare('DELETE FROM bunny_ausstehend WHERE lektion_id = ?').run(id);
    return { fehler: [400, 'bunny_nur_video'] };
  }

  // Fertig: jetzt (und erst jetzt) in die Lektion uebernehmen und die alte Datei bzw. das alte Bunny-Video ersetzen.
  let uebernommen = false, alt = null;
  transaktion(() => {
    const noch = db.prepare('SELECT video_id FROM bunny_ausstehend WHERE lektion_id = ? AND video_id = ? AND uebernommen = 0').get(id, ausstehend.video_id);
    if (!noch) return;                                          // ein gleichzeitiger Aufruf war schneller
    alt = db.prepare('SELECT id, pfad, quelle, bunny_video_id FROM dateien WHERE lektion_id = ?').get(id) || null;
    if (alt) { db.prepare('DELETE FROM dateien WHERE id = ?').run(alt.id); vormerken([alt]); }                 // ein altes Bunny-Video wird so (auch per Trigger) zum Loeschen eingetragen
    // pfad ist bei Bunny nur ein Platzhalter (kein Zufallsname, wird nie als Datei gelesen); mime wird bei Bunny-Videos nie ausgeliefert.
    db.prepare("INSERT INTO dateien (lektion_id, name, art, pfad, groesse, mime, erstellt, quelle, bunny_video_id, bunny_status) VALUES (?, ?, 'video', 'bunny', 0, 'application/octet-stream', ?, 'bunny', ?, 'fertig')")
      .run(id, String(lektion.titel).slice(0, 200), jetzt(), ausstehend.video_id);
    db.prepare('UPDATE bunny_ausstehend SET uebernommen = 1 WHERE lektion_id = ?').run(id);
    db.prepare('DELETE FROM bunny_ausstehend WHERE lektion_id = ?').run(id);
    uebernommen = true;
  });
  if (alt) await dateienNachCommitLoeschen([alt]);              // lokale Altdatei loeschen; ein altes Bunny-Video wird ohne Warten bei Bunny geloescht
  return antwort({ uebernommen });
}

export function bunnyRouter({ bunny, maxBytes = 4000 * 1024 * 1024 }) {
  const router = express.Router();
  setzeUebernahmeHaken((lektionId) => bunnyStatusUndUebernahme(bunny, lektionId));   // Hintergrund-Uebernahme (siehe bunny-loeschen.mjs)
  const meldeBunnyFehler = (res, e, aktion) => {
    const code = e instanceof BunnyFehler ? e.code + (e.status ? `:${e.status}` : '') : (e?.name || 'Fehler');
    console.warn(`Bunny: ${aktion} fehlgeschlagen (${code})`);          // nur Code, nie Schluessel oder Antworttext
    if (e instanceof BunnyFehler && e.code === 'bunny_aus') return fehler(res, 503, 'bunny_aus');
    return fehler(res, 502, 'bunny_anfrage_fehlgeschlagen');
  };

  // Schritt 8: zusaetzlich die Groessengrenze (fuer den Browser) und die Lage des Loesch-Auftragsbuchs (VIDEO-11; Video-IDs sind kein Geheimnis, nur Admin).
  router.get('/api/admin/bunny', nurAdmin, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ an: bunny.an, max_bytes: maxBytes, loeschauftraege: auftragsLage() });
  });

  // Schritt 8 (VIDEO-11): Abgleich Bibliothek gegen Datenbank, NUR lesend. verwaist = bei Bunny, aber in keiner Lektion, nicht ausstehend und nicht zum
  // Loeschen vorgemerkt (z. B. Antwort beim Anlegen verloren gegangen); fehlend = in der Datenbank, aber nicht mehr bei Bunny. Es wird nichts geloescht.
  router.get('/api/admin/bunny/abgleich', nurAdmin, async (_req, res) => {
    if (!bunny.an) return fehler(res, 503, 'bunny_aus');
    let bei;
    try { bei = await bunny.alleVideos(); } catch (e) { return meldeBunnyFehler(res, e, 'Bibliothek lesen'); }
    const inLektion = new Map(db.prepare("SELECT lektion_id, bunny_video_id FROM dateien WHERE quelle = 'bunny' AND bunny_video_id IS NOT NULL").all().map((z) => [z.bunny_video_id, z.lektion_id]));
    const ausstehend = new Map(db.prepare('SELECT lektion_id, video_id FROM bunny_ausstehend WHERE uebernommen = 0').all().map((z) => [z.video_id, z.lektion_id]));
    const vorgemerkt = new Set(db.prepare('SELECT video_id FROM bunny_loeschauftraege').all().map((z) => z.video_id));
    const beiBunny = new Set(bei.videos.map((v) => v.id));
    // Konnte nicht die ganze Bibliothek gelesen werden (mehr als 20 Seiten oder Bunny zaehlt anders), ist "fehlend" nicht beurteilbar: dann leer lassen
    // und unvollstaendig melden, statt faelschlich Videos als fehlend auszugeben (Pruefrunde Schritt 8, Fund 2). "verwaist" bleibt gueltig (gelesene Videos).
    const unvollstaendig = bei.videos.length < bei.gesamt;
    const verwaist = bei.videos.filter((v) => !inLektion.has(v.id) && !ausstehend.has(v.id) && !vorgemerkt.has(v.id));
    const fehlend = unvollstaendig ? [] : [...inLektion.entries(), ...ausstehend.entries()].filter(([vid]) => !beiBunny.has(vid)).map(([video_id, lektion_id]) => ({ lektion_id, video_id }));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ bei_bunny: bei.gesamt, gelesen: bei.videos.length, unvollstaendig, in_lektionen: inLektion.size, ausstehend: ausstehend.size, vorgemerkt: vorgemerkt.size, verwaist, fehlend });
  });

  router.post('/api/admin/lektionen/:id/bunny-upload', nurAdmin, async (req, res) => {
    if (Object.keys(req.query || {}).length) return fehler(res, 400, 'unbekanntes_feld');
    const bodyFehler = uploadBodyPruefen(req.body, maxBytes);
    if (bodyFehler) return fehler(res, bodyFehler[0], bodyFehler[1]);
    const id = idAus(req.params.id);
    if (!id) return fehler(res, 400, 'ungueltige_id');
    const lektion = db.prepare('SELECT id, titel, art FROM lektionen WHERE id = ?').get(id);
    if (!lektion) return fehler(res, 404, 'nicht_gefunden');
    if (lektion.art !== 'video') return fehler(res, 400, 'bunny_nur_video');
    if (!bunny.an) return fehler(res, 503, 'bunny_aus');

    let videoId;
    try { videoId = await bunny.videoAnlegen(lektion.titel); } catch (e) { return meldeBunnyFehler(res, e, 'Video anlegen'); }

    try {
      transaktion(() => {
        // Ein frueheres, nie fertig gewordenes ausstehendes Video dieser Lektion wird ersetzt (der Trigger traegt es zum Loeschen ein).
        db.prepare('DELETE FROM bunny_ausstehend WHERE lektion_id = ?').run(lektion.id);
        db.prepare('INSERT INTO bunny_ausstehend (lektion_id, video_id, erstellt) VALUES (?, ?, ?)').run(lektion.id, videoId, jetzt());
      });
    } catch (e) {
      // Datenbank hat abgelehnt: das gerade angelegte Video bei Bunny wieder wegraeumen (Auftragsbuch, falls Bunny gerade nicht antwortet).
      console.error(`Bunny: Video angelegt, aber Eintrag fehlgeschlagen (${e.code || e.message})`);
      try { db.prepare('INSERT OR IGNORE INTO bunny_loeschauftraege (video_id, erstellt) VALUES (?, ?)').run(videoId, jetzt()); } catch { /* Datenbank selbst gestoert: bleibt im Log */ }
      void nachholen();
      return fehler(res, 500, 'upload_fehlgeschlagen');
    }
    void nachholen();                                           // ein ersetztes ausstehendes Video bei Bunny loeschen (ohne Warten)

    let upload;
    try { upload = bunny.uploadSignieren(videoId); } catch (e) { return meldeBunnyFehler(res, e, 'Upload signieren'); }
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ lektion_id: lektion.id, video_id: videoId, ausstehend: true, upload });
  });

  router.get('/api/admin/lektionen/:id/bunny-status', nurAdmin, async (req, res) => {
    if (Object.keys(req.query || {}).length) return fehler(res, 400, 'unbekanntes_feld');
    const id = idAus(req.params.id);
    if (!id) return fehler(res, 400, 'ungueltige_id');
    let r;
    try { r = await bunnyStatusUndUebernahme(bunny, id); } catch (e) { return meldeBunnyFehler(res, e, 'Status lesen'); }
    if (r.fehler) return fehler(res, r.fehler[0], r.fehler[1]);
    res.setHeader('Cache-Control', 'no-store');
    res.json(r.antwort);
  });

  return router;
}
