import './test-sprache.mjs';
// Backlog a (12.11.2026): Widerruf mit fehlgeschlagener Stripe-Erstattung von Hand "ohne Erstattung abschliessen".
// POST /api/admin/widerrufe/:id/erledigt { begruendung }, GET /api/admin/widerrufe/erledigt, Ausschluss aus "Offene Widerrufe" und Kennzahl "offen".
// Geprueft: nur Admin (Gast 401, Kaeufer 403, Demo-Admin 403, fremde Herkunft 403), Begruendung 5..500 (400), unbekannte ID 404, erstattet/abgelehnt 409,
// laufende Erstattung 409, Doppelaufruf 409 (auch parallel), Stripe-Status/Bestellung/Zugang unveraendert, kein Stripe-Aufruf, Audit im Verwaltungsprotokoll,
// Liste offen vs. abgeschlossen, HTML in der Begruendung wird nie ausgefuehrt, Migration wiederholbar, Texte dreisprachig. Teil D: Browser (Admin-Seite).
// Aufruf (im Ordner plattform): node --disable-warning=ExperimentalWarning tools/selbsttest-widerruf-erledigt.mjs
// Offline: Temp-Datenbank, Stripe-Attrappe (zaehlt Aufrufe), eigener Server auf Port 5163 (normal) und 5164 (Demo), kein Netz.
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const PLATTFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'schulung-widerruf-erledigt-'));
process.env.DB_DATEI = join(dir, 'test.db');
let ok = 0, fail = 0, uebersprungen = 0, server, demoServer;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' | ' + String(d).slice(0, 300))); };
const teil = async (name, fn) => { try { await fn(); } catch (e) { check('Teil ' + name + ' lief durch', false, e.stack || e.message); } };
const SPRACHEN = ['de', 'en', 'hu'];
const T = Object.fromEntries(SPRACHEN.map((l) => [l, JSON.parse(readFileSync(join(PLATTFORM, 'texte', l + '.json'), 'utf8'))]));
const PORT = 5163, B = 'http://127.0.0.1:' + PORT, DPORT = 5164, DB_ = 'http://127.0.0.1:' + DPORT;
const NEU_A = ['a_widerruf_erledigen', 'a_widerruf_begruendung', 'a_widerruf_begruendung_hinweis', 'a_widerruf_erledigen_frage', 'a_widerruf_erledigt_ok', 'a_widerruf_erledigt_label',
  'a_widerruf_erledigte_cim', 'a_widerruf_erledigte_magyarazat', 'a_nincs_widerruf_erledigt', 'a_widerruf_stripe_status', 'a_widerruf_stripe_fehler', 'a_widerruf_bearbeiter',
  'a_widerruf_erledigt_am', 'a_widerruf_begruendung_kurz', 'a_widerruf_begruendung_laenge', 'a_widerruf_laeuft_hinweis',
  // Backlog c (12.11.2026): Fallreferenz und Pflicht-Bestaetigung
  'a_widerruf_fallreferenz', 'a_widerruf_fallreferenz_kurz', 'a_widerruf_fallreferenz_laenge', 'a_widerruf_stripe_geprueft', 'a_widerruf_stripe_geprueft_pflicht'];
const NEU_FEHLER = ['widerruf_begruendung', 'widerruf_laeuft_noch', 'widerruf_nicht_offen', 'widerruf_schon_erledigt', 'widerruf_fallreferenz', 'widerruf_stripe_geprueft'];
// Gueltiger Koerper seit Backlog c: Begruendung + Fallreferenz + stripe_geprueft (genau true). Weitere Felder ueberschreiben/ergaenzen.
const REF = 'TICKET-4711 / re_3Qtest';
const K = (begruendung, mehr = {}) => ({ begruendung, fallreferenz: REF, stripe_geprueft: true, ...mehr });
try {
  // ======================= Teil A: Texte =======================
  await teil('A-Texte', async () => {
    for (const l of SPRACHEN) {
      const fehlt = [...NEU_A, ...NEU_FEHLER].filter((k) => typeof T[l][k] !== 'string' || T[l][k].trim().length < 3);
      check(`[${l}] alle ${NEU_A.length + NEU_FEHLER.length} neuen Texte vorhanden`, fehlt.length === 0, fehlt.join(','));
    }
    check('Gleiche Schluessel in de/en/hu (Anzahl und Menge)', JSON.stringify(Object.keys(T.de).sort()) === JSON.stringify(Object.keys(T.en).sort()) && JSON.stringify(Object.keys(T.de).sort()) === JSON.stringify(Object.keys(T.hu).sort()));
    // Die Erledigung darf nie als Erstattung erscheinen: Label sagt ausdruecklich "ohne Erstattung", und es ist nicht der Text eines erstatteten Status.
    check('Label DE "Ohne Erstattung abgeschlossen (manuell)"', T.de.a_widerruf_erledigt_label === 'Ohne Erstattung abgeschlossen (manuell)', T.de.a_widerruf_erledigt_label);
    check('Label EN enthaelt "without refund", HU "visszatérítés nélkül"', /without refund/i.test(T.en.a_widerruf_erledigt_label) && /visszatérítés nélkül/i.test(T.hu.a_widerruf_erledigt_label));
    for (const l of SPRACHEN) {
      const erstattetTexte = [T[l].ellallas_erstattung, T[l].ellallas_inhaber_erstattung].filter(Boolean);
      check(`[${l}] Label/Titel/Bestaetigung sind keine Erstattungs-Texte und nennen "ohne/nicht"`, !erstattetTexte.includes(T[l].a_widerruf_erledigt_label)
        && [T[l].a_widerruf_erledigt_label, T[l].a_widerruf_erledigte_cim, T[l].a_widerruf_erledigen, T[l].a_widerruf_erledigt_ok].every((x) => /ohne|nicht|without|not|nélkül|nem/i.test(x)), T[l].a_widerruf_erledigt_label);
      check(`[${l}] Hinweis sagt, dass KEINE Stripe-Erstattung erfolgt und Kauf/Zugang bleiben`, /NICHT|NOT|NEM/.test(T[l].a_widerruf_begruendung_hinweis));
    }
    check('HU in Du-Form (lezárod, fiókoddal)', T.hu.a_widerruf_erledigen_frage.includes('lezárod') && T.hu.a_widerruf_begruendung_hinweis.includes('fiókoddal'));
    check('Checkbox-Text DE woertlich "Ich habe den tatsächlichen Erstattungsstatus in Stripe geprüft"', T.de.a_widerruf_stripe_geprueft === 'Ich habe den tatsächlichen Erstattungsstatus in Stripe geprüft', T.de.a_widerruf_stripe_geprueft);
    check('Checkbox-Text EN/HU nennen Stripe, HU in Du-/Ich-Form (Ellenőriztem, erősítsd)', /Stripe/.test(T.en.a_widerruf_stripe_geprueft) && T.hu.a_widerruf_stripe_geprueft.startsWith('Ellenőriztem') && T.hu.a_widerruf_stripe_geprueft_pflicht.includes('erősítsd'));
    for (const l of SPRACHEN) check(`[${l}] Fallreferenz-Texte nennen 3 und 100`, /3/.test(T[l].a_widerruf_fallreferenz) && /100/.test(T[l].a_widerruf_fallreferenz) && /100/.test(T[l].widerruf_fallreferenz));
    const adminJs = readFileSync(join(PLATTFORM, 'public', 'admin', 'admin.js'), 'utf8');
    check('admin.js: alle neuen a_-Texte benutzt', NEU_A.every((k) => adminJs.includes("'" + k + "'")), NEU_A.filter((k) => !adminJs.includes("'" + k + "'")).join(','));
    check('admin.js: Begruendungsfeld mit Pflicht, minlength 5, maxlength 500, aria-describedby, Bestaetigung', adminJs.includes("required: true, minlength: '5', maxlength: '500', 'aria-describedby'") && adminJs.includes("bestaetigen('a_widerruf_erledigen_frage'"));
    check('admin.js: Fallreferenz-Feld (Pflicht, minlength 3, maxlength 100) und Pflicht-Checkbox; beides wird gesendet, stripe_geprueft als boolean',
      adminJs.includes("name: 'fallreferenz', required: true, minlength: '3', maxlength: '100'") && adminJs.includes("type: 'checkbox', name: 'stripe_geprueft', required: true")
      && adminJs.includes('{ begruendung, fallreferenz, stripe_geprueft: feldGeprueft.checked === true }') && adminJs.includes("if (!feldGeprueft.checked)"));
    check('admin.js: abgeschlossene Liste zeigt die Fallreferenz als Text', adminJs.includes("t('a_widerruf_fallreferenz_kurz') + ': ' + (x.erledigt_fallreferenz ?? '–')"));
    check('admin.js: Knopf mit aria-expanded/aria-controls, Fokus ins Feld ohne Scrollsprung', adminJs.includes("'aria-expanded': 'false', 'aria-controls': formId") && adminJs.includes('feldText.focus({ preventScroll: true })'));
    const ohneKommentar = (q) => q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');   // wie selbsttest-admin
    check('admin.js: kein innerHTML im Code (Begruendung nur als Text)', !/innerHTML|outerHTML|insertAdjacentHTML/.test(ohneKommentar(adminJs)));
  });

  // ======================= Teil B: Server =======================
  const { db } = await import('../db.mjs');
  const { sitzungErzeugen, stepupErzeugen } = await import('../auth.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const stripeAufrufe = [];
  const zaehl = (name, wert) => async (...a) => { stripeAufrufe.push(name); return typeof wert === 'function' ? wert(...a) : wert; };
  const stripe = { customers: { create: zaehl('customers.create', { id: 'cus_we' }), update: zaehl('customers.update', {}) },
    checkout: { sessions: { create: zaehl('checkout.create', { id: 'cs_we', url: 'https://checkout.stripe.com/test' }), retrieve: zaehl('checkout.retrieve', { payment_intent: 'pi_we' }), list: zaehl('checkout.list', { data: [] }), expire: zaehl('checkout.expire', {}) } },
    paymentIntents: { retrieve: zaehl('pi.retrieve', (id) => ({ id })) }, refunds: { create: zaehl('refunds.create', { id: 're_we' }), list: zaehl('refunds.list', { data: [] }) },
    invoices: { retrieve: zaehl('invoices.retrieve', {}), list: zaehl('invoices.list', { data: [] }) },
    subscriptions: { list: zaehl('subscriptions.list', { data: [] }), cancel: zaehl('subscriptions.cancel', {}) },
    billingPortal: { sessions: { create: zaehl('portal.create', { url: 'https://billing.stripe.com/test' }) } }, webhooks: { constructEvent: () => ({}) } };
  const jetzt = new Date().toISOString();
  const nutzer = (email, rolle) => Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt,rolle,sprache) VALUES(?,?,?,?,?,'de')").run(email, 'nur-fuer-selbsttest', jetzt, Date.now(), rolle).lastInsertRowid);
  const adminId = nutzer('admin-we@example.org', 'admin'), admin2Id = nutzer('admin2-we@example.org', 'admin'), demoAdminId = nutzer('demo-admin-we@example.org', 'admin');
  const kundeId = nutzer('kunde-we@example.org', 'kunde');
  db.prepare("INSERT INTO demo_konten (benutzer_id,art,erstellt) VALUES (?,'admin',?)").run(demoAdminId, Date.now());
  const kid = Number(db.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES ('Widerrufskurs','x',1999,'eur','veroeffentlicht',?,?)").run(jetzt, jetzt).lastInsertRowid);
  let nr = 0;
  const bestellung = (status = 'bezahlt') => { nr++; return Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert) VALUES(?,?,?,?,1999,'eur',?,?,?)").run('cs_we' + nr, 'pi_we' + nr, kundeId, kid, status, jetzt, jetzt).lastInsertRowid); };
  const widerruf = (ergebnis, status = 'bezahlt') => { const id = bestellung(status); db.prepare('INSERT INTO ellallas(bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES(?,?,?,?,?)').run(id, new Date(Date.now() - nr * 1000).toISOString(), ergebnis, ergebnis === 'fehler' ? 'stripe' : null, jetzt); return id; };
  const bF1 = widerruf('fehler'), bF2 = widerruf('fehler'), bF3 = widerruf('fehler'), bHtml = widerruf('fehler'), bLang = widerruf('fehler');
  const bB = widerruf('bearbeitung'), bE = widerruf('erstattung', 'erstattet'), bA = widerruf('abgelehnt_frist'), bZ = widerruf('abgelehnt_zustimmung');
  const bOhne = bestellung();
  const bR3 = widerruf('fehler'), bR100 = widerruf('fehler');
  // Teil 2: Bestellung als "erstattet" markiert, Widerruf-Erstattung aber 'fehler' (z. B. spaeter von Hand anders gebucht) -> Konto darf nie "Erstattet" zeigen.
  const bEF = widerruf('fehler', 'erstattet');
  db.prepare("UPDATE bestellungen SET grund='erstattung_voll' WHERE id=?").run(bEF);
  const bBrowser = Object.fromEntries(SPRACHEN.map((l) => [l, widerruf('fehler')]));
  db.prepare("INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt) VALUES (?,?,'zahlung',?)").run(kundeId, kid, jetzt);
  server = erstelleServer({ stripe, base: B, webhookSecret: 'x', mailer: async () => true, dateiOrdner: join(dir, 'dateien'),
    ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: false, trustProxy: 0 }).listen(PORT, '127.0.0.1');
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const sitz = { admin: sitzungErzeugen(adminId), admin2: sitzungErzeugen(admin2Id), kunde: sitzungErzeugen(kundeId), demo: sitzungErzeugen(demoAdminId) };
  stepupErzeugen(sitz.admin); stepupErzeugen(sitz.admin2);
  const anfrage = (basis) => async (wer, methode, pfad, body, extra = {}) => {
    const headers = { Origin: basis, Cookie: 'lang=de' + (wer ? '; sitzung=' + sitz[wer] : ''), ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(basis + pfad, { method: methode, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const text = await r.text(); let d = {}; try { d = JSON.parse(text); } catch { /* kein JSON */ }
    return { s: r.status, d, typ: r.headers.get('content-type') || '' };
  };
  const req = anfrage(B);
  const P = (id) => '/api/admin/widerrufe/' + id + '/erledigt';
  const GUT = 'Kunde per Telefon informiert, Zahlung war bereits storniert.';
  const zustand = () => JSON.stringify({ e: db.prepare('SELECT * FROM ellallas ORDER BY bestellung_id').all(), b: db.prepare('SELECT * FROM bestellungen ORDER BY id').all(), z: db.prepare('SELECT * FROM zugaenge ORDER BY benutzer_id,kurs_id').all() });
  const erledigtZahl = () => db.prepare('SELECT COUNT(*) n FROM ellallas_erledigt').get().n;
  const logZahl = () => db.prepare("SELECT COUNT(*) n FROM verwaltung_log WHERE aktion='widerruf_erledigt'").get().n;

  await teil('B-Rechte', async () => {
    const vorher = zustand();
    const g = await req(null, 'POST', P(bF1), K(GUT));
    check('Gast: 401 nicht_angemeldet', g.s === 401 && g.d.fehler === 'nicht_angemeldet', JSON.stringify(g));
    const k = await req('kunde', 'POST', P(bF1), K(GUT));
    check('Kaeufer: 403 kein_admin', k.s === 403 && k.d.fehler === 'kein_admin', JSON.stringify(k));
    const f = await req('admin', 'POST', P(bF1), K(GUT), { Origin: 'https://angreifer.example' });
    check('Admin mit fremder Herkunft (CSRF): 403 herkunft_fremd', f.s === 403 && f.d.fehler === 'herkunft_fremd', JSON.stringify(f));
    check('Gast/Kaeufer GET abgeschlossene Liste: 401/403', (await req(null, 'GET', '/api/admin/widerrufe/erledigt')).s === 401 && (await req('kunde', 'GET', '/api/admin/widerrufe/erledigt')).s === 403);
    check('Nach abgelehnten Aufrufen: nichts geaendert, kein Eintrag', zustand() === vorher && erledigtZahl() === 0 && logZahl() === 0);
  });

  await teil('B-Validierung', async () => {
    const vorher = zustand();
    const faelle = [['fehlt (leerer Body)', {}], ['fehlt (kein Body)', undefined], ['zu kurz (4)', K('abcd')], ['nur Leerzeichen um 3 Zeichen', K('   abc      ')],
      ['zu lang (501)', K('x'.repeat(501))], ['keine Zeichenkette', K(12345)], ['null', K(null)], ['Feld zusaetzlich', K(GUT, { betrag: 0 })],
      ['Liste statt Objekt', [GUT]], ['Steuerzeichen', K('Grund \u0000 mit Nullbyte')]];
    for (const [name, body] of faelle) {
      const r = await req('admin', 'POST', P(bF1), body);
      check('Begruendung ' + name + ': 400 widerruf_begruendung', r.s === 400 && r.d.fehler === 'widerruf_begruendung' && typeof r.d.text === 'string' && r.d.text !== 'widerruf_begruendung', JSON.stringify(r));
    }
    // Backlog c: Fallreferenz Pflicht, 3..100 Zeichen, eine Zeile, keine Steuerzeichen
    const refFaelle = [['fehlt', { begruendung: GUT, stripe_geprueft: true }], ['leer', K(GUT, { fallreferenz: '' })], ['nur Leerzeichen', K(GUT, { fallreferenz: '      ' })],
      ['zu kurz (2)', K(GUT, { fallreferenz: 'ab' })], ['zu kurz nach Trim ("  ab  ")', K(GUT, { fallreferenz: '  ab  ' })], ['zu lang (101)', K(GUT, { fallreferenz: 'r'.repeat(101) })],
      ['Zahl', K(GUT, { fallreferenz: 4711 })], ['null', K(GUT, { fallreferenz: null })], ['Liste', K(GUT, { fallreferenz: ['T-1'] })],
      ['Zeilenumbruch', K(GUT, { fallreferenz: 'T-1\nT-2' })], ['Wagenruecklauf', K(GUT, { fallreferenz: 'T-1\rX' })], ['Tabulator', K(GUT, { fallreferenz: 'T-1\tX' })],
      ['Nullbyte', K(GUT, { fallreferenz: 'T-\u00001' })], ['DEL', K(GUT, { fallreferenz: 'T-\u007f1' })], ['C1 (U+0085)', K(GUT, { fallreferenz: 'T-\u00851' })], ['U+2028', K(GUT, { fallreferenz: 'T-\u20281' })]];
    for (const [name, body] of refFaelle) {
      const r = await req('admin', 'POST', P(bF1), body);
      check('Fallreferenz ' + name + ': 400 widerruf_fallreferenz', r.s === 400 && r.d.fehler === 'widerruf_fallreferenz' && typeof r.d.text === 'string' && r.d.text !== 'widerruf_fallreferenz', JSON.stringify(r));
    }
    // Backlog c: Bestaetigung muss genau boolean true sein
    for (const [name, wert] of [['fehlt', undefined], ['false', false], ['Zeichenkette "true"', 'true'], ['Zahl 1', 1], ['null', null], ['Objekt', {}]]) {
      const body = K(GUT); if (wert === undefined) delete body.stripe_geprueft; else body.stripe_geprueft = wert;
      const r = await req('admin', 'POST', P(bF1), body);
      check('stripe_geprueft ' + name + ': 400 widerruf_stripe_geprueft', r.s === 400 && r.d.fehler === 'widerruf_stripe_geprueft' && typeof r.d.text === 'string' && r.d.text !== 'widerruf_stripe_geprueft', JSON.stringify(r));
    }
    check('Nach 400: nichts geaendert', zustand() === vorher && erledigtZahl() === 0 && logZahl() === 0);
    check('Datenbank-Sperre: Fallreferenz mit 2 Zeichen direkt eingefuegt -> CHECK-Fehler', (() => { try { db.prepare('INSERT INTO ellallas_erledigt (bestellung_id,zeit,admin_id,begruendung,fallreferenz,stripe_geprueft) VALUES (?,?,?,?,?,1)').run(bF2, jetzt, adminId, GUT, 'ab'); return false; } catch { return erledigtZahl() === 0; } })());
    check('Datenbank-Sperre: stripe_geprueft = 0 direkt eingefuegt -> CHECK-Fehler', (() => { try { db.prepare('INSERT INTO ellallas_erledigt (bestellung_id,zeit,admin_id,begruendung,fallreferenz,stripe_geprueft) VALUES (?,?,?,?,?,0)').run(bF2, jetzt, adminId, GUT, REF); return false; } catch { return erledigtZahl() === 0; } })());
    check('Datenbank-Sperre: Begruendung mit 4 Zeichen direkt eingefuegt -> CHECK-Fehler', (() => { try { db.prepare('INSERT INTO ellallas_erledigt VALUES (?,?,?,?)').run(bF2, jetzt, adminId, 'abcd'); return false; } catch { return erledigtZahl() === 0; } })());
  });

  await teil('B-404-409', async () => {
    const vorher = zustand();
    for (const [name, id] of [['unbekannte ID', 999999], ['Bestellung ohne Widerruf', bOhne], ['keine Zahl', 'abc'], ['Null', 0]]) {
      const r = await req('admin', 'POST', P(id), K(GUT));
      check(name + ': 404 nicht_gefunden', r.s === 404 && r.d.fehler === 'nicht_gefunden', JSON.stringify(r));
    }
    for (const [name, id, code] of [['bereits erstattet', bE, 'widerruf_nicht_offen'], ['abgelehnt (Frist)', bA, 'widerruf_nicht_offen'], ['abgelehnt (Zustimmung)', bZ, 'widerruf_nicht_offen'], ['Erstattung laeuft noch (bearbeitung)', bB, 'widerruf_laeuft_noch']]) {
      const r = await req('admin', 'POST', P(id), K(GUT));
      check(name + ': 409 ' + code, r.s === 409 && r.d.fehler === code, JSON.stringify(r));
    }
    check('Nach 404/409: nichts geaendert', zustand() === vorher && erledigtZahl() === 0 && logZahl() === 0);
  });

  await teil('B-Erfolg', async () => {
    const offenVor = await req('admin', 'GET', '/api/admin/widerrufe');
    const kzVor = (await req('admin', 'GET', '/api/admin/kennzahlen')).d.offen;
    const eVor = db.prepare('SELECT * FROM ellallas WHERE bestellung_id=?').get(bF1);
    const vorher = zustand();
    const stripeVor = stripeAufrufe.length;
    const r = await req('admin', 'POST', P(bF1), K('  ' + GUT + '  '));
    check('Admin: 200 mit bestellung_id, Zeitpunkt, Bearbeiter; ergebnis bleibt "fehler"', r.s === 200 && r.d.bestellung_id === bF1 && !Number.isNaN(Date.parse(r.d.erledigt_zeit)) && r.d.erledigt_admin_id === adminId && r.d.ergebnis === 'fehler', JSON.stringify(r));
    check('Stripe-Erstattungsstatus (ellallas-Zeile) Byte fuer Byte unveraendert', JSON.stringify(db.prepare('SELECT * FROM ellallas WHERE bestellung_id=?').get(bF1)) === JSON.stringify(eVor));
    check('Bestellungen und Zugaenge unveraendert (Kauf-/Zugangsstatus des Kunden bleibt)', zustand() === vorher);
    check('Kein einziger Stripe-Aufruf', stripeAufrufe.length === stripeVor, stripeAufrufe.slice(stripeVor).join(','));
    const x = db.prepare('SELECT * FROM ellallas_erledigt WHERE bestellung_id=?').get(bF1);
    check('Erledigung gespeichert: Zeit, Admin-ID, Begruendung (getrimmt)', x?.admin_id === adminId && x?.zeit === r.d.erledigt_zeit && x?.begruendung === GUT, JSON.stringify(x));
    check('Backlog c: Fallreferenz und Bestaetigung gespeichert (fallreferenz, stripe_geprueft = 1), Antwort nennt beides', x?.fallreferenz === REF && x?.stripe_geprueft === 1 && r.d.fallreferenz === REF && r.d.stripe_geprueft === true, JSON.stringify([x, r.d]));
    const log = db.prepare("SELECT * FROM verwaltung_log WHERE aktion='widerruf_erledigt'").all();
    check('Audit: genau ein Eintrag im Verwaltungsprotokoll (Admin, Bestellung, Kurs, Kunde, Zeit)', log.length === 1 && log[0].admin_id === adminId && log[0].bestellung_id === bF1 && log[0].kurs_id === kid && log[0].benutzer_id === kundeId && log[0].erstellt === r.d.erledigt_zeit, JSON.stringify(log));
    const offen = await req('admin', 'GET', '/api/admin/widerrufe');
    check('Offene Liste: abgeschlossener Widerruf verschwindet, alle anderen bleiben', offen.s === 200 && !offen.d.some((z) => z.bestellung_id === bF1) && offen.d.length === offenVor.d.length - 1 && offen.d.some((z) => z.bestellung_id === bB) && offen.d.some((z) => z.bestellung_id === bF2), JSON.stringify(offen.d.map((z) => z.bestellung_id)));
    const kz = (await req('admin', 'GET', '/api/admin/kennzahlen')).d.offen;
    check('Kennzahl "offen" sinkt um 1 (gleiche Bedingung wie die Liste)', kz === kzVor - 1 && kz === db.prepare("SELECT COUNT(*) n FROM bestellungen WHERE status='pruefen'").get().n + offen.d.length, JSON.stringify([kzVor, kz]));
    const erl = await req('admin', 'GET', '/api/admin/widerrufe/erledigt');
    const z = erl.d?.find?.((y) => y.bestellung_id === bF1) || {};
    check('Abgeschlossene Liste: Eintrag mit Zeit, Bearbeiter (E-Mail), Begruendung, Stripe-Status "fehler" getrennt', erl.s === 200 && erl.d.length === 1 && z.ergebnis === 'fehler' && z.erledigt_zeit === r.d.erledigt_zeit && z.erledigt_admin_email === 'admin-we@example.org' && z.erledigt_begruendung === GUT && z.erledigt_fallreferenz === REF && z.erledigt_stripe_geprueft === 1 && z.kurs_titel === 'Widerrufskurs' && z.benutzer_email === 'kunde-we@example.org', JSON.stringify(erl));
    check('Abgeschlossene Liste: unbekannter Parameter 400', (await req('admin', 'GET', '/api/admin/widerrufe/erledigt?alle=1')).s === 400);
    const konto = await req('kunde', 'GET', '/api/konto');
    const kb = konto.d.bestellungen?.find((y) => y.id === bF1);
    check('Kundenkonto: Bestellung weiter "bezahlt", Widerruf weiter "fehler" (keine Erstattung vorgetaeuscht)', konto.s === 200 && kb?.status === 'bezahlt' && kb?.ellallas_ergebnis === 'fehler', JSON.stringify(kb));
    check('Teil 2: Kundenkonto meldet erstattung_fehlgeschlagen = true fuer den abgeschlossenen Widerruf', kb?.erstattung_fehlgeschlagen === true, JSON.stringify(kb));
  });

  await teil('B-Doppelt', async () => {
    const vorher = zustand(), xVor = JSON.stringify(db.prepare('SELECT * FROM ellallas_erledigt WHERE bestellung_id=?').get(bF1));
    const r = await req('admin', 'POST', P(bF1), K('Zweiter Versuch'));
    check('Zweiter Aufruf: 409 widerruf_schon_erledigt', r.s === 409 && r.d.fehler === 'widerruf_schon_erledigt', JSON.stringify(r));
    const r2 = await req('admin2', 'POST', P(bF1), K('Anderer Admin'));
    check('Zweiter Admin: ebenfalls 409, Bearbeiter und Begruendung bleiben die ersten', r2.s === 409 && JSON.stringify(db.prepare('SELECT * FROM ellallas_erledigt WHERE bestellung_id=?').get(bF1)) === xVor);
    check('Kein zweiter Audit-Eintrag, nichts geaendert', logZahl() === 1 && zustand() === vorher);
    const [p1, p2, p3] = await Promise.all([1, 2, 3].map((i) => req(i === 2 ? 'admin2' : 'admin', 'POST', P(bF3), K('Parallel ' + i + ' ok'))));
    const codes = [p1.s, p2.s, p3.s].sort().join(',');
    check('Drei parallele Aufrufe: genau einer 200, zwei 409; ein Eintrag, ein Audit', codes === '200,409,409' && db.prepare('SELECT COUNT(*) n FROM ellallas_erledigt WHERE bestellung_id=?').get(bF3).n === 1 && db.prepare("SELECT COUNT(*) n FROM verwaltung_log WHERE aktion='widerruf_erledigt' AND bestellung_id=?").get(bF3).n === 1, codes);
    const lang = 'ü'.repeat(500);
    const l500 = await req('admin', 'POST', P(bLang), K(lang));
    check('Genau 500 Zeichen (Umlaute) erlaubt: 200, unveraendert gespeichert', l500.s === 200 && db.prepare('SELECT begruendung FROM ellallas_erledigt WHERE bestellung_id=?').get(bLang)?.begruendung === lang, JSON.stringify(l500.d).slice(0, 120));
    const r3 = await req('admin', 'POST', P(bR3), K(GUT, { fallreferenz: '  abc  ' }));
    check('Fallreferenz genau 3 Zeichen (nach Trim) erlaubt: 200, getrimmt gespeichert', r3.s === 200 && db.prepare('SELECT fallreferenz FROM ellallas_erledigt WHERE bestellung_id=?').get(bR3)?.fallreferenz === 'abc', JSON.stringify(r3.d));
    const ref100 = 'ű'.repeat(100);
    const r100 = await req('admin', 'POST', P(bR100), K(GUT, { fallreferenz: ref100 }));
    check('Fallreferenz genau 100 Zeichen (Umlaute) erlaubt: 200, unveraendert gespeichert', r100.s === 200 && db.prepare('SELECT fallreferenz FROM ellallas_erledigt WHERE bestellung_id=?').get(bR100)?.fallreferenz === ref100, JSON.stringify(r100.d).slice(0, 120));
  });

  await teil('B-HTML', async () => {
    const boese = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><b>fett</b> & Co';
    const r = await req('admin', 'POST', P(bHtml), K(boese));
    check('HTML-Begruendung: angenommen (200), als reiner Text unveraendert gespeichert', r.s === 200 && db.prepare('SELECT begruendung FROM ellallas_erledigt WHERE bestellung_id=?').get(bHtml)?.begruendung === boese, JSON.stringify(r));
    const erl = await req('admin', 'GET', '/api/admin/widerrufe/erledigt');
    check('API liefert JSON (application/json), Begruendung als Zeichenkette, kein HTML-Rendern', /application\/json/.test(erl.typ) && erl.d.find((y) => y.bestellung_id === bHtml)?.erledigt_begruendung === boese, erl.typ);
  });

  // ======================= Teil F: Kundenstatus bei fehlgeschlagener Erstattung (Teil 2) =======================
  await teil('F-Kundenstatus', async () => {
    const r = await req('admin', 'POST', P(bEF), K('Kunde informiert, Gutschrift steht noch aus.'));
    check('F Widerruf mit Bestellstatus "erstattet" + Erstattung "fehler": abgeschlossen (200)', r.s === 200, JSON.stringify(r));
    const konto = await req('kunde', 'GET', '/api/konto');
    const zu = (id) => konto.d.bestellungen?.find((y) => y.id === id);
    check('F erledigt + Bestellung "erstattet": erstattung_fehlgeschlagen = true (Konto zeigt nie "Erstattet")', zu(bEF)?.erstattung_fehlgeschlagen === true && zu(bEF)?.status === 'erstattet', JSON.stringify(zu(bEF)));
    check('F offener Widerruf mit Erstattung "fehler" (nicht erledigt): erstattung_fehlgeschlagen = true', zu(bF2)?.erstattung_fehlgeschlagen === true, JSON.stringify(zu(bF2)));
    check('F erfolgreich erstatteter Widerruf: erstattung_fehlgeschlagen = false', zu(bE)?.erstattung_fehlgeschlagen === false, JSON.stringify(zu(bE)));
    check('F Bestellung ohne Widerruf und laufende Erstattung: erstattung_fehlgeschlagen = false', zu(bOhne)?.erstattung_fehlgeschlagen === false && zu(bB)?.erstattung_fehlgeschlagen === false);
    // Jede manuell abgeschlossene Bestellung dieses Kunden: nie als erstattet anzeigbar
    const erledigte = db.prepare('SELECT bestellung_id FROM ellallas_erledigt').all().map((x) => x.bestellung_id);
    check('F alle ' + erledigte.length + ' manuell abgeschlossenen Widerrufe: erstattung_fehlgeschlagen = true', erledigte.length >= 5 && erledigte.every((id) => zu(id)?.erstattung_fehlgeschlagen === true), JSON.stringify(erledigte));
    const kundeJs = readFileSync(join(PLATTFORM, 'public', 'kunde.js'), 'utf8');
    check("F kunde.js: Status prueft erstattung_fehlgeschlagen VOR 'erstattet' und zeigt k_erstattung_fehlgeschlagen", /const status=b=>b\.erstattung_fehlgeschlagen===true\?t\('k_erstattung_fehlgeschlagen'\)\s*:b\.status==='erstattet'/.test(kundeJs));
    for (const l of SPRACHEN) check(`[${l}] F Text vorhanden: "${T[l].k_erstattung_fehlgeschlagen}"`, typeof T[l].k_erstattung_fehlgeschlagen === 'string' && T[l].k_erstattung_fehlgeschlagen !== T[l].k_fiokom_erstattet);
    check('F DE woertlich "Erstattung fehlgeschlagen – bitte kontaktiere den Anbieter"', T.de.k_erstattung_fehlgeschlagen === 'Erstattung fehlgeschlagen – bitte kontaktiere den Anbieter');
    check('F HU in Du-Form (kérlek, vedd fel)', T.hu.k_erstattung_fehlgeschlagen.includes('kérlek, vedd fel'));
    const ausk = await fetch(B + '/api/konto/auskunft', { headers: { Origin: B, Cookie: 'lang=de; sitzung=' + sitz.kunde } }).then((x) => x.text());
    check('F Datenauskunft: neues Feld mit ungarischem Schluessel (visszaterites_sikertelen), kein deutscher Rohschluessel', ausk.includes('"visszaterites_sikertelen"') && !ausk.includes('erstattung_fehlgeschlagen'));
  });

  // ======================= Teil C: Demo-Admin =======================
  await teil('C-Demo', async () => {
    const vorher = zustand(), nVor = erledigtZahl(), lVor = logZahl();
    demoServer = erstelleServer({ stripe, base: DB_, webhookSecret: 'x', mailer: async () => true, dateiOrdner: join(dir, 'dateien'),
      ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: true, trustProxy: 0 }).listen(DPORT, '127.0.0.1');
    await new Promise((r) => (demoServer.listening ? r() : demoServer.once('listening', r)));
    const dreq = anfrage(DB_);
    for (const pfad of [P(bF2), P(bF2).replace('/api/admin', '/api/Admin'), P(bF2) + '/', P(bF2).replace('/admin/', '/admin//')]) {
      const r = await dreq('demo', 'POST', pfad, K(GUT));
      check('Demo-Admin POST ' + pfad + ': 403 demo_nur_ansicht', r.s === 403 && r.d.fehler === 'demo_nur_ansicht', JSON.stringify(r));
    }
    const g = await dreq('demo', 'GET', '/api/admin/widerrufe/erledigt');
    check('Demo-Admin GET abgeschlossene Liste (E-Mail-Adressen): 403 demo_nur_ansicht', g.s === 403 && g.d.fehler === 'demo_nur_ansicht', JSON.stringify(g));
    check('Demo: nichts geaendert, kein Eintrag, kein Audit', zustand() === vorher && erledigtZahl() === nVor && logZahl() === lVor);
    await new Promise((r) => demoServer.close(r)); demoServer = null;
  });

  // ======================= Teil D: Browser (Admin-Seite, echte Oberflaeche) =======================
  await teil('D-Browser', async () => {
    const PW = process.env.PLAYWRIGHT_CORE || 'C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs';
    const CHROME = process.env.CHROME_PFAD || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    if (!existsSync(PW) || !existsSync(CHROME)) { uebersprungen++; console.log('UEBERSPRUNGEN Teil D (Browser): playwright-core oder Chrome fehlt'); return; }
    const { chromium } = await import(pathToFileURL(PW).href);
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
      for (const l of SPRACHEN) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: l });
        await ctx.addCookies([{ name: 'lang', value: l, url: B }, { name: 'sitzung', value: sitz.admin, url: B }]);
        const p = await ctx.newPage();
        const dialoge = []; p.on('dialog', (d) => { dialoge.push(d.message()); void d.dismiss(); });
        await p.goto(B + '/admin/', { waitUntil: 'load' });
        await p.waitForSelector('.kurskarte', { timeout: 8000 });
        await p.waitForFunction((s) => document.body.innerText.includes(s), T[l].a_widerruf_laeuft_hinweis, { timeout: 5000 }).catch(() => {});
        const id = bBrowser[l];
        const zeile = p.locator('article.lecke', { hasText: T[l].mail_kauf_nummer + ': ' + id + ' ' });
        check(`[${l}] D offene Liste zeigt Widerruf ${id} mit Knopf "${T[l].a_widerruf_erledigen}"`, (await zeile.count()) === 1 && (await zeile.locator('.widerruf-aktion > button').textContent()) === T[l].a_widerruf_erledigen);
        const offenText = await p.locator('section.karte', { hasText: T[l].a_widerruf_cim }).innerText();
        check(`[${l}] D laufende Erstattung (bearbeitung): kein Knopf, Hinweis "${T[l].a_widerruf_laeuft_hinweis.slice(0, 30)}..."`, offenText.includes(T[l].a_widerruf_laeuft_hinweis));
        check(`[${l}] D abgeschlossene Widerrufe (${bF1}) stehen NICHT in der offenen Liste`, !offenText.includes(T[l].mail_kauf_nummer + ': ' + bF1 + ' '));
        const knopf = zeile.locator('.widerruf-aktion > button');
        check(`[${l}] D Knopf aria-expanded=false vor dem Oeffnen`, (await knopf.getAttribute('aria-expanded')) === 'false');
        await knopf.click();
        const feld = zeile.getByLabel(T[l].a_widerruf_begruendung);
        check(`[${l}] D Begruendungsfeld per Label erreichbar, fokussiert, Pflichtfeld, aria-expanded=true`, (await feld.count()) === 1 && await feld.evaluate((e) => e === document.activeElement && e.required && e.maxLength === 500) && (await knopf.getAttribute('aria-expanded')) === 'true');
        await feld.fill('kurz');
        await zeile.locator('form button[type=submit]').click();
        await p.waitForTimeout(200);
        const fehlerZeile = await zeile.locator('[role=alert]').innerText();
        check(`[${l}] D zu kurze Begruendung: Hinweis "${T[l].a_widerruf_begruendung_laenge}", aria-invalid, kein Dialog, nichts gespeichert`,
          fehlerZeile === T[l].a_widerruf_begruendung_laenge && (await feld.getAttribute('aria-invalid')) === 'true' && (await p.locator('[role=alertdialog]').count()) === 0 && !db.prepare('SELECT 1 FROM ellallas_erledigt WHERE bestellung_id=?').get(id), fehlerZeile);
        const grund = '<img src=x onerror="window.__xss=1">Browser ' + l + ' Grund';
        await feld.fill(grund);
        // Backlog c: ohne Fallreferenz -> Hinweis, kein Dialog
        const refFeld = zeile.getByLabel(T[l].a_widerruf_fallreferenz);
        const haken = zeile.getByLabel(T[l].a_widerruf_stripe_geprueft);
        check(`[${l}] D Fallreferenz-Feld und Checkbox per Label erreichbar (Pflicht, maxlength 100)`, (await refFeld.count()) === 1 && (await haken.count()) === 1
          && await refFeld.evaluate((e) => e.required && e.maxLength === 100) && await haken.evaluate((e) => e.type === 'checkbox' && e.required && !e.checked));
        await refFeld.fill('ab');
        await zeile.locator('form button[type=submit]').click();
        await p.waitForTimeout(200);
        check(`[${l}] D Fallreferenz zu kurz: Hinweis "${T[l].a_widerruf_fallreferenz_laenge.slice(0, 40)}...", aria-invalid, Fokus im Feld, kein Dialog`,
          (await zeile.locator('[role=alert]').innerText()) === T[l].a_widerruf_fallreferenz_laenge && (await refFeld.getAttribute('aria-invalid')) === 'true'
          && await refFeld.evaluate((e) => e === document.activeElement) && (await p.locator('[role=alertdialog]').count()) === 0);
        await refFeld.fill('Ticket ' + l.toUpperCase() + '-42');
        await zeile.locator('form button[type=submit]').click();
        await p.waitForTimeout(200);
        check(`[${l}] D Checkbox nicht gesetzt: Hinweis "${T[l].a_widerruf_stripe_geprueft_pflicht.slice(0, 40)}...", kein Dialog, nichts gespeichert`,
          (await zeile.locator('[role=alert]').innerText()) === T[l].a_widerruf_stripe_geprueft_pflicht && (await p.locator('[role=alertdialog]').count()) === 0 && !db.prepare('SELECT 1 FROM ellallas_erledigt WHERE bestellung_id=?').get(id));
        await haken.check();
        await zeile.locator('form button[type=submit]').click();
        const dlg = p.locator('[role=alertdialog]');
        await dlg.waitFor({ timeout: 3000 });
        check(`[${l}] D Bestaetigung "${T[l].a_widerruf_erledigen_frage.slice(0, 40)}..." erscheint, Fokus auf "${T[l].a_igen}"`, (await dlg.innerText()).includes(T[l].a_widerruf_erledigen_frage) && await p.evaluate(() => document.activeElement?.closest('[role=alertdialog]') !== null));
        await dlg.getByRole('button', { name: T[l].a_igen }).click();
        await p.waitForFunction((s) => document.querySelector('.meldung')?.innerText === s, T[l].a_widerruf_erledigt_ok, { timeout: 5000 }).catch(() => {});
        const gesp = db.prepare('SELECT begruendung, fallreferenz, stripe_geprueft FROM ellallas_erledigt WHERE bestellung_id=?').get(id);
        check(`[${l}] D Meldung "${T[l].a_widerruf_erledigt_ok}" und Eintrag gespeichert (mit Fallreferenz und Bestaetigung)`, (await p.locator('.meldung').first().innerText()) === T[l].a_widerruf_erledigt_ok && gesp?.begruendung === grund && gesp?.fallreferenz === 'Ticket ' + l.toUpperCase() + '-42' && gesp?.stripe_geprueft === 1, JSON.stringify(gesp));
        await p.waitForTimeout(400);
        const offen2 = await p.locator('section.karte', { hasText: T[l].a_widerruf_cim }).innerText();
        check(`[${l}] D nach dem Abschluss: nicht mehr in "${T[l].a_widerruf_cim}"`, !offen2.includes(T[l].mail_kauf_nummer + ': ' + id + ' '));
        const det = p.locator('details.widerruf-erledigt');
        await det.locator('summary').click();
        const eintrag = det.locator('article.lecke', { hasText: T[l].mail_kauf_nummer + ': ' + id + ' ' });
        const et = await eintrag.textContent();   // textContent: Plakette ist per CSS in Grossbuchstaben
        check(`[${l}] D "${T[l].a_widerruf_erledigte_cim}": Label "${T[l].a_widerruf_erledigt_label}", Stripe "${T[l].a_widerruf_stripe_fehler}", Bearbeiter, Begruendung als Text`,
          et.includes(T[l].a_widerruf_erledigt_label) && et.includes(T[l].a_widerruf_stripe_status + ': ' + T[l].a_widerruf_stripe_fehler) && et.includes('admin-we@example.org') && et.includes(grund)
          && et.includes(T[l].a_widerruf_fallreferenz_kurz + ': Ticket ' + l.toUpperCase() + '-42'), et.slice(0, 400));
        check(`[${l}] D HTML der Begruendung NICHT ausgefuehrt (kein img im Eintrag, window.__xss leer, kein Dialog)`, (await eintrag.locator('img').count()) === 0 && await p.evaluate(() => window.__xss === undefined) && dialoge.length === 0);
        check(`[${l}] D Erledigung nie als Erstattung dargestellt: kein Text "${T[l].ellallas_inhaber_erstattung || T[l].ellallas_erstattung}" im Eintrag`, ![T[l].ellallas_inhaber_erstattung, T[l].ellallas_erstattung].filter(Boolean).some((s) => et.includes(s)));
        await ctx.close();
      }
      // Teil 2 im echten Kundenkonto: abgeschlossener Widerruf (bF1) und "erstattet"+fehler (bEF) zeigen den neuen Text, nie "Erstattet".
      for (const l of SPRACHEN) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: l });
        await ctx.addCookies([{ name: 'lang', value: l, url: B }, { name: 'sitzung', value: sitz.kunde, url: B }]);
        const p = await ctx.newPage();
        await p.goto(B + '/#/fiokom', { waitUntil: 'load' });
        await p.waitForSelector('article.konto-bestellung', { timeout: 8000 });
        for (const id of [bF1, bEF]) {
          const art = p.locator('article.konto-bestellung', { has: p.locator('h3', { hasText: new RegExp(': ' + id + '$') }) });
          const tx = (await art.count()) === 1 ? await art.innerText() : '';
          check(`[${l}] D Kundenkonto Bestellung ${id}: "${T[l].k_fiokom_status}: ${T[l].k_erstattung_fehlgeschlagen}", kein "${T[l].k_fiokom_erstattet}"`,
            tx.includes(T[l].k_fiokom_status + ': ' + T[l].k_erstattung_fehlgeschlagen) && !tx.includes(T[l].k_fiokom_status + ': ' + T[l].k_fiokom_erstattet), tx.slice(0, 300));
        }
        await ctx.close();
      }
    } finally { await browser.close(); }
  });

  // ======================= Teil E: Migration wiederholbar =======================
  await teil('E-Migration', async () => {
    await new Promise((r) => server.close(r)); server = null;
    const vor = db.prepare('SELECT * FROM ellallas_erledigt ORDER BY bestellung_id').all();
    const skript = "const {db}=await import(process.argv[1]);console.log(JSON.stringify({n:db.prepare('SELECT COUNT(*) n FROM ellallas_erledigt').get().n,sql:db.prepare(\"SELECT sql FROM sqlite_master WHERE name='ellallas_erledigt'\").get()?.sql||''}))";
    const lauf = () => JSON.parse(execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', skript, pathToFileURL(join(PLATTFORM, 'db.mjs')).href], { env: { ...process.env }, encoding: 'utf8' }).trim().split('\n').pop());
    const a = lauf(), b = lauf();
    check('db.mjs zweimal auf bestehender Datenbank: Tabelle bleibt, Zeilen unveraendert', a.n === vor.length && b.n === vor.length && a.sql === b.sql && /CHECK\(length\(trim\(begruendung\)\) BETWEEN 5 AND 500\)/.test(a.sql), JSON.stringify([a, b, vor.length]));
    check('Backlog c: Spalten fallreferenz/stripe_geprueft mit CHECK vorhanden', /fallreferenz TEXT CHECK\(fallreferenz IS NULL OR length\(trim\(fallreferenz\)\) BETWEEN 3 AND 100\)/.test(a.sql) && /stripe_geprueft INTEGER CHECK\(stripe_geprueft IS NULL OR stripe_geprueft = 1\)/.test(a.sql), a.sql);
    // Alte Datenbank (Tabelle von vor Backlog c, mit einer Erledigung): Migration ergaenzt die Spalten, die alte Zeile bleibt (NULL), zweiter Lauf aendert nichts.
    const alt = join(dir, 'alt.db');
    const { DatabaseSync } = await import('node:sqlite');
    const adb = new DatabaseSync(alt);
    adb.exec("CREATE TABLE ellallas_erledigt (bestellung_id INTEGER PRIMARY KEY, zeit TEXT NOT NULL, admin_id INTEGER NOT NULL, begruendung TEXT NOT NULL CHECK(length(trim(begruendung)) BETWEEN 5 AND 500)); INSERT INTO ellallas_erledigt VALUES (7,'2026-11-12T10:00:00.000Z',1,'Alte Erledigung ohne Referenz');");
    adb.close();
    const skript2 = "const {db}=await import(process.argv[1]);console.log(JSON.stringify({sp:db.prepare('PRAGMA table_info(ellallas_erledigt)').all().map(x=>x.name),z:db.prepare('SELECT * FROM ellallas_erledigt').all()}))";
    const lauf2 = () => JSON.parse(execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', skript2, pathToFileURL(join(PLATTFORM, 'db.mjs')).href], { env: { ...process.env, DB_DATEI: alt }, encoding: 'utf8' }).trim().split('\n').pop());
    const m1 = lauf2(), m2 = lauf2();
    check('Migration alte Tabelle: Spalten ergaenzt, alte Zeile erhalten (fallreferenz/stripe_geprueft NULL), zweiter Lauf identisch',
      m1.sp.includes('fallreferenz') && m1.sp.includes('stripe_geprueft') && m1.z.length === 1 && m1.z[0].begruendung === 'Alte Erledigung ohne Referenz' && m1.z[0].fallreferenz === null && m1.z[0].stripe_geprueft === null
      && JSON.stringify(m1) === JSON.stringify(m2), JSON.stringify([m1, m2]));
  });
} catch (e) {
  check('Testablauf', false, e.stack || e.message);
} finally {
  server?.close(); demoServer?.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows: Datei evtl. noch gesperrt */ }
}
console.log(`\nWiderruf erledigt: ${ok} bestanden, ${fail} fehlgeschlagen` + (uebersprungen ? ', Teil D uebersprungen' : ''));
process.exit(fail ? 1 : 0);
