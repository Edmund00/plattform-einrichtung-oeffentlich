// A3-03 / A5-04 (12.11.2026): Login-Sperre zusaetzlich je KONTO (ueber alle Adressen) und feste Speicher-Obergrenze.
// Offline: Temp-DB, Mock-Stripe (wird nicht aufgerufen), eigener Port 4433, TRUST_PROXY=1 (X-Forwarded-For simuliert viele Adressen).
// Die Uhr wird fuer diesen Prozess per Date.now-Versatz vorgestellt (Server laeuft im selben Prozess).
import './test-sprache.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
const ordner = mkdtempSync(join(tmpdir(), 'schulung-loginsperre-'));
process.env.DB_DATEI = join(ordner, 'test.db');
const PORT = 4433, BASE = 'http://127.0.0.1:' + PORT;
const echtJetzt = Date.now; let versatz = 0; Date.now = () => echtJetzt() + versatz;
let gut = 0, schlecht = 0, server;
const pruefe = (name, ok, info = '') => { ok ? gut++ : schlecht++; console.log((ok ? 'OK     ' : 'FEHLER ') + name + (ok || !info ? '' : ' -> ' + info)); };
const anmelden = async (ip, email, passwort) => {
  const r = await fetch(BASE + '/api/anmelden', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ email, passwort }) });
  let d = {}; try { d = await r.json(); } catch { /* leer */ }
  return { s: r.status, d };
};
try {
  const { db } = await import('../db.mjs');
  const A = await import('../auth.mjs');
  const { erstelleServer } = await import('../app.mjs');
  const { HU } = await import('../texte.mjs');
  const stripe = { webhooks: { constructEvent: () => { throw Error('nicht benutzt'); } } };
  server = erstelleServer({ stripe, webhookSecret: 'whsec_nur_test', base: BASE, trustProxy: 1, dateiOrdner: join(ordner, 'dateien') }).listen(PORT, '127.0.0.1');
  await new Promise(r => setTimeout(r, 200));
  const pw = randomBytes(12).toString('hex'), falsch = randomBytes(12).toString('hex');
  const hash = await A.passwortHashen(pw);
  const konto = (email) => db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt) VALUES(?,?,?,?)").run(email, hash, new Date().toISOString(), Date.now());
  const opfer = 'opfer@example.org', knapp = 'knapp@example.org';
  konto(opfer); konto(knapp);
  pruefe('Konstanten: Schwelle 40/Stunde, Sperre 15 Minuten, Speicher hoechstens 10000', A.KONTO_SCHWELLE === 40 && A.KONTO_FENSTER === 3600000 && A.KONTO_SPERRE === 900000 && A.MAX_EINTRAEGE === 10000);

  // ---- IP-Sperre: Schwelle 6 (F-112) -------------------------------------------------------------------------------
  const ip1 = [];
  for (let i = 0; i < 7; i++) ip1.push((await anmelden('198.51.100.7', knapp, falsch)).s);
  // F-112: Schwelle 6 statt 5. P3-Muster: Zaehler VOR Hash. 5 Fehlversuche = Zaehler 5 (< 6, noch frei),
  // 6. Versuch = Zaehler 6 (>= 6, gesperrt). So koennen 5 Fehlversuche auftreten, bevor die Sperre greift.
  pruefe('IP+E-Mail-Sperre: 5x 401, ab dem 6. Versuch gesperrt (429)', ip1.slice(0, 5).every(s => s === 401) && ip1.slice(5).every(s => s === 429), ip1.join());
  A.fehlversucheAlleLoeschen();
  // F-112: 5. Versuch mit richtigem Passwort geht durch (200) — war mit alter Schwelle 5 nicht moeglich
  for (let i = 0; i < 4; i++) await anmelden('198.51.100.8', knapp, falsch);
  pruefe('F-112: 5. Versuch mit richtigem Passwort → 200 (kein Lock)', (await anmelden('198.51.100.8', knapp, pw)).s === 200);
  A.fehlversucheAlleLoeschen();

  // ---- Unter der Schwelle: keine Kontosperre --------------------------------------------------------------------------
  for (let i = 0; i < A.KONTO_SCHWELLE - 1; i++) await anmelden('203.0.113.' + (10 + Math.floor(i / 4)), knapp, falsch);
  pruefe('39 verteilte Fehlversuche: richtiges Passwort von neuer Adresse geht (200)', (await anmelden('192.0.2.200', knapp, pw)).s === 200);
  A.fehlversucheAlleLoeschen();

  // ---- Vertraute Adresse: Inhaber meldet sich vorher erfolgreich an -----------------------------------------------------
  pruefe('Inhaber meldet sich von seiner Adresse an (200)', (await anmelden('192.0.2.10', opfer, pw)).s === 200);
  // ---- Verteiltes Raten: 40 Fehlversuche ueber 10 Adressen (je 4, unter der IP-Grenze) --------------------------------
  const antworten = [];
  for (let i = 0; i < A.KONTO_SCHWELLE; i++) antworten.push((await anmelden('203.0.113.' + (100 + Math.floor(i / 4)), opfer, falsch)).s);
  pruefe('40 verteilte Fehlversuche: jede Adresse unter der IP-Grenze (alle 401)', antworten.every(s => s === 401), antworten.join());
  const neu = await anmelden('198.51.100.99', opfer, pw);
  pruefe('Danach: richtiges Passwort von NEUER Adresse gesperrt (429, bestehende Sperr-Antwort)', neu.s === 429 && neu.d.fehler === 'zu_viele_versuche' && neu.d.text === HU.zu_viele_versuche, JSON.stringify(neu));
  pruefe('Weitere Rateversuche von neuer Adresse: 429 ohne Passwortpruefung', (await anmelden('198.51.100.98', opfer, falsch)).s === 429);
  pruefe('Inhaber von seiner vertrauten Adresse: trotzdem 200 (kein Aussperren)', (await anmelden('192.0.2.10', opfer, pw)).s === 200);
  pruefe('Andere Konten nicht betroffen', (await anmelden('198.51.100.99', knapp, pw)).s === 200);
  versatz += 14 * 60000;
  pruefe('Nach 14 Minuten noch gesperrt', (await anmelden('198.51.100.97', opfer, pw)).s === 429);
  versatz += 61000;
  pruefe('Nach 15 Minuten: richtiges Passwort von neuer Adresse wieder 200', (await anmelden('198.51.100.96', opfer, pw)).s === 200);

  // ---- Aufheben: Passwort-Ruecksetzen und NOTFALL_ENTSPERREN ----------------------------------------------------------
  const sperren = async (basis) => { for (let i = 0; i < A.KONTO_SCHWELLE; i++) await anmelden(basis + (Math.floor(i / 4)), opfer, falsch); };
  await sperren('203.0.114.');
  pruefe('Erneut gesperrt', (await anmelden('198.51.100.95', opfer, pw)).s === 429);
  A.fehlversucheFuerEmailLoeschen(opfer);   // das ruft der Passwort-Ruecksetz-Link (routes-passwort.mjs) auf
  pruefe('Passwort-Ruecksetzen hebt die Kontosperre auf', (await anmelden('198.51.100.95', opfer, pw)).s === 200);
  await sperren('203.0.115.');
  pruefe('Erneut gesperrt (vor Notfall)', (await anmelden('198.51.100.94', opfer, pw)).s === 429);
  const { adminStart } = await import('../admin-start.mjs');
  adminStart({ liste: [], notfall: true });   // genau das macht erstelleServer bei NOTFALL_ENTSPERREN=1
  pruefe('NOTFALL_ENTSPERREN (notfallStart) hebt die Kontosperre auf', (await anmelden('198.51.100.94', opfer, pw)).s === 200);

  // ---- Speicher-Obergrenze (LRU) ----------------------------------------------------------------------------------------
  A.fehlversucheAlleLoeschen();
  for (let i = 0; i < A.MAX_EINTRAEGE + 500; i++) { A.fehlversuchMerken('10.0.' + i + '|x' + i + '@example.org'); A.kontoFehlversuchMerken('x' + i + '@example.org'); }
  const g = A._speicherGroesse();
  pruefe('Speicher bleibt bei hoechstens 10000 Eintraegen je Map (vorher unbegrenzt)', g.fehlversuche <= A.MAX_EINTRAEGE && g.kontoFehler <= A.MAX_EINTRAEGE, JSON.stringify(g));
  for (let i = 0; i < 6; i++) A.fehlversuchMerken('10.0.9|frisch@example.org');
  pruefe('Neuester Eintrag bleibt erhalten und sperrt (LRU wirft die aeltesten ab)', A.gesperrt('10.0.9|frisch@example.org') && !A.gesperrt('10.0.0|x0@example.org'));
  for (let i = 0; i < 300; i++) A.anmeldungErfolgreich('y' + i + '@example.org', '10.1.0.1');
  pruefe('Vertraute Adressen ebenfalls begrenzt', A._speicherGroesse().vertraute <= A.MAX_EINTRAEGE);
  // PUNKT-3: 12 parallele Fehlversuche duerfen maximal 5 Hashes ausloesen (atomarer Zaehler).
  {
    A.fehlversucheAlleLoeschen();
    const p3email = 'p3parallel@example.org';
    konto(p3email);
    const parallel12 = await Promise.all(Array.from({length: 12}, (_,i) => anmelden('10.3.4.5', p3email, 'falsch_'+i)));
    pruefe('PUNKT-3: 12 parallele Fehlversuche — atomare Sperre greift, mindestens einer 429',
      parallel12.some(r => r.s === 429), parallel12.map(r => r.s).join(','));
    A.fehlversucheAlleLoeschen();
  }
} catch (e) {
  schlecht++; console.log('FEHLER Abbruch: ' + (e?.stack || e));
} finally {
  Date.now = echtJetzt;
  server?.close();
  setTimeout(() => { try { rmSync(ordner, { recursive: true, force: true }); } catch { /* Temp */ } console.log(`\nloginsperre: ${gut} OK, ${schlecht} FEHLER`); process.exit(schlecht ? 1 : 0); }, 100);
}
