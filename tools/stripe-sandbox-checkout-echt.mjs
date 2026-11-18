// Echter CHECKOUT-Weg in der Stripe-SANDBOX (nur Testmodus): die App erzeugt selbst die Checkout-Sitzung (POST /api/kurse/:id/kaufen, modell abo).
// Die Sitzung muss im Browser mit der Stripe-Testkarte 4242 4242 4242 4242 bezahlt werden (Adresse der Sitzung in die Datei, die der Aufrufer angibt).
// Danach werden die ECHTEN Ereignisse (checkout.session.completed, invoice.paid ...) in die echte App eingespielt, dann G1: Vollerstattung, Kuendigung, Abo-Ende.
// Aufruf: powershell -File tools\Stripe-Sandbox-Checkout-Echt.ps1 <Datei-fuer-die-Checkout-Adresse>
import {mkdtempSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY || '';
if (!key.startsWith('sk_test_')) { console.log('Abbruch: nur Testmodus (sk_test_) erlaubt.'); process.exit(2); }
const urlDatei = process.argv[2];
if (!urlDatei) { console.log('Abbruch: Datei fuer die Checkout-Adresse fehlt.'); process.exit(2); }
const dir = mkdtempSync(join(tmpdir(), 'schulung-checkout-echt-'));
process.env.DB_DATEI = join(dir, 'test.db');
let ok = 0, fail = 0;
const check = (name, x) => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + name); };
const info = (...a) => console.log('       ' + a.join(' '));
const warte = ms => new Promise(r => setTimeout(r, ms));

const echt = new Stripe(key);
const stripe = new Proxy(echt, { get: (t, p) => p === 'webhooks' ? { constructEvent: b => JSON.parse(Buffer.isBuffer(b) ? b.toString() : String(b)) } : t[p] });
const {db} = await import('../db.mjs');
const {erstelleServer} = await import('../app.mjs');
const {passwortHashen} = await import('../auth.mjs');
const BASE = 'http://127.0.0.1:4512';
const server = erstelleServer({ stripe, base: BASE, webhookSecret: 'test', mailer: async () => true,
  verkaufsmeldungMail: 'test@example.com', dateiOrdner: join(dir, 'dateien') }).listen(4512, '127.0.0.1');
await new Promise(r => server.listening ? r() : server.once('listening', r));

const jetzt = () => new Date().toISOString();
const gespielt = new Set();
const t0 = Math.floor(Date.now() / 1000) - 5;
let cus = null;
async function einspielen(erwartet, beschriftung) {
  let neu = [];
  for (let i = 0; i < 30; i++) {
    const liste = await echt.events.list({ created: { gte: t0 }, limit: 100 });
    neu = liste.data.filter(e => !gespielt.has(e.id) && (e.data?.object?.customer === cus || e.data?.object?.id === cus));
    if (erwartet.every(t => new Set(neu.map(e => e.type)).has(t))) break;
    await warte(2000);
  }
  neu.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
  info(beschriftung + ': echte Ereignisse', JSON.stringify(neu.map(e => e.type)));
  for (const t of erwartet) check(beschriftung + ': Stripe hat ' + t + ' gesendet', neu.some(e => e.type === t));
  const status = [];
  for (const e of neu) {
    gespielt.add(e.id);
    const r = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 'stub' }, body: JSON.stringify(e) });
    status.push(e.type + '=' + r.status);
  }
  check(beschriftung + ': alle Ereignisse von der App angenommen (200)', status.length > 0 && status.every(s => s.endsWith('=200')));
  return neu;
}
let kursId, benutzerId;
const zugaenge = () => db.prepare("SELECT quelle,gueltig_bis FROM zugaenge WHERE benutzer_id=? AND kurs_id=?").all(benutzerId, kursId);
const abo = () => db.prepare("SELECT stripe_abo,status,gueltig_bis,endet_zum_periodenende e FROM abos WHERE benutzer_id=? AND kurs_id=?").get(benutzerId, kursId);
const PASS = 'Echt-Checkout-Test-' + Math.random().toString(36).slice(2, 10) + 'Aa1';
try {
  kursId = Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,abo_preis_cent,abo_intervall,erstellt,geaendert) VALUES('Echttest Checkout','',5990000,'huf','veroeffentlicht',990000,'month',?,?)").run(jetzt(), jetzt()).lastInsertRowid);
  benutzerId = Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES('echt-checkout@example.com',?,'kunde',?,?)").run(await passwortHashen(PASS), jetzt(), Date.now()).lastInsertRowid);
  const login = await fetch(BASE + '/api/anmelden', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'echt-checkout@example.com', passwort: PASS }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  check('Anmeldung in der App', login.status === 200 && !!cookie);
  const kauf = await fetch(BASE + '/api/kurse/' + kursId + '/kaufen', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ modell: 'abo', zustimmung: true }) });
  const kd = await kauf.json();
  check('App erzeugt echte Checkout-Sitzung (Abo)', kauf.status === 200 && typeof kd.url === 'string' && kd.url.startsWith('https://checkout.stripe.com/'));
  cus = db.prepare("SELECT stripe_kunde FROM benutzer WHERE id=?").get(benutzerId)?.stripe_kunde;
  check('App hat Stripe-Kunden angelegt', typeof cus === 'string' && cus.startsWith('cus_'));
  writeFileSync(urlDatei, kd.url);
  info('Checkout-Adresse in Datei geschrieben, warte auf Bezahlung mit der Testkarte (bis 10 Minuten)');
  let sitzung = null;
  for (let i = 0; i < 200; i++) {
    const l = await echt.checkout.sessions.list({ customer: cus, limit: 5 });
    sitzung = l.data.find(s => s.status === 'complete');
    if (sitzung) break;
    await warte(3000);
  }
  check('Checkout wurde im Browser bezahlt (Sitzung complete)', !!sitzung);
  if (!sitzung) throw new Error('keine bezahlte Sitzung');
  info('Sitzung: Modus', sitzung.mode, ', Zahlstatus', sitzung.payment_status);
  await einspielen(['checkout.session.completed', 'invoice.paid'], 'Kauf');
  check('Kauf: Abo in der App aktiv', abo()?.status === 'aktiv');
  check('Kauf: Bestellung bezahlt', db.prepare("SELECT status FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND art='abo'").get(benutzerId, kursId)?.status === 'bezahlt');
  check('Kauf: Zugang entsteht durch invoice.paid (Periodenende plus 2 Tage)', zugaenge().length === 1 && zugaenge()[0].gueltig_bis === abo().gueltig_bis + 2 * 86400000);

  const charge = (await echt.charges.list({ customer: cus, limit: 5 })).data[0];
  await echt.refunds.create({ charge: charge.id });
  await einspielen(['charge.refunded'], 'Erstattung');
  check('Erstattung: Zugang entzogen', zugaenge().length === 0);
  const subId = abo().stripe_abo;
  // F2: die volle Erstattung der letzten Abo-Rechnung beendet das Abo bei Stripe selbst; ein Update danach waere ein Fehler (Abo schon beendet).
  check('F2 echt (Checkout-Weg): Abo bei Stripe nach voller Erstattung beendet', (await echt.subscriptions.retrieve(subId)).status === 'canceled');
  check('F2 echt (Checkout-Weg): Abo in der App beendet', abo().status === 'beendet');
  await einspielen(['customer.subscription.deleted'], 'Abo-Ende');
  check('G1 echt (Checkout-Weg): Abo-Ende bringt den Zugang NICHT zurueck', zugaenge().length === 0 && abo().status === 'beendet');
} catch (e) {
  fail++; console.log('FEHLER Testablauf:', e.type || e.name, String(e.message).replace(/sk_[a-z]+_[A-Za-z0-9]+/g, 'sk_***').slice(0, 300));
} finally {
  try { if (cus) await echt.customers.del(cus); info('Test-Kunde im Sandbox-Konto geloescht'); } catch { info('Test-Kunde nicht geloescht'); }
  server.close();
}
console.log(`Checkout echt (Sandbox): ${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
