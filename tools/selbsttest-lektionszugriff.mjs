import './test-sprache.mjs';
// Gesamtpruefung Block 2: Lektionstext nur ueber ?lektion=<id> und nur mit Zugang. Pruefung gegen Entwurf, Lektion eines fremden Kurses, fehlenden Zugang,
// Kursseite ohne Parameter und erster Zugriff (Widerruf). Port 4442, Mock-Stripe, Temp-DB, Demo-Kaeufer als Kunde.
import { mkdtempSync } from 'node:fs'; import { join } from 'node:path'; import { tmpdir } from 'node:os';
const dir = mkdtempSync(join(tmpdir(), 'schulung-lektion-')); process.env.DB_DATEI = join(dir, 'test.db');
let ok = 0, fail = 0; const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + String(d).slice(0, 200))); };
const PORT = 4442, B = 'http://127.0.0.1:' + PORT; let server;
const stripe = { customers: { create: async () => ({ id: 'cus_x' }), update: async () => ({}) }, checkout: { sessions: { create: async () => ({ id: 'cs', url: 'https://checkout.stripe.com/x' }), retrieve: async () => ({}), list: async () => ({ data: [] }), expire: async () => ({}) } }, paymentIntents: { retrieve: async (id) => ({ id }) }, refunds: { create: async () => ({ id: 're' }), list: async () => ({ data: [] }) }, billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/x' }) } }, webhooks: { constructEvent: () => ({}) } };
try {
  const demo = await import('../demo.mjs'); const { erstelleServer } = await import('../app.mjs'); const { db } = await import('../db.mjs');
  await demo.demoSeedWennLeer();
  server = erstelleServer({ stripe, base: B, webhookSecret: 'x', mailer: async () => true, dateiOrdner: join(dir, 'd'), ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: true, trustProxy: 1 }).listen(PORT, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 800));
  const z = new Date().toISOString();
  const kursA = 1, kursB = 2; // Seed-Kurse
  const les = (kurs, titel, text, status) => Number(db.prepare("INSERT INTO lektionen (kurs_id,abschnitt,titel,art,inhalt,reihenfolge,status,erstellt,geaendert) VALUES (?,?,?,'text',?,?,?,?,?)").run(kurs, 'T', titel, text, 99, status, z, z).lastInsertRowid);
  const pub = les(kursA, 'Oeffentlich', 'GEHEIMTEXT-PUBLIC-A', 'veroeffentlicht'), entwurf = les(kursA, 'Entwurf', 'GEHEIMTEXT-ENTWURF-A', 'entwurf'), fremd = les(kursB, 'Fremd', 'GEHEIMTEXT-FREMD-B', 'veroeffentlicht');
  const zug = await fetch(B + '/api/demo/zugang', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rolle: 'kaeufer' }) });
  const ck = (zug.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const kid = db.prepare("SELECT benutzer_id FROM demo_konten WHERE art='kaeufer' ORDER BY benutzer_id DESC LIMIT 1").get().benutzer_id;
  const holen = async (pfad) => { const r = await fetch(B + pfad, { headers: { Cookie: ck } }); return { s: r.status, t: await r.text() }; };
  const zaehl = () => db.prepare('SELECT COUNT(*) n FROM erster_zugriff WHERE benutzer_id=?').get(kid).n;
  // ohne Zugang
  let r = await holen(`/api/kurse/${kursA}?lektion=${pub}`);
  check('ohne Zugang: kein Lektionstext, kein erster Zugriff', !r.t.includes('GEHEIMTEXT') && zaehl() === 0, r.t.slice(0, 120));
  db.prepare("INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt) VALUES (?,?,'zahlung',?)").run(kid, kursA, z);
  db.prepare("INSERT INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert) VALUES ('cs_l','pi_l',?,?,64900,'eur','bezahlt',?,?)").run(kid, kursA, z, z);
  // mit Zugang
  r = await holen(`/api/kurse/${kursA}`);
  check('Kursseite ohne ?lektion=: KEIN Lektionstext, kein erster Zugriff', !r.t.includes('GEHEIMTEXT') && zaehl() === 0, r.t.slice(0, 120));
  r = await holen(`/api/kurse/${kursA}?lektion=${entwurf}`);
  check('Entwurfs-Lektion: kein Text', !r.t.includes('GEHEIMTEXT-ENTWURF'), r.t.slice(0, 120));
  r = await holen(`/api/kurse/${kursA}?lektion=${fremd}`);
  check('Lektion eines FREMDEN Kurses ueber den eigenen Kurs: kein Text (IDOR)', !r.t.includes('GEHEIMTEXT-FREMD'), r.t.slice(0, 120));
  check('Entwurf/fremde Lektion zaehlt nicht als erster Zugriff', zaehl() === 0, String(zaehl()));
  r = await holen(`/api/kurse/${kursA}?lektion=${pub}`);
  check('veroeffentlichte eigene Lektion: Text kommt, erster Zugriff genau 1', r.t.includes('GEHEIMTEXT-PUBLIC-A') && zaehl() === 1, r.t.slice(0, 120) + ' / ' + zaehl());
  r = await holen(`/api/kurse/${kursA}?lektion=abc`); check('ungueltige Lektions-ID: kein Absturz (kein 500)', r.s !== 500, String(r.s));
  r = await holen(`/api/kurse/${kursB}?lektion=${fremd}`);
  check('Lektion eines Kurses OHNE Zugang: kein Text', !r.t.includes('GEHEIMTEXT-FREMD'), r.t.slice(0, 120));
} catch (e) { fail++; console.log('FEHLER Ausnahme: ' + String(e.stack || e).slice(0, 400)); }
finally { server?.close(); }
console.log(`Lektionszugriff: ${ok} bestanden, ${fail} fehlgeschlagen`); process.exit(fail ? 1 : 0);
