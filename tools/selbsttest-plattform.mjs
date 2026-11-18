// Plattform-Meldung (Dashboard-Anbindung): Einstellungen, Warteschlange, Datenschutz (nie E-Mail), Wiederholung, Hook in ereignisHinzufuegen.
// Alles mit Attrappe fuer fetch, temporaere Datenbank, nie echtes Google.
import './test-sprache.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const ordner = mkdtempSync(join(tmpdir(), 'schulung-plattform-'));
process.env.DB_DATEI = join(ordner, 'test.db');
let ok = 0, fehler = 0;
const pruefe = (name, wert, detail = '') => { wert ? ok++ : fehler++; console.log((wert ? 'OK     ' : 'FEHLER ') + name + (!wert && detail ? ' ' + detail : '')); };
const alteWarn = console.warn; const logs = []; console.warn = (...a) => { logs.push(a.join(' ')); };

const URL_OK = 'https://script.google.com/macros/s/AKfycbxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/exec';
const KEY = 'schluessel_nur_fuer_tests_0123456789';
try {
  const { ladeKonfig, KonfigFehler } = await import('../konfig.mjs');
  const { db } = await import('../db.mjs');
  const { plattformMeldung, WEBHOOK_MUSTER, wartezeit } = await import('../plattform-meldung.mjs');
  const { createHmac } = await import('node:crypto');
  const hmac = (typ, quelle) => createHmac('sha256', KEY).update(typ + '|' + quelle).digest('hex').slice(0, 32);
  const { ereignisHinzufuegen, ereignisPlattformSetzen } = await import('../ereignis-liste.mjs');

  // ---- Einstellungen -------------------------------------------------------------------------------------------------------
  const basis = { NODE_ENV: 'test', STRIPE_SECRET_KEY: 'sk_test_platzhalter_nur_fuer_tests', STRIPE_WEBHOOK_SECRET: 'whsec_platzhalter_nur_fuer_tests', BASE_URL: 'http://127.0.0.1:3000' };
  const lade = (extra) => { try { return { k: ladeKonfig({ ...basis, ...extra }) }; } catch (e) { return { e }; } };
  pruefe('Ohne Variablen: plattformWebhook ist null (Meldung aus)', lade({}).k?.plattformWebhook === null);
  const voll = lade({ PLATTFORM_WEBHOOK_URL: URL_OK, PLATTFORM_WEBHOOK_KEY: KEY });
  pruefe('Beide gesetzt: Adresse, Schluessel, Modus Test (Stripe-Testschluessel), unveraenderlich', voll.k?.plattformWebhook?.url === URL_OK && voll.k.plattformWebhook.schluessel === KEY && voll.k.plattformWebhook.modus === 'Test' && Object.isFrozen(voll.k.plattformWebhook));
  for (const [name, extra] of [
    ['nur Adresse', { PLATTFORM_WEBHOOK_URL: URL_OK }],
    ['nur Schluessel', { PLATTFORM_WEBHOOK_KEY: KEY }],
    ['fremde Adresse', { PLATTFORM_WEBHOOK_URL: 'https://evil.example/macros/s/AKfycbxAAAAAAAAAAAAAAAAAAAAAAAA/exec', PLATTFORM_WEBHOOK_KEY: KEY }],
    ['http statt https', { PLATTFORM_WEBHOOK_URL: URL_OK.replace('https', 'http'), PLATTFORM_WEBHOOK_KEY: KEY }],
    ['Adresse mit Zusatz', { PLATTFORM_WEBHOOK_URL: URL_OK + '?a=b', PLATTFORM_WEBHOOK_KEY: KEY }],
    ['Schluessel zu kurz', { PLATTFORM_WEBHOOK_URL: URL_OK, PLATTFORM_WEBHOOK_KEY: 'kurz' }],
    ['Schluessel mit Leerzeichen', { PLATTFORM_WEBHOOK_URL: URL_OK, PLATTFORM_WEBHOOK_KEY: 'schluessel mit leerzeichen drin 123456' }],
  ]) {
    const r = lade(extra);
    pruefe(`Ungueltig (${name}) bricht den Start ab`, r.e instanceof KonfigFehler && /PLATTFORM_WEBHOOK/.test(r.e.message));
    pruefe(`Fehlermeldung (${name}) enthaelt nie den Schluesselwert`, !(r.e?.message || '').includes(KEY));
  }
  pruefe('Adress-Muster nimmt echte Script-Adresse an', WEBHOOK_MUSTER.test(URL_OK) && !WEBHOOK_MUSTER.test('https://script.google.com.evil.example/macros/s/AKfycbxAAAAAAAAAAAAAAAAAAAAAAAA/exec'));

  // ---- Warteschlange und Versand -------------------------------------------------------------------------------------------
  const ph = 'x';
  const kursId = Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES ('Testkurs','',0,'huf','entwurf',?,?)").run(new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
  const benutzerId = Number(db.prepare('INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,?,?,?,1)').run('kaeufer-geheim@example.com', ph, 'kunde', new Date().toISOString()).lastInsertRowid);
  let uhr = 1_800_000_000_000;
  const jetzt = () => uhr;
  let aufrufe = [], modus = 'ok';
  const fetchAttrappe = async (url, opt) => {
    aufrufe.push({ url, opt, body: JSON.parse(opt.body) });
    if (modus === 'netz') throw new Error('Netz weg');
    const antwort = modus === 'dup' ? { ok: true, duplicate: true } : modus === 'falsch' ? { ok: false, fehler: 'schluessel' } : modus === 'typ' ? { ok: false, fehler: 'typ' } : modus === 'html' ? null : { ok: true };
    return { text: async () => (antwort === null ? '<html>Login</html>' : JSON.stringify(antwort)) };
  };
  const aus = plattformMeldung({});
  pruefe('Ohne Adresse/Schluessel: an=false, vormerken tut nichts, senden meldet nichts', aus.an === false && aus.vormerken(1, 'gekauft') === false && (await aus.senden()).gesendet === 0);
  pruefe('Ungueltiger Modus: an=false', plattformMeldung({ url: URL_OK, schluessel: KEY, modus: 'Produktion' }).an === false);

  const p = plattformMeldung({ url: URL_OK, schluessel: KEY, modus: 'Test', fetchFn: fetchAttrappe, jetzt });
  ereignisPlattformSetzen(p);
  pruefe('Mit gueltigen Werten: an=true', p.an === true);

  ereignisHinzufuegen('gekauft', 'evt_test_1', { kurs_id: kursId, benutzer_id: benutzerId, betrag: 4990, waehrung: 'huf', status: 'bezahlt' });
  ereignisHinzufuegen('gekauft', 'evt_test_1', { kurs_id: kursId, benutzer_id: benutzerId, betrag: 4990, waehrung: 'huf' });   // Duplikat
  ereignisHinzufuegen('geloescht', 'del_test_1', { benutzer_id: benutzerId });
  ereignisHinzufuegen('registriert', 'reg_test_1', { benutzer_id: benutzerId });
  const zeilen = db.prepare('SELECT COUNT(*) AS n FROM plattform_ausgang').get().n;
  pruefe('Hook: gekauft und registriert vorgemerkt, Duplikat nicht doppelt, "geloescht" nie', zeilen === 2, 'zeilen=' + zeilen);

  const l0 = p.lage();
  pruefe('Lage vor dem Senden: 2 offen, 0 gesendet', l0.offen === 2 && l0.gesendet === 0 && l0.modus === 'Test');

  const parallel = await Promise.all([p.senden(), p.senden()]);
  pruefe('Zwei gleichzeitige Laeufe senden jedes Ereignis nur einmal', aufrufe.length === 2 && parallel.reduce((s, x) => s + x.gesendet, 0) === 2, 'aufrufe=' + aufrufe.length);
  const ersterBody = aufrufe.find((a) => a.body.typ === 'gekauft').body;
  pruefe('Nutzlast hat genau die geplanten Felder und Werte', JSON.stringify(Object.keys(ersterBody).sort()) === JSON.stringify(['betrag', 'kurs', 'modus', 'quelle_id', 'schluessel', 'typ', 'waehrung', 'zeit_utc']) && ersterBody.betrag === 4990 && ersterBody.waehrung === 'HUF' && ersterBody.kurs === String(kursId) && ersterBody.modus === 'Test' && ersterBody.quelle_id === hmac('gekauft', 'evt_test_1') && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(ersterBody.zeit_utc), JSON.stringify(ersterBody));
  pruefe('Kaeufer-E-Mail und Name gehen NIE hinaus (kein @, kein Kaeufer-Text in keiner Anfrage)', aufrufe.every((a) => !a.opt.body.includes('@') && !a.opt.body.includes('kaeufer-geheim')));
  pruefe('Anfrage: POST, an die eingestellte Adresse, Weiterleitung folgen, mit Zeitlimit', aufrufe.every((a) => a.url === URL_OK && a.opt.method === 'POST' && a.opt.redirect === 'follow' && a.opt.signal));
  pruefe('Nach Erfolg: beide gesendet, 0 offen', p.lage().gesendet === 2 && p.lage().offen === 0);
  aufrufe = []; await p.senden();
  pruefe('Nichts mehr offen: kein weiterer Versand', aufrufe.length === 0);

  // Fehler, Wartezeit, Wiederholung
  ereignisHinzufuegen('erstattet', 'ref_test_1', { kurs_id: kursId, betrag: 4990, waehrung: 'huf' });
  modus = 'netz'; aufrufe = [];
  await p.senden();
  pruefe('Netzfehler: Ereignis bleibt offen, ein Versuch', aufrufe.length === 1 && p.lage().offen === 1 && p.lage().gesendet === 2);
  aufrufe = []; await p.senden();
  pruefe('Direkt danach: Wartezeit schuetzt vor Dauerfeuer (kein neuer Versuch)', aufrufe.length === 0);
  uhr += 61_000; modus = 'html'; await p.senden();
  pruefe('Nach der Wartezeit: neuer Versuch; HTML-Antwort (kein JSON) zaehlt als Fehler', aufrufe.length === 1 && p.lage().offen === 1);
  uhr += 10 * 60_000; modus = 'falsch'; await p.senden();
  pruefe('ok:false (falscher Schluessel) bleibt offen, nie als gesendet gezaehlt', aufrufe.length === 2 && p.lage().offen === 1 && p.lage().gesendet === 2);
  uhr += 6 * 3600_000 + 1; modus = 'dup'; await p.senden();
  pruefe('duplicate:true gilt als gesendet (Idempotenz im Script)', p.lage().offen === 0 && p.lage().gesendet === 3);
  const versuche = db.prepare("SELECT MAX(versuche) AS v FROM plattform_ausgang").get().v;
  pruefe('Versuche werden gezaehlt', versuche >= 4);
  pruefe('Wartezeit: 30 s beim ersten Fehler, nie mehr als 6 Stunden', wartezeit(1) === 60_000 && wartezeit(100) === 6 * 3600 * 1000 && wartezeit(0) === 30_000);

  // Datenschutz: die Quell-ID geht nie im Klartext hinaus (bei registriert/bestaetigt ist sie die interne Benutzer-ID)
  ereignisHinzufuegen('registriert', String(benutzerId), { benutzer_id: benutzerId });
  modus = 'ok'; aufrufe = []; await p.senden();
  const regBody = aufrufe[0]?.body;
  pruefe('registriert: quelle_id ist ein 32-stelliger Hash, nie die Benutzer-ID', regBody?.quelle_id === hmac('registriert', String(benutzerId)) && regBody.quelle_id !== String(benutzerId) && !aufrufe[0].opt.body.includes(`"${benutzerId}"`));
  ereignisHinzufuegen('gekauft', 'mail@example.com', { kurs_id: kursId, betrag: 1, waehrung: 'huf' });
  aufrufe = []; await p.senden();
  pruefe('Quell-ID mit @ geht nur gehasht hinaus (kein @ in der Anfrage)', aufrufe.length === 1 && !aufrufe[0].opt.body.includes('@') && !aufrufe[0].opt.body.includes('mail'));
  ereignisHinzufuegen('gekauft', 'steuer\u0001zeichen', { kurs_id: kursId, betrag: 1, waehrung: 'huf' });
  aufrufe = []; await p.senden();
  pruefe('Quell-ID mit Steuerzeichen wird verworfen und nie gesendet', aufrufe.length === 0 && p.lage().verworfen === 1, JSON.stringify(p.lage()));
  ereignisHinzufuegen('gekauft', 'evt_waehrung', { kurs_id: kursId, betrag: 1, waehrung: 'eurox' });
  await p.senden();
  pruefe('Ungueltige Waehrung wird verworfen', p.lage().verworfen === 2 && aufrufe.length === 0);

  // Dauerhafte Ablehnung durch das Script (Datenfehler) wird verworfen, Schluessel-/Netzfehler nie
  ereignisHinzufuegen('gekauft', 'evt_abgelehnt', { kurs_id: kursId, betrag: 2, waehrung: 'huf' });
  modus = 'typ'; aufrufe = []; await p.senden();
  pruefe('Script antwortet ok:false mit Datenfehler (typ): Ereignis wird verworfen, nicht endlos wiederholt', aufrufe.length === 1 && p.lage().verworfen === 3 && p.lage().offen === 0, JSON.stringify(p.lage()));

  // Verwaiste Zeile (Ereignis durch Aufbewahrung geloescht) blockiert nichts und zaehlt nicht als offen
  db.prepare("INSERT INTO plattform_ausgang(ereignis_id,status,versuche,erstellt,geaendert) VALUES(999999,'offen',0,?,?)").run(uhr, uhr);
  modus = 'ok'; aufrufe = []; await p.senden();
  pruefe('Verwaiste Zeile wird verworfen statt fuer immer als offen gezaehlt', p.lage().offen === 0 && aufrufe.length === 0, JSON.stringify(p.lage()));

  // Lange wartende Zeilen blockieren neuere nicht (Starvation)
  for (let i = 0; i < 100; i++) ereignisHinzufuegen('gekauft', 'evt_warte_' + i, { kurs_id: kursId, betrag: 1, waehrung: 'huf' });
  modus = 'netz'; for (let i = 0; i < 6; i++) await p.senden();
  ereignisHinzufuegen('gekauft', 'evt_frisch', { kurs_id: kursId, betrag: 1, waehrung: 'huf' });
  modus = 'ok'; aufrufe = []; await p.senden();
  pruefe('100 wartende Zeilen im Wiederholungs-Takt verhindern die Meldung eines neuen Ereignisses nicht', aufrufe.some((a) => a.body.quelle_id === hmac('gekauft', 'evt_frisch')), 'aufrufe=' + aufrufe.length);
  uhr += 7 * 3600_000; modus = 'ok'; for (let i = 0; i < 8; i++) await p.senden();
  pruefe('Nach der Wartezeit werden alle wartenden gesendet, nichts geht verloren', p.lage().offen === 0, JSON.stringify(p.lage()));
  const t0 = uhr; ereignisHinzufuegen('gekauft', 'evt_alt', { kurs_id: kursId, betrag: 1, waehrung: 'huf' });
  modus = 'netz'; await p.senden(); uhr += 8 * 3600_000; await p.senden();
  pruefe('aelteste_offen_utc bleibt der Entstehungszeitpunkt trotz neuer Versuche', p.lage().aelteste_offen_utc === new Date(t0).toISOString().slice(0, 19).replace('T', ' '), JSON.stringify(p.lage()));
  modus = 'ok'; uhr += 7 * 3600_000; await p.senden();

  // Live-Modus wird 1:1 gemeldet
  const live = plattformMeldung({ url: URL_OK, schluessel: KEY, modus: 'Live', fetchFn: fetchAttrappe, jetzt });
  ereignisPlattformSetzen(live);
  ereignisHinzufuegen('abo_gestartet', 'sub_live_1', { kurs_id: kursId, betrag: 3000, waehrung: 'eur' });
  aufrufe = []; await live.senden();
  pruefe('Modus Live wird gemeldet, wenn die Konfiguration Live sagt', aufrufe.length === 1 && aufrufe[0].body.modus === 'Live' && aufrufe[0].body.waehrung === 'EUR');

  // Aufraeumen und Ereignis-Aufbewahrung ohne Fremdschluessel
  db.prepare("DELETE FROM ereignisse WHERE quelle_id='evt_test_1'").run();
  pruefe('Loeschen alter Ereignisse bricht die Meldungstabelle nicht (kein Fremdschluessel)', db.prepare('SELECT COUNT(*) AS n FROM plattform_ausgang').get().n >= 5);
  uhr += 31 * 86400_000;
  pruefe('Aufraeumen entfernt nur erledigte, alte Zeilen', live.aufraeumen() >= 3 && db.prepare("SELECT COUNT(*) AS n FROM plattform_ausgang WHERE status='offen'").get().n === 0);

  // Ohne Plattform-Meldung bleibt ereignisHinzufuegen unveraendert
  ereignisPlattformSetzen(null);
  const vorher = db.prepare('SELECT COUNT(*) AS n FROM plattform_ausgang').get().n;
  ereignisHinzufuegen('gekauft', 'evt_ohne_plattform', { kurs_id: kursId, betrag: 5, waehrung: 'huf' });
  pruefe('Meldung aus: ereignisHinzufuegen speichert das Ereignis, merkt aber nichts vor', db.prepare("SELECT COUNT(*) AS n FROM ereignisse WHERE quelle_id='evt_ohne_plattform'").get().n === 1 && db.prepare('SELECT COUNT(*) AS n FROM plattform_ausgang').get().n === vorher);

  pruefe('Keine Warnung enthaelt Schluessel oder E-Mail', logs.every((z) => !z.includes(KEY) && !z.includes('@')));
} catch (e) {
  fehler++; console.log('FEHLER Test abgebrochen: ' + (e?.stack || e));
} finally {
  console.warn = alteWarn;
  try { rmSync(ordner, { recursive: true, force: true }); } catch {}
}
console.log(`${ok} bestanden, ${fehler} fehlgeschlagen`);
process.exit(fehler ? 1 : 0);
