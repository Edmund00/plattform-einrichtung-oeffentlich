// Selbsttest F-93: Widerrufs-Mail nennt den TATSAECHLICH erstatteten Betrag (nicht nur den vollen Bestellbetrag).
// Fall 1: schon 4000 von 9900 HUF erstattet -> Widerruf erstattet den Rest 5900; Kunden- und Inhabermail nennen 5900 als erstatteten Betrag.
// Fall 2: ohne Vorerstattung -> erstatteter Betrag 9900. Fall 3: abgelehnter Widerruf -> keine Zeile "erstatteter Betrag". Stripe nur als Attrappe, Port 19693.
import './test-sprache.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
const dir = mkdtempSync(join(tmpdir(), 'schulung-f93-'));
process.env.DB_DATEI = join(dir, 'test.db');
const ausgeben = console.log.bind(console);
console.warn = () => {};
let ok = 0, fail = 0, server;
const check = (n, x, d = '') => { x ? ok++ : fail++; ausgeben((x ? 'OK     ' : 'FEHLER ') + n + (!x && d ? '  -> ' + d : '')); };
const BASE = 'http://127.0.0.1:19693', password = randomBytes(24).toString('hex');
const pi_rest = {}, refunds = [], mails = [];
const stripe = {
  paymentIntents: { retrieve: async (id) => ({ id, latest_charge: pi_rest[id] }) },
  refunds: { create: async (data) => { refunds.push(data); return { id: 're_f93_' + refunds.length, status: 'succeeded', amount: data.amount }; } },
  webhooks: { constructEvent: () => ({}) },
};
const mailer = async (m) => { mails.push(m); return true; };
try {
  const { db } = await import('../db.mjs');
  const { passwortHashen } = await import('../auth.mjs'), { erstelleServer } = await import('../app.mjs');
  const { formatGeld } = await import('../betrag.mjs');
  const T = (await import('../texte/hu.json', { with: { type: 'json' } })).default;
  const ph = await passwortHashen(password), z = new Date().toISOString();
  db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES('f93@example.com',?,'kunde',?,?)").run(ph, z, Date.now());
  const u = db.prepare("SELECT id FROM benutzer WHERE email='f93@example.com'").get().id;
  const k = Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES('F93 teszt','',990000,'huf','veroeffentlicht',?,?)").run(z, z).lastInsertRowid);
  const order = (id, alter = 1) => Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES(?,?,?,?,990000,'huf','bezahlt','einmal',?,?)")
    .run(id, 'pi_' + id, u, k, new Date(Date.now() - alter * 86400000).toISOString(), z).lastInsertRowid);
  const teil = order('cs_f93_teil'), voll = order('cs_f93_voll'), alt = order('cs_f93_alt', 20);
  pi_rest['pi_cs_f93_teil'] = { amount: 990000, amount_refunded: 400000 };
  server = erstelleServer({ stripe, base: BASE, webhookSecret: 'test', mailer, verkaufsmeldungMail: 'inhaber@example.com', dateiOrdner: join(dir, 'dateien'), ellallasWiederaufnahme: false }).listen(19693, '127.0.0.1');
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), Origin: BASE }, body: JSON.stringify(body) });
    const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
    return r.status;
  };
  await req('POST', '/api/anmelden', { email: 'f93@example.com', passwort: password });
  const geld = (c) => formatGeld(c, 'huf', 'hu'), zeile = T.ellallas_erstattet_betrag;
  const mailsFuer = async (bid, n = 2) => { for (let i = 0; i < 200; i++) { const m = mails.filter((x) => x.text.includes(': ' + bid + '\n')); if (m.length >= n) return m; await new Promise((r) => setTimeout(r, 20)); } return mails.filter((x) => x.text.includes(': ' + bid + '\n')); };
  check('Textschluessel ellallas_erstattet_betrag vorhanden (hu)', typeof zeile === 'string' && zeile.length > 3);
  check('Widerruf mit Vorerstattung: 200, Stripe-Erstattung nur Rest 590000', (await req('POST', `/api/bestellungen/${teil}/ellallas`, { bestaetigt: true })) === 200 && refunds.at(-1)?.amount === 590000);
  let m = await mailsFuer(teil);
  check('Kunden- und Inhabermail verschickt', m.length === 2, String(m.length));
  check('Beide Mails nennen den erstatteten Betrag 5900 HUF', m.length === 2 && m.every((x) => x.text.includes(zeile + ': ' + geld(590000))), m.map((x) => x.text).join(' ## ').slice(0, 600));
  check('Keine Mail nennt 9900 HUF als erstatteten Betrag', m.every((x) => !x.text.includes(zeile + ': ' + geld(990000))));
  check('HTML-Fassung nennt ebenfalls 5900 HUF', m.every((x) => typeof x.html !== 'string' || x.html.includes(geld(590000))));
  check('Widerruf ohne Vorerstattung: erstatteter Betrag 9900 HUF', (await req('POST', `/api/bestellungen/${voll}/ellallas`, { bestaetigt: true })) === 200 && (m = await mailsFuer(voll)).length === 2 && m.every((x) => x.text.includes(zeile + ': ' + geld(990000))));
  const st = await req('POST', `/api/bestellungen/${alt}/ellallas`, { bestaetigt: true });
  m = await mailsFuer(alt);
  check('Abgelehnter Widerruf (Frist): keine Zeile erstatteter Betrag', st === 409 && m.length >= 1 && m.every((x) => !x.text.includes(zeile)), st + ' ' + m.length);
} finally {
  if (server) await new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); });
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}
ausgeben(`\nF-93: ${ok} bestanden, ${fail} fehlgeschlagen`); process.exit(fail ? 1 : 0);
