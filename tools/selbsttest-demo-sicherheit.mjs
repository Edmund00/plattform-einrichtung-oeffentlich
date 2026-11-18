import './test-sprache.mjs';
// Block 1 der Gesamtpruefung (12.11.2026): Demo-Sicherheit (Port 4483, Mock-Stripe, keine Mails, kein Netz).
// F-01: Demo-Schutz greift VOR allen /api/admin*-Routern (auch /api/admin/agent), die Bearer-Agent-API /api/agent bleibt unberuehrt.
// F-02: Sperren gelten fuer jede Schreibweise (/api/Admin, /API/admin, /api/ADMIN, Schraegstrich am Ende, doppelte Schraegstriche).
// F-03/A4-03: Registrierung im Demo-Modus fuer Besucher gesperrt (Demo-Kaeufer nur ueber den Knopf).
// F-07: /api/gesundheit meldet im Demo-Modus ok:true mit sicherung:'demo', aber nur, wenn die Datenbank antwortet.
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
const dir = mkdtempSync(join(tmpdir(), 'schulung-demo-sicherheit-'));
process.env.DB_DATEI = join(dir, 'test.db');
let ok = 0, fail = 0, server;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + String(d).slice(0, 300))); };
const PORT = 4483, BASE = 'http://127.0.0.1:' + PORT;
const stripe = { customers: { create: async () => ({ id: 'cus_demo' }), update: async () => ({}) },
  checkout: { sessions: { create: async () => ({ id: 'cs_demo', url: 'https://checkout.stripe.com/test' }), retrieve: async () => ({ payment_intent: 'pi_demo' }), list: async () => ({ data: [] }), expire: async () => ({}) } },
  paymentIntents: { retrieve: async (id) => ({ id }) }, refunds: { create: async () => ({ id: 're_demo' }), list: async () => ({ data: [] }) },
  billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/test' }) } }, webhooks: { constructEvent: () => ({}) } };
function client(ip) {
  const jar = new Map();
  return { async req(method, path, body, extra = {}) {
    const headers = { Origin: BASE, ...extra }; if (ip) headers['X-Forwarded-For'] = ip;
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    const text = await r.text(); let b = {}; try { b = JSON.parse(text); } catch { /* kein JSON */ }
    return { s: r.status, d: b, text };
  } };
}
// Alle Schreibweisen eines Pfades: Original, /API, /Admin, /ADMIN, ganz gross, Schraegstrich am Ende, doppelte Schraegstriche.
const schreibweisen = (p) => {
  const [pfad, q = ''] = p.split('?'); const qs = q ? '?' + q : '';
  const s = new Set([pfad, pfad.replace('/api/', '/API/'), pfad.replace('/admin', '/Admin'), pfad.replace('/admin', '/ADMIN'), pfad.toUpperCase().replace('/API/', '/api/'),
    pfad.toUpperCase(), pfad + '/', pfad.replace('/api/', '//api//'), pfad.replace('/admin/', '/admin//')]);
  return [...s].map((x) => x + qs);
};
try {
  const { db } = await import('../db.mjs');
  const demo = await import('../demo.mjs');
  const { erstelleServer } = await import('../app.mjs');
  await demo.demoSeedWennLeer();
  // nodeEnv 'production' wie auf Render (dort ohne Sicherungsschluessel): vorher meldete /api/gesundheit 503.
  server = erstelleServer({ stripe, base: BASE, webhookSecret: 'x', mailer: async () => true, dateiOrdner: join(dir, 'dateien'), ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: true, trustProxy: 1, nodeEnv: 'production' }).listen(PORT, '127.0.0.1');
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));

  // ---------- F-01: Agent-Verwaltung im Demo-Modus ----------
  const A = client('10.1.0.1');
  check('Demo-Admin-Start', (await A.req('POST', '/api/demo/zugang', { rolle: 'admin' })).s === 200);
  const vorSchluessel = db.prepare('SELECT COUNT(*) n FROM agent_schluessel').get().n;
  // ein offener Agent-Antrag, damit "entscheiden" ein echtes Ziel haette
  db.prepare("INSERT INTO agent_antraege (kurs_id,art,feld,vorher,nachher,erstellt,status) VALUES (1,'aendern','titel','A','Hack',?,'offen')").run(new Date().toISOString());
  const antragId = db.prepare('SELECT MAX(id) id FROM agent_antraege').get().id;
  const titelVor = db.prepare('SELECT titel FROM kurse WHERE id=1').get().titel;
  for (const [me, p, b] of [['POST', '/api/admin/agent/schluessel', { name: 'angriff' }], ['POST', '/api/admin/agent/schluessel/1/widerrufen', {}],
    ['POST', `/api/admin/agent/antraege/${antragId}/entscheiden`, { entscheidung: 'annehmen' }], ['POST', '/api/Admin/agent/schluessel', { name: 'angriff2' }],
    ['POST', '/API/admin/agent/schluessel', { name: 'angriff3' }], ['POST', '/api/admin/agent/schluessel/', { name: 'angriff4' }]]) {
    const r = await A.req(me, p, b);
    check(`F-01 Demo-Admin Agent-Schreibweg 403 nur Ansicht: ${me} ${p}`, r.s === 403 && r.d.fehler === 'demo_nur_ansicht', JSON.stringify([r.s, r.d]));
  }
  check('F-01 kein Agent-Schluessel angelegt, Antrag offen, Kurstitel unveraendert', db.prepare('SELECT COUNT(*) n FROM agent_schluessel').get().n === vorSchluessel
    && db.prepare('SELECT status FROM agent_antraege WHERE id=?').get(antragId).status === 'offen' && db.prepare('SELECT titel FROM kurse WHERE id=1').get().titel === titelVor);
  for (const p of ['/api/admin/agent/schluessel', '/api/admin/agent/antraege', '/api/admin/agent/protokoll']) {
    const r = await A.req('GET', p);
    check('F-01 Demo-Admin Agent-Lesen gesperrt wie geplant (sensibel, ADMIN_LESEN_GESPERRT): ' + p, r.s === 403 && r.d.fehler === 'demo_nur_ansicht', JSON.stringify([r.s, r.d]));
  }
  // Agent-API mit Bearer bleibt unberuehrt (cookiefrei, eigener Schutz)
  const geheim = 'vat_' + randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO agent_schluessel(name,schluessel_hash,vorschau,erstellt,laeuft_ab) VALUES(?,?,?,?,NULL)').run('test', createHash('sha256').update(geheim).digest('hex'), geheim.slice(0, 8), new Date().toISOString());
  const ag = await fetch(BASE + '/api/agent/kurse', { headers: { Authorization: 'Bearer ' + geheim } });
  check('F-01 Bearer-Agent-API /api/agent/kurse antwortet im Demo-Modus weiter (200)', ag.status === 200, ag.status);
  const agFalsch = await fetch(BASE + '/api/agent/kurse', { headers: { Authorization: 'Bearer vat_' + 'x'.repeat(43) } });
  check('F-01 Agent-API mit falschem Schluessel weiter 401 agent_auth', agFalsch.status === 401 && (await agFalsch.json()).fehler === 'agent_auth');
  db.prepare("UPDATE agent_schluessel SET widerrufen_am=? WHERE name='test'").run(new Date().toISOString());

  // ---------- F-02: Schreibweisen-Matrix ----------
  const sensibel = ['/api/admin/logins', '/api/admin/sicherung', '/api/admin/sicherung/letzte', '/api/admin/abgleich', '/api/admin/bunny/abgleich', '/api/admin/agent/protokoll', '/api/admin/widerrufe'];   // Block 4: Widerrufsliste (E-Mail-Adressen)
  for (const basis of sensibel) for (const p of schreibweisen(basis)) {
    const r = await A.req('GET', p);
    check('F-02 Demo-Admin sensibler Leseweg 403: ' + p, r.s === 403, JSON.stringify([r.s, r.text.slice(0, 80)]));
  }
  for (const basis of ['/api/admin/ereignisse?format=csv', '/api/admin/ereignisse?format=json']) for (const p of schreibweisen(basis)) {
    const r = await A.req('GET', p);
    check('F-02 Demo-Admin Export (CSV/JSON mit E-Mail) 403: ' + p, r.s === 403 && !/@/.test(r.text), JSON.stringify([r.s, r.text.slice(0, 80)]));
  }
  const vorKurse = db.prepare('SELECT COUNT(*) n FROM kurse').get().n;
  for (const [me, basis, b] of [['POST', '/api/admin/kurse', { titel: 'X', preis_cent: 100 }], ['PATCH', '/api/admin/kurse/1', { titel: 'Hack' }], ['POST', '/api/admin/sicherung/jetzt', { art: 'manuell' }],
    ['POST', '/api/admin/verkauf/pausieren', {}], ['POST', '/api/admin/kurspaket/pruefen', {}]]) for (const p of schreibweisen(basis)) {
    const r = await A.req(me, p, b);
    check(`F-02 Demo-Admin Schreibweg 403: ${me} ${p}`, r.s === 403, JSON.stringify([r.s, r.text.slice(0, 80)]));
  }
  check('F-02 nach allen Schreibversuchen: Kurse und Titel unveraendert', db.prepare('SELECT COUNT(*) n FROM kurse').get().n === vorKurse && db.prepare('SELECT titel FROM kurse WHERE id=1').get().titel === titelVor);
  for (const p of ['/api/admin/kurse', '/api/Admin/kurse', '/api/admin/kurse/', '/api/admin/kennzahlen', '/api/ADMIN/kennzahlen', '/api/admin/bestellungen', '/api/admin/ereignisse']) {
    const r = await A.req('GET', p);
    check('F-02 Demo-Admin normale Leseseite weiter 200: ' + p, r.s === 200, JSON.stringify([r.s, r.text.slice(0, 80)]));
  }
  check('F-02 Abmelden bleibt moeglich (auch /api/Abmelden)', (await A.req('POST', '/api/Abmelden', {})).s === 200);
  // Demo-Kaeufer
  const K = client('10.1.0.2');
  check('Demo-Kaeufer-Start', (await K.req('POST', '/api/demo/zugang', { rolle: 'kaeufer' })).s === 200);
  for (const basis of ['/api/admin/kurse', '/api/admin/logins', '/api/admin/ereignisse?format=csv']) for (const p of schreibweisen(basis)) {
    const r = await K.req('GET', p);
    check('F-02 Demo-Kaeufer Admin-Leseweg 403: ' + p, r.s === 403 && !/@/.test(r.text), JSON.stringify([r.s, r.text.slice(0, 80)]));
  }
  for (const [me, basis, b] of [['POST', '/api/konto/email-aendern', { email: 'fremd@example.org', passwort: 'x' }], ['POST', '/api/konto/loeschen', { passwort: 'x' }], ['POST', '/api/passwort-aendern', { alt: 'a', neu: 'b' }]]) {
    const varianten = [basis, basis.toUpperCase(), basis.replace('/api/', '/API/'), basis.replace('/konto/', '/Konto/').replace('/passwort-', '/Passwort-'), basis + '/', basis.replace('/api/', '//api//')];
    for (const p of varianten) { const r = await K.req(me, p, b); check(`F-02 Demo-Kaeufer gesperrt: ${me} ${p}`, r.s === 403 || r.s === 404, JSON.stringify([r.s, r.d])); }
    const r = await K.req(me, basis.toUpperCase(), b);
    check(`F-02 Demo-Kaeufer Grossschreibung wird von der Sperre erkannt (demo_gesperrt): ${basis.toUpperCase()}`, r.s === 403 && r.d.fehler === 'demo_gesperrt', JSON.stringify([r.s, r.d]));
  }
  check('F-02 Demo-Kaeufer normale Seiten weiter 200 (/api/ich, /api/kurse)', (await K.req('GET', '/api/ich')).s === 200 && (await K.req('GET', '/api/kurse')).s === 200);
  // Gast (ohne Sitzung)
  const G = client('10.1.0.3');
  for (const basis of ['/api/admin/logins', '/api/admin/ereignisse?format=csv', '/api/admin/kurse']) for (const p of schreibweisen(basis)) {
    const r = await G.req('GET', p);
    check('F-02 Gast Admin-Leseweg 401/403 (doppelter Schraegstrich: 404, nicht geroutet): ' + p, (r.s === 401 || r.s === 403 || (p.includes('//') && r.s === 404)) && !/@/.test(r.text), JSON.stringify([r.s, r.text.slice(0, 80)]));
  }
  check('F-02 Gast normale Seiten 200 (/, /api/kurse, /api/texte)', (await G.req('GET', '/')).s === 200 && (await G.req('GET', '/api/kurse')).s === 200 && (await G.req('GET', '/api/texte')).s === 200);

  // ---------- F-03 (a) / A4-03: Registrierung im Demo-Modus ----------
  const vorBenutzer = db.prepare('SELECT COUNT(*) n FROM benutzer').get().n;
  for (const p of ['/api/registrieren', '/api/Registrieren', '/API/REGISTRIEREN', '/api/registrieren/', '//api//registrieren']) {
    const r = await client('10.1.0.4').req('POST', p, { email: 'opfer' + Math.random().toString(36).slice(2) + '@example.org', passwort: 'SehrLangesPasswort123!', zustimmung: true });
    check('F-03 Demo: Registrierung fuer Besucher gesperrt (403): ' + p, r.s === 403 || (p.startsWith('//') && r.s === 404), JSON.stringify([r.s, r.d]));
  }
  const rTxt = await client('10.1.0.4').req('POST', '/api/registrieren', { email: 'opfer@example.org', passwort: 'SehrLangesPasswort123!', zustimmung: true });
  check('F-03 Demo: Fehlercode demo_registrierung', rTxt.s === 403 && rTxt.d.fehler === 'demo_registrierung', JSON.stringify(rTxt.d));
  for (const [l, teil] of [['de', 'Demo-Käufer'], ['en', 'demo buyer'], ['hu', 'demó vásárló']]) {
    const r = await client('10.1.0.5').req('POST', '/api/registrieren?lang=' + l, { email: 'x@example.org', passwort: 'SehrLangesPasswort123!', zustimmung: true });
    check('F-03 Demo: Hinweis verstaendlich in ' + l, r.s === 403 && (r.d.text || '').includes(teil), JSON.stringify(r.d));
  }
  check('F-03 Demo: kein Konto mit fremder Adresse entstanden', db.prepare('SELECT COUNT(*) n FROM benutzer').get().n === vorBenutzer && db.prepare("SELECT COUNT(*) n FROM benutzer WHERE email LIKE '%example.org'").get().n === 0);
  check('F-03 Demo: Demo-Kaeufer-Knopf funktioniert weiter', (await client('10.1.0.6').req('POST', '/api/demo/zugang', { rolle: 'kaeufer' })).s === 200);

  // ---------- F-07: /api/gesundheit im Demo-Modus ----------
  const g = await G.req('GET', '/api/gesundheit');
  check("F-07 Demo: /api/gesundheit 200 mit ok:true und sicherung:'demo' (nodeEnv production, ohne Sicherungsschluessel)", g.s === 200 && g.d.ok === true && g.d.sicherung === 'demo', JSON.stringify([g.s, g.d]));
  db.close();   // Datenbank antwortet nicht mehr
  const g2 = await G.req('GET', '/api/gesundheit');
  check('F-07 Demo: ohne antwortende Datenbank 503 ok:false', g2.s === 503 && g2.d.ok === false, JSON.stringify([g2.s, g2.d]));
} finally { server?.close(); }
console.log(`Demo-Sicherheit: ${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
