import './test-sprache.mjs';
// PUNKT-15 (F-96): Kontoübernahme via Email-Änderungs-Token.
// Passwort-Reset und Passwort-Änderung müssen alle email_aender_token des Nutzers löschen,
// damit ein Angreifer mit einem vorab beantragten Link das Konto nicht übernehmen kann.
// Aufruf: node --disable-warning=ExperimentalWarning tools/selbsttest-emailaender-bereinigung.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';

const ordner = mkdtempSync(join(tmpdir(), 'schulung-emailaender-bereinigung-'));
process.env.DB_DATEI = join(ordner, 'test.db');
const PORT = 4489, BASE = 'http://127.0.0.1:' + PORT;
let gut = 0, schlecht = 0, server;
const pruefe = (name, ok, info = '') => { ok ? gut++ : schlecht++; console.log((ok ? 'OK     ' : 'FEHLER ') + name + (ok || !info ? '' : ' -> ' + info)); };
const sha256 = s => createHash('sha256').update(s).digest('hex');

try {
  const { db } = await import('../db.mjs');
  const { passwortHashen } = await import('../auth.mjs');
  const { erstelleServer } = await import('../app.mjs');

  const stripe = { webhooks: { constructEvent: () => { throw Error('nicht benutzt'); } } };
  server = erstelleServer({ stripe, webhookSecret: 'whsec_nur_test', base: BASE, abgleichAutomatik: false }).listen(PORT, '127.0.0.1');
  await new Promise(r => server.listening ? r() : server.once('listening', r));

  const pw = 'TestPasswort1!';
  const hash = await passwortHashen(pw);
  const zeit = new Date().toISOString();

  const neuerNutzer = (email) => Number(
    db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt,email_bestaetigt) VALUES(?,?,?,?)")
      .run(email, hash, zeit, Date.now()).lastInsertRowid
  );

  const emailToken = (uid) => {
    const jetzt = Date.now();
    const roh = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM email_aender_token WHERE benutzer_id=?').run(uid);
    db.prepare("INSERT INTO email_aender_token(benutzer_id,neue_email,token_hash,erstellt,laeuft_ab) VALUES(?,?,?,?,?)")
      .run(uid, 'angreifer@example.com', sha256(roh), jetzt - 1000, jetzt + 86400000);
    return roh;
  };

  const resetToken = (uid) => {
    const roh = randomBytes(32).toString('base64url');
    db.prepare("INSERT INTO passwort_token(benutzer_id,token_hash,erstellt,laeuft_ab) VALUES(?,?,?,?)")
      .run(uid, sha256(roh), Date.now(), Date.now() + 1800000);
    return roh;
  };

  const post = async (pfad, body, cookie = '') => {
    const h = { 'Content-Type': 'application/json' };
    if (cookie) h.Cookie = cookie;
    const r = await fetch(`${BASE}${pfad}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
    return r;
  };

  // ---- Teil A: Passwort-Reset löscht email_aender_token ----
  const uid1 = neuerNutzer('opfer1@beispiel.hu');
  emailToken(uid1);
  pruefe('A1: Vor Reset: email_aender_token vorhanden', db.prepare('SELECT COUNT(*) n FROM email_aender_token WHERE benutzer_id=?').get(uid1).n === 1);

  const rt1 = resetToken(uid1);
  const r1 = await post('/api/passwort-zuruecksetzen', { token: rt1, passwort: 'NeuesPasswort1!' });
  pruefe('A2: Passwort-Reset antwortet 200', r1.status === 200, r1.status);
  pruefe('A3: F-96: Passwort-Reset löscht email_aender_token', db.prepare('SELECT COUNT(*) n FROM email_aender_token WHERE benutzer_id=?').get(uid1).n === 0);

  // ---- Teil B: Vollständiges Angriffsszenario über Passwort-Reset ----
  const uid2 = neuerNutzer('opfer2@beispiel.hu');
  const angreiferToken = emailToken(uid2);

  const rt2 = resetToken(uid2);
  await post('/api/passwort-zuruecksetzen', { token: rt2, passwort: 'OpferReset1!' });

  const confirmRes = await post('/api/email-aendern-bestaetigen', { token: angreiferToken });
  pruefe('B1: F-96: Kontoübernahme nach Reset blockiert (400)', confirmRes.status === 400, 'Status: ' + confirmRes.status);

  // ---- Teil C: Passwort-Änderung (eingeloggt) löscht email_aender_token ----
  const uid3 = neuerNutzer('opfer3@beispiel.hu');
  emailToken(uid3);
  pruefe('C1: Vor Änderung: email_aender_token vorhanden', db.prepare('SELECT COUNT(*) n FROM email_aender_token WHERE benutzer_id=?').get(uid3).n === 1);

  const loginR = await post('/api/anmelden', { email: 'opfer3@beispiel.hu', passwort: pw });
  const cookie3 = loginR.headers.get('set-cookie')?.split(';')[0] ?? '';
  pruefe('C2: Anmeldung erfolgreich', loginR.status === 200, loginR.status);

  const aendernR = await post('/api/passwort-aendern', { aktuell: pw, neu: 'NeuesPasswort2!' }, cookie3);
  pruefe('C3: Passwort-Änderung antwortet 200', aendernR.status === 200, aendernR.status);
  pruefe('C4: F-96: Passwort-Änderung löscht email_aender_token', db.prepare('SELECT COUNT(*) n FROM email_aender_token WHERE benutzer_id=?').get(uid3).n === 0);

  // ---- Teil D: F-101: E-Mail-Änderung invalidiert passwort_token ----
  const uid4 = neuerNutzer('opfer4@beispiel.hu');

  // Schritt 1: Reset-Token vorab beantragen (Angreifer kennt noch alte Adresse)
  const rt3 = resetToken(uid4);
  pruefe('D1: Vor E-Mail-Wechsel: passwort_token vorhanden',
    db.prepare('SELECT COUNT(*) n FROM passwort_token WHERE benutzer_id=? AND benutzt IS NULL').get(uid4).n === 1);

  // Schritt 2: E-Mail-Änderung beantragen und bestätigen
  const aenderToken4 = (() => {
    const roh = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM email_aender_token WHERE benutzer_id=?').run(uid4);
    db.prepare("INSERT INTO email_aender_token(benutzer_id,neue_email,token_hash,erstellt,laeuft_ab) VALUES(?,?,?,?,?)")
      .run(uid4, 'neu4@beispiel.hu', sha256(roh), Date.now() - 1000, Date.now() + 86400000);
    return roh;
  })();

  const aenderRes4 = await post('/api/email-aendern-bestaetigen', { token: aenderToken4 });
  pruefe('D2: E-Mail-Wechsel erfolgreich (200)', aenderRes4.status === 200, aenderRes4.status);

  // Schritt 3: Alter Reset-Token darf nicht mehr gültig sein
  const resetVersuch = await post('/api/passwort-zuruecksetzen', { token: rt3, passwort: 'NeuesPw3!' });
  pruefe('D3: F-101: Alter Reset-Token nach E-Mail-Wechsel ungültig (400)', resetVersuch.status === 400, resetVersuch.status);

  pruefe('D4: F-101: passwort_token nach E-Mail-Wechsel als benutzt markiert',
    db.prepare('SELECT COUNT(*) n FROM passwort_token WHERE benutzer_id=? AND benutzt IS NULL').get(uid4).n === 0);

} catch (e) {
  schlecht++;
  console.log('FEHLER Abbruch: ' + (e?.stack || e));
} finally {
  server?.close();
  setTimeout(() => {
    try { rmSync(ordner, { recursive: true, force: true }); } catch { /* Temp */ }
    console.log(`\nemailaender-bereinigung: ${gut} OK, ${schlecht} FEHLER`);
    process.exit(schlecht ? 1 : 0);
  }, 100);
}
