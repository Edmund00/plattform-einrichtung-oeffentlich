// Plattform-Zeilen (Dashboard-Anbindung, Schritt 3): haelt Kunden-Abos und Zahlungen im Plattform-Sheet aktuell.
// Datenbank-Trigger merken jede Aenderung an Bestellungen, Abos und Kundendaten in plattform_zeilen vor (offen, Version hoch). Der Sender in
// plattform-meldung.mjs baut die Zeile beim Senden FRISCH aus der Datenbank (nie veraltete Werte) und meldet sie als 'zeile' an das Script.
// Triggers existieren nur, solange die Plattform-Meldung an ist (sonst werden sie beim Start entfernt). Aenderungen an Kurstiteln heilt der taegliche Abgleich.
import { db } from './db.mjs';

db.exec(`
CREATE TABLE IF NOT EXISTS plattform_zeilen (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 blatt TEXT NOT NULL,
 schluessel TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','gesendet','verworfen')),
 versuche INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1,
 geaendert INTEGER NOT NULL DEFAULT 0,
 UNIQUE(blatt, schluessel)
);
CREATE INDEX IF NOT EXISTS plattform_zeilen_offen ON plattform_zeilen(status, id);
`);
// Zeilen, die nicht aus der Datenbank gebaut werden (Auszahlungen, Streitfaelle von Stripe), tragen ihre Werte als JSON in der Spalte daten.
if (!db.prepare('PRAGMA table_info(plattform_zeilen)').all().some((c) => c.name === 'daten')) db.exec('ALTER TABLE plattform_zeilen ADD COLUMN daten TEXT');

// Stripe-Daten je Zahlung (Gebuehr, Netto, Beleg-Link) einmal holen und zwischenspeichern (kein erneuter API-Aufruf).
db.exec(`
CREATE TABLE IF NOT EXISTS plattform_stripe (
 zahlung_id TEXT PRIMARY KEY,
 gebuehr INTEGER, netto INTEGER, beleg TEXT, geholt INTEGER NOT NULL DEFAULT 0
);
`);

// Streitfaelle von Stripe (Betrag, Gebuehr, Stand) je Zahlung: damit Zahlung, "Zahlung pruefen" und Streitfall zusammenpassen (eine Zeile je Streitfall).
db.exec(`
CREATE TABLE IF NOT EXISTS plattform_streit (
 streit_id TEXT PRIMARY KEY,
 zahlung_id TEXT, betrag INTEGER, waehrung TEXT, gebuehr INTEGER, stand TEXT, geholt INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS plattform_streit_zahlung ON plattform_streit(zahlung_id);
`);
// Stand eines Streitfalls: entzieht Stripe das Geld (Zahlung gilt als angefochten)? Anfragen (warning_*) entziehen nichts.
const STREIT_ENTZIEHT = ['needs_response', 'under_review', 'lost'];

const MERKEN = (blatt, schluesselSql, quelle = '') =>
  `INSERT INTO plattform_zeilen(blatt,schluessel,status,versuche,version,geaendert) ${quelle ? 'SELECT' : 'VALUES ('}'${blatt}',${schluesselSql},'offen',0,1,0${quelle ? ' ' + quelle : ')'}
   ON CONFLICT(blatt,schluessel) DO UPDATE SET status='offen',versuche=0,version=version+1,geaendert=0;`;

// Probleme (Reiter "Probleme"): Erstattung, Zahlung pruefen, Abo-Zahlung offen. Eine Zeile wird angelegt, sobald der Zustand eintritt, und weiter
// gepflegt (Grund wird "erledigt"), wenn er endet. Die Zeile verschwindet nie (das Script loescht nichts).
const gibtZeile = (blatt, praefix, id) => `EXISTS (SELECT 1 FROM plattform_zeilen WHERE blatt='${blatt}' AND schluessel='${praefix}'||${id})`;
const PROBLEME_BESTELLUNG = [
  MERKEN('Probleme', "'erstattung:'||NEW.id", "WHERE NEW.status='erstattet'"),
  MERKEN('Probleme', "'pruefen:'||NEW.id", `WHERE NEW.status='pruefen' OR ${gibtZeile('Probleme', 'pruefen:', 'NEW.id')}`),
].join('\n');
const PROBLEM_ABO = MERKEN('Probleme', "'offen:'||NEW.id", `WHERE NEW.status='zahlung_offen' OR ${gibtZeile('Probleme', 'offen:', 'NEW.id')}`);

const TRIGGER = {
  plattform_t_abos_i: `AFTER INSERT ON abos BEGIN ${MERKEN('Kunden-Abos', "'abo:'||NEW.id")} ${PROBLEM_ABO} END`,
  plattform_t_abos_u: `AFTER UPDATE ON abos BEGIN ${MERKEN('Kunden-Abos', "'abo:'||NEW.id")} ${PROBLEM_ABO} END`,
  plattform_t_best_i: `AFTER INSERT ON bestellungen BEGIN
    ${PROBLEME_BESTELLUNG}
    ${MERKEN('Zahlungen', "'zahlung:'||NEW.id")}
    ${MERKEN('Kunden-Abos', "'kauf:'||NEW.id", "WHERE NEW.art='einmal'")}
    ${MERKEN('Kunden-Abos', "'abo:'||id", "FROM abos WHERE NEW.art='abo' AND stripe_abo=NEW.stripe_abo")}
  END`,
  plattform_t_best_u: `AFTER UPDATE ON bestellungen BEGIN
    ${PROBLEME_BESTELLUNG}
    ${MERKEN('Zahlungen', "'zahlung:'||NEW.id")}
    ${MERKEN('Kunden-Abos', "'kauf:'||NEW.id", "WHERE NEW.art='einmal'")}
    ${MERKEN('Kunden-Abos', "'abo:'||id", "FROM abos WHERE NEW.art='abo' AND stripe_abo=NEW.stripe_abo")}
  END`,
  plattform_t_user_u: `AFTER UPDATE OF email, anzeigename, rechnung_name ON benutzer BEGIN
    ${MERKEN('Kunden-Abos', "'abo:'||id", 'FROM abos WHERE benutzer_id=NEW.id')}
    ${MERKEN('Kunden-Abos', "'kauf:'||id", "FROM bestellungen WHERE benutzer_id=NEW.id AND art='einmal'")}
    ${MERKEN('Zahlungen', "'zahlung:'||id", 'FROM bestellungen WHERE benutzer_id=NEW.id')}
  END`,
};

export function triggerSetzen(an) {
  for (const [name, rumpf] of Object.entries(TRIGGER)) {
    db.exec(`DROP TRIGGER IF EXISTS ${name}`);
    if (an) db.exec(`CREATE TRIGGER ${name} ${rumpf}`);
  }
}

// ---- Zeilen frisch aus der Datenbank bauen ----------------------------------------------------------------------------------
const utc = (v) => {
  if (v == null || v === '') return '';
  const ms = typeof v === 'number' ? (v < 1e11 ? v * 1000 : v) : Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 19).replace('T', ' ') : '';
};
const tag = (v) => utc(v).slice(0, 10);
const ganz = (kleinste) => (Number.isSafeInteger(kleinste) ? kleinste / 100 : null);   // wie ganzeEinheiten() der Ereignisse
// Geloeschte Konten tragen eine Platzhalter-Adresse (geloescht-N@invalid.invalid): im Sheet als "gelöschter Kunde" ohne Adresse zeigen.
const geloescht = (email) => typeof email === 'string' && email.endsWith('@invalid.invalid');
const mail = (u) => (geloescht(u?.email) ? '' : String(u?.email || ''));
const kunde = (u) => String(u?.rechnung_name || u?.anzeigename || (geloescht(u?.email) ? 'gelöschter Kunde' : '')).slice(0, 120);
const STATUS_BESTELLUNG = { bezahlt: 'bezahlt', pruefen: 'prüfen', erstattet: 'erstattet' };
// Texte aus Kundeneingaben entschaerfen: Steuerzeichen (Zeilenumbruch usw.) werden zu Leerzeichen, ein fuehrendes = + - @ bekommt ein Leerzeichen davor
// (das Script lehnt solche Werte als moegliche Formel ab; ohne diese Entschaerfung wuerde die Zeile des Kunden nie im Sheet erscheinen).
const AT_ERLAUBT = ['E-Mail', 'Kunde'];   // nur in diesen Spalten darf ein @ stehen (gleiche Regel wie im Script)
const entschaerfen = (v, spalte) => {
  if (typeof v !== 'string') return v;
  let s = v.replace(/[\u0000-\u001f\u007f]/g, ' ');
  if (!AT_ERLAUBT.includes(spalte)) s = s.replace(/@/g, '(at)');   // zum Beispiel ein Kurstitel mit @: sonst wuerde das Script die ganze Zeile ablehnen
  return /^[=+@-]/.test(s) ? ' ' + s : s;
};
const nur = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, entschaerfen(v, k)]));

function kundenAbo(id, modus) {
  const a = db.prepare(`SELECT a.id,a.status,a.gueltig_bis,a.endet_zum_periodenende,a.erstellt,a.stripe_abo,u.email,u.anzeigename,u.rechnung_name,k.titel,
     COALESCE((SELECT betrag FROM bestellungen b WHERE b.stripe_abo=a.stripe_abo AND b.status IN ('bezahlt','erstattet') ORDER BY b.id DESC LIMIT 1), k.abo_preis_cent) AS betrag,
     COALESCE((SELECT waehrung FROM bestellungen b WHERE b.stripe_abo=a.stripe_abo AND b.status IN ('bezahlt','erstattet') ORDER BY b.id DESC LIMIT 1), k.waehrung) AS waehrung
     FROM abos a JOIN benutzer u ON u.id=a.benutzer_id JOIN kurse k ON k.id=a.kurs_id WHERE a.id=?`).get(id);
  if (!a) return null;
  const status = a.status === 'aktiv' ? (a.endet_zum_periodenende ? 'gekündigt zum ' + tag(a.gueltig_bis) : 'aktiv')
    : a.status === 'zahlung_offen' ? 'Zahlung offen' : a.status === 'gekuendigt' ? 'gekündigt' : 'beendet';
  return nur({
    Kunde: kunde(a), 'E-Mail': mail(a), Kurs: String(a.titel || '').slice(0, 200), 'Art (Kauf/Abo)': 'Abo', Status: status,
    Betrag: ganz(a.betrag), 'Währung': a.waehrung ? String(a.waehrung).toUpperCase() : null,
    Seit: utc(a.erstellt), 'Bezahlt bis / nächste Abbuchung': tag(a.gueltig_bis), 'Test/Live': modus,
  });
}

function kauf(id, modus) {
  const b = db.prepare(`SELECT b.id,b.betrag,b.waehrung,b.status,b.art,b.erstellt,u.email,u.anzeigename,u.rechnung_name,k.titel
     FROM bestellungen b LEFT JOIN benutzer u ON u.id=b.benutzer_id LEFT JOIN kurse k ON k.id=b.kurs_id WHERE b.id=? AND b.art='einmal'`).get(id);
  if (!b) return null;
  return nur({
    Kunde: kunde(b), 'E-Mail': mail(b), Kurs: String(b.titel || '').slice(0, 200), 'Art (Kauf/Abo)': 'Kauf', Status: STATUS_BESTELLUNG[b.status] || String(b.status),
    Betrag: ganz(b.betrag), 'Währung': String(b.waehrung || '').toUpperCase(), Seit: utc(b.erstellt), 'Test/Live': modus,
  });
}

function zahlung(id, modus) {
  const b = db.prepare(`SELECT b.id,b.betrag,b.waehrung,b.status,b.grund,b.erstellt,b.zahlung_id,b.stripe_sitzung,u.anzeigename,u.rechnung_name,u.email,k.titel
     FROM bestellungen b LEFT JOIN benutzer u ON u.id=b.benutzer_id LEFT JOIN kurse k ON k.id=b.kurs_id WHERE b.id=?`).get(id);
  if (!b) return null;
  // Gebuehr/Netto/Beleg: bei Abo-Zahlungen ohne gemerkte Zahlungs-ID (aeltere Bestellungen) liegen sie unter der Sitzungs-/Rechnungs-ID
  const s = db.prepare('SELECT gebuehr,netto,beleg FROM plattform_stripe WHERE zahlung_id=?').get(b.zahlung_id || b.stripe_sitzung || '');
  const streit = b.zahlung_id ? db.prepare('SELECT stand FROM plattform_streit WHERE zahlung_id=?').all(b.zahlung_id) : [];
  // Gibt es Streitfall-Zeilen von Stripe, zaehlt ihr Stand (entzieht Stripe das Geld?). Ohne sie gilt der Zustand der Bestellung (pruefen + streitfall).
  const angefochten = streit.length ? streit.some((x) => STREIT_ENTZIEHT.includes(x.stand)) : b.status === 'pruefen' && b.grund === 'streitfall';
  // Gewonnener Streit: das Geld ist zurueck (die Bestellung bleibt zur Freigabe des Zugangs auf "pruefen", das ist eine Entscheidung von Gabriella)
  const gewonnen = !angefochten && streit.some((x) => x.stand === 'won') && b.status === 'pruefen' && b.grund === 'streitfall';
  const status = angefochten && (b.status === 'bezahlt' || b.status === 'pruefen') ? 'Streitfall' : gewonnen ? 'bezahlt' : STATUS_BESTELLUNG[b.status] || String(b.status);
  return nur({
    Datum: utc(b.erstellt), Kunde: kunde(b) || mail(b), Kurs: String(b.titel || '').slice(0, 200), Brutto: ganz(b.betrag), 'Gebühr': s ? ganz(s.gebuehr) : null, Netto: s ? ganz(s.netto) : null, 'Stripe-Beleg-Link': s?.beleg || null,
    'Währung': String(b.waehrung || '').toUpperCase(), Status: status, 'Test/Live': modus,
  });
}

// Holt Gebuehr, Netto und Beleg-Link einer Zahlung bei Stripe (nur lesend, nur pi_...) und merkt sie. Fehler: kein Eintrag, die Zeile geht ohne diese Werte hinaus,
// der Abgleich (Start/taeglich) versucht es erneut.
export async function stripeAnreichern(stripe, schluessel, jetzt = Date.now) {
  try {
    const m = /^zahlung:(\d{1,12})$/.exec(String(schluessel));
    if (!stripe || !m) return false;
    const b = db.prepare('SELECT zahlung_id,stripe_sitzung,art FROM bestellungen WHERE id=?').get(Number(m[1]));
    let pi = b?.zahlung_id;
    // Schluessel der gemerkten Stripe-Daten: die Zahlungs-ID; bei aelteren Abo-Bestellungen ohne Zahlungs-ID die Sitzungs-/Rechnungs-ID
    const merk = typeof pi === 'string' && pi ? pi : b?.stripe_sitzung;
    if (typeof merk !== 'string' || !merk) return false;
    if (db.prepare('SELECT 1 FROM plattform_stripe WHERE zahlung_id=?').get(merk)) return true;
    if (typeof pi !== 'string' || !pi) {
      // nur Abo-Bestellungen: Zahlung ueber die Rechnung (in_...) bzw. die Checkout-Sitzung (cs_...) finden, nur lesend
      if (b?.art !== 'abo') return false;
      let rechnung = merk;
      if (/^cs_[A-Za-z0-9_]{8,200}$/.test(merk)) {
        const sitzung = await stripe.checkout.sessions.retrieve(merk);
        rechnung = typeof sitzung?.invoice === 'string' ? sitzung.invoice : sitzung?.invoice?.id;
      }
      if (typeof rechnung !== 'string' || !/^in_[A-Za-z0-9]{8,80}$/.test(rechnung)) return false;
      const zahlungen = await stripe.invoicePayments.list({ invoice: rechnung, limit: 5 });
      const z = (zahlungen?.data || []).find((x) => x?.status === 'paid' && x?.payment?.type === 'payment_intent');
      const pid = typeof z?.payment?.payment_intent === 'string' ? z.payment.payment_intent : z?.payment?.payment_intent?.id;
      if (typeof pid !== 'string') return false;
      pi = pid;
    }
    if (!/^pi_[A-Za-z0-9]{8,80}$/.test(pi)) return false;
    const p = await stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge.balance_transaction'] });
    const c = p?.latest_charge, bt = c?.balance_transaction;
    if (!c || !bt || !Number.isSafeInteger(bt.fee) || !Number.isSafeInteger(bt.net)) return false;
    const beleg = typeof c.receipt_url === 'string' && c.receipt_url.startsWith('https://') && c.receipt_url.length <= 290 && !/[\s"'<>@]/.test(c.receipt_url) ? c.receipt_url : null;
    db.prepare('INSERT OR REPLACE INTO plattform_stripe(zahlung_id,gebuehr,netto,beleg,geholt) VALUES (?,?,?,?,?)').run(merk, bt.fee, bt.net, beleg, jetzt());
    return true;
  } catch { console.warn('Plattform-Zeilen: Stripe-Daten nicht geholt'); return false; }
}

// Liefert die Werte der Zeile oder null, wenn die Quelle nicht mehr existiert (dann wird die Meldung verworfen).
export function zeileBauen(blatt, schluessel, modus) {
  const x = /^(auszahlung|streit|abgleich):([A-Za-z0-9_]{5,60})$/.exec(String(schluessel));
  if (x) {   // von Stripe/Abgleich geholt: Werte stehen als JSON in plattform_zeilen.daten (Modus wird beim Bauen gesetzt)
    if ((x[1] === 'auszahlung') !== (blatt === 'Auszahlungen') || (x[1] !== 'auszahlung' && blatt !== 'Probleme')) return null;
    const r = db.prepare('SELECT daten FROM plattform_zeilen WHERE blatt=? AND schluessel=?').get(blatt, schluessel);
    try {
      if (!r?.daten) return null;
      const w = { ...JSON.parse(r.daten), 'Test/Live': modus };
      // Streitfall: Direktlink zum Fall im Stripe-Dashboard (Test oder Live, je nach Modus der Plattform). Die ID kommt aus dem Zeilenschluessel.
      if (x[1] === 'streit') w['Stripe-Link'] = 'https://dashboard.stripe.com/' + (modus === 'Live' ? '' : 'test/') + 'disputes/' + x[2];
      return nur(w);
    } catch { return null; }
  }
  const m = /^(abo|kauf|zahlung|erstattung|pruefen|offen):(\d{1,12})$/.exec(String(schluessel));
  if (!m) return null;
  const id = Number(m[2]);
  if (blatt === 'Kunden-Abos' && m[1] === 'abo') return kundenAbo(id, modus);
  if (blatt === 'Kunden-Abos' && m[1] === 'kauf') return kauf(id, modus);
  if (blatt === 'Zahlungen' && m[1] === 'zahlung') return zahlung(id, modus);
  if (blatt === 'Probleme' && (m[1] === 'erstattung' || m[1] === 'pruefen')) return problemBestellung(m[1], id, modus);
  if (blatt === 'Probleme' && m[1] === 'offen') return problemAbo(id, modus);
  return null;
}

function problemBestellung(art, id, modus) {
  const b = db.prepare(`SELECT b.id,b.betrag,b.waehrung,b.status,b.grund,b.zahlung_id,b.geaendert,u.anzeigename,u.rechnung_name,u.email,k.titel
     FROM bestellungen b LEFT JOIN benutzer u ON u.id=b.benutzer_id LEFT JOIN kurse k ON k.id=b.kurs_id WHERE b.id=?`).get(id);
  if (!b) return null;
  const summe = ganz(b.betrag) + ' ' + String(b.waehrung || '').toUpperCase();
  const aktiv = art === 'erstattung' ? b.status === 'erstattet' : b.status === 'pruefen';
  // Streitfall: Er steht schon als eigene Zeile (Art Streitfall, von Stripe). Die Zeile "Zahlung pruefen" derselben Zahlung wuerde ihn doppelt zaehlen.
  // Nur solange Stripe das Geld entzieht. Ist der Streit gewonnen/beendet, bleibt "Zahlung pruefen" offen: Gabriella entscheidet ueber den Zugang.
  const alsStreit = art === 'pruefen' && b.grund === 'streitfall' && !!b.zahlung_id
    && !!db.prepare(`SELECT 1 FROM plattform_streit WHERE zahlung_id=? AND stand IN ('needs_response','under_review','lost')`).get(b.zahlung_id);
  const grund = alsStreit ? 'erledigt (wird als Streitfall geführt)' : !aktiv ? 'erledigt (Status jetzt: ' + b.status + ')'
    : art === 'erstattung' ? 'Erstattet: ' + summe + ', ' + String(b.titel || '') + (b.grund === 'teilerstattung' ? ' (teilweise)' : '')
    : 'Zahlung braucht Prüfung: ' + summe + ', ' + String(b.titel || '') + (b.grund ? ' (' + b.grund + ')' : '');
  return nur({ Datum: utc(b.geaendert), Art: art === 'erstattung' ? 'Erstattung' : 'Zahlung prüfen', Kunde: kunde(b) || mail(b), Grund: grund.slice(0, 280), 'Test/Live': modus });
}

function problemAbo(id, modus) {
  const a = db.prepare(`SELECT a.id,a.status,a.geaendert,u.anzeigename,u.rechnung_name,u.email,k.titel FROM abos a JOIN benutzer u ON u.id=a.benutzer_id JOIN kurse k ON k.id=a.kurs_id WHERE a.id=?`).get(id);
  if (!a) return null;
  const grund = a.status === 'zahlung_offen' ? 'Abo-Zahlung steht aus: ' + String(a.titel || '') : 'erledigt (Status jetzt: ' + a.status + ')';
  return nur({ Datum: utc(a.geaendert), Art: 'Zahlung offen', Kunde: kunde(a) || mail(a), Grund: grund.slice(0, 280), 'Test/Live': modus });
}

// Zeile mit Werten von Stripe setzen (Auszahlung, Streitfall). Unveraenderte Werte werden nicht erneut gesendet.
export function externSetzen(blatt, schluessel, werte) {
  const json = JSON.stringify(werte);
  const r = db.prepare('SELECT daten FROM plattform_zeilen WHERE blatt=? AND schluessel=?').get(blatt, schluessel);
  if (r && r.daten === json) return false;
  db.prepare(`INSERT INTO plattform_zeilen(blatt,schluessel,status,versuche,version,geaendert,daten) VALUES (?,?,'offen',0,1,0,?)
     ON CONFLICT(blatt,schluessel) DO UPDATE SET status='offen',versuche=0,version=version+1,geaendert=0,daten=excluded.daten`).run(blatt, schluessel, json);
  return true;
}

// Listen bei Stripe seitenweise lesen (hoechstens 5 Seiten zu je 100, nur lesend).
async function seiten(liste) {
  const alle = []; let nach = null;
  for (let i = 0; i < 5; i++) {
    const l = await liste({ limit: 100, ...(nach ? { starting_after: nach } : {}) });
    const daten = Array.isArray(l?.data) ? l.data : [];
    alle.push(...daten);
    if (!l?.has_more || !daten.length || typeof daten[daten.length - 1]?.id !== 'string') break;
    nach = daten[daten.length - 1].id;
  }
  return alle;
}

// Auszahlungen und Streitfaelle bei Stripe lesen (nur lesend) und als Zeilen vormerken. Fehler: wird beim naechsten Abgleich wiederholt.
export async function stripeAbgleichen(stripe, jetztMs = Date.now) {
  let neu = 0;
  if (!stripe) return 0;
  const waehr = (c) => String(c || '').toUpperCase();
  const STATUS = { paid: 'bezahlt', pending: 'unterwegs', in_transit: 'unterwegs', failed: 'fehlgeschlagen', canceled: 'storniert' };
  try {
    for (const p of await seiten((x) => stripe.payouts.list(x))) {
      if (!/^po_[A-Za-z0-9]{5,60}$/.test(String(p.id)) || !Number.isSafeInteger(p.amount)) continue;
      if (externSetzen('Auszahlungen', 'auszahlung:' + p.id, { Datum: tag(p.arrival_date), Betrag: ganz(p.amount), 'Währung': waehr(p.currency), Status: STATUS[p.status] || String(p.status) })) neu++;
    }
  } catch { console.warn('Plattform-Zeilen: Auszahlungen nicht gelesen'); }
  try {
    for (const d of await seiten((x) => stripe.disputes.list(x))) {
      if (!/^(dp|du)_[A-Za-z0-9]{5,60}$/.test(String(d.id)) || !Number.isSafeInteger(d.amount)) continue;
      const grund = ('Streitfall (' + String(d.reason || 'unbekannt') + '): ' + ganz(d.amount) + ' ' + waehr(d.currency) + ', Stand: ' + String(d.status || '')).slice(0, 280);
      // Zahlung (pi_...) und Kunde zuordnen; Streitgebuehr aus den Salden-Buchungen des Streitfalls (nur wenn in derselben Waehrung)
      const pi = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id;
      const b = typeof pi === 'string' && /^pi_[A-Za-z0-9]{8,80}$/.test(pi)
        ? db.prepare('SELECT b.id,b.erstellt,k.titel,u.anzeigename,u.rechnung_name,u.email FROM bestellungen b LEFT JOIN benutzer u ON u.id=b.benutzer_id LEFT JOIN kurse k ON k.id=b.kurs_id WHERE b.zahlung_id=? LIMIT 1').get(pi) : null;
      const bts = Array.isArray(d.balance_transactions) ? d.balance_transactions.filter((x) => x && x.currency === d.currency && Number.isSafeInteger(x.fee) && x.fee > 0) : [];
      const gebuehr = bts.length ? bts.reduce((s, x) => s + x.fee, 0) : null;
      const stand = String(d.status || '').slice(0, 40);
      db.prepare(`INSERT INTO plattform_streit(streit_id,zahlung_id,betrag,waehrung,gebuehr,stand,geholt) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(streit_id) DO UPDATE SET zahlung_id=excluded.zahlung_id,betrag=excluded.betrag,waehrung=excluded.waehrung,gebuehr=excluded.gebuehr,stand=excluded.stand,geholt=excluded.geholt`)
        .run(String(d.id), b ? pi : null, d.amount, waehr(d.currency), gebuehr, stand, jetztMs());
      const werte = { Datum: tag(d.created), Art: 'Streitfall', Kunde: b ? kunde(b) || mail(b) : '', Grund: grund, Betrag: ganz(d.amount), 'Währung': waehr(d.currency), 'Gebühr': gebuehr === null ? null : ganz(gebuehr), Stand: stand,
        Kurs: b ? String(b.titel || '').slice(0, 200) : null, 'Zahlung (Datum)': b ? utc(b.erstellt) : null };
      if (externSetzen('Probleme', 'streit:' + d.id, werte)) neu++;
      if (b) {   // Zahlung und "Zahlung pruefen" derselben Zahlung neu aufbauen (Status "Streitfall", Doppelzaehlung weg)
        for (const [blatt, schl] of [['Zahlungen', 'zahlung:' + b.id], ['Probleme', 'pruefen:' + b.id]]) {
          db.prepare(`UPDATE plattform_zeilen SET status='offen',versuche=0,version=version+1,geaendert=0 WHERE blatt=? AND schluessel=? AND status!='verworfen'`).run(blatt, schl);
        }
      }
    }
  } catch { console.warn('Plattform-Zeilen: Streitfaelle nicht gelesen'); }
  neu += abgleichUebernehmen();
  stripeDatenNachholen();   // vormerken, nicht mitgezaehlt (Wiederholung von Zeilen, keine neuen)
  return neu;
}

// Zahlungen ohne gemerkte Stripe-Daten (Gebuehr/Netto/Beleg) erneut vormerken: beim Senden wird nachgeholt (hoechstens 20 je Lauf, nur Bezahlte/Erstattete).
function stripeDatenNachholen() {
  return Number(db.prepare(`UPDATE plattform_zeilen SET status='offen',versuche=0,version=version+1,geaendert=0
    WHERE id IN (SELECT z.id FROM plattform_zeilen z JOIN bestellungen b ON z.schluessel='zahlung:'||b.id
      WHERE z.blatt='Zahlungen' AND z.status='gesendet' AND b.status IN ('bezahlt','erstattet')
        AND b.betrag>0 AND (substr(b.zahlung_id,1,3)='pi_' OR b.art='abo')
        AND NOT EXISTS (SELECT 1 FROM plattform_stripe s WHERE s.zahlung_id=COALESCE(NULLIF(b.zahlung_id,''),b.stripe_sitzung))
      ORDER BY RANDOM() LIMIT 20)`).run().changes);
}

// Ergebnis des bestehenden Plattform-Abgleichs (Stripe gegen Bestellungen, Tabellen abgleich_lauf/abgleich_abweichung) ins Sheet uebernehmen:
// je Art eine Zeile (Anzahl, Summe) plus eine Statuszeile. Arten, die im letzten Lauf nicht mehr vorkommen, werden "erledigt".
const ABGLEICH_ART = {
  stripe_ohne_bestellung: 'Zahlung in Stripe ohne Bestellung in der Plattform', bestellung_ohne_stripe: 'Bestellung ohne Zahlung in Stripe', betrag: 'Betrag weicht ab',
  erstattung_nicht_verarbeitet: 'Erstattung in Stripe nicht verarbeitet', erstattung_ohne_stripe: 'Erstattung ohne Stripe-Erstattung', abo_status: 'Abo-Status weicht ab',
  abo_zugang: 'Abo-Zugang stimmt nicht', abo_nachgekuendigt: 'Abo nachgekündigt', streit_nicht_verarbeitet: 'Streitfall nicht verarbeitet', doppelkunde: 'Doppelter Kunde', summen: 'Summen weichen ab',
};
export function abgleichUebernehmen() {
  let neu = 0;
  try {
    const lauf = db.prepare('SELECT id,ende,status,abweichungen_anzahl FROM abgleich_lauf ORDER BY id DESC LIMIT 1').get();
    if (!lauf) return 0;
    const zeile = utc(lauf.ende);
    // je Art UND Waehrung eine Zeile (keine Mischsummen). Der Betrag steht nur im Text, nicht in der Spalte Betrag: die Spalte gehoert den Streitfaellen,
    // damit niemand Abgleich-Summen versehentlich als Geldbewegung zaehlt.
    const arten = db.prepare("SELECT art,COALESCE(waehrung,'') AS w,COUNT(*) AS n,SUM(COALESCE(betrag,0)) AS summe FROM abgleich_abweichung WHERE lauf_id=? GROUP BY art,COALESCE(waehrung,'')").all(lauf.id);
    const gesehen = new Set();
    for (const a of arten) {
      const art = /^[a-z_]{3,40}$/.test(String(a.art)) ? a.art : 'andere';
      const w = /^[A-Za-z]{3}$/.test(a.w) ? a.w.toLowerCase() : '';
      const schl = 'abgleich:' + art + (w ? '_' + w : '');
      gesehen.add(schl);
      const text = ABGLEICH_ART[art] || 'Abweichung';
      const betrag = Number.isSafeInteger(a.summe) && a.summe > 0 ? ganz(a.summe) : null;
      if (externSetzen('Probleme', schl, { Datum: tag(lauf.ende), Art: 'Stripe-Abgleich', Kunde: '', Grund: (text + ': ' + a.n + 'x' + (betrag !== null ? ', zusammen ' + betrag + ' ' + waehrungKurz(w) : '') + ' (Lauf ' + zeile + ' UTC)').slice(0, 280), Stand: 'offen' })) neu++;
    }
    // frühere Arten, die jetzt nicht mehr vorkommen: erledigt
    // Ein fehlgeschlagener Lauf speichert keine Abweichungen: dann nichts als erledigt melden (nur die Statuszeile sagt, dass der Abgleich nicht lief).
    for (const r of lauf.status === 'fehler' ? [] : db.prepare("SELECT schluessel,daten FROM plattform_zeilen WHERE blatt='Probleme' AND schluessel LIKE 'abgleich:%' AND schluessel!='abgleich:status'").all()) {
      if (gesehen.has(r.schluessel)) continue;
      let alt; try { alt = JSON.parse(r.daten || '{}'); } catch { alt = {}; }
      if (alt.Stand === 'erledigt') continue;
      if (externSetzen('Probleme', r.schluessel, { ...alt, Datum: tag(lauf.ende), Grund: 'erledigt (im Lauf ' + zeile + ' UTC nicht mehr vorhanden)', Stand: 'erledigt' })) neu++;
    }
    const gesamt = lauf.status === 'fehler' ? 'Abgleich konnte nicht laufen' : lauf.abweichungen_anzahl ? 'Letzter Abgleich: ' + lauf.abweichungen_anzahl + ' Abweichung(en)' : 'Letzter Abgleich: alles in Ordnung';
    if (externSetzen('Probleme', 'abgleich:status', { Datum: tag(lauf.ende), Art: 'Stripe-Abgleich', Kunde: '', Grund: (gesamt + ' (Lauf ' + zeile + ' UTC)').slice(0, 280), Stand: lauf.status === 'ok' ? 'erledigt' : 'offen' })) neu++;
  } catch { console.warn('Plattform-Zeilen: Abgleich nicht uebernommen'); }
  return neu;
}
const waehrungKurz = (w) => String(w || '').toUpperCase().slice(0, 3);

// Vollstaendiger Bestand (fuer den taeglichen Abgleich und den ersten Start): alle Zeilen als offen vormerken.
// voll=true (taeglich): ALLE Zeilen erneut offen setzen (Selbstheilung). voll=false (Start): nur fehlende Zeilen anlegen, vorhandene bleiben unveraendert.
export function alleVormerken(voll = true) {
  const sql = [
    "INSERT INTO plattform_zeilen(blatt,schluessel,status,versuche,version,geaendert) SELECT 'Kunden-Abos','abo:'||id,'offen',0,1,0 FROM abos WHERE true ON CONFLICT(blatt,schluessel) DO UPDATE SET status='offen',versuche=0,version=version+1,geaendert=0",
    "INSERT INTO plattform_zeilen(blatt,schluessel,status,versuche,version,geaendert) SELECT 'Kunden-Abos','kauf:'||id,'offen',0,1,0 FROM bestellungen WHERE art='einmal' ON CONFLICT(blatt,schluessel) DO UPDATE SET status='offen',versuche=0,version=version+1,geaendert=0",
    "INSERT INTO plattform_zeilen(blatt,schluessel,status,versuche,version,geaendert) SELECT 'Zahlungen','zahlung:'||id,'offen',0,1,0 FROM bestellungen WHERE true ON CONFLICT(blatt,schluessel) DO UPDATE SET status='offen',versuche=0,version=version+1,geaendert=0",
  ];
  sql.push(
    "INSERT INTO plattform_zeilen(blatt,schluessel,status,versuche,version,geaendert) SELECT 'Probleme','erstattung:'||id,'offen',0,1,0 FROM bestellungen WHERE status='erstattet' ON CONFLICT(blatt,schluessel) DO UPDATE SET status='offen',versuche=0,version=version+1,geaendert=0",
    "INSERT INTO plattform_zeilen(blatt,schluessel,status,versuche,version,geaendert) SELECT 'Probleme','pruefen:'||id,'offen',0,1,0 FROM bestellungen WHERE status='pruefen' ON CONFLICT(blatt,schluessel) DO UPDATE SET status='offen',versuche=0,version=version+1,geaendert=0",
    "INSERT INTO plattform_zeilen(blatt,schluessel,status,versuche,version,geaendert) SELECT 'Probleme','offen:'||id,'offen',0,1,0 FROM abos WHERE status='zahlung_offen' ON CONFLICT(blatt,schluessel) DO UPDATE SET status='offen',versuche=0,version=version+1,geaendert=0",
    "UPDATE plattform_zeilen SET status='offen',versuche=0,version=version+1,geaendert=0 WHERE daten IS NOT NULL AND status!='verworfen'",
  );
  let n = 0;
  for (const s of sql) {
    if (voll) n += Number(db.prepare(s).run().changes);
    else if (s.startsWith('INSERT')) n += Number(db.prepare(s.replace(/DO UPDATE SET .*$/, 'DO NOTHING')).run().changes);
  }
  return n;
}
