// Echter Browsertest (NICHT Teil von Selbsttest-Alle, braucht Chrome und playwright-core unter C:\Users\diaco\Projekte\browser-werkzeug):
// Der Admin laedt im echten Chrome ein Video ueber die Oberflaeche hoch. Bunny ist eine Attrappe; der TUS-Server von Bunny wird im Browser nachgebaut
// (Playwright faengt https://video.bunnycdn.com ab), die Content-Security-Policy gilt dabei ECHT. Aufruf aus dem Repo-Ordner:
//   node --disable-warning=ExperimentalWarning tools\browsertest-bunny-upload.mjs
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core');
const ordner = mkdtempSync(join(tmpdir(), 'schulung-browser-up-'));
process.env.DB_DATEI = join(ordner, 'test.db');
const PASS = randomBytes(24).toString('hex');
const HU = JSON.parse(readFileSync(new URL('../texte/hu.json', import.meta.url), 'utf8'));
let ok = 0, fehler = 0;
const pruefe = (name, wert, detail = '') => { wert ? ok++ : fehler++; console.log((wert ? 'OK     ' : 'FEHLER ') + name + (!wert && detail ? ' ' + detail : '')); };

const { db } = await import('../db.mjs');
const { passwortHashen } = await import('../auth.mjs');
const { erstelleServer } = await import('../app.mjs');
const { erstelleBunny } = await import('../bunny.mjs');
const ph = await passwortHashen(PASS); const jetzt = () => new Date().toISOString();
db.prepare('INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,?,?,?)').run('bu-admin@example.com', ph, 'admin', jetzt(), Date.now());
const kurs = Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES ('Browser-Kurs','',0,'huf','entwurf',?,?)").run(jetzt(), jetzt()).lastInsertRowid);
const lek1 = Number(db.prepare("INSERT INTO lektionen(kurs_id,titel,art,reihenfolge,erstellt,geaendert) VALUES (?,?,'video',1,?,?)").run(kurs, 'Erstes Video', jetzt(), jetzt()).lastInsertRowid);
const lek2 = Number(db.prepare("INSERT INTO lektionen(kurs_id,titel,art,reihenfolge,erstellt,geaendert) VALUES (?,?,'video',2,?,?)").run(kurs, 'Zweites Video', jetzt(), jetzt()).lastInsertRowid);
const lek3 = Number(db.prepare("INSERT INTO lektionen(kurs_id,titel,art,reihenfolge,erstellt,geaendert) VALUES (?,?,'video',3,?,?)").run(kurs, 'Drittes Video (PDF-Test)', jetzt(), jetzt()).lastInsertRowid);
const lek4 = Number(db.prepare("INSERT INTO lektionen(kurs_id,titel,art,reihenfolge,erstellt,geaendert) VALUES (?,?,'video',4,?,?)").run(kurs, 'Viertes Video (Netzabbruch)', jetzt(), jetzt()).lastInsertRowid);
const lek5 = Number(db.prepare("INSERT INTO lektionen(kurs_id,titel,art,reihenfolge,erstellt,geaendert) VALUES (?,?,'video',5,?,?)").run(kurs, 'Fuenftes Video (geloescht)', jetzt(), jetzt()).lastInsertRowid);
const zeile = (l) => db.prepare('SELECT * FROM dateien WHERE lektion_id = ?').get(l);
const ausstehend = (l) => db.prepare('SELECT * FROM bunny_ausstehend WHERE lektion_id = ?').get(l);

const lebende = new Set();
const bunny = erstelleBunny({ bibliothek: '12345', apiKey: 'api-key-test-0001', tokenKey: 'token-key-test-0001' }, { fetchFn: async (url, opt) => {
  const json = (o, s = 200) => ({ ok: s < 300, status: s, json: async () => o });
  if (opt.method === 'POST') { const g = randomUUID(); lebende.add(g); return json({ guid: g }); }
  if (opt.method === 'GET') return json({ status: 4, length: 12.3, availableResolutions: '720p' });
  if (opt.method === 'DELETE') { lebende.delete(url.split('/').pop()); return json({ success: true }); }
  return json({}, 500);
} });
const BASE = 'http://127.0.0.1:4571';
const server = erstelleServer({ stripe: { webhooks: {} }, webhookSecret: 't', base: BASE, dateiOrdner: join(ordner, 'd'), abgleichAutomatik: false, bunny }).listen(4571, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await browser.newContext({ locale: 'hu-HU', viewport: { width: 1200, height: 900 } });

// ---- TUS-Server von Bunny nachgebaut ------------------------------------------------------------------------------------------------
const tus = { modus: 'ok', posts: [], heads: 0, patches: 0, abgebrochen: 0, bytes: 0, laenge: 0, offset: 0, loescheLektion: 0 };
await ctx.route('https://video.bunnycdn.com/**', async (route) => {
  const req = route.request(), m = req.method();
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Location, Upload-Offset, Upload-Length, Tus-Resumable', 'Tus-Resumable': '1.0.0' };
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, HEAD, PATCH, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Max-Age': '600' } });
  if (m === 'POST') {
    const h = req.headers();
    tus.posts.push({ url: req.url(), signatur: h['authorizationsignature'], ablauf: h['authorizationexpire'], video: h['videoid'], bibliothek: h['libraryid'], meta: h['upload-metadata'], laenge: h['upload-length'] });
    if (tus.modus === 'abgelaufen') return route.fulfill({ status: 401, headers: cors, body: 'expired' });
    tus.laenge = Number(h['upload-length']); tus.offset = 0;
    return route.fulfill({ status: 201, headers: { ...cors, Location: 'https://video.bunnycdn.com/tusupload/abc123' } });
  }
  if (m === 'HEAD') { tus.heads++; } if (m === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'Upload-Offset': String(tus.offset), 'Upload-Length': String(tus.laenge) } });
  if (m === 'PATCH') {
    if (tus.modus === 'netzabbruch' && !tus.abgebrochen) { tus.abgebrochen++; await ctx.setOffline(true); return route.abort('internetdisconnected'); }   // Netz weg mitten im Upload
    const body = req.postDataBuffer(); tus.patches++; tus.bytes += body ? body.length : 0; tus.offset += body ? body.length : 0;
    if (tus.loescheLektion && tus.offset >= tus.laenge) { db.prepare('DELETE FROM lektionen WHERE id = ?').run(tus.loescheLektion); tus.loescheLektion = 0; }   // Lektion verschwindet, waehrend der Browser nachfragt
    return route.fulfill({ status: 204, headers: { ...cors, 'Upload-Offset': String(tus.offset) } });
  }
  return route.fulfill({ status: 404, headers: cors });
});

const page = await ctx.newPage();
const csp = [];
page.on('console', (mm) => { const t = mm.text(); if (/Content Security Policy|Refused to|violates/i.test(t)) csp.push(t.slice(0, 200)); });
page.on('pageerror', (e) => csp.push('PAGEERROR ' + String(e.message).slice(0, 160)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(async (p) => (await fetch('/api/anmelden', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bu-admin@example.com', passwort: p }) })).status, PASS);
await page.goto('about:blank');
await page.goto(BASE + '/admin/', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: HU.a_megnyitas }).first().click();
await page.waitForSelector('input[type=file][accept="video/*"]', { state: 'attached', timeout: 15000 }).catch(() => {});   // baut sich die Seite nicht auf, meldet die naechste Pruefung den Fehler
const felder = await page.locator('input[type=file][accept="video/*"]').count();
pruefe('Admin-Oberflaeche: bei jeder der fuenf Videolektionen gibt es den Bunny-Upload', felder === 5, String(felder));

// ---- Szenario 1: erfolgreicher Upload ---------------------------------------------------------------------------------------------------
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), Buffer.from('isom0000isomiso2'), randomBytes(3 * 1024 * 1024)]);
await page.locator('input[type=file][accept="video/*"]').nth(0).setInputFiles({ name: 'mein-video.mp4', mimeType: 'video/mp4', buffer: mp4 });
await page.getByText(HU.a_bunny_kesz).first().waitFor({ timeout: 40000 }).catch(() => {});   // bleibt der Upload stecken, melden die folgenden Pruefungen den Fehler
const z1 = zeile(lek1);
pruefe('Upload im Browser: das Video liegt danach als Bunny-Video in der Lektion (Status fertig)', z1?.quelle === 'bunny' && z1.bunny_status === 'fertig' && lebende.has(z1.bunny_video_id));
const p1 = tus.posts[0];
pruefe('TUS-Anfrage: Adresse, Signatur (64 Hex), Ablauf, Video-ID und Bibliothek wie vom Server vorgegeben', p1?.url === 'https://video.bunnycdn.com/tusupload' && /^[0-9a-f]{64}$/.test(p1.signatur || '') && /^\d{10}$/.test(p1.ablauf || '') && p1.video === z1.bunny_video_id && p1.bibliothek === '12345');
const meta = Object.fromEntries((p1?.meta || '').split(',').map((kv) => { const [k, v] = kv.split(' '); return [k, Buffer.from(v || '', 'base64').toString('utf8')]; }));
pruefe('TUS-Metadaten: filetype=video/mp4 und title=Lektionstitel (Bunny-Doku: Pflichtfelder)', meta.filetype === 'video/mp4' && meta.title === 'Erstes Video', JSON.stringify(meta));
pruefe('Alle Bytes kamen an (Upload-Laenge = Dateigroesse, gesendete Bytes = Dateigroesse)', Number(p1?.laenge) === mp4.length && tus.bytes === mp4.length, `${p1?.laenge} / ${tus.bytes} / ${mp4.length}`);
pruefe('Die Oberflaeche zeigt danach "Bunny-Video: kész" und keine Dateigroesse', (await page.locator('body').innerText()).includes(HU.a_bunny_st_fertig));
pruefe('Content-Security-Policy hat nichts blockiert (Upload zu video.bunnycdn.com erlaubt)', csp.length === 0, csp.join(' | '));
pruefe('Der API-Schluessel kam nie im Browser an (nicht in der Seite, nicht in den TUS-Anfragen)', !(await page.content()).includes('api-key-test-0001') && !JSON.stringify(tus.posts).includes('api-key-test-0001'));

// ---- Szenario 2: abgelaufene Upload-Berechtigung (401) -> verstaendliche Meldung, nichts veraendert -----------------------------------
tus.modus = 'abgelaufen'; tus.posts.length = 0;
await page.locator('input[type=file][accept="video/*"]').nth(1).setInputFiles({ name: 'zweites.mp4', mimeType: 'video/mp4', buffer: mp4.subarray(0, 100000) });
const meldungSichtbar = await page.getByText(HU.a_bunny_lejart).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
pruefe('Abgelaufene Berechtigung (401): die ungarische Meldung ist wirklich zu sehen, keine Datei in der Lektion, die alte Lektion unveraendert', meldungSichtbar && !zeile(lek2) && zeile(lek1)?.quelle === 'bunny');
pruefe('Bei 401 wird nicht endlos wiederholt (nur ein Versuch)', tus.posts.length === 1, String(tus.posts.length));

// ---- Szenario 3: falscher Dateityp (PDF) -> sofort abgelehnt, es wird gar kein Video bei Bunny angelegt -------------------------------------
tus.modus = 'ok'; tus.posts.length = 0; const anlegenVorher = lebende.size;
await page.locator('input[type=file][accept="video/*"]').nth(2).setInputFiles({ name: 'dokument.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
const pdfMeldung = await page.getByText(HU.a_bunny_nur_video_fajl).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
pruefe('PDF in das Video-Feld: ungarische Meldung, KEIN Video bei Bunny angelegt, kein ausstehender Eintrag, keine TUS-Anfrage', pdfMeldung && lebende.size === anlegenVorher && !ausstehend(lek3) && !zeile(lek3) && tus.posts.length === 0);

// ---- Szenario 4: Netz bricht mitten im Upload ab -> "Folytatás" setzt fort, bis zum Ende, ohne neues Video ----------------------------------
tus.modus = 'netzabbruch'; tus.posts.length = 0; tus.bytes = 0; tus.heads = 0; tus.patches = 0; tus.abgebrochen = 0;
const neuesVideoVorher = lebende.size;
await page.locator('input[type=file][accept="video/*"]').nth(3).setInputFiles({ name: 'unterbrochen.mp4', mimeType: 'video/mp4', buffer: mp4 });
const knopfDa = await page.getByRole('button', { name: HU.a_bunny_folytatas }).waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
const textDa = (await page.locator('body').innerText()).includes(HU.a_bunny_megszakadt);
pruefe('Netzabbruch: die Meldung (Megszakadt) und der Knopf "Folytatás" erscheinen, es entstand genau EIN Video bei Bunny', knopfDa && textDa && lebende.size === neuesVideoVorher + 1);
await ctx.setOffline(false);
await page.getByRole('button', { name: HU.a_bunny_folytatas }).click();
await page.getByText(HU.a_bunny_kesz).first().waitFor({ timeout: 40000 }).catch(() => {});
const z4 = zeile(lek4);
pruefe('Fortsetzen: der Upload endet mit dem GLEICHEN Video (kein zweites angelegt), alle Bytes kamen an, Bunny wurde nach dem Stand gefragt (HEAD)', z4?.quelle === 'bunny' && lebende.size === neuesVideoVorher + 1 && tus.posts.length === 1 && tus.bytes === mp4.length && tus.heads >= 1, JSON.stringify({ quelle: z4?.quelle, posts: tus.posts.length, bytes: tus.bytes, soll: mp4.length, heads: tus.heads }));

// ---- Szenario 5: die Lektion wird waehrend der Verarbeitung geloescht -> Nachfragen hoert auf, Meldung statt 15 Minuten Stille ----------------------
tus.modus = 'ok'; tus.posts.length = 0; tus.loescheLektion = lek5;
let statusAnfragen = 0; page.on('request', (r) => { if (r.url().includes('/bunny-status')) statusAnfragen++; });
await page.locator('input[type=file][accept="video/*"]').nth(4).setInputFiles({ name: 'weg.mp4', mimeType: 'video/mp4', buffer: mp4.subarray(0, 200000) });
const nichtGefunden = await page.getByText(HU.nicht_gefunden).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
const anfragenBeiFehler = statusAnfragen; await page.waitForTimeout(12000);
pruefe('Lektion waehrend der Verarbeitung geloescht: die Meldung "nicht gefunden" erscheint und das Nachfragen STOPPT (keine weiteren Status-Anfragen)', nichtGefunden && statusAnfragen === anfragenBeiFehler && anfragenBeiFehler >= 1 && anfragenBeiFehler <= 3, String(statusAnfragen) + '/' + anfragenBeiFehler);
pruefe('Auf der Seite wurde nichts blockiert (CSP, Fehler im Skript) - auch nicht bei Netzabbruch, Fortsetzen und PDF', csp.length === 0, csp.join(' | '));

await browser.close(); await new Promise((r) => server.close(r)); try { db.close(); } catch { /* egal */ } try { rmSync(ordner, { recursive: true, force: true }); } catch { /* egal */ }
console.log('Browsertest Bunny-Upload: ' + ok + ' bestanden, ' + fehler + ' fehlgeschlagen');
process.exitCode = fehler ? 1 : 0;
