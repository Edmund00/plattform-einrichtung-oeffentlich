// E2E-Variante (nur Tests): Mails werden NICHT versendet, sondern als JSON-Zeilen nach MAIL_DUMP geschrieben, damit Sprache und Inhalt pruefbar sind.
// Start der Schulungsplattform (nur Stripe-Testmodus, bis Edmund und Gabriella etwas anderes freigeben).
// Alle Einstellungen kommen aus Umgebungsvariablen und werden in konfig.mjs EINMAL geprüft (siehe docs/UMGEBUNG.md).
// Bei einem Fehler endet der Start mit Exitcode 1 und einer Meldung ohne Werte. Keine Schlüssel in Dateien.
import Stripe from 'stripe';
import { ladeKonfig, KonfigFehler } from '../konfig.mjs';

let konfig;
try {
  konfig = ladeKonfig(process.env);
} catch (e) {
  if (!(e instanceof KonfigFehler)) throw e;
  console.error('Abbruch: Die Konfiguration ist fehlerhaft (Werte werden nie ausgegeben, siehe docs/UMGEBUNG.md):');
  for (const meldung of e.meldungen) console.error(`  - ${meldung}`);
  process.exit(1);
}
for (const w of konfig.warnungen) console.warn(`Hinweis: ${w}`);

// Die Datenbank (db.mjs) liest DB_DATEI beim Laden. Erst laden, wenn die Konfiguration stimmt, damit bei einem Fehler nichts angelegt wird.
process.env.DB_DATEI = konfig.dbDatei;
const { erstelleServer } = await import('../app.mjs');
const { resendMailer } = await import('../mail.mjs');
const { erstelleBunny } = await import('../bunny.mjs');

const stripe = new Stripe(konfig.stripeSecretKey, { apiVersion: '2025-07-30.basil' });
const server = erstelleServer({ stripe, webhookSecret: konfig.stripeWebhookSecret, base: konfig.baseUrl, trustProxy: konfig.trustProxy, dateiOrdner: konfig.dateiOrdner, maxUploadBytes: konfig.maxUploadBytes, wiedergabeSchluessel: konfig.wiedergabeSchluessel, maxSitzungen: konfig.maxSitzungen, bunny: erstelleBunny(konfig.bunnyStream), bunnyMaxBytes: konfig.bunnyStreamMaxBytes, plattformWebhook: konfig.plattformWebhook, mailer: async (m) => { const fs0 = await import('node:fs'); if (process.env.MAIL_FAIL_DATEI && fs0.existsSync(process.env.MAIL_FAIL_DATEI)) return false; fs0.appendFileSync(process.env.MAIL_DUMP, JSON.stringify({ zeit: Date.now(), to: m.to, subject: m.subject, text: m.text, html: m.html }) + String.fromCharCode(10)); return true; }, verkaufsmeldungMail:konfig.verkaufsmeldungMail, registrierungMeldung:konfig.registrierungMeldung, ereignisAufbewahrungTage:konfig.ereignisAufbewahrungTage, supportMail:konfig.supportMail, anbieter:konfig.anbieter, sicherungOrdner:konfig.sicherungOrdner,sicherungSchluessel:konfig.sicherungSchluessel,sicherungBunny:konfig.sicherungBunny,alarmMails:konfig.alarmMails,nodeEnv:konfig.nodeEnv, abgleichModus:konfig.stripeSecretKey.startsWith('sk_live_')?'live':'test', adminErlaubt:konfig.adminErlaubt,notfallEntsperren:konfig.notfallEntsperren,verkaufPausiert:konfig.verkaufPausiert, demoModus:konfig.demoModus })
  .listen(konfig.port, konfig.host, () => console.log(`Schulungsplattform läuft: ${konfig.baseUrl} (lauscht auf ${konfig.host}:${konfig.port})`));
// Node beendet Anfragen standardmäßig nach 5 Minuten. Große Videos brauchen auf einer langsamen Leitung länger: bis zu 60 Minuten.
server.requestTimeout = 60 * 60 * 1000;

// Pruefrunde 3 (Agent H): ein vergessener Fehler in einem Zeitgeber (zum Beispiel Mail-Ausgang) darf den Prozess nicht beenden.
process.on('unhandledRejection', (grund) => { console.error('Unbehandelte Ablehnung:', grund?.code || grund?.name || 'unbekannt'); });
process.on('uncaughtException', (fehler) => { console.error('Unbehandelter Fehler:', fehler?.code || fehler?.name || 'unbekannt'); setTimeout(() => process.exit(1), 1000).unref?.(); });
// Render beendet den Dienst bei einem Deploy mit SIGTERM: erst laufende Anfragen beenden lassen (hoechstens 25 Sekunden).
process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 25000).unref?.(); });
