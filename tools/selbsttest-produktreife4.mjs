import './test-sprache.mjs';
// Produktreife Block 4 (12.11.2026): P1 Preisfeld je Waehrung, P2a Widerrufsliste im Admin, P2b neue Lektionen in sichtbaren Kursen zuerst ausgeblendet,
// P2c Mail bei vom Admin erteiltem Zugang, P3 Datum je Oberflaechensprache, Einzahl/Mehrzahl, Begriff "Kostenloser Zugang", neutraler Abgleich-Hinweis.
// Aufruf (im Ordner plattform): node --disable-warning=ExperimentalWarning tools/selbsttest-produktreife4.mjs
// Offline: Temp-Datenbank, Stripe-Attrappe, Mock-Mailer, eigener Server auf Port 5141 (ohne Demo), kein Netz. Teil D (Browser) nur mit lokalem Chrome
// und playwright-core (C:\Users\diaco\Projekte\browser-werkzeug); fehlt beides, wird Teil D sichtbar als UEBERSPRUNGEN gemeldet.
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const PLATTFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'schulung-produktreife4-'));
process.env.DB_DATEI = join(dir, 'test.db');
let ok = 0, fail = 0, uebersprungen = 0, server;
const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' | ' + String(d).slice(0, 300))); };
const teil = async (name, fn) => { try { await fn(); } catch (e) { check('Teil ' + name + ' lief durch', false, e.stack || e.message); } };
const tick = () => new Promise((r) => setTimeout(r, 30));
const SPRACHEN = ['de', 'en', 'hu'];
const T = Object.fromEntries(SPRACHEN.map((l) => [l, JSON.parse(readFileSync(join(PLATTFORM, 'texte', l + '.json'), 'utf8'))]));
const adminJs = readFileSync(join(PLATTFORM, 'public', 'admin', 'admin.js'), 'utf8');
const PORT = 5141, B = 'http://127.0.0.1:' + PORT;
try {
  // ======================= Teil A: reine Funktionen und Texte =======================
  await teil('A-Preis', async () => {
    const P = await import(pathToFileURL(join(PLATTFORM, 'public', 'preis.js')).href);
    const eur = [['19,99', 1999], ['19.99', 1999], ['19,9', 1990], ['19', 1900], ['0', 0], ['0,50', 50], ['0,05', 5], [' 1 234,56 ', 123456], ['1\u00a0234.5', 123450], ['49,00', 4900], ['10000000', 1_000_000_000]];
    for (const [ein, soll] of eur) check(`P1 EUR-Eingabe ${JSON.stringify(ein)} -> ${soll} Cent`, P.preisZuCent?.(ein, 'eur') === soll, P.preisZuCent?.(ein, 'eur'));
    for (const ein of ['', ' ', 'abc', '-1', '-0,50', '19,999', '19,', ',99', '.99', '1.234,56', '1,234.56', '1e3', '19 EUR', '10000000,01', '123456789', '0x10', '19,9a', 'NaN', 'Infinity'])
      check(`P1 EUR-Eingabe abgelehnt: ${JSON.stringify(ein)}`, P.preisZuCent?.(ein, 'eur') === null, P.preisZuCent?.(ein, 'eur'));
    check('P1 HUF wie bisher ganze Forint: "19900" -> 1990000, "19 900" -> 1990000', P.preisZuCent?.('19900', 'huf') === 1990000 && P.preisZuCent?.('19 900', 'huf') === 1990000);
    check('P1 HUF: Nachkommastellen abgelehnt ("19,99", "19900,00", "19.5")', ['19,99', '19900,00', '19.5'].every((x) => P.preisZuCent?.(x, 'huf') === null));
    check('P1 Dezimalstellen: HUF 0, EUR 2', P.dezimalstellen?.('huf') === 0 && P.dezimalstellen?.('eur') === 2);
    check('P1 Platzhalter je Waehrung: HUF "19900", EUR "49,00"', P.preisBeispiel?.('huf') === '19900' && P.preisBeispiel?.('eur') === '49,00');
    check('P1 Bearbeiten-Anzeige: EUR 1999 -> "19,99", 4900 -> "49,00", 5 -> "0,05", HUF 3990000 -> "39900"',
      P.centZuEingabe?.(1999, 'eur') === '19,99' && P.centZuEingabe?.(4900, 'eur') === '49,00' && P.centZuEingabe?.(5, 'eur') === '0,05' && P.centZuEingabe?.(3990000, 'huf') === '39900');
    // Rundreise: bestehende Preise duerfen sich beim Oeffnen und unveraenderten Speichern nicht aendern (ganzzahlig, kein Gleitkomma-Artefakt).
    const proben = [0, 1, 5, 10, 29, 57, 99, 100, 101, 110, 1005, 1999, 2999, 4900, 64900, 123456, 999999, 1_000_000_000];
    for (let i = 0; i < 2000; i++) proben.push(Math.floor(Math.random() * 1_000_000_001));
    const falsch = proben.filter((c) => P.preisZuCent?.(P.centZuEingabe?.(c, 'eur'), 'eur') !== c);
    check(`P1 Rundreise EUR (Cent -> Feld -> Cent) fuer ${proben.length} Werte unveraendert`, falsch.length === 0, falsch.slice(0, 5).join(','));
    const hufFalsch = proben.map((c) => c - (c % 100)).filter((c) => P.preisZuCent?.(P.centZuEingabe?.(c, 'huf'), 'huf') !== c);
    check('P1 Rundreise HUF (ganze Forint) unveraendert', hufFalsch.length === 0, hufFalsch.slice(0, 5).join(','));
    const altFormat = (c) => (c / 100).toFixed(2).replace('.', ',') + ' EUR';
    const formatAbw = proben.filter((c) => P.formatBetrag(c, 'eur') !== altFormat(c));
    check('P1 Anzeige formatBetrag EUR ganzzahlig und gleich wie vorher (z. B. 1999 -> "19,99 EUR")', P.formatBetrag(1999, 'eur') === '19,99 EUR' && formatAbw.length === 0, formatAbw.slice(0, 5).join(','));
    check('P1 formatBetrag HUF unveraendert ("39 900 Ft")', P.formatBetrag(3990000, 'huf') === '39 900 Ft');
    const { formatGeld } = await import(pathToFileURL(join(PLATTFORM, 'betrag.mjs')).href);
    check('P1 Server-Darstellung betrag.mjs: 1999 eur -> "19,99 EUR", 5 eur -> "0,05 EUR", 3990000 huf -> "39 900 Ft"', formatGeld(1999, 'eur') === '19,99 EUR' && formatGeld(5, 'eur') === '0,05 EUR' && formatGeld(3990000, 'huf') === '39 900 Ft', [formatGeld(1999, 'eur'), formatGeld(5, 'eur')].join('|'));
    check('P1 admin.js nutzt die Waehrungs-Eingabe (preisZuCent/centZuEingabe/preisBeispiel), nicht mehr forintZuCent', adminJs.includes('preisZuCent(ar.value, w)') && adminJs.includes('centZuEingabe(vorhanden.preis_cent, startWaehrung)') && adminJs.includes('placeholder: preisBeispiel(startWaehrung)') && !adminJs.includes('forintZuCent('));
  });
  await teil('A-Texte', async () => {
    const neu = ['a_ar_seged_dezimal', 'a_ar_hibas_dezimal', 'a_abo_ar_hibas_dezimal', 'a_lecke_db_1', 'a_widerruf_cim', 'a_widerruf_magyarazat', 'a_nincs_widerruf', 'a_widerruf_demo', 'a_lecke_hozzaadva_rejtett', 'a_uj_lecke_rejtett_hinweis', 'mail_zugang_betreff', 'mail_zugang_text'];
    for (const l of SPRACHEN) {
      check(`[${l}] neue Schluessel vorhanden (${neu.length})`, neu.every((k) => typeof T[l][k] === 'string' && T[l][k].trim().length > 2), neu.filter((k) => !T[l][k]).join(','));
      check(`[${l}] Preis-Hinweis mit Platzhalter {beispiel}, kein festes 39900 mehr`, T[l].a_ar_seged.includes('{beispiel}') && T[l].a_ar_seged_dezimal.includes('{beispiel}') && !T[l].a_ar_seged.includes('39900'), T[l].a_ar_seged);
      check(`[${l}] Herkunft "Einladung" heisst jetzt "Kostenloser Zugang"`, !/einladung|invitation|megh[ií]v/i.test(T[l].a_quelle_einladung), T[l].a_quelle_einladung);
      check(`[${l}] Abgleich-Hinweis ohne "API-Daten"`, !/api/i.test(T[l].abgleich_webhook_nicht_pruefbar), T[l].abgleich_webhook_nicht_pruefbar);
      check(`[${l}] Zugangsmail-Texte mit Platzhalter {tanfolyam}`, T[l].mail_zugang_betreff.includes('{tanfolyam}') && T[l].mail_zugang_text.includes('{tanfolyam}'));
    }
    check('Einzahl: DE "1 Lektion", EN "1 lesson", HU "1 lecke"', T.de.a_lecke_db_1.replace('{n}', 1) === '1 Lektion' && T.en.a_lecke_db_1.replace('{n}', 1) === '1 lesson' && T.hu.a_lecke_db_1.replace('{n}', 1) === '1 lecke');
    check('HU-Terminologie: "előadás" statt "kurzus" in den neuen Texten', ['a_uj_lecke_rejtett_hinweis', 'mail_zugang_text'].every((k) => T.hu[k].includes('előadás') && !/kurzus/i.test(T.hu[k])));
    check('admin.js: Einzahl/Mehrzahl fuer die Lektionenzahl', adminJs.includes("t(k.lektionen === 1 ? 'a_lecke_db_1' : 'a_lecke_db', { n: k.lektionen })"));
  });
  await teil('A-Datum', async () => {
    // budapestZeit aus admin.js mit verschiedenen Oberflaechensprachen ausfuehren (Quelltext ausschneiden, LOC als Parameter).
    const start = adminJs.indexOf('function budapestZeit(wert){'), ende = adminJs.indexOf('\n', adminJs.indexOf('const MONATE_EN='));
    check('admin.js: budapestZeit und MONATE_EN gefunden', start > 0 && ende > start);
    const quelle = adminJs.slice(start, ende);
    const fuer = (loc) => new Function('LOC', quelle + '\nreturn budapestZeit;')(loc);
    const zeit = '2026-11-12T13:03:05.000Z';   // Budapest (MEZ, UTC+1): 14:03:05
    check('P3 DE: 12.11.2026 14:03:05', fuer('de-DE')(zeit) === '12.11.2026 14:03:05', fuer('de-DE')(zeit));
    check('P3 EN: 12 Nov 2026, 14:03:05', fuer('en-GB')(zeit) === '12 Nov 2026, 14:03:05', fuer('en-GB')(zeit));
    check('P3 HU wie bisher: 2026. 11. 12. 14:03:05', fuer('hu-HU')(zeit) === '2026. 11. 12. 14:03:05', fuer('hu-HU')(zeit));
    check('P3 Sommerzeit Budapest bleibt (UTC+2): 01.07.2026 12:00:00', fuer('de-DE')('2026-07-01T10:00:00Z') === '01.07.2026 12:00:00', fuer('de-DE')('2026-07-01T10:00:00Z'));
    check('P3 leere/ungueltige Zeit weiter "–"', fuer('de-DE')(null) === '–' && fuer('en-GB')('kaputt') === '–');
  });

  // ======================= Teil B: Server (ohne Demo) =======================
  const { db } = await import('../db.mjs');
  const { sitzungErzeugen } = await import('../auth.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const checkouts = [], post = [];
  const stripe = { customers: { create: async () => ({ id: 'cus_p4' }), update: async () => ({}) },
    checkout: { sessions: { create: async (args) => { checkouts.push(args); return { id: 'cs_p4_' + checkouts.length, url: 'https://checkout.stripe.com/test' }; }, retrieve: async () => ({ payment_intent: 'pi_p4' }), list: async () => ({ data: [] }), expire: async () => ({}) } },
    paymentIntents: { retrieve: async (id) => ({ id }) }, refunds: { create: async () => ({ id: 're_p4' }), list: async () => ({ data: [] }) },
    subscriptions: { list: async () => ({ data: [] }), cancel: async () => ({}) },
    billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/test' }) } }, webhooks: { constructEvent: () => ({}) } };
  const jetzt = new Date().toISOString();
  const nutzer = (email, rolle, sprache = 'de') => Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt,rolle,sprache) VALUES(?,?,?,?,?,?)").run(email, 'nur-fuer-selbsttest', jetzt, Date.now(), rolle, sprache).lastInsertRowid);
  const adminId = nutzer('admin-p4@example.org', 'admin'), kundeId = nutzer('kunde-p4@example.org', 'kunde', 'en'), kunde2Id = nutzer('kunde2-p4@example.org', 'kunde', 'hu');
  server = erstelleServer({ stripe, base: B, webhookSecret: 'x', mailer: async (m) => { post.push(m); return true; }, dateiOrdner: join(dir, 'dateien'),
    ellallasWiederaufnahme: false, abgleichAutomatik: false, demoModus: false, trustProxy: 0 }).listen(PORT, '127.0.0.1');
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const sitz = { admin: sitzungErzeugen(adminId), kunde: sitzungErzeugen(kundeId), kunde2: sitzungErzeugen(kunde2Id) };
  const req = async (wer, methode, pfad, body) => {
    const headers = { Origin: B, Cookie: 'lang=de' + (wer ? '; sitzung=' + sitz[wer] : '') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(B + pfad, { method: methode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let d = {}; try { d = JSON.parse(text); } catch { /* kein JSON */ }
    return { s: r.status, d };
  };

  await teil('B-P1-Server', async () => {
    const neu = await req('admin', 'POST', '/api/admin/kurse', { titel: 'Euro-Kurs', preis_cent: 1999, waehrung: 'eur' });
    check('P1 EUR-Kurs 19,99 gespeichert als 1999 Cent', neu.s === 201 && neu.d.preis_cent === 1999 && neu.d.waehrung === 'eur', JSON.stringify(neu));
    const id = neu.d.id;
    for (const [wert, name] of [[1999.5, 'Bruchteil eines Cents'], [-1, 'negativ'], ['1999', 'Zeichenkette'], [null, 'null'], [1e15, 'zu gross'], [1_000_000_001, 'ueber Maximum'], [true, 'Wahrheitswert']]) {
      const r = await req('admin', 'POST', '/api/admin/kurse', { titel: 'X', preis_cent: wert, waehrung: 'eur' });
      check('P1 Server lehnt Preis ab (' + name + ')', r.s === 400 && r.d.fehler === 'preis_ungueltig', JSON.stringify(r));
    }
    const huf = await req('admin', 'POST', '/api/admin/kurse', { titel: 'HUF', preis_cent: 199950, waehrung: 'huf' });
    check('P1 HUF mit Fillér (1999,50 Ft) abgelehnt (preis_huf_teilbar)', huf.s === 400 && huf.d.fehler === 'preis_huf_teilbar', JSON.stringify(huf));
    const abo = await req('admin', 'PATCH', '/api/admin/kurse/' + id, { abo_preis_cent: 999, abo_intervall: 'month' });
    check('P1 EUR-Abopreis 9,99 gespeichert, Einmalpreis unveraendert 1999', abo.s === 200 && abo.d.abo_preis_cent === 999 && abo.d.preis_cent === 1999, JSON.stringify(abo));
    const titel = await req('admin', 'PATCH', '/api/admin/kurse/' + id, { titel: 'Euro-Kurs neu', preis_cent: 1999, abo_preis_cent: 999, abo_intervall: 'month' });
    check('P1 Speichern mit unveraendertem Preis aendert den Preis nicht', titel.s === 200 && titel.d.preis_cent === 1999 && titel.d.abo_preis_cent === 999);
    db.prepare("INSERT INTO lektionen (kurs_id,abschnitt,titel,art,inhalt,reihenfolge,status,erstellt,geaendert) VALUES (?,?,?,'text','x',1,'veroeffentlicht',?,?)").run(id, '', 'L1', jetzt, jetzt);
    await req('admin', 'POST', '/api/admin/kurse/' + id + '/veroeffentlichen', {});
    const kauf = await req('kunde', 'POST', '/api/kurse/' + id + '/kaufen', { zustimmung: true });
    const pos = checkouts.at(-1)?.line_items?.[0]?.price_data;
    check('P1 Stripe-Checkout: unit_amount 1999, Waehrung eur (Betrag nur vom Server)', kauf.s === 200 && pos?.unit_amount === 1999 && pos?.currency === 'eur', JSON.stringify([kauf.s, kauf.d, pos]));
  });

  await teil('B-P2a-Widerrufe', async () => {
    const kid = db.prepare("SELECT id FROM kurse WHERE titel='Euro-Kurs neu'").get().id;
    const best = (n, betrag) => Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert) VALUES(?,?,?,?,?,'eur','bezahlt',?,?)").run('cs_w' + n, 'pi_w' + n, kundeId, kid, betrag, jetzt, jetzt).lastInsertRowid);
    const b1 = best(1, 1999), b2 = best(2, 2999), b3 = best(3, 3999);
    db.prepare("INSERT INTO ellallas(bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES(?,?,'fehler','stripe',?)").run(b1, '2026-11-12T10:00:00.000Z', jetzt);
    db.prepare("INSERT INTO ellallas(bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES(?,?,'bearbeitung',NULL,?)").run(b2, '2026-11-12T11:00:00.000Z', jetzt);
    db.prepare("INSERT INTO ellallas(bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES(?,?,'erstattung',NULL,?)").run(b3, '2026-11-12T12:00:00.000Z', jetzt);
    const r = await req('admin', 'GET', '/api/admin/widerrufe');
    check('P2a Admin: Liste mit genau den zwei offenen Widerrufen (fehler, bearbeitung), neueste zuerst', r.s === 200 && Array.isArray(r.d) && r.d.length === 2 && r.d[0].bestellung_id === b2 && r.d[1].bestellung_id === b1, JSON.stringify(r));
    const z = r.d?.[1] || {};
    check('P2a Felder: Bestellung, Datum, Status, Betrag, Waehrung, Kurs, E-Mail', z.ergebnis === 'fehler' && z.betrag === 1999 && z.waehrung === 'eur' && z.zeit === '2026-11-12T10:00:00.000Z' && z.kurs_titel === 'Euro-Kurs neu' && z.benutzer_email === 'kunde-p4@example.org', JSON.stringify(z));
    const k = await req('admin', 'GET', '/api/admin/kennzahlen');
    const pruefen = db.prepare("SELECT COUNT(*) n FROM bestellungen WHERE status='pruefen'").get().n;
    check('P2a Kennzahl "Offene Pruefungen" = zu pruefende Zahlungen + Laenge der Widerrufsliste', k.s === 200 && k.d.offen === pruefen + r.d.length, JSON.stringify(k.d));
    check('P2a Kunde: 403 kein_admin', (await req('kunde', 'GET', '/api/admin/widerrufe')).s === 403);
    check('P2a ohne Anmeldung: 401', (await req(null, 'GET', '/api/admin/widerrufe')).s === 401);
    check('P2a unbekannter Parameter: 400', (await req('admin', 'GET', '/api/admin/widerrufe?status=alle')).s === 400);
    check('P2a admin.js zeigt die Liste mit vorhandenen Statustexten', adminJs.includes("api('GET', '/api/admin/widerrufe')") && adminJs.includes("bearbeitung: 'ellallas_inhaber_bearbeitung', fehler: 'ellallas_inhaber_fehler'") && adminJs.includes("t('a_widerruf_demo')"));
    const demoQ = readFileSync(join(PLATTFORM, 'demo.mjs'), 'utf8');
    check('P2a Demo: Widerrufsliste in ADMIN_LESEN_GESPERRT (Pruefung im Demo-Server: selbsttest-demo-sicherheit)', /ADMIN_LESEN_GESPERRT = \/[^\n]*\|widerrufe\)/.test(demoQ));
  });

  await teil('B-P2b-Lektionen', async () => {
    const kid = db.prepare("SELECT id FROM kurse WHERE titel='Euro-Kurs neu'").get().id;
    db.prepare("INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt) VALUES (?,?,'zahlung',?) ON CONFLICT DO NOTHING").run(kunde2Id, kid, jetzt);
    const vorher = db.prepare('SELECT id,status FROM lektionen WHERE kurs_id=? ORDER BY id').all(kid);
    const neu = await req('admin', 'POST', '/api/admin/kurse/' + kid + '/lektionen', { titel: 'Neue Lektion im veroeffentlichten Kurs', inhalt: 'GEHEIM-NEU' });
    check('P2b neue Lektion im veroeffentlichten Kurs: Status entwurf (ausgeblendet)', neu.s === 201 && neu.d.status === 'entwurf', JSON.stringify(neu));
    const sicht = async () => (await req('kunde2', 'GET', '/api/kurse/' + kid)).d.lektionen?.map((l) => l.id) ?? [];
    check('P2b Kaeufer sieht die neue Lektion noch nicht', !(await sicht()).includes(neu.d.id));
    check('P2b bestehende Lektionen unveraendert sichtbar', JSON.stringify(db.prepare('SELECT id,status FROM lektionen WHERE kurs_id=? AND id<>? ORDER BY id').all(kid, neu.d.id)) === JSON.stringify(vorher) && vorher.every((l) => l.status === 'veroeffentlicht'));
    const frei = await req('admin', 'PATCH', '/api/admin/lektionen/' + neu.d.id, { status: 'veroeffentlicht' });
    check('P2b Admin gibt frei ("Einblenden") -> Kaeufer sieht sie', frei.s === 200 && (await sicht()).includes(neu.d.id));
    const ausdruecklich = await req('admin', 'POST', '/api/admin/kurse/' + kid + '/lektionen', { titel: 'Sofort sichtbar', status: 'veroeffentlicht' });
    check('P2b ausdruecklicher Status bleibt moeglich (veroeffentlicht)', ausdruecklich.s === 201 && ausdruecklich.d.status === 'veroeffentlicht');
    const entwurfKurs = await req('admin', 'POST', '/api/admin/kurse', { titel: 'Entwurfskurs', preis_cent: 4900, waehrung: 'eur' });
    const inEntwurf = await req('admin', 'POST', '/api/admin/kurse/' + entwurfKurs.d.id + '/lektionen', { titel: 'Lektion im Entwurfskurs' });
    check('P2b Entwurfskurs: neue Lektion wie bisher sichtbar markiert (veroeffentlicht)', inEntwurf.s === 201 && inEntwurf.d.status === 'veroeffentlicht', JSON.stringify(inEntwurf));
    db.prepare("UPDATE kurse SET status='archiviert' WHERE id=?").run(kid);
    const arch = await req('admin', 'POST', '/api/admin/kurse/' + kid + '/lektionen', { titel: 'Lektion im archivierten Kurs' });
    check('P2b archivierter Kurs (Bestandskunden sehen ihn): neue Lektion ausgeblendet', arch.s === 201 && arch.d.status === 'entwurf');
    db.prepare("UPDATE kurse SET status='veroeffentlicht' WHERE id=?").run(kid);
    check('P2b admin.js: Hinweis im Formular und eigene Meldung fuer ausgeblendet angelegte Lektion', adminJs.includes("t('a_uj_lecke_rejtett_hinweis')") && adminJs.includes("a.d?.status === 'entwurf' ? t('a_lecke_hozzaadva_rejtett')"));
  });

  await teil('B-P2c-Zugangsmail', async () => {
    const kid = db.prepare("SELECT id FROM kurse WHERE titel='Entwurfskurs'").get().id;
    db.prepare("UPDATE kurse SET status='veroeffentlicht' WHERE id=?").run(kid);
    post.length = 0;
    const r = await req('admin', 'POST', '/api/admin/kurse/' + kid + '/zugaenge', { email: 'kunde-p4@example.org' });
    await tick(); await tick();
    const m = post.filter((x) => x.to === 'kunde-p4@example.org');
    check('P2c Zugang erteilt: genau eine Mail an den Kunden', r.s === 201 && m.length === 1, JSON.stringify([r, post.map((x) => [x.to, x.subject])]));
    check('P2c Mail in Kundensprache (EN) mit Kurstitel im Betreff und Link zu den Kursen', m[0]?.subject === T.en.mail_zugang_betreff.replace('{tanfolyam}', 'Entwurfskurs') && m[0]?.text.includes(B + '/#/eloadasaim') && m[0]?.text.includes(T.en.mail_zugang_text.replace('{tanfolyam}', 'Entwurfskurs')) && m[0]?.html.includes('lang="en"'), JSON.stringify(m[0]?.subject));
    check('P2c Auftrag als gesendet markiert, Idempotenz-Schluessel je Auftrag', db.prepare("SELECT status FROM zugang_mail_ausgang ORDER BY id DESC LIMIT 1").get()?.status === 'gesendet' && /^schulung-zugang-[0-9a-f]{16}-\d+$/.test(m[0]?.idempotencyKey || ''), m[0]?.idempotencyKey);
    const doppelt = await req('admin', 'POST', '/api/admin/kurse/' + kid + '/zugaenge', { email: 'kunde-p4@example.org' });
    await tick();
    check('P2c zweite Erteilung (schon Zugang): 409, keine weitere Mail', doppelt.s === 409 && post.filter((x) => x.to === 'kunde-p4@example.org').length === 1);
    const hu = await req('admin', 'POST', '/api/admin/kurse/' + kid + '/zugaenge', { email: 'kunde2-p4@example.org' });
    await tick(); await tick();
    const m2 = post.filter((x) => x.to === 'kunde2-p4@example.org');
    check('P2c zweiter Kunde (Kontosprache HU): Mail auf Ungarisch', hu.s === 201 && m2.length === 1 && m2[0].subject === T.hu.mail_zugang_betreff.replace('{tanfolyam}', 'Entwurfskurs'), JSON.stringify(m2.map((x) => x.subject)));
    await req('admin', 'DELETE', '/api/admin/kurse/' + kid + '/zugaenge/' + kundeId);
    const wieder = await req('admin', 'POST', '/api/admin/kurse/' + kid + '/zugaenge', { email: 'kunde-p4@example.org' });
    await tick(); await tick();
    check('P2c nach Entzug und erneuter Erteilung: wieder eine Mail', wieder.s === 201 && post.filter((x) => x.to === 'kunde-p4@example.org').length === 2);
    const gratisVor = post.length;
    const gratis = await req('admin', 'POST', '/api/admin/kurse', { titel: 'Gratis', preis_cent: 0, waehrung: 'huf' });
    await req('admin', 'POST', '/api/admin/kurse/' + gratis.d.id + '/veroeffentlichen', {});
    await req('kunde2', 'POST', '/api/kurse/' + gratis.d.id + '/kaufen', {});
    await tick(); await tick();
    check('P2c Gratis-Einschreibung durch den Kunden: keine Zugangsmail (nur die bisherige Gratis-Mail)', db.prepare('SELECT COUNT(*) n FROM zugang_mail_ausgang WHERE kurs_id=?').get(gratis.d.id).n === 0 && post.length === gratisVor + 1, String(post.length - gratisVor));
    // Mailer-Bausteine direkt: ohne Mailer nichts vormerken, Demo-Adresse nie versenden, geloeschtes Konto nie anschreiben.
    const { mailDienst } = await import('../mail.mjs');
    const { demoMailer } = await import('../demo.mjs');
    const ohne = mailDienst({ mailer: null, base: B });
    const vor = db.prepare('SELECT COUNT(*) n FROM zugang_mail_ausgang').get().n;
    ohne.zugangVormerken(kundeId, kid);
    check('P2c ohne Mailer: kein Auftrag', db.prepare('SELECT COUNT(*) n FROM zugang_mail_ausgang').get().n === vor);
    const echt = [];
    const demo = mailDienst({ mailer: demoMailer(async (x) => { echt.push(x); return true; }), base: B, demoModus: true });
    const demoId = nutzer('demo-p4test@example.com', 'kunde');
    demo.zugangVormerken(demoId, kid); await demo.zugangAusgangSenden();
    check('P2c Demo-Adresse (demo-...@example.com): nichts versendet, Auftrag erledigt', echt.length === 0 && db.prepare('SELECT status FROM zugang_mail_ausgang WHERE benutzer_id=?').get(demoId)?.status === 'gesendet');
    const weg = nutzer('weg-p4@example.org', 'kunde');
    const d2 = mailDienst({ mailer: async (x) => { echt.push(x); return true; }, base: B });
    d2.zugangVormerken(weg, kid); db.prepare('UPDATE benutzer SET geloescht=? WHERE id=?').run(Date.now(), weg); await d2.zugangAusgangSenden();
    check('P2c geloeschtes Konto: keine Mail', echt.length === 0);
  });

  await teil('B-P3-Herkunft', async () => {
    const kid = db.prepare("SELECT id FROM kurse WHERE titel='Entwurfskurs'").get().id;
    const z = await req('admin', 'GET', '/api/admin/kurse/' + kid + '/zugaenge');
    check('P3 Zugangsliste: Herkunft "einladung" bleibt als Code (Anzeige "Kostenloser Zugang")', z.s === 200 && z.d.some((x) => x.quelle === 'einladung') && adminJs.includes("'a_quelle_einladung'"));
    const t = await (await fetch(B + '/api/texte', { headers: { Cookie: 'lang=de' } })).json();
    check('P3 /api/texte (de): a_quelle_einladung = "Kostenloser Zugang"', t.a_quelle_einladung === 'Kostenloser Zugang', t.a_quelle_einladung);
  });

  // ======================= Teil D: Browser (Admin-Formular, echte Oberflaeche) =======================
  await teil('D-Browser', async () => {
    const PW = process.env.PLAYWRIGHT_CORE || 'C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs';
    const CHROME = process.env.CHROME_PFAD || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    if (!existsSync(PW) || !existsSync(CHROME)) { uebersprungen++; console.log('UEBERSPRUNGEN Teil D (Browser): playwright-core oder Chrome fehlt'); return; }
    const { chromium } = await import(pathToFileURL(PW).href);
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
      for (const l of SPRACHEN) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: l });
        await ctx.addCookies([{ name: 'lang', value: l, url: B }, { name: 'sitzung', value: sitz.admin, url: B }]);
        const p = await ctx.newPage();
        await p.goto(B + '/admin/', { waitUntil: 'load' });
        await p.waitForSelector('.kurskarte', { timeout: 8000 });
        await p.waitForFunction(() => !document.body.innerText.includes('…') || document.querySelectorAll('.lecke').length > 0, null, { timeout: 3000 }).catch(() => {});
        await p.waitForTimeout(500);
        const text = await p.evaluate(() => document.body.innerText);
        check(`[${l}] D Uebersicht: Abschnitt "${T[l].a_widerruf_cim}" mit beiden offenen Widerrufen und Statustext`, text.includes(T[l].a_widerruf_cim) && text.includes(T[l].ellallas_inhaber_fehler) && text.includes(T[l].ellallas_inhaber_bearbeitung), text.slice(0, 200));
        const eins = T[l].a_lecke_db_1.replace('{n}', '1'), mehr = T[l].a_lecke_db.replace('{n}', '1');
        check(`[${l}] D Kurskarte mit einer Lektion: "${eins}"` + (eins !== mehr ? ` statt "${mehr}"` : ''), text.includes(eins) && (eins === mehr || !new RegExp('(^|\\D)' + mehr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\D|$)').test(text)));
        // Neuer Kurs in EUR mit 19,99
        await p.getByRole('button', { name: T[l].a_uj_kurzus, exact: true }).click();
        await p.waitForSelector('form.karte select');
        await p.locator('form.karte input[type=text]').first().fill('Browser EUR ' + l);
        await p.locator('form.karte select').first().selectOption('eur');
        const preisFeld = p.locator('form.karte input[inputmode]').first();
        const platz = await preisFeld.getAttribute('placeholder');
        const hinweis = await p.locator('form.karte .hinweis').first().innerText();
        const beispiel = l === 'en' ? '49.00' : '49,00';
        check(`[${l}] D EUR: Platzhalter "${beispiel}" und Hinweis mit Nachkommastellen (kein 39900)`, platz === beispiel && hinweis === T[l].a_ar_seged_dezimal.replace('{beispiel}', beispiel), JSON.stringify([platz, hinweis]));
        await preisFeld.fill(l === 'en' ? '19.99' : '19,99');
        await p.locator('form.karte button[type=submit]').first().click();
        await p.waitForTimeout(800);
        const gespeichert = db.prepare('SELECT id,preis_cent,waehrung FROM kurse WHERE titel=?').get('Browser EUR ' + l);
        check(`[${l}] D Formular speichert ${l === 'en' ? '19.99' : '19,99'} EUR als 1999 Cent`, gespeichert?.preis_cent === 1999 && gespeichert?.waehrung === 'eur', JSON.stringify(gespeichert));
        // HUF-Hinweis
        await p.goto(B + '/admin/', { waitUntil: 'load' }); await p.waitForSelector('.kurskarte');
        await p.getByRole('button', { name: T[l].a_uj_kurzus, exact: true }).click();
        await p.waitForSelector('form.karte select');
        const hufPlatz = await p.locator('form.karte input[inputmode]').first().getAttribute('placeholder');
        const hufHinweis = await p.locator('form.karte .hinweis').first().innerText();
        check(`[${l}] D HUF: Platzhalter "19900", Hinweis ganze Zahl`, hufPlatz === '19900' && hufHinweis === T[l].a_ar_seged.replace('{beispiel}', '19900'), JSON.stringify([hufPlatz, hufHinweis]));
        await p.locator('form.karte input[type=text]').first().fill('Browser HUF ' + l);
        await p.locator('form.karte input[inputmode]').first().fill('19,99');
        await p.locator('form.karte button[type=submit]').first().click();
        await p.waitForTimeout(400);
        const meld = await p.evaluate(() => document.querySelector('.meldung.rot')?.innerText || '');
        check(`[${l}] D HUF "19,99" im Browser abgelehnt (bisherige Meldung)`, meld === T[l].a_ar_hibas && !db.prepare('SELECT 1 FROM kurse WHERE titel=?').get('Browser HUF ' + l), meld);
        // Bearbeiten: vorhandener EUR-Preis wird korrekt angezeigt und bleibt beim Speichern gleich
        await p.goto(B + '/admin/', { waitUntil: 'load' }); await p.waitForSelector('.kurskarte');
        const karte = p.locator('.kurskarte', { hasText: 'Browser EUR ' + l });
        await karte.getByRole('button', { name: T[l].a_megnyitas }).click();
        await p.locator('details.karte summary', { hasText: T[l].a_adatok }).click();
        await p.waitForSelector('details.karte form input[inputmode]');
        const wert = await p.locator('details.karte form input[inputmode]').first().inputValue();
        check(`[${l}] D Bearbeiten zeigt ${l === 'en' ? '19.99' : '19,99'}`, wert === (l === 'en' ? '19.99' : '19,99'), wert);
        await p.locator('details.karte form button[type=submit]').first().click();
        await p.waitForTimeout(600);
        check(`[${l}] D unveraendert gespeichert: weiter 1999 Cent`, db.prepare('SELECT preis_cent FROM kurse WHERE id=?').get(gespeichert.id)?.preis_cent === 1999);
        // Datum in der Zugangsliste des Entwurfskurses (Zugang vorhanden)
        const kid = db.prepare("SELECT id FROM kurse WHERE titel='Entwurfskurs'").get().id;
        await p.goto(B + '/admin/', { waitUntil: 'load' }); await p.waitForSelector('.kurskarte');
        await p.locator('.kurskarte', { hasText: 'Entwurfskurs' }).getByRole('button', { name: T[l].a_megnyitas }).click();
        await p.waitForFunction((s) => document.body.innerText.includes(s), T[l].a_quelle_einladung, { timeout: 5000 }).catch(() => {});
        const kursText = await p.evaluate(() => document.body.innerText);
        const muster = { de: /\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}/, en: /\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}, \d{2}:\d{2}:\d{2}/, hu: /\d{4}\. \d{2}\. \d{2}\. \d{2}:\d{2}:\d{2}/ }[l];
        check(`[${l}] D Zugangsliste: Datum im ${l}-Format, Herkunft "${T[l].a_quelle_einladung}"`, muster.test(kursText) && kursText.includes(T[l].a_quelle_einladung) && (l === 'hu' || !/\d{4}\. \d{2}\. \d{2}\./.test(kursText)), kursText.slice(0, 300));
        check(`[${l}] D Formular neue Lektion: Hinweis "ausgeblendet" im veroeffentlichten Kurs`, kursText.includes(T[l].a_uj_lecke_rejtett_hinweis));
        await ctx.close();
        void kid;
      }
    } finally { await browser.close(); }
  });
} catch (e) {
  check('Testablauf', false, e.stack || e.message);
} finally {
  server?.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows: Datei evtl. noch gesperrt */ }
}
console.log(`\nProduktreife 4: ${ok} bestanden, ${fail} fehlgeschlagen` + (uebersprungen ? ', Teil D uebersprungen' : ''));
process.exit(fail ? 1 : 0);
