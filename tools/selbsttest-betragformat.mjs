// Backlog b (12.11.2026): Geldbetraege in ALLEN Mails und Kundentexten nach Sprache und Waehrung, aus EINER Funktion (public/preis.js betragText).
// Matrix Sprache (de/en/hu) x Waehrung (eur/huf) x Betrag (0, 1, 99, 100, 1999, 5900, 123456 und Teilerstattung) fuer:
//   Funktion betragText/formatGeld/formatGeldEinheiten, Seitenanzeige formatBetrag (je <html lang>), Kaufmail, Widerrufsmail (Kunde, Inhaberin, Warnung),
//   Abo-Erstattungsmail (Teilerstattung), Geschaeftsmeldung (Ereignis in ganzen Einheiten), Abgleich-Alarm.
// Gewaehltes Format: de/hu "59,00 EUR" und "12 345 Ft" (normales Leerzeichen), en "59.00 EUR" und "12,345 HUF". EUR ohne Tausendertrenner (wie bisher, produktreife4).
// Betraege: EUR in Cent; HUF-Zahlen der Matrix sind ganze Forint (intern Forint mal 100).
// Aufruf (im Ordner plattform): node --disable-warning=ExperimentalWarning tools/selbsttest-betragformat.mjs
import './test-sprache.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const PLATTFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ordner = mkdtempSync(join(tmpdir(), 'schulung-betragformat-'));
process.env.DB_DATEI = join(ordner, 'test.db');
let ok = 0, fail = 0;
const pruefe = (n, x, d = '') => { if (x) ok++; else fail++; console.log((x ? 'OK     ' : 'FEHLER ') + n + (x ? '' : ' | ' + String(d).slice(0, 300))); };
const SPRACHEN = ['de', 'en', 'hu'];
const T = Object.fromEntries(SPRACHEN.map((l) => [l, JSON.parse(readFileSync(join(PLATTFORM, 'texte', l + '.json'), 'utf8'))]));
// Unabhaengige Erwartung (bewusst NICHT aus preis.js abgeleitet).
const gruppe = (n, sep) => { const s = String(n); let r = ''; for (let i = 0; i < s.length; i++) { if (i && (s.length - i) % 3 === 0) r += sep; r += s[i]; } return r; };
const soll = (cent, w, l) => {
  const ganz = Math.floor(cent / 100);
  if (w === 'huf') return gruppe(ganz, l === 'en' ? ',' : ' ') + (l === 'en' ? ' HUF' : ' Ft');
  return ganz + (l === 'en' ? '.' : ',') + String(cent % 100).padStart(2, '0') + ' EUR';
};
const ZAHLEN = [0, 1, 99, 100, 1999, 5900, 123456];
// Zellen: [Bezeichnung, kleinste Einheit]. EUR: Zahl = Cent. HUF: Zahl = ganze Forint (mal 100). Teilerstattung: die Haelfte von 5900.
const zellen = (w) => [...ZAHLEN.map((z) => [String(z), w === 'huf' ? z * 100 : z]), ['Teilerstattung', w === 'huf' ? 2950 * 100 : 2950]];
const MATRIX = SPRACHEN.flatMap((l) => ['eur', 'huf'].flatMap((w) => zellen(w).map(([name, cent]) => ({ l, w, name, cent, s: soll(cent, w, l) }))));
const zeilenVon = (m) => String(m?.text || '').split('\n');
try {
  const P = await import('../public/preis.js');
  const { formatGeld, formatGeldEinheiten } = await import('../betrag.mjs');

  // ---------- 1. Feste Beispiele (Format woertlich) ----------
  const fest = [['de', 'eur', 5900, '59,00 EUR'], ['en', 'eur', 5900, '59.00 EUR'], ['hu', 'eur', 5900, '59,00 EUR'], ['de', 'huf', 1234500, '12 345 Ft'],
    ['hu', 'huf', 1234500, '12 345 Ft'], ['en', 'huf', 1234500, '12,345 HUF'], ['en', 'eur', 123456, '1234.56 EUR'], ['de', 'eur', 1, '0,01 EUR'], ['hu', 'huf', 0, '0 Ft'],
    ['en', 'huf', 100, '1 HUF'], ['de', 'huf', 12345600, '123 456 Ft'], ['en', 'huf', 12345600, '123,456 HUF'], ['hu', 'huf', 99, '0 Ft'], ['en', 'eur', 0, '0.00 EUR']];
  for (const [l, w, c, s] of fest) pruefe(`Fest [${l}] ${c} ${w} -> "${s}"`, P.betragText(c, w, l) === s && formatGeld(c, w, l) === s, formatGeld(c, w, l));
  pruefe('Ohne Sprachangabe: Deutsch (formatGeld(5900,"eur") = "59,00 EUR")', formatGeld(5900, 'eur') === '59,00 EUR' && P.betragText(5900, 'eur') === '59,00 EUR');
  pruefe('Unbekannte Sprache faellt auf Deutsch zurueck', P.betragText(5900, 'eur', 'xx') === '59,00 EUR');
  pruefe('Ungueltige Betraege ergeben "" (negativ, Bruch, null, NaN, Text)', [-1, 1.5, null, undefined, NaN, '5900'].every((c) => P.betragText(c, 'eur', 'en') === '' && formatGeld(c, 'huf', 'hu') === ''));

  // ---------- 2. Matrix: Funktion, Ereignisbetrag, Seitenanzeige ----------
  for (const z of MATRIX) {
    const ist = formatGeld(z.cent, z.w, z.l);
    pruefe(`Funktion [${z.l}] ${z.w} ${z.name} -> "${z.s}"`, ist === z.s && !/[\u00a0\u202f]/.test(ist), JSON.stringify(ist));
  }
  const einheitenFalsch = MATRIX.filter((z) => formatGeldEinheiten(z.cent / 100, z.w, z.l) !== z.s);
  pruefe(`Ereignisbetrag (ganze Einheiten, z. B. 19.99) fuer alle ${MATRIX.length} Zellen gleich`, einheitenFalsch.length === 0, einheitenFalsch.slice(0, 4).map((z) => z.l + z.w + z.name + ':' + formatGeldEinheiten(z.cent / 100, z.w, z.l)).join(','));
  pruefe('Ereignisbetrag ungueltig/leer -> ""', [null, undefined, -1, 'abc'].every((x) => formatGeldEinheiten(x, 'eur', 'de') === ''));
  for (const l of SPRACHEN) {
    globalThis.document = { documentElement: { lang: l } };
    const falsch = MATRIX.filter((z) => z.l === l && P.formatBetrag(z.cent, z.w) !== z.s);
    pruefe(`Seitenanzeige formatBetrag bei <html lang="${l}">: alle 16 Zellen`, falsch.length === 0, falsch.map((z) => z.w + z.name + ':' + P.formatBetrag(z.cent, z.w)).join(','));
  }
  delete globalThis.document;

  // ---------- 3. Mails aus der Warteschlange (ohne Sprachkontext, wie aus dem Timer) ----------
  const { db } = await import('../db.mjs');
  const { mailDienst, kaufVormerken } = await import('../mail.mjs');
  const { mitSprache, STANDARD_SPRACHE } = await import('../texte.mjs');
  const { abgleichAlarm } = await import('../abgleich-alarm.mjs');
  const gesendet = [];
  const mailer = async (m) => { gesendet.push(m); return true; };
  const INHABER = 'inhaber-betrag@example.net';
  const dienst = mailDienst({ mailer, base: 'http://localhost:4482', verkaufsmeldungMail: INHABER, anbieter: {} });
  const zeit = new Date().toISOString();
  const kurs = { eur: 0, huf: 0 };
  for (const w of ['eur', 'huf']) kurs[w] = Number(db.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES (?,?,?,?,'veroeffentlicht',?,?)").run('Betragskurs ' + w, 'x', 5900, w, zeit, zeit).lastInsertRowid);
  let nr = 0;
  const ergebnis = { kauf: [], kunde: [], inhaber: [], warnung: [], aboerst: [], meldung: [], abgleich: [] };
  for (const z of MATRIX) {
    nr++;
    const email = 'betrag-' + nr + '@example.net';
    const b = Number(db.prepare('INSERT INTO benutzer (email,passwort_hash,erstellt,email_bestaetigt,sprache) VALUES (?,?,?,?,?)').run(email, 'x', zeit, Date.now(), z.l).lastInsertRowid);
    const best = Number(db.prepare("INSERT INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,erstellt,geaendert,sprache) VALUES (?,?,?,?,?,?,'bezahlt',?,?,?)")
      .run('cs_b_' + nr, 'pi_b_' + nr, b, kurs[z.w], z.cent, z.w, zeit, zeit, z.l).lastInsertRowid);
    // Kaufmail (Kunde, Bestellsprache): "Bezahlter Betrag" und "Gesamtpreis"
    gesendet.length = 0;
    kaufVormerken(b, best, 'kauf');
    await dienst.ausgangSenden();
    const k = gesendet.find((m) => m.to === email);
    const kz = zeilenVon(k);
    ergebnis.kauf.push([z, !!k && kz.includes(T[z.l].mail_kauf_betrag + ': ' + z.s) && kz.includes(T[z.l].mailrecht_teljes_ar + ': ' + z.s), kz.find((x) => x.startsWith(T[z.l].mail_kauf_betrag)) || 'keine Mail']);
    // Widerrufsmails: Kunde (Bestellsprache), Inhaberin und Warnung (Standardsprache)
    db.prepare("INSERT INTO ellallas (bestellung_id,zeit,ergebnis,hinweis,aktualisiert) VALUES (?,?,'fehler','stripe',?)").run(best, zeit, zeit);
    for (const e of ['kunde', 'inhaber', 'warnung']) db.prepare('INSERT INTO ellallas_mail (bestellung_id,empfaenger) VALUES (?,?)').run(best, e);
    gesendet.length = 0;
    await dienst.ellallasAusgangSenden();
    const std = STANDARD_SPRACHE;
    const ku = gesendet.find((m) => m.to === email);
    const an = gesendet.filter((m) => m.to === INHABER);
    const inh = an.find((m) => m.subject !== T[std].ellallas_warn_betreff), warn = an.find((m) => m.subject === T[std].ellallas_warn_betreff);
    ergebnis.kunde.push([z, zeilenVon(ku).includes(T[z.l].k_fiokom_betrag + ': ' + z.s), zeilenVon(ku).find((x) => x.startsWith(T[z.l].k_fiokom_betrag)) || 'keine Mail']);
    const sStd = soll(z.cent, z.w, std);
    ergebnis.inhaber.push([z, zeilenVon(inh).includes(T[std].k_fiokom_betrag + ': ' + sStd), zeilenVon(inh).find((x) => x.startsWith(T[std].k_fiokom_betrag)) || 'keine Mail']);
    ergebnis.warnung.push([z, zeilenVon(warn).includes(T[std].k_fiokom_betrag + ': ' + sStd), zeilenVon(warn).find((x) => x.startsWith(T[std].k_fiokom_betrag)) || 'keine Mail']);
    // Abo-Erstattungsmail (Teil-/Erstattungsbetrag der Rueckzahlung, Sprache der Bestellung wie bisher)
    db.prepare('INSERT INTO abo_erstattung_mail (bestell_id,refund_id,betrag) VALUES (?,?,?)').run(best, 're_b_' + nr, z.cent);
    gesendet.length = 0;
    await dienst.aboErstattungAusgangSenden();
    const ae = gesendet.find((m) => m.to === INHABER);
    ergebnis.aboerst.push([z, zeilenVon(ae).includes(T[z.l].aboerstattung_mail_betrag + ': ' + z.s), zeilenVon(ae).find((x) => x.startsWith(T[z.l].aboerstattung_mail_betrag)) || 'keine Mail']);
    // Geschaeftsmeldung: Ereignisbetrag in ganzen Einheiten (ganzeEinheiten), Sprache der Mail = Sprache des Kontexts
    const eid = Number(db.prepare("INSERT INTO ereignisse (zeit,typ,kurs_id,kurs_titel,betrag,waehrung,email,status,quelle_id) VALUES (?,'erstattet',?,?,?,?,?,'teilweise',?)")
      .run(Date.now(), kurs[z.w], 'Betragskurs', z.cent / 100, z.w, email, 'q_b_' + nr).lastInsertRowid);
    db.prepare('INSERT INTO meldung_ausgang (ereignis_id,geaendert) VALUES (?,?)').run(eid, Date.now());
    gesendet.length = 0;
    await mitSprache(z.l, () => dienst.meldungAusgangSenden());
    const me = gesendet.find((m) => m.to === INHABER);
    ergebnis.meldung.push([z, zeilenVon(me).includes(T[z.l].mail_meldung_betrag + ': ' + z.s), zeilenVon(me).find((x) => x.startsWith(T[z.l].mail_meldung_betrag)) || 'keine Mail']);
    // Abgleich-Alarm (vorher roh in Cent "5900 eur")
    gesendet.length = 0;
    await mitSprache(z.l, () => abgleichAlarm({ mailer, adressen: ['alarm-betrag@example.net'], base: 'http://localhost:4482' })({ status: 'fehler', items: [{ art: 'betrag', stripe_id: 'pi_b_' + nr, bestell_id: best, betrag: z.cent, waehrung: z.w, text: 'abgleich_betrag' }] }));
    const al = gesendet.find((m) => m.to === 'alarm-betrag@example.net');
    ergebnis.abgleich.push([z, zeilenVon(al).includes('pi_b_' + nr + ' · ' + z.s + ' · ' + T[z.l].abgleich_betrag), zeilenVon(al).find((x) => x.startsWith('pi_b_')) || 'keine Mail']);
  }
  const NAMEN = { kauf: 'Kaufmail (Kunde)', kunde: 'Widerrufsmail Kunde', inhaber: 'Widerrufsmail Inhaberin (Standardsprache)', warnung: 'Widerrufs-Warnmail (Standardsprache)',
    aboerst: 'Abo-Erstattungsmail', meldung: 'Geschaeftsmeldung (Ereignis)', abgleich: 'Abgleich-Alarm' };
  for (const [typ, liste] of Object.entries(ergebnis)) {
    for (const l of SPRACHEN) for (const w of ['eur', 'huf']) {
      const teil = liste.filter(([z]) => z.l === l && z.w === w);
      const falsch = teil.filter(([, gut]) => !gut);
      pruefe(`${NAMEN[typ]} [${l}] ${w}: ${teil.length} Betraege richtig (z. B. "${teil[5]?.[0].s}")`, teil.length === 8 && falsch.length === 0, falsch.slice(0, 3).map(([z, , ist]) => z.name + ' -> ' + ist).join(' | '));
    }
  }
  // Bekannter Fehler (Backlog b): EN-Widerrufsmail zeigte "59,00 EUR"
  const enWiderruf = ergebnis.kunde.find(([z]) => z.l === 'en' && z.w === 'eur' && z.cent === 5900);
  pruefe('Bekannter Fehler behoben: EN-Widerrufsmail zeigt "Amount: 59.00 EUR" (nicht "59,00 EUR")', enWiderruf?.[1] === true && enWiderruf?.[2] === T.en.k_fiokom_betrag + ': 59.00 EUR', enWiderruf?.[2]);
  pruefe('Keine Mail enthaelt geschuetzte Leerzeichen (U+00A0/U+202F) im Betrag', Object.values(ergebnis).flat().every(([, , ist]) => !/[\u00a0\u202f]/.test(ist)));

  // ---------- 4. Nur EINE Formatierungsstelle ----------
  const quelle = (p) => readFileSync(join(PLATTFORM, p), 'utf8');
  const mail = quelle('mail.mjs') + String.fromCharCode(10) + quelle('kaufmail-vorlage.mjs'), alarm = quelle('abgleich-alarm.mjs'), betrag = quelle('betrag.mjs'), kunde = quelle('public/kunde.js');
  pruefe('mail.mjs: keine eigene Betragsformatierung mehr (kein " Ft", kein Intl, kein formatGanzeEinheiten), alle Betraege ueber geldText/formatGeldEinheiten',
    !/' Ft'|Intl\.NumberFormat|formatGanzeEinheiten|toFixed\(/.test(mail) && (mail.match(/geldText\(/g) || []).length === 4 && mail.includes('formatGeldEinheiten(e.betrag,e.waehrung,sprache())'));
  pruefe('abgleich-alarm.mjs: Betrag ueber formatGeld in der Mailsprache, nicht mehr roh', alarm.includes('formatGeld(x.betrag,x.waehrung,sprache())') && !alarm.includes("String(x.betrag??'-')"));
  pruefe('betrag.mjs ruft die gemeinsame Funktion betragText aus public/preis.js (kein eigenes Intl)', betrag.includes("import { betragText, formatGanzeEinheiten } from './public/preis.js'") && !/Intl\.NumberFormat/.test(betrag));
  pruefe('kunde.js: Betraege nur ueber formatBetrag (kein toFixed/Intl/" Ft"/" EUR")', !/toFixed\(2\)|Intl\.NumberFormat|' Ft'|' EUR'/.test(kunde) && (kunde.match(/formatBetrag\(/g) || []).length >= 4);
  const platzhalter = SPRACHEN.flatMap((l) => Object.entries(T[l]).filter(([, v]) => /\{(betrag|osszeg|summe|preis|amount|geld)\}/i.test(v)).map(([k]) => l + ':' + k));
  pruefe('texte/*.json: keine Betrags-Platzhalter, die an der Funktion vorbei formatiert werden koennten', platzhalter.length === 0, platzhalter.join(','));
} catch (e) { fail++; console.log('FEHLER Ausnahme: ' + (e?.stack || e).toString().slice(0, 600)); }
finally { try { rmSync(ordner, { recursive: true, force: true }); } catch { /* Windows: Datei evtl. gesperrt */ } }
console.log(`Betragformat: ${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
