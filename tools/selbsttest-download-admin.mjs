import './test-sprache.mjs';
// Zweites Download-Produkt (12.11.2026): das Admin-Handbuch (19 EUR), gleiche Mechanik wie das Kaeufer-Handbuch (selbsttest-download.mjs).
// Port 4711, Mock-Stripe, Temp-DB, Temp-Dateiordner, TEMPORAERE Test-PDFs (die echten PDFs im Repo werden nicht angefasst, nur auf Vorhandensein geprueft).
// Prueft: Seed legt beide Produkte an (leere Demo: Kaeufer = Kurs 4, Admin = Kurs 5), nur eines wenn PDFs fehlen oder keine echten PDFs sind; Texte DE/EN/HU
// und Stripe-Positionsname; Download nur fuer zahlende Kaeufer mit gueltigem Zugang, Sprache = Bestellsprache (Fallback DE), Dateiname
// musterakademie-handbuch-admin-<l>.pdf; Gast 401, Fremdkonto 403, Kaeufer des ANDEREN Handbuchs 403, manipulierte Kurs-/Lektions-/Varianten-Angaben 404 (400 bei
// Zusatzparametern), entzogener Zugang gesperrt, Download nach Erstattung gesperrt, Erstzugriff verhindert Widerruf (409), Datenauskunft enthaelt den Download.
// Gegenproben: GEGENPROBE=<name> veraendert genau EINE Vorbedingung, die zugehoerige Pruefung muss dann ROT werden (siehe GEGEN unten).
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const GEGEN = process.env.GEGENPROBE || '';
const gp = (n) => GEGEN === n;
const dir = mkdtempSync(join(tmpdir(), 'schulung-download-admin-'));
process.env.DB_DATEI = join(dir, 'test.db');
const dateiOrdner = join(dir, 'dateien');
const ordner = (name, dateien) => { const o = join(dir, name); mkdirSync(o); for (const [f, inhalt] of dateien) writeFileSync(join(o, f), inhalt); return o; };
const pdf = (marke) => Buffer.from('%PDF-1.4\n% TEST-' + marke + '-MARKER\n%%EOF\n', 'latin1');
const satz = (typ, sprachen = ['de', 'en', 'hu']) => sprachen.map((l) => ['handbuch-' + typ + '-' + l + '.pdf', pdf(typ.toUpperCase() + '-' + l.toUpperCase())]);
const hbAlle = ordner('alle', [...satz('kaeufer'), ...satz('admin')]);
const hbAdminHalb = ordner('admin-halb', [...satz('kaeufer'), ...satz('admin', ['de', 'en'])]);
const hbNurAdmin = ordner('nur-admin', [...satz('admin'), ...satz('kaeufer', ['de', 'en'])]);
const hbKeinPdf = ordner('kein-pdf', [...satz('kaeufer'), ...satz('admin', ['de', 'en']), ['handbuch-admin-hu.pdf', 'kein pdf']]);
let ok = 0, fail = 0, server;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + String(d).slice(0, 300))); };
const PORT = 4711, B = 'http://127.0.0.1:' + PORT, BETRAG = 1900;
const sitzungen = [];
const stripe = { customers: { create: async () => ({ id: 'cus_dla' }), update: async () => ({}) },
  checkout: { sessions: { create: async (p) => { sitzungen.push(p); return { id: 'cs_dla_' + sitzungen.length, url: 'https://checkout.stripe.com/x' }; }, retrieve: async () => ({ payment_intent: 'pi_dla' }), list: async () => ({ data: [] }), expire: async () => ({}) } },
  paymentIntents: { retrieve: async (id) => ({ id, latest_charge: 'ch_dla', amount_received: BETRAG }) }, refunds: { create: async () => ({ id: 're_dla', status: 'succeeded' }), list: async () => ({ data: [] }) },
  charges: { retrieve: async () => ({ id: 'ch_dla', amount_refunded: 0, amount: BETRAG }) },
  billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/x' }) } }, webhooks: { constructEvent: () => ({}) } };
function client() {
  const jar = new Map();
  return { jar, async req(method, path, body, extra = {}) {
    const headers = { Origin: B, ...extra };
    if (jar.size) headers.Cookie = [extra.Cookie, ...[...jar].map(([k, v]) => k + '=' + v)].filter(Boolean).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(B + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    const buf = Buffer.from(await r.arrayBuffer()); const text = buf.toString('latin1'); let d = {}; try { d = JSON.parse(buf.toString('utf8')); } catch { /* kein JSON */ }
    return { s: r.status, h: r.headers, d, text };
  } };
}
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const demo = await import('../demo.mjs');
  const daten = await import('../demo-daten.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const { db } = await import('../db.mjs');
  const TITEL_K = 'Handbuch für Käuferinnen und Käufer', TITEL_A = 'Handbuch für den Admin-Bereich';

  // ---- Daten des Produkts ----
  const A = daten.HANDBUCH_ADMIN;
  check('Daten: Admin-Handbuch 19 EUR, Titel, Dateien handbuch-admin-de/en/hu.pdf, Reihenfolge Kaeufer vor Admin',
    A && A.titel === TITEL_A && A.preis === 1900 && JSON.stringify(A.dateien) === JSON.stringify({ de: 'handbuch-admin-de.pdf', en: 'handbuch-admin-en.pdf', hu: 'handbuch-admin-hu.pdf' })
    && daten.HANDBUECHER.length === 2 && daten.HANDBUECHER[0] === daten.HANDBUCH && daten.HANDBUECHER[1] === A, JSON.stringify(A));
  const VERBOTEN = /demo|muster|beispiel|sample|minta|teszt|\btest|kurzus|agent|\/admin\b|4242|null|undefined/i;
  check('Daten: Produkttexte DE ohne verbotene Begriffe (Demo/Muster/Test/Agent ...)', ![A.titel, A.beschreibung, A.nutzen, ...A.lektion].some((t) => VERBOTEN.test(t)), [A.titel, A.beschreibung, A.nutzen, ...A.lektion].filter((t) => VERBOTEN.test(t)).join(' | '));
  const echtAlle = Object.values(A.dateien).every((f) => existsSync(join(demo.HANDBUCH_ORDNER_STANDARD, f)));
  check('Repo: alle drei echten Admin-PDFs liegen in handbuch/ausgabe', echtAlle);

  // ---- Seed in leerer Demo: beide Produkte, feste IDs 4 und 5 ----
  const handbuecherFuerSeed = gp('seed') ? [daten.HANDBUCH] : daten.HANDBUECHER.slice();   // Gegenprobe: alter Stand (nur Kaeufer-Handbuch)
  const mitHandbuechern = (fn) => { const alt = daten.HANDBUECHER.slice(); daten.HANDBUECHER.length = 0; daten.HANDBUECHER.push(...handbuecherFuerSeed); try { return fn(); } finally { daten.HANDBUECHER.length = 0; daten.HANDBUECHER.push(...alt); } };
  await mitHandbuechern(() => demo.demoSeedWennLeer({ dateiOrdner, handbuchOrdner: hbAlle }));
  const kurs = (titel) => db.prepare('SELECT id, preis_cent, waehrung, status, abo_preis_cent FROM kurse WHERE titel = ?').get(titel);
  const hk = kurs(TITEL_K), ha = kurs(TITEL_A);
  check('Seed mit allen sechs PDFs: Kaeufer-Handbuch = Kurs 4 (unveraendert, 9 EUR)', hk && hk.id === 4 && hk.preis_cent === 900, JSON.stringify(hk));
  check('Seed mit allen sechs PDFs: Admin-Handbuch = Kurs 5, 19 EUR, Einmalkauf, veroeffentlicht', ha && ha.id === 5 && ha.preis_cent === 1900 && ha.waehrung === 'eur' && ha.status === 'veroeffentlicht' && ha.abo_preis_cent === null, JSON.stringify(ha));
  const KID = ha?.id ?? -1, KK = hk?.id ?? -1;
  const al = db.prepare('SELECT id, art, download_erlaubt, titel FROM lektionen WHERE kurs_id = ?').all(KID);
  check('Admin-Handbuch: genau 1 PDF-Lektion mit download_erlaubt = 1', al.length === 1 && al[0].art === 'pdf' && al[0].download_erlaubt === 1 && al[0].titel === 'Admin-Handbuch als PDF', JSON.stringify(al));
  const LID = al[0]?.id ?? -1, LK = db.prepare('SELECT id FROM lektionen WHERE kurs_id = ?').get(KK)?.id ?? -1;
  check('Insgesamt genau 2 Lektionen mit download_erlaubt = 1 (die beiden Handbuecher)', db.prepare('SELECT COUNT(*) n FROM lektionen WHERE download_erlaubt = 1').get().n === 2);
  const varianten = db.prepare('SELECT sprache, name, pfad FROM download_varianten WHERE lektion_id = ? ORDER BY sprache').all(LID);
  check('Admin: drei Sprachfassungen unter Zufallsnamen, Name = handbuch-admin-<l>.pdf', varianten.length === 3 && varianten.every((v) => /^[0-9a-f-]{36}$/.test(v.pfad) && existsSync(join(dateiOrdner, v.pfad)) && v.name === 'handbuch-admin-' + v.sprache + '.pdf'), JSON.stringify(varianten));

  // ---- Seed-Bedingung je Handbuch (in einem Savepoint, danach zurueckgerollt) ----
  const probe = (handbuchOrdner, n) => { db.exec('SAVEPOINT probe'); try { db.exec("DELETE FROM kurse WHERE titel LIKE 'Handbuch%'");
    const r = demo.handbuecherSeed({ dateiOrdner: join(dir, 'probe-' + n), handbuchOrdner }); return { r, titel: db.prepare("SELECT titel FROM kurse WHERE titel LIKE 'Handbuch%' ORDER BY id").all().map((x) => x.titel) }; }
    finally { db.exec('ROLLBACK TO probe; RELEASE probe'); } };
  let p = probe(hbAdminHalb, 1);
  check('Seed: Admin nur DE+EN -> nur das Kaeufer-Handbuch', JSON.stringify(p.titel) === JSON.stringify([TITEL_K]) && p.r[1].fehlt === true, JSON.stringify(p));
  p = probe(hbNurAdmin, 2);
  check('Seed: Kaeufer nur DE+EN -> nur das Admin-Handbuch', JSON.stringify(p.titel) === JSON.stringify([TITEL_A]) && p.r[0].fehlt === true, JSON.stringify(p));
  p = probe(hbKeinPdf, 3);
  check('Seed: Admin-HU ohne PDF-Kopf -> kein Admin-Handbuch', JSON.stringify(p.titel) === JSON.stringify([TITEL_K]), JSON.stringify(p));
  check('Nach den Proben: Datenbank unveraendert (Kurs 4 und 5 da)', kurs(TITEL_K)?.id === 4 && kurs(TITEL_A)?.id === 5);

  server = erstelleServer({ stripe, base: B, webhookSecret: 'x', mailer: async () => true, dateiOrdner, ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: true, trustProxy: 1 }).listen(PORT, '127.0.0.1');
  await warte(800);
  const DL = (k = KID, l = LID) => `/api/kurse/${k}/lektionen/${l}/download`;
  const z = new Date().toISOString();
  const kaeufer = async () => { const c = client(); await c.req('POST', '/api/demo/zugang', { rolle: 'kaeufer' }); c.id = db.prepare("SELECT benutzer_id FROM demo_konten WHERE art='kaeufer' ORDER BY benutzer_id DESC LIMIT 1").get().benutzer_id; return c; };
  let nr = 0;
  const kaufen = (uid, kursId, sprache, zustimmung = true) => {
    nr++; const cs = 'cs_dla_k' + nr;
    db.prepare("INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt) VALUES (?,?,'zahlung',?)").run(uid, kursId, z);
    const bid = Number(db.prepare("INSERT INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert,sprache) VALUES (?,?,?,?,?,'eur','bezahlt',?,?,?)").run(cs, 'pi_dla_' + nr, uid, kursId, kursId === KID ? BETRAG : 900, z, z, sprache).lastInsertRowid);
    if (zustimmung) db.prepare("INSERT INTO kauf_zustimmung (benutzer_id,kurs_id,text_version,zeit,stripe_sitzung) VALUES (?,?,'v1',?,?)").run(uid, kursId, z, cs);
    return bid;
  };
  const ersterZugriff = (uid) => db.prepare('SELECT COUNT(*) n FROM erster_zugriff WHERE benutzer_id = ? AND kurs_id = ?').get(uid, KID).n;
  const NAME = (l) => `attachment; filename="musterakademie-handbuch-admin-${l}.pdf"`;

  // ---- Gast / Fremdkonto / Kaeufer des anderen Handbuchs ----
  const gast = client();
  let r = await gast.req('GET', DL());
  check('Gast (ohne Login): 401, keine Datei', r.s === 401 && !r.text.includes('TEST-'), r.s);
  const fremd = await kaeufer();
  if (gp('fremd')) db.prepare("INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt) VALUES (?,?,'einladung',?)").run(fremd.id, KID, z);
  r = await fremd.req('GET', DL());
  check('Fremdkonto ohne Kauf: 403, keine Datei', r.s === 403 && !r.text.includes('TEST-'), r.s);
  const kk = await kaeufer(); kaufen(kk.id, KK, 'de');
  r = await kk.req('GET', DL());
  check('Kaeufer nur des Kaeufer-Handbuchs: Admin-Handbuch 403', r.s === 403 && !r.text.includes('TEST-ADMIN'), r.s);
  r = await kk.req('GET', DL(KK, LID));
  check('Manipuliert: Admin-Lektion ueber den gekauften Kaeufer-Kurs angefragt: 404, keine Admin-Datei', r.s === 404 && !r.text.includes('TEST-'), r.s);
  r = await kk.req('GET', DL(KK, LK));
  check('Kaeufer-Handbuch selbst: weiterhin 200 mit Kaeufer-Datei (DE)', r.s === 200 && r.text.includes('TEST-KAEUFER-DE-MARKER') && /handbuch-kaeufer-de\.pdf"$/.test(r.h.get('content-disposition') || ''), r.s + ' ' + r.h.get('content-disposition'));

  // ---- Kauf, Sprache, Dateiname ----
  const a = await kaeufer(); const bidA = kaufen(a.id, KID, gp('sprache') ? 'de' : 'en');
  r = await a.req('GET', `/api/kurse/${KID}`);
  check('Kursseite: Lektion als Download-Produkt markiert (download: true)', r.s === 200 && r.d.lektionen?.[0]?.download === true, JSON.stringify(r.d).slice(0, 200));
  r = await a.req('GET', DL(KID, LK));
  check('Manipuliert: Kaeufer-Lektion ueber den Admin-Kurs: 404', r.s === 404 && !r.text.includes('TEST-'), r.s);
  for (const [n, pfad] of [['unbekannte Lektion', DL(KID, 999999)], ['unbekannter Kurs', DL(999999, LID)], ['Kurs 0', DL(0, LID)]]) {
    r = await a.req('GET', pfad);
    check('Manipuliert: ' + n + ': 404/400, keine Datei', [400, 404].includes(r.s) && !r.text.includes('TEST-'), r.s);
  }
  for (const q of ['?variante=1', '?sprache=hu', '?datei=' + varianten[0].pfad]) {
    r = await a.req('GET', DL() + q);
    check('Manipuliert: Variante/Sprache/Datei per Parameter (' + q.split('=')[0] + '): 400, keine Datei', r.s === 400 && !r.text.includes('TEST-'), r.s);
  }
  r = await a.req('GET', DL());
  check('Kaeufer: 200, Fassung der Bestellsprache EN', r.s === 200 && r.text.includes('TEST-ADMIN-EN-MARKER'), r.s + ' ' + r.text.slice(0, 60));
  const name = gp('name') ? 'falsch' : r.h.get('content-disposition');
  check('Dateiname musterakademie-handbuch-admin-en.pdf, application/pdf, private no-store, nosniff', name === NAME('en') && r.h.get('content-type') === 'application/pdf' && /private/.test(r.h.get('cache-control') || '') && /no-store/.test(r.h.get('cache-control') || '') && r.h.get('x-content-type-options') === 'nosniff', name);
  await warte(150);
  check('Download setzt den ersten Zugriff', ersterZugriff(a.id) === 1, ersterZugriff(a.id));
  const h = await kaeufer(); kaufen(h.id, KID, 'hu');
  r = await h.req('GET', DL(), undefined, { Cookie: 'lang=de' });
  check('Bestellsprache HU (Oberflaeche DE): HU-Fassung, Dateiname ...-admin-hu.pdf', r.s === 200 && r.text.includes('TEST-ADMIN-HU-MARKER') && r.h.get('content-disposition') === NAME('hu'), r.s + ' ' + r.h.get('content-disposition'));
  const d = await kaeufer(); kaufen(d.id, KID, 'de');
  r = await d.req('GET', DL(), undefined, { Cookie: 'lang=en' });
  check('Bestellsprache DE (Oberflaeche EN): DE-Fassung, Dateiname ...-admin-de.pdf', r.s === 200 && r.text.includes('TEST-ADMIN-DE-MARKER') && r.h.get('content-disposition') === NAME('de'), r.s + ' ' + r.h.get('content-disposition'));
  // Fallback DE: EN-Zeile fehlt (danach wieder herstellen)
  const enZeile = db.prepare("SELECT * FROM download_varianten WHERE lektion_id = ? AND sprache = 'en'").get(LID);
  if (!gp('fallback')) db.prepare("DELETE FROM download_varianten WHERE lektion_id = ? AND sprache = 'en'").run(LID);
  r = await a.req('GET', DL());
  check('EN-Fassung fehlt: Fallback DE (Dateiname ...-admin-de.pdf)', r.s === 200 && r.text.includes('TEST-ADMIN-DE-MARKER') && r.h.get('content-disposition') === NAME('de'), r.s + ' ' + r.text.slice(0, 50));
  if (!gp('fallback')) db.prepare('INSERT INTO download_varianten (lektion_id,sprache,name,pfad,groesse,mime,erstellt) VALUES (?,?,?,?,?,?,?)').run(enZeile.lektion_id, enZeile.sprache, enZeile.name, enZeile.pfad, enZeile.groesse, enZeile.mime, enZeile.erstellt);
  // Manipulierte Varianten: alle Zeilen der Admin-Lektion weg -> 404, KEIN Rueckfall auf das Kaeufer-Handbuch
  const alle = db.prepare('SELECT * FROM download_varianten WHERE lektion_id = ?').all(LID);
  db.prepare('DELETE FROM download_varianten WHERE lektion_id = ?').run(LID);
  r = await a.req('GET', DL());
  check('Manipuliert: keine Varianten-Zeile der Admin-Lektion: 404, keine fremde (Kaeufer-)Datei', r.s === 404 && !r.text.includes('TEST-'), r.s + ' ' + r.text.slice(0, 50));
  // Varianten-Zeilen an eine andere Lektion gehaengt (lektion_id manipuliert, Lektion von Kurs 1 ohne Download-Markierung): weder dort noch hier ein Download
  const L1 = db.prepare('SELECT id FROM lektionen WHERE kurs_id = 1 ORDER BY id LIMIT 1').get().id;
  for (const v of alle) db.prepare('INSERT INTO download_varianten (lektion_id,sprache,name,pfad,groesse,mime,erstellt) VALUES (?,?,?,?,?,?,?)').run(L1, v.sprache, v.name, v.pfad, v.groesse, v.mime, v.erstellt);
  r = await a.req('GET', DL());
  check('Manipuliert: Admin-Varianten an fremder Lektion: Admin-Download weiter 404', r.s === 404 && !r.text.includes('TEST-'), r.s);
  const m1 = await kaeufer(); kaufen(m1.id, 1, 'de');
  r = await m1.req('GET', DL(1, L1));
  check('Manipuliert: Kaeufer von Kurs 1 bekommt die umgehaengten Admin-Varianten nicht (Flag aus: 404)', r.s === 404 && !r.text.includes('TEST-'), r.s);
  db.prepare('DELETE FROM download_varianten WHERE lektion_id = ?').run(L1);
  for (const v of alle) db.prepare('INSERT INTO download_varianten (lektion_id,sprache,name,pfad,groesse,mime,erstellt) VALUES (?,?,?,?,?,?,?)').run(v.lektion_id, v.sprache, v.name, v.pfad, v.groesse, v.mime, v.erstellt);
  r = await a.req('GET', DL());
  check('Varianten wiederhergestellt: wieder 200 (EN)', r.s === 200 && r.text.includes('TEST-ADMIN-EN-MARKER'), r.s);

  // ---- Erstzugriff verhindert Widerruf ----
  await warte(150);   // 'finish' des letzten Downloads abwarten (setzt den ersten Zugriff)
  if (gp('widerruf')) db.prepare('DELETE FROM erster_zugriff WHERE benutzer_id = ? AND kurs_id = ?').run(a.id, KID);
  r = await a.req('POST', `/api/bestellungen/${bidA}/ellallas`, { bestaetigt: true });
  const eA = db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id = ?').get(bidA)?.ergebnis;
  check('Widerruf nach dem Download: 409 abgelehnt_zustimmung', r.s === 409 && eA === 'abgelehnt_zustimmung', r.s + ' ' + eA);

  // ---- Entzogener Zugang ----
  if (!gp('entzug')) db.prepare('DELETE FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ?').run(h.id, KID);
  r = await h.req('GET', DL());
  check('Zugang entzogen (Zeile geloescht, Bestellung bleibt): 403, keine Datei', r.s === 403 && !r.text.includes('TEST-'), r.s);
  db.prepare('UPDATE zugaenge SET gueltig_bis = ? WHERE benutzer_id = ? AND kurs_id = ?').run(Date.now() - 1000, d.id, KID);
  r = await d.req('GET', DL());
  check('Zugang abgelaufen (gueltig_bis vorbei): 403', r.s === 403 && !r.text.includes('TEST-'), r.s);

  // ---- Erstattung (Widerruf ohne vorherigen Download) sperrt den Download ----
  const e = await kaeufer(); const bidE = kaufen(e.id, KID, 'de');
  await e.req('GET', `/api/kurse/${KID}?lektion=${LID}`);   // nur Lektionsseite, kein Download
  if (!gp('erstattung')) r = await e.req('POST', `/api/bestellungen/${bidE}/ellallas`, { bestaetigt: true });
  await warte(150);
  const best = db.prepare('SELECT status FROM bestellungen WHERE id = ?').get(bidE)?.status;
  r = await e.req('GET', DL());
  check('Nach Widerruf mit Erstattung: Bestellung erstattet, Download 403', best === 'erstattet' && r.s === 403 && !r.text.includes('TEST-'), best + ' ' + r.s);

  // ---- Texte: Uebersetzung und Stripe-Positionsname ----
  const hu = client(); hu.jar.set('lang', 'hu');
  r = await hu.req('GET', '/api/kurse');
  const huK = Array.isArray(r.d) ? r.d.find((k) => k.id === KID) : null;
  check('Demo HU: "Kézikönyv az admin felülethez", Beschreibung ungarisch, ohne verbotene Begriffe', huK?.titel === 'Kézikönyv az admin felülethez' && /admin felületének kézikönyve/.test(huK.beschreibung || '') && !VERBOTEN.test(huK.titel + huK.beschreibung), JSON.stringify(huK).slice(0, 200));
  const en = client(); en.jar.set('lang', 'en');
  r = await en.req('GET', '/api/kurse');
  const enK = Array.isArray(r.d) ? r.d.find((k) => k.id === KID) : null;
  check('Demo EN: "Admin area manual", Beschreibung englisch, ohne verbotene Begriffe', enK?.titel === 'Admin area manual' && /^The manual for the platform/.test(enK.beschreibung || '') && !VERBOTEN.test(enK.titel + enK.beschreibung), JSON.stringify(enK).slice(0, 200));
  r = await en.req('GET', `/api/kurse/${KID}`);
  check('Demo EN: Lektion "Admin manual as PDF"', r.s === 200 && r.d.lektionen?.[0]?.titel === 'Admin manual as PDF', JSON.stringify(r.d.lektionen));
  const { titelUebersetzt } = await import('../demo-uebersetzung.mjs');
  check('Stripe-Positionsname (titelUebersetzt): EN "Admin area manual", HU "Kézikönyv az admin felülethez", DE unveraendert', titelUebersetzt(TITEL_A, 'en') === 'Admin area manual' && titelUebersetzt(TITEL_A, 'hu') === 'Kézikönyv az admin felülethez' && titelUebersetzt(TITEL_A, 'de') === TITEL_A && titelUebersetzt(TITEL_K, 'en') === 'Handbook for buyers', [titelUebersetzt(TITEL_A, 'en'), titelUebersetzt(TITEL_A, 'hu')].join(' | '));

  // ---- Datenauskunft (normales Konto) ----
  const { passwortHashen } = await import('../auth.mjs');
  const PW = 'Download-Admin-Test-Passwort-1', kEmail = 'download-admin-konto@example.com';
  const kid2 = Number(db.prepare("INSERT INTO benutzer (email,passwort_hash,erstellt,email_bestaetigt) VALUES (?,?,?,?)").run(kEmail, await passwortHashen(PW), z, Date.now()).lastInsertRowid);
  const k = client();
  r = await k.req('POST', '/api/anmelden', { email: kEmail, passwort: PW });
  check('Normales Konto: Anmeldung', r.s === 200, r.s);
  kaufen(kid2, KID, 'hu');
  r = await k.req('GET', DL());
  check('Normales Konto: Download 200 (HU)', r.s === 200 && r.text.includes('TEST-ADMIN-HU-MARKER'), r.s);
  await warte(150);
  if (gp('auskunft')) db.prepare('DELETE FROM download_protokoll WHERE benutzer_id = ?').run(kid2);
  r = await k.req('GET', '/api/konto/auskunft');
  const lt = r.d.letoltesek;
  check('Datenauskunft enthaelt den Admin-Download (Kurs 5, Lektion, Sprache hu, Zeit)', r.s === 200 && Array.isArray(lt) && lt.length === 1 && lt[0].eloadas_azonosito === KID && lt[0].lecke_azonosito === LID && lt[0].nyelv === 'hu' && typeof lt[0].idopont === 'string', r.s + ' ' + JSON.stringify(lt));
} catch (e) { fail++; console.log('FEHLER Ausnahme: ' + String(e.stack || e).slice(0, 500)); }
finally { server?.close(); }
console.log(`Download Admin-Handbuch${GEGEN ? ' (GEGENPROBE=' + GEGEN + ')' : ''}: ${ok} bestanden, ${fail} fehlgeschlagen`); process.exit(fail ? 1 : 0);
