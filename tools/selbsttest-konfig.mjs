// Automatischer Selbsttest für die Umgebungsvariablen (konfig.mjs, server.mjs, docs/UMGEBUNG.md). Offline, ohne echte Schlüssel
// (es werden nur Platzhalter-Werte benutzt, die Stripe nie sieht). Ports 4407, 4408 und 4411.
// Scheibe 5: auch DATEI_ORDNER und MAX_UPLOAD_MB.
// Aufruf: tools\Selbsttest-Konfig.ps1
import './test-sprache.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let ok = 0, schlecht = 0;
const pruefe = (name, bedingung, detail = '') => { bedingung ? ok++ : schlecht++; console.log(`${bedingung ? 'OK     ' : 'FEHLER '} ${name}${!bedingung && detail ? '  -> ' + detail : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = (pfad) => { try { rmSync(pfad, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } }; // Windows: Datei kann noch gesperrt sein

const { ladeKonfig, KonfigFehler } = await import(pathToFileURL(resolve('konfig.mjs')).href);
const MARKE = 'GEHEIMMARKE9876';                                   // steckt in jedem falschen Wert; darf nirgends in einer Meldung auftauchen
const gut = { STRIPE_SECRET_KEY: 'sk_test_platzhalter_nur_fuer_tests', STRIPE_WEBHOOK_SECRET: 'whsec_platzhalter_nur_fuer_tests' };
const pruefeKonfig = (env) => { try { return { konfig: ladeKonfig(env.NODE_ENV === 'production' && env.WIEDERGABE_GEHEIMNIS === undefined ? { ...env, WIEDERGABE_GEHEIMNIS: 'T'.repeat(40) } : env) }; } catch (e) { if (!(e instanceof KonfigFehler)) throw e; return { meldungen: e.meldungen }; } };

// =====================================================================================================
abschnitt('Standardwerte (lokal)');
{
  const { konfig: k } = pruefeKonfig({ ...gut });
  pruefe('Nur die zwei Stripe-Werte reichen lokal', !!k);
  pruefe('Standard: Port 4400, Host 127.0.0.1, BASE_URL http://localhost:4400, kein Secure, kein Proxy, Datenbank daten/lern-app.db, Dateien daten/dateien, Upload 500 MB',
    k.port === 4400 && k.host === '127.0.0.1' && k.baseUrl === 'http://localhost:4400' && k.secureCookies === false && k.trustProxy === 0 && k.dbDatei === 'daten/lern-app.db' && k.dateiOrdner === 'daten/dateien' && k.maxUploadMb === 500 && k.maxUploadBytes === 500 * 1024 * 1024 && k.nodeEnv === 'development' && k.produktion === false && k.warnungen.length === 0, JSON.stringify(k));
  pruefe('Das Ergebnis ist eingefroren (nicht nachträglich veränderbar)', Object.isFrozen(k));
}

abschnitt('Werte werden respektiert');
{
  const a = pruefeKonfig({ ...gut, PORT: '10000' }).konfig;
  pruefe('PORT=10000: Port 10000 und BASE_URL-Standard folgt dem Port', a.port === 10000 && a.baseUrl === 'http://localhost:10000');
  pruefe('HOST=0.0.0.0 wird übernommen (auch ohne production)', pruefeKonfig({ ...gut, HOST: '0.0.0.0' }).konfig.host === '0.0.0.0');
  pruefe('HOST=::1 (IPv6) wird übernommen', pruefeKonfig({ ...gut, HOST: '::1' }).konfig.host === '::1');
  pruefe('DB_DATEI wird übernommen, Leerzeichen am Rand entfernt', pruefeKonfig({ ...gut, DB_DATEI: '  /var/data/schulung.db ' }).konfig.dbDatei === '/var/data/schulung.db');
  pruefe('DATEI_ORDNER wird übernommen', pruefeKonfig({ ...gut, DATEI_ORDNER: ' /var/data/dateien ' }).konfig.dateiOrdner === '/var/data/dateien');
  pruefe('MAX_UPLOAD_MB wird übernommen und in Bytes umgerechnet (2000 MB, Grenzen 1 und 5000)', pruefeKonfig({ ...gut, MAX_UPLOAD_MB: '2000' }).konfig.maxUploadBytes === 2000 * 1024 * 1024 && pruefeKonfig({ ...gut, MAX_UPLOAD_MB: '1' }).konfig.maxUploadMb === 1 && pruefeKonfig({ ...gut, MAX_UPLOAD_MB: '5000' }).konfig.maxUploadMb === 5000);
  pruefe('MAX_UPLOAD_MB nur Leerzeichen: Standard 500', pruefeKonfig({ ...gut, MAX_UPLOAD_MB: '  ' }).konfig.maxUploadMb === 500);
  pruefe('DATEI_ORDNER außerhalb von public (z. B. daten/dateien oder ein Ordner daneben) ist erlaubt', !!pruefeKonfig({ ...gut, DATEI_ORDNER: 'daten/dateien' }).konfig && !!pruefeKonfig({ ...gut, DATEI_ORDNER: 'public2/x' }).konfig && !!pruefeKonfig({ ...gut, DATEI_ORDNER: join(resolve('.'), 'publicx') }).konfig);
  pruefe('TRUST_PROXY=2 wird übernommen', pruefeKonfig({ ...gut, TRUST_PROXY: '2' }).konfig.trustProxy === 2);
  pruefe('BASE_URL mit Port ist erlaubt (http://localhost:4400)', pruefeKonfig({ ...gut, BASE_URL: 'http://localhost:4400' }).konfig.baseUrl === 'http://localhost:4400');
  pruefe('Schlüssel mit Leerzeichen am Rand (Kopierfehler) werden bereinigt', pruefeKonfig({ STRIPE_SECRET_KEY: ' sk_test_platzhalter_nur_fuer_tests\n', STRIPE_WEBHOOK_SECRET: gut.STRIPE_WEBHOOK_SECRET }).konfig?.stripeSecretKey === gut.STRIPE_SECRET_KEY);
}

abschnitt('Resend-Konfiguration (Scheibe 11)');
{
  const nurStripe = pruefeKonfig({ ...gut }).konfig;
  pruefe('Ohne Resend-Schlüssel startet die App weiter', !nurStripe.resendApiKey && !nurStripe.mailFrom);
  const mit = pruefeKonfig({ ...gut, RESEND_API_KEY:'nur-eine-Testkennung', MAIL_FROM:'Musterakademie <onboarding@resend.dev>' }).konfig;
  pruefe('Resend mit zugelassenem Test-Absender (resend.dev)', !!mit && !!mit.resendApiKey && mit.mailFrom.includes('resend.dev'));
  const ohneFrom = pruefeKonfig({ ...gut, RESEND_API_KEY:'NICHT_IM_LOG_TEST' });
  pruefe('RESEND_API_KEY ohne MAIL_FROM wird abgelehnt, ohne Schlüssel im Fehler', !!ohneFrom.meldungen && !ohneFrom.meldungen.join(' ').includes('NICHT_IM_LOG_TEST'));
  const eigeneDomain = pruefeKonfig({ ...gut, RESEND_API_KEY:'NICHT_IM_LOG_TEST', MAIL_FROM:'Musterakademie <anmeldung@example.com>' }).konfig;
  pruefe('Eigene Domain (nicht resend.dev) wird akzeptiert', !!eigeneDomain && eigeneDomain.mailFrom.includes('example.com'));
  const ohneKlammern = pruefeKonfig({ ...gut, RESEND_API_KEY:'NICHT_IM_LOG_TEST', MAIL_FROM:'service@example.com' });
  pruefe('MAIL_FROM ohne spitze Klammern wird abgelehnt', !!ohneKlammern.meldungen && ohneKlammern.meldungen.join(' ').includes('MAIL_FROM'));
}
abschnitt('Geschäftsmeldungen und Datenschutz – Scheibe 15');
{
 const standard=pruefeKonfig({...gut}).konfig;
 pruefe('Standard: kein Meldeempfänger, Registrierung ein, 730 Tage',
   standard.verkaufsmeldungMail===''&&standard.registrierungMeldung===true&&standard.ereignisAufbewahrungTage===730);
 const gueltig=pruefeKonfig({...gut,VERKAUFSMELDUNG_MAIL:'gabi@example.com',
   REGISTRIERUNG_MELDUNG:'aus',EREIGNIS_AUFBEWAHRUNG_TAGE:'30'}).konfig;
 pruefe('Empfänger, Registrierung aus und Mindestaufbewahrung 30 Tage akzeptiert',
   gueltig?.verkaufsmeldungMail==='gabi@example.com'&&gueltig.registrierungMeldung===false&&gueltig.ereignisAufbewahrungTage===30);
 pruefe('Maximalaufbewahrung 3650 Tage akzeptiert',
   pruefeKonfig({...gut,EREIGNIS_AUFBEWAHRUNG_TAGE:'3650'}).konfig?.ereignisAufbewahrungTage===3650);
 for (const ungueltig of ['29','3651','0','-3','730.5','abc']) {
   const ergebnis=pruefeKonfig({...gut,EREIGNIS_AUFBEWAHRUNG_TAGE:ungueltig});
   pruefe('Aufbewahrungswert abgelehnt ('+ungueltig+')',
     ergebnis.meldungen?.some(x=>x.includes('EREIGNIS_AUFBEWAHRUNG_TAGE')));
 }
 const falschMail=pruefeKonfig({...gut,VERKAUFSMELDUNG_MAIL:'VERTRAULICH_ungueltig'});
 pruefe('Ungültige Meldeadresse abgelehnt, ohne ihren Wert zu verraten',
   falschMail.meldungen?.join(' ').includes('VERKAUFSMELDUNG_MAIL') &&
   !falschMail.meldungen?.join(' ').includes('VERTRAULICH_ungueltig'));
 const falschToggle=pruefeKonfig({...gut,REGISTRIERUNG_MELDUNG:'vielleicht'});
 pruefe('Nur ein oder aus zulässig',falschToggle.meldungen?.join(' ').includes('REGISTRIERUNG_MELDUNG'));
}
abschnitt('Scheibe 16: SUPPORT_MAIL');
{
 const basis={...gut};
 pruefe('SUPPORT_MAIL optional, ohne Wert leer',pruefeKonfig(basis).konfig?.supportMail==='');
 pruefe('Gueltige Supportadresse wird uebernommen',
   pruefeKonfig({...basis,SUPPORT_MAIL:'hilfe@example.com'}).konfig?.supportMail==='hilfe@example.com');
 for(const falsch of ['kein-mail','zwei@example.com,noch@example.com','Test <test@example.com>','xyz@']) {
   const r=pruefeKonfig({...basis,SUPPORT_MAIL:falsch});
   pruefe('Ungueltige SUPPORT_MAIL: abgelehnt, ohne ihren Wert im Fehler',
     r.meldungen?.some(x=>x.includes('SUPPORT_MAIL')) && !r.meldungen.join(' ').includes(falsch));
 }
}
abschnitt('Betrieb (NODE_ENV=production)');
{
  const prod = { ...gut, NODE_ENV: 'production', BASE_URL: 'https://kurse.beispiel.hu', DB_DATEI: '/var/data/schulung.db', DATEI_ORDNER: '/var/data/dateien', PORT: '10000', ADMIN_ERLAUBT: 'admin-eins@beispiel.hu', VERKAUFSMELDUNG_MAIL: 'inhaberin@beispiel.hu', ANBIETER_NAME: 'Beispiel Kft.', ANBIETER_ANSCHRIFT: '1000 Budapest, Beispiel utca 1.', ANBIETER_EMAIL: 'info@beispiel.hu', IMPRESSUM_URL: 'https://beispiel.hu/impressum', DATENSCHUTZ_URL: 'https://beispiel.hu/datenschutz', TEILNAHMEBEDINGUNGEN_URL: 'https://beispiel.hu/agb' };
  const k = pruefeKonfig(prod).konfig;
  // F-314 (18.11.2026): Standard 2 statt 1 -- auf der echten Render-Instanz empirisch gemessen zwei echte Zwischenstationen (Cloudflare + Render selbst), siehe konfig.mjs.
  pruefe('production: Host 0.0.0.0 (in der Cloud von außen erreichbar), Proxy 2, Secure-Cookies, https-Adresse', k.host === '0.0.0.0' && k.trustProxy === 2 && k.secureCookies === true && k.baseUrl === 'https://kurse.beispiel.hu' && k.produktion === true);
  pruefe('production ohne DB_DATEI: nur eine Warnung (kein Abbruch), ohne den Wert', pruefeKonfig({ ...prod, DB_DATEI: undefined }).konfig?.warnungen.length === 1);
  pruefe('production ohne DATEI_ORDNER: eine Warnung zum dauerhaften Datenträger, ohne beide: zwei Warnungen', pruefeKonfig({ ...prod, DATEI_ORDNER: undefined }).konfig?.warnungen.length === 1 && /Datenträger/.test(pruefeKonfig({ ...prod, DATEI_ORDNER: undefined }).konfig.warnungen[0]) && pruefeKonfig({ ...prod, DATEI_ORDNER: undefined, DB_DATEI: undefined }).konfig?.warnungen.length === 2);
  pruefe('production mit allen Werten: keine Warnung', pruefeKonfig(prod).konfig.warnungen.length === 0);
  pruefe('production ohne ADMIN_ERLAUBT: genau eine Warnung, ohne Abbruch (Testphase)', pruefeKonfig({ ...prod, ADMIN_ERLAUBT: undefined }).konfig?.warnungen.length === 1 && /ADMIN_ERLAUBT/.test(pruefeKonfig({ ...prod, ADMIN_ERLAUBT: undefined }).konfig.warnungen[0]));
  // Pruefrunde 01.11.2026 (E4/E5): fehlende Pflichtangaben im Betrieb melden, nie den Wert nennen
  pruefe('production ohne VERKAUFSMELDUNG_MAIL: genau eine Warnung (Hinweise an die Inhaberin gingen sonst verloren), kein Abbruch', pruefeKonfig({ ...prod, VERKAUFSMELDUNG_MAIL: undefined }).konfig?.warnungen.length === 1 && /VERKAUFSMELDUNG_MAIL/.test(pruefeKonfig({ ...prod, VERKAUFSMELDUNG_MAIL: undefined }).konfig.warnungen[0]));
  pruefe('production ohne ANBIETER_NAME und ANBIETER_EMAIL: eine Warnung mit beiden Namen, ohne Werte, kein Abbruch', (() => { const w = pruefeKonfig({ ...prod, ANBIETER_NAME: undefined, ANBIETER_EMAIL: undefined }).konfig?.warnungen; return w?.length === 1 && /ANBIETER_NAME, ANBIETER_EMAIL/.test(w[0]) && !/beispiel/.test(w[0]); })());
  // Produktreife (12.11.2026): Rechtsseiten des Betreibers
  pruefe('production ohne IMPRESSUM_URL/DATENSCHUTZ_URL/TEILNAHMEBEDINGUNGEN_URL: genau eine laute Warnung mit allen drei Namen, kein Abbruch', (() => { const w = pruefeKonfig({ ...prod, IMPRESSUM_URL: undefined, DATENSCHUTZ_URL: undefined, TEILNAHMEBEDINGUNGEN_URL: undefined }).konfig?.warnungen; return w?.length === 1 && /^WARNUNG RECHTSTEXTE: IMPRESSUM_URL, DATENSCHUTZ_URL, TEILNAHMEBEDINGUNGEN_URL fehlt/.test(w[0]); })());
  pruefe('production mit DEMO_MODUS=1 ohne Rechtsseiten-Adressen: keine Rechtstexte-Warnung (Demo hat eigene Muster-Seiten)', (pruefeKonfig({ ...prod, DEMO_MODUS: '1', IMPRESSUM_URL: undefined, DATENSCHUTZ_URL: undefined, TEILNAHMEBEDINGUNGEN_URL: undefined }).konfig?.warnungen || ['x']).every((w) => !/RECHTSTEXTE/.test(w)));
  pruefe('Rechtsseiten-Adressen werden uebernommen (konfig.rechtsseiten)', k.rechtsseiten.impresszum === 'https://beispiel.hu/impressum' && k.rechtsseiten.adatvedelem === 'https://beispiel.hu/datenschutz' && k.rechtsseiten['reszveteli-feltetelek'] === 'https://beispiel.hu/agb');
  pruefe('IMPRESSUM_URL ohne https im Betrieb, mit Zugangsdaten oder kaputt: Abbruch, ohne den Wert', ['http://beispiel.hu/x', 'https://nutzer:geheim@beispiel.hu/', 'kein-link'].every((u) => { const m = pruefeKonfig({ ...prod, IMPRESSUM_URL: u }).meldungen?.join(' | ') || ''; return /IMPRESSUM_URL ist ungültig/.test(m) && !m.includes(u); }));
  pruefe('eigenPfade /jogi/impresszum etc. sind gueltige IMPRESSUM_URL-Werte (exakter Vergleich, kein trim)', (() => { const r = pruefeKonfig({ ...prod, IMPRESSUM_URL: '/jogi/impresszum', DATENSCHUTZ_URL: '/jogi/adatvedelem', TEILNAHMEBEDINGUNGEN_URL: '/jogi/reszveteli-feltetelek' }); return r.konfig?.rechtsseiten?.impresszum === '/jogi/impresszum' && r.konfig?.rechtsseiten?.adatvedelem === '/jogi/adatvedelem' && r.konfig?.rechtsseiten?.['reszveteli-feltetelek'] === '/jogi/reszveteli-feltetelek'; })());
  pruefe('IMPRESSUM_URL: Varianten und Angriffsvektoren bleiben ungueltig (kein trim im Vergleich, Pfad exakt)', ['//evil.example', '/\\evil.example', '/jogi/%2F%2Fevil.example', '/jogi/impresszum/', '/JOGI/impresszum'].every((u) => { const m = pruefeKonfig({ ...prod, IMPRESSUM_URL: u }).meldungen?.join(' | ') || ''; return /IMPRESSUM_URL ist ung\u00fcltig/.test(m); }));
  pruefe('IMPRESSUM_URL /jogi/impresszum mit nachgestelltem LF/TAB: wert() trimmt, Wert wird als eigenPfad akzeptiert', ['/jogi/impresszum\n', '/jogi/impresszum\t'].every((u) => !!pruefeKonfig({ ...prod, IMPRESSUM_URL: u }).konfig));
  pruefe('ausserhalb von production: Rechtsseiten fehlen ohne Warnung', pruefeKonfig({ ...gut }).konfig.warnungen.every((w) => !/RECHTSTEXTE/.test(w)));
  pruefe('ausserhalb von production keine solche Warnung (Entwicklung/Test)', pruefeKonfig({ ...gut }).konfig.warnungen.every((w) => !/VERKAUFSMELDUNG_MAIL|ANBIETER/.test(w)));
  pruefe('production: ein gesetzter HOST hat Vorrang', pruefeKonfig({ ...prod, HOST: '127.0.0.1' }).konfig.host === '127.0.0.1');
  pruefe('production: TRUST_PROXY=0 und =3 werden respektiert', pruefeKonfig({ ...prod, TRUST_PROXY: '0' }).konfig.trustProxy === 0 && pruefeKonfig({ ...prod, TRUST_PROXY: '3' }).konfig.trustProxy === 3);
  pruefe('production ohne BASE_URL: Abbruch', /BASE_URL fehlt/.test(pruefeKonfig({ ...prod, BASE_URL: undefined }).meldungen?.join('\n') || ''));
  pruefe('production mit http:// in BASE_URL: Abbruch', /https:\/\//.test(pruefeKonfig({ ...prod, BASE_URL: 'http://kurse.beispiel.hu' }).meldungen?.join('\n') || ''));
  pruefe('production mit http://localhost: Abbruch', !!pruefeKonfig({ ...prod, BASE_URL: 'http://localhost:10000' }).meldungen);
  pruefe('Rechnername mit Großbuchstaben wird klein geschrieben übernommen (Browser senden ihn klein: Herkunftsschutz)', pruefeKonfig({ ...gut, BASE_URL: 'https://Kurse.Beispiel.HU' }).konfig?.baseUrl === 'https://kurse.beispiel.hu');
  pruefe('Außerhalb von production ist http erlaubt, https auch (Secure dann automatisch)', pruefeKonfig({ ...gut, BASE_URL: 'https://x.beispiel.hu' }).konfig.secureCookies === true && pruefeKonfig({ ...gut, BASE_URL: 'http://x.beispiel.hu' }).konfig.secureCookies === false);
}

abschnitt('Falsche oder fehlende Werte brechen ab, die Meldung enthält nie den Wert');
{
  const faelle = [
    ['Beide Stripe-Werte fehlen', {}, 2, /STRIPE_SECRET_KEY fehlt/],
    ['Stripe-Schlüssel nur Leerzeichen', { ...gut, STRIPE_SECRET_KEY: '   ' }, 1, /STRIPE_SECRET_KEY fehlt/],
    ['Live-Schlüssel (sk_live_)', { ...gut, STRIPE_SECRET_KEY: `sk_live_${MARKE}` }, 1, /Testschlüssel/],
    ['Eingeschränkter Schlüssel (rk_)', { ...gut, STRIPE_SECRET_KEY: `rk_test_${MARKE}` }, 1, /Testschlüssel/],
    ['Schlüssel ohne Rest (sk_test_)', { ...gut, STRIPE_SECRET_KEY: 'sk_test_' }, 1, /Testschlüssel/],
    ['Webhook-Geheimnis falsch', { ...gut, STRIPE_WEBHOOK_SECRET: `abc_${MARKE}` }, 1, /whsec_/],
    ['Webhook-Geheimnis fehlt', { STRIPE_SECRET_KEY: gut.STRIPE_SECRET_KEY }, 1, /STRIPE_WEBHOOK_SECRET fehlt/],
    ['BASE_URL mit Schrägstrich am Ende', { ...gut, BASE_URL: `https://${MARKE}.beispiel.hu/` }, 1, /Schrägstrich/],
    ['BASE_URL ohne http(s)', { ...gut, BASE_URL: `${MARKE}.beispiel.hu` }, 1, /http:\/\/ oder https:\/\//],
    ['BASE_URL mit anderem Schema (ftp)', { ...gut, BASE_URL: `ftp://${MARKE}.beispiel.hu` }, 1, /http:\/\/ oder https:\/\//],
    ['BASE_URL mit Pfad', { ...gut, BASE_URL: `https://beispiel.hu/${MARKE}` }, 1, /ohne Pfad/],
    ['BASE_URL mit Parametern', { ...gut, BASE_URL: `https://beispiel.hu?x=${MARKE}` }, 1, /ohne Pfad/],
    ['BASE_URL mit Leerzeichen mittendrin', { ...gut, BASE_URL: `https://bei spiel.hu/${MARKE}` }, 1, /ungültig/],
    ['BASE_URL in Großbuchstaben (HTTPS://)', { ...gut, BASE_URL: `HTTPS://${MARKE}.hu` }, 1, /http:\/\/ oder https:\/\//],
    ['production ohne https', { ...gut, NODE_ENV: 'production', BASE_URL: `http://${MARKE}.beispiel.hu` }, 1, /https:\/\//],
    ['production ohne BASE_URL', { ...gut, NODE_ENV: 'production' }, 1, /BASE_URL fehlt/],
    ['PORT 0', { ...gut, PORT: '0' }, 1, /PORT/], ['PORT 65536', { ...gut, PORT: '65536' }, 1, /PORT/],
    ['PORT Text', { ...gut, PORT: `${MARKE}` }, 1, /PORT/], ['PORT mit Komma', { ...gut, PORT: '44.5' }, 1, /PORT/], ['PORT negativ', { ...gut, PORT: '-1' }, 1, /PORT/],
    ['HOST ungültig', { ...gut, HOST: `schlechter host! ${MARKE}` }, 1, /HOST/],
    ['NODE_ENV unbekannt', { ...gut, NODE_ENV: `staging_${MARKE}` }, 1, /NODE_ENV/],
    ['DB_DATEI mit Nullzeichen', { ...gut, DB_DATEI: `a\0${MARKE}` }, 1, /DB_DATEI/],
    ['MAX_UPLOAD_MB 0', { ...gut, MAX_UPLOAD_MB: '0' }, 1, /MAX_UPLOAD_MB/], ['MAX_UPLOAD_MB 5001', { ...gut, MAX_UPLOAD_MB: '5001' }, 1, /MAX_UPLOAD_MB/],
    ['MAX_UPLOAD_MB Text', { ...gut, MAX_UPLOAD_MB: `viel${MARKE}` }, 1, /MAX_UPLOAD_MB/], ['MAX_UPLOAD_MB mit Komma', { ...gut, MAX_UPLOAD_MB: '10.5' }, 1, /MAX_UPLOAD_MB/],
    ['MAX_UPLOAD_MB negativ', { ...gut, MAX_UPLOAD_MB: '-1' }, 1, /MAX_UPLOAD_MB/], ['MAX_UPLOAD_MB riesig', { ...gut, MAX_UPLOAD_MB: '99999' }, 1, /MAX_UPLOAD_MB/],
    ['DATEI_ORDNER ist public', { ...gut, DATEI_ORDNER: 'public' }, 1, /DATEI_ORDNER darf nicht im Ordner public/], ['DATEI_ORDNER in public (relativ)', { ...gut, DATEI_ORDNER: `public/${MARKE}` }, 1, /DATEI_ORDNER darf nicht/],
    ['DATEI_ORDNER in public (./ und ..)', { ...gut, DATEI_ORDNER: `./daten/../public/admin/${MARKE}` }, 1, /DATEI_ORDNER darf nicht/], ['DATEI_ORDNER in public (absolut)', { ...gut, DATEI_ORDNER: join(resolve('.'), 'public', MARKE) }, 1, /DATEI_ORDNER darf nicht/],
    ['DATEI_ORDNER mit Nullzeichen', { ...gut, DATEI_ORDNER: `a\0${MARKE}` }, 1, /DATEI_ORDNER/],
    ['TRUST_PROXY Text', { ...gut, TRUST_PROXY: `${MARKE}` }, 1, /TRUST_PROXY/], ['TRUST_PROXY zu groß', { ...gut, TRUST_PROXY: '11' }, 1, /TRUST_PROXY/],
  ];
  for (const [name, env, anzahl, muster] of faelle) {
    const r = pruefeKonfig(env);
    const text = JSON.stringify(r.meldungen || []);
    pruefe(`${name}: Abbruch mit ${anzahl} Meldung(en), nennt die Variable, nie den Wert`, !!r.meldungen && r.meldungen.length === anzahl && muster.test(r.meldungen.join('\n')) && !text.includes(MARKE) && !text.includes(gut.STRIPE_SECRET_KEY), JSON.stringify(r.meldungen || r.konfig));
  }
  const viele = pruefeKonfig({ STRIPE_SECRET_KEY: `sk_live_${MARKE}`, PORT: 'x', BASE_URL: `https://${MARKE}.hu/`, NODE_ENV: 'kaputt' });
  pruefe('Mehrere Fehler werden auf einmal gemeldet (nicht einer nach dem anderen)', viele.meldungen.length >= 5 && !JSON.stringify(viele.meldungen).includes(MARKE));
  pruefe('Die Meldungen sind deutsch und enthalten keine Zeilenumbrüche mit Werten', viele.meldungen.every((m) => /[a-zäöüß]{4,}/.test(m) && !m.includes('\n')));
}

// Scheibe 7: HMAC-Schlüssel und Geräte-Limit mit echten Validierungsgrenzen.
abschnitt('Wiedergabe- und Sitzungskonfiguration');
{
  const basis = { ...gut };
  pruefe('Wiedergabe-Schlüssel lokal zufällig pro Start', pruefeKonfig(basis).konfig.wiedergabeSchluessel !== pruefeKonfig(basis).konfig.wiedergabeSchluessel);
  pruefe('MAX_SITZUNGEN Standard drei', pruefeKonfig(basis).konfig.maxSitzungen === 3);
  pruefe('MAX_SITZUNGEN Grenzen 1 und 20', pruefeKonfig({ ...basis, MAX_SITZUNGEN: '1' }).konfig.maxSitzungen === 1 && pruefeKonfig({ ...basis, MAX_SITZUNGEN: '20' }).konfig.maxSitzungen === 20);
  pruefe('MAX_SITZUNGEN außerhalb der Grenzen abgelehnt', !!pruefeKonfig({ ...basis, MAX_SITZUNGEN: '0' }).meldungen && !!pruefeKonfig({ ...basis, MAX_SITZUNGEN: '21' }).meldungen);
  pruefe('Kurzer Wiedergabe-Schlüssel abgelehnt', !!pruefeKonfig({ ...basis, WIEDERGABE_GEHEIMNIS: 'kurz' }).meldungen);
  try {
    ladeKonfig({ ...basis, NODE_ENV: 'production', BASE_URL: 'https://kurse.beispiel.hu' });
    pruefe('production ohne Wiedergabe-Schlüssel abgelehnt', false);
  } catch (e) {
    pruefe('production ohne Wiedergabe-Schlüssel abgelehnt', e instanceof KonfigFehler && e.meldungen.some(m=>m.includes('WIEDERGABE_GEHEIMNIS')));
  }
}

// =====================================================================================================
abschnitt('Der echte Start (server.mjs) in einem leeren Ordner');
const arbeitsordner = mkdtempSync(join(tmpdir(), 'schulung-konfig-'));
const SERVER = resolve('server.mjs');
const basisEnv = (extra) => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WIEDERGABE_GEHEIMNIS: 'T'.repeat(40), ...extra });
const start = (env) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], { cwd: arbeitsordner, env: basisEnv(env), encoding: 'utf8', timeout: 10000 });
const dbPfad = join(arbeitsordner, 'abbruch', 'test.db');
const abbrueche = [
  ['Ohne jede Variable', {}],
  ['Mit Live-Schlüssel', { STRIPE_SECRET_KEY: `sk_live_${MARKE}`, STRIPE_WEBHOOK_SECRET: gut.STRIPE_WEBHOOK_SECRET }],
  ['BASE_URL mit Schrägstrich', { ...gut, BASE_URL: `http://localhost:4400/${MARKE}/` }],
  ['production ohne https', { ...gut, NODE_ENV: 'production', BASE_URL: 'http://kurse.beispiel.hu' }],
  ['PORT ungültig', { ...gut, PORT: `abc${MARKE}` }],
  ['MAX_UPLOAD_MB ungültig', { ...gut, MAX_UPLOAD_MB: `0${MARKE}` }],
  ['DATEI_ORDNER im public-Ordner der App', { ...gut, DATEI_ORDNER: join(resolve('.'), 'public', 'x') }],
];
for (const [name, env] of abbrueche) {
  const r = start({ DB_DATEI: dbPfad, DATEI_ORDNER: join(arbeitsordner, 'abbruch', 'dateien'), ...env });
  const ausgabe = (r.stdout || '') + (r.stderr || '');
  pruefe(`${name}: Exitcode 1, Meldung ohne Werte`, r.status === 1 && /fehlerhaft/.test(ausgabe) && !ausgabe.includes(MARKE) && !ausgabe.includes(gut.STRIPE_SECRET_KEY) && !ausgabe.includes(gut.STRIPE_WEBHOOK_SECRET), ausgabe.slice(0, 300));
}
pruefe('Bei einem Konfigurationsfehler wird nichts angelegt (keine Datenbank, kein Datei-Ordner)', !existsSync(join(arbeitsordner, 'abbruch')));
pruefe('Keine .env oder daten/stripe-objekte.json wird verlangt oder angelegt', !existsSync(join(arbeitsordner, '.env')) && !existsSync(join(arbeitsordner, 'daten')));

async function laufen(env, port, host = '127.0.0.1') {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], { cwd: arbeitsordner, env: basisEnv({ ...gut, DB_DATEI: join(arbeitsordner, `lauf-${port}.db`), ...env }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (x) => { log += x; }); p.stderr.on('data', (x) => { log += x; });
  for (let i = 0; i < 40 && !/Schulungsplattform läuft/.test(log); i++) await warte(250);
  return { p, log: () => log, base: `http://${host}:${port}` };
}
const post = (base, pfad, body, kopf = {}) => fetch(base + pfad, { method: 'POST', headers: { 'Content-Type': 'application/json', ...kopf }, body: JSON.stringify(body) });
const aussenIp = Object.values(networkInterfaces()).flat().find((x) => x && x.family === 'IPv4' && !x.internal)?.address;

abschnitt('Lokal: HOST und PORT, Cookie ohne Secure, kein Proxy');
{
  const dateiOrdner4407 = join(arbeitsordner, 'dateien-4407');
  const dbDatei4407 = join(arbeitsordner, 'lauf-4407.db');
  const adminSkript = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', resolve('tools/admin-anlegen.mjs'), 'gabi@example.com'], { cwd: arbeitsordner, env: basisEnv({ DB_DATEI: dbDatei4407, ADMIN_PASSWORT: 'Geheim-Passwort-123' }), encoding: 'utf8' });
  pruefe('Vorbereitung: Admin für den Upload-Test angelegt', adminSkript.stdout.trim() === 'Admin angelegt', adminSkript.stdout + adminSkript.stderr);
  const s = await laufen({ PORT: '4407', HOST: '127.0.0.1', BASE_URL: 'http://localhost:4407', DATEI_ORDNER: dateiOrdner4407, MAX_UPLOAD_MB: '1' }, 4407);
  try {
    pruefe('Der Datei-Ordner wird beim Start angelegt (DATEI_ORDNER)', existsSync(dateiOrdner4407) && statSync(dateiOrdner4407).isDirectory());
    {
      // MAX_UPLOAD_MB und DATEI_ORDNER kommen wirklich im echten Server an (nicht nur in der Prüfung)
      const anm = await post(s.base, '/api/anmelden', { email: 'gabi@example.com', passwort: 'Geheim-Passwort-123' });
      const ck = anm.headers.get('set-cookie').split(';')[0];
      const kopf = { Cookie: ck, 'Content-Type': 'application/json' };
      const kurs = await (await fetch(`${s.base}/api/admin/kurse`, { method: 'POST', headers: kopf, body: JSON.stringify({ titel: 'K', preis_cent: 0 }) })).json();
      const lek = await (await fetch(`${s.base}/api/admin/kurse/${kurs.id}/lektionen`, { method: 'POST', headers: kopf, body: JSON.stringify({ titel: 'L', art: 'pdf' }) })).json();
      const pdf = (n) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(n - 9, 7)]);
      const gross = await fetch(`${s.base}/api/admin/lektionen/${lek.id}/datei`, { method: 'PUT', headers: { Cookie: ck, 'Content-Type': 'application/pdf', 'X-Dateiname': 'a.pdf' }, body: pdf(1024 * 1024 + 1) });
      pruefe('Echter Server mit MAX_UPLOAD_MB=1: 1 MB + 1 Byte wird mit 413 abgewiesen', gross.status === 413 && readdirSync(dateiOrdner4407).length === 0, String(gross.status));
      const klein = await fetch(`${s.base}/api/admin/lektionen/${lek.id}/datei`, { method: 'PUT', headers: { Cookie: ck, 'Content-Type': 'application/pdf', 'X-Dateiname': 'a.pdf' }, body: pdf(2000) });
      pruefe('... eine kleine PDF wird angenommen (201) und liegt im DATEI_ORDNER unter einem Zufallsnamen', klein.status === 201 && readdirSync(dateiOrdner4407).length === 1 && /^[0-9a-f-]{36}$/.test(readdirSync(dateiOrdner4407)[0]), String(klein.status));
    }
    pruefe('Server startet mit PORT=4407 und HOST=127.0.0.1', /lauscht auf 127\.0\.0\.1:4407/.test(s.log()), s.log());
    pruefe('Die Start-Ausgabe enthält keine Schlüssel', !s.log().includes(gut.STRIPE_SECRET_KEY) && !s.log().includes(gut.STRIPE_WEBHOOK_SECRET));
    pruefe('Antwortet auf dem eingestellten Port', (await fetch(`${s.base}/api/kurse`)).status === 200);
    if (aussenIp) pruefe(`HOST=127.0.0.1: von einer anderen Adresse des Rechners (${aussenIp.replace(/\d+$/, 'x')}) NICHT erreichbar`, await fetch(`http://${aussenIp}:4407/api/kurse`, { signal: AbortSignal.timeout(2000) }).then(() => false, () => true));
    const reg = await post(s.base, '/api/registrieren', { zustimmung: true, email: 'a@example.com', passwort: 'Geheim-Passwort-123' });
    const cookie = reg.headers.get('set-cookie') || '';
    pruefe('Cookie lokal (http): HttpOnly und SameSite=Lax, aber OHNE Secure', reg.status === 201 && /HttpOnly/.test(cookie) && /SameSite=Lax/.test(cookie) && !/Secure/i.test(cookie), cookie);
    // ohne TRUST_PROXY wird X-Forwarded-For ignoriert: alle Fehlversuche zählen für dieselbe Adresse
    for (let i = 0; i < 5; i++) await post(s.base, '/api/anmelden', { email: 'a@example.com', passwort: 'falsch-falsch-1' }, { 'X-Forwarded-For': `203.0.113.${i + 1}` });
    const gesperrt = await post(s.base, '/api/anmelden', { email: 'a@example.com', passwort: 'falsch-falsch-1' }, { 'X-Forwarded-For': '198.51.100.77' });
    pruefe('Ohne Proxy-Einstellung wird X-Forwarded-For nicht geglaubt (Sperre gilt trotz anderer Absenderangabe)', gesperrt.status === 429);
    pruefe('Herkunftsschutz folgt BASE_URL: fremde Herkunft 403, eigene Herkunft ok', (await post(s.base, '/api/abmelden', {}, { Origin: 'https://boese.example' })).status === 403 && (await post(s.base, '/api/abmelden', {}, { Origin: 'http://localhost:4407' })).status === 200);
  } finally { s.p.kill(); }
}

abschnitt('Betrieb: production, https-Adresse, 0.0.0.0, Proxy');
{
  const s = await laufen({ WIEDERGABE_GEHEIMNIS: 'T'.repeat(40), NODE_ENV: 'production', PORT: '4408', BASE_URL: 'https://kurse.beispiel.hu' }, 4408);
  try {
    pruefe('production: lauscht auf 0.0.0.0:4408 (Standard in der Cloud)', /lauscht auf 0\.0\.0\.0:4408/.test(s.log()), s.log());
    pruefe('Antwortet auf 127.0.0.1', (await fetch(`${s.base}/api/kurse`)).status === 200);
    if (aussenIp) pruefe(`... und von einer anderen Adresse des Rechners (${aussenIp.replace(/\d+$/, 'x')}) erreichbar`, (await fetch(`http://${aussenIp}:4408/api/kurse`, { signal: AbortSignal.timeout(3000) }).catch(() => ({ status: 0 }))).status === 200);
    else console.log('(übersprungen, nicht gezählt: keine zweite Netzwerkadresse in dieser Umgebung)');
    const reg = await post(s.base, '/api/registrieren', { zustimmung: true, email: 'b@example.com', passwort: 'Geheim-Passwort-123' }, { Origin: 'https://kurse.beispiel.hu' });
    pruefe('Cookie bei https-BASE_URL: HttpOnly, SameSite=Lax UND Secure', reg.status === 201 && /HttpOnly/.test(reg.headers.get('set-cookie')) && /SameSite=Lax/.test(reg.headers.get('set-cookie')) && /; Secure/.test(reg.headers.get('set-cookie')), reg.headers.get('set-cookie'));
    const aus = await post(s.base, '/api/abmelden', {}, { Origin: 'https://kurse.beispiel.hu' });
    pruefe('Auch das Löschen des Cookies (Abmelden) trägt Secure', aus.status === 200 && /; Secure/.test(aus.headers.get('set-cookie')));
    pruefe('Herkunftsschutz folgt der BASE_URL: http://localhost wird jetzt abgelehnt, die öffentliche Adresse nicht', (await post(s.base, '/api/abmelden', {}, { Origin: 'http://localhost:4408' })).status === 403 && (await post(s.base, '/api/abmelden', {}, { Origin: 'https://kurse.beispiel.hu' })).status === 200);
    // TRUST_PROXY=1 (Standard in production): die echte Adresse kommt aus X-Forwarded-For. Eine Sperre trifft nur diesen Besucher.
    for (let i = 0; i < 5; i++) await post(s.base, '/api/anmelden', { email: 'b@example.com', passwort: 'falsch-falsch-1' }, { Origin: 'https://kurse.beispiel.hu', 'X-Forwarded-For': '203.0.113.5' });
    const gesperrt = await post(s.base, '/api/anmelden', { email: 'b@example.com', passwort: 'Geheim-Passwort-123' }, { Origin: 'https://kurse.beispiel.hu', 'X-Forwarded-For': '203.0.113.5' });
    const anderer = await post(s.base, '/api/anmelden', { email: 'b@example.com', passwort: 'Geheim-Passwort-123' }, { Origin: 'https://kurse.beispiel.hu', 'X-Forwarded-For': '203.0.113.99' });
    pruefe('Hinter dem Proxy (TRUST_PROXY=1): Sperre trifft nur die Adresse aus X-Forwarded-For, ein anderer Besucher kann sich anmelden', gesperrt.status === 429 && anderer.status === 200);
  } finally { s.p.kill(); }
}

abschnitt('Gleicher Betrieb, aber TRUST_PROXY=0 und HOST=127.0.0.1 ausdrücklich');
{
  const s = await laufen({ NODE_ENV: 'production', PORT: '4411', BASE_URL: 'https://kurse.beispiel.hu', HOST: '127.0.0.1', TRUST_PROXY: '0' }, 4411);
  try {
    pruefe('Ausdrücklich gesetzter HOST hat Vorrang vor dem production-Standard', /lauscht auf 127\.0\.0\.1:4411/.test(s.log()), s.log());
    pruefe('Warnung ohne DB_DATEI wird nicht angezeigt, wenn DB_DATEI gesetzt ist (hier gesetzt)', !/Hinweis: DB_DATEI/.test(s.log()));
    const o = { Origin: 'https://kurse.beispiel.hu' };
    await post(s.base, '/api/registrieren', { zustimmung: true, email: 'c@example.com', passwort: 'Geheim-Passwort-123' }, o);
    for (let i = 0; i < 5; i++) await post(s.base, '/api/anmelden', { email: 'c@example.com', passwort: 'falsch-falsch-1' }, { ...o, 'X-Forwarded-For': `203.0.113.${i + 1}` });
    pruefe('TRUST_PROXY=0: X-Forwarded-For wird ignoriert', (await post(s.base, '/api/anmelden', { email: 'c@example.com', passwort: 'Geheim-Passwort-123' }, { ...o, 'X-Forwarded-For': '198.51.100.9' })).status === 429);
  } finally { s.p.kill(); }
}
{
  // production ohne DB_DATEI: Hinweis erscheint (der Wert selbst nie). Die Standard-Datenbank würde in den Arbeitsordner geschrieben.
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WIEDERGABE_GEHEIMNIS: 'T'.repeat(40), ...gut, NODE_ENV: 'production', BASE_URL: 'https://kurse.beispiel.hu', PORT: '4411' };
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], { cwd: arbeitsordner, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (x) => { log += x; }); p.stderr.on('data', (x) => { log += x; });
  for (let i = 0; i < 40 && !/Schulungsplattform läuft/.test(log); i++) await warte(250);
  p.kill();
  pruefe('production ohne DB_DATEI: der Start gelingt mit einem Hinweis zum dauerhaften Speicher', /Hinweis: DB_DATEI ist nicht gesetzt/.test(log) && /Schulungsplattform läuft/.test(log), log);
}
aufraeumen(arbeitsordner);

// =====================================================================================================
abschnitt('PE_RESEND_URL-Validierung (PUNKT 4)');
{
  // Nicht-Produktion: http://127.0.0.1 erlaubt
  const rLokal = pruefeKonfig({ ...gut, PE_RESEND_URL: 'http://127.0.0.1:19380' });
  pruefe('Nicht-Prod: PE_RESEND_URL http://127.0.0.1 → wird verwendet', !!rLokal.konfig && rLokal.konfig.resendUrl === 'http://127.0.0.1:19380', `resendUrl=${rLokal.konfig?.resendUrl} fehler=${rLokal.meldungen}`);

  // Nicht-Produktion: http://localhost erlaubt
  const rLocalhost = pruefeKonfig({ ...gut, PE_RESEND_URL: 'http://localhost:4567' });
  pruefe('Nicht-Prod: PE_RESEND_URL http://localhost → wird verwendet', !!rLocalhost.konfig && rLocalhost.konfig.resendUrl === 'http://localhost:4567', `resendUrl=${rLocalhost.konfig?.resendUrl} fehler=${rLocalhost.meldungen}`);

  // Nicht-Produktion: externe URL → KonfigFehler (Gegenprobe)
  const rExtern = pruefeKonfig({ ...gut, PE_RESEND_URL: 'https://evil.example.com' });
  pruefe('Gegenprobe: Nicht-Prod PE_RESEND_URL extern → KonfigFehler', !rExtern.konfig && (rExtern.meldungen ?? []).some(m => m.includes('PE_RESEND_URL')), `meldungen=${JSON.stringify(rExtern.meldungen)}`);

  // Produktion: PE_RESEND_URL gesetzt → KonfigFehler (Gegenprobe)
  const rProd = pruefeKonfig({ ...gut, NODE_ENV: 'production', BASE_URL: 'https://kurse.beispiel.hu', PE_RESEND_URL: 'http://127.0.0.1:1234' });
  pruefe('Gegenprobe: Prod + PE_RESEND_URL gesetzt → KonfigFehler', !rProd.konfig && (rProd.meldungen ?? []).some(m => m.includes('PE_RESEND_URL')), `meldungen=${JSON.stringify(rProd.meldungen)}`);

  // Ohne PE_RESEND_URL → Standard-URL
  const rOhne = pruefeKonfig({ ...gut });
  pruefe('Ohne PE_RESEND_URL → Standard https://api.resend.com/emails', !!rOhne.konfig && rOhne.konfig.resendUrl === 'https://api.resend.com/emails', `resendUrl=${rOhne.konfig?.resendUrl}`);
}

// =====================================================================================================
abschnitt('Dokumentation und Hygiene');
{
  const doku = readFileSync('docs/UMGEBUNG.md', 'utf8');
  const konfigQuelle = readFileSync('konfig.mjs', 'utf8');
  const variablen = [...new Set([...konfigQuelle.matchAll(/wert\('([A-Z_]+)'\)/g)].map((m) => m[1]))];
  pruefe(`konfig.mjs liest ${variablen.length} Variablen (mindestens die 10 verlangten)`, ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BASE_URL', 'PORT', 'HOST', 'DB_DATEI', 'DATEI_ORDNER', 'MAX_UPLOAD_MB', 'NODE_ENV', 'TRUST_PROXY'].every((v) => variablen.includes(v)), variablen.join(','));
  const zeilenDoku = doku.split('\n');
  for (const v of [...variablen, 'ADMIN_PASSWORT']) {
    const zeile = zeilenDoku.find((z) => z.startsWith(`| \`${v}\``)) || '';
    pruefe(`docs/UMGEBUNG.md beschreibt ${v} (Pflicht oder optional, Zweck, Beispiel)`, /Pflicht|optional|Skript/i.test(zeile) && zeile.split('|').length >= 5 && zeile.split('|')[3].trim().length > 20, zeile.slice(0, 80));
  }
  pruefe('server.mjs reicht DATEI_ORDNER und die Obergrenze weiter und hebt das Zeitlimit für große Uploads an', /dateiOrdner: konfig\.dateiOrdner/.test(readFileSync('server.mjs', 'utf8')) && /maxUploadBytes: konfig\.maxUploadBytes/.test(readFileSync('server.mjs', 'utf8')) && /requestTimeout/.test(readFileSync('server.mjs', 'utf8')));
  pruefe('Pflicht laut Dokument: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET und BASE_URL (im Betrieb)', /\| `STRIPE_SECRET_KEY` \| \*\*Pflicht\*\*/.test(doku) && /\| `STRIPE_WEBHOOK_SECRET` \| \*\*Pflicht\*\*/.test(doku) && /\| `BASE_URL` \| \*\*Pflicht im Betrieb\*\*/.test(doku));
  pruefe('Die Dokumentation enthält keine echt aussehenden Schlüssel (nur Platzhalter)', !/(sk|rk|pk)_(test|live)_(?!x+\b)[A-Za-z0-9]{8,}/.test(doku) && !/whsec_(?!x+\b)[A-Za-z0-9]{8,}/.test(doku));
  pruefe('Die Dokumentation nennt dauerhaften Speicher für DB_DATEI, PostgreSQL und Secure-Cookies', /dauerhaften Speicher/.test(doku) && /DATABASE_URL/.test(doku) && /Secure/.test(doku));
  pruefe('Die Dokumentation sagt, dass DATEI_ORDNER in der Cloud einen dauerhaften Datenträger oder später Bunny-Speicher braucht', /DATEI_ORDNER[^\n]*dauerhaften Datenträger[^\n]*Bunny/.test(doku));

  // Umgebungsvariablen werden nur in konfig.mjs gelesen (db.mjs liest DB_DATEI, server.mjs setzt sie nach der Prüfung)
  const dateien = readdirSync('.').filter((f) => f.endsWith('.mjs'));
  const leser = dateien.filter((f) => /process\.env/.test(readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')));
  pruefe('Nur konfig.mjs, db.mjs, server.mjs und texte.mjs (Standardsprache) berühren process.env (nicht Routen, Seiten oder Zahlungen)', leser.sort().join(',') === 'db.mjs,konfig.mjs,server.mjs,texte.mjs', leser.join(','));
  const paket = JSON.parse(readFileSync('package.json', 'utf8').replace(/^\uFEFF/, ''));
  pruefe('Keine neuen Pakete: nur express und stripe, kein dotenv', Object.keys(paket.dependencies).sort().join(',') === 'express,stripe' && !paket.devDependencies && !dateien.some((f) => /(from|import|require\()\s*['"]dotenv/.test(readFileSync(f, 'utf8'))));
  pruefe('Keine .env-Datei im Repo-Ordner', readdirSync('.').filter((f) => f === '.env' || f.startsWith('.env.')).length === 0);
}

console.log(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`);
process.exit(schlecht === 0 ? 0 : 1);
