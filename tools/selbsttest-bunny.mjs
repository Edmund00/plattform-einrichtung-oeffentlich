// Bunny Stream, Schritt 3: Einstellungen (konfig.mjs) und Modul bunny.mjs. Alles mit Attrappen, nie echtes Bunny, nie echte Schluessel.
import './test-sprache.mjs';
import { ladeKonfig, KonfigFehler } from '../konfig.mjs';
import { erstelleBunny, BunnyFehler, videoIdGueltig, API_HOST, PLAYER_HOST, TUS_URL } from '../bunny.mjs';
let ok = 0, fehler = 0;
const pruefe = (name, wert, detail = '') => { wert ? ok++ : fehler++; console.log((wert ? 'OK     ' : 'FEHLER ') + name + (!wert && detail ? ' ' + detail : '')); };

const BIB = '12345', API = 'api-key-test-0001', TOKEN = 'token-key-test-0001', VID = '11111111-2222-3333-4444-555555555555';
const CFG = { bibliothek: BIB, apiKey: API, tokenKey: TOKEN };
const JETZT = 1700000000000;   // feste Uhr: Ablauf bei 3600 s = 1700003600
// Unabhaengig vorab berechnete Pruefwerte (sha256 von bibliothek+apiKey+ablauf+videoId bzw. tokenKey+videoId+ablauf):
const UPLOAD_SIG = 'd703a8a863aca5ba36a923f79f7a4bd044ac7a2de4e498d2ac0c71f0f4588952';
const EMBED_TOKEN = 'cfd083a70fceec805a51aea70c45512706b5f524b78e7e46323da50f416f665c';

// ---- Einstellungen ---------------------------------------------------------------------------------------------------------
const basis = { NODE_ENV: 'test', STRIPE_SECRET_KEY: 'sk_test_platzhalter_nur_fuer_tests', STRIPE_WEBHOOK_SECRET: 'whsec_platzhalter_nur_fuer_tests', BASE_URL: 'http://127.0.0.1:3000' };
const lade = (extra) => { try { return { k: ladeKonfig({ ...basis, ...extra }) }; } catch (e) { return { e }; } };
pruefe('Ohne Bunny-Variablen: bunnyStream ist null (Bunny aus)', lade({}).k?.bunnyStream === null);
const voll = lade({ BUNNY_STREAM_BIBLIOTHEK_ID: BIB, BUNNY_STREAM_API_KEY: API, BUNNY_STREAM_TOKEN_KEY: TOKEN });
pruefe('Alle drei gesetzt: bunnyStream mit Bibliothek, API- und Token-Schluessel', voll.k?.bunnyStream?.bibliothek === BIB && voll.k.bunnyStream.apiKey === API && voll.k.bunnyStream.tokenKey === TOKEN);
pruefe('bunnyStream ist unveraenderlich', Object.isFrozen(voll.k?.bunnyStream));
for (const [name, extra] of [
  ['nur Bibliothek', { BUNNY_STREAM_BIBLIOTHEK_ID: BIB }],
  ['nur API-Schluessel', { BUNNY_STREAM_API_KEY: API }],
  ['nur Token-Schluessel', { BUNNY_STREAM_TOKEN_KEY: TOKEN }],
  ['Bibliothek und API ohne Token', { BUNNY_STREAM_BIBLIOTHEK_ID: BIB, BUNNY_STREAM_API_KEY: API }],
]) {
  const r = lade(extra);
  pruefe(`Unvollstaendig (${name}) bricht den Start ab`, r.e instanceof KonfigFehler && /gemeinsam gesetzt/.test(r.e.message));
}
for (const [name, extra, var_] of [
  ['Bibliothek mit Buchstaben', { BUNNY_STREAM_BIBLIOTHEK_ID: 'abc', BUNNY_STREAM_API_KEY: API, BUNNY_STREAM_TOKEN_KEY: TOKEN }, 'BUNNY_STREAM_BIBLIOTHEK_ID'],
  ['Bibliothek 0', { BUNNY_STREAM_BIBLIOTHEK_ID: '0', BUNNY_STREAM_API_KEY: API, BUNNY_STREAM_TOKEN_KEY: TOKEN }, 'BUNNY_STREAM_BIBLIOTHEK_ID'],
  ['API-Schluessel zu kurz', { BUNNY_STREAM_BIBLIOTHEK_ID: BIB, BUNNY_STREAM_API_KEY: 'kurz', BUNNY_STREAM_TOKEN_KEY: TOKEN }, 'BUNNY_STREAM_API_KEY'],
  ['Token-Schluessel mit Leerzeichen', { BUNNY_STREAM_BIBLIOTHEK_ID: BIB, BUNNY_STREAM_API_KEY: API, BUNNY_STREAM_TOKEN_KEY: 'token key mit leer' }, 'BUNNY_STREAM_TOKEN_KEY'],
]) {
  const r = lade(extra);
  pruefe(`Ungueltig (${name}) bricht den Start ab und nennt nur den Namen`, r.e instanceof KonfigFehler && r.e.message.includes(var_) && !r.e.message.includes(API) && !r.e.message.includes('token key mit leer'));
}
const geheimTest = lade({ BUNNY_STREAM_BIBLIOTHEK_ID: BIB, BUNNY_STREAM_API_KEY: 'geheimer-wert-1234', BUNNY_STREAM_TOKEN_KEY: 'x y z lang genug' });
pruefe('Fehlermeldung enthaelt nie einen Schluesselwert', geheimTest.e instanceof KonfigFehler && !geheimTest.e.message.includes('geheimer-wert-1234'));

// ---- Modul: aus ------------------------------------------------------------------------------------------------------------
let anrufe = [];
const stubFetch = (antwortFn) => async (url, opt) => { anrufe.push({ url, opt }); return antwortFn(url, opt); };
const json = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => obj });
const aus = erstelleBunny(null, { fetchFn: stubFetch(() => json({})) });
pruefe('Bunny aus: an ist false', aus.an === false);
for (const [name, f] of [
  ['videoAnlegen', () => aus.videoAnlegen('Titel')], ['videoLoeschen', () => aus.videoLoeschen(VID)], ['videoStatus', () => aus.videoStatus(VID)],
  ['uploadSignieren', () => aus.uploadSignieren(VID)], ['einbettLink', () => aus.einbettLink(VID)],
]) {
  let code = null; try { await f(); } catch (e) { code = e instanceof BunnyFehler ? e.code : 'anderer Fehler'; }
  pruefe(`Bunny aus: ${name} wirft bunny_aus`, code === 'bunny_aus');
}
pruefe('Bunny aus: es ging keine einzige Anfrage raus', anrufe.length === 0);

// ---- Modul: Signaturen (feste Pruefwerte) ------------------------------------------------------------------------------------
const bunny = erstelleBunny(CFG, { fetchFn: stubFetch(() => json({})), jetzt: () => JETZT });
const up = bunny.uploadSignieren(VID, 3600);
pruefe('Upload-Signatur stimmt mit unabhaengig berechnetem Wert', up.kopfzeilen.AuthorizationSignature === UPLOAD_SIG);
pruefe('Upload: Ablauf, Video-ID, Bibliothek, Adresse', up.kopfzeilen.AuthorizationExpire === '1700003600' && up.kopfzeilen.VideoId === VID && up.kopfzeilen.LibraryId === BIB && up.url === TUS_URL && up.ablauf === 1700003600);
pruefe('Upload-Antwort enthaelt den API-Schluessel nirgends', !JSON.stringify(up).includes(API));
const em = bunny.einbettLink(VID, 3600);
pruefe('Einbett-Token stimmt mit unabhaengig berechnetem Wert', em.url === `${PLAYER_HOST}/embed/${BIB}/${VID}?token=${EMBED_TOKEN}&expires=1700003600`);
pruefe('Einbett-Link enthaelt weder API- noch Token-Schluessel im Klartext', !em.url.includes(API) && !em.url.includes(TOKEN));
pruefe('Standard-Gueltigkeit 6 Stunden', bunny.einbettLink(VID).ablauf === 1700000000 + 6 * 3600 && bunny.uploadSignieren(VID).ablauf === 1700000000 + 6 * 3600);
for (const [name, f] of [
  ['Video-ID kein UUID', () => bunny.einbettLink('../../etc')], ['Video-ID leer', () => bunny.uploadSignieren('')],
  ['Gueltigkeit 10 s (zu kurz)', () => bunny.einbettLink(VID, 10)], ['Gueltigkeit 10 Jahre (zu lang)', () => bunny.einbettLink(VID, 10 * 365 * 86400)],
  ['Gueltigkeit keine Zahl', () => bunny.einbettLink(VID, '3600')],
]) {
  let code = null; try { f(); } catch (e) { code = e instanceof BunnyFehler ? e.code : 'anderer Fehler'; }
  pruefe(`Ungueltige Eingabe (${name}) wird abgelehnt`, /^bunny_(video_id|gueltigkeit)_ungueltig$/.test(code || ''));
}
for (const [name, sek] of [['unter 1 Stunde', 1800], ['ueber 24 Stunden', 25 * 3600], ['7 Tage', 7 * 86400]]) {
  let c = null; try { bunny.uploadSignieren(VID, sek); } catch (e) { c = e.code; }
  pruefe(`Upload-Signatur: Gueltigkeit ${name} wird abgelehnt`, c === 'bunny_gueltigkeit_ungueltig');
}
pruefe('Upload-Signatur: genau 1 Stunde und genau 24 Stunden sind erlaubt', bunny.uploadSignieren(VID, 3600).ablauf === 1700003600 && bunny.uploadSignieren(VID, 24 * 3600).ablauf === 1700000000 + 86400);
pruefe('Einbett-Link darf weiter bis 7 Tage gelten', bunny.einbettLink(VID, 7 * 86400).ablauf === 1700000000 + 7 * 86400);
pruefe('videoIdGueltig: gueltige UUID ja, Pfadtrick/Leer/Zahl nein', videoIdGueltig(VID) && !videoIdGueltig('a/../b') && !videoIdGueltig('') && !videoIdGueltig(12345) && !videoIdGueltig(VID + 'x'));

// ---- Modul: Anfragen --------------------------------------------------------------------------------------------------------
anrufe = [];
const b2 = erstelleBunny(CFG, { fetchFn: stubFetch((url, opt) => {
  if (opt.method === 'POST') return json({ guid: VID, title: 'x' });
  if (opt.method === 'GET') return json({ status: 4, length: 125.7, availableResolutions: '360p,720p,1080p' });
  return json({ success: true });
}) });
const neu = await b2.videoAnlegen('  Mein Video  ');
const a1 = anrufe[0];
pruefe('videoAnlegen: POST an die richtige Adresse mit AccessKey und Titel', neu === VID && a1.opt.method === 'POST' && a1.url === `${API_HOST}/library/${BIB}/videos` && a1.opt.headers.AccessKey === API && JSON.parse(a1.opt.body).title === 'Mein Video');
const st = await b2.videoStatus(VID);
pruefe('videoStatus: fertig, Laenge ganze Sekunden, Aufloesungen als Liste', st.status === 'fertig' && st.laenge === 125 && st.aufloesungen.join() === '360p,720p,1080p' && anrufe[1].opt.method === 'GET' && anrufe[1].url === `${API_HOST}/library/${BIB}/videos/${VID}`);
const del = await b2.videoLoeschen(VID);
pruefe('videoLoeschen: DELETE, geloescht', del.geloescht === true && anrufe[2].opt.method === 'DELETE' && anrufe[2].url === `${API_HOST}/library/${BIB}/videos/${VID}`);
pruefe('Jede Anfrage hat ein Zeitlimit', anrufe.every((a) => a.opt.signal instanceof AbortSignal));

const code = async (f) => { try { await f(); return null; } catch (e) { return e instanceof BunnyFehler ? { code: e.code, status: e.status, text: e.message + JSON.stringify(e) } : { code: 'anderer Fehler: ' + (e?.message || e) }; } };
const mit = (antwortFn) => erstelleBunny(CFG, { fetchFn: stubFetch(antwortFn), jetzt: () => JETZT });
let r;
r = await code(() => mit(() => json({}, 401)).videoAnlegen('x'));
pruefe('Bunny antwortet 401: bunny_antwort mit Status, ohne Schluessel im Fehler', r?.code === 'bunny_antwort' && r.status === 401 && !r.text.includes(API));
r = await code(() => mit(() => json({}, 500)).videoStatus(VID));
pruefe('Bunny antwortet 500: bunny_antwort', r?.code === 'bunny_antwort' && r.status === 500);
r = await code(() => mit(() => json({}, 404)).videoStatus(VID));
pruefe('Status eines unbekannten Videos: bunny_nicht_gefunden', r?.code === 'bunny_nicht_gefunden');
pruefe('Loeschen eines nicht mehr vorhandenen Videos (404) gilt als erledigt', (await mit(() => json({}, 404)).videoLoeschen(VID)).schonWeg === true);
r = await code(() => mit(() => json({}, 500)).videoLoeschen(VID));
pruefe('Loeschen mit Serverfehler (500) wird gemeldet, nicht verschluckt', r?.code === 'bunny_antwort');
r = await code(() => mit(() => json({ guid: '../boese' })).videoAnlegen('x'));
pruefe('Antwort mit ungueltiger Video-ID wird abgelehnt', r?.code === 'bunny_antwort');
r = await code(() => mit(() => ({ ok: true, status: 200, json: async () => { throw new Error('kaputt ' + API); } })).videoAnlegen('x'));
pruefe('Kaputte Antwort (kein JSON) wird abgelehnt, ohne Schluessel im Fehler', r?.code === 'bunny_antwort' && !r.text.includes(API));
r = await code(() => mit(() => { throw Object.assign(new Error('Verbindung zu ' + API + ' abgebrochen'), { name: 'TypeError' }); }).videoAnlegen('x'));
pruefe('Netzwerkfehler: bunny_netzwerk, Meldung nicht weitergegeben (Schluessel nie im Fehler)', r?.code === 'bunny_netzwerk' && !r.text.includes(API));
r = await code(() => mit(() => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }).videoAnlegen('x'));
pruefe('Zeitueberschreitung: bunny_zeitlimit', r?.code === 'bunny_zeitlimit');
const vorher = anrufe.length;
r = await code(() => mit(() => json({})).videoAnlegen('   '));
pruefe('Leerer Titel wird abgelehnt, ohne Anfrage', r?.code === 'bunny_titel_ungueltig' && anrufe.length === vorher);
const vorher2 = anrufe.length;
r = await code(() => mit(() => json({})).videoStatus('../boese'));
pruefe('Ungueltige Video-ID wird abgelehnt, ohne Anfrage', r?.code === 'bunny_video_id_ungueltig' && anrufe.length === vorher2);
const langer = mit((u, o) => json({ guid: VID }));
await langer.videoAnlegen('x'.repeat(500));
pruefe('Sehr langer Titel wird auf 200 Zeichen gekuerzt', JSON.parse(anrufe.at(-1).opt.body).title.length === 200);
const st2 = await mit(() => json({ status: 99, length: -5, availableResolutions: '<script>,720p' })).videoStatus(VID);
pruefe('Unbekannter Status wird "unbekannt", ungueltige Laenge 0, unsaubere Aufloesungen entfernt', st2.status === 'unbekannt' && st2.laenge === 0 && st2.aufloesungen.join() === '720p');

// ---- Schritt 8: Groessengrenze (konfig), Fehlantworten verwerfen, Videoliste fuer den Abgleich ----------------------------------------
pruefe('BUNNY_STREAM_MAX_MB: Standard 4000 MB (mit und ohne Bunny)', voll.k?.bunnyStreamMaxBytes === 4000 * 1024 * 1024 && lade({}).k?.bunnyStreamMaxBytes === 4000 * 1024 * 1024);
pruefe('BUNNY_STREAM_MAX_MB=10 ergibt 10 MB', lade({ BUNNY_STREAM_MAX_MB: '10' }).k?.bunnyStreamMaxBytes === 10 * 1024 * 1024);
for (const w of ['abc', '0', '60000', '1.5', '-5']) { const r8 = lade({ BUNNY_STREAM_MAX_MB: w }); pruefe(`BUNNY_STREAM_MAX_MB=${w} bricht den Start ab und nennt den Namen`, r8.e instanceof KonfigFehler && r8.e.message.includes('BUNNY_STREAM_MAX_MB')); }
const mitKoerper = (obj, status, cancel) => ({ ok: status < 300, status, json: async () => obj, body: { cancel } });
let abgebrochen = 0; const cancel = async () => { abgebrochen++; };
r = await code(() => mit(() => mitKoerper({}, 500, cancel)).videoAnlegen('T'));
pruefe('Fehlantwort (500) beim Anlegen: Inhalt wird verworfen (body.cancel), Code bunny_antwort:500', r?.code === 'bunny_antwort' && r.status === 500 && abgebrochen === 1);
abgebrochen = 0; const weg = await mit(() => mitKoerper({}, 404, cancel)).videoLoeschen(VID);
pruefe('404 beim Loeschen: schonWeg und Inhalt verworfen', weg.schonWeg === true && abgebrochen === 1);
abgebrochen = 0; r = await code(() => mit(() => mitKoerper({}, 404, cancel)).videoStatus(VID));
pruefe('404 beim Status: bunny_nicht_gefunden und Inhalt verworfen', r?.code === 'bunny_nicht_gefunden' && abgebrochen === 1);
abgebrochen = 0; r = await code(() => mit(() => mitKoerper({}, 500, () => { throw new Error('kaputt'); })).videoAnlegen('T'));
pruefe('Ein kaputtes body.cancel aendert den Fehlercode nicht', r?.code === 'bunny_antwort');
const V2 = '22222222-2222-3333-4444-555555555555';
const seite1 = Array.from({ length: 100 }, (_, i) => ({ guid: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, title: 't' + i, status: 4 }));
const liste = mit((u) => u.includes('page=1') ? json({ totalItems: 102, items: seite1 }) : json({ totalItems: 102, items: [{ guid: V2, title: 'x'.repeat(300), status: 7 }, { guid: 'kaputt', title: 'k', status: 4 }] }));
const alle = await liste.alleVideos();
pruefe('alleVideos: zwei Seiten, 101 gueltige Videos, Titel auf 200 gekuerzt, Status 7 = segmente, ungueltige guid uebersprungen', alle.gesamt === 102 && alle.videos.length === 101 && alle.videos[100].id === V2 && alle.videos[100].titel.length === 200 && alle.videos[100].status === 'segmente');
pruefe('alleVideos: AccessKey-Kopfzeile, itemsPerPage=100, zweite Anfrage page=2', anrufe.slice(-2).every((a) => a.url.includes('itemsPerPage=100') && a.opt.headers.AccessKey === API) && anrufe.at(-1).url.includes('page=2'));
const vorher3 = anrufe.length; await mit(() => json({ totalItems: 100000, items: seite1 })).alleVideos(3);
pruefe('alleVideos: hoechstens maxSeiten Anfragen, auch wenn Bunny immer volle Seiten liefert', anrufe.length - vorher3 === 3);
r = await code(() => mit(() => json({}, 500)).alleVideos());
pruefe('alleVideos: Fehlantwort -> bunny_antwort', r?.code === 'bunny_antwort');
r = await code(() => aus.alleVideos());
pruefe('alleVideos bei Bunny aus: bunny_aus ohne Anfrage', r?.code === 'bunny_aus');

console.log('Bunny Stream (Einstellungen und Modul): ' + ok + ' bestanden, ' + fehler + ' fehlgeschlagen');
process.exitCode = fehler ? 1 : 0;
