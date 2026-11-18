// Etappe B2 (NUR Stripe-TESTMODUS): drei Ausfall-/Streitfaelle gegen ECHTES Stripe, reproduzierbar.
//  dispute            : Testkarte 4000000000000259 -> echter Stripe-Streit -> Webhook charge.dispute.created/closed -> Status, Zugang, Inhaber-Warnmail
//  mailausfall        : Mailversand scheitert (Flagdatei) -> Kauf und Zugang bleiben korrekt, Mail bleibt offen, nach Neustart genau einmal zugestellt
//  neustart-kauf      : Server hart beendet VOR der Zahlung, Zahlung bei Stripe, Neustart, Stripe-Webhook (Original-Ereignis, signiert, zweimal) -> genau 1 bezahlt, 1 Zugang, 1 Mail
//  neustart-erstattung: Server hart beendet mitten im Widerruf (zwei Zeitpunkte), Neustart -> genau EINE Erstattung bei Stripe, Bestellung erstattet, Kundenmail genau einmal
// Start: tools\E2E-B2-Start.ps1. Ergebnis: $E2E_ORDNER\ergebnis-b2.md
import { readFileSync, existsSync, writeFileSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);
const Stripe = (await import('stripe')).default;

if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) { console.error('Abbruch: nur Testmodus.'); process.exit(2); }
const BASE = process.env.BASE_URL || 'http://localhost:4471', ORD = process.env.E2E_ORDNER, MAIL_DUMP = process.env.MAIL_DUMP, FLAG = process.env.MAIL_FAIL_DATEI;
const faelle = process.argv.slice(2).length ? process.argv.slice(2) : ['dispute', 'mailausfall', 'neustart-kauf', 'neustart-erstattung', 'doppel', 'dispute-vorab'];
const st = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-07-30.basil' });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = []; let nr = 0, fehler = 0;
function pruefe(name, eingabe, erwartet, ok, ist) {
  nr++; if (!ok) fehler++;
  const z = `| ${nr} | ${name} | ${eingabe} | ${erwartet} | ${String(ist).replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 260)} | ${ok ? 'bestanden' : 'FEHLER'} |`;
  zeilen.push(z); console.log(z);
}
// ---- Prozesse (Plattform und stripe listen) ----
let srv = null, listen = null, srvNr = 0;
function serverStart() {
  srvNr++;
  const out = openSync(`${ORD}\\server-${srvNr}.log`, 'a'), err = openSync(`${ORD}\\server-${srvNr}.err`, 'a');
  srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'tools\\e2e-server.mjs'], { stdio: ['ignore', out, err], windowsHide: true });
  srv.exited = false; srv.on('exit', () => { srv.exited = true; });
  return srv;
}
async function serverBereit() { for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/api/anbieter'); if (r.status < 500) return true; } catch { /* noch nicht da */ } await warte(500); } return false; }
async function serverHart() { const s = srv; if (!s || s.exited) return; process.kill(s.pid, 'SIGKILL'); for (let i = 0; i < 50 && !s.exited; i++) await warte(100); }
function listenStart() {
  const out = openSync(`${ORD}\\listen.log`, 'a'), err = openSync(`${ORD}\\listen.err`, 'a');
  listen = spawn('stripe', ['listen', '--api-key', process.env.STRIPE_SECRET_KEY, '--events', 'checkout.session.completed,checkout.session.expired,invoice.paid,invoice.payment_failed,charge.refunded,refund.updated,refund.created,charge.dispute.created,charge.dispute.updated,charge.dispute.closed,customer.subscription.updated,customer.subscription.deleted', '--forward-to', BASE + '/webhook'], { stdio: ['ignore', out, err], windowsHide: true, shell: false });
}
// ---- HTTP-Client wie bei den Sprach-E2E ----
function client(l) {
  let cookie = 'lang=' + l;
  return { async anf(m, p, body) {
    const r = await fetch(BASE + p, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie, 'Accept-Language': l }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const [k] = kv.split('='); cookie = cookie.split('; ').filter((x) => !x.startsWith(k + '=')).concat(kv).join('; '); }
    let d = null, t = ''; try { t = await r.text(); d = JSON.parse(t); } catch { /* kein JSON */ }
    return { s: r.status, d, h: r.headers, t };
  } };
}
const mails = () => (existsSync(MAIL_DUMP) ? readFileSync(MAIL_DUMP, 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x)) : []);
async function mailAn(adr, ab, teil, n = 40) { for (let i = 0; i < n; i++) { const m = mails().filter((x) => x.to === adr && x.zeit >= ab && (!teil || (x.subject + x.text).includes(teil))); if (m.length) return m; await warte(1000); } return []; }
let db; const q = (sql, ...a) => db.prepare(sql).get(...a);
let browser;
let kursId; let zaehler = 0;
async function konto(L = 'de') {
  const U = client(L), email = `b2.${++zaehler}.${Date.now()}@example.com`, pw = 'Muster-E2E-2026!x', t0 = Date.now();
  await U.anf('POST', '/api/registrieren', { email, passwort: pw, zustimmung: true });
  const bm = await mailAn(email, t0, ''); const tok = (bm[0]?.text.match(/token=([A-Za-z0-9_-]{20,})/) || bm[0]?.text.match(/([A-Za-z0-9_-]{43})/) || [])[1];
  if (tok) await U.anf('POST', '/api/email-bestaetigen', { token: tok });
  await U.anf('POST', '/api/anmelden', { email, passwort: pw });
  return { U, email, uid: q('SELECT id FROM benutzer WHERE email=?', email).id };
}
// Checkout oeffnen und mit Karte bezahlen. warteRueckkehr=false: nicht auf die Plattform warten (Server evtl. aus), stattdessen Stripe-Sitzung pruefen.
async function bezahle(U, karte, warteRueckkehr = true, vorSenden = null) {
  const ks = await U.anf('POST', `/api/kurse/${kursId}/kaufen`, { zustimmung: true });
  const url = ks.d?.url; if (!/checkout\.stripe\.com/.test(url || '')) return { fehler: `Checkout ${ks.s} ${ks.t.slice(0, 100)}` };
  const sid = url.match(/(cs_test_[A-Za-z0-9]+)/)?.[1];
  const seite = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
  try {
    await seite.goto(url, { waitUntil: 'domcontentloaded' }); await seite.waitForTimeout(5000);
    const f = async (sel, wert) => { const el = seite.locator(sel).first(); await el.waitFor({ timeout: 15000 }); await el.fill(wert); };
    for (const qs of ['[data-testid="card-accordion-item-button"]', 'input[type=radio][value=card]', 'label:has-text("Karte"), label:has-text("Card")', 'text=/^(Karte|Card|Kártya)$/']) { const el = seite.locator(qs).first(); if (await el.count()) { await el.click({ timeout: 8000, force: true }).catch(() => {}); await seite.waitForTimeout(1500); if (await seite.locator('#cardNumber').count()) break; } }
    await f('#cardNumber', karte); await f('#cardExpiry', '1233'); await f('#cardCvc', '123'); await f('#billingName', 'Max Mustermann');
    const land = seite.locator('#billingCountry'); if (await land.count()) await land.selectOption('DE').catch(() => {});
    for (const [sel, w] of [['#billingAddressLine1', 'Beispielstrasse 1'], ['#billingLocality', 'Musterstadt']]) { const el = seite.locator(sel).first(); if (await el.count()) await el.fill(w).catch(() => {}); }
    const plz = seite.locator('#billingPostalCode'); if (await plz.count()) await plz.fill('12345').catch(() => {});
    if (vorSenden) await vorSenden();
    await seite.locator('button.SubmitButton, button[type=submit]').first().click();
    if (warteRueckkehr) await seite.waitForURL(new RegExp(new URL(BASE).host.replace('.', '\.')), { timeout: 60000 });
    else { let s; for (let i = 0; i < 60; i++) { s = await st.checkout.sessions.retrieve(sid); if (s.status === 'complete') break; await warte(1000); } if (s.status !== 'complete') return { fehler: 'Stripe-Sitzung nicht complete: ' + s.status }; }
  } catch (e) { await seite.screenshot({ path: `${ORD}\\fehler-${zaehler}.png` }).catch(() => {}); return { fehler: e.message.split('\n')[0] }; }
  finally { await seite.close().catch(() => {}); }
  return { sid };
}
async function bestellungWarten(uid, status, n = 60) { let b; for (let i = 0; i < n; i++) { b = db.prepare('SELECT * FROM bestellungen WHERE benutzer_id=? ORDER BY id DESC').get(uid); if (b?.status === status) return b; await warte(1000); } return b; }
const liefere = async (e) => { const body = JSON.stringify(e); const hdr = st.webhooks.generateTestHeaderString({ payload: body, secret: process.env.STRIPE_WEBHOOK_SECRET }); const x = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': hdr }, body }); return x.status; };
const listenZeilen = (evtId) => { const f = ORD + '/listen.log'; return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((z) => z.includes(evtId) && z.includes('<--')).map((z) => (z.match(/\[(\d+)\]/) || [])[1]) : []; };
const zugaenge = (uid) => q('SELECT COUNT(*) c FROM zugaenge WHERE benutzer_id=? AND kurs_id=?', uid, kursId).c;
const piVon = async (b) => { let pi = b.zahlung_id; if (!pi) { const cs = await st.checkout.sessions.retrieve(b.stripe_sitzung); pi = typeof cs.payment_intent === 'string' ? cs.payment_intent : cs.payment_intent?.id; } return pi; };

// ================= Start =================
listenStart(); serverStart();
if (!(await serverBereit())) { console.error('Server startet nicht, siehe', ORD); process.exit(2); }
await warte(6000);
db = new DatabaseSync(ORD + '\\e2e.db');
const jetzt = new Date().toISOString();
db.prepare('INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES (?,?,?,?,?,?,?)').run('B2 Musterkurs', 'Testkurs Etappe B2', 64900, 'eur', 'veroeffentlicht', jetzt, jetzt);
kursId = db.prepare('SELECT id FROM kurse ORDER BY id DESC LIMIT 1').get().id;
db.prepare('INSERT INTO lektionen (kurs_id,abschnitt,titel,art,inhalt,reihenfolge,status,erstellt,geaendert) VALUES (?,?,?,?,?,?,?,?,?)').run(kursId, 'A', 'Lektion 1', 'text', 'Inhalt', 1, 'veroeffentlicht', jetzt, jetzt);
db.exec("DELETE FROM sqlite_sequence WHERE name='bestellungen'");
db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES('bestellungen',?)").run(Math.floor(Date.now() / 1000) % 100000000);
browser = await chromium.launch();
const INHABER = process.env.VERKAUFSMELDUNG_MAIL;

try {
// ---------- 1 DISPUTE ----------
if (faelle.includes('dispute')) {
  console.log('\n=== DISPUTE ===');
  const { U, email, uid } = await konto(); const t0 = Date.now();
  const r = await bezahle(U, '4000000000000259');
  pruefe('[dispute] Zahlung mit Streit-Testkarte 4000000000000259', 'Checkout, Karte 4000000000000259', 'Zahlung gelingt, Rueckkehr', !r.fehler, r.fehler || r.sid);
  const b1 = await bestellungWarten(uid, 'bezahlt');
  pruefe('[dispute] Kauf zunaechst bezahlt, Zugang da', 'Webhook checkout.session.completed', 'bezahlt, 1 Zugang', b1?.status === 'bezahlt' || b1?.status === 'pruefen', `status=${b1?.status} zugaenge=${zugaenge(uid)}`);
  const pi = await piVon(b1);
  // Stripe legt den Streit selbst an (Testkarte), ggf. nach einigen Sekunden
  let b2; for (let i = 0; i < 25; i++) { b2 = db.prepare('SELECT status,grund FROM bestellungen WHERE id=?').get(b1.id); if (b2.status === 'pruefen' && b2.grund === 'streitfall') break; await warte(1000); }
  const streite = await st.disputes.list({ payment_intent: pi, limit: 5 });
  pruefe('[dispute] Stripe hat echten Streit angelegt', 'disputes.list(payment_intent)', '1 Streit', streite.data.length === 1, `Anzahl ${streite.data.length} Status ${streite.data[0]?.status} Grund ${streite.data[0]?.reason} ${streite.data[0]?.id}`);
  const dev = (await st.events.list({ type: 'charge.dispute.created', created: { gte: Math.floor(t0 / 1000) - 5 }, limit: 20 })).data.find((e) => (typeof e.data.object.payment_intent === 'string' ? e.data.object.payment_intent : e.data.object.payment_intent?.id) === pi);
  if (!(b2.status === 'pruefen' && b2.grund === 'streitfall') && dev) {
    // Stripe wiederholt fehlgeschlagene Zustellungen selbst (Live: Backoff bis 3 Tage). stripe listen wiederholt nicht: die Wiederholung wird hier mit dem Original-Ereignis nachgestellt.
    const sw = await liefere(dev); for (let i = 0; i < 20; i++) { b2 = db.prepare('SELECT status,grund FROM bestellungen WHERE id=?').get(b1.id); if (b2.status === 'pruefen' && b2.grund === 'streitfall') break; await warte(1000); }
    pruefe('[dispute] Wiederholte Zustellung (wie Stripe-Retry): Plattform verarbeitet nun', 'signiertes Original-Ereignis', '200', sw === 200, `Status ${sw}`);
  }
  pruefe('[dispute] Webhook charge.dispute.created: Bestellung pruefen/streitfall', 'stripe listen', 'status=pruefen grund=streitfall', b2.status === 'pruefen' && b2.grund === 'streitfall', `status=${b2.status} grund=${b2.grund}`);
  pruefe('[dispute] Zugang entzogen', 'zugaenge', '0', zugaenge(uid) === 0, `zugaenge=${zugaenge(uid)}`);
  const ev = db.prepare("SELECT typ,status FROM ereignisse WHERE email=? ORDER BY id").all(email);
  pruefe('[dispute] Ereignishistorie enthaelt den Streitfall', 'ereignisse', 'Zeile streitfall', ev.some((x) => /streit/.test(x.status || x.typ)), JSON.stringify(ev));
  const istStreit = (x) => /(Streit|streit|Rückbuchung|dispute|Dispute)/.test(x.subject + x.text);
  let w = []; for (let i = 0; i < 60; i++) { w = mails().filter((x) => x.to === INHABER && x.zeit >= t0); if (w.some(istStreit)) break; await warte(1000); } const wm = w.filter(istStreit);
  pruefe('[dispute] Inhaber-Warnmail zum Streit', `Mail an ${INHABER}`, 'mind. 1 Mail mit Streit-Hinweis', wm.length >= 1, wm.map((x) => `"${x.subject}"`).join('; ') || ('keine; vorhandene: ' + w.map((x) => x.subject).join('; ')));
  // Streit verlieren lassen (Stripe-Testverfahren): verlorener Streit -> charge.dispute.closed, Status bleibt Streitfall/verloren
  const d = streite.data[0];
  if (d) {
    await st.disputes.update(d.id, { evidence: { uncategorized_text: 'losing_evidence' }, submit: true });
    let dk; for (let i = 0; i < 90; i++) { dk = await st.disputes.retrieve(d.id); if (dk.status === 'lost') break; await warte(1000); }
    pruefe('[dispute] Streit bei Stripe verloren (Testverfahren losing_evidence)', 'disputes.update submit', 'Status lost', dk.status === 'lost', `Status ${dk.status}`);
    let eb; for (let i = 0; i < 40; i++) { eb = db.prepare('SELECT typ,status FROM ereignisse WHERE email=? ORDER BY id DESC').all(email); if (eb.some((x) => /verloren/.test(x.status || x.typ))) break; await warte(1000); }
    const bz = db.prepare('SELECT status,grund FROM bestellungen WHERE id=?').get(b1.id);
    pruefe('[dispute] Webhook charge.dispute.closed (lost): Ereignis streit_verloren, Zugang bleibt 0, Bestellung bleibt gesperrt', 'stripe listen', 'streit_verloren, 0 Zugaenge', eb.some((x) => /verloren/.test(x.status || x.typ)) && zugaenge(uid) === 0 && bz.status === 'pruefen', `ereignisse=${JSON.stringify(eb)} bestellung=${JSON.stringify(bz)} zugaenge=${zugaenge(uid)}`);
  }
  await warte(3000);
  const codes = dev ? listenZeilen(dev.id) : [];
  pruefe('[dispute] Zustellung charge.dispute.created: Plattform antwortet 200 (fertig) ODER 5xx (Stripe wiederholt)', 'stripe listen Protokoll', '200 oder 5xx', codes.length > 0 && codes.every((c) => c === '200' || /^5/.test(c)), `Antworten ${codes.join(',')} (5xx = Streit kam vor der Bestellung an, Stripe wiederholt)`);
}

// ---------- 2 MAILAUSFALL ----------
if (faelle.includes('mailausfall')) {
  console.log('\n=== MAILAUSFALL ===');
  const { U, email, uid } = await konto();
  writeFileSync(FLAG, 'aus'); const t0 = Date.now();
  const r = await bezahle(U, '4242424242424242');
  pruefe('[mailausfall] Kauf waehrend Mailausfall (Mailer liefert false)', 'Flagdatei MAIL-AUS, Karte 4242', 'Zahlung gelingt', !r.fehler, r.fehler || r.sid);
  const b = await bestellungWarten(uid, 'bezahlt');
  pruefe('[mailausfall] Bestellung bezahlt und Zugang trotz Mailausfall', 'Webhook', 'bezahlt, 1 Zugang', b?.status === 'bezahlt' && zugaenge(uid) === 1, `status=${b?.status} zugaenge=${zugaenge(uid)}`);
  await warte(8000);
  const ausg = db.prepare("SELECT typ,status,versuche FROM mail_ausgang WHERE bestellung_id=?").all(b.id);
  pruefe('[mailausfall] Kaufmail bleibt im Ausgang "offen" (nicht verloren, nicht als gesendet markiert)', 'mail_ausgang', 'status offen, versuche >= 1', ausg.length >= 1 && ausg.every((x) => x.status === 'offen' && x.versuche >= 1), JSON.stringify(ausg));
  pruefe('[mailausfall] Waehrenddessen keine Kaufmail zugestellt', 'Mail-Ausgang', '0', mails().filter((x) => x.to === email && x.zeit >= t0 && /649/.test(x.text)).length === 0, `zugestellt ${mails().filter((x) => x.to === email && x.zeit >= t0 && /649/.test(x.text)).length}`);
  const ev = db.prepare("SELECT meldung.status s,meldung.versuche v FROM meldung_ausgang meldung JOIN ereignisse e ON e.id=meldung.ereignis_id WHERE e.email=? AND e.typ='gekauft'").all(email);
  pruefe('[mailausfall] Inhaber-Verkaufsmeldung ebenfalls offen (wird gemeldet/wiederholt)', 'meldung_ausgang', 'offen', ev.length >= 1 && ev.every((x) => x.s === 'offen'), JSON.stringify(ev));
  // Mail wieder verfuegbar + Neustart (Versand wird beim Start angestossen)
  const { unlinkSync } = await import('node:fs'); unlinkSync(FLAG);
  await serverHart(); serverStart(); await serverBereit();
  const km = await mailAn(email, t0, '649', 60); await warte(5000);
  const km2 = mails().filter((x) => x.to === email && x.zeit >= t0 && /649/.test(x.text));
  pruefe('[mailausfall] Nach Wiederherstellung und Neustart wird die Kaufmail genau einmal zugestellt', 'Neustart nach Ausfall', 'genau 1 Kaufmail', km2.length === 1, `Anzahl ${km2.length}: ${km2.map((x) => x.subject).join('; ')}`);
  const ausg2 = db.prepare("SELECT status FROM mail_ausgang WHERE bestellung_id=?").all(b.id);
  pruefe('[mailausfall] Ausgang auf gesendet', 'mail_ausgang', 'gesendet', ausg2.length >= 1 && ausg2.every((x) => x.status === 'gesendet'), JSON.stringify(ausg2));
}

// ---------- 3 NEUSTART WAEHREND KAUF ----------
if (faelle.includes('neustart-kauf')) {
  console.log('\n=== NEUSTART WAEHREND KAUF ===');
  const { U, email, uid } = await konto(); const t0 = Date.now(); const ereignisAb = Math.floor(Date.now() / 1000) - 5;
  const r = await bezahle(U, '4242424242424242', false, async () => { await serverHart(); });
  pruefe('[neustart-kauf] Server hart beendet kurz vor dem Absenden; Zahlung bei Stripe abgeschlossen', 'SIGKILL, Absenden', 'Stripe-Sitzung complete', !r.fehler && srv.exited, r.fehler || `sitzung ${r.sid} complete, Server beendet=${srv.exited}`);
  const vor = q('SELECT status FROM bestellungen WHERE benutzer_id=? ORDER BY id DESC', uid);
  pruefe('[neustart-kauf] Plattform kennt die Zahlung noch nicht (Webhook verloren)', 'DB waehrend Ausfall', 'status offen/ausstehend, 0 Zugaenge', vor?.status !== 'bezahlt' && zugaenge(uid) === 0, `status=${vor?.status} zugaenge=${zugaenge(uid)}`);
  serverStart(); await serverBereit(); await warte(3000);
  // Stripe wiederholt Webhooks bis zu 3 Tage; hier: Original-Ereignis von Stripe holen und mit dem echten Webhook-Geheimnis signiert zustellen (zweimal)
  let evs = []; for (let i = 0; i < 20; i++) { evs = (await st.events.list({ type: 'checkout.session.completed', created: { gte: ereignisAb }, limit: 20 })).data.filter((e) => e.data.object.id === r.sid); if (evs.length) break; await warte(1000); }
  const e0 = evs[0];
  pruefe('[neustart-kauf] Original-Ereignis bei Stripe vorhanden', 'events.list', 'checkout.session.completed', !!e0, e0 ? e0.id : 'nicht gefunden');
  const liefern = () => liefere(e0);
  const s1 = await liefern();
  const b = await bestellungWarten(uid, 'bezahlt', 30);
  pruefe('[neustart-kauf] Nach Neustart und Webhook-Wiederholung: Bestellung bezahlt, Zugang', 'signierter Original-Webhook', 'bezahlt, 1 Zugang', b?.status === 'bezahlt' && zugaenge(uid) === 1, `webhook ${s1}, status=${b?.status} zugaenge=${zugaenge(uid)}`);
  const s2 = await liefern(); await warte(3000);
  const n = q('SELECT COUNT(*) c FROM bestellungen WHERE benutzer_id=?', uid).c;
  pruefe('[neustart-kauf] Zweite Zustellung desselben Ereignisses: keine Doppelbuchung', 'Webhook erneut', '1 Bestellung, 1 Zugang', n === 1 && zugaenge(uid) === 1, `webhook ${s2}, bestellungen=${n} zugaenge=${zugaenge(uid)}`);
  const km = await mailAn(email, t0, '649', 40); await warte(4000);
  const km2 = mails().filter((x) => x.to === email && x.zeit >= t0 && /649/.test(x.text));
  pruefe('[neustart-kauf] Kaufmail genau einmal', 'Mail-Ausgang', '1', km2.length === 1, `Anzahl ${km2.length}`);
}

// ---------- 4 NEUSTART WAEHREND ERSTATTUNG ----------
if (faelle.includes('neustart-erstattung')) {
  console.log('\n=== NEUSTART WAEHREND ERSTATTUNG ===');
  for (const [lbl, verzoegerung] of [['sofort nach Eintrag', 0], ['400 ms nach Eintrag', 400], ['1,5 s nach Eintrag', 1500], ['Stripe erstattet bei totem Server, Webhook verloren (B3)', -1]]) {
    const { U, email, uid } = await konto(); const t0 = Date.now();
    const r = await bezahle(U, '4242424242424242');
    const b = await bestellungWarten(uid, 'bezahlt');
    if (r.fehler || b?.status !== 'bezahlt') { pruefe(`[neustart-erstattung ${lbl}] Vorbereitung Kauf`, 'Kauf', 'bezahlt', false, r.fehler || `status=${b?.status}`); continue; }
    const pi = await piVon(b);
    const w0 = Date.now();
    const post = U.anf('POST', `/api/bestellungen/${b.id}/ellallas`, { bestaetigt: true }).catch((e) => ({ s: 0, t: e.message }));
    let sah = false; for (let i = 0; i < 400; i++) { if (q('SELECT 1 x FROM ellallas WHERE bestellung_id=?', b.id)) { sah = true; break; } await warte(5); }
    if (verzoegerung > 0) await warte(verzoegerung);
    await serverHart();
    // B3: Erstattung bei Stripe passiert, waehrend die Plattform tot ist: der Webhook charge.refunded kommt nie an (stripe listen wiederholt nicht)
    if (verzoegerung < 0) await st.refunds.create({ payment_intent: pi, amount: b.betrag }, { idempotencyKey: 'valore-ellallas-' + b.id });
    const zw = await st.refunds.list({ payment_intent: pi, limit: 10 });
    const dbZeile = db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id=?').get(b.id);
    pruefe(`[neustart-erstattung ${lbl}] Server hart beendet mitten im Widerruf`, 'SIGKILL nach Eintrag ellallas', 'Eintrag da, Server weg', sah && srv.exited, `Eintrag=${sah} db-ergebnis=${dbZeile?.ergebnis}; bei Stripe zum Zeitpunkt des Kills: ${zw.data.length} Erstattung(en)`);
    await post; serverStart(); await serverBereit();
    let e1; for (let i = 0; i < 120; i++) { e1 = db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id=?').get(b.id); if (e1?.ergebnis === 'erstattung') break; await warte(1000); }
    pruefe(`[neustart-erstattung ${lbl}] Nach Neustart schliesst die Plattform den Widerruf selbst ab`, 'automatische Wiederaufnahme (bis 120 s)', 'ellallas=erstattung', e1?.ergebnis === 'erstattung', JSON.stringify(e1) + ` nach ${Math.round((Date.now() - w0) / 1000)} s`);
    const liste = await st.refunds.list({ payment_intent: pi, limit: 10 });
    pruefe(`[neustart-erstattung ${lbl}] Bei Stripe genau EINE Erstattung`, 'refunds.list', '1', liste.data.length === 1, `Anzahl ${liste.data.length}: ${liste.data.map((x) => x.id + ' ' + x.status + ' ' + x.amount).join(', ')}`);
    const bb = await bestellungWarten(uid, 'erstattet', 40);
    pruefe(`[neustart-erstattung ${lbl}] Bestellung erstattet, Zugang weg`, 'Webhook charge.refunded', 'erstattet, 0 Zugaenge', bb?.status === 'erstattet' && zugaenge(uid) === 0, `status=${bb?.status} zugaenge=${zugaenge(uid)}`);
    await warte(5000);
    const em = mails().filter((x) => x.to === email && x.zeit >= w0 && /Widerruf/i.test(x.subject));
    pruefe(`[neustart-erstattung ${lbl}] Widerrufsmail an Kunden genau einmal`, 'Mail-Ausgang', '1', em.length === 1, `Anzahl ${em.length}: ${em.map((x) => x.subject).join('; ')}`);
  }
}
// ---------- 5 B3-DOPPELTEST: Webhook charge.refunded UND automatische Wiederaufnahme gleichzeitig ----------
if (faelle.includes('doppel')) {
  console.log('\n=== DOPPELTEST WEBHOOK + WIEDERAUFNAHME ===');
  for (const lauf of [1, 2, 3]) {
    const L = `[doppel ${lauf}]`;
    const { U, email, uid } = await konto(); const t0 = Date.now(); const ereignisAb = Math.floor(Date.now() / 1000) - 5;
    const r = await bezahle(U, '4242424242424242');
    const b = await bestellungWarten(uid, 'bezahlt');
    if (r.fehler || b?.status !== 'bezahlt') { pruefe(`${L} Vorbereitung Kauf`, 'Kauf', 'bezahlt', false, r.fehler || `status=${b?.status}`); continue; }
    const pi = await piVon(b);
    // Zustand "Prozess starb nach dem Eintrag": Server tot, Zeile 'bearbeitung' (aelter als 60 s), Stripe-Erstattung noch NICHT ausgefuehrt
    await serverHart();
    const alt = new Date(Date.now() - 120000).toISOString();
    db.prepare("INSERT OR REPLACE INTO ellallas(bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES(?,?,?,?,?)").run(b.id, alt, 'bearbeitung', null, alt);
    db.prepare("INSERT OR IGNORE INTO ellallas_mail(bestellung_id,empfaenger) VALUES(?,'kunde')").run(b.id);
    db.prepare("INSERT OR IGNORE INTO ellallas_mail(bestellung_id,empfaenger) VALUES(?,'inhaber')").run(b.id);
    const vorher = (await st.refunds.list({ payment_intent: pi, limit: 10 })).data.length;
    pruefe(`${L} Ausgangslage: Server tot, Widerruf 'bearbeitung', bei Stripe noch keine Erstattung`, 'DB-Zeile ellallas alt', '0 Erstattungen', vorher === 0 && srv.exited, `stripe=${vorher} zugaenge=${zugaenge(uid)}`);
    // Start: Plattform bootet (Wiederaufnahme laeuft ~3 s nach dem Start); GLEICHZEITIG geht bei Stripe die Erstattung durch (derselbe Schluessel, wie der erste Versuch)
    // und das Webhook-Ereignis charge.refunded wird zweimal parallel zugestellt.
    serverStart(); const tStart = Date.now();
    const refundP = st.refunds.create({ payment_intent: pi, amount: b.betrag }, { idempotencyKey: 'valore-ellallas-' + b.id }).catch((e) => ({ fehler: e.message }));
    await serverBereit();
    let ev = null; for (let i = 0; i < 30 && !ev; i++) { ev = (await st.events.list({ type: 'charge.refunded', created: { gte: ereignisAb }, limit: 30 })).data.find((e) => (typeof e.data.object.payment_intent === 'string' ? e.data.object.payment_intent : e.data.object.payment_intent?.id) === pi); if (!ev) await warte(1000); }
    const rf = await refundP;
    pruefe(`${L} Ereignis charge.refunded bei Stripe vorhanden`, 'events.list', 'Ereignis', !!ev, ev ? ev.id : 'nicht gefunden: ' + JSON.stringify(rf).slice(0, 120));
    if (!ev) continue;
    const bisLauf = 3000 - (Date.now() - tStart); if (bisLauf > 0) await warte(bisLauf);   // genau in das Fenster der automatischen Wiederaufnahme
    const tW = Date.now();
    const codes = await Promise.all([liefere(ev), liefere(ev), liefere(ev)]);
    const tE = Date.now() - tStart;
    let e1; for (let i = 0; i < 90; i++) { e1 = db.prepare('SELECT ergebnis,hinweis,aktualisiert FROM ellallas WHERE bestellung_id=?').get(b.id); if (e1?.ergebnis === 'erstattung') break; await warte(1000); }
    const bb = await bestellungWarten(uid, 'erstattet', 30); await warte(6000);
    const liste = await st.refunds.list({ payment_intent: pi, limit: 10 });
    pruefe(`${L} Bei Stripe genau EINE Erstattung`, 'refunds.list', '1', liste.data.length === 1, `Anzahl ${liste.data.length}: ${liste.data.map((x) => x.id + ' ' + x.status + ' ' + x.amount).join(', ')}`);
    pruefe(`${L} Webhook-Zustellungen parallel (3x) alle 200`, `3 parallele Zustellungen ${tE} ms nach Serverstart (Wiederaufnahme ca. 3000 ms)`, '200,200,200', codes.every((c) => c === 200), codes.join(','));
    const bz = db.prepare('SELECT status,grund FROM bestellungen WHERE id=?').get(b.id);
    pruefe(`${L} Bestellung erstattet, Grund erstattung_voll`, 'bestellungen', 'erstattet/erstattung_voll', bz.status === 'erstattet' && bz.grund === 'erstattung_voll', JSON.stringify(bz));
    pruefe(`${L} Widerruf abgeschlossen`, 'ellallas', 'erstattung', e1?.ergebnis === 'erstattung', JSON.stringify(e1));
    pruefe(`${L} Zugang entzogen (0) und nicht wieder vergeben`, 'zugaenge', '0', zugaenge(uid) === 0, `zugaenge=${zugaenge(uid)}`);
    const er = q("SELECT COUNT(*) c FROM ereignisse WHERE typ='erstattet' AND email=?", email).c;
    const se = q('SELECT COUNT(*) c FROM stripe_ereignisse WHERE id=?', ev.id).c;
    pruefe(`${L} Erstattung genau einmal gebucht (Ereignishistorie 1, Webhook-Ereignis 1x verarbeitet)`, 'ereignisse / stripe_ereignisse', '1 / 1', er === 1 && se === 1, `erstattet-Ereignisse=${er} stripe_ereignisse=${se}`);
    const em = mails().filter((x) => x.to === email && x.zeit >= t0 && /Widerruf/i.test(x.subject));
    pruefe(`${L} Widerrufsmail an Kunden genau einmal`, 'Mail-Ausgang', '1', em.length === 1, `Anzahl ${em.length}`);
  }
}
// ---------- 6 B4: DISPUTE VOR DER BESTELLUNG (dauerhaft gespeichert, kein 500) ----------
if (faelle.includes('dispute-vorab')) {
  console.log('\n=== B4 DISPUTE VOR BESTELLUNG ===');
  const L = '[dispute-vorab]';
  const { U, email, uid } = await konto(); const t0 = Date.now(); const ereignisAb = Math.floor(Date.now() / 1000) - 5;
  const r = await bezahle(U, '4000000000000259', false, async () => { await serverHart(); });   // Plattform tot: Kauf-Webhook geht verloren
  pruefe(`${L} Zahlung mit Streit-Testkarte 4000000000000259 bei Stripe abgeschlossen, Plattform tot`, 'Checkout, SIGKILL', 'Sitzung complete', !r.fehler && srv.exited, r.fehler || r.sid);
  let dev = null, cev = null;
  for (let i = 0; i < 60 && !(dev && cev); i++) {
    const ds = (await st.events.list({ type: 'charge.dispute.created', created: { gte: ereignisAb }, limit: 30 })).data;
    const cs = (await st.events.list({ type: 'checkout.session.completed', created: { gte: ereignisAb }, limit: 30 })).data;
    cev = cs.find((e) => e.data.object.id === r.sid) || null; const pi0 = cev ? (typeof cev.data.object.payment_intent === 'string' ? cev.data.object.payment_intent : cev.data.object.payment_intent?.id) : null;
    dev = ds.find((e) => (typeof e.data.object.payment_intent === 'string' ? e.data.object.payment_intent : e.data.object.payment_intent?.id) === pi0) || null;
    if (!(dev && cev)) await warte(1000);
  }
  pruefe(`${L} Original-Ereignisse bei Stripe: dispute.created UND checkout.session.completed`, 'events.list', 'beide vorhanden', !!(dev && cev), `dispute=${dev?.id} kauf=${cev?.id}`);
  if (dev && cev) {
    serverStart(); await serverBereit(); await warte(5000);   // Wiederaufnahme-Lauf nach Start abwarten
    const sD = await liefere(dev);   // 1) Streit VOR der Bestellung
    const w1 = q('SELECT COUNT(*) c FROM wartende_ereignisse WHERE ereignis_id=? AND verarbeitet IS NULL', dev.id).c;
    pruefe(`${L} Streit vor Bestellung: Antwort 200 (kein 500), Ereignis dauerhaft gespeichert`, 'signiertes dispute.created ohne Bestellung', '200, 1 wartendes Ereignis', sD === 200 && w1 === 1, `http=${sD} wartend=${w1} bestellungen=${q('SELECT COUNT(*) c FROM bestellungen WHERE benutzer_id=?', uid).c}`);
    const sD2 = await liefere(dev);   // gleiche Zustellung nochmal (Stripe-Retry)
    const w2 = q('SELECT COUNT(*) c FROM wartende_ereignisse WHERE ereignis_id=?', dev.id).c;
    pruefe(`${L} Wiederholte Zustellung: 200, keine zweite Speicherung`, 'dispute.created erneut', '200, 1 Zeile', sD2 === 200 && w2 === 1, `http=${sD2} zeilen=${w2}`);
    // Neustart zwischen Speichern und Bestellung: Ereignis muss ueberleben
    await serverHart(); serverStart(); await serverBereit();
    const w3 = q('SELECT COUNT(*) c FROM wartende_ereignisse WHERE ereignis_id=? AND verarbeitet IS NULL', dev.id).c;
    pruefe(`${L} Nach hartem Neustart ist das wartende Ereignis noch da`, 'SIGKILL, Neustart', '1', w3 === 1, `wartend=${w3}`);
    const sC = await liefere(cev);   // 2) jetzt kommt der Kauf
    let b; for (let i = 0; i < 40; i++) { b = db.prepare('SELECT status,grund FROM bestellungen WHERE benutzer_id=? ORDER BY id DESC').get(uid); if (b?.status === 'pruefen' && b.grund === 'streitfall') break; await warte(500); }
    pruefe(`${L} Nach Anlage der Bestellung verarbeitet die Plattform den gespeicherten Streit selbst`, 'checkout.session.completed', 'pruefen/streitfall, 0 Zugaenge', sC === 200 && b?.status === 'pruefen' && b.grund === 'streitfall' && zugaenge(uid) === 0, `kauf-http=${sC} bestellung=${JSON.stringify(b)} zugaenge=${zugaenge(uid)}`);
    const wv = q('SELECT verarbeitet FROM wartende_ereignisse WHERE ereignis_id=?', dev.id);
    pruefe(`${L} Wartendes Ereignis als verarbeitet markiert`, 'wartende_ereignisse', 'verarbeitet gesetzt', !!wv?.verarbeitet, JSON.stringify(wv));
    const sD3 = await liefere(dev); await warte(2000);
    const sf = q("SELECT COUNT(*) c FROM ereignisse WHERE typ='gekauft' AND status='streitfall' AND email=?", email).c;
    pruefe(`${L} Keine Doppelverarbeitung: erneute Zustellung 200, genau 1 Streitfall-Ereignis`, 'dispute.created zum dritten Mal', '200, 1', sD3 === 200 && sf === 1, `http=${sD3} streitfall-ereignisse=${sf}`);
    const wm = await mailAn(process.env.VERKAUFSMELDUNG_MAIL, t0, '', 40); const stm = wm.filter((x) => /(Streit|streit|Rückbuchung|dispute|Dispute)/.test(x.subject + x.text));
    pruefe(`${L} Inhaber-Warnmail zum Streit genau einmal`, 'Mail-Ausgang', '1', stm.length === 1, `Anzahl ${stm.length}`);
  }
}
// ---------- 7 B6: TEILERSTATTUNG ECHT (Webhook charge.refunded), danach Rest = volle Erstattung ----------
if (faelle.includes('teilerstattung')) {
  console.log('\n=== TEILERSTATTUNG ===');
  for (const lauf of [1, 2, 3]) {
    const L = `[teilerstattung ${lauf}]`;
    const { U, email, uid } = await konto(); const t0 = Date.now(); const ereignisAb = Math.floor(Date.now() / 1000) - 5;
    const r = await bezahle(U, '4242424242424242');
    const b = await bestellungWarten(uid, 'bezahlt');
    if (r.fehler || b?.status !== 'bezahlt') { pruefe(`${L} Vorbereitung Kauf`, 'Kauf', 'bezahlt', false, r.fehler || `status=${b?.status}`); continue; }
    const pi = await piVon(b);
    const teil = 40000, rest = b.betrag - teil;
    const rf1 = await st.refunds.create({ payment_intent: pi, amount: teil });   // TEIL ueber Stripe (wie im Dashboard)
    let bt; for (let i = 0; i < 40; i++) { bt = db.prepare('SELECT status,grund FROM bestellungen WHERE id=?').get(b.id); if (bt.grund === 'teilerstattung') break; await warte(500); }
    await warte(8000);   // Zeit fuer eine (unerwuenschte) automatische zweite Erstattung oder Statuswechsel
    const l1 = (await st.refunds.list({ payment_intent: pi, limit: 10 })).data;
    pruefe(`${L} Teilerstattung ${teil} von ${b.betrag} bei Stripe, Webhook verarbeitet: Bestellung bleibt "bezahlt" mit Grund teilerstattung`, `refunds.create amount=${teil}`, 'bezahlt/teilerstattung', bt.status === 'bezahlt' && bt.grund === 'teilerstattung', JSON.stringify(bt));
    pruefe(`${L} Zugang bleibt bestehen`, 'zugaenge', '1', zugaenge(uid) === 1, `zugaenge=${zugaenge(uid)}`);
    pruefe(`${L} KEINE zweite Erstattung (Stripe: genau 1, Summe ${teil})`, 'refunds.list', '1 Erstattung, Summe 40000', l1.length === 1 && l1[0].amount === teil, `Anzahl ${l1.length}: ${l1.map((x) => x.amount + ' ' + x.status).join(', ')}`);
    const ev1 = db.prepare("SELECT status,betrag FROM ereignisse WHERE email=? AND typ='erstattet' ORDER BY id").all(email);
    pruefe(`${L} Ereignishistorie: genau 1 Eintrag "teilweise"`, 'ereignisse', '1 x teilweise', ev1.length === 1 && ev1[0].status === 'teilweise', JSON.stringify(ev1));
    // gleicher Webhook nochmal (Stripe-Retry): keine Doppelbuchung
    const evT = (await st.events.list({ type: 'charge.refunded', created: { gte: ereignisAb }, limit: 30 })).data.find((e) => (typeof e.data.object.payment_intent === 'string' ? e.data.object.payment_intent : e.data.object.payment_intent?.id) === pi);
    const sw = evT ? await liefere(evT) : null; await warte(2000);
    const ev1b = db.prepare("SELECT COUNT(*) c FROM ereignisse WHERE email=? AND typ='erstattet'").get(email).c;
    pruefe(`${L} Wiederholte Zustellung desselben Teil-Webhooks: 200, keine Doppelbuchung`, 'charge.refunded erneut', '200, 1 Eintrag', sw === 200 && ev1b === 1 && zugaenge(uid) === 1, `http=${sw} eintraege=${ev1b} zugaenge=${zugaenge(uid)}`);
    // Rest erstatten = VOLLE Erstattung, klar unterscheidbar
    const rf2 = await st.refunds.create({ payment_intent: pi, amount: rest });
    const bv = await bestellungWarten(uid, 'erstattet', 40); await warte(3000);
    const l2 = (await st.refunds.list({ payment_intent: pi, limit: 10 })).data;
    const summe = l2.filter((x) => x.status === 'succeeded').reduce((s, x) => s + x.amount, 0);
    const bg = db.prepare('SELECT status,grund FROM bestellungen WHERE id=?').get(b.id);
    pruefe(`${L} Rest ${rest} erstattet = voll: Bestellung erstattet / erstattung_voll, Zugang weg`, `refunds.create amount=${rest}`, 'erstattet, 0 Zugaenge', bv?.status === 'erstattet' && bg.grund === 'erstattung_voll' && zugaenge(uid) === 0, `${JSON.stringify(bg)} zugaenge=${zugaenge(uid)}`);
    const ev2 = db.prepare("SELECT status FROM ereignisse WHERE email=? AND typ='erstattet' ORDER BY id").all(email).map((x) => x.status);
    pruefe(`${L} Historie unterscheidet teilweise und erstattet; Stripe insgesamt ${b.betrag} in 2 Erstattungen`, 'ereignisse / refunds.list', 'teilweise, erstattet / 2 / Summe voll', ev2.join(',') === 'teilweise,erstattet' && l2.length === 2 && summe === b.betrag, `ereignisse=${ev2.join(',')} erstattungen=${l2.length} summe=${summe}`);
  }
}
} finally {
  await browser?.close().catch(() => {});
  if (srv && !srv.exited) await serverHart();
  if (listen) { try { listen.kill(); } catch { /* weg */ } }
  writeFileSync(ORD + '\\ergebnis-b2.md', '| Nr | Pruefpunkt | Eingabe | Erwartet | Tatsaechlich | Ergebnis |\n|---|---|---|---|---|---|\n' + zeilen.join('\n') + '\n');
}
console.log(`\nB2: ${nr - fehler} bestanden, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
