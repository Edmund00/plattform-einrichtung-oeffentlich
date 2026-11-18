// Schulungsplattform, Scheibe 3: Kurs kaufen (Stripe Checkout) und per Webhook freischalten.
// Regeln: Der SERVER bestimmt Kurs, Preis und Währung aus der Datenbank, nie die Anfrage. Der Zugang entsteht NUR im Webhook
// nach bestätigter Zahlung (nicht durch die Rückkehr-Seite). Kartendaten gibt es hier nie: sie liegen bei Stripe.
import express from 'express';
import { randomUUID } from 'node:crypto';
import {verkaufStatus} from './routes-verkauf.mjs';
import { db, transaktion } from './db.mjs';
import { aktuellerBenutzer } from './auth.mjs';
import { gueltigerZugang } from './zugang.mjs';
import { aboVerarbeiten, ereignisAbo, rechnungsAbo, aboBeiStripeBeenden, abosDerBestellung, abosBeendetSetzen, kursSchonBezahlt } from './abo.mjs';
import { fehler, HU, sprache, locale, mitSprache, gueltigeSprache } from './texte.mjs';
import { titelUebersetzt, beschreibungUebersetzt } from './demo-uebersetzung.mjs';
import { kaufVormerken } from './mail.mjs';
import { leseAnbieter, setzeAnbieterDb } from './anbieter.mjs';
import { ZUSTIMMUNG_VERSION } from './erstattung-regeln.mjs';
import { ereignisHinzufuegen, ereignisseNachCommit, ganzeEinheiten } from './ereignis-liste.mjs';

const jetzt = () => new Date().toISOString();
const idAus = (wert) => (/^[1-9]\d{0,15}$/.test(String(wert)) ? Number(wert) : null);

// Jeder Benutzer bekommt bei Stripe GENAU EINEN Kunden. Wir legen ihn beim ersten Kauf an und merken uns die ID.
async function stripeKundeSichern(stripe, benutzer) {
  if (benutzer.stripe_kunde) return benutzer.stripe_kunde;
  const kunde = await stripe.customers.create({ email: benutzer.email, preferred_locales: [sprache()], metadata: { plattform: 'schulungsplattform', benutzer_id: String(benutzer.id) } });
  // Nur setzen, wenn noch keiner da ist (falls zwei Klicks gleichzeitig kamen, gewinnt der erste)
  db.prepare('UPDATE benutzer SET stripe_kunde = ? WHERE id = ? AND stripe_kunde IS NULL').run(kunde.id, benutzer.id);
  return db.prepare('SELECT stripe_kunde FROM benutzer WHERE id = ?').get(benutzer.id).stripe_kunde;
}

// F-05: Gibt es bei Stripe eine ABGESCHLOSSENE Checkout-Sitzung dieses Kunden fuer diesen Kurs, deren Zahlung erfolgt ist oder noch laeuft,
// die die App aber noch nicht gebucht hat? Dann ist ein zweiter Kauf ein Doppelkauf. Gebuchte Sitzungen (Bestellung bzw. Abo-Zeile vorhanden)
// zaehlen nicht: fuer sie gelten die normalen Pruefungen (Zugang, laufendes Abo). Fehler der Stripe-Abfragen werden an den Aufrufer weitergegeben.
const sitzungsId = v => (typeof v === 'string' ? v : (typeof v?.id === 'string' ? v.id : null));
async function zahlungInArbeit(stripe, kundeId, kursId, benutzerId) {
  const fertig = await stripe.checkout.sessions.list({ customer: kundeId, status: 'complete', limit: 20 });
  for (const s of fertig?.data ?? []) {
    if (s?.status !== 'complete' || s.metadata?.kurs_id !== kursId || s.metadata?.benutzer_id !== benutzerId) continue;
    if (s.mode === 'subscription') {
      const abo = sitzungsId(s.subscription);
      if (!abo || db.prepare('SELECT 1 FROM abos WHERE stripe_abo = ?').get(abo)) continue;
      if (s.payment_status === 'paid' || s.payment_status === 'processing') return true;
      // Erste Abo-Zahlung noch offen (z. B. Lastschrift): Stripe-Status des Abos entscheidet.
      if (typeof stripe.subscriptions?.retrieve === 'function' && ['active', 'trialing', 'incomplete', 'past_due'].includes((await stripe.subscriptions.retrieve(abo))?.status)) return true;
      continue;
    }
    if (s.mode !== 'payment' || typeof s.id !== 'string' || db.prepare('SELECT 1 FROM bestellungen WHERE stripe_sitzung = ?').get(s.id)) continue;
    if (s.payment_status === 'paid' || s.payment_status === 'processing') return true;
    // Verzoegerte Zahlart (SEPA): Sitzung complete, payment_status unpaid, die Zahlung laeuft aber (PaymentIntent processing). Eine gescheiterte Zahlung blockiert nicht.
    const pi = sitzungsId(s.payment_intent);
    if (pi && typeof stripe.paymentIntents?.retrieve === 'function' && ['processing', 'succeeded', 'requires_capture'].includes((await stripe.paymentIntents.retrieve(pi))?.status)) return true;
  }
  return false;
}

// ---- Kaufen und "Meine Kurse" ------------------------------------------------------------------------
// Baut invoice_data aus Anbieterdaten fuer Einmalkauf-Rechnung.
// Wird bei jeder Sitzungserstellung frisch aufgerufen (keine Modul-Cache-Abhängigkeit).
export const FOOTER_MAX = 5000; // Stripe-Grenze gemessen 16.11.2026: 5000 ok, 5001 abgelehnt
export function rechnungsErweiterung(a) {
  if (!a || !a.name) return { enabled: true };
  const bereinige = (s) => String(s ?? '').replace(/[\x00-\x1f\x7f-]/g, ' ').replace(/\n/g, ' ').trim();
  const teile = [
    a.name,
    a.adoszam ? 'Steuer-/Reg.-Nr.: ' + a.adoszam : '',
    a.steuerHinweis,
    a.anschrift,
    a.email,
    a.telefon,
  ].filter(Boolean).map(bereinige).filter(Boolean);
  const footer = teile.join(' | ').slice(0, FOOTER_MAX);
  return { enabled: true, invoice_data: { footer } };
}

export function kaufRouter({ stripe, base, bestaetigungPflicht = false, mails = null,verkaufPausiert=false }) {
  setzeAnbieterDb(db);
  const router = express.Router();
  const kaufLaeuft = new Map();   // Benutzer:Kurs:Modell -> Versprechen der Adresse einer gerade laufenden Sitzungserstellung
  const kursSperre = new Map();   // Benutzer:Kurs -> Versprechen der zuletzt gestarteten Anfrage (Einmal und Abo desselben Kurses laufen nacheinander)

  router.post('/api/kurse/:id/kaufen', async (req, res) => {
    const benutzer = aktuellerBenutzer(req);                       // wer fragt? (jeder angemeldete Kunde oder Admin)
    if (!benutzer) return fehler(res, 401, 'nicht_angemeldet');
    if (bestaetigungPflicht && benutzer.email_bestaetigt === null) return fehler(res,403,'email_unbestaetigt');
    const id = idAus(req.params.id);
    if (!id) return fehler(res, 400, 'ungueltige_id');
    // Die Anfrage darf nichts bestimmen: kein Preis, keine Währung, nichts. Jedes Feld im Body ist ein Fehler.
    const body = req.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body)) return fehler(res, 400, 'body_ungueltig');
    if (Object.keys(body).some(k => !['modell','zustimmung'].includes(k))) return fehler(res, 400, 'unbekanntes_feld');
    const modell = body.modell ?? 'einmal';
    if (!['einmal','abo'].includes(modell)) return fehler(res, 400, 'abo_modell_ungueltig');

    if (db.prepare('SELECT beispiel_key FROM kurse WHERE id = ?').get(id)?.beispiel_key != null) return fehler(res, 409, 'beispiel_nicht_kaufbar');
    const kurs = db.prepare("SELECT id, titel, preis_cent, waehrung, abo_preis_cent, abo_intervall FROM kurse WHERE id = ? AND status = 'veroeffentlicht'").get(id);
    if (!kurs) return fehler(res, 404, 'nicht_gefunden');
    if (gueltigerZugang(benutzer.id, kurs.id)) return fehler(res, 409, 'zugang_vorhanden');
    // Laeuft fuer diesen Kurs noch ein Abo (wird noch abgebucht), darf er nicht noch einmal gekauft werden, auch wenn der Zugang weg ist
    // (zum Beispiel nach einer Erstattung in Stripe): sonst gaebe es zwei Abos oder Abo plus Einmalkauf. Gekuendigte und beendete Abos blockieren nicht.
    if (db.prepare("SELECT 1 FROM abos WHERE benutzer_id = ? AND kurs_id = ? AND status IN ('aktiv','zahlung_offen')").get(benutzer.id, kurs.id)) return fehler(res, 409, 'abo_laeuft_bereits');

    // N1: Gratis-Kurs mit Abo darf es nicht geben (Abwehr auch für alte Daten): sonst bekäme jeder per "einmal" den Abo-Kurs umsonst.
    if (modell === 'einmal' && kurs.preis_cent === 0 && kurs.abo_preis_cent != null) return fehler(res,409,'gratis_ohne_abo');
    if (modell === 'einmal' && kurs.preis_cent>0 && body.zustimmung!==true) return fehler(res,400,'ellallas_zustimmung_pflicht');
    if (modell === 'abo' && (!kurs.abo_preis_cent || !kurs.abo_intervall)) return fehler(res, 400, 'abo_nicht_angeboten');
    // Gesamtpruefung (Abo-Zustimmung): auch beim Abo verlangt der digitale Inhalt die ausdrueckliche Zustimmung zum sofortigen Beginn (wie beim Einmalkauf);
    // ohne gespeicherte Zustimmung bliebe der Widerruf nach dem Oeffnen immer moeglich.
    if (modell === 'abo' && body.zustimmung !== true) return fehler(res, 400, 'ellallas_zustimmung_pflicht');
    if (modell === 'einmal' && kurs.preis_cent === 0) {
      // Kostenloser Kurs: kein Stripe, Zugang sofort (UNIQUE schützt vor Doppelten)
      db.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, erstellt) VALUES (?, ?, 'einladung', ?) ON CONFLICT(benutzer_id,kurs_id) DO UPDATE SET quelle='einladung', gueltig_bis=NULL WHERE zugaenge.quelle='abo'").run(benutzer.id, kurs.id, jetzt());
      ereignisHinzufuegen('gekauft','gratis:'+benutzer.id+':'+kurs.id,{benutzer_id:benutzer.id,kurs_id:kurs.id,betrag:0,waehrung:kurs.waehrung,status:'kostenlos'});
      try { mails?.gratisVormerken(benutzer.id,kurs.id); } catch {console.warn('Gratis-Mail konnte nicht vorgemerkt werden');}
      ereignisseNachCommit();
      mails?.gratisNachCommitSenden();
      return res.json({ code: 'kostenloser_kurs', text: HU.kostenloser_kurs, kurs_id: kurs.id });
    }

    if(verkaufStatus(verkaufPausiert))return fehler(res,503,'verkauf_pausiert');
    // Zwei fast gleichzeitige Klicks: der zweite wartet auf den ersten und bekommt dieselbe Adresse (sonst zwei Sitzungen, doppelt bezahlbar).
    const sperrKey = benutzer.id + ':' + kurs.id + ':' + modell;
    // Nach dem Warten erneut pruefen: scheiterte der erste Klick, darf nur EIN Wartender weitermachen, die anderen warten wieder.
    for (let laufend = kaufLaeuft.get(sperrKey); laufend; laufend = kaufLaeuft.get(sperrKey)) {
      const wartUrl = await laufend;
      if (wartUrl) return res.json({ url: wartUrl });
    }
    let fertigMelden; const meinVersprechen = new Promise(r => { fertigMelden = r; });
    kaufLaeuft.set(sperrKey, meinVersprechen);
    // Gleichzeitige Anfragen mit VERSCHIEDENEM Modell (Einmal/Abo) fuer denselben Kunden und Kurs laufen nacheinander: die zweite sieht dann
    // die Sitzung der ersten und macht sie ab (sonst blieben beide offen und beide waeren bezahlbar).
    const kursKey = benutzer.id + ':' + kurs.id;
    const kursVorher = kursSperre.get(kursKey);
    let kursFrei; const kursMein = new Promise(r => { kursFrei = r; });
    kursSperre.set(kursKey, kursMein);
    let ergebnisUrl = null;
    try {
      if (kursVorher) await kursVorher;
      const hatteKunde = !!db.prepare('SELECT stripe_kunde FROM benutzer WHERE id = ?').get(benutzer.id)?.stripe_kunde;
      const kundeId = await stripeKundeSichern(stripe, benutzer);
      // Auch wenn die Stripe-Kundenerstellung während des Pausierens lief: kein neuer Checkout.
      if(verkaufStatus(verkaufPausiert))return fehler(res,503,'verkauf_pausiert');
      const zahlart = modell === 'abo';
      // A2-01: Beim Abo steht das Intervall in den Metadaten (Sitzung UND Abo), damit Wiederverwendung und Rechnungspruefung es vergleichen koennen.
      const daten = { kurs_id: String(kurs.id), benutzer_id: String(benutzer.id), modell, sprache: sprache(), ...(zahlart ? { abo_intervall: kurs.abo_intervall } : {}) };
      // F-05: Hat der Kunde diesen Kurs bei Stripe schon bezahlt (oder laeuft die Zahlung noch, z. B. Lastschrift), ist das aber noch nicht gebucht
      // (Webhook verspaetet), darf kein zweiter Checkout entstehen (sonst Doppelkauf / zweites Abo). Ein ganz neuer Kunde hat keine Sitzungen.
      // Schlaegt die Abfrage fehl, laeuft der Kauf weiter (wie bei den offenen Sitzungen); der Webhook bucht eine Doppelzahlung dann als "pruefen".
      if (hatteKunde && typeof stripe.checkout?.sessions?.list === 'function') {
        let inArbeit = false;
        try { inArbeit = await zahlungInArbeit(stripe, kundeId, daten.kurs_id, daten.benutzer_id); }
        catch { console.warn('Abgeschlossene Checkout-Sitzungen konnten nicht geprüft werden'); }
        if (inArbeit) return fehler(res, 409, 'zahlung_wird_verarbeitet');
      }
      // Doppelklick oder zwei Tabs: gibt es für diesen Kunden, Kurs und dieses Modell schon eine OFFENE Checkout-Sitzung mit gleichem
      // Betrag und gleicher Währung, bekommt er dieselbe zurück statt einer zweiten (sonst könnte er zweimal bezahlen).
      // Schlägt die Prüfung fehl, läuft der Kauf wie bisher weiter (nie ein Kauf wegen der Prüfung blockieren).
      let offeneSitzungen = [];
      let kaufabsicht = null;
      if (typeof stripe.checkout?.sessions?.list === 'function') {
        try {
          const betrag = zahlart ? kurs.abo_preis_cent : kurs.preis_cent;
          const offen = await stripe.checkout.sessions.list({ customer: kundeId, status: 'open', limit: 20 });
          offeneSitzungen = offen?.data ?? [];
          const vorhanden = (offen?.data ?? []).find(s => s?.url && s.metadata?.kurs_id === daten.kurs_id && s.metadata?.modell === modell
            && s.amount_total === betrag && s.currency === kurs.waehrung
            && (!zahlart || s.metadata?.abo_intervall === kurs.abo_intervall)   // A2-01: Abo nur zum AKTUELLEN Intervall wiederverwenden
            && (!s.expires_at || s.expires_at * 1000 > Date.now() + 30 * 60 * 1000));   // nicht kurz vor Ablauf wiederverwenden
          if (vorhanden) { ergebnisUrl = vorhanden.url; return res.json({ url: vorhanden.url }); }
        } catch {
          // PUNKT-6: Wenn die Suche fehlschlug, Kaufabsicht-UUID als Idempotency-Key fuer sessions.create bereitstellen.
          // Gleiche UUID => Stripe gibt dieselbe Sitzung zurueck, auch wenn zwei Anfragen gleichzeitig durchrutschen.
          console.warn('Offene Checkout-Sitzungen konnten nicht geprüft werden');
          db.prepare('INSERT OR IGNORE INTO kaufabsichten (benutzer_id, kurs_id, modell, uuid, erstellt) VALUES (?,?,?,?,?)')
            .run(benutzer.id, kurs.id, modell, randomUUID(), jetzt());
          kaufabsicht = db.prepare('SELECT uuid, stripe_sitzung_id FROM kaufabsichten WHERE benutzer_id=? AND kurs_id=? AND modell=?')
            .get(benutzer.id, kurs.id, modell);
          if (kaufabsicht.stripe_sitzung_id && typeof stripe.checkout?.sessions?.retrieve === 'function') {
            try {
              const gespeichert = await stripe.checkout.sessions.retrieve(kaufabsicht.stripe_sitzung_id);
              if (gespeichert?.status === 'open' && gespeichert?.url) {
                ergebnisUrl = gespeichert.url; return res.json({ url: gespeichert.url });
              }
              if (gespeichert?.status === 'complete' || gespeichert?.status === 'expired') {
                db.prepare('DELETE FROM kaufabsichten WHERE benutzer_id=? AND kurs_id=? AND modell=?').run(benutzer.id, kurs.id, modell);
                db.prepare('INSERT INTO kaufabsichten (benutzer_id, kurs_id, modell, uuid, erstellt) VALUES (?,?,?,?,?)').run(benutzer.id, kurs.id, modell, randomUUID(), jetzt());
                kaufabsicht = db.prepare('SELECT uuid FROM kaufabsichten WHERE benutzer_id=? AND kurs_id=? AND modell=?').get(benutzer.id, kurs.id, modell);
              }
            } catch { /* Stripe nicht erreichbar: mit vorhandenem UUID als Idempotency-Key weitermachen */ }
          }
        }
      }
      const sitzung = await stripe.checkout.sessions.create({
        mode: zahlart ? 'subscription' : 'payment',
        customer: kundeId,
        client_reference_id: String(benutzer.id),
        line_items: [{ quantity: 1, price_data: {
          currency: kurs.waehrung, unit_amount: zahlart ? kurs.abo_preis_cent : kurs.preis_cent,
          ...(zahlart ? { recurring: { interval: kurs.abo_intervall } } : {}),
          product_data: { name: titelUebersetzt(kurs.titel) }
        } }],
        metadata: daten,
        ...(zahlart ? { subscription_data: { metadata: daten } } : { payment_intent_data: { metadata: daten } }),
        locale: sprache(),
        // Keine automatische Umrechnung (Adaptive Pricing): die Kundin zahlt genau den Preis des Kurses in dessen Waehrung (HUF oder EUR je Kurs),
        // ohne Umrechnungsgebuehr und ohne schwankenden Betrag. Betrag in Mails, Beleg und Stripe stimmen so ueberein.
        adaptive_pricing: { enabled: false },
        // Beleg-/Rechnungsdaten gibt der Kunde selbst im Stripe-Checkout ein (nichts wird vorbelegt):
        // Rechnungsadresse ist Pflicht (Privatkunde), Firmenkunden tragen Firmenname und Steuernummer ein (freiwilliges Feld).
        billing_address_collection: 'required',
        tax_id_collection: { enabled: true },
        customer_update: { name: 'auto', address: 'auto' },
        // Einmalkauf: eine Stripe-Rechnung (Beleg-PDF) mit Anbieterdaten im Footer/Custom-Fields wenn hinterlegt.
        ...(zahlart ? {} : { invoice_creation: rechnungsErweiterung(leseAnbieter()) }),
        success_url: `${base}/?kauf=erfolg&kurs=${kurs.id}`,
        cancel_url: `${base}/?kauf=abgebrochen&kurs=${kurs.id}`,
      }, kaufabsicht ? { idempotencyKey: kaufabsicht.uuid } : undefined);
      if (!sitzung?.url || !sitzung?.id) throw new Error('Stripe hat keine Sitzung geliefert');
      if (kaufabsicht) db.prepare('UPDATE kaufabsichten SET stripe_sitzung_id=? WHERE benutzer_id=? AND kurs_id=? AND modell=?').run(sitzung.id, benutzer.id, kurs.id, modell);
      // Es darf je Kunde und Kurs nur EINE offene Checkout-Sitzung geben: alle anderen offenen Sitzungen dieses Kunden fuer DIESEN Kurs
      // (anderes Modell Einmal/Abo, anderer Betrag, kurz vor Ablauf) werden bei Stripe abgelaufen gemacht, sonst koennten beide bezahlt werden.
      // Scheitert das (Netz, Sitzung gerade bezahlt), laeuft der Kauf trotzdem weiter.
      if (typeof stripe.checkout?.sessions?.expire === 'function') {
        for (const alt of offeneSitzungen) {
          if (!alt?.id || alt.id === sitzung.id || alt.metadata?.kurs_id !== daten.kurs_id) continue;
          try { await stripe.checkout.sessions.expire(alt.id); } catch { console.warn('Alte Checkout-Sitzung konnte nicht abgelaufen gemacht werden'); }
        }
      }
      // Zustimmung (Einmalkauf mit Preis und Abo) mit der Checkout-Sitzung speichern; beim Abo findet der Widerruf sie ueber abos.stripe_sitzung.
      if(zahlart||kurs.preis_cent>0)db.prepare('INSERT OR IGNORE INTO kauf_zustimmung(benutzer_id,kurs_id,text_version,zeit,stripe_sitzung) VALUES(?,?,?,?,?)').run(benutzer.id,kurs.id,ZUSTIMMUNG_VERSION,jetzt(),sitzung.id);
      ergebnisUrl = sitzung.url;
      res.json({ url: sitzung.url });
    } catch (e) {
      console.error('Kauf konnte nicht gestartet werden:', e.code || e.type || 'unbekannt');
      fehler(res, 500, 'kauf_fehlgeschlagen');
    } finally {
      fertigMelden(ergebnisUrl);
      if (kaufLaeuft.get(sperrKey) === meinVersprechen) kaufLaeuft.delete(sperrKey);
      kursFrei();
      if (kursSperre.get(kursKey) === kursMein) kursSperre.delete(kursKey);
    }
  });

  router.post('/api/abo/portal', async (req, res) => {
    const benutzer = aktuellerBenutzer(req);
    if (!benutzer) return fehler(res, 401, 'nicht_angemeldet');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)
      return fehler(res, 400, 'body_ungueltig');
    if (!benutzer.stripe_kunde) return fehler(res, 400, 'abo_portal_kein_kunde');
    try {
      const portal = await stripe.billingPortal.sessions.create({ customer: benutzer.stripe_kunde, return_url: base, locale: sprache() });
      if (!portal?.url || !portal.url.startsWith('https://')) throw new Error('portal URL fehlt');
      return res.json({ url: portal.url });
    } catch (e) {
      console.warn('Stripe-Kundenportal nicht verfügbar:', e.code || e.type || 'unbekannt');
      return fehler(res, 503, 'abo_portal_nicht_eingerichtet');
    }
  });

  // Nur die EIGENEN Kurse (der Server prüft, wer fragt)
  router.get('/api/meine-kurse', (req, res) => {
    const benutzer = aktuellerBenutzer(req);
    if (!benutzer) return fehler(res, 401, 'nicht_angemeldet');
    res.json(db.prepare(
      `SELECT k.id, k.titel, k.beschreibung, (SELECT a.status FROM abos a WHERE a.benutzer_id=z.benutzer_id AND a.kurs_id=z.kurs_id ORDER BY a.id DESC LIMIT 1) AS abo_status FROM zugaenge z JOIN kurse k ON k.id = z.kurs_id
       WHERE z.benutzer_id = ? AND (z.gueltig_bis IS NULL OR z.gueltig_bis > ?) ORDER BY z.erstellt DESC, k.id DESC`
    ).all(benutzer.id, Date.now()).filter(k => gueltigerZugang(benutzer.id, k.id)).map(k => ({ ...k, beschreibung: beschreibungUebersetzt(k.titel, k.beschreibung), titel: titelUebersetzt(k.titel) })));
  });

  return router;
}

// ---- Webhook: Stripe meldet die Zahlung -----------------------------------------------------------------
const FREISCHALT_EREIGNISSE = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

// Eine bezahlte Checkout-Sitzung. Passt alles zum Kurs, entsteht Bestellung "bezahlt" UND Zugang. Passt etwas nicht (aber es wurde
// bezahlt), entsteht nur eine Bestellung "pruefen" mit Grund und KEIN Zugang, damit Gabriella eingreifen kann. Alles, was gar nicht
// zu uns gehört (keine Einmalzahlung, noch nicht bezahlt, keine Kurs-/Benutzerangaben), wird nur im Log vermerkt.
function sitzungVerarbeiten(ereignis, o, extra = null) {
  const warnung = (grund) => console.warn(`Ereignis ${ereignis.id}: nicht freigeschaltet (${grund})`);
  if (!o || o.mode !== 'payment') return warnung('keine Einmalzahlung');
  if (o.payment_status !== 'paid') return warnung('noch nicht bezahlt');   // bei späterer Zahlung kommt async_payment_succeeded
  const kursId = idAus(o.metadata?.kurs_id), benutzerId = idAus(o.metadata?.benutzer_id);
  if (!kursId || !benutzerId) return warnung('Angaben zu Kurs oder Benutzer fehlen');
  if (typeof o.id !== 'string' || !o.id) return warnung('Sitzungs-ID fehlt');

  const kurs = db.prepare('SELECT id, preis_cent, waehrung FROM kurse WHERE id = ?').get(kursId);
  const benutzer = db.prepare('SELECT id, stripe_kunde FROM benutzer WHERE id = ?').get(benutzerId);
  const waehrung = String(o.currency ?? '').toLowerCase().slice(0, 10);
  const betrag = Number.isSafeInteger(o.amount_total) && o.amount_total >= 0 ? o.amount_total : 0;
  let grund = null;
  if (!kurs) grund = 'kurs_unbekannt';
  else if (!benutzer) grund = 'benutzer_unbekannt';
  else if (!benutzer.stripe_kunde || o.customer !== benutzer.stripe_kunde) grund = 'kunde_passt_nicht';
  // Betrag und Währung müssen zum AKTUELLEN Preis in der Datenbank passen (Stripe liefert, was der Kunde gezahlt hat).
  else if (waehrung !== kurs.waehrung || o.amount_total !== kurs.preis_cent) grund = 'betrag_waehrung';
  // F-05: Zweite Zahlung fuer einen Kurs, den der Benutzer schon besitzt (Doppelkauf im Fenster vor dem Webhook): nicht still "bezahlt", sondern
  // "pruefen" mit Meldung an die Inhaberin (sie erstattet). Eine schon gebuchte Sitzung (zweites Ereignis zur selben Zahlung) ist kein Doppel.
  // Eine schon voll erstattete Zahlung braucht keine Pruefung mehr (bleibt "erstattet").
  else if (!extra?.bereitsErstattet && !db.prepare('SELECT 1 FROM bestellungen WHERE stripe_sitzung = ?').get(o.id)
    && kursSchonBezahlt(benutzer.id, kurs.id)) grund = 'doppelt_bezahlt';

  const zeit = jetzt();
  db.prepare(`INSERT OR IGNORE INTO bestellungen (stripe_sitzung, zahlung_id, benutzer_id, kurs_id, betrag, waehrung, status, grund, erstellt, geaendert, sprache)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(o.id, typeof o.payment_intent === 'string' ? o.payment_intent : null, benutzer?.id ?? null, kurs?.id ?? null, betrag, waehrung,
      grund ? 'pruefen' : extra?.bereitsErstattet ? 'erstattet' : 'bezahlt', grund ?? (extra?.bereitsErstattet ? 'erstattung_voll' : null), zeit, zeit, gueltigeSprache(o.metadata?.sprache) ?? sprache());
  // N5: Stripe hat die Zahlung schon voll erstattet, bevor dieses Kauf-Ereignis ankam (Ereignisse ohne Reihenfolge): nur die Bestellung als erstattet
  // merken, KEIN Zugang.
  if (!grund && extra?.bereitsErstattet) return warnung('Zahlung war schon voll erstattet');
  if (grund) {
    // L1: Die Inhaberin wird per Meldungsmail benachrichtigt (Ereignis "gekauft" mit Status "pruefen"), sonst bliebe die Zahlung unbemerkt.
    ereignisHinzufuegen('gekauft', 'pruefen:' + ereignis.id, { benutzer_id: benutzer?.id ?? null, kurs_id: kurs?.id ?? null,
      betrag: ganzeEinheiten(betrag), waehrung, status: 'pruefen' });
    return warnung(`Bestellung zur Prüfung vorgemerkt: ${grund}`);
  }
  // Zugang nur, wenn die Bestellung dieser Sitzung "bezahlt" ist (eine schon erstattete Bestellung bekommt ihn nicht wieder zurück)
  const bestellung = db.prepare('SELECT id,status FROM bestellungen WHERE stripe_sitzung = ?').get(o.id);
  if (bestellung.status !== 'bezahlt') return warnung(`Bestellung hat Status ${bestellung.status}`);
  db.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, erstellt) VALUES (?, ?, 'zahlung', ?) ON CONFLICT(benutzer_id,kurs_id) DO UPDATE SET quelle='zahlung', gueltig_bis=NULL WHERE zugaenge.quelle='abo'").run(benutzer.id, kurs.id, zeit);
  kaufVormerken(benutzer.id,bestellung.id,'kauf');
  ereignisHinzufuegen('gekauft',ereignis.id,{benutzer_id:benutzer.id,kurs_id:kurs.id,betrag:ganzeEinheiten(betrag),waehrung,status:'bezahlt'});
}

// Erstattung (charge.refunded). Voll: Bestellung "erstattet", Zugang mit Quelle "zahlung" weg (nur wenn keine andere bezahlte Bestellung
// denselben Kurs für denselben Benutzer trägt; ein Zugang mit Quelle "einladung" bleibt immer). Teilweise: nur vermerken, Zugang bleibt.
export function erstattungVerarbeiten(ereignis, charge, extra = null) {
  const warnung = (grund) => console.warn(`Ereignis ${ereignis.id}: Erstattung nicht verarbeitet (${grund})`);
  const zahlungId = typeof charge?.payment_intent === 'string' ? charge.payment_intent : typeof charge?.payment_intent?.id==='string'?charge.payment_intent.id:null;
  if (!zahlungId) return warnung('keine Zahlungs-ID');
  let bestellungen = db.prepare('SELECT id, benutzer_id, kurs_id, status, art, stripe_sitzung, zahlung_id, erstellt, stripe_abo FROM bestellungen WHERE zahlung_id = ?').all(zahlungId);
  if (!bestellungen.length && extra?.rechnungId) {
    bestellungen = db.prepare("SELECT id,benutzer_id,kurs_id,status,art,stripe_sitzung,zahlung_id,erstellt,stripe_abo FROM bestellungen WHERE stripe_sitzung=? AND art='abo'").all(extra.rechnungId);
    if (bestellungen.length) db.prepare("UPDATE bestellungen SET zahlung_id=? WHERE stripe_sitzung=? AND zahlung_id IS NULL").run(zahlungId,extra.rechnungId);
  }
  if (bestellungen.length === 0) return warnung('Zahlung unbekannt');
  // Im Zweifelsfall keine Geldbuchung an eine mehrdeutige oder widerspruechliche Zuordnung.
  if (bestellungen.length !== 1 || bestellungen[0].zahlung_id && bestellungen[0].zahlung_id !== zahlungId)
    throw new Error('Mehrdeutige Stripe-Zahlungszuordnung');
  const refundsListe = Array.isArray(extra?.refundsData) ? extra.refundsData : Array.isArray(charge.refunds?.data) ? charge.refunds.data : [];
  const refundsSumme = refundsListe.filter(x=>x?.status==='succeeded'||!x?.status).reduce((s,x)=>s+(Number.isSafeInteger(x.amount)?x.amount:0),0);
  const voll = charge.refunded === true || (Number.isSafeInteger(charge.amount) && charge.amount > 0 && (charge.amount_refunded >= charge.amount || refundsSumme >= charge.amount));
  const zeit = jetzt();
  // F-92: kumulativen Erstattungsstand je Bestellung merken (MAX: wiederholte oder verspaetete aeltere Ereignisse ziehen nie doppelt ab).
  const erstattetKumuliert = Math.max(Number.isSafeInteger(charge.amount_refunded) && charge.amount_refunded > 0 ? charge.amount_refunded : 0, refundsSumme);
  for (const b of bestellungen) {
    if (erstattetKumuliert > 0) db.prepare('UPDATE bestellungen SET erstattet_betrag = MAX(erstattet_betrag, ?) WHERE id = ?').run(erstattetKumuliert, b.id);
    // Stripe kann dieselbe Refund-ID in mehreren charge.refunded-Ereignissen liefern.
    const refundIds = extra?.refundId ? [extra.refundId] :
      (Array.isArray(extra?.refundsData) ? extra.refundsData : Array.isArray(charge.refunds?.data)?charge.refunds.data:[])
        .filter(x=>x?.status==='succeeded'||!x?.status).map(x=>x.id).filter(x=>typeof x==='string'&&/^re_[a-zA-Z0-9_]+$/.test(x));
    const neuIds=refundIds.filter(id=>!db.prepare('SELECT 1 FROM abo_erstattung_eintrag WHERE stripe_refund_id=? AND bestell_id=?').get(id,b.id));
    if(b.art==='abo' && refundIds.length && !neuIds.length)continue;
    for (const rid of neuIds) db.prepare('INSERT OR IGNORE INTO abo_erstattung_eintrag(stripe_refund_id,bestell_id,zeit) VALUES(?,?,?)').run(rid,b.id,zeit);
    fehlerDurchNeueErstattungErsetzt(ereignis,b.id,neuIds,Array.isArray(extra?.refundsData)?extra.refundsData:charge.refunds?.data||[]);
    // Bereits anderweitig (z.B. Elállás) gebuchte Erstattungen nie doppelt melden.
    if (b.status === 'erstattet' && b.art === 'abo') continue;
    const info=db.prepare('SELECT betrag,waehrung FROM bestellungen WHERE id=?').get(b.id);
    const currentRefund=(Array.isArray(extra?.refundsData)?extra.refundsData:charge.refunds?.data||[]).find(x=>neuIds.includes(x.id));
    const refundBetrag=Number.isSafeInteger(currentRefund?.amount)?currentRefund.amount:
      Number.isSafeInteger(charge.amount_refunded)?charge.amount_refunded:info?.betrag;
    ereignisHinzufuegen('erstattet',ereignis.id+':'+b.id,{benutzer_id:b.benutzer_id,kurs_id:b.kurs_id,
      betrag:ganzeEinheiten(refundBetrag),waehrung:info?.waehrung,status:voll?'erstattet':'teilweise'});
    if (b.art === 'abo') {
      // Inhaber-Mail einmal je Stripe-Erstattung vormerken, Versand erst nach Commit.
      for (const rid of neuIds) {
        const refund=(Array.isArray(extra?.refundsData)?extra.refundsData:charge.refunds?.data||[]).find(x=>x.id===rid);
        db.prepare("INSERT OR IGNORE INTO abo_erstattung_mail(bestell_id,refund_id,betrag) VALUES(?,?,?)")
          .run(b.id,rid,Number.isSafeInteger(refund?.amount)?refund.amount:charge.amount_refunded||0);
      }
      if (!voll) {
        if (b.status === 'bezahlt') db.prepare("UPDATE bestellungen SET grund='teilerstattung', geaendert=? WHERE id=?").run(zeit,b.id);
        continue;
      }
      // Bei einer Prüf-Zahlung bleibt der Grund (betrag_waehrung/abo_beendet) stehen: sie zählt später nie als "schon bezahlter Betrag".
      db.prepare("UPDATE bestellungen SET status='erstattet',grund=CASE WHEN status='pruefen' THEN grund ELSE 'erstattung_voll' END,geaendert=? WHERE id=? AND status IN ('bezahlt','pruefen')").run(zeit,b.id);
      // M2: Eine erstattete Prüf-Abo-Zahlung beendet das dazugehörige Abo (bei Stripe schon im Vorabschritt geschehen); der Zugang früherer Monate bleibt.
      // Ein später abgeschlossenes neues Abo bleibt unberührt.
      if (b.status === 'pruefen' && b.benutzer_id && b.kurs_id) abosBeendetSetzen(abosDerBestellung(b.benutzer_id,b.kurs_id,b).map(a=>a.id));
      if (b.status === 'bezahlt' && b.benutzer_id && b.kurs_id) {
        const andere=db.prepare("SELECT 1 FROM bestellungen WHERE benutzer_id=? AND kurs_id=? AND status='bezahlt' AND id<>?").get(b.benutzer_id,b.kurs_id,b.id);
        // Nur den von Stripe bestaetigten LETZTEN bezahlten Zeitraum entziehen.
        // Fehlt dessen Periodenende, bleibt der Zugang aus Sicherheitsgruenden erhalten.
        const abo=db.prepare("SELECT id,gueltig_bis FROM abos WHERE benutzer_id=? AND kurs_id=? ORDER BY id DESC LIMIT 1").get(b.benutzer_id,b.kurs_id);
        if (Number.isSafeInteger(extra?.periodEnd) && abo?.gueltig_bis===extra.periodEnd) {
          // F2: Ist der letzte Monat erstattet, endet der Zugang JETZT (frueher bezahlte, abgelaufene Monate halten ihn nicht offen)
          // und das Abo ist beendet; Stripe wurde vor dieser Buchung schon beendet (siehe webhookHandler).
          if (!andere) db.prepare("DELETE FROM zugaenge WHERE benutzer_id=? AND kurs_id=? AND quelle='abo'").run(b.benutzer_id,b.kurs_id);
          else db.prepare("UPDATE zugaenge SET gueltig_bis=? WHERE benutzer_id=? AND kurs_id=? AND quelle='abo' AND (gueltig_bis IS NULL OR gueltig_bis>?)").run(Date.now(),b.benutzer_id,b.kurs_id,Date.now());
          db.prepare("UPDATE abos SET status='beendet',geaendert=? WHERE id=? AND status!='beendet'").run(zeit,abo.id);
        }
      }
      continue;
    }
    if (b.status === 'erstattet') continue;
    if (!voll) {
      if (b.status === 'bezahlt') db.prepare("UPDATE bestellungen SET grund = 'teilerstattung', geaendert = ? WHERE id = ?").run(zeit, b.id);
      continue;
    }
    db.prepare("UPDATE bestellungen SET status = 'erstattet', grund = 'erstattung_voll', geaendert = ? WHERE id = ?").run(zeit, b.id);
    if (b.status === 'bezahlt' && b.benutzer_id && b.kurs_id) {
      // "andere" zählt nur weitere Einmalkäufe: eine bezahlte Abo-Rechnung hält den dauerhaften Einmal-Zugang nicht offen.
      const andere = db.prepare("SELECT 1 FROM bestellungen WHERE benutzer_id = ? AND kurs_id = ? AND status = 'bezahlt' AND art != 'abo' AND id != ?").get(b.benutzer_id, b.kurs_id, b.id);
      if (!andere) db.prepare("DELETE FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ? AND quelle = 'zahlung'").run(b.benutzer_id, b.kurs_id);
    }
  }
}

const piId = v => typeof v === 'string' ? v : (typeof v?.id === 'string' ? v.id : null);

// U4: Streitfall (Chargeback). Eröffnet der Kunde bei seiner Bank einen Streit, ist das Geld weg (oder eingefroren): Die Zahlung wird "pruefen" (Grund streitfall),
// der Zugang entzogen, ein Abo bei Stripe beendet (das passiert VOR der Buchung im webhookHandler), und Gabriella bekommt eine Meldung. Gewinnt sie den Streit,
// kann sie dem Kunden den Zugang selbst wieder geben (Freigabe/Einladung). Beendet ein verlorener Streit eine noch "bezahlte" Zahlung, gilt dasselbe.
// Eine bloße Bank-Anfrage (Stripe-Status warning_*) ist noch KEIN Streit und keine Rückbuchung: nur Meldung, der Zugang bleibt. Erst die Eskalation
// (charge.dispute.updated mit needs_response/under_review) oder ein verlorener Streit entzieht ihn.
const istAnfrage = d => typeof d?.status === 'string' && d.status.startsWith('warning_');
// Dieses Ereignis lässt den Zugang entziehen (und ein Abo bei Stripe beenden)?
function streitEntzieht(ereignis, d) {
  if (ereignis.type === 'charge.dispute.created') return !istAnfrage(d);
  if (ereignis.type === 'charge.dispute.updated') return d?.status === 'needs_response' || d?.status === 'under_review';
  if (ereignis.type === 'charge.dispute.closed') return d?.status === 'lost';
  return false;
}
function streitVerarbeiten(ereignis, d, extra = null) {
  const warnung = (grund) => console.warn(`Ereignis ${ereignis.id}: Streitfall nicht verarbeitet (${grund})`);
  if (!d || typeof d.id !== 'string') return warnung('keine Streit-ID');
  let status = null;
  if (ereignis.type === 'charge.dispute.created') status = istAnfrage(d) ? 'streit_anfrage' : 'streitfall';
  else if (ereignis.type === 'charge.dispute.updated') status = streitEntzieht(ereignis, d) ? 'streitfall' : null;
  else status = d.status === 'won' ? 'streit_gewonnen' : d.status === 'lost' ? 'streit_verloren' : null;
  if (!status) return warnung('Streit ohne Entscheidung');
  const pi = piId(d.payment_intent);
  const SPALTEN = 'id, benutzer_id, kurs_id, status, art, erstellt, stripe_abo';
  let b = pi ? db.prepare(`SELECT ${SPALTEN} FROM bestellungen WHERE zahlung_id = ? LIMIT 1`).get(pi) : null;
  // Fehlt die Zahlungs-ID an der Abo-Rechnung (Abfrage damals gescheitert), findet der Streit die Bestellung über die Rechnung (wie bei der Erstattung).
  if (!b && extra?.rechnungId) {
    b = db.prepare(`SELECT ${SPALTEN} FROM bestellungen WHERE stripe_sitzung = ? AND art = 'abo'`).get(extra.rechnungId);
    if (b && pi) db.prepare('UPDATE bestellungen SET zahlung_id = ? WHERE id = ? AND zahlung_id IS NULL').run(pi, b.id);
  }
  if (streitEntzieht(ereignis, d) && b?.status === 'bezahlt') {
    const zeit = jetzt();
    db.prepare("UPDATE bestellungen SET status = 'pruefen', grund = 'streitfall', geaendert = ? WHERE id = ? AND status = 'bezahlt'").run(zeit, b.id);
    if (b.benutzer_id && b.kurs_id) {
      if (b.art === 'abo') {
        // Nur der Zugang, den das angefochtene Abo trägt: Streit auf eine alte Rechnung eines schon beendeten Abos nimmt einem Kunden mit neuem,
        // laufendem Abo nicht den Zugang (Gabriella entscheidet anhand der Meldung).
        const meine = abosDerBestellung(b.benutzer_id, b.kurs_id, b);
        const andereLaufen = !!db.prepare("SELECT 1 FROM abos WHERE benutzer_id = ? AND kurs_id = ? AND status != 'beendet'").get(b.benutzer_id, b.kurs_id);
        if (meine.length || !andereLaufen) db.prepare("DELETE FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ? AND quelle = 'abo'").run(b.benutzer_id, b.kurs_id);
        abosBeendetSetzen(meine.map(a => a.id));
      } else if (!db.prepare("SELECT 1 FROM bestellungen WHERE benutzer_id = ? AND kurs_id = ? AND status = 'bezahlt' AND art != 'abo' AND id != ?").get(b.benutzer_id, b.kurs_id, b.id)) {
        // "andere" zählt nur weitere Einmalkäufe: eine bezahlte Abo-Rechnung hält den dauerhaften Einmal-Zugang nicht offen.
        db.prepare("DELETE FROM zugaenge WHERE benutzer_id = ? AND kurs_id = ? AND quelle = 'zahlung'").run(b.benutzer_id, b.kurs_id);
      }
    }
  }
  const betrag = Number.isSafeInteger(d.amount) && d.amount >= 0 ? d.amount : null;
  ereignisHinzufuegen('gekauft', status + ':' + d.id, { benutzer_id: b?.benutzer_id ?? null, kurs_id: b?.kurs_id ?? null,
    betrag: betrag === null ? null : ganzeEinheiten(betrag), waehrung: String(d.currency ?? '').toLowerCase() || null, status });
}

// U4: Eine Erstattung, die Stripe nachträglich nicht ausführen konnte (Karte gesperrt, Konto geschlossen): Das Geld ist NICHT beim Kunden, der Zugang ist aber schon
// entzogen. Meldung an Gabriella (einmal je Erstattung); sie entscheidet im Stripe-Dashboard.
// Refund-Failed (12.11.2026): zusaetzlich ein Eintrag in erstattung_fehler fuer die Bestellung (gefunden ueber bestellungen.zahlung_id = payment_intent).
// Solange er offen ist, zeigt das Kundenkonto "Erstattung fehlgeschlagen" statt "Erstattet" und der Admin sieht den Fall in den offenen Pruefungen.
// Stripe-Logik: Ein Refund kann von succeeded auf failed wechseln (Gutschrift spaeter von der Bank zurueckgewiesen); failed/canceled sind endgueltig.
// Ein refund.updated mit status 'succeeded' fuer DIESELBE Erstattung loest den Eintrag deshalb nur, wenn das Ereignis NEUER ist als der Fehler
// (ein verspaetet zugestelltes altes "succeeded" darf einen Fehler nie verdecken). Andere Zwischenstaende (pending, requires_action) aendern nichts.
const FEHLER_STATUS = Object.freeze({ failed: 'fehlgeschlagen', canceled: 'abgebrochen' });
const OFFEN_SQL = "status IN ('fehlgeschlagen','abgebrochen')";
function erstattungStatus(ereignis, r) {
  if (!r || typeof r.id !== 'string' || !/^re_[A-Za-z0-9_]+$/.test(r.id) || r.id.length > 200) return;
  const fehlerStatus = ereignis.type === 'refund.failed' ? (FEHLER_STATUS[r.status] ?? 'fehlgeschlagen') : FEHLER_STATUS[r.status];
  const erfolg = !fehlerStatus && r.status === 'succeeded';
  if (!fehlerStatus && !erfolg) return;
  const pi = piId(r.payment_intent);
  const treffer = pi ? db.prepare('SELECT id, benutzer_id, kurs_id FROM bestellungen WHERE zahlung_id = ? LIMIT 2').all(pi) : [];
  // Mehrdeutig (zwei Bestellungen zu einer Zahlung) oder unbekannt: kein Eintrag (nie an eine falsche Bestellung buchen), die Meldung geht trotzdem raus.
  const b = treffer.length === 1 ? treffer[0] : null;
  if (treffer.length > 1) console.warn(`Ereignis ${ereignis.id}: Erstattungsstatus mehrdeutig zugeordnet, nur Meldung`);
  const ereignisZeit = Number.isSafeInteger(ereignis.created) ? ereignis.created : Math.floor(Date.now() / 1000);
  const betrag = Number.isSafeInteger(r.amount) && r.amount >= 0 ? r.amount : null;
  const waehrung = String(r.currency ?? '').toLowerCase() || null;
  if (erfolg) {
    // Nur einen schon offenen Eintrag loesen; erfolgreiche Erstattungen ohne Fehler werden hier nicht gespeichert.
    if (b) db.prepare(`UPDATE erstattung_fehler SET status = 'erfolgreich', geloest = ?, ereignis_zeit = ? WHERE refund_id = ? AND bestellung_id = ? AND ${OFFEN_SQL} AND ereignis_zeit < ?`)
      .run(jetzt(), ereignisZeit, r.id, b.id, ereignisZeit);
    return;
  }
  if (b) {
    // Idempotent: dasselbe Ereignis (oder refund.failed + refund.updated + charge.refund.updated zum selben Fehler) ergibt genau eine Zeile.
    // Ein geloester Eintrag wird nur durch ein gleich altes oder neueres Fehlerereignis wieder geoeffnet.
    db.prepare(`INSERT INTO erstattung_fehler (refund_id, bestellung_id, zeit, ereignis_zeit, betrag, waehrung, status, geloest) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(refund_id) DO UPDATE SET status = excluded.status, geloest = NULL, ereignis_zeit = excluded.ereignis_zeit,
        betrag = COALESCE(excluded.betrag, erstattung_fehler.betrag), waehrung = COALESCE(excluded.waehrung, erstattung_fehler.waehrung)
      WHERE erstattung_fehler.status NOT IN ('fehlgeschlagen','abgebrochen') AND excluded.ereignis_zeit >= erstattung_fehler.ereignis_zeit`)
      .run(r.id, b.id, jetzt(), ereignisZeit, betrag, waehrung, fehlerStatus);
  }
  ereignisHinzufuegen('gekauft', 'erstattung_fehlgeschlagen:' + r.id, { benutzer_id: b?.benutzer_id ?? null, kurs_id: b?.kurs_id ?? null,
    betrag: betrag === null ? null : ganzeEinheiten(betrag), waehrung, status: 'erstattung_fehlgeschlagen' });
}
// Refund-Failed: Eine NEUE erfolgreiche Erstattung (charge.refunded) zur selben Bestellung, die mindestens die Summe der offenen Fehlbetraege abdeckt,
// ersetzt die fehlgeschlagene(n) (z. B. Gabriella hat die Erstattung im Stripe-Dashboard neu ausgeloest). Teilweise Ersatzerstattungen loesen nichts
// (Konto zeigt weiter "fehlgeschlagen", Admin entscheidet). Nur Fehler, die AELTER sind als dieses Ereignis.
function fehlerDurchNeueErstattungErsetzt(ereignis, bestellungId, neuIds, refundListe) {
  if (!neuIds.length) return;
  const offen = db.prepare(`SELECT refund_id, betrag, ereignis_zeit FROM erstattung_fehler WHERE bestellung_id = ? AND ${OFFEN_SQL}`).all(bestellungId)
    .filter((f) => !neuIds.includes(f.refund_id));
  if (!offen.length || offen.some((f) => !Number.isSafeInteger(f.betrag))) return;
  const neuSumme = refundListe.filter((x) => neuIds.includes(x?.id) && (x.status === 'succeeded' || !x.status) && Number.isSafeInteger(x.amount))
    .reduce((s, x) => s + x.amount, 0);
  const ereignisZeit = Number.isSafeInteger(ereignis.created) ? ereignis.created : Math.floor(Date.now() / 1000);
  const aelter = offen.filter((f) => f.ereignis_zeit < ereignisZeit);
  if (aelter.length !== offen.length || neuSumme < offen.reduce((s, f) => s + f.betrag, 0)) return;
  for (const f of offen) db.prepare(`UPDATE erstattung_fehler SET status = 'ersetzt', geloest = ?, ereignis_zeit = ? WHERE refund_id = ? AND ${OFFEN_SQL}`).run(jetzt(), ereignisZeit, f.refund_id);
}

// Alle Stripe-Ereignisse, die der Webhook-Endpunkt bei Stripe abonnieren MUSS (Stripe schickt nur abonnierte). Ein Test hält diese Liste fest;
// wer ein Ereignis hinzufügt oder entfernt, muss auch den Endpunkt in Stripe (Test UND Live) anpassen.
export const WEBHOOK_EREIGNISSE = Object.freeze([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'invoice.paid', 'invoice.payment_failed',
  'customer.subscription.updated', 'customer.subscription.deleted', 'charge.refunded',
  'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'refund.failed', 'refund.updated', 'charge.refund.updated',
]);

function ereignisVerarbeiten(ereignis, extra=null) {
  const o = ereignis.data?.object;
  if (FREISCHALT_EREIGNISSE.has(ereignis.type)) return sitzungVerarbeiten(ereignis, o, extra);
  if (ereignis.type === 'charge.refunded') return erstattungVerarbeiten(ereignis, o, extra);
  if (ereignis.type === 'charge.dispute.created' || ereignis.type === 'charge.dispute.updated' || ereignis.type === 'charge.dispute.closed') return streitVerarbeiten(ereignis, o, extra);
  if (ereignis.type === 'refund.failed' || ereignis.type === 'refund.updated' || ereignis.type === 'charge.refund.updated') return erstattungStatus(ereignis, o);
  // alle anderen Ereignisse interessieren diese Plattform nicht
}

// B4: Vorarbeit fuer ein Streit-Ereignis (Stripe-Abfragen VOR der Buchung). Ergebnis: wartet=true, wenn die Bestellung zu dieser Zahlung noch fehlt
// (Stripe garantiert keine Reihenfolge: der Streit kann VOR dem Kauf-Ereignis ankommen). Das Ereignis wird dann dauerhaft gespeichert (wartende_ereignisse),
// Antwort 200, und bei Anlage der Bestellung genau einmal verarbeitet (wartendeAbarbeiten). Fehler (Netz, Stripe) => 500, Stripe wiederholt, nichts gebucht.
async function streitVorschritt(stripe,ereignis,o,refundPi,eigeneId=null){
  let streitRechnungId=null, wartet=false;
  // Reihenfolge bewahren: liegt zu dieser Zahlung schon ein wartendes Ereignis, reiht sich dieses dahinter ein.
  // Beim Abarbeiten (eigeneId gesetzt) zaehlen nur FRUEHERE wartende Ereignisse; ein neu eintreffendes reiht sich hinter alle noch offenen ein.
  if(eigeneId?db.prepare('SELECT 1 FROM wartende_ereignisse WHERE zahlung_id=? AND verarbeitet IS NULL AND rowid<(SELECT rowid FROM wartende_ereignisse WHERE ereignis_id=?)').get(refundPi,eigeneId)
    :db.prepare('SELECT 1 FROM wartende_ereignisse WHERE zahlung_id=? AND verarbeitet IS NULL AND ereignis_id<>?').get(refundPi,ereignis.id))wartet=true;
  if(!wartet){
          let dOrder=db.prepare("SELECT art,status,benutzer_id,kurs_id,erstellt,stripe_abo FROM bestellungen WHERE zahlung_id=? LIMIT 1").get(refundPi);
          // Zahlungs-ID der Abo-Rechnung fehlt in der App: die Rechnung bei Stripe nachschlagen (Fehler außer "unbekannt" => 500, Stripe wiederholt).
          if(!dOrder && stripe.invoicePayments?.list){
            let payments;
            try{payments=await stripe.invoicePayments.list({payment:{type:'payment_intent',payment_intent:refundPi},limit:20});}
            catch(e){if(e?.code!=='resource_missing')throw e;payments={data:[]};}
            const row=payments?.data?.find(x=>typeof x.invoice==='string'||typeof x.invoice?.id==='string');
            const rid=typeof row?.invoice==='string'?row.invoice:row?.invoice?.id??null;
            dOrder=rid?db.prepare("SELECT art,status,benutzer_id,kurs_id,erstellt,stripe_abo FROM bestellungen WHERE stripe_sitzung=? AND art='abo'").get(rid):null;
            if(dOrder)streitRechnungId=rid;
          }
          // Keine Bestellung bekannt, die Zahlung gehört aber einem Kunden der Plattform: das Ereignis kam VOR der Bestellung (Stripe garantiert keine Reihenfolge).
          // Nicht verlieren: 500, Stripe wiederholt später, dann ist die Bestellung da. Zahlungen fremder Kunden gehen nur als Meldung durch.
          if(!dOrder && stripe.paymentIntents?.retrieve){
            let kunde=null;
            try{kunde=piId((await stripe.paymentIntents.retrieve(refundPi))?.customer);}
            catch(e){if(e?.code!=='resource_missing')throw e;}
            if(kunde && db.prepare('SELECT 1 FROM benutzer WHERE stripe_kunde=?').get(kunde)) wartet=true;
          }
          if(!wartet && streitEntzieht(ereignis,o) && dOrder?.art==='abo' && dOrder.status==='bezahlt' && dOrder.benutzer_id && dOrder.kurs_id)
            for(const a of abosDerBestellung(dOrder.benutzer_id,dOrder.kurs_id,dOrder)) await aboBeiStripeBeenden(stripe,a.stripe_abo);
  }
  return {streitRechnungId,wartet};
}

// B4: wartende Ereignisse abarbeiten, sobald ihre Bestellung da ist. Laeuft nach jedem gebuchten Webhook und kurz nach dem Start; nie parallel zu sich selbst.
// Jedes Ereignis wird genau einmal gebucht (UPDATE ... WHERE verarbeitet IS NULL innerhalb der Transaktion).
let drainLaeuft=false, drainNochmal=false;
export async function wartendeAbarbeiten({stripe,mails=null}){
  if(drainLaeuft){drainNochmal=true;return 0;}
  drainLaeuft=true; let gebucht=0;
  try{
    do{
      drainNochmal=false;
      const offen=db.prepare('SELECT ereignis_id,zahlung_id,ereignis_json FROM wartende_ereignisse WHERE verarbeitet IS NULL ORDER BY rowid LIMIT 100').all();
      const uebersprungen=new Set();
      for(const w of offen){
        if(uebersprungen.has(w.zahlung_id))continue;   // Reihenfolge je Zahlung: ein wartendes blockiert die folgenden
        try{
          let ereignis; try{ereignis=JSON.parse(w.ereignis_json);}catch{db.prepare("UPDATE wartende_ereignisse SET verarbeitet=? WHERE ereignis_id=?").run('ungueltig '+jetzt(),w.ereignis_id);continue;}
          const v=await streitVorschritt(stripe,ereignis,ereignis.data?.object,w.zahlung_id,w.ereignis_id);
          if(v.wartet){uebersprungen.add(w.zahlung_id);continue;}
          const ok=transaktion(()=>{
            const r=db.prepare('UPDATE wartende_ereignisse SET verarbeitet=? WHERE ereignis_id=? AND verarbeitet IS NULL').run(jetzt(),w.ereignis_id);
            if(r.changes===0)return false;
            ereignisVerarbeiten(ereignis,{rechnungId:v.streitRechnungId});
            return true;
          });
          if(ok)gebucht++;
        }catch(e){uebersprungen.add(w.zahlung_id);console.warn('Wartendes Ereignis',w.ereignis_id,'noch nicht verarbeitet:',e?.code||e?.name||'unbekannt');}
      }
    }while(drainNochmal);
  }finally{drainLaeuft=false;}
  if(gebucht){ereignisseNachCommit();void mails?.ausgangSenden?.().catch(()=>{});mails?.aboKuendigungNachCommitSenden?.();mails?.aboErstattungNachCommitSenden?.();}
  return gebucht;
}

// Steht VOR express.json(), weil die Signatur über den unveränderten Rohtext geht.
export function webhookHandler({ stripe, webhookSecret, mails, abgleichModus = 'test' }) {
  // B4: nach einem Neustart liegen gebliebene wartende Ereignisse erneut versuchen.
  setTimeout(() => { void wartendeAbarbeiten({ stripe, mails }).catch(() => {}); }, 3000).unref?.();
  const innerHandler = async (req, res) => {
    let ereignis;
    try {
      ereignis = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
    } catch (e) {
      console.warn('Webhook-Signatur oder Format ungültig');
      return fehler(res, 400, 'webhook_signatur_falsch');
    }
    if (!['test', 'live'].includes(abgleichModus) || typeof ereignis.livemode !== 'boolean' || ereignis.livemode !== (abgleichModus === 'live')) {
      console.warn(`Webhook: livemode=${ereignis.livemode} passt nicht zu Modus ${abgleichModus}`);
      return fehler(res, 400, 'webhook_livemode_abgelehnt');
    }
    try {
      let details = null;
      const aboId = ereignisAbo(ereignis);
      if (aboId && !db.prepare('SELECT 1 FROM abos WHERE stripe_abo=?').get(aboId)) {
        const o=ereignis.data?.object || {};
        const meta=o.metadata?.kurs_id || o.parent?.subscription_details?.metadata?.kurs_id ||
          o.subscription_details?.metadata?.kurs_id || o.lines?.data?.some(l=>l.metadata?.kurs_id);
        if (!meta && ereignis.type !== 'checkout.session.completed') {
          // Stripe garantiert keine Ereignisreihenfolge: Rechnung kann vor Checkout kommen.
          try { details = await stripe.subscriptions.retrieve(aboId); }
          catch (e) {
            // Gibt es das Abo bei Stripe nicht (fremdes oder gelöschtes Objekt): ignorieren. Andere Fehler (Netz, Stripe down) => 500, Stripe sendet es später erneut.
            if (e?.code !== 'resource_missing') throw e;
            console.warn(`Ereignis ${ereignis.id}: Abo unbekannt bei Stripe, ignoriert`);
          }
        }
      }
      let rechnungZahlungId=null, rechnungId=null, periodEnd=null, refundsData=null;
      const o=ereignis.data?.object;
      const refundPi=typeof o?.payment_intent==='string'?o.payment_intent:typeof o?.payment_intent?.id==='string'?o.payment_intent.id:null;
      if (ereignis.type==='invoice.paid' && typeof o?.id==='string' && o.id.startsWith('in_') && stripe.invoicePayments?.list) {
        try {
          const payments=await stripe.invoicePayments.list({invoice:o.id,limit:20});
          const paid=payments?.data?.find(x=>x.status==='paid');
          const pi=paid?.payment?.payment_intent;
          rechnungZahlungId=typeof pi==='string'?pi:typeof pi?.id==='string'?pi.id:null;
        } catch {console.warn('Abo-Rechnungszahlung konnte nicht aufgeloest werden');}
      }
      if (ereignis.type==='charge.refunded' && !!refundPi && stripe.invoicePayments?.list) {
        const known=db.prepare("SELECT 1 FROM bestellungen WHERE zahlung_id=?").get(refundPi);
        if(!known){
          let payments;
          try{payments=await stripe.invoicePayments.list({payment:{type:'payment_intent',payment_intent:refundPi},limit:20});}
          catch(e){if(e?.code!=='resource_missing')throw e;payments={data:[]};}
          const row=payments?.data?.find(x=>typeof x.invoice==='string'||typeof x.invoice?.id==='string');
          rechnungId=typeof row?.invoice==='string'?row.invoice:row?.invoice?.id??null;
          if(rechnungId && !db.prepare("SELECT 1 FROM bestellungen WHERE stripe_sitzung=?").get(rechnungId) && stripe.invoices?.retrieve){
            // Falls die Rechnung noch vor invoice.paid erstattet wurde, Retry statt verlorener Buchung.
            // Fremde Stripe-Rechnungen dagegen nicht dauerhaft erneut anfordern.
            const inv=await stripe.invoices.retrieve(rechnungId);
            const m=inv.metadata?.benutzer_id?inv.metadata:
              inv.parent?.subscription_details?.metadata||inv.subscription_details?.metadata||{};
            const owned= (idAus(m.benutzer_id)&&idAus(m.kurs_id)&&
               db.prepare("SELECT 1 FROM benutzer WHERE id=?").get(idAus(m.benutzer_id))&&
               db.prepare("SELECT 1 FROM kurse WHERE id=?").get(idAus(m.kurs_id))) ||
               (rechnungsAbo(inv)&&db.prepare("SELECT 1 FROM abos WHERE stripe_abo=?").get(rechnungsAbo(inv)));
            if(owned)throw new Error('abo refund waiting for paid invoice');
          }
        }
      }
      if(ereignis.type==='charge.refunded' && typeof o?.id==='string' &&
         (!Array.isArray(o.refunds?.data)||o.refunds?.has_more===true) && stripe.refunds?.list){
        const all=await stripe.refunds.list({charge:o.id,limit:100});
        if(!Array.isArray(all?.data)||all.has_more===true)throw new Error('Unvollstaendige Refund-Liste');
        refundsData=all.data;
      }
      // N5: Einmalkauf, dessen Zahlung Stripe schon vor diesem Ereignis voll erstattet hat -> kein Zugang.
      // A1-03: Schlägt die Abfrage fehl (Netz, 429) oder ist die Liste unvollständig, wird NICHT freigeschaltet: Fehler -> 500, nichts gebucht,
      // Stripe wiederholt das Ereignis (vorher: Zugang trotz möglicher voller Erstattung). Nur für bezahlte Sitzungen (sonst wird ohnehin nichts gebucht).
      let bereitsErstattet=false;
      if(FREISCHALT_EREIGNISSE.has(ereignis.type) && o?.mode==='payment' && o?.payment_status==='paid' && typeof o?.payment_intent==='string' && stripe.refunds?.list){
        let l;
        try{ l=await stripe.refunds.list({payment_intent:o.payment_intent,limit:100}); }
        catch(e){ console.warn('Erstattungspruefung vor dem Kauf nicht moeglich, Stripe wiederholt das Ereignis'); throw e; }
        if(!Array.isArray(l?.data) || l.has_more===true) throw new Error('Unvollstaendige Erstattungsliste vor dem Kauf');
        const summe=l.data.filter(x=>x?.status==='succeeded'||x?.status==='pending').reduce((s,x)=>s+(Number.isSafeInteger(x.amount)?x.amount:0),0);
        bereitsErstattet=Number.isSafeInteger(o.amount_total)&&o.amount_total>0&&summe>=o.amount_total;
      }
      // U4: Streitfall bei einer bezahlten Abo-Rechnung -> das Abo zuerst bei Stripe beenden (Fehler: 500, Stripe wiederholt, nichts gebucht).
      let streitRechnungId=null, streitWartet=false;
      if(ereignis.type.startsWith('charge.dispute.') && !!refundPi) ({streitRechnungId,wartet:streitWartet}=await streitVorschritt(stripe,ereignis,o,refundPi));
      if(ereignis.type==='charge.refunded' && !!refundPi){
        const order=db.prepare("SELECT stripe_sitzung,art,status,benutzer_id,kurs_id,erstellt,stripe_abo FROM bestellungen WHERE zahlung_id=? LIMIT 1").get(refundPi) ||
          (rechnungId?db.prepare("SELECT stripe_sitzung,art,status,benutzer_id,kurs_id,erstellt,stripe_abo FROM bestellungen WHERE stripe_sitzung=? AND art='abo'").get(rechnungId):null);
        if(order?.art==='abo' && stripe.invoices?.retrieve){
          const invoice=await stripe.invoices.retrieve(order.stripe_sitzung);
          const seconds=(invoice?.lines?.data||[]).reduce((m,x)=>Math.max(m,Number.isSafeInteger(x.period?.end)?x.period.end:0),0);
          if(seconds>0)periodEnd=seconds*1000;
          // F2: Volle Erstattung der LETZTEN Abo-Rechnung -> das Abo auch bei Stripe beenden (sonst wird der naechste Monat abgebucht und
          // der Zugang oeffnet sich wieder). Scheitert Stripe, wirft das einen Fehler: 500, nichts gebucht, Stripe wiederholt das Ereignis.
          const vollErstattet=o.refunded===true||(Number.isSafeInteger(o.amount)&&o.amount>0&&o.amount_refunded>=o.amount);
          if(vollErstattet && order.status==='bezahlt' && periodEnd){
            const rechnungAbo=rechnungsAbo(invoice); // das Abo, zu dem DIESE Rechnung gehoert (falls Stripe es nennt)
            const letztes=rechnungAbo
              ?db.prepare("SELECT stripe_abo,gueltig_bis,status FROM abos WHERE stripe_abo=? AND benutzer_id=? AND kurs_id=?").get(rechnungAbo,order.benutzer_id,order.kurs_id)
              :db.prepare("SELECT stripe_abo,gueltig_bis,status FROM abos WHERE benutzer_id=? AND kurs_id=? ORDER BY id DESC LIMIT 1").get(order.benutzer_id,order.kurs_id);
            if(letztes?.stripe_abo && letztes.status!=='beendet' && letztes.gueltig_bis===periodEnd)await aboBeiStripeBeenden(stripe,letztes.stripe_abo);
          }
          // M2: Volle Erstattung einer Abo-Zahlung "pruefen" (kein Zugang vergeben): das Abo läuft sonst bei Stripe weiter. Es wird beendet; ein schon
          // bezahlter früherer Zeitraum behält seinen Zugang.
          if(vollErstattet && order.status==='pruefen' && order.benutzer_id && order.kurs_id){
            for(const a of abosDerBestellung(order.benutzer_id,order.kurs_id,order))
              await aboBeiStripeBeenden(stripe,a.stripe_abo);
          }
        }
      }
      // Alles in EINER Transaktion: Ereignis-ID vormerken UND verarbeiten. Geht etwas schief, wird beides zurückgenommen und
      // Stripe schickt das Ereignis später nochmal (dank 500). Ist die ID schon da (UNIQUE), war es ein Doppel.
      const neu = transaktion(() => {
        const r = db.prepare('INSERT OR IGNORE INTO stripe_ereignisse (id, typ, verarbeitet) VALUES (?, ?, ?)').run(ereignis.id, ereignis.type, jetzt());
        if (r.changes === 0) return false;
        if (streitWartet) {
          // B4: Bestellung fehlt noch: Ereignis dauerhaft speichern, gilt als angenommen (200), wird bei Anlage der Bestellung verarbeitet.
          db.prepare('INSERT OR IGNORE INTO wartende_ereignisse (ereignis_id, typ, zahlung_id, ereignis_json, erstellt) VALUES (?, ?, ?, ?, ?)').run(ereignis.id, ereignis.type, refundPi, JSON.stringify(ereignis), jetzt());
          return true;
        }
        if (aboId) aboVerarbeiten(ereignis, {...(details||{}),rechnungZahlungId});
        else ereignisVerarbeiten(ereignis,{rechnungId:rechnungId??streitRechnungId,periodEnd,refundsData,bereitsErstattet});
        return true;
      });
      res.json({ received: true, doppelt: !neu });
      if (neu) queueMicrotask(() => { void wartendeAbarbeiten({stripe,mails}).catch(() => {}); ereignisseNachCommit(); void mails?.ausgangSenden().catch(() => {}); mails?.aboKuendigungNachCommitSenden?.(); mails?.aboErstattungNachCommitSenden?.(); });
    } catch (e) {
      // Ereignistyp und gekürzte Meldung ins Log (ohne Schlüssel), damit ein Fehler nachvollziehbar ist.
      console.error('Webhook-Verarbeitung fehlgeschlagen:', e.code || e.name || 'unbekannt', '|', ereignis?.type, '|', String(e.message || '').replace(/(sk|rk|whsec)_[A-Za-z0-9_]+/g, '$1_***').slice(0, 160));
      fehler(res, 500, 'serverfehler');
    }
  };
  // Sprache fuer Mails/Texte aus den Checkout-Metadaten (Fallback Standardsprache). Zwei Elemente bleiben erhalten: [Parser, Handler].
  const mitMetaSprache = (req, res) => { let l; try { l = JSON.parse(req.body).data?.object?.metadata?.sprache; } catch { /* Standardsprache */ } return mitSprache(l, () => innerHandler(req, res)); };
  return [express.raw({ type: 'application/json' }), mitMetaSprache];
}
