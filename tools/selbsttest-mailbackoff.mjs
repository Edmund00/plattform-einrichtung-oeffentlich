// A8-02 und A8-04 (12.11.2026): Backoff fuer alle (Block 4: neun) Mail-Warteschlangen, Alarm nach Ausschoepfung, Demo-Bremse fuer Betreibermeldungen.
// Offline: Temp-DB, Mock-Mailer, steuerbare Uhr (Option jetzt von mailDienst). Kein Netz, kein Stripe, kein Server-Port.
import './test-sprache.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const ordner = mkdtempSync(join(tmpdir(), 'schulung-mailbackoff-'));
process.env.DB_DATEI = join(ordner, 'test.db');
let gut = 0, schlecht = 0;
const pruefe = (name, ok, info = '') => { ok ? gut++ : schlecht++; console.log((ok ? 'OK     ' : 'FEHLER ') + name + (ok || !info ? '' : ' -> ' + info)); };
const tick = () => new Promise(r => setImmediate(r));
const MIN = 60000, STUNDE = 60 * MIN;
try {
  const { db } = await import('../db.mjs');
  const M = await import('../mail.mjs'); const { mailDienst, kaufVormerken, MAIL_MAX_VERSUCHE } = M;
  // Eigene Erwartungswerte (Gegenprobe gegen alten Code laeuft so bis zu den Verhaltenspruefungen durch).
  const MAIL_TABELLEN = ['mail_ausgang', 'email_ausgang', 'gratis_mail_ausgang', 'konto_mail_ausgang', 'abo_kuendigung_mail', 'meldung_ausgang', 'ellallas_mail', 'abo_erstattung_mail', 'zugang_mail_ausgang'];   // Block 4: neunte Warteschlange
  const MAIL_WARTE_MINUTEN = [1, 5, 15, 60, 240], DEMO_MELDUNG_JE_STUNDE = 60, DEMO_MELDUNG_JE_TAG = 300;
  pruefe('Exporte stimmen mit den Erwartungen ueberein', String(M.MAIL_TABELLEN) === String(MAIL_TABELLEN) && String(M.MAIL_WARTE_MINUTEN) === String(MAIL_WARTE_MINUTEN) && M.DEMO_MELDUNG_JE_STUNDE === 60 && M.DEMO_MELDUNG_JE_TAG === 300);
  const { alarmDienst } = await import('../sicherung-alarm.mjs');
  const { HU } = await import('../texte.mjs');
  const base = 'http://127.0.0.1:4431';
  const iso = new Date().toISOString();

  // ---- Migration: alle neun Tabellen haben die neue Spalte -------------------------------------------------------------
  for (const t of MAIL_TABELLEN) pruefe('Migration: ' + t + ' hat naechster_versuch', db.prepare('PRAGMA table_info(' + t + ')').all().some(s => s.name === 'naechster_versuch'));
  pruefe('Konstanten: 5 Versuche', MAIL_MAX_VERSUCHE === 5);

  // ---- Testdaten: je Tabelle genau ein offener Auftrag ------------------------------------------------------------------
  const uid = Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt) VALUES('backoff@example.org','x',?)").run(iso).lastInsertRowid);
  const kid = Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES('Backoff-Kurs','',1000,'huf','veroeffentlicht',?,?)").run(iso, iso).lastInsertRowid);
  const bestellung = (n) => Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert) VALUES(?,?,?,?,1000,'huf','bezahlt',?,?)").run('cs_backoff_' + n, 'pi_backoff_' + n, uid, kid, iso, iso).lastInsertRowid);
  const b1 = bestellung(1), b2 = bestellung(2), b3 = bestellung(3);
  kaufVormerken(uid, b1);
  db.prepare("INSERT INTO email_ausgang(benutzer_id,status,versuche,erstellt,geaendert) VALUES(?,'offen',0,?,?)").run(uid, Date.now(), Date.now());
  db.prepare("INSERT INTO gratis_mail_ausgang(benutzer_id,kurs_id,status,versuche,erstellt,geaendert) VALUES(?,?,'offen',0,?,?)").run(uid, kid, Date.now(), Date.now());
  db.prepare("INSERT INTO konto_mail_ausgang(benutzer_id,empfaenger,typ,erstellt) VALUES(?,'backoff@example.org','konto_geloescht',?)").run(uid, Date.now());
  const abo = Number(db.prepare("INSERT INTO abos(stripe_abo,benutzer_id,kurs_id,status,erstellt,geaendert) VALUES('sub_backoff',?,?,'gekuendigt',?,?)").run(uid, kid, iso, iso).lastInsertRowid);
  db.prepare('INSERT INTO abo_kuendigung_mail(abo_id,benutzer_id,kurs_id,erfasst,ende) VALUES(?,?,?,?,?)').run(abo, uid, kid, Date.now(), Date.now() + 86400000);
  const eid = Number(db.prepare("INSERT INTO ereignisse(zeit,typ,kurs_id,kurs_titel,betrag,waehrung,email,status,quelle_id) VALUES(?,'gekauft',?,'Backoff-Kurs',10,'huf','backoff@example.org','bezahlt','backoff-1')").run(Date.now(), kid).lastInsertRowid);
  db.prepare("INSERT INTO meldung_ausgang(ereignis_id,status,versuche,geaendert) VALUES(?,'offen',0,?)").run(eid, Date.now());
  db.prepare("INSERT INTO ellallas(bestellung_id,zeit,ergebnis,aktualisiert) VALUES(?,?,'erstattung',?)").run(b2, iso, iso);
  db.prepare("INSERT INTO ellallas_mail(bestellung_id,empfaenger) VALUES(?,'kunde')").run(b2);
  db.prepare("INSERT INTO abo_erstattung_mail(bestell_id,refund_id,betrag) VALUES(?,'re_backoff',500)").run(b3);
  db.prepare("INSERT INTO zugang_mail_ausgang(benutzer_id,kurs_id,status,versuche,erstellt,geaendert) VALUES(?,?,'offen',0,?,?)").run(uid, kid, Date.now(), Date.now());

  let uhr = Date.now(), mailOk = false;
  const sendungen = [], alarme = [];
  const mailer = async (m) => { sendungen.push(m); return mailOk; };
  const dienst = mailDienst({ mailer, base, verkaufsmeldungMail: 'betreiber@example.org', jetzt: () => uhr, alarm: async (g) => { alarme.push(g); return true; } });
  const alle = async () => { for (const f of ['ausgangSenden', 'emailAusgangSenden', 'gratisAusgangSenden', 'kontoAusgangSenden', 'aboKuendigungAusgangSenden', 'meldungAusgangSenden', 'ellallasAusgangSenden', 'aboErstattungAusgangSenden', 'zugangAusgangSenden']) await dienst[f](); await tick(); };
  const hatSpalte = (t) => db.prepare('PRAGMA table_info(' + t + ')').all().some(x => x.name === 'naechster_versuch');
  const stand = () => Object.fromEntries(MAIL_TABELLEN.map(t => [t, db.prepare('SELECT status,versuche,' + (hatSpalte(t) ? 'naechster_versuch' : 'NULL AS naechster_versuch') + ' FROM ' + t + ' ORDER BY id LIMIT 1').get()]));
  const alleGleich = (s, f) => MAIL_TABELLEN.every(t => f(s[t]));

  // ---- Versuch 1 schlaegt fehl: offen, spaeterer Zeitpunkt ----------------------------------------------------------
  await alle();
  let s = stand();
  pruefe('Versuch 1 in allen neun Warteschlangen (ein Mailer-Aufruf je Tabelle)', sendungen.length === MAIL_TABELLEN.length && alleGleich(s, z => z.versuche === 1 && z.status === 'offen'), JSON.stringify(s));
  pruefe('Nach Versuch 1: naechster_versuch = jetzt + 1 Minute', alleGleich(s, z => z.naechster_versuch === uhr + MIN), JSON.stringify(s));
  // ---- vor dem Zeitpunkt: KEIN neuer Versuch (vorher: sofort, 5 Anstoesse = endgueltig fehler) -------------------------
  for (let i = 0; i < 6; i++) { uhr += 5000; await alle(); }
  s = stand();
  pruefe('Sechs Anstoesse vor Fristende: kein weiterer Versuch, nichts gesendet', sendungen.length === MAIL_TABELLEN.length && alleGleich(s, z => z.versuche === 1 && z.status === 'offen'), JSON.stringify(s));
  // ---- nach dem Zeitpunkt: ja; Wartezeiten wachsen ---------------------------------------------------------------------
  for (let versuch = 2; versuch <= 4; versuch++) {
    const frist = Math.max(...MAIL_TABELLEN.map(t => s[t].naechster_versuch));
    uhr = frist - 1000; await alle();
    pruefe('Versuch ' + versuch + ': eine Sekunde vor der Frist noch nicht', alleGleich(stand(), z => z.versuche === versuch - 1));
    uhr = frist; await alle(); s = stand();
    pruefe('Versuch ' + versuch + ': ab der Frist neu versucht, Wartezeit jetzt ' + MAIL_WARTE_MINUTEN[versuch - 1] + ' Minuten',
      alleGleich(s, z => z.versuche === versuch && z.status === 'offen' && z.naechster_versuch === uhr + MAIL_WARTE_MINUTEN[versuch - 1] * MIN), JSON.stringify(s));
  }
  pruefe('Bis hier kein Alarm', alarme.length === 0);
  // ---- Ausschoepfung: fehler + genau ein Alarm je Auftrag ---------------------------------------------------------------
  uhr = Math.max(...MAIL_TABELLEN.map(t => s[t].naechster_versuch)); await alle(); s = stand();
  pruefe('Versuch 5 schlaegt fehl: alle neun Auftraege dauerhaft fehler', alleGleich(s, z => z.versuche === 5 && z.status === 'fehler'), JSON.stringify(s));
  pruefe('Genau ein Alarm je ausgeschoepftem Auftrag (9), Grund ausgang', alarme.length === MAIL_TABELLEN.length && alarme.every(g => g === 'ausgang'), JSON.stringify(alarme));
  pruefe('Konto-Mail: Empfaenger nach Ausschoepfung entfernt (Datensparsamkeit wie vorher)', db.prepare('SELECT empfaenger FROM konto_mail_ausgang').get().empfaenger === null);
  const nachAus = sendungen.length;
  uhr += 30 * 86400000; for (let i = 0; i < 3; i++) await alle();
  pruefe('Nach Ausschoepfung: keine weiteren Versuche und kein weiterer Alarm (keine Schleife)', sendungen.length === nachAus && alarme.length === MAIL_TABELLEN.length);

  // ---- Erfolg setzt gesendet (auch nach einem Fehlversuch) --------------------------------------------------------------
  const b4 = bestellung(4); kaufVormerken(uid, b4);
  const zeile4 = () => db.prepare('SELECT status,versuche FROM mail_ausgang WHERE bestellung_id=?').get(b4);
  await dienst.ausgangSenden();
  pruefe('Neuer Kaufauftrag: erster Versuch sofort (keine Verzoegerung im Normalfall)', zeile4().versuche === 1 && zeile4().status === 'offen');
  mailOk = true; uhr += MIN; await dienst.ausgangSenden();
  pruefe('Erfolg im zweiten Versuch: Status gesendet', zeile4().status === 'gesendet' && zeile4().versuche === 2);
  const b5 = bestellung(5); kaufVormerken(uid, b5); await dienst.ausgangSenden();
  pruefe('Erfolg im ersten Versuch: gesendet', db.prepare('SELECT status,versuche FROM mail_ausgang WHERE bestellung_id=?').get(b5).status === 'gesendet');
  mailOk = false;

  // ---- A8-06: Absturz waehrend des fuenften Versuchs ------------------------------------------------------------------
  const b6 = bestellung(6); kaufVormerken(uid, b6);
  db.prepare("UPDATE mail_ausgang SET versuche=5,naechster_versuch=? WHERE bestellung_id=?").run(uhr + 240 * MIN, b6);
  const vorA = alarme.length; await dienst.ausgangSenden(); await tick();
  pruefe('Haengender Auftrag (versuche=5, Schutzfrist laeuft): bleibt offen, kein Alarm', db.prepare('SELECT status FROM mail_ausgang WHERE bestellung_id=?').get(b6).status === 'offen' && alarme.length === vorA);
  uhr += 240 * MIN; await dienst.ausgangSenden(); await tick();
  pruefe('Nach der Schutzfrist: fehler und ein Alarm (vorher: still verloren)', db.prepare('SELECT status FROM mail_ausgang WHERE bestellung_id=?').get(b6).status === 'fehler' && alarme.length === vorA + 1);

  // ---- Echter Alarmweg: Drossel des Alarmdienstes -> eine Alarmmail fuer mehrere Ausfaelle -----------------------------
  const alarmPost = [];
  const echt = alarmDienst({ mailer: async (m) => { alarmPost.push(m); return true; }, adressen: ['alarm@example.org'] });
  const d2 = mailDienst({ mailer: async () => false, base, jetzt: () => uhr,
    alarm: (g) => echt(g, { praefix: 'mail', betreff: HU.mail_alarm_betreff, fehler: HU.mail_alarm_fehler, teendo: HU.mail_alarm_teendo }) });
  const b7 = bestellung(7), b8 = bestellung(8); kaufVormerken(uid, b7); kaufVormerken(uid, b8);
  for (let i = 0; i < 5; i++) { await d2.ausgangSenden(); uhr += 5 * STUNDE; }
  for (let i = 0; i < 5; i++) await tick();
  await new Promise(r => setTimeout(r, 50));
  pruefe('Zwei Kaufmails ausgeschoepft', ['fehler', 'fehler'].join() === [b7, b8].map(b => db.prepare('SELECT status FROM mail_ausgang WHERE bestellung_id=?').get(b).status).join());
  pruefe('Alarmdienst: genau EINE Alarmmail an die Alarm-Adresse, Betreff Mail-Alarm', alarmPost.length === 1 && alarmPost[0].to === 'alarm@example.org' && alarmPost[0].subject === HU.mail_alarm_betreff && alarmPost[0].text.includes(HU.mail_alarm_teendo), JSON.stringify(alarmPost.map(m => m.subject)));
  pruefe('Alarmmail enthaelt keine Kundenadresse', !JSON.stringify(alarmPost).includes('backoff@example.org'));

  // ---- A8-04: Demo-Bremse fuer Betreibermeldungen ----------------------------------------------------------------------
  db.exec('DELETE FROM meldung_ausgang');
  let ereignisNr = 100;
  const ereignisse = (n) => { for (let i = 0; i < n; i++) { const id = Number(db.prepare("INSERT INTO ereignisse(zeit,typ,kurs_id,kurs_titel,betrag,waehrung,email,status,quelle_id) VALUES(?,'gekauft',?,'Demo-Kurs',10,'eur','demo-1@example.com','bezahlt',?)").run(uhr, kid, 'demo-' + (ereignisNr++)).lastInsertRowid); db.prepare("INSERT INTO meldung_ausgang(ereignis_id,status,versuche,geaendert) VALUES(?,'offen',0,?)").run(id, uhr); } };
  const demoPost = [];
  const demo = mailDienst({ mailer: async (m) => { demoPost.push(m); return true; }, base, verkaufsmeldungMail: 'betreiber@example.org', demoModus: true, jetzt: () => uhr });
  const leeren = async () => { for (let i = 0; i < 30; i++) await demo.meldungAusgangSenden(); };
  const einzel = () => demoPost.filter(m => !m.idempotencyKey.includes('-sammel-')).length;
  const sammel = () => demoPost.filter(m => m.idempotencyKey.includes('-sammel-'));
  ereignisse(1); await demo.meldungAusgangSenden();
  pruefe('Demo: normaler Testkauf -> sofort genau eine Betreibermail', einzel() === 1 && sammel().length === 0);
  ereignisse(DEMO_MELDUNG_JE_STUNDE + 9); await leeren();
  pruefe('Demo: in einer Stunde hoechstens ' + DEMO_MELDUNG_JE_STUNDE + ' Betreibermails', einzel() === DEMO_MELDUNG_JE_STUNDE, String(einzel()));
  pruefe('Demo: unterdrueckte Auftraege als erledigt markiert (unterdrueckt=1), keiner bleibt offen',
    db.prepare('SELECT COUNT(*) n FROM meldung_ausgang WHERE unterdrueckt=1').get().n === 10 && db.prepare("SELECT COUNT(*) n FROM meldung_ausgang WHERE status='offen'").get().n === 0);
  pruefe('Demo: Sammelmeldung noch nicht sofort (sie fasst eine Stunde zusammen)', sammel().length === 0);
  uhr += 20 * MIN; ereignisse(5); await leeren();
  pruefe('Demo: weitere Meldungen in derselben Stunde: nicht gesendet, noch keine Sammelmeldung', einzel() === DEMO_MELDUNG_JE_STUNDE && sammel().length === 0);
  uhr += 41 * MIN; ereignisse(1); await leeren();
  pruefe('Demo: nach einer Stunde genau EINE Sammelmeldung "15 weitere zurueckgehalten" an den Betreiber',
    sammel().length === 1 && sammel()[0].subject === HU.mail_meldung_unterdrueckt_betreff.replace('{anzahl}', '15') && sammel()[0].to === 'betreiber@example.org', JSON.stringify(sammel().map(m => m.subject)));
  pruefe('Demo: nach einer Stunde wieder normale Meldungen', einzel() === DEMO_MELDUNG_JE_STUNDE + 1, String(einzel()));
  for (let i = 0; i < 3; i++) await demo.meldungAusgangSenden();
  pruefe('Demo: wiederholter Anstoss ohne neue Unterdrueckung: keine weitere Sammelmeldung', sammel().length === 1);
  // Tagesgrenze: Stunden mit vollem Kontingent bis zur Tagesgrenze, danach bleibt es zu, hoechstens eine Sammelmeldung je Stunde.
  for (let h = 0; h < 6; h++) { uhr += STUNDE; ereignisse(DEMO_MELDUNG_JE_STUNDE); await leeren(); }
  pruefe('Demo: in 24 Stunden hoechstens ' + DEMO_MELDUNG_JE_TAG + ' Betreibermails', einzel() === DEMO_MELDUNG_JE_TAG, String(einzel()));
  const zeiten = sammel().map(m => Number(m.idempotencyKey.split('-').pop()));
  pruefe('Demo: Sammelmeldungen hoechstens eine je Stunde', zeiten.every((z, i) => i === 0 || z - zeiten[i - 1] >= STUNDE), JSON.stringify(zeiten));
  // Normalbetrieb ausserhalb der Demo: keine Grenze.
  db.exec('DELETE FROM meldung_ausgang');
  const normalPost = [];
  const normal = mailDienst({ mailer: async (m) => { normalPost.push(m); return true; }, base, verkaufsmeldungMail: 'betreiber@example.org', jetzt: () => uhr });
  ereignisse(DEMO_MELDUNG_JE_STUNDE + 20); for (let i = 0; i < 10; i++) await normal.meldungAusgangSenden();
  pruefe('Normalbetrieb: alle ' + (DEMO_MELDUNG_JE_STUNDE + 20) + ' Meldungen gesendet, keine Sammelmeldung, nichts unterdrueckt',
    normalPost.length === DEMO_MELDUNG_JE_STUNDE + 20 && !normalPost.some(m => m.idempotencyKey.includes('-sammel-')) && db.prepare('SELECT COUNT(*) n FROM meldung_ausgang WHERE unterdrueckt=1').get().n === 0);
  pruefe('Texte vorhanden (hu): Mail-Alarm und Sammelmeldung', ['mail_alarm_betreff', 'mail_alarm_fehler', 'mail_alarm_teendo', 'mail_meldung_unterdrueckt_betreff', 'mail_meldung_unterdrueckt_text'].every(k => typeof HU[k] === 'string' && HU[k].length > 5));
  db.close();

  // ---- Migration einer ALTEN Datenbank (ohne Spalte): alte Zeile bleibt gueltig und wird versendet --------------------
  const altDatei = join(ordner, 'alt.db');
  const alt = new DatabaseSync(altDatei);
  alt.exec(`CREATE TABLE ereignisse (id INTEGER PRIMARY KEY AUTOINCREMENT, zeit INTEGER NOT NULL, typ TEXT NOT NULL CHECK(typ IN ('registriert','bestaetigt','gekauft','erstattet','abo_gestartet','abo_beendet','abo_gekuendigt','geloescht')), kurs_id INTEGER, kurs_titel TEXT, betrag INTEGER, waehrung TEXT, email TEXT, status TEXT, quelle_id TEXT NOT NULL, UNIQUE(typ,quelle_id));
    CREATE TABLE meldung_ausgang (id INTEGER PRIMARY KEY AUTOINCREMENT, ereignis_id INTEGER NOT NULL UNIQUE REFERENCES ereignisse(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','gesendet','fehler')), versuche INTEGER NOT NULL DEFAULT 0 CHECK(versuche BETWEEN 0 AND 5), geaendert INTEGER NOT NULL);
    INSERT INTO ereignisse(zeit,typ,kurs_titel,email,status,quelle_id) VALUES(1000,'gekauft','Alt','alt@example.org','bezahlt','alt-1');
    INSERT INTO meldung_ausgang(ereignis_id,status,versuche,geaendert) VALUES(1,'offen',2,1000);`);
  alt.close();
  const kind = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e',
    "await import('./tools/test-sprache.mjs');const {db}=await import('./db.mjs');const {mailDienst}=await import('./mail.mjs');let n=0;" +
    "const d=mailDienst({mailer:async()=>{n++;return true},base:'http://127.0.0.1:4432',verkaufsmeldungMail:'b@example.org'});await d.meldungAusgangSenden();" +
    "console.log(JSON.stringify({sp:db.prepare('PRAGMA table_info(meldung_ausgang)').all().map(x=>x.name),z:db.prepare('SELECT status,versuche,unterdrueckt FROM meldung_ausgang').get(),n}));"],
    { cwd: new URL('..', import.meta.url), env: { ...process.env, DB_DATEI: altDatei }, encoding: 'utf8' });
  let erg = null; try { erg = JSON.parse(kind.stdout.trim().split('\n').pop()); } catch { /* unten gemeldet */ }
  pruefe('Alte DB: Spalten naechster_versuch und unterdrueckt ergaenzt', !!erg && erg.sp.includes('naechster_versuch') && erg.sp.includes('unterdrueckt'), kind.stderr.slice(0, 300));
  pruefe('Alte DB: offener Altauftrag (naechster_versuch NULL) sofort faellig und versendet', !!erg && erg.n === 1 && erg.z.status === 'gesendet' && erg.z.versuche === 3 && erg.z.unterdrueckt === 0, JSON.stringify(erg));
} catch (e) {
  schlecht++; console.log('FEHLER Abbruch: ' + (e?.stack || e));
} finally {
  try { rmSync(ordner, { recursive: true, force: true }); } catch { /* Temp-Ordner */ }
}
console.log(`\nmailbackoff: ${gut} OK, ${schlecht} FEHLER`);
process.exit(schlecht ? 1 : 0);
