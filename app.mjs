// Die Schulungsplattform als Funktion: Stripe wird von außen übergeben, damit Tests eine Attrappe einsetzen können.
// Die Datenbank ist db.mjs (Datei aus der Umgebungsvariable DB_DATEI; Tests setzen sie vor dem Import).
// Alle Einstellungen aus der Umgebung prüft konfig.mjs (server.mjs übergibt sie hierher).
import { demoUebersetzungAn } from './demo-uebersetzung.mjs';
import { farbenLink, setzePlattform, markeRouter, setzeLogoPfad } from './marke.mjs';
import { bannerRouteHandler } from './banner-bild.mjs';
import { logoRouteHandler, machLogoPfad } from './logo-png.mjs';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { webhookHandler, kaufRouter } from './zahlung.mjs';
import { erstelleAuthRouter, herkunftSchutz } from './routes-auth.mjs';
import { beispieleRouter } from './routes-beispiele.mjs';
import { kategorienRouter } from './routes-kategorien.mjs';
import { kurseRouter, jsonFehler, kurseFehlerBehandlung, nurAdmin } from './routes-kurse.mjs';
import { plattformMeldung } from './plattform-meldung.mjs';
import {kurspaketRouter} from './routes-kurspaket.mjs';
import { bestellungenRouter } from './routes-bestellungen.mjs';
import { dateienRouter } from './dateien.mjs';
import { erstelleBunny } from './bunny.mjs';
import { setzeBunny, nachholen, setzeAlarmHaken } from './bunny-loeschen.mjs';
import { stripeKundenNachholen, kannStripeKundenLoeschen, NACHHOLEN_MS } from './stripe-kunde-loeschen.mjs';
import { bunnyRouter } from './routes-bunny.mjs';
import { vorschauRouter } from './vorschau.mjs';
import { texteRouter, seitenRouter, rechtRouter, betreiberRechtRouter, fehler, HU, sprache, locale, spracheMiddleware } from './texte.mjs';
import { erstelleRechtRouter } from './recht-vorlagen.mjs';
import { erstelleRechtAdminRouter } from './routes-recht-admin.mjs';
import { passwortRouter } from './routes-passwort.mjs';
import { mailDienst } from './mail.mjs';
import { STANDARD_EREIGNIS_AUFBEWAHRUNG_TAGE } from './konfig.mjs';
import { ereignisKonfigurieren, ereignisseAufraeumen, ereignisPlattformSetzen } from './ereignis-liste.mjs';
import { ereignisseRouter } from './routes-ereignisse.mjs';
import { bestaetigungRouter } from './routes-bestaetigung.mjs';
import { kontoRouter } from './routes-konto.mjs';
import { ellallasRouter, haengendeEllallasWiederaufnehmen } from './routes-ellallas.mjs';
import { agentRouter,agentAdminRouter,agentAudit } from './routes-agent.mjs';
import { openapi } from './agent-openapi.mjs';
import { sicherungRouter } from './routes-sicherung.mjs';
import { alarmDienst } from './sicherung-alarm.mjs';
import { abgleichRouter } from './routes-abgleich.mjs';
import { abgleichAlarm } from './abgleich-alarm.mjs';
import { abgleichGesundheit } from './abgleich.mjs';
import {adminStart} from './admin-start.mjs';
import {adminLoginRouter} from './routes-admin-login.mjs';
import {verkaufRouter,verkaufStart} from './routes-verkauf.mjs';
import { demoSchutz, demoRouter, demoMailer, demoSeedWennLeer, demoKonfigSetzen } from './demo.mjs';
import { registrierungLimitKonfig } from './registrierung-limit.mjs';
import { adminSeiteRouter, sicherheitsKopfzeilen, sicherheitsKopfzeilenMitBunny } from './routes-admin-seite.mjs';
import { markeAdminRouter } from './routes-marke.mjs';
import { setzeAnbieterBasis, leseAnbieter as leseAnbieterAktuell } from './anbieter.mjs';
import { testkaufRouter } from './routes-testkauf.mjs';

// trustProxy: Anzahl der Vermittler (Proxys) vor der App, 0 = keiner. Hinter dem Render-Proxy muss er 1 sein, sonst sieht die App
// nur die Adresse des Proxys (die Sperre nach Fehlversuchen träfe dann alle gemeinsam) und erkennt https nicht.
// dateiOrdner und maxUploadBytes kommen aus konfig.mjs (DATEI_ORDNER, MAX_UPLOAD_MB).
export function erstelleServer({ anbieterQuelle = 'umgebung', nameFix = false, stripe, webhookSecret, base, trustProxy = 0, dateiOrdner = 'daten/dateien', maxUploadBytes = 500 * 1024 * 1024, wiedergabeSchluessel, maxSitzungen = 3, mailer = null, verkaufsmeldungMail = '', registrierungMeldung = true, ereignisAufbewahrungTage = STANDARD_EREIGNIS_AUFBEWAHRUNG_TAGE, supportMail = '', anbieter = {}, rechtsseiten = {}, sicherungOrdner='daten/sicherung',sicherungSchluessel=null,sicherungBunny=null,alarmMails=[],nodeEnv='development',sicherungFetch=fetch,abgleichAutomatik=true,abgleichPause,abgleichModus='test',adminErlaubt=[],notfallEntsperren=false,verkaufPausiert=false,bunny=null,bunnyMaxBytes=4000*1024*1024, plattformWebhook=null, ellallasWiederaufnahme=true, demoModus=false,demoOptionen={}, plattformName='Musterakademie', dbDatei='daten/lern-app.db', stripeSecretKey='' }) {
  setzePlattform(plattformName);   // Produktreife Block 2: Markenname fuer Texte, Mails, Logo (Standard Musterakademie = wie bisher)
  setzeAnbieterBasis(anbieter, anbieterQuelle);
  setzeLogoPfad(machLogoPfad(dbDatei)); // A1a: PNG-Logopfad setzen damit logoPfade() PNG-URL liefert wenn Datei vorhanden
  if (demoModus) mailer = demoMailer(mailer);   // B9: Mails an Demo-Konten werden nie versendet
  const app = express();
  app.locals.dateiOrdner = dateiOrdner;
  // Demo: Es gibt nur den Demo-Admin (reine Ansicht, alle Schreibwege 403, keine Admin-Anlage ueber die App). Die Erlaubnisliste hat dort keinen Zweck und fand beim
  // Start der leeren Datenbank keinen Admin (Warnung + Alarmversuch bei jedem Start). Im Normalbetrieb gilt ADMIN_ERLAUBT unveraendert.
  adminStart({liste:demoModus?[]:adminErlaubt,notfall:notfallEntsperren,mailer,alarmMails});
  verkaufStart(verkaufPausiert,mailer,alarmMails);
  // A8-02: endgueltig fehlgeschlagene Mails melden den Betreiber ueber den Alarmweg (ALARM_MAIL; Drossel: eine Alarmmail je 6 Stunden, kein Wiederholen ueber die Warteschlange).
  const mailAlarm = alarmDienst({ mailer, adressen: alarmMails });
  const mails = mailDienst({ mailer, base, logoPfad: machLogoPfad(dbDatei), verkaufsmeldungMail, registrierungMeldung, supportMail, anbieter, demoModus: !!demoModus,
    alarm: (grund) => mailAlarm(grund, { praefix: 'mail', betreff: HU.mail_alarm_betreff, fehler: HU.mail_alarm_fehler, teendo: HU.mail_alarm_teendo }) });
  app.locals.kontoMailAktiv=!!mailer;
  app.locals.kontoMailSenden=mails.kontoMailSenden;
  app.locals.kontoNachCommitSenden=mails.kontoNachCommitSenden;
  app.locals.kaufMailSenden=()=>{void mails.ausgangSenden().catch(()=>{});};
  app.locals.kontoBase=base;
  app.locals.kontoSecureCookies=base.startsWith('https://');
  app.locals.kontoStripe=stripe;
  // A6-01: gescheiterte Stripe-Kundenloeschungen (Kontoloeschung) beim Start und alle 10 Minuten wiederholen; haelt den Prozess nie am Leben.
  if(kannStripeKundenLoeschen(stripe)){ setTimeout(()=>{void stripeKundenNachholen(stripe);},5000).unref?.(); setInterval(()=>{void stripeKundenNachholen(stripe);},NACHHOLEN_MS).unref?.(); }
  app.locals.abgleichModus=abgleichModus;
  app.locals.ellallasMailSenden=mails.ellallasNachCommitSenden;
  if(ellallasWiederaufnahme){ const lauf=()=>haengendeEllallasWiederaufnehmen(stripe,mails.ellallasNachCommitSenden).catch(()=>{}); setTimeout(lauf,3000).unref?.(); setInterval(lauf,60000).unref?.(); }
  app.locals.aboErstattungNachCommitSenden=mails.aboErstattungNachCommitSenden;
  app.locals.ellallasSupportMail=supportMail;
  // Block 4: Mail an den Kunden, wenn der Admin einen Zugang erteilt (vormerken in der Transaktion, senden nach dem Commit).
  app.locals.zugangMailVormerken=mails.zugangVormerken;
  app.locals.zugangNachCommitSenden=mails.zugangNachCommitSenden;
  ereignisKonfigurieren({aktiv:!!mailer&&!!verkaufsmeldungMail,registrierung:registrierungMeldung,senden:mails.meldungNachCommitSenden});
  // Plattform-Meldung (Dashboard-Anbindung): aus, wenn plattformWebhook null ist. Wiederholt offene Meldungen alle 5 Minuten, raeumt taeglich auf.
  const plattform=plattformMeldung({...(plattformWebhook||{}),stripe});
  ereignisPlattformSetzen(plattform);
  if(plattform.an){
    const plattformTimer=setInterval(()=>{void plattform.senden().catch(()=>{});plattform.aufraeumen();},5*60*1000);
    plattformTimer.unref?.();
    plattform.abgleich(false);   // beim Start nur FEHLENDE Zeilen vormerken (kein erneutes Senden aller Zeilen bei jedem Neustart); taeglich dann alle neu: heilt verpasste Aenderungen
    void plattform.stripeAbgleich().then(()=>plattform.nachCommit()).catch(()=>{});   // Auszahlungen und Streitfaelle von Stripe (nur lesend)
    const plattformAbgleichTimer=setInterval(()=>{plattform.abgleich();void plattform.stripeAbgleich().then(()=>plattform.nachCommit()).catch(()=>{});plattform.nachCommit();},24*60*60*1000);
    plattformAbgleichTimer.unref?.();
    plattform.nachCommit();
  }
  ereignisseAufraeumen(ereignisAufbewahrungTage);
  const aufraeumenTimer=setInterval(()=>ereignisseAufraeumen(ereignisAufbewahrungTage),24*60*60*1000);
  aufraeumenTimer.unref?.();
  app.disable('x-powered-by');
  if (trustProxy > 0) app.set('trust proxy', trustProxy);
  const secureCookies = base.startsWith('https://');   // Cookie bekommt "Secure", sobald die öffentliche Adresse https ist

  if (secureCookies) app.use((_req,res,next) => { res.setHeader('Strict-Transport-Security','max-age=31536000'); next(); });

  // Webhook zuerst, VOR express.json() (Signatur über den unveränderten Rohtext)
  app.post('/webhook', ...webhookHandler({ stripe, webhookSecret, mails, abgleichModus }));

  // Sprache je Anfrage (nach dem Webhook, der seine Sprache aus den Checkout-Metadaten nimmt)
  app.use(spracheMiddleware);

  // Ab hier normale JSON-Anfragen
  app.use(bunny && bunny.an ? sicherheitsKopfzeilenMitBunny : sicherheitsKopfzeilen);   // mit Bunny: zusaetzlich frame-src nur fuer den Bunny-Player; ohne Bunny exakt wie bisher
  // Auch ein JSON-Parsefehler darf keine Passwortantwort im Cache speichern.
  app.use((req,res,next) => {
    if (/^\/api\/passwort-/i.test(req.path)) res.setHeader('Cache-Control','no-store');
    next();
  });
  // Nur Agent-Entwürfe dürfen bis zu 20.000 Unicode-Zeichen Lektionstext annehmen.
  app.use('/api/agent',express.json({ limit: '128kb' }));
  // Nur die beiden Kurspaket-POSTs duerfen mehr als 10 KB annehmen; alle anderen Limits bleiben unveraendert.
  const paketPfad=/^\/api\/admin\/kurspaket\/(?:pruefen|anlegen)\/?$/i;   // /i und optionaler Schraegstrich: Express leitet auch /api/Admin/... und .../anlegen/ hierher (F-02)
  app.use((req,res,next)=>req.method==='POST'&&paketPfad.test(req.path)
    ?express.json({limit:'310kb'})(req,res,next):next());
  app.use((err,req,res,next)=>{
    if(req.method==='POST'&&paketPfad.test(req.path)&&err?.type==='entity.too.large'){
      res.setHeader('Cache-Control','no-store');
      return res.status(400).json({fehler:[{pfad:'paket',code:'paket_groesse'}]});
    }
    next(err);
  });
  const rechtAdminPfad = /^\/api\/admin\/recht\b/;
  app.use((req, res, next) => req.method === 'POST' && rechtAdminPfad.test(req.path)
    ? express.json({ limit: '100kb' })(req, res, next) : next());
  app.use((err, req, res, next) => {
    if (rechtAdminPfad.test(req.path) && err?.type === 'entity.too.large') return res.status(413).end();
    next(err);
  });
  app.use((req, res, next) => req.method === 'POST' && /^\/api\/admin\/marke\/vorschau\/mail\/?$/i.test(req.path)
    ? next() : express.json({ limit: '10kb' })(req, res, next));
  // Auch bei fremder Origin muss ein Agent-Bearer am Kurspaket-POST abgelehnt UND auditiert werden.
  app.use((req,res,next)=>{
    if(req.method==='POST'&&paketPfad.test(req.path)&&/^Bearer vat_/.test(req.headers.authorization||'')){
      agentAudit(null,req.method+' '+req.path,'','abgelehnt','agent_verboten');
      return fehler(res,403,'agent_verboten');
    }
    next();
  });
  const browserHerkunft=herkunftSchutz(base);
  // Die strikt Cookie-freie Agent-API nutzt Bearer statt Browser-CSRF; alle Cookie-Routen bleiben geschützt.
  app.use((req,res,next)=>req.path.startsWith('/api/agent/')?next():browserHerkunft(req,res,next));
  // Agent-Bearer darf niemals als Authentifizierung für normale APIs dienen.
  app.use((req,res,next)=>{
    if(/^Bearer vat_/.test(req.headers.authorization||'')&&!req.path.startsWith('/api/agent/')){
      agentAudit(null,req.method+' '+req.path,'','abgelehnt','agent_verboten');
      return fehler(res,403,'agent_verboten');
    }
    next();
  });
  demoUebersetzungAn(!!demoModus);
  demoKonfigSetzen(demoOptionen);
  registrierungLimitKonfig({ lokalAusnahme: nodeEnv !== 'production' });   // in Produktion keine Ausnahme fuer 127.x (auch nicht per gefaelschtem X-Forwarded-For bei mehreren Proxys)
  // Demo-Schutz VOR ALLEN Routen (Gesamtpruefung 12.11.2026, F-01): vorher hing /api/admin/agent davor, der Demo-Admin konnte dort schreiben.
  // Vor demoSchutz liegen nur der Stripe-Webhook (/webhook), Sprache, Sicherheitskopfzeilen, JSON-Parser, Herkunfts- und Bearer-Pruefung.
  // Die Bearer-Agent-API (/api/agent) ist cookiefrei: demoSchutz findet dort keine Sitzung und laesst sie unveraendert durch.
  if (demoModus) app.use(demoSchutz);
  app.get('/agent/openapi.json',(_req,res)=>res.json(openapi(base)));
  app.use('/api/agent',agentRouter);
  app.use('/api/admin/agent',agentAdminRouter);
  if (demoModus) { app.use(demoRouter({ maxSitzungen, secureCookies })); void demoSeedWennLeer({ dateiOrdner, ...(demoOptionen.handbuchOrdner ? { handbuchOrdner: demoOptionen.handbuchOrdner } : {}) }).catch(() => console.warn('Demo-Seed nicht moeglich')); }
  app.use(adminLoginRouter);
  // Kurspaket-Änderungen verlangen explizit eine gleichursprüngliche Browser-Herkunft.
  // Der allgemeine CSRF-Schutz anderer APIs bleibt unverändert.
  app.use((req,res,next)=>{
    if(req.method==='POST'&&paketPfad.test(req.path)&&req.headers.origin!==base)
      return fehler(res,403,'herkunft_fremd');
    next();
  });
  app.use(kurspaketRouter);
  app.use(verkaufRouter({env:verkaufPausiert,mailer,alarmMails}));
  const backupAlarm=alarmDienst({mailer,adressen:alarmMails});
  app.use(sicherungRouter({ordner:sicherungOrdner,schluessel:sicherungSchluessel,nodeEnv,bunny:sicherungBunny,alarm:backupAlarm,fetchFn:sicherungFetch,abgleichPruefen:abgleichGesundheit,demoModus:!!demoModus}));
  const abgleichMail=abgleichAlarm({mailer,adressen:alarmMails,base});
  app.use(abgleichRouter({stripe,modus:abgleichModus,alarm:abgleichMail,automatik:abgleichAutomatik,pause:abgleichPause}));
  app.use(erstelleRechtRouter());                                             // WP6: erzeugte Seiten VOR betreiberRechtRouter (kein Redirect-Loop)
  app.use(betreiberRechtRouter({ demoModus: !!demoModus, rechtsseiten }));   // Produktreife: ohne Demo keine Muster-Rechtsseiten
  app.use(rechtRouter);
  app.use(seitenRouter);                                // Startseiten mit Sprache der Anfrage
  app.use(adminSeiteRouter);                            // /admin
  // pdf.js: Module und Worker erhalten garantiert den richtigen JavaScript-MIME-Typ.
  app.use('/vendor/pdfjs', express.static(fileURLToPath(new URL('./public/vendor/pdfjs', import.meta.url)), {
    setHeaders(res, pfad) {
      if (pfad.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    },
  }));
  // Erklaervideo aus dem bereits vorhandenen oeffentlichen Videoordner.
  // Express Static liefert Byte-Ranges (206) und 404 bei fehlenden Dateien.
  app.use('/video', express.static(fileURLToPath(new URL('./public/video', import.meta.url)), {
    maxAge: '1h',
    setHeaders(res, pfad) {
      // sicherheitsKopfzeilen setzt vorher "no-cache"; static ueberschreibt einen vorhandenen Wert nicht, also hier explizit.
      res.setHeader('Cache-Control', 'public, max-age=3600');
      if (pfad.endsWith('.mp4')) res.setHeader('Content-Type', 'video/mp4');
    },
  }));
  app.use(markeRouter);                                 // Textlogo /img/marke-logo*.svg bei eigenem PLATTFORM_NAME
  app.get('/marke/banner', bannerRouteHandler(machLogoPfad(dbDatei)));
  app.get('/marke/logo.png', logoRouteHandler(machLogoPfad(dbDatei)));  // WP5: PNG-Logo öffentlich
  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
  app.use(texteRouter);
  app.get('/api/anbieter',(_req,res)=>{res.setHeader('Cache-Control','no-store');const a=leseAnbieterAktuell();res.json({anbieter:{ANBIETER_NAME:a.name,ANBIETER_ANSCHRIFT:a.anschrift,ANBIETER_EMAIL:a.email,ANBIETER_TELEFON:a.telefon,ANBIETER_ADOSZAM:a.adoszam,STEUER_HINWEIS:a.steuerHinweis},demo:!!demoModus});});
  app.use(erstelleAuthRouter({ secureCookies, maxSitzungen, mails }));
  app.use(bestaetigungRouter({ mails }));
  app.use(passwortRouter({ base, mailDienst: mails }));
  app.use(kontoRouter);
  app.use(ellallasRouter);
  app.use(beispieleRouter);
  app.use(kurseRouter);
  app.use(kategorienRouter);
  app.use(vorschauRouter({ ordner:dateiOrdner }));
  app.use(bestellungenRouter);
  app.use(ereignisseRouter);
  app.use(kaufRouter({ stripe, base, bestaetigungPflicht: mails.mailAktiv, mails,verkaufPausiert }));
  // Bunny Stream (docs/BUNNY-STREAM-PLAN.md): ohne Einstellungen ist "bunny" aus (erstelleBunny(null)); es geht dann keine einzige Anfrage an Bunny.
  const bunnyDienst = bunny || erstelleBunny(null);
  app.use(dateienRouter({ ordner: dateiOrdner, maxBytes: maxUploadBytes, wiedergabeSchluessel, bunny: bunnyDienst }));   // Upload (Admin) und Auslieferung (nur Käufer)
  setzeBunny(bunnyDienst);
  // Schritt 8 (VIDEO-11): scheitert ein Loeschauftrag wiederholt, geht derselbe Alarm wie bei der Sicherung an die Alarm-Adressen (mit Bunny-Texten, gedrosselt).
  setzeAlarmHaken((grund) => backupAlarm(grund, { praefix: 'bunny', betreff: HU.bunny_alarm_betreff, fehler: HU.bunny_alarm_fehler, teendo: HU.bunny_alarm_teendo }));
  app.use(bunnyRouter({ bunny: bunnyDienst, maxBytes: bunnyMaxBytes }));
  app.use(markeAdminRouter(machLogoPfad(dbDatei), { nameFix, supportMail, demoModus: !!demoModus, anbieter }));
  app.use(testkaufRouter(stripeSecretKey));
  app.use(erstelleRechtAdminRouter(base));
  app.get('/api/admin/plattform',nurAdmin,(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json(plattform.lage());});
  void nachholen();                                                                              // Reste aus dem Loesch-Auftragsbuch (z. B. Bunny war kurz nicht erreichbar) beim Start erneut versuchen
  // Danach alle 10 Minuten: Loesch-Auftraege wiederholen und fertig hochgeladene Videos uebernehmen (nur wenn Bunny an ist; haelt den Prozess nie am Leben).
  if (bunnyDienst.an) setInterval(() => { void nachholen(); }, 10 * 60 * 1000).unref();
  // Pruefrunde 4 (Sprache): alles, was weder Route noch Datei ist, bekommt eine UNGARISCHE 404-Antwort (sonst zeigt Express die englische
  // Standardseite 'Cannot GET ...'). API-Pfade, andere Methoden und Anfragen ohne HTML-Wunsch bekommen JSON mit ungarischem Text.
  app.use((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/') || req.method !== 'GET' || !/text\/html/.test(req.headers.accept || ''))
      return fehler(res, 404, 'nicht_gefunden');
    res.status(404).type('html').send('<!doctype html><html lang="'+sprache()+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>' + HU.oldal_nem_talalhato + '</title><link rel="stylesheet" href="/kunde.css">' + farbenLink() + '</head><body><main class="oldal-main"><h1>' + HU.oldal_nem_talalhato + '</h1><p><a class="knopf" href="/">' + HU.oldal_vissza + '</a></p></main></body></html>');
  });
  app.use(jsonFehler);
  app.use(kurseFehlerBehandlung);
  mails.starten();
  return app;
}
