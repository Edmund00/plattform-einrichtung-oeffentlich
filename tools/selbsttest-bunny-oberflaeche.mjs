// Bunny Stream, Schritt 6: Admin-Oberflaeche. Server (Admin-Liste mit Bunny-Infos, CSP fuer die Admin-Seite), mitgelieferte Bibliothek (Herkunft, Pruefsumme)
// und Frontend-Code (statisch). Der echte Browser-Ablauf mit nachgebautem TUS-Server steht in tools/browsertest-bunny-upload.mjs (braucht Chrome, nicht Teil der Suite).
import './test-sprache.mjs';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
const ordner = mkdtempSync(join(tmpdir(), 'schulung-bunny-ui-'));
const DATEIEN = join(ordner, 'dateien');
process.env.DB_DATEI = join(ordner, 'test.db');
const PASS = randomBytes(24).toString('hex');
let ok = 0, fehler = 0;
const pruefe = (name, wert, detail = '') => { wert ? ok++ : fehler++; console.log((wert ? 'OK     ' : 'FEHLER ') + name + (!wert && detail ? ' ' + detail : '')); };
const lies = (pfad) => readFileSync(new URL('../' + pfad, import.meta.url), 'utf8');

let db, server;
try {
  ({ db } = await import('../db.mjs'));
  const { passwortHashen } = await import('../auth.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const { erstelleBunny } = await import('../bunny.mjs');
  const { KOPFZEILEN, cspMitBunny, BUNNY_PLAYER_ADRESSE, BUNNY_UPLOAD_ADRESSE } = await import('../routes-admin-seite.mjs');

  // ======== A) Mitgelieferte Bibliothek ==================================================================================================
  const tusDatei = readFileSync(new URL('../public/vendor/tus/tus.min.js', import.meta.url));
  const herkunft = lies('public/vendor/tus/HERKUNFT.txt').replace(/^﻿/, '');
  const hash = createHash('sha256').update(tusDatei).digest('hex').toUpperCase();
  pruefe('tus-js-client: Pruefsumme der Datei stimmt mit HERKUNFT.txt ueberein (unveraendert)', herkunft.includes(hash));
  pruefe('tus-js-client: Version 4.3.1, MIT, Lizenzdatei vorhanden', herkunft.includes('tus-js-client 4.3.1') && herkunft.includes('MIT') && /MIT License/i.test(lies('public/vendor/tus/LICENSE')));
  pruefe('tus-js-client: enthaelt keine festen http-Adressen (ruft nur auf, was wir uebergeben)', ![...tusDatei.toString('utf8').matchAll(/https?:\/\/[^\s'"`)]*/g)].length);
  pruefe('tus-js-client: setzt im Browser das globale "tus" (UMD)', /typeof window/.test(tusDatei.toString('utf8').slice(0, 400)) || /"undefined"!=typeof win/.test(tusDatei.toString('utf8').slice(0, 400)));

  // ======== B) Frontend (statisch) =======================================================================================================
  const admin = lies('public/admin/admin.js'), html = lies('public/admin/index.html');
  const b = admin.slice(admin.indexOf('// ---- Video zu Bunny Stream hochladen'), admin.indexOf('// ---- Datei hochladen: der Browser schickt'));
  pruefe('Admin-Seite laedt tus NICHT fest (nur admin.js im HTML), sondern erst bei Bedarf von der eigenen Adresse', (html.match(/<script/g) || []).length === 1 && b.includes("s.src = '/vendor/tus/tus.min.js'") && b.includes('window.tus'));
  pruefe('Upload nutzt die Daten des Servers (Adresse und Kopfzeilen aus der Antwort), keine festen Bunny-Adressen oder Schluessel im Code', b.includes('endpoint: a.d.upload.url') && b.includes('headers: a.d.upload.kopfzeilen') && !/bunnycdn|mediadelivery|bunny\.net|AccessKey|api[-_]?key/i.test(b));
  pruefe('Metadaten filetype und title werden mitgeschickt (Bunny-Doku: Pflicht)', b.includes('filetype: datei.type') && b.includes('title: lecke.titel'));
  pruefe('Wiederholung wie in der Doku (retryDelays), Fehler 401/404 = Berechtigung abgelaufen', b.includes('retryDelays: [0, 3000, 5000, 10000, 20000, 60000, 60000]') && b.includes('kod === 401 || kod === 404') && b.includes('a_bunny_lejart'));
  pruefe('Verlassen der Seite waehrend des Uploads wird gewarnt und danach wieder freigegeben', admin.includes("window.addEventListener('beforeunload', sperre)") && admin.includes("window.removeEventListener('beforeunload', sperre)"));
  pruefe('Bunny-Upload erscheint nur bei Videolektionen UND eingeschaltetem Bunny', admin.includes("l.art === 'video' && bunnyAn ? bunnyBlock(l, jetzt) : null") && admin.includes("api('GET', '/api/admin/bunny')"));
  pruefe('Bunny-Zeile zeigt keine Dateigroesse (Platzhalter 0 Byte waere irrefuehrend)', admin.includes("jetzt.quelle === 'bunny' ? '' : ' ('"));
  pruefe('Nachfragen nur solange die Seite noch da ist, hoechstens 15 Minuten (180 x 5 s); danach uebernimmt der Server', b.includes('i < 180 && ui.nochDa()') && b.includes('await warten(5000)') && b.includes("return 'feldolgozas'"));
  pruefe('Fortsetzen nach Netzabbruch: bei anderen Fehlern als 401/404 bleibt der Upload erhalten, ein Knopf ruft start() erneut auf (tus fragt den Stand bei Bunny ab)', b.includes('ui.folytatas.hidden = false') && b.includes('ui.folytatas.onclick') && b.includes('feltoltes.start()') && (b.match(/feltoltes.start()/g) || []).length === 2);
  pruefe('Nichts im Browser-Speicher: storeFingerprintForResuming ist aus (Upload-Adressen gehoeren zu genau einem Video)', b.includes('storeFingerprintForResuming: false'));
  pruefe('Verlassen-Warnung wird direkt nach dem Upload aufgehoben (nicht erst nach der Verarbeitung)', b.includes('ui.nachUpload()') && admin.includes("nachUpload: () => window.removeEventListener('beforeunload', sperre)") && b.indexOf('ui.nachUpload()') < b.indexOf('for (let i = 0; i < 180'));
  pruefe('Nur Videodateien: falscher Dateityp wird abgelehnt, BEVOR ein Video bei Bunny angelegt wird', b.includes("datei.type && !datei.type.startsWith('video/')") && b.indexOf("datei.type && !datei.type.startsWith('video/')") < b.indexOf("api('POST', '/api/admin/lektionen/'"));
  pruefe('Nachfragen stoppt bei 401/403/404 (Anmeldung weg, Lektion oder Video gibt es nicht mehr) statt 15 Minuten still weiterzufragen', b.includes('s.status === 401 || s.status === 403 || s.status === 404') && b.includes('throw new Error(fehlerText(s))'));
  const hu = JSON.parse(lies('texte/hu.json'));
  pruefe('Texte: "ismeretlen" fuer unbekannten Status (nicht dasselbe wie "in Verarbeitung"), neue Texte vorhanden', hu.a_bunny_st_unbekannt === 'ismeretlen' && hu.a_bunny_st_unbekannt !== hu.a_bunny_st_verarbeitet && ['a_bunny_nur_video_fajl', 'a_bunny_megszakadt', 'a_bunny_folytatas'].every((k) => typeof hu[k] === 'string' && hu[k].length > 3));
  pruefe('Schritt 8: Oberflaeche prueft die Groesse vor dem Anlegen, fragt bei zweitem Upload, meldet Groesse/Typ an den Server, zeigt die Videoablage-Lage mit Abgleich',
    admin.includes("t('a_bunny_tul_nagy'") && admin.includes("bestaetigen('a_bunny_masodik_frage'") && b.includes("{ groesse: datei.size, mime: datei.type || '' }") && admin.includes("'/api/admin/bunny/abgleich'") && admin.includes('async function bunnyLage(') && admin.includes('void bunnyLage(')
    && ['a_bunny_tul_nagy', 'a_bunny_masodik_frage', 'a_bunny_box_cim', 'a_bunny_box_rendben', 'a_bunny_box_offen', 'a_bunny_box_fehler', 'a_bunny_abgleich_knopf', 'a_bunny_abgleich_folyamat', 'a_bunny_abgleich_ok', 'a_bunny_abgleich_elteres', 'a_bunny_abgleich_unvollstaendig'].every((k) => typeof hu[k] === 'string' && hu[k].length > 3)
    && ['bunny_groesse_ungueltig', 'bunny_zu_gross', 'bunny_alarm_betreff', 'bunny_alarm_fehler', 'bunny_alarm_teendo'].every((k) => typeof hu[k] === 'string' && hu[k].length > 3));
  const schluessel = Object.keys(hu).filter((k) => k.startsWith('a_bunny_'));
  pruefe(`Alle ${schluessel.length} ungarischen Bunny-Texte der Oberflaeche vorhanden und nicht leer`, schluessel.length >= 18 && schluessel.every((k) => typeof hu[k] === 'string' && hu[k].length > 3));

  // ======== C) Server ====================================================================================================================
  const ph = await passwortHashen(PASS);
  const insertUser = (email, rolle = 'kunde') => Number(db.prepare('INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,?,?,?)').run(email, ph, rolle, new Date().toISOString(), Date.now()).lastInsertRowid);
  insertUser('ui-admin@example.com', 'admin'); const kunde = insertUser('ui-kunde@example.com');
  const jetzt = () => new Date().toISOString();
  const kurs = Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES ('K','',0,'huf','veroeffentlicht',?,?)").run(jetzt(), jetzt()).lastInsertRowid);
  const lekFertig = Number(db.prepare("INSERT INTO lektionen(kurs_id,titel,art,erstellt,geaendert) VALUES (?,?,'video',?,?)").run(kurs, 'Fertig', jetzt(), jetzt()).lastInsertRowid);
  const lekAusst = Number(db.prepare("INSERT INTO lektionen(kurs_id,titel,art,erstellt,geaendert) VALUES (?,?,'video',?,?)").run(kurs, 'Ausstehend', jetzt(), jetzt()).lastInsertRowid);
  db.prepare("INSERT INTO dateien(lektion_id,name,art,pfad,groesse,mime,erstellt,quelle,bunny_video_id,bunny_status) VALUES (?,?,'video','bunny',0,'application/octet-stream',?,'bunny',?,'fertig')").run(lekFertig, 'Fertig', jetzt(), randomUUID());
  db.prepare('INSERT INTO bunny_ausstehend(lektion_id,video_id,erstellt) VALUES (?,?,?)').run(lekAusst, randomUUID(), jetzt());
  db.prepare("INSERT INTO zugaenge(benutzer_id,kurs_id,quelle,erstellt) VALUES (?,?,'einladung',?)").run(kunde, kurs, jetzt());
  mkdirSync(DATEIEN, { recursive: true });
  const stripe = { webhooks: { constructEvent: (b2) => JSON.parse(b2.toString()) } };
  const bunnyAn = () => erstelleBunny({ bibliothek: '12345', apiKey: 'api-key-test-0001', tokenKey: 'token-key-test-0001' }, { fetchFn: async () => { throw new Error('nie'); } });
  const starte = (port, bunny) => new Promise((yes, no) => { const s = erstelleServer({ stripe, webhookSecret: 'test', base: `http://127.0.0.1:${port}`, dateiOrdner: DATEIEN, abgleichAutomatik: false, bunny }).listen(port, '127.0.0.1'); s.once('listening', () => yes(s)); s.once('error', no); });
  const stoppe = (s) => new Promise((r) => s.close(r));
  function client(base) {
    let cookie = '';
    const get = async (pfad) => { const r = await fetch(base + pfad, { headers: cookie ? { Cookie: cookie } : {} }); const text = await r.text(); let d = null; try { d = JSON.parse(text); } catch { /* html */ } return { status: r.status, d, text, kopf: r.headers }; };
    const login = async (email) => { const r = await fetch(base + '/api/anmelden', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, passwort: PASS }) }); cookie = (r.headers.get('set-cookie') || '').split(';')[0]; };
    return { get, login };
  }

  server = await starte(4561, bunnyAn());
  const BASE = 'http://127.0.0.1:4561';
  const cAdmin = client(BASE), cKunde = client(BASE), cGast = client(BASE);
  await cAdmin.login('ui-admin@example.com'); await cKunde.login('ui-kunde@example.com');
  const aKurs = await cAdmin.get('/api/kurse/' + kurs);
  const aFertig = aKurs.d?.lektionen?.find((l) => l.id === lekFertig), aAusst = aKurs.d?.lektionen?.find((l) => l.id === lekAusst);
  pruefe('Admin-Liste: Datei zeigt quelle=bunny und bunny_status=fertig', aFertig?.dateien?.[0]?.quelle === 'bunny' && aFertig.dateien[0].bunny_status === 'fertig');
  pruefe('Admin-Liste: Lektion mit ausstehendem Video hat bunny_ausstehend=true, die fertige false', aAusst?.bunny_ausstehend === true && aFertig?.bunny_ausstehend === false);
  const kKurs = await cKunde.get('/api/kurse/' + kurs);
  pruefe('Kunden-Liste: KEIN quelle, KEIN bunny_status, KEIN bunny_ausstehend, keine Video-ID und kein Platzhalter-Pfad', kKurs.status === 200 && !/quelle|bunny_|"pfad"/i.test(kKurs.text) && kKurs.d?.lektionen?.length === 2);
  pruefe('Admin-Liste enthaelt weder Video-ID noch Pfad', !/bunny_video_id|"pfad"/.test(aKurs.text));

  const cspAdmin = (await cGast.get('/admin/')).kopf.get('content-security-policy'), cspStart = (await cGast.get('/')).kopf.get('content-security-policy');
  const sollAdmin = KOPFZEILEN['Content-Security-Policy'].replace("connect-src 'self'", "connect-src 'self' https://video.bunnycdn.com");
  const sollStart = KOPFZEILEN['Content-Security-Policy'] + '; frame-src https://player.mediadelivery.net';
  pruefe('Mit Bunny: Admin-Seite bekommt NUR connect-src fuer den Bunny-Upload (kein frame-src)', cspAdmin === sollAdmin && !cspAdmin.includes('frame-src'), cspAdmin);
  pruefe('Mit Bunny: Startseite bekommt NUR frame-src fuer den Player (kein erweitertes connect-src)', cspStart === sollStart && !cspStart.includes('bunnycdn'), cspStart);
  pruefe('Mit Bunny: sonst bleibt alles zu (script-src, media-src, default-src self, frame-ancestors none, keine Platzhalter)', [cspAdmin, cspStart].every((c) => /script-src 'self';/.test(c) && /media-src 'self';/.test(c) && /default-src 'self';/.test(c) && c.includes("frame-ancestors 'none'") && !/unsafe-|\*/.test(c)));
  await stoppe(server);

  server = await starte(4562, null);
  const g2 = client('http://127.0.0.1:4562');
  pruefe('Ohne Bunny: Admin-Seite und Startseite haben EXAKT die bisherige CSP', (await g2.get('/admin/')).kopf.get('content-security-policy') === KOPFZEILEN['Content-Security-Policy'] && (await g2.get('/')).kopf.get('content-security-policy') === KOPFZEILEN['Content-Security-Policy']);
  await stoppe(server);

  // ---- Pfadlogik der CSP ---------------------------------------------------------------------------------------------------------------
  const basis = KOPFZEILEN['Content-Security-Policy'];
  pruefe('cspMitBunny: /admin, /admin/, /admin/admin.js und /ADMIN/ (Express leitet auch das zur Admin-Seite) gelten als Admin', ['/admin', '/admin/', '/admin/admin.js', '/ADMIN/', '/Admin'].every((p) => cspMitBunny(basis, p).includes('video.bunnycdn.com') && !cspMitBunny(basis, p).includes('frame-src')));
  pruefe('cspMitBunny: /administrator, /api/admin/bunny, /kurse und leer gelten NICHT als Admin-Seite', ['/administrator', '/api/admin/bunny', '/kurse', '', undefined].every((p) => !cspMitBunny(basis, p).includes('video.bunnycdn.com') && cspMitBunny(basis, p).includes('frame-src https://player.mediadelivery.net')));
  pruefe('Konstanten: Player-Adresse und Upload-Adresse sind genau die der Bunny-Doku', BUNNY_PLAYER_ADRESSE === 'https://player.mediadelivery.net' && BUNNY_UPLOAD_ADRESSE === 'https://video.bunnycdn.com');
} catch (e) {
  fehler++; console.log('FEHLER Testablauf: ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | '));
} finally {
  try { await new Promise((r) => (server ? server.close(r) : r())); } catch { /* egal */ }
  try { db?.close(); } catch { /* egal */ }
  try { rmSync(ordner, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; }
}
console.log('Bunny Oberflaeche: ' + ok + ' bestanden, ' + fehler + ' fehlgeschlagen');
process.exitCode = fehler ? 1 : 0;
