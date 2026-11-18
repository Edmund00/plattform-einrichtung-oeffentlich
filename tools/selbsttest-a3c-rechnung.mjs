// A3c: Anbieterdaten auf Stripe-Rechnung (Einmalkauf invoice_creation.invoice_data).
import './test-sprache.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ordner = mkdtempSync(join(tmpdir(), 'pe-a3c-'));
process.env.DB_DATEI = join(ordner, 'test.db');

let ok = 0, schlecht = 0;
const pruefe = (name, wert, detail = '') => {
  wert ? ok++ : schlecht++;
  console.log((wert ? 'OK     ' : 'FEHLER ') + name + (!wert && detail ? '  -> ' + String(detail).slice(0, 220) : ''));
};
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

const alleServer = [];
try {
  // ======== Mock-Stripe der alle checkout.sessions.create-Parameter festhält ===========
  const aufrufe = [];
  const attrappe = {
    webhooks: { constructEventAsync: async () => { throw new Error('kein webhook'); } },
    customers: { create: async (p) => ({ id: 'cus_attrappe_' + Math.random().toString(36).slice(2) }) },
    checkout: {
      sessions: {
        create: async (p) => {
          aufrufe.push(p);
          return { id: `cs_a3c_${aufrufe.length}`, url: `https://checkout.stripe.com/c/pay/cs_a3c_${aufrufe.length}`, status: 'open' };
        },
        list: async () => ({ data: [] }),
        expire: async (id) => ({ id, status: 'expired' }),
        retrieve: async (id) => ({ id, status: 'open', url: `https://checkout.stripe.com/c/pay/${id}`, metadata: {} }),
      },
    },
  };

  const { erstelleServer } = await import('../app.mjs');
  const { passwortHashen } = await import('../auth.mjs');
  const { db } = await import('../db.mjs');

  // Admin + Käufer anlegen
  const PASS = 'RechnungTest99';
  const ph = await passwortHashen(PASS);
  db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)")
    .run('admin@a3c.example.com', ph, 'admin', new Date().toISOString());
  db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)")
    .run('kaeufer@a3c.example.com', ph, 'kunde', new Date().toISOString());

  // Kurs anlegen
  const kursId = Number(db.prepare(
    "INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,?,?,?,?,?)"
  ).run('Testkurs A3c', 'Beschreibung', 9900, 'huf', 'veroeffentlicht', new Date().toISOString(), new Date().toISOString()).lastInsertRowid);

  const app = erstelleServer({
    stripe: attrappe, webhookSecret: 'whsec_test', base: 'http://localhost',
    nodeEnv: 'test', dbDatei: process.env.DB_DATEI,
  });
  const server = app.listen(0, '127.0.0.1');
  alleServer.push(server);
  await warte(300);
  const port = server.address().port;
  const BASE = `http://127.0.0.1:${port}`;

  async function req(cookie, methode, pfad, body) {
    const r = await fetch(BASE + pfad, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    return { status: r.status, json: () => JSON.parse(text), headers: r.headers };
  }

  async function anmelden(email) {
    const r = await req('', 'POST', '/api/anmelden', { email, passwort: PASS });
    return r.headers.get('set-cookie')?.split(';')[0] ?? '';
  }

  const adminCookie = await anmelden('admin@a3c.example.com');
  const kaeuferCookie = await anmelden('kaeufer@a3c.example.com');
  pruefe('Admin-Anmeldung', !!adminCookie, `cookie: ${adminCookie}`);
  pruefe('Käufer-Anmeldung', !!kaeuferCookie, `cookie: ${kaeuferCookie}`);

  // ======== (a) OHNE Anbieterdaten: invoice_creation = {enabled:true}, kein invoice_data ===========
  aufrufe.length = 0;
  let r = await req(kaeuferCookie, 'POST', `/api/kurse/${kursId}/kaufen`, { modell: 'einmal', zustimmung: true });
  pruefe('(a) Kauf ohne Anbieter → 200', r.status === 200, `status: ${r.status}`);
  pruefe('(a) checkout.sessions.create wurde aufgerufen', aufrufe.length === 1, `aufrufe: ${aufrufe.length}`);
  const pOhne = aufrufe[0];
  pruefe('(a) ohne Anbieter: invoice_creation.enabled = true', pOhne?.invoice_creation?.enabled === true, JSON.stringify(pOhne?.invoice_creation));
  pruefe('(a) ohne Anbieter: kein invoice_data', !pOhne?.invoice_creation?.invoice_data, JSON.stringify(pOhne?.invoice_creation));

  // ======== (e) ABO: kein invoice_creation ===========
  const aboKursId = Number(db.prepare(
    "INSERT INTO kurse(titel,beschreibung,preis_cent,abo_preis_cent,abo_intervall,waehrung,status,erstellt,geaendert) VALUES(?,?,?,?,?,?,?,?,?)"
  ).run('Abo A3c', 'Abo', 9900, 9900, 'month', 'huf', 'veroeffentlicht', new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
  aufrufe.length = 0;
  r = await req(kaeuferCookie, 'POST', `/api/kurse/${aboKursId}/kaufen`, { modell: 'abo', zustimmung: true });
  pruefe('(e) Abo-Kauf → 200', r.status === 200, `status: ${r.status}`);
  pruefe('(e) Abo: checkout.sessions.create wurde aufgerufen', aufrufe.length === 1, `aufrufe: ${aufrufe.length}`);
  const pAbo = aufrufe[0];
  pruefe('(e) Abo: kein invoice_creation', !pAbo?.invoice_creation, JSON.stringify(pAbo?.invoice_creation));
  pruefe('(e) Abo: mode = subscription', pAbo?.mode === 'subscription', pAbo?.mode);

  // ======== Anbieterdaten per Admin PUT ===========
  r = await req(adminCookie, 'POST', '/api/admin/stepup', { passwort: PASS });
  pruefe('Step-up Admin', r.status === 200, `stepup: ${r.status}`);

  const anbieter = {
    name: 'Musterfirma GmbH',
    anschrift: 'Hauptstraße 1, 12345 Musterstadt',
    telefon: '+49 30 1234567',
    email: 'info@musterfirma.example.com',
    adoszam: 'DE123456789',
    steuerHinweis: 'Steuerbefreit §4 UStG.',
  };
  r = await req(adminCookie, 'PUT', '/api/admin/marke/anbieter', anbieter);
  pruefe('Anbieterdaten gespeichert', r.status === 200, `status: ${r.status}`);

  // ======== (b) MIT Anbieterdaten ===========
  // Idempotency-Key für gleichen Kauf muss umgehen → neuer Kurs
  const kursId2 = Number(db.prepare(
    "INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,?,?,?,?,?)"
  ).run('Testkurs A3c 2', 'Beschreibung', 9900, 'huf', 'veroeffentlicht', new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
  aufrufe.length = 0;
  r = await req(kaeuferCookie, 'POST', `/api/kurse/${kursId2}/kaufen`, { modell: 'einmal', zustimmung: true });
  pruefe('(b) Kauf mit Anbieter → 200', r.status === 200, `status: ${r.status}`);
  pruefe('(b) checkout.sessions.create aufgerufen', aufrufe.length === 1, `aufrufe: ${aufrufe.length}`);
  const pMit = aufrufe[0];
  pruefe('(b) invoice_creation.enabled = true', pMit?.invoice_creation?.enabled === true, JSON.stringify(pMit?.invoice_creation?.enabled));
  pruefe('(b) invoice_data vorhanden', !!pMit?.invoice_creation?.invoice_data, JSON.stringify(pMit?.invoice_creation));
  const idMit = pMit?.invoice_creation?.invoice_data;
  pruefe('(b) footer enthält Name', (idMit?.footer ?? '').includes(anbieter.name), idMit?.footer);
  pruefe('(b) footer enthält Anschrift', (idMit?.footer ?? '').includes(anbieter.anschrift), idMit?.footer);
  pruefe('(b) footer enthält kein Steuerzeichen', !/[\x00-\x1f]/.test(idMit?.footer ?? ''), idMit?.footer);
  pruefe('(b) footer max 5000 Zeichen', (idMit?.footer?.length ?? 0) <= 5000, `len: ${idMit?.footer?.length}`);
  pruefe('(b) kein custom_fields', !idMit?.custom_fields, JSON.stringify(idMit?.custom_fields));
  pruefe('(b) footer enthält Steuer-/Reg.-Nr.', (idMit?.footer ?? '').includes('Steuer-/Reg.-Nr.'), idMit?.footer);
  pruefe('(b) footer enthält steuerHinweis', (idMit?.footer ?? '').includes(anbieter.steuerHinweis), idMit?.footer);
  pruefe('(b) footer enthält adoszam', (idMit?.footer ?? '').includes(anbieter.adoszam), idMit?.footer);
  pruefe('(b) footer-Reihenfolge: Name vor Steuer-/Reg.-Nr.', (idMit?.footer ?? '').indexOf(anbieter.name) < (idMit?.footer ?? '').indexOf('Steuer-/Reg.-Nr.'), idMit?.footer?.slice(0, 150));
  pruefe('(b) footer-Reihenfolge: Hinweis vor Anschrift', (idMit?.footer ?? '').indexOf(anbieter.steuerHinweis) < (idMit?.footer ?? '').indexOf(anbieter.anschrift), idMit?.footer?.slice(0, 150));

  // ======== (c) Änderung wirkt ohne Neustart ===========
  r = await req(adminCookie, 'PUT', '/api/admin/marke/anbieter', { ...anbieter, name: 'Neue Firma OHG', adoszam: 'AT999999999' });
  pruefe('(c) Anbieterdaten aktualisiert', r.status === 200, `status: ${r.status}`);
  const kursId3 = Number(db.prepare(
    "INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,?,?,?,?,?)"
  ).run('Testkurs A3c 3', 'Beschreibung', 9900, 'huf', 'veroeffentlicht', new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
  aufrufe.length = 0;
  r = await req(kaeuferCookie, 'POST', `/api/kurse/${kursId3}/kaufen`, { modell: 'einmal', zustimmung: true });
  pruefe('(c) Kauf mit neuem Anbieter → 200', r.status === 200, `status: ${r.status}`);
  const pNeu = aufrufe[0];
  pruefe('(c) footer enthält neuen Namen', (pNeu?.invoice_creation?.invoice_data?.footer ?? '').includes('Neue Firma OHG'), pNeu?.invoice_creation?.invoice_data?.footer);
  pruefe('(c) footer enthält NICHT alten Namen', !(pNeu?.invoice_creation?.invoice_data?.footer ?? '').includes('Musterfirma GmbH'), pNeu?.invoice_creation?.invoice_data?.footer);
  pruefe('(c) neues adoszam in footer', (pNeu?.invoice_creation?.invoice_data?.footer ?? '').includes('AT999999999'), pNeu?.invoice_creation?.invoice_data?.footer?.slice(0, 150));

  // ======== (d) Lange/bösartige Werte ===========
  const langer = {
    name: 'A'.repeat(160),          // NAME_MAX = 160, gültig
    anschrift: 'B\nC\nD',            // LF erlaubt (A3d); CR/TAB werden abgelehnt
    email: 'x@x.example.com',
    telefon: '+1 555 0000',
    adoszam: 'Z'.repeat(50),         // 50 Zeichen, gültig (TEXT_MAX=500) → im footer ungekürzt
    steuerHinweis: 'S'.repeat(80),   // 80 Zeichen → im footer ungekürzt (war früher auf 30 in custom_fields gekürzt)
  };
  r = await req(adminCookie, 'PUT', '/api/admin/marke/anbieter', langer);
  pruefe('(d) Langer Anbieter gespeichert', r.status === 200, `status: ${r.status}`);
  const kursId4 = Number(db.prepare(
    "INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,?,?,?,?,?)"
  ).run('Testkurs A3c 4', 'Beschreibung', 9900, 'huf', 'veroeffentlicht', new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
  aufrufe.length = 0;
  r = await req(kaeuferCookie, 'POST', `/api/kurse/${kursId4}/kaufen`, { modell: 'einmal', zustimmung: true });
  pruefe('(d) Kauf mit langen Werten → 200', r.status === 200, `status: ${r.status}`);
  const pLang = aufrufe[0];
  const idLang = pLang?.invoice_creation?.invoice_data;
  pruefe('(d) footer max 5000 Zeichen', (idLang?.footer?.length ?? 999) <= 5000, `len: ${idLang?.footer?.length}`);
  pruefe('(d) footer: kein Zeilenumbruch', !/[\r\n]/.test(idLang?.footer ?? ''), idLang?.footer?.slice(0, 50));
  pruefe('(d) kein custom_fields', !idLang?.custom_fields, JSON.stringify(idLang?.custom_fields));
  pruefe('(d) adoszam (50 Zeichen) in footer ungekürzt', (idLang?.footer ?? '').includes('Z'.repeat(50)), `footer: ${idLang?.footer?.slice(0, 150)}`);
  pruefe('(d) steuerHinweis (80 Zeichen) in footer ungekürzt', (idLang?.footer ?? '').includes('S'.repeat(80)), `footer: ${idLang?.footer?.slice(0, 150)}`);

  // ======== (f) 700-Zeichen-Footer geht vollständig durch (F-186) ===========
  // name=160, adoszam=100 (→ 'Steuer-/Reg.-Nr.: '+100=118), steuerHinweis=100,
  // anschrift=282, email=14, telefon=11, 5×sep=15 → Summe=700
  const anbieter700 = {
    name: 'N'.repeat(160), adoszam: 'A'.repeat(100), steuerHinweis: 'H'.repeat(100),
    anschrift: 'X'.repeat(282), email: 'e@e.example.de', telefon: '+1 234 5678',
  };
  r = await req(adminCookie, 'PUT', '/api/admin/marke/anbieter', anbieter700);
  pruefe('(f) 700-char-Anbieter gespeichert', r.status === 200, `status: ${r.status}`);
  const kursId5 = Number(db.prepare(
    "INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES(?,?,?,?,?,?,?)"
  ).run('Testkurs A3c 5', 'Beschreibung', 9900, 'huf', 'veroeffentlicht', new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
  aufrufe.length = 0;
  r = await req(kaeuferCookie, 'POST', `/api/kurse/${kursId5}/kaufen`, { modell: 'einmal', zustimmung: true });
  pruefe('(f) Kauf → 200', r.status === 200, `status: ${r.status}`);
  const idF = aufrufe[0]?.invoice_creation?.invoice_data;
  const footerF = idF?.footer ?? '';
  pruefe('(f) 700-char footer vollständig (kein Abschneiden)', footerF.length === 700, `len: ${footerF.length}`);
  pruefe('(f) footer beginnt mit N (name)', footerF.startsWith('N'), `start: ${footerF.slice(0, 10)}`);

  // ======== (g) Exportierte Konstanten und Summe der Feldmaxima < FOOTER_MAX ===========
  let FOOTER_MAX_v, NAME_MAX_v, TEXT_MAX_v, EMAIL_MAX_v, TELEFON_MAX_v;
  try {
    const zm = await import('../zahlung.mjs');
    FOOTER_MAX_v = zm.FOOTER_MAX;
    const am = await import('../anbieter.mjs');
    NAME_MAX_v = am.NAME_MAX;
    TEXT_MAX_v = am.TEXT_MAX;
    EMAIL_MAX_v = am.EMAIL_MAX;
    TELEFON_MAX_v = am.TELEFON_MAX;
  } catch {}
  pruefe('(g) FOOTER_MAX=5000 aus zahlung.mjs exportiert', FOOTER_MAX_v === 5000, `FOOTER_MAX=${FOOTER_MAX_v}`);
  pruefe('(g) NAME_MAX=160 aus anbieter.mjs exportiert', NAME_MAX_v === 160, `NAME_MAX=${NAME_MAX_v}`);
  pruefe('(g) TEXT_MAX=500 aus anbieter.mjs exportiert', TEXT_MAX_v === 500, `TEXT_MAX=${TEXT_MAX_v}`);
  pruefe('(g) EMAIL_MAX=254 aus anbieter.mjs exportiert', EMAIL_MAX_v === 254, `EMAIL_MAX=${EMAIL_MAX_v}`);
  pruefe('(g) TELEFON_MAX=50 aus anbieter.mjs exportiert', TELEFON_MAX_v === 50, `TELEFON_MAX=${TELEFON_MAX_v}`);
  // 18 = 'Steuer-/Reg.-Nr.: '.length, 5×3 = 5 Trennzeichen ' | '
  const feldSumme = (NAME_MAX_v ?? 0) + (18 + (TEXT_MAX_v ?? 0)) + (TEXT_MAX_v ?? 0) + (TEXT_MAX_v ?? 0) + (EMAIL_MAX_v ?? 0) + (TELEFON_MAX_v ?? 0) + 5 * 3;
  pruefe('(g) Summe aller Feldmaxima < FOOTER_MAX (Kürzung per API nicht erreichbar)', feldSumme < (FOOTER_MAX_v ?? 0), `${feldSumme} < ${FOOTER_MAX_v}`);

  // ======== (h) rechnungsErweiterung direkt: 4999 / 5000 / 5001 Zeichen ===========
  let rechnungsErweiterungFn;
  try {
    const zm2 = await import('../zahlung.mjs');
    rechnungsErweiterungFn = zm2.rechnungsErweiterung;
  } catch {}
  pruefe('(h) rechnungsErweiterung aus zahlung.mjs exportiert', typeof rechnungsErweiterungFn === 'function', `type: ${typeof rechnungsErweiterungFn}`);
  if (typeof rechnungsErweiterungFn === 'function') {
    const h4999 = rechnungsErweiterungFn({ name: 'N'.repeat(4999) })?.invoice_data?.footer;
    pruefe('(h) name=4999 → footer 4999 Zeichen (kein Abschneiden)', h4999?.length === 4999, `len: ${h4999?.length}`);
    const h5000 = rechnungsErweiterungFn({ name: 'N'.repeat(5000) })?.invoice_data?.footer;
    pruefe('(h) name=5000 → footer genau 5000 Zeichen', h5000?.length === 5000, `len: ${h5000?.length}`);
    const h5001 = rechnungsErweiterungFn({ name: 'N'.repeat(5001) })?.invoice_data?.footer;
    pruefe('(h) name=5001 → footer auf 5000 Zeichen gekürzt', h5001?.length === 5000, `len: ${h5001?.length}`);
    pruefe('(h) name=5001 → footer beginnt mit N', (h5001 ?? '').startsWith('N'), `start: ${(h5001 ?? '').slice(0, 5)}`);
  }

} finally {
  for (const s of alleServer) await new Promise((r) => s.close(r));
  try { rmSync(ordner, { recursive: true, force: true }); } catch {}
  console.log(`\nErgebnis: ${ok} OK, ${schlecht} FEHLER`);
  if (schlecht > 0) process.exit(1);
}
