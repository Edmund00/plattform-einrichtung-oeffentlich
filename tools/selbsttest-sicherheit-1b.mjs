// Selbsttest Sicherheitspaket 1b — F-40 (Hauptschluessel wxFlag) + F-116 (scrypt N=2^17 + Rehash)
// Aufruf: node tools/selbsttest-sicherheit-1b.mjs
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

// DB_DATEI VOR dem dynamischen Import von app.mjs / auth.mjs setzen (Singleton db.mjs)
const lauf = Date.now();
const tmpDir = mkdtempSync(join(tmpdir(), `pe-s1b-${lauf}-`));
const DB_PFAD = join(tmpDir, 'test.db');
process.env.DB_DATEI = DB_PFAD;

import './test-sprache.mjs';

const scryptAsync = promisify(scrypt);

let ok = 0, schlecht = 0;
const pruefe = (name, bedingung, detail = '') => {
  bedingung ? ok++ : schlecht++;
  console.log(`${bedingung ? 'OK     ' : 'FEHLER '} ${name}${!bedingung && detail ? '  -> ' + detail : ''}`);
};
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- F-40: Hauptschluessel-Datei exklusiv (flag wx) ----
abschnitt('F-40: Hauptschluessel-Datei exklusiv (flag wx)');
{
  const { erzeugeHauptschluesselDatei, HAUPTSCHLUESSEL_LAENGE } = await import('../einstellungen.mjs');
  const datei = join(tmpDir, '.hauptschluessel-test');

  // F-40-1: Neue Datei erzeugen — liefert Buffer mit korrekter Laenge
  const schluessel1 = erzeugeHauptschluesselDatei(datei);
  pruefe('F-40-1 Neue Datei erzeugt, Rueckgabe = Buffer', Buffer.isBuffer(schluessel1));
  pruefe('F-40-2 Laenge = HAUPTSCHLUESSEL_LAENGE', schluessel1.length === HAUPTSCHLUESSEL_LAENGE, `Laenge: ${schluessel1.length}`);

  // F-40-3: Zweiter Aufruf liefert denselben Inhalt (EEXIST-Pfad)
  const schluessel2 = erzeugeHauptschluesselDatei(datei);
  pruefe('F-40-3 Zweiter Aufruf liefert gleichen Schluessel', schluessel1.equals(schluessel2));

  // F-40-4: Datei-Inhalt stimmt mit Rueckgabe ueberein
  const dateiInhalt = readFileSync(datei);
  pruefe('F-40-4 Datei-Inhalt == Rueckgabe des ersten Aufrufs', schluessel1.equals(dateiInhalt));

  // F-40-5: Race-Condition-Szenario — parallele Aufrufe liefern beide denselben Schluessel
  const datei2 = join(tmpDir, '.hauptschluessel-race');
  const [a, b] = await Promise.all([
    Promise.resolve(erzeugeHauptschluesselDatei(datei2)),
    Promise.resolve(erzeugeHauptschluesselDatei(datei2)),
  ]);
  pruefe('F-40-5 Parallele Aufrufe: beide identisch', a.equals(b));
}

// ---- F-116: scrypt N=2^17, Format-Migration ----
abschnitt('F-116: scrypt N=131072, Format-Migration');
{
  const { passwortHashen, passwortPruefen } = await import('../auth.mjs');

  const hash = await passwortHashen('Testpasswort-1');
  const teile = hash.split('$');

  pruefe('F-116-1 Hash hat 6 Teile (scrypt$N$r$p$salz$hash)', teile.length === 6, `Teile: ${teile.length}`);
  pruefe('F-116-2 N=131072', teile[1] === '131072', `N=${teile[1]}`);
  pruefe('F-116-3 r=8', teile[2] === '8', `r=${teile[2]}`);
  pruefe('F-116-4 p=1', teile[3] === '1', `p=${teile[3]}`);

  // F-116-5: Pruefen mit neuem Format — korrekt
  const richtig = await passwortPruefen('Testpasswort-1', hash);
  pruefe('F-116-5 Neues Format: richtiges Passwort = true', richtig === true);

  // F-116-6: Pruefen mit neuem Format — falsch
  const falsch = await passwortPruefen('FalschesPasswort', hash);
  pruefe('F-116-6 Neues Format: falsches Passwort = false', falsch === false);

  // F-116-7: Altes Format (N=16384) — Rueckwaertskompatibilitaet
  const salzAlt = randomBytes(16);
  const schluesselAlt = await scryptAsync('Testpasswort-1', salzAlt, 64, { N: 16384, r: 8, p: 1 });
  const altHash = `scrypt$${salzAlt.toString('hex')}$${schluesselAlt.toString('hex')}`;
  const altRichtig = await passwortPruefen('Testpasswort-1', altHash);
  pruefe('F-116-7 Altes Format (N=16384): richtiges Passwort = true', altRichtig === true);

  // F-116-8: Altes Format — falsches Passwort
  const altFalsch = await passwortPruefen('FalschesPasswort', altHash);
  pruefe('F-116-8 Altes Format: falsches Passwort = false', altFalsch === false);

  // F-116-9: Unbekanntes Format
  const unbekannt = await passwortPruefen('x', 'md5$abc123');
  pruefe('F-116-9 Unbekanntes Format = false', unbekannt === false);
}

// ---- F-116 Rehash beim Login (HTTP-Test) ----
abschnitt('F-116: Rehash beim Login (HTTP)');
{
  const PORT = 4489;
  const BASE = `http://localhost:${PORT}`;
  const PW = 'Passwort-Rehash-Test-1';

  const { erstelleServer } = await import('../app.mjs');

  // Minimale Stripe-Attrappe ohne .del (damit kannStripeKundenLoeschen false liefert)
  const attrappe = {
    webhooks: { constructEventAsync: async () => { throw new Error('kein webhook'); } },
    customers: { create: async () => ({ id: 'cus_attrappe_rehash' }) },
    checkout: {
      sessions: {
        create: async () => ({ id: 'cs_attrappe_rehash', url: 'https://example.com/checkout', status: 'open' }),
        list: async () => ({ data: [] }),
      },
    },
  };

  let server;
  try {
    const app = erstelleServer({
      stripe: attrappe,
      webhookSecret: 'whsec_attrappe_rehash',
      base: BASE,
      nodeEnv: 'test',
    });
    server = app.listen(PORT);
    await warte(300);

    // Schritt 1: Benutzer registrieren (erzeugt neues Format)
    const reg = await fetch(`${BASE}/api/registrieren`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rehash@beispiel.test', passwort: PW, zustimmung: true }),
    });
    pruefe('F-116-R1 Registrierung erfolgreich (200/201)', reg.status === 200 || reg.status === 201, `Status: ${reg.status}`);

    // Schritt 2: Altes Hash-Format direkt in DB schreiben
    const salzAlt = randomBytes(16);
    const schluesselAlt = await scryptAsync(PW, salzAlt, 64, { N: 16384, r: 8, p: 1 });
    const altHash = `scrypt$${salzAlt.toString('hex')}$${schluesselAlt.toString('hex')}`;

    {
      const dboffen = new DatabaseSync(DB_PFAD);
      dboffen.prepare('UPDATE benutzer SET passwort_hash=? WHERE email=?').run(altHash, 'rehash@beispiel.test');
      dboffen.close();
    }

    // Schritt 2b: Verifikation dass altes Format wirklich in DB steht
    {
      const dbpruf = new DatabaseSync(DB_PFAD);
      const zeile = dbpruf.prepare('SELECT passwort_hash FROM benutzer WHERE email=?').get('rehash@beispiel.test');
      dbpruf.close();
      pruefe('F-116-R2 Altes Format in DB eingetragen (3 Teile)', zeile?.passwort_hash?.split('$').length === 3, `Hash: ${(zeile?.passwort_hash ?? '').substring(0, 25)}...`);
    }

    // Schritt 3: Login — triggert Hintergrund-Rehash
    const anm = await fetch(`${BASE}/api/anmelden`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rehash@beispiel.test', passwort: PW }),
    });
    pruefe('F-116-R3 Login erfolgreich (200)', anm.status === 200, `Status: ${anm.status}`);

    // Schritt 4: Warten bis Hintergrund-scrypt (N=131072 ~2s) fertig
    await warte(4000);

    // Schritt 5: Neues Format in DB pruefen
    {
      const dbfinal = new DatabaseSync(DB_PFAD);
      const zeile = dbfinal.prepare('SELECT passwort_hash FROM benutzer WHERE email=?').get('rehash@beispiel.test');
      dbfinal.close();
      const teile = zeile?.passwort_hash?.split('$') ?? [];
      pruefe('F-116-R4 Nach Rehash: 6 Teile im neuen Format', teile.length === 6, `Teile: ${teile.length}, Hash: ${(zeile?.passwort_hash ?? '').substring(0, 30)}...`);
      pruefe('F-116-R5 Nach Rehash: N=131072', teile[1] === '131072', `N=${teile[1]}`);
    }
  } finally {
    if (server) await new Promise((r) => server.close(r));
  }
}

// ---- Aufraeumen ----
try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log('');
console.log(`Ergebnis: ${ok} OK, ${schlecht} FEHLER`);
if (schlecht > 0) process.exit(1);
