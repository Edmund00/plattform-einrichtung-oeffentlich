import './test-sprache.mjs';
// Refund-Failed (12.11.2026, ChatGPT Prioritaet 1): "Niemals Erstattet bei fehlgeschlagener Erstattung anzeigen".
// Stripe meldet eine Erstattung nachtraeglich als fehlgeschlagen/abgebrochen (refund.failed, refund.updated, charge.refund.updated). Die Bestellung wird ueber
// bestellungen.zahlung_id = payment_intent gefunden und in erstattung_fehler vermerkt. Geprueft: Kundenkonto zeigt "Erstattung fehlgeschlagen" statt "Erstattet"
// (voll, Teilerstattung, Abo), Doppelereignisse idempotent, unbekannte Zahlung ohne Ausnahme, spaeteres "succeeded" fuer dieselbe Erstattung loest (nur wenn neuer),
// neue erfolgreiche Ersatzerstattung loest (nur wenn ausreichend), Admin-Liste/Kennzahl "offen", Abschluss "ohne Erstattung" bleibt unberuehrt, Datenauskunft,
// Migration wiederholbar, Browser (Kundenkonto und Admin-Seite in de/en/hu).
// Aufruf (im Ordner plattform): node --disable-warning=ExperimentalWarning tools/selbsttest-refund-failed.mjs
// Offline: Temp-Datenbank, Stripe-Attrappe, eigener Server auf Port 5181, kein Netz.
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const PLATTFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'schulung-refund-failed-'));
process.env.DB_DATEI = join(dir, 'test.db');
let ok = 0, fail = 0, uebersprungen = 0, server;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' | ' + String(d).slice(0, 300))); };
const teil = async (name, fn) => { try { await fn(); } catch (e) { check('Teil ' + name + ' lief durch', false, e.stack || e.message); } };
const SPRACHEN = ['de', 'en', 'hu'];
const T = Object.fromEntries(SPRACHEN.map((l) => [l, JSON.parse(readFileSync(join(PLATTFORM, 'texte', l + '.json'), 'utf8'))]));
const NEU = ['a_erstattung_stripe_fehler', 'a_erstattung_stripe_hinweis', 'a_erstattung_stripe_referenz',
  'auskunft_wert_fehlgeschlagen', 'auskunft_wert_abgebrochen', 'auskunft_wert_erfolgreich', 'auskunft_wert_ersetzt'];
const PORT = 5181, B = 'http://127.0.0.1:' + PORT;
try {
  // ======================= Teil A: Texte und Oberflaechen-Code =======================
  await teil('A-Texte', async () => {
    for (const l of SPRACHEN) {
      const fehlt = NEU.filter((k) => typeof T[l][k] !== 'string' || T[l][k].trim().length < 3);
      check(`[${l}] alle ${NEU.length} neuen Texte vorhanden`, fehlt.length === 0, fehlt.join(','));
      check(`[${l}] Admin-Status nennt Stripe und ist kein "Erstattet"-Text`, /Stripe/.test(T[l].a_erstattung_stripe_fehler) && T[l].a_erstattung_stripe_fehler !== T[l].k_fiokom_erstattet && T[l].a_erstattung_stripe_fehler !== T[l].auskunft_wert_erstattet);
    }
    check('Gleiche Schluessel in de/en/hu', JSON.stringify(Object.keys(T.de).sort()) === JSON.stringify(Object.keys(T.en).sort()) && JSON.stringify(Object.keys(T.de).sort()) === JSON.stringify(Object.keys(T.hu).sort()));
    check('HU in Du-Form (Kérlek, indítsd ... egyeztess)', T.hu.a_erstattung_stripe_hinweis.includes('Kérlek, indítsd') && T.hu.a_erstattung_stripe_hinweis.includes('egyeztess'));
    check('DE in Du-Form (Bitte löse ... kläre)', T.de.a_erstattung_stripe_hinweis.startsWith('Bitte löse') && T.de.a_erstattung_stripe_hinweis.includes('kläre'));
    const adminJs = readFileSync(join(PLATTFORM, 'public', 'admin', 'admin.js'), 'utf8');
    check('admin.js: Status stripe_refund_failed -> a_erstattung_stripe_fehler, Hinweis und Referenz benutzt', adminJs.includes("stripe_refund_failed: 'a_erstattung_stripe_fehler'") && adminJs.includes("t('a_erstattung_stripe_hinweis')") && adminJs.includes("t('a_erstattung_stripe_referenz')"));
    check("admin.js: Abschluss-Formular nur bei ergebnis 'fehler' (nicht bei stripe_refund_failed)", /x\.ergebnis === 'fehler' \? widerrufErledigenFormular\(x\)\s*: x\.ergebnis === 'stripe_refund_failed' \?/.test(adminJs));
  });

  // ======================= Teil B: Server und Webhook =======================
  const { db } = await import('../db.mjs');
  const { sitzungErzeugen, stepupErzeugen } = await import('../auth.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const stripeAufrufe = [];
  const zaehl = (name, wert) => async (...a) => { stripeAufrufe.push(name); return typeof wert === 'function' ? wert(...a) : wert; };
  const stripe = { customers: { create: zaehl('customers.create', { id: 'cus_rf' }), update: zaehl('customers.update', {}) },
    checkout: { sessions: { create: zaehl('checkout.create', { id: 'cs_rf', url: 'https://checkout.stripe.com/test' }), retrieve: zaehl('checkout.retrieve', {}), list: zaehl('checkout.list', { data: [] }), expire: zaehl('checkout.expire', {}) } },
    paymentIntents: { retrieve: zaehl('pi.retrieve', (id) => ({ id })) }, refunds: { create: zaehl('refunds.create', { id: 're_rfcreate' }), list: zaehl('refunds.list', { data: [], has_more: false }) },
    invoices: { retrieve: zaehl('invoices.retrieve', {}), list: zaehl('invoices.list', { data: [] }) }, invoicePayments: { list: zaehl('invoicePayments.list', { data: [] }) },
    subscriptions: { list: zaehl('subscriptions.list', { data: [] }), cancel: zaehl('subscriptions.cancel', {}), retrieve: zaehl('subscriptions.retrieve', {}) },
    billingPortal: { sessions: { create: zaehl('portal.create', { url: 'https://billing.stripe.com/test' }) } },
    webhooks: { constructEvent: (raw) => JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)) } };
  const jetzt = new Date().toISOString();
  const nutzer = (email, rolle) => Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt,rolle,sprache) VALUES(?,?,?,?,?,'de')").run(email, 'nur-fuer-selbsttest', jetzt, Date.now(), rolle).lastInsertRowid);
  const adminId = nutzer('admin-rf@example.org', 'admin'), kundeId = nutzer('kunde-rf@example.org', 'kunde');
  const kid = Number(db.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES ('Erstattungskurs','x',1999,'eur','veroeffentlicht',?,?)").run(jetzt, jetzt).lastInsertRowid);
  let nr = 0;
  const bestellung = (status, grund = null, art = 'einmal') => { nr++; return Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,grund,art,erstellt,geaendert) VALUES(?,?,?,?,1999,'eur',?,?,?,?,?)").run('cs_rf' + nr, 'pi_rf' + nr, kundeId, kid, status, grund, art, jetzt, jetzt).lastInsertRowid); };
  const pi = (id) => db.prepare('SELECT zahlung_id FROM bestellungen WHERE id=?').get(id).zahlung_id;
  const bVoll = bestellung('erstattet', 'erstattung_voll'), bTeil = bestellung('bezahlt', 'teilerstattung'), bAbo = bestellung('erstattet', 'erstattung_voll', 'abo');
  const bLoes = bestellung('erstattet', 'erstattung_voll'), bAlt = bestellung('erstattet', 'erstattung_voll'), bErs = bestellung('erstattet', 'erstattung_voll');
  const bErsTeil = bestellung('erstattet', 'erstattung_voll'), bOk = bestellung('erstattet', 'erstattung_voll'), bWid = bestellung('erstattet', 'erstattung_voll');
  const bGleich = bestellung('erstattet', 'erstattung_voll'), bBrowser = bestellung('erstattet', 'erstattung_voll');
  db.prepare("INSERT INTO ellallas(bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES(?,?,'erstattung',NULL,?)").run(bWid, jetzt, jetzt);
  server = erstelleServer({ stripe, base: B, webhookSecret: 'x', mailer: async () => true, dateiOrdner: join(dir, 'dateien'),
    ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: false, trustProxy: 0 }).listen(PORT, '127.0.0.1');
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const sitz = { admin: sitzungErzeugen(adminId), kunde: sitzungErzeugen(kundeId) };
  stepupErzeugen(sitz.admin);
  const req = async (wer, methode, pfad, body) => {
    const headers = { Origin: B, Cookie: 'lang=de' + (wer ? '; sitzung=' + sitz[wer] : '') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(B + pfad, { method: methode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let d = {}; try { d = JSON.parse(text); } catch { /* kein JSON */ }
    return { s: r.status, d, text };
  };
  let evt = 0;
  const T0 = Math.floor(Date.now() / 1000) - 10000;
  const webhook = async (type, object, created, id = 'evt_rf_' + (++evt)) => {
    const r = await fetch(B + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 'mock' }, body: JSON.stringify({ id, type, created, livemode: false, data: { object } }) });
    const d = await r.json().catch(() => ({}));
    await new Promise((x) => setTimeout(x, 15));
    return { s: r.status, d, id };
  };
  const refund = (id, bestId, status = 'failed', amount = 1999, extra = {}) => ({ id, object: 'refund', payment_intent: bestId === null ? 'pi_unbekannt_rf' : pi(bestId), status, amount, currency: 'eur', ...extra });
  const konto = async () => (await req('kunde', 'GET', '/api/konto')).d.bestellungen || [];
  const flag = async (id) => (await konto()).find((x) => x.id === id);
  const zeile = (rid) => db.prepare('SELECT * FROM erstattung_fehler WHERE refund_id=?').get(rid);
  const meld = () => db.prepare("SELECT COUNT(*) n FROM ereignisse WHERE typ='gekauft' AND status='erstattung_fehlgeschlagen'").get().n;
  const offenListe = async () => (await req('admin', 'GET', '/api/admin/widerrufe')).d;
  const kz = async () => (await req('admin', 'GET', '/api/admin/kennzahlen')).d.offen;

  await teil('B-Voll', async () => {
    const vor = await flag(bVoll);
    check('Vorbedingung: voll erstattete Bestellung zeigt erstattet, kein Fehler', vor?.status === 'erstattet' && vor?.erstattung_fehlgeschlagen === false, JSON.stringify(vor));
    const m0 = meld(), kz0 = await kz();
    const r = await webhook('refund.failed', refund('re_rf_voll', bVoll), T0 + 100);
    const z = zeile('re_rf_voll'), nach = await flag(bVoll);
    check('refund.failed zu voll erstatteter Bestellung: 200, Eintrag offen (Bestellnummer, Betrag, Waehrung, Ereigniszeit)', r.s === 200 && z?.bestellung_id === bVoll && z?.status === 'fehlgeschlagen' && z?.betrag === 1999 && z?.waehrung === 'eur' && z?.ereignis_zeit === T0 + 100 && z?.geloest === null, JSON.stringify([r, z]));
    check('Konto: erstattung_fehlgeschlagen = true (Anzeige nie "Erstattet")', nach?.erstattung_fehlgeschlagen === true, JSON.stringify(nach));
    check('Meldung an die Inhaberin genau einmal', meld() === m0 + 1, meld() - m0);
    check('Kennzahl "offen" +1', (await kz()) === kz0 + 1);
    const l = await offenListe();
    const lz = l.find((x) => x.refund_id === 're_rf_voll');
    check('Admin-Liste: Zeile mit quelle/ergebnis stripe_refund_failed, Bestellnummer, Refund-ID, Betrag, Kurs, E-Mail', lz?.quelle === 'stripe_refund_failed' && lz?.ergebnis === 'stripe_refund_failed' && lz?.bestellung_id === bVoll && lz?.betrag === 1999 && lz?.waehrung === 'eur' && lz?.kurs_titel === 'Erstattungskurs' && lz?.benutzer_email === 'kunde-rf@example.org', JSON.stringify(lz));
    check('Kennzahl "offen" = Pruefen + Laenge der offenen Liste', (await kz()) === db.prepare("SELECT COUNT(*) n FROM bestellungen WHERE status='pruefen'").get().n + l.length);
  });

  await teil('B-Doppelt', async () => {
    const m0 = meld(), z0 = JSON.stringify(zeile('re_rf_voll')), n0 = db.prepare('SELECT COUNT(*) n FROM erstattung_fehler').get().n;
    const d1 = await webhook('refund.failed', refund('re_rf_voll', bVoll), T0 + 100, 'evt_rf_1');
    check('Gleiches Ereignis (gleiche ID) zweimal: 200 doppelt', d1.s === 200 && d1.d.doppelt === true, JSON.stringify(d1));
    await webhook('refund.updated', refund('re_rf_voll', bVoll), T0 + 100);
    await webhook('charge.refund.updated', refund('re_rf_voll', bVoll), T0 + 101);
    check('refund.failed + refund.updated + charge.refund.updated zum selben Fehler: genau eine Zeile, Zeile unveraendert, keine zweite Meldung',
      db.prepare('SELECT COUNT(*) n FROM erstattung_fehler').get().n === n0 && JSON.stringify(zeile('re_rf_voll')) === z0 && meld() === m0, JSON.stringify([zeile('re_rf_voll'), meld() - m0]));
    check('Admin-Liste: die Erstattung steht genau einmal drin', (await offenListe()).filter((x) => x.refund_id === 're_rf_voll').length === 1);
  });

  await teil('B-Teil-Abo-Abgebrochen', async () => {
    const kz0 = await kz();
    await webhook('refund.failed', refund('re_rf_teil', bTeil, 'failed', 500), T0 + 200);
    const t = await flag(bTeil);
    check('Teilerstattung fehlgeschlagen: Bestellung bleibt "bezahlt", Konto meldet erstattung_fehlgeschlagen = true', t?.status === 'bezahlt' && t?.erstattung_fehlgeschlagen === true && zeile('re_rf_teil')?.betrag === 500, JSON.stringify(t));
    await webhook('charge.refund.updated', refund('re_rf_abo', bAbo, 'canceled'), T0 + 210);
    const a = await flag(bAbo);
    check('Abo-Erstattung abgebrochen (charge.refund.updated, canceled): Eintrag "abgebrochen", Konto true', zeile('re_rf_abo')?.status === 'abgebrochen' && a?.erstattung_fehlgeschlagen === true, JSON.stringify([zeile('re_rf_abo'), a]));
    check('Kennzahl "offen" +2', (await kz()) === kz0 + 2);
    await webhook('refund.updated', refund('re_rf_pend', bOk, 'pending'), T0 + 220);
    check('refund.updated mit Status pending: kein Eintrag, Konto unveraendert', !zeile('re_rf_pend') && (await flag(bOk))?.erstattung_fehlgeschlagen === false);
  });

  await teil('B-Unbekannt', async () => {
    const m0 = meld(), n0 = db.prepare('SELECT COUNT(*) n FROM erstattung_fehler').get().n;
    const r1 = await webhook('refund.failed', refund('re_rf_fremd', null), T0 + 300);
    const r2 = await webhook('refund.failed', { id: 're_rf_ohnepi', object: 'refund', status: 'failed', amount: 100, currency: 'eur' }, T0 + 301);
    const r3 = await webhook('refund.failed', { id: 'kaputt', object: 'refund', status: 'failed', payment_intent: pi(bOk) }, T0 + 302);
    const r4 = await webhook('refund.failed', null, T0 + 303);
    check('Unbekannte Zahlung / ohne payment_intent / kaputte ID / ohne Objekt: jeweils 200, keine Ausnahme', [r1, r2, r3, r4].every((x) => x.s === 200), JSON.stringify([r1, r2, r3, r4].map((x) => x.s)));
    check('Kein Eintrag in erstattung_fehler, aber Meldung fuer die zwei gueltigen Erstattungen', db.prepare('SELECT COUNT(*) n FROM erstattung_fehler').get().n === n0 && meld() === m0 + 2, JSON.stringify([db.prepare('SELECT COUNT(*) n FROM erstattung_fehler').get().n - n0, meld() - m0]));
    check('Bestellung bOk bleibt ohne Fehler', (await flag(bOk))?.erstattung_fehlgeschlagen === false);
  });

  await teil('B-Succeeded', async () => {
    await webhook('refund.failed', refund('re_rf_loes', bLoes), T0 + 400);
    check('Vorbedingung: Fehler offen', (await flag(bLoes))?.erstattung_fehlgeschlagen === true);
    await webhook('refund.updated', refund('re_rf_loes', bLoes, 'succeeded'), T0 + 399);
    check('ALTES refund.updated succeeded (frueher als der Fehler, verspaetet zugestellt): Fehler bleibt offen', zeile('re_rf_loes')?.status === 'fehlgeschlagen' && (await flag(bLoes))?.erstattung_fehlgeschlagen === true, JSON.stringify(zeile('re_rf_loes')));
    const kz0 = await kz();
    await webhook('refund.updated', refund('re_rf_loes', bLoes, 'succeeded'), T0 + 450);
    const z = zeile('re_rf_loes');
    check('NEUERES refund.updated succeeded fuer dieselbe Erstattung: Eintrag "erfolgreich" mit Zeitpunkt, Konto false, aus Liste/Kennzahl raus',
      z?.status === 'erfolgreich' && !!z?.geloest && (await flag(bLoes))?.erstattung_fehlgeschlagen === false && !(await offenListe()).some((x) => x.refund_id === 're_rf_loes') && (await kz()) === kz0 - 1, JSON.stringify(z));
    await webhook('refund.failed', refund('re_rf_loes', bLoes), T0 + 420);
    check('Verspaetetes ALTES Fehlerereignis nach der Loesung: bleibt geloest', zeile('re_rf_loes')?.status === 'erfolgreich');
    await webhook('refund.updated', refund('re_rf_loes', bLoes), T0 + 500);
    check('NEUERES Fehlerereignis (succeeded -> failed, Bank weist zurueck): wieder offen, Konto true', zeile('re_rf_loes')?.status === 'fehlgeschlagen' && zeile('re_rf_loes')?.geloest === null && (await flag(bLoes))?.erstattung_fehlgeschlagen === true);
    await webhook('refund.updated', refund('re_rf_gl', bGleich, 'succeeded'), T0 + 600);
    check('succeeded ohne vorherigen Fehler: kein Eintrag', !zeile('re_rf_gl'));
    await webhook('refund.failed', refund('re_rf_gl', bGleich), T0 + 600);
    await webhook('refund.updated', refund('re_rf_gl', bGleich, 'succeeded'), T0 + 600);
    check('Gleichstand der Ereigniszeit (failed und succeeded in derselben Sekunde): Fehler gewinnt', zeile('re_rf_gl')?.status === 'fehlgeschlagen' && (await flag(bGleich))?.erstattung_fehlgeschlagen === true);
    await webhook('refund.updated', refund('re_rf_alt', bAlt, 'succeeded'), T0 + 650);
    await webhook('refund.failed', refund('re_rf_alt', bAlt), T0 + 700);
    check('succeeded vor failed (normale Reihenfolge, Gutschrift spaeter zurueckgewiesen): Fehler offen', zeile('re_rf_alt')?.status === 'fehlgeschlagen' && (await flag(bAlt))?.erstattung_fehlgeschlagen === true);
  });

  await teil('B-Ersatz', async () => {
    await webhook('refund.failed', refund('re_rf_ers_alt', bErs), T0 + 800);
    await webhook('refund.failed', refund('re_rf_et_alt', bErsTeil), T0 + 800);
    const charge = (bestId, refunds) => ({ id: 'ch_' + pi(bestId), object: 'charge', payment_intent: pi(bestId), amount: 1999, amount_refunded: 1999, refunded: true, currency: 'eur', refunds: { data: refunds, has_more: false } });
    const r1 = await webhook('charge.refunded', charge(bErsTeil, [{ id: 're_rf_et_alt', status: 'failed', amount: 1999 }, { id: 're_rf_et_neu', status: 'succeeded', amount: 1000 }]), T0 + 900);
    check('Ersatzerstattung KLEINER als der Fehlbetrag (1000 < 1999): Fehler bleibt offen', r1.s === 200 && zeile('re_rf_et_alt')?.status === 'fehlgeschlagen' && (await flag(bErsTeil))?.erstattung_fehlgeschlagen === true, JSON.stringify([r1, zeile('re_rf_et_alt')]));
    const r2 = await webhook('charge.refunded', charge(bErs, [{ id: 're_rf_ers_alt', status: 'succeeded', amount: 1999 }]), T0 + 900);
    check('charge.refunded nennt NUR die fehlgeschlagene Erstattung selbst (alter Stand "succeeded"): kein Ersatz, Fehler offen', r2.s === 200 && zeile('re_rf_ers_alt')?.status === 'fehlgeschlagen');
    const r3 = await webhook('charge.refunded', charge(bErs, [{ id: 're_rf_ers_alt', status: 'failed', amount: 1999 }, { id: 're_rf_ers_neu', status: 'succeeded', amount: 1999 }]), T0 + 950);
    const z = zeile('re_rf_ers_alt');
    check('Neue erfolgreiche Ersatzerstattung in voller Hoehe: Eintrag "ersetzt", Konto false, nicht mehr in der Liste', r3.s === 200 && z?.status === 'ersetzt' && !!z?.geloest && (await flag(bErs))?.erstattung_fehlgeschlagen === false && !(await offenListe()).some((x) => x.refund_id === 're_rf_ers_alt'), JSON.stringify(z));
    await webhook('refund.updated', refund('re_rf_ers_alt', bErs), T0 + 801);
    check('Verspaetetes altes Fehlerereignis nach dem Ersatz: bleibt ersetzt', zeile('re_rf_ers_alt')?.status === 'ersetzt');
  });

  await teil('B-Abschluss-ohne-Erstattung', async () => {
    await webhook('refund.failed', refund('re_rf_wid', bWid), T0 + 1000);
    const vorher = JSON.stringify([db.prepare('SELECT * FROM erstattung_fehler ORDER BY refund_id').all(), db.prepare('SELECT * FROM ellallas ORDER BY bestellung_id').all()]);
    const K = { begruendung: 'Kunde informiert, Stripe geprueft.', fallreferenz: 'TICKET-1', stripe_geprueft: true };
    const a = await req('admin', 'POST', '/api/admin/widerrufe/' + bVoll + '/erledigt', K);
    check('"Ohne Erstattung abschliessen" fuer Stripe-Fehler ohne Widerruf: 404 (kein halber Weg), nichts geaendert', a.s === 404 && a.d.fehler === 'nicht_gefunden', JSON.stringify(a.d));
    const b = await req('admin', 'POST', '/api/admin/widerrufe/' + bWid + '/erledigt', K);
    check('Widerruf mit erfolgreich angelegter Erstattung, die Stripe spaeter verwirft: 409 widerruf_nicht_offen (Mechanismus unveraendert)', b.s === 409 && b.d.fehler === 'widerruf_nicht_offen', JSON.stringify(b.d));
    check('Nach beiden Aufrufen: erstattung_fehler und ellallas unveraendert, kein Eintrag in ellallas_erledigt', vorher === JSON.stringify([db.prepare('SELECT * FROM erstattung_fehler ORDER BY refund_id').all(), db.prepare('SELECT * FROM ellallas ORDER BY bestellung_id').all()]) && db.prepare('SELECT COUNT(*) n FROM ellallas_erledigt').get().n === 0);
    const w = await flag(bWid);
    check('Konto: Widerruf "erstattung" + Stripe-Fehler -> erstattung_fehlgeschlagen = true', w?.ellallas_ergebnis === 'erstattung' && w?.erstattung_fehlgeschlagen === true, JSON.stringify(w));
    check('Admin-Liste: Widerruf-Bestellung erscheint mit quelle stripe_refund_failed (die ellallas-Zeile "erstattung" selbst nicht)', (await offenListe()).filter((x) => x.bestellung_id === bWid).map((x) => x.quelle).join() === 'stripe_refund_failed');
  });

  await teil('B-Auskunft', async () => {
    // Werte folgen der Sprache der Anfrage (wie bei allen Auskunftsfeldern), Schluessel sind immer ungarisch: hier Anfrage auf Ungarisch.
    const rr = await fetch(B + '/api/konto/auskunft', { headers: { Origin: B, Cookie: 'lang=hu; sitzung=' + sitz.kunde } });
    const r = { s: rr.status, text: await rr.text() };
    const j = JSON.parse(r.text);
    const liste = j.sikertelen_visszateritesek;
    const voll = Array.isArray(liste) ? liste.find((x) => x.visszaterites_azonosito === 're_rf_voll') : null;
    check('Datenauskunft: Liste sikertelen_visszateritesek mit ungarischen Schluesseln und Werten (Sikertelen, EUR)', r.s === 200 && voll?.rendeles_azonosito === bVoll && voll?.allapot === T.hu.auskunft_wert_fehlgeschlagen && voll?.penznem === 'EUR' && voll?.osszeg === 1999 && voll?.megoldva === null, JSON.stringify(voll));
    check('Datenauskunft: geloeste Faelle mit Zustand "Sikeres"/"pótolva" und Zeitpunkt', liste?.some((x) => x.visszaterites_azonosito === 're_rf_ers_alt' && x.allapot === T.hu.auskunft_wert_ersetzt && !!x.megoldva) && liste?.length === db.prepare('SELECT COUNT(*) n FROM erstattung_fehler').get().n, JSON.stringify(liste?.map((x) => x.allapot)));
    const best = j.rendelesek?.find((x) => x.azonosito === bVoll);
    check('Datenauskunft: Bestellung mit visszaterites_sikertelen = true; keine deutschen Rohschluessel/-werte', best?.visszaterites_sikertelen === true && !/"(refund_id|geloest|fehlgeschlagene_erstattungen|ereignis_zeit|erstattung_fehlgeschlagen)"|"fehlgeschlagen"|"ersetzt"|"abgebrochen"/.test(r.text), JSON.stringify(best));
  });

  // ======================= Teil C: Browser (Kundenkonto und Admin-Seite) =======================
  await teil('C-Browser', async () => {
    const PW = process.env.PLAYWRIGHT_CORE || 'C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs';
    const CHROME = process.env.CHROME_PFAD || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    if (!existsSync(PW) || !existsSync(CHROME)) { uebersprungen++; console.log('UEBERSPRUNGEN Teil C (Browser): playwright-core oder Chrome fehlt'); return; }
    await webhook('refund.failed', refund('re_rf_browser', bBrowser), T0 + 1100);
    const { chromium } = await import(pathToFileURL(PW).href);
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
      for (const l of SPRACHEN) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: l });
        await ctx.addCookies([{ name: 'lang', value: l, url: B }, { name: 'sitzung', value: sitz.kunde, url: B }]);
        const p = await ctx.newPage();
        await p.goto(B + '/#/fiokom', { waitUntil: 'load' });
        await p.waitForSelector('article.konto-bestellung', { timeout: 8000 });
        const text = async (id) => { const a = p.locator('article.konto-bestellung', { has: p.locator('h3', { hasText: new RegExp(': ' + id + '$') }) }); return (await a.count()) === 1 ? a.innerText() : ''; };
        const fehl = T[l].k_fiokom_status + ': ' + T[l].k_erstattung_fehlgeschlagen, erst = T[l].k_fiokom_status + ': ' + T[l].k_fiokom_erstattet;
        for (const [id, name] of [[bBrowser, 'voll'], [bTeil, 'Teilerstattung'], [bAbo, 'Abo abgebrochen']]) {
          const tx = await text(id);
          check(`[${l}] Konto ${name} (${id}): "${fehl}", kein "${erst}"`, tx.includes(fehl) && !tx.includes(erst), tx.slice(0, 300));
        }
        const tl = await text(bErs);
        check(`[${l}] Konto ersetzter Fehler (${bErs}): wieder "${erst}"`, tl.includes(erst) && !tl.includes(fehl), tl.slice(0, 300));
        await ctx.close();
        const actx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: l });
        await actx.addCookies([{ name: 'lang', value: l, url: B }, { name: 'sitzung', value: sitz.admin, url: B }]);
        const ap = await actx.newPage();
        await ap.goto(B + '/admin/', { waitUntil: 'load' });
        await ap.waitForSelector('.kurskarte', { timeout: 8000 });
        await ap.waitForFunction((s) => document.body.innerText.includes(s), T[l].a_erstattung_stripe_fehler, { timeout: 5000 }).catch(() => {});
        const az = ap.locator('article.lecke', { hasText: 're_rf_browser' });
        const at = (await az.count()) === 1 ? await az.innerText() : '';
        check(`[${l}] Admin: Zeile mit "${T[l].a_erstattung_stripe_fehler.slice(0, 30)}...", "${T[l].a_erstattung_stripe_referenz}: re_rf_browser" und Hinweis, KEIN Abschluss-Knopf`,
          at.includes(T[l].a_erstattung_stripe_fehler) && at.includes(T[l].a_erstattung_stripe_referenz + ': re_rf_browser') && at.includes(T[l].a_erstattung_stripe_hinweis) && (await az.locator('button').count()) === 0, at.slice(0, 400));
        await actx.close();
      }
    } finally { await browser.close(); }
  });

  // ======================= Teil D: Migration wiederholbar =======================
  await teil('D-Migration', async () => {
    await new Promise((r) => server.close(r)); server = null;
    const vor = db.prepare('SELECT * FROM erstattung_fehler ORDER BY refund_id').all();
    const skript = "const {db}=await import(process.argv[1]);console.log(JSON.stringify({z:db.prepare('SELECT * FROM erstattung_fehler ORDER BY refund_id').all(),sql:db.prepare(\"SELECT sql FROM sqlite_master WHERE name='erstattung_fehler'\").get()?.sql||''}))";
    const lauf = () => JSON.parse(execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', skript, pathToFileURL(join(PLATTFORM, 'db.mjs')).href], { env: { ...process.env }, encoding: 'utf8' }).trim().split('\n').pop());
    const a = lauf(), b = lauf();
    check('db.mjs zweimal auf bestehender Datenbank: Tabelle und Zeilen unveraendert', JSON.stringify(a.z) === JSON.stringify(vor) && JSON.stringify(b) === JSON.stringify(a) && /refund_id TEXT PRIMARY KEY/.test(a.sql), JSON.stringify([a.z.length, vor.length]));
    check('Datenbank-Sperre: unbekannter Status direkt eingefuegt -> CHECK-Fehler', (() => { try { db.prepare("INSERT INTO erstattung_fehler(refund_id,bestellung_id,zeit,ereignis_zeit,status) VALUES('re_x',?,?,1,'irgendwas')").run(bOk, jetzt); return false; } catch { return !zeile('re_x'); } })());
  });
} catch (e) {
  check('Testablauf', false, e.stack || e.message);
} finally {
  server?.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows: Datei evtl. noch gesperrt */ }
}
console.log(`\nRefund-Failed: ${ok} bestanden, ${fail} fehlgeschlagen` + (uebersprungen ? ', Teil C uebersprungen' : ''));
process.exit(fail ? 1 : 0);
