// Bunny Stream, Schritt 4: Admin-Routen und sicheres Loeschen (Auftragsbuch, ausstehende Videos, Trigger). Echte App, echte Datenbank (temporaer), Bunny nur als Attrappe.
import './test-sprache.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
const ordner = mkdtempSync(join(tmpdir(), 'schulung-bunny-admin-'));
const DATEIEN = join(ordner, 'dateien');
process.env.DB_DATEI = join(ordner, 'test.db');
const PASS = randomBytes(24).toString('hex');
const API = 'api-key-test-0001', TOKEN = 'token-key-test-0001', BIB = '12345';
let ok = 0, fehler = 0;
const pruefe = (name, wert, detail = '') => { wert ? ok++ : fehler++; console.log((wert ? 'OK     ' : 'FEHLER ') + name + (!wert && detail ? ' ' + detail : '')); };
const logs = [];
const alteWarn = console.warn, alteError = console.error;
console.warn = (...a) => { logs.push(a.join(' ')); }; console.error = (...a) => { logs.push(a.join(' ')); };

let db, server;
try {
  ({ db } = await import('../db.mjs'));
  const { passwortHashen } = await import('../auth.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const { erstelleBunny } = await import('../bunny.mjs');
  const { nachholen, offeneAuftraege, setzeBunny } = await import('../bunny-loeschen.mjs');
  const ph = await passwortHashen(PASS);
  const insertUser = (email, rolle = 'kunde') => Number(db.prepare('INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,?,?,?)').run(email, ph, rolle, new Date().toISOString(), Date.now()).lastInsertRowid);
  insertUser('bunny-admin@example.com', 'admin'); insertUser('bunny-kunde@example.com');
  const jetzt = () => new Date().toISOString();
  const neuerKurs = (titel, status = 'entwurf') => Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES (?,'',0,'huf',?,?,?)").run(titel, status, jetzt(), jetzt()).lastInsertRowid);
  const neueLektion = (kurs, titel, art = 'video') => Number(db.prepare('INSERT INTO lektionen(kurs_id,titel,art,erstellt,geaendert) VALUES (?,?,?,?,?)').run(kurs, titel, art, jetzt(), jetzt()).lastInsertRowid);
  const zeile = (lektion) => db.prepare('SELECT * FROM dateien WHERE lektion_id = ?').get(lektion);
  const ausst = (lektion) => db.prepare('SELECT * FROM bunny_ausstehend WHERE lektion_id = ?').get(lektion);
  mkdirSync(DATEIEN, { recursive: true });

  // ---- Bunny-Attrappe: echtes bunny.mjs, aber fetch ist eine Attrappe ------------------------------------------------------------
  const anrufe = []; const modus = { anlegen: 200, loeschen: 200, status: 200, statusNr: 4, halte: null, liste: 200, listeGesamt: null };
  const lebende = new Set();
  const fetchAttrappe = async (url, opt) => {
    anrufe.push({ url, methode: opt.method, kopf: opt.headers, body: opt.body });
    const json = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => obj });
    if (opt.method === 'POST') { if (modus.anlegen !== 200) return json({}, modus.anlegen); const g = randomUUID(); lebende.add(g); return json({ guid: g }); }
    if (opt.method === 'DELETE') { if (modus.halte) await modus.halte; if (modus.loeschen !== 200) return json({}, modus.loeschen); lebende.delete(url.split('/').pop()); return json({ success: true }); }
    if (opt.method === 'GET' && url.includes('/videos?')) return modus.liste === 200 ? json({ totalItems: modus.listeGesamt ?? lebende.size, items: [...lebende].map((g) => ({ guid: g, title: 't', status: 4 })) }) : json({}, modus.liste);   // Videoliste (Abgleich)
    if (opt.method === 'GET') return modus.status === 200 ? json({ status: modus.statusNr, length: 61.9, availableResolutions: '720p,1080p' }) : json({}, modus.status);
    return json({}, 500);
  };
  const bunnyAn = () => erstelleBunny({ bibliothek: BIB, apiKey: API, tokenKey: TOKEN }, { fetchFn: fetchAttrappe });
  const stripe = { webhooks: { constructEvent: (b) => JSON.parse(b.toString()) } };
  const starte = (port, bunny) => new Promise((yes, no) => {
    const s = erstelleServer({ stripe, webhookSecret: 'test', base: `http://127.0.0.1:${port}`, dateiOrdner: DATEIEN, abgleichAutomatik: false, bunny }).listen(port, '127.0.0.1');
    s.once('listening', () => yes(s)); s.once('error', no); s.once('close', () => logs.push('TESTSERVER GESCHLOSSEN ' + new Error().stack.split('\n').filter((z) => /selbsttest|app\.mjs|routes/.test(z)).slice(0, 3).join(' | ')));
  });
  const stoppe = (s) => new Promise((r) => s.close(r));
  function client(base) {
    let cookie = '';
    const anfrage = async (methode, pfad, body, kopf = {}) => {
      const headers = { ...kopf }; if (cookie) headers.Cookie = cookie;
      if (body !== undefined && !Buffer.isBuffer(body)) headers['Content-Type'] = 'application/json';
      const r = await fetch(base + pfad, { method: methode, headers, body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)) });
      const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
      let d = null; try { d = await r.json(); } catch { /* kein JSON */ }
      return { status: r.status, d };
    };
    return { get: (p) => anfrage('GET', p), post: (p, b) => anfrage('POST', p, b ?? {}), del: (p) => anfrage('DELETE', p), put: (p, b, k) => anfrage('PUT', p, b, k), patch: (p, b) => anfrage('PATCH', p, b ?? {}) };
  }
  const anmelden = async (base, email) => { const c = client(base); await c.post('/api/anmelden', { email, passwort: PASS }); return c; };
  const settle = async () => { await nachholen(); await nachholen(); };   // wartet auf den Hintergrund-Lauf des Servers (Routen warten nicht auf Bunny)

  // ======== A) Bunny AUS (keine Einstellungen) ======================================================================================
  server = await starte(4531, null);
  let admin = await anmelden('http://127.0.0.1:4531', 'bunny-admin@example.com');
  const kursA = neuerKurs('A'); const lekA = neueLektion(kursA, 'Video A');
  pruefe('Bunny aus: GET /api/admin/bunny meldet an=false', (await admin.get('/api/admin/bunny')).d?.an === false);
  const aus = await admin.post(`/api/admin/lektionen/${lekA}/bunny-upload`);
  pruefe('Bunny aus: bunny-upload antwortet 503, nichts entsteht', aus.status === 503 && !zeile(lekA) && !ausst(lekA));
  pruefe('Bunny aus: bunny-status ohne Bunny-Video antwortet 404', (await admin.get(`/api/admin/lektionen/${lekA}/bunny-status`)).status === 404);
  pruefe('Bunny aus: Abgleich antwortet 503 bunny_aus, GET /api/admin/bunny meldet an=false mit Lage', (await admin.get('/api/admin/bunny/abgleich')).status === 503 && (await admin.get('/api/admin/bunny')).d?.an === false && (await admin.get('/api/admin/bunny')).d?.loeschauftraege?.offen === 0);
  pruefe('Bunny aus: keine einzige Anfrage ging an Bunny', anrufe.length === 0);
  await stoppe(server);

  // ======== B) Bunny AN ==============================================================================================================
  server = await starte(4532, bunnyAn());
  const BASE = 'http://127.0.0.1:4532';
  admin = await anmelden(BASE, 'bunny-admin@example.com');
  const kunde = await anmelden(BASE, 'bunny-kunde@example.com'); const gast = client(BASE);
  pruefe('GET /api/admin/bunny: Gast 401, Kunde 403, Admin an=true', (await gast.get('/api/admin/bunny')).status === 401 && (await kunde.get('/api/admin/bunny')).status === 403 && (await admin.get('/api/admin/bunny')).d?.an === true);
  const kurs = neuerKurs('Bunny-Kurs'); const lek = neueLektion(kurs, 'Mein Video'); const lekText = neueLektion(kurs, 'Nur Text', 'text');
  pruefe('bunny-upload und bunny-status: Gast 401, Kunde 403', (await gast.post(`/api/admin/lektionen/${lek}/bunny-upload`)).status === 401 && (await kunde.post(`/api/admin/lektionen/${lek}/bunny-upload`)).status === 403 && (await gast.get(`/api/admin/lektionen/${lek}/bunny-status`)).status === 401 && (await kunde.get(`/api/admin/lektionen/${lek}/bunny-status`)).status === 403);
  pruefe('Eingaben: Textlektion 400, unbekannte Lektion 404, ungueltige ID 400, Body 400, Query 400', (await admin.post(`/api/admin/lektionen/${lekText}/bunny-upload`)).status === 400 && (await admin.post('/api/admin/lektionen/99999/bunny-upload')).status === 404 && (await admin.post('/api/admin/lektionen/abc/bunny-upload')).status === 400 && (await admin.post(`/api/admin/lektionen/${lek}/bunny-upload`, { x: 1 })).status === 400 && (await admin.get(`/api/admin/lektionen/${lek}/bunny-status?x=1`)).status === 400);
  pruefe('Bis hierher ging keine Anfrage an Bunny', anrufe.length === 0);

  // ---- Anlegen: AUSSTEHEND, noch keine Datei in der Lektion ----------------------------------------------------------------------
  const neu = await admin.post(`/api/admin/lektionen/${lek}/bunny-upload`);
  const p1 = ausst(lek);
  pruefe('bunny-upload: 201, ausstehend, Upload-Daten (Adresse, Signatur, Video, Bibliothek)', neu.status === 201 && neu.d?.ausstehend === true && neu.d?.video_id === p1?.video_id && neu.d?.upload?.url?.includes('tusupload') && /^[0-9a-f]{64}$/.test(neu.d?.upload?.kopfzeilen?.AuthorizationSignature || '') && neu.d.upload.kopfzeilen.VideoId === neu.d.video_id && neu.d.upload.kopfzeilen.LibraryId === BIB);
  pruefe('Die Lektion hat noch KEINE Datei (erst wenn Bunny "fertig" meldet)', !zeile(lek));
  pruefe('Antwort enthaelt weder API- noch Token-Schluessel', !JSON.stringify(neu.d).includes(API) && !JSON.stringify(neu.d).includes(TOKEN));
  const createCall = anrufe.find((a) => a.methode === 'POST');
  pruefe('Bunny wurde richtig angefragt (Adresse, AccessKey, Titel)', createCall?.url.endsWith(`/library/${BIB}/videos`) && createCall.kopf.AccessKey === API && JSON.parse(createCall.body).title === 'Mein Video');

  // ---- Status: noch in Verarbeitung -> nichts uebernommen; dann fertig -> uebernommen --------------------------------------------
  modus.statusNr = 2; const noch = await admin.get(`/api/admin/lektionen/${lek}/bunny-status`);
  pruefe('Status "verarbeitet": ausstehend, nicht uebernommen, keine Datei', noch.d?.status === 'verarbeitet' && noch.d?.ausstehend === true && noch.d?.uebernommen === false && !zeile(lek) && !!ausst(lek));
  modus.statusNr = 4; const fertig = await admin.get(`/api/admin/lektionen/${lek}/bunny-status`);
  const z1 = zeile(lek);
  pruefe('Status "fertig": uebernommen; Zeile quelle bunny, Platzhalter-Pfad, Status fertig, Lektionstitel', fertig.d?.uebernommen === true && fertig.d?.status === 'fertig' && fertig.d?.laenge === 61 && fertig.d?.aufloesungen?.join() === '720p,1080p' && z1?.quelle === 'bunny' && z1.pfad === 'bunny' && z1.bunny_status === 'fertig' && z1.name === 'Mein Video' && z1.bunny_video_id === p1.video_id);
  pruefe('Ausstehend-Eintrag ist weg, das uebernommene Video wurde NICHT zum Loeschen vorgemerkt', !ausst(lek) && offeneAuftraege().length === 0 && lebende.has(z1.bunny_video_id));
  const nochmalSt = await admin.get(`/api/admin/lektionen/${lek}/bunny-status`);
  pruefe('Status danach: normales Bunny-Video, nicht ausstehend', nochmalSt.d?.ausstehend === false && nochmalSt.d?.uebernommen === false && nochmalSt.d?.status === 'fertig');

  // ---- ABGEBROCHENER Upload: die bisherige Datei bleibt (Fund des Agenten) -----------------------------------------------------
  const erstesVideo = z1.bunny_video_id;
  const abbruch = await admin.post(`/api/admin/lektionen/${lek}/bunny-upload`);
  pruefe('Neuer Upload begonnen, aber nie fertig: bisherige Datei und altes Video bleiben unberuehrt', abbruch.status === 201 && zeile(lek).bunny_video_id === erstesVideo && lebende.has(erstesVideo) && offeneAuftraege().length === 0);
  const ersetzt = await admin.post(`/api/admin/lektionen/${lek}/bunny-upload`);
  await settle();
  pruefe('Zweiter Anlauf ersetzt nur das ausstehende Video: das erste ausstehende wird geloescht, die fertige Datei bleibt', ersetzt.status === 201 && !lebende.has(abbruch.d.video_id) && lebende.has(erstesVideo) && ausst(lek).video_id === ersetzt.d.video_id);
  const tausch = await admin.get(`/api/admin/lektionen/${lek}/bunny-status`);
  await settle();
  pruefe('Fertig gemeldet: neues Video ersetzt das alte, altes Video bei Bunny geloescht, genau eine Zeile', tausch.d?.uebernommen === true && zeile(lek).bunny_video_id === ersetzt.d.video_id && !lebende.has(erstesVideo) && db.prepare('SELECT COUNT(*) n FROM dateien WHERE lektion_id = ?').get(lek).n === 1 && offeneAuftraege().length === 0);

  // ---- Status-Fehler -------------------------------------------------------------------------------------------------------------
  modus.status = 500; const st500 = await admin.get(`/api/admin/lektionen/${lek}/bunny-status`); modus.status = 200;
  pruefe('Bunny-Fehler beim Status: 502, Datenbank unveraendert', st500.status === 502 && zeile(lek).bunny_status === 'fertig');
  // ausstehend + Bunny kennt das Video nicht mehr
  await admin.post(`/api/admin/lektionen/${lek}/bunny-upload`);
  modus.status = 404; const st404 = await admin.get(`/api/admin/lektionen/${lek}/bunny-status`); modus.status = 200; await settle();
  pruefe('Ausstehendes Video bei Bunny verschwunden: 404, Eintrag verworfen, Auftragsbuch danach leer', st404.status === 404 && !ausst(lek) && offeneAuftraege().length === 0);

  // ---- Anlegen scheitert: nichts darf sich aendern -------------------------------------------------------------------------------
  const vorher = JSON.stringify(zeile(lek));
  modus.anlegen = 500; const kaputt = await admin.post(`/api/admin/lektionen/${lek}/bunny-upload`);
  modus.anlegen = 401; const kaputt401 = await admin.post(`/api/admin/lektionen/${lek}/bunny-upload`); modus.anlegen = 200;
  pruefe('Bunny scheitert beim Anlegen (500 und 401): 502, nichts ausstehend, Datei unveraendert', kaputt.status === 502 && kaputt401.status === 502 && !ausst(lek) && JSON.stringify(zeile(lek)) === vorher);

  // ---- Lokal -> Bunny: lokale Datei bleibt bis "fertig" -----------------------------------------------------------------------
  const lekLokal = neueLektion(kurs, 'Lokales Video');
  const lokalerName = randomUUID(); writeFileSync(join(DATEIEN, lokalerName), Buffer.from('xxxxftypisom'));
  db.prepare('INSERT INTO dateien(lektion_id,name,art,pfad,groesse,mime,erstellt) VALUES (?,?,?,?,?,?,?)').run(lekLokal, 'alt.mp4', 'video', lokalerName, 12, 'video/mp4', jetzt());
  await admin.post(`/api/admin/lektionen/${lekLokal}/bunny-upload`);
  pruefe('Lokal -> Bunny, Upload begonnen: lokale Datei und Zeile bleiben unberuehrt', zeile(lekLokal).quelle === 'lokal' && existsSync(join(DATEIEN, lokalerName)));
  const l2b = await admin.get(`/api/admin/lektionen/${lekLokal}/bunny-status`);
  pruefe('Lokal -> Bunny, fertig: Zeile ist Bunny, lokale Datei vom Datentraeger geloescht', l2b.d?.uebernommen === true && zeile(lekLokal).quelle === 'bunny' && !existsSync(join(DATEIEN, lokalerName)));

  // ---- Bunny -> lokal (alter Upload-Weg) ---------------------------------------------------------------------------------------
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), Buffer.from('isom0000isomiso2')]);
  const altesBunny = zeile(lekLokal).bunny_video_id;
  const put = await admin.put(`/api/admin/lektionen/${lekLokal}/datei`, mp4, { 'Content-Type': 'video/mp4', 'X-Dateiname': 'neu.mp4' });
  await settle(); const zl = zeile(lekLokal);
  pruefe('Bunny -> lokaler Upload (PUT): Zeile ist wieder lokal, altes Bunny-Video geloescht', put.status === 201 && zl.quelle === 'lokal' && zl.bunny_video_id === null && !lebende.has(altesBunny) && existsSync(join(DATEIEN, zl.pfad)));

  // ---- Datei loeschen (Bunny) --------------------------------------------------------------------------------------------------
  const fertigeLektion = async (kursId, titel) => { const l = neueLektion(kursId, titel); await admin.post(`/api/admin/lektionen/${l}/bunny-upload`); await admin.get(`/api/admin/lektionen/${l}/bunny-status`); return l; };
  const lekDel = await fertigeLektion(kurs, 'Zum Loeschen');
  const delId = zeile(lekDel).bunny_video_id;
  const del = await admin.del(`/api/admin/lektionen/${lekDel}/datei`); await settle();
  pruefe('Datei loeschen: Antwort geloescht, Zeile weg, Video bei Bunny geloescht', del.status === 200 && del.d?.geloescht === true && !zeile(lekDel) && !lebende.has(delId));

  // ---- Bunny nicht erreichbar beim Loeschen: Auftragsbuch -----------------------------------------------------------------------
  const lekOff = await fertigeLektion(kurs, 'Bunny kaputt');
  const offId = zeile(lekOff).bunny_video_id;
  modus.loeschen = 500; const delOff = await admin.del(`/api/admin/lektionen/${lekOff}/datei`); await settle();
  const auftraege = offeneAuftraege();
  pruefe('Bunny beim Loeschen nicht erreichbar: Admin-Antwort trotzdem 200, Zeile weg, Video im Auftragsbuch mit Fehlercode', delOff.status === 200 && !zeile(lekOff) && auftraege.length === 1 && auftraege[0].video_id === offId && auftraege[0].versuche >= 1 && auftraege[0].letzter_fehler === 'bunny_antwort:500' && lebende.has(offId));
  const v0 = auftraege[0].versuche; await nachholen();
  pruefe('Weiterer Versuch bei kaputtem Bunny: bleibt im Auftragsbuch, Versuche zaehlen hoch', offeneAuftraege().length === 1 && offeneAuftraege()[0].versuche > v0);
  modus.loeschen = 200; const geschafft = await nachholen();
  pruefe('Bunny wieder erreichbar: Auftrag erledigt, Video geloescht, Auftragsbuch leer', geschafft.erledigt === 1 && geschafft.offen === 0 && !lebende.has(offId));

  // ---- Fehlversuche blockieren nichts; 404 gilt als erledigt ---------------------------------------------------------------------
  const haengt = randomUUID(); db.prepare('INSERT INTO bunny_loeschauftraege(video_id,erstellt,versuche) VALUES (?,?,?)').run(haengt, '2000-01-01T00:00:00.000Z', 9);
  const frisch = randomUUID(); lebende.add(frisch); db.prepare('INSERT INTO bunny_loeschauftraege(video_id,erstellt) VALUES (?,?)').run(frisch, jetzt());
  const reihenfolge = db.prepare('SELECT video_id FROM bunny_loeschauftraege ORDER BY versuche, erstellt LIMIT 1').get().video_id;
  pruefe('Auftraege mit vielen Fehlversuchen sinken nach hinten (blockieren neuere nicht)', reihenfolge === frisch);
  await nachholen(); db.prepare('DELETE FROM bunny_loeschauftraege').run();
  const nur404 = erstelleBunny({ bibliothek: BIB, apiKey: API, tokenKey: TOKEN }, { fetchFn: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  db.prepare('INSERT INTO bunny_loeschauftraege(video_id,erstellt) VALUES (?,?)').run(randomUUID(), jetzt());
  setzeBunny(nur404); const r404 = await nachholen();
  pruefe('Video bei Bunny schon weg (404): Auftrag gilt als erledigt', r404.erledigt === 1 && r404.offen === 0);
  setzeBunny(null); db.prepare('INSERT INTO bunny_loeschauftraege(video_id,erstellt) VALUES (?,?)').run(randomUUID(), jetzt());
  const ohne = await nachholen();
  pruefe('Bunny aus: Auftragsbuch bleibt unangetastet', ohne.aus === true && ohne.offen === 1);
  db.prepare('DELETE FROM bunny_loeschauftraege').run();
  setzeBunny(bunnyAn());

  // ---- Gleichzeitig: ein waehrend des Laufs neu vorgemerkter Auftrag geht nicht verloren (Fund 2) -------------------------------
  const a1 = randomUUID(), a2 = randomUUID(); lebende.add(a1); lebende.add(a2);
  db.prepare('INSERT INTO bunny_loeschauftraege(video_id,erstellt) VALUES (?,?)').run(a1, jetzt());
  let losHalte; modus.halte = new Promise((r) => { losHalte = r; });
  const lauf1 = nachholen();
  await new Promise((r) => setTimeout(r, 30));
  db.prepare('INSERT INTO bunny_loeschauftraege(video_id,erstellt) VALUES (?,?)').run(a2, jetzt());
  const lauf2 = nachholen();
  modus.halte = null; losHalte();
  await Promise.all([lauf1, lauf2]);
  pruefe('Waehrend eines laufenden Abarbeitens neu vorgemerkter Auftrag wird im selben Lauf miterledigt', !lebende.has(a1) && !lebende.has(a2) && offeneAuftraege().length === 0);

  // ---- Veraltetes ausstehendes Video wird aufgeraeumt -----------------------------------------------------------------------------
  const lekAlt = neueLektion(kurs, 'Nie fertig'); const altV = randomUUID(); lebende.add(altV);
  db.prepare('INSERT INTO bunny_ausstehend(lektion_id,video_id,erstellt) VALUES (?,?,?)').run(lekAlt, altV, new Date(Date.now() - 4 * 86400000).toISOString());
  modus.statusNr = 2; await settle(); modus.statusNr = 4;       // bei Bunny nie fertig geworden
  pruefe('Ausstehendes Video aelter als 3 Tage und nie fertig: Eintrag entfernt und Video bei Bunny geloescht', !ausst(lekAlt) && !lebende.has(altV) && offeneAuftraege().length === 0);

  // ---- Hintergrund-Uebernahme, Art-Sperre, Verwerfen, Mitloeschen (Funde der Nachpruefung) --------------------------------------
  const kursH = neuerKurs('Hintergrund');
  const lekH = neueLektion(kursH, 'H'); const hv = randomUUID(); lebende.add(hv);
  db.prepare('INSERT INTO bunny_ausstehend(lektion_id,video_id,erstellt) VALUES (?,?,?)').run(lekH, hv, new Date(Date.now() - 10 * 60000).toISOString());
  const lekJ = neueLektion(kursH, 'J'); const jv = randomUUID(); lebende.add(jv);
  db.prepare('INSERT INTO bunny_ausstehend(lektion_id,video_id,erstellt) VALUES (?,?,?)').run(lekJ, jv, jetzt());
  await settle();
  pruefe('Hintergrund: ein fertig gemeldetes Video (aelter als 2 Minuten) wird OHNE Admin-Aufruf uebernommen', zeile(lekH)?.bunny_video_id === hv && zeile(lekH)?.bunny_status === 'fertig' && !ausst(lekH) && lebende.has(hv));
  pruefe('Hintergrund: ein ganz frisches ausstehendes Video wird noch nicht angefasst', !!ausst(lekJ) && !zeile(lekJ));
  const sperre = await admin.patch(`/api/admin/lektionen/${lekJ}`, { art: 'text' });
  pruefe('Art-Sperre: Lektion mit ausstehendem Bunny-Video darf ihre Art nicht wechseln', sperre.status === 400 && db.prepare('SELECT art FROM lektionen WHERE id = ?').get(lekJ).art === 'video');
  // Lektion wird doch zur Textlektion (z. B. direkt in der Datenbank), dann meldet Bunny fertig: nichts wird angehaengt, Video verworfen
  const lekV = neueLektion(kursH, 'V'); const vv = randomUUID(); lebende.add(vv);
  db.prepare('INSERT INTO bunny_ausstehend(lektion_id,video_id,erstellt) VALUES (?,?,?)').run(lekV, vv, jetzt());
  db.prepare("UPDATE lektionen SET art = 'text' WHERE id = ?").run(lekV);
  const verwerfen = await admin.get(`/api/admin/lektionen/${lekV}/bunny-status`); await settle();
  pruefe('Textlektion mit fertigem ausstehendem Video: 400, nichts angehaengt, Video verworfen und bei Bunny geloescht', verwerfen.status === 400 && !zeile(lekV) && !ausst(lekV) && !lebende.has(vv));
  // Datei loeschen verwirft ein ausstehendes Video mit
  const lekQ = neueLektion(kursH, 'Q'); const qv = randomUUID(); lebende.add(qv);
  db.prepare('INSERT INTO bunny_ausstehend(lektion_id,video_id,erstellt) VALUES (?,?,?)').run(lekQ, qv, jetzt());
  const delQ = await admin.del(`/api/admin/lektionen/${lekQ}/datei`); await settle();
  pruefe('Datei loeschen verwirft auch ein ausstehendes Bunny-Video (Antwort 404, da keine Datei da war)', delQ.status === 404 && !ausst(lekQ) && !lebende.has(qv));
  // Neuer lokaler Upload verwirft ein ausstehendes Video mit
  const lekR = neueLektion(kursH, 'R'); const rv = randomUUID(); lebende.add(rv);
  db.prepare('INSERT INTO bunny_ausstehend(lektion_id,video_id,erstellt) VALUES (?,?,?)').run(lekR, rv, jetzt());
  const putR = await admin.put(`/api/admin/lektionen/${lekR}/datei`, Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), Buffer.from('isom0000isomiso2')]), { 'Content-Type': 'video/mp4', 'X-Dateiname': 'r.mp4' }); await settle();
  pruefe('Neuer lokaler Upload verwirft ein ausstehendes Bunny-Video der Lektion', putR.status === 201 && zeile(lekR)?.quelle === 'lokal' && !ausst(lekR) && !lebende.has(rv));

  // ---- Trigger-Netz: auch ohne vormerken() (reines SQL, auch Kaskade) -----------------------------------------------------------
  const kursT = neuerKurs('Trigger'); const lekT = neueLektion(kursT, 'T'); const tv = randomUUID(); lebende.add(tv);
  db.prepare("INSERT INTO dateien(lektion_id,name,art,pfad,groesse,mime,erstellt,quelle,bunny_video_id,bunny_status) VALUES (?,?,?,?,?,?,?,'bunny',?,'fertig')").run(lekT, 't', 'video', 'bunny', 0, 'application/octet-stream', jetzt(), tv);
  const lekT2 = neueLektion(kursT, 'T2'); const tv2 = randomUUID(); lebende.add(tv2);
  db.prepare('INSERT INTO bunny_ausstehend(lektion_id,video_id,erstellt) VALUES (?,?,?)').run(lekT2, tv2, jetzt());
  db.prepare('DELETE FROM kurse WHERE id = ?').run(kursT);                                   // Kaskade: Lektionen, dateien, bunny_ausstehend
  pruefe('Kaskade (Kurs per SQL geloescht): beide Videos stehen im Auftragsbuch', offeneAuftraege().some((a) => a.video_id === tv) && offeneAuftraege().some((a) => a.video_id === tv2));
  await settle();
  pruefe('...und werden bei Bunny geloescht', !lebende.has(tv) && !lebende.has(tv2) && offeneAuftraege().length === 0);
  // uebernommenes Video darf NICHT eingetragen werden (Gegenprobe)
  const lekG = neueLektion(neuerKurs('Gegenprobe'), 'G'); const gv = randomUUID(); lebende.add(gv);
  db.prepare('INSERT INTO bunny_ausstehend(lektion_id,video_id,erstellt,uebernommen) VALUES (?,?,?,1)').run(lekG, gv, jetzt());
  db.prepare('DELETE FROM bunny_ausstehend WHERE lektion_id = ?').run(lekG);
  pruefe('Gegenprobe: ein als uebernommen markierter Eintrag loest KEINEN Loesch-Auftrag aus', offeneAuftraege().length === 0 && lebende.has(gv));

  // ---- Neustart mit Altlast im Auftragsbuch ----------------------------------------------------------------------------------------
  await stoppe(server);
  const rest = randomUUID(); lebende.add(rest); db.prepare('INSERT INTO bunny_loeschauftraege(video_id,erstellt) VALUES (?,?)').run(rest, jetzt());
  server = await starte(4533, bunnyAn());
  for (let i = 0; i < 100 && lebende.has(rest); i++) await new Promise((r) => setTimeout(r, 20));
  pruefe('Beim Serverstart wird ein altes Auftragsbuch automatisch abgearbeitet', !lebende.has(rest) && offeneAuftraege().length === 0);
  admin = await anmelden('http://127.0.0.1:4533', 'bunny-admin@example.com');

  // ---- Gleichzeitig zwei Status-Aufrufe: nur ein Uebernehmen --------------------------------------------------------------------
  const lekP = neueLektion(neuerKurs('Parallel'), 'P'); await admin.post(`/api/admin/lektionen/${lekP}/bunny-upload`);
  const [s1, s2] = await Promise.all([admin.get(`/api/admin/lektionen/${lekP}/bunny-status`), admin.get(`/api/admin/lektionen/${lekP}/bunny-status`)]);
  pruefe('Zwei gleichzeitige Status-Aufrufe bei "fertig": genau eine Uebernahme, genau eine Zeile', [s1, s2].filter((r) => r.d?.uebernommen === true).length === 1 && db.prepare('SELECT COUNT(*) n FROM dateien WHERE lektion_id = ?').get(lekP).n === 1 && offeneAuftraege().length === 0);

  // ---- Lektion / Kurs loeschen (Entwurf) -----------------------------------------------------------------------------------------
  const kursL = neuerKurs('Zum Loeschen');
  const lek1 = await fertigeLektion(kursL, 'L1'); const lek2 = await fertigeLektion(kursL, 'L2'); const lekLokalDel = neueLektion(kursL, 'L3');
  const lekPend = neueLektion(kursL, 'L4'); await admin.post(`/api/admin/lektionen/${lekPend}/bunny-upload`);
  const l1v = zeile(lek1).bunny_video_id, l2v = zeile(lek2).bunny_video_id, l4v = ausst(lekPend).video_id;
  const lokal2 = randomUUID(); writeFileSync(join(DATEIEN, lokal2), Buffer.from('xxxxftyp'));
  db.prepare('INSERT INTO dateien(lektion_id,name,art,pfad,groesse,mime,erstellt) VALUES (?,?,?,?,?,?,?)').run(lekLokalDel, 'l.mp4', 'video', lokal2, 8, 'video/mp4', jetzt());
  const delLek = await admin.del(`/api/admin/lektionen/${lek1}`); await settle();
  pruefe('Lektion loeschen: Bunny-Video der Lektion wird geloescht, die anderen bleiben', delLek.status === 200 && !lebende.has(l1v) && lebende.has(l2v) && lebende.has(l4v));
  const delKurs = await admin.del(`/api/admin/kurse/${kursL}`); await settle();
  pruefe('Kurs loeschen: fertiges UND ausstehendes Bunny-Video geloescht, lokale Datei entfernt', delKurs.status === 200 && !lebende.has(l2v) && !lebende.has(l4v) && !existsSync(join(DATEIEN, lokal2)) && offeneAuftraege().length === 0);

  // ======== Schritt 8: Groessengrenze, Lage des Auftragsbuchs, Abgleich, Alarm, Status nie zurueckstufen, Aufraeumen nur bei an ==========
  const info8 = await admin.get('/api/admin/bunny');
  pruefe('GET /api/admin/bunny (Schritt 8): max_bytes = 4000 MB Standard, loeschauftraege {offen, fehlgeschlagen, aelteste, liste}', info8.d?.max_bytes === 4000 * 1024 * 1024 && info8.d.loeschauftraege?.offen === 0 && info8.d.loeschauftraege.fehlgeschlagen === 0 && info8.d.loeschauftraege.aelteste === null && Array.isArray(info8.d.loeschauftraege.liste));
  const kurs8 = neuerKurs('Schritt 8'); const lek8 = neueLektion(kurs8, 'Gross');
  const vorAnrufe = anrufe.length, vorLebende = lebende.size;
  const zuGross = await admin.post(`/api/admin/lektionen/${lek8}/bunny-upload`, { groesse: 4000 * 1024 * 1024 + 1, mime: 'video/mp4' });
  const null0 = await admin.post(`/api/admin/lektionen/${lek8}/bunny-upload`, { groesse: 0 });
  const pdf = await admin.post(`/api/admin/lektionen/${lek8}/bunny-upload`, { groesse: 10, mime: 'application/pdf' });
  const fremd = await admin.post(`/api/admin/lektionen/${lek8}/bunny-upload`, { groesse: 10, name: 'x' });
  const komisch = await admin.post(`/api/admin/lektionen/${lek8}/bunny-upload`, { groesse: '10' });
  pruefe('bunny-upload: zu gross 413 bunny_zu_gross, 0 -> 400 bunny_groesse_ungueltig, PDF -> 400 bunny_nur_video, fremdes Feld 400, Text statt Zahl 400; KEIN Video bei Bunny, keine Anfrage',
    zuGross.status === 413 && zuGross.d?.fehler === 'bunny_zu_gross' && null0.status === 400 && null0.d?.fehler === 'bunny_groesse_ungueltig' && pdf.status === 400 && pdf.d?.fehler === 'bunny_nur_video' && fremd.status === 400 && komisch.status === 400 && anrufe.length === vorAnrufe && lebende.size === vorLebende && !ausst(lek8),
    JSON.stringify([zuGross.status, null0.status, pdf.status, fremd.status, komisch.status]));
  const gut = await admin.post(`/api/admin/lektionen/${lek8}/bunny-upload`, { groesse: 4000 * 1024 * 1024, mime: 'video/quicktime' });
  pruefe('bunny-upload: genau an der Grenze mit video/quicktime -> 201, Video angelegt', gut.status === 201 && lebende.size === vorLebende + 1 && !!ausst(lek8));
  const leer = await admin.post(`/api/admin/lektionen/${lek8}/bunny-upload`, { groesse: 5, mime: '' });
  pruefe('bunny-upload: leerer Typ (Browser kennt ihn nicht) ist erlaubt -> 201, ersetzt das ausstehende Video', leer.status === 201 && ausst(lek8)?.video_id === leer.d?.video_id);
  modus.statusNr = 4; await admin.get(`/api/admin/lektionen/${lek8}/bunny-status`); await settle();
  const fertig8 = zeile(lek8);
  modus.statusNr = 7; const s7 = await admin.get(`/api/admin/lektionen/${lek8}/bunny-status`);
  pruefe('Fertiges Video: Bunny meldet 7 (segmente) -> Antwort und Datenbank bleiben fertig, bunny_meldet=segmente', fertig8?.bunny_status === 'fertig' && s7.d?.status === 'fertig' && s7.d.bunny_meldet === 'segmente' && zeile(lek8)?.bunny_status === 'fertig', JSON.stringify(s7.d));
  modus.statusNr = 99; await admin.get(`/api/admin/lektionen/${lek8}/bunny-status`);
  pruefe('Fertiges Video: unbekannte Statuszahl -> bleibt fertig', zeile(lek8)?.bunny_status === 'fertig');
  modus.statusNr = 5; const s5 = await admin.get(`/api/admin/lektionen/${lek8}/bunny-status`); modus.statusNr = 4;
  pruefe('Fertiges Video: echter Fehler (5) setzt den Status auf fehler', s5.d?.status === 'fehler' && zeile(lek8)?.bunny_status === 'fehler');
  await admin.get(`/api/admin/lektionen/${lek8}/bunny-status`);
  pruefe('Nach fehler darf fertig wieder gesetzt werden', zeile(lek8)?.bunny_status === 'fertig');
  // Ausgangslage: fruehere Abschnitte lassen absichtlich ein als "uebernommen" markiertes, nie geloeschtes Video (Gegenprobe gv) zurueck; das gilt als verwaist.
  const ab0 = await admin.get('/api/admin/bunny/abgleich');
  const waise = randomUUID(); lebende.add(waise);
  const geist = randomUUID(); const lekGeist = neueLektion(kurs8, 'Geist');
  db.prepare("INSERT INTO dateien(lektion_id,name,art,pfad,groesse,mime,erstellt,quelle,bunny_video_id,bunny_status) VALUES (?,?,?,?,?,?,?,'bunny',?,'fertig')").run(lekGeist, 'g', 'video', 'bunny', 0, 'application/octet-stream', jetzt(), geist);
  const ab = await admin.get('/api/admin/bunny/abgleich');
  pruefe('Abgleich: verwaistes Video bei Bunny erkannt (+1 gegenueber vorher), fehlendes Video der Datenbank erkannt, nichts geloescht', ab0.status === 200 && ab.status === 200 && ab.d?.verwaist?.length === ab0.d.verwaist.length + 1 && ab.d.verwaist.some((v) => v.id === waise) && ab.d.fehlend?.length === ab0.d.fehlend.length + 1 && ab.d.fehlend.some((f) => f.video_id === geist && f.lektion_id === lekGeist) && lebende.has(waise) && ab.d.bei_bunny === lebende.size && ab.d.gelesen === lebende.size, JSON.stringify(ab.d).slice(0, 200));
  const gast8 = client('http://127.0.0.1:4533'), kunde8 = await anmelden('http://127.0.0.1:4533', 'bunny-kunde@example.com');   // der Server laeuft seit dem Neustart-Abschnitt auf 4533
  pruefe('Abgleich: Gast 401, Kunde 403', (await gast8.get('/api/admin/bunny/abgleich')).status === 401 && (await kunde8.get('/api/admin/bunny/abgleich')).status === 403);
  lebende.delete(waise); db.prepare('DELETE FROM dateien WHERE lektion_id = ?').run(lekGeist); await settle();   // Trigger merkt geist vor; bei Bunny 404 = erledigt
  const ab2 = await admin.get('/api/admin/bunny/abgleich');
  pruefe('Abgleich danach: wieder die Ausgangslage, Auftragsbuch leer, vollstaendig gelesen', ab2.d?.verwaist?.length === ab0.d.verwaist.length && ab2.d.fehlend.length === ab0.d.fehlend.length && ab2.d.unvollstaendig === false && offeneAuftraege().length === 0);
  modus.listeGesamt = lebende.size + 5; const abU = await admin.get('/api/admin/bunny/abgleich'); modus.listeGesamt = null;
  pruefe('Abgleich bei unvollstaendig gelesener Liste: unvollstaendig=true, "fehlend" wird NICHT beurteilt (leer), verwaist weiterhin gemeldet', abU.status === 200 && abU.d?.unvollstaendig === true && abU.d.fehlend.length === 0 && abU.d.gelesen === lebende.size && abU.d.bei_bunny === lebende.size + 5, JSON.stringify(abU.d).slice(0, 160));
  modus.liste = 500; const abF = await admin.get('/api/admin/bunny/abgleich'); modus.liste = 200;
  pruefe('Abgleich bei Bunny-Fehler: 502 bunny_anfrage_fehlgeschlagen, Log ohne Schluessel', abF.status === 502 && abF.d?.fehler === 'bunny_anfrage_fehlgeschlagen');
  // Alarmdienst mit eigenen Texten: eigener Schluessel (bunny:...), die Behebungs-Mail der Sicherung setzt ihn NICHT zurueck und wird nicht faelschlich verschickt
  const { alarmDienst } = await import('../sicherung-alarm.mjs');
  const mails = []; const alarmTest = alarmDienst({ mailer: async (m) => { mails.push(m); return true; }, adressen: ['alarm@example.com'] });
  const { HU } = await import('../texte.mjs');
  const al1 = await alarmTest('bunny_loeschen', { praefix: 'bunny', betreff: HU.bunny_alarm_betreff, fehler: HU.bunny_alarm_fehler, teendo: HU.bunny_alarm_teendo });
  const eintrag = db.prepare('SELECT grund, aktiv FROM sicherung_alarm WHERE grund = ?').get('bunny:bunny_loeschen');
  pruefe('Bunny-Alarm: Mail mit Bunny-Betreff und -Text, Eintrag bunny:bunny_loeschen aktiv', al1 === true && mails.length === 1 && mails[0].subject === HU.bunny_alarm_betreff && mails[0].text.includes(HU.bunny_alarm_teendo) && !mails[0].text.includes(HU.sicherung_alarm_fehler) && eintrag?.aktiv === 1);
  const al2 = await alarmTest('bunny_loeschen', { praefix: 'bunny', betreff: HU.bunny_alarm_betreff });
  pruefe('Bunny-Alarm: zweiter Ruf innerhalb von 6 Stunden wird gedrosselt (keine zweite Mail)', al2 === false && mails.length === 1);
  const beh = await alarmTest('behebung');
  pruefe('Sicherung "wieder in Ordnung" verschickt KEINE Mail nur wegen des Bunny-Alarms und setzt ihn nicht zurueck', beh === false && mails.length === 1 && db.prepare('SELECT aktiv FROM sicherung_alarm WHERE grund = ?').get('bunny:bunny_loeschen')?.aktiv === 1);
  const al3 = await alarmTest('bunny_loeschen', { praefix: 'Boese/Praefix', betreff: 'x' });
  pruefe('Ungueltiger Praefix faellt auf sicherung zurueck (kein freier Schluesseltext)', db.prepare("SELECT COUNT(*) n FROM sicherung_alarm WHERE grund LIKE '%Boese%'").get().n === 0 && typeof al3 === 'boolean');
  db.prepare("DELETE FROM sicherung_alarm WHERE grund LIKE 'bunny:%' OR grund = 'sicherung:bunny_loeschen'").run();
  const { setzeAlarmHaken, ALARM_AB_VERSUCHEN } = await import('../bunny-loeschen.mjs');
  const alarme = []; setzeAlarmHaken(async (g) => { alarme.push(g); });
  const stur = randomUUID(); lebende.add(stur);
  db.prepare('INSERT INTO bunny_loeschauftraege(video_id,erstellt) VALUES (?,?)').run(stur, jetzt());
  modus.loeschen = 500;
  for (let i = 0; i < ALARM_AB_VERSUCHEN - 1; i++) await nachholen();
  const lageVor = (await admin.get('/api/admin/bunny')).d.loeschauftraege;
  pruefe('Loeschauftrag scheitert 4x: noch kein Alarm, Lage zeigt offen=1, fehlgeschlagen=0, versuche=4', alarme.length === 0 && lageVor.offen === 1 && lageVor.fehlgeschlagen === 0 && lageVor.liste[0]?.video_id === stur && lageVor.liste[0].versuche === ALARM_AB_VERSUCHEN - 1, JSON.stringify(lageVor));
  await nachholen();
  const lageNach = (await admin.get('/api/admin/bunny')).d.loeschauftraege;
  pruefe('5. Fehlversuch: genau EIN Alarm (bunny_loeschen), Lage zeigt fehlgeschlagen=1 und aelteste', alarme.length === 1 && alarme[0] === 'bunny_loeschen' && lageNach.fehlgeschlagen === 1 && typeof lageNach.aelteste === 'string');
  await nachholen(); await nachholen();
  pruefe('Weitere Fehlversuche: der Haken wird bei jedem weiteren Fehlversuch erneut gerufen (die 6-h-Drossel macht der Alarmdienst)', alarme.length === 3 && alarme.every((g) => g === 'bunny_loeschen'));
  setzeAlarmHaken(async () => { throw new Error('kaputt'); });
  modus.loeschen = 200; await settle();
  pruefe('Bunny wieder da: Auftrag erledigt, Video weg; ein kaputter Alarm-Haken stoert nichts', !lebende.has(stur) && offeneAuftraege().length === 0);
  setzeAlarmHaken(null);
  const lekAlt2 = neueLektion(kurs8, 'Alt bei aus'); const altV2 = randomUUID(); lebende.add(altV2);
  db.prepare('INSERT INTO bunny_ausstehend(lektion_id,video_id,erstellt) VALUES (?,?,?)').run(lekAlt2, altV2, new Date(Date.now() - 4 * 86400000).toISOString());
  setzeBunny(null); await nachholen();
  pruefe('Bunny AUS: ein 4 Tage altes ausstehendes Video wird NICHT aufgeraeumt (niemand konnte nachfragen)', !!ausst(lekAlt2) && lebende.has(altV2));
  setzeBunny(bunnyAn()); modus.statusNr = 2; await settle(); modus.statusNr = 4;
  pruefe('Bunny AN: dasselbe Video wird aufgeraeumt und bei Bunny geloescht', !ausst(lekAlt2) && !lebende.has(altV2));
  await admin.del(`/api/admin/kurse/${kurs8}`); await settle();
  pruefe('Schritt-8-Testkurs geloescht, seine Videos weg, Auftragsbuch leer', !lebende.has(fertig8?.bunny_video_id) && offeneAuftraege().length === 0);

  // ---- Allgemeine Pruefungen ---------------------------------------------------------------------------------------------------------
  const alleLogs = logs.join('\n');
  pruefe('Kein Schluessel in irgendeiner Log-Zeile', !alleLogs.includes(API) && !alleLogs.includes(TOKEN));
  const uebrig = readdirSync(DATEIEN).filter((n) => !n.startsWith('.tmp-'));
  const erlaubteDateien = new Set([zeile(lekLokal).pfad, zeile(lekR).pfad]);
  pruefe('Keine verwaisten lokalen Dateien im Dateiordner (nur die zwei aktuellen lokalen Dateien der Lektionen lekLokal und lekR)', uebrig.length === 2 && uebrig.every((n) => erlaubteDateien.has(n)), uebrig.join(','));
  // Erlaubter Bestand: das aktuelle Video der Lektion "lek", das der Lektion "lekP" und das der Gegenprobe (uebernommen markiert, bewusst nicht geloescht). Alles andere muss weg sein.
  const erlaubt = new Set([zeile(lek)?.bunny_video_id, zeile(lekP)?.bunny_video_id, zeile(lekH)?.bunny_video_id, jv, gv]);
  pruefe('Kein Bunny-Video bleibt uebrig, das keiner Lektion gehoert (nur die 5 erlaubten: lek, lekP, lekH, frisch ausstehendes jv, Gegenprobe gv)', [...lebende].length === 5 && [...lebende].every((v) => erlaubt.has(v)), [...lebende].join(','));
} catch (e) {
  fehler++; console.log('FEHLER Testablauf: ' + (e.stack || e.message).split('\n').filter((z, i) => i < 2 || /selbsttest/.test(z)).slice(0, 6).join(' | ') + (e.cause ? ' | Ursache: ' + (e.cause.message || e.cause) : ''));
} finally {
  console.warn = alteWarn; console.error = alteError;
  try { await new Promise((r) => (server ? server.close(r) : r())); } catch { /* egal */ }
  try { db?.close(); } catch { /* egal */ }
  try { rmSync(ordner, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; }
}
console.log('Bunny Admin-Routen und Loeschen: ' + ok + ' bestanden, ' + fehler + ' fehlgeschlagen');
process.exitCode = fehler ? 1 : 0;
