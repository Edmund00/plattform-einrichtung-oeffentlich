// Kontoloeschung: Stripe-Kundendaten sicher entfernen (A6-01, Gesamtpruefung 12.11.2026).
// Vorher: routes-konto.mjs setzte stripe_kunde sofort auf NULL und rief customers.del genau einmal; scheiterte das (Netz, Neustart), blieb der
// Kunde mit Name/Mail/Adresse bei Stripe und die ID war weg. Jetzt: die ID wird IN der Loesch-Transaktion in diesem Auftragsbuch vorgemerkt
// und erst nach Erfolg (oder "gibt es bei Stripe nicht mehr") entfernt. Muster wie bunny-loeschen.mjs.
// Gespeichert wird NUR die Stripe-Kunden-ID (cus_...), keine E-Mail, kein Name, keine Benutzer-ID.
import { db } from './db.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS stripe_kunde_loeschauftraege (
  stripe_kunde   TEXT PRIMARY KEY,
  erstellt       TEXT NOT NULL,
  versuche       INTEGER NOT NULL DEFAULT 0 CHECK (versuche >= 0),
  letzter_fehler TEXT
)`);

const ID_OK = /^cus_[A-Za-z0-9_]{1,250}$/;
// Test-Attrappen ohne Stripe (Proxy, der bei jedem Zugriff wirft) duerfen den Start nicht kippen.
export function kannStripeKundenLoeschen(stripe) { try { return typeof stripe?.customers?.del === 'function'; } catch { return false; } }
export const NACHHOLEN_MS = 10 * 60 * 1000;

// In der Transaktion der Kontoloeschung aufrufen. Ungueltige oder leere IDs werden ignoriert.
export function stripeKundeVormerken(id) {
  if (typeof id !== 'string' || !ID_OK.test(id)) return false;
  db.prepare('INSERT OR IGNORE INTO stripe_kunde_loeschauftraege (stripe_kunde, erstellt) VALUES (?, ?)').run(id, new Date().toISOString());
  return true;
}

const fehlerCode = (e) => String(e?.code || e?.type || e?.name || 'Fehler').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
// "Gibt es bei Stripe nicht (mehr)" gilt als erledigt. GRENZFALL Kontowechsel: Wird STRIPE_SECRET_KEY von Test auf Live (oder auf ein anderes
// Stripe-Konto) umgestellt, meldet Stripe fuer die alten cus_-IDs ebenfalls resource_missing, obwohl der Kunde im ALTEN Konto noch existiert.
// Der Auftrag wird dann trotzdem entfernt (mit dem neuen Schluessel ist er nicht loeschbar). Darum: vor einem Schluesselwechsel das Auftragsbuch
// leer laufen lassen (SELECT COUNT(*) FROM stripe_kunde_loeschauftraege = 0) oder Reste im alten Dashboard von Hand loeschen (Testdaten).
const gibtEsNicht = (e) => e?.code === 'resource_missing' || e?.statusCode === 404;
// Schluessel ungueltig oder ohne Recht (401/403): jeder weitere Versuch scheitert genauso. Dann nicht alle 10 Minuten, sondern mit
// verdoppelter Pause (20 min, 40 min, ... hoechstens 6 Stunden); ein Erfolg setzt die Pause zurueck.
const keinZugriff = (e) => ['StripeAuthenticationError', 'StripePermissionError'].includes(e?.type) || e?.statusCode === 401 || e?.statusCode === 403;
export const PAUSE_MAX_MS = 6 * 60 * 60 * 1000;
let pauseMs = 0, pauseBis = 0;
export const stripeLoeschPause = () => ({ pauseMs, pauseBis });

let laeuft = null, nochmal = false;
// Arbeitet das Auftragsbuch ab. Wirft nie. Laeuft schon ein Lauf, wird er zurueckgegeben und prueft danach noch einmal (neue Auftraege gehen nicht verloren).
// Je Lauf hoechstens EINE Warnzeile (Anzahl und Fehlercodes), nicht eine je Auftrag. jetzt: nur fuer Tests.
export function stripeKundenNachholen(stripe, { jetzt = Date.now } = {}) {
  if (!kannStripeKundenLoeschen(stripe)) return Promise.resolve({ erledigt: 0, aus: true });
  if (jetzt() < pauseBis) return Promise.resolve({ erledigt: 0, pausiert: true });
  if (laeuft) { nochmal = true; return laeuft; }
  laeuft = (async () => {
    // F-129: Ohne diese Zeile laeuft ein Lauf bei leerem Auftragsbuch synchron durch, das finally setzt laeuft=null VOR der Zuweisung, und laeuft bleibt danach fuer immer gesetzt (keine Stripe-Loeschung mehr bis zum Neustart).
    await Promise.resolve();
    let erledigt = 0, fehlgeschlagen = 0, gesperrt = false;
    const codes = new Set();
    try {
      for (let runde = 0; runde < 3 && !gesperrt; runde++) {
        nochmal = false;
        const auftraege = db.prepare('SELECT stripe_kunde FROM stripe_kunde_loeschauftraege ORDER BY versuche, erstellt LIMIT 50').all();
        for (const a of auftraege) {
          try {
            await stripe.customers.del(a.stripe_kunde);
            db.prepare('DELETE FROM stripe_kunde_loeschauftraege WHERE stripe_kunde = ?').run(a.stripe_kunde);
            erledigt++; pauseMs = 0; pauseBis = 0;
          } catch (e) {
            if (gibtEsNicht(e)) { db.prepare('DELETE FROM stripe_kunde_loeschauftraege WHERE stripe_kunde = ?').run(a.stripe_kunde); erledigt++; continue; }
            try { db.prepare('UPDATE stripe_kunde_loeschauftraege SET versuche = versuche + 1, letzter_fehler = ? WHERE stripe_kunde = ?').run(fehlerCode(e), a.stripe_kunde); } catch { /* Datenbank selbst gestoert */ }
            fehlgeschlagen++; codes.add(fehlerCode(e));
            if (keinZugriff(e)) {
              gesperrt = true;
              pauseMs = Math.min(PAUSE_MAX_MS, pauseMs ? pauseMs * 2 : 2 * NACHHOLEN_MS);
              pauseBis = jetzt() + pauseMs;
              break;
            }
          }
        }
        if (!nochmal) break;
      }
    } catch (e) {
      fehlgeschlagen++; codes.add(fehlerCode(e));
    } finally {
      laeuft = null;
    }
    if (fehlgeschlagen) console.warn('Stripe-Kundendaten: ' + fehlgeschlagen + ' Loeschung(en) gescheitert (' + [...codes].join(',') + '); Auftraege bleiben' + (gesperrt ? ', naechster Versuch in ' + Math.round(pauseMs / 60000) + ' min' : ' und werden wiederholt'));
    return { erledigt, fehlgeschlagen };
  })();
  return laeuft;
}
