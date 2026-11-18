// Echter Abo-Ablauf in der Stripe-SANDBOX (nur Testmodus, Testkarten): Kauf, volle Erstattung, Kuendigung, Abo-Ende
// und eine fehlgeschlagene Verlaengerung (Stripe-Test-Uhr). Die ECHTEN Stripe-Ereignisse werden in die echte App (Wegwerf-Datenbank)
// eingespielt. Ersetzt sind nur die Signaturpruefung und der Mailversand.
// Prueft G1: ein entzogener (erstatteter) Zugang darf durch subscription.updated / deleted / invoice.payment_failed NICHT zurueckkommen.
// Aufruf: powershell -File tools\Stripe-Sandbox-Abo-Echt.ps1   (laedt den Testschluessel; ohne sk_test_ Abbruch)
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY || '';
if (!key.startsWith('sk_test_')) { console.log('Abbruch: nur Testmodus (sk_test_) erlaubt.'); process.exit(2); }
const dir = mkdtempSync(join(tmpdir(), 'schulung-abo-echt-'));
process.env.DB_DATEI = join(dir, 'test.db');
let ok = 0, fail = 0;
const check = (name, x) => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + name); };
const info = (...a) => console.log('       ' + a.join(' '));
const warte = ms => new Promise(r => setTimeout(r, ms));

const echt = new Stripe(key);
const stripe = new Proxy(echt, { get: (t, p) => p === 'webhooks' ? { constructEvent: b => JSON.parse(Buffer.isBuffer(b) ? b.toString() : String(b)) } : t[p] });
const {db} = await import('../db.mjs');
const {erstelleServer} = await import('../app.mjs');
const BASE = 'http://127.0.0.1:4511';
const server = erstelleServer({ stripe, base: BASE, webhookSecret: 'test', mailer: async () => true,
  verkaufsmeldungMail: 'test@example.com', dateiOrdner: join(dir, 'dateien') }).listen(4511, '127.0.0.1');
await new Promise(r => server.listening ? r() : server.once('listening', r));

const jetzt = () => new Date().toISOString();
const gespielt = new Set();
const t0 = Math.floor(Date.now() / 1000) - 5;
const aufraeumen = { kunden: [], uhren: [], produkt: null, preis: null };
let kursId;

// Holt neue Ereignisse DIESES Kunden (warten, bis die erwarteten Typen da sind) und spielt sie in zeitlicher Reihenfolge in die App ein.
async function einspielen(cus, erwartet, beschriftung) {
  let neu = [];
  for (let i = 0; i < 30; i++) {
    const liste = await echt.events.list({ created: { gte: t0 }, limit: 100 });
    neu = liste.data.filter(e => !gespielt.has(e.id) && (e.data?.object?.customer === cus || e.data?.object?.id === cus));
    const typen = new Set(neu.map(e => e.type));
    if (erwartet.every(t => typen.has(t))) break;
    await warte(2000);
  }
  neu.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
  const typen = neu.map(e => e.type);
  info(beschriftung + ': echte Ereignisse', JSON.stringify(typen));
  for (const e of erwartet) check(beschriftung + ': Stripe hat ' + e + ' gesendet', typen.includes(e));
  const status = [];
  for (const e of neu) {
    gespielt.add(e.id);
    const r = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 'stub' }, body: JSON.stringify(e) });
    status.push(e.type + '=' + r.status);
  }
  check(beschriftung + ': alle Ereignisse von der App angenommen (200)', status.length > 0 && status.every(s => s.endsWith('=200')));
  return neu;
}
const zugaenge = u => db.prepare("SELECT quelle,gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=?").all(u, kursId);
const aboStatus = sub => db.prepare("SELECT status,endet_zum_periodenende e,gueltig_bis FROM abos WHERE stripe_abo=?").get(sub);

async function neuerKunde(email, extra = {}) {
  const u = Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES(?,'x','kunde',?,?)").run(email, jetzt(), Date.now()).lastInsertRowid);
  const kunde = await echt.customers.create({ email, ...extra, metadata: { plattform: 'schulungsplattform', benutzer_id: String(u), test: 'abo-echt' } });
  aufraeumen.kunden.push(kunde.id);
  db.prepare("UPDATE benutzer SET stripe_kunde=? WHERE id=?").run(kunde.id, u);
  const pm = await echt.paymentMethods.attach('pm_card_visa', { customer: kunde.id });
  await echt.customers.update(kunde.id, { invoice_settings: { default_payment_method: pm.id } });
  return { u, cus: kunde.id, pm: pm.id };
}
const abonnieren = (k, preis) => echt.subscriptions.create({ customer: k.cus, items: [{ price: preis }], default_payment_method: k.pm,
  metadata: { kurs_id: String(kursId), benutzer_id: String(k.u), modell: 'abo' } });

try {
  kursId = Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,abo_preis_cent,abo_intervall,erstellt,geaendert) VALUES('Echttest','',5990000,'huf','veroeffentlicht',990000,'month',?,?)").run(jetzt(), jetzt()).lastInsertRowid);
  const produkt = await echt.products.create({ name: 'Echttest Abo (Sandbox)' });
  const preis = await echt.prices.create({ product: produkt.id, currency: 'huf', unit_amount: 990000, recurring: { interval: 'month' } });
  aufraeumen.produkt = produkt.id; aufraeumen.preis = preis.id;

  // ===== Szenario A: Kauf, volle Erstattung, Kuendigung, Abo-Ende =====
  console.log('--- Szenario A: Kauf, Erstattung, Kuendigung, Abo-Ende');
  const A = await neuerKunde('echt-abo-a@example.com');
  const sub = await abonnieren(A, preis.id);
  check('A: Stripe-Abo ist nach Testkartenzahlung aktiv', sub.status === 'active');
  await einspielen(A.cus, ['invoice.paid'], 'A Kauf');
  check('A Kauf: Abo in der App aktiv', aboStatus(sub.id)?.status === 'aktiv');
  check('A Kauf: Bestellung bezahlt', db.prepare("SELECT status FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND art='abo'").get(A.u, kursId)?.status === 'bezahlt');
  check('A Kauf: Zugang angelegt (quelle abo)', zugaenge(A.u).length === 1 && zugaenge(A.u)[0].quelle === 'abo');

  const charge = (await echt.charges.list({ customer: A.cus, limit: 5 })).data[0];
  await echt.refunds.create({ charge: charge.id });
  info('A: Stripe-Abo nach voller Erstattung, Status:', (await echt.subscriptions.retrieve(sub.id)).status);
  await einspielen(A.cus, ['charge.refunded'], 'A Erstattung');
  check('A Erstattung: Bestellung erstattet', db.prepare("SELECT status FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND art='abo'").get(A.u, kursId)?.status === 'erstattet');
  check('A Erstattung: Zugang entzogen', zugaenge(A.u).length === 0);

  // F2 echt: die volle Erstattung der letzten Rechnung beendet das Abo auch bei Stripe (sonst wird weiter abgebucht).
  check('F2 echt: Stripe-Abo ist nach der vollen Erstattung bei Stripe beendet (canceled)', (await echt.subscriptions.retrieve(sub.id)).status === 'canceled');
  check('F2 echt: App-Abo steht auf beendet', aboStatus(sub.id)?.status === 'beendet');
  await einspielen(A.cus, ['customer.subscription.deleted'], 'A Abo-Ende nach Erstattung');
  check('A Abo-Ende nach Erstattung: Status bleibt beendet', aboStatus(sub.id)?.status === 'beendet');
  check('G1+F2 echt: subscription.deleted nach der Erstattung bringt den Zugang NICHT zurueck', zugaenge(A.u).length === 0);

  // ===== Szenario A2: Zugang ENTZOGEN (ohne Erstattung), Abo laeuft bei Stripe weiter (G1 echt) =====
  console.log('--- Szenario A2: Zugang entzogen, Abo laeuft weiter');
  const A2 = await neuerKunde('echt-abo-a2@example.com');
  const sub2 = await abonnieren(A2, preis.id);
  await einspielen(A2.cus, ['invoice.paid'], 'A2 Kauf');
  check('A2 Kauf: Zugang angelegt', zugaenge(A2.u).length === 1);
  db.prepare('DELETE FROM zugaenge WHERE benutzer_id=? AND kurs_id=?').run(A2.u, kursId);
  await echt.subscriptions.update(sub2.id, { cancel_at_period_end: true });
  await einspielen(A2.cus, ['customer.subscription.updated'], 'A2 Kuendigung zum Periodenende');
  check('A2 Kuendigung: App hat das Ereignis verarbeitet (Status gekuendigt)', aboStatus(sub2.id)?.status === 'gekuendigt' && aboStatus(sub2.id)?.e === 1);
  check('G1 echt: subscription.updated (Kuendigung) bringt den Zugang NICHT zurueck', zugaenge(A2.u).length === 0);
  await echt.subscriptions.update(sub2.id, { cancel_at_period_end: false });
  await einspielen(A2.cus, ['customer.subscription.updated'], 'A2 Kuendigung zurueckgenommen');
  check('A2 Ruecknahme: App hat das Ereignis verarbeitet (Status aktiv)', aboStatus(sub2.id)?.status === 'aktiv' && aboStatus(sub2.id)?.e === 0);
  check('G1 echt: subscription.updated (Ruecknahme) bringt den Zugang NICHT zurueck', zugaenge(A2.u).length === 0);
  await echt.subscriptions.cancel(sub2.id);
  await einspielen(A2.cus, ['customer.subscription.deleted'], 'A2 Abo-Ende');
  check('A Abo-Ende: App hat das Ereignis verarbeitet (Status beendet)', aboStatus(sub2.id)?.status === 'beendet');
  check('G1 echt: subscription.deleted bringt den Zugang NICHT zurueck', zugaenge(A2.u).length === 0);


  // ===== Szenario B: fehlgeschlagene Verlaengerung (Stripe-Test-Uhr), Zugang war vorher entzogen =====
  console.log('--- Szenario B: fehlgeschlagene Verlaengerung nach Entzug (Test-Uhr)');
  const uhr = await echt.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: 'abo-echt-b' });
  aufraeumen.uhren.push(uhr.id);
  const B = await neuerKunde('echt-abo-b@example.com', { test_clock: uhr.id });
  const subB = await abonnieren(B, preis.id);
  check('B: Stripe-Abo aktiv', subB.status === 'active');
  await einspielen(B.cus, ['invoice.paid'], 'B Kauf');
  check('B Kauf: Zugang angelegt', zugaenge(B.u).length === 1);
  // Entzug wie durch den Admin (Zugang entziehen). Das Abo laeuft bei Stripe weiter.
  db.prepare("DELETE FROM zugaenge WHERE benutzer_id=? AND kurs_id=?").run(B.u, kursId);
  check('B: Zugang entzogen', zugaenge(B.u).length === 0);
  // Karte tauschen: Aufladung schlaegt fehl (Stripe-Testkarte 4000 0000 0000 0341).
  const schlecht = await echt.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: B.cus });
  await echt.customers.update(B.cus, { invoice_settings: { default_payment_method: schlecht.id } });
  await echt.subscriptions.update(subB.id, { default_payment_method: schlecht.id });
  await echt.testHelpers.testClocks.advance(uhr.id, { frozen_time: Math.floor(Date.now() / 1000) + 33 * 86400 + 7200 });
  for (let i = 0; i < 30; i++) { const c = await echt.testHelpers.testClocks.retrieve(uhr.id); if (c.status === 'ready') break; await warte(2000); }
  const neu = await einspielen(B.cus, ['invoice.payment_failed'], 'B Verlaengerung');
  check('B: es gab keine bezahlte Verlaengerung (invoice.paid nur vom Kauf)', neu.filter(e => e.type === 'invoice.paid').length === 0);
  check('B: App hat payment_failed verarbeitet (Status zahlung_offen)', aboStatus(subB.id)?.status === 'zahlung_offen');
  check('G1 echt: invoice.payment_failed legt KEINEN entzogenen Zugang als Kulanz neu an', zugaenge(B.u).length === 0);
  // Auch ohne Erstattung (Entzug wie durch den Admin): ein folgendes subscription.updated bringt den Zugang nicht zurueck.
  await echt.subscriptions.update(subB.id, { cancel_at_period_end: true });
  await einspielen(B.cus, ['customer.subscription.updated'], 'B Kuendigung nach Entzug ohne Erstattung');
  check('G1 echt: nach Admin-Entzug (ohne Erstattung) bringt subscription.updated den Zugang NICHT zurueck', zugaenge(B.u).length === 0);

  // ===== Szenario C: Teilerstattung darf den Zugang NICHT entziehen; Puffer bei Kuendigung/Ruecknahme mit echten Daten =====
  console.log('--- Szenario C: Teilerstattung, danach Kuendigung und Ruecknahme (Zugang vorhanden)');
  const C = await neuerKunde('echt-abo-c@example.com');
  const subC = await abonnieren(C, preis.id);
  await einspielen(C.cus, ['invoice.paid'], 'C Kauf');
  const ZEIT_PUFFER = 2 * 86400000;
  const periodeC = aboStatus(subC.id)?.gueltig_bis;
  const stripeEndeC = (await echt.subscriptions.retrieve(subC.id)).items.data[0].current_period_end * 1000;
  check('C Kauf: Periodenende in der App = current_period_end bei Stripe (unabhaengige Quelle)', periodeC === stripeEndeC);
  check('C Kauf: Zugang endet Periodenende plus 2 Tage Puffer', zugaenge(C.u).length === 1 && zugaenge(C.u)[0].gueltig_bis === periodeC + ZEIT_PUFFER);
  const chargeC = (await echt.charges.list({ customer: C.cus, limit: 5 })).data[0];
  await echt.refunds.create({ charge: chargeC.id, amount: 100000 });
  await einspielen(C.cus, ['charge.refunded'], 'C Teilerstattung');
  const bestC = db.prepare("SELECT status,grund FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND art='abo'").get(C.u, kursId);
  check('C Teilerstattung: Bestellung bleibt bezahlt mit Vermerk teilerstattung', bestC?.status === 'bezahlt' && bestC?.grund === 'teilerstattung');
  check('C Teilerstattung: Zugang bleibt bestehen', zugaenge(C.u).length === 1);
  await echt.subscriptions.update(subC.id, { cancel_at_period_end: true });
  await einspielen(C.cus, ['customer.subscription.updated'], 'C Kuendigung');
  check('C Kuendigung: Puffer entfaellt, Zugang endet genau am Periodenende', zugaenge(C.u)[0]?.gueltig_bis === periodeC);
  await echt.subscriptions.update(subC.id, { cancel_at_period_end: false });
  await einspielen(C.cus, ['customer.subscription.updated'], 'C Ruecknahme');
  check('C Ruecknahme: Puffer ist wieder da', zugaenge(C.u)[0]?.gueltig_bis === periodeC + ZEIT_PUFFER);
  await echt.subscriptions.cancel(subC.id);
  await einspielen(C.cus, ['customer.subscription.deleted'], 'C Abo-Ende');
  check('C Abo-Ende ohne Entzug: Zugang bleibt bis genau zum Periodenende', zugaenge(C.u).length === 1 && zugaenge(C.u)[0].gueltig_bis === periodeC);

  // ===== Szenario D: erfolgreiche Folgerechnung (Verlaengerung) per Test-Uhr =====
  console.log('--- Szenario D: erfolgreiche Verlaengerung (Folgerechnung) per Test-Uhr');
  const uhrD = await echt.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: 'abo-echt-d' });
  aufraeumen.uhren.push(uhrD.id);
  const D = await neuerKunde('echt-abo-d@example.com', { test_clock: uhrD.id });
  const subD = await abonnieren(D, preis.id);
  await einspielen(D.cus, ['invoice.paid'], 'D Kauf');
  const periode1 = aboStatus(subD.id)?.gueltig_bis;
  await echt.testHelpers.testClocks.advance(uhrD.id, { frozen_time: Math.floor(Date.now() / 1000) + 33 * 86400 + 7200 });
  for (let i = 0; i < 30; i++) { const c = await echt.testHelpers.testClocks.retrieve(uhrD.id); if (c.status === 'ready') break; await warte(2000); }
  await einspielen(D.cus, ['invoice.paid'], 'D Verlaengerung');
  const periode2 = aboStatus(subD.id)?.gueltig_bis;
  check('D: zweite bezahlte Rechnung verlaengert das Abo (spaeteres Periodenende)', periode2 > periode1);
  const stripeEndeD = (await echt.subscriptions.retrieve(subD.id)).items.data[0].current_period_end * 1000;
  check('D: neues Periodenende in der App = current_period_end bei Stripe (unabhaengige Quelle)', periode2 === stripeEndeD);
  check('D: zwei bezahlte Abo-Bestellungen', db.prepare("SELECT COUNT(*) n FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND art='abo' AND status='bezahlt'").get(D.u, kursId).n === 2);
  check('D: Zugang folgt dem neuen Periodenende plus 2 Tage Puffer', zugaenge(D.u).length === 1 && zugaenge(D.u)[0].gueltig_bis === periode2 + ZEIT_PUFFER);
  check('D: Abo-Status aktiv', aboStatus(subD.id)?.status === 'aktiv');

  // ===== Szenario E: fehlgeschlagene Verlaengerung MIT vorhandenem Zugang: die 3-Tage-Kulanz wird gesetzt (positiver Pfad) =====
  console.log('--- Szenario E: fehlgeschlagene Verlaengerung mit Zugang (Kulanz)');
  const uhrE = await echt.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: 'abo-echt-e' });
  aufraeumen.uhren.push(uhrE.id);
  const E = await neuerKunde('echt-abo-e@example.com', { test_clock: uhrE.id });
  const subE = await abonnieren(E, preis.id);
  await einspielen(E.cus, ['invoice.paid'], 'E Kauf');
  const stripeEndeE = (await echt.subscriptions.retrieve(subE.id)).items.data[0].current_period_end * 1000;
  check('E Kauf: Zugang endet Periodenende (von Stripe) plus 2 Tage Puffer', zugaenge(E.u).length === 1 && zugaenge(E.u)[0].gueltig_bis === stripeEndeE + ZEIT_PUFFER);
  const schlechtE = await echt.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: E.cus });
  await echt.customers.update(E.cus, { invoice_settings: { default_payment_method: schlechtE.id } });
  await echt.subscriptions.update(subE.id, { default_payment_method: schlechtE.id });
  await echt.testHelpers.testClocks.advance(uhrE.id, { frozen_time: Math.floor(Date.now() / 1000) + 33 * 86400 + 7200 });
  for (let i = 0; i < 30; i++) { const c = await echt.testHelpers.testClocks.retrieve(uhrE.id); if (c.status === 'ready') break; await warte(2000); }
  await einspielen(E.cus, ['invoice.payment_failed'], 'E Verlaengerung');
  check('E: App hat payment_failed verarbeitet (Status zahlung_offen)', aboStatus(subE.id)?.status === 'zahlung_offen');
  check('E: Zugang bleibt und bekommt 3 Tage Kulanz nach dem bezahlten Periodenende (Erwartung aus Stripe)', zugaenge(E.u).length === 1 && zugaenge(E.u)[0].gueltig_bis === stripeEndeE + 3 * 86400000);
} catch (e) {
  fail++; console.log('FEHLER Testablauf:', e.type || e.name, String(e.message).replace(/sk_[a-z]+_[A-Za-z0-9]+/g, 'sk_***').slice(0, 300));
} finally {
  for (const u of aufraeumen.uhren) { try { await echt.testHelpers.testClocks.del(u); } catch { info('Test-Uhr nicht geloescht', u); } }
  for (const c of aufraeumen.kunden) { try { await echt.customers.del(c); } catch { /* mit der Uhr schon weg */ } }
  try { if (aufraeumen.preis) await echt.prices.update(aufraeumen.preis, { active: false }); if (aufraeumen.produkt) await echt.products.update(aufraeumen.produkt, { active: false }); } catch { info('Testprodukt nicht archiviert'); }
  info('Aufgeraeumt: Test-Kunden, Test-Uhr geloescht, Testprodukt und Testpreis archiviert');
  server.close();
}
console.log(`Abo echt (Sandbox): ${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
