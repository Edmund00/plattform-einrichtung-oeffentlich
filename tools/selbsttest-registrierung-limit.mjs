import './test-sprache.mjs';
// Block 1 der Gesamtpruefung (12.11.2026), F-03 (b): Rate-Limit der Registrierung im Normalbetrieb (Port 4484, Mock-Stripe, keine echten Mails).
// Je IP-Adresse und je Zieladresse, gespeichert in SQLite (ueberlebt einen Neustart), Grenzwerte als Konstanten, parallele Anfragen.
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dir = mkdtempSync(join(tmpdir(), 'schulung-reg-limit-'));
process.env.DB_DATEI = join(dir, 'test.db');
let ok = 0, fail = 0, server;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + String(d).slice(0, 300))); };
const PORT = 4484, BASE = 'http://127.0.0.1:' + PORT;
const stripe = { customers: { create: async () => ({ id: 'cus_x' }), update: async () => ({}) }, checkout: { sessions: { create: async () => ({ id: 'cs', url: 'https://checkout.stripe.com/x' }), retrieve: async () => ({}), list: async () => ({ data: [] }), expire: async () => ({}) } },
  paymentIntents: { retrieve: async (id) => ({ id }) }, refunds: { create: async () => ({ id: 're' }), list: async () => ({ data: [] }) }, billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/x' }) } }, webhooks: { constructEvent: () => ({}) } };
const reg = async (ip, email, extra = {}) => {
  const r = await fetch(BASE + '/api/registrieren', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, 'X-Forwarded-For': ip },
    body: JSON.stringify({ email, passwort: 'SehrLangesPasswort123!', zustimmung: true, ...extra }) });
  let d = {}; try { d = await r.json(); } catch { /* */ }
  return { s: r.status, d };
};
let nr = 0; const neu = () => `nutzer${++nr}@example.com`;
const mails = [];
try {
  const { db } = await import('../db.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const L = await import('../registrierung-limit.mjs');
  const starte = () => erstelleServer({ stripe, base: BASE, webhookSecret: 'x', mailer: async (m) => { mails.push(m.to); return true; }, verkaufsmeldungMail: 'betreiber@example.net', dateiOrdner: join(dir, 'dateien'), ellallasWiederaufnahme: false, abgleichAutomatik: false, trustProxy: 1 }).listen(PORT, '127.0.0.1');
  server = starte();
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  check('Grenzwerte sind Konstanten (je IP und Stunde 10, je Adresse und Tag 3)', L.REG_MAX_JE_IP_STUNDE === 10 && L.REG_MAX_JE_ADRESSE_TAG === 3, JSON.stringify([L.REG_MAX_JE_IP_STUNDE, L.REG_MAX_JE_ADRESSE_TAG]));
  // 1) je IP
  const codes = []; for (let i = 0; i < L.REG_MAX_JE_IP_STUNDE + 2; i++) codes.push((await reg('10.2.0.1', neu())).s);
  check(`je IP: ${L.REG_MAX_JE_IP_STUNDE} Registrierungen 201, danach 429`, codes.slice(0, L.REG_MAX_JE_IP_STUNDE).every((c) => c === 201) && codes.slice(L.REG_MAX_JE_IP_STUNDE).every((c) => c === 429), codes.join(','));
  const r429 = await reg('10.2.0.1', neu());
  check('je IP: Fehlercode registrierung_limit mit Text', r429.s === 429 && r429.d.fehler === 'registrierung_limit' && typeof r429.d.text === 'string' && r429.d.text.length > 10, JSON.stringify(r429.d));
  check('je IP: andere Adresse (IP) weiter 201', (await reg('10.2.0.2', neu())).s === 201);
  // 2) je Zieladresse (Gross-/Kleinschreibung zaehlt als dieselbe Adresse)
  const ziel = 'opfer@example.com';
  const z = [await reg('10.2.1.1', ziel), await reg('10.2.1.2', 'OPFER@example.com'), await reg('10.2.1.3', ziel), await reg('10.2.1.4', ziel)].map((x) => x.s);
  check(`je Zieladresse: ${L.REG_MAX_JE_ADRESSE_TAG} Versuche (201, 409, 409), danach 429 auch von neuer IP`, z.join(',') === '201,409,409,429', z.join(','));
  // 2b) eigene Maschine (lokale Selbsttests): keine IP-Grenze, aber Grenze je Zieladresse gilt
  const lok = []; for (let i = 0; i < L.REG_MAX_JE_IP_STUNDE + 5; i++) lok.push((await reg('127.0.0.1', neu())).s);
  check('lokal (127.0.0.1): keine IP-Grenze (alle 201)', lok.every((c) => c === 201), lok.join(','));
  const lokZiel = [await reg('127.0.0.1', 'lokal-ziel@example.com'), await reg('::1', 'lokal-ziel@example.com'), await reg('127.0.0.1', 'lokal-ziel@example.com'), await reg('127.0.0.1', 'lokal-ziel@example.com')].map((x) => x.s);
  check('lokal: Grenze je Zieladresse gilt trotzdem (201,409,409,429)', lokZiel.join(',') === '201,409,409,429', lokZiel.join(','));
  // 2c) Plus-/Punkt-Varianten derselben Gmail-Adresse zaehlen als EINE Zieladresse (Angreifer-Fund P2)
  const gm = [await reg('10.2.5.1', 'opfergm@gmail.com'), await reg('10.2.5.2', 'opfergm+a@gmail.com'), await reg('10.2.5.3', 'opf.ergm@gmail.com'), await reg('10.2.5.4', 'o.pfergm+b@googlemail.com')].map((x) => x.s);
  check('Plus-/Punkt-/googlemail-Varianten zaehlen als eine Zieladresse (201,201,201,429)', gm.join(',') === '201,201,201,429', gm.join(','));
  const nichtGm = [await reg('10.2.5.5', 'ab.c@example.com'), await reg('10.2.5.6', 'abc@example.com')].map((x) => x.s);
  check('Punkte bei Nicht-Gmail-Adressen bleiben verschiedene Adressen (201,201)', nichtGm.join(',') === '201,201', nichtGm.join(','));
  // 2d) in Produktion keine Ausnahme fuer 127.x (auch nicht per gefaelschtem X-Forwarded-For bei mehreren Proxys)
  L.registrierungLimitKonfig({ lokalAusnahme: false });
  const prod = []; for (let i = 0; i < L.REG_MAX_JE_IP_STUNDE + 2; i++) prod.push((await reg('127.0.0.9', neu())).s);
  L.registrierungLimitKonfig({ lokalAusnahme: true });
  check('Produktion (lokalAusnahme aus): 127.x faellt unter die IP-Grenze (10 x 201, dann 429)', prod.slice(0, L.REG_MAX_JE_IP_STUNDE).every((c) => c === 201) && prod.slice(L.REG_MAX_JE_IP_STUNDE).every((c) => c === 429), prod.join(','));
  // 3) ungueltige Anfragen verbrauchen nichts
  for (let i = 0; i < 15; i++) await reg('10.2.2.1', 'kein-mail');
  check('ungueltige E-Mail (400) zaehlt nicht, danach gueltige Registrierung 201', (await reg('10.2.2.1', neu())).s === 201);
  // 4) parallel: genau die Grenze kommt durch
  const par = await Promise.all(Array.from({ length: 25 }, () => reg('10.2.3.1', neu())));
  const n201 = par.filter((x) => x.s === 201).length, n429 = par.filter((x) => x.s === 429).length;
  check(`parallel 25 Anfragen von einer IP: genau ${L.REG_MAX_JE_IP_STUNDE} x 201, Rest 429`, n201 === L.REG_MAX_JE_IP_STUNDE && n429 === 25 - L.REG_MAX_JE_IP_STUNDE, `${n201} / ${n429}`);
  const parZiel = await Promise.all(Array.from({ length: 8 }, (_, i) => reg('10.2.4.' + (i + 1), 'parallel-ziel@example.com')));
  const pz = parZiel.map((x) => x.s).sort().join(',');
  check('parallel 8 Anfragen an dieselbe Zieladresse: 1 x 201, 2 x 409, 5 x 429', pz === '201,409,409,429,429,429,429,429', pz);
  check('genau ein Konto je Zieladresse', db.prepare("SELECT COUNT(*) n FROM benutzer WHERE email='parallel-ziel@example.com'").get().n === 1);
  // 5) persistent: Neustart des Servers mit derselben Datenbank
  server.close(); await new Promise((r) => setTimeout(r, 200));
  server = starte(); await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  check('persistent: nach Neustart bleibt die IP gesperrt (429)', (await reg('10.2.0.1', neu())).s === 429);
  check('persistent: Zaehler liegen in SQLite (nur Hashwerte, keine Klartext-Adresse/IP)', db.prepare('SELECT COUNT(*) n FROM registrierung_versuche').get().n > 0
    && db.prepare("SELECT COUNT(*) n FROM registrierung_versuche WHERE schluessel LIKE '%10.2.%' OR schluessel LIKE '%@%'").get().n === 0);
  // 6) Fenster laeuft ab: alte Eintraege zaehlen nicht mehr und werden aufgeraeumt
  db.prepare('UPDATE registrierung_versuche SET zeit = zeit - ?').run(25 * 3600 * 1000);
  check('nach Ablauf des Fensters: IP und Zieladresse wieder frei', (await reg('10.2.0.1', neu())).s === 201 && (await reg('10.2.9.9', ziel)).s === 409);
  check('Speicher mit Obergrenze: abgelaufene Eintraege geloescht', db.prepare('SELECT COUNT(*) n FROM registrierung_versuche WHERE zeit < ?').get(Date.now() - 24 * 3600 * 1000).n === 0);
  check('feste Obergrenze der Tabelle als Konstante vorhanden', Number.isInteger(L.REG_MAX_EINTRAEGE) && L.REG_MAX_EINTRAEGE >= 1000);
  // Obergrenze: Tabelle kann nicht ueber REG_MAX_EINTRAEGE wachsen
  const ins = db.prepare('INSERT INTO registrierung_versuche (art, schluessel, zeit) VALUES (?, ?, ?)'), jetzt = Date.now();
  db.exec('BEGIN'); for (let i = 0; i < L.REG_MAX_EINTRAEGE + 50; i++) ins.run('ip', 'fuell' + i, jetzt - 1000); db.exec('COMMIT');
  await reg('10.2.8.1', neu());
  check('Obergrenze: nach einer Registrierung hoechstens REG_MAX_EINTRAEGE Zeilen', db.prepare('SELECT COUNT(*) n FROM registrierung_versuche').get().n <= L.REG_MAX_EINTRAEGE, db.prepare('SELECT COUNT(*) n FROM registrierung_versuche').get().n);
  check('Texte registrierung_limit in de/en/hu vorhanden', ['de', 'en', 'hu'].every((l) => typeof JSON.parse(readFileSync(new URL('../texte/' + l + '.json', import.meta.url), 'utf8')).registrierung_limit === 'string'));
} finally { server?.close(); }
console.log(`Registrierung-Limit: ${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
