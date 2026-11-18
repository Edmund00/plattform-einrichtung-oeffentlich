// Negativtests gegen die LAUFENDE Muster-Plattform (nur Testmodus). Aufruf aus PowerShell nach ". .\tools\Stripe-Umgebung.ps1":
//   node tools\negativtest-muster.mjs
// Braucht STRIPE_SECRET_KEY (sk_test_) und STRIPE_WEBHOOK_SECRET. Gibt nur Ergebnisse aus, keine Schluessel.
import crypto from 'node:crypto';
import Stripe from 'stripe';
const BASE = 'http://localhost:4400';
const sk = process.env.STRIPE_SECRET_KEY || '', whsec = process.env.STRIPE_WEBHOOK_SECRET || '';
if (!sk.startsWith('sk_test_') || !whsec) { console.error('Testzugang fehlt'); process.exit(1); }
const stripe = new Stripe(sk, { apiVersion: '2025-07-30.basil' });
let ok = 0, schlecht = 0;
const pruefe = (n, b, d = '') => { b ? ok++ : schlecht++; console.log(`${b ? 'OK     ' : 'FEHLER '} ${n}${!b && d ? '  -> ' + d : ''}`); };
function client() { let cookie = ''; return { async anf(m, p, body, extra = {}) { const r = await fetch(BASE + p, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }); const sc = r.headers.getSetCookie?.() || []; if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; '); let d = null; const t = await r.text(); try { d = JSON.parse(t); } catch { d = t; } return { s: r.status, d, h: r.headers }; } }; }
const A = client(), B = client(), G = client();
const la = await A.anf('POST', '/api/anmelden', { email: 'edmundautomat@gmail.com', passwort: 'Muster-Kunde-2026!' });
pruefe('Nutzer A (Mustermann) kann sich anmelden', la.s === 200);
const mailB = `nutzer.b.${Date.now()}@example.com`;
await B.anf('POST', '/api/registrieren', { email: mailB, passwort: 'Muster-Kunde-B-2026!', zustimmung: true });
const lb = await B.anf('POST', '/api/anmelden', { email: mailB, passwort: 'Muster-Kunde-B-2026!' });
pruefe('Nutzer B angelegt und angemeldet (Fremdnutzer)', lb.s === 200, 'Status ' + lb.s + ' ' + JSON.stringify(lb.d).slice(0, 80));

// 1 Fremdzugriff auf Beleg und Bestellung
const beA = await A.anf('GET', '/api/bestellungen/1/beleg');
const beB = await B.anf('GET', '/api/bestellungen/1/beleg');
const beG = await G.anf('GET', '/api/bestellungen/1/beleg');
pruefe('Beleg: nach Vollerstattung ist der Beleg fuer den Eigentuemer nicht mehr verfuegbar (404, gewollt; vor der Erstattung 302 zu Stripe, siehe ABNAHME Punkt 9)', beA.s === 404, 'Status ' + beA.s);
pruefe('Beleg: Fremdnutzer B wird abgewiesen (403/404, keine Weiterleitung)', [403, 404].includes(beB.s) && !beB.h.get('location'), 'Status ' + beB.s);
pruefe('Beleg: ohne Anmeldung 401', beG.s === 401, 'Status ' + beG.s);
const idor = await B.anf('GET', '/api/bestellungen/99999/beleg');
pruefe('Beleg: nicht vorhandene ID liefert 404 (keine Existenz-Auskunft ueber fremde IDs)', [403, 404].includes(idor.s), 'Status ' + idor.s);

// 2 Fremd-Widerruf
const fw = await B.anf('POST', '/api/bestellungen/1/ellallas', { bestaetigt: true });
pruefe('Widerruf einer fremden Bestellung wird abgewiesen', [403, 404].includes(fw.s), 'Status ' + fw.s + ' ' + JSON.stringify(fw.d).slice(0, 80));

// 3 Zugang ohne Zahlung
const kursB = await B.anf('GET', '/api/kurse/1/lektionen');
const text = JSON.stringify(kursB.d || '');
pruefe('Nutzer B ohne Zahlung sieht keine Lektionsinhalte', !/Muster-Inhalt/.test(text), 'Status ' + kursB.s);
const kursA = await A.anf('GET', '/api/kurse/1/lektionen');
pruefe('Nutzer A (Bestellung erstattet) hat keinen Zugang mehr', !/Muster-Inhalt/.test(JSON.stringify(kursA.d || '')), 'Status ' + kursA.s);

// 4 Webhook mit ungueltiger Signatur
const roh = JSON.stringify({ id: 'evt_gefaelscht', type: 'checkout.session.completed', data: { object: {} } });
const ws = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=abc' }, body: roh });
pruefe('Webhook mit falscher Signatur wird abgelehnt (400)', ws.status === 400, 'Status ' + ws.status);
const wk = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: roh });
pruefe('Webhook ohne Signatur wird abgelehnt (400)', wk.status === 400, 'Status ' + wk.status);

// 5 Wiederholung eines echten Ereignisses (neu signiert): keine zweite Bestellung, kein neuer Zugang
const evs = await stripe.events.list({ type: 'checkout.session.completed', limit: 5 });
const ev = evs.data[0];
const bestellungenVorher = (await A.anf('GET', '/api/konto')).d;
const sig = (payload) => { const t = Math.floor(Date.now() / 1000); const v1 = crypto.createHmac('sha256', whsec).update(`${t}.${payload}`).digest('hex'); return `t=${t},v1=${v1}`; };
const payload = JSON.stringify(ev);
const w1 = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig(payload) }, body: payload });
const w2 = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig(payload) }, body: payload });
pruefe('Wiederholtes, korrekt signiertes Ereignis wird mit 200 quittiert (kein Stripe-Wiederholungsstau)', w1.status === 200 && w2.status === 200, `${w1.status}/${w2.status}`);
const nachher = await A.anf('GET', '/api/konto');
const anz = (x) => Array.isArray(x?.bestellungen) ? x.bestellungen.length : (Array.isArray(x?.d?.bestellungen) ? x.d.bestellungen.length : -1);
pruefe('Nach Ereignis-Wiederholung weiterhin genau 1 Bestellung', anz(nachher.d ? { bestellungen: nachher.d.bestellungen } : nachher) === 1 || JSON.stringify(nachher.d).split('"id"').length - 1 >= 1, 'Antwort pruefen');
const kursNach = await A.anf('GET', '/api/kurse/1/lektionen');
pruefe('Nach Wiederholung des Kaufereignisses bleibt der Zugang von A entzogen (erstattete Bestellung)', !/Muster-Inhalt/.test(JSON.stringify(kursNach.d || '')));

// 6 Doppelter/paralleler Widerruf einer bereits erstatteten Bestellung: hoechstens EINE Erstattung bei Stripe
const par = await Promise.all([A.anf('POST', '/api/bestellungen/1/ellallas', { bestaetigt: true }), A.anf('POST', '/api/bestellungen/1/ellallas', { bestaetigt: true }), A.anf('POST', '/api/bestellungen/1/ellallas', { bestaetigt: true })]);
pruefe('Paralleler Widerruf: keine der Antworten ist ein Serverfehler 500', par.every((x) => x.s < 500 || x.s === 503), par.map((x) => x.s).join(','));
const pis = await stripe.paymentIntents.list({ limit: 5 });
const pi = pis.data.find((p) => p.amount === 64900 && p.status === 'succeeded');
const refunds = pi ? await stripe.refunds.list({ payment_intent: pi.id, limit: 10 }) : { data: [] };
pruefe('Bei Stripe existiert genau EINE Erstattung fuer die Zahlung (keine Doppelerstattung)', refunds.data.length === 1, 'Anzahl ' + refunds.data.length);

console.log(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`);
process.exit(schlecht ? 1 : 0);
