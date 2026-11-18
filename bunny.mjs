// Bunny Stream (Video-Hosting), docs/BUNNY-STREAM-PLAN.md Schritt 3.
// Dieses Modul spricht NUR mit Bunny und kennt weder Datenbank noch Zugangsregeln. Wer ein Video sehen darf, entscheidet die Plattform
// (dateien.mjs), nicht dieses Modul. fetch ist austauschbar, damit Tests nie echtes Bunny brauchen.
// Schluessel erscheinen nie in Fehlertexten oder Logs; BunnyFehler traegt nur einen Code und den HTTP-Status.
import { createHash } from 'node:crypto';

export const API_HOST = 'https://video.bunnycdn.com';
export const PLAYER_HOST = 'https://player.mediadelivery.net';
export const TUS_URL = 'https://video.bunnycdn.com/tusupload';
const VIDEO_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ZEITLIMIT_MS = 15000;
const EINBETT_OPTIONEN = ['autoplay', 'preload', 'muted', 'loop', 'rememberPosition', 'showSpeed'];   // Wahrheitswert-Parameter laut Bunny-Doku (stream/embedding)
const MAX_TITEL = 200;

// Bunny-Statuszahlen (Quelle: Bunny-Doku, beim Live-Test gegenpruefen). Unbekannte Zahlen werden "unbekannt", nie geraten.
const STATUS = { 0: 'erstellt', 1: 'hochgeladen', 2: 'verarbeitet', 3: 'umgerechnet', 4: 'fertig', 5: 'fehler', 6: 'upload_fehler', 7: 'segmente', 8: 'playlist' };

export class BunnyFehler extends Error {
  constructor(code, status = 0) { super(code); this.name = 'BunnyFehler'; this.code = code; this.status = status; }
}

export const videoIdGueltig = (id) => typeof id === 'string' && VIDEO_ID.test(id);
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// cfg = konfig.bunnyStream (null = Bunny aus). Bei "aus" wirft jede Funktion BunnyFehler('bunny_aus') und es geht nie eine Anfrage raus.
export function erstelleBunny(cfg, { fetchFn = globalThis.fetch, jetzt = () => Date.now() } = {}) {
  const an = !!cfg;
  const pruefeAn = () => { if (!an) throw new BunnyFehler('bunny_aus'); };
  const pruefeId = (id) => { if (!videoIdGueltig(id)) throw new BunnyFehler('bunny_video_id_ungueltig'); };
  // Einbett-Link: 1 Minute bis 7 Tage. Upload-Signatur: 1 bis 24 Stunden (Bunny empfiehlt mindestens 1 Stunde; laenger als ein Tag gibt es nie einen Grund).
  const sekunden = (gueltigSek, min = 60, max = 7 * 24 * 3600) => {
    if (!Number.isSafeInteger(gueltigSek) || gueltigSek < min || gueltigSek > max) throw new BunnyFehler('bunny_gueltigkeit_ungueltig');
    return Math.floor(jetzt() / 1000) + gueltigSek;
  };

  async function anfrage(methode, pfad, body) {
    pruefeAn();
    let antwort;
    try {
      antwort = await fetchFn(API_HOST + `/library/${cfg.bibliothek}` + pfad, {
        method: methode,
        headers: { AccessKey: cfg.apiKey, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(ZEITLIMIT_MS),
      });
    } catch (e) {
      // Netzwerk- oder Zeitfehler: nur den Fehlernamen weitergeben, nie die Meldung (koennte Adresse oder Kopfzeilen enthalten).
      throw new BunnyFehler(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'bunny_zeitlimit' : 'bunny_netzwerk');
    }
    return antwort;
  }
  // Schritt 8 (VIDEO-13): Eine Fehlantwort, deren Inhalt wir nicht lesen, haelt die Verbindung offen, bis sie aufgeraeumt wird. Darum den Inhalt verwerfen.
  // Wirft nie; der Inhalt wird nie gelesen oder geloggt (koennte Details ueber das Konto enthalten).
  const verwerfen = (antwort) => { try { const p = antwort?.body?.cancel?.(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch { /* egal */ } };
  const fehlantwort = (antwort, code = 'bunny_antwort') => { verwerfen(antwort); return new BunnyFehler(code, antwort.status); };

  return {
    an,

    // Legt das Video-Objekt bei Bunny an (noch ohne Datei) und gibt die Video-ID zurueck.
    async videoAnlegen(titel) {
      pruefeAn();
      if (typeof titel !== 'string' || !titel.trim()) throw new BunnyFehler('bunny_titel_ungueltig');
      const antwort = await anfrage('POST', '/videos', { title: titel.trim().slice(0, MAX_TITEL) });
      if (!antwort.ok) throw fehlantwort(antwort);
      let daten; try { daten = await antwort.json(); } catch { throw new BunnyFehler('bunny_antwort', antwort.status); }
      if (!videoIdGueltig(daten?.guid)) throw new BunnyFehler('bunny_antwort', antwort.status);
      return daten.guid;
    },

    // Loescht das Video bei Bunny. "Gibt es nicht mehr" (404) zaehlt als erledigt.
    async videoLoeschen(videoId) {
      pruefeAn(); pruefeId(videoId);
      const antwort = await anfrage('DELETE', `/videos/${videoId}`);
      if (antwort.status === 404) { verwerfen(antwort); return { geloescht: false, schonWeg: true }; }
      if (!antwort.ok) throw fehlantwort(antwort);
      verwerfen(antwort);
      return { geloescht: true, schonWeg: false };
    },

    // Schritt 8 (VIDEO-11): Alle Videos der Bibliothek (Bunny-Doku: GET /library/{id}/videos?page=&itemsPerPage=, Antwort totalItems + items mit guid, title, status).
    // Nur fuer den Abgleich Bibliothek gegen Datenbank; hoechstens maxSeiten Seiten, damit eine kaputte Antwort nie endlos laeuft.
    async alleVideos(maxSeiten = 20) {
      pruefeAn();
      const videos = [];
      let gesamt = 0;
      for (let seite = 1; seite <= maxSeiten; seite++) {
        const antwort = await anfrage('GET', `/videos?page=${seite}&itemsPerPage=100&orderBy=date`);
        if (!antwort.ok) throw fehlantwort(antwort);
        let d; try { d = await antwort.json(); } catch { throw new BunnyFehler('bunny_antwort', antwort.status); }
        const items = Array.isArray(d?.items) ? d.items : [];
        gesamt = Number.isSafeInteger(d?.totalItems) && d.totalItems >= 0 ? d.totalItems : videos.length + items.length;
        for (const v of items) if (videoIdGueltig(v?.guid)) videos.push({ id: v.guid, titel: typeof v.title === 'string' ? v.title.slice(0, MAX_TITEL) : '', status: STATUS[v?.status] || 'unbekannt' });
        if (items.length < 100 || videos.length >= gesamt) break;
      }
      return { gesamt, videos };
    },

    // Verarbeitungsstand: status = Text (siehe STATUS), laenge = Sekunden, aufloesungen = Liste.
    async videoStatus(videoId) {
      pruefeAn(); pruefeId(videoId);
      const antwort = await anfrage('GET', `/videos/${videoId}`);
      if (antwort.status === 404) throw fehlantwort(antwort, 'bunny_nicht_gefunden');
      if (!antwort.ok) throw fehlantwort(antwort);
      let d; try { d = await antwort.json(); } catch { throw new BunnyFehler('bunny_antwort', antwort.status); }
      const laenge = Number.isFinite(d?.length) && d.length >= 0 ? Math.floor(d.length) : 0;
      const aufloesungen = typeof d?.availableResolutions === 'string' ? d.availableResolutions.split(',').map((s) => s.trim()).filter((s) => /^\d{3,4}p$/.test(s)) : [];
      return { status: STATUS[d?.status] || 'unbekannt', laenge, aufloesungen };
    },

    // Direkt-Upload aus dem Browser (TUS). Signatur = sha256(bibliothek + apiKey + ablauf + videoId); der API-Schluessel selbst verlaesst den Server nie.
    uploadSignieren(videoId, gueltigSek = 6 * 3600) {
      pruefeAn(); pruefeId(videoId);
      const ablauf = sekunden(gueltigSek, 3600, 24 * 3600);
      return {
        url: TUS_URL,
        kopfzeilen: {
          AuthorizationSignature: sha256(cfg.bibliothek + cfg.apiKey + ablauf + videoId),
          AuthorizationExpire: String(ablauf),
          VideoId: videoId,
          LibraryId: cfg.bibliothek,
        },
        ablauf,
      };
    },

    // Geschuetzter Einbett-Link fuer den Player. Token = sha256(tokenKey + videoId + ablauf) (Bunny-Doku: stream-embed-token-authentication).
    // optionen: nur diese in der Bunny-Doku (stream/embedding) genannten Wahrheitswert-Parameter, alles andere wird abgelehnt. Sie gehoeren nicht zum Token.
    einbettLink(videoId, gueltigSek = 6 * 3600, optionen = {}) {
      pruefeAn(); pruefeId(videoId);
      const ablauf = sekunden(gueltigSek);
      const token = sha256(cfg.tokenKey + videoId + ablauf);
      let zusatz = '';
      for (const [name, wert] of Object.entries(optionen || {})) {
        if (!EINBETT_OPTIONEN.includes(name) || typeof wert !== 'boolean') throw new BunnyFehler('bunny_option_ungueltig');
        zusatz += `&${name}=${wert}`;
      }
      return { url: `${PLAYER_HOST}/embed/${cfg.bibliothek}/${videoId}?token=${token}&expires=${ablauf}${zusatz}`, ablauf };
    },
  };
}
