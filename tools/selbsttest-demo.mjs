import './test-sprache.mjs';
// B9 Selbsttest DEMO-Modus (Port 4497, Mock-Stripe): Seed, Demo-Admin nur Ansicht (alle Schreibwege 403, Lesewege 200), Demo-Kaeufer, Rate-Limit, Mail-Filter.
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dir = mkdtempSync(join(tmpdir(), 'schulung-demo-'));
process.env.DB_DATEI = join(dir, 'test.db');
let ok = 0, fail = 0, server;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + String(d).slice(0, 200))); };
const PORT = 4497, BASE = 'http://127.0.0.1:' + PORT;
const stripe = { customers: { create: async () => ({ id: 'cus_demo' }), update: async () => ({}) },
  checkout: { sessions: { create: async () => ({ id: 'cs_demo', url: 'https://checkout.stripe.com/test' }), retrieve: async () => ({ payment_intent: 'pi_demo' }), list: async () => ({ data: [] }), expire: async () => ({}) } },
  paymentIntents: { retrieve: async (id) => ({ id }) }, refunds: { create: async () => ({ id: 're_demo' }), list: async () => ({ data: [] }) },
  billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/test' }) } }, webhooks: { constructEvent: () => ({}) } };
function client(ip) {
  const jar = new Map();
  return { async req(method, path, body) {
    const headers = { Origin: BASE }; if (ip) headers['X-Forwarded-For'] = ip;
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    let b = {}; try { b = await r.json(); } catch { /* kein JSON */ }
    return { s: r.status, d: b };
  } };
}
const mailsAn = [];
try {
  const { db } = await import('../db.mjs');
  const demo = await import('../demo.mjs');
  const { erstelleServer } = await import('../app.mjs');
  // --- Mail-Filter ---
  const m = demo.demoMailer(async (x) => { mailsAn.push(x.to); return true; });
  await m({ to: 'demo-ab12@example.com' }); await m({ to: 'demo-admin@example.com' }); await m({ to: 'inhaber@example.org' });
  check('Mail-Filter: Demo-Adressen werden nie versendet, andere Mails gehen durch', mailsAn.length === 1 && mailsAn[0] === 'inhaber@example.org', JSON.stringify(mailsAn));
  // --- Seed auf leerer DB ---
  check('Seed laeuft nur bei leerer DB (erster Aufruf true)', (await demo.demoSeedWennLeer()) === true);
  check('Seed: 3 Beispielkurse veroeffentlicht, 1 Demo-Admin, Lektionen vorhanden', db.prepare("SELECT COUNT(*) n FROM kurse WHERE status='veroeffentlicht'").get().n === 3 && db.prepare("SELECT COUNT(*) n FROM demo_konten WHERE art='admin'").get().n === 1 && db.prepare('SELECT COUNT(*) n FROM lektionen').get().n >= 6);
  check('Seed: zweiter Aufruf tut nichts (keine Doppelten)', (await demo.demoSeedWennLeer()) === false && db.prepare('SELECT COUNT(*) n FROM kurse').get().n === 3);
  const warnungen = []; const warnAlt = console.warn; console.warn = (...a) => { warnungen.push(a.join(' ')); };   // Start der Demo MIT gesetztem ADMIN_ERLAUBT (wie auf Render)
  server = erstelleServer({ adminErlaubt: ['betreiber@example.net'], stripe, base: BASE, webhookSecret: 'x', mailer: async () => true, dateiOrdner: join(dir, 'dateien'), ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: true, trustProxy: 1 }).listen(PORT, '127.0.0.1');
  console.warn = warnAlt;
  check('Demo-Start mit ADMIN_ERLAUBT: keine Admin-Listenwarnung (Demo-Admin ist reine Ansicht)', !warnungen.some((w) => /ADMIN_ERLAUBT/.test(w)), warnungen.join(' | '));
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const an = await (await fetch(BASE + '/api/anbieter')).json();
  check('/api/anbieter meldet demo:true', an.demo === true);
  // --- Demo-Admin ---
  const A = client('10.0.0.1');
  check('Demo-Admin-Start (ein Klick)', (await A.req('POST', '/api/demo/zugang', { rolle: 'admin' })).s === 200);
  for (const p of ['/api/admin/kennzahlen', '/api/admin/kurse', '/api/admin/bestellungen', '/api/admin/ereignisse', '/api/admin/kurse/1/zugaenge', '/api/admin/verkauf'])
    check('Demo-Admin Lesen 200: ' + p, (await A.req('GET', p)).s === 200);
  for (const p of ['/api/admin/ereignisse?format=csv', '/api/admin/ereignisse?format=json', '/api/admin/sicherung', '/api/admin/sicherung/letzte', '/api/admin/logins', '/api/admin/abgleich', '/api/admin/bunny/abgleich'])
    check('Demo-Admin sensibler Leseweg 403: ' + p, (await A.req('GET', p)).s === 403, p);
  const vorKurse = db.prepare('SELECT COUNT(*) n FROM kurse').get().n, vorTitel = db.prepare('SELECT titel FROM kurse WHERE id=1').get().titel;
  const schreib = [['POST', '/api/admin/kurse', { titel: 'X', preis_cent: 100 }], ['PATCH', '/api/admin/kurse/1', { titel: 'Hack' }], ['POST', '/api/admin/kurse/1/veroeffentlichen', {}], ['POST', '/api/admin/kurse/1/archivieren', {}],
    ['DELETE', '/api/admin/kurse/1'], ['POST', '/api/admin/kurse/1/lektionen', { titel: 'L', abschnitt: 'A', art: 'text', inhalt: 'x' }], ['PATCH', '/api/admin/lektionen/1', { titel: 'Hack' }], ['DELETE', '/api/admin/lektionen/1'],
    ['POST', '/api/admin/kurse/1/zugaenge', { email: 'a@example.com' }], ['DELETE', '/api/admin/kurse/1/zugaenge/1'], ['POST', '/api/admin/bestellungen/1/freigeben', {}], ['POST', '/api/admin/verkauf/pausieren', {}], ['POST', '/api/admin/verkauf/fortsetzen', {}],
    ['POST', '/api/admin/sicherung/jetzt', { art: 'manuell' }], ['POST', '/api/admin/abgleich/jetzt', {}], ['POST', '/api/admin/abgleich/nachbuchen', {}], ['POST', '/api/admin/lektionen/1/bunny-upload', {}], ['POST', '/api/admin/kurspaket/anlegen', {}],
    ['POST', '/api/admin/kurspaket/pruefen', {}], ['PUT', '/api/admin/kurse/1', {}]];
  for (const [me, p, b] of schreib) { const r = await A.req(me, p, b); check(`Demo-Admin Schreibweg 403 "nur Ansicht": ${me} ${p}`, r.s === 403 && r.d.fehler === 'demo_nur_ansicht', JSON.stringify([r.s, r.d])); }
  check('Nach allen Schreibversuchen unveraendert (Kurse, Titel)', db.prepare('SELECT COUNT(*) n FROM kurse').get().n === vorKurse && db.prepare('SELECT titel FROM kurse WHERE id=1').get().titel === vorTitel);
  for (const [l, teil] of [['de', 'nur Ansicht'], ['en', 'view only'], ['hu', 'csak megtekintés']]) { const r = await A.req('POST', '/api/admin/kurse?lang=' + l, { titel: 'X' }); check('403-Hinweis verstaendlich in ' + l, r.s === 403 && (r.d.text || '').includes(teil), JSON.stringify(r.d)); }
  check('Abmelden bleibt moeglich', (await A.req('POST', '/api/abmelden', {})).s === 200);
  // --- Demo-Kaeufer ---
  const K = client('10.0.0.2');
  const k1 = await K.req('POST', '/api/demo/zugang', { rolle: 'kaeufer' });
  const ich = await K.req('GET', '/api/ich');
  check('Demo-Kaeufer-Start, angemeldet', k1.s === 200 && ich.d.angemeldet === true, JSON.stringify([k1, ich]));
  check('Demo-Kaeufer ist KEIN Admin (Admin-Wege 403)', (await K.req('GET', '/api/admin/kurse')).s === 403);
  for (const [me, p, b] of [['POST', '/api/passwort-aendern', { alt: 'a', neu: 'b' }], ['POST', '/api/konto/email-aendern', { email: 'fremd@example.org' }], ['POST', '/api/konto/loeschen', {}]]) { const r = await K.req(me, p, b); check(`Demo-Kaeufer gesperrt (keine Mails an Fremde): ${p}`, r.s === 403 && r.d.fehler === 'demo_gesperrt', JSON.stringify([r.s, r.d])); }
  // Sprachreinheit der Beispielkurse: je Sprache nur diese Sprache (Liste und Detail), Admin sieht die gespeicherte Fassung.
  const sp = async (l) => (await (await fetch(BASE + '/api/kurse?lang=' + l)).json());
  const [kD, kE, kH] = [await sp('de'), await sp('en'), await sp('hu')];
  check('Sprache: Kursliste de/en/hu je 3 Kurse mit eigener Sprache', kD.length === 3 && kE.length === 3 && kH.length === 3 && /Musterkurs/.test(kD[0].titel) && /Sample course/.test(kE[0].titel) && /Mintaelőadás/.test(kH[0].titel), JSON.stringify([kD[0].titel, kE[0].titel, kH[0].titel]));
  check('Sprache: kein deutscher Rest in en/hu (Titel, Beschreibung, Nutzen)', [...kE, ...kH].every((k) => !/Kurs|Zahlung|Erstattung|Sie|und|der|die/.test(k.titel + ' ' + k.beschreibung + ' ' + k.nutzen)));
  check('Sprache: Deutsch ohne Sie-Form', kD.every((k) => !/Sie/.test(k.beschreibung)));
  const dE = await (await fetch(BASE + '/api/kurse/1?lang=en')).json(), dH = await (await fetch(BASE + '/api/kurse/1?lang=hu')).json();
  check('Sprache: Kursdetail Lektionstitel en/hu', dE.lektionen.map((l) => l.titel).join('|') === 'Welcome|How a subscription is created|Payment, receipt, refund' && dH.lektionen[0].titel === 'Üdvözlünk', JSON.stringify(dE.lektionen.map((l) => l.titel)));
  {
    // Bearbeitete Beispielkurse werden NICHT ueberschrieben (Titel gleich, Beschreibung geaendert).
    const { kursUebersetzt, lektionenUebersetzt } = await import('../demo-uebersetzung.mjs');
    const { mitSprache } = await import('../texte.mjs');
    const orig = kD[0], geaendert = { ...orig, beschreibung: orig.beschreibung + ' (vom Admin geaendert)' };
    const lek = [{ abschnitt: 'Einführung', titel: 'Willkommen', inhalt: 'Anderer Text' }];
    mitSprache('en', () => {
      check('Sprache: bearbeiteter Kurs bleibt unuebersetzt, unbearbeiteter wird uebersetzt', kursUebersetzt(geaendert).beschreibung === geaendert.beschreibung && /Sample course/.test(kursUebersetzt(orig).titel));
      check('Sprache: bearbeitete Lektion bleibt unveraendert', lektionenUebersetzt(orig.titel, lek)[0].titel === 'Willkommen');
    });
  }
  const kauf = await K.req('POST', '/api/kurse/1/kaufen', { zustimmung: true });
  check('Demo-Kaeufer kann kaufen (Weg zur Stripe-Testkasse)', kauf.s === 200 && /checkout\.stripe\.com/.test(kauf.d.url || ''), JSON.stringify(kauf));
  const mail = db.prepare("SELECT b.email FROM demo_konten d JOIN benutzer b ON b.id=d.benutzer_id WHERE d.art='kaeufer'").get();
  check('Demo-Kaeufer-Adresse erkennbar als Demo (kein echtes Postfach)', demo.istDemoAdresse(mail?.email), mail?.email);
  check('Ungueltige Rolle -> 400, zusaetzliche Felder -> 400', (await client('10.0.0.9').req('POST', '/api/demo/zugang', { rolle: 'root' })).s === 400 && (await client('10.0.0.9').req('POST', '/api/demo/zugang', { rolle: 'kaeufer', x: 1 })).s === 400);
  // --- Rate-Limit je Adresse ---
  const R = client('10.0.0.77'); const codes = [];
  for (let i = 0; i < demo.DEMO_MAX_JE_IP_STUNDE + 3; i++) codes.push((await R.req('POST', '/api/demo/zugang', { rolle: 'kaeufer' })).s);
  check(`Rate-Limit: ${demo.DEMO_MAX_JE_IP_STUNDE} Starts je Adresse und Stunde, danach 429`, codes.filter((c) => c === 200).length === demo.DEMO_MAX_JE_IP_STUNDE && codes.filter((c) => c === 429).length === 3, codes.join(','));
  check('Rate-Limit trifft nur diese Adresse (andere Adresse weiter 200)', (await client('10.0.0.78').req('POST', '/api/demo/zugang', { rolle: 'kaeufer' })).s === 200);
  // --- Tageslimit ---
  const fehlend = demo.DEMO_MAX_KAEUFER_TAG - db.prepare("SELECT COUNT(*) n FROM demo_konten WHERE art='kaeufer'").get().n;
  for (let i = 0; i < fehlend; i++) { const e = 'demo-fuell' + i + '@example.com'; const id = Number(db.prepare('INSERT INTO benutzer (email,passwort_hash,erstellt,email_bestaetigt) VALUES (?,?,?,?)').run(e, 'x', new Date().toISOString(), Date.now()).lastInsertRowid); db.prepare("INSERT INTO demo_konten (benutzer_id,art,erstellt) VALUES (?,'kaeufer',?)").run(id, Date.now()); }
  check('Tageslimit neuer Demo-Kaeufer: danach 429', (await client('10.0.0.200').req('POST', '/api/demo/zugang', { rolle: 'kaeufer' })).s === 429);
  // --- Normalbetrieb ohne DEMO_MODUS: Demo-Wege existieren nicht, keine Demo-Schranken ---
  const normal = erstelleServer({ stripe, base: 'http://127.0.0.1:4498', webhookSecret: 'x', mailer: async () => true, dateiOrdner: join(dir, 'dateien2'), ellallasWiederaufnahme: false, abgleichAutomatik: false }).listen(4498, '127.0.0.1');
  await new Promise((r) => (normal.listening ? r() : normal.once('listening', r)));
  const z = await fetch('http://127.0.0.1:4498/api/demo/zugang', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4498' }, body: JSON.stringify({ rolle: 'admin' }) });
  const an2 = await (await fetch('http://127.0.0.1:4498/api/anbieter')).json();
  check('Ohne DEMO_MODUS: kein Demo-Zugang (404) und demo:false', z.status === 404 && an2.demo === false, z.status);
  normal.close();
  // --- Konfiguration: DEMO_MODUS nur mit Testschluessel ---
  const { ladeKonfig, KonfigFehler } = await import('../konfig.mjs');
  const basis = { STRIPE_WEBHOOK_SECRET: 'whsec_x'.padEnd(20, 'x'), BASE_URL: 'http://localhost:1', DB_DATEI: join(dir, 'k.db') };
  const kk = ladeKonfig({ ...basis, STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(20), DEMO_MODUS: '1' });
  let abgelehnt = false; try { ladeKonfig({ ...basis, STRIPE_SECRET_KEY: 'sk_live_' + 'a'.repeat(20), DEMO_MODUS: '1' }); } catch (e) { abgelehnt = e instanceof KonfigFehler && e.meldungen.some((x) => /DEMO_MODUS/.test(x)); }
  let ungueltig = false; try { ladeKonfig({ ...basis, STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(20), DEMO_MODUS: 'ja' }); } catch (e) { ungueltig = e instanceof KonfigFehler; }
  {
    const sk = { ...basis, STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(20), DEMO_MODUS: '1' };
    const bunny = { BUNNY_STREAM_BIBLIOTHEK_ID: '806434', BUNNY_STREAM_API_KEY: 'k'.repeat(12), BUNNY_STREAM_TOKEN_KEY: 't'.repeat(12) };
    const guid = 'c1977b35-5c32-4c1e-b601-aca55810c52b';
    check('Konfig: DEMO_MAX_KAEUFER_TAG 7 -> 7, ungueltig/leer -> 150', ladeKonfig({ ...sk, DEMO_MAX_KAEUFER_TAG: '7' }).demoMaxKaeuferTag === 7 && ladeKonfig({ ...sk, DEMO_MAX_KAEUFER_TAG: '0' }).demoMaxKaeuferTag === 150 && ladeKonfig({ ...sk, DEMO_MAX_KAEUFER_TAG: 'x' }).demoMaxKaeuferTag === 150 && ladeKonfig(sk).demoMaxKaeuferTag === 150);
    check('Konfig: DEMO_BUNNY_VIDEO_ID nur mit gueltiger GUID UND allen Bunny-Variablen', ladeKonfig({ ...sk, ...bunny, DEMO_BUNNY_VIDEO_ID: guid }).demoBunnyVideoId === guid && ladeKonfig({ ...sk, DEMO_BUNNY_VIDEO_ID: guid }).demoBunnyVideoId === '' && ladeKonfig({ ...sk, ...bunny, DEMO_BUNNY_VIDEO_ID: 'keine-guid' }).demoBunnyVideoId === '');
    const demo2 = await import('../demo.mjs');
    demo2.demoKonfigSetzen({ maxKaeuferTag: 9, bunnyVideoId: '' });
    check('Demo: demoKonfigSetzen uebernimmt die Tagesgrenze', demo2.DEMO_MAX_KAEUFER_TAG === 9);
    demo2.demoKonfigSetzen({ maxKaeuferTag: 150, bunnyVideoId: '' });
  }
  check('Konfig: DEMO_MODUS=1 mit sk_test_ ok, mit sk_live_ abgelehnt, ungueltiger Wert abgelehnt, Standard aus', kk.demoModus === true && abgelehnt && ungueltig && ladeKonfig({ ...basis, STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(20) }).demoModus === false, JSON.stringify([kk.demoModus, abgelehnt, ungueltig]));
} finally { server?.close(); }
console.log(`Demo: ${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
