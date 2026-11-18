// Selbsttest F-92: Kennzahl "Umsatz" (/api/admin/kennzahlen) zieht Teilerstattungen ab (Hilfetext: "ohne Erstattungen").
// Bestellung bezahlt + signiertes charge.refunded mit Teilbetrag -> Umsatz = Betrag minus Erstattung, je Waehrung getrennt, ganze Cent (kein Gleitkomma).
// Wiederholtes/aelteres Ereignis darf nicht doppelt abziehen (kumulativer Stand von Stripe, MAX). Eigene DB, Port 19692, Stripe nur als Attrappe ohne Netz.
import './test-sprache.mjs';
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Stripe from 'stripe';

const PORT = 19692, BASE = `http://localhost:${PORT}`, lauf = Date.now();
mkdirSync('daten', { recursive: true });
const DB = resolve(`daten/selbsttest-f92-${lauf}.db`);
process.env.DB_DATEI = DB;
const GEHEIM = 'whsec_nur_fuer_den_selbsttest_f92', pw = 'Geheim-Passwort-123', admin = `f92.${lauf}@example.com`;
const ausgeben = console.log.bind(console);
console.warn = () => {}; console.error = () => {}; console.log = () => {};
let ok = 0, schlecht = 0;
const pruefe = (n, b, d = '') => { b ? ok++ : schlecht++; ausgeben(`${b ? 'OK     ' : 'FEHLER '} ${n}${!b && d ? '  -> ' + d : ''}`); };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const signierer = new Stripe('sk_test_attrappe_ohne_netz', { apiVersion: '2025-07-30.basil' });
const attrappe = { webhooks: signierer.webhooks };
async function webhook(typ, objekt, id = `evt_f92_${Math.random().toString(36).slice(2, 12)}`) {
  const payload = JSON.stringify({ id, object: 'event', type: typ, livemode: false, data: { object: objekt } });
  const r = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signierer.webhooks.generateTestHeaderString({ payload, secret: GEHEIM }) }, body: payload });
  return r.status;
}
let server;
try {
  const a = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/admin-anlegen.mjs', admin], { env: { ...process.env, DB_DATEI: DB, ADMIN_PASSWORT: pw }, encoding: 'utf8' });
  pruefe('Admin angelegt', a.stdout.trim() === 'Admin angelegt', a.stdout + a.stderr);
  const d = new DatabaseSync(DB); const z = new Date().toISOString();
  d.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES ('K1','b',10000,'eur','veroeffentlicht',?,?)").run(z, z);
  d.prepare("INSERT INTO benutzer (email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES (?, 'x','kunde',?,?)").run(`k.${lauf}@example.com`, z, Date.now());
  const u = d.prepare('SELECT id FROM benutzer WHERE email=?').get(`k.${lauf}@example.com`).id;
  const best = (s, pi, b, w) => d.prepare("INSERT INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,art,status,erstellt,geaendert) VALUES (?,?,?,1,?,?,'einmal','bezahlt',?,?)").run(s, pi, u, b, w, z, z);
  best('cs_f92a' + lauf, 'pi_f92a' + lauf, 10000, 'eur'); best('cs_f92b' + lauf, 'pi_f92b' + lauf, 2500, 'eur'); best('cs_f92c' + lauf, 'pi_f92c' + lauf, 3990000, 'huf');
  d.close();
  const { erstelleServer } = await import('../app.mjs');
  const dateiOrdner = mkdtempSync(join(tmpdir(), 'f92-dateien-'));
  server = erstelleServer({ stripe: attrappe, webhookSecret: GEHEIM, base: BASE, dateiOrdner }).listen(PORT, '127.0.0.1');
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/api/anbieter'); break; } catch { await warte(250); } }
  const li = await fetch(BASE + '/api/anmelden', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ email: admin, passwort: pw }) });
  const cookie = (li.headers.get('set-cookie') || '').split(';')[0];
  const kz = async () => { const r = await fetch(BASE + '/api/admin/kennzahlen', { headers: { Cookie: cookie } }); return r.json(); };
  const umsatz = (k, w) => k.umsatz?.find((x) => x.waehrung === w)?.cent;
  let k = await kz();
  pruefe('Vorher: Umsatz EUR 12500 cent', umsatz(k, 'eur') === 12500, JSON.stringify(k.umsatz));
  const charge = (pi, amount, refunded, refundIds) => ({ id: 'ch_' + pi, object: 'charge', payment_intent: pi, amount, amount_refunded: refunded, refunded: refunded >= amount, currency: 'eur',
    refunds: { object: 'list', has_more: false, data: refundIds.map(([id, betrag]) => ({ id, object: 'refund', amount: betrag, status: 'succeeded' })) } });
  pruefe('Teilerstattung 3000 von 10000: Webhook 200', await webhook('charge.refunded', charge('pi_f92a' + lauf, 10000, 3000, [['re_f92a1', 3000]])) === 200);
  k = await kz();
  pruefe('Umsatz EUR = 12500 - 3000 = 9500 cent', umsatz(k, 'eur') === 9500, JSON.stringify(k.umsatz));
  pruefe('Bestellung bleibt bezahlt (Zaehler 3)', k.bestellungen === 3, String(k.bestellungen));
  pruefe('Umsatz ist ganze Zahl (kein Gleitkomma)', Number.isSafeInteger(umsatz(k, 'eur')), String(umsatz(k, 'eur')));
  pruefe('Dasselbe Ereignis erneut (andere Ereignis-ID, gleicher Stand): kein Doppelabzug', await webhook('charge.refunded', charge('pi_f92a' + lauf, 10000, 3000, [['re_f92a1', 3000]])) === 200 && umsatz(await kz(), 'eur') === 9500);
  pruefe('Zweite Teilerstattung (kumulativ 4500): Umsatz 8000', await webhook('charge.refunded', charge('pi_f92a' + lauf, 10000, 4500, [['re_f92a1', 3000], ['re_f92a2', 1500]])) === 200 && umsatz(await kz(), 'eur') === 8000, JSON.stringify((await kz()).umsatz));
  pruefe('Aelteres Ereignis spaeter zugestellt (kumulativ 3000): bleibt 8000', await webhook('charge.refunded', charge('pi_f92a' + lauf, 10000, 3000, [['re_f92a1', 3000]])) === 200 && umsatz(await kz(), 'eur') === 8000);
  const hufCharge = { ...charge('pi_f92c' + lauf, 3990000, 990000, [['re_f92c1', 990000]]), currency: 'huf' };
  pruefe('HUF-Teilerstattung: Webhook 200', await webhook('charge.refunded', hufCharge) === 200);
  k = await kz();
  pruefe('Waehrungen getrennt: HUF 3000000, EUR 8000', umsatz(k, 'huf') === 3000000 && umsatz(k, 'eur') === 8000, JSON.stringify(k.umsatz));
  pruefe('Vollerstattung der 2500: Umsatz EUR 5500, Erstattungen 1', await webhook('charge.refunded', charge('pi_f92b' + lauf, 2500, 2500, [['re_f92b1', 2500]])) === 200 && umsatz(k = await kz(), 'eur') === 5500 && k.erstattungen === 1, JSON.stringify(k));
} finally {
  if (server) await new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); });
  await warte(300);
  for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s, { force: true }); } catch { /* Windows */ } }
}
ausgeben(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`); process.exit(schlecht ? 1 : 0);
