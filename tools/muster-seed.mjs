// Legt die MUSTERDATEN an: Admin, Musterkurs (649 EUR) mit Lektionen, Mustermann (Kunde). Nur gegen die laufende Muster-Plattform (BASE_URL).
// Aufruf: ADMIN_PASSWORT=... MUSTER_ADMIN_MAIL=... node tools/muster-seed.mjs   (Passwort nie auf der Kommandozeile zeigen)
// Gibt nur IDs und Ergebnisse aus, nie Passwoerter. Idempotent: ein vorhandener Musterkurs wird nicht doppelt angelegt.
const BASE = process.env.BASE_URL || 'http://localhost:4400';
const mail = process.env.MUSTER_ADMIN_MAIL;
const pw = process.env.ADMIN_PASSWORT;
if (!mail || !pw) { console.error('MUSTER_ADMIN_MAIL und ADMIN_PASSWORT setzen.'); process.exit(1); }
let cookie = '';
async function api(methode, pfad, body) {
  const r = await fetch(BASE + pfad, { method: methode, headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.getSetCookie?.() || [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  let d = null; try { d = await r.json(); } catch { /* leer */ }
  return { s: r.status, d };
}
const a = await api('POST', '/api/anmelden', { email: mail, passwort: pw });
if (a.s !== 200) { console.error('Admin-Anmeldung fehlgeschlagen:', a.s, a.d?.fehler || ''); process.exit(1); }
const liste = await api('GET', '/api/admin/kurse');
const vorhanden = Array.isArray(liste.d) ? liste.d.find((k) => k.titel === 'Musterkurs: Stripe Billing in der Praxis') : null;
if (vorhanden) { console.log('Musterkurs vorhanden: id', vorhanden.id, 'status', vorhanden.status); process.exit(0); }
const k = await api('POST', '/api/admin/kurse', {
  titel: 'Musterkurs: Stripe Billing in der Praxis',
  beschreibung: 'MUSTERKURS (Demo). Zeigt, wie ein Kurs mit Checkout, Beleg, Kaufmail und Widerruf funktioniert. Alle Daten sind erfunden, bezahlt wird nur mit Stripe-Testkarten.',
  preis_cent: 64900, waehrung: 'eur',
});
if (k.s !== 201 && k.s !== 200) { console.error('Kurs anlegen fehlgeschlagen:', k.s, JSON.stringify(k.d).slice(0, 160)); process.exit(1); }
const id = k.d.id;
const lektionen = [
  ['Willkommen', 'Einführung', 'Willkommen im Musterkurs. Hier sehen Sie, was nach dem Kauf freigeschaltet wird: Lektionen mit Text, später auch Video, PDF und Audio.'],
  ['Wie ein Abo entsteht', 'Billing', 'Muster-Inhalt: Kunde, Produkt, Preis, Abo, Rechnung. Der Zugang entsteht erst durch die signierte Bestätigung von Stripe (Webhook), nicht durch die Erfolgsseite.'],
  ['Zahlung, Beleg, Erstattung', 'Payments', 'Muster-Inhalt: Zahlung bestätigt, Beleg erzeugt, Widerruf löst eine Erstattung aus und entzieht den Zugang.'],
];
for (const [titel, abschnitt, inhalt] of lektionen) {
  const l = await api('POST', `/api/admin/kurse/${id}/lektionen`, { titel, abschnitt, art: 'text', inhalt });
  if (l.s !== 201) { console.error('Lektion fehlgeschlagen:', titel, l.s); process.exit(1); }
}
const v = await api('POST', `/api/admin/kurse/${id}/veroeffentlichen`, {});
console.log('Musterkurs angelegt: id', id, 'Lektionen', lektionen.length, 'veröffentlicht:', v.s === 200);
