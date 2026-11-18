// Kleiner Server NUR für die Selbsttests (selbsttest-kurse.mjs, selbsttest-admin.mjs): dieselbe App wie server.mjs (app.mjs),
// aber ohne Stripe. Der Platzhalter wirft einen Fehler, falls ein Test doch Stripe berührt. Keine Schlüssel nötig.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { erstelleServer } from '../app.mjs';

const PORT = Number(process.env.PORT || 4402);
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
const ohneStripe = new Proxy({}, { get: () => { throw new Error('Stripe ist im Kurs-Testserver nicht vorhanden'); } });

const dateiOrdner = process.env.DATEI_ORDNER || mkdtempSync(join(tmpdir(), 'schulung-testdateien-'));
erstelleServer({ stripe: ohneStripe, webhookSecret: 'whsec_nur_fuer_tests', base: BASE, dateiOrdner })
  .listen(PORT, '127.0.0.1', () => console.log(`Kurs-Testserver läuft: ${BASE}`));
