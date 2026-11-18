// Konfiguration der Schulungsplattform: liest und prüft ALLE Umgebungsvariablen EINMAL beim Start.
// Bei einem Fehler bricht der Start mit klaren deutschen Meldungen ab. Die Meldungen nennen nur den NAMEN der Variable,
// nie ihren Wert (so landet nie ein Schlüssel im Log). Kein dotenv, keine Datei: nur process.env.
// Alle Variablen mit Zweck und Beispiel: docs/UMGEBUNG.md
//
// Gelesen werden: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, BASE_URL, PORT, HOST, DB_DATEI, DATEI_ORDNER, MAX_UPLOAD_MB, NODE_ENV, TRUST_PROXY.
// (ADMIN_PASSWORT liest nur das Skript tools/admin-anlegen.mjs, nicht der Server.)

import { randomBytes } from 'node:crypto';
import { sep, resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { STANDARD_PLATTFORM_NAME, pruefePlattformName } from './marke.mjs';
import { pruefeTextFeld, pruefeEmailFormat, pruefeTelefonFormat, istStripeTestKey, istWebhookSecret, pruefeMailFromFormat } from './feldregeln.mjs';

export class KonfigFehler extends Error {
  constructor(meldungen) {
    super(meldungen.join('\n'));
    this.meldungen = meldungen;
  }
}


// WP1 Sicherheitsblock: Liest den Startzustand der Instanz aus der Datenbank.
// Rueckgaben: 'UNINITIALISIERT' | 'ADMIN_ERSTELLT' | 'KONFIGURIERT' | 'AKTIV'.
// Nachbesserung 1 (Chef 2026-11-13): Admin ohne einstellungen.instanz_zustand => 'AKTIV' (Altbestand wie Gabriella-Instanz,
// Demo, jede bestehende Installation). ADMIN_ERSTELLT gibt es NUR, wenn WP3 das ausdruecklich in die Tabelle schreibt.
// So kippt eine Bestandsinstanz bei fehlenden Stripe-Variablen nie still in den Einrichtungsmodus (Exit 1 wie bisher).
// Nachbesserung 2 (Chef 2026-11-13): fail-closed. Datei existiert, aber das Lesen scheitert
// (kaputt, gesperrt, WAL nicht lesbar) => KonfigFehler werfen; Aufrufer bricht den Start ab. 'UNINITIALISIERT'
// nur, wenn die Datei fehlt oder (leer/ohne benutzer-Tabelle) sicher lesbar ist.
export function leseStartZustand(dbDatei) {
  const erlaubt = new Set(['UNINITIALISIERT', 'ADMIN_ERSTELLT', 'KONFIGURIERT', 'AKTIV']);
  if (!dbDatei || typeof dbDatei !== 'string' || !existsSync(dbDatei)) return 'UNINITIALISIERT';
  let d;
  try {
    d = new DatabaseSync(dbDatei, { readOnly: true });
    const tEinstellungen = d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='einstellungen'").get();
    if (tEinstellungen) {
      const zeile = d.prepare("SELECT wert FROM einstellungen WHERE schluessel='instanz_zustand'").get();
      if (zeile && typeof zeile.wert === 'string' && erlaubt.has(zeile.wert)) return zeile.wert;
    }
    const tBenutzer = d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='benutzer'").get();
    if (!tBenutzer) return 'UNINITIALISIERT';
    const hatRolle = d.prepare('PRAGMA table_info(benutzer)').all().some(s => s.name === 'rolle');
    if (!hatRolle) return 'UNINITIALISIERT';
    const admin = d.prepare("SELECT 1 FROM benutzer WHERE rolle='admin' LIMIT 1").get();
    return admin ? 'AKTIV' : 'UNINITIALISIERT';
  } catch (e) {
    // Fail-closed: Datei vorhanden, aber nicht lesbar. Keine Wert-Ausgabe, kein Pfadname in der Meldung.
    throw new KonfigFehler(['Datenbank vorhanden, Zustand nicht lesbar (WP1 Sicherheitsblock, fail-closed).']);
  }
  finally { if (d) { try { d.close(); } catch { /* ignore */ } } }
}

const NODE_ENV_ERLAUBT = ['production', 'development', 'test'];
export const STANDARD_DB_DATEI = 'daten/lern-app.db';
export const STANDARD_DATEI_ORDNER = 'daten/dateien';
export const STANDARD_EREIGNIS_AUFBEWAHRUNG_TAGE = 730;
const OEFFENTLICH = fileURLToPath(new URL('./public', import.meta.url));   // dieser Ordner wird öffentlich ausgeliefert: dort dürfen keine Kursdateien liegen

// env ist austauschbar, damit Tests beliebige Werte prüfen können, ohne process.env anzufassen.
// optionen.startZustand: aus leseStartZustand(). Fehlt sie oder ist sie nicht 'UNINITIALISIERT'/'ADMIN_ERSTELLT',
// verhaelt sich ladeKonfig wie bisher (Stripe-Variablen sind Pflicht). So bleiben alle alten konfig-Tests gruen.
// optionen.erzwingeEinrichtung: true erzwingt nur bei ADMIN_ERSTELLT den Reparaturmodus ohne Stripe-Pruefung.
// optionen.speicher: Einstellungsspeicher (WP2), der bei leeren env-Werten als zweite Quelle genutzt wird.
// Vorrang beim Lesen: env (nicht leer) > Speicher > Standard. Format-/Typpruefungen bleiben identisch.
export function ladeKonfig(env = process.env, optionen = {}) {
  const fehler = [];
  const warnungen = [];
  const speicher = optionen.speicher || null;
  const wert = (name) => {
    const e = env[name];
    if (e !== undefined && e !== null && String(e).trim() !== '') return String(e).trim();
    if (speicher) {
      const s = speicher.lese(name);
      if (s !== null && s !== undefined && String(s).trim() !== '') return String(s).trim();
    }
    return '';
  };

  // NODE_ENV: production schaltet die strengen Einstellungen ein
  let nodeEnv = wert('NODE_ENV') || 'development';
  if (!NODE_ENV_ERLAUBT.includes(nodeEnv)) {
    fehler.push(`NODE_ENV hat einen unbekannten Wert (erlaubt: ${NODE_ENV_ERLAUBT.join(', ')}).`);
    nodeEnv = 'development';
  }
  const produktion = nodeEnv === 'production';

  // PE_RESEND_URL: im Betrieb verboten, ausserhalb nur 127.0.0.1/localhost (PUNKT 4)
  const resendUrlRoh = String(env.PE_RESEND_URL || '').trim();
  let resendUrl = 'https://api.resend.com/emails';
  if (produktion) {
    if (resendUrlRoh) fehler.push('PE_RESEND_URL darf im Betrieb (NODE_ENV=production) nicht gesetzt sein (sicherheitsrelevant).');
  } else if (resendUrlRoh) {
    let resendHost = '';
    try { resendHost = new URL(resendUrlRoh).hostname; } catch {}
    if (resendHost === '127.0.0.1' || resendHost === 'localhost') {
      resendUrl = resendUrlRoh;
    } else {
      fehler.push('PE_RESEND_URL darf ausserhalb des Betriebs nur http://127.0.0.1 oder http://localhost sein.');
    }
  }

  // PE_STRIPE_URL: im Betrieb verboten, ausserhalb nur http://127.0.0.1/localhost (Test-Override fuer Stripe-API)
  const stripeUrlRoh = String(env.PE_STRIPE_URL || '').trim();
  let stripeOptionen = null;
  if (produktion) {
    if (stripeUrlRoh) fehler.push('PE_STRIPE_URL darf im Betrieb (NODE_ENV=production) nicht gesetzt sein (sicherheitsrelevant).');
  } else if (stripeUrlRoh) {
    let stripeHost = '', stripePort = 0;
    try { const u = new URL(stripeUrlRoh); stripeHost = u.hostname; stripePort = Number(u.port); } catch {}
    if ((stripeHost === '127.0.0.1' || stripeHost === 'localhost') && stripePort > 0 && stripePort < 65536) {
      stripeOptionen = { host: stripeHost, port: stripePort, protocol: 'http' };
    } else {
      fehler.push('PE_STRIPE_URL darf ausserhalb des Betriebs nur http://127.0.0.1:<port> oder http://localhost:<port> sein.');
    }
  }

  // Stripe: nur Testmodus, bis Edmund und Gabriella Live ausdrücklich freigeben
  const stripeSecretKey = wert('STRIPE_SECRET_KEY');
  const stripeWebhookSecret = wert('STRIPE_WEBHOOK_SECRET');

  // WP1 Sicherheitsblock (Chef-Entscheidung R1 = Variante D, 2026-11-13):
  // Setup-Modus startet NUR mit EINRICHTUNGSMODUS=1 (explizite Freischaltung durch Installer/Hosting-Vorlage).
  // Grund: eine fertige Instanz mit verlorener DB oder fehlenden Variablen darf nie von selbst einen Setup-Zugang oeffnen.
  // Einrichtungsmodus (ADMIN_ERSTELLT) laeuft OHNE den Schalter, sonst waere die Instanz eine Sackgasse.
  // Ohne den Schalter und ohne Admin bleibt das Verhalten bei fehlenden Stripe-Variablen EXAKT wie bisher (Abbruch).
  const beideStripeFehlen = !stripeSecretKey && !stripeWebhookSecret;
  const einrichtungsSchalter = wert('EINRICHTUNGSMODUS') === '1';
  const startZustand = typeof optionen.startZustand === 'string' ? optionen.startZustand : null;
  let modus = 'normal';
  if (startZustand === 'ADMIN_ERSTELLT' && (beideStripeFehlen || optionen.erzwingeEinrichtung === true)) {
    modus = 'einrichtung';
  } else if (beideStripeFehlen && startZustand === 'UNINITIALISIERT' && einrichtungsSchalter) {
    modus = 'setup';
  }

  if (modus === 'normal') {
    if (!stripeSecretKey) fehler.push('STRIPE_SECRET_KEY fehlt (Pflicht, Stripe-Testschlüssel sk_test_...).');
    else if (!istStripeTestKey(stripeSecretKey)) fehler.push('STRIPE_SECRET_KEY ist kein Stripe-Testschlüssel (muss mit sk_test_ beginnen). Live-Schlüssel sind nicht freigegeben.');
    if (!stripeWebhookSecret) fehler.push('STRIPE_WEBHOOK_SECRET fehlt (Pflicht, Webhook-Geheimnis whsec_...).');
    else if (!istWebhookSecret(stripeWebhookSecret)) fehler.push('STRIPE_WEBHOOK_SECRET ist ungültig (muss mit whsec_ beginnen).');
  }

  // PORT: Render setzt ihn selbst
  let port = 4400;
  if (wert('PORT')) {
    const p = wert('PORT');
    if (!/^\d{1,5}$/.test(p) || Number(p) < 1 || Number(p) > 65535) fehler.push('PORT muss eine ganze Zahl von 1 bis 65535 sein.');
    else port = Number(p);
  }

  // HOST: lokal nur dieser Rechner, im Betrieb (production) alle Adressen, sonst ist die App in der Cloud nicht erreichbar
  let host = produktion ? '0.0.0.0' : '127.0.0.1';
  if (wert('HOST')) {
    if (!/^[A-Za-z0-9._:-]{1,253}$/.test(wert('HOST'))) fehler.push('HOST ist ungültig (erlaubt sind eine IP-Adresse oder ein Rechnername).');
    else host = wert('HOST');
  }

  // BASE_URL: öffentliche Adresse (bestimmt den Herkunftsschutz und die Rückkehr-Adressen von Stripe)
  let baseUrl = `http://localhost:${port}`;
  if (wert('BASE_URL')) {
    const b = wert('BASE_URL');
    if (!/^https?:\/\//.test(b)) fehler.push('BASE_URL muss mit http:// oder https:// beginnen.');
    else if (b.endsWith('/')) fehler.push('BASE_URL darf nicht mit einem Schrägstrich enden.');
    else {
      // Rechnernamen sind nicht von Groß-/Kleinschreibung abhängig; Browser senden sie klein geschrieben (Herkunftsschutz!),
      // deshalb wird die Adresse klein geschrieben übernommen.
      const klein = b.toLowerCase();
      let gueltig = false;
      try { gueltig = new URL(b).origin === klein; } catch (e) { /* keine gültige Adresse */ }
      if (!gueltig) fehler.push('BASE_URL ist ungültig: erlaubt ist nur die Adresse selbst (Schema, Rechnername, evtl. Port), ohne Pfad und ohne Parameter.');
      else if (produktion && !klein.startsWith('https://')) fehler.push('Im Betrieb (NODE_ENV=production) muss BASE_URL mit https:// beginnen.');
      else baseUrl = klein;
    }
  } else if (produktion) {
    fehler.push('BASE_URL fehlt (im Betrieb Pflicht: öffentliche Adresse mit https://, ohne Schrägstrich am Ende).');
  }
  const secureCookies = baseUrl.startsWith('https://');

  // DB_DATEI: Pfad der SQLite-Datei (der Ordner wird angelegt)
  let dbDatei = STANDARD_DB_DATEI;
  if (wert('DB_DATEI')) {
    if (wert('DB_DATEI').length > 500 || wert('DB_DATEI').includes('\0')) fehler.push('DB_DATEI ist ungültig.');
    else dbDatei = wert('DB_DATEI');
  } else if (produktion) {
    warnungen.push('DB_DATEI ist nicht gesetzt: die Datenbank liegt im Standardordner der App. In der Cloud geht sie dort bei jedem Neustart verloren, wenn dort kein dauerhafter Speicher eingehängt ist.');
  }

  // DATEI_ORDNER: hier liegen die hochgeladenen Kursdateien (unter Zufallsnamen), nie öffentlich ausgeliefert
  let dateiOrdner = STANDARD_DATEI_ORDNER;
  if (wert('DATEI_ORDNER')) {
    const o = wert('DATEI_ORDNER');
    if (o.length > 500 || o.includes('\0')) fehler.push('DATEI_ORDNER ist ungültig.');
    else if (resolve(o) === OEFFENTLICH || resolve(o).startsWith(OEFFENTLICH + sep)) fehler.push('DATEI_ORDNER darf nicht im Ordner public liegen (der wird öffentlich ausgeliefert).');
    else dateiOrdner = o;
  } else if (produktion) {
    warnungen.push('DATEI_ORDNER ist nicht gesetzt: die hochgeladenen Dateien liegen im Standardordner der App. In der Cloud gehen sie dort bei jedem Neustart verloren, wenn dort kein dauerhafter Datenträger eingehängt ist.');
  }

  // MAX_UPLOAD_MB: harte Obergrenze für einen Upload (ganze Zahl von 1 bis 5000)
  let maxUploadMb = 500;
  if (wert('MAX_UPLOAD_MB')) {
    const m = wert('MAX_UPLOAD_MB');
    if (!/^\d{1,4}$/.test(m) || Number(m) < 1 || Number(m) > 5000) fehler.push('MAX_UPLOAD_MB muss eine ganze Zahl von 1 bis 5000 sein.');
    else maxUploadMb = Number(m);
  }

  // Wiedergabe: im Betrieb ein stabiler geheimer HMAC-Schlüssel, lokal pro Start zufällig.
  const wiedergabeGeheimnis = wert('WIEDERGABE_GEHEIMNIS');
  if (produktion && wiedergabeGeheimnis.length < 32) fehler.push('WIEDERGABE_GEHEIMNIS fehlt oder ist zu kurz (mindestens 32 Zeichen).');
  else if (wiedergabeGeheimnis && wiedergabeGeheimnis.length < 32) fehler.push('WIEDERGABE_GEHEIMNIS muss mindestens 32 Zeichen lang sein.');
  const wiedergabeSchluessel = wiedergabeGeheimnis || randomBytes(32).toString('hex');

  let maxSitzungen = 3;
  if (wert('MAX_SITZUNGEN')) {
    const n = wert('MAX_SITZUNGEN');
    if (!/^\d{1,2}$/.test(n) || Number(n) < 1 || Number(n) > 20) fehler.push('MAX_SITZUNGEN muss zwischen 1 und 20 liegen.');
    else maxSitzungen = Number(n);
  }

  // TRUST_PROXY: Anzahl der Vermittler (Proxys) vor der App. F-314 (18.11.2026, echter Testkauf): mit dem
  // bisherigen Wert 1 lieferte req.ip auf der echten Render-Instanz NICHT die Besucher-Adresse, sondern die
  // je Anfrage wechselnde Cloudflare-Kanten-Adresse -- dadurch griff die Bruteforce-Bremse (6 Fehlversuche je
  // IP+E-Mail) NIE, weil jede Anfrage unter einem anderen Schluessel lief. Mit echten Diagnose-Anfragen von
  // einer eigenen, per api.ipify.org bestaetigt stabilen IP auf der Live-Instanz NACHGEMESSEN (Render-Logs):
  // X-Forwarded-For hatte GENAU zwei Eintraege (eigene Adresse, dann die wechselnde Cloudflare-Adresse) --
  // Render selbst haengt also GENAU einen Proxy-Schritt an das, was Cloudflare schon liefert. Mit 2 statt 1
  // lieferte dieselbe echte Anfrage durchgehend die richtige, stabile Besucher-Adresse, und 6 echte
  // Fehlversuche von derselben Adresse sperrten korrekt beim 6. Versuch (429) -- vorher nie. Auch mit einer
  // SELBST GEFAELSCHTEN X-Forwarded-For-Kopfzeile (mehrere erfundene Adressen vorangestellt) blieb req.ip
  // bei beiden Werten die echte Adresse, da Express von der vertrauten (rechten) Seite her zaehlt: eine
  // laengere, selbst erfundene Kopfzeile aendert daran nichts. Render dokumentiert die genaue Anzahl der
  // eigenen Zwischenstationen nirgends oeffentlich; 2 ist daher kein geratener, sondern ein an der echten
  // Instanz gemessener Wert und bleibt wie bisher per TRUST_PROXY ueberschreibbar, falls sich Renders eigene
  // Infrastruktur aendert.
  let trustProxy = produktion ? 2 : 0;
  if (wert('TRUST_PROXY')) {
    const t = wert('TRUST_PROXY');
    if (!/^\d{1,2}$/.test(t) || Number(t) > 10) fehler.push('TRUST_PROXY muss eine ganze Zahl von 0 bis 10 sein.');
    else trustProxy = Number(t);
  }

  // Mail: nur verifizierte Absenderdomain, niemals den Schlüssel loggen.
  const resendApiKey = wert('RESEND_API_KEY');
  const mailFrom = wert('MAIL_FROM');
  if (resendApiKey) {
    if (pruefeMailFromFormat(resendApiKey, mailFrom) !== null)
      fehler.push('MAIL_FROM muss bei RESEND_API_KEY gesetzt sein und das Format "Name <adresse@domain>" haben.');
  } else if (mailFrom) warnungen.push('MAIL_FROM ist gesetzt, aber RESEND_API_KEY fehlt: Mailversand deaktiviert.');

  // Geschaeftsbenachrichtigungen: niemals Adressen in Fehlermeldungen nennen.
  const verkaufsmeldungMail = wert('VERKAUFSMELDUNG_MAIL');
  if(verkaufsmeldungMail && (verkaufsmeldungMail.length>254 ||
     !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(verkaufsmeldungMail)))
    fehler.push('VERKAUFSMELDUNG_MAIL muss eine gueltige einzelne E-Mail-Adresse sein.');
  const registrierungMeldung = wert('REGISTRIERUNG_MELDUNG') || 'ein';
  if(!['ein','aus'].includes(registrierungMeldung))
    fehler.push('REGISTRIERUNG_MELDUNG muss ein oder aus sein.');
  const aufbewahrungRoh = wert('EREIGNIS_AUFBEWAHRUNG_TAGE') || String(STANDARD_EREIGNIS_AUFBEWAHRUNG_TAGE);
  if(!/^\d{2,4}$/.test(aufbewahrungRoh) || Number(aufbewahrungRoh)<30 ||
      Number(aufbewahrungRoh)>3650)
    fehler.push('EREIGNIS_AUFBEWAHRUNG_TAGE muss eine ganze Zahl von 30 bis 3650 sein.');
  const ereignisAufbewahrungTage = Number(aufbewahrungRoh);
  const supportMail = wert('SUPPORT_MAIL');
  if (supportMail && (supportMail.length > 254 ||
      !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(supportMail)))
    fehler.push('SUPPORT_MAIL muss eine gueltige einzelne E-Mail-Adresse sein.');
  // Scheibe 22: freiwillige öffentliche Anbieterangaben, keine Werte in Fehlermeldungen.
  const anbieter={};
  const anbieterQuelle = ['ANBIETER_NAME','ANBIETER_ANSCHRIFT','ANBIETER_EMAIL'].some(k => String(env[k] ?? '').trim()) ? 'umgebung' : 'einstellungen';
  const felder={ANBIETER_NAME:160,ANBIETER_ANSCHRIFT:240,ANBIETER_TELEFON:50,ANBIETER_EMAIL:254,ANBIETER_ADOSZAM:60,STEUER_HINWEIS:200};
  for(const [name,max] of Object.entries(felder)){
    const input=wert(name);
    if(input&&(input.length>max||/[\u0000-\u001f\u007f]/.test(input)))
      fehler.push(name+' ist ungültig (Länge oder Zeilenumbruch).');
    if(name==='ANBIETER_EMAIL'&&pruefeEmailFormat(input)!==null)
      fehler.push(name+' muss eine einzelne gültige E-Mail-Adresse sein.');
    if(name==='ANBIETER_TELEFON'&&pruefeTelefonFormat(input)!==null)
      fehler.push(name+' enthält ungültige Zeichen.');
    anbieter[name]=input;
  }
  // Pruefrunde 01.11.2026 (E4/E5): fehlende Pflichtangaben im Betrieb nicht stillschweigend hinnehmen (nur Namen, nie Werte).
  if(produktion){
    if(!verkaufsmeldungMail)warnungen.push('VERKAUFSMELDUNG_MAIL fehlt: Elallas- und Warnhinweise an die Inhaberin gehen verloren.');
    const fehltAnbieter=['ANBIETER_NAME','ANBIETER_ANSCHRIFT','ANBIETER_EMAIL'].filter(n=>!anbieter[n]);
    if(fehltAnbieter.length)warnungen.push(fehltAnbieter.join(', ')+' fehlt: Kaufmails gehen ohne Pflichtangaben des Anbieters hinaus; Widerrufsbelehrung und Widerrufsformular zeigen dort "Vom Betreiber noch nicht hinterlegt".');
  }
  // Produktreife (12.11.2026): Rechtsseiten des Betreibers. Nur im Demo-Modus zeigt die Plattform ihre eigenen Muster-Rechtsseiten.
  // Im Normalbetrieb leitet /jogi/<seite>/ auf die hier hinterlegte Adresse weiter; fehlt sie, erscheint "vom Betreiber noch nicht hinterlegt".
  const rechtsseiten={};
  for(const [name,seite] of [['IMPRESSUM_URL','impresszum'],['DATENSCHUTZ_URL','adatvedelem'],['TEILNAHMEBEDINGUNGEN_URL','reszveteli-feltetelek']]){
    const u=wert(name);
    if(!u)continue;
    let gueltig=false;
    if(u==='/jogi/'+seite){gueltig=true;}else{try{const x=new URL(u);gueltig=(x.protocol==='https:'||(!produktion&&x.protocol==='http:'))&&!x.username&&!x.password&&u.length<=500&&!/[\u0000-\u001f\u007f\s]/.test(u);}catch{/* ungueltig */}}
    if(!gueltig)fehler.push(name+' ist ungültig (vollständige Adresse mit https://, höchstens 500 Zeichen).');
    else rechtsseiten[seite]=u;
  }

  // Produktreife Block 2 (12.11.2026): PLATTFORM_NAME = Name der Plattform/Marke in Texten, Mails, Logo und Seiten (oeffentlich, kein Geheimnis).
  // Optional, Standard "Musterakademie" (Demo bleibt exakt wie bisher). 1 bis 60 Zeichen, kein HTML, keine Anfuehrungszeichen, keine Klammern { }.
  let plattformName=STANDARD_PLATTFORM_NAME;
  if(wert('PLATTFORM_NAME')){
    const meldung=pruefePlattformName(wert('PLATTFORM_NAME'));
    if(meldung)fehler.push(meldung);
    else plattformName=wert('PLATTFORM_NAME');
  }

  // Scheibe 25: Backups bleiben ohne gültigen 32-Byte-Schlüssel vollständig deaktiviert.
  let sicherungOrdner=join(dirname(dbDatei),'sicherung');
  if(wert('SICHERUNG_ORDNER')){
    const v=wert('SICHERUNG_ORDNER');
    if(v.length>500||/[\u0000-\u001f\u007f]/.test(v)||resolve(v)===OEFFENTLICH||resolve(v).startsWith(OEFFENTLICH+sep)||
       resolve(v)===resolve(dbDatei)||resolve(v)===resolve(dateiOrdner)||resolve(v).startsWith(resolve(dateiOrdner)+sep))
      fehler.push('SICHERUNG_ORDNER ist ungültig.');
    else sicherungOrdner=v;
  }
  if(resolve(sicherungOrdner)===OEFFENTLICH||resolve(sicherungOrdner).startsWith(OEFFENTLICH+sep)||
     resolve(sicherungOrdner)===resolve(dateiOrdner)||resolve(sicherungOrdner).startsWith(resolve(dateiOrdner)+sep))
    fehler.push('SICHERUNG_ORDNER darf nicht öffentlich oder im Medienordner liegen.');
  const sicherungRaw=wert('SICHERUNG_SCHLUESSEL');
  let sicherungSchluessel=null;
  if(sicherungRaw){
    const decoded=Buffer.from(sicherungRaw,'base64');
    if(!/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(sicherungRaw)||
       decoded.length!==32||decoded.toString('base64')!==sicherungRaw)
      fehler.push('SICHERUNG_SCHLUESSEL muss Base64 von genau 32 Bytes sein.');
    else sicherungSchluessel=decoded;
  }
  const mailAdresse=/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  const alarmMails=wert('ALARM_MAILS')?wert('ALARM_MAILS').split(',').map(v=>v.trim()):[];
  if(alarmMails.length>5||alarmMails.some(v=>v.length>254||!mailAdresse.test(v))||new Set(alarmMails).size!==alarmMails.length)
    fehler.push('ALARM_MAILS muss höchstens 5 gültige einzelne E-Mail-Adressen enthalten.');
  const zone=wert('SICHERUNG_BUNNY_ZONE'),bunnySecret=wert('SICHERUNG_BUNNY_SCHLUESSEL');
  const bunnyHost=wert('SICHERUNG_BUNNY_HOST')||'storage.bunnycdn.com';
  const bunnyPfad=wert('SICHERUNG_BUNNY_PFAD')||'vsic/';
  if(zone&&!/^[A-Za-z0-9-]{1,100}$/.test(zone))fehler.push('SICHERUNG_BUNNY_ZONE ist ungültig.');
  if(bunnySecret&&(!/^[^\s\u0000-\u001f\u007f]{1,256}$/.test(bunnySecret)))fehler.push('SICHERUNG_BUNNY_SCHLUESSEL ist ungültig.');
  if(!/^[A-Za-z0-9.-]{1,253}$/.test(bunnyHost)||bunnyHost.includes('..'))fehler.push('SICHERUNG_BUNNY_HOST ist ungültig.');
  if(!/^(?:[A-Za-z0-9_-]+\/)*$/.test(bunnyPfad)||bunnyPfad.length>200)fehler.push('SICHERUNG_BUNNY_PFAD ist ungültig.');
  if(!!zone!==!!bunnySecret)fehler.push('SICHERUNG_BUNNY_ZONE und SICHERUNG_BUNNY_SCHLUESSEL müssen gemeinsam gesetzt sein.');
  const sicherungBunny=zone&&bunnySecret?{zone,schluessel:bunnySecret,host:bunnyHost,pfad:bunnyPfad}:null;

  // Bunny Stream (Videos), docs/BUNNY-STREAM-PLAN.md: alle drei Werte zusammen oder keiner. Ohne sie ist Bunny AUS und die Plattform verhaelt sich wie bisher.
  // Die Meldungen nennen nur Namen, nie Werte.
  const streamBibliothek=wert('BUNNY_STREAM_BIBLIOTHEK_ID'),streamApiKey=wert('BUNNY_STREAM_API_KEY'),streamTokenKey=wert('BUNNY_STREAM_TOKEN_KEY');
  const streamGesetzt=[streamBibliothek,streamApiKey,streamTokenKey].filter(Boolean).length;
  if(streamGesetzt&&streamGesetzt!==3)fehler.push('BUNNY_STREAM_BIBLIOTHEK_ID, BUNNY_STREAM_API_KEY und BUNNY_STREAM_TOKEN_KEY müssen gemeinsam gesetzt sein.');
  if(streamBibliothek&&!/^[1-9]\d{0,11}$/.test(streamBibliothek))fehler.push('BUNNY_STREAM_BIBLIOTHEK_ID ist ungültig.');
  if(streamApiKey&&!/^[^\s\u0000-\u001f\u007f]{8,256}$/.test(streamApiKey))fehler.push('BUNNY_STREAM_API_KEY ist ungültig.');
  if(streamTokenKey&&!/^[^\s\u0000-\u001f\u007f]{8,256}$/.test(streamTokenKey))fehler.push('BUNNY_STREAM_TOKEN_KEY ist ungültig.');
  const bunnyStream=streamGesetzt===3?Object.freeze({bibliothek:streamBibliothek,apiKey:streamApiKey,tokenKey:streamTokenKey}):null;
  // BUNNY_STREAM_MAX_MB (Schritt 8, VIDEO-10): Obergrenze fuer EIN Video, das der Admin zu Bunny hochlaedt (Kostenbremse; Bunny selbst begrenzt nichts).
  // Standard 4000 MB (4 GB), erlaubt 1 bis 50000. Der Browser lehnt groessere Dateien vor dem Anlegen ab; der Server prueft die vom Browser gemeldete
  // Groesse (bunny-upload). Es ist eine Kostenbremse fuer den Admin, keine harte Durchsetzung (die Datei geht direkt zu Bunny, nicht ueber den Server).
  let bunnyStreamMaxMb=4000;
  if(wert('BUNNY_STREAM_MAX_MB')){
    const m=wert('BUNNY_STREAM_MAX_MB');
    if(!/^\d{1,5}$/.test(m)||Number(m)<1||Number(m)>50000)fehler.push('BUNNY_STREAM_MAX_MB muss eine ganze Zahl von 1 bis 50000 sein.');
    else bunnyStreamMaxMb=Number(m);
  }
  const bunnyStreamMaxBytes=bunnyStreamMaxMb*1024*1024;

  // PLATTFORM_WEBHOOK_URL + PLATTFORM_WEBHOOK_KEY (Dashboard-Anbindung): beide gemeinsam oder keine. Die Adresse muss ein Apps-Script-Webhook sein
  // (https://script.google.com/macros/s/<ID>/exec), der Schluessel 24 bis 128 Zeichen aus A-Z a-z 0-9 _ -. Ohne beide ist die Meldung aus.
  const plattformUrl=wert('PLATTFORM_WEBHOOK_URL'),plattformKey=wert('PLATTFORM_WEBHOOK_KEY');
  if(!!plattformUrl!==!!plattformKey)fehler.push('PLATTFORM_WEBHOOK_URL und PLATTFORM_WEBHOOK_KEY müssen gemeinsam gesetzt sein oder gemeinsam fehlen.');
  else if(plattformUrl){
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(plattformUrl))fehler.push('PLATTFORM_WEBHOOK_URL ist ungültig (erwartet: https://script.google.com/macros/s/.../exec).');
    if(!/^[A-Za-z0-9_-]{24,128}$/.test(plattformKey))fehler.push('PLATTFORM_WEBHOOK_KEY ist ungültig (24 bis 128 Zeichen: Buchstaben, Ziffern, _ und -).');
  }
  // Der Modus folgt allein dem Stripe-Schluessel (Test, solange sk_test_), nie einer eigenen Einstellung: so kann Test nicht als Live im Sheet landen.
  const plattformWebhook=plattformUrl&&plattformKey&&fehler.length===0?Object.freeze({url:plattformUrl,schluessel:plattformKey,modus:stripeSecretKey&&stripeSecretKey.startsWith('sk_live_')?'Live':'Test'}):null;

  const adminErlaubtRoh=wert('ADMIN_ERLAUBT');
  const adminErlaubt=adminErlaubtRoh?adminErlaubtRoh.split(',').map(x=>x.trim().toLowerCase()):[];
  if(adminErlaubt.length>3||adminErlaubt.some(x=>x.length>254||!mailAdresse.test(x))||new Set(adminErlaubt).size!==adminErlaubt.length)
    fehler.push('ADMIN_ERLAUBT muss höchstens drei eindeutige gültige E-Mail-Adressen enthalten.');
  if(produktion&&!adminErlaubt.length)warnungen.push('ADMIN_ERLAUBT fehlt: Admin-Zugang nicht auf Erlaubnisliste beschränkt.');
  const notfallEntsperren=wert('NOTFALL_ENTSPERREN');
  if(notfallEntsperren&&!['0','1'].includes(notfallEntsperren))
    fehler.push('NOTFALL_ENTSPERREN muss 0 oder 1 sein.');

  const verkaufPausiertRoh=wert('VERKAUF_PAUSIERT');
  if(verkaufPausiertRoh&&!['0','1'].includes(verkaufPausiertRoh))fehler.push('VERKAUF_PAUSIERT muss 0 oder 1 sein.');
  const verkaufPausiert=verkaufPausiertRoh==='1';
  // B9: DEMO_MODUS=1 schaltet die Demo-Instanz ein (Beispielkurse, Demo-Zugang, Demo-Admin nur Ansicht). Nur zusammen mit einem Stripe-TESTschluessel.
  const demoRoh=wert('DEMO_MODUS');
  if(demoRoh&&!['0','1'].includes(demoRoh))fehler.push('DEMO_MODUS muss 0 oder 1 sein.');
  const demoModus=demoRoh==='1';
  if(demoModus&&!String(stripeSecretKey||'').startsWith('sk_test_'))fehler.push('DEMO_MODUS=1 ist nur mit einem Stripe-Testschluessel (sk_test_) erlaubt.');
  // Demo-Feineinstellungen (nur wirksam mit DEMO_MODUS=1): Tagesgrenze neuer Demo-Kaeufer (1 bis 5000, sonst 150), optionale Test-Videolektion aus der Demo-Bibliothek.
  const maxKaeuferRoh=Number(wert('DEMO_MAX_KAEUFER_TAG'));
  const demoMaxKaeuferTag=Number.isInteger(maxKaeuferRoh)&&maxKaeuferRoh>=1&&maxKaeuferRoh<=5000?maxKaeuferRoh:150;
  const bunnyVideoRoh=String(wert('DEMO_BUNNY_VIDEO_ID')||'');
  const demoBunnyVideoId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bunnyVideoRoh)&&streamBibliothek&&streamApiKey&&streamTokenKey?bunnyVideoRoh:'';
  if (fehler.length) throw new KonfigFehler(fehler);
  // WP1 Sicherheitsblock: Setup-/Einrichtungsmodus liefert nur die netzrelevanten Werte zurueck
  // (kein Stripe, kein Mail, kein Bunny). server.mjs verzweigt daraufhin auf einen minimalen Server.
  if (modus !== 'normal') {
    return Object.freeze({ modus, nodeEnv, produktion, port, host, baseUrl, secureCookies, dbDatei, trustProxy, warnungen, resendUrl, stripeOptionen });
  }
  // Produktreife: im Betrieb ohne Demo laut warnen, wenn Pflicht-Rechtsseiten fehlen (kein Absturz; die Seite zeigt dann "vom Betreiber noch nicht hinterlegt").
  if(produktion&&!demoModus){
    const fehltRecht=[['IMPRESSUM_URL','impresszum'],['DATENSCHUTZ_URL','adatvedelem'],['TEILNAHMEBEDINGUNGEN_URL','reszveteli-feltetelek']].filter(([,s])=>!rechtsseiten[s]).map(([n])=>n);
    if(fehltRecht.length)warnungen.push('WARNUNG RECHTSTEXTE: '+fehltRecht.join(', ')+' fehlt: Kunden sehen dort nur "Vom Betreiber noch nicht hinterlegt". Vor dem Verkauf die Rechtsseiten des Betreibers hinterlegen (docs/UMGEBUNG.md).');
  }
  return Object.freeze({ modus:'normal', plattformName, demoModus, rechtsseiten:Object.freeze(rechtsseiten),demoMaxKaeuferTag, demoBunnyVideoId, stripeSecretKey, stripeWebhookSecret, nodeEnv, produktion, port, host, baseUrl, secureCookies, dbDatei, dateiOrdner, maxUploadMb, maxUploadBytes: maxUploadMb * 1024 * 1024, trustProxy, wiedergabeSchluessel, maxSitzungen, resendApiKey, mailFrom, verkaufsmeldungMail, registrierungMeldung:registrierungMeldung==='ein', ereignisAufbewahrungTage, supportMail, anbieterQuelle, anbieter:Object.freeze(anbieter), sicherungOrdner,sicherungSchluessel,alarmMails,sicherungBunny,bunnyStream,bunnyStreamMaxBytes, plattformWebhook, adminErlaubt:Object.freeze(adminErlaubt),notfallEntsperren:notfallEntsperren==='1',verkaufPausiert, warnungen, resendUrl, stripeOptionen });
}
