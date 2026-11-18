// Apps-Script-Webhook (tools/apps-script/plattform-webhook.gs): Pruefregeln fuer Ereignisse und 'Zeile setzen' offline testen (Script wird als Text geladen, Google-Dienste werden nicht gebraucht).
import './test-sprache.mjs';
import { readFileSync } from 'node:fs';

const src = readFileSync('tools/apps-script/plattform-webhook.gs', 'utf8').replace(/\r\n/g, '\n');
const f = new Function(src + '\nreturn { zeilePruefen_, pruefen_ };')();
let ok = 0, bad = 0; const t = (n, a, e) => { (a === e ? ok++ : bad++); if (a !== e) console.log('FEHLER', n, JSON.stringify(a), 'erwartet', JSON.stringify(e)); };
const basis = (w, extra = {}) => ({ schluessel: 'x', typ: 'zeile', blatt: 'Kunden-Abos', zeilenschluessel: 'abo:12', werte: { Kunde: 'Anna Nagy', 'E-Mail': 'anna@example.com', Betrag: 4990, 'Test/Live': 'Test', ...w }, ...extra });
t('gueltig', f.zeilePruefen_(basis({})), '');
t('Blatt unbekannt', f.zeilePruefen_(basis({}, { blatt: 'Ereignisse' })), 'blatt_unbekannt');
t('Blatt Index', f.zeilePruefen_(basis({}, { blatt: 'Zusammenfassung' })), 'blatt_unbekannt');
t('Schluessel Leerzeichen', f.zeilePruefen_(basis({}, { zeilenschluessel: 'a b' })), 'zeilenschluessel');
t('Schluessel zu lang', f.zeilePruefen_(basis({}, { zeilenschluessel: 'a'.repeat(81) })), 'zeilenschluessel');
t('@ in Kurs', f.zeilePruefen_(basis({ Kurs: 'a@b' })), 'feld_Kurs');
t('@ in Kunde erlaubt', f.zeilePruefen_(basis({ Kunde: 'a@b.hu' })), '');
t('Formel =', f.zeilePruefen_(basis({ Kurs: '=HYPERLINK("x")' })), 'feld_Kurs');
t('Formel +', f.zeilePruefen_(basis({ Kurs: '+1' })), 'feld_Kurs');
t('Betrag negativ als Zahl ok', f.zeilePruefen_(basis({ Betrag: -5 })), '');
t('Steuerzeichen', f.zeilePruefen_(basis({ Kurs: 'a\u0001b' })), 'feld_Kurs');
t('zu lang', f.zeilePruefen_(basis({ Kurs: 'a'.repeat(301) })), 'feld_Kurs');
t('Modus fehlt', f.zeilePruefen_(basis({ 'Test/Live': 'Produktion' })), 'modus');
t('unbekanntes Kopffeld', f.zeilePruefen_(basis({}, { extra: 1 })), 'unbekanntes_feld');
t('werte Array', f.zeilePruefen_(basis({}, { werte: [1] })), 'werte');
t('NaN', f.zeilePruefen_(basis({ Betrag: NaN })), 'feld_Betrag');
t('Event pruefen_ unveraendert gueltig', f.pruefen_({ zeit_utc: '2026-11-03 09:15:00', typ: 'gekauft', kurs: '7', betrag: 1, waehrung: 'HUF', modus: 'Test', quelle_id: 'a'.repeat(32), schluessel: 'k' }), '');

t('Ziffer-Text erlaubt (Datum)', f.zeilePruefen_(basis({ Seit: '2026-11-03 10:00:00' })), '');
t('Ziffer 1 erlaubt', f.zeilePruefen_(basis({ Kurs: '1' })), '');
t('Minus-Text abgelehnt', f.zeilePruefen_(basis({ Kurs: '-1+1' })), 'feld_Kurs');
t('Formel = abgelehnt', f.zeilePruefen_(basis({ Kurs: '=1+1' })), 'feld_Kurs');
t('Formel @ abgelehnt', f.zeilePruefen_(basis({ Kurs: '@SUM(1)' })), 'feld_Kurs');
console.log(ok + ' bestanden, ' + bad + ' fehlgeschlagen');
process.exit(bad ? 1 : 0);
