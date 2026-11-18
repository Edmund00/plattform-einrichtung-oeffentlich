import './test-sprache.mjs';
// Gesamtpruefung Block 2 (Angreifer-Fund P3): ein GEKUENDIGTES Abo mit noch laufender Restzeit zaehlt als Besitz des Kurses, eine weitere Abo-Zahlung
// waere sonst unbemerkt doppelt. Ein beendetes oder abgelaufenes Abo zaehlt nicht. Direkter Test von kursSchonBezahlt (Temp-DB, kein Server).
import { mkdtempSync } from 'node:fs'; import { join } from 'node:path'; import { tmpdir } from 'node:os';
process.env.DB_DATEI = join(mkdtempSync(join(tmpdir(), 'schulung-aboschutz-')), 'test.db');
let ok = 0, fail = 0; const check = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + d)); };
try {
  const { db } = await import('../db.mjs'); const { kursSchonBezahlt } = await import('../abo.mjs');
  const z = new Date().toISOString();
  const kurs = Number(db.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES ('K','',1000,'eur','veroeffentlicht',?,?)").run(z, z).lastInsertRowid);
  const user = (e) => Number(db.prepare('INSERT INTO benutzer (email,passwort_hash,erstellt,email_bestaetigt) VALUES (?,?,?,?)').run(e, 'x', z, Date.now()).lastInsertRowid);
  const abo = (u, id, status, bis) => { db.prepare('INSERT INTO abos (stripe_abo,benutzer_id,kurs_id,status,gueltig_bis,erstellt,geaendert) VALUES (?,?,?,?,?,?,?)').run(id, u, kurs, status, bis, z, z);
    db.prepare("INSERT INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert,art,stripe_abo) VALUES (?,?,?,?,1000,'eur','bezahlt',?,?,'abo',?)").run('cs_' + id, 'pi_' + id, u, kurs, z, z, id); };
  const zukunft = Date.now() + 10 * 86400000, vergangen = Date.now() - 86400000;
  const a = user('a@example.net'); abo(a, 'sub_aktiv', 'aktiv', zukunft);
  check('laufendes bezahltes Abo zaehlt als Besitz', kursSchonBezahlt(a, kurs) === true);
  check('das gerade verarbeitete Abo selbst zaehlt nicht (ohneAbo)', kursSchonBezahlt(a, kurs, { ohneAbo: 'sub_aktiv' }) === false);
  const g = user('g@example.net'); abo(g, 'sub_gek', 'gekuendigt', zukunft);
  check('GEKUENDIGTES Abo mit Restlaufzeit zaehlt als Besitz (sonst unbemerkte Doppelzahlung)', kursSchonBezahlt(g, kurs) === true);
  const ga = user('ga@example.net'); abo(ga, 'sub_gek_alt', 'gekuendigt', vergangen);
  check('gekuendigtes Abo OHNE Restlaufzeit zaehlt nicht (berechtigter Neukauf)', kursSchonBezahlt(ga, kurs) === false);
  const b = user('b@example.net'); abo(b, 'sub_end', 'beendet', zukunft);
  check('beendetes Abo zaehlt nicht', kursSchonBezahlt(b, kurs) === false);
} catch (e) { fail++; console.log('FEHLER Ausnahme: ' + String(e.stack || e).slice(0, 400)); }
console.log(`Aboschutz: ${ok} bestanden, ${fail} fehlgeschlagen`); process.exit(fail ? 1 : 0);
