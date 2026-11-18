import './test-sprache.mjs';
// Block 3 (12.11.2026): geschuetzter Download (eng begrenzte Ausnahme von "nur Ansicht" fuer ausdruecklich verkaufte Download-Produkte, z. B. das Handbuch-PDF).
// Port 4710, Mock-Stripe, Temp-DB, Temp-Dateiordner, TEMPORAERE Test-PDFs fuer de/en/hu (die echten PDFs im Repo werden nicht angefasst).
// Prueft: Seed nur mit allen drei PDFs; 401/403/404; fremde Bestellung/IDOR; Flag aus; Pfadtraversal; Kopfzeilen; Sprache nach Bestellung + Fallback DE;
// erster Zugriff erst durch den vollstaendigen Download (nicht durch die Lektionsseite) und Widerruf danach abgelehnt; Admin-Demo/DEMO-Sperren; normale
// Kurs-PDFs weiterhin NICHT herunterladbar; keine statische Adresse.
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
const dir = mkdtempSync(join(tmpdir(), 'schulung-download-'));
process.env.DB_DATEI = join(dir, 'test.db');
const dateiOrdner = join(dir, 'dateien'), hbOrdner = join(dir, 'handbuch'), hbHalb = join(dir, 'handbuch-halb');
mkdirSync(hbOrdner); mkdirSync(hbHalb);
const pdf = (marke) => Buffer.from('%PDF-1.4\n% TEST-' + marke + '-MARKER\n%%EOF\n', 'latin1');
for (const l of ['de', 'en', 'hu']) writeFileSync(join(hbOrdner, 'handbuch-kaeufer-' + l + '.pdf'), pdf(l.toUpperCase()));
for (const l of ['de', 'en']) writeFileSync(join(hbHalb, 'handbuch-kaeufer-' + l + '.pdf'), pdf(l.toUpperCase()));
let ok = 0, fail = 0, server;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + String(d).slice(0, 300))); };
const PORT = 4710, B = 'http://127.0.0.1:' + PORT;
const stripe = { customers: { create: async () => ({ id: 'cus_dl' }), update: async () => ({}) },
  checkout: { sessions: { create: async () => ({ id: 'cs_dl', url: 'https://checkout.stripe.com/x' }), retrieve: async () => ({ payment_intent: 'pi_dl' }), list: async () => ({ data: [] }), expire: async () => ({}) } },
  paymentIntents: { retrieve: async (id) => ({ id, latest_charge: 'ch_dl', amount_received: 900 }) }, refunds: { create: async () => ({ id: 're_dl', status: 'succeeded' }), list: async () => ({ data: [] }) },
  charges: { retrieve: async () => ({ id: 'ch_dl', amount_refunded: 0, amount: 900 }) },
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
  const { erstelleServer } = await import('../app.mjs');
  const { db } = await import('../db.mjs');

  // ---- Migration: Standard AUS ----
  const sp = db.prepare('PRAGMA table_info(lektionen)').all().find((s) => s.name === 'download_erlaubt');
  check('Migration: Spalte lektionen.download_erlaubt vorhanden, Standard 0', sp && String(sp.dflt_value) === '0', JSON.stringify(sp));

  // ---- Seed-Bedingung ----
  const echtAlle = ['de', 'en', 'hu'].every((l) => existsSync(join(demo.HANDBUCH_ORDNER_STANDARD, 'handbuch-kaeufer-' + l + '.pdf')));
  const echt = demo.handbuchSeed({ dateiOrdner: join(dir, 'probe'), handbuchOrdner: demo.HANDBUCH_ORDNER_STANDARD });
  check('Seed mit dem echten Repo-Ordner: Produkt nur, wenn alle drei PDFs da sind (heute: ' + (echtAlle ? 'alle' : 'nicht alle') + ')', !!echt === echtAlle, String(!!echt));
  if (echt) db.prepare('DELETE FROM kurse WHERE id = ?').run(echt.kursId);   // Probe wieder entfernen (nur falls doch alle da sind)
  check('Seed mit nur DE+EN: KEIN Produkt', demo.handbuchSeed({ dateiOrdner: join(dir, 'probe2'), handbuchOrdner: hbHalb }) === false && !db.prepare("SELECT 1 FROM kurse WHERE titel LIKE 'Handbuch%'").get());
  writeFileSync(join(hbHalb, 'handbuch-kaeufer-hu.pdf'), 'kein pdf');
  check('Seed mit einer "PDF" ohne PDF-Kopf: KEIN Produkt', demo.handbuchSeed({ dateiOrdner: join(dir, 'probe3'), handbuchOrdner: hbHalb }) === false);
  await demo.demoSeedWennLeer({ dateiOrdner, handbuchOrdner: hbOrdner });
  const hk = db.prepare("SELECT id, preis_cent, waehrung, status, abo_preis_cent FROM kurse WHERE titel = 'Handbuch für Käuferinnen und Käufer'").get();
  const hl = hk && db.prepare('SELECT id, art, download_erlaubt FROM lektionen WHERE kurs_id = ?').all(hk.id);
  check('Seed mit allen drei Test-PDFs: Handbuch 9 EUR, Einmalkauf, 1 PDF-Lektion mit Download', hk && hk.preis_cent === 900 && hk.waehrung === 'eur' && hk.status === 'veroeffentlicht' && hk.abo_preis_cent === null && hl.length === 1 && hl[0].art === 'pdf' && hl[0].download_erlaubt === 1, JSON.stringify([hk, hl]));
  const KID = hk.id, LID = hl[0].id;
  check('Nur die Handbuch-Lektion hat download_erlaubt = 1', db.prepare('SELECT COUNT(*) n FROM lektionen WHERE download_erlaubt = 1').get().n === 1);
  const varianten = db.prepare('SELECT sprache, pfad FROM download_varianten WHERE lektion_id = ? ORDER BY sprache').all(LID);
  check('Drei Sprachfassungen unter Zufallsnamen im Dateiordner', varianten.length === 3 && varianten.every((v) => /^[0-9a-f-]{36}$/.test(v.pfad) && existsSync(join(dateiOrdner, v.pfad))), JSON.stringify(varianten));

  server = erstelleServer({ stripe, base: B, webhookSecret: 'x', mailer: async () => true, dateiOrdner, ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: true, trustProxy: 1 }).listen(PORT, '127.0.0.1');
  await warte(800);
  const DL = (k = KID, l = LID) => `/api/kurse/${k}/lektionen/${l}/download`;
  const z = new Date().toISOString();
  const kaeufer = async () => { const c = client(); await c.req('POST', '/api/demo/zugang', { rolle: 'kaeufer' }); c.id = db.prepare("SELECT benutzer_id FROM demo_konten WHERE art='kaeufer' ORDER BY benutzer_id DESC LIMIT 1").get().benutzer_id; return c; };
  let nr = 0;
  const kaufen = (uid, kurs, sprache, zustimmung = true) => {
    nr++; const cs = 'cs_dl_' + nr;
    db.prepare("INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt) VALUES (?,?,'zahlung',?)").run(uid, kurs, z);
    const bid = Number(db.prepare("INSERT INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert,sprache) VALUES (?,?,?,?,900,'eur','bezahlt',?,?,?)").run(cs, 'pi_dl_' + nr, uid, kurs, z, z, sprache).lastInsertRowid);
    if (zustimmung) db.prepare("INSERT INTO kauf_zustimmung (benutzer_id,kurs_id,text_version,zeit,stripe_sitzung) VALUES (?,?,'v1',?,?)").run(uid, kurs, z, cs);
    return bid;
  };
  const ersterZugriff = (uid) => db.prepare('SELECT COUNT(*) n FROM erster_zugriff WHERE benutzer_id = ? AND kurs_id = ?').get(uid, KID).n;

  // ---- Ohne Login / ohne Kauf ----
  const anonym = client();
  let r = await anonym.req('GET', DL());
  check('ohne Login: 401', r.s === 401 && !r.text.includes('TEST-'), r.s);
  const a = await kaeufer();
  r = await a.req('GET', DL());
  check('angemeldet ohne Kauf: 403, keine Datei', r.s === 403 && !r.text.includes('TEST-'), r.s + ' ' + r.text.slice(0, 80));
  r = await a.req('GET', `/api/kurse/${KID}`);
  check('Kursseite zeigt die Lektion als Download-Produkt (download: true)', r.s === 200 && r.d.lektionen?.[0]?.download === true, JSON.stringify(r.d).slice(0, 200));

  // ---- Kauf (Bestellsprache EN), Lektionsseite zaehlt NICHT, Download zaehlt ----
  const bidA = kaufen(a.id, KID, 'en');
  r = await a.req('GET', `/api/kurse/${KID}?lektion=${LID}`);
  check('Lektionsseite der Download-Lektion: KEIN erster Zugriff (erst der Download zaehlt)', r.s === 200 && ersterZugriff(a.id) === 0, ersterZugriff(a.id));
  r = await a.req('HEAD', DL());
  check('HEAD: 200 ohne Inhalt, KEIN erster Zugriff', r.s === 200 && r.text === '' && ersterZugriff(a.id) === 0, r.s + ' ' + ersterZugriff(a.id));
  r = await a.req('GET', DL());
  check('Kaeufer: 200, Fassung der Bestellsprache EN', r.s === 200 && r.text.includes('TEST-EN-MARKER'), r.s + ' ' + r.text.slice(0, 60));
  check('Kopfzeile Content-Disposition: attachment mit sauberem Dateinamen', r.h.get('content-disposition') === 'attachment; filename="musterakademie-handbuch-kaeufer-en.pdf"', r.h.get('content-disposition'));
  check('Kopfzeilen: application/pdf, private no-store, nosniff', r.h.get('content-type') === 'application/pdf' && /private/.test(r.h.get('cache-control') || '') && /no-store/.test(r.h.get('cache-control') || '') && r.h.get('x-content-type-options') === 'nosniff', [r.h.get('content-type'), r.h.get('cache-control'), r.h.get('x-content-type-options')].join(' | '));
  await warte(150);
  check('Download setzt den ersten Zugriff', ersterZugriff(a.id) === 1, ersterZugriff(a.id));
  const prot = db.prepare('SELECT * FROM download_protokoll WHERE benutzer_id = ?').all(a.id);
  check('Download protokolliert (Kurs, Lektion, Sprache; keine Sitzung/Pfad)', prot.length === 1 && prot[0].kurs_id === KID && prot[0].lektion_id === LID && prot[0].sprache === 'en' && !Object.keys(prot[0]).some((k) => /pfad|token|sitzung|ip/i.test(k)), JSON.stringify(prot));
  r = await a.req('POST', `/api/bestellungen/${bidA}/ellallas`, { bestaetigt: true });
  const eA = db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id = ?').get(bidA)?.ergebnis;
  check('Widerruf NACH dem Download (mit Zustimmung): abgelehnt (abgelehnt_zustimmung)', r.s === 409 && eA === 'abgelehnt_zustimmung', r.s + ' ' + eA);
  // Gegenprobe: gleicher Kauf, nur Lektionsseite geoeffnet, nicht heruntergeladen -> Widerruf wird bearbeitet (nicht wegen Zugriff abgelehnt)
  const g = await kaeufer(); const bidG = kaufen(g.id, KID, 'de');
  await g.req('GET', `/api/kurse/${KID}?lektion=${LID}`);
  r = await g.req('POST', `/api/bestellungen/${bidG}/ellallas`, { bestaetigt: true });
  const eG = db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id = ?').get(bidG)?.ergebnis;
  check('Gegenprobe: ohne Download (nur Lektionsseite) wird der Widerruf NICHT wegen Zugriffs abgelehnt', eG && eG !== 'abgelehnt_zustimmung', r.s + ' ' + eG);

  // ---- Sprache: Bestellung HU, Sprachwechsel, Fallback DE ----
  const c = await kaeufer(); kaufen(c.id, KID, 'hu');
  r = await c.req('GET', DL(), undefined, { Cookie: 'lang=de' });
  check('Bestellsprache HU, Oberflaeche auf DE umgestellt: trotzdem HU (kein neuer Kauf noetig)', r.s === 200 && r.text.includes('TEST-HU-MARKER') && /kaeufer-hu\.pdf"$/.test(r.h.get('content-disposition') || ''), r.s + ' ' + r.text.slice(0, 60));
  const huPfad = varianten.find((v) => v.sprache === 'hu').pfad;
  unlinkSync(join(dateiOrdner, huPfad));
  r = await c.req('GET', DL());
  check('HU-Datei fehlt auf dem Datentraeger: Fallback DE', r.s === 200 && r.text.includes('TEST-DE-MARKER'), r.s + ' ' + r.text.slice(0, 60));
  writeFileSync(join(dateiOrdner, huPfad), pdf('HU'));
  db.prepare("DELETE FROM download_varianten WHERE lektion_id = ? AND sprache = 'en'").run(LID);
  r = await a.req('GET', DL());
  check('EN-Zeile fehlt: Fallback DE', r.s === 200 && r.text.includes('TEST-DE-MARKER'), r.s + ' ' + r.text.slice(0, 60));
  const ohne = await kaeufer(); db.prepare("INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt) VALUES (?,?,'einladung',?)").run(ohne.id, KID, z);
  r = await ohne.req('GET', DL());
  check('Zugang ohne Bestellung (Einladung): Standardsprache (Test: HU)', r.s === 200 && r.text.includes('TEST-HU-MARKER'), r.s + ' ' + r.text.slice(0, 60));

  // ---- Fremde Bestellung / IDOR ----
  const MK = db.prepare("SELECT MIN(id) AS id FROM kurse WHERE id <> ?").get(KID).id;   // erster Muster-Kurs (ids sind nicht fest)
  const d = await kaeufer(); kaufen(d.id, MK, 'de');   // kauft nur einen anderen (Muster-)Kurs
  r = await d.req('GET', DL());
  check('Kaeufer eines ANDEREN Kurses: kein Zugriff auf die Handbuch-Datei (403)', r.s === 403 && !r.text.includes('TEST-'), r.s);
  r = await d.req('GET', DL(MK, LID));
  check('IDOR: Handbuch-Lektion ueber den eigenen Kurs angefragt: 404', r.s === 404 && !r.text.includes('TEST-'), r.s);

  // ---- Abo abgelaufen / unveroeffentlicht / Flag aus ----
  db.prepare('UPDATE zugaenge SET gueltig_bis = ? WHERE benutzer_id = ? AND kurs_id = ?').run(Date.now() - 1000, a.id, KID);
  r = await a.req('GET', DL());
  check('Zugang abgelaufen (gueltig_bis vorbei): 403', r.s === 403, r.s);
  db.prepare('UPDATE zugaenge SET gueltig_bis = NULL WHERE benutzer_id = ? AND kurs_id = ?').run(a.id, KID);
  db.prepare("UPDATE lektionen SET status = 'entwurf' WHERE id = ?").run(LID);
  r = await a.req('GET', DL());
  check('Lektion versteckt (Entwurf): 404 fuer Kaeufer', r.s === 404, r.s);
  db.prepare("UPDATE lektionen SET status = 'veroeffentlicht', download_erlaubt = 0 WHERE id = ?").run(LID);
  r = await a.req('GET', DL());
  check('Flag aus: 404 wie unbekannt, keine Datei', r.s === 404 && !r.text.includes('TEST-'), r.s);
  r = await a.req('GET', `/api/kurse/${KID}`);
  check('Flag aus: Kursseite verraet keine Download-Markierung', r.s === 200 && !JSON.stringify(r.d).includes('download'), JSON.stringify(r.d).slice(0, 200));
  db.prepare('UPDATE lektionen SET download_erlaubt = 1 WHERE id = ?').run(LID);

  // ---- Bestehende Kurs-PDFs bleiben NICHT herunterladbar ----
  const pdfLid = Number(db.prepare("INSERT INTO lektionen (kurs_id,abschnitt,titel,art,inhalt,reihenfolge,status,erstellt,geaendert) VALUES (?,'T','Kurs-PDF','pdf','',50,'veroeffentlicht',?,?)").run(MK, z, z).lastInsertRowid);
  const zufall = randomUUID(); writeFileSync(join(dateiOrdner, zufall), pdf('KURS'));
  db.prepare("INSERT INTO dateien (lektion_id,name,art,pfad,groesse,mime,erstellt) VALUES (?,'kurs.pdf','pdf',?,30,'application/pdf',?)").run(pdfLid, zufall, z);
  r = await d.req('GET', DL(MK, pdfLid));
  check('Normales Kurs-PDF (Flag aus) mit Zugang: KEIN Download (404)', r.s === 404 && !r.text.includes('TEST-KURS'), r.s);
  r = await d.req('GET', `/api/lektionen/${pdfLid}/datei`);
  check('Normales Kurs-PDF ueber die Ansichtsroute ohne Ticket: weiterhin 403', r.s === 403 && !r.text.includes('TEST-KURS'), r.s);
  r = await d.req('GET', `/api/kurse/${MK}?lektion=${pdfLid}`);
  check('Normales Kurs-PDF: keine Download-Markierung', r.s === 200 && !JSON.stringify(r.d).includes('"download"'), JSON.stringify(r.d).slice(0, 120));
  const admin = client(); await admin.req('POST', '/api/demo/zugang', { rolle: 'admin' });
  r = await admin.req('GET', DL(MK, pdfLid));
  check('Auch Admin bekommt ein normales Kurs-PDF nicht als Download (404)', r.s === 404, r.s);

  // ---- Pfadtraversal / keine statische Adresse ----
  for (const p of [`/api/kurse/${KID}/lektionen/..%2F..%2Ftest.db/download`, `/api/kurse/${KID}/lektionen/${LID}%2F..%2F1/download`, `/api/kurse/..%2F${KID}/lektionen/${LID}/download`, `/api/kurse/${KID}/lektionen/0${LID}/download`]) {
    r = await a.req('GET', p);
    check('Traversal/ungueltige ID abgelehnt: ' + p, [400, 404].includes(r.s) && !r.text.includes('TEST-') && !r.text.includes('SQLite'), r.s);
  }
  r = await a.req('GET', DL() + '?pfad=../../test.db');
  check('Zusatzparameter (?pfad=...) abgelehnt: 400', r.s === 400 && !r.text.includes('TEST-'), r.s);
  const altPfad = db.prepare("SELECT pfad FROM download_varianten WHERE lektion_id = ? AND sprache = 'de'").get(LID).pfad;
  db.prepare("UPDATE download_varianten SET pfad = '../test.db' WHERE lektion_id = ?").run(LID);
  r = await a.req('GET', DL());
  check('Manipulierter Pfad in der Datenbank (../test.db): nichts ausgeliefert (404)', r.s === 404 && !r.text.includes('SQLite'), r.s + ' ' + r.text.slice(0, 40));
  db.prepare("UPDATE download_varianten SET pfad = ? WHERE lektion_id = ? AND sprache = 'de'").run(altPfad, LID);
  db.prepare("UPDATE download_varianten SET pfad = ? WHERE lektion_id = ? AND sprache = 'hu'").run(huPfad, LID);
  for (const p of ['/handbuch/ausgabe/handbuch-kaeufer-de.pdf', '/handbuch/handbuch-kaeufer.de.html', '/' + altPfad, '/dateien/' + altPfad, '/daten/dateien/' + altPfad]) {
    r = await anonym.req('GET', p);
    check('Keine statische/erratbare Adresse: ' + p, !r.text.includes('%PDF') && !r.text.includes('TEST-'), r.s + ' ' + r.text.slice(0, 40));
  }
  check('Dateiordner enthaelt nur Zufallsnamen (keine sprechenden Dateinamen)', readdirSync(dateiOrdner).every((n) => /^[0-9a-f-]{36}$/.test(n)), readdirSync(dateiOrdner).join(','));

  // ---- Admin-Demo und Demo-Sperren ----
  r = await admin.req('GET', DL(), undefined, { Cookie: 'lang=en' });
  check('Demo-Admin: Vorschau-Download erlaubt (Sprache der Anfrage EN, hier Fallback DE da EN-Zeile entfernt)', r.s === 200 && r.text.includes('TEST-DE-MARKER'), r.s + ' ' + r.text.slice(0, 60));
  const adminId = db.prepare("SELECT benutzer_id FROM demo_konten WHERE art='admin'").get().benutzer_id;
  await warte(100);
  check('Admin-Download zaehlt NICHT als erster Zugriff und wird nicht protokolliert', db.prepare('SELECT COUNT(*) n FROM erster_zugriff WHERE benutzer_id = ?').get(adminId).n === 0 && db.prepare('SELECT COUNT(*) n FROM download_protokoll WHERE benutzer_id = ?').get(adminId).n === 0);
  r = await admin.req('PATCH', `/api/admin/lektionen/${LID}`, { titel: 'x' });
  check('Demo-Admin bleibt reine Ansicht (PATCH Lektion 403 demo_nur_ansicht)', r.s === 403 && r.d.fehler === 'demo_nur_ansicht', r.s + ' ' + r.d.fehler);
  r = await admin.req('PATCH', `/api/admin/lektionen/${LID}`, { download_erlaubt: 1 });
  check('Demo-Admin kann die Download-Markierung nicht setzen (403)', r.s === 403, r.s);
  r = await a.req('PATCH', `/api/admin/lektionen/${pdfLid}`, { titel: 'x' });
  check('Demo-Kaeufer: Admin-Wege weiterhin gesperrt (403)', r.s === 403, r.s);
  r = await a.req('POST', DL());
  check('POST auf die Download-Route: kein Download', r.s === 404 && !r.text.includes('TEST-'), r.s);

  // ---- Uebersetzung der Demo (nur unveraenderte Seed-Zeilen) ----
  const hu = client(); hu.jar.set('lang', 'hu');
  r = await hu.req('GET', '/api/kurse');
  check('Demo HU: Produkt heisst "Kézikönyv vásárlóknak"', r.s === 200 && r.d.some((k) => k.titel === 'Kézikönyv vásárlóknak'), JSON.stringify(r.d.map?.((k) => k.titel)));
  const en = client(); en.jar.set('lang', 'en');
  r = await en.req('GET', '/api/kurse');
  check('Demo EN: Produkt heisst "Handbook for buyers"', r.s === 200 && r.d.some((k) => k.titel === 'Handbook for buyers'), JSON.stringify(r.d.map?.((k) => k.titel)));

  // ---- Datenauskunft und Kontoloeschung (normales Konto, kein Demo-Konto) ----
  const { passwortHashen } = await import('../auth.mjs');
  const PW = 'Download-Test-Passwort-1';
  const kEmail = 'download-konto@example.com';
  const kid2 = Number(db.prepare("INSERT INTO benutzer (email,passwort_hash,erstellt,email_bestaetigt) VALUES (?,?,?,?)").run(kEmail, await passwortHashen(PW), z, Date.now()).lastInsertRowid);
  const k = client();
  r = await k.req('POST', '/api/anmelden', { email: kEmail, passwort: PW });
  check('Normales Konto: Anmeldung', r.s === 200, r.s + ' ' + r.text.slice(0, 100));
  kaufen(kid2, KID, 'en');
  r = await k.req('GET', DL());
  check('Normales Konto: Download 200', r.s === 200 && r.text.includes('%PDF'), r.s);
  await warte(150);
  r = await k.req('GET', '/api/konto/auskunft');
  const lt = r.d.letoltesek;
  check('Datenauskunft enthaelt die Download-Eintraege (letoltesek: Kurs, Lektion, Sprache, Zeit)', r.s === 200 && Array.isArray(lt) && lt.length === 1 && lt[0].eloadas_azonosito === KID && lt[0].lecke_azonosito === LID && typeof lt[0].nyelv === 'string' && typeof lt[0].idopont === 'string', r.s + ' ' + JSON.stringify(lt));
  check('Datenauskunft: keine fremden Downloads, keine deutschen Schluessel', !JSON.stringify(r.d).includes('"downloads"') && !JSON.stringify(r.d).includes('"lektion_id"'), JSON.stringify(r.d).slice(0, 200));
  r = await k.req('POST', '/api/konto/loeschen', { passwort: PW, bestaetigt: true });
  check('Kontoloeschung erfolgreich', r.s === 200, r.s + ' ' + r.text.slice(0, 100));
  const geloescht = db.prepare('SELECT email, passwort_hash, geloescht FROM benutzer WHERE id = ?').get(kid2);
  const rest = db.prepare('SELECT * FROM download_protokoll WHERE benutzer_id = ?').all(kid2);
  const spalten = db.prepare('PRAGMA table_info(download_protokoll)').all().map((s) => s.name).sort().join(',');
  check('Nach Loeschung: Konto anonymisiert, Download-Protokoll nur pseudonym (wie erster_zugriff, keine E-Mail/IP/Sitzung)', geloescht.geloescht && /^geloescht-\d+@invalid\.invalid$/.test(geloescht.email) && spalten === 'benutzer_id,id,kurs_id,lektion_id,sprache,zeit' && !JSON.stringify(rest).includes(kEmail) && !JSON.stringify(db.prepare('SELECT * FROM benutzer WHERE id = ?').get(kid2)).includes(kEmail), JSON.stringify([geloescht, spalten, rest]));
  r = await k.req('GET', DL());
  check('Nach Loeschung: kein Download mehr (Sitzung weg)', r.s === 401, r.s);

  // ---- Texte ----
  for (const l of ['de', 'en', 'hu']) {
    const t = (await import('../texte/' + l + '.json', { with: { type: 'json' } })).default;
    check('Texte ' + l + ': Knopf und Ausnahme im Schutzhinweis vorhanden', !!t.k_pdf_herunterladen && !!t.k_download_hinweis && /Download|download|letöltésre/.test(t.k_schutz_hinweis), t.k_schutz_hinweis);
  }
} catch (e) { fail++; console.log('FEHLER Ausnahme: ' + String(e.stack || e).slice(0, 500)); }
finally { server?.close(); }
console.log(`Download: ${ok} bestanden, ${fail} fehlgeschlagen`); process.exit(fail ? 1 : 0);
