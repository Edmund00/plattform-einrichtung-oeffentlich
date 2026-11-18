// Hintergrundmails in der Sprache des Kunden: Kaufmail, Widerrufsmail und Gratis-Mail werden aus der Warteschlange OHNE Sprachkontext gesendet
// (wie nach einem Neustart oder aus dem Timer) und muessen die gespeicherte Bestell- bzw. Kontosprache verwenden. Fallback Standardsprache bei fehlender Sprache.
import './test-sprache.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ordner = mkdtempSync(join(tmpdir(), 'schulung-mailsprache-'));
process.env.DB_DATEI = join(ordner, 'test.db');
let ok = 0, fail = 0;
const pruefe = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' ' + String(d).slice(0, 300))); };
const gesendet = [];
const mailer = async (m) => { gesendet.push(m); return true; };
// Funktionswoerter je Sprache: eine Mail in Sprache X darf keine Woerter der anderen Sprachen enthalten.
const WORTE = { de: [' und ', ' der ', ' nicht ', ' ist ', ' für ', ' Ihre ', ' deine '], en: [' the ', ' and ', ' your ', ' with ', ' you ', ' has '], hu: [' és ', ' nem ', ' hogy ', ' egy ', ' van ', ' vagy '] };
const fremd = (text, l) => Object.entries(WORTE).filter(([k]) => k !== l).flatMap(([, w]) => w.filter((x) => (' ' + text + ' ').toLowerCase().includes(x.toLowerCase())));
try {
  const { db } = await import('../db.mjs');
  const { mailDienst, kaufVormerken } = await import('../mail.mjs');
  const { demoUebersetzungAn } = await import('../demo-uebersetzung.mjs');
  demoUebersetzungAn(true);
  const { KURSE } = await import('../demo-daten.mjs');
  const zeit = new Date().toISOString();
  const k = KURSE[2];
  const kurs = Number(db.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert,nutzen) VALUES (?,?,?,'eur','veroeffentlicht',?,?,?)").run(k.titel, k.beschreibung, k.preis, zeit, zeit, k.nutzen).lastInsertRowid);
  const benutzer = (email, l) => Number(db.prepare('INSERT INTO benutzer (email,passwort_hash,erstellt,email_bestaetigt,sprache) VALUES (?,?,?,?,?)').run(email, 'x', zeit, Date.now(), l).lastInsertRowid);
  const bestellung = (b, l, nr) => Number(db.prepare("INSERT INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert,sprache) VALUES (?,?,?,?,14900,'eur','bezahlt',?,?,?)").run('cs_t_' + nr, 'pi_t_' + nr, b, kurs, zeit, zeit, l).lastInsertRowid);
  const dienst = mailDienst({ mailer, base: 'http://localhost:4481', anbieter: {} });
  for (const l of ['en', 'hu', 'de']) {
    const b = benutzer('mail-' + l + '@example.net', l);
    const best = bestellung(b, l, l);
    gesendet.length = 0;
    kaufVormerken(b, best, 'kauf');
    await dienst.ausgangSenden();     // OHNE mitSprache-Kontext, wie aus dem Timer
    const m = gesendet.find((x) => x.to === 'mail-' + l + '@example.net');
    pruefe('Kaufmail [' + l + '] gesendet', !!m);
    if (m) {
      const text = m.subject + ' ' + (m.text || '');
      pruefe('Kaufmail [' + l + ']: html lang=' + l, new RegExp('<html lang="' + l + '"').test(m.html || ''), (m.html || '').slice(0, 80));
      pruefe('Kaufmail [' + l + ']: keine Woerter anderer Sprachen', fremd(text, l).length === 0, fremd(text, l).join(','));
      if (l !== 'de') pruefe('Kaufmail [' + l + ']: Kurstitel uebersetzt', !/Kundenbetreuung/.test(text), text.slice(0, 200));
    }
    // Widerrufsmail (Kunde)
    db.prepare("INSERT INTO ellallas (bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES (?,?,'erstattung',NULL,?)").run(best, zeit, zeit);
    db.prepare("INSERT INTO ellallas_mail (bestellung_id,empfaenger) VALUES (?,'kunde')").run(best);
    gesendet.length = 0;
    await dienst.ellallasAusgangSenden();
    const w = gesendet.find((x) => x.to === 'mail-' + l + '@example.net');
    pruefe('Widerrufsmail [' + l + '] gesendet', !!w);
    if (w) { const text = w.subject + ' ' + (w.text || ''); pruefe('Widerrufsmail [' + l + ']: keine Woerter anderer Sprachen', fremd(text, l).length === 0, fremd(text, l).join(',') + ' | ' + text.slice(0, 160)); }
    // Gratis-Mail (Kontosprache)
    db.prepare('INSERT INTO gratis_mail_ausgang (benutzer_id,kurs_id,erstellt,geaendert) VALUES (?,?,?,?)').run(b, kurs, Date.now(), Date.now());
    gesendet.length = 0;
    await dienst.gratisAusgangSenden();
    const g = gesendet.find((x) => x.to === 'mail-' + l + '@example.net');
    pruefe('Gratis-Mail [' + l + '] gesendet', !!g);
    if (g) { const text = g.subject + ' ' + (g.text || ''); pruefe('Gratis-Mail [' + l + ']: keine Woerter anderer Sprachen', fremd(text, l).length === 0, fremd(text, l).join(',')); }
  }
  // Ohne gespeicherte Sprache: Deutsch
  const b0 = benutzer('mail-keine@example.net', null);
  const best0 = bestellung(b0, null, 'keine');
  gesendet.length = 0;
  kaufVormerken(b0, best0, 'kauf');
  await dienst.ausgangSenden();
  const m0 = gesendet.find((x) => x.to === 'mail-keine@example.net');
  const { STANDARD_SPRACHE } = await import('../texte.mjs');
  pruefe('Ohne gespeicherte Sprache: Standardsprache (' + STANDARD_SPRACHE + '; in Produktion Deutsch)', !!m0 && new RegExp('<html lang="' + STANDARD_SPRACHE + '"').test(m0.html || ''), (m0?.html || '').slice(0, 80));
} catch (e) { fail++; console.log('FEHLER Ausnahme: ' + (e?.stack || e).toString().slice(0, 500)); }
console.log(`Mailsprache: ${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
