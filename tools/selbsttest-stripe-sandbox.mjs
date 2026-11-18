// Prüft die Kauf-Route gegen die ECHTE Stripe-Sandbox (nur Testmodus). Läuft NUR, wenn STRIPE_SECRET_KEY (sk_test_...) gesetzt ist,
// sonst: "übersprungen" und Erfolg. Es wird KEINE Zahlung ausgeführt. Ablauf: Test-Datenbank, veröffentlichter Kurs, echte
// Kauf-Route, Checkout-Sitzung bei Stripe abrufen und Betrag, Währung, metadata, Kunde und Adresse prüfen.
// Nebenwirkung in der Sandbox: je Lauf 1 Test-Kunde (E-Mail selbsttest.sandbox.<Zeit>@example.com) und 2 offene Checkout-Sitzungen
// (laufen von selbst ab). Es wird nichts gelöscht. Aufruf: tools\Selbsttest-Stripe-Sandbox.ps1 (lädt vorher den Testzugang).
import './test-sprache.mjs';
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Stripe from 'stripe';

const schluessel = process.env.STRIPE_SECRET_KEY || '';
if (!schluessel) { console.log('übersprungen: STRIPE_SECRET_KEY ist nicht gesetzt (der Test läuft nur mit dem Testzugang der Sandbox).'); process.exit(0); }
if (!schluessel.startsWith('sk_test_')) { console.error('Abbruch: Es wird nur ein Stripe-TESTschlüssel (sk_test_...) akzeptiert.'); process.exit(1); }

const PORT = 4406;
const BASE = `http://localhost:${PORT}`;
mkdirSync('daten', { recursive: true });
const lauf = Date.now();
const DB = resolve(`daten/selbsttest-sandbox-${lauf}.db`);
process.env.DB_DATEI = DB;
const pw = 'Geheim-Passwort-123';

let ok = 0, schlecht = 0;
const pruefe = (name, bedingung, detail = '') => { bedingung ? ok++ : schlecht++; console.log(`${bedingung ? 'OK     ' : 'FEHLER '} ${name}${!bedingung && detail ? '  -> ' + detail : ''}`); };

function client() {
  let cookie = '';
  return { async anfrage(methode, pfad, body) {
    const r = await fetch(BASE + pfad, { method: methode, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let d = {}; try { d = await r.json(); } catch (e) {}
    return { s: r.status, d };
  } };
}

let server;
try {
  const stripe = new Stripe(schluessel, { apiVersion: '2025-07-30.basil' });
  const konto = await stripe.accounts.retrieve();           // nur lesen: ist der Schlüssel gültig?
  console.log(`Sandbox-Konto erreichbar (${konto.id ? 'Konto-ID vorhanden' : 'ohne ID'}), Testmodus.`);
  const { erstelleServer } = await import('../app.mjs');
  const dateiOrdner = mkdtempSync(join(tmpdir(), 'schulung-sandbox-dateien-'));
  server = erstelleServer({ stripe, webhookSecret: 'whsec_nur_fuer_den_selbsttest', base: BASE, dateiOrdner }).listen(PORT, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 300));

  const mailAdmin = `selbsttest.sandbox.admin.${lauf}@example.com`, mailKunde = `selbsttest.sandbox.${lauf}@example.com`;
  const s = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/admin-anlegen.mjs', mailAdmin], { env: { ...process.env, ADMIN_PASSWORT: pw }, encoding: 'utf8' });
  pruefe('Admin in der Test-Datenbank angelegt', s.stdout.trim() === 'Admin angelegt', s.stdout + s.stderr);
  const admin = client(), kunde = client();
  await admin.anfrage('POST', '/api/anmelden', { email: mailAdmin, passwort: pw });
  const neuKurs = async (daten) => { const r = await admin.anfrage('POST', '/api/admin/kurse', daten); await admin.anfrage('POST', `/api/admin/kurse/${r.d.id}/veroeffentlichen`, {}); return r.d; };
  const kursHuf = await neuKurs({ titel: 'Selbsttest Színtanácsadás', preis_cent: 3990000, waehrung: 'huf' });
  const kursEur = await neuKurs({ titel: 'Selbsttest Euro-Kurs', preis_cent: 1500, waehrung: 'eur' });
  const kursAbo = await neuKurs({ titel: 'Selbsttest Abo', preis_cent: 2500000, waehrung: 'huf', abo_preis_cent: 990000, abo_intervall: 'month' });
  await kunde.anfrage('POST', '/api/registrieren', { zustimmung: true, email: mailKunde, passwort: pw });

  const pruefeKauf = async (kurs, bezeichnung) => {
    const r = await kunde.anfrage('POST', `/api/kurse/${kurs.id}/kaufen`, { modell: 'einmal', zustimmung: true });
    pruefe(`${bezeichnung}: Kauf-Route antwortet 200 mit einer Adresse`, r.s === 200 && /^https:\/\/checkout\.stripe\.com\//.test(r.d.url || ''), JSON.stringify(r));
    const id = (r.d.url || '').match(/(cs_test_[A-Za-z0-9]+)/)?.[1];
    pruefe(`${bezeichnung}: Sitzungs-ID (cs_test_...) steht in der Adresse`, !!id);
    if (!id) return;
    const sitzung = await stripe.checkout.sessions.retrieve(id);
    const posten = (await stripe.checkout.sessions.listLineItems(id)).data;
    pruefe(`${bezeichnung}: Stripe kennt die Sitzung (Modus payment, offen, noch nicht bezahlt)`, sitzung.mode === 'payment' && sitzung.status === 'open' && sitzung.payment_status === 'unpaid', `${sitzung.mode}/${sitzung.status}/${sitzung.payment_status}`);
    pruefe(`${bezeichnung}: Betrag und Währung stimmen (${kurs.preis_cent} ${kurs.waehrung})`, sitzung.amount_total === kurs.preis_cent && sitzung.currency === kurs.waehrung, `${sitzung.amount_total} ${sitzung.currency}`);
    pruefe(`${bezeichnung}: Position: 1 Stück, Preis und Name aus der Datenbank`, posten.length === 1 && posten[0].quantity === 1 && posten[0].price.unit_amount === kurs.preis_cent && posten[0].description === kurs.titel, JSON.stringify(posten.map((p) => [p.quantity, p.price?.unit_amount, p.description])));
    pruefe(`${bezeichnung}: metadata kurs_id und benutzer_id stimmen`, sitzung.metadata.kurs_id === String(kurs.id) && /^[1-9]\d*$/.test(sitzung.metadata.benutzer_id) && sitzung.client_reference_id === sitzung.metadata.benutzer_id, JSON.stringify(sitzung.metadata));
    pruefe(`${bezeichnung}: Kunde (cus_...) gehört zu diesem Benutzer in der Datenbank`, /^cus_/.test(sitzung.customer));
    pruefe(`${bezeichnung}: Rückkehr-Adressen und Sprache`, sitzung.success_url === `${BASE}/?kauf=erfolg&kurs=${kurs.id}` && sitzung.cancel_url === `${BASE}/?kauf=abgebrochen&kurs=${kurs.id}` && sitzung.locale === 'hu', `${sitzung.locale}`);
    pruefe(`${bezeichnung}: Stripe liefert die Zahlungsadresse (url)`, !!sitzung.url);
    return sitzung;
  };
  const s1 = await pruefeKauf(kursHuf, 'HUF-Kurs');
  const s2 = await pruefeKauf(kursEur, 'EUR-Kurs');
  pruefe('Beide Sitzungen gehören demselben Stripe-Kunden (einer je Benutzer)', !!s1 && !!s2 && s1.customer === s2.customer);
  const kundeStripe = await stripe.customers.retrieve(s1.customer);
  pruefe('Der Stripe-Kunde trägt die E-Mail des Benutzers und die Marke der Plattform', kundeStripe.email === mailKunde && kundeStripe.metadata.plattform === 'schulungsplattform');
  // Neue Abo-Checkout-Sitzung erzeugen und bei Stripe LESEN, keine Zahlung.
  const rAbo = await kunde.anfrage('POST', '/api/kurse/' + kursAbo.id + '/kaufen', { modell: 'abo', zustimmung: true });
  pruefe('Abo-Checkout-Route liefert Stripe-Testadresse', rAbo.s === 200 && /^https:\/\/checkout\.stripe\.com\//.test(rAbo.d.url || ''));
  const aboCheckoutId=(rAbo.d.url || '').match(/(cs_test_[A-Za-z0-9]+)/)?.[1];
  if (aboCheckoutId) {
    const aboSitzung=await stripe.checkout.sessions.retrieve(aboCheckoutId);
    const positionen=(await stripe.checkout.sessions.listLineItems(aboCheckoutId)).data;
    pruefe('Abo-Sitzung: subscription, offen, nicht bezahlt', aboSitzung.mode==='subscription' && aboSitzung.status==='open');
    pruefe('Abo-Preis/Intervall serverseitig', positionen.length===1 && positionen[0].price?.unit_amount===990000 &&
      positionen[0].price?.recurring?.interval==='month');
    pruefe('Abo-Metadaten in Checkout', aboSitzung.metadata?.modell==='abo' && aboSitzung.metadata?.kurs_id===String(kursAbo.id));
  } else pruefe('Abo-Checkout-ID verfügbar', false);
  console.log('Keine Zahlung ausgeführt. In der Sandbox bleiben 1 Test-Kunde und 3 offene Sitzungen (laufen von selbst ab).');
} catch (e) {
  schlecht++; console.log('FEHLER  Abbruch: ' + e.message);
} finally {
  if (server) server.close();
  for (const x of ['', '-wal', '-shm']) { try { rmSync(DB + x, { force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } } // Windows: Datei kann noch gesperrt sein
  console.log(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`);
  process.exit(schlecht === 0 ? 0 : 1);
}
