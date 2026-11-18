// F-98: Einwilligung bei der Registrierung muss serverseitig erzwungen werden UND der Browser darf
// nicht fest "zustimmung: true" senden, sondern den echten Zustand des Hakens.
// Teil A: API (nur boolean true wird angenommen). Teil B: Quelltext public/kunde.js (Registrierungsformular).
// Aufruf: node --disable-warning=ExperimentalWarning tools/selbsttest-f98-zustimmung.mjs
import './test-sprache.mjs';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const PLATTFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const basis = mkdtempSync(join(tmpdir(), 'schulung-f98-')), datei = join(basis, 'f98.db');
process.env.DB_DATEI = datei;
const PORT = 19698;
const base = 'http://127.0.0.1:' + PORT;
const passwort = randomBytes(24).toString('hex');
let ok = 0, schlecht = 0, server;
const pruefe = (n, b, d = '') => { if (b) ok++; else schlecht++; console.log((b ? 'OK     ' : 'FEHLER ') + n + (!b && d ? '  -> ' + String(d).slice(0, 200) : '')); };
function sql(q, ...a) { const d = new DatabaseSync(datei); try { return d.prepare(q).all(...a); } finally { d.close(); } }
let ipZaehler = 10;
async function registrieren(body) {
  // Je Anfrage eigene IP, damit das Registrierungs-Limit nicht greift.
  const r = await fetch(base + '/api/registrieren', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.' + (ipZaehler++) }, body: JSON.stringify(body) });
  let d = {}; try { d = await r.json(); } catch { /* leer */ }
  return { s: r.status, d };
}
const stripe = { webhooks: { constructEvent: b => JSON.parse(b.toString()) }, customers: { create: async () => ({ id: 'cus_f98' }) },
  checkout: { sessions: { create: async () => ({ url: 'https://checkout.stripe.com/test' }) } }, subscriptions: { retrieve: async () => ({ metadata: {} }) } };
try {
  console.log('--- Teil A: Server erzwingt die Einwilligung');
  const { erstelleServer } = await import(pathToFileURL(resolve(PLATTFORM, 'app.mjs')).href);
  server = erstelleServer({ stripe, webhookSecret: 'fake', base, trustProxy: 1, mailer: async () => true }).listen(PORT, '127.0.0.1');
  await new Promise((a, b) => { if (server.listening) return a(); server.once('listening', a); server.once('error', b); });
  const faelle = [
    ['ohne Feld', undefined], ['false', false], ['Text "true"', 'true'], ['Zahl 1', 1], ['null', null], ['Objekt', { a: 1 }], ['Liste [true]', [true]],
  ];
  for (const [name, wert] of faelle) {
    const mail = 'f98-' + name.replace(/[^a-z0-9]/gi, '').toLowerCase() + '@example.com';
    const body = { email: mail, passwort }; if (wert !== undefined) body.zustimmung = wert;
    const r = await registrieren(body);
    pruefe('zustimmung ' + name + ': 400 zustimmung_noetig, kein Konto', r.s === 400 && r.d?.fehler === 'zustimmung_noetig' && sql('SELECT 1 FROM benutzer WHERE email=?', mail).length === 0, JSON.stringify(r));
  }
  const gut = await registrieren({ email: 'f98-gut@example.com', passwort, zustimmung: true });
  pruefe('zustimmung true (boolean): 201, Konto mit Einwilligungszeit', gut.s === 201 && sql('SELECT einwilligung_zeit z FROM benutzer WHERE email=?', 'f98-gut@example.com')[0]?.z, JSON.stringify(gut));

  console.log('--- Teil B: Fehlertexte');
  for (const l of ['hu', 'de', 'en']) {
    const T = JSON.parse(readFileSync(join(PLATTFORM, 'texte', l + '.json'), 'utf8'));
    pruefe('Text zustimmung_noetig vorhanden (' + l + ')', typeof T.zustimmung_noetig === 'string' && T.zustimmung_noetig.length > 10);
  }

  console.log('--- Teil C: Registrierungsformular in public/kunde.js sendet den echten Haken');
  const js = readFileSync(join(PLATTFORM, 'public', 'kunde.js'), 'utf8');
  const start = js.indexOf("name: 'elfogad'");
  const ende = js.indexOf('zeigen(urlap)', start);
  const teil = start > 0 && ende > start ? js.slice(start, ende) : '';
  pruefe('Registrierungsabschnitt gefunden (Haken elfogad, required)', /type: 'checkbox', name: 'elfogad', required: true/.test(js) && teil.length > 0);
  const aufruf = (teil.match(/api\('POST', '\/api\/registrieren',[^\n]*\)/) || [''])[0];
  pruefe('Aufruf /api/registrieren gefunden', aufruf.length > 0);
  pruefe('kein fest eingebautes zustimmung: true mehr', aufruf.length > 0 && !/zustimmung:\s*true/.test(aufruf), aufruf);
  pruefe('zustimmung kommt aus dem Haken (hozzajarul.checked === true)', /zustimmung:\s*hozzajarul\.checked\s*===\s*true/.test(aufruf), aufruf);
  pruefe('Senden prueft den Haken vor dem Aufruf (reportValidity)', /hozzajarul\.reportValidity\(\)/.test(teil.slice(0, teil.indexOf("'/api/registrieren'"))));
} catch (e) {
  schlecht++; console.log('FEHLER Ausnahme: ' + (e?.stack || e));
} finally {
  if (server) await new Promise(r => server.close(r));
  try { rmSync(basis, { recursive: true, force: true }); } catch { /* Temp */ }
}
console.log(`ERGEBNIS selbsttest-f98-zustimmung: ${ok} OK, ${schlecht} FEHLER`);
process.exit(schlecht ? 1 : 0);
