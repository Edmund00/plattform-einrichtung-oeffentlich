// Automatischer Selbsttest für Scheibe 3: Kurs kaufen (Stripe Checkout) und per Webhook freischalten.
// Läuft OFFLINE und ohne Schlüssel: Stripe wird durch eine Attrappe ersetzt (sie merkt sich nur, was der Server von Stripe will).
// Webhooks werden mit dem echten Prüfcode von Stripe-Bibliothek signiert und geprüft (mit einem Test-Geheimnis).
// Eigene Test-Datenbank, Port 4404. Enthält auch die weiter gültigen Prüfungen des früheren Lern-App-Tests (Anmeldung, Sitzung,
// Herkunftsschutz, Webhook-Signatur, doppelte Ereignisse, Reihenfolge, fremde Kunden).
// Aufruf: tools\Selbsttest-Kauf.ps1
import './test-sprache.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Stripe from 'stripe';

const PORT = 4404;
const BASE = `http://localhost:${PORT}`;
mkdirSync('daten', { recursive: true });
const lauf = Date.now();
const DB = resolve(`daten/selbsttest-kauf-${lauf}.db`);
process.env.DB_DATEI = DB;                       // VOR dem Import der App setzen
const GEHEIM = 'whsec_nur_fuer_den_selbsttest';
const pw = 'Geheim-Passwort-123';

const ausgeben = console.log.bind(console);      // Test-Ausgabe; die Logs des Servers fangen wir ab und prüfen sie
const serverLog = { warn: [], fehler: [], log: [] };
console.warn = (...a) => serverLog.warn.push(a.join(' '));
console.error = (...a) => serverLog.fehler.push(a.join(' '));
console.log = (...a) => serverLog.log.push(a.join(' '));

let ok = 0, schlecht = 0;
const pruefe = (name, bedingung, detail = '') => { bedingung ? ok++ : schlecht++; ausgeben(`${bedingung ? 'OK     ' : 'FEHLER '} ${name}${!bedingung && detail ? '  -> ' + detail : ''}`); };
const abschnitt = (t) => ausgeben(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const db = () => new DatabaseSync(DB);
const zeilen = (sql, ...p) => { const d = db(); try { return d.prepare(sql).all(...p); } finally { d.close(); } };
const zahl = (sql, ...p) => Object.values(zeilen(sql, ...p)[0])[0];

// ---- Die Attrappe für Stripe ----
const signierer = new Stripe('sk_test_attrappe_ohne_netz', { apiVersion: '2025-07-30.basil' }); // macht keine Netzanfrage
const aufrufe = { kunden: [], sitzungen: [] };
const idempotenzSitzungen = new Map();   // idempotency key → Sitzungsobjekt (PUNKT-6)
const attrappe = {
  fehlerErzwingen: false,
  webhooks: signierer.webhooks,                   // echte Signaturprüfung
  customers: { create: async (p) => { if (attrappe.fehlerErzwingen) throw new Error('Stripe nicht erreichbar (Attrappe)'); aufrufe.kunden.push(p); return { id: `cus_attrappe_${aufrufe.kunden.length}` }; } },
  listeAktiv: false, listeFehler: false, verzoegerung: 0, ablaufSekunden: null,           // Doppelkauf-Prüfung: nur in einem eigenen Abschnitt eingeschaltet
  ablaeufe: [], abgelaufen: new Set(), expireFehler: false,                                // abgelaufen gemachte Sitzungen (wie bei Stripe: danach nicht mehr 'open')
  abrufStatus: null,                                                                        // null = 'open'; fuer Tests die complete/expired simulieren
  checkout: { sessions: { create: async (p, optionen) => {
    if (attrappe.fehlerErzwingen) throw new Error('Stripe nicht erreichbar (Attrappe)');
    if (attrappe.verzoegerung) await warte(attrappe.verzoegerung);
    const ikey = optionen?.idempotencyKey;
    if (ikey && idempotenzSitzungen.has(ikey)) return idempotenzSitzungen.get(ikey);
    aufrufe.sitzungen.push(p);
    const sitzung = { id: `cs_test_attrappe_${aufrufe.sitzungen.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_attrappe_${aufrufe.sitzungen.length}`, status: 'open' };
    if (ikey) idempotenzSitzungen.set(ikey, sitzung);
    return sitzung;
  }, list: async (p) => {
    if (attrappe.listeFehler) throw new Error('Stripe-Liste nicht erreichbar (Attrappe)');
    if (!attrappe.listeAktiv || p.status !== 'open') return { data: [] };
    return { data: aufrufe.sitzungen.map((s, i) => ({ id: `cs_test_attrappe_${i + 1}`, url: `https://checkout.stripe.com/c/pay/cs_test_attrappe_${i + 1}`, status: 'open', customer: s.customer,
      metadata: s.metadata, amount_total: s.line_items[0].price_data.unit_amount, currency: s.line_items[0].price_data.currency,
      expires_at: attrappe.ablaufSekunden ?? Math.floor(Date.now() / 1000) + 86400 })).filter((s) => s.customer === p.customer && !attrappe.abgelaufen.has(s.id)) };
  }, expire: async (id) => {
    if (attrappe.expireFehler) throw new Error('Stripe-Expire nicht erreichbar (Attrappe)');
    attrappe.ablaeufe.push(id); attrappe.abgelaufen.add(id); return { id, status: 'expired' };
  }, retrieve: async (id) => {
    return { id, status: attrappe.abrufStatus ?? 'open', url: `https://checkout.stripe.com/c/pay/${id}`, metadata: {} };
  } } },
};

function client() {
  let cookie = '';
  return {
    async anfrage(methode, pfad, body, kopf = {}) {
      const r = await fetch(BASE + pfad, { method: methode, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...kopf }, body: body !== undefined ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie');
      if (sc) { const roh = sc.split(';')[0]; cookie = roh.endsWith('=') ? '' : roh; }
      let d = {}; try { d = await r.json(); } catch (e) {}
      return { s: r.status, d, setCookie: sc, cookie };
    },
    get cookie() { return cookie; },
    set cookie(c) { cookie = c; },
  };
}
async function webhook(typ, objekt, { id = `evt_selbsttest_${Math.random().toString(36).slice(2, 12)}`, secret = GEHEIM, ohneSignatur = false, signatur } = {}) {
  const payload = JSON.stringify({ id, object: 'event', type: typ, livemode: false, data: { object: objekt } });
  const kopf = { 'Content-Type': 'application/json' };
  if (!ohneSignatur) kopf['stripe-signature'] = signatur ?? signierer.webhooks.generateTestHeaderString({ payload, secret });
  const r = await fetch(BASE + '/webhook', { method: 'POST', headers: kopf, body: payload });
  return { s: r.status, d: await r.json().catch(() => ({})), id };
}
const sitzungsObjekt = (kundeStripe, kurs, benutzerId, mehr = {}) => ({
  id: `cs_test_${Math.random().toString(36).slice(2, 10)}`, object: 'checkout.session', mode: 'payment', payment_status: 'paid', payment_intent: `pi_test_${Math.random().toString(36).slice(2, 12)}`,
  customer: kundeStripe, currency: kurs.waehrung, amount_total: kurs.preis_cent, metadata: { kurs_id: String(kurs.id), benutzer_id: String(benutzerId) }, ...mehr,
});

let server;
try {
  const { erstelleServer } = await import('../app.mjs');
  const dateiOrdner = mkdtempSync(join(tmpdir(), 'schulung-kauf-dateien-'));      // eigener Ordner, damit nichts im Arbeitsordner entsteht
  server = erstelleServer({ stripe: attrappe, webhookSecret: GEHEIM, base: BASE, dateiOrdner }).listen(PORT, '127.0.0.1');
  await warte(300);

  const A = client(), B = client(), C = client(), admin = client(), gast = client();
  const mail = (n) => `selbsttest.${n}.${lauf}@example.com`;
  const mailAdmin = mail('admin');

  // =================================================================================================
  abschnitt('Anmeldung (weiter gültige Prüfungen aus dem Lern-App-Test)');
  pruefe('/api/ich: niemand angemeldet', (await gast.anfrage('GET', '/api/ich')).d.angemeldet === false);
  pruefe('Ungültige E-Mail: 400', (await A.anfrage('POST', '/api/registrieren', { zustimmung: true, email: 'keine-mail', passwort: pw })).s === 400);
  pruefe('Zu kurzes Passwort: 400', (await A.anfrage('POST', '/api/registrieren', { zustimmung: true, email: mail('a'), passwort: 'kurz' })).s === 400);
  const reg = await A.anfrage('POST', '/api/registrieren', { zustimmung: true, email: mail('a'), passwort: pw });
  pruefe('Registrieren: 201 und Cookie', reg.s === 201 && !!reg.setCookie);
  pruefe('Cookie ist HttpOnly und SameSite=Lax', /HttpOnly/i.test(reg.setCookie || '') && /SameSite=Lax/i.test(reg.setCookie || ''));
  pruefe('Gleiche E-Mail (anders geschrieben) wird abgelehnt: 409', (await client().anfrage('POST', '/api/registrieren', { zustimmung: true, email: mail('a').toUpperCase(), passwort: pw })).s === 409);
  pruefe('/api/ich: A ist angemeldet', (await A.anfrage('GET', '/api/ich')).d.email === mail('a'));
  const hashA = zeilen('SELECT passwort_hash FROM benutzer WHERE email = ?', mail('a'))[0].passwort_hash;
  pruefe('Passwort steht nicht im Klartext (scrypt-Hash)', hashA.startsWith('scrypt$') && !hashA.includes(pw));
  const tokenA = A.cookie.split('=')[1];
  pruefe('Sitzungs-Token steht nicht im Klartext in der Datenbank', zeilen('SELECT token_hash FROM sitzungen').length >= 1 && !zeilen('SELECT token_hash FROM sitzungen').some((s) => s.token_hash === tokenA));
  const anderer = client();
  pruefe('Falsches Passwort: 401', (await anderer.anfrage('POST', '/api/anmelden', { email: mail('a'), passwort: 'falsch-falsch' })).s === 401);
  const unbekannt = await anderer.anfrage('POST', '/api/anmelden', { email: 'gibtsnicht@example.com', passwort: 'irgendwas-123' });
  const falschA = await anderer.anfrage('POST', '/api/anmelden', { email: mail('a'), passwort: 'falsch-falsch' });
  pruefe('Unbekannte E-Mail: gleiche Antwort 401 wie bei falschem Passwort', unbekannt.s === 401 && unbekannt.d.text === falschA.d.text && unbekannt.d.fehler === falschA.d.fehler);
  await client().anfrage('POST', '/api/registrieren', { zustimmung: true, email: mail('d'), passwort: pw });
  for (let i = 0; i < 5; i++) await anderer.anfrage('POST', '/api/anmelden', { email: mail('d'), passwort: 'falsch-falsch' });
  pruefe('Nach 5 Fehlversuchen: 429 (gesperrt), selbst mit richtigem Passwort', (await anderer.anfrage('POST', '/api/anmelden', { email: mail('d'), passwort: pw })).s === 429);
  pruefe('Die Sperre betrifft nur dieses Konto: A kann sich weiter anmelden', (await client().anfrage('POST', '/api/anmelden', { email: mail('a'), passwort: pw })).s === 200);
  const alterCookie = A.cookie;
  pruefe('Abmelden: 200', (await A.anfrage('POST', '/api/abmelden')).s === 200);
  const nachLogout = client(); nachLogout.cookie = alterCookie;
  pruefe('Alter Cookie ist nach dem Abmelden wertlos', (await nachLogout.anfrage('GET', '/api/ich')).d.angemeldet === false);
  pruefe('Erneut anmelden klappt', (await A.anfrage('POST', '/api/anmelden', { email: mail('a'), passwort: pw })).s === 200);
  const fremd = await A.anfrage('POST', '/api/abmelden', undefined, { Origin: 'http://boese-seite.example' });
  pruefe('POST mit fremder Herkunft: 403 (Herkunftsschutz)', fremd.s === 403 && fremd.d.fehler === 'herkunft_fremd');
  pruefe('Nach abgelehnter Anfrage ist A noch angemeldet', (await A.anfrage('GET', '/api/ich')).d.angemeldet === true);
  pruefe('Herkunftsschutz gilt auch für das Kaufen und für PATCH', (await A.anfrage('POST', '/api/kurse/1/kaufen', undefined, { Origin: 'http://boese-seite.example' })).s === 403
    && (await A.anfrage('PATCH', '/api/admin/kurse/1', { titel: 'x' }, { Origin: 'http://boese-seite.example' })).s === 403);
  pruefe('Die alten Lern-App-Routen gibt es nicht mehr (angebote, kauf, portal, bestellungen)',
    (await A.anfrage('GET', '/api/angebote')).s === 404 && (await A.anfrage('POST', '/api/kauf', { angebot: 'probe' })).s === 404
    && (await A.anfrage('POST', '/api/portal')).s === 404 && (await A.anfrage('GET', '/api/bestellungen')).s === 404);

  // =================================================================================================
  abschnitt('Vorbereitung: Admin (per Skript) legt Kurse an');
  const skript = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/admin-anlegen.mjs', mailAdmin], { env: { ...process.env, ADMIN_PASSWORT: pw }, encoding: 'utf8' });
  pruefe('Admin angelegt', skript.stdout.trim() === 'Admin angelegt', skript.stdout + skript.stderr);
  pruefe('Admin meldet sich an', (await admin.anfrage('POST', '/api/anmelden', { email: mailAdmin, passwort: pw })).s === 200);
  const mk = async (daten, veroeffentlichen = true) => {
    const r = await admin.anfrage('POST', '/api/admin/kurse', daten);
    if (veroeffentlichen) await admin.anfrage('POST', `/api/admin/kurse/${r.d.id}/veroeffentlichen`, {});
    await admin.anfrage('POST', `/api/admin/kurse/${r.d.id}/lektionen`, { titel: `Lektion in ${daten.titel}`, inhalt: `GEHEIM-${daten.titel}`, status: 'veroeffentlicht' });   // Block 4: im veroeffentlichten Kurs sonst zuerst ausgeblendet
    return r.d;
  };
  const kursA = await mk({ titel: 'Színtanácsadás', beschreibung: 'Alapok', preis_cent: 3990000, waehrung: 'huf' });
  const kursFrei = await mk({ titel: 'Ingyenes bevezető', preis_cent: 0 });
  const kursEntwurf = await mk({ titel: 'Piszkozat kurzus', preis_cent: 1000000 }, false);
  const kursEur = await mk({ titel: 'Euro kurzus', preis_cent: 1500, waehrung: 'eur' });
  pruefe('Kurse sind angelegt (bezahlt, kostenlos, Entwurf, Euro)', [kursA, kursFrei, kursEntwurf, kursEur].every((k) => k.id));
  const huf1 = await admin.anfrage('POST', '/api/admin/kurse', { titel: 'Krumm', preis_cent: 12345, waehrung: 'huf' });
  pruefe('HUF: Preis, der nicht durch 100 teilbar ist, wird abgelehnt (400, ungarischer Text)', huf1.s === 400 && huf1.d.fehler === 'preis_huf_teilbar' && /forint/.test(huf1.d.text), JSON.stringify(huf1));
  pruefe('Euro: 12345 ist erlaubt', (await admin.anfrage('POST', '/api/admin/kurse', { titel: 'Euro krumm', preis_cent: 12345, waehrung: 'eur' })).s === 201);
  pruefe('HUF beim Ändern: Preis 12345 abgelehnt, Wechsel von Euro 12345 auf HUF auch', (await admin.anfrage('PATCH', `/api/admin/kurse/${kursA.id}`, { preis_cent: 12345 })).d.fehler === 'preis_huf_teilbar'
    && (await admin.anfrage('PATCH', `/api/admin/kurse/${(zeilen("SELECT id FROM kurse WHERE titel = 'Euro krumm'")[0]).id}`, { waehrung: 'huf' })).d.fehler === 'preis_huf_teilbar');

  // =================================================================================================
  abschnitt('Kaufen: Prüfungen vor Stripe');
  pruefe('Ohne Anmeldung: 401', (await gast.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true})).s === 401);
  pruefe('Entwurf: 404', (await A.anfrage('POST', `/api/kurse/${kursEntwurf.id}/kaufen`, {zustimmung:true})).s === 404);
  pruefe('Unbekannter Kurs: 404', (await A.anfrage('POST', '/api/kurse/99999/kaufen')).s === 404);
  pruefe('Ungültige Kurs-ID: 400', (await A.anfrage('POST', '/api/kurse/abc/kaufen')).d.fehler === 'ungueltige_id');
  const mitPreis = await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, { preis_cent: 1 });
  pruefe('Preis in der Anfrage wird abgelehnt: 400 unbekanntes_feld', mitPreis.s === 400 && mitPreis.d.fehler === 'unbekanntes_feld' && mitPreis.d.text.length > 5, JSON.stringify(mitPreis));
  pruefe('Auch Währung, Betrag oder beliebige Felder werden abgelehnt', (await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, { waehrung: 'eur' })).s === 400
    && (await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, { amount: 1, unit_amount: 1 })).s === 400);
  pruefe('Body als Liste: 400', (await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, [1])).d.fehler === 'body_ungueltig');
  pruefe('Bis hierher hat der Server Stripe nie gerufen (keine Kunden, keine Sitzungen)', aufrufe.kunden.length === 0 && aufrufe.sitzungen.length === 0);

  abschnitt('Kaufen: die Checkout-Sitzung kommt aus der Datenbank');
  const kaufA = await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true});
  pruefe('Angemeldet: 200 und Adresse von Stripe', kaufA.s === 200 && /^https:\/\/checkout\.stripe\.com\//.test(kaufA.d.url || ''), JSON.stringify(kaufA));
  // Demo-Uebersetzung: der Produktname auf der Stripe-Zahlungsseite folgt der Sprache der Kaeuferin (Seed-Kurs EN)
  { const { demoUebersetzungAn } = await import('../demo-uebersetzung.mjs'); demoUebersetzungAn(true);
    const seedKurs = await mk({ titel: 'Handbuch für Käuferinnen und Käufer', beschreibung: 'x', preis_cent: 900, waehrung: 'eur' });
    const vorher = aufrufe.sitzungen.length;
    const kEn = await A.anfrage('POST', `/api/kurse/${seedKurs.id}/kaufen`, {zustimmung:true}, { 'Accept-Language': 'en', Cookie: (A.cookie || '') + '; lang=en' });
    const sEn = aufrufe.sitzungen[vorher];
    pruefe('Stripe-Produktname folgt der Sprache (EN): "Handbook for buyers"', kEn.s === 200 && sEn && sEn.line_items[0].price_data.product_data.name === 'Handbook for buyers', JSON.stringify({ s: kEn.s, n: sEn && sEn.line_items[0].price_data.product_data.name }));
    aufrufe.sitzungen.splice(vorher, 1);
    // Zweites Download-Produkt (Admin-Handbuch, 19 EUR): Positionsname EN und HU, Betrag aus der Datenbank
    const adminKurs = await mk({ titel: 'Handbuch für den Admin-Bereich', beschreibung: 'x', preis_cent: 1900, waehrung: 'eur' });
    for (const [l, soll] of [['en', 'Admin area manual'], ['hu', 'Kézikönyv az admin felülethez']]) {
      const v = aufrufe.sitzungen.length;
      const kA = await A.anfrage('POST', `/api/kurse/${adminKurs.id}/kaufen`, {zustimmung:true}, { 'Accept-Language': l, Cookie: (A.cookie || '') + '; lang=' + l });
      const sA = aufrufe.sitzungen[v];
      pruefe(`Admin-Handbuch: Stripe-Produktname folgt der Sprache (${l.toUpperCase()}): "${soll}", 1900 eur`, kA.s === 200 && sA && sA.line_items[0].price_data.product_data.name === soll && sA.line_items[0].price_data.unit_amount === 1900 && sA.line_items[0].price_data.currency === 'eur', JSON.stringify({ s: kA.s, n: sA && sA.line_items[0].price_data.product_data.name }));
      aufrufe.sitzungen.splice(v, 1);
    }
    demoUebersetzungAn(false); }
  const idA = zeilen('SELECT id, stripe_kunde FROM benutzer WHERE email = ?', mail('a'))[0];
  const s1 = aufrufe.sitzungen[0];
  pruefe('Ein Stripe-Kunde für A angelegt und gespeichert', aufrufe.kunden.length === 1 && idA.stripe_kunde === 'cus_attrappe_1' && aufrufe.kunden[0].email === mail('a'));
  pruefe('Sitzung: Modus "payment", genau 1 Position, Menge 1', s1.mode === 'payment' && s1.line_items.length === 1 && s1.line_items[0].quantity === 1);
  pruefe('Sitzung: Betrag, Währung und Name kommen aus der Datenbank (3990000 huf, Kurstitel)', s1.line_items[0].price_data.unit_amount === 3990000 && s1.line_items[0].price_data.currency === 'huf' && s1.line_items[0].price_data.product_data.name === 'Színtanácsadás', JSON.stringify(s1.line_items));
  pruefe('Sitzung: Kunde, client_reference_id und metadata (kurs_id, benutzer_id) stimmen', s1.customer === idA.stripe_kunde && s1.client_reference_id === String(idA.id) && s1.metadata.kurs_id === String(kursA.id) && s1.metadata.benutzer_id === String(idA.id) && Object.keys(s1.metadata).length === 4 && s1.metadata.modell === 'einmal' && ['en','de','hu'].includes(s1.metadata.sprache), JSON.stringify(s1.metadata));
  pruefe('Sitzung: Zahlung trägt dieselben Angaben (für spätere Erstattungen), Sprache ungarisch', s1.payment_intent_data.metadata.kurs_id === String(kursA.id) && s1.locale === 'hu');
  pruefe('Sitzung: Rückkehr-Adressen liegen auf BASE_URL und nennen den Kurs', s1.success_url === `${BASE}/?kauf=erfolg&kurs=${kursA.id}` && s1.cancel_url === `${BASE}/?kauf=abgebrochen&kurs=${kursA.id}`, s1.success_url);
  pruefe('Die Sitzung selbst gibt noch keinen Zugang', zahl('SELECT COUNT(*) FROM zugaenge') === 0);
  const kaufA2 = await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true});
  pruefe('Zweiter Versuch (noch nicht bezahlt): wieder eine Sitzung, derselbe Stripe-Kunde', kaufA2.s === 200 && aufrufe.kunden.length === 1 && aufrufe.sitzungen[1].customer === idA.stripe_kunde);
  // Preis ändern -> nächste Sitzung nimmt den neuen Preis aus der Datenbank
  await admin.anfrage('PATCH', `/api/admin/kurse/${kursA.id}`, { preis_cent: 4990000 });
  await B.anfrage('POST', '/api/registrieren', { zustimmung: true, email: mail('b'), passwort: pw });
  const kaufB = await B.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true});
  pruefe('Preis in der Datenbank geändert: B bekommt die Sitzung mit dem NEUEN Preis (4990000)', kaufB.s === 200 && aufrufe.sitzungen[2].line_items[0].price_data.unit_amount === 4990000);
  pruefe('B hat einen eigenen Stripe-Kunden', aufrufe.kunden.length === 2 && aufrufe.sitzungen[2].customer === 'cus_attrappe_2' && aufrufe.sitzungen[2].metadata.benutzer_id === String(zeilen('SELECT id FROM benutzer WHERE email = ?', mail('b'))[0].id));
  await admin.anfrage('PATCH', `/api/admin/kurse/${kursA.id}`, { preis_cent: 3990000 });
  const kaufEur = await A.anfrage('POST', `/api/kurse/${kursEur.id}/kaufen`, {zustimmung:true});
  const sEur = aufrufe.sitzungen[3];
  pruefe('Euro-Kurs: Sitzung mit 1500 eur', kaufEur.s === 200 && sEur.line_items[0].price_data.currency === 'eur' && sEur.line_items[0].price_data.unit_amount === 1500);
  const kaufAdmin = await admin.anfrage('POST', `/api/kurse/${kursEur.id}/kaufen`, {zustimmung:true});
  pruefe('Auch ein Admin darf kaufen (Rolle kunde oder admin)', kaufAdmin.s === 200);
  abschnitt('Doppelklick oder zwei Tabs: keine zweite Checkout-Sitzung für denselben Kauf');
  // Echt gleichzeitig: zwei Anfragen im selben Augenblick (Stripe antwortet langsam), die Liste kann hier nichts finden
  attrappe.verzoegerung = 400;
  const vorGleich = aufrufe.sitzungen.length;
  const [gleich1, gleich2] = await Promise.all([A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true}), A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true})]);
  attrappe.verzoegerung = 0;
  pruefe('Zwei GLEICHZEITIGE Klicks: nur EINE neue Sitzung, beide bekommen dieselbe Adresse', gleich1.s === 200 && gleich2.s === 200 && gleich1.d.url === gleich2.d.url && aufrufe.sitzungen.length === vorGleich + 1, JSON.stringify([gleich1.d, gleich2.d, aufrufe.sitzungen.length - vorGleich]));
  attrappe.listeAktiv = true;
  const vorDoppel = aufrufe.sitzungen.length;
  const doppelA = await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true});
  pruefe('Offene Sitzung vorhanden: A bekommt DIESELBE Adresse, keine neue Sitzung', doppelA.s === 200 && doppelA.d.url === 'https://checkout.stripe.com/c/pay/cs_test_attrappe_1' && aufrufe.sitzungen.length === vorDoppel, JSON.stringify(doppelA.d));
  const doppelB = await B.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true});
  pruefe('B hat nur eine Sitzung zum ALTEN Preis (4990000): sie wird nicht benutzt, neue Sitzung, und nie die Sitzung von A', doppelB.s === 200 && aufrufe.sitzungen.length === vorDoppel + 1 && !/attrappe_[12]$/.test(doppelB.d.url || '') && aufrufe.sitzungen[vorDoppel].customer === 'cus_attrappe_2');
  await admin.anfrage('PATCH', `/api/admin/kurse/${kursA.id}`, { preis_cent: 4990000 });
  const doppelPreis = await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true});
  pruefe('Preis inzwischen geändert: die alte offene Sitzung wird NICHT benutzt, es gibt eine neue mit dem neuen Preis', doppelPreis.s === 200 && aufrufe.sitzungen.length === vorDoppel + 2 && aufrufe.sitzungen[vorDoppel + 1].line_items[0].price_data.unit_amount === 4990000);
  await admin.anfrage('PATCH', `/api/admin/kurse/${kursA.id}`, { preis_cent: 3990000 });
  // Sitzung kurz vor Ablauf (unter 30 Minuten) wird nicht wiederverwendet
  attrappe.ablaufSekunden = Math.floor(Date.now() / 1000) + 600;
  const vorAblauf = aufrufe.sitzungen.length;
  const doppelAblauf = await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true});
  attrappe.ablaufSekunden = null;
  pruefe('Offene Sitzung laeuft in 10 Minuten ab: nicht wiederverwendet, neue Sitzung', doppelAblauf.s === 200 && aufrufe.sitzungen.length === vorAblauf + 1);
  attrappe.listeFehler = true;
  const doppelFehler = await A.anfrage('POST', `/api/kurse/${kursEur.id}/kaufen`, {zustimmung:true});
  pruefe('Stripe-Liste nicht erreichbar: der Kauf läuft trotzdem (neue Sitzung), kein Absturz', doppelFehler.s === 200 && aufrufe.sitzungen.length === vorDoppel + 4);
  attrappe.listeFehler = false;

  // PUNKT-6: Kaufabsicht-UUID als Idempotency-Key verhindert Doppel-Checkout bei Suchfehler
  abschnitt('PUNKT-6: Idempotency-Key – bei Stripe-Suchfehler keine zweite Sitzung fuer dieselbe Kaufabsicht');
  {
    const D6 = client();
    await D6.anfrage('POST', '/api/registrieren', { zustimmung: true, email: mail('p6'), passwort: pw });
    attrappe.listeFehler = true;
    const vorIdempotenz = aufrufe.sitzungen.length;
    const p6r1 = await D6.anfrage('POST', `/api/kurse/${kursEur.id}/kaufen`, {zustimmung:true});
    const p6r2 = await D6.anfrage('POST', `/api/kurse/${kursEur.id}/kaufen`, {zustimmung:true});
    attrappe.listeFehler = false;
    pruefe('PUNKT-6: Stripe-Liste kaputt, zwei sequenzielle Anfragen: nur EINE Checkout-Sitzung (Idempotency-Key)',
      p6r1.s === 200 && p6r2.s === 200 && p6r1.d.url === p6r2.d.url && aufrufe.sitzungen.length === vorIdempotenz + 1,
      `Sitzungen: ${aufrufe.sitzungen.length - vorIdempotenz}, r1url: ${p6r1.d.url}, r2url: ${p6r2.d.url}`);
  }

  // Einmal- und Abo-Sitzung desselben Kurses duerfen nicht gleichzeitig offen sein (sonst koennten BEIDE bezahlt werden).
  abschnitt('Nur EINE offene Checkout-Sitzung je Kunde und Kurs');
  await admin.anfrage('PATCH', `/api/admin/kurse/${kursA.id}`, { abo_preis_cent: 990000, abo_intervall: 'month' });
  const offeneFuer = async (kundeStripe, kursId) => (await attrappe.checkout.sessions.list({ customer: kundeStripe, status: 'open' })).data.filter((s) => s.metadata.kurs_id === String(kursId));
  const stripeKundeA = aufrufe.sitzungen.find((s) => s.metadata?.benutzer_id).customer;     // Stripe-Kunde von A
  // Zu Beginn aufraeumen: alle offenen Sitzungen von A fuer Kurs A ablaufen lassen, damit der Abschnitt sauber startet.
  for (const s of await offeneFuer(stripeKundeA, kursA.id)) attrappe.abgelaufen.add(s.id);
  attrappe.ablaeufe.length = 0;
  const mixEinmal = await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, { zustimmung: true });
  const einmalSitzungId = aufrufe.sitzungen.length ? `cs_test_attrappe_${aufrufe.sitzungen.length}` : null;
  const mixAbo = await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, { modell: 'abo', zustimmung: true });
  const nachAbo = await offeneFuer(stripeKundeA, kursA.id);
  pruefe('Abo-Kauf bei offener Einmal-Sitzung: die Einmal-Sitzung wird bei Stripe abgelaufen gemacht', mixEinmal.s === 200 && mixAbo.s === 200 && attrappe.ablaeufe.includes(einmalSitzungId), JSON.stringify([einmalSitzungId, attrappe.ablaeufe]));
  pruefe('... und es bleibt genau EINE offene Sitzung (die neue Abo-Sitzung)', nachAbo.length === 1 && nachAbo[0].metadata.modell === 'abo', JSON.stringify(nachAbo.map((s) => [s.id, s.metadata.modell])));
  attrappe.ablaeufe.length = 0;
  const mixEinmal2 = await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, { zustimmung: true });
  const nachEinmal = await offeneFuer(stripeKundeA, kursA.id);
  pruefe('Einmal-Kauf bei offener Abo-Sitzung: die Abo-Sitzung wird abgelaufen, es bleibt genau EINE offene (Einmal)', mixEinmal2.s === 200 && attrappe.ablaeufe.length === 1 && nachEinmal.length === 1 && nachEinmal[0].metadata.modell === 'einmal', JSON.stringify([attrappe.ablaeufe, nachEinmal.map((s) => s.metadata.modell)]));
  attrappe.ablaeufe.length = 0;
  const vorWieder = aufrufe.sitzungen.length;
  const wieder = await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, { zustimmung: true });
  pruefe('Dieselbe Sitzung wird weiter wiederverwendet und dabei NICHTS abgelaufen gemacht', wieder.s === 200 && aufrufe.sitzungen.length === vorWieder && attrappe.ablaeufe.length === 0);
  const andererKurs = await A.anfrage('POST', `/api/kurse/${kursEur.id}/kaufen`, { zustimmung: true });
  const nochKursA = await offeneFuer(stripeKundeA, kursA.id);
  pruefe('Sitzung eines ANDEREN Kurses wird nie abgelaufen gemacht', andererKurs.s === 200 && nochKursA.length === 1);
  attrappe.expireFehler = true;
  const trotzFehler = await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, { modell: 'abo', zustimmung: true });
  pruefe('Ablauf bei Stripe schlaegt fehl: der Kauf laeuft trotzdem (200, neue Sitzung), kein Absturz', trotzFehler.s === 200 && typeof trotzFehler.d.url === 'string');
  attrappe.expireFehler = false;
  // Echt gleichzeitig mit VERSCHIEDENEM Modell (Stripe antwortet langsam): beide Anfragen duerfen nicht nebeneinander offene Sitzungen hinterlassen.
  for (const s of await offeneFuer(stripeKundeA, kursA.id)) attrappe.abgelaufen.add(s.id);
  attrappe.ablaeufe.length = 0;
  attrappe.verzoegerung = 400;
  const [parEinmal, parAbo] = await Promise.all([A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, { zustimmung: true }), A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, { modell: 'abo', zustimmung: true })]);
  attrappe.verzoegerung = 0;
  const nachParallel = await offeneFuer(stripeKundeA, kursA.id);
  pruefe('Einmal und Abo GLEICHZEITIG geklickt: beide 200, danach nur EINE offene Sitzung (die andere wurde abgelaufen gemacht)', parEinmal.s === 200 && parAbo.s === 200 && nachParallel.length === 1 && attrappe.ablaeufe.length === 1, JSON.stringify([nachParallel.map((s) => s.metadata.modell), attrappe.ablaeufe]));
  attrappe.listeAktiv = false;

  attrappe.fehlerErzwingen = true;
  await C.anfrage('POST', '/api/registrieren', { zustimmung: true, email: mail('c'), passwort: pw });
  const kaufFehl = await C.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true});
  pruefe('Stripe nicht erreichbar: 500 kauf_fehlgeschlagen mit ungarischem Text, kein Absturz', kaufFehl.s === 500 && kaufFehl.d.fehler === 'kauf_fehlgeschlagen' && kaufFehl.d.text.length > 5);
  attrappe.fehlerErzwingen = false;
  pruefe('... und es entsteht kein Zugang', zahl('SELECT COUNT(*) FROM zugaenge') === 0);

  abschnitt('Kostenloser Kurs');
  const sitzungenVorher = aufrufe.sitzungen.length, kundenVorher = aufrufe.kunden.length;
  const gratis = await A.anfrage('POST', `/api/kurse/${kursFrei.id}/kaufen`, {zustimmung:true});
  pruefe('Preis 0: 200 mit Code kostenloser_kurs und ungarischem Text', gratis.s === 200 && gratis.d.code === 'kostenloser_kurs' && gratis.d.text.length > 5, JSON.stringify(gratis));
  pruefe('Kein Stripe-Aufruf bei Preis 0', aufrufe.sitzungen.length === sitzungenVorher && aufrufe.kunden.length === kundenVorher);
  pruefe('Zugang mit Quelle "einladung" angelegt', zeilen('SELECT quelle FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ?', idA.id, kursFrei.id)[0]?.quelle === 'einladung');
  const nochmal = await A.anfrage('POST', `/api/kurse/${kursFrei.id}/kaufen`, {zustimmung:true});
  pruefe('Nochmal: 409 zugang_vorhanden', nochmal.s === 409 && nochmal.d.fehler === 'zugang_vorhanden' && nochmal.d.text.length > 5);
  pruefe('Kostenloser Kurs: Inhalt sichtbar, in "Meine Kurse"', (await A.anfrage('GET', `/api/kurse/${kursFrei.id}?lektion=${(await A.anfrage('GET', `/api/kurse/${kursFrei.id}`)).d.lektionen[0].id}`)).d.lektionen[0].inhalt === 'GEHEIM-Ingyenes bevezető' && (await A.anfrage('GET', '/api/meine-kurse')).d.some((k) => k.id === kursFrei.id));

  // =================================================================================================
  abschnitt('Webhook: Signatur und Rohtext');
  const ohne = await webhook('checkout.session.completed', {}, { ohneSignatur: true });
  pruefe('Ohne Signatur: 400, ungarischer Text', ohne.s === 400 && ohne.d.fehler === 'webhook_signatur_falsch' && ohne.d.text.length > 5);
  pruefe('Gefälschte Signatur: 400', (await webhook('checkout.session.completed', {}, { signatur: 't=1,v1=abc' })).s === 400);
  pruefe('Signatur mit falschem Geheimnis: 400', (await webhook('checkout.session.completed', {}, { secret: 'whsec_falsch' })).s === 400);
  const payloadOk = JSON.stringify({ id: 'evt_manipuliert', object: 'event', type: 'checkout.session.completed', data: { object: {} } });
  const sigOk = signierer.webhooks.generateTestHeaderString({ payload: payloadOk, secret: GEHEIM });
  const manip = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sigOk }, body: payloadOk.replace('evt_manipuliert', 'evt_anderer') });
  pruefe('Nachträglich veränderter Inhalt (Signatur passt nicht mehr): 400', manip.status === 400);
  pruefe('Nach abgelehnten Ereignissen wurde nichts vorgemerkt', zahl('SELECT COUNT(*) FROM stripe_ereignisse') === 0);

  abschnitt('Webhook: Zahlung bestätigt -> Zugang');
  const vorher = await A.anfrage('GET', `/api/kurse/${kursA.id}`);
  pruefe('Vor der Zahlung: kein Zugang, Inhalt gesperrt', vorher.d.zugang === false && !JSON.stringify(vorher.d).includes('GEHEIM'));
  const kundeA = idA.stripe_kunde;
  const sess = sitzungsObjekt(kundeA, kursA, idA.id);
  const w1 = await webhook('checkout.session.completed', sess);
  pruefe('Gültiges signiertes Ereignis: 200, neu', w1.s === 200 && w1.d.received === true && w1.d.doppelt === false, JSON.stringify(w1));
  const zug = zeilen('SELECT quelle FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ?', idA.id, kursA.id);
  pruefe('Zugang mit Quelle "zahlung" angelegt', zug.length === 1 && zug[0].quelle === 'zahlung');
  const nachListe = await A.anfrage('GET', `/api/kurse/${kursA.id}`);
  const nach = await A.anfrage('GET', `/api/kurse/${kursA.id}?lektion=${nachListe.d.lektionen[0].id}`);   // F-04: Text nur ueber die Lektionsanfrage
  pruefe('Danach zeigt /api/kurse/:id?lektion= den Inhalt', nach.d.zugang === true && nach.d.lektionen[0].inhalt === 'GEHEIM-Színtanácsadás' && nachListe.d.lektionen[0].inhalt === undefined);
  const meine = await A.anfrage('GET', '/api/meine-kurse');
  const meineA = meine.d.find((k) => k.id === kursA.id);
  pruefe('/api/meine-kurse zeigt den Kurs (nur id, titel, beschreibung)', !!meineA && meineA.titel === 'Színtanácsadás' && meineA.beschreibung === 'Alapok' && Object.keys(meineA).sort().join() === 'abo_status,beschreibung,id,titel', JSON.stringify(meine.d));
  const w1b = await webhook('checkout.session.completed', sess, { id: w1.id });
  pruefe('Dasselbe Ereignis nochmal: als Doppel erkannt', w1b.s === 200 && w1b.d.doppelt === true);
  const w1c = await webhook('checkout.session.completed', sess);   // neue Ereignis-ID, gleiche Zahlung
  pruefe('Gleiche Zahlung unter neuer Ereignis-ID: 200, aber weiter genau 1 Zugang (UNIQUE)', w1c.s === 200 && zahl('SELECT COUNT(*) FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ?', idA.id, kursA.id) === 1);
  pruefe('Beide Ereignis-IDs sind vorgemerkt', zahl('SELECT COUNT(*) FROM stripe_ereignisse WHERE id IN (?, ?)', w1.id, w1c.id) === 2);
  const bA = zeilen('SELECT * FROM bestellungen WHERE stripe_sitzung = ?', sess.id);
  pruefe('Bestellung "bezahlt" mit Sitzung, Zahlung, Betrag, Währung, Benutzer und Kurs (in derselben Transaktion wie der Zugang)', bA.length === 1 && bA[0].status === 'bezahlt' && bA[0].grund === null && bA[0].zahlung_id === sess.payment_intent && bA[0].betrag === 3990000 && bA[0].waehrung === 'huf' && bA[0].benutzer_id === idA.id && bA[0].kurs_id === kursA.id, JSON.stringify(bA));
  pruefe('Doppelte Ereignisse (gleiche und neue Ereignis-ID) legen keine zweite Bestellung an', zahl('SELECT COUNT(*) FROM bestellungen WHERE stripe_sitzung = ?', sess.id) === 1);
  const nochKauf = await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true});
  pruefe('Kaufen mit vorhandenem Zugang: 409 zugang_vorhanden', nochKauf.s === 409 && nochKauf.d.fehler === 'zugang_vorhanden');

  abschnitt('Jeder sieht nur seine eigenen Kurse');
  const bSicht = await B.anfrage('GET', `/api/kurse/${kursA.id}`);
  pruefe('B (ohne Zugang) sieht den Inhalt von A nicht', bSicht.d.zugang === false && !JSON.stringify(bSicht.d).includes('GEHEIM'));
  pruefe('B: "Meine Kurse" ist leer', (await B.anfrage('GET', '/api/meine-kurse')).d.length === 0);
  pruefe('Gast: "Meine Kurse" 401', (await gast.anfrage('GET', '/api/meine-kurse')).s === 401);
  pruefe('A sieht in "Meine Kurse" nur die eigenen (Kurs A und den kostenlosen)', meine.d.map((k) => k.id).sort().join() === [kursA.id, kursFrei.id].sort().join());
  pruefe('Der Zugang von A gilt nur für den bezahlten Kurs, nicht für den Euro-Kurs', (await A.anfrage('GET', `/api/kurse/${kursEur.id}`)).d.zugang === false);

  abschnitt('Webhook: Unpassendes schaltet nichts frei und der Server bleibt heil');
  const idB = zeilen('SELECT id, stripe_kunde FROM benutzer WHERE email = ?', mail('b'))[0];
  const kundenB = idB.stripe_kunde;
  const zugVorher = zahl('SELECT COUNT(*) FROM zugaenge');
  const warnVorher = serverLog.warn.length;
  const abgelehnt = [
    ['Falscher Betrag (1 statt Preis)', sitzungsObjekt(kundenB, kursA, idB.id, { amount_total: 1 })],
    ['Betrag niedriger als der Kurspreis', sitzungsObjekt(kundenB, kursA, idB.id, { amount_total: 3989900 })],
    ['Falsche Währung (eur statt huf)', sitzungsObjekt(kundenB, kursA, idB.id, { currency: 'eur' })],
    ['Unbekannter Kurs', sitzungsObjekt(kundenB, { ...kursA, id: 99999 }, idB.id)],
    ['Unbekannter Benutzer', sitzungsObjekt(kundenB, kursA, 99999)],
    ['Stripe-Kunde gehört einem anderen Benutzer (A)', sitzungsObjekt(kundeA, kursA, idB.id)],
    ['Fremder Stripe-Kunde (anderes Konto/andere App)', sitzungsObjekt('cus_gehoert_nicht_dazu', kursA, idB.id)],
    ['Noch nicht bezahlt (payment_status unpaid)', sitzungsObjekt(kundenB, kursA, idB.id, { payment_status: 'unpaid' })],
    ['Kein Einmalkauf (mode subscription)', sitzungsObjekt(kundenB, kursA, idB.id, { mode: 'subscription' })],
    ['metadata fehlt ganz', { ...sitzungsObjekt(kundenB, kursA, idB.id), metadata: undefined }],
    ['metadata Kurs-ID ist Text mit SQL', sitzungsObjekt(kundenB, { ...kursA, id: '1 OR 1=1' }, idB.id)],
    ['metadata Benutzer-ID negativ', sitzungsObjekt(kundenB, kursA, '-1')],
    ['Objekt ist null', null],
  ];
  for (const [name, objekt] of abgelehnt) {
    const r = await webhook('checkout.session.completed', objekt);
    pruefe(`${name}: 200, nicht freigeschaltet`, r.s === 200 && r.d.received === true && zahl('SELECT COUNT(*) FROM zugaenge') === zugVorher, JSON.stringify(r));
  }
  pruefe('Für jedes dieser Ereignisse steht eine Warnung im Server-Log', serverLog.warn.length - warnVorher === abgelehnt.length, `${serverLog.warn.length - warnVorher} Warnungen`);
  pruefe('Die Warnungen enthalten keine Schlüssel oder Kartendaten', !serverLog.warn.join('\n').match(/sk_|whsec_|\b\d{16}\b/));
  pruefe('Die abgelehnten Ereignisse sind trotzdem vorgemerkt (kommen nicht nochmal)', zahl("SELECT COUNT(*) FROM stripe_ereignisse WHERE id LIKE 'evt_selbsttest_%'") >= abgelehnt.length);
  const unbekannteTypen = ['charge.refunded', 'invoice.paid', 'customer.subscription.updated', 'payment_intent.succeeded', 'etwas.ganz.neues'];
  for (const typ of unbekannteTypen) {
    // Ein Abo-Ereignis mit Objekt-ID löst eine Nachfrage bei Stripe aus (Reihenfolge der Ereignisse); ohne ID bleibt es unbekannt.
    const r = await webhook(typ, typ.startsWith('customer.subscription') ? { customer: kundenB } : { id: 'obj_x', customer: kundenB });
    if (r.s !== 200) pruefe(`Unbekannter Ereignistyp ${typ}: 200`, false, JSON.stringify(r));
  }
  pruefe('Unbekannte Ereignistypen (Erstattung, Rechnung, ...): 200 und ignoriert', zahl('SELECT COUNT(*) FROM zugaenge') === zugVorher);
  pruefe('Der Server antwortet danach normal (/api/ich, /api/kurse)', (await B.anfrage('GET', '/api/ich')).d.email === mail('b') && (await gast.anfrage('GET', '/api/kurse')).s === 200);
  pruefe('B hat weiterhin keinen Zugang', (await B.anfrage('GET', `/api/kurse/${kursA.id}`)).d.zugang === false);

  abschnitt('Bestellungen: bezahlt, aber nicht passend = "pruefen" (kein Zugang)');
  const pz = zeilen("SELECT grund, betrag, waehrung, benutzer_id, kurs_id FROM bestellungen WHERE status = 'pruefen' ORDER BY id");
  const gruende = pz.reduce((m, x) => ({ ...m, [x.grund]: (m[x.grund] || 0) + 1 }), {});
  pruefe('Genau 7 Bestellungen "pruefen" mit den richtigen Gründen (3 Betrag/Währung, 2 Kunde, 1 Kurs, 1 Benutzer)', pz.length === 7 && gruende.betrag_waehrung === 3 && gruende.kunde_passt_nicht === 2 && gruende.kurs_unbekannt === 1 && gruende.benutzer_unbekannt === 1, JSON.stringify(gruende));
  pruefe('L1: Jede Prüfzahlung erzeugt ein Ereignis (gekauft, Status pruefen) für die Meldungsmail an die Inhaberin',
    zeilen("SELECT COUNT(*) AS n FROM ereignisse WHERE typ='gekauft' AND status='pruefen'")[0].n === 7);
  pruefe('Gespeichert wird, was tatsächlich bezahlt wurde (z. B. 1 huf, 3989900 huf, 3990000 eur)', pz.some((x) => x.betrag === 1) && pz.some((x) => x.betrag === 3989900) && pz.some((x) => x.waehrung === 'eur' && x.betrag === 3990000));
  pruefe('Unbekannter Kurs: kurs_id leer; unbekannter Benutzer: benutzer_id leer', pz.find((x) => x.grund === 'kurs_unbekannt').kurs_id === null && pz.find((x) => x.grund === 'benutzer_unbekannt').benutzer_id === null);
  pruefe('Unbezahlt, Abo, ohne Angaben, ungültige IDs, leeres Objekt: gar keine Bestellung (nur A und die 7 Prüffälle)', zahl('SELECT COUNT(*) FROM bestellungen') === 8);

  abschnitt('Bestellungen: Preis nach dem Kauf geändert');
  const F = client(); await F.anfrage('POST', '/api/registrieren', { zustimmung: true, email: mail('f'), passwort: pw });
  await F.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true});                         // Sitzung zum alten Preis 3990000
  const idF = zeilen('SELECT id, stripe_kunde FROM benutzer WHERE email = ?', mail('f'))[0];
  await admin.anfrage('PATCH', `/api/admin/kurse/${kursA.id}`, { preis_cent: 5990000 });
  const sF = sitzungsObjekt(idF.stripe_kunde, { ...kursA, preis_cent: 3990000 }, idF.id);   // bezahlt wurde der alte Preis
  const wF = await webhook('checkout.session.completed', sF);
  const bF = zeilen('SELECT status, grund, betrag FROM bestellungen WHERE stripe_sitzung = ?', sF.id)[0];
  pruefe('Bezahlt zum alten Preis nach einer Preisänderung: 200, Bestellung "pruefen" (betrag_waehrung), KEIN Zugang', wF.s === 200 && bF?.status === 'pruefen' && bF.grund === 'betrag_waehrung' && bF.betrag === 3990000 && zahl('SELECT COUNT(*) FROM zugaenge WHERE benutzer_id = ?', idF.id) === 0, JSON.stringify(bF));
  await admin.anfrage('PATCH', `/api/admin/kurse/${kursA.id}`, { preis_cent: 3990000 });

  abschnitt('Admin-Liste der Bestellungen (nur für Admin)');
  pruefe('Ohne Anmeldung: 401', (await gast.anfrage('GET', '/api/admin/bestellungen')).s === 401);
  pruefe('Als Kunde: 403', (await A.anfrage('GET', '/api/admin/bestellungen')).d.fehler === 'kein_admin');
  const alle = await admin.anfrage('GET', '/api/admin/bestellungen');
  const nurPruefen = await admin.anfrage('GET', '/api/admin/bestellungen?status=pruefen');
  pruefe('Admin: alle Bestellungen (A bezahlt, 8 zu prüfen)', alle.s === 200 && alle.d.length === 9 && nurPruefen.d.length === 8 && nurPruefen.d.every((x) => x.status === 'pruefen'), `${alle.d.length}/${nurPruefen.d.length}`);
  const zeileF = nurPruefen.d.find((x) => x.stripe_sitzung === sF.id);
  pruefe('Eintrag zeigt E-Mail des Kunden, Kurstitel, Betrag, Währung und Grund-Code', zeileF?.benutzer_email === mail('f') && zeileF.kurs_titel === 'Színtanácsadás' && zeileF.betrag === 3990000 && zeileF.waehrung === 'huf' && zeileF.grund === 'betrag_waehrung');
  pruefe('Filter "bezahlt" zeigt nur die bezahlte', (await admin.anfrage('GET', '/api/admin/bestellungen?status=bezahlt')).d.every((x) => x.status === 'bezahlt'));
  const falschStatus = await admin.anfrage('GET', '/api/admin/bestellungen?status=egal');
  pruefe('Unbekannter Status: 400 status_ungueltig mit ungarischem Text', falschStatus.s === 400 && falschStatus.d.fehler === 'status_ungueltig' && falschStatus.d.text.length > 5);
  pruefe('Unbekannter Parameter: 400', (await admin.anfrage('GET', '/api/admin/bestellungen?kunde=1')).s === 400);
  pruefe('Kein Eintrag verrät Schlüssel oder Passwort-Hashes', !JSON.stringify(alle.d).match(/scrypt|sk_|whsec_/));

  abschnitt('Webhook: Reihenfolge der Ereignisse (späte Zahlung)');
  const idC = zeilen('SELECT id FROM benutzer WHERE email = ?', mail('c'))[0].id;
  attrappe.fehlerErzwingen = false;
  await C.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true});       // legt den Stripe-Kunden von C an
  const kundeC = zeilen('SELECT stripe_kunde FROM benutzer WHERE id = ?', idC)[0].stripe_kunde;
  const sC = sitzungsObjekt(kundeC, kursA, idC);
  await webhook('checkout.session.completed', { ...sC, payment_status: 'unpaid' });
  pruefe('Abgeschlossen, aber noch unbezahlt: kein Zugang', zahl('SELECT COUNT(*) FROM zugaenge WHERE benutzer_id = ?', idC) === 0);
  await webhook('checkout.session.async_payment_succeeded', { ...sC, payment_status: 'paid' });
  pruefe('Später "Zahlung erfolgreich" (async_payment_succeeded): Zugang', zahl('SELECT COUNT(*) FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ?', idC, kursA.id) === 1);
  // umgekehrte Reihenfolge bei D... D ist gesperrt zum Anmelden, daher ein weiterer Benutzer E
  const E = client(); await E.anfrage('POST', '/api/registrieren', { zustimmung: true, email: mail('e'), passwort: pw });
  await E.anfrage('POST', `/api/kurse/${kursEur.id}/kaufen`, {zustimmung:true});
  const idE = zeilen('SELECT id, stripe_kunde FROM benutzer WHERE email = ?', mail('e'))[0];
  const sE = sitzungsObjekt(idE.stripe_kunde, kursEur, idE.id);
  await webhook('checkout.session.async_payment_succeeded', { ...sE, payment_status: 'paid' });
  await webhook('checkout.session.completed', { ...sE, payment_status: 'unpaid' });
  pruefe('Umgekehrte Reihenfolge (erst bezahlt, dann "abgeschlossen, unbezahlt"): Zugang bleibt', zahl('SELECT COUNT(*) FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ?', idE.id, kursEur.id) === 1);

  abschnitt('Webhook: alles oder nichts (eine Transaktion)');
  const bombe = await mk({ titel: 'Bombe', preis_cent: 100000 });
  const dT = db();
  dT.exec(`CREATE TRIGGER selbsttest_bombe BEFORE INSERT ON zugaenge WHEN NEW.kurs_id = ${bombe.id} BEGIN SELECT RAISE(ABORT, 'Selbsttest-Fehler'); END;`);
  dT.close();
  const sBombe = sitzungsObjekt(kundenB, bombe, idB.id);
  const fehlerVorher = serverLog.fehler.length;
  const wBombe = await webhook('checkout.session.completed', sBombe, { id: 'evt_selbsttest_bombe' });
  pruefe('Fehler beim Verarbeiten: 500, damit Stripe es später nochmal schickt', wBombe.s === 500 && serverLog.fehler.length > fehlerVorher);
  pruefe('... und die Ereignis-ID wurde NICHT vorgemerkt, auch keine Bestellung entstand (Rollback)', zahl("SELECT COUNT(*) FROM stripe_ereignisse WHERE id = 'evt_selbsttest_bombe'") === 0 && zahl('SELECT COUNT(*) FROM bestellungen WHERE stripe_sitzung = ?', sBombe.id) === 0);
  const dT2 = db(); dT2.exec('DROP TRIGGER selbsttest_bombe'); dT2.close();
  const wBombe2 = await webhook('checkout.session.completed', sBombe, { id: 'evt_selbsttest_bombe' });
  pruefe('Stripe schickt es nochmal, jetzt klappt es: Zugang und vorgemerkt', wBombe2.s === 200 && wBombe2.d.doppelt === false && zahl('SELECT COUNT(*) FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ?', idB.id, bombe.id) === 1 && zahl('SELECT COUNT(*) FROM bestellungen WHERE stripe_sitzung = ? AND status = ?', sBombe.id, 'bezahlt') === 1);

  // =================================================================================================
  abschnitt('Erstattung (charge.refunded)');
  const erstattung = (zahlungId, voll, betragErstattet, id) => webhook('charge.refunded', { id: `ch_test_${Math.random().toString(36).slice(2, 10)}`, object: 'charge', payment_intent: zahlungId, amount: 3990000, amount_refunded: betragErstattet ?? (voll ? 3990000 : 100000), refunded: voll, currency: 'huf' }, id ? { id } : {});
  const hatZugang = (benutzerId, kursId) => zahl('SELECT COUNT(*) FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ?', benutzerId, kursId) === 1;
  const bestellung = (sitzungId) => zeilen('SELECT status, grund FROM bestellungen WHERE stripe_sitzung = ?', sitzungId)[0];
  const warnVorErstattung = serverLog.warn.length;

  const teil = await erstattung(sess.payment_intent, false);
  pruefe('Teilerstattung: 200, Bestellung bleibt "bezahlt" mit Vermerk, Zugang bleibt', teil.s === 200 && bestellung(sess.id).status === 'bezahlt' && bestellung(sess.id).grund === 'teilerstattung' && hatZugang(idA.id, kursA.id));
  const voll = await erstattung(sess.payment_intent, true);
  pruefe('Volle Erstattung: 200, Bestellung "erstattet", Zugang (Quelle zahlung) entfernt', voll.s === 200 && bestellung(sess.id).status === 'erstattet' && bestellung(sess.id).grund === 'erstattung_voll' && !hatZugang(idA.id, kursA.id));
  const nachErstattung = await A.anfrage('GET', `/api/kurse/${kursA.id}`);
  pruefe('Danach: Inhalt wieder gesperrt und der Kurs fehlt in "Meine Kurse", der kostenlose Kurs bleibt', nachErstattung.d.zugang === false && !JSON.stringify(nachErstattung.d).includes('GEHEIM') && !(await A.anfrage('GET', '/api/meine-kurse')).d.some((k) => k.id === kursA.id) && (await A.anfrage('GET', '/api/meine-kurse')).d.some((k) => k.id === kursFrei.id));
  const dopp = await erstattung(sess.payment_intent, true, undefined, voll.id);
  pruefe('Dasselbe Erstattungs-Ereignis nochmal: als Doppel erkannt', dopp.s === 200 && dopp.d.doppelt === true);
  pruefe('Neues Ereignis zur schon erstatteten Zahlung: 200, nichts ändert sich', (await erstattung(sess.payment_intent, true)).s === 200 && bestellung(sess.id).status === 'erstattet');
  const spaet = await webhook('checkout.session.completed', sess);                    // dieselbe Sitzung kommt nochmal (anderes Ereignis)
  pruefe('Verspätetes "bezahlt" zur erstatteten Sitzung gibt den Zugang NICHT zurück', spaet.s === 200 && !hatZugang(idA.id, kursA.id) && bestellung(sess.id).status === 'erstattet');
  const nochmalKaufen = await A.anfrage('POST', `/api/kurse/${kursA.id}/kaufen`, {zustimmung:true});
  pruefe('Nach der Erstattung kann A den Kurs wieder kaufen (kein 409)', nochmalKaufen.s === 200);
  const sA2 = sitzungsObjekt(kundeA, kursA, idA.id);
  await webhook('checkout.session.completed', sA2);
  pruefe('Neue Zahlung: wieder Zugang, zweite Bestellung "bezahlt" (die erste bleibt "erstattet")', hatZugang(idA.id, kursA.id) && bestellung(sA2.id).status === 'bezahlt' && zahl('SELECT COUNT(*) FROM bestellungen WHERE benutzer_id = ? AND kurs_id = ?', idA.id, kursA.id) === 2);
  const unbekanntePz = await erstattung('pi_gibt_es_nicht', true);
  pruefe('Erstattung zu unbekannter Zahlung: 200, nur Warnung im Log, nichts geändert', unbekanntePz.s === 200 && serverLog.warn.length > warnVorErstattung && hatZugang(idA.id, kursA.id));
  const ohnePz = await webhook('charge.refunded', { id: 'ch_ohne', object: 'charge', amount: 100, amount_refunded: 100, refunded: true });
  pruefe('Erstattung ohne Zahlungs-ID und ohne Objekt: 200, kein Absturz', ohnePz.s === 200 && (await webhook('charge.refunded', null)).s === 200);

  const bFErst = await erstattung(sF.payment_intent, true);
  pruefe('Erstattung einer "pruefen"-Bestellung: wird "erstattet", kein Zugang entsteht oder verschwindet', bFErst.s === 200 && bestellung(sF.id).status === 'erstattet' && !hatZugang(idF.id, kursA.id));

  // Einladung bleibt, auch wenn eine Zahlung erstattet wird
  const kursG = await mk({ titel: 'Erstattungs-Kurs', preis_cent: 3990000 });
  const kaeufer = async (name) => { const k = client(); await k.anfrage('POST', '/api/registrieren', { zustimmung: true, email: mail(name), passwort: pw }); await k.anfrage('POST', `/api/kurse/${kursG.id}/kaufen`, {zustimmung:true}); return zeilen('SELECT id, stripe_kunde FROM benutzer WHERE email = ?', mail(name))[0]; };
  const idG = await kaeufer('g');
  const dE = db(); dE.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, erstellt) VALUES (?, ?, 'einladung', ?)").run(idG.id, kursG.id, new Date().toISOString()); dE.close();
  const sG = sitzungsObjekt(idG.stripe_kunde, kursG, idG.id);
  await webhook('checkout.session.completed', sG);
  await erstattung(sG.payment_intent, true);
  pruefe('Zugang mit Quelle "einladung" bleibt bei voller Erstattung bestehen (nur "zahlung" wird entfernt)', bestellung(sG.id).status === 'erstattet' && zeilen('SELECT quelle FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ?', idG.id, kursG.id)[0]?.quelle === 'einladung');

  // Zwei bezahlte Sitzungen für denselben Kurs (Doppelkauf im Fenster vor dem Webhook). Gesamtpruefung F-05 (12.11.2026): die zweite Zahlung wird
  // NICHT mehr still 'bezahlt' gebucht, sondern 'pruefen' (Grund doppelt_bezahlt) mit Meldung; frueher hielt dieser Test zwei 'bezahlt' fest.
  const idH = await kaeufer('h');
  const sH1 = sitzungsObjekt(idH.stripe_kunde, kursG, idH.id), sH2 = sitzungsObjekt(idH.stripe_kunde, kursG, idH.id);
  await webhook('checkout.session.completed', sH1); await webhook('checkout.session.completed', sH2);
  pruefe('Zweimal bezahlt: erste bezahlt, zweite pruefen (doppelt_bezahlt), ein Zugang', bestellung(sH1.id).status === 'bezahlt' && bestellung(sH2.id).status === 'pruefen' && bestellung(sH2.id).grund === 'doppelt_bezahlt' && hatZugang(idH.id, kursG.id));
  pruefe('Zweimal bezahlt: Meldung an die Inhaberin (Ereignis gekauft/pruefen)', zahl("SELECT COUNT(*) FROM ereignisse WHERE typ = 'gekauft' AND status = 'pruefen' AND kurs_id = ? AND email = ?", kursG.id, mail('h')) === 1);
  await erstattung(sH2.payment_intent, true);
  pruefe('Doppelzahlung erstattet: Zugang bleibt (die erste Zahlung trägt ihn)', bestellung(sH2.id).status === 'erstattet' && hatZugang(idH.id, kursG.id));
  await erstattung(sH1.payment_intent, true);
  pruefe('Erste Zahlung erstattet: jetzt ist der Zugang weg', bestellung(sH1.id).status === 'erstattet' && !hatZugang(idH.id, kursG.id));

  // Alles oder nichts auch bei der Erstattung
  const dB = db();
  dB.exec("CREATE TRIGGER selbsttest_nicht_loeschen BEFORE DELETE ON zugaenge BEGIN SELECT RAISE(ABORT, 'Selbsttest-Fehler'); END;");
  dB.close();
  const wFehl = await erstattung(sA2.payment_intent, true, undefined, 'evt_selbsttest_erstattung_bombe');
  pruefe('Fehler beim Entfernen des Zugangs: 500, Bestellung bleibt "bezahlt", Zugang bleibt, Ereignis nicht vorgemerkt (Rollback)', wFehl.s === 500 && bestellung(sA2.id).status === 'bezahlt' && hatZugang(idA.id, kursA.id) && zahl("SELECT COUNT(*) FROM stripe_ereignisse WHERE id = 'evt_selbsttest_erstattung_bombe'") === 0);
  const dB2 = db(); dB2.exec('DROP TRIGGER selbsttest_nicht_loeschen'); dB2.close();
  const wFehl2 = await erstattung(sA2.payment_intent, true, undefined, 'evt_selbsttest_erstattung_bombe');
  pruefe('Stripe schickt es nochmal, jetzt klappt es: erstattet und Zugang entfernt', wFehl2.s === 200 && wFehl2.d.doppelt === false && bestellung(sA2.id).status === 'erstattet' && !hatZugang(idA.id, kursA.id));
  pruefe('Die Warnungen der Erstattungen enthalten keine Schlüssel', !serverLog.warn.join('\n').match(/sk_|whsec_/));

  // =================================================================================================
  abschnitt('Start des echten Servers (server.mjs) ohne Lern-App-Dateien');
  const arbeitsordner = mkdtempSync(join(tmpdir(), 'schulung-start-'));     // leerer Ordner: keine daten/stripe-objekte.json
  const lauf2 = (env) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', resolve('server.mjs')], { cwd: arbeitsordner, env: { PATH: process.env.PATH, DB_DATEI: join(arbeitsordner, 'start.db'), PORT: '4405', ...env }, encoding: 'utf8', timeout: 8000 });
  const keinKey = lauf2({});
  pruefe('Ohne STRIPE_SECRET_KEY: Abbruch (Exitcode 1)', keinKey.status === 1 && /sk_test_/.test(keinKey.stderr));
  const liveKey = lauf2({ STRIPE_SECRET_KEY: 'sk_live_nicht_erlaubt', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
  pruefe('Mit Live-Schlüssel (sk_live_): Abbruch, Schlüssel wird nicht ausgegeben', liveKey.status === 1 && !(liveKey.stdout + liveKey.stderr).includes('nicht_erlaubt'));
  const keinHook = lauf2({ STRIPE_SECRET_KEY: 'sk_test_nur_fuer_den_start' });
  pruefe('Ohne STRIPE_WEBHOOK_SECRET (whsec_): Abbruch', keinHook.status === 1 && /whsec_/.test(keinHook.stderr));
  const lebt = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', resolve('server.mjs')], { cwd: arbeitsordner, env: { PATH: process.env.PATH, DB_DATEI: join(arbeitsordner, 'start.db'), PORT: '4405', STRIPE_SECRET_KEY: 'sk_test_nur_fuer_den_start', STRIPE_WEBHOOK_SECRET: 'whsec_nur_fuer_den_start' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let startLog = ''; lebt.stdout.on('data', (x) => { startLog += x; }); lebt.stderr.on('data', (x) => { startLog += x; });
  for (let i = 0; i < 40 && !/Schulungsplattform läuft/.test(startLog); i++) await warte(250);
  pruefe('Mit sk_test_ und whsec_ startet der Server auch ohne daten/stripe-objekte.json', /Schulungsplattform läuft/.test(startLog), startLog);
  const antwort = await fetch('http://localhost:4405/api/kurse').catch(() => null);
  pruefe('... und antwortet (/api/kurse: 200, leere Liste)', antwort?.status === 200 && (await antwort.json()).length === 0);
  const kopfSig = await fetch('http://localhost:4405/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
  pruefe('... und der Webhook verlangt eine Signatur (400)', kopfSig?.status === 400);
  pruefe('Die Schlüssel stehen nicht in der Start-Ausgabe', !/nur_fuer_den_start/.test(startLog));
  lebt.kill();
  try { rmSync(arbeitsordner, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } // Windows: Datei kann noch gesperrt sein
} catch (e) {
  schlecht++; ausgeben('FEHLER  Unerwarteter Abbruch: ' + e.stack);
} finally {
  if (server) server.close();
  await warte(300);
  for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s, { force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } } // Windows: Datei kann noch gesperrt sein
  ausgeben(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`);
  process.exit(schlecht === 0 ? 0 : 1);
}
