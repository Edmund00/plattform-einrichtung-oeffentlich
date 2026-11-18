// Start der Schulungsplattform (nur Stripe-Testmodus, bis Edmund und Gabriella etwas anderes freigeben).
// Alle Einstellungen kommen aus Umgebungsvariablen und werden in konfig.mjs EINMAL geprüft (siehe docs/UMGEBUNG.md).
// Bei einem Fehler endet der Start mit Exitcode 1 und einer Meldung ohne Werte. Keine Schlüssel in Dateien.
// WP1 Sicherheitsblock: Fehlen BEIDE Stripe-Variablen UND ist kein Admin in der Datenbank, startet der Server im Setup-Modus
// (nur /health und spaeter /einrichtung aus WP3); mit Admin aber ohne Stripe startet er im Einrichtungsmodus (noch leer bis WP3/WP4).
import Stripe from 'stripe';
import express from 'express';
import { erstelleSetupStatischRouter } from './setup-statisch.mjs';
import { setzeAnbieterBasis } from './anbieter.mjs';
import { ladeKonfig, KonfigFehler, leseStartZustand, STANDARD_DB_DATEI } from './konfig.mjs';

const dbDatei = (process.env.DB_DATEI && String(process.env.DB_DATEI).trim()) || STANDARD_DB_DATEI;

let konfig;
let speicher = null;   // WP2: wird NUR geoeffnet, wenn es Einstellungen ausser instanz_zustand gibt (Lazy; Bestandsinstanzen bleiben bit-gleich).
let startZustand;
let reparaturFehler = null;
try {
  startZustand = leseStartZustand(dbDatei);   // wirft KonfigFehler, wenn DB vorhanden aber nicht lesbar (fail-closed)
  const { hatGespeicherteEinstellungen } = await import('./einstellungen.mjs');
  if ((startZustand === 'KONFIGURIERT' || startZustand === 'AKTIV') && hatGespeicherteEinstellungen(dbDatei)) {
    // Erst jetzt db.mjs laden und Speicher oeffnen. Ohne gespeicherte Einstellungen bleibt alles bit-gleich wie vor WP2.
    process.env.DB_DATEI = dbDatei;
    const { db } = await import('./db.mjs');
    const { oeffneEinstellungsSpeicher, holeHauptschluessel, verschluesselteWerteVorhanden } = await import('./einstellungen.mjs');
    const hauptschluessel = holeHauptschluessel({ env: process.env, dateiPfad: 'daten/.hauptschluessel', verschluesselteWerteVorhanden: verschluesselteWerteVorhanden(db) });
    if (!hauptschluessel) throw new KonfigFehler(['Hauptschluessel fehlt (Datei oder EINSTELLUNGEN_SCHLUESSEL), aber Einstellungen sind vorhanden. Wiederherstellung siehe docs/WP2-EINSTELLUNGEN.md.']);
    speicher = oeffneEinstellungsSpeicher(db, { hauptschluessel });
  }
  konfig = ladeKonfig(process.env, { startZustand, speicher });
  // F-221: mit geladener Anbieterbasis vor dem Laden/Ausliefern des Shops pruefen.
  if (startZustand === 'KONFIGURIERT') {
    try {
      setzeAnbieterBasis(konfig.anbieter, konfig.anbieterQuelle);
      process.env.DB_DATEI = dbDatei;
      const { db } = await import('./db.mjs');
      const { startPruefungKonfiguriert, setzeBerichtLogoPfad } = await import('./abschluss-bericht.mjs');
      const { machLogoPfad } = await import('./logo-png.mjs');
      setzeBerichtLogoPfad(machLogoPfad(dbDatei));
      const ergebnis = startPruefungKonfiguriert(db);
      if (!ergebnis.ok) throw new KonfigFehler(ergebnis.rot);
    } catch (e) {
      // Keine Exception-Texte/Werte ausgeben; auch Pruefungsfehler sperren den Shop.
      throw e instanceof KonfigFehler ? e : new KonfigFehler(['abschlusspruefung']);
    }
  }
} catch (e) {
  if (!(e instanceof KonfigFehler)) throw e;
  if (startZustand === 'KONFIGURIERT') {
    // Reparaturmodus: KONFIGURIERT mit kaputten Einstellungen -> Einrichtungsmodus starten
    reparaturFehler = e.meldungen;
    speicher = null;
    konfig = ladeKonfig(process.env, { startZustand: 'ADMIN_ERSTELLT', speicher: null, erzwingeEinrichtung: true });
  } else {
    console.error('Abbruch: Die Konfiguration ist fehlerhaft (Werte werden nie ausgegeben, siehe docs/UMGEBUNG.md):');
    for (const meldung of e.meldungen) console.error(`  - ${meldung}`);
    process.exit(1);
  }
}
for (const w of konfig.warnungen) console.warn(`Hinweis: ${w}`);

if (konfig.modus === 'setup' || konfig.modus === 'einrichtung') {
  // WP1/WP3: minimaler Server fuer Setup- und Einrichtungsmodus.
  // Setup: /health + /einrichtung (WP3). Einrichtung: /health + Anmeldung + Platzhalter /admin/einrichtung (WP3/WP4).
  // Weder Stripe-Client noch Shop-/Kauf-/Konto-/Webhook-Routen werden geladen.
  let serverRef = null;   // WP9: fuer neustarten-Callback im Einrichtungsmodus
  process.env.DB_DATEI = konfig.dbDatei;
  const { erstelleEinrichtungsRouter, anmeldeSeite } = await import('./einrichtung-routen.mjs');
  const { spracheMiddleware, gueltigeSprache } = await import('./texte.mjs');
  const { db } = await import('./db.mjs');
  // WP3: busy_timeout, damit BEGIN IMMEDIATE bei paralleler Konkurrenz (C11, C3) auf den anderen Writer wartet
  // statt sofort mit SQLITE_BUSY auszusteigen.
  try { db.exec('PRAGMA busy_timeout = 5000'); } catch { /* best effort */ }
  const app = express();
  app.disable('x-powered-by');
  app.use(erstelleSetupStatischRouter());
  if (konfig.trustProxy > 0) app.set('trust proxy', konfig.trustProxy);

  app.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ modus: konfig.modus });
  });

  if (konfig.modus === 'setup') {
    // Beim Start einmalig einen Code erzeugen (INSERT OR IGNORE: zwei gleichzeitig startende Prozesse ergeben genau einen Code).
    const auth = await import('./auth.mjs');
    const { erzeugeEinrichtungscode } = await import('./erststart.mjs');
    try { erzeugeEinrichtungscode(db, { dateiPfad: 'daten/ERSTSTART.txt' }); }
    catch (e) { console.error('Einrichtungscode-Erzeugung fehlgeschlagen:', e?.code || e?.name || 'unbekannt'); }
    app.use(erstelleEinrichtungsRouter({ db, erststartDateiPfad: 'daten/ERSTSTART.txt', auth }));
  } else {
    // Einrichtungsmodus: Anmeldung des bereits erstellten Admins + Platzhalter /admin/einrichtung.
    // Neustart loescht alle alten Sitzungen (Z2: alter Cookie wird nach Neustart ungueltig).
    try { db.prepare('DELETE FROM sitzungen').run(); } catch { /* best effort */ }
    const auth = await import('./auth.mjs');
    app.use('/anmelden', spracheMiddleware);
    app.use(express.urlencoded({ extended: false, limit: '16kb' }));
    const secureCookies = konfig.baseUrl.startsWith('https://');
    app.get('/anmelden', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'same-origin'); // F-131: same-origin statt no-referrer, damit Browser-Formular POST Origin mitschickt
      res.status(200).type('text/html; charset=utf-8').send(anmeldeSeite());
    });
    app.post('/anmelden', async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      // P14: Origin-Pruefung (CSRF-Schutz vor fremden Webseiten)
      const herkunft = req.headers['origin'];
      if (herkunft && herkunft !== konfig.baseUrl) return res.status(403).type('text/plain').send('nicht_gefunden');
      const ctype = String(req.headers['content-type'] || '').toLowerCase();
      if (!ctype.startsWith('application/x-www-form-urlencoded')) return res.status(400).type('text/plain').send('nicht_gefunden');
      const email = auth.emailPruefen(req.body?.email);
      if (!email) return res.status(401).type('text/html; charset=utf-8').send(anmeldeSeite(true, res.getHeader('Content-Language')));
      // PUNKT-3-EIN: Brute-Force-Schutz — Zaehler vor dem Hash inkrementieren und danach nochmals pruefen.
      const schluessel = req.ip + '|einr-anmelden';
      if (auth.gesperrt(schluessel)) return res.status(429).type('text/plain').send('nicht_gefunden');
      auth.fehlversuchMerken(schluessel);
      if (auth.gesperrt(schluessel)) return res.status(429).type('text/plain').send('nicht_gefunden');
      const row = db.prepare("SELECT id, passwort_hash, rolle, sprache FROM benutzer WHERE email = ?").get(email);
      if (!row || row.rolle !== 'admin' || !(await auth.passwortPruefen(String(req.body?.passwort || ''), row.passwort_hash))) {
        return res.status(401).type('text/html; charset=utf-8').send(anmeldeSeite(true, res.getHeader('Content-Language')));
      }
      auth.fehlversucheLoeschen(schluessel);
      const token = auth.sitzungErzeugen(row.id, konfig.maxSitzungen || 3);
      auth.cookieSetzen(res, token, secureCookies);
      // cookieSetzen ersetzt alle Set-Cookie-Kopfzeilen: das lang-Cookie wird deshalb danach neu angehaengt. Explizite Wahl (?lang=) gewinnt vor der Kontosprache.
      // Reihenfolge: lang-Cookie ZUERST, Sitzungs-Cookie zuletzt (viele Selbsttests lesen das letzte Set-Cookie als Sitzung; Browser ist die Reihenfolge egal).
      const langCookie = l => 'lang=' + l + '; Path=/; Max-Age=31536000; SameSite=Lax';
      let gewaehlt = null;
      if (Object.hasOwn(req.query, 'lang')) { if (gueltigeSprache(req.query.lang)) gewaehlt = req.query.lang; }
      // Kontosprache nur als Cookie setzen, wenn sie von der fuer diese Anfrage geltenden Sprache abweicht (sonst genuegt das Sitzungs-Cookie allein).
      else if (!/(?:^|;\s*)lang=/.test(req.headers.cookie || '') && gueltigeSprache(row.sprache) && row.sprache !== res.getHeader('Content-Language')) gewaehlt = row.sprache;
      if (gewaehlt) res.setHeader('Set-Cookie', [langCookie(gewaehlt)].concat(res.getHeader('Set-Cookie') || []));
      res.status(303).set('Location', '/admin/einrichtung').end();
    });
    // P12 (F-49): Step-up-Auth fuer sensible Einrichtungsschritte auch im Einrichtungsmodus.
    // F-109: Brute-Force-Schutz wie bei Anmeldung (P3-Muster).
    app.post('/api/admin/stepup', express.json({ limit: '16kb' }), async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const benutzer = auth.aktuellerBenutzer(req);
      if (!benutzer || benutzer.rolle !== 'admin') return res.status(401).type('text/plain').send('nicht_angemeldet');
      if (typeof req.body?.passwort !== 'string') return res.status(400).type('text/plain').send('body_ungueltig');
      const bfSchluessel = `${req.ip}|stepup`;
      if (auth.gesperrt(bfSchluessel)) return res.status(429).type('text/plain').send('zu_viele_versuche');
      auth.fehlversuchMerken(bfSchluessel);
      if (auth.gesperrt(bfSchluessel)) return res.status(429).type('text/plain').send('zu_viele_versuche');
      const altHash = db.prepare('SELECT passwort_hash FROM benutzer WHERE id=?').get(benutzer.id)?.passwort_hash;
      const richtig = await auth.passwortPruefen(req.body.passwort, altHash);
      if (!richtig) return res.status(403).type('text/plain').send('passwort_aktuell_falsch');
      auth.fehlversucheLoeschen(bfSchluessel);
      auth.stepupErzeugen(auth.aktuellesToken(req));
      return res.json({ ok: true });
    });
    const { holeHauptschluessel: holeHs, verschluesselteWerteVorhanden: vhVorhanden } = await import('./einstellungen.mjs');
    let assistentHauptschluessel;
    try {
      assistentHauptschluessel = holeHs({ env: process.env, dateiPfad: 'daten/.hauptschluessel', verschluesselteWerteVorhanden: vhVorhanden(db) });
    } catch (e) {
      if (!(e instanceof KonfigFehler)) throw e;
      console.error('Abbruch: Hauptschluessel-Fehler im Einrichtungsmodus:');
      for (const meldung of e.meldungen) console.error(`  - ${meldung}`);
      process.exit(1);
    }
    const neustarten = () => { if (serverRef) serverRef.close(() => process.exit(0)); else process.exit(0); };
    const routerOptionen = { aufpasser: process.env.AUFPASSER === '1', schluesselAusEnv: !!(process.env.EINSTELLUNGEN_SCHLUESSEL), reparaturFehler, neustarten, env: process.env };
    const { erstelleAssistentRouter } = await import('./assistent-routen.mjs');
    app.use('/admin/einrichtung', erstelleAssistentRouter(db, konfig, assistentHauptschluessel, routerOptionen));
    // F-188: marke-Tabelle anlegen + anbieterDb setzen, damit leseAnbieter() im Einrichtungsmodus
    // auf marke-Daten zugreifen kann (Priorität: marke → umgebung → einstellungen → standard).
    const { setzeAnbieterDb: setzaDb } = await import('./anbieter.mjs');
    db.exec("CREATE TABLE IF NOT EXISTS marke (schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL, aktualisiert_am TEXT NOT NULL)");
    setzaDb(db);
    // Alte /einrichtung-Routen: 404 (Spez-6: nach Abschluss alle /einrichtung-Routen 404).
    // WP5: öffentliche Logo-Route auch im Einrichtungsmodus
    const { logoRouteHandler, machLogoPfad } = await import('./logo-png.mjs');
    app.get('/marke/logo.png', logoRouteHandler(machLogoPfad(konfig.dbDatei)));
    // WP6: erzeugte Rechtsseiten öffentlich, VOR Catch-All (R5: ohne Anmeldung erreichbar)
    const { erstelleRechtRouter } = await import('./recht-vorlagen.mjs');
    app.use(erstelleRechtRouter());
  }

  // Catch-all: 404 neutral ohne Pfadname/Version/Stacktrace.
  app.use((_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).type('text/plain').send('nicht_gefunden');
  });
  // WP8 N2: globaler Fehlerhandler (vier Parameter); verhindert Stacktrace-Leaks im Express-Standardhandler.
  // Express erkennt Fehlerhandler an genau vier Parametern – nicht umbenennen.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (res.headersSent) return next(err);
    const status = typeof err?.status === 'number' ? err.status :
      typeof err?.statusCode === 'number' ? err.statusCode : 500;
    res.setHeader('Cache-Control', 'no-store');
    const kode = 'server_fehler';
    if (req.path.startsWith('/admin/')) {
      res.status(status).json({ fehler: kode });
    } else {
      res.status(status).type('text/plain').send(kode);
    }
  });
  const server = app.listen(konfig.port, konfig.host, () => console.log(`Schulungsplattform ${konfig.modus === 'setup' ? 'Setup-Modus' : 'Einrichtungsmodus'}: ${konfig.baseUrl} (lauscht auf ${konfig.host}:${konfig.port})`));
  serverRef = server;
  server.requestTimeout = 60 * 60 * 1000;
  process.on('unhandledRejection', (grund) => { console.error('Unbehandelte Ablehnung:', grund?.code || grund?.name || 'unbekannt'); });
  process.on('uncaughtException', (fehler) => { console.error('Unbehandelter Fehler:', fehler?.code || fehler?.name || 'unbekannt'); setTimeout(() => process.exit(1), 1000).unref?.(); });
  process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 25000).unref?.(); });
} else {
  // Die Datenbank (db.mjs) liest DB_DATEI beim Laden. Erst laden, wenn die Konfiguration stimmt, damit bei einem Fehler nichts angelegt wird.
  process.env.DB_DATEI = konfig.dbDatei;
  const { db: dbNormal } = await import('./db.mjs');
  const { erstelleServer } = await import('./app.mjs');
  const { resendMailer } = await import('./mail.mjs');
  const { erstelleBunny } = await import('./bunny.mjs');

  const stripe = new Stripe(konfig.stripeSecretKey, { apiVersion: '2025-07-30.basil', timeout: 20000, maxNetworkRetries: 2 });
  const server = erstelleServer({ anbieterQuelle: konfig.anbieterQuelle, nameFix: String(process.env.PLATTFORM_NAME ?? '').trim() !== '', stripe, webhookSecret: konfig.stripeWebhookSecret, base: konfig.baseUrl, trustProxy: konfig.trustProxy, dateiOrdner: konfig.dateiOrdner, maxUploadBytes: konfig.maxUploadBytes, wiedergabeSchluessel: konfig.wiedergabeSchluessel, maxSitzungen: konfig.maxSitzungen, bunny: erstelleBunny(konfig.bunnyStream), bunnyMaxBytes: konfig.bunnyStreamMaxBytes, plattformWebhook: konfig.plattformWebhook, mailer: resendMailer({ apiKey: konfig.resendApiKey, from: konfig.mailFrom }), verkaufsmeldungMail:konfig.verkaufsmeldungMail, registrierungMeldung:konfig.registrierungMeldung, ereignisAufbewahrungTage:konfig.ereignisAufbewahrungTage, supportMail:konfig.supportMail, anbieter:konfig.anbieter, rechtsseiten:konfig.rechtsseiten, sicherungOrdner:konfig.sicherungOrdner,sicherungSchluessel:konfig.sicherungSchluessel,sicherungBunny:konfig.sicherungBunny,alarmMails:konfig.alarmMails,nodeEnv:konfig.nodeEnv, abgleichModus:konfig.stripeSecretKey.startsWith('sk_live_')?'live':'test', adminErlaubt:konfig.adminErlaubt,notfallEntsperren:konfig.notfallEntsperren,verkaufPausiert:konfig.verkaufPausiert, plattformName:konfig.plattformName, demoModus:konfig.demoModus,demoOptionen:{maxKaeuferTag:konfig.demoMaxKaeuferTag,bunnyVideoId:konfig.demoBunnyVideoId}, dbDatei:konfig.dbDatei, stripeSecretKey:konfig.stripeSecretKey })
    .listen(konfig.port, konfig.host, () => console.log(`Schulungsplattform läuft: ${konfig.baseUrl} (lauscht auf ${konfig.host}:${konfig.port})`));
  // Node beendet Anfragen standardmäßig nach 5 Minuten. Große Videos brauchen auf einer langsamen Leitung länger: bis zu 60 Minuten.
  server.requestTimeout = 60 * 60 * 1000;

  // WP9: Erster Normalstart nach Abschluss des Assistenten: KONFIGURIERT -> AKTIV + erster Kurs anlegen (idempotent).
  if (startZustand === 'KONFIGURIERT') {
    try { dbNormal.exec('PRAGMA busy_timeout = 5000'); } catch { /* best effort */ }
    const jetzt = new Date().toISOString();
    // Erster Kurs anlegen (idempotent ueber kurs_angelegt; Markierung und INSERT in einer Transaktion)
    try {
      dbNormal.exec('BEGIN IMMEDIATE');
      const kursJson = dbNormal.prepare("SELECT wert FROM einstellungen WHERE schluessel = 'erster_kurs_json' AND verschluesselt = 0").get()?.wert;
      const kursAngelegt = dbNormal.prepare("SELECT wert FROM einstellungen WHERE schluessel = 'kurs_angelegt' AND verschluesselt = 0").get()?.wert;
      if (kursJson && kursAngelegt !== '1') {
        const kd = JSON.parse(kursJson);
        dbNormal.prepare("INSERT INTO kurse (titel, beschreibung, preis_cent, waehrung, status, erstellt, geaendert) VALUES (?,?,?,?,'entwurf',?,?)").run(
          String(kd.titel ?? '').slice(0, 200) || 'Kurs 1',
          String(kd.beschreibung ?? '').slice(0, 5000),
          Number.isSafeInteger(parseInt(kd.preis_cent, 10)) && parseInt(kd.preis_cent, 10) >= 0 ? parseInt(kd.preis_cent, 10) : 0,
          kd.waehrung === 'eur' ? 'eur' : 'huf',
          jetzt, jetzt
        );
        dbNormal.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, iv, tag, aktualisiert_am) VALUES ('kurs_angelegt','1',0,NULL,NULL,?)").run(jetzt);
      }
      dbNormal.exec('COMMIT');
    } catch (e) {
      try { dbNormal.exec('ROLLBACK'); } catch { /* ignore */ }
      console.error('Warnung: Erster Kurs konnte nicht angelegt werden:', e?.code || e?.name || 'unbekannt');
    }
    // Zustand auf AKTIV setzen (eigene Transaktion, auch wenn Kursanlage fehlschlug)
    try {
      dbNormal.exec('BEGIN IMMEDIATE');
      dbNormal.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, iv, tag, aktualisiert_am) VALUES ('instanz_zustand','AKTIV',0,NULL,NULL,?)").run(new Date().toISOString());
      dbNormal.exec('COMMIT');
    } catch (e) {
      try { dbNormal.exec('ROLLBACK'); } catch { /* ignore */ }
      console.error('Warnung: AKTIV-Markierung fehlgeschlagen:', e?.code || e?.name || 'unbekannt');
    }
  }

  // Pruefrunde 3 (Agent H): ein vergessener Fehler in einem Zeitgeber (zum Beispiel Mail-Ausgang) darf den Prozess nicht beenden.
  process.on('unhandledRejection', (grund) => { console.error('Unbehandelte Ablehnung:', grund?.code || grund?.name || 'unbekannt'); });
  process.on('uncaughtException', (fehler) => { console.error('Unbehandelter Fehler:', fehler?.code || fehler?.name || 'unbekannt'); setTimeout(() => process.exit(1), 1000).unref?.(); });
  // Render beendet den Dienst bei einem Deploy mit SIGTERM: erst laufende Anfragen beenden lassen (hoechstens 25 Sekunden).
  process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 25000).unref?.(); });
}
