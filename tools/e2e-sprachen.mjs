// E2E je Sprache im Stripe-TESTMODUS: Registrierung, Mailbestaetigung, Checkout (Testkarte 4242), Webhook, Zugang, Beleg, Sprachwechsel, Widerruf/Erstattung.
// Start ueber tools\E2E-Sprachen-Start.ps1 (startet Plattform, stripe listen). Ergebnis: Konsole und $E2E_ORDNER\ergebnis.md (Tabelle fuer PROTOKOLL.md).
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL('C:/Users/diaco/Projekte/browser-werkzeug/node_modules/playwright-core/index.mjs').href);

const BASE = 'http://localhost:4461', ORD = process.env.E2E_ORDNER;
const sprachen = process.argv.slice(2).length ? process.argv.slice(2) : ['de', 'en'];
const db = new DatabaseSync(ORD + '\\e2e.db');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = []; let nr = 0, fehler = 0;
const STOP = {
  de: /\b(der|die|das|und|Sie|ihre|Ihre|Ihr|nicht|wurde|für|bitte|Bestellung|Kurs)\b/g,
  en: /\b(the|and|your|you|not|was|for|please|order|course|has|have)\b/g,
  hu: /\b(és|az|hogy|nem|egy|vagy|kurzus|rendelés|köszönjük|szia)\b/gi,
};
const sprachVon = (t) => {
  const z = Object.fromEntries(Object.entries(STOP).map(([l, re]) => [l, (t.match(re) || []).length]));
  const top = Object.entries(z).sort((a, b) => b[1] - a[1]);
  return { l: top[0][1] > 0 ? top[0][0] : '?', z };
};
function pruefe(name, eingabe, erwartet, ok, ist) {
  nr++; if (!ok) fehler++;
  const z = `| ${nr} | ${name} | ${eingabe} | ${erwartet} | ${String(ist).replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 220)} | ${ok ? 'bestanden' : 'FEHLER'} |`;
  zeilen.push(z); console.log(z);
}
function client(l) {
  let cookie = 'lang=' + l;
  return {
    async anf(m, p, body) {
      const r = await fetch(BASE + p, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie, 'Accept-Language': l }, body: body ? JSON.stringify(body) : undefined });
      for (const c of r.headers.getSetCookie?.() ?? []) {
        const [kv] = c.split(';'); const [k] = kv.split('=');
        cookie = cookie.split('; ').filter((x) => !x.startsWith(k + '=')).concat(kv).join('; ');
      }
      let d = null, t = ''; try { t = await r.text(); d = JSON.parse(t); } catch { /* kein JSON */ }
      return { s: r.status, d, h: r.headers, t };
    },
  };
}
const mails = () => (existsSync(process.env.MAIL_DUMP) ? readFileSync(process.env.MAIL_DUMP, 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x)) : []);
async function mailAn(adr, ab, teil) {
  for (let i = 0; i < 40; i++) {
    const m = mails().filter((x) => x.to === adr && x.zeit >= ab && (!teil || (x.subject + x.text).includes(teil)));
    if (m.length) return m;
    await warte(1000);
  }
  return [];
}

await warte(500);
const jetzt = new Date().toISOString();
db.prepare('INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES (?,?,?,?,?,?,?)').run('E2E Musterkurs', 'Testkurs fuer die E2E-Pruefung', 64900, 'eur', 'veroeffentlicht', jetzt, jetzt);
const kursId = db.prepare('SELECT id FROM kurse ORDER BY id DESC LIMIT 1').get().id;
db.prepare('INSERT INTO lektionen (kurs_id,abschnitt,titel,art,inhalt,reihenfolge,status,erstellt,geaendert) VALUES (?,?,?,?,?,?,?,?,?)').run(kursId, 'A', 'Lektion 1', 'text', 'Inhalt', 1, 'veroeffentlicht', jetzt, jetzt);
// Stripe-Idempotenzschluessel (valore-ellallas-<id>) gelten 24 h im Konto: frische Test-DB darf keine schon benutzte Bestell-ID wiederverwenden.
db.exec("DELETE FROM sqlite_sequence WHERE name='bestellungen'");
db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES('bestellungen',?)").run(Math.floor(Date.now() / 1000) % 100000000);
const browser = await chromium.launch();

for (const L0 of sprachen) {
  const P0 = L0 === 'p0'; const L = P0 ? 'de' : L0;
  const U = client(L), email = `e2e.${L}.${Date.now()}@example.com`, pw = 'Muster-E2E-2026!x';
  const t0 = Date.now(); const andere = ['en', 'de', 'hu'].filter((x) => x !== L);
  console.log(`\n=== ${L.toUpperCase()} ===`);
  // 1 Registrierung
  const reg = await U.anf('POST', '/api/registrieren', { email, passwort: pw, zustimmung: true });
  pruefe(`[${L}] Registrierung`, `POST /api/registrieren, Cookie lang=${L}`, 'Erfolg, Meldung ohne Fremdsprache', reg.s < 300, `Status ${reg.s} ${reg.t.slice(0, 120)}`);
  const bm = await mailAn(email, t0, '');
  const m1 = bm[0];
  pruefe(`[${L}] Bestaetigungsmail in Sprache`, 'Mail-Ausgang', `Sprache ${L}`, !!m1 && sprachVon(m1.subject + ' ' + m1.text).l === L, m1 ? `Betreff "${m1.subject}", erkannt ${JSON.stringify(sprachVon(m1.subject + ' ' + m1.text))}` : 'keine Mail');
  const tok = (m1?.text.match(/token=([A-Za-z0-9_-]{20,})/) || m1?.text.match(/([A-Za-z0-9_-]{43})/) || [])[1];
  const bs = tok ? await U.anf('POST', '/api/email-bestaetigen', { token: tok }) : { s: 0 };
  pruefe(`[${L}] E-Mail bestaetigen`, 'Token aus Mail', '200', bs.s === 200, `Status ${bs.s} ${(bs.t || '').slice(0, 100)}`);
  const li = await U.anf('POST', '/api/anmelden', { email, passwort: pw });
  const uid = db.prepare('SELECT id,sprache FROM benutzer WHERE email=?').get(email);
  pruefe(`[${L}] Login, Konto vorhanden`, 'POST /api/anmelden', '200', li.s === 200, `Status ${li.s}, sprache=${uid?.sprache}`);
  const sw0 = await U.anf('POST', '/api/sprache', { sprache: L });
  pruefe(`[${L}] Konto-Sprache gespeichert`, 'POST /api/sprache', `benutzer.sprache=${L}`, sw0.s === 200 && db.prepare('SELECT sprache FROM benutzer WHERE id=?').get(uid.id).sprache === L, `Status ${sw0.s}`);
  // 2 Checkout
  const ks = await U.anf('POST', `/api/kurse/${kursId}/kaufen`, { zustimmung: true });
  const url = ks.d?.url;
  pruefe(`[${L}] Checkout-Sitzung`, 'POST /api/kurse/:id/kaufen', 'Stripe-URL', ks.s === 200 && /checkout\.stripe\.com/.test(url || ''), `Status ${ks.s} ${(ks.t || '').slice(0, 100)}`);
  if (!url) continue;
  const seite = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
  const navs = []; seite.on('framenavigated', (fr) => { if (fr === seite.mainFrame()) navs.push(fr.url()); });
  await seite.goto(url, { waitUntil: 'domcontentloaded' }); await seite.waitForTimeout(5000);
  const htmlLang = await seite.evaluate(() => document.documentElement.lang);
  const kopf = (await seite.evaluate(() => document.body.innerText)).slice(0, 4000);
  const wortEr = { de: /Bezahlen|Zahlung|Karte/, en: /Pay|Card/, hu: /Fizet|Kártya/ }[L];
  pruefe(`[${L}] Stripe-Checkout-Sprache`, 'Seite geoeffnet', `lang=${L}, Text in ${L}`, htmlLang.startsWith(L) && wortEr.test(kopf), `html lang=${htmlLang}; ${kopf.slice(0, 120)}`);
  await seite.screenshot({ path: `${ORD}\\checkout-${L}.png` });
  const f = async (sel, wert) => { const el = seite.locator(sel).first(); await el.waitFor({ timeout: 15000 }); await el.fill(wert); };
  try {
    { const sel = ['[data-testid="card-accordion-item-button"]', 'input[type=radio][value=card]', 'label:has-text("Karte"), label:has-text("Card")', 'text=/^(Karte|Card|Kártya)$/'];
      for (const q of sel) { const el = seite.locator(q).first(); if (await el.count()) { await el.click({ timeout: 8000, force: true }).catch(() => {}); await seite.waitForTimeout(1500); if (await seite.locator('#cardNumber').count()) break; } } }
    await f('#cardNumber', '4242424242424242'); await f('#cardExpiry', '1233'); await f('#cardCvc', '123'); await f('#billingName', 'Max Mustermann');
    const land = seite.locator('#billingCountry'); if (await land.count()) await land.selectOption('DE').catch(() => {});
    for (const [sel, w] of [['#billingAddressLine1', 'Beispielstrasse 1'], ['#billingLocality', 'Musterstadt']]) { const el = seite.locator(sel).first(); if (await el.count()) await el.fill(w).catch(() => {}); }
    const plz = seite.locator('#billingPostalCode'); if (await plz.count()) await plz.fill('12345').catch(() => {});
    await seite.locator('button.SubmitButton, button[type=submit]').first().click();
    await seite.waitForURL(/localhost:4461/, { timeout: 60000 });
  } catch (e) {
    pruefe(`[${L}] Zahlung mit Testkarte 4242`, 'Kartenformular', 'Rueckkehr zur Plattform', false, e.message.split('\n')[0]);
    await seite.screenshot({ path: `${ORD}\\fehler-${L}.png` }); await seite.close(); continue;
  }
  pruefe(`[${L}] Rueckkehr nach Zahlung`, 'Testkarte 4242', 'success_url', navs.some((u) => /kauf=erfolg/.test(u)), navs.filter((u) => u.includes('localhost')).join(' > '));
  await seite.close();
  // 3 Webhook / Zugang
  let best; for (let i = 0; i < 40; i++) { best = db.prepare('SELECT * FROM bestellungen WHERE benutzer_id=? ORDER BY id DESC').get(uid.id); if (best?.status === 'bezahlt') break; await warte(1000); }
  pruefe(`[${L}] Webhook: Bestellung bezahlt, Sprache gespeichert`, 'stripe listen', `bezahlt, sprache=${L}`, best?.status === 'bezahlt' && best?.sprache === L, `status=${best?.status} betrag=${best?.betrag} sprache=${best?.sprache}`);
  const zug = db.prepare('SELECT COUNT(*) c FROM zugaenge WHERE benutzer_id=? AND kurs_id=?').get(uid.id, kursId).c;
  pruefe(`[${L}] Zugang freigeschaltet`, 'zugaenge', '1 Zeile', zug === 1, `zugaenge=${zug}`);
  const km = (await mailAn(email, t0 + 1, '649')).filter((x) => x.subject !== m1?.subject);
  const kmail = km[0];
  pruefe(`[${L}] Kaufmail in Sprache, EUR`, 'Mail-Ausgang', `Sprache ${L}, 649,00 EUR`, !!kmail && sprachVon(kmail.subject + ' ' + kmail.text).l === L && /EUR|€/.test(kmail.text), kmail ? `Betreff "${kmail.subject}" ${JSON.stringify(sprachVon(kmail.subject + ' ' + kmail.text))}` : 'keine Kaufmail');
  // 4 Sprachwechsel nach Kauf
  const anderes = andere[0];
  const sw = await U.anf('POST', '/api/sprache', { sprache: anderes }); const mk = await U.anf('GET', '/api/meine-kurse'); const tx = await U.anf('GET', '/api/texte');
  pruefe(`[${L}] Sprachwechsel nach Kauf (-> ${anderes}) ohne Datenverlust`, 'POST /api/sprache', 'Kurs bleibt, Texte wechseln, Bestellsprache bleibt', sw.s === 200 && JSON.stringify(mk.d).includes('E2E Musterkurs') && tx.d?._sprache === anderes && db.prepare('SELECT sprache FROM bestellungen WHERE id=?').get(best.id).sprache === L, `meine-kurse ${mk.s}, texte ${tx.d?._sprache}`);
  await U.anf('POST', '/api/sprache', { sprache: L });
  // 5 Beleg
  const be = await U.anf('GET', `/api/bestellungen/${best.id}/beleg`);
  const loc = be.h.get('location') || '';
  pruefe(`[${L}] Beleg (Stripe-Quittung)`, `GET /api/bestellungen/${best.id}/beleg`, '302 auf Stripe', be.s === 302 && /stripe\.com/.test(loc), `Status ${be.s} ${loc.slice(0, 60)}...`);
  if (/stripe\.com/.test(loc)) {
    try {
      const ctx = await browser.newContext({ locale: L }); const qs = await ctx.newPage();
      await qs.goto(loc.replace(/\/pdf.*$/, ''), { waitUntil: 'domcontentloaded' }); await qs.waitForTimeout(3000);
      const lg = await qs.evaluate(() => document.documentElement.lang); const qtxt = (await qs.evaluate(() => document.body.innerText)).slice(0, 80); await qs.screenshot({ path: `${ORD}\quittung-${L}.png` }); await ctx.close();
      pruefe(`[${L}] Stripe-Quittung Sprache (Browser-Locale ${L}; Customer.preferred_locales=[${L}] gesetzt)`, 'Quittungsseite', `Sprache ${L}`, ({ de: /Zahlungsbeleg|Beleg/, en: /Receipt/, hu: /Nyugta/ })[L].test(qtxt), `Seitentext ${L}; (html lang-Attribut=${lg}, von Stripe nicht lokalisiert); ${qtxt}`);
    } catch (e) { pruefe(`[${L}] Stripe-Quittung Sprache`, 'Quittungsseite', L, false, e.message); }
  }
  if (P0) {
    // P0 Zahlungshaertung gegen ECHTES Stripe (Testmodus): Absturz NACH dem Stripe-Aufruf, VOR dem Eintrag in der Datenbank.
    const Stripe = (await import('stripe')).default; const st = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-07-30.basil' });
    const bz = db.prepare('SELECT zahlung_id,stripe_sitzung,betrag FROM bestellungen WHERE id=?').get(best.id);
    let pi = bz.zahlung_id; if (!pi) { const cs = await st.checkout.sessions.retrieve(bz.stripe_sitzung); pi = typeof cs.payment_intent === 'string' ? cs.payment_intent : cs.payment_intent?.id; }
    const alt = new Date(Date.now() - 180000).toISOString();
    // Zustand wie nach Absturz: Widerruf als bearbeitung eingetragen (Mails vorgemerkt), Stripe hat die Erstattung SCHON ausgefuehrt, DB nicht nachgezogen
    db.prepare("INSERT INTO ellallas(bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES(?,?,'bearbeitung',NULL,?)").run(best.id, alt, alt);
    db.prepare("INSERT OR IGNORE INTO ellallas_mail(bestellung_id,empfaenger) VALUES(?,'kunde')").run(best.id); db.prepare("INSERT OR IGNORE INTO ellallas_mail(bestellung_id,empfaenger) VALUES(?,'inhaber')").run(best.id);
    const r0 = await st.refunds.create({ payment_intent: pi, amount: bz.betrag }, { idempotencyKey: 'valore-ellallas-' + best.id });
    pruefe(`[p0] Absturz-Zustand hergestellt: Stripe-Erstattung existiert, DB steht auf bearbeitung`, 'refunds.create + ellallas bearbeitung', 're_...', !!r0.id && db.prepare('SELECT ergebnis FROM ellallas WHERE bestellung_id=?').get(best.id).ergebnis === 'bearbeitung', `refund ${r0.id} ${r0.status}`);
    let e1; for (let i = 0; i < 100; i++) { e1 = db.prepare('SELECT ergebnis,hinweis FROM ellallas WHERE bestellung_id=?').get(best.id); if (e1.ergebnis === 'erstattung') break; await warte(1000); }
    pruefe(`[p0] Automatische Wiederaufnahme ohne Eingriff (Lauf jede Minute)`, 'Wartezeit bis 100 s', 'ellallas=erstattung', e1.ergebnis === 'erstattung', `${JSON.stringify(e1)}`);
    const liste = await st.refunds.list({ payment_intent: pi, limit: 10 });
    pruefe(`[p0] Bei Stripe genau EINE Erstattung fuer die Zahlung`, 'refunds.list', '1', liste.data.length === 1 && liste.data[0].id === r0.id, `Anzahl ${liste.data.length}`);
    let b3; for (let i = 0; i < 40; i++) { b3 = db.prepare('SELECT status,grund FROM bestellungen WHERE id=?').get(best.id); if (b3.status === 'erstattet') break; await warte(1000); }
    const z3 = db.prepare('SELECT COUNT(*) c FROM zugaenge WHERE benutzer_id=? AND kurs_id=?').get(uid.id, kursId).c;
    pruefe(`[p0] Webhook charge.refunded: Bestellung erstattet, Zugang weg`, 'stripe listen', 'erstattet, 0 Zugaenge', b3?.status === 'erstattet' && z3 === 0, `status=${b3?.status} zugaenge=${z3}`);
    await warte(4000);
    const em0 = mails().filter((x) => x.to === email && /Widerruf/.test(x.subject));
    pruefe(`[p0] Kundenmail zum Widerruf genau einmal`, 'Mail-Ausgang', '1', em0.length === 1, `Anzahl ${em0.length}: ${em0.map((x) => x.subject).join('; ')}`);
    continue;
  }
  // 6 Widerruf / Erstattung
  const w0 = Date.now();
  const wr = await U.anf('POST', `/api/bestellungen/${best.id}/ellallas`, { bestaetigt: true });
  pruefe(`[${L}] Widerruf ausloesen`, 'POST .../ellallas', '200', wr.s === 200, `Status ${wr.s} ${(wr.t || '').slice(0, 140)}`);
  let b2; for (let i = 0; i < 45; i++) { b2 = db.prepare('SELECT status,grund FROM bestellungen WHERE id=?').get(best.id); if (b2.status === 'erstattet') break; await warte(1000); }
  const zug2 = db.prepare('SELECT COUNT(*) c FROM zugaenge WHERE benutzer_id=? AND kurs_id=?').get(uid.id, kursId).c;
  pruefe(`[${L}] Erstattung per Webhook, Zugang weg`, 'charge.refunded', 'erstattet, 0 Zugaenge', b2?.status === 'erstattet' && zug2 === 0, `status=${b2?.status} grund=${b2?.grund} zugaenge=${zug2}`);
  await warte(4000);
  const em = mails().filter((x) => x.to === email && x.zeit >= w0);
  pruefe(`[${L}] Widerrufs-/Erstattungsmail in Sprache`, 'Mail-Ausgang', `mind. 1 Mail, Sprache ${L}`, em.length > 0 && em.every((x) => sprachVon(x.subject + ' ' + x.text).l === L), em.map((x) => `"${x.subject}" ${sprachVon(x.subject + ' ' + x.text).l}`).join('; ') || 'keine Mail');
  const alle = mails().filter((x) => x.to === email);
  pruefe(`[${L}] Keine gemischten Texte in allen Mails`, `${alle.length} Mails`, `alle ${L}`, alle.length > 0 && alle.every((x) => sprachVon(x.subject + ' ' + x.text).l === L), alle.map((x) => sprachVon(x.subject + ' ' + x.text).l).join(','));
}
await browser.close();
writeFileSync(ORD + '\\ergebnis.md', '| Nr | Pruefpunkt | Eingabe | Erwartet | Tatsaechlich | Ergebnis |\n|---|---|---|---|---|---|\n' + zeilen.join('\n') + '\n');
console.log(`\nE2E: ${nr - fehler} bestanden, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
