// Automatischer Selbsttest für Scheibe 5: Dateien hochladen (nur Admin) und nur an Käufer ausliefern. Offline, ohne Schlüssel.
// Läuft im selben Prozess mit der Stripe-Attrappe (Stripe wird hier nie berührt), eigener Test-Ordner im Temp-Verzeichnis, Port 4413.
// Die Obergrenze ist im Test klein (1 MB), damit "zu groß" schnell geprüft werden kann.
// Aufruf: tools\Selbsttest-Dateien.ps1
import './test-sprache.mjs';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const PORT = 4413;
const BASE = `http://localhost:${PORT}`;
const BASIS = mkdtempSync(join(tmpdir(), 'schulung-dateien-'));
const ORDNER = join(BASIS, 'dateien');
const DB = join(BASIS, 'test.db');
process.env.DB_DATEI = DB;                                       // VOR dem Import der App setzen
const MAX = 1024 * 1024;
const pw = 'Geheim-Passwort-123';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let ok = 0, schlecht = 0;
const pruefe = (name, bedingung, detail = '') => { bedingung ? ok++ : schlecht++; console.log(`${bedingung ? 'OK     ' : 'FEHLER '} ${name}${!bedingung && detail ? '  -> ' + String(detail).slice(0, 300) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = (pfad) => { try { rmSync(pfad, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } };   // Windows: Datei kann noch gesperrt sein
const db = () => new DatabaseSync(DB);
const zeilen = (sql, ...p) => { const d = db(); try { return d.prepare(sql).all(...p); } finally { d.close(); } };
const zahl = (sql, ...p) => Object.values(zeilen(sql, ...p)[0])[0];
const ordnerInhalt = () => readdirSync(ORDNER).sort();
const dbNamen = () => zeilen('SELECT pfad FROM dateien').map((x) => x.pfad).sort();

// ---- Testdateien: Anfang = echte Magic Bytes, danach ein Muster (damit Ausschnitte genau prüfbar sind) ----
const muster = (n, seed = 7) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * seed + 13) % 251; return b; };
const mit = (kopf, n, seed) => Buffer.concat([Buffer.from(kopf, 'latin1'), muster(Math.max(0, n - kopf.length), seed)]);
const MP4 = (n, s) => mit('\0\0\0\x18ftypmp42', n, s), M4A = (n, s) => mit('\0\0\0\x20ftypM4A ', n, s);
const WEBM = (n, s) => mit('\x1aE\xdf\xa3', n, s), PDF = (n, s) => mit('%PDF-1.4\n', n, s), MP3 = (n, s) => mit('ID3\x03\0\0', n, s);
const OGG = (n, s) => mit('OggS', n, s), ZIP = (n, s) => mit('PK\x03\x04', n, s);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ---- Anfragen. Alle Antworten werden gesammelt, damit am Ende geprüft werden kann, dass kein Pfad der Platte darin vorkommt ----
const antworten = [];
function client() {
  let cookie = '';
  return {
    async anfrage(methode, pfad, body, kopf = {}) {
      // Scheibe 7: Medienanfragen benötigen ein an diese Sitzung gebundenes Ticket.
      const match = methode === 'GET' && /^\/api\/lektionen\/([1-9]\d*)\/datei$/.exec(pfad);
      if (match && cookie) {
        const t = await fetch(BASE + '/api/lektionen/' + match[1] + '/wiedergabe', {
          method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}'
        });
        if (t.ok) pfad += '?ticket=' + encodeURIComponent((await t.json()).ticket);
      }
      const istJson = body !== undefined && !Buffer.isBuffer(body);
      const r = await fetch(BASE + pfad, { method: methode, headers: { ...(istJson ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...kopf }, body: istJson ? JSON.stringify(body) : body });
      const sc = r.headers.get('set-cookie');
      if (sc) { const roh = sc.split(';')[0]; cookie = roh.endsWith('=') ? '' : roh; }
      const buf = Buffer.from(await r.arrayBuffer());
      const kopfText = [...r.headers].map(([k, v]) => `${k}: ${v}`).join('\n');
      const typ = r.headers.get('content-type') || '';
      antworten.push(kopfText + '\n' + (/json|text/.test(typ) ? buf.toString('utf8') : ''));
      let d = {}; if (/json/.test(typ)) { try { d = JSON.parse(buf.toString('utf8')); } catch (e) { /* kein JSON */ } }
      return { s: r.status, d, buf, kopf: r.headers };
    },
    get cookie() { return cookie; },
  };
}
const putDatei = (c, lektionId, body, typ, name, extra = {}) => c.anfrage('PUT', `/api/admin/lektionen/${lektionId}/datei`, body, { ...(typ !== undefined ? { 'Content-Type': typ } : {}), ...(name !== undefined ? { 'X-Dateiname': encodeURIComponent(name) } : {}), ...extra });
// Roher Upload (für Abbruch und "ohne Content-Length"): Stücke senden, optional vorzeitig abbrechen
function rohPut(cookie, lektionId, { typ, name, laenge, stuecke, abbrechenNach }) {
  return new Promise((erfuellt) => {
    const kopf = { 'Content-Type': typ, 'X-Dateiname': encodeURIComponent(name || 'x'), Cookie: cookie };
    if (laenge !== undefined) kopf['Content-Length'] = String(laenge); else kopf['Transfer-Encoding'] = 'chunked';
    let fertig = false;
    const ende = (x) => { if (!fertig) { fertig = true; erfuellt(x); } };
    const r = request({ host: '127.0.0.1', port: PORT, path: `/api/admin/lektionen/${lektionId}/datei`, method: 'PUT', headers: kopf }, (a) => {
      let t = ''; a.on('data', (x) => { t += x; }); a.on('end', () => { try { ende({ s: a.statusCode, d: JSON.parse(t), kopf: a.headers }); } catch (e) { ende({ s: a.statusCode, d: {}, kopf: a.headers }); } });
    });
    r.on('error', (e) => ende({ s: 0, fehler: e.code }));
    (async () => {
      let gesendet = 0;
      for (const s of stuecke) {
        if (fertig) return;
        if (!r.write(s)) await new Promise((x) => r.once('drain', x));
        gesendet += s.length;
        if (abbrechenNach !== undefined && gesendet >= abbrechenNach) { await warte(100); r.destroy(); ende({ s: -1, abgebrochen: true }); return; }
      }
      if (!fertig) r.end();
    })();
  });
}

let server;
try {
  const { erstelleServer } = await import(pathToFileURL(resolve('app.mjs')).href);
  const ohneStripe = new Proxy({}, { get: () => { throw new Error('Stripe wird in diesem Test nie gebraucht'); } });
  const optionen = { stripe: ohneStripe, webhookSecret: 'whsec_nur_fuer_tests', base: BASE, dateiOrdner: ORDNER, maxUploadBytes: MAX };
  server = erstelleServer(optionen).listen(PORT, '127.0.0.1');
  await warte(300);

  const admin = client(), k1 = client(), k2 = client(), gast = client();
  const mailAdmin = `dateien.admin.${Date.now()}@example.com`;
  const skript = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/admin-anlegen.mjs', mailAdmin], { env: { ...process.env, ADMIN_PASSWORT: pw }, encoding: 'utf8' });
  pruefe('Admin per Skript angelegt', skript.stdout.trim() === 'Admin angelegt', skript.stdout + skript.stderr);
  await admin.anfrage('POST', '/api/anmelden', { email: mailAdmin, passwort: pw });
  await k1.anfrage('POST', '/api/registrieren', { zustimmung: true, email: `dateien.k1.${Date.now()}@example.com`, passwort: pw });
  await k2.anfrage('POST', '/api/registrieren', { zustimmung: true, email: `dateien.k2.${Date.now()}@example.com`, passwort: pw });
  const k1Id = zeilen("SELECT id FROM benutzer WHERE email LIKE 'dateien.k1.%'")[0].id;

  // Kurs mit je einer Lektion pro Typ, dazu eine versteckte und ein Entwurfs-Kurs
  const kurs = (await admin.anfrage('POST', '/api/admin/kurse', { titel: 'Dateikurs', preis_cent: 3990000 })).d;
  await admin.anfrage('POST', `/api/admin/kurse/${kurs.id}/veroeffentlichen`, {});
  const lek = async (kursId, art, extra = {}) => (await admin.anfrage('POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: `Lektion ${art}`, art, status: 'veroeffentlicht', ...extra })).d;   // Block 4: Status ausdruecklich (sonst im veroeffentlichten Kurs ausgeblendet)
  const L = { video: await lek(kurs.id, 'video'), pdf: await lek(kurs.id, 'pdf'), audio: await lek(kurs.id, 'audio'), datei: await lek(kurs.id, 'datei'), text: await lek(kurs.id, 'text'), leer: await lek(kurs.id, 'pdf'), versteckt: await lek(kurs.id, 'pdf', { status: 'entwurf' }) };
  const entwurfKurs = (await admin.anfrage('POST', '/api/admin/kurse', { titel: 'Entwurf', preis_cent: 100000 })).d;
  const LEntwurf = await lek(entwurfKurs.id, 'pdf');
  const dZ = db();
  dZ.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, erstellt) VALUES (?, ?, 'einladung', ?)").run(k1Id, kurs.id, new Date().toISOString());
  dZ.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, erstellt) VALUES (?, ?, 'einladung', ?)").run(k1Id, entwurfKurs.id, new Date().toISOString());
  dZ.close();

  // =================================================================================================
  abschnitt('Upload: nur für Admin');
  const pdfA = PDF(3000, 3);
  const g1 = await putDatei(gast, L.pdf.id, pdfA, 'application/pdf', 'a.pdf');
  pruefe('Gast: 401', g1.s === 401 && g1.d.fehler === 'nicht_angemeldet');
  const g2 = await putDatei(k1, L.pdf.id, pdfA, 'application/pdf', 'a.pdf');
  pruefe('Angemeldeter Kunde (sogar mit Zugang zum Kurs): 403 kein_admin', g2.s === 403 && g2.d.fehler === 'kein_admin');
  pruefe('Fremde Herkunft (Origin): 403', (await putDatei(admin, L.pdf.id, pdfA, 'application/pdf', 'a.pdf', { Origin: 'https://boese.example' })).s === 403);
  pruefe('Nach den Ablehnungen liegt nichts auf der Platte und nichts in der Datenbank', ordnerInhalt().length === 0 && zahl('SELECT COUNT(*) FROM dateien') === 0);
  const erster = await putDatei(admin, L.pdf.id, pdfA, 'application/pdf', 'Prospektus.pdf');
  pruefe('Admin: 201 mit Lektion, Name, Art, Größe und Typ (kein Pfad)', erster.s === 201 && erster.d.lektion_id === L.pdf.id && erster.d.name === 'Prospektus.pdf' && erster.d.art === 'pdf' && erster.d.groesse === 3000 && erster.d.mime === 'application/pdf' && !('pfad' in erster.d), JSON.stringify(erster.d));
  pruefe('Lektion vom Typ "text" nimmt keine Datei: 400 lektion_ohne_datei (ungarisch)', (await putDatei(admin, L.text.id, pdfA, 'application/pdf', 'a.pdf')).d.fehler === 'lektion_ohne_datei');
  pruefe('Unbekannte Lektion: 404, ungültige ID: 400', (await putDatei(admin, 99999, pdfA, 'application/pdf', 'a.pdf')).s === 404 && (await putDatei(admin, 'abc', pdfA, 'application/pdf', 'a.pdf')).d.fehler === 'ungueltige_id');
  const gr0 = await gast.anfrage('GET', '/api/admin/upload-grenze'), gr1 = await k1.anfrage('GET', '/api/admin/upload-grenze'), gr2 = await admin.anfrage('GET', '/api/admin/upload-grenze');
  pruefe('/api/admin/upload-grenze: Gast 401, Kunde 403, Admin 200 mit Obergrenze und Endungen', gr0.s === 401 && gr1.s === 403 && gr2.s === 200 && gr2.d.max_bytes === MAX && gr2.d.endungen.video.includes('.mp4') && gr2.d.endungen.audio.includes('.m4a'), JSON.stringify(gr2.d));

  // =================================================================================================
  abschnitt('Upload: erlaubte Typen je Lektionstyp');
  const richtig = [
    ['Video mp4', 'video', 'video/mp4', MP4(4000), 'film.mp4', 'video/mp4'], ['Video webm', 'video', 'video/webm', WEBM(4000), 'film.webm', 'video/webm'],
    ['PDF', 'pdf', 'application/pdf', PDF(4000), 'doku.pdf', 'application/pdf'],
    ['Hanganyag mp3', 'audio', 'audio/mpeg', MP3(4000), 'hang.mp3', 'audio/mpeg'], ['Hanganyag m4a (audio/mp4)', 'audio', 'audio/mp4', M4A(4000), 'hang.m4a', 'audio/mp4'],
    ['Hanganyag m4a (audio/x-m4a, wird als audio/mp4 gespeichert)', 'audio', 'audio/x-m4a', M4A(4000), 'hang.m4a', 'audio/mp4'], ['Hanganyag ogg', 'audio', 'audio/ogg', OGG(4000), 'hang.ogg', 'audio/ogg'],

  ];
  for (const [name, art, typ, body, dateiname, gespeichert] of richtig) {
    const r = await putDatei(admin, L[art].id, body, typ, dateiname);
    pruefe(`${name}: 201, gespeichert als ${gespeichert}`, r.s === 201 && r.d.mime === gespeichert && r.d.groesse === body.length, JSON.stringify(r.d));
  }
  const ohneTyp = await putDatei(admin, L.video.id, MP4(4000), 'application/octet-stream', 'kurs-film.MP4');
  pruefe('Browser meldet nur application/octet-stream: die Endung .mp4 entscheidet, die ersten Bytes werden trotzdem geprüft: 201', ohneTyp.s === 201 && ohneTyp.d.mime === 'video/mp4', JSON.stringify(ohneTyp.d));
  const stand = { ordner: ordnerInhalt(), db: dbNamen() };
  pruefe('Ordner und Datenbank stimmen überein: genau eine Datei je Lektion, keine Reste', JSON.stringify(stand.ordner) === JSON.stringify(stand.db) && stand.db.length === 3, JSON.stringify(stand));

  abschnitt('Upload: falsche Typen und falscher Inhalt werden abgewiesen (400)');
  const html = Buffer.concat([Buffer.from('<html><script>alert(1)</script></html>'), muster(3000)]);
  const exe = Buffer.concat([Buffer.from('MZ'), muster(3000)]);
  const falsch = [
    ['Video-Lektion mit PDF-Typ', 'video', 'application/pdf', PDF(4000), 'x.pdf', 'dateityp_ungueltig'],
    ['PDF-Lektion mit Video-Typ', 'pdf', 'video/mp4', MP4(4000), 'x.mp4', 'dateityp_ungueltig'],
    ['Audio-Lektion mit Video-Typ', 'audio', 'video/webm', WEBM(4000), 'x.webm', 'dateityp_ungueltig'],
    ['Fájl-Lektion mit Audio-Typ', 'datei', 'audio/mpeg', MP3(4000), 'x.mp3', 'dateityp_ungueltig'],
    ['Fájl-Lektion mit Video-Typ', 'datei', 'video/mp4', MP4(4000), 'x.mp4', 'dateityp_ungueltig'],
    ['text/html', 'pdf', 'text/html', html, 'x.html', 'dateityp_ungueltig'], ['image/svg+xml', 'pdf', 'image/svg+xml', html, 'x.svg', 'dateityp_ungueltig'],
    ['Programm (application/x-msdownload)', 'datei', 'application/x-msdownload', exe, 'x.exe', 'dateityp_ungueltig'],
    ['JavaScript', 'datei', 'application/javascript', html, 'x.js', 'dateityp_ungueltig'],
    ['Typ "__proto__" (kein Absturz)', 'pdf', '__proto__', PDF(4000), 'x.pdf', 'dateityp_ungueltig'], ['Typ "constructor"', 'pdf', 'constructor', PDF(4000), 'x.pdf', 'dateityp_ungueltig'],
    ['octet-stream mit Endung .exe', 'datei', 'application/octet-stream', exe, 'x.exe', 'dateityp_ungueltig'],
    ['octet-stream ohne Dateinamen', 'pdf', 'application/octet-stream', PDF(4000), undefined, 'dateityp_ungueltig'],
    ['octet-stream, Endung .pdf aber Video-Lektion', 'video', 'application/octet-stream', PDF(4000), 'x.pdf', 'dateityp_ungueltig'],
    ['MP3-Typ, aber PDF-Inhalt', 'audio', 'audio/mpeg', PDF(4000), 'x.mp3', 'dateiinhalt_passt_nicht'],
    ['PDF-Typ, aber ZIP-Inhalt', 'pdf', 'application/pdf', ZIP(4000), 'x.pdf', 'dateiinhalt_passt_nicht'],
    ['PDF-Typ, aber HTML mit Skript', 'pdf', 'application/pdf', html, 'x.pdf', 'dateiinhalt_passt_nicht'],
    ['MP4-Typ, aber WebM-Inhalt', 'video', 'video/mp4', WEBM(4000), 'x.mp4', 'dateiinhalt_passt_nicht'],
    ['WebM-Typ, aber MP4-Inhalt', 'video', 'video/webm', MP4(4000), 'x.webm', 'dateiinhalt_passt_nicht'],
    ['ZIP-Typ gesperrt', 'datei', 'application/zip', PDF(4000), 'x.zip', 'dateityp_ungueltig'],
    ['DOCX-Typ gesperrt', 'datei', DOCX, exe, 'x.docx', 'dateityp_ungueltig'],
    ['OGG-Typ, aber MP3-Inhalt', 'audio', 'audio/ogg', MP3(4000), 'x.ogg', 'dateiinhalt_passt_nicht'],
    ['Sehr kurze Datei (3 Bytes) als PDF', 'pdf', 'application/pdf', Buffer.from('abc'), 'x.pdf', 'dateiinhalt_passt_nicht'],
    ['Leere Datei', 'pdf', 'application/pdf', Buffer.alloc(0), 'x.pdf', 'datei_leer'],
  ];
  for (const [name, art, typ, body, dateiname, code] of falsch) {
    const r = await putDatei(admin, L[art].id, body, typ, dateiname);
    pruefe(`${name}: 400 ${code}, ungarischer Text`, r.s === 400 && r.d.fehler === code && typeof r.d.text === 'string' && /[áéíóöőúüű]/i.test(r.d.text), JSON.stringify(r.d));
  }
  pruefe('Nach all den Ablehnungen: Ordner und Datenbank unverändert (keine Teildateien, keine Reste)', JSON.stringify(ordnerInhalt()) === JSON.stringify(stand.ordner) && JSON.stringify(dbNamen()) === JSON.stringify(stand.db));
  const blockiert = new Map(zeilen('SELECT lektion_id, pfad FROM dateien').map((x) => [x.lektion_id, x.pfad]));
  pruefe('Die alten, gültigen Dateien sind nach den Fehlversuchen noch dieselben', blockiert.size === 3);

  // =================================================================================================
  abschnitt('Upload: zu groß (Obergrenze im Test 1 MB)');
  const zuGross = await putDatei(admin, L.leer.id, PDF(MAX + 1), 'application/pdf', 'gross.pdf');
  pruefe('Ein Byte über der Obergrenze: 413 datei_zu_gross, ungarischer Text, nichts gespeichert', zuGross.s === 413 && zuGross.d.fehler === 'datei_zu_gross' && ordnerInhalt().length === 3 && zahl('SELECT COUNT(*) FROM dateien WHERE lektion_id = ?', L.leer.id) === 0, JSON.stringify(zuGross.d));
  const chunked = await rohPut(admin.cookie, L.leer.id, { typ: 'application/pdf', name: 'gross.pdf', stuecke: [PDF(300000), muster(300000), muster(300000), muster(300000), muster(300000)] });   // 1,5 MB ohne Content-Length
  await warte(300);
  pruefe('Ohne Content-Length (chunked) 1,5 MB: der Server stoppt beim Überschreiten, 413, Teildatei gelöscht', ((chunked.s === 413 && chunked.d.fehler === 'datei_zu_gross') || chunked.fehler === 'ECONNRESET') && ordnerInhalt().every((n) => !n.startsWith('.tmp-')) && ordnerInhalt().length === 3, JSON.stringify(chunked));
  const genau = await putDatei(admin, L.leer.id, PDF(MAX), 'application/pdf', 'genau.pdf');
  pruefe('Genau die Obergrenze (1 MB) ist erlaubt: 201 mit der vollen Größe', genau.s === 201 && genau.d.groesse === MAX, JSON.stringify(genau.d));
  const genauBytes = await k1.anfrage('GET', `/api/lektionen/${L.leer.id}/datei`);
  pruefe('... und kommt Byte für Byte wieder heraus (1 MB, gestreamt)', genauBytes.s === 200 && genauBytes.buf.equals(PDF(MAX)));

  // =================================================================================================
  abschnitt('Namen: nie ein Pfad, immer ein Zufallsname');
  const vorher = readdirSync(BASIS).sort();
  const namen = [
    ['../../etc/passwd.pdf', 'passwd.pdf'], ['..\\..\\windows\\system32\\evil.pdf', 'evil.pdf'], ['/absolut/pfad/datei.pdf', 'datei.pdf'],
    ['.htaccess.pdf', 'htaccess.pdf'], ['a<b>c:d"e|f?g*h.pdf', 'abcdefgh.pdf'], ['', 'fajl'], ['Színtanácsadás ütem.pdf', 'Színtanácsadás ütem.pdf'],
    ['a'.repeat(500) + '.pdf', 'a'.repeat(200)],
  ];
  const lekNamen = await lek(kurs.id, 'pdf');
  for (const [roh, erwartet] of namen) {
    const r = await putDatei(admin, lekNamen.id, PDF(2000), 'application/pdf', roh);
    pruefe(`Dateiname "${roh.slice(0, 40)}": Anzeigename "${erwartet.slice(0, 30)}"`, r.s === 201 && r.d.name === erwartet, JSON.stringify(r.d).slice(0, 120));
  }
  const unterstrich = await putDatei(admin, lekNamen.id, PDF(2000), 'application/pdf', undefined, { 'X-Dateiname': 'kaputt%zz%2.pdf' });
  pruefe('Kaputt kodierter Name (%zz): kein Absturz, wird als Text genommen', unterstrich.s === 201 && unterstrich.d.name.startsWith('kaputt'), JSON.stringify(unterstrich.d));
  const crlf = await putDatei(admin, lekNamen.id, PDF(2000), 'application/pdf', 'evil\r\nSet-Cookie: x=1\r\n.pdf');
  const crlfGet = await k1.anfrage('GET', `/api/lektionen/${lekNamen.id}/datei`);
  pruefe('Name mit Zeilenumbruch (Header-Einschleusung): Zeilenumbrüche entfernt, in der Antwort kein zusätzlicher Header', crlf.s === 201 && !/[\r\n]/.test(crlf.d.name) && crlfGet.s === 200 && !crlfGet.kopf.has('set-cookie') && !/[\r\n]/.test(crlfGet.kopf.get('content-disposition')), JSON.stringify(crlf.d));
  pruefe('Kein einziger Eintrag außerhalb des Test-Ordners entstand (weder im Basis- noch im Temp-Ordner)', JSON.stringify(readdirSync(BASIS).sort().filter((n) => !/^test\.db/.test(n))) === JSON.stringify(vorher.filter((n) => !/^test\.db/.test(n))) && ['etc', 'windows', 'absolut', 'passwd.pdf', 'evil.pdf', 'datei.pdf'].every((n) => !existsSync(join(tmpdir(), n)) && !existsSync(join(BASIS, n))), readdirSync(BASIS).join(','));
  const alleDb = zeilen('SELECT pfad, name FROM dateien');
  pruefe('Der Speichername ist immer eine zufällige UUID, ohne Bezug zum Originalnamen', alleDb.every((x) => UUID.test(x.pfad)) && new Set(alleDb.map((x) => x.pfad)).size === alleDb.length && alleDb.every((x) => !x.pfad.includes('passwd') && !x.pfad.includes('pdf') && !/[\\/]/.test(x.pfad)));
  pruefe('Ordner und Datenbank stimmen auch hier überein (keine verwaisten Dateien)', JSON.stringify(ordnerInhalt()) === JSON.stringify(dbNamen()));
  const lUni = await lek(kurs.id, 'pdf');
  await putDatei(admin, lUni.id, PDF(2000), 'application/pdf', 'Színtanácsadás ütem.pdf');
  const uni = await k1.anfrage('GET', `/api/lektionen/${lUni.id}/datei`);
  const cd = uni.kopf.get('content-disposition');
  pruefe('Content-Disposition: neutral inline, ohne Originalname', cd === 'inline', cd);

  // =================================================================================================
  abschnitt('Ersetzen: der neue Upload löscht die alte Datei');
  const lErs = await lek(kurs.id, 'pdf');
  const ersA = PDF(5000, 11), ersB = PDF(6000, 17);
  await putDatei(admin, lErs.id, ersA, 'application/pdf', 'alt.pdf');
  const alt = zeilen('SELECT pfad FROM dateien WHERE lektion_id = ?', lErs.id)[0].pfad;
  pruefe('Erste Datei liegt unter ihrem Zufallsnamen auf der Platte', existsSync(join(ORDNER, alt)));
  const neu = await putDatei(admin, lErs.id, ersB, 'application/pdf', 'neu.pdf');
  const neuName = zeilen('SELECT pfad FROM dateien WHERE lektion_id = ?', lErs.id);
  pruefe('Zweiter Upload: 201, genau EINE Zeile je Lektion, neuer Zufallsname, die alte Datei ist vom Datenträger gelöscht', neu.s === 201 && neuName.length === 1 && neuName[0].pfad !== alt && !existsSync(join(ORDNER, alt)) && existsSync(join(ORDNER, neuName[0].pfad)));
  const ersGet = await k1.anfrage('GET', `/api/lektionen/${lErs.id}/datei`);
  pruefe('Ausgeliefert wird danach die neue Datei', ersGet.s === 200 && ersGet.buf.equals(ersB));
  unlinkSync(join(ORDNER, neuName[0].pfad));                       // Datei verschwindet von der Platte (z. B. Datenträger-Problem)
  pruefe('Fehlt die Datei auf der Platte: Auslieferung 404 datei_fehlt (kein Absturz, kein Pfad)', (await k1.anfrage('GET', `/api/lektionen/${lErs.id}/datei`)).d.fehler === 'datei_fehlt');
  const ersC = await putDatei(admin, lErs.id, PDF(1000, 5), 'application/pdf', 'wieder.pdf');
  pruefe('Ein Upload ersetzt auch eine Datei, die auf der Platte fehlt (kein Absturz)', ersC.s === 201 && zahl('SELECT COUNT(*) FROM dateien WHERE lektion_id = ?', lErs.id) === 1);
  const lPar = await lek(kurs.id, 'pdf');
  const [p1, p2] = await Promise.all([putDatei(admin, lPar.id, PDF(200000, 3), 'application/pdf', 'p1.pdf'), putDatei(admin, lPar.id, PDF(200000, 9), 'application/pdf', 'p2.pdf')]);
  const parZeilen = zeilen('SELECT pfad FROM dateien WHERE lektion_id = ?', lPar.id);
  pruefe('Zwei gleichzeitige Uploads zur selben Lektion: beide beantwortet, am Ende eine Zeile und eine Datei (die Verlierer-Datei ist weg)', [p1.s, p2.s].every((s) => s === 201) && parZeilen.length === 1 && JSON.stringify(ordnerInhalt()) === JSON.stringify(dbNamen()), `${p1.s}/${p2.s}`);

  // =================================================================================================
  abschnitt('Ausliefern: nur Käufer und Admin');
  const lPdf = L.pdf.id;
  const bytesPdf = zeilen('SELECT groesse FROM dateien WHERE lektion_id = ?', lPdf)[0].groesse;
  const a0 = await gast.anfrage('GET', `/api/lektionen/${lPdf}/datei`);
  pruefe('Gast: 401 (ohne Dateiinhalt)', a0.s === 401 && a0.d.fehler === 'nicht_angemeldet' && a0.buf.length < 300);
  const a1 = await k2.anfrage('GET', `/api/lektionen/${lPdf}/datei`);
  pruefe('Angemeldet, aber ohne Zugang: 403 kein_zugang, ungarischer Text, ohne Dateiinhalt', a1.s === 403 && a1.d.fehler === 'kein_zugang' && a1.d.text.length > 5 && a1.buf.length < 300);
  const a2 = await k1.anfrage('GET', `/api/lektionen/${lPdf}/datei`);
  const pdfLetzt = PDF(4000);
  pruefe('Mit Zugang: 200 und genau der hochgeladene Inhalt', a2.s === 200 && a2.buf.equals(pdfLetzt), `${a2.s} ${a2.buf.length}/${bytesPdf}`);
  const a3 = await admin.anfrage('GET', `/api/lektionen/${lPdf}/datei`);
  pruefe('Admin: 200 und derselbe Inhalt', a3.s === 200 && a3.buf.equals(pdfLetzt));
  pruefe('Unbekannte Lektion: 404, ungültige ID: 400', (await k1.anfrage('GET', '/api/lektionen/99999/datei')).s === 404 && (await k1.anfrage('GET', '/api/lektionen/abc/datei')).d.fehler === 'ungueltige_id');
  pruefe('Lektion ohne Datei: 404 datei_fehlt', (await k1.anfrage('POST', `/api/lektionen/${(await lek(kurs.id, 'pdf')).id}/wiedergabe`, {})).d.fehler === 'datei_fehlt');
  const verst = await putDatei(admin, L.versteckt.id, PDF(2000), 'application/pdf', 'v.pdf');
  pruefe('Unveröffentlichte Lektion: Kunde MIT Zugang 404, Kunde OHNE Zugang auch 404 (verrät nichts), Admin 200', verst.s === 201 && (await k1.anfrage('GET', `/api/lektionen/${L.versteckt.id}/datei`)).s === 404 && (await k2.anfrage('GET', `/api/lektionen/${L.versteckt.id}/datei`)).s === 404 && (await admin.anfrage('GET', `/api/lektionen/${L.versteckt.id}/datei`)).s === 200);
  await putDatei(admin, LEntwurf.id, PDF(2000), 'application/pdf', 'e.pdf');
  pruefe('Lektion eines unveröffentlichten Kurses: Kunde (auch mit Zugang) 404, Admin 200', (await k1.anfrage('GET', `/api/lektionen/${LEntwurf.id}/datei`)).s === 404 && (await admin.anfrage('GET', `/api/lektionen/${LEntwurf.id}/datei`)).s === 200);
  await admin.anfrage('PATCH', `/api/admin/lektionen/${lPdf}`, { status: 'entwurf' });
  pruefe('Lektion nachträglich versteckt: Kunde sofort 404, die Datei bleibt auf der Platte geschützt', (await k1.anfrage('GET', `/api/lektionen/${lPdf}/datei`)).s === 404 && (await admin.anfrage('GET', `/api/lektionen/${lPdf}/datei`)).s === 200);
  await admin.anfrage('PATCH', `/api/admin/lektionen/${lPdf}`, { status: 'veroeffentlicht' });
  pruefe('... wieder sichtbar gemacht: Kunde 200', (await k1.anfrage('GET', `/api/lektionen/${lPdf}/datei`)).s === 200);
  const dR = db(); dR.prepare('DELETE FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ?').run(k1Id, kurs.id); dR.close();
  pruefe('Zugang entzogen (z. B. Erstattung): schon der nächste Abruf ist 403 (Prüfung bei jedem Aufruf)', (await k1.anfrage('GET', `/api/lektionen/${lPdf}/datei`)).s === 403);
  const dR2 = db(); dR2.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, erstellt) VALUES (?, ?, 'einladung', ?)").run(k1Id, kurs.id, new Date().toISOString()); dR2.close();
  pruefe('... Zugang zurück: wieder 200', (await k1.anfrage('GET', `/api/lektionen/${lPdf}/datei`)).s === 200);
  const alterCookie = k1.cookie;
  await k1.anfrage('POST', '/api/abmelden', {});
  const ohne = await fetch(`${BASE}/api/lektionen/${lPdf}/datei`, { headers: { Cookie: alterCookie } });
  pruefe('Nach dem Abmelden ist der alte Cookie wertlos: 401', ohne.status === 401);
  await k1.anfrage('POST', '/api/anmelden', { email: zeilen('SELECT email FROM benutzer WHERE id = ?', k1Id)[0].email, passwort: pw });

  abschnitt('Ausliefern: Kopfzeilen');
  const h1 = a2.kopf;
  pruefe('Content-Type kommt aus der Datenbank (application/pdf), nosniff, Cache-Control private, no-store', h1.get('content-type') === 'application/pdf' && h1.get('x-content-type-options') === 'nosniff' && h1.get('cache-control') === 'private, no-store', [...h1].join(' | '));
  pruefe('Accept-Ranges: bytes, richtige Content-Length, Cross-Origin-Resource-Policy: same-origin', h1.get('accept-ranges') === 'bytes' && Number(h1.get('content-length')) === pdfLetzt.length && h1.get('cross-origin-resource-policy') === 'same-origin');
  const csp = h1.get('content-security-policy') || '';
  pruefe("Auch die Sicherheits-Kopfzeilen (CSP mit media-src 'self' und object-src 'none') stehen auf der Datei-Antwort", csp.includes("media-src 'self'") && csp.includes("object-src 'none'") && csp.includes("default-src 'self'") && !/unsafe|\*/.test(csp), csp);
  pruefe('PDF wird inline gezeigt', /^inline$/.test(h1.get('content-disposition')));
  const dv = await k1.anfrage('GET', `/api/lektionen/${L.video.id}/datei`), da = await k1.anfrage('GET', `/api/lektionen/${L.audio.id}/datei`), dd = await k1.anfrage('GET', `/api/lektionen/${L.datei.id}/datei`);
  pruefe('Video und Audio inline, alte Datei-Lektion nicht auslieferbar', /^inline$/.test(dv.kopf.get('content-disposition')) && dv.kopf.get('content-type') === 'video/mp4' && /^inline$/.test(da.kopf.get('content-disposition')) && da.kopf.get('content-type') === 'audio/ogg' && dd.s === 403, `${dv.kopf.get('content-type')} ${da.kopf.get('content-type')} ${dd.kopf.get('content-type')}`);
  const ticketKopf = await k1.anfrage('POST', '/api/lektionen/' + lPdf + '/wiedergabe', {});
  const kopfAnfrage = await fetch(BASE + '/api/lektionen/' + lPdf + '/datei?ticket=' + encodeURIComponent(ticketKopf.d.ticket), { method: 'HEAD', headers: { Cookie: k1.cookie } });
  pruefe('HEAD: 200 mit Content-Length, ohne Inhalt', kopfAnfrage.status === 200 && Number(kopfAnfrage.headers.get('content-length')) === pdfLetzt.length && (await kopfAnfrage.arrayBuffer()).byteLength === 0);
  const kursJson = await k1.anfrage('GET', `/api/kurse/${kurs.id}`);
  const adminJson = await admin.anfrage('GET', `/api/kurse/${kurs.id}`);
  pruefe('/api/kurse/:id nennt die Datei (Name, Art, Größe), aber nie Speichername oder Pfad, auch nicht für den Admin', kursJson.d.lektionen.some((l) => l.dateien?.length === 1 && l.dateien[0].name) && !JSON.stringify([kursJson.d, adminJson.d]).match(/"pfad"|[0-9a-f]{8}-[0-9a-f]{4}-/) && Object.keys(kursJson.d.lektionen.find((l) => l.id === L.pdf.id).dateien[0]).sort().join() === 'art,groesse,id,name');
  const gesperrt = await k2.anfrage('GET', `/api/kurse/${kurs.id}`);
  pruefe('Ohne Zugang zeigt /api/kurse/:id nicht einmal, ob eine Datei existiert', !JSON.stringify(gesperrt.d).includes('dateien'));
  pruefe('Die Datei ist über keine öffentliche Adresse erreichbar (nicht über den Speichernamen, nicht über /daten, nicht über /dateien)', (await Promise.all(zeilen('SELECT pfad FROM dateien').flatMap((x) => [`/${x.pfad}`, `/dateien/${x.pfad}`, `/daten/dateien/${x.pfad}`, `/admin/${x.pfad}`]).map((p) => fetch(BASE + p).then((r) => r.status)))).every((s) => s === 404));
  pruefe('Auslieferung läuft nicht über express.static und der Server hebt das Zeitlimit für große Uploads an', !/express\.static\([^)]*(ordner|ORDNER|dateien)/i.test(readFileSync('app.mjs', 'utf8') + readFileSync('dateien.mjs', 'utf8')) && /requestTimeout/.test(readFileSync('server.mjs', 'utf8')));

  // =================================================================================================
  abschnitt('Teilabrufe (Range) für Video und Audio');
  const lR = await lek(kurs.id, 'video');
  const RB = WEBM(10000, 23);
  await putDatei(admin, lR.id, RB, 'video/webm', 'r.webm');
  const rg = (wert, c = k1) => c.anfrage('GET', `/api/lektionen/${lR.id}/datei`, undefined, wert === undefined ? {} : { Range: wert });
  const teil = async (wert, von, bis) => { const r = await rg(wert); return r.s === 206 && r.buf.equals(RB.subarray(von, bis + 1)) && r.kopf.get('content-range') === `bytes ${von}-${bis}/10000` && Number(r.kopf.get('content-length')) === bis - von + 1; };
  pruefe('Ohne Range: 200 mit der ganzen Datei und Accept-Ranges', (await rg(undefined)).buf.equals(RB) && (await rg(undefined)).kopf.get('accept-ranges') === 'bytes');
  pruefe('bytes=0-99: 206, genau diese 100 Bytes, richtiges Content-Range und Content-Length', await teil('bytes=0-99', 0, 99));
  pruefe('bytes=9900-: 206, die letzten 100 Bytes', await teil('bytes=9900-', 9900, 9999));
  pruefe('bytes=-50: 206, die letzten 50 Bytes', await teil('bytes=-50', 9950, 9999));
  pruefe('bytes=5000-5000: 206, genau 1 Byte aus der Mitte', await teil('bytes=5000-5000', 5000, 5000));
  pruefe('bytes=9999-: 206, das allerletzte Byte', await teil('bytes=9999-', 9999, 9999));
  pruefe('bytes=0-999999999 (Ende über der Größe): wird auf das Dateiende gekürzt, 206', await teil('bytes=0-999999999', 0, 9999));
  pruefe('bytes=-99999 (mehr als die Datei): ganze Datei als 206', await teil('bytes=-99999', 0, 9999));
  pruefe('Große Datei (1 MB): bytes=1000000-1048575 liefert genau diesen Ausschnitt', await (async () => { const r = await k1.anfrage('GET', `/api/lektionen/${L.leer.id}/datei`, undefined, { Range: 'bytes=1000000-1048575' }); return r.s === 206 && r.buf.equals(PDF(MAX).subarray(1000000, 1048576)); })());
  for (const wert of ['bytes=10000-', 'bytes=999999-', 'bytes=5-2', 'bytes=abc', 'bytes=-0', 'bytes=-', 'bytes=0-1,5-6', 'bytes=99999999999999999999-']) {
    const r = await rg(wert);
    pruefe(`Unsinniger Bereich "${wert}": 416 mit Content-Range bytes */10000 und ungarischem Text, kein Dateiinhalt`, r.s === 416 && r.kopf.get('content-range') === 'bytes */10000' && r.d.fehler === 'bereich_ungueltig' && r.buf.length < 300, `${r.s} ${r.kopf.get('content-range')}`);
  }
  pruefe('Unbekannte Einheit ("items=0-5") wird ignoriert: 200 mit der ganzen Datei', (await rg('items=0-5')).s === 200);
  pruefe('Range schützt nicht vor der Zugangsprüfung: Gast 401, ohne Zugang 403 (auch mit gültigem Bereich)', (await rg('bytes=0-9', gast)).s === 401 && (await rg('bytes=0-9', k2)).s === 403);
  const ticketRange = await k1.anfrage('POST', '/api/lektionen/' + lR.id + '/wiedergabe', {});
  const kopfR = await fetch(BASE + '/api/lektionen/' + lR.id + '/datei?ticket=' + encodeURIComponent(ticketRange.d.ticket), { headers: { Cookie: k1.cookie, Range: 'bytes=0-9' } });
  pruefe('Auch bei 206 stehen Content-Type, nosniff und Cache-Control private, no-store', kopfR.status === 206 && kopfR.headers.get('content-type') === 'video/webm' && kopfR.headers.get('x-content-type-options') === 'nosniff' && kopfR.headers.get('cache-control') === 'private, no-store');
  await kopfR.arrayBuffer();

  // =================================================================================================
  abschnitt('Abbruch mitten im Upload hinterlässt keine Teildatei');
  const lAb = await lek(kurs.id, 'pdf');
  const vorherOrdner = ordnerInhalt();
  const ab1 = await rohPut(admin.cookie, lAb.id, { typ: 'application/pdf', name: 'abbruch.pdf', laenge: 900000, stuecke: [PDF(60000), muster(60000), muster(60000)], abbrechenNach: 120000 });
  for (let i = 0; i < 30 && JSON.stringify(ordnerInhalt()) !== JSON.stringify(vorherOrdner); i++) await warte(100);
  pruefe('Browser bricht nach 120 KB ab: danach liegt nichts Neues im Ordner (auch keine .tmp-Datei) und keine Datenbankzeile', ab1.abgebrochen && JSON.stringify(ordnerInhalt()) === JSON.stringify(vorherOrdner) && zahl('SELECT COUNT(*) FROM dateien WHERE lektion_id = ?', lAb.id) === 0, ordnerInhalt().join(','));
  const ab2 = await rohPut(admin.cookie, lAb.id, { typ: 'application/pdf', name: 'abbruch.pdf', laenge: 900000, stuecke: [Buffer.from('%PDF-')], abbrechenNach: 5 });
  await warte(500);
  pruefe('Abbruch schon nach 5 Bytes (vor der Prüfung der ersten Bytes): auch nichts übrig', ab2.abgebrochen && JSON.stringify(ordnerInhalt()) === JSON.stringify(vorherOrdner));
  const vorhanden = zeilen('SELECT pfad FROM dateien WHERE lektion_id = ?', lR.id)[0].pfad;
  const ab3 = await rohPut(admin.cookie, lR.id, { typ: 'video/webm', name: 'neu.webm', laenge: 900000, stuecke: [WEBM(60000, 5), muster(60000), muster(60000)], abbrechenNach: 100000 });
  await warte(600);
  const nachAbbruch = await rg('bytes=0-9999');
  pruefe('Abbruch beim ERSETZEN: die bisherige Datei bleibt unversehrt und wird weiter ausgeliefert', ab3.abgebrochen && zeilen('SELECT pfad FROM dateien WHERE lektion_id = ?', lR.id)[0].pfad === vorhanden && nachAbbruch.s === 206 && nachAbbruch.buf.equals(RB) && JSON.stringify(ordnerInhalt()) === JSON.stringify(vorherOrdner));
  const falschMitten = await rohPut(admin.cookie, lAb.id, { typ: 'application/pdf', name: 'x.pdf', stuecke: [Buffer.from('<html>'), muster(40000), muster(40000)] });
  await warte(300);
  pruefe('Falsche Magic Bytes in einem chunked Upload: 400 dateiinhalt_passt_nicht, nichts übrig', (falschMitten.s === 400 && falschMitten.d.fehler === 'dateiinhalt_passt_nicht') && JSON.stringify(ordnerInhalt()) === JSON.stringify(vorherOrdner), JSON.stringify(falschMitten));
  const rest = join(ORDNER, '.tmp-uebriggebliebener-upload');
  writeFileSync(rest, 'rest');
  erstelleServer(optionen);                                       // zweiter Start im selben Ordner: räumt Reste abgebrochener Uploads weg
  pruefe('Beim Start werden Reste (.tmp-...) früherer Abbrüche gelöscht, echte Dateien bleiben', !existsSync(rest) && JSON.stringify(ordnerInhalt()) === JSON.stringify(vorherOrdner));

  // =================================================================================================
  abschnitt('Änderungen an Lektionen');
  pruefe('Typ einer Lektion mit Datei ändern: 400 art_hat_datei (ungarisch)', (await admin.anfrage('PATCH', `/api/admin/lektionen/${lPdf}`, { art: 'video' })).d.fehler === 'art_hat_datei');
  pruefe('Ohne Datei darf der Typ geändert werden; derselbe Typ nochmal ist auch mit Datei kein Fehler', (await admin.anfrage('PATCH', `/api/admin/lektionen/${lAb.id}`, { art: 'audio' })).s === 200 && (await admin.anfrage('PATCH', `/api/admin/lektionen/${lPdf}`, { art: 'pdf' })).s === 200);

  abschnitt('Kein Pfad der Platte erscheint je in einer Antwort');
  const geheim = [ORDNER, BASIS, tmpdir(), ...zeilen('SELECT pfad FROM dateien').map((x) => x.pfad)];
  const treffer = geheim.filter((g) => antworten.some((a) => a.includes(g)));
  pruefe(`Keine der ${antworten.length} gesammelten Antworten (Kopfzeilen und Texte) enthält den Ordnerpfad, den Temp-Pfad oder einen Speichernamen`, antworten.length > 100 && treffer.length === 0, treffer.join(', '));
} catch (e) {
  schlecht++; console.log('FEHLER  Unerwarteter Abbruch: ' + e.stack);
} finally {
  if (server) server.close();
  await warte(400);
  aufraeumen(BASIS);
  console.log(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`);
  process.exit(schlecht === 0 ? 0 : 1);
}
