// F-129: Ein Loeschlauf bei LEEREM Auftragsbuch darf spaetere Loeschungen nicht dauerhaft blockieren (laeuft blieb gesetzt).
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
process.env.DB_DATEI = join(mkdtempSync(join(tmpdir(), 'f129-')), 't.db');
let ok = 0, fehler = 0;
const pruefe = (n, b, i = '') => { if (b) ok++; else { fehler++; console.log('FEHLER', n, i); } };
const { db } = await import('../db.mjs');
const { stripeKundenNachholen, stripeKundeVormerken } = await import('../stripe-kunde-loeschen.mjs');
const del = []; const stripe = { customers: { del: async id => { del.push(id); return { id, deleted: true }; } } };
const r1 = await stripeKundenNachholen(stripe);
pruefe('Lauf bei leerem Auftragsbuch endet normal', r1 && r1.erledigt === 0);
stripeKundeVormerken('cus_abc123');
const r2 = await stripeKundenNachholen(stripe);
pruefe('Danach wird der neue Auftrag ausgefuehrt (Stripe-Loeschung erfolgt)', del.includes('cus_abc123'), JSON.stringify(del));
pruefe('Auftragsbuch danach leer', db.prepare('SELECT count(*) c FROM stripe_kunde_loeschauftraege').get().c === 0);
pruefe('Ergebnis meldet 1 erledigt', r2 && r2.erledigt === 1, JSON.stringify(r2));
// zwei leere Laeufe hintereinander, dann Auftrag
await stripeKundenNachholen(stripe); await stripeKundenNachholen(stripe);
stripeKundeVormerken('cus_def456');
await stripeKundenNachholen(stripe);
pruefe('Auch nach mehreren leeren Laeufen wird geloescht', del.includes('cus_def456'), JSON.stringify(del));
console.log(`ERGEBNIS selbsttest-f129-loeschlauf: ${ok} OK, ${fehler} FEHLER`);
process.exit(fehler ? 1 : 0);
