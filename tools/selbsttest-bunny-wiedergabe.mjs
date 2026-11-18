// Bunny Stream, Schritt 5: Wiedergabe fuer Kunden (signierter Einbett-Link), Zugangsregeln, Sicherheitsregeln (CSP) und Frontend.
// Echte App, echte Datenbank (temporaer), Bunny nur als Attrappe (es darf fuer die Wiedergabe NIE eine Anfrage an Bunny gehen).
import './test-sprache.mjs';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import vm from 'node:vm';
const ordner = mkdtempSync(join(tmpdir(), 'schulung-bunny-wg-'));
const DATEIEN = join(ordner, 'dateien');
process.env.DB_DATEI = join(ordner, 'test.db');
const PASS = randomBytes(24).toString('hex');
const API = 'api-key-test-0001', TOKEN = 'token-key-test-0001', BIB = '12345';
const VID = '11111111-2222-3333-4444-555555555555';
const JETZT = 1700000000000;   // feste Uhr im Bunny-Modul: Ablauf bei 15 Minuten (A8-03) = 1700000900
const EMBED_TOKEN = createHash('sha256').update(TOKEN + VID + '1700000900').digest('hex');   // unabhaengig berechnet (Bunny-Doku: sha256(TokenKey+VideoID+expires))
let ok = 0, fehler = 0;
const pruefe = (name, wert, detail = '') => { wert ? ok++ : fehler++; console.log((wert ? 'OK     ' : 'FEHLER ') + name + (!wert && detail ? ' ' + detail : '')); };

let db, server;
try {
  ({ db } = await import('../db.mjs'));
  const { passwortHashen } = await import('../auth.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const { erstelleBunny, BunnyFehler } = await import('../bunny.mjs');
  const { KOPFZEILEN } = await import('../routes-admin-seite.mjs');
  const ph = await passwortHashen(PASS);
  const insertUser = (email, rolle = 'kunde') => Number(db.prepare('INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,?,?,?)').run(email, ph, rolle, new Date().toISOString(), Date.now()).lastInsertRowid);
  const admin = insertUser('wg-admin@example.com', 'admin'), kauefer = insertUser('wg-kaeufer@example.com'), fremd = insertUser('wg-fremd@example.com'), abgelaufen = insertUser('wg-abgelaufen@example.com'), abo = insertUser('wg-abo@example.com');
  const jetzt = () => new Date().toISOString();
  const neuerKurs = (titel, status = 'veroeffentlicht') => Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES (?,'',0,'huf',?,?,?)").run(titel, status, jetzt(), jetzt()).lastInsertRowid);
  const neueLektion = (kurs, titel, art = 'video', status = 'veroeffentlicht') => Number(db.prepare('INSERT INTO lektionen(kurs_id,titel,art,status,erstellt,geaendert) VALUES (?,?,?,?,?,?)').run(kurs, titel, art, status, jetzt(), jetzt()).lastInsertRowid);
  const bunnyZeile = (lektion, id = VID, status = 'fertig') => db.prepare("INSERT INTO dateien(lektion_id,name,art,pfad,groesse,mime,erstellt,quelle,bunny_video_id,bunny_status) VALUES (?,?,'video','bunny',0,'application/octet-stream',?,'bunny',?,?)").run(lektion, 'v', jetzt(), id, status);
  const zugang = (benutzer, kurs, bis = null) => db.prepare("INSERT INTO zugaenge(benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES (?,?,'einladung',?,?)").run(benutzer, kurs, jetzt(), bis);

  const kurs = neuerKurs('Bunny-Kurs'); const lek = neueLektion(kurs, 'Bunny-Video'); bunnyZeile(lek);
  zugang(kauefer, kurs); zugang(abgelaufen, kurs, Date.now() - 1000); zugang(abo, kurs, Date.now() + 86400000);
  const kursEntwurf = neuerKurs('Entwurf', 'entwurf'); const lekEntwurfKurs = neueLektion(kursEntwurf, 'E'); bunnyZeile(lekEntwurfKurs, randomUUID()); zugang(kauefer, kursEntwurf);
  const lekVerborgen = neueLektion(kurs, 'Versteckt', 'video', 'entwurf'); bunnyZeile(lekVerborgen, randomUUID());
  const lekNichtFertig = neueLektion(kurs, 'Noch in Arbeit'); bunnyZeile(lekNichtFertig, randomUUID(), 'verarbeitet');
  const lekPdf = neueLektion(kurs, 'Falsche Art', 'pdf'); bunnyZeile(lekPdf, randomUUID());
  mkdirSync(DATEIEN, { recursive: true });
  const lokalerName = randomUUID(); writeFileSync(join(DATEIEN, lokalerName), Buffer.from('xxxxftypisom0000isomiso2'));
  const lekLokal = neueLektion(kurs, 'Lokales Video');
  db.prepare("INSERT INTO dateien(lektion_id,name,art,pfad,groesse,mime,erstellt) VALUES (?,?,?,?,?,?,?)").run(lekLokal, 'l.mp4', 'video', lokalerName, 24, 'video/mp4', jetzt());

  const anrufe = [];
  const bunnyAn = () => erstelleBunny({ bibliothek: BIB, apiKey: API, tokenKey: TOKEN }, { fetchFn: async (...a) => { anrufe.push(a); return { ok: false, status: 500, json: async () => ({}) }; }, jetzt: () => JETZT });
  const stripe = { webhooks: { constructEvent: (b) => JSON.parse(b.toString()) } };
  const starte = (port, bunny) => new Promise((yes, no) => {
    const s = erstelleServer({ stripe, webhookSecret: 'test', base: `http://127.0.0.1:${port}`, dateiOrdner: DATEIEN, abgleichAutomatik: false, bunny }).listen(port, '127.0.0.1');
    s.once('listening', () => yes(s)); s.once('error', no);
  });
  const stoppe = (s) => new Promise((r) => s.close(r));
  function client(base) {
    let cookie = '';
    const anfrage = async (methode, pfad, body) => {
      const headers = {}; if (cookie) headers.Cookie = cookie; if (body !== undefined) headers['Content-Type'] = 'application/json';
      const r = await fetch(base + pfad, { method: methode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
      let d = null, text = ''; try { text = await r.text(); d = JSON.parse(text); } catch { /* kein JSON */ }
      return { status: r.status, d, text, kopf: r.headers };
    };
    return { get: (p) => anfrage('GET', p), post: (p, b) => anfrage('POST', p, b ?? {}) };
  }
  const anmelden = async (base, email) => { const c = client(base); await c.post('/api/anmelden', { email, passwort: PASS }); return c; };
  const wg = (c, lektion) => c.post(`/api/lektionen/${lektion}/wiedergabe`);

  // ======== A) Bunny AN ==============================================================================================================
  server = await starte(4541, bunnyAn());
  const BASE = 'http://127.0.0.1:4541';
  const gast = client(BASE), cKauf = await anmelden(BASE, 'wg-kaeufer@example.com'), cFremd = await anmelden(BASE, 'wg-fremd@example.com'), cAdmin = await anmelden(BASE, 'wg-admin@example.com');
  const cAbgel = await anmelden(BASE, 'wg-abgelaufen@example.com'), cAbo = await anmelden(BASE, 'wg-abo@example.com');

  const gutLink = await wg(cKauf, lek);
  const erwartet = `https://player.mediadelivery.net/embed/${BIB}/${VID}?token=${EMBED_TOKEN}&expires=1700000900&autoplay=false`;
  pruefe('Kaeufer: 200 mit art=bunny, Einbett-Link, Ablauf (ms) und E-Mail, KEIN Ticket', gutLink.status === 200 && gutLink.d?.art === 'bunny' && gutLink.d?.ablauf === 1700000900000 && gutLink.d?.email === 'wg-kaeufer@example.com' && !('ticket' in (gutLink.d || {})));
  pruefe('Der Link ist exakt der erwartete (Token aus Schluessel+Video+Ablauf unabhaengig berechnet, 15 Minuten, autoplay=false)', gutLink.d?.einbett_url === erwartet, gutLink.d?.einbett_url);
  pruefe('A8-03: Einbett-Link gilt hoechstens 15 Minuten und mindestens 5 Minuten (Start eines Videos)', gutLink.d?.ablauf - JETZT <= 15 * 60 * 1000 && gutLink.d?.ablauf - JETZT >= 5 * 60 * 1000);
  pruefe('Antwort: no-store, weder API- noch Token-Schluessel im Text', gutLink.kopf.get('cache-control') === 'no-store' && !gutLink.text.includes(API) && !gutLink.text.includes(TOKEN));
  pruefe('Admin ohne eigenen Zugang darf ansehen', (await wg(cAdmin, lek)).d?.art === 'bunny');
  pruefe('Gast: 401', (await wg(gast, lek)).status === 401);
  const fr = await wg(cFremd, lek);
  pruefe('Angemeldet ohne Zugang zum Kurs: 403 kein_zugang, kein Link', fr.status === 403 && !fr.text.includes('mediadelivery'));
  pruefe('Abgelaufener Zugang: 403; Abo mit Zukunft: 200', (await wg(cAbgel, lek)).status === 403 && (await wg(cAbo, lek)).status === 200);
  pruefe('Versteckte Lektion: 404; Kurs im Entwurf: 404 (auch mit Zugang)', (await wg(cKauf, lekVerborgen)).status === 404 && (await wg(cKauf, lekEntwurfKurs)).status === 404);
  const nf = await wg(cKauf, lekNichtFertig);
  pruefe('Video bei Bunny noch nicht fertig: 409, kein Link', nf.status === 409 && !nf.text.includes('mediadelivery'));
  pruefe('Bunny-Zeile an einer Lektion, die kein Video ist: 403, kein Link', (await wg(cKauf, lekPdf)).status === 403);
  pruefe('Unbekannte Lektion 404, ungueltige ID 400, Body 400, Query 400', (await wg(cKauf, 99999)).status === 404 && (await cKauf.post('/api/lektionen/abc/wiedergabe')).status === 400 && (await cKauf.post(`/api/lektionen/${lek}/wiedergabe`, { x: 1 })).status === 400 && (await cKauf.post(`/api/lektionen/${lek}/wiedergabe?x=1`)).status === 400);
  const datei = await cKauf.get(`/api/lektionen/${lek}/datei?ticket=egal`);
  pruefe('Bunny-Video ist NIE ueber die lokale Datei-Route abrufbar (404)', datei.status === 404);
  const lokal = await wg(cKauf, lekLokal);
  pruefe('Lokales Video funktioniert unveraendert: Ticket, keine Bunny-Felder', lokal.status === 200 && typeof lokal.d?.ticket === 'string' && lokal.d?.art === undefined && lokal.d?.einbett_url === undefined);
  const lokalDatei = await cKauf.get(`/api/lektionen/${lekLokal}/datei?ticket=${encodeURIComponent(lokal.d.ticket)}`);
  pruefe('...und das lokale Video wird weiter ausgeliefert (200)', lokalDatei.status === 200);
  pruefe('Fuer die Wiedergabe ging KEINE einzige Anfrage an Bunny', anrufe.length === 0);

  // ---- Sicherheitsregeln mit Bunny ---------------------------------------------------------------------------------------------------
  const seite = await gast.get('/'); const api = await gast.get('/api/ich');
  const cspMit = KOPFZEILEN['Content-Security-Policy'] + '; frame-src https://player.mediadelivery.net';
  pruefe('Mit Bunny: CSP = bisherige Regeln + genau ein frame-src fuer den Bunny-Player (Startseite und API)', seite.kopf.get('content-security-policy') === cspMit && api.kopf.get('content-security-policy') === cspMit, seite.kopf.get('content-security-policy'));
  pruefe('Mit Bunny: alle anderen Sicherheitskopfzeilen unveraendert (nosniff, X-Frame-Options DENY, Referrer no-referrer)', seite.kopf.get('x-content-type-options') === 'nosniff' && seite.kopf.get('x-frame-options') === 'DENY' && seite.kopf.get('referrer-policy') === 'no-referrer');
  pruefe('Mit Bunny: sonst nichts geoeffnet (script-src/media-src/connect-src weiter nur self, frame-ancestors none)', /script-src 'self';/.test(cspMit) && /media-src 'self';/.test(cspMit) && /connect-src 'self';/.test(cspMit) && cspMit.includes("frame-ancestors 'none'") && !/unsafe-inline|unsafe-eval|\*/.test(cspMit));
  await stoppe(server);

  // ======== B) Bunny AUS ==============================================================================================================
  server = await starte(4542, null);
  const BASE2 = 'http://127.0.0.1:4542';
  const cKauf2 = await anmelden(BASE2, 'wg-kaeufer@example.com'), gast2 = client(BASE2);
  const aus = await wg(cKauf2, lek);
  pruefe('Bunny aus: Wiedergabe eines Bunny-Videos antwortet 503, kein Link', aus.status === 503 && !aus.text.includes('mediadelivery'));
  pruefe('Bunny aus: lokales Video funktioniert weiter', (await wg(cKauf2, lekLokal)).d?.ticket !== undefined);
  const seite2 = await gast2.get('/');
  pruefe('Bunny aus: CSP ist EXAKT die bisherige, ohne frame-src', seite2.kopf.get('content-security-policy') === KOPFZEILEN['Content-Security-Policy'] && !String(seite2.kopf.get('content-security-policy')).includes('frame-src'));
  await stoppe(server);

  // ======== C) Modul: Optionen des Einbett-Links ===================================================================================
  const b = bunnyAn();
  const ohne = b.einbettLink(VID, 3600);
  pruefe('Einbett-Link ohne Optionen ist unveraendert (nur token und expires)', ohne.url.endsWith('&expires=1700003600') && !ohne.url.includes('autoplay'));
  const mit = b.einbettLink(VID, 3600, { autoplay: false, rememberPosition: true });
  pruefe('Erlaubte Optionen werden angehaengt, ausserhalb des Tokens', mit.url.endsWith('&expires=1700003600&autoplay=false&rememberPosition=true'));
  for (const [name, opt] of [['unbekannte Option', { evil: true }], ['Text statt Wahrheitswert', { autoplay: 'false' }], ['Einschleusen', { 'autoplay=true&x': true }], ['Zahl', { loop: 1 }]]) {
    let code = null; try { b.einbettLink(VID, 3600, opt); } catch (e) { code = e instanceof BunnyFehler ? e.code : 'anderer'; }
    pruefe(`Option wird abgelehnt: ${name}`, code === 'bunny_option_ungueltig');
  }

  // ======== D) Frontend (statische Pruefung) =====================================================================================
  const js = readFileSync(new URL('../public/kunde.js', import.meta.url), 'utf8'), css = readFileSync(new URL('../public/kunde.css', import.meta.url), 'utf8');
  const fn = js.slice(js.indexOf('function bunnyAnsicht'), js.indexOf('async function geschuetzteAnsicht'));
  pruefe('Frontend: iframe mit allow genau "autoplay; encrypted-media; fullscreen" (Vollbild seit 04.11.2026 erlaubt, Edmunds Entscheidung; Wasserzeichen im Vollbild folgt spaeter, GL-13), KEIN Bild-im-Bild, ohne allowfullscreen-Attribut, mit referrerpolicy strict-origin-when-cross-origin (Bunny-Doku)', fn.includes("h('iframe'") && fn.includes("allow:'autoplay; encrypted-media; fullscreen'") && !/picture-in-picture|allowfullscreen/i.test(fn) && fn.includes("referrerpolicy:'strict-origin-when-cross-origin'"));
  // Die Adresspruefung selbst wird ausgefuehrt (Fund der Pruefung: Benutzername und Port liessen sich einschmuggeln).
  const adressCode = js.slice(js.indexOf('const BUNNY_PLAYER_HOST'), js.indexOf('function bunnyAnsicht'));
  const bunnyAdresse = vm.runInNewContext(adressCode + '; bunnyAdresse', { URL, String });   // nur der eigene Quelltext aus dem Repo, abgeschotteter Kontext
  const gut = `https://player.mediadelivery.net/embed/${BIB}/${VID}?token=abc&expires=1&autoplay=false`;
  pruefe('Adresspruefung: der echte Bunny-Link wird angenommen (auch in Grossschreibung des Hosts)', bunnyAdresse(gut) === gut && !!bunnyAdresse(gut.replace('player.mediadelivery.net', 'PLAYER.MEDIADELIVERY.NET')));
  for (const [name, boese] of [['Benutzername davor', 'https://evil.com@player.mediadelivery.net/embed/1'], ['eigener Port', 'https://player.mediadelivery.net:8443/embed/1'], ['http statt https', 'http://player.mediadelivery.net/embed/1'],
    ['fremder Host', 'https://evil.com/embed/1'], ['Host als Unterstring', 'https://player.mediadelivery.net.evil.com/embed/1'], ['Punkt am Host-Ende', 'https://player.mediadelivery.net./embed/1'], ['Unicode-Tarnung', 'https://player.mediadelivery.net/embed/1'.replace('a', 'а')],
    ['javascript-Adresse', 'javascript:alert(1)'], ['data-Adresse', 'data:text/html,<b>x</b>'], ['falscher Pfad', 'https://player.mediadelivery.net/play/1/2'], ['Pfad nur /embed ohne Schraegstrich', 'https://player.mediadelivery.net/embedx/1'], ['leer', ''], ['kein Text', null], ['Passwort', 'https://:pw@player.mediadelivery.net/embed/1']]) {
    pruefe(`Adresspruefung lehnt ab: ${name}`, bunnyAdresse(boese) === null);
  }
  pruefe('Frontend: keine http-Adresse im Text der Bunny-Funktionen', !/https?:\/\//.test(adressCode + fn));
  pruefe('Frontend: der iframe steht NUR einmal und NUR in bunnyAnsicht (Bereich mit genau einer Funktion), nirgends sonst in keiner Schreibweise (PDF-Schutz bleibt streng)', (js.match(/['"`]iframe['"`]/g) || []).length === 1 && fn.includes("h('iframe'") && (fn.match(/function /g) || []).length === 1 && !/createElement\(\s*['"`]iframe/i.test(js));
  pruefe('Frontend: Wasserzeichen bleibt ueber dem Player, Aufraeumen entfernt die Adresse', fn.includes('wasserzeichen(antwort.email)') && fn.includes('wasser.stop()') && fn.includes("player.removeAttribute('src')"));
  pruefe('Frontend: geschuetzteAnsicht verzweigt bei art=bunny', js.includes("if (ticketAntwort.d.art === 'bunny') return bunnyAnsicht(l, ticketAntwort.d);"));
  pruefe('Frontend: keine Inline-Stile (CSP style-src self): Stil kommt aus kunde.css', !fn.includes('style:') && /\.bunny-player\{[^}]*aspect-ratio:16\/9[^}]*border:0/.test(css));
} catch (e) {
  fehler++; console.log('FEHLER Testablauf: ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | '));
} finally {
  try { await new Promise((r) => (server ? server.close(r) : r())); } catch { /* egal */ }
  try { db?.close(); } catch { /* egal */ }
  try { rmSync(ordner, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; }
}
console.log('Bunny Wiedergabe: ' + ok + ' bestanden, ' + fehler + ' fehlgeschlagen');
process.exitCode = fehler ? 1 : 0;
