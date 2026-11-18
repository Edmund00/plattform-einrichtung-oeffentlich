// Abo-Webhooks: erst bestätigte Rechnung gewährt befristeten Zugang.
// Alle Funktionen laufen innerhalb der bestehenden Webhook-Transaktion.
import { db } from './db.mjs';
import { kaufVormerken } from './mail.mjs';
import { ereignisHinzufuegen, ganzeEinheiten } from './ereignis-liste.mjs';
export const KULANZ_MS = 3 * 86400000;
// L3: Stripe bucht die Folgerechnung erst kurz NACH dem Periodenende. Solange das Abo aktiv und nicht gekündigt ist, bleibt der Zugang
// deshalb zwei Tage über das Periodenende hinaus offen, damit keine Lücke entsteht (Kurs weg, Kaufen-Knopf, Doppelabo).
export const PUFFER_MS = 2 * 86400000;
const jetzt = () => new Date().toISOString();
const idAus = v => /^[1-9]\d{0,15}$/.test(String(v)) ? Number(v) : null;
const sid = v => typeof v === 'string' ? v : (typeof v?.id === 'string' ? v.id : null);
// F1/F2: Beendet ein Stripe-Abo sofort. Wer den Zugang entzieht oder voll erstattet, darf Stripe nicht weiter abbuchen lassen.
// Ist es bei Stripe schon beendet oder unbekannt (resource_missing), gilt das als Erfolg; jeder andere Fehler wird weitergegeben,
// damit der Aufrufer nichts als erledigt meldet.
export async function aboBeiStripeBeenden(stripe, stripeAboId) {
  if (typeof stripeAboId !== 'string' || !stripeAboId) return 'kein_abo';
  if (!stripe?.subscriptions?.cancel) throw new Error('Stripe nicht verfuegbar');
  try {
    // Schon beendet (z. B. Wiederholung nach halbem Erfolg)? Dann nichts mehr tun.
    const s = await stripe.subscriptions.retrieve?.(stripeAboId);
    if (s?.status === 'canceled') return 'bereits';
  } catch (e) { if (e?.code === 'resource_missing') return 'fehlt'; throw e; }
  try { await stripe.subscriptions.cancel(stripeAboId); return 'beendet'; }
  catch (e) { if (e?.code === 'resource_missing') return 'fehlt'; throw e; }
}
// U2/I5: Jeder App-Weg, der den Abo-Zugang dauerhaft macht (Einladung, Freigabe) oder eine Abo-Zahlung ablehnt, muss das laufende Abo auch bei Stripe
// beenden, sonst bucht Stripe weiter ab. Erst Stripe (Fehler werden weitergegeben, der Aufrufer ändert dann nichts), dann in der App markieren.
// vorZeit (ISO-Zeit, optional): nur Abos, die nicht NACH diesem Zeitpunkt entstanden sind. So beendet das Ablehnen/Erstatten einer alten Prüf-Rechnung
// nie ein später abgeschlossenes, korrekt laufendes neues Abo desselben Kunden.
// eng (optional) = die Bestellung, um die es geht: kennt sie ihr Abo (stripe_abo), wird nur dieses beendet; sonst (alte Bestellungen) nur Abos, die nicht
// nach der Bestellung entstanden sind.
export function abosDerBestellung(benutzerId, kursId, eng) {
  if (eng?.stripe_abo) return db.prepare("SELECT id, stripe_abo FROM abos WHERE benutzer_id = ? AND kurs_id = ? AND status != 'beendet' AND stripe_abo = ?").all(benutzerId, kursId, eng.stripe_abo);
  if (eng?.erstellt) return db.prepare("SELECT id, stripe_abo FROM abos WHERE benutzer_id = ? AND kurs_id = ? AND status != 'beendet' AND erstellt <= ?").all(benutzerId, kursId, eng.erstellt);
  return db.prepare("SELECT id, stripe_abo FROM abos WHERE benutzer_id = ? AND kurs_id = ? AND status != 'beendet'").all(benutzerId, kursId);
}
export async function laufendeAbosBeendenStripe(stripe, benutzerId, kursId, eng = null) {
  const abos = abosDerBestellung(benutzerId, kursId, eng);
  for (const a of abos) await aboBeiStripeBeenden(stripe, a.stripe_abo);
  return abos.map(a => a.id);
}
export function abosBeendetSetzen(ids) {
  for (const id of ids) db.prepare("UPDATE abos SET status = 'beendet', geaendert = ? WHERE id = ?").run(jetzt(), id);
}
export const rechnungsAbo =o => sid(o?.subscription) || sid(o?.parent?.subscription_details?.subscription) || sid(o?.lines?.data?.[0]?.parent?.subscription_item_details?.subscription);
export function ereignisAbo(e) {
  const o=e.data?.object;
  if (e.type==='checkout.session.completed' && o?.mode==='subscription') return sid(o.subscription);
  if (e.type==='invoice.paid' || e.type==='invoice.payment_failed') return rechnungsAbo(o);
  if (['customer.subscription.updated','customer.subscription.deleted'].includes(e.type)) return sid(o?.id);
  return null;
}
function aboErmitteln(e,extra) {
  const name=ereignisAbo(e);
  if (!name) return null;
  let abo=db.prepare('SELECT * FROM abos WHERE stripe_abo=?').get(name);
  if (abo) return abo;
  const o=e.data?.object || {};
  const m=(o.metadata?.kurs_id ? o.metadata : null) ||
    (o.parent?.subscription_details?.metadata?.kurs_id ? o.parent.subscription_details.metadata : null) ||
    (o.subscription_details?.metadata?.kurs_id ? o.subscription_details.metadata : null) ||
    o.lines?.data?.find(x=>x.metadata?.kurs_id)?.metadata || extra?.metadata || {};
  const kursId=idAus(m.kurs_id), userId=idAus(m.benutzer_id);
  if (!kursId || !userId) return null; // Fremdes Stripe-Objekt ignorieren.
  const user=db.prepare('SELECT stripe_kunde FROM benutzer WHERE id=?').get(userId);
  if (!user || !db.prepare('SELECT 1 FROM kurse WHERE id=?').get(kursId)) return null;
  if ((o.customer || extra?.customer) && user.stripe_kunde !== (o.customer || extra?.customer)) return null;
  db.prepare("INSERT OR IGNORE INTO abos (stripe_abo,stripe_sitzung,benutzer_id,kurs_id,status,erstellt,geaendert) VALUES (?,?,?,?,'zahlung_offen',?,?)")
    .run(name, o.mode==='subscription' ? o.id : null, userId, kursId, jetzt(), jetzt());
  return db.prepare('SELECT * FROM abos WHERE stripe_abo=?').get(name);
}
// F-05: Besitzt der Benutzer den Kurs JETZT (gueltiger dauerhafter Zugang aus Zahlung/Einladung, oder ein laufendes und bezahltes anderes Abo)?
// Dann ist eine weitere Zahlung doppelt. Nachbesserung: eine alte bezahlte Bestellung allein zaehlt NICHT (z. B. nach Entzug durch den Admin ist ein
// Rueckkauf ein normaler Kauf mit Zugang). ohneAbo: das gerade verarbeitete Abo selbst zaehlt nicht.
export function kursSchonBezahlt(benutzerId, kursId, { ohneAbo = null } = {}) {
  return !!(db.prepare("SELECT 1 FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ? AND quelle IN ('zahlung','einladung') AND (gueltig_bis IS NULL OR gueltig_bis > ?)").get(benutzerId, kursId, Date.now())
    || db.prepare("SELECT 1 FROM abos a WHERE a.benutzer_id = ? AND a.kurs_id = ? AND (a.status IN ('aktiv','zahlung_offen') OR (a.status = 'gekuendigt' AND a.gueltig_bis > ?)) AND a.stripe_abo IS NOT ? AND EXISTS (SELECT 1 FROM bestellungen b WHERE b.stripe_abo = a.stripe_abo AND b.art = 'abo' AND b.status = 'bezahlt')").get(benutzerId, kursId, Date.now(), ohneAbo));
}

function zugangSetzen(a,bis) {
  if (!Number.isSafeInteger(bis) || bis<=0) return;
  db.prepare("INSERT OR IGNORE INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt,gueltig_bis) VALUES (?,?,'abo',?,?)")
    .run(a.benutzer_id,a.kurs_id,jetzt(),bis);
  db.prepare("UPDATE zugaenge SET gueltig_bis=? WHERE benutzer_id=? AND kurs_id=? AND quelle='abo'")
    .run(bis,a.benutzer_id,a.kurs_id);
}
// customer.subscription.updated ist kein Zahlungsereignis (Stripe): es darf einen vorhandenen Abo-Zugang nur anpassen, nie neu anlegen.
// Ein entzogener oder erstatteter Zugang bleibt damit weg, auch wenn das Abo bei Stripe noch laeuft.
function zugangAnpassen(a,bis) {
  if (!Number.isSafeInteger(bis) || bis<=0) return;
  db.prepare("UPDATE zugaenge SET gueltig_bis=? WHERE benutzer_id=? AND kurs_id=? AND quelle='abo'").run(bis,a.benutzer_id,a.kurs_id);
}
function aendern(a,status,bis,zeit,ende=a.endet_zum_periodenende) {
  db.prepare('UPDATE abos SET status=?,gueltig_bis=?,endet_zum_periodenende=?,letzte_ereignis_zeit=?,geaendert=? WHERE id=?')
    .run(status,bis,ende,zeit,jetzt(),a.id);
}
// A2-01: Abrechnungsintervall einer Abo-Rechnung (month/year). Quelle 1: unsere Metadaten (beim Checkout gesetzt, landen am Abo und an der Rechnung);
// Quelle 2: der Preis an der Rechnungszeile (aeltere Stripe-API). Unbekannt -> null (alte Abos ohne Metadaten werden nicht abgewiesen).
const INTERVALLE = new Set(['day','week','month','year']);
export function rechnungsIntervall(inv, extraMeta=null) {
  const kandidaten=[inv?.parent?.subscription_details?.metadata?.abo_intervall, inv?.subscription_details?.metadata?.abo_intervall,
    inv?.metadata?.abo_intervall, ...(inv?.lines?.data||[]).map(l=>l?.metadata?.abo_intervall), extraMeta?.abo_intervall,
    ...(inv?.lines?.data||[]).map(l=>l?.price?.recurring?.interval)];
  return kandidaten.find(x=>typeof x==='string'&&INTERVALLE.has(x)) ?? null;
}
function rechnungPruefen(a,inv,zahlungId=null,extraMeta=null) {
  const kurs=db.prepare('SELECT abo_preis_cent,waehrung,abo_intervall FROM kurse WHERE id=?').get(a.kurs_id);
  const user=db.prepare('SELECT stripe_kunde FROM benutzer WHERE id=?').get(a.benutzer_id);
  const betrag=inv.amount_paid, waehrung=String(inv.currency ?? '').toLowerCase();
  // Preis: der AKTUELLE Kurspreis ODER ein Betrag, den dieser Kunde für dieses Abo schon einmal bezahlt hat. Sonst würde eine spätere
  // Preisänderung des Kurses laufenden Abonnenten bei der nächsten Verlängerung den Zugang nehmen (Stripe belastet den alten Preis weiter).
  const bereitsBezahlt=!!db.prepare("SELECT 1 FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND art='abo' AND status IN ('bezahlt','erstattet') AND (grund IS NULL OR grund NOT IN ('betrag_waehrung','abo_beendet','abo_intervall','doppelt_bezahlt')) AND waehrung=? AND betrag=? AND stripe_sitzung<>?")
    .get(a.benutzer_id,a.kurs_id,waehrung,betrag,String(inv.id));
  // N3: Ein Betrag, den dieser Kunde für dieses Abo schon bezahlt hat, gilt auch dann, wenn der Kurs das Abo inzwischen abgeschaltet oder die Währung
  // geändert hat (Stripe belastet laufende Abos weiter zum alten Preis). Nur ein NEUER Betrag muss zum aktuellen Kurspreis passen.
  // A2-01: Ein NEUER Betrag muss auch zum aktuellen Intervall passen (sonst z. B. Jahr zum Monatspreis). Unbekanntes Intervall: kein Abweisen.
  const intervall=rechnungsIntervall(inv,extraMeta);
  const intervallPasst = !intervall || !kurs?.abo_intervall || intervall===kurs.abo_intervall;
  const betragPasst = !!kurs && kurs.abo_preis_cent != null && waehrung===kurs.waehrung && betrag===kurs.abo_preis_cent;
  const preisPasst = betragPasst && intervallPasst;
  // F-05: Zweites Abo (oder Abo neben dauerhaftem Zugang) fuer denselben Kurs: solange DIESES Abo noch keine bezahlte Rechnung hat, wird seine Zahlung
  // nicht still "bezahlt", sondern "pruefen" mit Meldung (Inhaberin erstattet/kuendigt). Ein schon bezahlt laufendes Abo bleibt bei Verlaengerungen unberuehrt.
  const ersteBezahlung=!db.prepare("SELECT 1 FROM bestellungen WHERE stripe_abo=? AND art='abo' AND status='bezahlt' AND stripe_sitzung<>?").get(a.stripe_abo,String(inv.id));
  const doppelt=!!kurs && !!user && ersteBezahlung && !db.prepare('SELECT 1 FROM bestellungen WHERE stripe_sitzung=?').get(String(inv.id))
    && kursSchonBezahlt(a.benutzer_id,a.kurs_id,{ohneAbo:a.stripe_abo});
  const gut=!!kurs && !!user && user.stripe_kunde===inv.customer && (preisPasst || bereitsBezahlt) && !doppelt;
  const grund=gut?null:doppelt&&user.stripe_kunde===inv.customer?'doppelt_bezahlt':betragPasst&&!intervallPasst&&!bereitsBezahlt?'abo_intervall':'betrag_waehrung';
  if (typeof inv.id !== 'string' || !inv.id.startsWith('in_')) return false;
  const eingefuegt=db.prepare("INSERT OR IGNORE INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,grund,art,stripe_abo,erstellt,geaendert) VALUES (?,?,?,?,?,?,?,?,'abo',?,?,?)")
    .run(inv.id,zahlungId,a.benutzer_id,a.kurs_id,
      Number.isSafeInteger(betrag)&&betrag>=0?betrag:0,waehrung,gut?'bezahlt':'pruefen',grund,a.stripe_abo,jetzt(),jetzt()).changes>0;
  // U3: Eine Abo-Zahlung zur Prüfung darf nie still bleiben (kein Zugang, Stripe bucht weiter): Meldung an die Inhaberin, einmal je Rechnung.
  if (!gut && eingefuegt)
    ereignisHinzufuegen('abo_gestartet','pruefen:'+inv.id,{benutzer_id:a.benutzer_id,kurs_id:a.kurs_id,
      betrag:ganzeEinheiten(Number.isSafeInteger(betrag)&&betrag>=0?betrag:0),waehrung,status:'pruefen'});
  if (zahlungId) db.prepare("UPDATE bestellungen SET zahlung_id=? WHERE stripe_sitzung=? AND (zahlung_id IS NULL OR zahlung_id='')").run(zahlungId,inv.id);
  return gut && db.prepare("SELECT status FROM bestellungen WHERE stripe_sitzung=?").get(inv.id)?.status==='bezahlt';
}
export function aboVerarbeiten(e,extra=null) {
  const a=aboErmitteln(e,extra);
  if (!a) return;
  const o=e.data?.object || {};
  const zeit=Number.isSafeInteger(e.created)&&e.created>=0?e.created:0, alt=a.letzte_ereignis_zeit;
  if (e.type==='checkout.session.completed') {
    // Checkout niemals als Zahlung behandeln. Eine frühere invoice.paid bleibt erhalten.
    if (!a.stripe_sitzung && typeof o.id==='string')
      db.prepare('UPDATE abos SET stripe_sitzung=? WHERE id=?').run(o.id,a.id);
    return;
  }
  if (e.type==='invoice.paid') {
    const bis=(o.lines?.data || []).reduce((m,x)=>Math.max(m,Number.isSafeInteger(x.period?.end)?x.period.end:0),0)*1000;
    // Zahlung für einen NEUEN Zeitraum, obwohl das Abo in der App schon beendet ist (Entzug, Erstattung, verspätetes Ereignis): Das Geld ist
    // eingegangen, aber ein beendetes Abo bekommt keinen Zugang zurück. Bestellung "pruefen" und Meldung, die Inhaberin entscheidet (Erstattung).
    if (a.status==='beendet') {
      if (typeof o.id !== 'string' || !o.id.startsWith('in_')) return;
      // Schon bekannte Rechnung (zweites Ereignis dazu): nur die Zahlungs-ID nachtragen, nichts anlegen, kein Zugang.
      if (db.prepare('SELECT 1 FROM bestellungen WHERE stripe_sitzung=?').get(o.id)) {
        if (extra?.rechnungZahlungId) db.prepare("UPDATE bestellungen SET zahlung_id=? WHERE stripe_sitzung=? AND (zahlung_id IS NULL OR zahlung_id='')").run(extra.rechnungZahlungId,o.id);
        return;
      }
      const betrag=Number.isSafeInteger(o.amount_paid)&&o.amount_paid>=0?o.amount_paid:0, waehrung=String(o.currency ?? '').toLowerCase();
      db.prepare("INSERT OR IGNORE INTO bestellungen (stripe_sitzung,zahlung_id,benutzer_id,kurs_id,betrag,waehrung,status,grund,art,stripe_abo,erstellt,geaendert) VALUES (?,?,?,?,?,?,'pruefen','abo_beendet','abo',?,?,?)")
        .run(o.id,extra?.rechnungZahlungId ?? null,a.benutzer_id,a.kurs_id,betrag,waehrung,a.stripe_abo,jetzt(),jetzt());
      ereignisHinzufuegen('abo_gestartet','pruefen:'+o.id,{benutzer_id:a.benutzer_id,kurs_id:a.kurs_id,betrag:ganzeEinheiten(betrag),waehrung,status:'pruefen'});
      return;
    }
    if (!rechnungPruefen(a,o,extra?.rechnungZahlungId ?? null,extra?.metadata ?? null)) return;
    if (!bis) return;
    if (bis >= (a.gueltig_bis ?? 0)) {
      const neuer = zeit >= alt;
      const status = !neuer ? a.status : a.status==='beendet' ? 'beendet' :
        a.endet_zum_periodenende ? 'gekuendigt' : 'aktiv';
      // Ein altes invoice.paid darf die spätere Kulanz einer neueren
      // payment_failed-Meldung nicht unbemerkt verkürzen.
      const bisZugang = !neuer && a.status==='zahlung_offen' ? bis + KULANZ_MS : status==='aktiv' ? bis + PUFFER_MS : bis;
      aendern(a,status,bis,Math.max(alt,zeit));
      zugangSetzen(a,bisZugang);
      if (!a.gueltig_bis) {
        const rechnung = db.prepare('SELECT id FROM bestellungen WHERE stripe_sitzung=? AND status=\'bezahlt\'').get(o.id);
        if (rechnung) {
          kaufVormerken(a.benutzer_id,rechnung.id,'abo');
          ereignisHinzufuegen('abo_gestartet',e.id,{benutzer_id:a.benutzer_id,kurs_id:a.kurs_id,
            betrag:ganzeEinheiten(o.amount_paid),waehrung:String(o.currency||'').toLowerCase(),status:'bezahlt'});
        }
      }
    }
    return;
  }
  if (zeit<alt) return;
  if (e.type==='invoice.payment_failed') {
    if (!a.gueltig_bis) return; // Kein früher bezahlter Zeitraum.
    if (a.status==='beendet') return; // Stripe garantiert keine Reihenfolge: ein beendetes Abo bleibt beendet, auch bei verspätetem payment_failed.
    aendern(a,'zahlung_offen',a.gueltig_bis,zeit);
    zugangAnpassen(a,a.gueltig_bis+KULANZ_MS);
  } else if(e.type==='customer.subscription.updated') {
    const ende=o.cancel_at_period_end===true?1:0;
    if (a.status==='beendet') return;   // Ein beendetes Stripe-Abo laesst sich nicht reaktivieren: kein spaeteres oder gleichzeitiges Update darf es wieder lebendig machen.
    // U4: incomplete_expired (erste Zahlung nach 23 Stunden nie geklappt) und canceled sind bei Stripe Endstatus. Ohne diese Behandlung bliebe ein nie bezahltes Abo
    // 'zahlung_offen' und würde den Neukauf des Kurses sperren (abo_laeuft_bereits).
    if (o.status==='incomplete_expired' || o.status==='canceled') { aboBeendet(a,e,zeit); return; }
    // Meldet Stripe das Abo weiter als ueberfaellig (past_due/unpaid/paused), bleibt es in der App 'zahlung_offen', auch nach Kuendigung und Ruecknahme der Kuendigung.
    const stripeOffen=o.status==='past_due'||o.status==='unpaid'||o.status==='paused';
    const neuerStatus=ende?'gekuendigt':(a.status==='zahlung_offen'||stripeOffen)?'zahlung_offen':'aktiv';
    aendern(a,neuerStatus,a.gueltig_bis,zeit,ende);
    // Kündigung zum Periodenende: der Puffer entfällt (Zugang genau bis zum Ende); Rücknahme der Kündigung: Puffer wieder da,
    // bei offener Zahlung stattdessen die 3 Tage Kulanz (nicht auf den 2-Tage-Puffer kuerzen).
    if (a.gueltig_bis && ['aktiv','gekuendigt'].includes(a.status))
      zugangAnpassen(a, ende ? a.gueltig_bis : a.gueltig_bis + (neuerStatus==='zahlung_offen' ? KULANZ_MS : PUFFER_MS));
    if(ende===1&&a.endet_zum_periodenende===0){
      const erfasst=Date.now();
      db.prepare("INSERT OR IGNORE INTO abo_kuendigung_mail(abo_id,benutzer_id,kurs_id,erfasst,ende) VALUES(?,?,?,?,?)")
        .run(a.id,a.benutzer_id,a.kurs_id,erfasst,a.gueltig_bis);
      ereignisHinzufuegen('abo_gekuendigt','kuendigung:'+a.id+':'+erfasst,
        {benutzer_id:a.benutzer_id,kurs_id:a.kurs_id,status:'gekuendigt'});
    }
  } else if(e.type==='customer.subscription.deleted') {
    aboBeendet(a,e,zeit);
  }
}
// Das Abo ist bei Stripe zu Ende (deleted, oder im Update canceled/incomplete_expired).
function aboBeendet(a,e,zeit) {
  aendern(a,'beendet',a.gueltig_bis,zeit,1);
  // Nach einer Elállás mit voller Erstattung ist der Zeitraum zurückgezahlt: kein Zugang bis zum Periodenende.
  // F2: Ist die LETZTE Abo-Rechnung erstattet (Widerruf oder Erstattung im Dashboard), ist der Zeitraum zurueckgezahlt: kein Zugang bis zum Periodenende,
  // auch wenn fruehere Monate noch als bezahlt gebucht sind.
  const letzteAbo=db.prepare("SELECT status FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND art='abo' AND status IN ('bezahlt','erstattet') ORDER BY id DESC LIMIT 1").get(a.benutzer_id,a.kurs_id);
  const zurueckgezahlt=letzteAbo?.status==='erstattet';
  // Ein Abo, das die App selbst schon beendet hat (Entzug, Erstattung, Streitfall), hat den richtigen Zugang bereits (keiner oder "jetzt" abgelaufen): das spätere
  // Stripe-Ende darf ihn nicht wieder bis zum Periodenende öffnen. (Die "letzte Rechnung" nach Einfüge-Reihenfolge ist bei vertauschten Ereignissen unzuverlässig.)
  // Ist ein anderes bezahltes Abo aktiv (anderes Abo, das diesen Kurs abdeckt), darf das Ende von diesem
  // Abo dessen spaeteres Zugangsende nicht ueberschreiben (PUNKT-1, Sicherheitspaket 1a).
  if(!zurueckgezahlt && a.status!=='beendet' && !kursSchonBezahlt(a.benutzer_id,a.kurs_id,{ohneAbo:a.stripe_abo}))zugangAnpassen(a,a.gueltig_bis);
  // Ein Abo, das nie bezahlt wurde (kein Zugang je), meldet kein "Abo-Ende".
  if(a.gueltig_bis)ereignisHinzufuegen('abo_beendet',e.id,{benutzer_id:a.benutzer_id,kurs_id:a.kurs_id,status:'beendet'});
}
