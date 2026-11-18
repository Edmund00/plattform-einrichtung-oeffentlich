// Plattform-Zeilen (Kunden-Abos, Zahlungen): Trigger, frisch gebaute Zeilen, Versand, Wiederholung, Aenderung waehrend des Sendens.
// Echte Datenbank (temporaer), fetch als Attrappe, nie echtes Google.
import './test-sprache.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const ordner = mkdtempSync(join(tmpdir(), 'schulung-zeilen-'));
process.env.DB_DATEI = join(ordner, 'test.db');
let ok = 0, fehler = 0;
const pruefe = (name, wert, detail = '') => { wert ? ok++ : fehler++; console.log((wert ? 'OK     ' : 'FEHLER ') + name + (!wert && detail ? ' ' + detail : '')); };
const alteWarn = console.warn; const logs = []; console.warn = (...a) => { logs.push(a.join(' ')); };
const URL_OK = 'https://script.google.com/macros/s/AKfycbxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/exec';
const KEY = 'schluessel_nur_fuer_tests_0123456789';
// Kopfzeilen der Sheet-Reiter (Stand 03.11.2026): jeder gesendete Spaltenname muss darin vorkommen
const KOEPFE = {
  'Auszahlungen': ['Datum', 'Betrag', 'Währung', 'Status', 'Test/Live', 'Zeilenschlüssel'],
  'Probleme': ['Datum', 'Art', 'Kunde', 'Grund', 'Betrag', 'Währung', 'Gebühr', 'Stand', 'Stripe-Link', 'Kurs', 'Zahlung (Datum)', 'Test/Live', 'Zeilenschlüssel'],
  'Kunden-Abos': ['Kunde', 'E-Mail', 'Kurs', 'Art (Kauf/Abo)', 'Status', 'Betrag', 'Währung', 'Seit', 'Bezahlt bis / nächste Abbuchung', 'Test/Live', 'Zeilenschlüssel'],
  'Zahlungen': ['Datum', 'Kunde', 'Kurs', 'Brutto', 'Gebühr', 'Netto', 'Währung', 'Status', 'Stripe-Beleg-Link', 'Test/Live', 'Zeilenschlüssel'],
};
try {
  const { db } = await import('../db.mjs');
  const { plattformMeldung } = await import('../plattform-meldung.mjs');
  const { ereignisPlattformSetzen } = await import('../ereignis-liste.mjs');
  const { alleVormerken, zeileBauen } = await import('../plattform-zeilen.mjs');
  const iso = () => new Date().toISOString();
  const kurs = Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES ('Testkurs Üzlet','',499000,'huf','veroeffentlicht',?,?)").run(iso(), iso()).lastInsertRowid);
  const user = Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt) VALUES ('anna.nagy@example.com','GEHEIMER_HASH',?)").run(iso()).lastInsertRowid);
  const user2 = Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt) VALUES ('ohne.name@example.com','GEHEIMER_HASH',?)").run(iso()).lastInsertRowid);
  const zeilen = () => db.prepare('SELECT blatt,schluessel,status FROM plattform_zeilen ORDER BY id').all();

  // ---- Meldung AUS: keine Trigger, nichts vorgemerkt -----------------------------------------------------------------------
  plattformMeldung({});
  db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES ('cs_aus',?,?,499000,'huf','bezahlt','einmal',?,?)").run(user, kurs, iso(), iso());
  pruefe('Meldung aus: keine Trigger, plattform_zeilen bleibt leer', zeilen().length === 0 && db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'plattform_t_%'").get().n === 0);
  db.prepare("DELETE FROM bestellungen WHERE stripe_sitzung='cs_aus'").run();

  // ---- Meldung AN ------------------------------------------------------------------------------------------------------------
  let uhr = 1_800_000_000_000; const jetzt = () => uhr;
  let aufrufe = [], antwort = { ok: true }, waehrendSenden = null;
  const fetchAttrappe = async (url, opt) => {
    aufrufe.push({ url, opt, body: JSON.parse(opt.body) });
    if (waehrendSenden) { const f = waehrendSenden; waehrendSenden = null; f(); }
    if (antwort === 'netz') throw new Error('Netz');
    return { text: async () => JSON.stringify(antwort) };
  };
  const p = plattformMeldung({ url: URL_OK, schluessel: KEY, modus: 'Test', fetchFn: fetchAttrappe, jetzt });
  ereignisPlattformSetzen(p);
  pruefe('Meldung an: Trigger sind angelegt', db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'plattform_t_%'").get().n === 5);

  db.prepare('UPDATE benutzer SET anzeigename=?,rechnung_name=? WHERE id=?').run('Anna', 'Nagy Anna', user);
  const kauf = Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES ('cs_1','pi_1',?,?,499000,'huf','bezahlt','einmal',?,?)").run(user, kurs, iso(), iso()).lastInsertRowid);
  const abo = Number(db.prepare("INSERT INTO abos(stripe_abo,stripe_sitzung,benutzer_id,kurs_id,status,gueltig_bis,endet_zum_periodenende,erstellt,geaendert) VALUES ('sub_1','cs_abo',?,?,'aktiv',1800864000000,0,?,?)").run(user, kurs, iso(), iso()).lastInsertRowid);
  const zahlungAbo = Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,stripe_abo,erstellt,geaendert) VALUES ('in_1','pi_2',?,?,299000,'huf','bezahlt','abo','sub_1',?,?)").run(user2, kurs, iso(), iso()).lastInsertRowid);
  const sl = zeilen().map((z) => z.blatt + '/' + z.schluessel).sort();
  pruefe('Trigger: Kauf -> Zahlung + Kunden-Abos(kauf); Abo -> Kunden-Abos(abo); Abo-Zahlung -> Zahlung + Abo-Zeile',
    JSON.stringify(sl) === JSON.stringify(['Kunden-Abos/abo:' + abo, 'Kunden-Abos/kauf:' + kauf, 'Zahlungen/zahlung:' + kauf, 'Zahlungen/zahlung:' + zahlungAbo].sort()), JSON.stringify(sl));

  // ---- Zeilen bauen -----------------------------------------------------------------------------------------------------------
  const wKauf = zeileBauen('Kunden-Abos', 'kauf:' + kauf, 'Test');
  pruefe('Kauf-Zeile: Name, E-Mail, Kurs, Art, Status, Betrag in ganzen Einheiten, Waehrung gross', wKauf.Kunde === 'Nagy Anna' && wKauf['E-Mail'] === 'anna.nagy@example.com' && wKauf.Kurs === 'Testkurs Üzlet' && wKauf['Art (Kauf/Abo)'] === 'Kauf' && wKauf.Status === 'bezahlt' && wKauf.Betrag === 4990 && wKauf['Währung'] === 'HUF' && wKauf['Test/Live'] === 'Test', JSON.stringify(wKauf));
  const wAbo = zeileBauen('Kunden-Abos', 'abo:' + abo, 'Test');
  pruefe('Abo-Zeile: Art Abo, Status aktiv, Betrag aus letzter Abo-Zahlung, bezahlt bis als Datum', wAbo['Art (Kauf/Abo)'] === 'Abo' && wAbo.Status === 'aktiv' && wAbo.Betrag === 2990 && /^\d{4}-\d\d-\d\d$/.test(wAbo['Bezahlt bis / nächste Abbuchung']) && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(wAbo.Seit), JSON.stringify(wAbo));
  db.prepare("UPDATE kurse SET abo_preis_cent=399000 WHERE id=?").run(kurs);
  const aboOhneZahlung = Number(db.prepare("INSERT INTO abos(stripe_abo,stripe_sitzung,benutzer_id,kurs_id,status,gueltig_bis,endet_zum_periodenende,erstellt,geaendert) VALUES ('sub_2','cs_abo2',?,?,'zahlung_offen',NULL,0,?,?)").run(user, kurs, iso(), iso()).lastInsertRowid);
  const wOhne = zeileBauen('Kunden-Abos', 'abo:' + aboOhneZahlung, 'Test');
  pruefe('Abo ohne bezahlte Bestellung: Betrag und Waehrung vom Kurspreis, Status Zahlung offen, kein bezahlt-bis', wOhne.Betrag === 3990 && wOhne['Währung'] === 'HUF' && wOhne.Status === 'Zahlung offen' && !wOhne['Bezahlt bis / nächste Abbuchung'], JSON.stringify(wOhne));
  db.prepare('DELETE FROM abos WHERE id=?').run(aboOhneZahlung);
  db.prepare('DELETE FROM plattform_zeilen WHERE schluessel IN (?,?)').run('abo:' + aboOhneZahlung, 'offen:' + aboOhneZahlung);   // nur fuer diese Pruefung angelegt
  const wZ = zeileBauen('Zahlungen', 'zahlung:' + zahlungAbo, 'Test');
  pruefe('Zahlung ohne Namen: Kunde faellt auf die E-Mail zurueck; Gebuehr/Netto/Beleg fehlen (kommen spaeter von Stripe)', wZ.Kunde === 'ohne.name@example.com' && wZ.Brutto === 2990 && !('Gebühr' in wZ) && !('Netto' in wZ) && !('Stripe-Beleg-Link' in wZ), JSON.stringify(wZ));
  pruefe('Quelle weg: Zeile nicht baubar (null); falsche Kombination/Schluessel: null', zeileBauen('Zahlungen', 'zahlung:999999', 'Test') === null && zeileBauen('Zahlungen', 'abo:' + abo, 'Test') === null && zeileBauen('Kunden-Abos', 'x:1', 'Test') === null && zeileBauen('Kunden-Abos', "abo:1;DROP", 'Test') === null);
  const alleWerte = [wKauf, wAbo, wZ];
  pruefe('Kein Passwort-Hash und keine interne Benutzer-ID in den Zeilen', alleWerte.every((w) => !JSON.stringify(w).includes('GEHEIMER_HASH')));

  // ---- Senden -----------------------------------------------------------------------------------------------------------------
  const r = await p.senden();
  pruefe('Alle 4 Zeilen wurden gesendet', r.gesendet === 4 && aufrufe.filter((a) => a.body.typ === 'zeile').length === 4 && zeilen().every((z) => z.status === 'gesendet'), JSON.stringify(zeilen()));
  const zeilenAufrufe = aufrufe.filter((a) => a.body.typ === 'zeile');
  pruefe('Nachricht: typ zeile, Blatt, Zeilenschluessel, Werte, Schluessel; sonst nichts', zeilenAufrufe.every((a) => JSON.stringify(Object.keys(a.body).sort()) === JSON.stringify(['blatt', 'schluessel', 'typ', 'werte', 'zeilenschluessel'].sort())));
  pruefe('Alle Spaltennamen passen zu den Kopfzeilen der Sheet-Reiter', zeilenAufrufe.every((a) => Object.keys(a.body.werte).every((k) => KOEPFE[a.body.blatt].includes(k) && k !== 'Zeilenschlüssel')));
  pruefe('Betrag ist eine Zahl, Rest Text', zeilenAufrufe.every((a) => ['Betrag', 'Brutto'].every((k) => !(k in a.body.werte) || typeof a.body.werte[k] === 'number') && Object.entries(a.body.werte).every(([k, v]) => k === 'Betrag' || k === 'Brutto' || typeof v === 'string')));
  pruefe('E-Mail steht nur in der Spalte E-Mail oder Kunde', zeilenAufrufe.every((a) => Object.entries(a.body.werte).every(([k, v]) => !String(v).includes('@') || k === 'E-Mail' || k === 'Kunde')));
  aufrufe = []; await p.senden();
  pruefe('Nichts offen: kein weiterer Versand', aufrufe.length === 0);

  // ---- Aenderung: gleiche Zeile wird ueberschrieben -------------------------------------------------------------------------
  db.prepare("UPDATE bestellungen SET status='erstattet',grund='erstattung_voll',geaendert=? WHERE id=?").run(iso(), kauf);
  pruefe('Erstattung: Kauf-, Zahlungs- und Problem-Zeile offen', zeilen().filter((z) => z.status === 'offen').map((z) => z.schluessel).sort().join() === ['erstattung:' + kauf, 'kauf:' + kauf, 'zahlung:' + kauf].sort().join());
  aufrufe = []; await p.senden();
  pruefe('Gleicher Zeilenschluessel mit neuem Status "erstattet" gesendet', aufrufe.filter((a) => a.body.blatt !== 'Probleme').length === 2 && aufrufe.filter((a) => a.body.blatt !== 'Probleme').every((a) => a.body.werte.Status === 'erstattet') && aufrufe.some((a) => a.body.zeilenschluessel === 'kauf:' + kauf));
  const pErst = aufrufe.find((a) => a.body.zeilenschluessel === 'erstattung:' + kauf);
  pruefe('Probleme-Zeile Erstattung: Art Erstattung, Kunde, Grund mit Betrag, Modus Test, nur erlaubte Spalten', pErst && pErst.body.blatt === 'Probleme' && pErst.body.werte.Art === 'Erstattung' && pErst.body.werte.Kunde === 'Nagy Anna' && /Erstattet: 4990 HUF/.test(pErst.body.werte.Grund) && pErst.body.werte['Test/Live'] === 'Test' && Object.keys(pErst.body.werte).every((k) => KOEPFE.Probleme.includes(k)), JSON.stringify(pErst?.body.werte));
  db.prepare("UPDATE abos SET endet_zum_periodenende=1 WHERE id=?").run(abo);
  aufrufe = []; await p.senden();
  pruefe('Abo gekuendigt zum Periodenende: Status "gekündigt zum <Datum>"', aufrufe.length === 1 && /^gekündigt zum \d{4}-\d\d-\d\d$/.test(aufrufe[0].body.werte.Status), JSON.stringify(aufrufe.map((a) => a.body.werte.Status)));
  db.prepare("UPDATE abos SET status='zahlung_offen',endet_zum_periodenende=0 WHERE id=?").run(abo);
  aufrufe = []; await p.senden();
  pruefe('Abo Zahlung offen: Status "Zahlung offen" und Problem-Zeile "Zahlung offen"', aufrufe.length === 2 && aufrufe.some((a) => a.body.blatt === 'Kunden-Abos' && a.body.werte.Status === 'Zahlung offen') && aufrufe.some((a) => a.body.zeilenschluessel === 'offen:' + abo && a.body.werte.Art === 'Zahlung offen' && /Abo-Zahlung steht aus/.test(a.body.werte.Grund)), JSON.stringify(aufrufe.map((a) => a.body.zeilenschluessel)));
  db.prepare('UPDATE benutzer SET rechnung_name=? WHERE id=?').run('Nagy Anna Mária', user);
  pruefe('Namensaenderung markiert alle Zeilen dieses Kunden', zeilen().filter((z) => z.status === 'offen').length === 3);
  aufrufe = []; await p.senden();
  pruefe('Neuer Name wird gesendet', aufrufe.length === 3 && aufrufe.every((a) => a.body.werte.Kunde === 'Nagy Anna Mária'), JSON.stringify(aufrufe.map((a) => a.body.werte.Kunde)));

  // ---- Entschaerfung gefaehrlicher Namen (Formel-Zeichen, Steuerzeichen) ----------------------------------------------------------
  for (const [name, erwartet] of [['-Anna', ' -Anna'], ['=SUMME(1)', ' =SUMME(1)'], ['+36 Nagy', ' +36 Nagy'], ['@Anna', ' @Anna'], ['Anna\nNagy\t', 'Anna Nagy ']]) {
    db.prepare('UPDATE benutzer SET rechnung_name=? WHERE id=?').run(name, user);
    const w = zeileBauen('Kunden-Abos', 'kauf:' + kauf, 'Test');
    pruefe('Name "' + name.replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '" wird entschaerft zu "' + erwartet.replace(/\n/g, '\\n') + '"', w.Kunde === erwartet, JSON.stringify(w.Kunde));
  }
  db.prepare('UPDATE kurse SET titel=? WHERE id=?').run('Kurs @ Zoom', kurs);
  const wAt = zeileBauen('Kunden-Abos', 'kauf:' + kauf, 'Test'), pAt = zeileBauen('Probleme', 'erstattung:' + kauf, 'Test');
  pruefe('@ im Kurstitel wird in allen Spalten ausser E-Mail/Kunde ersetzt (Kunden-Abos und Probleme), E-Mail bleibt', wAt.Kurs === 'Kurs (at) Zoom' && wAt['E-Mail'] === 'anna.nagy@example.com' && !JSON.stringify(pAt.Grund).includes('@') && /Kurs \(at\) Zoom/.test(pAt.Grund), JSON.stringify([wAt.Kurs, pAt.Grund]));
  db.prepare('UPDATE kurse SET titel=? WHERE id=?').run('Testkurs Üzlet', kurs);
  db.prepare('UPDATE benutzer SET rechnung_name=? WHERE id=?').run('Nagy Anna Mária', user);
  aufrufe = []; await p.senden();
  pruefe('Nach den Namenswechseln ist alles wieder gesendet', p.lage().zeilen_offen === 0, JSON.stringify(p.lage()));

  // ---- Geloeschte Konten: Platzhalter-Adresse wird nicht gesendet ---------------------------------------------------------------------
  const userGel = Number(db.prepare("INSERT INTO benutzer(email,passwort_hash,erstellt) VALUES ('geloescht-77@invalid.invalid','x',?)").run(iso()).lastInsertRowid);
  const bGel = Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES ('cs_gel',?,?,1000,'huf','bezahlt','einmal',?,?)").run(userGel, kurs, iso(), iso()).lastInsertRowid);
  const wG = zeileBauen('Kunden-Abos', 'kauf:' + bGel, 'Test'), zG = zeileBauen('Zahlungen', 'zahlung:' + bGel, 'Test');
  pruefe('Geloeschter Kunde: "gelöschter Kunde", keine Platzhalter-Adresse in Kunden-Abos und Zahlungen', wG.Kunde === 'gelöschter Kunde' && wG['E-Mail'] === '' && zG.Kunde === 'gelöschter Kunde' && !JSON.stringify([wG, zG]).includes('invalid'), JSON.stringify([wG, zG]));
  db.prepare('DELETE FROM bestellungen WHERE id=?').run(bGel); db.prepare('DELETE FROM plattform_zeilen WHERE schluessel IN (?,?)').run('kauf:' + bGel, 'zahlung:' + bGel);

  // ---- Aenderung WAEHREND des Sendens bleibt offen ---------------------------------------------------------------------------
  db.prepare("UPDATE bestellungen SET status='bezahlt',grund=NULL,geaendert=? WHERE id=?").run(iso(), kauf);
  waehrendSenden = () => db.prepare("UPDATE bestellungen SET status='erstattet',geaendert=? WHERE id=?").run(iso(), kauf);
  aufrufe = []; await p.senden();
  pruefe('Aenderung waehrend des Sendens: Zeile bleibt offen und geht beim naechsten Lauf mit dem neuen Stand', zeilen().some((z) => z.schluessel === 'kauf:' + kauf && z.status === 'offen') && aufrufe.some((a) => a.body.werte.Status === 'bezahlt'));
  aufrufe = []; await p.senden();
  pruefe('Naechster Lauf sendet den neuen Stand (erstattet) und schliesst ab', aufrufe.some((a) => a.body.werte.Status === 'erstattet') && zeilen().every((z) => z.status === 'gesendet'), JSON.stringify(zeilen()));

  // ---- Fehler und Wiederholung ------------------------------------------------------------------------------------------------
  db.prepare("UPDATE bestellungen SET betrag=555000,geaendert=? WHERE id=?").run(iso(), zahlungAbo);
  antwort = 'netz'; aufrufe = []; await p.senden();
  pruefe('Netzfehler: Zeile bleibt offen', zeilen().some((z) => z.status === 'offen'));
  aufrufe = []; await p.senden();
  pruefe('Wartezeit schuetzt vor Dauerfeuer', aufrufe.length === 0);
  uhr += 61_000; antwort = { ok: false, fehler: 'schluessel' }; await p.senden();
  pruefe('Falscher Schluessel am Script: bleibt offen (wird wiederholt)', zeilen().some((z) => z.status === 'offen' && z.schluessel.includes('zahlung:' + zahlungAbo)));
  uhr += 10 * 60_000; antwort = { ok: false, fehler: 'blatt_unbekannt' }; await p.senden();
  pruefe('Dauerhafte Ablehnung (Blatt unbekannt): verworfen', p.lage().zeilen_verworfen >= 1, JSON.stringify(p.lage()));

  // ---- Quelle geloescht, Bestand, Lage ---------------------------------------------------------------------------------------
  const kauf2 = Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES ('cs_2',?,?,100000,'huf','bezahlt','einmal',?,?)").run(user, kurs, iso(), iso()).lastInsertRowid);
  db.prepare('DELETE FROM bestellungen WHERE id=?').run(kauf2);
  antwort = { ok: true }; aufrufe = []; await p.senden();
  pruefe('Quelle weg: Zeile wird verworfen, nichts gesendet', !aufrufe.some((a) => String(a.body.zeilenschluessel).includes(':' + kauf2)) && zeilen().filter((z) => z.schluessel.endsWith(':' + kauf2)).every((z) => z.status === 'verworfen'));
  const n = p.abgleich();
  pruefe('Bestandsabgleich merkt alle Zeilen neu vor (Kauf, Zahlung, Abo, Abo-Zahlung, Problem erstattet, Problem Zahlung offen)', n === 6 && zeilen().filter((z) => z.status === 'offen').length === 6, 'n=' + n + ' ' + JSON.stringify(zeilen().filter((z) => z.status === 'offen').length));
  aufrufe = []; await p.senden();
  const vorStart = zeilen().filter((z) => z.status === 'gesendet').length;
  db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES ('cs_neu',?,?,50000,'huf','bezahlt','einmal',?,?)").run(user, kurs, iso(), iso());
  await p.senden();
  db.exec("DELETE FROM plattform_zeilen WHERE schluessel LIKE 'zahlung:%' AND schluessel!='zahlung:' || (SELECT MAX(id) FROM bestellungen)");
  const nStart = p.abgleich(false);
  pruefe('Start-Abgleich (voll=false) legt nur FEHLENDE Zeilen an und setzt vorhandene gesendete Zeilen nicht zurueck', nStart >= 2 && zeilen().filter((z) => z.status === 'gesendet').length >= vorStart - 2, 'nStart=' + nStart + ' gesendet=' + zeilen().filter((z) => z.status === 'gesendet').length + ' vorher=' + vorStart);
  p.abgleich(); aufrufe = []; await p.senden();
  pruefe('Nach dem Abgleich sind alle gesendet', p.lage().zeilen_offen === 0 && p.lage().zeilen_gesendet >= 6, JSON.stringify(p.lage()));
  pruefe('Keine Warnung enthaelt E-Mail oder Schluessel', logs.every((z) => !z.includes('@') && !z.includes(KEY)));

  // ---- Stripe-Daten (Gebuehr, Netto, Beleg-Link) ----------------------------------------------------------------------------------
  let stripeAufrufe = 0, stripeModus = 'ok';
  const stripeAttrappe = { paymentIntents: { retrieve: async (pi, opt) => {
    stripeAufrufe++;
    if (stripeModus === 'fehler') throw new Error('Stripe nicht erreichbar');
    return { id: pi, latest_charge: { receipt_url: 'https://pay.stripe.com/receipts/payment/ABC123xyz', balance_transaction: { fee: 18500, net: 480500, currency: 'huf' } } };
  } } };
  const pS = plattformMeldung({ url: URL_OK, schluessel: KEY, modus: 'Test', fetchFn: fetchAttrappe, jetzt, stripe: stripeAttrappe });
  ereignisPlattformSetzen(pS);
  db.prepare("UPDATE bestellungen SET zahlung_id='pi_3AbCdEfGhIjK',betrag=499000,status='bezahlt',geaendert=? WHERE id=?").run(iso(), kauf);
  aufrufe = []; antwort = { ok: true }; await pS.senden();
  const zk = aufrufe.find((a) => a.body.zeilenschluessel === 'zahlung:' + kauf);
  pruefe('Zahlung mit Stripe-Daten: Gebuehr 185, Netto 4805 (Brutto - Gebuehr), Beleg-Link', zk && zk.body.werte['Gebühr'] === 185 && zk.body.werte.Netto === 4805 && zk.body.werte.Brutto - zk.body.werte['Gebühr'] === zk.body.werte.Netto && zk.body.werte['Stripe-Beleg-Link'] === 'https://pay.stripe.com/receipts/payment/ABC123xyz', JSON.stringify(zk?.body.werte));
  pruefe('Genau ein Stripe-Aufruf', stripeAufrufe === 1, 'aufrufe=' + stripeAufrufe);
  db.prepare("UPDATE bestellungen SET status='erstattet',geaendert=? WHERE id=?").run(iso(), kauf);
  aufrufe = []; await pS.senden();
  pruefe('Spaetere Aenderung: Zeile mit denselben Stripe-Werten, KEIN neuer Stripe-Aufruf (zwischengespeichert)', stripeAufrufe === 1 && aufrufe.some((a) => a.body.zeilenschluessel === 'zahlung:' + kauf && a.body.werte.Netto === 4805 && a.body.werte.Status === 'erstattet'));
  stripeModus = 'fehler';
  db.prepare("UPDATE bestellungen SET zahlung_id='pi_9ZyXwVuTsRqP',geaendert=? WHERE id=?").run(iso(), zahlungAbo);
  aufrufe = []; await pS.senden();
  const zf = aufrufe.find((a) => a.body.zeilenschluessel === 'zahlung:' + zahlungAbo);
  pruefe('Stripe nicht erreichbar: Zeile geht trotzdem ohne Gebuehr/Netto/Beleg hinaus, nichts bricht', zf && zf.body.werte.Brutto === 5550 && !('Gebühr' in zf.body.werte) && !('Netto' in zf.body.werte) && !('Stripe-Beleg-Link' in zf.body.werte), JSON.stringify(zf?.body.werte));
  stripeModus = 'ok';
  pS.abgleich(); aufrufe = []; await pS.senden();
  pruefe('Naechster Abgleich holt die fehlenden Stripe-Daten nach', aufrufe.some((a) => a.body.zeilenschluessel === 'zahlung:' + zahlungAbo && a.body.werte.Netto === 4805));
  db.prepare("UPDATE bestellungen SET zahlung_id='kein_pi',geaendert=? WHERE id=?").run(iso(), kauf);
  const vorher = stripeAufrufe; aufrufe = []; await pS.senden();
  pruefe('Keine pi_-Zahlungs-ID: kein Stripe-Aufruf', stripeAufrufe === vorher);

  // ---- Probleme werden erledigt, Auszahlungen und Streitfaelle von Stripe --------------------------------------------------------
  db.prepare("UPDATE abos SET status='aktiv',geaendert=? WHERE id=?").run(iso(), abo);
  aufrufe = []; await pS.senden();
  const pErl = aufrufe.find((a) => a.body.zeilenschluessel === 'offen:' + abo);
  pruefe('Abo wieder aktiv: Problem-Zeile bleibt, Grund wird "erledigt"', pErl && /^erledigt/.test(pErl.body.werte.Grund), JSON.stringify(pErl?.body.werte));
  const pr = Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,grund,art,erstellt,geaendert) VALUES ('cs_pr',?,?,10000,'huf','pruefen','betrag_waehrung',?,?,?)").run(user, kurs, 'einmal', iso(), iso()).lastInsertRowid);
  aufrufe = []; await pS.senden();
  const pPr = aufrufe.find((a) => a.body.zeilenschluessel === 'pruefen:' + pr);
  pruefe('Bestellung "pruefen": Problem-Zeile "Zahlung prüfen" mit Grund', pPr && pPr.body.werte.Art === 'Zahlung prüfen' && /Zahlung braucht Prüfung: 100 HUF/.test(pPr.body.werte.Grund), JSON.stringify(pPr?.body.werte));
  db.prepare("UPDATE bestellungen SET status='bezahlt',geaendert=? WHERE id=?").run(iso(), pr);
  aufrufe = []; await pS.senden();
  pruefe('Nach Freigabe: Problem-Zeile "erledigt"', aufrufe.some((a) => a.body.zeilenschluessel === 'pruefen:' + pr && /^erledigt/.test(a.body.werte.Grund)));
  const stripeListen = { payouts: [{ id: 'po_1AbCdEf', amount: 480500, currency: 'huf', arrival_date: 1800864000, status: 'in_transit' }], disputes: [{ id: 'dp_1XyZaBc', amount: 499000, currency: 'huf', created: 1800864000, reason: 'fraudulent', status: 'needs_response' }] };
  const stripe2 = { payouts: { list: async () => ({ data: stripeListen.payouts }) }, disputes: { list: async () => ({ data: stripeListen.disputes }) } };
  const pX = plattformMeldung({ url: URL_OK, schluessel: KEY, modus: 'Test', fetchFn: fetchAttrappe, jetzt, stripe: stripe2 });
  ereignisPlattformSetzen(pX);
  pruefe('Stripe-Abgleich: 2 neue Zeilen (Auszahlung, Streitfall)', (await pX.stripeAbgleich()) === 2);
  aufrufe = []; await pX.senden();
  const aus = aufrufe.find((a) => a.body.blatt === 'Auszahlungen'), str = aufrufe.find((a) => a.body.zeilenschluessel === 'streit:dp_1XyZaBc');
  pruefe('Auszahlung: Datum, Betrag 4805, Waehrung HUF, Status unterwegs, nur Kopfzeilen-Spalten', aus && aus.body.zeilenschluessel === 'auszahlung:po_1AbCdEf' && aus.body.werte.Betrag === 4805 && aus.body.werte['Währung'] === 'HUF' && aus.body.werte.Status === 'unterwegs' && /^\d{4}-\d\d-\d\d$/.test(aus.body.werte.Datum) && aus.body.werte['Test/Live'] === 'Test' && Object.keys(aus.body.werte).every((k) => KOEPFE.Auszahlungen.includes(k)), JSON.stringify(aus?.body.werte));
  pruefe('Streitfall: Probleme-Zeile Art Streitfall mit Grund und Betrag 4990', str && str.body.blatt === 'Probleme' && str.body.werte.Art === 'Streitfall' && /fraudulent.*4990 HUF.*needs_response/.test(str.body.werte.Grund) && Object.keys(str.body.werte).every((k) => KOEPFE.Probleme.includes(k)), JSON.stringify(str?.body.werte));
  pruefe('Unveraenderter Stripe-Stand: kein neuer Eintrag, nichts erneut gesendet', (await pX.stripeAbgleich()) === 0 && (aufrufe = [], await pX.senden(), aufrufe.filter((a) => a.body.blatt !== 'Zahlungen').length === 0));   // Zahlungen ohne Stripe-Daten werden bewusst erneut vorgemerkt (Nachholen)
  stripeListen.payouts[0].status = 'paid';
  pruefe('Stripe meldet Auszahlung bezahlt: genau eine Zeile geaendert und gesendet', (await pX.stripeAbgleich()) === 1 && (aufrufe = [], await pX.senden(), (() => { const nz = aufrufe.filter((a) => a.body.blatt !== 'Zahlungen'); return nz.length === 1 && nz[0].body.werte.Status === 'bezahlt'; })()));
  stripeListen.payouts.push({ id: 'po_boese@x', amount: 1, currency: 'huf', arrival_date: 1800864000, status: 'paid' });
  pruefe('Unerwartete Stripe-ID (mit @) wird ignoriert', (await pX.stripeAbgleich()) === 0);
  const stripeKaputt = plattformMeldung({ url: URL_OK, schluessel: KEY, modus: 'Test', fetchFn: fetchAttrappe, jetzt, stripe: { payouts: { list: async () => { throw new Error('x'); } }, disputes: { list: async () => { throw new Error('y'); } } } });
  pruefe('Stripe nicht erreichbar: kein Absturz, 0 neue Zeilen', (await stripeKaputt.stripeAbgleich()) === 0);
  pruefe('Ohne Stripe-Client: 0 und kein Absturz', (await plattformMeldung({ url: URL_OK, schluessel: KEY, modus: 'Test', fetchFn: fetchAttrappe, jetzt }).stripeAbgleich()) === 0);
  ereignisPlattformSetzen(pS);

  // ---- Streitfall mit Zuordnung zur Zahlung (Fehler A und Hinweis B, 03.11.2026) ---------------------------------------------------
  const kStreit = Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES ('cs_streit','pi_Streit0001',?,?,499000,'huf','bezahlt','einmal',?,?)").run(user, kurs, iso(), iso()).lastInsertRowid);
  const kPruef = Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,grund,art,erstellt,geaendert) VALUES ('cs_streitp','pi_Streit0002',?,?,499000,'huf','pruefen','streitfall','einmal',?,?)").run(user, kurs, iso(), iso()).lastInsertRowid);
  const kOhne = Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,grund,art,erstellt,geaendert) VALUES ('cs_streito','pi_Streit0003',?,?,499000,'huf','pruefen','streitfall','einmal',?,?)").run(user, kurs, iso(), iso()).lastInsertRowid);
  const streitListe = [
    { id: 'dp_Zuordnung1', amount: 499000, currency: 'huf', created: 1800864000, reason: 'fraudulent', status: 'needs_response', payment_intent: 'pi_Streit0001', balance_transactions: [{ currency: 'huf', fee: 1500, amount: -499000 }] },
    { id: 'dp_OhneBest01', amount: 1000, currency: 'huf', created: 1800864000, reason: 'general', status: 'warning_needs_response', payment_intent: 'pi_GibtEsNichtX1' },
    { id: 'dp_Zuordnung2', amount: 499000, currency: 'huf', created: 1800864000, reason: 'fraudulent', status: 'under_review', payment_intent: 'pi_Streit0002', balance_transactions: [{ currency: 'huf', fee: 1500, amount: -499000 }] },
  ];
  const sendeAlles = async (m) => { for (let i = 0; i < 12; i++) await m.senden(); };   // der Sender schickt je Lauf hoechstens 20 Zeilen
  const stripe3 = { payouts: { list: async () => ({ data: [] }) }, disputes: { list: async () => ({ data: streitListe }) } };
  const pY = plattformMeldung({ url: URL_OK, schluessel: KEY, modus: 'Test', fetchFn: fetchAttrappe, jetzt, stripe: stripe3 });
  ereignisPlattformSetzen(pY);
  await pY.stripeAbgleich(); aufrufe = []; await sendeAlles(pY);
  const szu = aufrufe.find((a) => a.body.zeilenschluessel === 'streit:dp_Zuordnung1');
  pruefe('Streitfall mit Zahlung: Kunde, Betrag 4990, Gebuehr 15, Stand needs_response, nur Kopfzeilen-Spalten',
    szu && /^Nagy Anna/.test(szu.body.werte.Kunde) && szu.body.werte.Betrag === 4990 && szu.body.werte['Gebühr'] === 15 && szu.body.werte.Stand === 'needs_response' && Object.keys(szu.body.werte).every((k) => KOEPFE.Probleme.includes(k)), JSON.stringify(szu?.body.werte));
  pruefe('Streitfall-Zeile: Stripe-Link (Test), Kurs und Zahlungsdatum fuers Dashboard', szu && szu.body.werte['Stripe-Link'] === 'https://dashboard.stripe.com/test/disputes/dp_Zuordnung1' && szu.body.werte.Kurs === 'Testkurs Üzlet' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(szu.body.werte['Zahlung (Datum)']), JSON.stringify(szu?.body.werte));
  const sOhne = aufrufe.find((a) => a.body.zeilenschluessel === 'streit:dp_OhneBest01');
  pruefe('Streitfall ohne Zuordnung (keine passende Bestellung): Stripe-Link ja, Kurs/Datum fehlen einfach', !!sOhne && sOhne.body.werte['Stripe-Link'] === 'https://dashboard.stripe.com/test/disputes/dp_OhneBest01' && !('Kurs' in sOhne.body.werte) && !('Zahlung (Datum)' in sOhne.body.werte), JSON.stringify(sOhne?.body.werte));
  pruefe('Stripe-Link im Live-Modus ohne "test/"', zeileBauen('Probleme', 'streit:dp_Zuordnung1', 'Live')['Stripe-Link'] === 'https://dashboard.stripe.com/disputes/dp_Zuordnung1');
  const kurs2 = db.prepare("SELECT id FROM kurse WHERE titel='Testkurs Üzlet'").get().id;
  db.prepare("UPDATE kurse SET titel='=Kurs @ Boese' WHERE id=?").run(kurs2);
  await pY.stripeAbgleich();   // der Kurstitel wird beim Abgleich in die Zeile uebernommen
  const wBoese = zeileBauen('Probleme', 'streit:dp_Zuordnung1', 'Test');
  pruefe('Kurstitel mit fuehrendem = und @: entschaerft (Script wuerde sonst die Zeile ablehnen)', wBoese.Kurs === ' =Kurs (at) Boese', JSON.stringify(wBoese.Kurs));
  db.prepare("UPDATE kurse SET titel='Testkurs Üzlet' WHERE id=?").run(kurs2);
  const zStreit = aufrufe.find((a) => a.body.zeilenschluessel === 'zahlung:' + kStreit);
  pruefe('Zahlung eines offenen Streitfalls: Status "Streitfall" (zaehlt als Einnahme, Abzug kommt aus der Streitfall-Zeile)', zStreit && zStreit.body.werte.Status === 'Streitfall', JSON.stringify(zStreit?.body.werte));
  const pPruef = aufrufe.find((a) => a.body.zeilenschluessel === 'pruefen:' + kPruef);
  pruefe('"Zahlung pruefen" mit Streitfall-Zeile: erledigt, keine Doppelzaehlung', pPruef && /^erledigt \(wird als Streitfall geführt\)/.test(pPruef.body.werte.Grund), JSON.stringify(pPruef?.body.werte));
  const zPruef = aufrufe.find((a) => a.body.zeilenschluessel === 'zahlung:' + kPruef);
  pruefe('Zahlung "pruefen"+Streitfall: Status "Streitfall" statt "prüfen"', zPruef && zPruef.body.werte.Status === 'Streitfall', JSON.stringify(zPruef?.body.werte));
  const pOhne = zeileBauen('Probleme', 'pruefen:' + kOhne, 'Test');
  pruefe('"Zahlung pruefen"+Streitfall OHNE Streitfall-Zeile von Stripe bleibt offen (kein Problem geht verloren)', /^Zahlung braucht Prüfung/.test(pOhne.Grund), JSON.stringify(pOhne));
  streitListe[0].status = 'won'; await pY.stripeAbgleich(); aufrufe = []; await sendeAlles(pY);
  const zWon = aufrufe.find((a) => a.body.zeilenschluessel === 'zahlung:' + kStreit), sWon = aufrufe.find((a) => a.body.zeilenschluessel === 'streit:dp_Zuordnung1');
  pruefe('Streitfall gewonnen: Zahlung wieder "bezahlt", Streitfall-Zeile Stand won', zWon && zWon.body.werte.Status === 'bezahlt' && sWon && sWon.body.werte.Stand === 'won', JSON.stringify([zWon?.body.werte, sWon?.body.werte]));
  streitListe[0].balance_transactions = [{ currency: 'eur', fee: 1500 }];
  streitListe[0].status = 'lost'; await pY.stripeAbgleich(); aufrufe = []; await sendeAlles(pY);
  const sLost = aufrufe.find((a) => a.body.zeilenschluessel === 'streit:dp_Zuordnung1');
  pruefe('Gebuehr in anderer Waehrung wird nicht uebernommen (keine falsche Summe)', sLost && sLost.body.werte.Stand === 'lost' && !('Gebühr' in sLost.body.werte), JSON.stringify(sLost?.body.werte));

  // ---- Gebuehr bei aelteren Abo-Zahlungen ohne Zahlungs-ID (Fehler C) -----------------------------------------------------------------
  const abgefragt = [];
  const stripe4 = {
    payouts: { list: async () => ({ data: [] }) }, disputes: { list: async () => ({ data: [] }) },
    paymentIntents: { retrieve: async (pi) => { abgefragt.push(pi); return { latest_charge: { receipt_url: 'https://pay.stripe.com/receipts/abc', balance_transaction: { fee: 23935, net: 465065 } } }; } },
    invoicePayments: { list: async ({ invoice }) => { abgefragt.push(invoice); return { data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_AboZahlung01' } }] }; } },
    checkout: { sessions: { retrieve: async (cs) => { abgefragt.push(cs); return { invoice: 'in_AboRechnung02' }; } } },
  };
  const pZ = plattformMeldung({ url: URL_OK, schluessel: KEY, modus: 'Test', fetchFn: fetchAttrappe, jetzt, stripe: stripe4 });
  ereignisPlattformSetzen(pZ);
  const aRe = Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,stripe_abo,erstellt,geaendert) VALUES ('in_AboRechnung01',?,?,490000,'huf','bezahlt','abo','sub_alt1',?,?)").run(user, kurs, iso(), iso()).lastInsertRowid);
  const aCs = Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,stripe_abo,erstellt,geaendert) VALUES ('cs_test_AboSitzung0001',?,?,490000,'huf','bezahlt','abo','sub_alt2',?,?)").run(user, kurs, iso(), iso()).lastInsertRowid);
  const eOhne = Number(db.prepare("INSERT INTO bestellungen(stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,status,art,erstellt,geaendert) VALUES ('cs_ohne_pi',?,?,490000,'huf','bezahlt','einmal',?,?)").run(user, kurs, iso(), iso()).lastInsertRowid);
  aufrufe = []; await sendeAlles(pZ);
  const zRe = aufrufe.find((a) => a.body.zeilenschluessel === 'zahlung:' + aRe), zCs = aufrufe.find((a) => a.body.zeilenschluessel === 'zahlung:' + aCs), zEo = aufrufe.find((a) => a.body.zeilenschluessel === 'zahlung:' + eOhne);
  pruefe('Alte Abo-Zahlung (nur Rechnungs-ID): Gebuehr 239,35, Netto 4650,65 und Beleg-Link werden nachgeholt', zRe && zRe.body.werte['Gebühr'] === 239.35 && zRe.body.werte.Netto === 4650.65 && /^https:\/\/pay\.stripe\.com\//.test(zRe.body.werte['Stripe-Beleg-Link']), JSON.stringify(zRe?.body.werte));
  pruefe('Alte Abo-Zahlung (nur Checkout-Sitzung cs_): Zahlung ueber die Rechnung gefunden, Gebuehr 239,35', zCs && zCs.body.werte['Gebühr'] === 239.35, JSON.stringify(zCs?.body.werte));
  pruefe('Einmalkauf ohne Zahlungs-ID: kein Absturz, ohne Gebuehr gesendet', zEo && !('Gebühr' in zEo.body.werte));
  const vorherAbfragen = abgefragt.length; aufrufe = [];
  db.prepare("UPDATE plattform_zeilen SET status='offen',versuche=0,version=version+1,geaendert=0 WHERE schluessel=?").run('zahlung:' + aRe);
  await sendeAlles(pZ);
  pruefe('Gebuehr wird nur einmal bei Stripe geholt (zweites Senden ohne neue Abfrage)', abgefragt.length === vorherAbfragen);
  db.prepare("DELETE FROM plattform_stripe WHERE zahlung_id IN ('in_AboRechnung01','cs_test_AboSitzung0001','pi_AboZahlung01')").run();
  db.prepare("UPDATE plattform_zeilen SET status='gesendet' WHERE schluessel=?").run('zahlung:' + aRe);
  await pZ.stripeAbgleich();
  pruefe('Nachholen: bezahlte Zahlung ohne gemerkte Stripe-Daten wird erneut vorgemerkt', db.prepare("SELECT status FROM plattform_zeilen WHERE schluessel=?").get('zahlung:' + aRe).status === 'offen');

  // ---- Stripe-Abgleich ins Sheet (PD-13) --------------------------------------------------------------------------------------------
  const lauf1 = Number(db.prepare("INSERT INTO abgleich_lauf(start,ende,modus,fenster_tage,geprueft_sitzungen,geprueft_rechnungen,geprueft_erstattungen,geprueft_abos,abweichungen_anzahl,status,meldung) VALUES (?,?,'test',35,1,1,1,1,4,'abweichung','abgleich_abweichung')").run('2026-11-03T10:00:00.000Z', '2026-11-03T10:00:05.000Z').lastInsertRowid);
  const abw = db.prepare("INSERT INTO abgleich_abweichung(lauf_id,art,stripe_id,betrag,waehrung,text,zeit) VALUES (?,?,?,?,?,?,?)");
  abw.run(lauf1, 'stripe_ohne_bestellung', 'in_x1', 990000, 'huf', 'abgleich_stripe_ohne_bestellung', '2026-11-02T10:00:00.000Z');
  abw.run(lauf1, 'stripe_ohne_bestellung', 'in_x2', 490000, 'huf', 'abgleich_stripe_ohne_bestellung', '2026-11-02T11:00:00.000Z');
  abw.run(lauf1, 'betrag', 'in_x3', null, null, 'abgleich_betrag', '2026-11-02T12:00:00.000Z');
  abw.run(lauf1, 'stripe_ohne_bestellung', 'in_x4', 1000, 'eur', 'abgleich_stripe_ohne_bestellung', '2026-11-02T13:00:00.000Z');
  pruefe('Abgleich: 4 neue Zeilen (HUF-Art, EUR-Art, Betrag-Art ohne Waehrung, Status)', (await pY.stripeAbgleich()) === 4);
  aufrufe = []; await sendeAlles(pY);
  const aSo = aufrufe.find((a) => a.body.zeilenschluessel === 'abgleich:stripe_ohne_bestellung_huf'), aSt = aufrufe.find((a) => a.body.zeilenschluessel === 'abgleich:status');
  pruefe('Abgleich-Zeile: Art Stripe-Abgleich, Anzahl 2, Summe 14,80 x100 = 14800 HUF, Stand offen, nur Kopfzeilen-Spalten',
    aSo && aSo.body.werte.Art === 'Stripe-Abgleich' && /2x, zusammen 14800 HUF/.test(aSo.body.werte.Grund) && !('Betrag' in aSo.body.werte) && aSo.body.werte.Stand === 'offen' && Object.keys(aSo.body.werte).every((k) => KOEPFE.Probleme.includes(k)), JSON.stringify(aSo?.body.werte));
  pruefe('Abgleich-Statuszeile: 4 Abweichung(en), Stand offen', aSt && /4 Abweichung/.test(aSt.body.werte.Grund) && aSt.body.werte.Stand === 'offen', JSON.stringify(aSt?.body.werte));
  pruefe('Abgleich unveraendert: nichts erneut gesendet', (await pY.stripeAbgleich(), aufrufe = [], await pY.senden(), !aufrufe.some((a) => String(a.body.zeilenschluessel).startsWith('abgleich:'))));
  db.prepare("INSERT INTO abgleich_lauf(start,ende,modus,fenster_tage,geprueft_sitzungen,geprueft_rechnungen,geprueft_erstattungen,geprueft_abos,abweichungen_anzahl,status,meldung) VALUES (?,?,'test',35,1,1,1,1,0,'ok','abgleich_ok')").run('2026-11-04T10:00:00.000Z', '2026-11-04T10:00:05.000Z');
  await pY.stripeAbgleich(); aufrufe = []; await sendeAlles(pY);
  const aSo2 = aufrufe.find((a) => a.body.zeilenschluessel === 'abgleich:stripe_ohne_bestellung_huf'), aSt2 = aufrufe.find((a) => a.body.zeilenschluessel === 'abgleich:status');
  pruefe('Abgleich spaeter ohne Abweichung: Art-Zeile und Statuszeile "erledigt"', aSo2 && aSo2.body.werte.Stand === 'erledigt' && /^erledigt/.test(aSo2.body.werte.Grund) && aSt2 && /in Ordnung/.test(aSt2.body.werte.Grund) && aSt2.body.werte.Stand === 'erledigt', JSON.stringify([aSo2?.body.werte, aSt2?.body.werte]));
  const aEur = aufrufe.find((a) => a.body.zeilenschluessel === 'abgleich:stripe_ohne_bestellung_eur');
  pruefe('Abgleich je Waehrung getrennt: EUR-Zeile hat eigene Summe (10 EUR) und wird ebenfalls "erledigt"', aEur && aEur.body.werte.Stand === 'erledigt', JSON.stringify(aEur?.body.werte));

  const l3 = Number(db.prepare("INSERT INTO abgleich_lauf(start,ende,modus,fenster_tage,geprueft_sitzungen,geprueft_rechnungen,geprueft_erstattungen,geprueft_abos,abweichungen_anzahl,status,meldung) VALUES (?,?,'test',35,1,1,1,1,1,'abweichung','abgleich_abweichung')").run('2026-11-05T10:00:00.000Z', '2026-11-05T10:00:05.000Z').lastInsertRowid);
  db.prepare("INSERT INTO abgleich_abweichung(lauf_id,art,stripe_id,betrag,waehrung,text,zeit) VALUES (?,?,?,?,?,?,?)").run(l3, 'betrag', 'in_x5', null, null, 'abgleich_betrag', '2026-11-05T09:00:00.000Z');
  await pY.stripeAbgleich(); aufrufe = []; await sendeAlles(pY);
  const aBetr = aufrufe.find((a) => a.body.zeilenschluessel === 'abgleich:betrag');
  pruefe('Neue Abweichung nach "erledigt": Zeile wieder offen', aBetr && aBetr.body.werte.Stand === 'offen', JSON.stringify(aBetr?.body.werte));
  db.prepare("INSERT INTO abgleich_lauf(start,ende,modus,fenster_tage,geprueft_sitzungen,geprueft_rechnungen,geprueft_erstattungen,geprueft_abos,abweichungen_anzahl,status,meldung) VALUES (?,?,'test',35,0,0,0,0,0,'fehler','abgleich_fehler')").run('2026-11-06T10:00:00.000Z', '2026-11-06T10:00:05.000Z');
  await pY.stripeAbgleich(); aufrufe = []; await sendeAlles(pY);
  const aFehl = aufrufe.find((a) => String(a.body.zeilenschluessel).startsWith('abgleich:') && a.body.zeilenschluessel !== 'abgleich:status');
  const aStFehl = aufrufe.find((a) => a.body.zeilenschluessel === 'abgleich:status');
  pruefe('Abgleich konnte nicht laufen: keine Art-Zeile wird "erledigt", Statuszeile sagt es und bleibt offen', !aFehl && aStFehl && /nicht laufen/.test(aStFehl.body.werte.Grund) && aStFehl.body.werte.Stand === 'offen', JSON.stringify([aFehl?.body, aStFehl?.body.werte]));

  // ---- Gewonnener Streit bei Bestellung "pruefen"+streitfall: Geld ist zurueck -> Zahlung "bezahlt" (Fund der Pruefung) ----------------------
  streitListe.find((d) => d.id === 'dp_Zuordnung2').status = 'won'; await pY.stripeAbgleich(); aufrufe = []; await sendeAlles(pY);
  const zWon2 = aufrufe.find((a) => a.body.zeilenschluessel === 'zahlung:' + kPruef);
  pruefe('Gewonnener Streit, Bestellung bleibt "pruefen": Zahlung wird "bezahlt" (zaehlt als Einnahme, kein Abzug)', zWon2 && zWon2.body.werte.Status === 'bezahlt', JSON.stringify(zWon2?.body.werte));
  pruefe('Gewonnener Streit: "Zahlung pruefen" bleibt offen (Gabriella entscheidet ueber den Zugang)', /^Zahlung braucht Prüfung/.test(zeileBauen('Probleme', 'pruefen:' + kPruef, 'Test').Grund));
  streitListe.find((d) => d.id === 'dp_Zuordnung2').status = 'lost'; await pY.stripeAbgleich(); aufrufe = []; await sendeAlles(pY);
  const zLost2 = aufrufe.find((a) => a.body.zeilenschluessel === 'zahlung:' + kPruef);
  pruefe('Verlorener Streit: Zahlung "Streitfall" (Abzug aus der Streitfall-Zeile)', zLost2 && zLost2.body.werte.Status === 'Streitfall', JSON.stringify(zLost2?.body.werte));

  // ---- Seitenweise lesen und Nachholen nur wo moeglich ------------------------------------------------------------------------------------
  const seitenAufrufe = [];
  const stripeSeiten = { payouts: { list: async () => ({ data: [] }) }, disputes: { list: async (x) => { seitenAufrufe.push(x); return x.starting_after ? { data: [{ id: 'dp_Seite00002', amount: 1000, currency: 'huf', created: 1800864000, reason: 'general', status: 'warning_needs_response' }], has_more: false } : { data: [{ id: 'dp_Seite00001', amount: 1000, currency: 'huf', created: 1800864000, reason: 'general', status: 'warning_needs_response' }], has_more: true }; } } };
  const pS2 = plattformMeldung({ url: URL_OK, schluessel: KEY, modus: 'Test', fetchFn: fetchAttrappe, jetzt, stripe: stripeSeiten });
  ereignisPlattformSetzen(pS2);
  const vorSeiten = db.prepare("SELECT COUNT(*) n FROM plattform_zeilen WHERE schluessel LIKE 'streit:dp_Seite%'").get().n;
  await pS2.stripeAbgleich();
  pruefe('Streitfaelle werden seitenweise gelesen (zweite Seite mit starting_after, beide Streitfaelle da)', seitenAufrufe.length === 2 && seitenAufrufe[1].starting_after === 'dp_Seite00001' && db.prepare("SELECT COUNT(*) n FROM plattform_zeilen WHERE schluessel LIKE 'streit:dp_Seite%'").get().n === vorSeiten + 2, JSON.stringify(seitenAufrufe));
  db.prepare("UPDATE plattform_zeilen SET status='gesendet' WHERE schluessel=?").run('zahlung:' + eOhne);
  await pS2.stripeAbgleich();
  pruefe('Einmalkauf ohne Zahlungs-ID wird nicht endlos neu vorgemerkt (Stripe kann hier nichts liefern)', db.prepare("SELECT status FROM plattform_zeilen WHERE schluessel=?").get('zahlung:' + eOhne).status === 'gesendet');
  ereignisPlattformSetzen(pS);

  // ---- Zurueck auf AUS: Trigger werden entfernt ------------------------------------------------------------------------------
  plattformMeldung({});
  pruefe('Wieder aus: Trigger entfernt', db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'plattform_t_%'").get().n === 0);
} catch (e) {
  fehler++; console.log('FEHLER Test abgebrochen: ' + (e?.stack || e));
} finally {
  console.warn = alteWarn;
  try { rmSync(ordner, { recursive: true, force: true }); } catch {}
}
console.log(`${ok} bestanden, ${fehler} fehlgeschlagen`);
process.exit(fehler ? 1 : 0);
